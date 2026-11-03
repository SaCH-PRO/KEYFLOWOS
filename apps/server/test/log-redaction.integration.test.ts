/**
 * V1-40-SEC-TRUST-CENSUS-REDACTION — log-redaction negative control (REAL
 * database), the packet-branch agent gate, dependabot and the Release 0 trust
 * census (CF-32, CF-33; owner ruling D-22).
 *
 * IA-044 (log_secret_pii_redaction, T0) asks for "negative tests for
 * secret/token/PII leakage across logs". None existed. This suite runs three
 * Release 0 flows through the production request path with every log surface
 * the server writes to recorded, and fails if a log entry carries:
 *
 *   - a contact email (the invoice's customer, and the contact the operator
 *     creates, with its duplicate-submit 409);
 *   - a bearer token: the operator's `Authorization: Bearer <jwt>` (verified by
 *     the real AuthMiddleware), and the public invoice link's token, which is
 *     the customer's bearer credential for GET /commerce/public/invoice-link/:token;
 *   - the providerPaymentId recordPayment derives (R0-D2), whole or its digest.
 *
 *   flow                                   window
 *   POST .../invoices/:id/payments         operator, bearer JWT, idempotency key
 *   POST .../contacts (+ the same again)   operator, bearer JWT; the second is the 409
 *   GET  /commerce/public/invoice-link/:t  anonymous customer, link token in the path
 *
 * THE LOGGER SPY. During each window every log surface is replaced by a
 * recorder: the Nest Logger instance methods (every `new Logger(ctx).x()` in
 * src), the Logger statics, ConsoleLogger (a direct ConsoleLogger use) and
 * console.log/info/warn/error/debug/trace. Each entry is rendered the way
 * ConsoleLogger would print it (strings as they are, anything else through
 * util.inspect), so an object or an Error that carries a secret is caught too.
 * Every level is recorded, debug and verbose included: main.ts creates the app
 * with no `logger` option, so Nest's default ConsoleLogger prints all six
 * levels (DEFAULT_LOG_LEVELS, @nestjs/common console-logger.service.js).
 * Each window first asserts the spy saw the window's own HTTP access line, so
 * an empty capture can never pass as "nothing leaked".
 *
 * THE REQUEST PATH. As app.module.ts wires it: CorrelationIdMiddleware, the
 * real AuthMiddleware (a locally signed HS256 token, SUPABASE_JWT_SECRET set
 * for this suite and SUPABASE_URL unset, so no provider traffic), the three
 * APP_INTERCEPTORs (LoggingInterceptor, BusinessEventInterceptor with the real
 * ResilientEmitterService and BusinessEventService, TenantInterceptor with the
 * Prisma tenant context provider installed), GlobalHttpExceptionFilter and
 * ValidationPipe. AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard,
 * CrmRateLimitGuard, PublicRateLimitGuard (real Redis at REDIS_URL, this
 * suite's own key namespace), CommerceController/Service, InvoiceWorkflowService,
 * the real ledger chain, CrmController/Service, CrmTimelineService,
 * ContactAuditService and TimelineService are real against the database.
 * Stand-ins: the BullMQ queue (its stand-in hands the job to the real
 * BusinessEventService.emit, as the worker does), Gmail, Drive, AI, catalog,
 * stats caches and the plan-limit count. Listeners other modules register on
 * contact.created / invoice.paid are not mounted here.
 *
 * RESULT. No contact email, operator bearer JWT or providerPaymentId reaches
 * the logs in any window. The public link token does: LoggingInterceptor's
 * access line is built from req.url
 * (apps/server/src/core/interceptors/logging.interceptor.ts:22). That fix is
 * outside the packet's write set, so its negative control is it.todo naming
 * the file, and a CHARACTERIZATION case pins the one leaking line until it lands.
 *
 * Fixtures: prefix `v40a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; no
 * $transaction wrapping. Literals in globally unique columns embed the prefix.
 *
 * The file also carries the packet's static proofs, which need no database:
 * the agent gate binds pkt/* heads (D-22), dependabot is configured, and the
 * Release 0 trust census cites an existing test path or OPEN on every row and a
 * disposition on every T0 row.
 */
import 'reflect-metadata';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { inspect } from 'util';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Logger, ConsoleLogger } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const REPO_ROOT = path.resolve(__dirname, '../../..');

const P = 'v40a_';

// ---------------------------------------------------------------------------
// The log recorder (the Logger spy)
// ---------------------------------------------------------------------------

interface LogEntry {
  channel: string;
  text: string;
}

const LOG_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

/** One argument the way ConsoleLogger prints it: a string as it is, anything else inspected in full. */
function renderArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  return inspect(arg, { depth: 12, breakLength: Infinity, maxArrayLength: null, maxStringLength: null });
}

function render(args: unknown[]): string {
  return args.map(renderArg).join(' ');
}

/**
 * Record every log call until stop(). Nothing recorded is printed: the
 * recorder replaces the surface, so each entry is seen exactly once.
 */
function startCapture(): { entries: LogEntry[]; stop: () => void } {
  const entries: LogEntry[] = [];
  const spies: Array<{ mockRestore: () => void }> = [];
  for (const level of LOG_LEVELS) {
    spies.push(
      vi.spyOn(Logger.prototype as any, level).mockImplementation(function (this: any, ...args: unknown[]) {
        entries.push({ channel: `Logger#${level}[${this?.context ?? '-'}]`, text: render(args) });
      }),
    );
    spies.push(
      vi.spyOn(Logger as any, level).mockImplementation((...args: unknown[]) => {
        entries.push({ channel: `Logger.${level}`, text: render(args) });
      }),
    );
    spies.push(
      vi.spyOn(ConsoleLogger.prototype as any, level).mockImplementation(function (this: any, ...args: unknown[]) {
        entries.push({ channel: `ConsoleLogger#${level}[${this?.context ?? '-'}]`, text: render(args) });
      }),
    );
  }
  for (const method of CONSOLE_METHODS) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        entries.push({ channel: `console.${method}`, text: render(args) });
      }),
    );
  }
  return {
    entries,
    stop: () => {
      for (const s of spies.reverse()) s.mockRestore();
    },
  };
}

/** The entries (channel + text) that contain any of the needles, case-insensitively. */
function entriesContaining(entries: LogEntry[], needles: string[]): LogEntry[] {
  const lowered = needles.filter((n) => n.length > 0).map((n) => n.toLowerCase());
  return entries.filter((e) => lowered.some((n) => e.text.toLowerCase().includes(n)));
}

/** An email and the encodings it could take in a logged URL or JSON body. */
function emailForms(email: string): string[] {
  return [email, encodeURIComponent(email)];
}

// ---------------------------------------------------------------------------
// Identity: a locally verified HS256 bearer token (no provider traffic)
// ---------------------------------------------------------------------------

/** Test-only HS256 secret for the real AuthMiddleware. Not a real secret. */
const JWT_SECRET = 'v40a-test-only-hs256-secret-not-a-real-credential-000000';
const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** An HS256 JWT shaped like a Supabase access token (no `iss`: accepted under NODE_ENV=test with no SUPABASE_URL). */
function mintToken(sub: string, email: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** The parts of a JWT whose presence in a log is the token's: the whole, the signed input, the payload, the signature. */
function tokenForms(token: string): string[] {
  const [header, payload, signature] = token.split('.');
  return [token, `${header}.${payload}`, payload, signature];
}

// ===========================================================================
// 0. The recorder catches a planted leak on every surface (no database)
// ===========================================================================

describe('the log recorder: a planted secret is caught on every log surface', () => {
  const SECRET = `${P}Planted.Secret@Test.Local`;

  it('Logger instance (every level), Logger statics, ConsoleLogger, console and non-string arguments are recorded and matched', () => {
    const cap = startCapture();
    try {
      const logger = new Logger('V40aProbe');
      logger.log(`log ${SECRET}`);
      logger.debug(`debug ${SECRET}`);
      logger.verbose(`verbose ${SECRET}`);
      logger.warn({ nested: { email: SECRET } }, 'object first');
      logger.error('error with a stack', new Error(`boom ${SECRET}`).stack);
      logger.fatal(`fatal ${SECRET}`);
      Logger.warn(`static ${SECRET}`, 'V40aStatic');
      new ConsoleLogger('V40aConsoleLogger').log(`console logger ${SECRET}`);
      console.error('console error', new Error(`console ${SECRET}`));
      console.log({ deep: { deeper: { deepest: [SECRET] } } });
    } finally {
      cap.stop();
    }
    const hits = entriesContaining(cap.entries, [SECRET.toUpperCase()]);
    expect(hits.map((h) => h.channel)).toEqual([
      'Logger#log[V40aProbe]',
      'Logger#debug[V40aProbe]',
      'Logger#verbose[V40aProbe]',
      'Logger#warn[V40aProbe]',
      'Logger#error[V40aProbe]',
      'Logger#fatal[V40aProbe]',
      'Logger.warn',
      'ConsoleLogger#log[V40aConsoleLogger]',
      'console.error',
      'console.log',
    ]);
  });

  it('stop() restores every surface: nothing is recorded after it', () => {
    const cap = startCapture();
    cap.stop();
    const restored = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      new Logger('V40aAfterStop').log(`after ${SECRET}`);
    } finally {
      restored.mockRestore();
    }
    expect(cap.entries).toEqual([]);
  });
});

// ===========================================================================
// 1. Log-redaction negative control (real database)
// ===========================================================================

describe('log redaction: no contact email, bearer token or providerPaymentId in the log output (REAL database)', () => {
  const HEADER_AUTH = 'authorization';

  const ID = {
    owner: `${P}owner`,
    biz: `${P}biz`,
    customer: `${P}customer`,
    invoice: `${P}inv`,
  };

  /** The invoice's customer: on the invoice the payment and the public link read. */
  const CUSTOMER_EMAIL = `${P}invoice.customer@test.local`;
  /** The contact the operator creates through POST .../contacts. */
  const NEW_CONTACT_EMAIL = `${P}new.contact@test.local`;
  const OWNER_EMAIL = `${P}owner@test.local`;
  const IDEMPOTENCY_KEY = `${P}idem-0001`;
  const TOTAL = 250;

  // This suite's public rate-limit keys live under its own namespace.
  const RATE_LIMIT_NS = P;

  // Environment this suite sets and restores.
  const ENV_KEYS = [
    'RATE_LIMIT_KEY_NAMESPACE',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ] as const;
  const previousEnv: Record<string, string | undefined> = {};

  let db: any;
  let app: any;
  let redis: any;
  let setTenantContextProvider: ((p: { getCurrentBusinessId: () => string | undefined }) => void) | undefined;

  let bearer = '';
  let linkToken = '';

  /** What each window recorded, and what it read afterwards. */
  const windows: Record<string, { entries: LogEntry[]; status: number[] }> = {};
  let providerPaymentId = '';

  async function cleanup() {
    for (const sql of [
      `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
      `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
    ]) {
      try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
    }
  }

  async function clearRateLimits() {
    const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
    if (keys.length) await redis.del(...keys);
  }

  function agent() {
    return request(app.getHttpServer());
  }

  /** Wait for a fire-and-forget write to land, so its logging happens inside the window. */
  async function until(check: () => Promise<boolean>, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Let any other fire-and-forget work a request started reach its log calls. */
  const settle = () => new Promise((r) => setTimeout(r, 400));

  /** Run one flow inside a capture window. */
  async function captureWindow(name: string, flow: () => Promise<number[]>) {
    const cap = startCapture();
    let status: number[] = [];
    try {
      status = await flow();
      await settle();
    } finally {
      cap.stop();
    }
    windows[name] = { entries: cap.entries, status };
  }

  /** The access line LoggingInterceptor writes for a request (the spy's liveness check). */
  function accessLines(entries: LogEntry[], method: string, pathPrefix: string): LogEntry[] {
    return entries.filter((e) => e.channel.endsWith('[HTTP]') && e.text.includes(`${method} ${pathPrefix}`));
  }

  function describeLeaks(leaks: LogEntry[]): string {
    return leaks.map((e) => `${e.channel}: ${e.text.slice(0, 300)}`).join('\n');
  }

  beforeAll(async () => {
    for (const k of ENV_KEYS) previousEnv[k] = process.env[k];
    process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
    process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
    // No provider client: the real AuthMiddleware verifies the token locally.
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const dbMod = await import('@keyflow/db');
    db = dbMod.db;
    setTenantContextProvider = dbMod.setTenantContextProvider;

    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { APP_INTERCEPTOR } = await import('@nestjs/core');
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const IORedis = (await import('ioredis')).default;
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
    const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
    const { CorrelationIdMiddleware } = await import('../src/core/middleware/correlation-id.middleware');
    const { LoggingInterceptor } = await import('../src/core/interceptors/logging.interceptor');
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { getCurrentBusinessId } = await import('../src/core/tenant/tenant-context');
    const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
    const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');
    const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
    const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
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
    const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
    const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
    const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
    const { PostingService } = await import('../src/modules/finance/posting.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
    const { TimelineService } = await import('../src/modules/timeline/timeline.service');
    const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
    const { CrmController } = await import('../src/modules/crm/crm.controller');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
    const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
    const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
    const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
    const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
    const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
    const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
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

    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

    const moduleRef = await Test.createTestingModule({
      controllers: [CommerceController, CrmController],
      providers: [
        PrismaService,
        { provide: REDIS_CLIENT, useValue: redis },
        // Request path, as app.module.ts wires it.
        SupabaseAuthService,
        AuthMiddleware,
        { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
        { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
        ResilientEmitterService,
        BusinessEventService,
        // BullMQ stand-in: hands the job to the real BusinessEventService, as the worker does.
        {
          provide: BusinessEventQueueService,
          useFactory: (events: any) => ({
            enqueue: async (job: any) => {
              await events.emit({ ...job });
              return { id: `${P}job` };
            },
          }),
          inject: [BusinessEventService],
        },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        PublicRateLimitGuard,
        PlanLimitGuard,
        CrmRateLimitGuard,
        FeatureFlagGuard,
        TeamAuditInterceptor,
        { provide: EventEmitter2, useValue: new EventEmitter2() },
        // Commerce: the real payment, link and ledger chain.
        CommerceService,
        InvoiceWorkflowService,
        InvoiceReceiptBuilderService,
        RevenuePostingService,
        PostingService,
        ChartOfAccountsSeederService,
        PaymentEvidenceService,
        TimelineService,
        { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
        { provide: EvidenceService, useValue: {} },
        { provide: TaskAssignmentService, useValue: {} },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
        { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
        { provide: CatalogService, useValue: {} },
        { provide: PublicEventsService, useValue: {} },
        { provide: TimeEntryService, useValue: {} },
        { provide: GmailService, useValue: { sendEmail: async () => ({ messageId: `${P}msg` }) } },
        { provide: CommerceVisionService, useValue: {} },
        { provide: StoreReadinessService, useValue: {} },
        { provide: DocumentIntelligenceService, useValue: {} },
        { provide: GoogleDriveService, useValue: {} },
        // CRM: the real contact write, its in-transaction event and its audit entry.
        CrmService,
        CrmStatsService,
        CrmTimelineService,
        ContactAuditService,
        { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
        { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
        { provide: CrmListsService, useValue: {} },
        { provide: EntityResolutionService, useValue: {} },
        { provide: ContactCustomFieldValueService, useValue: {} },
        { provide: CrmImportService, useValue: {} },
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
    }).compile();

    app = moduleRef.createNestApplication();
    // app.module.ts: CorrelationIdMiddleware, then AuthMiddleware, on every route.
    const correlation = new CorrelationIdMiddleware();
    const auth = moduleRef.get(AuthMiddleware);
    app.use((req: any, res: any, next: any) => correlation.use(req, res, next));
    app.use((req: any, res: any, next: any) => {
      auth.use(req, res, next).catch(next);
    });
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    // main.ts installs the tenant context provider before the app serves.
    setTenantContextProvider({ getCurrentBusinessId });

    await cleanup(); // in case a prior run aborted
    await clearRateLimits();

    // ---- one tenant: an owner, the invoice's customer, a SENT invoice ------
    await db.user.create({ data: { id: ID.owner, email: OWNER_EMAIL, role: 'USER' } });
    await db.business.create({ data: { id: ID.biz, name: 'V40A Biz', ownerId: ID.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
    await db.contact.create({
      data: { id: ID.customer, businessId: ID.biz, firstName: 'V40a', lastName: 'Customer', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
    });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
    await db.invoice.create({
      data: {
        id: ID.invoice,
        invoiceNumber: 'V40A-001',
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.customer,
        items: { create: [{ id: `${ID.invoice}_item1`, description: 'V40A item', quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });

    bearer = mintToken(ID.owner, OWNER_EMAIL);

    // ---- the customer's link, minted by the real route (outside any window) --
    const link = await agent()
      .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payment-link`)
      .set(HEADER_AUTH, `Bearer ${bearer}`)
      .send({});
    if (link.status !== 201 || !link.body?.token) {
      throw new Error(`payment link failed (is the bearer token verified?): ${link.status} ${JSON.stringify(link.body)}`);
    }
    linkToken = link.body.token;

    // ---- window 1: recordPayment ---------------------------------------------
    await captureWindow('recordPayment', async () => {
      const res = await agent()
        .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payments`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send({ amount: 100, method: 'cash', reference: `${P}slip-0001`, idempotencyKey: IDEMPOTENCY_KEY });
      // The keyed replay: the same submit again answers from the recorded row.
      const replay = await agent()
        .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payments`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send({ amount: 100, method: 'cash', reference: `${P}slip-0001`, idempotencyKey: IDEMPOTENCY_KEY });
      await until(async () => (await db.businessEvent.count({ where: { businessId: ID.biz } })) > 0);
      return [res.status, replay.status];
    });
    const payment = await db.payment.findFirst({ where: { invoiceId: ID.invoice, businessId: ID.biz }, select: { providerPaymentId: true } });
    providerPaymentId = payment?.providerPaymentId ?? '';

    // ---- window 2: contact create, then the duplicate submit (409) ----------
    await captureWindow('contactCreate', async () => {
      const body = { firstName: `${P}Ada`, lastName: 'Lovelace', email: NEW_CONTACT_EMAIL, phone: '+1 868 555 0140' };
      const created = await agent()
        .post(`/crm/businesses/${ID.biz}/contacts`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send(body);
      const duplicate = await agent()
        .post(`/crm/businesses/${ID.biz}/contacts`)
        .set(HEADER_AUTH, `Bearer ${bearer}`)
        .send(body);
      const contactId = created.body?.id;
      if (contactId) {
        await until(async () => (await db.contactAuditEntry.count({ where: { businessId: ID.biz, contactId } })) > 0);
      }
      return [created.status, duplicate.status];
    });

    // ---- window 3: the customer opens the public invoice link ----------------
    await clearRateLimits();
    await captureWindow('publicInvoiceLink', async () => {
      const res = await agent().get(`/commerce/public/invoice-link/${encodeURIComponent(linkToken)}`);
      await until(async () => (await db.contactEvent.count({ where: { businessId: ID.biz, contactId: ID.customer, type: 'invoice.viewed' } })) > 0);
      return [res.status];
    });
  }, 180_000);

  afterAll(async () => {
    setTenantContextProvider?.({ getCurrentBusinessId: () => undefined });
    if (app) await app.close();
    if (db) await cleanup();
    if (redis) {
      try { await clearRateLimits(); } catch { /* best-effort */ }
      await redis.quit();
    }
    for (const k of ENV_KEYS) {
      if (previousEnv[k] === undefined) delete process.env[k];
      else process.env[k] = previousEnv[k];
    }
  });

  // ---- recordPayment ---------------------------------------------------------

  describe('POST /commerce/businesses/:businessId/invoices/:invoiceId/payments (recordPayment)', () => {
    it('the window ran the real flow: 201 recorded, the keyed replay answered, a providerPaymentId was derived, and the spy saw the access lines', () => {
      expect(windows.recordPayment.status).toEqual([201, 201]);
      expect(providerPaymentId).toMatch(new RegExp(`^manual_${ID.invoice}_key_[0-9a-f]{32}$`));
      expect(accessLines(windows.recordPayment.entries, 'POST', `/commerce/businesses/${ID.biz}/invoices/${ID.invoice}/payments`).length).toBe(2);
    });

    it('NEGATIVE CONTROL: no log entry carries the providerPaymentId, whole or its digest', () => {
      const digest = providerPaymentId.split('_key_')[1] ?? '';
      expect(digest).toHaveLength(32);
      const leaks = entriesContaining(windows.recordPayment.entries, [providerPaymentId, digest]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('NEGATIVE CONTROL: no log entry carries the operator bearer token (whole, signed input, payload or signature)', () => {
      const leaks = entriesContaining(windows.recordPayment.entries, tokenForms(bearer));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it("NEGATIVE CONTROL: no log entry carries the invoice customer's email", () => {
      const leaks = entriesContaining(windows.recordPayment.entries, emailForms(CUSTOMER_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });
  });

  // ---- contact create --------------------------------------------------------

  describe('POST /crm/businesses/:businessId/contacts (contact create, and its duplicate 409)', () => {
    it('the window ran the real flow: 201 created, the duplicate answered 409, and the spy saw both access lines', () => {
      expect(windows.contactCreate.status).toEqual([201, 409]);
      // One success line (debug) and one error line (the 409 reaches LoggingInterceptor's error branch).
      expect(accessLines(windows.contactCreate.entries, 'POST', `/crm/businesses/${ID.biz}/contacts`).length).toBe(2);
    });

    it("NEGATIVE CONTROL: no log entry carries the new contact's email", () => {
      const leaks = entriesContaining(windows.contactCreate.entries, emailForms(NEW_CONTACT_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('NEGATIVE CONTROL: no log entry carries the operator bearer token', () => {
      const leaks = entriesContaining(windows.contactCreate.entries, tokenForms(bearer));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });
  });

  // ---- public invoice link ---------------------------------------------------

  describe('GET /commerce/public/invoice-link/:token (the customer view)', () => {
    it('the window ran the real flow: 200, the view event landed, and the spy saw the access line', () => {
      expect(windows.publicInvoiceLink.status).toEqual([200]);
      expect(accessLines(windows.publicInvoiceLink.entries, 'GET', '/commerce/public/invoice-link/').length).toBe(1);
    });

    it("NEGATIVE CONTROL: no log entry carries the invoice customer's email", () => {
      const leaks = entriesContaining(windows.publicInvoiceLink.entries, emailForms(CUSTOMER_EMAIL));
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    it('NEGATIVE CONTROL: no log entry carries the providerPaymentId of the payment on the viewed invoice', () => {
      const digest = providerPaymentId.split('_key_')[1] ?? '';
      const leaks = entriesContaining(windows.publicInvoiceLink.entries, [providerPaymentId, digest]);
      expect(leaks, describeLeaks(leaks)).toEqual([]);
    });

    // RED at b1e8f5f5 (the tests-first commit ran this case as a real `it` and
    // it failed): LoggingInterceptor's access line carries the token. The fix
    // is in a production logger call outside this packet's write set:
    // apps/server/src/core/interceptors/logging.interceptor.ts:22 builds the
    // line from req.url (emitted at :25 slow, :27 debug, :31-33 error), and
    // main.ts keeps Nest's default ConsoleLogger, which prints debug. Logging
    // the route pattern (req.route?.path) instead of the URL closes it for
    // every token-in-path route. When that lands, this todo becomes the `it`
    // below with the CHARACTERIZATION case removed.
    it.todo(
      "NEGATIVE CONTROL: no log entry carries the link token (the customer's bearer credential) — " +
        'fix outside the write set: apps/server/src/core/interceptors/logging.interceptor.ts:22 logs req.url',
    );

    it('CHARACTERIZATION (open finding IA-044, logging.interceptor.ts:22): only the HTTP access line carries the link token today', () => {
      expect(linkToken.length).toBeGreaterThanOrEqual(32);
      const leaks = entriesContaining(windows.publicInvoiceLink.entries, [linkToken, encodeURIComponent(linkToken)]);
      // Exactly the one access line LoggingInterceptor writes for this GET, and
      // nothing else: no service, guard or filter logs the token.
      expect(leaks.map((e) => e.channel)).toEqual(['Logger#debug[HTTP]']);
      expect(leaks[0].text).toMatch(new RegExp(`^GET /commerce/public/invoice-link/${linkToken.replace(/[-]/g, '\\-')} 200 \\d+ms \\[`));
    });
  });
});

// ===========================================================================
// 2. The agent gate binds packet branches (D-22)
// ===========================================================================

describe('agent control gate: pkt/* heads are packet PRs (D-22)', () => {
  const GATE = path.join(REPO_ROOT, '.github/workflows/agent-control-gate.yml');

  /** The `case` arm of the scope step that sets required=true. */
  function requiredArm(): string {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    const start = gate.indexOf('- name: Determine whether packet controls apply');
    const end = gate.indexOf('- name: Validate control artifacts');
    expect(start > 0 && end > start, 'the scope step exists').toBe(true);
    const step = gate.slice(start, end);
    const arm = /\n\s+([^\n]+)\)\n\s+echo "required=true" >> "\$GITHUB_OUTPUT"/.exec(step);
    expect(arm, 'the scope step has a required=true arm').not.toBeNull();
    return arm![1].trim();
  }

  /** Bash `case` patterns of the arm, evaluated for one head ref. */
  function matches(arm: string, headRef: string): boolean {
    return arm.split('|').map((p) => p.trim()).some((pattern) => {
      const re = new RegExp(`^${pattern.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return re.test(headRef);
    });
  }

  it('NEGATIVE CONTROL: a pkt/* head triggers the packet controls', () => {
    const arm = requiredArm();
    expect(matches(arm, 'pkt/V1-40-SEC-TRUST-CENSUS-REDACTION'), `required arm: ${arm}`).toBe(true);
  });

  it('impl/* heads still trigger the packet controls, and other heads do not', () => {
    const arm = requiredArm();
    expect(matches(arm, 'impl/kf-meta-control-parser-001')).toBe(true);
    for (const head of ['main', 'claude/elegant-curie-7azpsb', 'dependabot/npm_and_yarn/foo-1.2.3', 'docs/x', 'int/trial-A', 'xpkt/x']) {
      expect(matches(arm, head), head).toBe(false);
    }
  });

  it('the gate still validates the artifacts and requires the #80 grant for every head the scope step admits', () => {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    expect(gate).toMatch(/- name: Validate control artifacts\n\s+if: steps\.scope\.outputs\.required == 'true'\n/);
    expect(gate).toMatch(/- name: Require ChatGPT admission before non-draft merge readiness\n\s+if: steps\.scope\.outputs\.required == 'true' && github\.event\.pull_request\.draft == false\n/);
    expect(gate).toContain('grant="$(node scripts/agent-control/auto-merge-admitted.mjs --grant-only)" || grant_status=$?');
  });

  it('the head ref reaches the scope and validation scripts through env, never interpolated into a run block', () => {
    const gate = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
    // A branch name is attacker-chosen text; `${{ github.head_ref }}` inside run: is script injection.
    const runBlocks = gate.split(/\n\s+run: \|\n/).slice(1).map((b) => b.split(/\n\s{6}- name: /)[0]);
    expect(runBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of runBlocks) expect(block).not.toContain('github.head_ref');
    expect(gate).toMatch(/- name: Determine whether packet controls apply\n[\s\S]*?env:\n\s+HEAD_REF: \$\{\{ github\.head_ref \}\}\n\s+run: \|\n[\s\S]*?case "\$HEAD_REF" in/);
    expect(gate).toMatch(/if \[ "\$declared_branch" != "\$HEAD_REF" \]; then/);
    expect(gate).toMatch(/if \[ "\$return_branch" != "\$HEAD_REF" \]; then/);
  });
});

// ===========================================================================
// 3. Dependabot
// ===========================================================================

describe('dependabot: version updates for the workspace and the workflows', () => {
  const FILE = path.join(REPO_ROOT, '.github/dependabot.yml');

  it('NEGATIVE CONTROL: .github/dependabot.yml exists (version 2)', () => {
    expect(existsSync(FILE), '.github/dependabot.yml').toBe(true);
    expect(readFileSync(FILE, 'utf8')).toMatch(/^version: 2$/m);
  });

  it('it watches the pnpm workspace (npm ecosystem at /) and the GitHub Actions workflows, on a schedule', () => {
    const text = existsSync(FILE) ? readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n') : '';
    const blocks = text.split(/\n\s*- package-ecosystem: /).slice(1);
    const ecosystem = (name: string) => blocks.find((b) => b.replace(/["']/g, '').startsWith(name));
    for (const name of ['npm', 'github-actions']) {
      const block = ecosystem(name);
      expect(block, `${name} entry`).toBeDefined();
      expect(block!).toMatch(/directory: ["']?\/["']?\n/);
      expect(block!).toMatch(/schedule:\n\s+interval: ["']?(daily|weekly|monthly)["']?/);
    }
  });
});

// ===========================================================================
// 4. The Release 0 trust census
// ===========================================================================

describe('Release 0 trust census (RELEASE0-TRUST-CENSUS-001)', () => {
  const FILE = path.join(REPO_ROOT, 'docs/reconstruction/product/evidence/RELEASE0-TRUST-CENSUS-001.md');

  /** The ids of the source matrices: 68 assurance domains and 50 catastrophic-failure scenarios. */
  const IA_IDS = Array.from({ length: 68 }, (_, i) => `IA-${String(i + 1).padStart(3, '0')}`);
  const CF_IDS = Array.from({ length: 50 }, (_, i) => `CF-${String(i + 1).padStart(3, '0')}`);

  const STATES = ['UNASSESSED', 'CHARACTERIZING', 'CHARACTERIZED', 'DESIGNED', 'IMPLEMENTED_NOT_PROVEN', 'PROVEN_AT_DECLARED_SCOPE', 'EXTERNALLY_VERIFIED', 'BLOCKED', 'NOT_APPLICABLE'];
  const DISPOSITIONS = ['PREVENTED', 'DETECTED_AND_CONTAINED', 'RECOVERABLE', 'TRANSFERRED', 'ACCEPTED_RESIDUAL_RISK', 'NOT_APPLICABLE', 'RELEASE_BLOCKING'];
  /** A disposition that claims a working control must stand on a cited test. */
  const CLAIMING = ['PREVENTED', 'DETECTED_AND_CONTAINED', 'RECOVERABLE'];
  const TEST_PATH = /\.(spec|test)\.[cm]?[jt]sx?$/;

  interface Row {
    id: string;
    cells: string[];
  }

  function rows(prefix: 'IA' | 'CF'): Row[] {
    const text = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
    return text
      .split('\n')
      .filter((l) => new RegExp(`^\\| ${prefix}-\\d{3} \\|`).test(l))
      .map((l) => {
        const cells = l.split('|').slice(1, -1).map((c) => c.trim());
        return { id: cells[0], cells };
      });
  }

  /**
   * IA table:  | ID | Tier | Domain | Recorded | R0 touch | Evidence | Proposed state | Disposition |
   * CF table:  | ID | Tier | Scenario | Domains | R0 touch | Evidence | Proposed disposition |
   */
  const IA_COL = { tier: 1, touch: 4, evidence: 5, state: 6, disposition: 7, width: 8 };
  const CF_COL = { tier: 1, touch: 4, evidence: 5, disposition: 6, width: 7 };

  function citedPaths(cell: string): string[] {
    return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  }

  function checkEvidence(row: Row, cell: string): string[] {
    const problems: string[] = [];
    const paths = citedPaths(cell);
    const open = /\bOPEN\b/.test(cell);
    if (!open && paths.length === 0) problems.push(`${row.id}: evidence cites no test path and does not say OPEN`);
    for (const p of paths) {
      if (!TEST_PATH.test(p)) problems.push(`${row.id}: ${p} is not a test path`);
      else if (!existsSync(path.join(REPO_ROOT, p))) problems.push(`${row.id}: ${p} does not exist`);
    }
    return problems;
  }

  it('NEGATIVE CONTROL: the census exists, names its owner of record (D-22) and was not posted by this worker', () => {
    expect(existsSync(FILE), 'RELEASE0-TRUST-CENSUS-001.md').toBe(true);
    const text = readFileSync(FILE, 'utf8');
    expect(text).toMatch(/owner_of_record: owner\b/);
    expect(text).toMatch(/posted: false\b/);
  });

  it('every assurance domain (IA-001..IA-068) and every catastrophic-failure scenario (CF-001..CF-050) has exactly one row', () => {
    expect(rows('IA').map((r) => r.id)).toEqual(IA_IDS);
    expect(rows('CF').map((r) => r.id)).toEqual(CF_IDS);
  });

  it('every IA row cites an existing test path or OPEN, proposes an allowed state, and every T0 row carries a disposition', () => {
    const problems: string[] = [];
    for (const row of rows('IA')) {
      if (row.cells.length !== IA_COL.width) { problems.push(`${row.id}: ${row.cells.length} cells`); continue; }
      const tier = row.cells[IA_COL.tier];
      if (!/^T[0-3]$/.test(tier)) problems.push(`${row.id}: tier ${tier}`);
      if (!/^(yes|no)\b/.test(row.cells[IA_COL.touch])) problems.push(`${row.id}: R0 touch must say yes or no`);
      problems.push(...checkEvidence(row, row.cells[IA_COL.evidence]));
      const state = row.cells[IA_COL.state].replace(/`/g, '');
      if (!STATES.includes(state)) problems.push(`${row.id}: proposed state ${state}`);
      const disposition = row.cells[IA_COL.disposition].replace(/`/g, '');
      if (tier === 'T0' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: T0 disposition ${disposition || '(none)'}`);
      if (disposition && disposition !== '-' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: disposition ${disposition}`);
      if (CLAIMING.includes(disposition) && citedPaths(row.cells[IA_COL.evidence]).length === 0) {
        problems.push(`${row.id}: ${disposition} claimed with no cited test`);
      }
      if (state === 'PROVEN_AT_DECLARED_SCOPE' && citedPaths(row.cells[IA_COL.evidence]).length === 0) {
        problems.push(`${row.id}: PROVEN_AT_DECLARED_SCOPE with no cited test`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every CF row cites an existing test path or OPEN, and every T0 scenario carries a disposition', () => {
    const problems: string[] = [];
    for (const row of rows('CF')) {
      if (row.cells.length !== CF_COL.width) { problems.push(`${row.id}: ${row.cells.length} cells`); continue; }
      const tier = row.cells[CF_COL.tier];
      if (!/^T[0-3]$/.test(tier)) problems.push(`${row.id}: tier ${tier}`);
      if (!/^(yes|no)\b/.test(row.cells[CF_COL.touch])) problems.push(`${row.id}: R0 touch must say yes or no`);
      problems.push(...checkEvidence(row, row.cells[CF_COL.evidence]));
      const disposition = row.cells[CF_COL.disposition].replace(/`/g, '');
      if (tier === 'T0' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: T0 disposition ${disposition || '(none)'}`);
      if (disposition && disposition !== '-' && !DISPOSITIONS.includes(disposition)) problems.push(`${row.id}: disposition ${disposition}`);
      if (CLAIMING.includes(disposition) && citedPaths(row.cells[CF_COL.evidence]).length === 0) {
        problems.push(`${row.id}: ${disposition} claimed with no cited test`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('ACCEPTED_RESIDUAL_RISK is never proposed by the worker: only the owner of record may accept a risk', () => {
    const accepted = [...rows('IA'), ...rows('CF')].filter((r) => r.cells.some((c) => c.replace(/`/g, '') === 'ACCEPTED_RESIDUAL_RISK'));
    expect(accepted.map((r) => r.id)).toEqual([]);
  });

  it('the summary table matches the rows (no drift between the counts and the tables)', () => {
    const text = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
    const summary = (label: string): [number, number] => {
      const line = text.split('\n').find((l) => l.startsWith(`| ${label} |`));
      expect(line, `summary row "${label}"`).toBeDefined();
      const [ia, cf] = line!.split('|').slice(2, 4).map((c) => Number(/^\s*(\d+)/.exec(c)?.[1]));
      return [ia, cf];
    };
    const ia = rows('IA');
    const cf = rows('CF');
    const t0 = (r: Row[]) => r.filter((x) => x.cells[1] === 'T0');
    const disp = (r: Row[], col: number, values: string[]) => r.filter((x) => values.includes(x.cells[col]));
    const openOnly = (r: Row[], col: number) => r.filter((x) => citedPaths(x.cells[col]).length === 0);
    const touched = (r: Row[], col: number) => r.filter((x) => x.cells[col].startsWith('yes'));
    expect(summary('Rows')).toEqual([ia.length, cf.length]);
    expect(summary('T0 rows')).toEqual([t0(ia).length, t0(cf).length]);
    expect(summary('T0 rows proposed PREVENTED or DETECTED_AND_CONTAINED')).toEqual([
      disp(t0(ia), IA_COL.disposition, ['PREVENTED', 'DETECTED_AND_CONTAINED']).length,
      disp(t0(cf), CF_COL.disposition, ['PREVENTED', 'DETECTED_AND_CONTAINED']).length,
    ]);
    expect(summary('T0 rows proposed NOT_APPLICABLE')).toEqual([
      disp(t0(ia), IA_COL.disposition, ['NOT_APPLICABLE']).length,
      disp(t0(cf), CF_COL.disposition, ['NOT_APPLICABLE']).length,
    ]);
    expect(summary('T0 rows RELEASE_BLOCKING')).toEqual([
      disp(t0(ia), IA_COL.disposition, ['RELEASE_BLOCKING']).length,
      disp(t0(cf), CF_COL.disposition, ['RELEASE_BLOCKING']).length,
    ]);
    expect(summary('Rows touched by Release 0 (`yes`)')).toEqual([touched(ia, IA_COL.touch).length, touched(cf, CF_COL.touch).length]);
    expect(summary('Rows whose evidence is OPEN only')).toEqual([openOnly(ia, IA_COL.evidence).length, openOnly(cf, CF_COL.evidence).length]);
  });

  it('IA-044 (log redaction) cites this negative control', () => {
    const row = rows('IA').find((r) => r.id === 'IA-044');
    expect(row?.cells[IA_COL.evidence] ?? '').toContain('`apps/server/test/log-redaction.integration.test.ts`');
  });
});
