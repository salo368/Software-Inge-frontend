/**
 * Handoff between the simulador and portal blocks. The simulador writes the
 * intent before sending a logged-out visitor to register; the portal picks it
 * up after authentication. localStorage is per origin and every block is
 * served from the same CloudFront domain, so the value crosses for free.
 */
export const PENDING_CDT_KEY = 'cdts_pending_open';

export interface PendingCdtIntent {
  bank_id: number;
  amount: number;
  term_days: number;
  rate: number;
}
