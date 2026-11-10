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
 *   write one daily briefing. Two other briefing routes were follow-ups outside
 *   that write set (it.todo, TS-20 SEC-W6BS-1, TS-21 SEC-W6BS-2).
 *   TS-20a..c, TS-21 (W7-BRIEFINGS-REST, D-63, D-73): live. The advisor's daily
 *   briefing, the weekly financial briefing and the revenue-intelligence routes
 *   serve each member only the figures and contacts they read, and the briefing
 *   skip route is bound as execute-all is.
 *   TS-20d..f, TS-21b (W7-BRIEFINGS-REST review repairs SEC-W7BR-1..3,
 *   CR-W7BR-1): delegate-chase takes a chase's contact from the invoice or
 *   quote it names, the financial pulse, alerts and forecast need revenue read,
 *   a line is withheld only for a hidden contact's full name, display name or
 *   email, and the skip skips only steps not yet run. TS-22 (SEC-W7BR-4) is a
 *   follow-up outside that write set (it.todo).
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
    // W7-BRIEFINGS-REST review repairs (TS-20d): the delegated chases (cuid ids) and the quote a
    // chase names (Quote.contact is NoAction).
    `DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quotes WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    // W5-BRIEFING-SCOPE (TS-14): its invoices (Invoice.contact is NoAction).
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    // W7-BRIEFINGS-REST (TS-20b, TS-21): the finance queue item and the skip route's audit rows.
    `DELETE FROM finance_action_items WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
 * W7-BRIEFINGS-REST (owner rulings D-63 and D-73; reviews SEC-W6BS-1, SEC-W6BS-2, KEY-R3b SEC-R3b-4):
 * the W6-BRIEFINGS-SCOPE review follow-ups TS-20 and TS-21, live (they were it.todo).
 *   - TS-20 (SEC-W6BS-1): GET /ai/businesses/:businessId/ai/briefing (AiController.briefing ->
 *     AiAdvisorService.generateDailyBriefing; the web's fetchAiBriefing) answered every member the
 *     month's cashFlow and built its prompt from every recent Activity title and every figure; its
 *     siblings, POST commerce/businesses/:businessId/weekly-briefing (FinancialCopilotController) and
 *     the revenue-intelligence routes (RevenueIntelligenceController, a membership check only), served
 *     revenue figures and contact names to every member. The rule W5/W6 applied to the morning and
 *     end-of-day briefings (D-63): revenue figures withheld (0) from a member without revenue read,
 *     contact-bearing items only for contacts the member may open, a module-scope guard where a route
 *     is wholly revenue.
 *   - TS-21 (SEC-W6BS-2): POST /ai/businesses/:businessId/briefing/:planId/skip
 *     (MorningBriefingService.skipBriefing) updated any plan by id alone; it now takes only the daily
 *     briefing of the business the route checked, for the member it runs as, the OWNER or an ADMIN, as
 *     execute-all does (D-73, SEC-R3b-4), and records who skipped it.
 * The real AiController, AiAdvisorService, MorningBriefingService and AiExecutionLogService, the real
 * FinancialCopilotController and FinancialCopilotService, and the real RevenueIntelligenceController,
 * RevenueBriefingService and RevenueForecastService run on their own app over this suite's
 * PrismaService and identity header, with the real guards. No provider traffic: AiUsageService is a
 * stand-in that records what each call sends and answers as a model would (the advisor's echoes the
 * JSON shape its prompt asks for, so its cashFlow is the prompt's). The strategic dashboard, the
 * slow-payer detector (a fixed report naming the suite's three live contacts), the pricing signals
 * and the revenue-action writer are stand-ins (TS-20d hands the chases on to the real
 * RevenueActionService over this suite's database); every other collaborator is an empty stand-in
 * the routes never call. Each case writes its own rows and removes them when it ends.
 */
describe('W7-BRIEFINGS-REST (D-63, D-73): the advisor, weekly and revenue-intelligence briefings and the briefing skip route honour scope (TS-20, TS-21)', () => {
  let restApp: any;
  /** What each AI call sent (its feature, every message joined). */
  const aiCalls: Array<{ feature: string; text: string }> = [];
  /** How the advisor's stand-in model answers: the JSON its prompt asks for, or plain text (the fallback path). */
  let advisorReply: 'echo' | 'text' = 'echo';
  /** What POST briefing/delegate-chase handed the revenue-action writer. */
  const delegated: any[] = [];
  /**
   * W7-BRIEFINGS-REST review SEC-W7BR-1 (TS-20d): when set, the stand-in hands each chase to this real
   * RevenueActionService over the suite's database (its upsert on the chase's key is what the review
   * showed being rewritten), after recording it.
   */
  let revenueActionWriter: { createFromBriefing: (businessId: string, chase: any) => Promise<{ created: boolean; actionId?: string }> } | null = null;
  afterAll(async () => {
    if (restApp) await restApp.close();
  });

  const STRATEGIC = { overdueInvoices: 3, overdueAmount: 4321, pendingQuotes: 2, pendingQuoteValue: 8765, staleLeads: 5, activeProjects: 4, overdueTaskCount: 1, utilizationRate: 55 };
  const WEEKLY_REPLY = {
    summary: 'v84a steady week',
    highlights: ['Collections held up'],
    concerns: ['Priv is paying slowly', 'Cash is tight'],
    recommendation: 'Chase Priv this week',
    outlook: 'Stable',
  };
  /** What the weekly briefing's stand-in model answers (TS-20f sets its own). */
  let weeklyReply: typeof WEEKLY_REPLY = WEEKLY_REPLY;
  const REVENUE_REPLY = {
    headline: 'Chase Priv and Team this week',
    whatChanged: ['Forecast steady'],
    whatsAtRisk: ['Priv owes TTD 250 on v84a-INV-RB1', 'Team has not paid v84a-INV-RB2', 'Two invoices are overdue'],
    whatToChase: [
      { title: 'Chase v84a-INV-RB1', detail: 'Remind about TTD 250', amountAtRisk: 250 },
      { title: 'Chase v84a-INV-RB2', detail: 'Send a reminder', amountAtRisk: 80 },
      { title: 'Review pricing', detail: 'No client named', amountAtRisk: 0 },
    ],
    whatToPlan: ['Book a check-in with Staff', 'Review pricing'],
  };
  const slowPayer = (contactId: string, contactName: string) => ({
    contactId, contactName, email: null, avgDaysToPay: 40, paidInvoiceCount: 3, outstandingTotal: 100, threshold: 15, severity: 'moderate',
  });

  async function rest(method: 'get' | 'post', path: string, user: string, body?: object): Promise<request.Response> {
    if (!restApp) {
      const { Test } = await import('@nestjs/testing');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
      const { PrismaService } = await import('../src/core/prisma/prisma.service');
      const { AuthGuard } = await import('../src/core/auth/auth.guard');
      const { BusinessGuard } = await import('../src/core/auth/business.guard');
      const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
      const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
      const { AiController } = await import('../src/modules/ai/ai.controller');
      const { AiAdvisorService } = await import('../src/modules/ai/ai-advisor.service');
      const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
      const { StrategicIntelligenceService } = await import('../src/modules/ai/strategic-intelligence.service');
      const { MorningBriefingService } = await import('../src/modules/ai/morning-briefing.service');
      const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
      const { FinancialCopilotController } = await import('../src/modules/commerce/financial-copilot.controller');
      const { FinancialCopilotService } = await import('../src/modules/commerce/financial-copilot.service');
      const { RevenueIntelligenceController } = await import('../src/modules/commerce/revenue-intelligence.controller');
      const { RevenueBriefingService } = await import('../src/modules/commerce/revenue-briefing.service');
      const { RevenueForecastService } = await import('../src/modules/commerce/revenue-forecast.service');
      const { SlowPayerDetector } = await import('../src/modules/commerce/slow-payer-detector.service');
      const { PricingSignalsService } = await import('../src/modules/commerce/pricing-signals.service');
      const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
      const ref = await Test.createTestingModule({
        controllers: [AiController, FinancialCopilotController, RevenueIntelligenceController],
        providers: [
          { provide: PrismaService, useValue: app.get(PrismaService) },
          AuthGuard,
          BusinessGuard,
          ModuleScopeGuard,
          CrmRateLimitGuard,
          { provide: EventEmitter2, useValue: { emit: () => true } },
          AiAdvisorService,
          MorningBriefingService,
          AiExecutionLogService,
          FinancialCopilotService,
          RevenueBriefingService,
          RevenueForecastService,
          {
            provide: AiUsageService,
            useValue: {
              callAi: async (opts: { feature: string; messages?: Array<{ content: string }> }) => {
                const text = (opts.messages ?? []).map((m) => m.content).join('\n');
                aiCalls.push({ feature: opts.feature, text });
                if (opts.feature === 'briefing') {
                  // The JSON shape the advisor's prompt asks for, as written there (its cashFlow included).
                  return { content: advisorReply === 'echo' ? text.slice(text.indexOf('{"summary"')) : 'v84a plain briefing', usage: {} };
                }
                if (opts.feature === 'financial_weekly_briefing') return { content: JSON.stringify(weeklyReply), usage: {} };
                if (opts.feature === 'revenue_briefing') return { content: JSON.stringify(REVENUE_REPLY), usage: {} };
                throw new Error(`v84a: unexpected AI feature ${opts.feature}`);
              },
            },
          },
          { provide: StrategicIntelligenceService, useValue: { getStrategicDashboard: async () => STRATEGIC } },
          {
            provide: SlowPayerDetector,
            useValue: {
              detect: async (businessId: string) => ({
                businessId, generatedAt: new Date().toISOString(), businessMedianDays: 10, threshold: 15, totalContactsScanned: 3,
                slowPayers: [slowPayer(ID.cPriv, 'Priv'), slowPayer(ID.cTeam, 'Team'), slowPayer(ID.cStaff, 'Staff')],
              }),
              syncContactTags: async () => undefined,
              syncRevenueActions: async () => undefined,
            },
          },
          {
            provide: PricingSignalsService,
            useValue: { detect: async (businessId: string) => ({ businessId, generatedAt: new Date().toISOString(), thresholds: {}, signals: [] }) },
          },
          {
            provide: RevenueActionService,
            useValue: {
              createFromBriefing: async (businessId: string, chase: unknown) => {
                delegated.push(chase);
                if (revenueActionWriter) return revenueActionWriter.createFromBriefing(businessId, chase);
                return { created: true, actionId: `${P}ra_${delegated.length}` };
              },
            },
          },
        ],
      })
        .useMocker(() => ({}))
        .compile();
      restApp = ref.createNestApplication();
      // Identity attachment only, as the suite's app does. No guard is overridden.
      restApp.use(async (req: any, _res: any, next: any) => {
        const header = req.headers[HEADER];
        const id = typeof header === 'string' ? header : undefined;
        if (id && id.startsWith(P)) {
          const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
          if (user) req.user = { id: user.id, email: user.email, role: user.role };
        }
        next();
      });
      restApp.useGlobalFilters(new GlobalHttpExceptionFilter());
      await restApp.init();
    }
    const req = request(restApp.getHttpServer())[method](path).set(HEADER, user);
    return body === undefined ? req : req.send(body);
  }

  it("TS-20a (W7-BRIEFINGS-REST, review SEC-W6BS-1, D-63; was it.todo TS-20): GET /ai/businesses/:businessId/ai/briefing answers a member without revenue read a cashFlow of 0 (revenue, expenses and net) and builds its prompt only from the Activity rows the timeline rule serves them and the figures they read (no paid total, no money row title, no overdue or quote amounts, no figure of a module they do not read); a view-all ADMIN keeps the revenue figures but not the row naming the owner's PRIVATE contact; on the model's JSON answer and on the plain-text fallback alike; the OWNER's briefing keeps every row and figure", async () => {
    try {
      // The month's money: one invoice paid now (777).
      await db.invoice.create({
        data: { id: `${P}inv_adv`, invoiceNumber: 'v84a-INV-ADV', status: 'PAID', subtotal: 777, total: 777, currency: 'TTD', paidAt: new Date(), businessId: ID.bizA, contactId: ID.cTeam },
      });
      const briefing = async (user: string) => {
        const from = aiCalls.length;
        const res = await rest('get', `/ai/businesses/${ID.bizA}/ai/briefing`, user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
        const prompt = aiCalls.slice(from).filter((c) => c.feature === 'briefing').map((c) => c.text).join('\n');
        expect(prompt.length, `${user}: the briefing called the model`).toBeGreaterThan(0);
        return { body: res.body, prompt };
      };
      const cash = (body: any) => ({ revenue: Number(body.cashFlow?.revenue), expenses: Number(body.cashFlow?.expenses), net: Number(body.cashFlow?.net) });

      for (const mode of ['echo', 'text'] as const) {
        advisorReply = mode;
        // OWNER control: every figure and every recent row.
        const owner = await briefing(ID.owner);
        expect(cash(owner.body), `OWNER (${mode}): cashFlow`).toEqual({ revenue: 777, expenses: 0, net: 777 });
        for (const shown of ['Payment recorded: TTD 150', 'Invoice v84a-INV-1 posted to ledger', 'v84a private contact event', '$777', '$4,321', '$8,765', 'Active projects: 4']) {
          expect(owner.prompt, `OWNER (${mode}): the prompt carries ${shown}`).toContain(shown);
        }

        // revenue 'none' (crm, bookings, operations read): no revenue figure, no money row, no projects figure.
        const revNone = await briefing(ID.staffRevNone);
        expect(cash(revNone.body), `staffRevNone (${mode}): cashFlow`).toEqual({ revenue: 0, expenses: 0, net: 0 });
        for (const withheld of ['777', 'Payment recorded: TTD 150', 'v84a-INV-1', 'v84a private contact event', '4,321', '8,765', 'Active projects']) {
          expect(revNone.prompt, `staffRevNone (${mode}): the prompt carries ${withheld}`).not.toContain(withheld);
        }
        // The rows this member reads still reach the prompt.
        expect(revNone.prompt).toContain('v84a booking row');
        expect(revNone.prompt).toContain('v84a crmTeam row');
        expect(JSON.stringify(revNone.body), `staffRevNone (${mode}): the answer`).not.toContain('777');
      }

      // view-all ADMIN: the revenue figures, not the row naming the owner's PRIVATE contact (M7).
      advisorReply = 'echo';
      const admin = await briefing(ID.admin);
      expect(cash(admin.body), 'ADMIN: cashFlow').toEqual({ revenue: 777, expenses: 0, net: 777 });
      expect(admin.prompt).toContain('Payment recorded: TTD 150');
      expect(admin.prompt, 'ADMIN: the PRIVATE contact row').not.toContain('v84a private contact event');

      // Tenant control: B's member is refused A's briefing, and no model call is made for it.
      const from = aiCalls.length;
      expect((await rest('get', `/ai/businesses/${ID.bizA}/ai/briefing`, ID.ownerB)).status).toBe(403);
      expect(aiCalls.slice(from)).toEqual([]);
    } finally {
      advisorReply = 'echo';
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
    }
  });

  it("TS-20b (W7-BRIEFINGS-REST, review SEC-W6BS-1, D-63; was it.todo TS-20): POST commerce/businesses/:businessId/weekly-briefing, wholly revenue, refuses a member without revenue read (403, no model call) and answers a revenue reader who may not open a contact the briefing's finance queue names (the FIN8 'Slow payer: <name>' item) without the lines that name it; the OWNER's briefing is whole", async () => {
    try {
      await db.financeActionItem.create({
        data: { id: `${P}fai_priv`, businessId: ID.bizA, kind: 'SLOW_PAYER', severity: 'WARNING', title: 'Slow payer: Priv', body: 'Priv has 2 invoices more than 30 days overdue.', entityType: 'contact', entityId: ID.cPriv, amount: 250, status: 'OPEN' },
      });
      const weekly = (user: string) => rest('post', `/commerce/businesses/${ID.bizA}/weekly-briefing`, user, {});

      const from = aiCalls.length;
      const refused = await weekly(ID.staffRevNone);
      expect(refused.status, JSON.stringify(refused.body).slice(0, 300)).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain('lastWeekRevenue');
      expect(aiCalls.slice(from), 'no model call for a refused member').toEqual([]);

      // OWNER control: the whole answer, the finance queue in the prompt.
      const owner = await weekly(ID.owner);
      expect(owner.status, JSON.stringify(owner.body).slice(0, 300)).toBe(201);
      expect(owner.body).toMatchObject({ summary: WEEKLY_REPLY.summary, concerns: WEEKLY_REPLY.concerns, recommendation: WEEKLY_REPLY.recommendation });
      expect(typeof owner.body.lastWeekRevenue).toBe('number');
      expect(aiCalls.filter((c) => c.feature === 'financial_weekly_briefing').pop()?.text).toContain('Slow payer: Priv');

      // A view-all ADMIN and a crm-none revenue reader may not open the owner's PRIVATE contact.
      for (const [name, user] of [['admin', ID.admin], ['staffCrmNone', ID.staffCrmNone]] as const) {
        const res = await weekly(user);
        expect(res.status, `${name}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(201);
        expect(res.body.concerns, `${name}: concerns`).toEqual(['Cash is tight']);
        expect(res.body.summary, `${name}: summary`).toBe(WEEKLY_REPLY.summary);
        expect(res.body.highlights, `${name}: highlights`).toEqual(WEEKLY_REPLY.highlights);
        expect(JSON.stringify(res.body), `${name}: the PRIVATE contact's name`).not.toContain('Priv');
      }
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM finance_action_items WHERE id LIKE ${sqlLikePrefix(`${P}fai_`)}`);
    }
  });

  it("TS-20c (W7-BRIEFINGS-REST, review SEC-W6BS-1, D-63; was it.todo TS-20): the revenue-intelligence routes, wholly revenue, refuse a member without revenue read (403 on forecast, slow-payers, pricing-signals, briefing, regenerate and delegate-chase); the briefing and the slow-payer report answer a revenue reader only the slow payers and chase items of contacts they may open (crm read and visibilityClause), and none of the briefing's lines that name a contact they may not open; delegate-chase refuses a contact they may not open (404, nothing written); the OWNER's briefing is whole", async () => {
    const DAY_MS = 86_400_000;
    try {
      // Two open invoices the briefing chases: the owner's PRIVATE contact's (overdue, 250), the TEAM contact's (past due, 80).
      await db.invoice.createMany({
        data: [
          { id: `${P}inv_rb1`, invoiceNumber: 'v84a-INV-RB1', status: 'OVERDUE', subtotal: 250, total: 250, currency: 'TTD', dueDate: new Date(Date.now() - 20 * DAY_MS), businessId: ID.bizA, contactId: ID.cPriv },
          { id: `${P}inv_rb2`, invoiceNumber: 'v84a-INV-RB2', status: 'SENT', subtotal: 80, total: 80, currency: 'TTD', dueDate: new Date(Date.now() - 5 * DAY_MS), businessId: ID.bizA, contactId: ID.cTeam },
        ],
      });
      const base = `/commerce/businesses/${ID.bizA}/revenue-intelligence`;

      // revenue 'none': every route refused, nothing generated or written.
      const from = aiCalls.length;
      for (const [method, path] of [['get', 'forecast'], ['get', 'slow-payers'], ['get', 'pricing-signals'], ['get', 'briefing'], ['post', 'briefing/regenerate'], ['post', 'briefing/delegate-chase']] as const) {
        const res = await rest(method, `${base}/${path}`, ID.staffRevNone, method === 'post' ? { chase: { title: 'v84a chase', contactId: ID.cTeam } } : undefined);
        expect(res.status, `staffRevNone ${path}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(403);
        expect(JSON.stringify(res.body), `staffRevNone ${path}`).not.toMatch(/Priv|Team|Staff/);
      }
      expect(aiCalls.slice(from)).toEqual([]);
      expect(delegated).toEqual([]);

      type Snapshot = { briefing: { headline: string; whatsAtRisk: string[]; whatToChase: Array<{ title: string; contactId: string | null }>; whatToPlan: string[] }; slowPayers: { slowPayers: Array<{ contactId: string }> } };
      const read = async (user: string, path = 'briefing') => {
        const res = await rest(path === 'briefing' ? 'get' : 'post', `${base}/${path}`, user);
        expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(path === 'briefing' ? 200 : 201);
        const body = res.body as Snapshot;
        return {
          body,
          chases: body.briefing.whatToChase.map((c) => c.title),
          chaseContacts: body.briefing.whatToChase.map((c) => c.contactId),
          slow: body.slowPayers.slowPayers.map((s) => s.contactId).sort(),
        };
      };

      // OWNER control: the whole briefing (generated once, then the business's cached snapshot).
      const owner = await read(ID.owner);
      expect(owner.body.briefing.headline).toBe(REVENUE_REPLY.headline);
      expect(owner.chases).toEqual(['Chase v84a-INV-RB1', 'Chase v84a-INV-RB2', 'Review pricing']);
      expect(owner.chaseContacts).toEqual([ID.cPriv, ID.cTeam, null]);
      expect(owner.body.briefing.whatsAtRisk).toEqual(REVENUE_REPLY.whatsAtRisk);
      expect(owner.body.briefing.whatToPlan).toEqual(REVENUE_REPLY.whatToPlan);
      expect(owner.slow).toEqual([ID.cPriv, ID.cTeam, ID.cStaff].sort());

      const expected: Array<[string, string, { chases: string[]; slow: string[]; atRisk: string[]; plan: string[] }]> = [
        // view-all ADMIN: the TEAM contact, not the two PRIVATE contacts of other members.
        ['admin', ID.admin, { chases: ['Chase v84a-INV-RB2', 'Review pricing'], slow: [ID.cTeam], atRisk: ['Team has not paid v84a-INV-RB2', 'Two invoices are overdue'], plan: ['Review pricing'] }],
        // crm_view 'owned': its own contact only.
        ['staffOwned', ID.staffOwned, { chases: ['Review pricing'], slow: [ID.cStaff], atRisk: ['Two invoices are overdue'], plan: ['Book a check-in with Staff', 'Review pricing'] }],
        // crm 'none', revenue read: no contact at all.
        ['staffCrmNone', ID.staffCrmNone, { chases: ['Review pricing'], slow: [], atRisk: ['Two invoices are overdue'], plan: ['Review pricing'] }],
      ];
      for (const [name, user, want] of expected) {
        const got = await read(user);
        expect(got.chases, `${name}: chases`).toEqual(want.chases);
        expect(got.slow, `${name}: slow payers`).toEqual([...want.slow].sort());
        expect(got.body.briefing.whatsAtRisk, `${name}: whatsAtRisk`).toEqual(want.atRisk);
        expect(got.body.briefing.whatToPlan, `${name}: whatToPlan`).toEqual(want.plan);
        expect(got.body.briefing.headline, `${name}: the headline names a contact they may not open`).not.toContain('Priv');
        expect(JSON.stringify(got.body), `${name}: the owner's PRIVATE contact`).not.toContain(ID.cPriv);

        const report = await rest('get', `${base}/slow-payers`, user);
        expect(report.status).toBe(200);
        expect(report.body.slowPayers.map((s: { contactId: string }) => s.contactId).sort(), `${name}: slow-payers report`).toEqual([...want.slow].sort());
      }
      // A regenerated briefing is filtered as the cached one is.
      const regenerated = await read(ID.admin, 'briefing/regenerate');
      expect(regenerated.chases).toEqual(['Chase v84a-INV-RB2', 'Review pricing']);
      expect((await rest('get', `${base}/slow-payers`, ID.owner)).body.slowPayers).toHaveLength(3);
      expect((await rest('get', `${base}/forecast`, ID.owner)).status).toBe(200);

      // delegate-chase: a contact the member may not open is refused as absent; one they may open is delegated.
      const hidden = await rest('post', `${base}/briefing/delegate-chase`, ID.admin, { chase: { title: 'Chase v84a-INV-RB1', contactId: ID.cPriv } });
      expect(hidden.status, JSON.stringify(hidden.body).slice(0, 200)).toBe(404);
      expect(delegated).toEqual([]);
      const open = await rest('post', `${base}/briefing/delegate-chase`, ID.admin, { chase: { title: 'Chase v84a-INV-RB2', contactId: ID.cTeam } });
      expect(open.status, JSON.stringify(open.body).slice(0, 200)).toBe(201);
      expect(delegated).toEqual([expect.objectContaining({ title: 'Chase v84a-INV-RB2', contactId: ID.cTeam })]);

      // Tenant control: B's member is refused A's briefing.
      expect((await rest('get', `${base}/briefing`, ID.ownerB)).status).toBe(403);
    } finally {
      delegated.length = 0;
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
    }
  });

  it("TS-20d (W7-BRIEFINGS-REST review SEC-W7BR-1, D-63, D-64): POST .../revenue-intelligence/briefing/delegate-chase binds a chase to the contact of the invoice or quote it names, read from the business's own record: a chase on a live invoice or quote whose contact the member may not open is refused as absent (404, nothing written) whether or not the body names that contact; a body naming another contact than its record's, a relation other than an invoice or a quote, or a relatedId with no relation is refused (400), and another business's or a missing invoice as absent (404); a chase may not rewrite or unbind a delegated chase bound to a contact the member may not open (a hand-written chase's key included); the OWNER's chases, and a member's chase on an invoice whose contact they may open, are written bound to the record's contact", async () => {
    const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const base = `/commerce/businesses/${ID.bizA}/revenue-intelligence`;
    const invPriv = `${P}inv_dc1`;
    const invTeam = `${P}inv_dc2`;
    const invB = `${P}inv_dcB`;
    const quotePriv = `${P}q_dc1`;
    const contactB = `${P}cDcB`;
    try {
      await db.contact.create({ data: { id: contactB, businessId: ID.bizB, firstName: 'BeeContact', visibility: 'TEAM', ownerId: ID.ownerB } });
      await db.invoice.createMany({
        data: [
          { id: invPriv, invoiceNumber: 'v84a-INV-DC1', status: 'OVERDUE', subtotal: 250, total: 250, currency: 'TTD', dueDate: new Date(Date.now() - 20 * 86_400_000), businessId: ID.bizA, contactId: ID.cPriv },
          { id: invTeam, invoiceNumber: 'v84a-INV-DC2', status: 'SENT', subtotal: 80, total: 80, currency: 'TTD', businessId: ID.bizA, contactId: ID.cTeam },
          { id: invB, invoiceNumber: 'v84a-INV-DCB', status: 'SENT', subtotal: 10, total: 10, currency: 'TTD', businessId: ID.bizB, contactId: contactB },
        ],
      });
      await db.quote.create({ data: { id: quotePriv, quoteNumber: 'v84a-Q-DC1', status: 'SENT', total: 300, businessId: ID.bizA, contactId: ID.cPriv } });
      // The real writer (its upsert on the chase's key); no event leaves the suite.
      revenueActionWriter = new RevenueActionService(app.get(PrismaService), { emit: () => true } as any, {} as any, {} as any);
      const delegate = (user: string, chase: object) => rest('post', `${base}/briefing/delegate-chase`, user, { chase });
      const rows = () => db.revenueAction.findMany({
        where: { businessId: ID.bizA, type: 'CHASE_FROM_BRIEFING' },
        orderBy: { relatedId: 'asc' },
        select: { title: true, detail: true, contactId: true, relatedType: true, relatedId: true, amountAtRisk: true },
      });

      // OWNER control: the chase on the PRIVATE contact's invoice, and a hand-written chase naming that contact.
      const ownerInvoice = await delegate(ID.owner, { title: 'Chase v84a-INV-DC1', detail: 'owner detail', amountAtRisk: 250, contactId: ID.cPriv, relatedType: 'invoice', relatedId: invPriv });
      expect(ownerInvoice.status, JSON.stringify(ownerInvoice.body).slice(0, 200)).toBe(201);
      expect(ownerInvoice.body.created).toBe(true);
      const ownerHand = await delegate(ID.owner, { title: 'Call Priv about the deposit', detail: 'owner note', contactId: ID.cPriv });
      expect(ownerHand.status, JSON.stringify(ownerHand.body).slice(0, 200)).toBe(201);
      expect(ownerHand.body.created).toBe(true);
      const before = await rows();
      expect(before).toEqual([
        { title: 'Call Priv about the deposit', detail: 'owner note', contactId: ID.cPriv, relatedType: 'briefing', relatedId: 'briefing:call-priv-about-the-deposit', amountAtRisk: null },
        { title: 'Chase v84a-INV-DC1', detail: 'owner detail', contactId: ID.cPriv, relatedType: 'invoice', relatedId: invPriv, amountAtRisk: 250 },
      ]);

      // A view-all ADMIN may not open the owner's PRIVATE contact: no way to it writes anything.
      const refused: Array<[string, object, number]> = [
        ['the contact named', { title: 'admin chase', contactId: ID.cPriv, relatedType: 'invoice', relatedId: invPriv }, 404],
        ['the invoice alone (the review repro)', { title: 'rewritten by admin', detail: 'admin detail', amountAtRisk: 1, relatedType: 'invoice', relatedId: invPriv }, 404],
        ['the invoice with a null contact', { title: 'rewritten by admin', contactId: null, relatedType: 'invoice', relatedId: invPriv }, 404],
        ['the quote alone', { title: 'admin quote chase', relatedType: 'quote', relatedId: quotePriv }, 404],
        ["the hand-written chase's key, no contact", { title: 'Call Priv about the deposit', detail: 'rewritten by admin' }, 404],
        ["another contact than its invoice's", { title: 'admin chase', contactId: ID.cTeam, relatedType: 'invoice', relatedId: invPriv }, 400],
        ['a relation that is not an invoice or a quote', { title: 'admin chase', relatedType: 'contact', relatedId: ID.cPriv }, 400],
        ['the hand-written relation spelled out', { title: 'admin chase', relatedType: 'briefing', relatedId: 'briefing:call-priv-about-the-deposit' }, 400],
        ['a relatedId with no relation', { title: 'admin chase', relatedId: 'briefing:call-priv-about-the-deposit' }, 400],
        ["another business's invoice", { title: 'admin chase', relatedType: 'invoice', relatedId: invB }, 404],
        ['a missing invoice', { title: 'admin chase', relatedType: 'invoice', relatedId: `${P}inv_missing` }, 404],
      ];
      for (const [why, chase, status] of refused) {
        const res = await delegate(ID.admin, chase);
        expect(res.status, `ADMIN, ${why}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(status);
        expect(JSON.stringify(res.body), `ADMIN, ${why}`).not.toContain('Priv');
      }
      expect(await rows(), 'nothing the ADMIN was refused was written').toEqual(before);

      // The ADMIN's chase on the TEAM contact's invoice, naming no contact: written bound to the invoice's contact.
      const team = await delegate(ID.admin, { title: 'Chase v84a-INV-DC2', detail: 'admin detail', amountAtRisk: 80, relatedType: 'invoice', relatedId: invTeam });
      expect(team.status, JSON.stringify(team.body).slice(0, 200)).toBe(201);
      expect(team.body.created).toBe(true);
      expect(await rows()).toEqual([
        ...before,
        { title: 'Chase v84a-INV-DC2', detail: 'admin detail', contactId: ID.cTeam, relatedType: 'invoice', relatedId: invTeam, amountAtRisk: 80 },
      ]);
    } finally {
      revenueActionWriter = null;
      delegated.length = 0;
      await db.$executeRawUnsafe(`DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
      await db.$executeRawUnsafe(`DELETE FROM quotes WHERE id LIKE ${sqlLikePrefix(`${P}q_`)}`);
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
      await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id = '${contactB}'`);
    }
  });

  it("TS-20e (W7-BRIEFINGS-REST review SEC-W7BR-3, D-63, D-57): GET commerce/businesses/:businessId/financial-pulse, financial-alerts and cash-flow-forecast, the weekly briefing's figures and more, refuse a member without revenue read (403: no figure, no contact name), as POST weekly-briefing does; a revenue reader and the OWNER get them", async () => {
    try {
      await db.invoice.create({
        data: { id: `${P}inv_pulse`, invoiceNumber: 'v84a-INV-PULSE', status: 'OVERDUE', subtotal: 900, total: 900, currency: 'TTD', dueDate: new Date(Date.now() - 20 * 86_400_000), businessId: ID.bizA, contactId: ID.cPriv },
      });
      for (const path of ['financial-pulse', 'financial-alerts', 'cash-flow-forecast']) {
        const refused = await rest('get', `/commerce/businesses/${ID.bizA}/${path}`, ID.staffRevNone);
        expect(refused.status, `staffRevNone ${path}: ${JSON.stringify(refused.body).slice(0, 200)}`).toBe(403);
        expect(JSON.stringify(refused.body), `staffRevNone ${path}`).not.toMatch(/Priv|900|Receivables|cashPosition|currentBalance/);
        for (const user of [ID.owner, ID.staffCrmNone]) {
          const res = await rest('get', `/commerce/businesses/${ID.bizA}/${path}`, user);
          expect(res.status, `${user} ${path}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
        }
      }
      const pulse = await rest('get', `/commerce/businesses/${ID.bizA}/financial-pulse`, ID.owner);
      expect(pulse.body.topUnpaidInvoices.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toContain('v84a-INV-PULSE');
      expect((await rest('get', `/commerce/businesses/${ID.bizA}/financial-pulse`, ID.ownerB)).status, "B's member").toBe(403);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(`${P}inv_`)}`);
    }
  });

  it("TS-20f (W7-BRIEFINGS-REST review CR-W7BR-1, D-63): a briefing line is withheld for naming a contact the member may not open by that contact's full name (first and last name, whatever the spacing and case), display name or email, not for a common word that is only one part of a hidden contact's name: with PRIVATE contacts Chase Ramdial, Will Persad and Cash Mohammed (display name Cash M. Trading) in the finance queue, a view-all ADMIN's and an owned-view member's weekly briefing keep 'Cash is tight this week', a summary saying 'you will improve cash flow' and a recommendation beginning 'Chase INV-0042', and drop the lines that name those contacts; the OWNER's briefing is whole", async () => {
    const { briefingContactRule } = await import('../src/modules/commerce/revenue-intelligence.controller');
    const { resolveTimelineViewer } = await import('../src/modules/timeline/timeline-visibility');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const hidden = { chase: `${P}cChase`, will: `${P}cWill`, cash: `${P}cCash` };
    let clock: { mockRestore: () => void } | undefined;
    try {
      await db.contact.createMany({
        data: [
          { id: hidden.chase, businessId: ID.bizA, firstName: 'Chase', lastName: 'Ramdial', email: 'v84a_chase@test.local', visibility: 'PRIVATE', ownerId: ID.owner },
          { id: hidden.will, businessId: ID.bizA, firstName: 'Will', lastName: 'Persad', visibility: 'PRIVATE', ownerId: ID.owner },
          { id: hidden.cash, businessId: ID.bizA, firstName: 'Cash', lastName: 'Mohammed', displayName: 'Cash M. Trading', visibility: 'PRIVATE', ownerId: ID.owner },
        ],
      });
      await db.financeActionItem.createMany({
        data: Object.entries(hidden).map(([key, contactId]) => ({
          id: `${P}fai_${key}`, businessId: ID.bizA, kind: 'SLOW_PAYER', severity: 'WARNING', title: `Slow payer: ${key}`, body: 'v84a slow payer', entityType: 'contact', entityId: contactId, amount: 100, status: 'OPEN',
        })),
      });

      // The rule itself, over the database: the review's lines, and lines that do name a hidden contact.
      const prisma = app.get(PrismaService);
      const kept = ['Chase INV-0042 — Anika Ali', 'Follow up on outstanding invoices — you will improve cash flow', 'Cash is tight this week', 'Will you pay by Friday?'];
      const withheld = ['Chase Ramdial owes TTD 100', 'chase   RAMDIAL is late', 'Write to v84a_chase@test.local', 'Will Persad paid early', 'An order from Cash M. Trading is late', 'Cash Mohammed is paying slowly'];
      for (const [name, user] of [['admin', ID.admin], ['staffOwned', ID.staffOwned]] as const) {
        const rule = await briefingContactRule(prisma, await resolveTimelineViewer(prisma, ID.bizA, user), { id: { in: Object.values(hidden) } });
        for (const line of kept) expect(rule.namesHidden(line), `${name}: ${line}`).toBe(false);
        for (const line of withheld) expect(rule.namesHidden(line), `${name}: ${line}`).toBe(true);
      }
      const ownerRule = await briefingContactRule(prisma, await resolveTimelineViewer(prisma, ID.bizA, ID.owner), { id: { in: Object.values(hidden) } });
      for (const line of [...kept, ...withheld]) expect(ownerRule.namesHidden(line), `owner: ${line}`).toBe(false);

      // End to end: the weekly briefing. Its rate limit (5 a minute per business, CrmRateLimitGuard,
      // read from Date.now) already counts TS-20b's four calls, so this case's calls are made a minute on.
      const realNow = Date.now.bind(Date);
      clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
      weeklyReply = {
        summary: 'Follow up on outstanding invoices — you will improve cash flow',
        highlights: ['Will Persad paid early', 'Collections held up'],
        concerns: ['Cash is tight this week', 'Chase Ramdial is paying slowly', 'Mail to v84a_chase@test.local bounces'],
        recommendation: 'Chase INV-0042 this week',
        outlook: 'Stable',
      };
      for (const [name, user] of [['admin', ID.admin], ['staffOwned', ID.staffOwned]] as const) {
        const res = await rest('post', `/commerce/businesses/${ID.bizA}/weekly-briefing`, user, {});
        expect(res.status, `${name}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(201);
        expect(res.body, name).toMatchObject({
          summary: weeklyReply.summary,
          highlights: ['Collections held up'],
          concerns: ['Cash is tight this week'],
          recommendation: weeklyReply.recommendation,
          outlook: 'Stable',
        });
      }
      const owner = await rest('post', `/commerce/businesses/${ID.bizA}/weekly-briefing`, ID.owner, {});
      expect(owner.status).toBe(201);
      expect(owner.body).toMatchObject(weeklyReply);
    } finally {
      clock?.mockRestore();
      weeklyReply = WEEKLY_REPLY;
      await db.$executeRawUnsafe(`DELETE FROM finance_action_items WHERE id LIKE ${sqlLikePrefix(`${P}fai_`)}`);
      await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id IN ('${hidden.chase}', '${hidden.will}', '${hidden.cash}')`);
    }
  });

  it("TS-21 (W7-BRIEFINGS-REST, review SEC-W6BS-2, D-73, KEY-R3b SEC-R3b-4; was it.todo): POST /ai/businesses/:businessId/briefing/:planId/skip takes only the daily briefing (BRIEFING_SCOPE, its objective and raw input) of the business the route checked, for the member it runs as, the business OWNER or an ADMIN, as execute-all does: a STAFF member with ai 'none' is refused the OWNER's pending non-briefing plan (404) and the OWNER's briefing (403), and another business's briefing is refused (404), each left as it was with no audit row; a STAFF member skips the briefing it runs, and the OWNER skips the business's (201, plan completed, steps skipped, one plan:skip execution-log row naming who skipped)", async () => {
    const { BRIEFING_OBJECTIVE_PREFIX, BRIEFING_RAW_INPUT, BRIEFING_SCOPE } = await import('../src/modules/ai/morning-briefing.service');
    const planId = (key: string) => `${P}plan_${key}`;
    const seed = (key: string, businessId: string, userId: string, briefing: boolean) =>
      db.aiPlan.create({
        data: {
          id: planId(key),
          businessId,
          userId,
          objective: briefing ? `${BRIEFING_OBJECTIVE_PREFIX}2000-01-01` : `v84a ${key} plan`,
          rawInput: briefing ? BRIEFING_RAW_INPUT : 'v84a raw input',
          scope: briefing ? [BRIEFING_SCOPE] : ['crm'],
          status: 'approved',
          steps: { create: [{ id: `${P}step_${key}`, order: 1, status: 'pending', toolName: 'crm_list_contacts', module: 'crm', action: 'v84a list contacts' }] },
        },
      });
    const state = async (key: string) => {
      const row = await db.aiPlan.findUnique({ where: { id: planId(key) }, select: { status: true, userId: true, steps: { select: { status: true } } } });
      const logs = await db.aiExecutionLog.findMany({ where: { planId: planId(key) }, select: { action: true, userId: true, module: true, toolName: true, businessId: true } });
      return { status: row?.status, userId: row?.userId, steps: row?.steps.map((s: { status: string }) => s.status), logs };
    };
    const skip = (key: string, user: string) => rest('post', `/ai/businesses/${ID.bizA}/briefing/${planId(key)}/skip`, user);
    const untouched = (userId: string) => ({ status: 'approved', userId, steps: ['pending'], logs: [] });
    const skipped = (userId: string) => ({
      status: 'completed', userId, steps: ['skipped'],
      logs: [{ action: 'plan:skip', userId, module: 'planner', toolName: null, businessId: ID.bizA }],
    });
    try {
      await seed('other', ID.bizA, ID.owner, false);
      await seed('brief', ID.bizA, ID.owner, true);
      await seed('briefB', ID.bizB, ID.ownerB, true);
      await seed('staffs', ID.bizA, ID.staffDefault, true);

      // STAFF on role defaults (ai 'none'): not the OWNER's other plan, not the OWNER's briefing.
      const other = await skip('other', ID.staffDefault);
      expect(other.status, JSON.stringify(other.body).slice(0, 200)).toBe(404);
      expect(await state('other')).toEqual(untouched(ID.owner));
      const owners = await skip('brief', ID.staffDefault);
      expect(owners.status, JSON.stringify(owners.body).slice(0, 200)).toBe(403);
      expect(await state('brief')).toEqual(untouched(ID.owner));
      // Another business's briefing, named through A's route: refused as absent, even to A's OWNER.
      expect((await skip('briefB', ID.owner)).status).toBe(404);
      expect(await state('briefB')).toEqual(untouched(ID.ownerB));
      // B's member is refused A's route.
      expect((await skip('brief', ID.ownerB)).status).toBe(403);
      expect(await state('brief')).toEqual(untouched(ID.owner));

      // The member a briefing runs as skips it.
      const own = await skip('staffs', ID.staffDefault);
      expect(own.status, JSON.stringify(own.body).slice(0, 200)).toBe(201);
      expect(await state('staffs')).toEqual(skipped(ID.staffDefault));
      // OWNER control: the OWNER skips the business's briefing.
      const ownerSkip = await skip('brief', ID.owner);
      expect(ownerSkip.status, JSON.stringify(ownerSkip.body).slice(0, 200)).toBe(201);
      expect(await state('brief')).toEqual(skipped(ID.owner));
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`);
      await db.$executeRawUnsafe(`DELETE FROM ai_plans WHERE id LIKE ${sqlLikePrefix(`${P}plan_`)}`);
    }
  });

  it("TS-21b (W7-BRIEFINGS-REST review SEC-W7BR-2, D-73): POST /ai/businesses/:businessId/briefing/:planId/skip skips only the briefing's steps not yet run (pending): a step that ran (completed, its completedAt kept), failed (its errorMessage kept) or was handed on to run (approved) keeps its status, and the plan is closed (completed) only when no step is left to run; a skip that skips nothing (a repeat, or a briefing already finished) changes nothing and writes no further plan:skip row", async () => {
    const { BRIEFING_OBJECTIVE_PREFIX, BRIEFING_RAW_INPUT, BRIEFING_SCOPE } = await import('../src/modules/ai/morning-briefing.service');
    const planId = (key: string) => `${P}plan_${key}`;
    const RAN_AT = new Date('2000-01-01T08:00:00.000Z');
    const seed = (key: string, status: string, steps: Array<{ status: string; completedAt?: Date; errorMessage?: string }>) =>
      db.aiPlan.create({
        data: {
          id: planId(key),
          businessId: ID.bizA,
          userId: ID.owner,
          objective: `${BRIEFING_OBJECTIVE_PREFIX}2000-01-02`,
          rawInput: BRIEFING_RAW_INPUT,
          scope: [BRIEFING_SCOPE],
          status,
          steps: { create: steps.map((step, i) => ({ id: `${P}step_${key}_${i + 1}`, order: i + 1, toolName: 'crm_list_contacts', module: 'crm', action: `v84a step ${i + 1}`, ...step })) },
        },
      });
    const state = async (key: string) => {
      const row = await db.aiPlan.findUnique({
        where: { id: planId(key) },
        select: { status: true, steps: { orderBy: { order: 'asc' }, select: { status: true, completedAt: true, errorMessage: true } } },
      });
      const logs = await db.aiExecutionLog.findMany({ where: { planId: planId(key) }, select: { action: true, userId: true } });
      return { status: row?.status, steps: row?.steps, logs };
    };
    const skip = (key: string, user: string) => rest('post', `/ai/businesses/${ID.bizA}/briefing/${planId(key)}/skip`, user);
    const ran = { status: 'completed', completedAt: RAN_AT, errorMessage: null };
    const failed = { status: 'failed', completedAt: null, errorMessage: 'boom' };
    const approved = { status: 'approved', completedAt: null, errorMessage: null };
    const pending = { status: 'pending', completedAt: null, errorMessage: null };
    const skippedStep = { status: 'skipped', completedAt: null, errorMessage: null };
    // The route's rate limit (10 a minute per business, CrmRateLimitGuard, read from Date.now) already
    // counts TS-21's six calls, so this case's calls are made a minute on.
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    try {
      // The briefing the plan queue is running: one step ran, one failed, one is handed on to run, two wait.
      await seed('mixed', 'executing', [{ status: 'completed', completedAt: RAN_AT }, { status: 'failed', errorMessage: 'boom' }, { status: 'approved' }, { status: 'pending' }, { status: 'pending' }]);
      const admin = await skip('mixed', ID.admin);
      expect(admin.status, JSON.stringify(admin.body).slice(0, 200)).toBe(201);
      expect(admin.body).toEqual({ skipped: 2, status: 'executing' });
      const afterAdmin = { status: 'executing', steps: [ran, failed, approved, skippedStep, skippedStep], logs: [{ action: 'plan:skip', userId: ID.admin }] };
      expect(await state('mixed')).toEqual(afterAdmin);
      // A repeat skips nothing: nothing changes, no second audit row.
      for (const user of [ID.owner, ID.admin]) {
        const again = await skip('mixed', user);
        expect(again.status, JSON.stringify(again.body).slice(0, 200)).toBe(201);
        expect(again.body).toEqual({ skipped: 0, status: 'executing' });
        expect(await state('mixed')).toEqual(afterAdmin);
      }

      // No step left to run once the pending ones are skipped: the plan is closed.
      await seed('done', 'executing', [{ status: 'completed', completedAt: RAN_AT }, { status: 'pending' }]);
      const owner = await skip('done', ID.owner);
      expect(owner.status, JSON.stringify(owner.body).slice(0, 200)).toBe(201);
      expect(owner.body).toEqual({ skipped: 1, status: 'completed' });
      const closed = { status: 'completed', steps: [ran, skippedStep], logs: [{ action: 'plan:skip', userId: ID.owner }] };
      expect(await state('done')).toEqual(closed);
      const repeat = await skip('done', ID.owner);
      expect(repeat.status).toBe(201);
      expect(repeat.body).toEqual({ skipped: 0, status: 'completed' });
      expect(await state('done')).toEqual(closed);

      // A briefing already finished is left as it is, its pending step included.
      await seed('finished', 'partial', [{ status: 'completed', completedAt: RAN_AT }, { status: 'pending' }]);
      const finished = await skip('finished', ID.owner);
      expect(finished.status, JSON.stringify(finished.body).slice(0, 200)).toBe(201);
      expect(finished.body).toEqual({ skipped: 0, status: 'partial' });
      expect(await state('finished')).toEqual({ status: 'partial', steps: [ran, pending], logs: [] });
    } finally {
      clock.mockRestore();
      await db.$executeRawUnsafe(`DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`);
      await db.$executeRawUnsafe(`DELETE FROM ai_plans WHERE id LIKE ${sqlLikePrefix(`${P}plan_`)}`);
    }
  });
});

describe('W7-BRIEFINGS-REST review follow-up outside the write set (TS-22)', () => {
  it.todo(
    "TS-22 (review SEC-W7BR-4, D-63): what the briefings withhold is still served by two routes outside W7-BRIEFINGS-REST's write set: GET commerce/businesses/:businessId/revenue-actions (revenue-action.controller.ts, AuthGuard + BusinessGuard only) lists every revenue action, the CHASE_FROM_BRIEFING and SLOW_PAYER rows with their contactId and a title naming a contact the member may not open, to every member; and FinancialBriefingSchedulerService stores the weekly briefing as a business-wide 'financial.weekly_briefing' notification (lastWeekRevenue, 'Slow payer: <name>') that GET notifications/businesses/:businessId serves every member, a revenue-none member included",
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
