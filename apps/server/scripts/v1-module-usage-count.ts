#!/usr/bin/env tsx
/**
 * Read-only usage count, per live business, of every module v1 hides.
 *
 * WHY THIS EXISTS (packet USAGE-COUNT-SCRIPT, V1-61; owner rulings D-152,
 * D-153, D-156, D-158)
 *
 * v1 hides about 45 screens. A business that already keeps records in one of
 * them must not find those records apparently gone: NAV-B-HIDE shows such a
 * module read-only to that business instead. This script tells the owner
 * which live businesses have rows in which hidden module. The owner runs it
 * against production (D-148) and posts its JSON to #80: once now, again
 * immediately before NAV-B-HIDE starts, and again before the redeploy
 * (GATE-OWNER-TEST).
 *
 * WHAT IT COUNTS
 *
 * The module -> tables list is packages/shared/src/v1-modules.ts, the one
 * list NAV-B-LEGACY-SERVER, NAV-B-HIDE and KEY's tool allowlist also read. For
 * each table entry of each module it runs one statement:
 *
 *   SELECT t."<business column>" AS business_id, count(*)::int AS n
 *     FROM "<table>" t JOIN "businesses" b ON b."id" = t."<business column>"
 *    WHERE b."deleted_at" IS NULL [AND t."<soft-delete column>" IS NULL] [AND (<filter>)]
 *    GROUP BY t."<business column>"
 *
 * so it reads only the business column, the soft-delete markers and the
 * columns a filter names (status flags), never a name, an email, a phone
 * number, an amount or free text. Its JSON carries module metadata, business
 * ids and counts only. A soft-deleted business is not counted; a row with a
 * soft-delete mark is not counted.
 *
 * SAFETY
 *
 * No write path. Everything runs in ONE transaction whose first statement is
 * `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`: Postgres
 * itself refuses any write inside it, and every count sees the same snapshot.
 * The script reads back `transaction_read_only` and refuses to count unless it
 * is `on`. Each statement is bounded (statement_timeout 60 s, lock_timeout
 * 5 s). It makes no network call other than the database connection. A table
 * or column this database does not have (production on an older schema) is
 * reported under `absent`, not a failure. On a failure it prints only the
 * error's class and code, never the database's message.
 *
 * It imports the list by relative path, not through @keyflow/shared: the API
 * image deployed on the production box carries a @keyflow/shared build older
 * than the list, so the runbook mounts this directory and the list file into
 * that image (docs/development/operator-data-cleanup-scripts.md, section 3).
 *
 * Usage (from apps/server; reads DATABASE_URL from the environment, else the
 * repo-root .env):
 *   pnpm usage:v1-modules > v1-module-usage.json
 *
 * Output: the JSON report on stdout; one summary line on stderr.
 * Exit status: 0 done, 1 the database read failed (nothing is written either
 * way), 2 bad arguments.
 */
import { db } from '@keyflow/db';
import { V1_HIDDEN_MODULES, type V1HiddenModule, type V1ModuleTable } from '../../../packages/shared/src/v1-modules';

/** What the script needs of a transaction: raw reads, and SET statements. */
export interface ReadTx {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/** What the script needs of the client: one interactive transaction. */
export interface ReadDb {
  $transaction<R>(fn: (tx: ReadTx) => Promise<R>, options?: { maxWait?: number; timeout?: number }): Promise<R>;
}

/** The statements that open the transaction, in order; the first one makes it read only. */
export const READ_ONLY_PREAMBLE = [
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
  "SET LOCAL statement_timeout = '60s'",
  "SET LOCAL lock_timeout = '5s'",
] as const;

/** Thrown when the transaction does not report itself read only: nothing is counted. */
export class NotReadOnlyError extends Error {
  constructor() {
    super('The transaction is not read only; nothing was counted.');
    this.name = 'NotReadOnlyError';
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Not a plain SQL identifier: ${JSON.stringify(name)}`);
  return `"${name}"`;
}

/**
 * Opens the read-only transaction, checks Postgres reports it read only, and
 * runs `fn` inside it. `fn` cannot write: Postgres refuses (SQLSTATE 25006).
 */
export async function runReadOnly<R>(database: ReadDb, fn: (tx: ReadTx) => Promise<R>): Promise<R> {
  return database.$transaction(
    async (tx) => {
      for (const statement of READ_ONLY_PREAMBLE) await tx.$executeRawUnsafe(statement);
      const [state] = await tx.$queryRawUnsafe<Array<{ read_only: string; isolation: string }>>(
        "SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation",
      );
      if (state?.read_only !== 'on') throw new NotReadOnlyError();
      return fn(tx);
    },
    { maxWait: 30_000, timeout: 10 * 60_000 },
  );
}

/** The one statement that counts a table entry's rows per live business. */
export function countStatement(entry: V1ModuleTable): string {
  const business = `t.${ident(entry.businessColumn)}`;
  const where = ['b."deleted_at" IS NULL'];
  if (entry.softDeleteColumn) where.push(`t.${ident(entry.softDeleteColumn)} IS NULL`);
  if (entry.where) where.push(`(${entry.where})`);
  return (
    `SELECT ${business} AS business_id, count(*)::int AS n FROM ${ident(entry.table)} t ` +
    `JOIN "businesses" b ON b."id" = ${business} WHERE ${where.join(' AND ')} GROUP BY ${business}`
  );
}

/** Every column an entry reads. */
function columnsOf(entry: V1ModuleTable): string[] {
  return [entry.businessColumn, ...(entry.softDeleteColumn ? [entry.softDeleteColumn] : []), ...(entry.whereColumns ?? [])];
}

export interface ModuleUsage {
  key: string;
  label: string;
  treatment: string;
  returnsIn: string | null;
  /** False when the module has no records of its own (nothing to count). */
  measured: boolean;
  /** Live businesses with at least one counted row. */
  businessCount: number;
  /** Those businesses, sorted by id: every count of the module (0 included), and the informative facets. */
  businesses: Array<{ businessId: string; rows: Record<string, number>; facets?: Record<string, number> }>;
  /** Entries this database cannot answer: `<name>: <table>` or `<name>: <table>.<column>`. */
  absent: string[];
}

export interface UsageReport {
  report: 'v1-module-usage-count';
  formatVersion: 1;
  generatedAt: string;
  transaction: { readOnly: true; isolation: string };
  schema: { latestMigration: string | null; appliedMigrations: number | null };
  liveBusinesses: number;
  /** Module key -> live businesses using it (null: nothing to count). */
  summary: Record<string, number | null>;
  modules: ModuleUsage[];
}

/** Which of `tables` exist here, with their columns (pg_catalog: names only, visible whatever the role's privileges). */
async function existingColumns(tx: ReadTx, tables: string[]): Promise<Map<string, Set<string>>> {
  const rows = await tx.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    'SELECT c.relname AS table_name, a.attname AS column_name FROM pg_catalog.pg_class c ' +
      'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace ' +
      'JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid ' +
      "WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped " +
      'AND c.relname = ANY($1::text[])',
    tables,
  );
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.table_name)) out.set(r.table_name, new Set());
    out.get(r.table_name)!.add(r.column_name);
  }
  return out;
}

/** The reason an entry cannot be counted here, or null when it can. */
function absence(entry: V1ModuleTable, have: Map<string, Set<string>>): string | null {
  const columns = have.get(entry.table);
  if (!columns) return `${entry.name}: ${entry.table}`;
  const missing = columnsOf(entry).find((c) => !columns.has(c));
  return missing ? `${entry.name}: ${entry.table}.${missing}` : null;
}

async function countEntry(tx: ReadTx, entry: V1ModuleTable): Promise<Map<string, number>> {
  const rows = await tx.$queryRawUnsafe<Array<{ business_id: string; n: number }>>(countStatement(entry));
  return new Map(rows.map((r) => [r.business_id, Number(r.n)]));
}

/**
 * Counts every module of `modules` inside `tx` (which runReadOnly opened).
 * Business ids and counts only.
 */
export async function countModuleUsage(
  tx: ReadTx,
  modules: readonly V1HiddenModule[] = V1_HIDDEN_MODULES,
  now: Date = new Date(),
): Promise<UsageReport> {
  const [state] = await tx.$queryRawUnsafe<Array<{ read_only: string; isolation: string }>>(
    "SELECT current_setting('transaction_read_only') AS read_only, current_setting('transaction_isolation') AS isolation",
  );
  if (state?.read_only !== 'on') throw new NotReadOnlyError();

  const tables = new Set<string>(['businesses', '_prisma_migrations']);
  for (const m of modules) for (const e of [...m.tables, ...(m.facets ?? [])]) tables.add(e.table);
  const have = await existingColumns(tx, [...tables]);

  const [live] = await tx.$queryRawUnsafe<Array<{ n: number }>>('SELECT count(*)::int AS n FROM "businesses" WHERE "deleted_at" IS NULL');

  let latestMigration: string | null = null;
  let appliedMigrations: number | null = null;
  const migrationColumns = have.get('_prisma_migrations');
  if (migrationColumns && ['migration_name', 'finished_at', 'rolled_back_at'].every((c) => migrationColumns.has(c))) {
    const applied = 'WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL';
    const [latest] = await tx.$queryRawUnsafe<Array<{ latest: string }>>(
      `SELECT migration_name AS latest FROM "_prisma_migrations" ${applied} ORDER BY migration_name DESC LIMIT 1`,
    );
    const [count] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "_prisma_migrations" ${applied}`);
    latestMigration = latest?.latest ?? null;
    appliedMigrations = Number(count?.n ?? 0);
  }

  const usage: ModuleUsage[] = [];
  for (const m of modules) {
    const absent: string[] = [];
    const tableCounts = new Map<string, Map<string, number>>();
    const facetCounts = new Map<string, Map<string, number>>();
    for (const [entries, into] of [[m.tables, tableCounts], [m.facets ?? [], facetCounts]] as const) {
      for (const entry of entries) {
        const why = absence(entry, have);
        if (why) {
          absent.push(why);
          continue;
        }
        into.set(entry.name, await countEntry(tx, entry));
      }
    }
    const used = new Set<string>();
    for (const counts of tableCounts.values()) for (const [id, n] of counts) if (n > 0) used.add(id);
    const businesses = [...used].sort().map((businessId) => ({
      businessId,
      rows: Object.fromEntries(m.tables.map((e) => [e.name, tableCounts.get(e.name)?.get(businessId) ?? 0])),
      ...(m.facets?.length
        ? { facets: Object.fromEntries(m.facets.map((e) => [e.name, facetCounts.get(e.name)?.get(businessId) ?? 0])) }
        : {}),
    }));
    usage.push({
      key: m.key,
      label: m.label,
      treatment: m.treatment,
      returnsIn: m.returnsIn ?? null,
      measured: m.tables.length > 0,
      businessCount: businesses.length,
      businesses,
      absent,
    });
  }

  return {
    report: 'v1-module-usage-count',
    formatVersion: 1,
    generatedAt: now.toISOString(),
    transaction: { readOnly: true, isolation: state.isolation },
    schema: { latestMigration, appliedMigrations },
    liveBusinesses: Number(live?.n ?? 0),
    summary: Object.fromEntries(usage.map((u) => [u.key, u.measured ? u.businessCount : null])),
    modules: usage,
  };
}

/** The error's class and its code: never its message (a database message can echo values). */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a database, a
 * stdout writer, a logger and a clock; by default it uses @keyflow/db's
 * client, process.stdout and the console.
 */
export async function main(
  argv: string[],
  deps: { db?: ReadDb; out?: (text: string) => void; error?: Log; now?: () => Date } = {},
): Promise<number> {
  const error: Log = deps.error ?? console.error;
  const out = deps.out ?? ((text: string) => void process.stdout.write(text));
  if (argv.length > 0) {
    error('Bad arguments (this script takes none). Usage: v1-module-usage-count > v1-module-usage.json');
    return 2;
  }
  const database = deps.db ?? (db as unknown as ReadDb);
  let report: UsageReport;
  try {
    report = await runReadOnly(database, (tx) => countModuleUsage(tx, V1_HIDDEN_MODULES, deps.now?.() ?? new Date()));
  } catch (err: unknown) {
    if (err instanceof NotReadOnlyError) error(err.message);
    else error(`The usage count failed: ${describeFailure(err)}. Nothing was written (the transaction is read only).`);
    return 1;
  }
  out(`${JSON.stringify(report, null, 2)}\n`);
  const used = report.modules.filter((m) => m.businessCount > 0).length;
  const absent = report.modules.reduce((n, m) => n + m.absent.length, 0);
  error(
    `v1 module usage count (read only): ${report.liveBusinesses} live businesses; ${used} of ${report.modules.length} hidden modules in use` +
      (absent ? `; ${absent} table(s) absent from this schema` : ''),
  );
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`The usage count failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
