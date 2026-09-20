import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject } from '@angular/core';

import { AuthService } from '../core/auth.service';
import { blockUrl } from '../core/blocks';

/**
 * Chrome shared by every block. Links are plain hrefs because most of them
 * cross into a different block, which is a document navigation.
 */
@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-layout.component.html',
})
export class AppLayoutComponent {
  /** Nav entry to highlight. Each block sets its own. */
  @Input() active: 'simulator' | 'account' | null = null;

  private auth = inject(AuthService);

  readonly user = this.auth.user;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly initial = computed(() => {
    const u = this.user();
    return u?.full_name?.[0]?.toUpperCase() ?? u?.email?.[0]?.toUpperCase() ?? '?';
  });

  readonly urls = {
    simulator: blockUrl('simulator'),
    account: blockUrl('portal', 'me'),
    login: blockUrl('portal', 'login'),
    register: blockUrl('portal', 'register'),
  };

  logout(): void {
    this.auth.logout().subscribe({
      next: () => this.goToLogin(),
      error: () => {
        this.auth.clear();
        this.goToLogin();
      },
    });
  }

  private goToLogin(): void {
    window.location.assign(this.urls.login);
  }
}
