/** Spanish copy for the `error` codes of `admin_auth` (docs/admin-auth-api.md). */
export function friendlyAdminError(code: string | undefined, status?: number): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Correo o contraseña incorrectos.';
    case 'missing_fields':
      return 'Escribe tu correo y tu contraseña.';
    case 'email_taken':
      return 'Ya existe un administrador con ese correo.';
    case 'invalid_email':
      return 'El correo no tiene un formato válido.';
    case 'password_too_short':
      return 'La contraseña debe tener al menos 10 caracteres.';
    case 'password_needs_letter':
      return 'La contraseña debe incluir al menos una letra.';
    case 'password_needs_digit':
      return 'La contraseña debe incluir al menos un número.';
    case 'invalid_or_expired_token':
    case 'missing_bearer_token':
      return 'Tu sesión terminó. Inicia sesión de nuevo.';
    default:
      return status === 0 || status === undefined
        ? 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.'
        : 'No pudimos completar la acción. Intenta de nuevo en unos segundos.';
  }
}
