import { Injectable, inject, signal } from '@angular/core';

import { ColombianCatalog, CountriesCatalog, FormsService } from '@shared/core/forms.service';

import { FORM_LABEL, FORM_SECTIONS, formatFormValue } from './labels';

export interface FormField {
  key: string;
  value: unknown;
}

export interface FormSection {
  title: string;
  icon: string;
  fields: FormField[];
}

/** Bookkeeping keys of `submitted_form`: shown as metadata, not as answers. */
const META_KEYS = new Set(['id', 'user_id', 'created_at', 'updated_at']);
const NUMERIC_KEYS = new Set(['document_number', 'phone_number', 'monthly_income', 'monthly_expenses', 'total_assets', 'total_liabilities']);

/**
 * How the backoffice shows an applicant's `submitted_form`: grouped like the
 * portal form, labels in Spanish, catalogue keys turned into names. Locations
 * come from the public catalogue (`GET /forms/get-locations`), so "QUINDIO"
 * reads "Quindío"; until it loads, a humanized key is shown.
 */
@Injectable({ providedIn: 'root' })
export class FormView {
  private formsApi = inject(FormsService);
  private loaded = false;
  private countries = signal<CountriesCatalog>({});
  private colombian = signal<ColombianCatalog>({});

  loadCatalogs(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.formsApi.countries().subscribe({ next: (c) => this.countries.set(c), error: () => (this.loaded = false) });
    this.formsApi.colombianLocations().subscribe({ next: (c) => this.colombian.set(c), error: () => (this.loaded = false) });
  }

  sections(form: Record<string, unknown> | null | undefined): FormSection[] {
    if (!form) return [];
    const known = new Set(FORM_SECTIONS.flatMap((s) => s.keys));
    const sections: FormSection[] = FORM_SECTIONS.map((s) => ({
      title: s.title,
      icon: s.icon,
      fields: s.keys.filter((k) => k in form).map((k) => ({ key: k, value: form[k] })),
    })).filter((s) => s.fields.length > 0);
    // Anything the backend adds later still shows up.
    const extra = Object.keys(form).filter((k) => !known.has(k) && !META_KEYS.has(k));
    if (extra.length) {
      sections.push({ title: 'Otros datos', icon: 'bi-three-dots', fields: extra.map((k) => ({ key: k, value: form[k] })) });
    }
    return sections;
  }

  label(key: string): string {
    return FORM_LABEL[key] ?? key.replace(/_/g, ' ');
  }

  isNumeric(key: string): boolean {
    return NUMERIC_KEYS.has(key);
  }

  /** Value for display; locations resolved against the public catalogue. */
  display(form: Record<string, unknown> | null | undefined, key: string, value: unknown): string {
    const raw = typeof value === 'string' ? value : null;
    if (raw) {
      if (key === 'nationality' || key.endsWith('_country')) {
        const label = this.countries()[raw]?.label;
        if (label) return label;
      }
      if (key.endsWith('_department')) {
        const label = this.colombian()[raw]?.label;
        if (label) return label;
      }
      if (key.endsWith('_city')) {
        const dep = this.colombian()[String(form?.[key.replace(/_city$/, '_department')] ?? '')];
        const city = dep?.cities[raw];
        if (city) return city.label;
        for (const c of Object.values(dep?.cities ?? {})) {
          const loc = c.localities?.[raw];
          if (loc) return `${c.label} - ${loc.label}`;
        }
      }
    }
    return formatFormValue(key, value);
  }
}
