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
 * Review repairs (TS-11..TS-14):
 *   ST-1  a row names a contact through entityType 'contact' + entityId as well
 *         as through contactId (the KEY send-message row, written here through
 *         the real ActivityLogService.createActivity, has no contactId): it
 *         needs crm read and a contact the caller may open.
 *   CR-1  a soft-deleted contact is judged by its visibility, so a view-all
 *         ADMIN keeps the money and history rows of a deleted TEAM contact
 *         (and their revenueImpact in the day summary). An id that is no
 *         contact of the business stays withheld from every member
 *         visibilityClause restricts (nothing to judge it by).
 *   ST-2, ST-3 are follow-ups outside the write set (it.todo, TS-13, TS-14).
 *   TS-14 (ST-3) is live since W5-BRIEFING-SCOPE (D-63): the morning briefing
 *   (AiController.morningBriefing) reads through the same rule.
 *   TS-15..TS-17 (W6-BRIEFINGS-SCOPE, D-63; reviews SEC-W5BS-1, SEC-W5BS-2,
 *   CR-W5BS-1): the end-of-day briefing and the daily briefing's cards follow
 *   it too, and the morning briefing fills its page past a batch of hidden rows.
 *   TS-18, TS-19 (W6-BRIEFINGS-SCOPE review CR-W6BS-1, CR-W6BS-2, SEC-W6BS-3):
 *   the end-of-day count is not cut at 1000 rows, and concurrent first reads
 *   write one daily briefing. Two other briefing routes are follow-ups outside
 *   that write set (it.todo, TS-20 SEC-W6BS-1, TS-21 SEC-W6BS-2).
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

const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`,
  staffRevNone: `${P}staffRevNone`,
  staffCrmNone: `${P}staffCrmNone`,
  staffOwned: `${P}staffOwned`,
  staffDefault: `${P}staffDefault`,
  staffAiCrm: `${P}staffAiCrm`,   // crm read, ai read
  staffAiOnly: `${P}staffAiOnly`, // crm none, ai read
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`,       // PRIVATE, owned by the owner
  cTeam: `${P}cTeam`,       // TEAM, owned by the owner
  cStaff: `${P}cStaff`,     // PRIVATE, owned by staffOwned
  cDelTeam: `${P}cDelTeam`, // TEAM, owned by the owner, soft-deleted
  cDelPriv: `${P}cDelPriv`, // PRIVATE, owned by the owner, soft-deleted
  cGone: `${P}cGone`,       // no contact row at all (hard-deleted / never a contact)
};

/** The day the main rows sit on: today at local noon (the summary reads local days). */
const DAY = new Date();
DAY.setHours(12, 0, 0, 0);
const pad = (n: number) => String(n).padStart(2, '0');
const DAY_PARAM = `${DAY.getFullYear()}-${pad(DAY.getMonth() + 1)}-${pad(DAY.getDate())}T12:00:00`;

/**
 * The review-repair rows (TS-11, TS-12) sit five days back, older than every
 * row the main pages read, so the main cases are unchanged; they are read
 * through from/to (/events), the day's summary and cursor (legacy).
 */
const OLD = new Date(DAY.getTime() - 5 * 86_400_000);
const OLD_PARAM = `${OLD.getFullYear()}-${pad(OLD.getMonth() + 1)}-${pad(OLD.getDate())}T12:00:00`;
const OLD_WINDOW = `from=${new Date(OLD.getTime() - 3_600_000).toISOString()}&to=${new Date(OLD.getTime() + 3_600_000).toISOString()}`;
const OLD_CURSOR = `cursor=${new Date(OLD.getTime() + 86_400_000).toISOString()}`;
const oldId = (key: string) => `${P}old_${key}`;
/** Ids of the two rows written through ActivityLogService.createActivity (cuid ids). */
const KEY_ROW: { priv: string; team: string } = { priv: '', team: '' };

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
    `DELETE FROM activities WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    // W6-BRIEFINGS-SCOPE (TS-15, TS-16): the day's booking and its service (Booking.contact and
    // Booking.service are NoAction) and the daily briefing plan generateBriefing writes (cuid ids).
    `DELETE FROM bookings WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // W5-BRIEFING-SCOPE (TS-14): its invoices (Invoice.contact is NoAction).
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function leftovers(): Promise<number> {
  let n = 0;
  for (const table of ['activities', 'contacts', 'memberships', 'businesses', 'users']) {
    const rows = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${table} WHERE id LIKE ${sqlLikePrefix(P)}`);
    n += rows[0].n;
  }
  return n;
}

const agent = () => request(app.getHttpServer());

function events(user: string, query = 'limit=200', biz = ID.bizA) {
  return agent().get(`/timeline/businesses/${biz}/events?${query}`).set(HEADER, user);
}
function summary(user: string, biz = ID.bizA, day = DAY_PARAM) {
  return agent().get(`/timeline/businesses/${biz}/summary/${day}`).set(HEADER, user);
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

  for (const id of [ID.owner, ID.admin, ID.staffRevNone, ID.staffCrmNone, ID.staffOwned, ID.staffDefault, ID.staffAiCrm, ID.staffAiOnly, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}u_${id.slice(P.length)}@test.local`, role: 'USER' } });
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
  await m(ID.staffAiCrm, ID.bizA, 'STAFF', { crm: 'read', ai: 'read' });
  await m(ID.staffAiOnly, ID.bizA, 'STAFF', { crm: 'none', ai: 'read' });
  await m(ID.ownerB, ID.bizB, 'OWNER');

  await db.contact.create({ data: { id: ID.cPriv, businessId: ID.bizA, firstName: 'Priv', visibility: 'PRIVATE', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cTeam, businessId: ID.bizA, firstName: 'Team', visibility: 'TEAM', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.cStaff, businessId: ID.bizA, firstName: 'Staff', visibility: 'PRIVATE', ownerId: ID.staffOwned } });
  await db.contact.create({ data: { id: ID.cDelTeam, businessId: ID.bizA, firstName: 'DelTeam', visibility: 'TEAM', ownerId: ID.owner, deletedAt: new Date() } });
  await db.contact.create({ data: { id: ID.cDelPriv, businessId: ID.bizA, firstName: 'DelPriv', visibility: 'PRIVATE', ownerId: ID.owner, deletedAt: new Date() } });

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
  // CR-1: money and history rows of a soft-deleted TEAM contact, a
  // soft-deleted PRIVATE contact and an id that is no contact, on OLD.
  const OLD_ROWS: Seed[] = [
    { key: 'payDelTeam', module: 'payments', category: 'PAYMENT', contactId: ID.cDelTeam, revenueImpact: 40 },
    { key: 'payDelPriv', module: 'payments', category: 'PAYMENT', contactId: ID.cDelPriv, revenueImpact: 7 },
    { key: 'payGone', module: 'payments', category: 'PAYMENT', contactId: ID.cGone, revenueImpact: 3 },
    { key: 'crmDelTeam', module: 'crm', contactId: ID.cDelTeam },
  ];
  await db.activity.createMany({
    data: OLD_ROWS.map((s, i) => ({
      id: oldId(s.key),
      businessId: ID.bizA,
      module: s.module,
      action: `${P}${s.key}`,
      entityType: 'v84a_entity',
      title: `v84a ${s.key} row`,
      category: s.category ?? null,
      contactId: s.contactId ?? null,
      revenueImpact: s.revenueImpact ?? null,
      occurredAt: new Date(OLD.getTime() - i * 1000),
      createdAt: new Date(OLD.getTime() - i * 1000),
    })),
  });
  // ST-1: the KEY send-message row as its writer produces it
  // (flow-orchestrator.service.ts, send-message tool): entityType 'contact',
  // entityId, the contact's name in the title, the message in the detail, no
  // contactId. Written through the real ActivityLogService, then dated to OLD.
  const { ActivityLogService } = await import('../src/modules/activity/activity.service');
  const activityLog = new ActivityLogService(app.get(PrismaService));
  const keyRow = async (entityType: string, entityId: string, name: string, body: string, at: number) => {
    const row = await activityLog.createActivity({
      businessId: ID.bizA, module: 'ai', action: 'message_sent', entityType, entityId,
      title: `Message sent to ${name} via email`, detail: body.slice(0, 200), tone: 'success',
    });
    await db.activity.update({ where: { id: row.id }, data: { occurredAt: new Date(at), createdAt: new Date(at) } });
    return row.id as string;
  };
  KEY_ROW.priv = await keyRow('contact', ID.cPriv, 'v84a Secret Client', 'Hi Secret, about your confidential matter', OLD.getTime() - 10_000);
  KEY_ROW.team = await keyRow('Contact', ID.cTeam, 'v84a Team Client', 'Hello team client', OLD.getTime() - 11_000);

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

describe('V1-84 review ST-1: a row naming its contact by entityType contact + entityId (TS-11)', () => {
  const window = (user: string) => ids(events(user, `limit=200&${OLD_WINDOW}`));

  it("TS-11a: ADMIN, who cannot open the owner's PRIVATE contact, is not served the KEY send-message row naming it (no name, no message text), nor through ?entityType=contact&entityId=; the TEAM contact's row is served (entityType case-folded)", async () => {
    const res = await events(ID.admin, `limit=200&${OLD_WINDOW}`);
    const seen = await ids(res);
    expect(seen).not.toContain(KEY_ROW.priv);
    expect(seen).toContain(KEY_ROW.team);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Secret Client');
    expect(text).not.toContain('confidential matter');
    expect(await ids(events(ID.admin, `limit=50&entityType=contact&entityId=${ID.cPriv}`))).toEqual([]);
    expect(await ids(events(ID.admin, `limit=50&contactId=${ID.cPriv}`))).toEqual([]);
    const day = await summary(ID.admin, ID.bizA, OLD_PARAM);
    expect(day.status).toBe(200);
    expect(day.body.events.map((e: any) => e.id)).not.toContain(KEY_ROW.priv);
    expect(JSON.stringify(day.body)).not.toContain('Secret Client');

    const owner = await window(ID.owner);
    expect(owner).toEqual(expect.arrayContaining([KEY_ROW.priv, KEY_ROW.team]));
    expect(await ids(events(ID.owner, `limit=50&entityType=contact&entityId=${ID.cPriv}`))).toEqual([KEY_ROW.priv]);
  });

  it('TS-11b: a STAFF member with crm read and ai read is served the TEAM row and not the PRIVATE row, on /events, the summary and the legacy route', async () => {
    const seen = await window(ID.staffAiCrm);
    expect(seen).not.toContain(KEY_ROW.priv);
    expect(seen).toContain(KEY_ROW.team);
    const day = await summary(ID.staffAiCrm, ID.bizA, OLD_PARAM);
    expect(day.status).toBe(200);
    expect(day.body.events.map((e: any) => e.id)).not.toContain(KEY_ROW.priv);
    const leg = await ids(legacy(ID.staffAiCrm, `limit=200&${OLD_CURSOR}`));
    expect(leg).not.toContain(KEY_ROW.priv);
    expect(leg).toContain(KEY_ROW.team);
  });

  it("TS-11c: a member with ai read and crm 'none' is served neither KEY row (they name contacts), on /events, ?entityType=&entityId= and the legacy route, and still gets the ai row that names no contact", async () => {
    const seen = await window(ID.staffAiOnly);
    expect(seen).not.toContain(KEY_ROW.priv);
    expect(seen).not.toContain(KEY_ROW.team);
    expect(await ids(events(ID.staffAiOnly, `limit=50&entityType=Contact&entityId=${ID.cTeam}`))).toEqual([]);
    const leg = await ids(legacy(ID.staffAiOnly, `limit=200&${OLD_CURSOR}`));
    expect(leg).not.toContain(KEY_ROW.priv);
    expect(leg).not.toContain(KEY_ROW.team);
    expect(await mainSeen(ID.staffAiOnly)).toContain(rowId('ai'));
  });
});

describe('V1-84 review CR-1: rows of a soft-deleted contact (TS-12)', () => {
  it("TS-12a: a view-all ADMIN keeps the payment and history rows of a soft-deleted TEAM contact, and the day's revenueImpact counts the payment; a soft-deleted PRIVATE contact's row and a row naming no contact of the business stay withheld", async () => {
    const own = await summary(ID.owner, ID.bizA, OLD_PARAM);
    expect(own.status).toBe(200);
    const ownIds = own.body.events.map((e: any) => e.id);
    expect(ownIds).toEqual(expect.arrayContaining(['payDelTeam', 'payDelPriv', 'payGone', 'crmDelTeam'].map(oldId)));
    expect(own.body.revenueImpact).toBe(50);

    const adm = await summary(ID.admin, ID.bizA, OLD_PARAM);
    expect(adm.status).toBe(200);
    const admIds = adm.body.events.map((e: any) => e.id);
    expect(admIds).toEqual(expect.arrayContaining([oldId('payDelTeam'), oldId('crmDelTeam')]));
    expect(admIds).not.toContain(oldId('payDelPriv'));
    expect(admIds).not.toContain(oldId('payGone'));
    expect(adm.body.revenueImpact).toBe(40);
    expect(adm.body.eventCount).toBe(adm.body.events.length);

    const seen = await ids(events(ID.admin, `limit=200&${OLD_WINDOW}`));
    expect(seen).toEqual(expect.arrayContaining([oldId('payDelTeam'), oldId('crmDelTeam')]));
    expect(await ids(legacy(ID.admin, `limit=200&${OLD_CURSOR}`))).toContain(oldId('payDelTeam'));
  });

  it("TS-12b: the deleted contact is still judged by its visibility: a crm_view 'owned' member does not get the deleted TEAM contact's rows; a crm read member with revenue 'none' gets its history row only", async () => {
    const owned = await ids(events(ID.staffOwned, `limit=200&${OLD_WINDOW}`));
    expect(owned).not.toContain(oldId('payDelTeam'));
    expect(owned).not.toContain(oldId('crmDelTeam'));
    const revNone = await ids(events(ID.staffRevNone, `limit=200&${OLD_WINDOW}`));
    expect(revNone).toContain(oldId('crmDelTeam'));
    expect(revNone).not.toContain(oldId('payDelTeam'));
  });
});

describe('V1-84 review follow-up outside the write set (TS-13)', () => {
  it.todo(
    "TS-13 (review ST-2): a row that names a contact only in its title / detail (KEY send_invoice 'Invoice <n> sent to <contactName>', module commerce, flow-orchestrator.service.ts; message_intake.approved, detail = plan summary, message-intake-orchestrator.service.ts) is served to a revenue / communications reader who may not open that contact. Closing it needs those writers to set contactId, outside V1-84's write set; timeline-visibility.spec.ts TV-07 lists them (TEXT_ONLY_CONTACT_WRITERS) and fails on any new one",
  );
});

/**
 * W5-BRIEFING-SCOPE (review ST-3 / SEC-W4TS-1, = evidence-feed EF-17; owner
 * ruling D-63, the rule V1-84 built in timeline-visibility.ts): GET
 * /ai/businesses/:businessId/briefing/morning (AiController.morningBriefing,
 * AuthGuard + BusinessGuard, no module scope) served the last 24h of SCHEDULED
 * Activity rows, revenueImpact included, revenueToday, openInvoices and
 * activeLeads to every member, unfiltered. The real AiController is mounted on
 * its own app over this suite's PrismaService and identity header; its other
 * collaborators are empty stand-ins the route never calls. The case writes its
 * own rows (SCHEDULED within the last day), invoices and lead scores, and
 * removes them when it ends, so the cases above and below read what they did.
 */
describe('W5-BRIEFING-SCOPE (D-63): the morning briefing follows the timeline rule (TS-14)', () => {
  let briefingApp: any;
  afterAll(async () => {
    if (briefingApp) await briefingApp.close();
  });

  async function briefing(user: string, biz = ID.bizA): Promise<request.Response> {
    if (!briefingApp) {
      const { Test } = await import('@nestjs/testing');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
      const { PrismaService } = await import('../src/core/prisma/prisma.service');
      const { AuthGuard } = await import('../src/core/auth/auth.guard');
      const { BusinessGuard } = await import('../src/core/auth/business.guard');
      const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
      const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
      const { AiController } = await import('../src/modules/ai/ai.controller');
      const ref = await Test.createTestingModule({
        controllers: [AiController],
        providers: [
          { provide: PrismaService, useValue: app.get(PrismaService) },
          AuthGuard,
          BusinessGuard,
          ModuleScopeGuard,
          CrmRateLimitGuard,
          { provide: EventEmitter2, useValue: { emit: () => true } },
        ],
      })
        .useMocker(() => ({}))
        .compile();
      briefingApp = ref.createNestApplication();
      // Identity attachment only, as the suite's app does. No guard is overridden.
      briefingApp.use(async (req: any, _res: any, next: any) => {
        const header = req.headers[HEADER];
        const id = typeof header === 'string' ? header : undefined;
        if (id && id.startsWith(P)) {
          const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
          if (user) req.user = { id: user.id, email: user.email, role: user.role };
        }
        next();
      });
      briefingApp.useGlobalFilters(new GlobalHttpExceptionFilter());
      await briefingApp.init();
    }
    return request(briefingApp.getHttpServer()).get(`/ai/businesses/${biz}/briefing/morning`).set(HEADER, user);
  }

  it("TS-14 (review ST-3, SEC-W4TS-1, D-63, W5-BRIEFING-SCOPE, was it.todo): GET /ai/businesses/:businessId/briefing/morning serves each member only the SCHEDULED rows of the last day that the timeline rule serves them (module scope, revenue read for a money row, crm read and an openable contact for a row naming one, OWNER / ADMIN for an unmapped module), reports revenueToday and openInvoices 0 to a member without revenue read, and counts in activeLeads only the leads the member may list; the OWNER's briefing keeps every row and figure", async () => {
    const brief = (key: string) => `${P}brf_${key}`;
    const now = Date.now();
    const ROWS: Array<Seed & { entityType?: string; entityId?: string }> = [
      { key: 'pay', module: 'commerce', category: 'PAYMENT', revenueImpact: 90, title: 'Invoice v84a-INV-9 due: TTD 90' },
      { key: 'finance', module: 'FINANCE', title: 'v84a-INV-8 posting due' },
      { key: 'booking', module: 'bookings', category: 'BOOKING' },
      { key: 'crmPriv', module: 'crm', contactId: ID.cPriv, title: 'v84a private contact follow-up' },
      { key: 'crmTeam', module: 'crm', contactId: ID.cTeam },
      { key: 'crmStaff', module: 'crm', contactId: ID.cStaff },
      // ST-1: a row naming its contact by entityType 'contact' + entityId only.
      { key: 'keyPriv', module: 'ai', entityType: 'contact', entityId: ID.cPriv, title: 'Message to v84a Secret Client scheduled' },
      { key: 'ai', module: 'ai', category: 'AI' },
      { key: 'unmapped', module: `${P}unmapped` },
    ];
    const LEADS = [ID.cPriv, ID.cTeam, ID.cStaff, ID.cDelTeam];
    try {
      await db.activity.createMany({
        data: ROWS.map((s, i) => ({
          id: brief(s.key),
          businessId: ID.bizA,
          module: s.module,
          action: `${P}brf_${s.key}`,
          entityType: s.entityType ?? 'v84a_entity',
          entityId: s.entityId ?? null,
          title: s.title ?? `v84a briefing ${s.key} row`,
          category: s.category ?? null,
          contactId: s.contactId ?? null,
          revenueImpact: s.revenueImpact ?? null,
          status: 'SCHEDULED',
          startsAt: new Date(now + 7_200_000 + i * 60_000),
          occurredAt: new Date(now - (i + 1) * 60_000),
          createdAt: new Date(now - (i + 1) * 60_000),
        })),
      });
      // A ledger day: one invoice paid within the last day (120), one open (30), one paid last week (500).
      await db.invoice.createMany({
        data: [
          { id: `${P}inv_paid`, invoiceNumber: 'v84a-INV-8', status: 'PAID', subtotal: 120, total: 120, currency: 'TTD', paidAt: new Date(now - 3_600_000), businessId: ID.bizA, contactId: ID.cTeam },
          { id: `${P}inv_open`, invoiceNumber: 'v84a-INV-9', status: 'SENT', subtotal: 30, total: 30, currency: 'TTD', businessId: ID.bizA, contactId: ID.cTeam },
          { id: `${P}inv_old`, invoiceNumber: 'v84a-INV-7', status: 'PAID', subtotal: 500, total: 500, currency: 'TTD', paidAt: new Date(now - 7 * 86_400_000), businessId: ID.bizA, contactId: ID.cTeam },
        ],
      });
      // Leads (leadScore >= 60): the owner's PRIVATE contact, the TEAM one, staffOwned's, and a soft-deleted TEAM one.
      await db.$executeRawUnsafe(`UPDATE contacts SET lead_score = 75 WHERE id IN (${LEADS.map((id) => `'${id}'`).join(', ')})`);

      const read = async (user: string) => {
        const res = await briefing(user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
        expect(Array.isArray(res.body.schedule)).toBe(true);
        return {
          rows: (res.body.schedule as Array<{ id: string }>).map((row) => row.id).sort(),
          figures: { revenueToday: res.body.revenueToday, openInvoices: res.body.openInvoices, activeLeads: res.body.activeLeads },
          text: JSON.stringify(res.body.schedule),
        };
      };
      const only = (...keys: string[]) => keys.map(brief).sort();
      const all = ROWS.map((s) => s.key);

      // OWNER control: every row (oldest first, as before) and every figure.
      const ownerRes = await briefing(ID.owner);
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.schedule.map((row: { id: string }) => row.id)).toEqual([...all].reverse().map(brief));
      const owner = await read(ID.owner);
      expect(owner.figures).toEqual({ revenueToday: 120, openInvoices: 1, activeLeads: 3 });

      const expected: Array<[string, string, string[], { revenueToday: number; openInvoices: number; activeLeads: number }]> = [
        // view-all ADMIN: every row but those naming a PRIVATE contact it may not open (M7, ST-1).
        ['admin', ID.admin, ['pay', 'finance', 'booking', 'crmTeam', 'ai', 'unmapped'], { revenueToday: 120, openInvoices: 1, activeLeads: 1 }],
        // revenue 'none': no money row, no revenue figure.
        ['staffRevNone', ID.staffRevNone, ['booking', 'crmTeam'], { revenueToday: 0, openInvoices: 0, activeLeads: 1 }],
        // crm 'none': no row naming a contact, no lead; revenue read keeps the figures.
        ['staffCrmNone', ID.staffCrmNone, ['pay', 'finance'], { revenueToday: 120, openInvoices: 1, activeLeads: 0 }],
        // crm_view 'owned': only its own contact's row and lead.
        ['staffOwned', ID.staffOwned, ['pay', 'finance', 'crmStaff'], { revenueToday: 120, openInvoices: 1, activeLeads: 1 }],
        // STAFF role defaults (ai, settings, team none): no ai or unmapped row.
        ['staffDefault', ID.staffDefault, ['pay', 'finance', 'booking', 'crmTeam'], { revenueToday: 120, openInvoices: 1, activeLeads: 1 }],
        // crm and ai read, revenue absent (none): the ai row and the TEAM row, not the KEY row naming the PRIVATE contact.
        ['staffAiCrm', ID.staffAiCrm, ['crmTeam', 'ai'], { revenueToday: 0, openInvoices: 0, activeLeads: 1 }],
        // ai read, crm 'none': the ai row only.
        ['staffAiOnly', ID.staffAiOnly, ['ai'], { revenueToday: 0, openInvoices: 0, activeLeads: 0 }],
      ];
      for (const [name, user, keys, figures] of expected) {
        const got = await read(user);
        expect(got.rows, `${name}: rows`).toEqual(only(...keys));
        expect(got.figures, `${name}: figures`).toEqual(figures);
        if (!keys.includes('pay')) expect(got.text, `${name}: the payment row's text`).not.toContain('TTD 90');
        if (!keys.includes('crmPriv')) {
          expect(got.text, `${name}: the PRIVATE contact`).not.toContain(ID.cPriv);
          expect(got.text).not.toContain('Secret Client');
        }
      }

      // Tenant control: B's member is refused A's briefing.
      const refused = await briefing(ID.ownerB);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain(`${P}brf_`);
    } finally {
      await db.$executeRawUnsafe(`UPDATE contacts SET lead_score = NULL WHERE id IN (${LEADS.map((id) => `'${id}'`).join(', ')})`);
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
      await db.$executeRawUnsafe(`DELETE FROM activities WHERE id LIKE ${sqlLikePrefix(`${P}brf_`)}`);
    }
  });
});

/**
 * W6-BRIEFINGS-SCOPE (owner ruling D-63, the rule V1-84 built in
 * timeline-visibility.ts, as W5-BRIEFING-SCOPE applied it to the morning
 * briefing; reviews SEC-W5BS-1, SEC-W5BS-2, CR-W5BS-1):
 *   - GET /ai/businesses/:businessId/briefing/eod (AiController.endOfDayBriefing,
 *     AuthGuard + BusinessGuard only; the control tower's End of Day report)
 *     counted the day's Activity rows, summed the day's paid invoices and
 *     counted the day's bookings and updated contacts over the whole business,
 *     for every member (SEC-W5BS-1);
 *   - GET /ai/businesses/:businessId/briefing (getBriefing ->
 *     MorningBriefingService.generateBriefing) answered the daily briefing's
 *     cards with no viewer: overdue invoice numbers and totals in card titles,
 *     the contact and the amount in card args, and totalAtStake (SEC-W5BS-2);
 *   - TS-14 and EF-17 seed fewer rows than one batch, so nothing proved the
 *     morning briefing reads past a batch of hidden rows (readVisibleActivityPage,
 *     CR-W5BS-1).
 * Review repairs (TS-18, TS-19):
 *   - CR-W6BS-1 / CR-W6BS-2: the End of Day events count asked findMany for
 *     5000 rows, @keyflow/db caps every findMany at 1000, and the short batch
 *     read as the end of the day, so every member's count (the OWNER's
 *     included, whose count was exact at base) stopped at 1000; the OWNER never
 *     took the plain-count path (connect is 'none' for every role);
 *   - SEC-W6BS-3: concurrent first reads of the day each wrote a daily briefing
 *     plan and each emitted plan.approved.
 * The real AiController and the real MorningBriefingService run on their own
 * app over this suite's PrismaService and identity header. The briefing's tier
 * source is the real AiOversightService.getToolTier and its workload source
 * reports no one over or under capacity; the event emitter records what is
 * emitted; every other collaborator is an empty stand-in the three routes never
 * call. Each case writes its own rows and removes them when it ends, so the
 * cases above and below read what they did.
 */
describe('W6-BRIEFINGS-SCOPE (D-63): the end-of-day and daily briefings follow the timeline rule, and the morning briefing fills its page (TS-15..TS-19)', () => {
  let briefingApp: any;
  /** What the briefing app emitted (TS-19: plan.approved once per daily briefing). */
  const emitted: Array<{ name: string; payload: any }> = [];
  afterAll(async () => {
    if (briefingApp) await briefingApp.close();
  });

  async function ai(path: string, user: string, biz = ID.bizA): Promise<request.Response> {
    if (!briefingApp) {
      const { Test } = await import('@nestjs/testing');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
      const { PrismaService } = await import('../src/core/prisma/prisma.service');
      const { AuthGuard } = await import('../src/core/auth/auth.guard');
      const { BusinessGuard } = await import('../src/core/auth/business.guard');
      const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
      const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
      const { AiController } = await import('../src/modules/ai/ai.controller');
      const { MorningBriefingService } = await import('../src/modules/ai/morning-briefing.service');
      const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
      const { WorkloadAggregatorService } = await import('../src/modules/ai/workload-aggregator.service');
      const ref = await Test.createTestingModule({
        controllers: [AiController],
        providers: [
          { provide: PrismaService, useValue: app.get(PrismaService) },
          AuthGuard,
          BusinessGuard,
          ModuleScopeGuard,
          CrmRateLimitGuard,
          { provide: EventEmitter2, useValue: { emit: (name: string, payload: any) => { emitted.push({ name, payload }); return true; } } },
          MorningBriefingService,
          { provide: AiOversightService, useValue: { getToolTier: (tool: string) => AiOversightService.prototype.getToolTier.call({}, tool) } },
          { provide: WorkloadAggregatorService, useValue: { getWorkloadForBusiness: async () => ({ overloaded: [], underutilized: [] }) } },
        ],
      })
        .useMocker(() => ({}))
        .compile();
      briefingApp = ref.createNestApplication();
      // Identity attachment only, as the suite's app does. No guard is overridden.
      briefingApp.use(async (req: any, _res: any, next: any) => {
        const header = req.headers[HEADER];
        const id = typeof header === 'string' ? header : undefined;
        if (id && id.startsWith(P)) {
          const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
          if (user) req.user = { id: user.id, email: user.email, role: user.role };
        }
        next();
      });
      briefingApp.useGlobalFilters(new GlobalHttpExceptionFilter());
      await briefingApp.init();
    }
    return request(briefingApp.getHttpServer()).get(`/ai/businesses/${biz}/${path}`).set(HEADER, user);
  }

  it("TS-15 (W6-BRIEFINGS-SCOPE, SEC-W5BS-1, D-63; V1-84 TS-04): GET /ai/businesses/:businessId/briefing/eod counts in events only the day's Activity rows the timeline rule serves the member (as /events serves them), reports revenueCollected 0 to a member without revenue read (a revenue-none STAFF member included), counts bookingsCompleted only for a bookings reader and contactsUpdated only over the contacts the member may list; the OWNER's report keeps every figure and counts every row /events serves them", async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    try {
      // The day's money: one invoice paid today (120), one paid before today (500).
      await db.invoice.createMany({
        data: [
          { id: `${P}inv_eod_paid`, invoiceNumber: 'v84a-INV-E1', status: 'PAID', subtotal: 120, total: 120, currency: 'TTD', paidAt: new Date(), businessId: ID.bizA, contactId: ID.cTeam },
          { id: `${P}inv_eod_old`, invoiceNumber: 'v84a-INV-E2', status: 'PAID', subtotal: 500, total: 500, currency: 'TTD', paidAt: new Date(start.getTime() - 3_600_000), businessId: ID.bizA, contactId: ID.cTeam },
        ],
      });
      // The day's booking, of the TEAM contact.
      await db.service.create({ data: { id: `${P}svc_eod`, name: 'v84a eod service', duration: 30, price: 10, businessId: ID.bizA } });
      await db.booking.create({
        data: { id: `${P}bk_eod`, businessId: ID.bizA, contactId: ID.cTeam, serviceId: `${P}svc_eod`, startTime: new Date(Date.now() + 86_400_000), endTime: new Date(Date.now() + 86_400_000 + 1_800_000) },
      });

      const eod = async (user: string) => {
        const res = await ai('briefing/eod', user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
        return res.body as { date: string; events: number; revenueCollected: number; bookingsCompleted: number; contactsUpdated: number };
      };

      // OWNER control: the day's 17 main rows, the day's 120, the booking, the three live contacts.
      const owner = await eod(ID.owner);
      expect(owner.date).toBe(start.toISOString());
      expect(owner).toMatchObject({ events: ALL_MAIN.length, revenueCollected: 120, bookingsCompleted: 1, contactsUpdated: 3 });

      const expected: Array<[string, string, { revenueCollected: number; bookingsCompleted: number; contactsUpdated: number }]> = [
        // revenue 'none' (crm, bookings, operations read): no revenue figure; the TEAM contact only.
        ['staffRevNone', ID.staffRevNone, { revenueCollected: 0, bookingsCompleted: 1, contactsUpdated: 1 }],
        // crm 'none', revenue read, bookings absent (none): the figure, no booking, no contact.
        ['staffCrmNone', ID.staffCrmNone, { revenueCollected: 120, bookingsCompleted: 0, contactsUpdated: 0 }],
        // crm_view 'owned', revenue read: its own contact only.
        ['staffOwned', ID.staffOwned, { revenueCollected: 120, bookingsCompleted: 0, contactsUpdated: 1 }],
        // view-all ADMIN: every figure, not the PRIVATE contacts it may not open.
        ['admin', ID.admin, { revenueCollected: 120, bookingsCompleted: 1, contactsUpdated: 1 }],
        // STAFF role defaults (crm read, revenue read): the TEAM contact only.
        ['staffDefault', ID.staffDefault, { revenueCollected: 120, bookingsCompleted: 1, contactsUpdated: 1 }],
      ];
      for (const [name, user, figures] of expected) {
        const got = await eod(user);
        expect(got, `${name}: figures`).toMatchObject(figures);
        const seen = await mainSeen(user);
        expect(got.events, `${name}: events are the day's rows /events serves them`).toBe(seen.length);
        expect(got.events, `${name}: fewer events than the owner's`).toBeLessThan(ALL_MAIN.length);
      }
      // The revenue-none member's events, named: crmTeam, booking, procurement, communications, BOOKINGS.
      expect((await eod(ID.staffRevNone)).events).toBe(5);

      // Tenant control: B's member is refused A's report.
      expect((await ai('briefing/eod', ID.ownerB)).status).toBe(403);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM bookings WHERE id LIKE ${sqlLikePrefix(`${P}bk_`)}`);
      await db.$executeRawUnsafe(`DELETE FROM services WHERE id LIKE ${sqlLikePrefix(`${P}svc_`)}`);
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
    }
  });

  it("TS-16 (W6-BRIEFINGS-SCOPE, SEC-W5BS-2, D-63): GET /ai/businesses/:businessId/briefing answers each member only the daily briefing's cards the timeline rule serves them: no overdue-invoice card, invoice number, total or totalAtStake for a revenue-none member, no card naming a contact the member may not open (crm read and visibilityClause), no card of a module they do not read; on the stored briefing as on the one the call writes; the OWNER's briefing keeps every card", async () => {
    const DAY_MS = 86_400_000;
    try {
      // Two overdue invoices: one of the TEAM contact (250, 20 days), one of staffOwned's PRIVATE contact (80, 10 days).
      await db.invoice.createMany({
        data: [
          { id: `${P}inv_od1`, invoiceNumber: 'v84a-INV-OD1', status: 'OVERDUE', subtotal: 250, total: 250, currency: 'TTD', dueDate: new Date(Date.now() - 20 * DAY_MS), businessId: ID.bizA, contactId: ID.cTeam },
          { id: `${P}inv_od2`, invoiceNumber: 'v84a-INV-OD2', status: 'OVERDUE', subtotal: 80, total: 80, currency: 'TTD', dueDate: new Date(Date.now() - 10 * DAY_MS), businessId: ID.bizA, contactId: ID.cStaff },
        ],
      });
      // The leads the CRM scan finds are the suite's three live contacts (status LEAD, never contacted).
      // The bookings scan finds the week empty (one calendar card); nothing else is seeded.

      type Card = { module: string; title: string; args: Record<string, any> };
      const keyOf = (card: Card): string => {
        if (card.module === 'commerce') return `inv:${/v84a-INV-\w+/.exec(card.title)?.[0] ?? card.title}`;
        if (card.module === 'crm') return `lead:${card.args?.contactId}`;
        return card.module;
      };
      const read = async (user: string) => {
        const res = await ai('briefing', user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
        const body = res.body as { planId: string; totalCards: number; highImpactCards: number; totalAtStake: number; cards: Card[] };
        return { body, keys: body.cards.map(keyOf).sort(), text: JSON.stringify(body) };
      };
      const ALL = ['inv:v84a-INV-OD1', 'inv:v84a-INV-OD2', `lead:${ID.cPriv}`, `lead:${ID.cTeam}`, `lead:${ID.cStaff}`, 'bookings'].sort();

      // The first call of the day writes the briefing (the business's, run as the owner, D-93) and answers it.
      const first = await read(ID.staffRevNone);
      const revNoneKeys = [`lead:${ID.cTeam}`, 'bookings'].sort();
      expect(first.keys, 'staffRevNone (written briefing): cards').toEqual(revNoneKeys);
      expect(first.body.totalCards).toBe(2);
      expect(first.body.totalAtStake).toBe(0);
      const plan = await db.aiPlan.findUnique({ where: { id: first.body.planId }, select: { businessId: true, userId: true, steps: { select: { id: true } } } });
      expect(plan).toMatchObject({ businessId: ID.bizA, userId: ID.owner });
      expect(plan.steps).toHaveLength(ALL.length);

      // OWNER control: the stored briefing, every card (numbers, totals and contacts included).
      const owner = await read(ID.owner);
      expect(owner.body.planId).toBe(first.body.planId);
      expect(owner.keys).toEqual(ALL);
      expect(owner.body.totalCards).toBe(ALL.length);
      expect(owner.text).toContain('v84a-INV-OD1');
      expect(owner.text).toContain('(250)');
      expect(owner.text).toContain('Your invoice for 250');
      expect(owner.text).toContain(ID.cPriv);

      const expected: Array<[string, string, string[]]> = [
        // revenue 'none' (crm, bookings, operations read), the stored briefing: as when it was written.
        ['staffRevNone', ID.staffRevNone, revNoneKeys],
        // crm_view 'owned', revenue read: its own contact's invoice and lead only.
        ['staffOwned', ID.staffOwned, ['inv:v84a-INV-OD2', `lead:${ID.cStaff}`].sort()],
        // view-all ADMIN: not the cards of the PRIVATE contacts it may not open.
        ['admin', ID.admin, ['inv:v84a-INV-OD1', `lead:${ID.cTeam}`, 'bookings'].sort()],
        // crm 'none': no card naming a contact (every invoice card names one), no bookings read.
        ['staffCrmNone', ID.staffCrmNone, []],
      ];
      for (const [name, user, keys] of expected) {
        const got = await read(user);
        expect(got.body.planId, `${name}: the business's briefing`).toBe(first.body.planId);
        expect(got.keys, `${name}: cards`).toEqual(keys);
        expect(got.body.totalCards, `${name}: totalCards`).toBe(keys.length);
        if (!keys.some((key) => key.startsWith('inv:'))) {
          expect(got.text, `${name}: an invoice number`).not.toMatch(/v84a-INV-OD/);
          expect(got.text, `${name}: an overdue total`).not.toContain('Your invoice for');
          expect(got.body.totalAtStake, `${name}: totalAtStake`).toBe(0);
        }
        if (!keys.includes(`lead:${ID.cPriv}`)) expect(got.text, `${name}: the owner's PRIVATE contact`).not.toContain(ID.cPriv);
        if (!keys.some((key) => key.endsWith(ID.cStaff))) expect(got.text, `${name}: staffOwned's PRIVATE contact`).not.toContain(ID.cStaff);
      }
      expect(first.text).not.toMatch(/v84a-INV-OD/);
      expect(first.text).not.toContain(ID.cPriv);

      // Tenant control: B's member is refused A's briefing.
      const refused = await ai('briefing', ID.ownerB);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain('v84a-INV-OD');
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM ai_plans WHERE business_id = '${ID.bizA}'`);
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
    }
  });

  it('TS-17 (W6-BRIEFINGS-SCOPE, CR-W5BS-1, D-63): GET /ai/businesses/:businessId/briefing/morning fills its page past more than one batch of rows the member may not read: a revenue-none STAFF member still gets the three bookings rows that follow 150 hidden SCHEDULED rows (FINANCE rows, and crm rows naming the PRIVATE contact they may not open, none of which the database prefilter drops); the OWNER gets a full page', async () => {
    const fill = (key: string) => `${P}pf_${key}`;
    const now = Date.now();
    const HIDDEN = 150;
    const VISIBLE = ['v1', 'v2', 'v3'];
    try {
      await db.activity.createMany({
        data: [
          ...Array.from({ length: HIDDEN }, (_, i) => ({
            id: fill(`h${String(i).padStart(3, '0')}`),
            businessId: ID.bizA,
            module: i % 2 === 0 ? 'FINANCE' : 'crm',
            contactId: i % 2 === 0 ? null : ID.cPriv,
            action: `${P}pf_hidden`,
            entityType: 'v84a_entity',
            title: `v84a page-fill hidden ${i}`,
            status: 'SCHEDULED',
            occurredAt: new Date(now - 20 * 3_600_000 + i * 1000),
            createdAt: new Date(now - 20 * 3_600_000 + i * 1000),
          })),
          ...VISIBLE.map((key, i) => ({
            id: fill(key),
            businessId: ID.bizA,
            module: 'bookings',
            category: 'BOOKING',
            action: `${P}pf_visible`,
            entityType: 'v84a_entity',
            title: `v84a page-fill visible ${key}`,
            status: 'SCHEDULED',
            occurredAt: new Date(now - 3_600_000 + i * 1000),
            createdAt: new Date(now - 3_600_000 + i * 1000),
          })),
        ],
      });

      const schedule = async (user: string): Promise<string[]> => {
        const res = await ai('briefing/morning', user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
        return (res.body.schedule as Array<{ id: string }>).map((row) => row.id);
      };

      // The member's page: the three visible rows, past one batch (100) and more of hidden rows.
      expect(await schedule(ID.staffRevNone)).toEqual(VISIBLE.map(fill));
      // OWNER control: a full page (10), the oldest hidden rows first.
      const owner = await schedule(ID.owner);
      expect(owner).toHaveLength(10);
      expect(owner[0]).toBe(fill('h000'));
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM activities WHERE id LIKE ${sqlLikePrefix(`${P}pf_`)}`);
    }
  });

  it("TS-18 (W6-BRIEFINGS-SCOPE review CR-W6BS-1, CR-W6BS-2, D-63): GET /ai/businesses/:businessId/briefing/eod counts past 1000 rows: the OWNER's events are every one of the day's rows /events serves them, however many (one database count; the day's connect row left out, as /events leaves it out), and a member whose rows are judged one by one is counted over the day's first TIMELINE_SCAN_LIMIT rows, not the first 1000", async () => {
    const { TIMELINE_SCAN_LIMIT } = await import('../src/modules/timeline/timeline-visibility');
    const bulk = (i: number) => `${P}eod_${String(i).padStart(4, '0')}`;
    const BULK = TIMELINE_SCAN_LIMIT + 50;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    try {
      // The day's first rows, before the main rows (DAY, local noon): BULK bookings rows (no contact, no
      // amount), then one connect row (connect is 'none' for every role by default, D-63).
      await db.activity.createMany({
        data: Array.from({ length: BULK }, (_, i) => ({
          id: bulk(i),
          businessId: ID.bizA,
          module: 'bookings',
          category: 'BOOKING',
          action: `${P}eod_bulk`,
          entityType: 'v84a_entity',
          title: `v84a eod bulk ${i}`,
          occurredAt: new Date(start.getTime() + 1000 + i),
        })),
      });
      await db.activity.create({
        data: { id: `${P}eod_connect`, businessId: ID.bizA, module: 'connect', action: `${P}eod_connect`, entityType: 'v84a_entity', title: 'v84a eod connect', occurredAt: new Date(start.getTime() + 10_000) },
      });

      const events = async (user: string): Promise<number> => {
        const res = await ai('briefing/eod', user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
        return res.body.events;
      };
      // OWNER: the 17 main rows and every bulk row (more than TIMELINE_SCAN_LIMIT), not the connect row.
      expect(await events(ID.owner), 'OWNER').toBe(ALL_MAIN.length + BULK);
      // A view-all ADMIN (visibilityClause restricts them) and a revenue-none STAFF member: their rows are
      // judged one by one, over the day's first TIMELINE_SCAN_LIMIT rows (all bookings rows they read).
      expect(await events(ID.admin), 'ADMIN').toBe(TIMELINE_SCAN_LIMIT);
      expect(await events(ID.staffRevNone), 'staffRevNone').toBe(TIMELINE_SCAN_LIMIT);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM activities WHERE id LIKE ${sqlLikePrefix(`${P}eod_`)}`);
    }
  });

  it('TS-19 (W6-BRIEFINGS-SCOPE review SEC-W6BS-3, D-93, D-63): concurrent first reads of the day of GET /ai/businesses/:businessId/briefing by three members write one daily briefing: every read answers its planId, the business holds one daily briefing plan, and plan.approved and briefing.generated are emitted once', async () => {
    try {
      // No briefing yet today (TS-16 removes its own); the suite's three live leads and the empty week give cards.
      expect(await db.aiPlan.count({ where: { businessId: ID.bizA, objective: { startsWith: 'Daily Briefing — ' } } })).toBe(0);
      emitted.length = 0;

      // Three first reads at once (the route's limit is 10 a minute for the business; TS-16 used 7).
      const answers = await Promise.all([ID.owner, ID.staffRevNone, ID.admin].map((user) => ai('briefing', user)));
      for (const res of answers) expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      const planIds = new Set(answers.map((res) => res.body.planId));
      expect(planIds.size, 'one planId answered').toBe(1);

      const plans = await db.aiPlan.findMany({
        where: { businessId: ID.bizA, objective: { startsWith: 'Daily Briefing — ' } },
        select: { id: true, userId: true, steps: { select: { id: true } } },
      });
      expect(plans, 'one daily briefing plan').toHaveLength(1);
      expect(plans[0]).toMatchObject({ id: [...planIds][0], userId: ID.owner });
      // The OWNER's answer is the whole briefing; the others are filtered from the same plan.
      expect(answers[0].body.totalCards).toBe(plans[0].steps.length);
      expect(answers[1].body.totalCards).toBeLessThan(plans[0].steps.length);

      expect(emitted.filter((e) => e.name === 'plan.approved'), 'plan.approved once').toHaveLength(1);
      expect(emitted.filter((e) => e.name === 'briefing.generated'), 'briefing.generated once').toHaveLength(1);
      expect(emitted.find((e) => e.name === 'plan.approved')?.payload).toMatchObject({ planId: plans[0].id, businessId: ID.bizA });
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM ai_plans WHERE business_id = '${ID.bizA}'`);
    }
  });
});

/**
 * W6-BRIEFINGS-SCOPE review follow-ups outside the packet's write set
 * (AiController.endOfDayBriefing and getBriefing, MorningBriefingService
 * generateBriefing): two more briefing routes do not yet serve only what their
 * member may read. Reproduced at the packet head (a temporary harness, AiUsageService
 * mocked, no provider traffic) and recorded here until a packet takes them.
 */
describe('W6-BRIEFINGS-SCOPE review follow-ups outside the write set (TS-20, TS-21)', () => {
  it.todo(
    "TS-20 (review SEC-W6BS-1, D-63): GET /ai/businesses/:businessId/ai/briefing (AiController.briefing -> AiAdvisorService.generateDailyBriefing, ai-advisor.service.ts; AuthGuard + BusinessGuard only; the web's fetchAiBriefing) answers every member the month's cashFlow {revenue, expenses, net} (a revenue-none STAFF member got revenue 777 for a PAID invoice of 777) and builds its LLM prompt from every recent Activity title (the prompt carried 'Payment recorded: TTD 150', a row that member cannot read on /events). Closing it needs AiAdvisorService to take the member as a viewer, outside this packet's write set. Weaker siblings, not run: POST commerce/businesses/:businessId/weekly-briefing (financial-copilot.controller.ts, AuthGuard + BusinessGuard only) and the revenue-intelligence briefing (membership check only)",
  );
  it.todo(
    "TS-21 (review SEC-W6BS-2, D-73, KEY-R3b SEC-R3b-4): POST /ai/businesses/:businessId/briefing/:planId/skip (MorningBriefingService.skipBriefing) updates any plan by id alone, with no member check, no daily-briefing markers (BRIEFING_SCOPE, objective, raw input, as execute-all requires) and no audit row: a STAFF member with ai 'none' skipped the OWNER's pending non-briefing plan (201, plan completed, its step skipped). Closing it needs skipBriefing bound as executeAllBriefingCards is, outside this packet's write set",
  );
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
