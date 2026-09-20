import { Component } from '@angular/core';

@Component({
  selector: 'app-missing-token',
  standalone: true,
  template: `
    <div class="container-sm py-5 text-center" style="max-width: 32rem">
      <i class="bi bi-link-45deg display-4 text-body-secondary"></i>
      <h1 class="h4 mt-3">Enlace incompleto</h1>
      <p class="text-body-secondary">
        Abre la firma desde el enlace que te enviamos por correo. Ese enlace incluye el
        codigo que identifica el documento.
      </p>
    </div>
  `,
})
export class MissingTokenComponent {}
