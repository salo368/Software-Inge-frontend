import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AnimatedMoneyComponent } from '@shared/components/animated-money.component';
import { BanksService, Bank } from '@shared/core/banks.service';
import { blockUrl } from '@shared/core/blocks';
import { formatCOP } from '@shared/core/format';
import {
  ProcessDetail,
  ProcessesService,
  ProcessStage,
  STAGE_ORDER,
} from '@shared/core/processes.service';
import { ProcessDocumentsComponent } from './process/process-documents.component';
import { ProcessFormComponent } from './process/process-form.component';

interface Step {
  key: ProcessStage;
  label: string;
  icon: string;
}

const STEPS: Step[] = [
  { key: 'form', label: 'Tus datos', icon: 'bi-person-vcard' },
  { key: 'documents', label: 'Documentos', icon: 'bi-file-earmark-arrow-up' },
  { key: 'signature', label: 'Firma', icon: 'bi-vector-pen' },
  { key: 'payment', label: 'Pago', icon: 'bi-credit-card' },
  { key: 'done', label: 'Listo', icon: 'bi-check-circle' },
];

@Component({
  selector: 'app-process',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    AnimatedMoneyComponent,
    ProcessFormComponent,
    ProcessDocumentsComponent,
  ],
  templateUrl: './process.component.html',
})
export class ProcessComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private processesApi = inject(ProcessesService);
  private banksApi = inject(BanksService);

  readonly STEPS = STEPS;
  readonly formatCOP = formatCOP;

  detail = signal<ProcessDetail | null>(null);
  bank = signal<Bank | null>(null);
  loading = signal(true);
  advancing = signal(false);
  signing = signal(false);
  error = signal<string | null>(null);

  /**
   * True once we auto-advanced signature -> payment after the user
   * came back from the signing SPA with a signed ceremony. Prevents
   * the effect from firing twice if the component re-renders.
   */
  private autoAdvancedAfterSign = false;

  readonly stage = computed<ProcessStage>(() => this.detail()?.process.stage ?? 'form');
  readonly stageIndex = computed(() => STAGE_ORDER.indexOf(this.stage()));

  /**
   * State of the signature button on the `signature` step. Three
   * shapes: no ceremony yet or resumable one (default action), the
   * worker is still crunching (locked), or the previous ceremony
   * failed/expired and the next click will reopen a fresh one.
   */
  readonly signatureCta = computed<
    'sign' | 'resume' | 'processing' | 'retry'
  >(() => {
    const sig = this.detail()?.signature;
    if (!sig) return 'sign';
    switch (sig.stage) {
      case 'signing':
        return 'processing';
      case 'failed':
      case 'expired':
        return 'retry';
      case 'signed':
        // We shouldn't render the CTA in this state; the auto-advance
        // effect will have moved the process to `payment` already.
        // Fall back to sign in case someone lands here.
        return 'sign';
      default:
        return 'resume';
    }
  });
  readonly interest = computed(() => {
    const p = this.detail()?.process;
    if (!p) return 0;
    const factor = Math.pow(1 + p.rate / 100, p.term_days / 365) - 1;
    return Math.round(p.amount * factor);
  });
  readonly finalAmount = computed(() => {
    const p = this.detail()?.process;
    if (!p) return 0;
    return p.amount + this.interest();
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.load(id);
  }

  load(id: string): void {
    this.processesApi.get(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
        this.loadBank(d.process.bank_id);
        this.maybeAutoAdvanceAfterSigning(d);
      },
      error: () => {
        this.loading.set(false);
        this.router.navigate(['/me']);
      },
    });
  }

  /**
   * When the user returns from the signing SPA after a successful
   * ceremony, the process is still at stage=`signature` but the
   * embedded `signature.stage` is already `signed` (the callback wrote
   * it back). We advance to `payment` on their behalf so they land on
   * the payment screen instead of re-clicking "Firmar ahora".
   *
   * We only do this once per component lifetime (see
   * `autoAdvancedAfterSign`) to avoid an accidental loop if
   * `advance()` returns quickly and triggers another load.
   */
  private maybeAutoAdvanceAfterSigning(d: ProcessDetail): void {
    if (this.autoAdvancedAfterSign) return;
    if (d.process.stage !== 'signature') return;
    if (d.signature?.stage !== 'signed') return;
    this.autoAdvancedAfterSign = true;
    this.advance();
  }

  private loadBank(bankId: number): void {
    if (this.bank()?.id === bankId) return;
    this.banksApi.listBanks().subscribe({
      next: (r) => this.bank.set(r.banks.find((b) => b.id === bankId) ?? null),
    });
  }

  refresh(): void {
    const d = this.detail();
    if (!d) return;
    this.processesApi.get(d.process.id).subscribe({
      next: (fresh) => this.detail.set(fresh),
    });
  }

  advance(): void {
    const d = this.detail();
    if (!d || this.advancing()) return;
    this.advancing.set(true);
    this.error.set(null);
    this.processesApi.advance(d.process.id).subscribe({
      next: (r) => {
        this.detail.update((cur) => (cur ? { ...cur, process: r.process } : cur));
        this.advancing.set(false);
      },
      error: (err) => {
        this.advancing.set(false);
        this.error.set(this.friendlyError(err?.error?.error));
      },
    });
  }

  onFormSaved(): void {
    // Form was upserted; advance the process out of the `form` stage.
    this.advance();
  }

  /**
   * Sends the user to the signing SPA. Two entry paths, both handled
   * here:
   *
   *   1. First time (process still at `documents`, or at `signature`
   *      but no ceremony yet -- shouldn't happen in v2 but we
   *      tolerate it): call POST /processes/{id}/advance. The
   *      backend opens the ceremony server-side and returns
   *      `sign_url`. The browser NEVER calls the signatures API
   *      directly -- that endpoint is gated by an M2M service key.
   *
   *   2. Resume (process already at `signature`, ceremony exists but
   *      not yet `signed`): reuse the embedded `signature.sign_id`
   *      and jump straight to the signing SPA without any API call.
   *
   * Either way we append `?return_url=<current>` so the signing SPA
   * knows where to send the user back after the ceremony ends.
   */
  startSignature(): void {
    const d = this.detail();
    if (!d || this.signing()) return;

    const pending = d.signature;
    if (pending && pending.stage !== 'signed') {
      this.goToSigning(pending.sign_id);
      return;
    }

    this.signing.set(true);
    this.error.set(null);
    this.processesApi.advance(d.process.id).subscribe({
      next: (r) => {
        this.signing.set(false);
        this.detail.update((cur) => (cur ? { ...cur, process: r.process } : cur));
        if (r.sign_url) {
          this.goToSigningUrl(r.sign_url);
          return;
        }
        // No sign_url in the response means the backend advanced us
        // past `signature` (e.g. the ceremony was already signed and
        // we were racing another tab). Refresh so the UI catches up.
        this.refresh();
      },
      error: (err) => {
        this.signing.set(false);
        this.error.set(this.friendlyError(err?.error?.error));
      },
    });
  }

  /**
   * Redirects to the signing SPA using a known sign_id (resume flow).
   * The signing block lives at `/sign/{sign_id}` under the same
   * CloudFront distribution, so this is a plain document navigation.
   */
  private goToSigning(signId: string): void {
    const target = blockUrl('signing', signId);
    this.goToSigningUrl(target);
  }

  /**
   * Redirects to a fully-qualified signing URL (as returned by the
   * backend's `advance` response). Appends `?return_url` pointing at
   * the current portal URL so the SPA can send the user back exactly
   * where they were. Preserves any query string the backend already
   * put on the URL.
   */
  private goToSigningUrl(signUrl: string): void {
    const sep = signUrl.includes('?') ? '&' : '?';
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.assign(`${signUrl}${sep}return_url=${returnUrl}`);
  }

  private friendlyError(code: string | undefined): string {
    switch (code) {
      case 'form_required':
        return 'Completa el formulario antes de continuar.';
      case 'declaracion_renta_required':
        return 'Debes cargar la declaracion de renta antes de continuar.';
      case 'signature_required':
        return 'Debes firmar la orden de inversion antes de continuar.';
      case 'process_not_in_signature_stage':
        return 'Este proceso ya no esta en la etapa de firma.';
      default:
        // Errors bubbling up from the signatures service arrive
        // prefixed with `signature_bridge_` (see processes/advance
        // handler). Present them as a transient upstream failure.
        if (code?.startsWith('signature_bridge_')) {
          return 'No pudimos abrir la ceremonia de firma. Intenta de nuevo en unos segundos.';
        }
        return 'No pudimos continuar. Intenta de nuevo en unos segundos.';
    }
  }
}
