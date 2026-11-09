import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AnimatedMoneyComponent } from '@shared/components/animated-money.component';
import { AuthService } from '@shared/core/auth.service';
import { BanksService, SimulationRow } from '@shared/core/banks.service';
import { blockUrl } from '@shared/core/blocks';
import { formatCOP, tierCss } from '@shared/core/format';
import { formatMoneyInput } from '@shared/core/money-input';
import { PENDING_CDT_KEY, PendingCdtIntent } from '@shared/core/pending-cdt';
import { ProcessesService } from '@shared/core/processes.service';

interface TermOption {
  key: number;
  label: string;
}

/** "6 meses" for a fixed chip, "200 dias" for a free term. */
function termLabel(days: number): string {
  return TERMS.find((t) => t.key === days)?.label ?? `${days} dias`;
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
  /** What the amount field shows: thousands dots, no leading zeros. The value is `amount`. */
  amountText = signal('5.000.000');
  term = signal<number>(360);
  sortBy = signal<'yield' | 'safety'>('yield');
  showResults = signal(false);

  loading = signal(false);
  error = signal<string | null>(null);
  results = signal<SimulationRow[]>([]);

  totalBanks = signal(0);

  /**
   * Raw text of the free-term field. Kept apart from `term` so the field
   * never rewrites what the user is typing (e.g. "9" -> "90" must not snap
   * to the 3-months chip and clear itself). Empty means a chip is in charge.
   */
  customText = signal('');
  /** Term the shown results were simulated with (the field may have changed since). */
  simulatedTerm = signal<number | null>(null);
  readonly selectedTermLabel = computed(() => termLabel(this.term()));
  /** Label for the results on screen: the simulated term, not whatever is typed now. */
  readonly resultsTermLabel = computed(() => termLabel(this.simulatedTerm() ?? this.term()));
  /** There are real rates to summarize; otherwise the hero shows a dash, never 0.00%. */
  readonly hasMarket = computed(() => this.showResults() && this.results().length > 0);
  readonly isValid = computed(() => (this.amount() || 0) > 0 && this.term() >= 1);
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
        this.simulatedTerm.set(r.term);
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

  /**
   * Keeps the amount field clean while typing or pasting (digits only, thousands
   * dots as display, no leading zeros, caret kept). A native number input keeps
   * the raw text, which is what produced the leading zeros. See money-input.ts.
   * The model stays plain digits: dots are display only.
   */
  onAmountInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const r = formatMoneyInput(
      el.value,
      el.selectionStart ?? el.value.length,
      this.amountText().replace(/\D/g, ''),
      (event as InputEvent).inputType,
    );
    el.value = r.shown;
    el.setSelectionRange(r.caret, r.caret);
    this.amountText.set(r.shown);
    this.amount.set(r.digits ? Number(r.digits) : 0);
  }

  changeTerm(t: number): void {
    const wasCustom = this.customText() !== '';
    this.customText.set('');
    if (this.term() === t && !wasCustom) return;
    this.term.set(t);
    if (this.showResults()) this.onSimulate();
  }

  /**
   * Free term in days, to try periods the chips don't cover. Typing only
   * updates the term (0 = invalid, disables the button); the simulation runs
   * on Enter or on the button, not on every keystroke.
   */
  onCustomTerm(raw: string | number | null): void {
    const text = raw === null || raw === undefined ? '' : String(raw);
    this.customText.set(text);
    const n = Math.floor(Number(text));
    // Empty field: hand control back to the last chip-less state (term 0 = invalid).
    this.term.set(text !== '' && Number.isFinite(n) && n >= 1 ? n : 0);
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
