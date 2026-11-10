import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { Bank, BanksService } from '@shared/core/banks.service';
import { ProcessStage } from '@shared/core/processes.service';
import { environment as shared } from '@shared/environments/environment';

export interface Paged<T> {
  results: T[];
  count: number;
  pagination: { offset: number; limit: number; total: number };
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  updated_at: string;
}

export interface Applicant {
  full_name: string | null;
  email: string | null;
  document_type: string | null;
  document_number: string | null;
}

/** One row of `POST /processes/get-processes-list`. */
export interface ProcessListItem {
  id: string;
  user_id: string;
  bank_id: number;
  amount: number;
  term: number;
  rate: number;
  stage: ProcessStage;
  signature_id: string | null;
  applicant: Applicant;
  created_at: string;
  updated_at: string;
}

/** `GET /processes/get-process` (an admin token may read any process). */
export interface ProcessDetail {
  id: string;
  user_id: string;
  bank_id: number;
  amount: number;
  term: number;
  rate: number;
  stage: ProcessStage;
  signature_id: string | null;
  submitted_form: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** `GET /processes/get-processes?user_id=` (admin form: the processes of one user). */
export interface UserProcess {
  id: string;
  bank_id: number;
  amount: number;
  term: number;
  rate: number;
  stage: ProcessStage;
  signature_id: string | null;
  created_at: string;
}

/** `GET /files/get-process-files` (admin). */
export interface ProcessFile {
  id: string;
  file_type: string;
  original_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  /** Presigned GET, 15 min. */
  url: string;
}

/** `GET /payments/get-process-payments` (admin). */
export interface ProcessPayment {
  id: string;
  amount: number;
  s3_file: string | null;
  /** Presigned GET of the receipt, 15 min; `null` when there is none. */
  receipt_url: string | null;
}

export interface ProcessPayments {
  payments: ProcessPayment[];
  total_paid: number;
}

export type SignatureStage = 'FORM' | 'BIOMETRICS' | 'SIGNATURE' | 'OTP' | 'SIGNING' | 'SIGNED' | 'FAILED';

/** `GET /signatures/get-signature-review` (admin): the whole signing record. */
export interface SignatureReview {
  id: string;
  stage: SignatureStage;
  signatory: string | null;
  email: string | null;
  created_at: string;
  expires_at: string;
  signed_at: string | null;
  otp_tries: number;
  doc_hash: string | null;
  signed_hash: string | null;
  telemetry: { ip: string | null; user_agent: string | null; accept_language: string | null; resolved_at: string | null };
  doc_url: string | null;
  raw_signed_url: string | null;
  signed_url: string | null;
  draw_url: string | null;
  evidences: { ID_FRONT: string | null; ID_BACK: string | null; FACE: string | null };
}

/** Answer of `send-to-bank` / `approve-cdt`. */
export interface StageChange {
  process_id: string;
  stage: ProcessStage;
}

export interface ProcessFilters {
  search?: string;
  bankId?: number | null;
  stages?: ProcessStage[];
  page?: number;
  pageSize?: number;
}

export const PAGE_SIZE = 20;

/**
 * Admin-only endpoints of `auth` and `processes` (INTERNAL token, added by the
 * interceptor), plus the public bank catalogue used for filters and labels.
 */
@Injectable({ providedIn: 'root' })
export class BackofficeApi {
  private http = inject(HttpClient);
  private banksApi = inject(BanksService);
  private authBase = shared.authApiUrl;
  private processesBase = shared.processesApiUrl;
  private filesBase = shared.filesApiUrl;
  private paymentsBase = shared.paymentsApiUrl;
  private signaturesBase = shared.signaturesApiUrl;

  // ---- public bank catalogue (no token needed) -------------------------------

  private _banks = signal<Bank[]>([]);
  private banksLoaded = false;

  readonly banks = this._banks.asReadonly();
  readonly banksById = computed(() => new Map(this._banks().map((b) => [b.id, b])));

  /** Loads `GET /banks/get-banks` once; filters and rows read `banks()` / `banksById()`. */
  loadBanks(): void {
    if (this.banksLoaded) return;
    this.banksLoaded = true;
    this.banksApi.listBanks().subscribe({
      next: (r) => this._banks.set([...r.banks].sort((a, b) => a.name.localeCompare(b.name, 'es'))),
      error: () => (this.banksLoaded = false),
    });
  }

  bankName(id: number): string {
    return this.banksById().get(id)?.name ?? `Banco #${id}`;
  }

  // ---- users -----------------------------------------------------------------

  listUsers(search: string, page: number, pageSize = PAGE_SIZE): Observable<Paged<AdminUser>> {
    return this.http.post<Paged<AdminUser>>(`${this.authBase}/auth/get-user-list`, {
      search: search.trim(),
      page,
      page_size: pageSize,
    });
  }

  getUser(id: string): Observable<{ user: AdminUser }> {
    return this.http.get<{ user: AdminUser }>(`${this.authBase}/auth/get-user`, {
      params: new HttpParams().set('user_id', id),
    });
  }

  userProcesses(userId: string): Observable<{ processes: UserProcess[] }> {
    return this.http.get<{ processes: UserProcess[] }>(`${this.processesBase}/processes/get-processes`, {
      params: new HttpParams().set('user_id', userId),
    });
  }

  // ---- processes -------------------------------------------------------------

  listProcesses(f: ProcessFilters): Observable<Paged<ProcessListItem>> {
    const body: Record<string, unknown> = {
      page: f.page ?? 1,
      page_size: f.pageSize ?? PAGE_SIZE,
    };
    if (f.search?.trim()) body['search'] = f.search.trim();
    if (f.bankId) body['bank_id'] = f.bankId;
    if (f.stages?.length) body['stages'] = f.stages;
    return this.http.post<Paged<ProcessListItem>>(`${this.processesBase}/processes/get-processes-list`, body);
  }

  /** Only the total: the cheapest way to count (one row per page). */
  countProcesses(stages?: ProcessStage[]): Observable<number> {
    return new Observable<number>((sub) => {
      const s = this.listProcesses({ stages, pageSize: 1 }).subscribe({
        next: (r) => {
          sub.next(r.pagination.total);
          sub.complete();
        },
        error: (e) => sub.error(e),
      });
      return () => s.unsubscribe();
    });
  }

  countUsers(): Observable<number> {
    return new Observable<number>((sub) => {
      const s = this.listUsers('', 1, 1).subscribe({
        next: (r) => {
          sub.next(r.pagination.total);
          sub.complete();
        },
        error: (e) => sub.error(e),
      });
      return () => s.unsubscribe();
    });
  }

  // ---- review of one process (admin-only endpoints) ---------------------------

  processFiles(processId: string): Observable<{ files: ProcessFile[] }> {
    return this.http.get<{ files: ProcessFile[] }>(`${this.filesBase}/files/get-process-files`, {
      params: new HttpParams().set('process_id', processId),
    });
  }

  processPayments(processId: string): Observable<ProcessPayments> {
    return this.http.get<ProcessPayments>(`${this.paymentsBase}/payments/get-process-payments`, {
      params: new HttpParams().set('process_id', processId),
    });
  }

  signatureReview(signatureId: string): Observable<SignatureReview> {
    return this.http.get<SignatureReview>(`${this.signaturesBase}/signatures/get-signature-review`, {
      params: new HttpParams().set('signature_id', signatureId),
    });
  }

  /** REVIEW -> SENT_TO_BANK: the review passed and the order goes to the bank. */
  sendToBank(processId: string): Observable<StageChange> {
    return this.http
      .post<StageChange>(`${this.processesBase}/processes/send-to-bank`, { process_id: processId })
      .pipe(tap(() => this.refreshPending(true)));
  }

  /** SENT_TO_BANK -> COMPLETED: the bank confirmed the CDT. */
  approveCdt(processId: string): Observable<StageChange> {
    return this.http
      .post<StageChange>(`${this.processesBase}/processes/approve-cdt`, { process_id: processId })
      .pipe(tap(() => this.refreshPending(true)));
  }

  // ---- pending approvals (sidebar badges, dashboard) ---------------------------

  private _pending = signal<{ review: number | null; bank: number | null }>({ review: null, bank: null });
  private pendingAt = 0;
  readonly pending = this._pending.asReadonly();

  /** Counts of REVIEW and SENT_TO_BANK; cached 30 s unless `force`. */
  refreshPending(force = false): void {
    if (!force && Date.now() - this.pendingAt < 30_000) return;
    this.pendingAt = Date.now();
    this.countProcesses(['REVIEW']).subscribe({
      next: (review) => this._pending.update((p) => ({ ...p, review })),
      error: () => (this.pendingAt = 0),
    });
    this.countProcesses(['SENT_TO_BANK']).subscribe({
      next: (bank) => this._pending.update((p) => ({ ...p, bank })),
      error: () => (this.pendingAt = 0),
    });
  }

  getProcess(id: string): Observable<{ process: ProcessDetail }> {
    return this.http
      .get<{ process: ProcessDetail }>(`${this.processesBase}/processes/get-process`, {
        params: new HttpParams().set('process_id', id),
      })
      .pipe(tap(() => this.loadBanks()));
  }
}
