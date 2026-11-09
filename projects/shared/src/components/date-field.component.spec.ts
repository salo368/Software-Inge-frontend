import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { DateFieldComponent } from './date-field.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, DateFieldComponent],
  template: `
    <label for="d">Fecha</label>
    <app-date-field inputId="d" [formControl]="ctrl" min="1950-01-01" max="2025-12-31" startView="1996-06-15" />
  `,
})
class HostComponent {
  ctrl = new FormControl<string | null>('', [Validators.required]);
}

describe('DateFieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  const input = () => el.querySelector<HTMLInputElement>('#d')!;
  const typeText = (text: string, inputType = 'insertText') => {
    input().value = text;
    input().setSelectionRange(text.length, text.length);
    input().dispatchEvent(new InputEvent('input', { inputType }));
    fixture.detectChanges();
  };
  const openCalendar = () => {
    el.querySelector<HTMLButtonElement>('#d-toggle')!.click();
    fixture.detectChanges();
  };
  const day = (iso: string) => el.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`)!;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host = fixture.componentInstance;
    el = fixture.nativeElement;
  });

  it('pone el id en el <input> real, así que la etiqueta y los tests llegan a él', () => {
    expect(input()).not.toBeNull();
    expect(input().tagName).toBe('INPUT');
    expect(el.querySelector('app-date-field')!.getAttribute('id')).toBeNull();
  });

  it('muestra el valor del control como dd/mm/aaaa', () => {
    host.ctrl.setValue('1990-05-01');
    fixture.detectChanges();
    expect(input().value).toBe('01/05/1990');
  });

  it('al escribir completa las barras y el control guarda la fecha ISO', () => {
    typeText('02111999');
    expect(input().value).toBe('02/11/1999');
    expect(host.ctrl.value).toBe('1999-11-02');
    expect(host.ctrl.valid).toBeTrue();
  });

  it('acepta una fecha ISO pegada o escrita de golpe', () => {
    typeText('1999-11-02');
    expect(input().value).toBe('02/11/1999');
    expect(host.ctrl.value).toBe('1999-11-02');
  });

  it('incompleta -> null y `required` la marca inválida', () => {
    typeText('0211');
    expect(host.ctrl.value).toBeNull();
    expect(host.ctrl.hasError('required')).toBeTrue();
  });

  it('explica una fecha que no existe, una anterior al mínimo y una futura', () => {
    typeText('31022000');
    expect(el.querySelector('.date-field-error')!.textContent).toContain('no existe');
    expect(host.ctrl.value).toBeNull();

    typeText('01011940');
    expect(el.querySelector('.date-field-error')!.textContent).toContain('anterior al 01/01/1950');

    typeText('01012026');
    expect(el.querySelector('.date-field-error')!.textContent).toContain('posterior al 31/12/2025');

    typeText('31122025');
    expect(el.querySelector('.date-field-error')).toBeNull();
    expect(host.ctrl.value).toBe('2025-12-31');
  });

  it('al salir con la fecha a medias avisa que hay que completarla', () => {
    typeText('0211');
    input().dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(el.querySelector('.date-field-error')!.textContent).toContain('completa');
  });

  it('abre el calendario en la fecha inicial cuando el campo está vacío', () => {
    openCalendar();
    expect(el.querySelector('.date-popover')).not.toBeNull();
    const year = el.querySelector<HTMLSelectElement>('.date-select-year')!;
    const month = el.querySelector<HTMLSelectElement>('.date-select-month')!;
    expect(year.value).toBe('1996');
    expect(month.value).toBe('5'); // junio
  });

  it('elegir un día escribe la fecha, cierra el panel y deja el control válido', () => {
    openCalendar();
    day('1996-06-15').click();
    fixture.detectChanges();
    expect(host.ctrl.value).toBe('1996-06-15');
    expect(input().value).toBe('15/06/1996');
    expect(el.querySelector('.date-popover')).toBeNull();
  });

  it('cambiar año y mes con los selectores salta directo, sin navegar mes a mes', () => {
    openCalendar();
    const year = el.querySelector<HTMLSelectElement>('.date-select-year')!;
    year.value = '1975';
    year.dispatchEvent(new Event('change'));
    const month = el.querySelector<HTMLSelectElement>('.date-select-month')!;
    month.value = '2'; // marzo
    month.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(day('1975-03-10')).not.toBeNull();
    day('1975-03-10').click();
    fixture.detectChanges();
    expect(host.ctrl.value).toBe('1975-03-10');
  });

  it('los días fuera del rango están deshabilitados', () => {
    host.ctrl.setValue('2025-12-31');
    fixture.detectChanges();
    openCalendar();
    expect(day('2025-12-31').disabled).toBeFalse();
    expect(day('2026-01-01').disabled).toBeTrue(); // relleno del mes siguiente
    day('2026-01-01').click();
    fixture.detectChanges();
    expect(host.ctrl.value).toBe('2025-12-31');
  });

  it('no deja navegar más allá del mínimo ni del máximo', () => {
    host.ctrl.setValue('2025-12-31');
    fixture.detectChanges();
    openCalendar();
    const next = el.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!;
    expect(next.disabled).toBeTrue();

    host.ctrl.setValue('1950-01-20');
    fixture.detectChanges();
    const prev = el.querySelector<HTMLButtonElement>('button[aria-label="Mes anterior"]')!;
    expect(prev.disabled).toBeTrue();
  });

  it('marca el día elegido y resalta hoy', () => {
    host.ctrl.setValue('2025-11-03');
    fixture.detectChanges();
    openCalendar();
    expect(day('2025-11-03').classList).toContain('selected');
    expect(day('2025-11-03').getAttribute('aria-pressed')).toBe('true');
  });

  it('el botón Hoy elige el día de hoy cuando está en rango', () => {
    const c = fixture.debugElement.children[1].componentInstance as DateFieldComponent;
    openCalendar();
    const foot = el.querySelectorAll<HTMLButtonElement>('.date-link');
    expect(foot[0].textContent).toContain('Hoy');
    expect(foot[0].disabled).toBe(c.isOutOfRange(c.today));
  });

  it('Escape cierra el calendario', () => {
    openCalendar();
    el.querySelector('.date-field')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.date-popover')).toBeNull();
  });

  it('un clic fuera lo cierra', () => {
    openCalendar();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.date-popover')).toBeNull();
  });

  it('las flechas mueven el foco por día y semana, y PageUp/PageDown por mes', fakeAsync(() => {
    host.ctrl.setValue('2025-11-03');
    fixture.detectChanges();
    openCalendar();
    tick();
    const press = (key: string) => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      tick();
    };
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-11-03');
    press('ArrowRight');
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-11-04');
    press('ArrowDown');
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-11-11');
    press('PageUp');
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-10-11');
    // PageDown x3 sería 11-11, 12-11 y 2026-01-11: no pasa del máximo.
    for (let i = 0; i < 3; i++) press('PageDown');
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-12-31');
  }));

  it('dos teclas seguidas, antes de que el foco se mueva, no se pierden (tecla mantenida)', fakeAsync(() => {
    host.ctrl.setValue('2025-06-15');
    fixture.detectChanges();
    openCalendar();
    tick();
    const press = (key: string) =>
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );

    // Sin tick entre medio: el foco todavía no se movió cuando llega la segunda tecla.
    press('ArrowRight'); // 15 -> 16
    fixture.detectChanges();
    press('ArrowDown'); // 16 -> 23 (no 15 + 7 = 22)
    fixture.detectChanges();
    tick();
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-06-23');
  }));

  it('el foco sobrevive al cambiar de mes con el teclado', fakeAsync(() => {
    host.ctrl.setValue('2025-06-28');
    fixture.detectChanges();
    openCalendar();
    tick();
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    ); // 28 + 7 = 5 de julio
    fixture.detectChanges();
    tick();
    expect((document.activeElement as HTMLElement).dataset['iso']).toBe('2025-07-05');
    expect(el.querySelector<HTMLSelectElement>('.date-select-month')!.value).toBe('6'); // julio
  }));

  it('deshabilitado: no abre el calendario', () => {
    host.ctrl.disable();
    fixture.detectChanges();
    expect(input().disabled).toBeTrue();
    expect(el.querySelector<HTMLButtonElement>('#d-toggle')!.disabled).toBeTrue();
  });
});
