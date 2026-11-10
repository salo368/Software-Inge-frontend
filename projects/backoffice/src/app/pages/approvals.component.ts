import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { ProcessStage } from '@shared/core/processes.service';

import { BackofficeApi, PAGE_SIZE } from '../core/backoffice-api.service';
import { PagerComponent } from '../ui/pager.component';
import { ProcessRowVm, ProcessTableComponent, toProcessRow } from '../ui/process-table.component';
import { ShellComponent } from './shell.component';

export type ApprovalStep = 'revision' | 'banco';

interface StepDef {
  key: ApprovalStep;
  stage: ProcessStage;
  title: string;
  description: string;
  action: string;
  icon: string;
}

export const APPROVAL_STEPS: StepDef[] = [
  {
    key: 'revision',
    stage: 'REVIEW',
    title: 'Revisión',
    description:
      'El inversionista ya pagó el monto completo. Revisa su expediente (datos, documentos, firma y pagos) y, si todo está en orden, envíalo al banco.',
    action: 'Enviar al banco',
    icon: 'bi-clipboard-check',
  },
  {
    key: 'banco',
    stage: 'SENT_TO_BANK',
    title: 'Confirmación del banco',
    description: 'El banco recibió la orden. Cuando confirme la apertura, aprueba el CDT para activarlo.',
    action: 'Activar CDT',
    icon: 'bi-bank',
  },
];

/**
 * The approvals queue: processes waiting for a backoffice decision, one tab
 * per step. `?paso=revision|banco&page=` lives in the URL.
 */
@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [CommonModule, RouterLink, ShellComponent, ProcessTableComponent, PagerComponent],
  template: `
    <app-shell>
      <header class="bo-page-header">
        <div>
          <h1 class="bo-title">Aprobaciones</h1>
          <p class="bo-subtitle">Procesos que esperan una decisión del equipo antes de convertirse en CDT activo.</p>
        </div>
      </header>

      <nav class="bo-tabs" role="tablist" aria-label="Pasos de aprobación">
        @for (s of steps; track s.key) {
          <a
            role="tab"
            class="bo-tab"
            [class.active]="step().key === s.key"
            [attr.aria-selected]="step().key === s.key"
            [routerLink]="[]"
            [queryParams]="{ paso: s.key, page: null }"
            queryParamsHandling="merge"
            [id]="'backoffice-step-' + s.key"
          >
            {{ s.title }}
            @if (countOf(s.key) !== null) {
              <span
                class="bo-count"
                [class.bo-count-muted]="countOf(s.key) === 0"
                [title]="countOf(s.key) + (countOf(s.key) === 1 ? ' proceso pendiente' : ' procesos pendientes')"
                >{{ countOf(s.key) }}</span
              >
            }
          </a>
        }
      </nav>

      <section class="bo-card">
        <div class="bo-card-header align-items-start">
          <div class="d-flex gap-3">
            <span class="bo-step-icon"><i class="bi" [ngClass]="step().icon"></i></span>
            <div>
              <h2 class="bo-card-title">{{ step().title }}</h2>
              <p class="bo-secondary-text mb-0 mt-1" style="max-width: 46rem">{{ step().description }}</p>
            </div>
          </div>
        </div>

        @if (error()) {
          <div id="backoffice-approvals-error" class="alert alert-danger small m-3 mb-0" role="alert">
            <i class="bi bi-exclamation-triangle me-1"></i>{{ error() }}
          </div>
        }

        <app-process-table
          id="backoffice-approvals-list"
          linkBase="/aprobaciones"
          [rows]="rows()"
          [loading]="loading()"
          [skeletonRows]="5"
          [emptyTitle]="error() ? 'Sin datos' : 'No hay procesos pendientes en este paso'"
          [emptyHint]="error() ? '' : 'Cuando un proceso llegue a este paso aparecerá aquí.'"
          emptyId="backoffice-approvals-empty"
        />

        <div class="bo-card-footer">
          <app-pager [page]="page()" [pageSize]="PAGE_SIZE" [total]="total()" (pageChange)="goTo($event)" />
        </div>
      </section>
    </app-shell>
  `,
})
export class ApprovalsComponent implements OnInit {
  private api = inject(BackofficeApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private request: Subscription | null = null;

  readonly steps = APPROVAL_STEPS;
  readonly PAGE_SIZE = PAGE_SIZE;

  step = signal<StepDef>(APPROVAL_STEPS[0]);
  page = signal(1);
  rows = signal<ProcessRowVm[]>([]);
  total = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);

  private readonly pending = this.api.pending;
  readonly counts = computed(() => ({ revision: this.pending().review, banco: this.pending().bank }));

  countOf(key: ApprovalStep): number | null {
    return this.counts()[key];
  }

  ngOnInit(): void {
    this.api.loadBanks();
    this.api.refreshPending(true);

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      this.step.set(APPROVAL_STEPS.find((s) => s.key === q.get('paso')) ?? APPROVAL_STEPS[0]);
      this.page.set(Math.max(1, Number(q.get('page')) || 1));
      this.load();
    });
  }

  goTo(page: number): void {
    this.navigate({ page: page > 1 ? page : null });
  }

  private navigate(changes: Params): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: changes, queryParamsHandling: 'merge' });
  }

  private load(): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.rows.set([]);
    this.request = this.api.listProcesses({ stages: [this.step().stage], page: this.page() }).subscribe({
      next: (r) => {
        this.rows.set(r.results.map(toProcessRow));
        this.total.set(r.pagination.total);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.total.set(0);
        this.error.set('No pudimos cargar los procesos pendientes. Intenta de nuevo en unos segundos.');
      },
    });
  }
}
