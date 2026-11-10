/**
 * Full portal-to-payment E2E.
 *
 *   1. Register a fresh user via `POST /auth/register`.
 *   2. Seed a process up to `SIGNATURE` via API (form + documents; the
 *      backend opens the signature itself).
 *   3. Sign into the portal in the browser (localStorage token).
 *   4. Click "Firmar ahora" -> assert redirect to `/sign/{signature_id}?...`.
 *   5. Drive the signing SPA via the E2E hook through the full ceremony,
 *      including sign_doc producing a real signed PDF.
 *   6. Click "Volver al proceso" -> land back on the portal.
 *   7. The `signed` webhook moves the process to PAYMENT and the portal
 *      renders the payment step.
 *
 * Blocked (`test.fixme`) on step 5: the OTP is only emailed now. See
 * `OTP_BLOCKED_REASON`.
 */

import { expect, test } from '@playwright/test';

import { loadEnv } from '../helpers/env';
import {
  OTP_BLOCKED_REASON,
  readFixtureBase64,
  registerTestUser,
  seedProcessAtSignatureStage,
  tryReadFaceBase64,
} from '../helpers/backend';
import { SIGN_WORKER_TIMEOUT_MS, SigningDriver } from '../helpers/signing-driver';

const env = loadEnv();

/** Plug a real OTP source here (mailbox, test endpoint) to re-enable the spec. */
async function obtainOtp(_signatureId: string): Promise<string> {
  throw new Error(OTP_BLOCKED_REASON);
}

test.describe('portal -> signing -> return -> payment', () => {
  test.fixme(true, OTP_BLOCKED_REASON);

  test('full happy path', async ({ page }) => {
    const face = tryReadFaceBase64(env);
    test.skip(
      !face,
      'SIGNATURES_TEST_FACE_PATH not set. Point it at a face JPEG to run this test (see e2e/fixtures/README.md).',
    );

    // Step 1-2: register user + seed process to SIGNATURE.
    const user = await registerTestUser(env);
    const { processId, signatureId } = await seedProcessAtSignatureStage(env, user);

    // Step 3: AuthService reads the token from localStorage on boot.
    await page.goto(`${env.frontendBaseUrl}/portal/login`);
    await page.evaluate(
      ({ token, user }) => {
        localStorage.setItem('cdts_token', token);
        localStorage.setItem('cdts_user', JSON.stringify(user));
      },
      {
        token: user.token,
        user: { id: user.userId, email: user.email, full_name: user.fullName },
      },
    );

    // Step 4: process page -> "Firmar ahora".
    await page.goto(`${env.frontendBaseUrl}/portal/process/${processId}`);
    const signButton = page.locator('#process-signature-start');
    await expect(signButton).toBeEnabled({ timeout: 20_000 });

    await Promise.all([
      page.waitForURL(new RegExp(`/sign/${signatureId}`), { timeout: 30_000 }),
      signButton.click(),
    ]);

    // Step 5: the portal doesn't add `?e2e=1`; reload with it.
    const signingUrl = new URL(page.url());
    signingUrl.searchParams.set('e2e', '1');
    await page.goto(signingUrl.toString());

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

    await driver.confirmOtp(await obtainOtp(signatureId));
    await driver.waitForStage('SIGNED', SIGN_WORKER_TIMEOUT_MS);
    await driver.waitForScreen('done');

    // Step 6: back to the portal.
    await Promise.all([
      page.waitForURL(new RegExp(`/portal/process/${processId}`), { timeout: 30_000 }),
      page.locator('#signing-return-to-process').click(),
    ]);

    // Step 7: webhook -> PAYMENT.
    await expect(page.locator('#process-stage-payment')).toBeVisible({ timeout: 90_000 });
  });
});
