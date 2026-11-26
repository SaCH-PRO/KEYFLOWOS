/**
 * FU-KEY-INVOICE-EMAIL-PAY-LINK (P1 launch-track, M; D-248, D-134; prefix `v91c_`):
 * KEY does not email an invoice without its pay button on a transient pay-link
 * conflict, and never sends it twice (REAL Postgres, REAL CommerceService, REAL
 * CommerceController, REAL FlowOrchestratorService, REAL ActionDispatcherService,
 * REAL AiExecutionLogService, REAL DelegationLoopService, REAL FlowListener).
 *
 * Before this packet:
 *   - CommerceService.reissueLink threw a plain ConflictException when a
 *     PENDING_SEND_EXPIRY pay link was withdrawn by a concurrent failed
 *     sendWithPublicInvoiceUrl right before reissueLink claimed it.
 *   - FlowOrchestratorService.customerInvoiceUrl swallowed EVERY error from
 *     CommerceService.automatedInvoiceUrl and returned undefined, so
 *     commerce_send_invoice sent a button-less email, moved the invoice to SENT,
 *     and reported success.
 *   - DelegationLoopService.customerInvoiceUrl swallowed the same transient
 *     conflict, sent a button-less payment recovery email, and marked the
 *     autopilotTask AUTO_EXECUTED.
 *   - FlowListener.customerInvoiceUrl swallowed the same transient conflict,
 *     sending button-less due-soon, overdue, and payment-failed reminders.
 *
 * Contract pinned here:
 *   PLK-01  Transient pay-link 409 conflict on attempt 1 that clears on attempt 2:
 *           ActionDispatcherService retries commerce_send_invoice under its bounded
 *           policy, sends EXACTLY 1 email carrying `/public/invoice/<token>`, flips
 *           the invoice to SENT once, and an idempotent replay sends 0 more emails.
 *   PLK-02  Persistent pay-link 409 conflict across all bounded retries:
 *           ActionDispatcherService exhausts its retries (3 attempts for retryCount=2)
 *           and fails cleanly with 0 emails sent, invoice still DRAFT, no OUTCOME_UNKNOWN
 *           prefix, and 1 circuit failure counted toward bizA only.
 *   PLK-03  Real non-retryable refusals keep today's exact behaviour (NOT blindly retried):
 *           (a) non-payable invoice statuses (PENDING, FAILED, FULLY_CREDITED) -> plain
 *               409 refusal, 1 attempt, 0 emails, 0 circuit failures;
 *           (b) VOID invoice -> 1 attempt, 0 emails;
 *           (c) email delivery FAILED (e.g. unconfigured Gmail / DNC) -> 1 attempt,
 *               not flipped to SENT;
 *           (d) all links revoked (SEC-V46B-1/2) -> automatedInvoiceUrl returns null,
 *               1 attempt, 1 email with invoiceUrl undefined, no new link minted.
 *   PLK-04  REST route POST /commerce/businesses/:b/invoices/:id/payment-link keeps
 *           its exact HTTP 409 status and response body on the transient withdrawal,
 *           while throwing RetryableConflictException (a ConflictException subclass).
 *   PLK-05  Cross-tenant isolation: bizB dispatching commerce_send_invoice for bizA's
 *           invoice fails on 1 attempt with 0 emails and leaves bizA's invoice, link,
 *           and circuit untouched; bizA's circuit failures never block bizB.
 *   PLK-06  Other automated callers:
 *           (a) DelegationLoopService.runPaymentRecovery defers on RetryableConflictException
 *               (0 button-less emails, task stays PENDING, autoExecuted: false) and sends
 *               1 email WITH the pay link on the next sweep resuming the same task;
 *           (b) FlowListener.handleInvoiceDueSoonReminders skips only the conflicted invoice
 *               (0 button-less emails, rest of batch still emailed) and sends 1 email WITH
 *               the pay link on the next sweep;
 *           (c) FlowListener one-shot @OnEvent listeners (handleInvoiceOverdue and
 *               handlePaymentFailedCustomerNotif) retry once on RetryableConflictException
 *               and send 1 email WITH the pay link.
 *
 * Fixtures: prefix `v91c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConflictException, Logger } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91c_';
const HEADER = 'x-v91c-user';
const PENDING_SEND_EXPIRY = new Date('9999-12-31T23:59:59.999Z');
const WITHDRAWN_MSG = 'The pay link was withdrawn while it was being handed out; try again.';
const CLOSED = { open: false, failures: 0, lastFailure: null };

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  contactA: `${P}contact_a`,
  contactB: `${P}contact_b`,
};

const EMAIL_A = `${P}customer_a@test.local`;
const EMAIL_B = `${P}customer_b@test.local`;

let db: any;
let app: any;
let prisma: any;
let commerce: any;
let appUrlFn: () => string;
let RetryableConflictExceptionRef: any;
let FlowOrchestratorRef: any;
let ActionDispatcherRef: any;
let AiExecutionLogRef: any;
let DelegationLoopRef: any;
let FlowListenerRef: any;
let redis: any;

/**
 * Controls the real Postgres withdrawal race inside CommerceService.reissueLink:
 * while `remaining > 0`, right before reissueLink's conditional updateMany clears
 * PENDING_SEND_EXPIRY on `invoiceId`'s pending link, this proxy deletes that row
 * in Postgres (the exact withdrawal sendWithPublicInvoiceUrl performs when its
 * concurrent provider send fails).
 */
const race = {
  remaining: 0,
  invoiceId: '',
  withdrawnCount: 0,
};

/** Execution log writes executeTool leaves unawaited (drained before cleanup). */
const pendingLogWrites: Array<Promise<unknown>> = [];

const quietLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

let seq = 0;

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM customer_notification_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

async function seedInvoice(
  biz: string,
  contact: string,
  status: string,
  opts: { dueDate?: Date } = {},
) {
  seq += 1;
  const id = `${P}inv_${biz === ID.bizA ? 'a' : 'b'}_${status.toLowerCase()}_${seq}`;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V91C-${seq}`,
      status,
      subtotal: 250,
      total: 250,
      currency: 'TTD',
      businessId: biz,
      contactId: contact,
      dueDate: opts.dueDate ?? new Date(Date.now() + 7 * 86_400_000),
      ...(status === 'DRAFT' ? {} : { sentAt: new Date() }),
      items: { create: [{ description: 'V91C item', quantity: 1, unitPrice: 250, total: 250 }] },
    },
  });
  return id;
}

async function seedPendingLink(invoiceId: string, businessId: string) {
  seq += 1;
  return db.paymentLink.create({
    data: {
      id: `${P}plink_${seq}`,
      invoiceId,
      businessId,
      token: `${P}pending_tok_${seq}_${Date.now()}`,
      active: true,
      expiresAt: PENDING_SEND_EXPIRY,
    },
  });
}

async function linksOf(invoiceId: string) {
  return db.paymentLink.findMany({
    where: { invoiceId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Builds a real FlowOrchestratorService + real ActionDispatcherService harness
 * wired to the real Postgres-backed racing CommerceService and AiExecutionLogService.
 * Only TransactionalEmailService.send (records emails; zero provider traffic),
 * ActivityLogService, governance (allows), and retry spacing ([0, 0]) are stand-ins.
 */
function makeKeyDispatchHarness(opts: {
  deliveryStatus?: 'SENT' | 'QUEUED' | 'FAILED';
  beforeAttempt?: (attempt: number) => Promise<void>;
} = {}) {
  const deliveryStatus = opts.deliveryStatus ?? 'SENT';
  const sentEmails: Array<Record<string, any>> = [];
  const activities: Array<Record<string, any>> = [];
  const deliveredErrors: unknown[] = [];
  let attemptCount = 0;

  const realFlowLog = new AiExecutionLogRef(prisma);
  const flowExecutionLog = {
    logToolExecution: (...a: unknown[]) => {
      const p = (realFlowLog.logToolExecution as any)(...a);
      pendingLogWrites.push(Promise.resolve(p).catch(() => undefined));
      return p;
    },
  };

  const flow = Object.create(FlowOrchestratorRef.prototype);
  Object.assign(flow, {
    prisma,
    logger: new Logger('v91c-flow'),
    governance: { getToolTier: () => 1 },
    executionLog: flowExecutionLog,
    businessGraph: { invalidateCache: () => undefined },
    getCommerce: () => commerce,
    getTransactionalEmail: () => ({
      send: async (payload: Record<string, any>) => {
        sentEmails.push(payload);
        return { status: deliveryStatus, messageId: `${P}mail_${sentEmails.length}` };
      },
    }),
    getActivityLog: () => ({
      createActivity: async (payload: Record<string, any>) => {
        activities.push(payload);
        return { id: `${P}act_${activities.length}` };
      },
    }),
  });

  const realExecuteToolDirectly = FlowOrchestratorRef.prototype.executeToolDirectly;
  const flowAsProduction = {
    executeToolDirectly: async (
      businessId: string,
      toolName: string,
      args: Record<string, unknown>,
      planContext?: { planId: string; planStepId: string },
      action?: any,
    ) => {
      attemptCount += 1;
      if (opts.beforeAttempt) await opts.beforeAttempt(attemptCount);
      try {
        return await realExecuteToolDirectly.call(flow, businessId, toolName, args, planContext, action);
      } catch (err) {
        deliveredErrors.push(err);
        throw err;
      }
    },
  };

  const events = { emit: () => true };
  const ALLOW = {
    allowed: true,
    tier: 1,
    reason: 'v91c: allowed',
    requiresFormalApproval: false,
    requiresAdminApproval: false,
    requiresQuickConfirm: false,
  };
  const governance = { evaluate: async () => ({ ...ALLOW }) };
  const executionLog = new AiExecutionLogRef(prisma);

  const dispatcher = new ActionDispatcherRef(
    prisma,
    events as any,
    executionLog,
    governance as any,
    flowAsProduction as any,
    { registerAction: async () => undefined } as any,
  );
  const internals = dispatcher as unknown as { logger: unknown; RETRY_DELAYS: number[] };
  internals.logger = quietLogger;
  internals.RETRY_DELAYS = [0, 0];

  return {
    dispatcher,
    sentEmails,
    activities,
    deliveredErrors,
    attempts: () => attemptCount,
  };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
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
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  ({ appUrl: appUrlFn } = await import('../src/core/config/runtime-urls'));
  ({ RetryableConflictException: RetryableConflictExceptionRef } = await import('../src/core/utils/retryable-conflict'));
  ({ FlowOrchestratorService: FlowOrchestratorRef } = await import('../src/modules/ai/flow-orchestrator.service'));
  ({ ActionDispatcherService: ActionDispatcherRef } = await import('../src/modules/ai/action-dispatcher.service'));
  ({ AiExecutionLogService: AiExecutionLogRef } = await import('../src/modules/ai/ai-execution-log.service'));
  ({ DelegationLoopService: DelegationLoopRef } = await import('../src/modules/autopilot/delegation-loop.service'));
  ({ FlowListener: FlowListenerRef } = await import('../src/modules/flow/flow.listener'));

  prisma = new PrismaService();

  // Wrap PrismaService.client.paymentLink.updateMany so we can deterministically
  // land the real Postgres pending-link withdrawal race right inside reissueLink.
  const racingClient = new Proxy(prisma.client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'paymentLink') return value;
      return new Proxy(value, {
        get(plTarget, plProp, plReceiver) {
          if (plProp !== 'updateMany') return Reflect.get(plTarget, plProp, plReceiver);
          return async (args: any) => {
            const exp = args?.where?.expiresAt;
            const linkId = args?.where?.id;
            if (
              race.remaining > 0 &&
              typeof linkId === 'string' &&
              exp instanceof Date &&
              exp.getTime() === PENDING_SEND_EXPIRY.getTime()
            ) {
              const row = await db.paymentLink.findUnique({
                where: { id: linkId },
                select: { invoiceId: true },
              });
              if (row && (!race.invoiceId || row.invoiceId === race.invoiceId)) {
                race.remaining -= 1;
                race.withdrawnCount += 1;
                await db.$executeRawUnsafe(`DELETE FROM payment_links WHERE id = $1`, linkId);
              }
            }
            return plTarget.updateMany(args);
          };
        },
      });
    },
  });
  const racingPrisma = Object.create(prisma, { client: { get: () => racingClient } });

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  const eventStub = {
    emit: () => true,
    emitAsync: async () => [],
    on: () => undefined,
    off: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      { provide: PrismaService, useValue: racingPrisma },
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
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { attachVisitorToContact: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: { sendEmail: async () => ({ messageId: `${P}gmail_1` }) } },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
    ],
  }).compile();

  commerce = moduleRef.get(CommerceService);

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: any) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.length > 0) {
      req.user = { id: uid, email: `${P}req_${uid}@test.local`, role: 'USER' };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalInterceptors(new TenantInterceptor());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();

  await cleanup();
  await db.user.create({ data: { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V91C Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V91C Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({
    data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Ada', lastName: 'Lovelace', email: EMAIL_A },
  });
  await db.contact.create({
    data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Grace', lastName: 'Hopper', email: EMAIL_B },
  });
}, 180_000);

beforeEach(() => {
  race.remaining = 0;
  race.invoiceId = '';
  race.withdrawnCount = 0;
});

afterAll(async () => {
  await Promise.allSettled(pendingLogWrites);
  if (app) await app.close();
  if (redis) await redis.quit().catch(() => undefined);
  if (db) {
    await cleanup();
    const left = await db.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
              (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users,
              (SELECT count(*) FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS invoices,
              (SELECT count(*) FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS payment_links,
              (SELECT count(*) FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS autopilot_tasks,
              (SELECT count(*) FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS logs,
              (SELECT count(*) FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS idem`,
    );
    expect(left).toEqual([
      { businesses: 0, users: 0, invoices: 0, payment_links: 0, autopilot_tasks: 0, logs: 0, idem: 0 },
    ]);
  }
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('FU-KEY-INVOICE-EMAIL-PAY-LINK (D-248, D-134): KEY commerce_send_invoice on transient pay-link conflict', () => {
  it('PLK-01: transient pay-link 409 on attempt 1 clears on attempt 2 -> retries automatically, sends EXACTLY 1 email WITH the pay link, and idempotent replay sends 0 more', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
    await seedPendingLink(inv, ID.bizA);
    race.remaining = 1;
    race.invoiceId = inv;

    const h = makeKeyDispatchHarness();
    const idempotencyKey = `${P}idem_plk01`;

    const res = await h.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: 'commerce_send_invoice',
      args: { invoiceId: inv },
      idempotencyKey,
      retryCount: 2,
    });

    expect(race.withdrawnCount, 'the real reissueLink withdrawal race fired on attempt 1').toBe(1);
    expect(h.attempts(), 'attempt 1 hit RetryableConflictException, attempt 2 succeeded').toBe(2);
    expect(res.success).toBe(true);
    expect(h.deliveredErrors).toHaveLength(1);
    expect((h.deliveredErrors[0] as Error).cause).toBeInstanceOf(RetryableConflictExceptionRef);

    // Exactly 1 email left, carrying the freshly minted live pay link.
    expect(h.sentEmails).toHaveLength(1);
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(links[0].active).toBe(true);
    expect(links[0].expiresAt).toBeNull();
    expect(h.sentEmails[0].type).toBe('invoice_sent');
    expect(h.sentEmails[0].recipientEmail).toBe(EMAIL_A);
    expect(h.sentEmails[0].templateData.invoiceUrl).toBe(`${appUrlFn()}/public/invoice/${links[0].token}`);

    // Invoice moved to SENT once, activity logged once, circuit stayed clean.
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('SENT');
    expect(h.activities).toHaveLength(1);
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizA)).toEqual(CLOSED);

    // Re-dispatch with the same idempotencyKey: 0 additional attempts, 0 additional emails.
    const replay = await h.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: 'commerce_send_invoice',
      args: { invoiceId: inv },
      idempotencyKey,
      retryCount: 2,
    });
    expect(replay.success).toBe(true);
    expect(h.attempts()).toBe(2);
    expect(h.sentEmails).toHaveLength(1);
  });

  it('PLK-02: persistent pay-link 409 across all bounded retries fails cleanly after last attempt with 0 emails sent and invoice unchanged', async () => {
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
    race.remaining = 5;
    race.invoiceId = inv;

    const h = makeKeyDispatchHarness({
      beforeAttempt: async () => {
        // Ensure a fresh PENDING_SEND_EXPIRY link exists before every attempt so
        // every attempt hits the real Postgres withdrawal race in reissueLink.
        const current = await linksOf(inv);
        if (current.length === 0) await seedPendingLink(inv, ID.bizA);
      },
    });

    const res = await h.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: 'commerce_send_invoice',
      args: { invoiceId: inv },
      idempotencyKey: `${P}idem_plk02`,
      retryCount: 2,
    });

    expect(race.withdrawnCount).toBe(3);
    expect(h.attempts(), 'tried 1 initial + 2 retries = 3 bounded attempts').toBe(3);
    expect(res.success).toBe(false);
    expect(res.error).toBe(WITHDRAWN_MSG);
    expect(res.error).not.toContain('OUTCOME_UNKNOWN');

    // ZERO emails sent, ZERO activities, invoice still DRAFT.
    expect(h.sentEmails).toEqual([]);
    expect(h.activities).toEqual([]);
    expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('DRAFT');

    // Circuit counted 1 failure for bizA only; bizB is untouched.
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizA)).toMatchObject({
      open: false,
      failures: 1,
    });
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizB)).toEqual(CLOSED);
  });

  it('PLK-03: real non-retryable refusals & intentional revoked-link null keep today\'s exact behaviour (NOT blindly retried)', async () => {
    // (a) Non-payable statuses (PENDING, FAILED, FULLY_CREDITED): plain 409 refusal, 1 attempt, 0 emails, 0 circuit failures.
    for (const status of ['PENDING', 'FAILED', 'FULLY_CREDITED'] as const) {
      const inv = await seedInvoice(ID.bizA, ID.contactA, status);
      const h = makeKeyDispatchHarness();
      const res = await h.dispatcher.dispatch({
        businessId: ID.bizA,
        toolName: 'commerce_send_invoice',
        args: { invoiceId: inv },
        retryCount: 2,
      });

      expect(h.attempts(), `${status}: refused on 1st attempt, not retried`).toBe(1);
      expect(res.success, status).toBe(false);
      expect(res.error, status).toContain(`this invoice is ${status}`);
      expect(h.sentEmails, status).toEqual([]);
      expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizA), status).toEqual(CLOSED);
    }

    // (b) VOID invoice: refused on 1st attempt, 0 emails.
    {
      const invVoid = await seedInvoice(ID.bizA, ID.contactA, 'VOID');
      const h = makeKeyDispatchHarness();
      const res = await h.dispatcher.dispatch({
        businessId: ID.bizA,
        toolName: 'commerce_send_invoice',
        args: { invoiceId: invVoid },
        retryCount: 2,
      });
      expect(h.attempts()).toBe(1);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Cannot email a voided invoice');
      expect(h.sentEmails).toEqual([]);
    }

    // (c) Email provider / delivery refusal (status: 'FAILED', e.g. Gmail not connected or DNC):
    // NOT blindly retried (1 attempt), invoice stays DRAFT, no activity logged.
    {
      const invFail = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
      const h = makeKeyDispatchHarness({ deliveryStatus: 'FAILED' });
      const res = await h.dispatcher.dispatch({
        businessId: ID.bizA,
        toolName: 'commerce_send_invoice',
        args: { invoiceId: invFail },
        retryCount: 2,
      });
      expect(h.attempts()).toBe(1);
      expect(res.success).toBe(false);
      expect(res.error).toContain('was NOT emailed');
      expect((await db.invoice.findUnique({ where: { id: invFail } })).status).toBe('DRAFT');
      expect(h.activities).toEqual([]);
    }

    // (d) All payment links revoked (SEC-V46B-1/2): automatedInvoiceUrl intentionally returns null,
    // email goes out once without a pay button, no new link is minted, 1 attempt.
    {
      const invRevoked = await seedInvoice(ID.bizA, ID.contactA, 'SENT');
      const revokedLink = await db.paymentLink.create({
        data: {
          id: `${P}revoked_link_1`,
          invoiceId: invRevoked,
          businessId: ID.bizA,
          token: `${P}revoked_tok_1`,
          active: false,
        },
      });
      const h = makeKeyDispatchHarness();
      const res = await h.dispatcher.dispatch({
        businessId: ID.bizA,
        toolName: 'commerce_send_invoice',
        args: { invoiceId: invRevoked },
        retryCount: 2,
      });
      expect(h.attempts()).toBe(1);
      expect(res.success).toBe(true);
      expect(h.sentEmails).toHaveLength(1);
      expect(h.sentEmails[0].templateData.invoiceUrl).toBeUndefined();
      expect((await linksOf(invRevoked)).map((l: any) => l.id)).toEqual([revokedLink.id]);
    }
  });

  it('PLK-04: REST route POST payment-link keeps exact HTTP 409 status/body while CommerceService throws RetryableConflictException', async () => {
    const invHttp = await seedInvoice(ID.bizA, ID.contactA, 'SENT');
    await seedPendingLink(invHttp, ID.bizA);
    race.remaining = 1;
    race.invoiceId = invHttp;

    const httpRes = await request(app.getHttpServer())
      .post(`/commerce/businesses/${ID.bizA}/invoices/${invHttp}/payment-link`)
      .set(HEADER, ID.ownerA)
      .send({});

    expect(race.withdrawnCount).toBe(1);
    expect(httpRes.status, JSON.stringify(httpRes.body)).toBe(409);
    expect(httpRes.body.message).toBe(WITHDRAWN_MSG);

    // Direct service verification: the thrown error is RetryableConflictException AND ConflictException.
    const invDirect = await seedInvoice(ID.bizA, ID.contactA, 'SENT');
    await seedPendingLink(invDirect, ID.bizA);
    race.remaining = 1;
    race.invoiceId = invDirect;
    race.withdrawnCount = 0;

    const thrown = await commerce.createPaymentLink(invDirect, ID.bizA).then(
      () => null,
      (e: unknown) => e,
    );
    expect(race.withdrawnCount).toBe(1);
    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown).toBeInstanceOf(RetryableConflictExceptionRef);
    expect((thrown as Error).message).toBe(WITHDRAWN_MSG);
  });

  it('PLK-05: cross-tenant isolation: bizB cannot touch bizA invoice/link/circuit, and bizA conflicts do not affect bizB', async () => {
    const invA = await seedInvoice(ID.bizA, ID.contactA, 'DRAFT');
    const pendingA = await seedPendingLink(invA, ID.bizA);
    const invB = await seedInvoice(ID.bizB, ID.contactB, 'DRAFT');

    const h = makeKeyDispatchHarness({
      beforeAttempt: async () => {
        if (race.invoiceId === invA) {
          const cur = await linksOf(invA);
          if (cur.length === 0) await seedPendingLink(invA, ID.bizA);
        }
      },
    });

    // bizB tries to dispatch commerce_send_invoice naming bizA's invoice: 1 attempt, 0 emails, bizA untouched.
    const foreign = await h.dispatcher.dispatch({
      businessId: ID.bizB,
      toolName: 'commerce_send_invoice',
      args: { invoiceId: invA },
      retryCount: 2,
    });
    expect(foreign.success).toBe(false);
    expect(foreign.error).toContain('Invoice not found');
    expect(h.attempts()).toBe(1);
    expect(h.sentEmails).toEqual([]);
    expect((await db.invoice.findUnique({ where: { id: invA } })).status).toBe('DRAFT');
    expect((await linksOf(invA)).map((l: any) => l.id)).toEqual([pendingA.id]);
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizA)).toEqual(CLOSED);

    // bizA suffers persistent conflict failures; bizB's own send still succeeds with bizB's own pay link.
    race.remaining = 5;
    race.invoiceId = invA;
    const failedA = await h.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: 'commerce_send_invoice',
      args: { invoiceId: invA },
      retryCount: 2,
    });
    expect(failedA.success).toBe(false);
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizA)).toMatchObject({ failures: 1 });
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizB)).toEqual(CLOSED);

    race.remaining = 0;
    race.invoiceId = '';
    const okB = await h.dispatcher.dispatch({
      businessId: ID.bizB,
      toolName: 'commerce_send_invoice',
      args: { invoiceId: invB },
      retryCount: 2,
    });
    expect(okB.success).toBe(true);
    expect(h.sentEmails).toHaveLength(1);
    expect(h.sentEmails[0].recipientEmail).toBe(EMAIL_B);
    const linksB = await linksOf(invB);
    expect(linksB).toHaveLength(1);
    expect(h.sentEmails[0].templateData.invoiceUrl).toBe(`${appUrlFn()}/public/invoice/${linksB[0].token}`);
    expect(h.dispatcher.getCircuitStatus('commerce_send_invoice', ID.bizB)).toEqual(CLOSED);
  });
});

describe('FU-KEY-INVOICE-EMAIL-PAY-LINK (D-248): other automated callers of automatedInvoiceUrl', () => {
  it('PLK-06a: DelegationLoopService.runPaymentRecovery defers on RetryableConflictException (0 button-less emails, task stays PENDING) and sends 1 email WITH pay link on next sweep', async () => {
    const dueDate = new Date(Date.now() - 10 * 86_400_000);
    const inv = await seedInvoice(ID.bizA, ID.contactA, 'OVERDUE', { dueDate });
    await seedPendingLink(inv, ID.bizA);
    race.remaining = 1;
    race.invoiceId = inv;

    const emails: Array<Record<string, any>> = [];
    const loop = Object.assign(Object.create(DelegationLoopRef.prototype), {
      prisma,
      timeline: { logEvent: async () => undefined },
      events: { emit: () => true },
      emailService: {
        send: async (payload: Record<string, any>) => {
          emails.push(payload);
          return { status: 'SENT' };
        },
      },
      logger: quietLogger,
      contactWindow: async () => ({ allowed: true }),
      getCommerce: () => commerce,
    });

    // Sweep 1: hits transient withdrawal -> NO button-less email, task stays PENDING, autoExecuted: false.
    const scan1 = { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, actionsBlocked: 0, results: [] as any[] };
    await loop.runPaymentRecovery(ID.bizA, {}, scan1, false);

    expect(race.withdrawnCount).toBe(1);
    expect(emails).toEqual([]);
    const tasksAfter1 = await db.autopilotTask.findMany({
      where: { businessId: ID.bizA, relatedId: inv, category: 'PAYMENT_RECOVERY' },
    });
    expect(tasksAfter1).toHaveLength(1);
    expect(tasksAfter1[0].status).toBe('PENDING');
    expect(scan1.results.find((r) => r.invoiceId === inv)?.autoExecuted).toBe(false);

    // Sweep 2: conflict cleared -> resumes the SAME task, sends 1 email WITH the pay link, marks AUTO_EXECUTED.
    const scan2 = { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, actionsBlocked: 0, results: [] as any[] };
    await loop.runPaymentRecovery(ID.bizA, {}, scan2, false);

    expect(emails).toHaveLength(1);
    const links = await linksOf(inv);
    expect(links).toHaveLength(1);
    expect(emails[0].templateData.invoiceUrl).toBe(`${appUrlFn()}/public/invoice/${links[0].token}`);
    const tasksAfter2 = await db.autopilotTask.findMany({
      where: { businessId: ID.bizA, relatedId: inv, category: 'PAYMENT_RECOVERY' },
    });
    expect(tasksAfter2).toHaveLength(1);
    expect(tasksAfter2[0].id).toBe(tasksAfter1[0].id);
    expect(tasksAfter2[0].status).toBe('AUTO_EXECUTED');
    expect(scan2.results.find((r) => r.invoiceId === inv)?.autoExecuted).toBe(true);
  });

  it('PLK-06b: FlowListener.handleInvoiceDueSoonReminders skips only the conflicted invoice (0 button-less emails, rest of batch still sent) and emails it WITH pay link on next sweep', async () => {
    const dueIn24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const invRace = await seedInvoice(ID.bizA, ID.contactA, 'SENT', { dueDate: dueIn24h });
    const invClean = await seedInvoice(ID.bizA, ID.contactA, 'SENT', { dueDate: dueIn24h });
    await seedPendingLink(invRace, ID.bizA);
    race.remaining = 1;
    race.invoiceId = invRace;

    const sent: Array<Record<string, any>> = [];
    const scopedInvoices = [invRace, invClean];
    const listener = Object.assign(Object.create(FlowListenerRef.prototype), {
      prisma: {
        client: {
          invoice: {
            findMany: async () =>
              db.invoice.findMany({
                where: { id: { in: scopedInvoices } },
                include: {
                  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
                  items: { select: { description: true, quantity: true, unitPrice: true, total: true } },
                },
                orderBy: { id: 'asc' },
              }),
          },
          customerNotificationLog: prisma.client.customerNotificationLog,
        },
      },
      transactionalEmail: {
        send: async (payload: Record<string, any>) => {
          sent.push(payload);
          if (payload.dedupeKey) {
            await db.customerNotificationLog.create({
              data: {
                id: `${P}cnl_${sent.length}`,
                businessId: payload.businessId,
                type: payload.type,
                recipientEmail: payload.recipientEmail,
                subject: `Invoice due soon (${payload.dedupeKey})`,
                status: 'SENT',
                messageId: payload.dedupeKey,
              },
            });
          }
          return { status: 'SENT' };
        },
      },
      commerce,
      logger: quietLogger,
    });

    // Sweep 1: invRace deferred (0 emails), invClean STILL sent with its pay link.
    await listener.handleInvoiceDueSoonReminders();
    expect(race.withdrawnCount).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].dedupeKey).toBe(`due-soon_${invClean}`);
    const cleanLinks = await linksOf(invClean);
    expect(cleanLinks).toHaveLength(1);
    expect(sent[0].templateData.invoiceUrl).toBe(`${appUrlFn()}/public/invoice/${cleanLinks[0].token}`);

    // Sweep 2: invRace now sent with its pay link; invClean NOT sent a second time.
    await listener.handleInvoiceDueSoonReminders();
    expect(sent).toHaveLength(2);
    expect(sent[1].dedupeKey).toBe(`due-soon_${invRace}`);
    const raceLinks = await linksOf(invRace);
    expect(raceLinks).toHaveLength(1);
    expect(sent[1].templateData.invoiceUrl).toBe(`${appUrlFn()}/public/invoice/${raceLinks[0].token}`);
  });

  it('PLK-06c: FlowListener one-shot @OnEvent listeners (overdue, payment_failed) retry once on RetryableConflictException and send 1 email WITH pay link', async () => {
    const invOverdue = await seedInvoice(ID.bizA, ID.contactA, 'OVERDUE');
    await seedPendingLink(invOverdue, ID.bizA);
    const invFailed = await seedInvoice(ID.bizA, ID.contactA, 'SENT');
    await seedPendingLink(invFailed, ID.bizA);

    const sent: Array<Record<string, any>> = [];
    const listener = Object.assign(Object.create(FlowListenerRef.prototype), {
      prisma: {
        client: {
          notification: { create: async () => ({}) },
          invoice: prisma.client.invoice,
        },
      },
      transactionalEmail: {
        send: async (payload: Record<string, any>) => {
          sent.push(payload);
          return { status: 'SENT' };
        },
      },
      commerce,
      logger: quietLogger,
    });

    // Overdue event: hits withdrawal race once -> retries once -> sends 1 email WITH pay link.
    race.remaining = 1;
    race.invoiceId = invOverdue;
    await listener.handleInvoiceOverdue({
      businessId: ID.bizA,
      invoice: {
        id: invOverdue,
        invoiceNumber: 'V91C-OVERDUE',
        total: 250,
        currency: 'TTD',
        dueDate: new Date(Date.now() - 5 * 86_400_000),
        contact: { id: ID.contactA, firstName: 'Ada', lastName: 'Lovelace', email: EMAIL_A },
      },
    });
    expect(race.withdrawnCount).toBe(1);
    expect(sent).toHaveLength(1);
    const overdueLinks = await linksOf(invOverdue);
    expect(overdueLinks).toHaveLength(1);
    expect(sent[0].type).toBe('invoice_overdue');
    expect(sent[0].templateData.invoiceUrl).toBe(`${appUrlFn()}/public/invoice/${overdueLinks[0].token}`);

    // Payment-failed event: hits withdrawal race once -> retries once -> sends 1 email WITH retryUrl.
    race.remaining = 1;
    race.invoiceId = invFailed;
    race.withdrawnCount = 0;
    await listener.handlePaymentFailedCustomerNotif({
      businessId: ID.bizA,
      invoiceId: invFailed,
      amount: 250,
      currency: 'TTD',
      error: 'card_declined',
    });
    expect(race.withdrawnCount).toBe(1);
    expect(sent).toHaveLength(2);
    const failedLinks = await linksOf(invFailed);
    expect(failedLinks).toHaveLength(1);
    expect(sent[1].type).toBe('payment_failed');
    expect(sent[1].templateData.retryUrl).toBe(`${appUrlFn()}/public/invoice/${failedLinks[0].token}`);
  });
});
