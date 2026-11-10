import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../environments/environment';

/** A bank as returned by `GET /banks/get-banks` (see backend docs/banks-api.md §3.1). */
export interface Bank {
  id: number;
  code: string;
  name: string;
  logo_url: string;
  description: string;
  tier: string;
  rating_by: string;
  highlights: string[];
}

export interface BanksResponse {
  banks: Bank[];
}

/** One offer of `GET /banks/simulate`, with the bank id lifted out of the key. */
export interface SimulationRow {
  bank: Bank;
  rate: number;
  interest: number;
  final: number;
}

export interface SimulationResult {
  amount: number;
  term: number;
  /** Best rate first, the order the backend sends. */
  results: SimulationRow[];
}

/**
 * Raw `GET /banks/simulate` body. `banks` is an object keyed by bank id (as a
 * string), not an array, and the value does not repeat the id.
 */
interface SimulateApiResponse {
  amount: number;
  term: number;
  banks: Record<string, Omit<Bank, 'id'> & { rate: number; interest: number; final: number }>;
}

@Injectable({ providedIn: 'root' })
export class BanksService {
  private http = inject(HttpClient);
  private base = environment.banksApiUrl;

  listBanks(): Observable<BanksResponse> {
    return this.http.get<BanksResponse>(`${this.base}/banks/get-banks`);
  }

  /** Only banks whose amount and term bands cover the request come back. */
  simulate(amount: number, term: number): Observable<SimulationResult> {
    return this.http
      .get<SimulateApiResponse>(`${this.base}/banks/simulate`, {
        params: { amount: String(amount), term: String(term) },
      })
      .pipe(map(toSimulationResult));
  }
}

export function toSimulationResult(r: SimulateApiResponse): SimulationResult {
  const results = Object.entries(r.banks ?? {})
    .map(([id, b]) => {
      const { rate, interest, final, ...bank } = b;
      return { bank: { id: Number(id), ...bank }, rate, interest, final };
    })
    // The backend sends the keys best-rate first, but JSON.parse iterates
    // integer-like keys ("12", "8") in ascending numeric order, so that
    // order is lost on arrival: sort again here.
    .sort((a, b) => b.rate - a.rate);
  return { amount: r.amount, term: r.term, results };
}
