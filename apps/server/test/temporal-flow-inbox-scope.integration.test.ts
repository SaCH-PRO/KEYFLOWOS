/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE (REAL database; owner rulings D-100, D-179; found by the NAV-A1 security
 * review): the temporal-flow timeline (/app/temporal-flow, the Schedule hub's "Timeline") withholds the events a
 * module owns from a reader who cannot read that module.
 *
 * The defect: the timeline's reads (GET /temporal-flow/businesses/:b, GET .../calendar, GET .../reminders, and
 * the analysis POST .../analyze, which answers event titles and counts) carry only AuthGuard + BusinessGuard, so
 * any member read every event of the business. The KEY Inbox writes its message events there
 * (TemporalFlowKeyInboxListener: module 'key_inbox', the sender's handle as the summary, the AI's summary of the
 * message as the title), and the KEY Inbox's own routes require operations read (KeyInboxController:
 * @RequireModuleScope('operations')). A bookings-only member read the inbox through the timeline.
 *
 * The rule, read at the database before ordering and the limit (so a page holds as many events as the reader
 * may see, and no total or page boundary counts a withheld one), as ModuleScopeGuard reads a membership
 * (memberModuleLevel: the explicit permissionScopes map, a missing key none, D-179; else the role's defaults; a
 * platform SUPER_ADMIN passes, as the guard passes them). Each event names the modules of its owners (its
 * `module`, its `source` and its `type`); a reader sees it only when they read every one:
 *   - operations: the KEY Inbox's events (module key_inbox, type key_inbox.*, a messaging channel source:
 *     whatsapp, instagram, email, ... as the listener writes the thread's channel);
 *   - bookings: calendar events (module calendar, source GOOGLE_CALENDAR, type google_calendar.* / booking.*),
 *     the Google Calendar reads requiring bookings read (CalendarController);
 *   - revenue (D-100): money-bearing types (invoice.*, payment.*, ...) and module revenue;
 *   - every other event (business assets, the Business Genome and constitution, KEY actions, KEY's notes) is
 *     business-wide, as its owners' own reads are (membership only).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, the user, business, membership and
 * temporal_flow_events rows, AuthGuard, BusinessGuard, ModuleScopeGuard, TemporalFlowController and
 * TemporalFlowService are real against DATABASE_URL. The stand-ins: identity attachment (a test middleware reads
 * `x-test-user`, loads that seeded user and attaches `{ id, email, role }` as AuthMiddleware would), the
 * temporal memory service (no memory row: the analysis's memory insights are MEM-TEMPORAL-SCOPE's), the
 * semantic memory (absent), the memory queue and the genome bridge (no case reaches them).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v71w_` prefix and is hard-deleted by raw SQL in beforeAll
 * and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71w_';

const ID = {
  owner: `${P}owner`, // OWNER of biz, role defaults (every module admin)
  bookingsOnly: `${P}bookings`, // STAFF of biz, { bookings: read }
  bookingsWriter: `${P}bwriter`, // STAFF of biz, { bookings: write } (reaches the analysis, a bookings write)
  opsReader: `${P}ops`, // STAFF of biz, { bookings: read, operations: read }
  opsWriter: `${P}opswriter`, // STAFF of biz, { bookings: write, operations: read }
  revenueReader: `${P}revenue`, // STAFF of biz, { bookings: write, revenue: read }
  legacy: `${P}legacy`, // D-179: an older explicit map with no operations key (none)
  arrayScopes: `${P}array`, // ADMIN of biz whose stored scopes are a JSON array: every module none
  staffDefault: `${P}staffdef`, // STAFF of biz, role defaults (operations read, revenue read)
  crossOps: `${P}crossops`, // OWNER of bizOther, { bookings: read } STAFF of biz
  otherOwner: `${P}otherowner`, // OWNER of bizOther, no membership of biz
  superAdmin: `${P}super`, // SUPER_ADMIN, no membership
  stranger: `${P}stranger`, // no membership anywhere
  biz: `${P}biz`,
  bizOther: `${P}bizother`,
};

const USERS = [
  ID.owner, ID.bookingsOnly, ID.bookingsWriter, ID.opsReader, ID.opsWriter, ID.revenueReader, ID.legacy,
  ID.arrayScopes, ID.staffDefault, ID.crossOps, ID.otherOwner, ID.superAdmin, ID.stranger,
];

// Obviously fake values that must never reach a reader without the owning module's read.
const SENDER_HANDLE = `${P}sender_handle_secret`;
const AI_SUMMARY = `${P}ai_summary_secret`;
const OTHER_TENANT = `${P}other_tenant_secret`;

const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000);
const ago = (minutes: number) => at(minutes).toISOString();

type Seed = {
  key: string;
  businessId?: string;
  source: string;
  type: string;
  module?: string | null;
  title: string;
  summary?: string;
  occurredAt: Date;
  reminderAt?: Date;
  startsAt?: Date;
  importance?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

/**
 * The events of biz, newest first: the module-owned ones are the newest, so a filter applied after the limit
 * would hand a reader a short page.
 */
const SEEDS: Seed[] = [
  // operations (the KEY Inbox, as TemporalFlowKeyInboxListener writes them)
  { key: 'inboxReceived', source: 'key_inbox', type: 'key_inbox.message_received', module: 'key_inbox', title: 'key_inbox message received', summary: SENDER_HANDLE, occurredAt: at(1), payload: { senderHandle: SENDER_HANDLE }, reminderAt: at(5) },
  { key: 'inboxAnalyzed', source: 'whatsapp', type: 'key_inbox.message_analyzed', module: 'key_inbox', title: `Analysis: ${AI_SUMMARY}`, occurredAt: at(2), importance: 'CRITICAL', payload: { intent: 'complaint' } },
  { key: 'inboxRisk', source: 'key_inbox', type: 'key_inbox.risk_detected', module: 'key_inbox', title: `${AI_SUMMARY} risk`, summary: AI_SUMMARY, occurredAt: at(3), status: 'ACTION_REQUIRED', reminderAt: at(4) },
  // operations by source or type alone (no module): a channel message recorded by hand or by KEY
  { key: 'instagramDm', source: 'instagram', type: 'instagram.dm.received', module: null, title: `DM from ${SENDER_HANDLE}`, occurredAt: at(4) },
  { key: 'inboxTypeOnly', source: 'MANUAL', type: 'key_inbox.trend_detected', module: null, title: `Trend ${AI_SUMMARY}`, occurredAt: at(5) },
  // revenue (D-100)
  { key: 'invoiceOverdue', source: 'APP', type: 'invoice.overdue', module: null, title: `${P}Invoice INV-9 overdue 4,200.00`, occurredAt: at(6), importance: 'CRITICAL' },
  { key: 'revenueModule', source: 'key_cortex', type: 'note', module: 'revenue', title: `${P}Cash note 900.00`, occurredAt: at(7) },
  // bookings (the Google Calendar sync)
  { key: 'calendarSynced', source: 'GOOGLE_CALENDAR', type: 'google_calendar.event.synced', module: 'calendar', title: `${P}Dentist`, occurredAt: at(8), startsAt: at(8) },
  // business-wide
  { key: 'assetExpiring', source: 'APP', type: 'asset.expiring_soon', module: 'business-assets', title: `${P}Licence expiring soon`, occurredAt: at(20), reminderAt: at(30) },
  { key: 'constitution', source: 'KEY', type: 'constitution.version_generated', module: 'business-genome', title: `${P}Constitution v2 generated`, occurredAt: at(21) },
  { key: 'keyAction', source: 'KEY', type: 'key.action.create_task', module: 'key-autonomy', title: `${P}Follow up`, occurredAt: at(22), status: 'ACTION_REQUIRED' },
  { key: 'keyNote', source: 'key_cortex', type: 'note', module: null, title: `${P}KEY note`, occurredAt: at(23), importance: 'CRITICAL' },
  // the other tenant's inbox
  { key: 'otherInbox', businessId: ID.bizOther, source: 'key_inbox', type: 'key_inbox.message_received', module: 'key_inbox', title: OTHER_TENANT, summary: OTHER_TENANT, occurredAt: at(1), reminderAt: at(2) },
  { key: 'otherWide', businessId: ID.bizOther, source: 'KEY', type: 'note', module: null, title: `${OTHER_TENANT} wide`, occurredAt: at(1) },
];

const OPS = ['inboxReceived', 'inboxAnalyzed', 'inboxRisk', 'instagramDm', 'inboxTypeOnly'];
const REVENUE = ['invoiceOverdue', 'revenueModule'];
const BOOKINGS = ['calendarSynced'];
const WIDE = ['assetExpiring', 'constitution', 'keyAction', 'keyNote'];
const ALL_BIZ = [...OPS, ...REVENUE, ...BOOKINGS, ...WIDE];

const idOf = (key: string) => `${P}ev_${key}`;
const keyOfId = new Map(SEEDS.map((s) => [idOf(s.key), s.key]));

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TemporalFlowController } = await import('../src/modules/temporal-flow/temporal-flow.controller');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { TemporalFlowMemoryQueueService } = await import('../src/modules/temporal-flow/temporal-flow-memory.queue.service');
  const { TemporalFlowGenomeBridgeService } = await import('../src/modules/temporal-flow/temporal-flow-genome-bridge.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [TemporalFlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TemporalFlowService,
      { provide: TemporalFlowMemoryService, useValue: { findMany: async () => [] } },
      { provide: SemanticMemoryService, useValue: null },
      { provide: TemporalFlowMemoryQueueService, useValue: {} },
      { provide: TemporalFlowGenomeBridgeService, useValue: {} },
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of USERS) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71W Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizOther, name: 'V71W Other Biz', ownerId: ID.otherOwner } });
  const memberships: Array<[string, string, string, unknown]> = [
    [ID.owner, ID.biz, 'OWNER', null],
    [ID.bookingsOnly, ID.biz, 'STAFF', { bookings: 'read' }],
    [ID.bookingsWriter, ID.biz, 'STAFF', { bookings: 'write' }],
    [ID.opsReader, ID.biz, 'STAFF', { bookings: 'read', operations: 'read' }],
    [ID.opsWriter, ID.biz, 'STAFF', { bookings: 'write', operations: 'read' }],
    [ID.revenueReader, ID.biz, 'STAFF', { bookings: 'write', revenue: 'read' }],
    [ID.legacy, ID.biz, 'STAFF', { crm: 'read', bookings: 'write', revenue: 'none' }],
    [ID.arrayScopes, ID.biz, 'ADMIN', []],
    [ID.staffDefault, ID.biz, 'STAFF', null],
    [ID.otherOwner, ID.bizOther, 'OWNER', null],
    [ID.crossOps, ID.bizOther, 'OWNER', null],
    [ID.crossOps, ID.biz, 'STAFF', { bookings: 'read' }],
  ];
  for (const [userId, businessId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
  for (const s of SEEDS) {
    await db.temporalFlowEvent.create({
      data: {
        id: idOf(s.key),
        businessId: s.businessId ?? ID.biz,
        source: s.source,
        type: s.type,
        module: s.module ?? null,
        title: s.title,
        summary: s.summary ?? null,
        occurredAt: s.occurredAt,
        reminderAt: s.reminderAt ?? null,
        startsAt: s.startsAt ?? null,
        importance: s.importance ?? 'NORMAL',
        status: s.status ?? 'RECORDED',
        visibility: 'USER',
        payload: s.payload ?? {},
      },
    });
  }
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

const agent = () => request(app.getHttpServer());
const as = (req: any, actor: string) => req.set('x-test-user', actor);

const listOf = (actor: string, query = '', businessId = ID.biz) =>
  as(agent().get(`/temporal-flow/businesses/${businessId}${query}`), actor);
const calendarOf = (actor: string, businessId = ID.biz) =>
  as(agent().get(`/temporal-flow/businesses/${businessId}/calendar?from=${encodeURIComponent(ago(60))}&to=${encodeURIComponent(new Date(NOW + 60_000).toISOString())}`), actor);
const remindersOf = (actor: string, businessId = ID.biz) => as(agent().get(`/temporal-flow/businesses/${businessId}/reminders`), actor);
const analyzeOf = (actor: string, businessId = ID.biz) => as(agent().post(`/temporal-flow/businesses/${businessId}/analyze`), actor);

function keysOf(res: { status: number; body: any }, who: string): string[] {
  expect(res.status, `${who} ${JSON.stringify(res.body)}`).toBe(200);
  expect(Array.isArray(res.body), who).toBe(true);
  return res.body.map((e: any) => keyOfId.get(e.id) ?? `unknown:${e.id}`);
}

const sorted = (keys: string[]) => [...keys].sort();
const without = (keys: string[], ...hidden: string[][]) => keys.filter((k) => !hidden.flat().includes(k));

function expectNoSecret(body: unknown, who: string, secrets = [SENDER_HANDLE, AI_SUMMARY]) {
  const text = JSON.stringify(body);
  for (const s of secrets) expect(text, `${who} saw ${s}`).not.toContain(s);
  expect(text, `${who} saw the other tenant`).not.toContain(OTHER_TENANT);
}

describe('FU-TEMPORAL-FLOW-INBOX-SCOPE: GET /temporal-flow/businesses/:b (the timeline)', () => {
  it('a bookings-only member does not see the KEY Inbox events (sender handles, AI summaries), nor money events (D-100)', async () => {
    const res = await listOf(ID.bookingsOnly);
    expect(sorted(keysOf(res, 'bookingsOnly'))).toEqual(sorted([...BOOKINGS, ...WIDE]));
    expectNoSecret(res.body, 'bookingsOnly');
  });

  it('an operations reader still sees the KEY Inbox events; without revenue read they see no money event', async () => {
    const res = await listOf(ID.opsReader);
    expect(sorted(keysOf(res, 'opsReader'))).toEqual(sorted([...OPS, ...BOOKINGS, ...WIDE]));
    expect(JSON.stringify(res.body)).toContain(SENDER_HANDLE);
    expect(JSON.stringify(res.body)).toContain(AI_SUMMARY);
  });

  it('a revenue reader without operations read sees the money events and no KEY Inbox event', async () => {
    const res = await listOf(ID.revenueReader);
    expect(sorted(keysOf(res, 'revenueReader'))).toEqual(sorted([...REVENUE, ...BOOKINGS, ...WIDE]));
    expectNoSecret(res.body, 'revenueReader');
  });

  it('the owner (role defaults), a STAFF member on role defaults and a platform SUPER_ADMIN see every event of the business, newest first', async () => {
    for (const who of [ID.owner, ID.staffDefault, ID.superAdmin]) {
      const res = await listOf(who);
      const keys = keysOf(res, who);
      expect(sorted(keys), who).toEqual(sorted(ALL_BIZ));
      expect(keys, who).toEqual(ALL_BIZ); // SEEDS are newest first
    }
  });

  it('D-179: an older explicit map with no operations key, and a stored JSON array, see no KEY Inbox event', async () => {
    const legacy = await listOf(ID.legacy);
    expect(sorted(keysOf(legacy, 'legacy'))).toEqual(sorted(without(ALL_BIZ, OPS, REVENUE)));
    expectNoSecret(legacy.body, 'legacy');
    const arr = await listOf(ID.arrayScopes);
    expect(sorted(keysOf(arr, 'arrayScopes'))).toEqual(sorted(WIDE));
    expectNoSecret(arr.body, 'arrayScopes');
  });

  it('the limit counts only events the reader may see: a page of 2 is the 2 newest visible ones', async () => {
    const res = await listOf(ID.bookingsOnly, '?limit=2');
    expect(keysOf(res, 'bookingsOnly limit 2')).toEqual(['calendarSynced', 'assetExpiring']);
    const ops = await listOf(ID.opsReader, '?limit=2');
    expect(keysOf(ops, 'opsReader limit 2')).toEqual(['inboxReceived', 'inboxAnalyzed']);
  });

  it('a filter naming the hidden module answers nothing, not a refusal that tells the events exist', async () => {
    for (const q of ['?module=key_inbox', '?source=key_inbox', '?type=key_inbox.message_received', '?source=instagram', '?type=invoice.overdue']) {
      const res = await listOf(ID.bookingsOnly, q);
      expect(keysOf(res, `bookingsOnly ${q}`), q).toEqual([]);
    }
    const ops = await listOf(ID.opsReader, '?module=key_inbox');
    expect(sorted(keysOf(ops, 'opsReader module=key_inbox'))).toEqual(sorted(['inboxReceived', 'inboxAnalyzed', 'inboxRisk']));
  });
});

describe('FU-TEMPORAL-FLOW-INBOX-SCOPE: calendar and reminders', () => {
  it('GET .../calendar withholds the KEY Inbox and money events from a bookings-only member', async () => {
    const res = await calendarOf(ID.bookingsOnly);
    expect(sorted(keysOf(res, 'bookingsOnly calendar'))).toEqual(sorted([...BOOKINGS, ...WIDE]));
    expectNoSecret(res.body, 'bookingsOnly calendar');
    const ops = await calendarOf(ID.opsReader);
    expect(sorted(keysOf(ops, 'opsReader calendar'))).toEqual(sorted([...OPS, ...BOOKINGS, ...WIDE]));
  });

  it('GET .../reminders withholds the KEY Inbox reminders from a bookings-only member', async () => {
    const res = await remindersOf(ID.bookingsOnly);
    expect(keysOf(res, 'bookingsOnly reminders')).toEqual(['assetExpiring']);
    expectNoSecret(res.body, 'bookingsOnly reminders');
    const ops = await remindersOf(ID.opsReader);
    expect(keysOf(ops, 'opsReader reminders')).toEqual(['assetExpiring', 'inboxReceived', 'inboxRisk']);
  });
});

describe('FU-TEMPORAL-FLOW-INBOX-SCOPE: POST .../analyze (titles and counts of the timeline)', () => {
  it('a bookings writer without operations or revenue read: the counts and items name no withheld event', async () => {
    const res = await analyzeOf(ID.bookingsWriter);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const visible = BOOKINGS.length + WIDE.length;
    expect(res.body.summary).toContain(`${visible} events analyzed.`);
    // keyNote is the one CRITICAL event the writer may see; the CRITICAL inbox and invoice events are withheld.
    expect(res.body.urgentItems.map((u: any) => u.eventId ?? u.title)).toEqual(['Assets expiring soon', idOf('keyNote')]);
    expect(res.body.risks.map((r: any) => r.title)).toEqual(['Operational/legal risk from expiring assets']);
    expectNoSecret(res.body, 'bookingsWriter analyze', [SENDER_HANDLE, AI_SUMMARY, `${P}Invoice`]);
  });

  it('an operations writer sees the inbox in the analysis; a revenue reader sees the overdue invoice', async () => {
    const ops = await analyzeOf(ID.opsWriter);
    expect(ops.status, JSON.stringify(ops.body)).toBe(201);
    expect(ops.body.summary).toContain(`${OPS.length + BOOKINGS.length + WIDE.length} events analyzed.`);
    expect(JSON.stringify(ops.body)).toContain(AI_SUMMARY);
    expect(JSON.stringify(ops.body)).not.toContain(`${P}Invoice`);

    const rev = await analyzeOf(ID.revenueReader);
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.summary).toContain(`${REVENUE.length + BOOKINGS.length + WIDE.length} events analyzed.`);
    expect(rev.body.urgentItems.some((u: any) => u.title === 'Overdue invoices need follow-up')).toBe(true);
    expectNoSecret(rev.body, 'revenueReader analyze');
  });

  it('a bookings-read-only member is still refused the analysis (a bookings write, D-152)', async () => {
    const res = await analyzeOf(ID.bookingsOnly);
    expect(res.status).toBe(403);
  });
});

describe('FU-TEMPORAL-FLOW-INBOX-SCOPE: cross-tenant', () => {
  it('a member of another business only, and a stranger, are refused every timeline read of biz', async () => {
    for (const who of [ID.otherOwner, ID.stranger]) {
      for (const res of [await listOf(who), await calendarOf(who), await remindersOf(who), await analyzeOf(who)]) {
        expect(res.status, `${who} ${JSON.stringify(res.body)}`).toBe(403);
        expectNoSecret(res.body, who);
      }
    }
  });

  it('a member whose levels differ per business is read by the route business: OWNER of bizOther, bookings-only in biz', async () => {
    const res = await listOf(ID.crossOps);
    expect(sorted(keysOf(res, 'crossOps biz'))).toEqual(sorted([...BOOKINGS, ...WIDE]));
    expectNoSecret(res.body, 'crossOps biz');
    const other = await listOf(ID.crossOps, '', ID.bizOther);
    expect(sorted(keysOf(other, 'crossOps bizOther'))).toEqual(sorted(['otherInbox', 'otherWide']));
  });

  it('no read of biz answers an event of bizOther', async () => {
    for (const who of [ID.owner, ID.superAdmin, ID.opsReader]) {
      for (const res of [await listOf(who), await calendarOf(who), await remindersOf(who)]) {
        expect(JSON.stringify(res.body), who).not.toContain(OTHER_TENANT);
      }
    }
  });
});

describe('FU-TEMPORAL-FLOW-INBOX-SCOPE review repairs: the timeline writes do not reach a withheld event', () => {
  const resolveOf = (actor: string, key: string, businessId = ID.biz) =>
    as(agent().patch(`/temporal-flow/businesses/${businessId}/${idOf(key)}/resolve`), actor);
  const statusOf = async (key: string) =>
    (await db.temporalFlowEvent.findUnique({ where: { id: idOf(key) }, select: { status: true } }))?.status;

  it('SEC N-2: a bookings writer cannot resolve a KEY Inbox event, and the answer is the one an unknown event gets', async () => {
    const res = await resolveOf(ID.bookingsWriter, 'inboxRisk');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ count: 0 });
    expect(await statusOf('inboxRisk')).toBe('ACTION_REQUIRED');
    const unknown = await as(agent().patch(`/temporal-flow/businesses/${ID.biz}/${P}ev_nope/resolve`), ID.bookingsWriter);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ count: 0 });
    // the other tenant's event, by a writer of biz
    const other = await resolveOf(ID.opsWriter, 'otherInbox');
    expect(other.body).toEqual({ count: 0 });
    expect(await statusOf('otherInbox')).toBe('RECORDED');
  });

  it('SEC N-2: an operations writer still resolves it', async () => {
    const res = await resolveOf(ID.opsWriter, 'inboxRisk');
    expect(res.body).toEqual({ count: 1 });
    expect(await statusOf('inboxRisk')).toBe('RESOLVED');
  });

  it('SEC N-3: a bookings writer cannot upsert over a KEY Inbox event by its external id, nor read it back', async () => {
    const externalId = `${P}key-inbox:key_inbox.message_received:thread`;
    await db.temporalFlowEvent.update({ where: { id: idOf('inboxReceived') }, data: { externalId } });
    const res = await as(
      agent().post(`/temporal-flow/businesses/${ID.biz}`).send({ source: 'key_inbox', type: 'manual.note', title: `${P}overwrite`, externalId }),
      ID.bookingsWriter,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expectNoSecret(res.body, 'bookingsWriter upsert');
    const row = await db.temporalFlowEvent.findUnique({ where: { id: idOf('inboxReceived') }, select: { title: true, summary: true } });
    expect(row).toEqual({ title: 'key_inbox message received', summary: SENDER_HANDLE });
  });

  it('SEC N-3: a bookings writer still creates and upserts their own business-wide events', async () => {
    const externalId = `${P}own-note`;
    const first = await as(agent().post(`/temporal-flow/businesses/${ID.biz}`).send({ source: 'MANUAL', type: 'manual.event', title: `${P}own 1`, externalId }), ID.bookingsWriter);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await as(agent().post(`/temporal-flow/businesses/${ID.biz}`).send({ source: 'MANUAL', type: 'manual.event', title: `${P}own 2`, externalId }), ID.bookingsWriter);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.title).toBe(`${P}own 2`);
  });
});
