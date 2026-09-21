import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    // Public on purpose: the sign_id in the URL is the credential, so
    // the link works from the email on any device without a session.
    // Optional `?return_url=` query param sends the signer back to the
    // portal after the ceremony completes. See core/host-app.ts.
    path: ':sign_id',
    loadComponent: () => import('./pages/sign.component').then((m) => m.SignComponent),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./pages/missing-token.component').then((m) => m.MissingTokenComponent),
  },
];
