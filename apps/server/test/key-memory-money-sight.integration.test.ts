/**
 * FU-KEY-MEMORY-MONEY-SIGHT (V1-71; the two minor findings W1F-PERCEPTION-MODULE-SCOPE left open, SEC-W1FPMS-3 and
 * SEC-W1FPMS-4; owner rulings D-128/D-100 (the genome's money needs revenue read), D-73/D-93 (no member, no figure),
 * D-104 (membership is the rule); journey K).
 *
 * KEY's memory reads (the "WHAT YOU HAVE OBSERVED" block of POST /ai/businesses/:id/flow/chat and its stream, which the
 * staff WhatsApp/SMS bridge also drives, and POST /cortex/chat's buildMemoryContext and the pipeline's own read) render
 * rows of every memory store UnifiedMemoryRetrievalService reads. W1F-PERCEPTION-MODULE-SCOPE projected the business-wide
 * event stores by the reader's module levels, and left two leaks:
 *
 *  - SEC-W1FPMS-3: the genome's money memory events (FinanceGenomeService's FINANCE_SNAPSHOT_COMPUTED: the overall risk
 *    and the health score; the cross-domain composite, CROSS_DOMAIN_SNAPSHOT_COMPUTED, which averages the finance health
 *    score; the customer-sales snapshot's revenue quality) reached the KEY prompt of a member without revenue read, a
 *    SUPER_ADMIN who is no member and a contact-only bridge position. The genome's own REST routes withhold exactly these
 *    rows from such a reader (D-128, D-100: isMoneyMemoryEvent), but the fragment the prompt read carried none of the
 *    row's columns, so the prompt could not apply the rule.
 *  - SEC-W1FPMS-4: a GOVERNANCE_DECISION proposal stays business-wide (W1F-PERCEPTION-MODULE-SCOPE's instruction), but its
 *    bridged copies carry the proposal's title, and the Pro Auto monitor writes titles with figures ('$12,345 outstanding
 *    across 7 invoices'). A memberless turn (a contact-only bridge position, a SUPER_ADMIN who is no member) read them,
 *    and a rejection's reason too.
 *
 * GREEN: the genome fragment carries its row's sourceType, eventType, domain and section, and the money ones render only
 * for a reader with revenue read (the owner, a revenue reader, a bridge position whose modules hold revenue); a
 * memberless turn sees a proposal as its action, status and risk level and nothing else. Members still see proposals
 * whole (business-wide).
 *
 * Every write goes through its real route on the real database: POST .../key-genome/finance/snapshot/compute and
 * .../cross-domain/snapshot/compute (the real KeyGenomeController behind AuthGuard, BusinessGuard and ModuleScopeGuard
 * over the real FinanceGenomeService, CustomerSalesGenomeService, GenomeCrossDomainService and GenomeMemoryService), and
 * POST /key-autonomy/businesses/:id/actions/proposals and .../reject (the real KeyActionProposalController,
 * KeyCortexApprovalOrchestratorService, KeyActionProposalService, KeyCortexAuditService and BusinessEventService, whose
 * rows the real EventEmitter2, EventEmitterFlowBridgeService and KeyCortexEventBusService copy to both event stores).
 * A non-money genome record (an operations snapshot) is written through the real GenomeMemoryService as
 * OperationsGenomeService writes it. Every read goes through its real route: AiFlowController behind its real guards,
 * and the WhatsApp Twilio webhook through the real WhatsAppService, StaffChatBridgeService and JobRolePolicyService, over
 * the real FlowOrchestratorService perception block and UnifiedMemoryRetrievalService; POST /cortex/chat's two memory
 * reads run the real KeyCortexPromptContextService.buildMemoryContext and KeyCortexQueryPipelineService.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v71o-user`), the model provider (it records the system prompt it
 * is handed), the other context reads of the prompt, the semantic store (answers nothing), and the genome collaborators
 * off the routes under test. Every case taps fetch and asserts no outbound request.
 *
 * Fixture prefix v71o_ (V1-71, FU-KEY-MEMORY-MONEY-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71o_';
const HEADER = 'x-v71o-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: revenue and expenses 'none' (the genome's finance routes refuse them, D-128). */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue read. */
  revenue: `${P}revenue`,
  /** STAFF on role defaults (revenue read). */
  staff: `${P}staff`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them; no member reader (memberless). */
  admin: `${P}admin`,
  biz: `${P}biz`,
  unit: `${P}unit`,
  /** The blind member's JobRole: their own scope map. */
  roleBlind: `${P}role_blind`,
  /** A JobRole that reads revenue (and crm and operations). */
  roleRevenue: `${P}role_revenue`,
  /** The blind member's position, texted from their own account phone: reader the blind member. */
  posBlind: `${P}pos_blind`,
  /** The revenue member's position, texted from their own account phone: reader the revenue member. */
  posRevenue: `${P}pos_revenue`,
  /** A contact-only position on the revenue JobRole: no holder, so a memberless turn. */
  posContact: `${P}pos_contact`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  // SWP-CENSUS-KEY-B (P109, Ruling B2): proposal write routes require operations:write; keep revenue/expenses none so D-238 redaction stays proven.
  analytics: 'read', operations: 'write', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { crm: 'read', operations: 'read', revenue: 'read', expenses: 'none' };
const PHONE = { blind: '+18685557101', revenue: '+18685557102', contact: '+18685557103' };
const PNID = '990000007101';
const HOST = 'api.v71o.test';
/** The Twilio auth token the webhook verifies under, built at run time (no literal secret in the suite). */
const TWILIO_TOKEN = ['v71o', 'twilio', String(process.pid), String(Date.now())].join('-');
/** A business-wide fact (AiMemory): every reader's prompt carries it (the block renders). */
const FACT = 'V71O-FACT: we open at nine';
const TURN = 'v71o: how are we doing this month?';
/** The title the Pro Auto monitor writes on a revenue proposal (pro-auto-monitor.service.ts checkRevenueTrend). */
const PROPOSAL_TITLE = '$12,345 outstanding across 7 invoices';
const PROPOSAL_FIGURES = ['12,345', 'outstanding across'];
const REJECTION = 'V71O-REASON: $9,876 is due first';
/** FU-PROPOSAL-REVENUE-SIGHT (D-238): a non-financial proposal (a task) and a rejection reason that states no money. */
const NF_PROPOSAL_TITLE = 'V71O-TASK: call the supplier back';
const PLAIN_REJECTION = 'V71O-PLAIN-REASON: after the launch';
/** The genome's money memory events: their titles, as their writers set them. */
const GENOME_MONEY = {
  finance: 'Finance snapshot computed',
  salesSnapshot: 'Customer/sales snapshot computed',
  crossDomain: 'Cross-domain snapshot computed',
};
/** A genome record that carries no money (OperationsGenomeService's snapshot event): business-wide. */
const GENOME_OPS = 'Operations snapshot computed';
const OPS_SUMMARY = 'V71O-OPS: 3 process(es) documented, delivery capacity steady.';

const saved = { token: process.env.TWILIO_AUTH_TOKEN, fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let prisma: any;
let http: any;
let hooks: any;
let genomeMemory: any;
let flow: { prompts: string[]; warnings: string[] };
let promptContextFor: (userId: string | undefined) => Promise<string>;
let pipelinePromptFor: (userId: string | undefined, path: 'processQuery' | 'streamQuery') => Promise<string>;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('business_events'),
    byBiz('cognitive_events'),
    byBiz('cortex_action_logs'),
    byBiz('ai_execution_logs'),
    byBiz('cognition_memories'),
    byBiz('ai_memories'),
    byBiz('genome_memory_events'),
    byBiz('genome_cross_domain_snapshots'),
    byBiz('genome_customer_sales_snapshots'),
    byBiz('genome_finance_snapshots'),
    byBiz('genome_financial_metrics'),
    byBiz('genome_signals'),
    byBiz('genome_recommendations'),
    byBiz('genome_departments'),
    byBiz('key_action_proposals'),
    byBiz('whatsapp_messages'),
    byBiz('whatsapp_contacts'),
    byBiz('webhook_delivery_logs'),
    byBiz('webhook_events'),
    byBiz('team_activity_logs'),
    byBiz('org_assignments'),
    byBiz('job_roles'),
    byBiz('org_units'),
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

/** Removes what one case wrote to the stores the prompts read (the AiMemory fact stays). */
async function clearPerceivedStores() {
  for (const table of [
    'business_events', 'cognitive_events', 'cortex_action_logs', 'ai_execution_logs', 'cognition_memories', 'genome_memory_events',
    'genome_cross_domain_snapshots', 'genome_customer_sales_snapshots', 'genome_finance_snapshots', 'genome_signals',
    'genome_recommendations', 'key_action_proposals',
  ]) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id = $1`, ID.biz);
  }
}

/** The fragment lines of a prompt's "WHAT YOU HAVE OBSERVED" block. */
function observed(prompt: string): string[] {
  const at = prompt.indexOf('WHAT YOU HAVE OBSERVED');
  return at < 0 ? [] : prompt.slice(at).split('\n').filter((l) => l.startsWith('- ['));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/**
 * The lines of a prompt's memory that render a record of `store` titled one of `titles`: the perception block's
 * ('- [genome_memory_event] title: ...'), buildMemoryContext's numbered block ('1. [...] title: ...') and the pipeline's
 * own block ('[...] title: ...', no list mark).
 */
function recordLines(prompt: string, stores: readonly string[], titles: readonly string[]): string[] {
  const store = stores.map(escape).join('|');
  return prompt
    .split('\n')
    .filter((l) => titles.some((t) => new RegExp(`^(- |\\d+\\. )?\\[(${store})\\] ${escape(t)}: `).test(l)));
}
const genomeLines = (prompt: string, titles: readonly string[]) => recordLines(prompt, ['genome_memory_event'], titles);
const proposalLines = (prompt: string) => recordLines(prompt, ['business_event', 'cognitive_event'], ['GOVERNANCE_DECISION']);
/** What a proposal line renders after its title ('GOVERNANCE_DECISION: <this>'). */
const proposalBodies = (prompt: string) => proposalLines(prompt).map((l) => l.slice(l.indexOf('GOVERNANCE_DECISION: ') + 'GOVERNANCE_DECISION: '.length));

/** Waits until the genome holds `count` memory events of each title. */
async function waitForGenome(titles: readonly string[], count = 1) {
  await vi.waitFor(
    async () => {
      for (const title of titles) expect(await db.genomeMemoryEvent.count({ where: { businessId: ID.biz, title } }), title).toBe(count);
    },
    { timeout: 10_000, interval: 100 },
  );
}

/** Waits until the event stores hold the GOVERNANCE_DECISION rows of `ledgerRows` ledger rows (each: itself, its bridged copy, its cognitive copy). */
async function waitForProposalRows(ledgerRows: number) {
  await vi.waitFor(
    async () => {
      expect(await db.businessEvent.count({ where: { businessId: ID.biz, eventType: 'GOVERNANCE_DECISION' } })).toBe(ledgerRows * 2);
      expect(await db.cognitiveEvent.count({ where: { businessId: ID.biz, eventType: 'GOVERNANCE_DECISION' } })).toBe(ledgerRows);
    },
    { timeout: 10_000, interval: 100 },
  );
}

/** One turn of `userId` over POST .../flow/chat or .../flow/chat/stream: the system prompt the model was handed. */
let ip = 0;
async function turn(userId: string, path: 'chat' | 'stream'): Promise<string> {
  flow.prompts.length = 0;
  ip += 1;
  const req = request(http.getHttpServer())
    .post(`/ai/businesses/${ID.biz}/flow/chat${path === 'stream' ? '/stream' : ''}`)
    .set(HEADER, userId)
    .set('x-forwarded-for', `10.71.15.${ip % 250}`)
    .send({ message: TURN });
  if (path === 'chat') {
    const res = await req;
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  } else {
    const res = await req.buffer(true).parse((r: any, cb: any) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => {
        text += c;
      });
      r.on('end', () => cb(null, text));
    });
    const chunks = String(res.body)
      .split('\n')
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice('data: '.length)));
    expect(chunks.filter((c: any) => c.type === 'error'), String(res.body).slice(0, 400)).toEqual([]);
  }
  expect(flow.prompts, `one model call for ${userId} (${path})`).toHaveLength(1);
  return flow.prompts[0];
}

const twilioSignature = (url: string, params: Record<string, string>) =>
  createHmac('sha1', TWILIO_TOKEN)
    .update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url))
    .digest('base64');

/** A staff message texted to KEY over WhatsApp: a Twilio-signed POST to the business's own webhook route. */
let sid = 0;
async function bridgeTurn(phone: string): Promise<string> {
  flow.prompts.length = 0;
  sid += 1;
  const params = { From: `whatsapp:${phone}`, Body: TURN, SmsMessageSid: `SMv71o${process.pid}x${sid}` };
  const urlPath = `/whatsapp/webhook/${ID.biz}`;
  const res = await request(hooks.getHttpServer())
    .post(urlPath)
    .set('host', HOST)
    .set('x-twilio-signature', twilioSignature(`http://${HOST}${urlPath}`, params))
    .type('form')
    .send(params);
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  expect(flow.prompts, `one model call for the staff message from ${phone}`).toHaveLength(1);
  return flow.prompts[0];
}

const agent = () => request(http.getHttpServer());
const genomeRoute = (route: string) => `/business-genome/businesses/${ID.biz}/key-genome/${route}`;
const proposalsRoute = (route = '') => `/key-autonomy/businesses/${ID.biz}/actions/proposals${route}`;

beforeAll(async () => {
  process.env.TWILIO_AUTH_TOKEN = TWILIO_TOKEN;
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v71o: no outbound traffic in this suite');
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
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { StructureService } = await import('../src/modules/structure/structure.service');
  const { StaffChatBridgeService } = await import('../src/modules/structure/staff-chat-bridge.service');
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');
  const { WhatsAppController } = await import('../src/modules/whatsapp/whatsapp.controller');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { CapabilityContractService } = await import('../src/modules/capabilities/capability-contract.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KeyCortexEventBusService } = await import('../src/modules/key-cortex/key-cortex-event-bus.service');
  const { CognitiveEventBusService } = await import('../src/modules/key-cortex/cognitive-event-bus.service');
  const { EventEmitterFlowBridgeService } = await import('../src/modules/key-cortex/event-emitter-flow-bridge.service');
  const { KeyCortexAuditService } = await import('../src/modules/key-cortex/key-cortex-audit.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { KeyActionProposalController } = await import('../src/modules/key-autonomy/key-action-proposal.controller');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyActionPolicyService } = await import('../src/modules/key-autonomy/key-action-policy.service');
  const { KeyActionExecutorService } = await import('../src/modules/key-autonomy/key-action-executor.service');
  const { KeyActionGenomePolicyService } = await import('../src/modules/key-autonomy/key-action-genome-policy.service');
  const { AutonomyOrchestratorService } = await import('../src/modules/key-autonomy/autonomy-orchestrator.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { KeyGenomeController } = await import('../src/modules/business-genome/key-genome/key-genome.controller');
  const { GenomeFinancialMetricService } = await import('../src/modules/business-genome/key-genome/genome-financial-metric.service');
  const { FinanceGenomeService } = await import('../src/modules/business-genome/key-genome/finance-genome.service');
  const { GenomeDepartmentService } = await import('../src/modules/business-genome/key-genome/genome-department.service');
  const { GenomeSignalService } = await import('../src/modules/business-genome/key-genome/genome-signal.service');
  const { GenomeRecommendationService } = await import('../src/modules/business-genome/key-genome/genome-recommendation.service');
  const { GenomeMemoryService } = await import('../src/modules/business-genome/key-genome/genome-memory.service');
  const { GenomeCustomerSegmentService } = await import('../src/modules/business-genome/key-genome/genome-customer-segment.service');
  const { GenomeSalesMotionService } = await import('../src/modules/business-genome/key-genome/genome-sales-motion.service');
  const { CustomerSalesGenomeService } = await import('../src/modules/business-genome/key-genome/customer-sales-genome.service');
  const { GenomeCrossDomainService } = await import('../src/modules/business-genome/key-genome/genome-cross-domain.service');
  // KeyGenomeController's collaborators off the routes under test (each injected by token).
  const genomeStubs = await Promise.all([
    import('../src/modules/business-genome/key-genome/genome-experiment.service').then((x) => x.GenomeExperimentService),
    import('../src/modules/business-genome/key-genome/key-genome-governance.service').then((x) => x.KeyGenomeGovernanceService),
    import('../src/modules/business-genome/key-genome/department-readiness.service').then((x) => x.DepartmentReadinessService),
    import('../src/modules/business-genome/key-genome/genome-operational-process.service').then((x) => x.GenomeOperationalProcessService),
    import('../src/modules/business-genome/key-genome/genome-delivery-capability.service').then((x) => x.GenomeDeliveryCapabilityService),
    import('../src/modules/business-genome/key-genome/operations-genome.service').then((x) => x.OperationsGenomeService),
    import('../src/modules/business-genome/key-genome/genome-growth-channel.service').then((x) => x.GenomeGrowthChannelService),
    import('../src/modules/business-genome/key-genome/genome-content-strategy.service').then((x) => x.GenomeContentStrategyService),
    import('../src/modules/business-genome/key-genome/marketing-genome.service').then((x) => x.MarketingGenomeService),
    import('../src/modules/business-genome/key-genome/genome-recommendation-ranker.service').then((x) => x.GenomeRecommendationRankerService),
    import('../src/modules/business-genome/key-genome/genome-opportunity-detector.service').then((x) => x.GenomeOpportunityDetectorService),
    import('../src/modules/business-genome/key-genome/genome-autonomy-gate.service').then((x) => x.GenomeAutonomyGateService),
    import('../src/modules/business-genome/key-genome/genome-recommendation-outcome.service').then((x) => x.GenomeRecommendationOutcomeService),
  ]);

  prisma = new PrismaService();

  // The app's event path: domain events -> EventEmitterFlowBridgeService -> KEY bus -> business_events + cognitive_events.
  const events = new EventEmitter2();
  const bus = new KeyCortexEventBusService(prisma, new CognitiveEventBusService(prisma));
  new EventEmitterFlowBridgeService(events, bus).onModuleInit();
  const audit = new KeyCortexAuditService(new BusinessEventService(prisma, events));

  // The genome's live services, built as Nest builds them (one each), as key-genome-finance-scope.integration builds them.
  // Nest reads a provider's `then` (a thenable is awaited) and symbol keys: those read as absent.
  const offRoute = (name: string) => new Proxy({}, {
    get: (_t, prop) =>
      prop === 'then' || typeof prop === 'symbol'
        ? undefined
        : () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); },
  });
  const noop = () => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => null) });
  const rejecting = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : async () => { throw new Error(`${name}.${String(prop)} is off the routes under test`); }),
  });
  /** A provider whose named methods are off the routes under test (Nest's lifecycle probes find nothing else on it). */
  const refuse = (name: string, methods: string[]) =>
    Object.fromEntries(methods.map((method) => [method, () => { throw new Error(`${name}.${method} is off the routes under test`); }]));
  const factStandIn = { getFact: async () => null, listFacts: async () => [] };
  const readinessStandIn = { getReadiness: async () => [] };
  const scoringStandIn = {
    computeFactScores: async () => [],
    computeBusinessScore: () => ({ overall: 0, confidence: 0, readiness: 0, sections: [] }),
  };
  genomeMemory = new GenomeMemoryService(prisma);
  const metrics = new GenomeFinancialMetricService(prisma);
  const signals = new GenomeSignalService(
    prisma, offRoute('GenomeFactService') as any, offRoute('GenomeEvidenceService') as any, offRoute('GenomeScoringService') as any,
    offRoute('GenomeModuleReadinessService') as any, offRoute('EventEmitter2') as any, noop() as any,
  );
  const recommendations = new GenomeRecommendationService(
    prisma, signals, readinessStandIn as any, scoringStandIn as any, offRoute('GenomeExperimentService') as any,
    genomeMemory, noop() as any, noop() as any,
  );
  const departments = new GenomeDepartmentService(prisma);
  const finance = new FinanceGenomeService(prisma, metrics, factStandIn as any, signals, recommendations, genomeMemory, noop() as any);
  const segments = new GenomeCustomerSegmentService(prisma);
  const motions = new GenomeSalesMotionService(prisma);
  const customerSales = new CustomerSalesGenomeService(prisma, metrics, segments, motions, signals, recommendations, genomeMemory, noop() as any);
  const crossDomain = new GenomeCrossDomainService(
    prisma, finance, customerSales, rejecting('OperationsGenomeService') as any, rejecting('MarketingGenomeService') as any, genomeMemory, departments,
  );

  // The proposal route's live services; the executor, the genome and autonomy policies and the temporal feed are off
  // the routes under test (create and reject only).
  const proposalProviders = [
    KeyActionProposalService,
    KeyActionPolicyService,
    KeyActionBoundaryService,
    CapabilityContractService,
    { provide: TemporalFlowService, useValue: { emit: async () => ({}) } },
    { provide: KeyActionExecutorService, useValue: refuse('KeyActionExecutorService', ['execute']) },
    { provide: KeyActionGenomePolicyService, useValue: refuse('KeyActionGenomePolicyService', ['evaluateExecution']) },
    { provide: AutonomyOrchestratorService, useValue: refuse('AutonomyOrchestratorService', ['evaluateAction']) },
    {
      provide: KeyCortexApprovalOrchestratorService,
      inject: [KeyActionProposalService],
      useFactory: (proposals: unknown) => new KeyCortexApprovalOrchestratorService(proposals as any, audit),
    },
  ];

  // The flow orchestrator: the real chat(), streamChat() and buildPerceptionSection over the real memory stores.
  const prompts: string[] = [];
  const warnings: string[] = [];
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  type GatewayRequest = { messages: Array<{ role: string; content: unknown }> };
  const record = (req: GatewayRequest) =>
    prompts.push(req.messages.filter((x) => x.role === 'system').map((x) => String(x.content ?? '')).join('\n'));
  const aiUsage = {
    checkRateLimit() {},
    async checkCredits() {
      return { allowed: true };
    },
    async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      record(req);
      return { content: 'v71o: noted.', toolCalls: [], usage };
    },
    async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      record(req);
      yield { type: 'content_delta', content: 'v71o: noted.' };
    },
  };
  const recorder = { emit() { return true; }, async recordEvent() { return undefined; }, async create() { return undefined; } };
  const roleEngine = new RoleEngineService(prisma, {} as any, recorder as any);
  const jobRolePolicy = new JobRolePolicyService();
  const unified = new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any);
  const providers = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!providers.has(token)) throw new Error(`v71o: no provider for ${token?.name ?? String(token)}`);
      return providers.get(token);
    },
  };
  providers.set(KeyActionBoundaryService, new KeyActionBoundaryService(prisma, moduleRef as any));
  providers.set(JobRolePolicyService, jobRolePolicy);
  providers.set(UnifiedMemoryRetrievalService, unified);
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, debug() {}, verbose() {}, error() {}, warn: (x: unknown) => warnings.push(String(x)) },
    prisma,
    moduleRef,
    aiUsage,
    roleEngine,
    governance: new AiOversightService(prisma, {} as any, {} as any, roleEngine, {} as any, jobRolePolicy),
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async () => ({ business: { name: 'V71O Biz' } }),
      buildContextString: () => '',
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    genomeFacts: { listTopFacts: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    getTriage: () => null,
    getConversationHistory: async () => [],
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
  });
  flow = { prompts, warnings };

  // App 1: the flow chat routes, the genome's compute routes and the proposal routes, behind their real guards.
  const testing = await Test.createTestingModule({
    controllers: [AiFlowController, KeyGenomeController, KeyActionProposalController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: EventEmitter2, useValue: events },
      { provide: FlowOrchestratorService, useValue: orchestrator },
      { provide: GenomeMemoryService, useValue: genomeMemory },
      { provide: GenomeFinancialMetricService, useValue: metrics },
      { provide: GenomeSignalService, useValue: signals },
      { provide: GenomeRecommendationService, useValue: recommendations },
      { provide: GenomeDepartmentService, useValue: departments },
      { provide: FinanceGenomeService, useValue: finance },
      { provide: GenomeCustomerSegmentService, useValue: segments },
      { provide: GenomeSalesMotionService, useValue: motions },
      { provide: CustomerSalesGenomeService, useValue: customerSales },
      { provide: GenomeCrossDomainService, useValue: crossDomain },
      ...genomeStubs.map((token) => ({ provide: token, useValue: {} })),
      ...proposalProviders,
    ],
  }).compile();
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

  // App 2: the WhatsApp webhook, the staff bridge in front of the same orchestrator.
  const structure = new StructureService(prisma);
  const oversight = new AiOversightService(prisma, { log: async () => undefined } as any, { recordApprovalSignal: async () => undefined } as any, {} as any, {} as any, jobRolePolicy);
  const bridgeRef = {
    get: (token: unknown) =>
      token === JobRolePolicyService ? jobRolePolicy : token === AiOversightService ? oversight : token === FlowOrchestratorService ? orchestrator : undefined,
  };
  const bridge = new StaffChatBridgeService(structure, prisma, bridgeRef as any);
  const whatsapp = new WhatsAppService(prisma, { emit: () => true } as any, { resolveContact: async () => ({ contactId: null }) } as any, {} as any, bridge);
  const hooksModule = await Test.createTestingModule({
    controllers: [WhatsAppController],
    providers: [
      { provide: WhatsAppService, useValue: whatsapp },
      { provide: PrismaService, useValue: prisma },
      { provide: WebhookIngressLoggerService, useValue: new WebhookIngressLoggerService(prisma) },
      { provide: AuthGuard, useValue: { canActivate: () => false } },
      { provide: BusinessGuard, useValue: { canActivate: () => false } },
    ],
  }).compile();
  hooks = hooksModule.createNestApplication({ rawBody: true });
  configureNestApp(hooks);
  await hooks.init();

  // POST /cortex/chat's two memory reads, over the same stores: buildMemoryContext and the pipeline's own.
  const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
  const { KeyCortexMemoryRetrievalService } = await import('../src/modules/key-cortex/key-cortex-memory-retrieval.service');
  promptContextFor = async (userId) => {
    // Positionally, as Nest constructs it: context service, unified memory, learning service, prisma.
    const promptContext = new (KeyCortexPromptContextService as any)(
      {} as any,
      new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any),
      new KeyCortexLearningService(prisma),
      prisma,
    );
    const session = { id: `${P}sess_mem`, businessId: ID.biz, userId, messages: [] } as any;
    return (await promptContext.buildMemoryContext(ID.biz, session, userId)).aiMemory ?? '';
  };
  pipelinePromptFor = async (userId, path) => {
    const prompts2: string[] = [];
    const session = { id: `${P}sess_pipe`, businessId: ID.biz, userId, status: 'active', persona: 'jarvis', messages: [], detectedRole: null, detectedFunction: null };
    const route = {
      taskCategory: 'general', layers: ['reasoning'], promptVariant: 'standard', includeGenomeContext: false, includeMemoryContext: true,
      includeActions: false, complexity: 'simple', domain: 'general', urgency: 'low', emotionalWeight: 'low', timeHorizon: 'tactical', dataRequirement: 'none',
    };
    const pipeline = new KeyCortexQueryPipelineService(
      {
        complete: async () => ({ content: 'ok', provider: 'openai', model: 'stand-in', usage: { totalTokens: 1, estimatedCost: 0 }, fallbackUsed: false }),
        streamComplete: async function* () {
          yield { content: 'ok', provider: 'openai', model: 'stand-in' };
        },
      } as any,
      prisma,
      { get: async () => null, setex: async () => undefined } as any,
      {
        getPersonalityConfig: () => ({ persona: 'jarvis', temperature: 0.5 }),
        buildSystemPrompt: () => 'You are KEY.',
        buildValueBlock: async () => '',
        classifyPersona: async () => undefined,
        selectTone: async () => ({ tone: '', temperatureAdjustment: 0 }),
      } as any,
      { buildContextSnapshot: async () => ({ businessId: ID.biz, genomeStage: 'startup', executiveReadiness: 50 }), formatContextForPrompt: () => '' } as any,
      { buildToolDefinitions: async () => [], executeActions: async () => [] } as any,
      {
        getOrCreateSession: async () => session,
        generateId: () => `${P}msg`,
        saveMessage: async () => undefined,
        updateSessionCognitionMetadata: async () => undefined,
        updateRunningSummary: async () => undefined,
      } as any,
      {
        buildMemoryContext: async () => ({}),
        buildMessages: (_q: unknown, _c: unknown, systemPrompt: string) => {
          prompts2.push(systemPrompt);
          return [];
        },
      } as any,
      { handleToolCalls: async () => null } as any,
      { detectActions: () => [] } as any,
      { generateSuggestions: async () => [] } as any,
      {} as any,
      { buildV2SystemPrompt: () => 'V2', buildV3SystemPrompt: () => 'V3', enrichSnapshotFromV2: () => undefined, enrichSnapshotFromGenome: () => undefined } as any,
      {
        classifyTaskCategory: () => 'general',
        buildStructuredOutputInstructions: () => '',
        parseStructuredResponse: () => ({ role: 'assistant', recommendation: 'ok', confidence: 80 }),
      } as any,
      { detectMood: () => 'casual' } as any,
      new KeyCortexMemoryRetrievalService(new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any)),
      { route: async () => route } as any,
    );
    const query = { text: 'what happened lately', businessId: ID.biz, userId } as any;
    const flags = { integrationV2Enabled: false, genomeV3Enabled: false };
    if (path === 'processQuery') await pipeline.processQuery(query, flags);
    else for await (const chunk of pipeline.streamQuery(query, flags)) void chunk;
    expect(prompts2, path).toHaveLength(1);
    return prompts2[0];
  };

  await cleanup();
  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.blind, 'USER'],
    [ID.revenue, 'USER'],
    [ID.staff, 'USER'],
    [ID.admin, 'SUPER_ADMIN'],
  ] as const) {
    const phone = id === ID.blind ? PHONE.blind : id === ID.revenue ? PHONE.revenue : undefined;
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role, ...(phone ? { phone } : {}) } });
  }
  await db.business.create({
    data: { id: ID.biz, name: 'V71O Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', metaData: { whatsapp: { provider: 'mock', phoneNumberId: PNID } } },
  });
  for (const [userId, role, extra] of [
    [ID.owner, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.staff, 'STAFF', { maxApprovalTier: 0 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId: ID.biz, role, ...extra } });
  }
  await db.orgUnit.create({ data: { id: ID.unit, businessId: ID.biz, name: 'V71O HQ' } });
  await db.jobRole.create({ data: { id: ID.roleBlind, businessId: ID.biz, name: 'V71O Blind', permissions: BLIND_SCOPES, defaultApprovalTier: 0 } });
  await db.jobRole.create({ data: { id: ID.roleRevenue, businessId: ID.biz, name: 'V71O Revenue', permissions: REVENUE_SCOPES, defaultApprovalTier: 0 } });
  await db.orgAssignment.create({
    data: { id: ID.posBlind, businessId: ID.biz, orgUnitId: ID.unit, jobRoleId: ID.roleBlind, contactPhone: PHONE.blind, membershipId: m(ID.blind), userId: ID.blind, isContactOnly: false },
  });
  await db.orgAssignment.create({
    data: { id: ID.posRevenue, businessId: ID.biz, orgUnitId: ID.unit, jobRoleId: ID.roleRevenue, contactPhone: PHONE.revenue, membershipId: m(ID.revenue), userId: ID.revenue, isContactOnly: false },
  });
  await db.orgAssignment.create({
    data: { id: ID.posContact, businessId: ID.biz, orgUnitId: ID.unit, jobRoleId: ID.roleRevenue, contactPhone: PHONE.contact, isContactOnly: true, contactName: 'V71O contractor' },
  });
  // The finance genome's inputs (the figures its snapshot is computed from).
  const occurredAt = new Date(Date.now() - 86400_000);
  for (const [metricType, value] of [['REVENUE', 4321.5], ['CASH_ON_HAND', 987.65], ['MONTHLY_EXPENSES', 1200]] as const) {
    await db.genomeFinancialMetric.create({
      data: { id: `${P}metric_${metricType}`, businessId: ID.biz, metricType, period: '2026-10', value, currency: 'TTD', confidence: 0.9, occurredAt },
    });
  }
  await db.aiMemory.create({ data: { businessId: ID.biz, category: 'fact', key: `${P}fact`, value: FACT } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = saved.token;
  if (http) await http.close();
  if (hooks) await hooks.close();
  if (db) await cleanup();
});

type Reader = 'owner' | 'blind' | 'revenue' | 'staff' | 'admin';
const READERS: Reader[] = ['owner', 'blind', 'revenue', 'staff', 'admin'];
/** Whether each reader may read revenue in the business (a SUPER_ADMIN who is no member: no member, no module). */
const READS_REVENUE: Record<Reader, boolean> = { owner: true, blind: false, revenue: true, staff: true, admin: false };
const PATHS = ['chat', 'stream'] as const;

/** The genome's money memory event, through its real routes, and the non-money control through the real genome memory writer. */
async function writeGenome(kind: 'finance' | 'crossDomain'): Promise<string[]> {
  const route = kind === 'finance' ? 'finance/snapshot/compute' : 'cross-domain/snapshot/compute';
  const res = await agent().post(genomeRoute(route)).set(HEADER, ID.owner).send({});
  expect(res.status, `${route}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(201);
  const titles = kind === 'finance' ? [GENOME_MONEY.finance] : [GENOME_MONEY.finance, GENOME_MONEY.salesSnapshot, GENOME_MONEY.crossDomain];
  await genomeMemory.createMemoryEvent({
    businessId: ID.biz,
    sourceType: 'OPERATIONS_GENOME',
    eventType: 'OPERATIONS_SNAPSHOT_COMPUTED',
    domain: 'OPERATIONS',
    section: 'OPERATIONS',
    title: GENOME_OPS,
    summary: OPS_SUMMARY,
    outcome: 'SUCCESS',
    impactScore: 0.6,
    confidenceDelta: 0,
    metadata: { overallRiskLevel: 'LOW' },
    occurredAt: new Date().toISOString(),
  });
  await waitForGenome([...titles, GENOME_OPS]);
  return titles;
}

describe('FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-3; D-128, D-100): the genome\'s money memory events reach only the KEY prompts of members who may read revenue', () => {
  it('premise: the genome\'s own routes refuse the blind member its finance snapshot (D-128), and serve the owner and the revenue reader', async () => {
    for (const [who, status] of [[ID.blind, 403], [ID.revenue, 200], [ID.staff, 200], [ID.owner, 200]] as const) {
      const res = await agent().get(genomeRoute('finance/snapshot')).set(HEADER, who);
      expect(res.status, `${who}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(status);
    }
  });

  for (const kind of ['finance', 'crossDomain'] as const) {
    it(`${kind === 'finance' ? 'POST .../finance/snapshot/compute (FINANCE_SNAPSHOT_COMPUTED: the overall risk and the health score)' : 'POST .../cross-domain/snapshot/compute (FINANCE_SNAPSHOT_COMPUTED, CUSTOMER_SALES_SNAPSHOT_COMPUTED, CROSS_DOMAIN_SNAPSHOT_COMPUTED)'}: over POST .../flow/chat and its stream the money memory renders only for a member who may read revenue (the owner, the revenue reader, the role-default STAFF member); never for the blind STAFF member, nor a SUPER_ADMIN who is no member; a genome record that carries no money still renders for every reader (control)`, async () => {
      await clearPerceivedStores();
      const titles = await writeGenome(kind);
      try {
        for (const path of PATHS) {
          for (const reader of READERS) {
            const prompt = await turn(ID[reader], path);
            const label = `${reader} (${path}): ${observed(prompt).join(' | ')}`;
            for (const title of titles) {
              if (READS_REVENUE[reader]) expect(genomeLines(prompt, [title]).length, `${label}: ${title}`).toBe(1);
              else expect(genomeLines(prompt, [title]), `${label}: ${title}`).toEqual([]);
            }
            if (!READS_REVENUE[reader]) {
              for (const marker of ['health score', 'revenue quality']) expect(prompt, `${label}: ${marker}`).not.toContain(marker);
            }
            // Control: the genome's records that carry no money stay business-wide.
            expect(genomeLines(prompt, [GENOME_OPS]).length, `${label}: ${GENOME_OPS}`).toBe(1);
            expect(prompt, label).toContain(FACT);
          }
        }
        expect(flow.warnings.filter((w) => w.includes('perception'))).toEqual([]);
        expect(outbound, 'no outbound request').toEqual([]);
      } finally {
        await clearPerceivedStores();
      }
    }, 120_000);
  }

  it("POST /cortex/chat's memory reads (buildMemoryContext, processQuery, streamQuery) follow the same rule: the blind STAFF member and a SUPER_ADMIN who is no member get no FINANCE_SNAPSHOT_COMPUTED memory; the revenue reader and the owner do", async () => {
    await clearPerceivedStores();
    await writeGenome('finance');
    try {
      for (const reader of READERS) {
        const reads = [
          ['buildMemoryContext', await promptContextFor(ID[reader])],
          ['processQuery', await pipelinePromptFor(ID[reader], 'processQuery')],
          ['streamQuery', await pipelinePromptFor(ID[reader], 'streamQuery')],
        ] as const;
        for (const [label, block] of reads) {
          const lines = genomeLines(block, [GENOME_MONEY.finance]);
          if (READS_REVENUE[reader]) expect(lines.length, `${reader} ${label}`).toBe(1);
          else {
            expect(lines, `${reader} ${label}`).toEqual([]);
            expect(block, `${reader} ${label}`).not.toContain('health score');
          }
          expect(genomeLines(block, [GENOME_OPS]).length, `${reader} ${label}: ${GENOME_OPS}`).toBe(1);
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);

  it("the staff WhatsApp bridge: the blind member's position (their own phone) and a contact-only position on a JobRole that reads revenue (a memberless turn: no money, D-73/D-93) get no FINANCE_SNAPSHOT_COMPUTED memory; the revenue member's position on their own phone does (control)", async () => {
    await clearPerceivedStores();
    await writeGenome('finance');
    try {
      for (const [label, phone, visible] of [
        ['blind holder', PHONE.blind, false],
        ['contact-only', PHONE.contact, false],
        ['revenue holder', PHONE.revenue, true],
      ] as const) {
        const texted = await bridgeTurn(phone);
        const seen = `${label}: ${observed(texted).join(' | ')}`;
        if (visible) expect(genomeLines(texted, [GENOME_MONEY.finance]).length, seen).toBe(1);
        else {
          expect(genomeLines(texted, [GENOME_MONEY.finance]), seen).toEqual([]);
          expect(texted, seen).not.toContain('health score');
        }
        expect(genomeLines(texted, [GENOME_OPS]).length, `${seen}: ${GENOME_OPS}`).toBe(1);
        expect(texted, seen).toContain(FACT);
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);
});

describe("FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-4; D-73/D-93): a memberless turn sees a proposal's action, status and risk level, never its title or figures; members still see proposals whole", () => {
  /** The owner proposes, as the Pro Auto monitor does, over POST .../actions/proposals: the real orchestrator writes the ledger row. */
  // FU-PROPOSAL-REVENUE-SIGHT (D-238): D-226's view is pinned on a non-financial proposal (a task); the Pro Auto monitor's
  // money proposal is withheld from readers without revenue read (the D-238 cases at the end).
  async function propose(title = NF_PROPOSAL_TITLE, summary = 'Call the supplier about the delivery slot.', ledgerRows = 1): Promise<string> {
    const res = await agent().post(proposalsRoute()).set(HEADER, ID.owner).send({
      sourceType: 'KEY_CORTEX',
      actionType: 'REQUEST_APPROVAL',
      title,
      summary,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({ title, status: 'PENDING', riskLevel: 'LOW' });
    await waitForProposalRows(ledgerRows);
    // Premise: the bridged copies carry the proposal's title (the bus copies the whole ledger input).
    const cognitive = await db.cognitiveEvent.findMany({ where: { businessId: ID.biz, eventType: 'GOVERNANCE_DECISION' } });
    expect(JSON.stringify(cognitive.map((c: any) => c.payload))).toContain(title);
    return res.body.id as string;
  }

  it("a SUPER_ADMIN who is no member, over POST .../flow/chat and its stream and POST /cortex/chat's memory reads, sees the proposal as 'proposal propose, status PENDING, risk LOW' (all three records) and never its title; the members (the owner, the blind STAFF member, the revenue reader, the role-default STAFF member) still see it whole (control)", async () => {
    await clearPerceivedStores();
    await propose();
    try {
      for (const path of PATHS) {
        for (const reader of READERS) {
          const prompt = await turn(ID[reader], path);
          const label = `${reader} (${path}): ${observed(prompt).join(' | ')}`;
          expect(proposalLines(prompt).length, label).toBe(3);
          if (reader === 'admin') {
            expect(proposalBodies(prompt), label).toEqual(Array(3).fill('proposal propose, status PENDING, risk LOW'));
            expect(prompt, `${label}: title`).not.toContain(NF_PROPOSAL_TITLE);
          } else {
            expect(prompt, label).toContain(NF_PROPOSAL_TITLE);
          }
          expect(prompt, label).toContain(FACT);
        }
      }
      for (const [label, block] of [
        ['buildMemoryContext', await promptContextFor(ID.admin)],
        ['processQuery', await pipelinePromptFor(ID.admin, 'processQuery')],
        ['streamQuery', await pipelinePromptFor(ID.admin, 'streamQuery')],
      ] as const) {
        // A turn with no member reader reads no business_events row here (includeEpisodic false): the cognitive copy.
        expect(proposalBodies(block), label).toEqual(['proposal propose, status PENDING, risk LOW']);
        expect(block, `${label}: title`).not.toContain(NF_PROPOSAL_TITLE);
      }
      // Control: the owner's own cortex chat memory carries the title.
      expect(await promptContextFor(ID.owner)).toContain(NF_PROPOSAL_TITLE);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);

  it("a contact-only position texting KEY (the real Twilio webhook and staff bridge; no holder, so a memberless turn) sees the proposal's action, status and risk level only; the blind member texting from their own phone (a member reader) still sees its title (control)", async () => {
    await clearPerceivedStores();
    await propose();
    try {
      const contact = await bridgeTurn(PHONE.contact);
      const seen = observed(contact).join(' | ');
      expect(proposalBodies(contact), seen).toEqual(Array(3).fill('proposal propose, status PENDING, risk LOW'));
      expect(contact, `${seen}: title`).not.toContain(NF_PROPOSAL_TITLE);
      expect(contact).toContain(FACT);

      const holder = await bridgeTurn(PHONE.blind);
      expect(proposalLines(holder).length, observed(holder).join(' | ')).toBe(3);
      expect(holder).toContain(NF_PROPOSAL_TITLE);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);

  it("a rejection (POST .../proposals/:id/reject with a reason that carries a figure) reaches a memberless turn as 'proposal reject, status REJECTED': no reason, no rejecter, no title; the owner sees the reason (control)", async () => {
    await clearPerceivedStores();
    const proposalId = await propose();
    const res = await agent().post(proposalsRoute(`/${proposalId}/reject`)).set(HEADER, ID.owner).send({ reason: PLAIN_REJECTION });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    await waitForProposalRows(2);
    try {
      // The perception block's window is six lines (the fact and five of the six proposal records); buildMemoryContext
      // reads no business_events row for a turn with no member reader, so it holds the two cognitive copies.
      const allowed = ['proposal reject, status REJECTED', 'proposal propose, status PENDING, risk LOW'];
      for (const [label, prompt, count, rejects] of [
        ['contact-only bridge', await bridgeTurn(PHONE.contact), 5, 2],
        ['SUPER_ADMIN flow chat', await turn(ID.admin, 'chat'), 5, 2],
        ['SUPER_ADMIN buildMemoryContext', await promptContextFor(ID.admin), 2, 1],
      ] as const) {
        const seen = `${label}: ${prompt.split('\n').filter((l) => l.includes('GOVERNANCE_DECISION')).join(' | ')}`;
        const bodies = proposalBodies(prompt);
        expect(bodies.length, seen).toBe(count);
        expect(bodies.filter((b) => !allowed.includes(b)), seen).toEqual([]);
        expect(bodies.filter((b) => b === allowed[0]).length, seen).toBeGreaterThanOrEqual(rejects);
        for (const marker of [NF_PROPOSAL_TITLE, 'V71O-PLAIN-REASON', ID.owner]) expect(prompt, `${seen}: ${marker}`).not.toContain(marker);
      }
      const owner = await turn(ID.owner, 'chat');
      expect(owner).toContain('V71O-PLAIN-REASON');
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);
  it("RED-BEFORE (D-238): the Pro Auto monitor's money proposal reaches no reader without revenue read: no record of it for a SUPER_ADMIN who is no member, a contact-only position or the blind member, not even its status or risk level; the owner, the revenue reader and the role-default STAFF member see it whole", async () => {
    await clearPerceivedStores();
    await propose(PROPOSAL_TITLE, 'Outstanding invoices exceed 1.5x your monthly revenue.');
    try {
      for (const reader of READERS) {
        const prompt = await turn(ID[reader], 'chat');
        const label = `${reader}: ${observed(prompt).join(' | ')}`;
        if (READS_REVENUE[reader]) {
          expect(prompt, label).toContain(PROPOSAL_TITLE);
        } else {
          expect(proposalLines(prompt), label).toEqual([]);
          for (const figure of PROPOSAL_FIGURES) expect(prompt, `${label}: ${figure}`).not.toContain(figure);
        }
        expect(prompt, label).toContain(FACT);
      }
      const contact = await bridgeTurn(PHONE.contact);
      expect(proposalLines(contact), observed(contact).join(' | ')).toEqual([]);
      for (const [label, block] of [
        ['buildMemoryContext', await promptContextFor(ID.admin)],
        ['processQuery', await pipelinePromptFor(ID.admin, 'processQuery')],
        ['streamQuery', await pipelinePromptFor(ID.admin, 'streamQuery')],
      ] as const) {
        expect(proposalBodies(block), label).toEqual([]);
      }
      expect(await promptContextFor(ID.owner)).toContain(PROPOSAL_TITLE);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);

  it("RED-BEFORE (D-238; security review BLOCKING-1): the KEY proposal REST API serves the blind member (revenue none) the task proposal and not the money one: GET proposals leaves it out and GET proposals/:id answers 404; approve, reject, cancel and execute stay governed by the approval authority and answer a view with no title, summary or figure; the owner and the revenue reader see both", async () => {
    await clearPerceivedStores();
    const money = await propose(PROPOSAL_TITLE, 'Outstanding invoices exceed 1.5x your monthly revenue.');
    const task = await propose(undefined, undefined, 2);
    try {
      const list = await agent().get(proposalsRoute()).set(HEADER, ID.blind);
      expect(list.status, JSON.stringify(list.body).slice(0, 300)).toBe(200);
      const ids = (list.body as any[]).map((p) => p.id);
      expect(ids).toContain(task);
      expect(ids).not.toContain(money);
      expect(JSON.stringify(list.body)).not.toContain('12,345');
      const one = await agent().get(proposalsRoute(`/${money}`)).set(HEADER, ID.blind);
      expect(one.status, JSON.stringify(one.body).slice(0, 300)).toBe(404);
      expect(JSON.stringify(one.body)).not.toContain('12,345');
      expect((await agent().get(proposalsRoute(`/${task}`)).set(HEADER, ID.blind)).status).toBe(200);
      // D-238 "withhold or safely redact": reading is withheld; acting stays governed by the approval authority
      // (tiers, D-140, D-119), and the answer is the redacted view (id, status, a money-free failure reason).
      // Round 4 (correctness minor 1): each action on its own fresh money proposal, so each can answer its success.
      // A success answers exactly the redacted keys and changed the row; a refusal is the authority's own (403/400),
      // never a 404 (the proposal is not hidden from the action) and never a 5xx.
      // Proposed before any action (an action writes its own governance rows, which the helper's count would see).
      const targets: Record<string, string> = {};
      for (const [i, action] of (['approve', 'reject', 'cancel'] as const).entries()) {
        targets[action] = await propose(PROPOSAL_TITLE, 'Outstanding invoices exceed 1.5x your monthly revenue.', 3 + i);
      }
      let succeeded = 0;
      for (const action of ['approve', 'reject', 'cancel'] as const) {
        const target = targets[action];
        const res = await agent().post(proposalsRoute(`/${target}/${action}`)).set(HEADER, ID.blind).send(action === 'reject' ? { reason: 'no' } : {});
        const body = JSON.stringify(res.body);
        for (const marker of ['12,345', 'outstanding across', 'monthly revenue']) expect(body, `${action} (${res.status}): ${marker}`).not.toContain(marker);
        expect([200, 201, 400, 403], `${action}: ${body.slice(0, 200)}`).toContain(res.status);
        if (res.status < 300) {
          for (const key of Object.keys(res.body)) expect(['id', 'status', 'failureReason'], `${action} answers ${key}`).toContain(key);
          expect(res.body.id).toBe(target);
          const row = await db.keyActionProposal.findUnique({ where: { id: target }, select: { status: true } });
          expect(row?.status, action).toBe({ approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }[action]);
          succeeded += 1;
        }
      }
      // Round 5 (correctness minor 3): the redacted answer is proven on at least one success, not skipped by refusals.
      expect(succeeded, 'at least one action the blind member may take succeeds').toBeGreaterThan(0);
      {
        // Execute on the approved target (when the approve succeeded), so a success can answer.
        const res = await agent().post(proposalsRoute(`/${targets.approve}/execute`)).set(HEADER, ID.blind).send({});
        const body = JSON.stringify(res.body);
        for (const marker of ['12,345', 'outstanding across', 'monthly revenue']) expect(body, `execute (${res.status}): ${marker}`).not.toContain(marker);
        // The executor's own answer (its refusal, or its result) comes back; the hiding 404 does not (round 6: a success
        // answers only the redacted keys, as approve, reject and cancel do).
        expect((res.body as { message?: string }).message, body.slice(0, 200)).not.toBe('Action proposal not found');
        expect(res.status, body.slice(0, 200)).toBeLessThan(500);
        if (res.status < 300) for (const key of Object.keys(res.body)) expect(['id', 'status', 'failureReason'], `execute answers ${key}`).toContain(key);
      }
      for (const reader of [ID.owner, ID.revenue]) {
        const seen = ((await agent().get(proposalsRoute()).set(HEADER, reader)).body as any[]).map((p) => p.id);
        expect(seen, reader).toEqual(expect.arrayContaining([money, task]));
        expect((await agent().get(proposalsRoute(`/${money}`)).set(HEADER, reader)).status, reader).toBe(200);
      }
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);

  it("RED-BEFORE (D-238, directly or indirectly): a non-financial proposal rejected with a reason that states money: the rejection's records reach no reader without revenue read; its propose records keep D-226; the owner sees the reason", async () => {
    await clearPerceivedStores();
    const proposalId = await propose();
    const res = await agent().post(proposalsRoute(`/${proposalId}/reject`)).set(HEADER, ID.owner).send({ reason: REJECTION });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    await waitForProposalRows(2);
    try {
      for (const [label, prompt] of [
        ['contact-only bridge', await bridgeTurn(PHONE.contact)],
        ['SUPER_ADMIN flow chat', await turn(ID.admin, 'chat')],
        ['blind member flow chat', await turn(ID.blind, 'chat')],
      ] as const) {
        const seen = `${label}: ${prompt.split('\n').filter((l) => l.includes('GOVERNANCE_DECISION')).join(' | ')}`;
        expect(proposalBodies(prompt).filter((b) => b.startsWith('proposal reject')), seen).toEqual([]);
        expect(prompt, seen).not.toMatch(/reject/i);
        for (const marker of ['9,876', 'V71O-REASON']) expect(prompt, `${seen}: ${marker}`).not.toContain(marker);
      }
      expect(await turn(ID.owner, 'chat')).toContain('V71O-REASON');
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);
});
