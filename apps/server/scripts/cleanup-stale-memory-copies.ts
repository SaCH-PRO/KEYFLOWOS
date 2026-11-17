#!/usr/bin/env tsx
/**
 * Delete the semantic copies of AI memories that no longer hold what their row holds (packet
 * FU-MEMORY-COPIES-REWRITE, owner ruling D-221).
 *
 * WHY THIS EXISTS
 *
 * An AiMemory row (ai_memories) has semantic copies in ai_memory_embeddings: source_type 'memory', source_id the row's
 * id, content `<category>: <key> = <value>` (POST /ai/businesses/:id/agent/memory/backfill) or the value itself (KEY's
 * memory writer, UnifiedMemoryWriterService.store with indexSemantic). Every member reads them back (GET
 * .../agent/memory/search, and KEY's memory block). Before W1F-MEMORY-COPIES a deletion of the row left its copies;
 * before FU-MEMORY-COPIES-REWRITE a rewrite of the row in place (the owner's PUT .../ai/memory of a new value, a
 * document extracted again, a promotion into the same key) left the copies of its old value. W1F-MEMORY-COPIES stopped
 * serving such a copy; FU-MEMORY-COPIES-REWRITE makes every deletion and rewrite remove them. The ones stored before
 * stay in the table, holding text the owner removed or replaced. This script deletes them.
 *
 * WHAT IS STALE
 *
 * A copy (source_type 'memory') is stale when no row of its business with its source_id holds what it holds, in either
 * form: the same test as copyHoldsRowValue in apps/server/src/modules/ai/semantic-memory.service.ts, stated here in
 * SQL so the script needs only @keyflow/db. A copy of a settings row (category 'settings': the owner's AI preferences,
 * holding the BYOK provider keys as ciphertext, the routing table, the autonomy settings) is stale whatever it holds:
 * a settings row is configuration, not memory, and has no copy (AI_MEMORY_SETTINGS_CATEGORIES in the same file;
 * review SEC-FUMCR-1, SEC-FUMCR-2). Three reasons are reported:
 *   - row_gone: no AiMemory row with that id in the copy's business (deleted, or another business's row);
 *   - settings_row: the row is a settings row (the backfill copied those before the review repair, and their writers
 *     rewrite them outside the write door, so a rotated key's old ciphertext stayed in the copy);
 *   - value_rewritten: the row is there and holds another value.
 * A copy of a row that has expired still holds what its row holds: it is not stale (search hides it while the row is
 * expired). Other source types (document chunks, events, conversations) are never read or deleted.
 *
 * SAFETY
 *
 * Dry run by default: it lists the stale copies and their counts and deletes nothing unless `--apply` is passed.
 * `--apply` deletes in batches of DELETE_BATCH, each one statement that re-checks the copy is still stale, until a
 * batch finds none: a copy that is valid again by the time its batch runs stays. A re-run deletes nothing new
 * (idempotent), and a run stopped part way is finished by running it again. `--business=<id>` (repeatable) limits a
 * run to the copies of those businesses. It never prints a copy's content (the text this script exists to remove) or a
 * business id: only counts, and, in a dry run, each stale copy's id (an opaque generated id) and reason. On a failure
 * it prints only the error's class and code, never the database's message.
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm cleanup:memory-copies                     # dry run: list and count, every business
 *   pnpm cleanup:memory-copies --business=<id>     # dry run for one business
 *   pnpm cleanup:memory-copies --apply             # delete them
 *
 * Exit status: 0 done, 1 a database read or delete failed, 2 bad arguments.
 * Runbook: docs/development/operator-data-cleanup-scripts.md (section 4). Not run against production by the packet.
 */
import { db } from '@keyflow/db';

type Db = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;

/** The source_type of an AiMemory row's copies (AI_MEMORY_COPY_SOURCE_TYPE in semantic-memory.service.ts). */
const COPY_SOURCE_TYPE = 'memory';
/** The AiMemory categories that hold configuration, not memory (AI_MEMORY_SETTINGS_CATEGORIES in semantic-memory.service.ts). */
const SETTINGS_CATEGORIES = "('settings')";
/** How many copies one --apply statement deletes at most. */
export const DELETE_BATCH = 1000;

/** The row `m` of the copy `e`, in the copy's business. */
const ROW_OF_COPY = 'm.id = e.source_id AND m.business_id = e.business_id';
/** The copy `e` holds what the row `m` holds, in either form (copyHoldsRowValue). */
const COPY_HOLDS_ROW_VALUE = "(e.content = m.value OR e.content = (m.category || ': ' || m.key || ' = ' || m.value))";
/** The row `m` is memory, not a settings row. */
const ROW_IS_MEMORY = `m.category NOT IN ${SETTINGS_CATEGORIES}`;
/** The copy `e` is an AiMemory copy that no memory row of its business holds. */
const STALE = `e.source_type = '${COPY_SOURCE_TYPE}' AND NOT EXISTS (SELECT 1 FROM ai_memories m WHERE ${ROW_OF_COPY} AND ${ROW_IS_MEMORY} AND ${COPY_HOLDS_ROW_VALUE})`;
/** Why a stale copy is stale. */
const REASON = `CASE
  WHEN EXISTS (SELECT 1 FROM ai_memories m WHERE ${ROW_OF_COPY} AND NOT (${ROW_IS_MEMORY})) THEN 'settings_row'
  WHEN EXISTS (SELECT 1 FROM ai_memories m WHERE ${ROW_OF_COPY}) THEN 'value_rewritten'
  ELSE 'row_gone' END`;

export type StaleReason = 'row_gone' | 'settings_row' | 'value_rewritten';

export interface StaleCopy {
  id: string;
  reason: StaleReason;
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

/** The scope term (the business ids bound as $1) and its parameters. */
function scopeOf(businessIds: string[]): { term: string; params: unknown[] } {
  return businessIds.length > 0 ? { term: ' AND e.business_id = ANY($1::text[])', params: [businessIds] } : { term: '', params: [] };
}

/** Every stale copy in scope, by id. */
export async function findStaleMemoryCopies(database: Db, businessIds: string[] = []): Promise<StaleCopy[]> {
  const scope = scopeOf(businessIds);
  const rows = (await database.$queryRawUnsafe(
    `SELECT e.id, ${REASON} AS reason FROM ai_memory_embeddings e WHERE ${STALE}${scope.term} ORDER BY e.id`,
    ...scope.params,
  )) as Array<{ id: string; reason: StaleReason }>;
  return rows.map((r) => ({ id: r.id, reason: r.reason }));
}

/** Deletes every stale copy in scope, DELETE_BATCH at a time; answers how many were deleted. */
export async function deleteStaleMemoryCopies(database: Db, businessIds: string[] = []): Promise<number> {
  const scope = scopeOf(businessIds);
  let deleted = 0;
  for (;;) {
    const n = await database.$executeRawUnsafe(
      `DELETE FROM ai_memory_embeddings e
        WHERE e.id IN (SELECT e.id FROM ai_memory_embeddings e WHERE ${STALE}${scope.term} ORDER BY e.id LIMIT ${DELETE_BATCH})
          AND ${STALE}`,
      ...scope.params,
    );
    deleted += n;
    if (n === 0) return deleted;
  }
}

/** The error's class and its code: never its message. */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;
const row = (label: string, n: number) => `  ${label.padEnd(32)} ${n}`;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a database and a logger; by default it uses
 * @keyflow/db's client and prints to the console.
 */
export async function main(argv: string[], deps: { db?: Db; log?: Log; error?: Log } = {}): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const args = parseArgs(argv);
  if ('error' in args) {
    error(`Bad arguments (${args.error}). Usage: cleanup-stale-memory-copies [--apply] [--business=<id> ...]`);
    return 2;
  }
  const database = deps.db ?? db;
  const scope = args.businessIds.length > 0 ? ` (limited to ${args.businessIds.length} business(es))` : ' (every business)';
  log(
    args.apply
      ? `AI memory stale-copy cleanup (FU-MEMORY-COPIES-REWRITE, D-221) - APPLY: deleting${scope}`
      : `AI memory stale-copy cleanup (FU-MEMORY-COPIES-REWRITE, D-221) - DRY RUN: nothing is deleted; re-run with --apply to delete${scope}`,
  );

  let stale: StaleCopy[];
  try {
    stale = await findStaleMemoryCopies(database, args.businessIds);
  } catch (err: unknown) {
    error(`The copies could not be read: ${describeFailure(err)}. Nothing was deleted.`);
    return 1;
  }
  log(row('stale_row_gone', stale.filter((c) => c.reason === 'row_gone').length));
  log(row('stale_settings_row', stale.filter((c) => c.reason === 'settings_row').length));
  log(row('stale_value_rewritten', stale.filter((c) => c.reason === 'value_rewritten').length));
  if (!args.apply) {
    log(row('would_delete', stale.length));
    for (const copy of stale) log(`  stale copy ${copy.id} ${copy.reason}`);
    return 0;
  }

  try {
    log(row('deleted', await deleteStaleMemoryCopies(database, args.businessIds)));
  } catch (err: unknown) {
    error(`A delete failed: ${describeFailure(err)}. Batches deleted before it stay deleted (each copy was stale); re-run to finish.`);
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
      console.error(`AI memory stale-copy cleanup failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
