import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';

import { AdminAuthService } from '../core/admin-auth.service';
import { BackofficeApi } from '../core/backoffice-api.service';
import { initials } from '../core/labels';

/**
 * Frame of every signed-in page: dark sidebar with the sections and the
 * session on desktop; on phones the sidebar slides in from a top bar.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <div class="bo-app">
      <aside class="bo-sidebar" [class.open]="menuOpen()" id="backoffice-sidebar" aria-label="Menú principal">
        <a routerLink="/" class="bo-brand" id="backoffice-home">
          <span class="bo-brand-mark" aria-hidden="true"><i class="bi bi-shield-lock-fill"></i></span>
          <span>CDTs<small>Backoffice</small></span>
        </a>

        <div class="bo-nav-label">Operación</div>
        <nav class="bo-nav">
          @for (item of nav; track item.link) {
            <a
              [routerLink]="item.link"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: item.link === '/' }"
              [id]="'backoffice-nav-' + item.id"
              class="bo-nav-item"
            >
              <i class="bi" [class]="item.icon"></i><span>{{ item.label }}</span>
              @if (item.id === 'aprobaciones' && pendingTotal()) {
                <span class="bo-nav-badge" id="backoffice-nav-pending" [title]="pendingTotal() + ' pendientes'">{{ pendingTotal() }}</span>
              }
            </a>
          }
        </nav>

        <div class="bo-nav-label mt-4">Configuración</div>
        <nav class="bo-nav">
          <a routerLink="/admins" routerLinkActive="active" id="backoffice-nav-admins" class="bo-nav-item">
            <i class="bi bi-person-gear"></i><span>Administradores</span>
          </a>
        </nav>

        <div class="bo-sidebar-footer">
          <span class="bo-avatar" aria-hidden="true">{{ initials(admin()?.full_name) }}</span>
          <div class="bo-sidebar-user">
            <strong id="backoffice-admin-name">{{ admin()?.full_name }}</strong>
            <span>{{ admin()?.email }}</span>
          </div>
          <button
            id="backoffice-logout"
            type="button"
            class="bo-icon-btn"
            [disabled]="loggingOut()"
            (click)="logout()"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <i class="bi bi-box-arrow-right"></i>
          </button>
        </div>
      </aside>
      <div class="bo-backdrop" [class.open]="menuOpen()" (click)="menuOpen.set(false)"></div>

      <div class="bo-content">
        <header class="bo-mobilebar">
          <a routerLink="/" class="bo-brand">
            <span class="bo-brand-mark" aria-hidden="true"><i class="bi bi-shield-lock-fill"></i></span>
            <span>CDTs <small class="d-inline">Backoffice</small></span>
          </a>
          <button
            id="backoffice-menu"
            type="button"
            class="bo-icon-btn"
            (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()"
            aria-controls="backoffice-sidebar"
            aria-label="Abrir menú"
          >
            <i class="bi" [class.bi-list]="!menuOpen()" [class.bi-x-lg]="menuOpen()" style="font-size: 1.3rem"></i>
          </button>
        </header>
        <main class="bo-page"><ng-content /></main>
      </div>
    </div>
  `,
})
export class ShellComponent {
  private auth = inject(AdminAuthService);
  private router = inject(Router);
  private api = inject(BackofficeApi);

  readonly admin = this.auth.admin;
  /** REVIEW + SENT_TO_BANK waiting for the team (cached in the service). */
  pendingTotal(): number {
    const p = this.api.pending();
    return (p.review ?? 0) + (p.bank ?? 0);
  }
  readonly initials = initials;
  loggingOut = signal(false);
  menuOpen = signal(false);

  readonly nav = [
    { id: 'panel', link: '/', label: 'Panel', icon: 'bi-grid-1x2' },
    { id: 'aprobaciones', link: '/aprobaciones', label: 'Aprobaciones', icon: 'bi-clipboard-check' },
    { id: 'procesos', link: '/procesos', label: 'Procesos', icon: 'bi-folder2-open' },
    { id: 'inversionistas', link: '/inversionistas', label: 'Inversionistas', icon: 'bi-people' },
  ];

  constructor() {
    this.api.refreshPending();
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  logout(): void {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    const done = () => void this.router.navigateByUrl('/login');
    this.auth.logout().subscribe({
      next: done,
      // Even if the server cannot be reached, leave: the local session goes away.
      error: () => {
        this.auth.clear();
        done();
      },
    });
  }
}
