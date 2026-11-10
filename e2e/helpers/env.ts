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

  /** auth HTTP API base. Registers a disposable test user. */
  authApiUrl: string;

  /** banks HTTP API base. `GET /banks/simulate` picks a bank for the seed. */
  banksApiUrl: string;

  /** forms HTTP API base. `PUT /forms/upsert-form` fills the KYC form. */
  formsApiUrl: string;

  /** files HTTP API base. Uploads the required documents. */
  filesApiUrl: string;

  /** processes HTTP API base. Seeds a process up to `SIGNATURE`. */
  processesApiUrl: string;

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
    authApiUrl: get('AUTH_API_URL').replace(/\/$/, ''),
    banksApiUrl: get('BANKS_API_URL').replace(/\/$/, ''),
    formsApiUrl: get('FORMS_API_URL').replace(/\/$/, ''),
    filesApiUrl: get('FILES_API_URL').replace(/\/$/, ''),
    processesApiUrl: get('PROCESSES_API_URL').replace(/\/$/, ''),
    faceFixturePath: process.env['SIGNATURES_TEST_FACE_PATH'] ?? '',
  };
}
