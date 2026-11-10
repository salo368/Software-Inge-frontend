/**
 * Pure helpers for the date field: ISO <-> display conversion, the typing
 * mask and the month grid. Dates travel as ISO `yyyy-mm-dd` strings (what the
 * forms API takes); the user sees and types `dd/mm/aaaa`.
 *
 * Everything works in the calendar sense (year, month, day), never through
 * `Date` in local time, so there are no time zone off-by-one days.
 */

export const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

/** Monday first. */
export const WEEKDAYS_ES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export interface YMD {
  y: number;
  /** 1-12 */
  m: number;
  d: number;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isRealDate(y: number, m: number, d: number): boolean {
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function toIso(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** `null` unless `iso` is a real calendar date (rejects 2023-02-31). */
export function parseIso(iso: string | null | undefined): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isRealDate(y, mo, d) ? { y, m: mo, d } : null;
}

/** Today in the user's local calendar (not UTC: after 7 pm in Colombia UTC is already tomorrow). */
export function todayIso(now = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Same day-month, `years` earlier (29 Feb falls back to 28 Feb). */
export function isoYearsAgo(years: number, from = todayIso()): string {
  const p = parseIso(from)!;
  const y = p.y - years;
  return toIso(y, p.m, Math.min(p.d, daysInMonth(y, p.m)));
}

/** `1990-05-01` -> `01/05/1990`; '' when not a valid ISO date. */
export function isoToDisplay(iso: string | null | undefined): string {
  const p = parseIso(iso);
  return p ? `${pad(p.d)}/${pad(p.m)}/${pad(p.y, 4)}` : '';
}

/** `01/05/1990` -> `1990-05-01`; `null` when incomplete or not a real date. */
export function displayToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isRealDate(y, mo, d) ? toIso(y, mo, d) : null;
}

/** ISO strings compare correctly as text. */
export function addDays(iso: string, n: number): string {
  const p = parseIso(iso)!;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function clampIso(iso: string, min: string, max: string): string {
  return iso < min ? min : iso > max ? max : iso;
}

/** Long label for screen readers: "2 de noviembre de 2026". */
export function spokenDate(iso: string): string {
  const p = parseIso(iso)!;
  return `${p.d} de ${MONTHS_ES[p.m - 1].toLowerCase()} de ${p.y}`;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export interface DayCell {
  iso: string;
  day: number;
  /** Belongs to the month on screen (the rest is the neighbour month's spill). */
  inMonth: boolean;
}

/** 6 weeks x 7 days, Monday first. `month` is 0-11. */
export function buildMonthGrid(year: number, month: number): DayCell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const t = new Date(Date.UTC(year, month, 1 - offset + i));
    cells.push({
      iso: toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()),
      day: t.getUTCDate(),
      inMonth: t.getUTCMonth() === month,
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Typing mask
// ---------------------------------------------------------------------------

export interface DateMaskResult {
  /** Text for the field: `dd`, `dd/mm`, `dd/mm/aaaa`. */
  shown: string;
  /** Typed digits (max 8). */
  digits: string;
  caret: number;
}

function caretAfterDigits(shown: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < shown.length; i++) {
    if (/\d/.test(shown[i]) && ++seen === count) return i + 1;
  }
  return shown.length;
}

function mask(digits: string): string {
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  return d + (digits.length > 2 ? `/${m}` : '') + (digits.length > 4 ? `/${y}` : '');
}

/**
 * Applies the `dd/mm/aaaa` mask after an edit: only digits are kept and the
 * slashes appear by themselves. A pasted ISO date (`1990-05-01`, also what
 * automated tests type) is converted. Backspace/Delete beside a slash removes
 * the neighbouring digit instead of just the slash, so it never looks stuck.
 */
export function formatDateInput(
  raw: string,
  caret: number,
  prevDigits: string,
  inputType: string | undefined,
): DateMaskResult {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(raw);
  if (iso) {
    const digits = iso[3] + iso[2] + iso[1];
    const shown = mask(digits);
    return { shown, digits, caret: shown.length };
  }

  let digits = raw.replace(/\D/g, '');
  let before = raw.slice(0, caret).replace(/\D/g, '').length;

  if (digits === prevDigits) {
    if (inputType === 'deleteContentBackward' && before > 0) {
      digits = digits.slice(0, before - 1) + digits.slice(before);
      before -= 1;
    } else if (inputType === 'deleteContentForward') {
      digits = digits.slice(0, before) + digits.slice(before + 1);
    }
  }

  digits = digits.slice(0, 8);
  const shown = mask(digits);
  return { shown, digits, caret: caretAfterDigits(shown, Math.min(before, digits.length)) };
}
