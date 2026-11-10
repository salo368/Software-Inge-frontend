/**
 * Thin backend clients used by the E2E fixtures. Only covers the
 * endpoints we actually need to seed state; no attempt at completeness.
 *
 * WHY this file exists
 * --------------------
 *
 * The Playwright specs test the FRONTEND. Getting to the interesting
 * screens (a process at `stage='SIGNATURE'` with its signature open) via
 * UI clicks takes a while and re-tests what PAREX already covers. So we
 * call the backend directly to jump straight to the state under test.
 *
 * Signatures can no longer be opened over HTTP: `processes.generate_sign`
 * opens them when the process documents are complete. So the seed walks
 * the real process flow (create -> form -> documents) and waits for the
 * `signature_id` to show up.
 *
 * All calls are plain `fetch`; no auth interceptor, no retries. If the
 * environment is down, the spec fails loudly at seed time -- which is
 * exactly what we want.
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
 *  re-running the suite never collides. */
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
    throw new Error(`register failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { user: { id: string }; token: string };
  return { userId: body.user.id, email, password, fullName, token: body.token };
}

// ---------------------------------------------------------------------------
// Process seed: FORM -> DOCUMENTS -> SIGNATURE
// ---------------------------------------------------------------------------

export interface SeededProcess {
  processId: string;
  signatureId: string;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function json<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as T;
}

/**
 * Seeds a fresh process for `user` and drives it to `SIGNATURE`, with the
 * investment-order signature already open (`signature_id` set). The
 * form declares the user non-PEP and non-declarant, so only `BANK_CERT`
 * is required.
 */
export async function seedProcessAtSignatureStage(
  env: E2EEnv,
  user: RegisteredUser,
): Promise<SeededProcess> {
  const auth = { Authorization: `Bearer ${user.token}` };
  const jsonAuth = { ...auth, 'Content-Type': 'application/json' };
  const amount = 5_000_000;
  const term = 360;

  // 1. Pick any bank that covers (amount, term).
  const sim = await json<{ banks: Record<string, unknown> }>(
    await fetch(`${env.banksApiUrl}/banks/simulate?amount=${amount}&term=${term}`),
    'simulate',
  );
  const bankId = Number(Object.keys(sim.banks)[0]);
  if (!Number.isFinite(bankId)) throw new Error('simulate returned no banks');

  // 2. Process in FORM.
  const created = await json<{ id: string }>(
    await fetch(`${env.processesApiUrl}/processes/create-process`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ bank_id: bankId, amount: String(amount), term }),
    }),
    'create-process',
  );
  const processId = created.id;

  // 3. KYC form (one per user) + snapshot into the process -> DOCUMENTS.
  await json(
    await fetch(`${env.formsApiUrl}/forms/upsert-form`, {
      method: 'PUT',
      headers: jsonAuth,
      body: JSON.stringify({
        name: 'E2E',
        last_name: 'Usuario',
        gender: 'O',
        birth_date: '1995-01-01',
        birth_country: 'COLOMBIA',
        birth_department: 'QUINDIO',
        birth_city: 'ARMENIA',
        nationality: 'COLOMBIA',
        email: user.email,
        document_type: 'CC',
        document_number: String(Date.now()).slice(-10),
        document_issuance_date: '2013-01-15',
        document_issuance_country: 'COLOMBIA',
        document_issuance_department: 'CUNDINAMARCA',
        document_issuance_city: 'USAQUEN',
        phone_ext: '57',
        phone_number: '3000000000',
        civil_status: 'SINGLE',
        education_level: 'PROFESSIONAL',
        is_pep: false,
        monthly_income: 10_000_000,
        monthly_expenses: 4_000_000,
        total_assets: 30_000_000,
        total_liabilities: 0,
        is_tax_declarant: false,
      }),
    }),
    'upsert-form',
  );
  await json(
    await fetch(`${env.processesApiUrl}/processes/set-process-form`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({ process_id: processId }),
    }),
    'set-process-form',
  );

  // 4. Upload BANK_CERT (presigned PUT with the signed headers).
  const presign = await json<{ upload_url: string; upload_headers: Record<string, string> }>(
    await fetch(`${env.filesApiUrl}/files/upload-url`, {
      method: 'POST',
      headers: jsonAuth,
      body: JSON.stringify({
        process_id: processId,
        file_type: 'BANK_CERT',
        content_type: 'image/png',
        original_name: 'e2e-bank-cert.png',
      }),
    }),
    'files/upload-url',
  );
  const put = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: presign.upload_headers,
    body: PNG_1PX,
  });
  if (!put.ok) throw new Error(`S3 PUT failed: ${put.status}`);

  // 5. Poll: get-required-files fires generate_sign once the file is
  //    registered; get-processes shows the signature_id when it's open.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await fetch(
      `${env.processesApiUrl}/processes/get-required-files?process_id=${processId}`,
      { headers: auth },
    );
    const list = await json<{ processes: { id: string; stage: string; signature_id: string | null }[] }>(
      await fetch(`${env.processesApiUrl}/processes/get-processes`, { headers: auth }),
      'get-processes',
    );
    const p = list.processes.find((x) => x.id === processId);
    if (p?.stage === 'SIGNATURE' && p.signature_id) {
      return { processId, signatureId: p.signature_id };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`process ${processId} did not reach SIGNATURE in time`);
}

// ---------------------------------------------------------------------------
// OTP
// ---------------------------------------------------------------------------

/** Why the specs that need the OTP are `test.fixme`. Same reason as PAREX. */
export const OTP_BLOCKED_REASON =
  'El backend ya no expone un OTP de prueba (set-otp solo lo envia por correo). ' +
  'Reactivar cuando exista una fuente automatizable del codigo.';

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
