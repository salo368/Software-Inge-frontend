import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

import { AdminUser, BackofficeApi, PAGE_SIZE } from '../core/backoffice-api.service';
import { formatDateTime, initials, shortId, titleCase } from '../core/labels';
import { PagerComponent } from '../ui/pager.component';
import { ShellComponent } from './shell.component';

/** Investors (`POST /auth/get-user-list`). The URL holds `?q=&page=`. */
@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ShellComponent, PagerComponent],
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit {
  private api = inject(BackofficeApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private loading$: Subscription | null = null;

  readonly PAGE_SIZE = PAGE_SIZE;
  readonly formatDateTime = formatDateTime;
  readonly initials = initials;
  readonly titleCase = titleCase;
  readonly shortId = shortId;
  readonly skeleton = [0, 1, 2, 3, 4, 5, 6, 7];

  /** The whole row opens the detail; a click on the inner link is left to it. */
  open(id: string, event?: Event): void {
    if (event && (event.target as HTMLElement).closest('a')) return;
    void this.router.navigate(['/inversionistas', id]);
  }

  search = new FormControl('', { nonNullable: true });
  page = signal(1);
  items = signal<AdminUser[]>([]);
  total = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const text = q.get('q') ?? '';
      if (this.search.value !== text) this.search.setValue(text, { emitEvent: false });
      this.page.set(Math.max(1, Number(q.get('page')) || 1));
      this.load();
    });

    this.search.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((text) => this.navigate({ q: text.trim() || null, page: null }));
  }

  hasFilters(): boolean {
    return !!this.search.value.trim();
  }

  clear(): void {
    this.navigate({ q: null, page: null });
  }

  goTo(page: number): void {
    this.navigate({ page: page > 1 ? page : null });
  }

  private navigate(changes: Params): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: changes, queryParamsHandling: 'merge' });
  }

  private load(): void {
    this.loading$?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.loading$ = this.api.listUsers(this.search.value, this.page()).subscribe({
      next: (r) => {
        this.items.set(r.results);
        this.total.set(r.pagination.total);
        this.loading.set(false);
        const last = Math.max(1, Math.ceil(r.pagination.total / PAGE_SIZE));
        if (this.page() > last) this.goTo(last);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.items.set([]);
        this.total.set(0);
        this.error.set(err.status === 400 ? 'La búsqueda no es válida.' : 'No pudimos cargar los inversionistas. Intenta de nuevo.');
      },
    });
  }
}
