/**
 * Standalone signing SPA E2E.
 *
 * Seeds a process up to SIGNATURE through the API (the backend opens the
 * signature itself; there is no way to open one directly anymore), then
 * navigates straight to `/sign/{signature_id}?e2e=1` -- no `return_url`,
 * like a bare link opened on a phone -- and drives the wizard with the E2E
 * hook up to the OTP screen.
 *
 * The OTP is only emailed now, so confirming it is out of reach for this
 * spec (see `OTP_BLOCKED_REASON`); the full worker path lives in
 * portal-to-payment.spec.ts as `fixme`.
 *
 * Skips when the optional face fixture is missing: without it the
 * ceremony cannot get past the face validation.
 */

import { expect, test } from '@playwright/test';

import { loadEnv } from '../helpers/env';
import {
  readFixtureBase64,
  registerTestUser,
  seedProcessAtSignatureStage,
  tryReadFaceBase64,
} from '../helpers/backend';
import { SigningDriver } from '../helpers/signing-driver';

const env = loadEnv();

test.describe('signing SPA (standalone)', () => {
  test('drives a fresh signature from FORM to OTP via the E2E hook', async ({ page }) => {
    const face = tryReadFaceBase64(env);
    test.skip(
      !face,
      'SIGNATURES_TEST_FACE_PATH not set. Point it at a face JPEG to run this test (see e2e/fixtures/README.md).',
    );

    // ---- Seed: user + process at SIGNATURE with its signature open.
    const user = await registerTestUser(env);
    const { signatureId } = await seedProcessAtSignatureStage(env, user);

    // ---- Drive: signing SPA with the E2E gate and no return_url.
    await page.goto(`${env.frontendBaseUrl}/sign/${signatureId}?e2e=1`);
    const driver = new SigningDriver(page);
    await driver.waitReady();

    await driver.waitForScreen('review');
    await driver.dismissReview();
    await driver.waitForScreen('form');

    await driver.submitForm(user.email);
    await driver.waitForScreen('identity');

    await driver.submitEvidence('ID_FRONT', readFixtureBase64('id-front.png'), 'image/png');
    await driver.submitEvidence('ID_BACK', readFixtureBase64('id-back.png'), 'image/png');
    await driver.submitEvidence('FACE', face!, 'image/jpeg');

    await driver.waitForScreen('signature');
    await driver.submitSignature(readFixtureBase64('signature.png'));

    await driver.waitForScreen('otp');
    const state = await driver.state();
    expect(state.stage).toBe('OTP');
    expect(state.otpSent).toBe(true);
    expect(state.error).toBe('');

    // Standalone: no way back to a portal.
    await expect(page.locator('#signing-return-to-process')).toHaveCount(0);
  });
});
