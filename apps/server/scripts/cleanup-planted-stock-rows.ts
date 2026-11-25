#!/usr/bin/env tsx
/**
 * Census and delete cross-business planted `inventory_stocks` rows whose
 * `business_id` does not match their product's or warehouse's `business_id`
 * and that hold zero reservations (`reserved = 0`), while preserving movement
 * history and leaving any reserved planted row for manual operator repair.
 *
 * WHY THIS EXISTS (F-39, Z5SEC-2, owner ruling D-137; packet
 * W11-PLANTED-STOCK-CENSUS)
 *
 * `inventory_stocks` keys rows by `(product_id, warehouse_id)` globally, with
 * a `business_id` column of its own. Earlier cross-business writers (purchase
 * order receipt before W10-Z4, stock transfer before W10-Z5, and
 * MarketplaceService.upsertInventory before W11-INV-UPSERT-SCOPE) could plant
 * a stock row under business A referencing a product or warehouse owned by
 * business B (or C). Production code refuses around such rows (409) and never
 * deletes or rewrites them. Effects:
 *   - an unstocked product of B reads as stock-tracked (storefront refuses it);
 *   - B's own receipts/transfers into that `(product_id, warehouse_id)` pair
 *     answer 409 because the unique slot is occupied;
 *   - commerce-intelligence sums the planted quantity into B's product stock.
 *
 * Per owner ruling D-137:
 *   - Dry run by default: counts all 4 planted classes, planted quantity,
 *     reserved planted rows, affected businesses, products tracked only by
 *     planted rows, and stock movements naming a foreign product/warehouse.
 *     Writes nothing.
 *   - `--apply`: one atomic, idempotent DELETE of unreserved planted rows
 *     (`reserved = 0`). Reserved planted rows (`reserved <> 0`), same-business
 *     rows, and `stock_movements` are NEVER deleted.
 *   - `--business=<id>` (repeatable): limits a run to rows whose `business_id`,
 *     product's `business_id`, or warehouse's `business_id` is in the list.
 *   - Counts only: NEVER prints an id, name, or value. On failure prints ONLY
 *     the error's class and code, never the database message.
 *
 * Usage (from apps/server; reads DATABASE_URL from env or repo-root .env):
 *   pnpm cleanup:planted-stock-rows                    # dry run, all businesses
 *   pnpm cleanup:planted-stock-rows --business=<id>    # dry run, scoped
 *   pnpm cleanup:planted-stock-rows --apply            # delete unreserved planted rows
 *
 * Exit status: 0 done, 1 database failure, 2 bad arguments.
 * Runbook: docs/development/operator-data-cleanup-scripts.md (section 7).
 */
import { db } from '@keyflow/db';

type Db = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export interface PlantedStockCounts {
  plantedRows: number;
  foreignProductRows: number;
  foreignWarehouseRows: number;
  otherBusinessPairRows: number;
  mixedRows: number;
  plantedQuantity: number;
  reservedRows: number;
  businessesAffected: number;
  productsTrackedOnlyByPlanted: number;
  movementsNamingForeignPair: number;
}

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

function plantedPredicate(scoped: boolean): string {
  return (
    '(p.business_id <> s.business_id OR w.business_id <> s.business_id)' +
    (scoped ? ' AND (s.business_id = ANY($1::text[]) OR p.business_id = ANY($1::text[]) OR w.business_id = ANY($1::text[]))' : '')
  );
}

function movementForeignPredicate(scoped: boolean): string {
  return (
    '((p.id IS NOT NULL AND p.business_id <> m.business_id) OR (w.id IS NOT NULL AND w.business_id <> m.business_id))' +
    (scoped
      ? ' AND (m.business_id = ANY($1::text[]) OR p.business_id = ANY($1::text[]) OR w.business_id = ANY($1::text[]))'
      : '')
  );
}

export async function countPlantedStockRows(
  database: Db,
  businessIds: string[] = [],
): Promise<PlantedStockCounts> {
  const scoped = businessIds.length > 0;
  const params = scoped ? [businessIds] : [];

  const [stockRows, movRows] = await Promise.all([
    database.$queryRawUnsafe(
      `WITH planted AS (
         SELECT s.id,
                s.business_id AS stock_business,
                p.id AS product_id,
                p.business_id AS product_business,
                p.inventory_mode,
                w.business_id AS warehouse_business,
                s.quantity,
                s.reserved
           FROM inventory_stocks s
           JOIN products p ON p.id = s.product_id
           JOIN warehouses w ON w.id = s.warehouse_id
          WHERE ${plantedPredicate(scoped)}
       )
       SELECT
         (SELECT count(*)::int FROM planted) AS planted_rows,
         (SELECT count(*) FILTER (
            WHERE product_business <> stock_business AND warehouse_business = stock_business
          )::int FROM planted) AS foreign_product_rows,
         (SELECT count(*) FILTER (
            WHERE product_business = stock_business AND warehouse_business <> stock_business
          )::int FROM planted) AS foreign_warehouse_rows,
         (SELECT count(*) FILTER (
            WHERE product_business <> stock_business
              AND warehouse_business <> stock_business
              AND product_business = warehouse_business
          )::int FROM planted) AS other_business_pair_rows,
         (SELECT count(*) FILTER (
            WHERE product_business <> stock_business
              AND warehouse_business <> stock_business
              AND product_business <> warehouse_business
          )::int FROM planted) AS mixed_rows,
         (SELECT COALESCE(SUM(quantity), 0)::int FROM planted) AS planted_quantity,
         (SELECT count(*) FILTER (WHERE reserved <> 0)::int FROM planted) AS reserved_rows,
         (SELECT count(*)::int FROM (
            SELECT stock_business AS b FROM planted
            UNION
            SELECT product_business AS b FROM planted
            UNION
            SELECT warehouse_business AS b FROM planted
          ) biz) AS businesses_affected,
         (SELECT count(DISTINCT pl.product_id)::int
            FROM planted pl
           WHERE pl.inventory_mode IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM inventory_stocks own
                WHERE own.product_id = pl.product_id
                  AND own.business_id = pl.product_business
             )) AS products_tracked_only_by_planted`,
      ...params,
    ) as Promise<
      Array<{
        planted_rows: number;
        foreign_product_rows: number;
        foreign_warehouse_rows: number;
        other_business_pair_rows: number;
        mixed_rows: number;
        planted_quantity: number;
        reserved_rows: number;
        businesses_affected: number;
        products_tracked_only_by_planted: number;
      }>
    >,
    database.$queryRawUnsafe(
      `SELECT count(*)::int AS movements_naming_foreign_pair
         FROM stock_movements m
         LEFT JOIN products p ON p.id = m.product_id
         LEFT JOIN warehouses w ON w.id = m.warehouse_id
        WHERE ${movementForeignPredicate(scoped)}`,
      ...params,
    ) as Promise<Array<{ movements_naming_foreign_pair: number }>>,
  ]);

  const s = stockRows[0] ?? {
    planted_rows: 0,
    foreign_product_rows: 0,
    foreign_warehouse_rows: 0,
    other_business_pair_rows: 0,
    mixed_rows: 0,
    planted_quantity: 0,
    reserved_rows: 0,
    businesses_affected: 0,
    products_tracked_only_by_planted: 0,
  };
  const m = movRows[0] ?? { movements_naming_foreign_pair: 0 };

  return {
    plantedRows: Number(s.planted_rows ?? 0),
    foreignProductRows: Number(s.foreign_product_rows ?? 0),
    foreignWarehouseRows: Number(s.foreign_warehouse_rows ?? 0),
    otherBusinessPairRows: Number(s.other_business_pair_rows ?? 0),
    mixedRows: Number(s.mixed_rows ?? 0),
    plantedQuantity: Number(s.planted_quantity ?? 0),
    reservedRows: Number(s.reserved_rows ?? 0),
    businessesAffected: Number(s.businesses_affected ?? 0),
    productsTrackedOnlyByPlanted: Number(s.products_tracked_only_by_planted ?? 0),
    movementsNamingForeignPair: Number(m.movements_naming_foreign_pair ?? 0),
  };
}

/**
 * Atomically deletes all unreserved (`reserved = 0`) planted `inventory_stocks`
 * rows matching the planted predicate (and optional `--business` scope) in one
 * statement. Reserved planted rows and `stock_movements` are never deleted.
 */
export async function deletePlantedStockRows(
  database: Db,
  businessIds: string[] = [],
): Promise<number> {
  const scoped = businessIds.length > 0;
  return database.$executeRawUnsafe(
    `DELETE FROM inventory_stocks s
       USING products p, warehouses w
      WHERE s.product_id = p.id
        AND s.warehouse_id = w.id
        AND ${plantedPredicate(scoped)}
        AND s.reserved = 0`,
    ...(scoped ? [businessIds] : []),
  );
}

/** The error's class and its code: never its message (which can echo values). */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;
const row = (label: string, n: number) => `  ${label.padEnd(36)} ${n}`;

export async function main(
  argv: string[],
  deps: { db?: Db; log?: Log; error?: Log } = {},
): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const args = parseArgs(argv);
  if ('error' in args) {
    error(
      `Bad arguments (${args.error}). Usage: cleanup-planted-stock-rows [--apply] [--business=<id> ...]`,
    );
    return 2;
  }

  const database = deps.db ?? db;
  const scope =
    args.businessIds.length > 0
      ? ` (limited to ${args.businessIds.length} business(es))`
      : ' (every business)';
  log(
    args.apply
      ? `Cross-business planted stock rows (F-39, Z5SEC-2, D-137) - APPLY: deleting unreserved planted rows${scope}`
      : `Cross-business planted stock rows (F-39, Z5SEC-2, D-137) - DRY RUN: nothing is deleted; re-run with --apply to delete unreserved rows${scope}`,
  );

  let counts: PlantedStockCounts;
  try {
    counts = await countPlantedStockRows(database, args.businessIds);
  } catch (err: unknown) {
    error(`The rows could not be counted: ${describeFailure(err)}. Nothing was deleted.`);
    return 1;
  }

  log(row('planted_rows', counts.plantedRows));
  log(row('foreign_product_rows', counts.foreignProductRows));
  log(row('foreign_warehouse_rows', counts.foreignWarehouseRows));
  log(row('other_business_pair_rows', counts.otherBusinessPairRows));
  log(row('mixed_rows', counts.mixedRows));
  log(row('planted_quantity', counts.plantedQuantity));
  log(row('reserved_rows', counts.reservedRows));
  log(row('businesses_affected', counts.businessesAffected));
  log(row('products_tracked_only_by_planted', counts.productsTrackedOnlyByPlanted));
  log(row('movements_naming_foreign_pair', counts.movementsNamingForeignPair));

  if (!args.apply) {
    log(
      counts.plantedRows === 0
        ? 'Dry run complete: nothing to delete.'
        : 'Dry run complete: nothing was deleted.',
    );
    return 0;
  }

  try {
    const deleted = await deletePlantedStockRows(database, args.businessIds);
    const afterCounts = await countPlantedStockRows(database, args.businessIds);
    log(row('deleted', deleted));
    log(row('left_reserved', afterCounts.reservedRows));
    log('Apply complete.');
    return 0;
  } catch (err: unknown) {
    error(`The delete failed: ${describeFailure(err)}.`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await db.$disconnect();
      process.exit(code);
    })
    .catch(async (err: unknown) => {
      console.error(`Unexpected failure: ${describeFailure(err)}`);
      await db.$disconnect().catch(() => undefined);
      process.exit(1);
    });
}
