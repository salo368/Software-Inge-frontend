/**
 * International dialling codes, hardcoded on purpose (they don't change and
 * the backend only stores the digits as text in `forms.phone_ext`).
 *
 * Keyed by ISO 3166-1 alpha-2, the same `abbr` the countries catalog
 * (`GET /forms/get-locations?type=countries`) returns for each of its 196
 * countries. `scripts/generate-flags-css.js` reads the keys of this table to
 * decide which flags ship with the app, so adding a country here means running
 * that script again.
 *
 * Codes are digits without "+". Where a code is shared inside a numbering plan
 * (the Caribbean NANP, +1) the area code is part of the value ("1876" for
 * Jamaica), as people write it, and it fits `phone_ext` (10 chars).
 */
export const DIAL_CODES: Readonly<Record<string, string>> = {
  AD: '376', AE: '971', AF: '93', AG: '1268', AL: '355', AM: '374', AO: '244', AR: '54',
  AT: '43', AU: '61', AZ: '994', BA: '387', BB: '1246', BD: '880', BE: '32', BF: '226',
  BG: '359', BH: '973', BI: '257', BJ: '229', BN: '673', BO: '591', BR: '55', BS: '1242',
  BT: '975', BW: '267', BY: '375', BZ: '501', CA: '1', CD: '243', CF: '236', CG: '242',
  CH: '41', CI: '225', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53',
  CV: '238', CY: '357', CZ: '420', DE: '49', DJ: '253', DK: '45', DM: '1767', DO: '1809',
  DZ: '213', EC: '593', EE: '372', EG: '20', ER: '291', ES: '34', ET: '251', FI: '358',
  FJ: '679', FM: '691', FR: '33', GA: '241', GB: '44', GD: '1473', GE: '995', GH: '233',
  GM: '220', GN: '224', GQ: '240', GR: '30', GT: '502', GW: '245', GY: '592', HN: '504',
  HR: '385', HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IN: '91', IQ: '964',
  IR: '98', IS: '354', IT: '39', JM: '1876', JO: '962', JP: '81', KE: '254', KG: '996',
  KH: '855', KI: '686', KM: '269', KN: '1869', KP: '850', KR: '82', KW: '965', KZ: '7',
  LA: '856', LB: '961', LC: '1758', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370',
  LU: '352', LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382', MG: '261',
  MH: '692', MK: '389', ML: '223', MM: '95', MN: '976', MR: '222', MT: '356', MU: '230',
  MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258', NA: '264', NE: '227', NG: '234',
  NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NZ: '64', OM: '968', PA: '507',
  PE: '51', PG: '675', PH: '63', PK: '92', PL: '48', PS: '970', PT: '351', PW: '680',
  PY: '595', QA: '974', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677',
  SC: '248', SD: '249', SE: '46', SG: '65', SI: '386', SK: '421', SL: '232', SM: '378',
  SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SY: '963', SZ: '268',
  TD: '235', TG: '228', TH: '66', TJ: '992', TL: '670', TM: '993', TN: '216', TO: '676',
  TR: '90', TT: '1868', TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1',
  UY: '598', UZ: '998', VA: '379', VC: '1784', VE: '58', VN: '84', VU: '678', WS: '685',
  YE: '967', ZA: '27', ZM: '260', ZW: '263',
};

/** Country shown when nothing else says otherwise (the product is Colombian). */
export const DEFAULT_DIAL_COUNTRY = 'CO';

/**
 * When several countries share a code, the one a saved number maps back to.
 * The backend keeps only the digits, so "1" alone can't say US from Canada.
 */
const SHARED_CODE_PREFERRED: Readonly<Record<string, string>> = {
  '1': 'US',
  '7': 'RU',
  '39': 'IT',
  '44': 'GB',
};

/** Digits of the dial code of `iso2`, or '' for an unknown country. */
export function dialOf(iso2: string | null | undefined): string {
  return DIAL_CODES[(iso2 ?? '').toUpperCase()] ?? '';
}

/**
 * Country for a saved `phone_ext` (any of "57", "+57", " 57 ", "0057" ...).
 * Falls back to Colombia when the text isn't a known code (older free-text
 * values), so the form always opens with a valid choice.
 */
export function countryForDial(phoneExt: string | null | undefined): string {
  const digits = (phoneExt ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return DEFAULT_DIAL_COUNTRY;
  const preferred = SHARED_CODE_PREFERRED[digits];
  if (preferred) return preferred;
  const found = Object.keys(DIAL_CODES).find((iso) => DIAL_CODES[iso] === digits);
  return found ?? DEFAULT_DIAL_COUNTRY;
}

/** Option shape the searchable select understands. */
export interface DialOption {
  /** ISO 3166-1 alpha-2, unique (unlike the dial code, which is shared). */
  key: string;
  /** Country name, as the catalog writes it. */
  label: string;
  /** What the closed field shows next to the flag. */
  display: string;
  /** Right-aligned in the list. */
  hint: string;
  /** CSS class of the flag. */
  icon: string;
  /** Extra text the search matches besides the name: the code, with and without "+". */
  keywords: string;
  /** 1 for the country a shared code maps back to (US for +1), so it ranks first on a tie. */
  priority: number;
}

/**
 * Dial options from the countries catalog (`{KEY: {label, abbr}}`), sorted by
 * country name. Countries the table doesn't know are skipped, never shown
 * with an empty code.
 */
export function buildDialOptions(catalog: Record<string, { label: string; abbr: string }>): DialOption[] {
  return Object.values(catalog)
    .filter((c) => !!dialOf(c.abbr))
    .map((c) => {
      const iso = c.abbr.toUpperCase();
      const dial = dialOf(iso);
      return {
        key: iso,
        label: c.label,
        display: `+${dial}`,
        hint: `+${dial}`,
        icon: `fi fi-${iso.toLowerCase()}`,
        keywords: `+${dial} ${dial}`,
        priority: SHARED_CODE_PREFERRED[dial] === iso ? 1 : 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}
