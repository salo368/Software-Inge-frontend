import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AdminAuthService } from './admin-auth.service';

export const requireAdmin: CanActivateFn = () => {
  const auth = inject(AdminAuthService);
  return auth.isAuthenticated() ? true : inject(Router).createUrlTree(['/login']);
};

export const requireGuest: CanActivateFn = () => {
  const auth = inject(AdminAuthService);
  return auth.isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
};
