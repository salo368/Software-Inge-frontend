import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

/** Backend enum `SignatureStage` (docs/signatures-api.md §3). */
export type SignatureStage =
  | 'FORM'
  | 'BIOMETRICS'
  | 'SIGNATURE'
  | 'OTP'
  | 'SIGNING'
  | 'SIGNED'
  | 'FAILED';

/** The subset of `GET /signatures/get-signature` the portal looks at. */
export interface SignatureSummary {
  id: string;
  stage: SignatureStage;
  expires_at: string;
  signed_url: string | null;
  signed_hash: string | null;
  signed_at: string | null;
}

/**
 * Read-only peek at the investment-order signature, so the portal can tell
 * "still signing" from "signed, waiting for the webhook" from "failed". The
 * ceremony itself is driven by the signing block. `410 signature_expired`
 * means the 15-minute window closed before the signer finished.
 */
@Injectable({ providedIn: 'root' })
export class SignatureStatusService {
  private http = inject(HttpClient);
  private base = environment.signaturesApiUrl;

  get(signatureId: string): Observable<SignatureSummary> {
    return this.http.get<SignatureSummary>(`${this.base}/signatures/get-signature`, {
      params: { signature_id: signatureId },
    });
  }
}
