/**
 * FU-GENOME-EVOLUTION-SURFACES (owner rulings D-128, D-233, D-238). Found by the FU-KEY-ACTION-GENOME-PROJECTION reviews:
 * the genome-evolution proposals that packet withholds from the timeline, and the composite and rule-trace data beside
 * them, are served whole one route away. For a STAFF member whose explicit scope map says revenue:'none' (and, where a
 * write is gated, revenue:'read'):
 *
 *   GES-01  GET business-genome/.../evolution-proposals serves only the non-financial proposals (financial and sales
 *           sections, a reason or patch that states money or a figure, are withheld; the rules of
 *           isFinancialGenomeEvolution).
 *   GES-02  approve / reject / edit of a financial proposal need revenue write (ModuleScopeGuard's message); the row and
 *           the DNA are unchanged. An edit that would make a proposal financial needs revenue write too.
 *   GES-03  approve of a non-financial proposal answers the proposal without the genome integrity result (its DNA scores
 *           include finance and sales, D-233); the owner is answered both.
 *   GES-04  generate-from-temporal-flow answers only the non-financial proposals it generated.
 *   GES-05  GET business-command-center/.../snapshot: GENOME_PROPOSAL items, the executive brief and the mode briefs carry
 *           no financial proposal's text.
 *   GES-06  GET intelligence/.../executive-brief and key-modes/:mode: the pending-proposal insight counts and quotes only
 *           the non-financial proposals.
 *   GES-07  GET /api/v1/cortex/audit/decisions: a verdict on a money action, or whose reason states money, is withheld;
 *           the others are served with their rule-trace metadata left out (the genome gate's scores average finance in).
 *   GES-08  Timeline: genome.updated and constitution.version_generated rows are served without their composite scores
 *           (genomeIntegrity, executiveReadinessScore: they weight the financial DNA section, D-233).
 *   GES-09  GET key-genome/experiments and experiments/:id: an experiment bridged from a FINANCIAL recommendation, or
 *           whose text states money, needs revenue read; start / complete / cancel of one need revenue write.
 *   GES-10  Controls: the owner and a revenue-read member are served every row unchanged; a member of another business is
 *           refused; another business's ids answer 404.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, the global
 * TenantInterceptor, GenomeEvolutionService, BusinessCommandCenterService, BusinessIntelligenceService,
 * KeyExecutiveModeService, KeyActionProposalService's reads, TemporalFlowService, GenomeExperimentService and the KEY
 * cortex audit route run against the database at DATABASE_URL. Stand-ins: BlueprintService answers a fixed genome (its
 * blueprint write is recorded), and every collaborator off these routes throws if reached (the command center records
 * such a source FAILED and answers its fallback, as it does in production). Identity attachment is a stand-in: a test
 * middleware reads `x-test-user` and attaches `{ id, email, role }` as AuthMiddleware would.
 *
 * Fixtures: prefix `v76g_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL in beforeAll and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v76g_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffMissing: `${P}staffMissing`,
  staffNoAi: `${P}staffNoAi`,
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  biz2: `${P}biz2`,
  biz3: `${P}biz3`,
  evoFin: `${P}evo_fin`,
  evoSales: `${P}evo_sales`,
  evoOpsMoney: `${P}evo_opsm`,
  evoOps: `${P}evo_ops`,
  evoGrowth: `${P}evo_growth`,
  evoFinAct: `${P}evo_finact`,
  evoFinOwner: `${P}evo_finown`,
  evoOpsAct: `${P}evo_opsact`,
  evoOpsOwner: `${P}evo_opsown`,
  evoOpsEdit: `${P}evo_opsedit`,
  evoOther: `${P}evo_other`,
  recFin: `${P}rec_fin`,
  expFin: `${P}exp_fin`,
  expOps: `${P}exp_ops`,
  expMoney: `${P}exp_money`,
  expOther: `${P}exp_other`,
  expPaidChannel: `${P}exp_paidch`,
  expResult: `${P}exp_result`,
  recOtherBiz: `${P}rec_otherbiz`,
  propFinVerdict: `${P}prop_finv`,
  vProp: `${P}v_prop`,
  vFin: `${P}v_fin`,
  vOps: `${P}v_ops`,
  vOpsReason: `${P}v_opsr`,
};

/** Figures only the financial rows of this fixture carry. */
const FIGURES = /31\.7|4,?500\.25|TTD 912|8,?765\.43/;
const READ_DENIED = 'Insufficient permissions: revenue requires read access (you have none)';
const WRITE_DENIED = (has: 'none' | 'read') => `Insufficient permissions: revenue requires write access (you have ${has})`;

/** The genome integrity result the BlueprintService stand-in answers: finance and sales scores in it (D-233). */
const GENOME = {
  genomeIntegrity: 57, threePillarMinimumMet: true, genomeStage: 'GROWTH', executiveReadinessScore: 61,
  genomeDnaScores: { founder: 70, business: 70, market: 70, financial: 23, sales: 41, operations: 66 },
  genomeDnaConfidence: {}, dnaSections: [], readinessBreakdown: { financial: 23, sales: 41 },
};

let db: any;
let app: any;
const dnaWrites: unknown[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autonomy_verdicts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_experiments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_recommendations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

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

const get = (url: string, as: string) => request(app.getHttpServer()).get(url).set(HEADER, as);
const post = (url: string, as: string, body: Record<string, unknown> = {}) => request(app.getHttpServer()).post(url).set(HEADER, as).send(body);
const patch = (url: string, as: string, body: Record<string, unknown>) => request(app.getHttpServer()).patch(url).set(HEADER, as).send(body);

const evoUrl = (biz = ID.biz) => `/business-genome/businesses/${biz}/evolution-proposals`;
const expUrl = (biz = ID.biz) => `/business-genome/businesses/${biz}/key-genome/experiments`;
const statusOf = async (id: string) => (await db.genomeEvolutionProposal.findUnique({ where: { id } }))?.status;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { GenomeEvolutionController } = await import('../src/modules/business-genome/genome-evolution.controller');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { TemporalFlowController } = await import('../src/modules/temporal-flow/temporal-flow.controller');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { TemporalFlowMemoryQueueService } = await import('../src/modules/temporal-flow/temporal-flow-memory.queue.service');
  const { TemporalFlowGenomeBridgeService } = await import('../src/modules/temporal-flow/temporal-flow-genome-bridge.service');
  const { BusinessCommandCenterController } = await import('../src/modules/business-command-center/business-command-center.controller');
  const { BusinessCommandCenterService } = await import('../src/modules/business-command-center/business-command-center.service');
  const { BusinessIntelligenceController } = await import('../src/modules/intelligence/business-intelligence.controller');
  const { BusinessIntelligenceService } = await import('../src/modules/intelligence/business-intelligence.service');
  const { KeyExecutiveModeController } = await import('../src/modules/intelligence/key-executive-mode.controller');
  const { KeyExecutiveModeService } = await import('../src/modules/intelligence/key-executive-mode.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyCortexAuditController } = await import('../src/modules/key-cortex/key-cortex-audit.controller');
  const { EvalHarnessService } = await import('../src/modules/key-cortex/eval-harness.service');
  const { SelfAssessmentService } = await import('../src/modules/key-cortex/self-assessment.service');
  const { DigitalEmployeeAcceptanceService } = await import('../src/modules/key-cortex/digital-employee-acceptance.service');
  const { ValueLearningService } = await import('../src/modules/key-cortex/value-learning.service');
  const { ComplianceMapService } = await import('../src/modules/key-autonomy/compliance-map.service');
  const { KeyGenomeController } = await import('../src/modules/business-genome/key-genome/key-genome.controller');
  const { GenomeExperimentService } = await import('../src/modules/business-genome/key-genome/genome-experiment.service');
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');

  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' || (typeof prop === 'string' && /^(on|before)(Module|Application)/.test(prop))
      ? undefined
      : () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); }),
  });

  // The KEY cortex audit controller injects by type with no @Inject tokens; the test runner emits no decorator
  // metadata, so it is written here exactly as tsc emits it (as cortex-audit-tenant.integration.test.ts does).
  const emitParamTypes = (cls: object, types: unknown[]) => {
    if (!Reflect.getMetadata('design:paramtypes', cls)) Reflect.defineMetadata('design:paramtypes', types, cls);
  };
  emitParamTypes(KeyCortexAuditController, [
    PrismaService, EvalHarnessService, SelfAssessmentService, DigitalEmployeeAcceptanceService, ValueLearningService, ComplianceMapService,
  ]);

  // BlueprintService stand-in: the genome it answers (finance and sales scores in it), its blueprint read, and a
  // recorded DNA write. GenomeGateGuard reads calculateGenomeIntegrity (three-pillar minimum met).
  const blueprintStandIn = {
    calculateGenomeIntegrity: async () => GENOME,
    getBlueprint: async () => ({ genomeIntegrity: 57, executiveReadinessScore: 61, genomeStage: 'GROWTH', genomeDnaScores: {} }),
    updateDnaSection: async (businessId: string, section: string, data: unknown) => { dnaWrites.push({ businessId, section, data }); return {}; },
  };

  const built: Record<string, any> = {};
  const once = (name: string, make: () => any) => (built[name] ??= make());
  const temporalOf = (prisma: any) => once('temporal', () => new TemporalFlowService(prisma, undefined as any, undefined as any));
  const evolutionOf = (prisma: any) => once('evolution', () => new GenomeEvolutionService(prisma, blueprintStandIn as any, temporalOf(prisma)));
  const proposalsOf = (prisma: any) => once('proposals', () => new KeyActionProposalService(
    prisma, temporalOf(prisma), offRoute('EventEmitter2') as any, offRoute('KeyActionPolicyService') as any,
    offRoute('KeyActionExecutorService') as any, offRoute('KeyActionGenomePolicyService') as any,
    offRoute('AutonomyOrchestratorService') as any, offRoute('KeyActionBoundaryService') as any,
  ));
  const assetsStandIn = { list: async () => [] };
  const intelligenceOf = (prisma: any) => once('intelligence', () => new BusinessIntelligenceService(
    blueprintStandIn as any, temporalOf(prisma), evolutionOf(prisma), assetsStandIn as any,
  ));
  const modesOf = (prisma: any) => once('modes', () => new KeyExecutiveModeService(
    intelligenceOf(prisma), blueprintStandIn as any, temporalOf(prisma), evolutionOf(prisma), assetsStandIn as any,
  ));
  const commandCenterOf = (prisma: any) => once('commandCenter', () => new BusinessCommandCenterService(
    intelligenceOf(prisma), modesOf(prisma), proposalsOf(prisma), temporalOf(prisma), evolutionOf(prisma), blueprintStandIn as any,
    assetsStandIn as any, offRoute('ConstitutionVersionService') as any, offRoute('GenomeScoringService') as any,
    offRoute('GenomeModuleReadinessService') as any, offRoute('GenomeSignalService') as any,
    offRoute('GenomeRecommendationService') as any, offRoute('CommandCenterKeyGenomeBridgeService') as any, prisma,
  ));
  const experimentsOf = (prisma: any) => once('experiments', () => new GenomeExperimentService(prisma, new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => null) }) as any));
  const live = (token: any, make: (prisma: any) => any) => ({ provide: token, inject: [PrismaService], useFactory: make });
  // Round 2 (security MAJOR-4): the governance summary, real, over this fixture's experiments; its other inputs (signals,
  // recommendations, readiness, departments, scores) are empty.
  const { KeyGenomeGovernanceService } = await import('../src/modules/business-genome/key-genome/key-genome-governance.service');
  const governanceOf = (prisma: any) => once('governance', () => new KeyGenomeGovernanceService(
    prisma, { listSignals: async () => [] } as any, { listRecommendations: async () => [] } as any, experimentsOf(prisma),
    { getReadiness: async () => [] } as any,
    { computeFactScores: async () => [], computeBusinessScore: () => ({ overall: 0, integrity: 0, readiness: 0, confidence: 0, sections: [] }) } as any,
    { listDepartments: async () => [] } as any,
  ));

  // KeyGenomeController's collaborators other than the experiment service and Prisma are off these routes.
  const keyGenomeStubs = await Promise.all([
    import('../src/modules/business-genome/key-genome/genome-signal.service').then((m) => m.GenomeSignalService),
    import('../src/modules/business-genome/key-genome/genome-recommendation.service').then((m) => m.GenomeRecommendationService),
    import('../src/modules/business-genome/key-genome/key-genome-governance.service').then((m) => m.KeyGenomeGovernanceService),
    import('../src/modules/business-genome/key-genome/genome-memory.service').then((m) => m.GenomeMemoryService),
    import('../src/modules/business-genome/key-genome/genome-department.service').then((m) => m.GenomeDepartmentService),
    import('../src/modules/business-genome/key-genome/department-readiness.service').then((m) => m.DepartmentReadinessService),
    import('../src/modules/business-genome/key-genome/genome-financial-metric.service').then((m) => m.GenomeFinancialMetricService),
    import('../src/modules/business-genome/key-genome/finance-genome.service').then((m) => m.FinanceGenomeService),
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

  const moduleRef = await Test.createTestingModule({
    controllers: [
      GenomeEvolutionController, TemporalFlowController, BusinessCommandCenterController, BusinessIntelligenceController,
      KeyExecutiveModeController, KeyCortexAuditController, KeyGenomeController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: BlueprintService, useValue: blueprintStandIn },
      { provide: GenomeGateGuard, useFactory: () => new GenomeGateGuard(blueprintStandIn as any) },
      live(TemporalFlowService, temporalOf),
      live(GenomeEvolutionService, evolutionOf),
      live(KeyActionProposalService, proposalsOf),
      live(BusinessIntelligenceService, intelligenceOf),
      live(KeyExecutiveModeService, modesOf),
      live(BusinessCommandCenterService, commandCenterOf),
      live(GenomeExperimentService, experimentsOf),
      { provide: TemporalFlowMemoryService, useValue: offRoute('TemporalFlowMemoryService') },
      { provide: TemporalFlowMemoryQueueService, useValue: offRoute('TemporalFlowMemoryQueueService') },
      { provide: TemporalFlowGenomeBridgeService, useValue: offRoute('TemporalFlowGenomeBridgeService') },
      { provide: EvalHarnessService, useValue: offRoute('EvalHarnessService') },
      { provide: SelfAssessmentService, useValue: offRoute('SelfAssessmentService') },
      { provide: DigitalEmployeeAcceptanceService, useValue: offRoute('DigitalEmployeeAcceptanceService') },
      { provide: ValueLearningService, useValue: offRoute('ValueLearningService') },
      { provide: ComplianceMapService, useValue: offRoute('ComplianceMapService') },
      live(KeyGenomeGovernanceService, governanceOf),
      ...keyGenomeStubs.filter((token) => token !== KeyGenomeGovernanceService).map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();

  const prisma = moduleRef.get(PrismaService);
  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.staffMissing, ID.staffNoAi, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V76G Evolution', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.biz2, name: 'V76G Other', slug: `${P}biz2`, ownerId: ID.outsider, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.biz3, name: 'V76G Generate', slug: `${P}biz3`, ownerId: ID.owner, currency: 'TTD' } });
  for (const [user, biz, role, permissionScopes] of [
    [ID.owner, ID.biz, 'OWNER', undefined],
    [ID.staffNone, ID.biz, 'STAFF', { revenue: 'none', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    [ID.staffRead, ID.biz, 'STAFF', { revenue: 'read', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    // Round 2: an explicit map with no revenue key (reads revenue none), and a member who reads revenue but not KEY (ai).
    [ID.staffMissing, ID.biz, 'STAFF', { crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    [ID.staffNoAi, ID.biz, 'STAFF', { revenue: 'read', crm: 'read', ai: 'none' }],
    [ID.outsider, ID.biz2, 'OWNER', undefined],
    [ID.owner, ID.biz3, 'OWNER', undefined],
    [ID.staffNone, ID.biz3, 'STAFF', { revenue: 'none', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
  ] as const) {
    await db.membership.create({
      data: { id: `${user}_${biz}_m`, userId: user, businessId: biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }

  // Genome evolution proposals (PENDING), as GenomeEvolutionService.create writes them.
  const evo = (id: string, businessId: string, section: string, reason: string, proposedPatch: Record<string, unknown>, evidence: string[] = []) =>
    db.genomeEvolutionProposal.create({ data: { id, businessId, section, reason, proposedPatch, evidence, status: 'PENDING', confidence: 0.6 } });
  await evo(ID.evoFin, ID.biz, 'financial', 'Gross margin moved to 31.7% this quarter', { pricingModel: 'retainer' }, ['Net margin 31.7% in October']);
  await evo(ID.evoSales, ID.biz, 'sales', 'Average deal closes at TTD 4,500.25', { salesChannels: ['direct-invoice'] });
  await evo(ID.evoOpsMoney, ID.biz, 'operations', 'Overtime cost TTD 912 last week', { coreWorkflows: ['overtime review'] });
  await evo(ID.evoOps, ID.biz, 'operations', 'Bookings are handled through WhatsApp', { coreWorkflows: ['appointment-booking'] });
  await evo(ID.evoGrowth, ID.biz, 'growth', 'Repeat clients come back through WhatsApp', { sevenDayPlan: ['Ask for referrals'] });
  await evo(ID.evoFinAct, ID.biz, 'financial', 'Pricing review', { avgTicket: 4500.25 });
  // Round 2 (correctness MINOR-8): the owner-parity approval has its own row (no order dependence on GES-02).
  await evo(ID.evoFinOwner, ID.biz, 'financial', 'Pricing review', { avgTicket: 4500.25 });
  await evo(ID.evoOpsAct, ID.biz, 'operations', 'Confirm appointments by message', { coreWorkflows: ['confirmation'] });
  await evo(ID.evoOpsOwner, ID.biz, 'operations', 'Track no-shows', { coreWorkflows: ['no-show tracking'] });
  await evo(ID.evoOpsEdit, ID.biz, 'operations', 'Reminder the day before', { coreWorkflows: ['reminders'] });
  await evo(ID.evoOther, ID.biz2, 'operations', 'Bookings are handled through WhatsApp', { coreWorkflows: ['appointment-booking'] });

  // A FINANCIAL recommendation bridged to an experiment (neutral text: financial by provenance), a neutral experiment,
  // one whose own text states money, and one of another business.
  const exp = (id: string, businessId: string, hypothesis: string, action: string, successMetric: string) =>
    db.genomeExperiment.create({ data: { id, businessId, hypothesis, action, successMetric, riskLevel: 'MEDIUM', status: 'PROPOSED' } });
  await exp(ID.expFin, ID.biz, 'A weekly follow-up cadence helps', 'Send a weekly follow-up', 'Measure whether the recommendation improves the target business outcome.');
  await exp(ID.expOps, ID.biz, 'Reminders reduce no-shows', 'Send reminders the day before', 'No-show count');
  await exp(ID.expMoney, ID.biz, 'Overtime cost TTD 912 last week', 'Cap overtime', 'Overtime hours');
  await exp(ID.expOther, ID.biz2, 'Reminders reduce no-shows', 'Send reminders the day before', 'No-show count');
  // Round 2 (correctness MAJOR-3): bridged from the marketing genome's own non-financial recommendation ("paid channel":
  // money words, no figure); served as the recommendation is.
  await exp(ID.expPaidChannel, ID.biz, 'A single active channel creates fragility.', 'Identify and activate at least one additional owned, earned, or paid channel.', 'Measure whether the recommendation improves the target business outcome.');
  // Round 2 (correctness MINOR-6): neutral text, money in the completion result.
  await db.genomeExperiment.create({
    data: { id: ID.expResult, businessId: ID.biz, hypothesis: 'Reminders reduce no-shows', action: 'Send reminders', successMetric: 'No-show count', status: 'COMPLETED', result: { notes: 'Revenue up TTD 912 after reminders' } },
  });
  // Round 2 (security MINOR-8): another business's FINANCIAL recommendation naming this business's experiment id.
  await db.genomeRecommendation.create({
    data: {
      id: ID.recOtherBiz, businessId: ID.biz2, domain: 'FINANCIAL', title: 'Other business cash plan', status: 'APPLIED',
      diagnosis: 'Cash is short.', insight: 'Cash is short.', recommendation: 'Collect faster.', riskLevel: 'MEDIUM', suggestedExperimentId: ID.expOps,
    },
  });
  await db.genomeRecommendation.create({
    data: {
      id: ID.recFin, businessId: ID.biz, domain: 'FINANCIAL', title: 'Tighten the follow-up cadence', status: 'APPLIED',
      diagnosis: 'Receivables of TTD 8,765.43 are past due.', insight: 'Receivables are past due.', recommendation: 'Follow up weekly.',
      riskLevel: 'MEDIUM', suggestedExperimentId: ID.expFin,
    },
  });

  // Autonomy verdicts, as AutonomyOrchestratorService writes them.
  const verdict = (id: string, actionKey: string, reason: string, ruleTrace: unknown[]) => db.autonomyVerdict.create({
    data: { id, businessId: ID.biz, actionKey, allowed: false, requiresApproval: true, tier: 'supervised', confidence: 0.7, reason, ruleTrace },
  });
  await verdict(ID.vFin, 'commerce.create_invoice', 'Invoice of TTD 912 needs approval', [{ source: 'StaticPolicy', rule: 'invoice', result: 'supervised', reason: 'Invoices need approval' }]);
  await verdict(ID.vOps, 'CREATE_TASK', 'Tool CREATE_TASK success rate is below 30% — blocked', [
    { source: 'GenomeAutonomyGateService', rule: 'genome-gate', result: 'allow', reason: 'Genome readiness gate passed', metadata: { readinessScore: 8317, confidenceScore: 0.7, riskLevel: 'MEDIUM' } },
    { source: 'ToolOutcomeScore', rule: 'tool-score-CREATE_TASK', result: 'supervised', reason: 'Tool CREATE_TASK success rate is 20% over 5 uses', metadata: { successRate: 0.2, totalUses: 5 } },
  ]);
  await verdict(ID.vOpsReason, 'CREATE_TASK', 'KEY cannot execute this action because finance readiness is critically low (12/100).', []);
  // Round 2 (security MAJOR-3b): a verdict on a KEY proposal bridged from a FINANCIAL recommendation, its own text neutral.
  await db.keyActionProposal.create({
    data: {
      id: ID.propFinVerdict, businessId: ID.biz, sourceType: 'GENOME_EVOLUTION', sourceId: ID.recFin, title: 'Follow up: Tighten the follow-up cadence',
      actionType: 'CREATE_TASK', riskLevel: 'LOW', status: 'PENDING', payload: { source: 'KEY_GENOME_RECOMMENDATION', recommendationId: ID.recFin },
    },
  });
  await db.autonomyVerdict.create({
    data: { id: ID.vProp, businessId: ID.biz, actionKey: 'CREATE_TASK', allowed: true, requiresApproval: true, tier: 'supervised', confidence: 0.61, reason: 'Allowed with approval', ruleTrace: [], proposalId: ID.propFinVerdict },
  });

  // Timeline: a genome.updated row from BlueprintService's own emitter shape and a constitution.version_generated row
  // as ConstitutionVersionService writes it.
  const remindAt = new Date(Date.now() - 3600_000);
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}genome_updated`, businessId: ID.biz, source: 'KEY', type: 'genome.updated', module: 'business-genome',
      entityType: 'business_blueprint', title: 'Business Genome updated', summary: 'The Business Genome was updated',
      importance: 'NORMAL', genomeImpactPotential: true, payload: { executiveReadinessScore: 61, genomeIntegrity: 57 }, reminderAt: remindAt,
    },
  });
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}constitution`, businessId: ID.biz, source: 'KEY', type: 'constitution.version_generated', module: 'business-genome',
      entityType: 'business_constitution_version', entityId: `${P}const_v2`, title: 'Business Constitution v2 generated',
      summary: 'Version 2 generated from Business Genome.', importance: 'HIGH',
      payload: { version: 2, genomeIntegrity: 57, executiveReadinessScore: 61, genomeStage: 'GROWTH' }, reminderAt: remindAt,
    },
  });

  // Round 2 (both reviews, MAJOR): GenomeIntegrityChangeListener's auto-version change notes, written as the summary.
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}constitution_auto`, businessId: ID.biz, source: 'KEY', type: 'constitution.version_generated', module: 'business-genome',
      entityType: 'business_constitution_version', entityId: `${P}const_v3`, title: 'Business Constitution v3 generated',
      summary: 'Auto-versioned: genome integrity changed from 52% to 57% (+5).', importance: 'HIGH',
      payload: { version: 3, genomeIntegrity: 57, executiveReadinessScore: 61, genomeStage: 'GROWTH' }, reminderAt: remindAt,
    },
  });
  // Round 2 (correctness MINOR-4): a financial DNA row that also carries a composite key (POST temporal-flow takes any
  // payload); it must stay withheld.
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}dna_fin_composite`, businessId: ID.biz, source: 'APP', type: 'genome.section_updated', module: 'business-genome',
      entityType: 'dna_section', entityId: 'financial', title: 'financial DNA updated', importance: 'NORMAL', reminderAt: remindAt,
      payload: { section: 'financial', data: { avgTicket: 4500.25 }, genomeIntegrity: 57 },
    },
  });

  // biz3: three paid-invoice rows make the generator propose a sales-section change (findGenomeSignals).
  for (let i = 0; i < 3; i += 1) {
    await db.temporalFlowEvent.create({
      data: { id: `${P}paid_${i}`, businessId: ID.biz3, source: 'APP', type: 'invoice.paid', module: 'commerce', title: `Invoice ${i} paid`, importance: 'NORMAL' },
    });
  }
  // Round 2 (correctness MINOR-8): five bookings make the generator propose an operations change too (served).
  for (let i = 0; i < 5; i += 1) {
    await db.temporalFlowEvent.create({
      data: { id: `${P}booking_${i}`, businessId: ID.biz3, source: 'APP', type: 'booking.created', module: 'bookings', title: `Booking ${i}`, importance: 'NORMAL' },
    });
  }
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

const BIZ_EVOS = [ID.evoFin, ID.evoSales, ID.evoOpsMoney, ID.evoOps, ID.evoGrowth, ID.evoFinAct, ID.evoFinOwner, ID.evoOpsAct, ID.evoOpsOwner, ID.evoOpsEdit].sort();
const NON_FIN_EVOS = [ID.evoOps, ID.evoGrowth, ID.evoOpsAct, ID.evoOpsOwner, ID.evoOpsEdit].sort();

describe('FU-GENOME-EVOLUTION-SURFACES (D-128, D-233, D-238)', () => {
  it('GES-01 the evolution proposals list serves a revenue-none member only the non-financial proposals', async () => {
    for (const as of [ID.staffNone, ID.staffMissing]) {
      const res = await get(evoUrl(), as);
      expect(res.status).toBe(200);
      expect(res.body.map((p: any) => p.id).sort()).toEqual(NON_FIN_EVOS);
      expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    }
    for (const as of [ID.owner, ID.staffRead]) {
      const all = await get(evoUrl(), as);
      expect(all.body.map((p: any) => p.id).sort()).toEqual(BIZ_EVOS);
    }
  });

  it('GES-02 approve, reject and edit of a financial proposal need revenue write; the row and the DNA are unchanged', async () => {
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      for (const res of [
        await post(`${evoUrl()}/${ID.evoFinAct}/approve`, as),
        await post(`${evoUrl()}/${ID.evoFinAct}/reject`, as),
        await patch(`${evoUrl()}/${ID.evoFinAct}`, as, { reason: 'Pricing review again' }),
      ]) {
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toContain(WRITE_DENIED(has));
        expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
      }
    }
    expect(await statusOf(ID.evoFinAct)).toBe('PENDING');
    expect((await db.genomeEvolutionProposal.findUnique({ where: { id: ID.evoFinAct } })).reason).toBe('Pricing review');
    expect(dnaWrites).toEqual([]);
  });

  it('GES-02b an edit that would make a proposal financial needs revenue write', async () => {
    const res = await patch(`${evoUrl()}/${ID.evoOpsEdit}`, ID.staffNone, { proposedPatch: { avgTicket: 4500.25 } });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain(WRITE_DENIED('none'));
    expect(await statusOf(ID.evoOpsEdit)).toBe('PENDING');
    const ok = await patch(`${evoUrl()}/${ID.evoOpsEdit}`, ID.staffNone, { proposedPatch: { coreWorkflows: ['reminders', 'confirmations'] } });
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(ID.evoOpsEdit);
  });

  it('GES-03 approving a non-financial proposal answers it without the genome integrity result; the owner gets both', async () => {
    const res = await post(`${evoUrl()}/${ID.evoOpsAct}/approve`, ID.staffNone);
    expect(res.status).toBe(201);
    expect(res.body.proposal.id).toBe(ID.evoOpsAct);
    expect(res.body.genome).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/financial|genomeDnaScores|"sales"/);
    const owner = await post(`${evoUrl()}/${ID.evoOpsOwner}/approve`, ID.owner);
    expect(owner.status).toBe(201);
    expect(owner.body.genome.genomeDnaScores.financial).toBe(23);
  });

  it('GES-03b the owner may still approve a financial proposal (owner parity)', async () => {
    const res = await post(`${evoUrl()}/${ID.evoFinOwner}/approve`, ID.owner);
    expect(res.status).toBe(201);
    expect(res.body.proposal.status).toBe('APPROVED');
    expect(dnaWrites.some((w: any) => w.section === 'financial')).toBe(true);
  });

  it('GES-04 generate-from-temporal-flow: a member without revenue write makes and is answered only non-financial proposals', async () => {
    const res = await post(`/business-genome/businesses/${ID.biz3}/evolution-proposals/generate-from-temporal-flow`, ID.staffNone);
    expect(res.status).toBe(201);
    expect(res.body.map((p: any) => p.section)).toEqual(['operations']);
    expect(JSON.stringify(res.body)).not.toMatch(/invoice/i);
    // Round 2 (security MINOR-6, D-128): no sales-section proposal was written for them.
    expect((await db.genomeEvolutionProposal.findMany({ where: { businessId: ID.biz3, section: 'sales' } })).length).toBe(0);
    // The owner's run makes the sales one; the owner reads it.
    const owner = await post(`/business-genome/businesses/${ID.biz3}/evolution-proposals/generate-from-temporal-flow`, ID.owner);
    expect(owner.status).toBe(201);
    expect(owner.body.map((p: any) => p.section)).toEqual(['sales']);
    const all = await get(evoUrl(ID.biz3), ID.owner);
    expect(all.body.map((p: any) => p.section).sort()).toEqual(['operations', 'sales']);
  });

  it('GES-05 the command-center snapshot carries no financial proposal text for a revenue-none member', async () => {
    const res = await get(`/business-command-center/businesses/${ID.biz}/snapshot`, ID.staffNone);
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(FIGURES);
    expect(json).not.toMatch(/Average deal closes|Gross margin|Overtime cost/);
    const all = JSON.stringify(res.body);
    for (const id of [ID.evoFin, ID.evoSales, ID.evoOpsMoney]) expect(all).not.toContain(id);
    expect(all).toContain(ID.evoOps);
    const owner = JSON.stringify((await get(`/business-command-center/businesses/${ID.biz}/snapshot`, ID.owner)).body);
    expect(owner).toContain(ID.evoFin);
    expect(owner).toMatch(/Gross margin moved to 31\.7%/);
  });

  it('GES-06 the executive brief and the mode briefs quote and count only the non-financial proposals', async () => {
    const brief = await get(`/intelligence/businesses/${ID.biz}/executive-brief`, ID.staffNone);
    expect(brief.status).toBe(200);
    expect(JSON.stringify(brief.body)).not.toMatch(FIGURES);
    const insight = (brief.body.insights as any[]).find((i) => i.id === 'pending-evolution-proposals');
    const pendingVisible = (await get(evoUrl(), ID.staffNone)).body.filter((p: any) => p.status === 'PENDING').length;
    expect(insight.title).toMatch(new RegExp(`^${pendingVisible} pending`));
    const mode = await get(`/intelligence/businesses/${ID.biz}/key-modes/GROWTH_ADVISOR`, ID.staffNone);
    expect(mode.status).toBe(200);
    expect(JSON.stringify(mode.body)).not.toMatch(/Average deal closes|4,?500\.25/);
    const ownerMode = await get(`/intelligence/businesses/${ID.biz}/key-modes/GROWTH_ADVISOR`, ID.owner);
    expect(JSON.stringify(ownerMode.body)).toMatch(/Average deal closes/);
    const ownerBrief = await get(`/intelligence/businesses/${ID.biz}/executive-brief`, ID.owner);
    expect(JSON.stringify(ownerBrief.body)).toMatch(/Gross margin moved to 31\.7%/);
  });

  it('GES-07 audit decisions: money verdicts withheld, the rest served without rule-trace metadata', async () => {
    const res = await get(`/api/v1/cortex/audit/decisions?businessId=${ID.biz}`, ID.staffNone);
    expect(res.status).toBe(200);
    expect(res.body.recent.map((v: any) => v.id)).toEqual([ID.vOps]);
    expect(res.body.recent[0].ruleTrace.some((t: any) => 'metadata' in t)).toBe(false);
    expect(res.body.recent[0].ruleTrace.map((t: any) => t.source)).toEqual(['GenomeAutonomyGateService', 'ToolOutcomeScore']);
    expect(JSON.stringify(res.body.recent)).not.toMatch(/TTD 912|finance readiness|readinessScore|8317/);
    // Round 2 (security MAJOR-3a): the verdict's confidence is the genome gate's confidence score.
    expect(res.body.recent[0].confidence).toBeUndefined();
    // Round 2 (security MINOR-5): the totals count what the reader is served.
    expect(res.body.total).toBe(1);
    expect(res.body.blocked).toBe(1);
    const owner = await get(`/api/v1/cortex/audit/decisions?businessId=${ID.biz}`, ID.owner);
    expect(owner.body.recent.map((v: any) => v.id).sort()).toEqual([ID.vFin, ID.vOps, ID.vOpsReason, ID.vProp].sort());
    expect(owner.body.recent.find((v: any) => v.id === ID.vOps).ruleTrace[0].metadata.readinessScore).toBe(8317);
    expect(owner.body.recent.find((v: any) => v.id === ID.vOps).confidence).toBe(0.7);
    expect(owner.body.total).toBe(4);
    // Packet item 3: no module scope is added to this route (an access change for SWP-CENSUS-KEY-B and the owner); a
    // member who reads revenue but not ai is served it whole, as before.
    const noAi = await get(`/api/v1/cortex/audit/decisions?businessId=${ID.biz}`, ID.staffNoAi);
    expect(noAi.status).toBe(200);
    expect(noAi.body.total).toBe(4);
  });

  it('GES-08 timeline genome.updated and constitution rows are served without their composite scores', async () => {
    for (const url of [`/temporal-flow/businesses/${ID.biz}?limit=200`, `/temporal-flow/businesses/${ID.biz}/reminders`]) {
      const res = await get(url, ID.staffNone);
      expect(res.status).toBe(200);
      for (const id of [`${P}genome_updated`, `${P}constitution`]) {
        const row = res.body.find((e: any) => e.id === id);
        expect(row, `${url} ${id}`).toBeDefined();
        expect(JSON.stringify(row.payload), `${url} ${id}`).not.toMatch(/genomeIntegrity|executiveReadinessScore|57|61/);
      }
      const owner = await get(url, ID.owner);
      expect(owner.body.find((e: any) => e.id === `${P}genome_updated`).payload).toEqual({ executiveReadinessScore: 61, genomeIntegrity: 57 });
    }
  });

  it('GES-09 experiments: bridged from FINANCIAL, or stating money, need revenue read; acting on one needs revenue write', async () => {
    const list = await get(expUrl(), ID.staffNone);
    expect(list.status).toBe(200);
    expect(list.body.map((e: any) => e.id).sort()).toEqual([ID.expOps, ID.expPaidChannel].sort());
    for (const id of [ID.expFin, ID.expMoney, ID.expResult]) {
      const one = await get(`${expUrl()}/${id}`, ID.staffNone);
      expect(one.status, id).toBe(403);
      expect(JSON.stringify(one.body)).toContain(READ_DENIED);
      expect(JSON.stringify(one.body)).not.toMatch(FIGURES);
    }
    // expOps is named by another business's FINANCIAL recommendation: that has no effect here.
    expect((await get(`${expUrl()}/${ID.expOps}`, ID.staffNone)).status).toBe(200);
    expect((await get(`${expUrl()}/${ID.expPaidChannel}`, ID.staffNone)).status).toBe(200);
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      for (const action of ['start', 'cancel', 'complete']) {
        const res = await post(`${expUrl()}/${ID.expFin}/${action}`, as);
        expect(res.status, `${as} ${action}`).toBe(403);
        expect(JSON.stringify(res.body)).toContain(WRITE_DENIED(has));
      }
    }
    expect((await db.genomeExperiment.findUnique({ where: { id: ID.expFin } })).status).toBe('PROPOSED');
    expect((await get(`${expUrl()}/${ID.expFin}`, ID.staffRead)).status).toBe(200);
    const ownerList = await get(expUrl(), ID.owner);
    expect(ownerList.body.map((e: any) => e.id).sort()).toEqual([ID.expFin, ID.expMoney, ID.expOps, ID.expPaidChannel, ID.expResult].sort());
    const started = await post(`${expUrl()}/${ID.expFin}/start`, ID.owner);
    expect(started.status).toBe(201);
  });

  it('GES-06b the mode briefs and the snapshot do not quote the sales genome-update candidate made from paid invoices', async () => {
    for (const mode of ['GROWTH_ADVISOR', 'STRATEGIST', 'EXECUTIVE_ASSISTANT']) {
      const res = await get(`/intelligence/businesses/${ID.biz3}/key-modes/${mode}`, ID.staffNone);
      expect(res.status, mode).toBe(200);
      expect(JSON.stringify(res.body), mode).not.toMatch(/Paid invoice activity|paid invoice events|Genome update candidate: Sales/i);
    }
    const snap = await get(`/business-command-center/businesses/${ID.biz3}/snapshot`, ID.staffNone);
    expect(JSON.stringify(snap.body)).not.toMatch(/Paid invoice activity|paid invoice events/i);
    const owner = await get(`/intelligence/businesses/${ID.biz3}/key-modes/GROWTH_ADVISOR`, ID.owner);
    expect(JSON.stringify(owner.body)).toMatch(/Paid invoice activity/);
  });

  it('GES-08b the constitution row whose summary states the integrity change is served without it; a financial DNA row with a composite key stays withheld', async () => {
    const res = await get(`/temporal-flow/businesses/${ID.biz}?limit=200`, ID.staffNone);
    const auto = res.body.find((e: any) => e.id === `${P}constitution_auto`);
    expect(auto).toBeDefined();
    expect(JSON.stringify(auto)).not.toMatch(/\d+%|integrity changed/);
    expect(res.body.some((e: any) => e.id === `${P}dna_fin_composite`)).toBe(false);
    const owner = await get(`/temporal-flow/businesses/${ID.biz}?limit=200`, ID.owner);
    expect(owner.body.find((e: any) => e.id === `${P}constitution_auto`).summary).toMatch(/52% to 57%/);
  });

  it('GES-11 the governance summary does not list experiments bridged from FINANCIAL or stating money', async () => {
    const res = await get(`/business-genome/businesses/${ID.biz}/key-genome/governance`, ID.staffNone);
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    for (const id of [ID.expFin, ID.expMoney, ID.expResult]) expect(json).not.toContain(id);
    expect(json).toContain(ID.expOps);
    const owner = JSON.stringify((await get(`/business-genome/businesses/${ID.biz}/key-genome/governance`, ID.owner)).body);
    expect(owner).toContain(ID.expFin);
  });

  it('GES-12 creating a financial or sales evolution proposal needs revenue write (D-128)', async () => {
    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      const res = await post(evoUrl(), as, { section: 'financial', reason: 'Pricing review', proposedPatch: { pricingModel: 'retainer' } });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain(WRITE_DENIED(has));
    }
    expect((await db.genomeEvolutionProposal.count({ where: { businessId: ID.biz, reason: 'Pricing review', createdBy: { in: [ID.staffNone, ID.staffRead] } } }))).toBe(0);
    const ok = await post(evoUrl(), ID.staffNone, { section: 'operations', reason: 'Confirm walk-ins', proposedPatch: { coreWorkflows: ['walk-ins'] } });
    expect(ok.status).toBe(201);
  });

  it('GES-10 cross-tenant: another business is refused; its ids answer 404 here', async () => {
    for (const url of [evoUrl(), expUrl(), `/intelligence/businesses/${ID.biz}/executive-brief`, `/api/v1/cortex/audit/decisions?businessId=${ID.biz}`]) {
      const res = await get(url, ID.outsider);
      expect(res.status, url).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    }
    expect((await post(`${evoUrl()}/${ID.evoOther}/approve`, ID.owner)).status).toBe(404);
    expect((await get(`${expUrl()}/${ID.expOther}`, ID.staffNone)).status).toBe(404);
    expect((await get(`${expUrl()}/${ID.expOther}`, ID.owner)).status).toBe(404);
  });
});
