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
 * Review repairs (SEC-GFS-1..4, GFS-R1, GFS-R2) extend the same rulings to
 * the sibling routes that reached the same rows:
 *
 *   GFS-09..GFS-12  D-128: POST cross-domain/snapshot/compute and POST
 *           outcomes/:id/close-observation recompute the finance snapshot
 *           (through GenomeCrossDomainService) and need revenue write; the
 *           ranked-recommendation, opportunity and autonomy-gate routes
 *           recompute it when no cross-domain snapshot exists, so they refuse
 *           a member without revenue write then; once one exists a revenue
 *           read member is served without any recompute.
 *   GFS-13, GFS-14  D-100: the cross-domain composite (its overall score
 *           averages the finance health score and carries the finance warning
 *           text) and the customer-sales snapshot (revenue per customer,
 *           lifetime value and acquisition cost read from the finance metrics)
 *           need revenue read.
 *   GFS-15..GFS-20  D-128's read clause: the genome's finance signals,
 *           finance recommendations and finance or cross-domain memory events
 *           are withheld from a member without revenue read (lists drop them;
 *           by id 403), as are the governance queue items naming them and the
 *           outcome rows (their health scores are the composite's); acting on
 *           a finance signal or recommendation needs revenue write.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global TenantInterceptor, GenomeFinancialMetricService,
 * FinanceGenomeService's finance reads and GenomeDepartmentService run against
 * the database at DATABASE_URL, and so do (review repairs) GenomeSignalService,
 * GenomeRecommendationService, GenomeMemoryService, CustomerSalesGenomeService,
 * the segment and sales-motion services, GenomeCrossDomainService, the ranker,
 * the opportunity detector, the autonomy gate, the outcome service and the
 * governance service on the routes under test. The service methods are wrapped
 * by vi.spyOn, which calls through, only to record whether a refused request
 * reached them. Identity attachment is a stand-in: a test middleware reads
 * `x-test-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. KeyGenomeController's
 * collaborators off these routes are stubbed. Collaborators the real services
 * call beyond Prisma are stand-ins: the fact service answers "no fact", outcome
 * learning, department readiness and the recommendation outcome recorder are
 * no-ops, readiness and scoring answer empty, the operations and marketing
 * snapshot computes reject (the cross-domain service reads that as "no
 * snapshot", as it does any failure), and anything else throws if reached.
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
  sigFin: `${P}sig_fin`,
  sigOps: `${P}sig_ops`,
  recFin: `${P}rec_fin`,
  recOps: `${P}rec_ops`,
  memFin: `${P}mem_fin`,
  memCross: `${P}mem_cd`,
  memOps: `${P}mem_ops`,
  outOps: `${P}out_ops`,
  csSnapshot: `${P}cs_snap`,
};

/** The finance signal's reason, as generateFinanceSignals writes it (SEC-GFS-4). */
const RUNWAY = 'Runway is 0.8 months — critically low.';
/** Text only a finance signal, recommendation or memory event of this fixture carries. */
const MONEY_TEXT = /Runway is 0\.8|health score 42|Net margin is negative/;

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
    `DELETE FROM genome_cross_domain_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_customer_sales_snapshots WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_customer_segments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function countRows(table: string) {
  const [row]: Array<{ n: number }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE business_id = $1`, ID.biz,
  );
  return row.n;
}

async function snapshotCount() {
  return countRows('genome_finance_snapshots');
}

async function crossDomainCount() {
  return countRows('genome_cross_domain_snapshots');
}

async function statusOf(table: 'genome_signals' | 'genome_recommendations', id: string) {
  const rows: Array<{ status: string }> = await db.$queryRawUnsafe(`SELECT status FROM ${table} WHERE id = $1`, id);
  return rows[0]?.status;
}

function patch(route: string, as: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).patch(`${base()}/${route}`).set(HEADER, as).send(body);
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

  const { GenomeSignalService } = await import('../src/modules/business-genome/key-genome/genome-signal.service');
  const { GenomeRecommendationService } = await import('../src/modules/business-genome/key-genome/genome-recommendation.service');
  const { GenomeMemoryService } = await import('../src/modules/business-genome/key-genome/genome-memory.service');
  const { GenomeCustomerSegmentService } = await import('../src/modules/business-genome/key-genome/genome-customer-segment.service');
  const { GenomeSalesMotionService } = await import('../src/modules/business-genome/key-genome/genome-sales-motion.service');
  const { CustomerSalesGenomeService } = await import('../src/modules/business-genome/key-genome/customer-sales-genome.service');
  const { GenomeCrossDomainService } = await import('../src/modules/business-genome/key-genome/genome-cross-domain.service');
  const { GenomeRecommendationRankerService } = await import('../src/modules/business-genome/key-genome/genome-recommendation-ranker.service');
  const { GenomeOpportunityDetectorService } = await import('../src/modules/business-genome/key-genome/genome-opportunity-detector.service');
  const { GenomeAutonomyGateService } = await import('../src/modules/business-genome/key-genome/genome-autonomy-gate.service');
  const { GenomeRecommendationOutcomeService } = await import('../src/modules/business-genome/key-genome/genome-recommendation-outcome.service');
  const { KeyGenomeGovernanceService } = await import('../src/modules/business-genome/key-genome/key-genome-governance.service');

  // KeyGenomeController's collaborators off the routes under test are stubbed
  // (the controller injects each by token).
  const stubs = await Promise.all([
    import('../src/modules/business-genome/key-genome/genome-experiment.service').then((m) => m.GenomeExperimentService),
    import('../src/modules/business-genome/key-genome/department-readiness.service').then((m) => m.DepartmentReadinessService),
    import('../src/modules/business-genome/key-genome/genome-operational-process.service').then((m) => m.GenomeOperationalProcessService),
    import('../src/modules/business-genome/key-genome/genome-delivery-capability.service').then((m) => m.GenomeDeliveryCapabilityService),
    import('../src/modules/business-genome/key-genome/operations-genome.service').then((m) => m.OperationsGenomeService),
    import('../src/modules/business-genome/key-genome/genome-growth-channel.service').then((m) => m.GenomeGrowthChannelService),
    import('../src/modules/business-genome/key-genome/genome-content-strategy.service').then((m) => m.GenomeContentStrategyService),
    import('../src/modules/business-genome/key-genome/marketing-genome.service').then((m) => m.MarketingGenomeService),
  ]);
  // Collaborators the live services reach beyond Prisma. offRoute throws if
  // reached (nothing under test should); noop answers null to every call
  // (outcome learning, department readiness, the outcome recorder: bookkeeping
  // the services do after their own write); rejecting answers a rejected
  // promise (the cross-domain service reads that as "no snapshot").
  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) => () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); },
  });
  const noop = () => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => null) });
  const rejecting = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : async () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); }),
  });
  const factStandIn = { getFact: async () => null, listFacts: async () => [] };
  const readinessStandIn = { getReadiness: async () => [] };
  const scoringStandIn = {
    computeFactScores: async () => [],
    computeBusinessScore: () => ({ overall: 0, confidence: 0, readiness: 0, sections: [] }),
  };

  // The test runner emits no decorator metadata, so the live services (which
  // inject PrismaService by type) are built by factory, as Nest would build
  // them; each is built once and shared, as Nest's singletons are.
  const built: Record<string, any> = {};
  const once = (name: string, make: () => any) => (built[name] ??= make());
  const memoryOf = (prisma: any) => once('memory', () => new GenomeMemoryService(prisma));
  const metricsOf = (prisma: any) => once('metrics', () => new GenomeFinancialMetricService(prisma));
  const signalsOf = (prisma: any) => once('signals', () => new GenomeSignalService(
    prisma, offRoute('GenomeFactService') as any, offRoute('GenomeEvidenceService') as any, offRoute('GenomeScoringService') as any,
    offRoute('GenomeModuleReadinessService') as any, offRoute('EventEmitter2') as any, noop() as any,
  ));
  const recommendationsOf = (prisma: any) => once('recommendations', () => new GenomeRecommendationService(
    prisma, signalsOf(prisma), readinessStandIn as any, scoringStandIn as any, offRoute('GenomeExperimentService') as any,
    memoryOf(prisma), noop() as any, noop() as any,
  ));
  const departmentsOf = (prisma: any) => once('departments', () => new GenomeDepartmentService(prisma));
  const financeOf = (prisma: any) => once('finance', () => new FinanceGenomeService(
    prisma, metricsOf(prisma), factStandIn as any, signalsOf(prisma), recommendationsOf(prisma), memoryOf(prisma), noop() as any,
  ));
  const segmentsOf = (prisma: any) => once('segments', () => new GenomeCustomerSegmentService(prisma));
  const motionsOf = (prisma: any) => once('motions', () => new GenomeSalesMotionService(prisma));
  const customerSalesOf = (prisma: any) => once('customerSales', () => new CustomerSalesGenomeService(
    prisma, metricsOf(prisma), segmentsOf(prisma), motionsOf(prisma), signalsOf(prisma), recommendationsOf(prisma),
    memoryOf(prisma), noop() as any,
  ));
  const crossDomainOf = (prisma: any) => once('crossDomain', () => new GenomeCrossDomainService(
    prisma, financeOf(prisma), customerSalesOf(prisma), rejecting('OperationsGenomeService') as any,
    rejecting('MarketingGenomeService') as any, memoryOf(prisma), departmentsOf(prisma),
  ));
  const live = (token: any, make: (prisma: any) => any) => ({ provide: token, inject: [PrismaService], useFactory: make });

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyGenomeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      live(GenomeFinancialMetricService, metricsOf),
      live(FinanceGenomeService, financeOf),
      live(GenomeDepartmentService, departmentsOf),
      live(GenomeMemoryService, memoryOf),
      live(GenomeSignalService, signalsOf),
      live(GenomeRecommendationService, recommendationsOf),
      live(GenomeCustomerSegmentService, segmentsOf),
      live(GenomeSalesMotionService, motionsOf),
      live(CustomerSalesGenomeService, customerSalesOf),
      live(GenomeCrossDomainService, crossDomainOf),
      live(GenomeRecommendationRankerService, (prisma) => new GenomeRecommendationRankerService(
        recommendationsOf(prisma), crossDomainOf(prisma), memoryOf(prisma), { getLearnedImpact: async () => 0 } as any,
      )),
      live(GenomeOpportunityDetectorService, (prisma) => new GenomeOpportunityDetectorService(
        crossDomainOf(prisma), recommendationsOf(prisma), memoryOf(prisma),
      )),
      live(GenomeAutonomyGateService, (prisma) => new GenomeAutonomyGateService(
        crossDomainOf(prisma), readinessStandIn as any, factStandIn as any, memoryOf(prisma),
      )),
      live(GenomeRecommendationOutcomeService, (prisma) => new GenomeRecommendationOutcomeService(
        prisma, crossDomainOf(prisma), noop() as any,
      )),
      live(KeyGenomeGovernanceService, (prisma) => new KeyGenomeGovernanceService(
        prisma, signalsOf(prisma), recommendationsOf(prisma), { listExperiments: async () => [] } as any,
        readinessStandIn as any, scoringStandIn as any, departmentsOf(prisma),
      )),
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
  // Review repairs: the sibling service methods a refused request must not reach.
  SPY.computeCrossDomainSnapshot = vi.spyOn(moduleRef.get(GenomeCrossDomainService), 'computeCrossDomainSnapshot');
  const customerSales = moduleRef.get(CustomerSalesGenomeService);
  SPY.computeCustomerSalesSnapshot = vi.spyOn(customerSales, 'computeCustomerSalesSnapshot');
  SPY.getLatestCustomerSalesSnapshot = vi.spyOn(customerSales, 'getLatestCustomerSalesSnapshot');
  const ranker = moduleRef.get(GenomeRecommendationRankerService);
  SPY.rankRecommendations = vi.spyOn(ranker, 'rankRecommendations');
  SPY.generateAndRankRecommendations = vi.spyOn(ranker, 'generateAndRankRecommendations');
  SPY.detectOpportunities = vi.spyOn(moduleRef.get(GenomeOpportunityDetectorService), 'detectOpportunities');
  SPY.checkGate = vi.spyOn(moduleRef.get(GenomeAutonomyGateService), 'checkGate');
  SPY.closeObservationWindow = vi.spyOn(moduleRef.get(GenomeRecommendationOutcomeService), 'closeObservationWindow');
  const signalService = moduleRef.get(GenomeSignalService);
  for (const method of ['reviewSignal', 'acceptSignal', 'rejectSignal', 'mergeSignal'] as const) {
    SPY[method] = vi.spyOn(signalService, method);
  }
  const recommendationService = moduleRef.get(GenomeRecommendationService);
  for (const method of [
    'acceptRecommendation', 'dismissRecommendation', 'applyRecommendation', 'ignoreRecommendation',
    'escalateRecommendation', 'trackOutcome',
  ] as const) {
    SPY[method] = vi.spyOn(recommendationService, method);
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

  // Review repairs (SEC-GFS-4, GFS-R2): a finance signal, recommendation and
  // memory events in the shapes FinanceGenomeService and the cross-domain
  // service write them, beside operations rows of the same tables, and an
  // outcome row whose health score was taken from the cross-domain composite.
  await db.genomeSignal.create({
    data: {
      id: ID.sigFin, businessId: ID.biz, sourceModule: 'finance', sourceEntityType: 'FINANCE_GENOME',
      signalType: 'RISK_PATTERN', section: 'FINANCIAL', domain: 'finance', field: 'LOW_RUNWAY',
      reason: RUNWAY, confidence: 0.95, status: 'NEW',
    },
  });
  await db.genomeSignal.create({
    data: {
      id: ID.sigOps, businessId: ID.biz, sourceModule: 'operations', sourceEntityType: 'OPERATIONS_GENOME',
      signalType: 'RISK_PATTERN', section: 'OPERATIONS', domain: 'operations', field: 'NO_SOP',
      reason: 'Core processes have no documented SOP.', confidence: 0.9, status: 'NEW',
    },
  });
  await db.genomeRecommendation.create({
    data: {
      id: ID.recFin, businessId: ID.biz, domain: 'FINANCIAL',
      title: 'Business is losing money on each dollar of revenue',
      insight: 'Net margin is negative (-28.6%).', diagnosis: 'Net margin is negative (-28.6%).',
      recommendation: 'Cut costs or raise prices.', expectedGainScore: 90, riskLevel: 'HIGH', status: 'ACTIVE',
    },
  });
  await db.genomeRecommendation.create({
    data: {
      id: ID.recOps, businessId: ID.biz, domain: 'OPERATIONS', title: 'Document core SOPs',
      insight: 'Core processes have no documented SOP.', diagnosis: 'No SOP recorded.',
      recommendation: 'Write the SOPs.', expectedGainScore: 60, riskLevel: 'HIGH', status: 'ACTIVE',
    },
  });
  for (const [id, sourceType, eventType, domain, summary, impactScore] of [
    [ID.memFin, 'FINANCE_GENOME', 'FINANCE_SNAPSHOT_COMPUTED', 'FINANCIAL', 'Overall risk HIGH, health score 42. 2 warning(s), 0 missing input(s).', 0.42],
    [ID.memCross, 'CROSS_DOMAIN_GENOME', 'CROSS_DOMAIN_SNAPSHOT_COMPUTED', 'CROSS_DOMAIN', 'Overall risk HIGH, health score 42. 1 bottleneck(s), 0 opportunity(ies).', 0.42],
    [ID.memOps, 'OPERATIONS_GENOME', 'OPERATIONS_SNAPSHOT_COMPUTED', 'OPERATIONS', 'Overall risk MEDIUM, delivery readiness 60.', 0.6],
  ] as const) {
    await db.genomeMemoryEvent.create({
      data: { id, businessId: ID.biz, sourceType, eventType, domain, section: domain, title: `${eventType} (${P})`, summary, outcome: 'MIXED', impactScore, occurredAt },
    });
  }
  await db.genomeRecommendationOutcome.create({
    data: {
      id: ID.outOps, businessId: ID.biz, recommendationId: ID.recOps, domain: 'OPERATIONS', actionType: 'RECOMMENDATION',
      decision: 'ACCEPTED', preHealthScore: 42, preReadinessScore: 50, preConfidence: 40, preRiskLevel: 'HIGH',
    },
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

  it('[GFS-08] the module-scoped handlers are exactly the finance, cross-domain, customer-sales snapshot, outcome and memory-summary routes (revenue read; revenue write on the six that write the finance metrics, signals or recommendations or recompute the finance snapshot); the other 67 routes carry none', () => {
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
    const read = { module: 'revenue', minLevel: 'read' };
    const write = { module: 'revenue', minLevel: 'write' };
    expect(scoped).toEqual({
      // D-100 / D-128: the finance figures.
      listFinanceMetrics: read,
      getFinanceSnapshot: read,
      listFinanceSnapshots: read,
      upsertFinanceMetric: write,
      computeFinanceSnapshot: write,
      generateFinanceSignals: write,
      generateFinanceRecommendations: write,
      // Review repairs (SEC-GFS-1/2, GFS-R1): the cross-domain composite.
      getCrossDomainSnapshot: read,
      listCrossDomainSnapshots: read,
      computeCrossDomainSnapshot: write,
      getRankedRecommendations: read,
      generateAndRankRecommendations: read,
      getOpportunities: read,
      detectOpportunities: read,
      checkAutonomyGate: read,
      // SEC-GFS-3: the customer-sales snapshot's revenue, LTV and CAC figures.
      getCustomerSalesSnapshot: read,
      computeCustomerSalesSnapshot: read,
      listCustomerSalesSnapshots: read,
      // GFS-R2: outcome health scores (the composite's) and the memory summary.
      getRecommendationOutcome: read,
      listRecommendationOutcomes: read,
      getRecommendationOutcomesSummary: read,
      getRecommendationLearningSummary: read,
      updateOutcomeObservation: read,
      closeObservationWindow: write,
      memorySummary: read,
    });
  });
});

describe('W11-GENOME-FINANCE-SCOPE review repairs (D-128, SEC-GFS-1, GFS-R1): no member without revenue write recomputes the finance snapshot through a sibling route', () => {
  /** The five routes that compute the cross-domain snapshot (and so the finance snapshot) when none exists. */
  const DERIVED: Array<{ method: 'get' | 'post'; route: string; spy: string; body?: Record<string, unknown> }> = [
    { method: 'get', route: 'cross-domain/recommendations/ranked', spy: 'rankRecommendations' },
    { method: 'post', route: 'cross-domain/recommendations/ranked/generate', spy: 'generateAndRankRecommendations' },
    { method: 'get', route: 'cross-domain/opportunities', spy: 'detectOpportunities' },
    { method: 'post', route: 'cross-domain/opportunities/detect', spy: 'detectOpportunities' },
    { method: 'post', route: 'cross-domain/autonomy-gate/check', spy: 'checkGate', body: { actionType: 'CREATE_TASK', affectedDomains: ['operations_delivery'] } },
  ];
  const call = (d: (typeof DERIVED)[number], as: string) => (d.method === 'get' ? get(d.route, as) : post(d.route, as, d.body));

  it('[GFS-09] RED-BEFORE (D-128, SEC-GFS-1): POST cross-domain/snapshot/compute refuses the revenue none and the revenue read STAFF member 403 before the cross-domain or finance compute runs, and no snapshot is written', async () => {
    const before = await snapshotCount();
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      clearSpies();
      const res = await post('cross-domain/snapshot/compute', as);
      expect(res.status, `revenue ${has}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, `revenue ${has}`).toMatchObject({ code: 'FORBIDDEN', message: WRITE_DENIED(has) });
      expect(SPY.computeCrossDomainSnapshot, `computeCrossDomainSnapshot never runs for revenue ${has}`).not.toHaveBeenCalled();
      expect(SPY.computeFinanceSnapshot, `computeFinanceSnapshot never runs for revenue ${has}`).not.toHaveBeenCalled();
    }
    expect(await snapshotCount(), 'no finance snapshot written').toBe(before);
    expect(await crossDomainCount(), 'no cross-domain snapshot written').toBe(0);
  }, 60_000);

  it('[GFS-10] RED-BEFORE (D-128, SEC-GFS-1): with no cross-domain snapshot, the ranked-recommendation, opportunity and autonomy-gate routes refuse the revenue read STAFF member 403 (revenue write needed to recompute) before the service runs, and the revenue none member 403 (revenue read)', async () => {
    const before = await snapshotCount();
    expect(await crossDomainCount()).toBe(0);
    for (const d of DERIVED) {
      for (const [as, message] of [[ID.staffRead, WRITE_DENIED('read')], [ID.staffNone, READ_DENIED]] as const) {
        clearSpies();
        const res = await call(d, as);
        expect(res.status, `${d.route} as ${as}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body, `${d.route} as ${as}`).toMatchObject({ code: 'FORBIDDEN', message });
        expect(SPY[d.spy], `${d.spy} never runs for ${as}`).not.toHaveBeenCalled();
        expect(SPY.computeFinanceSnapshot, `${d.route}: no finance recompute for ${as}`).not.toHaveBeenCalled();
      }
    }
    expect(await snapshotCount(), 'no finance snapshot written').toBe(before);
    expect(await crossDomainCount(), 'no cross-domain snapshot written').toBe(0);
  }, 60_000);

  it('[GFS-11] RED-BEFORE (D-128): POST outcomes/:outcomeId/close-observation (which always recomputes the cross-domain snapshot) refuses the revenue read STAFF member 403 before the service runs', async () => {
    const before = await snapshotCount();
    clearSpies();
    const res = await post(`outcomes/${ID.outOps}/close-observation`, ID.staffRead);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: WRITE_DENIED('read') });
    expect(SPY.closeObservationWindow).not.toHaveBeenCalled();
    expect(SPY.computeFinanceSnapshot).not.toHaveBeenCalled();
    expect(await snapshotCount()).toBe(before);
    expect(await crossDomainCount()).toBe(0);
  }, 30_000);

  it('[GFS-12] control (D-128): the revenue write STAFF member computes the cross-domain snapshot (201, one finance snapshot written); then the revenue read STAFF member is served the ranked recommendations, opportunities and autonomy gate with no further recompute', async () => {
    const before = await snapshotCount();
    clearSpies();
    const res = await post('cross-domain/snapshot/compute', ID.staffWrite);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((res.body.domainScores as any[]).map((d) => d.domain)).toContain('finance');
    expect(SPY.computeFinanceSnapshot).toHaveBeenCalledTimes(1);
    expect(await snapshotCount()).toBe(before + 1);
    expect(await crossDomainCount()).toBe(1);

    for (const d of DERIVED.filter((x) => x.route !== 'cross-domain/recommendations/ranked/generate')) {
      clearSpies();
      const served = await call(d, ID.staffRead);
      expect(served.status, `${d.route}: ${JSON.stringify(served.body)}`).toBe(d.method === 'get' ? 200 : 201);
      expect(served.body.businessId, d.route).toBe(ID.biz);
      expect(SPY[d.spy], d.route).toHaveBeenCalledTimes(1);
      expect(SPY.computeCrossDomainSnapshot, `${d.route} reuses the snapshot`).not.toHaveBeenCalled();
    }
    expect(await snapshotCount()).toBe(before + 1);
    expect(await crossDomainCount()).toBe(1);
  }, 60_000);
});

describe('W11-GENOME-FINANCE-SCOPE review repairs (D-100, SEC-GFS-2, SEC-GFS-3): the cross-domain composite and the customer-sales figures need revenue read', () => {
  it('[GFS-13] RED-BEFORE (D-100, SEC-GFS-2): the revenue none STAFF member is refused 403 on GET cross-domain/snapshot, cross-domain/snapshots, the ranked recommendations and the opportunities; the revenue read member reads the snapshot', async () => {
    for (const route of ['cross-domain/snapshot', 'cross-domain/snapshots', 'cross-domain/recommendations/ranked', 'cross-domain/opportunities']) {
      clearSpies();
      const res = await get(route, ID.staffNone);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, route).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
      expect(JSON.stringify(res.body), route).not.toMatch(/healthScore|bottlenecks/);
      expect(SPY.rankRecommendations).not.toHaveBeenCalled();
      expect(SPY.detectOpportunities).not.toHaveBeenCalled();
    }
    const control = await get('cross-domain/snapshot', ID.staffRead);
    expect(control.status, JSON.stringify(control.body)).toBe(200);
    expect((control.body.domainScores as any[]).map((d) => d.domain)).toContain('finance');
  }, 60_000);

  it('[GFS-14] RED-BEFORE (D-100, SEC-GFS-3): a revenue none STAFF member may still record a segment, but POST customer-sales/snapshot/compute, GET customer-sales/snapshot and customer-sales/snapshots answer 403 before the service runs, with no revenue per customer or lifetime value; the revenue read member computes and reads them', async () => {
    await db.genomeFinancialMetric.create({
      data: { id: `${P}m_LIFETIME_VALUE`, businessId: ID.biz, metricType: 'LIFETIME_VALUE', period: PERIOD, value: 777.77, currency: 'TTD', confidence: 0.9, occurredAt: new Date(Date.now() - 86400_000) },
    });
    const segment = await post('customer-sales/segments', ID.staffNone, { name: `${P}one`, segmentType: 'B2C', estimatedSize: 1 });
    expect(segment.status, JSON.stringify(segment.body)).toBe(201);

    const before = await countRows('genome_customer_sales_snapshots');
    for (const [method, route, spy] of [
      ['post', 'customer-sales/snapshot/compute', 'computeCustomerSalesSnapshot'],
      ['get', 'customer-sales/snapshot', 'getLatestCustomerSalesSnapshot'],
      ['get', 'customer-sales/snapshots', 'getLatestCustomerSalesSnapshot'],
    ] as const) {
      clearSpies();
      const res = method === 'get' ? await get(route, ID.staffNone) : await post(route, ID.staffNone);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, route).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
      expect(JSON.stringify(res.body), route).not.toMatch(/4321\.5|777\.77/);
      expect(SPY[spy], `${spy} never runs for ${route}`).not.toHaveBeenCalled();
    }
    expect(await countRows('genome_customer_sales_snapshots'), 'no customer-sales snapshot written').toBe(before);

    const computed = await post('customer-sales/snapshot/compute', ID.staffRead);
    expect(computed.status, JSON.stringify(computed.body)).toBe(201);
    expect(computed.body).toMatchObject({ averageRevenuePerCustomer: 4321.5, lifetimeValue: 777.77 });
    const latest = await get('customer-sales/snapshot', ID.staffRead);
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({ id: computed.body.id, averageRevenuePerCustomer: 4321.5 });
  }, 60_000);
});

describe('W11-GENOME-FINANCE-SCOPE review repairs (D-128 read clause, D-100, SEC-GFS-4, GFS-R2): the genome finance signals, recommendations and memory need revenue read', () => {
  it('[GFS-15] RED-BEFORE (D-128, SEC-GFS-4): GET signals and signals?sourceModule=finance serve the revenue none STAFF member no finance signal (the operations signal stays), and GET signals/:id of the finance signal answers 403; the revenue read member reads it', async () => {
    const all = await get('signals', ID.staffNone);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const ids = (all.body as any[]).map((r) => r.id);
    expect(ids).toContain(ID.sigOps);
    expect(ids).not.toContain(ID.sigFin);
    expect(JSON.stringify(all.body)).not.toMatch(MONEY_TEXT);

    const finance = await get('signals?sourceModule=finance', ID.staffNone);
    expect(finance.status).toBe(200);
    expect(finance.body).toEqual([]);
    const limited = await get('signals?limit=1', ID.staffNone);
    expect((limited.body as any[]).map((r) => r.id)).toEqual([ID.sigOps]);

    const byId = await get(`signals/${ID.sigFin}`, ID.staffNone);
    expect(byId.status, JSON.stringify(byId.body)).toBe(403);
    expect(byId.body).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
    expect((await get(`signals/${ID.sigOps}`, ID.staffNone)).status).toBe(200);

    const control = await get('signals?sourceModule=finance', ID.staffRead);
    expect((control.body as any[]).map((r) => [r.id, r.reason])).toEqual([[ID.sigFin, RUNWAY]]);
    expect((await get(`signals/${ID.sigFin}`, ID.staffRead)).body).toMatchObject({ id: ID.sigFin, reason: RUNWAY });
  }, 30_000);

  it('[GFS-16] RED-BEFORE (D-128): GET recommendations and recommendations?domain=FINANCIAL serve the revenue none STAFF member no finance recommendation, and GET recommendations/:id and its execution-status answer 403; the revenue read member reads it', async () => {
    const all = await get('recommendations', ID.staffNone);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const ids = (all.body as any[]).map((r) => r.id);
    expect(ids).toContain(ID.recOps);
    expect(ids).not.toContain(ID.recFin);
    expect(JSON.stringify(all.body)).not.toMatch(MONEY_TEXT);
    expect((await get('recommendations?domain=FINANCIAL', ID.staffNone)).body).toEqual([]);

    for (const route of [`recommendations/${ID.recFin}`, `recommendations/${ID.recFin}/execution-status`]) {
      const res = await get(route, ID.staffNone);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, route).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
    }
    expect((await get(`recommendations/${ID.recOps}`, ID.staffNone)).status).toBe(200);

    const control = await get('recommendations?domain=FINANCIAL', ID.staffRead);
    expect((control.body as any[]).map((r) => r.id)).toEqual([ID.recFin]);
    expect((await get(`recommendations/${ID.recFin}`, ID.staffRead)).body).toMatchObject({ id: ID.recFin, domain: 'FINANCIAL' });
  }, 30_000);

  it('[GFS-17] RED-BEFORE (D-100, SEC-GFS-4): GET memory, memory?domain=FINANCIAL and memory/similar serve the revenue none STAFF member no finance or cross-domain event, GET memory/:id of one and GET memory/summary answer 403; the revenue read member reads them', async () => {
    const isMoney = (e: any) => /financ/i.test(`${e.domain} ${e.section} ${e.sourceType}`) || e.sourceType === 'CROSS_DOMAIN_GENOME';
    for (const route of ['memory', 'memory?domain=FINANCIAL', 'memory?domain=CROSS_DOMAIN', 'memory/similar', 'memory/similar?domain=FINANCIAL']) {
      const res = await get(route, ID.staffNone);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((res.body as any[]).filter(isMoney), route).toEqual([]);
      expect(JSON.stringify(res.body), route).not.toMatch(MONEY_TEXT);
    }
    expect(((await get('memory', ID.staffNone)).body as any[]).map((e) => e.id)).toContain(ID.memOps);

    for (const route of [`memory/${ID.memFin}`, `memory/${ID.memCross}`, 'memory/summary']) {
      const res = await get(route, ID.staffNone);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, route).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
    }
    expect((await get(`memory/${ID.memOps}`, ID.staffNone)).status).toBe(200);

    const control = await get('memory?domain=FINANCIAL', ID.staffRead);
    expect((control.body as any[]).map((e) => e.id)).toContain(ID.memFin);
    expect((await get(`memory/${ID.memFin}`, ID.staffRead)).status).toBe(200);
    expect((await get('memory/summary', ID.staffRead)).status).toBe(200);
  }, 30_000);

  it('[GFS-18] RED-BEFORE (D-128): GET governance and governance/queue carry no item naming the finance signal or recommendation for the revenue none STAFF member (the operations items stay); the revenue read member sees them', async () => {
    const summary = await get('governance', ID.staffNone);
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    const sourceIds = (items: any[]) => (items ?? []).map((i) => i.sourceId);
    for (const list of ['urgentReviewItems', 'signalReviewQueue', 'recommendationQueue']) {
      expect(sourceIds(summary.body[list]), list).not.toContain(ID.sigFin);
      expect(sourceIds(summary.body[list]), list).not.toContain(ID.recFin);
    }
    expect(sourceIds(summary.body.signalReviewQueue)).toContain(ID.sigOps);
    expect(sourceIds(summary.body.recommendationQueue)).toContain(ID.recOps);
    expect(JSON.stringify(summary.body)).not.toMatch(MONEY_TEXT);

    const queue = await get('governance/queue', ID.staffNone);
    expect(queue.status).toBe(200);
    expect(sourceIds(queue.body)).not.toContain(ID.sigFin);
    expect(sourceIds(queue.body)).not.toContain(ID.recFin);
    expect(JSON.stringify(queue.body)).not.toMatch(MONEY_TEXT);

    const control = await get('governance', ID.staffRead);
    expect(sourceIds(control.body.signalReviewQueue)).toContain(ID.sigFin);
    expect(sourceIds(control.body.recommendationQueue)).toContain(ID.recFin);
  }, 30_000);

  it('[GFS-19] RED-BEFORE (D-128): reviewing, accepting, rejecting or merging the finance signal and accepting, dismissing, applying, ignoring, escalating or tracking the finance recommendation refuse the revenue read STAFF member 403 before the service runs; the operations rows stay open to that member and the revenue write member acts on the finance rows', async () => {
    for (const action of ['review', 'accept', 'reject', 'merge']) {
      clearSpies();
      const res = await post(`signals/${ID.sigFin}/${action}`, ID.staffRead);
      expect(res.status, `signal ${action}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, `signal ${action}`).toMatchObject({ code: 'FORBIDDEN', message: WRITE_DENIED('read') });
      expect(SPY[`${action}Signal`], `${action}Signal never runs`).not.toHaveBeenCalled();
    }
    expect(await statusOf('genome_signals', ID.sigFin)).toBe('NEW');

    for (const [action, spy, body] of [
      ['accept', 'acceptRecommendation', undefined],
      ['dismiss', 'dismissRecommendation', { reason: 'no' }],
      ['apply', 'applyRecommendation', undefined],
      ['ignore', 'ignoreRecommendation', { reason: 'no' }],
      ['escalate', 'escalateRecommendation', undefined],
      ['track-outcome', 'trackOutcome', { success: false, notes: 'no' }],
    ] as const) {
      clearSpies();
      const res = await post(`recommendations/${ID.recFin}/${action}`, ID.staffRead, body);
      expect(res.status, `recommendation ${action}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, `recommendation ${action}`).toMatchObject({ code: 'FORBIDDEN', message: WRITE_DENIED('read') });
      expect(SPY[spy], `${spy} never runs`).not.toHaveBeenCalled();
    }
    expect(await statusOf('genome_recommendations', ID.recFin)).toBe('ACTIVE');

    const opsSignal = await post(`signals/${ID.sigOps}/accept`, ID.staffRead);
    expect(opsSignal.status, JSON.stringify(opsSignal.body)).toBe(201);
    expect(await statusOf('genome_signals', ID.sigOps)).toBe('ACCEPTED');
    const opsRec = await post(`recommendations/${ID.recOps}/accept`, ID.staffRead);
    expect(opsRec.status, JSON.stringify(opsRec.body)).toBe(201);
    expect(await statusOf('genome_recommendations', ID.recOps)).toBe('ACCEPTED');

    const finSignal = await post(`signals/${ID.sigFin}/accept`, ID.staffWrite);
    expect(finSignal.status, JSON.stringify(finSignal.body)).toBe(201);
    expect(await statusOf('genome_signals', ID.sigFin)).toBe('ACCEPTED');
    const finRec = await post(`recommendations/${ID.recFin}/accept`, ID.staffWrite);
    expect(finRec.status, JSON.stringify(finRec.body)).toBe(201);
    expect(await statusOf('genome_recommendations', ID.recFin)).toBe('ACCEPTED');
  }, 60_000);

  it('[GFS-20] RED-BEFORE (D-100): the outcome reads (their health scores are the cross-domain composite\'s) answer the revenue none STAFF member 403; the revenue read member reads them', async () => {
    for (const [method, route] of [
      ['get', 'outcomes'],
      ['get', 'outcomes/summary'],
      ['get', 'outcomes/learning-summary'],
      ['get', `recommendations/${ID.recOps}/outcome`],
      ['patch', `outcomes/${ID.outOps}/observation`],
    ] as const) {
      const res = method === 'get' ? await get(route, ID.staffNone) : await patch(route, ID.staffNone, { postHealthScore: 50 });
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body, route).toMatchObject({ code: 'FORBIDDEN', message: READ_DENIED });
    }
    const rows: Array<{ post_health_score: number | null }> = await db.$queryRawUnsafe(
      `SELECT post_health_score FROM genome_recommendation_outcomes WHERE id = $1`, ID.outOps,
    );
    expect(rows).toEqual([{ post_health_score: null }]);

    const control = await get('outcomes', ID.staffRead);
    expect(control.status, JSON.stringify(control.body)).toBe(200);
    expect(JSON.stringify(control.body)).toContain(ID.outOps);
  }, 30_000);
});

/**
 * W11A-SEAM-REPAIR (seam B1 W11-KEY-ORGAN-AUTHORITY-MAP x B2 W11-GENOME-FINANCE-SCOPE; owner rulings D-128,
 * D-100, D-131). B1 maps the KEY organ tools key_genome.list_signals and key_genome.list_recommendations to
 * settings read (D-131), so KEY chat and an approved proposal run them for a member holding settings read;
 * their handlers (KeyGenomeAdapterService) answered every row, the finance ones included. B2 holds the same
 * rows to revenue read on REST (GFS-15, GFS-16). At 8109839a a member with settings read and revenue none
 * (an ADMIN whose explicit map is the ADMIN defaults with revenue none, the D-114 population; a STAFF member
 * with settings read) was served on KEY the finance signal and the FINANCIAL recommendation the REST routes
 * withhold from them. The organ path now applies B2's own projection (genome-finance-scope.ts) for the member
 * the call runs for (ctx.userId), so both paths serve that member the same rows.
 *
 * The adapter is the production class, built here over the suite's live GenomeSignalService,
 * GenomeRecommendationService and PrismaService (the services REST uses); memberToolRunAuthority is the
 * production rule KEY chat, the plan queue and approved proposals apply before the organ runs.
 */
describe('W11A-SEAM-REPAIR (D-128, D-100, D-131): the KEY genome organ tools serve a member the signals and recommendations the REST routes serve them', () => {
  const KEY = {
    adminNoRev: `${P}adminNoRev`, // ADMIN, explicit map: ADMIN defaults with revenue none (D-114)
    staffSettings: `${P}staffSettings`, // STAFF, explicit map: settings read, revenue none
    staffSettingsRev: `${P}staffSetRev`, // STAFF, explicit map: settings read, revenue read (control)
  };
  const TOOLS = { signals: 'key_genome.list_signals', recommendations: 'key_genome.list_recommendations' } as const;
  let adapter: any;
  let prismaSvc: any;
  let memberToolRunAuthority: any;

  beforeAll(async () => {
    const { defaultScopesForRole } = await import('../src/core/authority/module-vocabulary');
    for (const [id, role, permissionScopes] of [
      [KEY.adminNoRev, 'ADMIN', { ...defaultScopesForRole('ADMIN'), revenue: 'none' }],
      [KEY.staffSettings, 'STAFF', { settings: 'read', revenue: 'none' }],
      [KEY.staffSettingsRev, 'STAFF', { settings: 'read', revenue: 'read' }],
    ] as const) {
      await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
      await db.membership.create({ data: { id: `${id}_m`, userId: id, businessId: ID.biz, role, permissionScopes } });
    }
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GenomeSignalService } = await import('../src/modules/business-genome/key-genome/genome-signal.service');
    const { GenomeRecommendationService } = await import('../src/modules/business-genome/key-genome/genome-recommendation.service');
    const { KeyGenomeAdapterService } = await import('../src/modules/key-cortex/organs/key-genome-adapter.service');
    ({ memberToolRunAuthority } = await import('../src/modules/ai/plan-step-authority'));
    prismaSvc = app.get(PrismaService);
    const offRoute = (name: string) => new Proxy({}, {
      get: (_t, prop) => () => { throw new Error(`${name}.${String(prop)} is off the organ tools under test`); },
    });
    adapter = new KeyGenomeAdapterService(
      offRoute('BlueprintService') as any,
      app.get(GenomeSignalService),
      app.get(GenomeRecommendationService),
      offRoute('GenomeFactService') as any,
      offRoute('GenomeModuleReadinessService') as any,
      offRoute('GenomeScoringService') as any,
      { publish: () => undefined, subscribe: () => undefined } as any,
      prismaSvc,
    );
  }, 60_000);

  /** The ids the KEY organ tool answers the member `userId` (ctx.userId: the member the call runs for). */
  async function keyIds(tool: string, userId: string | undefined, input: Record<string, unknown> = {}) {
    const result = await adapter.executeTool(tool, { businessId: ID.biz, ...(userId ? { userId } : {}) }, input);
    expect(result.success, JSON.stringify(result)).toBe(true);
    const rows: any[] = tool === TOOLS.signals ? result.data.signals : result.data.recommendations;
    expect(result.data.count, tool).toBe(rows.length);
    return { ids: rows.map((r) => r.id), text: JSON.stringify(result.data) };
  }

  /** The ids GET signals / GET recommendations answers the same member. */
  async function restIds(route: 'signals' | 'recommendations', userId: string, query = '') {
    const res = await get(`${route}${query}`, userId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body as any[]).map((r) => r.id);
  }

  it('[GFS-21] RED-BEFORE (D-128 x D-131): an ADMIN whose explicit map sets revenue none and a STAFF member with settings read and revenue none may run both organ tools on KEY (settings read), and are served exactly the rows GET signals and GET recommendations serve them: no finance signal, no FINANCIAL recommendation, the limit counting the rows they are served', async () => {
    for (const member of [KEY.adminNoRev, KEY.staffSettings]) {
      for (const tool of Object.values(TOOLS)) {
        expect(await memberToolRunAuthority(prismaSvc, ID.biz, member, tool), `${member} ${tool}`).toEqual({ refusal: null, principal: false });
      }

      const rest = await restIds('signals', member);
      const key = await keyIds(TOOLS.signals, member);
      expect(key.ids, `${member} signals`).toEqual(rest);
      expect(key.ids, member).toContain(ID.sigOps);
      expect(key.ids, member).not.toContain(ID.sigFin);
      expect(key.text, member).not.toMatch(MONEY_TEXT);
      expect((await keyIds(TOOLS.signals, member, { limit: 1 })).ids, `${member} signals limit 1`).toEqual(await restIds('signals', member, '?limit=1'));

      const restRecs = await restIds('recommendations', member);
      const keyRecs = await keyIds(TOOLS.recommendations, member);
      expect(keyRecs.ids, `${member} recommendations`).toEqual(restRecs);
      expect(keyRecs.ids, member).toContain(ID.recOps);
      expect(keyRecs.ids, member).not.toContain(ID.recFin);
      expect(keyRecs.text, member).not.toMatch(MONEY_TEXT);
      expect((await keyIds(TOOLS.recommendations, member, { limit: 1 })).ids, `${member} recommendations limit 1`).toEqual(
        await restIds('recommendations', member, '?limit=1'),
      );
    }
  }, 60_000);

  it('[GFS-22] RED-BEFORE (D-128, D-73: fail closed): a KEY organ call that runs for no member (no ctx.userId) is served no finance signal and no FINANCIAL recommendation', async () => {
    const signals = await keyIds(TOOLS.signals, undefined);
    expect(signals.ids).toContain(ID.sigOps);
    expect(signals.ids).not.toContain(ID.sigFin);
    const recommendations = await keyIds(TOOLS.recommendations, undefined);
    expect(recommendations.ids).toContain(ID.recOps);
    expect(recommendations.ids).not.toContain(ID.recFin);
  }, 30_000);

  it('[GFS-23] control (D-128, D-125): the owner (OWNER membership) and a STAFF member with settings read and revenue read are served the finance rows on KEY, exactly as GET signals and GET recommendations serve them', async () => {
    for (const member of [ID.owner, KEY.staffSettingsRev]) {
      for (const tool of Object.values(TOOLS)) {
        expect(await memberToolRunAuthority(prismaSvc, ID.biz, member, tool), `${member} ${tool}`).toEqual({ refusal: null, principal: false });
      }
      const key = await keyIds(TOOLS.signals, member);
      expect(key.ids, member).toEqual(await restIds('signals', member));
      expect(key.ids, member).toContain(ID.sigFin);
      const keyRecs = await keyIds(TOOLS.recommendations, member);
      expect(keyRecs.ids, member).toEqual(await restIds('recommendations', member));
      expect(keyRecs.ids, member).toContain(ID.recFin);
    }
  }, 30_000);
});
