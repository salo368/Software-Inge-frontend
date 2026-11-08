/**
 * Signing SPA wizard, driven by the `signatures` backend.
 *
 * Thin controller around a state machine derived from the server-side
 * `Signature.stage`. The server is authoritative: every poll tick recomputes
 * the screen. The only local override is `reviewAcknowledged`, which keeps
 * the intro screen up until the signer clicks Continue (otherwise a fresh
 * `FORM` signature would jump straight to the email form).
 *
 * Screens
 * -------
 *
 *   review     FORM, local-only intro: PDF preview with the signature box(es).
 *   form       FORM: signer email (where the OTP goes) + terms acknowledgement.
 *              `set-signature-form` -> BIOMETRICS.
 *   identity   BIOMETRICS: ID front, ID back and face. Each capture is
 *              uploaded (presigned PUT) and validated (`set-biometrics`).
 *              `get-required-biometrics` advances to SIGNATURE once the three
 *              are valid.
 *   signature  SIGNATURE: draw the signature. `set-signature-draw` -> OTP, and
 *              we request the first code right away.
 *   otp        OTP: 6-digit code (2 min, 3 tries). `resolve-otp` -> SIGNING.
 *   signing    SIGNING: sign_doc stamps + seals the PDF (seconds; the backend
 *              fails it after 60 s).
 *   done       SIGNED: hash, link to the signed PDF, return button.
 *   failed     FAILED: 3 wrong codes, window over, or sign_doc did not finish.
 *   expired    `410 signature_expired`: the 15-minute window closed.
 *
 * Polling
 * -------
 *
 * One timeout loop on `get-signature` (plus `get-required-biometrics` while in
 * BIOMETRICS). Faster while SIGNING. Skipped while an interaction is in
 * flight, so a stale read can't stomp on the optimistic local state. Stops on
 * terminal stages.
 */

import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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

import { environment } from '../../environments/environment';
import { installSigningE2EHooks } from '../core/e2e-hooks';
import {
  HOST_RETURN_LABEL,
  HOST_STANDALONE_DONE_LABEL,
  RETURN_URL_QUERY_PARAM,
  resolveReturnUrl,
} from '../core/host-app';
import {
  BIOMETRIC_TYPES,
  BiometricContentType,
  BiometricType,
  MAX_OTP_TRIES,
  RequiredBiometrics,
  Signature,
  SignatureApiError,
  SignaturesService,
  TERMINAL_STAGES,
} from '../core/signatures.service';
import { CameraCaptureComponent, CameraMode } from './sign/camera-capture.component';
import { PdfPreviewComponent } from './sign/pdf-preview.component';
import { SignaturePadComponent } from './sign/signature-pad.component';
import { friendlyDrawError, friendlyFormError, friendlyRejection } from './sign/sign-copy';

export type Screen =
  | 'review'
  | 'form'
  | 'identity'
  | 'signature'
  | 'otp'
  | 'signing'
  | 'done'
  | 'failed'
  | 'expired';

interface StepDef {
  key: Extract<Screen, 'review' | 'form' | 'identity' | 'signature' | 'otp'>;
  label: string;
  icon: string;
}

/** The interactive screens shown in the stepper. */
const STEPS: StepDef[] = [
  { key: 'review', label: 'Revision', icon: 'bi-file-earmark-text' },
  { key: 'form', label: 'Correo', icon: 'bi-envelope' },
  { key: 'identity', label: 'Identidad', icon: 'bi-person-badge' },
  { key: 'signature', label: 'Firma', icon: 'bi-vector-pen' },
  { key: 'otp', label: 'Codigo', icon: 'bi-envelope-check' },
];

interface DocDef {
  type: BiometricType;
  label: string;
  short: string;
  hint: string;
  icon: string;
  mode: CameraMode;
}

const DOCS: DocDef[] = [
  {
    type: 'ID_FRONT',
    label: 'Documento - cara frontal',
    short: 'Frontal',
    hint: 'Centra el frente de tu documento dentro del recuadro, que se lea el numero',
    icon: 'bi-person-vcard',
    mode: 'document',
  },
  {
    type: 'ID_BACK',
    label: 'Documento - cara posterior',
    short: 'Posterior',
    hint: 'Ahora la cara posterior, con buena luz y sin reflejos',
    icon: 'bi-person-vcard-fill',
    mode: 'document',
  },
  {
    type: 'FACE',
    label: 'Foto de tu rostro',
    short: 'Tu rostro',
    hint: 'Ubica tu rostro dentro del ovalo, con los ojos abiertos y buena luz',
    icon: 'bi-emoji-smile',
    mode: 'face',
  },
];

/** Shown on the email screen; accepting them is what enables the submit. */
const TERMS_BULLETS: readonly string[] = [
  'He revisado el documento y su contenido refleja mi voluntad de firmarlo.',
  'Autorizo el uso de mi firma electronica sobre este documento, con el mismo valor legal que una firma manuscrita (Ley 527 de 1999).',
  'Autorizo la conservacion de mis fotografias de identificacion, mi rostro y esta ceremonia como evidencia de autoria.',
  'Entiendo que el codigo que llegara a mi correo es personal y no debo compartirlo.',
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const POLL_INTERVAL_MS = 4000;
const POLL_INTERVAL_MS_WHILE_SIGNING = 2000;
/** sign_doc is failed by the backend after 60 s; this is just a soft UI hint. */
const SLOW_SIGNING_HINT_MS = 75_000;

@Component({
  selector: 'app-sign',
  standalone: true,
  imports: [CommonModule, FormsModule, CameraCaptureComponent, PdfPreviewComponent, SignaturePadComponent],
  templateUrl: './sign.component.html',
})
export class SignComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private api = inject(SignaturesService);

  @ViewChild(CameraCaptureComponent) camera?: CameraCaptureComponent;

  readonly STEPS = STEPS;
  readonly DOCS = DOCS;
  readonly TERMS_BULLETS = TERMS_BULLETS;
  readonly HOST_RETURN_LABEL = HOST_RETURN_LABEL;
  readonly HOST_STANDALONE_DONE_LABEL = HOST_STANDALONE_DONE_LABEL;
  readonly MAX_OTP_TRIES = MAX_OTP_TRIES;

  // -------------------------------------------------------------------------
  // URL-derived state
  // -------------------------------------------------------------------------

  signatureId = '';
  /** Same-origin `?return_url=`, or null when the signer came some other way. */
  returnUrl: string | null = null;

  // -------------------------------------------------------------------------
  // Server + UI state
  // -------------------------------------------------------------------------

  signature = signal<Signature | null>(null);
  /** Validation status of each evidence; loaded while in BIOMETRICS. */
  biometrics = signal<RequiredBiometrics | null>(null);
  /** The id is malformed or does not exist. */
  notFound = signal(false);
  /** `410 signature_expired`. */
  expired = signal(false);
  reviewAcknowledged = signal(false);

  /** Recoverable action error (terminal ones get their own screens). */
  error = signal('');
  /** A POST is in flight; polling is paused. */
  busy = signal(false);
  /** An evidence upload + validation is in flight. */
  uploadBusy = signal(false);
  /** Reason of the last rejected evidence (`too_few_legible_lines`...). */
  lastRejection = signal('');

  // form
  email = '';
  termsAccepted = signal(false);

  // identity
  currentDoc = signal<BiometricType | ''>('');

  // signature
  signatureBlob: Blob | null = null;
  drawSubmitted = signal(false);

  // otp
  otp = '';
  /** A code was requested in this browser session. */
  otpSent = signal(false);
  emailSent = signal(true);
  otpExpiresAt = signal<number | null>(null);
  attemptsLeft = signal(MAX_OTP_TRIES);

  /** 1 s clock for countdowns. */
  now = signal(Date.now());

  private poll: number | null = null;
  private clock: number | null = null;
  private signingSince: number | null = null;

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  readonly screen = computed<Screen>(() => {
    if (this.expired()) return 'expired';
    const s = this.signature();
    if (!s) return 'review';
    switch (s.stage) {
      case 'FAILED':
        return 'failed';
      case 'SIGNED':
        return 'done';
      case 'SIGNING':
        return 'signing';
      case 'OTP':
        return 'otp';
      case 'SIGNATURE':
        return 'signature';
      case 'BIOMETRICS':
        return 'identity';
      case 'FORM':
      default:
        return this.reviewAcknowledged() ? 'form' : 'review';
    }
  });

  readonly stepIndex = computed(() => STEPS.findIndex((step) => step.key === this.screen()));

  readonly showStepper = computed(() => this.stepIndex() !== -1);

  readonly docDone = computed<Record<BiometricType, boolean>>(() => {
    const b = this.biometrics();
    return { ID_FRONT: !!b?.ID_FRONT, ID_BACK: !!b?.ID_BACK, FACE: !!b?.FACE };
  });

  readonly allBiometricsDone = computed(() => BIOMETRIC_TYPES.every((t) => this.docDone()[t]));

  readonly activeDoc = computed(() => DOCS.find((d) => d.type === this.currentDoc()) ?? null);

  /** First signature box, used for the preview. */
  readonly primaryBox = computed(() => this.signature()?.sign_location?.[0] ?? null);

  readonly windowSecondsLeft = computed(() => {
    const s = this.signature();
    if (!s) return null;
    return Math.max(0, Math.floor((Date.parse(s.expires_at) - this.now()) / 1000));
  });

  readonly windowMinutesLeft = computed(() => Math.ceil((this.windowSecondsLeft() ?? 0) / 60));

  readonly otpSecondsLeft = computed(() => {
    const at = this.otpExpiresAt();
    return at === null ? null : Math.max(0, Math.floor((at - this.now()) / 1000));
  });

  readonly signingSeconds = computed(() =>
    this.signingSince === null ? 0 : Math.floor((this.now() - this.signingSince) / 1000),
  );

  /** Mirror of `email` so `emailValid` reacts to typing. */
  emailModel = signal('');
  readonly emailValid = computed(() => EMAIL_RE.test(this.emailModel().trim()));

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.signatureId = params.get('sign_id') ?? '';
      this.load();
    });
    const q = this.route.snapshot.queryParamMap;
    this.returnUrl = resolveReturnUrl(q.get(RETURN_URL_QUERY_PARAM));
    this.setEmail(q.get('email') ?? '');
    this.clock = window.setInterval(() => this.now.set(Date.now()), 1000);
    // Playwright hook. No-op unless the stage is E2E-enabled AND the URL has ?e2e=1.
    installSigningE2EHooks(this, environment.stage);
  }

  ngOnDestroy(): void {
    this.stopPolling();
    if (this.clock !== null) window.clearInterval(this.clock);
  }

  // -------------------------------------------------------------------------
  // Fetch + polling
  // -------------------------------------------------------------------------

  private load(): void {
    this.notFound.set(false);
    this.expired.set(false);
    this.signature.set(null);
    this.biometrics.set(null);
    this.reviewAcknowledged.set(false);
    if (!this.signatureId) {
      this.notFound.set(true);
      return;
    }
    this.api.get(this.signatureId).subscribe({
      next: (s) => {
        this.applySignature(s);
        this.startPolling();
      },
      error: (err: HttpErrorResponse) => this.onReadError(err, true),
    });
  }

  private onReadError(err: HttpErrorResponse, initial: boolean): void {
    if (err.status === 410) {
      this.expired.set(true);
      this.stopPolling();
      return;
    }
    if (initial || err.status === 404) {
      this.notFound.set(true);
      this.stopPolling();
    }
  }

  private applySignature(s: Signature): void {
    this.signature.set(s);
    if (s.stage === 'BIOMETRICS') {
      if (this.biometrics() === null) this.loadBiometrics();
      else if (!this.currentDoc()) this.currentDoc.set(this.nextPendingDoc());
    }
    if (s.stage === 'SIGNING') this.signingSince ??= Date.now();
    else this.signingSince = null;
  }

  private loadBiometrics(after?: () => void): void {
    this.api.requiredBiometrics(this.signatureId).subscribe({
      next: (b) => {
        this.biometrics.set(b);
        if (!this.currentDoc() || this.docDone()[this.currentDoc() as BiometricType]) {
          this.currentDoc.set(this.nextPendingDoc());
        }
        after?.();
      },
      error: () => after?.(),
    });
  }

  private nextPendingDoc(): BiometricType | '' {
    const done = this.docDone();
    return DOCS.find((d) => !done[d.type])?.type ?? '';
  }

  private startPolling(): void {
    if (this.poll === null) this.scheduleNextPoll();
  }

  private stopPolling(): void {
    if (this.poll !== null) {
      window.clearTimeout(this.poll);
      this.poll = null;
    }
  }

  private scheduleNextPoll(): void {
    const s = this.signature();
    if (this.expired() || (s && TERMINAL_STAGES.includes(s.stage))) {
      this.stopPolling();
      return;
    }
    const ms = s?.stage === 'SIGNING' ? POLL_INTERVAL_MS_WHILE_SIGNING : POLL_INTERVAL_MS;
    this.poll = window.setTimeout(() => this.tick(), ms);
  }

  private tick(): void {
    this.poll = null;
    if (this.busy() || this.uploadBusy()) {
      this.scheduleNextPoll();
      return;
    }
    // In BIOMETRICS, refresh the evidence map first: its side effect is the
    // advance to SIGNATURE, which the following get-signature then sees.
    if (this.signature()?.stage === 'BIOMETRICS') {
      this.loadBiometrics(() => this.fetchSignature());
    } else {
      this.fetchSignature();
    }
  }

  private fetchSignature(): void {
    this.api.get(this.signatureId).subscribe({
      next: (s) => {
        this.applySignature(s);
        this.scheduleNextPoll();
      },
      error: (err: HttpErrorResponse) => {
        this.onReadError(err, false);
        if (!this.expired() && !this.notFound()) this.scheduleNextPoll();
      },
    });
  }

  /** After a mutation we know moved the stage: read now instead of waiting a tick. */
  private refreshNow(): void {
    this.stopPolling();
    this.fetchSignature();
  }

  // -------------------------------------------------------------------------
  // Screen: review
  // -------------------------------------------------------------------------

  acknowledgeReview(): void {
    this.reviewAcknowledged.set(true);
  }

  // -------------------------------------------------------------------------
  // Screen: form
  // -------------------------------------------------------------------------

  setEmail(value: string): void {
    this.email = value;
    this.emailModel.set(value);
  }

  submitForm(): void {
    if (!this.emailValid() || !this.termsAccepted() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.setForm(this.signatureId, this.email.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.refreshNow();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.handleMutationError(err, friendlyFormError);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Screen: identity
  // -------------------------------------------------------------------------

  pickDoc(type: BiometricType): void {
    if (this.uploadBusy() || this.docDone()[type]) return;
    this.currentDoc.set(type);
  }

  onCaptured(blob: Blob): void {
    const type = this.currentDoc();
    if (!type || this.uploadBusy()) return;
    const contentType: BiometricContentType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    this.uploadBusy.set(true);
    this.error.set('');
    this.lastRejection.set('');

    this.api.uploadBiometric(this.signatureId, type, blob, contentType).subscribe({
      next: (key) => {
        this.api.setBiometric(this.signatureId, type, key).subscribe({
          next: (r) => {
            if (!r.is_valid) {
              this.uploadBusy.set(false);
              this.lastRejection.set(r.reason);
              this.error.set(friendlyRejection(r.reason));
              this.camera?.reset();
              return;
            }
            this.afterBiometricStored();
          },
          error: (err: HttpErrorResponse) => {
            if ((err.error as SignatureApiError | null)?.error === 'biometric_already_set') {
              this.afterBiometricStored();
              return;
            }
            this.uploadBusy.set(false);
            this.camera?.reset();
            this.handleMutationError(err, () => 'No pudimos validar la foto. Tomala de nuevo con buena luz.');
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.uploadBusy.set(false);
        this.handleMutationError(err, () => 'No pudimos subir la foto. Revisa tu conexion.');
      },
    });
  }

  /** Re-read the map (advances to SIGNATURE when complete), then the signature. */
  private afterBiometricStored(): void {
    this.loadBiometrics(() => {
      this.uploadBusy.set(false);
      this.camera?.reset();
      if (this.allBiometricsDone()) this.refreshNow();
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
    this.api.setDraw(this.signatureId, this.signatureBlob).subscribe({
      next: () => {
        this.drawSubmitted.set(true);
        // Now in OTP: request the first code so it is on its way already.
        this.requestOtp();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.handleMutationError(err, friendlyDrawError);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Screen: otp
  // -------------------------------------------------------------------------

  requestOtp(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.setOtp(this.signatureId).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.otpSent.set(true);
        this.emailSent.set(r.email_sent);
        this.otpExpiresAt.set(Date.parse(r.expires_at));
        this.attemptsLeft.set(MAX_OTP_TRIES);
        this.otp = '';
        if (!r.email_sent) this.error.set('No pudimos enviar el correo. Pide un codigo nuevo.');
        this.refreshNow();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.handleMutationError(err, () => 'No pudimos enviar el codigo. Intenta de nuevo.');
      },
    });
  }

  confirmOtp(): void {
    if (!/^\d{6}$/.test(this.otp) || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.resolveOtp(this.signatureId, this.otp).subscribe({
      next: () => {
        this.busy.set(false);
        this.signingSince = Date.now();
        this.refreshNow();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const body = err.error as SignatureApiError | null;
        switch (body?.error) {
          case 'otp_invalid':
            this.attemptsLeft.set(body.attempts_left ?? Math.max(0, this.attemptsLeft() - 1));
            this.error.set('Codigo incorrecto. Revisa tu correo e intenta de nuevo.');
            return;
          case 'otp_expired':
            this.otpExpiresAt.set(Date.now());
            this.error.set('El codigo vencio. Pide uno nuevo.');
            return;
          case 'otp_not_requested':
            this.otpSent.set(false);
            this.error.set('Primero pide el codigo.');
            return;
          case 'otp_max_attempts':
            this.error.set('');
            this.refreshNow();
            return;
          default:
            this.handleMutationError(err, () => 'No pudimos confirmar la firma. Intenta de nuevo.');
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // Terminal screens
  // -------------------------------------------------------------------------

  readonly slowSigning = computed(() => this.signingSeconds() * 1000 > SLOW_SIGNING_HINT_MS);

  backToProcess(): void {
    if (this.returnUrl) window.location.assign(this.returnUrl);
  }

  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------

  /**
   * Common to every mutation: 410 ends the ceremony, a `*_not_in_*_stage`
   * 409 means another tab (or the server) moved on, so we just re-read.
   */
  private handleMutationError(err: HttpErrorResponse, fallback: (code: string | undefined) => string): void {
    const code = (err.error as SignatureApiError | null)?.error;
    if (err.status === 410 || code === 'signature_expired') {
      this.expired.set(true);
      this.stopPolling();
      return;
    }
    if (err.status === 409 && code?.startsWith('signature_not_in_')) {
      this.refreshNow();
      return;
    }
    this.error.set(fallback(code));
  }
}
