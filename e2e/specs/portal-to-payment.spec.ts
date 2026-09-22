/**
 * Full portal-to-payment E2E.
 *
 *   1. Register a fresh user via `POST /auth/register`.
 *   2. Seed a process up to `stage='signature'` via API (form + docs
 *      upload + advance), so the test lands directly on the screen
 *      that has the "Firmar ahora" button.
 *   3. Sign into the portal in the browser (localStorage token).
 *   4. Click "Firmar ahora" -> assert redirect to `/sign/{sign_id}?...`.
 *   5. Drive the signing SPA via the E2E hook through the full
 *      ceremony -- including the async sign worker producing a real
 *      signed PDF -- and assert the `done` screen renders.
 *   6. Click "Volver al proceso" -> assert we land back on the
 *      portal page.
 *   7. Assert the portal detects `signature.stage === 'signed'`,
 *      auto-advances the process, and renders the `payment` step.
 *
 * This is the acceptance test for the whole signing feature. Skips
 * when the face fixture is missing (see e2e/fixtures/README.md).
 */

import { expect, test } from '@playwright/test';
import * as crypto from 'node:crypto';

import { loadEnv } from '../helpers/env';
import {
  readFixtureBase64,
  registerTestUser,
  seedProcessAtSignatureStage,
  tryReadFaceBase64,
} from '../helpers/backend';
import { SIGN_WORKER_TIMEOUT_MS, SigningDriver } from '../helpers/signing-driver';

const env = loadEnv();

test.describe('portal -> signing -> return -> payment', () => {
  test('full happy path', async ({ page }) => {
    const face = tryReadFaceBase64(env);
    test.skip(
      !face,
      'SIGNATURES_TEST_FACE_PATH not set. Point it at a face JPEG to run this test (see e2e/fixtures/README.md).',
    );

    // -------------------------------------------------------------------
    // Step 1-2: register user + seed process to stage=signature.
    // -------------------------------------------------------------------
    const user = await registerTestUser(env);
    const processId = await seedProcessAtSignatureStage(env, user);

    // -------------------------------------------------------------------
    // Step 3: sign into the portal in the browser. AuthService reads
    // the token from localStorage on boot, so we just seed it before
    // the first navigation.
    // -------------------------------------------------------------------
    // Prime localStorage on the same origin as the portal. Playwright
    // requires a page to be loaded before `localStorage` is writable.
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

    // -------------------------------------------------------------------
    // Step 4: navigate to the process page and click "Firmar ahora".
    // We don't hardcode the route; the portal uses `/portal/procesos/{id}`.
    // The `advance` call the button triggers reuses the ceremony
    // opened by the seed above (portal detects it via `signature.stage
    // !== 'signed'` and jumps straight to sign_url).
    // -------------------------------------------------------------------
    await page.goto(`${env.frontendBaseUrl}/portal/procesos/${processId}`);

    // Wait for the process page to render the signature step. The
    // portal shows the CTA text 'Firmar ahora' when there is no
    // pending ceremony -- since the seed left one open, the CTA is
    // actually 'Continuar mi firma'. Match either.
    const signButton = page.getByRole('button', {
      name: /Firmar ahora|Continuar mi firma/i,
    });
    await expect(signButton).toBeVisible({ timeout: 15_000 });

    // Clicking triggers a redirect to /sign/{id}?return_url=... The
    // portal calls `window.location.assign`, which Playwright follows
    // as a normal navigation.
    await Promise.all([
      page.waitForURL(/\/sign\/[a-f0-9-]{36}/i, { timeout: 30_000 }),
      signButton.click(),
    ]);

    // -------------------------------------------------------------------
    // Step 5: drive the signing SPA. The redirect URL doesn't have
    // `?e2e=1` (the portal doesn't add it) so we manually reload with
    // that flag. This is the one place the test is not 100% "as a
    // real user"; the trade-off is documented in e2e-hooks.ts.
    // -------------------------------------------------------------------
    const signingUrl = new URL(page.url());
    signingUrl.searchParams.set('e2e', '1');
    await page.goto(signingUrl.toString());

    const driver = new SigningDriver(page);
    await driver.waitReady();
    await driver.setDebugOtpKey(env.debugOtpKeyHex);

    await driver.waitForScreen('review');
    await driver.dismissReview();
    await driver.waitForScreen('identity');

    const idFront = readFixtureBase64('id-front.png');
    const idBack = readFixtureBase64('id-back.png');
    const signature = readFixtureBase64('signature.png');

    await driver.submitEvidence('id_front', idFront, 'image/png');
    await driver.submitEvidence('id_back', idBack, 'image/png');
    await driver.submitEvidence('face', face!, 'image/jpeg');

    await driver.waitForScreen('signature');
    await driver.submitSignature(signature);

    await driver.waitForScreen('consent');
    await driver.acceptConsent();
    await driver.waitForScreen('otp');

    const otp = await driver.debugOtp();
    expect(otp, 'debug OTP should be echoed via _debug_otp').toMatch(/^\d{6}$/);
    await driver.confirmOtp(otp);

    // Async worker: verify_otp returns stage='signing'; we wait for
    // the callback to advance to 'signed' (up to SIGN_WORKER_TIMEOUT_MS).
    await driver.waitForStage('signed', SIGN_WORKER_TIMEOUT_MS);
    await driver.waitForScreen('done');

    // -------------------------------------------------------------------
    // Step 6: click "Volver al proceso" and confirm we land back on
    // the portal page.
    // -------------------------------------------------------------------
    const returnButton = page.getByRole('button', {
      name: /Volver al proceso|Volver/i,
    });
    await expect(returnButton).toBeVisible({ timeout: 10_000 });

    await Promise.all([
      page.waitForURL(new RegExp(`/portal/procesos/${processId}`), {
        timeout: 30_000,
      }),
      returnButton.click(),
    ]);

    // -------------------------------------------------------------------
    // Step 7: the portal's `maybeAutoAdvanceAfterSigning` should fire
    // on load and move the process from `signature` to `payment`. The
    // stepper renders `bi-credit-card` when the current step is
    // payment; simpler + more robust: assert the header text.
    // -------------------------------------------------------------------
    const paymentHeading = page.getByRole('heading', { name: /Pago/i });
    await expect(paymentHeading).toBeVisible({ timeout: 20_000 });
  });
});
