import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ColombianCatalog, FormsService, cityOptions, fromApiDate, toOptions } from './forms.service';

const CATALOG: ColombianCatalog = {
  CUNDINAMARCA: {
    label: 'Cundinamarca',
    cities: {
      BOGOTA_DC: {
        label: 'Bogotá D.C.',
        localities: { USAQUEN: { label: 'Usaquén' }, SUBA: { label: 'Suba' } },
      },
      ZIPAQUIRA: { label: 'Zipaquirá' },
    },
  },
  ANTIOQUIA: { label: 'Antioquia', cities: { ABEJORRAL: { label: 'Abejorral' } } },
};

describe('forms helpers', () => {
  it('fromApiDate convierte dd/mm/yyyy a yyyy-mm-dd', () => {
    expect(fromApiDate('01/05/1990')).toBe('1990-05-01');
    expect(fromApiDate('1990-05-01')).toBe('1990-05-01');
    expect(fromApiDate('2026-11-02 04:06:51+00:00')).toBe('2026-11-02');
    expect(fromApiDate('')).toBe('');
    expect(fromApiDate(null)).toBe('');
    expect(fromApiDate('basura')).toBe('');
  });

  it('toOptions ordena por etiqueta', () => {
    expect(toOptions(CATALOG).map((o) => o.key)).toEqual(['ANTIOQUIA', 'CUNDINAMARCA']);
    expect(toOptions(undefined)).toEqual([]);
  });

  it('cityOptions incluye localidades solo cuando se piden', () => {
    expect(cityOptions(CATALOG, 'CUNDINAMARCA').map((o) => o.key)).toEqual(['BOGOTA_DC', 'ZIPAQUIRA']);
    const withLocalities = cityOptions(CATALOG, 'CUNDINAMARCA', true);
    expect(withLocalities.map((o) => o.key)).toContain('USAQUEN');
    expect(withLocalities.find((o) => o.key === 'USAQUEN')?.label).toBe('Bogotá D.C. - Usaquén');
    expect(cityOptions(CATALOG, 'NO_EXISTE')).toEqual([]);
    expect(cityOptions(null, 'CUNDINAMARCA')).toEqual([]);
  });
});

describe('FormsService', () => {
  let service: FormsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FormsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lee el formulario con GET /forms/get-form (null si no existe)', (done) => {
    service.getMine().subscribe((r) => {
      expect(r.form).toBeNull();
      done();
    });
    const req = http.expectOne((r) => r.url.endsWith('/forms/get-form'));
    expect(req.request.method).toBe('GET');
    req.flush({ form: null });
  });

  it('guarda con PUT /forms/upsert-form', () => {
    service.upsertMine({ name: 'ana' } as never).subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/forms/upsert-form'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ name: 'ana' });
    req.flush({ form: {} });
  });

  it('pide cada catálogo una sola vez y lo comparte', () => {
    let calls = 0;
    service.colombianLocations().subscribe(() => calls++);
    service.colombianLocations().subscribe(() => calls++);
    const req = http.expectOne(
      (r) => r.url.endsWith('/forms/get-locations') && r.params.get('type') === 'colombian_locations',
    );
    req.flush({ data: CATALOG });
    service.colombianLocations().subscribe(() => calls++);
    expect(calls).toBe(3);

    service.countries().subscribe((c) => expect(c['COLOMBIA'].abbr).toBe('CO'));
    http
      .expectOne((r) => r.params.get('type') === 'countries')
      .flush({ data: { COLOMBIA: { label: 'Colombia', abbr: 'CO' } } });
  });
});
