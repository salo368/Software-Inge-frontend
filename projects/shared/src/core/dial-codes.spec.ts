import {
  DEFAULT_DIAL_COUNTRY,
  DIAL_CODES,
  buildDialOptions,
  countryForDial,
  dialOf,
} from './dial-codes';
import { rankOptions } from './search-rank';

/**
 * The `abbr` of the 196 countries the backend catalog returned when this table
 * was written (`GET /forms/get-locations?type=countries`). If the backend adds
 * a country, this fixture and DIAL_CODES must grow together (then run
 * `node scripts/generate-flags-css.js`).
 */
const CATALOG_ISO = (
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO ' +
  'CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID ' +
  'IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ' +
  'ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB ' +
  'SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN ' +
  'VU WS YE ZA ZM ZW'
).split(' ');

describe('DIAL_CODES', () => {
  it('cubre exactamente los países del catálogo del backend', () => {
    expect(CATALOG_ISO.length).toBe(196);
    expect(CATALOG_ISO.filter((iso) => !DIAL_CODES[iso])).toEqual([]);
    expect(Object.keys(DIAL_CODES).filter((iso) => !CATALOG_ISO.includes(iso))).toEqual([]);
  });

  it('son solo dígitos y caben en phone_ext (10 caracteres)', () => {
    for (const [iso, code] of Object.entries(DIAL_CODES)) {
      expect(iso).toMatch(/^[A-Z]{2}$/);
      expect(code).toMatch(/^[1-9]\d{0,9}$/);
    }
  });

  it('tiene los indicativos que más se usan', () => {
    expect(dialOf('CO')).toBe('57');
    expect(dialOf('US')).toBe('1');
    expect(dialOf('ES')).toBe('34');
    expect(dialOf('VE')).toBe('58');
    expect(dialOf('MX')).toBe('52');
    expect(dialOf('PA')).toBe('507');
    expect(dialOf('JM')).toBe('1876'); // el Caribe NANP lleva su código de área
    expect(dialOf('co')).toBe('57'); // sin importar mayúsculas
    expect(dialOf('XX')).toBe('');
    expect(dialOf(null)).toBe('');
  });
});

describe('countryForDial', () => {
  it('encuentra el país de un indicativo guardado, escrito como sea', () => {
    expect(countryForDial('57')).toBe('CO');
    expect(countryForDial('+57')).toBe('CO');
    expect(countryForDial(' 57 ')).toBe('CO');
    expect(countryForDial('0057')).toBe('CO');
    expect(countryForDial('34')).toBe('ES');
  });

  it('con un código compartido elige el país más probable', () => {
    expect(countryForDial('1')).toBe('US');
    expect(countryForDial('7')).toBe('RU');
    expect(countryForDial('44')).toBe('GB');
    expect(countryForDial('1876')).toBe('JM');
  });

  it('con un valor vacío o desconocido cae en Colombia', () => {
    expect(countryForDial('')).toBe(DEFAULT_DIAL_COUNTRY);
    expect(countryForDial(null)).toBe(DEFAULT_DIAL_COUNTRY);
    expect(countryForDial('999')).toBe(DEFAULT_DIAL_COUNTRY);
    expect(countryForDial('abc')).toBe(DEFAULT_DIAL_COUNTRY);
  });

  it('ida y vuelta: el indicativo de cada país vuelve a un país con el mismo código', () => {
    for (const iso of Object.keys(DIAL_CODES)) {
      expect(dialOf(countryForDial(DIAL_CODES[iso]))).toBe(DIAL_CODES[iso]);
    }
  });
});

describe('buildDialOptions', () => {
  const catalog = {
    COLOMBIA: { label: 'Colombia', abbr: 'CO' },
    ALEMANIA: { label: 'Alemania', abbr: 'DE' },
    ESTADOS_UNIDOS: { label: 'Estados Unidos', abbr: 'US' },
    CANADA: { label: 'Canadá', abbr: 'CA' },
    INVENTADO: { label: 'Inventado', abbr: 'XX' },
  };

  it('arma bandera, indicativo y texto de búsqueda, ordenado por nombre', () => {
    const opts = buildDialOptions(catalog);
    expect(opts.map((o) => o.label)).toEqual(['Alemania', 'Canadá', 'Colombia', 'Estados Unidos']);
    const co = opts.find((o) => o.key === 'CO')!;
    expect(co).toEqual({
      key: 'CO',
      label: 'Colombia',
      display: '+57',
      hint: '+57',
      icon: 'fi fi-co',
      keywords: '+57 57',
      priority: 0,
    });
  });

  it('descarta países sin indicativo en vez de mostrarlos con el código vacío', () => {
    expect(buildDialOptions(catalog).some((o) => o.key === 'XX')).toBeFalse();
  });

  it('las claves son únicas aunque el indicativo se repita', () => {
    const opts = buildDialOptions(catalog);
    const us = opts.find((o) => o.key === 'US')!;
    const ca = opts.find((o) => o.key === 'CA')!;
    expect(us.display).toBe(ca.display); // los dos son +1
    expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length);
  });

  it('con +1, Estados Unidos va antes que Canadá (el país al que vuelve un +1 guardado)', () => {
    const opts = buildDialOptions(catalog);
    expect(opts.find((o) => o.key === 'US')!.priority).toBe(1);
    expect(opts.find((o) => o.key === 'CA')!.priority).toBe(0);
    expect(rankOptions(opts, '+1').map((r) => r.item.key)).toEqual(['US', 'CA']);
    expect(rankOptions(opts, '1').map((r) => r.item.key)).toEqual(['US', 'CA']);
  });

  it('se busca por nombre o por número, con o sin "+"', () => {
    const opts = buildDialOptions(catalog);
    expect(rankOptions(opts, 'colom')[0].item.key).toBe('CO');
    expect(rankOptions(opts, '57').map((r) => r.item.key)).toEqual(['CO']);
    expect(rankOptions(opts, '+57').map((r) => r.item.key)).toEqual(['CO']);
    expect(rankOptions(opts, '49')[0].item.key).toBe('DE');
  });
});
