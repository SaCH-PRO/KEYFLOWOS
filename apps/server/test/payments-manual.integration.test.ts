/**
 * R0-PL-03-PAYMENT-ATOMIC-RECONCILE — the manual payment and the refund
 * reconcile the invoice inside their own transaction (REAL database, REAL
 * ledger posting, REAL invoice workflow).
 *
 * Gap report G3 / G12 (docs/reconstruction/product/evidence/REVENUE-GAP-REPORT-001.md),
 * payments lane PK-PL-03 (PL-F04, PL-F08, PL-F13), module proofs PL-P04,
 * PL-P05, PL-P08, PL-P10:
 *
 *   G3   recordPayment committed the Payment row and its deposit posting in one
 *        $transaction and called reconcileFromPayments after it. A DRAFT
 *        invoice therefore got a committed payment and ledger entries, then
 *        the DRAFT -> PARTIALLY_PAID / PAID transition threw 409: money on the
 *        books against an invoice that still says DRAFT, and an error to the
 *        client. A crash between the two left a stale status.
 *   G12  markPaymentRefunded swallowed the reconcile error with
 *        `.catch(() => null)`: the invoice kept its old status, the caller
 *        got 201.
 *
 * Contract pinned here:
 *
 *   POST .../invoices/:draft/payments            -> 409; zero Payment and zero FinancialTransaction rows for that invoice
 *   internal recordPayment on a DRAFT invoice    -> ConflictException; nothing written (KEY adapter, evidence, drive intake share it)
 *   deposit posting throws (RevenuePostingService.onPaymentRecorded)
 *                                                -> 500; no Payment row, no posting, invoice status unchanged
 *   reconcile throws inside the payment (spy)    -> 500; no Payment row, no posting, invoice status unchanged
 *   COGS posting throws while the payment settles the invoice (reconcile -> PAID)
 *                                                -> 500; no Payment row, no posting, invoice still SENT, no event
 *   partial then full payment                    -> invoice.payment_recorded then invoice.paid, each exactly once,
 *                                                   emitted after commit (a fresh read at emit time already sees them)
 *   idempotent replay (R0-D2), sequential and concurrent -> no new event
 *   two concurrent payments that together settle the invoice -> PAID, one invoice.paid
 *   refund of a non-SUCCESSFUL payment           -> refused, nothing changes. The packet says 400; R0-PL-07
 *                                                   (PA-10 / PA-11 in payments-actor) pinned 409, which is kept.
 *   reconcile throws during a refund (spy)       -> the error is the response (500); the refund rolls back with it:
 *                                                   payment SUCCESSFUL, no reversal, invoice status unchanged, no event
 *   refund that reopens a PAID invoice           -> 201; PARTIALLY_PAID; one reversal; one event after commit
 *
 * Review repairs (R0-PL-03 review). The race cases hold the request at the
 * invoice lock with a barrier on CommerceService.lockInvoiceForPayment, i.e.
 * after the pre-transaction guard has already passed:
 *
 *   ST-PL03-1 invoice voided / reverted to DRAFT before the lock -> 409 under the lock; nothing written
 *             invoice soft-deleted before the lock                -> 404 under the lock; nothing written
 *             two concurrent un-keyed full payments (KEY adapter) -> one PAID payment, the other 409 (PAID)
 *             two concurrent keyed full payments (same key)       -> one payment, both 201 with it (R0-D2 kept)
 *   ST-PL03-2 two concurrent payments: each response and contact audit event carries the totals read under
 *             the lock (totalPaid agrees with newStatus; an overpayment is flagged)
 *   ST-PL03-3 / CR-1 refund on a DRAFT (undoInvoice) or PARTIALLY_CREDITED invoice that keeps a net
 *             balance -> 201; refunded and reversed; status left as it is (no legal transition); no event
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows, and the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Identity attachment is the one stand-in: a test middleware reads
 * `x-pym-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recording spy; ExpensePostingService (COGS) is a stub whose failure can be
 * switched on; the contact timeline, stats cache and the AI / Gmail / Drive
 * services are stubs off the boundary. Failures are injected with vi.spyOn on
 * the real service instances and restored after each case.
 *
 * Fixtures: prefix `pym_`; hard-deleted by raw SQL in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';
import type { RevenuePostingService } from '../src/modules/finance/revenue-posting.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'pym_';
const HEADER = 'x-pym-user';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  product: `${P}product`,
  // one invoice per case so balances never bleed between cases
  invDraft: `${P}invDraft`,
  invDraftFull: `${P}invDraftFull`,
  invDraftInternal: `${P}invDraftInternal`,
  invPostFail: `${P}invPostFail`,
  invReconcileFail: `${P}invReconcileFail`,
  invCogsFail: `${P}invCogsFail`,
  invEvents: `${P}invEvents`,
  invReplay: `${P}invReplay`,
  invReplayRace: `${P}invReplayRace`,
  invConcurrent: `${P}invConcurrent`,
  invNotRefundable: `${P}invNotRefundable`,
  invRefundFail: `${P}invRefundFail`,
  invRaceVoid: `${P}invRaceVoid`,
  invRaceDraft: `${P}invRaceDraft`,
  invRaceDeleted: `${P}invRaceDeleted`,
  invRaceDouble: `${P}invRaceDouble`,
  invRaceKeyed: `${P}invRaceKeyed`,
  invRaceAudit: `${P}invRaceAudit`,
  invRaceOver: `${P}invRaceOver`,
  invRefundDraft: `${P}invRefundDraft`,
  invRefundCredited: `${P}invRefundCredited`,
};

const INVOICE_TOTAL = 100;
/** Invoices created DRAFT; every other fixture invoice is SENT. */
const DRAFT_INVOICES = new Set<string>([ID.invDraft, ID.invDraftFull, ID.invDraftInternal]);
/** Invoices whose single line item is a product, so PAID posts COGS. */
const PRODUCT_INVOICES = new Set<string>([ID.invCogsFail]);
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_recorded']);

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
/** The CommerceService class itself: lockInvoiceForPayment is a static on it. */
let CommerceServiceClass: any;
let workflow: InvoiceWorkflowService;
let revenuePosting: RevenuePostingService;

/**
 * Recording EventEmitter2. For the two invoice payment events it also starts a
 * fresh read of the invoice at emit time, on the shared client outside any
 * transaction: if the event were emitted before its transaction committed,
 * that read would not see the payment or the new status.
 */
type Emitted = { name: string; payload: any; seen: Promise<{ status: string; paymentIds: string[] } | null> };
const emitted: Emitted[] = [];
const eventStub = {
  emit: (name: string, payload: any) => {
    const invoiceId: string | undefined = payload?.invoice?.id;
    const seen = INVOICE_EVENTS.has(name) && invoiceId
      ? db.invoice
          .findUnique({ where: { id: invoiceId }, include: { payments: true } })
          .then((inv: any) => (inv ? { status: inv.status, paymentIds: inv.payments.map((p: any) => p.id) } : null))
      : Promise.resolve(null);
    emitted.push({ name, payload, seen });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Contact timeline audit events (CrmService.logContactEvent is a recording stub). */
const contactEvents: any[] = [];

// COGS (FIN3) runs inside the reconcile when an invoice goes PAID; the stub
// fails on demand so a failure *inside the reconcile* can be injected.
let failCogs = false;
const expensePostingStub = {
  onProductSold: async () => {
    if (failCogs) throw new Error('pym injected COGS posting failure');
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
    `DELETE FROM products WHERE business_id LIKE '${P}%'`,
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

function pay(inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/payments`).set(HEADER, ID.owner).send(body);
}

function refund(paymentId: string, reason = 'pym test refund') {
  return agent().post(`/commerce/businesses/${ID.biz}/payments/${paymentId}/refund`).set(HEADER, ID.owner).send({ reason });
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

/** Every FinancialTransaction for this invoice's payments (fresh read; payment postings carry the invoice number as reference). */
async function paymentPostingsOf(invoiceId: string): Promise<any[]> {
  const inv = await invoiceRow(invoiceId);
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceType: 'Payment', reference: inv.invoiceNumber },
  });
}

async function reversalsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: `Payment:${paymentId}:payment_recorded:reversal` },
  });
}

function invoiceEventsFor(invoiceId: string): Emitted[] {
  return emitted.filter((e) => INVOICE_EVENTS.has(e.name) && e.payload?.invoice?.id === invoiceId);
}

/** The invoice is exactly as seeded: no payment, no payment posting, status unchanged. */
async function expectUntouched(invoiceId: string, status: string) {
  expect(await paymentsOf(invoiceId), `payments of ${invoiceId}`).toHaveLength(0);
  expect(await paymentPostingsOf(invoiceId), `postings of ${invoiceId}`).toHaveLength(0);
  expect((await invoiceRow(invoiceId)).status, `status of ${invoiceId}`).toBe(status);
  expect(invoiceEventsFor(invoiceId), `events of ${invoiceId}`).toHaveLength(0);
}

/**
 * Barrier on CommerceService.lockInvoiceForPayment, the first statement of the
 * payment / refund transaction and so after the pre-transaction guard: hold
 * every call until `n` have arrived, then run `before` once (a change another
 * request commits in the gap), then take the real lock.
 */
function holdAtLock(n: number, before?: () => Promise<unknown>) {
  const original = CommerceServiceClass.lockInvoiceForPayment;
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let ran: Promise<unknown> | null = null;
  return vi.spyOn(CommerceServiceClass, 'lockInvoiceForPayment').mockImplementation(async (...args: any[]) => {
    arrived += 1;
    if (arrived >= n) open();
    await gate;
    if (before) {
      ran ??= before();
      await ran;
    }
    return original.apply(CommerceServiceClass, args);
  });
}

function auditsFor(invoiceId: string): any[] {
  return contactEvents.filter((e) => e.type === 'invoice.payment_recorded' && e.data?.invoiceId === invoiceId);
}

/** Each event was emitted after its transaction committed: a fresh read at emit time already saw the event's status and payment. */
async function expectEmittedAfterCommit(event: Emitted, paymentId: string) {
  const seen = await event.seen;
  expect(seen, `${event.name} fresh read`).not.toBeNull();
  expect(seen!.status, `${event.name}: status visible at emit time`).toBe(event.payload.invoice.status);
  expect(seen!.paymentIds, `${event.name}: payment visible at emit time`).toContain(paymentId);
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
      // Real ledger chain: the proof is the rows it posts (or does not).
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: expensePostingStub },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async (e: any) => { contactEvents.push(e); return null; } } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  commerce = moduleRef.get(CommerceService);
  CommerceServiceClass = CommerceService;
  workflow = moduleRef.get(InvoiceWorkflowService);
  revenuePosting = moduleRef.get(RevenuePostingService);

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

  await db.user.create({ data: { id: ID.owner, email: `${ID.owner}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'PYM Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'Pym', lastName: 'Customer', email: `${P}c@test.local` } });
  await db.product.create({ data: { id: ID.product, businessId: ID.biz, name: 'PYM widget', price: INVOICE_TOTAL, category: 'PRODUCT' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `PYM-${String(n).padStart(3, '0')}`,
        status: DRAFT_INVOICES.has(id) ? 'DRAFT' : 'SENT',
        subtotal: INVOICE_TOTAL,
        total: INVOICE_TOTAL,
        currency: 'TTD',
        businessId: ID.biz,
        contactId: ID.contact,
        items: {
          create: [{
            id: `${id}_item1`,
            description: `PYM item ${n}`,
            quantity: 1,
            unitPrice: INVOICE_TOTAL,
            total: INVOICE_TOTAL,
            productId: PRODUCT_INVOICES.has(id) ? ID.product : null,
          }],
        },
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
  emitted.length = 0;
  contactEvents.length = 0;
  failCogs = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  failCogs = false;
});

describe('fixture sanity (real rows)', () => {
  it('seeded an owner, a system chart of accounts, DRAFT and SENT invoices with no payments', async () => {
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz, isSystem: true } })).toBeGreaterThan(0);
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
      expect((await invoiceRow(id)).status, id).toBe(DRAFT_INVOICES.has(id) ? 'DRAFT' : 'SENT');
    }
  });
});

describe('G3: a payment on a DRAFT invoice is refused and writes nothing', () => {
  it('PM-01: POST a partial payment on a DRAFT invoice -> 409; zero Payment and zero FinancialTransaction rows; still DRAFT; no event', async () => {
    const res = await pay(ID.invDraft, { amount: 40, method: 'cash', reference: 'PYM-DRAFT-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(/DRAFT/);
    await expectUntouched(ID.invDraft, 'DRAFT');
  });

  it('PM-02: POST a full payment on a DRAFT invoice (would be DRAFT -> PAID) -> 409; nothing written', async () => {
    const res = await pay(ID.invDraftFull, { amount: INVOICE_TOTAL, method: 'cash', idempotencyKey: 'pym-draft-full' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    await expectUntouched(ID.invDraftFull, 'DRAFT');
  });

  it('PM-03: an internal caller (KEY adapter / evidence / drive intake share recordPayment) on a DRAFT invoice -> ConflictException; nothing written', async () => {
    await expect(
      commerce.recordPayment(ID.invDraftInternal, ID.biz, { amount: 10, method: 'cash', reference: 'PYM-DRAFT-INT' }, { actorId: 'key_ai' }),
    ).rejects.toMatchObject({ status: 409 });
    await expectUntouched(ID.invDraftInternal, 'DRAFT');
  });
});

describe('PL-P08 / PL-P10: the payment, its posting and the reconcile commit or roll back together', () => {
  it('PM-04: the deposit posting throws -> 500; no Payment row, no posting, invoice status unchanged, no event', async () => {
    vi.spyOn(revenuePosting, 'onPaymentRecorded').mockRejectedValueOnce(new Error('pym injected posting failure'));
    const res = await pay(ID.invPostFail, { amount: 40, method: 'cash', reference: 'PYM-POST-FAIL' });
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    await expectUntouched(ID.invPostFail, 'SENT');
  });

  it('PM-05: the reconcile throws (crash between write and reconcile) -> 500; no Payment row, no posting, invoice status unchanged', async () => {
    const spy = vi.spyOn(workflow, 'reconcileFromPayments').mockRejectedValueOnce(new Error('pym injected reconcile failure'));
    const res = await pay(ID.invReconcileFail, { amount: 40, method: 'cash', reference: 'PYM-REC-FAIL' });
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    await expectUntouched(ID.invReconcileFail, 'SENT');

    // The same payment afterwards (nothing injected) records normally: the
    // failed attempt left no row and no idempotency slot behind.
    const retry = await pay(ID.invReconcileFail, { amount: 40, method: 'cash', reference: 'PYM-REC-FAIL' });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(await paymentsOf(ID.invReconcileFail)).toHaveLength(1);
    expect(await paymentPostingsOf(ID.invReconcileFail)).toHaveLength(1);
    expect((await invoiceRow(ID.invReconcileFail)).status).toBe('PARTIALLY_PAID');
  });

  it('PM-06: the COGS posting inside the reconcile (payment settles the invoice -> PAID) throws -> 500; no Payment row, no posting, still SENT, no invoice.paid', async () => {
    failCogs = true;
    const res = await pay(ID.invCogsFail, { amount: INVOICE_TOTAL, method: 'cash', reference: 'PYM-COGS-FAIL' });
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    await expectUntouched(ID.invCogsFail, 'SENT');
    expect(emitted.filter((e) => e.name === 'invoice.paid')).toHaveLength(0);
  });
});

describe('invoice events are emitted after commit, exactly once', () => {
  it('PM-07: partial then full payment -> one invoice.payment_recorded, then one invoice.paid; each visible to a fresh read at emit time', async () => {
    const first = await pay(ID.invEvents, { amount: 40, method: 'cash', reference: 'PYM-EV-1' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.invoice.status).toBe('PARTIALLY_PAID');
    let events = invoiceEventsFor(ID.invEvents);
    expect(events.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
    expect(events[0].payload.invoice.status).toBe('PARTIALLY_PAID');
    await expectEmittedAfterCommit(events[0], first.body.payment.id);

    emitted.length = 0;
    const second = await pay(ID.invEvents, { amount: 60, method: 'cash', reference: 'PYM-EV-2' });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.invoice.status).toBe('PAID');
    events = invoiceEventsFor(ID.invEvents);
    expect(events.map((e) => e.name)).toEqual(['invoice.paid']);
    expect(events[0].payload.invoice.status).toBe('PAID');
    await expectEmittedAfterCommit(events[0], second.body.payment.id);

    const row = await invoiceRow(ID.invEvents);
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    expect(await paymentPostingsOf(ID.invEvents)).toHaveLength(2);
  });

  it('PM-08: idempotent replay (R0-D2) of a recorded payment emits nothing new and writes nothing', async () => {
    const body = { amount: 30, method: 'cash', idempotencyKey: 'pym-replay-1' };
    const first = await pay(ID.invReplay, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(invoiceEventsFor(ID.invReplay).map((e) => e.name)).toEqual(['invoice.payment_recorded']);

    emitted.length = 0;
    const replay = await pay(ID.invReplay, body);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(emitted).toHaveLength(0);
    expect(await paymentsOf(ID.invReplay)).toHaveLength(1);
    expect(await paymentPostingsOf(ID.invReplay)).toHaveLength(1);
    expect((await invoiceRow(ID.invReplay)).status).toBe('PARTIALLY_PAID');
  });

  it('PM-09: two concurrent submits with the same key -> one payment, one posting, exactly one invoice event (the loser\'s buffered work is discarded)', async () => {
    const body = { amount: 25, method: 'cash', idempotencyKey: 'pym-replay-race' };
    const [a, b] = await Promise.all([pay(ID.invReplayRace, body), pay(ID.invReplayRace, body)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect(a.body.payment.id).toBe(b.body.payment.id);
    expect(await paymentsOf(ID.invReplayRace)).toHaveLength(1);
    expect(await paymentPostingsOf(ID.invReplayRace)).toHaveLength(1);
    const events = invoiceEventsFor(ID.invReplayRace);
    expect(events.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
    await expectEmittedAfterCommit(events[0], a.body.payment.id);
  });

  it('PM-10: two concurrent different payments that together settle the invoice -> PAID, both rows posted, exactly one invoice.paid', async () => {
    const [a, b] = await Promise.all([
      pay(ID.invConcurrent, { amount: 60, method: 'cash', reference: 'PYM-CON-A' }),
      pay(ID.invConcurrent, { amount: 40, method: 'cash', reference: 'PYM-CON-B' }),
    ]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect(await paymentsOf(ID.invConcurrent)).toHaveLength(2);
    expect(await paymentPostingsOf(ID.invConcurrent)).toHaveLength(2);
    const row = await invoiceRow(ID.invConcurrent);
    expect(row.status).toBe('PAID');
    const names = invoiceEventsFor(ID.invConcurrent).map((e) => e.name).sort();
    expect(names).toEqual(['invoice.paid', 'invoice.payment_recorded']);
  });
});

describe('G12: refund preconditions and the refund reconcile', () => {
  it('PM-11: refund of a PENDING / FAILED / REFUNDED payment -> refused (409, as R0-PL-07 pinned; the packet asked 400) and nothing changes', async () => {
    for (const status of ['PENDING', 'FAILED', 'REFUNDED']) {
      const id = `${P}pay_${status.toLowerCase()}`;
      await db.payment.create({
        data: {
          id, businessId: ID.biz, invoiceId: ID.invNotRefundable, amount: 10, currency: 'TTD', status,
          provider: 'manual', method: 'cash', providerPaymentId: `${P}prov_${status.toLowerCase()}`, notes: 'seeded',
        },
      });
      const res = await refund(id, 'not refundable');
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(await db.payment.findUnique({ where: { id } })).toMatchObject({ status, notes: 'seeded' });
      expect(await reversalsFor(id)).toHaveLength(0);
    }
    expect((await invoiceRow(ID.invNotRefundable)).status).toBe('SENT');
    expect(invoiceEventsFor(ID.invNotRefundable)).toHaveLength(0);
  });

  it('PM-12: a reconcile error during a refund surfaces as the response (not swallowed); the refund rolls back with it', async () => {
    const a = await pay(ID.invRefundFail, { amount: 60, method: 'cash', reference: 'PYM-RF-A' });
    const b = await pay(ID.invRefundFail, { amount: 40, method: 'cash', reference: 'PYM-RF-B' });
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect((await invoiceRow(ID.invRefundFail)).status).toBe('PAID');
    const paymentId = b.body.payment.id;

    emitted.length = 0;
    vi.spyOn(workflow, 'reconcileFromPayments').mockRejectedValueOnce(new Error('pym injected refund reconcile failure'));
    const res = await refund(paymentId, 'reconcile fails');
    expect(res.status, JSON.stringify(res.body)).toBe(500);

    // Defined state: nothing of the refund committed.
    const row = await db.payment.findUnique({ where: { id: paymentId } });
    expect(row.status).toBe('SUCCESSFUL');
    expect(row.notes ?? '').not.toMatch(/Refunded:/);
    expect(await reversalsFor(paymentId)).toHaveLength(0);
    expect((await invoiceRow(ID.invRefundFail)).status).toBe('PAID');
    expect(invoiceEventsFor(ID.invRefundFail)).toHaveLength(0);
  });

  it('PM-13: the same refund without a failure -> 201; PAID reopens to PARTIALLY_PAID; one reversal; one invoice event after commit', async () => {
    const payments = await paymentsOf(ID.invRefundFail);
    const forty = payments.find((p: any) => p.amount === 40);
    expect(forty).toBeTruthy();

    const res = await refund(forty.id, 'customer returned part');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('REFUNDED');
    expect((await invoiceRow(ID.invRefundFail)).status).toBe('PARTIALLY_PAID');
    expect(await reversalsFor(forty.id)).toHaveLength(1);
    const events = invoiceEventsFor(ID.invRefundFail);
    expect(events.map((e) => e.name)).toEqual(['invoice.payment_recorded']);
    await expectEmittedAfterCommit(events[0], forty.id);
  });
});

describe('ST-PL03-1: the state guard is re-checked under the invoice lock', () => {
  it('PM-14: the invoice is voided / reverted to DRAFT after the pre-transaction guard passed -> 409 under the lock; nothing written', async () => {
    for (const [inv, status] of [[ID.invRaceVoid, 'VOID'], [ID.invRaceDraft, 'DRAFT']] as const) {
      const spy = holdAtLock(1, () => db.invoice.update({ where: { id: inv }, data: { status } }));
      const res = await pay(inv, { amount: 40, method: 'cash', reference: `PYM-RACE-${status}` });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(res.body.message).toBe(`Cannot record payment on a ${status} invoice`);
      await expectUntouched(inv, status);
      expect(auditsFor(inv)).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('PM-15: the invoice is soft-deleted after the pre-transaction guard passed -> 404 under the lock; nothing written', async () => {
    holdAtLock(1, () => db.invoice.update({ where: { id: ID.invRaceDeleted }, data: { deletedAt: new Date() } }));
    const res = await pay(ID.invRaceDeleted, { amount: 40, method: 'cash', reference: 'PYM-RACE-DEL' });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    // The shared client hides soft-deleted invoices: read the row raw.
    const [row] = await db.$queryRawUnsafe(
      `SELECT status::text AS status, deleted_at AS "deletedAt", invoice_number AS "invoiceNumber" FROM invoices WHERE id = $1`,
      ID.invRaceDeleted,
    );
    expect(row.status).toBe('SENT');
    expect(row.deletedAt).not.toBeNull();
    expect(await db.payment.count({ where: { invoiceId: ID.invRaceDeleted } })).toBe(0);
    expect(
      await db.financialTransaction.count({ where: { businessId: ID.biz, sourceType: 'Payment', reference: row.invoiceNumber } }),
    ).toBe(0);
    expect(invoiceEventsFor(ID.invRaceDeleted)).toHaveLength(0);
    expect(auditsFor(ID.invRaceDeleted)).toHaveLength(0);
  });

  it('PM-16: two concurrent un-keyed full payments (KEY adapter path, no dedupe) -> one PAID payment; the other is refused 409 under the lock', async () => {
    holdAtLock(2);
    const call = () =>
      commerce.recordPayment(ID.invRaceDouble, ID.biz, { amount: INVOICE_TOTAL, method: 'cash', reference: 'PYM-X4' }, { actorId: 'key_ai' });
    const results = await Promise.allSettled([call(), call()]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.map((r) => r.status).sort(), JSON.stringify(rejected.map((r) => String(r.reason)))).toEqual(['fulfilled', 'rejected']);
    expect(rejected[0].reason).toMatchObject({ status: 409, message: 'Cannot record payment on a PAID invoice' });

    const rows = await paymentsOf(ID.invRaceDouble);
    expect(rows.map((p: any) => `${p.amount}:${p.status}`)).toEqual([`${INVOICE_TOTAL}:SUCCESSFUL`]);
    expect(await paymentPostingsOf(ID.invRaceDouble)).toHaveLength(1);
    expect((await invoiceRow(ID.invRaceDouble)).status).toBe('PAID');
    expect(invoiceEventsFor(ID.invRaceDouble).map((e) => e.name)).toEqual(['invoice.paid']);
    expect(auditsFor(ID.invRaceDouble)).toHaveLength(1);
  });

  it('PM-17: two concurrent keyed full payments with the same key -> one payment; both 201 with it (R0-D2 replay holds although the winner settled the invoice)', async () => {
    holdAtLock(2);
    const body = { amount: INVOICE_TOTAL, method: 'cash', idempotencyKey: 'pym-race-keyed' };
    const [a, b] = await Promise.all([pay(ID.invRaceKeyed, body), pay(ID.invRaceKeyed, body)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect(a.body.payment.id).toBe(b.body.payment.id);
    expect(await paymentsOf(ID.invRaceKeyed)).toHaveLength(1);
    expect(await paymentPostingsOf(ID.invRaceKeyed)).toHaveLength(1);
    expect((await invoiceRow(ID.invRaceKeyed)).status).toBe('PAID');
    expect(invoiceEventsFor(ID.invRaceKeyed).map((e) => e.name)).toEqual(['invoice.paid']);
  });
});

describe('ST-PL03-2: response and audit totals are the ones read under the lock', () => {
  it('PM-18: concurrent 60 + 40 -> the settling audit event says totalPaid 100 / PAID / overPaid 0; each response agrees with its own audit', async () => {
    holdAtLock(2);
    const [a, b] = await Promise.all([
      pay(ID.invRaceAudit, { amount: 60, method: 'cash', reference: 'PYM-AUD-A' }),
      pay(ID.invRaceAudit, { amount: 40, method: 'cash', reference: 'PYM-AUD-B' }),
    ]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect((await invoiceRow(ID.invRaceAudit)).status).toBe('PAID');

    const audits = auditsFor(ID.invRaceAudit);
    expect(audits).toHaveLength(2);
    const settled = audits.find((e) => e.data.newStatus === 'PAID');
    const partial = audits.find((e) => e.data.newStatus === 'PARTIALLY_PAID');
    expect(settled?.data, JSON.stringify(audits.map((e) => e.data))).toMatchObject({ totalPaid: 100, overPaid: 0 });
    expect(partial?.data.totalPaid).toBe(partial?.data.amount);
    for (const r of [a, b]) {
      const audit = audits.find((e) => e.data.amount === r.body.payment.amount);
      expect(r.body.paidAmount, JSON.stringify(r.body)).toBe(audit.data.totalPaid);
      expect(r.body.remaining).toBe(Math.max(0, INVOICE_TOTAL - audit.data.totalPaid));
    }
  });

  it('PM-19: concurrent 70 + 50 (an overpayment) -> the settling audit event says totalPaid 120 and overPaid 20; its response paidAmount 120, remaining 0', async () => {
    holdAtLock(2);
    const [a, b] = await Promise.all([
      pay(ID.invRaceOver, { amount: 70, method: 'cash', reference: 'PYM-OVR-A' }),
      pay(ID.invRaceOver, { amount: 50, method: 'cash', reference: 'PYM-OVR-B' }),
    ]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    expect((await invoiceRow(ID.invRaceOver)).status).toBe('PAID');

    const audits = auditsFor(ID.invRaceOver);
    const settled = audits.find((e) => e.data.newStatus === 'PAID');
    expect(settled?.data, JSON.stringify(audits.map((e) => e.data))).toMatchObject({ totalPaid: 120, overPaid: 20 });
    const settling = [a, b].find((r) => r.body.payment.amount === settled.data.amount);
    expect(settling?.body).toMatchObject({ paidAmount: 120, remaining: 0 });
  });
});

describe('ST-PL03-3 / CR-1: a refund is not blocked by a status the workflow cannot move', () => {
  it('PM-20: refund on an invoice reverted to DRAFT (undoInvoice) that keeps a net balance -> 201; REFUNDED, one reversal; still DRAFT; no invoice event', async () => {
    const a = await pay(ID.invRefundDraft, { amount: 60, method: 'cash', reference: 'PYM-RD-A' });
    const b = await pay(ID.invRefundDraft, { amount: 30, method: 'cash', reference: 'PYM-RD-B' });
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    await expect(commerce.undoInvoice(ID.invRefundDraft, ID.biz)).resolves.toMatchObject({ status: 'reverted_to_draft' });
    expect((await invoiceRow(ID.invRefundDraft)).status).toBe('DRAFT');

    emitted.length = 0;
    const res = await refund(b.body.payment.id, 'booked against the wrong invoice');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('REFUNDED');
    expect(await reversalsFor(b.body.payment.id)).toHaveLength(1);
    expect((await db.payment.findUnique({ where: { id: a.body.payment.id } })).status).toBe('SUCCESSFUL');
    expect((await invoiceRow(ID.invRefundDraft)).status).toBe('DRAFT');
    expect(invoiceEventsFor(ID.invRefundDraft)).toHaveLength(0);
  });

  it('PM-21: refund on a PARTIALLY_CREDITED invoice that keeps a net balance -> 201; REFUNDED, one reversal; still PARTIALLY_CREDITED; no invoice event', async () => {
    const a = await pay(ID.invRefundCredited, { amount: 40, method: 'cash', reference: 'PYM-RC-A' });
    const b = await pay(ID.invRefundCredited, { amount: 30, method: 'cash', reference: 'PYM-RC-B' });
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([201, 201]);
    // What CreditNoteService.apply writes for a partial credit (credit-note.service.ts).
    await db.invoice.update({ where: { id: ID.invRefundCredited }, data: { status: 'PARTIALLY_CREDITED' } });

    emitted.length = 0;
    const res = await refund(b.body.payment.id, 'customer returned part');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('REFUNDED');
    expect(await reversalsFor(b.body.payment.id)).toHaveLength(1);
    expect((await invoiceRow(ID.invRefundCredited)).status).toBe('PARTIALLY_CREDITED');
    expect(invoiceEventsFor(ID.invRefundCredited)).toHaveLength(0);
  });
});
