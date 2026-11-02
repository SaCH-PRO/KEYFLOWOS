/**
 * V1-29-DM-REFUND-CONVENTION — one refund convention (REAL database, REAL
 * ledger posting, REAL invoice workflow).
 *
 * M28 / CF-11 / CF-17, owner ruling D-14. Two refund conventions coexisted.
 * Provider refunds (Stripe, PayPal, refundCharge) keep the SUCCESSFUL original
 * and add a separate negative REFUNDED row linked by `reference` to the
 * original's providerPaymentId. The manual refund (POST
 * /commerce/businesses/:b/payments/:id/refund, markPaymentRefunded) flipped the
 * original row to REFUNDED instead, and computeBalance, which reads REFUNDED
 * rows sign-agnostically, then dropped the row from `paid` AND subtracted it
 * again as `refunded`: a full refund of 100 on a 100 invoice read net -100,
 * remaining 200, and the invoice stayed PAID (deriveStatusAfterPayment reopens
 * only on a positive net). The operator figures (listPayments,
 * getInvoiceForBusiness) summed SUCCESSFUL rows only, so they disagreed with
 * computeBalance whenever a refund row existed.
 *
 * Contract pinned here (D-14: manual refunds are separate negative REFUNDED
 * rows, the provider convention; a fully refunded invoice returns to SENT with
 * paidAt cleared; no enum migration):
 *
 *   RF-01  full refund of a 100 payment on a PAID 100 invoice -> 201; the SUCCESSFUL row is kept; one
 *          linked -100 REFUNDED row (reference = the original's providerPaymentId); the original
 *          posting is REVERSED by one REVERSAL; computeBalance paid 100, refunded 100, net 0,
 *          remaining 100; the invoice is SENT with paidAt null; listPayments and the operator
 *          invoice read agree (paidAmount 0, remaining 100); the response names the original
 *          payment and the reconciled status and balance
 *   RF-02  60 + 40 paid (PAID), the 40 refunded -> PARTIALLY_PAID, remaining 40, paidAt null;
 *          listPayments.remaining 40 and paidAmount 60 = computeBalance
 *   RF-03  a PARTIALLY_PAID invoice whose only payment is refunded -> SENT, remaining = total
 *   RF-04  refunding a PENDING / FAILED row, a legacy flipped REFUNDED row, or a refund row
 *          itself -> 409; no row written or changed, no reversal, balance unchanged
 *   RF-05  a replay of the same refund (same payment) -> 409 "already refunded", a no-op: one refund
 *          row, one reversal, balance and status unchanged; two concurrent refunds of one payment
 *          -> one 201 and one 409, one refund row, one reversal
 *   RF-06  a reconcile failure inside the refund is the response (500), never swallowed: the
 *          refund rolls back (no refund row, original SUCCESSFUL, posting POSTED, no reversal)
 *   RF-07  TENANT (M31): tenant B's owner refunding A's payment -> 404 under B's path, 403 under
 *          A's path; no Payment row of A changes and none is written for B
 *   RF-08  after a full refund the invoice settles again with a new payment (PAID, paidAt set);
 *          mark-paid after a manual partial refund records the true remaining (40) and ends PAID
 *   RF-09  ST-D2-2 kept under the new convention: a payment recorded with an idempotency key and
 *          then refunded is not replayed by the same key (409 naming the refund)
 *   RF-10  a provider-refunded payment (SUCCESSFUL 100 beside a provider -40 row) refunded
 *          manually refunds only the remaining 60; net 0; SENT
 *   RF-11  (review SEC-V29-1 / CR-V29-5) a Stripe Checkout payment (cs_, pi_ in reference) fully
 *          refunded by the real Stripe refund webhook (refund row reference = the charge id, which
 *          does not link to cs_) refunded manually -> 409 "already refunded"; nothing written
 *   RF-12  (same review) the real webhook rows on one invoice: a PaymentIntent payment part-refunded
 *          at Stripe (linked through the charge id in its reference) does not block refunding a
 *          second Stripe payment in full; the PaymentIntent payment refunds only what is left
 *   RF-13  (same review) a refund never takes the invoice below nothing received: a refund row of
 *          another provider that links to no payment covers the invoice -> 409, nothing written
 *   RF-14  (review CR-V29-4) a row the manual refund flipped to REFUNDED before V1-29 is read as
 *          the payment plus its refund: listPayments / the operator read serve paidAmount 0,
 *          remaining 100 (not -60 / 160), and later payments settle the invoice at the true total
 *   LEDGER after every case: each transaction balances, the ledger cash net of the invoice's
 *          payment postings = computeBalance.net (over the stored rows: balanceOfStoredRows, which
 *          is computeBalance for every row written since V1-29), one REVERSAL per refunded
 *          posting, and the tenant's trial balance balances
 *
 * SEC-V29-2 (the refund audit named the payment's full amount) is a real case since
 * V1-29c-REFUND-WRITE-DOOR, which also links the Stripe webhook's refund rows to their payment
 * (RF-11, RF-12 assert reference = the original's providerPaymentId).
 * Open (it.todo, outside the V1-29 write set; owner decision): CR-V29-1 (invoice / reminder email and evidence-match
 * figures read gross paid), CR-V29-2 (CASH-basis receivables count SUCCESSFUL rows only),
 * CR-V29-3 (receipt email and public receipt state gross paid after a re-settlement).
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService write
 * real rows, and the production GlobalHttpExceptionFilter + ValidationPipe are
 * installed. Identity attachment is the one stand-in: a test middleware reads
 * `x-v29a-user`, loads that seeded user row and attaches `{ id, email, role }`
 * exactly as the Supabase-verifying AuthMiddleware would. EventEmitter2 is a
 * recording stub; ExpensePostingService (COGS), the contact timeline, the stats
 * cache and the AI / Gmail / Drive services are stubs off the boundary.
 *
 * Fixtures: prefix `v29a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order in
 * beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { CommerceService } from '../src/modules/commerce/commerce.service';
import type { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v29a_';
const HEADER = 'x-v29a-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contact: `${P}contact`,
  // one invoice per case so balances never bleed between cases
  invFull: `${P}invFull`,
  invPartial: `${P}invPartial`,
  invPartToSent: `${P}invPartToSent`,
  invGuard: `${P}invGuard`,
  invReplay: `${P}invReplay`,
  invRace: `${P}invRace`,
  invReconcileFail: `${P}invReconcileFail`,
  invTenant: `${P}invTenant`,
  invResettle: `${P}invResettle`,
  invMarkPaid: `${P}invMarkPaid`,
  invIdemKey: `${P}invIdemKey`,
  invProvider: `${P}invProvider`,
  invStripeFull: `${P}invStripeFull`,
  invStripeMixed: `${P}invStripeMixed`,
  invStray: `${P}invStray`,
  invLegacy: `${P}invLegacy`,
  invAuditLeft: `${P}invAuditLeft`,
};

const TOTAL = 100;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let commerce: CommerceService;
let workflow: InvoiceWorkflowService;
let computeBalanceFn: (total: number, payments: Array<{ amount: number; status: string }>, currency?: string) => any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;
// The real Stripe webhook handlers (RF-11, RF-12) and the real posting reversal (RF-14).
let paymentsSvc: any;
let revenuePosting: any;

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

async function cleanup() {
  for (const sql of [
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

function pay(inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.bizA}/invoices/${inv}/payments`).set(HEADER, ID.ownerA).send(body);
}

function refund(paymentId: string, reason = 'v29a refund', as = ID.ownerA, biz = ID.bizA) {
  return agent().post(`/commerce/businesses/${biz}/payments/${paymentId}/refund`).set(HEADER, as).send({ reason });
}

function listPayments(inv: string) {
  return agent().get(`/commerce/businesses/${ID.bizA}/invoices/${inv}/payments`).set(HEADER, ID.ownerA);
}

function markPaid(inv: string) {
  return agent().patch(`/commerce/invoices/${inv}/paid`).set(HEADER, ID.ownerA).send({ businessId: ID.bizA });
}

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function paymentsOf(invoiceId: string): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
}

async function paymentRow(id: string): Promise<any> {
  return db.payment.findUnique({ where: { id } });
}

/** The refund rows linked to one original payment (the provider convention: reference = the original's providerPaymentId). */
async function refundRowsOf(original: { invoiceId: string; providerPaymentId: string }): Promise<any[]> {
  return db.payment.findMany({
    where: { invoiceId: original.invoiceId, status: 'REFUNDED', amount: { lt: 0 }, reference: original.providerPaymentId },
  });
}

async function postingsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.bizA, externalRef: `Payment:${paymentId}:payment_recorded` },
  });
}

async function reversalsFor(paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.bizA, externalRef: `Payment:${paymentId}:payment_recorded:reversal` },
  });
}

/**
 * The invoice's balance over its stored rows (balanceOfStoredRows: computeBalance for every row
 * written since V1-29; a pre-V1-29 flipped row is read as its payment plus its refund, CR-V29-4).
 */
async function balanceOf(invoiceId: string) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  return storedBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
}

/** computeBalance alone over the stored rows (sign-agnostic: a flipped row is subtracted twice). */
async function rawBalanceOf(invoiceId: string) {
  const inv = await invoiceRow(invoiceId);
  const rows = await paymentsOf(invoiceId);
  return computeBalanceFn(Number(inv.total), rows.map((r) => ({ amount: Number(r.amount), status: r.status })), inv.currency);
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/**
 * LEDGER: every transaction the invoice's payments sourced balances; the
 * deposit-side (cash) net of those transactions equals computeBalance.net;
 * there is exactly one REVERSAL per reversed payment posting; and the tenant's
 * trial balance balances.
 */
async function expectLedgerAgrees(invoiceId: string, expected: { net: number; reversals: number }) {
  const rows = await paymentsOf(invoiceId);
  const txns = await db.financialTransaction.findMany({
    where: { businessId: ID.bizA, sourceType: 'Payment', sourceId: { in: rows.map((r) => r.id) } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  for (const t of txns) {
    expect(money(sum(t.entries, 'debit')), `${invoiceId} ${t.externalRef}: debits = credits`).toBe(money(sum(t.entries, 'credit')));
  }
  const cashNet = money(
    txns
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const balance = await balanceOf(invoiceId);
  expect(cashNet, `${invoiceId}: ledger cash net = computeBalance.net`).toBe(balance.net);
  expect(balance.net, `${invoiceId}: computeBalance.net`).toBe(expected.net);
  const reversals = txns.filter((t: any) => t.type === 'REVERSAL');
  expect(reversals, `${invoiceId}: one REVERSAL per refunded posting`).toHaveLength(expected.reversals);
  for (const r of reversals) {
    const original = txns.find((t: any) => t.id === r.reversalOfId);
    expect(original?.status, `${invoiceId}: the reversed original is REVERSED`).toBe('REVERSED');
  }
  const totals = await db.ledgerEntry.aggregate({ where: { businessId: ID.bizA }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance: debits = credits').toBe(money(Number(totals._sum.credit ?? 0)));
  return { cashNet, balance };
}

/** A payment through the real HTTP route, asserted 201. */
async function paid(inv: string, amount: number, reference: string) {
  const res = await pay(inv, { amount, method: 'cash', reference });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.payment;
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
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
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
  computeBalanceFn = workflowMod.computeBalance;
  storedBalanceFn = workflowMod.balanceOfStoredRows;

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
      workflowMod.InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      // Real ledger chain: the proof is the rows it posts and reverses.
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: CrmService, useValue: { logContactEvent: async () => null } },
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
  workflow = moduleRef.get(workflowMod.InvoiceWorkflowService);
  revenuePosting = moduleRef.get(RevenuePostingService);
  // The Stripe webhook handlers over the same real Prisma, workflow and ledger chain.
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  paymentsSvc = new PaymentsService(moduleRef.get(PrismaService), commerce, workflow, revenuePosting);

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

  for (const [user, biz, name, email] of [
    [ID.ownerA, ID.bizA, 'V29A Biz A', `${P}owner_a@test.local`],
    [ID.ownerB, ID.bizB, 'V29A Biz B', `${P}owner_b@test.local`],
  ] as const) {
    await db.user.create({ data: { id: user, email, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
    await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(biz);
  }
  await db.contact.create({ data: { id: ID.contact, businessId: ID.bizA, firstName: 'V29a', lastName: 'Customer', email: `${P}c@test.local` } });

  let n = 0;
  for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
    n += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `V29A-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: ID.bizA,
        contactId: ID.contact,
        items: { create: [{ id: `${id}_item1`, description: `V29A item ${n}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows)', () => {
  it('two tenants with a system chart of accounts each; every fixture invoice is SENT, 100, with no payment', async () => {
    for (const biz of [ID.bizA, ID.bizB]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } }), biz).toBeGreaterThan(0);
    }
    for (const id of Object.values(ID).filter((v) => v.startsWith(`${P}inv`))) {
      expect(await paymentsOf(id), id).toHaveLength(0);
      expect(await invoiceRow(id), id).toMatchObject({ status: 'SENT', total: TOTAL, businessId: ID.bizA });
    }
  });
});

describe('D-14: a manual refund is a separate negative REFUNDED row beside the SUCCESSFUL original', () => {
  it('RF-01 (RED-BEFORE M28): full refund of 100 on a PAID 100 invoice -> the SUCCESSFUL row is kept, one linked -100 REFUNDED row, the posting reversed once; net 0, remaining 100; SENT with paidAt cleared; listPayments and the operator read agree', async () => {
    const inv = ID.invFull;
    const original = await paid(inv, 100, 'V29A-FULL');
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PAID' });
    expect((await invoiceRow(inv)).paidAt).not.toBeNull();
    emitted.length = 0;

    const res = await refund(original.id, 'customer cancelled');
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const kept = await paymentRow(original.id);
    expect(kept, 'the original row is kept as it was').toMatchObject({ status: 'SUCCESSFUL', amount: 100, notes: original.notes ?? null });
    const refunds = await refundRowsOf(original);
    expect(refunds, 'one linked refund row').toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: 'REFUNDED',
      amount: -100,
      currency: 'TTD',
      businessId: ID.bizA,
      invoiceId: inv,
      reference: original.providerPaymentId,
      recordedBy: ID.ownerA,
    });
    expect(refunds[0].notes).toMatch(/customer cancelled/);
    expect(await paymentsOf(inv)).toHaveLength(2);

    // The response is the refund row, naming the payment it refunds and the reconciled invoice.
    expect(res.body).toMatchObject({ id: refunds[0].id, status: 'REFUNDED', amount: -100, refundOfPaymentId: original.id, invoiceStatus: 'SENT' });
    expect(res.body.balance).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100 });

    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100, isFullyPaid: false });
    const row = await invoiceRow(inv);
    expect(row.status, 'D-14: a fully refunded invoice returns to SENT').toBe('SENT');
    expect(row.paidAt, 'D-14: paidAt cleared').toBeNull();

    const list = await listPayments(inv);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body).toMatchObject({ paidAmount: 0, remaining: 100 });
    expect(await commerce.getInvoiceForBusiness(inv, ID.bizA)).toMatchObject({ paidAmount: 0, remaining: 100 });

    expect(await postingsFor(original.id)).toEqual([expect.objectContaining({ status: 'REVERSED' })]);
    const reversals = await reversalsFor(original.id);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ type: 'REVERSAL', status: 'POSTED', createdById: ID.ownerA });
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });
    // A refund reopening to SENT emits no invoice.sent (no customer email) and no paid event.
    expect(emitted.filter((e) => e.payload?.invoice?.id === inv).map((e) => e.name)).toEqual([]);
  });

  it('RF-02: 60 + 40 paid (PAID), the 40 refunded -> PARTIALLY_PAID, remaining 40, paidAt cleared; listPayments.remaining and paidAmount agree with computeBalance', async () => {
    const inv = ID.invPartial;
    await paid(inv, 60, 'V29A-P-60');
    const forty = await paid(inv, 40, 'V29A-P-40');
    expect((await invoiceRow(inv)).status).toBe('PAID');

    const res = await refund(forty.id, 'returned part');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'REFUNDED', amount: -40, refundOfPaymentId: forty.id, invoiceStatus: 'PARTIALLY_PAID' });

    expect((await paymentRow(forty.id)).status).toBe('SUCCESSFUL');
    expect(await refundRowsOf(forty)).toEqual([expect.objectContaining({ amount: -40, status: 'REFUNDED' })]);
    const balance = await balanceOf(inv);
    expect(balance).toMatchObject({ paid: 100, refunded: 40, net: 60, remaining: 40 });
    const row = await invoiceRow(inv);
    expect(row.status).toBe('PARTIALLY_PAID');
    expect(row.paidAt).toBeNull();

    const list = await listPayments(inv);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body).toMatchObject({ paidAmount: balance.net, remaining: balance.remaining });
    expect(list.body).toMatchObject({ paidAmount: 60, remaining: 40 });
    expect(await commerce.getInvoiceForBusiness(inv, ID.bizA)).toMatchObject({ paidAmount: 60, remaining: 40 });
    await expectLedgerAgrees(inv, { net: 60, reversals: 1 });
  });

  it('RF-03: a PARTIALLY_PAID invoice whose only payment is refunded -> SENT, remaining = total', async () => {
    const inv = ID.invPartToSent;
    const forty = await paid(inv, 40, 'V29A-PS-40');
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');

    const res = await refund(forty.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await balanceOf(inv)).toMatchObject({ paid: 40, refunded: 40, net: 0, remaining: 100 });
    expect(await invoiceRow(inv)).toMatchObject({ status: 'SENT', paidAt: null });
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });
  });
});

describe('refund status guard (CF-11)', () => {
  it('RF-04: refunding a PENDING row, a FAILED row, a legacy flipped REFUNDED row, or a refund row itself -> 409; nothing written or changed; balance unchanged', async () => {
    const inv = ID.invGuard;
    for (const status of ['PENDING', 'FAILED', 'REFUNDED']) {
      await db.payment.create({
        data: {
          id: `${P}pay_${status.toLowerCase()}`, businessId: ID.bizA, invoiceId: inv, amount: 10, currency: 'TTD', status,
          provider: 'manual', method: 'cash', providerPaymentId: `${P}prov_${status.toLowerCase()}`, notes: 'seeded',
        },
      });
    }
    const thirty = await paid(inv, 30, 'V29A-G-30');
    const first = await refund(thirty.id);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const [refundRow] = await refundRowsOf(thirty);
    expect(refundRow).toBeTruthy();

    const rowsBefore = await paymentsOf(inv);
    const balanceBefore = await balanceOf(inv);
    const statusBefore = (await invoiceRow(inv)).status;
    for (const id of [`${P}pay_pending`, `${P}pay_failed`, `${P}pay_refunded`, refundRow.id]) {
      const res = await refund(id, 'not refundable');
      expect(res.status, `${id}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(await reversalsFor(id)).toHaveLength(0);
    }
    expect(await paymentsOf(inv)).toEqual(rowsBefore);
    expect(await balanceOf(inv)).toEqual(balanceBefore);
    expect((await invoiceRow(inv)).status).toBe(statusBefore);
  });

  it('RF-05: a replay of the same refund -> 409 "already refunded" and a no-op (one refund row, one reversal, balance and status unchanged); two concurrent refunds of one payment -> one 201, one 409, one refund row, one reversal', async () => {
    const inv = ID.invReplay;
    const fifty = await paid(inv, 50, 'V29A-R-50');
    const first = await refund(fifty.id, 'first');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const rowsBefore = await paymentsOf(inv);
    const balanceBefore = await balanceOf(inv);
    const invoiceBefore = await invoiceRow(inv);

    const again = await refund(fifty.id, 'second');
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.message).toMatch(/already refunded/i);
    expect(await paymentsOf(inv)).toEqual(rowsBefore);
    expect(await refundRowsOf(fifty)).toHaveLength(1);
    expect(await reversalsFor(fifty.id)).toHaveLength(1);
    expect(await balanceOf(inv)).toEqual(balanceBefore);
    expect(await invoiceRow(inv)).toEqual(invoiceBefore);
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });

    const race = ID.invRace;
    const thirtyFive = await paid(race, 35, 'V29A-RACE-35');
    const results = await Promise.all([refund(thirtyFive.id, 'race'), refund(thirtyFive.id, 'race')]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    expect(await refundRowsOf(thirtyFive)).toHaveLength(1);
    expect(await reversalsFor(thirtyFive.id)).toHaveLength(1);
    expect((await paymentRow(thirtyFive.id)).status).toBe('SUCCESSFUL');
    expect(await invoiceRow(race)).toMatchObject({ status: 'SENT' });
    await expectLedgerAgrees(race, { net: 0, reversals: 1 });
  });

  it('RF-06: a reconcile failure inside the refund is the response (500), never swallowed; the refund rolls back (no refund row, original SUCCESSFUL, posting POSTED, no reversal, status unchanged)', async () => {
    const inv = ID.invReconcileFail;
    const full = await paid(inv, 100, 'V29A-RF-100');
    emitted.length = 0;
    vi.spyOn(workflow, 'reconcileFromPayments').mockRejectedValueOnce(new Error('v29a injected refund reconcile failure'));
    const res = await refund(full.id, 'reconcile fails');
    expect(res.status, JSON.stringify(res.body)).toBe(500);

    expect(await paymentsOf(inv)).toEqual([expect.objectContaining({ id: full.id, status: 'SUCCESSFUL', amount: 100 })]);
    expect(await postingsFor(full.id)).toEqual([expect.objectContaining({ status: 'POSTED' })]);
    expect(await reversalsFor(full.id)).toHaveLength(0);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(emitted.filter((e) => e.payload?.invoice?.id === inv)).toHaveLength(0);
    await expectLedgerAgrees(inv, { net: 100, reversals: 0 });
  });

  it('RF-07 TENANT (M31): tenant B\'s owner refunding A\'s payment -> 404 under B\'s path, 403 under A\'s path; no Payment row of A changes and none is written for B', async () => {
    const inv = ID.invTenant;
    const full = await paid(inv, 100, 'V29A-T-100');
    const rowsBefore = await paymentsOf(inv);

    const underB = await refund(full.id, 'cross tenant', ID.ownerB, ID.bizB);
    expect(underB.status, JSON.stringify(underB.body)).toBe(404);
    const underA = await refund(full.id, 'cross tenant', ID.ownerB, ID.bizA);
    expect(underA.status, JSON.stringify(underA.body)).toBe(403);

    expect(await paymentsOf(inv)).toEqual(rowsBefore);
    const rawB = await db.$queryRawUnsafe(`SELECT id FROM payments WHERE business_id = $1`, ID.bizB);
    expect(rawB).toEqual([]);
    expect(await reversalsFor(full.id)).toHaveLength(0);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    await expectLedgerAgrees(inv, { net: 100, reversals: 0 });
  });
});

describe('agreeing figures after a refund (CF-17)', () => {
  it('RF-08: after a full refund a new payment settles the invoice again (PAID, paidAt set); mark-paid after a manual partial refund records the true remaining 40 and ends PAID', async () => {
    const inv = ID.invResettle;
    const first = await paid(inv, 100, 'V29A-RS-1');
    expect((await refund(first.id)).status).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    await paid(inv, 100, 'V29A-RS-2');
    const row = await invoiceRow(inv);
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    expect(await balanceOf(inv)).toMatchObject({ paid: 200, refunded: 100, net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
    await expectLedgerAgrees(inv, { net: 100, reversals: 1 });

    const mp = ID.invMarkPaid;
    await paid(mp, 60, 'V29A-MP-60');
    const forty = await paid(mp, 40, 'V29A-MP-40');
    expect((await refund(forty.id)).status).toBe(201);
    expect((await invoiceRow(mp)).status).toBe('PARTIALLY_PAID');
    const res = await markPaid(mp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: mp, status: 'PAID' });
    const rows = await paymentsOf(mp);
    const settling = rows.filter((r) => r.status === 'SUCCESSFUL' && r.providerPaymentId.includes('_markpaid_'));
    expect(settling.map((r) => r.amount)).toEqual([40]);
    expect(await balanceOf(mp)).toMatchObject({ paid: 140, refunded: 40, net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
    await expectLedgerAgrees(mp, { net: 100, reversals: 1 });
  });

  it('RF-09 (ST-D2-2 kept): a payment recorded with an idempotency key and then refunded is not replayed by the same key -> 409 naming the refund; nothing written', async () => {
    const inv = ID.invIdemKey;
    const body = { amount: 20, method: 'cash', idempotencyKey: `${P}kk` };
    const first = await pay(inv, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await refund(first.body.payment.id)).status).toBe(201);
    const rowsBefore = await paymentsOf(inv);

    const again = await pay(inv, body);
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.message).toMatch(/idempotency key/i);
    expect(again.body.message).toMatch(/refunded/i);
    expect(await paymentsOf(inv)).toEqual(rowsBefore);
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });
  });

  it('RF-10: a payment the provider already refunded in part (SUCCESSFUL 100 beside a provider -40 row) refunded manually refunds only the remaining 60; net 0; SENT', async () => {
    const inv = ID.invProvider;
    const charge = await db.payment.create({
      data: {
        id: `${inv}_charge`, businessId: ID.bizA, invoiceId: inv, amount: 100, currency: 'TTD', status: 'SUCCESSFUL',
        provider: 'stripe', method: 'card', providerPaymentId: `${P}ch_provider`,
      },
    });
    await db.payment.create({
      data: {
        id: `${inv}_prefund`, businessId: ID.bizA, invoiceId: inv, amount: -40, currency: 'TTD', status: 'REFUNDED',
        provider: 'stripe', providerPaymentId: `${P}re_provider`, reference: charge.providerPaymentId,
      },
    });
    await db.invoice.update({ where: { id: inv }, data: { status: 'PARTIALLY_PAID' } });

    const res = await refund(charge.id, 'rest of the charge');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ amount: -60, status: 'REFUNDED', refundOfPaymentId: charge.id, invoiceStatus: 'SENT' });
    expect((await refundRowsOf(charge)).map((r) => r.amount).sort((a, b) => a - b)).toEqual([-60, -40]);
    expect((await paymentRow(charge.id)).status).toBe('SUCCESSFUL');
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100 });
    expect((await invoiceRow(inv)).status).toBe('SENT');
    // The seeded provider rows carry no posting: nothing to reverse, the ledger stays at 0 = net.
    await expectLedgerAgrees(inv, { net: 0, reversals: 0 });

    const again = await refund(charge.id, 'again');
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.message).toMatch(/already refunded/i);
  });
});

describe('V1-29 review: refunds that do not link to their payment (SEC-V29-1 / CR-V29-5)', () => {
  it('RF-11: a Stripe Checkout payment (cs_, pi_ in reference) fully refunded by the real Stripe refund webhook (reference = the charge id) and then refunded manually -> 409 "already refunded"; nothing written, one reversal, net 0', async () => {
    const inv = ID.invStripeFull;
    await paymentsSvc.processStripeChargeOrSession(
      'checkout.session.completed',
      { id: `${P}cs_full`, client_reference_id: inv, amount_total: 10000, currency: 'ttd', payment_intent: `${P}pi_full` },
      `${P}evt_full`,
    );
    const [original] = await paymentsOf(inv);
    expect(original).toMatchObject({ provider: 'stripe', providerPaymentId: `${P}cs_full`, reference: `${P}pi_full`, status: 'SUCCESSFUL', amount: 100 });
    expect((await invoiceRow(inv)).status).toBe('PAID');

    await paymentsSvc.processStripeRefund('charge.refunded', {
      id: `${P}ch_full`, payment_intent: `${P}pi_full`, amount_refunded: 10000, currency: 'ttd',
      refunds: { data: [{ id: `${P}re_full`, amount: 10000, currency: 'ttd', charge: `${P}ch_full`, payment_intent: `${P}pi_full`, status: 'succeeded' }] },
    });
    const afterWebhook = await paymentsOf(inv);
    // V1-29c-REFUND-WRITE-DOOR (SEC-V29-1 at the write door): the webhook's refund row links to the cs_ payment
    // by reference (it carried the charge id, ch_full, before V1-29c).
    expect(afterWebhook.map((r) => [r.providerPaymentId, r.status, Number(r.amount), r.reference])).toEqual([
      [`${P}cs_full`, 'SUCCESSFUL', 100, `${P}pi_full`],
      [`${P}re_full`, 'REFUNDED', -100, `${P}cs_full`],
    ]);
    expect(await refundRowsOf(original)).toHaveLength(1);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    const balanceBefore = await balanceOf(inv);
    expect(balanceBefore).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100 });
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });

    // RED-BEFORE (V1-29 head 3c8de27f): 201 with a second -100 row, net -100, remaining 200.
    const res = await refund(original.id, 'operator refunds again');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(/already refunded/i);
    expect(await paymentsOf(inv)).toEqual(afterWebhook);
    expect(await balanceOf(inv)).toEqual(balanceBefore);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await reversalsFor(original.id)).toHaveLength(1);
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });
    const list = await listPayments(inv);
    expect(list.body).toMatchObject({ paidAmount: 0, remaining: 100 });
  });

  it('RF-12: a PaymentIntent payment part-refunded at Stripe (linked through the charge id in its reference) does not block refunding a second Stripe payment on the invoice in full; the PaymentIntent payment then refunds only what is left (30); a third refund -> 409', async () => {
    const inv = ID.invStripeMixed;
    await paymentsSvc.processStripeChargeOrSession(
      'payment_intent.succeeded',
      { id: `${P}pi_mixed`, amount_received: 5000, currency: 'ttd', latest_charge: `${P}ch_mixed`, metadata: { invoiceId: inv } },
      `${P}evt_mixed_pi`,
    );
    await paymentsSvc.processStripeChargeOrSession(
      'checkout.session.completed',
      { id: `${P}cs_mixed`, client_reference_id: inv, amount_total: 5000, currency: 'ttd', payment_intent: `${P}pi_mixed_cs` },
      `${P}evt_mixed_cs`,
    );
    const rows = await paymentsOf(inv);
    const intent = rows.find((r) => r.providerPaymentId === `${P}pi_mixed`);
    const session = rows.find((r) => r.providerPaymentId === `${P}cs_mixed`);
    expect(intent).toMatchObject({ provider: 'stripe', reference: `${P}ch_mixed`, amount: 50, status: 'SUCCESSFUL' });
    expect(session).toMatchObject({ provider: 'stripe', reference: `${P}pi_mixed_cs`, amount: 50, status: 'SUCCESSFUL' });
    expect((await invoiceRow(inv)).status).toBe('PAID');

    // Stripe refunds 20 of the PaymentIntent payment (refund.created: the Refund object itself).
    await paymentsSvc.processStripeRefund('refund.created', {
      id: `${P}re_mixed`, amount: 2000, currency: 'ttd', charge: `${P}ch_mixed`, payment_intent: `${P}pi_mixed`, status: 'succeeded',
    });
    // V1-29c-REFUND-WRITE-DOOR: the refund row links to the payment it refunds (reference = pi_mixed; ch_mixed before V1-29c).
    expect((await paymentsOf(inv)).find((r) => r.providerPaymentId === `${P}re_mixed`)).toMatchObject({ amount: -20, status: 'REFUNDED', reference: `${P}pi_mixed` });
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 20, net: 80 });

    const whole = await refund(session.id, 'second stripe payment');
    expect(whole.status, JSON.stringify(whole.body)).toBe(201);
    expect(whole.body).toMatchObject({ amount: -50, status: 'REFUNDED', refundOfPaymentId: session.id, invoiceStatus: 'PARTIALLY_PAID' });
    expect(whole.body.balance).toMatchObject({ net: 30, remaining: 70 });

    const rest = await refund(intent.id, 'rest of the intent');
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body).toMatchObject({ amount: -30, status: 'REFUNDED', refundOfPaymentId: intent.id, invoiceStatus: 'SENT' });
    expect(await balanceOf(inv)).toMatchObject({ paid: 100, refunded: 100, net: 0, remaining: 100 });
    expect((await invoiceRow(inv)).status).toBe('SENT');

    const again = await refund(intent.id, 'again');
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.message).toMatch(/already refunded/i);
    // V1-29c: the webhook posted its 20 as a partial refund, the manual rest (30) reversed the intent's posting
    // and folded the 20 back; the manual refund reversed the session's. One reversal each, nothing twice.
    expect(await reversalsFor(intent.id)).toHaveLength(1);
    expect(await reversalsFor(session.id)).toHaveLength(1);
    await expectLedgerAgrees(inv, { net: 0, reversals: 2 });
  });

  it('RF-13: a refund never takes the invoice below nothing received: a cash 100 beside a stray -100 refund row of another provider that links to no payment -> 409 "already refunded"; nothing written', async () => {
    const inv = ID.invStray;
    const cash = await paid(inv, 100, 'V29A-STRAY');
    await db.payment.create({
      data: {
        id: `${inv}_stray`, businessId: ID.bizA, invoiceId: inv, amount: -100, currency: 'TTD', status: 'REFUNDED',
        provider: 'paypal', providerPaymentId: `${P}paypal_refund_stray`, reference: null,
      },
    });
    const rowsBefore = await paymentsOf(inv);
    expect(await balanceOf(inv)).toMatchObject({ net: 0 });

    const res = await refund(cash.id, 'stray');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(/already refunded/i);
    expect(await paymentsOf(inv)).toEqual(rowsBefore);
    expect(await reversalsFor(cash.id)).toHaveLength(0);
  });
});

describe('V1-29 review: rows the manual refund flipped before V1-29 (CR-V29-4)', () => {
  it('RF-14: a pre-V1-29 flipped 60 on a 100 invoice reads paidAmount 0, remaining 100 in listPayments and the operator read (not -60 / 160); 40 then 60 paid -> PARTIALLY_PAID then PAID at the true total; the ledger cash net equals the stored balance net', async () => {
    const inv = ID.invLegacy;
    const sixty = await paid(inv, 60, 'V29A-LEGACY-60');
    // The pre-V1-29 manual refund, as it wrote it: the row flipped to REFUNDED
    // (positive amount kept) and its posting reversed once.
    await db.payment.update({ where: { id: sixty.id }, data: { status: 'REFUNDED' } });
    await revenuePosting.onPaymentRefunded(sixty.id, { createdById: ID.ownerA });
    expect(await rawBalanceOf(inv), 'computeBalance alone subtracts the flipped row twice').toMatchObject({ net: -60, remaining: 160 });
    expect(await balanceOf(inv)).toMatchObject({ paid: 60, refunded: 60, net: 0, remaining: 100 });

    // RED-BEFORE (V1-29 head 3c8de27f): paidAmount -60, remaining 160 on both reads.
    const list = await listPayments(inv);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body).toMatchObject({ paidAmount: 0, remaining: 100 });
    expect(await commerce.getInvoiceForBusiness(inv, ID.bizA)).toMatchObject({ paidAmount: 0, remaining: 100 });
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });

    const forty = await pay(inv, { amount: 40, method: 'cash', reference: 'V29A-LEGACY-40' });
    expect(forty.status, JSON.stringify(forty.body)).toBe(201);
    expect(forty.body).toMatchObject({ paidAmount: 40, remaining: 60 });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');

    const rest = await pay(inv, { amount: 60, method: 'cash', reference: 'V29A-LEGACY-60B' });
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body).toMatchObject({ paidAmount: 100, remaining: 0 });
    const row = await invoiceRow(inv);
    expect(row.status, 'computeBalance alone would read net 40 and keep PARTIALLY_PAID').toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    expect(await balanceOf(inv)).toMatchObject({ net: 100, remaining: 0, isFullyPaid: true, isOverpaid: false });
    await expectLedgerAgrees(inv, { net: 100, reversals: 1 });

    // The flipped row itself is still not refundable (RF-04).
    expect((await refund(sixty.id, 'legacy')).status).toBe(409);
  });
});

describe('V1-29 review findings outside the V1-29 write set (owner decision; it.todo)', () => {
  // Was it.todo; made real by V1-29c-REFUND-WRITE-DOOR (RevenuePostingService.onPaymentRefunded names the refund row).
  it('SEC-V29-2: the FINANCE payment_refunded audit row of a manual refund names the amount refunded and the refund row (a "what is left" refund of 60 after a provider -40 records data.amount 100, the original\'s amount): needs a refund amount / refund id option on RevenuePostingService.onPaymentRefunded (finance/revenue-posting.service.ts, outside the write set)', async () => {
    const inv = ID.invAuditLeft;
    await paymentsSvc.processStripeChargeOrSession(
      'payment_intent.succeeded',
      { id: `${P}pi_left`, amount_received: 10000, currency: 'ttd', latest_charge: `${P}ch_left`, metadata: { invoiceId: inv } },
      `${P}evt_left_pi`,
    );
    const [intent] = await paymentsOf(inv);
    await paymentsSvc.processStripeRefund('refund.created', {
      id: `${P}re_left`, amount: 4000, currency: 'ttd', charge: `${P}ch_left`, payment_intent: `${P}pi_left`, status: 'succeeded',
    });
    await expectLedgerAgrees(inv, { net: 60, reversals: 0 });

    const res = await refund(intent.id, 'what is left');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ amount: -60, refundOfPaymentId: intent.id, invoiceStatus: 'SENT' });
    const audit = await db.activity.findMany({ where: { businessId: ID.bizA, module: 'FINANCE', action: 'payment_refunded', entityId: intent.id } });
    expect(audit).toHaveLength(1);
    // RED-BEFORE (int/trial-I 7f4b81a2): data.amount 100 and no refund row named.
    expect(audit[0].data).toMatchObject({ amount: 60, paymentAmount: 100, refundPaymentId: res.body.id, refundedBy: ID.ownerA });
    await expectLedgerAgrees(inv, { net: 0, reversals: 1 });
  });
  it.todo(
    'CR-V29-1: the invoice / reminder email context states paid = computeBalance.paid (gross) and amountRemaining = total - gross, so a reminder for a refunded invoice reads "TT$0.00 awaiting payment"; the evidence-match candidates sum SUCCESSFUL rows the same way (commerce/commerce.controller.ts buildInvoiceEmailContext and extractPaymentEvidence, outside the write set)',
  );
  it.todo(
    'CR-V29-2: CASH-basis receivables (getAging, getCustomerBalance) count SUCCESSFUL rows only and relied on the flip, so a refunded invoice that is owed again reads outstanding 0 (finance/receivables.service.ts, outside the write set; or accepted until V1-36)',
  );
  it.todo(
    'CR-V29-3: after a full refund and a new payment the receipt email and the public receipt state amountPaid = gross paid (TT$200.00 on a TT$100 invoice; net received 100) (commerce/invoice-receipt.listener.ts, commerce/invoice-receipt-builder.service.ts, outside the write set)',
  );
});
