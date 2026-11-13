/**
 * V1-84 (FOLLOW3-D7-KEY-CONTACT-READS-VIS), owner ruling D-37 (2026-11-03): KEY member-chat
 * contact and calendar reads pass the member as the actor and apply the CRM visibility clause
 * (REAL database).
 *
 * Trial-N repair round 2 taught the dispatcher's contact reads (crm_search_contacts,
 * crm_list_contacts, crm_find_duplicates, crm_merge_preview) the principal's CRM visibility
 * (FlowOrchestratorService.contactReadAccess: resolveCrmAccess + visibilityClause, the rule GET
 * contacts applies), but only for a call that reaches the executor with an ActionContext. Member
 * chat (POST /ai/businesses/:b/flow/chat, its stream, and the confirm route) built that context
 * for every tool call and then handed it on only for the capabilities the action boundary has
 * adopted (governToolCall), so a contact read in member chat ran with no principal and answered
 * the whole business: a STAFF member kept to their own book (crm_view 'owned'), an ADMIN and a
 * view-all STAFF member each got the OWNER's PRIVATE contact's name, email and phone, and so did
 * the model. calendar_list_events and bookings_list_bookings read calendar rows and a booking's
 * contact the same way.
 *
 * Nothing on the authorization path is mocked: PrismaService, the user, business, membership,
 * contact, share, calendar-event, service, booking, policy and confirmation rows, AuthGuard,
 * BusinessGuard, CrmRateLimitGuard, the global ValidationPipe, AiFlowController, AiOversightService
 * (the governance decision), KeyActionBoundaryService (which tools it adopts),
 * JobRolePolicyService (the staff-bridge envelope) and FlowOrchestratorService's chat,
 * streamChat, confirmation, governToolCall and executor paths are real against DATABASE_URL. The stand-ins: identity attachment (a test middleware loads the seeded
 * user named by `x-test-user` and attaches `{ id, email, role }`, as AuthMiddleware does after
 * token verification); the model gateway (AiUsageService.trackAndComplete / trackAndStream), which
 * emits exactly one scripted tool call and then a fixed reply, so no provider is called; and the
 * prompt-building context reads chat() makes before the gateway (business graph, memories,
 * blueprint, perception, triage, tool menu, session persistence), which decide nothing on this
 * path. The turn's crew is stubbed to none, as key-action-boundary-surfaces does, so the legacy
 * governance decision is the business's policy alone (tier 1 reads auto-execute by default).
 *
 * Fixtures: prefix `v84g_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw
 * SQL with sqlLikePrefix() in beforeAll and afterAll. No $transaction wrapping. Cases tagged
 * RED-BEFORE fail on the unmodified dispatcher; CONTROL cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84g_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  admin: `${P}admin`, // ADMIN of bizA, no explicit scope map (crm admin, view all)
  staffOwned: `${P}staffOwned`, // STAFF of bizA: crm write, crm_view 'owned' (my book)
  staffAll: `${P}staffAll`, // STAFF of bizA: crm read (view all)
  ownerB: `${P}ownerB`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cPriv: `${P}cPriv`, // PRIVATE, owned by owner
  cTeam: `${P}cTeam`, // TEAM, owned by owner
  cMine: `${P}cMine`, // TEAM, owned by staffOwned
  cShared: `${P}cShared`, // PRIVATE, owned by owner, shared with staffOwned
  cOther: `${P}cOther`, // bizB's contact
  evPriv: `${P}evPriv`, // calendar event on cPriv
  evTeam: `${P}evTeam`, // calendar event on cTeam
  evMine: `${P}evMine`, // calendar event on cMine
  evNone: `${P}evNone`, // calendar event with no contact
  svc: `${P}svc`,
  bkPriv: `${P}bkPriv`, // booking for cPriv
  bkTeam: `${P}bkTeam`, // booking for cTeam
  bkMine: `${P}bkMine`, // booking for cMine
  wlPriv: `${P}wlPriv`, // waitlist entry for cPriv
  wlTeam: `${P}wlTeam`, // waitlist entry for cTeam
  wlMine: `${P}wlMine`, // waitlist entry for cMine
  invPriv: `${P}invPriv`, // PAID invoice for cPriv (the top spender)
  invTeam: `${P}invTeam`, // PAID invoice for cTeam
  invMine: `${P}invMine`, // PAID invoice for cMine
};
/** What the owner's PRIVATE contact must never disclose to a member who may not open it. */
const PRIVATE = { firstName: 'V84GPrivate', email: `${P}private@test.local`, phone: '+18685550147' };
const TEAM = { firstName: 'V84GTeam', email: `${P}team@test.local`, phone: '+18685550148' };
const MINE = { firstName: 'V84GMine', email: `${P}mine@test.local`, phone: '+18685550149' };
const SHARED = { firstName: 'V84GShared', email: `${P}shared@test.local`, phone: '+18685550150' };
const OTHER = { firstName: 'V84GOther', email: `${P}other@test.local`, phone: '+18685550151' };

let db: any;
let app: any;
let orchestrator: any;
let jobRolePolicy: any;

// ---- the model gateway: one scripted tool call, then a fixed reply ----------------------------
const gateway = {
  /** The single tool call the model emits on the next turn. */
  script: null as null | { name: string; args: Record<string, unknown> },
  seq: 0,
  /** Every tool result the model was sent back (the follow-up request's 'tool' messages). */
  toolMessages: [] as string[],
};
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
const aiUsage = {
  checkRateLimit() {},
  async checkCredits() {
    return { allowed: true };
  },
  async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: { messages: Array<{ role: string; content: unknown }> }) {
    const tools = req.messages.filter((m) => m.role === 'tool');
    if (tools.length) {
      gateway.toolMessages.push(...tools.map((m) => String(m.content)));
      return { content: 'Here is what I found.', toolCalls: [], usage };
    }
    if (!gateway.script) throw new Error('no scripted tool call for this turn');
    gateway.seq += 1;
    return {
      content: '',
      toolCalls: [{ id: `call_${gateway.seq}`, type: 'function', function: { name: gateway.script.name, arguments: JSON.stringify(gateway.script.args) } }],
      usage,
    };
  },
  async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: { messages: Array<{ role: string; content: unknown }> }) {
    const tools = req.messages.filter((m) => m.role === 'tool');
    if (tools.length) {
      gateway.toolMessages.push(...tools.map((m) => String(m.content)));
      yield { type: 'content_delta', content: 'Here is what I found.' };
      return;
    }
    if (!gateway.script) throw new Error('no scripted tool call for this turn');
    gateway.seq += 1;
    yield { type: 'tool_call_delta', toolCall: { index: 0, id: `call_${gateway.seq}`, name: gateway.script.name, argumentsDelta: JSON.stringify(gateway.script.args) } };
    yield { type: 'usage', usage };
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM booking_waitlist_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM calendar_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let ipSeq = 0;
/** A distinct client address per request, so CrmRateLimitGuard's per-address buckets never cap the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.84.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

const chatUrl = `/ai/businesses/${ID.bizA}/flow/chat`;

/** One member-chat turn in which the model calls `name` with `args`. */
async function chatTurn(actor: string, name: string, args: Record<string, unknown>) {
  gateway.script = { name, args };
  const res = await request(app.getHttpServer())
    .post(chatUrl)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ message: `Please run ${name}` })
    .expect(201);
  gateway.script = null;
  return res.body;
}

/** The single tool result of a turn, asserting the tool ran. */
function onlyResult(body: any, name: string) {
  expect(body.toolResults, JSON.stringify(body).slice(0, 400)).toHaveLength(1);
  const [r] = body.toolResults;
  expect(r.name).toBe(name);
  expect(r.success, r.error).toBe(true);
  return r.result;
}

/**
 * One member-chat turn that runs `name` to its result: when KEY asks the member to confirm it (a
 * tier-2 tool such as segment_contacts), the member confirms it (POST flow/confirm) as KC-01g does.
 */
async function memberRuns(actor: string, name: string, args: Record<string, unknown>) {
  const body = await chatTurn(actor, name, args);
  if (!body.requiresConfirmation) return body;
  const [pending] = body.pendingConfirmations;
  const res = await request(app.getHttpServer())
    .post(`/ai/businesses/${ID.bizA}/flow/confirm`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ toolCallId: pending.toolCallId, confirmed: true, confirmationId: pending.confirmationId })
    .expect(201);
  return { proposed: body, ...res.body };
}

/** The single (failed) tool result of a turn. */
function onlyFailure(body: any, name: string) {
  expect(body.toolResults, JSON.stringify(body).slice(0, 400)).toHaveLength(1);
  const [r] = body.toolResults;
  expect(r.name).toBe(name);
  expect(r.success, JSON.stringify(r).slice(0, 400)).toBe(false);
  return r.error as string;
}

const contactIds = (result: any) => (result.contacts as Array<{ id: string }>).map((c) => c.id).sort();

/** The PRIVATE contact's identifying values, absent from the member's answer and from what the model was sent. */
function expectNoPrivate(body: unknown) {
  const member = JSON.stringify(body);
  const model = gateway.toolMessages.join('\n');
  for (const value of [ID.cPriv, PRIVATE.firstName, PRIVATE.email, PRIVATE.phone]) {
    expect(member, `member answer discloses ${value}`).not.toContain(value);
    expect(model, `model was sent ${value}`).not.toContain(value);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');

  Logger.overrideLogger(false);
  const prisma = new PrismaService();
  jobRolePolicy = new JobRolePolicyService();

  // The orchestrator's lazy cross-module edges, real where this path consults them.
  const registry = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!registry.has(token)) throw new Error(`test moduleRef has no provider for ${token?.name ?? String(token)}`);
      return registry.get(token);
    },
  };
  registry.set(KeyActionBoundaryService, new KeyActionBoundaryService(prisma as any, moduleRef as any));
  registry.set(JobRolePolicyService, jobRolePolicy);
  // bookings_list_waitlist reads through the real service (its event bus is not consulted on a read).
  registry.set(BookingWaitlistService, new BookingWaitlistService(prisma as any, { emit() { return true; } } as any));

  const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
  // The real class: chat, streamChat, the confirmation claim, governToolCall, executeTool and
  // executeToolAction are its own. Only the prompt-building context reads are stubbed.
  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    moduleRef,
    aiUsage,
    governance: new AiOversightService(prisma as any, {} as any, {} as any, {} as any, {} as any, jobRolePolicy),
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async () => ({ business: { name: 'V84G Biz A' } }),
      buildContextString: () => '',
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    getTriage: () => null,
    selectToolsForRequest: async () => [],
    resolveTurnAuthority: async () => ({ primary: 'general', crew: [], scores: {} }),
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
  });

  const testing = await Test.createTestingModule({
    controllers: [AiFlowController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: FlowOrchestratorService, useValue: orchestrator },
    ],
  }).compile();

  app = testing.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const name of ['owner', 'admin', 'staffOwned', 'staffAll', 'ownerB'] as const) {
    await db.user.create({ data: { id: ID[name], email: `${P}${name}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V84G Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V84G Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_admin`, userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' } });
  // PR195-KEY-GATES (review SEC-P195BW-3/5): member chat now holds a member to the module scope of each tool's routes
  // (calendar_list_events: GET calendar events, bookings read), so the two STAFF members whose calendar view KC-02a
  // pins hold bookings read, as the route needs; the visibility rules under test are unchanged.
  await db.membership.create({
    data: { id: `${P}m_staffOwned`, userId: ID.staffOwned, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned', bookings: 'read' } },
  });
  await db.membership.create({
    data: { id: `${P}m_staffAll`, userId: ID.staffAll, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read', bookings: 'read' } },
  });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  const contact = (id: string, businessId: string, values: typeof PRIVATE, visibility: string, ownerId: string) =>
    db.contact.create({ data: { id, businessId, ...values, lastName: 'V84G', visibility, ownerId } });
  await contact(ID.cPriv, ID.bizA, PRIVATE, 'PRIVATE', ID.owner);
  await contact(ID.cTeam, ID.bizA, TEAM, 'TEAM', ID.owner);
  await contact(ID.cMine, ID.bizA, MINE, 'TEAM', ID.staffOwned);
  await contact(ID.cShared, ID.bizA, SHARED, 'PRIVATE', ID.owner);
  await contact(ID.cOther, ID.bizB, OTHER, 'TEAM', ID.ownerB);
  await db.contactShare.create({ data: { id: `${P}share`, businessId: ID.bizA, contactId: ID.cShared, userId: ID.staffOwned, createdBy: ID.owner } });

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const event = (id: string, contactId: string | null, title: string) =>
    db.calendarEvent.create({
      data: {
        id, businessId: ID.bizA, title, type: 'BOOKING', module: 'BOOKINGS', startAt: start, endAt: new Date(start.getTime() + 30 * 60_000),
        visibility: 'TEAM', sourceType: 'test', sourceId: id, contactId,
      },
    });
  await event(ID.evPriv, ID.cPriv, `Visit ${PRIVATE.firstName}`);
  await event(ID.evTeam, ID.cTeam, `Visit ${TEAM.firstName}`);
  await event(ID.evMine, ID.cMine, `Visit ${MINE.firstName}`);
  await event(ID.evNone, null, 'Team stand-up');

  await db.service.create({ data: { id: ID.svc, businessId: ID.bizA, name: 'V84G consult', duration: 30, price: 100 } });
  const booking = (id: string, contactId: string, offsetMin: number) =>
    db.booking.create({
      data: {
        id,
        businessId: ID.bizA,
        contactId,
        serviceId: ID.svc,
        startTime: new Date(start.getTime() + offsetMin * 60_000),
        endTime: new Date(start.getTime() + (offsetMin + 30) * 60_000),
      },
    });
  await booking(ID.bkPriv, ID.cPriv, 0);
  await booking(ID.bkTeam, ID.cTeam, 60);
  await booking(ID.bkMine, ID.cMine, 120);

  const waitlist = (id: string, contactId: string) =>
    db.bookingWaitlistEntry.create({ data: { id, businessId: ID.bizA, contactId, serviceId: ID.svc } });
  await waitlist(ID.wlPriv, ID.cPriv);
  await waitlist(ID.wlTeam, ID.cTeam);
  await waitlist(ID.wlMine, ID.cMine);

  const paid = (id: string, contactId: string, n: number, total: number) =>
    db.invoice.create({
      data: { id, businessId: ID.bizA, contactId, invoiceNumber: `V84G-000${n}`, status: 'PAID', subtotal: total, total, currency: 'TTD' },
    });
  await paid(ID.invPriv, ID.cPriv, 1, 9000);
  await paid(ID.invTeam, ID.cTeam, 2, 500);
  await paid(ID.invMine, ID.cMine, 3, 300);
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
});

beforeEach(() => {
  gateway.script = null;
  gateway.toolMessages.length = 0;
});

const SEARCH = { query: 'V84G' };
const LIST = { limit: 50 };

describe('KC-01 member-chat contact reads apply the member’s CRM visibility', () => {
  it("KC-01a RED-BEFORE: crm_search_contacts for a STAFF member kept to their own book (crm_view 'owned') answers only their own and shared contacts: the owner's PRIVATE and TEAM contacts are absent, and neither the member nor the model is sent the PRIVATE contact's name, email or phone", async () => {
    const body = await chatTurn(ID.staffOwned, 'crm_search_contacts', SEARCH);
    expect(contactIds(onlyResult(body, 'crm_search_contacts'))).toEqual([ID.cMine, ID.cShared].sort());
    expectNoPrivate(body);
  });

  it("KC-01b RED-BEFORE: crm_list_contacts for the same STAFF member (crm_view 'owned') lists only their own and shared contacts", async () => {
    const body = await chatTurn(ID.staffOwned, 'crm_list_contacts', LIST);
    expect(contactIds(onlyResult(body, 'crm_list_contacts'))).toEqual([ID.cMine, ID.cShared].sort());
    expectNoPrivate(body);
  });

  it("KC-01c RED-BEFORE: crm_search_contacts for an ADMIN answers the TEAM contacts and not the owner's PRIVATE ones (nor the PRIVATE one shared with someone else)", async () => {
    const body = await chatTurn(ID.admin, 'crm_search_contacts', SEARCH);
    expect(contactIds(onlyResult(body, 'crm_search_contacts'))).toEqual([ID.cMine, ID.cTeam].sort());
    expectNoPrivate(body);
  });

  it('KC-01d RED-BEFORE: crm_list_contacts for an ADMIN lists the TEAM contacts and not the PRIVATE ones', async () => {
    const body = await chatTurn(ID.admin, 'crm_list_contacts', LIST);
    expect(contactIds(onlyResult(body, 'crm_list_contacts'))).toEqual([ID.cMine, ID.cTeam].sort());
    expectNoPrivate(body);
  });

  it('KC-01e RED-BEFORE: crm_search_contacts and crm_list_contacts for a view-all STAFF member answer the TEAM contacts and not the PRIVATE ones', async () => {
    const search = await chatTurn(ID.staffAll, 'crm_search_contacts', SEARCH);
    expect(contactIds(onlyResult(search, 'crm_search_contacts'))).toEqual([ID.cMine, ID.cTeam].sort());
    const list = await chatTurn(ID.staffAll, 'crm_list_contacts', LIST);
    expect(contactIds(onlyResult(list, 'crm_list_contacts'))).toEqual([ID.cMine, ID.cTeam].sort());
    expectNoPrivate([search, list]);
  });

  it('KC-01f RED-BEFORE: the streamed member chat (POST flow/chat/stream) applies the same clause: an ADMIN’s crm_search_contacts result has no PRIVATE contact', async () => {
    gateway.script = { name: 'crm_search_contacts', args: SEARCH };
    const res = await request(app.getHttpServer())
      .post(`${chatUrl}/stream`)
      .set('x-test-user', ID.admin)
      .set('x-forwarded-for', nextIp())
      .send({ message: 'Find V84G' })
      .buffer(true)
      .parse((r: any, cb: any) => {
        let text = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => { text += c; });
        r.on('end', () => cb(null, text));
      });
    gateway.script = null;
    const chunks = String(res.body)
      .split('\n')
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice('data: '.length)));
    const results = chunks.find((c) => c.type === 'tool_results');
    expect(results, JSON.stringify(chunks).slice(0, 400)).toBeTruthy();
    expect(results.toolResults).toHaveLength(1);
    expect(results.toolResults[0].success).toBe(true);
    expect(contactIds(results.toolResults[0].result)).toEqual([ID.cMine, ID.cTeam].sort());
    expectNoPrivate(chunks);
  });

  it("KC-01g RED-BEFORE: a contact read KEY asked the member to confirm (the business's policy auto-executes nothing) runs, once the member confirms it (POST flow/confirm), as that member: the ADMIN's list has no PRIVATE contact", async () => {
    await db.aiMemory.create({
      data: { id: `${P}autonomy`, businessId: ID.bizA, category: 'settings', key: 'autonomy', value: JSON.stringify({ mode: 'assisted', maxAutoTier: 0 }) },
    });
    try {
      const proposed = await chatTurn(ID.admin, 'crm_list_contacts', LIST);
      expect(proposed.requiresConfirmation, JSON.stringify(proposed).slice(0, 400)).toBe(true);
      const [pending] = proposed.pendingConfirmations;
      expect(pending.confirmationId).toEqual(expect.any(String));
      const res = await request(app.getHttpServer())
        .post(`/ai/businesses/${ID.bizA}/flow/confirm`)
        .set('x-test-user', ID.admin)
        .set('x-forwarded-for', nextIp())
        .send({ toolCallId: pending.toolCallId, confirmed: true, confirmationId: pending.confirmationId })
        .expect(201);
      expect(contactIds(onlyResult(res.body, 'crm_list_contacts'))).toEqual([ID.cMine, ID.cTeam].sort());
      expectNoPrivate(res.body);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`);
    }
  });
});

describe('KC-02 member-chat calendar reads apply the member’s visibility', () => {
  it("KC-02a RED-BEFORE: calendar_list_events leaves out every event on a contact the member's CRM view does not open (the contact cascade GET calendar events applies): the ADMIN and the view-all STAFF member see no event on the owner's PRIVATE contact; the member kept to their own book sees only their own contact's and the contactless event", async () => {
    const ids = (body: any) => (onlyResult(body, 'calendar_list_events').events as Array<{ id: string }>).map((e) => e.id).sort();
    const admin = await chatTurn(ID.admin, 'calendar_list_events', { limit: 50 });
    expect(ids(admin)).toEqual([ID.evMine, ID.evNone, ID.evTeam].sort());
    const staffAll = await chatTurn(ID.staffAll, 'calendar_list_events', { limit: 50 });
    expect(ids(staffAll)).toEqual([ID.evMine, ID.evNone, ID.evTeam].sort());
    const owned = await chatTurn(ID.staffOwned, 'calendar_list_events', { limit: 50 });
    expect(ids(owned)).toEqual([ID.evMine, ID.evNone].sort());
    expectNoPrivate([admin, staffAll, owned]);
  });

  it("KC-02b RED-BEFORE: bookings_list_bookings keeps every booking but names a booking's contact only when the member may open it: the ADMIN, the view-all STAFF member and the member kept to their own book get no name or email of the owner's PRIVATE contact", async () => {
    const named = (body: any) => {
      const rows = onlyResult(body, 'bookings_list_bookings').bookings as Array<{ id: string; contact: { email: string } | null }>;
      return Object.fromEntries(rows.map((b) => [b.id, b.contact?.email ?? null]));
    };
    const admin = await chatTurn(ID.admin, 'bookings_list_bookings', { limit: 50 });
    expect(named(admin)).toEqual({ [ID.bkPriv]: null, [ID.bkTeam]: TEAM.email, [ID.bkMine]: MINE.email });
    const staffAll = await chatTurn(ID.staffAll, 'bookings_list_bookings', { limit: 50 });
    expect(named(staffAll)).toEqual({ [ID.bkPriv]: null, [ID.bkTeam]: TEAM.email, [ID.bkMine]: MINE.email });
    const owned = await chatTurn(ID.staffOwned, 'bookings_list_bookings', { limit: 50 });
    expect(named(owned)).toEqual({ [ID.bkPriv]: null, [ID.bkTeam]: null, [ID.bkMine]: MINE.email });
    for (const body of [admin, staffAll, owned]) {
      expect(JSON.stringify(body)).not.toContain(PRIVATE.email);
      expect(JSON.stringify(body)).not.toContain(PRIVATE.firstName);
    }
  });

  it("KC-02c RED-BEFORE (review SEC-D7-2): a booking whose contact the member may not open carries no contactId either, and fetch_client_health refuses that contact by id exactly as it refuses an unknown one: the ADMIN, the view-all STAFF member and the member kept to their own book cannot read the owner's PRIVATE contact through the booking's id", async () => {
    const admin = await chatTurn(ID.admin, 'bookings_list_bookings', { limit: 50 });
    const rows = onlyResult(admin, 'bookings_list_bookings').bookings as Array<{ id: string; contactId: string | null }>;
    expect(Object.fromEntries(rows.map((b) => [b.id, b.contactId]))).toEqual({ [ID.bkPriv]: null, [ID.bkTeam]: ID.cTeam, [ID.bkMine]: ID.cMine });
    expectNoPrivate(admin);

    const unknown = onlyFailure(await chatTurn(ID.admin, 'fetch_client_health', { contactId: `${P}nope` }), 'fetch_client_health');
    for (const actor of [ID.admin, ID.staffAll, ID.staffOwned]) {
      gateway.toolMessages.length = 0;
      const body = await chatTurn(actor, 'fetch_client_health', { contactId: ID.cPriv });
      expect(onlyFailure(body, 'fetch_client_health')).toBe(unknown);
      for (const value of [PRIVATE.firstName, PRIVATE.email]) {
        expect(JSON.stringify(body), `${actor} answer discloses ${value}`).not.toContain(value);
        expect(gateway.toolMessages.join('\n'), `model was sent ${value}`).not.toContain(value);
      }
    }
    // A contact the member may open still answers.
    const mine = onlyResult(await chatTurn(ID.staffOwned, 'fetch_client_health', { contactId: ID.cMine }), 'fetch_client_health');
    expect(mine.contact.email).toBe(MINE.email);
    const team = onlyResult(await chatTurn(ID.admin, 'fetch_client_health', { contactId: ID.cTeam }), 'fetch_client_health');
    expect(team.contact.email).toBe(TEAM.email);
  });

  it("KC-02d RED-BEFORE (review SEC-D7-3): calendar_check_conflicts leaves out the events calendar_list_events hides: over the fixtures' window the ADMIN and the view-all STAFF member get no event on the owner's PRIVATE contact, and the member kept to their own book gets only their own contact's and the contactless event", async () => {
    const window = await db.calendarEvent.findUnique({ where: { id: ID.evPriv }, select: { startAt: true } });
    const args = {
      startAt: new Date(window.startAt.getTime() - 60 * 60_000).toISOString(),
      endAt: new Date(window.startAt.getTime() + 60 * 60_000).toISOString(),
    };
    const ids = (body: any) => (onlyResult(body, 'calendar_check_conflicts').conflicts as Array<{ id: string }>).map((e) => e.id).sort();
    const admin = await memberRuns(ID.admin, 'calendar_check_conflicts', args);
    expect(ids(admin)).toEqual([ID.evMine, ID.evNone, ID.evTeam].sort());
    const staffAll = await memberRuns(ID.staffAll, 'calendar_check_conflicts', args);
    expect(ids(staffAll)).toEqual([ID.evMine, ID.evNone, ID.evTeam].sort());
    const owned = await memberRuns(ID.staffOwned, 'calendar_check_conflicts', args);
    expect(ids(owned)).toEqual([ID.evMine, ID.evNone].sort());
    expectNoPrivate([admin, staffAll, owned]);
    // CONTROL: the OWNER's check is unchanged.
    const owner = await memberRuns(ID.owner, 'calendar_check_conflicts', args);
    expect(ids(owner)).toEqual([ID.evMine, ID.evNone, ID.evPriv, ID.evTeam].sort());
  });

  it("KC-02e RED-BEFORE (review SEC-D7-4): bookings_list_waitlist keeps every entry but names an entry's contact (relation and id) only when the member may open it; the OWNER's list is unchanged", async () => {
    const named = (body: any) => {
      const items = onlyResult(body, 'bookings_list_waitlist').items as Array<{ id: string; contactId: string | null; contact: { id: string } | null }>;
      return Object.fromEntries(items.map((e) => [e.id, [e.contactId, e.contact?.id ?? null]]));
    };
    const owned = await memberRuns(ID.staffOwned, 'bookings_list_waitlist', {});
    expect(named(owned)).toEqual({ [ID.wlPriv]: [null, null], [ID.wlTeam]: [null, null], [ID.wlMine]: [ID.cMine, ID.cMine] });
    const admin = await memberRuns(ID.admin, 'bookings_list_waitlist', {});
    expect(named(admin)).toEqual({ [ID.wlPriv]: [null, null], [ID.wlTeam]: [ID.cTeam, ID.cTeam], [ID.wlMine]: [ID.cMine, ID.cMine] });
    // Filtering on a contact the member may not open answers as an unknown contact does.
    const unknown = onlyResult(await memberRuns(ID.staffOwned, 'bookings_list_waitlist', { contactId: `${P}nope` }), 'bookings_list_waitlist');
    expect(unknown).toEqual({ items: [], total: 0 });
    const hidden = await memberRuns(ID.staffOwned, 'bookings_list_waitlist', { contactId: ID.cTeam });
    expect(onlyResult(hidden, 'bookings_list_waitlist')).toEqual(unknown);
    const adminPriv = await memberRuns(ID.admin, 'bookings_list_waitlist', { contactId: ID.cPriv });
    expect(onlyResult(adminPriv, 'bookings_list_waitlist')).toEqual(unknown);
    // (adminPriv echoes the id its own request named, so the disclosure check covers the other turns)
    expectNoPrivate([owned, admin]);
    const owner = await memberRuns(ID.owner, 'bookings_list_waitlist', {});
    expect(named(owner)).toEqual({ [ID.wlPriv]: [ID.cPriv, ID.cPriv], [ID.wlTeam]: [ID.cTeam, ID.cTeam], [ID.wlMine]: [ID.cMine, ID.cMine] });
  });
});

describe('KC-04 member-chat contact aggregates apply the member’s CRM visibility (review repairs)', () => {
  it("KC-04a RED-BEFORE (review SEC-D7-1): segment_contacts, once the member confirms it, answers only the contacts the member's CRM view opens: the member kept to their own book gets their own and shared contacts, the ADMIN the TEAM contacts; the OWNER's segment is unchanged", async () => {
    const segment = (body: any) => onlyResult(body, 'segment_contacts');
    const owned = segment(await memberRuns(ID.staffOwned, 'segment_contacts', { name: 'all' }));
    expect(contactIds(owned)).toEqual([ID.cMine, ID.cShared].sort());
    expect(owned.matchedCount).toBe(2);
    const admin = segment(await memberRuns(ID.admin, 'segment_contacts', { name: 'all' }));
    expect(contactIds(admin)).toEqual([ID.cMine, ID.cTeam].sort());
    const spenders = segment(await memberRuns(ID.admin, 'segment_contacts', { name: 'big', minSpend: 400 }));
    expect(contactIds(spenders)).toEqual([ID.cTeam]);
    expectNoPrivate([owned, admin, spenders]);
    const owner = segment(await memberRuns(ID.owner, 'segment_contacts', { name: 'all' }));
    expect(contactIds(owner)).toEqual([ID.cMine, ID.cPriv, ID.cShared, ID.cTeam].sort());
  });

  it("KC-04b RED-BEFORE (review SEC-D7-5): fetch_client_health with no contactId counts and names only the contacts the member's CRM view opens: the owner's PRIVATE top spender is neither named nor counted for the ADMIN or the member kept to their own book; the OWNER's summary is unchanged", async () => {
    const health = (body: any) => onlyResult(body, 'fetch_client_health');
    const top = (r: any) => (r.topSpenders as Array<{ contactId: string }>).map((s) => s.contactId);
    const admin = health(await chatTurn(ID.admin, 'fetch_client_health', {}));
    expect(top(admin)).toEqual([ID.cTeam, ID.cMine]);
    expect(admin.totalContacts).toBe(2);
    const owned = health(await chatTurn(ID.staffOwned, 'fetch_client_health', {}));
    expect(top(owned)).toEqual([ID.cMine]);
    expect(owned.totalContacts).toBe(2);
    expectNoPrivate([admin, owned]);
    const owner = health(await chatTurn(ID.owner, 'fetch_client_health', {}));
    expect(top(owner)).toEqual([ID.cPriv, ID.cTeam, ID.cMine]);
    expect(owner.totalContacts).toBe(4);
    expect(JSON.stringify(owner.topSpenders)).toContain(PRIVATE.firstName);
  });
});

describe('KC-03 controls (pass before and after)', () => {
  it('KC-03a CONTROL: the OWNER’s member-chat reads are unchanged: every contact of the business (and no other business’s), every event and every booking with its contact', async () => {
    const search = await chatTurn(ID.owner, 'crm_search_contacts', SEARCH);
    expect(contactIds(onlyResult(search, 'crm_search_contacts'))).toEqual([ID.cMine, ID.cPriv, ID.cShared, ID.cTeam].sort());
    const list = await chatTurn(ID.owner, 'crm_list_contacts', LIST);
    expect(contactIds(onlyResult(list, 'crm_list_contacts'))).toEqual([ID.cMine, ID.cPriv, ID.cShared, ID.cTeam].sort());
    expect(JSON.stringify(onlyResult(search, 'crm_search_contacts'))).toContain(PRIVATE.phone);
    const events = await chatTurn(ID.owner, 'calendar_list_events', { limit: 50 });
    expect((onlyResult(events, 'calendar_list_events').events as Array<{ id: string }>).map((e) => e.id).sort())
      .toEqual([ID.evMine, ID.evNone, ID.evPriv, ID.evTeam].sort());
    const bookings = await chatTurn(ID.owner, 'bookings_list_bookings', { limit: 50 });
    const byId = Object.fromEntries((onlyResult(bookings, 'bookings_list_bookings').bookings as any[]).map((b) => [b.id, b.contact?.email ?? null]));
    expect(byId).toEqual({ [ID.bkPriv]: PRIVATE.email, [ID.bkTeam]: TEAM.email, [ID.bkMine]: MINE.email });
  });

  it("KC-03b CONTROL: a staff-bridge position (an envelope JobRolePolicyService issued, no member principal: StaffChatBridgeService's call shape) answers its contact reads as before this packet; D-37 rules member chat only", async () => {
    const envelope = jobRolePolicy.envelopeForJobRole({ id: `${P}jobrole`, name: 'Front desk', permissions: { crm: 'read' } });
    expect(jobRolePolicy.isIssued(envelope)).toBe(true);
    const bridge = async (name: string, args: Record<string, unknown>) => {
      gateway.script = { name, args };
      const result = await orchestrator.chat(
        ID.bizA, `Please run ${name}`, [], undefined,
        { surface: 'staff_sms', route: '/channel/sms', hints: [] },
        undefined, undefined, undefined, undefined, { jobRoleEnvelope: envelope },
      );
      gateway.script = null;
      return result;
    };
    const search = await bridge('crm_search_contacts', SEARCH);
    expect(contactIds(onlyResult(search, 'crm_search_contacts'))).toEqual([ID.cMine, ID.cPriv, ID.cShared, ID.cTeam].sort());
    const list = await bridge('crm_list_contacts', LIST);
    expect(contactIds(onlyResult(list, 'crm_list_contacts'))).toEqual([ID.cMine, ID.cPriv, ID.cShared, ID.cTeam].sort());
  });

  it('KC-03c CONTROL: a member of another business is refused at BusinessGuard before KEY runs anything', async () => {
    const before = gateway.seq;
    gateway.script = { name: 'crm_list_contacts', args: LIST };
    await request(app.getHttpServer())
      .post(chatUrl)
      .set('x-test-user', ID.ownerB)
      .set('x-forwarded-for', nextIp())
      .send({ message: 'list contacts' })
      .expect(403);
    gateway.script = null;
    expect(gateway.seq).toBe(before); // the model was never asked
    expect(gateway.toolMessages).toEqual([]);
  });
});
