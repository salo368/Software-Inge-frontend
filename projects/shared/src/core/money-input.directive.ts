import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { formatMoneyInput, formatMoneyValue } from './money-input';

/**
 * Peso amount field for reactive forms: shows `5.000.000`, the control holds
 * the number `5000000` (or `null` when empty, so `required` still applies).
 * Zero is a valid amount here. Use on `<input type="text" appMoneyInput>`.
 */
@Directive({
  selector: 'input[appMoneyInput]',
  standalone: true,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MoneyInputDirective), multi: true },
  ],
  host: {
    '(input)': 'onInput($event)',
    '(focus)': 'onFocus()',
    '(blur)': 'onTouched()',
  },
})
export class MoneyInputDirective implements ControlValueAccessor {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private digits = '';

  private onChange: (value: number | null) => void = () => undefined;
  onTouched: () => void = () => undefined;

  writeValue(value: number | null): void {
    const shown = formatMoneyValue(value);
    this.el.value = shown;
    this.digits = shown.replace(/\D/g, '');
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.el.disabled = disabled;
  }

  onInput(event: Event): void {
    const el = this.el;
    const r = formatMoneyInput(
      el.value,
      el.selectionStart ?? el.value.length,
      this.digits,
      (event as InputEvent).inputType,
      true,
    );
    el.value = r.shown;
    el.setSelectionRange(r.caret, r.caret);
    this.digits = r.digits;
    this.onChange(r.digits === '' ? null : Number(r.digits));
  }

  /** Select the content so typing replaces the default "0" instead of appending to it. */
  onFocus(): void {
    setTimeout(() => this.el.select());
  }
}
