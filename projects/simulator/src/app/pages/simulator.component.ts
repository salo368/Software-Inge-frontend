import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AnimatedMoneyComponent } from '@shared/components/animated-money.component';
import { AuthService } from '@shared/core/auth.service';
import { BanksService, SimulationRow } from '@shared/core/banks.service';
import { blockUrl } from '@shared/core/blocks';
import { formatCOP, tierCss } from '@shared/core/format';
import { PENDING_CDT_KEY, PendingCdtIntent } from '@shared/core/pending-cdt';
import { ProcessesService } from '@shared/core/processes.service';

interface TermOption {
  key: number;
  label: string;
}

const TERMS: TermOption[] = [
  { key: 90, label: '3 meses' },
  { key: 180, label: '6 meses' },
  { key: 360, label: '12 meses' },
  { key: 540, label: '18 meses' },
  { key: 720, label: '24 meses' },
];

const TIER_RANK: Record<string, number> = { AAA: 5, 'AA+': 4, AA: 3, 'A+': 2, A: 1 };
const TIER_LABEL: Record<string, string> = {
  AAA: 'Solidez maxima',
  'AA+': 'Solidez muy alta',
  AA: 'Solidez alta',
  'A+': 'Solidez media',
  A: 'Solidez estandar',
};

@Component({
  selector: 'app-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule, AnimatedMoneyComponent],
  templateUrl: './simulator.component.html',
})
export class SimulatorComponent implements OnInit {
  private banksApi = inject(BanksService);
  private processesApi = inject(ProcessesService);
  private auth = inject(AuthService);

  openingId = signal<number | null>(null);

  readonly TERMS = TERMS;
  readonly formatCOP = formatCOP;
  readonly tierCss = tierCss;
  readonly tierLabel = TIER_LABEL;

  amount = signal<number>(5_000_000);
  term = signal<number>(360);
  sortBy = signal<'yield' | 'safety'>('yield');
  showResults = signal(false);

  loading = signal(false);
  error = signal<string | null>(null);
  results = signal<SimulationRow[]>([]);

  totalBanks = signal(0);

  readonly selectedTermLabel = computed(
    () => TERMS.find((t) => t.key === this.term())?.label ?? '',
  );
  readonly isValid = computed(() => (this.amount() || 0) > 0);
  readonly marketMin = computed(() => {
    const r = this.results();
    return r.length ? Math.min(...r.map((x) => x.rate)) : 0;
  });
  readonly marketMax = computed(() => {
    const r = this.results();
    return r.length ? Math.max(...r.map((x) => x.rate)) : 0;
  });
  readonly sortedResults = computed(() => {
    const rows = [...this.results()];
    if (this.sortBy() === 'safety') {
      rows.sort(
        (a, b) =>
          (TIER_RANK[b.bank.tier] ?? 0) - (TIER_RANK[a.bank.tier] ?? 0) || b.rate - a.rate,
      );
    } else {
      rows.sort((a, b) => b.rate - a.rate);
    }
    return rows;
  });

  ngOnInit(): void {
    this.banksApi.listBanks().subscribe({
      next: (r) => this.totalBanks.set(r.banks.length),
    });
  }

  onSimulate(): void {
    if (!this.isValid() || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.banksApi.simulate(this.amount(), this.term()).subscribe({
      next: (r) => {
        this.results.set(r.results);
        this.showResults.set(true);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        const code = err?.error?.error;
        this.error.set(
          code === 'invalid_amount'
            ? 'Ingresa un monto mayor a cero.'
            : code === 'invalid_term'
              ? 'Elige un plazo valido.'
              : 'No se pudo simular. Intenta de nuevo.',
        );
      },
    });
  }

  changeTerm(t: number): void {
    if (this.term() === t) return;
    this.term.set(t);
    if (this.showResults()) this.onSimulate();
  }

  openCdt(row: SimulationRow): void {
    const intent: PendingCdtIntent = {
      bank_id: row.bank.id,
      amount: this.amount(),
      term: this.term(),
    };
    if (!this.auth.isAuthenticated()) {
      localStorage.setItem(PENDING_CDT_KEY, JSON.stringify(intent));
      window.location.assign(blockUrl('portal', 'register'));
      return;
    }
    if (this.openingId() !== null) return;
    this.openingId.set(row.bank.id);
    this.processesApi.create(intent).subscribe({
      next: (p) => {
        this.openingId.set(null);
        window.location.assign(blockUrl('portal', `process/${p.id}`));
      },
      error: (err) => {
        this.openingId.set(null);
        this.error.set(
          err?.error?.error === 'Bank not available for the given amount and term'
            ? 'Esta entidad ya no ofrece ese monto y plazo. Simula de nuevo.'
            : 'No pudimos abrir el CDT. Intenta de nuevo.',
        );
      },
    });
  }
}
