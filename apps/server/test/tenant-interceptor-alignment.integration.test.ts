/**
 * R0-F24-TENANT-INTERCEPTOR-ALIGN (build map CF-24) — the tenant a handler runs
 * under is exactly the string BusinessGuard validated (REAL database).
 *
 * In production TenantInterceptor is an APP_INTERCEPTOR (app.module.ts) and the
 * Prisma tenant extension's context provider is installed (main.ts,
 * setTenantContextProvider), so every query on a tenant-scoped model has its
 * `where.businessId` overwritten with the ambient tenant the interceptor picked.
 * The interceptor picked `params.businessId || body.businessId ||
 * query.businessId` — the first TRUTHY field, unchecked — while BusinessGuard
 * validates the first non-empty STRING (core/auth/request-business-id.ts). On a
 * route with no `:businessId` segment, a non-string body businessId next to the
 * string `?businessId=A` the guard checked made the two disagree. R0-34 pinned
 * the ambient tenant inside the cortex audit controller (inGuardedTenant); every
 * other bare-id route still ran under the interceptor's pick. This suite proves
 * the root fix in the shared core.
 *
 * Nothing on the boundary is mocked: PrismaService, the user, business,
 * membership and contact rows, AuthGuard, BusinessGuard, TenantInterceptor
 * (installed as APP_INTERCEPTOR, as in production) and the Prisma tenant
 * extension are real against DATABASE_URL. Two stand-ins: identity attachment
 * (a test middleware reads `x-test-user` and attaches the seeded user row's
 * `{ id, email, role }`, as AuthMiddleware does after token verification), and
 * the route itself — a probe controller declared here, shaped like the
 * well-behaved bare-id handlers (cortex audit, commerce receipts): it takes the
 * tenant through @GuardedBusinessId(), refuses when there is none, binds
 * `where.businessId` explicitly, and records the ambient tenant it ran under.
 * Contact is one of the extension's BUSINESS_ID_MODELS, so the rows it returns
 * are the rows the ambient tenant selects.
 *
 * Review finding F1 (security-tenancy): the interceptor is global, so it also
 * runs on routes NO guard admits a tenant for — the AuthGuard-only routes and
 * public routes reached with a bearer token. There it installed the request's
 * businessId with no membership check, and because the extension forces
 * businessId on create/upsert that was a cross-tenant WRITE primitive:
 * POST /identity/bootstrap?businessId=<B> by A's owner wrote the bootstrap
 * membership upsert (keyed to A) into B as an OWNER row. The F1 cases run the
 * REAL IdentityController bootstrap route (real IdentityService; the
 * controller's other collaborators are inert stand-ins, unused on that route)
 * and a second probe declared here with AuthGuard only, and pin that on such a
 * route the named tenant becomes ambient only for a caller who passes
 * BusinessGuard's membership predicate for it (or is SUPER_ADMIN).
 *
 * Every seeded row carries the `k24a_` prefix and is hard-deleted by raw SQL in
 * beforeAll and afterAll (memberships also by user/business prefix, which
 * covers the cuid-keyed rows bootstrap writes). No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k24a_';

const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA (Business.ownerId)
  staffA: `${P}staffA`, // STAFF member of bizA (Membership)
  ownerB: `${P}ownerB`, // OWNER of bizB only
  nomember: `${P}nomember`, // no business anywhere
  superAdmin: `${P}super`, // role SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

const A_CONTACTS = [`${P}cA1`, `${P}cA2`];
const B_CONTACTS = [`${P}cB1`, `${P}cB2`, `${P}cB3`];
const ROWS_A = A_CONTACTS.map((id) => ({ id, businessId: ID.bizA }));
const ROWS_B = B_CONTACTS.map((id) => ({ id, businessId: ID.bizB }));

type Run = { route: string; guarded: unknown; ambient: unknown; ambientType: string };

let db: any;
let app: INestApplication;
let tenant: typeof import('../src/core/tenant/tenant-context');
/** Handler runs since the last reset (beforeEach). */
let runs: Run[] = [];
/** Every handler run in the suite, for the closing invariant. */
const allRuns: Run[] = [];

/** Every run of the AuthGuard-only probe (no BusinessGuard), for the F1 invariant. */
type OpenRun = { route: string; actor: string; ambient: unknown; ambientType: string };
const openRuns: OpenRun[] = [];
let writeSeq = 0;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
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

const server = () => app.getHttpServer();

/** GET the bare-id probe with a raw query string, as `actor`. */
function getProbe(actor: string | null, qs: string) {
  const req = request(server()).get(`/k24a/probe/read${qs}`);
  return actor ? req.set('x-test-user', actor) : req;
}

/** GET the bare-id probe with `?businessId=<A>` and a JSON or urlencoded body. */
function getWithBody(actor: string, businessIdInQuery: string, contentType: string, body: string | object) {
  return getProbe(actor, `?businessId=${encodeURIComponent(businessIdInQuery)}`).set('Content-Type', contentType).send(body);
}

/** 200 with exactly A's rows, and the one handler run under exactly A. */
function expectRanUnderA(res: { status: number; body: any }, label: string) {
  expect({ label, status: res.status, body: res.body }).toEqual({
    label,
    status: 200,
    body: { guarded: ID.bizA, ambient: ID.bizA, rows: ROWS_A },
  });
  expect({ label, runs: runs.map(({ guarded, ambient, ambientType }) => ({ guarded, ambient, ambientType })) }).toEqual({
    label,
    runs: [{ guarded: ID.bizA, ambient: ID.bizA, ambientType: 'string' }],
  });
}

/** Refused, and the handler never ran. */
function expectNothingRan(res: { status: number; body: any }, status: number, label: string) {
  expect({ label, status: res.status, runs }).toEqual({ label, status, runs: [] });
  expect(res.body).not.toHaveProperty('rows');
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const common = await import('@nestjs/common');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GuardedBusinessId } = await import('../src/core/auth/request-business-id');
  const { Controller, Get, Post, HttpCode, Inject, UseGuards, ForbiddenException, Req } = common;
  // F1: the real bootstrap route and the service behind it.
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');

  /**
   * A bare-id route shaped like the production ones that read the tenant from
   * the request (no `:businessId` segment), plus a path-param twin as a control.
   */
  @Controller('k24a/probe')
  @UseGuards(AuthGuard, BusinessGuard)
  class TenantProbeController {
    constructor(@Inject(PrismaService) private readonly prisma: InstanceType<typeof PrismaService>) {}

    private async read(route: string, guarded: string | undefined) {
      const ambient = tenant.getCurrentBusinessId() as unknown;
      const run = { route, guarded, ambient, ambientType: typeof ambient };
      runs.push(run);
      allRuns.push(run);
      if (!guarded) throw new ForbiddenException('businessId is required');
      // Awaited inside the handler, so it runs inside the interceptor's context.
      const rows = await this.prisma.client.contact.findMany({
        where: { businessId: guarded, id: { startsWith: P } },
        select: { id: true, businessId: true },
        orderBy: { id: 'asc' },
      });
      return { guarded, ambient: ambient ?? null, rows };
    }

    @Get('read')
    readGet(@GuardedBusinessId() guarded: string | undefined) {
      return this.read('GET read', guarded);
    }

    @Post('read')
    @HttpCode(200)
    readPost(@GuardedBusinessId() guarded: string | undefined) {
      return this.read('POST read', guarded);
    }

    @Get(':businessId/read')
    readPath(@GuardedBusinessId() guarded: string | undefined) {
      return this.read('GET :businessId/read', guarded);
    }
  }

  /**
   * F1: an AuthGuard-only route (no BusinessGuard), shaped like the ~60 in
   * production. `read` names no businessId of its own, so the rows it returns
   * are exactly the rows the ambient tenant selects. `write` creates a contact
   * in the caller's OWN business (the oldest it owns, as bootstrap resolves
   * it), with businessId named explicitly — under a foreign ambient tenant the
   * extension's forced create would move it.
   */
  @Controller('k24a/open')
  @UseGuards(AuthGuard)
  class OpenProbeController {
    constructor(@Inject(PrismaService) private readonly prisma: InstanceType<typeof PrismaService>) {}

    private record(route: string, req: { user: { id: string } }) {
      const ambient = tenant.getCurrentBusinessId() as unknown;
      openRuns.push({ route, actor: req.user.id, ambient, ambientType: typeof ambient });
      return ambient;
    }

    @Get('read')
    async readOpen(@Req() req: { user: { id: string } }) {
      const ambient = this.record('GET open/read', req);
      const rows = await this.prisma.client.contact.findMany({
        where: { id: { startsWith: `${P}c` } },
        select: { id: true, businessId: true },
        orderBy: { id: 'asc' },
      });
      return { ambient: ambient ?? null, rows };
    }

    @Post('write')
    @HttpCode(200)
    async writeOpen(@Req() req: { user: { id: string } }) {
      const ambient = this.record('POST open/write', req);
      const own = await this.prisma.client.business.findFirst({
        where: { ownerId: req.user.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!own) throw new ForbiddenException('no own business');
      const id = `${P}w_${++writeSeq}`;
      const row = await this.prisma.client.contact.create({
        data: { id, businessId: own.id, firstName: id },
        select: { id: true, businessId: true },
      });
      return { ambient: ambient ?? null, intended: own.id, row };
    }
  }

  // The real IdentityController and IdentityService. The bootstrap route uses
  // only IdentityService (PrismaService underneath); the controller's other
  // collaborators, and IdentityService's BlueprintService/DefaultTriggersService,
  // are not reached on that route and are inert stand-ins. Every one is
  // declared with an explicit @Inject token, so no emitted metadata is needed.
  const inert = (token: unknown) => ({ provide: token as never, useValue: {} });

  const moduleRef = await Test.createTestingModule({
    controllers: [TenantProbeController, OpenProbeController, IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      IdentityService,
      inert(BlueprintService),
      inert(DefaultTriggersService),
      inert(AiUsageService),
      inert(BusinessContextService),
      inert(IdentitySignupService),
      inert(AuthSecurityService),
      inert(IdentityPasswordService),
      inert(SupabaseAdminService),
      inert(REDIS_CLIENT),
      // Installed globally in production (app.module.ts).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [id, name, role] of [
    [ID.ownerA, 'ownerA', 'USER'],
    [ID.staffA, 'staffA', 'USER'],
    [ID.ownerB, 'ownerB', 'USER'],
    [ID.nomember, 'nomember', 'USER'],
    [ID.superAdmin, 'super', 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${name}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K24A Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'K24A Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_staffA_bizA`, userId: ID.staffA, businessId: ID.bizA, role: 'STAFF' } });
  for (const id of A_CONTACTS) await db.contact.create({ data: { id, businessId: ID.bizA, firstName: id } });
  for (const id of B_CONTACTS) await db.contact.create({ data: { id, businessId: ID.bizB, firstName: id } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

beforeEach(() => {
  runs = [];
});

describe('fixture sanity (real rows, production pipeline)', () => {
  it('seeded contacts in two tenants and the staff membership', async () => {
    expect(await db.contact.count({ where: { businessId: ID.bizA, id: { startsWith: P } } })).toBe(2);
    expect(await db.contact.count({ where: { businessId: ID.bizB, id: { startsWith: P } } })).toBe(3);
    expect(await db.membership.count({ where: { businessId: ID.bizA, userId: ID.staffA } })).toBe(1);
  });

  it('the Prisma tenant extension is live in this process and overwrites where.businessId', async () => {
    // Outside a tenant context the extension is inert; inside A's it rewrites
    // even an explicit `where.businessId: B` to A. Without this the cases below
    // would prove nothing about the production pipeline.
    const where = { id: { startsWith: P } };
    expect(await db.contact.count({ where })).toBe(5);
    expect(await tenant.runWithTenant(ID.bizA, ID.ownerA, async () => await db.contact.count({ where }))).toBe(2);
    expect(
      await tenant.runWithTenant(ID.bizA, ID.ownerA, async () => await db.contact.count({ where: { ...where, businessId: ID.bizB } })),
    ).toBe(2);
  });
});

describe('controls: well-formed requests run under the tenant the guard checked (identical before and after)', () => {
  it('a member of A naming ?businessId=A runs under A', async () => {
    for (const actor of [ID.ownerA, ID.staffA]) {
      runs = [];
      expectRanUnderA(await getProbe(actor, `?businessId=${ID.bizA}`), actor);
    }
  });

  it('POST with body {businessId: A} runs under A', async () => {
    const res = await request(server()).post('/k24a/probe/read').set('x-test-user', ID.ownerA).send({ businessId: ID.bizA });
    expectRanUnderA(res, 'POST body A');
  });

  it('a path :businessId wins over a non-string body (params are always strings)', async () => {
    const res = await request(server())
      .get(`/k24a/probe/${ID.bizA}/read`)
      .set('x-test-user', ID.staffA)
      .set('Content-Type', 'application/json')
      .send({ businessId: { not: 'x' } });
    expectRanUnderA(res, 'path A + object body');
  });

  it('B’s owner sending body businessId=B with ?businessId=A runs under B (body precedes query, in the guard and the interceptor alike)', async () => {
    const res = await getWithBody(ID.ownerB, ID.bizA, 'application/json', { businessId: ID.bizB });
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { guarded: ID.bizB, ambient: ID.bizB, rows: ROWS_B },
    });
    expect(runs.map((r) => r.ambient)).toEqual([ID.bizB]);
  });
});

describe('when the guard refuses, nothing runs', () => {
  it('no identity: 401', async () => {
    expectNothingRan(await getProbe(null, `?businessId=${ID.bizA}`), 401, 'anonymous');
  });

  it('a user with no membership: 403', async () => {
    expectNothingRan(await getProbe(ID.nomember, `?businessId=${ID.bizA}`), 403, 'nomember');
  });

  it('a member of A naming the foreign ?businessId=B: 403', async () => {
    expectNothingRan(await getProbe(ID.ownerA, `?businessId=${ID.bizB}`), 403, 'foreign query');
  });

  it('a member of A naming the foreign ?businessId=B behind a body array [A]: 403 (the guard checks B)', async () => {
    expectNothingRan(await getWithBody(ID.ownerA, ID.bizB, 'application/json', { businessId: [ID.bizA] }), 403, 'foreign query + [A]');
  });

  it('a member of A sending body businessId=B with ?businessId=A: 403 (the guard checks the body)', async () => {
    expectNothingRan(await getWithBody(ID.ownerA, ID.bizA, 'application/json', { businessId: ID.bizB }), 403, 'foreign body string');
  });

  it('a member of A naming the tenant only by non-strings: 403', async () => {
    const res = await getProbe(ID.ownerA, '').set('Content-Type', 'application/json').send({ businessId: { equals: ID.bizA } });
    expectNothingRan(res, 403, 'object body only');
    expectNothingRan(await getProbe(ID.ownerA, `?businessId=${ID.bizA}&businessId=${ID.bizB}`), 403, 'repeated query');
  });
});

describe('divergent shapes: a non-string businessId never becomes the ambient tenant', () => {
  // Each sits in the body ahead of the string ?businessId=A that BusinessGuard
  // resolves and checks. At the base the interceptor installed the body value:
  // a filter object reads every tenant or B through the extension; an array,
  // number or boolean is a Prisma validation error (500).
  const BODY_VALUES: Array<[string, unknown]> = [
    ['{not: x} (every tenant)', { not: 'x' }],
    ['{equals: B}', { equals: ID.bizB }],
    ['[B]', [ID.bizB]],
    ['[A]', [ID.bizA]],
    ['42', 42],
    ['true', true],
  ];

  for (const [label, value] of BODY_VALUES) {
    it(`JSON body businessId=${label} with ?businessId=A runs under A, reading only A`, async () => {
      for (const actor of [ID.ownerA, ID.staffA]) {
        runs = [];
        expectRanUnderA(await getWithBody(actor, ID.bizA, 'application/json', { businessId: value }), `${label} / ${actor}`);
      }
    });
  }

  it('POST with JSON body {businessId: {not: x}} and ?businessId=A runs under A', async () => {
    const res = await request(server())
      .post(`/k24a/probe/read?businessId=${ID.bizA}`)
      .set('x-test-user', ID.ownerA)
      .send({ businessId: { not: 'x' } });
    expectRanUnderA(res, 'POST object body');
  });

  it('urlencoded body businessId[not]=x with ?businessId=A runs under A', async () => {
    expectRanUnderA(await getWithBody(ID.staffA, ID.bizA, 'application/x-www-form-urlencoded', 'businessId[not]=x'), 'urlencoded object');
  });

  it(`urlencoded body businessId[]=B with ?businessId=A runs under A`, async () => {
    expectRanUnderA(
      await getWithBody(ID.ownerA, ID.bizA, 'application/x-www-form-urlencoded', `businessId[]=${ID.bizB}`),
      'urlencoded array',
    );
  });

  it('SUPER_ADMIN sending ?businessId=A with an object body runs under A', async () => {
    expectRanUnderA(await getWithBody(ID.superAdmin, ID.bizA, 'application/json', { businessId: { not: 'x' } }), 'super-admin');
  });

  it('SUPER_ADMIN naming the tenant only by a repeated query runs under no tenant (not the array) and is refused by the handler', async () => {
    const res = await getProbe(ID.superAdmin, `?businessId=${ID.bizA}&businessId=${ID.bizB}`);
    expect({ status: res.status, runs: runs.map(({ guarded, ambient, ambientType }) => ({ guarded, ambient, ambientType })) }).toEqual({
      status: 403,
      runs: [{ guarded: undefined, ambient: undefined, ambientType: 'undefined' }],
    });
  });
});

// ── Review finding F1: routes no guard admits a tenant for ───────────────────

/** Membership rows of a business, as the database holds them (no tenant context). */
async function membershipsOf(businessId: string) {
  return db.membership.findMany({
    where: { businessId },
    select: { userId: true, businessId: true, role: true },
    orderBy: { userId: 'asc' },
  });
}

/** Contacts the probe wrote (`k24a_w_*`), by business. */
async function writtenContacts() {
  return db.contact.findMany({
    where: { id: { startsWith: `${P}w_` } },
    select: { id: true, businessId: true },
    orderBy: { id: 'asc' },
  });
}

describe('F1: the real AuthGuard-only bootstrap route writes nothing into a tenant the caller cannot access', () => {
  it('POST /identity/bootstrap?businessId=<B> by A’s owner (no access to B) returns A and leaves B’s memberships untouched', async () => {
    const bBefore = await membershipsOf(ID.bizB);
    const res = await request(server()).post(`/identity/bootstrap?businessId=${ID.bizB}`).set('x-test-user', ID.ownerA).send({});
    expect({ status: res.status, business: res.body?.business?.id }).toEqual({ status: 201, business: ID.bizA });
    // Before the repair: Membership { ownerA, bizB, OWNER } — the upsert keyed
    // to A ran under the ambient tenant B and its create was forced into B.
    expect(await membershipsOf(ID.bizB)).toEqual(bBefore);
    expect(
      await db.membership.findMany({ where: { userId: ID.ownerA }, select: { businessId: true, role: true } }),
    ).toEqual([{ businessId: ID.bizA, role: 'OWNER' }]);
    // And the negative control the escalation bypassed still refuses.
    expectNothingRan(await getProbe(ID.ownerA, `?businessId=${ID.bizB}`), 403, 'BusinessGuard still refuses A’s owner for B');
  });

  it('bootstrap repeated by A’s owner naming B is idempotent and still writes only into A', async () => {
    const res = await request(server()).post(`/identity/bootstrap?businessId=${ID.bizB}`).set('x-test-user', ID.ownerA).send({});
    expect({ status: res.status, business: res.body?.business?.id }).toEqual({ status: 201, business: ID.bizA });
    expect((await membershipsOf(ID.bizB)).map((m: { userId: string }) => m.userId)).toEqual([]);
  });
});

describe('F1: on an AuthGuard-only route a named tenant is ambient only for a caller who can access it', () => {
  const readOpen = (actor: string, qs: string) => request(server()).get(`/k24a/open/read${qs}`).set('x-test-user', actor);
  const ALL_ROWS = [...ROWS_A, ...ROWS_B].sort((x, y) => x.id.localeCompare(y.id));

  it('naming a tenant the caller cannot access is the same as naming none (no ambient tenant, B’s rows not selected)', async () => {
    const baseline = await readOpen(ID.ownerA, '');
    expect({ status: baseline.status, body: baseline.body }).toEqual({ status: 200, body: { ambient: null, rows: ALL_ROWS } });
    for (const [actor, qs] of [
      [ID.ownerA, `?businessId=${ID.bizB}`],
      [ID.staffA, `?businessId=${ID.bizB}`],
      [ID.nomember, `?businessId=${ID.bizA}`],
      [ID.ownerB, `?businessId=${ID.bizA}`],
    ] as const) {
      const res = await readOpen(actor, qs);
      expect({ actor, qs, status: res.status, body: res.body }).toEqual({ actor, qs, status: 200, body: baseline.body });
    }
  });

  it('a foreign tenant named in a JSON body (ahead of the caller’s own ?businessId) installs nothing', async () => {
    const res = await readOpen(ID.ownerA, `?businessId=${ID.bizA}`).set('Content-Type', 'application/json').send({ businessId: ID.bizB });
    expect({ status: res.status, ambient: res.body.ambient }).toEqual({ status: 200, ambient: null });
  });

  it('a create the handler binds to the caller’s own business lands there, not in the named foreign tenant', async () => {
    const res = await request(server()).post(`/k24a/open/write?businessId=${ID.bizB}`).set('x-test-user', ID.ownerA).send({});
    expect({ status: res.status, ambient: res.body.ambient, intended: res.body.intended, landed: res.body.row?.businessId }).toEqual({
      status: 200,
      ambient: null,
      intended: ID.bizA,
      landed: ID.bizA,
    });
    expect((await writtenContacts()).filter((c: { businessId: string }) => c.businessId === ID.bizB)).toEqual([]);
  });

  it('controls: a member, the owner and SUPER_ADMIN still run under the tenant they named (unchanged)', async () => {
    const cases: Array<[string, string, unknown]> = [
      [ID.staffA, ID.bizA, ROWS_A], // member through Membership
      [ID.ownerA, ID.bizA, ROWS_A], // owner through Business.ownerId
      [ID.ownerB, ID.bizB, ROWS_B],
      [ID.superAdmin, ID.bizB, ROWS_B], // BusinessGuard admits SUPER_ADMIN to every tenant
    ];
    for (const [actor, biz, rows] of cases) {
      const res = await readOpen(actor, `?businessId=${biz}`);
      expect({ actor, status: res.status, body: res.body }).toEqual({ actor, status: 200, body: { ambient: biz, rows } });
    }
    const write = await request(server()).post(`/k24a/open/write?businessId=${ID.bizA}`).set('x-test-user', ID.ownerA).send({});
    expect({ ambient: write.body.ambient, landed: write.body.row?.businessId }).toEqual({ ambient: ID.bizA, landed: ID.bizA });
  });

  it('a repeated (array) query names no tenant on this route either', async () => {
    const res = await readOpen(ID.ownerA, `?businessId=${ID.bizA}&businessId=${ID.bizB}`);
    expect({ status: res.status, ambient: res.body.ambient }).toEqual({ status: 200, ambient: null });
  });
});

describe('invariant over every handler run in this suite', () => {
  it('the ambient tenant was exactly the guard-resolved string, or absent when none was named', () => {
    expect(allRuns.length).toBeGreaterThan(20);
    const violations = allRuns.filter((r) => r.ambient !== r.guarded || (r.ambient !== undefined && r.ambientType !== 'string'));
    expect(violations).toEqual([]);
  });

  it('on the AuthGuard-only route every ambient tenant was one the actor owns or belongs to, or the actor was SUPER_ADMIN', async () => {
    expect(openRuns.length).toBeGreaterThan(10);
    const violations = [];
    for (const r of openRuns) {
      if (r.ambient === undefined) continue;
      if (r.ambientType !== 'string') {
        violations.push(r);
        continue;
      }
      const actor = await db.user.findUnique({ where: { id: r.actor }, select: { role: true } });
      if (actor?.role === 'SUPER_ADMIN') continue;
      const access = await db.business.findFirst({
        where: { id: r.ambient, OR: [{ ownerId: r.actor }, { members: { some: { userId: r.actor } } }] },
        select: { id: true },
      });
      if (!access) violations.push(r);
    }
    expect(violations).toEqual([]);
  });
});
