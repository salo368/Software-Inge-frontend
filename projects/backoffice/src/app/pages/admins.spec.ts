import { generatePassword, passwordChecks } from './admins.component';

describe('contraseña de administrador', () => {
  it('passwordChecks refleja las reglas del backend', () => {
    expect(passwordChecks('abc')).toEqual({ length: false, letter: true, digit: false });
    expect(passwordChecks('1234567890')).toEqual({ length: true, letter: false, digit: true });
    expect(passwordChecks('hunter22aa')).toEqual({ length: true, letter: true, digit: true });
    expect(passwordChecks('hunter-aaaa')).toEqual({ length: true, letter: true, digit: false });
  });

  it('generatePassword siempre cumple las reglas', () => {
    for (let i = 0; i < 200; i++) {
      const c = passwordChecks(generatePassword());
      expect(c.length && c.letter && c.digit).toBeTrue();
    }
  });
});
