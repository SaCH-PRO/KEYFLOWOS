/**
 * V1-84 (FOLLOW3-D1-TIMELINE-SCOPE) — the business feed's rows follow the
 * caller's module scopes and contact visibility (REAL database).
 *
 * Four reads serve Activity rows of a business:
 *   GET /timeline/businesses/:id/events            (the cockpit feed, V1-25)
 *   GET /timeline/businesses/:id/summary/:date     (rows + revenueImpact of a day)
 *   GET /timeline/businesses/:id/upcoming          (SCHEDULED rows)
 *   GET /api/flows/businesses/:id/activity         (legacy, fetchActivityFeed)
 * At bb6b86d4 each ran AuthGuard + BusinessGuard only and answered every row
 * of the business to every member (SEC-V125-1, SEC-V125-2), and /upcoming
 * and the legacy route took an uncapped parseInt limit (SEC-V125-3).
 *
 * The rule pinned here (owner ruling D-63): a row is served when the caller
 * reads the canonical module its Activity.module maps to (ACTIVITY_MODULE_SCOPES
 * in src/modules/timeline/timeline-visibility.ts, case-folded), and revenue
 * when its category is COMMERCE / PAYMENT / FINANCE or it carries a
 * revenueImpact, and crm when it names a contact, which must also be a contact
 * the caller may open (visibilityClause, M7). A module the table does not map
 * is served to OWNER and ADMIN only; the census spec
 * (timeline-visibility.spec.ts) keeps that set empty at head. Both capped
 * routes answer 400 above TIMELINE_MAX_LIMIT (200), as /events does.
 *
 * TS-07 pins the product change for a STAFF member on role defaults (settings,
 * team, ai and connect are 'none'). Of the module values written at head, these
 * leave that member's feed under the ruling:
 *   ai, agent, key-ai          (-> ai)
 *   site                       (-> settings)
 * and, written nowhere at head but mapped by the table: key_cortex, key_inbox,
 * intelligence, autopilot (-> ai); settings, genome, notifications
 * (-> settings); connect (-> connect); and any unmapped module.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * CrmRateLimitGuard, TimelineController, TimelineService, FlowController's
 * activity route and ActivityService read real rows, with the production
 * GlobalHttpExceptionFilter and ValidationPipe. The one stand-in is identity
 * attachment (a test middleware reads `x-v84a-user`, loads that seeded user
 * and attaches { id, email, role } as AuthMiddleware does after token
 * verification). FlowController's other collaborators are stubs the activity
 * route never calls. Fixtures: prefix `v84a_` (registered in
 * test/helpers/fixture-prefixes.json), hard-deleted by raw SQL through
 * sqlLikePrefix(P) in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84a_';
const HEADER = 'x-v84a-user';
const LIKE = sqlLikePrefix(P);

const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`,
  staffRevNone: `${P}staffRevNone`,
  staffCrmNone: `${P}staffCrmNone`,
  staffOwned: `${P}staffOwned`,
  staffDefault: `${P}staffDefault`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`,       // PRIVATE, owned by the owner
  cTeam: `${P}cTeam`,       // TEAM, owned by the owner
  cStaff: `${P}cStaff`,     // PRIVATE, owned by staffOwned
};

/** The day the main rows sit on: today at local noon (the summary reads local days). */
const DAY = new Date();
DAY.setHours(12, 0, 0, 0);
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_PARAM = `${DAY.getFullYear()}-${pad(DAY.getMonth() + 1)}-${pad(DAY.getDate())}T12:00:00`;

type Seed = { key: string; module: string; category?: string; contactId?: string; revenueImpact?: number; title?: string };

/** The main rows, one per classification case, all on DAY. */
const MAIN: Seed[] = [
  { key: 'payment', module: 'commerce', category: 'PAYMENT', revenueImpact: 150, title: 'Payment recorded: TTD 150' },
  { key: 'finance', module: 'FINANCE', title: 'Invoice v84a-INV-1 posted to ledger' },
  { key: 'crmPriv', module: 'crm', contactId: ID.cPriv, title: 'v84a private contact event' },
  { key: 'crmTeam', module: 'crm', contactId: ID.cTeam },
  { key: 'crmStaff', module: 'crm', contactId: ID.cStaff },
  { key: 'booking', module: 'bookings', category: 'BOOKING' },
  { key: 'procurement', module: 'procurement' },
  { key: 'communications', module: 'communications' },
  { key: 'REVENUE', module: 'REVENUE' },
  { key: 'revenue', module: 'revenue' },
  { key: 'BOOKINGS', module: 'BOOKINGS' },
  { key: 'EXPENSE', module: 'EXPENSE' },
  { key: 'expenses', module: 'expenses' },
  { key: 'ai', module: 'ai', category: 'AI' },
  { key: 'key_cortex', module: 'key_cortex' },
  { key: 'settings', module: 'settings' },
  { key: 'unmapped', module: `${P}unmapped` },
];
const rowId = (key: string) => `${P}act_${key}`;
const ALL_MAIN = MAIN.map((s) => rowId(s.key));

/** Rows only revenue readers may see. */
const REVENUE_ROWS = ['payment', 'finance', 'REVENUE', 'revenue'].map(rowId);
/** Rows naming a contact. */
const CONTACT_ROWS = ['crmPriv', 'crmTeam', 'crmStaff'].map(rowId);

/** 201 SCHEDULED rows: 200 bookings rows and one commerce (PAYMENT) row, older than DAY. */
const SCHEDULED_COUNT = 201;
const scheduledId = (i: number) => `${P}sch_${String(i).padStart(3, '0')}`;
const SCHEDULED_REVENUE = scheduledId(0);

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE id LIKE ${LIKE} OR business_id LIKE ${LIKE}`,
    `DELETE FROM contact_shares WHERE contact_id LIKE ${LIKE}`,
    `DELETE FROM contacts WHERE id LIKE ${LIKE} OR business_id LIKE ${LIKE}`,
    `DELETE FROM memberships WHERE id LIKE ${LIKE} OR business_id LIKE ${LIKE}`,
    `DELETE FROM businesses WHERE id LIKE ${LIKE}`,
    `DELETE FROM users WHERE id LIKE ${LIKE}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function leftovers(): Promise<number> {
  let n = 0;
  for (const table of ['activities', 'contacts', 'memberships', 'businesses', 'users']) {
    const rows = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${table} WHERE id LIKE ${LIKE}`);
    n += rows[0].n;
  }
  return n;
}

const agent = () => request(app.getHttpServer());

function events(user: string, query = 'limit=200', biz = ID.bizA) {
  return agent().get(`/timeline/businesses/${biz}/events?${query}`).set(HEADER, user);
}
function summary(user: string, biz = ID.bizA) {
  return agent().get(`/timeline/businesses/${biz}/summary/${DAY_PARAM}`).set(HEADER, user);
}
function upcoming(user: string, query = 'limit=200', biz = ID.bizA) {
  return agent().get(`/timeline/businesses/${biz}/upcoming?${query}`).set(HEADER, user);
}
function legacy(user: string, query = 'limit=200', biz = ID.bizA) {
  return agent().get(`/api/flows/businesses/${biz}/activity?${query}`).set(HEADER, user);
}

/** The ids of an array answer (asserting 200 + array). */
async function ids(res: request.Response | Promise<request.Response>): Promise<string[]> {
  const r = await res;
  expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
  expect(Array.isArray(r.body)).toBe(true);
  return r.body.map((row: { id: string }) => row.id);
}

/** The main rows (the seeded day's rows) the caller sees on /events. */
async function mainSeen(user: string): Promise<string[]> {
  const all = await ids(events(user));
  return all.filter((id) => ALL_MAIN.includes(id)).sort();
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TimelineController } = await import('../src/modules/timeline/timeline.controller');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { QueryTimelineDto } = await import('../src/modules/timeline/dto/query-timeline.dto');
  const { FlowController } = await import('../src/modules/flow/flow.controller');
  const { FlowService } = await import('../src/modules/flow/flow.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { CrossModuleAgentService } = await import('../src/modules/flow/cross-module-agent.service');
  const { FlowEngineService } = await import('../src/modules/flow/flow-engine.service');
  const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
  const { FlowTemplateService } = await import('../src/modules/flow/flow-template.service');

  // What tsc emits (the test transform emits no design:paramtypes): the two
  // controllers' typed constructor collaborators and queryEvents' DTO, so the
  // ValidationPipe applies QueryTimelineDto here as in the built server.
  if (!Reflect.getMetadata('design:paramtypes', TimelineController)) {
    Reflect.defineMetadata('design:paramtypes', [TimelineService], TimelineController);
  }
  if (!Reflect.getMetadata('design:paramtypes', TimelineController.prototype, 'queryEvents')) {
    Reflect.defineMetadata('design:paramtypes', [String, QueryTimelineDto], TimelineController.prototype, 'queryEvents');
  }
  Reflect.defineMetadata('design:paramtypes', [
    FlowService, ActivityService, CrossModuleAgentService, PrismaService,
    FlowEngineService, FlowRunnerService, FlowTemplateService,
  ], FlowController);

  const moduleRef = await Test.createTestingModule({
    controllers: [TimelineController, FlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TimelineService,
      ActivityService,
      // FlowController collaborators the activity route never calls.
      { provide: FlowService, useValue: {} },
      { provide: CrossModuleAgentService, useValue: {} },
      { provide: FlowEngineService, useValue: {} },
      { provide: FlowRunnerService, useValue: {} },
      { provide: FlowTemplateService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.admin, ID.staffRevNone, ID.staffCrmNone, ID.staffOwned, ID.staffDefault, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84A Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84A Biz B', ownerId: ID.ownerB } });

  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staffRevNone, ID.bizA, 'STAFF', { crm: 'read', revenue: 'none', bookings: 'read', operations: 'read' });
  await m(ID.staffCrmNone, ID.bizA, 'STAFF', { crm: 'none', revenue: 'read' });
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'read', crm_view: 'owned', revenue: 'read' });
  await m(ID.staffDefault, ID.bizA, 'STAFF');
  await m(ID.ownerB, ID.bizB, 'OWNER');

  await db.contact.create({ data: { id: ID.cPriv, businessId: ID.bizA, firstName: 'Priv', visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cTeam, businessId: ID.bizA, firstName: 'Team', visibility: 'TEAM', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cStaff, businessId: ID.bizA, firstName: 'Staff', visibility: 'PRIVATE', ownerId: ID.staffOwned } });

  await db.activity.createMany({
    data: MAIN.map((s, i) => ({
      id: rowId(s.key),
      businessId: ID.bizA,
      module: s.module,
      action: `${P}${s.key}`,
      entityType: 'v84a_entity',
      title: s.title ?? `v84a ${s.key} row`,
      category: s.category ?? null,
      contactId: s.contactId ?? null,
      revenueImpact: s.revenueImpact ?? null,
      occurredAt: new Date(DAY.getTime() - i * 1000),
      // Explicit, so the legacy route's createdAt order is deterministic.
      createdAt: new Date(DAY.getTime() - i * 1000),
    })),
  });
  const older = new Date(DAY.getTime() - 3 * 86_400_000);
  const soon = Date.now() + 3_600_000;
  await db.activity.createMany({
    data: Array.from({ length: SCHEDULED_COUNT }, (_, i) => ({
      id: scheduledId(i),
      businessId: ID.bizA,
      module: i === 0 ? 'commerce' : 'bookings',
      category: i === 0 ? 'PAYMENT' : 'BOOKING',
      revenueImpact: i === 0 ? 75 : null,
      action: 'scheduled',
      entityType: 'v84a_entity',
      title: i === 0 ? 'Invoice v84a-INV-2 due: TTD 75' : `v84a booking ${i}`,
      status: 'SCHEDULED',
      startsAt: new Date(soon + i * 60_000),
      occurredAt: new Date(older.getTime() - i * 1000),
      createdAt: new Date(older.getTime() - i * 1000),
    })),
  });
  // A row of B, which no A read may serve.
  await db.activity.create({
    data: { id: `${P}act_bizB`, businessId: ID.bizB, module: 'crm', action: 'x', entityType: 'v84a_entity', title: 'v84a B row', occurredAt: DAY },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

describe('V1-84: revenue rows (TS-01, TS-04)', () => {
  it("TS-01: a STAFF member with revenue 'none' gets no revenue row (module commerce / FINANCE / REVENUE / revenue, category PAYMENT, any revenueImpact) from /events, and still gets the rows of the modules they read", async () => {
    const res = await events(ID.staffRevNone);
    const seen = await ids(res);
    expect(seen.filter((id) => REVENUE_ROWS.includes(id)), 'revenue rows').toEqual([]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Payment recorded: TTD 150');
    expect(text).not.toContain('v84a-INV-1');
    expect(res.body.filter((r: any) => r.revenueImpact !== null && r.revenueImpact !== undefined)).toEqual([]);
    expect(res.body.filter((r: any) => ['COMMERCE', 'PAYMENT', 'FINANCE'].includes(String(r.category).toUpperCase()))).toEqual([]);
    for (const key of ['crmTeam', 'booking', 'procurement', 'communications', 'BOOKINGS']) {
      expect(seen, `${key} (a module this member reads)`).toContain(rowId(key));
    }
  });

  it("TS-04: the summary of the day, for a STAFF member with revenue 'none', lists no payment row and reports revenueImpact 0; the owner's reports 150", async () => {
    const res = await summary(ID.staffRevNone);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const seen = res.body.events.map((e: any) => e.id);
    expect(seen.filter((id: string) => REVENUE_ROWS.includes(id))).toEqual([]);
    expect(res.body.revenueImpact).toBe(0);
    expect(res.body.eventCount).toBe(res.body.events.length);

    const own = await summary(ID.owner);
    expect(own.status).toBe(200);
    expect(own.body.revenueImpact).toBe(150);
    expect(own.body.events.map((e: any) => e.id)).toContain(rowId('payment'));
  });
});

describe('V1-84: contact rows (TS-02, TS-03)', () => {
  it("TS-02: a member with crm 'none' gets no row that names a contact, and ?contactId= answers 200 []", async () => {
    const res = await events(ID.staffCrmNone);
    const seen = await ids(res);
    expect(seen.filter((id) => CONTACT_ROWS.includes(id))).toEqual([]);
    expect(res.body.filter((r: any) => r.contactId)).toEqual([]);
    expect(await ids(events(ID.staffCrmNone, `limit=50&contactId=${ID.cTeam}`))).toEqual([]);
    // The revenue rows this member does read are still served.
    expect(seen).toContain(rowId('payment'));
  });

  it("TS-03: the row naming the owner's PRIVATE contact is absent for a crm_view 'owned' STAFF member and for ADMIN; the TEAM-contact row is present for ADMIN (view-all), and the owned-view member sees the row of their own contact", async () => {
    const owned = await mainSeen(ID.staffOwned);
    expect(owned).not.toContain(rowId('crmPriv'));
    expect(owned, 'owned view: not their contact').not.toContain(rowId('crmTeam'));
    expect(owned, 'owned view: their own contact').toContain(rowId('crmStaff'));

    const admin = await mainSeen(ID.admin);
    expect(admin).not.toContain(rowId('crmPriv'));
    expect(admin).toContain(rowId('crmTeam'));
    expect(await ids(events(ID.admin, `limit=50&contactId=${ID.cPriv}`))).toEqual([]);

    const ownerRows = await ids(events(ID.owner, `limit=50&contactId=${ID.cPriv}`));
    expect(ownerRows).toEqual([rowId('crmPriv')]);
  });
});

describe('V1-84: the capped and filtered sibling reads (TS-05)', () => {
  it('TS-05a: GET .../upcoming answers 400 above 200 (and for a limit that is not a positive integer), and at most 200 rows at 200', async () => {
    for (const limit of ['100000', '201', '0', '-1', '2.5', 'abc']) {
      const res = await upcoming(ID.owner, `limit=${limit}`);
      expect(res.status, `limit=${limit}`).toBe(400);
      expect(Array.isArray(res.body)).toBe(false);
    }
    const at200 = await ids(upcoming(ID.owner, 'limit=200'));
    expect(at200.length).toBe(200);
    expect((await ids(upcoming(ID.owner))).length).toBeLessThanOrEqual(200);
    expect((await ids(upcoming(ID.owner, ''))).length, 'default page').toBe(50);
  });

  it('TS-05b: /upcoming is filtered like /events: no revenue row for revenue none; nothing for a member who reads neither bookings nor revenue', async () => {
    const revNone = await ids(upcoming(ID.staffRevNone));
    expect(revNone).not.toContain(SCHEDULED_REVENUE);
    expect(revNone.length).toBe(200);
    const crmNone = await ids(upcoming(ID.staffCrmNone)); // revenue read, bookings none
    expect(crmNone).toEqual([SCHEDULED_REVENUE]);
  });

  it('TS-05c: the legacy GET /api/flows/businesses/:id/activity answers 400 above 200, and applies the same row filter as /events', async () => {
    for (const limit of ['100000', '201', '0', '-1', '2.5', 'abc']) {
      const res = await legacy(ID.owner, `limit=${limit}`);
      expect(res.status, `limit=${limit}`).toBe(400);
      expect(Array.isArray(res.body)).toBe(false);
    }
    expect((await ids(legacy(ID.owner, 'limit=200'))).length).toBe(200);

    const revNone = await ids(legacy(ID.staffRevNone));
    expect(revNone.filter((id) => REVENUE_ROWS.includes(id) || id === SCHEDULED_REVENUE)).toEqual([]);
    const crmNone = await ids(legacy(ID.staffCrmNone));
    expect(crmNone.filter((id) => CONTACT_ROWS.includes(id))).toEqual([]);
    const owned = await ids(legacy(ID.staffOwned));
    expect(owned).not.toContain(rowId('crmPriv'));
    // ?module= narrows within what the caller may see.
    expect(await ids(legacy(ID.staffRevNone, 'limit=50&module=commerce'))).toEqual([]);
    expect((await ids(legacy(ID.owner, 'limit=50&module=commerce'))).sort()).toEqual([rowId('payment'), SCHEDULED_REVENUE].sort());
  });
});

describe('V1-84: case-folded classification (TS-06)', () => {
  it("TS-06: 'REVENUE', 'BOOKINGS' and 'EXPENSE' rows are served exactly when 'revenue', 'bookings' and 'expenses' rows are", async () => {
    const pairs: Array<[string, string]> = [['REVENUE', 'revenue'], ['BOOKINGS', 'booking'], ['EXPENSE', 'expenses']];
    for (const user of [ID.owner, ID.admin, ID.staffRevNone, ID.staffCrmNone, ID.staffOwned, ID.staffDefault]) {
      const seen = await mainSeen(user);
      for (const [upper, lower] of pairs) {
        expect(seen.includes(rowId(upper)), `${user}: ${upper} like ${lower}`).toBe(seen.includes(rowId(lower)));
      }
    }
    const revNone = await mainSeen(ID.staffRevNone); // revenue none, bookings read, expenses absent (none)
    expect(revNone).not.toContain(rowId('REVENUE'));
    expect(revNone).toContain(rowId('BOOKINGS'));
    expect(revNone).not.toContain(rowId('EXPENSE'));
    const crmNone = await mainSeen(ID.staffCrmNone); // revenue read, bookings absent (none)
    expect(crmNone).toContain(rowId('REVENUE'));
    expect(crmNone).not.toContain(rowId('BOOKINGS'));
  });
});

describe('V1-84: the ruling (TS-07, TS-08)', () => {
  it('TS-07: a STAFF member on role defaults sees every main row whose module maps outside settings, team, ai and connect (less the PRIVATE contact they cannot open and the unmapped row), and none of the ai / key_cortex / settings rows', async () => {
    const seen = await mainSeen(ID.staffDefault);
    const hidden = ['ai', 'key_cortex', 'settings', 'unmapped', 'crmPriv', 'crmStaff'].map(rowId);
    expect(seen).toEqual(ALL_MAIN.filter((id) => !hidden.includes(id)).sort());
  });

  it('TS-07b: the owner sees every row on all four reads', async () => {
    expect(await mainSeen(ID.owner)).toEqual([...ALL_MAIN].sort());
    const day = await summary(ID.owner);
    expect(day.status).toBe(200);
    expect(day.body.events.map((e: any) => e.id).sort()).toEqual([...ALL_MAIN].sort());
    const up = await ids(upcoming(ID.owner, 'limit=200'));
    expect(up).toEqual(Array.from({ length: 200 }, (_, i) => scheduledId(i)));
    // createdAt desc: the main rows, then the newest scheduled rows.
    const leg = await ids(legacy(ID.owner, 'limit=200'));
    const expected = [...ALL_MAIN, ...Array.from({ length: 200 - ALL_MAIN.length }, (_, i) => scheduledId(i))];
    expect(leg.sort()).toEqual(expected.sort());
  });

  it('TS-08: a row whose module the table does not map is served to OWNER and ADMIN only', async () => {
    const unmapped = rowId('unmapped');
    expect(await mainSeen(ID.owner)).toContain(unmapped);
    expect(await mainSeen(ID.admin)).toContain(unmapped);
    for (const user of [ID.staffDefault, ID.staffRevNone, ID.staffCrmNone, ID.staffOwned]) {
      expect(await mainSeen(user), user).not.toContain(unmapped);
    }
  });
});

describe('V1-84: tenant control (TS-09) and cleanup (TS-10)', () => {
  it("TS-09 CONTROL: B's member gets 403 on all four of A's reads, and A's reads serve none of B's rows", async () => {
    for (const res of [await events(ID.ownerB), await summary(ID.ownerB), await upcoming(ID.ownerB), await legacy(ID.ownerB)]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(`${P}act_`);
    }
    expect(await ids(events(ID.owner))).not.toContain(`${P}act_bizB`);
  });

  it('TS-10: the suite leaves no v84a_ row behind', async () => {
    await cleanup();
    expect(await leftovers()).toBe(0);
  });
});
