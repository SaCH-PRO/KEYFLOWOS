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
 *   OMB-06  --apply writes exactly the missing OWNER rows, in the row shape the
 *           identity bootstrap writes ({ userId: ownerId, businessId, role
 *           'OWNER' }, no scopes, tier 0): one for each non-deleted business whose
 *           ownerId names a User holding no Membership there (also where another
 *           member already holds OWNER: that owner is admitted today by the ownerId
 *           arm, so the row keeps the access D-104 would otherwise take). It writes
 *           nothing for an ownerId that is already a member (any role), names no
 *           User, or a soft-deleted business; it never edits ownerId or an
 *           existing Membership.
 *   OMB-07  idempotent: a second --apply writes nothing and changes nothing.
 *   OMB-08  after the backfill the owner is admitted by BusinessGuard, scoped by
 *           TenantInterceptor and listed by discovery.
 *   OMB-09  census pin: no business access predicate under apps/server/src
 *           admits Business.ownerId without a Membership (no `OR [{ ownerId },
 *           { members }]`, no owner arm `{ id, ownerId: x }` that does not also
 *           require x's Membership).
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
 * afterAll. No $transaction wrapping.
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
  bizGuard: `${P}bizGuard`,
  bizPlain: `${P}bizPlain`,
  bizExact: `${P}bizExact`,
  bizStaffOwner: `${P}bizStaffOwner`,
  bizGhost: `${P}bizGhost`,
  bizDeleted: `${P}bizDeleted`,
};

/** Every business of this suite: the backfill is scoped to exactly these. */
const BUSINESSES = [ID.bizGuard, ID.bizPlain, ID.bizExact, ID.bizStaffOwner, ID.bizGhost, ID.bizDeleted];

let db: any;
let app: any;
let identity: any;
/** Handler runs of the guarded probe since the last reset. */
const runs: Array<{ businessId: string; tenant: string | null }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
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

  for (const id of [ID.distOwner, ID.coOwner, ID.staff, ID.outsider, ID.plainOwner, ID.exactOwner, ID.staffOwner, ID.deletedOwner]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizGuard, name: 'V96C Guard', slug: `${P}guard`, ownerId: ID.distOwner } });
  await db.business.create({ data: { id: ID.bizExact, name: 'V96C Exact', ownerId: ID.exactOwner } });
  await db.business.create({ data: { id: ID.bizStaffOwner, name: 'V96C Staff owner', ownerId: ID.staffOwner } });
  await db.business.create({ data: { id: ID.bizGhost, name: 'V96C Ghost', ownerId: ID.ghost } });
  await db.business.create({ data: { id: ID.bizDeleted, name: 'V96C Deleted', ownerId: ID.deletedOwner, deletedAt: new Date() } });
  for (const [userId, businessId, role] of [
    [ID.coOwner, ID.bizGuard, 'OWNER'],
    [ID.staff, ID.bizGuard, 'STAFF'],
    [ID.exactOwner, ID.bizExact, 'OWNER'],
    [ID.staffOwner, ID.bizStaffOwner, 'STAFF'],
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
    expect(out).toMatch(/skipped_owner_unresolvable\s+1\b/);
    expect(out).toMatch(/would_write\s+2\b/);
    expect(await memberships()).toEqual(before);
    expect(await ownerIds()).toEqual(owners);

    const { backfillOwnerMemberships } = await script();
    const counts = await backfillOwnerMemberships({ db, apply: false, businessIds: BUSINESSES });
    expect(counts).toMatchObject({
      businessesScanned: 5,
      ownerIsMember: 2,
      missingOwnerMembership: 2,
      withAnotherOwner: 1,
      skippedOwnerUnresolvable: 1,
      wouldWrite: 2,
      written: 0,
    });
    expect(await memberships()).toEqual(before);

    const bad = await run(['--aply']);
    expect(bad.code).toBe(2);
    expectCountsOnly(bad.out);
    expect(await memberships()).toEqual(before);
  });

  it('[OMB-06] --apply writes exactly the missing OWNER memberships in the bootstrap row shape, and touches no other row', async () => {
    const owners = await ownerIds();
    const { code, out } = await run(['--apply']);
    expect(code, out).toBe(0);
    expectCountsOnly(out);
    expect(out).toMatch(/APPLY/);
    expect(out).toMatch(/written\s+2\b/);
    expect(out).toMatch(/failed\s+0\b/);

    const after = await memberships();
    // Every row that was there is there, unchanged (id, role, scopes, tier).
    for (const row of before) expect(after).toContainEqual(row);
    const added = after.filter((row: any) => !before.some((b: any) => b.id === row.id));
    expect(added.map(({ id: _id, ...rest }: any) => rest)).toEqual([
      { userId: ID.distOwner, businessId: ID.bizGuard, role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 },
      { userId: ID.plainOwner, businessId: ID.bizPlain, role: 'OWNER', permissionScopes: null, maxApprovalTier: 0 },
    ]);
    // Nothing for the soft-deleted business, the unresolvable owner, or an owner already a member.
    for (const businessId of [ID.bizDeleted, ID.bizGhost]) {
      expect(after.filter((m: any) => m.businessId === businessId), businessId).toEqual([]);
    }
    expect(after.filter((m: any) => m.businessId === ID.bizStaffOwner).map((m: any) => [m.userId, m.role])).toEqual([[ID.staffOwner, 'STAFF']]);
    expect(await ownerIds()).toEqual(owners);
  });

  it('[OMB-07] idempotent: a second --apply writes nothing and changes nothing', async () => {
    const snapshot = await memberships();
    const { code, out } = await run(['--apply']);
    expect(code, out).toBe(0);
    expect(out).toMatch(/missing_owner_membership\s+0\b/);
    expect(out).toMatch(/written\s+0\b/);
    expect(out).toMatch(/owner_is_member\s+4\b/);
    expect(await memberships()).toEqual(snapshot);
  });

  it('[OMB-08] (D-104) after the backfill the owner is admitted by BusinessGuard, scoped by TenantInterceptor and listed by discovery', async () => {
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

describe('W10-OWNER-MEMBERSHIP (D-104): census pin', () => {
  it('[OMB-09] no business access predicate under apps/server/src admits Business.ownerId without a Membership', () => {
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
    // Whitespace-normalised source, so a predicate split over lines still matches.
    const offenders: string[] = [];
    const patterns: Array<[string, RegExp]> = [
      // OR: [{ ownerId: x }, { members: { some: ... } }] and the reverse order.
      ['ownerId OR members', /OR: \[ ?\{ ownerId: [\w.]+ \}, \{ members: \{ some:/],
      ['members OR ownerId', /OR: \[ ?\{ members: \{ some: \{ userId[^\]]*\}, \{ ownerId: [\w.]+ \},? ?\]/],
      // An owner arm on a business read that does not also require the Membership.
      ['owner arm without membership', /business\.(?:findFirst|findMany|count)\(\{ where: \{ id: \w+, ownerId: [\w.]+ \}/],
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
      for (const [label, re] of patterns) if (re.test(text)) offenders.push(`${path.relative(root, file)}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });
});
