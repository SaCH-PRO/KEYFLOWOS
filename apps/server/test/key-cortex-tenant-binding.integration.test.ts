/**
 * R0-34b-KEY-TENANT-BINDING — KEY cortex routes act only on the tenant
 * BusinessGuard checked (REAL database). R0-07a security review ST-1;
 * COST-LEDGER-001 section 7 item 9. Same defect class as R0-34 (cortex audit)
 * and R0-F24 (tenant interceptor).
 *
 * KeyCortexController and KeyCortexGoalsController are mounted at
 * `/api/v1/cortex` (no `:businessId` segment) behind AuthGuard and
 * BusinessGuard. BusinessGuard checks the tenant resolveRequestBusinessId
 * resolves: path parameter, then body, then query
 * (core/auth/request-business-id.ts). At the base, 36 handlers in
 * key-cortex.controller.ts and 4 in key-cortex-goals.controller.ts read
 * `@Query('businessId')`, and conscious/stream read `dto.businessId` from a
 * whole-object `@Query()`. So a member of tenant A only, sending the JSON body
 * `{businessId: A}` with `?businessId=B`, passed the guard for A and the
 * handler acted on B.
 *
 * The probe below is that request, from A's owner (no membership of B), on one
 * route of each class: voice (POST voice/speak, billed through AiUsageLog), the
 * autonomy profile (GET and PATCH), goals (GET, and DELETE of one of B's goals),
 * trigger rules, sessions (GET sessions, and the session write in
 * conscious/stream) and awareness. Each answers 403 or acts on A only, never B,
 * and writes nothing under B. The same routes with `?businessId=B` and no body
 * are refused 403 (they were at the base too). The two multipart routes
 * (voice/listen, documents) are a special case: multer parses the multipart
 * body AFTER the guards, so the guard sees only the query, and the handler
 * must act on that tenant, never on a multipart field: a multipart
 * `businessId` naming another tenant is refused 403.
 *
 * Two request pipelines, as in cortex-audit-tenant.integration.test.ts:
 *   - `production`: TenantInterceptor installed as an APP_INTERCEPTOR and the
 *     Prisma tenant extension's context provider installed (main.ts), so every
 *     scoped query's businessId is overwritten with the tenant the guard checked
 *     (R0-F24). That masks most of the split for scoped models (a row the
 *     handler writes for B lands in A), but the services still run for B: the
 *     recorded service arguments show it.
 *   - `bare`: no TenantInterceptor, so the extension is inert and the handler's
 *     own binding is the only control.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, TenantInterceptor, the
 * Prisma tenant extension, the production GlobalHttpExceptionFilter and
 * ValidationPipe, multer (FileInterceptor), KeyCortexController,
 * KeyCortexGoalsController, KeyCortexVoiceService, AiUsageService (usage rows),
 * KeyAutonomySafetyService, KeyCortexPlannerService (goal reads and delete),
 * KeyCortexTriggerService (rule reads), KeyCortexConversationService (session
 * reads), KeyCortexSessionService (the session write) and
 * KeyCortexAwarenessService, against DATABASE_URL. Stand-ins: identity
 * attachment (a test middleware reads `x-k34b-user` and attaches the seeded
 * user row, as AuthMiddleware does after token verification); Redis (an
 * in-memory map per pipeline with Redis's get/set/setex/del semantics, so the
 * session services' cache-first reads behave as in production: review ST-1
 * found that a cache that always misses hid a cross-tenant session read); the
 * reasoning engine behind chat, chat/stream and stream (answers at once,
 * recording the tenant and session id it is handed); the OpenAI SDK's HTTP
 * transport (its `fetch` option: a canned audio body for speech and a canned
 * transcript, every request recorded; maxRetries 0) with a value that is not a
 * key, so KEY voice reaches its usage write; globalThis.fetch (recorded and
 * refused); the plan (unlimited, recording which tenant it is asked about); the
 * consciousness pipeline (answers at once, recording the session it is
 * handed); and the collaborators the
 * controllers hold for their other routes (an allow-listed mocker). Vitest's
 * esbuild transform emits no constructor parameter types, so the suite writes
 * the ones tsc emits for the two controllers.
 *
 * Every seeded row carries the `k34b_` prefix and is hard-deleted by raw SQL
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

const P = 'k34b_';
const HEADER = 'x-k34b-user';

const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA only
  ownerB: `${P}ownerB`, // OWNER of bizB only
  nomember: `${P}nomember`, // no business anywhere
  superAdmin: `${P}super`, // role SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  goalA: `${P}goal_a`,
  sessionA: `${P}session_a`,
  sessionB: `${P}session_b`,
  ruleA: `${P}rule_a`,
  ruleB: `${P}rule_b`,
};
/** One B goal per pipeline, so a delete that reaches B in one pipeline cannot hide the other's result. */
const goalB = (pipeline: string) => `${P}goal_b_${pipeline}`;
/** One A goal per pipeline for the same-tenant delete control. */
const goalADeletable = (pipeline: string) => `${P}goal_a_del_${pipeline}`;
const A_MAX_DAILY = 11;
const B_MAX_DAILY = 77;
const B_MARKER = 'k34b-tenant-B-private';

/** Not a key: KEY voice's requests go to the recording transport below and nowhere else. */
const NOT_A_KEY = `${P}test-not-a-real-key`;
const PROVIDER_ENV = [
  'AI_INTEGRATIONS_OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'ELEVENLABS_API_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

const sdk = vi.hoisted(() => ({
  requests: [] as Array<{ url: string; authorization: string }>,
}));

vi.mock('openai', async (importOriginal) => {
  const actual: any = await importOriginal();
  const RealOpenAI = actual.default;
  const transport = async (url: unknown, init: any = {}) => {
    const headers = init.headers ?? {};
    const authorization = String(
      typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization ?? headers.authorization ?? '',
    );
    const u = String(url);
    sdk.requests.push({ url: u, authorization });
    if (u.endsWith('/audio/speech')) {
      return new Response(new Uint8Array([0x6b, 0x33, 0x34, 0x62]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    if (u.endsWith('/audio/transcriptions')) {
      return new Response(JSON.stringify({ text: 'k34b transcript' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new TypeError(`k34b: unexpected provider request ${u}`);
  };
  class RecordingOpenAI extends RealOpenAI {
    constructor(options: any = {}) {
      super({ ...options, fetch: transport, maxRetries: 0 });
    }
  }
  return { ...actual, default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

/** The controllers' collaborators for their other routes; the routes under test reach none of them. */
const OFF_BOUNDARY = new Set([
  'KeyCortexPersonalityService', 'KeyCortexActionsService',
  'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService', 'KeyCortexExecutorService',
  'KeyCortexContextV2Service', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service', 'KeyCortexSandboxService',
  'KeyCortexFlowStudioService', 'KeyCortexEvolutionService', 'KeyCortexPhoneService', 'KeyCortexDocumentService',
  'KeyCortexLearningService', 'KeyCortexApprovalOrchestratorService',
]);

type Pipeline = 'production' | 'bare';
const PIPELINES: Pipeline[] = ['production', 'bare'];
const PIPELINE_LABEL: Record<Pipeline, string> = {
  production: 'production pipeline (TenantInterceptor + tenant extension)',
  bare: 'handler alone (no TenantInterceptor)',
};

interface ServiceCall { service: string; businessId: unknown; ambient: string | undefined }

let db: any;
let tenant: typeof import('../src/core/tenant/tenant-context');
const apps: Partial<Record<Pipeline, any>> = {};
const calls: Record<Pipeline, ServiceCall[]> = { production: [], bare: [] };
/** Every tenant the plan's credit check was asked about (AiUsageService billing), per pipeline. */
const creditChecks: Record<Pipeline, unknown[]> = { production: [], bare: [] };
const aiUsageInstances: any[] = [];
/** Every globalThis.fetch the process attempted during the suite (refused). */
const outbound: string[] = [];
/** The session cache of each pipeline (the in-memory Redis), keyed as the services key it. */
const caches: Record<Pipeline, Map<string, string>> = { production: new Map(), bare: new Map() };
const sessionKey = (id: string) => `cortex:session:${id}`;
/** Every session the consciousness pipeline was handed (conscious/chat, conscious/stream), per pipeline. */
const consciousCalls: Record<Pipeline, Array<{ sessionId: unknown; businessId: unknown }>> = { production: [], bare: [] };
/** Every query the reasoning engine was handed (chat, chat/stream, stream), per pipeline. */
const reasoningCalls: Record<Pipeline, Array<{ method: string; sessionId: unknown; businessId: unknown }>> = { production: [], bare: [] };

/**
 * Redis's get/set/setex/del over a map (TTL ignored); every other command
 * answers null, as the old no-op did. Each command yields to the event loop
 * once first, as a round trip to a real Redis does.
 */
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

/**
 * A refused session id on an SSE route. Without an interceptor Nest awaits the
 * handler before it commits the stream, so the refusal is a plain 404; under
 * TenantInterceptor the handler runs once the stream is subscribed, so it
 * arrives as an `error` event that ends the stream.
 */
function expectSessionRefusedSse(pipeline: Pipeline, res: { status: number; body: unknown }) {
  const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
  if (pipeline === 'production') {
    expect(res.status, text).toBe(200);
    expect(text).toMatch(/event: error\n(?:id: [^\n]*\n)?data: [^\n]*Session not found/);
  } else {
    expect(res.status, text).toBe(404);
    expect(text).toContain('Session not found');
  }
}

/**
 * Every route that read the tenant from the query at the base, with what it
 * needs to get past its own input checks. Each is behind AuthGuard and
 * BusinessGuard. `sse` routes stream once admitted, so they are only called
 * here where the guard or the handler refuses before streaming.
 */
interface RouteCase { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; query?: Record<string, string>; body?: Record<string, unknown>; sse?: boolean }
const QUERY_TENANT_ROUTES: RouteCase[] = [
  { method: 'get', path: 'sessions' },
  { method: 'get', path: 'chat/stream', query: { text: 'k34b' }, sse: true },
  { method: 'get', path: 'messages' },
  { method: 'get', path: 'stream', sse: true },
  { method: 'get', path: 'autonomy-profile' },
  { method: 'post', path: 'voice/speak', body: { text: 'k34b' } },
  { method: 'post', path: 'voice/listen' },
  { method: 'get', path: 'actions/tools' },
  { method: 'get', path: 'context' },
  { method: 'get', path: 'insights/profit' },
  { method: 'get', path: 'insights/revenue' },
  { method: 'get', path: 'insights/churn' },
  { method: 'get', path: 'insights/pipeline' },
  { method: 'get', path: 'monitors' },
  { method: 'patch', path: `monitors/${P}monitor`, body: { enabled: false } },
  { method: 'post', path: `monitors/${P}monitor/toggle`, body: { enabled: false } },
  { method: 'get', path: 'alerts' },
  { method: 'get', path: 'report' },
  { method: 'get', path: 'recommendations' },
  { method: 'get', path: 'flows' },
  { method: 'get', path: `flows/${P}flow` },
  { method: 'put', path: `flows/${P}flow`, body: { name: 'k34b' } },
  { method: 'delete', path: `flows/${P}flow` },
  { method: 'post', path: `flows/${P}flow/execute`, body: {} },
  { method: 'post', path: `flows/${P}flow/toggle`, body: { active: false } },
  { method: 'get', path: 'phone/history' },
  { method: 'get', path: 'phone/status' },
  { method: 'post', path: 'documents' },
  { method: 'get', path: 'documents' },
  { method: 'get', path: `documents/${P}doc` },
  { method: 'delete', path: `documents/${P}doc` },
  { method: 'get', path: 'evolution/profile' },
  { method: 'get', path: 'evolution/patterns' },
  { method: 'get', path: 'evolution/report' },
  { method: 'get', path: 'evolution/decision', query: { decisionId: `${P}decision` } },
  { method: 'get', path: 'conscious/stream', query: { text: 'k34b' }, sse: true },
  { method: 'get', path: 'awareness' },
  { method: 'get', path: 'goals' },
  { method: 'get', path: `goals/${P}goal_x` },
  { method: 'delete', path: `goals/${P}goal_x` },
  { method: 'get', path: 'triggers' },
];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_usage_alerts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_usage_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cortex_sessions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_cortex_trigger_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_goals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_autonomy_profiles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function send(pipeline: Pipeline, route: RouteCase, opts: { user?: string; query?: Record<string, string>; body?: Record<string, unknown> }) {
  let req = (request(apps[pipeline]!.getHttpServer()) as any)[route.method](`/api/v1/cortex/${route.path}`);
  if (opts.user) req = req.set(HEADER, opts.user);
  req = req.query({ ...(route.query ?? {}), ...(opts.query ?? {}) });
  const body = opts.body ?? route.body;
  if (body) req = req.send({ ...(route.body ?? {}), ...body });
  return route.sse ? req.buffer(true).parse(collectText) : req;
}

/** Collect a streamed (text/event-stream) response as text until it ends. */
function collectText(res: any, cb: (err: Error | null, body: string) => void) {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => { data += chunk; });
  res.on('end', () => cb(null, data));
}

/**
 * A refusal. Once an @Sse handler is reached Nest has already committed to a
 * 200 event stream, so a handler's own refusal arrives as an `error` event
 * that ends the stream (router-response-controller.js, sse()).
 */
function expectRefused(route: RouteCase, res: { status: number; body: unknown }) {
  const where = `${route.method} ${route.path} ${res.status} ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`;
  if (route.sse && res.status === 200) {
    expect(String(res.body), where).toMatch(/event: error\n(?:id: [^\n]*\n)?data: [^\n]*businessId[^\n]*required/);
    return;
  }
  expect([400, 403], where).toContain(res.status);
}

/** GET conscious/stream, collected as text until the stream ends. */
function consciousStream(pipeline: Pipeline, user: string, query: Record<string, string>, body?: Record<string, unknown>) {
  let req = request(apps[pipeline]!.getHttpServer())
    .get('/api/v1/cortex/conscious/stream')
    .set(HEADER, user)
    .query(query)
    .buffer(true)
    .parse(collectText);
  if (body) req = req.send(body);
  return req;
}

const usageRows = (businessId: string) => db.aiUsageLog.count({ where: { businessId } });

/** AiUsageLog is written in the background after the response: wait for A's row count to reach `expected`. */
async function waitForUsage(businessId: string, expected: number): Promise<number> {
  let n = await usageRows(businessId);
  for (let i = 0; i < 60 && n < expected; i++) {
    await new Promise((r) => setTimeout(r, 50));
    n = await usageRows(businessId);
  }
  return n;
}

async function waitFor(done: () => boolean) {
  for (let i = 0; i < 60 && !done(); i++) await new Promise((r) => setTimeout(r, 50));
}

/** The tenants the real services were handed since `from`, as `service -> businessId`. */
function tenantsSince(pipeline: Pipeline, from: number) {
  return calls[pipeline].slice(from).map((c) => ({ service: c.service, businessId: c.businessId }));
}

function expectOnlyA(pipeline: Pipeline, from: number, minCalls = 1) {
  const seen = tenantsSince(pipeline, from);
  expect(seen.length, JSON.stringify(seen)).toBeGreaterThanOrEqual(minCalls);
  for (const c of seen) expect(c, JSON.stringify(seen)).toEqual({ service: c.service, businessId: ID.bizA });
}

beforeAll(async () => {
  for (const key of PROVIDER_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexGoalsController } = await import('../src/modules/key-cortex/key-cortex-goals.controller');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
  const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
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
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');

  // The production build (tsc, emitDecoratorMetadata) records each class's
  // constructor parameter types, and Nest injects by them. Vitest's esbuild
  // transform does not emit that metadata, and these controllers declare
  // (most of) their dependencies without @Inject tokens. This writes exactly
  // the metadata tsc emits for their constructors (and leaves a class alone if
  // its metadata is already present), as cortex-audit-tenant does.
  const emitParamTypes = (cls: object, types: unknown[]) => {
    if (!Reflect.getMetadata('design:paramtypes', cls)) Reflect.defineMetadata('design:paramtypes', types, cls);
  };
  emitParamTypes(KeyCortexController, [
    KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
    KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
    KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
    KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
    KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
    KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
  ]);
  emitParamTypes(KeyCortexGoalsController, [KeyCortexPlannerService, KeyCortexTriggerService, PrismaService]);
  // The same for the handler parameters the ValidationPipe reads (review ST-2):
  // without them every @Body() reaches the pipe as `Object` here, so nothing is
  // validated, which is exactly the production defect of an intersection-typed
  // body. These are the types tsc emits for the five handlers that had one;
  // key-cortex-tenant-binding.spec.ts checks them against tsc's own output.
  const goalsDtos = await import('../src/modules/key-cortex/key-cortex-goals.controller');
  const { UpdateAutonomyProfileDto } = await import('../src/modules/key-cortex/key-cortex.controller');
  const emitHandlerParamTypes = (cls: { prototype: object }, method: string, types: unknown[]) => {
    if (!Reflect.getMetadata('design:paramtypes', cls.prototype, method)) Reflect.defineMetadata('design:paramtypes', types, cls.prototype, method);
  };
  emitHandlerParamTypes(KeyCortexController, 'updateAutonomyProfile', [UpdateAutonomyProfileDto, String]);
  emitHandlerParamTypes(KeyCortexGoalsController, 'createGoal', [goalsDtos.CreateGoalDto, String]);
  // The trailing Object is the @CurrentUser() principal the two plan handlers take since R0-09e.
  emitHandlerParamTypes(KeyCortexGoalsController, 'createPlanFromGoal', [String, goalsDtos.CreatePlanFromGoalDto, String, Object]);
  emitHandlerParamTypes(KeyCortexGoalsController, 'createPlanFromCommand', [goalsDtos.CreatePlanFromCommandDto, String, Object]);
  emitHandlerParamTypes(KeyCortexGoalsController, 'updateTriggerRule', [String, goalsDtos.UpdateTriggerRuleDto, String]);

  // The consciousness pipeline is not under test; it answers at once and records the session it was handed.
  const consciousnessFor = (pipeline: Pipeline) => ({
    processConsciously: async (_text: string, session: any, onPhase?: (p: unknown) => void) => {
      consciousCalls[pipeline].push({ sessionId: session?.id, businessId: session?.businessId });
      onPhase?.({ phase: 'k34b', summary: 'k34b phase' });
      return { text: 'k34b answer', meta: {} };
    },
  });
  // The reasoning engine is not under test either; it records the tenant and session id it was handed.
  const reasoningFor = (pipeline: Pipeline) => ({
    processQuery: async (q: any) => {
      reasoningCalls[pipeline].push({ method: 'processQuery', sessionId: q?.sessionId, businessId: q?.businessId });
      return { text: 'k34b answer' };
    },
    streamQuery: async function* (q: any) {
      reasoningCalls[pipeline].push({ method: 'streamQuery', sessionId: q?.sessionId, businessId: q?.businessId });
      yield { type: 'text_delta', content: 'k34b answer' };
      yield { type: 'done' };
    },
  });
  const outputTemplatesOff = { resolveTemplate: async () => { throw new Error('k34b: output templates are off this path'); } };

  // KEY voice reads its key once, at construction: give it a value that is not a key, then remove it.
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = NOT_A_KEY;

  const build = async (pipeline: Pipeline) => {
    const plan = {
      checkLimit: async () => ({ allowed: true }),
      getActiveSubscription: async (businessId: unknown) => {
        creditChecks[pipeline].push(businessId);
        return { limits: { aiCreditsPerMonth: -1 } };
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [KeyCortexController, KeyCortexGoalsController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        {
          provide: KeyAutonomySafetyService,
          useFactory: (prisma: any) => new KeyAutonomySafetyService(prisma),
          inject: [PrismaService],
        },
        {
          provide: AiUsageService,
          useFactory: (prisma: any) => new AiUsageService(prisma, plan as any, outputTemplatesOff as any, {} as any),
          inject: [PrismaService],
        },
        {
          provide: KeyCortexVoiceService,
          useFactory: (usage: any) => new KeyCortexVoiceService(usage, {} as any),
          inject: [AiUsageService],
        },
        {
          provide: KeyCortexPlannerService,
          useFactory: (prisma: any) => new KeyCortexPlannerService(prisma, {} as any, {} as any, {} as any),
          inject: [PrismaService],
        },
        {
          provide: KeyCortexTriggerService,
          useFactory: (prisma: any) => new KeyCortexTriggerService(prisma, { subscribeAll: () => undefined } as any),
          inject: [PrismaService],
        },
        {
          provide: KeyCortexConversationService,
          useFactory: (prisma: any) => new KeyCortexConversationService(prisma, inMemoryRedis(caches[pipeline]) as any),
          inject: [PrismaService],
        },
        {
          provide: KeyCortexSessionService,
          useFactory: (prisma: any) => new KeyCortexSessionService(prisma, inMemoryRedis(caches[pipeline]) as any),
          inject: [PrismaService],
        },
        {
          provide: KeyCortexAwarenessService,
          useFactory: (prisma: any) => new KeyCortexAwarenessService(prisma),
          inject: [PrismaService],
        },
        { provide: KeyCortexConsciousnessService, useValue: consciousnessFor(pipeline) },
        { provide: KeyCortexReasoningService, useValue: reasoningFor(pipeline) },
        // Installed globally in production (app.module.ts).
        ...(pipeline === 'production' ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }] : []),
      ],
    })
      .useMocker((token: any) => {
        const name = typeof token === 'function' ? token.name : String(token);
        return OFF_BOUNDARY.has(name) ? {} : undefined;
      })
      .compile();
    aiUsageInstances.push(moduleRef.get(AiUsageService));

    // Record (and call through) the tenant each real service is handed, and the
    // ambient tenant the extension would inject at that moment.
    const record = (service: string, instance: any, method: string, pick: (args: any[]) => unknown) => {
      const original = instance[method].bind(instance);
      vi.spyOn(instance, method).mockImplementation((...args: any[]) => {
        calls[pipeline].push({ service: `${service}.${method}`, businessId: pick(args), ambient: tenant.getCurrentBusinessId() });
        return original(...args);
      });
    };
    const first = (args: any[]) => args[0];
    record('KeyCortexVoiceService', moduleRef.get(KeyCortexVoiceService), 'synthesize', (a) => a[1]);
    record('KeyCortexVoiceService', moduleRef.get(KeyCortexVoiceService), 'transcribe', (a) => a[1]);
    record('KeyAutonomySafetyService', moduleRef.get(KeyAutonomySafetyService), 'ensureProfile', first);
    record('KeyAutonomySafetyService', moduleRef.get(KeyAutonomySafetyService), 'updateProfile', first);
    record('KeyCortexPlannerService', moduleRef.get(KeyCortexPlannerService), 'listGoals', first);
    record('KeyCortexPlannerService', moduleRef.get(KeyCortexPlannerService), 'getGoal', first);
    record('KeyCortexPlannerService', moduleRef.get(KeyCortexPlannerService), 'deleteGoal', first);
    record('KeyCortexPlannerService', moduleRef.get(KeyCortexPlannerService), 'createGoal', first);
    record('KeyCortexPlannerService', moduleRef.get(KeyCortexPlannerService), 'createPlanFromGoal', first);
    record('KeyCortexPlannerService', moduleRef.get(KeyCortexPlannerService), 'createPlanFromCommand', first);
    record('KeyCortexTriggerService', moduleRef.get(KeyCortexTriggerService), 'listRules', first);
    record('KeyCortexTriggerService', moduleRef.get(KeyCortexTriggerService), 'updateRule', first);
    record('KeyCortexConversationService', moduleRef.get(KeyCortexConversationService), 'listSessions', first);
    record('KeyCortexSessionService', moduleRef.get(KeyCortexSessionService), 'getOrCreateSession', (a) => a[0]?.businessId);
    record('KeyCortexAwarenessService', moduleRef.get(KeyCortexAwarenessService), 'getAwareness', first);

    const nest = moduleRef.createNestApplication();
    // Identity attachment only, for seeded k34b_ users. No guard is overridden.
    nest.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
    nest.useGlobalFilters(new GlobalHttpExceptionFilter());
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await nest.init();
    return nest;
  };
  apps.production = await build('production');
  apps.bare = await build('bare');
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.nomember, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K34B Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'K34B Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await db.businessAutonomyProfile.create({ data: { businessId: ID.bizA, maxDailyAutoActions: A_MAX_DAILY } });
  await db.businessAutonomyProfile.create({ data: { businessId: ID.bizB, maxDailyAutoActions: B_MAX_DAILY } });

  await db.aiGoal.create({ data: { id: ID.goalA, businessId: ID.bizA, title: 'k34b A goal' } });
  for (const pipeline of PIPELINES) {
    await db.aiGoal.create({ data: { id: goalB(pipeline), businessId: ID.bizB, title: `${B_MARKER} goal (${pipeline})` } });
    await db.aiGoal.create({ data: { id: goalADeletable(pipeline), businessId: ID.bizA, title: `k34b A deletable goal (${pipeline})` } });
  }
  const at = new Date().toISOString();
  await db.cortexSession.create({ data: {
    id: ID.sessionA, businessId: ID.bizA, userId: ID.ownerA, title: 'k34b A session',
    messages: [{ id: `${P}msg_a`, role: 'user', content: 'k34b A message', timestamp: at }],
  } });
  await db.cortexSession.create({ data: {
    id: ID.sessionB, businessId: ID.bizB, userId: ID.ownerB, title: `${B_MARKER} session`,
    messages: [{ id: `${P}msg_b`, role: 'user', content: `${B_MARKER} message`, timestamp: at }],
  } });
  await db.keyCortexTriggerRule.create({ data: { id: ID.ruleA, businessId: ID.bizA, eventType: 'k34b.a' } });
  await db.keyCortexTriggerRule.create({ data: { id: ID.ruleB, businessId: ID.bizB, eventType: `${B_MARKER}.b` } });

  // No case below may reach a real provider: every global fetch is recorded and refused.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    outbound.push(typeof input === 'string' ? input : String(input?.url ?? input));
    throw new Error('k34b: outbound traffic is refused in this suite');
  });
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const pipeline of PIPELINES) if (apps[pipeline]) await apps[pipeline].close();
  for (const usage of aiUsageInstances) usage?.onModuleDestroy?.();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
  for (const key of PROVIDER_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('fixture sanity (real rows)', () => {
  it("two tenants each hold an autonomy profile, goals, a session and a trigger rule, and A's owner has no membership of B", async () => {
    expect(await db.businessAutonomyProfile.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(2);
    expect(await db.aiGoal.count({ where: { businessId: ID.bizA } })).toBe(1 + PIPELINES.length);
    expect(await db.aiGoal.count({ where: { businessId: ID.bizB } })).toBe(PIPELINES.length);
    expect(await db.cortexSession.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(2);
    expect(await db.keyCortexTriggerRule.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(2);
    expect(await db.membership.count({ where: { businessId: ID.bizB, userId: ID.ownerA } })).toBe(0);
    expect(await db.business.count({ where: { id: ID.bizB, ownerId: ID.ownerA } })).toBe(0);
    for (const key of PROVIDER_ENV) expect(process.env[key], key).toBeUndefined();
  });

  it('the Prisma tenant extension is live in this process (production pipeline)', async () => {
    const where = { id: { in: [ID.goalA, goalB('production')] } };
    expect(await db.aiGoal.count({ where })).toBe(2);
    expect(await tenant.runWithTenant(ID.bizA, ID.ownerA, async () => await db.aiGoal.count({ where }))).toBe(1);
  });
});

describe('KEY cortex routes refuse callers the guard does not admit', () => {
  it('a request with no identity is 401 on every route that read the tenant from the query', async () => {
    for (const route of QUERY_TENANT_ROUTES) {
      const res = await send('production', route, { query: { businessId: ID.bizA } });
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("a member of A naming B in the query and nothing in the body is 403 on every such route, and no service runs", async () => {
    const from = calls.production.length;
    for (const route of QUERY_TENANT_ROUTES) {
      const res = await send('production', route, { user: ID.ownerA, query: { businessId: ID.bizB } });
      expect(res.status, `${route.method} ${route.path} ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(tenantsSince('production', from)).toEqual([]);
  });

  it('a user with no membership naming A is 403 on every such route', async () => {
    for (const route of QUERY_TENANT_ROUTES) {
      const res = await send('production', route, { user: ID.nomember, query: { businessId: ID.bizA } });
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
    }
  });

  it('SUPER_ADMIN naming no tenant is refused (400 or 403) on every such route, and no service is called with undefined', async () => {
    const from = calls.production.length;
    for (const route of QUERY_TENANT_ROUTES) {
      expectRefused(route, await send('production', route, { user: ID.superAdmin }));
    }
    expect(tenantsSince('production', from)).toEqual([]);
  });
});

for (const pipeline of PIPELINES) {
  describe(`a member of A sending the JSON body {businessId: A} with ?businessId=B acts on A only, never B - ${PIPELINE_LABEL[pipeline]}`, () => {
    const split = { user: ID.ownerA, query: { businessId: ID.bizB }, body: { businessId: ID.bizA } };

    it('POST voice/speak synthesizes for A and bills A only: no AiUsageLog row under B', async () => {
      const from = calls[pipeline].length;
      const creditsFrom = creditChecks[pipeline].length;
      const aBefore = await usageRows(ID.bizA);
      const bBefore = await usageRows(ID.bizB);
      const res = await send(pipeline, { method: 'post', path: 'voice/speak' }, { ...split, body: { ...split.body, text: 'Hello from k34b' } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const aAfter = await waitForUsage(ID.bizA, aBefore + 1);
      expect(await usageRows(ID.bizB), 'AiUsageLog rows billed to B').toBe(bBefore);
      expect(aAfter, 'AiUsageLog rows billed to A').toBe(aBefore + 1);
      // The plan's credit check runs after the usage row is written.
      await waitFor(() => creditChecks[pipeline].length > creditsFrom);
      expect(creditChecks[pipeline].slice(creditsFrom), 'tenants the credit check was asked about').toEqual([ID.bizA]);
      expectOnlyA(pipeline, from);
    });

    it("GET autonomy-profile returns A's profile, never B's", async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'get', path: 'autonomy-profile' }, split);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.businessId).toBe(ID.bizA);
      expect(res.body.maxDailyAutoActions).not.toBe(B_MAX_DAILY);
      expectOnlyA(pipeline, from);
    });

    it("PATCH autonomy-profile updates A's profile only; B's is unchanged", async () => {
      const from = calls[pipeline].length;
      const value = pipeline === 'production' ? 12 : 13;
      const res = await send(pipeline, { method: 'patch', path: 'autonomy-profile' }, { ...split, body: { ...split.body, maxDailyAutoActions: value } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.businessId).toBe(ID.bizA);
      expect((await db.businessAutonomyProfile.findUnique({ where: { businessId: ID.bizA } })).maxDailyAutoActions).toBe(value);
      expectOnlyA(pipeline, from);
      expect((await db.businessAutonomyProfile.findUnique({ where: { businessId: ID.bizB } })).maxDailyAutoActions).toBe(B_MAX_DAILY);
    });

    it("GET goals lists A's goals only", async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'get', path: 'goals' }, split);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.map((g: any) => g.businessId)).not.toContain(ID.bizB);
      expect(res.body.map((g: any) => g.id)).toContain(ID.goalA);
      expect(JSON.stringify(res.body)).not.toContain(B_MARKER);
      expectOnlyA(pipeline, from);
    });

    it("DELETE goals/:goalId of one of B's goals answers 404 (A has no such goal), and B's goal survives", async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'delete', path: `goals/${goalB(pipeline)}` }, split);
      // A's tenant has no such goal.
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(await db.aiGoal.count({ where: { id: goalB(pipeline), businessId: ID.bizB } })).toBe(1);
      expectOnlyA(pipeline, from);
    });

    it("GET triggers lists A's rules only", async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'get', path: 'triggers' }, split);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.map((r: any) => r.id)).toEqual([ID.ruleA]);
      expectOnlyA(pipeline, from);
    });

    it("GET sessions lists A's sessions only", async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'get', path: 'sessions' }, split);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).toContain(ID.sessionA);
      expect(ids).not.toContain(ID.sessionB);
      expectOnlyA(pipeline, from);
    });

    it('GET conscious/stream (a session write) creates the session under A and writes nothing under B', async () => {
      const from = calls[pipeline].length;
      const aBefore = await db.cortexSession.count({ where: { businessId: ID.bizA, userId: ID.ownerA } });
      const res = await consciousStream(pipeline, ID.ownerA, { businessId: ID.bizB, text: 'Hello from k34b', userId: ID.ownerA }, split.body);
      expect(res.status, String(res.body)).toBe(200);
      expect(String(res.body)).toContain('k34b answer');
      expect(await db.cortexSession.count({ where: { businessId: ID.bizA, userId: ID.ownerA } })).toBe(aBefore + 1);
      expectOnlyA(pipeline, from);
      expect(await db.cortexSession.count({ where: { businessId: ID.bizB, userId: ID.ownerA } })).toBe(0);
    });

    it('GET awareness reads A only', async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'get', path: 'awareness' }, split);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expectOnlyA(pipeline, from);
    });

    it('POST voice/listen with ?businessId=B and a multipart field naming A is refused 403: the guard never sees the multipart body', async () => {
      const from = calls[pipeline].length;
      const res = await request(apps[pipeline]!.getHttpServer())
        .post('/api/v1/cortex/voice/listen')
        .query({ businessId: ID.bizB })
        .set(HEADER, ID.ownerA)
        .field('businessId', ID.bizA)
        .attach('audio', Buffer.from(`${P}audio`, 'utf8'), { filename: `${P}utterance.webm`, contentType: 'audio/webm' });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(tenantsSince(pipeline, from)).toEqual([]);
    });

    it('POST voice/listen with ?businessId=A and a multipart field naming B is refused 403 and transcribes nothing for B', async () => {
      const from = calls[pipeline].length;
      const aBefore = await usageRows(ID.bizA);
      const bBefore = await usageRows(ID.bizB);
      const res = await request(apps[pipeline]!.getHttpServer())
        .post('/api/v1/cortex/voice/listen')
        .query({ businessId: ID.bizA })
        .set(HEADER, ID.ownerA)
        .field('businessId', ID.bizB)
        .attach('audio', Buffer.from(`${P}audio`, 'utf8'), { filename: `${P}utterance.webm`, contentType: 'audio/webm' });
      // At the base the handler read the query (A), which the guard had checked; a
      // naive @GuardedBusinessId() would re-resolve after multer and act on B.
      // multipartTenant refuses the conflicting field instead.
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(tenantsSince(pipeline, from)).toEqual([]);
      await new Promise((r) => setTimeout(r, 200));
      expect(await usageRows(ID.bizB), 'AiUsageLog rows billed to B').toBe(bBefore);
      expect(await usageRows(ID.bizA), 'AiUsageLog rows billed to A').toBe(aBefore);
    });
  });

  describe(`same-tenant positive controls - ${PIPELINE_LABEL[pipeline]}`, () => {
    const own = { user: ID.ownerA, query: { businessId: ID.bizA } };

    it("A's owner naming A in the query: voice/speak answers 200 and bills A", async () => {
      const from = calls[pipeline].length;
      const aBefore = await usageRows(ID.bizA);
      const res = await send(pipeline, { method: 'post', path: 'voice/speak' }, { ...own, body: { text: 'Hello from k34b' } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers['content-type']).toContain('audio/mpeg');
      expect(await waitForUsage(ID.bizA, aBefore + 1)).toBe(aBefore + 1);
      expectOnlyA(pipeline, from);
    });

    it("A's owner naming A reads A's autonomy profile, goals, trigger rules, sessions and awareness", async () => {
      const from = calls[pipeline].length;
      const profile = await send(pipeline, { method: 'get', path: 'autonomy-profile' }, own);
      expect(profile.status, JSON.stringify(profile.body)).toBe(200);
      expect(profile.body.businessId).toBe(ID.bizA);

      const goals = await send(pipeline, { method: 'get', path: 'goals' }, own);
      expect(goals.status).toBe(200);
      expect(goals.body.map((g: any) => g.id)).toContain(ID.goalA);

      const goal = await send(pipeline, { method: 'get', path: `goals/${ID.goalA}` }, own);
      expect(goal.status, JSON.stringify(goal.body)).toBe(200);
      expect(goal.body.id).toBe(ID.goalA);

      const triggers = await send(pipeline, { method: 'get', path: 'triggers' }, own);
      expect(triggers.status).toBe(200);
      expect(triggers.body.map((r: any) => r.id)).toEqual([ID.ruleA]);

      const sessions = await send(pipeline, { method: 'get', path: 'sessions' }, own);
      expect(sessions.status).toBe(200);
      expect(sessions.body.map((s: any) => s.id)).toContain(ID.sessionA);

      const awareness = await send(pipeline, { method: 'get', path: 'awareness' }, own);
      expect(awareness.status, JSON.stringify(awareness.body)).toBe(200);
      expectOnlyA(pipeline, from, 6);
    });

    it("A's owner naming A updates A's autonomy profile, deletes A's own goal and writes A's session", async () => {
      const from = calls[pipeline].length;
      // apps/web sends this PATCH with businessId in the JSON body (client.ts).
      const patch = await send(pipeline, { method: 'patch', path: 'autonomy-profile' }, { ...own, body: { businessId: ID.bizA, maxDailyAutoActions: A_MAX_DAILY } });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);
      expect(patch.body).toMatchObject({ businessId: ID.bizA, maxDailyAutoActions: A_MAX_DAILY });

      const del = await send(pipeline, { method: 'delete', path: `goals/${goalADeletable(pipeline)}` }, own);
      expect(del.status, JSON.stringify(del.body)).toBe(200);
      expect(del.body).toEqual({ success: true, deletedId: goalADeletable(pipeline) });
      expect(await db.aiGoal.count({ where: { id: goalADeletable(pipeline) } })).toBe(0);

      const aBefore = await db.cortexSession.count({ where: { businessId: ID.bizA, userId: ID.ownerA } });
      const stream = await consciousStream(pipeline, ID.ownerA, { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA });
      expect(stream.status).toBe(200);
      expect(String(stream.body)).toContain('k34b answer');
      expect(await db.cortexSession.count({ where: { businessId: ID.bizA, userId: ID.ownerA } })).toBe(aBefore + 1);
      expectOnlyA(pipeline, from, 3);
    });
  });

  /*
   * Review ST-1. KeyCortexConversationService.getSession and
   * KeyCortexSessionService.getOrCreateSession read the Redis entry
   * `cortex:session:<id>` before the database and check no tenant there; the
   * Prisma tenant extension scopes only the database fallback. So once B's
   * session is cached (B's own traffic does that, for 24h, refreshed on every
   * access), a member of A naming B's session id read B's messages and ran the
   * conscious pipeline, chat and both streams on B's session. Every handler
   * that takes a client session id now refuses one that belongs to another
   * tenant (404, or an `error` event once an SSE stream is committed), and
   * hands the services only a session id it found in the guard-checked tenant.
   */
  describe(`a session id naming another tenant's session is refused, cached or not (review ST-1) - ${PIPELINE_LABEL[pipeline]}`, () => {
    const cache = () => caches[pipeline];
    /** B's own owner reads B's session: the cache now holds it, as in production. */
    const warmB = async () => {
      const res = await send(pipeline, { method: 'get', path: 'messages' }, { user: ID.ownerB, query: { businessId: ID.bizB, sessionId: ID.sessionB } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(cache().has(sessionKey(ID.sessionB)), "B's session is cached").toBe(true);
      return res;
    };
    const bMessages = async () => JSON.stringify((await db.cortexSession.findUnique({ where: { id: ID.sessionB } })).messages);
    const cachedBMessages = () => JSON.stringify(JSON.parse(cache().get(sessionKey(ID.sessionB)) ?? '{}').messages);
    const sse = (path: string, user: string, query: Record<string, string>) =>
      request(apps[pipeline]!.getHttpServer()).get(`/api/v1/cortex/${path}`).set(HEADER, user).query(query).buffer(true).parse(collectText);

    it("B's owner reading B's own session caches it and gets B's messages (positive control)", async () => {
      const res = await warmB();
      expect(JSON.stringify(res.body)).toContain(B_MARKER);
    });

    it("GET messages naming B's session is 404 with B's session cached, and 404 with it cold; none of B's messages is returned", async () => {
      await warmB();
      const warm = await send(pipeline, { method: 'get', path: 'messages' }, { user: ID.ownerA, query: { businessId: ID.bizA, sessionId: ID.sessionB } });
      expect(warm.status, JSON.stringify(warm.body)).toBe(404);
      expect(JSON.stringify(warm.body)).not.toContain(B_MARKER);

      cache().delete(sessionKey(ID.sessionB));
      const cold = await send(pipeline, { method: 'get', path: 'messages' }, { user: ID.ownerA, query: { businessId: ID.bizA, sessionId: ID.sessionB } });
      expect(cold.status, JSON.stringify(cold.body)).toBe(404);
      expect(JSON.stringify(cold.body)).not.toContain(B_MARKER);
    });

    it("GET conscious/stream naming B's cached session runs nothing on B's session and appends nothing to it", async () => {
      await warmB();
      const dbBefore = await bMessages();
      const cacheBefore = cachedBMessages();
      const bSessions = await db.cortexSession.count({ where: { businessId: ID.bizB } });
      const from = consciousCalls[pipeline].length;
      const res = await sse('conscious/stream', ID.ownerA, { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionB });
      expectSessionRefusedSse(pipeline, res);
      expect(String(res.body)).not.toContain('k34b answer');
      expect(String(res.body)).not.toContain(B_MARKER);
      expect(consciousCalls[pipeline].slice(from), 'sessions handed to the conscious pipeline').toEqual([]);
      expect(await bMessages()).toBe(dbBefore);
      expect(cachedBMessages()).toBe(cacheBefore);
      expect(await db.cortexSession.count({ where: { businessId: ID.bizB } })).toBe(bSessions);
    });

    it("POST conscious/chat naming B's cached session is 404 and runs nothing on it", async () => {
      await warmB();
      const from = consciousCalls[pipeline].length;
      const res = await send(pipeline, { method: 'post', path: 'conscious/chat' }, {
        user: ID.ownerA, query: { businessId: ID.bizA },
        body: { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionB },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(B_MARKER);
      expect(consciousCalls[pipeline].slice(from)).toEqual([]);
    });

    it("POST chat naming B's cached session is 404 and never reaches the reasoning engine", async () => {
      await warmB();
      const from = reasoningCalls[pipeline].length;
      const res = await send(pipeline, { method: 'post', path: 'chat' }, {
        user: ID.ownerA, query: { businessId: ID.bizA },
        body: { businessId: ID.bizA, userId: ID.ownerA, text: 'Hello from k34b', sessionId: ID.sessionB },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(reasoningCalls[pipeline].slice(from)).toEqual([]);
    });

    it("GET chat/stream and GET stream naming B's cached session refuse in the stream and never hand B's session to the reasoning engine", async () => {
      await warmB();
      const from = reasoningCalls[pipeline].length;
      const chat = await sse('chat/stream', ID.ownerA, { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionB });
      expectSessionRefusedSse(pipeline, chat);
      expect(String(chat.body)).not.toContain('text_delta');

      // stream maps every failure, this one included, to an error chunk inside its own 200 stream.
      const stream = await sse('stream', ID.ownerA, { businessId: ID.bizA, message: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionB });
      expect(stream.status).toBe(200);
      expect(String(stream.body)).toMatch(/"type":"error"[^\n]*"content":"Session not found"/);
      expect(String(stream.body)).not.toContain('k34b answer');
      expect(reasoningCalls[pipeline].slice(from), 'queries handed to the reasoning engine').toEqual([]);
    });

    it("A's owner naming A's own cached session: messages, conscious chat and stream, chat and both streams use that session (positive control)", async () => {
      const own = { user: ID.ownerA, query: { businessId: ID.bizA, sessionId: ID.sessionA } };
      const messages = await send(pipeline, { method: 'get', path: 'messages' }, own);
      expect(messages.status, JSON.stringify(messages.body)).toBe(200);
      expect(JSON.stringify(messages.body)).toContain('k34b A message');
      expect(cache().has(sessionKey(ID.sessionA))).toBe(true);

      const consciousFrom = consciousCalls[pipeline].length;
      const stream = await sse('conscious/stream', ID.ownerA, { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionA });
      expect(String(stream.body)).toContain('k34b answer');
      const chat = await send(pipeline, { method: 'post', path: 'conscious/chat' }, {
        user: ID.ownerA, query: { businessId: ID.bizA },
        body: { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionA },
      });
      expect(chat.status, JSON.stringify(chat.body)).toBe(200);
      expect(chat.body.text).toBe('k34b answer');
      expect(consciousCalls[pipeline].slice(consciousFrom)).toEqual([
        { sessionId: ID.sessionA, businessId: ID.bizA },
        { sessionId: ID.sessionA, businessId: ID.bizA },
      ]);

      const reasoningFrom = reasoningCalls[pipeline].length;
      const post = await send(pipeline, { method: 'post', path: 'chat' }, {
        user: ID.ownerA, query: { businessId: ID.bizA },
        body: { businessId: ID.bizA, userId: ID.ownerA, text: 'Hello from k34b', sessionId: ID.sessionA },
      });
      expect(post.status, JSON.stringify(post.body)).toBe(200);
      // chat/stream writes its chunks as bare events (no data field), so only the call record shows the session.
      const chatStream = await sse('chat/stream', ID.ownerA, { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionA });
      expect(chatStream.status).toBe(200);
      expect(String(chatStream.body)).not.toContain('Session not found');
      const events = await sse('stream', ID.ownerA, { businessId: ID.bizA, message: 'Hello from k34b', userId: ID.ownerA, sessionId: ID.sessionA });
      expect(String(events.body)).toContain('k34b answer');
      expect(reasoningCalls[pipeline].slice(reasoningFrom)).toEqual([
        { method: 'processQuery', sessionId: ID.sessionA, businessId: ID.bizA },
        { method: 'streamQuery', sessionId: ID.sessionA, businessId: ID.bizA },
        { method: 'streamQuery', sessionId: ID.sessionA, businessId: ID.bizA },
      ]);
    });

    it('a session id found nowhere still starts a new session under A, and no service is handed the unverified id', async () => {
      const unknown = `${P}no_such_session_${pipeline}`;
      const aBefore = await db.cortexSession.count({ where: { businessId: ID.bizA } });
      const consciousFrom = consciousCalls[pipeline].length;
      const stream = await sse('conscious/stream', ID.ownerA, { businessId: ID.bizA, text: 'Hello from k34b', userId: ID.ownerA, sessionId: unknown });
      expect(String(stream.body)).toContain('k34b answer');
      const handed = consciousCalls[pipeline].slice(consciousFrom);
      expect(handed).toHaveLength(1);
      expect(handed[0].businessId).toBe(ID.bizA);
      expect(handed[0].sessionId).not.toBe(unknown);
      expect(await db.cortexSession.count({ where: { businessId: ID.bizA } })).toBe(aBefore + 1);

      const reasoningFrom = reasoningCalls[pipeline].length;
      const post = await send(pipeline, { method: 'post', path: 'chat' }, {
        user: ID.ownerA, query: { businessId: ID.bizA },
        body: { businessId: ID.bizA, userId: ID.ownerA, text: 'Hello from k34b', sessionId: unknown },
      });
      expect(post.status, JSON.stringify(post.body)).toBe(200);
      expect(reasoningCalls[pipeline].slice(reasoningFrom)).toEqual([{ method: 'processQuery', sessionId: undefined, businessId: ID.bizA }]);
    });
  });

  /*
   * Review ST-2. Five body handlers typed their @Body() as an intersection
   * (`Dto & { businessId }`), which tsc emits as `Object`, so the global
   * ValidationPipe skipped them: no validation, no whitelist, and a body
   * businessId that is not a string reached the service raw while the guard
   * (which skips a non-string candidate) had checked the query's tenant. They
   * take the class DTO and @GuardedBusinessId() now.
   */
  describe(`a body businessId that is not a string never reaches a service (review ST-2) - ${PIPELINE_LABEL[pipeline]}`, () => {
    const objectTenant = { not: 'zz' };

    it("PATCH triggers/<B's rule>?businessId=A with the body {businessId: {not: 'zz'}, enabled: false} is refused 400 and B's rule stays enabled", async () => {
      const from = calls[pipeline].length;
      const res = await send(pipeline, { method: 'patch', path: `triggers/${ID.ruleB}` }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: objectTenant, enabled: false },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(B_MARKER);
      expect((await db.keyCortexTriggerRule.findUnique({ where: { id: ID.ruleB } })).enabled).toBe(true);
      expect(tenantsSince(pipeline, from)).toEqual([]);
    });

    it("PATCH autonomy-profile?businessId=A with the body {businessId: {not: 'zz'}, maxDailyAutoActions} updates A's profile only", async () => {
      const from = calls[pipeline].length;
      const value = pipeline === 'production' ? 14 : 15;
      const res = await send(pipeline, { method: 'patch', path: 'autonomy-profile' }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: objectTenant, maxDailyAutoActions: value },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.businessId).toBe(ID.bizA);
      expect((await db.businessAutonomyProfile.findUnique({ where: { businessId: ID.bizA } })).maxDailyAutoActions).toBe(value);
      expect((await db.businessAutonomyProfile.findUnique({ where: { businessId: ID.bizB } })).maxDailyAutoActions).toBe(B_MAX_DAILY);
      expectOnlyA(pipeline, from);
    });

    it('POST goals, POST plans and POST goals/:goalId/plans with a non-string body businessId are refused 400 before the planner runs, and write no goal', async () => {
      const from = calls[pipeline].length;
      const title = `k34b object-tenant goal (${pipeline})`;
      const goal = await send(pipeline, { method: 'post', path: 'goals' }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: objectTenant, title },
      });
      expect(goal.status, JSON.stringify(goal.body)).toBe(400);
      const plan = await send(pipeline, { method: 'post', path: 'plans' }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: objectTenant, objective: 'k34b objective' },
      });
      expect(plan.status, JSON.stringify(plan.body)).toBe(400);
      const fromGoal = await send(pipeline, { method: 'post', path: `goals/${goalB(pipeline)}/plans` }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: objectTenant },
      });
      expect(fromGoal.status, JSON.stringify(fromGoal.body)).toBe(400);
      expect(JSON.stringify(fromGoal.body)).not.toContain(B_MARKER);
      expect(await db.aiGoal.count({ where: { title } })).toBe(0);
      expect(tenantsSince(pipeline, from)).toEqual([]);
    });

    it('SUPER_ADMIN naming no tenant is refused 400 by the five body handlers, and no service runs', async () => {
      const from = calls[pipeline].length;
      for (const [method, path, body] of [
        ['post', 'goals', { title: 'k34b super goal' }],
        ['post', `goals/${ID.goalA}/plans`, {}],
        ['post', 'plans', { objective: 'k34b objective' }],
        ['patch', `triggers/${ID.ruleA}`, { enabled: false }],
        ['patch', 'autonomy-profile', { maxDailyAutoActions: 1 }],
      ] as const) {
        const res = await send(pipeline, { method, path }, { user: ID.superAdmin, body: body as Record<string, unknown> });
        expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBe(400);
      }
      expect(tenantsSince(pipeline, from)).toEqual([]);
      expect((await db.keyCortexTriggerRule.findUnique({ where: { id: ID.ruleA } })).enabled).toBe(true);
    });

    it("A's owner naming A: POST goals creates A's goal and PATCH triggers/<A's rule> updates A's rule (positive control)", async () => {
      const from = calls[pipeline].length;
      const title = `k34b A created goal (${pipeline})`;
      const goal = await send(pipeline, { method: 'post', path: 'goals' }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: ID.bizA, title, priority: 2 },
      });
      expect(goal.status, JSON.stringify(goal.body)).toBe(201);
      expect(goal.body).toMatchObject({ businessId: ID.bizA, title, priority: 2 });

      const rule = await send(pipeline, { method: 'patch', path: `triggers/${ID.ruleA}` }, {
        user: ID.ownerA, query: { businessId: ID.bizA }, body: { businessId: ID.bizA, enabled: false },
      });
      expect(rule.status, JSON.stringify(rule.body)).toBe(200);
      expect(rule.body).toMatchObject({ id: ID.ruleA, businessId: ID.bizA, enabled: false });
      await db.keyCortexTriggerRule.update({ where: { id: ID.ruleA }, data: { enabled: true } });
      expectOnlyA(pipeline, from, 2);
    });
  });
}

describe('nothing left the process (suite-wide)', () => {
  it('KEY voice reached the recording transport, every provider request went there, and no global fetch was sent', () => {
    expect(sdk.requests.length).toBeGreaterThan(0);
    for (const r of sdk.requests) {
      expect(r.authorization).toBe(`Bearer ${NOT_A_KEY}`);
      expect(r.url).toMatch(/\/audio\/(speech|transcriptions)$/);
    }
    expect(outbound).toEqual([]);
  });
});
