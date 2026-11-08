import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';

import { environment } from '../environments/environment';
import { putToPresignedUrl } from './s3-upload';

export const ALLOWED_RECEIPT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

interface ReceiptUploadUrl {
  upload_url: string;
  /** `payments/{process_id}/{uuid}.{ext}`; goes back in `create-payment`. */
  key: string;
  content_type: string;
  upload_headers: Record<string, string>;
  expires_in: number;
}

export interface Payment {
  id: string;
  process_id: string;
  amount: number;
  s3_file: string;
}

/**
 * Client of the `payments` service (backend docs/payments-api.md). Both
 * endpoints require the process to be the user's and in `PAYMENT`. Whether
 * the process is fully paid is decided by `processes.get-pending-pay`.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private http = inject(HttpClient);
  private base = environment.paymentsApiUrl;

  /** Uploads the transfer receipt and then registers the payment with its amount. */
  register(processId: string, amount: number, receipt: File): Observable<Payment> {
    return this.http
      .post<ReceiptUploadUrl>(`${this.base}/payments/upload-url`, {
        process_id: processId,
        content_type: receipt.type || 'image/jpeg',
      })
      .pipe(
        switchMap((u) =>
          putToPresignedUrl(u.upload_url, receipt, u.upload_headers ?? { 'Content-Type': u.content_type }).pipe(
            map(() => u.key),
          ),
        ),
        switchMap((key) =>
          this.http.post<Payment>(`${this.base}/payments/create-payment`, {
            process_id: processId,
            s3_key: key,
            amount: String(amount),
          }),
        ),
      );
  }
}
