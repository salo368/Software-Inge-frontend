import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, catchError, of } from 'rxjs';

import { AdminAuthService } from '../core/admin-auth.service';
import { BackofficeApi } from '../core/backoffice-api.service';
import { ProcessRowVm, ProcessTableComponent, toProcessRow } from '../ui/process-table.component';
import { ShellComponent } from './shell.component';

interface Kpi {
  id: string;
  label: string;
  hint: string;
  icon: string;
  link: string;
  query?: Record<string, string>;
  /** `null` while loading, `-1` when the count failed. */
  value: number | null;
}

/** Landing of the backoffice: live counters and the latest processes. */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, ShellComponent, ProcessTableComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private auth = inject(AdminAuthService);
  private api = inject(BackofficeApi);

  readonly admin = this.auth.admin;

  kpis = signal<Kpi[]>([
    {
      id: 'review',
      label: 'Por revisar',
      hint: 'Abrir revisión',
      icon: 'bi-clipboard-check',
      link: '/aprobaciones',
      query: { paso: 'revision' },
      value: null,
    },
    {
      id: 'bank',
      label: 'Esperando al banco',
      hint: 'Abrir confirmaciones',
      icon: 'bi-bank',
      link: '/aprobaciones',
      query: { paso: 'banco' },
      value: null,
    },
    { id: 'processes', label: 'Procesos', hint: 'Ver todos', icon: 'bi-folder2-open', link: '/procesos', value: null },
    { id: 'users', label: 'Inversionistas', hint: 'Ver cuentas', icon: 'bi-people', link: '/inversionistas', value: null },
  ]);

  recent = signal<ProcessRowVm[]>([]);
  recentLoading = signal(true);
  recentError = signal(false);

  ngOnInit(): void {
    // Validates the stored token against the server (a revoked one gets a 401,
    // which the interceptor turns into a redirect to /login).
    this.auth.me().subscribe({ error: () => undefined });
    this.api.loadBanks();

    this.fill('processes', this.api.countProcesses());
    this.fill('review', this.api.countProcesses(['REVIEW']));
    this.fill('bank', this.api.countProcesses(['SENT_TO_BANK']));
    this.fill('users', this.api.countUsers());

    this.api.listProcesses({ pageSize: 6 }).subscribe({
      next: (r) => {
        this.recent.set(r.results.map(toProcessRow));
        this.recentLoading.set(false);
      },
      error: () => {
        this.recentLoading.set(false);
        this.recentError.set(true);
      },
    });
  }

  greeting(): string {
    const h = new Date().getHours();
    return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  }

  firstName(): string {
    return (this.admin()?.full_name ?? '').trim().split(/\s+/)[0] ?? '';
  }

  private fill(id: string, source: Observable<number>): void {
    source.pipe(catchError(() => of(-1))).subscribe((value) => {
      this.kpis.update((list) => list.map((k) => (k.id === id ? { ...k, value } : k)));
    });
  }
}
