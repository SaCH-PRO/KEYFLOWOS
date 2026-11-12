import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StockLockClient } from './stock-lock-order';

/**
 * W10-Z5-TRANSFER-FIX (review finding Z5SEC-2): whose products and warehouses
 * a stock writer may name, and what it answers when a stock row it would
 * create is held by another record.
 *
 * inventory_stocks keys each row by (product_id, warehouse_id), unique across
 * every business, and carries a business_id of its own. The purchase order
 * receipt once wrote the row of whatever (productId, warehouseId) a line named
 * (W10-Z4-ROUTE-FIX review Z4RV-SEC-1), so rows exist whose business_id is not
 * the business of their product or warehouse. A writer that reads its row by
 * (business, product, warehouse) does not see such a row; one that names
 * another business's product or warehouse can move stock out of it, or create
 * a row of its own business for another business's product (which then reads
 * as stock-tracked). So a stock writer checks first that every product and
 * warehouse it names is the business's (ownedProductsAndWarehouses), and a row
 * it creates where such a row already holds the pair is answered with a 409
 * that names no other record's ids (createStockRowOrConflict), not an
 * unhandled unique violation (a 500). Neither repairs nor deletes the row: an
 * operator does.
 */

/** A client the ownership is read on: PrismaService.client or an interactive transaction's. */
export type StockOwnershipClient = Pick<PrismaService['client'], '$queryRaw'> | StockLockClient;

/**
 * Which of `productIds` and `warehouseIds` are the business's, read with no
 * soft-delete or tenant filter (raw SQL, by the business's own id): a
 * soft-deleted product of the business counts. Ids that are not non-empty
 * strings are not looked up (and so are not the business's).
 */
export async function ownedProductsAndWarehouses(
  client: StockOwnershipClient,
  businessId: string,
  productIds: readonly unknown[],
  warehouseIds: readonly unknown[],
): Promise<{ products: Set<string>; warehouses: Set<string> }> {
  const ids = (values: readonly unknown[]) => [
    ...new Set(values.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ];
  const products = ids(productIds);
  const warehouses = ids(warehouseIds);
  const reader = client as Pick<PrismaService['client'], '$queryRaw'>;
  const [ownProducts, ownWarehouses] = await Promise.all([
    products.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : reader.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM products WHERE business_id = ${businessId} AND id IN (${Prisma.join(products)})`,
    warehouses.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : reader.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM warehouses WHERE business_id = ${businessId} AND id IN (${Prisma.join(warehouses)})`,
  ]);
  return {
    products: new Set(ownProducts.map((row) => row.id)),
    warehouses: new Set(ownWarehouses.map((row) => row.id)),
  };
}

/** The answer to a stock row create whose (product, warehouse) another record already holds. */
export const STOCK_ROW_HELD_ELSEWHERE =
  'A stock row for this product and warehouse is held by another record; ask an operator to repair it';

/** The (product, warehouse) pair of a stock row a writer creates. */
export interface StockRowPair {
  productId: string;
  warehouseId: string;
}

/**
 * W11-STOCK-ROW-RACE: the 409 a stock row create gets when its pair is held
 * (STOCK_ROW_HELD_ELSEWHERE, a ConflictException as before). It carries the
 * pair so retryOnOwnStockRowRace can read who holds it; the pair is never in
 * the message or the response body (a non-enumerable field, not part of
 * getResponse()), which names no ids (Z5SEC-2).
 */
export class StockRowHeldConflict extends ConflictException {
  declare readonly pair: StockRowPair;

  constructor(pair: StockRowPair) {
    super(STOCK_ROW_HELD_ELSEWHERE);
    Object.defineProperty(this, 'pair', { value: { productId: pair.productId, warehouseId: pair.warehouseId }, enumerable: false });
  }
}

/**
 * Runs the create of the stock row of `pair`. A unique violation (Prisma
 * P2002: the pair's row exists but was not read, as it carries another
 * business_id, or was committed by a concurrent writer after this transaction
 * read no row) is answered with a 409 naming no ids (StockRowHeldConflict);
 * any other error as it is. In an interactive transaction the 409 rolls the
 * transaction back, as the violation did.
 */
export async function createStockRowOrConflict<T>(pair: StockRowPair, create: () => Promise<T>): Promise<T> {
  try {
    return await create();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'P2002') throw new StockRowHeldConflict(pair);
    throw err;
  }
}

/**
 * W11-STOCK-ROW-RACE (D-137 keeps the 'ask an operator' 409 for planted rows
 * only): runs a stock writer's whole transaction (`run`), and once more when
 * it lost a stock row create to a row of its own business.
 *
 * A writer that creates a (product, warehouse) row that does not exist yet
 * takes no lock on it (lockStockRowPairsInOrder locks existing rows only), so
 * two writers of one business creating the same new pair at once (two
 * transfers into a warehouse, a transfer and a purchase order received) both
 * read no row and both insert: the second waits on the unique pair, then
 * fails on it once the first commits. That was answered 409 'held by another
 * record; ask an operator to repair it', though the row holding the pair was
 * the business's own and running the call again committed.
 *
 * So on a StockRowHeldConflict the pair's holder is read on `client`
 * (PrismaService.client, raw SQL by the pair alone, outside the transaction
 * that rolled back): when the row is this business's, or no longer exists,
 * `run` is run once more (its reads under the stock locks then see the row,
 * and it adds to it); when another business_id holds it (a row planted by the
 * old cross-business receipt, D-137) the 409 stands, unchanged. One retry
 * only: a second StockRowHeldConflict is answered as it is. No other error is
 * retried. The run again repeats every read and check of the transaction (a
 * purchase order receipt's status compare-and-set, W11-PO-RECEIPT-CLAIM, so a
 * retried receipt never receives twice), and takes its stock locks in the
 * global order as the first run did (stock-lock-order.ts).
 */
export async function retryOnOwnStockRowRace<T>(
  client: Pick<PrismaService['client'], '$queryRaw'>,
  businessId: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof StockRowHeldConflict)) throw err;
    const holders = await client.$queryRaw<Array<{ business_id: string | null }>>`
      SELECT business_id FROM inventory_stocks WHERE product_id = ${err.pair.productId} AND warehouse_id = ${err.pair.warehouseId}`;
    if (holders.some((row) => row.business_id !== businessId)) throw err;
    return run();
  }
}
