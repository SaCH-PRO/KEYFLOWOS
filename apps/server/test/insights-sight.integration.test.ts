/**
 * FU-INSIGHTS-SIGHT (P0; owner rulings D-100 (a member without revenue read sees no money signal at all), D-234
 * (authorization follows the data's meaning; ambiguity fails closed), D-146 (expenses at expenses read); follow-up of
 * FU-PATTERNS-ROUTES-SIGHT's security review round 8, F-1).
 *
 * ProAutoMonitorService's insights state money ("2 overdue invoices ($7,341 TTD)", "Expenses at 90% of monthly
 * revenue"), and every member was handed them, behind AuthGuard and BusinessGuard only:
 * - GET .../ai/monitoring/insights (the insights as scanned);
 * - GET .../ai/suggestions and POST .../ai/suggestions/refresh (ProactiveSuggestionService: each actionable insight
 *   stored as an AiMemory 'suggestion' row and answered back);
 * - GET .../ai/control-tower (the insights, plus the strategic dashboard's money fields and the shared snapshot's
 *   revenue and expenses sections);
 * - and GET .../ai/strategic/dashboard (the same dashboard the control tower embeds).
 *
 * GREEN: each insight carries the sights it needs, decided where it is produced (its category, and the money and
 * expense text rule; an unknown category needs both), and each route answers the caller only the insights, stored
 * suggestions, dashboard fields and snapshot sections their membership reads (revenue read for money, expenses read for
 * expenses; a SUPER_ADMIN who is no member, none). The owner's responses keep every figure.
 *
 * Every row is written on the real database and every read goes through the real route behind its real guards, over the
 * real ProAutoMonitorService, ProactiveSuggestionService, StrategicIntelligenceService and BusinessGraphService.
 * Stand-ins: identity attachment (a middleware reads `x-v72q-user`), the oversight settings (Pro Auto mode), and the
 * controllers' collaborators no case calls. globalThis.fetch refuses and records every outbound request: none is made.
 *
 * Fixture prefix v72q_ (FU-INSIGHTS-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72q_';
const HEADER = 'x-v72q-user';

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
  /** STAFF: revenue and expenses read, operations 'none' (the approval list's own gate). */
  noops: `${P}noops`,
  biz: `${P}biz`,
  other: `${P}other`,
  otherBiz: `${P}biz2`,
  payer: `${P}payer`,
  otherPayer: `${P}payer2`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'read', team: 'read', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { ...BLIND_SCOPES, revenue: 'read', expenses: 'read' };
const REVENUE_NO_EXPENSES_SCOPES = { ...BLIND_SCOPES, revenue: 'read' };
const EXPENSES_NO_REVENUE_SCOPES = { ...BLIND_SCOPES, expenses: 'read' };
const NO_OPERATIONS_SCOPES = { ...REVENUE_SCOPES, operations: 'none' };

type Reader = 'owner' | 'blind' | 'revenue' | 'revnoexp' | 'expnorev' | 'root' | 'noops';
const BLIND: Reader[] = ['blind', 'root'];

/** The overdue total (4,000 + 3,341), the month's paid revenue and expenses (cost pressure: 900 of 1,000). */
const OVERDUE = '7,341';
const OTHER_OVERDUE = '9,157';
/** What only a money or expense insight, suggestion, dashboard field or section carries. */
const MONEY_MARKERS = [OVERDUE, 'overdue_invoices', 'cost_pressure', 'Expenses at', 'past-due invoice', 'monthlyRevenue', 'overdueAmount', 'pendingQuoteValue', 'expensesThisMonth', 'outstandingRevenue'];
const STALE = 'stale lead';

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let http: any;
let monitor: any;
let graph: any;
let financialProposal: (p: any) => boolean;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('ai_approval_items'),
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

/** Removes the business data the insights are made of (members stay), and the monitor's per-business cache. */
async function clearData() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'ai_approval_items', 'invoices', 'expenses']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)} AND id NOT IN ($1, $2)`, ID.payer, ID.otherPayer);
  monitor.insightCache.clear();
  // The business graph caches the full snapshot per business; the control tower reads it unforced.
  graph.invalidateCache(ID.biz);
  graph.invalidateCache(ID.otherBiz);
}

const DAY = 24 * 60 * 60 * 1000;
/** Five stale leads (a warning, so it becomes a suggestion too): the insight every member may read. */
async function seedStaleLeads(businessId = ID.biz) {
  for (let i = 0; i < 5; i++) {
    const id = `${businessId}_lead${i}`;
    await db.contact.create({ data: { id, businessId, firstName: 'V72Q', lastName: `Lead ${i}`, status: 'LEAD' } });
  }
  await db.$executeRawUnsafe(`UPDATE contacts SET updated_at = now() - interval '10 days' WHERE business_id = $1 AND status = 'LEAD'`, businessId);
}

/** Two overdue invoices totalling 7,341 (critical), and the month's 1,000 paid against 900 of expenses (cost pressure). */
async function seedMoney(businessId = ID.biz, contactId = ID.payer, a = 4000, b = 3341) {
  for (const [n, total] of [[1, a], [2, b]] as const) {
    await db.invoice.create({
      data: { id: `${contactId}_od${n}`, invoiceNumber: `${contactId}-od${n}`, businessId, contactId, total, subtotal: total, status: 'SENT', dueDate: new Date(Date.now() - 5 * DAY), currency: 'TTD' },
    });
  }
  await db.invoice.create({
    data: { id: `${contactId}_paid`, invoiceNumber: `${contactId}-paid`, businessId, contactId, total: 1000, subtotal: 1000, status: 'PAID', paidAt: new Date(), currency: 'TTD' },
  });
  await db.expense.create({ data: { id: `${businessId}_exp`, businessId, description: 'V72Q supplies', amount: 900, date: new Date() } });
}

const agent = () => request(http.getHttpServer());
let ip = 0;
const nextIp = () => `10.75.${Math.floor((ip += 1) / 250) % 250}.${ip % 250}`;

async function call(method: 'get' | 'post', reader: Reader | string, route: string, businessId = ID.biz) {
  const who = reader in ID ? (ID as any)[reader] : reader;
  return agent()[method](`/ai/businesses/${businessId}${route}`).set(HEADER, who).set('x-forwarded-for', nextIp());
}
async function ok(method: 'get' | 'post', reader: Reader, route: string) {
  const res = await call(method, reader, route);
  expect(res.status, `${reader} ${route}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(method === 'get' ? 200 : 201);
  return res.body;
}
const text = (x: unknown) => JSON.stringify(x);
const moneyIn = (x: unknown) => MONEY_MARKERS.filter((marker) => text(x).includes(marker));

/** Every route under test, read by `reader` (the refresh first, so its suggestions are stored for the GET). */
async function everythingFor(reader: Reader) {
  return {
    insights: await ok('get', reader, '/ai/monitoring/insights'),
    refresh: await ok('post', reader, '/ai/suggestions/refresh'),
    suggestions: await ok('get', reader, '/ai/suggestions'),
    tower: await ok('get', reader, '/ai/control-tower'),
    dashboard: await ok('get', reader, '/ai/strategic/dashboard'),
  };
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v72q: no outbound traffic in this suite');
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
  const { ProAutoMonitorService } = await import('../src/modules/ai/pro-auto-monitor.service');
  const { ProactiveSuggestionService } = await import('../src/modules/ai/proactive-suggestion.service');
  const { StrategicIntelligenceService } = await import('../src/modules/ai/strategic-intelligence.service');
  const { isFinancialProposal } = await import('../src/modules/business-genome/key-genome/genome-finance-scope');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  financialProposal = isFinancialProposal as any;

  const prisma = new PrismaService();
  graph = new BusinessGraphService(prisma);
  const governance = { getAutonomySettings: async () => ({ mode: 'pro_auto', maxAutoTier: 1 }) };
  monitor = new ProAutoMonitorService(prisma, graph, governance as any, { logToolExecution: async () => undefined } as any, {} as any);
  const suggestions = new ProactiveSuggestionService(prisma, monitor, governance as any, new EventEmitter2());
  const strategic = new StrategicIntelligenceService(prisma, {} as any, graph);
  const memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any);

  const OFF_ROUTE = new Set([
    'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'AiOversightService',
    'IntentParserService', 'PlannerService', 'ProfileIntelligenceService',
    'WorkspaceRecommendationsService', 'ModelGatewayService', 'KeyCommandService',
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
      { provide: ProAutoMonitorService, useValue: monitor },
      { provide: ProactiveSuggestionService, useValue: suggestions },
      { provide: StrategicIntelligenceService, useValue: strategic },
      { provide: AiMemoryService, useValue: memory },
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
    [ID.root, 'SUPER_ADMIN'], [ID.noops, 'USER'], [ID.other, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V72Q Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V72Q Other', slug: `${P}biz2`, ownerId: ID.other, currency: 'TTD' } });
  for (const [userId, businessId, role, extra] of [
    [ID.owner, ID.biz, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, ID.biz, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, ID.biz, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.revnoexp, ID.biz, 'STAFF', { permissionScopes: REVENUE_NO_EXPENSES_SCOPES, maxApprovalTier: 0 }],
    [ID.expnorev, ID.biz, 'STAFF', { permissionScopes: EXPENSES_NO_REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.noops, ID.biz, 'STAFF', { permissionScopes: NO_OPERATIONS_SCOPES, maxApprovalTier: 0 }],
    [ID.other, ID.otherBiz, 'OWNER', { maxApprovalTier: 4 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId, role, ...extra } });
  }
  await db.contact.create({ data: { id: ID.payer, businessId: ID.biz, firstName: 'V72Q', lastName: 'Payer', status: 'CUSTOMER' } });
  await db.contact.create({ data: { id: ID.otherPayer, businessId: ID.otherBiz, firstName: 'V72Q', lastName: 'Other payer', status: 'CUSTOMER' } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

describe('FU-INSIGHTS-SIGHT (D-100, D-234, D-146): monitoring insights, suggestions, the control tower and the strategic dashboard answer money only at revenue read and expenses only at expenses read', () => {
  it('V72Q-01 RED: the overdue total, the cost pressure and the dashboard money reach the owner and the revenue reader on every route, and neither the revenue-none STAFF member nor the memberless SUPER_ADMIN; the stale-lead insight reaches them all', async () => {
    await clearData();
    try {
      await seedStaleLeads();
      await seedMoney();
      const leaks: Record<string, string[]> = {};
      for (const reader of BLIND) {
        for (const [route, body] of Object.entries(await everythingFor(reader))) {
          const found = moneyIn(body);
          if (found.length) leaks[`${reader} ${route}`] = found;
        }
        monitor.insightCache.clear();
      }
      expect(leaks).toEqual({});
      for (const reader of ['owner', 'revenue'] as Reader[]) {
        const seen = await everythingFor(reader);
        expect(text(seen.insights), `${reader} insights`).toContain(OVERDUE);
        expect(text(seen.insights), `${reader} insights`).toContain('cost_pressure');
        expect(text(seen.tower), `${reader} tower`).toContain('overdueAmount');
        expect(seen.dashboard.overdueAmount, `${reader} dashboard`).toBe(7341);
        expect(seen.tower.modules.revenue, `${reader} tower revenue section`).toBeTruthy();
      }
      // Control: the non-money insight reaches the blind readers.
      monitor.insightCache.clear();
      for (const reader of BLIND) expect(text(await ok('get', reader, '/ai/monitoring/insights')), reader).toContain(STALE);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72Q-02 RED: revenue and expenses apart: the revenue-only member gets the overdue insight and not the cost pressure (it states the month\'s expenses); the expenses-only member gets neither (the cost pressure states revenue too) and no overdue figure', async () => {
    await clearData();
    try {
      await seedStaleLeads();
      await seedMoney();
      const revnoexp = await ok('get', 'revnoexp', '/ai/monitoring/insights');
      expect(text(revnoexp)).toContain(OVERDUE);
      expect(text(revnoexp)).not.toContain('cost_pressure');
      const expnorev = await ok('get', 'expnorev', '/ai/monitoring/insights');
      expect(moneyIn(expnorev)).toEqual([]);
      expect(text(expnorev)).toContain(STALE);
      const towerRevNoExp = await ok('get', 'revnoexp', '/ai/control-tower');
      expect(towerRevNoExp.modules.revenue, 'revenue section at revenue read').toBeTruthy();
      expect(towerRevNoExp.modules.expenses, 'no expenses section without expenses read').toBeFalsy();
      expect(towerRevNoExp.dashboard.expensesThisMonth ?? null).toBeNull();
      const towerExpNoRev = await ok('get', 'expnorev', '/ai/control-tower');
      expect(towerExpNoRev.modules.expenses, 'expenses section at expenses read').toBeTruthy();
      expect(towerExpNoRev.modules.revenue, 'no revenue section without revenue read').toBeFalsy();
      expect(towerExpNoRev.dashboard.expensesThisMonth).toBe(900);
      expect(towerExpNoRev.dashboard.overdueAmount ?? null).toBeNull();
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72Q-03 RED: a suggestion stored by the owner\'s refresh is answered to the revenue-none member neither on GET .../ai/suggestions nor on GET .../ai/memory?category=suggestion; the stale-lead suggestion is (control)', async () => {
    await clearData();
    try {
      await seedStaleLeads();
      await seedMoney();
      const owner = await ok('post', 'owner', '/ai/suggestions/refresh');
      expect(text(owner), 'owner control').toContain('overdue_invoices');
      const stored = await db.aiMemory.findMany({ where: { businessId: ID.biz, category: 'suggestion' } });
      expect(stored.length, 'premise: the refresh stored the suggestions').toBeGreaterThanOrEqual(2);
      const blind = await ok('get', 'blind', '/ai/suggestions');
      expect(moneyIn(blind)).toEqual([]);
      expect(text(blind)).toContain('stale_leads');
      expect(moneyIn(await ok('get', 'root', '/ai/suggestions'))).toEqual([]);
      // Correctness review round 1 (F-4): the stored row is withheld on the AiMemory read too (its stamp words).
      for (const reader of BLIND) {
        const rows = await ok('get', reader, '/ai/memory?category=suggestion');
        expect(moneyIn(rows), reader).toEqual([]);
        expect(text(rows), `${reader} control`).toContain('stale_leads');
      }
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72Q-04 differential: the revenue-none member and the memberless SUPER_ADMIN get the same insights and suggestions whether the business holds money or not', async () => {
    await clearData();
    try {
      await seedStaleLeads();
      const read = async (reader: Reader) => {
        monitor.insightCache.clear();
        const insights = (await ok('get', reader, '/ai/monitoring/insights')).insights.map((i: any) => [i.category, i.title, i.description]);
        const suggestions = (await ok('get', reader, '/ai/suggestions')).map((s: any) => [s.category, s.title, s.message]);
        return { insights, suggestions };
      };
      await ok('post', 'owner', '/ai/suggestions/refresh');
      const before: Record<string, unknown> = {};
      for (const reader of BLIND) before[reader] = await read(reader);
      await seedMoney();
      monitor.insightCache.clear();
      await db.aiMemory.deleteMany({ where: { businessId: ID.biz, category: 'suggestion' } });
      await ok('post', 'owner', '/ai/suggestions/refresh');
      for (const reader of BLIND) expect(await read(reader), reader).toEqual(before[reader]);
    } finally {
      await clearData();
    }
  }, 300_000);

  it("V72Q-05 owner parity: the owner's insights are the scan's, and the owner's dashboard is the service's, unchanged", async () => {
    await clearData();
    try {
      await seedStaleLeads();
      await seedMoney();
      monitor.insightCache.clear();
      const scanned = JSON.parse(JSON.stringify(await monitor.scanInsights(ID.biz)));
      const answered = (await ok('get', 'owner', '/ai/monitoring/insights')).insights;
      expect(answered.map((i: any) => [i.category, i.title, i.description, i.metric])).toEqual(scanned.map((i: any) => [i.category, i.title, i.description, i.metric]));
      const dashboard = await ok('get', 'owner', '/ai/strategic/dashboard');
      for (const field of ['monthlyRevenue', 'outstandingRevenue', 'overdueInvoices', 'overdueAmount', 'pendingQuotes', 'pendingQuoteValue', 'expensesThisMonth']) {
        expect(dashboard[field], field).toEqual(expect.any(Number));
      }
      expect(dashboard.overdueAmount).toBe(7341);
    } finally {
      await clearData();
    }
  }, 300_000);

  it("V72Q-06 cross-tenant: another business's overdue total never reaches this business's owner, and a member of this business is refused the other business's routes identically whether it holds money or not", async () => {
    await clearData();
    try {
      const routes: Array<['get' | 'post', string]> = [['get', '/ai/monitoring/insights'], ['get', '/ai/suggestions'], ['get', '/ai/control-tower'], ['get', '/ai/strategic/dashboard']];
      const refused = async () => {
        const out: unknown[] = [];
        for (const [method, route] of routes) {
          const res = await call(method, 'revenue', route, ID.otherBiz);
          out.push([res.status, { ...res.body, timestamp: '<ts>' }]);
        }
        return out;
      };
      const before = await refused();
      await seedMoney(ID.otherBiz, ID.otherPayer, 5000, 4157);
      monitor.insightCache.clear();
      expect(await refused()).toEqual(before);
      expect((before[0] as any)[0]).toBe(403);
      await seedMoney();
      const owner = await everythingFor('owner');
      expect(text(owner)).not.toContain(OTHER_OVERDUE);
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72Q-07 (verification, D-238): a monitoring insight escalated as a KEY action proposal (PRO_AUTO, its title and summary the insight\'s) is classified financial, so the proposal reads withhold it from a member without revenue read', async () => {
    await clearData();
    try {
      await seedMoney();
      monitor.insightCache.clear();
      const insights = await monitor.scanInsights(ID.biz);
      for (const category of ['overdue_invoices', 'cost_pressure']) {
        const insight = insights.find((i: any) => i.category === category);
        expect(insight, category).toBeTruthy();
        const proposal = {
          sourceType: 'PRO_AUTO', sourceMode: 'monitoring', actionType: 'EXECUTE_TOOL', module: 'monitoring',
          toolName: insight.suggestedTool ?? `monitoring_${insight.category}`, title: insight.title, summary: insight.description,
          payload: { category: insight.category, severity: insight.severity, suggestedTool: insight.suggestedTool, suggestedAction: insight.suggestedAction },
        };
        expect(financialProposal(proposal), category).toBe(true);
      }
    } finally {
      await clearData();
    }
  }, 300_000);

  it("V72Q-08 RED (security review round 1, ISS-1): the control tower's pending approvals: a money-bearing item reaches neither the revenue-none member nor the memberless SUPER_ADMIN, an expense-bearing one not the revenue-only member, and a member without operations read (the approval list's gate) gets none; the count follows what is shown", async () => {
    await clearData();
    try {
      const item = (id: string, title: string, description: string) =>
        db.aiApprovalItem.create({ data: { id: `${P}${id}`, businessId: ID.biz, toolName: 'draft_followup_message', title, description, status: 'pending', riskTier: 2 } });
      await item('appr_money', 'Drive intake: Create invoice for Acme (TTD 4,567.00) from x.pdf', 'Create invoice and record payment');
      await item('appr_expense', 'Record the landlord rent', 'Monthly rent to the landlord');
      await item('appr_plain', 'V72Q-PLAIN follow up with three leads', 'Send a friendly follow-up');
      const approvals = (tower: any) => tower.priorities.filter((p: any) => p.type === 'approval').map((p: any) => p.title);
      const blind = await ok('get', 'blind', '/ai/control-tower');
      expect(approvals(blind)).toEqual(['V72Q-PLAIN follow up with three leads']);
      expect(blind.pendingApprovals).toBe(1);
      // The memberless SUPER_ADMIN reads no module here (readersModuleSight, as every read of this packet), so no
      // approval item at all, the plain one included.
      const root = await ok('get', 'root', '/ai/control-tower');
      expect(approvals(root)).toEqual([]);
      expect(root.pendingApprovals).toBe(0);
      const revnoexp = await ok('get', 'revnoexp', '/ai/control-tower');
      expect(approvals(revnoexp).sort()).toEqual(['Drive intake: Create invoice for Acme (TTD 4,567.00) from x.pdf', 'V72Q-PLAIN follow up with three leads'].sort());
      const noops = await ok('get', 'noops', '/ai/control-tower');
      expect(approvals(noops)).toEqual([]);
      expect(noops.pendingApprovals).toBe(0);
      const owner = await ok('get', 'owner', '/ai/control-tower');
      expect(approvals(owner)).toHaveLength(3);
      expect(owner.pendingApprovals).toBe(3);
    } finally {
      await clearData();
    }
  }, 300_000);

  it("V72Q-09 RED (correctness review round 1, F-1): the owner's control tower carries no treasury section or alert (the shared projection, as before: treasury, pipeline and support are KEY's standing context's), with unpaid bills over ledger cash", async () => {
    await clearData();
    try {
      await seedStaleLeads();
      await db.expense.create({ data: { id: `${ID.biz}_bill`, businessId: ID.biz, description: 'V72Q unpaid bill', amount: 5000, status: 'BILL', date: new Date() } });
      graph.invalidateCache(ID.biz);
      const tower = await ok('get', 'owner', '/ai/control-tower');
      expect(tower.snapshot.healthIndicators.filter((h: any) => h.area === 'treasury'), text(tower.snapshot.healthIndicators)).toEqual([]);
      expect(tower.priorities.filter((p: any) => p.module === 'treasury')).toEqual([]);
      expect(tower.risks.filter((r: any) => r.module === 'treasury')).toEqual([]);
    } finally {
      await clearData();
    }
  }, 300_000);

  it('V72Q-10 RED (reviews round 1, ISS-2 / F-2): a second refresh within the cooldown stores no second suggestion for a category already suggested', async () => {
    await clearData();
    try {
      await seedStaleLeads();
      await seedMoney();
      await ok('post', 'owner', '/ai/suggestions/refresh');
      const first = await db.aiMemory.count({ where: { businessId: ID.biz, category: 'suggestion' } });
      expect(first, 'premise').toBeGreaterThanOrEqual(2);
      monitor.insightCache.clear();
      const again = await ok('post', 'owner', '/ai/suggestions/refresh');
      expect(again.count).toBe(0);
      expect(await db.aiMemory.count({ where: { businessId: ID.biz, category: 'suggestion' } })).toBe(first);
    } finally {
      await clearData();
    }
  }, 300_000);
});
