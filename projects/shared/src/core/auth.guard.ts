import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';
import { blockUrl } from './blocks';

export const requireAuth: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

export const requireGuest: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.isAuthenticated()) return true;
  // The landing page lives in the simulator block, so this leaves the app.
  window.location.assign(blockUrl('simulator'));
  return false;
};
