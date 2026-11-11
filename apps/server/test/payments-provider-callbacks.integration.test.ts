/**
 * V1-05-PUB-PROVIDER-CALLBACKS (M35, P0 v1; owner ruling D-19) — a WiPay
 * callback settles nothing without a keyed proof, and a PayPal capture is
 * bound to its invoice, amount and currency and recorded through the ledger
 * door (REAL database, REAL HTTP through PaymentsController, REAL posting and
 * invoice workflow).
 *
 * The defects (M35):
 *   - WiPay: handleWipayCallback accepted md5(transaction_id + order_id +
 *     total + status), built from public values with no secret, so anyone
 *     holding an invoice (or storefront order) id settled it with a SUCCESSFUL,
 *     ledger-posted payment of the total they supplied; an unsigned failure
 *     callback wrote a FAILED row, claimed the transaction id and flipped a
 *     storefront order to FAILED.
 *   - PayPal: capturePaypalOrder recorded the invoice total with no binding of
 *     the order to the invoice. On this base V1-46b (SEC-V46B-3) already binds
 *     custom_id and amount, and V1-15c already records through
 *     createPaymentWithPosting; the order's currency was still unchecked and
 *     createPaypalOrder made every order in USD, so a TTD invoice's capture
 *     recorded X TTD for X USD taken.
 *
 * D-19: WiPay callbacks are verified against WiPay's published hash
 * documentation (read, never called). WiPay's Transaction Response
 * documentation (docs.wipayfinancial.com/payments-api/transaction-response;
 * WiPay API Documentation PDF, wipaycaribbean.com/WiPay-API-Documentation.pdf)
 * defines the response hash as the MD5 of transaction_id, the ORIGINAL total
 * supplied in the request (two decimals, not the customer-facing response
 * total) and the merchant's API key, concatenated in that order with no
 * separator. The API key is the secret; the documented sandbox key ('123') is
 * public and is never a default.
 *
 * Contract pinned here:
 *
 *   PC-01  no key configured: a callback hashed from public values (the old
 *          formula) and one keyed with the public sandbox key are refused with
 *          400; no Payment row, no WebhookEvent claim, the invoice unchanged
 *   PC-02  a key configured: the public-values hash, a hash keyed with another
 *          key and a keyed hash over another total are refused with 400; nothing
 *          written
 *   PC-03  a correct keyed proof records one SUCCESSFUL payment of the original
 *          total through createPaymentWithPosting (one payment_recorded posting,
 *          balanced), reconciles the invoice to PAID and claims the transaction
 *          once; the replay is 'Duplicate callback ignored' and writes nothing
 *   PC-04  failure callbacks, hashed or not, answer 200 { success: false,
 *          'Payment was not successful' } and act on nothing: no FAILED row,
 *          no claim, no payment-failed event, the invoice unchanged (review
 *          V05-SEC-2, CR-V05-2, CR-V05-3: the hash does not cover the status
 *          and WiPay documents it for successes only, so it proves a success
 *          and nothing else; a decline carries no hash and the pay page shows
 *          the payer this answer)
 *   PC-04b a keyed failure first does not swallow that transaction's success:
 *          the success then records it (the failure took no claim)
 *   PC-04c only this invoice's own SUCCESSFUL row of the transaction counts as
 *          recorded: a pre-V1-05 FAILED row on the id, or another invoice's
 *          payment of it, gets { success: false } with nothing recorded and
 *          the claim released (review V05-SEC-2)
 *   PC-05  a storefront order: a public-values success callback is refused with
 *          400 and an unsigned failure is answered { success: false }; neither
 *          reaches StoreOrderService; a keyed proof over the order total settles
 *          it once; the replay does not
 *   PC-10  the WiPay checkouts never hand the API key to the payer (review
 *          V05-SEC-1): developer_id is the merchant's account number, the
 *          request and the parameter echo returned when WiPay answers with no
 *          URL carry no key; a live checkout with no account number is 400
 *          before WiPay is called; the invoice checkout's return URL must be
 *          on an allowed origin (review V05-SEC-3)
 *   PC-11  the platform key (WIPAY_API_KEY) verifies no tenant's payable: a
 *          business with its own account number and no key of its own is
 *          refused (review V05-SEC-3) and, since D-105, so is a business with
 *          no WiPay setting of its own (it checked out into the platform's
 *          account and the platform key settled it)
 *   PC-11b with no shared key a verified success books only against a payable
 *          of the business whose own key proved it (W10-WIPAY-KEY, D-105; was
 *          a todo): business A's proof is refused for business B's invoice
 *          and storefront order, B's for A's, the platform key's for a keyless
 *          business's invoice
 *   PC-06  PayPal capture by pay-link token: an order whose custom_id names
 *          another invoice, a wrong amount, a wrong currency (both ways) and a
 *          missing currency are refused with 400 before PayPal captures
 *          anything; no row, no posting
 *   PC-07  a matching capture records one SUCCESSFUL row of the invoice's
 *          amount and currency through the door (one posting, balanced), the
 *          invoice is PAID; the repeated capture and PayPal's
 *          PAYMENT.CAPTURE.COMPLETED delivery of the same capture id write no
 *          second row and no second posting
 *   PC-08  createPaypalOrder asks PayPal for the invoice's own currency, never
 *          USD for a TTD invoice, and the capture checks it: against the stubbed
 *          SDK a TTD invoice's own order is captured and recorded in TTD. Real
 *          PayPal does not offer TTD, so that checkout fails closed at
 *          createOrder; refusing it up front with 400 is PC-08b (todo: review
 *          V05-COR-4 / CR-V05-4, held by TG-14 / TG-14b)
 *   PC-09  LEDGER: every SUCCESSFUL provider payment of this suite has exactly
 *          one Payment:<id>:payment_recorded FinancialTransaction whose debits
 *          equal its credits; payments.service.ts writes no SUCCESSFUL 'paypal'
 *          payment.create outside createPaymentWithPosting
 *
 * Trial-N integration review (storefront provider paths):
 *
 *   PC-12  the storefront WiPay checkout's return URL must be on a platform
 *          origin, as the invoice checkout's (G6PUB-SEC-5)
 *   PC-13  a business with its own WiPay account and no key of its own (with
 *          or without the platform key) is not offered WiPay and its checkouts
 *          are refused before WiPay is called: no key could verify the
 *          callback (NEW-1, CR-V05-6)
 *   PC-14  an order the marketplace route cancelled ('cancelled') gets no
 *          provider checkout (G6PUB-SEC-2)
 *   PC-15  the storefront PayPal order is in the order's currency, and a
 *          CAPTURE.COMPLETED settles a storefront order only for its total in
 *          its currency, naming PayPal (G6PUB-SEC-4, G6ML-3)
 *   PC-16  the storefront Stripe checkout writes no PENDING payment naming the
 *          order as an invoice (it failed with P2003: G6ML-4)
 *
 * Trial-N repair round 2 (recheck G6RC-1, G6RC-7, G6ML-2 under D-69):
 *
 *   PC-17  the WiPay key and the receiving account come from one source, the
 *          business's own pair or the platform's pair, never mixed: a business
 *          with its own key and no account of its own, on a platform that has
 *          an account, is not offered WiPay and its checkouts are refused
 *          before WiPay is called (it got a live checkout into the platform's
 *          account whose callback its own key refused). A business with
 *          neither checked out into the platform's account (G6RC-1); since
 *          D-105 it is refused too (amended by W10-WIPAY-KEY)
 *   PC-18  the WiPay connector reports 'connected' exactly where the gateway
 *          list offers WiPay (G6RC-7)
 *   PC-19  D-69: a WiPay checkout, invoice or storefront, for an amount not in
 *          TTD answers 400 before WiPay is called, and WiPay is not offered
 *          for it (G6ML-2)
 *
 * W10-WIPAY-KEY (owner ruling D-105: WiPay checkout is offered only to a
 * business that has connected its own WiPay key; tenants no longer share the
 * platform's WiPay account):
 *
 *   PC-20  with the platform's WiPay pair set, a business with no WiPay key of
 *          its own is not offered WiPay on any gateway list (pay link, bare
 *          id, storefront) and every WiPay checkout for it (pay link, generic
 *          invoice and storefront checkouts, createStorePayment) is refused
 *          400 WIPAY_KEY_REQUIRED before WiPay is called; nothing is written
 *
 * Nothing on the boundary is mocked: PrismaService, PublicRateLimitGuard (on a
 * real Redis, its keys namespaced to this run), PaymentsService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService,
 * AccountingPeriodService and ChartOfAccountsSeederService read and write real
 * rows, and the production GlobalHttpExceptionFilter is installed. The
 * pay-link token is resolved by CommerceService.getPaymentLinkByToken's own
 * code over real PaymentLink rows. The provider edges are the stand-ins: the
 * PayPal SDK client is stubbed at getPaypalClient (no network), PayPal's
 * webhook signature verification (a network call) is stubbed, and
 * StoreOrderService (the storefront settlement door, off this packet's path)
 * and WiPayConnector (its payment events) are recorders. No WiPay endpoint is
 * called: PC-10's checkout requests go to a global fetch stub.
 *
 * Fixtures: prefix `v05a_` (registered in test/helpers/fixture-prefixes.json);
 * every fake provider id embeds it (Payment.providerPaymentId is globally
 * unique); hard-deleted by raw SQL in dependency order in beforeAll and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PaymentsService } from '../src/modules/payments/payments.service';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v05a_';
/** The keyed business's own WiPay API key (business.metaData.wipayApiKey), so no global env is touched. */
const WIPAY_KEY = `${P}wipay_api_key`;
/** WiPay's documented sandbox API key: public, so never a default. */
const WIPAY_SANDBOX_KEY = '123';
/** The keyed business's own WiPay account number (developer_id of its checkouts). */
const WIPAY_ACCOUNT = `${P}wipay_account`;
/** A platform WiPay key, set as WIPAY_API_KEY only inside the cases that test it (PC-11, PC-11b, PC-13, PC-17, PC-18, PC-20). */
const PLATFORM_KEY = `${P}platform_key`;
/** The platform's WiPay account number (WIPAY_ACCOUNT_NUMBER), set only inside PC-17, PC-18 and PC-20. */
const PLATFORM_ACCOUNT = `${P}platform_account`;
/** W10-WIPAY-KEY (D-105): the code of a WiPay refusal for a business with no WiPay key of its own. */
const WIPAY_KEY_REQUIRED = 'WIPAY_KEY_REQUIRED';
/** The refusal's message (wipayCheckoutTarget), unchanged since trial-N review NEW-1. */
const NO_KEY_MESSAGE = 'WiPay is not configured for this business: no WiPay API key to verify its payments';
/** The platform's one public origin (PUBLIC_URL_ALLOWLIST) and a pay-page return URL on it. */
const PUBLIC_ORIGIN = 'https://pay.v05a.test';
const RETURN_URL = `${PUBLIC_ORIGIN}/pay/link/return`;
const RATE_LIMIT_NS = `${P}${Date.now()}`;
const PREVIOUS_ENV: Record<string, string | undefined> = Object.fromEntries(
  ['RATE_LIMIT_KEY_NAMESPACE', 'WIPAY_API_KEY', 'WIPAY_ACCOUNT_NUMBER', 'PUBLIC_URL_ALLOWLIST'].map((k) => [k, process.env[k]]),
);

const ID = {
  owner: `${P}owner`,
  // WiPay
  bizNoKey: `${P}bizNoKey`, // no WiPay key anywhere
  contactNoKey: `${P}contactNoKey`,
  invNoKey: `${P}invNoKey`,
  bizKeyed: `${P}bizKeyed`, // metaData.wipayApiKey = WIPAY_KEY, wipayAccountNumber = WIPAY_ACCOUNT
  contactKeyed: `${P}contactKeyed`,
  invForged: `${P}invForged`, // forged proofs only
  invKeyed: `${P}invKeyed`, // the correct keyed proof, then its replay
  invFailed: `${P}invFailed`, // failure callbacks
  invCheckout: `${P}invCheckout`, // PC-10: the WiPay checkout
  storeOrder: `${P}storeOrder`,
  invPlatform: `${P}invPlatform`, // PC-11: bizNoKey pays into the platform's account
  bizKeyOnly: `${P}bizKeyOnly`, // its own WiPay key, no account number
  contactKeyOnly: `${P}contactKeyOnly`,
  invKeyOnly: `${P}invKeyOnly`,
  bizOwnAccount: `${P}bizOwnAccount`, // its own WiPay account number, no key of its own
  contactOwnAccount: `${P}contactOwnAccount`,
  invOwnAccount: `${P}invOwnAccount`,
  // PayPal
  bizPaypal: `${P}bizPaypal`,
  contactPaypal: `${P}contactPaypal`,
  invUsd: `${P}invUsd`, // USD 100: the matching capture
  invUsdOther: `${P}invUsdOther`, // USD 100: the invoice another order names
  invTtd: `${P}invTtd`, // TTD 100: currency refusals
  invTtdOwn: `${P}invTtdOwn`, // TTD 100: its own order, made in TTD
};
const TOTAL = 100;
const STORE_TOTAL = 50;

let db: any;
let app: any;
let redis: any;
let payments: PaymentsService;
const storeOrders = { updatePaymentStatus: vi.fn(async () => ({})) };
/** WiPayConnector's payment events (the payment-received and payment-failed emails hang off them). */
const wipayEvents = {
  emitPaymentReceived: vi.fn(async (..._args: unknown[]) => undefined),
  emitPaymentFailed: vi.fn(async (..._args: unknown[]) => undefined),
};

/** The PayPal order book behind the stubbed SDK client: order id -> its purchase units (the SDK's camelCase shape). */
const orderBook = new Map<string, any[]>();
let orderSeq = 0;
const paypalOrders = {
  createOrder: vi.fn(async (req: any) => {
    orderSeq += 1;
    const id = `${P}order_created_${orderSeq}`;
    orderBook.set(id, req?.body?.purchaseUnits ?? []);
    return { result: { id, status: 'CREATED', links: [] } };
  }),
  getOrder: vi.fn(async (req: any) => {
    const units = orderBook.get(req.id);
    if (!units) throw new Error(`RESOURCE_NOT_FOUND ${req.id}`);
    return { result: { id: req.id, status: 'APPROVED', purchaseUnits: units } };
  }),
  captureOrder: vi.fn(async (req: any) => {
    const units = orderBook.get(req.id) ?? [];
    return {
      result: {
        id: req.id,
        status: 'COMPLETED',
        purchaseUnits: [{ payments: { captures: [{ id: `${P}cap_${req.id}`, status: 'COMPLETED', amount: units[0]?.amount }] } }],
        payer: {},
      },
    };
  }),
};

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
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)} OR provider_payment_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR token LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function clearRateLimits() {
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** The hash the base accepted: md5(transaction_id + order_id + total + status), every input public. */
function publicHash(q: { transaction_id: string; order_id: string; total: string; status: string }): string {
  return md5(`${q.transaction_id}${q.order_id}${q.total}${q.status}`);
}

/** WiPay's documented response hash (D-19): md5(transaction_id + original total, 2 decimals + API key). */
function keyedHash(transactionId: string, originalTotal: number, apiKey: string): string {
  return md5(`${transactionId}${originalTotal.toFixed(2)}${apiKey}`);
}

function wipay(q: Record<string, string>) {
  return agent().get('/payments/wipay/callback').query(q);
}

function tokenOf(invoiceId: string): string {
  return `${P}tok_${invoiceId.slice(P.length)}`;
}

function capture(invoiceId: string, orderId: string) {
  return agent().post(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/paypal/capture/${encodeURIComponent(orderId)}`);
}

function paypalCheckout(invoiceId: string) {
  return agent()
    .post(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/checkout`)
    .send({ gateway: 'paypal' });
}

/** PayPal's PAYMENT.CAPTURE.COMPLETED delivery (its signature verification, a network call, stubbed). */
function captureWebhook(eventId: string, captureId: string, invoiceId: string, value: string, currency: string) {
  return agent()
    .post('/payments/paypal/webhook')
    .set('content-type', 'application/json')
    .send(JSON.stringify({ id: eventId, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId, custom_id: invoiceId, amount: { value, currency_code: currency } } }));
}

async function rowsOf(invoiceId: string): Promise<string[]> {
  const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
  return rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}:${p.currency}`);
}

/** The payment_recorded postings of a payment: `${type}:${status}:${amount}:${currency}`. */
async function recordedPostings(paymentId: string): Promise<string[]> {
  const txns = await db.financialTransaction.findMany({ where: { externalRef: `Payment:${paymentId}:payment_recorded` } });
  return txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}:${t.currency}`);
}

async function postingCount(invoiceId: string): Promise<number> {
  const ids = (await db.payment.findMany({ where: { invoiceId }, select: { id: true } })).map((p: any) => p.id);
  return db.financialTransaction.count({ where: { sourceType: 'Payment', sourceId: { in: ids } } });
}

async function claims(provider: string, providerEventId: string): Promise<number> {
  return db.webhookEvent.count({ where: { provider, providerEventId } });
}

async function wipayClaims(): Promise<string[]> {
  const rows = await db.webhookEvent.findMany({ where: { provider: 'wipay', providerEventId: { startsWith: P } }, orderBy: { receivedAt: 'asc' } });
  return rows.map((r: any) => r.providerEventId);
}

async function invoiceStatus(id: string): Promise<string> {
  return (await db.invoice.findUnique({ where: { id }, select: { status: true } })).status;
}

/** Every ledger transaction of one business is balanced. */
async function expectBalanced(businessId: string) {
  const unbalanced = await db.$queryRawUnsafe(
    `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
    businessId,
  );
  expect(unbalanced, businessId).toEqual([]);
}

async function seedBusiness(id: string, currency: string, metaData?: Record<string, unknown>) {
  await db.business.create({ data: { id, name: `V05A ${id}`, ownerId: ID.owner, currency, accountingBasis: 'CASH', ...(metaData ? { metaData } : {}) } });
  await db.membership.create({ data: { id: `${id}_m`, userId: ID.owner, businessId: id, role: 'OWNER' } });
}

let invoiceSeq = 0;
async function seedInvoice(id: string, businessId: string, contactId: string, total: number, currency: string) {
  invoiceSeq += 1;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `V05A-${String(invoiceSeq).padStart(3, '0')}`,
      status: 'SENT',
      subtotal: total,
      total,
      currency,
      businessId,
      contactId,
      items: { create: [{ id: `${id}_item1`, description: `v05a item ${invoiceSeq}`, quantity: 1, unitPrice: total, total }] },
    },
  });
  await db.paymentLink.create({ data: { id: `${id}_link`, token: tokenOf(id), invoiceId: id, businessId, active: true } });
}

beforeAll(async () => {
  // This run's own rate-limit keys (PublicRateLimitGuard reads it in NODE_ENV=test).
  process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
  // No global WiPay key or account (PC-11 sets the key for itself): the keyed businesses carry their own.
  delete process.env.WIPAY_API_KEY;
  delete process.env.WIPAY_ACCOUNT_NUMBER;
  // The platform's public origin, which the WiPay invoice checkout's return URL must be on (PC-10).
  process.env.PUBLIC_URL_ALLOWLIST = PUBLIC_ORIGIN;
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
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { WiPayConnector } = await import('../src/core/connectors/implementations/wipay.connector');

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
      RevenuePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      // COGS: no fixture invoice carries a product line, so nothing is sold.
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: eventStub },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      // The pay-link token resolver is CommerceService's own code over real rows; nothing else of it is on this path.
      {
        provide: CommerceService,
        useFactory: (prisma: unknown) => Object.assign(Object.create(CommerceService.prototype), { prisma }),
        inject: [PrismaService],
      },
      // The storefront settlement door (StoreOrderService.completeCheckout) is off this packet's path: a recorder.
      { provide: StoreOrderService, useValue: storeOrders },
      // WiPay's payment events (no email is sent here): a recorder.
      { provide: WiPayConnector, useValue: wipayEvents },
    ],
  }).compile();
  payments = moduleRef.get(PaymentsCtor);
  // The PayPal SDK client is the provider edge for orders and captures (no network).
  vi.spyOn(payments as any, 'getPaypalClient').mockReturnValue({ client: {}, ordersController: paypalOrders });
  // PayPal's verify-webhook-signature is a network call: the provider edge is stubbed.
  vi.spyOn(payments as any, 'verifyPaypalSignature').mockResolvedValue(true);

  // rawBody: the PayPal webhook reads the raw payload, as in app-bootstrap.
  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });

  await seedBusiness(ID.bizNoKey, 'TTD');
  await seedBusiness(ID.bizKeyed, 'TTD', { wipayApiKey: WIPAY_KEY, wipayAccountNumber: WIPAY_ACCOUNT });
  await seedBusiness(ID.bizPaypal, 'USD');
  await seedBusiness(ID.bizKeyOnly, 'TTD', { wipayApiKey: `${P}key_only_key` });
  await seedBusiness(ID.bizOwnAccount, 'TTD', { wipayAccountNumber: `${P}own_account` });
  for (const biz of [ID.bizNoKey, ID.bizKeyed, ID.bizPaypal, ID.bizKeyOnly, ID.bizOwnAccount]) await seeder.ensureDefaults(biz);

  await db.contact.create({ data: { id: ID.contactNoKey, businessId: ID.bizNoKey, firstName: 'V05A', lastName: 'NoKey', email: `${P}nokey@test.local` } });
  await db.contact.create({ data: { id: ID.contactKeyed, businessId: ID.bizKeyed, firstName: 'V05A', lastName: 'Keyed', email: `${P}keyed@test.local` } });
  await db.contact.create({ data: { id: ID.contactPaypal, businessId: ID.bizPaypal, firstName: 'V05A', lastName: 'Paypal', email: `${P}paypal@test.local` } });
  await db.contact.create({ data: { id: ID.contactKeyOnly, businessId: ID.bizKeyOnly, firstName: 'V05A', lastName: 'KeyOnly', email: `${P}keyonly@test.local` } });
  await db.contact.create({ data: { id: ID.contactOwnAccount, businessId: ID.bizOwnAccount, firstName: 'V05A', lastName: 'OwnAccount', email: `${P}ownaccount@test.local` } });

  await seedInvoice(ID.invNoKey, ID.bizNoKey, ID.contactNoKey, TOTAL, 'TTD');
  await seedInvoice(ID.invPlatform, ID.bizNoKey, ID.contactNoKey, TOTAL, 'TTD');
  for (const inv of [ID.invForged, ID.invKeyed, ID.invFailed, ID.invCheckout]) await seedInvoice(inv, ID.bizKeyed, ID.contactKeyed, TOTAL, 'TTD');
  await seedInvoice(ID.invKeyOnly, ID.bizKeyOnly, ID.contactKeyOnly, TOTAL, 'TTD');
  await seedInvoice(ID.invOwnAccount, ID.bizOwnAccount, ID.contactOwnAccount, TOTAL, 'TTD');
  await seedInvoice(ID.invUsd, ID.bizPaypal, ID.contactPaypal, TOTAL, 'USD');
  await seedInvoice(ID.invUsdOther, ID.bizPaypal, ID.contactPaypal, TOTAL, 'USD');
  await seedInvoice(ID.invTtd, ID.bizPaypal, ID.contactPaypal, TOTAL, 'TTD');
  await seedInvoice(ID.invTtdOwn, ID.bizPaypal, ID.contactPaypal, TOTAL, 'TTD');

  await db.marketplaceOrder.create({
    data: {
      id: ID.storeOrder,
      businessId: ID.bizKeyed,
      orderNumber: `${P}SO-0001`,
      customerName: 'V05A Store Customer',
      customerEmail: `${P}store@test.local`,
      subtotal: STORE_TOTAL,
      total: STORE_TOTAL,
      currency: 'TTD',
      paymentStatus: 'UNPAID',
      paymentMethod: 'WIPAY',
    },
  });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) {
    await clearRateLimits().catch(() => undefined);
    await redis.quit();
  }
  for (const [k, v] of Object.entries(PREVIOUS_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  await clearRateLimits();
});

describe('fixture sanity (real rows)', () => {
  it('seeded five tenants with a chart of accounts, SENT invoices with an active pay link each, one UNPAID storefront order, and no payment or claim', async () => {
    for (const biz of [ID.bizNoKey, ID.bizKeyed, ID.bizPaypal, ID.bizKeyOnly, ID.bizOwnAccount]) {
      expect(await db.chartOfAccount.count({ where: { businessId: biz } })).toBeGreaterThan(5);
    }
    expect(await db.invoice.count({ where: { businessId: { startsWith: P }, status: 'SENT' } })).toBe(12);
    expect(await db.paymentLink.count({ where: { token: { startsWith: P }, active: true } })).toBe(12);
    expect(await db.payment.count({ where: { businessId: { startsWith: P } } })).toBe(0);
    expect(await db.webhookEvent.count({ where: { providerEventId: { startsWith: P } } })).toBe(0);
    expect((await db.marketplaceOrder.findUnique({ where: { id: ID.storeOrder } })).paymentStatus).toBe('UNPAID');
    expect(process.env.WIPAY_API_KEY).toBeUndefined();
    expect(process.env.WIPAY_ACCOUNT_NUMBER).toBeUndefined();
  });
});

describe('V1-05: a WiPay callback settles nothing without a keyed proof (D-19)', () => {
  it('PC-01: no WiPay key configured: a success callback hashed from public values, and one keyed with the public sandbox key, get 400; no Payment row, no claim, the invoice stays SENT', async () => {
    const forged = { transaction_id: `${P}wtx_nokey`, order_id: ID.invNoKey, status: 'success', total: '1.00' };
    const res = await wipay({ ...forged, hash: publicHash(forged) });
    // At the base: 200 { success: true, 'Payment successful' } and a SUCCESSFUL, posted payment of the supplied 1.00.
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).not.toHaveProperty('success', true);

    const sandbox = { transaction_id: `${P}wtx_nokey_sandbox`, order_id: ID.invNoKey, status: 'success', total: TOTAL.toFixed(2) };
    const res2 = await wipay({ ...sandbox, hash: keyedHash(sandbox.transaction_id, TOTAL, WIPAY_SANDBOX_KEY) });
    expect(res2.status, JSON.stringify(res2.body)).toBe(400);

    expect(await rowsOf(ID.invNoKey)).toEqual([]);
    expect(await claims('wipay', forged.transaction_id)).toBe(0);
    expect(await claims('wipay', sandbox.transaction_id)).toBe(0);
    expect(await postingCount(ID.invNoKey)).toBe(0);
    expect(await invoiceStatus(ID.invNoKey)).toBe('SENT');
  });

  it('PC-02: a key configured: the public-values hash, a hash keyed with another key and a keyed hash over another total get 400; nothing is written', async () => {
    const base = { order_id: ID.invForged, status: 'success', total: TOTAL.toFixed(2) };
    const attempts: Array<[string, Record<string, string>]> = [
      ['public values (the base formula)', { ...base, transaction_id: `${P}wtx_forged_public`, hash: publicHash({ ...base, transaction_id: `${P}wtx_forged_public` }) }],
      ['another key', { ...base, transaction_id: `${P}wtx_forged_otherkey`, hash: keyedHash(`${P}wtx_forged_otherkey`, TOTAL, `${P}not_the_key`) }],
      ['the sandbox key', { ...base, transaction_id: `${P}wtx_forged_sandbox`, hash: keyedHash(`${P}wtx_forged_sandbox`, TOTAL, WIPAY_SANDBOX_KEY) }],
      ['another total', { ...base, total: '1.00', transaction_id: `${P}wtx_forged_total`, hash: keyedHash(`${P}wtx_forged_total`, 1, WIPAY_KEY) }],
      ['no hash', { ...base, transaction_id: `${P}wtx_forged_nohash` }],
    ];
    for (const [label, q] of attempts) {
      const res = await wipay(q);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(await claims('wipay', q.transaction_id), label).toBe(0);
    }
    expect(await rowsOf(ID.invForged)).toEqual([]);
    expect(await postingCount(ID.invForged)).toBe(0);
    expect(await invoiceStatus(ID.invForged)).toBe('SENT');
  });

  it('PC-03: a correct keyed proof records one SUCCESSFUL payment of the original total through the door (one posting, balanced), the invoice is PAID; the replay is deduplicated and writes nothing', async () => {
    const txn = `${P}wtx_keyed`;
    const q = { transaction_id: txn, order_id: ID.invKeyed, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(txn, TOTAL, WIPAY_KEY) };
    const res = await wipay(q);
    // At the base: 400 (the keyed hash is not the public-values one).
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ success: true, invoiceId: ID.invKeyed, message: 'Payment successful' });

    expect(await rowsOf(ID.invKeyed)).toEqual([`wipay:${txn}:SUCCESSFUL:${TOTAL}:TTD`]);
    const row = await db.payment.findUnique({ where: { providerPaymentId: txn } });
    expect(await recordedPostings(row.id)).toEqual([`INCOME:POSTED:${TOTAL}:TTD`]);
    expect(await invoiceStatus(ID.invKeyed)).toBe('PAID');
    expect(await claims('wipay', txn)).toBe(1);

    const replay = await wipay(q);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({ success: true, message: 'Duplicate callback ignored' });
    expect(await rowsOf(ID.invKeyed)).toEqual([`wipay:${txn}:SUCCESSFUL:${TOTAL}:TTD`]);
    expect(await recordedPostings(row.id)).toEqual([`INCOME:POSTED:${TOTAL}:TTD`]);
    expect(await postingCount(ID.invKeyed)).toBe(1);
    expect(await claims('wipay', txn)).toBe(1);
    await expectBalanced(ID.bizKeyed);
  });

  it("PC-04 (review V05-SEC-2, CR-V05-2, CR-V05-3): failure callbacks, hashed or not, answer 200 { success: false, 'Payment was not successful' } and act on nothing: no FAILED row, no claim, no payment-failed event, the invoice stays SENT", async () => {
    wipayEvents.emitPaymentFailed.mockClear();
    const notSuccessful = { success: false, invoiceId: ID.invFailed, message: 'Payment was not successful' };
    const unsigned = { transaction_id: `${P}wtx_fail_unsigned`, order_id: ID.invFailed, status: 'failed', total: TOTAL.toFixed(2) };
    // WiPay's documented decline carries no hash. At the base: 200 { success: false } with a FAILED row on the
    // caller's transaction id and its claim; at the packet head: 400 'Invalid WiPay callback signature', which the
    // pay page showed the payer for a declined card.
    const res = await wipay(unsigned);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual(notSuccessful);
    const noTxn = await wipay({ order_id: ID.invFailed, status: 'failed' });
    expect(noTxn.status, JSON.stringify(noTxn.body)).toBe(200);
    expect(noTxn.body).toEqual(notSuccessful);

    // A hash that verifies is proof of a success only (it does not cover the status): on a failure it changes nothing.
    const txn = `${P}wtx_fail_keyed`;
    const keyed = await wipay({ transaction_id: txn, order_id: ID.invFailed, status: 'failed', total: TOTAL.toFixed(2), hash: keyedHash(txn, TOTAL, WIPAY_KEY) });
    expect(keyed.status, JSON.stringify(keyed.body)).toBe(200);
    expect(keyed.body).toEqual(notSuccessful);

    expect(await rowsOf(ID.invFailed)).toEqual([]);
    expect(await postingCount(ID.invFailed)).toBe(0);
    expect(await invoiceStatus(ID.invFailed)).toBe('SENT');
    for (const id of [unsigned.transaction_id, `wipay_fail_${ID.invFailed}`, txn]) expect(await claims('wipay', id), id).toBe(0);
    expect(wipayEvents.emitPaymentFailed).not.toHaveBeenCalled();
  });

  it("PC-04b (review V05-SEC-2 R1): a keyed failure does not swallow that transaction's success: the success callback then records it once, the invoice is PAID", async () => {
    const txn = `${P}wtx_fail_then_success`;
    const q = { transaction_id: txn, order_id: ID.invFailed, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(txn, TOTAL, WIPAY_KEY) };
    const failed = await wipay({ ...q, status: 'failed' });
    expect(failed.body).toEqual({ success: false, invoiceId: ID.invFailed, message: 'Payment was not successful' });
    expect(await claims('wipay', txn)).toBe(0);
    // At the packet head: the failure wrote a FAILED row and took the claim, so this answered
    // 200 { success: true, 'Duplicate callback ignored' } and recorded nothing; the invoice stayed SENT.
    const res = await wipay(q);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ success: true, invoiceId: ID.invFailed, message: 'Payment successful' });
    expect(await rowsOf(ID.invFailed)).toEqual([`wipay:${txn}:SUCCESSFUL:${TOTAL}:TTD`]);
    const row = await db.payment.findUnique({ where: { providerPaymentId: txn } });
    expect(await recordedPostings(row.id)).toEqual([`INCOME:POSTED:${TOTAL}:TTD`]);
    expect(await invoiceStatus(ID.invFailed)).toBe('PAID');
    expect(await claims('wipay', txn)).toBe(1);
    await expectBalanced(ID.bizKeyed);
  });

  it("PC-04c (review V05-SEC-2): only this invoice's own SUCCESSFUL row of the transaction counts as recorded: a pre-V1-05 FAILED row on the id, or another invoice's payment of it, gets { success: false } with nothing recorded and the claim released", async () => {
    // (a) The FAILED row an unsigned pre-V1-05 failure callback wrote on a transaction id, seeded as that legacy row.
    const legacy = `${P}wtx_legacy_failed`;
    await db.payment.create({
      data: { provider: 'wipay', providerPaymentId: legacy, amount: 1, currency: 'TTD', status: 'FAILED', invoiceId: ID.invForged, businessId: ID.bizKeyed },
    });
    const onLegacy = await wipay({ transaction_id: legacy, order_id: ID.invForged, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(legacy, TOTAL, WIPAY_KEY) });
    // At the packet head: 200 { success: true, 'Payment successful' } with nothing recorded.
    expect(onLegacy.status, JSON.stringify(onLegacy.body)).toBe(200);
    expect(onLegacy.body).toEqual({ success: false, invoiceId: ID.invForged, message: 'Payment processing error' });
    expect(await rowsOf(ID.invForged)).toEqual([`wipay:${legacy}:FAILED:1:TTD`]);
    expect(await invoiceStatus(ID.invForged)).toBe('SENT');
    expect(await claims('wipay', legacy)).toBe(0);

    // (b) PC-03's transaction, its claim released (V1-15c), brought back for another invoice of the same total.
    const keyedTxn = `${P}wtx_keyed`;
    await db.webhookEvent.deleteMany({ where: { provider: 'wipay', providerEventId: keyedTxn } });
    const elsewhere = await wipay({ transaction_id: keyedTxn, order_id: ID.invForged, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(keyedTxn, TOTAL, WIPAY_KEY) });
    expect(elsewhere.status, JSON.stringify(elsewhere.body)).toBe(200);
    expect(elsewhere.body).toEqual({ success: false, invoiceId: ID.invForged, message: 'Payment processing error' });
    expect(await rowsOf(ID.invForged)).toEqual([`wipay:${legacy}:FAILED:1:TTD`]);
    expect(await invoiceStatus(ID.invForged)).toBe('SENT');
    expect(await claims('wipay', keyedTxn)).toBe(0);
    // On its own invoice it is the payment already recorded: 'Payment successful', no second row or posting.
    const own = await wipay({ transaction_id: keyedTxn, order_id: ID.invKeyed, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(keyedTxn, TOTAL, WIPAY_KEY) });
    expect(own.body).toMatchObject({ success: true, invoiceId: ID.invKeyed, message: 'Payment successful' });
    expect(await rowsOf(ID.invKeyed)).toEqual([`wipay:${keyedTxn}:SUCCESSFUL:${TOTAL}:TTD`]);
    expect(await postingCount(ID.invKeyed)).toBe(1);
    expect(await claims('wipay', keyedTxn)).toBe(1);
  });

  it('PC-05: a storefront order: a public-values success callback gets 400 and an unsigned failure { success: false }; neither reaches StoreOrderService; a keyed proof over the order total settles it once; the replay does not', async () => {
    storeOrders.updatePaymentStatus.mockClear();
    const forged = { transaction_id: `${P}wtx_store_forged`, order_id: ID.storeOrder, status: 'success', total: STORE_TOTAL.toFixed(2) };
    const res = await wipay({ ...forged, hash: publicHash(forged) });
    // At the base: 200 and updatePaymentStatus(order, 'PAID') (SEC-V33-2).
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    // At the base: updatePaymentStatus(order, 'FAILED') and a claim (review CR-V05-3: now answered, never acted on).
    const unsignedFail = await wipay({ transaction_id: `${P}wtx_store_fail`, order_id: ID.storeOrder, status: 'failed', total: STORE_TOTAL.toFixed(2) });
    expect(unsignedFail.status, JSON.stringify(unsignedFail.body)).toBe(200);
    expect(unsignedFail.body).toEqual({ success: false, invoiceId: ID.storeOrder, message: 'Payment was not successful' });
    expect(storeOrders.updatePaymentStatus).not.toHaveBeenCalled();
    expect(await claims('wipay', forged.transaction_id)).toBe(0);
    expect(await claims('wipay', `${P}wtx_store_fail`)).toBe(0);
    expect((await db.marketplaceOrder.findUnique({ where: { id: ID.storeOrder } })).paymentStatus).toBe('UNPAID');

    const txn = `${P}wtx_store_keyed`;
    const q = { transaction_id: txn, order_id: ID.storeOrder, status: 'success', total: STORE_TOTAL.toFixed(2), hash: keyedHash(txn, STORE_TOTAL, WIPAY_KEY) };
    const ok = await wipay(q);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ success: true, invoiceId: ID.storeOrder });
    // Trial-N review G6ML-3: the settlement names its provider (the door posts it to PAYMENT_PROCESSOR, not CASH).
    expect(storeOrders.updatePaymentStatus.mock.calls).toEqual([[ID.storeOrder, 'PAID', txn, 'wipay']]);

    const replay = await wipay(q);
    expect(replay.body).toMatchObject({ success: true, message: 'Duplicate callback ignored' });
    expect(storeOrders.updatePaymentStatus).toHaveBeenCalledTimes(1);
    expect(await claims('wipay', txn)).toBe(1);
  });

  it('every WiPay claim this suite left is one a verified success callback made', async () => {
    expect((await wipayClaims()).sort()).toEqual([`${P}wtx_keyed`, `${P}wtx_fail_then_success`, `${P}wtx_store_keyed`].sort());
  });
});

describe('review V05-SEC-1: the WiPay checkouts never hand the API key to the payer', () => {
  /** The WiPay requests the checkouts made (global fetch stubbed; no network). */
  let wipayRequests: Array<{ url: string; body: string }> = [];
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    wipayRequests = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      if (!new URL(url).host.endsWith('wipayfinancial.com')) throw new Error(`v05a: unexpected network call to ${url}`);
      wipayRequests.push({ url, body: String(init?.body ?? '') });
      // A 2xx with no Location header and no URL in the body: the checkout falls back to the request's parameter echo.
      return new Response('OK', { status: 200 });
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function wipayCheckout(invoiceId: string, returnUrl: string) {
    return agent()
      .post(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/checkout`)
      .send({ gateway: 'wipay', returnUrl });
  }

  it("PC-10: the invoice checkout names the merchant's account number as developer_id; neither the request to WiPay nor the parameter echo handed to the payer carries the API key, so the payer cannot compute the callback proof", async () => {
    const res = await wipayCheckout(ID.invCheckout, RETURN_URL);
    // At the packet head: 201 with developer_id=<the business's WiPay API key> in redirectUrl (review R2).
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ type: 'redirect' });
    const redirect = new URL(res.body.redirectUrl);
    expect(redirect.host).toBe('tt.wipayfinancial.com');
    expect(redirect.searchParams.get('order_id')).toBe(ID.invCheckout);
    expect(redirect.searchParams.get('developer_id')).toBe(WIPAY_ACCOUNT);
    expect(redirect.searchParams.get('account_number')).toBe(WIPAY_ACCOUNT);
    expect(res.body.redirectUrl).not.toContain(WIPAY_KEY);
    expect(JSON.stringify(res.body)).not.toContain(WIPAY_KEY);

    expect(wipayRequests).toHaveLength(1);
    const sent = new URLSearchParams(wipayRequests[0].body);
    expect(sent.get('developer_id')).toBe(WIPAY_ACCOUNT);
    expect(sent.get('environment')).toBe('live');
    expect(sent.get('total')).toBe(TOTAL.toFixed(2));
    expect(wipayRequests[0].body).not.toContain(WIPAY_KEY);

    // A checkout records nothing.
    expect(await rowsOf(ID.invCheckout)).toEqual([]);
    expect(await invoiceStatus(ID.invCheckout)).toBe('SENT');
  });

  it('PC-10b: the storefront WiPay checkout (createStorePayment) names the account number too and hands back no key', async () => {
    const result = await payments.createStorePayment({
      orderId: ID.storeOrder,
      amount: STORE_TOTAL,
      currency: 'TTD',
      method: 'WIPAY',
      businessId: ID.bizKeyed,
      returnUrl: RETURN_URL,
    });
    expect(result.status).toBe('REDIRECT');
    expect(new URL(result.redirectUrl!).searchParams.get('developer_id')).toBe(WIPAY_ACCOUNT);
    expect(JSON.stringify(result)).not.toContain(WIPAY_KEY);
    expect(wipayRequests).toHaveLength(1);
    expect(new URLSearchParams(wipayRequests[0].body).get('developer_id')).toBe(WIPAY_ACCOUNT);
    expect(wipayRequests[0].body).not.toContain(WIPAY_KEY);
  });

  it('PC-10c: a live WiPay checkout with no account number to name is refused with 400 before WiPay is called, for the invoice and the storefront alike', async () => {
    const res = await wipayCheckout(ID.invKeyOnly, RETURN_URL);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe('WiPay is not configured for this business: no WiPay account number');
    expect(JSON.stringify(res.body)).not.toContain(`${P}key_only_key`);
    await expect(
      payments.createStorePayment({ orderId: `${P}store_keyonly`, amount: 10, currency: 'TTD', method: 'WIPAY', businessId: ID.bizKeyOnly, returnUrl: RETURN_URL }),
    ).rejects.toThrow('WiPay is not configured for this business: no WiPay account number');
    expect(wipayRequests).toEqual([]);
    expect(await rowsOf(ID.invKeyOnly)).toEqual([]);
  });

  it('PC-10d (review V05-SEC-3): the invoice checkout refuses a return URL off the platform origin (WiPay hands its proof to it), and refuses outright when no origin is configured; WiPay is not called', async () => {
    for (const bad of ['https://evil.v05a.test/collect', 'javascript:alert(1)', 'not a url']) {
      await clearRateLimits();
      const res = await wipayCheckout(ID.invCheckout, bad);
      expect(res.status, `${bad}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.message, bad).toBe('Invalid return URL');
    }
    const previousBase = process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.PUBLIC_URL_ALLOWLIST;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    try {
      await clearRateLimits();
      const res = await wipayCheckout(ID.invCheckout, RETURN_URL);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.message).toBe('Server misconfigured: no allowed return-URL origins set');
    } finally {
      process.env.PUBLIC_URL_ALLOWLIST = PUBLIC_ORIGIN;
      if (previousBase !== undefined) process.env.NEXT_PUBLIC_BASE_URL = previousBase;
    }
    expect(wipayRequests).toEqual([]);
  });
});

describe('review V05-SEC-3: the platform WiPay key verifies only payables that pay into the platform account', () => {
  it("PC-11 (review V05-SEC-3; W10-WIPAY-KEY, D-105): with WIPAY_API_KEY set, the platform key settles no tenant's payable: a business with its own WiPay account number and no key of its own, and a business with no WiPay setting of its own (on the platform's account before D-105), get 400 for a callback keyed with the platform key; nothing is written", async () => {
    process.env.WIPAY_API_KEY = PLATFORM_KEY;
    try {
      const own = `${P}wtx_platform_own_account`;
      const refused = await wipay({ transaction_id: own, order_id: ID.invOwnAccount, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(own, TOTAL, PLATFORM_KEY) });
      // At the packet head: 200 'Payment successful' and a SUCCESSFUL row (the platform key verified every keyless tenant).
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(await rowsOf(ID.invOwnAccount)).toEqual([]);
      expect(await claims('wipay', own)).toBe(0);
      expect(await invoiceStatus(ID.invOwnAccount)).toBe('SENT');

      // D-105: a business with no WiPay setting of its own no longer pays into the platform's account, so the
      // platform key proves nothing for it either. At 1a9ca4fd: 200 'Payment successful', a SUCCESSFUL row, PAID.
      const txn = `${P}wtx_platform`;
      const keyless = await wipay({ transaction_id: txn, order_id: ID.invPlatform, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(txn, TOTAL, PLATFORM_KEY) });
      expect(keyless.status, JSON.stringify(keyless.body)).toBe(400);
      expect(keyless.body).not.toHaveProperty('success', true);
      expect(await rowsOf(ID.invPlatform)).toEqual([]);
      expect(await claims('wipay', txn)).toBe(0);
      expect(await postingCount(ID.invPlatform)).toBe(0);
      expect(await invoiceStatus(ID.invPlatform)).toBe('SENT');
      await expectBalanced(ID.bizNoKey);
    } finally {
      delete process.env.WIPAY_API_KEY;
    }
  });

  it("PC-11b (W10-WIPAY-KEY, D-105, was it.todo): with no shared key a verified success books only against a payable of the business whose own key proved it: a proof keyed with business A's key is refused (400, nothing written) for business B's invoice and storefront order of the same total, B's for A's, and the platform key's for a keyless business's invoice; the same proof settles A's own invoice once", async () => {
    // WiPay's documented proof md5(transaction_id + total + API key) (D-19) names no order_id. Before D-105 a
    // success proved by the shared platform key could be booked against the payable of any keyless tenant of the
    // same total. With each business on its own key (D-105) the key names the business, so a proof verifies only
    // against that business's payables; within one business the transaction id is claimed once, and the money
    // reached that business's own WiPay account.
    const invA = `${P}invCrossA`; // bizKeyed: WIPAY_KEY
    const invB = `${P}invCrossB`; // bizKeyOnly: its own key
    const orderB = `${P}storeCrossB`;
    const B_KEY = `${P}key_only_key`;
    await seedInvoice(invA, ID.bizKeyed, ID.contactKeyed, TOTAL, 'TTD');
    await seedInvoice(invB, ID.bizKeyOnly, ID.contactKeyOnly, TOTAL, 'TTD');
    await db.marketplaceOrder.create({
      data: {
        id: orderB,
        businessId: ID.bizKeyOnly,
        orderNumber: `${P}SO-0011`,
        customerName: 'V05A Store Customer',
        customerEmail: `${P}store@test.local`,
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        type: 'STOREFRONT',
        paymentStatus: 'UNPAID',
        paymentMethod: 'WIPAY',
      },
    });
    storeOrders.updatePaymentStatus.mockClear();
    const success = (txn: string, orderId: string, key: string) =>
      wipay({ transaction_id: txn, order_id: orderId, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(txn, TOTAL, key) });

    const txnA = `${P}wtx_cross_a`;
    const txnB = `${P}wtx_cross_b`;
    const txnP = `${P}wtx_cross_platform`;
    process.env.WIPAY_API_KEY = PLATFORM_KEY;
    process.env.WIPAY_ACCOUNT_NUMBER = PLATFORM_ACCOUNT;
    try {
      const attempts: Array<[string, string, string, string]> = [
        ["A's proof on B's invoice", txnA, invB, WIPAY_KEY],
        ["A's proof on B's storefront order", txnA, orderB, WIPAY_KEY],
        ["B's proof on A's invoice", txnB, invA, B_KEY],
        // At 1a9ca4fd: 200 'Payment successful' (the platform key verified every keyless tenant's payable).
        ["the platform key's proof on a keyless business's invoice", txnP, ID.invNoKey, PLATFORM_KEY],
      ];
      for (const [label, txn, orderId, key] of attempts) {
        const res = await success(txn, orderId, key);
        expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body, label).not.toHaveProperty('success', true);
      }
    } finally {
      delete process.env.WIPAY_API_KEY;
      delete process.env.WIPAY_ACCOUNT_NUMBER;
    }
    for (const inv of [invA, invB, ID.invNoKey]) {
      expect(await rowsOf(inv), inv).toEqual([]);
      expect(await invoiceStatus(inv), inv).toBe('SENT');
    }
    for (const txn of [txnA, txnB, txnP]) expect(await claims('wipay', txn), txn).toBe(0);
    expect(storeOrders.updatePaymentStatus, "B's storefront order is not settled").not.toHaveBeenCalled();

    // Control: A's proof settles A's own invoice once.
    const ok = await success(txnA, invA, WIPAY_KEY);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ success: true, invoiceId: invA, message: 'Payment successful' });
    expect(await rowsOf(invA)).toEqual([`wipay:${txnA}:SUCCESSFUL:${TOTAL}:TTD`]);
    expect(await invoiceStatus(invA)).toBe('PAID');
    // Brought back for B's invoice it is still refused (B's key does not verify it), never 'Duplicate callback ignored'.
    const again = await success(txnA, invB, WIPAY_KEY);
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    expect(await rowsOf(invB)).toEqual([]);
    expect(await claims('wipay', txnA)).toBe(1);
    await expectBalanced(ID.bizKeyed);
  });
});

describe('V1-05: a PayPal capture is bound to its invoice, amount and currency and recorded through the ledger door', () => {
  it('PC-06: orders naming another invoice, a wrong amount, a wrong currency (both ways) or no currency get 400 before PayPal captures anything; no row, no posting', async () => {
    const book: Array<[string, string, string, any[]]> = [
      ['custom_id of another invoice', ID.invUsd, `${P}order_other_invoice`, [{ customId: ID.invUsdOther, amount: { currencyCode: 'USD', value: TOTAL.toFixed(2) } }]],
      ['a wrong amount', ID.invUsd, `${P}order_wrong_amount`, [{ customId: ID.invUsd, amount: { currencyCode: 'USD', value: '1.00' } }]],
      ['USD order for a TTD invoice', ID.invTtd, `${P}order_usd_for_ttd`, [{ customId: ID.invTtd, amount: { currencyCode: 'USD', value: TOTAL.toFixed(2) } }]],
      ['TTD order for a USD invoice', ID.invUsd, `${P}order_ttd_for_usd`, [{ customId: ID.invUsd, amount: { currencyCode: 'TTD', value: TOTAL.toFixed(2) } }]],
      ['no currency', ID.invTtd, `${P}order_no_currency`, [{ customId: ID.invTtd, amount: { value: TOTAL.toFixed(2) } }]],
    ];
    const captures = paypalOrders.captureOrder.mock.calls.length;
    for (const [label, invoiceId, orderId, units] of book) {
      orderBook.set(orderId, units);
      await clearRateLimits();
      const res = await capture(invoiceId, orderId);
      // At the base: 'USD order for a TTD invoice', 'TTD order for a USD invoice' and 'no currency' are captured and recorded.
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.message, label).toBe('This PayPal order does not belong to this invoice');
    }
    expect(paypalOrders.captureOrder.mock.calls.length, 'PayPal captured nothing').toBe(captures);
    for (const inv of [ID.invUsd, ID.invUsdOther, ID.invTtd]) {
      expect(await rowsOf(inv), inv).toEqual([]);
      expect(await postingCount(inv), inv).toBe(0);
      expect(await invoiceStatus(inv), inv).toBe('SENT');
    }
  });

  it("PC-07: a matching capture records one SUCCESSFUL row of the invoice's amount and currency through the door, the invoice is PAID; the repeated capture and the CAPTURE.COMPLETED delivery of the same capture id write no duplicate", async () => {
    const orderId = `${P}order_match`;
    orderBook.set(orderId, [{ referenceId: ID.invUsd, customId: ID.invUsd, amount: { currencyCode: 'USD', value: TOTAL.toFixed(2) } }]);
    const res = await capture(ID.invUsd, orderId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ id: orderId, status: 'COMPLETED' });

    const captureId = `${P}cap_${orderId}`;
    expect(await rowsOf(ID.invUsd)).toEqual([`paypal:${captureId}:SUCCESSFUL:${TOTAL}:USD`]);
    const row = await db.payment.findUnique({ where: { providerPaymentId: captureId } });
    expect(row).toMatchObject({ invoiceId: ID.invUsd, businessId: ID.bizPaypal });
    expect(await recordedPostings(row.id)).toEqual([`INCOME:POSTED:${TOTAL}:USD`]);
    expect(await invoiceStatus(ID.invUsd)).toBe('PAID');

    await clearRateLimits();
    const again = await capture(ID.invUsd, orderId);
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    const webhook = await captureWebhook(`${P}WH_capture_match`, captureId, ID.invUsd, TOTAL.toFixed(2), 'USD');
    expect(webhook.status, JSON.stringify(webhook.body)).toBe(201);

    expect(await rowsOf(ID.invUsd)).toEqual([`paypal:${captureId}:SUCCESSFUL:${TOTAL}:USD`]);
    expect(await recordedPostings(row.id)).toEqual([`INCOME:POSTED:${TOTAL}:USD`]);
    expect(await postingCount(ID.invUsd)).toBe(1);
    await expectBalanced(ID.bizPaypal);
  });

  // Review V05-COR-4 / CR-V05-4: this proves the currency binding against the stubbed SDK only; real PayPal does not offer TTD (PC-08b).
  it("PC-08: createPaypalOrder asks PayPal for the invoice's own currency, never USD for a TTD invoice, and the capture checks it: against the stubbed SDK a TTD invoice's own order is captured and recorded in TTD", async () => {
    const created = await paypalCheckout(ID.invTtdOwn);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ type: 'paypal_order' });
    const orderId = created.body.orderId as string;
    // At the base: currencyCode 'USD' whatever the invoice's currency.
    expect(orderBook.get(orderId)).toEqual([expect.objectContaining({ customId: ID.invTtdOwn, amount: { currencyCode: 'TTD', value: TOTAL.toFixed(2) } })]);

    await clearRateLimits();
    const res = await capture(ID.invTtdOwn, orderId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await rowsOf(ID.invTtdOwn)).toEqual([`paypal:${P}cap_${orderId}:SUCCESSFUL:${TOTAL}:TTD`]);
    expect(await invoiceStatus(ID.invTtdOwn)).toBe('PAID');
    await expectBalanced(ID.bizPaypal);
  });

  it.todo(
    'PC-08b (review V05-COR-4 / CR-V05-4, held outside this write set): PayPal does not support TTD (nor JMD, BBD, GYD, XCD), so real PayPal ' +
      "refuses createPaypalOrder's TTD order and the payer gets 500 'Failed to create PayPal order' (fail-closed: the base charged X USD for an " +
      'X TTD invoice). The fix is a 400 before PayPal is called for a currency PayPal does not support, and no PayPal in the gateway list of such ' +
      "an invoice (getGatewaysByToken / getGatewaysForInvoice). Both would break pay-link-token-gate TG-14 (PayPal listed and a 201 PayPal checkout " +
      'for a TTD invoice) and TG-14b (a TTD PayPal order captured), bound by manifests/pay-link-token-gate.json; their fixtures need a scope ' +
      'release (a USD invoice, or the refusal pinned).',
  );
});

describe('V1-05: the ledger', () => {
  it('PC-09: every SUCCESSFUL provider payment of this suite has exactly one Payment:<id>:payment_recorded transaction, debits equal to credits', async () => {
    const successful = await db.payment.findMany({ where: { businessId: { startsWith: P }, status: 'SUCCESSFUL' }, orderBy: { createdAt: 'asc' } });
    expect(successful.map((p: any) => `${p.provider}:${p.invoiceId}`).sort()).toEqual(
      // W10-WIPAY-KEY (D-105): the platform key settles no tenant's invoice (PC-11), so invPlatform has no
      // payment; PC-11b's control settles invCrossA with its own business's key.
      [`paypal:${ID.invTtdOwn}`, `paypal:${ID.invUsd}`, `wipay:${ID.invKeyed}`, `wipay:${ID.invFailed}`, `wipay:${P}invCrossA`].sort(),
    );
    for (const p of successful) {
      const txns = await db.financialTransaction.findMany({
        where: { businessId: p.businessId, externalRef: `Payment:${p.id}:payment_recorded` },
        select: { id: true },
      });
      expect(txns, p.providerPaymentId).toHaveLength(1);
      const sums: Array<{ debit: string; credit: string }> = await db.$queryRawUnsafe(
        `SELECT COALESCE(SUM(debit), 0)::text AS debit, COALESCE(SUM(credit), 0)::text AS credit FROM ledger_entries WHERE transaction_id = $1`,
        txns[0].id,
      );
      expect(Number(sums[0].debit), p.providerPaymentId).toBeGreaterThan(0);
      expect(Number(sums[0].debit), p.providerPaymentId).toBe(Number(sums[0].credit));
    }
    for (const biz of [ID.bizNoKey, ID.bizKeyed, ID.bizPaypal]) await expectBalanced(biz);
  });

  it("PC-09b: payments.service.ts writes no SUCCESSFUL 'paypal' payment.create outside createPaymentWithPosting", () => {
    const source = readFileSync(path.resolve(__dirname, '../src/modules/payments/payments.service.ts'), 'utf8');
    const offenders: string[] = [];
    const re = /\.payment\s*\.\s*create\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      // The call's argument text, to its matching parenthesis.
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1;
        else if (source[end] === ')' && --depth === 0) break;
      }
      const call = source.slice(m.index, end + 1);
      if (/provider:\s*'paypal'/.test(call) && /status:\s*'SUCCESSFUL'/.test(call)) {
        offenders.push(`payments.service.ts:${source.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('trial-N review: the storefront provider checkouts and settlements fail closed', () => {
  /** The provider requests the checkouts made (global fetch stubbed; no network). */
  let providerRequests: Array<{ url: string; body: string }> = [];
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
  const STRIPE_SESSION_URL = 'https://checkout.stripe.v05a.test/session';

  beforeEach(() => {
    providerRequests = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      const host = new URL(url).host;
      providerRequests.push({ url, body: String(init?.body ?? '') });
      if (host.endsWith('wipayfinancial.com')) return new Response('OK', { status: 200 });
      if (host === 'api.stripe.com') {
        return new Response(JSON.stringify({ id: `${P}cs_store`, url: STRIPE_SESSION_URL }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`v05a: unexpected network call to ${url}`);
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function gatewaysOf(invoiceId: string) {
    return agent().get(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/gateways`);
  }

  function wipayCheckout(invoiceId: string) {
    return agent()
      .post(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/checkout`)
      .send({ gateway: 'wipay', returnUrl: RETURN_URL });
  }

  it('PC-12 (G6PUB-SEC-5, V05-SEC-3): the storefront WiPay checkout refuses a return URL off the platform origin, and a missing one, with 400 before WiPay is called', async () => {
    for (const returnUrl of ['https://evil.v05a.test/collect', 'javascript:alert(1)', undefined]) {
      // At 2db133a4: REDIRECT with return_url=<the caller's URL> (WiPay hands its keyed proof there).
      await expect(
        payments.createStorePayment({ orderId: ID.storeOrder, amount: STORE_TOTAL, currency: 'TTD', method: 'WIPAY', businessId: ID.bizKeyed, returnUrl }),
        String(returnUrl),
      ).rejects.toThrow('Invalid return URL');
    }
    expect(providerRequests).toEqual([]);
    // Control: the platform's own return URL is accepted.
    const ok = await payments.createStorePayment({ orderId: ID.storeOrder, amount: STORE_TOTAL, currency: 'TTD', method: 'WIPAY', businessId: ID.bizKeyed, returnUrl: RETURN_URL });
    expect(ok.status).toBe('REDIRECT');
    expect(new URLSearchParams(providerRequests[0].body).get('return_url')).toBe(RETURN_URL);
  });

  it('PC-13 (NEW-1, CR-V05-6): no WiPay key verifies a business with its own WiPay account and no key of its own, so WiPay is not offered and its checkouts are refused (400) before WiPay is called', async () => {
    for (const platformKey of [PLATFORM_KEY, undefined]) {
      if (platformKey) process.env.WIPAY_API_KEY = platformKey;
      try {
        await clearRateLimits();
        const gateways = await gatewaysOf(ID.invOwnAccount);
        expect(gateways.status, JSON.stringify(gateways.body)).toBe(200);
        // At 2db133a4: ['wipay'] (with the platform key a live checkout into the merchant's account follows; its callback is always refused).
        expect(gateways.body.map((g: { id: string }) => g.id), `platform key ${platformKey ?? 'unset'}`).not.toContain('wipay');

        const res = await wipayCheckout(ID.invOwnAccount);
        expect(res.status, `platform key ${platformKey ?? 'unset'}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.message).toBe('WiPay is not configured for this business: no WiPay API key to verify its payments');
        await expect(
          payments.createStorePayment({ orderId: `${P}store_own_account`, amount: 10, currency: 'TTD', method: 'WIPAY', businessId: ID.bizOwnAccount, returnUrl: RETURN_URL }),
        ).rejects.toThrow('WiPay is not configured for this business: no WiPay API key to verify its payments');
      } finally {
        delete process.env.WIPAY_API_KEY;
      }
    }
    expect(providerRequests).toEqual([]);
    expect(await rowsOf(ID.invOwnAccount)).toEqual([]);

    // Control: a business whose own key verifies its callbacks is offered WiPay.
    await clearRateLimits();
    const keyed = await gatewaysOf(ID.invCheckout);
    expect(keyed.body.map((g: { id: string }) => g.id)).toContain('wipay');
  });

  it("PC-14 (G6PUB-SEC-2): a storefront order the marketplace route cancelled ('cancelled') gets no provider checkout", async () => {
    const cancelledId = `${P}storeCancelled`;
    await db.marketplaceOrder.create({
      data: {
        id: cancelledId,
        businessId: ID.bizKeyed,
        orderNumber: `${P}SO-0002`,
        customerName: 'V05A Store Customer',
        customerEmail: `${P}store@test.local`,
        subtotal: STORE_TOTAL,
        total: STORE_TOTAL,
        currency: 'TTD',
        status: 'cancelled',
        type: 'STOREFRONT',
        paymentStatus: 'UNPAID',
        paymentMethod: 'WIPAY',
      },
    });
    // At 2db133a4: a WiPay redirect for the cancelled order.
    await expect(
      payments.createGenericCheckout({ payableType: 'storefront_order', payableId: cancelledId, gateway: 'wipay', returnUrl: RETURN_URL }),
    ).rejects.toThrow('Storefront order is already paid or cancelled');
    expect(providerRequests).toEqual([]);
  });

  it("PC-15 (G6PUB-SEC-4): the storefront PayPal order is made in the order's own currency, and a CAPTURE.COMPLETED settles a storefront order only for its total in its currency, naming PayPal (G6ML-3)", async () => {
    paypalOrders.createOrder.mockClear();
    const created = await payments.createStorePayment({ orderId: ID.storeOrder, amount: STORE_TOTAL, currency: 'TTD', method: 'PAYPAL', businessId: ID.bizKeyed });
    expect(created.paymentId).toBeTruthy();
    const units = (paypalOrders.createOrder.mock.calls[0] as any[])[0].body.purchaseUnits;
    // At 2db133a4: currencyCode 'USD' for a TTD order.
    expect(units.map((u: any) => `${u.customId}:${u.amount.value}:${u.amount.currencyCode}`)).toEqual([`${ID.storeOrder}:${STORE_TOTAL.toFixed(2)}:TTD`]);

    storeOrders.updatePaymentStatus.mockClear();
    // A capture of another amount, and one in another currency, naming the storefront order (PayPal orders can be made client-side).
    const short = await captureWebhook(`${P}WH_store_short`, `${P}cap_store_short`, ID.storeOrder, '0.01', 'TTD');
    const usd = await captureWebhook(`${P}WH_store_usd`, `${P}cap_store_usd`, ID.storeOrder, STORE_TOTAL.toFixed(2), 'USD');
    expect(short.status, JSON.stringify(short.body)).toBe(201);
    expect(usd.status, JSON.stringify(usd.body)).toBe(201);
    // At 2db133a4: updatePaymentStatus(order, 'PAID', <capture>) for each, so the order total is booked for 0.01 TTD and for USD.
    expect(storeOrders.updatePaymentStatus).not.toHaveBeenCalled();

    const ok = await captureWebhook(`${P}WH_store_ok`, `${P}cap_store_ok`, ID.storeOrder, STORE_TOTAL.toFixed(2), 'TTD');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(storeOrders.updatePaymentStatus.mock.calls).toEqual([[ID.storeOrder, 'PAID', `${P}cap_store_ok`, 'paypal']]);
  });

  it('PC-16 (G6ML-4): the storefront Stripe checkout answers its session and writes no PENDING payment naming the order as an invoice', async () => {
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = `${P}sk_test`;
    try {
      // At 2db133a4: P2003 (payments.invoice_id references invoices) after the Stripe session was created: every storefront Stripe checkout fails.
      const result = await payments.createStorePayment({ orderId: ID.storeOrder, amount: STORE_TOTAL, currency: 'TTD', method: 'STRIPE', businessId: ID.bizKeyed, returnUrl: RETURN_URL });
      expect(result).toEqual({ paymentId: `${P}cs_store`, status: 'REDIRECT', redirectUrl: STRIPE_SESSION_URL });
    } finally {
      if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previous;
    }
    const sent = new URLSearchParams(providerRequests.find((r) => r.url.includes('api.stripe.com'))!.body);
    expect(sent.get('client_reference_id')).toBe(ID.storeOrder);
    expect(sent.get('line_items[0][price_data][currency]')).toBe('ttd');
    expect(await db.payment.count({ where: { OR: [{ invoiceId: ID.storeOrder }, { providerPaymentId: `${P}cs_store` }] } })).toBe(0);
  });
});

describe('trial-N repair round 2: one WiPay merchant per checkout, TTD only (D-69)', () => {
  /** The provider requests the checkouts made (global fetch stubbed; no network). */
  let providerRequests: Array<{ url: string; body: string }> = [];
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    providerRequests = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      providerRequests.push({ url, body: String(init?.body ?? '') });
      if (new URL(url).host.endsWith('wipayfinancial.com')) return new Response('OK', { status: 200 });
      throw new Error(`v05a: unexpected network call to ${url}`);
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    delete process.env.WIPAY_API_KEY;
    delete process.env.WIPAY_ACCOUNT_NUMBER;
  });

  async function gatewayIds(invoiceId: string): Promise<string[]> {
    await clearRateLimits();
    const res = await agent().get(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/gateways`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.map((g: { id: string }) => g.id);
  }

  async function wipayCheckout(invoiceId: string) {
    await clearRateLimits();
    return agent()
      .post(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(invoiceId))}/checkout`)
      .send({ gateway: 'wipay', returnUrl: RETURN_URL });
  }

  it("PC-17 (G6RC-1; amended by W10-WIPAY-KEY, D-105): with the platform's WiPay pair set, a business with its own key and no account of its own is not offered WiPay and gets no checkout into the platform's account; a business with neither no longer checks out into the platform's account (D-105), and a business with its own pair checks out into its own", async () => {
    process.env.WIPAY_API_KEY = PLATFORM_KEY;
    process.env.WIPAY_ACCOUNT_NUMBER = PLATFORM_ACCOUNT;

    // At 644bb6ad: ['wipay'], then a live checkout naming the platform account, whose callback (keyed with the
    // platform's key) bizKeyOnly's own key refuses: the payer is charged and nothing is recorded.
    expect(await gatewayIds(ID.invKeyOnly)).not.toContain('wipay');
    const res = await wipayCheckout(ID.invKeyOnly);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe('WiPay is not configured for this business: no WiPay account number');
    await expect(
      payments.createStorePayment({ orderId: `${P}store_key_only`, amount: 10, currency: 'TTD', method: 'WIPAY', businessId: ID.bizKeyOnly, returnUrl: RETURN_URL }),
    ).rejects.toThrow('WiPay is not configured for this business: no WiPay account number');
    expect(providerRequests, 'WiPay is never called for it').toEqual([]);

    // The callback WiPay would return for a checkout into the platform's account is refused and writes nothing.
    const txn = `${P}wtx_key_only_platform`;
    const cb = await wipay({ transaction_id: txn, order_id: ID.invKeyOnly, status: 'success', total: TOTAL.toFixed(2), hash: keyedHash(txn, TOTAL, PLATFORM_KEY) });
    expect(cb.status, JSON.stringify(cb.body)).toBe(400);
    expect(await rowsOf(ID.invKeyOnly)).toEqual([]);
    expect(await claims('wipay', txn)).toBe(0);
    expect(await invoiceStatus(ID.invKeyOnly)).toBe('SENT');

    // D-105: a business with no WiPay settings of its own used the platform's pair (G6RC-1's control until
    // W10-WIPAY-KEY). Tenants no longer share the platform's account: it is not offered WiPay and is refused.
    // At 1a9ca4fd: ['wipay'] and a 201 checkout naming the platform account.
    expect(await gatewayIds(ID.invNoKey)).not.toContain('wipay');
    const keyless = await wipayCheckout(ID.invNoKey);
    expect(keyless.status, JSON.stringify(keyless.body)).toBe(400);
    expect(keyless.body).toMatchObject({ code: WIPAY_KEY_REQUIRED, message: NO_KEY_MESSAGE });
    expect(providerRequests, 'WiPay is never called for it').toEqual([]);

    // Control: a business with its own pair checks out into its own account, never the platform's.
    expect(await gatewayIds(ID.invCheckout)).toContain('wipay');
    const own = await wipayCheckout(ID.invCheckout);
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(providerRequests).toHaveLength(1);
    const sent = new URLSearchParams(providerRequests[0].body);
    expect(`${sent.get('developer_id')}|${sent.get('account_number')}`).toBe(`${WIPAY_ACCOUNT}|${WIPAY_ACCOUNT}`);
    expect(providerRequests[0].body).not.toContain(PLATFORM_KEY);
    expect(providerRequests[0].body).not.toContain(WIPAY_KEY);
  });

  it("PC-18 (G6RC-7): the WiPay connector reports 'connected' exactly where the gateway list offers WiPay, for each business and platform setting", async () => {
    const { WiPayConnector } = await import('../src/core/connectors/implementations/wipay.connector');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const connector = new WiPayConnector(app.get(PrismaService), eventStub as any, {} as any);
    const invoiceOf: Record<string, string> = {
      [ID.bizKeyed]: ID.invCheckout,
      [ID.bizKeyOnly]: ID.invKeyOnly,
      [ID.bizOwnAccount]: ID.invOwnAccount,
      [ID.bizNoKey]: ID.invNoKey,
    };
    const platforms: Array<[string, string | undefined, string | undefined]> = [
      ['no platform pair', undefined, undefined],
      ['platform key only', PLATFORM_KEY, undefined],
      ['platform pair', PLATFORM_KEY, PLATFORM_ACCOUNT],
    ];
    const mismatches: string[] = [];
    for (const [label, key, account] of platforms) {
      if (key) process.env.WIPAY_API_KEY = key;
      else delete process.env.WIPAY_API_KEY;
      if (account) process.env.WIPAY_ACCOUNT_NUMBER = account;
      else delete process.env.WIPAY_ACCOUNT_NUMBER;
      for (const [biz, inv] of Object.entries(invoiceOf)) {
        const offered = (await gatewayIds(inv)).includes('wipay');
        const health = await connector.healthCheck(biz);
        if ((health.status === 'connected') !== offered) mismatches.push(`${label} / ${biz.slice(P.length)}: health ${health.status}, offered ${offered}`);
      }
    }
    // At 644bb6ad: bizKeyOnly 'connected' under every setting but the pair it can use, and bizOwnAccount and bizNoKey
    // 'connected' on the platform key alone, while WiPay is not offered to them (PC-13, PC-17).
    expect(mismatches).toEqual([]);
  });

  it('PC-19 (G6ML-2, D-69): WiPay is offered and checked out for TTD amounts only: a USD invoice of a WiPay business is not offered WiPay and its checkout is 400; a USD storefront checkout is 400; WiPay is never called', async () => {
    const invUsd = `${P}invKeyedUsd`;
    await seedInvoice(invUsd, ID.bizKeyed, ID.contactKeyed, TOTAL, 'USD');
    const usdOrder = `${P}storeUsd`;
    await db.marketplaceOrder.create({
      data: {
        id: usdOrder,
        businessId: ID.bizKeyed,
        orderNumber: `${P}SO-0003`,
        customerName: 'V05A Store Customer',
        customerEmail: `${P}store@test.local`,
        subtotal: STORE_TOTAL,
        total: STORE_TOTAL,
        currency: 'USD',
        type: 'STOREFRONT',
        paymentStatus: 'UNPAID',
        paymentMethod: 'WIPAY',
      },
    });
    const ttdOnly = /WiPay takes TTD only/;

    // At 644bb6ad: ['wipay'] for the USD invoice, and a WiPay checkout of 100.00 with no currency (WiPay's default).
    expect(await gatewayIds(invUsd), 'token gateway list').not.toContain('wipay');
    await clearRateLimits();
    const bare = await agent().get(`/payments/invoice/${encodeURIComponent(invUsd)}/gateways`);
    expect(bare.status, JSON.stringify(bare.body)).toBe(200);
    expect(bare.body.map((g: { id: string }) => g.id), 'bare-id gateway list').not.toContain('wipay');
    const res = await wipayCheckout(invUsd);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toMatch(ttdOnly);
    await expect(
      payments.createStorePayment({ orderId: usdOrder, amount: STORE_TOTAL, currency: 'USD', method: 'WIPAY', businessId: ID.bizKeyed, returnUrl: RETURN_URL }),
    ).rejects.toThrow(ttdOnly);
    await expect(
      payments.createGenericCheckout({ payableType: 'storefront_order', payableId: usdOrder, gateway: 'wipay', returnUrl: RETURN_URL }),
    ).rejects.toThrow(ttdOnly);
    expect(providerRequests, 'WiPay is never called').toEqual([]);
    expect(await rowsOf(invUsd)).toEqual([]);
    expect(await invoiceStatus(invUsd)).toBe('SENT');

    // Control: the same business's TTD invoice is offered WiPay, for TTD only.
    await clearRateLimits();
    const ttd = await agent().get(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(ID.invCheckout))}/gateways`);
    expect(ttd.body.find((g: { id: string }) => g.id === 'wipay')).toEqual({ id: 'wipay', name: 'WiPay', currencies: ['TTD'] });
  });
});

describe("W10-WIPAY-KEY: WiPay only with the business's own key (D-105)", () => {
  /** The provider requests the checkouts made (global fetch stubbed; no network). */
  let providerRequests: Array<{ url: string; body: string }> = [];
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    providerRequests = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      providerRequests.push({ url, body: String(init?.body ?? '') });
      if (new URL(url).host.endsWith('wipayfinancial.com')) return new Response('OK', { status: 200 });
      throw new Error(`v05a: unexpected network call to ${url}`);
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    delete process.env.WIPAY_API_KEY;
    delete process.env.WIPAY_ACCOUNT_NUMBER;
  });

  it('PC-20 (W10-WIPAY-KEY, D-105): with the platform WiPay pair set, a business with no WiPay key of its own is not offered WiPay (pay-link, bare-id and storefront gateway lists) and every WiPay checkout for it (pay link, generic invoice and storefront checkouts, createStorePayment) is refused 400 WIPAY_KEY_REQUIRED before WiPay is called; nothing is written', async () => {
    const inv = `${P}invNoKeyD105`;
    const order = `${P}storeNoKeyD105`;
    await seedInvoice(inv, ID.bizNoKey, ID.contactNoKey, TOTAL, 'TTD');
    await db.marketplaceOrder.create({
      data: {
        id: order,
        businessId: ID.bizNoKey,
        orderNumber: `${P}SO-0020`,
        customerName: 'V05A Store Customer',
        customerEmail: `${P}store@test.local`,
        subtotal: STORE_TOTAL,
        total: STORE_TOTAL,
        currency: 'TTD',
        type: 'STOREFRONT',
        paymentStatus: 'UNPAID',
        paymentMethod: 'WIPAY',
      },
    });
    const requested = () => db.webhookEvent.count({ where: { provider: 'wipay-requested', businessId: ID.bizNoKey } });
    const requestedBefore = await requested();
    process.env.WIPAY_API_KEY = PLATFORM_KEY;
    process.env.WIPAY_ACCOUNT_NUMBER = PLATFORM_ACCOUNT;

    // At 1a9ca4fd: ['wipay'] on every list (the business checked out into the platform's account).
    await clearRateLimits();
    const byToken = await agent().get(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(inv))}/gateways`);
    expect(byToken.status, JSON.stringify(byToken.body)).toBe(200);
    expect(byToken.body.map((g: { id: string }) => g.id), 'pay-link gateway list').not.toContain('wipay');
    const bare = await agent().get(`/payments/invoice/${encodeURIComponent(inv)}/gateways`);
    expect(bare.status, JSON.stringify(bare.body)).toBe(200);
    expect(bare.body.map((g: { id: string }) => g.id), 'bare-id gateway list').not.toContain('wipay');
    // The storefront's list (GET /site/storefront/public/:slug/gateways) is this method for the business.
    expect((await payments.getAvailableGateways(ID.bizNoKey, 'TTD')).map((g) => g.id), 'storefront gateway list').not.toContain('wipay');

    // At 1a9ca4fd: 201 redirects into the platform's account.
    const attempts: Array<[string, () => any]> = [
      ['pay-link checkout', () => agent().post(`/payments/public/invoice-link/${encodeURIComponent(tokenOf(inv))}/checkout`).send({ gateway: 'wipay', returnUrl: RETURN_URL })],
      ['generic invoice checkout', () => agent().post('/payments/create-checkout').send({ payableType: 'invoice', payableId: inv, gateway: 'wipay', returnUrl: RETURN_URL })],
      ['generic storefront checkout', () => agent().post('/payments/create-checkout').send({ payableType: 'storefront_order', payableId: order, gateway: 'wipay', returnUrl: RETURN_URL })],
    ];
    for (const [label, send] of attempts) {
      await clearRateLimits();
      const res = await send();
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body, label).toMatchObject({ code: WIPAY_KEY_REQUIRED, message: NO_KEY_MESSAGE });
    }
    const direct = await payments
      .createStorePayment({ orderId: order, amount: STORE_TOTAL, currency: 'TTD', method: 'WIPAY', businessId: ID.bizNoKey, returnUrl: RETURN_URL })
      .then(() => null, (e: any) => e);
    expect(direct?.getStatus?.(), 'createStorePayment refuses').toBe(400);
    expect(direct.getResponse()).toMatchObject({ code: WIPAY_KEY_REQUIRED, message: NO_KEY_MESSAGE });

    expect(providerRequests, 'WiPay is never called').toEqual([]);
    expect(await rowsOf(inv)).toEqual([]);
    expect(await invoiceStatus(inv)).toBe('SENT');
    expect(await requested(), 'no requested amount is kept').toBe(requestedBefore);
    expect((await db.marketplaceOrder.findUnique({ where: { id: order } })).paymentStatus).toBe('UNPAID');

    // Control: a business with its own key and account is still offered WiPay, for TTD.
    expect((await payments.getAvailableGateways(ID.bizKeyed, 'TTD')).map((g) => g.id)).toContain('wipay');
  });
});
