import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { formatCOP } from '@shared/core/format';

import { AdminUser, BackofficeApi, UserProcess } from '../core/backoffice-api.service';
import { formatDateTime, initials, shortId, titleCase } from '../core/labels';
import { ProcessRowVm, ProcessTableComponent } from '../ui/process-table.component';
import { ShellComponent } from './shell.component';

/** One investor (`GET /auth/get-user`) and their processes (`get-processes?user_id=`). */
@Component({
  selector: 'app-user-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, ShellComponent, ProcessTableComponent],
  template: `
    <app-shell>
      <nav class="bo-breadcrumb" aria-label="Ruta">
        <a routerLink="/inversionistas">Inversionistas</a>
        <i class="bi bi-chevron-right"></i>
        <span class="text-truncate">{{ user() ? titleCase(user()!.full_name) : 'Detalle' }}</span>
      </nav>

      @if (loading()) {
        <div class="bo-card bo-card-body"><span class="bo-skel mb-3" style="width: 30%; height: 1.4rem"></span><span class="bo-skel" style="width: 45%"></span></div>
      } @else if (notFound()) {
        <div class="bo-card"><div id="backoffice-user-notfound" class="bo-empty"><i class="bi bi-person-x"></i><strong>No encontramos a este inversionista</strong><span>Puede que el enlace esté incompleto.</span></div></div>
      } @else if (error()) {
        <div id="backoffice-user-error" class="alert alert-danger small" role="alert">{{ error() }}</div>
      } @else {
        @if (user(); as u) {
          <section class="bo-card mb-4">
            <div class="bo-card-body d-flex flex-wrap align-items-center gap-3">
              <span class="bo-avatar bo-avatar-lg" aria-hidden="true">{{ initials(u.full_name) }}</span>
              <div class="min-w-0 flex-grow-1">
                <h1 class="bo-title text-truncate" id="backoffice-user-name">{{ titleCase(u.full_name) }}</h1>
                <div class="bo-subtitle">{{ u.email }}</div>
              </div>
              <dl class="bo-dl" style="flex: 0 1 440px">
                <div><dt>Registro</dt><dd>{{ formatDateTime(u.created_at) }}</dd></div>
                <div><dt>ID</dt><dd class="bo-mono" [title]="u.id">{{ shortId(u.id) }}</dd></div>
                <div><dt>Procesos</dt><dd class="tabular">{{ processesLoaded() ? rows().length : '—' }}</dd></div>
                <div><dt>Total en procesos</dt><dd class="tabular">{{ processesLoaded() ? formatCOP(totalAmount()) : '—' }}</dd></div>
              </dl>
            </div>
          </section>

          <section class="bo-card">
            <div class="bo-card-header">
              <h2 class="bo-card-title">Procesos</h2>
            </div>
            @if (processesError()) {
              <div class="alert alert-danger small m-3 mb-0" role="alert">No pudimos cargar los procesos de este inversionista.</div>
            }
            <app-process-table
              id="backoffice-user-processes"
              [rows]="rows()"
              [loading]="!processesLoaded()"
              [showApplicant]="false"
              [skeletonRows]="3"
              [emptyTitle]="processesError() ? 'Sin datos' : 'Aún no ha iniciado ningún proceso'"
              emptyId="backoffice-user-processes-empty"
            />
          </section>
        }
      }
    </app-shell>
  `,
})
export class UserDetailComponent implements OnInit {
  readonly api = inject(BackofficeApi);
  private route = inject(ActivatedRoute);

  readonly formatCOP = formatCOP;
  readonly formatDateTime = formatDateTime;
  readonly initials = initials;
  readonly shortId = shortId;
  readonly titleCase = titleCase;

  loading = signal(true);
  notFound = signal(false);
  error = signal<string | null>(null);
  user = signal<AdminUser | null>(null);
  processes = signal<UserProcess[]>([]);
  processesLoaded = signal(false);
  processesError = signal(false);

  readonly rows = computed<ProcessRowVm[]>(() =>
    this.processes().map((p) => ({
      id: p.id,
      bankId: p.bank_id,
      amount: p.amount,
      term: p.term,
      rate: p.rate,
      stage: p.stage,
      createdAt: p.created_at,
    })),
  );
  readonly totalAmount = computed(() => this.processes().reduce((sum, p) => sum + p.amount, 0));

  ngOnInit(): void {
    this.api.loadBanks();
    const id = this.route.snapshot.paramMap.get('id') ?? '';

    this.api.getUser(id).subscribe({
      next: ({ user }) => {
        this.user.set(user);
        this.loading.set(false);
        this.api.userProcesses(user.id).subscribe({
          next: (r) => {
            this.processes.set(r.processes);
            this.processesLoaded.set(true);
          },
          error: () => {
            this.processesLoaded.set(true);
            this.processesError.set(true);
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        // 400 = not a UUID, 404 = no such user: both mean "no such investor".
        if (err.status === 404 || err.status === 400) this.notFound.set(true);
        else this.error.set('No pudimos cargar al inversionista. Intenta de nuevo.');
      },
    });
  }
}
