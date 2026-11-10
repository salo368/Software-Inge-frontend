import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';

import { SignaturesService } from './signatures.service';

const ID = '312e7c0b-ace6-44f0-bf09-7ae729a41f30';

describe('SignaturesService', () => {
  let service: SignaturesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SignaturesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lee la firma con GET get-signature?signature_id=', () => {
    service.get(ID).subscribe((s) => expect(s.stage).toBe('FORM'));
    const req = http.expectOne((r) => r.url.endsWith('/signatures/get-signature'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('signature_id')).toBe(ID);
    req.flush({ id: ID, stage: 'FORM', sign_location: [], doc_url: 'u', expires_at: 'x' });
  });

  it('registra el correo con set-signature-form', () => {
    service.setForm(ID, 'ana@example.com').subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/signatures/set-signature-form'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ signature_id: ID, email: 'ana@example.com' });
    req.flush({ id: ID, stage: 'BIOMETRICS', email: 'ana@example.com' });
  });

  it('sube una evidencia: presign + PUT con el mismo content type, y devuelve la key', fakeAsync(() => {
    const fetchSpy = spyOn(window, 'fetch').and.returnValue(Promise.resolve(new Response(null, { status: 200 })));
    const blob = new Blob(['img'], { type: 'image/png' });
    let key = '';
    service.uploadBiometric(ID, 'ID_FRONT', blob, 'image/png').subscribe((k) => (key = k));

    const req = http.expectOne((r) => r.url.endsWith('/signatures/upload-biometrics'));
    expect(req.request.body).toEqual({ signature_id: ID, biometric_type: 'ID_FRONT', content_type: 'image/png' });
    req.flush({
      upload_url: 'https://s3/put',
      key: `signatures/${ID}/id_front.png`,
      content_type: 'image/png',
      expires_in: 900,
    });
    flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://s3/put',
      jasmine.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: blob }),
    );
    expect(key).toBe(`signatures/${ID}/id_front.png`);
  }));

  it('valida con set-biometrics y consulta get-required-biometrics', () => {
    service.setBiometric(ID, 'FACE', 'k').subscribe((r) => expect(r.is_valid).toBeFalse());
    const set = http.expectOne((r) => r.url.endsWith('/signatures/set-biometrics'));
    expect(set.request.body).toEqual({ signature_id: ID, biometric_type: 'FACE', s3_key: 'k' });
    set.flush({ is_valid: false, reason: 'eyes_closed' });

    service.requiredBiometrics(ID).subscribe((r) => expect(r.ID_FRONT).toBeTrue());
    const req = http.expectOne((r) => r.url.endsWith('/signatures/get-required-biometrics'));
    expect(req.request.params.get('signature_id')).toBe(ID);
    req.flush({ ID_FRONT: true, ID_BACK: false, FACE: false });
  });

  it('manda el dibujo como bytes crudos (octet-stream) con signature_id en la query', () => {
    const png = new Blob([new Uint8Array(200)], { type: 'image/png' });
    service.setDraw(ID, png).subscribe((r) => expect(r.stage).toBe('OTP'));
    const req = http.expectOne((r) => r.url.endsWith('/signatures/set-signature-draw'));
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('signature_id')).toBe(ID);
    expect(req.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(req.request.body).toBe(png);
    req.flush({ id: ID, stage: 'OTP', draw_s3_key: `signatures/${ID}/draw.bin` });
  });

  it('pide y resuelve el OTP', () => {
    service.setOtp(ID).subscribe((r) => expect(r.email_sent).toBeTrue());
    const set = http.expectOne((r) => r.url.endsWith('/signatures/set-otp'));
    expect(set.request.body).toEqual({ signature_id: ID });
    set.flush({ id: ID, stage: 'OTP', email_sent: true, expires_at: '2026-11-08 06:54:52+00:00' });

    service.resolveOtp(ID, '496730').subscribe((r) => expect(r.stage).toBe('SIGNING'));
    const res = http.expectOne((r) => r.url.endsWith('/signatures/resolve-otp'));
    expect(res.request.body).toEqual({ signature_id: ID, code: '496730' });
    res.flush({ id: ID, stage: 'SIGNING' });
  });
});
