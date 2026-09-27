/**
 * Thin wrapper around `window.__signingE2E` (the hook installed by
 * `projects/signing/src/app/core/e2e-hooks.ts`). Each method here
 * corresponds to one action in the wizard and returns once the wizard
 * has settled to the next stable state, so the spec reads like a
 * sequential script instead of a chain of `waitFor`s.
 *
 * The driver is intentionally opinionated: it always talks to the hook
 * via `page.evaluate` and never touches the underlying HTTP APIs. That
 * way the frontend state machine, polling loop, and screen transitions
 * are all exercised.
 */

import type { Page } from '@playwright/test';

import type { E2EScreen, E2EState } from '../../projects/signing/src/app/core/e2e-hooks';
import type { CeremonyStage } from '../../projects/signing/src/app/core/signatures.service';

/** Time budget for waiting for the E2E hook to appear on `window`.
 *  Angular hydration usually finishes in well under 5 seconds. */
const HOOK_INSTALL_TIMEOUT_MS = 15_000;

/** Time budget for the async sign worker (verify_otp -> stage='signed').
 *  Real worker time is 30-90s including a cold start on a quiet dev
 *  environment. 3 minutes leaves plenty of headroom. */
export const SIGN_WORKER_TIMEOUT_MS = 180_000;

export class SigningDriver {
  constructor(private readonly page: Page) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Blocks until `window.__signingE2E` is installed by the SPA. */
  async waitReady(): Promise<void> {
    await this.page.waitForFunction(
      () => !!(window as unknown as { __signingE2E?: unknown }).__signingE2E,
      undefined,
      { timeout: HOOK_INSTALL_TIMEOUT_MS },
    );
  }

  /** Provision the debug OTP key so any subsequent `request_otp` call
   *  attaches `X-Debug-OTP-Signature` and the backend echoes the code. */
  async setDebugOtpKey(hex: string): Promise<void> {
    await this.page.evaluate(
      (k) =>
        (window as unknown as { __signingE2E: { setDebugOtpKey: (k: string) => void } })
          .__signingE2E.setDebugOtpKey(k),
      hex,
    );
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /** Snapshot the current wizard state. */
  async state(): Promise<E2EState> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __signingE2E: { getState: () => E2EState } })
          .__signingE2E.getState(),
    );
  }

  async waitForScreen(screen: E2EScreen, timeoutMs = 30_000): Promise<void> {
    await this.page.evaluate(
      ({ s, t }) =>
        (
          window as unknown as {
            __signingE2E: { waitForScreen: (s: string, t: number) => Promise<void> };
          }
        ).__signingE2E.waitForScreen(s, t),
      { s: screen, t: timeoutMs },
    );
  }

  async waitForStage(stage: CeremonyStage, timeoutMs = 60_000): Promise<void> {
    await this.page.evaluate(
      ({ s, t }) =>
        (
          window as unknown as {
            __signingE2E: { waitForStage: (s: string, t: number) => Promise<void> };
          }
        ).__signingE2E.waitForStage(s, t),
      { s: stage, t: timeoutMs },
    );
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async dismissReview(): Promise<void> {
    await this.page.evaluate(() =>
      (window as unknown as { __signingE2E: { goToIdentity: () => void } })
        .__signingE2E.goToIdentity(),
    );
  }

  async submitEvidence(
    type: 'id_front' | 'id_back' | 'face',
    base64: string,
    mime = 'image/jpeg',
  ): Promise<void> {
    await this.page.evaluate(
      ({ type, base64, mime }) =>
        (
          window as unknown as {
            __signingE2E: {
              submitEvidence: (t: string, b: string, m: string) => Promise<void>;
            };
          }
        ).__signingE2E.submitEvidence(type, base64, mime),
      { type, base64, mime },
    );
  }

  async submitSignature(base64: string): Promise<void> {
    await this.page.evaluate(
      (b) =>
        (
          window as unknown as {
            __signingE2E: {
              submitSignature: (b: string) => Promise<void>;
            };
          }
        ).__signingE2E.submitSignature(b),
      base64,
    );
  }

  async acceptConsent(): Promise<void> {
    await this.page.evaluate(() =>
      (
        window as unknown as {
          __signingE2E: { acceptConsent: () => Promise<void> };
        }
      ).__signingE2E.acceptConsent(),
    );
  }

  async confirmOtp(code: string): Promise<void> {
    await this.page.evaluate(
      (c) =>
        (
          window as unknown as {
            __signingE2E: { confirmOtp: (c: string) => Promise<void> };
          }
        ).__signingE2E.confirmOtp(c),
      code,
    );
  }

  /** Convenience: pull the debug OTP echoed back by `request_otp` when
   *  the debug key is installed. Empty when the key is missing or the
   *  request hasn't been made yet. */
  async debugOtp(): Promise<string> {
    return (await this.state()).debugOtp;
  }
}
