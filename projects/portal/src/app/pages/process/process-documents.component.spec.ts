import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';

import { ProcessDocumentsComponent } from './process-documents.component';

describe('ProcessDocumentsComponent', () => {
  let fixture: ComponentFixture<ProcessDocumentsComponent>;
  let component: ProcessDocumentsComponent;
  let http: HttpTestingController;
  let completes: boolean[];

  const requiredFiles = () =>
    http.expectOne(
      (r) => r.url.endsWith('/processes/get-required-files') && r.params.get('process_id') === 'p-1',
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProcessDocumentsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProcessDocumentsComponent);
    component = fixture.componentInstance;
    component.processId = 'p-1';
    completes = [];
    component.completeChange.subscribe((c) => completes.push(c));
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('pinta solo los documentos que exige el backend, en orden fijo', () => {
    requiredFiles().flush({ TAX_DECLARATION: false, BANK_CERT: true });
    fixture.detectChanges();

    expect(component.rows().map((r) => r.type)).toEqual(['BANK_CERT', 'TAX_DECLARATION']);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#process-documents-row-bank-cert')?.getAttribute('data-uploaded')).toBe('true');
    expect(el.querySelector('#process-documents-input-tax-declaration')).not.toBeNull();
    expect(el.querySelector('#process-documents-row-rut')).toBeNull();
    expect(component.complete()).toBeFalse();
    expect(completes).toEqual([]);
  });

  it('emite completo cuando todos los requeridos ya estaban subidos', () => {
    requiredFiles().flush({ BANK_CERT: true });
    expect(component.complete()).toBeTrue();
    expect(completes).toEqual([true]);
  });

  it('tras subir, consulta get-required-files hasta que el documento queda registrado', fakeAsync(() => {
    const fetchSpy = spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(null, { status: 200 })));
    requiredFiles().flush({ BANK_CERT: false });

    component.upload('BANK_CERT', new File(['x'], 'cert.pdf', { type: 'application/pdf' }));
    expect(component.rows()[0].uploading).toBeTrue();

    http
      .expectOne((r) => r.url.endsWith('/files/upload-url'))
      .flush({ upload_url: 'https://s3/put', key: 'k', content_type: 'application/pdf', upload_headers: {}, expires_in: 900 });
    flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalled();

    // on_upload todavía no registra el archivo...
    tick(2000);
    requiredFiles().flush({ BANK_CERT: false });
    expect(component.rows()[0].uploading).toBeTrue();

    // ...y en el siguiente poll ya aparece.
    tick(2000);
    requiredFiles().flush({ BANK_CERT: true });
    expect(component.rows()[0].uploaded).toBeTrue();
    expect(component.rows()[0].uploading).toBeFalse();
    expect(component.rows()[0].fileName).toBe('cert.pdf');
    expect(completes).toEqual([true]);

    // El polling se detiene.
    tick(10_000);
  }));

  it('rechaza formatos no admitidos sin llamar al backend', () => {
    requiredFiles().flush({ BANK_CERT: false });
    component.upload('BANK_CERT', new File(['x'], 'doc.txt', { type: 'text/plain' }));
    expect(component.rows()[0].error).toContain('Formato no admitido');
    expect(component.rows()[0].uploading).toBeFalse();
  });

  it('sube varios documentos a la vez: cada uno es independiente y un solo polling los sigue', fakeAsync(() => {
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(null, { status: 200 })));
    requiredFiles().flush({ BANK_CERT: false, TAX_DECLARATION: false, RUT: false });

    component.upload('BANK_CERT', new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    component.upload('TAX_DECLARATION', new File(['x'], 'b.pdf', { type: 'application/pdf' }));
    component.upload('RUT', new File(['x'], 'c.pdf', { type: 'application/pdf' }));

    expect(component.rows().every((r) => r.uploading)).toBeTrue();

    const urls = http.match((r) => r.url.endsWith('/files/upload-url'));
    expect(urls.length).toBe(3);
    urls.forEach((u) =>
      u.flush({ upload_url: 'https://s3/put', key: 'k', content_type: 'application/pdf', upload_headers: {}, expires_in: 900 }),
    );
    flushMicrotasks();

    // Registran en momentos distintos; las demas siguen en curso.
    tick(2000);
    requiredFiles().flush({ BANK_CERT: true, TAX_DECLARATION: false, RUT: false });
    expect(component.rows().map((r) => r.uploading)).toEqual([false, true, true]);
    expect(component.complete()).toBeFalse();

    tick(2000);
    requiredFiles().flush({ BANK_CERT: true, TAX_DECLARATION: true, RUT: false });
    expect(component.rows().map((r) => r.uploading)).toEqual([false, false, true]);

    tick(2000);
    requiredFiles().flush({ BANK_CERT: true, TAX_DECLARATION: true, RUT: true });
    expect(component.complete()).toBeTrue();
    expect(completes).toEqual([true]);

    tick(10_000); // el polling se detiene
  }));

  it('un documento lento en llegar a S3 no se marca como fallido por el polling de otro', fakeAsync(() => {
    let finishSlow!: () => void;
    const slow = new Promise<Response>((res) => (finishSlow = () => res(new Response(null, { status: 200 }))));
    const fetchSpy = spyOn(window, 'fetch').and.returnValues(Promise.resolve(new Response(null, { status: 200 })), slow);
    requiredFiles().flush({ BANK_CERT: false, TAX_DECLARATION: false });

    component.upload('BANK_CERT', new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    component.upload('TAX_DECLARATION', new File(['x'], 'big.pdf', { type: 'application/pdf' }));
    http
      .match((r) => r.url.endsWith('/files/upload-url'))
      .forEach((u) =>
        u.flush({ upload_url: 'https://s3/put', key: 'k', content_type: 'application/pdf', upload_headers: {}, expires_in: 900 }),
      );
    flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // El primero se registra; el segundo sigue subiendo mucho mas alla del limite de registro.
    tick(2000);
    requiredFiles().flush({ BANK_CERT: true, TAX_DECLARATION: false });
    tick(120_000);

    const tax = component.rows()[1];
    expect(tax.uploading).toBeTrue();
    expect(tax.error).toBeNull();

    finishSlow();
    flushMicrotasks();
    tick(2000);
    requiredFiles().flush({ BANK_CERT: true, TAX_DECLARATION: true });
    expect(component.complete()).toBeTrue();
    tick(10_000);
  }));

  it('un archivo que llego a S3 pero no se registra falla solo ese documento', fakeAsync(() => {
    spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(null, { status: 200 })));
    requiredFiles().flush({ BANK_CERT: false, TAX_DECLARATION: false });

    component.upload('BANK_CERT', new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    http
      .expectOne((r) => r.url.endsWith('/files/upload-url'))
      .flush({ upload_url: 'https://s3/put', key: 'k', content_type: 'application/pdf', upload_headers: {}, expires_in: 900 });
    flushMicrotasks();

    for (let i = 0; i < 25; i++) {
      tick(2000);
      http.match((r) => r.url.endsWith('/processes/get-required-files')).forEach((r) =>
        r.flush({ BANK_CERT: false, TAX_DECLARATION: false }),
      );
    }

    const [bank, tax] = component.rows();
    expect(bank.uploading).toBeFalse();
    expect(bank.error).toContain('tarda en registrarse');
    expect(tax.error).toBeNull();
    tick(10_000);
  }));
});
