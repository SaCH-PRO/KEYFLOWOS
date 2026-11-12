/**
 * W10-OWNER-MEMBERSHIP (owner ruling D-104) — membership is the one rule for
 * business access, and an operator backfill writes the missing OWNER rows.
 * REAL database.
 *
 * D-104: an owner recorded only as Business.ownerId, with no Membership row, is
 * refused everywhere (as D-73 and ModuleScopeGuard already did); an operator
 * script, dry-run by default, creates the missing OWNER membership for such
 * owners, and the guards that admitted them are aligned. Before this packet
 * BusinessGuard's predicate (userCanAccessBusiness, core/auth/business.guard.ts)
 * admitted `ownerId = caller OR a Membership`, and so did the tenant TenantInterceptor
 * installs on an AuthGuard-only route (verifiedTenantBusinessId) and workspace
 * discovery (IdentityService.listBusinesses).
 *
 *   OMB-01  RED-BEFORE: BusinessGuard refuses the ownerId-only owner 403 'No
 *           access to this business' before the handler runs (was: 200).
 *   OMB-02  RED-BEFORE: TenantInterceptor installs no tenant for that owner on
 *           an AuthGuard-only route that names the business (was: the business).
 *   OMB-03  RED-BEFORE: workspace discovery does not list the business (was:
 *           listed by the ownerId arm).
 *   OMB-04  control: the OWNER and STAFF members are admitted and scoped; a user
 *           with no Membership is refused.
 *   OMB-05  RED by absence: apps/server/scripts/backfill-owner-memberships.ts
 *           dry run counts the missing OWNER rows, writes nothing, prints counts
 *           only (no id, name or email), exit 0; an unknown argument exits 2.
 *   OMB-06  --apply writes exactly the missing OWNER rows of the plain class, in
 *           the row shape the identity bootstrap writes for a business it
 *           creates ({ userId: ownerId, businessId, role 'OWNER' }, no scopes,
 *           tier 0), each with one TeamActivityLog audit row in the same
 *           transaction. Review SEC-W10OM-2: a business where another member
 *           already holds OWNER (with_another_owner) is counted and NOT written
 *           by default (the OWNER may have removed the ownerId user). It writes
 *           nothing for an ownerId that is already a member (any role), names no
 *           User, or a soft-deleted business; it never edits ownerId or an
 *           existing Membership.
 *   OMB-07  idempotent: a second --apply writes nothing and changes nothing.
 *   OMB-08  after the reviewed run (--apply --include-conflicting) the owner is
 *           admitted by BusinessGuard, scoped by TenantInterceptor and listed by
 *           discovery; that grant is audited too.
 *   OMB-09  census pin: no business access predicate under apps/server/src
 *           admits Business.ownerId without a Membership, except the listed
 *           exceptions, one per site (reviews CR-W10OM-2, OMV-3): no OR mixing
 *           an ownerId arm and a members arm (either order, any values), no
 *           business read whose where names ownerId anywhere without a members
 *           filter, no `business: { ownerId }` relation filter without one
 *           (both also through a wrapping skipTenantIsolation(...); reviews
 *           OMV3-R1, OMV-R1), and no ownerId (on any receiver but a contact,
 *           indexed or parenthesised ones included, or destructured) compared
 *           to the caller (userId, actorId, user.id, ...), nor a
 *           business-named receiver's ownerId (business, biz,
 *           existingBusiness, rows.business, any *Business) compared with any
 *           value but null/undefined or under typeof (review SEAMZ4-SEC-1).
 *   OMB-10  review SEC-W10OM-3: POST /identity/bootstrap (bootstrapUser) writes
 *           no Membership on a business it did not create: the ownerId-only
 *           owner is refused 403 OWNER_MEMBERSHIP_REQUIRED and stays refused.
 *   OMB-11  review SEC-W10OM-3: a Business.ownerId holding STAFF who signs in
 *           keeps STAFF (the bootstrap no longer promotes to OWNER).
 *   OMB-12  review SEC-W10OM-2: an OWNER removes the Business.ownerId member;
 *           the default backfill does not re-admit them, and --list-conflicting
 *           names that business (ids only) for review.
 *   OMB-13  review SEC-W10OM-6: mail addressed to the business owner (weekly
 *           financial briefing, quote alerts, AI usage alerts) reaches the
 *           Business.ownerId user only while they hold a Membership.
 *   OMB-14  review OMV-2 (a sign-in lockout): a caller a co-owner removed from
 *           their oldest owned business, who is OWNER of a newer one and STAFF
 *           of another, signs in: the bootstrap answers the oldest owned
 *           business they are a member of (was: 403 OWNER_MEMBERSHIP_REQUIRED),
 *           writes nothing and re-admits them nowhere.
 *   OMB-15  review OMV-2: a caller recorded as Business.ownerId only of a
 *           with_another_owner business (the class the backfill skips by
 *           default), a member of none they own but STAFF and ADMIN elsewhere,
 *           signs in: the bootstrap answers the business of their oldest
 *           Membership on a live business, the same one each time, isNewBusiness
 *           false, nothing written (was: 403).
 *   OMB-16  control: a caller who owns no business (STAFF elsewhere) still gets
 *           their first workspace with its founding OWNER Membership, and a
 *           recorded owner who is a member nowhere live (a soft-deleted
 *           business's Membership does not count) is still refused 403.
 *   OMB-17  review OMV-3: the OMB-09 census patterns are not vacuous: each
 *           ownerId-as-authority shape is flagged on synthetic source, and each
 *           membership-carrying or non-business shape is not; reviews OMV3-R1,
 *           OMV-R1 add the skipTenantIsolation-wrapped reads and the indexed
 *           and parenthesised receivers; review SEAMZ4-SEC-1 restores the
 *           39e9be12 census's 'business ownerId compared' (a business-named
 *           receiver's ownerId compared, === or !==, with any value) and adds
 *           to that rule the loose operators (==, !=), more business-named
 *           receivers (*Business, getBusiness(id), parenthesised) on either
 *           side, and the exclusion of null, undefined and typeof checks
 *           (which the 39e9be12 rule flagged); reviews Z4-RV-CENSUS-SEC-1,
 *           Z4RV-CENSUS-1 read a receiver chain of any shape (optional or
 *           nested index and call, a chain broken over lines), as the
 *           39e9be12 rule's segment match did; one label per comparison.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * TenantInterceptor (global, as in production) and IdentityService.listBusinesses
 * run against DATABASE_URL. Two stand-ins: identity attachment (a test
 * middleware reads `x-v96c-user` and attaches the seeded user row's
 * `{ id, email, role }`, as AuthMiddleware does after token verification), and
 * the routes, two probe controllers declared here (one behind AuthGuard and
 * BusinessGuard, one behind AuthGuard only) that record the tenant they ran
 * under. IdentityService's Blueprint and default-trigger collaborators are inert
 * (listBusinesses touches neither).
 *
 * The script's CLI scans every business; the suite drives it through its
 * exported entry points with `businessIds` naming this suite's businesses only,
 * so it never writes into rows a concurrently running suite owns. The guard
 * fixture business also carries a second OWNER member: the founding-membership
 * repair other suites run estate-wide (tenant-founding-membership) skips such a
 * business, so it cannot heal this owner mid-run.
 *
 * Fixtures: prefix `v96c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in beforeAll and
 * afterAll, the workspace OMB-16's first sign-in creates (a generated id) by its
 * prefixed owner. No $transaction wrapping. Every OMB-14..16 business whose
 * ownerId holds no Membership also has another OWNER member, so the estate-wide
 * founding-membership repair cannot heal it mid-run.
 */
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v96c_';
const HEADER = 'x-v96c-user';

const ID = {
  /** Business.ownerId of bizGuard, no Membership row: the D-104 subject. */
  distOwner: `${P}distOwner`,
  /** OWNER member of bizGuard (not ownerId). */
  coOwner: `${P}coOwner`,
  /** STAFF member of bizGuard. */
  staff: `${P}staff`,
  /** No Membership anywhere. */
  outsider: `${P}outsider`,
  /** ownerId of bizPlain, no Membership: the plain legacy shape. */
  plainOwner: `${P}plainOwner`,
  /** ownerId of bizExact, holds OWNER. */
  exactOwner: `${P}exactOwner`,
  /** ownerId of bizStaffOwner, holds STAFF only. */
  staffOwner: `${P}staffOwner`,
  /** ownerId of the soft-deleted bizDeleted, no Membership. */
  deletedOwner: `${P}deletedOwner`,
  /** An ownerId that names no User row. */
  ghost: `${P}ghost`,
  /** ownerId of bizRemoved, STAFF there until the co-owner removes them (OMB-12). */
  removedOwner: `${P}removedOwner`,
  bizGuard: `${P}bizGuard`,
  bizPlain: `${P}bizPlain`,
  bizExact: `${P}bizExact`,
  bizStaffOwner: `${P}bizStaffOwner`,
  bizGhost: `${P}bizGhost`,
  bizDeleted: `${P}bizDeleted`,
  /** OMB-12's own business, outside BUSINESSES: the co-owner removes its ownerId member. */
  bizRemoved: `${P}bizRemoved`,
  // OMB-14..16 (review OMV-2), outside BUSINESSES.
  /** OWNER of every OMB-14..16 business another user is recorded as owning. */
  bootCo: `${P}bootCo`,
  /** ownerId of bootOldest (removed by bootCo) and bootNewer (OWNER); STAFF of bootStaffX. */
  bootRemoved: `${P}bootRemoved`,
  /** ownerId of bootOwnedY only (with_another_owner); STAFF, ADMIN elsewhere. */
  bootFallback: `${P}bootFallback`,
  /** Owns nothing; STAFF of bootStaffX. */
  bootFirst: `${P}bootFirst`,
  /** ownerId of bootNowhere; member only of the soft-deleted bootDeletedY. */
  bootNowhereUser: `${P}bootNowhereUser`,
  bootOldest: `${P}bootOldest`,
  bootNewer: `${P}bootNewer`,
  bootStaffX: `${P}bootStaffX`,
  bootOwnedY: `${P}bootOwnedY`,
  bootDeletedY: `${P}bootDeletedY`,
  bootStaffY: `${P}bootStaffY`,
  bootAdminY: `${P}bootAdminY`,
  bootNowhere: `${P}bootNowhere`,
};

/** OMB-14..16's users and businesses. */
const BOOT_USERS = [ID.bootCo, ID.bootRemoved, ID.bootFallback, ID.bootFirst, ID.bootNowhereUser];
const BOOT_BUSINESSES = [ID.bootOldest, ID.bootNewer, ID.bootStaffX, ID.bootOwnedY, ID.bootDeletedY, ID.bootStaffY, ID.bootAdminY, ID.bootNowhere];

/** Every business of this suite: the backfill is scoped to exactly these. */
const BUSINESSES = [ID.bizGuard, ID.bizPlain, ID.bizExact, ID.bizStaffOwner, ID.bizGhost, ID.bizDeleted];

let db: any;
let app: any;
let identity: any;
let prismaSvc: any;
/** Handler runs of the guarded probe since the last reset. */
const runs: Array<{ businessId: string; tenant: string | null }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    // OMB-16's first sign-in creates a workspace with a generated id, owned by a fixture user.
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function probe(as: string, businessId = ID.bizGuard) {
  return request(app.getHttpServer()).get(`/v96c/businesses/${businessId}/probe`).set(HEADER, as);
}

function open(as: string, businessId = ID.bizGuard) {
  return request(app.getHttpServer()).get(`/v96c/open?businessId=${encodeURIComponent(businessId)}`).set(HEADER, as);
}

/** The operator script under test (absent before this packet: RED by absence). */
async function script(): Promise<{
  main: (argv: string[], deps?: Record<string, unknown>) => Promise<number>;
  backfillOwnerMemberships: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
}> {
  return import('../scripts/backfill-owner-memberships');
}

/** Run the CLI entry on this suite's businesses; returns the exit code and everything it printed. */
async function run(argv: string[]) {
  const { main } = await script();
  const lines: string[] = [];
  const log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  const code = await main(argv, { db, log, error: log, businessIds: BUSINESSES });
  return { code, out: lines.join('\n') };
}

/** Every Membership on this suite's businesses, in a stable order, with the columns bootstrap sets. */
async function memberships() {
  return db.membership.findMany({
    where: { businessId: { in: BUSINESSES } },
    select: { id: true, userId: true, businessId: true, role: true, permissionScopes: true, maxApprovalTier: true },
    orderBy: [{ businessId: 'asc' }, { userId: 'asc' }],
  });
}

/** The backfill's audit rows on `businessIds`, in a stable order. */
async function grantAudits(businessIds: readonly string[] = BUSINESSES) {
  return db.teamActivityLog.findMany({
    where: { businessId: { in: [...businessIds] }, action: 'owner_membership_backfilled' },
    select: { businessId: true, userId: true, module: true, entityType: true, entityId: true, meta: true },
    orderBy: [{ businessId: 'asc' }, { userId: 'asc' }],
  });
}

async function ownerIds() {
  return db.business.findMany({
    where: { id: { in: BUSINESSES } },
    select: { id: true, ownerId: true },
    orderBy: { id: 'asc' },
  });
}

/** Nothing printed names a fixture: counts only. */
function expectCountsOnly(out: string) {
  expect(out).not.toContain(P);
  expect(out).not.toMatch(/@/);
}

/** Every Membership of OMB-14..16's users or on their businesses, in a stable order. */
async function bootMemberships() {
  return db.membership.findMany({
    where: { OR: [{ userId: { in: BOOT_USERS } }, { businessId: { in: BOOT_BUSINESSES } }] },
    select: { id: true, userId: true, businessId: true, role: true, permissionScopes: true, maxApprovalTier: true },
    orderBy: [{ businessId: 'asc' }, { userId: 'asc' }],
  });
}

/** The bootstrap's refusal, or null when it answered. */
async function bootstrapError(userId: string) {
  return identity.bootstrapUser({ userId, email: `${P}${userId.slice(P.length)}@test.local` }).then(
    () => null,
    (e: unknown) => e,
  );
}

/**
 * OMB-09's census (reviews CR-W10OM-2, OMV-3): the ownerId-as-authority shapes
 * found in whitespace-normalised source, one label per site. OMB-17 runs it on
 * synthetic source so it cannot go vacuous.
 *
 *   'ownerId OR members': an `OR: [...]` holding an ownerId arm and a members
 *     arm, in either order, whatever the values or the other keys.
 *   'business read on ownerId without membership': a business read
 *     (findUnique, findFirst, findMany, count, ...) whose top-level `where`
 *     names ownerId anywhere and no `members` filter.
 *   'business relation on ownerId without membership': any read whose `where`
 *     filters a `business: { ... }` relation on ownerId without `members`.
 *     For both read rules the `where` is the call argument's, or that of the
 *     call wrapping it (`findFirst(skipTenantIsolation({ where }))`, the
 *     cross-tenant idiom; reviews OMV3-R1, OMV-R1).
 *   'ownerId compared to the caller': `<receiver>.ownerId` or a bare
 *     (destructured, handed-in) `ownerId` compared (===, !==, ==, !=) with the
 *     caller (userId, actorId, user.id, req.user?.id, rows.userId, ...), either
 *     side. The receiver is any member chain (chainBefore): it may index or
 *     call at any depth (rows[0], rows?.[0], byId[ids[0]], load(id),
 *     resolve?.(id), get(toId(String(id)))), be parenthesised
 *     ((await load(id))), and break over lines (a space before a dot). A
 *     receiver named `contact`/`contacts`/`...Contact` is a Contact's owner,
 *     not Business.ownerId, and is not counted.
 *   'business ownerId compared' (review SEAMZ4-SEC-1; the 39e9be12 census's
 *     receiver arm, kept beside the caller one): a business-named receiver's
 *     ownerId compared (===, !==, ==, !=) with any value but null, undefined
 *     or under a typeof check, either side: whoever the other side names
 *     (authUser.id, uid, sub, principal.id, session.sub, input.ownerUserId,
 *     id, ...), the comparison decides on ownerId. Business-named: the
 *     receiver's last name is `biz` (or ends in `$biz`) or ends in `Biz`,
 *     `business`, `Business` or `businesses`/`Businesses` (business,
 *     existingBusiness, rows.business, this.business, businesses[0],
 *     getBusiness(id)), whatever the chain before it (reviews
 *     Z4-RV-CENSUS-SEC-1, Z4RV-CENSUS-1: memberships?.[0]?.business,
 *     byId[ids[0]].business, (await load(String(id))).business, as the
 *     39e9be12 census's segment match read them); a wholly parenthesised
 *     receiver is named by its inside, with `await`, a trailing `!` and an
 *     `as T` / `satisfies T` dropped ((await loadBusiness(id)),
 *     (business as Business)), and a read on a business delegate counts
 *     ((await tx.business.findUnique(...))).
 *   One label per comparison (the operator's offset): a comparison the caller
 *   rule labels is not labelled again, and two business owners compared with
 *   each other are one site.
 */
const CALLER = String.raw`(?:[\w$]+(?:\?\.|!\.|\.))*(?:(?:userId|actorId|actorUserId|callerId|requesterId|viewerId|currentUserId|memberId|actor)\b|(?:user|actor|caller|requester|viewer|currentUser|me)!?(?:\?\.|\.)id\b)`;
const OP = String.raw`[!=]==?`;
/** Null or undefined as a whole operand (not nullOwner, undefinedId). */
const NULLISH = String.raw`(?:null|undefined)(?![\w$])`;
/** `.ownerId` (or `?.`, `!.`; a space before the dot allowed): its receiver ends where the match begins. */
const MEMBER_OWNER_ID = /\s?(?:\?\.|!\.|\.)ownerId(?![\w$])/g;
/** How far either side of a comparison the operand checks read. */
const OPERAND_WINDOW = 256;
/** After `ownerId`: the operator (offset = ws length), then the caller, or any non-nullish value. */
const CALLER_AFTER = new RegExp(String.raw`^(?<ws>\s*)${OP}\s*${CALLER}`);
const VALUE_AFTER = new RegExp(String.raw`^(?<ws>\s*)${OP}(?!=)(?!\s*${NULLISH})`);
/** Before a receiver chain: the operator, then (before it) the caller, or a nullish operand. */
const OPERATOR_BEFORE = new RegExp(String.raw`(?<![!=])${OP}\s*$`);
const CALLER_BEFORE = new RegExp(String.raw`(?<![\w$.])${CALLER}\s*$`);
const NULLISH_BEFORE = new RegExp(String.raw`(?<![\w$])${NULLISH}\s*$`);
/** A bare (destructured, handed-in) ownerId against the caller, either side; `lhs` ends at the operator. */
const BARE_COMPARED: RegExp[] = [
  new RegExp(String.raw`(?<![\w$.])(?<lhs>ownerId\s*)${OP}\s*${CALLER}`, 'g'),
  new RegExp(String.raw`(?<![\w$.])(?<lhs>${CALLER}\s*)${OP}\s*ownerId(?![\w$])`, 'g'),
];
const READS = String.raw`(?:findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|count|aggregate|groupBy)`;
const READ_NAME = new RegExp(String.raw`^${READS}$`);
const BUSINESS_NAME = /^(?:(?:[\w$]*\$)?biz|[\w$]*(?:Biz|[bB]usiness(?:es)?))$/;

/**
 * The member chain that ends at text[end - 1] (a receiver), read backwards
 * (reviews Z4-RV-CENSUS-SEC-1, Z4RV-CENSUS-1): names joined by `.`, `?.` or
 * `!.` (a space before the dot allowed: a chain prettier broke over lines),
 * index and call groups at any depth (`?.[..]` and `?.(..)` too), postfix `!`,
 * and a parenthesised head. Its elements, last first: where each starts and
 * its name ('' for the parenthesised head). Empty when no chain ends there.
 */
function chainBefore(text: string, end: number): Array<{ start: number; name: string }> {
  const elements: Array<{ start: number; name: string }> = [];
  let i = end;
  for (;;) {
    const elementEnd = i;
    let name = '';
    for (;;) {
      const c = text[i - 1] ?? '';
      if (c === '!' && /[\w$)\]]/.test(text[i - 2] ?? '')) {
        i--; // a postfix (non-null) `!`, not a negation
      } else if (c === ')' || c === ']') {
        const open = openerOf(text, i - 1);
        if (open < 0) break;
        i = open;
        if (text.slice(i - 2, i) === '?.') i -= 2; // an optional call or index
        else if (!/[\w$)\]!]/.test(text[i - 1] ?? '')) break; // the parenthesised head
      } else {
        const nameEnd = i;
        while (/[\w$]/.test(text[i - 1] ?? '')) i--;
        name = text.slice(i, nameEnd);
        break;
      }
    }
    if (i === elementEnd) break;
    elements.push({ start: i, name });
    // The dot joining this element to the one before it.
    let k = i;
    if (!name || text[k - 1] !== '.') break;
    k--;
    if (text[k - 1] === '?') k--;
    if (text[k - 1] === ' ') k--;
    if (!/[\w$)\]!]/.test(text[k - 1] ?? '')) break;
    i = k;
  }
  return elements;
}

/** The '(', '[' or '{' that the bracket at text[close] closes, brackets balanced; -1 if none. */
function openerOf(text: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = text[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if ((c === '(' || c === '[' || c === '{') && --depth === 0) return i;
  }
  return -1;
}

/**
 * Whether a comparison's receiver chain names a business (reviews
 * SEAMZ4-SEC-1, Z4-RV-CENSUS-SEC-1, Z4RV-CENSUS-1): its last element's name
 * (index and call groups dropped), or a read on a business delegate; a wholly
 * parenthesised receiver by its inside (await, a trailing `!` and `as T` /
 * `satisfies T` dropped).
 */
function businessReceiver(recv: string): boolean {
  const elements = chainBefore(recv, recv.length);
  if (!elements.length || elements[elements.length - 1].start !== 0) return false;
  const [last, previous] = elements;
  if (last.name) return BUSINESS_NAME.test(last.name) || (READ_NAME.test(last.name) && BUSINESS_NAME.test(previous?.name ?? ''));
  const inner = bracketGroup(recv, last.start)
    .slice(1, -1)
    .trim()
    .replace(/^await\s+/, '')
    // A trailing `as T` / `satisfies T` (unions and generics included; T holds no parens).
    .replace(/\s+(?:as|satisfies)\s+[^()]*$/, '')
    .replace(/!$/, '');
  return businessReceiver(inner);
}

/** The comparison operator just before text[start] (a receiver chain's head), and the operand text before it. */
function operatorBefore(text: string, start: number): { op: number; operand: string } | null {
  const from = Math.max(0, start - OPERAND_WINDOW);
  const before = text.slice(from, start);
  const m = OPERATOR_BEFORE.exec(before);
  return m ? { op: from + m.index, operand: before.slice(0, m.index) } : null;
}

/** The offset of the operator that `re` (CALLER_AFTER or VALUE_AFTER) finds right after text[at], or -1. */
function operatorAfter(text: string, at: number, re: RegExp): number {
  const m = re.exec(text.slice(at, at + OPERAND_WINDOW));
  return m ? at + (m.groups?.ws ?? '').length : -1;
}

/** The bracket group ('{', '[' or '(') that opens at text[start], brackets balanced. */
function bracketGroup(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if ((c === '}' || c === ']' || c === ')') && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** The object literal under `key:` at the top level of the call argument `args` ('(' ... ')'), or null. */
function topLevelObject(args: string, key: string): string | null {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 2 && !/[\w$]/.test(args[i - 1] ?? '')) {
      const m = new RegExp(String.raw`^${key}\s*:\s*\{`).exec(args.slice(i));
      if (m) return bracketGroup(args, i + m[0].length - 1);
    }
  }
  return null;
}

/**
 * The call argument `args` ('(' ... ')') with any wrapping call unwrapped:
 * `(skipTenantIsolation({ where }))` gives `({ where })`, so the where of a
 * cross-tenant read sits where topLevelObject looks (reviews OMV3-R1, OMV-R1).
 */
function unwrapCall(args: string): string {
  let inner = args;
  for (let m; (m = /^\(\s*[\w$]+(?:\s*\.\s*[\w$]+)*\s*\(/.exec(inner)); ) inner = bracketGroup(inner, m[0].length - 1);
  return inner;
}

function censusHits(source: string): string[] {
  const text = source.replace(/\s+/g, ' ');
  const hits: string[] = [];
  for (const m of text.matchAll(/\bOR\s*:\s*\[/g)) {
    const arms = bracketGroup(text, m.index! + m[0].length - 1);
    if (/\bownerId\b/.test(arms) && /\bmembers\b/.test(arms)) hits.push('ownerId OR members');
  }
  for (const m of text.matchAll(new RegExp(String.raw`(?<![\w$])(\w+)\s*\.\s*${READS}\s*\(`, 'g'))) {
    const where = topLevelObject(unwrapCall(bracketGroup(text, m.index! + m[0].length - 1)), 'where');
    if (!where) continue;
    if (m[1] === 'business' && /\bownerId\b/.test(where) && !/\bmembers\b/.test(where)) {
      hits.push('business read on ownerId without membership');
    }
    for (const rel of where.matchAll(/(?<![\w$])business\s*:\s*\{/g)) {
      const filter = bracketGroup(where, rel.index! + rel[0].length - 1);
      if (/\bownerId\b/.test(filter) && !/\bmembers\b/.test(filter)) hits.push('business relation on ownerId without membership');
    }
  }
  // One label per comparison, keyed by the operator's offset.
  const compared = new Set<number>();
  const label = (op: number, name: string) => {
    if (op < 0 || compared.has(op)) return;
    compared.add(op);
    hits.push(name);
  };
  // Each `<receiver>.ownerId`, its receiver read as a whole member chain.
  const members = [...text.matchAll(MEMBER_OWNER_ID)].flatMap((m) => {
    const elements = chainBefore(text, m.index!);
    if (!elements.length) return [];
    return [{ elements, start: elements[elements.length - 1].start, end: m.index!, after: m.index! + m[0].length }];
  });
  for (const { elements, start, after } of members) {
    // contacts[0], rows?.[0].contact: a Contact's owner.
    if (/contacts?$/i.test(elements[0].name)) continue;
    label(operatorAfter(text, after, CALLER_AFTER), 'ownerId compared to the caller');
    const before = operatorBefore(text, start);
    if (before && CALLER_BEFORE.test(before.operand)) label(before.op, 'ownerId compared to the caller');
  }
  for (const re of BARE_COMPARED) {
    for (const m of text.matchAll(re)) label(m.index! + (m.groups?.lhs ?? '').length, 'ownerId compared to the caller');
  }
  for (const { start, end, after } of members) {
    if (!businessReceiver(text.slice(start, end))) continue;
    if (!/(?<![\w$])typeof\s*$/.test(text.slice(Math.max(0, start - OPERAND_WINDOW), start))) {
      label(operatorAfter(text, after, VALUE_AFTER), 'business ownerId compared');
    }
    const before = operatorBefore(text, start);
    if (before && !NULLISH_BEFORE.test(before.operand)) label(before.op, 'business ownerId compared');
  }
  return hits.sort();
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');

  const { Test } = await import('@nestjs/testing');
  const common = await import('@nestjs/common');
  const { Controller, Get, Param, UseGuards } = common;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { IdentityService } = await import('../src/modules/identity/identity.service');

  @Controller('v96c/businesses/:businessId')
  @UseGuards(AuthGuard, BusinessGuard)
  class GuardedProbeController {
    @Get('probe')
    probe(@Param('businessId') businessId: string) {
      const run = { businessId, tenant: (tenant.getCurrentBusinessId() as string | undefined) ?? null };
      runs.push(run);
      return run;
    }
  }

  @Controller('v96c')
  @UseGuards(AuthGuard)
  class OpenProbeController {
    @Get('open')
    open() {
      return { tenant: (tenant.getCurrentBusinessId() as string | undefined) ?? null };
    }
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [GuardedProbeController, OpenProbeController],
    providers: [PrismaService, AuthGuard, BusinessGuard],
  }).compile();
  const prisma = moduleRef.get(PrismaService);
  prismaSvc = prisma;
  identity = new IdentityService(prisma, {} as any, { seedForBusiness: async () => 0 } as any);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const id of [ID.distOwner, ID.coOwner, ID.staff, ID.outsider, ID.plainOwner, ID.exactOwner, ID.staffOwner, ID.deletedOwner, ID.removedOwner]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizGuard, name: 'V96C Guard', slug: `${P}guard`, ownerId: ID.distOwner } });
  await db.business.create({ data: { id: ID.bizExact, name: 'V96C Exact', ownerId: ID.exactOwner } });
  await db.business.create({ data: { id: ID.bizStaffOwner, name: 'V96C Staff owner', ownerId: ID.staffOwner } });
  await db.business.create({ data: { id: ID.bizGhost, name: 'V96C Ghost', ownerId: ID.ghost } });
  await db.business.create({ data: { id: ID.bizDeleted, name: 'V96C Deleted', ownerId: ID.deletedOwner, deletedAt: new Date() } });
  await db.business.create({ data: { id: ID.bizRemoved, name: 'V96C Removed', ownerId: ID.removedOwner } });
  for (const [userId, businessId, role] of [
    [ID.coOwner, ID.bizGuard, 'OWNER'],
    [ID.staff, ID.bizGuard, 'STAFF'],
    [ID.exactOwner, ID.bizExact, 'OWNER'],
    [ID.staffOwner, ID.bizStaffOwner, 'STAFF'],
    [ID.coOwner, ID.bizRemoved, 'OWNER'],
    [ID.removedOwner, ID.bizRemoved, 'STAFF'],
  ] as const) {
    await db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('W10-OWNER-MEMBERSHIP (D-104): an owner recorded only as Business.ownerId is refused', () => {
  it("[OMB-01] RED-BEFORE (D-104): BusinessGuard refuses the ownerId-only owner 403 'No access to this business' before the handler runs", async () => {
    runs.length = 0;
    const res = await probe(ID.distOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
    expect(runs).toEqual([]);
  });

  it('[OMB-02] RED-BEFORE (D-104): TenantInterceptor installs no tenant for the ownerId-only owner on an AuthGuard-only route naming the business', async () => {
    const res = await open(ID.distOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ tenant: null });
  });

  it('[OMB-03] RED-BEFORE (D-104): workspace discovery does not list a business its caller holds only as Business.ownerId', async () => {
    const listed = (await identity.listBusinesses(ID.distOwner)).map((b: any) => b.id);
    expect(listed).not.toContain(ID.bizGuard);
  });

  it('[OMB-04] control (D-104): the OWNER and STAFF members are admitted and scoped to the business; a user with no Membership is refused', async () => {
    for (const as of [ID.coOwner, ID.staff]) {
      runs.length = 0;
      const res = await probe(as);
      expect(res.status, `${as}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toEqual({ businessId: ID.bizGuard, tenant: ID.bizGuard });
      expect((await open(as)).body, as).toEqual({ tenant: ID.bizGuard });
      expect((await identity.listBusinesses(as)).map((b: any) => b.id), as).toContain(ID.bizGuard);
    }
    const refused = await probe(ID.outsider);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: 'No access to this business' });
    expect((await open(ID.outsider)).body).toEqual({ tenant: null });
  });
});

describe('W10-OWNER-MEMBERSHIP (D-104; review SEC-W10OM-3): the sign-in bootstrap writes no Membership on a business it did not create', () => {
  it('[OMB-10] (D-104, SEC-W10OM-3) POST /identity/bootstrap (bootstrapUser) refuses the ownerId-only owner of a business 403 OWNER_MEMBERSHIP_REQUIRED: no Membership written, the business not answered, BusinessGuard still refuses them', async () => {
    const before = await memberships();
    const error = await identity
      .bootstrapUser({ userId: ID.distOwner, email: `${P}distOwner@test.local` })
      .then(() => null, (e: unknown) => e);
    expect(error, 'bootstrap refused').toBeTruthy();
    expect((error as any).getStatus?.()).toBe(403);
    expect((error as any).getResponse?.()).toMatchObject({ code: 'OWNER_MEMBERSHIP_REQUIRED' });
    expect(JSON.stringify((error as any).getResponse?.())).not.toContain(ID.bizGuard);
    expect(await memberships()).toEqual(before);
    expect(await db.business.count({ where: { ownerId: ID.distOwner } }), 'no second workspace created').toBe(1);
    const res = await probe(ID.distOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('[OMB-11] (D-104, SEC-W10OM-3) a Business.ownerId holding STAFF who signs in keeps STAFF: the bootstrap answers their business and never promotes the role', async () => {
    const out = await identity.bootstrapUser({ userId: ID.staffOwner, email: `${P}staffOwner@test.local` });
    expect(out.business.id).toBe(ID.bizStaffOwner);
    expect(out.isNewBusiness).toBe(false);
    const rows = await db.membership.findMany({ where: { businessId: ID.bizStaffOwner }, select: { userId: true, role: true } });
    expect(rows).toEqual([{ userId: ID.staffOwner, role: 'STAFF' }]);
  });
});

describe('W10-OWNER-MEMBERSHIP (D-104; review OMV-2): the sign-in bootstrap answers a business the caller is a member of and refuses only a recorded owner who is a member nowhere', () => {
  beforeAll(async () => {
    for (const id of BOOT_USERS) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
    }
    // Explicit timestamps: the bootstrap's choices are by age, so the fixture
    // fixes every age rather than relying on insertion order.
    const at = (iso: string) => new Date(iso);
    for (const [id, ownerId, createdAt, deletedAt] of [
      [ID.bootStaffX, ID.bootCo, at('2019-01-01T00:00:00Z'), null],
      [ID.bootOldest, ID.bootRemoved, at('2020-01-01T00:00:00Z'), null],
      [ID.bootNewer, ID.bootRemoved, at('2021-01-01T00:00:00Z'), null],
      [ID.bootDeletedY, ID.bootCo, at('2018-01-01T00:00:00Z'), at('2024-01-01T00:00:00Z')],
      [ID.bootStaffY, ID.bootCo, at('2018-06-01T00:00:00Z'), null],
      [ID.bootOwnedY, ID.bootFallback, at('2020-01-01T00:00:00Z'), null],
      [ID.bootAdminY, ID.bootCo, at('2022-01-01T00:00:00Z'), null],
      [ID.bootNowhere, ID.bootNowhereUser, at('2020-01-01T00:00:00Z'), null],
    ] as const) {
      await db.business.create({ data: { id, name: id, ownerId, createdAt, deletedAt } });
    }
    for (const [userId, businessId, role, createdAt] of [
      // bootCo holds OWNER on every business, so the businesses another user is
      // recorded as owning without a Membership are with_another_owner.
      ...BOOT_BUSINESSES.map((businessId) => [ID.bootCo, businessId, 'OWNER', at('2017-01-01T00:00:00Z')] as const),
      // OMB-14: bootCo removed bootRemoved from bootOldest (no row there).
      [ID.bootRemoved, ID.bootNewer, 'OWNER', at('2021-01-01T00:00:00Z')],
      [ID.bootRemoved, ID.bootStaffX, 'STAFF', at('2019-02-01T00:00:00Z')],
      // OMB-15: the oldest Membership is on a soft-deleted business; of the live
      // ones the ADMIN row is older, on the younger business.
      [ID.bootFallback, ID.bootDeletedY, 'STAFF', at('2019-01-01T00:00:00Z')],
      [ID.bootFallback, ID.bootAdminY, 'ADMIN', at('2022-02-01T00:00:00Z')],
      [ID.bootFallback, ID.bootStaffY, 'STAFF', at('2023-01-01T00:00:00Z')],
      // OMB-16
      [ID.bootFirst, ID.bootStaffX, 'STAFF', at('2019-03-01T00:00:00Z')],
      [ID.bootNowhereUser, ID.bootDeletedY, 'STAFF', at('2019-01-01T00:00:00Z')],
    ] as const) {
      await db.membership.create({
        data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, createdAt },
      });
    }
  }, 60_000);

  it('[OMB-14] RED-BEFORE (D-104; review OMV-2): a caller a co-owner removed from their oldest owned business, OWNER of a newer one and STAFF of another, signs in: the bootstrap answers the oldest owned business they are a member of (isNewBusiness false), writes nothing, and re-admits them nowhere', async () => {
    const before = await bootMemberships();
    const out = await identity.bootstrapUser({ userId: ID.bootRemoved, email: `${P}${ID.bootRemoved.slice(P.length)}@test.local` });
    expect(out.business.id).toBe(ID.bootNewer);
    expect(out.isNewBusiness).toBe(false);
    expect(await bootMemberships()).toEqual(before);
    expect(await db.business.count({ where: { ownerId: ID.bootRemoved } }), 'no workspace created').toBe(2);
    expect((await probe(ID.bootRemoved, ID.bootNewer)).status, 'the answered business admits them').toBe(200);
    expect((await probe(ID.bootRemoved, ID.bootOldest)).status, 'still refused where they were removed').toBe(403);
  });

  it('[OMB-15] RED-BEFORE (D-104; review OMV-2): a caller recorded as Business.ownerId only of a with_another_owner business, a member of none they own but STAFF and ADMIN elsewhere, signs in: the bootstrap answers the business of their oldest Membership on a live business, the same one each time (isNewBusiness false), and writes nothing', async () => {
    const before = await bootMemberships();
    const first = await identity.bootstrapUser({ userId: ID.bootFallback, email: `${P}${ID.bootFallback.slice(P.length)}@test.local` });
    expect(first.business.id).toBe(ID.bootAdminY);
    expect(first.isNewBusiness).toBe(false);
    const again = await identity.bootstrapUser({ userId: ID.bootFallback, email: `${P}${ID.bootFallback.slice(P.length)}@test.local` });
    expect(again.business.id, 'deterministic').toBe(ID.bootAdminY);
    expect(again.isNewBusiness).toBe(false);
    expect(await bootMemberships()).toEqual(before);
    expect(await db.business.count({ where: { ownerId: ID.bootFallback } }), 'no workspace created').toBe(1);
    expect((await probe(ID.bootFallback, ID.bootAdminY)).status, 'the answered business admits them').toBe(200);
    expect((await probe(ID.bootFallback, ID.bootOwnedY)).status, 'not re-admitted to the business they are recorded as owning').toBe(403);
  });

  it('[OMB-16] control (D-104): a caller who owns no business (STAFF elsewhere) still gets their first workspace with its founding OWNER Membership, the same one on the next sign-in; a recorded owner who is a member nowhere live (only of a soft-deleted business) is still refused 403 OWNER_MEMBERSHIP_REQUIRED with nothing written', async () => {
    const before = await bootMemberships();
    const first = await identity.bootstrapUser({ userId: ID.bootFirst, email: `${P}${ID.bootFirst.slice(P.length)}@test.local` });
    expect(first.isNewBusiness).toBe(true);
    const created = await db.business.findUnique({ where: { id: first.business.id }, select: { ownerId: true } });
    expect(created).toEqual({ ownerId: ID.bootFirst });
    const after = await bootMemberships();
    for (const row of before) expect(after).toContainEqual(row);
    expect(after.filter((row: any) => !before.some((b: any) => b.id === row.id)).map(({ id: _id, ...rest }: any) => rest)).toEqual([
      { userId: ID.bootFirst, businessId: first.business.id, role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 },
    ]);
    const again = await identity.bootstrapUser({ userId: ID.bootFirst, email: `${P}${ID.bootFirst.slice(P.length)}@test.local` });
    expect(again.business.id).toBe(first.business.id);
    expect(again.isNewBusiness).toBe(false);
    expect(await bootMemberships()).toEqual(after);

    const error = await bootstrapError(ID.bootNowhereUser);
    expect(error, 'bootstrap refused').toBeTruthy();
    expect((error as any).getStatus?.()).toBe(403);
    expect((error as any).getResponse?.()).toMatchObject({ code: 'OWNER_MEMBERSHIP_REQUIRED' });
    expect(JSON.stringify((error as any).getResponse?.())).not.toContain(P);
    expect(await bootMemberships()).toEqual(after);
    expect(await db.business.count({ where: { ownerId: ID.bootNowhereUser } }), 'no workspace created').toBe(1);
  });
});

describe('W10-OWNER-MEMBERSHIP (D-104): the operator backfill writes the missing OWNER memberships', () => {
  let before: any[];

  it('[OMB-05] the dry run (the default) counts the missing OWNER memberships, writes nothing and prints counts only; an unknown argument exits 2', async () => {
    // The plain legacy shape (ownerId, no Membership at all) is seeded here, as
    // late as possible: an estate-wide founding-membership repair run by another
    // suite would otherwise be free to heal it first.
    await db.business.create({ data: { id: ID.bizPlain, name: 'V96C Plain', ownerId: ID.plainOwner } });
    before = await memberships();
    const owners = await ownerIds();

    const { code, out } = await run([]);
    expect(code, out).toBe(0);
    expectCountsOnly(out);
    expect(out).toMatch(/DRY RUN/);
    expect(out).toMatch(/businesses_scanned\s+5\b/);
    expect(out).toMatch(/owner_is_member\s+2\b/);
    expect(out).toMatch(/missing_owner_membership\s+2\b/);
    expect(out).toMatch(/with_another_owner\s+1\b/);
    expect(out).toMatch(/skipped_with_another_owner\s+1\b/);
    expect(out).toMatch(/skipped_owner_unresolvable\s+1\b/);
    expect(out).toMatch(/would_write\s+1\b/);
    expect(await memberships()).toEqual(before);
    expect(await ownerIds()).toEqual(owners);

    const { backfillOwnerMemberships } = await script();
    const counts = await backfillOwnerMemberships({ db, apply: false, businessIds: BUSINESSES });
    expect(counts).toMatchObject({
      businessesScanned: 5,
      ownerIsMember: 2,
      missingOwnerMembership: 2,
      withAnotherOwner: 1,
      skippedWithAnotherOwner: 1,
      skippedOwnerUnresolvable: 1,
      wouldWrite: 1,
      written: 0,
      conflictingBusinessIds: [],
    });
    // The reviewed dry run counts the conflicting class in.
    expect(await backfillOwnerMemberships({ db, apply: false, includeConflicting: true, businessIds: BUSINESSES })).toMatchObject({
      skippedWithAnotherOwner: 0,
      wouldWrite: 2,
      written: 0,
    });
    expect(await memberships()).toEqual(before);
    expect(await grantAudits()).toEqual([]);

    const bad = await run(['--aply']);
    expect(bad.code).toBe(2);
    expectCountsOnly(bad.out);
    expect(await memberships()).toEqual(before);
  });

  it('[OMB-06] --apply writes exactly the missing OWNER memberships of the plain class in the bootstrap row shape, each with its audit row, skips the with_another_owner business (review SEC-W10OM-2), and touches no other row', async () => {
    const owners = await ownerIds();
    const { code, out } = await run(['--apply']);
    expect(code, out).toBe(0);
    expectCountsOnly(out);
    expect(out).toMatch(/APPLY/);
    expect(out).toMatch(/skipped_with_another_owner\s+1\b/);
    expect(out).toMatch(/written\s+1\b/);
    expect(out).toMatch(/failed\s+0\b/);

    const after = await memberships();
    // Every row that was there is there, unchanged (id, role, scopes, tier).
    for (const row of before) expect(after).toContainEqual(row);
    const added = after.filter((row: any) => !before.some((b: any) => b.id === row.id));
    expect(added.map(({ id: _id, ...rest }: any) => rest)).toEqual([
      { userId: ID.plainOwner, businessId: ID.bizPlain, role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 },
    ]);
    // The grant is audited: one TeamActivityLog row naming the Membership written.
    expect(await grantAudits()).toEqual([
      {
        businessId: ID.bizPlain,
        userId: ID.plainOwner,
        module: 'team',
        entityType: 'membership',
        entityId: added[0].id,
        meta: { ruling: 'D-104', script: 'scripts/backfill-owner-memberships.ts', role: 'OWNER', withAnotherOwner: false },
      },
    ]);
    // Nothing for the with_another_owner business (not reviewed), the soft-deleted business, the
    // unresolvable owner, or an owner already a member.
    expect(after.filter((m: any) => m.businessId === ID.bizGuard).map((m: any) => m.userId).sort()).toEqual([ID.coOwner, ID.staff].sort());
    for (const businessId of [ID.bizDeleted, ID.bizGhost]) {
      expect(after.filter((m: any) => m.businessId === businessId), businessId).toEqual([]);
    }
    expect(after.filter((m: any) => m.businessId === ID.bizStaffOwner).map((m: any) => [m.userId, m.role])).toEqual([[ID.staffOwner, 'STAFF']]);
    expect(await ownerIds()).toEqual(owners);
    expect((await probe(ID.distOwner)).status, 'the skipped owner is still refused').toBe(403);
  });

  it('[OMB-07] idempotent: a second --apply writes nothing and changes nothing', async () => {
    const snapshot = await memberships();
    const audits = await grantAudits();
    const { code, out } = await run(['--apply']);
    expect(code, out).toBe(0);
    expect(out).toMatch(/missing_owner_membership\s+1\b/);
    expect(out).toMatch(/skipped_with_another_owner\s+1\b/);
    expect(out).toMatch(/written\s+0\b/);
    expect(out).toMatch(/owner_is_member\s+3\b/);
    expect(await memberships()).toEqual(snapshot);
    expect(await grantAudits()).toEqual(audits);
  });

  it('[OMB-08] (D-104) after the reviewed run (--apply --include-conflicting) the owner is admitted by BusinessGuard, scoped by TenantInterceptor and listed by discovery; that grant is audited too', async () => {
    const snapshot = await memberships();
    const { code, out } = await run(['--apply', '--include-conflicting']);
    expect(code, out).toBe(0);
    expectCountsOnly(out);
    expect(out).toMatch(/skipped_with_another_owner\s+0\b/);
    expect(out).toMatch(/written\s+1\b/);
    const added = (await memberships()).filter((row: any) => !snapshot.some((b: any) => b.id === row.id));
    expect(added.map(({ id: _id, ...rest }: any) => rest)).toEqual([
      { userId: ID.distOwner, businessId: ID.bizGuard, role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 },
    ]);
    expect((await grantAudits([ID.bizGuard])).map((a: any) => [a.userId, a.entityId, a.meta.withAnotherOwner])).toEqual([[ID.distOwner, added[0].id, true]]);

    runs.length = 0;
    const res = await probe(ID.distOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ businessId: ID.bizGuard, tenant: ID.bizGuard });
    expect(runs).toEqual([{ businessId: ID.bizGuard, tenant: ID.bizGuard }]);
    expect((await open(ID.distOwner)).body).toEqual({ tenant: ID.bizGuard });
    expect((await identity.listBusinesses(ID.distOwner)).map((b: any) => b.id)).toContain(ID.bizGuard);
    expect((await identity.listBusinesses(ID.plainOwner)).map((b: any) => b.id)).toContain(ID.bizPlain);
  });
});

describe('W10-OWNER-MEMBERSHIP (D-104; review SEC-W10OM-2): a removed owner is not re-admitted by default', () => {
  it('[OMB-12] (D-104, SEC-W10OM-2) an OWNER removes the Business.ownerId member (STAFF): the default --apply does not re-admit them (with_another_owner, skipped) and audits nothing; --list-conflicting names that business for review, by id only', async () => {
    const removed = await db.membership.findUnique({ where: { userId_businessId: { userId: ID.removedOwner, businessId: ID.bizRemoved } } });
    await identity.removeTeamMember(ID.bizRemoved, removed.id, ID.coOwner);
    expect((await probe(ID.removedOwner, ID.bizRemoved)).status).toBe(403);

    const { main } = await script();
    const lines: string[] = [];
    const log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    const code = await main(['--apply', '--list-conflicting'], { db, log, error: log, businessIds: [ID.bizRemoved] });
    const out = lines.join('\n');
    expect(code, out).toBe(0);
    expect(out).toMatch(/with_another_owner\s+1\b/);
    expect(out).toMatch(/skipped_with_another_owner\s+1\b/);
    expect(out).toMatch(/written\s+0\b/);
    // The review list names the business by id, and nothing else of it or its people.
    expect(lines.filter((l) => l.includes(P))).toEqual([`  ${ID.bizRemoved}`]);
    expect(out).not.toMatch(/@/);

    expect(await db.membership.findUnique({ where: { userId_businessId: { userId: ID.removedOwner, businessId: ID.bizRemoved } } })).toBeNull();
    expect((await probe(ID.removedOwner, ID.bizRemoved)).status, 'still refused').toBe(403);
    expect(await grantAudits([ID.bizRemoved])).toEqual([]);
  });

  it('[OMB-13] (D-104; review SEC-W10OM-6) mail addressed to the business owner (the weekly financial briefing, the public quote alerts, the AI usage alerts) reaches the Business.ownerId user only while they hold a Membership: none for the removed ownerId member or an unresolvable owner, the member owner\'s address otherwise; the three senders read their recipient through that rule', async () => {
    const { businessOwnerRecipient } = await import('../src/core/auth/business.guard');
    expect(await businessOwnerRecipient(prismaSvc, ID.bizRemoved, ID.removedOwner)).toBeNull();
    expect(await businessOwnerRecipient(prismaSvc, ID.bizGhost, ID.ghost)).toBeNull();
    expect(await businessOwnerRecipient(prismaSvc, ID.bizGuard, null)).toBeNull();
    // A member of another business is no recipient for this one.
    expect(await businessOwnerRecipient(prismaSvc, ID.bizRemoved, ID.exactOwner)).toBeNull();
    expect(await businessOwnerRecipient(prismaSvc, ID.bizExact, ID.exactOwner)).toEqual({ email: `${P}exactOwner@test.local`, name: ID.exactOwner });

    const root = path.resolve(__dirname, '../src');
    for (const file of [
      'modules/commerce/financial-briefing-scheduler.service.ts',
      'modules/commerce/quote-notifications.listener.ts',
      'modules/ai/ai-usage-alert-scheduler.service.ts',
    ]) {
      const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\s+/g, ' ');
      expect(text, file).toContain('businessOwnerRecipient(this.prisma,');
      expect(text, file).not.toMatch(/user\.findUnique\(\{ where: \{ id: (?:business\.)?ownerId/);
    }
  });
});

describe('W10-OWNER-MEMBERSHIP (D-104): census pin', () => {
  it('[OMB-09] (D-104; reviews CR-W10OM-2, OMV-3) no business access predicate under apps/server/src admits Business.ownerId without a Membership, except the listed exceptions, one per site: the referred ACTION-001 principal basis and onboarding completion\'s ownerId arm, and the informational reads that grant nothing', () => {
    const root = path.resolve(__dirname, '../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    // One entry per site (censusHits), so a second arm in a listed file fails too.
    const offenders: string[] = [];
    for (const file of files) {
      for (const label of censusHits(fs.readFileSync(file, 'utf8'))) offenders.push(`${path.relative(root, file)}: ${label}`);
    }
    // The known exceptions, one entry per site, each with why it stays. The list
    // is exact: a new arm fails this pin, and so does aligning one of these
    // without removing it here.
    const EXCEPTIONS: Array<[string, string]> = [
      // Classifies businesses for the KF-EXEC-TENANT-001 repair report; it grants nothing.
      ['modules/identity/founding-membership.service.ts: ownerId compared to the caller', 'repair classifier, no access decision'],
      // Referred (W10-OWNER-MEMBERSHIP deviation): ACTION-001's principal basis
      // 'owner_without_membership' (approval tier 0) is pinned by the
      // action-001-real-db manifest and its negative control
      // NC-P4-OWNER-WITHOUT-MEMBERSHIP-APPROVES; aligning it changes both.
      ['modules/key-autonomy/action-boundary/control-clearance.ts: ownerId compared to the caller', 'referred: ACTION-001 manifests'],
      // Referred (W10-OWNER-MEMBERSHIP deviation): resolveCompletionActor runs
      // only under a tenant context TenantInterceptor verified (a Membership
      // since D-104, or SUPER_ADMIN); its ownerId arm is pinned by
      // release0-edited-suites (onboarding-concierge.service.spec ST-R032-1).
      ['modules/onboarding-concierge/onboarding-concierge.service.ts: ownerId compared to the caller', 'referred: release0-edited-suites'],
      // Informational (review OMV-3), none grants anything on ownerId alone:
      // checkSlugAvailability's `existing.ownerId === userId` only answers
      // { available: true, ownedByYou: true } on the slug route; writing a slug
      // goes through the business PATCH, which BusinessGuard and the D-11 owner
      // check (Membership) gate.
      ['modules/identity/identity.service.ts: ownerId compared to the caller', 'informational: slug availability, grants nothing'],
      // ensureBootstrapWorkspace's bootstrap-business lookup (oldest owned):
      // it answers that business only after checking the caller's Membership on
      // it, and otherwise only a business they hold a Membership on (D-104,
      // review OMV-2); on its own it decides first-sign-in creation vs the rest.
      ['modules/identity/identity.service.ts: business read on ownerId without membership', 'informational: bootstrap lookup, Membership checked before answering'],
      // assertAdoptableInvitePlaceholder's never-bound test: an owned business
      // makes the row an account, which is refused (409); it admits no one.
      ['modules/identity/identity.service.ts: business read on ownerId without membership', 'informational: refusal predicate'],
      // Contact.ownerId, not Business.ownerId: createContact's requested owner
      // against the actor (a different owner needs reassign permission, and must
      // be a member), and the Google Contacts default owner setting likewise.
      ['modules/crm/crm.service.ts: ownerId compared to the caller', "informational: a contact's owner"],
      ['modules/connect/google-contacts-sync.service.ts: ownerId compared to the caller', "informational: a contact's default owner"],
    ];
    expect(offenders.sort()).toEqual(EXCEPTIONS.map(([site]) => site).sort());
  });

  it('[OMB-17] (D-104; review OMV-3) the census is not vacuous: each ownerId-as-authority shape is flagged on synthetic source, and each membership-carrying or non-business shape is not', () => {
    // [shape, source, the one label the census must give it]
    const FLAGGED: Array<[string, string, string]> = [
      ['OR arm', 'db.business.findMany({ where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] } })', 'ownerId OR members'],
      ['OR arm, members first with a role', "tx.business.findFirst({ where: { id: businessId, OR: [{ members: { some: { role: 'OWNER', userId: user.id } } }, { ownerId: user.id }] } })", 'ownerId OR members'],
      ['OR arm on another receiver (optional chain)', 'this.prisma.client.business.findFirst({ where: { id, OR: [{ ownerId: req.user?.id }, { members: { some: { userId: req.user?.id } } }] } })', 'ownerId OR members'],
      ['OR arm with another field beside ownerId', 'prisma.business.count({ where: { OR: [{ ownerId: ctx.userId, deletedAt: null }, { members: { some: { userId: ctx.userId } } }] } })', 'ownerId OR members'],
      ['owner arm right after id', 'this.prisma.client.business.findFirst({ where: { id: businessId, ownerId: actorId }, select: { id: true } })', 'business read on ownerId without membership'],
      ['owner arm before id', 'this.prisma.client.business.findFirst({ where: { ownerId: userId, id: businessId } })', 'business read on ownerId without membership'],
      ['owner arm after other keys (findUnique)', 'this.prisma.client.business.findUnique({ where: { id: businessId, deletedAt: null, ownerId: user.id }, select: { id: true } })', 'business read on ownerId without membership'],
      ['owner lookup without an id', "tx.business.findFirst({ where: { ownerId: userId, deletedAt: null }, orderBy: { createdAt: 'asc' } })", 'business read on ownerId without membership'],
      ['business relation filter on ownerId', 'this.prisma.client.invoice.findFirst({ where: { id: invoiceId, business: { ownerId: userId } } })', 'business relation on ownerId without membership'],
      ['business row compared', 'if (business.ownerId === userId) return true;', 'ownerId compared to the caller'],
      ['another receiver compared (existing.ownerId === userId)', 'if (userId && existing.ownerId === userId) return { available: true, ownedByYou: true };', 'ownerId compared to the caller'],
      ['caller on the left', 'if (req.user.id !== row.ownerId) throw new ForbiddenException();', 'ownerId compared to the caller'],
      ['destructured ownerId compared to user.id', 'const { ownerId } = await load(businessId); if (ownerId === user.id) return;', 'ownerId compared to the caller'],
      ['destructured ownerId, caller first, optional chain', 'if (user?.id !== ownerId) throw new ForbiddenException();', 'ownerId compared to the caller'],
      ['bare ownerId against the actor', 'if (ownerId && ownerId === actorId) return actorId;', 'ownerId compared to the caller'],
      // Reviews OMV3-R1, OMV-R1: the repo reads across tenants by wrapping the
      // argument in skipTenantIsolation(...); its where sits one call deeper.
      ['business read wrapped in skipTenantIsolation', 'tx.business.findFirst(skipTenantIsolation({ where: { id: businessId, ownerId: userId } }))', 'business read on ownerId without membership'],
      ['cross-tenant business read wrapped, multi-line', 'this.prisma.client.business.findFirst(\n  skipTenantIsolation({\n    where: { id: businessId, ownerId: userId },\n    select: { id: true },\n  }),\n)', 'business read on ownerId without membership'],
      ['business relation filter wrapped in skipTenantIsolation (a cross-tenant read)', 'this.prisma.client.invoice.findFirst(skipTenantIsolation({ where: { id: invoiceId, business: { ownerId: userId } } }))', 'business relation on ownerId without membership'],
      ['membership read with an ownerId relation arm, wrapped', 'tx.membership.findFirst(skipTenantIsolation({ where: { businessId, OR: [{ business: { ownerId: userId } }, { userId }] } }))', 'business relation on ownerId without membership'],
      // Review OMV-R1: indexed and parenthesised receivers.
      ['indexed receiver compared', 'if (rows[0].ownerId === userId) return;', 'ownerId compared to the caller'],
      ['indexed receiver, optional chain, caller on the left', 'if (userId !== rows[0]?.ownerId) throw new ForbiddenException();', 'ownerId compared to the caller'],
      ['parenthesised receiver compared', 'if ((await this.load(id)).ownerId === userId) return;', 'ownerId compared to the caller'],
      ['parenthesised read result compared (non-null assertion)', 'if ((await tx.business.findUnique({ where: { id } }))!.ownerId !== user.id) throw new ForbiddenException();', 'ownerId compared to the caller'],
      // Review SEAMZ4-SEC-1: a business-named receiver's ownerId compared with
      // anything (not only a caller-named value), as the census at 39e9be12
      // flagged it; one label per comparison.
      ['business row against an auth user', 'if (business.ownerId !== authUser.id) throw new ForbiddenException();', 'business ownerId compared'],
      ['business row against a uid', 'if (business.ownerId === uid) return true;', 'business ownerId compared'],
      ['existingBusiness against a requesting user', 'if (existingBusiness.ownerId !== requestingUserId) throw new ForbiddenException();', 'business ownerId compared'],
      ['biz against a token subject', 'if (biz.ownerId === sub) return biz;', 'business ownerId compared'],
      ['business row against a principal', 'if (business.ownerId === principal.id) return true;', 'business ownerId compared'],
      ['business row against an input field', 'const same = business.ownerId === input.ownerUserId;', 'business ownerId compared'],
      ['business row against a session subject', 'if (business.ownerId === session.sub) return business;', 'business ownerId compared'],
      ['business row against a bare id', 'return business.ownerId === id;', 'business ownerId compared'],
      ['business row against claims', 'if (business.ownerId === claims.sub) return;', 'business ownerId compared'],
      ['rows.business, loose equality', 'if (rows.business.ownerId == uid) return true;', 'business ownerId compared'],
      ['a *Business receiver, value on the left, loose inequality', 'if (uid != targetBusiness.ownerId) throw new ForbiddenException();', 'business ownerId compared'],
      ['this.business, optional chain, value on the left', 'if (sub === this.business?.ownerId) return true;', 'business ownerId compared'],
      ['indexed business receiver', 'if (businesses[0]?.ownerId === sub) return businesses[0];', 'business ownerId compared'],
      ['business returned by a call', 'if (this.getBusiness(id).ownerId !== uid) throw new ForbiddenException();', 'business ownerId compared'],
      ['parenthesised business load', 'if ((await this.loadBusiness(id)).ownerId !== principal.id) throw new ForbiddenException();', 'business ownerId compared'],
      ['parenthesised business read result (non-null assertion)', 'if ((await tx.business.findUnique({ where: { id } }))!.ownerId === session.sub) return;', 'business ownerId compared'],
      ['parenthesised business type assertion', 'if ((business as Business).ownerId === uid) return true;', 'business ownerId compared'],
      ['two business owners compared (one site)', 'if (business.ownerId === parentBusiness.ownerId) return true;', 'business ownerId compared'],
      ['parenthesised business, union type assertion, non-null assertion', 'if ((rows.business as Business | null)!.ownerId === uid) return true;', 'business ownerId compared'],
      // Reviews Z4-RV-CENSUS-SEC-1, Z4RV-CENSUS-1: the 39e9be12 census matched
      // the business-named segment wherever its chain began, so a receiver
      // chain of any shape counts: optional index and call (?.[..], ?.(..)),
      // nested index and call groups, a `!` before an index, a space before a
      // dot (a chain prettier broke over lines), and an identifier with `$`.
      ['optional index chain to a business', 'if (memberships?.[0]?.business?.ownerId !== user.sub) throw new ForbiddenException();', 'business ownerId compared'],
      ['optional index chain to a business, against the caller', 'if (ctx.rows?.[0].business.ownerId === userId) return true;', 'ownerId compared to the caller'],
      ['nested index to a business', 'if (byId[ids[0]].business.ownerId !== uid) throw new ForbiddenException();', 'business ownerId compared'],
      ['optional call to a business', 'if (this.svc.resolve?.(id).business.ownerId !== uid) throw new ForbiddenException();', 'business ownerId compared'],
      ['nested call to a business, against the caller', 'if (this.repo.get(toId(String(id))).business.ownerId === userId) return true;', 'ownerId compared to the caller'],
      ['a $-prefixed biz', 'if ($biz.ownerId === uid) return true;', 'business ownerId compared'],
      ['prettier-printed long condition (a space before .business)', 'if (\n    (await this.prisma.client.membership.findFirst({ where: { userId: actor.id, businessId } }))!\n      .business.ownerId !== authUser.id\n  )\n    throw new ForbiddenException();', 'business ownerId compared'],
      ['parenthesised load, two paren levels, to a business', 'if ((await this.load(String(id))).business.ownerId !== uid) throw new ForbiddenException();', 'business ownerId compared'],
      ['nested index on rows to a business', 'if (rows[ids[0]].business.ownerId === uid) return true;', 'business ownerId compared'],
      ['optional index on rows to a business', 'if (rows?.[0].business.ownerId === uid) return true;', 'business ownerId compared'],
      ['non-null index on rows to a business', 'if (rows![0].business.ownerId === uid) return true;', 'business ownerId compared'],
      ['optional call on ctx to a business', 'if (ctx.load?.(id).business.ownerId === uid) return true;', 'business ownerId compared'],
      ['chain broken over lines to a business', 'if (this.tenant\n  .current(req).business.ownerId !== uid) throw new ForbiddenException();', 'business ownerId compared'],
      ['nested index chain to a business, value on the left', 'if (uid !== byId[ids[0]]?.business.ownerId) throw new ForbiddenException();', 'business ownerId compared'],
      ['prettier member chain, .ownerId on its own line', 'if (\n  this.repo\n    .scoped(ctx)\n    .withTx(tx)\n    .getBusiness(id)\n    .ownerId !== uid\n)\n  throw new ForbiddenException();', 'business ownerId compared'],
      ['business returned by a nested call', 'if (this.getBusiness(toId(String(id))).ownerId !== uid) throw new ForbiddenException();', 'business ownerId compared'],
      ['optional index receiver against the caller', 'if (rows?.[0].ownerId === userId) return;', 'ownerId compared to the caller'],
      ['nested call receiver, caller on the left', 'if (userId !== this.repo.get(toId(String(id))).ownerId) throw new ForbiddenException();', 'ownerId compared to the caller'],
    ];
    const PASSED: Array<[string, string]> = [
      ['the D-104 owner arm (the Membership required)', 'this.prisma.client.business.findFirst({ where: { id: businessId, ownerId: actor.id, members: { some: { userId: actor.id } } }, select: { id: true } })'],
      ['ownerId selected, not filtered', 'this.prisma.client.business.findUnique({ where: { id: businessId }, select: { ownerId: true } })'],
      ['Membership discovery', 'this.prisma.client.business.findMany({ where: { deletedAt: null, members: { some: { userId } } } })'],
      ['a business created with its founding Membership', "tx.business.create({ data: { name, ownerId: userId, members: { create: { userId, role: 'OWNER' } } } })"],
      ["a contact's owner", 'if (contact.ownerId !== actorId) throw new ForbiddenException();'],
      ['a contact OR arm (shares, not members)', 'this.prisma.client.contact.findFirst({ where: { OR: [{ ownerId: actorUserId }, { shares: { some: { userId: actorUserId } } }] } })'],
      ['type and presence checks', "if (typeof config.ownerId === 'string' && ownerId !== undefined && ownerId !== null) return config.ownerId;"],
      ['ownerId against a stored value', 'if (ownerId !== null && ownerId === storedOwnerId) return ownerId;'],
      // The wrapped forms of the membership-carrying and Membership reads.
      ['the D-104 owner arm, wrapped', 'tx.business.findFirst(skipTenantIsolation({ where: { id: businessId, ownerId: userId, members: { some: { userId } } } }))'],
      ["the bootstrap's oldest-Membership read, wrapped", 'tx.membership.findFirst(skipTenantIsolation({ where: { userId, business: { deletedAt: null } }, select: { business: true } }))'],
      ['ownerId selected under a wrapped read', 'this.prisma.client.business.findUnique(skipTenantIsolation({ where: { id: businessId }, select: { ownerId: true } }))'],
      ["an indexed contact's owner", 'if (contacts[0].ownerId !== actorId) throw new ForbiddenException();'],
      // Review SEAMZ4-SEC-1: a business-named receiver's ownerId checked for
      // presence (null, undefined) or type decides nothing about the caller.
      ["a business's ownerId against null and undefined", 'if (business.ownerId === null || biz.ownerId !== undefined) return;'],
      ["a business's ownerId, loose null checks", 'if (existingBusiness.ownerId != null && rows.business.ownerId == undefined) return;'],
      ['null and undefined on the left', 'if (null !== business.ownerId && undefined === targetBusiness?.ownerId) return;'],
      ["a business's ownerId under typeof", "if (typeof business.ownerId === 'string' && 'string' === typeof this.business.ownerId) return;"],
      // Reviews Z4-RV-CENSUS-SEC-1, Z4RV-CENSUS-1: typeof, null, undefined and
      // a contact's owner at the end of any receiver chain.
      ['a chained business ownerId under typeof', "if (typeof a?.[0].business.ownerId === 'string' && typeof rows[0].business.ownerId === 'string') return;"],
      ['a chain broken over lines under typeof', "if (typeof this.tenant\n  .current(req).business.ownerId === 'string') return;"],
      ['a chained business ownerId against null and undefined', 'if (rows?.[0].business.ownerId === null || undefined !== byId[ids[0]].business?.ownerId) return;'],
      ["a chained contact's owner", 'if (rows?.[0].contact.ownerId !== actorId) throw new ForbiddenException();'],
    ];
    expect(FLAGGED.map(([shape, source]) => [shape, censusHits(source)])).toEqual(FLAGGED.map(([shape, , label]) => [shape, [label]]));
    expect(PASSED.map(([shape, source]) => [shape, censusHits(source)])).toEqual(PASSED.map(([shape]) => [shape, []]));
  });
});
