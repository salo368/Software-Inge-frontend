import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../environments/environment';
import { UserForm } from './forms.service';

/**
 * `processes.stage` (backend enum `ProcessStage`, docs/processes-api.md §3).
 *
 *   FORM          create-process
 *   DOCUMENTS     set-process-form
 *   SIGNATURE     generate_sign (internal), triggered by get-required-files
 *   PAYMENT       webhooks/signed (internal), when the signature is SIGNED
 *   REVIEW        get-pending-pay, when payments cover the amount
 *   SENT_TO_BANK, COMPLETED   defined, no transition implemented yet
 */
export type ProcessStage =
  | 'FORM'
  | 'DOCUMENTS'
  | 'SIGNATURE'
  | 'PAYMENT'
  | 'REVIEW'
  | 'SENT_TO_BANK'
  | 'COMPLETED';

export const STAGE_ORDER: readonly ProcessStage[] = [
  'FORM',
  'DOCUMENTS',
  'SIGNATURE',
  'PAYMENT',
  'REVIEW',
  'SENT_TO_BANK',
  'COMPLETED',
];

export interface ProcessRow {
  id: string;
  bank_id: number;
  amount: number;
  /** Days. */
  term: number;
  rate: number;
  stage: ProcessStage;
  /** Investment-order signature; `null` until generate_sign opens it. */
  signature_id: string | null;
  created_at: string;
}

/** `create-process` answers the row without `signature_id`. */
export type CreatedProcess = Omit<ProcessRow, 'signature_id'>;

/** Uploadable process documents (backend `FileType`, minus server-generated ones). */
export type RequiredFileType = 'BANK_CERT' | 'TAX_DECLARATION' | 'RUT';

/**
 * `GET /processes/get-required-files`: only the keys the process requires,
 * `true` once the file is registered. Key order is not guaranteed.
 */
export type RequiredFiles = Partial<Record<RequiredFileType, boolean>>;

export interface PendingPay {
  process_id: string;
  amount: number;
  paid: number;
  /** `amount - paid`, never negative. */
  pending: number;
  /** `PAYMENT`, or `REVIEW` when this very call completed the payment. */
  stage: ProcessStage;
}

@Injectable({ providedIn: 'root' })
export class ProcessesService {
  private http = inject(HttpClient);
  private base = environment.processesApiUrl;

  /** The backend re-validates `(bank_id, amount, term)` and resolves the rate itself. */
  create(payload: { bank_id: number; amount: number; term: number }): Observable<CreatedProcess> {
    return this.http.post<CreatedProcess>(`${this.base}/processes/create-process`, {
      bank_id: payload.bank_id,
      amount: String(payload.amount),
      term: payload.term,
    });
  }

  /** Newest first. */
  listMine(): Observable<{ processes: ProcessRow[] }> {
    return this.http.get<{ processes: ProcessRow[] }>(`${this.base}/processes/get-processes`);
  }

  /**
   * There is no single-process endpoint: read the list and pick it. Emits
   * `null` when the process does not exist or is not the user's.
   */
  get(id: string): Observable<ProcessRow | null> {
    return this.listMine().pipe(map((r) => r.processes.find((p) => p.id === id) ?? null));
  }

  /**
   * Snapshots the user's current form into the process and moves it to
   * `DOCUMENTS`. Allowed in `FORM` and `DOCUMENTS` (re-submit a corrected
   * form); `409 process_form_locked` from `SIGNATURE` on.
   */
  setForm(processId: string): Observable<{ id: string; stage: ProcessStage; submitted_form: UserForm }> {
    return this.http.post<{ id: string; stage: ProcessStage; submitted_form: UserForm }>(
      `${this.base}/processes/set-process-form`,
      { process_id: processId },
    );
  }

  /**
   * Side effect: when every required file is in and the process is still in
   * `DOCUMENTS`, the backend fires generate_sign in the background. Poll this
   * and then `get()` until `signature_id` shows up.
   */
  requiredFiles(processId: string): Observable<RequiredFiles> {
    return this.http.get<RequiredFiles>(`${this.base}/processes/get-required-files`, {
      params: { process_id: processId },
    });
  }

  /** Side effect: moves the process to `REVIEW` once payments cover the amount. */
  pendingPay(processId: string): Observable<PendingPay> {
    return this.http.get<PendingPay>(`${this.base}/processes/get-pending-pay`, {
      params: { process_id: processId },
    });
  }
}

/** Projected interest at maturity, compounding the E.A. rate over `term` days. */
export function projectedInterest(p: Pick<ProcessRow, 'amount' | 'rate' | 'term'>): number {
  const factor = Math.pow(1 + p.rate / 100, p.term / 365) - 1;
  return Math.round(p.amount * factor);
}
