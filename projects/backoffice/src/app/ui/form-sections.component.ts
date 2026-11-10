import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject } from '@angular/core';

import { FormView } from '../core/form-view';

/** The applicant's `submitted_form`, section by section, as a description list. */
@Component({
  selector: 'app-form-sections',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (view.sections(form).length === 0) {
      <div class="bo-empty" [id]="emptyId">
        <i class="bi bi-journal-x"></i>
        <strong>Aún no hay formulario</strong>
        <span>Se guarda en el proceso cuando el inversionista envía sus datos.</span>
      </div>
    }
    @for (s of view.sections(form); track s.title; let last = $last) {
      <div class="bo-card-body" [class.bo-divider]="!last">
        <h3 class="bo-section-title"><i class="bi" [ngClass]="s.icon"></i>{{ s.title }}</h3>
        <dl class="bo-dl">
          @for (f of s.fields; track f.key) {
            <div>
              <dt>{{ view.label(f.key) }}</dt>
              <dd [class.tabular]="view.isNumeric(f.key)">{{ view.display(form, f.key, f.value) }}</dd>
            </div>
          }
        </dl>
      </div>
    }
  `,
})
export class FormSectionsComponent implements OnInit {
  readonly view = inject(FormView);

  @Input({ required: true }) form: Record<string, unknown> | null = null;
  @Input() emptyId = 'backoffice-process-noform';

  ngOnInit(): void {
    this.view.loadCatalogs();
  }
}
