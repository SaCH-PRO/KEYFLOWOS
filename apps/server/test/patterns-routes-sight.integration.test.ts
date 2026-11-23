/**
 * FU-PATTERNS-ROUTES-SIGHT (P0; follow-up of MEM-PATTERNS-SIGHT, its open item O-1; owner rulings D-257, D-100 (a member
 * without revenue read sees no money signal at all), D-234 (authorization follows the data's meaning; ambiguity fails
 * closed), D-146 (expenses are read at expenses read); journey K).
 *
 * Three REST reads behind AuthGuard and BusinessGuard only handed AiMemory rows to every member, whatever they state:
 * - GET /ai/businesses/:id/ai/memory/context: AiMemoryService.buildContextBlock unscoped (every pattern, every goal);
 * - GET /ai/businesses/:id/agent/patterns: every 'patterns' row (PatternDetectorService's "N overdue invoices totaling
 *   X"), and a 500 when one row is plain text (summarizePatterns' "Peak activity hour: 9AM": JSON.parse throws);
 * - GET /ai/businesses/:id/ai/memory (and ?category=): every row but the document extractions.
 *
 * GREEN: each route reads for the caller (the member's own module sight, readersModuleSight) and keeps an AiMemory row
 * only by the rule the flow chat and the semantic store read it by (aiMemoryRowVisibleTo): money only for a member with
 * revenue read, an expense only for one with expenses read; the owner's responses are unchanged. agent/patterns pages
 * on past withheld rows, so a reader's 50 are the same whether 0 or N money patterns are newer than theirs; a plain-text
 * pattern is answered as its description.
 *
 * Every row is written by its real writer on the real database (PatternDetectorService.scanBusiness over real invoices,
 * AiMemoryService.upsert); every read goes through the real route behind its real guards.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v71y-user`), the controllers' collaborators no case calls.
 * globalThis.fetch refuses and records every outbound request: none is made.
 *
 * Fixture prefix v71y_ (FU-PATTERNS-ROUTES-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71y_';
const HEADER = 'x-v71y-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF: crm and operations read, revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF: revenue and expenses read. */
  revenue: `${P}revenue`,
  /** STAFF: revenue read, expenses 'none'. */
  revnoexp: `${P}revnoexp`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them. */
  root: `${P}root`,
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

type Reader = 'owner' | 'blind' | 'revenue' | 'revnoexp' | 'root';
const BLIND: Reader[] = ['blind', 'root'];

const TOTAL = '7341';
const PEAK = 'Peak activity hour: 9AM';
const OPS = 'Most active day: Tuesday';
const EXPENSE = 'Rent and supplier bills cluster at the start of each month';
const MONEY_GOAL = 'Reach TTD 50,000 monthly revenue';
const PLAIN_GOAL = 'Open a second location';
/** What only a money row carries. */
const MONEY_MARKERS = [`totaling ${TOTAL}`, 'Overdue: 4000', 'overdue_invoice_cluster', 'Revenue dropped', MONEY_GOAL];

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let http: any;
let memory: any;
let detector: any;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('invoices'),
    byBiz('contacts'),
    byBiz('ai_execution_logs'),
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

async function clearMemory() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'invoices']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
async function overdueInvoices(businessId: string, contactId: string, a: number, b: number) {
  for (const [n, total] of [[1, a], [2, b]] as const) {
    await db.invoice.create({
      data: {
        id: `${contactId}_inv${n}`, invoiceNumber: `${contactId}-${n}`, businessId, contactId, total, subtotal: total,
        status: 'SENT', dueDate: new Date(Date.now() - 3 * DAY), currency: 'TTD',
      },
    });
  }
}

/** The ordinary rows every member may read: two plain-text patterns (summarizePatterns' form) and a plain goal. */
async function seedPlain() {
  for (const value of [PEAK, OPS]) {
    await memory.upsert(ID.biz, { category: 'patterns', key: value.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_'), value, confidence: 0.8, source: 'pattern_analysis' });
  }
  await memory.upsert(ID.biz, { category: 'goals', key: 'second_site', value: PLAIN_GOAL, source: 'user' });
}

/**
 * The money and expense rows: the detector's overdue cluster over real invoices, `more` revenue-drop patterns (newer
 * than the plain ones, so they fill the first 50 of agent/patterns), an expense pattern and a money goal.
 */
async function seedMoney(more: number) {
  await overdueInvoices(ID.biz, ID.payer, 4000, 3341);
  const scan = await detector.scanBusiness(ID.biz);
  expect(scan.patterns.some((p: any) => p.description.includes(`totaling ${TOTAL}`)), 'premise: the detector stored the overdue cluster').toBe(true);
  for (let i = 0; i < more; i++) {
    await memory.upsert(ID.biz, {
      category: 'patterns',
      key: `pattern_revenue_drop_${P}${i}`,
      value: JSON.stringify({ category: 'revenue_drop', title: `Revenue dropped ${10 + i}% vs last week`, description: `This week's revenue (${TOTAL}) is lower` }),
      confidence: 0.9,
      source: 'pattern_analysis',
    });
  }
  await memory.upsert(ID.biz, { category: 'patterns', key: 'expense_cycle', value: EXPENSE, confidence: 0.8, source: 'pattern_analysis' });
  await memory.upsert(ID.biz, { category: 'goals', key: 'revenue_target', value: MONEY_GOAL, source: 'user' });
}

/** Money rows in JSON (the detector's form) and a money goal, with no plain-text pattern. */
async function seedMoneyJsonOnly() {
  for (let i = 0; i < 2; i++) {
    await memory.upsert(ID.biz, {
      category: 'patterns',
      key: `pattern_revenue_drop_${P}j${i}`,
      value: JSON.stringify({ category: 'revenue_drop', title: `Revenue dropped ${20 + i}% vs last week`, description: `This week's revenue (${TOTAL}) is lower` }),
      confidence: 0.9,
      source: 'pattern_analysis',
    });
  }
  await memory.upsert(ID.biz, { category: 'goals', key: 'revenue_target', value: MONEY_GOAL, source: 'user' });
}

const agent = () => request(http.getHttpServer());
let ip = 0;
const nextIp = () => `10.74.8.${(ip += 1) % 250}`;

async function get(reader: Reader | string, route: string, businessId = ID.biz) {
  const who = reader in ID ? (ID as any)[reader] : reader;
  return agent().get(`/ai/businesses/${businessId}${route}`).set(HEADER, who).set('x-forwarded-for', nextIp());
}
async function ok(reader: Reader, route: string) {
  const res = await get(reader, route);
  expect(res.status, `${reader} ${route}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}
const ROUTES = ['/ai/memory/context', '/agent/patterns', '/ai/memory', '/ai/memory?category=patterns', '/ai/memory?category=goals'];
async function everythingFor(reader: Reader) {
  const out: Record<string, unknown> = {};
  for (const route of ROUTES) out[route] = await ok(reader, route);
  return out;
}
const text = (x: unknown) => JSON.stringify(x);
const moneyIn = (x: unknown) => MONEY_MARKERS.filter((marker) => text(x).includes(marker));

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v71y: no outbound traffic in this suite');
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
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { PatternDetectorService } = await import('../src/modules/ai/pattern-detector.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');

  const prisma = new PrismaService();
  memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any);
  // The model gateway and usage are never reached: detectAiPatterns needs two tickets or bookings, and none exist.
  detector = new PatternDetectorService(prisma, new EventEmitter2(), {} as any, memory, {} as any);

  const OFF_ROUTE = new Set([
    // AiController's collaborators no case calls.
    'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'AiOversightService', 'BusinessGraphService',
    'IntentParserService', 'PlannerService', 'StrategicIntelligenceService', 'ProAutoMonitorService',
    'ProfileIntelligenceService', 'WorkspaceRecommendationsService', 'ModelGatewayService', 'KeyCommandService',
    'AutopilotRulesService', 'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService',
    'UnifiedInboxService', 'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService',
    'CapacityInsightService', 'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService',
    'ProactiveSuggestionService', 'WorkflowTemplateService', 'KeyActionProposalService',
    'KeyCortexApprovalOrchestratorService',
    // AgentController's.
    'AgentStateMachineService', 'AgentBusService', 'CalendarIntelligenceService', 'DocumentIntelligenceService',
  ]);
  const testing = await Test.createTestingModule({
    controllers: [AiController, AgentController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: AiMemoryService, useValue: memory },
      { provide: PatternDetectorService, useValue: detector },
      { provide: SemanticMemoryService, useValue: {} },
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
    [ID.owner, 'USER'],
    [ID.blind, 'USER'],
    [ID.revenue, 'USER'],
    [ID.revnoexp, 'USER'],
    [ID.root, 'SUPER_ADMIN'],
    [ID.other, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71Y Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V71Y Other', slug: `${P}biz2`, ownerId: ID.other, currency: 'TTD' } });
  for (const [userId, businessId, role, extra] of [
    [ID.owner, ID.biz, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, ID.biz, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, ID.biz, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.revnoexp, ID.biz, 'STAFF', { permissionScopes: REVENUE_NO_EXPENSES_SCOPES, maxApprovalTier: 0 }],
    [ID.other, ID.otherBiz, 'OWNER', { maxApprovalTier: 4 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId, role, ...extra } });
  }
  await db.contact.create({ data: { id: ID.payer, businessId: ID.biz, firstName: 'V71Y', lastName: 'Payer' } });
  await db.contact.create({ data: { id: ID.otherPayer, businessId: ID.otherBiz, firstName: 'V71Y', lastName: 'Other payer' } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

describe('FU-PATTERNS-ROUTES-SIGHT (D-257, D-100, D-234, D-146): the memory and pattern REST reads hand an AiMemory row to a reader only as its text allows', () => {
  it('V71Y-01 RED: GET .../agent/patterns answers 200 when a pattern is plain text (summarizePatterns\' form), with the text as its description, for the owner and a blind member alike', async () => {
    await clearMemory();
    try {
      await seedPlain();
      for (const reader of ['owner', 'blind'] as Reader[]) {
        const body = await ok(reader, '/agent/patterns');
        const descriptions = body.patterns.map((p: any) => p.description);
        expect(descriptions, reader).toEqual(expect.arrayContaining([PEAK, OPS]));
        for (const p of body.patterns) {
          expect(typeof p.id, reader).toBe('string');
          expect(p.detectedAt, reader).toBeTruthy();
        }
      }
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-02 RED: the overdue total, the revenue-drop patterns and the money goal reach the owner and the revenue reader on every route, and neither the revenue-none STAFF member nor the memberless SUPER_ADMIN; their plain rows still reach them', async () => {
    await clearMemory();
    try {
      await seedPlain();
      await seedMoney(3);
      for (const reader of [...BLIND, 'owner', 'revenue'] as Reader[]) {
        const seen = await everythingFor(reader);
        for (const [route, body] of Object.entries(seen)) {
          const label = `${reader} ${route}: ${text(body).slice(0, 500)}`;
          if (reader === 'owner' || reader === 'revenue') {
            if (route !== '/ai/memory?category=goals') expect(text(body), label).toMatch(/Revenue dropped|totaling 7341/);
            if (route !== '/ai/memory?category=patterns' && route !== '/agent/patterns') expect(text(body), label).toContain(MONEY_GOAL);
          } else {
            expect(moneyIn(body), label).toEqual([]);
          }
        }
        if (reader === 'blind' || reader === 'root') {
          expect(text(seen['/ai/memory']), `${reader}: control`).toContain(PEAK);
          expect(text(seen['/ai/memory']), `${reader}: control`).toContain(PLAIN_GOAL);
          expect(text(seen['/agent/patterns']), `${reader}: control`).toContain(PEAK);
          expect(text(seen['/ai/memory/context']), `${reader}: control`).toContain(PLAIN_GOAL);
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V71Y-03 RED: an expense-stating row reaches a member with expenses read only: the revenue-and-expenses reader gets it on every route; the revenue-only reader, the blind member and the memberless SUPER_ADMIN do not', async () => {
    await clearMemory();
    try {
      await seedPlain();
      await seedMoney(1);
      const expenseRoutes = ['/ai/memory/context', '/agent/patterns', '/ai/memory', '/ai/memory?category=patterns'];
      for (const route of expenseRoutes) expect(text(await ok('revenue', route)), `revenue ${route}`).toContain(EXPENSE);
      for (const reader of ['revnoexp', ...BLIND] as Reader[]) {
        for (const route of expenseRoutes) {
          const body = await ok(reader, route);
          expect(text(body), `${reader} ${route}`).not.toContain(EXPENSE);
        }
      }
      // The revenue-only reader still gets the money rows (D-100: revenue read is enough for money).
      expect(text(await ok('revnoexp', '/ai/memory')), 'revnoexp money').toContain(MONEY_GOAL);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it("V71Y-04 differential: the revenue-none STAFF member and the memberless SUPER_ADMIN get identical responses on every route whether the business holds 0 or 60 money patterns newer than their own (agent/patterns' 50 included)", async () => {
    await clearMemory();
    try {
      await seedPlain();
      const before: Record<string, unknown> = {};
      for (const reader of BLIND) before[reader] = await everythingFor(reader);
      await seedMoney(60);
      // Control: the owner's first 50 are now all money patterns.
      const ownerPatterns = (await ok('owner', '/agent/patterns')).patterns;
      expect(ownerPatterns).toHaveLength(50);
      expect(ownerPatterns.some((p: any) => p.description === PEAK), 'control: the plain patterns fell out of the owner\'s 50').toBe(false);
      for (const reader of BLIND) expect(await everythingFor(reader), reader).toEqual(before[reader]);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it("V71Y-05 owner parity: the owner's responses are what the unscoped reads return: buildContextBlock, getAll, getByCategory, and every pattern row (newest 50)", async () => {
    await clearMemory();
    try {
      await seedPlain();
      await seedMoney(2);
      expect(await ok('owner', '/ai/memory/context')).toEqual(JSON.parse(JSON.stringify(await memory.buildContextBlock(ID.biz))));
      expect((await ok('owner', '/ai/memory')).memories).toEqual(JSON.parse(JSON.stringify(await memory.getAll(ID.biz))));
      expect((await ok('owner', '/ai/memory?category=goals')).memories).toEqual(JSON.parse(JSON.stringify(await memory.getByCategory(ID.biz, 'goals'))));
      const rows = await db.aiMemory.findMany({ where: { businessId: ID.biz, category: 'patterns' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 });
      const patterns = (await ok('owner', '/agent/patterns')).patterns;
      expect(patterns).toHaveLength(rows.length);
      expect(patterns.map((p: any) => p.confidence)).toEqual(rows.map((r: any) => r.confidence));
      // Correctness review TST-FUPRS-3: the same rows in the same order (a JSON pattern's own id is spread over the row's).
      expect(patterns.map((p: any) => p.detectedAt)).toEqual(rows.map((r: any) => r.createdAt.toISOString()));
      expect(patterns.filter((p: any) => !p.category).map((p: any) => p.id)).toEqual(rows.filter((r: any) => !r.value.startsWith('{')).map((r: any) => r.id));
      // A JSON pattern is answered as before: its fields spread over the row's id, with the row's time and confidence.
      const overdueRow = rows.find((r: any) => r.key.startsWith('pattern_overdue_invoice_cluster'));
      const overdue = patterns.find((p: any) => p.category === 'overdue_invoice_cluster');
      expect(overdue).toEqual(JSON.parse(JSON.stringify({ id: overdueRow.id, ...JSON.parse(overdueRow.value), detectedAt: overdueRow.createdAt, confidence: overdueRow.confidence })));
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it("V71Y-06 cross-tenant: another business's money rows never reach this business's readers, a member of this business is refused the other business's routes identically whether it holds 0 or N patterns, and the other owner never sees this business's rows", async () => {
    await clearMemory();
    try {
      await seedPlain();
      await seedMoney(1);
      const refusedBefore: unknown[] = [];
      for (const route of ROUTES) {
        const res = await get('revenue', route, ID.otherBiz);
        refusedBefore.push([res.status, { ...res.body, timestamp: '<ts>' }]);
      }
      await overdueInvoices(ID.otherBiz, ID.otherPayer, 5000, 4157);
      await detector.scanBusiness(ID.otherBiz);
      await memory.upsert(ID.otherBiz, { category: 'goals', key: 'other_target', value: 'V71Y-OTHER reach TTD 99,000', source: 'user' });
      const refusedAfter: unknown[] = [];
      for (const route of ROUTES) {
        const res = await get('revenue', route, ID.otherBiz);
        expect(res.status, `revenue on the other business ${route}`).toBe(403);
        refusedAfter.push([res.status, { ...res.body, timestamp: '<ts>' }]);
      }
      expect(refusedAfter).toEqual(refusedBefore);
      for (const reader of ['owner', 'revenue'] as Reader[]) {
        const seen = text(await everythingFor(reader));
        expect(seen, reader).not.toContain('totaling 9157');
        expect(seen, reader).not.toContain('V71Y-OTHER');
      }
      for (const route of ROUTES) {
        const res = await get(ID.other, route, ID.otherBiz);
        expect(res.status, `other owner ${route}`).toBe(200);
        expect(text(res.body), `other owner ${route}`).not.toContain(`totaling ${TOTAL}`);
        expect(text(res.body), `other owner ${route}`).not.toContain(PEAK);
      }
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-07 RED: with only JSON patterns (no plain-text row to fail agent/patterns), the overdue total, the revenue-drop patterns and the money goal reach the revenue-none STAFF member and the memberless SUPER_ADMIN on no route; the owner gets them (control)', async () => {
    await clearMemory();
    try {
      await overdueInvoices(ID.biz, ID.payer, 4000, 3341);
      await detector.scanBusiness(ID.biz);
      await seedMoneyJsonOnly();
      // Correctness review TST-FUPRS-4: every route's leak is collected before asserting, so a RED run shows each.
      const leaks: Record<string, string[]> = {};
      for (const reader of BLIND) {
        for (const [route, body] of Object.entries(await everythingFor(reader))) {
          const found = moneyIn(body);
          if (found.length) leaks[`${reader} ${route}`] = found;
        }
      }
      expect(leaks).toEqual({});
      const owner = await everythingFor('owner');
      expect(moneyIn(owner['/agent/patterns']).length, 'owner control').toBeGreaterThan(0);
      expect(text(owner['/ai/memory?category=goals']), 'owner control').toContain(MONEY_GOAL);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it("V71Y-08 RED (security review O-1): POST .../agent/patterns/scan answers the caller only the patterns they may read: the revenue-none member and the memberless SUPER_ADMIN get no money pattern and no invoice-derived count; the owner gets the overdue total (control)", async () => {
    await clearMemory();
    try {
      await overdueInvoices(ID.biz, ID.payer, 4000, 3341);
      const scan = async (reader: Reader) => {
        const res = await agent().post(`/ai/businesses/${ID.biz}/agent/patterns/scan`).set(HEADER, ID[reader]).set('x-forwarded-for', nextIp());
        expect(res.status, `${reader}: ${text(res.body).slice(0, 300)}`).toBe(201);
        return res.body;
      };
      const leaks: Record<string, unknown> = {};
      for (const reader of BLIND) {
        const body = await scan(reader);
        if (moneyIn(body).length) leaks[`${reader} patterns`] = moneyIn(body);
        if (body.entitiesScanned !== undefined) leaks[`${reader} entitiesScanned`] = body.entitiesScanned;
        expect(Array.isArray(body.patterns), reader).toBe(true);
      }
      expect(leaks).toEqual({});
      const owner = await scan('owner');
      expect(text(owner.patterns), 'owner control').toContain(`totaling ${TOTAL}`);
      expect(owner.entitiesScanned, 'owner control').toBeGreaterThan(0);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it("V71Y-09 RED (security review O-2): POST .../ai/memory/summarize-patterns answers the caller only the summaries they may read: a tool summary naming a money tool reaches the owner, not the revenue-none member; the plain summaries reach both", async () => {
    await clearMemory();
    try {
      for (let i = 0; i < 6; i++) {
        await db.aiExecutionLog.create({
          data: { businessId: ID.biz, action: 'tool_call', toolName: 'commerce_send_payment_reminder', module: 'commerce', success: true, riskTier: 1 },
        });
      }
      const summarize = async (reader: Reader) => {
        const res = await agent().post(`/ai/businesses/${ID.biz}/ai/memory/summarize-patterns`).set(HEADER, ID[reader]).set('x-forwarded-for', nextIp());
        expect(res.status, `${reader}: ${text(res.body).slice(0, 300)}`).toBe(201);
        return res.body.patterns as string[];
      };
      const owner = await summarize('owner');
      expect(owner.some((p) => p.includes('commerce_send_payment_reminder')), `owner control: ${text(owner)}`).toBe(true);
      expect(owner.some((p) => p.startsWith('Peak activity hour')), `owner control: ${text(owner)}`).toBe(true);
      const blind = await summarize('blind');
      expect(blind.filter((p) => p.includes('commerce_send_payment_reminder')), text(blind)).toEqual([]);
      expect(blind.some((p) => p.startsWith('Peak activity hour')), `blind control: ${text(blind)}`).toBe(true);
    } finally {
      await db.$executeRawUnsafe(`DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`);
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-10 (correctness review TST-R2-1): on Postgres, past the first keyset page: the revenue-none member and the memberless SUPER_ADMIN get identical agent/patterns with 0 or 450 withheld patterns newer than theirs, some sharing a millisecond', async () => {
    await clearMemory();
    try {
      await seedPlain();
      const before: Record<string, unknown> = {};
      for (const reader of BLIND) before[reader] = await ok(reader, '/agent/patterns');
      const base = Date.now() + 1_000;
      await db.aiMemory.createMany({
        data: Array.from({ length: 450 }, (_, i) => ({
          businessId: ID.biz, category: 'patterns', key: `pattern_overdue_invoice_cluster_${P}${i}`,
          value: JSON.stringify({ category: 'overdue_invoice_cluster', description: `2 overdue invoices totaling ${TOTAL}` }),
          confidence: 0.85, source: 'pattern_analysis', createdAt: new Date(base + Math.floor(i / 7)),
        })),
      });
      for (const reader of BLIND) expect(await ok(reader, '/agent/patterns'), reader).toEqual(before[reader]);
      expect(moneyIn(await ok('owner', '/agent/patterns')).length, 'owner control').toBeGreaterThan(0);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-11 RED (security review round 2, O-2): POST .../agent/patterns/scan is rate limited (5 a minute per caller address and business): the sixth answers 429', async () => {
    await clearMemory();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await agent().post(`/ai/businesses/${ID.biz}/agent/patterns/scan`).set(HEADER, ID.blind).set('x-forwarded-for', '10.74.9.1');
        statuses.push(res.status);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it("V71Y-12 (orchestrator ruling A; COR-R3-1, TST-R3-1): on Postgres, a reader who may not read every pattern is answered the patterns updated in the last 30 days: one written and last updated 40 days ago is not answered to them (the owner's is), one written 40 days ago and rewritten now is", async () => {
    await clearMemory();
    try {
      const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      await db.aiMemory.createMany({
        data: [
          { businessId: ID.biz, category: 'patterns', key: 'v71y_stale', value: 'V71Y-STALE Most active day: Monday', source: 'pattern_analysis', createdAt: longAgo, updatedAt: longAgo },
          { businessId: ID.biz, category: 'patterns', key: 'peak_activity_hour', value: 'Peak activity hour: 3AM', source: 'pattern_analysis', createdAt: longAgo, updatedAt: longAgo },
        ],
      });
      // summarizePatterns' rewrite of its fixed key (AiMemoryService.upsert: updatedAt moves, createdAt stays).
      await memory.upsert(ID.biz, { category: 'patterns', key: 'peak_activity_hour', value: PEAK, confidence: 0.8, source: 'pattern_analysis' });
      for (const reader of BLIND) {
        const descriptions = (await ok(reader, '/agent/patterns')).patterns.map((p: any) => p.description);
        expect(descriptions, reader).toEqual([PEAK]);
      }
      const owner = (await ok('owner', '/agent/patterns')).patterns.map((p: any) => p.description);
      expect(owner, 'owner').toEqual(expect.arrayContaining([PEAK, 'V71Y-STALE Most active day: Monday']));
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-13 RED (orchestrator ruling A): the memory writers are bounded: PUT .../ai/memory/bulk refuses more than 50 entries (400, nothing written) and is rate limited to 5 a minute; PUT .../ai/memory to 30 a minute (429 past it)', async () => {
    await clearMemory();
    try {
      const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ category: 'patterns', key: `v71y_bulk_${i}`, value: `Most active day: ${i}` }));
      const bulk = (n: number, ip: string) => agent().put(`/ai/businesses/${ID.biz}/ai/memory/bulk`).set(HEADER, ID.blind).set('x-forwarded-for', ip).send({ entries: entries(n) });
      const tooMany = await bulk(51, '10.74.10.1');
      expect(tooMany.status, text(tooMany.body)).toBe(400);
      expect(await db.aiMemory.count({ where: { businessId: ID.biz, key: { startsWith: 'v71y_bulk_' } } })).toBe(0);
      expect((await bulk(50, '10.74.10.2')).status).toBe(200);
      const bulkStatuses: number[] = [];
      for (let i = 0; i < 6; i++) bulkStatuses.push((await bulk(1, '10.74.10.3')).status);
      expect(bulkStatuses).toEqual([200, 200, 200, 200, 200, 429]);
      const single: number[] = [];
      for (let i = 0; i < 31; i++) {
        const res = await agent().put(`/ai/businesses/${ID.biz}/ai/memory`).set(HEADER, ID.blind).set('x-forwarded-for', '10.74.10.4')
          .send({ category: 'patterns', key: `v71y_one_${i}`, value: 'Most active day: Friday' });
        single.push(res.status);
      }
      expect(single.slice(0, 30).every((s) => s === 200), text(single)).toBe(true);
      expect(single[30]).toBe(429);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-14 RED (orchestrator ruling A): ai_memories carries the index the windowed pattern read pages on: (business_id, category, updated_at DESC, id DESC)', async () => {
    const rows: Array<{ indexdef: string }> = await db.$queryRawUnsafe(`SELECT indexdef FROM pg_indexes WHERE tablename = 'ai_memories'`);
    const defs = rows.map((r) => r.indexdef.replace(/\s+/g, ' '));
    expect(defs.some((d) => /\(business_id, category, updated_at DESC, id DESC\)/.test(d)), defs.join('\n')).toBe(true);
  });

  it('V71Y-15 RED (security review round 4, F-1): the memory writers bound what a row holds, not only how many: PUT .../ai/memory and each entry of PUT .../ai/memory/bulk refuse a key over 200 or a value over 2,000 characters (400, nothing written); at the bounds they write', async () => {
    await clearMemory();
    try {
      const put = (body: unknown, ip: string) => agent().put(`/ai/businesses/${ID.biz}/ai/memory`).set(HEADER, ID.blind).set('x-forwarded-for', ip).send(body);
      const bulk = (entries: unknown[], ip: string) => agent().put(`/ai/businesses/${ID.biz}/ai/memory/bulk`).set(HEADER, ID.blind).set('x-forwarded-for', ip).send({ entries });
      const big = `overdue invoice ${'x'.repeat(2_000)}`;
      const refused = [
        await put({ category: 'patterns', key: 'v71y_big_value', value: big }, '10.74.11.1'),
        await put({ category: 'patterns', key: `v71y_${'k'.repeat(200)}`, value: 'Most active day: Monday' }, '10.74.11.2'),
        await bulk([{ category: 'patterns', key: 'v71y_ok', value: 'Most active day: Monday' }, { category: 'patterns', key: 'v71y_big_bulk', value: big }], '10.74.11.3'),
        await bulk([{ category: 'patterns', key: `v71y_${'k'.repeat(200)}`, value: 'Most active day: Monday' }], '10.74.11.4'),
      ];
      expect(refused.map((r) => r.status), text(refused.map((r) => r.body))).toEqual([400, 400, 400, 400]);
      expect(await db.aiMemory.count({ where: { businessId: ID.biz } }), 'nothing written').toBe(0);
      const atBound = [
        await put({ category: 'patterns', key: 'v'.repeat(200), value: 'y'.repeat(2_000) }, '10.74.11.5'),
        await bulk([{ category: 'patterns', key: 'w'.repeat(200), value: 'z'.repeat(2_000) }], '10.74.11.6'),
      ];
      expect(atBound.map((r) => r.status), text(atBound.map((r) => r.body).map((b) => JSON.stringify(b).slice(0, 200)))).toEqual([200, 200]);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71Y-16 RED (reviews round 5, R5-1/N-1): a bulk entry that is not an object is refused 400, not 500, and nothing is written', async () => {
    await clearMemory();
    try {
      for (const [i, entries] of [[null], ['text'], [{ category: 'patterns', key: 'v71y_ok', value: 'Most active day: Monday' }, null]].entries()) {
        const res = await agent().put(`/ai/businesses/${ID.biz}/ai/memory/bulk`).set(HEADER, ID.blind).set('x-forwarded-for', `10.74.12.${i + 1}`).send({ entries });
        expect(res.status, `${JSON.stringify(entries)}: ${text(res.body)}`).toBe(400);
      }
      expect(await db.aiMemory.count({ where: { businessId: ID.biz } })).toBe(0);
    } finally {
      await clearMemory();
    }
  }, 240_000);
});
