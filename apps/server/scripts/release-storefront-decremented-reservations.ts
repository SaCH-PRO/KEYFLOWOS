#!/usr/bin/env tsx
/**
 * Release stuck stock reservations held on storefront order lines whose stock
 * was already decremented at checkout.
 *
 * WHY THIS EXISTS (F-36; owner ruling D-137; packet W11-STOREFRONT-ROUTE-DECREMENTED)
 *
 * Before W11-STOREFRONT-ROUTE-DECREMENTED, StoreOrderService.completeCheckout
 * decremented tracked stock at payment (writing a StockMovement with
 * type = 'sale', reference_id = order_number, quantity_change < 0), and then
 * StoreOrderRoutingListener -> FulfillmentRoutingService.routeLocalStock
 * reserved the same quantity again (inventory_stocks.reserved += quantity) on
 * a LOCAL_STOCK route without noReservationRequired. Storefront status edits
 * (SHIPPED, DELIVERED, COMPLETED) never released that reservation, leaving
 * available stock permanently understated by the order quantity.
 *
 * W11-STOREFRONT-ROUTE-DECREMENTED stops new orders from taking that duplicate
 * reservation (and prevents DROPSHIP/PREORDER lines already taken from local
 * stock at checkout from raising a PO or preorder, D-136). This script releases
 * reservations already held on legacy storefront routes:
 *
 *   - Eligible routes: LOCAL_STOCK routes in status RESERVED or PICKING_PACKING
 *     with a non-null warehouse_id, positive order-item quantity, neither
 *     noReservationRequired nor stockDecrementedAtCheckout set, not marked
 *     untracked/virtual, whose order has a matching checkout 'sale' movement
 *     (same business_id, reference_id = order_number, product_id, quantity_change < 0).
 *   - On --apply (one atomic transaction following the server's lock hierarchy):
 *     1. Acquire each candidate order's routing advisory lock
 *        (pg_advisory_xact_lock(hashtext('marketplace-order-routing:' || business_id || ':' || order_id)))
 *        in ascending lock-key order so concurrent routeOrder / shipOrderFulfilment /
 *        releaseOrderFulfilmentForCancel transactions serialize cleanly without
 *        double-releasing or deadlocking.
 *     2. Under those held routing claims, re-read the exact eligible route IDs
 *        (excluding any order just cancelled or shipped while waiting) and lock
 *        their inventory_stocks rows in global ORDER BY id ASC order (matching
 *        core/inventory/stock-lock-order.ts).
 *     3. Atomically stamp those exact fulfillment_routes rows' metadata (normalizing
 *        SQL NULL / JSON null / non-object JSONB to '{}' before merging) with
 *        noReservationRequired: true, stockDecrementedAtCheckout: true,
 *        inventoryMode: 'tracked', and d137ReservationReleasedAt (keeping the
 *        route's existing status), so future cancels/ships/re-runs never
 *        release the same reservation twice.
 *     4. Decrement inventory_stocks.reserved = GREATEST(0, reserved - qty) on the
 *        locked stock rows for the routes transitioned in step 3.
 *
 * SAFETY
 *
 * Dry run by default: counts and writes nothing unless --apply is passed.
 * --business=<id> (repeatable) restricts a run to those businesses. Prints
 * COUNTS ONLY (never a business id, order number, route id, product id, or
 * DATABASE_URL), and on error prints only the error's class and code.
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm cleanup:storefront-reservations                     # dry run: counts only
 *   pnpm cleanup:storefront-reservations --business=<id>     # dry run for one business
 *   pnpm cleanup:storefront-reservations --apply             # release reservations
 *
 * Exit status: 0 done, 1 the database read or update failed, 2 bad arguments.
 * Runbook: docs/development/operator-data-cleanup-scripts.md.
 */
import { db } from '@keyflow/db';

const ROUTING_LOCK_NAMESPACE = 'marketplace-order-routing:';

type RawDb = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;
type Db = RawDb & {
  $transaction: <T>(fn: (tx: RawDb) => Promise<T>, options?: { timeout?: number }) => Promise<T>;
};

export interface StorefrontReservationCounts {
  /** Legacy storefront routes currently holding a duplicate reservation. */
  routesAffected: number;
  /** Total item units reserved across those routes. */
  unitsToRelease: number;
  /** Distinct (business_id, product_id, warehouse_id) stock rows affected. */
  stockRowsAffected: number;
  /** Distinct businesses with at least one affected route. */
  businessesAffected: number;
}

export interface StorefrontReservationReleaseResult {
  routesUpdated: number;
  unitsReleased: number;
  stockRowsUpdated: number;
}

/** The parsed command line, or the reason it was refused. */
export type Args = { apply: boolean; businessIds: string[] } | { error: string };

export function parseArgs(argv: string[]): Args {
  let apply = false;
  const businessIds: string[] = [];
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--business=')) {
      const id = arg.slice('--business='.length).trim();
      if (!id) return { error: '--business= needs a business id' };
      if (!businessIds.includes(id)) businessIds.push(id);
      continue;
    }
    return { error: 'unknown argument' };
  }
  return { apply, businessIds };
}

/**
 * Shared SQL predicate identifying active LOCAL_STOCK routes (`r`) on orders
 * (`o`) and items (`oi`) whose stock was already decremented at checkout
 * (`stock_movements.type = 'sale'` and `quantity_change < 0`) and whose route
 * does not yet carry `noReservationRequired` / `stockDecrementedAtCheckout`.
 *
 * JSONB checks guard `jsonb_typeof(r.metadata) = 'object'` and compare text
 * safely without `::boolean` casts so dirty or non-object metadata (including
 * JSON `'null'::jsonb`) can never abort a run with Postgres `22P02`.
 */
function eligibleRoutePredicate(scopedParam: string | null): string {
  return `
    r.business_id = o.business_id
    AND r.order_id = o.id
    AND r.order_item_id = oi.id
    AND oi.order_id = o.id
    AND r.strategy = 'LOCAL_STOCK'
    AND r.status IN ('RESERVED', 'PICKING_PACKING')
    AND r.warehouse_id IS NOT NULL
    AND oi.quantity > 0
    AND NOT (
      jsonb_typeof(r.metadata) = 'object'
      AND LOWER(COALESCE(r.metadata->>'noReservationRequired', '')) IN ('true', 't', '1', 'yes', 'y', 'on')
    )
    AND NOT (
      jsonb_typeof(r.metadata) = 'object'
      AND LOWER(COALESCE(r.metadata->>'stockDecrementedAtCheckout', '')) IN ('true', 't', '1', 'yes', 'y', 'on')
    )
    AND NOT (
      jsonb_typeof(r.metadata) = 'object'
      AND LOWER(COALESCE(r.metadata->>'inventoryMode', '')) IN ('untracked', 'virtual')
    )
    AND EXISTS (
      SELECT 1
        FROM stock_movements sm
       WHERE sm.business_id = o.business_id
         AND sm.reference_id = o.order_number
         AND sm.product_id = oi.product_id
         AND sm.type = 'sale'
         AND sm.quantity_change < 0
    )
    ${scopedParam ? `AND r.business_id = ANY(${scopedParam}::text[])` : ''}
  `;
}

export async function countDecrementHeldReservations(
  database: RawDb,
  businessIds: string[] = [],
): Promise<StorefrontReservationCounts> {
  const scoped = businessIds.length > 0;
  const rows = (await database.$queryRawUnsafe(
    `WITH eligible AS (
       SELECT r.id AS route_id,
              r.business_id,
              oi.product_id,
              r.warehouse_id,
              oi.quantity
         FROM fulfillment_routes r
         JOIN marketplace_orders o ON o.id = r.order_id
         JOIN marketplace_order_items oi ON oi.id = r.order_item_id
        WHERE ${eligibleRoutePredicate(scoped ? '$1' : null)}
     )
     SELECT (SELECT count(*)::int FROM eligible) AS n_routes,
            (SELECT COALESCE(sum(quantity), 0)::int FROM eligible) AS n_units,
            (SELECT count(*)::int FROM (SELECT DISTINCT business_id, product_id, warehouse_id FROM eligible) s) AS n_stocks,
            (SELECT count(DISTINCT business_id)::int FROM eligible) AS n_businesses`,
    ...(scoped ? [businessIds] : []),
  )) as Array<{ n_routes: number; n_units: number; n_stocks: number; n_businesses: number }>;

  const c = rows[0] ?? { n_routes: 0, n_units: 0, n_stocks: 0, n_businesses: 0 };
  return {
    routesAffected: c.n_routes,
    unitsToRelease: c.n_units,
    stockRowsAffected: c.n_stocks,
    businessesAffected: c.n_businesses,
  };
}

/**
 * Atomically:
 *   1. Acquires each candidate order's routing claim (`claimOrderRouting`
 *      advisory lock key) in ascending lock-key order before any stock lock;
 *   2. Re-reads eligible route IDs strictly under the held routing claims;
 *   3. Locks their `inventory_stocks` rows in `ORDER BY id ASC FOR UPDATE`
 *      order (matching `core/inventory/stock-lock-order.ts`);
 *   4. Safely merges `noReservationRequired: true` + `stockDecrementedAtCheckout: true`
 *      into those exact routes' metadata (normalizing non-object JSONB to `{}`);
 *   5. Releases the corresponding `reserved` quantities (clamped at 0).
 *
 * Deadlock-free with live routing/ship/cancel, strictly atomic, and idempotent.
 */
export async function releaseDecrementHeldReservations(
  database: Db,
  businessIds: string[] = [],
): Promise<StorefrontReservationReleaseResult> {
  const scoped = businessIds.length > 0;
  const releasedAt = new Date().toISOString();

  return database.$transaction(
    async (tx) => {
      // 1. Discover candidate orders and acquire their routing advisory locks in ascending lock-key order
      //    (matching claimOrderRouting -> lockStockRowPairsInOrder hierarchy).
      const candidateOrders = (await tx.$queryRawUnsafe(
        `SELECT DISTINCT
                o.id AS order_id,
                hashtext($1 || o.business_id || ':' || o.id) AS lock_key
           FROM fulfillment_routes r
           JOIN marketplace_orders o ON o.id = r.order_id
           JOIN marketplace_order_items oi ON oi.id = r.order_item_id
          WHERE ${eligibleRoutePredicate(scoped ? '$2' : null)}
          ORDER BY lock_key ASC, o.id ASC`,
        ...(scoped ? [ROUTING_LOCK_NAMESPACE, businessIds] : [ROUTING_LOCK_NAMESPACE]),
      )) as Array<{ order_id: string; lock_key: number }>;

      if (candidateOrders.length === 0) {
        return { routesUpdated: 0, unitsReleased: 0, stockRowsUpdated: 0 };
      }

      const uniqueLockKeys = [...new Set(candidateOrders.map((c) => Number(c.lock_key)))].sort((a, b) => a - b);
      for (const key of uniqueLockKeys) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int)', key);
      }
      const claimedOrderIds = [...new Set(candidateOrders.map((c) => c.order_id))];

      // 2. Re-query eligible route IDs strictly under the held order routing claims
      //    (excluding any order cancelled or shipped while waiting for its claim).
      const eligibleRoutes = (await tx.$queryRawUnsafe(
        `SELECT r.id AS route_id
           FROM fulfillment_routes r
           JOIN marketplace_orders o ON o.id = r.order_id
           JOIN marketplace_order_items oi ON oi.id = r.order_item_id
          WHERE o.id = ANY($1::text[])
            AND ${eligibleRoutePredicate(scoped ? '$2' : null)}
          ORDER BY r.id ASC`,
        ...(scoped ? [claimedOrderIds, businessIds] : [claimedOrderIds]),
      )) as Array<{ route_id: string }>;

      if (eligibleRoutes.length === 0) {
        return { routesUpdated: 0, unitsReleased: 0, stockRowsUpdated: 0 };
      }
      const routeIds = eligibleRoutes.map((r) => r.route_id);

      // 3. Lock exactly the affected inventory_stocks rows in global ORDER BY s.id ASC
      //    (matching core/inventory/stock-lock-order.ts).
      await tx.$queryRawUnsafe(
        `SELECT s.id
           FROM inventory_stocks s
          WHERE (s.business_id, s.product_id, s.warehouse_id) IN (
            SELECT DISTINCT r.business_id, oi.product_id, r.warehouse_id
              FROM fulfillment_routes r
              JOIN marketplace_order_items oi ON oi.id = r.order_item_id
             WHERE r.id = ANY($1::text[])
          )
          ORDER BY s.id ASC
          FOR UPDATE`,
        routeIds,
      );

      // 4. Mark strictly those claimed & locked routes idempotently (normalizing non-object JSONB to '{}').
      const updatedRoutes = (await tx.$queryRawUnsafe(
        `WITH marked AS (
           UPDATE fulfillment_routes r
              SET metadata = (
                    CASE
                      WHEN jsonb_typeof(r.metadata) = 'object' THEN r.metadata
                      ELSE '{}'::jsonb
                    END
                  ) || jsonb_build_object(
                    'inventoryMode', 'tracked',
                    'noReservationRequired', true,
                    'stockDecrementedAtCheckout', true,
                    'd137ReservationReleasedAt', $1::text
                  ),
                  updated_at = NOW()
             FROM marketplace_order_items oi
            WHERE r.id = ANY($2::text[])
              AND r.order_item_id = oi.id
              AND oi.order_id = r.order_id
           RETURNING r.id AS route_id, r.business_id, oi.product_id, r.warehouse_id, oi.quantity
         )
         SELECT business_id,
                product_id,
                warehouse_id,
                count(*)::int AS n_routes,
                sum(quantity)::int AS qty
           FROM marked
          GROUP BY business_id, product_id, warehouse_id
          ORDER BY business_id ASC, product_id ASC, warehouse_id ASC`,
        releasedAt,
        routeIds,
      )) as Array<{
        business_id: string;
        product_id: string;
        warehouse_id: string;
        n_routes: number;
        qty: number;
      }>;

      if (updatedRoutes.length === 0) {
        return { routesUpdated: 0, unitsReleased: 0, stockRowsUpdated: 0 };
      }

      let routesUpdated = 0;
      let unitsReleased = 0;
      let stockRowsUpdated = 0;

      // 5. Decrement reserved on each locked stock row (clamped at 0) and sum exact units released.
      for (const agg of updatedRoutes) {
        routesUpdated += agg.n_routes;
        const rows = (await tx.$queryRawUnsafe(
          `WITH prev AS (
             SELECT id, reserved
               FROM inventory_stocks
              WHERE business_id = $1
                AND product_id = $2
                AND warehouse_id = $3
           )
           UPDATE inventory_stocks s
              SET reserved = GREATEST(0, s.reserved - $4::int),
                  updated_at = NOW()
             FROM prev
            WHERE s.id = prev.id
           RETURNING (prev.reserved - s.reserved)::int AS released_units`,
          agg.business_id,
          agg.product_id,
          agg.warehouse_id,
          agg.qty,
        )) as Array<{ released_units: number }>;
        for (const r of rows) {
          stockRowsUpdated += 1;
          unitsReleased += Math.max(0, r.released_units);
        }
      }

      return { routesUpdated, unitsReleased, stockRowsUpdated };
    },
    { timeout: 30_000 },
  );
}

/** The error's class and its code: never its message. */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;
const row = (label: string, n: number) => `  ${label.padEnd(30)} ${n}`;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a database and
 * a logger; by default it uses @keyflow/db's client and prints to the console.
 */
export async function main(argv: string[], deps: { db?: Db; log?: Log; error?: Log } = {}): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const args = parseArgs(argv);
  if ('error' in args) {
    error(
      `Bad arguments (${args.error}). Usage: release-storefront-decremented-reservations [--apply] [--business=<id> ...]`,
    );
    return 2;
  }
  const database = deps.db ?? (db as unknown as Db);
  const scope =
    args.businessIds.length > 0 ? ` (limited to ${args.businessIds.length} business(es))` : ' (every business)';
  log(
    args.apply
      ? `Storefront checkout-decremented reservations (F-36 / D-137) - APPLY: releasing stuck reservations${scope}`
      : `Storefront checkout-decremented reservations (F-36 / D-137) - DRY RUN: nothing is written; re-run with --apply to release${scope}`,
  );

  let counts: StorefrontReservationCounts;
  try {
    counts = await countDecrementHeldReservations(database, args.businessIds);
  } catch (err: unknown) {
    error(`The reservations could not be counted: ${describeFailure(err)}. Nothing was written.`);
    return 1;
  }

  log(row('routes_affected', counts.routesAffected));
  log(row('units_to_release', counts.unitsToRelease));
  log(row('stock_rows_affected', counts.stockRowsAffected));
  log(row('businesses_affected', counts.businessesAffected));
  if (!args.apply) return 0;

  try {
    const result = await releaseDecrementHeldReservations(database, args.businessIds);
    log(row('routes_updated', result.routesUpdated));
    log(row('units_released', result.unitsReleased));
    log(row('stock_rows_updated', result.stockRowsUpdated));
  } catch (err: unknown) {
    error(`The release failed: ${describeFailure(err)}. The transaction rolled back; nothing was written.`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`Storefront reservation release failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
