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
 *
 *   Review repairs (SEC-V15C-1, CR-V15C-2, SEC-V15C-3):
 *
 *   WDD-08  two partial Stripe refunds of one charge delivered together: both
 *           refund transactions reverse the same original posting, the loser
 *           fails on financial_transactions.reversal_of_id (a P2002 that is not
 *           its own refund row) and its row is rolled back. That delivery is a
 *           500 with its claim released (it was acked as processed and the
 *           refund was never recorded); its redelivery records it
 *   WDD-09  the same for two PayPal PAYMENT.CAPTURE.REFUNDED deliveries of one
 *           capture (PayPal sends no cumulative event that would heal it)
 *   WDD-10  a Stripe refund signed with a tenant's OWN webhook secret refunds
 *           that tenant's payments only: one naming its own invoice and another
 *           tenant's charge writes nothing on the victim and reverses nothing;
 *           the victim's own signed refund of that charge is recorded (control)
 *
 *   WDD-07  the ledger of each tenant balances, and every claim left is one whose
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
/** Another tenant's own Stripe webhook secret (WDD-10). */
const STRIPE_SECRET_B = `whsec_${P}stripeB`;
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
  // Review repairs (SEC-V15C-1, CR-V15C-2, SEC-V15C-3)
  invStripeSplit: `${P}invStripeSplit`, // two partial Stripe refunds of one charge, together
  invPaypalSplit: `${P}invPaypalSplit`, // two partial PayPal refunds of one capture, together
  invForge: `${P}invForge`, // the invoice a forged refund names in its metadata (biz's own)
  ownerB: `${P}ownerB`,
  bizB: `${P}bizB`, // the tenant whose charge the forged refund names
  contactB: `${P}contactB`,
  invVictim: `${P}invVictim`,
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

/** A Stripe delivery of `event`, signed with a business's webhook secret (biz's by default) as Stripe signs it. */
function stripe(event: Record<string, unknown>, secret = STRIPE_SECRET) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
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

/**
 * Hold the first `n` calls of RevenuePostingService.onPaymentRefunded (each
 * made inside a refund transaction, after its refund row is written) until all
 * `n` have arrived, or `ms` passed; then each runs the real posting. The `n`
 * refund transactions reach the reversal of one original together.
 */
function refundBarrier(n = 2, ms = 3_000): () => void {
  const real = (revenuePosting as any).onPaymentRefunded.bind(revenuePosting);
  let arrived = 0;
  let release: () => void = () => undefined;
  const together = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(() => release(), ms);
  const spy = vi.spyOn(revenuePosting as any, 'onPaymentRefunded').mockImplementation(async (...args: unknown[]) => {
    arrived += 1;
    if (arrived <= n) {
      if (arrived === n) release();
      await together;
    }
    return real(...args);
  });
  return () => {
    clearTimeout(timer);
    spy.mockRestore();
  };
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

async function seedInvoice(id: string, n: number, total: number, businessId: string = ID.biz, contactId: string = ID.contact) {
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V15C-${String(n).padStart(3, '0')}`,
      status: 'SENT',
      subtotal: total,
      total,
      currency: 'TTD',
      businessId,
      contactId,
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
  for (const id of [
    ID.invStripe,
    ID.invPaypal,
    ID.invPaypalOrder,
    ID.invWipay,
    ID.invRefund,
    ID.invRace,
    ID.invStripeSplit,
    ID.invPaypalSplit,
    ID.invForge,
  ]) {
    n += 1;
    await seedInvoice(id, n, 100);
  }

  // Another tenant with its own Stripe webhook secret (WDD-10).
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizB, name: 'V15C Biz B', ownerId: ID.ownerB, currency: 'TTD', accountingBasis: 'CASH', metaData: { stripeWebhookSecret: STRIPE_SECRET_B } },
  });
  await db.membership.create({ data: { id: `${ID.bizB}_m`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await moduleRef.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V15C', lastName: 'Victim', email: `${P}victim@test.local` } });
  await seedInvoice(ID.invVictim, 50, 100, ID.bizB, ID.contactB);
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
  it('seeded two tenants with a chart of accounts and SENT invoices (nine and one), with no payment and no claim', async () => {
    expect(await db.chartOfAccount.count({ where: { businessId: ID.biz } })).toBeGreaterThan(5);
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizB } })).toBeGreaterThan(5);
    expect(await db.invoice.count({ where: { businessId: ID.biz, status: 'SENT' } })).toBe(9);
    expect(await db.invoice.count({ where: { businessId: ID.bizB, status: 'SENT' } })).toBe(1);
    expect(await db.payment.count({ where: { businessId: { in: [ID.biz, ID.bizB] } } })).toBe(0);
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

  it('WDD-08 (review SEC-V15C-1, CR-V15C-2): two partial Stripe refunds of one charge delivered together: the one whose reversal loses is a 500 with its claim released, not acked; its redelivery records it', async () => {
    const charge = { id: `${P}ch_split`, metadata: { invoiceId: ID.invStripeSplit }, amount: 10000, currency: 'ttd' };
    const paid = await stripe({ id: `${P}evt_charge_split`, type: 'charge.succeeded', data: { object: charge } });
    expect(paid.body, JSON.stringify(paid.body)).toEqual({ ok: true, received: true, processed: 'charge.succeeded' });

    const refundEvent = (n: string, amount: number) => ({
      id: `${P}evt_refund_${n}`,
      type: 'refund.created',
      data: {
        object: { id: `${P}re_split_${n}`, amount, currency: 'ttd', charge: charge.id, status: 'succeeded', metadata: { invoiceId: ID.invStripeSplit } },
      },
    });
    const events = [refundEvent('a', 3000), refundEvent('b', 2000)];
    const restore = refundBarrier();
    let together: Array<{ status: number; body: any }>;
    try {
      together = await Promise.all(events.map((e) => stripe(e)));
    } finally {
      restore();
    }
    // Before the review repair: [201, 201], both { processed: 'refund.created' }, one refund row missing and both claims kept
    // (the loser's P2002 was on financial_transactions.reversal_of_id, not on its own refund row).
    expect(together.map((r) => r.status).sort(), JSON.stringify(together.map((r) => r.body))).toEqual([201, 500]);
    const won = events[together.findIndex((r) => r.status === 201)];
    const lost = events[together.findIndex((r) => r.status === 500)];
    expect(together.find((r) => r.status === 201)!.body).toEqual({ ok: true, received: true, processed: 'refund.created' });
    expect(await rowsOf(ID.invStripeSplit)).toEqual([
      `stripe:${charge.id}:SUCCESSFUL:100`,
      `stripe:${won.data.object.id}:REFUNDED:${-won.data.object.amount / 100}`,
    ]);
    expect(await claims('stripe', won.id)).toBe(1);
    expect(await claims('stripe', lost.id), 'the delivery whose refund was rolled back released its claim').toBe(0);

    const again = await stripe(lost);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true, processed: 'refund.created' });
    expect((await rowsOf(ID.invStripeSplit)).sort()).toEqual(
      [`stripe:${charge.id}:SUCCESSFUL:100`, `stripe:${P}re_split_a:REFUNDED:-30`, `stripe:${P}re_split_b:REFUNDED:-20`].sort(),
    );
    // The original posting is reversed once: a refund reverses the whole capture's posting (partial refunds are V1-29-DM-REFUND-CONVENTION's).
    expect(await postingsOf(ID.invStripeSplit)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    expect(await claims('stripe', lost.id)).toBe(1);

    expect((await stripe(lost)).body).toEqual({ ok: true, received: true });
    expect(await rowsOf(ID.invStripeSplit)).toHaveLength(3);
  });

  it('WDD-09 (review SEC-V15C-1): two partial PayPal refunds of one capture delivered together: the one whose reversal loses is a 500 with its claim released, not acked; its redelivery records it', async () => {
    const capture = `${P}CAP_SPLIT`;
    const paid = await paypal({
      id: `${P}WH-capture-split`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: capture, custom_id: ID.invPaypalSplit, amount: { value: '100.00', currency_code: 'TTD' } },
    });
    expect(paid.body, JSON.stringify(paid.body)).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.COMPLETED' });

    const refundEvent = (n: string, value: string) => ({
      id: `${P}WH-refund-${n}`,
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: `${P}RF_${n}`, amount: { value, currency_code: 'TTD' }, supplementary_data: { related_ids: { capture_id: capture } } },
    });
    const events = [refundEvent('A', '30.00'), refundEvent('B', '20.00')];
    const restore = refundBarrier();
    let together: Array<{ status: number; body: any }>;
    try {
      together = await Promise.all(events.map((e) => paypal(e)));
    } finally {
      restore();
    }
    // Before the review repair: [201, 201], both { processed: 'PAYMENT.CAPTURE.REFUNDED' }, one refund row missing, both claims kept.
    expect(together.map((r) => r.status).sort(), JSON.stringify(together.map((r) => r.body))).toEqual([201, 500]);
    const won = events[together.findIndex((r) => r.status === 201)];
    const lost = events[together.findIndex((r) => r.status === 500)];
    expect(await rowsOf(ID.invPaypalSplit)).toEqual([
      `paypal:${capture}:SUCCESSFUL:100`,
      `paypal:${won.resource.id}:REFUNDED:${-Number(won.resource.amount.value)}`,
    ]);
    expect(await claims('paypal', won.id)).toBe(1);
    expect(await claims('paypal', lost.id), 'the delivery whose refund was rolled back released its claim').toBe(0);

    const again = await paypal(lost);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.REFUNDED' });
    expect((await rowsOf(ID.invPaypalSplit)).sort()).toEqual(
      [`paypal:${capture}:SUCCESSFUL:100`, `paypal:${P}RF_A:REFUNDED:-30`, `paypal:${P}RF_B:REFUNDED:-20`].sort(),
    );
    expect(await postingsOf(ID.invPaypalSplit)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
    expect(await claims('paypal', lost.id)).toBe(1);

    expect((await paypal(lost)).body).toEqual({ ok: true, received: true });
    expect(await rowsOf(ID.invPaypalSplit)).toHaveLength(3);
  });

  it("WDD-10 (review SEC-V15C-3): a Stripe refund signed with a tenant's own secret, naming its own invoice and another tenant's charge, writes nothing on the victim and reverses nothing; the victim's own signed refund of that charge is recorded", async () => {
    const chargeB = { id: `${P}ch_victim`, metadata: { invoiceId: ID.invVictim }, amount: 10000, currency: 'ttd' };
    const paidB = await stripe({ id: `${P}evt_charge_victim`, type: 'charge.succeeded', data: { object: chargeB } }, STRIPE_SECRET_B);
    expect(paidB.body, JSON.stringify(paidB.body)).toEqual({ ok: true, received: true, processed: 'charge.succeeded' });
    expect(await rowsOf(ID.invVictim)).toEqual([`stripe:${chargeB.id}:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invVictim)).toEqual(['INCOME:POSTED:100']);
    expect(await invoiceStatus(ID.invVictim)).toBe('PAID');

    // biz signs with ITS OWN secret: its own invoice in metadata (so its secret is the one tried), bizB's charge.
    const forged = {
      id: `${P}evt_refund_forged`,
      type: 'refund.created',
      data: { object: { id: `${P}re_forged`, amount: 10000, currency: 'ttd', charge: chargeB.id, status: 'succeeded', metadata: { invoiceId: ID.invForge } } },
    };
    const res = await stripe(forged, STRIPE_SECRET);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Before the review repair: bizB's rows [ch_victim SUCCESSFUL 100, re_forged REFUNDED -100], its posting reversed, its invoice still PAID.
    expect(await rowsOf(ID.invVictim)).toEqual([`stripe:${chargeB.id}:SUCCESSFUL:100`]);
    expect(await postingsOf(ID.invVictim)).toEqual(['INCOME:POSTED:100']);
    expect(await invoiceStatus(ID.invVictim)).toBe('PAID');
    expect(await rowsOf(ID.invForge)).toEqual([]);
    expect(await db.payment.count({ where: { providerPaymentId: `${P}re_forged` } })).toBe(0);

    // Control: bizB's own secret, its own invoice and its own charge: the refund is recorded and reverses the posting.
    const own = {
      id: `${P}evt_refund_victim`,
      type: 'refund.created',
      data: { object: { id: `${P}re_victim`, amount: 10000, currency: 'ttd', charge: chargeB.id, status: 'succeeded', metadata: { invoiceId: ID.invVictim } } },
    };
    const ownRes = await stripe(own, STRIPE_SECRET_B);
    expect(ownRes.body, JSON.stringify(ownRes.body)).toEqual({ ok: true, received: true, processed: 'refund.created' });
    expect(await rowsOf(ID.invVictim)).toEqual([`stripe:${chargeB.id}:SUCCESSFUL:100`, `stripe:${P}re_victim:REFUNDED:-100`]);
    expect(await postingsOf(ID.invVictim)).toEqual(['INCOME:REVERSED:100', 'REVERSAL:POSTED:100']);
  });

  it('WDD-07: each tenant ledger balances, and every claim left belongs to an event that was handled (its payment or refund recorded, or refused: WDD-10)', async () => {
    for (const biz of [ID.biz, ID.bizB]) {
      const unbalanced = await db.$queryRawUnsafe(
        `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
        biz,
      );
      expect(unbalanced, biz).toEqual([]);
    }
    const left = await db.webhookEvent.findMany({ where: { providerEventId: { startsWith: P } } });
    expect(left.map((c: any) => `${c.provider}:${c.providerEventId}`).sort()).toEqual([
      `paypal:${P}WH-capture`,
      `paypal:${P}WH-capture-split`,
      `paypal:${P}WH-order`,
      `paypal:${P}WH-refund-A`,
      `paypal:${P}WH-refund-B`,
      `stripe:${P}evt_charge`,
      `stripe:${P}evt_charge_split`,
      `stripe:${P}evt_charge_victim`,
      `stripe:${P}evt_cs`,
      `stripe:${P}evt_race`,
      `stripe:${P}evt_refund`,
      `stripe:${P}evt_refund_a`,
      `stripe:${P}evt_refund_b`,
      `stripe:${P}evt_refund_forged`,
      `stripe:${P}evt_refund_victim`,
      `wipay:${P}wipay_txn`,
    ]);
  });
});
