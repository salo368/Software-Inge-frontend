import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';

import {
  DayCell,
  MONTHS_ES,
  WEEKDAYS_ES,
  addDays,
  buildMonthGrid,
  clampIso,
  displayToIso,
  formatDateInput,
  isoToDisplay,
  parseIso,
  spokenDate,
  todayIso,
} from '../core/date-input';

/**
 * Date field for forms: type `dd/mm/aaaa` (slashes appear by themselves) or
 * pick from a calendar with month and year selectors, so a birth date is two
 * clicks instead of dozens of "previous month". The control holds an ISO
 * `yyyy-mm-dd` string, or `null` while the date is incomplete or invalid (so
 * `Validators.required` keeps working). Pasting an ISO date also works.
 *
 * Put the `inputId` here, not on the host: it lands on the real `<input>`, so
 * `<label for>` and automated tests reach it.
 */
@Component({
  selector: 'app-date-field',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './date-field.component.html',
  styleUrl: './date-field.component.css',
})
export class DateFieldComponent implements ControlValueAccessor {
  @Input() inputId = '';
  /** Earliest / latest selectable date (ISO). */
  @Input() min = '1900-01-01';
  @Input() max = todayIso();
  /** Where the calendar opens when the field is empty (ISO). Defaults to `max`. */
  @Input() startView: string | null = null;
  @Input() placeholder = 'dd/mm/aaaa';

  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly ngControl = inject(NgControl, { self: true, optional: true });

  readonly MONTHS = MONTHS_ES;
  readonly WEEKDAYS = WEEKDAYS_ES;

  text = signal('');
  selected = signal<string | null>(null);
  open = signal(false);
  disabled = signal(false);
  /** Own message about what was typed (outranks the generic red border). */
  error = signal('');
  viewYear = signal(new Date().getFullYear());
  /** 0-11 */
  viewMonth = signal(new Date().getMonth());

  readonly today = todayIso();
  readonly grid = computed(() => buildMonthGrid(this.viewYear(), this.viewMonth()));
  readonly years = computed(() => {
    const top = parseIso(this.max)?.y ?? new Date().getFullYear();
    const bottom = parseIso(this.min)?.y ?? top - 120;
    return Array.from({ length: Math.max(top - bottom + 1, 1) }, (_, i) => top - i);
  });
  readonly canPrev = computed(() => this.monthKey(this.viewYear(), this.viewMonth() - 1) >= this.min.slice(0, 7));
  readonly canNext = computed(() => this.monthKey(this.viewYear(), this.viewMonth() + 1) <= this.max.slice(0, 7));

  /**
   * Day the keyboard is on. Kept here and updated synchronously: reading it from
   * `document.activeElement` is wrong when two keys arrive before the focus
   * (moved in a timeout) has caught up, e.g. a held arrow key.
   */
  cursor: string | null = null;

  private onChange: (v: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  // -------------------------------------------------------------------------
  // ControlValueAccessor
  // -------------------------------------------------------------------------

  writeValue(value: string | null): void {
    const p = parseIso(value);
    this.selected.set(p ? value : null);
    this.text.set(p ? isoToDisplay(value) : '');
    this.error.set('');
    if (p) this.setView(p.y, p.m - 1);
  }

  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) this.close();
  }

  // -------------------------------------------------------------------------
  // Typing
  // -------------------------------------------------------------------------

  /** Red border from the form (touched + invalid) or from what was typed here. */
  showInvalid(): boolean {
    const c = this.ngControl;
    return !!this.error() || !!(c?.invalid && (c.touched || c.dirty));
  }

  onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    const r = formatDateInput(
      el.value,
      el.selectionStart ?? el.value.length,
      this.text().replace(/\D/g, ''),
      (event as InputEvent).inputType,
    );
    el.value = r.shown;
    el.setSelectionRange(r.caret, r.caret);
    this.text.set(r.shown);
    this.commit(r.digits.length === 8 ? r.shown : null);
  }

  onBlur(): void {
    this.onTouched();
    const digits = this.text().replace(/\D/g, '');
    if (digits.length > 0 && digits.length < 8) {
      this.error.set('Escribe la fecha completa: dd/mm/aaaa.');
    }
  }

  /** `fullText` is a complete `dd/mm/aaaa`, or null while incomplete. */
  private commit(fullText: string | null): void {
    if (fullText === null) {
      this.error.set('');
      this.selected.set(null);
      this.onChange(null);
      return;
    }
    const iso = displayToIso(fullText);
    if (!iso) return this.reject('Esa fecha no existe.');
    if (iso < this.min) return this.reject(`No puede ser anterior al ${isoToDisplay(this.min)}.`);
    if (iso > this.max) {
      return this.reject(
        this.max === this.today ? 'No puede ser una fecha futura.' : `No puede ser posterior al ${isoToDisplay(this.max)}.`,
      );
    }
    this.error.set('');
    this.selected.set(iso);
    const p = parseIso(iso)!;
    this.setView(p.y, p.m - 1);
    this.onChange(iso);
  }

  private reject(message: string): void {
    this.error.set(message);
    this.selected.set(null);
    this.onChange(null);
  }

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------

  toggle(): void {
    if (this.disabled()) return;
    if (this.open()) {
      this.open.set(false);
      return;
    }
    const p = parseIso(this.selected() ?? this.startView ?? this.max) ?? parseIso(this.max)!;
    this.setView(p.y, p.m - 1);
    this.open.set(true);
    const start = this.selected() ?? clampIso(this.today, this.min, this.max);
    this.cursor = start;
    this.focusDay(start);
  }

  /** Keeps each day's button across month changes, so the focus is not lost on re-render. */
  trackIso(_: number, cell: DayCell): string {
    return cell.iso;
  }

  close(returnFocus = false): void {
    this.open.set(false);
    this.cursor = null;
    if (returnFocus) this.input()?.focus();
  }

  isOutOfRange(iso: string): boolean {
    return iso < this.min || iso > this.max;
  }

  pick(iso: string): void {
    if (this.isOutOfRange(iso)) return;
    this.selected.set(iso);
    this.text.set(isoToDisplay(iso));
    this.error.set('');
    this.onChange(iso);
    this.onTouched();
    this.close(true);
  }

  pickToday(): void {
    this.pick(this.today);
  }

  spoken(iso: string): string {
    return spokenDate(iso);
  }

  prevMonth(): void {
    if (this.canPrev()) this.shiftMonth(-1);
  }

  nextMonth(): void {
    if (this.canNext()) this.shiftMonth(1);
  }

  onMonthSelect(event: Event): void {
    this.viewMonth.set(Number((event.target as HTMLSelectElement).value));
  }

  onYearSelect(event: Event): void {
    this.viewYear.set(Number((event.target as HTMLSelectElement).value));
  }

  /** Arrow keys move by day/week, PageUp/PageDown by month, Home/End to the week's ends. */
  onGridKeydown(event: KeyboardEvent): void {
    const current = this.cursor ?? (document.activeElement as HTMLElement | null)?.dataset?.['iso'];
    if (!current) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target: string | null = null;
    if (event.key in step) {
      target = addDays(current, step[event.key]);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const p = parseIso(current)!;
      const dir = event.key === 'PageUp' ? -1 : 1;
      const t = new Date(Date.UTC(p.y, p.m - 1 + dir, 1));
      const dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
      target = `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(p.d, dim)).padStart(2, '0')}`;
    }
    if (!target) return;
    event.preventDefault();
    const next = clampIso(target, this.min, this.max);
    const p = parseIso(next)!;
    this.cursor = next;
    this.setView(p.y, p.m - 1);
    this.focusDay(next);
  }

  @HostListener('document:mousedown', ['$event'])
  onOutsideMouseDown(event: MouseEvent): void {
    if (this.open() && !this.host.contains(event.target as Node)) this.close();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private input(): HTMLInputElement | null {
    return this.host.querySelector('input');
  }

  private setView(y: number, month0: number): void {
    this.viewYear.set(y);
    this.viewMonth.set(month0);
  }

  private shiftMonth(delta: number): void {
    const t = new Date(Date.UTC(this.viewYear(), this.viewMonth() + delta, 1));
    this.setView(t.getUTCFullYear(), t.getUTCMonth());
  }

  /** `yyyy-mm` of a possibly out-of-range month, to compare with min/max. */
  private monthKey(y: number, month0: number): string {
    const t = new Date(Date.UTC(y, month0, 1));
    return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private focusDay(iso: string): void {
    setTimeout(() => this.host.querySelector<HTMLElement>(`button[data-iso="${iso}"]`)?.focus());
  }
}
