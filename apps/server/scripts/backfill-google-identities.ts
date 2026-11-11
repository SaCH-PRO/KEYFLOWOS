#!/usr/bin/env tsx
/**
 * Backfill UserIdentity (Google sub -> local user) from GoTrue's admin user records.
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
 *     page by page, through SupabaseAdminService.listUsersPage, ONLY to
 *     enumerate the user ids. GoTrue does not load identities on the list
 *     (supabase/auth models.FindUsersInAudience queries with no Eager(), so
 *     every listed user carries `identities: null`): review CR-W9IBS-1.
 *   - Each listed user's RECORD (GET /auth/v1/admin/users/{id}, through
 *     SupabaseAdminService.getUserRecord), which GoTrue reads with
 *     models.findUser, identities eager-loaded: the record bootstrap reads
 *     (IdentityController.verifiedProviderIdentities). A record whose
 *     `identities` is not a list (not loaded), or that names another id,
 *     stops the run with exit 1: it is never read as 'no Google identity'.
 *   - From each record, only `identities[]` entries with provider `google`
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
 *   - Then (review SEC-W9IBS-1) it COUNTS the session-ending RISC events that
 *     arrived before the sub was mapped: rows of `risc_events` with no user
 *     and action `no_matching_user`, of a type RiscService ends sessions for,
 *     whose Google sub now resolves through `user_identities` (in a dry run:
 *     or would after --apply). Google answered those 202 and does not send
 *     them again, and this script does not replay them, so no sign-in cutoff
 *     was applied for them: the operator acts on those accounts by hand
 *     (docs/development/risc-setup.md).
 *
 * WHAT IT SKIPS (counted, never written)
 *
 *   - a GoTrue user with no google identity (email/password, phone, ...);
 *   - a GoTrue user with no local User row (never bootstrapped here);
 *   - a sub already mapped to the same user (nothing to do);
 *   - a sub already mapped to a DIFFERENT local user (a conflict): the
 *     existing row is never re-pointed, also when another writer creates it
 *     between this script's read and its write (review SEC-W9IBS-2). Bootstrap
 *     re-points it on that user's next Google sign-in; an operator decides
 *     before then.
 *
 * SAFETY
 *
 * Dry run by default: it reads and counts, and writes nothing unless `--apply`
 * is passed. The write is an upsert whose update is empty, so a re-run, or a
 * row bootstrap wrote meanwhile, converges instead of duplicating or
 * re-pointing: idempotent. It prints COUNTS ONLY — never an email, a Google
 * sub, a user id or a key — and on a failure only the error's class and its
 * status or code, never the provider's or the database's message (Prisma
 * messages echo query arguments). A GoTrue page or user record that fails
 * stops the walk with exit 1; it is never read as the end of the list or as a
 * user without a Google identity. Rows written before the failure stay (each
 * is correct on its own); re-run to finish. It makes one GoTrue request per
 * listed user, one after another.
 *
 * Usage (from apps/server; reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * DATABASE_URL from the repo-root .env):
 *   pnpm backfill:google-identities           # dry run: counts only, writes nothing
 *   pnpm backfill:google-identities --apply   # write the missing rows
 *
 * Exit status: 0 done, 1 a GoTrue read, a write or the RISC event count
 * failed, 2 bad arguments or the GoTrue admin client is not configured.
 */
import { db } from '@keyflow/db';
import { SupabaseAdminService } from '../src/core/auth/supabase-admin.service';
import { RISC_DISABLED_REASON, RISC_EVENT_TYPES } from '../src/modules/risc/risc.types';
import { endsSessions } from '../src/modules/risc/risc.service';

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

/** GoTrue's admin user list (to enumerate ids) and user record (identities loaded): SupabaseAdminService. */
export interface GoTrueUserSource {
  listUsersPage(page: number, perPage: number): Promise<GoTrueUser[]>;
  getUserRecord(userId: string): Promise<GoTrueUser>;
}

type Db = Pick<typeof db, 'user' | 'userIdentity' | 'riscEvent'>;

export interface BackfillCounts {
  gotrueUsersScanned: number;
  gotruePagesRead: number;
  /** User records read (GET /auth/v1/admin/users/{id}): the identities come from these, never from the list. */
  gotrueUserRecordsRead: number;
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
  /**
   * SEC-W9IBS-1: session-ending RISC events stored as `no_matching_user`
   * whose Google sub now resolves to a user (a dry run: or would after
   * --apply). Nothing applied their cutoff. Null until counted.
   */
  unappliedRiscEvents: number | null;
  /** SEC-W9IBS-1: the distinct accounts those events belong to. Null until counted. */
  unappliedRiscAccounts: number | null;
}

/** GoTrue's default page size; it accepts up to 1000. */
export const DEFAULT_PER_PAGE = 200;

const PROVIDER = 'google';

/**
 * Rows per lookup: @keyflow/db caps every findMany at 1000 rows (its
 * default-take extension), and a Prisma `in` list binds one parameter per
 * value, so each lookup stays within both.
 */
const IN_CHUNK = 1000;

/**
 * The RISC event types RiscService can end sessions for, by its own
 * classification (endsSessions, imported from risc.service.ts: W10-RISC-RESET,
 * no copy): every type it ends sessions for with some reason (sessions-revoked,
 * tokens-revoked, token-revoked, and account-disabled, which needs reason
 * hijacking). A `no_matching_user` row of one of these is a cutoff that was
 * never applied when sessionEndingEvent says so for its stored reason.
 */
const SESSION_ENDING_EVENT_TYPES: readonly string[] = Object.values(RISC_EVENT_TYPES).filter((type) =>
  endsSessions(type, RISC_DISABLED_REASON.HIJACKING),
);

/** RiscService's endsSessions for a stored event: the reason it persisted on RiscEvent.payload. */
function sessionEndingEvent(eventType: string, payload: unknown): boolean {
  const reason = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as { reason?: unknown }).reason : undefined;
  return endsSessions(eventType, typeof reason === 'string' ? reason : undefined);
}

/** A stop the script itself names: its message carries no provider or database text, so it is printed. */
export class BackfillStopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillStopError';
  }
}

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

/** The error's class and its status or code: never its message (except the script's own stops). */
export function describeFailure(err: unknown): string {
  if (err instanceof BackfillStopError) return err.message;
  const name = err instanceof Error ? err.name : typeof err;
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  const parts = [typeof status === 'number' ? `status ${status}` : null, typeof code === 'string' ? `code ${code}` : null].filter(Boolean);
  return parts.length > 0 ? `${name} (${parts.join(', ')})` : name;
}

/**
 * The record of a listed user, identities loaded (CR-W9IBS-1). Throws when
 * GoTrue answers an error (SupabaseAdminService.getUserRecord), when the
 * record names another id, or when its identities are not a list: a record
 * like the list's (`identities: null`) is never read as 'no Google identity'.
 */
async function readUserRecord(admin: GoTrueUserSource, userId: string): Promise<GoTrueUser> {
  const record = await admin.getUserRecord(userId);
  if (!record || record.id !== userId) {
    throw new BackfillStopError('GoTrue returned a user record for another id');
  }
  if (!Array.isArray(record.identities)) {
    throw new BackfillStopError(
      "GoTrue user record has identities not loaded (not a list); its Google identity cannot be read, so it is not counted as having none",
    );
  }
  return record;
}

/**
 * Walk GoTrue's admin user list, read each user's record, and write (with
 * `apply`) the missing google UserIdentity rows; then count the RISC events
 * that arrived before their sub was mapped (SEC-W9IBS-1). Throws when a page
 * or a record cannot be read; `counts` then holds what was done before it.
 */
export async function backfillGoogleIdentities(opts: {
  admin: GoTrueUserSource;
  db: Db;
  apply: boolean;
  perPage?: number;
  counts?: BackfillCounts;
}): Promise<BackfillCounts> {
  const counts = opts.counts ?? emptyCounts();
  const pending = await walkGoTrue({ ...opts, counts });
  await countUnappliedRiscEvents(opts.db, pending, counts);
  return counts;
}

/**
 * The walk: every page of the list, every listed user's record, and the
 * writes. Returns, for a dry run, the sub -> user of each row --apply would
 * write. Throws when a page or a record cannot be read.
 */
async function walkGoTrue(opts: {
  admin: GoTrueUserSource;
  db: Db;
  apply: boolean;
  perPage?: number;
  counts: BackfillCounts;
}): Promise<Map<string, string>> {
  const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
  const counts = opts.counts;
  const seen = new Set<string>();
  const pending = new Map<string, string>();

  for (let page = 1; ; page++) {
    const users = await opts.admin.listUsersPage(page, perPage);
    counts.gotruePagesRead += 1;
    // A user can show up on two pages when users are created during the walk
    // (offset paging); each is handled once. A full page with no new user
    // means the listing is not advancing: stop rather than loop forever.
    const fresh = users.filter((u) => typeof u?.id === 'string' && u.id !== '' && !seen.has(u.id));
    if (users.length >= perPage && fresh.length === 0) {
      throw new BackfillStopError(`GoTrue page ${page} repeated only users already read; the listing is not advancing`);
    }
    for (const u of fresh) seen.add(u.id);
    counts.gotrueUsersScanned += fresh.length;
    // The listed users' identities are never read (null on a real GoTrue): each record is.
    const records: GoTrueUser[] = [];
    for (const u of fresh) {
      records.push(await readUserRecord(opts.admin, u.id));
      counts.gotrueUserRecordsRead += 1;
    }
    await backfillPage(records, opts.db, opts.apply, counts, pending);
    if (users.length < perPage) break;
  }
  return pending;
}

async function backfillPage(
  users: GoTrueUser[],
  database: Db,
  apply: boolean,
  counts: BackfillCounts,
  pending: Map<string, string>,
): Promise<void> {
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
      pending.set(c.sub, c.userId);
      continue;
    }
    try {
      // Bootstrap's row (IdentityService.persistUserIdentities), on the same
      // unique key. The update is empty: a row another writer created between
      // the read above and this write is kept as it is, never re-pointed to
      // this user, and counted as a conflict (review SEC-W9IBS-2).
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

/**
 * SEC-W9IBS-1: count the session-ending RISC events that matched no user
 * (stored with no user and action `no_matching_user`) and whose Google sub now
 * resolves through `user_identities`, or, in a dry run, would after --apply
 * (`pending`). Their cutoff was never applied, and Google does not send them
 * again. Counts only.
 */
async function countUnappliedRiscEvents(database: Db, pending: Map<string, string>, counts: BackfillCounts): Promise<void> {
  // @keyflow/db caps every findMany at IN_CHUNK rows (its default-take
  // extension), so the events are read in id order, IN_CHUNK at a time.
  const missed: { providerSubject: string }[] = [];
  for (let cursor: string | null = null; ; ) {
    const batch: { id: string; eventType: string; providerSubject: string; payload: unknown }[] = await database.riscEvent.findMany({
      where: {
        userId: null,
        actionTaken: 'no_matching_user',
        eventType: { in: [...SESSION_ENDING_EVENT_TYPES] },
      },
      select: { id: true, eventType: true, providerSubject: true, payload: true },
      orderBy: { id: 'asc' },
      take: IN_CHUNK,
      ...(cursor !== null ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const e of batch) if (sessionEndingEvent(e.eventType, e.payload)) missed.push(e);
    if (batch.length < IN_CHUNK) break;
    cursor = batch[batch.length - 1].id;
  }

  const subs = [...new Set(missed.map((e) => e.providerSubject))];
  const resolved = new Map<string, string>();
  for (let i = 0; i < subs.length; i += IN_CHUNK) {
    const rows = await database.userIdentity.findMany({
      where: { provider: PROVIDER, providerSubject: { in: subs.slice(i, i + IN_CHUNK) } },
      select: { providerSubject: true, userId: true },
    });
    for (const row of rows) resolved.set(row.providerSubject, row.userId);
  }
  for (const [sub, userId] of pending) if (!resolved.has(sub)) resolved.set(sub, userId);

  const accounts = new Set<string>();
  let events = 0;
  for (const e of missed) {
    const userId = resolved.get(e.providerSubject);
    if (userId === undefined) continue;
    events += 1;
    accounts.add(userId);
  }
  counts.unappliedRiscEvents = events;
  counts.unappliedRiscAccounts = accounts.size;
}

function emptyCounts(): BackfillCounts {
  return {
    gotrueUsersScanned: 0,
    gotruePagesRead: 0,
    gotrueUserRecordsRead: 0,
    googleIdentitiesFound: 0,
    usersWithoutGoogleIdentity: 0,
    skippedNoLocalUser: 0,
    alreadyMapped: 0,
    skippedConflictOtherUser: 0,
    wouldWrite: 0,
    written: 0,
    failed: 0,
    failedCodes: [],
    unappliedRiscEvents: null,
    unappliedRiscAccounts: null,
  };
}

/** The report: counts only. */
export function formatCounts(counts: BackfillCounts, apply: boolean): string[] {
  const row = (label: string, n: number) => `  ${label.padEnd(30)} ${n}`;
  const lines = [
    row('gotrue_users_scanned', counts.gotrueUsersScanned),
    row('gotrue_pages_read', counts.gotruePagesRead),
    row('gotrue_user_records_read', counts.gotrueUserRecordsRead),
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
  if (counts.unappliedRiscEvents !== null && counts.unappliedRiscAccounts !== null) {
    lines.push(row('unapplied_risc_events', counts.unappliedRiscEvents), row('unapplied_risc_accounts', counts.unappliedRiscAccounts));
    if (counts.unappliedRiscEvents > 0) {
      lines.push(
        `NOTE: ${counts.unappliedRiscAccounts} account(s) ${apply ? 'received' : 'will, after --apply, map'} ` +
          `${counts.unappliedRiscEvents} session-ending RISC event(s) that arrived before their Google identity was mapped ` +
          `(SEC-W9IBS-1). No sign-in cutoff was applied for them, Google does not send them again, and this script does not ` +
          `replay them: find and act on those accounts as docs/development/risc-setup.md describes ` +
          `("RISC events that arrived before the backfill").`,
      );
    }
  }
  return lines;
}

type Log = (...args: unknown[]) => void;

/**
 * The CLI. Returns the exit status. `deps` lets a test hand it a GoTrue client,
 * a database, a page size and a logger; by default it uses
 * SupabaseAdminService and @keyflow/db's client and prints to the console.
 */
export async function main(
  argv: string[],
  deps: { admin?: GoTrueUserSource & Partial<Pick<SupabaseAdminService, 'isConfigured' | 'describeMissingConfig'>>; db?: Db; perPage?: number; log?: Log; error?: Log } = {},
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
  const database = deps.db ?? db;
  let pending: Map<string, string>;
  try {
    pending = await walkGoTrue({ admin, db: database, apply, perPage: deps.perPage, counts });
  } catch (err: unknown) {
    error(`Stopped after ${counts.gotruePagesRead} page(s): ${describeFailure(err)}. The user list was not read to its end.`);
    if (apply) log(`  ${'written'.padEnd(30)} ${counts.written}`);
    return 1;
  }
  try {
    await countUnappliedRiscEvents(database, pending, counts);
  } catch (err: unknown) {
    // The walk (and any write) is done; only the SEC-W9IBS-1 count failed.
    for (const line of formatCounts(counts, apply)) log(line);
    error(`The unapplied RISC events could not be counted: ${describeFailure(err)}. Re-run to count them.`);
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
