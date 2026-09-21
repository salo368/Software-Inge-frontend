/**
 * v2 signatures API client.
 *
 * The signing SPA is the ONLY consumer of this service. It talks
 * exclusively to the `signatures` service (never to `processes`), and
 * uses the `sign_id` in the URL as the capability token -- there is no
 * user session or bearer token layered on top.
 *
 * Endpoints implemented here mirror the backend one-to-one. The
 * response shape of `get()` matches the enriched payload landed in
 * backend PR #70 (`Signatures.public_dict()` + handler extras).
 *
 * Naming quirk documented for future you: the ORM stores the drawn
 * signature under the key `signature`, while the HTTP API accepts
 * `signature_drawing` as the `evidence_type` in POST /upload-url. Both
 * appear here as `EvidenceTypeApi` / `EvidenceOrmKey` respectively;
 * `EVIDENCE_ORM_TO_API` bridges them.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, map, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';

// ---------------------------------------------------------------------------
// Stage machine (mirrors libs/orm/signatures.Signatures.stage)
// ---------------------------------------------------------------------------

export type CeremonyStage =
  | 'created'
  | 'identity'
  | 'consent'
  | 'otp'
  | 'signing'
  | 'signed'
  | 'failed'
  | 'expired';

/** Terminal stages: the ceremony cannot advance further. */
export const TERMINAL_STAGES: readonly CeremonyStage[] = [
  'signed',
  'failed',
  'expired',
];

/** Order used for "is server ahead of me?" comparisons. Terminals excluded on
 *  purpose -- they need dedicated handling, not a linear >= check. */
export const STAGE_ORDER: readonly CeremonyStage[] = [
  'created',
  'identity',
  'consent',
  'otp',
  'signing',
  'signed',
];

// ---------------------------------------------------------------------------
// Evidence naming
// ---------------------------------------------------------------------------

/** What the HTTP API accepts as `evidence_type` in POST /upload-url. */
export type EvidenceTypeApi =
  | 'id_front'
  | 'id_back'
  | 'face'
  | 'signature_drawing';

/** What the ORM (and therefore GET /signatures/{sign_id}.uploads_state) uses. */
export type EvidenceOrmKey = 'id_front' | 'id_back' | 'face' | 'signature';

/** Bridge ORM -> API. Used when the SPA reads uploads_state and then wants to
 *  re-upload the corresponding evidence. */
export const EVIDENCE_ORM_TO_API: Record<EvidenceOrmKey, EvidenceTypeApi> = {
  id_front: 'id_front',
  id_back: 'id_back',
  face: 'face',
  signature: 'signature_drawing',
};

/** Reverse bridge. Useful when a UI component owns EvidenceTypeApi and wants
 *  to peek into uploads_state for that evidence's current status. */
export const EVIDENCE_API_TO_ORM: Record<EvidenceTypeApi, EvidenceOrmKey> = {
  id_front: 'id_front',
  id_back: 'id_back',
  face: 'face',
  signature_drawing: 'signature',
};

// ---------------------------------------------------------------------------
// GET /signatures/{sign_id} response types
// ---------------------------------------------------------------------------

export interface SignatureLocation {
  page: number;
  x_pct: number;
  y_pct: number;
  width_pct?: number;
  height_pct?: number;
}

export interface EvidenceUploadState {
  uploaded: boolean;
  /** `null` for the drawn signature (no crypto validation step), `true`/`false`
   *  for the three biometric evidences. */
  validated: boolean | null;
  key: string | null;
  validated_at: string | null;
}

export type UploadsState = Record<EvidenceOrmKey, EvidenceUploadState>;

export interface ConsentState {
  given: boolean;
  given_at: string | null;
  terms_version: string | null;
}

export interface OtpState {
  requested: boolean;
  expires_at: string | null;
  attempts_left: number;
}

export interface Ceremony {
  sign_id: string;
  stage: CeremonyStage;
  signer_name: string | null;
  signer_email_masked: string;
  signature_location: SignatureLocation;
  uploads_state: UploadsState;
  consent: ConsentState;
  otp: OtpState;
  /** SHA-256 hex of the original PDF (safe to display for transparency). */
  hash_original: string;
  hash_signed: string | null;
  cert_serial: string | null;
  signed_at: string | null;
  created_at: string;
  expires_at: string;
  /** Presigned GET for original.pdf (15-min TTL). */
  pdf_url: string;
  /** Presigned GET for signed.pdf. Only present when stage === 'signed'. */
  signed_pdf_url?: string;
}

// ---------------------------------------------------------------------------
// Method-specific response shapes
// ---------------------------------------------------------------------------

export interface UploadUrlResponse {
  upload_url: string;
  key: string;
  expires_in: number;
}

export interface EvidenceValidationResponse {
  sign_id: string;
  stage: CeremonyStage;
  /** Only for id_front / id_back -- number of textract lines detected. */
  detected_lines?: number;
}

export interface RegisterSignatureResponse {
  sign_id: string;
  stage: CeremonyStage;
  bytes: number;
}

export interface ConsentResponse {
  sign_id: string;
  stage: CeremonyStage;
  consent: { given_at: string; terms_version: string };
}

export interface RequestOtpResponse {
  sign_id: string;
  stage: CeremonyStage;
  signer_email_masked: string;
  otp: {
    expires_at: string;
    attempts_left: number;
    email_sent: boolean;
  };
  /** ONLY populated when the request carries a valid
   *  `X-Debug-OTP-Signature` header AND the `debug-otp-key` SSM param
   *  exists on the server (dev only). Used by Playwright/E2E tests to
   *  skip the mailbox roundtrip. */
  _debug_otp?: string;
}

export interface VerifyOtpResponse {
  sign_id: string;
  stage: CeremonyStage;
}

// ---------------------------------------------------------------------------
// Debug OTP HMAC helper (browser side of backend's request_otp escape hatch)
// ---------------------------------------------------------------------------

/**
 * Compute `hex(HMAC-SHA256(key, sign_id))`. Must match the exact bytes
 * `_authorized_for_debug_otp` in
 * backend/services/signatures/src/handlers/request_otp/handler.py
 * verifies against `X-Debug-OTP-Signature`.
 *
 * @param debugKeyHex 64-hex-char string (the SecureString stored at
 *                    `/cdts/{stage}/signatures/debug-otp-key`).
 * @param signId      Ceremony capability token.
 */
export async function debugOtpSignature(
  debugKeyHex: string,
  signId: string,
): Promise<string> {
  if (!/^[0-9a-fA-F]+$/.test(debugKeyHex) || debugKeyHex.length % 2 !== 0) {
    throw new Error('debugKeyHex must be an even-length hex string');
  }
  const keyBytes = new Uint8Array(debugKeyHex.length / 2);
  for (let i = 0; i < debugKeyHex.length; i += 2) {
    keyBytes[i / 2] = parseInt(debugKeyHex.substring(i, i + 2), 16);
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(signId),
    ),
  );
  return Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Drives a signing ceremony from its `sign_id`. Creating the ceremony
 * (`POST /signatures` with `X-Service-Key`) is the host's job -- the
 * SPA only sees the `sign_id` via the URL.
 */
@Injectable({ providedIn: 'root' })
export class SignaturesService {
  private http = inject(HttpClient);
  private base = environment.signaturesApiUrl;

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /** Full ceremony state. Poll this on a timer to detect stage transitions
   *  driven by other tabs / the async sign worker. */
  get(signId: string): Observable<Ceremony> {
    return this.http.get<Ceremony>(`${this.base}/signatures/${signId}`);
  }

  // -------------------------------------------------------------------------
  // Evidence upload
  // -------------------------------------------------------------------------

  /** Presign a PUT to the signatures bucket. `contentType` MUST be one
   *  of the values accepted by `upload_url._EVIDENCE_MAP` for the given
   *  evidence type (`image/jpeg`|`image/png` for photos, `image/png`
   *  for the drawn signature).
   */
  presignEvidence(
    signId: string,
    evidenceType: EvidenceTypeApi,
    contentType: string,
  ): Observable<UploadUrlResponse> {
    return this.http.post<UploadUrlResponse>(
      `${this.base}/signatures/${signId}/upload-url`,
      { evidence_type: evidenceType, content_type: contentType },
    );
  }

  /** PUT the raw bytes to the presigned URL. Returns void on success; the
   *  server will read the object on the next validate/register call. */
  private putBlob(url: string, blob: Blob, contentType: string): Observable<void> {
    return from(
      fetch(url, {
        method: 'PUT',
        // The signed URL was created with signature_version='s3v4' and
        // implicitly includes the Content-Type in the signature, so we
        // MUST echo it here or S3 will return SignatureDoesNotMatch.
        headers: { 'Content-Type': contentType },
        body: blob,
      }),
    ).pipe(
      switchMap((resp) =>
        resp.ok
          ? [undefined as void]
          : throwError(() => new Error(`S3 PUT failed (${resp.status})`)),
      ),
    );
  }

  /** Convenience: presign + PUT in a single chain. Returns the presign
   *  metadata for callers that want the S3 key or the TTL. */
  uploadEvidence(
    signId: string,
    evidenceType: EvidenceTypeApi,
    blob: Blob,
    contentType: string,
  ): Observable<UploadUrlResponse> {
    return this.presignEvidence(signId, evidenceType, contentType).pipe(
      switchMap((presign) =>
        this.putBlob(presign.upload_url, blob, contentType).pipe(map(() => presign)),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Evidence validation (Rekognition / textract on the server)
  // -------------------------------------------------------------------------

  validateIdSide(
    signId: string,
    side: 'front' | 'back',
  ): Observable<EvidenceValidationResponse> {
    return this.http.post<EvidenceValidationResponse>(
      `${this.base}/signatures/${signId}/evidence/id-${side}`,
      {},
    );
  }

  validateFace(signId: string): Observable<EvidenceValidationResponse> {
    return this.http.post<EvidenceValidationResponse>(
      `${this.base}/signatures/${signId}/evidence/face`,
      {},
    );
  }

  /** Marks the drawn signature PNG as accepted evidence. Must be called
   *  AFTER `uploadEvidence(..., 'signature_drawing', ...)`. Once this
   *  succeeds AND the three biometric evidences are validated, the
   *  ceremony advances to `stage='consent'`. */
  registerSignature(signId: string): Observable<RegisterSignatureResponse> {
    return this.http.post<RegisterSignatureResponse>(
      `${this.base}/signatures/${signId}/evidence/signature`,
      {},
    );
  }

  // -------------------------------------------------------------------------
  // Consent + OTP
  // -------------------------------------------------------------------------

  /** Records the signer's explicit consent to sign. `termsVersion` must
   *  match `_KNOWN_TERMS_VERSIONS` in
   *  backend/services/signatures/src/handlers/consent/handler.py
   *  (currently only `'v1.0'`).
   *
   *  Setting `consent_given_at` is what unblocks `request_otp`; the
   *  stage stays `'consent'` after this call. */
  consent(signId: string, termsVersion = 'v1.0'): Observable<ConsentResponse> {
    return this.http.post<ConsentResponse>(
      `${this.base}/signatures/${signId}/consent`,
      { terms_version: termsVersion },
    );
  }

  /** Issues a fresh OTP and emails it to the signer. Idempotent within
   *  the OTP TTL: calling again while a code is live re-sends the same
   *  code without incrementing counters.
   *
   *  When `debugKeyHex` is supplied (dev only), the SPA computes the
   *  HMAC and passes it in `X-Debug-OTP-Signature`, causing the backend
   *  to return the plaintext in `_debug_otp` for automated tests. In
   *  prod builds this parameter should NEVER be populated -- the debug
   *  key must not exist in the browser at all. */
  requestOtp(
    signId: string,
    debugKeyHex?: string,
  ): Observable<RequestOtpResponse> {
    const url = `${this.base}/signatures/${signId}/otp`;
    if (!debugKeyHex) {
      return this.http.post<RequestOtpResponse>(url, {});
    }
    // Async HMAC signing wrapped as an Observable via `from(promise)`.
    return from(debugOtpSignature(debugKeyHex, signId)).pipe(
      switchMap((sig) =>
        this.http.post<RequestOtpResponse>(url, {}, {
          headers: { 'X-Debug-OTP-Signature': sig },
        }),
      ),
    );
  }

  /** Verifies the 6-digit code and, on success, kicks off the async
   *  `sign` Lambda. Response returns `stage='signing'`; the SPA must
   *  then poll `get()` until `stage='signed'` (or a terminal). */
  verifyOtp(signId: string, code: string): Observable<VerifyOtpResponse> {
    return this.http.post<VerifyOtpResponse>(
      `${this.base}/signatures/${signId}/otp/verify`,
      { code },
    );
  }
}
