/**
 * PR195-PORT (owner PR #195): the KEY financial snapshot revision.
 *
 * KEY's standing context (BusinessGraphService) caches a business's snapshot
 * for two minutes. A ledger posting, a payroll run moving, or a cash account
 * changing makes the treasury figures in that snapshot stale, so each of those
 * writers bumps the business's revision here after it commits, and the next
 * snapshot read whose cached revision is older assembles a fresh one.
 *
 * In-process only (one counter per business per server process): a write on
 * another instance is seen there once the two-minute cache expires, as before.
 *
 * The PR's version of this file also carried an exchange-rate cash model
 * (FinancialAccount.currentBalance moved by every posting, cash, bills, payroll
 * and deals converted into the business currency). It is not ported: on the
 * head cash is the ledger cash position (CashPositionService, V1-34) and an
 * amount in another currency is named apart, never converted (D-13, V1-37c).
 */

const businessSnapshotRevisions = new Map<string, number>();

/** Mark `businessId`'s cached financial snapshot stale. */
export function invalidateBusinessFinancialSnapshotCache(businessId: string): void {
  if (!businessId) return;
  businessSnapshotRevisions.set(businessId, (businessSnapshotRevisions.get(businessId) ?? 0) + 1);
}

/** The current revision of `businessId`'s financial snapshot (0 until a writer bumps it). */
export function getBusinessFinancialSnapshotRevision(businessId: string): number {
  return businessSnapshotRevisions.get(businessId) ?? 0;
}
