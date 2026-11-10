import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { formatCOP } from '@shared/core/format';
import { ProcessStage } from '@shared/core/processes.service';

import { BackofficeApi, ProcessListItem } from '../core/backoffice-api.service';
import { formatDate, formatRate, initials, titleCase } from '../core/labels';
import { StatusComponent } from './status.component';

/** What a row needs; list items and a user's processes both map to it. */
export interface ProcessRowVm {
  id: string;
  bankId: number;
  amount: number;
  term: number;
  rate: number;
  stage: ProcessStage;
  createdAt: string;
  applicantName?: string | null;
  applicantEmail?: string | null;
  applicantDocument?: string | null;
}

/** Maps a `get-processes-list` row to the table's row. */
export function toProcessRow(p: ProcessListItem): ProcessRowVm {
  const doc = p.applicant.document_number ? `${p.applicant.document_type ?? ''} ${p.applicant.document_number}`.trim() : null;
  return {
    id: p.id,
    bankId: p.bank_id,
    amount: p.amount,
    term: p.term,
    rate: p.rate,
    stage: p.stage,
    createdAt: p.created_at,
    applicantName: p.applicant.full_name,
    applicantEmail: p.applicant.email,
    applicantDocument: doc,
  };
}

/**
 * The processes table used by the list, the dashboard and an investor's page.
 * Fixed column widths (colgroup + table-layout: fixed) keep every row aligned.
 */
@Component({
  selector: 'app-process-table',
  standalone: true,
  imports: [RouterLink, StatusComponent],
  template: `
    <div class="bo-table-wrap">
      <table class="bo-table" [attr.aria-busy]="loading">
        <colgroup>
          @if (showApplicant) {
            <col style="width: 27%" />
            <col style="width: 19%" />
            <col style="width: 12%" />
            <col style="width: 11%" />
            <col style="width: 19%" />
            <col style="width: 12%" />
          } @else {
            <col style="width: 30%" />
            <col style="width: 19%" />
            <col style="width: 15%" />
            <col style="width: 21%" />
            <col style="width: 15%" />
          }
          <col style="width: 44px" />
        </colgroup>
        <thead>
          <tr>
            @if (showApplicant) {
              <th scope="col">Solicitante</th>
            }
            <th scope="col">Entidad</th>
            <th scope="col" class="num">Monto</th>
            <th scope="col" class="num">Tasa · Plazo</th>
            <th scope="col">Estado</th>
            <th scope="col" class="num">Creado</th>
            <th scope="col"><span class="visually-hidden">Abrir</span></th>
          </tr>
        </thead>
        <tbody>
          @if (loading && rows.length === 0) {
            @for (i of skeleton; track i) {
              <tr>
                @if (showApplicant) {
                  <td><div class="bo-person"><span class="bo-avatar empty"></span><div class="flex-grow-1"><span class="bo-skel mb-2" style="width: 70%"></span><span class="bo-skel" style="width: 45%"></span></div></div></td>
                }
                <td><span class="bo-skel" style="width: 75%"></span></td>
                <td><span class="bo-skel ms-auto" style="width: 70%"></span></td>
                <td><span class="bo-skel ms-auto mb-2" style="width: 55%"></span><span class="bo-skel ms-auto" style="width: 40%"></span></td>
                <td><span class="bo-skel" style="width: 70%"></span></td>
                <td><span class="bo-skel ms-auto" style="width: 80%"></span></td>
                <td></td>
              </tr>
            }
          } @else if (rows.length === 0) {
            <tr>
              <td [attr.colspan]="showApplicant ? 7 : 6">
                <div class="bo-empty" [id]="emptyId">
                  <i class="bi bi-inbox"></i>
                  <strong>{{ emptyTitle }}</strong>
                  @if (emptyHint) {
                    <span>{{ emptyHint }}</span>
                  }
                </div>
              </td>
            </tr>
          }
          @for (p of rows; track p.id) {
            <tr
              class="bo-row-link"
              tabindex="0"
              [id]="'backoffice-process-' + p.id"
              [attr.data-stage]="p.stage"
              (click)="open(p.id, $event)"
              (keydown.enter)="open(p.id)"
            >
              @if (showApplicant) {
                <td class="bo-td-main">
                  <div class="bo-person">
                    <span class="bo-avatar" [class.empty]="!p.applicantName" aria-hidden="true">
                      @if (p.applicantName) {
                        {{ initials(p.applicantName) }}
                      } @else {
                        <i class="bi bi-person"></i>
                      }
                    </span>
                    <div class="bo-cell-stack">
                      <a [routerLink]="[linkBase, p.id]" class="bo-primary-text" [class.bo-placeholder-text]="!p.applicantName">
                        {{ p.applicantName ? titleCase(p.applicantName) : 'Sin formulario' }}
                      </a>
                      <span class="bo-secondary-text" [title]="p.applicantDocument ?? ''">{{ p.applicantEmail || 'Aún no envía sus datos' }}</span>
                    </div>
                  </div>
                </td>
              }
              <td data-label="Entidad" [class.bo-td-main]="!showApplicant">
                <div class="bo-bank">
                  @if (api.banksById().get(p.bankId); as bank) {
                    <img class="bo-bank-logo" [src]="bank.logo_url" [alt]="" />
                  }
                  @if (showApplicant) {
                    <span>{{ api.bankName(p.bankId) }}</span>
                  } @else {
                    <a [routerLink]="[linkBase, p.id]" class="bo-primary-text">{{ api.bankName(p.bankId) }}</a>
                  }
                </div>
              </td>
              <td data-label="Monto" class="num"><span class="fw-medium">{{ formatCOP(p.amount) }}</span></td>
              <td data-label="Tasa · Plazo" class="num">
                <div class="bo-cell-stack align-items-end">
                  <span class="tabular">{{ formatRate(p.rate) }}</span>
                  <span class="bo-secondary-text tabular">{{ p.term }} días</span>
                </div>
              </td>
              <td data-label="Estado" class="bo-td-status"><app-status [stage]="p.stage" /></td>
              <td data-label="Creado" class="num"><span class="bo-secondary-text">{{ formatDate(p.createdAt) }}</span></td>
              <td class="bo-td-icon bo-td-hide-sm"><i class="bi bi-chevron-right bo-chevron"></i></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ProcessTableComponent {
  readonly api = inject(BackofficeApi);
  private router = inject(Router);

  @Input({ required: true }) rows: ProcessRowVm[] = [];
  @Input() loading = false;
  @Input() showApplicant = true;
  @Input() skeletonRows = 6;
  @Input() emptyTitle = 'No hay procesos';
  @Input() emptyHint = '';
  @Input() emptyId = 'backoffice-processes-empty';
  /** Where a row leads: the process page, or its review in the approvals queue. */
  @Input() linkBase = '/procesos';

  readonly formatCOP = formatCOP;
  readonly formatDate = formatDate;
  readonly formatRate = formatRate;
  readonly initials = initials;
  readonly titleCase = titleCase;

  get skeleton(): number[] {
    return Array.from({ length: this.skeletonRows }, (_, i) => i);
  }

  /** The whole row opens the detail; a click on the inner link is left to it. */
  open(id: string, event?: Event): void {
    if (event && (event.target as HTMLElement).closest('a')) return;
    void this.router.navigate([this.linkBase, id]);
  }
}
