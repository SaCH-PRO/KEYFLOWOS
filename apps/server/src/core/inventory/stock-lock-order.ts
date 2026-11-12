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
 * W10-Z4-ROUTE-FIX review (Z4RV-CR-1): a transaction locks only the rows it
 * may write. Locking more (every warehouse's row of a product, written or
 * not) made a single-product cancel or receipt hold two rows of the product,
 * which a writer outside the rule (a transfer writing its from row, then its
 * to row) then met in the other order: 40P01, and the cancel or the receipt
 * was rolled back. The writers and what each locks:
 *
 *   - routing (FulfillmentRoutingService.routeOrder): every row of each
 *     line's product (lockStockRowsInOrder), since it reserves from the row
 *     with the most stock, chosen under the lock; its claim is run again once
 *     when it loses a deadlock anyway;
 *   - the paid door (StoreOrderService.completeCheckout): each tracked line's
 *     row in the default warehouse;
 *   - the fulfil cancel (cancelOrderFulfilment): the (product, warehouse) row
 *     each reserved route took from (lockStockRowPairsInOrder);
 *   - a purchase order received (advancePurchaseOrderStatus RECEIVED): each
 *     line's (product, warehouse) row;
 *   - a transfer (MarketplaceService.transferInventory): its from row and its
 *     to row;
 *   - a delivery note fulfilled, a goods receipt posted, a stock count
 *     adjusted (continental-ops): every row of each line's product, all of
 *     which their updateMany writes.
 *
 * Writers of one row in a transaction of their own (adjustInventory,
 * upsertInventory, the ship decrement) hold one stock row and wait for no
 * other. Not covered: a row that does not exist yet. A receipt or a transfer
 * creates the (product, warehouse) row it adds to when there is none, after
 * its locking statement; two of them creating the same two new rows in
 * opposite orders wait for each other's insert (the unique key), as before
 * this order existed.
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
 * locked by it.
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

/** A (product, warehouse) stock row a transaction writes. */
export interface StockRowKey {
  productId: string | null | undefined;
  warehouseId: string | null | undefined;
}

/**
 * W10-Z4-ROUTE-FIX review (Z4RV-CR-1): locks (FOR UPDATE) the business's
 * inventory_stocks rows of exactly these (product, warehouse) pairs, in id
 * order, on the caller's transaction; for a transaction that writes only
 * these rows (the fulfil cancel, a purchase order received, a transfer).
 * Returns the ids locked, in that order (none for no pairs). A pair with no
 * row locks nothing; a row created after the statement is not locked.
 */
export async function lockStockRowPairsInOrder(
  client: StockLockClient,
  businessId: string,
  keys: readonly StockRowKey[],
): Promise<string[]> {
  const pairs = new Map<string, { productId: string; warehouseId: string }>();
  for (const { productId, warehouseId } of keys) {
    if (productId && warehouseId) pairs.set(`${productId}\u0000${warehouseId}`, { productId, warehouseId });
  }
  if (pairs.size === 0) return [];
  const tuples = [...pairs.values()].map(({ productId, warehouseId }) => Prisma.sql`(${productId}, ${warehouseId})`);
  const rows = await (client as Pick<BusinessMetaTx, '$queryRaw'>).$queryRaw<Array<{ id: string }>>`
    SELECT id FROM inventory_stocks
     WHERE business_id = ${businessId} AND (product_id, warehouse_id) IN (${Prisma.join(tuples)})
     ORDER BY id
       FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * The options of an interactive transaction that waits for stock row locks
 * (a transfer): longer than Prisma's 5s default, as the routing claim's, so a
 * wait behind a routing or a receipt does not end it.
 */
export const STOCK_LOCK_TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

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
