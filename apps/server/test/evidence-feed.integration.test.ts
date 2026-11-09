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
 *   V1-25 review repairs:
 *   EF-11b (CR-V125-1, contract since V1-55) the second invoice.paid listener
 *     the full app registers (AutomationExecutorService.onInvoicePaid) is
 *     delivered the same payload: it writes no feed row, so the feed holds ONE
 *     paid row for the invoice, ActivityEventListener's (until V1-55 it wrote
 *     a second, the pair the cockpit reader showed once)
 *   EF-11c (CR-V125-2) each payment's CRM contact mirror row (raw event name
 *     as title, JSON detail with reference and recordedBy) as the reader sees it
 *   EF-14..EF-16 it.todo: the scope filter (SEC-V125-1), CRM scope and contact
 *     visibility (SEC-V125-2) and the sibling-route bounds (SEC-V125-3) are
 *     server changes outside V1-25's write set
 *
 * V1-55-EVT-ACTIVITY-DEDUPE (M50; owner ruling D-08: Activity is the
 * user-visible feed, BusinessEvent the audit trail), on a third tenant C: each
 * step's domain events, as the real services put them on the bus, are handed to
 * the Activity writers the full app registers for them (ActivityEventListener,
 * AutomationExecutorService and the CRM RevenueEventListener, subscribed by the
 * real @nestjs/event-emitter loader on a real EventEmitter2 with the
 * event-bus.module.ts options), and every Activity row the step wrote is pinned:
 *   V55-01 contact create (the real CrmService.createContact; the CRM controller
 *     is not mounted here): ActivityEventListener's crm created row; the
 *     executor's second one is still written (characterization, V55-08)
 *   V55-02 invoice create (POST .../invoices): one commerce created row
 *   V55-03 invoice send (PATCH .../status/sent): one commerce sent row
 *   V55-04 a partial manual payment: its FINANCE payment_recorded row, no paid row
 *   V55-05 the final manual payment: its FINANCE row and ONE commerce paid row
 *     for the settled invoice, ActivityEventListener's ('Payment received');
 *     since PR196-CRM-LIFECYCLE (D-81) the CRM RevenueEventListener moves the
 *     invoice's LEAD contact to CLIENT through a real CrmService on the feed bus
 *     (review CR-1: the stub had no such method and the move never ran here):
 *     one 'Status changed' row and one follow-up task, which writes no row; the
 *     executor's stage-change task request is pinned as characterization (CR-2)
 *   flows are still dispatched: one ACTIVE published flow per trigger
 *     (contact.created, invoice.sent, invoice.paid, booking.created,
 *     booking.confirmed) runs once, through the executor, with the step's ids
 *   LEDGER: the feed writers add no FinancialTransaction or LedgerEntry; each
 *     payment has exactly one Payment:<id>:payment_recorded posting, and C holds
 *     only those two, balanced
 *   V55-09 booking create (the real BookingsService.createBooking; the bookings
 *     controller is not mounted here): ActivityEventListener's bookings created
 *     row ('New booking', no date or time) and the executor's ('New booking
 *     from <contact>', detail the start time), which V1-55 keeps (review repair
 *     CR-V155-1: it is the only feed row that says when the booking is); the
 *     booking.created flow is dispatched once
 *   V55-10 booking confirm (the real BookingsService.confirmBooking): ONE
 *     bookings confirmed row, ActivityEventListener's (the executor's removed
 *     row had no detail, so nothing it showed is lost); the booking.confirmed
 *     flow is dispatched once
 *   V55-06 the cockpit read of C shows each of those rows once (the booking
 *     created pair twice, its timed row among them)
 *   V55-07 it.todo: the CRM contact mirror (crm-timeline.service.ts:106 ->
 *     timeline.service.ts:51) still copies invoice.payment_recorded and
 *     invoice.paid into the feed: outside V1-55's write set
 *   V55-08 it.todo: contact.created keeps the executor's row, because
 *     log-redaction.integration.test.ts:758-762 (outside the write set) counts
 *     it as proof the executor's listener ran
 *   V55-11 it.todo: booking create keeps the executor's row until
 *     activity-event.listener.ts (outside the write set) puts the start time in
 *     its own detail
 *
 * CHARACTERIZATION ONLY in EF-01 / EF-02: the Activity rows each payment writes
 *   in the R0-19 harness, whose bus is a recorder (no listener runs there; the
 *   V1-55 block above runs them), and the domain events it puts on the bus.
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
    // V1-55: the flows seeded for tenant C and the team audit rows of its invoice create.
    `DELETE FROM flow_versions WHERE flow_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM automation_flows WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // PR196-CRM-LIFECYCLE (D-81): the follow-up task of tenant C's paid invoice and its assignment.
    `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // V1-55 review (CR-V155-1): tenant C's booking and its service (Booking.contact is NoAction).
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

    // CHARACTERIZATION. In the full app invoice.paid also drives
    // ActivityEventListener.onInvoicePaid (the feed's one paid row since V1-55);
    // no listener is wired in this harness (the V1-55 block below wires them).
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

    // minRevenueImpact is read as a number: only the paid row (revenueImpact 250) clears 200.
    const big = await feed(ID.ownerA, ID.bizA, `limit=${COCKPIT_LIMIT}&minRevenueImpact=200`);
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(big.body.map((row: any) => [row.action, row.entityId])).toEqual([['paid', ID.invA]]);
  });

  it("EF-11b (CR-V125-1, V1-55): in the full app invoice.paid also drives AutomationExecutorService.onInvoicePaid; it writes no second feed row, so A's feed holds ONE paid row for the invoice, ActivityEventListener's, with the invoice total", async () => {
    // flow.module.ts registers both listeners of invoice.paid; EF-11 delivered
    // the payload to the first, this delivers the same payload to the second
    // (real ActivityService and Prisma; its CRM task, e-mail, adapter and flow
    // runner collaborators are off the feed and stubbed). Until V1-55 it wrote
    // a second paid row ('Invoice paid') for the same invoice.
    const paid = bus.filter((e) => e.name === 'invoice.paid');
    expect(paid).toHaveLength(1);
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const prisma = app.get(PrismaService);
    const tasks: any[] = [];
    const crmStub = { addTask: async (t: unknown) => { tasks.push(t); }, logContactEvent: async () => undefined };
    const executor = new AutomationExecutorService(prisma, new ActivityService(prisma), crmStub as never, {} as never, null, null);
    const before = await activityRows(ID.bizA);
    await executor.onInvoicePaid(paid[0].payload);

    // It ran (its built-in invoice.paid rule still adds the thank-you task) and wrote no Activity row.
    expect(tasks.map((t) => [t.contactId, t.title])).toEqual([[ID.contactA, 'Send thank-you note']]);
    expect((await activityRows(ID.bizA)).map((a) => a.id), "the executor's Activity writes for invoice.paid").toEqual(before.map((a) => a.id));

    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    const paidRows = rows.filter((row) => row.action === 'paid' && row.entityId === ID.invA);
    expect(paidRows, 'one invoice.paid, one feed row').toHaveLength(1);
    expect(paidRows[0]).toMatchObject({
      businessId: ID.bizA, module: 'commerce', action: 'paid', entityType: 'invoice', entityId: ID.invA,
      title: 'Payment received', category: 'PAYMENT',
    });
    expect(cents(paidRows[0].data.total)).toBe(cents(INVOICE_A_TOTAL));
    expect(paidRows[0].data.currency).toBe('TTD');
  });

  it("EF-11c (CR-V125-2): each payment's contact mirror in A's feed is the shape the cockpit reader leaves out (BT-09): module crm, entity the contact, title = action = 'invoice.payment_recorded', detail a JSON object carrying the reference and recordedBy", async () => {
    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    const mirrors = rows.filter((row) => row.module === 'crm' && row.action === 'invoice.payment_recorded');
    expect(mirrors, 'one mirror per payment (EF-01, EF-02)').toHaveLength(2);
    for (const row of mirrors) {
      expect(row).toMatchObject({ entityType: 'contact', entityId: ID.contactA, contactId: ID.contactA, title: 'invoice.payment_recorded' });
      const detail = JSON.parse(row.detail);
      expect(detail).toMatchObject({ invoiceId: ID.invA, recordedBy: ID.ownerA });
      expect(String(detail.reference)).toContain(`${P}${RUN}-`);
    }
    // Each is a second copy of a payment the feed already shows as its FINANCE row.
    expect(mirrors.map((row) => cents(JSON.parse(row.detail).amount)).sort()).toEqual([10_000, 15_000]);
    const finance = rows.filter((row) => row.module === 'FINANCE' && row.action === 'payment_recorded');
    expect(finance.map((row) => cents(row.data.amount)).sort()).toEqual([10_000, 15_000]);
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

  // V1-25 review findings whose fix is server-side in files outside this
  // packet's write set (timeline.controller.ts, timeline.service.ts,
  // flow.controller.ts). Kept as todo, never as a test pinning today's answer.
  // Meanwhile the cockpit does not read the feed for a member whom the V1-47
  // snapshot reports without revenue or CRM read (BusinessActivityFeed, BT-06;
  // the snapshot's RESTRICTED tiles for such a member are proven on a real
  // database by release0-journey.integration.test.ts).
  it.todo("EF-14 (SEC-V125-1): a STAFF member with revenue 'none' gets no FINANCE / commerce / PAYMENT row (no amount, invoice total or number) from GET /timeline/businesses/:id/events, or a 403, as every revenue list route refuses that member: needs a module-scope row filter in TimelineController.queryEvents / TimelineService.queryTimeline (outside V1-25's write set)");
  it.todo("EF-15 (SEC-V125-2): a member with crm 'none' gets no contact-bearing row (?contactId= included), and a member without CRM view-all gets no row naming a PRIVATE or unshared contact it cannot list (visibilityClause, M7): needs the CRM scope and visibility filter in TimelineService.queryTimeline (outside V1-25's write set)");
  it.todo('EF-16 (SEC-V125-3): GET /timeline/businesses/:id/upcoming?limit=100000 and the legacy GET /api/flows/businesses/:id/activity?limit=100000 are bounded like /events (400 above TIMELINE_MAX_LIMIT): needs timeline.controller.ts and flow.controller.ts (outside V1-25\'s write set)');
});

describe('V1-55-EVT-ACTIVITY-DEDUPE: one Activity feed row per event, through the feed writers the full app registers (real DB, tenant C)', () => {
  const C = {
    owner: `${P}${RUN}_ownerC`,
    biz: `${P}${RUN}_bizC`,
    contactEmail: `${P}${RUN}_cc@test.local`,
  };
  const INVOICE_C_TOTAL = 300;
  /** One ACTIVE flow with a published version per trigger the executor dispatches in these steps. */
  const FLOW_TRIGGERS = ['contact.created', 'invoice.sent', 'invoice.paid', 'booking.created', 'booking.confirmed'] as const;
  const flowId = (trigger: string) => `${P}${RUN}_flowC_${trigger.replace(/\./g, '_')}`;
  const cents = (v: unknown) => Math.round(Number(v) * 100);

  const SC: { contactId?: string; invoiceId?: string; invoiceNumber?: string; partialId?: string; fullId?: string; bookingId?: string } = {};
  /** V55-09: tenant C's booking, on its own service, at a fixed start (no business hours, staff or lead time to meet). */
  const BOOKING_C = {
    serviceId: `${P}${RUN}_svcC`,
    start: new Date('2026-12-15T14:00:00.000Z'),
    end: new Date('2026-12-15T15:00:00.000Z'),
  };
  /** What the executor dispatched to the flow runner (the runner itself is off the feed). */
  const flowRuns: Array<{ businessId: string; flowId: string; ctx: any }> = [];
  /** What the executor's built-in rules asked CRM for. */
  const crmTasks: any[] = [];
  let feedModule: any;
  let feedBus: any;
  let crm: any;
  /** PR196-CRM-LIFECYCLE (D-81): the real CrmService the CRM RevenueEventListener moves a paid invoice's contact through, on the feed bus. */
  let lifecycleCrm: any;
  let bookings: any;

  type Row = { id: string; module: string; action: string; entityType: string; entityId: string | null; title: string; detail: string | null; data: any; category: string | null; contactId: string | null };
  const kind = (r: Row) => `${r.module}:${r.action}:${r.entityType}`;

  async function rowsOfC(): Promise<Row[]> {
    return db.activity.findMany({
      where: { businessId: C.biz },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, module: true, action: true, entityType: true, entityId: true, title: true, detail: true, data: true, category: true, contactId: true },
    });
  }

  async function ledgerOfC() {
    return {
      txns: await db.financialTransaction.count({ where: { businessId: C.biz } }),
      entries: await db.ledgerEntry.count({ where: { businessId: C.biz } }),
    };
  }

  /**
   * One step of the journey: run `act` (the real route or service), take the
   * domain events it put on the bus, hand them to the feed writers on the real
   * EventEmitter2 (emit, as the services do), and return every Activity row C
   * gained once the writers settle, with C's ledger counts around the delivery.
   */
  async function step(act: () => Promise<void>) {
    const before = new Set((await rowsOfC()).map((r) => r.id));
    bus.length = 0;
    await act();
    const events = bus.splice(0);
    const ledgerBeforeDelivery = await ledgerOfC();
    for (const e of events) feedBus.emit(e.name, e.payload);
    // Settled: the same row count on four reads 250 ms apart.
    let rows = await rowsOfC();
    let stable = 0;
    const deadline = Date.now() + 10_000;
    while (stable < 4 && Date.now() < deadline) {
      await sleep(250);
      const next = await rowsOfC();
      stable = next.length === rows.length ? stable + 1 : 0;
      rows = next;
    }
    return {
      events: events.map((e) => e.name),
      rows: rows.filter((r) => !before.has(r.id)),
      ledgerBeforeDelivery,
      ledgerAfterDelivery: await ledgerOfC(),
    };
  }

  async function runsOf(trigger: string, n: number) {
    return waitFor(async () => flowRuns.filter((r) => r.flowId === flowId(trigger)), (runs) => runs.length >= n, 5_000);
  }

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { ActivityEventListener } = await import('../src/modules/flow/activity-event.listener');
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
    const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
    const { RevenueEventListener } = await import('../src/modules/crm/revenue-event.listener');
    const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    const { BookingsService } = await import('../src/modules/bookings/bookings.service');

    await db.user.create({ data: { id: C.owner, email: `${P}${RUN}_ownerC@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: C.biz, name: 'K19A Biz C', ownerId: C.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC`, userId: C.owner, businessId: C.biz, role: 'OWNER' } });
    await app.get(ChartOfAccountsSeederService).ensureDefaults(C.biz);
    await db.service.create({ data: { id: BOOKING_C.serviceId, businessId: C.biz, name: 'K19A C service', duration: 60, price: 120 } });
    for (const trigger of FLOW_TRIGGERS) {
      await db.automationFlow.create({
        data: {
          id: flowId(trigger),
          businessId: C.biz,
          name: `K19A flow on ${trigger}`,
          category: 'test',
          status: 'ACTIVE',
          versions: {
            create: [{
              id: `${flowId(trigger)}_v1`,
              version: 1,
              status: 'PUBLISHED',
              publishedAt: new Date(),
              nodes: [{ id: 'trigger', type: 'trigger', data: { triggerEvent: trigger } }],
              edges: [],
            }],
          },
        },
      });
    }

    // The Activity writers the full app registers for these events, subscribed
    // by @nestjs/event-emitter's own loader with event-bus.module.ts's options.
    // Real: Prisma, ActivityService, the CRM timeline (contact events and their
    // Activity mirror). Off the feed and stubbed: the flow runner (recorded),
    // the executor's CRM task calls (recorded), e-mail, contact insights.
    feedModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
      providers: [
        { provide: PrismaService, useValue: app.get(PrismaService) },
        ActivityService,
        ActivityEventListener,
        AutomationExecutorService,
        RevenueEventListener,
        { provide: CrmTimelineService, useValue: app.get(CrmTimelineService) },
        { provide: ContactInsightService, useValue: { markStale: async () => undefined } },
        {
          provide: CrmService,
          useValue: {
            addTask: async (task: unknown) => { crmTasks.push(task); return task; },
            contactDetail: async () => ({ contact: null }),
            updateContact: async () => undefined,
            logContactEvent: async () => undefined,
            // PR196-CRM-LIFECYCLE review CR-1: RevenueEventListener.onInvoicePaid moves the paid
            // invoice's LEAD/PROSPECT contact to CLIENT (D-81) through the real CrmService on this
            // feed bus, as the full app does (a stub without the method throws a TypeError the
            // listener swallows, and the move would never reach the feed writers here).
            advanceToClientOnInvoicePaid: (input: unknown) => lifecycleCrm.advanceToClientOnInvoicePaid(input),
          },
        },
        { provide: TransactionalEmailService, useValue: {} },
        {
          provide: FlowRunnerService,
          useValue: { runFlow: async (businessId: string, id: string, ctx: unknown) => { flowRuns.push({ businessId, flowId: id, ctx }); return {}; } },
        },
      ],
    }).compile();
    await feedModule.init();
    feedBus = feedModule.get(EventEmitter2);
    // D-81: the paid-invoice move, emitting contact.updated / contact_task.created on the feed bus.
    // Real: Prisma and the compare-and-set, its ContactEvents and follow-up task rows; off the feed
    // and stubbed: plan limits, caches, the contact audit write (a ContactAuditEntry, not Activity).
    lifecycleCrm = new CrmService(
      app.get(PrismaService),
      feedBus,
      { checkLimit: async () => ({ allowed: true }) } as never,
      app.get(CrmTimelineService),
      { invalidateCache: () => undefined } as never,
      {} as never,
      { invalidateCache: () => undefined } as never,
      {} as never,
      { write: async () => undefined } as never,
      {} as never,
    );

    // The real contact-create service call (the CRM controller is not mounted
    // in this harness); its collaborators off the contact row and its event
    // are stubbed.
    crm = new CrmService(
      app.get(PrismaService),
      eventRecorder as never,
      { checkLimit: async () => ({ allowed: true }) } as never,
      app.get(CrmTimelineService),
      { invalidateCache: () => undefined } as never,
      {} as never,
      { invalidateCache: () => undefined } as never,
      {} as never,
      { write: async () => undefined } as never,
      {} as never,
    );

    // V55-09 / V55-10: the real booking create and confirm (the bookings
    // controller is not mounted in this harness). Real: Prisma (slot claim,
    // booking row) and the CRM contact event; the commerce, attribution,
    // subscription, e-mail, storefront and timeline collaborators are off
    // these two paths.
    bookings = new BookingsService(
      app.get(PrismaService),
      eventRecorder as never,
      crm,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }, 120_000);

  afterAll(async () => {
    if (feedModule) await feedModule.close();
  });

  it('wiring: the feed bus subscribes the full app\'s Activity writers to each event of the steps below (invoice.paid: ActivityEventListener, AutomationExecutorService, RevenueEventListener)', () => {
    for (const event of ['contact.created', 'invoice.created', 'invoice.sent', 'invoice.paid', 'booking.created', 'booking.confirmed']) {
      expect(feedBus.listeners(event).length, event).toBeGreaterThan(0);
    }
    expect(feedBus.listeners('invoice.paid')).toHaveLength(3);
  });

  it("V55-01 contact create: ActivityEventListener's crm created row ('New contact') for the contact; the contact.created flow is dispatched once. CHARACTERIZATION: the executor's own 'New contact added' row is still written (V55-08)", async () => {
    const s = await step(async () => {
      const contact = await crm.createContact({ businessId: C.biz, firstName: 'K19a', lastName: 'CustomerC', email: C.contactEmail, actorUserId: C.owner });
      SC.contactId = contact.id;
    });
    expect(s.events).toContain('contact.created');
    const created = s.rows.filter((r) => kind(r) === 'crm:created:contact' && r.entityId === SC.contactId);
    const listenerRow = created.filter((r) => r.title === 'New contact');
    expect(listenerRow, "ActivityEventListener's crm created row").toHaveLength(1);
    expect(listenerRow[0]).toMatchObject({ contactId: SC.contactId, detail: 'K19a CustomerC added to CRM' });
    // CHARACTERIZATION (V55-08 todo): the second crm created row, the executor's.
    expect(created.map((r) => r.title).sort(), 'crm created rows for the contact').toEqual(['New contact', 'New contact added']);
    // Every row the step wrote: those two and the CRM contact-event mirror (CrmService's own ContactEvent).
    expect(s.rows.map(kind).sort()).toEqual(['crm:contact.created:contact', 'crm:created:contact', 'crm:created:contact']);

    const runs = await runsOf('contact.created', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.contactId])).toEqual([[C.biz, 'contact.created', SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it('V55-02 invoice create (POST .../invoices): one commerce created row for the invoice', async () => {
    const s = await step(async () => {
      const res = await agent()
        .post(`/commerce/businesses/${C.biz}/invoices`)
        .set(HEADER, C.owner)
        .send({ contactId: SC.contactId, currency: 'TTD', items: [{ description: 'K19A C item', quantity: 1, unitPrice: INVOICE_C_TOTAL }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      SC.invoiceId = res.body.id;
      SC.invoiceNumber = res.body.invoiceNumber;
    });
    expect(SC.invoiceId).toBeTruthy();
    expect(s.events).toContain('invoice.created');
    const created = s.rows.filter((r) => kind(r) === 'commerce:created:invoice' && r.entityId === SC.invoiceId);
    expect(created, 'commerce created rows for the invoice').toHaveLength(1);
    expect(created[0]).toMatchObject({ title: `Invoice ${SC.invoiceNumber} created`, category: 'COMMERCE', contactId: SC.contactId });
    expect(cents(created[0].data.total)).toBe(cents(INVOICE_C_TOTAL));
    expect(s.rows.map(kind).sort()).toEqual(['commerce:created:invoice', 'crm:invoice.created:contact']);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-03 invoice send (PATCH .../status/sent): one commerce sent row for the invoice, ActivityEventListener's; the invoice.sent flow is dispatched once", async () => {
    const s = await step(async () => {
      const res = await agent()
        .patch(`/commerce/invoices/${SC.invoiceId}/status/sent`)
        .set(HEADER, C.owner)
        .send({ businessId: C.biz, status: 'SENT' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
    expect(s.events).toContain('invoice.sent');
    const sent = s.rows.filter((r) => kind(r) === 'commerce:sent:invoice' && r.entityId === SC.invoiceId);
    expect(sent.map((r) => r.title), 'commerce sent rows for the invoice').toEqual(['Invoice sent']);
    expect(sent[0]).toMatchObject({ detail: `Invoice ${SC.invoiceNumber} sent to K19a CustomerC`, contactId: SC.contactId });
    expect(s.rows.filter((r) => r.module === 'commerce').map(kind)).toEqual(['commerce:sent:invoice']);

    const runs = await runsOf('invoice.sent', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.invoiceId, r.ctx.contactId])).toEqual([[C.biz, 'invoice.sent', SC.invoiceId, SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it('V55-04 partial manual payment (100 of 300): its FINANCE payment_recorded row, no paid row; one posting; the feed writers add no ledger row', async () => {
    const s = await step(async () => {
      const res = await payAs(C.owner, C.biz, SC.invoiceId!, { amount: 100, method: 'cash', reference: `${P}${RUN}-c-partial` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      SC.partialId = res.body.payment.id;
    });
    expect((await db.invoice.findUnique({ where: { id: SC.invoiceId } })).status).toBe('PARTIALLY_PAID');
    expect(s.events).not.toContain('invoice.paid');
    const finance = s.rows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment');
    expect(finance.map((r) => r.entityId)).toEqual([SC.partialId]);
    expect(cents(finance[0].data.amount)).toBe(10_000);
    expect(s.rows.filter((r) => r.action === 'paid'), 'a partial payment settles nothing').toEqual([]);
    expect(s.rows.map(kind).sort()).toEqual(['FINANCE:payment_recorded:payment', 'crm:invoice.payment_recorded:contact']);

    expect(await postingsFor(C.biz, SC.partialId!), 'Payment:<id>:payment_recorded posting').toHaveLength(1);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-05 final manual payment (the remaining 200): its FINANCE row and ONE commerce paid row for the settled invoice, ActivityEventListener's ('Payment received'); the invoice.paid flow is dispatched once", async () => {
    const s = await step(async () => {
      const res = await payAs(C.owner, C.biz, SC.invoiceId!, { amount: 200, method: 'bank_transfer', reference: `${P}${RUN}-c-full` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      SC.fullId = res.body.payment.id;
    });
    expect((await db.invoice.findUnique({ where: { id: SC.invoiceId } })).status).toBe('PAID');
    expect(s.events.filter((e) => e === 'invoice.paid')).toHaveLength(1);

    const paid = s.rows.filter((r) => kind(r) === 'commerce:paid:invoice' && r.entityId === SC.invoiceId);
    expect(paid.map((r) => r.title), 'commerce paid rows for the settled invoice').toEqual(['Payment received']);
    expect(paid[0]).toMatchObject({ category: 'PAYMENT', contactId: SC.contactId });
    expect(cents(paid[0].data.total)).toBe(cents(INVOICE_C_TOTAL));
    const finance = s.rows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment');
    expect(finance.map((r) => r.entityId)).toEqual([SC.fullId]);
    expect(cents(finance[0].data.amount)).toBe(20_000);
    // Every Activity row the settling payment wrote (the two crm invoice.* rows
    // are the contact-event mirror, V55-07): no second paid row. Since
    // PR196-CRM-LIFECYCLE (D-81) the paid invoice also moves its LEAD contact
    // (createContact's default status) to CLIENT, and that move writes ONE row,
    // ActivityEventListener's status row on its contact.updated (D-08); its
    // follow-up task writes none (review CR-1 / SEC-L81-1).
    expect(s.rows.map(kind).sort()).toEqual([
      'FINANCE:payment_recorded:payment',
      'commerce:paid:invoice',
      'crm:invoice.paid:contact',
      'crm:invoice.payment_recorded:contact',
      'crm:updated:contact',
    ]);
    const moved = s.rows.filter((r) => kind(r) === 'crm:updated:contact');
    expect(moved[0]).toMatchObject({ entityId: SC.contactId, contactId: SC.contactId, title: 'Status changed' });
    expect(moved[0].data).toMatchObject({ from: 'LEAD', to: 'CLIENT' });
    const contactC = await db.contact.findUnique({ where: { id: SC.contactId }, select: { status: true, ownerId: true } });
    expect(contactC.status).toBe('CLIENT');
    const followUps = await db.contactTask.findMany({ where: { contactId: SC.contactId, source: 'lifecycle-automation' } });
    expect(followUps.map((t: any) => [t.businessId, t.status, t.assigneeId]), 'one D-81 follow-up').toEqual([[C.biz, 'OPEN', contactC.ownerId]]);

    const runs = await runsOf('invoice.paid', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.invoiceId, r.ctx.contactId, cents(r.ctx.total)])).toEqual([
      [C.biz, 'invoice.paid', SC.invoiceId, SC.contactId, cents(INVOICE_C_TOTAL)],
    ]);
    // The executor's built-in invoice.paid rule still runs. CHARACTERIZATION (review CR-2, the
    // packet's L-13 todo; an owner decision): its built-in stage-change rule also runs on the D-81
    // move's contact.updated, as on every status change, asking for a second, unassigned task.
    expect(crmTasks.map((t) => [t.businessId, t.contactId, t.title]).sort()).toEqual([
      [C.biz, SC.contactId, 'Follow up after stage change'],
      [C.biz, SC.contactId, 'Send thank-you note'],
    ]);

    expect(await postingsFor(C.biz, SC.fullId!), 'Payment:<id>:payment_recorded posting').toHaveLength(1);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-09 booking create (BookingsService.createBooking): the feed says when the booking is: the executor's bookings created row ('New booking from <contact>', detail the start time) beside ActivityEventListener's ('New booking', no date or time; kept, V55-11); the booking.created flow is dispatched once", async () => {
    const s = await step(async () => {
      const booking = await bookings.createBooking({
        businessId: C.biz,
        contactId: SC.contactId,
        serviceId: BOOKING_C.serviceId,
        startTime: BOOKING_C.start,
        endTime: BOOKING_C.end,
        actorUserId: C.owner,
      });
      SC.bookingId = booking.id;
    });
    expect(SC.bookingId).toBeTruthy();
    expect(s.events).toContain('booking.created');
    const created = s.rows.filter((r) => kind(r) === 'bookings:created:booking' && r.entityId === SC.bookingId);
    const when = new Date(BOOKING_C.start).toLocaleString();
    const timed = created.filter((r) => r.detail === when);
    expect(timed, `a bookings created row whose detail is the start time (${when})`).toHaveLength(1);
    expect(timed[0]).toMatchObject({ title: 'New booking from K19a CustomerC', contactId: SC.contactId });
    // CHARACTERIZATION (V55-11 todo): ActivityEventListener's row, with no date or time.
    expect(created.map((r) => [r.title, r.detail]).sort(), 'bookings created rows for the booking').toEqual(
      [
        ['New booking', 'K19a CustomerC booked an appointment'],
        ['New booking from K19a CustomerC', when],
      ].sort(),
    );
    // Every row the step wrote: those two and the CRM contact-event mirror (V55-07).
    expect(s.rows.map(kind).sort()).toEqual(['bookings:created:booking', 'bookings:created:booking', 'crm:booking.created:contact']);

    const runs = await runsOf('booking.created', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.bookingId, r.ctx.contactId])).toEqual([[C.biz, 'booking.created', SC.bookingId, SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-10 booking confirm (BookingsService.confirmBooking): ONE bookings confirmed row, ActivityEventListener's ('Booking confirmed', the contact); the booking.confirmed flow is dispatched once", async () => {
    const s = await step(async () => {
      const booking = await bookings.confirmBooking(SC.bookingId);
      expect(booking.status).toBe('CONFIRMED');
    });
    expect(s.events).toContain('booking.confirmed');
    const confirmed = s.rows.filter((r) => kind(r) === 'bookings:confirmed:booking' && r.entityId === SC.bookingId);
    expect(confirmed.map((r) => r.title), 'bookings confirmed rows for the booking').toEqual(['Booking confirmed']);
    expect(confirmed[0]).toMatchObject({ detail: 'Appointment confirmed', contactId: SC.contactId });
    expect(s.rows.map(kind).sort()).toEqual(['bookings:confirmed:booking', 'crm:booking.confirmed:contact']);

    const runs = await runsOf('booking.confirmed', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.bookingId, r.ctx.contactId])).toEqual([[C.biz, 'booking.confirmed', SC.bookingId, SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-06 C's feed, read as the cockpit reads it, shows each step's row once; each flow ran once; LEDGER: C holds exactly the two payment postings, balanced, summing to the invoice", async () => {
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows: Row[] = res.body;
    expect(rows.every((r: any) => r.businessId === C.biz)).toBe(true);
    const count = (k: string, entityId: string | undefined) => rows.filter((r) => kind(r) === k && r.entityId === entityId).length;
    // CHARACTERIZATION (V55-08 todo): contact create still shows twice.
    expect(count('crm:created:contact', SC.contactId), 'contact created').toBe(2);
    expect(count('commerce:created:invoice', SC.invoiceId), 'invoice created').toBe(1);
    expect(count('commerce:sent:invoice', SC.invoiceId), 'invoice sent').toBe(1);
    expect(count('commerce:paid:invoice', SC.invoiceId), 'invoice paid').toBe(1);
    expect(count('FINANCE:payment_recorded:payment', SC.partialId), 'partial payment').toBe(1);
    expect(count('FINANCE:payment_recorded:payment', SC.fullId), 'final payment').toBe(1);
    // CHARACTERIZATION (V55-11 todo): booking create still shows twice; the executor's row is the one with the start time.
    expect(count('bookings:created:booking', SC.bookingId), 'booking created').toBe(2);
    expect(
      rows.filter((r) => kind(r) === 'bookings:created:booking' && r.entityId === SC.bookingId && r.detail === new Date(BOOKING_C.start).toLocaleString()),
      'the booking created row with the start time',
    ).toHaveLength(1);
    expect(count('bookings:confirmed:booking', SC.bookingId), 'booking confirmed').toBe(1);

    expect(flowRuns.map((r) => r.flowId).sort()).toEqual(FLOW_TRIGGERS.map(flowId).sort());

    const txns = await db.financialTransaction.findMany({ where: { businessId: C.biz }, orderBy: { createdAt: 'asc' } });
    expect(txns.map((t: any) => t.externalRef)).toEqual([
      `Payment:${SC.partialId}:payment_recorded`,
      `Payment:${SC.fullId}:payment_recorded`,
    ]);
    const entries = await db.ledgerEntry.findMany({ where: { businessId: C.biz } });
    const txnIds = new Set(txns.map((t: any) => t.id));
    expect(entries.filter((e: any) => !txnIds.has(e.transactionId)), 'ledger entries outside the two postings').toEqual([]);
    let total = 0;
    for (const t of txns) {
      const own = entries.filter((e: any) => e.transactionId === t.id);
      const debit = own.reduce((sum: number, e: any) => sum + cents(e.debit ?? 0), 0);
      const credit = own.reduce((sum: number, e: any) => sum + cents(e.credit ?? 0), 0);
      expect(debit, `${t.externalRef} balanced`).toBe(credit);
      expect(debit).toBe(cents(t.amount));
      total += cents(t.amount);
    }
    expect(total).toBe(cents(INVOICE_C_TOTAL));
  });

  // The fourth writer the lane finding named, located: every ContactEvent is
  // mirrored into Activity by CrmTimelineService.logEvent
  // (crm-timeline.service.ts:106 -> timeline.service.ts:51), so the payment's
  // ContactEvent (CommerceService.recordPayment) copies the FINANCE row and
  // RevenueEventListener.onInvoicePaid's ContactEvent
  // (revenue-event.listener.ts:198) copies the paid row (V55-04 / V55-05 pin
  // them). Removing or folding the mirror changes the CRM timeline, outside
  // V1-55's write set (automation-executor.service.ts only).
  it.todo("V55-07: a settling manual payment writes no CRM contact-event mirror row (crm:invoice.payment_recorded:contact, crm:invoice.paid:contact) beside its FINANCE row and the one commerce paid row: needs crm-timeline.service.ts / revenue-event.listener.ts (outside V1-55's write set)");
  it.todo("V55-11: booking create writes one bookings created row, and it carries the booking's start time: AutomationExecutorService.onBookingCreated's row is kept (review repair CR-V155-1) because ActivityEventListener.onBookingCreated (activity-event.listener.ts:225, outside V1-55's write set) builds its detail from booking.service?.name, which no booking.created payload carries, so its row has no date or time; removing the executor row needs that listener to put the start time in its detail");
  it.todo("V55-08: contact create writes one crm created row (ActivityEventListener's 'New contact'): AutomationExecutorService.onContactCreated's 'New contact added' row is kept because log-redaction.integration.test.ts:758-762 (outside V1-55's write set) mounts the executor without ActivityEventListener and counts exactly that row as proof its contact.created listener ran; removing it needs that test to mount ActivityEventListener or read another signal");
});
