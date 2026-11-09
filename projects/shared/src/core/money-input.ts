/**
 * Display logic for peso amounts typed by hand: digits only, thousands dots
 * that are visual (the value stays a plain number), no leading zeros, and a
 * caret that does not jump while the text is reformatted.
 *
 * A native `<input type="number">` keeps the raw text ("005000000"), shows no
 * separators and can't hold them, so amounts use a text input plus this.
 */

/** Integer digits the backend can store (NUMERIC(15,2)). */
export const MAX_MONEY_DIGITS = 13;

/** "5000000" -> "5.000.000" (es-CO thousands separator). Display only. */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Caret index in `shown` right after its `count`-th digit (dots don't count). */
export function caretAfterDigits(shown: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < shown.length; i++) {
    if (shown[i] !== '.' && ++seen === count) return i + 1;
  }
  return shown.length;
}

export interface MoneyInputResult {
  /** Text to put in the field, with thousands dots. */
  shown: string;
  /** Plain digits ('' when empty); the numeric value is `Number(digits)`. */
  digits: string;
  /** Where to leave the caret in `shown`. */
  caret: number;
}

/**
 * Cleans what is in the field after an edit.
 *
 * @param raw        field text right after the edit
 * @param caret      caret index in `raw`
 * @param prevDigits digits before the edit (to spot a deleted thousands dot)
 * @param inputType  `InputEvent.inputType` of the edit, if known
 * @param allowZero  keep a lone "0" (a valid amount) instead of emptying the
 *                   field; leading zeros are removed either way
 */
export function formatMoneyInput(
  raw: string,
  caret: number,
  prevDigits: string,
  inputType: string | undefined,
  allowZero = false,
): MoneyInputResult {
  let allDigits = raw.replace(/\D/g, '');
  let digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;

  // Backspace/Delete next to a thousands dot removes only the dot: the digits
  // don't change and the field would re-add it and look stuck. Delete the
  // neighbouring digit instead.
  if (allDigits === prevDigits) {
    if (inputType === 'deleteContentBackward' && digitsBeforeCaret > 0) {
      allDigits = allDigits.slice(0, digitsBeforeCaret - 1) + allDigits.slice(digitsBeforeCaret);
      digitsBeforeCaret -= 1;
    } else if (inputType === 'deleteContentForward') {
      allDigits = allDigits.slice(0, digitsBeforeCaret) + allDigits.slice(digitsBeforeCaret + 1);
    }
  }

  let leadingZeros = allDigits.length - allDigits.replace(/^0+/, '').length;
  // All zeros: "0" stays when zero is a valid amount ("000" -> "0").
  if (allowZero && leadingZeros > 0 && leadingZeros === allDigits.length) leadingZeros -= 1;

  const digits = allDigits.slice(leadingZeros, leadingZeros + MAX_MONEY_DIGITS);
  const shown = groupThousands(digits);
  const kept = Math.min(Math.max(digitsBeforeCaret - leadingZeros, 0), digits.length);
  return { shown, digits, caret: caretAfterDigits(shown, kept) };
}

/** Text for a numeric value coming from the model (rounded: pesos have no cents here). */
export function formatMoneyValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return groupThousands(String(Math.max(0, Math.round(value))));
}
