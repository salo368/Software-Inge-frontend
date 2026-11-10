/**
 * User-facing copy for the backend error codes and rejection reasons the
 * signing wizard surfaces (backend docs/signatures-api.md §4).
 */

/** `reason` of a rejected evidence (`set-biometrics` -> `is_valid: false`). */
export function friendlyRejection(reason: string): string {
  switch (reason) {
    case 'evidence_missing':
      return 'No recibimos la foto. Intentalo de nuevo.';
    case 'evidence_too_large':
      return 'La foto es demasiado pesada. Tomala de nuevo.';
    case 'too_few_legible_lines':
      return 'No logramos leer el documento. Tomalo con mas luz, sin reflejos y bien enfocado.';
    case 'no_id_number_detected':
      return 'No vemos el numero del documento. Asegurate de que se lea completo.';
    case 'no_face_detected':
      return 'No detectamos tu rostro. Acerca la camara.';
    case 'multiple_faces':
      return 'Solo debe aparecer una persona en la foto.';
    case 'low_confidence':
      return 'La foto no es lo bastante clara. Busca mejor luz.';
    case 'eyes_closed':
      return 'Abre bien los ojos y toma la foto nuevamente.';
    default:
      return 'No pudimos validar la foto. Tomala de nuevo con buena luz.';
  }
}

/** `set-signature-form` errors. */
export function friendlyFormError(code: string | undefined): string {
  return code === 'invalid_email'
    ? 'Ese correo no es valido. Revisalo.'
    : 'No pudimos guardar tu correo. Intenta de nuevo.';
}

/** `set-signature-draw` errors. */
export function friendlyDrawError(code: string | undefined): string {
  switch (code) {
    case 'draw_invalid_empty':
      return 'Tu firma esta vacia. Dibujala de nuevo.';
    case 'draw_invalid_too_large':
      return 'La imagen de tu firma es demasiado grande. Limpia y dibujala de nuevo.';
    default:
      return 'No pudimos guardar tu firma. Intenta de nuevo.';
  }
}
