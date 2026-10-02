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
});
