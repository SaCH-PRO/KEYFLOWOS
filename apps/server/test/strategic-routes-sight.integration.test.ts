/**
 * FU-STRATEGIC-ROUTES-SIGHT (P0; owner rulings D-100 (a member without revenue read sees no money signal at all), D-234
 * (authorization follows the data's meaning; ambiguity fails closed), D-146 (expenses at expenses read); follow-up of
 * FU-INSIGHTS-SIGHT's security review round 7, OOS-R7-1).
 *
 * StrategicIntelligenceService's answers state money (a revenue forecast, a profitability analysis, pricing advice, and
 * the opportunity, risk, seasonal and weekly-plan scans written by the model from invoice, quote and expense totals), and
 * WorkspaceRecommendationsService's state it too ("Top client ... has generated TTD 4,000"); every member was handed them,
 * behind AuthGuard and BusinessGuard only:
 * - GET .../ai/strategic/revenue-forecast, /profitability, /pricing-advisor (wholly money);
 * - GET .../ai/strategic/seasonal-patterns, /opportunities, /risks, /weekly-plan, /actions (money beside the rest);
 * - GET .../ai/workspace-recommendations?module=...
 *
 * GREEN: the wholly-money routes answer 403 with ModuleScopeGuard's words to a caller without revenue read (and
 * profitability, which states expenses and margins, without expenses read); the mixed routes answer each caller only
 * the items their membership reads (money at revenue read, expenses at expenses read, net profit at both; a SUPER_ADMIN
 * who is no member, none); workspace recommendations for revenue or expenses need that module's read, and each
 * recommendation is read whole. The owner's answers are unchanged.
 *
 * Every row is written on the real database and every read goes through the real route behind its real guards, over the
 * real StrategicIntelligenceService, WorkspaceRecommendationsService and BusinessGraphService. Stand-ins: identity
 * attachment (a middleware reads `x-v72s-user`), the model call (AiUsageService.callAi answers a fixed JSON per feature:
 * no provider is called), and the controller's collaborators no case calls. globalThis.fetch refuses and records every
 * outbound request: none is made.
 *
 * Fixture prefix v72s_ (FU-STRATEGIC-ROUTES-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72s_';
const HEADER = 'x-v72s-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF: crm and operations read, revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF: revenue and expenses read. */
  revenue: `${P}revenue`,
  /** STAFF: revenue read, expenses 'none'. */
  revnoexp: `${P}revnoexp`,
  /** STAFF: expenses read, revenue 'none'. */
  expnorev: `${P}expnorev`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them. */
  root: `${P}root`,
  biz: `${P}biz`,
  other: `${P}other`,
  otherBiz: `${P}biz2`,
  payer: `${P}payer`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'read', team: 'read', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { ...BLIND_SCOPES, revenue: 'read', expenses: 'read' };
const REVENUE_NO_EXPENSES_SCOPES = { ...BLIND_SCOPES, revenue: 'read' };
const EXPENSES_NO_REVENUE_SCOPES = { ...BLIND_SCOPES, expenses: 'read' };

type Reader = 'owner' | 'blind' | 'revenue' | 'revnoexp' | 'expnorev' | 'root';
/** Readers without revenue read. */
const NO_REVENUE: Reader[] = ['blind', 'expnorev', 'root'];

/**
 * What the model answers, per feature. MONEYMARK items state money, EXPMARK items expenses, NETMARK items net profit;
 * SAFEMARK items state neither. Figures (12400, 9800, 5200, 7341, 2400, 900) are money.
 */
const MODEL: Record<string, Record<string, unknown>> = {
  strategic_revenue_forecast: {
    summary: 'MONEYMARK revenue should reach $12,400 TTD next quarter',
    currentMonthlyRun: 4100,
    projectedMonthlyAvg: 4133,
    periods: [{ label: '30 days', projected: 4100, low: 3800, high: 4400 }],
    confidenceLevel: 'medium',
    trend: 'up',
    assumptions: ['SAFEMARK bookings stay steady', 'EXPMARK rent and payroll hold flat'],
    risks: ['SAFEMARK one large client'],
    recommendations: ['SAFEMARK keep following up'],
  },
  strategic_profitability: {
    summary: 'NETMARK gross margin is 38%',
    grossMarginPct: 38,
    totalRevenue: 12400,
    totalExpenses: 7440,
    expenseInsights: ['EXPMARK rent is 40% of costs'],
    recommendations: ['SAFEMARK keep following up'],
  },
  strategic_pricing_advisor: {
    summary: 'MONEYMARK raise prices by $50',
    serviceRecommendations: [{ service: 'Cut', currentPrice: 100, suggestedPrice: 150, rationale: 'SAFEMARK demand is high' }],
    quickWins: ['EXPMARK supplier costs climbing'],
  },
  strategic_seasonal_patterns: {
    summary: 'SAFEMARK Carnival season is busiest',
    peakMonths: ['February'],
    slowMonths: ['September'],
    patterns: [
      { name: 'SAFEMARK Carnival rush', description: 'Bookings double in February' },
      { name: 'Holiday takings', description: 'MONEYMARK December revenue averages $9,800' },
    ],
    recommendations: ['SAFEMARK open more slots in February', 'EXPMARK cut supplier spend in September'],
    monthlyData: [{ monthName: 'February', avgRevenue: 9800, avgBookings: 40, dataPoints: 2 }],
    localFactors: ['SAFEMARK Carnival'],
  },
  strategic_opportunity_scan: {
    summary: 'SAFEMARK several leads have gone quiet',
    opportunities: [
      { title: 'SAFEMARK re-engage cold leads', description: 'Five leads untouched for a month', estimatedValue: 2400 },
      { title: 'MONEYMARK upsell', description: 'Could add $3,000 TTD a year' },
    ],
    quickWins: ['SAFEMARK send a check-in'],
    neglectedLeads: 5,
    pendingQuoteValue: 5200,
    priority: 'high',
    totalPotentialValue: 7600,
    reactivationTargets: [{ name: 'Lead Zero', reason: 'SAFEMARK asked for a call back' }],
    recommendations: ['MONEYMARK chase the $5,200 in quotes', 'SAFEMARK post availability'],
  },
  strategic_risk_scan: {
    summary: 'MONEYMARK $7,341 overdue',
    riskLevel: 'high',
    riskScore: 72,
    risks: [
      { title: 'SAFEMARK cancellations rising', severity: 'medium' },
      { title: 'MONEYMARK overdue cascade', detail: '$7,341 at risk' },
      { title: 'EXPMARK supplier costs climbing' },
    ],
    mitigations: ['SAFEMARK confirm bookings a day ahead'],
    overdueTotal: 7341,
    overdueCount: 2,
    urgentActions: ['MONEYMARK chase invoice 1001'],
    cashFlowHealth: 'watch',
  },
  strategic_weekly_plan: {
    summary: 'SAFEMARK a steady week',
    weekOf: '2026-11-23',
    topPriorities: ['MONEYMARK collect $4,000 from Acme', 'SAFEMARK confirm Tuesday bookings'],
    dailyFocus: [{ day: 'Monday', theme: 'Client outreach', tasks: ['SAFEMARK call two leads', 'MONEYMARK send the $3,341 reminder'] }],
    revenueActions: ['MONEYMARK follow up the quote'],
    clientActions: ['SAFEMARK thank repeat clients'],
    expenseReview: { monthToDate: 900, action: 'EXPMARK review supplier invoices' },
    operationalTasks: ['NETMARK net margin is thin this month', 'SAFEMARK tidy the studio'],
    weeklyGoal: 'SAFEMARK book ten sessions',
  },
};
const FIGURES = ['12,400', '12400', '9,800', '9800', '5200', '5,200', '7,341', '7341', '2400', '4100', '7440'];

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];
const modelCalls: string[] = [];

let db: any;
let http: any;
let graph: any;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('invoices'),
    byBiz('expenses'),
    byBiz('contacts'),
    byBiz('team_activity_logs'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort: a table may not exist on an older schema */
    }
  }
}

async function clearData() {
  for (const table of ['invoices', 'expenses']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)} AND id <> $1`, ID.payer);
  graph.invalidateCache(ID.biz);
  graph.invalidateCache(ID.otherBiz);
}

const DAY = 24 * 60 * 60 * 1000;
/** Five leads created 40 days ago (stale), two overdue invoices (7,341), one paid (4,000: the top client), and 900 of expenses. */
async function seed() {
  for (let i = 0; i < 5; i++) {
    await db.contact.create({ data: { id: `${ID.biz}_lead${i}`, businessId: ID.biz, firstName: 'V72S', lastName: `Lead ${i}`, status: 'LEAD', createdAt: new Date(Date.now() - 40 * DAY) } });
  }
  for (const [n, total] of [[1, 4000], [2, 3341]] as const) {
    await db.invoice.create({
      data: { id: `${ID.payer}_od${n}`, invoiceNumber: `${ID.payer}-od${n}`, businessId: ID.biz, contactId: ID.payer, total, subtotal: total, status: 'SENT', dueDate: new Date(Date.now() - 5 * DAY), currency: 'TTD' },
    });
  }
  await db.invoice.create({
    data: { id: `${ID.payer}_paid`, invoiceNumber: `${ID.payer}-paid`, businessId: ID.biz, contactId: ID.payer, total: 4000, subtotal: 4000, status: 'PAID', paidAt: new Date(), currency: 'TTD' },
  });
  await db.expense.create({ data: { id: `${ID.biz}_exp`, businessId: ID.biz, description: 'V72S supplies', amount: 900, date: new Date() } });
}

const agent = () => request(http.getHttpServer());
let ip = 0;
const nextIp = () => `10.77.${Math.floor((ip += 1) / 250) % 250}.${ip % 250}`;

async function call(reader: Reader, route: string, businessId = ID.biz) {
  return agent().get(`/ai/businesses/${businessId}${route}`).set(HEADER, ID[reader]).set('x-forwarded-for', nextIp());
}
async function ok(reader: Reader, route: string) {
  const res = await call(reader, route);
  expect(res.status, `${reader} ${route}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}
async function refused(reader: Reader, route: string, module: string) {
  const res = await call(reader, route);
  expect(res.status, `${reader} ${route}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(403);
  expect(JSON.stringify(res.body), `${reader} ${route}`).toMatch(new RegExp(`Insufficient permissions: ${module} requires read access \\(you have \\w+\\)`));
  return res.body;
}
const text = (x: unknown) => JSON.stringify(x);
const moneyIn = (x: unknown) => ['MONEYMARK', 'NETMARK', ...FIGURES].filter((marker) => text(x).includes(marker));
const expenseIn = (x: unknown) => ['EXPMARK', 'NETMARK', 'expenseReview', '7440'].filter((marker) => text(x).includes(marker));

const MIXED = ['/ai/strategic/seasonal-patterns', '/ai/strategic/opportunities', '/ai/strategic/risks', '/ai/strategic/weekly-plan'];
const MODEL_OF: Record<string, string> = {
  '/ai/strategic/revenue-forecast': 'strategic_revenue_forecast',
  '/ai/strategic/profitability': 'strategic_profitability',
  '/ai/strategic/pricing-advisor': 'strategic_pricing_advisor',
  '/ai/strategic/seasonal-patterns': 'strategic_seasonal_patterns',
  '/ai/strategic/opportunities': 'strategic_opportunity_scan',
  '/ai/strategic/risks': 'strategic_risk_scan',
  '/ai/strategic/weekly-plan': 'strategic_weekly_plan',
};

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v72s: no outbound traffic in this suite');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { StrategicIntelligenceService } = await import('../src/modules/ai/strategic-intelligence.service');
  const { WorkspaceRecommendationsService } = await import('../src/modules/ai/workspace-recommendations.service');

  const prisma = new PrismaService();
  graph = new BusinessGraphService(prisma);
  const aiUsage = {
    callAi: async (opts: { feature: string }) => {
      modelCalls.push(opts.feature);
      const answer = MODEL[opts.feature];
      if (!answer) throw new Error(`v72s: no model answer for ${opts.feature}`);
      return { content: JSON.stringify(answer) };
    },
  };
  const strategic = new StrategicIntelligenceService(prisma, aiUsage as any, graph);
  const workspaceRecs = new WorkspaceRecommendationsService(graph, prisma);

  const OFF_ROUTE = new Set([
    'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'AiOversightService',
    'IntentParserService', 'PlannerService', 'ProfileIntelligenceService', 'ProAutoMonitorService',
    'ProactiveSuggestionService', 'AiMemoryService', 'ModelGatewayService', 'KeyCommandService',
    'AutopilotRulesService', 'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService',
    'UnifiedInboxService', 'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService',
    'CapacityInsightService', 'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService',
    'WorkflowTemplateService', 'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
  ]);
  const testing = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: BusinessGraphService, useValue: graph },
      { provide: StrategicIntelligenceService, useValue: strategic },
      { provide: WorkspaceRecommendationsService, useValue: workspaceRecs },
    ],
  })
    .useMocker((token: any) => (OFF_ROUTE.has(typeof token === 'function' ? token.name : String(token)) ? {} : undefined))
    .compile();
  http = testing.createNestApplication();
  http.getHttpAdapter().getInstance().set('trust proxy', true);
  http.use(async (req: any, _res: any, next: any) => {
    const id = req.headers[HEADER];
    if (typeof id === 'string' && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  http.useGlobalInterceptors(new TenantInterceptor(prisma));
  http.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  http.useGlobalFilters(new GlobalHttpExceptionFilter());
  await http.init();

  await cleanup();
  for (const [id, role] of [
    [ID.owner, 'USER'], [ID.blind, 'USER'], [ID.revenue, 'USER'], [ID.revnoexp, 'USER'], [ID.expnorev, 'USER'],
    [ID.root, 'SUPER_ADMIN'], [ID.other, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V72S Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V72S Other', slug: `${P}biz2`, ownerId: ID.other, currency: 'TTD' } });
  for (const [userId, businessId, role, extra] of [
    [ID.owner, ID.biz, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, ID.biz, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, ID.biz, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.revnoexp, ID.biz, 'STAFF', { permissionScopes: REVENUE_NO_EXPENSES_SCOPES, maxApprovalTier: 0 }],
    [ID.expnorev, ID.biz, 'STAFF', { permissionScopes: EXPENSES_NO_REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.other, ID.otherBiz, 'OWNER', { maxApprovalTier: 4 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId, role, ...extra } });
  }
  await db.contact.create({ data: { id: ID.payer, businessId: ID.biz, firstName: 'V72S', lastName: 'Payer', status: 'CUSTOMER' } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

describe('FU-STRATEGIC-ROUTES-SIGHT (D-100, D-234, D-146): the strategic routes and workspace recommendations answer money only at revenue read and expenses only at expenses read', () => {
  it('V72S-01 RED: the revenue forecast and pricing advice answer 403 with ModuleScopeGuard\'s words to every caller without revenue read (the memberless SUPER_ADMIN too); the owner and the revenue reader get them', async () => {
    for (const route of ['/ai/strategic/revenue-forecast', '/ai/strategic/pricing-advisor']) {
      for (const reader of NO_REVENUE) await refused(reader, route, 'revenue');
      for (const reader of ['owner', 'revenue'] as Reader[]) expect(await ok(reader, route), `${reader} ${route}`).toEqual(MODEL[MODEL_OF[route]]);
    }
  }, 300_000);

  it('V72S-02 RED: profitability (revenue, expenses and margins) answers 403 without revenue read, and without expenses read; the owner and the revenue-and-expenses reader get it whole', async () => {
    const route = '/ai/strategic/profitability';
    for (const reader of NO_REVENUE) await refused(reader, route, 'revenue');
    await refused('revnoexp', route, 'expenses');
    for (const reader of ['owner', 'revenue'] as Reader[]) expect(await ok(reader, route), reader).toEqual(MODEL.strategic_profitability);
  }, 300_000);

  it('V72S-03 RED: the forecast and pricing advice keep revenue for a revenue reader without expenses read, and withhold expense items', async () => {
    const forecast = await ok('revnoexp', '/ai/strategic/revenue-forecast');
    expect(text(forecast)).toContain('MONEYMARK revenue should reach');
    expect(forecast.currentMonthlyRun).toBe(4100);
    expect(expenseIn(forecast)).toEqual([]);
    expect(forecast.assumptions).toEqual(['SAFEMARK bookings stay steady']);
    const pricing = await ok('revnoexp', '/ai/strategic/pricing-advisor');
    expect(text(pricing)).toContain('MONEYMARK raise prices');
    expect(expenseIn(pricing)).toEqual([]);
  }, 300_000);

  it('V72S-04 RED: the seasonal, opportunity, risk and weekly-plan scans answer no money, expense or net-profit item and no money figure to a caller without revenue read; their other items reach them', async () => {
    const leaks: Record<string, string[]> = {};
    for (const reader of NO_REVENUE) {
      for (const route of MIXED) {
        const body = await ok(reader, route);
        // The expenses-only member may read expense items; no other caller here may.
        const found = [...moneyIn(body), ...(reader === 'expnorev' ? [] : expenseIn(body))];
        const keys = ['peakMonths', 'slowMonths', 'monthlyData', 'pendingQuoteValue', 'totalPotentialValue', 'overdueTotal', 'overdueCount', 'riskScore', 'riskLevel', 'cashFlowHealth', 'revenueActions', 'estimatedValue'];
        for (const key of reader === 'expnorev' ? keys : [...keys, 'expenseReview']) {
          if (text(body).includes(`"${key}"`)) found.push(key);
        }
        if (found.length) leaks[`${reader} ${route}`] = found;
        expect(text(body), `${reader} ${route} keeps its other items`).toContain('SAFEMARK');
      }
    }
    expect(leaks).toEqual({});
    const plan = await ok('blind', '/ai/strategic/weekly-plan');
    expect(plan.dailyFocus).toEqual([{ day: 'Monday', theme: 'Client outreach', tasks: ['SAFEMARK call two leads'] }]);
    expect(plan.topPriorities).toEqual(['SAFEMARK confirm Tuesday bookings']);
    const opportunities = await ok('blind', '/ai/strategic/opportunities');
    expect(opportunities.neglectedLeads, 'the lead count is no money').toBe(5);
    expect(opportunities.opportunities).toEqual([{ title: 'SAFEMARK re-engage cold leads', description: 'Five leads untouched for a month' }]);
    const risks = await ok('blind', '/ai/strategic/risks');
    expect(risks.risks).toEqual([{ title: 'SAFEMARK cancellations rising', severity: 'medium' }]);
    expect(outbound, 'no outbound request').toEqual([]);
  }, 300_000);

  it('V72S-05 RED: a revenue reader without expenses read gets the money items of the mixed scans and no expense or net-profit item', async () => {
    for (const route of MIXED) {
      const body = await ok('revnoexp', route);
      expect(expenseIn(body), route).toEqual([]);
    }
    expect(text(await ok('revnoexp', '/ai/strategic/risks'))).toContain('MONEYMARK overdue cascade');
    const plan = await ok('revnoexp', '/ai/strategic/weekly-plan');
    expect(plan.revenueActions).toEqual(['MONEYMARK follow up the quote']);
    expect(plan.operationalTasks).toEqual(['SAFEMARK tidy the studio']);
  }, 300_000);

  it('V72S-06 (owner parity): the owner and the revenue-and-expenses reader get every scan exactly as the model answered it', async () => {
    for (const reader of ['owner', 'revenue'] as Reader[]) {
      for (const route of MIXED) expect(await ok(reader, route), `${reader} ${route}`).toEqual(MODEL[MODEL_OF[route]]);
    }
  }, 300_000);

  it('V72S-07 RED: strategic actions: the overdue collection and the quote follow-up (money) reach only revenue readers; the stale-lead action reaches every member', async () => {
    await clearData();
    try {
      await seed();
      const owner = (await ok('owner', '/ai/strategic/actions')).actions;
      expect(owner.map((a: any) => a.type)).toEqual(expect.arrayContaining(['collect_overdue', 're_engage_leads']));
      expect(owner.find((a: any) => a.type === 'collect_overdue').estimatedValue).toBe(7341);
      for (const reader of NO_REVENUE) {
        const body = await ok(reader, '/ai/strategic/actions');
        expect(body.actions.map((a: any) => a.type), reader).toContain('re_engage_leads');
        expect(body.actions.map((a: any) => a.type), reader).not.toContain('collect_overdue');
        expect(moneyIn(body), reader).toEqual([]);
        expect(text(body), reader).not.toContain('estimatedValue');
      }
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72S-08 RED: workspace recommendations: revenue needs revenue read and expenses needs expenses read (403, ModuleScopeGuard\'s words); in any module a recommendation stating money (the top client\'s takings) reaches only revenue readers', async () => {
    await clearData();
    try {
      await seed();
      for (const reader of NO_REVENUE) await refused(reader, '/ai/workspace-recommendations?module=revenue', 'revenue');
      for (const reader of ['blind', 'revnoexp', 'root'] as Reader[]) await refused(reader, '/ai/workspace-recommendations?module=expenses', 'expenses');
      await ok('owner', '/ai/workspace-recommendations?module=revenue');
      await ok('expnorev', '/ai/workspace-recommendations?module=expenses');
      const ownerCrm = await ok('owner', '/ai/workspace-recommendations?module=crm');
      expect(ownerCrm.map((r: any) => r.id), 'control').toContain('crm-top-client');
      for (const reader of NO_REVENUE) {
        const recs = await ok(reader, '/ai/workspace-recommendations?module=crm');
        expect(recs.map((r: any) => r.id), reader).not.toContain('crm-top-client');
        expect(text(recs), reader).not.toContain('4,000');
      }
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72S-09 (cross-tenant, unchanged): another business\'s owner is refused every route here, and the owner here reads their own', async () => {
    for (const route of [...Object.keys(MODEL_OF), '/ai/strategic/actions', '/ai/workspace-recommendations?module=crm']) {
      const res = await agent().get(`/ai/businesses/${ID.biz}${route}`).set(HEADER, ID.other).set('x-forwarded-for', nextIp());
      expect(res.status, route).toBe(403);
    }
    expect(modelCalls.length).toBeGreaterThan(0);
  }, 300_000);
});
