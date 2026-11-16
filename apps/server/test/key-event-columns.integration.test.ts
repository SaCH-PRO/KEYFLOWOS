/**
 * V1-71 FU-KEY-EVENT-COLUMNS (owner ruling D-220, follow-up C5 of D-221) — KEY's event writer uses the real
 * business_events columns, and KEY's own observations are kept there, on a REAL database.
 *
 * The defect: KeyCortexEventService.logEvent wrote `type`, `module`, `payload`, `genomeSignal`, `genomeImpact`,
 * `userId` and `parentEventId`, none of which business_events has (its columns are event_type, subject_type,
 * subject_id, actor_type, actor_id, action, source, metadata, session_id, correlation_id). The real client refused
 * every call, so KEY's calibration history, its decision logs (the ethics organ's) and its conscious-process logs
 * were never stored; W1F-KEY-EVIDENCE-WRITE only made those failures survivable. Its readers (getEvents,
 * getEventStats, getGenomeSignals, getModuleEvents) filtered on the same missing columns and put `limit` in the
 * WHERE, and getEventChain read a correlation id across every business. KEY's cortex claims (capability tracking,
 * pattern detection, action outcomes) had no home at all: KeyCortexEvidenceService.createEvidence refuses them
 * (the `evidence` table is the business's proof list, V61-07), so trackCapability's claim and the genome bridge's
 * fallback were lost. D-220: KEY's own observations are kept in business_events, through the corrected writer.
 *
 * Required, and pinned here:
 *   V71J-01  POST /api/v1/cortex/conscious/chat (a deliberative question, the real guards and the whole
 *            consciousness graph): business_events holds exactly one row per KEY observation of that answer, on
 *            the real columns, in the asking business: the ethics organ's decision log, the conscious-process log
 *            and the capability claim (step 11).
 *   V71J-02  KEY's rows carry no personal data and no secret: not the question, not KEY's conclusion (which names
 *            the customer and the figure here), not the customer's name, the figure, or the owner's email or id.
 *            Free text is withheld by name; only allowed fields with numbers, booleans and short tokens are kept;
 *            a secret-shaped, email, phone or JWT-shaped value never is.
 *   V71J-03  another business never reads them: the readers are business-scoped (getEvents, getEventChain,
 *            getEventStats), and a second business's own answer through the HTTP route reads and writes only its
 *            own rows.
 *   V71J-04  a write that names no business, or no known event type, is refused by name before any query; the
 *            gateway's fire-and-forget emit writes nothing for no business and no message text for one.
 *   V71J-05  KEY's cortex claims are kept in business_events (D-220): trackCapability writes its claim once and
 *            nothing in `evidence`; the genome bridge's claims (pattern detection, action outcome), with and
 *            without the genome's evidence store wired, land there too; an action outcome is logged once.
 *   V71J-06  the readers that now work read only KEY's own observations, of their business: the self-model builds
 *            on the real database; reflection reads each of KEY's rows once; and the prompt's business memory
 *            (UnifiedMemoryRetrievalService) does not take KEY's own bookkeeping as an observed business event,
 *            while another writer's row still reaches it.
 *
 * WHAT IS REAL: PrismaService over DATABASE_URL, AuthGuard, BusinessGuard, TenantInterceptor and the Prisma tenant
 * extension, the production GlobalHttpExceptionFilter and ValidationPipe, KeyCortexController,
 * KeyCortexSessionService and KeyCortexConversationService, and the whole consciousness graph (emotion, reasoning
 * engine, reflection, intuition, metacognition, creativity, ethics, temporal reasoning, context v2, genome bridge,
 * personality, event, evidence, interoception, endocrine), as key-cortex-conscious-answer builds it.
 * Stand-ins: identity attachment (`x-v71j-user` attaches the seeded user row, as AuthMiddleware does after token
 * verification); the model (AiUsageService.trackAndComplete and ModelGatewayService.complete answer at once; no
 * model or provider is called); Redis (an in-memory get/set/setex/del map); the organ registrar (no organs);
 * KeyCortexInsightService (no insights); globalThis.fetch (recorded and refused; asserted never called); and the
 * controller's collaborators for its other routes (an allow-listed mocker).
 *
 * Every seeded row carries the `v71j_` prefix and is hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and
 * afterAll; no $transaction wrapping. Values that must never be stored are built at runtime from fragments.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the shell / CI env wins).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = 'v71j_';
const HEADER = 'x-v71j-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  invoiceA: `${P}invA`,
};

/** The customer KEY's conclusion names, and the figure it quotes: neither may reach a KEY row. */
const PAYER = ['v71j', 'Private', 'Payer'].join(' ');
const FIGURE = ['98', '765.43'].join(',');
const FIGURE_RE = /98,?765/;
const OWNER_EMAIL = `${P}ownera@test.local`;
/** A question with no action verb, carrying a marker so it can be looked for. */
const QUESTION = 'Why are my customers paying their invoices so late (v71j-question-marker)?';
/** What every reasoning chain the model stand-in returns concludes: the customer and the figure, by name. */
const CONCLUSION = `v71j: chase ${PAYER} for ${FIGURE} before offering new terms`;
const RAW_CONFIDENCE = 0.8;
const FALLBACK = /I encountered an issue while processing your request/;
/** The source every row KEY's event writer writes carries (KEY_OBSERVATION_SOURCE). */
const KEY_SOURCE = 'key_observation';

/** The controller's collaborators for its other routes; consciousChat reaches none of them. */
const OFF_BOUNDARY = new Set([
  'KeyCortexReasoningService', 'KeyCortexVoiceService', 'KeyCortexPersonalityService', 'KeyCortexActionsService',
  'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService', 'KeyCortexExecutorService',
  'KeyCortexContextV2Service', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service', 'KeyCortexSandboxService',
  'KeyCortexFlowStudioService', 'KeyCortexEvolutionService', 'KeyCortexPhoneService', 'KeyCortexDocumentService',
  'KeyCortexLearningService', 'KeyAutonomySafetyService', 'KeyCortexApprovalOrchestratorService',
  'KeyCortexAwarenessService',
]);

let db: any;
let app: any;
let prismaService: any;
let consciousness: any;
const outbound: string[] = [];
const warnings: string[] = [];
const errors: string[] = [];
const cache = new Map<string, string>();
let modules: Record<string, any> = {};

/** Redis's get/set/setex/del over a map (TTL ignored), as in key-cortex-conscious-answer. */
function inMemoryRedis(store: Map<string, string>) {
  const io = () => new Promise<void>((r) => setImmediate(r));
  return new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === 'get') return async (key: string) => { await io(); return store.get(key) ?? null; };
      if (prop === 'set') return async (key: string, value: unknown) => { await io(); store.set(key, String(value)); return 'OK'; };
      if (prop === 'setex') return async (key: string, _ttl: number, value: unknown) => { await io(); store.set(key, String(value)); return 'OK'; };
      if (prop === 'del') return async (...keys: string[]) => { await io(); return keys.flat().filter((k) => store.delete(k)).length; };
      return async () => null;
    },
  });
}

const CHAIN = JSON.stringify({
  steps: [{ number: 1, thought: `v71j: ${PAYER} has paid late three months running`, evidence: [], confidence: RAW_CONFIDENCE }],
  conclusion: CONCLUSION,
  confidence: RAW_CONFIDENCE,
  supportingEvidence: [],
  counterArguments: [],
});

function modelAnswer(feature: string): string {
  if (feature === 'reasoning_engine') return CHAIN;
  if (feature === 'emotion_detection') return JSON.stringify({ emotion: 'calm', intensity: 0.2, confidence: 0.7 });
  return '{}';
}

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM evidence WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_evidence WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cognition_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cortex_sessions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_cortex_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function consciousChat(user: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).post('/api/v1/cortex/conscious/chat').set(HEADER, user).send(body);
}

type EventRow = {
  id: string; business_id: string; event_type: string; subject_type: string; subject_id: string; actor_type: string;
  actor_id: string; action: string; source: string; metadata: any; before: any; after: any; session_id: string | null;
  correlation_id: string | null; evidence_ids: string[]; message_ids: string[];
};

async function eventRows(businessId: string): Promise<EventRow[]> {
  return db.$queryRawUnsafe(
    `SELECT id, business_id, event_type, subject_type, subject_id, actor_type, actor_id, action, source, metadata, before, after,
            session_id, correlation_id, evidence_ids, message_ids
       FROM business_events WHERE business_id = $1 ORDER BY created_at, id`,
    businessId,
  );
}

/** The rows `run` added to `businessId`'s business_events. */
async function rowsWrittenBy(businessId: string, run: () => Promise<unknown>): Promise<{ result: any; rows: EventRow[] }> {
  const before = new Set((await eventRows(businessId)).map((r) => r.id));
  const result = await run();
  const rows = (await eventRows(businessId)).filter((r) => !before.has(r.id));
  return { result, rows };
}

async function evidenceCount(businessId: string): Promise<number> {
  const rows: Array<{ n: number }> = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM evidence WHERE business_id = $1', businessId);
  return rows[0].n;
}

/** A conscious answer through the HTTP route, with a fresh ethical review (a cached verdict writes no new decision log). */
async function askConsciously(user: string, businessId: string) {
  consciousness.ethics.evaluationCache.clear();
  return rowsWrittenBy(businessId, () => consciousChat(user, { businessId, text: QUESTION }));
}

/** The KEY event writer over the real client, with every businessEvent delegate access recorded. */
function recordedWriter() {
  const reached: string[] = [];
  const client = new Proxy(db, {
    get: (target, prop) => {
      if (prop === 'businessEvent') reached.push('businessEvent');
      return target[prop];
    },
  });
  return { events: new modules.KeyCortexEventService({ client } as any), reached };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Logger, ValidationPipe } = await import('@nestjs/common');
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(function (this: any, message: unknown) {
    warnings.push(`${this?.context ?? ''}: ${String(message)}`);
  });
  vi.spyOn(Logger.prototype, 'error').mockImplementation(function (this: any, message: unknown) {
    errors.push(`${this?.context ?? ''}: ${String(message)}`);
  });

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const controllerModule: any = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexController } = controllerModule;
  const consciousnessModule: any = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  modules = {
    KeyCortexReasoningService: (await import('../src/modules/key-cortex/key-cortex-reasoning.service')).KeyCortexReasoningService,
    KeyCortexConversationService: (await import('../src/modules/key-cortex/key-cortex-conversation.service')).KeyCortexConversationService,
    KeyCortexVoiceService: (await import('../src/modules/key-cortex/key-cortex-voice.service')).KeyCortexVoiceService,
    KeyCortexPersonalityService: (await import('../src/modules/key-cortex/key-cortex-personality.service')).KeyCortexPersonalityService,
    KeyCortexActionsService: (await import('../src/modules/key-cortex/key-cortex-actions.service')).KeyCortexActionsService,
    KeyCortexContextService: (await import('../src/modules/key-cortex/key-cortex-context.service')).KeyCortexContextService,
    KeyCortexConnectorService: (await import('../src/modules/key-cortex/key-cortex-connector.service')).KeyCortexConnectorService,
    KeyCortexCommandService: (await import('../src/modules/key-cortex/key-cortex-command.service')).KeyCortexCommandService,
    KeyCortexExecutorService: (await import('../src/modules/key-cortex/key-cortex-executor.service')).KeyCortexExecutorService,
    KeyCortexContextV2Service: (await import('../src/modules/key-cortex/key-cortex-context-v2.service')).KeyCortexContextV2Service,
    KeyCortexInsightService: (await import('../src/modules/key-cortex/key-cortex-insight.service')).KeyCortexInsightService,
    KeyCortexMonitorV2Service: (await import('../src/modules/key-cortex/key-cortex-monitor-v2.service')).KeyCortexMonitorV2Service,
    KeyCortexSandboxService: (await import('../src/modules/key-cortex/key-cortex-sandbox.service')).KeyCortexSandboxService,
    KeyCortexFlowStudioService: (await import('../src/modules/key-cortex/key-cortex-flow-studio.service')).KeyCortexFlowStudioService,
    KeyCortexEvolutionService: (await import('../src/modules/key-cortex/key-cortex-evolution.service')).KeyCortexEvolutionService,
    KeyCortexPhoneService: (await import('../src/modules/key-cortex/key-cortex-phone.service')).KeyCortexPhoneService,
    KeyCortexDocumentService: (await import('../src/modules/key-cortex/key-cortex-document.service')).KeyCortexDocumentService,
    KeyCortexLearningService: (await import('../src/modules/key-cortex/key-cortex-learning.service')).KeyCortexLearningService,
    KeyAutonomySafetyService: (await import('../src/modules/key-autonomy/key-autonomy-safety.service')).KeyAutonomySafetyService,
    KeyCortexApprovalOrchestratorService: (await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service')).KeyCortexApprovalOrchestratorService,
    KeyCortexConsciousnessService: consciousnessModule.KeyCortexConsciousnessService,
    KeyCortexSessionService: (await import('../src/modules/key-cortex/key-cortex-session.service')).KeyCortexSessionService,
    KeyCortexAwarenessService: (await import('../src/modules/key-cortex/key-cortex-awareness.service')).KeyCortexAwarenessService,
    KeyCortexEventService: (await import('../src/modules/key-cortex/key-cortex-event.service')).KeyCortexEventService,
    KeyCortexEvidenceService: (await import('../src/modules/key-cortex/key-cortex-evidence.service')).KeyCortexEvidenceService,
    KeyCortexMetacognitionService: (await import('../src/modules/key-cortex/key-cortex-metacognition.service')).KeyCortexMetacognitionService,
    KeyCortexEmotionService: (await import('../src/modules/key-cortex/key-cortex-emotion.service')).KeyCortexEmotionService,
    KeyCortexReasoningEngineService: (await import('../src/modules/key-cortex/key-cortex-reasoning-engine.service')).KeyCortexReasoningEngineService,
    KeyCortexReflectionService: (await import('../src/modules/key-cortex/key-cortex-reflection.service')).KeyCortexReflectionService,
    KeyCortexIntuitionService: (await import('../src/modules/key-cortex/key-cortex-intuition.service')).KeyCortexIntuitionService,
    KeyCortexCreativityService: (await import('../src/modules/key-cortex/key-cortex-creativity.service')).KeyCortexCreativityService,
    KeyCortexEthicsService: (await import('../src/modules/key-cortex/key-cortex-ethics.service')).KeyCortexEthicsService,
    KeyCortexTemporalReasoningService: (await import('../src/modules/key-cortex/key-cortex-temporal-reasoning.service')).KeyCortexTemporalReasoningService,
    KeyCortexGenomeBridgeService: (await import('../src/modules/key-cortex/key-cortex-genome-bridge.service')).KeyCortexGenomeBridgeService,
    KeyCortexInteroceptionService: (await import('../src/modules/key-cortex/key-cortex-interoception.service')).KeyCortexInteroceptionService,
    KeyCortexEndocrineService: (await import('../src/modules/key-cortex/key-cortex-endocrine.service')).KeyCortexEndocrineService,
    UnifiedMemoryRetrievalService: (await import('../src/modules/key-cortex/unified-memory-retrieval.service')).UnifiedMemoryRetrievalService,
    GenomeEvidenceService: (await import('../src/modules/business-genome/key-genome/genome-evidence.service')).GenomeEvidenceService,
  };
  const M = modules;

  // tsc emits these parameter types for the controller (emitDecoratorMetadata); vitest's esbuild does not.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      M.KeyCortexReasoningService, M.KeyCortexConversationService, M.KeyCortexVoiceService, M.KeyCortexPersonalityService,
      M.KeyCortexActionsService, M.KeyCortexContextService, M.KeyCortexConnectorService, M.KeyCortexCommandService,
      M.KeyCortexExecutorService, M.KeyCortexContextV2Service, M.KeyCortexInsightService, M.KeyCortexMonitorV2Service,
      M.KeyCortexSandboxService, M.KeyCortexFlowStudioService, M.KeyCortexEvolutionService, M.KeyCortexPhoneService,
      M.KeyCortexDocumentService, M.KeyCortexLearningService, M.KeyAutonomySafetyService, M.KeyCortexApprovalOrchestratorService,
      M.KeyCortexConsciousnessService, M.KeyCortexSessionService, M.KeyCortexAwarenessService,
    ], KeyCortexController);
  }
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, 'consciousChat')) {
    Reflect.defineMetadata('design:paramtypes', [controllerModule.ConsciousChatDto, Object], KeyCortexController.prototype, 'consciousChat');
  }

  const aiUsage = {
    trackAndComplete: async (_businessId: string, _userId: unknown, feature: string) => (
      { content: modelAnswer(feature), usage, model: 'v71j-stand-in', provider: 'v71j-stand-in' }
    ),
  };
  const modelGateway = {
    complete: async () => ({ content: '{}', usage, model: 'v71j-stand-in', provider: 'v71j-stand-in' }),
  };
  const noOrgans = { listAdapters: () => [] };
  const noInsights = { generateInsights: async () => [] };

  const buildConsciousness = (prisma: any) => {
    const redis = inMemoryRedis(cache) as any;
    const events = new M.KeyCortexEventService(prisma);
    const evidence = new M.KeyCortexEvidenceService(prisma);
    const context = new M.KeyCortexContextV2Service(prisma, redis);
    const genomeBridge = new M.KeyCortexGenomeBridgeService(prisma, events, evidence);
    return new M.KeyCortexConsciousnessService(
      new M.KeyCortexEmotionService(prisma, aiUsage as any),
      new M.KeyCortexReasoningEngineService(aiUsage as any, context),
      new M.KeyCortexReflectionService(prisma, events, noInsights as any, genomeBridge, modelGateway as any, aiUsage as any),
      new M.KeyCortexIntuitionService(prisma, events, context, modelGateway as any, aiUsage as any),
      new M.KeyCortexMetacognitionService(prisma, events, evidence),
      new M.KeyCortexCreativityService(prisma, modelGateway as any, aiUsage as any, context, noInsights as any),
      new M.KeyCortexEthicsService(prisma, events),
      new M.KeyCortexTemporalReasoningService(prisma, context),
      context,
      genomeBridge,
      modelGateway,
      new M.KeyCortexPersonalityService(),
      events,
      prisma,
      new M.KeyCortexInteroceptionService(noOrgans as any),
      new M.KeyCortexEndocrineService(prisma),
    );
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      {
        provide: M.KeyCortexConversationService,
        useFactory: (prisma: any) => new M.KeyCortexConversationService(prisma, inMemoryRedis(cache) as any),
        inject: [PrismaService],
      },
      {
        provide: M.KeyCortexSessionService,
        useFactory: (prisma: any) => new M.KeyCortexSessionService(prisma, inMemoryRedis(cache) as any),
        inject: [PrismaService],
      },
      { provide: M.KeyCortexConsciousnessService, useFactory: buildConsciousness, inject: [PrismaService] },
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  consciousness = moduleRef.get(M.KeyCortexConsciousnessService);
  prismaService = moduleRef.get(PrismaService);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  await db.user.create({ data: { id: ID.ownerA, email: OWNER_EMAIL, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerb@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V71J Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V71J Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  const [firstName, ...rest] = PAYER.split(' ');
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName, lastName: rest.join(' '), displayName: PAYER } as any });
  await db.invoice.create({
    data: {
      id: ID.invoiceA, businessId: ID.bizA, contactId: ID.contactA, invoiceNumber: `${P}INV-1`, total: 98765.43,
      status: 'SENT', dueDate: new Date(Date.now() - 20 * 86_400_000),
    } as any,
  });

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    outbound.push(typeof input === 'string' ? input : String(input?.url ?? input));
    throw new Error('v71j: outbound traffic is refused in this suite');
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

/** What a KEY observation row looks like on the real columns, whatever its event. */
function expectKeyRow(row: EventRow, businessId: string) {
  expect(row.business_id).toBe(businessId);
  expect(row.source).toBe(KEY_SOURCE);
  expect(row.actor_type).toBe('ai');
  expect(row.metadata).toEqual(expect.objectContaining({ module: expect.any(String) }));
  expect(row.before).toBeNull();
  expect(row.after).toBeNull();
}

/** Every value that must never reach a KEY row, built at runtime. */
function personalOrSecret(): Array<string | RegExp> {
  return [QUESTION, 'v71j-question-marker', CONCLUSION, PAYER, 'Private Payer', FIGURE_RE, OWNER_EMAIL, ID.ownerA];
}

function expectNothingPersonal(rows: EventRow[]) {
  const text = JSON.stringify(rows);
  for (const needle of personalOrSecret()) {
    if (typeof needle === 'string') expect(text, `a KEY row carries ${needle}`).not.toContain(needle);
    else expect(text, `a KEY row carries ${needle}`).not.toMatch(needle);
  }
}

describe('fixture sanity (real rows)', () => {
  it('two businesses, each with its owner; business A holds one overdue invoice owed by a named customer', async () => {
    expect(await db.membership.findMany({ where: { businessId: ID.bizA }, select: { userId: true, role: true } })).toEqual([{ userId: ID.ownerA, role: 'OWNER' }]);
    expect(await db.membership.findMany({ where: { businessId: ID.bizB }, select: { userId: true, role: true } })).toEqual([{ userId: ID.ownerB, role: 'OWNER' }]);
    const invoices: any[] = await db.$queryRawUnsafe('SELECT total::float AS total, contact_id FROM invoices WHERE business_id = $1', ID.bizA);
    expect(invoices).toEqual([{ total: 98765.43, contact_id: ID.contactA }]);
    expect(await eventRows(ID.bizA)).toEqual([]);
  });

  it('the business_events table has the columns the writer names, and none of the ones it used to', async () => {
    const columns: Array<{ column_name: string }> = await db.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'business_events'`,
    );
    const names = columns.map((c) => c.column_name);
    for (const real of ['event_type', 'subject_type', 'subject_id', 'actor_type', 'actor_id', 'action', 'source', 'metadata', 'session_id', 'correlation_id']) {
      expect(names, real).toContain(real);
    }
    for (const missing of ['type', 'module', 'payload', 'genome_signal', 'genome_impact', 'user_id', 'parent_event_id']) {
      expect(names, missing).not.toContain(missing);
    }
  });
});

describe('V71J-01 POST conscious/chat keeps KEY\'s observations of the answer in business_events, one row each, on the real columns', () => {
  it('RED-BEFORE: the ethics decision log, the conscious-process log and the capability claim are each one row of the asking business', async () => {
    const from = { warnings: warnings.length, errors: errors.length };
    const { result: res, rows } = await askConsciously(ID.ownerA, ID.bizA);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.text).not.toMatch(FALLBACK);
    expect(res.body.text).toContain(CONCLUSION);

    const summary = rows.map((r) => `${r.event_type} ${r.actor_id} ${r.action} ${r.subject_type}/${r.subject_id}`).sort();
    expect(summary).toEqual([
      'ACTION_EXECUTED metacognition capability_tracked capability/conscious_response',
      'DECISION_MADE consciousness_orchestrator conscious_process_complete key_cortex/key_cortex',
      'DECISION_MADE ethics decision key_cortex/key_cortex',
    ]);
    for (const row of rows) expectKeyRow(row, ID.bizA);

    const ethics = rows.find((r) => r.actor_id === 'ethics')!;
    expect(ethics.metadata).toMatchObject({ module: 'key_cortex', decisionKind: 'ethical_evaluation', genomeSignal: true });
    expect(typeof ethics.metadata.confidence).toBe('number');

    const process = rows.find((r) => r.actor_id === 'consciousness_orchestrator')!;
    expect(process.metadata).toMatchObject({
      module: 'key_cortex', reasoningMode: expect.any(String), actionCount: expect.any(Number), requiresApproval: false,
      ethicalPermitted: expect.any(Boolean), genomeSignal: true,
    });
    expect(process.metadata.layersUsed).toEqual(['L1_emotion', 'L2_reasoning', 'L4_intuition', 'L5_metacognition', 'L7_ethics', 'L8_temporal']);

    const capability = rows.find((r) => r.actor_id === 'metacognition')!;
    expect(capability.metadata).toEqual({
      module: 'key_cortex', claimKind: 'capability', capability: 'conscious_response', result: 'success', confidence: 1,
      claimType: 'TASK_COMPLETED',
    });

    // Nothing failed on the way: no log, decision or claim write was refused.
    const fresh = warnings.slice(from.warnings).concat(errors.slice(from.errors));
    expect(fresh.filter((w) => /not written|refused|PrismaClient|Invalid invocation|Unknown argument/i.test(w)), fresh.join('\n')).toEqual([]);
    // The cortex claim never reaches the business's proof list (V61-07's contract).
    expect(await evidenceCount(ID.bizA)).toBe(0);
    expect(outbound).toEqual([]);
  });

  it('RED-BEFORE: a second answer adds the same three rows again, no more (one row per event)', async () => {
    const { result: res, rows } = await askConsciously(ID.ownerA, ID.bizA);
    expect(res.status).toBe(200);
    expect(rows.map((r) => `${r.actor_id} ${r.action}`).sort()).toEqual([
      'consciousness_orchestrator conscious_process_complete',
      'ethics decision',
      'metacognition capability_tracked',
    ]);
  });
});

describe('V71J-02 KEY\'s rows carry no personal data and no secret', () => {
  it('RED-BEFORE: no row of an answer carries the question, the conclusion, the customer, the figure or the owner; the ethics row names the free text it withheld', async () => {
    const { result: res, rows } = await askConsciously(ID.ownerA, ID.bizA);
    expect(res.status).toBe(200);
    // The answer itself still names them (the owner may read them): only KEY's own records leave them out.
    expect(res.body.text).toContain(PAYER);
    expect(rows.length).toBe(3);
    expectNothingPersonal(rows);
    const ethics = rows.find((r) => r.actor_id === 'ethics')!;
    expect(ethics.metadata.withheld).toEqual(['decision', 'rationale']);
  });

  it('RED-BEFORE: the writer keeps only allowed fields with numbers, booleans and short tokens; a secret, an email, a phone, a JWT and free text are withheld by name', async () => {
    const { events } = recordedWriter();
    const secret = ['sk', 'live', 'v71j0000000000000000000000'].join('_');
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ2NzFqIn0', 'c2lnbmF0dXJl'].join('.');
    const phone = ['+1', '868', '555', '0100'].join(' ');
    const { result, rows } = await rowsWrittenBy(ID.bizA, () => events.logEvent({
      businessId: ID.bizA,
      type: 'INSIGHT_GENERATED',
      module: 'crm',
      source: 'v71j_probe',
      action: 'v71j_probe_insight',
      payload: {
        category: 'revenue',
        confidence: 0.75,
        severity: secret,
        trend: OWNER_EMAIL,
        signalId: phone,
        patternType: jwt,
        insight: `${PAYER} owes ${FIGURE}`,
        details: { riskScore: 0.4, recommendedInvestigation: `call ${PAYER}`, matchedEntityType: 'contact', apiKey: secret },
        dnaSections: ['marketing', OWNER_EMAIL, 3],
      },
      genomeSignal: true,
      correlationId: `${P}corr_probe`,
    }));
    expect(result?.id).toBeTruthy();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expectKeyRow(row, ID.bizA);
    expect(row.event_type).toBe('INSIGHT_GENERATED');
    expect(row.actor_id).toBe('v71j_probe');
    expect(row.action).toBe('v71j_probe_insight');
    expect(row.correlation_id).toBe(`${P}corr_probe`);
    expect(row.metadata).toEqual({
      module: 'crm',
      category: 'revenue',
      confidence: 0.75,
      details: { riskScore: 0.4, matchedEntityType: 'contact' },
      dnaSections: ['marketing', 3],
      genomeSignal: true,
      withheld: ['details.apiKey', 'details.recommendedInvestigation', 'dnaSections[1]', 'insight', 'patternType', 'severity', 'signalId', 'trend'],
    });
    const text = JSON.stringify(row);
    for (const needle of [secret, jwt, phone, OWNER_EMAIL, PAYER, FIGURE]) expect(text, needle).not.toContain(needle);
  });
});

describe('V71J-03 another business never reads KEY\'s observations', () => {
  it('RED-BEFORE: the readers are business-scoped: getEvents, getEventChain and getEventStats answer business A\'s rows to A and none to B', async () => {
    const events = new modules.KeyCortexEventService(prismaService);
    const rowsA = await eventRows(ID.bizA);
    const keyRowsA = rowsA.filter((r) => r.source === KEY_SOURCE);
    expect(keyRowsA.length).toBeGreaterThanOrEqual(10);

    const decisionsA = await events.getEvents(ID.bizA, { type: 'DECISION_MADE', limit: 100 });
    expect(decisionsA.length).toBe(keyRowsA.filter((r) => r.event_type === 'DECISION_MADE').length);
    expect(decisionsA.every((e: any) => e.businessId === ID.bizA && e.eventType === 'DECISION_MADE')).toBe(true);
    // Newest first, and the limit is a LIMIT, not a column.
    const times = decisionsA.map((e: any) => new Date(e.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await events.getEvents(ID.bizA, { type: 'DECISION_MADE', limit: 2 })).toHaveLength(2);
    // The organ filter (the `source` it was given) is the actor.
    const capabilityA = await events.getEvents(ID.bizA, { type: 'ACTION_EXECUTED', source: 'metacognition' });
    expect(capabilityA.length).toBe(3);

    expect(await events.getEvents(ID.bizB, { limit: 1000 })).toEqual([]);
    expect(await events.getEvents(ID.bizB, { type: 'DECISION_MADE' })).toEqual([]);

    const chainA = await events.getEventChain(ID.bizA, `${P}corr_probe`);
    expect(chainA.map((e: any) => e.action)).toEqual(['v71j_probe_insight']);
    expect(await events.getEventChain(ID.bizB, `${P}corr_probe`)).toEqual([]);

    const statsA = await events.getEventStats(ID.bizA, 'day');
    expect(statsA).toMatchObject({ DECISION_MADE: decisionsA.length, ACTION_EXECUTED: 3, INSIGHT_GENERATED: 1 });
    expect(await events.getEventStats(ID.bizB, 'day')).toEqual({});
  });

  it('RED-BEFORE: business B\'s owner asking through POST conscious/chat writes B\'s rows only, and B\'s self-model reads none of A\'s', async () => {
    const before = (await eventRows(ID.bizA)).length;
    const { result: res, rows } = await askConsciously(ID.ownerB, ID.bizB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(rows).toHaveLength(3);
    for (const row of rows) expectKeyRow(row, ID.bizB);
    expect((await eventRows(ID.bizA)).length).toBe(before);

    // A failed capability in A: B's action success rate would fall if B read A's claims.
    await consciousness.metacognition.trackCapability(ID.bizA, 'conscious_response', 'failure');
    const selfA = await consciousness.metacognition.buildSelfModel(ID.bizA);
    const selfB = await consciousness.metacognition.buildSelfModel(ID.bizB);
    expect(selfA.actionSuccessRate).toBe(0.75);
    expect(selfB.actionSuccessRate).toBe(1);
    expect((await consciousness.metacognition.getTrackRecord(ID.bizB)).totalRecommendations).toBe(0);
  });
});

describe('V71J-04 a write that names no business or no known event type is refused by name before any query', () => {
  it('RED-BEFORE: the step log the reasoning and query pipelines send (no business, no type) is refused before the businessEvent delegate is reached', async () => {
    const { events, reached } = recordedWriter();
    let failure: any;
    try {
      // KeyCortexReasoningService.logEvent / KeyCortexQueryPipelineService.logEvent send exactly this shape.
      await events.logEvent({ correlationId: `${P}corr_step`, step: 'parse', data: { query: QUESTION }, timestamp: new Date(), service: 'KeyCortexReasoningService' } as any);
    } catch (e) {
      failure = e;
    }
    expect(failure?.name).toBe('KeyObservationRefusedError');
    expect(String(failure?.message)).toMatch(/business/);
    expect(reached).toEqual([]);
    expect(String(failure?.message)).not.toContain('v71j-question-marker');
  });

  it('RED-BEFORE: an event type business_events is not written with is refused before any query', async () => {
    const { events, reached } = recordedWriter();
    await expect(events.logEvent({
      businessId: ID.bizA, type: 'NOT_A_TYPE' as any, module: 'key_cortex', source: 'v71j_probe', action: 'probe', payload: {},
    })).rejects.toMatchObject({ name: 'KeyObservationRefusedError' });
    expect(reached).toEqual([]);
  });

  it('RED-BEFORE: the gateway\'s emit for no business writes nothing and attempts no write; for a business it keeps that a chat completed, never the message or who typed it', async () => {
    const { events, reached } = recordedWriter();
    const warnFrom = warnings.length;
    const message = `v71j-question-marker: tell me about ${PAYER}`;
    events.emit('key.chat.completed', { userId: ID.ownerA, message, timestamp: new Date() });
    await new Promise((r) => setTimeout(r, 300));
    expect(reached).toEqual([]);
    expect(warnings.slice(warnFrom).filter((w) => /Emit failed/.test(w))).toEqual([]);

    const { rows } = await rowsWrittenBy(ID.bizA, async () => {
      events.emit('key.chat.completed', { userId: ID.ownerA, businessId: ID.bizA, message, timestamp: new Date() });
      for (let i = 0; i < 20 && (await eventRows(ID.bizA)).every((r) => r.action !== 'key.chat.completed'); i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    expect(rows).toHaveLength(1);
    expectKeyRow(rows[0], ID.bizA);
    expect(rows[0]).toMatchObject({ event_type: 'SYSTEM_EVENT', actor_id: 'gateway', action: 'key.chat.completed' });
    expect(rows[0].metadata).toEqual({ module: 'gateway', withheld: ['message', 'timestamp', 'userId'] });
    expectNothingPersonal(rows);
    expect(JSON.stringify(rows)).not.toContain(message);
  });
});

describe('V71J-05 KEY\'s cortex claims are kept in business_events (D-220)', () => {
  const patternClaim = () => ({
    type: 'pattern_detection',
    description: `KEY detected revenue pattern: ${PAYER} pays ${FIGURE} late`,
    source: 'key_cortex',
    metadata: { patternId: `${P}pattern_1`, confidence: 0.82, severity: 'high', recommendation: `call ${PAYER}` },
  });
  const outcomeClaim = () => ({
    type: 'action_outcome',
    description: `KEY executed send_invoice_reminder: emailed ${OWNER_EMAIL}`,
    source: 'key_cortex',
    metadata: { correlationId: `${P}corr_outcome`, actionType: 'send_invoice_reminder', result: { to: OWNER_EMAIL } },
  });

  it('RED-BEFORE: trackCapability writes its claim once, in business_events, and nothing in evidence', async () => {
    const { rows } = await rowsWrittenBy(ID.bizA, () => consciousness.metacognition.trackCapability(ID.bizA, 'forecasting', 'partial'));
    expect(rows).toHaveLength(1);
    expectKeyRow(rows[0], ID.bizA);
    expect(rows[0]).toMatchObject({
      event_type: 'ACTION_EXECUTED', subject_type: 'capability', subject_id: 'forecasting', actor_id: 'metacognition', action: 'capability_tracked',
    });
    expect(rows[0].metadata).toEqual({
      module: 'key_cortex', claimKind: 'capability', capability: 'forecasting', result: 'partial', confidence: 0.5, claimType: 'TASK_COMPLETED',
    });
    expect(await evidenceCount(ID.bizA)).toBe(0);
  });

  it('RED-BEFORE: the genome bridge\'s pattern-detection and action-outcome claims land in business_events without the genome evidence store, free text withheld', async () => {
    const M = modules;
    const bridge = new M.KeyCortexGenomeBridgeService(prismaService, new M.KeyCortexEventService(prismaService), new M.KeyCortexEvidenceService(prismaService));
    const { rows } = await rowsWrittenBy(ID.bizA, async () => {
      await bridge.createEvidence(ID.bizA, patternClaim());
      await bridge.createEvidence(ID.bizA, outcomeClaim());
    });
    expect(rows.map((r) => `${r.event_type} ${r.subject_type}/${r.subject_id} ${r.actor_id} ${r.action}`)).toEqual([
      `INSIGHT_GENERATED pattern/${P}pattern_1 key_cortex claim_recorded`,
      'ACTION_EXECUTED cortex_action/send_invoice_reminder key_cortex claim_recorded',
    ]);
    for (const row of rows) expectKeyRow(row, ID.bizA);
    expect(rows[0].metadata).toEqual({
      module: 'key_cortex', claimKind: 'pattern_detection', patternId: `${P}pattern_1`, confidence: 0.82, severity: 'high',
      withheld: ['description', 'recommendation'],
    });
    expect(rows[1].correlation_id).toBe(`${P}corr_outcome`);
    expect(rows[1].metadata).toEqual({
      module: 'key_cortex', claimKind: 'action_outcome', actionType: 'send_invoice_reminder',
      withheld: ['description', 'result.to'],
    });
    expectNothingPersonal(rows);
    expect(await evidenceCount(ID.bizA)).toBe(0);
  });

  it('RED-BEFORE: with the production wiring (the genome evidence store present) the claim still lands in business_events, once, beside the genome evidence', async () => {
    const M = modules;
    const genomeEvidence = new M.GenomeEvidenceService(prismaService);
    // Positional, in the constructor's order: prisma, events, evidence, ranker, autonomy gate, opportunity
    // detector, cross-domain, signal, module readiness, genome evidence.
    const bridge = new M.KeyCortexGenomeBridgeService(
      prismaService, new M.KeyCortexEventService(prismaService), new M.KeyCortexEvidenceService(prismaService),
      undefined, undefined, undefined, undefined, undefined, undefined, genomeEvidence,
    );
    const genomeBefore: Array<{ n: number }> = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM genome_evidence WHERE business_id = $1', ID.bizA);
    const { rows } = await rowsWrittenBy(ID.bizA, () => bridge.createEvidence(ID.bizA, patternClaim()));
    const genomeAfter: Array<{ n: number }> = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM genome_evidence WHERE business_id = $1', ID.bizA);
    expect(genomeAfter[0].n).toBe(genomeBefore[0].n + 1);
    expect(rows.map((r) => `${r.event_type} ${r.subject_type}/${r.subject_id} ${r.action}`)).toEqual([`INSIGHT_GENERATED pattern/${P}pattern_1 claim_recorded`]);
    expectNothingPersonal(rows);
  });

  it('RED-BEFORE: an action outcome the bridge reports is logged once (not twice), with its claim', async () => {
    const M = modules;
    const bridge = new M.KeyCortexGenomeBridgeService(prismaService, new M.KeyCortexEventService(prismaService), new M.KeyCortexEvidenceService(prismaService));
    const { rows } = await rowsWrittenBy(ID.bizA, () => bridge.reportActionOutcome(ID.bizA, {
      actionId: 'send_invoice_reminder', module: 'crm', action: 'send_invoice_reminder', result: 'success', description: `emailed ${OWNER_EMAIL}`,
    }));
    expect(rows.map((r) => `${r.event_type} ${r.subject_type}/${r.subject_id} ${r.action}`).sort()).toEqual([
      'ACTION_EXECUTED cortex_action/send_invoice_reminder claim_recorded',
      'ACTION_EXECUTED key_cortex/crm send_invoice_reminder',
    ]);
    const outcome = rows.find((r) => r.action === 'send_invoice_reminder')!;
    expect(outcome.metadata).toMatchObject({ module: 'crm', result: 'success', executionTimeMs: 0 });
    expectNothingPersonal(rows);
    expect(JSON.stringify(rows)).not.toContain(OWNER_EMAIL);
  });
});

describe('V71J-06 the readers that now work read only KEY\'s own observations, of their business', () => {
  it('RED-BEFORE: the self-model, the knowledge gaps and the track record build on the real database', async () => {
    const meta = consciousness.metacognition;
    const self = await meta.buildSelfModel(ID.bizA);
    expect(self.capabilities.find((c: any) => c.name === 'forecasting')).toMatchObject({ successRate: 0 });
    expect(Array.isArray(await meta.identifyKnowledgeGaps(ID.bizA))).toBe(true);
    expect(await meta.getTrackRecord(ID.bizA)).toEqual({ totalRecommendations: 0, accepted: 0, rejected: 0, accuracy: 0 });
  });

  // Not red before: getEvents threw there, so reflection read the table once. Now that it answers, the table read
  // and KEY's own read overlap, and each row must still be read once.
  it("reflection's recent-events read carries each of KEY's rows once (getEvents now answers)", async () => {
    const recent: Array<{ id: string }> = await (consciousness.reflection as any).queryRecentBusinessEvents(ID.bizA, 24);
    const ids = recent.map((e) => e.id);
    expect(ids.length).toBe((await eventRows(ID.bizA)).length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Red before only because KEY's rows did not exist; the exclusion itself is mutation-checked once they do.
  it("RED-BEFORE: KEY's own bookkeeping is not taken as an observed business event in the prompt's memory; another writer's row still is", async () => {
    // A business row another writer keeps (the analytics adapter's `track`, also source key_cortex).
    await db.businessEvent.create({
      data: {
        id: `${P}ev_analytics`, businessId: ID.bizA, eventType: 'page_view', subjectType: 'contact', subjectId: ID.contactA,
        actorType: 'ai', actorId: 'analytics', action: 'track', source: 'key_cortex', metadata: {},
      },
    });
    const memory = new modules.UnifiedMemoryRetrievalService(prismaService, { search: async () => [] } as any);
    const fragments = await memory.retrieveEpisodicContext(ID.bizA, { limit: 200 });
    const businessEventIds = fragments.filter((f: any) => f.sourceType === 'business_event').map((f: any) => f.id);
    const keyIds = (await eventRows(ID.bizA)).filter((r) => r.source === KEY_SOURCE).map((r) => r.id);
    expect(keyIds.length).toBeGreaterThan(0);
    expect(businessEventIds).toContain(`${P}ev_analytics`);
    for (const id of keyIds) expect(businessEventIds, id).not.toContain(id);
  });
});
