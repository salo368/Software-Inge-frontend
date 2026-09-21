/**
 * Signing SPA wizard, driven by the v2 signatures backend.
 *
 * The component is a thin controller around a state machine derived from
 * the server-side `Ceremony.stage`. Server is authoritative: on every
 * poll tick we recompute which screen to show. The only local override
 * is a `reviewAcknowledged` flag that keeps the introduction screen
 * visible until the signer explicitly clicks Continue (otherwise a fresh
 * ceremony with `stage='created'` would immediately jump to the camera).
 *
 * Screens
 * -------
 *
 *   review     One-shot intro before anything is uploaded. Shows the
 *              PDF preview with the signature location highlighted.
 *              Local-only: dismissed once the user clicks Continue OR
 *              when the ceremony already has any uploaded evidence
 *              (page refresh in the middle of the flow).
 *
 *   identity   Biometric captures. Chip picker + camera; each capture
 *              uploads to S3 then validates via Rekognition/Textract.
 *              Stays visible while any of the 3 evidences is not
 *              validated. The backend keeps stage='identity' the whole
 *              time.
 *
 *   signature  Draw the ink signature. Reached once the 3 biometrics
 *              are validated AND the signature PNG hasn't been uploaded
 *              yet. Backend stage is still 'identity' at this point --
 *              `resolved_stage()` only advances to 'consent' when the
 *              4th evidence (drawn signature) is registered.
 *
 *   consent    Explicit terms + checkbox. The Fase 10b shim recorded
 *              consent silently before OTP; this screen fixes it. Only
 *              after the user checks the box and clicks Continue do we
 *              POST /consent AND then chain POST /otp so the code is
 *              already in flight when the OTP screen mounts.
 *
 *   otp        Six-digit code entry. If the OTP was requested but the
 *              user refreshed and it's still valid, we don't auto-resend.
 *              Otherwise we auto-request on mount for a snappy UX.
 *
 *   signing    Dedicated waiting screen after verify_otp. The async sign
 *              Lambda takes 30-90s (cold start + pyhanko). Kept polling
 *              at a faster cadence here for perceived responsiveness.
 *              Bounded by WAIT_FOR_SIGNED_TIMEOUT_MS; on timeout we show
 *              a soft error suggesting a reload.
 *
 *   done       Terminal success. Hash, download link, return button.
 *
 *   failed     Terminal error. No retry -- the ceremony is dead and the
 *              signer must ask the portal to open a new one. We surface
 *              the returnUrl (if present) as "back to portal" instead
 *              of a "retry" affordance.
 *
 *   expired    Terminal error (TTL). Same recovery guidance as failed.
 *
 * Polling strategy
 * ----------------
 *
 * A single interval loop. Faster tick while `stage='signing'` so the
 * transition to `signed` feels immediate. Skipped when the user is in
 * the middle of an interaction (uploading, verifying, requesting OTP)
 * to avoid a stale server-side view stomping on optimistic local
 * state.
 */

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
  EvidenceTypeApi,
  SignaturesService,
  TERMINAL_STAGES,
} from '../core/signatures.service';
import { CameraCaptureComponent, CameraMode } from './sign/camera-capture.component';
import { PdfPreviewComponent } from './sign/pdf-preview.component';
import { SignaturePadComponent } from './sign/signature-pad.component';

// ---------------------------------------------------------------------------
// Wizard screens. Not 1:1 with backend CeremonyStage: `identity` in the
// backend covers both biometric photos and the drawn signature, but the
// UI splits them into two screens; `created` maps to a local-only intro
// screen; terminal stages get dedicated screens for error recovery UX.
// ---------------------------------------------------------------------------

type Screen =
  | 'review'
  | 'identity'
  | 'signature'
  | 'consent'
  | 'otp'
  | 'signing'
  | 'done'
  | 'failed'
  | 'expired';

interface StepDef {
  key: Extract<Screen, 'review' | 'identity' | 'signature' | 'consent' | 'otp'>;
  label: string;
  icon: string;
}

/** The 5 interactive screens shown in the stepper. Terminal + waiting
 *  screens are intentionally omitted. */
const STEPS: StepDef[] = [
  { key: 'review',    label: 'Revision',  icon: 'bi-file-earmark-text' },
  { key: 'identity',  label: 'Identidad', icon: 'bi-person-badge' },
  { key: 'signature', label: 'Firma',     icon: 'bi-vector-pen' },
  { key: 'consent',   label: 'Terminos',  icon: 'bi-clipboard-check' },
  { key: 'otp',       label: 'Codigo',    icon: 'bi-envelope-check' },
];

/** Rank a screen for "server has advanced past this UI position?"
 *  comparisons. Terminal screens sit at the far end and short-circuit
 *  the check via TERMINAL_STAGES on the ceremony side. */
const SCREEN_RANK: Record<Screen, number> = {
  review: 0,
  identity: 1,
  signature: 2,
  consent: 3,
  otp: 4,
  signing: 5,
  done: 6,
  failed: 6,
  expired: 6,
};

interface DocDef {
  /** API-facing evidence type (what POST /upload-url accepts). */
  type: Extract<EvidenceTypeApi, 'id_front' | 'id_back' | 'face'>;
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

/** Terms text shown on the consent screen. Kept intentionally simple
 *  and in Spanish; the version string must match `_KNOWN_TERMS_VERSIONS`
 *  in backend/services/signatures/src/handlers/consent/handler.py. */
const TERMS_VERSION = 'v1.0';
const TERMS_BULLETS: readonly string[] = [
  'He revisado el documento y su contenido refleja mi voluntad de firmarlo.',
  'Autorizo el uso de mi firma electronica sobre este documento, con el mismo valor legal que una firma manuscrita (Ley 527 de 1999).',
  'Autorizo la conservacion de mis fotografias de identificacion, mi rostro y esta ceremonia como evidencia de autoria.',
  'Entiendo que el codigo que llegara a mi correo es personal y no debo compartirlo.',
];

/** Poll cadence for GET /signatures/{sign_id}. Faster while the async
 *  sign worker is running so the 'signed' transition feels instant. */
const POLL_INTERVAL_MS = 4000;
const POLL_INTERVAL_MS_WHILE_SIGNING = 2000;

/** Upper bound while waiting for the async sign worker after OTP. Real
 *  worker time is 30-90s; giving 3 min of grace covers cold starts on a
 *  quiet dev environment. */
const WAIT_FOR_SIGNED_TIMEOUT_MS = 180_000;

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
  readonly TERMS_VERSION = TERMS_VERSION;
  readonly TERMS_BULLETS = TERMS_BULLETS;
  readonly HOST_RETURN_LABEL = HOST_RETURN_LABEL;
  readonly HOST_STANDALONE_DONE_LABEL = HOST_STANDALONE_DONE_LABEL;

  // -------------------------------------------------------------------------
  // URL-derived state
  // -------------------------------------------------------------------------

  signId = '';
  /** Same-origin `?return_url=` value, or null when the signer arrived
   *  via the email path. Used by all terminal screens for the CTA. */
  returnUrl: string | null = null;

  // -------------------------------------------------------------------------
  // Ceremony + UI state
  // -------------------------------------------------------------------------

  ceremony = signal<Ceremony | null>(null);
  /** True when the initial GET returned 404 / malformed. Renders a
   *  dedicated missing-link screen instead of the wizard. */
  notFound = signal(false);
  /** Local-only: the signer clicked "Continue" on the review screen.
   *  Without this, a fresh `stage='created'` ceremony would render the
   *  camera immediately. */
  reviewAcknowledged = signal(false);
  /** Global inline error (dismissible; auto-cleared on the next successful
   *  action). Terminal errors are surfaced via the failed/expired screens
   *  instead. */
  error = signal('');
  /** True while a POST/PUT is in flight. Suppresses polling to avoid
   *  optimistic UI being clobbered. */
  busy = signal(false);
  /** True while an evidence upload+validate is in flight. Separate from
   *  `busy` so the two can coexist (e.g., resend OTP while a photo is
   *  still uploading is disallowed, but the camera stays interactive). */
  uploadBusy = signal(false);

  currentDoc = signal<EvidenceTypeApi | ''>('');
  signatureBlob: Blob | null = null;

  otp = '';
  /** True once we know an OTP is in flight for this ceremony (either the
   *  server told us so on load, or we requested it ourselves). */
  otpSent = signal(false);
  /** Filled from `_debug_otp` when the backend HMAC hatch is enabled.
   *  Never populated in prod builds -- the SPA never sends the debug
   *  HMAC header on its own. */
  devOtp = signal('');

  /** Set to true when the user ticks the consent checkbox. Only used on
   *  the consent screen. */
  consentChecked = signal(false);

  // -------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------

  private poll: number | null = null;
  private pollIntervalMs = POLL_INTERVAL_MS;
  /** Wall-clock start of the "wait for signed" phase. Used to enforce
   *  WAIT_FOR_SIGNED_TIMEOUT_MS on the signing screen. */
  private waitStartedAt: number | null = null;

  // -------------------------------------------------------------------------
  // Derived screen -- server-authoritative with a local review override.
  // -------------------------------------------------------------------------

  readonly screen = computed<Screen>(() => {
    const c = this.ceremony();
    // Pre-load / not-found paths are rendered elsewhere; this method
    // only runs when a ceremony is set.
    if (!c) return 'review';

    // Terminal stages take precedence.
    if (c.stage === 'failed') return 'failed';
    if (c.stage === 'expired') return 'expired';
    if (c.stage === 'signed') return 'done';
    if (c.stage === 'signing') return 'signing';

    // Interactive stages.
    if (c.stage === 'otp') return 'otp';
    if (c.stage === 'consent') return 'consent';

    // 'created' or 'identity'. Decide between review / identity / signature.
    const uploads = c.uploads_state;
    const anyUploaded =
      uploads.id_front.uploaded ||
      uploads.id_back.uploaded ||
      uploads.face.uploaded ||
      uploads.signature.uploaded;

    // Review is a local-only screen. Show it iff the ceremony is fresh
    // AND the user hasn't dismissed it AND nothing has been uploaded
    // yet. On refresh mid-flow we always skip it.
    if (
      c.stage === 'created' &&
      !anyUploaded &&
      !this.reviewAcknowledged()
    ) {
      return 'review';
    }

    // Signature pad screen: 3 biometrics validated AND signature not
    // uploaded yet. Otherwise stay on identity.
    const biometricsDone =
      uploads.id_front.validated === true &&
      uploads.id_back.validated === true &&
      uploads.face.validated === true;
    if (biometricsDone && !uploads.signature.uploaded) return 'signature';

    return 'identity';
  });

  readonly stepIndex = computed(() => {
    const s = this.screen();
    return STEPS.findIndex((step) => step.key === s);
  });

  readonly showStepper = computed(() => {
    const s = this.screen();
    return s !== 'signing' && s !== 'done' && s !== 'failed' && s !== 'expired';
  });

  readonly docDone = computed(() => {
    const c = this.ceremony();
    return {
      id_front: c?.uploads_state.id_front.validated === true,
      id_back: c?.uploads_state.id_back.validated === true,
      face: c?.uploads_state.face.validated === true,
    };
  });

  readonly allBiometricsDone = computed(() => {
    const d = this.docDone();
    return d.id_front && d.id_back && d.face;
  });

  readonly activeDoc = computed(() => {
    const cd = this.currentDoc();
    if (cd === 'id_front' || cd === 'id_back' || cd === 'face') {
      return DOCS.find((d) => d.type === cd) ?? null;
    }
    return null;
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  ngOnInit(): void {
    // ActivatedRoute reuses this component across sign_ids, so we
    // subscribe to the param stream rather than reading the snapshot
    // once.
    this.route.paramMap.subscribe((params) => {
      this.signId = params.get('sign_id') ?? '';
      this.load();
    });
    this.returnUrl = resolveReturnUrl(
      this.route.snapshot.queryParamMap.get(RETURN_URL_QUERY_PARAM),
    );
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // -------------------------------------------------------------------------
  // Ceremony fetch + polling
  // -------------------------------------------------------------------------

  private load(): void {
    this.notFound.set(false);
    this.ceremony.set(null);
    this.reviewAcknowledged.set(false);
    this.consentChecked.set(false);
    if (!this.signId) {
      this.notFound.set(true);
      return;
    }
    this.api.get(this.signId).subscribe({
      next: (c) => {
        this.applyCeremony(c);
        this.startPolling();
      },
      error: () => this.notFound.set(true),
    });
  }

  private applyCeremony(c: Ceremony): void {
    this.ceremony.set(c);
    // Preselect the first pending biometric if we land on the identity
    // screen with none selected.
    if (
      this.screen() === 'identity' &&
      !this.currentDoc()
    ) {
      this.currentDoc.set(this.nextPendingBiometric());
    }
    // Reflect server-observed OTP state so we don't auto-resend on
    // refresh when a code is already live.
    if (c.otp.requested) this.otpSent.set(true);
    // Terminal / signing: manage the wait timer.
    if (c.stage === 'signing') {
      if (this.waitStartedAt === null) this.waitStartedAt = Date.now();
    } else {
      this.waitStartedAt = null;
    }
  }

  private nextPendingBiometric(): EvidenceTypeApi | '' {
    const done = this.docDone();
    return DOCS.find((d) => !done[d.type])?.type ?? '';
  }

  private startPolling(): void {
    if (this.poll !== null) return;
    this.scheduleNextPoll();
  }

  private stopPolling(): void {
    if (this.poll !== null) {
      window.clearTimeout(this.poll);
      this.poll = null;
    }
  }

  private scheduleNextPoll(): void {
    const c = this.ceremony();
    if (c && (TERMINAL_STAGES as readonly string[]).includes(c.stage)) {
      // Terminal: no more work to do; save the runner some CPU.
      this.stopPolling();
      return;
    }
    this.pollIntervalMs =
      c?.stage === 'signing'
        ? POLL_INTERVAL_MS_WHILE_SIGNING
        : POLL_INTERVAL_MS;
    this.poll = window.setTimeout(() => this.tick(), this.pollIntervalMs);
  }

  private tick(): void {
    this.poll = null;
    if (this.busy() || this.uploadBusy()) {
      // Don't step on an in-flight interaction; try again on the next
      // scheduled tick.
      this.scheduleNextPoll();
      return;
    }
    this.api.get(this.signId).subscribe({
      next: (c) => {
        this.applyCeremony(c);
        // Signing timeout guard.
        if (
          c.stage === 'signing' &&
          this.waitStartedAt !== null &&
          Date.now() - this.waitStartedAt > WAIT_FOR_SIGNED_TIMEOUT_MS
        ) {
          this.error.set(
            'La firma esta tomando mas de lo esperado. Espera un momento o recarga la pagina.',
          );
        } else if (c.stage !== 'signing') {
          // Reset the timer once we leave signing (success or failure).
          this.waitStartedAt = null;
        }
        this.scheduleNextPoll();
      },
      error: () => {
        // Transient network error: try again on next tick.
        this.scheduleNextPoll();
      },
    });
  }

  // -------------------------------------------------------------------------
  // Screen: review
  // -------------------------------------------------------------------------

  goToIdentity(): void {
    this.reviewAcknowledged.set(true);
    this.currentDoc.set(this.nextPendingBiometric());
  }

  // -------------------------------------------------------------------------
  // Screen: identity
  // -------------------------------------------------------------------------

  pickDoc(type: EvidenceTypeApi): void {
    if (this.uploadBusy()) return;
    this.currentDoc.set(type);
  }

  onCaptured(blob: Blob): void {
    const type = this.currentDoc();
    if (!type || this.uploadBusy()) return;
    if (type !== 'id_front' && type !== 'id_back' && type !== 'face') return;
    this.uploadBusy.set(true);
    this.error.set('');

    this.api.uploadEvidence(this.signId, type, blob, 'image/jpeg').subscribe({
      next: () => {
        const validate$ =
          type === 'id_front'
            ? this.api.validateIdSide(this.signId, 'front')
            : type === 'id_back'
              ? this.api.validateIdSide(this.signId, 'back')
              : this.api.validateFace(this.signId);
        validate$.subscribe({
          next: (r) => {
            this.uploadBusy.set(false);
            this.refreshFromServerStage(r.stage);
            this.camera?.reset();
          },
          error: (err) => {
            this.uploadBusy.set(false);
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

  // -------------------------------------------------------------------------
  // Screen: signature
  // -------------------------------------------------------------------------

  onSignatureBlob(blob: Blob | null): void {
    this.signatureBlob = blob;
  }

  submitSignature(): void {
    if (!this.signatureBlob || this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this.api
      .uploadEvidence(this.signId, 'signature_drawing', this.signatureBlob, 'image/png')
      .subscribe({
        next: () => {
          this.api.registerSignature(this.signId).subscribe({
            next: (r) => {
              this.busy.set(false);
              // Server advanced to 'consent' if everything is ready.
              this.refreshFromServerStage(r.stage);
            },
            error: () => {
              this.busy.set(false);
              this.error.set('No pudimos guardar tu firma. Intenta de nuevo.');
            },
          });
        },
        error: () => {
          this.busy.set(false);
          this.error.set('No pudimos guardar tu firma. Intenta de nuevo.');
        },
      });
  }

  // -------------------------------------------------------------------------
  // Screen: consent
  // -------------------------------------------------------------------------

  acceptConsent(): void {
    if (!this.consentChecked() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.consent(this.signId, TERMS_VERSION).subscribe({
      next: () => {
        // POST /consent doesn't advance the stage on its own; the
        // *next* action (request_otp) is what moves the stage to
        // 'otp'. Chain them so the OTP is already in flight when the
        // OTP screen mounts.
        this.sendOtpAfterConsent();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.friendlyConsentError(err?.error?.error));
      },
    });
  }

  private sendOtpAfterConsent(): void {
    this.api.requestOtp(this.signId).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.otpSent.set(true);
        this.devOtp.set(r._debug_otp ?? '');
        // Force a refresh so the screen recomputes to 'otp' immediately.
        this.refreshFromServerStage(r.stage);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('No pudimos enviar el codigo. Intenta de nuevo.');
      },
    });
  }

  // -------------------------------------------------------------------------
  // Screen: otp
  // -------------------------------------------------------------------------

  /** Called from the template when the OTP screen mounts to ensure a
   *  code is in flight. Idempotent: bails when we've already requested
   *  one during this browser session, or when the server-side OTP is
   *  still live (visible via `c.otp.requested === true` at load time).
   *  Wired via a one-shot effect in the template. */
  ensureOtpRequested(): void {
    if (this.otpSent() || this.busy()) return;
    this.resendOtp();
  }

  resendOtp(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.requestOtp(this.signId).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.otpSent.set(true);
        this.devOtp.set(r._debug_otp ?? '');
      },
      error: () => {
        this.busy.set(false);
        this.error.set('No pudimos enviar el codigo. Intenta de nuevo.');
      },
    });
  }

  confirmOtp(): void {
    if (this.otp.length !== 6 || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.verifyOtp(this.signId, this.otp).subscribe({
      next: (r) => {
        this.busy.set(false);
        // Stage is now 'signing'. The screen computed signal will pick
        // that up on the next tick (or right now if refreshFromServerStage
        // sees the advance). Start the wait timer explicitly so the
        // timeout kicks in even if the very next poll succeeds
        // immediately.
        this.waitStartedAt = Date.now();
        this.refreshFromServerStage(r.stage);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.friendlyOtpError(err?.error?.error));
      },
    });
  }

  // -------------------------------------------------------------------------
  // Screen: signing / done / failed / expired
  // -------------------------------------------------------------------------

  /** Human-readable time the signer has been on the signing screen.
   *  Purely cosmetic; used to keep the "esto puede tardar hasta 1 min"
   *  message honest. Returns 0 before the wait started. */
  readonly waitingSeconds = computed(() => {
    // The computed re-runs whenever `ceremony` changes (which happens
    // every poll tick). That's frequent enough for a rough counter.
    void this.ceremony();
    if (this.waitStartedAt === null) return 0;
    return Math.floor((Date.now() - this.waitStartedAt) / 1000);
  });

  backToProcess(): void {
    if (this.returnUrl) {
      window.location.assign(this.returnUrl);
    }
    // No return URL -> the button is hidden in the template. No-op.
  }

  // -------------------------------------------------------------------------
  // Error copy
  // -------------------------------------------------------------------------

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

  private friendlyConsentError(code: string | undefined): string {
    switch (code) {
      case 'unknown_terms_version':
        return 'Version de terminos desactualizada. Recarga la pagina.';
      case 'stage_not_allowed_current_created':
      case 'stage_not_allowed_current_identity':
        return 'Aun no puedes aceptar los terminos. Completa los pasos previos.';
      default:
        return 'No pudimos registrar tu aceptacion. Intenta de nuevo.';
    }
  }

  private friendlyOtpError(code: string | undefined): string {
    switch (code) {
      case 'otp_invalid':
        return 'Codigo incorrecto. Intenta de nuevo.';
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

  // -------------------------------------------------------------------------
  // Server-triggered state refresh. Called after a mutation that we
  // KNOW advanced the stage; short-circuits the next poll tick.
  // -------------------------------------------------------------------------

  private refreshFromServerStage(_hint: string): void {
    // The mutation responses include `stage` but not the full ceremony
    // shape. We could patch the local ceremony optimistically, but a
    // fresh GET keeps everything consistent (uploads_state, otp
    // counters, hashes) with minimal cost. Cancel any pending timer
    // and fetch now.
    this.stopPolling();
    this.api.get(this.signId).subscribe({
      next: (c) => {
        this.applyCeremony(c);
        this.startPolling();
      },
      error: () => {
        // Ignore: the scheduled poll will retry.
        this.startPolling();
      },
    });
  }
}
