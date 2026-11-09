import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { ComboFieldComponent, ComboOption } from './combo-field.component';

const COUNTRIES: ComboOption[] = [
  { key: 'ARGENTINA', label: 'Argentina' },
  { key: 'BOLIVIA', label: 'Bolivia' },
  { key: 'COLOMBIA', label: 'Colombia' },
  { key: 'COREA_SUR', label: 'Corea del Sur' },
  { key: 'COSTA_RICA', label: 'Costa Rica' },
  { key: 'ESCOCIA', label: 'Escocia' },
  { key: 'PERU', label: 'Perú' },
];

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, ComboFieldComponent],
  template: `
    <form (submit)="submitted = submitted + 1; $event.preventDefault()">
      <app-combo-field
        inputId="c"
        [formControl]="ctrl"
        [options]="options()"
        [pinned]="pinned"
        [maxVisible]="max"
        noOptionsText="Elige primero el departamento"
      />
    </form>
  `,
})
class HostComponent {
  ctrl = new FormControl<string>('', [Validators.required]);
  options = signal<ComboOption[]>(COUNTRIES);
  pinned: string[] = [];
  max = 50;
  submitted = 0;
}

describe('ComboFieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  const input = () => el.querySelector<HTMLInputElement>('#c')!;
  const panel = () => el.querySelector('.combo-panel');
  const rows = () => Array.from(el.querySelectorAll<HTMLElement>('.combo-option'));
  const rowLabels = () => rows().map((r) => r.querySelector('.combo-label')!.textContent!.trim());
  const flush = () => {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };
  const type = (text: string) => {
    input().value = text;
    input().dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    flush();
  };
  const key = (k: string) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    input().dispatchEvent(ev);
    flush();
    return ev;
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('pone el id en el <input> real y expone el rol combobox', () => {
    expect(input().tagName).toBe('INPUT');
    expect(input().getAttribute('role')).toBe('combobox');
    expect(el.querySelector('app-combo-field')!.getAttribute('id')).toBeNull();
  });

  it('muestra la etiqueta de la opción elegida', () => {
    host.ctrl.setValue('COLOMBIA');
    fixture.detectChanges();
    expect(input().value).toBe('Colombia');
  });

  it('el valor llega antes que las opciones: la etiqueta aparece cuando las opciones cargan', () => {
    host.options.set([]);
    fixture.detectChanges();
    host.ctrl.setValue('PERU');
    fixture.detectChanges();
    expect(input().value).toBe('');
    host.options.set(COUNTRIES);
    fixture.detectChanges();
    expect(input().value).toBe('Perú');
    expect(host.ctrl.value).toBe('PERU');
  });

  it('al escribir filtra y ordena de más a menos probable', fakeAsync(() => {
    type('co');
    expect(panel()).not.toBeNull();
    expect(rowLabels()).toEqual(['Colombia', 'Costa Rica', 'Corea del Sur', 'Escocia']);
  }));

  it('ignora tildes y mayúsculas', fakeAsync(() => {
    type('PERU');
    expect(rowLabels()).toEqual(['Perú']);
  }));

  it('resalta lo que coincide', fakeAsync(() => {
    type('col');
    const mark = el.querySelector('.combo-option mark')!;
    expect(mark.textContent).toBe('Col');
  }));

  it('sin coincidencias avisa; sin opciones da otra pista', fakeAsync(() => {
    type('zzz');
    expect(el.querySelector('.combo-empty')!.textContent).toContain('Sin resultados');
    host.options.set([]);
    fixture.detectChanges();
    type('a');
    expect(el.querySelector('.combo-empty')!.textContent).toContain('Elige primero el departamento');
  }));

  it('elegir con clic guarda la clave, cierra el panel y muestra la etiqueta', fakeAsync(() => {
    type('bol');
    rows()[0].click();
    flush();
    expect(host.ctrl.value).toBe('BOLIVIA');
    expect(input().value).toBe('Bolivia');
    expect(panel()).toBeNull();
    expect(host.ctrl.valid).toBeTrue();
  }));

  it('flechas + Enter eligen, y Enter no envía el formulario', fakeAsync(() => {
    type('co');
    key('ArrowDown'); // Colombia -> Costa Rica
    const enter = key('Enter');
    expect(host.ctrl.value).toBe('COSTA_RICA');
    expect(enter.defaultPrevented).toBeTrue();
    expect(host.submitted).toBe(0);
  }));

  it('con el panel cerrado, Enter sí sigue su curso (envía el formulario)', fakeAsync(() => {
    host.ctrl.setValue('COLOMBIA');
    fixture.detectChanges();
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBeFalse();
  }));

  it('las flechas no se salen de la lista', fakeAsync(() => {
    type('co');
    for (let i = 0; i < 10; i++) key('ArrowDown');
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Escocia');
    for (let i = 0; i < 10; i++) key('ArrowUp');
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Colombia');
  }));

  it('ArrowDown con el panel cerrado lo abre, empezando en la opción elegida', fakeAsync(() => {
    host.ctrl.setValue('COSTA_RICA');
    fixture.detectChanges();
    key('ArrowDown');
    expect(panel()).not.toBeNull();
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Costa Rica');
  }));

  it('Escape cierra y restaura la elección anterior', fakeAsync(() => {
    host.ctrl.setValue('COLOMBIA');
    fixture.detectChanges();
    type('bol');
    expect(rowLabels()).toEqual(['Bolivia']);
    key('Escape');
    expect(panel()).toBeNull();
    expect(input().value).toBe('Colombia');
    expect(host.ctrl.value).toBe('COLOMBIA');
  }));

  it('al salir con texto que no es una opción vuelve a la última elección', fakeAsync(() => {
    host.ctrl.setValue('COLOMBIA');
    fixture.detectChanges();
    type('xyz');
    input().dispatchEvent(new Event('blur'));
    flush();
    expect(input().value).toBe('Colombia');
    expect(host.ctrl.value).toBe('COLOMBIA');
  }));

  it('al salir con el nombre exacto lo elige (aunque sin tildes ni mayúsculas)', fakeAsync(() => {
    type('PERU');
    input().dispatchEvent(new Event('blur'));
    flush();
    expect(host.ctrl.value).toBe('PERU');
    expect(input().value).toBe('Perú');
  }));

  it('vaciar el campo y salir borra la elección, y `required` lo marca', fakeAsync(() => {
    host.ctrl.setValue('COLOMBIA');
    fixture.detectChanges();
    type('');
    input().dispatchEvent(new Event('blur'));
    flush();
    expect(host.ctrl.value).toBe('');
    expect(host.ctrl.hasError('required')).toBeTrue();
  }));

  it('sin escribir lista las opciones en el orden dado, con las fijadas primero', fakeAsync(() => {
    host.pinned = ['COLOMBIA'];
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.combo-chevron')!.click();
    flush();
    expect(rowLabels()[0]).toBe('Colombia');
    expect(rowLabels().slice(1)).toEqual(['Argentina', 'Bolivia', 'Corea del Sur', 'Costa Rica', 'Escocia', 'Perú']);
  }));

  it('acota las filas dibujadas y avisa cuántas hay', fakeAsync(() => {
    host.max = 3;
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.combo-chevron')!.click();
    flush();
    expect(rows().length).toBe(3);
    expect(el.querySelector('.combo-more')!.textContent).toContain('Mostrando 3 de 7');
  }));

  it('con muchas opciones nunca dibuja más del tope', fakeAsync(() => {
    host.options.set(Array.from({ length: 500 }, (_, i) => ({ key: `K${i}`, label: `Ciudad ${i}` })));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.combo-chevron')!.click();
    flush();
    expect(rows().length).toBe(50);
    type('ciudad 49');
    expect(rowLabels()[0]).toBe('Ciudad 49');
  }));

  it('marca como seleccionada la opción actual', fakeAsync(() => {
    host.ctrl.setValue('PERU');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.combo-chevron')!.click();
    flush();
    const sel = el.querySelector('.combo-option.selected')!;
    expect(sel.textContent).toContain('Perú');
    expect(sel.getAttribute('aria-selected')).toBe('true');
  }));

  it('deshabilitado: no abre', fakeAsync(() => {
    host.ctrl.disable();
    fixture.detectChanges();
    expect(input().disabled).toBeTrue();
    expect(el.querySelector<HTMLButtonElement>('.combo-chevron')!.disabled).toBeTrue();
  }));
});

// ---------------------------------------------------------------------------
// Modo sin búsqueda: un select con el mismo aspecto, para listas cortas.
// ---------------------------------------------------------------------------

const CIVIL: ComboOption[] = [
  { key: 'SINGLE', label: 'Soltero(a)' },
  { key: 'MARRIED', label: 'Casado(a)' },
  { key: 'DIVORCED', label: 'Divorciado(a)' },
  { key: 'WIDOWED', label: 'Viudo(a)' },
];

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, ComboFieldComponent],
  template: `<app-combo-field inputId="s" [formControl]="ctrl" [options]="options" [searchable]="false" placeholder="Selecciona" />`,
})
class StaticHostComponent {
  ctrl = new FormControl<string>('', [Validators.required]);
  options = CIVIL;
}

describe('ComboFieldComponent (sin búsqueda)', () => {
  let fixture: ComponentFixture<StaticHostComponent>;
  let host: StaticHostComponent;
  let el: HTMLElement;

  const input = () => el.querySelector<HTMLInputElement>('#s')!;
  const rowLabels = () => Array.from(el.querySelectorAll('.combo-option')).map((r) => r.textContent!.trim());
  const flush = () => {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };
  const key = (k: string) => {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    input().dispatchEvent(ev);
    flush();
    return ev;
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(StaticHostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('el campo es de solo lectura: se parece a un select, no a una caja de texto', () => {
    expect(input().readOnly).toBeTrue();
    expect(input().classList).toContain('combo-select');
    expect(input().getAttribute('aria-readonly')).toBe('true');
    expect(input().placeholder).toBe('Selecciona');
  });

  it('un clic abre todas las opciones, sin filtrar, y otro clic cierra', fakeAsync(() => {
    input().click();
    flush();
    expect(rowLabels()).toEqual(['Soltero(a)', 'Casado(a)', 'Divorciado(a)', 'Viudo(a)']);
    expect(el.querySelector('.combo-more')).toBeNull();
    input().click();
    flush();
    expect(el.querySelector('.combo-panel')).toBeNull();
  }));

  it('elegir con el clic guarda la clave y muestra la etiqueta', fakeAsync(() => {
    input().click();
    flush();
    (el.querySelectorAll('.combo-option')[2] as HTMLElement).click();
    flush();
    expect(host.ctrl.value).toBe('DIVORCED');
    expect(input().value).toBe('Divorciado(a)');
    expect(el.querySelector('.combo-panel')).toBeNull();
  }));

  it('la opción actual sale marcada y abre posicionada en ella', fakeAsync(() => {
    host.ctrl.setValue('MARRIED');
    fixture.detectChanges();
    input().click();
    flush();
    expect(el.querySelector('.combo-option.selected')!.textContent).toContain('Casado(a)');
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Casado(a)');
  }));

  it('Espacio abre; con el panel abierto, Espacio elige la resaltada', fakeAsync(() => {
    const open = key(' ');
    expect(open.defaultPrevented).toBeTrue();
    expect(el.querySelector('.combo-panel')).not.toBeNull();
    key('ArrowDown');
    key(' ');
    expect(host.ctrl.value).toBe('MARRIED');
    expect(el.querySelector('.combo-panel')).toBeNull();
  }));

  it('flechas y Enter eligen', fakeAsync(() => {
    key('ArrowDown'); // el primero solo abre, en la primera opción
    key('ArrowDown'); // baja a Casado(a)
    key('Enter');
    expect(host.ctrl.value).toBe('MARRIED');
  }));

  it('una letra salta a la siguiente opción que empieza por ella, y da la vuelta', fakeAsync(() => {
    key('d');
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Divorciado(a)');
    key('v');
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Viudo(a)');
    key('s'); // vuelve al principio
    expect(el.querySelector('.combo-option.active')!.textContent).toContain('Soltero(a)');
    key('Enter');
    expect(host.ctrl.value).toBe('SINGLE');
  }));

  it('escribir no cambia el texto del campo ni filtra', fakeAsync(() => {
    input().click();
    flush();
    key('z'); // ninguna opción empieza por z
    expect(rowLabels().length).toBe(4);
    expect(input().value).toBe('');
  }));

  it('Escape cierra sin cambiar la elección', fakeAsync(() => {
    host.ctrl.setValue('SINGLE');
    fixture.detectChanges();
    key('ArrowDown');
    key('ArrowDown');
    key('Escape');
    expect(el.querySelector('.combo-panel')).toBeNull();
    expect(host.ctrl.value).toBe('SINGLE');
  }));

  it('al salir sin elegir no borra nada ni inventa un valor', fakeAsync(() => {
    input().click();
    flush();
    input().dispatchEvent(new Event('blur'));
    flush();
    expect(host.ctrl.value).toBe('');
    expect(host.ctrl.hasError('required')).toBeTrue();
  }));
});

// ---------------------------------------------------------------------------
// Opciones con bandera, indicativo y palabras clave (selector de indicativo).
// ---------------------------------------------------------------------------

const DIALS: ComboOption[] = [
  { key: 'CO', label: 'Colombia', display: '+57', hint: '+57', icon: 'fi fi-co', keywords: '+57 57' },
  { key: 'ES', label: 'España', display: '+34', hint: '+34', icon: 'fi fi-es', keywords: '+34 34' },
  { key: 'US', label: 'Estados Unidos', display: '+1', hint: '+1', icon: 'fi fi-us', keywords: '+1 1' },
  { key: 'CA', label: 'Canadá', display: '+1', hint: '+1', icon: 'fi fi-ca', keywords: '+1 1' },
];

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, ComboFieldComponent],
  template: `<app-combo-field inputId="p" [formControl]="ctrl" [options]="options" panelMinWidth="21rem" />`,
})
class DialHostComponent {
  ctrl = new FormControl<string>('CO', [Validators.required]);
  options = DIALS;
}

describe('ComboFieldComponent (opciones con bandera e indicativo)', () => {
  let fixture: ComponentFixture<DialHostComponent>;
  let host: DialHostComponent;
  let el: HTMLElement;

  const input = () => el.querySelector<HTMLInputElement>('#p')!;
  const flush = () => {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };
  const type = (text: string) => {
    input().value = text;
    input().dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    flush();
  };
  const keys = () => Array.from(el.querySelectorAll<HTMLElement>('.combo-option')).map((r) => r.dataset['key']);

  beforeEach(() => {
    fixture = TestBed.createComponent(DialHostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('el campo cerrado muestra la bandera y solo el indicativo, no el nombre del país', () => {
    expect(input().value).toBe('+57');
    const flag = el.querySelector('.combo-flag')!;
    expect(flag.classList).toContain('fi-co');
    expect(input().classList).toContain('has-icon');
  });

  it('la clave es el país, así que +1 de EE. UU. y de Canadá no se confunden', () => {
    host.ctrl.setValue('CA');
    fixture.detectChanges();
    expect(input().value).toBe('+1');
    expect(el.querySelector('.combo-flag')!.classList).toContain('fi-ca');
    host.ctrl.setValue('US');
    fixture.detectChanges();
    expect(el.querySelector('.combo-flag')!.classList).toContain('fi-us');
  });

  it('sin valor no dibuja bandera', () => {
    host.ctrl.setValue('');
    fixture.detectChanges();
    expect(el.querySelector('.combo-flag')).toBeNull();
    expect(input().value).toBe('');
  });

  it('la lista muestra bandera, país e indicativo en cada fila', fakeAsync(() => {
    el.querySelector<HTMLButtonElement>('.combo-chevron')!.click();
    flush();
    const row = el.querySelector('.combo-option[data-key="ES"]')!;
    expect(row.querySelector('.combo-icon')!.classList).toContain('fi-es');
    expect(row.querySelector('.combo-label')!.textContent!.trim()).toBe('España');
    expect(row.querySelector('.combo-hint')!.textContent!.trim()).toBe('+34');
  }));

  it('busca por número, con o sin +, aunque el nombre no lo tenga', fakeAsync(() => {
    type('34');
    expect(keys()).toEqual(['ES']);
    type('+57');
    expect(keys()).toEqual(['CO']);
  }));

  it('con +1 salen EE. UU. y Canadá, y elegir uno guarda su país', fakeAsync(() => {
    type('1');
    expect(keys().sort()).toEqual(['CA', 'US']);
    el.querySelector<HTMLElement>('.combo-option[data-key="CA"]')!.click();
    flush();
    expect(host.ctrl.value).toBe('CA');
    expect(input().value).toBe('+1');
  }));

  it('buscar por nombre resalta el nombre; por número no resalta nada', fakeAsync(() => {
    type('esp');
    expect(el.querySelector('.combo-option mark')!.textContent).toBe('esp'.length === 3 ? 'Esp' : '');
    type('34');
    expect(el.querySelector('.combo-option mark')).toBeNull();
  }));

  it('al escribir, el campo muestra lo escrito y no la bandera de la elección anterior', fakeAsync(() => {
    type('esp');
    expect(el.querySelector('.combo-flag')).toBeNull();
    expect(input().value).toBe('esp');
  }));

  it('el panel puede ser más ancho que el campo', fakeAsync(() => {
    el.querySelector<HTMLButtonElement>('.combo-chevron')!.click();
    flush();
    // 21rem, o lo que quede de pantalla a la derecha del campo si es menos.
    expect((el.querySelector('.combo-panel') as HTMLElement).style.minWidth).toContain('21rem');
  }));
});
