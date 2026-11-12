/**
 * R0-07a-AI-DIRECT-503 — AI calls that bypass the model gateway fail visibly
 * (REAL database, REAL CRM import chain, REAL AiUsageService, REAL KEY voice
 * service, REAL OpenAI SDK constructor). COST-LEDGER-001 section 4 and
 * section 7 item 1; the R0-07 principle (issue #186 step 7): an optional
 * service that is not configured answers a structured 503, on its own.
 *
 * Release 0 runs with no OpenAI key. R0-07 made the model gateway answer
 * 503 { code: 'provider_not_configured', details: { service: 'ai' } }, but two
 * services call OpenAI directly and were outside its write set:
 *
 *   AiUsageService.trackEmbedding / trackVision / trackAudio built `new OpenAI`
 *   with no key, so the SDK constructor threw a plain OpenAIError; and
 *   KeyCortexVoiceService built its client with the sentinel key 'sk-no-key',
 *   so every synthesis or transcription went out to OpenAI and failed there
 *   (401 in production).
 *
 * Routes that reach them (found by grep over the controllers):
 *
 *   POST /crm/businesses/:b/import/scan                 trackVision, error passed through   -> proven here
 *   POST /voice/businesses/:b/tts                       trackAudio via OpenAiVoiceProvider   -> proven here (R0-34b: code kept)
 *   POST /keyflow/businesses/:b/voice/tts|transcribe    trackAudio via KeyflowVoiceService   -> proven here (R0-34b: code kept)
 *   POST /commerce/businesses/:b/products/import/scan   trackVision via CommerceVisionService      -> proven here (W7-AI-SERVICES-503)
 *   GET  /ai/businesses/:b/agent/memory/search, POST .../agent/memory/backfill
 *                                                       trackEmbedding via SemanticMemoryService   -> proven here (W7-AI-SERVICES-503)
 *   POST /api/v1/cortex/voice/speak, /voice/listen      KeyCortexVoiceService                -> proven here (R0-34b: code kept)
 *   KeyCortexPhoneService (Twilio call flows)           KeyCortexVoiceService                (Twilio itself is off in Release 0)
 *
 * In that environment:
 *
 *   POST /crm/businesses/:b/import/scan       -> 503 { code: 'provider_not_configured', details.service: 'ai' }
 *   POST /voice/businesses/:b/tts             -> 503, no OpenAI client built
 *   POST /api/v1/cortex/voice/speak, /listen  -> 503, and no request leaves with the sentinel key
 *
 * R0-34b-KEY-TENANT-BINDING (COST-LEDGER-001 section 7 items 7 and 9) closed
 * three of this suite's it.todo cases: OpenAiVoiceProvider, KeyflowVoiceService
 * and KeyCortexController.speak/listen now rethrow the provider_not_configured
 * 503 unchanged (every other error keeps its old 503 wrapper), and speak/listen
 * take the tenant BusinessGuard checked (@GuardedBusinessId) instead of the
 * query. Review ST-3: a caller the guards refuse (no identity, no membership,
 * another business) gets 401/403 on every direct-AI route, never the 503 that
 * says this deployment has no AI key. Review nit CR-N1: a case that checks for
 * traces makes its own call instead of reading the previous case's.
 *
 * W7-AI-SERVICES-503 (Release 0 exit; COST-LEDGER-001 section 7 item 7, last
 * two bullets) closed the suite's last two it.todo cases under the R0-07a rule:
 * CommerceVisionService.extractProductsFromImage caught every error and
 * returned no products (a keyless scan answered 201 {extracted: [], count: 0}),
 * and SemanticMemoryService.search / backfillFromAiMemory logged the error and
 * answered an empty 200 / {backfilled: 0}. They now rethrow the provider 503
 * (provider_not_configured or provider_unavailable) unchanged; every other
 * error keeps its old mapping (no products, empty results, the memory skipped).
 *
 * and nothing is billed: no AiUsageLog row, no contact or import trace. With a
 * key configured (the SDK transport stubbed) import/scan is unchanged: 201,
 * the extracted contact, one AiUsageLog row.
 *
 * Review ST-1: a member of another business that names this business only in
 * the query string is refused 403 by BusinessGuard on the KEY voice routes.
 * The handlers used to read the query, not the tenant the guard checked, so a
 * JSON body businessId split the two (COST-LEDGER-001 section 7 item 9; fixed
 * by R0-34b, proven below and in key-cortex-tenant-binding.integration.test.ts).
 *
 * RED-BEFORE for W7-AI-SERVICES-503 (recorded in its tests-first commit): on
 * pkt/W7-KEY-CONNECTOR-TENANT-repair the product scan answered 201
 * {extracted: [], count: 0}, memory search 200 {results: []} and memory
 * backfill 201 {backfilled: 0} with no OpenAI key, and backfill tried every
 * memory.
 *
 * RED-BEFORE (recorded in the tests-first commit): on the unmodified code
 * import/scan answers 500 INTERNAL_SERVER_ERROR (the SDK constructor's
 * OpenAIError), voice/tts attempted to build a client with no key, and the KEY
 * voice routes sent POST .../audio/speech and .../audio/transcriptions with
 * `Authorization: Bearer sk-no-key`.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, FeatureFlagGuard, PlanLimitGuard, the production
 * GlobalHttpExceptionFilter and ValidationPipe, multer (FileInterceptor),
 * CrmController, CrmImportService, CrmService, EntityResolutionService,
 * CrmStatsService, CrmTimelineService, ContactAuditService, AiUsageService,
 * VoiceController, VoiceService, OpenAiVoiceProvider, KeyflowCommandController,
 * KeyflowVoiceService, KeyCortexController and KeyCortexVoiceService,
 * CommerceController and CommerceVisionService, AgentController and
 * SemanticMemoryService (W7-AI-SERVICES-503), and the
 * OpenAI SDK itself (constructor, request
 * building, error handling). Stand-ins: identity attachment (a test middleware
 * reads `x-k07c-user` and attaches the seeded user row, as the Supabase
 * AuthMiddleware would); the SDK's HTTP transport (its `fetch` option: every
 * request is recorded and refused, or answered by a canned completion in the
 * keyed case; maxRetries 0); globalThis.fetch (recorded and refused); the plan
 * (unlimited); output templates and the model gateway (off the direct path);
 * the CRM side channels as in contacts-import-write-scope; the collaborators
 * KeyflowCommandController and KeyCortexController hold for their other routes
 * (empty stand-ins, and an allow-listed mocker; any other missing token fails
 * the compile; CommerceController's and AgentController's collaborators for
 * their other routes likewise); and, in the cases that say so, a spy that makes one call fail
 * with a provider error. Vitest's
 * esbuild transform emits no constructor parameter types, so the suite writes
 * the ones tsc emits for VoiceController and KeyCortexController, as
 * cortex-audit-tenant.integration.test.ts does.
 *
 * Every variable the direct OpenAI paths read is removed from process.env
 * before the services are constructed and restored afterwards. No real key is
 * ever set.
 *
 * Fixtures: prefix `k07c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in dependency order in beforeAll
 * and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k07c_';
const HEADER = 'x-k07c-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  /** OWNER of `bizOther` only: no membership of `biz` (review ST-1 negative control). */
  outsider: `${P}outsider`,
  bizOther: `${P}biz_other`,
  /** No business anywhere (review ST-3). */
  nomember: `${P}nomember`,
};
const SCAN_EMAIL = `${P}scan@test.local`;
/** Not a real key: the keyed case's requests go to the stub transport only. */
const FAKE_KEY = `${P}test-not-a-real-key`;

/** Every variable the direct OpenAI paths (and the voice providers) read. */
const PROVIDER_ENV = [
  'AI_INTEGRATIONS_OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'ELEVENLABS_API_KEY', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

/**
 * The OpenAI SDK, real, over a recording transport. `attempts` records every
 * `new OpenAI(options)` before the real constructor runs; `requests` records
 * every request a client sent (URL, method, Authorization header). With no
 * `respond` handler a request is refused, as an unreachable network would.
 */
const sdk = vi.hoisted(() => ({
  attempts: [] as Array<{ apiKey?: string }>,
  requests: [] as Array<{ url: string; method: string; authorization: string }>,
  respond: null as null | ((url: string) => unknown),
}));

vi.mock('openai', async (importOriginal) => {
  const actual: any = await importOriginal();
  const RealOpenAI = actual.default;
  const transport = async (url: unknown, init: any = {}) => {
    const headers = init.headers ?? {};
    const authorization = String(
      typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization ?? headers.authorization ?? '',
    );
    sdk.requests.push({ url: String(url), method: String(init.method ?? 'GET'), authorization });
    if (sdk.respond) return sdk.respond(String(url));
    throw new TypeError('k07c: outbound traffic is refused in this suite');
  };
  class RecordingOpenAI extends RealOpenAI {
    constructor(options: any = {}) {
      sdk.attempts.push({ apiKey: options.apiKey });
      super({ ...options, fetch: transport, maxRetries: 0 });
    }
  }
  return { ...actual, default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

/** KeyCortexController's collaborators for its other routes; the voice routes reach none of them. */
const CORTEX_CONTROLLER_OFF_BOUNDARY = new Set([
  'KeyCortexReasoningService', 'KeyCortexConversationService', 'KeyCortexPersonalityService', 'KeyCortexActionsService',
  'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService', 'KeyCortexExecutorService',
  'KeyCortexContextV2Service', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service', 'KeyCortexSandboxService',
  'KeyCortexFlowStudioService', 'KeyCortexEvolutionService', 'KeyCortexPhoneService', 'KeyCortexDocumentService',
  'KeyCortexLearningService', 'KeyAutonomySafetyService', 'KeyCortexApprovalOrchestratorService',
  'KeyCortexConsciousnessService', 'KeyCortexSessionService', 'KeyCortexAwarenessService',
]);

/**
 * W7-AI-SERVICES-503: CommerceController's and AgentController's collaborators
 * for their other routes; products/import/scan reaches only CommerceVisionService,
 * agent/memory/search and /backfill only SemanticMemoryService.
 */
const COMMERCE_AND_AGENT_OFF_BOUNDARY = new Set([
  'CommerceService', 'TimeEntryService', 'InvoiceReceiptBuilderService', 'GmailService', 'StoreReadinessService',
  'PaymentEvidenceService', 'FinanceSettingsService',
  'AgentStateMachineService', 'AgentBusService', 'PatternDetectorService', 'UndoService', 'CalendarIntelligenceService',
  'DocumentIntelligenceService',
]);

let db: any;
let app: any;
let aiUsage: any;
/** The KEY voice service instance the app serves (spied on in the cases that say so). */
let keyVoice: any;
/** OpenAI clients built while the app was compiled (the KEY voice service builds its own at construction). */
let attemptsAtBoot: Array<{ apiKey?: string }> = [];
/** Every globalThis.fetch the process attempted during the suite (refused). */
const outbound: string[] = [];

/** A fresh client address per request: each gets its own CRM rate-limit bucket. */
let ipN = 0;
const nextIp = () => `10.7.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_import_contacts WHERE import_id IN (SELECT id FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_media WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_usage_alerts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_usage_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memory_embeddings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function scan() {
  return agent()
    .post(`/crm/businesses/${ID.biz}/import/scan`)
    .set(HEADER, ID.owner)
    .set('x-forwarded-for', nextIp())
    .attach('image', Buffer.from(`${P}not-really-a-jpeg`, 'utf8'), { filename: `${P}card.jpg`, contentType: 'image/jpeg' });
}

/** POST /voice/businesses/:b/tts (OpenAiVoiceProvider). */
function voiceTts(user?: string) {
  const req = agent().post(`/voice/businesses/${ID.biz}/tts`);
  return (user ? req.set(HEADER, user) : req).send({ text: 'Hello from k07c', provider: 'openai' });
}

/** POST /keyflow/businesses/:b/voice/tts (KeyflowVoiceService.synthesize). */
function keyflowTts(user?: string) {
  const req = agent().post(`/keyflow/businesses/${ID.biz}/voice/tts`);
  return (user ? req.set(HEADER, user) : req).send({ text: 'Hello from k07c' });
}

/** POST /keyflow/businesses/:b/voice/transcribe (KeyflowVoiceService.transcribe). */
function keyflowTranscribe(user?: string) {
  const req = agent().post(`/keyflow/businesses/${ID.biz}/voice/transcribe`);
  return (user ? req.set(HEADER, user) : req)
    .attach('audio', Buffer.from(`${P}audio`, 'utf8'), { filename: `${P}utterance.webm`, contentType: 'audio/webm' });
}

/** POST /api/v1/cortex/voice/speak (KeyCortexController.speak). */
function speak(user: string | undefined, businessId: string, body: Record<string, unknown> = {}) {
  const req = agent().post('/api/v1/cortex/voice/speak').query({ businessId });
  return (user ? req.set(HEADER, user) : req).send({ text: 'Hello from k07c', persona: 'jarvis', ...body });
}

/** POST /api/v1/cortex/voice/listen (KeyCortexController.listen), optionally with a multipart businessId field. */
function listen(user: string | undefined, businessId: string, field?: string) {
  let req = agent().post('/api/v1/cortex/voice/listen').query({ businessId });
  if (user) req = req.set(HEADER, user);
  if (field) req = req.field('businessId', field);
  return req.attach('audio', Buffer.from(`${P}audio`, 'utf8'), { filename: `${P}utterance.webm`, contentType: 'audio/webm' });
}

/** POST /commerce/businesses/:b/products/import/scan (CommerceVisionService.extractProductsFromImage). */
function productScan(user?: string) {
  const req = agent().post(`/commerce/businesses/${ID.biz}/products/import/scan`);
  return (user ? req.set(HEADER, user) : req)
    .attach('image', Buffer.from(`${P}not-really-a-menu`, 'utf8'), { filename: `${P}menu.jpg`, contentType: 'image/jpeg' });
}

/** GET /ai/businesses/:b/agent/memory/search (SemanticMemoryService.search). */
function memorySearch(user?: string) {
  const req = agent().get(`/ai/businesses/${ID.biz}/agent/memory/search`).query({ q: 'k07c opening hours' });
  return user ? req.set(HEADER, user) : req;
}

/** POST /ai/businesses/:b/agent/memory/backfill (SemanticMemoryService.backfillFromAiMemory). */
function memoryBackfill(user?: string) {
  const req = agent().post(`/ai/businesses/${ID.biz}/agent/memory/backfill`);
  return user ? req.set(HEADER, user) : req;
}

/** Semantic memory embeddings stored for the business (a raw table: the vector column is Unsupported in Prisma). */
async function embeddingRows(): Promise<number> {
  const rows: Array<{ n: bigint | number }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*) AS n FROM ai_memory_embeddings WHERE business_id = $1`,
    ID.biz,
  );
  return Number(rows[0]?.n ?? 0);
}

/** The 503 a voice wrapper answers for a provider error that is not a missing or unavailable provider. */
function expectRewrapped(res: { status: number; body: any }, message: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.body.message).toBe(message);
  expect(['provider_not_configured', 'provider_unavailable']).not.toContain(res.body.code);
}

/** The structured 503 an unconfigured optional service answers, through the production filter (R0-07). */
function expectNotConfigured(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.body.statusCode).toBe(503);
  expect(res.body.code).toBe('provider_not_configured');
  expect(res.body.details?.service).toBe('ai');
  expect(typeof res.body.message).toBe('string');
  expect(res.body.message.length).toBeGreaterThan(0);
}

/** Rows a direct AI call (and the import it serves) would leave for the business. */
async function traces() {
  return {
    usageLogs: await db.aiUsageLog.count({ where: { businessId: ID.biz } }),
    contacts: await db.contact.count({ where: { businessId: ID.biz } }),
    imports: await db.contactImport.count({ where: { businessId: ID.biz } }),
    contactEvents: await db.contactEvent.count({ where: { businessId: ID.biz } }),
  };
}
const NO_TRACES = { usageLogs: 0, contacts: 0, imports: 0, contactEvents: 0 };

beforeAll(async () => {
  for (const key of PROVIDER_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
  const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
  const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
  const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
  const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { VoiceController } = await import('../src/modules/voice/voice.controller');
  const { VoiceService } = await import('../src/modules/voice/voice.service');
  const { OpenAiVoiceProvider } = await import('../src/modules/voice/openai-voice.provider');
  const { ElevenLabsVoiceProvider } = await import('../src/modules/voice/elevenlabs-voice.provider');
  const { BrowserVoiceProvider } = await import('../src/modules/voice/browser-voice.provider');
  const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
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
  const { KeyflowCommandController } = await import('../src/modules/keyflow-command/keyflow-command.controller');
  const { KeyflowCommandService } = await import('../src/modules/keyflow-command/keyflow-command.service');
  const { KeyflowNotesService } = await import('../src/modules/keyflow-command/keyflow-notes.service');
  const { KeyflowVoiceService } = await import('../src/modules/keyflow-command/keyflow-voice.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');

  // The production build (tsc, emitDecoratorMetadata) records each class's
  // constructor parameter types, and Nest injects by them. Vitest's esbuild
  // transform does not emit that metadata, and these two controllers declare
  // (most of) their dependencies without @Inject tokens. This writes exactly
  // the metadata tsc emits for their constructors (and leaves a class alone if
  // its metadata is already present), as cortex-audit-tenant does.
  const emitParamTypes = (cls: object, types: unknown[]) => {
    if (!Reflect.getMetadata('design:paramtypes', cls)) Reflect.defineMetadata('design:paramtypes', types, cls);
  };
  emitParamTypes(VoiceController, [VoiceService]);
  emitParamTypes(KeyCortexController, [
    KeyCortexReasoningService,
    KeyCortexConversationService,
    KeyCortexVoiceService,
    KeyCortexPersonalityService,
    KeyCortexActionsService,
    KeyCortexContextService,
    KeyCortexConnectorService,
    KeyCortexCommandService,
    KeyCortexExecutorService,
    KeyCortexContextV2Service,
    KeyCortexInsightService,
    KeyCortexMonitorV2Service,
    KeyCortexSandboxService,
    KeyCortexFlowStudioService,
    KeyCortexEvolutionService,
    KeyCortexPhoneService,
    KeyCortexDocumentService,
    KeyCortexLearningService,
    KeyAutonomySafetyService,
    KeyCortexApprovalOrchestratorService,
    KeyCortexConsciousnessService,
    KeyCortexSessionService,
    KeyCortexAwarenessService,
  ]);

  // The plan is off the boundary: unlimited, so no credit check can be what answers a case.
  const plan = {
    checkLimit: async () => ({ allowed: true }),
    getActiveSubscription: async () => ({ limits: { aiCreditsPerMonth: -1 } }),
  };
  const outputTemplatesOff = {
    resolveTemplate: async () => { throw new Error('k07c: output templates are off the direct path'); },
  };
  // The direct helpers never dispatch through the gateway; any use of it fails the case.
  const gatewayOff = {};

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, VoiceController, KeyflowCommandController, KeyCortexController, CommerceController, AgentController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmStatsService,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      CrmImportService,
      EntityResolutionService,
      // The services under test, real.
      {
        provide: AiUsageService,
        useFactory: (prisma: any) => new AiUsageService(prisma, plan as any, outputTemplatesOff as any, gatewayOff as any),
        inject: [PrismaService],
      },
      VoiceService,
      OpenAiVoiceProvider,
      ElevenLabsVoiceProvider,
      BrowserVoiceProvider,
      {
        provide: KeyCortexVoiceService,
        useFactory: (usage: any) => new KeyCortexVoiceService(usage, {} as any),
        inject: [AiUsageService],
      },
      {
        provide: KeyflowVoiceService,
        useFactory: (usage: any) => new KeyflowVoiceService(usage),
        inject: [AiUsageService],
      },
      // W7-AI-SERVICES-503: the services behind products/import/scan and agent/memory/*, real.
      CommerceVisionService,
      SemanticMemoryService,
      // CommerceController's public routes carry PublicRateLimitGuard (Redis); products/import/scan does not.
      { provide: REDIS_CLIENT, useValue: {} },
      // KeyflowCommandController's other routes (events, notes) are off the boundary.
      { provide: KeyflowCommandService, useValue: {} },
      { provide: KeyflowNotesService, useValue: {} },
      // CRM side channels, as in contacts-import-write-scope.integration.test.ts.
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: plan },
      { provide: CrmListsService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: CrmDataQualityService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: CrmRelationshipHealthService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ConversationAiService, useValue: {} },
      { provide: CrmNetworkService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return CORTEX_CONTROLLER_OFF_BOUNDARY.has(name) || COMMERCE_AND_AGENT_OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();
  aiUsage = moduleRef.get(AiUsageService);
  keyVoice = moduleRef.get(KeyCortexVoiceService);
  attemptsAtBoot = [...sdk.attempts];

  app = moduleRef.createNestApplication();
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only, for seeded k07c_ users. No guard is overridden.
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
  await db.business.create({ data: { id: ID.biz, name: 'K07C Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.user.create({ data: { id: ID.outsider, email: `${P}outsider@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizOther, name: 'K07C Other Biz', ownerId: ID.outsider, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_outsider`, userId: ID.outsider, businessId: ID.bizOther, role: 'OWNER' } });
  await db.user.create({ data: { id: ID.nomember, email: `${P}nomember@test.local`, role: 'USER' } });
  // W7-AI-SERVICES-503: two memories, so a backfill has something to embed (and the refusal stops at the first).
  await db.aiMemory.create({ data: { id: `${P}mem_hours`, businessId: ID.biz, category: 'business', key: 'opening_hours', value: '9-5' } });
  await db.aiMemory.create({ data: { id: `${P}mem_tone`, businessId: ID.biz, category: 'preference', key: 'tone', value: 'warm' } });

  // No case below may reach a real provider: every global fetch is recorded and refused.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    outbound.push(typeof input === 'string' ? input : String(input?.url ?? input));
    throw new Error('k07c: outbound traffic is refused in this suite');
  });
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  aiUsage?.onModuleDestroy?.();
  if (db) await cleanup();
  for (const key of PROVIDER_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('fixture sanity (real rows)', () => {
  it('no OpenAI key is configured, and the owner holds an OWNER membership of the business', async () => {
    for (const key of PROVIDER_ENV) expect(process.env[key], key).toBeUndefined();
    expect(await db.membership.count({ where: { businessId: ID.biz, userId: ID.owner, role: 'OWNER' } })).toBe(1);
    expect(await traces()).toEqual(NO_TRACES);
  });
});

describe('AiUsageService: a direct OpenAI helper answers 503 provider_not_configured when no OpenAI key is configured', () => {
  it('POST /crm/businesses/:b/import/scan (trackVision) answers 503 {code: provider_not_configured, service: ai}', async () => {
    const res = await scan();
    expectNotConfigured(res);
  });

  it('the refused scan ran before the SDK: no OpenAI client built, no request sent, no AiUsageLog row, no contact or import trace', async () => {
    // Review nit CR-N1: this case makes its own scan instead of reading the previous case's trace.
    const attemptsBefore = sdk.attempts.length;
    const requestsBefore = sdk.requests.length;
    expectNotConfigured(await scan());
    expect(sdk.attempts.slice(attemptsBefore)).toEqual([]);
    expect(sdk.attempts.slice(attemptsAtBoot.length)).toEqual([]);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('POST /voice/businesses/:b/tts (trackAudio through OpenAiVoiceProvider) answers 503 and builds no OpenAI client', async () => {
    const before = sdk.attempts.length;
    const res = await agent()
      .post(`/voice/businesses/${ID.biz}/tts`)
      .set(HEADER, ID.owner)
      .send({ text: 'Hello from k07c', provider: 'openai' });
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    // R0-34b: the provider rethrows the 503 unchanged, so the cause shows in the message and the code survives (next case).
    expect(res.body.message).toContain('no OpenAI key is configured');
    expect(sdk.attempts.slice(before)).toEqual([]);
    expect(sdk.requests).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('POST /voice/businesses/:b/tts and POST /keyflow/businesses/:b/voice/tts|transcribe carry code provider_not_configured in the 503 body (R0-34b)', async () => {
    // OpenAiVoiceProvider and KeyflowVoiceService used to rewrap every error in a new
    // ServiceUnavailableException(message), so the body code was UNKNOWN_ERROR.
    const attemptsBefore = sdk.attempts.length;
    const requestsBefore = sdk.requests.length;
    expectNotConfigured(await voiceTts(ID.owner));
    expectNotConfigured(await keyflowTts(ID.owner));
    expectNotConfigured(await keyflowTranscribe(ID.owner));
    expect(sdk.attempts.slice(attemptsBefore)).toEqual([]);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('a provider error that is not a missing or unavailable provider keeps its 503 wrapper on voice/tts and keyflow voice (R0-34b)', async () => {
    const providerError = () => Promise.reject(new Error('k07c: provider exploded'));
    const spy = vi.spyOn(aiUsage, 'trackAudio');
    try {
      spy.mockImplementationOnce(providerError);
      expectRewrapped(await voiceTts(ID.owner), 'OpenAI TTS failed: k07c: provider exploded');
      spy.mockImplementationOnce(providerError);
      expectRewrapped(await keyflowTts(ID.owner), 'Voice synthesis failed.');
      spy.mockImplementationOnce(providerError);
      expectRewrapped(await keyflowTranscribe(ID.owner), 'Voice transcription failed.');
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
    expect(await traces()).toEqual(NO_TRACES);
  });

  // W7-AI-SERVICES-503 (R0-07a rule): the suite's last two it.todo cases, live.
  it('POST /commerce/businesses/:b/products/import/scan answers 503 provider_not_configured instead of 2xx with no products, before any OpenAI client or usage row (W7-AI-SERVICES-503, R0-07a)', async () => {
    // CommerceVisionService.extractProductsFromImage caught every error and returned [],
    // so a keyless scan answered 201 {extracted: [], count: 0}: an image with nothing in it.
    const attemptsBefore = sdk.attempts.length;
    const requestsBefore = sdk.requests.length;
    const res = await productScan(ID.owner);
    expectNotConfigured(res);
    expect(res.body.extracted).toBeUndefined();
    expect(sdk.attempts.slice(attemptsBefore)).toEqual([]);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('GET /ai/businesses/:b/agent/memory/search and POST .../agent/memory/backfill answer 503 provider_not_configured instead of an empty 200; backfill stops at the first memory and stores no embedding (W7-AI-SERVICES-503, R0-07a)', async () => {
    // SemanticMemoryService.search and backfillFromAiMemory logged the error and answered
    // {results: []} and {backfilled: 0}: nothing told the user search is not configured.
    expect(await db.aiMemory.count({ where: { businessId: ID.biz } })).toBe(2);
    const attemptsBefore = sdk.attempts.length;
    const requestsBefore = sdk.requests.length;
    const embed = vi.spyOn(aiUsage, 'trackEmbedding');
    try {
      const search = await memorySearch(ID.owner);
      expectNotConfigured(search);
      expect(search.body.results).toBeUndefined();
      expect(embed).toHaveBeenCalledTimes(1);

      const backfill = await memoryBackfill(ID.owner);
      expectNotConfigured(backfill);
      expect(backfill.body.backfilled).toBeUndefined();
      // The refusal is the same for every memory: the loop stops at the first instead of trying all of them.
      expect(embed).toHaveBeenCalledTimes(2);
    } finally {
      embed.mockRestore();
    }
    expect(await embeddingRows()).toBe(0);
    expect(sdk.attempts.slice(attemptsBefore)).toEqual([]);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('a provider_unavailable 503 (every credential circuit open) passes through products/import/scan and agent/memory/search and /backfill with its code (W7-AI-SERVICES-503, R0-07a)', async () => {
    const unavailable = () => Promise.reject(new ServiceUnavailableException({
      code: 'provider_unavailable',
      service: 'ai',
      message: 'k07c: every AI credential circuit is open',
      error: 'Service Unavailable',
    }));
    const vision = vi.spyOn(aiUsage, 'trackVision').mockImplementation(unavailable);
    const embed = vi.spyOn(aiUsage, 'trackEmbedding').mockImplementation(unavailable);
    try {
      for (const res of [await productScan(ID.owner), await memorySearch(ID.owner), await memoryBackfill(ID.owner)]) {
        expect(res.status, JSON.stringify(res.body)).toBe(503);
        expect(res.body.code).toBe('provider_unavailable');
        expect(res.body.details?.service).toBe('ai');
      }
      expect(vision).toHaveBeenCalledTimes(1);
      expect(embed).toHaveBeenCalledTimes(2);
    } finally {
      vision.mockRestore();
      embed.mockRestore();
    }
    expect(await embeddingRows()).toBe(0);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('a provider error that is not a missing or unavailable provider keeps its mapping: no products on products/import/scan, empty results and skipped memories on agent/memory/search and /backfill (W7-AI-SERVICES-503)', async () => {
    const providerError = () => Promise.reject(new Error('k07c: provider exploded'));
    const vision = vi.spyOn(aiUsage, 'trackVision').mockImplementation(providerError);
    const embed = vi.spyOn(aiUsage, 'trackEmbedding').mockImplementation(providerError);
    try {
      const scanRes = await productScan(ID.owner);
      expect(scanRes.status, JSON.stringify(scanRes.body)).toBe(201);
      expect(scanRes.body).toEqual({ extracted: [], count: 0 });

      const searchRes = await memorySearch(ID.owner);
      expect(searchRes.status, JSON.stringify(searchRes.body)).toBe(200);
      expect(searchRes.body).toEqual({ results: [] });

      const backfillRes = await memoryBackfill(ID.owner);
      expect(backfillRes.status, JSON.stringify(backfillRes.body)).toBe(201);
      expect(backfillRes.body).toEqual({ backfilled: 0 });

      expect(vision).toHaveBeenCalledTimes(1);
      // One for the search, then one per memory: a plain failure skips that memory and the backfill goes on.
      expect(embed).toHaveBeenCalledTimes(3);
    } finally {
      vision.mockRestore();
      embed.mockRestore();
    }
    expect(await embeddingRows()).toBe(0);
    expect(await traces()).toEqual(NO_TRACES);
  });
});

describe('KeyCortexVoiceService: KEY voice refuses before any provider call when no OpenAI key is configured', () => {
  it('the KEY voice service built no OpenAI client: none with the sentinel key sk-no-key, nor any other', () => {
    expect(attemptsAtBoot).toEqual([]);
  });

  it('POST /api/v1/cortex/voice/speak answers 503 and sends no request (none with Authorization: Bearer sk-no-key)', async () => {
    const before = sdk.requests.length;
    const res = await agent()
      .post('/api/v1/cortex/voice/speak')
      .query({ businessId: ID.biz })
      .set(HEADER, ID.owner)
      .send({ text: 'Hello from k07c', persona: 'jarvis' });
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(sdk.requests.slice(before)).toEqual([]);
  });

  it('POST /api/v1/cortex/voice/listen answers 503 and sends no request', async () => {
    const before = sdk.requests.length;
    const res = await agent()
      .post('/api/v1/cortex/voice/listen')
      .query({ businessId: ID.biz })
      .set(HEADER, ID.owner)
      .attach('audio', Buffer.from(`${P}audio`, 'utf8'), { filename: `${P}utterance.webm`, contentType: 'audio/webm' });
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(sdk.requests.slice(before)).toEqual([]);
  });

  it('the refused KEY voice calls bill nothing: no AiUsageLog row, and no global fetch either', async () => {
    // Review nit CR-N1: this case makes its own calls instead of reading the previous cases' trace.
    const outboundBefore = outbound.length;
    const requestsBefore = sdk.requests.length;
    expect((await speak(ID.owner, ID.biz)).status).toBe(503);
    expect((await listen(ID.owner, ID.biz)).status).toBe(503);
    // A usage row would be written in the background: give it the time it would take.
    await new Promise((r) => setTimeout(r, 200));
    expect(await traces()).toEqual(NO_TRACES);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(outbound.slice(outboundBefore)).toEqual([]);
  });

  it('a member of another business only, naming this business in the query, is refused 403 on speak and listen before KEY voice runs', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz, userId: ID.outsider } })).toBe(0);
    expect(await db.membership.count({ where: { businessId: ID.bizOther, userId: ID.outsider, role: 'OWNER' } })).toBe(1);
    const attemptsBefore = sdk.attempts.length;
    const requestsBefore = sdk.requests.length;

    const speak = await agent()
      .post('/api/v1/cortex/voice/speak')
      .query({ businessId: ID.biz })
      .set(HEADER, ID.outsider)
      .send({ text: 'Hello from k07c', persona: 'jarvis' });
    // 403, not the 503 KEY voice answers: BusinessGuard refused before the handler ran.
    expect(speak.status, JSON.stringify(speak.body)).toBe(403);
    expect(speak.body.message).toBe('No access to this business');

    const listen = await agent()
      .post('/api/v1/cortex/voice/listen')
      .query({ businessId: ID.biz })
      .set(HEADER, ID.outsider)
      .attach('audio', Buffer.from(`${P}audio`, 'utf8'), { filename: `${P}utterance.webm`, contentType: 'audio/webm' });
    expect(listen.status, JSON.stringify(listen.body)).toBe(403);
    expect(listen.body.message).toBe('No access to this business');

    expect(sdk.attempts.slice(attemptsBefore)).toEqual([]);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('POST /api/v1/cortex/voice/speak and /voice/listen act on the tenant BusinessGuard checked (review ST-1, R0-34b): the outsider never reaches KEY voice for this business', async () => {
    // BusinessGuard resolves params -> body -> query. The handlers used to read
    // @Query('businessId'), so the outsider naming this business in the query and
    // its own in the JSON body passed the guard for its own business, and speak
    // synthesized for this one (synthesize received this businessId).
    const seen: Array<{ method: string; businessId: unknown }> = [];
    const refuse = () => Promise.reject(new Error('k07c: recorded; KEY voice is not called in this case'));
    const synth = vi.spyOn(keyVoice, 'synthesize').mockImplementation((...args: any[]) => {
      seen.push({ method: 'synthesize', businessId: args[1] });
      return refuse();
    });
    const trans = vi.spyOn(keyVoice, 'transcribe').mockImplementation((...args: any[]) => {
      seen.push({ method: 'transcribe', businessId: args[1] });
      return refuse();
    });
    try {
      // The JSON body names the outsider's own business, the query names this one:
      // the guard checked its own business, and KEY voice runs for that one only.
      const split = await speak(ID.outsider, ID.biz, { businessId: ID.bizOther });
      expect(split.status, JSON.stringify(split.body)).toBe(503);

      // Multipart: the guard sees only the query (multer parses the body after it),
      // so this business in the query is refused whatever the fields say ...
      const listenForeignQuery = await listen(ID.outsider, ID.biz, ID.bizOther);
      expect(listenForeignQuery.status, JSON.stringify(listenForeignQuery.body)).toBe(403);
      // ... and a field naming this business next to the outsider's own query is refused too.
      const listenForeignField = await listen(ID.outsider, ID.bizOther, ID.biz);
      expect(listenForeignField.status, JSON.stringify(listenForeignField.body)).toBe(403);

      expect(seen).toEqual([{ method: 'synthesize', businessId: ID.bizOther }]);
    } finally {
      synth.mockRestore();
      trans.mockRestore();
    }
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('POST /api/v1/cortex/voice/speak and /voice/listen carry code provider_not_configured in the 503 body (R0-34b)', async () => {
    // KeyCortexController.speak and .listen used to catch every error and throw
    // new ServiceUnavailableException('Voice synthesis unavailable' / 'Speech
    // transcription unavailable'), so the body code was UNKNOWN_ERROR.
    const requestsBefore = sdk.requests.length;
    expectNotConfigured(await speak(ID.owner, ID.biz));
    expectNotConfigured(await listen(ID.owner, ID.biz));
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('a KEY voice failure that is not a missing or unavailable provider keeps its 503 wrapper on speak and listen (R0-34b)', async () => {
    const providerError = () => Promise.reject(new Error('k07c: provider exploded'));
    const synth = vi.spyOn(keyVoice, 'synthesize').mockImplementationOnce(providerError);
    const trans = vi.spyOn(keyVoice, 'transcribe').mockImplementationOnce(providerError);
    try {
      expectRewrapped(await speak(ID.owner, ID.biz), 'Voice synthesis unavailable');
      expectRewrapped(await listen(ID.owner, ID.biz), 'Speech transcription unavailable');
      expect(synth).toHaveBeenCalledTimes(1);
      expect(trans).toHaveBeenCalledTimes(1);
    } finally {
      synth.mockRestore();
      trans.mockRestore();
    }
    expect(await traces()).toEqual(NO_TRACES);
  });
});

describe('a caller the guards refuse gets 401/403 on every direct-AI route, never the 503 that says no AI key is configured (review ST-3)', () => {
  /** Every direct-AI route of this suite, for a given caller. */
  const routes = (user?: string) => [
    {
      name: 'POST /crm/businesses/:b/import/scan',
      send: () => {
        const req = agent().post(`/crm/businesses/${ID.biz}/import/scan`).set('x-forwarded-for', nextIp());
        return (user ? req.set(HEADER, user) : req)
          .attach('image', Buffer.from(`${P}not-really-a-jpeg`, 'utf8'), { filename: `${P}card.jpg`, contentType: 'image/jpeg' });
      },
    },
    { name: 'POST /voice/businesses/:b/tts', send: () => voiceTts(user) },
    { name: 'POST /keyflow/businesses/:b/voice/tts', send: () => keyflowTts(user) },
    { name: 'POST /keyflow/businesses/:b/voice/transcribe', send: () => keyflowTranscribe(user) },
    { name: 'POST /api/v1/cortex/voice/speak', send: () => speak(user, ID.biz) },
    { name: 'POST /api/v1/cortex/voice/listen', send: () => listen(user, ID.biz) },
    // W7-AI-SERVICES-503: the routes that answer the 503 since that packet.
    { name: 'POST /commerce/businesses/:b/products/import/scan', send: () => productScan(user) },
    { name: 'GET /ai/businesses/:b/agent/memory/search', send: () => memorySearch(user) },
    { name: 'POST /ai/businesses/:b/agent/memory/backfill', send: () => memoryBackfill(user) },
  ];

  const expectRefusedBeforeAi = async (user: string | undefined, status: number) => {
    const attemptsBefore = sdk.attempts.length;
    const requestsBefore = sdk.requests.length;
    for (const route of routes(user)) {
      const res = await route.send();
      expect(res.status, `${route.name} ${JSON.stringify(res.body)}`).toBe(status);
      expect(res.body.code, route.name).not.toBe('provider_not_configured');
      expect(JSON.stringify(res.body), route.name).not.toMatch(/OpenAI|AI provider/i);
    }
    expect(sdk.attempts.slice(attemptsBefore)).toEqual([]);
    expect(sdk.requests.slice(requestsBefore)).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  };

  it('an unauthenticated caller gets 401', async () => {
    await expectRefusedBeforeAi(undefined, 401);
  });

  it('a user with no membership gets 403', async () => {
    expect(await db.membership.count({ where: { userId: ID.nomember } })).toBe(0);
    await expectRefusedBeforeAi(ID.nomember, 403);
  });

  it('a member of another business only gets 403', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz, userId: ID.outsider } })).toBe(0);
    await expectRefusedBeforeAi(ID.outsider, 403);
  });
});

describe('with an OpenAI key configured (SDK transport stubbed): the direct path is unchanged', () => {
  it('POST /crm/businesses/:b/import/scan answers 201 with the extracted contact, logs one AiUsageLog row, and its one request carried the configured key', async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = FAKE_KEY;
    sdk.respond = (url: string) => {
      if (!url.endsWith('/chat/completions')) throw new TypeError(`k07c: unexpected request ${url}`);
      return new Response(JSON.stringify({
        id: `${P}chatcmpl`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-4o',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify({ firstName: 'K07c', lastName: 'Card', email: SCAN_EMAIL, phone: null, companyName: `${P}ScanCo` }),
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const requestsBefore = sdk.requests.length;
    try {
      const res = await scan();
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.contact).toMatchObject({ businessId: ID.biz, email: SCAN_EMAIL, source: 'scan' });
      expect(await db.contact.count({ where: { businessId: ID.biz, email: SCAN_EMAIL } })).toBe(1);

      const sent = sdk.requests.slice(requestsBefore);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ method: 'POST', authorization: `Bearer ${FAKE_KEY}` });
      expect(sent[0].url).toMatch(/\/chat\/completions$/);

      // The usage row is written in the background after the response.
      let logs: any[] = [];
      for (let i = 0; i < 50 && logs.length === 0; i++) {
        logs = await db.aiUsageLog.findMany({ where: { businessId: ID.biz } });
        if (logs.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ feature: 'vision_contact', provider: 'openai', model: 'gpt-4o', totalTokens: 70 });
    } finally {
      sdk.respond = null;
      delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    }
  });

  it('no case sent a global fetch, and the only SDK request of the suite was the keyed one to the stub transport', () => {
    expect(outbound).toEqual([]);
    expect(sdk.requests.map((r) => r.authorization)).toEqual([`Bearer ${FAKE_KEY}`]);
  });
});
