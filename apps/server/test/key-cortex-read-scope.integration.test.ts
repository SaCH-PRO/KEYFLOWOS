/**
 * W11-CORTEX-READ-ROUTES-SCOPE - KEY cortex read routes answer only the
 * callers the owner rulings name (REAL database).
 *
 * DEFECT 1 (F-13b, owner ruling D-129). GET api/v1/cortex/context returned
 * KeyCortexContextV2Service.getFullContext(businessId) and its prompt text to
 * any member BusinessGuard admitted: the class guards are AuthGuard and
 * BusinessGuard only. A probe at fb00af1c had a STAFF member (crm none,
 * revenue none) read the owner's PRIVATE contact's name and overdue invoice
 * amount, the month's revenue and the outstanding total. D-129 (option A):
 * the route is served to the business owner and a platform SUPER_ADMIN only,
 * and everyone else is refused 403 before anything is read. The owner is the
 * member holding an OWNER-role Membership of the business (D-116 read by
 * D-125): a co-owner (OWNER membership, not Business.ownerId) IS the owner,
 * and a recorded owner (Business.ownerId) holding only an ADMIN membership is
 * an ADMIN.
 *
 * DEFECT 2 (F-13c, owner ruling D-57). GET insights/revenue (totals, growth,
 * revenue by day, top customers) and GET insights/profit (overdue invoices to
 * collect, by amount and contact) are money reads with no revenue scope. D-57
 * puts every money report behind revenue:read (ModuleScopeGuard).
 *
 * REVIEW (SEC-W11CRR-1, SEC-W11CRR-2, CRR-1, owner ruling D-57). Three sibling
 * routes served the same money figures with AuthGuard and BusinessGuard only:
 * GET report (KeyCortexInsightService.generateBusinessReport: the revenue
 * analysis, the profit opportunities, and keyMetrics / topPriorities with the
 * outstanding and overdue invoice totals), GET recommendations
 * (generateRecommendations: "Collect $X in overdue invoices", estimatedImpact =
 * the overdue total) and POST profit-opportunities (the deprecated alias of
 * insights/profit, through the reasoning engine to the same
 * findProfitOpportunities). A STAFF member holding revenue none read all three.
 * Each now needs revenue:read as well.
 *
 * REVIEW (SEC-W11CRR-3, owner ruling D-129). The owner predicate is bound to
 * the guarded tenant: a user who is OWNER of bizC and only STAFF of bizA is
 * refused bizA's full context (and still gets bizC's).
 *
 * W11-CORTEX-INSIGHT-QUERIES (review SEC-W11CRR-2, second half). The 200
 * cases above pass only through the insight stub. The real
 * KeyCortexInsightService selected columns Contact does not have (name,
 * score, stage, lastActivityAt, estimatedValue), a Product status and an
 * AutopilotTask source that do not exist, and lower-case enum values Prisma
 * refuses ('draft', 'paid', 'cancelled'), behind `as any` casts that stopped
 * tsc from saying so. Each method caught the throw and answered its empty
 * payload, so insights/revenue said 0 revenue and insights/profit said no
 * opportunities on any real business. The last describe block runs the REAL
 * service on seeded contacts, invoices, deals, products and tasks (no stub)
 * and checks each insight method's figures and customer names through its
 * route. Fixing the queries makes insights/churn (customer balances, owed and
 * overdue amounts, recovery values) and insights/pipeline (open deal values)
 * answer real figures, and both were membership-only; the report already
 * serves both analyses behind revenue:read (D-57), so each now needs
 * revenue:read too (the D-57 block for churn and pipeline below).
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, the
 * route guard the fix adds, the production GlobalHttpExceptionFilter and
 * ValidationPipe, Nest's routing, and KeyCortexController, against
 * DATABASE_URL. Stand-ins: identity attachment (a test middleware reads
 * `x-v97o-user` and attaches the seeded user row, as AuthMiddleware does after
 * token verification); KeyCortexContextV2Service, KeyCortexInsightService and
 * the reasoning engine (the legacy fallback of insights/profit), which record
 * every call and answer marker data; and the controller's collaborators for
 * its other routes (an allow-listed mocker). Vitest's esbuild transform emits
 * no constructor parameter types, so the suite writes the ones tsc emits for
 * the controller, as key-cortex-tenant-binding.integration.test.ts does.
 * The real-data block builds a second app in which KeyCortexInsightService
 * is the real class over the real PrismaService; its other collaborators are
 * stand-ins: the model gateway refuses every call (no provider traffic, so
 * the report takes its fallback narrative), AI usage records, and the full
 * KEY context (read by the report only) answers a fixed shape.
 *
 * Every seeded row carries the `v97o_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v97o_';
const HEADER = 'x-v97o-user';

const ID = {
  owner: `${P}owner`, // Business.ownerId of bizA, OWNER membership
  coOwner: `${P}coowner`, // OWNER membership of bizA, not Business.ownerId (D-125)
  admin: `${P}admin`, // ADMIN of bizA
  staffDefault: `${P}staff_default`, // STAFF of bizA, role-default scopes (revenue read)
  staffNoRevenue: `${P}staff_norev`, // STAFF of bizA, explicit map: crm none, revenue none
  staffRevenueRead: `${P}staff_revread`, // STAFF of bizA, explicit map: revenue read
  recordedAdmin: `${P}recorded_admin`, // Business.ownerId of bizB, holds only an ADMIN membership (D-116)
  ownerElsewhere: `${P}owner_elsewhere`, // OWNER of bizC, STAFF of bizA with crm none and revenue none (SEC-W11CRR-3)
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no membership
  nonMember: `${P}nonmember`, // no membership anywhere
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
};

const CONTEXT_MARKER = 'v97o-context-marker';
const FORMATTED_MARKER = 'v97o formatted context marker';
const REVENUE_MARKER = 'v97o-revenue-marker';
const PROFIT_MARKER = 'v97o-profit-marker';
const REPORT_MARKER = 'v97o-report-marker';
const RECOMMENDATION_MARKER = 'v97o-recommendation-marker';
const CHURN_MARKER = 'v97o-churn-marker';
const PIPELINE_MARKER = 'v97o-pipeline-marker';
/** The overdue invoice total the report and recommendation stubs carry, as the real methods take it from the full context. */
const OVERDUE_TOTAL = 98765;

/** The controller's collaborators for its other routes; the routes under test reach none of them. */
const OFF_BOUNDARY = new Set([
  'KeyCortexConversationService', 'KeyCortexVoiceService', 'KeyCortexPersonalityService', 'KeyCortexActionsService',
  'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService', 'KeyCortexExecutorService',
  'KeyCortexMonitorV2Service', 'KeyCortexSandboxService', 'KeyCortexFlowStudioService', 'KeyCortexEvolutionService',
  'KeyCortexPhoneService', 'KeyCortexDocumentService', 'KeyCortexLearningService', 'KeyAutonomySafetyService',
  'KeyCortexApprovalOrchestratorService', 'KeyCortexConsciousnessService', 'KeyCortexSessionService',
  'KeyCortexAwarenessService',
]);

interface StubCall { method: string; businessId: unknown }
const calls: StubCall[] = [];
const callsSince = (from: number) => calls.slice(from);

let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    // The real-data block's rows, children first (invoices.contact_id is NO ACTION).
    `DELETE FROM deals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deal_stages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function get(route: string, user: string | undefined, businessId: string) {
  let req = request(app.getHttpServer()).get(`/api/v1/cortex/${route}`);
  if (user) req = req.set(HEADER, user);
  return req.query({ businessId });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');

  // The constructor parameter types tsc emits for the controller (emitDecoratorMetadata),
  // which Vitest's esbuild transform leaves out; the same list as the tenant-binding suite.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
      KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
      KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
      KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
      KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
      KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
    ], KeyCortexController);
  }

  // The full KEY context (the V2 service and its cache are not under test): records and answers a marker.
  const contextV2 = {
    getFullContext: async (businessId: unknown) => {
      calls.push({ method: 'contextV2.getFullContext', businessId });
      return { businessId, marker: CONTEXT_MARKER };
    },
    formatContextForPrompt: (context: any) => {
      calls.push({ method: 'contextV2.formatContextForPrompt', businessId: context?.businessId });
      return FORMATTED_MARKER;
    },
  };
  const insight = {
    analyzeRevenue: async (businessId: unknown, _period: unknown) => {
      calls.push({ method: 'insight.analyzeRevenue', businessId });
      return { marker: REVENUE_MARKER, totalRevenue: 4321 };
    },
    findProfitOpportunities: async (businessId: unknown) => {
      calls.push({ method: 'insight.findProfitOpportunities', businessId });
      return [{ id: `${P}opp`, title: PROFIT_MARKER }];
    },
    // Shaped like the real methods: churn names customers with their owed balances; the
    // pipeline sums open deal values by stage.
    analyzeChurnRisk: async (businessId: unknown) => {
      calls.push({ method: 'insight.analyzeChurnRisk', businessId });
      return [{ contactId: `${P}churn`, contactName: CHURN_MARKER, outstandingBalance: OVERDUE_TOTAL }];
    },
    analyzePipeline: async (businessId: unknown) => {
      calls.push({ method: 'insight.analyzePipeline', businessId });
      return { marker: PIPELINE_MARKER, totalPipelineValue: OVERDUE_TOTAL, stages: [] };
    },
    // Shaped like the real methods (key-cortex-insight.service.ts generateBusinessReport and
    // generateRecommendations): the revenue analysis, the profit opportunities and the
    // context-derived overdue total.
    generateBusinessReport: async (businessId: unknown, scope: unknown) => {
      calls.push({ method: 'insight.generateBusinessReport', businessId });
      return {
        scope,
        marker: REPORT_MARKER,
        revenue: { marker: REVENUE_MARKER, totalRevenue: 4321 },
        opportunities: [{ id: `${P}opp`, title: PROFIT_MARKER }],
        keyMetrics: { outstandingInvoices: OVERDUE_TOTAL, overdueInvoices: OVERDUE_TOTAL },
        topPriorities: [`Collect $${OVERDUE_TOTAL.toLocaleString()} in overdue invoices (1 invoices)`],
      };
    },
    generateRecommendations: async (businessId: unknown) => {
      calls.push({ method: 'insight.generateRecommendations', businessId });
      return [{
        id: 'rec-rev-2',
        title: `Collect $${OVERDUE_TOTAL.toLocaleString()} in overdue invoices`,
        description: RECOMMENDATION_MARKER,
        category: 'revenue',
        estimatedImpact: OVERDUE_TOTAL,
      }];
    },
  };
  // insights/profit's legacy fallback (never reached here: the insight stub answers) and the
  // engine behind POST profit-opportunities, the deprecated alias of insights/profit.
  const reasoning = {
    findProfitOpportunities: async (businessId: unknown) => {
      calls.push({ method: 'reasoning.findProfitOpportunities', businessId });
      return [{ id: `${P}legacy_opp`, title: PROFIT_MARKER }];
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: KeyCortexContextV2Service, useValue: contextV2 },
      { provide: KeyCortexInsightService, useValue: insight },
      { provide: KeyCortexReasoningService, useValue: reasoning },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v97o_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.coOwner, 'USER'],
    [ID.admin, 'USER'],
    [ID.staffDefault, 'USER'],
    [ID.staffNoRevenue, 'USER'],
    [ID.staffRevenueRead, 'USER'],
    [ID.recordedAdmin, 'USER'],
    [ID.ownerElsewhere, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
    [ID.nonMember, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V97O Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V97O Biz B', ownerId: ID.recordedAdmin } });
  await db.business.create({ data: { id: ID.bizC, name: 'V97O Biz C', ownerId: ID.ownerElsewhere } });
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.staffDefault, businessId: ID.bizA, role: 'STAFF' },
    { userId: ID.staffNoRevenue, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'none', revenue: 'none' } },
    { userId: ID.staffRevenueRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    { userId: ID.recordedAdmin, businessId: ID.bizB, role: 'ADMIN' },
    { userId: ID.ownerElsewhere, businessId: ID.bizC, role: 'OWNER' },
    { userId: ID.ownerElsewhere, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'none', revenue: 'none' } },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('bizA has its recorded owner and a co-owner as OWNER members, an ADMIN and four STAFF (one of them the OWNER of bizC); bizB is recorded to a user who holds only ADMIN', async () => {
    const a = await db.membership.findMany({ where: { businessId: ID.bizA }, select: { userId: true, role: true } });
    expect(a.filter((m: any) => m.role === 'OWNER').map((m: any) => m.userId).sort()).toEqual([ID.coOwner, ID.owner].sort());
    expect(a.filter((m: any) => m.role === 'STAFF')).toHaveLength(4);
    expect(await db.membership.findMany({ where: { userId: ID.ownerElsewhere }, select: { businessId: true, role: true }, orderBy: { businessId: 'asc' } }))
      .toEqual([{ businessId: ID.bizA, role: 'STAFF' }, { businessId: ID.bizC, role: 'OWNER' }]);
    expect(await db.business.count({ where: { id: ID.bizA, ownerId: ID.owner } })).toBe(1);
    expect(await db.business.count({ where: { id: ID.bizA, ownerId: ID.coOwner } })).toBe(0);
    expect(await db.business.count({ where: { id: ID.bizB, ownerId: ID.recordedAdmin } })).toBe(1);
    expect(await db.membership.findMany({ where: { businessId: ID.bizB }, select: { userId: true, role: true } }))
      .toEqual([{ userId: ID.recordedAdmin, role: 'ADMIN' }]);
    expect(await db.membership.count({ where: { userId: { in: [ID.superAdmin, ID.nonMember] } } })).toBe(0);
  });
});

describe('W11-CORTEX-READ-ROUTES-SCOPE D-129: GET cortex/context is served to the business owner (D-125) and a platform SUPER_ADMIN only', () => {
  let from = 0;
  beforeEach(() => { from = calls.length; });

  it.each([
    ['an ADMIN member', ID.admin, ID.bizA],
    ['a STAFF member with the role-default scopes', ID.staffDefault, ID.bizA],
    ['a STAFF member holding crm none and revenue none', ID.staffNoRevenue, ID.bizA],
    ['a STAFF member holding revenue read', ID.staffRevenueRead, ID.bizA],
    ['the recorded owner (Business.ownerId) who holds only an ADMIN membership (D-116)', ID.recordedAdmin, ID.bizB],
    ['a user with no membership', ID.nonMember, ID.bizA],
  ])('D-129: %s is refused 403 and the full context is never read', async (_label, user, businessId) => {
    const res = await get('context', user, businessId);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(CONTEXT_MARKER);
    expect(text).not.toContain(FORMATTED_MARKER);
    expect(callsSince(from)).toEqual([]);
  });

  it('D-129: the recorded owner holding an OWNER membership gets 200 with the context of the business', async () => {
    const res = await get('context', ID.owner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.context).toEqual({ businessId: ID.bizA, marker: CONTEXT_MARKER });
    expect(res.body.formatted).toBe(FORMATTED_MARKER);
    expect(callsSince(from).map((c) => c.businessId)).toEqual([ID.bizA, ID.bizA]);
  });

  it('D-129 / D-125: a co-owner (OWNER membership, not Business.ownerId) is the owner and gets 200', async () => {
    const res = await get('context', ID.coOwner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.context).toEqual({ businessId: ID.bizA, marker: CONTEXT_MARKER });
    expect(callsSince(from).map((c) => c.method)).toEqual(['contextV2.getFullContext', 'contextV2.formatContextForPrompt']);
  });

  it('D-129: a platform SUPER_ADMIN (no membership) gets 200', async () => {
    const res = await get('context', ID.superAdmin, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.context).toEqual({ businessId: ID.bizA, marker: CONTEXT_MARKER });
    expect(callsSince(from).map((c) => c.businessId)).toEqual([ID.bizA, ID.bizA]);
  });

  it('D-129: a request with no identity is 401 and reads nothing', async () => {
    const res = await get('context', undefined, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(callsSince(from)).toEqual([]);
  });

  it('SEC-W11CRR-3 (D-129): the OWNER of another business who is only STAFF here is refused 403, and the full context is never read', async () => {
    const res = await get('context', ID.ownerElsewhere, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(CONTEXT_MARKER);
    expect(text).not.toContain(FORMATTED_MARKER);
    expect(callsSince(from)).toEqual([]);
  });

  it('SEC-W11CRR-3 (D-129) control: the same user gets 200 with the context of the business they own', async () => {
    const res = await get('context', ID.ownerElsewhere, ID.bizC);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.context).toEqual({ businessId: ID.bizC, marker: CONTEXT_MARKER });
    expect(callsSince(from).map((c) => c.businessId)).toEqual([ID.bizC, ID.bizC]);
  });
});

describe('W11-CORTEX-READ-ROUTES-SCOPE D-57: GET cortex/insights/revenue and insights/profit need revenue read', () => {
  let from = 0;
  beforeEach(() => { from = calls.length; });

  const ROUTES = [
    { route: 'insights/revenue', method: 'insight.analyzeRevenue', marker: REVENUE_MARKER },
    { route: 'insights/profit', method: 'insight.findProfitOpportunities', marker: PROFIT_MARKER },
  ] as const;

  for (const { route, method, marker } of ROUTES) {
    it(`D-57: GET ${route} refuses a STAFF member holding revenue none 403, and the insight service is never called`, async () => {
      const res = await get(route, ID.staffNoRevenue, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(marker);
      expect(callsSince(from)).toEqual([]);
    });

    it.each([
      ['a STAFF member holding revenue read (explicit map)', ID.staffRevenueRead],
      ['a STAFF member with the role-default scopes (revenue read)', ID.staffDefault],
      ['the OWNER', ID.owner],
    ])(`D-57: GET ${route} answers %s 200 with the analysis of the business`, async (_label, user) => {
      const res = await get(route, user, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body)).toContain(marker);
      expect(callsSince(from)).toEqual([{ method, businessId: ID.bizA }]);
    });

    it(`D-57: GET ${route} refuses a user with no membership 403`, async () => {
      const res = await get(route, ID.nonMember, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(callsSince(from)).toEqual([]);
    });
  }
});

describe('W11-CORTEX-READ-ROUTES-SCOPE review (SEC-W11CRR-1, SEC-W11CRR-2, CRR-1) D-57: GET cortex/report, GET cortex/recommendations and POST cortex/profit-opportunities need revenue read', () => {
  let from = 0;
  beforeEach(() => { from = calls.length; });

  const ROUTES = [
    {
      name: 'GET report',
      send: (user: string, businessId: string) => get('report', user, businessId).query({ scope: 'weekly' }),
      method: 'insight.generateBusinessReport',
      marker: REPORT_MARKER,
    },
    {
      name: 'GET recommendations',
      send: (user: string, businessId: string) => get('recommendations', user, businessId),
      method: 'insight.generateRecommendations',
      marker: RECOMMENDATION_MARKER,
    },
    {
      name: 'POST profit-opportunities',
      send: (user: string, businessId: string) =>
        request(app.getHttpServer()).post('/api/v1/cortex/profit-opportunities').set(HEADER, user).send({ businessId }),
      method: 'reasoning.findProfitOpportunities',
      marker: PROFIT_MARKER,
    },
  ] as const;

  for (const { name, send, method, marker } of ROUTES) {
    it.each([
      ['a STAFF member holding revenue none', ID.staffNoRevenue],
      ['the OWNER of another business who is STAFF holding revenue none here', ID.ownerElsewhere],
    ])(`D-57: ${name} refuses %s 403, and no money figure is computed or returned`, async (_label, user) => {
      const res = await send(user, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(marker);
      expect(text).not.toContain(String(OVERDUE_TOTAL));
      expect(text).not.toContain(OVERDUE_TOTAL.toLocaleString());
      expect(callsSince(from)).toEqual([]);
    });

    it.each([
      ['a STAFF member holding revenue read (explicit map)', ID.staffRevenueRead],
      ['a STAFF member with the role-default scopes (revenue read)', ID.staffDefault],
      ['the OWNER', ID.owner],
    ])(`D-57: ${name} answers %s 200 with the figures of the business`, async (_label, user) => {
      const res = await send(user, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body)).toContain(marker);
      expect(callsSince(from)).toEqual([{ method, businessId: ID.bizA }]);
    });

    it(`D-57: ${name} refuses a user with no membership 403`, async () => {
      const res = await send(ID.nonMember, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(callsSince(from)).toEqual([]);
    });
  }
});

describe('W11-CORTEX-INSIGHT-QUERIES D-57: GET cortex/insights/churn and insights/pipeline need revenue read, as GET report, which carries both analyses, does', () => {
  let from = 0;
  beforeEach(() => { from = calls.length; });

  const ROUTES = [
    { route: 'insights/churn', method: 'insight.analyzeChurnRisk', marker: CHURN_MARKER },
    { route: 'insights/pipeline', method: 'insight.analyzePipeline', marker: PIPELINE_MARKER },
  ] as const;

  for (const { route, method, marker } of ROUTES) {
    it.each([
      ['a STAFF member holding revenue none', ID.staffNoRevenue],
      ['the OWNER of another business who is STAFF holding revenue none here', ID.ownerElsewhere],
    ])(`D-57: GET ${route} refuses %s 403, and the insight service is never called`, async (_label, user) => {
      const res = await get(route, user, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(marker);
      expect(text).not.toContain(String(OVERDUE_TOTAL));
      expect(callsSince(from)).toEqual([]);
    });

    it.each([
      ['a STAFF member holding revenue read (explicit map)', ID.staffRevenueRead],
      ['a STAFF member with the role-default scopes (revenue read)', ID.staffDefault],
      ['the OWNER', ID.owner],
    ])(`D-57: GET ${route} answers %s 200 with the analysis of the business`, async (_label, user) => {
      const res = await get(route, user, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body)).toContain(marker);
      expect(callsSince(from)).toEqual([{ method, businessId: ID.bizA }]);
    });

    it(`D-57: GET ${route} refuses a user with no membership 403`, async () => {
      const res = await get(route, ID.nonMember, ID.bizA);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(callsSince(from)).toEqual([]);
    });
  }
});

describe('W11-CORTEX-INSIGHT-QUERIES (SEC-W11CRR-2): the REAL insight service answers each route with its figures and customer names from seeded contacts and invoices (no stub)', () => {
  const R = {
    biz: `${P}bizR`,
    owner: `${P}r_owner`,
    staffNoRevenue: `${P}r_staff_norev`,
    staffRevenueRead: `${P}r_staff_revread`,
    bizX: `${P}bizX`,
    xOwner: `${P}x_owner`,
  };
  const C = {
    alicia: `${P}r_c_alicia`, // firstName + lastName, CLIENT
    maraval: `${P}r_c_maraval`, // companyName only, CUSTOMER (the legacy CLIENT spelling)
    marcus: `${P}r_c_marcus`, // displayName wins over firstName/lastName, CLIENT
    kerry: `${P}r_c_kerry`, // LEAD, score 85, quiet 20 days, one open deal
    nadia: `${P}r_c_nadia`, // LEAD, score 40, no stage, no deal
    ghost: `${P}r_c_ghost`, // soft-deleted LEAD with an open deal
    zed: `${P}x_c_zed`, // bizX
    yara: `${P}x_c_yara`, // bizX
  };
  const NAME = {
    alicia: 'Alicia Baptiste',
    maraval: 'Maraval Hardware Ltd',
    marcus: 'Marcus Lee',
    kerry: 'Kerry Mohammed',
    nadia: 'Nadia',
    ghost: 'Ghost Deleted',
    zed: 'Zed Outsider',
    yara: 'Yara Elsewhere',
  };
  const DAY = 86_400_000;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
  const daysAhead = (n: number) => new Date(now.getTime() + n * DAY);

  interface SeedInvoice { id: string; businessId: string; contactId: string; total: number; status: string; createdAt: Date; dueDate?: Date; deletedAt?: Date }
  const INV = {
    sent: `${P}r_inv_sent`,
    upcoming: `${P}r_inv_upcoming`,
    paidA: `${P}r_inv_paid_a`,
    void: `${P}r_inv_void`,
    deleted: `${P}r_inv_deleted`,
    paidM: `${P}r_inv_paid_m`,
    draft: `${P}r_inv_draft`,
    prev: `${P}r_inv_prev`,
    overdueM: `${P}r_inv_overdue_m`,
    up1: `${P}r_inv_up1`,
    up2: `${P}r_inv_up2`,
    x: `${P}x_inv`,
  };
  // Computed once, as the service computes "this month" and "last month" (the process time zone).
  let periodStart: Date;
  let previousStart: Date;
  let INVOICES: SeedInvoice[] = [];
  const PRODUCT = { premium: `${P}r_prod_premium`, retired: `${P}r_prod_retired`, basic: `${P}r_prod_basic`, outsider: `${P}x_prod_outsider` };

  /** The full KEY context the report reads (the V2 service is not under test): a fixed shape. */
  const REPORT_CONTEXT = {
    commerce: { outstandingInvoices: { total: 0, overdue: 0, overdueTotal: 0 }, collectionRate: 0 },
    bookings: { completionRate: 0, noShows: { rate: 0 }, todayBookings: { count: 0, totalValue: 0 } },
    inbox: { unreadMessages: 0 },
    summary: { healthScore: 50 },
    autopilot: { automationRate: 50, activeTasks: [] as unknown[] },
  };
  const gatewayCalls: unknown[] = [];
  const usageCalls: unknown[] = [];
  const legacyCalls: unknown[] = [];
  let app2: any;

  function get2(route: string, user: string, businessId: string) {
    return request(app2.getHttpServer()).get(`/api/v1/cortex/${route}`).set(HEADER, user).query({ businessId });
  }
  const isRevenue = (i: SeedInvoice) => i.status !== 'DRAFT' && i.status !== 'VOID' && !i.deletedAt;

  beforeAll(async () => {
    const { startOfMonth, subMonths } = await import('date-fns');
    periodStart = startOfMonth(now);
    previousStart = subMonths(periodStart, 1);
    INVOICES = [
      { id: INV.sent, businessId: R.biz, contactId: C.alicia, total: 1000, status: 'SENT', createdAt: now, dueDate: daysAgo(10) },
      { id: INV.upcoming, businessId: R.biz, contactId: C.alicia, total: 120, status: 'SENT', createdAt: now, dueDate: daysAhead(5) },
      { id: INV.paidA, businessId: R.biz, contactId: C.alicia, total: 400, status: 'PAID', createdAt: now },
      { id: INV.void, businessId: R.biz, contactId: C.alicia, total: 7777, status: 'VOID', createdAt: now, dueDate: daysAgo(10) },
      { id: INV.deleted, businessId: R.biz, contactId: C.alicia, total: 5555, status: 'SENT', createdAt: now, dueDate: daysAgo(10), deletedAt: now },
      { id: INV.paidM, businessId: R.biz, contactId: C.maraval, total: 600, status: 'PAID', createdAt: now },
      { id: INV.draft, businessId: R.biz, contactId: C.maraval, total: 9999, status: 'DRAFT', createdAt: now, dueDate: daysAgo(10) },
      { id: INV.prev, businessId: R.biz, contactId: C.maraval, total: 500, status: 'PAID', createdAt: new Date(previousStart.getTime() + 2 * DAY) },
      { id: INV.overdueM, businessId: R.biz, contactId: C.maraval, total: 250, status: 'OVERDUE', createdAt: daysAgo(50), dueDate: daysAgo(40) },
      { id: INV.up1, businessId: R.biz, contactId: C.marcus, total: 300, status: 'PAID', createdAt: daysAgo(60) },
      { id: INV.up2, businessId: R.biz, contactId: C.marcus, total: 350, status: 'PAID', createdAt: daysAgo(45) },
      { id: INV.x, businessId: R.bizX, contactId: C.zed, total: 777, status: 'SENT', createdAt: now, dueDate: daysAgo(5) },
    ];

    const { Test } = await import('@nestjs/testing');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { ValidationPipe } = await import('@nestjs/common');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
    const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
    const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
    const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');

    const contextV2 = {
      getFullContext: async (businessId: unknown) => ({ ...REPORT_CONTEXT, businessId }),
      formatContextForPrompt: () => '',
    };
    // No provider traffic: the gateway refuses, so the report writes its fallback narrative.
    const gateway = {
      complete: async (...args: unknown[]) => {
        gatewayCalls.push(args);
        throw new Error('v97o: the model gateway is not reached in this suite');
      },
    };
    const aiUsage = { track: async (...args: unknown[]) => { usageCalls.push(args); } };
    // insights/profit falls back to the reasoning engine only when the insight service throws.
    const reasoning = {
      findProfitOpportunities: async (businessId: unknown) => {
        legacyCalls.push(businessId);
        return [];
      },
      generateInsights: async (businessId: unknown) => {
        legacyCalls.push(businessId);
        return [];
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [KeyCortexController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        { provide: KeyCortexContextV2Service, useValue: contextV2 },
        {
          provide: KeyCortexInsightService,
          useFactory: (prisma: InstanceType<typeof PrismaService>) =>
            new KeyCortexInsightService(prisma, gateway as any, aiUsage as any, contextV2 as any),
          inject: [PrismaService],
        },
        { provide: KeyCortexReasoningService, useValue: reasoning },
      ],
    })
      .useMocker((token: any) => {
        const name = typeof token === 'function' ? token.name : String(token);
        return OFF_BOUNDARY.has(name) ? {} : undefined;
      })
      .compile();

    app2 = moduleRef.createNestApplication();
    app2.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    app2.useGlobalFilters(new GlobalHttpExceptionFilter());
    app2.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app2.init();

    for (const id of [R.owner, R.staffNoRevenue, R.staffRevenueRead, R.xOwner]) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
    }
    await db.business.create({ data: { id: R.biz, name: 'V97O Biz R', ownerId: R.owner } });
    await db.business.create({ data: { id: R.bizX, name: 'V97O Biz X', ownerId: R.xOwner } });
    for (const m of [
      { userId: R.owner, businessId: R.biz, role: 'OWNER' },
      { userId: R.staffNoRevenue, businessId: R.biz, role: 'STAFF', permissionScopes: { revenue: 'none' } },
      { userId: R.staffRevenueRead, businessId: R.biz, role: 'STAFF', permissionScopes: { revenue: 'read' } },
      { userId: R.xOwner, businessId: R.bizX, role: 'OWNER' },
    ]) {
      await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}`, ...m } });
    }

    const contacts = [
      { id: C.alicia, businessId: R.biz, firstName: 'Alicia', lastName: 'Baptiste', email: `${P}alicia@test.local`, status: 'CLIENT' },
      { id: C.maraval, businessId: R.biz, companyName: 'Maraval Hardware Ltd', email: `${P}maraval@test.local`, status: 'CUSTOMER' },
      { id: C.marcus, businessId: R.biz, displayName: 'Marcus Lee', firstName: 'Marc', lastName: 'Leeroy', email: `${P}marcus@test.local`, status: 'CLIENT', lastInteractionAt: daysAgo(70) },
      { id: C.kerry, businessId: R.biz, firstName: 'Kerry', lastName: 'Mohammed', status: 'LEAD', leadScore: 85, lastInteractionAt: daysAgo(20), pipelineStage: 'qualified' },
      { id: C.nadia, businessId: R.biz, firstName: 'Nadia', status: 'LEAD', leadScore: 40 },
      { id: C.ghost, businessId: R.biz, firstName: 'Ghost', lastName: 'Deleted', status: 'LEAD', leadScore: 95, lastInteractionAt: daysAgo(30), pipelineStage: 'qualified', deletedAt: now },
      { id: C.zed, businessId: R.bizX, firstName: 'Zed', lastName: 'Outsider', status: 'CLIENT' },
      { id: C.yara, businessId: R.bizX, firstName: 'Yara', lastName: 'Elsewhere', status: 'LEAD', leadScore: 95, lastInteractionAt: daysAgo(30), pipelineStage: 'proposal' },
    ];
    for (const c of contacts) await db.contact.create({ data: c });

    await db.dealStage.create({ data: { id: `${P}r_stage`, businessId: R.biz, name: 'Qualified', slug: `${P}qualified` } });
    await db.dealStage.create({ data: { id: `${P}x_stage`, businessId: R.bizX, name: 'Proposal', slug: `${P}proposal` } });
    for (const d of [
      { id: `${P}r_deal_kerry_open`, businessId: R.biz, contactId: C.kerry, stageId: `${P}r_stage`, title: 'Kerry fit-out', value: 2500, status: 'OPEN' },
      { id: `${P}r_deal_kerry_won`, businessId: R.biz, contactId: C.kerry, stageId: `${P}r_stage`, title: 'Kerry earlier job', value: 9000, status: 'WON' },
      { id: `${P}r_deal_ghost_open`, businessId: R.biz, contactId: C.ghost, stageId: `${P}r_stage`, title: 'Ghost deal', value: 4444, status: 'OPEN' },
      { id: `${P}x_deal_yara_open`, businessId: R.bizX, contactId: C.yara, stageId: `${P}x_stage`, title: 'Yara deal', value: 3333, status: 'OPEN' },
    ] as const) {
      await db.deal.create({ data: d });
    }

    for (const p of [
      { id: PRODUCT.premium, businessId: R.biz, name: 'Premium Detailing', price: 450, isActive: true },
      { id: PRODUCT.retired, businessId: R.biz, name: 'Retired Package', price: 900, isActive: false },
      { id: PRODUCT.basic, businessId: R.biz, name: 'Basic Wash', price: 50, isActive: true },
      { id: PRODUCT.outsider, businessId: R.bizX, name: 'Outsider Product', price: 800, isActive: true },
    ]) {
      await db.product.create({ data: p });
    }

    const tasks: Array<{ id: string; businessId: string; title: string; category: string }> = [];
    for (let i = 0; i < 21; i++) tasks.push({ id: `${P}r_task_manual_${i}`, businessId: R.biz, title: `Manual task ${i}`, category: 'SALES' });
    for (let i = 0; i < 3; i++) tasks.push({ id: `${P}r_task_auto_${i}`, businessId: R.biz, title: `Workflow task ${i}`, category: 'workflow' });
    for (let i = 0; i < 30; i++) tasks.push({ id: `${P}x_task_manual_${i}`, businessId: R.bizX, title: `Manual task ${i}`, category: 'SALES' });
    await db.autopilotTask.createMany({ data: tasks });

    for (const inv of INVOICES) {
      await db.invoice.create({
        data: {
          id: inv.id,
          businessId: inv.businessId,
          contactId: inv.contactId,
          invoiceNumber: inv.id.slice(P.length).toUpperCase(),
          status: inv.status as any,
          subtotal: inv.total,
          total: inv.total,
          createdAt: inv.createdAt,
          dueDate: inv.dueDate ?? null,
          deletedAt: inv.deletedAt ?? null,
        },
      });
    }
    // Money received in the last 30 days: one SUCCESSFUL payment (counted) and one FAILED (not).
    for (const pay of [
      { id: `${P}r_pay_ok`, status: 'SUCCESSFUL', amount: 400 },
      { id: `${P}r_pay_failed`, status: 'FAILED', amount: 999 },
    ]) {
      await db.payment.create({
        data: { ...pay, businessId: R.biz, invoiceId: INV.paidA, currency: 'TTD', provider: 'cash', method: 'cash', providerPaymentId: `${P}${pay.id.slice(P.length)}` },
      });
    }
  }, 180_000);

  afterAll(async () => {
    if (app2) await app2.close();
  });

  it('fixture sanity (real rows): bizR holds 11 invoices (one soft-deleted) of 3 customers and 3 leads (one soft-deleted), bizX 1 invoice; no stub stands for the insight service', async () => {
    // Raw SQL: the db client's soft-delete extension hides deleted rows from count/findMany
    // (not from groupBy, aggregate or a relation include, which is why the service filters them itself).
    const n = async (sql: string, ...params: unknown[]) =>
      Number(((await db.$queryRawUnsafe(sql, ...params)) as Array<{ n: number | bigint }>)[0].n);
    expect(await n('SELECT count(*) AS n FROM invoices WHERE business_id = $1', R.biz)).toBe(11);
    expect(await n('SELECT count(*) AS n FROM invoices WHERE business_id = $1 AND deleted_at IS NOT NULL', R.biz)).toBe(1);
    expect(await n('SELECT count(*) AS n FROM invoices WHERE business_id = $1', R.bizX)).toBe(1);
    expect(await n(`SELECT count(*) AS n FROM contacts WHERE business_id = $1 AND status = 'LEAD'`, R.biz)).toBe(3);
    expect(await n(`SELECT count(*) AS n FROM contacts WHERE business_id = $1 AND status = 'LEAD' AND deleted_at IS NULL`, R.biz)).toBe(2);
    expect(await db.autopilotTask.count({ where: { businessId: R.biz } })).toBe(24);
    const insight = app2.get((await import('../src/modules/key-cortex/key-cortex-insight.service')).KeyCortexInsightService);
    expect(insight.constructor.name).toBe('KeyCortexInsightService');
  });

  it('GET insights/revenue: this month\'s total, count and average from the issued invoices (no draft, void or deleted one), last month\'s total, and the top customers by their real names', async () => {
    const res = await get2('insights/revenue', R.owner, R.biz).query({ period: 'month' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const a = res.body.analysis;
    const previous = INVOICES.filter((i) => i.businessId === R.biz && isRevenue(i) && i.createdAt >= previousStart && i.createdAt < periodStart)
      .reduce((s, i) => s + i.total, 0);
    expect(previous).toBeGreaterThanOrEqual(500);
    expect(a.period).toBe('This Month');
    expect(a.totalRevenue).toBe(2120);
    expect(a.invoiceCount).toBe(4);
    expect(a.averageInvoiceValue).toBe(530);
    expect(a.previousPeriodRevenue).toBe(previous);
    expect(a.growthRate).toBe(Math.round(((2120 - previous) / previous) * 100));
    expect(a.topCustomers).toEqual([
      { id: C.alicia, name: NAME.alicia, revenue: 1520, invoices: 3, avgInvoice: 507 },
      { id: C.maraval, name: NAME.maraval, revenue: 600, invoices: 1, avgInvoice: 600 },
    ]);
    expect(a.revenueByDay.reduce((s: number, d: { amount: number }) => s + d.amount, 0)).toBe(2120);
    const text = JSON.stringify(res.body);
    for (const absent of ['Unknown', NAME.zed, '7777', '9999', '5555', '777']) expect(text).not.toContain(absent);
  });

  it('GET insights/profit: overdue invoices to collect by customer name, the stale lead with its open deal value, the unsold active product, the manual-task count and the repeat buyer, from this business only', async () => {
    const res = await get2('insights/profit', R.owner, R.biz);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(legacyCalls).toEqual([]);
    const opps: any[] = res.body.opportunities;
    const byId = new Map(opps.map((o) => [o.id, o]));
    expect([...byId.keys()].sort()).toEqual([
      `auto-${R.biz}`,
      `inv-${INV.overdueM}`,
      `inv-${INV.sent}`,
      `lead-${C.kerry}`,
      `prod-${PRODUCT.premium}`,
      `upsell-${C.marcus}`,
    ].sort());

    expect(byId.get(`inv-${INV.sent}`)).toMatchObject({
      type: 'overdue_invoice',
      title: `Collect $1,000 from ${NAME.alicia}`,
      estimatedValue: 1000,
      sourceData: { invoiceId: INV.sent, daysOverdue: 10, amount: 1000 },
      priority: 'medium',
    });
    expect(byId.get(`inv-${INV.overdueM}`)).toMatchObject({
      type: 'overdue_invoice',
      title: `Collect $250 from ${NAME.maraval}`,
      estimatedValue: 250,
      sourceData: { invoiceId: INV.overdueM, daysOverdue: 40, amount: 250 },
      priority: 'high',
    });
    expect(byId.get(`lead-${C.kerry}`)).toMatchObject({
      type: 'stale_lead',
      title: `Re-engage ${NAME.kerry} (score: 85)`,
      estimatedValue: 2500,
      sourceData: { contactId: C.kerry, daysStale: 20, score: 85 },
      priority: 'high',
    });
    expect(byId.get(`prod-${PRODUCT.premium}`)).toMatchObject({
      type: 'underutilized_product',
      title: 'Promote "Premium Detailing" — only sold 0 times',
      estimatedValue: 4500,
    });
    expect(byId.get(`auto-${R.biz}`)).toMatchObject({
      type: 'automation_gap',
      title: 'Automate 21 recurring manual tasks',
      estimatedValue: 525,
      sourceData: { manualTaskCount: 21 },
    });
    expect(byId.get(`upsell-${C.marcus}`)).toMatchObject({
      type: 'upsell',
      title: `Upsell ${NAME.marcus} — repeat buyer, 45d since last purchase`,
      estimatedValue: 420,
      sourceData: { contactId: C.marcus, purchaseCount: 2, daysSincePurchase: 45 },
    });
    const text = JSON.stringify(res.body);
    for (const absent of ['Unknown', NAME.zed, NAME.yara, NAME.ghost, NAME.nadia, 'Retired Package', 'Basic Wash', 'Outsider Product', '7777', '9999', '5555', '4444', '9000']) {
      expect(text).not.toContain(absent);
    }
  });

  it('GET insights/churn: each client (CLIENT and the legacy CUSTOMER spelling) with their real name, owed and overdue balance and recovery value; leads, deleted rows and other businesses are not in it', async () => {
    const res = await get2('insights/churn', R.owner, R.biz);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const risks: any[] = res.body.risks;
    expect(res.body.summary).toEqual({ totalAtRisk: 3 });
    const byId = new Map(risks.map((r) => [r.contactId, r]));
    expect([...byId.keys()].sort()).toEqual([C.alicia, C.maraval, C.marcus].sort());
    expect(byId.get(C.alicia)).toMatchObject({
      contactName: NAME.alicia, email: `${P}alicia@test.local`, riskScore: 95, riskLevel: 'critical',
      outstandingBalance: 1120, daysSinceLastInteraction: 999, cancelledBookings: 0,
    });
    expect(byId.get(C.alicia).factors).toContain('$1,000 overdue balance');
    expect(byId.get(C.alicia).estimatedRecoveryValue).toBeCloseTo(456, 6);
    expect(byId.get(C.maraval)).toMatchObject({ contactName: NAME.maraval, riskScore: 95, riskLevel: 'critical', outstandingBalance: 250 });
    expect(byId.get(C.maraval).estimatedRecoveryValue).toBeCloseTo(405, 6);
    expect(byId.get(C.marcus)).toMatchObject({ contactName: NAME.marcus, riskScore: 55, riskLevel: 'high', outstandingBalance: 0, daysSinceLastInteraction: 70 });
    expect(byId.get(C.marcus).estimatedRecoveryValue).toBeCloseTo(195, 6);
    const text = JSON.stringify(res.body);
    for (const absent of ['Unknown', NAME.zed, NAME.kerry, NAME.ghost, '5555', '7777']) expect(text).not.toContain(absent);
  });

  it('GET insights/pipeline: the live leads by pipeline stage with their open deal values (a won deal, a deleted lead and another business left out)', async () => {
    const res = await get2('insights/pipeline', R.owner, R.biz);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = res.body.pipeline;
    expect(p.totalLeads).toBe(2);
    expect(p.totalPipelineValue).toBe(2500);
    const stage = (name: string) => p.stages.find((s: any) => s.name === name);
    expect(stage('new')).toMatchObject({ count: 1, value: 0 });
    expect(stage('qualified')).toMatchObject({ count: 1, value: 2500, avgDaysInStage: 20 });
    expect(p.funnel).toEqual([
      { stage: 'new', count: 1, percentage: 50 },
      { stage: 'qualified', count: 1, percentage: 50 },
    ]);
  });

  it('GET report: the revenue, opportunities, churn, pipeline and cash flow (paid invoices, the upcoming payment by name, the forecast from successful payments) it carries are the real figures, and the narrative falls back without provider traffic', async () => {
    const gatewayFrom = gatewayCalls.length;
    const usageFrom = usageCalls.length;
    const res = await get2('report', R.owner, R.biz).query({ scope: 'monthly' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body;
    expect(r.revenue.totalRevenue).toBe(2120);
    expect(r.revenue.topCustomers.map((c: any) => c.name)).toEqual([NAME.alicia, NAME.maraval]);
    expect(r.opportunities.map((o: any) => o.title)).toContain(`Collect $1,000 from ${NAME.alicia}`);
    expect(r.churnRisks.map((c: any) => c.contactName).sort()).toEqual([NAME.alicia, NAME.maraval, NAME.marcus].sort());
    expect(r.pipeline.totalPipelineValue).toBe(2500);
    // Paid invoices of this business (400 + 600 + 500 + 300 + 350; all rows were written this month).
    expect(r.cashFlow.moneyIn).toBe(2150);
    expect(r.cashFlow.upcomingPaymentsDue).toEqual([
      expect.objectContaining({ id: INV.upcoming, contactName: NAME.alicia, amount: 120 }),
    ]);
    // The forecast projects the SUCCESSFUL payment of the last 30 days (Payment.status vocabulary), not the FAILED one.
    expect(r.cashFlow.forecast.projectedInflow).toBe(400);
    expect(r.narrative).toContain('2,120');
    expect(gatewayCalls.length - gatewayFrom).toBe(1);
    expect(usageCalls.length).toBe(usageFrom);
    const text = JSON.stringify(res.body);
    for (const absent of ['Unknown', NAME.zed, NAME.yara]) expect(text).not.toContain(absent);
  });

  it('BA-04 (W11-CORTEX-INSIGHT-QUERIES repair): the report forecast reads cash received net of refunds (CASH_NET_PAYMENT_WHERE), so refunded money is not projected as inflow', async () => {
    // A 250 payment of which 100 was refunded (D-14: a separate negative REFUNDED row), and a
    // legacy flipped original (positive REFUNDED, net 0 under readStoredPayments). With the
    // 400 SUCCESSFUL payment of the fixture, cash net of refunds over the last 30 days is 550.
    // A SUCCESSFUL-only sum reads 650 (the refund counted as received).
    for (const pay of [
      { id: `${P}r_pay_refundable`, status: 'SUCCESSFUL', amount: 250 },
      { id: `${P}r_pay_refund`, status: 'REFUNDED', amount: -100 },
      { id: `${P}r_pay_legacy_flip`, status: 'REFUNDED', amount: 77 },
    ]) {
      await db.payment.create({
        data: { ...pay, businessId: R.biz, invoiceId: INV.paidA, currency: 'TTD', provider: 'cash', method: 'cash', providerPaymentId: `${P}${pay.id.slice(P.length)}` },
      });
    }
    try {
      const res = await get2('report', R.owner, R.biz).query({ scope: 'monthly' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.cashFlow.forecast.projectedInflow).toBe(550);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM payments WHERE id IN ('${P}r_pay_refundable', '${P}r_pay_refund', '${P}r_pay_legacy_flip')`);
    }
  });

  it.each([
    ['insights/revenue'],
    ['insights/profit'],
    ['insights/churn'],
    ['insights/pipeline'],
    ['report'],
  ])('D-57: GET %s refuses a STAFF member of the business holding revenue none 403, with no customer name or figure', async (route) => {
    const res = await get2(route, R.staffNoRevenue, R.biz);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const text = JSON.stringify(res.body);
    for (const absent of [NAME.alicia, NAME.maraval, NAME.marcus, NAME.kerry, '1,000', '2120', '2500']) expect(text).not.toContain(absent);
  });

  it('D-57: a STAFF member holding revenue read gets the churn and pipeline figures of the business', async () => {
    const churn = await get2('insights/churn', R.staffRevenueRead, R.biz);
    expect(churn.status, JSON.stringify(churn.body)).toBe(200);
    expect(churn.body.risks.map((r: any) => r.contactName).sort()).toEqual([NAME.alicia, NAME.maraval, NAME.marcus].sort());
    const pipeline = await get2('insights/pipeline', R.staffRevenueRead, R.biz);
    expect(pipeline.status, JSON.stringify(pipeline.body)).toBe(200);
    expect(pipeline.body.pipeline.totalPipelineValue).toBe(2500);
  });

  it('the owner of bizX gets bizX\'s own figures and names, and nothing of bizR', async () => {
    const revenue = await get2('insights/revenue', R.xOwner, R.bizX).query({ period: 'month' });
    expect(revenue.status, JSON.stringify(revenue.body)).toBe(200);
    expect(revenue.body.analysis.totalRevenue).toBe(777);
    expect(revenue.body.analysis.topCustomers).toEqual([{ id: C.zed, name: NAME.zed, revenue: 777, invoices: 1, avgInvoice: 777 }]);
    const profit = await get2('insights/profit', R.xOwner, R.bizX);
    expect(profit.status, JSON.stringify(profit.body)).toBe(200);
    const titles = profit.body.opportunities.map((o: any) => o.title);
    expect(titles).toEqual(expect.arrayContaining([
      `Collect $777 from ${NAME.zed}`,
      `Re-engage ${NAME.yara} (score: 95)`,
      'Automate 30 recurring manual tasks',
      'Promote "Outsider Product" — only sold 0 times',
    ]));
    expect(profit.body.opportunities.find((o: any) => o.type === 'stale_lead').estimatedValue).toBe(3333);
    const text = JSON.stringify([revenue.body, profit.body]);
    for (const absent of [NAME.alicia, NAME.maraval, NAME.marcus, NAME.kerry, 'Premium Detailing', '2,500']) expect(text).not.toContain(absent);
  });

  it('D-57 RED-BEFORE (SEC-W11CIQ-1): POST /api/v1/cortex/insights refuses a STAFF member holding revenue none 403 and admits a revenue reader', async () => {
    const refused = await request(app2.getHttpServer())
      .post('/api/v1/cortex/insights')
      .set(HEADER, R.staffNoRevenue)
      .send({ businessId: R.biz, query: 'revenue summary' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    const allowed = await request(app2.getHttpServer())
      .post('/api/v1/cortex/insights')
      .set(HEADER, R.staffRevenueRead)
      .send({ businessId: R.biz, query: 'revenue summary' });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it('CR-W11CIQ-1 RED-BEFORE: GET report cashFlow.moneyOut counts only PAID non-deleted expenses, excluding VOID, BILL, and soft-deleted rows', async () => {
    const today = new Date();
    await db.expense.createMany({
      data: [
        { id: `${P}exp_paid`, businessId: R.biz, description: 'Paid rent', amount: 300, status: 'PAID', date: today },
        { id: `${P}exp_void`, businessId: R.biz, description: 'Voided charge', amount: 900, status: 'VOID', date: today },
        { id: `${P}exp_bill`, businessId: R.biz, description: 'Unpaid bill', amount: 500, status: 'BILL', date: today },
        { id: `${P}exp_del`, businessId: R.biz, description: 'Deleted expense', amount: 700, status: 'PAID', date: today, deletedAt: today },
      ],
    });
    try {
      const res = await get2('report', R.owner, R.biz).query({ scope: 'monthly' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.cashFlow.moneyOut).toBe(300);
      expect(res.body.cashFlow.netFlow).toBe(2150 - 300);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM expenses WHERE business_id = $1`, R.biz);
    }
  });
});

describe('W11-CORTEX-SESSION-SNAPSHOT-SCOPE (KC-SEC-3, D-57, D-100): POST cortex/sessions and POST cortex/chat answer no money figure of the KEY context snapshot to a member without revenue read', () => {
  const S = {
    biz: `${P}bizS`,
    owner: `${P}s_owner`,
    staffNoRevenue: `${P}s_staff_norev`,
    staffRevenueRead: `${P}s_staff_revread`,
    staffDefault: `${P}s_staff_default`, // STAFF, no explicit map: the role's defaults
    adminNoScopes: `${P}s_admin_noscopes`, // ADMIN, an explicit map naming no module (JSON array)
    adminAiOnly: `${P}s_admin_aionly`, // ADMIN, explicit object map { ai: 'write' } omitting revenue
    paid: `${P}s_inv_paid`,
  };
  /** The PAID invoice total the real snapshot sums (keyMetrics.totalRevenue). */
  const PAID_TOTAL = 43219.37;
  /** The money figures the chat pipeline adds to the snapshot from the V2 context (enrichSnapshotFromV2). */
  const OUTSTANDING = 87653.19;
  let app3: any;
  let createdSessions = 0;

  const postSession = (user: string) =>
    request(app3.getHttpServer()).post('/api/v1/cortex/sessions').set(HEADER, user).send({ businessId: S.biz });
  const postChat = (user: string) =>
    request(app3.getHttpServer()).post('/api/v1/cortex/chat').set(HEADER, user).send({ businessId: S.biz, text: 'how are we doing' });

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { ValidationPipe } = await import('@nestjs/common');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
    const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
    const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
    const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
    const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');

    // The snapshot cache always misses, so every snapshot is assembled from the seeded rows.
    const redis = { get: async () => null, set: async () => undefined, del: async () => undefined };
    let context: InstanceType<typeof KeyCortexContextService>;
    const conversation = {
      createSession: async (businessId: string, userId: string) => {
        createdSessions += 1;
        return { id: `${P}s_session_${createdSessions}`, businessId, userId, status: 'active', persona: 'jarvis', messages: [] };
      },
      getSession: async () => null,
    };
    // The chat answer carries the snapshot it used, as KeyCortexQueryPipelineService returns it:
    // the real snapshot, enriched with the V2 commerce figures.
    const reasoning = {
      processQuery: async (q: { businessId: string }) => {
        const snapshot = await context.buildContextSnapshot(q.businessId);
        snapshot.keyMetrics.outstandingRevenue = OUTSTANDING;
        return { message: { role: 'assistant', content: 'v97o chat answer' }, actions: [], contextUsed: snapshot, suggestions: [] };
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [KeyCortexController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        {
          provide: KeyCortexContextService,
          useFactory: (prisma: InstanceType<typeof PrismaService>) => new KeyCortexContextService(prisma, redis as any),
          inject: [PrismaService],
        },
        { provide: KeyCortexConversationService, useValue: conversation },
        { provide: KeyCortexReasoningService, useValue: reasoning },
        { provide: KeyCortexSessionService, useValue: { findSession: async () => null } },
      ],
    })
      .useMocker((token: any) => {
        const name = typeof token === 'function' ? token.name : String(token);
        return OFF_BOUNDARY.has(name) || name === 'KeyCortexContextV2Service' || name === 'KeyCortexInsightService' ? {} : undefined;
      })
      .compile();
    context = moduleRef.get(KeyCortexContextService);

    app3 = moduleRef.createNestApplication();
    app3.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    app3.useGlobalFilters(new GlobalHttpExceptionFilter());
    app3.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app3.init();

    for (const id of [S.owner, S.staffNoRevenue, S.staffRevenueRead, S.staffDefault, S.adminNoScopes, S.adminAiOnly]) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
    }
    await db.business.create({ data: { id: S.biz, name: 'V97O Biz S', ownerId: S.owner } });
    for (const m of [
      { userId: S.owner, businessId: S.biz, role: 'OWNER' },
      // SWP-CENSUS-KEY-B (P109, Ruling B2): POST chat requires ai:write; keep revenue none/read so KC-SEC-3 redaction remains proven.
      { userId: S.staffNoRevenue, businessId: S.biz, role: 'STAFF', permissionScopes: { revenue: 'none', ai: 'write' } },
      { userId: S.staffRevenueRead, businessId: S.biz, role: 'STAFF', permissionScopes: { revenue: 'read', ai: 'write' } },
      { userId: S.staffDefault, businessId: S.biz, role: 'STAFF' },
      // R1-SEC-01: keep adminNoScopes as JSON array [] so POST sessions proves Array.isArray(permissionScopes) does not fall back to ADMIN defaults;
      // use separate adminAiOnly ({ ai: 'write' }) to prove POST chat redacts contextUsed for an ADMIN whose explicit map omits revenue.
      { userId: S.adminNoScopes, businessId: S.biz, role: 'ADMIN', permissionScopes: [] },
      { userId: S.adminAiOnly, businessId: S.biz, role: 'ADMIN', permissionScopes: { ai: 'write' } },
    ]) {
      await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}`, ...m } });
    }
    await db.contact.create({ data: { id: `${P}s_c_client`, businessId: S.biz, firstName: 'Sasha', status: 'CLIENT' } });
    await db.invoice.create({
      data: { id: S.paid, businessId: S.biz, contactId: `${P}s_c_client`, invoiceNumber: `${P}S-1`, total: PAID_TOTAL, subtotal: PAID_TOTAL, status: 'PAID' },
    });
    await db.invoice.create({
      data: { id: `${P}s_inv_sent`, businessId: S.biz, contactId: `${P}s_c_client`, invoiceNumber: `${P}S-2`, total: 50, subtotal: 50, status: 'SENT' },
    });
  }, 180_000);

  afterAll(async () => {
    if (app3) await app3.close();
  });

  const MONEY_KEYS = ['totalRevenue', 'outstandingRevenue'];
  const noMoney = (snapshot: any) => {
    expect(snapshot, 'a snapshot shape still answers').toBeTruthy();
    for (const k of MONEY_KEYS) expect(snapshot.keyMetrics?.[k], `keyMetrics.${k}`).toBeUndefined();
    // SEC review of this packet (finding 2): the count of unpaid invoices is a receivables
    // signal (D-100), withheld as ai-advisor and the business graph withhold overdue counts.
    expect(snapshot, 'pendingInvoices').not.toHaveProperty('pendingInvoices');
    // FU-GENOME-REVENUE-CLASSIFIER (D-233): a finance DNA score is finance, even with no currency.
    expect(Object.keys(snapshot.genomeDna ?? {}), 'genomeDna keys').not.toContain('finance');
    const text = JSON.stringify(snapshot);
    for (const figure of [String(PAID_TOTAL), String(OUTSTANDING)]) expect(text).not.toContain(figure);
  };

  it('fixture sanity (real rows): the real snapshot sums the PAID invoice of bizS', async () => {
    const res = await postSession(S.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.contextSnapshot.keyMetrics.totalRevenue).toBe(PAID_TOTAL);
  });

  it.each([
    ['a STAFF member holding revenue none', S.staffNoRevenue],
    ['an ADMIN whose explicit scope map names no module (revenue none)', S.adminNoScopes],
  ])('KC-SEC-3 RED-BEFORE: POST sessions answers %s the session and its snapshot without totalRevenue or any money figure', async (_label, user) => {
    const res = await postSession(user);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toMatch(new RegExp(`^${P}s_session_`));
    noMoney(res.body.contextSnapshot);
    // The figures that are not money stay (genome, counts, team).
    expect(res.body.contextSnapshot.businessId).toBe(S.biz);
    expect(typeof res.body.contextSnapshot.keyMetrics.openTasks).toBe('number');
  });

  it.each([
    ['the OWNER', S.owner],
    ['a STAFF member holding revenue read', S.staffRevenueRead],
    ['a STAFF member on the role defaults (revenue read)', S.staffDefault],
  ])('KC-SEC-3 control: POST sessions answers %s the snapshot with totalRevenue', async (_label, user) => {
    const res = await postSession(user);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.contextSnapshot.keyMetrics.totalRevenue).toBe(PAID_TOTAL);
    expect(res.body.contextSnapshot.pendingInvoices).toBe(1);
    expect(res.body.contextSnapshot.genomeDna, 'D-233 control').toHaveProperty('finance');
  });

  it('KC-SEC-3 control: a user with no membership is refused and is answered no snapshot', async () => {
    const res = await postSession(ID.nonMember);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(String(PAID_TOTAL));
  });

  it.each([
    ['a STAFF member holding revenue none', S.staffNoRevenue],
    ['an ADMIN whose explicit scope map grants ai write and omits revenue (revenue none)', S.adminAiOnly],
  ])('KC-SEC-3 RED-BEFORE (every other route that returns the snapshot): POST chat answers %s the reply with a contextUsed holding no money figure', async (_label, user) => {
    const res = await postChat(user);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.message.content).toBe('v97o chat answer');
    noMoney(res.body.contextUsed);
  });

  it('KC-SEC-3 (SWP-CENSUS-KEY-B, R1-SEC-01): POST chat refuses an ADMIN whose explicit scope map is [] with 403 ai:write and leaks no money figure', async () => {
    const res = await postChat(S.adminNoScopes);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/ai requires write/i);
    for (const figure of [String(PAID_TOTAL), String(OUTSTANDING)]) expect(body).not.toContain(figure);
  });

  it.each([
    ['the OWNER', S.owner],
    ['a STAFF member holding revenue read', S.staffRevenueRead],
  ])('KC-SEC-3 control: POST chat answers %s the contextUsed with its money figures', async (_label, user) => {
    const res = await postChat(user);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contextUsed.keyMetrics.totalRevenue).toBe(PAID_TOTAL);
    expect(res.body.contextUsed.keyMetrics.outstandingRevenue).toBe(OUTSTANDING);
  });
});
