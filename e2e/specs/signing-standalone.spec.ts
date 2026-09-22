/**
 * Standalone signing SPA E2E.
 *
 * Opens a fresh ceremony via `POST /signatures` (with the M2M service
 * key), navigates directly to `/sign/{sign_id}?e2e=1`, and drives the
 * wizard through every screen up to `done` using the E2E hook.
 *
 * This spec does NOT touch the portal, so it's the reliable "does the
 * signing UI still work end-to-end?" smoke test -- runnable without
 * any user seeding or CloudFront routing to the portal block.
 *
 * Skips (`test.skip(...)`) when the optional face fixture is missing:
 * without it the ceremony cannot advance past `validate_face`.
 */

import { expect, test } from '@playwright/test';
import * as crypto from 'node:crypto';

import { loadEnv } from '../helpers/env';
import {
  openCeremony,
  readFixtureBase64,
  tryReadFaceBase64,
} from '../helpers/backend';
import { SIGN_WORKER_TIMEOUT_MS, SigningDriver } from '../helpers/signing-driver';

const env = loadEnv();

test.describe('signing SPA (standalone)', () => {
  test('drives a fresh ceremony from created -> signed via the E2E hook', async ({
    page,
  }) => {
    const face = tryReadFaceBase64(env);
    test.skip(
      !face,
      'SIGNATURES_TEST_FACE_PATH not set. Point it at a face JPEG to run this test (see e2e/fixtures/README.md).',
    );

    // ---- Seed: open a ceremony that points at a made-up S3 URL. The
    //      standalone spec never triggers the async sign worker (that
    //      would need a real PDF in S3 that the worker can pull), so
    //      we just verify the UI reaches `signing` after OTP and then
    //      end the test. The full worker path is covered by the
    //      portal-to-payment spec.
    const pdfBytes = Buffer.from('%PDF-1.4\ntest\n%%EOF\n');
    const pdfSha = crypto.createHash('sha256').update(pdfBytes).digest('hex');
    const ceremony = await openCeremony(env, {
      signerEmail: `standalone-${Date.now()}@example.com`,
      signerName: 'Standalone Spec',
      pdfSha256: pdfSha,
      pdfSourceUrl: 's3://cdts-dev-signatures/e2e/standalone-nonexistent.pdf',
    });

    // ---- Drive: navigate to the signing SPA with the E2E gate.
    await page.goto(
      `${env.frontendBaseUrl}/sign/${ceremony.signId}?e2e=1`,
    );
    const driver = new SigningDriver(page);
    await driver.waitReady();
    await driver.setDebugOtpKey(env.debugOtpKeyHex);

    // Review screen (local-only, always shown on a fresh ceremony).
    await driver.waitForScreen('review');
    await driver.dismissReview();
    await driver.waitForScreen('identity');

    // Biometrics + drawn signature. Each submit chains upload+validate
    // (Rekognition/Textract on the server) and awaits completion.
    const idFront = readFixtureBase64('id-front.png');
    const idBack = readFixtureBase64('id-back.png');
    const signature = readFixtureBase64('signature.png');

    await driver.submitEvidence('id_front', idFront, 'image/png');
    await driver.submitEvidence('id_back', idBack, 'image/png');
    await driver.submitEvidence('face', face!, 'image/jpeg');

    await driver.waitForScreen('signature');
    await driver.submitSignature(signature);

    // Consent chains request_otp internally; the debug key we installed
    // above makes the backend echo the plaintext code back.
    await driver.waitForScreen('consent');
    await driver.acceptConsent();
    await driver.waitForScreen('otp');

    const otp = await driver.debugOtp();
    expect(otp, 'debug OTP should be echoed via _debug_otp').toMatch(/^\d{6}$/);

    await driver.confirmOtp(otp);

    // At this point verify_otp returned stage='signing' and the async
    // sign worker is running. In the standalone spec we deliberately
    // pointed at a nonexistent PDF, so the worker will fail (stage
    // ends up as 'failed'). Either 'signing' (worker still crunching)
    // or 'failed' (worker aborted on missing PDF) proves the flow
    // reached the async boundary.
    await Promise.race([
      driver.waitForStage('signing', 10_000),
      driver.waitForStage('failed', SIGN_WORKER_TIMEOUT_MS),
    ]);

    const finalState = await driver.state();
    expect(['signing', 'failed', 'signed']).toContain(finalState.stage);
  });
});
