import { resolveReturnUrl } from './host-app';
import { friendlyRejection } from '../pages/sign/sign-copy';

describe('resolveReturnUrl', () => {
  const here = { origin: 'https://d199n4241b95rg.cloudfront.net' };

  it('acepta una URL absoluta del mismo origen', () => {
    expect(resolveReturnUrl('https://d199n4241b95rg.cloudfront.net/portal/process/abc', here)).toBe(
      'https://d199n4241b95rg.cloudfront.net/portal/process/abc',
    );
  });

  it('rechaza ausentes, relativas, de otro origen o con esquemas peligrosos', () => {
    expect(resolveReturnUrl(null, here)).toBeNull();
    expect(resolveReturnUrl('/portal/process/abc', here)).toBeNull();
    expect(resolveReturnUrl('https://evil.example.com/steal', here)).toBeNull();
    expect(resolveReturnUrl('javascript:alert(1)', here)).toBeNull();
  });
});

describe('friendlyRejection', () => {
  it('explica cada motivo de rechazo de Rekognition', () => {
    expect(friendlyRejection('eyes_closed')).toContain('ojos');
    expect(friendlyRejection('multiple_faces')).toContain('una persona');
    expect(friendlyRejection('too_few_legible_lines')).toContain('leer');
    expect(friendlyRejection('no_id_number_detected')).toContain('numero');
    expect(friendlyRejection('lo-que-sea')).toContain('No pudimos validar');
  });
});
