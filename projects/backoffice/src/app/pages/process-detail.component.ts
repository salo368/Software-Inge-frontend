import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { formatCOP } from '@shared/core/format';
import { projectedInterest } from '@shared/core/processes.service';

import { AdminUser, BackofficeApi, ProcessDetail } from '../core/backoffice-api.service';
import { STAGES, STAGE_LABEL, formatDateTime, formatRate, initials, shortId, titleCase } from '../core/labels';
import { FormSectionsComponent } from '../ui/form-sections.component';
import { StatusComponent } from '../ui/status.component';
import { ShellComponent } from './shell.component';

/** One process (`GET /processes/get-process`, readable by admins) with its form. */
@Component({
  selector: 'app-process-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, ShellComponent, StatusComponent, FormSectionsComponent],
  templateUrl: './process-detail.component.html',
})
export class ProcessDetailComponent implements OnInit, OnDestroy {
  readonly api = inject(BackofficeApi);
  private route = inject(ActivatedRoute);
  private copyTimer: number | null = null;

  readonly STAGES = STAGES;
  readonly STAGE_LABEL = STAGE_LABEL;
  readonly formatCOP = formatCOP;
  readonly formatDateTime = formatDateTime;
  readonly formatRate = formatRate;
  readonly initials = initials;
  readonly shortId = shortId;
  readonly titleCase = titleCase;

  loading = signal(true);
  notFound = signal(false);
  error = signal<string | null>(null);
  process = signal<ProcessDetail | null>(null);
  owner = signal<AdminUser | null>(null);
  ownerLoading = signal(true);
  copied = signal<'process' | 'signature' | null>(null);

  readonly bank = computed(() => {
    const p = this.process();
    return p ? (this.api.banksById().get(p.bank_id) ?? null) : null;
  });
  readonly stageIndex = computed(() => {
    const p = this.process();
    return p ? STAGES.indexOf(p.stage) : -1;
  });
  readonly interest = computed(() => {
    const p = this.process();
    return p ? projectedInterest(p) : 0;
  });
  /** The review (approvals) applies to the stages that wait for a backoffice decision. */
  readonly awaitsDecision = computed(() => {
    const stage = this.process()?.stage;
    return stage === 'REVIEW' || stage === 'SENT_TO_BANK';
  });
  readonly formUpdatedAt = computed(() => {
    const at = this.process()?.submitted_form?.['updated_at'];
    return typeof at === 'string' ? formatDateTime(at) : null;
  });

  async copy(value: string, which: 'process' | 'signature'): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(which);
      if (this.copyTimer !== null) window.clearTimeout(this.copyTimer);
      this.copyTimer = window.setTimeout(() => this.copied.set(null), 1500);
    } catch {
      this.copied.set(null);
    }
  }

  ngOnInit(): void {
    this.api.loadBanks();
    const id = this.route.snapshot.paramMap.get('id') ?? '';

    this.api.getProcess(id).subscribe({
      next: ({ process }) => {
        this.process.set(process);
        this.loading.set(false);
        this.api.getUser(process.user_id).subscribe({
          next: ({ user }) => {
            this.owner.set(user);
            this.ownerLoading.set(false);
          },
          error: () => this.ownerLoading.set(false),
        });
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        if (err.status === 404 || err.status === 400) this.notFound.set(true);
        else this.error.set('No pudimos cargar el proceso. Intenta de nuevo.');
      },
    });
  }

  ngOnDestroy(): void {
    if (this.copyTimer !== null) window.clearTimeout(this.copyTimer);
  }
}
