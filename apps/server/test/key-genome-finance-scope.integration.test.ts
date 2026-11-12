/**
 * W11-GENOME-FINANCE-SCOPE — the KEY genome's finance routes carry the revenue
 * gate. Owner ruling D-128 (option a): the genome's financial metrics, snapshot
 * recompute, signals and recommendations are written by members with revenue
 * write; reading them needs revenue read (D-100: a member without revenue read
 * sees no money signals at all).
 *
 * KeyGenomeController is guarded by AuthGuard and BusinessGuard only, and
 * BusinessGuard checks membership only. At head none of its 92 routes carries
 * ModuleScopeGuard, so:
 *
 *   GFS-02  RED-BEFORE a STAFF member whose explicit scope map says
 *           revenue:'none' gets 200 with the business's revenue and cash on
 *           GET finance/snapshot, finance/snapshots and finance/metrics.
 *           GREEN-AFTER each answers 403 'Insufficient permissions: revenue
 *           requires read access (you have none)' before the service runs.
 *   GFS-04  RED-BEFORE POST finance/metrics as revenue:'none' or revenue:'read'
 *           STAFF answers 201 and writes the metric (the input of the genome's
 *           LOW_RUNWAY signal and health score). GREEN-AFTER 403 and no row.
 *   GFS-06  RED-BEFORE POST finance/snapshot/compute, finance/signals/generate
 *           and finance/recommendations/generate run for the same members
 *           (the service is reached). GREEN-AFTER 403 'revenue requires write
 *           access' before the service.
 *   GFS-01, GFS-03, GFS-05, GFS-07, GFS-08 are controls: the owner and a
 *           revenue:'read' STAFF member still read the figures; a
 *           revenue:'write' STAFF member and the owner still write a metric;
 *           GET departments (no finance figure, no module gate) is unchanged
 *           for the revenue:'none' member; exactly the seven finance handlers
 *           carry a module scope, the other 85 routes none.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global TenantInterceptor, GenomeFinancialMetricService,
 * FinanceGenomeService's finance reads and GenomeDepartmentService run against
 * the database at DATABASE_URL. The finance service methods are wrapped by
 * vi.spyOn, which calls through, only to record whether a refused request
 * reached them. Identity attachment is a stand-in: a test middleware reads
 * `x-test-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. KeyGenomeController's
 * collaborators off these routes are stubbed, and FinanceGenomeService's
 * compute collaborators (facts, signals, recommendations, memory, department
 * readiness) are stand-ins that throw if reached: a refused POST never reaches
 * them, so on unmodified code GFS-06 shows the request running (500 from the
 * stand-in) instead of the 403.
 *
 * Fixtures: prefix `v97u_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v97u_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffWrite: `${P}staffWrite`,
  biz: `${P}biz`,
  snapshot: `${P}snap`,
  department: `${P}dept`,
};

const READ_DENIED = 'Insufficient permissions: revenue requires read access (you have none)';
const WRITE_DENIED = (has: 'none' | 'read') => `Insufficient permissions: revenue requires write access (you have ${has})`;

/** The seeded figures (REVENUE, CASH_ON_HAND, NET_PROFIT) no refused read may carry. */
const FIGURES = /4321\.5|987\.65|1234\.5/;
const PERIOD = '2026-10';

let db: any;
let app: any;
let controllerClass: any;
let moduleScopeKey: string;
/** vi.spyOn wrappers (calling through) on the real service methods behind the seven routes. */
const SPY: Record<string, any> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM genome_recommendation_outcomes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_recommendations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_signals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_evidence WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_facts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_memory_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_module_readiness WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_departments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_finance_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_financial_metrics WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    // The genome tables reference businesses ON DELETE CASCADE, so any genome
    // row a red-before run wrote outside the list above goes with the business.
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Identity attachment only. No guard is overridden. */
function attachIdentity(nest: any) {
  nest.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

const base = () => `/business-genome/businesses/${ID.biz}/key-genome`;

function get(route: string, as: string) {
  return request(app.getHttpServer()).get(`${base()}/${route}`).set(HEADER, as);
}

function post(route: string, as: string, body?: Record<string, unknown>) {
  const req = request(app.getHttpServer()).post(`${base()}/${route}`).set(HEADER, as);
  return body ? req.send(body) : req;
}

/** The three finance reads, the service method behind each, and the figures a reader that may see them is served. */
const READS: Array<{ route: string; spy: string; figures: (body: any) => unknown; expected: unknown }> = [
  {
    route: 'finance/snapshot',
    spy: 'getLatestFinanceSnapshot',
    figures: (b) => ({ id: b?.id, revenue: b?.revenue, netProfit: b?.netProfit, cashOnHand: b?.cashOnHand }),
    expected: { id: `${P}snap`, revenue: 4321.5, netProfit: 1234.5, cashOnHand: 987.65 },
  },
  {
    route: 'finance/snapshots',
    spy: 'listFinanceSnapshots',
    figures: (b) => (Array.isArray(b) ? b : []).map((s: any) => [s.id, s.revenue, s.cashOnHand]),
    expected: [[`${P}snap`, 4321.5, 987.65]],
  },
  {
    route: 'finance/metrics',
    spy: 'listMetrics',
    figures: (b) => (Array.isArray(b) ? b : [])
      .map((m: any) => [m.metricType, m.period, m.value])
      .sort((x: any[], y: any[]) => String(x[0]).localeCompare(String(y[0]))),
    expected: [['CASH_ON_HAND', PERIOD, 987.65], ['REVENUE', PERIOD, 4321.5]],
  },
];

/** The three POSTs other than finance/metrics, and the service method behind each. */
const GENERATORS: Array<{ route: string; spy: string }> = [
  { route: 'finance/snapshot/compute', spy: 'computeFinanceSnapshot' },
  { route: 'finance/signals/generate', spy: 'generateFinanceSignals' },
  { route: 'finance/recommendations/generate', spy: 'generateFinanceRecommendations' },
];

function clearSpies() {
  for (const spy of Object.values(SPY)) spy.mockClear();
}

async function metricRows(metricType: string) {
  return db.$queryRawUnsafe(
    `SELECT value FROM genome_financial_metrics WHERE business_id = $1 AND metric_type = $2 AND period = $3`,
    ID.biz, metricType, PERIOD,
  ) as Promise<Array<{ value: number }>>;
}

async function snapshotCount() {
  const [row]: Array<{ n: number }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM genome_finance_snapshots WHERE business_id = $1`, ID.biz,
  );
  return row.n;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { KeyGenomeController } = await import('../src/modules/business-genome/key-genome/key-genome.controller');
  const { GenomeFinancialMetricService } = await import('../src/modules/business-genome/key-genome/genome-financial-metric.service');
  const { FinanceGenomeService } = await import('../src/modules/business-genome/key-genome/finance-genome.service');
  const { GenomeDepartmentService } = await import('../src/modules/business-genome/key-genome/genome-department.service');
  controllerClass = KeyGenomeController;
  moduleScopeKey = MODULE_SCOPE_KEY;

  // KeyGenomeController's collaborators off the finance routes and the
  // departments control are stubbed (the controller injects each by token).
  const stubs = await Promise.all([
    import('../src/modules/business-genome/key-genome/genome-signal.service').then((m) => m.GenomeSignalService),
    import('../src/modules/business-genome/key-genome/genome-recommendation.service').then((m) => m.GenomeRecommendationService),
    import('../src/modules/business-genome/key-genome/genome-experiment.service').then((m) => m.GenomeExperimentService),
    import('../src/modules/business-genome/key-genome/key-genome-governance.service').then((m) => m.KeyGenomeGovernanceService),
    import('../src/modules/business-genome/key-genome/genome-memory.service').then((m) => m.GenomeMemoryService),
    import('../src/modules/business-genome/key-genome/department-readiness.service').then((m) => m.DepartmentReadinessService),
    import('../src/modules/business-genome/key-genome/genome-customer-segment.service').then((m) => m.GenomeCustomerSegmentService),
    import('../src/modules/business-genome/key-genome/genome-sales-motion.service').then((m) => m.GenomeSalesMotionService),
    import('../src/modules/business-genome/key-genome/customer-sales-genome.service').then((m) => m.CustomerSalesGenomeService),
    import('../src/modules/business-genome/key-genome/genome-operational-process.service').then((m) => m.GenomeOperationalProcessService),
    import('../src/modules/business-genome/key-genome/genome-delivery-capability.service').then((m) => m.GenomeDeliveryCapabilityService),
    import('../src/modules/business-genome/key-genome/operations-genome.service').then((m) => m.OperationsGenomeService),
    import('../src/modules/business-genome/key-genome/genome-growth-channel.service').then((m) => m.GenomeGrowthChannelService),
    import('../src/modules/business-genome/key-genome/genome-content-strategy.service').then((m) => m.GenomeContentStrategyService),
    import('../src/modules/business-genome/key-genome/marketing-genome.service').then((m) => m.MarketingGenomeService),
    import('../src/modules/business-genome/key-genome/genome-cross-domain.service').then((m) => m.GenomeCrossDomainService),
    import('../src/modules/business-genome/key-genome/genome-recommendation-ranker.service').then((m) => m.GenomeRecommendationRankerService),
    import('../src/modules/business-genome/key-genome/genome-opportunity-detector.service').then((m) => m.GenomeOpportunityDetectorService),
    import('../src/modules/business-genome/key-genome/genome-autonomy-gate.service').then((m) => m.GenomeAutonomyGateService),
    import('../src/modules/business-genome/key-genome/genome-recommendation-outcome.service').then((m) => m.GenomeRecommendationOutcomeService),
  ]);
  // FinanceGenomeService's collaborators beyond Prisma and the metric service
  // serve only the compute/generate paths, which a refused member never
  // reaches; each stand-in throws, so reaching one fails loudly.
  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) => () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); },
  });

  // The test runner emits no decorator metadata, so the live services (which
  // inject PrismaService by type) are built by factory, as Nest would build them.
  const moduleRef = await Test.createTestingModule({
    controllers: [KeyGenomeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: GenomeFinancialMetricService, inject: [PrismaService], useFactory: (prisma: any) => new GenomeFinancialMetricService(prisma) },
      {
        provide: FinanceGenomeService,
        inject: [PrismaService, GenomeFinancialMetricService],
        useFactory: (prisma: any, metrics: any) => new FinanceGenomeService(
          prisma, metrics, offRoute('GenomeFactService') as any, offRoute('GenomeSignalService') as any,
          offRoute('GenomeRecommendationService') as any, offRoute('GenomeMemoryService') as any,
          offRoute('DepartmentReadinessService') as any,
        ),
      },
      { provide: GenomeDepartmentService, inject: [PrismaService], useFactory: (prisma: any) => new GenomeDepartmentService(prisma) },
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  const metrics = moduleRef.get(GenomeFinancialMetricService);
  const financeGenome = moduleRef.get(FinanceGenomeService);
  SPY.listMetrics = vi.spyOn(metrics, 'listMetrics');
  SPY.upsertMetric = vi.spyOn(metrics, 'upsertMetric');
  for (const method of [
    'getLatestFinanceSnapshot',
    'listFinanceSnapshots',
    'computeFinanceSnapshot',
    'generateFinanceSignals',
    'generateFinanceRecommendations',
  ] as const) {
    SPY[method] = vi.spyOn(financeGenome, method);
  }

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.staffWrite]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({
    data: { id: ID.biz, name: 'V97U Genome', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' },
  });
  for (const [user, role, permissionScopes] of [
    [ID.owner, 'OWNER', undefined],
    [ID.staffNone, 'STAFF', { revenue: 'none', crm: 'read' }],
    [ID.staffRead, 'STAFF', { revenue: 'read' }],
    [ID.staffWrite, 'STAFF', { revenue: 'write' }],
  ] as const) {
    await db.membership.create({
      data: { id: `${user}_m`, userId: user, businessId: ID.biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }
  const occurredAt = new Date(Date.now() - 86400_000);
  for (const [metricType, value] of [['REVENUE', 4321.5], ['CASH_ON_HAND', 987.65]] as const) {
    await db.genomeFinancialMetric.create({
      data: { id: `${P}m_${metricType}`, businessId: ID.biz, metricType, period: PERIOD, value, currency: 'TTD', confidence: 0.9, occurredAt },
    });
  }
  await db.genomeFinanceSnapshot.create({
    data: {
      id: ID.snapshot, businessId: ID.biz, period: PERIOD, currency: 'TTD',
      revenue: 4321.5, netProfit: 1234.5, cashOnHand: 987.65, runwayMonths: 0.8,
      healthScore: 42, overallRisk: 'HIGH',
    },
  });
  await db.genomeDepartment.create({
    data: { id: ID.department, businessId: ID.biz, code: 'OPERATIONS', name: 'V97u Operations' },
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('W11-GENOME-FINANCE-SCOPE (D-128, D-100): reading the KEY genome finance figures needs revenue read', () => {
  it('[GFS-01] control (D-100): the OWNER reads finance/snapshot, finance/snapshots and finance/metrics (200 with the seeded revenue and cash figures)', async () => {
    for (const read of READS) {
      const res = await get(read.route, ID.owner);
      expect(res.status, `${read.route}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(read.figures(res.body), read.route).toEqual(read.expected);
    }
  }, 30_000);

  it(`[GFS-02] RED-BEFORE (D-100): a STAFF member with revenue none is refused 403 '${READ_DENIED}' on finance/snapshot, finance/snapshots and finance/metrics before the service runs, with no figure`, async () => {
    for (const read of READS) {
      clearSpies();
      const res = await get(read.route, ID.staffNone);
      expect(res.status, `${read.route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, read.route).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
      expect(JSON.stringify(res.body), `${read.route} serves no revenue or cash figure`).not.toMatch(FIGURES);
      expect(SPY[read.spy], `${read.spy} never runs for a refused read`).not.toHaveBeenCalled();
    }
  }, 30_000);

  it('[GFS-03] control (D-100): a STAFF member with revenue read reads the three finance routes (200 with the same figures)', async () => {
    for (const read of READS) {
      const res = await get(read.route, ID.staffRead);
      expect(res.status, `${read.route}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(read.figures(res.body), read.route).toEqual(read.expected);
    }
  }, 30_000);
});

describe('W11-GENOME-FINANCE-SCOPE (D-128 option a): writing the KEY genome finance metrics needs revenue write', () => {
  it('[GFS-04] RED-BEFORE (D-128): POST finance/metrics as the revenue none and the revenue read STAFF member answers 403 before the service runs, and no metric is written', async () => {
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      clearSpies();
      const res = await post('finance/metrics', as, { metricType: 'NET_PROFIT', period: PERIOD, value: 1.11, currency: 'TTD' });
      expect(res.status, `${has}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, has).toMatchObject({ code: 'FORBIDDEN', message: WRITE_DENIED(has) });
      expect(SPY.upsertMetric, `upsertMetric never runs for revenue ${has}`).not.toHaveBeenCalled();
      expect(await metricRows('NET_PROFIT'), `no NET_PROFIT metric written by revenue ${has}`).toEqual([]);
    }
    // The figure the genome's runway reads is untouched as well.
    const res = await post('finance/metrics', ID.staffRead, { metricType: 'CASH_ON_HAND', period: PERIOD, value: 0.01 });
    expect(res.status).toBe(403);
    expect((await metricRows('CASH_ON_HAND')).map((r) => r.value)).toEqual([987.65]);
  }, 30_000);

  it('[GFS-05] control (D-128 option a): POST finance/metrics as the revenue write STAFF member answers 201 and writes the metric; the OWNER still writes it too', async () => {
    const res = await post('finance/metrics', ID.staffWrite, { metricType: 'NET_PROFIT', period: PERIOD, value: 2222.22, currency: 'TTD' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.biz, metricType: 'NET_PROFIT', period: PERIOD, value: 2222.22 });
    expect((await metricRows('NET_PROFIT')).map((r) => r.value)).toEqual([2222.22]);

    const owner = await post('finance/metrics', ID.owner, { metricType: 'NET_PROFIT', period: PERIOD, value: 3333.33, currency: 'TTD' });
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    expect((await metricRows('NET_PROFIT')).map((r) => r.value)).toEqual([3333.33]);
  }, 30_000);

  it('[GFS-06] RED-BEFORE (D-128): POST finance/snapshot/compute, finance/signals/generate and finance/recommendations/generate refuse the revenue none and the revenue read STAFF member 403 before the service runs', async () => {
    const before = await snapshotCount();
    for (const gen of GENERATORS) {
      for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
        clearSpies();
        const res = await post(gen.route, as);
        expect(res.status, `${gen.route} as revenue ${has}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body, `${gen.route} as revenue ${has}`).toMatchObject({ code: 'FORBIDDEN', message: WRITE_DENIED(has) });
        expect(SPY[gen.spy], `${gen.spy} never runs for revenue ${has}`).not.toHaveBeenCalled();
      }
    }
    expect(await snapshotCount(), 'no finance snapshot computed by a refused member').toBe(before);
  }, 60_000);
});

describe('W11-GENOME-FINANCE-SCOPE (D-128): the other key-genome routes are unchanged', () => {
  it('[GFS-07] control: GET departments (no finance figure) still answers 200 to the revenue none STAFF member', async () => {
    const res = await get('departments', ID.staffNone);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as any[]).map((d) => [d.id, d.code])).toEqual([[ID.department, 'OPERATIONS']]);
  }, 30_000);

  it('[GFS-08] exactly the seven finance handlers carry a module scope (revenue read on the three GETs, revenue write on the four POSTs); the other 85 routes carry none', () => {
    const proto = controllerClass.prototype;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && Reflect.getMetadata('path', proto[name]) !== undefined,
    );
    expect(handlers).toHaveLength(92);
    const scoped = Object.fromEntries(
      handlers
        .map((name) => [name, Reflect.getMetadata(moduleScopeKey, proto[name])] as const)
        .filter(([, requirement]) => requirement !== undefined),
    );
    expect(scoped).toEqual({
      listFinanceMetrics: { module: 'revenue', minLevel: 'read' },
      getFinanceSnapshot: { module: 'revenue', minLevel: 'read' },
      listFinanceSnapshots: { module: 'revenue', minLevel: 'read' },
      upsertFinanceMetric: { module: 'revenue', minLevel: 'write' },
      computeFinanceSnapshot: { module: 'revenue', minLevel: 'write' },
      generateFinanceSignals: { module: 'revenue', minLevel: 'write' },
      generateFinanceRecommendations: { module: 'revenue', minLevel: 'write' },
    });
  });
});
