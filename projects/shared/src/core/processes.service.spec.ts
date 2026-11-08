import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ProcessRow, ProcessesService, projectedInterest } from './processes.service';

const ROW: ProcessRow = {
  id: 'p-1',
  bank_id: 1,
  amount: 3_000_000,
  term: 365,
  rate: 11.4,
  stage: 'SIGNATURE',
  signature_id: 's-1',
  created_at: '2026-11-08 06:50:56+00:00',
};

describe('ProcessesService', () => {
  let service: ProcessesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProcessesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('crea el proceso sin mandar la tasa (la resuelve el backend)', () => {
    service.create({ bank_id: 1, amount: 1_000_000, term: 180 }).subscribe((p) => expect(p.stage).toBe('FORM'));
    const req = http.expectOne((r) => r.url.endsWith('/processes/create-process'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ bank_id: 1, amount: '1000000', term: 180 });
    req.flush({ id: 'p-1', bank_id: 1, amount: 1e6, term: 180, rate: 10.1, stage: 'FORM', created_at: 'x' });
  });

  it('get() busca el proceso en get-processes', (done) => {
    service.get('p-1').subscribe((p) => {
      expect(p?.signature_id).toBe('s-1');
      done();
    });
    const req = http.expectOne((r) => r.url.endsWith('/processes/get-processes'));
    expect(req.request.method).toBe('GET');
    req.flush({ processes: [{ ...ROW, id: 'otro' }, ROW] });
  });

  it('get() emite null cuando el proceso no es del usuario', (done) => {
    service.get('nope').subscribe((p) => {
      expect(p).toBeNull();
      done();
    });
    http.expectOne((r) => r.url.endsWith('/processes/get-processes')).flush({ processes: [ROW] });
  });

  it('setForm() manda el process_id a set-process-form', () => {
    service.setForm('p-1').subscribe((r) => expect(r.stage).toBe('DOCUMENTS'));
    const req = http.expectOne((r) => r.url.endsWith('/processes/set-process-form'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ process_id: 'p-1' });
    req.flush({ id: 'p-1', stage: 'DOCUMENTS', submitted_form: {} });
  });

  it('requiredFiles() y pendingPay() usan process_id como query param', () => {
    service.requiredFiles('p-1').subscribe((r) => expect(r.BANK_CERT).toBeTrue());
    const files = http.expectOne((r) => r.url.endsWith('/processes/get-required-files'));
    expect(files.request.params.get('process_id')).toBe('p-1');
    files.flush({ BANK_CERT: true, TAX_DECLARATION: false });

    service.pendingPay('p-1').subscribe((r) => expect(r.pending).toBe(1_500_000));
    const pay = http.expectOne((r) => r.url.endsWith('/processes/get-pending-pay'));
    expect(pay.request.params.get('process_id')).toBe('p-1');
    pay.flush({ process_id: 'p-1', amount: 3e6, paid: 1.5e6, pending: 1.5e6, stage: 'PAYMENT' });
  });
});

describe('projectedInterest', () => {
  it('capitaliza la tasa E.A. por la fracción de año del plazo', () => {
    expect(projectedInterest({ amount: 1_000_000, rate: 10, term: 365 })).toBe(100_000);
    expect(projectedInterest({ amount: 1_000_000, rate: 0, term: 180 })).toBe(0);
  });
});
