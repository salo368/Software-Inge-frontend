import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';

import { FilesService } from './files.service';
import { PaymentsService } from './payments.service';

/**
 * Both services upload straight to S3 with `fetch` (outside HttpClient, so
 * no bearer token leaks to S3) and must echo the signed headers verbatim.
 */
describe('subidas a S3 (files y payments)', () => {
  let http: HttpTestingController;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(() => http.verify());

  it('FilesService.upload pide la URL y hace PUT con upload_headers', fakeAsync(() => {
    fetchSpy.and.returnValue(Promise.resolve(new Response(null, { status: 200 })));
    const file = new File(['x'], 'cert.pdf', { type: 'application/pdf' });
    let key = '';
    TestBed.inject(FilesService)
      .upload('p-1', 'BANK_CERT', file)
      .subscribe((r) => (key = r.key));

    const req = http.expectOne((r) => r.url.endsWith('/files/upload-url'));
    expect(req.request.body).toEqual({
      process_id: 'p-1',
      file_type: 'BANK_CERT',
      content_type: 'application/pdf',
      original_name: 'cert.pdf',
    });
    const headers = {
      'Content-Type': 'application/pdf',
      'x-amz-meta-process-id': 'p-1',
      'x-amz-meta-file-type': 'BANK_CERT',
      'x-amz-meta-original-name': 'cert.pdf',
    };
    req.flush({
      upload_url: 'https://s3/put',
      key: 'processes/p-1/BANK_CERT/abc.pdf',
      content_type: 'application/pdf',
      upload_headers: headers,
      expires_in: 900,
    });
    flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://s3/put',
      jasmine.objectContaining({ method: 'PUT', headers, body: file }),
    );
    expect(key).toBe('processes/p-1/BANK_CERT/abc.pdf');
  }));

  it('FilesService.upload propaga el error si el PUT a S3 falla', fakeAsync(() => {
    fetchSpy.and.returnValue(Promise.resolve(new Response(null, { status: 403 })));
    let failed = false;
    TestBed.inject(FilesService)
      .upload('p-1', 'RUT', new File(['x'], 'rut.png', { type: 'image/png' }))
      .subscribe({ error: () => (failed = true) });
    http
      .expectOne((r) => r.url.endsWith('/files/upload-url'))
      .flush({ upload_url: 'u', key: 'k', content_type: 'image/png', upload_headers: {}, expires_in: 900 });
    flushMicrotasks();
    expect(failed).toBeTrue();
  }));

  it('PaymentsService.register sube el comprobante y registra el pago con su key', fakeAsync(() => {
    fetchSpy.and.returnValue(Promise.resolve(new Response(null, { status: 200 })));
    const receipt = new File(['x'], 'comprobante.png', { type: 'image/png' });
    let paymentId = '';
    TestBed.inject(PaymentsService)
      .register('p-1', 1_500_000, receipt)
      .subscribe((p) => (paymentId = p.id));

    const presign = http.expectOne((r) => r.url.endsWith('/payments/upload-url'));
    expect(presign.request.body).toEqual({ process_id: 'p-1', content_type: 'image/png' });
    presign.flush({
      upload_url: 'https://s3/pay',
      key: 'payments/p-1/abc.png',
      content_type: 'image/png',
      upload_headers: { 'Content-Type': 'image/png' },
      expires_in: 900,
    });
    flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://s3/pay',
      jasmine.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: receipt }),
    );

    const create = http.expectOne((r) => r.url.endsWith('/payments/create-payment'));
    expect(create.request.body).toEqual({
      process_id: 'p-1',
      s3_key: 'payments/p-1/abc.png',
      amount: '1500000',
    });
    create.flush({ id: 'pay-1', process_id: 'p-1', amount: 1.5e6, s3_file: 'payments/p-1/abc.png' });
    expect(paymentId).toBe('pay-1');
  }));
});
