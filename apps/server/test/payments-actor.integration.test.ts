/**
 * R0-PL-07-PAYMENT-ACTOR — the acting user is recorded on manual payments and
 * refunds (REAL database, REAL ledger posting, REAL contact timeline).
 *
 * Payments lane PK-PL-07 / PL-F12: Payment.recordedBy exists in the schema and
 * was never written on the manual path; the ledger posting's
 * FinancialTransaction.createdById, the refund reversal's createdById and the
 * contact timeline event carried no actor either. Release 0 needs an audit
 * trail for the manual payment.
 *
 * Contract pinned here:
 *
 *   POST /commerce/businesses/:b/invoices/:id/payments by user U
 *     -> Payment.recordedBy = U                                  (fresh Prisma read)
 *     -> posting FinancialTransaction.createdById = U            (column exists on the model)
 *     -> ContactEvent invoice.payment_recorded: actorId U, actorType USER, data.recordedBy U
 *        and the unified activity entry it writes carries actorId U
 *   the same route by user V (STAFF, revenue:write)  -> V on every one of the above
 *   idempotent replay (R0-D2) by V of U's key       -> U's row, recordedBy still U, nothing new written
 *   POST /commerce/businesses/:b/payments/:id/refund by user V
 *     -> the reversal FinancialTransaction.createdById = V (the manual refund
 *        has no separate refund Payment row: it flips the original to REFUNDED)
 *     -> Payment.recordedBy stays U (who recorded the receipt is not overwritten)
 *   KEY cortex adapter process_payment               -> KEY_SYSTEM_ACTOR_ID, actorType SYSTEM
 *   PaymentEvidenceService (POST .../payments/from-evidence) -> KEY_SYSTEM_ACTOR_ID, actorType SYSTEM
 *   internal caller passing no actor (drive intake)  -> recordedBy null (no invented actor)
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService,
 * PaymentEvidenceService and CrmTimelineService write real rows, and the
 * production GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-pya-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. Document intelligence (the AI
 * boundary), Gmail, vision, stats cache and the unified activity timeline are
 * stubs off the boundary (the activity stub records what it is handed).
 *
 * Fixtures: prefix `pya_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
// Type-only: erased at runtime, so the dynamic-import order below (dotenv
// before anything that reads DATABASE_URL) is unchanged.
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { CommerceAdapterService } from '../src/modules/key-cortex/adapters/commerce-adapter.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'pya_';
const HEADER = 'x-pya-user';
/** Mirrors KEY_SYSTEM_ACTOR_ID (src/core/auth/system-actor.ts); asserted equal below. */
const KEY_ACTOR = 'key_ai';

const ID = {
  userU: `${P}userU`,
  userV: `${P}userV`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  // one invoice per case so balances never bleed between cases
  invU: `${P}invU`,
  invV: `${P}invV`,
  invReplay: `${P}invReplay`,
  invRefund: `${P}invRefund`,
  invKey: `${P}invKey`,
  invEvidence: `${P}invEvidence`,
  invNoActor: `${P}invNoActor`,
};

const INVOICE_TOTAL = 100;

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
let adapter: CommerceAdapterService;
let systemActorId: string;

// PaymentEvidenceService is the real one over the real CommerceService;
// document intelligence (the AI boundary) is the stub and returns what the
// next receipt "says".
let nextExtraction: Record<string, unknown> = {};
const docIntelStub = { extractFromDocument: async () => nextExtraction };

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

// The unified activity ledger (TimelineService) is off the boundary; it
// records what CrmTimelineService.logEvent and RevenuePostingService hand it.
const activity: Array<Record<string, any>> = [];
const timelineStub = {
  recordEvent: async (input: Record<string, any>) => {
    activity.push(input);
    return null;
  },
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM ledger_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_transactions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payments WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM payment_links WHERE business_id LIKE '${P}%' OR invoice_id LIKE '${P}%'`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE '${P}%'`,
    `DELETE FROM invoices WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%' OR user_id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

const route = (inv: string) => `/commerce/businesses/${ID.biz}/invoices/${inv}/payments`;

function postAs(user: string, inv: string, body: Record<string, unknown>) {
  return agent().post(route(inv)).set(HEADER, user).send(body);
}

function refundAs(user: string, paymentId: string, reason = 'pya test refund') {
  return agent().post(`/commerce/businesses/${ID.biz}/payments/${paymentId}/refund`).set(HEADER, user).send({ reason });
}

/** Fresh read of the Payment row (never the HTTP response). */
async function paymentRow(id: string): Promise<any> {
  return db.payment.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

/** The ledger transaction posted for a payment row (FIN2 externalRef). */
async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded` },
  });
}

/** The reversal PostingService.reverse writes for a refunded payment's posting. */
async function reversalsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded:reversal` },
  });
}

/** ContactEvent rows of a type for one invoice (fresh read). */
async function contactEventsFor(invoiceId: string, type = 'invoice.payment_recorded'): Promise<any[]> {
  const rows = await db.contactEvent.findMany({
    where: { businessId: ID.biz, contactId: ID.contact, type },
    orderBy: { createdAt: 'asc' },
  });
  return rows.filter((r: any) => (r.data as any)?.invoiceId === invoiceId);
}

function crmActivityFor(invoiceId: string): Array<Record<string, any>> {
  return activity.filter((a) => a.module === 'crm' && a.action === 'invoice.payment_recorded' && a.data?.invoiceId === invoiceId);
}

/** One posting for this payment, attributed to `actor`. */
async function expectPostingBy(paymentId: string, actor: string | null) {
  const txns = await postingsFor(paymentId);
  expect(txns, `postings for ${paymentId}`).toHaveLength(1);
  expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
  expect(txns[0].createdById, `posting creator for ${paymentId}`).toBe(actor);
}

/** One invoice.payment_recorded ContactEvent for this invoice, attributed to `actor`. */
async function expectContactEventBy(invoiceId: string, actor: string, actorType: 'USER' | 'SYSTEM') {
  const events = await contactEventsFor(invoiceId);
  expect(events, `contact events for ${invoiceId}`).toHaveLength(1);
  expect(events[0]).toMatchObject({ actorId: actor, actorType, source: 'commerce' });
  expect((events[0].data as any).recordedBy).toBe(actor);
  const act = crmActivityFor(invoiceId);
  expect(act, `crm activity for ${invoiceId}`).toHaveLength(1);
  expect(act[0]).toMatchObject({ actorId: actor, actorType });
}

beforeAll(async () => {
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
  const { KEY_SYSTEM_ACTOR_ID } = await import('../src/core/auth/system-actor');
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
  const { CommerceAdapterService } = await import('../src/modules/key-cortex/adapters/commerce-adapter.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  systemActorId = KEY_SYSTEM_ACTOR_ID;

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
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
      // Real ledger chain: the proof is the creator column on the posted rows.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventStub },
      // Real contact timeline: CommerceService only calls
      // CrmService.logContactEvent, which delegates to CrmTimelineService.
      CrmTimelineService,
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
      { provide: TimelineService, useValue: timelineStub },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      // The real PaymentEvidenceService over the real CommerceService; AI
      // extraction and the Drive download are the stubs.
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: docIntelStub },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  // The KEY cortex adapter, constructed exactly as KeyCortexModule wires it.
  adapter = new CommerceAdapterService(commerce);

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

  await db.user.create({ data: { id: ID.userU, email: `${ID.userU}@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userV, email: `${ID.userV}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'PYA Biz', ownerId: ID.userU, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_userU`, userId: ID.userU, businessId: ID.biz, role: 'OWNER' } });
  // V is a second human with revenue:write, so "the actor" is never just "the owner".
  await db.membership.create({
    data: { id: `${P}m_userV`, userId: ID.userV, businessId: ID.biz, role: 'STAFF', permissionScopes: { revenue: 'write' } },
  });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Pya', lastName: 'Customer', email: `${P}c@test.local` } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `PYA-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: INVOICE_TOTAL,
        total: INVOICE_TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `PYA item ${n}`, quantity: 1, unitPrice: INVOICE_TOTAL, total: INVOICE_TOTAL }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

beforeEach(() => {
  activity.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('seeded two humans with revenue:write, a system chart of accounts and one SENT invoice per case; the KEY actor id is the shared constant', async () => {
    expect(systemActorId).toBe(KEY_ACTOR);
    const members = await db.membership.findMany({ where: { businessId: ID.biz }, orderBy: { userId: 'asc' } });
    expect(members.map((m: any) => [m.userId, m.role])).toEqual([[ID.userU, 'OWNER'], [ID.userV, 'STAFF']]);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } })).toBeGreaterThan(0);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
    }
  });
});

describe('manual payment through the HTTP route records the acting user', () => {
  it('PA-01: user U records -> Payment.recordedBy = U (fresh read), posting createdById = U, contact event and activity actorId U', async () => {
    const res = await postAs(ID.userU, ID.invU, { amount: 40, method: 'cash', reference: 'PYA-U-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const row = await paymentRow(paymentId);
    expect(row).toMatchObject({ invoiceId: ID.invU, businessId: ID.biz, status: 'SUCCESSFUL', amount: 40 });
    expect(row.recordedBy).toBe(ID.userU);
    await expectPostingBy(paymentId, ID.userU);
    await expectContactEventBy(ID.invU, ID.userU, 'USER');
  });

  it('PA-02: user V (STAFF, revenue:write) records -> every audit column names V, not the owner', async () => {
    const res = await postAs(ID.userV, ID.invV, { amount: 25, method: 'bank_transfer', reference: 'PYA-V-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    expect((await paymentRow(paymentId)).recordedBy).toBe(ID.userV);
    await expectPostingBy(paymentId, ID.userV);
    await expectContactEventBy(ID.invV, ID.userV, 'USER');
  });

  it('PA-03: a client-sent recordedBy / actorId in the body never overrides the authenticated actor', async () => {
    const res = await postAs(ID.userV, ID.invV, {
      amount: 5, method: 'cash', reference: 'PYA-V-2', recordedBy: ID.userU, actorId: ID.userU,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await paymentRow(res.body.payment.id)).recordedBy).toBe(ID.userV);
    await expectPostingBy(res.body.payment.id, ID.userV);
  });
});

describe('idempotent replay (R0-D2) keeps the original recorder', () => {
  it('PA-04: U records with key K; V replays K -> 201 with U\'s row, recordedBy still U, no new row, posting or contact event', async () => {
    const body = { amount: 30, method: 'cash', idempotencyKey: 'pya-key-1' };
    const first = await postAs(ID.userU, ID.invReplay, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const replay = await postAs(ID.userV, ID.invReplay, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.payment.recordedBy).toBe(ID.userU);

    const rows = await paymentsOf(ID.invReplay);
    expect(rows).toHaveLength(1);
    expect(rows[0].recordedBy).toBe(ID.userU);
    await expectPostingBy(first.body.payment.id, ID.userU);
    const events = await contactEventsFor(ID.invReplay);
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(ID.userU);
  });
});

describe('refund through the HTTP route records the refunding user', () => {
  it('PA-05: U records, V refunds -> reversal createdById = V; Payment REFUNDED with recordedBy still U; original posting still U', async () => {
    const res = await postAs(ID.userU, ID.invRefund, { amount: 60, method: 'cash', reference: 'PYA-R-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const paymentId = res.body.payment.id;

    const refunded = await refundAs(ID.userV, paymentId);
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body.status).toBe('REFUNDED');

    const row = await paymentRow(paymentId);
    expect(row.status).toBe('REFUNDED');
    // The manual refund flips the original row; there is no separate refund
    // Payment row and no refundedBy column, so the recorder stays U.
    expect(row.recordedBy).toBe(ID.userU);
    expect(await paymentsOf(ID.invRefund)).toHaveLength(1);

    const reversals = await reversalsFor(paymentId);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ type: 'REVERSAL', status: 'POSTED', sourceType: 'Payment', sourceId: paymentId });
    expect(reversals[0].createdById).toBe(ID.userV);

    const original = await postingsFor(paymentId);
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({ status: 'REVERSED', createdById: ID.userU });
    expect(reversals[0].reversalOfId).toBe(original[0].id);
  });
});

describe('KEY and evidence paths record the system actor, distinct from a human', () => {
  it('PA-06: KEY cortex adapter process_payment -> recordedBy KEY_SYSTEM_ACTOR_ID, posting createdById KEY, contact event SYSTEM', async () => {
    const result = await adapter.execute({
      module: 'commerce',
      action: 'process_payment',
      parameters: { invoiceId: ID.invKey, amount: 15, method: 'cash', reference: 'PYA-K-1' },
      businessId: ID.biz,
      userId: ID.userU,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: `${P}corr_1`,
    } as any);
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = await paymentsOf(ID.invKey);
    expect(rows).toHaveLength(1);
    expect(rows[0].recordedBy).toBe(KEY_ACTOR);
    expect(rows[0].recordedBy).not.toBe(ID.userU);
    await expectPostingBy(rows[0].id, KEY_ACTOR);
    await expectContactEventBy(ID.invKey, KEY_ACTOR, 'SYSTEM');
  });

  it('PA-07: POST .../payments/from-evidence (PaymentEvidenceService) -> recordedBy KEY_SYSTEM_ACTOR_ID, posting createdById KEY, contact event SYSTEM', async () => {
    nextExtraction = {
      documentType: 'receipt',
      confidence: 0.92,
      invoiceData: { total: 45, invoiceNumber: 'PYA-EVID-1', notes: 'bank transfer' },
    };
    const res = await agent()
      .post(`/commerce/businesses/${ID.biz}/invoices/${ID.invEvidence}/payments/from-evidence`)
      .set(HEADER, ID.userU)
      .send({ evidenceUrl: 'https://evidence.test/pya.pdf', evidenceMimeType: 'application/pdf', filename: 'pya.pdf', source: 'upload' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const rows = await paymentsOf(ID.invEvidence);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 45, evidenceUrl: 'https://evidence.test/pya.pdf' });
    expect(rows[0].recordedBy).toBe(KEY_ACTOR);
    await expectPostingBy(rows[0].id, KEY_ACTOR);
    await expectContactEventBy(ID.invEvidence, KEY_ACTOR, 'SYSTEM');
  });

  it('PA-08: an internal caller that passes no actor (drive intake) records recordedBy null; no actor is invented', async () => {
    const result = await commerce.recordPayment(ID.invNoActor, ID.biz, { amount: 10, method: 'cash', reference: 'PYA-N-1' });
    const row = await paymentRow(result.payment.id);
    expect(row.recordedBy).toBeNull();
    await expectPostingBy(result.payment.id, null);
  });
});
