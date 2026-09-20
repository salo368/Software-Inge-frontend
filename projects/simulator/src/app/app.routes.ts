import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/simulator.component').then((m) => m.SimulatorComponent),
  },
  {
    // Public docs section. Hidden: not linked from the UI.
    path: 'docs',
    loadChildren: () => import('./pages/docs/docs.routes').then((m) => m.DOCS_ROUTES),
  },
  { path: '**', redirectTo: '' },
];
