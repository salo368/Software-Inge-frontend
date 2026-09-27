/**
 * Thin backend clients used by the E2E fixtures. Only covers the
 * endpoints we actually need to seed state; no attempt at completeness.
 *
 * WHY this file exists
 * --------------------
 *
 * The Playwright specs test the FRONTEND. Getting to the interesting
 * screens (a process at `stage='signature'`, an open ceremony) via UI
 * clicks would take ~30 seconds per test and shake out bugs in code we
 * already cover in unit + backend integration tests. So we call the
 * backend directly to jump straight to the state under test.
 *
 * All calls are plain `fetch`; no auth interceptor, no retries. If the
 * dev environment is down, the spec fails loudly at seed time -- which
 * is exactly what we want.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { E2EEnv } from './env';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface RegisteredUser {
  userId: string;
  email: string;
  password: string;
  fullName: string;
  token: string;
}

/** Register a fresh disposable user. Emails are timestamped so
 *  re-running the suite never collides. Password is fixed since we
 *  don't test the password policy here. */
export async function registerTestUser(env: E2EEnv): Promise<RegisteredUser> {
  const rand = crypto.randomBytes(4).toString('hex');
  const email = `e2e-${Date.now()}-${rand}@example.com`;
  const password = 'E2E-test-password-123';
  const fullName = `E2E User ${rand}`;

  const res = await fetch(`${env.authApiUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, full_name: fullName }),
  });
  if (!res.ok) {
    throw new Error(
      `register failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  const body = (await res.json()) as { user: { id: string }; token: string };
  return { userId: body.user.id, email, password, fullName, token: body.token };
}

// ---------------------------------------------------------------------------
// Processes: seed to stage=signature (documents just uploaded, ready
// for the user to click "Firmar ahora")
// ---------------------------------------------------------------------------

interface ProcessRow {
  id: string;
  stage: 'form' | 'documents' | 'signature' | 'payment' | 'done';
  bank_id: number;
  amount: number;
  term_days: number;
  rate: number;
  sign_id?: string;
}

/**
 * Seeds a fresh process for `user` and drives it up to (but not
 * through) `stage='signature'`. The signature ceremony is NOT opened
 * here -- opening it is what the portal `Firmar ahora` button triggers,
 * which is exactly the UX we want the Playwright test to cover.
 *
 * Returns the process id so the spec can `goto('/portal/procesos/<id>')`.
 */
export async function seedProcessAtSignatureStage(
  env: E2EEnv,
  user: RegisteredUser,
): Promise<string> {
  const authH = { Authorization: `Bearer ${user.token}` };

  // 1. Pick any bank.
  const banksRes = await fetch(`${env.banksApiUrl}/banks`, { headers: authH });
  if (!banksRes.ok) {
    throw new Error(`banks list failed: ${banksRes.status}`);
  }
  const { banks } = (await banksRes.json()) as {
    banks: Array<{ id: number }>;
  };
  if (!banks.length) throw new Error('no banks seeded in this dev env');
  const bankId = banks[0].id;

  // 2. Create process (starts at stage='form').
  const createRes = await fetch(`${env.processesApiUrl}/processes`, {
    method: 'POST',
    headers: { ...authH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bank_id: bankId,
      amount: 5_000_000,   // 5M COP; irrelevant, but the API validates > 0.
      term_days: 365,
      rate: 12.5,
    }),
  });
  if (!createRes.ok) {
    throw new Error(
      `create process failed: ${createRes.status} ${await createRes.text().catch(() => '')}`,
    );
  }
  const proc: ProcessRow = ((await createRes.json()) as { process: ProcessRow })
    .process;

  // 3. Upsert form data (required to advance form -> documents).
  const formRes = await fetch(`${env.processesApiUrl}/forms/me`, {
    method: 'PUT',
    headers: { ...authH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: user.fullName,
      document_number: '1234567890',
      document_type: 'CC',
      phone: '3001234567',
      address: 'Cra 1 # 2-3',
      city: 'Bogota',
      birth_date: '1990-01-15',
    }),
  }).catch(() => null);
  // Form service exposes /forms/me on the processes API URL in most
  // envs; be lenient about a wrong URL and let the advance call fail
  // with a friendlier error.
  if (formRes && !formRes.ok && formRes.status !== 404) {
    // Non-fatal: some envs mount forms elsewhere. The advance below
    // will 400 if the row is truly missing, and that's the clearer
    // signal.
  }

  // 4. Advance form -> documents.
  await advance(env, user, proc.id);

  // 5. Upload a fake declaracion_renta so advance documents -> signature
  //    passes the `declaracion_renta_required` gate.
  await uploadDeclaracionRenta(env, user, proc.id);

  // 6. Advance documents -> signature. NOTE: this ALSO opens the
  //    ceremony server-side (see processes/advance handler), so
  //    `sign_url` is in the response. We DELIBERATELY ignore it here
  //    -- the Playwright test is going to click "Firmar ahora" in the
  //    portal, which will call advance again and reuse the existing
  //    sign_id (portal detects a live ceremony and jumps directly).
  await advance(env, user, proc.id);

  return proc.id;
}

async function advance(
  env: E2EEnv,
  user: RegisteredUser,
  processId: string,
): Promise<void> {
  const res = await fetch(
    `${env.processesApiUrl}/processes/${processId}/advance`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  );
  if (!res.ok) {
    throw new Error(
      `advance ${processId} failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
}

async function uploadDeclaracionRenta(
  env: E2EEnv,
  user: RegisteredUser,
  processId: string,
): Promise<void> {
  const authH = { Authorization: `Bearer ${user.token}` };
  const body = {
    process_id: processId,
    file_type: 'declaracion_renta',
    content_type: 'application/pdf',
    original_name: 'declaracion.pdf',
  };
  const presign = await fetch(`${env.filesApiUrl}/files/upload-url`, {
    method: 'POST',
    headers: { ...authH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!presign.ok) {
    throw new Error(
      `presign declaracion failed: ${presign.status} ${await presign.text().catch(() => '')}`,
    );
  }
  const presignJson = (await presign.json()) as {
    upload_url: string;
    upload_headers?: Record<string, string>;
    content_type: string;
  };

  // Minimal one-page PDF (well-formed enough that S3 doesn't reject
  // it -- S3 doesn't sniff, but the size + header lets our downstream
  // sanity checks pass).
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
  );

  const put = await fetch(presignJson.upload_url, {
    method: 'PUT',
    headers: presignJson.upload_headers ?? {
      'Content-Type': presignJson.content_type,
    },
    body: pdf,
  });
  if (!put.ok) {
    throw new Error(`S3 PUT declaracion failed: ${put.status}`);
  }
  // The files service registers the row asynchronously via an S3
  // event, so the row is not visible immediately. Poll for a few
  // seconds until it shows up on the process detail. `advance` would
  // fail with `declaracion_renta_required` if we skipped this.
  for (let i = 0; i < 20; i++) {
    const detail = await fetch(
      `${env.processesApiUrl}/processes/${processId}`,
      { headers: authH },
    );
    if (detail.ok) {
      const d = (await detail.json()) as {
        files: Array<{ file_type: string }>;
      };
      if (d.files.some((f) => f.file_type === 'declaracion_renta')) return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    'declaracion_renta never registered on the process (S3 event delay?)',
  );
}

// ---------------------------------------------------------------------------
// Signatures: open a raw ceremony for the standalone spec
// ---------------------------------------------------------------------------

export interface OpenCeremonyOptions {
  signerEmail: string;
  signerName: string;
  /** SHA-256 hex of the PDF the ceremony will sign. */
  pdfSha256: string;
  /** S3 URI (`s3://bucket/key.pdf`) OR a presigned GET URL where the
   *  worker can fetch the source PDF. */
  pdfSourceUrl: string;
  /** Optional; defaults to a sensible spot. */
  signatureLocation?: {
    page: number;
    x_pct: number;
    y_pct: number;
    width_pct?: number;
    height_pct?: number;
  };
}

export interface OpenedCeremony {
  signId: string;
  signUrl: string;
}

/** Directly opens a fresh ceremony via `POST /signatures`. Requires the
 *  M2M service key (only known to the backend + this test suite). */
export async function openCeremony(
  env: E2EEnv,
  opts: OpenCeremonyOptions,
): Promise<OpenedCeremony> {
  const res = await fetch(`${env.signaturesApiUrl}/signatures`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': env.signaturesServiceKey,
    },
    body: JSON.stringify({
      signer_email: opts.signerEmail,
      signer_name: opts.signerName,
      pdf_sha256: opts.pdfSha256,
      pdf_source_url: opts.pdfSourceUrl,
      signature_location: opts.signatureLocation ?? {
        page: 0,
        x_pct: 60,
        y_pct: 85,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `open ceremony failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  const body = (await res.json()) as { sign_id: string; sign_url: string };
  return { signId: body.sign_id, signUrl: body.sign_url };
}

// ---------------------------------------------------------------------------
// Fixture helpers (base64 encoding + face-fixture reader)
// ---------------------------------------------------------------------------

/** Absolute path to the checked-in fixtures directory. Resolved from
 *  this file's location so the tests work regardless of the process
 *  cwd. */
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

/** Read a checked-in binary fixture as base64. Path is relative to
 *  `e2e/fixtures/`. */
export function readFixtureBase64(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name)).toString('base64');
}

/** Read the optional face fixture (path from `SIGNATURES_TEST_FACE_PATH`).
 *  Returns null when the env var is missing or the file does not exist. */
export function tryReadFaceBase64(env: E2EEnv): string | null {
  if (!env.faceFixturePath) return null;
  if (!fs.existsSync(env.faceFixturePath)) return null;
  return fs.readFileSync(env.faceFixturePath).toString('base64');
}
