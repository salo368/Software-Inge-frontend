/**
 * Thin wrapper around `window.__signingE2E` (the hook installed by
 * `projects/signing/src/app/core/e2e-hooks.ts`). Each method here
 * corresponds to one action in the wizard and returns once the SPA call
 * settles, so the spec reads like a sequential script instead of a chain
 * of `waitFor`s.
 *
 * The driver is intentionally opinionated: it always talks to the hook
 * via `page.evaluate` and never touches the underlying HTTP APIs. That
 * way the frontend state machine, polling loop, and screen transitions
 * are all exercised.
 */

import type { Page } from '@playwright/test';

import type { E2EScreen, E2EState } from '../../projects/signing/src/app/core/e2e-hooks';
import type { BiometricType, SignatureStage } from '../../projects/signing/src/app/core/signatures.service';

/** Time budget for waiting for the E2E hook to appear on `window`. */
const HOOK_INSTALL_TIMEOUT_MS = 15_000;

/** Time budget for sign_doc (resolve-otp -> SIGNED). The backend fails it
 *  after 60 s; 2 minutes leaves headroom for polling. */
export const SIGN_WORKER_TIMEOUT_MS = 120_000;

type Hook = Record<string, (...args: unknown[]) => unknown>;

export class SigningDriver {
  constructor(private readonly page: Page) {}

  /** Blocks until `window.__signingE2E` is installed by the SPA. */
  async waitReady(): Promise<void> {
    await this.page.waitForFunction(
      () => !!(window as unknown as { __signingE2E?: unknown }).__signingE2E,
      undefined,
      { timeout: HOOK_INSTALL_TIMEOUT_MS },
    );
  }

  /** Snapshot the current wizard state. */
  async state(): Promise<E2EState> {
    return this.page.evaluate(
      () => (window as unknown as { __signingE2E: { getState: () => E2EState } }).__signingE2E.getState(),
    );
  }

  private call(method: string, ...args: unknown[]): Promise<unknown> {
    return this.page.evaluate(
      ({ method, args }) => (window as unknown as { __signingE2E: Hook }).__signingE2E[method](...args),
      { method, args },
    );
  }

  async waitForScreen(screen: E2EScreen, timeoutMs = 30_000): Promise<void> {
    await this.call('waitForScreen', screen, timeoutMs);
  }

  async waitForStage(stage: SignatureStage, timeoutMs = 60_000): Promise<void> {
    await this.call('waitForStage', stage, timeoutMs);
  }

  async dismissReview(): Promise<void> {
    await this.call('acknowledgeReview');
  }

  /** Email + terms (FORM -> BIOMETRICS). */
  async submitForm(email: string): Promise<void> {
    await this.call('submitForm', email);
  }

  async submitEvidence(type: BiometricType, base64: string, mime = 'image/jpeg'): Promise<void> {
    await this.call('submitEvidence', type, base64, mime);
  }

  /** Drawing (SIGNATURE -> OTP); the SPA requests the first OTP itself. */
  async submitSignature(base64: string): Promise<void> {
    await this.call('submitSignature', base64);
  }

  async requestOtp(): Promise<void> {
    await this.call('requestOtp');
  }

  async confirmOtp(code: string): Promise<void> {
    await this.call('confirmOtp', code);
  }
}
