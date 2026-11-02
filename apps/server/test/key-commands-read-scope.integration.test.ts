/**
 * V1-09b-KEY-COMMANDS-READ-SCOPE (REAL database, through HTTP).
 *
 * GET /ai/businesses/:businessId/key/commands, on the real AiController with
 * its real AuthGuard, BusinessGuard and CrmRateLimitGuard, over KeyCommand rows
 * that the real POST /ai/businesses/:businessId/key/command pipeline wrote
 * (KeyCommandService.groundIntent and generateDoItForMe against real contacts
 * and invoices), plus rows in the shapes KEY Cortex (completeTurn) and the
 * pre-V1-09 'ask' executor wrote, which no route of this controller writes and
 * which are therefore seeded directly. The only stand-ins are identity
 * attachment (a test middleware reads `x-v09b-user` and attaches the seeded
 * user row, as the Supabase-verifying AuthMiddleware would) and the
 * collaborators AiController holds for routes this suite does not call (an
 * allow-listed mocker; any other missing token fails the compile).
 * CommandService is a stand-in whose create() throws, so 'do' files no
 * CommandItem (generateDoItForMe catches and logs it).
 *
 *   SEC-V109-1 (V1-09 review) RED-BEFORE: GET key/commands returned every
 *   member's KeyCommand rows to any member, including groundedData.totalRevenue
 *   and the contact names of 'do'/'draft' rows.
 *
 *   GREEN-AFTER, the rule this suite pins (the safer of the packet's options):
 *   - rows: a member sees only the rows they created; an OWNER or ADMIN (and
 *     SUPER_ADMIN, as ModuleScopeGuard passes it) sees every row of the
 *     business;
 *   - data: every caller, OWNER and ADMIN included, gets each row's data only
 *     as far as their own module scopes and contact visibility allow (revenue
 *     read for revenue figures, crm read plus the contacts list route's
 *     visibility clause for contact names, bookings read for bookings);
 *     free text KEY cannot classify (a Cortex responseText, executionLogs) is
 *     kept only for a caller with no restriction to apply;
 *   - another business's rows never appear.
 *
 * Every seeded row id starts with `v09b_` and is hard-deleted in beforeAll and
 * afterAll, matched through sqlLikePrefix() from test/helpers/sql-like.js.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v09b_';
const HEADER = 'x-v09b-user';
const ID = {
  owner: `${P}owner`,               // OWNER of biz and of bizOther
  admin: `${P}admin`,               // ADMIN of biz, no scope map: role defaults (admin everywhere but team)
  adminNoMoney: `${P}adminNoMoney`, // ADMIN of biz, explicit map with revenue none
  staffRead: `${P}staffRead`,       // STAFF of biz, no scope map: role defaults (crm/revenue/bookings read)
  staffNone: `${P}staffNone`,       // STAFF of biz, explicit map { crm: none, revenue: none, bookings: none }
  biz: `${P}biz`,
  bizOther: `${P}bizOther`,
  cTeam: `${P}cTeam`,               // TEAM contact, owned by the owner, stale
  cPrivate: `${P}cPrivate`,         // PRIVATE contact, owned by the owner, stale
  cortexOwner: `${P}cortexOwner`,   // a KEY Cortex turn row the owner ran
  cortexStaff: `${P}cortexStaff`,   // a KEY Cortex turn row staffNone ran
  legacyAsk: `${P}legacyAsk`,       // a pre-V1-09 'ask' row staffRead ran, outputs with data and no tool
};
const TEAM_NAME = 'Zephyrine';
const PRIVATE_NAME = 'Quillon';
const PRIVATE_EMAIL = `${P}quillon@test.local`;
const PAID_TOTAL = 4321.77;   // the one PAID invoice: groundIntent's totalRevenue
const OVERDUE_TOTAL = 987.65; // the one overdue invoice: a 'do' finding and invoice_reminder action
const OTHER_MARKER = `${P}other business marker`;

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

/** The ids of the rows the real POST pipeline wrote, by who wrote them. */
const ROW = {
  ownerDo: '',       // owner, mode 'do': follow up and chase invoices (names, overdue total)
  ownerPlan: '',     // owner, mode 'plan': revenue (groundedData.totalRevenue)
  staffNonePlan: '', // staffNone, mode 'plan': revenue (its own row is grounded business-wide too)
  staffNoneDo: '',   // staffNone, mode 'do': follow up (its own row names contacts)
  staffReadDo: '',   // staffRead, mode 'do': follow up (TEAM and PRIVATE contact names)
  otherPlan: '',     // owner, in bizOther
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_commands WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best effort */ }
  }
}

async function command(actor: string, rawInput: string, mode: 'do' | 'plan', businessId = ID.biz): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/ai/businesses/${businessId}/key/command`)
    .set(HEADER, actor)
    .send({ rawInput, mode });
  if (res.status !== 201) throw new Error(`POST key/command ${actor} ${mode}: ${res.status} ${JSON.stringify(res.body)}`);
  const row = await db.keyCommand.findFirst({ where: { businessId, userId: actor, rawInput }, orderBy: { createdAt: 'desc' } });
  return row.id;
}

function list(actor: string, businessId = ID.biz) {
  return request(app.getHttpServer()).get(`/ai/businesses/${businessId}/key/commands`).set(HEADER, actor);
}

async function listed(actor: string, businessId = ID.biz): Promise<any[]> {
  const res = await list(actor, businessId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  return res.body;
}

const ids = (rows: any[]) => rows.map((r) => r.id).sort();
const byId = (rows: any[], id: string) => rows.find((r) => r.id === id);

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

  // create() throws: 'do' files no CommandItem; generateDoItForMe catches and logs it.
  const commandItems = { create: async () => { throw new Error('CommandService is off this boundary'); } };

  const moduleRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useFactory: (prisma: any) => new TimelineService(prisma), inject: [PrismaService] },
      {
        provide: KeyCommandService,
        // No 'ask' runs here: the registries, oversight and the kill switch are not reached.
        useFactory: (prisma: any, timeline: any) =>
          new KeyCommandService(prisma, timeline, undefined, commandItems as any, undefined, undefined, undefined),
        inject: [PrismaService, TimelineService],
      },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v09b_ users. No guard is overridden.
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

  for (const name of ['owner', 'admin', 'adminNoMoney', 'staffRead', 'staffNone'] as const) {
    await db.user.create({ data: { id: ID[name], email: `${P}${name}@test.local`, role: 'USER' } });
  }
  for (const id of [ID.biz, ID.bizOther]) {
    await db.business.create({ data: { id, name: `V09B ${id}`, ownerId: ID.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${id}_m_owner`, userId: ID.owner, businessId: id, role: 'OWNER' } });
  }
  await db.membership.create({ data: { id: `${P}m_admin`, userId: ID.admin, businessId: ID.biz, role: 'ADMIN' } });
  await db.membership.create({
    data: {
      id: `${P}m_adminNoMoney`, userId: ID.adminNoMoney, businessId: ID.biz, role: 'ADMIN',
      permissionScopes: { crm: 'admin', revenue: 'none', bookings: 'admin' },
    },
  });
  await db.membership.create({ data: { id: `${P}m_staffRead`, userId: ID.staffRead, businessId: ID.biz, role: 'STAFF' } });
  await db.membership.create({
    data: {
      id: `${P}m_staffNone`, userId: ID.staffNone, businessId: ID.biz, role: 'STAFF',
      permissionScopes: { crm: 'none', revenue: 'none', bookings: 'none' },
    },
  });

  const stale = new Date(Date.now() - 60 * 86400000);
  await db.contact.create({
    data: {
      id: ID.cTeam, businessId: ID.biz, firstName: TEAM_NAME, lastName: 'Teamly', email: `${P}zephyrine@test.local`,
      visibility: 'TEAM', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stale,
    },
  });
  await db.contact.create({
    data: {
      id: ID.cPrivate, businessId: ID.biz, firstName: PRIVATE_NAME, lastName: 'Privett', email: PRIVATE_EMAIL,
      visibility: 'PRIVATE', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stale,
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}invPaid`, businessId: ID.biz, contactId: ID.cTeam, invoiceNumber: `${P}INV-1`,
      status: 'PAID', subtotal: PAID_TOTAL, total: PAID_TOTAL, currency: 'TTD', paidAt: stale,
    },
  });
  await db.invoice.create({
    data: {
      id: `${P}invOverdue`, businessId: ID.biz, contactId: ID.cPrivate, invoiceNumber: `${P}INV-2`,
      status: 'SENT', subtotal: OVERDUE_TOTAL, total: OVERDUE_TOTAL, currency: 'TTD', dueDate: stale,
    },
  });

  // Rows written by the real POST key/command pipeline.
  ROW.ownerDo = await command(ID.owner, 'follow up with everyone and chase every overdue invoice', 'do');
  ROW.ownerPlan = await command(ID.owner, 'how much revenue did we make', 'plan');
  ROW.staffNonePlan = await command(ID.staffNone, 'how much revenue did we make this year', 'plan');
  ROW.staffNoneDo = await command(ID.staffNone, 'who should I follow up with', 'do');
  ROW.staffReadDo = await command(ID.staffRead, 'follow up with my stale leads', 'do');
  ROW.otherPlan = await command(ID.owner, OTHER_MARKER, 'plan', ID.bizOther);

  // Rows in shapes no route of this controller writes. KeyCortexLifecycleService.completeTurn:
  const cortexResult = {
    success: true,
    responseText: `Revenue is ${PAID_TOTAL}; ${PRIVATE_NAME} Privett owes ${OVERDUE_TOTAL}.`,
    actionsExecuted: 1,
    actionsFailed: 0,
    autonomyApproved: 0,
  };
  const cortexLogs = [{ step: 'tool', output: `${PRIVATE_NAME} Privett ${PRIVATE_EMAIL}` }];
  for (const [id, userId] of [[ID.cortexOwner, ID.owner], [ID.cortexStaff, ID.staffNone]] as const) {
    await db.keyCommand.create({
      data: {
        id, businessId: ID.biz, userId, rawInput: 'cortex turn', mode: 'do', status: 'EXECUTED',
        executionResult: cortexResult, executionLogs: cortexLogs,
      },
    });
  }
  // The pre-V1-09 'ask' executor kept each output's data, with no tool name.
  await db.keyCommand.create({
    data: {
      id: ID.legacyAsk, businessId: ID.biz, userId: ID.staffRead, rawInput: 'follow up', mode: 'ask', status: 'EXECUTED',
      executionResult: {
        success: true,
        outputs: [{ success: true, data: { contacts: [{ id: ID.cPrivate, firstName: PRIVATE_NAME, email: PRIVATE_EMAIL }], count: 1 } }],
      },
    },
  });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (the leak source is real: the rows hold the data)', () => {
  it("the owner's 'do' row names both contacts and the overdue total; every 'plan' row holds the business's paid revenue", async () => {
    const doRow = await db.keyCommand.findUnique({ where: { id: ROW.ownerDo } });
    const persisted = JSON.stringify(doRow.executionResult);
    expect(persisted).toContain(TEAM_NAME);
    expect(persisted).toContain(PRIVATE_NAME);
    expect(persisted).toContain(String(OVERDUE_TOTAL));
    expect(doRow.executionResult.actions.map((a: any) => a.actionType)).toEqual(
      expect.arrayContaining(['follow_up', 'invoice_reminder']),
    );

    for (const id of [ROW.ownerPlan, ROW.staffNonePlan]) {
      const plan = await db.keyCommand.findUnique({ where: { id } });
      expect(plan.groundedData.totalRevenue, id).toBe(PAID_TOTAL);
    }
    // staffNone's own 'do' row was grounded business-wide too: it names contacts.
    const staffDo = await db.keyCommand.findUnique({ where: { id: ROW.staffNoneDo } });
    expect(JSON.stringify(staffDo.executionResult)).toContain(TEAM_NAME);
  });
});

describe('SEC-V109-1 rows: a member sees only the rows they created', () => {
  it('a STAFF member (crm/revenue none) lists only its own rows, never the owner\'s or another member\'s', async () => {
    const rows = await listed(ID.staffNone);

    expect(ids(rows)).toEqual([ROW.staffNoneDo, ROW.staffNonePlan, ID.cortexStaff].sort());
    expect(JSON.stringify(rows)).not.toContain('chase every overdue invoice');
  });

  it('a STAFF member with role-default scopes lists only its own rows', async () => {
    const rows = await listed(ID.staffRead);

    expect(ids(rows)).toEqual([ROW.staffReadDo, ID.legacyAsk].sort());
  });

  it('an ADMIN lists every row of the business, any member\'s (control for the OWNER/ADMIN rule)', async () => {
    const all = [ROW.ownerDo, ROW.ownerPlan, ROW.staffNonePlan, ROW.staffNoneDo, ROW.staffReadDo, ID.cortexOwner, ID.cortexStaff, ID.legacyAsk].sort();
    expect(ids(await listed(ID.admin))).toEqual(all);
    expect(ids(await listed(ID.adminNoMoney))).toEqual(all);
    expect(ids(await listed(ID.owner))).toEqual(all);
  });
});

describe('SEC-V109-1 data: grounded revenue and contact names never reach a member who lacks revenue/crm read', () => {
  it("staffNone's own rows keep their outcome but no revenue figure, no contact name, no free text", async () => {
    const rows = await listed(ID.staffNone);
    const body = JSON.stringify(rows);

    expect(body).not.toContain(String(PAID_TOTAL));
    expect(body).not.toContain(String(OVERDUE_TOTAL));
    expect(body).not.toContain(TEAM_NAME);
    expect(body).not.toContain(PRIVATE_NAME);
    expect(body).not.toContain(PRIVATE_EMAIL);

    const plan = byId(rows, ROW.staffNonePlan);
    expect(plan).toMatchObject({ status: 'PLANNED', mode: 'plan', rawInput: 'how much revenue did we make this year' });
    expect(plan.groundedData).not.toHaveProperty('totalRevenue');
    expect(plan.groundedData).toMatchObject({ dataWithheld: true });

    const doRow = byId(rows, ROW.staffNoneDo);
    expect(doRow).toMatchObject({ status: 'EXECUTED', mode: 'do' });
    expect(doRow.executionResult).toMatchObject({ dataWithheld: true });
    expect(doRow.executionResult.actions ?? []).toEqual([]);

    const cortex = byId(rows, ID.cortexStaff);
    expect(cortex.executionResult).toMatchObject({ success: true, actionsExecuted: 1, dataWithheld: true });
    expect(cortex.executionResult).not.toHaveProperty('responseText');
    expect(cortex.executionLogs ?? null).toBeNull();
  });

  it("staffRead (crm read, contacts by the list route's clause) sees the TEAM contact's name and not the owner's PRIVATE one", async () => {
    const rows = await listed(ID.staffRead);
    const body = JSON.stringify(rows);

    const doRow = byId(rows, ROW.staffReadDo);
    expect(doRow.executionResult.actions.map((a: any) => a.contactId)).toEqual([ID.cTeam]);
    expect(body).toContain(TEAM_NAME);
    expect(body).not.toContain(PRIVATE_NAME);
    expect(body).not.toContain(PRIVATE_EMAIL);
    // The pre-V1-09 'ask' row keeps its outcome without its data.
    expect(byId(rows, ID.legacyAsk).executionResult.outputs[0]).toMatchObject({ success: true, dataWithheld: true });
  });

  it('an ADMIN with revenue none sees every row, but no revenue figure, no invoice reminder, no findings and no free text', async () => {
    const rows = await listed(ID.adminNoMoney);
    const body = JSON.stringify(rows);

    expect(body).not.toContain(String(PAID_TOTAL));
    expect(body).not.toContain(String(OVERDUE_TOTAL));
    expect(byId(rows, ROW.ownerPlan).groundedData).not.toHaveProperty('totalRevenue');
    expect(byId(rows, ROW.ownerPlan).groundedData).toHaveProperty('contactCount', 2);

    const doRow = byId(rows, ROW.ownerDo);
    expect(doRow.executionResult.actions.map((a: any) => a.actionType)).not.toContain('invoice_reminder');
    expect(doRow.executionResult.actions.every((a: any) => a.expectedValue === undefined)).toBe(true);
    expect(doRow.executionResult).not.toHaveProperty('findings');
    expect(byId(rows, ID.cortexOwner).executionResult).not.toHaveProperty('responseText');
    // crm admin: the TEAM contact's follow-up stays; the owner's PRIVATE contact is not visible to an ADMIN.
    expect(body).toContain(TEAM_NAME);
    expect(body).not.toContain(PRIVATE_NAME);
  });

  it("an ADMIN with role-default scopes sees the revenue, and contacts as the contacts list route shows an ADMIN (no owner's PRIVATE contact)", async () => {
    const rows = await listed(ID.admin);
    const body = JSON.stringify(rows);

    expect(byId(rows, ROW.ownerPlan).groundedData.totalRevenue).toBe(PAID_TOTAL);
    expect(body).toContain(TEAM_NAME);
    expect(body).not.toContain(PRIVATE_NAME);
  });

  it('the OWNER sees every row with its data (control)', async () => {
    const rows = await listed(ID.owner);
    const body = JSON.stringify(rows);

    expect(byId(rows, ROW.ownerPlan).groundedData.totalRevenue).toBe(PAID_TOTAL);
    expect(byId(rows, ROW.staffNonePlan).groundedData.totalRevenue).toBe(PAID_TOTAL);
    expect(body).toContain(TEAM_NAME);
    expect(body).toContain(PRIVATE_NAME);
    expect(byId(rows, ROW.ownerDo).executionResult.findings.join(' ')).toContain(String(OVERDUE_TOTAL));
    expect(byId(rows, ID.cortexOwner).executionResult.responseText).toContain(String(PAID_TOTAL));
  });
});

describe("SEC-V109-1 another business's rows never appear", () => {
  it("the owner of both businesses gets each business's rows only under that business", async () => {
    const own = await listed(ID.owner);
    expect(ids(own)).not.toContain(ROW.otherPlan);
    expect(JSON.stringify(own)).not.toContain(OTHER_MARKER);

    const other = await listed(ID.owner, ID.bizOther);
    expect(ids(other)).toEqual([ROW.otherPlan]);
  });

  it('a member of one business is refused the other business\'s list', async () => {
    const res = await list(ID.staffNone, ID.bizOther);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(OTHER_MARKER);
  });
});
