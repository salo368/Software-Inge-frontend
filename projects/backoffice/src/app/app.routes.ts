import { Routes } from '@angular/router';

import { requireAdmin, requireGuest } from './core/admin-auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [requireGuest],
    loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [requireAdmin],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'procesos',
        loadComponent: () => import('./pages/processes.component').then((m) => m.ProcessesComponent),
      },
      {
        path: 'procesos/:id',
        loadComponent: () => import('./pages/process-detail.component').then((m) => m.ProcessDetailComponent),
      },
      {
        path: 'aprobaciones',
        loadComponent: () => import('./pages/approvals.component').then((m) => m.ApprovalsComponent),
      },
      {
        path: 'aprobaciones/:id',
        loadComponent: () => import('./pages/review.component').then((m) => m.ReviewComponent),
      },
      {
        path: 'inversionistas',
        loadComponent: () => import('./pages/users.component').then((m) => m.UsersComponent),
      },
      {
        path: 'inversionistas/:id',
        loadComponent: () => import('./pages/user-detail.component').then((m) => m.UserDetailComponent),
      },
      {
        path: 'admins',
        loadComponent: () => import('./pages/admins.component').then((m) => m.AdminsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
