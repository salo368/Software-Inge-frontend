import { CIVIL_STATUS_LABEL, DOCUMENT_TYPE_LABEL, EDUCATION_LEVEL_LABEL, GENDER_LABEL } from '@shared/core/forms.service';
import { ProcessStage } from '@shared/core/processes.service';

/** Order of the lifecycle (backend docs/processes-api.md §3). */
export const STAGES: readonly ProcessStage[] = [
  'FORM',
  'DOCUMENTS',
  'SIGNATURE',
  'PAYMENT',
  'REVIEW',
  'SENT_TO_BANK',
  'COMPLETED',
];

export const STAGE_LABEL: Record<ProcessStage, string> = {
  FORM: 'Diligenciando datos',
  DOCUMENTS: 'Cargando documentos',
  SIGNATURE: 'Firma pendiente',
  PAYMENT: 'Pago pendiente',
  REVIEW: 'En revisión',
  SENT_TO_BANK: 'Enviado al banco',
  COMPLETED: 'CDT activo',
};

export const FILE_TYPE_LABEL: Record<string, string> = {
  BANK_CERT: 'Certificación bancaria',
  TAX_DECLARATION: 'Declaración de renta',
  RUT: 'RUT',
  RAW_INVESTMENT_ORDER: 'Orden de inversión',
  INVESTMENT_ORDER: 'Orden de inversión firmada',
};

export const SIGNATURE_STAGE_LABEL: Record<string, string> = {
  FORM: 'Sin iniciar',
  BIOMETRICS: 'Validando identidad',
  SIGNATURE: 'Dibujando firma',
  OTP: 'Esperando código',
  SIGNING: 'Firmando',
  SIGNED: 'Firmada',
  FAILED: 'Fallida',
};

const bytesFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${bytesFormat.format(bytes / 1024)} KB`;
  return `${bytesFormat.format(bytes / (1024 * 1024))} MB`;
}

export function isStage(value: string): value is ProcessStage {
  return (STAGES as readonly string[]).includes(value);
}

const rateFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `12.3` -> `12,30 %`, with the same decimal comma as the peso amounts. */
export function formatRate(rate: number): string {
  return `${rateFormat.format(rate)} %`;
}

/** Forms store names as typed (often in capitals): show them in title case. */
export function titleCase(value: string | null | undefined): string {
  return (value ?? '')
    .toLocaleLowerCase('es-CO')
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('es-CO'));
}

/** First block of a UUID, upper case: enough to tell records apart at a glance. */
export function shortId(id: string | null | undefined): string {
  return (id ?? '').split('-')[0].toUpperCase();
}

/** Labels of the `submitted_form` keys (the KYC form of the portal). */
export const FORM_LABEL: Record<string, string> = {
  name: 'Primer nombre',
  second_name: 'Segundo nombre',
  last_name: 'Primer apellido',
  second_last_name: 'Segundo apellido',
  gender: 'Género',
  birth_date: 'Fecha de nacimiento',
  nationality: 'Nacionalidad',
  civil_status: 'Estado civil',
  education_level: 'Nivel educativo',
  birth_country: 'País de nacimiento',
  birth_department: 'Departamento de nacimiento',
  birth_city: 'Ciudad de nacimiento',
  document_type: 'Tipo de documento',
  document_number: 'Número de documento',
  document_issuance_date: 'Fecha de expedición',
  document_issuance_country: 'País de expedición',
  document_issuance_department: 'Departamento de expedición',
  document_issuance_city: 'Ciudad de expedición',
  email: 'Correo',
  phone_ext: 'Indicativo',
  phone_number: 'Celular',
  monthly_income: 'Ingresos mensuales',
  monthly_expenses: 'Egresos mensuales',
  total_assets: 'Total activos',
  total_liabilities: 'Total pasivos',
  is_tax_declarant: 'Declarante de renta',
  is_pep: 'Persona expuesta políticamente',
  updated_at: 'Formulario actualizado',
  created_at: 'Formulario creado',
};

export const FORM_SECTIONS: { title: string; icon: string; keys: string[] }[] = [
  {
    title: 'Información personal',
    icon: 'bi-person-vcard',
    keys: ['name', 'second_name', 'last_name', 'second_last_name', 'gender', 'birth_date', 'nationality', 'civil_status', 'education_level'],
  },
  {
    title: 'Lugar de nacimiento',
    icon: 'bi-geo-alt',
    keys: ['birth_country', 'birth_department', 'birth_city'],
  },
  {
    title: 'Documento de identidad',
    icon: 'bi-card-heading',
    keys: [
      'document_type',
      'document_number',
      'document_issuance_date',
      'document_issuance_country',
      'document_issuance_department',
      'document_issuance_city',
    ],
  },
  { title: 'Contacto', icon: 'bi-telephone', keys: ['email', 'phone_ext', 'phone_number'] },
  {
    title: 'Perfil financiero',
    icon: 'bi-cash-stack',
    keys: ['monthly_income', 'monthly_expenses', 'total_assets', 'total_liabilities', 'is_tax_declarant', 'is_pep'],
  },
];

const MONEY_KEYS = new Set(['monthly_income', 'monthly_expenses', 'total_assets', 'total_liabilities']);
const BOOL_KEYS = new Set(['is_tax_declarant', 'is_pep']);
const NAME_KEYS = new Set(['name', 'second_name', 'last_name', 'second_last_name']);
const CATALOG_LABEL: Record<string, Record<string, string>> = {
  gender: GENDER_LABEL,
  civil_status: CIVIL_STATUS_LABEL,
  education_level: EDUCATION_LEVEL_LABEL,
  document_type: DOCUMENT_TYPE_LABEL,
};

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/** Turns a catalogue key (`BOGOTA_DC`, `SINGLE`) into something readable. */
function humanize(value: string): string {
  const t = value.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function formatFormValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (NAME_KEYS.has(key)) return titleCase(String(value));
  if (BOOL_KEYS.has(key)) return value === true || value === 'true' ? 'Sí' : 'No';
  if (MONEY_KEYS.has(key)) {
    const n = Number(value);
    return Number.isFinite(n) ? money.format(n) : String(value);
  }
  if (key === 'phone_ext') return `+${String(value).replace(/^\+/, '')}`;
  const catalog = CATALOG_LABEL[key];
  if (catalog) return catalog[String(value)] ?? String(value);
  if (key.endsWith('_at')) return formatDateTime(String(value));
  if (key.endsWith('_date')) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
  }
  if (key === 'nationality' || /_(country|department|city)$/.test(key)) {
    return humanize(String(value));
  }
  return String(value);
}

/** Backend timestamps look like `2026-11-09 02:34:21+00:00` (space instead of T). */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const time = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });

/** `9 nov 2026`: short and unambiguous (no 9/11 vs 11/9). */
function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? `${shortDate(d)}, ${time.format(d)}` : '—';
}

export function formatDate(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? shortDate(d) : '—';
}

export function initials(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
