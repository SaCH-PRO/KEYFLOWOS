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
