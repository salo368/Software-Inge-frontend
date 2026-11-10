import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, switchMap } from 'rxjs';

import { AnimatedMoneyComponent } from '@shared/components/animated-money.component';
import { AuthService } from '@shared/core/auth.service';
import { Bank, BanksService } from '@shared/core/banks.service';
import { blockUrl } from '@shared/core/blocks';
import { formatCOP } from '@shared/core/format';
import {
  ProcessRow,
  ProcessStage,
  ProcessesService,
  projectedInterest,
} from '@shared/core/processes.service';
import { SignatureStage, SignatureStatusService } from '@shared/core/signature-status.service';
import { ProcessDocumentsComponent } from './process/process-documents.component';
import { ProcessFormComponent } from './process/process-form.component';
import { ProcessPaymentComponent } from './process/process-payment.component';

interface Step {
  key: ProcessStage;
  label: string;
  icon: string;
}

const STEPS: Step[] = [
  { key: 'FORM', label: 'Tus datos', icon: 'bi-person-vcard' },
  { key: 'DOCUMENTS', label: 'Documentos', icon: 'bi-file-earmark-arrow-up' },
  { key: 'SIGNATURE', label: 'Firma', icon: 'bi-vector-pen' },
  { key: 'PAYMENT', label: 'Pago', icon: 'bi-credit-card' },
  { key: 'REVIEW', label: 'Revision', icon: 'bi-check-circle' },
];

/** Stages rendered by the final "done" card. */
const FINAL_STAGES: readonly ProcessStage[] = ['REVIEW', 'SENT_TO_BANK', 'COMPLETED'];

const POLL_MS = 3000;
/** generate_sign fills the PDF, downloads it and opens the signature: a few seconds, more on cold start. */
const WAIT_FOR_SIGNATURE_MS = 120_000;
/** The signed webhook is async but immediate; this only covers a slow cold start. */
const WAIT_FOR_PAYMENT_MS = 90_000;

/**
 * What the signature step shows, derived from the signature's own stage:
 *
 *   sign        ceremony opened, nothing done yet
 *   resume      signer already started (email, photos, drawing or OTP)
 *   processing  OTP accepted, sign_doc is sealing the PDF
 *   signed      SIGNED; waiting for the webhook to move the process to PAYMENT
 *   failed      FAILED (3 bad OTPs, timeout) or the 15 min window expired.
 *               The backend has no reopen yet, so this is terminal.
 */
export type SignatureCta = 'sign' | 'resume' | 'processing' | 'signed' | 'failed';

export function signatureCtaFor(stage: SignatureStage | 'EXPIRED' | null): SignatureCta {
  switch (stage) {
    case null:
    case 'FORM':
      return 'sign';
    case 'SIGNING':
      return 'processing';
    case 'SIGNED':
      return 'signed';
    case 'FAILED':
    case 'EXPIRED':
      return 'failed';
    default:
      return 'resume';
  }
}

@Component({
  selector: 'app-process',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    AnimatedMoneyComponent,
    ProcessFormComponent,
    ProcessDocumentsComponent,
    ProcessPaymentComponent,
  ],
  templateUrl: './process.component.html',
})
export class ProcessComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private processesApi = inject(ProcessesService);
  private banksApi = inject(BanksService);
  private signaturesApi = inject(SignatureStatusService);

  readonly STEPS = STEPS;
  readonly formatCOP = formatCOP;

  process = signal<ProcessRow | null>(null);
  bank = signal<Bank | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  /** FORM -> DOCUMENTS (`set-process-form`) in flight. */
  savingForm = signal(false);
  /** DOCUMENTS: user reopened the form to correct it. */
  editingForm = signal(false);
  docsComplete = signal(false);
  /** DOCUMENTS -> SIGNATURE: waiting for generate_sign to open the signature. */
  waitingSignature = signal(false);

  signatureStage = signal<SignatureStage | 'EXPIRED' | null>(null);

  private timer: number | null = null;
  private waitStartedAt = 0;

  readonly stage = computed<ProcessStage>(() => this.process()?.stage ?? 'FORM');
  readonly isFinal = computed(() => FINAL_STAGES.includes(this.stage()));
  /** The KYC form needs room (4 columns on desktop); every other step reads better narrow. */
  readonly wideCard = computed(
    () => this.stage() === 'FORM' || (this.stage() === 'DOCUMENTS' && this.editingForm()),
  );
  readonly stageIndex = computed(() => {
    const s = this.stage();
    if (s === 'SENT_TO_BANK' || s === 'COMPLETED') return STEPS.length;
    return STEPS.findIndex((step) => step.key === s);
  });
  readonly signatureCta = computed(() => signatureCtaFor(this.signatureStage()));
  readonly interest = computed(() => {
    const p = this.process();
    return p ? projectedInterest(p) : 0;
  });
  readonly finalAmount = computed(() => (this.process()?.amount ?? 0) + this.interest());

  ngOnInit(): void {
    this.load(this.route.snapshot.paramMap.get('id')!);
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  // ---------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------

  private load(id: string): void {
    this.processesApi.get(id).subscribe({
      next: (p) => {
        if (!p) {
          this.router.navigate(['/me']);
          return;
        }
        this.apply(p);
        this.loading.set(false);
        this.loadBank(p.bank_id);
      },
      error: () => {
        this.loading.set(false);
        this.router.navigate(['/me']);
      },
    });
  }

  private apply(p: ProcessRow): void {
    const prevStage = this.process()?.stage;
    this.process.set(p);
    if (prevStage === p.stage) return;
    this.stopTimer();
    this.waitingSignature.set(false);
    this.editingForm.set(false);
    if (p.stage === 'SIGNATURE') this.checkSignature();
  }

  private reload(): void {
    const p = this.process();
    if (!p) return;
    this.processesApi.get(p.id).subscribe({ next: (fresh) => fresh && this.apply(fresh) });
  }

  private loadBank(bankId: number): void {
    if (this.bank()?.id === bankId) return;
    this.banksApi.listBanks().subscribe({
      next: (r) => this.bank.set(r.banks.find((b) => b.id === bankId) ?? null),
    });
  }

  // ---------------------------------------------------------------------
  // FORM (and DOCUMENTS edit)
  // ---------------------------------------------------------------------

  /** The form was upserted; snapshot it into the process. */
  onFormSaved(): void {
    const p = this.process();
    if (!p || this.savingForm()) return;
    this.savingForm.set(true);
    this.error.set(null);
    this.processesApi.setForm(p.id).subscribe({
      next: (r) => {
        this.savingForm.set(false);
        // Leaving edit mode re-mounts the documents list, which re-reads the
        // requirements (they may change with is_pep / is_tax_declarant).
        this.editingForm.set(false);
        this.docsComplete.set(false);
        this.process.update((cur) => (cur ? { ...cur, stage: r.stage } : cur));
      },
      error: (err: HttpErrorResponse) => {
        this.savingForm.set(false);
        this.error.set(friendlyError(err?.error?.error));
      },
    });
  }

  toggleEditForm(): void {
    this.editingForm.update((v) => !v);
    this.docsComplete.set(false);
  }

  // ---------------------------------------------------------------------
  // DOCUMENTS -> SIGNATURE
  // ---------------------------------------------------------------------

  onDocsComplete(complete: boolean): void {
    this.docsComplete.set(complete);
  }

  /**
   * `get-required-files` is what fires generate_sign (and retries it while
   * the process stays in DOCUMENTS), so each tick calls it before re-reading
   * the process, until the process reaches SIGNATURE with a `signature_id`.
   */
  continueToSignature(): void {
    const p = this.process();
    if (!p || !this.docsComplete() || this.waitingSignature()) return;
    this.waitingSignature.set(true);
    this.error.set(null);
    this.waitStartedAt = Date.now();
    this.pollUntil(
      () =>
        this.processesApi
          .requiredFiles(p.id)
          .pipe(switchMap(() => this.processesApi.get(p.id))),
      (fresh) => !!fresh && fresh.stage !== 'DOCUMENTS',
      WAIT_FOR_SIGNATURE_MS,
      () => {
        this.waitingSignature.set(false);
        this.error.set(
          'Estamos tardando en preparar tu orden de inversion. Intenta de nuevo en unos segundos.',
        );
      },
    );
  }

  // ---------------------------------------------------------------------
  // SIGNATURE
  // ---------------------------------------------------------------------

  private checkSignature(): void {
    const p = this.process();
    if (!p?.signature_id) {
      this.signatureStage.set(null);
      return;
    }
    this.signaturesApi.get(p.signature_id).subscribe({
      next: (s) => {
        this.signatureStage.set(s.stage);
        if (s.stage === 'SIGNED') this.waitForPayment();
        else if (s.stage === 'SIGNING') this.retryLater(() => this.checkSignature());
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 410) this.signatureStage.set('EXPIRED');
        else this.signatureStage.set(null);
      },
    });
  }

  /** SIGNED: the `signed` webhook moves the process to PAYMENT asynchronously. */
  private waitForPayment(): void {
    const p = this.process();
    if (!p) return;
    this.waitStartedAt = Date.now();
    this.pollUntil(
      () => this.processesApi.get(p.id),
      (fresh) => !!fresh && fresh.stage !== 'SIGNATURE',
      WAIT_FOR_PAYMENT_MS,
      () => this.error.set('Tu firma quedo lista. Recarga la pagina para continuar con el pago.'),
    );
  }

  /**
   * Sends the signer to the signing block (`/sign/{signature_id}`), a plain
   * document navigation under the same CloudFront domain. `return_url`
   * brings them back here; `email` pre-fills the signer's email.
   */
  startSignature(): void {
    const p = this.process();
    if (!p?.signature_id) return;
    const params = new URLSearchParams({ return_url: window.location.href });
    const email = this.auth.user()?.email;
    if (email) params.set('email', email);
    window.location.assign(`${blockUrl('signing', p.signature_id)}?${params.toString()}`);
  }

  // ---------------------------------------------------------------------
  // PAYMENT
  // ---------------------------------------------------------------------

  onPaymentStageChange(stage: ProcessStage): void {
    if (stage !== 'PAYMENT') this.reload();
  }

  // ---------------------------------------------------------------------
  // Polling helpers
  // ---------------------------------------------------------------------

  private pollUntil(
    fetch: () => Observable<ProcessRow | null>,
    done: (p: ProcessRow | null) => boolean,
    timeoutMs: number,
    onTimeout: () => void,
  ): void {
    this.stopTimer();
    const tick = () => {
      this.timer = null;
      fetch().subscribe({
        next: (fresh) => {
          if (done(fresh) && fresh) {
            this.apply(fresh);
            return;
          }
          if (Date.now() - this.waitStartedAt > timeoutMs) {
            onTimeout();
            return;
          }
          this.timer = window.setTimeout(tick, POLL_MS);
        },
        // A transient failure doesn't end the wait: retry on the next tick.
        error: () => {
          if (Date.now() - this.waitStartedAt > timeoutMs) onTimeout();
          else this.timer = window.setTimeout(tick, POLL_MS);
        },
      });
    };
    tick();
  }

  private retryLater(fn: () => void): void {
    this.stopTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      fn();
    }, POLL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'form_required':
      return 'Completa el formulario antes de continuar.';
    case 'process_form_locked':
      return 'Tus datos ya estan en la orden de inversion y no se pueden cambiar.';
    case 'process_not_found':
      return 'No encontramos este proceso.';
    case 'form_lookup_unavailable':
      return 'No pudimos leer tu formulario. Intenta de nuevo en unos segundos.';
    default:
      return 'No pudimos continuar. Intenta de nuevo en unos segundos.';
  }
}
