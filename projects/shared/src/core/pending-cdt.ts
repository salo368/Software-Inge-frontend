/**
 * Handoff between the simulador and portal blocks. The simulador writes the
 * intent before sending a logged-out visitor to register; the portal picks it
 * up after authentication. localStorage is per origin and every block is
 * served from the same CloudFront domain, so the value crosses for free.
 *
 * The rate is not part of the intent: `create-process` resolves it again
 * server-side from `(bank_id, amount, term)`.
 */
export const PENDING_CDT_KEY = 'cdts_pending_open';

export interface PendingCdtIntent {
  bank_id: number;
  amount: number;
  /** Days. */
  term: number;
}

/**
 * Parses a stored intent. Accepts the pre-refactor shape (`term_days`) so a
 * visitor who clicked "Abrir este CDT" right before a deploy is not lost.
 */
export function parsePendingCdt(raw: string | null): PendingCdtIntent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingCdtIntent> & { term_days?: number };
    const term = v.term ?? v.term_days;
    if (typeof v.bank_id !== 'number' || typeof v.amount !== 'number' || typeof term !== 'number') {
      return null;
    }
    return { bank_id: v.bank_id, amount: v.amount, term };
  } catch {
    return null;
  }
}
