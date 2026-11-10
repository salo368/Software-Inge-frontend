import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { environment } from '../../environments/environment';

export interface Admin {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  updated_at: string;
}

export interface AdminTokenResponse {
  admin: Admin;
  token: string;
  expires_at: string;
}

// Own keys: an admin session never mixes with an investor's (`cdts_token`),
// even though every block shares the same origin.
export const ADMIN_TOKEN_KEY = 'cdts_admin_token';
export const ADMIN_KEY = 'cdts_admin';
const EXPIRES_KEY = 'cdts_admin_expires_at';

/**
 * Session of the internal admins (`admin_auth` service). Tokens are INTERNAL
 * and live 24 h; there is no open registration (an admin creates the others).
 */
@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private http = inject(HttpClient);
  private base = environment.adminAuthApiUrl;

  private _token = signal<string | null>(this.readValidToken());
  private _admin = signal<Admin | null>(this.readStoredAdmin());

  readonly admin = this._admin.asReadonly();
  readonly token = this._token.asReadonly();
  readonly isAuthenticated = computed(() => this._token() !== null);

  login(email: string, password: string): Observable<AdminTokenResponse> {
    return this.http
      .post<AdminTokenResponse>(`${this.base}/admin-auth/login`, { email: email.trim(), password })
      .pipe(tap((r) => this.persist(r)));
  }

  me(): Observable<{ admin: Admin }> {
    return this.http
      .get<{ admin: Admin }>(`${this.base}/admin-auth/me`)
      .pipe(tap((r) => this.storeAdmin(r.admin)));
  }

  /** Creates another admin (needs this admin's token). The new one signs in with `login`. */
  registerAdmin(email: string, full_name: string, password: string): Observable<{ admin: Admin }> {
    return this.http.post<{ admin: Admin }>(`${this.base}/admin-auth/register`, {
      email: email.trim(),
      full_name: full_name.trim(),
      password,
    });
  }

  /** Revokes this token on the server and clears the local session. */
  logout(): Observable<{ revoked: boolean }> {
    return this.http
      .post<{ revoked: boolean }>(`${this.base}/admin-auth/logout`, {})
      .pipe(tap(() => this.clear()));
  }

  clear(): void {
    this.safe(() => {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_KEY);
      localStorage.removeItem(EXPIRES_KEY);
    });
    this._token.set(null);
    this._admin.set(null);
  }

  private persist(r: AdminTokenResponse): void {
    this.safe(() => {
      localStorage.setItem(ADMIN_TOKEN_KEY, r.token);
      localStorage.setItem(EXPIRES_KEY, r.expires_at);
    });
    this._token.set(r.token);
    this.storeAdmin(r.admin);
  }

  private storeAdmin(admin: Admin): void {
    this.safe(() => localStorage.setItem(ADMIN_KEY, JSON.stringify(admin)));
    this._admin.set(admin);
  }

  /** A stored token already past its expiry is dropped instead of used. */
  private readValidToken(): string | null {
    const token = this.safe(() => localStorage.getItem(ADMIN_TOKEN_KEY));
    if (!token) return null;
    const expires = this.safe(() => localStorage.getItem(EXPIRES_KEY));
    if (expires && Date.parse(expires) <= Date.now()) {
      // Storage only: this runs in a field initializer, before the signals exist.
      this.safe(() => {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(ADMIN_KEY);
        localStorage.removeItem(EXPIRES_KEY);
      });
      return null;
    }
    return token;
  }

  private readStoredAdmin(): Admin | null {
    const raw = this.safe(() => localStorage.getItem(ADMIN_KEY));
    try {
      return raw ? (JSON.parse(raw) as Admin) : null;
    } catch {
      return null;
    }
  }

  private safe<T>(fn: () => T): T | null {
    try {
      return fn();
    } catch {
      return null;
    }
  }
}
