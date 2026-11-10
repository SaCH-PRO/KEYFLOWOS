#!/usr/bin/env tsx
/**
 * Backfill UserIdentity (Google sub -> local user) from GoTrue's admin user list.
 *
 * WHY THIS EXISTS (owner ruling D-97, its residual SEC-W8RSC-3)
 *
 * RiscService.resolveUser maps the Google sub of a Cross-Account Protection
 * (RISC) event to a KeyFlowOS user only through the `user_identities` table.
 * POST /identity/bootstrap writes that row at every Google sign-in since
 * W8-RISC-SIGNIN-CUTOFF, from the VERIFIED provider record. An account whose
 * owner last signed in with Google before that deploy has no row, so a RISC
 * event for its sub matches no user (`no_matching_user`): no sign-in cutoff,
 * no session ended. This script writes the missing rows.
 *
 * WHAT IT READS AND WRITES
 *
 *   - GoTrue's admin user list (GET /auth/v1/admin/users, service-role key),
 *     page by page, through SupabaseAdminService.listUsersPage.
 *   - From each user, only `identities[]` entries with provider `google`
 *     (GoTrue writes those after verifying the provider's token): the Google
 *     sub is the identity's provider id (`id`), else `identity_data.sub`, the
 *     same rule bootstrap applies (IdentityService.persistUserIdentities). An
 *     identity naming another user (`user_id`) is ignored, as in bootstrap.
 *     NEVER `user_metadata`: the user can edit it at GoTrue, so a 'sub' found
 *     there could name someone else's Google account and redirect that
 *     person's hijacking revocation.
 *   - For each such identity of a GoTrue user that has a local User row with
 *     the same id: the row bootstrap writes, { userId, provider: 'google',
 *     providerSubject, email (identity_data.email, lower-cased, or null) },
 *     upserted on @@unique([provider, providerSubject]).
 *
 * WHAT IT SKIPS (counted, never written)
 *
 *   - a GoTrue user with no google identity (email/password, phone, ...);
 *   - a GoTrue user with no local User row (never bootstrapped here);
 *   - a sub already mapped to the same user (nothing to do);
 *   - a sub already mapped to a DIFFERENT local user (a conflict): the
 *     existing row is never re-pointed. Bootstrap re-points it on that user's
 *     next Google sign-in; an operator decides before then.
 *
 * SAFETY
 *
 * Dry run by default: it reads and counts, and writes nothing unless `--apply`
 * is passed. The write is an upsert whose update is empty, so a re-run, or a
 * row bootstrap wrote meanwhile, converges instead of duplicating or
 * re-pointing: idempotent. It prints COUNTS ONLY — never an email, a Google
 * sub, a user id or a key — and on a failure only the error's class and its
 * status or code, never the provider's or the database's message (Prisma
 * messages echo query arguments). A GoTrue page that fails stops the walk with
 * exit 1; it is never read as the end of the list. Rows written before the
 * failure stay (each is correct on its own); re-run to finish.
 *
 * Usage (from apps/server; reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * DATABASE_URL from the repo-root .env):
 *   pnpm backfill:google-identities           # dry run: counts only, writes nothing
 *   pnpm backfill:google-identities --apply   # write the missing rows
 *
 * Exit status: 0 done, 1 a GoTrue page or a write failed, 2 bad arguments or
 * the GoTrue admin client is not configured.
 */
import { db } from '@keyflow/db';
import { SupabaseAdminService } from '../src/core/auth/supabase-admin.service';

/** The parts of a GoTrue user this script reads. user_metadata is deliberately absent. */
export interface GoTrueIdentity {
  id?: string;
  user_id?: string;
  provider?: string;
  identity_data?: Record<string, unknown>;
}
export interface GoTrueUser {
  id: string;
  identities?: GoTrueIdentity[] | null;
}

/** One page of GoTrue's admin user list (SupabaseAdminService.listUsersPage). */
export interface GoTrueUserLister {
  listUsersPage(page: number, perPage: number): Promise<GoTrueUser[]>;
}

type Db = Pick<typeof db, 'user' | 'userIdentity'>;

export interface BackfillCounts {
  gotrueUsersScanned: number;
  gotruePagesRead: number;
  googleIdentitiesFound: number;
  usersWithoutGoogleIdentity: number;
  skippedNoLocalUser: number;
  alreadyMapped: number;
  skippedConflictOtherUser: number;
  /** Dry run: rows --apply would write. */
  wouldWrite: number;
  /** --apply: rows written. */
  written: number;
  /** --apply: writes that failed. */
  failed: number;
  /** --apply: the error codes of the failed writes (never their messages). */
  failedCodes: string[];
}

/** GoTrue's default page size; it accepts up to 1000. */
export const DEFAULT_PER_PAGE = 200;

const PROVIDER = 'google';

/** The Google sub of a google identity, by bootstrap's rule: the provider id, else identity_data.sub. */
function googleSubOf(user: GoTrueUser, identity: GoTrueIdentity): string | null {
  if ((identity.provider ?? '').trim().toLowerCase() !== PROVIDER) return null;
  if (identity.user_id && identity.user_id !== user.id) return null;
  const sub =
    (typeof identity.id === 'string' ? identity.id.trim() : '') ||
    (typeof identity.identity_data?.sub === 'string' ? identity.identity_data.sub.trim() : '');
  return sub || null;
}

function emailOf(identity: GoTrueIdentity): string | null {
  const email = identity.identity_data?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() || null : null;
}

/** The error's class and its status or code: never its message. */
export function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  const parts = [typeof status === 'number' ? `status ${status}` : null, typeof code === 'string' ? `code ${code}` : null].filter(Boolean);
  return parts.length > 0 ? `${name} (${parts.join(', ')})` : name;
}

/**
 * Walk GoTrue's admin user list and write (with `apply`) the missing google
 * UserIdentity rows. Throws when a page cannot be read; `counts` then holds
 * what was done before it.
 */
export async function backfillGoogleIdentities(opts: {
  admin: GoTrueUserLister;
  db: Db;
  apply: boolean;
  perPage?: number;
  counts?: BackfillCounts;
}): Promise<BackfillCounts> {
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
  const counts = opts.counts ?? emptyCounts();
  const seen = new Set<string>();

  for (let page = 1; ; page++) {
    const users = await opts.admin.listUsersPage(page, perPage);
    counts.gotruePagesRead += 1;
    // A user can show up on two pages when users are created during the walk
    // (offset paging); each is handled once. A full page with no new user
    // means the listing is not advancing: stop rather than loop forever.
    const fresh = users.filter((u) => typeof u?.id === 'string' && u.id !== '' && !seen.has(u.id));
    if (users.length >= perPage && fresh.length === 0) {
      throw new Error(`GoTrue page ${page} repeated only users already read; the listing is not advancing`);
    }
    for (const u of fresh) seen.add(u.id);
    counts.gotrueUsersScanned += fresh.length;
    await backfillPage(fresh, opts.db, opts.apply, counts);
    if (users.length < perPage) break;
  }
  return counts;
}

async function backfillPage(users: GoTrueUser[], database: Db, apply: boolean, counts: BackfillCounts): Promise<void> {
  const wanted: { userId: string; sub: string; email: string | null }[] = [];
  for (const user of users) {
    const subs = new Map<string, string | null>();
    for (const identity of user.identities ?? []) {
      const sub = googleSubOf(user, identity);
      if (sub && !subs.has(sub)) subs.set(sub, emailOf(identity));
    }
    if (subs.size === 0) {
      counts.usersWithoutGoogleIdentity += 1;
      continue;
    }
    counts.googleIdentitiesFound += subs.size;
    for (const [sub, email] of subs) wanted.push({ userId: user.id, sub, email });
  }
  if (wanted.length === 0) return;

  // A page is at most `perPage` (<= 1000) users, inside the client's default
  // findMany cap, so each lookup reads every matching row.
  const userIds = [...new Set(wanted.map((w) => w.userId))];
  const local = new Set(
    (await database.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })).map((u) => u.id),
  );
  counts.skippedNoLocalUser += userIds.filter((id) => !local.has(id)).length;

  const candidates = wanted.filter((w) => local.has(w.userId));
  if (candidates.length === 0) return;
  const mapped = new Map(
    (
      await database.userIdentity.findMany({
        where: { provider: PROVIDER, providerSubject: { in: candidates.map((c) => c.sub) } },
        select: { providerSubject: true, userId: true },
      })
    ).map((row) => [row.providerSubject, row.userId]),
  );

  for (const c of candidates) {
    const holder = mapped.get(c.sub);
    if (holder === c.userId) {
      counts.alreadyMapped += 1;
      continue;
    }
    if (holder !== undefined) {
      counts.skippedConflictOtherUser += 1;
      continue;
    }
    if (!apply) {
      counts.wouldWrite += 1;
      continue;
    }
    try {
      // Bootstrap's row (IdentityService.persistUserIdentities), on the same
      // unique key. The update is empty: a row another writer created
      // meanwhile is kept as it is, never re-pointed to this user.
      const row = await database.userIdentity.upsert({
        where: { provider_providerSubject: { provider: PROVIDER, providerSubject: c.sub } },
        create: { userId: c.userId, provider: PROVIDER, providerSubject: c.sub, email: c.email },
        update: {},
        select: { userId: true },
      });
      if (row.userId === c.userId) counts.written += 1;
      else counts.skippedConflictOtherUser += 1;
    } catch (err: unknown) {
      counts.failed += 1;
      const code = (err as { code?: unknown } | null)?.code;
      const label = typeof code === 'string' ? code : err instanceof Error ? err.name : 'unknown';
      if (!counts.failedCodes.includes(label)) counts.failedCodes.push(label);
    }
  }
}

function emptyCounts(): BackfillCounts {
  return {
    gotrueUsersScanned: 0,
    gotruePagesRead: 0,
    googleIdentitiesFound: 0,
    usersWithoutGoogleIdentity: 0,
    skippedNoLocalUser: 0,
    alreadyMapped: 0,
    skippedConflictOtherUser: 0,
    wouldWrite: 0,
    written: 0,
    failed: 0,
    failedCodes: [],
  };
}

/** The report: counts only. */
export function formatCounts(counts: BackfillCounts, apply: boolean): string[] {
  const row = (label: string, n: number) => `  ${label.padEnd(30)} ${n}`;
  return [
    row('gotrue_users_scanned', counts.gotrueUsersScanned),
    row('gotrue_pages_read', counts.gotruePagesRead),
    row('google_identities_found', counts.googleIdentitiesFound),
    row('users_without_google_identity', counts.usersWithoutGoogleIdentity),
    row('skipped_no_local_user', counts.skippedNoLocalUser),
    row('already_mapped', counts.alreadyMapped),
    row('skipped_conflict_other_user', counts.skippedConflictOtherUser),
    ...(apply
      ? [
          row('written', counts.written),
          row('failed', counts.failed) + (counts.failedCodes.length > 0 ? `  (${counts.failedCodes.join(', ')})` : ''),
        ]
      : [row('would_write', counts.wouldWrite)]),
  ];
}

type Log = (...args: unknown[]) => void;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a GoTrue client,
 * a database, a page size and a logger; by default it uses
 * SupabaseAdminService and @keyflow/db's client and prints to the console.
 */
export async function main(
  argv: string[],
  deps: { admin?: GoTrueUserLister & Partial<Pick<SupabaseAdminService, 'isConfigured' | 'describeMissingConfig'>>; db?: Db; perPage?: number; log?: Log; error?: Log } = {},
): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;

  const unknown = argv.filter((a) => a !== '--apply');
  if (unknown.length > 0) {
    error(`Unknown argument(s): ${unknown.length}. Usage: backfill-google-identities [--apply]`);
    return 2;
  }
  const apply = argv.includes('--apply');

  const admin = deps.admin ?? new SupabaseAdminService();
  if (admin.isConfigured && !admin.isConfigured()) {
    error(`GoTrue admin client not configured: set ${admin.describeMissingConfig?.() ?? 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'}.`);
    return 2;
  }

  log(
    apply
      ? 'Google identity backfill (SEC-W8RSC-3) - APPLY: writing missing UserIdentity rows'
      : 'Google identity backfill (SEC-W8RSC-3) - DRY RUN: nothing is written; re-run with --apply to write',
  );
  const counts = emptyCounts();
  try {
    await backfillGoogleIdentities({ admin, db: deps.db ?? db, apply, perPage: deps.perPage, counts });
  } catch (err: unknown) {
    error(`Stopped after ${counts.gotruePagesRead} page(s): ${describeFailure(err)}. The user list was not read to its end.`);
    if (apply) log(`  ${'written'.padEnd(30)} ${counts.written}`);
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
          console.error(`Google identity backfill failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
