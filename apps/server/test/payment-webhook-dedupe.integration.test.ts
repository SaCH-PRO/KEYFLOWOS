/**
 * V1-15c-PAYMENT-INGRESS-AND-READERS — a provider webhook's dedupe claim never
 * outlives a payment transaction that aborted (REAL database, REAL HTTP through
 * PaymentsController, REAL posting and invoice workflow).
 *
 * The V1-15 verification (wf_b1b62614-511) found the ordering behind LWD-07 and
 * LWD-21's history: every provider handler commits its webhook_events row
 * (InvoiceWorkflowService.assertNewProviderEvent) BEFORE the payment
 * transaction runs. When that transaction aborts (P2028 behind a lock, a
 * deadlock, a failed posting), the payment is rolled back but the claim
 * stays, so the provider's redelivery is acked as a duplicate and the payment
 * is never recorded. WiPay's callback swallowed the failure into
 * { success: false } with the claim kept; the provider refund paths swallowed
 * an aborted refund transaction and acked the delivery as processed.
 *
 * Contract pinned here (each abort is injected inside the payment transaction,
 * after the Payment row is written, as a Prisma P2028):
 *
 *   WDD-01  Stripe checkout.session.completed: the aborted delivery answers 500
 *           and leaves no Payment row and no claim; the redelivery records the
 *           payment once and posts it once, the invoice is PAID; a third
 *           delivery is a duplicate and writes nothing
 *   WDD-02  PayPal PAYMENT.CAPTURE.COMPLETED: the same (signature verification
 *           stubbed; no network)
 *   WDD-03  PayPal CHECKOUT.ORDER.COMPLETED with two captures, the second
 *           aborting: the first capture stays recorded, the claim is released;
 *           the redelivery records the second once (never the first twice)
 *   WDD-04  WiPay success callback: the aborted callback answers
 *           { success: false } and leaves no row and no claim; the redelivery
 *           records the payment once; a third is 'Duplicate callback ignored'
 *   WDD-05  Stripe charge.refunded whose refund transaction aborts: the
 *           delivery answers 500 (it was acked as processed), no refund row and
 *           no claim; the redelivery records the refund once and reverses the
 *           original posting once
 *   WDD-06  (control) two concurrent deliveries of one Stripe event record and
 *           post the payment once, and both are answered 201
 *   WDD-07  the ledger of the tenant balances, and every claim left is one whose
 *           event was handled
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (on a
 * real Redis, its keys namespaced to this run), PaymentsService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService,
 * AccountingPeriodService and ChartOfAccountsSeederService read and write real
 * rows, and the production GlobalHttpExceptionFilter is installed, so a status
 * is the production one. The provider edges are the stand-ins: Stripe deliveries
 * are signed with the business's own webhook secret, WiPay's hash is computed
 * as WiPay does, and PayPal's signature verification (a network call) is
 * stubbed. CommerceService is a stub (no webhook path reaches it); EventEmitter2,
 * the timeline and COGS posting are stubs off the ledger path.
 *
 * Fixtures: prefix `v15c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PaymentsService } from '../src/modules/payments/payments.service';
import type { RevenuePostingService } from '../src/modules/finance/revenue-posting.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v15c_';
/** The business's own Stripe webhook secret (business.metaData.stripeWebhookSecret), so no global env is touched. */
const STRIPE_SECRET = `whsec_${P}stripe`;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  invStripe: `${P}invStripe`,
  invPaypal: `${P}invPaypal`,
  invPaypalOrder: `${P}invPaypalOrder`,
  invWipay: `${P}invWipay`,
  invRefund: `${P}invRefund`,
  invRace: `${P}invRace`,
};

let db: any;
let app: any;
let redis: any;
let payments: PaymentsService;
let revenuePosting: RevenuePostingService;

const eventStub = {
  emit: () => true,
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** A Stripe delivery of `event`, signed with the business's webhook secret as Stripe signs it. */
function stripe(event: Record<string, unknown>) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', STRIPE_SECRET).update(`${t}.${raw}`).digest('hex')}`;
  return agent().post('/payments/stripe/webhook').set('content-type', 'application/json').set('stripe-signature', signature).send(raw);
}

/** A PayPal delivery of `event` (its signature verification is stubbed). */
function paypal(event: Record<string, unknown>) {
  return agent().post('/payments/paypal/webhook').set('content-type', 'application/json').send(JSON.stringify(event));
}

/** A WiPay success callback for `invoiceId`, hashed as WiPay hashes it. */
function wipay(invoiceId: string, transactionId: string, total: string) {
  const q = { order_id: invoiceId, status: 'success', transaction_id: transactionId, total };
  const hash = createHash('md5').update(`${q.transaction_id}${q.order_id}${q.total}${q.status}`).digest('hex');
  return agent().get('/payments/wipay/callback').query({ ...q, hash });
}

/** The P2028 a payment transaction gets when it expires behind a lock (LWD-21's history). */
function p2028(): Error {
  return new Prisma.PrismaClientKnownRequestError(
    'Transaction API error: Transaction already closed: the transaction was aborted (injected by V1-15c)',
    { code: 'P2028', clientVersion: Prisma.prismaVersion.client },
  );
}

/**
 * Inject an abort into the `nth` call (1-based) of RevenuePostingService.`method`,
 * which every provider payment / refund transaction makes after writing its
 * Payment row. Every other call runs the real posting. Returns the restore.
 */
function abortPostingCall(method: 'onPaymentRecorded' | 'onPaymentRefunded', nth = 1): () => void {
  const real = (revenuePosting as any)[method].bind(revenuePosting);
  let calls = 0;
  const spy = vi.spyOn(revenuePosting as any, method).mockImplementation(async (...args: unknown[]) => {
    calls += 1;
    if (calls === nth) throw p2028();
    return real(...args);
  });
  return () => spy.mockRestore();
}

async function rowsOf(invoiceId: string): Promise<string[]> {
  const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
  return rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}`);
}

async function postingsOf(invoiceId: string): Promise<string[]> {
  const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  const txns = await db.financialTransaction.findMany({
    where: { sourceType: 'Payment', sourceId: { in: rows.map((r: any) => r.id) } },
    orderBy: { createdAt: 'asc' },
  });
  return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`);
}

async function claims(provider: string, providerEventId: string): Promise<number> {
  return db.webhookEvent.count({ where: { provider, providerEventId } });
}

async function invoiceStatus(id: string): Promise<string> {
  return (await db.invoice.findUnique({ where: { id }, select: { status: true } })).status;
}

async function seedInvoice(id: string, n: number, total: number) {
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V15C-${String(n).padStart(3, '0')}`,
      status: 'SENT',
      subtotal: total,
      total,
      currency: 'TTD',
      businessId: ID.biz,
      contactId: ID.contact,
      items: { create: [{ id: `${id}_item1`, description: `v15c item ${n}`, quantity: 1, unitPrice: total, total }] },
    },
  });
}

beforeAll(async () => {
  // This run's own rate-limit keys (PublicRateLimitGuard reads it in NODE_ENV=test).
  process.env.RATE_LIMIT_KEY_NAMESPACE = `${P}${Date.now()}`;
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
  const { PaymentsService: PaymentsCtor } = await import('../src/modules/payments/payments.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { RevenuePostingService: RevenuePostingCtor } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentsController],
    providers: [
      PrismaService,
      PublicRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      PaymentsCtor,
      InvoiceWorkflowService,
      // The real ledger chain, including the period ledger the door consults.
      RevenuePostingCtor,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      // No webhook path reaches CommerceService (it serves the token routes).
      { provide: CommerceService, useValue: {} },
    ],
  }).compile();
  payments = moduleRef.get(PaymentsCtor);
  revenuePosting = moduleRef.get(RevenuePostingCtor);
  // PayPal's verify-webhook-signature is a network call: the provider edge is stubbed.
  vi.spyOn(payments as any, 'verifyPaypalSignature').mockResolvedValue(true);

  // rawBody: the Stripe and PayPal webhooks read the raw payload, as in app-bootstrap.
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.biz, name: 'V15C Biz', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH', metaData: { stripeWebhookSecret: STRIPE_SECRET } },
  });
  await db.membership.create({ data: { id: `${ID.biz}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V15C', lastName: 'Payer', email: `${P}payer@test.local` } });
  let n = 0;
  for (const id of [ID.invStripe, ID.invPaypal, ID.invPaypalOrder, ID.invWipay, ID.invRefund, ID.invRace]) {
    n += 1;
    await seedInvoice(id, n, 100);
  }
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

describe('fixture sanity (real rows)', () => {
  it('seeded one tenant with a chart of accounts and six SENT invoices, with no payment and no claim', async () => {
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz } })).toBeGreaterThan(5);
    expect(await db.invoice.count({ where: { businessId: ID.biz, status: 'SENT' } })).toBe(6);
    expect(await db.payment.count({ where: { businessId: ID.biz } })).toBe(0);
    expect(await db.webhookEvent.count({ where: { providerEventId: { startsWith: P } } })).toBe(0);
  });
});

describe('V1-15c: a provider delivery whose payment transaction aborts is not acked as handled on redelivery', () => {
  it('WDD-01: Stripe checkout.session.completed: the aborted delivery is a 500 with no row and no claim; the redelivery records and posts it once; a third is a duplicate', async () => {
    const event = {
      id: `${P}evt_cs`,
      type: 'checkout.session.completed',
      data: { object: { id: `${P}cs_1`, metadata: { invoiceId: ID.invStripe }, amount_total: 10000, currency: 'ttd' } },
    };
    const restore = abortPostingCall('onPaymentRecorded');
    try {
      const first = await stripe(event);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
    } finally {
      restore();
    }
    expect(await rowsOf(ID.invStripe), 'the payment transaction rolled back').toEqual([]);
    // Before V1-15c: 1 (the claim committed before the payment transaction ran).
    expect(await claims('stripe', event.id), 'the aborted delivery left its claim').toBe(0);

    const again = await stripe(event);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    // Before V1-15c: { ok: true, received: true } (acked as a duplicate) and the payment was never recorded.
    expect(again.body).toEqual({ ok: true, received: true, processed: 'checkout.session.completed' });
    expect(await rowsOf(ID.invStripe)).toEqual([`stripe:${P}cs_1:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invStripe)).toEqual(['INCOME:POSTED:100']);
    expect(await invoiceStatus(ID.invStripe)).toBe('PAID');
    expect(await claims('stripe', event.id)).toBe(1);

    const third = await stripe(event);
    expect(third.status).toBe(201);
    expect(third.body).toEqual({ ok: true, received: true });
    expect(await rowsOf(ID.invStripe)).toEqual([`stripe:${P}cs_1:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invStripe)).toEqual(['INCOME:POSTED:100']);
  });

  it('WDD-02: PayPal PAYMENT.CAPTURE.COMPLETED: the aborted delivery is a 500 with no row and no claim; the redelivery records and posts it once; a third is a duplicate', async () => {
    const event = {
      id: `${P}WH-capture`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: `${P}CAP_1`, custom_id: ID.invPaypal, amount: { value: '100.00', currency_code: 'TTD' } },
    };
    const restore = abortPostingCall('onPaymentRecorded');
    try {
      const first = await paypal(event);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
    } finally {
      restore();
    }
    expect(await rowsOf(ID.invPaypal)).toEqual([]);
    expect(await claims('paypal', event.id), 'the aborted delivery left its claim').toBe(0);

    const again = await paypal(event);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.COMPLETED' });
    expect(await rowsOf(ID.invPaypal)).toEqual([`paypal:${P}CAP_1:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invPaypal)).toEqual(['INCOME:POSTED:100']);
    expect(await invoiceStatus(ID.invPaypal)).toBe('PAID');

    const third = await paypal(event);
    expect(third.body).toEqual({ ok: true, received: true });
    expect(await rowsOf(ID.invPaypal)).toEqual([`paypal:${P}CAP_1:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invPaypal)).toEqual(['INCOME:POSTED:100']);
  });

  it('WDD-03: PayPal CHECKOUT.ORDER.COMPLETED with two captures, the second aborting: the first stays recorded and the claim is released; the redelivery records the second once', async () => {
    const event = {
      id: `${P}WH-order`,
      event_type: 'CHECKOUT.ORDER.COMPLETED',
      resource: {
        id: `${P}ORDER_1`,
        purchase_units: [
          {
            custom_id: ID.invPaypalOrder,
            payments: {
              captures: [
                { id: `${P}CAP_A`, amount: { value: '60.00', currency_code: 'TTD' } },
                { id: `${P}CAP_B`, amount: { value: '40.00', currency_code: 'TTD' } },
              ],
            },
          },
        ],
      },
    };
    const restore = abortPostingCall('onPaymentRecorded', 2);
    try {
      const first = await paypal(event);
      expect(first.status, JSON.stringify(first.body)).toBe(500);
    } finally {
      restore();
    }
    expect(await rowsOf(ID.invPaypalOrder)).toEqual([`paypal:${P}CAP_A:SUCCESSFUL:60`]);
    expect(await claims('paypal', event.id), 'the half-handled delivery left its claim').toBe(0);

    const again = await paypal(event);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true, processed: 'CHECKOUT.ORDER.COMPLETED' });
    expect(await rowsOf(ID.invPaypalOrder)).toEqual([`paypal:${P}CAP_A:SUCCESSFUL:60`, `paypal:${P}CAP_B:SUCCESSFUL:40`]);
    expect(await postingsOf(ID.invPaypalOrder)).toEqual(['INCOME:POSTED:60', 'INCOME:POSTED:40']);
    expect(await invoiceStatus(ID.invPaypalOrder)).toBe('PAID');

    expect((await paypal(event)).body).toEqual({ ok: true, received: true });
    expect(await rowsOf(ID.invPaypalOrder)).toHaveLength(2);
  });

  it("WDD-04: WiPay success callback: the aborted callback answers { success: false } with no row and no claim; the redelivery records and posts it once; a third is 'Duplicate callback ignored'", async () => {
    const txn = `${P}wipay_txn`;
    const restore = abortPostingCall('onPaymentRecorded');
    try {
      const first = await wipay(ID.invWipay, txn, '100.00');
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ success: false, message: 'Payment processing error' });
    } finally {
      restore();
    }
    expect(await rowsOf(ID.invWipay)).toEqual([]);
    // Before V1-15c: 1, and every redelivery answered 'Duplicate callback ignored' with no payment recorded.
    expect(await claims('wipay', txn), 'the aborted callback left its claim').toBe(0);

    const again = await wipay(ID.invWipay, txn, '100.00');
    expect(again.body).toMatchObject({ success: true, invoiceId: ID.invWipay, message: 'Payment successful' });
    expect(await rowsOf(ID.invWipay)).toEqual([`wipay:${txn}:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invWipay)).toEqual(['INCOME:POSTED:100']);
    expect(await invoiceStatus(ID.invWipay)).toBe('PAID');

    const third = await wipay(ID.invWipay, txn, '100.00');
    expect(third.body).toMatchObject({ success: true, message: 'Duplicate callback ignored' });
    expect(await rowsOf(ID.invWipay)).toHaveLength(1);
    expect(await postingsOf(ID.invWipay)).toEqual(['INCOME:POSTED:100']);
  });

  it('WDD-05: Stripe charge.refunded whose refund transaction aborts is a 500 with no refund row and no claim; the redelivery records the refund once and reverses the original posting once', async () => {
    const charge = { id: `${P}ch_refund`, metadata: { invoiceId: ID.invRefund }, amount: 10000, currency: 'ttd' };
    const paid = await stripe({ id: `${P}evt_charge`, type: 'charge.succeeded', data: { object: charge } });
    expect(paid.body, JSON.stringify(paid.body)).toEqual({ ok: true, received: true, processed: 'charge.succeeded' });
    expect(await postingsOf(ID.invRefund)).toEqual(['INCOME:POSTED:100']);

    const event = {
      id: `${P}evt_refund`,
      type: 'charge.refunded',
      data: {
        object: {
          ...charge,
          refunds: { data: [{ id: `${P}re_1`, amount: 10000, currency: 'ttd', charge: charge.id, status: 'succeeded' }] },
        },
      },
    };
    const restore = abortPostingCall('onPaymentRefunded');
    try {
      const first = await stripe(event);
      // Before V1-15c: 201 { processed: 'charge.refunded' }: the aborted refund was swallowed and the delivery acked.
      expect(first.status, JSON.stringify(first.body)).toBe(500);
    } finally {
      restore();
    }
    expect(await rowsOf(ID.invRefund)).toEqual([`stripe:${P}ch_refund:SUCCESSFUL:100`]);
    expect(await claims('stripe', event.id), 'the aborted refund delivery left its claim').toBe(0);

    const again = await stripe(event);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true, processed: 'charge.refunded' });
    expect(await rowsOf(ID.invRefund)).toEqual([`stripe:${P}ch_refund:SUCCESSFUL:100`, `stripe:${P}re_1:REFUNDED:-100`]);
    expect(await postingsOf(ID.invRefund)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);

    expect((await stripe(event)).body).toEqual({ ok: true, received: true });
    expect(await rowsOf(ID.invRefund)).toHaveLength(2);
    expect(await postingsOf(ID.invRefund)).toHaveLength(2);
  });

  it('WDD-06 (control): two concurrent deliveries of one Stripe event record and post the payment once; both are answered 201', async () => {
    const event = {
      id: `${P}evt_race`,
      type: 'checkout.session.completed',
      data: { object: { id: `${P}cs_race`, metadata: { invoiceId: ID.invRace }, amount_total: 10000, currency: 'ttd' } },
    };
    const [a, b] = await Promise.all([stripe(event), stripe(event)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.processed, b.body.processed].filter(Boolean)).toEqual(['checkout.session.completed']);
    expect(await rowsOf(ID.invRace)).toEqual([`stripe:${P}cs_race:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invRace)).toEqual(['INCOME:POSTED:100']);
    expect(await claims('stripe', event.id)).toBe(1);
  });

  it('WDD-07: the tenant ledger balances, and every claim left belongs to an event whose payment is recorded', async () => {
    const unbalanced = await db.$queryRawUnsafe(
      `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
      ID.biz,
    );
    expect(unbalanced).toEqual([]);
    const left = await db.webhookEvent.findMany({ where: { providerEventId: { startsWith: P } } });
    expect(left.map((c: any) => `${c.provider}:${c.providerEventId}`).sort()).toEqual([
      `paypal:${P}WH-capture`,
      `paypal:${P}WH-order`,
      `stripe:${P}evt_charge`,
      `stripe:${P}evt_cs`,
      `stripe:${P}evt_race`,
      `stripe:${P}evt_refund`,
      `wipay:${P}wipay_txn`,
    ]);
  });
});
