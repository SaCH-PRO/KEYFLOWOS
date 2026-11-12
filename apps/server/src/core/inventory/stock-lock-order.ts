import { Prisma } from '@prisma/client';
import type { BusinessMetaTx } from '../prisma/business-meta';

/**
 * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-1; owner ruling D-112): one order in
 * which every transaction that writes several inventory_stocks rows takes
 * their row locks.
 *
 * A row lock taken by an UPDATE is held to commit. Fulfilment routing
 * (FulfillmentRoutingService.routeOrder) reserves each line's stock in one
 * transaction, the paid door (StoreOrderService.completeCheckout) decrements
 * each tracked line's stock in one transaction, and a purchase order received
 * (advancePurchaseOrderStatus RECEIVED) adds to each line's stock in one
 * transaction, each in its own line order. Two of them naming the same
 * products in opposite order each held one row and waited for the other's
 * (Postgres 40P01): one aborted, and a provider-paid storefront order was left
 * unrouted with store_order.routing_failed raised, or the customer's
 * settlement or the receipt was rolled back.
 *
 * The rule: such a transaction takes ALL the stock row locks it can need in
 * one statement, first (after the routing claim, an advisory lock, where it
 * takes one), in id order, and only then reads and writes those rows; it locks
 * no stock row afterwards. Any two transactions that follow it take their
 * shared rows in the same order, so neither can hold a row the other already
 * waits behind: no cycle through stock rows, and no cycle through the rows
 * written after them (the order row, its routes, a purchase order), since
 * those are taken only once every stock lock is held. A reader that locks
 * first also reads each row's newest committed quantity and reservation (READ
 * COMMITTED: the read after the lock is a new snapshot), so a read-modify-write
 * of `reserved` or `quantity` under it loses no concurrent write.
 *
 * Postgres locks the rows of SELECT ... ORDER BY ... FOR UPDATE as the sorted
 * rows are returned (the LockRows step runs above the sort), so the locks are
 * taken in id order. Ids never change, so the order is the same for every
 * transaction.
 */

/** The client a lock is taken on: an interactive transaction's (BusinessMetaTx or its Prisma.TransactionClient view). */
export type StockLockClient = Pick<BusinessMetaTx, '$queryRaw'> | Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * Locks (FOR UPDATE) every inventory_stocks row of `productIds` in the
 * business, in every warehouse or, with `warehouseId`, in that warehouse
 * only, in id order, on the caller's transaction. Returns the ids locked, in
 * that order (none for no products). A row created after the statement is not
 * locked, so a caller writes only the rows returned.
 */
export async function lockStockRowsInOrder(
  client: StockLockClient,
  businessId: string,
  productIds: readonly (string | null | undefined)[],
  warehouseId?: string | null,
): Promise<string[]> {
  const ids = [...new Set(productIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return [];
  const inWarehouse = warehouseId ? Prisma.sql`AND warehouse_id = ${warehouseId}` : Prisma.empty;
  const rows = await (client as Pick<BusinessMetaTx, '$queryRaw'>).$queryRaw<Array<{ id: string }>>`
    SELECT id FROM inventory_stocks
     WHERE business_id = ${businessId} AND product_id IN (${Prisma.join(ids)}) ${inWarehouse}
     ORDER BY id
       FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * A transaction lost to a deadlock or a serialization failure, which running
 * it again can get past: Prisma's P2034 ("write conflict or deadlock"), or
 * SQLSTATE 40P01 (deadlock_detected) / 40001 (serialization_failure). With the
 * driver adapter (@prisma/adapter-pg) a deadlock on a model query arrives as a
 * PrismaClientUnknownRequestError with no code, its message naming the
 * PostgresError's code ("40P01", "deadlock detected"), and a raw query's as
 * P2010 "Raw query failed. Code: `40P01`", so the code, the meta and the
 * message are all read.
 */
export function isLostTransactionConflict(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { code?: unknown } | null; message?: unknown } | null;
  if (!e) return false;
  const codes = new Set(['P2034', '40P01', '40001']);
  if (typeof e.code === 'string' && codes.has(e.code)) return true;
  if (typeof e.meta?.code === 'string' && codes.has(e.meta.code)) return true;
  const message = typeof e.message === 'string' ? e.message : '';
  return /\bcode: \\?"(40P01|40001)\\?"|Code: `(40P01|40001)`|deadlock detected|could not serialize access/.test(message);
}
