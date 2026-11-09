import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';

import { AuthService } from '@shared/core/auth.service';
import { ComboFieldComponent } from '@shared/components/combo-field.component';
import { DateFieldComponent } from '@shared/components/date-field.component';
import {
  DEFAULT_DIAL_COUNTRY,
  DialOption,
  buildDialOptions,
  countryForDial,
  dialOf,
} from '@shared/core/dial-codes';
import { isoYearsAgo, todayIso } from '@shared/core/date-input';
import { MoneyInputDirective } from '@shared/core/money-input.directive';
import {
  CIVIL_STATUS_LABEL,
  COLOMBIA,
  CivilStatus,
  ColombianCatalog,
  DOCUMENT_TYPE_LABEL,
  DocumentType,
  EDUCATION_LEVEL_LABEL,
  EducationLevel,
  FormsService,
  GENDER_LABEL,
  Gender,
  Option,
  UserForm,
  UserFormInput,
  cityOptions,
  fromApiDate,
  toOptions,
} from '@shared/core/forms.service';

/** Field labels, used to turn backend validation errors into readable copy. */
const FIELD_LABEL: Record<string, string> = {
  name: 'Primer nombre',
  second_name: 'Segundo nombre',
  last_name: 'Primer apellido',
  second_last_name: 'Segundo apellido',
  gender: 'Genero',
  birth_date: 'Fecha de nacimiento',
  birth_country: 'Pais de nacimiento',
  birth_department: 'Departamento de nacimiento',
  birth_city: 'Ciudad de nacimiento',
  nationality: 'Nacionalidad',
  email: 'Correo',
  document_type: 'Tipo de documento',
  document_number: 'Numero de documento',
  document_issuance_date: 'Fecha de expedicion',
  document_issuance_country: 'Pais de expedicion',
  document_issuance_department: 'Departamento de expedicion',
  document_issuance_city: 'Ciudad de expedicion',
  phone_ext: 'Indicativo',
  phone_number: 'Celular',
  civil_status: 'Estado civil',
  education_level: 'Nivel educativo',
  is_pep: 'PEP',
  monthly_income: 'Ingresos mensuales',
  monthly_expenses: 'Egresos mensuales',
  total_assets: 'Total activos',
  total_liabilities: 'Total pasivos',
  is_tax_declarant: 'Declarante de renta',
};

type FormKey = keyof ProcessFormComponent['form']['controls'];

function enumOptions<K extends string>(labels: Record<K, string>): { key: K; label: string }[] {
  return (Object.keys(labels) as K[]).map((key) => ({ key, label: labels[key] }));
}

/**
 * Identity/KYC form of the user (one per user, `forms` service). Emits
 * `saved` after a successful `upsert-form`; the parent is the one that
 * snapshots it into the process with `set-process-form`.
 */
@Component({
  selector: 'app-process-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MoneyInputDirective, DateFieldComponent, ComboFieldComponent],
  templateUrl: './process-form.component.html',
})
export class ProcessFormComponent implements OnInit {
  /** Label of the submit button (the parent reuses this form to edit). */
  @Input() submitLabel = 'Guardar y continuar';
  @Output() saved = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private api = inject(FormsService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  readonly DOCUMENT_TYPES = enumOptions<DocumentType>(DOCUMENT_TYPE_LABEL);
  readonly GENDERS = enumOptions<Gender>(GENDER_LABEL);
  readonly CIVIL_STATUSES = enumOptions<CivilStatus>(CIVIL_STATUS_LABEL);
  readonly EDUCATION_LEVELS = enumOptions<EducationLevel>(EDUCATION_LEVEL_LABEL);
  readonly COLOMBIA = COLOMBIA;
  /** Local calendar day: `toISOString()` is UTC, which is already tomorrow after 7 pm in Colombia. */
  readonly today = todayIso();
  readonly MIN_DATE = '1900-01-01';
  /** Listed first while nothing is typed in a country search. */
  readonly PINNED_COUNTRIES = [COLOMBIA];
  readonly DIAL_PINNED = [DEFAULT_DIAL_COUNTRY];
  /** The birth-date calendar opens around an adult age instead of this month. */
  readonly birthStartView = isoYearsAgo(30);

  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  prefilled = signal(false);

  countries = signal<Option[]>([]);
  /** Country + flag + dial code, built from the same catalog as `countries`. */
  dialOptions = signal<DialOption[]>([]);
  private colombia = signal<ColombianCatalog | null>(null);
  readonly departments = computed(() => toOptions(this.colombia() ?? {}));

  // Mirrors of the controls that drive the dependent selects.
  private birthCountry = signal(COLOMBIA);
  private birthDepartment = signal('');
  private issuanceCountry = signal(COLOMBIA);
  private issuanceDepartment = signal('');

  readonly birthInColombia = computed(() => this.birthCountry() === COLOMBIA);
  readonly issuedInColombia = computed(() => this.issuanceCountry() === COLOMBIA);
  readonly birthCities = computed(() => cityOptions(this.colombia(), this.birthDepartment()));
  readonly issuanceCities = computed(() =>
    cityOptions(this.colombia(), this.issuanceDepartment(), true),
  );

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
    second_name: [''],
    last_name: ['', [Validators.required]],
    second_last_name: [''],
    gender: ['' as Gender | '', [Validators.required]],
    birth_date: ['', [Validators.required]],
    birth_country: [COLOMBIA, [Validators.required]],
    birth_department: ['', [Validators.required]],
    birth_city: ['', [Validators.required]],
    nationality: [COLOMBIA, [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    document_type: ['CC' as DocumentType, [Validators.required]],
    document_number: ['', [Validators.required, Validators.pattern(/^\d+$/)]],
    document_issuance_date: ['', [Validators.required]],
    document_issuance_country: [COLOMBIA, [Validators.required]],
    document_issuance_department: ['', [Validators.required]],
    document_issuance_city: ['', [Validators.required]],
    // UI only: the dial code is shared between countries (+1, +7), so the control keeps
    // the country (unique) and `phone_ext` is derived from it when sending.
    phone_country: [DEFAULT_DIAL_COUNTRY, [Validators.required]],
    phone_number: ['', [Validators.required, Validators.pattern(/^\d{7,15}$/)]],
    civil_status: ['' as CivilStatus | '', [Validators.required]],
    education_level: ['' as EducationLevel | '', [Validators.required]],
    is_pep: [false],
    monthly_income: [0, [Validators.required, Validators.min(0)]],
    monthly_expenses: [0, [Validators.required, Validators.min(0)]],
    total_assets: [0, [Validators.required, Validators.min(0)]],
    total_liabilities: [0, [Validators.required, Validators.min(0)]],
    is_tax_declarant: [false],
  });

  ngOnInit(): void {
    this.wireDependentSelects();

    forkJoin({
      mine: this.api.getMine(),
      countries: this.api.countries(),
      colombia: this.api.colombianLocations(),
    }).subscribe({
      next: ({ mine, countries, colombia }) => {
        this.countries.set(toOptions(countries));
        this.dialOptions.set(buildDialOptions(countries));
        this.colombia.set(colombia);
        if (mine.form) {
          this.patchFromApi(mine.form);
          this.prefilled.set(true);
        } else {
          const email = this.auth.user()?.email;
          if (email) this.form.controls.email.setValue(email);
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No pudimos cargar el formulario. Recarga la pagina.');
        this.loading.set(false);
      },
    });
  }

  private wireDependentSelects(): void {
    const c = this.form.controls;
    const d = this.destroyRef;

    c.birth_country.valueChanges.pipe(takeUntilDestroyed(d)).subscribe((v) => {
      this.birthCountry.set(v);
      c.birth_department.setValue('');
      c.birth_city.setValue('');
    });
    c.birth_department.valueChanges.pipe(takeUntilDestroyed(d)).subscribe((v) => {
      this.birthDepartment.set(v);
      if (this.birthInColombia()) c.birth_city.setValue('');
    });
    c.document_issuance_country.valueChanges.pipe(takeUntilDestroyed(d)).subscribe((v) => {
      this.issuanceCountry.set(v);
      c.document_issuance_department.setValue('');
      c.document_issuance_city.setValue('');
    });
    c.document_issuance_department.valueChanges.pipe(takeUntilDestroyed(d)).subscribe((v) => {
      this.issuanceDepartment.set(v);
      if (this.issuedInColombia()) c.document_issuance_city.setValue('');
    });
  }

  /** Patch in dependency order so the cascading resets don't wipe children. */
  private patchFromApi(f: UserForm): void {
    const c = this.form.controls;
    c.birth_country.setValue(f.birth_country);
    c.birth_department.setValue(f.birth_department);
    c.birth_city.setValue(f.birth_city);
    c.document_issuance_country.setValue(f.document_issuance_country);
    c.document_issuance_department.setValue(f.document_issuance_department);
    c.document_issuance_city.setValue(f.document_issuance_city);
    this.form.patchValue(
      {
        name: f.name,
        second_name: f.second_name ?? '',
        last_name: f.last_name,
        second_last_name: f.second_last_name ?? '',
        gender: f.gender,
        birth_date: fromApiDate(f.birth_date),
        nationality: f.nationality,
        email: f.email,
        document_type: f.document_type,
        document_number: String(f.document_number),
        document_issuance_date: fromApiDate(f.document_issuance_date),
        phone_country: countryForDial(f.phone_ext),
        phone_number: f.phone_number,
        civil_status: f.civil_status,
        education_level: f.education_level,
        is_pep: f.is_pep,
        monthly_income: f.monthly_income,
        monthly_expenses: f.monthly_expenses,
        total_assets: f.total_assets,
        total_liabilities: f.total_liabilities,
        is_tax_declarant: f.is_tax_declarant,
      },
      { emitEvent: false },
    );
  }

  invalid(name: FormKey): boolean {
    const ctrl = this.form.controls[name];
    return ctrl.invalid && (ctrl.touched || ctrl.dirty);
  }

  submit(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      this.error.set('Revisa los campos marcados.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.upsertMine(this.toPayload()).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(friendlyFormError(err.error?.error));
      },
    });
  }

  private toPayload(): UserFormInput {
    const { phone_country, ...v } = this.form.getRawValue();
    const payload: UserFormInput = {
      ...v,
      phone_ext: dialOf(phone_country),
      name: v.name.trim(),
      last_name: v.last_name.trim(),
      gender: v.gender as Gender,
      civil_status: v.civil_status as CivilStatus,
      education_level: v.education_level as EducationLevel,
      birth_department: v.birth_department.trim(),
      birth_city: v.birth_city.trim(),
      document_issuance_department: v.document_issuance_department.trim(),
      document_issuance_city: v.document_issuance_city.trim(),
      document_number: v.document_number.trim(),
      email: v.email.trim(),
      monthly_income: Number(v.monthly_income),
      monthly_expenses: Number(v.monthly_expenses),
      total_assets: Number(v.total_assets),
      total_liabilities: Number(v.total_liabilities),
    };
    // Optional names: omit instead of sending an empty string, which the
    // backend rejects as "must be a non-empty string".
    if (!v.second_name.trim()) delete payload.second_name;
    else payload.second_name = v.second_name.trim();
    if (!v.second_last_name.trim()) delete payload.second_last_name;
    else payload.second_last_name = v.second_last_name.trim();
    return payload;
  }
}

/** Backend errors look like `"{field} is required"`, `"{field} must be ..."`. */
export function friendlyFormError(code: string | undefined): string {
  if (!code) return 'No pudimos guardar. Revisa tu conexion e intenta de nuevo.';
  const field = /^(\w+)/.exec(code)?.[1] ?? '';
  const label = FIELD_LABEL[field];
  if (!label) return 'No pudimos guardar. Revisa los campos.';
  if (code.includes('is required') || code.includes('non-empty')) return `${label}: es obligatorio.`;
  if (code.includes('valid date')) return `${label}: fecha invalida.`;
  if (code.includes('not a valid country')) return `${label}: pais no valido.`;
  if (code.includes('is not valid')) return `${label}: no corresponde a una ubicacion valida.`;
  if (code.includes('numeric')) return `${label}: solo numeros.`;
  if (code.includes('>= 0') || code.includes('a number')) return `${label}: debe ser un numero mayor o igual a 0.`;
  return `${label}: valor no valido.`;
}
