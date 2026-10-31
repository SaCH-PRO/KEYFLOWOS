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
 * refusing recorder for the whole suite.
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
};

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

  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await seeder.ensureDefaults(ID.biz);
  await seeder.ensureDefaults(ID.bizConnected);

  const invoices: Array<[string, string, string, string]> = [
    [ID.invDraft, ID.biz, ID.contact, 'DRAFT'],
    [ID.invSent, ID.biz, ID.contact, 'SENT'],
    [ID.invPaid, ID.biz, ID.contact, 'PAID'],
    [ID.invConnected, ID.bizConnected, ID.contactConnected, 'SENT'],
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
  // A PAID invoice is settled by its own payments since V1-49 (CR-V49-2): the
  // receipt routes refuse a PAID row that no own-tenant SUCCESSFUL payment
  // covers, before Gmail is consulted. Without this row the resend-receipt case
  // below would stop at that refusal and never reach the R0-07 503.
  await db.payment.create({
    data: {
      id: `${P}pay_invPaid`,
      amount: 100,
      currency: 'TTD',
      status: 'SUCCESSFUL',
      provider: 'manual',
      method: 'cash',
      providerPaymentId: `${P}pp_invPaid`,
      businessId: ID.biz,
      invoiceId: ID.invPaid,
    },
  });
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

  // No case below may reach a real provider: every outbound fetch is recorded and refused.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    outbound.push(typeof input === 'string' ? input : String(input?.url ?? input));
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
