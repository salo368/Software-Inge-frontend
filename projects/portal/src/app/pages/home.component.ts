import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AnimatedMoneyComponent } from '@shared/components/animated-money.component';
import { AuthService } from '@shared/core/auth.service';
import { BanksService, Bank } from '@shared/core/banks.service';
import { blockUrl } from '@shared/core/blocks';
import { formatCOP } from '@shared/core/format';
import {
  ProcessRow,
  ProcessStage,
  ProcessesService,
  projectedInterest,
} from '@shared/core/processes.service';

const STAGE_LABEL: Record<ProcessStage, string> = {
  FORM: 'Diligenciando datos',
  DOCUMENTS: 'Cargando documentos',
  SIGNATURE: 'Firma pendiente',
  PAYMENT: 'Pago pendiente',
  REVIEW: 'En revision',
  SENT_TO_BANK: 'Enviado al banco',
  COMPLETED: 'CDT activo',
};

const STAGE_CLASS: Record<ProcessStage, string> = {
  FORM: 'text-bg-warning',
  DOCUMENTS: 'text-bg-warning',
  SIGNATURE: 'text-bg-info',
  PAYMENT: 'text-bg-info',
  REVIEW: 'text-bg-primary',
  SENT_TO_BANK: 'text-bg-primary',
  COMPLETED: 'text-bg-success',
};

interface Row {
  proc: ProcessRow;
  bank: Bank | undefined;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, AnimatedMoneyComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private processesApi = inject(ProcessesService);
  private banksApi = inject(BanksService);

  readonly formatCOP = formatCOP;
  /** The simulator is another block: a document navigation, not an Angular route. */
  readonly simulatorUrl = blockUrl('simulator');
  readonly stageLabel = STAGE_LABEL;
  readonly stageClass = STAGE_CLASS;
  readonly user = this.auth.user;

  loading = signal(true);
  logoutBusy = signal(false);
  processes = signal<ProcessRow[]>([]);
  banks = signal<Bank[]>([]);

  readonly rows = computed<Row[]>(() =>
    this.processes().map((p) => ({
      proc: p,
      bank: this.banks().find((b) => b.id === p.bank_id),
    })),
  );

  ngOnInit(): void {
    this.auth.me().subscribe({ error: () => {} });

    this.banksApi.listBanks().subscribe({ next: (r) => this.banks.set(r.banks) });

    this.processesApi.listMine().subscribe({
      next: (r) => {
        this.processes.set(r.processes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  interest(p: ProcessRow): number {
    return projectedInterest(p);
  }

  logout(): void {
    if (this.logoutBusy()) return;
    this.logoutBusy.set(true);
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => {
        this.auth.clear();
        this.router.navigate(['/login']);
      },
    });
  }
}
