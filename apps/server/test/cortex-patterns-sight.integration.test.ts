/**
 * FU-CORTEX-PATTERNS-SIGHT (P0; owner rulings D-257 (KEY's memory design, its scope fixes), D-100 (a member without
 * revenue read sees no money signal at all), D-234 (authorization follows the data's meaning; ambiguity fails closed)).
 *
 * Found by the wave 3i assembly review, after MEM-PATTERNS-SIGHT closed the flow chat: KEY's cortex chat (POST
 * /cortex/chat and its stream) still renders AiMemory 'patterns' rows into a reader's prompt whatever the reader may read.
 * PatternDetectorService.scanBusiness stores a repeat late payer as "N overdue invoices totaling X" ("Overdue: <total>").
 * KeyCortexPromptContextService.buildMemoryContext and the pipeline's chatMemoryFragments read the structured stores with
 * no aiMemoryPatterns option, and readersOwnPromptMemory names no module for an ai_memory fragment, so the row reached a
 * STAFF member whose revenue scope is none, and a platform SUPER_ADMIN who is no member. The same rows reach the intent
 * parser's prompt (POST .../ai/intent, .../ai/plan, POST /actions/.../plan: IntentParserService.parse called
 * buildContextBlock with no patternVisible) and the planner's (PlannerService.createPlan rendered every pattern).
 *
 * GREEN: the flow chat's rule (MEM-PATTERNS-SIGHT), on every one of these prompts.
 * - The cortex reads take the behavioural patterns only for a reader who may read every pattern (readsEveryPattern: a
 *   member reader with revenue and expenses read), unread otherwise, as the flow chat's perception block reads them.
 * - The intent parser and the planner keep each pattern by aiMemoryRowVisibleTo for the requesting member
 *   (buildContextBlock's patternVisible). A plan with no member (an agent trigger a member did not write) keeps none.
 * - The owner's prompts, and a revenue-and-expenses reader's, are byte-identical to the unscoped read's.
 *
 * Every pattern is written by its real writer on the real database: PatternDetectorService.scanBusiness over real
 * invoices; AiMemoryService.upsert in the forms summarizePatterns and the delegation loop write.
 * Every cortex read goes through the real KeyCortexQueryPipelineService (processQuery and streamQuery, the two calls POST
 * /cortex/chat and its stream make) with the real KeyCortexPromptContextService (buildMemoryContext and buildMessages)
 * and UnifiedMemoryRetrievalService. The intent parser and the planner are read over HTTP: the real AiController and
 * GraphActionsController behind their real guards, over the real IntentParserService, PlannerService and AiMemoryService.
 *
 * Stand-ins:
 * - identity attachment (a middleware reads `x-v78c-user`);
 * - the model provider (it records the system prompt);
 * - the semantic store (it answers nothing: MEM-UNIFIED-SEMANTIC-SIGHT covers the copies);
 * - the business graph (no figure).
 * globalThis.fetch is a tap that refuses and records every outbound request: none is made.
 *
 * Fixture prefix v78c_ (FU-CORTEX-PATTERNS-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v78c_';
const HEADER = 'x-v78c-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: crm and operations read, revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue and expenses read. */
  revenue: `${P}revenue`,
  /** STAFF, explicit scope map: revenue read, expenses 'none'. */
  revnoexp: `${P}revnoexp`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them; no member reader (memberless). */
  root: `${P}root`,
  biz: `${P}biz`,
  /** Another tenant, with its own owner and its own money pattern. */
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

type Reader = 'owner' | 'blind' | 'revenue' | 'revnoexp' | 'root' | 'other';
type Surface = 'chat' | 'stream' | 'intent' | 'plan' | 'actionsPlan';

/** The two overdue invoices of one payer: 4000 + 3341 = 7341, the total PatternDetectorService states. */
const TOTAL = '7341';
const OTHER_TOTAL = '9157';
/** The non-money patterns: summarizePatterns' peak hour, and an operations note. */
const PEAK = 'Peak activity hour: 9AM';
const OPS = 'Most active day: Tuesday';
/** An expense-stating pattern (no money figure): needs expenses read. */
const EXPENSE = 'Rent and supplier bills cluster at the start of each month';
/** A business-wide fact every member reads (the control that the memory block is live). */
const FACT = 'V78C-FACT we open at nine';
const QUERY = 'V78C how is the business doing';

const MONEY_MARKERS = [`totaling ${TOTAL}`, 'Overdue: 4000', 'Revenue dropped', `revenue (${TOTAL})`, 'overdue_invoice_cluster', 'revenue_drop'];
const promptStatesMoney = (prompt: string) => MONEY_MARKERS.filter((marker) => prompt.includes(marker));
/** A prompt with its clock readings masked (two turns taken moments apart are compared). */
const masked = (prompt: string) =>
  prompt
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g, '<clock>')
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? [A-Z][a-z]+ \d{1,2},? \d{4}\b/g, '<date>');

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let prisma: any;
let http: any;
let memory: any;
let detector: any;
let unified: any;
let planner: any;
let cortexPromptFor: (userId: string, stream: boolean, businessId?: string) => Promise<string>;
/** Each model call's system prompt, by the task that made it. */
const calls: Array<{ task: string; prompt: string }> = [];
/**
 * The unscoped read, for the owner-parity checks: the cortex reads ignore aiMemoryPatterns and buildContextBlock ignores
 * patternVisible, exactly as the reads were before this packet.
 */
const legacy = { on: false };

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM ai_plan_steps WHERE plan_id IN (SELECT id FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('ai_plans'),
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('invoices'),
    byBiz('contacts'),
    byBiz('ai_execution_logs'),
    byBiz('cortex_action_logs'),
    byBiz('cognition_memories'),
    byBiz('cortex_events'),
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

async function clearPatterns() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'invoices']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
/** Two overdue invoices of `contactId` (due three days ago) totalling `a + b`. */
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

/** The money pattern, by its real writer: PatternDetectorService.scanBusiness over two overdue invoices of one payer. */
async function seedMoneyPattern(businessId = ID.biz, payer = ID.payer, a = 4000, b = 3341, total = TOTAL) {
  await overdueInvoices(businessId, payer, a, b);
  const scan = await detector.scanBusiness(businessId);
  const overdue = scan.patterns.filter((p: any) => p.category === 'overdue_invoice_cluster');
  expect(overdue, 'premise: the detector found the repeat late payer').toHaveLength(1);
  expect(overdue[0].description, 'premise: the pattern states the total').toContain(`totaling ${total}`);
  const rows = await db.aiMemory.findMany({ where: { businessId, category: 'patterns', key: { startsWith: 'pattern_overdue_invoice_cluster' } } });
  expect(rows, 'premise: the detector stored the pattern').toHaveLength(1);
}

/** `n` more money patterns (the delegation loop's and detector's forms), so the differential has N > 1. */
async function seedMoreMoneyPatterns(n: number) {
  for (let i = 0; i < n; i++) {
    await memory.upsert(ID.biz, {
      category: 'patterns',
      key: `pattern_revenue_drop_${P}${i}`,
      value: JSON.stringify({ category: 'revenue_drop', title: `Revenue dropped ${10 + i}% vs last week`, description: `This week's revenue (${TOTAL}) is lower` }),
      confidence: 0.9,
      source: 'pattern_analysis',
    });
  }
}

/** The non-money patterns, in summarizePatterns' form, and the business-wide fact. */
async function seedPlain() {
  for (const value of [PEAK, OPS]) {
    await memory.upsert(ID.biz, { category: 'patterns', key: value.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_'), value, confidence: 0.8, source: 'pattern_analysis' });
  }
  await memory.upsert(ID.biz, { category: 'fact', key: `${P}fact`, value: FACT, source: 'user' });
}

async function seedExpensePattern() {
  await memory.upsert(ID.biz, { category: 'patterns', key: 'expense_cycle', value: EXPENSE, confidence: 0.8, source: 'pattern_analysis' });
}

const agent = () => request(http.getHttpServer());
let ip = 0;
const nextIp = () => `10.78.3.${(ip += 1) % 250}`;

function onlyCall(task: string, label: string): string {
  const mine = calls.filter((c) => c.task === task);
  expect(mine, `one ${task} model call for ${label}`).toHaveLength(1);
  return mine[0].prompt;
}

/** POST .../ai/intent: the intent parser's prompt for `reader`. */
async function intentPromptFor(reader: Reader, businessId = ID.biz): Promise<string> {
  calls.length = 0;
  const res = await agent().post(`/ai/businesses/${businessId}/ai/intent`).set(HEADER, ID[reader]).set('x-forwarded-for', nextIp()).send({ input: QUERY });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return onlyCall('intent_parse', `${reader} intent`);
}

/** POST .../ai/plan (or POST /actions/.../plan): the planner's prompt for `reader` (the intent parser runs first). */
async function planPromptFor(reader: Reader, route: 'ai' | 'actions' = 'ai', businessId = ID.biz): Promise<{ intent: string; plan: string }> {
  calls.length = 0;
  const url = route === 'ai' ? `/ai/businesses/${businessId}/ai/plan` : `/actions/businesses/${businessId}/plan`;
  const res = await agent().post(url).set(HEADER, ID[reader]).set('x-forwarded-for', nextIp()).send({ input: QUERY });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  expect(res.body.plan, 'premise: a plan was made').toBeTruthy();
  return { intent: onlyCall('intent_parse', `${reader} ${route} plan`), plan: onlyCall('plan_decompose', `${reader} ${route} plan`) };
}

/** Every prompt `reader` is handed: the cortex chat and stream, the intent parser, both plan routes' planner. */
async function everyPromptFor(reader: Reader): Promise<Record<Surface, string>> {
  return {
    chat: await cortexPromptFor(ID[reader], false),
    stream: await cortexPromptFor(ID[reader], true),
    intent: await intentPromptFor(reader),
    plan: (await planPromptFor(reader, 'ai')).plan,
    actionsPlan: (await planPromptFor(reader, 'actions')).plan,
  };
}

/** The planner's prompt for a plan with no member: an agent trigger no member wrote (AgentTriggerService.createPlan). */
async function memberlessPlanPrompt(): Promise<string> {
  calls.length = 0;
  const intent = { objective: QUERY, rawInput: QUERY, urgency: 'normal', scope: [], modules: ['crm'], missingInfo: [], actionCandidates: [], clarificationNeeded: false };
  await planner.createPlan(ID.biz, intent, undefined);
  return onlyCall('plan_decompose', 'memberless plan');
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v78c: no outbound traffic in this suite');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { IntentParserService } = await import('../src/modules/ai/intent-parser.service');
  const { PlannerService } = await import('../src/modules/ai/planner.service');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { PatternDetectorService } = await import('../src/modules/ai/pattern-detector.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
  const { KeyCortexMemoryRetrievalService } = await import('../src/modules/key-cortex/key-cortex-memory-retrieval.service');

  prisma = new PrismaService();
  memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any);
  // The model gateway and usage are never reached: detectAiPatterns needs two tickets or bookings, and none exist.
  detector = new PatternDetectorService(prisma, new EventEmitter2(), {} as any, memory, {} as any);
  unified = new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any);

  // The legacy switch (owner parity): the reads as they were before this packet.
  const liveRetrieve = unified.retrieveContext.bind(unified);
  unified.retrieveContext = (businessId: string, options: any) =>
    liveRetrieve(businessId, legacy.on ? { ...options, aiMemoryPatterns: undefined } : options);
  const liveBlock = memory.buildContextBlock.bind(memory);
  memory.buildContextBlock = (businessId: string, opts?: unknown) => (legacy.on ? liveBlock(businessId) : liveBlock(businessId, opts));

  type Message = { role: string; content: unknown };
  const systemOf = (messages: Message[]) => messages.filter((x) => x.role === 'system').map((x) => String(x.content ?? '')).join('\n');

  // The intent parser's and the planner's model calls: the system prompt is recorded.
  const aiUsage = {
    async trackAndComplete(_businessId: string, _userId: unknown, task: string, req: { messages: Message[] }) {
      calls.push({ task, prompt: systemOf(req.messages) });
      const args = { objective: QUERY, urgency: 'normal', scope: [], modules: ['crm'], missingInfo: [], actionCandidates: [], clarificationNeeded: false };
      return { content: '', toolCalls: [{ function: { name: 'parse_intent', arguments: JSON.stringify(args) } }] };
    },
    async callAi(req: { feature: string; messages: Message[] }) {
      calls.push({ task: req.feature, prompt: systemOf(req.messages) });
      return { content: JSON.stringify({ steps: [] }) };
    },
  };
  const graph = { getSnapshot: async () => ({ business: { name: 'V78C Biz' } }), buildContextString: () => 'V78C-CONTEXT' };
  const intentParser = new (IntentParserService as any)(graph, memory, {} as any, aiUsage, prisma);
  planner = new (PlannerService as any)(prisma, aiUsage, graph, { getToolTier: () => 1 }, memory, { getBlueprintContext: async () => null });

  cortexPromptFor = async (userId, stream, businessId = ID.biz) => {
    const prompts: string[] = [];
    const session = { id: `${P}sess`, businessId, userId, status: 'active', persona: 'jarvis', messages: [{ role: 'user', content: QUERY }], detectedRole: null, detectedFunction: null };
    const route = {
      taskCategory: 'general', layers: ['reasoning'], promptVariant: 'standard', includeGenomeContext: false, includeMemoryContext: true,
      includeActions: false, complexity: 'simple', domain: 'general', urgency: 'low', emotionalWeight: 'low', timeHorizon: 'tactical', dataRequirement: 'none',
    };
    // The real prompt context (buildMemoryContext, buildMessages), positionally as Nest constructs it.
    const promptContext = new (KeyCortexPromptContextService as any)({ formatContextForPrompt: () => 'V78C-CORTEX-CONTEXT' }, unified, new KeyCortexLearningService(prisma), prisma);
    const pipeline = new KeyCortexQueryPipelineService(
      {
        complete: async (req: { messages: Message[] }) => {
          prompts.push(systemOf(req.messages));
          return { content: 'ok', provider: 'openai', model: 'stand-in', usage: { totalTokens: 1, estimatedCost: 0 }, fallbackUsed: false };
        },
        streamComplete: async function* (req: { messages: Message[] }) {
          prompts.push(systemOf(req.messages));
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
      { buildContextSnapshot: async () => ({ businessId, genomeStage: 'startup', executiveReadiness: 50 }), formatContextForPrompt: () => '' } as any,
      { buildToolDefinitions: async () => [], executeActions: async () => [] } as any,
      {
        getOrCreateSession: async () => session,
        generateId: () => `${P}msg`,
        saveMessage: async () => undefined,
        updateSessionCognitionMetadata: async () => undefined,
        updateRunningSummary: async () => undefined,
      } as any,
      promptContext,
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
      new KeyCortexMemoryRetrievalService(unified),
      { route: async () => route } as any,
    );
    const query = { text: QUERY, businessId, userId } as any;
    const flags = { integrationV2Enabled: false, genomeV3Enabled: false };
    if (stream) {
      for await (const _chunk of pipeline.streamQuery(query, flags)) {
        /* drained */
      }
    } else {
      await pipeline.processQuery(query, flags);
    }
    expect(prompts, `one prompt for ${userId} (${stream ? 'stream' : 'chat'})`).toHaveLength(1);
    return prompts[0];
  };

  const OFF_ROUTE = new Set([
    // AiController's collaborators no case calls.
    'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'AiOversightService',
    'StrategicIntelligenceService', 'ProAutoMonitorService',
    'ProfileIntelligenceService', 'WorkspaceRecommendationsService', 'ModelGatewayService', 'KeyCommandService',
    'AutopilotRulesService', 'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService',
    'UnifiedInboxService', 'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService',
    'CapacityInsightService', 'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService',
    'ProactiveSuggestionService', 'WorkflowTemplateService', 'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
    // GraphActionsController's.
    'FlowOrchestratorService',
  ]);
  const testing = await Test.createTestingModule({
    controllers: [AiController, GraphActionsController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: AiMemoryService, useValue: memory },
      { provide: IntentParserService, useValue: intentParser },
      { provide: PlannerService, useValue: planner },
      { provide: BusinessGraphService, useValue: graph },
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
  await db.business.create({ data: { id: ID.biz, name: 'V78C Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V78C Other', slug: `${P}biz2`, ownerId: ID.other, currency: 'TTD' } });
  for (const [userId, businessId, role, extra] of [
    [ID.owner, ID.biz, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, ID.biz, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, ID.biz, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.revnoexp, ID.biz, 'STAFF', { permissionScopes: REVENUE_NO_EXPENSES_SCOPES, maxApprovalTier: 0 }],
    [ID.other, ID.otherBiz, 'OWNER', { maxApprovalTier: 4 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId, role, ...extra } });
  }
  await db.contact.create({ data: { id: ID.payer, businessId: ID.biz, firstName: 'V78C', lastName: 'Payer' } });
  await db.contact.create({ data: { id: ID.otherPayer, businessId: ID.otherBiz, firstName: 'V78C', lastName: 'Other payer' } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

describe('FU-CORTEX-PATTERNS-SIGHT (D-257, D-100, D-234): the cortex chat, the intent parser and the planner state a behavioural pattern only to a reader who may read it', () => {
  it('V78C-01 RED: the overdue-invoice total the pattern detector stored reaches the revenue-none STAFF member\'s cortex chat and stream prompts, intent parser prompt and planner prompts (both plan routes); the owner and the revenue reader get it (control)', async () => {
    await clearPatterns();
    try {
      await seedPlain();
      await seedMoneyPattern();
      // The blind member first: their failure is the packet's claim.
      const blind = await everyPromptFor('blind');
      const leaks = Object.fromEntries(Object.entries(blind).map(([surface, prompt]) => [surface, promptStatesMoney(prompt)]));
      expect(leaks, 'blind: the money markers each prompt carries').toEqual({ chat: [], stream: [], intent: [], plan: [], actionsPlan: [] });
      // The memory block is live for them: the business-wide fact reaches every prompt that reads it.
      expect(blind.chat, 'blind chat: control').toContain(FACT);
      expect(blind.stream, 'blind stream: control').toContain(FACT);
      for (const reader of ['owner', 'revenue'] as Reader[]) {
        const seen = await everyPromptFor(reader);
        for (const [surface, prompt] of Object.entries(seen)) {
          expect(prompt, `${reader} ${surface}: control`).toContain(`totaling ${TOTAL}`);
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPatterns();
    }
  }, 300_000);

  it('V78C-02 RED: memberless readers: the SUPER_ADMIN who is no member gets no money pattern on any surface, and a plan with no member (an agent trigger no member wrote) gets no pattern at all', async () => {
    await clearPatterns();
    try {
      await seedPlain();
      await seedMoneyPattern();
      const root = await everyPromptFor('root');
      const memberless = await memberlessPlanPrompt();
      const leaks = Object.fromEntries(Object.entries({ ...root, memberless }).map(([surface, prompt]) => [surface, promptStatesMoney(prompt)]));
      expect(leaks, 'root and the memberless plan: the money markers each prompt carries').toEqual({ chat: [], stream: [], intent: [], plan: [], actionsPlan: [], memberless: [] });
      // As the flow chat's support desk (MEM-PATTERNS-SIGHT): a prompt that names no member carries no behavioural pattern.
      expect(memberless, 'memberless plan: no pattern').not.toContain(PEAK);
      expect(memberless, 'memberless plan: no pattern').not.toContain(OPS);
    } finally {
      await clearPatterns();
    }
  }, 300_000);

  it('V78C-03 RED: an expense-stating pattern reaches only a member with expenses read: the revenue-and-expenses reader gets it on every surface; the revenue-only member, the blind member and the SUPER_ADMIN who is no member do not', async () => {
    await clearPatterns();
    try {
      await seedPlain();
      await seedExpensePattern();
      for (const [surface, prompt] of Object.entries(await everyPromptFor('revenue'))) {
        expect(prompt, `revenue ${surface}: control`).toContain(EXPENSE);
      }
      const leaks: string[] = [];
      for (const reader of ['revnoexp', 'blind', 'root'] as Reader[]) {
        for (const [surface, prompt] of Object.entries(await everyPromptFor(reader))) {
          if (prompt.includes(EXPENSE)) leaks.push(`${reader} ${surface}`);
        }
      }
      expect(leaks, 'the prompts that carry the expense pattern').toEqual([]);
    } finally {
      await clearPatterns();
    }
  }, 300_000);

  it('V78C-04 RED: 0-vs-N differential: every prompt of the revenue-none STAFF member and of the SUPER_ADMIN who is no member, and the memberless plan, is identical (clock masked) whether the business holds no money or expense pattern or N of them', async () => {
    await clearPatterns();
    try {
      await seedPlain();
      const all = async () => ({ blind: await everyPromptFor('blind'), root: await everyPromptFor('root'), memberless: await memberlessPlanPrompt() });
      const before = await all();
      await seedMoneyPattern();
      await seedMoreMoneyPatterns(6);
      await seedExpensePattern();
      // Control: the money patterns are there to be read.
      expect((await everyPromptFor('revenue')).chat).toContain('Revenue dropped 15%');
      const after = await all();
      const changed: string[] = [];
      for (const who of ['blind', 'root'] as const) {
        for (const surface of Object.keys(before[who]) as Surface[]) {
          if (masked(after[who][surface]) !== masked(before[who][surface])) changed.push(`${who} ${surface}`);
        }
      }
      if (masked(after.memberless) !== masked(before.memberless)) changed.push('memberless plan');
      expect(changed, 'the prompts that differ between 0 and N patterns').toEqual([]);
      for (const who of ['blind', 'root'] as const) {
        for (const surface of Object.keys(before[who]) as Surface[]) {
          expect(masked(after[who][surface]), `${who} ${surface}`).toBe(masked(before[who][surface]));
        }
      }
    } finally {
      await clearPatterns();
    }
  }, 600_000);

  it("V78C-05 owner parity: the owner's and the revenue-and-expenses reader's prompts (cortex chat and stream, intent parser, both plan routes) are byte-identical to the unscoped read's over the same rows", async () => {
    await clearPatterns();
    try {
      await seedPlain();
      await seedMoneyPattern();
      await seedMoreMoneyPatterns(2);
      await seedExpensePattern();
      await memory.upsert(ID.biz, { category: 'goals', key: 'north_star', value: 'Open a second location', source: 'user' });
      for (const reader of ['owner', 'revenue'] as Reader[]) {
        legacy.on = true;
        let unscoped: Record<Surface, string>;
        try {
          unscoped = await everyPromptFor(reader);
        } finally {
          legacy.on = false;
        }
        const scoped = await everyPromptFor(reader);
        for (const surface of Object.keys(unscoped) as Surface[]) {
          expect(unscoped[surface], `${reader} ${surface}: control`).toContain(`totaling ${TOTAL}`);
          expect(unscoped[surface], `${reader} ${surface}: control`).toContain(EXPENSE);
          expect(masked(scoped[surface]), `${reader} ${surface}`).toBe(masked(unscoped[surface]));
        }
      }
    } finally {
      legacy.on = false;
      await clearPatterns();
    }
  }, 600_000);

  it("V78C-06 cross-tenant: another business's money pattern never reaches this business's owner (cortex and planner), this business's never reaches the other owner's, and a member of this business is refused the other business's routes", async () => {
    await clearPatterns();
    try {
      await seedMoneyPattern();
      await seedMoneyPattern(ID.otherBiz, ID.otherPayer, 5000, 4157, OTHER_TOTAL);
      const owner = { chat: await cortexPromptFor(ID.owner, false), plan: (await planPromptFor('owner')).plan };
      for (const [surface, prompt] of Object.entries(owner)) {
        expect(prompt, `owner ${surface}`).toContain(`totaling ${TOTAL}`);
        expect(prompt, `owner ${surface}`).not.toContain(`totaling ${OTHER_TOTAL}`);
        expect(prompt, `owner ${surface}`).not.toContain('Overdue: 5000');
      }
      const other = { chat: await cortexPromptFor(ID.other, false, ID.otherBiz), plan: (await planPromptFor('other', 'ai', ID.otherBiz)).plan };
      for (const [surface, prompt] of Object.entries(other)) {
        expect(prompt, `other owner ${surface}`).toContain(`totaling ${OTHER_TOTAL}`);
        expect(prompt, `other owner ${surface}`).not.toContain(`totaling ${TOTAL}`);
        expect(prompt, `other owner ${surface}`).not.toContain('Overdue: 4000');
      }
      // This business's revenue member, on the other business: refused by BusinessGuard, and no model call is made.
      calls.length = 0;
      for (const url of [`/ai/businesses/${ID.otherBiz}/ai/intent`, `/ai/businesses/${ID.otherBiz}/ai/plan`, `/actions/businesses/${ID.otherBiz}/plan`]) {
        const res = await agent().post(url).set(HEADER, ID.revenue).set('x-forwarded-for', nextIp()).send({ input: QUERY });
        expect(res.status, url).toBe(403);
      }
      expect(calls).toEqual([]);
      // Their cortex prompt on the other business reads no memory of it (no member reader there): no pattern of either.
      const crossed = await cortexPromptFor(ID.revenue, false, ID.otherBiz);
      expect(crossed).not.toContain(`totaling ${OTHER_TOTAL}`);
      expect(crossed).not.toContain(`totaling ${TOTAL}`);
    } finally {
      await clearPatterns();
    }
  }, 300_000);
});
