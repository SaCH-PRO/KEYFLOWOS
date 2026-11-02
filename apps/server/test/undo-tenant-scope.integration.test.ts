/**
 * V1-42b-UNDO-TENANT-SCOPE — the undo routes are tenant-bound and need the
 * write scope of what they undo (REAL database, through HTTP).
 *
 * V1-42 review SEC-V42-1 (left in the header of
 * invoice-transition-concurrency.integration.test.ts, outside that packet's
 * write set): the two routes that reach UndoService.undo checked no module
 * scope and did not bind the undo record to the route's tenant.
 *
 *   POST /ai/businesses/:businessId/agent/undo/:undoId            (agent.controller.ts undoAction)
 *        undoId from the path (client); businessId from the path, checked by BusinessGuard and then
 *        never compared with the record; actor req.user.id.
 *   POST /ai/businesses/:businessId/ai/plans/:planId/steps/:stepId/undo   (ai.controller.ts undoPlanStep)
 *        planId/stepId from the path (the step lookup is tenant-bound); body.undoId from the client
 *        and NOT tenant-bound; with no undoId the newest action of the route's tenant; actor
 *        req.user?.id (optional).
 *   The record lookup: UndoService.canUndo / undo read `recentActions.get(undoId)` (an in-memory Map
 *   keyed by the id alone) and then act on the RECORD's businessId (undoInvoice(action.entityId,
 *   action.businessId)), whatever tenant the route named.
 *
 * Cases (RED-BEFORE = fails on int/trial-I 7f4b81a2):
 *   UT-01 RED-BEFORE a revenue:none member undoing an invoice action of their own business -> 403;
 *         the invoice stays SENT, the record stays undoable, nothing is logged or emitted
 *   UT-02 RED-BEFORE the same for revenue:read (STAFF role defaults) -> 403
 *   UT-03 RED-BEFORE the owner of business B, through B's agent route, with A's undo id -> 404
 *         byte-identical (timestamp/path/correlationId aside) to an unknown id; A's invoice stays
 *         SENT, the record stays undoable
 *   UT-04 RED-BEFORE the owner of B, through B's plan-step route with A's undo id in the body -> 404
 *         identical to an unknown id; A's invoice SENT; B's step still completed
 *   UT-05 RED-BEFORE a revenue:none member through the plan-step route (body undoId, and no undoId:
 *         the newest action) -> 403; the step stays completed; the invoice stays SENT
 *   UT-06 RED-BEFORE (D-46) a platform SUPER_ADMIN who is not a member of A -> 403; still SENT
 *   UT-07 RED-BEFORE an unknown id -> 404 (base: 201 { success: false })
 *   UT-08 RED-BEFORE (userId) the owner of A keeps undo: 201, reverted_to_draft through
 *         InvoiceWorkflowService.returnToDraftOnUndo (the V1-42 compare-and-set; no raw status
 *         write); the actor is req.user in the event and in the execution log, its userId column
 *         included (base: actor string set, userId null)
 *   UT-09 RED-BEFORE (userId) an explicit revenue:write STAFF member undoes through the plan-step
 *         route: the step is marked undone, the actor is req.user (a body userId is ignored)
 *   UT-13 RED-BEFORE the binding is UndoService's own: with no ambient tenant (the Prisma tenant
 *         extension off, as for a non-HTTP caller) the owner of B is refused A's record (404 with
 *         B's tenant, 403 without one); base: A's invoice reverted to DRAFT
 *
 * Measured on the base with the production tenant wiring (UT-03/UT-04): the Prisma tenant
 * extension already stops the foreign owner's write through HTTP (CommerceService.undoInvoice
 * finds no invoice under B's ambient tenant), but the route answers 201 "Undo failed: Invoice not
 * found" for A's id and 201 "Undo window expired or action not found" for an unknown one: an
 * existence oracle. Without the extension (UT-13, and the V1-42 review's harness) the service
 * itself reverts A's invoice. The revenue:none, revenue:read and non-member SUPER_ADMIN reverts
 * (UT-01/02/05/06) happen through HTTP on the base with the extension on.
 *   UT-10 RED-BEFORE a contact undo needs crm:write: a crm:read member (revenue:write) -> 403 and
 *         CrmService.undoContact is not called; the owner -> 201 and it is called for A
 *   UT-11 RED-BEFORE deny by default: an entity type with no scope mapping (message) -> 403 for the
 *         owner, nothing logged or emitted
 *   UT-12 control: GET agent/undo lists only the route tenant's actions
 *
 * Review repairs (RED-BEFORE = fails on pkt/V1-42b-UNDO-TENANT-SCOPE ec729c82):
 *   UT-14 RED-BEFORE (SEC-V42B-1) a contact undo applies the CRM row rules, not only crm:write: a
 *         PRIVATE contact of the owner, which a crm:write member cannot see, answers 404 identical
 *         to an unknown id (delete scope 'owned' and 'any' alike); CrmService.undoContact is not
 *         called; the owner still undoes it
 *   UT-15 RED-BEFORE (CR-V42b-1) on a visible contact of another member the delete door's and the
 *         edit door's rules both apply (undoContact soft-deletes or reverts to LEAD at write time):
 *         crm_delete 'owned' -> 403, crm_edit 'none' -> 403, crm_edit 'owned' and not shared ->
 *         403, crm_view 'owned' (my book) -> 404; crm_delete 'any' with edit 'any' -> 201
 *   UT-16 control: a crm:write member undoes a contact they own; crm_edit 'owned' reaches a
 *         contact shared with them
 *   UT-17 RED-BEFORE (SEC-V42B-2) concurrent undo of one record runs the writer once: 12 parallel
 *         POSTs -> one success, the others { success: false }; the invoice is DRAFT (not
 *         soft-deleted), one action.undone log, one event
 *   UT-18 control: a writer failure releases the claim: { success: false }, the record stays
 *         undoable, a retry succeeds
 *   UT-19 RED-BEFORE (SEC-V42B-3) GET agent/undo lists only what this actor may undo: no invoice
 *         record for revenue below write, no PRIVATE contact the actor cannot see, no message
 *         record (refused to everyone), and each listed record answers canUndo: true
 *   CEN-01..03 census: the scope map, every entity type the dispatcher can register over the
 *         FLOW_TOOLS registry (ActionDispatcherService.inferEntityType) is mapped or denied by
 *         default, every tool that registers an invoice (the payment one included) needs
 *         revenue:write, an unknown type maps to nothing
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * CrmRateLimitGuard, the real AgentController and AiController, UndoService,
 * AiExecutionLogService, CommerceService, InvoiceWorkflowService and the ledger
 * chain run against DATABASE_URL, behind the production GlobalHttpExceptionFilter
 * and ValidationPipe, the app's TenantInterceptor (APP_INTERCEPTOR) and the
 * Prisma tenant context provider main.ts installs. Identity attachment is the
 * one stand-in: a test middleware reads `x-v42b-user`, loads that seeded user
 * row and attaches `{ id, email, role }` as AuthMiddleware would. Off the
 * boundary: the event bus (a recorder), the contact timeline and CRM undo (a
 * recorder: the contact case proves who reaches it, not what it writes), and
 * every AiController / AgentController collaborator the undo routes do not
 * call (an allow-listed mocker; any other missing token fails the compile).
 *
 * Fixtures: prefix `v42b_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. One invoice and one undo record per case.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v42b_';
const HEADER = 'x-v42b-user';
const TOTAL = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const ID = {
  ownerA: `${P}ownerA`,         // OWNER of bizA (no scope map: role defaults, admin everywhere)
  staffNone: `${P}staffNone`,   // STAFF of bizA, { revenue: none, crm: write }
  staffRead: `${P}staffRead`,   // STAFF of bizA, no scope map: role defaults (revenue read)
  staffWrite: `${P}staffWrite`, // STAFF of bizA, { revenue: write, crm: read }
  staffAny: `${P}staffAny`,     // STAFF of bizA, { revenue: none, crm: write, crm_delete: any }
  staffBook: `${P}staffBook`,   // STAFF of bizA, { crm: write, crm_view: owned, crm_delete: any } (my book)
  staffEditNone: `${P}staffEditNone`,   // STAFF of bizA, { crm: write, crm_edit: none, crm_delete: any }
  staffEditOwned: `${P}staffEditOwned`, // STAFF of bizA, { crm: write, crm_edit: owned, crm_delete: any }
  ownerB: `${P}ownerB`,         // OWNER of bizB only
  superAdmin: `${P}super`,      // role SUPER_ADMIN, no membership anywhere
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  cPriv: `${P}cPriv`,       // PRIVATE, owned by ownerA
  cTeam: `${P}cTeam`,       // TEAM, owned by ownerA
  cStaff: `${P}cStaff`,     // TEAM, owned by staffNone
  cShared: `${P}cShared`,   // TEAM, owned by ownerA, shared with staffEditOwned
  planA: `${P}planA`,
  planB: `${P}planB`,
};

/**
 * AgentController's and AiController's collaborators for routes this suite
 * does not call. UndoService, AiExecutionLogService and PrismaService are real;
 * anything else unresolved fails the compile.
 */
const OFF_BOUNDARY = new Set([
  // AgentController
  'AgentStateMachineService', 'AgentBusService', 'PatternDetectorService', 'CalendarIntelligenceService',
  'DocumentIntelligenceService', 'SemanticMemoryService',
  // AiController
  'AiAdvisorService', 'AiUsageService', 'AiOversightService', 'BusinessGraphService', 'IntentParserService',
  'PlannerService', 'AiMemoryService', 'StrategicIntelligenceService', 'ProAutoMonitorService',
  'ProfileIntelligenceService', 'WorkspaceRecommendationsService', 'ModelGatewayService', 'KeyCommandService',
  'AutopilotRulesService', 'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService',
  'UnifiedInboxService', 'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService',
  'CapacityInsightService', 'TaskRebalancerService', 'KeyAgentConfigService', 'ProactiveSuggestionService',
  'WorkflowTemplateService', 'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
  // CommerceService collaborators the undo does not reach
  'SubscriptionsService', 'CatalogService', 'PublicEventsService', 'BookingsService',
]);

type Emitted = { name: string; payload: any };
const emitted: Emitted[] = [];
const recorder = {
  emit: (name: string, payload: unknown) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};
/** CrmService.undoContact calls (the CRM undo writer), as `businessId:contactId`. */
const crmUndoCalls: string[] = [];

let db: any;
let app: any;
let undoService: any;
let workflow: any;
let commerce: any;
let tenantMod: any;
let census: {
  FLOW_TOOLS: Array<{ name: string }>;
  inferEntityType: (toolName: string) => string | null;
  undoWriteScopeFor?: (entityType: string) => string | null;
  UNDO_WRITE_SCOPE?: Record<string, string>;
  CANONICAL_MODULES: readonly string[];
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plan_steps WHERE plan_id IN (SELECT id FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}
function agentUndo(as: string, businessId: string, undoId: string) {
  return agent().post(`/ai/businesses/${businessId}/agent/undo/${encodeURIComponent(undoId)}`).set(HEADER, as).send({});
}
function stepUndo(as: string, businessId: string, planId: string, stepId: string, body: Record<string, unknown>) {
  return agent().post(`/ai/businesses/${businessId}/ai/plans/${planId}/steps/${stepId}/undo`).set(HEADER, as).send(body);
}

function stripVolatile(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.timestamp;
  delete copy.path;
  delete copy.correlationId;
  return copy;
}

/** A 100.00 invoice of bizA issued the way the product issues it (the workflow's SENT). */
async function seedSentInvoice(key: string) {
  const id = `${P}inv_${key}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `${P}INV-${key}`,
      businessId: ID.bizA,
      contactId: ID.contactA,
      status: 'DRAFT',
      subtotal: TOTAL,
      total: TOTAL,
      currency: 'TTD',
      dueDate: new Date(Date.now() + 14 * DAY_MS),
      items: { create: [{ description: `v42b ${key}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
    },
  });
  await workflow.transition(id, 'SENT', { sentAt: new Date() });
  emitted.length = 0;
  return id;
}

/** What the action dispatcher registers after KEY created the invoice (action-dispatcher.service.ts). */
function registerInvoiceUndo(invoiceId: string, businessId = ID.bizA) {
  return undoService.registerAction({
    businessId,
    actionType: 'commerce_create_invoice',
    entityType: 'invoice',
    entityId: invoiceId,
    originalPayload: {},
  }) as Promise<string>;
}

async function invoiceStatus(id: string): Promise<string | null> {
  const [row] = await db.$queryRawUnsafe(`SELECT status::text AS status FROM invoices WHERE id = $1`, id);
  return row?.status ?? null;
}

async function undoneLogs(businessId: string) {
  return db.aiExecutionLog.findMany({ where: { businessId, action: 'action.undone' }, orderBy: { createdAt: 'asc' } });
}

async function seedStep(key: string, planId: string) {
  const id = `${P}step_${key}`;
  await db.aiPlanStep.create({
    data: { id, planId, order: 0, status: 'completed', toolName: 'commerce_create_invoice', module: 'revenue', action: 'create invoice' },
  });
  return id;
}

async function stepStatus(id: string): Promise<{ status: string; errorMessage: string | null }> {
  return db.aiPlanStep.findUnique({ where: { id }, select: { status: true, errorMessage: true } });
}

/** Nothing was written and nothing was announced for this record. */
async function expectUntouched(invoiceId: string, undoId: string, logsBefore: number) {
  expect.soft(await invoiceStatus(invoiceId), 'invoice status').toBe('SENT');
  expect.soft(undoService.canUndo(undoId).canUndo, 'the record is still undoable').toBe(true);
  expect.soft((await undoneLogs(ID.bizA)).length, 'no action.undone log in A').toBe(logsBefore);
  expect.soft((await undoneLogs(ID.bizB)).length, 'no action.undone log in B').toBe(0);
  expect.soft(emitted.filter((e) => e.name === 'action.undone'), 'no action.undone event').toEqual([]);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  tenantMod = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenantMod.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { UndoService } = await import('../src/modules/ai/undo.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');

  const undoMod: any = await import('../src/modules/ai/undo.service');
  const { FLOW_TOOLS } = await import('../src/modules/ai/flow-tool-registry');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
  const { CANONICAL_MODULES } = await import('../src/core/authority/module-vocabulary');
  census = {
    FLOW_TOOLS,
    // The dispatcher's own rule for which tool results it registers for undo, and as what.
    inferEntityType: (toolName: string) => (ActionDispatcherService.prototype as any).inferEntityType.call(null, toolName),
    undoWriteScopeFor: undoMod.undoWriteScopeFor,
    UNDO_WRITE_SCOPE: undoMod.UNDO_WRITE_SCOPE,
    CANONICAL_MODULES,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AgentController, AiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: recorder },
      UndoService,
      AiExecutionLogService,
      CommerceService,
      CommerceStatsService,
      InvoiceWorkflowService,
      RevenuePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      {
        provide: CrmService,
        useValue: {
          logContactEvent: async () => null,
          undoContact: async (input: { businessId: string; contactId: string }) => {
            crmUndoCalls.push(`${input.businessId}:${input.contactId}`);
            return { id: input.contactId, status: 'deleted' };
          },
        },
      },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();
  undoService = moduleRef.get(UndoService);
  workflow = moduleRef.get(InvoiceWorkflowService);
  commerce = moduleRef.get(CommerceService);

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v42b_ users. No guard is overridden.
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
  // The app's TenantInterceptor (APP_INTERCEPTOR in app.module.ts), installed where Nest runs it: after the guards.
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, tag, role] of [
    [ID.ownerA, 'ownera', 'USER'],
    [ID.staffNone, 'none', 'USER'],
    [ID.staffRead, 'read', 'USER'],
    [ID.staffWrite, 'write', 'USER'],
    [ID.staffAny, 'any', 'USER'],
    [ID.staffBook, 'book', 'USER'],
    [ID.staffEditNone, 'editnone', 'USER'],
    [ID.staffEditOwned, 'editowned', 'USER'],
    [ID.ownerB, 'ownerb', 'USER'],
    [ID.superAdmin, 'super', 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}${tag}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V42B A', slug: `${P}biza`, ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V42B B', slug: `${P}bizb`, ownerId: ID.ownerB, currency: 'TTD' } });
  const m = (user: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${user}_${businessId}_m`, userId: user, businessId, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.ownerA, ID.bizA, 'OWNER');
  await m(ID.staffNone, ID.bizA, 'STAFF', { revenue: 'none', crm: 'write' });
  await m(ID.staffRead, ID.bizA, 'STAFF');
  await m(ID.staffWrite, ID.bizA, 'STAFF', { revenue: 'write', crm: 'read' });
  await m(ID.staffAny, ID.bizA, 'STAFF', { revenue: 'none', crm: 'write', crm_delete: 'any' });
  await m(ID.staffBook, ID.bizA, 'STAFF', { crm: 'write', crm_view: 'owned', crm_delete: 'any' });
  await m(ID.staffEditNone, ID.bizA, 'STAFF', { crm: 'write', crm_edit: 'none', crm_delete: 'any' });
  await m(ID.staffEditOwned, ID.bizA, 'STAFF', { crm: 'write', crm_edit: 'owned', crm_delete: 'any' });
  await m(ID.ownerB, ID.bizB, 'OWNER');
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V42b', lastName: 'Customer', email: `${P}customer@test.local` } });
  for (const [id, visibility, ownerId] of [
    [ID.cPriv, 'PRIVATE', ID.ownerA],
    [ID.cTeam, 'TEAM', ID.ownerA],
    [ID.cStaff, 'TEAM', ID.staffNone],
    [ID.cShared, 'TEAM', ID.ownerA],
  ] as const) {
    await db.contact.create({ data: { id, businessId: ID.bizA, firstName: 'V42b', lastName: id, visibility, ownerId } });
  }
  await db.contactShare.create({ data: { id: `${P}share`, businessId: ID.bizA, contactId: ID.cShared, userId: ID.staffEditOwned, createdBy: ID.ownerA } });
  await db.aiPlan.create({ data: { id: ID.planA, businessId: ID.bizA, status: 'completed', objective: 'v42b plan A' } });
  await db.aiPlan.create({ data: { id: ID.planB, businessId: ID.bizB, status: 'completed', objective: 'v42b plan B' } });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  await app?.close();
  if (db) (await import('@keyflow/db')).setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

beforeEach(() => {
  emitted.length = 0;
  crmUndoCalls.length = 0;
  vi.restoreAllMocks();
});

describe('a member without the write scope of what is undone is refused (SEC-V42-1)', () => {
  it('UT-01 RED-BEFORE: a revenue:none member undoing an invoice action of their own business -> 403; the invoice stays SENT; nothing logged or emitted', async () => {
    const inv = await seedSentInvoice('ut01');
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    const res = await agentUndo(ID.staffNone, ID.bizA, undoId);
    expect.soft(res.status, JSON.stringify(res.body)).toBe(403);
    expect.soft(res.body.message).toMatch(/revenue requires write access \(you have none\)/);
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it('UT-02 RED-BEFORE: revenue:read (STAFF role defaults) -> 403; still SENT', async () => {
    const inv = await seedSentInvoice('ut02');
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    const res = await agentUndo(ID.staffRead, ID.bizA, undoId);
    expect.soft(res.status, JSON.stringify(res.body)).toBe(403);
    expect.soft(res.body.message).toMatch(/revenue requires write access \(you have read\)/);
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it('UT-05 RED-BEFORE: a revenue:none member through the plan-step route (body undoId, and no undoId) -> 403; step still completed; invoice still SENT', async () => {
    const inv = await seedSentInvoice('ut05');
    const step = await seedStep('ut05', ID.planA);
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;

    const withId = await stepUndo(ID.staffNone, ID.bizA, ID.planA, step, { undoId });
    expect.soft(withId.status, JSON.stringify(withId.body)).toBe(403);
    // The no-undoId path picks the newest action of the route's tenant: this one.
    const newest = await stepUndo(ID.staffNone, ID.bizA, ID.planA, step, {});
    expect.soft(newest.status, JSON.stringify(newest.body)).toBe(403);

    expect.soft(await stepStatus(step)).toEqual({ status: 'completed', errorMessage: null });
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it('UT-06 RED-BEFORE (D-46): a platform SUPER_ADMIN who is not a member of A -> 403; still SENT', async () => {
    const inv = await seedSentInvoice('ut06');
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    const res = await agentUndo(ID.superAdmin, ID.bizA, undoId);
    expect.soft(res.status, JSON.stringify(res.body)).toBe(403);
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it('UT-10 RED-BEFORE: a contact undo needs crm:write: a crm:read member (revenue:write) -> 403, CrmService.undoContact not called; the owner -> 201, called for A', async () => {
    const registerContact = () =>
      undoService.registerAction({ businessId: ID.bizA, actionType: 'crm_create_contact', entityType: 'contact', entityId: ID.contactA, originalPayload: {} });
    const undoId = await registerContact();
    const denied = await agentUndo(ID.staffWrite, ID.bizA, undoId);
    expect.soft(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect.soft(denied.body.message).toMatch(/crm requires write access \(you have read\)/);
    expect.soft(crmUndoCalls).toEqual([]);
    expect.soft(undoService.canUndo(undoId).canUndo).toBe(true);

    const allowed = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body).toMatchObject({ success: true, restored: { id: ID.contactA, status: 'deleted' } });
    expect(crmUndoCalls).toEqual([`${ID.bizA}:${ID.contactA}`]);
  }, 60_000);

  it('UT-11 RED-BEFORE: deny by default: an entity type with no scope mapping (message) -> 403 for the owner; nothing logged or emitted; the record stays', async () => {
    const undoId = await undoService.registerAction({
      businessId: ID.bizA, actionType: 'send_message_with_approval', entityType: 'message', entityId: `${P}msg`, originalPayload: {},
    });
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    const res = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect.soft(res.status, JSON.stringify(res.body)).toBe(403);
    expect.soft(res.body.message).toMatch(/not permitted/);
    expect.soft((await undoneLogs(ID.bizA)).length).toBe(logsBefore);
    expect.soft(emitted.filter((e) => e.name === 'action.undone')).toEqual([]);
    expect.soft(undoService.canUndo(undoId).canUndo).toBe(true);
  }, 60_000);
});

describe('an undo record is resolved only inside the guarded business (SEC-V42-1)', () => {
  it('UT-07 RED-BEFORE: an unknown undo id -> 404 (base: 201 { success: false })', async () => {
    const res = await agentUndo(ID.ownerA, ID.bizA, `undo_${P}nope`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body).not.toHaveProperty('success');
  }, 60_000);

  it("UT-03 RED-BEFORE: the owner of B, through B's agent route, with A's undo id -> 404 identical to an unknown id; A's invoice stays SENT; the record stays", async () => {
    const inv = await seedSentInvoice('ut03');
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    const foreign = await agentUndo(ID.ownerB, ID.bizB, undoId);
    // The same caller, route and id length: only the record's existence differs.
    const unknown = await agentUndo(ID.ownerB, ID.bizB, `${undoId.slice(0, -1)}#`);
    expect.soft(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect.soft(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect.soft(stripVolatile(foreign.body)).toEqual(stripVolatile(unknown.body));
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it("UT-04 RED-BEFORE: the owner of B, through B's plan-step route with A's undo id in the body -> 404 identical to an unknown id; A's invoice SENT; B's step still completed", async () => {
    const inv = await seedSentInvoice('ut04');
    const stepB = await seedStep('ut04', ID.planB);
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    const foreign = await stepUndo(ID.ownerB, ID.bizB, ID.planB, stepB, { undoId });
    const unknown = await stepUndo(ID.ownerB, ID.bizB, ID.planB, stepB, { undoId: `${undoId.slice(0, -1)}#` });
    expect.soft(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expect.soft(unknown.status, JSON.stringify(unknown.body)).toBe(404);
    expect.soft(stripVolatile(foreign.body)).toEqual(stripVolatile(unknown.body));
    expect.soft(await stepStatus(stepB)).toEqual({ status: 'completed', errorMessage: null });
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it("UT-13 RED-BEFORE: the binding is UndoService's own, not the Prisma tenant extension's: with no ambient tenant (a non-HTTP caller), the owner of B with B's tenant -> 404, without a tenant -> 403 (not a member of A); A's invoice stays SENT (base: DRAFT)", async () => {
    const inv = await seedSentInvoice('ut13');
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    expect(tenantMod.getCurrentBusinessId(), 'no ambient tenant outside a request').toBeUndefined();
    const withTenant = await Promise.resolve()
      .then(() => undoService.undo(undoId, ID.ownerB, ID.bizB))
      .then((v: unknown) => ({ resolved: v }), (e: any) => ({ status: e?.status, message: e?.message }));
    expect.soft(withTenant).toEqual({ status: 404, message: 'Undo window expired or action not found' });
    const withoutTenant = await Promise.resolve()
      .then(() => undoService.undo(undoId, ID.ownerB))
      .then((v: unknown) => ({ resolved: v }), (e: any) => ({ status: e?.status, message: e?.message }));
    expect.soft(withoutTenant).toMatchObject({ status: 403 });
    await expectUntouched(inv, undoId, logsBefore);
  }, 60_000);

  it("UT-12 control: GET agent/undo lists only the route tenant's actions", async () => {
    const inv = await seedSentInvoice('ut12');
    const undoId = await registerInvoiceUndo(inv);
    const listB = await agent().get(`/ai/businesses/${ID.bizB}/agent/undo`).set(HEADER, ID.ownerB);
    expect(listB.status, JSON.stringify(listB.body)).toBe(200);
    expect((listB.body.actions as Array<{ id: string }>).map((a) => a.id)).not.toContain(undoId);
    const listA = await agent().get(`/ai/businesses/${ID.bizA}/agent/undo`).set(HEADER, ID.ownerA);
    expect(listA.status, JSON.stringify(listA.body)).toBe(200);
    expect((listA.body.actions as Array<{ id: string }>).map((a) => a.id)).toContain(undoId);
  }, 60_000);
});

describe('a member with the write scope keeps undo, through the workflow, as themselves', () => {
  it('UT-08 RED-BEFORE (userId): the owner of A undoes an invoice action -> 201 reverted_to_draft through InvoiceWorkflowService.returnToDraftOnUndo; actor = req.user', async () => {
    const inv = await seedSentInvoice('ut08');
    const undoId = await registerInvoiceUndo(inv);
    const cas = vi.spyOn(workflow, 'returnToDraftOnUndo');
    const logsBefore = (await undoneLogs(ID.bizA)).length;

    const res = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, restored: { id: inv, status: 'reverted_to_draft' } });
    expect(await invoiceStatus(inv)).toBe('DRAFT');
    expect(cas.mock.calls).toEqual([[inv]]);

    const logs = await undoneLogs(ID.bizA);
    expect(logs).toHaveLength(logsBefore + 1);
    expect(logs[logs.length - 1]).toMatchObject({ actor: ID.ownerA, userId: ID.ownerA, success: true });
    expect(emitted.filter((e) => e.name === 'action.undone').map((e) => e.payload)).toEqual([
      { businessId: ID.bizA, undoId, entityType: 'invoice', entityId: inv, userId: ID.ownerA },
    ]);
    // Once only.
    const again = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect(again.body).toMatchObject({ success: false, message: 'Action already undone' });
  }, 60_000);

  it('UT-09 RED-BEFORE (userId): an explicit revenue:write STAFF member undoes through the plan-step route: the step is marked undone; the actor is req.user, not a body userId', async () => {
    const inv = await seedSentInvoice('ut09');
    const step = await seedStep('ut09', ID.planA);
    const undoId = await registerInvoiceUndo(inv);
    const res = await stepUndo(ID.staffWrite, ID.bizA, ID.planA, step, { undoId, userId: ID.ownerA });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, restored: { id: inv, status: 'reverted_to_draft' } });
    expect(await invoiceStatus(inv)).toBe('DRAFT');
    expect(await stepStatus(step)).toEqual({ status: 'failed', errorMessage: 'Undone by user' });
    const logs = await undoneLogs(ID.bizA);
    expect(logs[logs.length - 1]).toMatchObject({ actor: ID.staffWrite, userId: ID.staffWrite });
    expect(emitted.filter((e) => e.name === 'action.undone').map((e) => e.payload.userId)).toEqual([ID.staffWrite]);
  }, 60_000);
});

/** What the action dispatcher registers after KEY created or updated a contact. */
function registerContactUndo(contactId: string, actionType = 'crm_update_contact') {
  return undoService.registerAction({
    businessId: ID.bizA, actionType, entityType: 'contact', entityId: contactId, originalPayload: {},
  }) as Promise<string>;
}

/** The same caller and route with an undo id of the same length that names no record. */
function unknownLike(undoId: string) {
  return `${undoId.slice(0, -1)}#`;
}

describe('a contact undo applies the CRM row rules of the doors it stands in for (SEC-V42B-1, CR-V42b-1)', () => {
  it("UT-14 RED-BEFORE (SEC-V42B-1): a PRIVATE contact of the owner, which a crm:write member cannot see -> 404 identical to an unknown id (delete 'owned' and 'any'); undoContact not called; the owner still undoes it", async () => {
    const undoId = await registerContactUndo(ID.cPriv);
    for (const actor of [ID.staffNone, ID.staffAny]) {
      const hidden = await agentUndo(actor, ID.bizA, undoId);
      const unknown = await agentUndo(actor, ID.bizA, unknownLike(undoId));
      expect.soft(hidden.status, `${actor} ${JSON.stringify(hidden.body)}`).toBe(404);
      expect.soft(stripVolatile(hidden.body), actor).toEqual(stripVolatile(unknown.body));
    }
    // The plan-step route reaches the same service.
    const step = await seedStep('ut14', ID.planA);
    const viaStep = await stepUndo(ID.staffAny, ID.bizA, ID.planA, step, { undoId });
    expect.soft(viaStep.status, JSON.stringify(viaStep.body)).toBe(404);
    expect.soft(await stepStatus(step)).toEqual({ status: 'completed', errorMessage: null });
    expect.soft(crmUndoCalls, 'CrmService.undoContact not reached').toEqual([]);
    expect.soft(undoService.canUndo(undoId).canUndo, 'the record is still undoable').toBe(true);
    expect.soft(emitted.filter((e) => e.name === 'action.undone')).toEqual([]);

    const owner = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect(owner.body).toMatchObject({ success: true, restored: { id: ID.cPriv } });
    expect(crmUndoCalls).toEqual([`${ID.bizA}:${ID.cPriv}`]);
  }, 60_000);

  it("UT-15 RED-BEFORE (CR-V42b-1): a visible contact of another member: crm_delete 'owned' -> 403, crm_edit 'none' -> 403, crm_edit 'owned' (not shared) -> 403, my book -> 404; undoContact not called; crm_delete 'any' -> 201", async () => {
    const undoId = await registerContactUndo(ID.cTeam);
    const refusals: Array<[string, number, RegExp | null]> = [
      [ID.staffNone, 403, /You can only delete contacts you own/],
      [ID.staffEditNone, 403, /You do not have permission to edit contacts/],
      [ID.staffEditOwned, 403, /You can only edit contacts you own/],
      [ID.staffBook, 404, null],
    ];
    for (const [actor, status, message] of refusals) {
      const res = await agentUndo(actor, ID.bizA, undoId);
      expect.soft(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(status);
      if (message) expect.soft(res.body.message, actor).toMatch(message);
      else {
        const unknown = await agentUndo(actor, ID.bizA, unknownLike(undoId));
        expect.soft(stripVolatile(res.body), actor).toEqual(stripVolatile(unknown.body));
      }
    }
    expect.soft(crmUndoCalls, 'CrmService.undoContact not reached').toEqual([]);
    expect.soft(undoService.canUndo(undoId).canUndo).toBe(true);

    const allowed = await agentUndo(ID.staffAny, ID.bizA, undoId);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body).toMatchObject({ success: true, restored: { id: ID.cTeam } });
    expect(crmUndoCalls).toEqual([`${ID.bizA}:${ID.cTeam}`]);
    expect(emitted.filter((e) => e.name === 'action.undone').map((e) => e.payload.userId)).toEqual([ID.staffAny]);
  }, 60_000);

  it("UT-16 control: a crm:write member undoes a contact they own; crm_edit 'owned' reaches a contact shared with them", async () => {
    const own = await registerContactUndo(ID.cStaff, 'crm_create_contact');
    const res = await agentUndo(ID.staffNone, ID.bizA, own);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, restored: { id: ID.cStaff } });

    const shared = await registerContactUndo(ID.cShared);
    const viaShare = await agentUndo(ID.staffEditOwned, ID.bizA, shared);
    expect(viaShare.status, JSON.stringify(viaShare.body)).toBe(201);
    expect(viaShare.body).toMatchObject({ success: true, restored: { id: ID.cShared } });
    expect(crmUndoCalls).toEqual([`${ID.bizA}:${ID.cStaff}`, `${ID.bizA}:${ID.cShared}`]);
  }, 60_000);
});

describe('one undo record is undone once, also under concurrent requests (SEC-V42B-2)', () => {
  it('UT-17 RED-BEFORE: 12 parallel POSTs for one invoice undo run the writer once: one success, the others { success: false }; the invoice is DRAFT, not soft-deleted; one action.undone log and event', async () => {
    const inv = await seedSentInvoice('ut17');
    const undoId = await registerInvoiceUndo(inv);
    const logsBefore = (await undoneLogs(ID.bizA)).length;
    // The real writer, entered late enough that every request has passed its checks first.
    const original = commerce.undoInvoice.bind(commerce);
    let writerCalls = 0;
    vi.spyOn(commerce, 'undoInvoice').mockImplementation(async (...args: unknown[]) => {
      writerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return original(...args);
    });

    const results = await Promise.all(Array.from({ length: 12 }, () => agentUndo(ID.ownerA, ID.bizA, undoId)));
    const ok = results.filter((r) => r.body?.success === true);
    const refused = results.filter((r) => r.body?.success === false);
    expect.soft(results.map((r) => r.status), 'every request answered 201').toEqual(Array(12).fill(201));
    expect.soft(writerCalls, 'the writer ran once').toBe(1);
    expect.soft(ok.map((r) => r.body.restored), 'one success').toEqual([{ id: inv, status: 'reverted_to_draft' }]);
    expect.soft(refused).toHaveLength(11);
    for (const r of refused) expect.soft(r.body.message).toMatch(/^(Undo already in progress|Action already undone)$/);

    const [row] = await db.$queryRawUnsafe(`SELECT status::text AS status, deleted_at FROM invoices WHERE id = $1`, inv);
    expect.soft(row, 'reverted, not deleted').toEqual({ status: 'DRAFT', deleted_at: null });
    expect.soft((await undoneLogs(ID.bizA)).length - logsBefore, 'one action.undone log').toBe(1);
    expect.soft(emitted.filter((e) => e.name === 'action.undone'), 'one action.undone event').toHaveLength(1);
    expect(undoService.canUndo(undoId)).toMatchObject({ canUndo: false, reason: 'Action already undone' });
  }, 60_000);

  it('UT-18 control: a writer failure releases the claim: { success: false }, the record stays undoable and listed, a retry succeeds', async () => {
    const inv = await seedSentInvoice('ut18');
    const undoId = await registerInvoiceUndo(inv);
    vi.spyOn(commerce, 'undoInvoice').mockImplementationOnce(async () => {
      throw new Error('writer unavailable');
    });
    const failed = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect(failed.status, JSON.stringify(failed.body)).toBe(201);
    expect(failed.body).toMatchObject({ success: false, message: 'Undo failed: writer unavailable' });
    expect(undoService.canUndo(undoId).canUndo).toBe(true);
    const list = await agent().get(`/ai/businesses/${ID.bizA}/agent/undo`).set(HEADER, ID.ownerA);
    expect((list.body.actions as Array<{ id: string; canUndo: boolean }>).find((a) => a.id === undoId)).toMatchObject({ canUndo: true });

    const retry = await agentUndo(ID.ownerA, ID.bizA, undoId);
    expect(retry.body).toMatchObject({ success: true, restored: { id: inv, status: 'reverted_to_draft' } });
    expect(await invoiceStatus(inv)).toBe('DRAFT');
  }, 60_000);
});

describe('GET agent/undo lists only what this actor may undo (SEC-V42B-3)', () => {
  it('UT-19 RED-BEFORE: no invoice record below revenue:write, no PRIVATE contact the actor cannot see, no message record; every listed record canUndo: true', async () => {
    const inv = await seedSentInvoice('ut19');
    const invoiceUndo = await registerInvoiceUndo(inv);
    const messageUndo = await undoService.registerAction({
      businessId: ID.bizA, actionType: 'send_message_with_approval', entityType: 'message', entityId: `${P}msg19`, originalPayload: {},
    });
    const privUndo = await registerContactUndo(ID.cPriv);
    const ownUndo = await registerContactUndo(ID.cStaff);
    const ours = [invoiceUndo, messageUndo, privUndo, ownUndo];

    const listed = async (actor: string) => {
      const res = await agent().get(`/ai/businesses/${ID.bizA}/agent/undo`).set(HEADER, actor);
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(200);
      const actions = (res.body.actions as Array<{ id: string; canUndo: boolean }>).filter((a) => ours.includes(a.id));
      for (const a of actions) expect.soft(a.canUndo, `${actor} ${a.id}`).toBe(true);
      return actions.map((a) => a.id).sort();
    };

    // revenue:none, crm:write (delete 'owned'): their own contact only.
    expect.soft(await listed(ID.staffNone)).toEqual([ownUndo]);
    // revenue:read, crm:read (STAFF role defaults): nothing.
    expect.soft(await listed(ID.staffRead)).toEqual([]);
    // revenue:write, crm:read: the invoice only.
    expect.soft(await listed(ID.staffWrite)).toEqual([invoiceUndo]);
    // The owner: everything but the message record, which no one may undo.
    expect.soft(await listed(ID.ownerA)).toEqual([invoiceUndo, privUndo, ownUndo].sort());

    // What is listed is what POST accepts: the owner's listing is undoable by the owner.
    const posted = await agentUndo(ID.ownerA, ID.bizA, invoiceUndo);
    expect(posted.body).toMatchObject({ success: true });
  }, 60_000);
});

describe('census: the module whose write scope each undo needs', () => {
  it('CEN-01: invoice -> revenue, contact -> crm, booking -> bookings; every mapped module is canonical; nothing else is mapped', () => {
    expect(census.UNDO_WRITE_SCOPE).toEqual({ invoice: 'revenue', contact: 'crm', booking: 'bookings' });
    for (const module of Object.values(census.UNDO_WRITE_SCOPE ?? {})) expect(census.CANONICAL_MODULES).toContain(module);
  });

  it('CEN-02: every entity type the dispatcher registers over FLOW_TOOLS is mapped or denied by default; every tool that registers an invoice (commerce_mark_invoice_paid included) needs revenue', () => {
    const byEntity = new Map<string, string[]>();
    for (const tool of census.FLOW_TOOLS) {
      const entity = census.inferEntityType(tool.name);
      if (entity) byEntity.set(entity, [...(byEntity.get(entity) ?? []), tool.name]);
    }
    // The registrable set. A new entity type here must be given a module or a stated denial.
    expect([...byEntity.keys()].sort()).toEqual(['booking', 'contact', 'invoice', 'message', 'task']);
    const DENIED_BY_DEFAULT: Record<string, string> = {
      // UndoService.undoTask writes the generic Task table by id, while every registering tool
      // (create_task, crm_add_task, projects_*_task, call_create_task, people_assign_task) creates
      // a row of another table (ContactTask, ProjectTask, CallTask, ...) owned by different modules.
      task: 'no single module owns the rows its undo writes',
      // UndoService.undoMessage writes nothing (a sent message cannot be unsent).
      message: 'its undo changes nothing a module scope could guard',
    };
    for (const entity of byEntity.keys()) {
      const module = census.undoWriteScopeFor?.(entity) ?? null;
      if (entity in DENIED_BY_DEFAULT) expect(module, `${entity}: ${DENIED_BY_DEFAULT[entity]}`).toBeNull();
      else expect(module, `${entity} (${byEntity.get(entity)?.join(', ')})`).not.toBeNull();
    }
    expect(byEntity.get('invoice')).toContain('commerce_mark_invoice_paid');
    for (const tool of byEntity.get('invoice') ?? []) expect(census.undoWriteScopeFor?.(census.inferEntityType(tool) as string), tool).toBe('revenue');
  });

  it('CEN-03: an unknown or prototype-named entity type maps to nothing (deny by default)', () => {
    expect(typeof census.undoWriteScopeFor).toBe('function');
    for (const entity of ['payment', 'task', 'message', 'constructor', '__proto__', 'toString', '', 'INVOICE']) {
      expect(census.undoWriteScopeFor?.(entity) ?? null, entity).toBeNull();
    }
  });
});
