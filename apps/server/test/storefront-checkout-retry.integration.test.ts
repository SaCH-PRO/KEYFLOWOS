/**
 * V1-33-PUB-CHECKOUT-RETRY-OFFLINE (M37, SSP-BP-03, D-18) — storefront checkout
 * retry identity and CASH-order offline completion, on a REAL database through
 * the REAL SiteController routes and guards.
 *
 * At the V1-18 head two defects stood on the storefront order lifecycle:
 *
 *   RETRY   POST /site/storefront/public/:slug/checkout had no retry identity.
 *           Every call created a new order (ORD-<now>-<rand>), so a customer
 *           whose network dropped after the order was written and who pressed
 *           Pay again had two orders (and, for a provider method, two payment
 *           sessions).
 *   OFFLINE A CASH order is created paymentStatus PENDING and no route moves it
 *           on: updatePaymentStatus('PAID') (the one door into completeCheckout
 *           besides the provider callbacks) is reached only from provider
 *           webhooks, and V1-18 stopped CONFIRMED meaning "paid". A cash order
 *           could never reach PAID, so it never got an invoice, a payment or a
 *           posting (V18-T3).
 *
 * Contract pinned here:
 *
 *   V33-01  the same Idempotency-Key on the same slug returns the same order:
 *           one order, one store_order.created, and one idempotency_keys row
 *           (the existing table, no migration) naming that order
 *   V33-02  a provider-method checkout retried with its key starts ONE payment
 *           session and the retry is answered with that session
 *   V33-03  the same key under another slug creates a distinct order in that
 *           storefront's business (control: the key is scoped to its store)
 *   V33-04  no header behaves as today: two checkouts, two orders, no
 *           idempotency_keys row
 *   V33-05  the same key with a different cart is a conflict (409), not a
 *           silent replay of the first order, and writes nothing
 *   V33-06  two concurrent checkouts with the same key yield one order, and
 *           both are answered with it
 *   V33-12  a retry after the first call's payment step failed is answered
 *           with the same order and starts its payment session (once)
 *   V33-13  two concurrent provider-method checkouts with the same key: one
 *           order, one payment session, and both are answered with it (the
 *           loser of the race waits for the session; it is never handed an
 *           order with no session as if that were final)
 *   V33-14  a retry that arrives while the first call is still starting the
 *           payment session is answered with that session, once it exists
 *   V33-15  a retry whose first call's payment step outlasts the wait is
 *           answered 409 with Retry-After, writes nothing and starts no
 *           session; the next retry gets the first call's session
 *   V33-16  a slot left in flight by a request that died after the order
 *           committed (its lease expired) is taken over by the next retry,
 *           which starts the session once
 *   V33-17  a failure after the order commit (a throwing store_order.created
 *           listener) frees the payment step: the immediate retry starts it
 *   V33-18  two concurrent retries after a failed payment step start ONE
 *           session, and both are answered with it
 *   V33-07  an operator (revenue:write) completes a CASH order offline: PAID
 *           and CONFIRMED, one PAID invoice INV-<orderNumber>, one SUCCESSFUL
 *           cash payment of the order total recorded by that operator, exactly
 *           one Payment:<id>:payment_recorded posting with debits = credits on
 *           the CASH account, the tenant's trial balance balanced, and one
 *           store_order.paid carrying the invoiceId
 *   V33-08  completing it again (concurrently, then once more) writes nothing:
 *           still one invoice, one payment, one posting, one paid event
 *   V33-09  the route is authenticated and revenue:write: anonymous 401, a
 *           STAFF member with revenue:read 403, another business's member 403,
 *           and another business's order through one's own business 404; none
 *           of them writes a payment and the order stays PENDING
 *   V33-10  a provider-method (WIPAY) order is refused offline completion
 *           (400) and a CANCELLED cash order is refused (409); neither writes
 *           an invoice or a payment
 *   V33-11  a MANUAL order (the other no-provider method the checkout accepts)
 *           completes offline the same way: one payment, one posting
 *   V33-19  a cash-on-delivery order already SHIPPED or DELIVERED keeps its
 *           fulfilment status when its cash is recorded (PAID, not rewound to
 *           CONFIRMED)
 *   V33-20  a payment row anyone can plant in another tenant (the unsigned
 *           WiPay failure callback chooses its providerPaymentId) carrying
 *           storefront_offline_<orderId> does not block the offline
 *           completion: the reference is server-random
 *   V33-21  a platform SUPER_ADMIN who is not a member of the business is
 *           refused (D-46; trial-N review G6PUB-SEC-1)
 *   V33-22  the marketplace fulfil route's lowercase 'cancelled' / 'refunded'
 *           are closed too (409), V33-23 its lowercase 'shipped' /
 *           'delivered' are kept, V33-25 a checkout retry starts no session for
 *           an order it cancelled (G6PUB-SEC-2, V33-CR-3)
 *   V33-24  an order cancelled between the offline guard and the transaction
 *           is refused (409) and nothing is written (SEC-V33-5)
 *
 * Trial-N repair round 2, recheck (G6PUB-RC1-1, G6PUB-RC1-3):
 *
 *   V33-26  D-69: a WiPay checkout of a cart that is not in TTD is refused
 *           (400) before the order is written: no order, no store_order.created,
 *           no payment session, no idempotency_keys row, with or without an
 *           Idempotency-Key. createStorePayment refused it too, but only after
 *           the order had committed, so every such checkout left an UNPAID
 *           order (and a counted promo use) behind. Control: the same USD cart
 *           in CASH is still an order
 *   V33-27  POST .../orders/:orderId/refund moves money state, so it takes
 *           revenue write and a member (D-46): anonymous 401, a STAFF member
 *           with revenue:read 403, a platform SUPER_ADMIN who is not a member
 *           403, another business's owner 403. And an order nothing was paid
 *           on has nothing to refund: the owner is answered 409. None of them
 *           writes anything or emits store_order.refunded (whose listener
 *           booked an Expense for the order total)
 *
 * W10-STORE-PAYMENT-INTENT (D-18; money-state-writer-inventory's 'no-money'
 * todo for createStorePayment, owner V1-33-PUB-CHECKOUT-RETRY-OFFLINE):
 *
 *   V33-28  POST /payments/create-checkout (the anonymous generic checkout,
 *           the REAL PaymentsController and PaymentsService on a second app
 *           over the same database) with a cash or manual gateway for a CASH
 *           storefront order answers a clean 400, never 500, and writes no
 *           Payment row: createStorePayment wrote a PENDING intent naming the
 *           MarketplaceOrder id as its invoice_id (a foreign key to invoices),
 *           so the write failed (500), and nothing would have settled or
 *           retired such a row. The order stays PENDING, and the operator's
 *           offline completion then settles it once (one invoice, one cash
 *           payment, one posting, one store_order.paid), again a no-op
 *
 * Added with the fix (not in the tests-first commit): V33-12 and the
 * Idempotent-Replayed response-header assertions in V33-01 and V33-06.
 * Added with the review repairs: V33-13..V33-20 (V33-CR-1, SEC-V33-3,
 * V33-CR-2, V33-CR-3, SEC-V33-1) and the todo for SEC-V33-2.
 *
 * Nothing on the money path or the authorization boundary is mocked:
 * PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * PublicRateLimitGuard (real Redis, this suite's namespace), SiteService
 * (getPublicStorefront reads the slug), StoreOrderService, InvoiceWorkflowService,
 * RevenueAttributionService, RevenuePostingService, ExpensePostingService,
 * PostingService and ChartOfAccountsSeederService write real rows. The event bus
 * is the production EventEmitterModule. The only identity stand-in is a test
 * middleware that reads `x-test-user`, loads that seeded user and attaches
 * `{ id, email, role }` as AuthMiddleware does after token verification. The
 * stand-ins off the money path: CrmService (resolves the seeded contact by
 * email), PublicEventsService, PromoCodeService, InventoryRiskService, the
 * revenue-posting timeline, and PaymentsService, a recorder that answers
 * createStorePayment with a fake session (no provider traffic).
 *
 * Fixtures: prefix `v33a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v33a_';

// This suite's public rate-limit keys live under its own namespace, so the
// resets below never touch another suite's windows on the same Redis index.
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staffRead: `${P}staff_read`, // STAFF of bizA, revenue: read
  ownerB: `${P}owner_b`, // OWNER of bizB only
  superAdmin: `${P}super_admin`, // platform SUPER_ADMIN, member of no business (D-46)
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  bizUsd: `${P}biz_usd`, // a USD business (D-13: one currency per business), owned by owner
  contactA: `${P}contact_a`,
  contactB: `${P}contact_b`,
  prodA: `${P}prod_a`,
  prodB: `${P}prod_b`,
  prodUsd: `${P}prod_usd`,
};
const SLUG = { a: `${P}store-a`, b: `${P}store-b`, usd: `${P}store-usd` };
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const UNIT_PRICE = 40;
const QUANTITY = 2;
const ORDER_TOTAL = UNIT_PRICE * QUANTITY;

let db: any;
let app: any;
let redis: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

/** store_order.* events in emit order, with their payloads. */
let seen: Array<{ name: string; payload: any }> = [];
/** createStorePayment calls the checkout made (the provider stand-in). */
let paymentCalls: Array<{ orderId: string; method: string }> = [];
/** When set, the next createStorePayment call throws (a provider outage), once. */
let failNextPayment = false;
/** How long the provider stand-in takes to answer (a slow provider), in ms. */
let paymentDelayMs = 0;
/** The production event bus. */
let events: any;
/** When set, runs once while completeCheckout resolves the customer contact (between the offline guard and the transaction). */
let onContactResolve: (() => Promise<void>) | null = null;
/** How long a retry waits for an in-flight payment step before 409 (StoreOrderService). */
let inFlightWaitMs = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

type CheckoutBody = {
  items: Array<{ productId: string; quantity: number }>;
  customer: { name: string; email?: string };
  paymentMethod?: string;
  returnUrl?: string;
};

function cart(productId = ID.prodA, paymentMethod = 'CASH', quantity = QUANTITY): CheckoutBody {
  return {
    items: [{ productId, quantity }],
    customer: { name: 'Vee ThirtyThree', email: CUSTOMER_EMAIL },
    paymentMethod,
  };
}

/** The public checkout, with an Idempotency-Key header when `key` is given. */
function checkout(slug: string, body: CheckoutBody, key?: string) {
  const req = agent().post(`/site/storefront/public/${encodeURIComponent(slug)}/checkout`).send(body);
  return key === undefined ? req : req.set('Idempotency-Key', key);
}

/** The operator's refund of a storefront order. */
function refund(actor: string | null, orderId: string, businessId = ID.bizA) {
  const req = agent().post(`/site/businesses/${businessId}/orders/${orderId}/refund`).send({});
  return actor ? req.set('x-test-user', actor) : req;
}

/** The operator's offline completion of a storefront order. */
function completeOffline(actor: string | null, orderId: string, businessId = ID.bizA) {
  const req = agent().post(`/site/businesses/${businessId}/orders/${orderId}/complete-offline`).send({});
  return actor ? req.set('x-test-user', actor) : req;
}

async function orderCount(businessId = ID.bizA): Promise<number> {
  return db.marketplaceOrder.count({ where: { businessId } });
}

function created(): string[] {
  return seen.filter((e) => e.name === 'store_order.created').map((e) => e.payload?.order?.id);
}

/** The idempotency_keys rows of a business that name this order. */
async function retryRowsFor(businessId: string, orderId: string): Promise<any[]> {
  const rows = await db.idempotencyKey.findMany({ where: { businessId } });
  return rows.filter((r: any) => (r.response as { orderId?: string } | null)?.orderId === orderId);
}

async function invoicesOf(order: { orderNumber: string }, businessId = ID.bizA): Promise<any[]> {
  return db.invoice.findMany({
    where: { businessId, invoiceNumber: { contains: order.orderNumber } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function moneyCounts(businessId = ID.bizA) {
  const [invoices, payments, postings] = await Promise.all([
    db.invoice.count({ where: { businessId } }),
    db.payment.count({ where: { businessId } }),
    db.financialTransaction.count({ where: { businessId } }),
  ]);
  return { invoices, payments, postings };
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/**
 * The completed order's books: one PAID invoice INV-<orderNumber> for the
 * order total, one SUCCESSFUL payment of that total on it, exactly one
 * balanced Payment:<id>:payment_recorded posting and nothing else sourced by
 * the invoice or the payment; the deposit leg is CASH; ledger cash net =
 * balance net = total; the tenant's trial balance balances.
 */
async function expectOneOfflinePayment(order: { orderNumber: string }, method: string, actorId: string) {
  const invoices = await invoicesOf(order);
  expect(invoices.map((i) => `${i.invoiceNumber}:${i.status}`), 'invoices of the order').toEqual([`INV-${order.orderNumber}:PAID`]);
  const [invoice] = invoices;
  expect(Number(invoice.total)).toBe(ORDER_TOTAL);

  const payments = await db.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  expect(payments.map((p: any) => `${p.status}:${Number(p.amount)}:${p.method}`), 'payments of the order').toEqual([
    `SUCCESSFUL:${ORDER_TOTAL}:${method}`,
  ]);
  const [payment] = payments;
  expect(payment.businessId).toBe(ID.bizA);
  expect(payment.recordedBy, 'the operator who completed it').toBe(actorId);

  const postings = await db.financialTransaction.findMany({
    where: { businessId: ID.bizA, sourceId: { in: [invoice.id, payment.id] } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  expect(postings.map((t: any) => `${t.externalRef}:${t.status}`), 'postings of the order').toEqual([
    `Payment:${payment.id}:payment_recorded:POSTED`,
  ]);
  const [posting] = postings;
  expect(money(sum(posting.entries, 'debit')), 'debits = credits').toBe(money(sum(posting.entries, 'credit')));
  expect(money(sum(posting.entries, 'debit'))).toBe(ORDER_TOTAL);
  const cashNet = money(
    posting.entries
      .filter((e: any) => e.account?.systemKey === 'CASH')
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  expect(cashNet, 'the cash drawer received the order total').toBe(ORDER_TOTAL);
  const balance = storedBalanceFn(Number(invoice.total), payments.map((p: any) => ({ amount: Number(p.amount), status: p.status })), invoice.currency);
  expect(balance.net).toBe(ORDER_TOTAL);
  expect(balance.remaining).toBe(0);

  const totals = await db.ledgerEntry.aggregate({ where: { businessId: ID.bizA }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance').toBe(money(Number(totals._sum.credit ?? 0)));
  return { invoice, payment, posting };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger, BadRequestException } = await import('@nestjs/common');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService, CHECKOUT_IN_FLIGHT_WAIT_MS } = await import('../src/modules/site/store-order.service');
  inFlightWaitMs = CHECKOUT_IN_FLIGHT_WAIT_MS;
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { IntakeService } = await import('../src/modules/site/intake.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');
  const { CustomerReferralService } = await import('../src/modules/site/customer-referral.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const crmStub = {
    findOrCreateContact: async (businessId: string, input: { email?: string | null }) => {
      const hook = onContactResolve;
      onContactResolve = null;
      if (hook) await hook();
      return input?.email
        ? db.contact.findFirst({ where: { businessId, emailNormalized: input.email.toLowerCase() }, select: { id: true } })
        : null;
    },
    logContactEvent: async () => null,
  };
  let sessions = 0;
  const paymentsRecorder = {
    createStorePayment: async (input: { orderId: string; method: string; currency?: string }) => {
      paymentCalls.push({ orderId: input.orderId, method: input.method });
      // As PaymentsService.createStorePayment answers (D-69): WiPay takes TTD only.
      if (input.method === 'WIPAY' && (input.currency ?? '').toUpperCase() !== 'TTD') {
        throw new BadRequestException(`WiPay takes TTD only: this order is in ${input.currency}`);
      }
      if (paymentDelayMs) await sleep(paymentDelayMs);
      if (failNextPayment) {
        failNextPayment = false;
        throw new Error('provider unavailable');
      }
      sessions += 1;
      return { status: 'REDIRECT', redirectUrl: `https://pay.test.local/${P}session_${sessions}` };
    },
  };
  const stub = {};

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    controllers: [SiteController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      HoneypotGuard,
      { provide: REDIS_CLIENT, useValue: redis },
      SiteService,
      StoreOrderService,
      workflowMod.InvoiceWorkflowService,
      RevenueAttributionService,
      RevenuePostingService,
      ExpensePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: CrmService, useValue: crmStub },
      {
        provide: PublicEventsService,
        useValue: { logStorefrontEvent: async () => null, upsertStorefrontContact: async () => null, backstitchVisitor: async () => null },
      },
      { provide: PromoCodeService, useValue: stub },
      { provide: InventoryRiskService, useValue: { evaluateProduct: async () => null } },
      { provide: PaymentsService, useValue: paymentsRecorder },
      { provide: AiUsageService, useValue: stub },
      { provide: IntakeService, useValue: stub },
      { provide: QualificationService, useValue: stub },
      { provide: StorefrontConversionService, useValue: stub },
      { provide: CustomerReferralService, useValue: stub },
      { provide: CaseStudyService, useValue: stub },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v33a_ users. No guard is overridden.
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

  events = app.get(EventEmitter2);
  events.onAny((name: string | string[], payload: any) => {
    const n = Array.isArray(name) ? name.join('.') : String(name);
    if (n.startsWith('store_order.')) seen.push({ name: n, payload });
  });

  await cleanup(); // in case a prior run aborted
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffRead, email: `${P}staff_read@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.superAdmin, email: `${P}super_admin@test.local`, role: 'SUPER_ADMIN' } });
  // G6PUB-R3-STORE-ORDER-DOORS (RC2-4): the order door takes a WiPay checkout only for a business with a WiPay merchant
  // pair, so store A (whose WiPay checkouts this suite retries) has its own pair.
  await db.business.create({
    data: {
      id: ID.bizA,
      name: 'V33A Store A',
      slug: SLUG.a,
      ownerId: ID.owner,
      currency: 'TTD',
      accountingBasis: 'CASH',
      storeEnabled: true,
      metaData: { wipayApiKey: `${P}wipay_key`, wipayAccountNumber: `${P}wipay_account` },
    },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V33A Store B', slug: SLUG.b, ownerId: ID.ownerB, currency: 'TTD', accountingBasis: 'CASH', storeEnabled: true },
  });
  await db.membership.create({ data: { id: `${P}m_owner_a`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: { id: `${P}m_staff_a`, userId: ID.staffRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
  });
  await db.membership.create({ data: { id: `${P}m_owner_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.business.create({
    data: { id: ID.bizUsd, name: 'V33A Store USD', slug: SLUG.usd, ownerId: ID.owner, currency: 'USD', accountingBasis: 'CASH', storeEnabled: true },
  });
  await db.membership.create({ data: { id: `${P}m_owner_usd`, userId: ID.owner, businessId: ID.bizUsd, role: 'OWNER' } });
  await db.product.create({
    data: { id: ID.prodUsd, businessId: ID.bizUsd, name: 'V33A USD Widget', price: UNIT_PRICE, currency: 'USD', category: 'PRODUCT', isActive: true },
  });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizA);
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.bizB);
  for (const [id, businessId] of [[ID.contactA, ID.bizA], [ID.contactB, ID.bizB]] as const) {
    await db.contact.create({
      data: { id, businessId, firstName: 'Vee', lastName: 'ThirtyThree', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
    });
  }
  for (const [id, businessId] of [[ID.prodA, ID.bizA], [ID.prodB, ID.bizB]] as const) {
    await db.product.create({
      data: { id, businessId, name: 'V33A Widget', price: UNIT_PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true },
    });
  }
}, 60_000);

beforeEach(async () => {
  await clearRateLimits();
  seen = [];
  paymentCalls = [];
  failNextPayment = false;
  paymentDelayMs = 0;
  onContactResolve = null;
});

afterAll(async () => {
  try { await cleanup(); } catch { /* best-effort */ }
  try { if (redis) { await clearRateLimits(); await redis.quit(); } } catch { /* best-effort */ }
  try { await app?.close(); } catch { /* best-effort */ }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

describe('V1-33 storefront checkout retry identity (Idempotency-Key)', () => {
  it('V33-01 the same key on the same slug returns the same order: one order, one created event, one idempotency_keys row', async () => {
    const key = `${P}key_01`;
    const before = await orderCount();

    const first = await checkout(SLUG.a, cart(), key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await checkout(SLUG.a, cart(), key);
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    expect(second.body.order.id, 'the retry is answered with the first order').toBe(first.body.order.id);
    expect(second.body.order.orderNumber).toBe(first.body.order.orderNumber);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed'], 'the retry says it is a replay').toBe('true');
    expect(await orderCount(), 'one order for two submits').toBe(before + 1);
    expect(created(), 'store_order.created once').toEqual([first.body.order.id]);
    expect(await retryRowsFor(ID.bizA, first.body.order.id), 'the retry identity lives in idempotency_keys').toHaveLength(1);
  });

  it('V33-02 a provider-method checkout retried with its key starts one payment session and answers the retry with it', async () => {
    const key = `${P}key_02`;
    const before = await orderCount();

    const first = await checkout(SLUG.a, { ...cart(ID.prodA, 'WIPAY'), returnUrl: 'https://shop.test.local/return' }, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.payment?.redirectUrl).toBeTruthy();
    const second = await checkout(SLUG.a, { ...cart(ID.prodA, 'WIPAY'), returnUrl: 'https://shop.test.local/return' }, key);
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    expect(second.body.order.id).toBe(first.body.order.id);
    expect(second.body.payment, 'the retry is answered with the first payment session').toEqual(first.body.payment);
    expect(paymentCalls, 'one provider payment session').toEqual([{ orderId: first.body.order.id, method: 'WIPAY' }]);
    expect(await orderCount()).toBe(before + 1);
  });

  it('V33-03 the same key under another slug creates a distinct order in that storefront\'s business', async () => {
    const key = `${P}key_03`;
    const beforeA = await orderCount(ID.bizA);
    const beforeB = await orderCount(ID.bizB);

    const inA = await checkout(SLUG.a, cart(ID.prodA), key);
    expect(inA.status, JSON.stringify(inA.body)).toBe(201);
    const inB = await checkout(SLUG.b, cart(ID.prodB), key);
    expect(inB.status, JSON.stringify(inB.body)).toBe(201);

    expect(inB.body.order.id).not.toBe(inA.body.order.id);
    expect(inA.body.order.businessId).toBe(ID.bizA);
    expect(inB.body.order.businessId).toBe(ID.bizB);
    expect(await orderCount(ID.bizA)).toBe(beforeA + 1);
    expect(await orderCount(ID.bizB)).toBe(beforeB + 1);
  });

  it('V33-04 no Idempotency-Key behaves as today: two checkouts, two orders, no idempotency_keys row', async () => {
    const before = await orderCount();
    const keysBefore = await db.idempotencyKey.count({ where: { businessId: ID.bizA } });

    const first = await checkout(SLUG.a, cart());
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await checkout(SLUG.a, cart());
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    expect(second.body.order.id).not.toBe(first.body.order.id);
    expect(first.body.order.orderNumber).toMatch(/^ORD-\d+-[A-Z0-9]+$/);
    expect(await orderCount()).toBe(before + 2);
    expect(created()).toEqual([first.body.order.id, second.body.order.id]);
    expect(await db.idempotencyKey.count({ where: { businessId: ID.bizA } })).toBe(keysBefore);
  });

  it('V33-05 the same key with a different cart is a conflict (409) and writes no second order', async () => {
    const key = `${P}key_05`;
    const first = await checkout(SLUG.a, cart(), key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const before = await orderCount();
    seen = [];

    const other = await checkout(SLUG.a, cart(ID.prodA, 'CASH', QUANTITY + 1), key);

    expect(other.status, JSON.stringify(other.body)).toBe(409);
    expect(await orderCount(), 'no second order').toBe(before);
    expect(created()).toEqual([]);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: first.body.order.id } });
    expect(stored.total, 'the first order is untouched').toBe(ORDER_TOTAL);
  });

  it('V33-06 two concurrent checkouts with the same key yield one order, and both are answered with it', async () => {
    const key = `${P}key_06`;
    const before = await orderCount();

    const [a, b] = await Promise.all([checkout(SLUG.a, cart(), key), checkout(SLUG.a, cart(), key)]);

    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(await orderCount(), 'one order for two concurrent submits').toBe(before + 1);
    expect(created()).toEqual([a.body.order.id]);
    expect([a, b].filter((r) => r.headers['idempotent-replayed'] === 'true'), 'exactly one of them is the replay').toHaveLength(1);
  });

  it('V33-12 a retry after the payment step failed keeps the one order and starts its payment session then', async () => {
    const key = `${P}key_12`;
    const before = await orderCount();
    failNextPayment = true;

    const first = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(first.status, 'the provider outage reaches the customer').toBe(500);
    expect(await orderCount(), 'the order was written before the payment step').toBe(before + 1);
    const [orderId] = created();

    const retry = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.order.id, 'the retry is answered with the order the first call wrote').toBe(orderId);
    expect(retry.body.payment?.redirectUrl, 'and a payment session to pay it').toBeTruthy();
    const again = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(again.body.payment, 'a later retry gets the same session').toEqual(retry.body.payment);

    expect(paymentCalls.map((c) => c.orderId), 'the failed call, then one session').toEqual([orderId, orderId]);
    expect(await orderCount()).toBe(before + 1);
  });

  it('V33-13 two concurrent provider checkouts with the same key: one order, one session, and both are answered with it', async () => {
    const key = `${P}key_13`;
    const before = await orderCount();
    const body = { ...cart(ID.prodA, 'WIPAY'), returnUrl: 'https://shop.test.local/return' };
    paymentDelayMs = 300; // the session is still being started when the loser of the race reads the slot

    const [a, b] = await Promise.all([checkout(SLUG.a, body, key), checkout(SLUG.a, body, key)]);

    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(a.body.payment?.redirectUrl, 'a payment session').toBeTruthy();
    expect(b.body.payment, 'both are answered with the one session').toEqual(a.body.payment);
    expect(paymentCalls, 'one provider payment session').toEqual([{ orderId: a.body.order.id, method: 'WIPAY' }]);
    expect(await orderCount()).toBe(before + 1);
    expect([a, b].filter((r) => r.headers['idempotent-replayed'] === 'true'), 'exactly one of them is the replay').toHaveLength(1);
  });

  it('V33-14 a retry while the first call is still starting the payment session is answered with that session', async () => {
    const key = `${P}key_14`;
    const before = await orderCount();
    const body = { ...cart(ID.prodA, 'WIPAY'), returnUrl: 'https://shop.test.local/return' };
    paymentDelayMs = 800;

    const firstP = checkout(SLUG.a, body, key).then((r) => r);
    await sleep(300);
    const retry = await checkout(SLUG.a, body, key);
    const first = await firstP;

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(first.body.payment?.redirectUrl).toBeTruthy();
    expect(retry.body.payment, 'the retry is answered with the session, never with payment:null').toEqual(first.body.payment);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(paymentCalls).toHaveLength(1);
    expect(await orderCount()).toBe(before + 1);
  });

  it('V33-15 a retry whose first call outlasts the wait is answered 409 with Retry-After and starts nothing', async () => {
    const key = `${P}key_15`;
    const before = await orderCount();
    const body = { ...cart(ID.prodA, 'WIPAY'), returnUrl: 'https://shop.test.local/return' };
    paymentDelayMs = inFlightWaitMs + 1_000;

    const firstP = checkout(SLUG.a, body, key).then((r) => r);
    await sleep(300);
    const retry = await checkout(SLUG.a, body, key);

    expect(retry.status, JSON.stringify(retry.body)).toBe(409);
    expect(Number(retry.headers['retry-after']), 'the client is told when to retry').toBeGreaterThan(0);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(paymentCalls, 'the retry started no second session').toHaveLength(1);
    expect(await orderCount(), 'and wrote no second order').toBe(before + 1);

    const first = await firstP;
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    paymentDelayMs = 0;
    const later = await checkout(SLUG.a, body, key);
    expect(later.status, JSON.stringify(later.body)).toBe(201);
    expect(later.body.order.id).toBe(first.body.order.id);
    expect(later.body.payment, "the next retry gets the first call's session").toEqual(first.body.payment);
    expect(paymentCalls).toHaveLength(1);
  }, 20_000);

  it('V33-16 a slot left in flight by a request that died after the order commit is taken over once its lease expires', async () => {
    const key = `${P}key_16`;
    const before = await orderCount();
    failNextPayment = true;
    const first = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(first.status).toBe(500);
    const [orderId] = created();
    expect(orderId).toBeTruthy();
    // The state a process that died between the order commit and the payment
    // step leaves behind: the slot in flight under a claim nobody will settle,
    // its lease long expired.
    const rewritten = await db.$executeRawUnsafe(
      `UPDATE idempotency_keys
          SET status = 'pending',
              response = jsonb_build_object('orderId', $1::text, 'claim', 'v33a_dead_claim'),
              updated_at = now() - interval '1 hour'
        WHERE business_id = $2 AND response->>'orderId' = $1`,
      orderId,
      ID.bizA,
    );
    expect(rewritten).toBe(1);

    const retry = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.order.id).toBe(orderId);
    expect(retry.body.payment?.redirectUrl, 'the retry starts the session the dead request never did').toBeTruthy();
    const again = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(again.body.payment, 'once').toEqual(retry.body.payment);

    expect(paymentCalls.map((c) => c.orderId), 'the failed call, then one session').toEqual([orderId, orderId]);
    expect(await orderCount()).toBe(before + 1);
  });

  it('V33-17 a failure after the order commit (a throwing created listener) frees the payment step for the immediate retry', async () => {
    const key = `${P}key_17`;
    const before = await orderCount();
    let thrown = false;
    const boom = () => {
      if (!thrown) {
        thrown = true;
        throw new Error('store_order.created listener failed');
      }
    };
    events.on('store_order.created', boom);
    try {
      const first = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
      expect(first.status, 'the listener failure reaches the customer').toBe(500);
      expect(thrown).toBe(true);
      expect(await orderCount(), 'the order committed before the failure').toBe(before + 1);
      expect(paymentCalls, 'no session was started').toEqual([]);
      const [orderId] = created();

      const retry = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);

      expect(retry.status, JSON.stringify(retry.body)).toBe(201);
      expect(retry.body.order.id).toBe(orderId);
      expect(retry.body.payment?.redirectUrl, 'the immediate retry starts the session').toBeTruthy();
      expect(paymentCalls).toEqual([{ orderId, method: 'WIPAY' }]);
      expect(await orderCount()).toBe(before + 1);
    } finally {
      events.off('store_order.created', boom);
    }
  });

  it('V33-18 two concurrent retries after a failed payment step start one session, and both are answered with it', async () => {
    const key = `${P}key_18`;
    const before = await orderCount();
    failNextPayment = true;
    const first = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(first.status).toBe(500);
    const [orderId] = created();
    paymentDelayMs = 300;

    const [a, b] = await Promise.all([
      checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key),
      checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key),
    ]);

    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.body.order.id).toBe(orderId);
    expect(b.body.order.id).toBe(orderId);
    expect(a.body.payment?.redirectUrl).toBeTruthy();
    expect(b.body.payment, 'one session, answered to both').toEqual(a.body.payment);
    expect(paymentCalls.map((c) => c.orderId), 'the failed call, then ONE session').toEqual([orderId, orderId]);
    expect(await orderCount()).toBe(before + 1);
  });
});

describe('V1-33 CASH-order offline completion (operator, revenue:write)', () => {
  async function placeCashOrder(paymentMethod = 'CASH') {
    const res = await checkout(SLUG.a, cart(ID.prodA, paymentMethod));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.order as { id: string; orderNumber: string; paymentStatus: string; status: string };
  }

  it('V33-07 the operator completes a CASH order offline: PAID, one invoice, one cash payment, exactly one balanced posting', async () => {
    const order = await placeCashOrder();
    expect(order.paymentStatus, 'a CASH order waits for its cash').toBe('PENDING');
    seen = [];

    const res = await completeOffline(ID.owner, order.id);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toBe(order.id);
    expect(res.body.paymentStatus).toBe('PAID');
    expect(res.body.status).toBe('CONFIRMED');
    const { invoice, payment } = await expectOneOfflinePayment(order, 'cash', ID.owner);
    expect(payment.provider).toBe('cash');
    const paid = seen.filter((e) => e.name === 'store_order.paid');
    expect(paid.map((e) => e.payload?.invoiceId), 'one store_order.paid carrying the invoiceId').toEqual([invoice.id]);
  });

  it('V33-08 completing it again (twice concurrently, then once more) writes nothing', async () => {
    const order = await placeCashOrder();
    seen = [];

    const [a, b] = await Promise.all([completeOffline(ID.owner, order.id), completeOffline(ID.owner, order.id)]);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    await expectOneOfflinePayment(order, 'cash', ID.owner);
    const after = await moneyCounts();

    const again = await completeOffline(ID.owner, order.id);

    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.paymentStatus).toBe('PAID');
    await expectOneOfflinePayment(order, 'cash', ID.owner);
    expect(await moneyCounts(), 'no second invoice, payment or posting').toEqual(after);
    expect(seen.filter((e) => e.name === 'store_order.paid'), 'one paid event').toHaveLength(1);
  });

  it('V33-09 anonymous 401, revenue:read 403, another business\'s member 403, another business\'s order 404; nothing written', async () => {
    const order = await placeCashOrder();
    const before = await moneyCounts();
    const beforeB = await moneyCounts(ID.bizB);

    const anonymous = await completeOffline(null, order.id);
    const readOnly = await completeOffline(ID.staffRead, order.id);
    const outsider = await completeOffline(ID.ownerB, order.id);
    const foreignOrder = await completeOffline(ID.ownerB, order.id, ID.bizB);

    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401);
    expect(readOnly.status, JSON.stringify(readOnly.body)).toBe(403);
    expect(outsider.status, JSON.stringify(outsider.body)).toBe(403);
    expect(foreignOrder.status, JSON.stringify(foreignOrder.body)).toBe(404);
    expect(await moneyCounts()).toEqual(before);
    expect(await moneyCounts(ID.bizB)).toEqual(beforeB);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(stored.paymentStatus).toBe('PENDING');
  });

  it('V33-10 a provider-method order is refused (400) and a CANCELLED cash order is refused (409); no invoice, no payment', async () => {
    const providerOrder = await placeCashOrder('WIPAY');
    const cancelled = await placeCashOrder();
    await db.marketplaceOrder.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    const before = await moneyCounts();

    const provider = await completeOffline(ID.owner, providerOrder.id);
    const cancel = await completeOffline(ID.owner, cancelled.id);

    expect(provider.status, JSON.stringify(provider.body)).toBe(400);
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(409);
    expect(await moneyCounts()).toEqual(before);
    expect(await invoicesOf(providerOrder)).toEqual([]);
    expect(await invoicesOf(cancelled)).toEqual([]);
    const stored = await db.marketplaceOrder.findMany({ where: { id: { in: [providerOrder.id, cancelled.id] } }, select: { paymentStatus: true } });
    expect(stored.map((o: any) => o.paymentStatus).sort()).toEqual(['PENDING', 'UNPAID']);
  });

  it('V33-11 a MANUAL order completes offline the same way: one payment, one posting', async () => {
    const order = await placeCashOrder('MANUAL');

    const res = await completeOffline(ID.owner, order.id);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.paymentStatus).toBe('PAID');
    const { payment } = await expectOneOfflinePayment(order, 'manual', ID.owner);
    expect(payment.provider).toBe('manual');
  });

  it('V33-19 a cash-on-delivery order already SHIPPED or DELIVERED keeps its fulfilment status when its cash is recorded', async () => {
    for (const fulfilment of ['SHIPPED', 'DELIVERED']) {
      const order = await placeCashOrder();
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: fulfilment } });

      const res = await completeOffline(ID.owner, order.id);

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.paymentStatus).toBe('PAID');
      expect(res.body.status, `${fulfilment} is not rewound to CONFIRMED`).toBe(fulfilment);
      const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
      expect(`${stored.status}/${stored.paymentStatus}`).toBe(`${fulfilment}/PAID`);
      await expectOneOfflinePayment(order, 'cash', ID.owner);
    }
  });

  it('V33-20 a payment row planted in another tenant under storefront_offline_<orderId> does not block the offline completion', async () => {
    const order = await placeCashOrder();
    const predictable = `storefront_offline_${order.id}`;
    // What the public WiPay failure callback writes with no hash: a FAILED
    // payment whose providerPaymentId (unique across all tenants) the caller chose.
    const decoy = await db.invoice.create({
      data: {
        businessId: ID.bizB,
        contactId: ID.contactB,
        invoiceNumber: `${P}INV-DECOY-${Date.now()}`,
        status: 'SENT',
        subtotal: 1,
        taxAmount: 0,
        total: 1,
        currency: 'TTD',
        issueDate: new Date(),
      },
    });
    await db.payment.create({
      data: { provider: 'wipay', providerPaymentId: predictable, amount: 1, currency: 'TTD', status: 'FAILED', invoiceId: decoy.id, businessId: ID.bizB },
    });

    const res = await completeOffline(ID.owner, order.id);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.paymentStatus).toBe('PAID');
    const { payment } = await expectOneOfflinePayment(order, 'cash', ID.owner);
    expect(payment.providerPaymentId, 'the reference is not the predictable one').not.toBe(predictable);
    expect(payment.providerPaymentId).toMatch(new RegExp(`^storefront_offline_${order.id}_[0-9a-f]{32}$`));
  });

  it('V33-21 (G6PUB-SEC-1, D-46) a platform SUPER_ADMIN who is not a member of the business is refused (403); nothing written', async () => {
    const order = await placeCashOrder();
    const before = await moneyCounts();

    const res = await completeOffline(ID.superAdmin, order.id);

    // At 2db133a4: 201 PAID, with an invoice, a SUCCESSFUL payment recorded by the super admin and a posting.
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await moneyCounts(), 'no invoice, payment or posting').toEqual(before);
    expect(await invoicesOf(order)).toEqual([]);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`).toBe('PENDING/PENDING');
  });

  it("V33-22 (G6PUB-SEC-2) an order the marketplace fulfil route cancelled or refunded (its lowercase 'cancelled' / 'refunded') is refused (409); nothing written, the status kept", async () => {
    for (const closed of ['cancelled', 'refunded', 'Cancelled']) {
      const order = await placeCashOrder();
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: closed } });
      const before = await moneyCounts();

      const res = await completeOffline(ID.owner, order.id);

      // At 2db133a4: 201, the order revived to CONFIRMED/PAID with an invoice, a payment and a posting.
      expect(res.status, `${closed}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(await moneyCounts(), closed).toEqual(before);
      expect(await invoicesOf(order), closed).toEqual([]);
      const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
      expect(`${stored.status}/${stored.paymentStatus}`, closed).toBe(`${closed}/PENDING`);
    }
  });

  it("V33-23 (G6PUB-SEC-2, V33-CR-3) a cash-on-delivery order the marketplace route shipped or delivered (lowercase 'shipped' / 'delivered') keeps that status when its cash is recorded", async () => {
    for (const fulfilment of ['shipped', 'delivered']) {
      const order = await placeCashOrder();
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: fulfilment } });

      const res = await completeOffline(ID.owner, order.id);

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // At 2db133a4: rewound to CONFIRMED.
      expect(res.body.status, `${fulfilment} is not rewound to CONFIRMED`).toBe(fulfilment);
      const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
      expect(`${stored.status}/${stored.paymentStatus}`).toBe(`${fulfilment}/PAID`);
      await expectOneOfflinePayment(order, 'cash', ID.owner);
    }
  });

  it('V33-24 (SEC-V33-5) an order cancelled after the offline guard read it and before the transaction is refused (409): nothing written, it stays cancelled', async () => {
    const order = await placeCashOrder();
    const before = await moneyCounts();
    // A member cancels the order while the completion is resolving the customer contact (between the guard and the transaction).
    onContactResolve = async () => {
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    };

    const res = await completeOffline(ID.owner, order.id);

    expect(onContactResolve, 'the concurrent cancel ran').toBeNull();
    // At 2db133a4: 201, the cancelled order revived to CONFIRMED/PAID with its cash booked.
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await moneyCounts(), 'no invoice, payment or posting').toEqual(before);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`).toBe('CANCELLED/PENDING');
  });

  it("V33-25 (G6PUB-SEC-2) a retry of a provider checkout whose order the marketplace route has since cancelled ('cancelled') starts no payment session", async () => {
    const key = `${P}key_25`;
    failNextPayment = true;
    const first = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);
    expect(first.status, 'the provider outage reaches the customer').toBe(500);
    const [orderId] = created();
    await db.marketplaceOrder.update({ where: { id: orderId }, data: { status: 'cancelled' } });

    const retry = await checkout(SLUG.a, cart(ID.prodA, 'WIPAY'), key);

    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.order.id).toBe(orderId);
    expect(retry.body.payment, 'no payment session for a cancelled order').toBeNull();
    // At 2db133a4: the retry starts a session for the cancelled order (two calls).
    expect(paymentCalls.map((c) => c.orderId), 'only the failed first call').toEqual([orderId]);
  });

  it.todo(
    "SEC-V33-2 (routed to its own security packet, outside V1-33's write set): the WiPay success hash " +
      '(payments.service.ts handleWipayCallback) is md5(transaction_id+order_id+total+status) with no secret, so a forged ' +
      'success callback settles a storefront order through updatePaymentStatus(PAID). Not guarded in StoreOrderService: a ' +
      'CASH order may legitimately be paid online later (payments.service.ts storefront_order checkout), and its genuine ' +
      'provider callback reaches the same door; the fix is a keyed signature check in payments.service.ts',
  );
});

describe('Trial-N repair round 2 recheck: D-69 before the order, and the refund route (G6PUB-RC1-1, G6PUB-RC1-3)', () => {
  it('V33-26 (G6PUB-RC1-1, D-69) a WiPay checkout of a USD cart is refused (400) before the order is written; CASH still checks out', async () => {
    const before = await orderCount(ID.bizUsd);
    const keyRowsBefore = await db.idempotencyKey.count({ where: { businessId: ID.bizUsd } });

    for (const key of [undefined, `${P}key_26`]) {
      const res = await checkout(SLUG.usd, cart(ID.prodUsd, 'WIPAY'), key);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/WiPay takes TTD only/);
    }

    // At c549a12f: the order commits, then the payment step refuses it, so each attempt leaves an UNPAID order.
    expect(await orderCount(ID.bizUsd), 'no order is written').toBe(before);
    expect(created(), 'no store_order.created').toEqual([]);
    expect(paymentCalls, 'no payment session is started').toEqual([]);
    expect(await db.idempotencyKey.count({ where: { businessId: ID.bizUsd } }), 'no retry slot').toBe(keyRowsBefore);

    // Control: the same USD cart paid in cash is an order (only WiPay is TTD-only).
    const cash = await checkout(SLUG.usd, cart(ID.prodUsd, 'CASH'));
    expect(cash.status, JSON.stringify(cash.body)).toBe(201);
    expect(cash.body.order.currency).toBe('USD');
    expect(await orderCount(ID.bizUsd)).toBe(before + 1);
  });

  it('V33-27 (G6PUB-RC1-3, D-46) the refund route takes revenue write and a member, and an order nothing was paid on is not refunded (409); nothing written', async () => {
    const placed = await checkout(SLUG.a, cart());
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const orderId = placed.body.order.id;
    const before = await moneyCounts();
    seen = [];

    const attempts: Array<[string, string | null, string, number]> = [
      ['anonymous', null, ID.bizA, 401],
      ['STAFF with revenue:read', ID.staffRead, ID.bizA, 403],
      ['a SUPER_ADMIN who is not a member (D-46)', ID.superAdmin, ID.bizA, 403],
      ["another business's owner", ID.ownerB, ID.bizA, 403],
      ['the owner, on an order nothing was paid on', ID.owner, ID.bizA, 409],
    ];
    for (const [label, actor, businessId, status] of attempts) {
      const res = await refund(actor, orderId, businessId);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(status);
      const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
      expect(`${stored.status}/${stored.paymentStatus}`, `${label}: the order is untouched`).toBe('PENDING/PENDING');
    }

    expect(await moneyCounts(), 'no invoice, payment or posting').toEqual(before);
    expect(seen.filter((e) => e.name === 'store_order.refunded'), 'no store_order.refunded').toEqual([]);
  });
});

/**
 * W10-STORE-PAYMENT-INTENT (D-18): the generic checkout, the one route that
 * reaches createStorePayment's CASH / MANUAL branch (the storefront checkout
 * starts no session for those methods). A second app over the same database
 * serves the REAL PaymentsController and PaymentsService; the suite app's own
 * PrismaService, InvoiceWorkflowService and RevenuePostingService back it, and
 * no provider connector is provided, so nothing reaches a provider. Same filter
 * and pipe as app-bootstrap.ts, so the status codes are the production ones.
 */
describe('W10-STORE-PAYMENT-INTENT: the generic checkout with a cash or manual gateway for a storefront order (D-18)', () => {
  let paymentsApp: any;

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
    const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
    const { PaymentsController } = await import('../src/modules/payments/payments.controller');
    const { PaymentsService } = await import('../src/modules/payments/payments.service');
    const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
    const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');

    // CommerceService is not on the storefront-order path of the generic checkout.
    const payments = new PaymentsService(
      app.get(PrismaService),
      {} as any,
      app.get(InvoiceWorkflowService),
      app.get(RevenuePostingService),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [PublicRateLimitGuard, { provide: REDIS_CLIENT, useValue: redis }, { provide: PaymentsService, useValue: payments }],
    }).compile();
    paymentsApp = moduleRef.createNestApplication();
    paymentsApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    paymentsApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await paymentsApp.init();
  }, 60_000);

  afterAll(async () => {
    try { await paymentsApp?.close(); } catch { /* best-effort */ }
  });

  function genericCheckout(payableId: string, gateway: string) {
    return request(paymentsApp.getHttpServer())
      .post('/payments/create-checkout')
      .send({ payableType: 'storefront_order', payableId, gateway });
  }

  it('V33-28 (W10-STORE-PAYMENT-INTENT, D-18) a cash or manual gateway answers a clean 400 (never 500) and writes no PENDING payment row; the offline completion still settles the order once', async () => {
    const placed = await checkout(SLUG.a, cart());
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const order = placed.body.order as { id: string; orderNumber: string };
    const before = await moneyCounts();
    seen = [];

    for (const gateway of ['cash', 'manual']) {
      const res = await genericCheckout(order.id, gateway);
      // At 134eeeb4: createStorePayment writes a PENDING intent with invoice_id = the order id, the foreign key to
      // invoices refuses it (P2003) and the checkout answers 500.
      expect(res.status, `${gateway}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(JSON.stringify(res.body), `${gateway}: says why`).toMatch(/paid offline/);
    }

    expect(await moneyCounts(), 'no invoice, payment or posting').toEqual(before);
    expect(
      await db.payment.count({ where: { OR: [{ invoiceId: order.id }, { providerPaymentId: { startsWith: `manual_${order.id}` } }] } }),
      'no PENDING intent naming the order',
    ).toBe(0);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}/${stored.paymentMethod}`, 'the order is untouched').toBe('PENDING/PENDING/CASH');

    // The offline completion settles it once; a second completion writes nothing.
    const done = await completeOffline(ID.owner, order.id);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.paymentStatus).toBe('PAID');
    const again = await completeOffline(ID.owner, order.id);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const { invoice } = await expectOneOfflinePayment(order, 'cash', ID.owner);
    const paid = seen.filter((e) => e.name === 'store_order.paid');
    expect(paid.map((e) => e.payload?.invoiceId), 'one store_order.paid carrying the invoiceId').toEqual([invoice.id]);

    // A paid order has nothing left to check out: still a clean 400, nothing written.
    const afterPaid = await moneyCounts();
    const late = await genericCheckout(order.id, 'cash');
    expect(late.status, JSON.stringify(late.body)).toBe(400);
    expect(await moneyCounts()).toEqual(afterPaid);
  });
});
