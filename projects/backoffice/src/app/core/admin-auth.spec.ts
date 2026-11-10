import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { adminAuthInterceptor } from './admin-auth.interceptor';
import { requireAdmin, requireGuest } from './admin-auth.guard';
import { ADMIN_KEY, ADMIN_TOKEN_KEY, AdminAuthService } from './admin-auth.service';
import { friendlyAdminError } from './admin-errors';

const ADMIN = {
  id: 'a1',
  email: 'root@example.com',
  full_name: 'Root Admin',
  created_at: '2026-11-08T19:30:00+00:00',
  updated_at: '2026-11-08T19:30:00+00:00',
};

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'login', children: [] }]),
      provideHttpClient(withInterceptors([adminAuthInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  return {
    auth: TestBed.inject(AdminAuthService),
    http: TestBed.inject(HttpClient),
    ctrl: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  };
}

describe('AdminAuthService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('login guarda token y admin con claves propias y expone la sesión', () => {
    const { auth, ctrl } = setup();
    expect(auth.isAuthenticated()).toBeFalse();

    auth.login(' root@example.com ', 'hunter22aa').subscribe();
    const req = ctrl.expectOne((r) => r.url.endsWith('/admin-auth/login'));
    expect(req.request.body).toEqual({ email: 'root@example.com', password: 'hunter22aa' });
    req.flush({ admin: ADMIN, token: 'tok', expires_at: new Date(Date.now() + 3_600_000).toISOString() });

    expect(auth.isAuthenticated()).toBeTrue();
    expect(auth.admin()?.full_name).toBe('Root Admin');
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe('tok');
    // No toca la sesión de los inversionistas.
    expect(localStorage.getItem('cdts_token')).toBeNull();
    ctrl.verify();
  });

  it('un token guardado ya vencido se descarta al arrancar', () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, 'old');
    localStorage.setItem('cdts_admin_expires_at', new Date(Date.now() - 1000).toISOString());
    const { auth } = setup();
    expect(auth.isAuthenticated()).toBeFalse();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('registerAdmin manda el bearer del admin actual y recorta los textos', () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, 'tok');
    const { auth, ctrl } = setup();

    auth.registerAdmin(' ana@example.com ', ' Ana Pérez ', 'hunter22aa').subscribe();
    const req = ctrl.expectOne((r) => r.url.endsWith('/admin-auth/register'));
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    expect(req.request.body).toEqual({ email: 'ana@example.com', full_name: 'Ana Pérez', password: 'hunter22aa' });
    req.flush({ admin: ADMIN });
  });

  it('logout revoca en el servidor y limpia la sesión local', () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, 'tok');
    localStorage.setItem(ADMIN_KEY, JSON.stringify(ADMIN));
    const { auth, ctrl } = setup();
    expect(auth.isAuthenticated()).toBeTrue();

    auth.logout().subscribe();
    const req = ctrl.expectOne((r) => r.url.endsWith('/admin-auth/logout'));
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush({ revoked: true });

    expect(auth.isAuthenticated()).toBeFalse();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(ADMIN_KEY)).toBeNull();
  });
});

describe('adminAuthInterceptor', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('un 401 con sesión la limpia y manda a /login', () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, 'tok');
    const { auth, http, ctrl, router } = setup();
    const nav = spyOn(router, 'navigate').and.resolveTo(true);

    http.get('https://api.example/admin-auth/me').subscribe({ error: () => undefined });
    ctrl.expectOne('https://api.example/admin-auth/me').flush({ error: 'invalid_or_expired_token' }, { status: 401, statusText: 'Unauthorized' });

    expect(auth.isAuthenticated()).toBeFalse();
    expect(nav).toHaveBeenCalledWith(['/login'], { queryParams: { expired: 1 } });
  });

  it('un 401 sin sesión (login fallido) no redirige', () => {
    const { http, ctrl, router } = setup();
    const nav = spyOn(router, 'navigate').and.resolveTo(true);

    http.post('https://api.example/admin-auth/login', {}).subscribe({ error: () => undefined });
    ctrl.expectOne('https://api.example/admin-auth/login').flush({ error: 'invalid_credentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(nav).not.toHaveBeenCalled();
  });
});

describe('guards', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('requireAdmin deja pasar solo con sesión; requireGuest al revés', () => {
    const { router } = setup();
    const run = (g: typeof requireAdmin) => TestBed.runInInjectionContext(() => g({} as never, {} as never));

    expect(String(run(requireAdmin))).toBe(String(router.createUrlTree(['/login'])));
    expect(run(requireGuest)).toBeTrue();

    localStorage.setItem(ADMIN_TOKEN_KEY, 'tok');
    TestBed.resetTestingModule();
    const again = setup();
    const run2 = (g: typeof requireAdmin) => TestBed.runInInjectionContext(() => g({} as never, {} as never));
    expect(run2(requireAdmin)).toBeTrue();
    expect(String(run2(requireGuest))).toBe(String(again.router.createUrlTree(['/'])));
  });
});

describe('friendlyAdminError', () => {
  it('traduce los códigos de admin_auth y cae a un mensaje genérico', () => {
    expect(friendlyAdminError('invalid_credentials')).toContain('incorrectos');
    expect(friendlyAdminError('missing_fields')).toContain('Escribe');
    expect(friendlyAdminError('email_taken')).toContain('Ya existe');
    expect(friendlyAdminError('password_needs_digit')).toContain('número');
    expect(friendlyAdminError(undefined, 0)).toContain('conectar');
    expect(friendlyAdminError('boom', 500)).toContain('Intenta de nuevo');
  });
});
