/**
 * FU-KEY-ACTION-GENOME-PROJECTION (owner rulings D-128, D-233, D-238). Found by the NAV-A1 and
 * FU-TEMPORAL-FLOW-INBOX-SCOPE security reviews: a KEY action proposal bridged from a FINANCIAL genome
 * recommendation, and the timeline rows written by key-action-executor (key.action.create_task copies the
 * proposal's title, rationale and payload) and by genome-evolution (`${section} proposal <status>: ${reason}`
 * with the proposed patch, for the financial and sales DNA sections too), reach a member without revenue read.
 *
 * Paths under test, each served to a STAFF member whose explicit scope map says revenue:'none':
 *
 *   KAG-01  GET /key-autonomy/.../actions/proposals and proposals/:id: a proposal bridged from a FINANCIAL
 *           recommendation (neutral title, figures in its rationale; and one whose text is neutral, financial only
 *           by its provenance) is withheld (list) or 404 (by id). The non-financial bridged proposal is served.
 *   KAG-02  GET /temporal-flow/businesses/:id (list, calendar, reminders): the key.action.create_task row of the
 *           financial proposal is withheld; that of the non-financial proposal is served.
 *   KAG-03  The same reads: genome-evolution decision rows (written by the real GenomeEvolutionService) of the
 *           financial and sales sections, of an unknown section, of an operations proposal whose reason states a
 *           figure, and of a proposal that cannot be read in this business (another tenant's id, fail closed) are
 *           withheld; the operations row with neutral text is served.
 *   KAG-04  GET business-genome/.../key-genome/recommendations/:id/action-preview of the FINANCIAL recommendation
 *           answers 403 with ModuleScopeGuard's message and never reaches the bridge service; POST bridge-action of
 *           it answers 403 'revenue requires write access' for revenue none and read, and creates no proposal. The
 *           operations recommendation is previewed as before.
 *   KAG-05  Controls: the owner and a revenue:'read' member are served every row unchanged (the revenue:'read'
 *           member is refused only the financial bridge-action, a write); a member of another business is refused
 *           this business's reads by BusinessGuard.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, the global
 * TenantInterceptor, KeyActionProposalService's reads, TemporalFlowService, GenomeEvolutionService (its writer),
 * GenomeRecommendationService.getRecommendation and GenomeRecommendationActionBridgeService run against the
 * database at DATABASE_URL. Collaborators off these routes are stand-ins that throw if reached; the bridge's
 * proposal writer is a recorder (the gate under test is before it). Identity attachment is a stand-in: a test
 * middleware reads `x-test-user` and attaches `{ id, email, role }` as AuthMiddleware would.
 *
 * Fixtures: prefix `v73k_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v73k_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffMissing: `${P}staffMissing`,
  superAdmin: `${P}superAdmin`,
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  biz2: `${P}biz2`,
  recFin: `${P}rec_fin`,
  recOps: `${P}rec_ops`,
  recOther: `${P}rec_other`,
  recOpsMoney: `${P}rec_opsm`,
  recMkt: `${P}rec_mkt`,
  recMktInputs: `${P}rec_mkti`,
  recCapacity: `${P}rec_cap`,
  propFin: `${P}prop_fin`,
  propFinQuiet: `${P}prop_finq`,
  propOps: `${P}prop_ops`,
  propCross: `${P}prop_cross`,
  propOpsSummary: `${P}prop_opss`,
  propOpsPayload: `${P}prop_opsp`,
  evoFin: `${P}evo_fin`,
  evoSales: `${P}evo_sales`,
  evoOdd: `${P}evo_odd`,
  evoOpsMoney: `${P}evo_opsm`,
  evoOps: `${P}evo_ops`,
  evoGrowth: `${P}evo_growth`,
  evoApproveFin: `${P}evo_apfin`,
  evoApproveBiz: `${P}evo_apbiz`,
  evoOther: `${P}evo_other`,
};

/** Figures only the financial rows of this fixture carry (D-233: withheld from a reader without revenue read). */
const FIGURES = /8,?765\.43|31\.7%|4,?500\.25|TTD 912/;
const READ_DENIED = 'Insufficient permissions: revenue requires read access (you have none)';
const WRITE_DENIED = (has: 'none' | 'read') => `Insufficient permissions: revenue requires write access (you have ${has})`;

let db: any;
let app: any;
let evolution: any;
let executor: any;
let blueprint: any;
let proposalService: any;
let GenomeEvolutionServiceClass: any;
let prismaRef: any;
let temporalRef: any;
const SPY: Record<string, any> = {};
const bridgedProposals: unknown[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_recommendations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
const post = (url: string, as: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).post(url).set(HEADER, as).send(body);

const proposalsUrl = (biz = ID.biz) => `/key-autonomy/businesses/${biz}/actions/proposals`;
const timelineUrl = (biz = ID.biz) => `/temporal-flow/businesses/${biz}`;
const bridgeUrl = (rec: string, biz = ID.biz) => `/business-genome/businesses/${biz}/key-genome/recommendations/${rec}`;
const FROM = new Date(Date.now() - 10 * 86400_000).toISOString();
const TO = new Date(Date.now() + 86400_000).toISOString();

/** Every timeline read a reader is served, by the three routes. */
async function timelineReads(as: string) {
  const list = await get(`${timelineUrl()}?limit=200`, as);
  const calendar = await get(`${timelineUrl()}/calendar?from=${FROM}&to=${TO}`, as);
  const reminders = await get(`${timelineUrl()}/reminders`, as);
  return { list, calendar, reminders };
}

const entityIds = (body: any) => (Array.isArray(body) ? body : []).map((e: any) => e.entityId).sort();

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
  const { KeyActionProposalController } = await import('../src/modules/key-autonomy/key-action-proposal.controller');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { TemporalFlowController } = await import('../src/modules/temporal-flow/temporal-flow.controller');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { TemporalFlowMemoryQueueService } = await import('../src/modules/temporal-flow/temporal-flow-memory.queue.service');
  const { TemporalFlowGenomeBridgeService } = await import('../src/modules/temporal-flow/temporal-flow-genome-bridge.service');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { KeyActionExecutorService } = await import('../src/modules/key-autonomy/key-action-executor.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { KeyGenomeBridgeController } = await import('../src/modules/key-autonomy/key-genome-bridge.controller');
  const { GenomeRecommendationActionBridgeService } = await import('../src/modules/key-autonomy/genome-recommendation-action-bridge.service');
  const { GenomeRecommendationService } = await import('../src/modules/business-genome/key-genome/genome-recommendation.service');

  const offRoute = (name: string) => new Proxy({}, {
    // Nest's lifecycle hooks and promise probes are not calls into the collaborator.
    get: (_t, prop) => (prop === 'then' || (typeof prop === 'string' && /^(on|before)(Module|Application)/.test(prop))
      ? undefined
      : () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); }),
  });

  const built: Record<string, any> = {};
  const once = (name: string, make: () => any) => (built[name] ??= make());
  const temporalOf = (prisma: any) => once('temporal', () => new TemporalFlowService(prisma, undefined as any, undefined as any));
  const proposalsOf = (prisma: any) => once('proposals', () => new KeyActionProposalService(
    prisma, temporalOf(prisma), offRoute('EventEmitter2') as any, offRoute('KeyActionPolicyService') as any,
    offRoute('KeyActionExecutorService') as any, offRoute('KeyActionGenomePolicyService') as any,
    offRoute('AutonomyOrchestratorService') as any, offRoute('KeyActionBoundaryService') as any,
  ));
  const recommendationsOf = (prisma: any) => once('recommendations', () => new GenomeRecommendationService(
    prisma, offRoute('GenomeSignalService') as any, offRoute('GenomeModuleReadinessService') as any,
    offRoute('GenomeScoringService') as any, offRoute('GenomeExperimentService') as any,
    offRoute('GenomeMemoryService') as any, offRoute('OutcomeLearningService') as any, offRoute('GenomeRecommendationOutcomeService') as any,
  ));
  // The bridge writes its proposal through KeyActionProposalService.create; a recorder stands in for it (the gate
  // under test runs before the bridge service).
  const proposalRecorder = {
    create: async (businessId: string, input: unknown) => {
      bridgedProposals.push({ businessId, input });
      return { id: `${P}bridged_${bridgedProposals.length}` };
    },
    list: async () => [],
  };
  const bridgeOf = (prisma: any) => once('bridge', () => new GenomeRecommendationActionBridgeService(
    prisma, recommendationsOf(prisma), offRoute('GenomeExperimentService') as any, proposalRecorder as any,
    { requiresApproval: () => true } as any, { getReadiness: async () => [] } as any,
  ));
  const live = (token: any, make: (prisma: any) => any) => ({ provide: token, inject: [PrismaService], useFactory: make });

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyActionProposalController, TemporalFlowController, KeyGenomeBridgeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      live(TemporalFlowService, temporalOf),
      live(KeyActionProposalService, proposalsOf),
      live(GenomeRecommendationService, recommendationsOf),
      live(GenomeRecommendationActionBridgeService, bridgeOf),
      { provide: KeyCortexApprovalOrchestratorService, useValue: offRoute('KeyCortexApprovalOrchestratorService') },
      { provide: TemporalFlowMemoryService, useValue: offRoute('TemporalFlowMemoryService') },
      { provide: TemporalFlowMemoryQueueService, useValue: offRoute('TemporalFlowMemoryQueueService') },
      { provide: TemporalFlowGenomeBridgeService, useValue: offRoute('TemporalFlowGenomeBridgeService') },
    ],
  }).compile();

  const prisma = moduleRef.get(PrismaService);
  evolution = new GenomeEvolutionService(prisma, offRoute('BlueprintService') as any, temporalOf(prisma));
  GenomeEvolutionServiceClass = GenomeEvolutionService;
  prismaRef = prisma;
  temporalRef = temporalOf(prisma);
  // Round 7 (both reviews, MINOR): the real writers of the create_task and DNA section rows.
  executor = new KeyActionExecutorService(
    temporalOf(prisma), evolution, offRoute('ConstitutionVersionService') as any, offRoute('GenomeDocumentPackService') as any,
    offRoute('KeyActionExecutorRegistryService') as any, offRoute('SafetyShellService') as any, offRoute('ActionAuditService') as any,
  );
  blueprint = new BlueprintService(
    prisma, temporalOf(prisma), offRoute('GenomeScoringService') as any, offRoute('KeyGenomeService') as any,
    offRoute('GenomeModuleReadinessService') as any, offRoute('KeyGenomeBackfillService') as any, offRoute('EventEmitter2') as any,
  );
  proposalService = proposalsOf(prisma);
  const bridge = moduleRef.get(GenomeRecommendationActionBridgeService);
  SPY.preview = vi.spyOn(bridge, 'previewRecommendationAction');
  SPY.bridge = vi.spyOn(bridge, 'bridgeRecommendation');
  // Marking the recommendation applied is bookkeeping after the bridge's own write (outcome learning, outcome
  // recorder); it answers the recommendation, as the real method does.
  vi.spyOn(moduleRef.get(GenomeRecommendationService), 'applyRecommendation')
    .mockImplementation(async (_b: string, id: string) => ({ id }) as any);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(prisma));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.staffNone, ID.staffRead, ID.staffMissing, ID.superAdmin, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V73K Projection', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.biz2, name: 'V73K Other', slug: `${P}biz2`, ownerId: ID.outsider, currency: 'TTD' } });
  for (const [user, biz, role, permissionScopes] of [
    [ID.owner, ID.biz, 'OWNER', undefined],
    // SWP-CENSUS-KEY-B (P109, Ruling B2): bridge-action now requires ai:write before requireBridgeRevenue;
    // keep revenue: 'none'/'read' so KAG-04 still proves requireBridgeRevenue 403.
    [ID.staffNone, ID.biz, 'STAFF', { revenue: 'none', crm: 'read', operations: 'write', ai: 'write' }],
    [ID.staffRead, ID.biz, 'STAFF', { revenue: 'read', crm: 'read', operations: 'write', ai: 'write' }],
    // Round 2 (security MINOR-2): an explicit map without a revenue key reads revenue 'none'.
    [ID.staffMissing, ID.biz, 'STAFF', { crm: 'read', operations: 'write' }],
    [ID.superAdmin, ID.biz, 'STAFF', { crm: 'read' }],
    [ID.outsider, ID.biz2, 'OWNER', undefined],
  ] as const) {
    await db.membership.create({
      data: { id: `${user}_${biz}_m`, userId: user, businessId: biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }

  // Genome recommendations, as the finance and operations genomes write them. The FINANCIAL one carries figures.
  const rec = (id: string, businessId: string, domain: string, title: string, diagnosis: string) => db.genomeRecommendation.create({
    data: {
      id, businessId, domain, title, diagnosis, status: 'ACCEPTED',
      insight: diagnosis, recommendation: `Act on: ${title}`, riskLevel: 'MEDIUM',
    },
  });
  await rec(ID.recFin, ID.biz, 'FINANCIAL', 'Tighten the follow-up cadence', 'Receivables of TTD 8,765.43 are past due; net margin is 31.7%.');
  await rec(ID.recOps, ID.biz, 'OPERATIONS', 'Confirm tomorrow appointments', 'Three appointments are unconfirmed.');
  await rec(ID.recOther, ID.biz2, 'OPERATIONS', 'Confirm tomorrow appointments', 'Three appointments are unconfirmed.');
  // Round 4 (correctness MAJOR-1): recommendations as the marketing and operations genomes write them; their text names
  // money words but states no figure, and the recommendations list serves them to a revenue-none member.
  for (const [id, domain, title, insight, diagnosis, recommendation, expectedGain] of [
    [ID.recMkt, 'MARKETING', 'Add active growth channels', 'A single active channel creates fragility.', 'Fewer than two active growth channels are recorded.', 'Identify and activate at least one additional owned, earned, or paid channel.', 'Improve diversification and reduce acquisition risk.'],
    [ID.recMktInputs, 'MARKETING', 'Complete missing marketing/growth inputs', 'Missing inputs reduce confidence and actionability.', 'Missing inputs: growth_channels, content_strategy.', 'Record growth channels, content strategy, target CAC, and conversion rates.', 'Increase marketing genome confidence and readiness.'],
    [ID.recCapacity, 'OPERATIONS', 'Plan capacity increase', 'Capacity cannot support current demand reliably.', 'Average utilization is 92%.', 'Add capacity, reduce backlog, or adjust sales commitments.', null],
  ] as const) {
    await db.genomeRecommendation.create({ data: { id, businessId: ID.biz, domain, title, insight, diagnosis, recommendation, expectedGain, status: 'ACCEPTED', riskLevel: 'MEDIUM' } });
  }
  // Round 3 (correctness NOTE): an OPERATIONS recommendation whose insight and recommendation text state a figure.
  await db.genomeRecommendation.create({
    data: {
      id: ID.recOpsMoney, businessId: ID.biz, domain: 'OPERATIONS', title: 'Reduce weekend overtime', status: 'ACCEPTED',
      diagnosis: 'Weekend shifts run long.', insight: 'Overtime cost TTD 912 last week.', recommendation: 'Cap overtime below TTD 912 a week.',
      riskLevel: 'MEDIUM',
    },
  });

  // KEY action proposals in the shape GenomeRecommendationActionBridgeService.bridgeToProposal writes them.
  const proposal = (id: string, businessId: string, recommendationId: string, title: string, rationale: string) => db.keyActionProposal.create({
    data: {
      id, businessId, sourceType: 'GENOME_EVOLUTION', sourceId: recommendationId, title, summary: title, rationale,
      actionType: 'CREATE_TASK', riskLevel: 'LOW', status: 'PENDING',
      payload: { title, source: 'KEY_GENOME_RECOMMENDATION', recommendationId, bridgeActionKind: 'MANUAL_TASK' },
    },
  });
  await proposal(ID.propFin, ID.biz, ID.recFin, 'Follow up: Tighten the follow-up cadence', 'Receivables of TTD 8,765.43 are past due; net margin is 31.7%.');
  await proposal(ID.propFinQuiet, ID.biz, ID.recFin, 'Follow up: Tighten the follow-up cadence', 'Recommended by the business genome.');
  await proposal(ID.propOps, ID.biz, ID.recOps, 'Follow up: Confirm tomorrow appointments', 'Three appointments are unconfirmed.');
  // Bridged from another business's recommendation id: it cannot be read in this business (fail closed).
  await proposal(ID.propCross, ID.biz, ID.recOther, 'Follow up: Confirm tomorrow appointments', 'Three appointments are unconfirmed.');
  // Round 2 (security MINOR-1): a non-financial proposal whose create_task row's summary states a figure (another
  // writer, or the rationale changed after execution).
  await db.keyActionProposal.create({
    data: {
      id: ID.propOpsSummary, businessId: ID.biz, sourceType: 'GENOME_EVOLUTION', sourceId: ID.recOps,
      title: 'Follow up: Confirm tomorrow appointments', summary: 'Confirm tomorrow appointments', rationale: 'Three appointments are unconfirmed.',
      actionType: 'CREATE_TASK', riskLevel: 'LOW', status: 'PENDING',
      payload: { title: 'Confirm tomorrow appointments', source: 'KEY_GENOME_RECOMMENDATION', recommendationId: ID.recOps, bridgeActionKind: 'MANUAL_TASK' },
    },
  });

  // key.action.create_task rows, in the shape KeyActionExecutorService.executeCreateTask writes them.
  const remindAt = new Date(Date.now() - 3600_000);
  // Round 3 (security MINOR-1): a non-financial proposal whose create_task row's payload carries a figure under a key
  // the named-key read does not look at (another writer, or the payload changed after execution).
  await proposal(ID.propOpsPayload, ID.biz, ID.recOps, 'Follow up: Confirm tomorrow appointments', 'Three appointments are unconfirmed.');
  // Round 7: the plain proposals' create_task rows are written by KeyActionExecutorService.executeCreateTask itself; the
  // two rows that differ from their proposal (a summary or payload another writer changed) are written in its shape.
  const writesTasks = trackAsyncWrites([[TemporalFlowService.prototype, 'emit']]);
  for (const p of [ID.propFin, ID.propFinQuiet, ID.propOps, ID.propCross]) {
    await executor.executeCreateTask(ID.biz, await proposalService.get(ID.biz, p), ID.owner);
  }
  await writesTasks.drain();
  writesTasks.restore();
  await db.temporalFlowEvent.updateMany({ where: { businessId: ID.biz, type: 'key.action.create_task' }, data: { reminderAt: remindAt, startsAt: remindAt } });
  for (const p of [ID.propOpsSummary, ID.propOpsPayload]) {
    const row = await db.keyActionProposal.findUnique({ where: { id: p } });
    await db.temporalFlowEvent.create({
      data: {
        id: `${p}_task`, businessId: ID.biz, source: 'KEY', type: 'key.action.create_task', module: 'key-autonomy',
        entityType: 'key_action_proposal', entityId: p, title: row.title,
        summary: p === ID.propOpsSummary ? 'Overtime cost TTD 912 last week' : row.rationale,
        status: 'ACTION_REQUIRED', importance: 'NORMAL',
        payload: p === ID.propOpsPayload ? { ...row.payload, amountDue: 'TTD 912' } : row.payload,
        reminderAt: remindAt, startsAt: remindAt,
      },
    });
  }

  // Round 4 (correctness MINOR-2): a blocked_by_autonomy row of the non-financial proposal, in the shape
  // KeyActionProposalService.emitLifecycleEvent writes it with AutonomyOrchestrator's ToolOutcomeScore trace.
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}blocked_row`, businessId: ID.biz, source: 'KEY', type: 'key.action.blocked_by_autonomy', module: 'key-autonomy',
      entityType: 'key_action_proposal', entityId: ID.propOps, title: 'KEY action blocked_by_autonomy', summary: 'Action CREATE_TASK',
      importance: 'HIGH', reminderAt: remindAt, startsAt: remindAt,
      // Round 5 (correctness M3): the orchestrator's own strings (autonomy-orchestrator.service.ts, tool outcome guard).
      payload: {
        actionType: 'CREATE_TASK', executedBy: ID.owner, reason: 'Tool CREATE_TASK success rate is below 30% — blocked',
        ruleTrace: [
          // Round 9 (security MAJOR-1): the genome gate's entry; its scores average the affected domains' health, the
          // revenue-quality and finance scores among them (D-233).
          { source: 'GenomeAutonomyGateService', rule: 'genome-gate', result: 'allow', reason: 'Genome readiness gate passed', metadata: { readinessScore: 83, confidenceScore: 0.7, riskLevel: 'MEDIUM' } },
          { source: 'ToolOutcomeScore', rule: 'tool-score-CREATE_TASK', result: 'supervised', reason: 'Tool CREATE_TASK success rate is 20% over 5 uses', metadata: { successRate: 0.2, totalUses: 5 } },
        ],
      },
    },
  });
  // Round 5 (security MINOR-3, correctness M2): a business-wide allow rule whose reason states money, in the trace of a
  // blocked row of the same non-financial proposal (allow entries are not copied into the row's reason).
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}blocked_rule_row`, businessId: ID.biz, source: 'KEY', type: 'key.action.blocked_by_autonomy', module: 'key-autonomy',
      entityType: 'key_action_proposal', entityId: ID.propOps, title: 'KEY action blocked_by_autonomy', summary: 'Action CREATE_TASK',
      importance: 'HIGH', reminderAt: remindAt, startsAt: remindAt,
      payload: {
        actionType: 'CREATE_TASK', executedBy: ID.owner, reason: 'Tool CREATE_TASK success rate is below 30% — blocked',
        ruleTrace: [
          { source: 'AutonomyRule', rule: 'auto-small-payments', result: 'allow', reason: 'Payments under TTD 912 are auto-approved' },
          { source: 'ToolOutcomeScore', rule: 'tool-score-CREATE_TASK', result: 'supervised', reason: 'Tool CREATE_TASK success rate is 20% over 5 uses', metadata: { successRate: 0.2, totalUses: 5 } },
        ],
      },
    },
  });

  // Round 6 (security P-1): approving an evolution proposal writes the DNA section through BlueprintService.updateDnaSection,
  // which emits genome.section_updated (entityType dna_section) with the patch. Round 7: the rows are written by
  // BlueprintService's own emitter (updateDnaSection's last step; its blueprint write is off these routes).
  const writesDna = trackAsyncWrites([[TemporalFlowService.prototype, 'emit']]);
  for (const [section, data] of [
    ['financial', { avgTicket: 4500.25, pricingModel: 'retainer' }],
    ['sales', { salesChannels: ['direct-invoice'] }],
    ['operations', { coreWorkflows: ['appointment-booking'] }],
    // Round 7 (correctness MINOR-1): an ordinary founder edit with a figure: served with its data redacted.
    ['founder', { weeklyAvailabilityHours: 20 }],
  ] as const) {
    blueprint.emitGenomeUpdated(ID.biz, 'genome.section_updated', `${section} DNA updated`, { section, data }, section);
  }
  await writesDna.drain();
  writesDna.restore();
  await db.temporalFlowEvent.updateMany({ where: { businessId: ID.biz, entityType: 'dna_section' }, data: { reminderAt: remindAt, startsAt: remindAt } });
  // Round 7 (correctness NOTE-3): a row of a shape the writer never produces (payload a list) fails closed.
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}dna_odd`, businessId: ID.biz, source: 'APP', type: 'genome.section_updated', entityType: 'dna_section', entityId: 'founder',
      title: 'founder DNA updated', importance: 'NORMAL', payload: [{ avgTicket: 4500.25 }], reminderAt: remindAt, startsAt: remindAt,
    },
  });
  // Round 6 (correctness MINOR-2): a row naming the non-financial proposal whose own title states money (POST
  // temporal-flow takes any entityType).
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}titled_row`, businessId: ID.biz, source: 'APP', type: 'note', entityType: 'key_action_proposal', entityId: ID.propOps,
      title: 'Maria owes 900 for the last visit', importance: 'NORMAL', reminderAt: remindAt, startsAt: remindAt, payload: {},
    },
  });

  // Round 8 (correctness NOTE-2): a rule whose metadata states an amount, in the trace of a blocked row of the
  // non-financial proposal; only the orchestrator's own count and score keys are left out of the read.
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}blocked_meta_row`, businessId: ID.biz, source: 'KEY', type: 'key.action.blocked_by_autonomy', module: 'key-autonomy',
      entityType: 'key_action_proposal', entityId: ID.propOps, title: 'KEY action blocked_by_autonomy', summary: 'Action CREATE_TASK',
      importance: 'HIGH', reminderAt: remindAt, startsAt: remindAt,
      payload: {
        actionType: 'CREATE_TASK', executedBy: ID.owner, reason: 'Tool CREATE_TASK success rate is below 30% — blocked',
        ruleTrace: [{ source: 'AutonomyRule', rule: 'rule-7', result: 'allow', reason: 'Within the configured rule', metadata: { limit: 'TTD 912', priority: 'Maria owes TTD 912' } }],
      },
    },
  });

  // Genome evolution proposals; their decision rows are written by the real GenomeEvolutionService below.
  const evo = (id: string, businessId: string, section: string, reason: string, proposedPatch: Record<string, unknown>) =>
    db.genomeEvolutionProposal.create({ data: { id, businessId, section, reason, proposedPatch, status: 'PENDING', confidence: 0.6 } });
  await evo(ID.evoFin, ID.biz, 'financial', 'Gross margin moved to 31.7% this quarter', { grossMarginPercent: 31.7, pricingModel: 'retainer' });
  await evo(ID.evoSales, ID.biz, 'sales', 'Average deal closes at TTD 4,500.25', { averageDealSize: 4500.25 });
  await evo(ID.evoOdd, ID.biz, 'treasury_notes', 'Collected TTD 912 in deposits', { deposits: 912 });
  await evo(ID.evoOpsMoney, ID.biz, 'operations', 'Overtime cost TTD 912 last week', { coreWorkflows: ['overtime'] });
  await evo(ID.evoOps, ID.biz, 'operations', 'Bookings are handled through WhatsApp', { coreWorkflows: ['appointment-booking'] });
  // Round 5 (security MAJOR-1): a bare figure in the reason only (no currency, no money word; the patch is neutral).
  await evo(ID.evoGrowth, ID.biz, 'growth', 'Hit 120k this quarter', { ninetyDayPlan: ['Grow repeat bookings'] });
  await evo(ID.evoOther, ID.biz2, 'operations', 'Bookings are handled through WhatsApp', { coreWorkflows: ['appointment-booking'] });
  // emitDecisionEvent does not await its write (round 2, correctness MINOR-2): its emits are tracked and drained.
  const writes = trackAsyncWrites([[TemporalFlowService.prototype, 'emit']]);
  for (const id of [ID.evoFin, ID.evoSales, ID.evoOdd, ID.evoOpsMoney, ID.evoOps, ID.evoGrowth]) await evolution.reject(ID.biz, id, ID.owner);
  // Round 8 (both reviews, MINOR): the approval path through the real services. GenomeEvolutionService.approve calls
  // BlueprintService.updateDnaSection, whose own emitter writes the DNA section row; only the blueprint write itself
  // (updateBlueprint) and the integrity score it returns are stand-ins (off these routes).
  await evo(ID.evoApproveFin, ID.biz, 'financial', 'Pricing review', { avgTicket: 4500.25 });
  // Money in words only (no digit) in a non-money section: the DNA row is redacted, the decision row withheld.
  await evo(ID.evoApproveBiz, ID.biz, 'business', 'Model review', { revenueModel: 'commission on every sale' });
  vi.spyOn(blueprint, 'updateBlueprint').mockImplementation(async () => ({}) as any);
  vi.spyOn(blueprint, 'calculateGenomeIntegrity').mockImplementation(async () => ({ overall: 0 }) as any);
  const approving = new GenomeEvolutionServiceClass(prismaRef, blueprint, temporalRef);
  for (const id of [ID.evoApproveFin, ID.evoApproveBiz]) await approving.approve(ID.biz, id, ID.owner);
  await writes.drain();
  writes.restore();
  // A decision row in this business naming another business's proposal (cannot be read here: fail closed).
  await db.temporalFlowEvent.create({
    data: {
      id: `${P}evo_cross_row`, businessId: ID.biz, source: 'KEY', type: 'genome_evolution.proposal_rejected',
      module: 'business-genome', entityType: 'genome_evolution_proposal', entityId: ID.evoOther,
      title: 'Genome evolution proposal rejected', summary: 'operations proposal rejected: Bookings are handled through WhatsApp',
      importance: 'HIGH', genomeImpactPotential: true,
      payload: { proposalId: ID.evoOther, section: 'operations', status: 'REJECTED', proposedPatch: { coreWorkflows: ['appointment-booking'] } },
    },
  });
  // The eight rows the service wrote (six rejected, two approved) and the cross-business row above.
  expect(await db.temporalFlowEvent.count({ where: { businessId: ID.biz, entityType: 'genome_evolution_proposal' } })).toBe(9);
  // The real writer's rows carry reminder and calendar times only when given; give them one so all three reads see them.
  await db.temporalFlowEvent.updateMany({
    where: { businessId: ID.biz, entityType: { in: ['genome_evolution_proposal', 'dna_section'] }, NOT: { id: `${P}dna_odd` } },
    data: { reminderAt: remindAt, startsAt: remindAt, status: 'ACTION_REQUIRED' },
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

const ALL_TASKS = [ID.propCross, ID.propFin, ID.propFinQuiet, ID.propOps, ID.propOpsSummary, ID.propOpsPayload].sort();
/** The non-financial proposals a revenue-none member is served over REST. */
const OPS_PROPOSALS = [ID.propOps, ID.propOpsSummary, ID.propOpsPayload].sort();
const ALL_EVOS = [`${P}evo_other`, ID.evoApproveBiz, ID.evoApproveFin, ID.evoFin, ID.evoGrowth, ID.evoOdd, ID.evoOps, ID.evoOpsMoney, ID.evoSales];

describe('FU-KEY-ACTION-GENOME-PROJECTION: bridged FINANCIAL proposals and their timeline rows (D-128, D-233, D-238)', () => {
  it('fixture: the real GenomeEvolutionService wrote the decision rows with the reason and patch in them', async () => {
    const rows = await db.temporalFlowEvent.findMany({ where: { businessId: ID.biz, entityType: 'genome_evolution_proposal' } });
    expect(rows.map((r: any) => r.entityId).sort()).toEqual(ALL_EVOS.slice().sort());
    const fin = rows.find((r: any) => r.entityId === ID.evoFin);
    expect(fin.summary).toMatch(/financial proposal rejected: Gross margin moved to 31\.7%/);
    expect(JSON.stringify(fin.payload)).toMatch(/31\.7/);
  });

  it('KAG-01 a revenue-none member is not served a proposal bridged from a FINANCIAL recommendation (list, by id)', async () => {
    const list = await get(proposalsUrl(), ID.staffNone);
    expect(list.status).toBe(200);
    expect(list.body.map((p: any) => p.id).sort()).toEqual(OPS_PROPOSALS);
    expect(JSON.stringify(list.body)).not.toMatch(FIGURES);
    for (const id of [ID.propFin, ID.propFinQuiet, ID.propCross]) {
      const one = await get(`${proposalsUrl()}/${id}`, ID.staffNone);
      expect(one.status).toBe(404);
      expect(JSON.stringify(one.body)).not.toMatch(FIGURES);
    }
    expect((await get(`${proposalsUrl()}/${ID.propOps}`, ID.staffNone)).status).toBe(200);
  });

  it('KAG-02 a revenue-none member is not served the create_task timeline row of a financial proposal', async () => {
    const reads = await timelineReads(ID.staffNone);
    for (const res of Object.values(reads)) {
      expect(res.status).toBe(200);
      const tasks = res.body.filter((e: any) => e.type === 'key.action.create_task').map((e: any) => e.entityId).sort();
      expect(tasks).toEqual([ID.propOps]);
    }
  });

  it('KAG-03 a revenue-none member is not served genome-evolution rows of financial, sales, unknown, money-stating or unreadable proposals', async () => {
    const reads = await timelineReads(ID.staffNone);
    for (const [name, res] of Object.entries(reads)) {
      expect(res.status, name).toBe(200);
      const evos = res.body.filter((e: any) => e.entityType === 'genome_evolution_proposal').map((e: any) => e.entityId);
      expect(evos, name).toEqual([ID.evoOps]);
      expect(JSON.stringify(res.body), name).not.toMatch(FIGURES);
      expect(JSON.stringify(res.body), name).not.toMatch(/financial proposal|sales proposal/);
    }
  });

  it('KAG-04 the bridge preview of a FINANCIAL recommendation needs revenue read; bridging it needs revenue write', async () => {
    SPY.preview.mockClear();
    SPY.bridge.mockClear();
    // Round 2 review (correctness MINOR): no dependence on KAG-05b's bridge having run or not.
    bridgedProposals.length = 0;
    const preview = await get(`${bridgeUrl(ID.recFin)}/action-preview`, ID.staffNone);
    expect(preview.status).toBe(403);
    expect(JSON.stringify(preview.body)).toContain(READ_DENIED);
    expect(JSON.stringify(preview.body)).not.toMatch(FIGURES);
    expect(SPY.preview).not.toHaveBeenCalled();

    for (const [as, has] of [[ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
      const bridged = await post(`${bridgeUrl(ID.recFin)}/bridge-action`, as, { confirmBridge: true });
      expect(bridged.status).toBe(403);
      expect(JSON.stringify(bridged.body)).toContain(WRITE_DENIED(has));
      expect(JSON.stringify(bridged.body)).not.toMatch(FIGURES);
    }
    expect(SPY.bridge).not.toHaveBeenCalled();
    expect(bridgedProposals).toEqual([]);

    const ops = await get(`${bridgeUrl(ID.recOps)}/action-preview`, ID.staffNone);
    expect(ops.status).toBe(200);
    expect(ops.body.recommendationId).toBe(ID.recOps);
  });

  it('KAG-04b an unknown or other-tenant recommendation id answers as before (404), with nothing of the other tenant', async () => {
    for (const as of [ID.staffNone, ID.owner]) {
      const res = await get(`${bridgeUrl(ID.recOther)}/action-preview`, as);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/appointments/);
    }
  });

  it('KAG-05 controls: the owner and a revenue-read member are served every row unchanged', async () => {
    for (const as of [ID.owner, ID.staffRead, ID.superAdmin]) {
      const list = await get(proposalsUrl(), as);
      expect(list.status).toBe(200);
      expect(list.body.map((p: any) => p.id).sort()).toEqual(ALL_TASKS);
      const fin = list.body.find((p: any) => p.id === ID.propFin);
      expect(fin.rationale).toMatch(/8,765\.43/);
      expect((await get(`${proposalsUrl()}/${ID.propFin}`, as)).status).toBe(200);

      const reads = await timelineReads(as);
      for (const [name, res] of Object.entries(reads)) {
        expect(res.status, name).toBe(200);
        const tasks = res.body.filter((e: any) => e.type === 'key.action.create_task').map((e: any) => e.entityId).sort();
        expect(tasks, name).toEqual(ALL_TASKS);
        const evos = res.body.filter((e: any) => e.entityType === 'genome_evolution_proposal').map((e: any) => e.entityId).sort();
        expect(evos, name).toEqual(ALL_EVOS.slice().sort());
        const finRow = res.body.find((e: any) => e.entityId === ID.evoFin);
        expect(finRow.summary, name).toMatch(/31\.7%/);
      }

      const preview = await get(`${bridgeUrl(ID.recFin)}/action-preview`, as);
      expect(preview.status).toBe(200);
      expect(preview.body.recommendationId).toBe(ID.recFin);
    }
  });

  it('KAG-05b the owner may still bridge the FINANCIAL recommendation (revenue write); the bridge is reached', async () => {
    SPY.bridge.mockClear();
    const res = await post(`${bridgeUrl(ID.recFin)}/bridge-action`, ID.owner, { confirmBridge: true });
    expect(SPY.bridge).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(res.body.recommendationId).toBe(ID.recFin);
    expect(['CREATED', 'ALREADY_EXISTS']).toContain(res.body.status);
  });

  it('KAG-06 round 2: a create_task row whose summary states a figure is withheld though its proposal is non-financial', async () => {
    for (const res of Object.values(await timelineReads(ID.staffNone))) {
      expect(res.body.some((e: any) => e.entityId === ID.propOpsSummary)).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    }
  });

  it('KAG-07 round 2: a member whose explicit map has no revenue key is projected as revenue none', async () => {
    const list = await get(proposalsUrl(), ID.staffMissing);
    expect(list.body.map((p: any) => p.id).sort()).toEqual(OPS_PROPOSALS);
    for (const res of Object.values(await timelineReads(ID.staffMissing))) {
      expect(res.status).toBe(200);
      expect(res.body.filter((e: any) => e.entityType === 'genome_evolution_proposal').map((e: any) => e.entityId)).toEqual([ID.evoOps]);
      expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    }
    expect((await get(`${bridgeUrl(ID.recFin)}/action-preview`, ID.staffMissing)).status).toBe(403);
  });

  it('KAG-08 round 2: the type, module and entity filters and a small page do not route around the projection', async () => {
    for (const q of ['type=genome_evolution.proposal_rejected', 'module=business-genome', 'source=KEY', 'type=key.action.create_task', 'module=key-autonomy']) {
      const res = await get(`${timelineUrl()}?${q}&limit=200`, ID.staffNone);
      expect(res.status, q).toBe(200);
      expect(JSON.stringify(res.body), q).not.toMatch(FIGURES);
      const ids = res.body.map((e: any) => e.entityId);
      for (const hidden of [ID.evoFin, ID.evoSales, ID.evoOdd, ID.evoOpsMoney, ID.evoGrowth, ID.evoApproveFin, ID.evoApproveBiz, `${P}evo_other`, ID.propFin, ID.propFinQuiet, ID.propCross, ID.propOpsSummary, ID.propOpsPayload]) {
        expect(ids, q).not.toContain(hidden);
      }
    }
    // Withheld rows fill the first page of a one-row read: the read pages on and serves a readable row.
    const one = await get(`${timelineUrl()}?type=genome_evolution.proposal_rejected&limit=1`, ID.staffNone);
    expect(one.body.map((e: any) => e.entityId)).toEqual([ID.evoOps]);
  });

  it('KAG-09 round 3: a create_task row whose payload carries a figure under any key is withheld though its proposal is non-financial', async () => {
    for (const [name, res] of Object.entries(await timelineReads(ID.staffNone))) {
      expect(res.body.some((e: any) => e.entityId === ID.propOpsPayload), name).toBe(false);
      expect(res.body.some((e: any) => e.entityId === ID.propOps), name).toBe(true);
    }
  });

  it('KAG-10 round 3: the preview of a recommendation whose own text states a figure needs revenue read, whatever its domain', async () => {
    SPY.preview.mockClear();
    const none = await get(`${bridgeUrl(ID.recOpsMoney)}/action-preview`, ID.staffNone);
    expect(none.status).toBe(403);
    expect(JSON.stringify(none.body)).toContain(READ_DENIED);
    expect(JSON.stringify(none.body)).not.toMatch(FIGURES);
    expect(SPY.preview).not.toHaveBeenCalled();
    const read = await get(`${bridgeUrl(ID.recOpsMoney)}/action-preview`, ID.staffRead);
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toMatch(/TTD 912/);
  });

  it('KAG-11 round 4: non-money marketing/operations recommendations are previewed for revenue none; CAC/conversion marketing-inputs recommendation needs revenue read (D-234, MGC-02)', async () => {
    for (const id of [ID.recMkt, ID.recCapacity]) {
      const res = await get(`${bridgeUrl(id)}/action-preview`, ID.staffNone);
      expect(res.status, id).toBe(200);
      expect(res.body.recommendationId, id).toBe(id);
    }
    // FU-GENOME-SURFACES-REVENUE (MGC-02, D-234): COMPLETE_MARKETING_INPUTS names target CAC and conversion rates
    // and reflects whether withheld channel CAC/conversion inputs exist, so revenue:none is refused 403 while
    // revenue:read previews it cleanly.
    const denied = await get(`${bridgeUrl(ID.recMktInputs)}/action-preview`, ID.staffNone);
    expect(denied.status, ID.recMktInputs).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(READ_DENIED);
    const allowed = await get(`${bridgeUrl(ID.recMktInputs)}/action-preview`, ID.staffRead);
    expect(allowed.status, ID.recMktInputs).toBe(200);
    expect(allowed.body.recommendationId, ID.recMktInputs).toBe(ID.recMktInputs);
  });

  it('KAG-12 round 4: the blocked_by_autonomy row of a non-financial proposal is served (its rule trace counts uses, not money)', async () => {
    for (const [name, res] of Object.entries(await timelineReads(ID.staffNone))) {
      const row = res.body.find((e: any) => e.id === `${P}blocked_row`);
      expect(row, name).toBeDefined();
      // Round 9 (security MAJOR-1): served without any rule-trace metadata (the genome gate's scores among it); the
      // rules, sources, results and reasons stay.
      expect(row.payload.ruleTrace.map((t: any) => t.source), name).toEqual(['GenomeAutonomyGateService', 'ToolOutcomeScore']);
      expect(row.payload.ruleTrace.some((t: any) => 'metadata' in t), name).toBe(false);
      expect(JSON.stringify(row.payload), name).not.toMatch(/readinessScore|confidenceScore|83/);
    }
    for (const [name, res] of Object.entries(await timelineReads(ID.staffRead))) {
      const row = res.body.find((e: any) => e.id === `${P}blocked_row`);
      expect(row.payload.ruleTrace[0].metadata, name).toEqual({ readinessScore: 83, confidenceScore: 0.7, riskLevel: 'MEDIUM' });
    }
  });

  it('KAG-13 round 5: a blocked row whose rule trace states money is withheld; a growth row whose reason states a bare figure is withheld', async () => {
    for (const [name, res] of Object.entries(await timelineReads(ID.staffNone))) {
      expect(res.body.some((e: any) => e.id === `${P}blocked_rule_row`), name).toBe(false);
      expect(res.body.some((e: any) => e.entityId === ID.evoGrowth), name).toBe(false);
      expect(JSON.stringify(res.body), name).not.toMatch(/120k/);
    }
  });

  it('KAG-14 round 6: DNA section rows of the financial and sales sections, and a proposal row whose title states money, are withheld', async () => {
    const dna = (body: any[]) => body.filter((e: any) => e.entityType === 'dna_section');
    for (const [name, res] of Object.entries(await timelineReads(ID.staffNone))) {
      expect(dna(res.body).map((e: any) => e.entityId).sort(), name).toEqual(['business', 'founder', 'operations']);
      // Round 8: the business row an approval wrote is served redacted (money in words only).
      const business = dna(res.body).find((e: any) => e.entityId === 'business');
      expect(business.payload, name).toEqual({ section: 'business', redacted: true });
      expect(res.body.map((e: any) => e.id), name).not.toContain(`${P}titled_row`);
      expect(JSON.stringify(res.body), name).not.toMatch(/owes 900/);
    }
    for (const [name, res] of Object.entries(await timelineReads(ID.owner))) {
      expect(dna(res.body).map((e: any) => e.entityId).sort(), name).toEqual(['business', 'financial', 'financial', 'founder', 'founder', 'operations', 'sales']);
      expect(res.body.map((e: any) => e.id), name).toContain(`${P}titled_row`);
    }
  });

  it('KAG-15 round 7: a non-money DNA row with a figure is served redacted (its data withheld); revenue readers get it whole', async () => {
    const founder = (body: any[]) => body.filter((e: any) => e.entityType === 'dna_section' && e.entityId === 'founder' && e.id !== `${P}dna_odd`);
    for (const [name, res] of Object.entries(await timelineReads(ID.staffNone))) {
      const [row] = founder(res.body);
      expect(row, name).toBeDefined();
      expect(row.title, name).toBe('founder DNA updated');
      expect(JSON.stringify(row.payload), name).not.toMatch(/weeklyAvailabilityHours|20/);
      expect(row.payload.section, name).toBe('founder');
      const ops = res.body.find((e: any) => e.entityType === 'dna_section' && e.entityId === 'operations');
      expect(ops.payload.data, name).toEqual({ coreWorkflows: ['appointment-booking'] });
    }
    for (const [name, res] of Object.entries(await timelineReads(ID.staffRead))) {
      expect(founder(res.body)[0].payload.data, name).toEqual({ weeklyAvailabilityHours: 20 });
    }
  });

  it('KAG-16 round 9: a blocked row whose rule metadata states an amount is served with the metadata left out', async () => {
    for (const [name, res] of Object.entries(await timelineReads(ID.staffNone))) {
      const row = res.body.find((e: any) => e.id === `${P}blocked_meta_row`);
      expect(row, name).toBeDefined();
      expect(row.payload.ruleTrace[0].metadata, name).toBeUndefined();
      expect(JSON.stringify(row), name).not.toMatch(/TTD 912|owes/);
    }
  });

  it('KAG-05c cross-tenant: a member of another business is refused this business\'s reads', async () => {
    for (const url of [proposalsUrl(), timelineUrl(), `${bridgeUrl(ID.recFin)}/action-preview`]) {
      const res = await get(url, ID.outsider);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toMatch(FIGURES);
    }
  });
});
