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
 *   POST /voice/businesses/:b/tts                       trackAudio via OpenAiVoiceProvider   -> proven here (503; body code rewrapped)
 *   POST /keyflow/businesses/:b/voice/tts|transcribe    trackAudio via KeyflowVoiceService   (rewrapped 503, outside the write set)
 *   POST /commerce/businesses/:b/products/import/scan   trackVision via CommerceVisionService (swallowed: 2xx with no products)
 *   GET  /ai/businesses/:b/agent/memory/search, POST .../agent/memory/backfill
 *                                                       trackEmbedding via SemanticMemoryService (swallowed: 200, empty)
 *   POST /api/v1/cortex/voice/speak, /voice/listen      KeyCortexVoiceService                -> proven here (503; body code rewrapped)
 *   KeyCortexPhoneService (Twilio call flows)           KeyCortexVoiceService                (Twilio itself is off in Release 0)
 *
 * In that environment:
 *
 *   POST /crm/businesses/:b/import/scan       -> 503 { code: 'provider_not_configured', details.service: 'ai' }
 *   POST /voice/businesses/:b/tts             -> 503, no OpenAI client built
 *   POST /api/v1/cortex/voice/speak, /listen  -> 503, and no request leaves with the sentinel key
 *
 * and nothing is billed: no AiUsageLog row, no contact or import trace. With a
 * key configured (the SDK transport stubbed) import/scan is unchanged: 201,
 * the extracted contact, one AiUsageLog row.
 *
 * Review ST-1: a member of another business that names this business only in
 * the query string is refused 403 by BusinessGuard on the KEY voice routes.
 * The handlers read the query, not the tenant the guard checked, so a JSON body
 * businessId splits the two (it.todo; COST-LEDGER-001 section 7 item 9).
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
 * VoiceController, VoiceService, OpenAiVoiceProvider, KeyCortexController and
 * KeyCortexVoiceService, and the OpenAI SDK itself (constructor, request
 * building, error handling). Stand-ins: identity attachment (a test middleware
 * reads `x-k07c-user` and attaches the seeded user row, as the Supabase
 * AuthMiddleware would); the SDK's HTTP transport (its `fetch` option: every
 * request is recorded and refused, or answered by a canned completion in the
 * keyed case; maxRetries 0); globalThis.fetch (recorded and refused); the plan
 * (unlimited); output templates and the model gateway (off the direct path);
 * the CRM side channels as in contacts-import-write-scope; and the
 * collaborators KeyCortexController holds for its other routes (an
 * allow-listed mocker; any other missing token fails the compile). Vitest's
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

let db: any;
let app: any;
let aiUsage: any;
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
    controllers: [CrmController, VoiceController, KeyCortexController],
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
      return CORTEX_CONTROLLER_OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();
  aiUsage = moduleRef.get(AiUsageService);
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
    expect(sdk.attempts.slice(attemptsAtBoot.length)).toEqual([]);
    expect(sdk.requests).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it('POST /voice/businesses/:b/tts (trackAudio through OpenAiVoiceProvider) answers 503 and builds no OpenAI client', async () => {
    const before = sdk.attempts.length;
    const res = await agent()
      .post(`/voice/businesses/${ID.biz}/tts`)
      .set(HEADER, ID.owner)
      .send({ text: 'Hello from k07c', provider: 'openai' });
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    // The provider keeps its own wrapper ('OpenAI TTS failed: ...'), so the cause shows in the message (the code: it.todo below).
    expect(res.body.message).toContain('no OpenAI key is configured');
    expect(sdk.attempts.slice(before)).toEqual([]);
    expect(sdk.requests).toEqual([]);
    expect(await traces()).toEqual(NO_TRACES);
  });

  it.todo(
    'POST /voice/businesses/:b/tts and POST /keyflow/businesses/:b/voice/tts|transcribe carry code provider_not_configured in the 503 body - ' +
      'OpenAiVoiceProvider (voice/openai-voice.provider.ts) and KeyflowVoiceService (keyflow-command/keyflow-voice.service.ts) rewrap every error ' +
      'in a new ServiceUnavailableException(message), so the body code is UNKNOWN_ERROR; outside the R0-07a write set',
  );
  it.todo(
    'POST /commerce/businesses/:b/products/import/scan answers 503 provider_not_configured instead of 2xx with no products - ' +
      'CommerceVisionService.extractProductsFromImage catches every error and returns []; outside the R0-07a write set',
  );
  it.todo(
    'GET /ai/businesses/:b/agent/memory/search and POST .../agent/memory/backfill report that embeddings are not configured instead of an empty 200 - ' +
      'SemanticMemoryService.search and backfillFromAiMemory swallow the error; outside the R0-07a write set',
  );
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
    expect(await traces()).toEqual(NO_TRACES);
    expect(outbound).toEqual([]);
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

  it.todo(
    'POST /api/v1/cortex/voice/speak and /voice/listen act on the tenant BusinessGuard checked (review ST-1) - ' +
      'BusinessGuard resolves params -> body -> query (resolveRequestBusinessId), but KeyCortexController.speak and .listen read ' +
      "@Query('businessId'), so the outsider above sending ?businessId=<this business> with a JSON body {businessId: <own business>} " +
      'passes the guard for its own business and speak synthesizes for this one (probe: 200, synthesize received this businessId). ' +
      'Fix: @GuardedBusinessId() in both handlers; key-cortex.controller.ts is outside the R0-07a write set (owned by ' +
      'V1-03-KEY-CORTEX-PRINCIPAL); COST-LEDGER-001 section 7 item 9',
  );

  it.todo(
    'POST /api/v1/cortex/voice/speak and /voice/listen carry code provider_not_configured in the 503 body - ' +
      "KeyCortexController.speak and .listen catch every error and throw new ServiceUnavailableException('Voice synthesis unavailable' / " +
      "'Speech transcription unavailable'), so the body code is UNKNOWN_ERROR; key-cortex.controller.ts is outside the R0-07a write set",
  );
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
