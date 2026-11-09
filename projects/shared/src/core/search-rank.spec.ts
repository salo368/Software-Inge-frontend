import { fold, rankOptions, scoreLabel } from './search-rank';

const opt = (label: string) => ({ key: label.toUpperCase(), label });
const labels = (r: { item: { label: string } }[]) => r.map((x) => x.item.label);

describe('fold', () => {
  it('quita tildes y mayúsculas sin cambiar el largo', () => {
    expect(fold('Bogotá D.C.')).toBe('bogota d.c.');
    expect(fold('Nariño')).toBe('narino');
    expect(fold('Nariño').length).toBe('Nariño'.length);
    expect(fold('QUINDÍO')).toBe('quindio');
    expect(fold('Perú — Ñandú')).toBe('peru — nandu');
  });
});

describe('scoreLabel', () => {
  it('ordena exacto > empieza por > empieza una palabra > está dentro', () => {
    const exact = scoreLabel('Colombia', 'colombia')!.score;
    const starts = scoreLabel('Colombia', 'col')!.score;
    const word = scoreLabel('La Paz', 'paz')!.score;
    const inside = scoreLabel('Colombia', 'bia')!.score;
    expect(exact).toBeGreaterThan(starts);
    expect(starts).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inside);
  });

  it('ignora tildes al buscar y al marcar el trozo', () => {
    const m = scoreLabel('Bogotá D.C.', 'bogota')!;
    expect(m.score).toBeGreaterThan(0);
    expect([m.start, m.end]).toEqual([0, 6]);
    const n = scoreLabel('San Andrés y Providencia', 'andres')!;
    expect([n.start, n.end]).toEqual([4, 10]);
  });

  it('varias palabras: cada una puede estar en cualquier orden', () => {
    expect(scoreLabel('San Andrés y Providencia', 'prov san')).not.toBeNull();
    expect(scoreLabel('San Andrés y Providencia', 'san zzz')).toBeNull();
  });

  it('devuelve null cuando no coincide, y todo con consulta vacía', () => {
    expect(scoreLabel('Colombia', 'xyz')).toBeNull();
    expect(scoreLabel('Colombia', '   ')!.score).toBe(0);
  });
});

describe('rankOptions', () => {
  const countries = ['Costa Rica', 'Colombia', 'Corea del Sur', 'Escocia', 'Bolivia', 'Perú'].map(opt);

  it('pone primero los que empiezan por lo escrito (el más corto, que es más específico) y al final los que lo tienen a mitad', () => {
    expect(labels(rankOptions(countries, 'co'))).toEqual(['Colombia', 'Costa Rica', 'Corea del Sur', 'Escocia']);
  });

  it('un nombre más corto gana a uno más largo con la misma coincidencia', () => {
    const r = rankOptions([opt('Santander de Quilichao'), opt('Santander')], 'santander');
    expect(labels(r)).toEqual(['Santander', 'Santander de Quilichao']);
  });

  it('prefiere el inicio de palabra a estar a mitad de palabra', () => {
    // "paz" abre palabra en "La Paz"; está a mitad de "Cipaz".
    const r = rankOptions([opt('Cipaz'), opt('La Paz')], 'paz');
    expect(labels(r)).toEqual(['La Paz', 'Cipaz']);
  });

  it('filtra lo que no coincide', () => {
    expect(labels(rankOptions(countries, 'peru'))).toEqual(['Perú']);
    expect(rankOptions(countries, 'zzz')).toEqual([]);
  });

  it('con consulta vacía respeta el orden dado', () => {
    expect(labels(rankOptions(countries, ''))).toEqual(labels(countries.map((item) => ({ item }))));
  });

  it('encuentra "Nariño" escribiendo "narino" y "Quindío" con "quindio"', () => {
    expect(labels(rankOptions([opt('Nariño'), opt('Quindío'), opt('Chocó')], 'narino'))).toEqual(['Nariño']);
    expect(labels(rankOptions([opt('Nariño'), opt('Quindío')], 'QUINDIO'))).toEqual(['Quindío']);
  });
});

describe('rankOptions con palabras clave (texto que no se ve)', () => {
  const phones = [
    { key: 'US', label: 'Estados Unidos', keywords: '+1 1' },
    { key: 'JM', label: 'Jamaica', keywords: '+1876 1876' },
    { key: 'BS', label: 'Bahamas', keywords: '+1242 1242' },
    { key: 'CO', label: 'Colombia', keywords: '+57 57' },
  ];

  it('encuentra por el código aunque no esté en el nombre', () => {
    expect(rankOptions(phones, '57').map((r) => r.item.key)).toEqual(['CO']);
    expect(rankOptions(phones, '+57').map((r) => r.item.key)).toEqual(['CO']);
  });

  it('el código exacto va antes que los que solo empiezan igual (1 -> +1 antes que +1876)', () => {
    expect(rankOptions(phones, '1').map((r) => r.item.key)[0]).toBe('US');
    expect(rankOptions(phones, '+1').map((r) => r.item.key)[0]).toBe('US');
    expect(rankOptions(phones, '1876').map((r) => r.item.key)[0]).toBe('JM');
  });

  it('el nombre sigue ganando a las palabras clave y no se resalta nada en ellas', () => {
    const r = rankOptions(phones, 'jam');
    expect(r[0].item.key).toBe('JM');
    expect([r[0].start, r[0].end]).toEqual([0, 3]);
    const byCode = rankOptions(phones, '57')[0];
    expect([byCode.start, byCode.end]).toEqual([0, 0]);
  });

  it('un número solo coincide por el inicio del código: 57 no trae +257 ni +357', () => {
    const real = [
      { key: 'CO', label: 'Colombia', keywords: '+57 57' },
      { key: 'BI', label: 'Burundi', keywords: '+257 257' },
      { key: 'CY', label: 'Chipre', keywords: '+357 357' },
      { key: 'NG', label: 'Nigeria', keywords: '+234 234' },
      { key: 'ES', label: 'España', keywords: '+34 34' },
    ];
    expect(rankOptions(real, '57').map((r) => r.item.key)).toEqual(['CO']);
    expect(rankOptions(real, '+34').map((r) => r.item.key)).toEqual(['ES']);
    expect(rankOptions(real, '3').map((r) => r.item.key)).toEqual(['CY', 'ES']);
  });

  it('con el mismo puntaje gana la opción con más prioridad, aunque tenga el nombre más largo', () => {
    const both = [
      { key: 'CA', label: 'Canadá', keywords: '+1 1', priority: 0 },
      { key: 'US', label: 'Estados Unidos', keywords: '+1 1', priority: 1 },
    ];
    expect(rankOptions(both, '1').map((r) => r.item.key)).toEqual(['US', 'CA']);
    // Sin prioridad, el desempate sigue siendo el nombre más corto.
    expect(rankOptions(both.map(({ priority, ...o }) => o), '1').map((r) => r.item.key)).toEqual(['CA', 'US']);
  });

  it('sin coincidencia en nombre ni en código no sale', () => {
    expect(rankOptions(phones, 'zzz')).toEqual([]);
  });
});
