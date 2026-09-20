import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../environments/environment';

export type SignatureStage = 'review' | 'identity' | 'drawing' | 'otp' | 'signed';

export interface SignatureSummary {
  token: string;
  stage: SignatureStage;
  signed_at: string | null;
}

export interface CreateSignatureResponse {
  signature: SignatureSummary;
  sign_url: string;
  pdf_url?: string;
  emailed?: boolean;
  reused?: boolean;
}

/**
 * Opens a signing ceremony. Running it is the signing block's job, so this
 * only covers the handoff: create, then send the user over with the token.
 */
@Injectable({ providedIn: 'root' })
export class SignaturesService {
  private http = inject(HttpClient);
  private base = environment.signaturesApiUrl;

  create(processId: string): Observable<CreateSignatureResponse> {
    return this.http.post<CreateSignatureResponse>(`${this.base}/signatures`, {
      process_id: processId,
    });
  }
}
