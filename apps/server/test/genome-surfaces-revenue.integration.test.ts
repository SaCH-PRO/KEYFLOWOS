/**
 * FU-GENOME-SURFACES-REVENUE (owner rulings D-233, D-234, D-128, D-100). A genome DNA score of the finance or sales
 * dimension is finance even with no currency in it, and so is every composite that weights them (the genome integrity,
 * which averages the financial DNA in at weight 15 and the sales DNA at 5, the executive readiness, which weights the
 * financial DNA at 20 and the sales DNA at 10, and the genome stage, whose thresholds read the financial and sales DNA),
 * and every ranking that can name a money section as the weakest. Before this packet, a STAFF member whose explicit
 * scope map says revenue:'none' was served all of them on the genome's other surfaces. Each case below is that member
 * (staffNone) unless it says otherwise:
 *
 *   SR-01  GET blueprint/businesses/:id: no genome composite, no financial or sales DNA score or confidence, and none
 *          of the blueprint columns the financial and sales DNA are counted from (financials, projectionProfile,
 *          salesSystem: from them the blueprint-derived score is recomputed), nor their confidence scores.
 *   SR-02  GET .../genome and .../genome/integrity: the composites (genomeIntegrity, executiveReadinessScore,
 *          genomeStage) are withheld (null) and named in withheldForRevenue; the DNA sections, scores, confidence and
 *          readiness breakdown carry no financial or sales entry. The three-pillar status (founder, business, market)
 *          is unchanged.
 *   SR-03  GET .../genome/recommendations: the weakest section is chosen among the sections the reader is served (the
 *          business's weakest is its sales DNA; the member is pointed at its weakest non-money section).
 *   SR-04  GET .../genome/constitution: no composite, no section drawn from the financial or sales DNA, no pricing line.
 *   SR-05  business-genome constitution latest, versions, versions/:v and staleness: the stored composites and the
 *          financial and sales DNA are withheld, and the stored content is projected as SR-04.
 *   SR-06  GET intelligence/.../executive-brief: no composite, no readiness or integrity insight, no financial or sales
 *          DNA-gap insight, and the summary does not state readiness.
 *   SR-07  GET intelligence/.../key-modes/:mode: no financial or sales DNA finding, no "Executive Readiness is N%", no
 *          readiness or integrity sentence and no stage.
 *   SR-08  GET business-genome/.../document-pack executive-brief, dna and constitution exports: the documents carry no
 *          composite and no financial or sales section.
 *   SR-09  GET business-command-center/.../snapshot: health, pulse, genome and keyGenome carry no composite and no
 *          money section (FINANCIAL, SALES, OFFER_PRODUCT); the cross-domain brief (its overall health averages the
 *          finance health score in) is neither served nor computed; no finance genome signal or recommendation item; no
 *          finance or commerce module readiness; no missing financial fact.
 *   SR-10  The KEY tools: key_genome.calculate_integrity, get_blueprint, list_facts and get_readiness, and the bridge's
 *          genome get_dna, answer the acting member as REST does.
 *   SR-11  Controls: the owner and a revenue-read member are served everything as before; an outsider is refused; and a
 *          member's read after an owner's (and the owner's after the member's) is served for its own reader (the
 *          projection never changes a shared result).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, the global
 * TenantInterceptor, BlueprintService and KeyGenomeService (the genome is computed from the seeded blueprint row),
 * ConstitutionVersionService, BusinessIntelligenceService, KeyExecutiveModeService, BusinessCommandCenterService,
 * GenomeDocumentPackService, GenomeEvolutionService, TemporalFlowService and KeyActionProposalService's reads run against
 * the database at DATABASE_URL. Stand-ins: the fact scoring answers no facts (so the blueprint-derived scoring is
 * canonical) and a fixed KEY genome score; the module readiness, signal, recommendation and fact stores answer fixed
 * rows; the cross-domain bridge answers a fixed brief and records its calls. Identity attachment is a stand-in: a test
 * middleware reads `x-test-user` and attaches `{ id, email, role }` as AuthMiddleware would.
 *
 * Fixtures: prefix `v80r_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL in beforeAll and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v80r_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffMissing: `${P}staffMissing`,
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  biz2: `${P}biz2`,
};

/** Figures only the money columns and rows of this fixture carry. */
const FIGURES = /4,?500\.25|8,?765\.43|TTD 912|31\.7/;
/** The money DNA keys and KEY genome sections (D-233, D-234). */
const MONEY_DNA = ['financial', 'sales'];
const MONEY_SECTIONS = ['FINANCIAL', 'SALES', 'OFFER_PRODUCT'];
const COMPOSITES = ['genomeIntegrity', 'executiveReadinessScore', 'genomeStage'];

let db: any;
let app: any;
let moduleRef: any;
const crossDomainCalls: string[] = [];
/** The KEY tools under SR-10: the genome organ and the bridge adapter. */
const tools: Record<string, any> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_constitution_versions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_genomes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_blueprints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
const bp = (suffix = '', biz = ID.biz) => `/blueprint/businesses/${biz}${suffix}`;

/** Every key path in `value` (objects and arrays), for "no money key anywhere" checks. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** Asserts a genome integrity result as a member without revenue read must be served it. */
function expectProjectedGenome(body: any) {
  for (const field of COMPOSITES) expect(body[field], field).toBeNull();
  expect(body.withheldForRevenue).toEqual(expect.arrayContaining(COMPOSITES));
  for (const key of MONEY_DNA) {
    expect(body.genomeDnaScores?.[key], `score ${key}`).toBeUndefined();
    expect(body.genomeDnaConfidence?.[key], `confidence ${key}`).toBeUndefined();
    expect(body.readinessBreakdown?.[key], `breakdown ${key}`).toBeUndefined();
  }
  for (const s of body.dnaSections ?? []) expect(MONEY_DNA).not.toContain(s.key);
  // The non-money DNA is served as computed.
  expect(body.genomeDnaScores.founder).toBe(100);
  expect(body.genomeDnaScores.operations).toBe(50);
  expect(body.threePillarMinimumMet).toBe(true);
}

/** Asserts a genome integrity result as served whole (owner, revenue reader). */
function expectWholeGenome(body: any) {
  for (const field of ['genomeIntegrity', 'executiveReadinessScore']) expect(typeof body[field], field).toBe('number');
  expect(typeof body.genomeStage).toBe('string');
  expect(body.genomeDnaScores.financial).toBe(29);
  expect(body.genomeDnaScores.sales).toBe(0);
  expect(body.withheldForRevenue).toBeUndefined();
}

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
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');
  const { BlueprintController } = await import('../src/modules/blueprint/blueprint.controller');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { KeyGenomeService } = await import('../src/modules/business-genome/key-genome/key-genome.service');
  const { ConstitutionVersionController } = await import('../src/modules/business-genome/constitution-version.controller');
  const { ConstitutionVersionService } = await import('../src/modules/business-genome/constitution-version.service');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { BusinessCommandCenterController } = await import('../src/modules/business-command-center/business-command-center.controller');
  const { BusinessCommandCenterService } = await import('../src/modules/business-command-center/business-command-center.service');
  const { BusinessIntelligenceController } = await import('../src/modules/intelligence/business-intelligence.controller');
  const { BusinessIntelligenceService } = await import('../src/modules/intelligence/business-intelligence.service');
  const { KeyExecutiveModeController } = await import('../src/modules/intelligence/key-executive-mode.controller');
  const { KeyExecutiveModeService } = await import('../src/modules/intelligence/key-executive-mode.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { GenomeDocumentPackController } = await import('../src/modules/business-genome/document-pack/genome-document-pack.controller');
  const { GenomeDocumentPackService } = await import('../src/modules/business-genome/document-pack/genome-document-pack.service');

  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' || (typeof prop === 'string' && /^(on|before)(Module|Application)/.test(prop))
      ? undefined
      : () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); }),
  });

  const sectionScore = (section: string, overall: number) => ({
    section, weight: 1,
    score: { overall, completeness: overall, confidence: 0.6, freshness: 0.9, operationalReadiness: overall, quality: overall },
  });
  // The KEY genome score (the fact kernel's): money sections are the weakest.
  const KEY_SCORE = {
    businessId: ID.biz, overall: 0.47, integrity: 0.52, readiness: 0.44, confidence: 0.61, computedAt: new Date().toISOString(),
    sections: [
      sectionScore('FINANCIAL', 0.21), sectionScore('SALES', 0.33), sectionScore('OFFER_PRODUCT', 0.25),
      sectionScore('OPERATIONS_DELIVERY', 0.55), sectionScore('FOUNDER_LEADERSHIP', 0.9),
    ],
  };
  const scoring = { computeFactScores: async () => [], computeBusinessScore: () => KEY_SCORE };
  const missing = (section: string, domain: string, field: string, reason: string) => ({ section, domain, field, reason, impact: 'BLOCKING' });
  const READINESS = [
    { businessId: ID.biz, module: 'finance', readinessScore: 33, requiredFacts: [], optionalFacts: [], missingFacts: [missing('FINANCIAL', 'finance', 'monthlyTarget', 'Monthly target TTD 912 unknown')], blockedReasons: ['Finance facts missing'], recommendedSetupActions: [], automationAllowed: false, riskLevel: 'HIGH', lastComputedAt: new Date().toISOString() },
    { businessId: ID.biz, module: 'commerce', readinessScore: 41, requiredFacts: [], optionalFacts: [], missingFacts: [], blockedReasons: [], recommendedSetupActions: [], automationAllowed: true, riskLevel: 'MEDIUM', lastComputedAt: new Date().toISOString() },
    { businessId: ID.biz, module: 'crm', readinessScore: 60, requiredFacts: [missing('CUSTOMER_MARKET', 'customer', 'segments', 'Segments unknown'), missing('SALES', 'sales', 'pipelineStages', 'Pipeline unknown')], optionalFacts: [], missingFacts: [missing('CUSTOMER_MARKET', 'customer', 'segments', 'Segments unknown'), missing('SALES', 'sales', 'pipelineStages', 'Pipeline unknown')], blockedReasons: ['Missing blocking fact: sales.pipelineStages'], recommendedSetupActions: [], automationAllowed: false, riskLevel: 'HIGH', lastComputedAt: new Date().toISOString() },
    // Round 1 (security MAJOR-2): a module whose readiness is computed only from FINANCIAL facts ("Reports readiness is
    // 33%" states the financial section's completeness), and one computed only from operations facts.
    { businessId: ID.biz, module: 'reports', readinessScore: 33, requiredFacts: [missing('FINANCIAL', 'finance', 'currency', 'Currency unknown'), missing('FINANCIAL', 'finance', 'avg_ticket', 'Ticket unknown'), missing('FINANCIAL', 'finance', 'cost_structure', 'Costs unknown')], optionalFacts: [], missingFacts: [missing('FINANCIAL', 'finance', 'avg_ticket', 'Ticket unknown'), missing('FINANCIAL', 'finance', 'cost_structure', 'Costs unknown')], blockedReasons: ['Missing blocking fact: finance.avg_ticket'], recommendedSetupActions: ['Provide blocking fact: finance.avg_ticket'], automationAllowed: false, riskLevel: 'HIGH', lastComputedAt: new Date().toISOString() },
    { businessId: ID.biz, module: 'sop', readinessScore: 50, requiredFacts: [missing('OPERATIONS_DELIVERY', 'operations', 'coreWorkflows', 'Workflows unknown'), missing('OPERATIONS_DELIVERY', 'operations', 'fulfillment', 'Fulfilment unknown')], optionalFacts: [], missingFacts: [missing('OPERATIONS_DELIVERY', 'operations', 'fulfillment', 'Fulfilment unknown')], blockedReasons: ['Missing blocking fact: operations.fulfillment'], recommendedSetupActions: [], automationAllowed: false, riskLevel: 'HIGH', lastComputedAt: new Date().toISOString() },
  ];
  const readinessStore = {
    computeReadiness: async () => READINESS,
    getReadiness: async (_b: string, module?: string) => (module ? READINESS.find((r) => r.module === module) ?? null : READINESS),
  };
  const SIGNALS = [
    { id: `${P}sig_fin`, businessId: ID.biz, signalType: 'RISK', sourceModule: 'finance', section: 'FINANCIAL', domain: 'finance', reason: 'Runway is 31.7 days', evidence: [], status: 'NEW', confidence: 0.9, createdAt: new Date().toISOString() },
    { id: `${P}sig_ops`, businessId: ID.biz, signalType: 'MISSING_FACT', sourceModule: 'operations', section: 'OPERATIONS_DELIVERY', domain: 'operations', reason: 'Fulfilment SLA unknown', evidence: [], status: 'NEW', confidence: 0.9, createdAt: new Date().toISOString() },
  ];
  const signalStore = { listSignals: async () => SIGNALS };
  const RECS = [
    { id: `${P}rec_fin`, businessId: ID.biz, domain: 'FINANCIAL', title: 'Raise prices TTD 912', insight: 'Margins are thin', diagnosis: 'Margin', recommendation: 'Raise prices', riskLevel: 'HIGH', status: 'ACTIVE' },
    { id: `${P}rec_ops`, businessId: ID.biz, domain: 'OPERATIONS', title: 'Document fulfilment', insight: 'No SOP', diagnosis: 'SOP', recommendation: 'Write SOP', riskLevel: 'MEDIUM', status: 'ACTIVE' },
  ];
  const recommendationStore = { listRecommendations: async () => RECS };
  const FACTS = [
    { id: `${P}fact_fin`, businessId: ID.biz, section: 'FINANCIAL', domain: 'finance', field: 'avgTicket', value: 4500.25, sourceModule: 'finance' },
    { id: `${P}fact_sales`, businessId: ID.biz, section: 'SALES', domain: 'sales', field: 'quota', value: 8765.43, sourceModule: 'crm' },
    { id: `${P}fact_ops`, businessId: ID.biz, section: 'OPERATIONS_DELIVERY', domain: 'operations', field: 'coreWorkflows', value: ['intake'], sourceModule: 'operations' },
  ];
  const factStore = { listFacts: async () => FACTS };
  const bridgeStandIn = {
    buildCrossDomainBrief: async (businessId: string) => {
      crossDomainCalls.push(businessId);
      return { healthScore: 44, readinessScore: 39, confidenceScore: 50, overallRiskLevel: 'HIGH', domainHealth: { finance: 21 }, domainReadiness: { finance: 21 }, topRecommendations: [], topOpportunities: [], unsafeAutomationBlocks: [], staleFactCount: 0, criticalMissingFactCount: 1 };
    },
  };

  const built: Record<string, any> = {};
  const once = (name: string, make: () => any) => (built[name] ??= make());
  const temporalOf = (prisma: any) => once('temporal', () => new TemporalFlowService(prisma, undefined as any, undefined as any));
  const keyGenomeOf = (prisma: any) => once('keyGenome', () => new KeyGenomeService(prisma, scoring as any, readinessStore as any));
  const blueprintOf = (prisma: any) => once('blueprint', () => new BlueprintService(
    prisma, temporalOf(prisma), scoring as any, keyGenomeOf(prisma), readinessStore as any,
    { backfill: async () => undefined } as any, { emit: () => true } as any,
  ));
  const evolutionOf = (prisma: any) => once('evolution', () => new GenomeEvolutionService(prisma, blueprintOf(prisma), temporalOf(prisma)));
  const proposalsOf = (prisma: any) => once('proposals', () => new KeyActionProposalService(
    prisma, temporalOf(prisma), offRoute('EventEmitter2') as any, offRoute('KeyActionPolicyService') as any,
    offRoute('KeyActionExecutorService') as any, offRoute('KeyActionGenomePolicyService') as any,
    offRoute('AutonomyOrchestratorService') as any, offRoute('KeyActionBoundaryService') as any,
  ));
  const assetsStandIn = { list: async () => [] };
  const intelligenceOf = (prisma: any) => once('intelligence', () => new BusinessIntelligenceService(
    blueprintOf(prisma), temporalOf(prisma), evolutionOf(prisma), assetsStandIn as any, prisma,
  ));
  const modesOf = (prisma: any) => once('modes', () => new KeyExecutiveModeService(
    intelligenceOf(prisma), blueprintOf(prisma), temporalOf(prisma), evolutionOf(prisma), assetsStandIn as any, prisma,
  ));
  const constitutionOf = (prisma: any) => once('constitution', () => new ConstitutionVersionService(prisma, blueprintOf(prisma), temporalOf(prisma)));
  const commandCenterOf = (prisma: any) => once('commandCenter', () => new BusinessCommandCenterService(
    intelligenceOf(prisma), modesOf(prisma), proposalsOf(prisma), temporalOf(prisma), evolutionOf(prisma), blueprintOf(prisma),
    assetsStandIn as any, constitutionOf(prisma), scoring as any, readinessStore as any, signalStore as any,
    recommendationStore as any, bridgeStandIn as any, prisma,
  ));
  const documentPackOf = (prisma: any) => once('documentPack', () => new GenomeDocumentPackService(intelligenceOf(prisma), constitutionOf(prisma), blueprintOf(prisma), prisma));
  const live = (token: any, make: (prisma: any) => any) => ({ provide: token, inject: [PrismaService], useFactory: make });

  moduleRef = await Test.createTestingModule({
    controllers: [
      BlueprintController, ConstitutionVersionController, BusinessCommandCenterController, BusinessIntelligenceController,
      KeyExecutiveModeController, GenomeDocumentPackController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      live(BlueprintService, blueprintOf),
      { provide: GenomeGateGuard, inject: [PrismaService], useFactory: (prisma: any) => new GenomeGateGuard(blueprintOf(prisma), prisma) },
      live(TemporalFlowService, temporalOf),
      live(GenomeEvolutionService, evolutionOf),
      live(KeyActionProposalService, proposalsOf),
      live(BusinessIntelligenceService, intelligenceOf),
      live(KeyExecutiveModeService, modesOf),
      live(ConstitutionVersionService, constitutionOf),
      live(BusinessCommandCenterService, commandCenterOf),
      live(GenomeDocumentPackService, documentPackOf),
    ],
  }).compile();

  const prisma = moduleRef.get(PrismaService);
  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  // The KEY tools (SR-10): the genome organ over the real BlueprintService and the stand-in stores, and the bridge.
  const { KeyGenomeAdapterService } = await import('../src/modules/key-cortex/organs/key-genome-adapter.service');
  const { KeyCortexBridgeAdapterService } = await import('../src/modules/key-cortex/adapters/bridge-adapter.service');
  const { KeyCortexGenomeBridgeService } = await import('../src/modules/key-cortex/key-cortex-genome-bridge.service');
  tools.organ = new KeyGenomeAdapterService(
    blueprintOf(prisma), signalStore as any, recommendationStore as any, factStore as any, readinessStore as any, scoring as any,
    { publish: async () => undefined } as any, prisma,
  );
  const genomeBridge = Object.create(KeyCortexGenomeBridgeService.prototype);
  genomeBridge.prisma = prisma;
  genomeBridge.logger = { debug: () => undefined, warn: () => undefined, log: () => undefined, verbose: () => undefined };
  tools.bridge = new KeyCortexBridgeAdapterService(genomeBridge, prisma);

  await cleanup();
  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.staffMissing, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V80R Genome', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.biz2, name: 'V80R Other', slug: `${P}biz2`, ownerId: ID.outsider, currency: 'TTD' } });
  for (const [user, biz, role, permissionScopes] of [
    [ID.owner, ID.biz, 'OWNER', undefined],
    [ID.staffNone, ID.biz, 'STAFF', { revenue: 'none', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    [ID.staffRead, ID.biz, 'STAFF', { revenue: 'read', crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    // An explicit map with no revenue key reads revenue none.
    [ID.staffMissing, ID.biz, 'STAFF', { crm: 'read', operations: 'write', settings: 'write', ai: 'write' }],
    [ID.outsider, ID.biz2, 'OWNER', undefined],
  ] as const) {
    await db.membership.create({ data: { userId: user, businessId: biz, role, ...(permissionScopes ? { permissionScopes } : {}) } });
  }

  // The blueprint: founder, vision and business DNA complete; market 4/6; financial 2/7 (29); legal 6/10; operations
  // 1/2; sales 0/2 (its weakest); marketing 1/2; growth 2/3; technology 4/4; risk 3/6.
  const blueprintRow = (businessId: string) => ({
    businessId,
    lastGenomeSyncAt: new Date(),
    identity: { name: 'V80R', archetype: 'service', industry: 'consulting', mission: 'm', vision: 'v', values: ['x'] },
    brand: { voice: 'warm', tone: 'calm', valueProps: ['fast'] },
    operatingModel: { revenueModel: 'retainer', deliveryMode: 'remote', serviceArea: 'TT', teamSize: 3 },
    goals: { northStar: 'clients' },
    constraints: { budgetRange: 'small', timeCommitment: 'full', riskTolerance: 'low' },
    workflowModel: { primaryWorkflow: 'intake' },
    aiPreferences: { autonomyLevel: 'assist', outreachStyle: 'calm', reportingCadence: 'weekly' },
    founderProfile: { founderName: 'F', background: 'b', skills: ['s'], weeklyAvailabilityHours: 40 },
    customerModel: { idealCustomer: 'smb', segments: ['a'], painPoints: ['p'] },
    marketProfile: { targetGeography: 'TT' },
    financials: { currency: 'TTD', avgTicket: 4500.25, pricingModel: '' },
    projectionProfile: { note: 'TTD 912 runway' },
    salesSystem: { quota: 8765.43 },
    legalProfile: { country: 'TT', recommendedEntityType: 'LLC', regulatedIndustry: false },
    registrationProfile: { businessNameStatus: 'done', companiesRegistryStatus: 'done', vatStatus: 'n/a' },
    operationsSystem: { coreWorkflows: ['intake'] },
    marketingSystem: { channels: ['ig'] },
    executionRoadmap: { today: ['t'], sevenDayPlan: ['s'] },
    riskProfile: { legalRisks: ['l'], marketRisks: ['m'], operationalRisks: ['o'], financialRisks: [{ description: 'Runway 31.7 days' }] },
    // Round 1 (security MAJOR-3): money fields outside the three money DNA columns.
    taxProfile: { country: 'TT', taxIdStatus: 'done', estimatedAnnualRevenue: 4500.25 },
    offerArchitecture: { coreOffer: { name: 'Audit', price: 8765.43 } },
    readinessScore: 44,
    completeness: 70,
    confidenceScores: { financials: 50, projectionProfile: 0, salesSystem: 0, identity: 100 },
    // The stored composites (GET blueprint and the executive brief read them).
    genomeIntegrity: 57,
    executiveReadinessScore: 61,
    genomeStage: 'REVENUE_ENGINE',
    genomeDnaScores: { founder: 100, vision: 100, business: 100, market: 67, financial: 29, legal: 60, operations: 50, sales: 41, marketing: 50, growth: 67, technology: 100, risk: 50 },
    genomeDnaConfidence: { founder: 100, financial: 29, sales: 41, operations: 50 },
  });
  await db.businessBlueprint.create({ data: blueprintRow(ID.biz) });
  await db.businessBlueprint.create({ data: blueprintRow(ID.biz2) });
  const content = await blueprintOf(prisma).generateConstitution(ID.biz);
  await db.businessConstitutionVersion.create({
    data: {
      businessId: ID.biz, version: 1, status: 'ACTIVE', content,
      summary: 'Generated from Genome Integrity 57%, Executive Readiness 61%, Stage REVENUE_ENGINE.',
      sourceGenomeIntegrity: 57, sourceExecutiveReadiness: 61, sourceGenomeStage: 'REVENUE_ENGINE',
      sourceDnaScores: { founder: 100, financial: 29, sales: 41 }, sourceDnaConfidence: { founder: 100, financial: 29, sales: 41 },
    },
  });
  await db.businessGenome.create({ data: { businessId: ID.biz, dnaScores: { founder: 100, financial: 29, sales: 41, operations: 50 }, stage: 'REVENUE_ENGINE', executiveReadiness: 61 } });
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('FU-GENOME-SURFACES-REVENUE: the genome surfaces serve finance-derived scores only to revenue readers', () => {
  it('SR-01 GET blueprint: no composite, no money DNA, no money source column', async () => {
    for (const reader of [ID.staffNone, ID.staffMissing]) {
      const res = await get(bp(), reader);
      expect(res.status).toBe(200);
      for (const field of COMPOSITES) expect(res.body[field] ?? null, field).toBeNull();
      expect(res.body.withheldForRevenue).toEqual(expect.arrayContaining(COMPOSITES));
      for (const key of MONEY_DNA) {
        expect(res.body.genomeDnaScores?.[key]).toBeUndefined();
        expect(res.body.genomeDnaConfidence?.[key]).toBeUndefined();
      }
      expect(res.body.genomeDnaScores.founder).toBe(100);
      for (const column of ['financials', 'projectionProfile', 'salesSystem']) {
        expect(res.body[column], column).toEqual({});
        expect(res.body.confidenceScores?.[column], `confidence ${column}`).toBeUndefined();
      }
      expect(res.body.confidenceScores.identity).toBe(100);
      // Round 1 (both reviews, MAJOR-3): completeness averages the financials column's fill in, and every other core
      // column's fill ratio is served, so the financials fill is recoverable: withheld, as is the blueprint readiness.
      expect(res.body.completeness ?? null).toBeNull();
      expect(res.body.readinessScore ?? null).toBeNull();
      expect(res.body.withheldForRevenue).toEqual(expect.arrayContaining(['completeness', 'readinessScore']));
      // Money fields outside the money DNA columns (D-100, D-234): revenue model, budget, offer prices, the annual
      // revenue estimate, the financial risks.
      expect(res.body.offerArchitecture).toEqual({});
      expect(res.body.taxProfile.estimatedAnnualRevenue).toBeUndefined();
      expect(res.body.taxProfile.taxIdStatus).toBe('done');
      expect(res.body.riskProfile.financialRisks).toBeUndefined();
      expect(res.body.riskProfile.legalRisks).toEqual(['l']);
      expect(res.body.operatingModel.revenueModel).toBeUndefined();
      expect(res.body.operatingModel.deliveryMode).toBe('remote');
      expect(res.body.constraints.budgetRange).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/retainer|Runway/);
      expect(res.body.identity.name).toBe('V80R');
      expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    }
  });

  it('SR-02 GET genome and genome/integrity: composites withheld, no money DNA section, three pillars unchanged', async () => {
    const genome = await get(bp('/genome'), ID.staffNone);
    expect(genome.status).toBe(200);
    expectProjectedGenome(genome.body);
    const integrity = await get(bp('/genome/integrity'), ID.staffNone);
    expect(integrity.status).toBe(200);
    expectProjectedGenome({ ...integrity.body, dnaSections: [] });
    const pillars = await get(bp('/genome/three-pillar-status'), ID.staffNone);
    expect(pillars.body).toEqual({ met: true, founder: 100, business: 100, market: 67 });
  });

  it('SR-03 GET genome/recommendations: the weakest section among the served ones', async () => {
    const owner = await get(bp('/genome/recommendations'), ID.owner);
    expect(owner.body.recommendations[0].section).toBe('sales');
    const staff = await get(bp('/genome/recommendations'), ID.staffNone);
    expect(staff.status).toBe(200);
    expect(staff.body.recommendations).toHaveLength(1);
    expect(MONEY_DNA).not.toContain(staff.body.recommendations[0].section);
    expect(staff.body.recommendations[0].section).toBe('operations');
    expect(JSON.stringify(staff.body)).not.toMatch(/financial|sales/i);
  });

  it('SR-04 GET genome/constitution: no composite, no money section, no pricing line', async () => {
    const res = await get(bp('/genome/constitution'), ID.staffNone);
    expect(res.status).toBe(200);
    for (const field of COMPOSITES) expect(res.body[field], field).toBeNull();
    for (const key of ['financialStrategy', 'salesStrategy', 'riskRegister']) expect(res.body.sections[key], key).toBeUndefined();
    for (const section of Object.values(res.body.sections) as any[]) {
      for (const dna of section.sourceDna) expect(MONEY_DNA).not.toContain(dna);
    }
    expect(res.body.sections.executiveSummary).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    expect(JSON.stringify(res.body)).not.toMatch(/Pricing model|Average ticket|Monthly revenue target/);
  });

  it('SR-05 constitution versions and staleness: stored composites and money DNA withheld', async () => {
    const base = `/business-genome/businesses/${ID.biz}/constitution`;
    const latest = await get(`${base}/latest`, ID.staffNone);
    const list = await get(`${base}/versions`, ID.staffNone);
    const one = await get(`${base}/versions/1`, ID.staffNone);
    for (const row of [latest.body, list.body[0], one.body]) {
      expect(row.version).toBe(1);
      for (const field of ['sourceGenomeIntegrity', 'sourceExecutiveReadiness', 'sourceGenomeStage']) expect(row[field], field).toBeNull();
      for (const key of MONEY_DNA) {
        expect(row.sourceDnaScores?.[key]).toBeUndefined();
        expect(row.sourceDnaConfidence?.[key]).toBeUndefined();
      }
      expect(row.sourceDnaScores.founder).toBe(100);
      expect(row.summary ?? null).toBeNull();
      for (const field of COMPOSITES) expect(row.content[field] ?? null, field).toBeNull();
      for (const key of ['financialStrategy', 'salesStrategy', 'riskRegister']) expect(row.content.sections[key], key).toBeUndefined();
      expect(JSON.stringify(row)).not.toMatch(FIGURES);
      expect(JSON.stringify(row)).not.toMatch(/Pricing model|Genome Integrity|Executive Readiness/);
    }
    const staleness = await get(`${base}/staleness`, ID.staffNone);
    expect(staleness.status).toBe(200);
    for (const field of ['currentGenomeIntegrity', 'constitutionGenomeIntegrity', 'currentExecutiveReadiness', 'constitutionExecutiveReadiness', 'currentGenomeStage', 'constitutionGenomeStage']) {
      expect(staleness.body[field] ?? null, field).toBeNull();
    }
    expect(typeof staleness.body.stale).toBe('boolean');
  });

  it('SR-06 GET executive-brief: no composite, no readiness, integrity or money DNA insight', async () => {
    const res = await get(`/intelligence/businesses/${ID.biz}/executive-brief`, ID.staffNone);
    expect(res.status).toBe(200);
    for (const field of COMPOSITES) expect(res.body[field], field).toBeNull();
    const ids = res.body.insights.map((i: any) => i.id);
    for (const id of ['executive-readiness', 'genome-integrity', 'genome-gap-financial', 'genome-gap-sales']) expect(ids).not.toContain(id);
    expect(JSON.stringify(res.body)).not.toMatch(/Executive Readiness|Genome Integrity|financial|sales/i);
    // The non-money DNA gaps are still served (none of this fixture's are under 50, so none), and the owner's brief is whole.
    const owner = await get(`/intelligence/businesses/${ID.biz}/executive-brief`, ID.owner);
    expect(owner.body.genomeIntegrity).toBe(57);
    expect(owner.body.insights.map((i: any) => i.id)).toEqual(expect.arrayContaining(['executive-readiness', 'genome-integrity', 'genome-gap-financial', 'genome-gap-sales']));
  });

  it('SR-07 GET key-modes/:mode: no money DNA finding, no readiness, integrity or stage', async () => {
    for (const mode of ['CFO', 'GROWTH_ADVISOR', 'STRATEGIST', 'RISK_OFFICER', 'EXECUTIVE_ASSISTANT', 'CMO', 'COO', 'LEGAL_GUIDE']) {
      const res = await get(`/intelligence/businesses/${ID.biz}/key-modes/${mode}`, ID.staffNone);
      expect(res.status, mode).toBe(200);
      const text = JSON.stringify(res.body);
      // The mode's static default action ("Review Financial DNA") names no score; a finding on the DNA does.
      expect(text, mode).not.toMatch(/-dna-(financial|sales)|(Financial|Sales) DNA (is|score|section)/);
      expect(text, mode).not.toMatch(/Executive Readiness|Genome Integrity|REVENUE.ENGINE/i);
    }
    const owner = await get(`/intelligence/businesses/${ID.biz}/key-modes/GROWTH_ADVISOR`, ID.owner);
    expect(owner.body.diagnosis).toMatch(/Executive Readiness is 61%/);
  });

  it('SR-08 document-pack exports: no composite, no money section', async () => {
    const { GenomeDocumentPackService } = await import('../src/modules/business-genome/document-pack/genome-document-pack.service');
    const service = moduleRef.get(GenomeDocumentPackService);
    const rendered: unknown[] = [];
    const spy = vi.spyOn(service as any, 'render').mockImplementation(async (...args: unknown[]) => {
      rendered.push(args[3]);
      return { buffer: Buffer.from('x'), filename: 'f.docx', contentType: 'application/octet-stream' };
    });
    try {
      const base = `/business-genome/businesses/${ID.biz}/document-pack`;
      for (const route of ['executive-brief/export', 'dna/export', 'constitution/export']) {
        rendered.length = 0;
        const res = await get(`${base}/${route}?format=docx`, ID.staffNone);
        expect(res.status, route).toBe(200);
        expect(rendered, route).toHaveLength(1);
        const text = JSON.stringify(rendered[0]);
        expect(text, route).not.toMatch(/Genome Integrity|Executive Readiness|Genome Stage|REVENUE.ENGINE|null%|undefined%/);
        expect(text, route).not.toMatch(/Financial DNA|Sales DNA|Financial Strategy|Sales Strategy|Risk Register|Pricing model/);
        expect(text, route).not.toMatch(FIGURES);
      }
      rendered.length = 0;
      await get(`${base}/dna/export?format=docx`, ID.owner);
      expect(JSON.stringify(rendered[0])).toMatch(/Financial DNA/);
    } finally {
      spy.mockRestore();
    }
  });

  it('SR-09 GET command-center snapshot: no composite, money section, cross-domain brief, finance item or readiness', async () => {
    crossDomainCalls.length = 0;
    const res = await get(`/business-command-center/businesses/${ID.biz}/snapshot`, ID.staffNone);
    expect(res.status).toBe(200);
    const s = res.body;
    for (const field of COMPOSITES) expect(s.health[field] ?? null, `health.${field}`).toBeNull();
    for (const field of ['keyGenomeOverall', 'keyGenomeReadiness', 'keyGenomeConfidence']) expect(s.health[field] ?? null, `health.${field}`).toBeNull();
    for (const field of ['integrity', 'readiness', 'stage']) expect(s.genome[field] ?? null, `genome.${field}`).toBeNull();
    for (const field of ['overall', 'integrity', 'readiness', 'confidence']) expect(s.keyGenome[field] ?? null, `keyGenome.${field}`).toBeNull();
    expect(s.keyGenome.crossDomain).toBeUndefined();
    expect(crossDomainCalls).toEqual([]);
    for (const sec of [...s.keyGenome.sections.map((x: any) => x.section), ...s.keyGenome.weakestSections.map((x: any) => x.section)]) {
      expect(MONEY_SECTIONS).not.toContain(sec);
    }
    expect(s.keyGenome.sections.map((x: any) => x.section)).toContain('OPERATIONS_DELIVERY');
    for (const w of s.genome.weakestSections) expect(w.id).not.toMatch(/dna-(financial|sales)/);
    const labels = (s.pulse?.dimensions ?? []).map((d: any) => d.label);
    expect(labels).not.toContain('Genome');
    expect(labels).not.toContain('Readiness');
    // Round 1 (security MAJOR-2): a module whose readiness is computed from any money fact is withheld whole (its score,
    // flags and reasons state the money section's completeness); only the operations-only module is served, and the
    // health counts are the served modules'.
    expect(s.moduleReadiness.map((m: any) => m.module)).toEqual(['sop']);
    expect(s.health.blockedModuleCount).toBe(1);
    expect(s.health.lowReadinessModuleCount).toBe(1);
    expect(JSON.stringify(s)).not.toMatch(/Reports readiness|Crm readiness|finance\.avg_ticket|sales\.pipelineStages/);
    for (const m of s.moduleReadiness) for (const f of m.missingFacts) expect(f.section).not.toMatch(/FINANCIAL|SALES/);
    const all = [...s.topPriorities, ...s.risks, ...s.opportunities, ...s.genome.weakestSections, ...s.recommendedActions];
    const text = JSON.stringify(s);
    expect(text).not.toMatch(FIGURES);
    expect(text).not.toMatch(/sig_fin|rec_fin|Executive Readiness|Genome Integrity/);
    expect(text).not.toMatch(/key-genome-section-(financial|sales|offer)|module-readiness-(finance|commerce)|missing-fact-(financial|sales)/);
    expect(text).toMatch(/sig_ops/);
    expect(text).toMatch(/rec_ops/);
    expect(all.length).toBeGreaterThan(0);
  });

  it('SR-10 KEY tools answer the acting member as REST does', async () => {
    const ctx = (userId?: string) => ({ businessId: ID.biz, userId });
    for (const reader of [ID.staffNone, undefined]) {
      const integrity = await tools.organ.executeTool('key_genome.calculate_integrity', ctx(reader), {});
      expect(integrity.success).toBe(true);
      expectProjectedGenome(integrity.data);
      const blueprint = await tools.organ.executeTool('key_genome.get_blueprint', ctx(reader), {});
      for (const field of COMPOSITES) expect(blueprint.data[field] ?? null, field).toBeNull();
      expect(blueprint.data.financials).toEqual({});
      expect(blueprint.data.genomeDnaScores.financial).toBeUndefined();
      expect(JSON.stringify(blueprint.data)).not.toMatch(FIGURES);
      const facts = await tools.organ.executeTool('key_genome.list_facts', ctx(reader), {});
      expect(facts.data.facts.map((f: any) => f.id)).toEqual([`${P}fact_ops`]);
      expect(facts.data.count).toBe(1);
      const readiness = await tools.organ.executeTool('key_genome.get_readiness', ctx(reader), {});
      expect(readiness.data.readiness.map((r: any) => r.module)).toEqual(['sop']);
      for (const module of ['reports', 'crm']) {
        const one = await tools.organ.executeTool('key_genome.get_readiness', ctx(reader), { module });
        expect(one.data.readiness, module).toBeNull();
      }
      const finance = await tools.organ.executeTool('key_genome.get_readiness', ctx(reader), { module: 'finance' });
      expect(finance.data.readiness).toBeNull();
      const dna = await tools.bridge.execute({ module: 'genome', action: 'get_dna', parameters: {}, businessId: ID.biz, userId: reader, source: 'key_cortex', timestamp: new Date(), correlationId: 'c' });
      expect(dna.success).toBe(true);
      const data = dna.data as any;
      expect(data.scores.financial).toBeUndefined();
      expect(data.scores.sales).toBeUndefined();
      expect(data.scores.founder).toBe(100);
      expect(data.stage ?? null).toBeNull();
      expect(data.executiveReadiness ?? null).toBeNull();
    }
    // The owner is served the whole genome.
    const owner = await tools.organ.executeTool('key_genome.calculate_integrity', ctx(ID.owner), {});
    expectWholeGenome(owner.data);
    const ownerFacts = await tools.organ.executeTool('key_genome.list_facts', ctx(ID.owner), {});
    expect(ownerFacts.data.count).toBe(3);
    const ownerDna = await tools.bridge.execute({ module: 'genome', action: 'get_dna', parameters: {}, businessId: ID.biz, userId: ID.owner, source: 'key_cortex', timestamp: new Date(), correlationId: 'c' });
    expect((ownerDna.data as any).scores.financial).toBe(29);
    expect((ownerDna.data as any).executiveReadiness).toBe(61);
  });

  it('SR-11 controls: owner and revenue reader served whole; outsider refused; no reader sees another reader\'s projection', async () => {
    for (const reader of [ID.owner, ID.staffRead]) {
      const genome = await get(bp('/genome'), reader);
      expectWholeGenome(genome.body);
      expect(genome.body.dnaSections.map((s: any) => s.key)).toEqual(expect.arrayContaining(MONEY_DNA));
      const root = await get(bp(), reader);
      expect(root.body.genomeIntegrity).toBe(57);
      expect(root.body.financials.avgTicket).toBe(4500.25);
      const snapshot = await get(`/business-command-center/businesses/${ID.biz}/snapshot`, reader);
      expect(snapshot.body.health.genomeIntegrity).toBe(57);
      expect(snapshot.body.keyGenome.overall).toBe(47);
      expect(snapshot.body.keyGenome.crossDomain?.healthScore).toBe(44);
      expect(snapshot.body.moduleReadiness.map((m: any) => m.module)).toEqual(['finance', 'commerce', 'crm', 'reports', 'sop']);
    }
    // Interleaved reads: owner, member, owner, member.
    const seq = [ID.owner, ID.staffNone, ID.owner, ID.staffNone];
    for (const reader of seq) {
      const res = await get(bp('/genome'), reader);
      if (reader === ID.owner) expectWholeGenome(res.body);
      else expectProjectedGenome(res.body);
    }
    for (const route of [bp(), bp('/genome'), bp('/genome/integrity'), `/intelligence/businesses/${ID.biz}/executive-brief`, `/business-command-center/businesses/${ID.biz}/snapshot`]) {
      const res = await get(route, ID.outsider);
      expect(res.status, route).toBe(403);
    }
    // Cross-tenant: the member of biz is refused biz2's genome.
    const cross = await get(bp('/genome', ID.biz2), ID.staffNone);
    expect(cross.status).toBe(403);
    expect(keysOf(cross.body)).not.toContain('genomeDnaScores');
  });
  it('SR-12 write routes answer the blueprint as GET does (round 1, both reviews MAJOR)', async () => {
    const patch = await request(app.getHttpServer()).patch(bp()).set(HEADER, ID.staffNone).send({});
    const dna = await request(app.getHttpServer()).patch(bp('/genome/dna/operations')).set(HEADER, ID.staffNone).send({ data: { coreWorkflows: ['intake'] } });
    const onboarding = await request(app.getHttpServer()).post(bp('/infer/onboarding')).set(HEADER, ID.staffNone).send({ answers: {} });
    for (const [name, res] of [['PATCH', patch], ['PATCH dna', dna], ['infer/onboarding', onboarding]] as const) {
      expect(res.status, name).toBeLessThan(300);
      for (const field of COMPOSITES) expect(res.body[field] ?? null, `${name} ${field}`).toBeNull();
      expect(res.body.financials ?? {}, name).toEqual({});
      expect(res.body.genomeDnaScores?.financial, name).toBeUndefined();
      expect(res.body.completeness ?? null, name).toBeNull();
      expect(JSON.stringify(res.body), name).not.toMatch(FIGURES);
    }
    const tool = await tools.organ.executeTool('key_genome.update_dna_section', { businessId: ID.biz, userId: ID.staffNone }, { sectionKey: 'operations', data: { coreWorkflows: ['intake'] } });
    expect(tool.success).toBe(true);
    for (const field of COMPOSITES) expect(tool.data[field] ?? null, `tool ${field}`).toBeNull();
    expect(tool.data.financials).toEqual({});
    expect(JSON.stringify(tool.data)).not.toMatch(FIGURES);
    // The owner's write answers the whole blueprint.
    const owner = await request(app.getHttpServer()).patch(bp()).set(HEADER, ID.owner).send({});
    expect(owner.body.financials.avgTicket).toBe(4500.25);
    expect(typeof owner.body.genomeIntegrity).toBe('number');
  });

  it('SR-13 a failed executive brief leaves the withheld composites null, not 0 (round 1, MINOR/NIT)', async () => {
    const { BusinessIntelligenceService } = await import('../src/modules/intelligence/business-intelligence.service');
    const intelligence = moduleRef.get(BusinessIntelligenceService);
    const spy = vi.spyOn(intelligence, 'generateExecutiveBrief').mockRejectedValue(new Error('brief down'));
    try {
      const res = await get(`/business-command-center/businesses/${ID.biz}/snapshot`, ID.staffNone);
      expect(res.status).toBe(200);
      for (const field of COMPOSITES) expect(res.body.health[field] ?? null, field).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
