import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';

import { environment } from '../environments/environment';

// ---------------------------------------------------------------------------
// Enums (mirror backend libs/orm/forms.py)
// ---------------------------------------------------------------------------

export type DocumentType = 'CC' | 'CE' | 'TI' | 'PA';
export type Gender = 'M' | 'F' | 'O';
export type CivilStatus = 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED';
export type EducationLevel =
  | 'NONE'
  | 'PRIMARY'
  | 'SECONDARY'
  | 'TECHNICAL'
  | 'TECHNOLOGICAL'
  | 'PROFESSIONAL'
  | 'POSTGRADUATE';

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  CC: 'Cedula de ciudadania',
  CE: 'Cedula de extranjeria',
  TI: 'Tarjeta de identidad',
  PA: 'Pasaporte',
};

export const GENDER_LABEL: Record<Gender, string> = {
  M: 'Masculino',
  F: 'Femenino',
  O: 'Otro',
};

export const CIVIL_STATUS_LABEL: Record<CivilStatus, string> = {
  SINGLE: 'Soltero(a)',
  MARRIED: 'Casado(a)',
  DIVORCED: 'Divorciado(a)',
  WIDOWED: 'Viudo(a)',
};

export const EDUCATION_LEVEL_LABEL: Record<EducationLevel, string> = {
  NONE: 'Ninguno',
  PRIMARY: 'Primaria',
  SECONDARY: 'Secundaria',
  TECHNICAL: 'Tecnico',
  TECHNOLOGICAL: 'Tecnologico',
  PROFESSIONAL: 'Profesional',
  POSTGRADUATE: 'Posgrado',
};

/** Country key the backend treats specially: its department/city must exist in the catalog. */
export const COLOMBIA = 'COLOMBIA';

// ---------------------------------------------------------------------------
// Form payloads
// ---------------------------------------------------------------------------

/**
 * Body of `PUT /forms/upsert-form`. Every field is required except
 * `second_name` and `second_last_name`. Dates go as `YYYY-MM-DD`.
 * See backend docs/forms-api.md §3.1.
 */
export interface UserFormInput {
  name: string;
  second_name?: string;
  last_name: string;
  second_last_name?: string;
  gender: Gender;
  birth_date: string;
  birth_country: string;
  birth_department: string;
  birth_city: string;
  nationality: string;
  email: string;
  document_type: DocumentType;
  document_number: string;
  document_issuance_date: string;
  document_issuance_country: string;
  document_issuance_department: string;
  document_issuance_city: string;
  phone_ext: string;
  phone_number: string;
  civil_status: CivilStatus;
  education_level: EducationLevel;
  is_pep: boolean;
  monthly_income: number;
  monthly_expenses: number;
  total_assets: number;
  total_liabilities: number;
  is_tax_declarant: boolean;
}

/**
 * What `GET /forms/get-form` returns. Same keys, but names come back in
 * UPPERCASE and both dates as `dd/mm/yyyy` (presentation formatting done by
 * the handler), plus `updated_at`.
 */
export interface UserForm extends Omit<UserFormInput, 'second_name' | 'second_last_name'> {
  second_name: string | null;
  second_last_name: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Location catalog (GET /forms/get-locations)
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  label: string;
}

export interface Country extends CatalogEntry {
  abbr: string;
}

export interface City extends CatalogEntry {
  /** Only a few cities (today, Bogota) carry localities. */
  localities?: Record<string, CatalogEntry>;
}

export interface Department extends CatalogEntry {
  cities: Record<string, City>;
}

export type CountriesCatalog = Record<string, Country>;
export type ColombianCatalog = Record<string, Department>;

/** `{key, label}` option for a `<select>`, sorted by label. */
export interface Option {
  key: string;
  label: string;
}

export function toOptions(catalog: Record<string, CatalogEntry> | undefined): Option[] {
  return Object.entries(catalog ?? {})
    .map(([key, v]) => ({ key, label: v.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

/**
 * Cities of a department. With `withLocalities`, a city that has localities
 * also contributes them as options ("Bogota D.C. - Usaquen"): the issuance
 * city of a cedula may be a locality instead of the municipality.
 */
export function cityOptions(
  catalog: ColombianCatalog | null,
  department: string,
  withLocalities = false,
): Option[] {
  const cities = catalog?.[department]?.cities ?? {};
  const out: Option[] = [];
  for (const [key, city] of Object.entries(cities)) {
    out.push({ key, label: city.label });
    if (withLocalities && city.localities) {
      for (const [lkey, loc] of Object.entries(city.localities)) {
        out.push({ key: lkey, label: `${city.label} - ${loc.label}` });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** `dd/mm/yyyy` (get-form output) -> `yyyy-mm-dd` (date input + upsert input). */
export function fromApiDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Already ISO (or ISO timestamp): keep the date part.
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return iso ? iso[1] : '';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class FormsService {
  private http = inject(HttpClient);
  private base = environment.formsApiUrl;

  // The catalog is static (the API answers with max-age=2h): fetch once per app.
  private countries$?: Observable<CountriesCatalog>;
  private colombian$?: Observable<ColombianCatalog>;

  /** `{form: null}` (200) when the user has not filled it yet. */
  getMine(): Observable<{ form: UserForm | null }> {
    return this.http.get<{ form: UserForm | null }>(`${this.base}/forms/get-form`);
  }

  upsertMine(payload: UserFormInput): Observable<{ form: UserForm }> {
    return this.http.put<{ form: UserForm }>(`${this.base}/forms/upsert-form`, payload);
  }

  countries(): Observable<CountriesCatalog> {
    this.countries$ ??= this.http
      .get<{ data: CountriesCatalog }>(`${this.base}/forms/get-locations`, {
        params: { type: 'countries' },
      })
      .pipe(
        map((r) => r.data),
        shareReplay(1),
      );
    return this.countries$;
  }

  colombianLocations(): Observable<ColombianCatalog> {
    this.colombian$ ??= this.http
      .get<{ data: ColombianCatalog }>(`${this.base}/forms/get-locations`, {
        params: { type: 'colombian_locations' },
      })
      .pipe(
        map((r) => r.data),
        shareReplay(1),
      );
    return this.colombian$;
  }
}
