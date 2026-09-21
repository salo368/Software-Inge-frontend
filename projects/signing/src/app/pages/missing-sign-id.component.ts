import { Component } from '@angular/core';

/**
 * Rendered by the `**` fallback route when the URL doesn't include a
 * `:sign_id` param -- typically because someone typed `/` directly, or
 * because a copy-paste truncated the URL. NOT rendered for expired /
 * bad sign_ids: those hit sign.component.ts and get the tailored
 * 'expired' / 'notFound' screen with more actionable copy.
 *
 * Named after the backend v2 credential (`sign_id`) rather than the
 * legacy `token` term.
 */
@Component({
  selector: 'app-missing-sign-id',
  standalone: true,
  template: `
    <div class="container-sm py-5 text-center" style="max-width: 32rem">
      <i class="bi bi-link-45deg display-4 text-body-secondary"></i>
      <h1 class="h4 mt-3">Enlace incompleto</h1>
      <p class="text-body-secondary">
        Abre la firma desde el enlace que te enviamos por correo. Ese enlace
        incluye el codigo que identifica el documento.
      </p>
    </div>
  `,
})
export class MissingSignIdComponent {}
