/**
 * V1-70 W1F-KEY-EVIDENCE-WRITE — a deliberative KEY answer reaches the person
 * who asked, on a REAL database (review UCS-COR-3, latent defect; wave 1
 * USAGE-COUNT-SCRIPT open issue).
 *
 * The reported defect: KeyCortexEvidenceService.createEvidence writes claim,
 * claimType, proof, proofHash, confidence, source, relatedModule and others
 * into `evidence`, which has none of those columns, so the real client refuses
 * it (PrismaClientValidationError). processConsciously step 11 awaits
 * KeyCortexMetacognitionService.trackCapability, which awaits that write.
 *
 * What a real database shows (this suite's RED runs): the pipeline does not get
 * as far as step 11. Five of its calls fail there, every time:
 *   S6   metacognition.calibrateConfidence: KeyCortexEventService.getEvents
 *        filters business_events on `type` (the column is event_type), then
 *        findEvidence puts `limit` in the WHERE and orders by a createdAt the
 *        evidence table does not have;
 *   S7   ethics.evaluateRecommendation: the evaluation is made and cached, then
 *        its decision log (KeyCortexEventService.logDecision -> logEvent)
 *        fails and takes the evaluation with it;
 *   S10  logConsciousProcess: KeyCortexEventService.logEvent writes type,
 *        module and payload (the columns are event_type, subject_*, actor_*,
 *        metadata);
 *   S11  trackCapability: the same logEvent, then createEvidence;
 *   and the self-model read for the snapshot (getEvents on `type` again).
 * The pipeline's catch-all turns the first of them into createFallbackResponse:
 * "I encountered an issue while processing your request ... Could you try
 * rephrasing your question?". POST conscious/chat answers that, and
 * FlowOrchestratorService.deliberate (the /app/key/chat deliberative path)
 * hands it to the person as KEY's answer. Every deliberative question.
 *
 * Required, and pinned here:
 *   V70H-01  POST /api/v1/cortex/conscious/chat on a deliberative question
 *            answers with the reasoned answer and all twelve phases; the
 *            capability is still recorded in business_events (the row
 *            upsertCapabilityRecord writes with real columns); nothing lands
 *            in `evidence`.
 *   V70H-02  each of those calls failing costs the answer that call's
 *            contribution and nothing more: the answer is the reasoned one,
 *            a warning names the step, an uncalibrated confidence says so in
 *            the answer, and an ethical evaluation whose decision log was not
 *            written still stands (a failure in the reasoning itself still
 *            answers with the fallback).
 *   V70H-03  the evidence writer never sends a column the table does not have:
 *            a cortex claim is refused by name before any query (writing it
 *            into the real columns would put KEY's bookkeeping in the
 *            business's proof list and the module usage count, which
 *            v1-module-usage-count V61-07 pins as holding only rows
 *            EvidenceService.submit wrote).
 *   V70H-04  the evidence reader asks only for real columns: findEvidence
 *            returns the business's own evidence, newest first, limited.
 *
 * WHAT IS REAL: PrismaService over DATABASE_URL, AuthGuard, BusinessGuard,
 * TenantInterceptor and the Prisma tenant extension, the production
 * GlobalHttpExceptionFilter and ValidationPipe, KeyCortexController,
 * KeyCortexSessionService and KeyCortexConversationService (session rows), and
 * the whole consciousness graph: KeyCortexConsciousnessService with the real
 * emotion, reasoning engine, reflection, intuition, metacognition, creativity,
 * ethics, temporal reasoning, context v2, genome bridge, personality, event,
 * evidence, interoception and endocrine services.
 * Stand-ins: identity attachment (a test middleware reads `x-v70h-user` and
 * attaches the seeded user row, as AuthMiddleware does after token
 * verification); the model (AiUsageService.trackAndComplete answers at once and
 * records the feature: one reasoning chain for 'reasoning_engine', a calm
 * reading for 'emotion_detection', '{}' otherwise; ModelGatewayService.complete
 * likewise; no model or provider is called); Redis (an in-memory get/set/setex/
 * del map); the organ registrar (no organs registered); KeyCortexInsightService
 * (no insights); globalThis.fetch (recorded and refused; the suite asserts it
 * was never called); and the collaborators the controller holds for its other
 * routes (an allow-listed mocker). Vitest's esbuild transform emits no
 * parameter types, so the suite writes the ones tsc emits for the controller's
 * constructor and consciousChat, as key-cortex-actor-binding does.
 *
 * Every seeded row carries the `v70h_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = 'v70h_';
const HEADER = 'x-v70h-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  /** Holds evidence of its own: findEvidence for `biz` must never return it. */
  bizOther: `${P}bizOther`,
  evOld: `${P}ev_old`,
  evNew: `${P}ev_new`,
  evOther: `${P}ev_other`,
};

/** A question with no action verb: FlowOrchestratorService.shouldDeliberate routes it to processConsciously. */
const QUESTION = 'Why are my customers paying their invoices so late?';
/** What every reasoning chain the model stand-in returns concludes. */
const CONCLUSION = 'v70h: chase the three oldest overdue invoices before offering new terms';
const RAW_CONFIDENCE = 0.8;
const FALLBACK = /I encountered an issue while processing your request/;

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
let consciousness: any;
let TOTAL_CONSCIOUS_PHASES = 0;
/** Every model request the stand-ins answered, by feature (no model is called). */
const modelCalls: string[] = [];
/** Every globalThis.fetch the process attempted during the suite (refused). */
const outbound: string[] = [];
/** Logger.warn and Logger.error lines, with the logger's context. */
const warnings: string[] = [];
const errors: string[] = [];
const cache = new Map<string, string>();

/** Redis's get/set/setex/del over a map (TTL ignored), as in key-cortex-actor-binding. */
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

/** One reasoning chain, whatever the mode: the engine parses it as JSON. */
const CHAIN = JSON.stringify({
  steps: [{ number: 1, thought: 'v70h: the late payers are the same three accounts each month', evidence: [], confidence: RAW_CONFIDENCE }],
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
    `DELETE FROM cortex_sessions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_cortex_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** A session processConsciously accepts: the six fields it reads, as FlowOrchestratorService.deliberate builds it. */
function deliberateSession() {
  const now = new Date();
  return {
    id: `${P}session_${now.getTime()}`, businessId: ID.biz, userId: ID.owner, status: 'active', persona: 'jarvis',
    voice: 'default', mood: 'neutral', preferredProvider: 'openai', messages: [], createdAt: now, updatedAt: now, lastAccessedAt: now,
  };
}

async function evidenceRows(businessId: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await db.$queryRawUnsafe('SELECT id FROM evidence WHERE business_id = $1 ORDER BY id', businessId);
  return rows.map((r) => r.id);
}

async function capabilityRows(): Promise<number> {
  const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM business_events WHERE business_id = $1 AND action = 'capability_tracked' AND subject_id = 'conscious_response'`,
    ID.biz,
  );
  return rows[0].n;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
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
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const consciousnessModule: any = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexConsciousnessService } = consciousnessModule;
  TOTAL_CONSCIOUS_PHASES = consciousnessModule.TOTAL_CONSCIOUS_PHASES;
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');
  // The consciousness graph.
  const { KeyCortexEventService } = await import('../src/modules/key-cortex/key-cortex-event.service');
  const { KeyCortexEvidenceService } = await import('../src/modules/key-cortex/key-cortex-evidence.service');
  const { KeyCortexMetacognitionService } = await import('../src/modules/key-cortex/key-cortex-metacognition.service');
  const { KeyCortexEmotionService } = await import('../src/modules/key-cortex/key-cortex-emotion.service');
  const { KeyCortexReasoningEngineService } = await import('../src/modules/key-cortex/key-cortex-reasoning-engine.service');
  const { KeyCortexReflectionService } = await import('../src/modules/key-cortex/key-cortex-reflection.service');
  const { KeyCortexIntuitionService } = await import('../src/modules/key-cortex/key-cortex-intuition.service');
  const { KeyCortexCreativityService } = await import('../src/modules/key-cortex/key-cortex-creativity.service');
  const { KeyCortexEthicsService } = await import('../src/modules/key-cortex/key-cortex-ethics.service');
  const { KeyCortexTemporalReasoningService } = await import('../src/modules/key-cortex/key-cortex-temporal-reasoning.service');
  const { KeyCortexGenomeBridgeService } = await import('../src/modules/key-cortex/key-cortex-genome-bridge.service');
  const { KeyCortexInteroceptionService } = await import('../src/modules/key-cortex/key-cortex-interoception.service');
  const { KeyCortexEndocrineService } = await import('../src/modules/key-cortex/key-cortex-endocrine.service');

  // The production build (tsc, emitDecoratorMetadata) records the constructor
  // parameter types Nest injects by; vitest's esbuild transform does not. This
  // writes exactly what tsc emits (and leaves the class alone if it is there),
  // as key-cortex-actor-binding does.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
      KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
      KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
      KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
      KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
      KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
    ], KeyCortexController);
  }
  // consciousChat's parameter types as tsc emits them: the body class (so the
  // ValidationPipe validates it), then the principal (an interface: Object).
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, 'consciousChat')) {
    Reflect.defineMetadata('design:paramtypes', [controllerModule.ConsciousChatDto, Object], KeyCortexController.prototype, 'consciousChat');
  }

  // Stand-ins (see the header). The model answers at once and records the feature.
  const aiUsage = {
    trackAndComplete: async (_businessId: string, _userId: unknown, feature: string) => {
      modelCalls.push(feature);
      return { content: modelAnswer(feature), usage, model: 'v70h-stand-in', provider: 'v70h-stand-in' };
    },
  };
  const modelGateway = {
    complete: async () => {
      modelCalls.push('model_gateway');
      return { content: '{}', usage, model: 'v70h-stand-in', provider: 'v70h-stand-in' };
    },
  };
  const noOrgans = { listAdapters: () => [] };
  const noInsights = { generateInsights: async () => [] };

  const buildConsciousness = (prisma: any) => {
    const redis = inMemoryRedis(cache) as any;
    const events = new KeyCortexEventService(prisma);
    const evidence = new KeyCortexEvidenceService(prisma);
    const context = new KeyCortexContextV2Service(prisma, redis);
    const genomeBridge = new (KeyCortexGenomeBridgeService as any)(prisma, events, evidence);
    // Positional, in the constructor's order (key-cortex-consciousness.service.ts).
    return new (KeyCortexConsciousnessService as any)(
      new KeyCortexEmotionService(prisma, aiUsage as any),
      new KeyCortexReasoningEngineService(aiUsage as any, context),
      new KeyCortexReflectionService(prisma, events, noInsights as any, genomeBridge, modelGateway as any, aiUsage as any),
      new KeyCortexIntuitionService(prisma, events, context, modelGateway as any, aiUsage as any),
      new KeyCortexMetacognitionService(prisma, events, evidence),
      new KeyCortexCreativityService(prisma, modelGateway as any, aiUsage as any, context, noInsights as any),
      new KeyCortexEthicsService(prisma, events),
      new KeyCortexTemporalReasoningService(prisma, context),
      context,
      genomeBridge,
      modelGateway,
      new KeyCortexPersonalityService(),
      events,
      prisma,
      new KeyCortexInteroceptionService(noOrgans as any),
      new KeyCortexEndocrineService(prisma),
    );
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      {
        provide: KeyCortexConversationService,
        useFactory: (prisma: any) => new KeyCortexConversationService(prisma, inMemoryRedis(cache) as any),
        inject: [PrismaService],
      },
      {
        provide: KeyCortexSessionService,
        useFactory: (prisma: any) => new KeyCortexSessionService(prisma, inMemoryRedis(cache) as any),
        inject: [PrismaService],
      },
      { provide: KeyCortexConsciousnessService, useFactory: buildConsciousness, inject: [PrismaService] },
      // Installed globally in production (app.module.ts).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  consciousness = moduleRef.get(KeyCortexConsciousnessService);

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v70h_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V70H Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizOther, name: 'V70H Other Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  // Evidence as EvidenceService.submit writes it (the table's real columns).
  const proof = (id: string, businessId: string, submittedAt: string) => ({
    id, businessId, evidenceType: 'photo', url: `https://v70h.test/${id}.jpg`, storageKey: `v70h/${id}.jpg`,
    submittedBy: ID.owner, submittedAt: new Date(submittedAt), linkedType: 'Task', linkedId: `${P}task`,
  });
  await db.evidence.create({ data: proof(ID.evOld, ID.biz, '2026-11-01T09:00:00.000Z') });
  await db.evidence.create({ data: proof(ID.evNew, ID.biz, '2026-11-02T09:00:00.000Z') });
  await db.evidence.create({ data: proof(ID.evOther, ID.bizOther, '2026-11-03T09:00:00.000Z') });

  // No case below may reach a real provider: every global fetch is recorded and refused.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    outbound.push(typeof input === 'string' ? input : String(input?.url ?? input));
    throw new Error('v70h: outbound traffic is refused in this suite');
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('the owner holds the business by membership and Business.ownerId; each business holds its own evidence rows', async () => {
    expect(await db.membership.findMany({ where: { businessId: ID.biz }, select: { userId: true, role: true } })).toEqual([{ userId: ID.owner, role: 'OWNER' }]);
    expect(await evidenceRows(ID.biz)).toEqual([ID.evNew, ID.evOld]);
    expect(await evidenceRows(ID.bizOther)).toEqual([ID.evOther]);
  });

  it('the question is a deliberative one: no action verb, so /app/key/chat would route it to processConsciously', () => {
    expect(/\b(create|make|add|send|schedule|book|update|change|delete|remove|cancel|invoice|draft|generate|assign|move|set|mark|pay|refund|publish|post)\b/i.test(QUESTION)).toBe(false);
  });
});

describe('V70H-01 POST conscious/chat answers a deliberative question with the reasoned answer (UCS-COR-3)', () => {
  it('RED-BEFORE: 200 with the reasoned answer and all twelve phases, not the fallback; the capability is recorded in business_events; nothing lands in evidence; no provider was called', async () => {
    const from = { warnings: warnings.length, errors: errors.length, models: modelCalls.length };
    const capabilitiesBefore = await capabilityRows();

    const res = await consciousChat(ID.owner, { businessId: ID.biz, text: QUESTION });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.text).not.toMatch(FALLBACK);
    expect(res.body.text).toContain(CONCLUSION);
    expect(res.body.phases.map((p: any) => p.layer)).toEqual([
      'emotion', 'mindState', 'temporal', 'interoception', 'reasoning', 'intuition', 'metacognition', 'creativity',
      'ethics', 'emotionalCalibration', 'synthesis', 'consolidate',
    ]);
    expect(res.body.phases).toHaveLength(TOTAL_CONSCIOUS_PHASES);
    // The ethics organ's own verdict (on this conclusion it flags financial data used without a recorded consent).
    expect(typeof res.body.permitted).toBe('boolean');
    expect(res.body.confidence).toBeGreaterThan(0);
    expect(res.body.confidence).toBeLessThanOrEqual(1);

    // Step 11 ran: the capability row upsertCapabilityRecord writes with business_events' real columns.
    expect(await capabilityRows()).toBe(capabilitiesBefore + 1);
    // The cortex claim never reaches the business's proof list (V61-07's contract).
    expect(await evidenceRows(ID.biz)).toEqual([ID.evNew, ID.evOld]);

    expect(errors.slice(from.errors).filter((e) => /Pipeline FAILED/.test(e)), 'the pipeline failed').toEqual([]);
    expect(warnings.slice(from.warnings).filter((w) => /fallback response/.test(w))).toEqual([]);
    // The reasoning really ran through the model stand-in (the two modes every question earns).
    expect(modelCalls.slice(from.models).filter((f) => f === 'reasoning_engine').length).toBeGreaterThanOrEqual(2);
    expect(outbound).toEqual([]);
  });
});

describe('V70H-02 a failing bookkeeping step costs only its own contribution (the real graph)', () => {
  /** processConsciously with one metacognition or logging call made to fail, on the real graph. */
  async function answerWith(target: any, method: string, failure: Error) {
    // A fresh ethical review each time: a cached verdict would skip its decision log (step 7).
    consciousness.ethics.evaluationCache.clear();
    const spy = vi.spyOn(target, method).mockRejectedValueOnce(failure);
    const from = { warnings: warnings.length, errors: errors.length };
    const phases: any[] = [];
    try {
      const response = await consciousness.processConsciously(QUESTION, deliberateSession(), (p: any) => phases.push(p));
      return { response, phases, warnings: warnings.slice(from.warnings), errors: errors.slice(from.errors), calls: spy.mock.calls.length };
    } finally {
      spy.mockRestore();
    }
  }

  function expectReasonedAnswer(run: { response: any; phases: any[]; errors: string[] }) {
    expect(run.response.text).not.toMatch(FALLBACK);
    expect(run.response.text).toContain(CONCLUSION);
    expect(run.phases).toHaveLength(TOTAL_CONSCIOUS_PHASES);
    expect(run.phases.at(-1)?.layer).toBe('consolidate');
    expect(run.errors.filter((e) => /Pipeline FAILED/.test(e))).toEqual([]);
  }

  it('RED-BEFORE: S11, the self-model update (trackCapability) failing: the reasoned answer stands and a warning names step 11', async () => {
    const run = await answerWith(consciousness.metacognition, 'trackCapability', new Error('v70h: capability store refused the write'));
    expect(run.calls).toBe(1);
    expectReasonedAnswer(run);
    expect(run.warnings.filter((w) => w.includes('[Consciousness][S11]') && w.includes('v70h: capability store refused the write'))).toHaveLength(1);
  });

  it('RED-BEFORE: S6, confidence calibration failing: the reasoned answer stands with the reasoning\'s own confidence, the answer says it is not calibrated, and a warning names step 6', async () => {
    const run = await answerWith(consciousness.metacognition, 'calibrateConfidence', new Error('v70h: track record unreadable'));
    expect(run.calls).toBe(1);
    expectReasonedAnswer(run);
    expect(run.response.confidence.confidence).toBe(RAW_CONFIDENCE);
    expect(run.response.confidence.caveats.join(' ')).toMatch(/not calibrated/);
    expect(run.response.confidence.caveats.join(' ')).not.toContain('v70h: track record unreadable');
    expect(run.response.text).not.toContain('v70h: track record unreadable');
    expect(run.warnings.filter((w) => w.includes('[Consciousness][S6]') && w.includes('v70h: track record unreadable'))).toHaveLength(1);
  });

  it('RED-BEFORE: S10, the process log failing: the reasoned answer stands and a warning names step 10', async () => {
    const run = await answerWith(consciousness, 'logConsciousProcess', new Error('v70h: process log refused the write'));
    expect(run.calls).toBe(1);
    expectReasonedAnswer(run);
    expect(run.warnings.filter((w) => w.includes('[Consciousness][S10]') && w.includes('v70h: process log refused the write'))).toHaveLength(1);
  });

  it('RED-BEFORE: the self-model read for the snapshot failing: the reasoned answer stands and a warning names it', async () => {
    const run = await answerWith(consciousness.metacognition, 'buildSelfModel', new Error('v70h: self-model unreadable'));
    expect(run.calls).toBe(1);
    expectReasonedAnswer(run);
    expect(run.warnings.filter((w) => w.includes('[Consciousness][snapshot]') && w.includes('v70h: self-model unreadable'))).toHaveLength(1);
  });

  it("RED-BEFORE: S7, the ethics decision log failing for real (KeyCortexEventService.logDecision on this database): the evaluation stands and reaches the answer, the reasoned answer is delivered, and a warning says the log was not written", async () => {
    consciousness.ethics.evaluationCache.clear();
    const from = { warnings: warnings.length, errors: errors.length };
    const response = await consciousness.processConsciously(QUESTION, deliberateSession());
    expect(response.text).not.toMatch(FALLBACK);
    expect(response.text).toContain(CONCLUSION);
    // The organ's evaluation of the conclusion, not a stand-in verdict.
    expect(response.ethical).toMatchObject({ action: CONCLUSION, permitted: expect.any(Boolean) });
    expect(response.ethical.explanation).toMatch(/Ethical Analysis of/);
    expect(errors.slice(from.errors).filter((e) => /Pipeline FAILED/.test(e))).toEqual([]);
    expect(warnings.slice(from.warnings).filter((w) => w.startsWith('KeyCortexEthicsService:') && /decision log/i.test(w))).toHaveLength(1);
  });

  it('a failure in the reasoning itself still answers with the fallback, as before (positive control: only bookkeeping was made survivable)', async () => {
    const run = await answerWith(consciousness.reasoning, 'reasonMultiModal', new Error('v70h: reasoning down'));
    expect(run.response.text).toMatch(FALLBACK);
    expect(run.errors.filter((e) => /Pipeline FAILED/.test(e))).toHaveLength(1);
  });
});

describe('V70H-03 the evidence writer never sends a column the evidence table does not have', () => {
  it("RED-BEFORE: step 11's cortex claim is refused by name before any query: no PrismaClientValidationError, the evidence delegate is never reached, no row is written", async () => {
    const { KeyCortexEvidenceService } = await import('../src/modules/key-cortex/key-cortex-evidence.service');
    const reached: string[] = [];
    const client = new Proxy(db, {
      get: (target, prop) => {
        if (prop === 'evidence') reached.push('evidence');
        return target[prop];
      },
    });
    const cortex = new KeyCortexEvidenceService({ client } as any);
    let failure: any;
    try {
      // The write KeyCortexMetacognitionService.trackCapability makes at step 11.
      await cortex.createEvidence({
        businessId: ID.biz,
        claim: 'Capability "conscious_response" executed with result: success',
        claimType: 'TASK_COMPLETED' as any,
        proof: { capability: 'conscious_response', result: 'success', businessId: ID.biz },
        confidence: 1,
        source: 'metacognition',
        relatedModule: 'key_cortex',
      });
    } catch (e) {
      failure = e;
    }
    expect(failure, 'createEvidence must refuse a cortex claim').toBeDefined();
    expect(failure?.name).toBe('CortexClaimNotStoredError');
    expect(failure?.constructor?.name).not.toBe('PrismaClientValidationError');
    expect(String(failure?.message)).toMatch(/evidence/);
    expect(reached, 'createEvidence reached the evidence delegate').toEqual([]);
    expect(await evidenceRows(ID.biz)).toEqual([ID.evNew, ID.evOld]);
  });
});

describe('V70H-04 the evidence reader asks only for real columns', () => {
  it("RED-BEFORE: findEvidence(business, { limit }) returns that business's evidence, newest first, at most `limit` rows, never another business's", async () => {
    const { KeyCortexEvidenceService } = await import('../src/modules/key-cortex/key-cortex-evidence.service');
    const cortex = new KeyCortexEvidenceService({ client: db } as any);
    expect((await cortex.findEvidence(ID.biz, { limit: 50 })).map((e: any) => e.id)).toEqual([ID.evNew, ID.evOld]);
    expect((await cortex.findEvidence(ID.biz, { limit: 1 })).map((e: any) => e.id)).toEqual([ID.evNew]);
    expect((await cortex.findEvidence(ID.biz)).map((e: any) => e.id)).toEqual([ID.evNew, ID.evOld]);
    expect((await cortex.findEvidence(ID.bizOther, { limit: 50 })).map((e: any) => e.id)).toEqual([ID.evOther]);
  });
});
