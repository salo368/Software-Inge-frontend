import { Router } from '@angular/router';

import { PENDING_CDT_KEY, parsePendingCdt } from './pending-cdt';
import { ProcessesService } from './processes.service';

/**
 * Called after a successful login/register. If the user had a pending CDT
 * intent (clicked "Abrir este CDT" while logged out), materialize the process
 * now and route to the wizard. Otherwise land on the dashboard.
 */
export function completePostAuthRedirect(
  router: Router,
  processesApi: ProcessesService,
): void {
  const intent = parsePendingCdt(localStorage.getItem(PENDING_CDT_KEY));
  localStorage.removeItem(PENDING_CDT_KEY);
  if (!intent) {
    router.navigate(['/me']);
    return;
  }
  processesApi.create(intent).subscribe({
    next: (p) => router.navigate(['/process', p.id]),
    error: () => router.navigate(['/me']),
  });
}
