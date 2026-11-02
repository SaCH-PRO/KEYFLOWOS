/**
 * R0-19-EVIDENCE-BASELINE — issue #186 step 4 audit trail: the manual payment
 * is audited as a payment, on a REAL database, through the REAL
 * BusinessEvent pipeline (interceptor -> ResilientEmitterService -> BullMQ
 * queue on Redis -> worker -> BusinessEventService -> business_events).
 *
 * M16 / M49 (docs/reconstruction/BUILD-MAP-001.md): inferEventMeta had no
 * 'payments' entry, so POST .../invoices/:invoiceId/payments walked back to
 * 'invoices' and the audit row said `invoice.create`, subject = the invoice.
 *
 * Contract pinned here, for a partial (100 of 250 -> PARTIALLY_PAID) and a full
 * (the remaining 150 -> PAID) manual payment recorded by the owner:
 *
 *   Payment.recordedBy = the owner                                     (R0-11, fresh Prisma read)
 *   one ContactEvent invoice.payment_recorded with actorId = the owner (per payment)
 *   one BusinessEvent payment.record, subjectType 'payment', subjectId = Payment.id,
 *     actorType human, actorId = the owner                            (per payment)
 *   no invoice.create row, and no audit row whose subject is the invoice
 *   one FinancialTransaction Payment:<id>:payment_recorded (per payment)
 *   LEDGER: the audit write adds no FinancialTransaction or LedgerEntry: the
 *     business holds exactly the two payment postings and their entries
 *   tenant control: GET /timeline/businesses/B/events (owner B) returns B's rows
 *     and none of A's; owner B on A's timeline is refused; B's payment audit row
 *     is B's
 *   R0-19 review (R19-ST-1): an R0-D2 idempotent replay (same reference + amount)
 *     answers 201 with the recorded Payment and writes nothing, the audit row
 *     included: by the owner (EF-08) or by an ADMIN re-submitting the owner's
 *     slip (EF-09), the payment keeps exactly one payment.record row, actorId =
 *     the owner, agreeing with Payment.recordedBy and the ContactEvent
 *
 * V1-25-EVT-BUSINESS-FEED (M49; D-08: Activity rows power the user feed), the
 * read the cockpit's business feed makes, GET /timeline/businesses/:id/events:
 *   EF-10a CONTROL  the harness gives queryEvents the parameter types tsc emits
 *     ([String, QueryTimelineDto]), so the ValidationPipe applies the DTO here as
 *     it does in the built server (esbuild emits none, and without them no query
 *     was validated at all)
 *   EF-10  the page size is bounded: limit 10000, 201, 0, -1, 2.5 and 'abc' answer
 *     400 with no row
 *   EF-10b limit 200, 50 and 1 are read as numbers and answer at most that many
 *     rows; minRevenueImpact is read as a number too
 *   EF-11  after the partial and the final payment, A's feed (as the cockpit
 *     reads it, limit 50) holds one FINANCE payment_recorded row per payment
 *     with its amount and currency, and the commerce paid row with the invoice
 *     total. The paid row's writer is ActivityEventListener.onInvoicePaid, which
 *     the full app's EventEmitter drives from invoice.paid; this harness's bus is
 *     a recorder, so the one invoice.paid payload it recorded for A (EF-02) is
 *     delivered to the real listener (real ActivityService, real rows) here
 *   EF-12 LEDGER  each feed amount equals its Payment row and its posting (and
 *     the posting's balanced entries), in integer cents (D-13); the paid row's
 *     total equals the invoice total, the two payments and the two postings
 *   EF-13  tenant B's feed, read the same way, holds none of A's rows (the paid
 *     row included), and owner A on B's feed is refused
 *
 * CHARACTERIZATION ONLY (not a contract; V1-55 / D-08 own the dedupe):
 *   the Activity rows each payment writes in this harness, and the domain events
 *   it puts on the bus (which, in the full app, also drive the listener writers
 *   activity-event.listener.ts and automation-executor.service.ts; those are not
 *   wired here).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService,
 * CrmTimelineService, TimelineService (Activity rows), TimelineController,
 * BusinessEventInterceptor (installed as APP_INTERCEPTOR, as app.module.ts
 * does), ResilientEmitterService, BusinessEventQueueService (its BullMQ queue and
 * worker on REDIS_URL) and BusinessEventService write and read real rows, and the
 * production GlobalHttpExceptionFilter + ValidationPipe are installed. Stand-ins:
 * identity attachment (a test middleware reads `x-k19a-user`, loads that seeded
 * user row and attaches { id, email, role } as the Supabase-verifying
 * AuthMiddleware would); EventEmitter2 is a recorder; the anomaly inspector,
 * stats cache, COGS posting and the AI / Gmail / Drive services are stubs off
 * the boundary. TimelineController declares its TimelineService dependency only
 * through tsc-emitted `design:paramtypes`, which vitest's esbuild transform does
 * not emit, so the test defines that one metadata entry exactly as tsc would.
 * ResilientEmitterService.emit is wrapped by a pass-through recorder (`emits`):
 * every job still goes to the real queue; the recorder shows, without waiting
 * on the worker, what the interceptor handed it for a request.
 *
 * Queue isolation (R0-19 review, CR-R19-1): 'business-events' is one global
 * BullMQ queue name, so every app on the same REDIS_URL (a dist/main.js that a
 * parallel test file spawns) would compete for this run's jobs, and this run's
 * worker for theirs. BullMQ's real Queue and Worker are therefore constructed
 * with a BullMQ `prefix` of this run's own (vi.mock below adds only that
 * option); BusinessEventQueueService itself is unchanged. Its keys are deleted
 * in afterAll.
 *
 * Fixtures: prefix `k19a_` (registered in test/helpers/fixture-prefixes.json),
 * plus a per-run tag in every id so a BullMQ job left over from an earlier run
 * can never land on this run's business. Hard-deleted by raw SQL matched
 * through sqlLikePrefix(P), in dependency order, in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

/** CR-R19-1: this run's own BullMQ key prefix (no other app on REDIS_URL shares it). */
const BULL = vi.hoisted(() => ({
  prefix: `k19a-bull-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
}));

// The real BullMQ classes; only the key prefix is set, for every queue and worker
// this harness builds (BusinessEventQueueService's 'business-events' pair).
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  type QueueArgs = ConstructorParameters<typeof actual.Queue>;
  type WorkerArgs = ConstructorParameters<typeof actual.Worker>;
  class Queue extends actual.Queue {
    constructor(name: string, opts?: QueueArgs[1], connection?: QueueArgs[2]) {
      super(name, { ...opts, prefix: BULL.prefix } as QueueArgs[1], connection);
    }
  }
  class Worker extends actual.Worker {
    constructor(name: string, processor?: WorkerArgs[1], opts?: WorkerArgs[2], connection?: WorkerArgs[3]) {
      super(name, processor, { ...opts, prefix: BULL.prefix } as WorkerArgs[2], connection);
    }
  }
  return { ...actual, Queue, Worker };
});

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k19a_';
const HEADER = 'x-k19a-user';
/** Per-run tag: ids differ between runs, so a stale queued audit job cannot hit them. */
const RUN = Date.now().toString(36);

const ID = {
  ownerA: `${P}${RUN}_ownerA`,
  adminA: `${P}${RUN}_adminA`,
  ownerB: `${P}${RUN}_ownerB`,
  bizA: `${P}${RUN}_bizA`,
  bizB: `${P}${RUN}_bizB`,
  contactA: `${P}${RUN}_contactA`,
  contactB: `${P}${RUN}_contactB`,
  invA: `${P}${RUN}_invA`,
  invB: `${P}${RUN}_invB`,
};

const PAYMENT_ROUTE = '/commerce/businesses/:businessId/invoices/:invoiceId/payments';
const INVOICE_A_TOTAL = 250;
const INVOICE_B_TOTAL = 80;

let db: any;
let app: any;
let redis: any;

/** Domain events CommerceService / InvoiceWorkflowService put on the bus. */
const bus: Array<{ name: string; payload: any }> = [];
const eventRecorder = {
  emit: (name: string, payload: unknown) => {
    bus.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Every job the interceptor handed ResilientEmitterService (pass-through recorder). */
const emits: Array<{ eventType: string; subjectId: string; actorId: string }> = [];

/** Shared across the ordered cases below. */
const S: {
  partialId?: string;
  fullId?: string;
  bPaymentId?: string;
} = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function agent() {
  return request(app.getHttpServer());
}

function payAs(user: string, biz: string, inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${inv}/payments`).set(HEADER, user).send(body);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `read` until `done` holds or the deadline passes; return the last read. */
async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(50);
    value = await read();
  }
  return value;
}

/** Every audit row of a business, oldest first (fresh read). */
async function auditRows(businessId: string): Promise<any[]> {
  return db.businessEvent.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
}

/**
 * The audit rows a request wrote: wait for the business's row count to reach
 * `before + 1` (the audit write is asynchronous: a tap after the response, then
 * the queue worker), let a duplicate surface if there is one, then return the
 * new rows.
 */
async function newAuditRows(businessId: string, before: number): Promise<any[]> {
  await waitFor(() => auditRows(businessId), (rows) => rows.length >= before + 1);
  await sleep(400);
  return (await auditRows(businessId)).slice(before);
}

/** This run's audit queue (run-scoped prefix, so only this run's jobs). */
async function auditQueue(): Promise<any> {
  const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
  return app.get(BusinessEventQueueService).queue;
}

/** Wait until this run's audit queue holds no waiting, active or delayed job. */
async function drainAuditQueue(ms = 10_000): Promise<Record<string, number>> {
  const queue = await auditQueue();
  return waitFor(
    () => queue.getJobCounts('waiting', 'active', 'delayed'),
    (c: Record<string, number>) => (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0) === 0,
    ms,
  );
}

async function activityRows(businessId: string): Promise<Array<{ id: string; module: string; action: string; entityType: string; entityId: string | null }>> {
  return db.activity.findMany({
    where: { businessId },
    orderBy: { occurredAt: 'asc' },
    select: { id: true, module: true, action: true, entityType: true, entityId: true },
  });
}

/** Activity rows written since `before` once the fire-and-forget writers settle. */
async function newActivityRows(businessId: string, before: number) {
  let last = -1;
  let rows = await activityRows(businessId);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await sleep(250);
    rows = await activityRows(businessId);
    if (rows.length > before && rows.length === last) break;
    last = rows.length;
  }
  return rows.slice(before);
}

async function contactEventsFor(businessId: string, contactId: string, reference: string): Promise<any[]> {
  const rows = await db.contactEvent.findMany({
    where: { businessId, contactId, type: 'invoice.payment_recorded' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.filter((r: any) => (r.data as any)?.reference === reference);
}

async function postingsFor(businessId: string, paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId, externalRef: `Payment:${paymentId}:payment_recorded` },
  });
}

/** The step-4 evidence pins for one manual payment recorded by `owner`. */
async function expectPaymentEvidence(opts: {
  businessId: string;
  contactId: string;
  invoiceId: string;
  paymentId: string;
  owner: string;
  reference: string;
  audit: any[];
}) {
  const row = await db.payment.findUnique({ where: { id: opts.paymentId } });
  expect(row).toMatchObject({ businessId: opts.businessId, invoiceId: opts.invoiceId, status: 'SUCCESSFUL' });
  expect(row.recordedBy, 'Payment.recordedBy').toBe(opts.owner);

  const events = await contactEventsFor(opts.businessId, opts.contactId, opts.reference);
  expect(events, 'ContactEvent invoice.payment_recorded').toHaveLength(1);
  expect(events[0]).toMatchObject({ actorId: opts.owner, actorType: 'USER', source: 'commerce' });
  expect((events[0].data as any).invoiceId).toBe(opts.invoiceId);

  expect(opts.audit, 'audit rows written by this request').toHaveLength(1);
  expect(opts.audit[0]).toMatchObject({
    businessId: opts.businessId,
    eventType: 'payment.record',
    subjectType: 'payment',
    subjectId: opts.paymentId,
    action: 'record',
    actorType: 'human',
    actorId: opts.owner,
  });
  expect((opts.audit[0].metadata as any)).toMatchObject({ route: PAYMENT_ROUTE, httpMethod: 'POST' });

  const postings = await postingsFor(opts.businessId, opts.paymentId);
  expect(postings, 'Payment:<id>:payment_recorded posting').toHaveLength(1);
  expect(postings[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: opts.paymentId, createdById: opts.owner });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

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
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { TimelineController } = await import('../src/modules/timeline/timeline.controller');
  const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
  const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');
  const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { BusinessEventAnomalyService } = await import('../src/modules/business-events/business-event-anomaly.service');

  // What tsc emits for `constructor(private readonly timeline: TimelineService)`.
  if (!Reflect.getMetadata('design:paramtypes', TimelineController)) {
    Reflect.defineMetadata('design:paramtypes', [TimelineService], TimelineController);
  }
  // V1-25: what tsc emits for queryEvents(@Param() businessId: string,
  // @Query() query: QueryTimelineDto). Without it the ValidationPipe sees no
  // metatype and never applies the DTO, so this harness would read a query the
  // built server refuses (and the reverse). EF-10a pins it against tsc.
  const { QueryTimelineDto } = await import('../src/modules/timeline/dto/query-timeline.dto');
  if (!Reflect.getMetadata('design:paramtypes', TimelineController.prototype, 'queryEvents')) {
    Reflect.defineMetadata('design:paramtypes', [String, QueryTimelineDto], TimelineController.prototype, 'queryEvents');
  }

  // BullMQ refuses a connection whose maxRetriesPerRequest is not null
  // (RedisModule sets the same for the app).
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, TimelineController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      // The audit pipeline, wired as app.module.ts and BusinessEventModule wire it.
      { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
      ResilientEmitterService,
      BusinessEventQueueService,
      BusinessEventService,
      { provide: BusinessEventAnomalyService, useValue: { inspect: async () => undefined } },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventRecorder },
      // Real contact timeline and real Activity writer.
      CrmTimelineService,
      TimelineService,
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      {
        provide: CrmService,
        useFactory: (t: InstanceType<typeof CrmTimelineService>) => ({
          logContactEvent: (input: Parameters<InstanceType<typeof CrmTimelineService>['logContactEvent']>[0]) => t.logContactEvent(input),
        }),
        inject: [CrmTimelineService],
      },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

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
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  // Pass-through recorder: the real emit still runs for every job.
  const resilient: InstanceType<typeof ResilientEmitterService> = app.get(ResilientEmitterService);
  const realEmit = resilient.emit.bind(resilient);
  resilient.emit = async (job: Parameters<typeof realEmit>[0]) => {
    emits.push({ eventType: job.eventType, subjectId: job.subjectId, actorId: job.actorId });
    return realEmit(job);
  };

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.ownerA, email: `${P}${RUN}_ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.adminA, email: `${P}${RUN}_adminA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}${RUN}_ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'K19A Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'K19A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mAa`, userId: ID.adminA, businessId: ID.bizA, role: 'ADMIN' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'K19a', lastName: 'CustomerA', email: `${P}${RUN}_ca@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'K19a', lastName: 'CustomerB', email: `${P}${RUN}_cb@test.local` } });
  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await seeder.ensureDefaults(ID.bizA);
  await seeder.ensureDefaults(ID.bizB);

  for (const [id, businessId, contactId, total, n] of [
    [ID.invA, ID.bizA, ID.contactA, INVOICE_A_TOTAL, 1],
    [ID.invB, ID.bizB, ID.contactB, INVOICE_B_TOTAL, 2],
  ] as const) {
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `K19A-${RUN}-${n}`,
        status: 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId,
        contactId,
        items: { create: [{ id: `${id}_item1`, description: `K19A item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  // Let in-flight audit jobs land before the worker stops, so none is left queued.
  if (app) {
    try { await drainAuditQueue(5_000); } catch { /* best-effort */ }
    await app.close();
  }
  if (db) await cleanup();
  if (redis) {
    // CR-R19-1: drop this run's BullMQ keys (completed jobs are kept for a day otherwise).
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${BULL.prefix}:*`, 'COUNT', 500);
        if (keys.length) await redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch { /* best-effort */ }
    await redis.quit();
  }
}, 60_000);

describe('harness isolation (R0-19 review, CR-R19-1)', () => {
  it("the audit queue and its worker run under this run's own BullMQ prefix, so no other app on REDIS_URL takes this run's jobs", async () => {
    const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
    const service = app.get(BusinessEventQueueService) as any;
    expect(service.queue.name).toBe('business-events');
    expect(service.queue.opts.prefix).toBe(BULL.prefix);
    expect(service.worker?.opts?.prefix, 'the worker shares the prefix').toBe(BULL.prefix);
    expect(BULL.prefix).not.toBe('bull');
  });
});

describe('fixture sanity (real rows)', () => {
  it('two tenants, each with an OWNER, a system chart of accounts and one SENT invoice; no payment, posting, audit or Activity row yet', async () => {
    const roster: Record<string, string[][]> = {
      [ID.bizA]: [[ID.ownerA, 'OWNER'], [ID.adminA, 'ADMIN']],
      [ID.bizB]: [[ID.ownerB, 'OWNER']],
    };
    for (const [biz, inv] of [[ID.bizA, ID.invA], [ID.bizB, ID.invB]]) {
      const members = await db.membership.findMany({ where: { businessId: biz } });
      expect(members.map((m: any) => [m.userId, m.role]).sort()).toEqual([...roster[biz]].sort());
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } })).toBeGreaterThan(0);
      expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('SENT');
      expect(await db.payment.count({ where: { businessId: biz } })).toBe(0);
      expect(await db.financialTransaction.count({ where: { businessId: biz } })).toBe(0);
      expect(await auditRows(biz)).toEqual([]);
      expect(await activityRows(biz)).toEqual([]);
    }
  });
});

describe('step 4 audit trail: a manual payment is audited as a payment (R0-19, real DB, real audit pipeline)', () => {
  it('EF-01: partial payment (100 of 250) by the owner -> PARTIALLY_PAID; recordedBy, one ContactEvent, one payment.record audit row on the Payment, one posting', async () => {
    const auditBefore = (await auditRows(ID.bizA)).length;
    const activityBefore = (await activityRows(ID.bizA)).length;
    bus.length = 0;
    emits.length = 0;

    const reference = `${P}${RUN}-partial`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 100, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.partialId = res.body.payment.id;
    // The interceptor handed the emitter this request's one row before the response left.
    expect(emits).toEqual([{ eventType: 'payment.record', subjectId: S.partialId, actorId: ID.ownerA }]);
    expect((await db.invoice.findUnique({ where: { id: ID.invA } })).status).toBe('PARTIALLY_PAID');

    const audit = await newAuditRows(ID.bizA, auditBefore);
    await expectPaymentEvidence({
      businessId: ID.bizA, contactId: ID.contactA, invoiceId: ID.invA, paymentId: S.partialId!,
      owner: ID.ownerA, reference, audit,
    });

    // CHARACTERIZATION (V1-55 / D-08): what this payment wrote to Activity in
    // this harness, and what it put on the bus.
    const activity = await newActivityRows(ID.bizA, activityBefore);
    expect(activity.map((a) => `${a.module}:${a.action}:${a.entityType}`).sort()).toEqual([
      'FINANCE:payment_recorded:payment',
      'crm:invoice.payment_recorded:contact',
    ]);
    expect(activity.find((a) => a.module === 'FINANCE')?.entityId).toBe(S.partialId);
    // Sorted: business_event.created is the audit worker's fan-out and lands after the response.
    expect(bus.map((e) => e.name).sort()).toEqual(['business_event.created', 'crm.contact_event.logged', 'invoice.payment_recorded']);
    expect(bus.filter((e) => e.name === 'business_event.created').map((e) => e.payload.eventType)).toEqual(['payment.record']);
  });

  it('EF-02: full payment (the remaining 150) by the owner -> PAID; the same pins for the second payment', async () => {
    const auditBefore = (await auditRows(ID.bizA)).length;
    const activityBefore = (await activityRows(ID.bizA)).length;
    bus.length = 0;
    emits.length = 0;

    const reference = `${P}${RUN}-full`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 150, method: 'bank_transfer', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.fullId = res.body.payment.id;
    expect(emits).toEqual([{ eventType: 'payment.record', subjectId: S.fullId, actorId: ID.ownerA }]);
    expect(S.fullId).not.toBe(S.partialId);
    expect(res.body.remaining).toBe(0);
    expect((await db.invoice.findUnique({ where: { id: ID.invA } })).status).toBe('PAID');

    const audit = await newAuditRows(ID.bizA, auditBefore);
    await expectPaymentEvidence({
      businessId: ID.bizA, contactId: ID.contactA, invoiceId: ID.invA, paymentId: S.fullId!,
      owner: ID.ownerA, reference, audit,
    });

    // CHARACTERIZATION (V1-55 / D-08). In the full app invoice.paid also
    // drives ActivityEventListener.onInvoicePaid and the automation executor's
    // feed write; neither is wired in this harness.
    const activity = await newActivityRows(ID.bizA, activityBefore);
    expect(activity.map((a) => `${a.module}:${a.action}:${a.entityType}`).sort()).toEqual([
      'FINANCE:payment_recorded:payment',
      'crm:invoice.payment_recorded:contact',
    ]);
    expect(activity.find((a) => a.module === 'FINANCE')?.entityId).toBe(S.fullId);
    expect(bus.map((e) => e.name).sort()).toEqual(['business_event.created', 'crm.contact_event.logged', 'invoice.paid']);
    expect(bus.filter((e) => e.name === 'business_event.created').map((e) => e.payload.eventType)).toEqual(['payment.record']);
  });

  it('EF-03: business A holds exactly one payment.record row per payment and no invoice.create row, nor any audit row whose subject is the invoice', async () => {
    const rows = await auditRows(ID.bizA);
    expect(rows.map((r) => [r.eventType, r.subjectType, r.subjectId])).toEqual([
      ['payment.record', 'payment', S.partialId],
      ['payment.record', 'payment', S.fullId],
    ]);
    expect(rows.filter((r) => r.eventType === 'invoice.create')).toEqual([]);
    expect(rows.filter((r) => r.subjectId === ID.invA)).toEqual([]);
    // The audit row of each payment exists nowhere else.
    for (const paymentId of [S.partialId, S.fullId]) {
      const bySubject = await db.businessEvent.findMany({ where: { subjectType: 'payment', subjectId: paymentId } });
      expect(bySubject.map((r: any) => r.businessId)).toEqual([ID.bizA]);
    }
  });

  it('EF-04 LEDGER: the audit write adds no FinancialTransaction or LedgerEntry; A holds exactly the two payment postings, each balanced', async () => {
    const txns = await db.financialTransaction.findMany({ where: { businessId: ID.bizA }, orderBy: { createdAt: 'asc' } });
    expect(txns.map((t: any) => t.externalRef)).toEqual([
      `Payment:${S.partialId}:payment_recorded`,
      `Payment:${S.fullId}:payment_recorded`,
    ]);
    const entries = await db.ledgerEntry.findMany({ where: { businessId: ID.bizA } });
    const txnIds = new Set(txns.map((t: any) => t.id));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((e: any) => !txnIds.has(e.transactionId)), 'ledger entries outside the two postings').toEqual([]);
    for (const t of txns) {
      const own = entries.filter((e: any) => e.transactionId === t.id);
      const debit = own.reduce((s: number, e: any) => s + Number(e.debit ?? 0), 0);
      const credit = own.reduce((s: number, e: any) => s + Number(e.credit ?? 0), 0);
      expect(debit, `posting ${t.externalRef} balanced`).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(Number(t.amount), 2);
    }
  });
});

describe('tenant control on the evidence feed (R0-19)', () => {
  it('EF-05: owner B records a payment on B -> one payment.record audit row in B, none in A', async () => {
    const auditBeforeB = (await auditRows(ID.bizB)).length;
    const auditA = (await auditRows(ID.bizA)).length;
    const reference = `${P}${RUN}-b`;
    const res = await payAs(ID.ownerB, ID.bizB, ID.invB, { amount: 30, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.bPaymentId = res.body.payment.id;

    const audit = await newAuditRows(ID.bizB, auditBeforeB);
    await expectPaymentEvidence({
      businessId: ID.bizB, contactId: ID.contactB, invoiceId: ID.invB, paymentId: S.bPaymentId!,
      owner: ID.ownerB, reference, audit,
    });
    expect(await auditRows(ID.bizA)).toHaveLength(auditA);
  });

  it("EF-06: GET /timeline/businesses/B/events (owner B) answers B's rows and none of A's", async () => {
    await newActivityRows(ID.bizB, 0);
    const res = await agent().get(`/timeline/businesses/${ID.bizB}/events`).set(HEADER, ID.ownerB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length, "B's own payment rows are in its feed").toBeGreaterThan(0);
    expect(res.body.every((row: any) => row.businessId === ID.bizB)).toBe(true);

    const aIds = new Set((await activityRows(ID.bizA)).map((a) => a.id));
    expect(aIds.size, "A's payments wrote Activity rows").toBeGreaterThan(0);
    expect(res.body.filter((row: any) => aIds.has(row.id)), "A's Activity rows in B's feed").toEqual([]);
    const text = JSON.stringify(res.body);
    for (const leak of [ID.bizA, ID.invA, ID.contactA, S.partialId!, S.fullId!]) {
      expect(text.includes(leak), `B's feed mentions ${leak}`).toBe(false);
    }
    expect(res.body.some((row: any) => row.entityId === S.bPaymentId)).toBe(true);
  });

  it("EF-07: owner B on A's timeline is refused (403) and receives no row", async () => {
    const res = await agent().get(`/timeline/businesses/${ID.bizA}/events`).set(HEADER, ID.ownerB);
    expect(res.status).toBe(403);
    expect(Array.isArray(res.body)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(S.partialId!);
  });
});

describe('idempotent replay of a recorded payment (R0-D2) is not audited (R0-19 review, R19-ST-1)', () => {
  /**
   * Replay `reference` (100, cash) on invoice A as `user` and pin that nothing
   * was written: same Payment back, no payment, posting, ContactEvent or audit
   * row, and the payment's audit trail is still its one payment.record row by
   * the owner, agreeing with Payment.recordedBy.
   */
  async function expectSilentReplay(user: string, reference: string, paymentId: string) {
    const auditBefore = await auditRows(ID.bizA);
    const txnsBefore = await db.financialTransaction.count({ where: { businessId: ID.bizA } });
    const entriesBefore = await db.ledgerEntry.count({ where: { businessId: ID.bizA } });
    emits.length = 0;

    const res = await payAs(user, ID.bizA, ID.invA, { amount: 100, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment.id).toBe(paymentId);
    expect(emits, 'the interceptor handed the emitter nothing for the replay').toEqual([]);

    expect(await db.payment.count({ where: { invoiceId: ID.invA } })).toBe(2);
    expect((await db.payment.findUnique({ where: { id: paymentId } })).recordedBy, 'Payment.recordedBy').toBe(ID.ownerA);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA } })).toBe(txnsBefore);
    expect(await db.ledgerEntry.count({ where: { businessId: ID.bizA } })).toBe(entriesBefore);
    const events = await contactEventsFor(ID.bizA, ID.contactA, reference);
    expect(events.map((e: any) => e.actorId), 'ContactEvent invoice.payment_recorded').toEqual([ID.ownerA]);

    // Nothing reaches business_events either: this run's queue drains and the
    // business holds the rows it held before the replay.
    await sleep(300);
    await drainAuditQueue();
    expect((await auditRows(ID.bizA)).map((r) => r.id)).toEqual(auditBefore.map((r) => r.id));
    const trail = await db.businessEvent.findMany({ where: { subjectType: 'payment', subjectId: paymentId } });
    expect(trail.map((r: any) => [r.businessId, r.eventType, r.actorType, r.actorId])).toEqual([
      [ID.bizA, 'payment.record', 'human', ID.ownerA],
    ]);
  }

  it('EF-08: the owner replaying the partial payment (same reference + amount) gets the same Payment back and writes nothing: no payment, posting, ContactEvent or audit row', async () => {
    await expectSilentReplay(ID.ownerA, `${P}${RUN}-partial`, S.partialId!);
  });

  it("EF-09: an ADMIN re-submitting the owner's slip (same reference + amount) gets the same Payment back and writes no audit row naming the ADMIN; the payment keeps one payment.record row by the owner", async () => {
    await expectSilentReplay(ID.adminA, `${P}${RUN}-partial`, S.partialId!);
    const byAdmin = await db.businessEvent.findMany({ where: { businessId: ID.bizA, actorId: ID.adminA } });
    expect(byAdmin, 'audit rows attributed to the ADMIN').toEqual([]);
  });
});

describe('V1-25-EVT-BUSINESS-FEED: the business feed the cockpit reads (real DB)', () => {
  /** The page size the cockpit's BusinessTimeline asks for. */
  const COCKPIT_LIMIT = 50;
  /** The server's bound on one page of the feed. */
  const MAX_LIMIT = 200;

  /** Integer cents (D-13): the comparison unit for every amount below. */
  const cents = (v: unknown) => Math.round(Number(v) * 100);

  function feed(user: string, biz: string, query = `limit=${COCKPIT_LIMIT}`) {
    return agent().get(`/timeline/businesses/${biz}/events?${query}`).set(HEADER, user);
  }

  /** The cockpit's read of `biz`, as `user`; asserts it answered 200 with an array. */
  async function cockpitRead(user: string, biz: string): Promise<any[]> {
    const res = await feed(user, biz);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    return res.body;
  }

  it('EF-10a CONTROL: queryEvents validates its query against QueryTimelineDto, with the parameter types tsc emits', async () => {
    const ts = await import('typescript');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(path.resolve(__dirname, '../src/modules/timeline/timeline.controller.ts'), 'utf8');
    const emitted = ts.transpileModule(source, {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const end = emitted.indexOf('], TimelineController.prototype, "queryEvents", null)');
    expect(end).toBeGreaterThan(0);
    const decorators = emitted.slice(emitted.lastIndexOf('__decorate([', end), end);
    // A single-file transpile cannot see that the imported DTO is a class, so it
    // emits a guarded reference to it; reduce that to the class name.
    const types = decorators
      .match(/design:paramtypes", \[([^\]]*)\]/)?.[1]
      ?.replace(/typeof \(_\w+ = typeof \w+\.(\w+) !== "undefined" && \w+\.\1\) === "function" \? _\w+ : Object/g, '$1');
    expect(types).toBe('String, QueryTimelineDto');
    const { TimelineController } = await import('../src/modules/timeline/timeline.controller');
    const { QueryTimelineDto } = await import('../src/modules/timeline/dto/query-timeline.dto');
    expect(Reflect.getMetadata('design:paramtypes', TimelineController.prototype, 'queryEvents')).toEqual([String, QueryTimelineDto]);
  }, 30_000); // loading the TypeScript compiler alone can pass 5 s on a loaded machine

  it('EF-10: the page size is bounded: limit 10000, 201, 0, -1, 2.5 and abc answer 400 with no row', async () => {
    for (const limit of ['10000', String(MAX_LIMIT + 1), '0', '-1', '2.5', 'abc']) {
      const res = await feed(ID.ownerA, ID.bizA, `limit=${limit}`);
      expect(res.status, `limit=${limit}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(Array.isArray(res.body), `limit=${limit} answered rows`).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(S.partialId!);
    }
  });

  it('EF-10b: a limit within the bound (200, 50, 1) is read as a number and answers at most that many rows; minRevenueImpact is read as a number', async () => {
    const total = (await activityRows(ID.bizA)).length;
    expect(total, 'A has more than one feed row').toBeGreaterThan(1);
    for (const limit of [MAX_LIMIT, COCKPIT_LIMIT, 1]) {
      const res = await feed(ID.ownerA, ID.bizA, `limit=${limit}`);
      expect(res.status, `limit=${limit}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toHaveLength(Math.min(limit, total));
      expect(res.body.every((row: any) => row.businessId === ID.bizA)).toBe(true);
    }
    const minImpact = await feed(ID.ownerA, ID.bizA, `limit=${COCKPIT_LIMIT}&minRevenueImpact=1`);
    expect(minImpact.status, JSON.stringify(minImpact.body)).toBe(200);
    expect(minImpact.body.every((row: any) => Number(row.revenueImpact) >= 1)).toBe(true);
  });

  it("EF-11: A's feed, read as the cockpit reads it, holds one FINANCE payment_recorded row per payment with its amount and the commerce paid row with the invoice total", async () => {
    // invoice.paid is recorded once for A, by the final payment (EF-02); the
    // full app's EventEmitter hands it to ActivityEventListener.onInvoicePaid.
    const paid = bus.filter((e) => e.name === 'invoice.paid');
    expect(paid.map((e) => [e.payload.businessId, e.payload.invoice?.id])).toEqual([[ID.bizA, ID.invA]]);
    const { ActivityEventListener } = await import('../src/modules/flow/activity-event.listener');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const listener = new ActivityEventListener(new ActivityService(app.get(PrismaService)));
    await listener.onInvoicePaid(paid[0].payload);

    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    expect(rows.every((row) => row.businessId === ID.bizA)).toBe(true);
    // Newest first.
    const times = rows.map((row) => new Date(row.occurredAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const payments = rows.filter((row) => row.module === 'FINANCE' && row.action === 'payment_recorded');
    expect(payments.map((row) => row.entityId).sort()).toEqual([S.partialId, S.fullId].sort());
    const byPayment = new Map(payments.map((row) => [row.entityId, row]));
    expect(byPayment.get(S.partialId)).toMatchObject({ entityType: 'payment', data: { amount: 100, currency: 'TTD' } });
    expect(byPayment.get(S.fullId)).toMatchObject({ entityType: 'payment', data: { amount: 150, currency: 'TTD' } });

    const paidRows = rows.filter((row) => row.action === 'paid');
    expect(paidRows).toHaveLength(1);
    expect(paidRows[0]).toMatchObject({
      module: 'commerce',
      entityType: 'invoice',
      entityId: ID.invA,
      title: 'Payment received',
      data: { invoiceId: ID.invA, total: INVOICE_A_TOTAL, currency: 'TTD' },
    });
  });

  it('EF-12 LEDGER: each feed amount equals its Payment row and its posting (balanced entries), in integer cents; the paid row total equals the invoice, the two payments and the two postings', async () => {
    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    let paymentCents = 0;
    let postingCents = 0;
    for (const [paymentId, expected] of [[S.partialId!, 10_000], [S.fullId!, 15_000]] as const) {
      const row = rows.find((r) => r.action === 'payment_recorded' && r.entityId === paymentId);
      expect(row, `feed row for ${paymentId}`).toBeTruthy();
      const payment = await db.payment.findUnique({ where: { id: paymentId } });
      const postings = await postingsFor(ID.bizA, paymentId);
      expect(postings).toHaveLength(1);
      const entries = await db.ledgerEntry.findMany({ where: { transactionId: postings[0].id } });
      const debit = entries.reduce((s: number, e: any) => s + cents(e.debit ?? 0), 0);
      const credit = entries.reduce((s: number, e: any) => s + cents(e.credit ?? 0), 0);

      expect(cents(row.data.amount), 'feed amount').toBe(expected);
      expect(cents(payment.amount), 'Payment.amount').toBe(expected);
      expect(cents(postings[0].amount), 'posting amount').toBe(expected);
      expect(debit, 'posting debits').toBe(expected);
      expect(credit, 'posting credits').toBe(expected);
      expect(row.data.currency).toBe(payment.currency);
      expect(postings[0].currency).toBe(payment.currency);
      paymentCents += cents(payment.amount);
      postingCents += cents(postings[0].amount);
    }
    const paid = rows.find((r) => r.action === 'paid' && r.entityId === ID.invA);
    const invoice = await db.invoice.findUnique({ where: { id: ID.invA } });
    expect(cents(paid.data.total), 'paid row total').toBe(cents(invoice.total));
    expect(cents(invoice.total)).toBe(cents(INVOICE_A_TOTAL));
    expect(paymentCents, 'the two payments').toBe(cents(invoice.total));
    expect(postingCents, 'the two postings').toBe(cents(invoice.total));
  });

  it("EF-13: tenant B's feed, read as the cockpit reads it, holds none of A's rows (the paid row included); owner A on B's feed is refused", async () => {
    const rows = await cockpitRead(ID.ownerB, ID.bizB);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.businessId === ID.bizB)).toBe(true);
    const aIds = new Set((await activityRows(ID.bizA)).map((a) => a.id));
    expect(rows.filter((row) => aIds.has(row.id)), "A's rows in B's feed").toEqual([]);
    expect(rows.filter((row) => row.action === 'paid'), "B's invoice is not paid; A's paid row is not B's").toEqual([]);
    const text = JSON.stringify(rows);
    for (const leak of [ID.bizA, ID.invA, ID.contactA, S.partialId!, S.fullId!]) {
      expect(text.includes(leak), `B's feed mentions ${leak}`).toBe(false);
    }

    const refused = await feed(ID.ownerA, ID.bizB);
    expect(refused.status).toBe(403);
    expect(Array.isArray(refused.body)).toBe(false);
    expect(JSON.stringify(refused.body)).not.toContain(S.bPaymentId!);
  });
});
