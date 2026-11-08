import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BanksService } from './banks.service';

describe('BanksService', () => {
  let service: BanksService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BanksService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista los bancos con GET /banks/get-banks', () => {
    service.listBanks().subscribe((r) => expect(r.banks.length).toBe(1));
    const req = http.expectOne((r) => r.url.endsWith('/banks/get-banks'));
    expect(req.request.method).toBe('GET');
    req.flush({ banks: [{ id: 1, code: 'x', name: 'X', logo_url: '', description: '', tier: 'AAA', rating_by: '', highlights: [] }] });
  });

  it('simula con GET y query params, y convierte el objeto `banks` en filas con id', (done) => {
    service.simulate(1_000_000, 180).subscribe((r) => {
      expect(r.term).toBe(180);
      // JSON.parse itera las keys numéricas en orden ascendente (8, 12):
      // el servicio reordena por tasa, mejor primero.
      expect(r.results.map((x) => x.bank.id)).toEqual([12, 8]);
      expect(r.results[0]).toEqual({
        bank: {
          id: 12,
          code: 'nu',
          name: 'Nu Colombia',
          logo_url: 'nu.png',
          description: 'd',
          tier: 'AA',
          rating_by: 'Fitch Ratings',
          highlights: ['h'],
        },
        rate: 12.3,
        interest: 58875.28,
        final: 1058875.28,
      });
      done();
    });

    const req = http.expectOne((r) => r.url.endsWith('/banks/simulate'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('amount')).toBe('1000000');
    expect(req.request.params.get('term')).toBe('180');
    req.flush({
      amount: 1000000.0,
      term: 180,
      banks: {
        '12': {
          code: 'nu',
          name: 'Nu Colombia',
          logo_url: 'nu.png',
          description: 'd',
          tier: 'AA',
          rating_by: 'Fitch Ratings',
          highlights: ['h'],
          rate: 12.3,
          interest: 58875.28,
          final: 1058875.28,
        },
        '8': {
          code: 'pichincha',
          name: 'Banco Pichincha',
          logo_url: 'p.png',
          description: 'd',
          tier: 'AA+',
          rating_by: 'BRC Ratings',
          highlights: [],
          rate: 12.2,
          interest: 58410.19,
          final: 1058410.19,
        },
      },
    });
  });

  it('devuelve una lista vacía cuando ningún banco cubre el monto y plazo', (done) => {
    service.simulate(1, 1).subscribe((r) => {
      expect(r.results).toEqual([]);
      done();
    });
    http.expectOne((r) => r.url.endsWith('/banks/simulate')).flush({ amount: 1, term: 1, banks: {} });
  });
});
