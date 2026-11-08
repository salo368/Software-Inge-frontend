/**
 * Client of the `signatures` service (backend docs/signatures-api.md).
 *
 * The signing SPA is the only consumer that drives a signature. It talks
 * exclusively to `signatures` and uses the `signature_id` in the URL as the
 * capability token: no endpoint takes a bearer token. Each endpoint also
 * checks the current stage, so steps cannot be skipped.
 *
 * Signatures are not opened over HTTP: `processes.generate_sign` opens them
 * Lambda-to-Lambda, and the portal hands the id to this block.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, map, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';

// ---------------------------------------------------------------------------
// Lifecycle (backend enum `SignatureStage`, §3)
// ---------------------------------------------------------------------------

export type SignatureStage =
  | 'FORM'
  | 'BIOMETRICS'
  | 'SIGNATURE'
  | 'OTP'
  | 'SIGNING'
  | 'SIGNED'
  | 'FAILED';

/** Terminal stages: the signature cannot advance further. */
export const TERMINAL_STAGES: readonly SignatureStage[] = ['SIGNED', 'FAILED'];

/** 15-minute window from `created_at` (`SIGNING_WINDOW`). */
export const SIGNING_WINDOW_MS = 15 * 60 * 1000;
/** Each OTP lives 2 minutes (`OTP_TTL`). */
export const OTP_TTL_MS = 2 * 60 * 1000;
/** Third wrong code fails the signature (`MAX_OTP_TRIES`). */
export const MAX_OTP_TRIES = 3;

// ---------------------------------------------------------------------------
// Biometrics
// ---------------------------------------------------------------------------

export type BiometricType = 'ID_FRONT' | 'ID_BACK' | 'FACE';

export const BIOMETRIC_TYPES: readonly BiometricType[] = ['ID_FRONT', 'ID_BACK', 'FACE'];

export type BiometricContentType = 'image/jpeg' | 'image/png';

/** `GET /signatures/get-required-biometrics`: `true` once validated. */
export type RequiredBiometrics = Record<BiometricType, boolean>;

/**
 * `reason` of `POST /signatures/set-biometrics`. A rejected evidence is a 200
 * with `is_valid: false`; it can be re-uploaded and validated again.
 */
export type BiometricReason =
  | 'ok'
  | 'evidence_missing'
  | 'evidence_too_large'
  | 'too_few_legible_lines'
  | 'no_id_number_detected'
  | 'no_face_detected'
  | 'multiple_faces'
  | 'low_confidence'
  | 'eyes_closed';

export interface BiometricValidation {
  is_valid: boolean;
  reason: BiometricReason | string;
}

// ---------------------------------------------------------------------------
// GET /signatures/get-signature
// ---------------------------------------------------------------------------

/** One signature box, in percentages from the top-left corner. */
export interface SignLocation {
  /** 1-based. */
  page: number;
  x_pct: number;
  y_pct: number;
  /** Default 25. */
  width_pct?: number;
  /** Derived from the drawing's aspect ratio when missing. */
  height_pct?: number;
}

export interface Signature {
  id: string;
  stage: SignatureStage;
  sign_location: SignLocation[];
  /** Presigned GET (15 min) of the original, unsigned PDF. */
  doc_url: string;
  /** End of the signing window (`created_at` + 15 min). */
  expires_at: string;
  /** PDF with the drawing stamped, no evidence page. `null` until SIGNED. */
  raw_signed_url: string | null;
  /** Final PDF: drawing + evidence page + PAdES-B. `null` until SIGNED. */
  signed_url: string | null;
  /** SHA-256 of `raw_signed` (the one printed on the evidence page). */
  doc_hash: string | null;
  /** SHA-256 of `signed`. */
  signed_hash: string | null;
  signed_at: string | null;
}

// ---------------------------------------------------------------------------
// Mutation responses
// ---------------------------------------------------------------------------

export interface StageResponse {
  id: string;
  stage: SignatureStage;
}

interface BiometricUploadUrl {
  upload_url: string;
  /** `signatures/<signature_id>/<type>.<ext>`; goes back in set-biometrics. */
  key: string;
  content_type: BiometricContentType;
  expires_in: number;
}

export interface SetOtpResponse extends StageResponse {
  /** `false`: the mail server refused it; the code exists but did not arrive. */
  email_sent: boolean;
  expires_at: string;
}

/** Error bodies the SPA branches on. `attempts_left` only on `otp_invalid`. */
export interface SignatureApiError {
  error: string;
  attempts_left?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class SignaturesService {
  private http = inject(HttpClient);
  private base = environment.signaturesApiUrl;

  /**
   * Current state plus presigned URLs. Answers `410 signature_expired` once
   * the window closed, except in SIGNING/SIGNED/FAILED so the SPA can keep
   * polling the outcome.
   */
  get(signatureId: string): Observable<Signature> {
    return this.http.get<Signature>(`${this.base}/signatures/get-signature`, {
      params: { signature_id: signatureId },
    });
  }

  /** FORM -> BIOMETRICS. The email is where the OTP goes. */
  setForm(signatureId: string, email: string): Observable<StageResponse & { email: string }> {
    return this.http.post<StageResponse & { email: string }>(
      `${this.base}/signatures/set-signature-form`,
      { signature_id: signatureId, email },
    );
  }

  /** Presign + PUT of one evidence. Returns the S3 key to validate. */
  uploadBiometric(
    signatureId: string,
    type: BiometricType,
    blob: Blob,
    contentType: BiometricContentType,
  ): Observable<string> {
    return this.http
      .post<BiometricUploadUrl>(`${this.base}/signatures/upload-biometrics`, {
        signature_id: signatureId,
        biometric_type: type,
        content_type: contentType,
      })
      .pipe(switchMap((u) => this.putBlob(u.upload_url, blob, u.content_type).pipe(map(() => u.key))));
  }

  /** Rekognition analysis of an uploaded evidence; stores it when valid. */
  setBiometric(signatureId: string, type: BiometricType, s3Key: string): Observable<BiometricValidation> {
    return this.http.post<BiometricValidation>(`${this.base}/signatures/set-biometrics`, {
      signature_id: signatureId,
      biometric_type: type,
      s3_key: s3Key,
    });
  }

  /** Side effect: BIOMETRICS -> SIGNATURE once the three are `true`. */
  requiredBiometrics(signatureId: string): Observable<RequiredBiometrics> {
    return this.http.get<RequiredBiometrics>(`${this.base}/signatures/get-required-biometrics`, {
      params: { signature_id: signatureId },
    });
  }

  /**
   * SIGNATURE -> OTP. Raw image bytes in the body (100 B .. 2 MB). It must be
   * a PNG or JPEG: sign_doc stamps it on the PDF and fails otherwise.
   */
  setDraw(signatureId: string, image: Blob): Observable<StageResponse & { draw_s3_key: string }> {
    return this.http.post<StageResponse & { draw_s3_key: string }>(
      `${this.base}/signatures/set-signature-draw`,
      image,
      {
        params: { signature_id: signatureId },
        headers: { 'Content-Type': 'application/octet-stream' },
      },
    );
  }

  /** Emails a fresh 6-digit code (2 min) and resets the attempts. Also resends. */
  setOtp(signatureId: string): Observable<SetOtpResponse> {
    return this.http.post<SetOtpResponse>(`${this.base}/signatures/set-otp`, {
      signature_id: signatureId,
    });
  }

  /** OTP -> SIGNING and fires sign_doc; poll `get()` until SIGNED. */
  resolveOtp(signatureId: string, code: string): Observable<StageResponse> {
    return this.http.post<StageResponse>(`${this.base}/signatures/resolve-otp`, {
      signature_id: signatureId,
      code,
    });
  }

  /** The URL is presigned with the content type, so it must be echoed as-is. */
  private putBlob(url: string, blob: Blob, contentType: string): Observable<void> {
    return from(fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob })).pipe(
      switchMap((resp) =>
        resp.ok ? [undefined as void] : throwError(() => new Error(`S3 PUT failed (${resp.status})`)),
      ),
    );
  }
}
