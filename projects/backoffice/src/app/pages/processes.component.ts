import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

import { ProcessStage } from '@shared/core/processes.service';

import { BackofficeApi, PAGE_SIZE } from '../core/backoffice-api.service';
import { STAGES, STAGE_LABEL, isStage } from '../core/labels';
import { PagerComponent } from '../ui/pager.component';
import { ProcessRowVm, ProcessTableComponent, toProcessRow } from '../ui/process-table.component';
import { ShellComponent } from './shell.component';

/**
 * All the processes, filterable by text (name, e-mail, document), bank and
 * stage. The URL is the source of truth (`?q=&bank=&stages=&page=`), so a
 * filtered view can be shared and survives a refresh and the back button.
 */
@Component({
  selector: 'app-processes',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ShellComponent, PagerComponent, ProcessTableComponent],
  templateUrl: './processes.component.html',
})
export class ProcessesComponent implements OnInit {
  readonly api = inject(BackofficeApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private request: Subscription | null = null;

  readonly banks = this.api.banks;
  readonly STAGES = STAGES;
  readonly STAGE_LABEL = STAGE_LABEL;
  readonly PAGE_SIZE = PAGE_SIZE;

  search = new FormControl('', { nonNullable: true });
  bankId = signal<number | null>(null);
  stages = signal<ProcessStage[]>([]);
  page = signal(1);
  stageMenuOpen = signal(false);

  rows = signal<ProcessRowVm[]>([]);
  total = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);

  /** The search as applied (from the URL), not what is being typed. */
  readonly query = signal('');
  readonly hasFilters = computed(() => !!this.query() || this.bankId() !== null || this.stages().length > 0);

  ngOnInit(): void {
    this.api.loadBanks();

    // URL -> state -> request.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const text = q.get('q') ?? '';
      this.query.set(text);
      if (this.search.value !== text) this.search.setValue(text, { emitEvent: false });
      const bank = Number(q.get('bank'));
      this.bankId.set(Number.isInteger(bank) && bank > 0 ? bank : null);
      this.stages.set((q.get('stages') ?? '').split(',').filter(isStage));
      this.page.set(Math.max(1, Number(q.get('page')) || 1));
      this.load();
    });

    // Typing -> URL (debounced), always back to page 1.
    this.search.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((text) => this.navigate({ q: text.trim() || null, page: null }));
  }

  /** Closes the stage menu on any click outside it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.stageMenuOpen()) return;
    const menu = this.host.nativeElement.querySelector('#backoffice-stage-filter');
    if (menu && !menu.contains(event.target as Node)) this.stageMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.stageMenuOpen.set(false);
  }

  onBank(value: string): void {
    this.navigate({ bank: value || null, page: null });
  }

  toggleStage(stage: ProcessStage): void {
    const set = new Set(this.stages());
    if (set.has(stage)) set.delete(stage);
    else set.add(stage);
    const ordered = STAGES.filter((s) => set.has(s));
    this.navigate({ stages: ordered.length ? ordered.join(',') : null, page: null });
  }

  clearSearch(): void {
    this.search.setValue('', { emitEvent: false });
    this.navigate({ q: null, page: null });
  }

  clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.navigate({ q: null, bank: null, stages: null, page: null });
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
    this.request = this.api
      .listProcesses({
        search: this.query(),
        bankId: this.bankId(),
        stages: this.stages(),
        page: this.page(),
      })
      .subscribe({
        next: (r) => {
          this.rows.set(r.results.map(toProcessRow));
          this.total.set(r.pagination.total);
          this.loading.set(false);
          // A page past the end (filters changed elsewhere): go to the last one.
          const last = Math.max(1, Math.ceil(r.pagination.total / PAGE_SIZE));
          if (this.page() > last) this.goTo(last);
        },
        error: (err: HttpErrorResponse) => {
          this.loading.set(false);
          this.rows.set([]);
          this.total.set(0);
          this.error.set(
            err.status === 400
              ? 'Los filtros no son válidos. Límpialos e intenta de nuevo.'
              : 'No pudimos cargar los procesos. Intenta de nuevo en unos segundos.',
          );
        },
      });
  }
}
