/**
 * MEM-DOC-EXTRACTION-SIGHT (P0; owner rulings D-257 (KEY's memory design, its four scope fixes), D-234 (sales and money
 * data need revenue read; ambiguous provenance fails closed), D-227, D-238, D-100, D-128; journey K).
 *
 * KeyCortexDocumentService.extractData stores JSON.stringify of any uploaded document's extracted data as an AiMemory row
 * (category document_extraction, key = the document's id). The document record (KeyDocument) carries only its file type:
 * there is no document classifier, so whether an extraction is an invoice, a statement or a menu is unknown. Before this
 * packet the row reached every reader: KEY's memory reads (the /ai flow chat's "WHAT YOU HAVE OBSERVED" block,
 * POST /cortex/chat's buildMemoryContext and the pipeline's own read) render AiMemory rows with no module projection,
 * and GET .../ai/memory (AuthGuard and BusinessGuard only) returns every row, as do GET .../ai/profile/status and the
 * profile interview's prompt (POST .../ai/profile/chat). An extracted invoice's amounts therefore reached a STAFF member
 * whose revenue scope is none, and a SUPER_ADMIN who is no member.
 *
 * GREEN (D-234 fail closed): no document_extraction row reaches a reader without revenue read, nor a turn with no
 * member reader; the owner and a revenue reader keep them. A withheld row leaves no trace: the blind reader's prompts
 * and responses are byte-identical whether or not extractions exist, and a business with many extractions does not
 * crowd the blind reader's other memory out of the read (the rows are not read for them at all).
 *
 * Every write goes through its real writer on the real database: the extraction through the real
 * KeyCortexDocumentService.extractData over the real UnifiedMemoryWriterService and AiMemoryService (the model's answer
 * is a stand-in). Every read goes through its real route or service: AiFlowController behind its real guards over the
 * real FlowOrchestratorService perception block and UnifiedMemoryRetrievalService; KeyCortexPromptContextService
 * .buildMemoryContext and KeyCortexQueryPipelineService over the real stores; the real AiController (GET .../ai/memory,
 * .../ai/memory/context, .../ai/profile/status, POST .../ai/profile/chat) behind AuthGuard and BusinessGuard over the
 * real AiMemoryService and ProfileIntelligenceService.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v71s-user`), the model provider (it records the system prompt
 * it is handed and answers fixed text), the document chunk store (Redis: no chunks), the other context reads of the
 * prompts, and the semantic store (answers nothing). globalThis.fetch is a tap that refuses and records every outbound
 * request: none is made.
 *
 * Fixture prefix v71s_ (MEM-DOC-EXTRACTION-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71s_';
const HEADER = 'x-v71s-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue read. */
  revenue: `${P}revenue`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them; no member reader (memberless). */
  admin: `${P}admin`,
  biz: `${P}biz`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'write', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { crm: 'read', operations: 'read', ai: 'write', revenue: 'read', expenses: 'none' };

type Reader = 'owner' | 'blind' | 'revenue' | 'admin';
const READERS: Reader[] = ['owner', 'blind', 'revenue', 'admin'];
/** Whether each reader may read revenue in the business (a SUPER_ADMIN who is no member: no member, no module). */
const READS_REVENUE: Record<Reader, boolean> = { owner: true, blind: false, revenue: true, admin: false };
const BLIND_READERS: Reader[] = READERS.filter((r) => !READS_REVENUE[r]);

/** A business-wide AiMemory fact: every reader's prompt carries it (the memory block renders). */
const FACT = 'V71S-FACT: we open at nine';
/** The extracted invoice's markers: its total and its number. */
const INVOICE_TOTAL = '4812.37';
const INVOICE_NUMBER = 'V71S-INV-0042';
/** The document ids' prefix: the extraction row's key, which every prompt line of it starts with (the prompts cut a
 * row's content at 250 characters, before the extracted figures). */
const DOC_KEY = `${P}doc_`;
const EXTRACTION_MARKERS = [INVOICE_TOTAL, INVOICE_NUMBER, 'document_extraction', DOC_KEY];
const TURN = 'v71s: how are we doing this month?';

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let prisma: any;
let http: any;
let documents: any;
let flow: { prompts: string[]; warnings: string[] };
let profilePrompts: string[];
let promptContextFor: (userId: string | undefined) => Promise<string>;
let pipelinePromptFor: (userId: string | undefined) => Promise<string>;
let semantic: any;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('business_events'),
    byBiz('cognitive_events'),
    byBiz('cortex_action_logs'),
    byBiz('ai_execution_logs'),
    byBiz('cognition_memories'),
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('key_documents'),
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

/** Removes every extraction (rows and their documents) and every semantic copy; the fact stays. */
async function clearExtractions() {
  await db.$executeRawUnsafe(`DELETE FROM ai_memory_embeddings WHERE business_id = $1`, ID.biz);
  await db.$executeRawUnsafe(`DELETE FROM ai_memories WHERE business_id = $1 AND category = 'document_extraction'`, ID.biz);
  await db.$executeRawUnsafe(`DELETE FROM key_documents WHERE business_id = $1`, ID.biz);
}

/**
 * Uploads `count` invoices' records and extracts each through the real KeyCortexDocumentService.extractData (the
 * model's answer is a stand-in carrying the invoice's total and number). Returns the document ids.
 */
async function extractInvoices(count = 1): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${DOC_KEY}${i}`;
    await db.keyDocument.create({ data: { id, businessId: ID.biz, fileName: `invoice-${i}.pdf`, fileType: 'pdf', status: 'indexed' } });
    await documents.extractData(id, { total: { type: 'number', description: 'invoice total' }, number: { type: 'string', description: 'invoice number' } }, ID.biz);
    ids.push(id);
  }
  expect(await db.aiMemory.count({ where: { businessId: ID.biz, category: 'document_extraction' } })).toBe(count);
  return ids;
}

/**
 * One turn of `userId` over POST .../flow/chat or .../flow/chat/stream: the system prompt the model was handed, and the
 * response (the chat's body; the stream's events). The turn is in the history too, as the app sends it: the chat path's
 * semantic memory section searches on the history's last user message, the stream's on the message.
 */
let ip = 0;
async function turn(userId: string, path: 'chat' | 'stream' = 'chat'): Promise<{ prompt: string; body: unknown }> {
  flow.prompts.length = 0;
  ip += 1;
  const req = request(http.getHttpServer())
    .post(`/ai/businesses/${ID.biz}/flow/chat${path === 'stream' ? '/stream' : ''}`)
    .set(HEADER, userId)
    .set('x-forwarded-for', `10.74.4.${ip % 250}`)
    .send({ message: TURN, history: [{ role: 'user', content: TURN }] });
  let body: unknown;
  if (path === 'chat') {
    const res = await req;
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    body = res.body;
  } else {
    const res = await req.buffer(true).parse((r: any, cb: any) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => {
        text += c;
      });
      r.on('end', () => cb(null, text));
    });
    const events = String(res.body)
      .split('\n')
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice('data: '.length)));
    expect(events.filter((e: any) => e.type === 'error'), String(res.body).slice(0, 400)).toEqual([]);
    // A new chat session's id is random on every turn: compared as present, not by value.
    body = events.map((e: any) => (typeof e.sessionId === 'string' ? { ...e, sessionId: '<new session>' } : e));
  }
  expect(flow.prompts, `one model call for ${userId} (${path})`).toHaveLength(1);
  return { prompt: flow.prompts[0], body };
}

/** GET .../agent/memory/search for `userId`: every hit the semantic store answers (limit 500). */
async function memorySearchFor(userId: string): Promise<unknown> {
  const res = await request(http.getHttpServer())
    .get(`/ai/businesses/${ID.biz}/agent/memory/search`)
    .query({ q: 'what happened lately', limit: '500' })
    .set(HEADER, userId);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  // Ties at similarity 1 come back in no set order: compared as a sorted set of contents.
  return ((res.body?.results ?? []) as Array<{ content: string }>).map((r) => r.content).sort();
}

/** POST .../ai/profile/reset as `userId`. */
async function profileResetFor(userId: string) {
  const res = await agent().post(aiRoute('profile/reset')).set(HEADER, userId).send({});
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
}

const agent = () => request(http.getHttpServer());
const aiRoute = (route: string) => `/ai/businesses/${ID.biz}/ai/${route}`;

async function getJson(userId: string, route: string): Promise<unknown> {
  const res = await agent().get(aiRoute(route)).set(HEADER, userId);
  expect(res.status, `${route} for ${userId}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}

/**
 * One profile interview turn of `userId` (POST .../ai/profile/chat): every message the model was handed (the system
 * prompt and the interview's history), and the response. `fresh` resets the caller's interview first.
 */
async function profileTurn(userId: string, message: string, fresh = true): Promise<{ prompt: string; body: unknown }> {
  if (fresh) await profileResetFor(userId);
  profilePrompts.length = 0;
  ip += 1;
  const res = await agent()
    .post(aiRoute('profile/chat'))
    .set(HEADER, userId)
    .set('x-forwarded-for', `10.74.5.${ip % 250}`)
    .send({ message });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  expect(profilePrompts, `one model call for ${userId}`).toHaveLength(1);
  return { prompt: profilePrompts[0], body: res.body };
}
const profilePromptFor = async (userId: string) => (await profileTurn(userId, 'v71s: we sell lunches')).prompt;

/** Everything a reader is handed on every surface this packet covers. */
async function everythingFor(reader: Reader) {
  const id = ID[reader];
  const flowTurn = await turn(id);
  const streamTurn = await turn(id, 'stream');
  return {
    // The flow prompt states the hour (currentDateForPrompt): a run that crosses one must not read as a difference.
    flowPrompt: flowTurn.prompt.replace(/\d{4}-\d{2}-\d{2}T\d{2}:00Z/g, '<hour>'),
    // A new chat session's id is random on every turn: compared as present, not by value.
    flowBody: { ...(flowTurn.body as Record<string, unknown>), sessionId: typeof (flowTurn.body as any)?.sessionId === 'string' ? '<new session>' : undefined },
    flowStreamPrompt: streamTurn.prompt.replace(/\d{4}-\d{2}-\d{2}T\d{2}:00Z/g, '<hour>'),
    flowStreamEvents: streamTurn.body,
    memorySearch: await memorySearchFor(id),
    buildMemoryContext: await promptContextFor(id),
    pipeline: await pipelinePromptFor(id),
    memory: await getJson(id, 'memory'),
    memoryByCategory: await getJson(id, 'memory?category=document_extraction'),
    memoryContext: await getJson(id, 'memory/context'),
    profileStatus: await getJson(id, 'profile/status'),
    profilePrompt: await profilePromptFor(id),
  };
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v71s: no outbound traffic in this suite');
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
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { ProfileIntelligenceService } = await import('../src/modules/ai/profile-intelligence.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { UnifiedMemoryWriterService } = await import('../src/modules/key-cortex/unified-memory-writer.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');

  prisma = new PrismaService();
  // The semantic store: the real SemanticMemoryService over the real ai_memory_embeddings table; the embedding provider
  // is a stand-in answering one fixed unit vector, so every copy matches every query at similarity 1.
  const UNIT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  semantic = new SemanticMemoryService(prisma, new EventEmitter2(), {
    trackEmbedding: async (_b: string, _u: unknown, _o: string, texts: string[]) => texts.map(() => UNIT_VECTOR),
  } as any);

  // The real memory service and writer (getAll, getByCategory, upsert and buildContextBlock read and write the
  // database; the blueprint has none for this business).
  const memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any);
  const writer = new UnifiedMemoryWriterService(memory);
  // The document service's extraction: the real extractData over the real writer; no chunks in the stand-in Redis, and
  // the model's answer is the extracted invoice.
  const gateway = {
    complete: async () => ({
      content: JSON.stringify({ data: { total: Number(INVOICE_TOTAL), number: INVOICE_NUMBER, vendor: 'V71S Supplies' }, confidence: 0.92 }),
    }),
  };
  const redisStandIn = { redis: { scan: async () => ['0', []] }, getJson: async () => null };
  documents = new KeyCortexDocumentService(prisma, redisStandIn as any, gateway as any, {} as any, writer);

  // The flow orchestrator: the real chat() and buildPerceptionSection over the real memory stores.
  const prompts: string[] = [];
  const warnings: string[] = [];
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  type GatewayRequest = { messages: Array<{ role: string; content: unknown }> };
  const systemOf = (req: GatewayRequest) => req.messages.filter((x) => x.role === 'system').map((x) => String(x.content ?? '')).join('\n');
  const aiUsage = {
    checkRateLimit() {},
    async checkCredits() {
      return { allowed: true };
    },
    async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      prompts.push(systemOf(req));
      return { content: 'v71s: noted.', toolCalls: [], usage };
    },
    async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      prompts.push(systemOf(req));
      yield { type: 'content_delta', content: 'v71s: noted.' };
    },
  };
  const recorder = { emit() { return true; }, async recordEvent() { return undefined; }, async create() { return undefined; } };
  const roleEngine = new RoleEngineService(prisma, {} as any, recorder as any);
  const jobRolePolicy = new JobRolePolicyService();
  const unified = new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any);
  const providers = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!providers.has(token)) throw new Error(`v71s: no provider for ${token?.name ?? String(token)}`);
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
      getSnapshot: async () => ({ business: { name: 'V71S Biz' } }),
      buildContextString: () => '',
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    // The flow chat's "RELEVANT CONTEXT FROM MEMORY" section reads the real semantic store.
    semanticMemory: semantic,
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

  // The profile interview: the real ProfileIntelligenceService over the real memory service and the real
  // BusinessGraphService (its snapshot of this business, projected for the viewer it is handed); the model records
  // every message it is handed (the system prompt and the interview's history).
  profilePrompts = [];
  const profileUsage = {
    async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      profilePrompts.push(req.messages.map((x) => `[${x.role}] ${String(x.content ?? '')}`).join('\n'));
      // KEY's reply restates the turn it answers (REPLY-OF: ...), so a reply that leaks is told apart from the turn.
      const last = [...req.messages].reverse().find((x) => x.role === 'user');
      return { content: `v71s: tell me more. REPLY-OF: ${String(last?.content ?? '')}`, toolCalls: [], usage };
    },
  };
  const profile = new ProfileIntelligenceService(prisma, memory, new BusinessGraphService(prisma), {} as any, profileUsage as any);

  const OFF_ROUTE = new Set([
    // AiController's collaborators no case calls.
    'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'AiOversightService', 'BusinessGraphService',
    'IntentParserService', 'PlannerService', 'StrategicIntelligenceService', 'ProAutoMonitorService',
    'WorkspaceRecommendationsService', 'ModelGatewayService', 'KeyCommandService',
    'AutopilotRulesService', 'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService',
    'UnifiedInboxService', 'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService',
    'CapacityInsightService', 'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService',
    'ProactiveSuggestionService', 'WorkflowTemplateService', 'KeyActionProposalService',
    'KeyCortexApprovalOrchestratorService',
    // AgentController's.
    'AgentStateMachineService', 'AgentBusService', 'PatternDetectorService', 'CalendarIntelligenceService',
    'DocumentIntelligenceService',
  ]);
  const testing = await Test.createTestingModule({
    controllers: [AiFlowController, AiController, AgentController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: FlowOrchestratorService, useValue: orchestrator },
      { provide: AiMemoryService, useValue: memory },
      { provide: ProfileIntelligenceService, useValue: profile },
      { provide: SemanticMemoryService, useValue: semantic },
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
  pipelinePromptFor = async (userId) => {
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
      // The pipeline's read passes the turn's text as its query: the real semantic store answers it.
      new KeyCortexMemoryRetrievalService(new UnifiedMemoryRetrievalService(prisma, semantic)),
      { route: async () => route } as any,
    );
    await pipeline.processQuery({ text: 'what happened lately', businessId: ID.biz, userId } as any, { integrationV2Enabled: false, genomeV3Enabled: false });
    expect(prompts2).toHaveLength(1);
    return prompts2[0];
  };

  await cleanup();
  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.blind, 'USER'],
    [ID.revenue, 'USER'],
    [ID.admin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71S Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  for (const [userId, role, extra] of [
    [ID.owner, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId: ID.biz, role, ...extra } });
  }
  // The fact is older than every extraction (a business that has uploaded many documents since).
  await db.aiMemory.create({
    data: { businessId: ID.biz, category: 'fact', key: `${P}fact`, value: FACT, createdAt: new Date(Date.now() - 3 * 86400_000) },
  });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

describe('MEM-DOC-EXTRACTION-SIGHT (D-234 fail closed, D-257): a document extraction reaches only readers who may read revenue', () => {
  it("premise: the real extractData stores the extracted invoice as a document_extraction AiMemory row keyed by the document, with no classification of the document's kind", async () => {
    await clearExtractions();
    try {
      const [docId] = await extractInvoices(1);
      const row = await db.aiMemory.findFirst({ where: { businessId: ID.biz, category: 'document_extraction' } });
      expect(row.key).toBe(docId);
      expect(row.value).toContain(INVOICE_TOTAL);
      expect(row.value).toContain(INVOICE_NUMBER);
      const doc = await db.keyDocument.findUnique({ where: { id: docId } });
      expect(Object.keys(doc).sort()).toEqual(
        ['businessId', 'chunksIndexed', 'createdAt', 'fileName', 'fileSize', 'fileType', 'id', 'metadata', 'status', 'storageUrl', 'updatedAt'],
      );
    } finally {
      await clearExtractions();
    }
  });

  it("an extracted invoice's total and number (and its semantic copy) reach the KEY prompts (flow chat and its stream, buildMemoryContext, the pipeline), GET .../agent/memory/search, GET .../ai/memory (whole and by category), GET .../ai/profile/status and the profile interview's prompt of the owner and the revenue reader, and none of them for the blind STAFF member or a SUPER_ADMIN who is no member", async () => {
    await clearExtractions();
    try {
      await extractInvoices(1);
      // Every row copied into the semantic store (POST .../agent/memory/backfill): the fact's copy and the extraction's.
      await semantic.backfillFromAiMemory(ID.biz);
      for (const reader of READERS) {
        const seen = await everythingFor(reader);
        for (const [surface, value] of Object.entries(seen)) {
          // The responses carry the model's fixed answer only (compared whole in the differentials).
          if (surface === 'flowBody' || surface === 'flowStreamEvents') continue;
          const text = typeof value === 'string' ? value : JSON.stringify(value);
          const label = `${reader} ${surface}: ${text.slice(0, 300)}`;
          if (surface === 'memoryContext') {
            // GET .../ai/memory/context renders no extraction for anyone (its block has no place for one).
            expect(text, label).not.toContain(INVOICE_TOTAL);
            continue;
          }
          if (READS_REVENUE[reader]) {
            expect(text, label).toContain(DOC_KEY);
            // The routes and the profile interview hand over the whole row, figures included.
            if (!['flowPrompt', 'flowStreamPrompt', 'buildMemoryContext', 'pipeline'].includes(surface)) expect(text, label).toContain(INVOICE_TOTAL);
          }
          else for (const marker of EXTRACTION_MARKERS) expect(text, `${label}: ${marker}`).not.toContain(marker);
          // Control: the business-wide fact still renders for every reader wherever memory rows render.
          if (surface !== 'memoryByCategory' && surface !== 'memoryContext') expect(text, `${label}: fact`).toContain(FACT);
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearExtractions();
    }
  }, 120_000);

  it("differential: for the blind STAFF member and the memberless SUPER_ADMIN every prompt and every response is identical whether or not extractions exist, even when the business has more extractions than the memory read takes (they crowd out nothing)", async () => {
    await clearExtractions();
    const before: Record<string, unknown> = {};
    for (const reader of BLIND_READERS) before[reader] = await everythingFor(reader);
    try {
      await extractInvoices(60);
      for (const reader of BLIND_READERS) {
        const after = await everythingFor(reader);
        const was = before[reader] as Record<string, unknown>;
        expect(Object.keys(after).sort(), reader).toEqual(Object.keys(was).sort());
        for (const [surface, value] of Object.entries(after)) expect(value, `${reader} ${surface}`).toEqual(was[surface]);
        expect(after.buildMemoryContext, `${reader}: fact`).toContain(FACT);
      }
      // Control: the owner's read does carry the extractions, so the differential is not vacuous.
      expect(await promptContextFor(ID.owner)).toContain(DOC_KEY);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearExtractions();
    }
  }, 240_000);

  it("differential, semantic copies (review findings, COR-MDX-1): once every row is copied into the semantic store (POST .../agent/memory/backfill), every prompt and response of the blind STAFF member and the memberless SUPER_ADMIN (the flow chat's semantic memory section, chat and stream, GET .../agent/memory/search, the pipeline, ...) is identical whether or not 200 extractions and their copies exist; the fact's copy still renders", async () => {
    await clearExtractions();
    await semantic.backfillFromAiMemory(ID.biz);
    const before: Record<string, Record<string, unknown>> = {};
    for (const reader of BLIND_READERS) before[reader] = await everythingFor(reader);
    try {
      expect(before.blind.pipeline, 'the fact\'s copy renders').toContain('[ai_memory_embedding]');
      expect(before.blind.flowPrompt, 'the semantic section renders the fact\'s copy').toContain('RELEVANT CONTEXT FROM MEMORY');
      expect(before.blind.memorySearch, 'the search answers the fact\'s copy').toEqual([expect.stringContaining(FACT)]);
      await extractInvoices(200);
      // The backfill copies every row again, the fact too: its copy is dropped first, so the fact keeps exactly one.
      await db.aiMemoryEmbedding.deleteMany({ where: { businessId: ID.biz } });
      await semantic.backfillFromAiMemory(ID.biz);
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz, content: { startsWith: 'document_extraction: ' } } })).toBe(200);
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz } })).toBe(201);
      for (const reader of BLIND_READERS) {
        const after = await everythingFor(reader);
        expect(Object.keys(after).sort(), reader).toEqual(Object.keys(before[reader]).sort());
        for (const [surface, value] of Object.entries(after)) expect(value, `${reader} ${surface}`).toEqual(before[reader][surface]);
      }
      // Controls: the semantic store serves the copies to a search that includes them (so the blind reads' equality
      // is not for want of copies) and none by default; the owner's search answers them, and the owner's prompts
      // still carry the extractions.
      const served = async (include?: boolean) =>
        (await semantic.search({ businessId: ID.biz, query: 'what happened lately', limit: 500, minSimilarity: 0.65, ...(include === undefined ? {} : { includeDocumentExtractionCopies: include }) }))
          .filter((hit: any) => hit.content.startsWith('document_extraction: ')).length;
      expect(await served(true)).toBe(200);
      expect(await served(false)).toBe(0);
      expect(await served()).toBe(0);
      expect(((await memorySearchFor(ID.owner)) as string[]).filter((c) => c.startsWith('document_extraction: '))).toHaveLength(200);
      expect(await pipelinePromptFor(ID.owner)).toContain(DOC_KEY);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearExtractions();
    }
  }, 600_000);
});

describe('MEM-DOC-EXTRACTION-SIGHT orchestrator review: the profile interview and the real wiring', () => {
  it("the profile interview is each member's own (D-130): a STAFF member's interview never carries the owner's messages or KEY's replies to them, in its prompt or its response", async () => {
    const OWNER_TURN = 'V71S-OWNER-TURN: our margin is 41 percent';
    await profileResetFor(ID.blind);
    const owner = await profileTurn(ID.owner, OWNER_TURN);
    expect(owner.prompt).toContain(OWNER_TURN);
    expect(JSON.stringify(owner.body), "KEY's reply to the owner").toContain(`REPLY-OF: ${OWNER_TURN}`);
    // The blind member's next turn, without resetting: their own interview, not the owner's (neither the owner's turn
    // nor KEY's reply to it).
    for (const reader of ['blind', 'revenue', 'admin'] as const) {
      const theirs = await profileTurn(ID[reader], 'v71s: we deliver on weekends', false);
      expect(theirs.prompt, reader).not.toContain(OWNER_TURN);
      expect(JSON.stringify(theirs.body), reader).not.toContain(OWNER_TURN);
    }
    // The owner's own interview still carries their earlier turn.
    const ownerAgain = await profileTurn(ID.owner, 'v71s: and we cater', false);
    expect(ownerAgain.prompt).toContain(OWNER_TURN);
    expect(outbound, 'no outbound request').toEqual([]);
  }, 120_000);

  it("delta review: a member's interview built while they read revenue is not replayed once their revenue read is gone: its earlier turns and KEY's replies (which may restate the monthly revenue or an extraction) are dropped", async () => {
    const EARLIER = 'V71S-EARLIER-TURN: what did that invoice total?';
    const membership = await db.membership.findUnique({ where: { id: m(ID.revenue) } });
    try {
      const first = await profileTurn(ID.revenue, EARLIER);
      expect(first.prompt).toContain('Monthly revenue:');
      expect(JSON.stringify(first.body)).toContain(`REPLY-OF: ${EARLIER}`);
      // The owner takes the member's revenue read away; the member's next turn, without a reset.
      await db.membership.update({ where: { id: m(ID.revenue) }, data: { permissionScopes: { ...REVENUE_SCOPES, revenue: 'none' } } });
      const after = await profileTurn(ID.revenue, 'v71s: and now?', false);
      expect(after.prompt).not.toContain(EARLIER);
      expect(after.prompt).not.toContain('Monthly revenue');
      expect(JSON.stringify(after.body)).not.toContain(EARLIER);
      // Widening again starts afresh too, and keeps nothing from the narrowed interview either way.
      await db.membership.update({ where: { id: m(ID.revenue) }, data: { permissionScopes: membership.permissionScopes } });
      const again = await profileTurn(ID.revenue, 'v71s: once more', false);
      expect(again.prompt).not.toContain(EARLIER);
      expect(again.prompt).toContain('Monthly revenue:');
    } finally {
      await db.membership.update({ where: { id: m(ID.revenue) }, data: { permissionScopes: membership.permissionScopes } });
    }
    expect(outbound, 'no outbound request').toEqual([]);
  }, 120_000);

  it("the profile interview's prompt states the business's monthly revenue only to a reader with revenue read (D-100): the owner and the revenue reader, never the blind STAFF member nor a SUPER_ADMIN who is no member", async () => {
    for (const reader of READERS) {
      const prompt = await profilePromptFor(ID[reader]);
      expect(prompt, reader).toContain('Business name: V71S Biz');
      if (READS_REVENUE[reader]) expect(prompt, reader).toContain('Monthly revenue:');
      else expect(prompt, reader).not.toContain('Monthly revenue');
    }
    expect(outbound, 'no outbound request').toEqual([]);
  }, 120_000);

  it('real wiring (COR-MDX-2): KeyCortexPromptContextService as Nest builds it from its providers gets the PrismaService, so the owner and the revenue reader still see the extractions and the blind member does not', async () => {
    const { Test } = await import('@nestjs/testing');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
    const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
    const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
    const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
    const mod = await Test.createTestingModule({
      providers: [
        KeyCortexPromptContextService,
        { provide: KeyCortexContextService, useValue: {} },
        { provide: UnifiedMemoryRetrievalService, useValue: new UnifiedMemoryRetrievalService(prisma, semantic) },
        { provide: KeyCortexLearningService, useValue: new KeyCortexLearningService(prisma) },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const service = mod.get(KeyCortexPromptContextService);
    await clearExtractions();
    try {
      await extractInvoices(1);
      for (const reader of READERS) {
        const session = { id: `${P}sess_wired`, businessId: ID.biz, userId: ID[reader], messages: [] } as any;
        const block = (await service.buildMemoryContext(ID.biz, session, ID[reader])).aiMemory ?? '';
        expect(block, reader).toContain(FACT);
        if (READS_REVENUE[reader]) expect(block, reader).toContain(DOC_KEY);
        else expect(block, reader).not.toContain(DOC_KEY);
      }
    } finally {
      await clearExtractions();
      await mod.close();
    }
  }, 120_000);
});
