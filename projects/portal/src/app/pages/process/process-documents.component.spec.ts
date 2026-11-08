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
});
