/**
 * G6PUB-R3-STORE-ORDER-DOORS (V1-87; trial-N repair round 2 g6pub recheck;
 * rulings D-14, D-69, D-76, D-77) — storefront and marketplace order payment
 * fields move only through the paid door (StoreOrderService.completeCheckout)
 * and the refund door (StoreOrderService.refundOrder, CommerceService.
 * markPaymentRefunded), and WiPay is offered only where it can be paid. On a
 * REAL database, through the REAL SiteController and MarketplaceController
 * routes and guards, with the REAL event bus, ledger and listeners.
 *
 * The defects (recheck findings):
 *
 *   G6PUB-RC2-1  POST /marketplace/.../orders/:id/fulfill {action:'refund'}
 *                (any member: AuthGuard + BusinessGuard + rate limit) set a
 *                STOREFRONT order REFUNDED outside the D-14 door: no negative
 *                row, the invoice stayed PAID, the payment SUCCESSFUL, and the
 *                store_order.refunded listener booked an Expense for the
 *                client's refundAmount, also on an UNPAID order (whose offline
 *                completion then answered 409). PATCH .../status 'refunded'
 *                emitted the same event.
 *   G6PUB-RC2-2  PATCH /site/businesses/:id/orders/:orderId/status wrote any
 *                status string: 'REFUNDED' on a PAID order made the D-14 refund
 *                route answer "already refunded" with the books still on.
 *   G6PUB-RC2-4  a WiPay checkout for a business with no WiPay merchant pair
 *                committed the order (and its promo use) before
 *                createStorePayment answered 400; every retry another order.
 *                The storefront could not tell which methods the business takes,
 *                and its retry key (Idempotency-Key) could not cross the CORS
 *                preflight, which does not allow that header.
 *   G6PUB-RC1-4  D-76: a verified WiPay success for a non-TTD payable was
 *                recorded as money in the payable's currency.
 *   G6PUB-RC1-5  D-77: a STANDARD order created paid got status 'paid' with
 *                paymentStatus UNPAID, no invoice and no payment, and emitted
 *                store_order.paid (whose listener wrote a raw PAID invoice
 *                INV-ORD-<n> with no payment and no posting).
 *
 * Contract pinned here:
 *
 *   V87-01  the marketplace fulfil 'refund' of a STOREFRONT order is the D-14
 *           refund door with revenue write: a member with revenue:read is
 *           refused (403) and a partial refundAmount is refused (400), both
 *           writing nothing; the owner's refund writes one negative REFUNDED
 *           row naming the refunder, reverses the posting (deposit net 0),
 *           reopens the invoice (SENT, paidAt cleared), emits one
 *           store_order.refunded and books no Expense; a second refund writes
 *           nothing
 *   V87-02  the marketplace fulfil 'refund' of an UNPAID storefront order is
 *           409 and writes nothing; its offline completion still works
 *   V87-03  PATCH /marketplace/.../status 'refunded' (any case) of a
 *           STOREFRONT order is refused (400): no event, no Expense
 *   V87-04  PATCH /site/.../orders/:id/status accepts only the fulfilment
 *           vocabulary: payment states and unknown strings are 400 and write
 *           nothing, so the refund door still opens afterwards; controls: a
 *           fulfilment status still moves (any case, stored upper-case)
 *   V87-05  a WiPay checkout for a business with no WiPay merchant pair is
 *           refused (400) before the order is written: no order, no
 *           store_order.created, no retry slot. Controls: the same cart in
 *           CASH is an order, and a business with a merchant pair takes a TTD
 *           WiPay order
 *   V87-06  GET /site/storefront/public/:slug/gateways?currency= lists WiPay
 *           only for a business with a merchant pair and a TTD amount, and
 *           carries no key or account number
 *   V87-07  the checkout's retry key may come in the body (idempotencyKey):
 *           the same key answers the same order (one order)
 *   V87-08  D-76: a verified WiPay success for a USD invoice or a USD
 *           storefront order records no money: no payment, the invoice stays
 *           SENT, the order UNPAID; its webhook_events row is kept as refused,
 *           and the business is notified once (a replay writes nothing more).
 *           Control: a TTD storefront order of a business with a merchant pair
 *           is settled by the same callback
 *   V87-09  D-77: a STANDARD order created paid goes through the paid door: a
 *           member with revenue write gets one PAID invoice INV-<orderNumber>,
 *           one SUCCESSFUL payment recorded by them, exactly one balanced
 *           payment_recorded posting, status 'paid' / PAID and one
 *           store_order.paid carrying the invoice (no INV-ORD invoice). A member
 *           with revenue:read (403) and an order with no customer email or phone
 *           (400) write nothing. Control: an unpaid create stays placed / UNPAID
 *
 * Review repairs (G6PUB-R3-STORE-ORDER-DOORS review, at the packet head
 * 5c9f164c each of these was reproduced on this harness):
 *
 *   V87-10  SEC-R3-1: an order created paid (D-77) is refunded through the
 *           marketplace fulfil route only by the D-14 refund door: a member
 *           with revenue:read is refused (403), an amount other than the total
 *           400, and PATCH .../status 'refunded' 400, all writing nothing; the
 *           owner's refund is the D-14 refund on its invoice (no Expense)
 *   V87-11  SEC-R3-1 remainder: the fulfil refund of an order with no payment
 *           on the books (a STANDARD order marked paid by 'mark_paid') books
 *           an Expense, so it takes revenue write (403) and an amount above 0
 *           and up to the order total (400 otherwise); PATCH 'refunded' is 400
 *   V87-12  SEC-R3-2: the site refund route refunds an order created paid on
 *           its invoice (D-14): negative row, posting reversed, invoice SENT,
 *           store_order.refunded naming the invoice, no Expense
 *   V87-13  SEC-R3-3: the payment fields of an order created paid (status
 *           'paid', paymentStatus, paymentMethod, paymentRef) do not move
 *           through PATCH .../status (400, nothing written); its status alone
 *           still moves, and an order with no payment on the books is unchanged
 *   V87-14  SEC-R3-4: a create with a quantity that is not a whole positive
 *           number, a negative fee, tax, duty or discount, or a discount above
 *           the order is refused (400) before anything is written; an order
 *           created paid needs a total above 0. Control: a valid discount and
 *           fee are recorded at their total
 *   V87-15  CR-1: an order created paid for a NEW customer (the real CRM: the
 *           paid door and the store_order.created listener both create the
 *           contact) is answered 201 paid / PAID, with one contact, its invoice
 *           made out to it, and no placed order left behind
 *
 * W10-PAYPAL-CURRENCY (owner ruling D-106: PayPal is not offered for an order
 * in a currency PayPal does not support):
 *
 *   V87-16  the storefront gateway list offers no PayPal for a TTD, JMD, BBD,
 *           GYD or XCD amount, and the PayPal checkout of a TTD cart is
 *           refused 400 PAYPAL_CURRENCY_UNSUPPORTED before PayPal is called
 *           (the PayPal SDK client is stubbed in this case only); control: a
 *           USD cart is offered PayPal and checks out a USD order. The order
 *           itself is still written before the refusal, as it was before
 *           D-106 when PayPal refused the TTD order (StoreOrderService is
 *           outside the W10-PAYPAL-CURRENCY write set)
 *
 * Nothing on the money path or the authorization boundary is mocked:
 * PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard,
 * PublicRateLimitGuard (real Redis, this suite's namespace), SiteService,
 * StoreOrderService, MarketplaceService, PaymentsService, CommerceService (the
 * D-14 door), InvoiceWorkflowService, RevenueAttributionService,
 * RevenuePostingService, ExpensePostingService, PostingService,
 * ChartOfAccountsSeederService, the listener CommerceIntegrationService and
 * CrmService (with EntityResolutionService and ContactAuditService: review
 * CR-1, the contact the paid door and the store_order.created listener both
 * resolve) read and write real rows. The only identity stand-in is a test
 * middleware that reads `x-test-user` and attaches the seeded user, as
 * AuthMiddleware does after token verification. Stand-ins off the money path:
 * the CRM timeline, stats, lists, flow and custom-field caches,
 * SubscriptionsService (contact limit allowed), PublicEventsService, PromoCodeService,
 * InventoryRiskService, TransactionalEmailService, the revenue-posting
 * timeline, ExpensesService (a recorder: store_order.refunded books one), and
 * MarketplaceService.autoRouteOrder (fulfilment routing, held so it writes
 * nothing behind a case). No provider is called: no case starts a WiPay
 * session (every WiPay checkout here is refused before WiPay would be called).
 *
 * Fixtures: prefix `v87c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHash } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v87c_';

const RATE_LIMIT_NS = `${P}${Date.now()}`;
const PREVIOUS_ENV: Record<string, string | undefined> = Object.fromEntries(
  ['RATE_LIMIT_KEY_NAMESPACE', 'WIPAY_API_KEY', 'WIPAY_ACCOUNT_NUMBER', 'PUBLIC_URL_ALLOWLIST'].map((k) => [k, process.env[k]]),
);

const ID = {
  owner: `${P}owner`, // OWNER of every business here
  staffRead: `${P}staff_read`, // STAFF of bizA and bizR, revenue: read
  bizA: `${P}biz_a`, // TTD, its own WiPay merchant pair
  bizNoWipay: `${P}biz_nowipay`, // TTD, no WiPay setting (and no platform pair in this run)
  bizUsd: `${P}biz_usd`, // USD, its own WiPay merchant pair
  // TTD, the review-repair cases (V87-10..15): its own CrmRateLimitGuard buckets (ip:business:route, in memory, 60 s).
  bizR: `${P}biz_r`,
  contactA: `${P}contact_a`,
  contactNoWipay: `${P}contact_nowipay`,
  contactUsd: `${P}contact_usd`,
  contactR: `${P}contact_r`,
  prodA: `${P}prod_a`,
  prodNoWipay: `${P}prod_nowipay`,
  prodUsd: `${P}prod_usd`,
  prodR: `${P}prod_r`,
};
const SLUG = { a: `${P}store-a`, noWipay: `${P}store-nowipay`, usd: `${P}store-usd`, r: `${P}store-r` };
const WIPAY_KEY = `${P}wipay_api_key`;
const WIPAY_ACCOUNT = `${P}wipay_account`;
const PUBLIC_ORIGIN = 'https://shop.v87c.test';
const RETURN_URL = `${PUBLIC_ORIGIN}/book/return`;
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const UNIT_PRICE = 40;
const QUANTITY = 2;
const ORDER_TOTAL = UNIT_PRICE * QUANTITY;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let redis: any;
let storeOrders: any;
let payments: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

/** store_order.* events in emit order, with their payloads. */
let seen: Array<{ name: string; payload: any }> = [];
/** Listener work started by an emit, awaited by settle(). */
const inflight: Promise<unknown>[] = [];
/** Expenses the listener asked ExpensesService to book (store_order.refunded books one). */
const expenses: Array<{ businessId: string; amount: number; notes?: string }> = [];

async function settle() {
  while (inflight.length > 0) {
    await inflight.shift()!.catch(() => undefined);
  }
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR provider_payment_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE business_id LIKE ${sqlLikePrefix(P)} OR provider_event_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  if (!redis) return;
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

function as<T extends { set: (k: string, v: string) => T }>(req: T, actor: string | null): T {
  return actor ? req.set('x-test-user', actor) : req;
}

function fulfil(actor: string | null, orderId: string, body: Record<string, unknown>, businessId = ID.bizA) {
  return as(agent().post(`/marketplace/businesses/${businessId}/orders/${orderId}/fulfill`).send(body), actor);
}

function marketStatus(actor: string | null, orderId: string, body: Record<string, unknown>, businessId = ID.bizA) {
  return as(agent().patch(`/marketplace/businesses/${businessId}/orders/${orderId}/status`).send(body), actor);
}

function marketCreate(actor: string | null, body: Record<string, unknown>, businessId = ID.bizA) {
  return as(agent().post(`/marketplace/businesses/${businessId}/orders`).send(body), actor);
}

function siteStatus(actor: string | null, orderId: string, status: string, businessId = ID.bizA) {
  return as(agent().patch(`/site/businesses/${businessId}/orders/${orderId}/status`).send({ status }), actor);
}

function siteRefund(actor: string | null, orderId: string, businessId = ID.bizA) {
  return as(agent().post(`/site/businesses/${businessId}/orders/${orderId}/refund`).send({}), actor);
}

function completeOffline(actor: string | null, orderId: string, businessId = ID.bizA) {
  return as(agent().post(`/site/businesses/${businessId}/orders/${orderId}/complete-offline`).send({}), actor);
}

function checkout(slug: string, body: Record<string, unknown>) {
  return agent().post(`/site/storefront/public/${encodeURIComponent(slug)}/checkout`).send(body);
}

function cart(productId: string, paymentMethod: string, extra: Record<string, unknown> = {}) {
  return {
    items: [{ productId, quantity: QUANTITY }],
    customer: { name: 'Vee EightySeven', email: CUSTOMER_EMAIL },
    paymentMethod,
    ...extra,
  };
}

/** A storefront order placed through the public checkout path (server-side pricing). */
async function placeOrder(paymentMethod = 'CASH', businessId = ID.bizA, productId = ID.prodA) {
  const order = await storeOrders.createOrder({
    businessId,
    cartItems: [{ productId, quantity: QUANTITY }],
    customerInfo: { name: 'Vee EightySeven', email: CUSTOMER_EMAIL },
    paymentMethod,
  });
  await settle();
  return order;
}

/** A CASH storefront order whose cash the owner recorded (the paid door). */
async function checkedOutOrder() {
  const order = await placeOrder('CASH');
  await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_${order.id}`, provider: 'cash', method: 'cash', actorId: ID.owner });
  await settle();
  return order;
}

async function invoicesOf(order: { orderNumber: string }, businessId = ID.bizA): Promise<any[]> {
  return db.invoice.findMany({
    where: { businessId, invoiceNumber: { contains: order.orderNumber } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function paymentsOf(invoiceIds: string[]): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

async function postingsOf(businessId: string, sourceIds: string[]): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId, sourceId: { in: sourceIds } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function counts(businessId = ID.bizA) {
  const [orders, invoices, paymentRows, postings, slots] = await Promise.all([
    db.marketplaceOrder.count({ where: { businessId } }),
    db.invoice.count({ where: { businessId } }),
    db.payment.count({ where: { businessId } }),
    db.financialTransaction.count({ where: { businessId } }),
    db.idempotencyKey.count({ where: { businessId } }),
  ]);
  return { orders, invoices, payments: paymentRows, postings, slots };
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

async function expectTrialBalance(businessId: string) {
  const totals = await db.ledgerEntry.aggregate({ where: { businessId }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), `${businessId} trial balance`).toBe(money(Number(totals._sum.credit ?? 0)));
}

/** One PAID invoice INV-<orderNumber>, one SUCCESSFUL payment of the total, exactly one balanced payment_recorded posting. */
async function expectOnePaidInvoice(order: { orderNumber: string }, businessId = ID.bizA) {
  const invoices = await invoicesOf(order, businessId);
  expect(invoices.map((i) => `${i.invoiceNumber}:${i.status}`), 'invoices of the order').toEqual([`INV-${order.orderNumber}:PAID`]);
  const [invoice] = invoices;
  expect(Number(invoice.total)).toBe(ORDER_TOTAL);
  const rows = await paymentsOf([invoice.id]);
  expect(rows.map((p) => `${p.status}:${Number(p.amount)}`), 'payments of the order').toEqual([`SUCCESSFUL:${ORDER_TOTAL}`]);
  const [payment] = rows;
  const postings = await postingsOf(businessId, [invoice.id, payment.id]);
  expect(postings.map((t) => `${t.externalRef}:${t.status}`), 'postings of the order').toEqual([`Payment:${payment.id}:payment_recorded:POSTED`]);
  const [posting] = postings;
  expect(money(sum(posting.entries, 'debit')), 'debits = credits').toBe(money(sum(posting.entries, 'credit')));
  expect(money(sum(posting.entries, 'debit'))).toBe(ORDER_TOTAL);
  await expectTrialBalance(businessId);
  return { invoice, payment, posting };
}

/** The D-14 refund of a checked-out order: original kept, one negative REFUNDED row by the refunder, posting reversed, invoice SENT. */
async function expectD14Refund(order: { id: string; orderNumber: string }, refunder: string, businessId = ID.bizA) {
  const [invoice] = await invoicesOf(order, businessId);
  const rows = await paymentsOf([invoice.id]);
  expect(rows.map((p) => `${p.status}:${Number(p.amount)}`), 'the original kept, one negative refund row (D-14)').toEqual([
    `SUCCESSFUL:${ORDER_TOTAL}`,
    `REFUNDED:${-ORDER_TOTAL}`,
  ]);
  expect(rows[1].recordedBy, 'the refunder').toBe(refunder);
  expect(rows[1].reference, 'the refund links to the payment').toBe(rows[0].providerPaymentId);
  const reopened = await db.invoice.findUnique({ where: { id: invoice.id } });
  expect(`${reopened.status}/${reopened.paidAt}`, 'a full refund reopens the invoice (D-14)').toBe('SENT/null');
  const balance = storedBalanceFn(Number(invoice.total), rows.map((p) => ({ amount: Number(p.amount), status: p.status })), invoice.currency);
  expect(balance.net, 'nothing net received').toBe(0);
  const postings = await postingsOf(businessId, [invoice.id, ...rows.map((p) => p.id)]);
  expect(postings.length, 'the recording and exactly one reversal').toBe(2);
  for (const t of postings) expect(money(sum(t.entries, 'debit')), `${t.externalRef} balanced`).toBe(money(sum(t.entries, 'credit')));
  const depositNet = money(
    postings
      .flatMap((t: any) => t.entries)
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  expect(depositNet, 'the money taken is given back on the ledger').toBe(0);
  await expectTrialBalance(businessId);
  const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
  expect(stored.paymentStatus).toBe('REFUNDED');
}

/** The order's money state, as one comparable string. */
async function bookState(order: { id: string; orderNumber: string }, businessId = ID.bizA) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
  const invoices = await invoicesOf(order, businessId);
  const rows = await paymentsOf(invoices.map((i) => i.id));
  return {
    order: `${stored.status}/${stored.paymentStatus}/${stored.paymentRef ?? ''}`,
    invoices: invoices.map((i) => `${i.invoiceNumber}:${i.status}`),
    payments: rows.map((p) => `${p.status}:${Number(p.amount)}`),
  };
}

function storeEvents(): string[] {
  return seen.map((e) => e.name);
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
/** WiPay's documented response hash (D-19): md5(transaction_id + original total, 2 decimals + API key). */
const keyedHash = (transactionId: string, originalTotal: number, apiKey: string) => md5(`${transactionId}${originalTotal.toFixed(2)}${apiKey}`);

beforeAll(async () => {
  process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
  // No platform WiPay pair: a business is WiPay-capable only through its own pair here.
  delete process.env.WIPAY_API_KEY;
  delete process.env.WIPAY_ACCOUNT_NUMBER;
  // The storefront's return URL origin (a WiPay checkout's return URL must be on it).
  process.env.PUBLIC_URL_ALLOWLIST = PUBLIC_ORIGIN;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { IntakeService } = await import('../src/modules/site/intake.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');
  const { CustomerReferralService } = await import('../src/modules/site/customer-referral.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const stub = {};

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    controllers: [SiteController, MarketplaceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      CrmRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      SiteService,
      StoreOrderService,
      PaymentsService,
      MarketplaceService,
      FulfillmentRoutingService,
      CommerceIntegrationService,
      CommerceService,
      workflowMod.InvoiceWorkflowService,
      RevenueAttributionService,
      RevenuePostingService,
      ExpensePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      // Review CR-1: the real CRM, so the contact the paid door resolves races the store_order.created listener's as in production.
      CrmService,
      EntityResolutionService,
      ContactAuditService,
      { provide: CrmTimelineService, useValue: { logEvent: async () => undefined, logContactEvent: async () => undefined } },
      { provide: CrmStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: ContactCustomFieldValueService, useValue: { setValuesForContact: async () => undefined } },
      {
        provide: PublicEventsService,
        useValue: { logStorefrontEvent: async () => null, upsertStorefrontContact: async () => null, backstitchVisitor: async () => null },
      },
      { provide: PromoCodeService, useValue: stub },
      { provide: InventoryRiskService, useValue: { evaluateProduct: async () => null } },
      {
        provide: ExpensesService,
        useValue: {
          createExpense: async (input: { businessId: string; amount: number; notes?: string }) => {
            expenses.push({ businessId: input.businessId, amount: input.amount, notes: input.notes });
            return null;
          },
        },
      },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CatalogService, useValue: stub },
      { provide: AiUsageService, useValue: stub },
      { provide: IntakeService, useValue: stub },
      { provide: QualificationService, useValue: stub },
      { provide: StorefrontConversionService, useValue: stub },
      { provide: CustomerReferralService, useValue: stub },
      { provide: CaseStudyService, useValue: stub },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v87c_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
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

  storeOrders = app.get(StoreOrderService);
  payments = app.get(PaymentsService);
  // Fulfilment routing runs un-awaited after a marketplace create; it is off the money path and held here.
  vi.spyOn(app.get(MarketplaceService) as any, 'autoRouteOrder').mockImplementation(() => undefined);

  // Await the work an emit starts: the bus calls instance[method] at emit time.
  const integration = app.get(CommerceIntegrationService) as Record<string, any>;
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(integration))) {
    if (!name.startsWith('handle') || typeof integration[name] !== 'function') continue;
    const original = integration[name].bind(integration);
    integration[name] = (...args: unknown[]) => {
      const work = original(...args);
      inflight.push(Promise.resolve(work));
      return work;
    };
  }
  const events = app.get(EventEmitter2);
  events.onAny((name: string | string[], payload: any) => {
    const n = Array.isArray(name) ? name.join('.') : String(name);
    if (n.startsWith('store_order.')) seen.push({ name: n, payload });
  });

  await cleanup();
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffRead, email: `${P}staff_read@test.local`, role: 'USER' } });
  const pair = { wipayApiKey: WIPAY_KEY, wipayAccountNumber: WIPAY_ACCOUNT };
  for (const [id, slug, currency, metaData] of [
    [ID.bizA, SLUG.a, 'TTD', pair],
    [ID.bizNoWipay, SLUG.noWipay, 'TTD', null],
    [ID.bizUsd, SLUG.usd, 'USD', pair],
    [ID.bizR, SLUG.r, 'TTD', null],
  ] as const) {
    await db.business.create({
      data: { id, name: `V87C ${slug}`, slug, ownerId: ID.owner, currency, accountingBasis: 'CASH', storeEnabled: true, ...(metaData ? { metaData } : {}) },
    });
    await db.membership.create({ data: { id: `${id}_m_owner`, userId: ID.owner, businessId: id, role: 'OWNER' } });
    await app.get(ChartOfAccountsSeederService).ensureDefaults(id);
  }
  await db.membership.create({
    data: { id: `${P}m_staff_a`, userId: ID.staffRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
  });
  await db.membership.create({
    data: { id: `${P}m_staff_r`, userId: ID.staffRead, businessId: ID.bizR, role: 'STAFF', permissionScopes: { revenue: 'read' } },
  });
  for (const [id, businessId] of [[ID.contactA, ID.bizA], [ID.contactNoWipay, ID.bizNoWipay], [ID.contactUsd, ID.bizUsd], [ID.contactR, ID.bizR]] as const) {
    await db.contact.create({
      data: { id, businessId, firstName: 'Vee', lastName: 'EightySeven', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
    });
  }
  for (const [id, businessId, currency] of [[ID.prodA, ID.bizA, 'TTD'], [ID.prodNoWipay, ID.bizNoWipay, 'TTD'], [ID.prodUsd, ID.bizUsd, 'USD'], [ID.prodR, ID.bizR, 'TTD']] as const) {
    await db.product.create({ data: { id, businessId, name: 'V87C Widget', price: UNIT_PRICE, currency, category: 'PRODUCT', isActive: true } });
  }
}, 90_000);

beforeEach(async () => {
  await settle();
  await clearRateLimits();
  seen = [];
  expenses.length = 0;
});

afterAll(async () => {
  await settle();
  try { await cleanup(); } catch { /* best-effort */ }
  try { if (redis) { await clearRateLimits(); await redis.quit(); } } catch { /* best-effort */ }
  try { await app?.close(); } catch { /* best-effort */ }
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(PREVIOUS_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('G6PUB-RC2-1: a storefront order is refunded only through the D-14 refund door, with revenue write', () => {
  it('V87-01 the marketplace fulfil refund of a checked-out storefront order: revenue:read 403 and a partial amount 400 write nothing; the owner refund is the D-14 refund (negative row, posting reversed, invoice SENT, no Expense); a second refund writes nothing', async () => {
    const order = await checkedOutOrder();
    await expectOnePaidInvoice(order);
    // The status PATCH /site/.../status {status:'paid'} wrote at 9f09d6c8 for any member (G6PUB-RC2-2), from which
    // the fulfil route's own transition table allows 'refunded' (PROBE-A). The refund door does not depend on it.
    await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: 'paid' } });
    const paid = await bookState(order);
    const before = await counts();
    seen = [];

    // At 9f09d6c8: 201 refunded/REFUNDED for any member, payments [SUCCESSFUL:80], invoice PAID, Expense of the client's amount (PROBE-A).
    const staff = await fulfil(ID.staffRead, order.id, { action: 'refund' });
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    const partial = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount: 5000, reason: 'v87c partial' });
    expect(partial.status, JSON.stringify(partial.body)).toBe(400);
    await settle();
    expect(await bookState(order), 'refused: the books as they were').toEqual(paid);
    expect(await counts(), 'refused: nothing written').toEqual(before);
    expect(storeEvents(), 'refused: no store_order.refunded').toEqual([]);
    expect(expenses, 'refused: no Expense').toEqual([]);

    const res = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount: ORDER_TOTAL, reason: 'v87c full' });
    await settle();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(String(res.body.paymentStatus).toUpperCase()).toBe('REFUNDED');
    await expectD14Refund(order, ID.owner);
    const refunded = seen.filter((e) => e.name === 'store_order.refunded');
    expect(refunded, 'one store_order.refunded').toHaveLength(1);
    expect(refunded[0].payload.invoiceId, 'naming the invoice the refund is on').toBe((await invoicesOf(order))[0].id);
    expect(expenses, 'no Expense: the refund is on the invoice, not a cost').toEqual([]);

    const afterRefund = await counts();
    seen = [];
    const again = await fulfil(ID.owner, order.id, { action: 'refund' });
    await settle();
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    expect(await counts(), 'a second refund writes nothing').toEqual(afterRefund);
    expect(storeEvents()).toEqual([]);
    expect(expenses).toEqual([]);
  });

  it('V87-02 the marketplace fulfil refund of an UNPAID storefront order is 409 and writes nothing; its offline completion still records the cash', async () => {
    const order = await placeOrder('CASH');
    // As in V87-01: the status the site status route wrote for any member at 9f09d6c8 (PROBE-B).
    await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: 'paid' } });
    const before = await counts();
    seen = [];

    // At 9f09d6c8: 201 refunded/REFUNDED, an Expense of 5000, and complete-offline then 409 (PROBE-B).
    const res = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount: 5000 });
    await settle();
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await counts(), 'nothing written').toEqual(before);
    expect(storeEvents()).toEqual([]);
    expect(expenses).toEqual([]);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`).toBe('paid/PENDING');

    const completed = await completeOffline(ID.owner, order.id);
    await settle();
    expect(completed.status, JSON.stringify(completed.body)).toBe(201);
    await expectOnePaidInvoice(order);
  });

  it("V87-03 PATCH /marketplace/.../status 'refunded' (any case) of a storefront order is refused (400): no store_order.refunded, no Expense, nothing written", async () => {
    const order = await checkedOutOrder();
    const paid = await bookState(order);
    const before = await counts();
    seen = [];

    for (const status of ['refunded', 'REFUNDED']) {
      // At 9f09d6c8: 200, status written and store_order.refunded emitted (its listener books the total as an Expense).
      const res = await marketStatus(ID.owner, order.id, { status });
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    await settle();
    expect(await bookState(order)).toEqual(paid);
    expect(await counts()).toEqual(before);
    expect(storeEvents()).toEqual([]);
    expect(expenses).toEqual([]);

    // Control: a fulfilment status still moves through the same route.
    const moved = await marketStatus(ID.owner, order.id, { status: 'PROCESSING' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(`${moved.body.status}/${moved.body.paymentStatus}`).toBe('PROCESSING/PAID');
  });
});

describe('G6PUB-RC2-2: the site status route moves fulfilment only', () => {
  it('V87-04 PATCH /site/.../orders/:id/status refuses payment states and unknown strings (400, nothing written), so the D-14 refund door still opens; fulfilment statuses still move, stored upper-case', async () => {
    const order = await checkedOutOrder();
    const paid = await bookState(order);
    const before = await counts();
    seen = [];

    for (const status of ['REFUNDED', 'refunded', 'paid', 'PAID', 'UNPAID', 'FAILED', 'v87c-anything']) {
      // At 9f09d6c8: each one is written verbatim (PROBE-D: REFUNDED, then the refund route answers "already refunded").
      const res = await siteStatus(ID.owner, order.id, status);
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    await settle();
    expect(await bookState(order), 'the order and its books as they were').toEqual(paid);
    expect(await counts()).toEqual(before);
    expect(storeEvents(), 'no lifecycle event').toEqual([]);

    // Controls: fulfilment statuses move, in any case, stored in the site vocabulary.
    const shipped = await siteStatus(ID.owner, order.id, 'SHIPPED');
    expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
    expect(`${shipped.body.status}/${shipped.body.paymentStatus}`).toBe('SHIPPED/PAID');
    const delivered = await siteStatus(ID.owner, order.id, 'delivered');
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');
    await settle();
    expect(storeEvents()).toEqual(['store_order.shipped', 'store_order.delivered']);

    // The refund door is not blocked by a forged status.
    const refund = await siteRefund(ID.owner, order.id);
    await settle();
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    await expectD14Refund(order, ID.owner);
    expect(expenses).toEqual([]);
  });
});

describe('G6PUB-RC2-4 / RC1-1: WiPay only where it can be paid; one order per checkout', () => {
  it('V87-05 a WiPay checkout for a business with no WiPay merchant pair is refused (400) before the order is written, retried or not; controls: CASH is an order, and a business with a pair takes a TTD WiPay order', async () => {
    const before = await counts(ID.bizNoWipay);
    seen = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      // At 9f09d6c8: 400 'WiPay is not configured' from createStorePayment, after the order committed (one more each time).
      const res = await checkout(SLUG.noWipay, cart(ID.prodNoWipay, 'WIPAY', { returnUrl: RETURN_URL, idempotencyKey: `${P}key_05` }));
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.message).toMatch(/WiPay/);
    }
    await settle();
    expect(await counts(ID.bizNoWipay), 'no order, no retry slot').toEqual(before);
    expect(storeEvents(), 'no store_order.created').toEqual([]);

    const cash = await checkout(SLUG.noWipay, cart(ID.prodNoWipay, 'CASH'));
    expect(cash.status, JSON.stringify(cash.body)).toBe(201);
    expect((await counts(ID.bizNoWipay)).orders).toBe(before.orders + 1);

    const wipay = await placeOrder('WIPAY');
    expect(`${wipay.paymentMethod}/${wipay.currency}/${wipay.paymentStatus}`).toBe('WIPAY/TTD/UNPAID');
  });

  it('V87-06 GET /site/storefront/public/:slug/gateways lists WiPay only for a business with a merchant pair and a TTD amount, and carries no key or account number', async () => {
    const ids = async (slug: string, currency?: string) => {
      await clearRateLimits();
      const res = await agent().get(`/site/storefront/public/${encodeURIComponent(slug)}/gateways`).query(currency ? { currency } : {});
      expect(res.status, `${slug} ${currency ?? ''}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(WIPAY_KEY);
      expect(JSON.stringify(res.body)).not.toContain(WIPAY_ACCOUNT);
      return (res.body as Array<{ id: string }>).map((g) => g.id);
    };

    // At 9f09d6c8: no such route (404); the storefront listed WiPay, as the default, for every TTD cart.
    expect(await ids(SLUG.a, 'TTD'), 'a pair and TTD').toContain('wipay');
    expect(await ids(SLUG.a), 'the business currency (TTD)').toContain('wipay');
    expect(await ids(SLUG.a, 'usd'), 'a USD amount (D-69)').not.toContain('wipay');
    expect(await ids(SLUG.noWipay, 'TTD'), 'no merchant pair').not.toContain('wipay');
    expect(await ids(SLUG.usd), 'a USD business').not.toContain('wipay');

    await clearRateLimits();
    const unknown = await agent().get(`/site/storefront/public/${P}no-such-store/gateways`);
    expect(unknown.status).toBe(404);
  });

  it('V87-07 the checkout retry key may come in the body (the Idempotency-Key header does not pass the CORS preflight): the same key answers the same order', async () => {
    const before = await counts();
    seen = [];
    const body = cart(ID.prodA, 'CASH', { idempotencyKey: `${P}key_07` });

    const first = await checkout(SLUG.a, body);
    const second = await checkout(SLUG.a, body);
    await settle();

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    // At 9f09d6c8: two orders (the body key was ignored).
    expect(second.body.order.id, 'the retry is answered with the first order').toBe(first.body.order.id);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect((await counts()).orders, 'one order for two submits').toBe(before.orders + 1);
    expect(storeEvents().filter((n) => n === 'store_order.created')).toHaveLength(1);
  });
});

describe('D-76 (G6PUB-RC1-4): a verified WiPay success for a non-TTD payable records no money', () => {
  it('V87-08 a USD invoice and a USD storefront order: no payment, the payable unchanged, the webhook_events row kept as refused and the business notified once; control: a TTD storefront order is settled by the same callback', async () => {
    const invoiceId = `${P}inv_usd`;
    await db.invoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: `${P}INV-USD-1`,
        status: 'SENT',
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        currency: 'USD',
        businessId: ID.bizUsd,
        contactId: ID.contactUsd,
        items: { create: [{ description: 'v87c usd item', quantity: 1, unitPrice: ORDER_TOTAL, total: ORDER_TOTAL }] },
      },
    });
    // A USD WiPay order from a checkout started before D-69 (the order door refuses one now).
    const usdOrder = await db.marketplaceOrder.create({
      data: {
        businessId: ID.bizUsd,
        orderNumber: `${P}ORD-USD-1`,
        type: 'STOREFRONT',
        status: 'PENDING',
        customerName: 'Vee EightySeven',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        currency: 'USD',
        paymentMethod: 'WIPAY',
        paymentStatus: 'UNPAID',
        items: { create: [{ productId: ID.prodUsd, name: 'V87C Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL, currency: 'USD' }] },
      },
    });
    const usdBefore = await counts(ID.bizUsd);

    for (const [label, payableId, txn] of [
      ['USD invoice', invoiceId, `${P}wtx_inv_usd`],
      ['USD storefront order', usdOrder.id, `${P}wtx_ord_usd`],
    ] as const) {
      const q = { transaction_id: txn, order_id: payableId, status: 'success', total: ORDER_TOTAL.toFixed(2), hash: keyedHash(txn, ORDER_TOTAL, WIPAY_KEY) };
      for (let delivery = 0; delivery < 2; delivery += 1) {
        // At 9f09d6c8: SUCCESSFUL payment of 80 USD (the invoice) / the order PAID with its invoice (the order).
        const answer = await payments.handleWipayCallback(q);
        await settle();
        expect(answer.success, `${label} delivery ${delivery}: ${JSON.stringify(answer)}`).toBe(false);
        expect(answer.message).toMatch(/TTD/);
      }
      const claims = await db.webhookEvent.findMany({ where: { provider: 'wipay', providerEventId: txn } });
      expect(claims.map((c: any) => `${c.businessId}:${String(c.eventType).startsWith('refused')}`), `${label}: the refused row is kept, once`).toEqual([
        `${ID.bizUsd}:true`,
      ]);
      const notified = await db.notification.findMany({ where: { businessId: ID.bizUsd } });
      expect(notified.filter((n: any) => JSON.stringify(n.data ?? {}).includes(txn)), `${label}: the business is told once`).toHaveLength(1);
    }
    expect(await counts(ID.bizUsd), 'no invoice, payment or posting written in the USD business').toEqual(usdBefore);
    expect((await db.invoice.findUnique({ where: { id: invoiceId } })).status).toBe('SENT');
    const storedUsd = await db.marketplaceOrder.findUnique({ where: { id: usdOrder.id } });
    expect(`${storedUsd.status}/${storedUsd.paymentStatus}`).toBe('PENDING/UNPAID');

    // Control: a TTD WiPay order of a business with a pair is settled by its verified callback.
    const ttd = await placeOrder('WIPAY');
    const txn = `${P}wtx_ord_ttd`;
    const ok = await payments.handleWipayCallback({
      transaction_id: txn,
      order_id: ttd.id,
      status: 'success',
      total: ORDER_TOTAL.toFixed(2),
      hash: keyedHash(txn, ORDER_TOTAL, WIPAY_KEY),
    });
    await settle();
    expect(ok.success, JSON.stringify(ok)).toBe(true);
    await expectOnePaidInvoice(ttd);
  });
});

describe('D-77 (G6PUB-RC1-5): a STANDARD order created paid goes through the paid door', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    paymentOnCreation: true,
    paymentMethod: 'CASH',
    customerName: 'Vee EightySeven',
    customerEmail: CUSTOMER_EMAIL,
    currency: 'TTD',
    items: [{ productId: ID.prodA, quantity: QUANTITY }],
    ...over,
  });

  it('V87-09 created paid: one PAID invoice INV-<orderNumber>, one SUCCESSFUL payment by the member, exactly one balanced posting, paid/PAID and one store_order.paid with the invoice; revenue:read 403 and no customer contact 400 write nothing; an unpaid create stays placed', async () => {
    const before = await counts();
    seen = [];

    const staff = await marketCreate(ID.staffRead, body());
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    const noContact = await marketCreate(ID.owner, body({ customerEmail: undefined, customerPhone: undefined }));
    expect(noContact.status, JSON.stringify(noContact.body)).toBe(400);
    await settle();
    expect(await counts(), 'refused: nothing written').toEqual(before);
    expect(storeEvents(), 'refused: no order event').toEqual([]);

    const res = await marketCreate(ID.owner, body());
    await settle();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const order = res.body;
    // At 9f09d6c8: STANDARD/paid/UNPAID with no invoice, payment or posting; the listener wrote a raw PAID INV-ORD-<n> (V18-T2).
    expect(`${order.type}/${order.status}/${order.paymentStatus}`).toBe('STANDARD/paid/PAID');
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`).toBe('paid/PAID');
    const { invoice, payment } = await expectOnePaidInvoice(order);
    expect(payment.recordedBy, 'the member who recorded it').toBe(ID.owner);
    const paidEvents = seen.filter((e) => e.name === 'store_order.paid');
    expect(paidEvents, 'one store_order.paid').toHaveLength(1);
    expect(paidEvents[0].payload.invoiceId).toBe(invoice.id);
    expect(paidEvents[0].payload.order.paymentStatus).toBe('PAID');
    const after = await counts();
    expect(after.invoices - before.invoices, 'one invoice (no INV-ORD from the listener)').toBe(1);
    expect(after.payments - before.payments).toBe(1);
    expect(after.postings - before.postings, 'exactly one posting').toBe(1);

    // Control: an unpaid create is placed and unpaid, with no invoice and no paid event.
    seen = [];
    const unpaid = await marketCreate(ID.owner, body({ paymentOnCreation: false }));
    await settle();
    expect(unpaid.status, JSON.stringify(unpaid.body)).toBe(201);
    expect(`${unpaid.body.status}/${unpaid.body.paymentStatus}`).toBe('placed/UNPAID');
    expect(await invoicesOf(unpaid.body)).toEqual([]);
    expect(storeEvents()).toEqual(['store_order.created']);
  });
});

describe('G6PUB-R3-STORE-ORDER-DOORS review repairs: an order created paid (D-77) keeps its money on the doors', () => {
  // These cases run in bizR: the marketplace routes' CrmRateLimitGuard counts per ip, business and route
  // (create 20 and fulfil 10 a minute, in memory), and bizA's earlier cases already use part of bizA's.
  const B = ID.bizR;
  const paidBody = (over: Record<string, unknown> = {}) => ({
    paymentOnCreation: true,
    paymentMethod: 'CASH',
    customerName: 'Vee EightySeven',
    customerEmail: CUSTOMER_EMAIL,
    currency: 'TTD',
    items: [{ productId: ID.prodR, quantity: QUANTITY }],
    ...over,
  });

  /** A STANDARD order the owner created paid: through the paid door (V87-09). */
  async function createdPaid(over: Record<string, unknown> = {}) {
    const res = await marketCreate(ID.owner, paidBody(over), B);
    await settle();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(`${res.body.type}/${res.body.status}/${res.body.paymentStatus}`).toBe('STANDARD/paid/PAID');
    return res.body as { id: string; orderNumber: string; total: number };
  }

  it("V87-10 (SEC-R3-1) an order created paid is refunded through the fulfil route only by the D-14 refund door: revenue:read 403, an amount other than the total 400 and PATCH 'refunded' 400 write nothing; the owner refund is the D-14 refund on its invoice, with no Expense", async () => {
    const order = await createdPaid();
    await expectOnePaidInvoice(order, B);
    const paid = await bookState(order, B);
    const before = await counts(B);
    seen = [];

    // At 5c9f164c: 201 refunded/REFUNDED for the revenue:read member, the invoice PAID, the payment SUCCESSFUL and an Expense of 99999.
    const staff = await fulfil(ID.staffRead, order.id, { action: 'refund', refundAmount: 99999 }, B);
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    // At 5c9f164c: 200 and an Expense of the total, for any member.
    for (const actor of [ID.staffRead, ID.owner]) {
      const patched = await marketStatus(actor, order.id, { status: 'refunded' }, B);
      expect(patched.status, `${actor}: ${JSON.stringify(patched.body)}`).toBe(400);
    }
    const over = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount: 99999 }, B);
    expect(over.status, JSON.stringify(over.body)).toBe(400);
    await settle();
    expect(await bookState(order, B), 'refused: the books as they were').toEqual(paid);
    expect(await counts(B), 'refused: nothing written').toEqual(before);
    expect(storeEvents(), 'refused: no store_order.refunded').toEqual([]);
    expect(expenses, 'refused: no Expense').toEqual([]);

    const res = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount: ORDER_TOTAL, reason: 'v87c d77 full' }, B);
    await settle();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectD14Refund(order, ID.owner, B);
    const refunded = seen.filter((e) => e.name === 'store_order.refunded');
    expect(refunded, 'one store_order.refunded').toHaveLength(1);
    expect(refunded[0].payload.invoiceId, 'naming the invoice the refund is on').toBe((await invoicesOf(order, B))[0].id);
    expect(expenses, 'no Expense: the refund is on the invoice').toEqual([]);
  });

  it("V87-11 (SEC-R3-1 remainder) the fulfil refund of an order with no payment on the books books an Expense, so it takes revenue write (403) and an amount above 0 up to the total (400); PATCH 'refunded' is 400; the owner's partial refund books that amount", async () => {
    const created = await marketCreate(ID.owner, paidBody({ paymentOnCreation: false }), B);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = created.body;
    const markPaid = await fulfil(ID.owner, order.id, { action: 'mark_paid', paymentMethod: 'CASH' }, B);
    await settle();
    expect(markPaid.status, JSON.stringify(markPaid.body)).toBe(201);
    expect(`${markPaid.body.status}/${markPaid.body.paymentStatus}`).toBe('paid/PAID');
    expect((await invoicesOf(order, B)).map((i) => i.invoiceNumber), 'no checkout invoice: nothing paid through the paid door').not.toContain(
      `INV-${order.orderNumber}`,
    );
    const before = await counts(B);
    const state = await bookState(order, B);
    seen = [];

    // At 5c9f164c: 201 for the revenue:read member and an Expense of the client's amount (99999).
    const staff = await fulfil(ID.staffRead, order.id, { action: 'refund', refundAmount: 99999 }, B);
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    for (const refundAmount of [ORDER_TOTAL + 0.01, -5, 'abc']) {
      const res = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount }, B);
      expect(res.status, `${refundAmount}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    const patched = await marketStatus(ID.owner, order.id, { status: 'refunded' }, B);
    expect(patched.status, JSON.stringify(patched.body)).toBe(400);
    await settle();
    expect(await bookState(order, B)).toEqual(state);
    expect(await counts(B)).toEqual(before);
    expect(storeEvents()).toEqual([]);
    expect(expenses).toEqual([]);

    const partial = await fulfil(ID.owner, order.id, { action: 'refund', refundAmount: 30, reason: 'v87c partial' }, B);
    await settle();
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(`${partial.body.status}/${partial.body.paymentStatus}`).toBe('refunded/REFUNDED');
    expect(expenses, 'the refund it records: an Expense of the amount refunded').toEqual([{ businessId: B, amount: 30, notes: `order:${order.id}` }]);
  });

  it('V87-12 (SEC-R3-2) the site refund route refunds an order created paid on its invoice (D-14): negative row, posting reversed, invoice SENT, store_order.refunded naming the invoice, no Expense', async () => {
    const order = await createdPaid();
    const { invoice } = await expectOnePaidInvoice(order, B);
    const before = await counts(B);
    seen = [];

    const staff = await siteRefund(ID.staffRead, order.id, B);
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    await settle();
    expect(await counts(B)).toEqual(before);

    // At 5c9f164c: 201 REFUNDED/REFUNDED with the invoice PAID, the payment SUCCESSFUL, no invoiceId and an Expense of 80.
    const res = await siteRefund(ID.owner, order.id, B);
    await settle();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await expectD14Refund(order, ID.owner, B);
    const refunded = seen.filter((e) => e.name === 'store_order.refunded');
    expect(refunded, 'one store_order.refunded').toHaveLength(1);
    expect(refunded[0].payload.invoiceId).toBe(invoice.id);
    expect(expenses, 'no Expense beside the refund on the invoice').toEqual([]);

    const again = await siteRefund(ID.owner, order.id, B);
    await settle();
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    expect(expenses).toEqual([]);
  });

  it('V87-13 (SEC-R3-3) the payment fields of an order created paid do not move through PATCH .../status (400, nothing written, any member); its status alone still moves; an order with no payment on the books is unchanged', async () => {
    const order = await createdPaid();
    const paid = await bookState(order, B);
    const before = await counts(B);
    seen = [];

    for (const [actor, body] of [
      // At 5c9f164c: 200 placed/UNPAID with the invoice PAID and the payment SUCCESSFUL.
      [ID.staffRead, { status: 'placed', paymentStatus: 'UNPAID' }],
      [ID.owner, { status: 'placed', paymentStatus: 'UNPAID' }],
      [ID.owner, { status: 'paid', paymentStatus: 'PAID', paymentRef: `${P}forged_ref` }],
      [ID.owner, { status: 'awaiting_fulfillment', paymentMethod: 'WIPAY' }],
      [ID.owner, { status: 'paid' }],
    ] as const) {
      const res = await marketStatus(actor, order.id, body, B);
      expect(res.status, `${actor} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    await settle();
    expect(await bookState(order, B), 'the order and its books as they were').toEqual(paid);
    expect(await counts(B)).toEqual(before);
    expect(storeEvents()).toEqual([]);
    expect(expenses).toEqual([]);

    // Controls: its status alone moves, and an order with no payment on the books still takes its payment fields.
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    const moved = await marketStatus(ID.owner, order.id, { status: 'awaiting_fulfillment' }, B);
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(`${moved.body.status}/${moved.body.paymentStatus}/${moved.body.paymentRef}`).toBe(`awaiting_fulfillment/PAID/${stored.paymentRef}`);
    const unpaid = await marketCreate(ID.owner, paidBody({ paymentOnCreation: false }), B);
    expect(unpaid.status, JSON.stringify(unpaid.body)).toBe(201);
    const legacy = await marketStatus(ID.owner, unpaid.body.id, { status: 'awaiting_payment', paymentMethod: 'BANK_TRANSFER' }, B);
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
    expect(`${legacy.body.status}/${legacy.body.paymentMethod}`).toBe('awaiting_payment/BANK_TRANSFER');
  });

  it('V87-14 (SEC-R3-4) a create with a quantity that is not a whole positive number, a negative or non-numeric fee, tax, duty or discount, or a discount above the order is refused (400) before anything is written; a paid create needs a total above 0; control: a valid discount and fee', async () => {
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);
    const before = await counts(B);
    seen = [];
    const line = (quantity: unknown) => ({ items: [{ productId: ID.prodR, quantity }] });

    // Through the route.
    for (const over of [
      // At 5c9f164c: 201 with an invoice PAID:-920 and a payment SUCCESSFUL:-920.
      { discountAmount: 1000 },
      // At 5c9f164c: 201 with an invoice PAID:-120 and a payment SUCCESSFUL:-120.
      line(-3),
      line(0),
      { shippingFee: -5 },
      { discountAmount: ORDER_TOTAL },
      { paymentOnCreation: false, ...line(-3) },
    ] as Array<Record<string, unknown>>) {
      const res = await marketCreate(ID.owner, paidBody(over), B);
      expect(res.status, `${JSON.stringify(over)}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    // The same rule on the service the route calls (the route's rate limit is 20 creates a minute).
    for (const over of [
      line(1.5),
      line('two'),
      { taxAmount: -1 },
      { dutyAmount: 'abc' },
      { discountAmount: -10 },
      { paymentOnCreation: false, discountAmount: 1000 },
    ] as Array<Record<string, unknown>>) {
      const refused = await market.createOrder(B, paidBody(over), ID.owner).then(
        () => null,
        (err: any) => err,
      );
      expect(refused?.getStatus?.(), `${JSON.stringify(over)}: ${refused?.message}`).toBe(400);
    }
    await settle();
    expect(await counts(B), 'refused: nothing written').toEqual(before);
    expect(storeEvents(), 'refused: no order event').toEqual([]);
    expect(
      await db.payment.count({ where: { businessId: B, status: 'SUCCESSFUL', amount: { lte: 0 } } }),
      'no zero or negative SUCCESSFUL payment',
    ).toBe(0);

    // Control: a discount and a fee within the order are recorded at the order's total.
    const order = await createdPaid({ discountAmount: 10, shippingFee: 5 });
    const invoices = await invoicesOf(order, B);
    expect(invoices.map((i) => `${i.invoiceNumber}:${i.status}:${Number(i.total)}`)).toEqual([`INV-${order.orderNumber}:PAID:75`]);
    expect((await paymentsOf(invoices.map((i) => i.id))).map((p) => `${p.status}:${Number(p.amount)}`)).toEqual(['SUCCESSFUL:75']);
    await expectTrialBalance(B);
  });

  it('V87-15 (CR-1) an order created paid for a new customer (the real CRM, raced by the store_order.created listener) is answered 201 paid / PAID every time, with one contact, its invoice made out to it, and no placed order left behind', async () => {
    const results: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const email = `${P}new_customer_${i}_${Date.now()}@test.local`;
      // At 5c9f164c: 400 "unable to resolve a contact" (the CRM's ConflictException), and the order left placed / UNPAID.
      const res = await marketCreate(ID.owner, paidBody({ customerEmail: email, customerName: 'New Customer' }), B);
      await settle();
      const orders = await db.marketplaceOrder.findMany({ where: { businessId: B, customerEmail: email } });
      const contacts = await db.contact.findMany({ where: { businessId: B, emailNormalized: email.toLowerCase() } });
      const invoices = orders.length === 1 ? await invoicesOf(orders[0], B) : [];
      results.push(
        [
          res.status,
          orders.map((o: any) => `${o.status}/${o.paymentStatus}`).join(','),
          `contacts=${contacts.length}`,
          invoices.map((inv: any) => `${inv.status}:${inv.contactId === contacts[0]?.id}`).join(','),
        ].join('|'),
      );
    }
    expect(results).toEqual(Array(3).fill('201|paid/PAID|contacts=1|PAID:true'));
  });
});

describe('W10-PAYPAL-CURRENCY: PayPal only for a currency PayPal supports (D-106)', () => {
  it('V87-16 (W10-PAYPAL-CURRENCY, D-106): GET /site/storefront/public/:slug/gateways offers no PayPal for a TTD amount (nor JMD, BBD, GYD, XCD, nor a TTD business with no cart currency), and the PayPal checkout of a TTD cart is refused 400 PAYPAL_CURRENCY_UNSUPPORTED before PayPal is called; control: a USD cart is offered PayPal in USD and its PayPal checkout makes a USD order', async () => {
    const paypalEnv = { PAYPAL_CLIENT_ID: `${P}paypal_client_fake`, PAYPAL_CLIENT_SECRET: `${P}paypal_secret_fake` };
    const previous = Object.fromEntries(Object.keys(paypalEnv).map((k) => [k, process.env[k]]));
    Object.assign(process.env, paypalEnv);
    // The PayPal SDK client (the provider edge), stubbed: it records the orders it is asked for.
    const ordered: any[] = [];
    const clientSpy = vi.spyOn(payments as any, 'getPaypalClient').mockReturnValue({
      client: {},
      ordersController: {
        createOrder: vi.fn(async (req: any) => {
          ordered.push(req?.body?.purchaseUnits);
          return { result: { id: `${P}pp_order_${ordered.length}`, links: [] } };
        }),
      },
    });
    const gateways = async (slug: string, currency?: string) => {
      await clearRateLimits();
      const res = await agent().get(`/site/storefront/public/${encodeURIComponent(slug)}/gateways`).query(currency ? { currency } : {});
      expect(res.status, `${slug} ${currency ?? ''}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body as Array<{ id: string; name: string; currencies: string[] }>;
    };
    try {
      // At 71a97cb1: { id: 'paypal', currencies: ['USD'] } for every cart.
      for (const code of ['TTD', 'JMD', 'BBD', 'GYD', 'XCD']) {
        expect((await gateways(SLUG.a, code)).map((g) => g.id), code).not.toContain('paypal');
      }
      expect((await gateways(SLUG.a)).map((g) => g.id), 'the business currency (TTD)').not.toContain('paypal');

      // At 71a97cb1: 201, PayPal asked for a TTD order (real PayPal refuses it).
      await clearRateLimits();
      const refused = await checkout(SLUG.a, cart(ID.prodA, 'PAYPAL'));
      await settle();
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(refused.body).toMatchObject({
        code: 'PAYPAL_CURRENCY_UNSUPPORTED',
        message: 'PayPal does not support TTD: this order cannot be paid with PayPal. Choose another payment method.',
      });
      expect(clientSpy, 'PayPal is never called').not.toHaveBeenCalled();
      expect(ordered).toEqual([]);

      // Control: a USD cart is offered PayPal, in USD, and its checkout makes a USD order.
      expect((await gateways(SLUG.usd, 'USD')).find((g) => g.id === 'paypal')).toEqual({ id: 'paypal', name: 'PayPal', currencies: ['USD'] });
      await clearRateLimits();
      const usd = await checkout(SLUG.usd, cart(ID.prodUsd, 'PAYPAL'));
      await settle();
      expect(usd.status, JSON.stringify(usd.body)).toBe(201);
      expect(usd.body.payment).toMatchObject({ status: 'PAYPAL_AWAITING_APPROVAL' });
      expect(ordered.map((units) => `${units[0].amount.currencyCode}:${units[0].amount.value}`)).toEqual([`USD:${ORDER_TOTAL.toFixed(2)}`]);
    } finally {
      clientSpy.mockRestore();
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
