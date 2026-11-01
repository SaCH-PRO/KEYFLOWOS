/**
 * R0-07-OPTIONAL-SVC-VISIBLE — optional services fail visibly and independently
 * (REAL database, REAL commerce + ledger chain, REAL Gmail service, REAL AI
 * dispatch chain). Issue #186 step 7; BUILD-MAP-001 R0-07; CF-35.
 *
 * Release 0 runs with no Gmail connection and no AI provider key. In that
 * environment:
 *
 *   POST /commerce/businesses/:b/invoices/:id/send-email     -> 503 { code: 'provider_not_configured', details.service: 'gmail' }
 *   POST /commerce/businesses/:b/invoices/:id/send-reminder  -> 503, same body
 *   POST /commerce/businesses/:b/invoices/:id/resend-receipt -> 503, same body
 *   POST /commerce/businesses/:b/quotes/:id/send-email       -> 503, same body
 *   POST /commerce/businesses/:b/gmail/messages/send         -> 503, same body
 *   GET  /commerce/businesses/:b/gmail/auth-url              -> 503, same body (no Google OAuth client)
 *   a connected business whose token expired, with no Google OAuth client to refresh it -> 503, same body
 *   GET  /commerce/businesses/:b/gmail/status                -> 200 { connected: false } (reporting is not failing)
 *   POST /ai/businesses/:b/ai/chat                           -> 503 { code: 'provider_not_configured', details.service: 'ai' }
 *
 * and, in the SAME app instance and process environment, every Release 0
 * money route still answers 2xx: create invoice, issue, record a partial and a
 * settling payment, the invoice balance, both list routes and the receipt.
 *
 * LEDGER: a refused send-email on a DRAFT invoice leaves it DRAFT and writes no
 * FinancialTransaction and no LedgerEntry (the DRAFT -> SENT flip, which is what
 * would post, runs only after a successful send). A refused reminder or receipt
 * logs no "sent" contact event. A refused AI dispatch writes no AiUsageLog row
 * and no LLM cost. No case makes an outbound HTTP call: globalThis.fetch is a
 * refusing recorder for the whole suite (the R0-CMF4 block alone answers
 * Gmail's messages/send in process, below).
 *
 * R0-CMF4-SEND-EMAIL-ORDER (COST-LEDGER-001 section 7 items 2 and 3): a send
 * Gmail did not accept changes nothing. A refused (503) or failed quote
 * send-email leaves a DRAFT quote DRAFT, with no viewToken, no sentAt and no
 * quote.sent event; a refused or failed invoice send-email leaves no new
 * PaymentLink row. A business connected to Gmail with a live access token
 * (bizSend) drives the real GmailService into a stubbed Gmail transport that
 * throws (a network failure), answers an error (Gmail refused it: the old 400)
 * or accepts the message. Accepted, the quote is SENT with the viewToken the
 * email carried, and the invoice gets exactly one live link, whose token link
 * is in the email and the response (D-07); a resend reuses that link.
 * RED-BEFORE (recorded in the R0-CMF4 tests-first commit): the quote was moved
 * to SENT, and the link minted, before the send.
 *
 * RED-BEFORE (recorded in the tests-first commit): on the unmodified code the
 * Gmail paths answer 400 BAD_REQUEST ('Gmail not connected' / 'Google OAuth not
 * configured') and the AI chat answers 500 INTERNAL_SERVER_ERROR (the gateway
 * threw a plain Error('No AI providers available')).
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * PlanLimitGuard (over a stub plan), CrmRateLimitGuard, CommerceController,
 * CommerceService, InvoiceWorkflowService, InvoiceReceiptBuilderService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService,
 * GmailService, AiController, AiAdvisorService, AiUsageService and
 * ModelGatewayService, with the production GlobalHttpExceptionFilter and
 * ValidationPipe. Identity attachment is the one stand-in (a test middleware
 * reads `x-k07a-user` and attaches the seeded user row, as the Supabase
 * AuthMiddleware would). Off the boundary and stubbed: EventEmitter2 (recorder),
 * CrmService.logContactEvent (recorder), the plan (unlimited), output templates,
 * the blueprint, the LLM cost writer (recorder), the stats cache and the
 * collaborators AiController holds for its other routes (an allow-listed mocker;
 * any other missing token fails the compile).
 *
 * Every provider variable the two optional services read is removed from
 * process.env before the services are constructed and restored afterwards.
 *
 * Fixtures: prefix `k07a_` (registered in test/helpers/fixture-prefixes.json);
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

const P = 'k07a_';
const HEADER = 'x-k07a-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  /** A business with a Gmail connection whose access token has expired. */
  bizConnected: `${P}bizConn`,
  contact: `${P}contact`,
  contactConnected: `${P}contactConn`,
  invDraft: `${P}invDraft`,
  invSent: `${P}invSent`,
  invPaid: `${P}invPaid`,
  invConnected: `${P}invConn`,
  quoteSent: `${P}quoteSent`,
  /** R0-CMF4: a DRAFT quote and a DRAFT invoice with no pay link, of the business with no Gmail connection. */
  quoteDraft: `${P}quoteDraft`,
  invNoLink: `${P}invNoLink`,
  /** R0-CMF4: a business connected to Gmail with a live access token; its sends reach the stubbed Gmail transport. */
  bizSend: `${P}bizSend`,
  contactSend: `${P}contactSend`,
  quoteSendFail: `${P}quoteSendFail`,
  quoteSendOk: `${P}quoteSendOk`,
  invSendFail: `${P}invSendFail`,
  invSendLinked: `${P}invSendLinked`,
  invSendOk: `${P}invSendOk`,
  linkSendLinked: `${P}linkSendLinked`,
};

/** R0-CMF4: the live pay link invSendLinked already has (not the pre-V1-48 cuid shape, so it is never rotated). */
const LINKED_TOKEN = `${P}live-link-token-0123456789abcdef`;
/** A V1-48 pay-link token or quote view token: 24 crypto-random bytes, base64url. */
const RANDOM_TOKEN = /^[A-Za-z0-9_-]{32,}$/;
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** Every variable GmailService or ModelGatewayService reads to decide a provider is configured. */
const PROVIDER_ENV = [
  // Gmail / Google OAuth
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GMAIL_REDIRECT_URI', 'GOOGLE_REDIRECT_URI', 'GOOGLE_STATE_SECRET',
  // AI providers
  'AI_INTEGRATIONS_OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'XAI_API_KEY', 'KIMI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'NATIVE_AI_API_KEY', 'KEYFLOW_NATIVE_AI_URL',
  'OPENROUTER_API_KEY', 'OLLAMA_BASE_URL', 'BYOK_ENCRYPTION_SECRET', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

/**
 * AiController's collaborators for its other routes. The chat route under test
 * reaches none of them; the mocker supplies an empty object for exactly these
 * and refuses every other unresolved token, so a missing guard dependency still
 * fails the compile instead of being silently mocked.
 */
const AI_CONTROLLER_OFF_BOUNDARY = new Set([
  'AiExecutionLogService', 'AiOversightService', 'BusinessGraphService', 'IntentParserService', 'PlannerService',
  'AiMemoryService', 'StrategicIntelligenceService', 'ProAutoMonitorService', 'ProfileIntelligenceService',
  'WorkspaceRecommendationsService', 'KeyCommandService', 'AutopilotRulesService', 'AgentHealthService',
  'JourneyOrchestratorService', 'MorningBriefingService', 'UnifiedInboxService', 'GoalTrackerService',
  'WorkloadAggregatorService', 'TaskPrioritizerService', 'CapacityInsightService', 'TaskRebalancerService',
  'KeyAgentConfigService', 'UndoService', 'ProactiveSuggestionService', 'WorkflowTemplateService',
  'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
]);

let db: any;
let app: any;
let redis: any;
let aiUsage: any;

/** Event names CommerceService emitted (EventEmitter2 is a recorder). */
const emitted: Array<{ name: string; payload: any }> = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Contact timeline audit events (CrmService.logContactEvent is a recorder). */
const contactEvents: any[] = [];
/** LLMCostService.recordCost calls (a recorder: a refused dispatch must bill nothing). */
const llmCostWrites: any[] = [];
/** Every outbound fetch attempted by the process during the suite (refused). */
const outbound: string[] = [];

/**
 * R0-CMF4: what the stubbed Gmail transport does with a messages/send request.
 * null (every block but the R0-CMF4 one) means it is off, and the request is
 * refused and recorded like any other fetch.
 */
type GmailOutcome = 'throw' | 'reject' | 'accept';
let gmailTransport: GmailOutcome | null = null;
/** Every message the stubbed Gmail transport received, decoded, with what it answered. */
const gmailSends: Array<{ to: string; subject: string; html: string; outcome: GmailOutcome }> = [];

/** GmailService's base64url MIME message: its To and Subject headers and its (base64) HTML part. */
function decodeGmailRaw(raw: string) {
  const lines = Buffer.from(raw, 'base64url').toString('utf8').split('\r\n');
  const header = (name: string) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2) ?? '';
  const at = lines.indexOf('Content-Transfer-Encoding: base64');
  const html = at >= 0 ? Buffer.from(lines[at + 2] ?? '', 'base64').toString('utf8') : '';
  return { to: header('To'), subject: header('Subject'), html };
}

/** The stubbed Gmail messages/send: nothing leaves the process. */
async function stubGmailSend(init: any): Promise<Response> {
  const outcome = gmailTransport as GmailOutcome;
  const { raw } = JSON.parse(String(init?.body ?? '{}'));
  gmailSends.push({ ...decodeGmailRaw(String(raw ?? '')), outcome });
  if (outcome === 'throw') throw new Error('k07a: stubbed Gmail transport failure');
  if (outcome === 'reject') {
    return new Response(JSON.stringify({ error: { code: 500, message: 'k07a: Gmail backend error' } }), { status: 500 });
  }
  return new Response(JSON.stringify({ id: `${P}gmail_msg_${gmailSends.length}` }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** The token of the /quote/<token> link in a quote email. */
function quoteTokenIn(text: string | null | undefined): string | undefined {
  return /\/quote\/([A-Za-z0-9_-]+)/.exec(text ?? '')?.[1];
}

/** The token of the /public/invoice/<token> pay link in an invoice email or URL. */
function linkTokenIn(text: string | null | undefined): string | undefined {
  return /\/public\/invoice\/([A-Za-z0-9_-]+)/.exec(text ?? '')?.[1];
}

/** A quote's send state (fresh read). */
async function quoteRow(quoteId: string) {
  return db.quote.findUnique({ where: { id: quoteId }, select: { status: true, viewToken: true, sentAt: true } });
}

/** An invoice's pay links (fresh read), oldest first. */
async function linksOf(invoiceId: string): Promise<any[]> {
  return db.paymentLink.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** Names of the recorded events that carry this quote. */
function quoteEventsIn(events: Array<{ name: string; payload: any }>, quoteId: string): string[] {
  return events.filter((e) => (e.payload?.quote?.id ?? e.payload?.quoteId) === quoteId).map((e) => e.name);
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_usage_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM llm_provider_costs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function as<T extends { set: (k: string, v: string) => T }>(req: T, actor = ID.owner): T {
  return req.set(HEADER, actor);
}

/** The structured 503 an unconfigured optional service answers, through the production filter. */
function expectNotConfigured(res: { status: number; body: any }, service: 'gmail' | 'ai') {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.body.statusCode).toBe(503);
  expect(res.body.code).toBe('provider_not_configured');
  expect(res.body.details?.service).toBe(service);
  expect(typeof res.body.message).toBe('string');
  expect(res.body.message.length).toBeGreaterThan(0);
}

/** Ledger rows of a business (fresh read). */
async function ledgerCounts(businessId: string) {
  return {
    transactions: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

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
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { AiAdvisorService } = await import('../src/modules/ai/ai-advisor.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const { LangfuseService } = await import('../src/modules/ai/langfuse.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  // The plan is off the boundary: unlimited, so neither the invoice limit nor
  // the AI credit check can be what answers a case.
  const plan = {
    checkLimit: async () => ({ allowed: true }),
    getActiveSubscription: async () => ({ limits: { aiCreditsPerMonth: -1 } }),
  };
  const llmCostRecorder = { recordCost: async (row: any) => { llmCostWrites.push(row); return row; } };
  const outputTemplatesOff = {
    resolveTemplate: async () => { throw new Error('k07a: output templates are off the boundary'); },
  };
  const blueprintOff = { getBlueprintContext: async () => null };

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, AiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      // The optional service under test, real: no GmailConnector is provided (it is @Optional).
      GmailService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async (e: any) => { contactEvents.push(e); return null; } } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: plan },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
      // The AI dispatch chain, real. The gateway's cost and trace collaborators
      // are constructor-typed (no @Inject), so the chain is built by factory.
      {
        provide: ModelGatewayService,
        useFactory: (prisma: any) => new ModelGatewayService(prisma, llmCostRecorder as any, new LangfuseService()),
        inject: [PrismaService],
      },
      {
        provide: AiUsageService,
        useFactory: (prisma: any, gateway: any) => new AiUsageService(prisma, plan as any, outputTemplatesOff as any, gateway),
        inject: [PrismaService, ModelGatewayService],
      },
      {
        provide: AiAdvisorService,
        useFactory: (prisma: any, usage: any) => new AiAdvisorService(prisma, usage, {} as any, blueprintOff as any),
        inject: [PrismaService, AiUsageService],
      },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return AI_CONTROLLER_OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();
  aiUsage = moduleRef.get(AiUsageService);

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
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
  await db.business.create({ data: { id: ID.biz, name: 'K07A Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  // Connected to Gmail once; the access token has since expired and only a
  // Google OAuth client could refresh it.
  await db.business.create({
    data: {
      id: ID.bizConnected,
      name: 'K07A Connected Biz',
      ownerId: ID.owner,
      currency: 'TTD',
      gmailEmail: `${P}mailbox@test.local`,
      gmailAccessToken: `${P}expired-access-token`,
      gmailRefreshToken: `${P}refresh-token`,
      gmailTokenExpiry: new Date(Date.now() - 60 * 60 * 1000),
    },
  });
  await db.membership.create({ data: { id: `${P}m_owner_conn`, userId: ID.owner, businessId: ID.bizConnected, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'K07a', lastName: 'Customer', email: `${P}c@test.local` } });
  await db.contact.create({ data: { id: ID.contactConnected, businessId: ID.bizConnected, firstName: 'K07a', lastName: 'Connected', email: `${P}cc@test.local` } });

  // R0-CMF4: connected to Gmail with an access token that is still live, so a
  // send reaches the (stubbed) Gmail transport with no refresh.
  await db.business.create({
    data: {
      id: ID.bizSend,
      name: 'K07A Send Biz',
      ownerId: ID.owner,
      currency: 'TTD',
      gmailEmail: `${P}sender@test.local`,
      gmailAccessToken: `${P}live-access-token`,
      gmailRefreshToken: `${P}refresh-token-send`,
      gmailTokenExpiry: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  await db.membership.create({ data: { id: `${P}m_owner_send`, userId: ID.owner, businessId: ID.bizSend, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactSend, businessId: ID.bizSend, firstName: 'K07a', lastName: 'Recipient', email: `${P}cs@test.local` } });

  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await seeder.ensureDefaults(ID.biz);
  await seeder.ensureDefaults(ID.bizConnected);
  await seeder.ensureDefaults(ID.bizSend);

  const invoices: Array<[string, string, string, string]> = [
    [ID.invDraft, ID.biz, ID.contact, 'DRAFT'],
    [ID.invSent, ID.biz, ID.contact, 'SENT'],
    [ID.invPaid, ID.biz, ID.contact, 'PAID'],
    [ID.invConnected, ID.bizConnected, ID.contactConnected, 'SENT'],
    [ID.invNoLink, ID.biz, ID.contact, 'DRAFT'],
    [ID.invSendFail, ID.bizSend, ID.contactSend, 'DRAFT'],
    [ID.invSendLinked, ID.bizSend, ID.contactSend, 'SENT'],
    [ID.invSendOk, ID.bizSend, ID.contactSend, 'DRAFT'],
  ];
  let n = 0;
  for (const [id, businessId, contactId, status] of invoices) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `K07A-${String(n).padStart(3, '0')}`,
        status,
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        businessId,
        contactId,
        paidAt: status === 'PAID' ? new Date() : null,
        items: { create: [{ id: `${id}_item1`, description: `K07A item ${n}`, quantity: 1, unitPrice: 100, total: 100 }] },
      },
    });
  }
  await db.quote.create({
    data: {
      id: ID.quoteSent,
      quoteNumber: 'K07A-Q-001',
      status: 'SENT',
      subtotal: 100,
      total: 100,
      currency: 'TTD',
      viewToken: `${P}quote-view-token`,
      sentAt: new Date(),
      businessId: ID.biz,
      contactId: ID.contact,
      items: { create: [{ id: `${ID.quoteSent}_item1`, description: 'K07A quote item', quantity: 1, unitPrice: 100, total: 100 }] },
    },
  });
  // R0-CMF4: DRAFT quotes, with no view token (R2: none is minted at draft time).
  const drafts: Array<[string, string, string]> = [
    [ID.quoteDraft, ID.biz, ID.contact],
    [ID.quoteSendFail, ID.bizSend, ID.contactSend],
    [ID.quoteSendOk, ID.bizSend, ID.contactSend],
  ];
  let q = 1;
  for (const [id, businessId, contactId] of drafts) {
    q += 1;
    await db.quote.create({
      data: {
        id,
        quoteNumber: `K07A-Q-${String(q).padStart(3, '0')}`,
        status: 'DRAFT',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        businessId,
        contactId,
        items: { create: [{ id: `${id}_item1`, description: `K07A draft quote item ${q}`, quantity: 1, unitPrice: 100, total: 100 }] },
      },
    });
  }
  // V1-49 (CR-V49-2): a receipt goes out only for a PAID invoice its own-tenant
  // rows settle, so the PAID fixture carries the payment that settled it (with
  // none, resend-receipt answers 403 'Invoice is not yet paid' before Gmail).
  await db.payment.create({
    data: {
      id: `${P}pay_invPaid`,
      invoiceId: ID.invPaid,
      businessId: ID.biz,
      amount: 100,
      currency: 'TTD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      providerPaymentId: `${P}manual_invPaid`,
    },
  });
  // R0-CMF4: the live pay link an earlier send gave invSendLinked.
  await db.paymentLink.create({
    data: { id: ID.linkSendLinked, invoiceId: ID.invSendLinked, businessId: ID.bizSend, token: LINKED_TOKEN },
  });

  // No case below may reach a real provider: every outbound fetch is recorded
  // and refused. Only while the R0-CMF4 block turns gmailTransport on is
  // Gmail's messages/send answered, in process, by the stub.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (gmailTransport && url === GMAIL_SEND_URL) return stubGmailSend(init);
    outbound.push(url);
    throw new Error('k07a: outbound traffic is refused in this suite');
  });
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  aiUsage?.onModuleDestroy?.();
  if (db) await cleanup();
  if (redis) await redis.quit();
  for (const key of PROVIDER_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('fixture sanity (real rows)', () => {
  it('no optional provider is configured: no Google OAuth client, no AI key, and the main business has no Gmail connection', async () => {
    for (const key of PROVIDER_ENV) expect(process.env[key], key).toBeUndefined();
    const biz = await db.business.findUnique({ where: { id: ID.biz }, select: { gmailEmail: true, gmailRefreshToken: true } });
    expect(biz).toEqual({ gmailEmail: null, gmailRefreshToken: null });
    expect((await db.invoice.findUnique({ where: { id: ID.invDraft } })).status).toBe('DRAFT');
    expect((await db.invoice.findUnique({ where: { id: ID.invPaid } })).status).toBe('PAID');
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } })).toBeGreaterThan(0);
  });
});

describe('Gmail send paths answer 503 provider_not_configured when Gmail is not connected', () => {
  it('POST /commerce/businesses/:b/invoices/:id/send-email answers 503 {code: provider_not_configured, service: gmail}', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${ID.invSent}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
    expect((await db.invoice.findUnique({ where: { id: ID.invSent } })).status).toBe('SENT');
  });

  it('LEDGER: a refused send-email leaves the DRAFT invoice DRAFT and writes no FinancialTransaction or LedgerEntry', async () => {
    const before = await ledgerCounts(ID.biz);
    const eventsBefore = emitted.length;
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${ID.invDraft}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
    const row = await db.invoice.findUnique({ where: { id: ID.invDraft } });
    expect(row.status).toBe('DRAFT');
    expect(row.sentAt).toBeNull();
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, externalRef: { contains: ID.invDraft } } })).toBe(0);
    expect(await db.payment.count({ where: { invoiceId: ID.invDraft } })).toBe(0);
    // No status transition, so no invoice event for it either.
    const forInvoice = emitted.slice(eventsBefore).filter((e) => (e.payload?.invoice?.id ?? e.payload?.invoiceId) === ID.invDraft);
    expect(forInvoice.map((e) => e.name)).toEqual([]);
  });

  it('POST /commerce/businesses/:b/invoices/:id/send-reminder answers 503 provider_not_configured and logs no reminder as sent', async () => {
    const before = contactEvents.length;
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${ID.invSent}/send-reminder`))
      .send({ recipientEmail: `${P}to@test.local`, channel: 'email' });
    expectNotConfigured(res, 'gmail');
    expect(contactEvents.slice(before).map((e) => e.type)).not.toContain('invoice.payment_reminder_sent');
    expect((await db.invoice.findUnique({ where: { id: ID.invSent } })).status).toBe('SENT');
  });

  it('POST /commerce/businesses/:b/invoices/:id/resend-receipt answers 503 provider_not_configured and records no receipt as sent', async () => {
    const before = contactEvents.length;
    const ledgerBefore = await ledgerCounts(ID.biz);
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${ID.invPaid}/resend-receipt`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
    expect(contactEvents.slice(before).map((e) => e.type)).not.toContain('invoice.receipt_sent');
    expect((await db.invoice.findUnique({ where: { id: ID.invPaid } })).status).toBe('PAID');
    expect(await ledgerCounts(ID.biz)).toEqual(ledgerBefore);
  });

  it('POST /commerce/businesses/:b/quotes/:id/send-email answers 503 provider_not_configured', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes/${ID.quoteSent}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
  });

  it('R0-CMF4: a refused quote send-email (503) leaves the DRAFT quote DRAFT: no viewToken, no sentAt, no quote.sent event or contact event', async () => {
    const eventsBefore = emitted.length;
    const contactBefore = contactEvents.length;
    expect(await quoteRow(ID.quoteDraft)).toEqual({ status: 'DRAFT', viewToken: null, sentAt: null });
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/quotes/${ID.quoteDraft}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
    expect(await quoteRow(ID.quoteDraft)).toEqual({ status: 'DRAFT', viewToken: null, sentAt: null });
    expect(quoteEventsIn(emitted.slice(eventsBefore), ID.quoteDraft)).toEqual([]);
    expect(contactEvents.slice(contactBefore).filter((e) => e.data?.quoteId === ID.quoteDraft)).toEqual([]);
  });

  it('R0-CMF4: a refused invoice send-email (503) leaves no new PaymentLink row, and the DRAFT invoice DRAFT', async () => {
    expect(await linksOf(ID.invNoLink)).toEqual([]);
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${ID.invNoLink}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
    expect(await linksOf(ID.invNoLink)).toEqual([]);
    expect(await db.invoice.findUnique({ where: { id: ID.invNoLink }, select: { status: true, sentAt: true } }))
      .toEqual({ status: 'DRAFT', sentAt: null });
  });

  it('POST /commerce/businesses/:b/gmail/messages/send answers 503 provider_not_configured', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/gmail/messages/send`))
      .send({ to: `${P}to@test.local`, subject: 'k07a', htmlBody: '<p>k07a</p>' });
    expectNotConfigured(res, 'gmail');
  });

  it('a connected business whose token expired, with no Google OAuth client to refresh it, answers 503 provider_not_configured on send-email', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.bizConnected}/invoices/${ID.invConnected}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
    expectNotConfigured(res, 'gmail');
    expect((await db.invoice.findUnique({ where: { id: ID.invConnected } })).status).toBe('SENT');
  });

  it('GET /commerce/businesses/:b/gmail/auth-url answers 503 provider_not_configured when no Google OAuth client is configured', async () => {
    const res = await as(agent().get(`/commerce/businesses/${ID.biz}/gmail/auth-url`));
    expectNotConfigured(res, 'gmail');
  });

  it('GET /commerce/businesses/:b/gmail/status still answers 200 {connected: false}: reporting the state is not a failure', async () => {
    const res = await as(agent().get(`/commerce/businesses/${ID.biz}/gmail/status`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ connected: false, email: null });
  });

  it('no Gmail case made an outbound call', () => {
    expect(outbound).toEqual([]);
  });
});

describe('AI dispatch answers a structured 503 when no AI provider is configured', () => {
  it('POST /ai/businesses/:b/ai/chat answers 503 {code: provider_not_configured, service: ai}', async () => {
    const res = await as(agent().post(`/ai/businesses/${ID.biz}/ai/chat`)).send({ message: 'How is my cash flow?' });
    expectNotConfigured(res, 'ai');
  });

  it('the refused dispatch bills nothing: no AiUsageLog row, no LLM cost write, no outbound call', async () => {
    expect(await db.aiUsageLog.count({ where: { businessId: ID.biz } })).toBe(0);
    expect(llmCostWrites).toEqual([]);
    expect(outbound).toEqual([]);
  });
});

describe('Release 0 money routes still answer 2xx in the same environment', () => {
  const S: { invoiceId?: string; firstPaymentId?: string } = {};

  it('POST /commerce/businesses/:b/invoices creates a DRAFT invoice (201)', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices`)).send({
      contactId: ID.contact,
      currency: 'TTD',
      items: [{ description: 'K07A consulting', quantity: 2, unitPrice: 50 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', total: 100, contactId: ID.contact });
    S.invoiceId = res.body.id;
  });

  it('PATCH /commerce/invoices/:id/status/sent issues it (200)', async () => {
    expect(S.invoiceId).toBeTruthy();
    const res = await as(agent().patch(`/commerce/invoices/${S.invoiceId}/status/sent`))
      .send({ businessId: ID.biz, status: 'SENT', sentAt: new Date().toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: S.invoiceId, status: 'SENT' });
  });

  it('POST /commerce/businesses/:b/invoices/:id/payments records a partial manual payment (201) and posts it to the ledger', async () => {
    expect(S.invoiceId).toBeTruthy();
    const before = await ledgerCounts(ID.biz);
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${S.invoiceId}/payments`))
      .send({ amount: 40, method: 'cash', reference: `${P}ref-001` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment?.id).toBeTruthy();
    S.firstPaymentId = res.body.payment.id;
    expect((await db.invoice.findUnique({ where: { id: S.invoiceId } })).status).toBe('PARTIALLY_PAID');
    const after = await ledgerCounts(ID.biz);
    expect(after.transactions).toBeGreaterThan(before.transactions);
    expect(after.entries).toBeGreaterThan(before.entries);
  });

  it('GET /commerce/businesses/:b/invoices/:id/payments answers the balance (200)', async () => {
    const res = await as(agent().get(`/commerce/businesses/${ID.biz}/invoices/${S.invoiceId}/payments`));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ paidAmount: 40, remaining: 60, invoiceTotal: 100 });
  });

  it('POST a settling payment (201) moves the invoice to PAID', async () => {
    const res = await as(agent().post(`/commerce/businesses/${ID.biz}/invoices/${S.invoiceId}/payments`))
      .send({ amount: 60, method: 'cash', reference: `${P}ref-002` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await db.invoice.findUnique({ where: { id: S.invoiceId } })).status).toBe('PAID');
  });

  it('GET /commerce/businesses/:b/invoices and GET /commerce/businesses/:b/payments list them (200)', async () => {
    const invoices = await as(agent().get(`/commerce/businesses/${ID.biz}/invoices`));
    expect(invoices.status, JSON.stringify(invoices.body)).toBe(200);
    expect(invoices.body.data.find((i: any) => i.id === S.invoiceId)).toMatchObject({ status: 'PAID' });
    const payments = await as(agent().get(`/commerce/businesses/${ID.biz}/payments`));
    expect(payments.status, JSON.stringify(payments.body)).toBe(200);
    expect(JSON.stringify(payments.body)).toContain(S.firstPaymentId);
  });

  it('GET /commerce/invoices/:id/receipt answers the receipt (200)', async () => {
    const res = await as(agent().get(`/commerce/invoices/${S.invoiceId}/receipt`).query({ businessId: ID.biz }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('the ledger the money routes wrote is balanced, and no money route made an outbound call', async () => {
    const entries = await db.ledgerEntry.findMany({ where: { businessId: ID.biz } });
    expect(entries.length).toBeGreaterThan(0);
    const debit = entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
    const credit = entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    expect(outbound).toEqual([]);
  });
});

// R0-07 review ST-2: a signed Gmail OAuth state is good for one callback. The
// real GmailService is built here with a Google OAuth client and state secret
// (the app above deliberately has none); nothing in this block calls out.
describe('Gmail OAuth state (R0-07 review)', () => {
  const OAUTH_ENV: Record<string, string> = {
    GOOGLE_CLIENT_ID: `${P}client-id`,
    GOOGLE_CLIENT_SECRET: `${P}client-secret`,
    GMAIL_REDIRECT_URI: 'http://localhost:3001/api/commerce/gmail/callback',
    GOOGLE_STATE_SECRET: `${P}state-secret`,
  };

  async function configuredGmail() {
    const { GmailService } = await import('../src/modules/commerce/gmail.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    Object.assign(process.env, OAUTH_ENV);
    try {
      return new GmailService(app.get(PrismaService));
    } finally {
      for (const key of Object.keys(OAUTH_ENV)) delete process.env[key];
    }
  }

  function stateOf(url: string): string {
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();
    return state as string;
  }

  it('ST-2: a signed state is accepted once; the same state replayed is refused, and a fresh state still works', async () => {
    const gmail = await configuredGmail();

    const first = stateOf(gmail.getAuthUrl(ID.biz));
    expect(gmail.verifyState(first)).toMatchObject({ businessId: ID.biz, purpose: 'gmail' });
    expect(gmail.verifyState(first)).toBeNull();
    expect(gmail.verifyState(first)).toBeNull();

    const second = stateOf(gmail.getAuthUrl(ID.biz));
    expect(gmail.verifyState(second)).toMatchObject({ businessId: ID.biz, purpose: 'gmail' });
    expect(outbound).toEqual([]);
  });

  it.todo(
    'ST-2: the state names the initiating user, and gmail/callback links the mailbox only for that signed-in user (or after they confirm) - ' +
      'needs commerce.controller.ts (getGmailAuthUrl passes the user; the unauthenticated callback checks or defers to a session), outside the R0-07 write set',
  );
  it.todo(
    'ST-3: GET /commerce/businesses/:b/gmail/auth-url requires the authority to connect or replace the mailbox, so STAFF (revenue:read) answers 403 - ' +
      'the guard is RequireModuleScope(revenue, read) in commerce.controller.ts, outside the R0-07 write set',
  );
  it.todo(
    'ST-4 / R07-CR-1: the web client hands a GET 503 {code: provider_not_configured} to its caller on the first response (body intact, no retry, no backend-unreachable warning) - ' +
      'apps/web/src/lib/fetch-with-retry.ts and api.ts retry every GET 503 three times and drop the body; outside the R0-07 write set',
  );
});

// R0-CMF4-SEND-EMAIL-ORDER (COST-LEDGER-001 section 7 items 2 and 3). bizSend
// is connected to Gmail with a live access token, so the real GmailService
// builds the message and hands it to fetch, where the stubbed Gmail transport
// throws (a network failure), answers an error (Gmail refused the message), or
// accepts it. Nothing leaves the process.
describe('R0-CMF4: with Gmail connected (stubbed transport), a failed send changes nothing; an accepted send marks the quote SENT and mints one pay link', () => {
  const FAILURES = ['throw', 'reject'] as const;

  afterAll(() => {
    gmailTransport = null;
  });

  function sendQuote(quoteId: string) {
    return as(agent().post(`/commerce/businesses/${ID.bizSend}/quotes/${quoteId}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
  }

  function sendInvoice(invoiceId: string) {
    return as(agent().post(`/commerce/businesses/${ID.bizSend}/invoices/${invoiceId}/send-email`))
      .send({ recipientEmail: `${P}to@test.local` });
  }

  /**
   * A failed send keeps its existing error: Gmail's refusal is the old 400
   * 'Failed to send email'; a transport that throws is a 5xx. Neither is the
   * not-configured 503 (the business is connected).
   */
  function expectSendFailed(res: { status: number; body: any }, mode: (typeof FAILURES)[number]) {
    if (mode === 'reject') {
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.message).toBe('Failed to send email');
    } else {
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(500);
      expect(res.body.code).not.toBe('provider_not_configured');
    }
  }

  it('a failed quote send-email (the transport throws, or Gmail answers an error) leaves the DRAFT quote DRAFT: no viewToken, no sentAt, no quote.sent event or contact event', async () => {
    const eventsBefore = emitted.length;
    const contactBefore = contactEvents.length;
    const sendsBefore = gmailSends.length;
    expect(await quoteRow(ID.quoteSendFail)).toEqual({ status: 'DRAFT', viewToken: null, sentAt: null });
    for (const mode of FAILURES) {
      gmailTransport = mode;
      const res = await sendQuote(ID.quoteSendFail);
      expectSendFailed(res, mode);
      expect(await quoteRow(ID.quoteSendFail), mode).toEqual({ status: 'DRAFT', viewToken: null, sentAt: null });
    }
    // Both attempts reached the transport, and the quote link each carried was never stored.
    const attempts = gmailSends.slice(sendsBefore);
    expect(attempts.map((m) => m.outcome)).toEqual(['throw', 'reject']);
    for (const m of attempts) {
      const token = quoteTokenIn(m.html);
      expect(token).toMatch(RANDOM_TOKEN);
      expect(await db.quote.count({ where: { viewToken: token } })).toBe(0);
    }
    expect(quoteEventsIn(emitted.slice(eventsBefore), ID.quoteSendFail)).toEqual([]);
    expect(contactEvents.slice(contactBefore).filter((e) => e.data?.quoteId === ID.quoteSendFail)).toEqual([]);
  });

  it('a failed invoice send-email leaves no new PaymentLink row, the DRAFT invoice DRAFT and the ledger as it was', async () => {
    const ledgerBefore = await ledgerCounts(ID.bizSend);
    const sendsBefore = gmailSends.length;
    expect(await linksOf(ID.invSendFail)).toEqual([]);
    for (const mode of FAILURES) {
      gmailTransport = mode;
      const res = await sendInvoice(ID.invSendFail);
      expectSendFailed(res, mode);
      expect(await linksOf(ID.invSendFail), mode).toEqual([]);
      expect(await db.invoice.findUnique({ where: { id: ID.invSendFail }, select: { status: true, sentAt: true } }), mode)
        .toEqual({ status: 'DRAFT', sentAt: null });
    }
    // Each attempt carried a pay link (D-07), and its token was never stored.
    const attempts = gmailSends.slice(sendsBefore);
    expect(attempts.map((m) => m.outcome)).toEqual(['throw', 'reject']);
    for (const m of attempts) {
      const token = linkTokenIn(m.html);
      expect(token).toMatch(RANDOM_TOKEN);
      expect(await db.paymentLink.count({ where: { token } })).toBe(0);
    }
    expect(await ledgerCounts(ID.bizSend)).toEqual(ledgerBefore);
  });

  it('a failed send on an invoice that already has a live link reuses that link and leaves it as it was', async () => {
    const before = await linksOf(ID.invSendLinked);
    expect(before.map((l) => [l.id, l.token, l.active])).toEqual([[ID.linkSendLinked, LINKED_TOKEN, true]]);
    for (const mode of FAILURES) {
      gmailTransport = mode;
      const res = await sendInvoice(ID.invSendLinked);
      expectSendFailed(res, mode);
      expect(linkTokenIn(gmailSends.at(-1)?.html), mode).toBe(LINKED_TOKEN);
    }
    expect(await linksOf(ID.invSendLinked)).toEqual(before);
    expect((await db.invoice.findUnique({ where: { id: ID.invSendLinked } })).status).toBe('SENT');
  });

  it('a quote send-email Gmail accepted moves the DRAFT quote to SENT, stores the viewToken the email carried, emits quote.sent once, and the link opens the quote', async () => {
    gmailTransport = 'accept';
    const eventsBefore = emitted.length;
    const sendsBefore = gmailSends.length;
    const res = await sendQuote(ID.quoteSendOk);
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.quote).toMatchObject({ id: ID.quoteSendOk, status: 'SENT' });
    const row = await quoteRow(ID.quoteSendOk);
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.viewToken).toMatch(RANDOM_TOKEN);
    const sent = gmailSends.slice(sendsBefore);
    expect(sent.map((m) => [m.outcome, m.to])).toEqual([['accept', `${P}to@test.local`]]);
    expect(quoteTokenIn(sent[0]!.html)).toBe(row.viewToken);
    expect(quoteEventsIn(emitted.slice(eventsBefore), ID.quoteSendOk)).toEqual(['quote.sent']);
    const view = await agent().get(`/commerce/public/quotes/${row.viewToken}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body).toMatchObject({ quoteNumber: 'K07A-Q-004', status: 'SENT' });
  });

  it('an invoice send-email Gmail accepted mints exactly one live PaymentLink, puts its token link in the email and the response (D-07), and moves the DRAFT invoice to SENT', async () => {
    gmailTransport = 'accept';
    const sendsBefore = gmailSends.length;
    expect(await linksOf(ID.invSendOk)).toEqual([]);
    const res = await sendInvoice(ID.invSendOk);
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const links = await linksOf(ID.invSendOk);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ businessId: ID.bizSend, active: true, expiresAt: null });
    expect(links[0].token).toMatch(RANDOM_TOKEN);
    const sent = gmailSends.slice(sendsBefore);
    expect(sent.map((m) => m.outcome)).toEqual(['accept']);
    expect(linkTokenIn(sent[0]!.html)).toBe(links[0].token);
    expect(linkTokenIn(res.body.paymentUrl)).toBe(links[0].token);
    expect(res.body).toMatchObject({ success: true, messageId: `${P}gmail_msg_${gmailSends.length}` });
    const invoice = await db.invoice.findUnique({ where: { id: ID.invSendOk }, select: { status: true, sentAt: true } });
    expect(invoice.status).toBe('SENT');
    expect(invoice.sentAt).toBeInstanceOf(Date);
    const view = await agent().get(`/commerce/public/invoice-link/${links[0].token}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body).toMatchObject({ ok: true, token: links[0].token });
  });

  it('a second send-email (resend) reuses that link: still one row, the same token in the email and the response', async () => {
    gmailTransport = 'accept';
    const before = await linksOf(ID.invSendOk);
    expect(before).toHaveLength(1);
    const sendsBefore = gmailSends.length;
    const res = await sendInvoice(ID.invSendOk);
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(await linksOf(ID.invSendOk)).toEqual(before);
    const sent = gmailSends.slice(sendsBefore);
    expect(sent.map((m) => m.outcome)).toEqual(['accept']);
    expect(linkTokenIn(sent[0]!.html)).toBe(before[0].token);
    expect(linkTokenIn(res.body.paymentUrl)).toBe(before[0].token);
  });

  it('no case of this block made an outbound call: every message went to the stubbed Gmail transport', () => {
    expect(gmailSends.length).toBeGreaterThan(0);
    expect(outbound).toEqual([]);
  });
});
