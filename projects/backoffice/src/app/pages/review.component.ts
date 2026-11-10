import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { formatCOP } from '@shared/core/format';
import { ProcessStage, projectedInterest } from '@shared/core/processes.service';
import { environment as shared } from '@shared/environments/environment';

import {
  AdminUser,
  BackofficeApi,
  ProcessDetail,
  ProcessFile,
  ProcessPayments,
  SignatureReview,
} from '../core/backoffice-api.service';
import {
  FILE_TYPE_LABEL,
  SIGNATURE_STAGE_LABEL,
  STAGES,
  STAGE_LABEL,
  formatBytes,
  formatDate,
  formatDateTime,
  formatRate,
  initials,
  shortId,
  titleCase,
} from '../core/labels';
import { FormSectionsComponent } from '../ui/form-sections.component';
import { StatusComponent } from '../ui/status.component';
import { APPROVAL_STEPS } from './approvals.component';
import { ShellComponent } from './shell.component';

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string };

type CheckStatus = 'ok' | 'fail' | 'pending' | 'unknown';

interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

interface ManualCheck {
  id: string;
  label: string;
}

interface FileRow {
  type: string;
  label: string;
  required: boolean;
  generated: boolean;
  file: ProcessFile | null;
  /** Older uploads of the same type (the investor replaced it). */
  previous: number;
}

const GENERATED_TYPES = new Set(['RAW_INVESTMENT_ORDER', 'INVESTMENT_ORDER']);

const MANUAL_CHECKS: Partial<Record<ProcessStage, ManualCheck[]>> = {
  REVIEW: [
    { id: 'payments', label: 'Los comprobantes de pago son legibles y suman el monto del CDT.' },
    { id: 'documents', label: 'Los documentos están completos, vigentes y corresponden al inversionista.' },
    { id: 'identity', label: 'Las fotos de identidad coinciden con el documento y con los datos del formulario.' },
    { id: 'order', label: 'La orden de inversión firmada tiene los datos correctos.' },
  ],
  SENT_TO_BANK: [{ id: 'bank', label: 'El banco confirmó la apertura del CDT.' }],
};

/**
 * Holistic review of one process before it becomes an active CDT: process and
 * applicant data, documents, signature (with identity evidences), payments,
 * automatic checks and the approval itself.
 *
 *   REVIEW        -> send-to-bank  (review passed, the order goes to the bank)
 *   SENT_TO_BANK  -> approve-cdt   (the bank confirmed, the CDT is active)
 *
 * Any other stage opens read-only.
 */
@Component({
  selector: 'app-review',
  standalone: true,
  imports: [CommonModule, RouterLink, ShellComponent, StatusComponent, FormSectionsComponent],
  templateUrl: './review.component.html',
})
export class ReviewComponent implements OnInit {
  readonly api = inject(BackofficeApi);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);

  readonly STAGES = STAGES;
  readonly STAGE_LABEL = STAGE_LABEL;
  readonly SIGNATURE_STAGE_LABEL = SIGNATURE_STAGE_LABEL;
  readonly formatCOP = formatCOP;
  readonly formatDate = formatDate;
  readonly formatDateTime = formatDateTime;
  readonly formatRate = formatRate;
  readonly formatBytes = formatBytes;
  readonly initials = initials;
  readonly shortId = shortId;
  readonly titleCase = titleCase;

  processId = '';
  loading = signal(true);
  notFound = signal(false);
  error = signal<string | null>(null);
  process = signal<ProcessDetail | null>(null);
  owner = signal<AdminUser | null>(null);
  files = signal<Load<ProcessFile[]>>({ state: 'loading' });
  payments = signal<Load<ProcessPayments>>({ state: 'loading' });
  signature = signal<Load<SignatureReview> | null>(null);
  /** True when the full signature record failed and the public one was used instead. */
  signaturePartial = signal(false);

  manual = signal<Record<string, boolean>>({});
  override = signal(false);
  confirmOpen = signal(false);
  submitting = signal(false);
  decisionError = signal<string | null>(null);
  approved = signal<ProcessStage | null>(null);
  /** Document viewer popup: images in an <img>, PDFs in the browser's own viewer (an iframe). */
  lightbox = signal<{ url: string; title: string; kind: 'image' | 'pdf'; frame: SafeResourceUrl | null } | null>(null);

  // ---- derived -------------------------------------------------------------------

  readonly form = computed(() => (this.process()?.submitted_form ?? null) as Record<string, unknown> | null);
  readonly bank = computed(() => {
    const p = this.process();
    return p ? (this.api.banksById().get(p.bank_id) ?? null) : null;
  });
  readonly stageIndex = computed(() => STAGES.indexOf(this.process()?.stage ?? 'FORM'));
  readonly interest = computed(() => {
    const p = this.process();
    return p ? projectedInterest(p) : 0;
  });
  readonly applicantName = computed(() => {
    const f = this.form();
    const parts = [f?.['name'], f?.['second_name'], f?.['last_name'], f?.['second_last_name']].filter(Boolean);
    return parts.length ? titleCase(parts.join(' ')) : this.owner() ? titleCase(this.owner()!.full_name) : null;
  });

  /** The approval this process is waiting for, if any. */
  readonly step = computed(() => APPROVAL_STEPS.find((s) => s.stage === this.process()?.stage) ?? null);
  readonly manualChecks = computed(() => MANUAL_CHECKS[this.process()?.stage ?? 'FORM'] ?? []);

  readonly paymentList = computed(() => {
    const pay = this.payments();
    return pay.state === 'ok' ? pay.data.payments : [];
  });

  readonly paymentsSummary = computed(() => {
    const p = this.process();
    const pay = this.payments();
    if (!p || pay.state !== 'ok') return null;
    const paid = pay.data.total_paid;
    return { paid, amount: p.amount, diff: paid - p.amount };
  });

  readonly requiredTypes = computed(() => {
    const f = this.form();
    const types = ['BANK_CERT'];
    if (f?.['is_tax_declarant'] === true) types.push('TAX_DECLARATION');
    if (f?.['is_pep'] === true) types.push('RUT');
    return types;
  });

  readonly fileRows = computed<FileRow[]>(() => {
    const load = this.files();
    const files = load.state === 'ok' ? load.data : [];
    const byType = new Map<string, ProcessFile[]>();
    for (const f of files) byType.set(f.file_type, [...(byType.get(f.file_type) ?? []), f]);
    const required = this.requiredTypes();
    const order = [...required, ...[...byType.keys()].filter((t) => !required.includes(t))];
    return order.map((type) => {
      const list = byType.get(type) ?? [];
      return {
        type,
        label: FILE_TYPE_LABEL[type] ?? type,
        required: required.includes(type),
        generated: GENERATED_TYPES.has(type),
        file: list[0] ?? null,
        previous: Math.max(0, list.length - 1),
      };
    });
  });

  readonly signatureData = computed(() => {
    const s = this.signature();
    return s?.state === 'ok' ? s.data : null;
  });

  readonly evidences = computed(() => {
    const s = this.signatureData();
    if (!s || this.signaturePartial()) return [];
    return [
      { id: 'ID_FRONT', title: 'Documento · frente', url: s.evidences.ID_FRONT },
      { id: 'ID_BACK', title: 'Documento · reverso', url: s.evidences.ID_BACK },
      { id: 'FACE', title: 'Rostro', url: s.evidences.FACE },
      { id: 'DRAW', title: 'Firma dibujada', url: s.draw_url },
    ];
  });

  readonly checks = computed<Check[]>(() => {
    const p = this.process();
    if (!p) return [];
    const checks: Check[] = [];

    const pay = this.payments();
    const sum = this.paymentsSummary();
    checks.push({
      id: 'payments',
      label: 'Los pagos cubren el monto',
      status: pay.state === 'loading' ? 'pending' : !sum ? 'unknown' : sum.diff >= -0.5 ? 'ok' : 'fail',
      detail: sum ? `${formatCOP(sum.paid)} de ${formatCOP(sum.amount)}` : pay.state === 'error' ? 'No se pudieron consultar' : '',
    });

    const files = this.files();
    const missing = this.fileRows().filter((r) => r.required && !r.file);
    checks.push({
      id: 'documents',
      label: 'Documentos requeridos completos',
      status: files.state === 'loading' ? 'pending' : files.state === 'error' ? 'unknown' : missing.length ? 'fail' : 'ok',
      detail:
        files.state === 'error'
          ? 'No se pudieron consultar'
          : missing.length
            ? `Falta: ${missing.map((m) => m.label).join(', ')}`
            : `${this.requiredTypes().length} de ${this.requiredTypes().length}`,
    });

    const sig = this.signature();
    const sd = this.signatureData();
    checks.push({
      id: 'signature',
      label: 'Orden de inversión firmada',
      status: !p.signature_id ? 'fail' : !sig || sig.state === 'loading' ? 'pending' : !sd ? 'unknown' : sd.stage === 'SIGNED' && sd.signed_url ? 'ok' : 'fail',
      detail: !p.signature_id
        ? 'Sin firma generada'
        : sd
          ? sd.signed_at
            ? `Firmada ${formatDateTime(sd.signed_at)}`
            : SIGNATURE_STAGE_LABEL[sd.stage] ?? sd.stage
          : sig?.state === 'error'
            ? 'No se pudo consultar'
            : '',
    });

    if (sd && !this.signaturePartial()) {
      const got = [sd.evidences.ID_FRONT, sd.evidences.ID_BACK, sd.evidences.FACE].filter(Boolean).length;
      checks.push({
        id: 'evidences',
        label: 'Evidencias de identidad',
        status: got === 3 ? 'ok' : 'fail',
        detail: `${got} de 3 fotos`,
      });
      const formEmail = String(this.form()?.['email'] ?? '').trim().toLowerCase();
      const signEmail = (sd.email ?? '').trim().toLowerCase();
      checks.push({
        id: 'email',
        label: 'Correo de la firma = correo del formulario',
        status: !formEmail || !signEmail ? 'unknown' : formEmail === signEmail ? 'ok' : 'fail',
        detail: signEmail || 'Sin correo en la firma',
      });
    } else if (sd && this.signaturePartial()) {
      checks.push({ id: 'evidences', label: 'Evidencias de identidad', status: 'unknown', detail: 'Expediente de firma no disponible' });
    }
    return checks;
  });

  readonly failures = computed(() => this.checks().filter((c) => c.status === 'fail' || c.status === 'unknown'));
  readonly dataReady = computed(
    () =>
      !!this.process() &&
      this.files().state === 'ok' &&
      this.payments().state === 'ok' &&
      (!this.process()!.signature_id || this.signature()?.state === 'ok'),
  );
  readonly manualDone = computed(() => this.manualChecks().every((m) => this.manual()[m.id]));
  readonly canApprove = computed(
    () =>
      !!this.step() &&
      !this.approved() &&
      this.dataReady() &&
      this.manualDone() &&
      (this.failures().length === 0 || this.override()) &&
      !this.submitting(),
  );

  // ---- lifecycle -----------------------------------------------------------------

  ngOnInit(): void {
    this.api.loadBanks();
    this.processId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadProcess();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightbox()) this.lightbox.set(null);
    else if (this.confirmOpen() && !this.submitting()) this.confirmOpen.set(false);
  }

  // ---- actions -------------------------------------------------------------------

  toggleManual(id: string, value: boolean): void {
    this.manual.update((m) => ({ ...m, [id]: value }));
  }

  openConfirm(): void {
    if (!this.canApprove()) return;
    this.decisionError.set(null);
    this.confirmOpen.set(true);
  }

  approve(): void {
    const p = this.process();
    const step = this.step();
    if (!p || !step || this.submitting()) return;
    this.submitting.set(true);
    this.decisionError.set(null);
    const call = step.stage === 'REVIEW' ? this.api.sendToBank(p.id) : this.api.approveCdt(p.id);
    call.subscribe({
      next: (r) => {
        this.submitting.set(false);
        this.confirmOpen.set(false);
        this.approved.set(r.stage);
        this.process.set({ ...p, stage: r.stage });
        this.manual.set({});
        this.override.set(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        const code = err.error?.error as string | undefined;
        this.decisionError.set(
          err.status === 409 || code?.startsWith('process_not_in_')
            ? 'Este proceso ya no está en este paso: otra persona pudo aprobarlo. Recarga la página para ver su estado actual.'
            : 'No pudimos registrar la aprobación. Intenta de nuevo en unos segundos.',
        );
      },
    });
  }

  reload(): void {
    this.approved.set(null);
    this.confirmOpen.set(false);
    this.decisionError.set(null);
    this.error.set(null);
    this.loading.set(true);
    this.loadProcess();
  }

  open(url: string | null, title: string, isImage = false): void {
    if (!url) return;
    // The URL is a presigned link our own backend just issued, so it is trusted for the frame.
    this.lightbox.set({
      url,
      title,
      kind: isImage ? 'image' : 'pdf',
      frame: isImage ? null : this.sanitizer.bypassSecurityTrustResourceUrl(url),
    });
  }

  isImage(file: { content_type?: string | null; s3_file?: string | null; original_name?: string | null }): boolean {
    const name = (file.s3_file ?? file.original_name ?? '').toLowerCase();
    return (file.content_type ?? '').startsWith('image/') || /\.(png|jpe?g|webp)$/.test(name);
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- data ----------------------------------------------------------------------

  private loadProcess(): void {
    this.api.getProcess(this.processId).subscribe({
      next: ({ process }) => {
        this.process.set(process);
        this.loading.set(false);
        this.loadRelated(process);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        if (err.status === 404 || err.status === 400) this.notFound.set(true);
        else this.error.set('No pudimos cargar el proceso. Intenta de nuevo.');
      },
    });
  }

  private loadRelated(p: ProcessDetail): void {
    this.api.getUser(p.user_id).subscribe({ next: ({ user }) => this.owner.set(user), error: () => undefined });

    this.files.set({ state: 'loading' });
    this.api.processFiles(p.id).subscribe({
      next: (r) => this.files.set({ state: 'ok', data: r.files }),
      error: () => this.files.set({ state: 'error', message: 'No pudimos consultar los documentos del proceso.' }),
    });

    this.payments.set({ state: 'loading' });
    this.api.processPayments(p.id).subscribe({
      next: (r) => this.payments.set({ state: 'ok', data: r }),
      error: () => this.payments.set({ state: 'error', message: 'No pudimos consultar los pagos del proceso.' }),
    });

    if (!p.signature_id) {
      this.signature.set(null);
      return;
    }
    this.signature.set({ state: 'loading' });
    this.signaturePartial.set(false);
    const signatureId = p.signature_id;
    this.api.signatureReview(signatureId).subscribe({
      next: (r) => this.signature.set({ state: 'ok', data: r }),
      // Fallback: the public record (no evidences, telemetry or e-mail).
      error: () => this.loadPublicSignature(signatureId),
    });
  }

  private loadPublicSignature(signatureId: string): void {
    this.http
      .get<Omit<SignatureReview, 'signatory' | 'email' | 'otp_tries' | 'telemetry' | 'draw_url' | 'evidences' | 'created_at'>>(
        `${shared.signaturesApiUrl}/signatures/get-signature`,
        { params: new HttpParams().set('signature_id', signatureId) },
      )
      .subscribe({
        next: (r) => {
          this.signaturePartial.set(true);
          this.signature.set({
            state: 'ok',
            data: {
              ...r,
              signatory: null,
              email: null,
              created_at: '',
              otp_tries: 0,
              telemetry: { ip: null, user_agent: null, accept_language: null, resolved_at: null },
              draw_url: null,
              evidences: { ID_FRONT: null, ID_BACK: null, FACE: null },
            },
          });
        },
        error: () => this.signature.set({ state: 'error', message: 'No pudimos consultar la firma del proceso.' }),
      });
  }
}
