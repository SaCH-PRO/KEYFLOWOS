/**
 * V1-84 (FOLLOW3-D9-DOITFORME-SCOPE): KEY 'do'/'auto'/'draft' (POST
 * ai/businesses/:b/key/command) reads only what the caller may read, and files
 * CommandItems only for a member with operations write (owner ruling D-40),
 * against a REAL database.
 *
 * KeyCommandService.generateDoItForMe ran six reads with { businessId } only:
 * stale contacts and recent clients without the contacts list route's
 * visibilityClause, overdue invoices and sent quotes whatever the member's
 * revenue scope, pending bookings whatever their bookings scope, and open
 * contact tasks. It then filed one CommandItem per action through
 * CommandService.create ('Follow up: <contact name>', ownerType CONTACT,
 * ownerId the contact) for any member, whereas POST command/businesses/:b/items
 * requires operations write (D-40, command.controller.ts). V1-09b projected
 * only the HTTP answer (projectDoItForMe): the stored KeyCommand.executionResult
 * and the CommandItems kept the business-wide data (V1-09b review SEC-V109b-2
 * residual; R0-13g review SEC-R013g-3, ops-scope OPS-T03, key/command half).
 *
 * The rule pinned here: the caller's reads are computed before anything is read
 * (KeyCommandService.commandViewer, the rule GET key/commands projects by):
 * contacts by the contacts list route's visibilityClause; invoices and quotes
 * only with revenue read, bookings only with bookings read, contact tasks only
 * with crm read, each limited to the contacts the caller may open; an action is
 * built only when the caller reads every module it names (ACTION_READS), and an
 * amount only with revenue read. CommandItems are filed only when the caller's
 * operations level, read as ModuleScopeGuard reads it, is write or above.
 *
 * Review repairs. SEC-D9-1: an invoice, booking, quote or task is read only
 * when the contact it names is one the caller may open by the rule
 * assertContactVisible applies (this business, deletedAt null, then
 * visibilityClause), for an unrestricted caller too: no soft-deleted contact
 * and no other business's contact (a legacy row) reaches the row, the answer or
 * an item. CR-D9-1: the POST answer carries `dataWithheld` exactly as GET
 * key/commands lists the row it wrote (SEC-V109b-2): when the business has a
 * contact the caller may not open, or a module the answer summarises is one
 * the caller may not read, and not otherwise.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business, membership, contact, invoice, quote, service, booking,
 * contact task, KeyCommand and CommandItem rows, AuthGuard, BusinessGuard,
 * CrmRateLimitGuard, the global ValidationPipe, GlobalHttpExceptionFilter,
 * AiController's key/command route, KeyCommandService and CommandService are
 * real against DATABASE_URL. The stand-ins: identity attachment (a test
 * middleware loads the seeded user named by `x-v84i-user` and attaches
 * `{ id, email, role }`, as AuthMiddleware does after token verification); the
 * timeline, realtime and notification recorders behind CommandService; and the
 * AiController collaborators of routes this suite does not call (an
 * allow-listed mocker; any other missing token fails the compile).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v84i_` prefix and is
 * hard-deleted by raw SQL (sqlLikePrefix) in beforeAll and afterAll. No
 * $transaction wrapping. Cases tagged RED-BEFORE fail on the unmodified
 * service; CONTROL cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84i_';
const HEADER = 'x-v84i-user';
const ID = {
  owner: `${P}owner`, // OWNER, role defaults (visibilityClause null, operations admin)
  admin: `${P}admin`, // ADMIN, role defaults (operations admin, crm admin: view all, no other member's PRIVATE contact)
  staff: `${P}staff`, // STAFF { crm: read, crm_view: owned, revenue: none, bookings: read, operations: read }
  orphanOwner: `${P}orphanOwner`, // Business.ownerId of bizOrphan with NO membership (CR-V109b-1)
  biz: `${P}biz`,
  bizOrphan: `${P}bizOrphan`,
  cPriv: `${P}cPriv`, // PRIVATE, owned by the OWNER, stale
  cTeam: `${P}cTeam`, // TEAM, owned by the STAFF member (in their book), stale
  cOrphan: `${P}cOrphan`, // a stale TEAM contact of bizOrphan
  service: `${P}service`,
  booking: `${P}booking`, // PENDING, on cTeam
  invoice: `${P}invoice`, // overdue, on cPriv
  quote: `${P}quote`, // SENT, on cTeam
  task: `${P}task`, // OPEN, on cPriv
  // SEC-D9-1 / CR-D9-1: a second business of the OWNER, where staffTen may open every live contact.
  staffTen: `${P}staffTen`, // STAFF of bizTen { crm: read (view all), revenue: read, bookings: read, operations: write }
  bizTen: `${P}bizTen`,
  cLive: `${P}cLive`, // a stale TEAM contact of bizTen
  cDel: `${P}cDel`, // a soft-deleted TEAM contact of bizTen: an overdue invoice, a pending booking, a sent quote, an open task
  serviceTen: `${P}serviceTen`,
};
const PRIVATE_NAME = 'Priya Privatecontact';
const TEAM_NAME = 'Theo Teamcontact';
const OVERDUE_TOTAL = 987.65;
const QUOTE_TOTAL = 1357.91;
const SERVICE_PRICE = 246.8;
const TASK_TITLE = `${P}renewal paperwork`;
/** 'handle' and 'everything': follow-ups, invoice reminders, booking confirmations and review requests at once. */
const EVERYTHING = 'handle everything';
/** No intent keyword: generateDoItForMe falls back to the open contact tasks. */
const NO_INTENT = 'what needs doing today';
const LIVE_NAME = 'Vera Visiblecontact';
const DELETED_NAME = 'Dora Deletedcontact';
const ORPHAN_NAME = 'Olive Orphancontact';
const DELETED_TOTAL = 4321.09;
const DELETED_QUOTE_TOTAL = 2468.13;
const DELETED_SERVICE_PRICE = 135.79;
const FOREIGN_TOTAL = 555.44;
const DELETED_TASK = `${P}deleted contact paperwork`;
const FOREIGN_TASK = `${P}foreign contact paperwork`;

// ---- recorders behind CommandService ----------------------------------------
const recorder = {
  async recordEvent() { return undefined; },
  emit() { /* realtime */ },
  async create(n: unknown) { return n; },
};

const OFF_BOUNDARY = new Set([
  'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'BusinessGraphService', 'IntentParserService',
  'PlannerService', 'AiMemoryService', 'StrategicIntelligenceService', 'ProAutoMonitorService',
  'ProfileIntelligenceService', 'WorkspaceRecommendationsService', 'ModelGatewayService', 'AutopilotRulesService',
  'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService', 'UnifiedInboxService',
  'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService', 'CapacityInsightService',
  'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService', 'ProactiveSuggestionService',
  'WorkflowTemplateService', 'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
  // Reached only by the 'ask' mode, which this suite does not run.
  'AiOversightService',
]);

let db: any;
let app: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM command_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_commands WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Mode = 'do' | 'draft' | 'auto';

/**
 * POSTs key/command and returns the response, the KeyCommand row it wrote and
 * the CommandItems filed for that row. Each case sends its own rawInput (the
 * intent words plus a tag no intent matches), so its row is found by it.
 */
async function run(actor: string, intent: string, tag: string, mode: Mode, businessId = ID.biz) {
  const rawInput = `${intent} [${tag}]`;
  const res = await request(app.getHttpServer())
    .post(`/ai/businesses/${businessId}/key/command`)
    .set(HEADER, actor)
    .send({ rawInput, mode });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = await db.keyCommand.findFirst({ where: { businessId, userId: actor, rawInput }, orderBy: { createdAt: 'desc' } });
  expect(row, `KeyCommand row for ${rawInput}`).toBeTruthy();
  const items = await db.commandItem.findMany({ where: { businessId, sourceId: row.id }, orderBy: { title: 'asc' } });
  return { body: res.body, row, stored: row.executionResult as any, items: items as any[] };
}

const pairs = (actions: any[]) => (actions ?? []).map((a) => `${a.actionType}:${a.contactId}`).sort();

/** The row GET key/commands lists `actor` for the KeyCommand `rowId`. */
async function listedRow(actor: string, rowId: string, businessId = ID.biz) {
  const res = await request(app.getHttpServer()).get(`/ai/businesses/${businessId}/key/commands`).set(HEADER, actor);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const row = (res.body as any[]).find((r) => r.id === rowId);
  expect(row, `GET key/commands lists ${rowId}`).toBeTruthy();
  return row;
}

/** Nothing of bizTen's soft-deleted contact, nor of the other business's contact its legacy rows name. */
function expectNoClosedContact(value: unknown, label: string) {
  const text = JSON.stringify(value);
  for (const needle of [
    ID.cDel, DELETED_NAME, String(DELETED_TOTAL), String(DELETED_QUOTE_TOTAL), String(DELETED_SERVICE_PRICE), DELETED_TASK,
    ID.cOrphan, ORPHAN_NAME, String(FOREIGN_TOTAL), FOREIGN_TASK,
  ]) {
    expect(text, `${label}: ${needle}`).not.toContain(needle);
  }
}

/** No PRIVATE contact id or name, and no invoice or quote figure. */
function expectNoPrivateNoMoney(value: unknown, label: string) {
  const text = JSON.stringify(value);
  expect(text, label).not.toContain(ID.cPriv);
  expect(text, label).not.toContain(PRIVATE_NAME);
  expect(text, label).not.toContain(String(OVERDUE_TOTAL));
  expect(text, label).not.toContain(String(QUOTE_TOTAL));
  expect(text, label).not.toMatch(/overdue invoice|sent quote/);
}

beforeAll(async () => {
  db = (await import('@keyflow/db')).db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { KeyCommandService } = await import('../src/modules/ai/key-command.service');
  const { CommandService } = await import('../src/modules/command/command.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useValue: recorder },
      {
        provide: CommandService,
        useFactory: (prisma: any) => new CommandService(prisma, recorder as any, recorder as any, recorder as any),
        inject: [PrismaService],
      },
      {
        provide: KeyCommandService,
        // No 'ask' runs here: the registries, oversight and the kill switch are not reached.
        useFactory: (prisma: any, commands: any) =>
          new KeyCommandService(prisma, recorder as any, undefined, commands, undefined, undefined, undefined),
        inject: [PrismaService, CommandService],
      },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v84i_ users. No guard is overridden.
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

  for (const name of ['owner', 'admin', 'staff', 'orphanOwner'] as const) {
    await db.user.create({ data: { id: ID[name], email: `${P}${name}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V84I biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_admin`, userId: ID.admin, businessId: ID.biz, role: 'ADMIN' } });
  await db.membership.create({
    data: {
      id: `${P}m_staff`, userId: ID.staff, businessId: ID.biz, role: 'STAFF',
      permissionScopes: { crm: 'read', crm_view: 'owned', revenue: 'none', bookings: 'read', operations: 'read' },
    },
  });
  // CR-V109b-1: ownerId set and no membership row, as legacy businesses were created.
  await db.business.create({ data: { id: ID.bizOrphan, name: 'V84I orphan', ownerId: ID.orphanOwner, currency: 'TTD' } });

  const stale = new Date(Date.now() - 60 * 86400000);
  // The PRIVATE contact is the stalest, so it is the first follow-up (the order is lastInteractionAt asc).
  const stalest = new Date(Date.now() - 70 * 86400000);
  const [privFirst, privLast] = PRIVATE_NAME.split(' ');
  const [teamFirst, teamLast] = TEAM_NAME.split(' ');
  await db.contact.create({
    data: {
      id: ID.cPriv, businessId: ID.biz, firstName: privFirst, lastName: privLast, email: `${P}priya@test.local`,
      visibility: 'PRIVATE', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stalest,
    },
  });
  await db.contact.create({
    data: {
      id: ID.cTeam, businessId: ID.biz, firstName: teamFirst, lastName: teamLast, email: `${P}theo@test.local`,
      visibility: 'TEAM', ownerId: ID.staff, status: 'ACTIVE', lastInteractionAt: stale,
    },
  });
  await db.contact.create({
    data: {
      id: ID.cOrphan, businessId: ID.bizOrphan, firstName: 'Olive', lastName: 'Orphancontact', email: `${P}olive@test.local`,
      visibility: 'TEAM', ownerId: ID.orphanOwner, status: 'ACTIVE', lastInteractionAt: stale,
    },
  });
  await db.invoice.create({
    data: {
      id: ID.invoice, businessId: ID.biz, contactId: ID.cPriv, invoiceNumber: `${P}INV-1`,
      status: 'SENT', subtotal: OVERDUE_TOTAL, total: OVERDUE_TOTAL, currency: 'TTD', dueDate: stale,
    },
  });
  await db.quote.create({
    data: {
      id: ID.quote, businessId: ID.biz, contactId: ID.cTeam, quoteNumber: `${P}Q-1`,
      status: 'SENT', subtotal: QUOTE_TOTAL, total: QUOTE_TOTAL, currency: 'TTD',
    },
  });
  await db.service.create({ data: { id: ID.service, businessId: ID.biz, name: `${P}Consultation`, duration: 60, price: SERVICE_PRICE } });
  const start = new Date(Date.now() + 3 * 86400000);
  await db.booking.create({
    data: {
      id: ID.booking, businessId: ID.biz, contactId: ID.cTeam, serviceId: ID.service,
      status: 'PENDING', startTime: start, endTime: new Date(start.getTime() + 3600000),
    },
  });
  await db.contactTask.create({ data: { id: ID.task, businessId: ID.biz, contactId: ID.cPriv, title: TASK_TITLE, status: 'OPEN' } });

  // ---- SEC-D9-1 / CR-D9-1: bizTen ---------------------------------------------
  await db.user.create({ data: { id: ID.staffTen, email: `${P}staffTen@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizTen, name: 'V84I tenant', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_ownerTen`, userId: ID.owner, businessId: ID.bizTen, role: 'OWNER' } });
  await db.membership.create({
    data: {
      id: `${P}m_staffTen`, userId: ID.staffTen, businessId: ID.bizTen, role: 'STAFF',
      permissionScopes: { crm: 'read', revenue: 'read', bookings: 'read', operations: 'write' },
    },
  });
  const [liveFirst, liveLast] = LIVE_NAME.split(' ');
  const [delFirst, delLast] = DELETED_NAME.split(' ');
  await db.contact.create({
    data: {
      id: ID.cLive, businessId: ID.bizTen, firstName: liveFirst, lastName: liveLast, email: `${P}vera@test.local`,
      visibility: 'TEAM', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stale,
    },
  });
  await db.contact.create({
    data: {
      id: ID.cDel, businessId: ID.bizTen, firstName: delFirst, lastName: delLast, email: `${P}dora@test.local`,
      visibility: 'TEAM', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stalest, deletedAt: new Date(),
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}invDel`, businessId: ID.bizTen, contactId: ID.cDel, invoiceNumber: `${P}INV-DEL`,
      status: 'SENT', subtotal: DELETED_TOTAL, total: DELETED_TOTAL, currency: 'TTD', dueDate: stale,
    },
  });
  await db.quote.create({
    data: {
      id: `${P}quoteDel`, businessId: ID.bizTen, contactId: ID.cDel, quoteNumber: `${P}Q-DEL`,
      status: 'SENT', subtotal: DELETED_QUOTE_TOTAL, total: DELETED_QUOTE_TOTAL, currency: 'TTD',
    },
  });
  await db.service.create({
    data: { id: ID.serviceTen, businessId: ID.bizTen, name: `${P}Fitting`, duration: 60, price: DELETED_SERVICE_PRICE },
  });
  await db.booking.create({
    data: {
      id: `${P}bookingDel`, businessId: ID.bizTen, contactId: ID.cDel, serviceId: ID.serviceTen,
      status: 'PENDING', startTime: start, endTime: new Date(start.getTime() + 3600000),
    },
  });
  await db.contactTask.create({ data: { id: `${P}taskDel`, businessId: ID.bizTen, contactId: ID.cDel, title: DELETED_TASK, status: 'OPEN' } });
  // Legacy rows: an invoice and a task of bizTen naming bizOrphan's contact (raw SQL, as a writer
  // before the contact tenancy checks could leave them).
  await db.$executeRawUnsafe(
    `INSERT INTO invoices (id, business_id, contact_id, invoice_number, status, subtotal, total, currency, due_date, created_at, updated_at)
     VALUES ('${P}invForeign', '${ID.bizTen}', '${ID.cOrphan}', '${P}INV-FOREIGN', 'SENT', ${FOREIGN_TOTAL}, ${FOREIGN_TOTAL}, 'TTD', now() - interval '61 days', now(), now())`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO contact_tasks (id, business_id, contact_id, title, status)
     VALUES ('${P}taskForeign', '${ID.bizTen}', '${ID.cOrphan}', '${FOREIGN_TASK}', 'OPEN')`,
  );
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('DF-01 a STAFF member with operations read and crm view owned (D-40, SEC-V109b-2 residual)', () => {
  it("RED-BEFORE: 'do' files no CommandItem for that member (operations read is below write)", async () => {
    const { items } = await run(ID.staff, EVERYTHING, 'df01-items', 'do');

    // Before: one item per action, one of them 'Follow up: <the OWNER's PRIVATE contact>'.
    expect(items.map((i) => i.title)).toEqual([]);
  });

  it("RED-BEFORE: the stored executionResult and the response hold no PRIVATE contact id or name and no invoice or quote figure", async () => {
    const { body, stored } = await run(ID.staff, EVERYTHING, 'df01-row', 'do');

    // Before: the row named the PRIVATE contact and carried the overdue invoice total.
    expectNoPrivateNoMoney(stored, 'stored executionResult');
    expectNoPrivateNoMoney(body, 'response');
    // What the member may read is still answered: their own contact's follow-up and booking.
    expect(pairs(stored.actions)).toEqual([`booking_confirm:${ID.cTeam}`, `follow_up:${ID.cTeam}`]);
    expect(pairs(body.actions)).toEqual(pairs(stored.actions));
    expect(body).toMatchObject({ dataWithheld: true, commandItemIds: [] });
  });

  it('RED-BEFORE: no amount at all reaches the row of a member without revenue read (the booking carries no service price)', async () => {
    const { stored } = await run(ID.staff, EVERYTHING, 'df01-amount', 'do');

    expect(stored.actions.length).toBeGreaterThan(0);
    expect(stored.actions.every((a: any) => a.expectedValue === undefined)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(String(SERVICE_PRICE));
  });

  it("RED-BEFORE: the open-task fallback names no contact the member cannot open and files nothing", async () => {
    const { body, stored, items } = await run(ID.staff, NO_INTENT, 'df01-tasks', 'do');

    // Before: 'Open task: <title>' for the PRIVATE contact, and a 'Handle: <PRIVATE name>' item.
    expect(stored.actions).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain(TASK_TITLE);
    expectNoPrivateNoMoney(stored, 'stored executionResult');
    expectNoPrivateNoMoney(body, 'response');
    expect(items).toEqual([]);
  });

  it("RED-BEFORE: 'auto' (the 'do' branch) is scoped the same way", async () => {
    const { body, stored, items } = await run(ID.staff, EVERYTHING, 'df01-auto', 'auto');

    expectNoPrivateNoMoney(stored, 'stored executionResult');
    expectNoPrivateNoMoney(body, 'response');
    expect(items).toEqual([]);
  });
});

describe('DF-02 an ADMIN (operations admin, crm view all) files items only for contacts it can open', () => {
  it("RED-BEFORE: 'do' files the TEAM contact's items and none for the OWNER's PRIVATE contact", async () => {
    const { body, stored, items } = await run(ID.admin, EVERYTHING, 'df02', 'do');

    // Before: a follow-up and an invoice reminder for the PRIVATE contact were filed as well.
    expect(items.map((i) => `${i.title}|${i.ownerType}:${i.ownerId}`)).toEqual([
      `Confirm: ${TEAM_NAME}|CONTACT:${ID.cTeam}`,
      `Follow up: ${TEAM_NAME}|CONTACT:${ID.cTeam}`,
    ]);
    expect(pairs(stored.actions)).toEqual([`booking_confirm:${ID.cTeam}`, `follow_up:${ID.cTeam}`]);
    expect(stored.commandItemIds.slice().sort()).toEqual(items.map((i) => i.id).sort());
    const text = JSON.stringify({ body, stored, items });
    expect(text).not.toContain(ID.cPriv);
    expect(text).not.toContain(PRIVATE_NAME);
    expect(text).not.toContain(String(OVERDUE_TOTAL));
    // Revenue admin: the quote on a contact it can open is a finding, and the booking keeps its price.
    expect(stored.findings.join(' ')).toContain('1 sent quote');
    expect(stored.actions.find((a: any) => a.actionType === 'booking_confirm').expectedValue).toBe(SERVICE_PRICE);
  });
});

describe('DF-03 draft mode applies the same scoped reads', () => {
  it("RED-BEFORE: the STAFF member's drafts, stored row and items hold no PRIVATE contact and no invoice or quote figure", async () => {
    const { body, stored, items } = await run(ID.staff, EVERYTHING, 'df03-staff', 'draft');

    expect(body.mode).toBe('draft');
    expect(stored.mode).toBe('draft');
    expectNoPrivateNoMoney(stored, 'stored executionResult');
    expectNoPrivateNoMoney(body, 'response');
    expect(pairs(body.drafts)).toEqual([`booking_confirm:${ID.cTeam}`, `follow_up:${ID.cTeam}`]);
    expect(items).toEqual([]);
  });

  it("RED-BEFORE: the ADMIN's drafts and items name only the contacts it can open", async () => {
    const { body, stored, items } = await run(ID.admin, EVERYTHING, 'df03-admin', 'draft');

    expect(pairs(stored.actions)).toEqual([`booking_confirm:${ID.cTeam}`, `follow_up:${ID.cTeam}`]);
    expect(pairs(body.drafts)).toEqual(pairs(stored.actions));
    expect(items.map((i) => i.ownerId)).toEqual([ID.cTeam, ID.cTeam]);
    expect(JSON.stringify({ body, stored, items })).not.toContain(PRIVATE_NAME);
  });
});

describe('DF-04 CONTROL: the OWNER gets the same actions and items as before', () => {
  it("'do': every action, finding, amount and item", async () => {
    const { body, stored, items } = await run(ID.owner, EVERYTHING, 'df04', 'do');

    expect(pairs(stored.actions)).toEqual([
      `booking_confirm:${ID.cTeam}`,
      `follow_up:${ID.cPriv}`,
      `follow_up:${ID.cTeam}`,
      `invoice_reminder:${ID.cPriv}`,
    ]);
    // One item per action type: CommandItem is unique on (businessId, sourceModule, sourceType,
    // sourceId, actionType) and sourceId is the KeyCommand, so the second follow-up's create is
    // refused and logged, as it always was. The first follow-up is the stalest contact's.
    expect(items.map((i) => `${i.title}|${i.ownerId}`)).toEqual([
      `Collect: ${PRIVATE_NAME}|${ID.cPriv}`,
      `Confirm: ${TEAM_NAME}|${ID.cTeam}`,
      `Follow up: ${PRIVATE_NAME}|${ID.cPriv}`,
    ]);
    expect(stored.commandItemIds.slice().sort()).toEqual(items.map((i) => i.id).sort());
    const findings = stored.findings.join(' | ');
    expect(findings).toContain('2 contacts');
    expect(findings).toContain('1 overdue invoice totaling');
    expect(findings).toContain(String(OVERDUE_TOTAL));
    expect(findings).toContain('1 booking');
    expect(findings).toContain('1 sent quote');
    expect(findings).toContain('1 open task');
    expect(stored.actions.find((a: any) => a.actionType === 'invoice_reminder').expectedValue).toBe(OVERDUE_TOTAL);
    expect(body).not.toHaveProperty('dataWithheld');
    expect(pairs(body.actions)).toEqual(pairs(stored.actions));
    expect(body.findings).toEqual(stored.findings);
  });

  it("the open-task fallback names the PRIVATE contact's task and files its item", async () => {
    const { stored, items } = await run(ID.owner, NO_INTENT, 'df04-tasks', 'do');

    expect(pairs(stored.actions)).toEqual([`custom:${ID.cPriv}`]);
    expect(stored.actions[0].reason).toBe(`Open task: ${TASK_TITLE}`);
    expect(items.map((i) => i.title)).toEqual([`Handle: ${PRIVATE_NAME}`]);
  });
});

describe('DF-05 the D-40 rule is the one ModuleScopeGuard applies to POST command items', () => {
  it("RED-BEFORE: a business owner without a membership (BusinessGuard admits, ModuleScopeGuard refuses) gets the unprojected answer and no item", async () => {
    const { body, stored, items } = await run(ID.orphanOwner, EVERYTHING, 'df05', 'do', ID.bizOrphan);

    expect(pairs(stored.actions)).toEqual([`follow_up:${ID.cOrphan}`]);
    expect(body).not.toHaveProperty('dataWithheld');
    expect(items).toEqual([]);
    expect(stored.commandItemIds).toEqual([]);
  });
});

describe('SEC-D9-1 an invoice, booking, quote or task is read only when its contact is one the caller may open (this business, not deleted, visible)', () => {
  it("RED-BEFORE: a member's invoice reminders name no soft-deleted contact and no other business's contact, in the row, the answer or an item", async () => {
    const { body, row, stored, items } = await run(ID.staffTen, 'remind invoice payment', 'sec1-staff', 'do', ID.bizTen);

    // Before: 'Collect: Olive Orphancontact' (ownerId the other business's contact, 555.44) was filed in
    // bizTen, and the row named both contacts with their totals, while the answer withheld them.
    expectNoClosedContact(stored, 'stored executionResult');
    expectNoClosedContact(body, 'response');
    expectNoClosedContact(items, 'command items');
    expect(stored.actions).toEqual([]);
    expect(items).toEqual([]);
    expect(body.actions).toEqual((await listedRow(ID.staffTen, row.id, ID.bizTen)).executionResult.actions);
  });

  it("RED-BEFORE: the OWNER (visibilityClause null) is held to this business's live contacts as well", async () => {
    const { body, stored, items } = await run(ID.owner, 'remind invoice payment', 'sec1-owner', 'do', ID.bizTen);

    // Before: the OWNER's answer itself listed 'Olive Orphancontact' and the deleted contact.
    expectNoClosedContact(stored, 'stored executionResult');
    expectNoClosedContact(body, 'response');
    expectNoClosedContact(items, 'command items');
    expect(stored.actions).toEqual([]);
    expect(items).toEqual([]);
  });

  it("RED-BEFORE: 'handle everything': the deleted contact's booking, quote and invoice and the legacy invoice are neither actions, findings nor items", async () => {
    const { body, stored, items } = await run(ID.owner, EVERYTHING, 'sec1-all', 'do', ID.bizTen);

    expectNoClosedContact({ body, stored, items }, 'handle everything');
    expect(pairs(stored.actions)).toEqual([`follow_up:${ID.cLive}`]);
    expect(stored.findings).toEqual(["1 contact haven't been reached in 2+ weeks"]);
    expect(items.map((i) => `${i.title}|${i.ownerType}:${i.ownerId}`)).toEqual([`Follow up: ${LIVE_NAME}|CONTACT:${ID.cLive}`]);
    expect(body.findings).toEqual(stored.findings);
  });

  it("RED-BEFORE: the open-task fallback names no task of a deleted or another business's contact", async () => {
    const { body, stored, items } = await run(ID.owner, NO_INTENT, 'sec1-tasks', 'do', ID.bizTen);

    expectNoClosedContact({ body, stored, items }, 'open-task fallback');
    expect(stored.actions).toEqual([]);
    expect(stored.findings).toEqual(["1 contact haven't been reached in 2+ weeks"]);
    expect(items).toEqual([]);
  });

  it("RED-BEFORE: 'draft' reads by the same rule", async () => {
    const { body, stored, items } = await run(ID.staffTen, EVERYTHING, 'sec1-draft', 'draft', ID.bizTen);

    expectNoClosedContact({ body, stored, items }, 'draft');
    expect(pairs(body.drafts)).toEqual([`follow_up:${ID.cLive}`]);
    expect(pairs(stored.actions)).toEqual(pairs(body.drafts));
  });
});

describe('CR-D9-1 the answer carries dataWithheld exactly as GET key/commands lists the row it wrote (SEC-V109b-2)', () => {
  it("RED-BEFORE: an ADMIN's 'do' where the OWNER's PRIVATE contact is not theirs to open: withheld in the answer and in the listed row", async () => {
    const { body, row } = await run(ID.admin, EVERYTHING, 'cr1-admin', 'do');
    const listed = await listedRow(ID.admin, row.id);

    // Before: the answer said dataWithheld and the row GET listed did not (the controller drops the flag).
    expect(body.dataWithheld).toBe(true);
    expect(listed.executionResult.dataWithheld).toBe(true);
    expect(body.actions).toEqual(listed.executionResult.actions);
    expect(body.findings).toEqual(listed.executionResult.findings);
  });

  it("RED-BEFORE: a member who may open every live contact and read every module summarised: no dataWithheld in the answer or the listed row ('do')", async () => {
    const { body, row } = await run(ID.staffTen, 'follow up', 'cr1-do', 'do', ID.bizTen);
    const listed = await listedRow(ID.staffTen, row.id, ID.bizTen);

    // Before: every non-OWNER answer said dataWithheld, whether or not anything was.
    expect(pairs(body.actions)).toEqual([`follow_up:${ID.cLive}`]);
    expect(body).not.toHaveProperty('dataWithheld');
    expect(listed.executionResult).not.toHaveProperty('dataWithheld');
    expect(body.actions).toEqual(listed.executionResult.actions);
    expect(body.findings).toEqual(listed.executionResult.findings);
  });

  it("RED-BEFORE: the same for 'draft'", async () => {
    const { body, row } = await run(ID.staffTen, 'follow up', 'cr1-draft', 'draft', ID.bizTen);
    const listed = await listedRow(ID.staffTen, row.id, ID.bizTen);

    expect(pairs(body.drafts)).toEqual([`follow_up:${ID.cLive}`]);
    expect(body).not.toHaveProperty('dataWithheld');
    expect(listed.executionResult).not.toHaveProperty('dataWithheld');
    expect(body.drafts).toEqual(listed.executionResult.actions);
  });

  it('CONTROL: a member without revenue read: withheld in both (the findings are)', async () => {
    const { body, row } = await run(ID.staff, EVERYTHING, 'cr1-staff', 'do');
    const listed = await listedRow(ID.staff, row.id);

    expect(body.dataWithheld).toBe(true);
    expect(listed.executionResult.dataWithheld).toBe(true);
    expect(body).not.toHaveProperty('findings');
    expect(listed.executionResult).not.toHaveProperty('findings');
  });
});
