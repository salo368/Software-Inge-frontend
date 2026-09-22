/**
 * Env-var loader for the E2E suite. Kept in one place so `.env` keys
 * are documented via a real TypeScript interface, and so tests can
 * `skip()` (not `fail()`) when required vars are missing -- the alternative
 * is opaque undefined dereferences deep in a fixture setup.
 *
 * `.env` file lives at `e2e/.env` (loaded by `playwright.config.ts`).
 * See `e2e/.env.example` for the full template.
 */

export interface E2EEnv {
  /** Root of the CloudFront distribution (`https://<id>.cloudfront.net`
   *  or a custom domain). Portal lives at `${FRONTEND_BASE_URL}/portal/`,
   *  signing at `${FRONTEND_BASE_URL}/sign/`. */
  frontendBaseUrl: string;

  /** signatures HTTP API base (matches `SIGNATURES_API_URL` in the
   *  backend). Used by the standalone spec to open ceremonies via
   *  `POST /signatures`. */
  signaturesApiUrl: string;

  /** processes HTTP API base. Used by portal-to-payment spec to seed
   *  a process straight into `stage='signature'`. */
  processesApiUrl: string;

  /** auth HTTP API base. Used by portal-to-payment spec to register a
   *  disposable test user. */
  authApiUrl: string;

  /** banks HTTP API base. Used by the seed to look up any bank id. */
  banksApiUrl: string;

  /** files HTTP API base. Used to upload a fake `declaracion_renta`
   *  before advancing the process to `signature`. */
  filesApiUrl: string;

  /** Shared secret behind `X-Service-Key` for `POST /signatures`. Kept
   *  in SSM under `/cdts/dev/signatures/service-key` on the backend
   *  side; supply the same value here. */
  signaturesServiceKey: string;

  /** HMAC key used to prove-you-are-a-test-caller for
   *  `POST /signatures/{sign_id}/otp`. Kept in SSM under
   *  `/cdts/dev/signatures/debug-otp-key` (only bootstrapped in dev).
   *  MUST be a hex string. */
  debugOtpKeyHex: string;

  /** Absolute path to a JPEG showing a face with open eyes. Optional;
   *  when unset, tests skip the face-validation happy path. */
  faceFixturePath: string;
}

/** Load + validate. Throws when a var is missing so tests can catch
 *  and skip with a clear message. */
export function loadEnv(): E2EEnv {
  const get = (k: string): string => {
    // bracket access to satisfy tsconfig `noPropertyAccessFromIndexSignature`.
    const v = process.env[k];
    if (!v) throw new Error(`missing env var ${k}; see e2e/.env.example`);
    return v;
  };

  return {
    frontendBaseUrl: get('FRONTEND_BASE_URL').replace(/\/$/, ''),
    signaturesApiUrl: get('SIGNATURES_API_URL').replace(/\/$/, ''),
    processesApiUrl: get('PROCESSES_API_URL').replace(/\/$/, ''),
    authApiUrl: get('AUTH_API_URL').replace(/\/$/, ''),
    banksApiUrl: get('BANKS_API_URL').replace(/\/$/, ''),
    filesApiUrl: get('FILES_API_URL').replace(/\/$/, ''),
    signaturesServiceKey: get('SIGNATURES_SERVICE_KEY'),
    debugOtpKeyHex: get('DEBUG_OTP_KEY_HEX'),
    faceFixturePath: process.env['SIGNATURES_TEST_FACE_PATH'] ?? '',
  };
}
