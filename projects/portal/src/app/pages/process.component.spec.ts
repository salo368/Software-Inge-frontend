import { signatureCtaFor } from './process.component';
import { friendlyFormError } from './process/process-form.component';

describe('signatureCtaFor', () => {
  it('mapea cada stage de la firma a lo que muestra el portal', () => {
    expect(signatureCtaFor(null)).toBe('sign');
    expect(signatureCtaFor('FORM')).toBe('sign');
    expect(signatureCtaFor('BIOMETRICS')).toBe('resume');
    expect(signatureCtaFor('SIGNATURE')).toBe('resume');
    expect(signatureCtaFor('OTP')).toBe('resume');
    expect(signatureCtaFor('SIGNING')).toBe('processing');
    expect(signatureCtaFor('SIGNED')).toBe('signed');
    expect(signatureCtaFor('FAILED')).toBe('failed');
    expect(signatureCtaFor('EXPIRED')).toBe('failed');
  });
});

describe('friendlyFormError', () => {
  it('traduce los errores de validación de upsert-form con la etiqueta del campo', () => {
    expect(friendlyFormError('gender is required')).toBe('Genero: es obligatorio.');
    expect(friendlyFormError('birth_date must be a valid date (YYYY-MM-DD)')).toBe(
      'Fecha de nacimiento: fecha invalida.',
    );
    expect(friendlyFormError('nationality is not a valid country')).toBe('Nacionalidad: pais no valido.');
    expect(friendlyFormError('birth_city is not valid')).toBe(
      'Ciudad de nacimiento: no corresponde a una ubicacion valida.',
    );
    expect(friendlyFormError('document_number must be numeric')).toBe('Numero de documento: solo numeros.');
    expect(friendlyFormError('monthly_income must be >= 0')).toContain('Ingresos mensuales');
  });

  it('cae en un mensaje genérico con errores desconocidos o sin red', () => {
    expect(friendlyFormError(undefined)).toContain('conexion');
    expect(friendlyFormError('internal_server_error')).toBe('No pudimos guardar. Revisa los campos.');
  });
});
