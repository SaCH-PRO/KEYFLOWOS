#!/usr/bin/env tsx
/**
 * Backfill the missing OWNER Membership of every business whose distinguished
 * owner (Business.ownerId) holds no Membership there.
 *
 * WHY THIS EXISTS (owner ruling D-104, packet W10-OWNER-MEMBERSHIP)
 *
 * D-104: Membership is the single rule for business access. An owner recorded
 * only as Business.ownerId, with no Membership row, is refused everywhere, as
 * D-73 and ModuleScopeGuard already refused them; BusinessGuard
 * (userCanAccessBusiness), the tenant TenantInterceptor installs, workspace
 * discovery and the owner checks that admitted them by the ownerId arm are
 * aligned in the same packet. Businesses created before every constructor wrote
 * its founding OWNER Membership (KF-EXEC-TENANT-001) can still have an owner
 * recorded only as ownerId: run this script, dry run first, when that alignment
 * deploys, so those owners keep the access they have today.
 *
 * WHAT IT WRITES
 *
 * For each non-deleted business whose ownerId names a User row that holds no
 * Membership on that business: the row the identity bootstrap writes
 * (IdentityService.ensureBootstrapWorkspace, createBusiness), { userId: ownerId,
 * businessId, role: 'OWNER' } with the schema defaults (no permission scopes,
 * approval tier 0). Also when another member already holds OWNER there: the
 * ownerId owner is admitted today by the ownerId arm everywhere (BusinessGuard,
 * the D-11 owner checks), so the row keeps exactly the authority D-104 would
 * otherwise take away rather than minting any; those businesses are counted
 * (with_another_owner) so an operator can review them. FoundingMembershipService
 * (KF-EXEC-TENANT-001) still reports them as conflicting.
 *
 * WHAT IT SKIPS (counted, never written)
 *
 *   - an ownerId that already holds a Membership there, of any role (it has
 *     access under D-104 already; its role is never changed);
 *   - an ownerId that names no User row (or is empty): there is no one to grant
 *     anything to, and Membership.userId is a foreign key;
 *   - a soft-deleted business.
 *
 * SAFETY
 *
 * Dry run by default: it reads and counts, and writes nothing unless `--apply`
 * is passed. Each write is an insert that skips a row already present on
 * @@unique([userId, businessId]) (a concurrent bootstrap, or a second run), so it
 * never duplicates, never overwrites a role and is idempotent. It never deletes
 * a Membership and never edits Business.ownerId. It prints COUNTS ONLY: never a
 * business, user, name or email, and on a failure only the error's code or
 * class, never its message (Prisma messages echo query arguments). Businesses
 * are read in id order, a page at a time, with raw SQL (no tenant extension and
 * no default row cap applies).
 *
 * Usage (from apps/server; reads DATABASE_URL from the repo-root .env):
 *   pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts           # dry run: counts only
 *   pnpm exec tsx --env-file ../../.env scripts/backfill-owner-memberships.ts --apply   # write the missing rows
 *
 * Exit status: 0 done, 1 the scan or a write failed, 2 bad arguments.
 * docs/development/owner-membership-backfill.md is the operator note.
 */
import { db } from '@keyflow/db';

type Db = Pick<typeof db, '$queryRawUnsafe' | 'membership'>;

export interface OwnerMembershipBackfillCounts {
  /** Non-deleted businesses read. */
  businessesScanned: number;
  /** The ownerId user already holds a Membership there (any role): nothing to do. */
  ownerIsMember: number;
  /** The ownerId names a User holding no Membership there: the D-104 class this script writes. */
  missingOwnerMembership: number;
  /** Of missingOwnerMembership: another member already holds OWNER there (written too; for review). */
  withAnotherOwner: number;
  /** The ownerId names no User row (or is empty): never written. */
  skippedOwnerUnresolvable: number;
  /** Dry run: rows --apply would write. */
  wouldWrite: number;
  /** --apply: rows written. */
  written: number;
  /** --apply: rows found already present at write time (written meanwhile by another writer). */
  alreadyPresent: number;
  /** --apply: writes that failed. */
  failed: number;
  /** --apply: the error codes of the failed writes (never their messages). */
  failedCodes: string[];
}

/** Businesses per page. */
const PAGE = 500;

interface BusinessRow {
  businessId: string;
  ownerId: string;
  ownerResolves: boolean;
  ownerIsMember: boolean;
  hasOwnerMembership: boolean;
}

/**
 * One page of non-deleted businesses after `cursor`, in id order, with what the
 * classification needs. `businessIds` (tests) restricts the scan.
 */
async function readPage(database: Db, cursor: string | null, businessIds: readonly string[] | null): Promise<BusinessRow[]> {
  return database.$queryRawUnsafe<BusinessRow[]>(
    `SELECT b.id AS "businessId",
            b.owner_id AS "ownerId",
            EXISTS (SELECT 1 FROM users u WHERE u.id = b.owner_id) AS "ownerResolves",
            EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = b.id AND m.user_id = b.owner_id) AS "ownerIsMember",
            EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = b.id AND m.role = 'OWNER') AS "hasOwnerMembership"
       FROM businesses b
      WHERE b.deleted_at IS NULL
        AND ($1::text IS NULL OR b.id > $1::text)
        AND ($2::text[] IS NULL OR b.id = ANY($2::text[]))
      ORDER BY b.id
      LIMIT ${PAGE}`,
    cursor,
    businessIds ? [...businessIds] : null,
  );
}

function emptyCounts(): OwnerMembershipBackfillCounts {
  return {
    businessesScanned: 0,
    ownerIsMember: 0,
    missingOwnerMembership: 0,
    withAnotherOwner: 0,
    skippedOwnerUnresolvable: 0,
    wouldWrite: 0,
    written: 0,
    alreadyPresent: 0,
    failed: 0,
    failedCodes: [],
  };
}

/**
 * Classify every non-deleted business and (with `apply`) write the missing
 * OWNER Memberships. `businessIds` restricts the scan to those businesses: a
 * test hands it its own fixtures so it never writes into rows another suite
 * owns; the CLI passes none and scans the whole estate. Throws when a page
 * cannot be read; `counts` then holds what was done before it.
 */
export async function backfillOwnerMemberships(opts: {
  db?: Db;
  apply: boolean;
  businessIds?: readonly string[];
  counts?: OwnerMembershipBackfillCounts;
}): Promise<OwnerMembershipBackfillCounts> {
  const database = opts.db ?? db;
  const counts = opts.counts ?? emptyCounts();
  const scope = opts.businessIds ?? null;

  for (let cursor: string | null = null; ; ) {
    const page = await readPage(database, cursor, scope);
    if (page.length === 0) break;
    for (const row of page) {
      counts.businessesScanned += 1;
      if (!row.ownerId || !row.ownerResolves) {
        counts.skippedOwnerUnresolvable += 1;
        continue;
      }
      if (row.ownerIsMember) {
        counts.ownerIsMember += 1;
        continue;
      }
      counts.missingOwnerMembership += 1;
      if (row.hasOwnerMembership) counts.withAnotherOwner += 1;
      if (!opts.apply) {
        counts.wouldWrite += 1;
        continue;
      }
      try {
        // The bootstrap's row. skipDuplicates: a row another writer created since
        // the read is kept as it is (its role untouched) and counted, not
        // overwritten or duplicated.
        const { count } = await database.membership.createMany({
          data: [{ userId: row.ownerId, businessId: row.businessId, role: 'OWNER' }],
          skipDuplicates: true,
        });
        if (count === 1) counts.written += 1;
        else counts.alreadyPresent += 1;
      } catch (err: unknown) {
        counts.failed += 1;
        const code = (err as { code?: unknown } | null)?.code;
        const label = typeof code === 'string' ? code : err instanceof Error ? err.name : 'unknown';
        if (!counts.failedCodes.includes(label)) counts.failedCodes.push(label);
      }
    }
    cursor = page[page.length - 1].businessId;
  }
  return counts;
}

/** The report: counts only. */
export function formatCounts(counts: OwnerMembershipBackfillCounts, apply: boolean): string[] {
  const row = (label: string, n: number) => `  ${label.padEnd(30)} ${n}`;
  return [
    row('businesses_scanned', counts.businessesScanned),
    row('owner_is_member', counts.ownerIsMember),
    row('missing_owner_membership', counts.missingOwnerMembership),
    row('with_another_owner', counts.withAnotherOwner),
    row('skipped_owner_unresolvable', counts.skippedOwnerUnresolvable),
    ...(apply
      ? [
          row('written', counts.written),
          row('already_present', counts.alreadyPresent),
          row('failed', counts.failed) + (counts.failedCodes.length > 0 ? `  (${counts.failedCodes.join(', ')})` : ''),
        ]
      : [row('would_write', counts.wouldWrite)]),
  ];
}

/** The error's code or class: never its message. */
function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a database, the
 * businesses to scan and a logger; by default it uses @keyflow/db's client,
 * scans every business and prints to the console.
 */
export async function main(
  argv: string[],
  deps: { db?: Db; businessIds?: readonly string[]; log?: Log; error?: Log } = {},
): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;

  const unknown = argv.filter((a) => a !== '--apply');
  if (unknown.length > 0) {
    error(`Unknown argument(s): ${unknown.length}. Usage: backfill-owner-memberships [--apply]`);
    return 2;
  }
  const apply = argv.includes('--apply');

  log(
    apply
      ? 'Owner membership backfill (D-104) - APPLY: writing the missing OWNER memberships'
      : 'Owner membership backfill (D-104) - DRY RUN: nothing is written; re-run with --apply to write',
  );
  const counts = emptyCounts();
  try {
    await backfillOwnerMemberships({ db: deps.db, apply, businessIds: deps.businessIds, counts });
  } catch (err: unknown) {
    for (const line of formatCounts(counts, apply)) log(line);
    error(`Stopped after ${counts.businessesScanned} business(es): ${describeFailure(err)}. Re-run to finish (rows written stay; the run is idempotent).`);
    return 1;
  }
  for (const line of formatCounts(counts, apply)) log(line);
  return apply && counts.failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`Owner membership backfill failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
