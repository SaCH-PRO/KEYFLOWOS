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
 *
 * CHARACTERIZATION ONLY (not a contract; V1-55 / D-08 own the dedupe):
 *   the Activity rows each payment writes in this harness, and the domain events
 *   it puts on the bus (which, in the full app, also drive the listener writers
 *   activity-event.listener.ts and automation-executor.service.ts; those are not
 *   wired here). An idempotent replay of a payment writes a second payment.record
 *   row for the same payment (the interceptor cannot tell a replay from a record).
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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k19a_';
const HEADER = 'x-k19a-user';
/** Per-run tag: ids differ between runs, so a stale queued audit job cannot hit them. */
const RUN = Date.now().toString(36);

const ID = {
  ownerA: `${P}${RUN}_ownerA`,
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

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.ownerA, email: `${P}${RUN}_ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}${RUN}_ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'K19A Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'K19A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
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
    try {
      const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
      const queue = app.get(BusinessEventQueueService).queue;
      await waitFor(
        () => queue.getJobCounts('waiting', 'active', 'delayed'),
        (c: Record<string, number>) => (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0) === 0,
        5_000,
      );
    } catch { /* best-effort */ }
    await app.close();
  }
  if (db) await cleanup();
  if (redis) await redis.quit();
}, 60_000);

describe('fixture sanity (real rows)', () => {
  it('two tenants, each with an OWNER, a system chart of accounts and one SENT invoice; no payment, posting, audit or Activity row yet', async () => {
    for (const [biz, owner, inv] of [[ID.bizA, ID.ownerA, ID.invA], [ID.bizB, ID.ownerB, ID.invB]]) {
      const members = await db.membership.findMany({ where: { businessId: biz } });
      expect(members.map((m: any) => [m.userId, m.role])).toEqual([[owner, 'OWNER']]);
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

    const reference = `${P}${RUN}-partial`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 100, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.partialId = res.body.payment.id;
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
    expect(bus.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
  });

  it('EF-02: full payment (the remaining 150) by the owner -> PAID; the same pins for the second payment', async () => {
    const auditBefore = (await auditRows(ID.bizA)).length;
    const activityBefore = (await activityRows(ID.bizA)).length;
    bus.length = 0;

    const reference = `${P}${RUN}-full`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 150, method: 'bank_transfer', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.fullId = res.body.payment.id;
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
    expect(bus.map((e) => e.name)).toEqual(['invoice.paid']);
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

describe('CHARACTERIZATION: idempotent replay of a recorded payment (R0-D2), not a contract', () => {
  it('EF-08: replaying the partial payment (same reference + amount) returns the same Payment, writes no payment, posting or ContactEvent, and writes a second payment.record row for that payment', async () => {
    const auditBefore = (await auditRows(ID.bizA)).length;
    const txnsBefore = await db.financialTransaction.count({ where: { businessId: ID.bizA } });
    const reference = `${P}${RUN}-partial`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 100, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment.id).toBe(S.partialId);

    expect(await db.payment.count({ where: { invoiceId: ID.invA } })).toBe(2);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA } })).toBe(txnsBefore);
    expect(await contactEventsFor(ID.bizA, ID.contactA, reference)).toHaveLength(1);

    const audit = await newAuditRows(ID.bizA, auditBefore);
    expect(audit.map((r) => [r.eventType, r.subjectId])).toEqual([['payment.record', S.partialId]]);
  });
});
