/**
 * Playwright / E2E test hooks for the signing SPA.
 *
 * WHY this exists
 * ---------------
 *
 * Two parts of the wizard are essentially unreachable from an automated
 * browser:
 *
 *   1. `<video>` + `getUserMedia()` in `camera-capture.component`. Chromium's
 *      fake device serves a green square, which is not a valid face or ID for
 *      Rekognition.
 *   2. `<canvas>` pointer strokes in `signature-pad.component`, flaky to
 *      simulate with mouse events.
 *
 * So `window.__signingE2E` lets a driver feed real image bytes into the same
 * code paths the camera and the pad trigger (`SignComponent.onCaptured`,
 * `onSignatureBlob` + `submitSignature`) and read the wizard state back to
 * wait on transitions. Everything else (state machine, polling, terminal
 * screens, return URL) runs exactly as for a human, so this is a UI-level E2E.
 *
 * The OTP is NOT bypassable: the backend only emails it (`set-otp` has no
 * debug echo anymore), so a driver needs the code from the signer's mailbox
 * and passes it to `confirmOtp`.
 *
 * Security posture
 * ----------------
 *
 * Installed only if BOTH hold:
 *
 *   1. `environment.stage` is E2E-enabled (`dev`, `staging` or `pro`).
 *   2. The URL carries `?e2e=1`.
 *
 * The hooks give no capability a human with the link doesn't already have:
 * the `signature_id` is the credential, and the OTP still has to come from
 * the signer's inbox.
 */

import type { Screen, SignComponent } from '../pages/sign.component';
import type { BiometricType, SignatureStage } from './signatures.service';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type E2EScreen = Screen;

/** Snapshot returned by `getState()`. Small on purpose: drivers must not depend on internals. */
export interface E2EState {
  signatureId: string;
  screen: E2EScreen | null;
  /** `null` until the signature loads, or when it expired (410). */
  stage: SignatureStage | null;
  /** Validated evidences (`get-required-biometrics`); `null` until loaded. */
  biometrics: Record<BiometricType, boolean> | null;
  /** `set-signature-draw` succeeded in this session. */
  drawSubmitted: boolean;
  /** A code was requested in this session. */
  otpSent: boolean;
  attemptsLeft: number;
  /** Reason of the last rejected evidence, or ''. */
  lastRejection: string;
  /** Last user-facing error ('' when none). */
  error: string;
  /** An upload, validation or POST is in flight. */
  busy: boolean;
}

export interface SigningE2EApi {
  getState(): E2EState;
  /** Resolves once `getState().screen === screen`. Rejects on timeout. */
  waitForScreen(screen: E2EScreen, timeoutMs?: number): Promise<void>;
  /** Resolves once `getState().stage === stage`. Rejects on timeout. */
  waitForStage(stage: SignatureStage, timeoutMs?: number): Promise<void>;
  /** Equivalent to clicking "Continuar" on the review screen. */
  acknowledgeReview(): void;
  /** Fills the email, ticks the terms and submits. Resolves when the call settles. */
  submitForm(email: string): Promise<void>;
  /**
   * Feeds a base64 image straight into the camera output: uploaded with a
   * presigned PUT and validated with `set-biometrics`, as a real capture.
   * Resolves once the upload + validation chain settles; check
   * `getState().biometrics` / `lastRejection` for the outcome.
   *
   * @param mime `image/jpeg` (what the camera produces) or `image/png`.
   */
  submitEvidence(type: BiometricType, base64: string, mime?: string): Promise<void>;
  /** Feeds a base64 PNG into the pad and submits it (also requests the first OTP). */
  submitSignature(base64: string, mime?: string): Promise<void>;
  /** Requests (or re-sends) the OTP. */
  requestOtp(): Promise<void>;
  /** Enters the code and submits. Resolves once the call settles. */
  confirmOtp(code: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Binds the API to `window.__signingE2E` if the guards allow. Called from
 * `SignComponent.ngOnInit`. Type-only import of the component, so this file
 * doesn't create a runtime circular dependency.
 */
export function installSigningE2EHooks(component: SignComponent, stage: string): void {
  if (stage !== 'dev' && stage !== 'staging' && stage !== 'pro') return;
  if (typeof window === 'undefined') return;
  if (new URL(window.location.href).searchParams.get('e2e') !== '1') return;

  const busy = () => component.busy() || component.uploadBusy();

  const api: SigningE2EApi = {
    getState(): E2EState {
      return {
        signatureId: component.signatureId,
        screen: component.screen() ?? null,
        stage: component.signature()?.stage ?? null,
        biometrics: component.biometrics() ? { ...component.docDone() } : null,
        drawSubmitted: component.drawSubmitted(),
        otpSent: component.otpSent(),
        attemptsLeft: component.attemptsLeft(),
        lastRejection: component.lastRejection(),
        error: component.error(),
        busy: busy(),
      };
    },

    async waitForScreen(screen, timeoutMs = 30_000) {
      await pollUntil(() => component.screen() === screen, timeoutMs, `waitForScreen(${screen})`);
    },

    async waitForStage(stage, timeoutMs = 60_000) {
      await pollUntil(() => component.signature()?.stage === stage, timeoutMs, `waitForStage(${stage})`);
    },

    acknowledgeReview() {
      component.acknowledgeReview();
    },

    async submitForm(email) {
      component.setEmail(email);
      component.termsAccepted.set(true);
      component.submitForm();
      await pollUntil(() => !busy(), 30_000, 'submitForm');
    },

    async submitEvidence(type, base64, mime = 'image/jpeg') {
      component.pickDoc(type);
      component.currentDoc.set(type);
      component.onCaptured(base64ToBlob(base64, mime));
      await pollUntil(() => !component.uploadBusy(), 60_000, `submitEvidence(${type})`);
    },

    async submitSignature(base64, mime = 'image/png') {
      component.onSignatureBlob(base64ToBlob(base64, mime));
      component.submitSignature();
      await pollUntil(() => !busy(), 30_000, 'submitSignature');
    },

    async requestOtp() {
      component.requestOtp();
      await pollUntil(() => !busy(), 30_000, 'requestOtp');
    },

    async confirmOtp(code) {
      component.otp = code;
      component.confirmOtp();
      await pollUntil(() => !busy(), 30_000, 'confirmOtp');
    },
  };

  (window as unknown as { __signingE2E: SigningE2EApi }).__signingE2E = api;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Polls `pred` every 100 ms up to `timeoutMs`; rejects with a labeled error. */
function pollUntil(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      try {
        if (pred()) return resolve();
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - t0 >= timeoutMs) return reject(new Error(`e2e-hooks timeout: ${label}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** base64 -> Blob without a data URL. */
function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
