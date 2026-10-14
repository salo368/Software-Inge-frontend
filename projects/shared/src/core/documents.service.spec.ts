import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DocumentsService } from './documents.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let httpMock: HttpTestingController;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [DocumentsService],
    });
    service = TestBed.inject(DocumentsService);
    httpMock = TestBed.inject(HttpTestingController);

    // `upload()` hace PUT directo a S3 vía `fetch` global, fuera de
    // Angular HttpClient (igual mecanismo que FilesService.upload()) --
    // se mockea aparte del HttpTestingController, que solo ve la llamada
    // POST a /documents/upload-url.
    fetchSpy = spyOn(window, 'fetch');
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('debería pedir una URL firmada y subir el archivo con PUT', (done) => {
    const file = new File(['contenido'], 'cedula.jpg', { type: 'image/jpeg' });
    fetchSpy.and.returnValue(Promise.resolve(new Response(null, { status: 200 })));

    service.upload('proceso-1', 'id_front', file).subscribe((result) => {
      expect(result.key).toContain('id_front');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://s3.example.com/presigned-put',
        jasmine.objectContaining({ method: 'PUT', body: file }),
      );
      done();
    });

    const req = httpMock.expectOne((r) => r.url.endsWith('/documents/upload-url'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(
      jasmine.objectContaining({ process_id: 'proceso-1', document_type: 'id_front' }),
    );
    req.flush({
      upload_url: 'https://s3.example.com/presigned-put',
      key: 'transactions/proceso-1/id_front/abc.jpg',
      content_type: 'image/jpeg',
    });
  });

  it('debería exponer el estado del expediente vía status()', (done) => {
    service.status('proceso-1').subscribe((result) => {
      expect(result.documentos[0].stage).toBe('validado');
      done();
    });

    const req = httpMock.expectOne(
      (r) => r.url.endsWith('/documents/status') && r.params.get('process_id') === 'proceso-1',
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      process_id: 'proceso-1',
      documentos: [
        {
          id: 'doc-1',
          document_type: 'id_front',
          stage: 'validado',
          rejection_reason: null,
          hash_sha256: 'a'.repeat(64),
          uploaded_at: '2026-10-01T00:00:00Z',
          validated_at: '2026-10-01T00:00:05Z',
        },
      ],
    });
  });

  it('debería propagar el error si el PUT a S3 falla', (done) => {
    const file = new File(['contenido'], 'cedula.jpg', { type: 'image/jpeg' });
    fetchSpy.and.returnValue(Promise.resolve(new Response(null, { status: 500 })));

    service.upload('proceso-1', 'id_front', file).subscribe({
      next: () => fail('no debería emitir un resultado exitoso'),
      error: (err) => {
        expect(err).toBeTruthy();
        done();
      },
    });

    const req = httpMock.expectOne((r) => r.url.endsWith('/documents/upload-url'));
    req.flush({
      upload_url: 'https://s3.example.com/presigned-put',
      key: 'transactions/proceso-1/id_front/abc.jpg',
      content_type: 'image/jpeg',
    });
  });

  it('debería indicar que hay un documento reutilizable (checkReuse)', (done) => {
    service.checkReuse('proceso-2', 'id_front').subscribe((result) => {
      expect(result.reutilizable).toBeTrue();
      expect(result.documento?.id).toBe('doc-anterior');
      done();
    });

    const req = httpMock.expectOne(
      (r) =>
        r.url.endsWith('/documents/check-reuse') &&
        r.params.get('process_id') === 'proceso-2' &&
        r.params.get('document_type') === 'id_front',
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      reutilizable: true,
      documento: {
        id: 'doc-anterior',
        document_type: 'id_front',
        validated_at: '2026-01-01T00:00:00Z',
        hash_sha256: 'a'.repeat(64),
      },
    });
  });

  it('debería indicar que no hay nada reutilizable cuando el backend responde false', (done) => {
    service.checkReuse('proceso-2', 'id_front').subscribe((result) => {
      expect(result.reutilizable).toBeFalse();
      expect(result.documento).toBeUndefined();
      done();
    });

    const req = httpMock.expectOne((r) => r.url.endsWith('/documents/check-reuse'));
    req.flush({ reutilizable: false });
  });

  it('debería confirmar la reutilización (confirmReuse)', (done) => {
    service.confirmReuse('proceso-2', 'id_front', 'doc-anterior').subscribe((result) => {
      expect(result.stage).toBe('validado');
      done();
    });

    const req = httpMock.expectOne((r) => r.url.endsWith('/documents/confirm-reuse'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      process_id: 'proceso-2',
      document_type: 'id_front',
      source_document_id: 'doc-anterior',
    });
    req.flush({
      id: 'doc-nuevo',
      document_type: 'id_front',
      stage: 'validado',
      rejection_reason: null,
      hash_sha256: 'a'.repeat(64),
      uploaded_at: '2026-10-03T00:00:00Z',
      validated_at: '2026-10-03T00:00:00Z',
    });
  });
});
