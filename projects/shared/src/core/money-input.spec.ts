import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { MoneyInputDirective } from './money-input.directive';
import {
  MAX_MONEY_DIGITS,
  caretAfterDigits,
  formatMoneyInput,
  formatMoneyValue,
  groupThousands,
} from './money-input';

describe('groupThousands / caretAfterDigits', () => {
  it('agrupa de a tres con punto', () => {
    expect(groupThousands('')).toBe('');
    expect(groupThousands('5')).toBe('5');
    expect(groupThousands('1234')).toBe('1.234');
    expect(groupThousands('5000000')).toBe('5.000.000');
    expect(groupThousands('89000000')).toBe('89.000.000');
  });

  it('ubica el cursor después del n-ésimo dígito sin contar los puntos', () => {
    expect(caretAfterDigits('1.234.567', 0)).toBe(0);
    expect(caretAfterDigits('1.234.567', 1)).toBe(1);
    expect(caretAfterDigits('1.234.567', 2)).toBe(3);
    expect(caretAfterDigits('1.234.567', 7)).toBe(9);
    expect(caretAfterDigits('1.234.567', 99)).toBe(9);
  });
});

describe('formatMoneyInput', () => {
  const edit = (raw: string, caret = raw.length, prev = '', type?: string, allowZero = false) =>
    formatMoneyInput(raw, caret, prev, type, allowZero);

  it('quita ceros a la izquierda y agrupa', () => {
    expect(edit('005000000').shown).toBe('5.000.000');
    expect(edit('005000000').digits).toBe('5000000');
  });

  it('ignora símbolos, letras y separadores al pegar', () => {
    expect(edit('$ 12.500.000 COP').digits).toBe('12500000');
    expect(edit('1a2-3e4.5').digits).toBe('12345');
  });

  it('un cero solo vacía el campo, salvo que cero sea un monto válido', () => {
    expect(edit('0').shown).toBe('');
    expect(edit('000').digits).toBe('');
    expect(edit('0', 1, '', undefined, true).shown).toBe('0');
    expect(edit('000', 3, '', undefined, true).digits).toBe('0');
    expect(edit('05', 2, '', undefined, true).digits).toBe('5');
  });

  it('respeta el tope de dígitos', () => {
    const r = edit('9'.repeat(20));
    expect(r.digits.length).toBe(MAX_MONEY_DIGITS);
    expect(r.shown).toBe('9.999.999.999.999');
  });

  it('mantiene el cursor al insertar en medio, cruzando el borde de grupo', () => {
    // "999|.999" y se escribe un 1 -> "9991.999"
    const r = edit('9991.999', 4, '999999', 'insertText');
    expect(r.shown).toBe('9.991.999');
    expect(r.caret).toBe(5);
  });

  it('Backspace justo después de un punto borra el dígito anterior (no se atasca)', () => {
    // "1.|234.567" -> el navegador deja "1234.567" con el cursor en 1
    const r = edit('1234.567', 1, '1234567', 'deleteContentBackward');
    expect(r.shown).toBe('234.567');
    expect(r.caret).toBe(0);
  });

  it('Delete justo antes de un punto borra el dígito siguiente', () => {
    // "1|.234.567" -> el navegador deja "1234.567" con el cursor en 1
    const r = edit('1234.567', 1, '1234567', 'deleteContentForward');
    expect(r.shown).toBe('134.567');
    expect(r.caret).toBe(1);
  });

  it('un borrado normal en medio de un grupo no toca otros dígitos', () => {
    // "1.234.5|67" -> Backspace borra el 5: el navegador deja "1.234.67"
    const r = edit('1.234.67', 6, '1234567', 'deleteContentBackward');
    expect(r.shown).toBe('123.467');
    expect(r.caret).toBe(5);
  });

  it('borrar el primer dígito no deja ceros ni puntos sueltos', () => {
    const r = edit('05.000', 1, '105000', 'deleteContentBackward');
    expect(r.shown).toBe('5.000');
  });
});

describe('formatMoneyValue', () => {
  it('formatea el valor del modelo y redondea los centavos', () => {
    expect(formatMoneyValue(1500000)).toBe('1.500.000');
    expect(formatMoneyValue(0)).toBe('0');
    expect(formatMoneyValue(1000.6)).toBe('1.001');
    expect(formatMoneyValue(null)).toBe('');
    expect(formatMoneyValue(undefined)).toBe('');
    expect(formatMoneyValue(NaN)).toBe('');
    expect(formatMoneyValue(-5)).toBe('0');
  });
});

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, MoneyInputDirective],
  template: `<input id="m" type="text" appMoneyInput [formControl]="ctrl" />`,
})
class HostComponent {
  ctrl = new FormControl<number | null>(0, [Validators.required, Validators.min(0)]);
}

describe('MoneyInputDirective', () => {
  let host: HostComponent;
  let input: HTMLInputElement;

  const type = (text: string, inputType = 'insertText') => {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new InputEvent('input', { inputType, data: text.slice(-1) }));
  };

  beforeEach(() => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host = fixture.componentInstance;
    input = fixture.nativeElement.querySelector('#m');
  });

  it('muestra el valor inicial formateado', () => {
    expect(input.value).toBe('0');
    host.ctrl.setValue(2500000);
    expect(input.value).toBe('2.500.000');
  });

  it('el control guarda el número, el campo muestra los puntos', () => {
    type('1234567');
    expect(input.value).toBe('1.234.567');
    expect(host.ctrl.value).toBe(1234567);
  });

  it('quita ceros a la izquierda pero permite cero', () => {
    type('005000');
    expect(input.value).toBe('5.000');
    expect(host.ctrl.value).toBe(5000);
    type('000');
    expect(input.value).toBe('0');
    expect(host.ctrl.value).toBe(0);
    expect(host.ctrl.valid).toBeTrue();
  });

  it('vacío -> null, y `required` lo marca inválido', () => {
    type('');
    expect(host.ctrl.value).toBeNull();
    expect(host.ctrl.hasError('required')).toBeTrue();
  });

  it('respeta el estado deshabilitado del control', () => {
    host.ctrl.disable();
    expect(input.disabled).toBeTrue();
  });
});
