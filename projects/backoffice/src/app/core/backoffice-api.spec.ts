import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BackofficeApi } from './backoffice-api.service';
import { formatFormValue, initials, isStage, parseDate } from './labels';

function setup() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { api: TestBed.inject(BackofficeApi), ctrl: TestBed.inject(HttpTestingController) };
}

const PAGE = { results: [], count: 0, pagination: { offset: 0, limit: 20, total: 0 } };

describe('BackofficeApi', () => {
  it('listProcesses manda solo los filtros con valor', () => {
    const { api, ctrl } = setup();

    api.listProcesses({ search: ' ana gomez ', bankId: 4, stages: ['PAYMENT', 'REVIEW'], page: 2 }).subscribe();
    const req = ctrl.expectOne((r) => r.url.endsWith('/processes/get-processes-list'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ page: 2, page_size: 20, search: 'ana gomez', bank_id: 4, stages: ['PAYMENT', 'REVIEW'] });
    req.flush(PAGE);

    api.listProcesses({ search: '  ', bankId: null, stages: [] }).subscribe();
    const empty = ctrl.expectOne((r) => r.url.endsWith('/processes/get-processes-list'));
    expect(empty.request.body).toEqual({ page: 1, page_size: 20 });
    empty.flush(PAGE);
    ctrl.verify();
  });

  it('countProcesses pide una sola fila y devuelve el total', () => {
    const { api, ctrl } = setup();
    let total = -1;

    api.countProcesses(['REVIEW']).subscribe((n) => (total = n));
    const req = ctrl.expectOne((r) => r.url.endsWith('/processes/get-processes-list'));
    expect(req.request.body).toEqual({ page: 1, page_size: 1, stages: ['REVIEW'] });
    req.flush({ ...PAGE, pagination: { offset: 0, limit: 1, total: 7 } });

    expect(total).toBe(7);
  });

  it('listUsers busca por texto y pagina; getUser y userProcesses usan el id', () => {
    const { api, ctrl } = setup();

    api.listUsers(' ana ', 3).subscribe();
    const list = ctrl.expectOne((r) => r.url.endsWith('/auth/get-user-list'));
    expect(list.request.body).toEqual({ search: 'ana', page: 3, page_size: 20 });
    list.flush(PAGE);

    api.getUser('u-1').subscribe();
    ctrl.expectOne((r) => r.url.endsWith('/auth/get-user') && r.params.get('user_id') === 'u-1').flush({ user: {} });

    api.userProcesses('u-1').subscribe();
    ctrl.expectOne((r) => r.url.endsWith('/processes/get-processes') && r.params.get('user_id') === 'u-1').flush({ processes: [] });
    ctrl.verify();
  });

  it('el catálogo público de bancos se carga una vez y se ordena por nombre', () => {
    const { api, ctrl } = setup();
    const bank = (id: number, name: string) => ({ id, code: 'x', name, logo_url: '', description: '', tier: 'AAA', rating_by: '', highlights: [] });

    api.loadBanks();
    api.loadBanks();
    ctrl.expectOne((r) => r.url.endsWith('/banks/get-banks')).flush({ banks: [bank(2, 'Pibank'), bank(1, 'Bancolombia')] });

    expect(api.banks().map((b) => b.name)).toEqual(['Bancolombia', 'Pibank']);
    expect(api.bankName(2)).toBe('Pibank');
    expect(api.bankName(99)).toBe('Banco #99');
    ctrl.verify();
  });
});

describe('labels', () => {
  it('formatFormValue traduce catálogos, montos, booleanos, fechas e indicativo', () => {
    expect(formatFormValue('civil_status', 'SINGLE')).toBe('Soltero(a)');
    expect(formatFormValue('education_level', 'PROFESSIONAL')).toBe('Profesional');
    expect(formatFormValue('gender', 'F')).toBe('Femenino');
    expect(formatFormValue('document_type', 'CC')).toBe('Cedula de ciudadania');
    expect(formatFormValue('birth_date', '1999-11-02')).toBe('02/11/1999');
    expect(formatFormValue('phone_ext', '57')).toBe('+57');
    expect(formatFormValue('is_pep', false)).toBe('No');
    expect(formatFormValue('is_tax_declarant', true)).toBe('Sí');
    expect(formatFormValue('monthly_income', 8000000)).toContain('8.000.000');
    expect(formatFormValue('birth_city', 'BOGOTA_DC')).toBe('Bogota dc');
    expect(formatFormValue('second_name', null)).toBe('—');
  });

  it('parseDate entiende el formato del backend (con espacio) y initials/isStage son seguros', () => {
    expect(parseDate('2026-11-09 02:34:21+00:00')?.toISOString()).toBe('2026-11-09T02:34:21.000Z');
    expect(parseDate('nope')).toBeNull();
    expect(initials('Ana María Gómez')).toBe('AG');
    expect(initials(null)).toBe('?');
    expect(isStage('REVIEW')).toBeTrue();
    expect(isStage('review')).toBeFalse();
  });
});
