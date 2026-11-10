#!/usr/bin/env tsx
/**
 * Delete contact custom-field values that bind a contact of one business to a
 * custom-field definition of another.
 *
 * WHY THIS EXISTS (W9-CUSTOM-FIELDS-TENANT review SF-1; packet
 * W10-DATA-CLEANUP-SCRIPTS)
 *
 * contact_custom_field_values has no business column: a row joins a contact
 * to a definition. Before W9-CUSTOM-FIELDS-TENANT,
 * ContactCustomFieldValueService.setValuesForContact looked definition names
 * up with no business (names are unique per business only), so a caller with
 * no ambient tenant could bind a contact of A to a definition of B. That
 * packet stopped new binds, made both reads skip such rows (the values route
 * and the contact detail keep only definitions of the contact's own business),
 * and removes them from a contact on its next custom-field write. Rows already
 * stored on contacts nobody edits stay in the table. This script deletes them:
 *
 *   DELETE FROM contact_custom_field_values v
 *     USING contacts c, custom_field_definitions d
 *     WHERE v.contact_id = c.id AND v.definition_id = d.id
 *       AND c.business_id <> d.business_id
 *
 * Such a row is wrong whichever business looks at it (A's contact carries B's
 * field; B's definition holds a value of A's contact), and no screen serves it
 * since W9, so deleting it loses nothing either business can see. The contact
 * and the definition themselves are never touched. A contact that is
 * soft-deleted is judged like any other (raw SQL reads every row).
 *
 * SAFETY
 *
 * Dry run by default: it counts and writes nothing unless `--apply` is passed.
 * `--apply` is one DELETE statement (atomic) over exactly the rows the dry run
 * counts, so a re-run finds none: idempotent. `--business=<id>` (repeatable)
 * limits a run to the rows whose contact or definition belongs to one of
 * those businesses. It prints COUNTS ONLY (never an id, a name or a value),
 * and on a failure only the error's class and code, never the database's
 * message (it can echo values).
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm cleanup:custom-field-values                     # dry run: counts only
 *   pnpm cleanup:custom-field-values --business=<id>     # dry run for one business
 *   pnpm cleanup:custom-field-values --apply             # delete them
 *
 * Exit status: 0 done, 1 the database read or delete failed, 2 bad arguments.
 * Runbook: docs/development/operator-data-cleanup-scripts.md.
 */
import { db } from '@keyflow/db';

type Db = Pick<typeof db, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export interface CrossTenantValueCounts {
  /** Value rows whose contact and definition belong to different businesses. */
  crossBoundValues: number;
  /** The distinct contacts those rows hang on. */
  contactsAffected: number;
  /** The distinct businesses those rows touch (the contacts' and the definitions'). */
  businessesAffected: number;
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
 * The rows: a value whose contact and definition belong to different
 * businesses (`v`, `c`, `d`), limited, when `scoped` (the business ids bound
 * as $1), to rows whose contact or definition belongs to one of them.
 */
function crossBoundPredicate(scoped: boolean): string {
  return (
    'v.contact_id = c.id AND v.definition_id = d.id AND c.business_id <> d.business_id' +
    (scoped ? ' AND (c.business_id = ANY($1::text[]) OR d.business_id = ANY($1::text[]))' : '')
  );
}

export async function countCrossTenantValues(database: Db, businessIds: string[] = []): Promise<CrossTenantValueCounts> {
  const scoped = businessIds.length > 0;
  const rows = (await database.$queryRawUnsafe(
    `WITH cross_bound AS (
       SELECT v.contact_id, c.business_id AS contact_business, d.business_id AS definition_business
         FROM contact_custom_field_values v, contacts c, custom_field_definitions d
        WHERE ${crossBoundPredicate(scoped)}
     )
     SELECT (SELECT count(*)::int FROM cross_bound) AS n_values,
            (SELECT count(DISTINCT contact_id)::int FROM cross_bound) AS n_contacts,
            (SELECT count(*)::int FROM (
               SELECT contact_business FROM cross_bound UNION SELECT definition_business FROM cross_bound
             ) b) AS n_businesses`,
    ...(scoped ? [businessIds] : []),
  )) as Array<{ n_values: number; n_contacts: number; n_businesses: number }>;
  const counts = rows[0] ?? { n_values: 0, n_contacts: 0, n_businesses: 0 };
  return { crossBoundValues: counts.n_values, contactsAffected: counts.n_contacts, businessesAffected: counts.n_businesses };
}

/** Deletes the rows countCrossTenantValues counts, in one statement. Returns how many it deleted. */
export async function deleteCrossTenantValues(database: Db, businessIds: string[] = []): Promise<number> {
  const scoped = businessIds.length > 0;
  return database.$executeRawUnsafe(
    `DELETE FROM contact_custom_field_values v USING contacts c, custom_field_definitions d WHERE ${crossBoundPredicate(scoped)}`,
    ...(scoped ? [businessIds] : []),
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
    error(`Bad arguments (${args.error}). Usage: cleanup-cross-tenant-custom-field-values [--apply] [--business=<id> ...]`);
    return 2;
  }
  const database = deps.db ?? db;
  const scope = args.businessIds.length > 0 ? ` (limited to ${args.businessIds.length} business(es))` : ' (every business)';
  log(
    args.apply
      ? `Cross-tenant custom-field values (SF-1) - APPLY: deleting them${scope}`
      : `Cross-tenant custom-field values (SF-1) - DRY RUN: nothing is deleted; re-run with --apply to delete${scope}`,
  );

  let counts: CrossTenantValueCounts;
  try {
    counts = await countCrossTenantValues(database, args.businessIds);
  } catch (err: unknown) {
    error(`The rows could not be counted: ${describeFailure(err)}. Nothing was deleted.`);
    return 1;
  }
  log(row('cross_bound_values', counts.crossBoundValues));
  log(row('contacts_affected', counts.contactsAffected));
  log(row('businesses_affected', counts.businessesAffected));
  if (!args.apply) return 0;

  try {
    const deleted = await deleteCrossTenantValues(database, args.businessIds);
    log(row('deleted', deleted));
  } catch (err: unknown) {
    error(`The delete failed: ${describeFailure(err)}. It is one statement, so nothing was deleted; re-run to retry.`);
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
      console.error(`Cross-tenant custom-field cleanup failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
