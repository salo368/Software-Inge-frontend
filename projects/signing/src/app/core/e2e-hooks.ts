/**
 * Playwright / E2E test hooks for the signing SPA.
 *
 * WHY this exists
 * ---------------
 *
 * The signing wizard has two chunks of code that are essentially
 * unreachable from an automated browser:
 *
 *   1. `<video>` + `getUserMedia()` in `camera-capture.component`.
 *      Even with `--use-fake-device-for-media-stream` the green square
 *      Chromium serves isn't a valid face for Rekognition, and the
 *      guide-box crop is fiddly in headless.
 *
 *   2. `<canvas>` pointer strokes in `signature-pad.component`.
 *      Simulating "draw enough ink to make `hasInk = true`" via
 *      Playwright mouse events is possible but flaky (subpixel jitter,
 *      pointer capture timing).
 *
 * Rather than fighting either, we expose a tiny imperative API bound to
 * `window.__signingE2E` that lets a driver:
 *
 *   * feed real image bytes (PNG/JPEG) directly into the same code path
 *     the camera would trigger (`SignComponent.onCaptured`), skipping
 *     the video stream entirely;
 *
 *   * feed a pre-drawn PNG straight into the signature submit code
 *     path (`SignComponent.onSignatureBlob` + `submitSignature`);
 *
 *   * inject the debug OTP HMAC key so `request_otp` calls include the
 *     `X-Debug-OTP-Signature` header and the backend echoes the
 *     plaintext code back in `_debug_otp` -- otherwise the test has no
 *     way to know the OTP without polling a mailbox;
 *
 *   * introspect the current wizard state so the driver can wait on
 *     stage transitions instead of racing on wall-clock timers.
 *
 * The rest of the wizard (screen state machine, polling loop, terminal
 * screens, return URL handling) runs exactly the way it does for a
 * human, so this is a true UI-level E2E, not an API-only probe.
 *
 * Security posture
 * ----------------
 *
 * The hooks are installed if and only if BOTH of the following hold:
 *
 *   1. `environment.stage === 'dev'` (never in the pro bundle).
 *   2. The current URL contains `?e2e=1`.
 *
 * The `?e2e=1` gate exists so a compromised dev build alone isn't a
 * capability escalation for anyone who can guess a `sign_id`: without
 * the debug OTP key -- which lives in SSM and is provisioned only in
 * dev via `bootstrap-signatures-v2.sh` -- the driver still can't sign
 * on someone's behalf. It just makes local/CI testing feasible without
 * fake webcam plumbing.
 *
 * Contract
 * --------
 *
 * All actions are fire-and-forget; the driver reads state back through
 * `getState()` on the next tick, or uses `waitForScreen()` /
 * `waitForStage()` for a polling await. Actions return `Promise<void>`
 * only when they own an async chain (upload + validate), so awaiting is
 * safe but not required.
 */

import type { SignComponent } from '../pages/sign.component';
import type { CeremonyStage, EvidenceTypeApi } from './signatures.service';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** Wizard screen id as computed by `SignComponent.screen()`. */
export type E2EScreen =
  | 'review'
  | 'identity'
  | 'signature'
  | 'consent'
  | 'otp'
  | 'signing'
  | 'done'
  | 'failed'
  | 'expired';

/** Snapshot returned by `getState()`. Kept intentionally small: the
 *  driver should not depend on internal fields. */
export interface E2EState {
  signId: string;
  screen: E2EScreen | null;
  stage: CeremonyStage | null;
  /** Per-evidence upload/validate flags. `null` means the ceremony
   *  hasn't loaded yet. */
  uploads: {
    id_front: { uploaded: boolean; validated: boolean | null };
    id_back: { uploaded: boolean; validated: boolean | null };
    face: { uploaded: boolean; validated: boolean | null };
    signature: { uploaded: boolean; validated: boolean | null };
  } | null;
  otpSent: boolean;
  /** Plaintext OTP echoed back by request_otp when the debug HMAC key
   *  is installed (see `setDebugOtpKey`). Empty string when the key is
   *  not installed or the OTP hasn't been requested yet. */
  debugOtp: string;
  /** Last user-facing error text set on the component (may be ''). */
  error: string;
  /** True while an upload or validate is in flight. Terminal check
   *  before firing the next action. */
  busy: boolean;
}

/** The imperative API bound to `window.__signingE2E`. */
export interface SigningE2EApi {
  /** Snapshot of the wizard right now. Cheap; safe to poll. */
  getState(): E2EState;

  /** Resolves once `getState().screen === screen`. Rejects on timeout. */
  waitForScreen(screen: E2EScreen, timeoutMs?: number): Promise<void>;

  /** Resolves once `getState().stage === stage`. Rejects on timeout. */
  waitForStage(stage: CeremonyStage, timeoutMs?: number): Promise<void>;

  /**
   * Provisions the debug OTP HMAC key so any subsequent `request_otp`
   * call attaches `X-Debug-OTP-Signature` and the backend echoes the
   * plaintext code back. See
   * `backend/services/signatures/src/handlers/request_otp/handler.py`.
   * Must be called BEFORE `acceptConsent`.
   */
  setDebugOtpKey(hexKey: string): void;

  /** Dismiss the review screen (equivalent to clicking "Continuar"). */
  goToIdentity(): void;

  /**
   * Feed a base64-encoded image straight into the camera output. The
   * evidence is uploaded to S3 via presigned PUT and then validated
   * (Rekognition or Textract), exactly as if the user had captured it
   * from the webcam.
   *
   *  @param type The evidence slot to fill (biometric only).
   *  @param base64 Raw image bytes as base64. No data-URL prefix.
   *  @param mime Content type. Defaults to `image/jpeg` which matches
   *              what the real capture path uses.
   */
  submitEvidence(
    type: 'id_front' | 'id_back' | 'face',
    base64: string,
    mime?: string,
  ): Promise<void>;

  /**
   * Feed a base64-encoded PNG into the signature pad output. Uploads
   * the blob as `signature_drawing` evidence AND calls the register
   * endpoint, mirroring what `SignComponent.submitSignature` does when
   * the user clicks Continue.
   */
  submitSignature(base64: string, mime?: string): Promise<void>;

  /**
   * Ticks the consent checkbox AND clicks Accept. Chains
   * `request_otp` internally (with the debug key if `setDebugOtpKey`
   * was called first). Returns once the OTP screen is reachable.
   */
  acceptConsent(): Promise<void>;

  /** Enters the code and submits. Equivalent to
   *  `signComponent.otp = code; signComponent.confirmOtp()`. */
  confirmOtp(code: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Wire the hook object to `window.__signingE2E` if the guards allow.
 * Callable from `SignComponent.ngOnInit`. No-op in prod or without
 * `?e2e=1`.
 *
 * We accept `SignComponent` as an opaque interface (via type-only
 * import so the hooks file doesn't itself trigger a circular
 * dependency at runtime) and manipulate its public signals + methods.
 */
export function installSigningE2EHooks(
  component: SignComponent,
  stage: string,
): void {
  // Prod builds never expose hooks, ever.
  if (stage !== 'dev') return;

  // Extra gate so a dev build served publicly still won't expose the
  // hooks unless the caller explicitly opted in on the URL.
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('e2e') !== '1') return;

  const state = {
    debugOtpKey: '' as string,
  };

  const api: SigningE2EApi = {
    getState(): E2EState {
      const c = component.ceremony();
      return {
        signId: component.signId,
        screen: (component.screen() as E2EScreen | null) ?? null,
        stage: c?.stage ?? null,
        uploads: c
          ? {
              id_front: {
                uploaded: c.uploads_state.id_front.uploaded,
                validated: c.uploads_state.id_front.validated,
              },
              id_back: {
                uploaded: c.uploads_state.id_back.uploaded,
                validated: c.uploads_state.id_back.validated,
              },
              face: {
                uploaded: c.uploads_state.face.uploaded,
                validated: c.uploads_state.face.validated,
              },
              signature: {
                uploaded: c.uploads_state.signature.uploaded,
                validated: c.uploads_state.signature.validated,
              },
            }
          : null,
        otpSent: component.otpSent(),
        debugOtp: component.devOtp(),
        error: component.error(),
        busy: component.busy() || component.uploadBusy(),
      };
    },

    async waitForScreen(screen, timeoutMs = 30000) {
      await pollUntil(
        () => component.screen() === screen,
        timeoutMs,
        `waitForScreen(${screen})`,
      );
    },

    async waitForStage(stage, timeoutMs = 60000) {
      await pollUntil(
        () => component.ceremony()?.stage === stage,
        timeoutMs,
        `waitForStage(${stage})`,
      );
    },

    setDebugOtpKey(hexKey: string) {
      if (!/^[0-9a-fA-F]+$/.test(hexKey) || hexKey.length % 2 !== 0) {
        throw new Error('debug OTP key must be an even-length hex string');
      }
      state.debugOtpKey = hexKey;
    },

    goToIdentity() {
      component.goToIdentity();
    },

    async submitEvidence(type, base64, mime = 'image/jpeg') {
      const blob = base64ToBlob(base64, mime);
      component.pickDoc(type);
      component.currentDoc.set(type);
      component.onCaptured(blob);
      // The upload+validate chain flips `uploadBusy` on and back off
      // once it finishes. Wait for it to settle before returning so
      // the driver can chain the next evidence deterministically.
      await pollUntil(
        () => !component.uploadBusy(),
        30000,
        `submitEvidence(${type})`,
      );
    },

    async submitSignature(base64, mime = 'image/png') {
      const blob = base64ToBlob(base64, mime);
      component.onSignatureBlob(blob);
      component.submitSignature();
      await pollUntil(
        () => !component.busy(),
        30000,
        'submitSignature',
      );
    },

    async acceptConsent() {
      component.consentChecked.set(true);
      component.acceptConsent();
      // `acceptConsent` chains request_otp internally. Wait until the
      // OTP screen is live so the driver can immediately call
      // confirmOtp.
      await pollUntil(
        () => component.screen() === 'otp',
        30000,
        'acceptConsent -> otp screen',
      );
    },

    async confirmOtp(code: string) {
      component.otp = code;
      component.confirmOtp();
      // Wait until we leave the OTP screen (either to signing or to a
      // terminal). The caller should then poll for `stage === 'signed'`.
      await pollUntil(
        () => component.screen() !== 'otp',
        30000,
        'confirmOtp -> leaves otp screen',
      );
    },
  };

  // Store the debug key state on the api object so `SignComponent`
  // can read it back when firing request_otp (see below).
  Object.defineProperty(api, 'debugOtpKey', {
    get: () => state.debugOtpKey,
    enumerable: false,
  });

  (window as unknown as { __signingE2E: SigningE2EApi }).__signingE2E = api;
}

/**
 * Read the debug OTP key installed via `setDebugOtpKey`, if any.
 * Used by `SignComponent.sendOtpAfterConsent` / `resendOtp` to opt
 * into the HMAC-guarded backend disclosure path. Returns empty
 * string when the hook is not installed or the key was not set.
 */
export function getInstalledDebugOtpKey(): string {
  if (typeof window === 'undefined') return '';
  const api = (window as unknown as { __signingE2E?: { debugOtpKey?: string } })
    .__signingE2E;
  return api?.debugOtpKey ?? '';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll `pred` every 100ms up to `timeoutMs`. Resolves when the pred
 * returns truthy; rejects with a labeled error on timeout. Kept as a
 * standalone helper (not a signal effect) so the hooks file doesn't
 * need to inject Angular's `EnvironmentInjector`.
 */
function pollUntil(
  pred: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      try {
        if (pred()) return resolve();
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - t0 >= timeoutMs) {
        return reject(new Error(`e2e-hooks timeout: ${label}`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Turn a base64 string into a Blob without going through a data URL.
 *  Used to feed evidence bytes to the component without piping them
 *  through the DOM (which would require an `<input type=file>`). */
function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
