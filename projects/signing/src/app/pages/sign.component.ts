import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import {
  HOST_RETURN_LABEL,
  HOST_STANDALONE_DONE_LABEL,
  RETURN_URL_QUERY_PARAM,
  resolveReturnUrl,
} from '../core/host-app';
import {
  Ceremony,
  CeremonyStage,
  EVIDENCE_API_TO_ORM,
  EvidenceTypeApi,
  SignaturesService,
} from '../core/signatures.service';
import { CameraCaptureComponent, CameraMode } from './sign/camera-capture.component';
import { PdfPreviewComponent } from './sign/pdf-preview.component';
import { SignaturePadComponent } from './sign/signature-pad.component';

/**
 * Local UI step (what the wizard is CURRENTLY showing). This does NOT
 * match `CeremonyStage` 1:1: the backend stage machine splits
 * 'consent' out from OTP, but Fase 10b keeps the old five-step layout
 * (review -> identity -> drawing -> otp -> done) and treats consent as
 * a silent server call slipped in before requesting the OTP. Fase 10c
 * will introduce a proper consent screen + a dedicated
 * "waiting for signature" screen (stage='signing').
 */
type Step = 'review' | 'identity' | 'drawing' | 'otp' | 'done';

interface StepDef {
  key: Step;
  label: string;
  icon: string;
}

const STEPS: StepDef[] = [
  { key: 'review', label: 'Revision', icon: 'bi-file-earmark-text' },
  { key: 'identity', label: 'Identidad', icon: 'bi-person-badge' },
  { key: 'drawing', label: 'Firma', icon: 'bi-vector-pen' },
  { key: 'otp', label: 'Codigo', icon: 'bi-envelope-check' },
];

interface DocDef {
  /** API-facing evidence type. Also used as the key in `docDone`. */
  type: EvidenceTypeApi;
  label: string;
  short: string;
  hint: string;
  icon: string;
  mode: CameraMode;
}

const DOCS: DocDef[] = [
  {
    type: 'id_front',
    label: 'Documento - cara frontal',
    short: 'Frontal',
    hint: 'Centra el frente de tu documento dentro del recuadro',
    icon: 'bi-person-vcard',
    mode: 'document',
  },
  {
    type: 'id_back',
    label: 'Documento - cara posterior',
    short: 'Posterior',
    hint: 'Ahora la cara posterior, que se lea el codigo',
    icon: 'bi-person-vcard-fill',
    mode: 'document',
  },
  {
    type: 'face',
    label: 'Foto de tu rostro',
    short: 'Tu rostro',
    hint: 'Ubica tu rostro dentro del ovalo, con buena luz',
    icon: 'bi-emoji-smile',
    mode: 'face',
  },
];

// Local-step rank vs server-stage rank. Used only to detect "server
// jumped ahead" during polling. Kept private to this file.
const STEP_RANK: Record<Step, number> = {
  review: 0,
  identity: 1,
  drawing: 2,
  otp: 3,
  done: 4,
};

/** Maps a v2 CeremonyStage to the equivalent UI Step. Terminal stages
 *  and the transient 'signing' stage collapse to 'done' / 'otp' for
 *  now; Fase 10c introduces a real waiting screen. */
function stageToStep(stage: CeremonyStage): Step {
  switch (stage) {
    case 'created':
      return 'review';
    case 'identity':
      return 'identity';
    case 'consent':
      // Backend split: after uploads are validated the server sits at
      // 'consent' waiting for the checkbox. Fase 10b UX skips straight
      // to the drawing step and consent gets recorded silently just
      // before OTP.
      return 'drawing';
    case 'otp':
      return 'otp';
    case 'signing':
      // Async sign worker is running. Fase 10c will show a dedicated
      // "firmando..." screen; for now we keep the OTP screen visible
      // with the spinner (visible via `busy()` signal).
      return 'otp';
    case 'signed':
      return 'done';
    case 'failed':
    case 'expired':
      // Terminal-with-error stages: leave the current step in place so
      // the error alert shown up top has context. `notFound()` handles
      // the empty-state fallback.
      return 'done';
  }
}

const STAGE_RANK: Record<CeremonyStage, number> = {
  created: 0,
  identity: 1,
  consent: 2,
  otp: 3,
  signing: 4,
  signed: 5,
  failed: 5,
  expired: 5,
};

/** How often we poll GET /signatures/{sign_id} for stage changes. */
const POLL_INTERVAL_MS = 4000;

/** Upper bound while waiting for the async sign worker after OTP. If
 *  we hit this without a 'signed' transition, we surface an error and
 *  let the user retry. */
const WAIT_FOR_SIGNED_TIMEOUT_MS = 120_000;

@Component({
  selector: 'app-sign',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CameraCaptureComponent,
    PdfPreviewComponent,
    SignaturePadComponent,
  ],
  templateUrl: './sign.component.html',
})
export class SignComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private api = inject(SignaturesService);

  @ViewChild(CameraCaptureComponent) camera?: CameraCaptureComponent;

  readonly STEPS = STEPS;
  readonly DOCS = DOCS;
  readonly HOST_RETURN_LABEL = HOST_RETURN_LABEL;
  readonly HOST_STANDALONE_DONE_LABEL = HOST_STANDALONE_DONE_LABEL;

  signId = '';
  /** Origin-checked return URL from `?return_url=`. Null when the
   *  signer arrived via the email path. */
  returnUrl: string | null = null;

  ceremony = signal<Ceremony | null>(null);
  notFound = signal(false);
  step = signal<Step>('review');
  error = signal('');
  busy = signal(false);
  uploadBusy = signal(false);

  docDone = signal<Record<EvidenceTypeApi, boolean>>({
    id_front: false,
    id_back: false,
    face: false,
    signature_drawing: false,
  });
  currentDoc = signal<EvidenceTypeApi | ''>('');

  signatureBlob: Blob | null = null;
  otp = '';
  otpSent = signal(false);
  /** Filled from `_debug_otp` when the backend HMAC hatch is enabled.
   *  Never set in prod builds. */
  devOtp = signal('');
  signedPdfUrl = signal('');
  docHash = signal('');

  readonly stepIndex = computed(() =>
    STEPS.findIndex((s) => s.key === this.step()),
  );
  readonly activeDoc = computed(
    () => DOCS.find((d) => d.type === this.currentDoc()) ?? null,
  );
  readonly allDocsDone = computed(() => {
    const d = this.docDone();
    return d.id_front && d.id_back && d.face;
  });

  private poll: number | null = null;
  private waitStartedAt: number | null = null;

  ngOnInit(): void {
    // ActivatedRoute reuses this component across sign_ids, so we
    // read the param stream rather than the snapshot.
    this.route.paramMap.subscribe((params) => {
      this.signId = params.get('sign_id') ?? '';
      this.load();
    });
    this.returnUrl = resolveReturnUrl(
      this.route.snapshot.queryParamMap.get(RETURN_URL_QUERY_PARAM),
    );
  }

  private load(): void {
    this.notFound.set(false);
    this.ceremony.set(null);
    if (!this.signId) {
      this.notFound.set(true);
      return;
    }
    this.api.get(this.signId).subscribe({
      next: (c) => {
        this.apply(c);
        this.step.set(stageToStep(c.stage));
        if (c.stage === 'otp') this.otpSent.set(true);
        if (c.signed_pdf_url) this.signedPdfUrl.set(c.signed_pdf_url);
        if (c.hash_signed) this.docHash.set(c.hash_signed);
        // Kick off the poll timer only after the first successful load.
        if (this.poll === null) {
          this.poll = window.setInterval(
            () => this.sync(),
            POLL_INTERVAL_MS,
          );
        }
      },
      error: () => this.notFound.set(true),
    });
  }

  ngOnDestroy(): void {
    if (this.poll !== null) window.clearInterval(this.poll);
  }

  private apply(c: Ceremony): void {
    this.ceremony.set(c);
    // uploads_state uses ORM keys; docDone uses API keys. Translate
    // through EVIDENCE_API_TO_ORM.
    const done: Record<EvidenceTypeApi, boolean> = {
      id_front: false,
      id_back: false,
      face: false,
      signature_drawing: false,
    };
    for (const [apiKey, ormKey] of Object.entries(EVIDENCE_API_TO_ORM) as [
      EvidenceTypeApi,
      keyof typeof c.uploads_state,
    ][]) {
      const state = c.uploads_state?.[ormKey];
      if (!state) continue;
      // For the three biometrics, `validated` is the source of truth;
      // just being uploaded doesn't count. The signature drawing has
      // no validation step (`validated === null`), so we fall back to
      // `uploaded`.
      done[apiKey] = state.validated === null
        ? state.uploaded
        : state.validated === true;
    }
    this.docDone.set(done);
    this.currentDoc.set(this.nextPendingDoc());
  }

  private nextPendingDoc(): EvidenceTypeApi | '' {
    const done = this.docDone();
    return DOCS.find((d) => !done[d.type])?.type ?? '';
  }

  private sync(): void {
    if (
      this.notFound() ||
      this.busy() ||
      this.uploadBusy() ||
      this.step() === 'done'
    ) {
      return;
    }
    this.api.get(this.signId).subscribe({
      next: (c) => {
        this.apply(c);
        if (this.step() === 'identity' && !this.currentDoc()) {
          this.currentDoc.set(this.nextPendingDoc());
        }
        if (STAGE_RANK[c.stage] > STEP_RANK[this.step()]) {
          if (c.stage === 'signed') {
            this.finishToDone(c);
          } else if (c.stage === 'failed' || c.stage === 'expired') {
            this.error.set(
              c.stage === 'expired'
                ? 'La firma expiró. Solicita un enlace nuevo.'
                : 'La firma falló. Intenta nuevamente o contacta soporte.',
            );
          } else {
            this.step.set(stageToStep(c.stage));
            if (c.stage === 'otp') this.otpSent.set(true);
          }
        }
        // If we entered the "waiting after OTP" phase, enforce timeout.
        if (
          this.waitStartedAt !== null &&
          c.stage !== 'signed' &&
          Date.now() - this.waitStartedAt > WAIT_FOR_SIGNED_TIMEOUT_MS
        ) {
          this.waitStartedAt = null;
          this.error.set(
            'La firma está demorando más de lo esperado. Recarga la página en un minuto.',
          );
        }
      },
      error: () => {
        /* transient; the next tick retries */
      },
    });
  }

  goToIdentity(): void {
    this.step.set('identity');
    this.currentDoc.set(this.nextPendingDoc());
  }

  pickDoc(type: EvidenceTypeApi): void {
    if (this.uploadBusy()) return;
    this.currentDoc.set(type);
  }

  onCaptured(blob: Blob): void {
    const type = this.currentDoc();
    if (!type || this.uploadBusy()) return;
    this.uploadBusy.set(true);
    this.error.set('');

    this.api.uploadEvidence(this.signId, type, blob, 'image/jpeg').subscribe({
      next: () => {
        // Each evidence type has its own validate endpoint. The drawn
        // signature is dispatched via `submitSignature`, so we only
        // hit id-front / id-back / face here.
        const validate$ =
          type === 'id_front'
            ? this.api.validateIdSide(this.signId, 'front')
            : type === 'id_back'
              ? this.api.validateIdSide(this.signId, 'back')
              : type === 'face'
                ? this.api.validateFace(this.signId)
                : null;
        if (!validate$) {
          this.uploadBusy.set(false);
          return;
        }
        validate$.subscribe({
          next: () => {
            this.uploadBusy.set(false);
            this.docDone.update((d) => ({ ...d, [type]: true }));
            this.currentDoc.set(this.nextPendingDoc());
            this.camera?.reset();
          },
          error: (err) => {
            this.uploadBusy.set(false);
            this.docDone.update((d) => ({ ...d, [type]: false }));
            this.error.set(this.friendlyValidateError(err?.error?.error));
            this.camera?.reset();
          },
        });
      },
      error: () => {
        this.uploadBusy.set(false);
        this.error.set('No pudimos subir la foto. Revisa tu conexion.');
      },
    });
  }

  submitSignature(): void {
    if (!this.signatureBlob || this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    // Upload the PNG, then register it (advances stage to 'consent'
    // once the biometric evidences are also validated), then silently
    // record consent, then request the OTP.
    this.api
      .uploadEvidence(
        this.signId,
        'signature_drawing',
        this.signatureBlob,
        'image/png',
      )
      .subscribe({
        next: () => {
          this.api.registerSignature(this.signId).subscribe({
            next: () => this.acceptConsentAndSendOtp(),
            error: () => {
              this.busy.set(false);
              this.error.set(
                'No pudimos guardar tu firma. Intenta de nuevo.',
              );
            },
          });
        },
        error: () => {
          this.busy.set(false);
          this.error.set('No pudimos guardar tu firma. Intenta de nuevo.');
        },
      });
  }

  /** Fase 10b shim: records consent silently before the OTP. Fase 10c
   *  replaces this with a real consent screen; for now we log to the
   *  console so the audit trail is visible during dev testing. */
  private acceptConsentAndSendOtp(): void {
    this.api.consent(this.signId, 'v1.0').subscribe({
      next: () => this.sendOtp(),
      error: () => {
        this.busy.set(false);
        this.error.set(
          'No pudimos registrar tu aceptacion. Intenta de nuevo.',
        );
      },
    });
  }

  sendOtp(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.requestOtp(this.signId).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.otpSent.set(true);
        this.devOtp.set(r._debug_otp ?? '');
        this.step.set('otp');
      },
      error: () => {
        this.busy.set(false);
        this.error.set('No pudimos enviar el codigo. Intenta de nuevo.');
      },
    });
  }

  confirm(): void {
    if (this.otp.length !== 6 || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.verifyOtp(this.signId, this.otp).subscribe({
      next: () => {
        // Stage is now 'signing'. The async worker will move it to
        // 'signed'; the poll loop picks that up and calls
        // finishToDone(). We stay on the OTP screen with busy=true
        // to render the spinner. Fase 10c introduces a real waiting
        // screen.
        this.waitStartedAt = Date.now();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.friendlyOtpError(err?.error?.error));
      },
    });
  }

  private finishToDone(c: Ceremony): void {
    this.busy.set(false);
    this.waitStartedAt = null;
    if (c.signed_pdf_url) this.signedPdfUrl.set(c.signed_pdf_url);
    if (c.hash_signed) this.docHash.set(c.hash_signed);
    this.step.set('done');
  }

  backToProcess(): void {
    if (this.returnUrl) {
      window.location.assign(this.returnUrl);
    }
    // No return URL -> generic completion screen already visible, no
    // navigation needed. The button is hidden in that case (see html).
  }

  private friendlyValidateError(code: string | undefined): string {
    switch (code) {
      case 'evidence_missing':
        return 'No recibimos la foto. Intentalo de nuevo.';
      case 'face_invalid_eyes_closed':
        return 'Abre bien los ojos y toma la foto nuevamente.';
      case 'face_invalid_no_face':
        return 'No detectamos tu rostro. Acerca la camara.';
      case 'face_invalid_multiple_faces':
        return 'Solo debe aparecer una persona en la foto.';
      case 'id_invalid_no_text':
      case 'id_invalid_low_confidence':
        return 'La foto del documento no es legible. Intentala con mas luz.';
      default:
        return 'No pudimos validar la foto. Tomala de nuevo con buena luz.';
    }
  }

  private friendlyOtpError(code: string | undefined): string {
    if (code === 'otp_invalid') return 'Codigo incorrecto. Intenta de nuevo.';
    switch (code) {
      case 'otp_expired':
        return 'El codigo vencio. Pide uno nuevo.';
      case 'otp_max_attempts':
        return 'Demasiados intentos. Recarga la pagina para reintentar.';
      case 'stage_not_allowed_current_otp':
      case 'stage_not_allowed_current_signing':
        return 'Este codigo ya fue usado. Recarga la pagina.';
      default:
        return 'No pudimos confirmar la firma. Intenta de nuevo.';
    }
  }
}
