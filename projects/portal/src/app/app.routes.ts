import { Routes } from '@angular/router';

import { requireAuth, requireGuest } from '@shared/core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [requireGuest],
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [requireGuest],
    loadComponent: () => import('./pages/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'me',
    canActivate: [requireAuth],
    loadComponent: () => import('./pages/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'process/:id',
    canActivate: [requireAuth],
    loadComponent: () => import('./pages/process.component').then((m) => m.ProcessComponent),
  },
  { path: '**', redirectTo: 'me' },
];
