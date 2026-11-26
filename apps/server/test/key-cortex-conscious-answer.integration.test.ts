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
 * Review repair (SEC-W1FKEW-1, COR-W1FKEW-1, COR-W1FKEW-2). Once the answer
 * survives, it reaches whoever asked, and it is built from the full KEY context
 * (KeyCortexContextV2Service.getFullContext: revenue, outstanding and overdue
 * invoices by customer, hot leads, inbox previews) and carries the temporal
 * context's revenue figures word for word. D-129 serves that context to the
 * business owner only (an OWNER membership, D-125), D-140 binds an OWNER
 * membership's explicit scope map on KEY, and D-145 / D-182 / SEC-P195KG-2 hold
 * money figures to members with Money read. Pinned here, on the team business
 * (one invoice of 98,765.43, 20 days overdue, owed by "v70h Private Payer"):
 *   V70H-05  POST conscious/chat and GET conscious/stream for a member who may
 *            not read the full KEY context (a STAFF member with an explicit map
 *            that has no revenue, either the SEC review's {bookings: write} or
 *            the COR review's {crm: read}; an ADMIN, D-129; an OWNER membership
 *            whose explicit map has no revenue, D-140) still answer 200 on the
 *            member's own session (the Release 0 actor-binding cases), but the
 *            answer carries no figure and no customer name, the reasoning model
 *            is never prompted with the business's context, and the answer says
 *            Deep think is the owner's and what to do instead. The business's
 *            OWNER still gets the reasoned answer (control).
 *   V70H-06  /app/key/chat (POST /ai/businesses/:id/flow/chat/stream, the real
 *            AiFlowController and FlowOrchestratorService.streamChat, graded
 *            deliberate): the deliberate branch runs for the member who asked,
 *            by id, never as userId ''; a member who may not read the full KEY
 *            context gets the member-scoped fast path instead (the viewer
 *            projection of the business graph, SEC-P195KG-2), so no chunk and no
 *            model prompt carries a figure or the customer's name; the OWNER
 *            gets the deliberated answer.
 *   V70H-01 (tightened, COR-W1FKEW-2) the ethics organ judges what the
 *            recommendation itself uses, not the whole context dump, so a plain
 *            recommendation is permitted and carries no DATA PRIVACY ALERT.
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
 * constructor, consciousChat and consciousStream, as key-cortex-actor-binding
 * does.
 * For V70H-06: AiFlowController behind the real AuthGuard, BusinessGuard and
 * CrmRateLimitGuard, and FlowOrchestratorService's own streamChat,
 * shouldDeliberate, deliberate and finalizeStreamSession, with the real
 * BusinessGraphService (the member's viewer projection) and the same
 * consciousness graph; the stand-ins are the prompt-building reads that decide
 * nothing on this path (crew, memories, semantic memory, blueprint, onboarding,
 * perception, tool menu, session persistence), the thalamus (it grades the
 * question deliberate) and the model (trackAndStream records the prompt and
 * answers "v70h fast-path answer").
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
  /** The team business (review repair): an OWNER, the members below and one large overdue invoice. */
  bizTeam: `${P}bizTeam`,
  /** STAFF, explicit map {bookings: write}: no revenue, expenses or ai (the SEC-W1FKEW-1 repro). */
  staff: `${P}staff`,
  /** STAFF, explicit map {crm: read}: keyContextSight shows no revenue (the COR-W1FKEW-1 repro). */
  staffCrm: `${P}staffCrm`,
  /** ADMIN on role defaults: the full KEY context is the owner's (D-129). */
  admin: `${P}admin`,
  /** A co-owner: an OWNER membership whose explicit map has no revenue (D-140 binds it). */
  coOwner: `${P}coOwner`,
  contact: `${P}contact`,
  invoice: `${P}inv1`,
};

/** A question with no action verb: FlowOrchestratorService.shouldDeliberate routes it to processConsciously. */
const QUESTION = 'Why are my customers paying their invoices so late?';
/** What every reasoning chain the model stand-in returns concludes. */
const CONCLUSION = 'v70h: chase the three oldest overdue invoices before offering new terms';
const RAW_CONFIDENCE = 0.8;
const FALLBACK = /I encountered an issue while processing your request/;
/** The team business's one invoice, and who owes it. */
const INVOICE_TOTAL = 98765.43;
const PAYER = 'v70h Private Payer';
/** The invoice's figure in any of the ways the pipeline prints it ($98,765, 98765.43, 98,765.43). */
const FIGURE = /98,?765/;
/** What the fast path's model stand-in answers. */
const FAST_ANSWER = 'v70h fast-path answer';

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
/** The prompt of every model request (consciousness graph and fast path), by feature. */
const prompts: Array<{ feature: string; prompt: string }> = [];
/** Every session the consciousness pipeline was handed (spied, the real pipeline runs). */
const pipelineSessions: Array<{ businessId: unknown; userId: unknown }> = [];
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

function collectText(res: any, cb: (err: Error | null, body: string) => void) {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => { data += chunk; });
  res.on('end', () => cb(null, data));
}

/** GET conscious/stream, its SSE events parsed (`event: <type>`, `data: <json>`). */
async function consciousStream(user: string, query: Record<string, string>) {
  const res = await request(app.getHttpServer())
    .get('/api/v1/cortex/conscious/stream')
    .set(HEADER, user)
    .query(query)
    .buffer(true)
    .parse(collectText);
  const events: Array<{ type: string; data: any }> = [];
  for (const block of String(res.body).split('\n\n')) {
    const type = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (type && data) events.push({ type, data: JSON.parse(data) });
  }
  return { status: res.status, events };
}

let ipSeq = 0;
/** POST /ai/businesses/:id/flow/chat/stream (/app/key/chat), its chunks parsed. */
async function flowChatStream(user: string, businessId: string, message: string) {
  ipSeq += 1;
  const res = await request(app.getHttpServer())
    .post(`/ai/businesses/${businessId}/flow/chat/stream`)
    .set(HEADER, user)
    // A distinct client address per request, so CrmRateLimitGuard's per-address buckets never cap the suite.
    .set('x-forwarded-for', `10.70.8.${ipSeq}`)
    .send({ message })
    .buffer(true)
    .parse(collectText);
  const chunks = String(res.body)
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map((l) => JSON.parse(l.slice('data: '.length)));
  return { status: res.status, chunks };
}

/** What the model was prompted with since `from` (every feature), as one string. */
function promptedSince(from: number): string {
  return prompts.slice(from).map((p) => p.prompt).join('\n');
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
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
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
  // /app/key/chat (V70H-06).
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');

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
  // consciousStream's: the query class, the guarded tenant (String), the principal.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, 'consciousStream')) {
    Reflect.defineMetadata('design:paramtypes', [controllerModule.ConsciousChatDto, String, Object], KeyCortexController.prototype, 'consciousStream');
  }

  // Stand-ins (see the header). The model answers at once and records the feature.
  // Every prompt is recorded whole (JSON of the request), so a figure anywhere in it is seen.
  const aiUsage = {
    trackAndComplete: async (_businessId: string, _userId: unknown, feature: string, req?: unknown) => {
      modelCalls.push(feature);
      prompts.push({ feature, prompt: JSON.stringify(req ?? null) });
      return { content: modelAnswer(feature), usage, model: 'v70h-stand-in', provider: 'v70h-stand-in' };
    },
  };
  const modelGateway = {
    complete: async (...args: unknown[]) => {
      modelCalls.push('model_gateway');
      prompts.push({ feature: 'model_gateway', prompt: JSON.stringify(args) });
      return { content: '{}', usage, model: 'v70h-stand-in', provider: 'v70h-stand-in' };
    },
  };
  // The fast path's model (/app/key/chat): records the prompt, answers FAST_ANSWER.
  const flowAi = {
    checkRateLimit() {},
    async checkCredits() {
      return { allowed: true };
    },
    async *trackAndStream(_businessId: string, _userId: unknown, feature: string, req?: unknown) {
      modelCalls.push(feature);
      prompts.push({ feature, prompt: JSON.stringify(req ?? null) });
      yield { type: 'content_delta', content: FAST_ANSWER };
      yield { type: 'usage', usage };
    },
  };
  // FlowOrchestratorService's own streamChat, shouldDeliberate, deliberate and finalizeStreamSession; the
  // prompt-building reads that decide nothing on this path are stubbed, the thalamus grades the question
  // deliberate, and the business graph (the member's viewer projection) and the cortex are the real ones
  // (set once the module is compiled).
  const flowRegistry = new Map<unknown, unknown>();
  const orchestrator: any = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: new Logger('FlowOrchestratorService'),
    moduleRef: {
      get(token: any) {
        if (!flowRegistry.has(token)) throw new Error(`v70h moduleRef has no provider for ${token?.name ?? String(token)}`);
        return flowRegistry.get(token);
      },
    },
    aiUsage: flowAi,
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    genomeFacts: { listTopFacts: async () => [] },
    buildAttachmentContext: async () => '',
    resolveTurnAuthority: async () => ({ primary: 'general', crew: ['general'], scores: {} }),
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    buildPerceptionSection: async () => '',
    selectToolsForRequest: async () => [],
    getTriage: () => ({
      triage: () => ({
        tier: 'deliberate', score: 4, arousal: 1, reason: 'v70h: graded deliberate', maxTokens: 2000,
        temperature: 0.5, standingContext: null, taskCategory: 'tool-calling',
      }),
    }),
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
  });
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
    controllers: [KeyCortexController, AiFlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      { provide: FlowOrchestratorService, useValue: orchestrator },
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
  // Every session the pipeline is handed, from any caller; the real pipeline then runs.
  const realProcess = consciousness.processConsciously.bind(consciousness);
  consciousness.processConsciously = (query: string, session: any, onPhase?: unknown) => {
    pipelineSessions.push({ businessId: session?.businessId, userId: session?.userId });
    return realProcess(query, session, onPhase);
  };
  flowRegistry.set(KeyCortexConsciousnessService, consciousness);
  orchestrator.prisma = moduleRef.get(PrismaService);
  orchestrator.businessGraph = new BusinessGraphService(moduleRef.get(PrismaService));

  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
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

  // The team business (review repair): its OWNER, four members who may not read the full KEY context,
  // and one large overdue invoice owed by a named customer.
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffCrm, email: `${P}staffcrm@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.admin, email: `${P}admin@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.coOwner, email: `${P}coowner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizTeam, name: 'V70H Team Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_team_owner`, userId: ID.owner, businessId: ID.bizTeam, role: 'OWNER' } });
  // SWP-CENSUS-KEY-B (P109, Ruling B2): POST conscious/chat requires ai:write; keep revenue absent so D-129 owner-only proof remains live.
  await db.membership.create({ data: { id: `${P}m_team_staff`, userId: ID.staff, businessId: ID.bizTeam, role: 'STAFF', permissionScopes: { bookings: 'write', ai: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_team_staffcrm`, userId: ID.staffCrm, businessId: ID.bizTeam, role: 'STAFF', permissionScopes: { crm: 'read', ai: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_team_admin`, userId: ID.admin, businessId: ID.bizTeam, role: 'ADMIN' } });
  await db.membership.create({ data: { id: `${P}m_team_coowner`, userId: ID.coOwner, businessId: ID.bizTeam, role: 'OWNER', permissionScopes: { crm: 'admin', bookings: 'admin', ai: 'write' } } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.bizTeam, firstName: 'v70h', lastName: 'Private Payer', displayName: PAYER } as any });
  await db.invoice.create({
    data: {
      id: ID.invoice, businessId: ID.bizTeam, contactId: ID.contact, invoiceNumber: `${P}INV-1`, total: INVOICE_TOTAL,
      status: 'SENT', dueDate: new Date(Date.now() - 20 * 86_400_000),
    } as any,
  });

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

  it('the team business: its OWNER and four members, none of whom may read the full KEY context, and one large overdue invoice owed by a named customer', async () => {
    const members = await db.membership.findMany({ where: { businessId: ID.bizTeam }, select: { userId: true, role: true, permissionScopes: true }, orderBy: { userId: 'asc' } });
    expect(members).toEqual([
      { userId: ID.admin, role: 'ADMIN', permissionScopes: null },
      { userId: ID.coOwner, role: 'OWNER', permissionScopes: { crm: 'admin', bookings: 'admin', ai: 'write' } },
      { userId: ID.owner, role: 'OWNER', permissionScopes: null },
      { userId: ID.staff, role: 'STAFF', permissionScopes: { bookings: 'write', ai: 'write' } },
      { userId: ID.staffCrm, role: 'STAFF', permissionScopes: { crm: 'read', ai: 'write' } },
    ]);
    const { keyContextSight } = await import('../src/modules/ai/business-graph.service');
    const prisma = { client: db } as any;
    // KEY chat's own reading (SEC-P195KG-2): none of the STAFF members or the co-owner may see revenue.
    for (const user of [ID.staff, ID.staffCrm, ID.coOwner]) expect((await keyContextSight(prisma, ID.bizTeam, user)).revenue, user).toBe(false);
    expect((await keyContextSight(prisma, ID.bizTeam, ID.owner)).revenue).toBe(true);
    const invoices: any[] = await db.$queryRawUnsafe('SELECT total::float AS total, status, contact_id FROM invoices WHERE business_id = $1', ID.bizTeam);
    expect(invoices).toEqual([{ total: INVOICE_TOTAL, status: 'SENT', contact_id: ID.contact }]);
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
    // COR-W1FKEW-2: the ethics organ judges what the recommendation itself uses. This one uses no sensitive
    // data, so it is permitted, and the answer carries no DATA PRIVACY ALERT about the context it was reasoned from.
    expect(res.body.permitted).toBe(true);
    expect(res.body.text).not.toContain('DATA PRIVACY ALERT');
    expect(res.body.text).not.toMatch(/Overall Verdict: ✅ PERMITTED[\s\S]*ALERT:/);
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

  // FU-KEY-EVENT-COLUMNS (V1-71, D-220): logDecision no longer fails on this database (the writer names
  // business_events' real columns, key-event-columns V71J-01), so the failure is now injected, once, into the
  // real event service the ethics organ holds; the property pinned is unchanged.
  it("RED-BEFORE: S7, the ethics decision log failing (KeyCortexEventService.logDecision, the real service made to fail once): the evaluation stands and reaches the answer, the reasoned answer is delivered, and a warning says the log was not written", async () => {
    consciousness.ethics.evaluationCache.clear();
    const from = { warnings: warnings.length, errors: errors.length };
    const decisionLog = vi.spyOn(consciousness.ethics.eventService, 'logDecision')
      .mockRejectedValueOnce(new Error('Invalid invocation\n\nv70h: decision log refused the write'));
    let response: any;
    let calls = 0;
    try {
      response = await consciousness.processConsciously(QUESTION, deliberateSession());
    } finally {
      calls = decisionLog.mock.calls.length;
      decisionLog.mockRestore();
    }
    expect(calls).toBe(1);
    expect(response.text).not.toMatch(FALLBACK);
    expect(response.text).toContain(CONCLUSION);
    // The organ's evaluation of the conclusion, not a stand-in verdict (permitted: it uses no sensitive data).
    expect(response.ethical).toMatchObject({ action: CONCLUSION, permitted: true });
    expect(response.ethical.explanation).toMatch(/Ethical Analysis of/);
    expect(errors.slice(from.errors).filter((e) => /Pipeline FAILED/.test(e))).toEqual([]);
    expect(warnings.slice(from.warnings).filter((w) => w.startsWith('KeyCortexEthicsService:') && /decision log/i.test(w) && w.includes('v70h: decision log refused the write'))).toHaveLength(1);
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

/** Cortex sessions `user` holds in `businessId`. */
async function sessionsOf(user: string, businessId: string): Promise<number> {
  const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM cortex_sessions WHERE user_id = $1 AND business_id = $2',
    user,
    businessId,
  );
  return rows[0].n;
}

/** The members of the team business who may not read the full KEY context. */
const NOT_THE_OWNER: Array<[string, string]> = [
  ['a STAFF member whose explicit map has no revenue ({bookings: write}, SEC-W1FKEW-1)', ID.staff],
  ['a STAFF member whose explicit map reads only crm ({crm: read}, COR-W1FKEW-1)', ID.staffCrm],
  ["an ADMIN on role defaults (the full KEY context is the owner's, D-129)", ID.admin],
  ['an OWNER membership whose explicit map has no revenue (D-140 binds it)', ID.coOwner],
];

describe('V70H-05 the deliberative answer reaches only who may read the full KEY context (SEC-W1FKEW-1, COR-W1FKEW-1)', () => {
  it.each(NOT_THE_OWNER)(
    "RED-BEFORE: POST conscious/chat for %s: 200 on the member's own session, but no figure, no customer name and no reasoned answer; the model is never prompted with the business's context; the answer says Deep think is the owner's and what to do instead",
    async (_who, user) => {
      const from = { prompts: prompts.length, sessions: pipelineSessions.length };
      const sessionsBefore = await sessionsOf(user, ID.bizTeam);

      const res = await consciousChat(user, { businessId: ID.bizTeam, text: QUESTION });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const text = String(res.body.text);
      expect(text).not.toMatch(FIGURE);
      expect(text).not.toContain(PAYER);
      expect(text).not.toContain('Temporal context');
      expect(text).not.toContain(CONCLUSION);
      expect(text).not.toMatch(FALLBACK);
      expect(text).toMatch(/Deep think/);
      expect(text).toMatch(/owner/);
      expect(JSON.stringify(res.body)).not.toMatch(FIGURE);
      // The reasoning model never saw the business's context.
      const prompted = promptedSince(from.prompts);
      expect(prompted).not.toMatch(FIGURE);
      expect(prompted).not.toContain(PAYER);
      // The route still runs for the member, on the member's own session (Release 0 actor binding).
      expect(pipelineSessions.slice(from.sessions)).toEqual([{ businessId: ID.bizTeam, userId: user }]);
      expect(await sessionsOf(user, ID.bizTeam)).toBe(sessionsBefore + 1);
      expect(outbound).toEqual([]);
    },
  );

  it("RED-BEFORE: GET conscious/stream (the web KEY chat's Deep think) for the STAFF member ({bookings: write}): no event carries a figure or the customer's name, and the answer event says Deep think is the owner's", async () => {
    const from = { prompts: prompts.length, sessions: pipelineSessions.length };

    const { status, events } = await consciousStream(ID.staff, { businessId: ID.bizTeam, text: QUESTION });

    expect(status).toBe(200);
    const answer = events.find((e) => e.type === 'answer');
    expect(answer, JSON.stringify(events).slice(0, 400)).toBeDefined();
    expect(JSON.stringify(events)).not.toMatch(FIGURE);
    expect(JSON.stringify(events)).not.toContain(PAYER);
    expect(String(answer!.data.text)).toMatch(/Deep think/);
    expect(String(answer!.data.text)).not.toContain(CONCLUSION);
    expect(promptedSince(from.prompts)).not.toMatch(FIGURE);
    expect(pipelineSessions.slice(from.sessions)).toEqual([{ businessId: ID.bizTeam, userId: ID.staff }]);
  });

  it("the team business's OWNER (an OWNER membership with no explicit map) still gets the reasoned answer, reasoned over the business's figures (control: the assertions above are not vacuous)", async () => {
    const from = { prompts: prompts.length, sessions: pipelineSessions.length };

    const res = await consciousChat(ID.owner, { businessId: ID.bizTeam, text: QUESTION });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.text).toContain(CONCLUSION);
    expect(res.body.text).not.toMatch(FALLBACK);
    expect(res.body.phases).toHaveLength(TOTAL_CONSCIOUS_PHASES);
    // The owner may read the full KEY context: the reasoning was prompted with the invoice and who owes it.
    const prompted = promptedSince(from.prompts);
    expect(prompted).toMatch(FIGURE);
    expect(prompted).toContain(PAYER);
    expect(pipelineSessions.slice(from.sessions)).toEqual([{ businessId: ID.bizTeam, userId: ID.owner }]);
  });
});

describe('V70H-06 /app/key/chat (POST flow/chat/stream): the deliberate branch runs for the member who asked (SEC-W1FKEW-1, COR-W1FKEW-1)', () => {
  const contentOf = (chunks: any[]) => chunks.filter((c) => c.type === 'content_delta').map((c) => String(c.content));

  it.each(NOT_THE_OWNER)(
    "RED-BEFORE: %s asking a deliberative question gets the member-scoped fast path: no chunk and no model prompt carries the invoice's figure, and the pipeline never runs as anyone but the member",
    async (_who, user) => {
      const from = { prompts: prompts.length, sessions: pipelineSessions.length };

      const { status, chunks } = await flowChatStream(user, ID.bizTeam, QUESTION);

      expect(status).toBeLessThan(300);
      expect(JSON.stringify(chunks)).not.toMatch(FIGURE);
      expect(JSON.stringify(chunks)).not.toContain(PAYER);
      expect(contentOf(chunks).at(-1)).toBe(FAST_ANSWER);
      expect(chunks.at(-1)).toMatchObject({ type: 'done' });
      // The fast path's prompt is the member's own viewer projection of the business graph (SEC-P195KG-2):
      // the invoice's figure is in it exactly when the member has revenue read (the ADMIN on role defaults),
      // never for the others. D-129 keeps the full KEY context from the ADMIN, not the figures its access covers.
      const prompted = promptedSince(from.prompts);
      expect(prompted).toContain('V70H Team Biz');
      const { keyContextSight } = await import('../src/modules/ai/business-graph.service');
      const readsRevenue = (await keyContextSight({ client: db } as any, ID.bizTeam, user)).revenue;
      expect(readsRevenue).toBe(user === ID.admin);
      if (readsRevenue) expect(prompted).toMatch(FIGURE);
      else expect(prompted).not.toMatch(FIGURE);
      expect(pipelineSessions.slice(from.sessions).filter((s) => s.userId !== user)).toEqual([]);
    },
  );

  it('RED-BEFORE: the OWNER asking the same question gets the deliberated answer, and the pipeline runs for the OWNER by id, never as userId ""', async () => {
    const from = { sessions: pipelineSessions.length };

    const { status, chunks } = await flowChatStream(ID.owner, ID.bizTeam, QUESTION);

    expect(status).toBeLessThan(300);
    expect(contentOf(chunks).join('\n')).toContain(CONCLUSION);
    expect(contentOf(chunks)).not.toContain(FAST_ANSWER);
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
    expect(pipelineSessions.slice(from.sessions)).toEqual([{ businessId: ID.bizTeam, userId: ID.owner }]);
    expect(outbound).toEqual([]);
  });
});
