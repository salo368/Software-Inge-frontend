import { Component, EventEmitter, Input, Output } from '@angular/core';

/** "Mostrando 1–20 de 134" + previous / next, for the paginated admin lists. */
@Component({
  selector: 'app-pager',
  standalone: true,
  template: `
    <nav class="bo-pager" aria-label="Paginación">
      <span class="bo-pager-info" id="backoffice-pager-range">
        @if (total > 0) {
          Mostrando <strong class="tabular">{{ from }}–{{ to }}</strong> de <strong class="tabular">{{ total }}</strong>
        } @else {
          Sin resultados
        }
      </span>
      <div class="d-flex align-items-center gap-2">
        <span class="bo-pager-info tabular d-none d-sm-inline" id="backoffice-pager-page">Página {{ page }} de {{ pages }}</span>
        <button id="backoffice-pager-prev" type="button" class="btn btn-sm btn-outline-secondary" [disabled]="page <= 1" (click)="go(page - 1)" aria-label="Página anterior">
          <i class="bi bi-chevron-left"></i>
        </button>
        <button id="backoffice-pager-next" type="button" class="btn btn-sm btn-outline-secondary" [disabled]="page >= pages" (click)="go(page + 1)" aria-label="Página siguiente">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    </nav>
  `,
})
export class PagerComponent {
  @Input({ required: true }) page = 1;
  @Input({ required: true }) pageSize = 20;
  @Input({ required: true }) total = 0;
  @Output() pageChange = new EventEmitter<number>();

  get pages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }
  get from(): number {
    return (this.page - 1) * this.pageSize + 1;
  }
  get to(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  go(p: number): void {
    if (p >= 1 && p <= this.pages && p !== this.page) this.pageChange.emit(p);
  }
}
