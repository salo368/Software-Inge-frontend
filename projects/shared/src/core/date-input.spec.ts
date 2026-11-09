import {
  addDays,
  buildMonthGrid,
  clampIso,
  daysInMonth,
  displayToIso,
  formatDateInput,
  isoToDisplay,
  isoYearsAgo,
  parseIso,
  spokenDate,
  todayIso,
} from './date-input';

describe('conversión ISO <-> pantalla', () => {
  it('convierte en ambos sentidos', () => {
    expect(isoToDisplay('1990-05-01')).toBe('01/05/1990');
    expect(displayToIso('01/05/1990')).toBe('1990-05-01');
    expect(isoToDisplay('')).toBe('');
    expect(isoToDisplay(null)).toBe('');
    expect(isoToDisplay('basura')).toBe('');
  });

  it('rechaza fechas que no existen', () => {
    expect(parseIso('2023-02-31')).toBeNull();
    expect(parseIso('2023-13-01')).toBeNull();
    expect(parseIso('2023-00-10')).toBeNull();
    expect(displayToIso('31/02/2023')).toBeNull();
    expect(displayToIso('29/02/2023')).toBeNull();
    expect(displayToIso('29/02/2024')).toBe('2024-02-29'); // bisiesto
    expect(displayToIso('1/5/1990')).toBeNull();           // incompleta
    expect(displayToIso('01/05')).toBeNull();
  });

  it('daysInMonth respeta bisiestos', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28); // 1900 no es bisiesto
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2023, 12)).toBe(31);
  });
});

describe('aritmética de fechas', () => {
  it('addDays cruza mes y año', () => {
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2024-01-15', 7)).toBe('2024-01-22');
  });

  it('clampIso acota al rango', () => {
    expect(clampIso('1800-01-01', '1900-01-01', '2026-01-01')).toBe('1900-01-01');
    expect(clampIso('2030-01-01', '1900-01-01', '2026-01-01')).toBe('2026-01-01');
    expect(clampIso('2000-06-01', '1900-01-01', '2026-01-01')).toBe('2000-06-01');
  });

  it('isoYearsAgo resta años y ajusta el 29 de febrero', () => {
    expect(isoYearsAgo(30, '2026-11-08')).toBe('1996-11-08');
    expect(isoYearsAgo(1, '2024-02-29')).toBe('2023-02-28');
  });

  it('todayIso usa el día local, no el UTC', () => {
    // 23:30 del 8 de noviembre en hora local: el ISO UTC ya sería el 9.
    expect(todayIso(new Date(2026, 10, 8, 23, 30))).toBe('2026-11-08');
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });

  it('spokenDate lo lee en español', () => {
    expect(spokenDate('2026-11-02')).toBe('2 de noviembre de 2026');
  });
});

describe('buildMonthGrid', () => {
  it('son 6 semanas de 7 días y empieza en lunes', () => {
    const g = buildMonthGrid(2026, 10); // noviembre 2026: el 1 cae domingo
    expect(g.length).toBe(42);
    expect(g[0].iso).toBe('2026-10-26');  // lunes anterior
    expect(g[6].iso).toBe('2026-11-01');  // domingo 1
    expect(g[6].inMonth).toBeTrue();
    expect(g[0].inMonth).toBeFalse();
  });

  it('marca bien los días del mes y los de relleno', () => {
    const g = buildMonthGrid(2024, 1); // febrero 2024 (bisiesto)
    expect(g.filter((c) => c.inMonth).length).toBe(29);
    expect(g.find((c) => c.iso === '2024-02-29')?.inMonth).toBeTrue();
    expect(g.at(-1)!.inMonth).toBeFalse();
  });

  it('un mes que empieza en lunes no tiene relleno al inicio', () => {
    const g = buildMonthGrid(2026, 5); // junio 2026: el 1 cae lunes
    expect(g[0].iso).toBe('2026-06-01');
    expect(g[0].inMonth).toBeTrue();
  });
});

describe('máscara dd/mm/aaaa', () => {
  const type = (raw: string, caret = raw.length, prev = '', inputType = 'insertText') =>
    formatDateInput(raw, caret, prev, inputType);

  it('pone las barras solas mientras se escribe', () => {
    expect(type('1').shown).toBe('1');
    expect(type('12').shown).toBe('12');
    expect(type('123').shown).toBe('12/3');
    expect(type('1234').shown).toBe('12/34');
    expect(type('12345').shown).toBe('12/34/5');
    expect(type('12031990').shown).toBe('12/03/1990');
  });

  it('ignora letras, símbolos y lo que sobra de 8 dígitos', () => {
    expect(type('1a2/0b3-1990').shown).toBe('12/03/1990');
    expect(type('120319901234').shown).toBe('12/03/1990');
  });

  it('acepta una fecha ISO pegada (también lo que escriben los tests automáticos)', () => {
    const r = type('1999-11-02');
    expect(r.shown).toBe('02/11/1999');
    expect(r.digits).toBe('02111999');
    expect(r.caret).toBe(10);
  });

  it('Backspace justo después de una barra borra el dígito anterior', () => {
    // "12/|03/1990" -> el navegador deja "1203/1990" con el cursor en 3
    const r = type('1203/1990', 2, '12031990', 'deleteContentBackward');
    expect(r.shown).toBe('10/31/990');
    expect(r.digits).toBe('103199' + '0');
  });

  it('Delete justo antes de una barra borra el dígito siguiente', () => {
    // "12|/03/1990" -> el navegador deja "1203/1990" con el cursor en 2
    const r = type('1203/1990', 2, '12031990', 'deleteContentForward');
    expect(r.digits).toBe('1231990');
  });

  it('mantiene el cursor tras insertar en medio', () => {
    // "12/|1990" y se escribe un 0 -> "12/01990" -> "12/01/990"
    const r = type('12/01990', 4, '121990');
    expect(r.shown).toBe('12/01/990');
    expect(r.caret).toBe(4);
  });
});
