import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';
import { FileRow } from './files.service';
import { UserForm } from './forms.service';

export type ProcessStage = 'form' | 'documents' | 'signature' | 'payment' | 'done';

export const STAGE_ORDER: ProcessStage[] = ['form', 'documents', 'signature', 'payment', 'done'];

export interface ProcessRow {
  id: string;
  bank_id: number;
  amount: number;
  term_days: number;
  rate: number;
  stage: ProcessStage;
  form_snapshot: UserForm | null;
  signed_at: string | null;
  paid_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * Signature ceremony stages as emitted by the signatures service v2.
 *
 * `created`  ceremony opened, nothing done yet
 * `identity` at least one evidence uploaded but not all validated
 * `signature` all 3 IDs+face validated, drawn signature still missing
 * `consent`  every evidence ready, waiting for terms acceptance
 * `otp`      consent given, waiting for the one-time code
 * `signing`  code verified, worker is generating the PAdES-B PDF
 * `signed`   worker finished ok, signed.pdf + evidence bundle in S3
 * `failed`   worker aborted (integrity mismatch, cert error, etc.)
 * `expired`  TTL elapsed before the user finished
 *
 * The portal only ever renders a small subset (`created`/`identity`/
 * `signature`/`consent`/`otp`/`signing` all look the same from here:
 * "not signed yet"; `signed` unlocks the payment stage; `failed`/
 * `expired` prompt to reopen). The full enum lives here so callers get
 * exhaustive-switch help from TypeScript.
 */
export type SignatureCeremonyStage =
  | 'created'
  | 'identity'
  | 'signature'
  | 'consent'
  | 'otp'
  | 'signing'
  | 'signed'
  | 'failed'
  | 'expired';

/**
 * Subset of the signatures ceremony `public_dict()` that the portal
 * cares about. The signing SPA has its own richer type; here we only
 * need what drives the process wizard (which button to show, whether
 * to auto-advance on return).
 */
export interface ProcessSignature {
  sign_id: string;
  stage: SignatureCeremonyStage;
  signed_at: string | null;
  hash_original: string | null;
  hash_signed: string | null;
  cert_serial: string | null;
  expires_at: string;
}

export interface ProcessDetail {
  process: ProcessRow;
  files: FileRow[];
  signature: ProcessSignature | null;
}

@Injectable({ providedIn: 'root' })
export class ProcessesService {
  private http = inject(HttpClient);
  private base = environment.processesApiUrl;

  create(payload: {
    bank_id: number;
    amount: number;
    term_days: number;
    rate: number;
  }): Observable<{ process: ProcessRow }> {
    return this.http.post<{ process: ProcessRow }>(`${this.base}/processes`, payload);
  }

  listMine(): Observable<{ processes: ProcessRow[] }> {
    return this.http.get<{ processes: ProcessRow[] }>(`${this.base}/processes`);
  }

  get(id: string): Observable<ProcessDetail> {
    return this.http.get<ProcessDetail>(`${this.base}/processes/${id}`);
  }

  /**
   * Advances the process to the next stage.
   *
   * On the `documents -> signature` transition specifically, the
   * backend also opens the signatures ceremony and returns `sign_url`
   * in the same response (see backend `processes/advance` handler).
   * The caller is expected to redirect the browser to `sign_url`
   * after appending its own `?return_url=...` so the signing SPA
   * knows where to send the user back.
   *
   * On every other transition `sign_url` is absent.
   */
  advance(
    id: string,
  ): Observable<{ process: ProcessRow; sign_url?: string }> {
    return this.http.post<{ process: ProcessRow; sign_url?: string }>(
      `${this.base}/processes/${id}/advance`,
      {},
    );
  }
}
