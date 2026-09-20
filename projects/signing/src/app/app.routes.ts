import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    // Public on purpose: the token in the URL is the credential, so the link
    // works from the email on any device without a session.
    path: ':token',
    loadComponent: () => import('./pages/sign.component').then((m) => m.SignComponent),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/missing-token.component').then((m) => m.MissingTokenComponent),
  },
];
