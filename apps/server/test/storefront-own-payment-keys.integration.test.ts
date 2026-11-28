/**
 * W11-STORE-OWN-PAYMENT-KEYS (V1-61; owner ruling D-138, 2026-11-12: D-105
 * extended to PayPal and Stripe) — a storefront offers PayPal or Stripe only
 * when the business has saved its own complete credential set in its settings
 * (PayPal: a client id and a secret; Stripe: a publishable key, a secret key
 * and a webhook secret). The platform env credentials (PAYPAL_CLIENT_ID /
 * PAYPAL_CLIENT_SECRET, STRIPE_*) never stand in for a store, and a store's
 * key is never mixed with a platform key. On a REAL database, through the REAL
 * SiteController and PaymentsController routes and guards.
 *
 * The defect (review SEC-W11SCM-1, open until D-138): each storefront
 * credential was read from the business settings or else the platform env, one
 * by one (paypalConfigured / stripeConfigured, getAvailableGateways,
 * createStorePayment, the PayPal webhook's signature check). So the platform's
 * PayPal / Stripe, alone or beside one of the store's own keys, was offered on
 * the storefront, took its checkouts and settled its orders.
 *
 *   OPK-01  platform env PayPal, no PayPal of the store's own: the storefront
 *           gateway list (GET /site/storefront/public/:slug/gateways) leaves
 *           PayPal out; the public checkout (with and without a retry key) and
 *           the generic storefront checkout (POST /payments/create-checkout)
 *           answer 400 PAYMENT_METHOD_NOT_OFFERED with no order, retry slot,
 *           invoice or payment written and no PayPal client built
 *   OPK-02  the same for Stripe (platform STRIPE_* env): no Stripe request
 *   OPK-03  no mixing: a store's PayPal client id beside the platform's
 *           secret (and its secret beside the platform's id), its Stripe
 *           publishable key beside the platform's secret and webhook secret,
 *           its Stripe keys beside the platform's webhook secret: none is
 *           offered, each checkout is 400 PAYMENT_METHOD_NOT_OFFERED and
 *           nothing is written or sent
 *   OPK-04  controls: a store's own complete PayPal pair / Stripe triple, with
 *           a different platform set in the env, is offered; the public and the
 *           generic checkout build the PayPal client from the store's pair and
 *           make the Stripe session with the store's secret key, never the
 *           platform's
 *   OPK-05  control (the invoice pay link is not changed by this packet): with
 *           the platform's PayPal and Stripe env and no keys of the business's
 *           own, the pay-link gateway list (token route) and the bare-id list
 *           still offer both (as built, a deviation recorded for an owner
 *           ruling), and an invoice's PayPal capture webhook is still verified
 *           with the platform's PayPal app and recorded
 *   OPK-06  the storefront PayPal capture (PayPal's capture webhook naming a
 *           storefront order; there is no storefront capture route): its
 *           signature check is made only with the store's own complete set and
 *           its own webhook id. (a) a store with no PayPal of its own: 400,
 *           nothing verified with the platform's app, nothing recorded, the
 *           order UNPAID; (b) a store with its own pair and webhook id: the
 *           check is made with them (token and verify requests), the order is
 *           settled once through the paid door; (c) a store with its own pair
 *           and no webhook id of its own: 400, the platform's webhook id is not
 *           mixed in, nothing recorded
 *   OPK-07  a capture settles a storefront order only when the webhook was
 *           verified with that order's own store's app: (a) a PayPal order
 *           event verified with store A's own app whose second purchase unit
 *           names store B's order settles A's order only, B's stays UNPAID;
 *           (b) an order event whose first purchase unit names nothing KeyFlow
 *           knows (verified with the platform's app, as before) settles none
 *           of the storefront orders its other units name
 *
 * Review repairs (W11-STORE-OWN-PAYMENT-KEYS review, at fc23ff18):
 *   OPK-08  (SEC-W11OPK-1) a PayPal capture settles an INVOICE only when the
 *           webhook was verified with the PayPal app that invoice's business
 *           takes PayPal with (its own when it holds any PayPal setting of its
 *           own, else the platform's): (a) the review's repro: an order event
 *           verified with store A's own app (unit 1 = A's storefront order)
 *           whose second unit names business B's SENT invoice settles A's
 *           order only, B's invoice stays SENT with no payment; (b) PROBE-P2:
 *           unit 1 = A's own invoice (verified with A's own PayPal settings),
 *           unit 2 = B's invoice: A's invoice is PAID, B's stays SENT; (c) an
 *           order event verified with the platform's app (unit 1 names
 *           nothing KeyFlow knows) records nothing for an invoice of a
 *           business that holds its own PayPal; an invoice of a business with
 *           no PayPal of its own is still settled by the platform's app (the
 *           invoice pay link's PayPal, as built: OPK-05's deviation)
 *   OPK-09  (SEC-W11OPK-2, OPK-COR-1) the storefront Stripe checkout D-138
 *           starts on the store's own account settles with that account's
 *           own event: checkout.session.completed signed with the store's own
 *           webhook secret (with a different platform STRIPE_* env, and with
 *           none) settles the order once through the paid door; a redelivery
 *           writes nothing; an event naming one store's order signed with
 *           another store's own secret is refused 400 and settles nothing
 *   OPK-10  (SEC-W11OPK-3, closed in full by W1F-STORE-STRIPE-R0 under owner
 *           ruling D-196 `storestripe`) the platform's STRIPE_WEBHOOK_SECRET
 *           never settles a store order — neither a store holding its own
 *           complete Stripe set nor a store with no Stripe of its own: 400,
 *           the order UNPAID, nothing recorded, one refusal row (a retry adds
 *           none); a store order settles only with its own store's Stripe
 *           webhook secret (OPK-09)
 *
 * PR210-PAYPAL-STORE-REFUND (Codex review P1 on PR #210; D-138): PayPal's
 * PAYMENT.CAPTURE.REFUNDED / .REVERSED resource names the capture it returns
 * only through supplementary_data.related_ids.capture_id or its 'up' link (no
 * custom_id, no invoice_id), so a store's own refund was checked with the
 * platform's app and webhook id: the genuine refund was refused 400 (PayPal
 * kept redelivering) and the reversal never recorded. The tap's verify answers
 * SUCCESS here only for the app that signed the delivery (paypalSigner).
 *   RF-01  a store's own refund (related_ids) and reversal ('up' link) are
 *          verified with its own app and webhook id and recorded once on the
 *          order's checkout invoice (refund row, the settlement's posting
 *          reversed, the invoice reopened); a redelivery and a resend under a
 *          new event id record nothing new
 *   RF-02  a platform-signed refund / reversal of a store's capture is checked
 *          with the store's own app only and refused 400, nothing recorded, no
 *          claim kept; the processor behind the route records nothing for a
 *          store's capture with the platform's verifier
 *   RF-03  a store missing a value of its own (webhook id; secret) is refused
 *          400 before any request, nothing recorded
 *   RF-04  a refund is verified by the store whose capture it returns: (a) A's
 *          app with A's order in custom_id and B's capture is checked with B's
 *          app and refused; (b) A's app with an invoice capture records nothing
 *          on the invoice
 *   RF-05  control: an invoice's refund naming only its capture keeps its path
 *          (the platform's app for a business with no PayPal of its own)
 *
 * PR210 review repairs (at 813031ae; D-121, D-138):
 *   RF-01  (COR-PR210-1, SEC-PR210-4) the full refund / reversal also refunds
 *          the order: REFUNDED once, metadata.refundedTotal and a 'refunded'
 *          step naming PayPal's refund, one store_order.refunded naming the
 *          invoice (no Expense beside it); a redelivery or resend adds none
 *   RF-06  (COR-PR210-1) an order settled by CHECKOUT.ORDER.COMPLETED and
 *          refunded by two PayPal partial refunds (30 + 50) shows each: after
 *          the 30 it is PAID with refundedTotal 30 and a 'partially_refunded'
 *          step (no store_order.refunded); after the 50 it is REFUNDED once,
 *          the store's revenue (orders summary) no longer counts it
 *   RF-07  (COR-PR210-2 a) a partial refund the owner recorded by hand (the
 *          D-121 fulfil door), then PayPal's notice of it: not recorded again
 *          (one -30, one posting), a resend neither; a second PayPal refund of
 *          the same amount the owner made in PayPal alone is recorded
 *   RF-08  (COR-PR210-2 b) PayPal's partial refund first, then the owner's hand
 *          refund of the same amount: 409, nothing written (also when it is
 *          what is left); the owner's full refund takes the rest, and PayPal's
 *          notice of that rest is not recorded again
 *   RF-09  (COR-PR210-2) a hand refund and PayPal's notice of it racing: one
 *          refund recorded, whichever wins
 *   RF-10  (SEC-PR210-1) a failed read of the refunded capture's payment fails
 *          the delivery (500, claim released); PayPal's redelivery records it
 *   RF-11  (SEC-PR210-3, COR-PR210-4) a store-signed refund that arrives before
 *          its capture is recorded fails the delivery (409, claim released);
 *          its redelivery after the capture records it
 *   RF-12  (SEC-PR210-2, COR-PR210-3) a store order whose PayPal capture the
 *          platform's app settled before D-138 (its store holds no PayPal
 *          setting of its own): the platform-signed refund is verified with the
 *          platform's app and recorded, as at the base
 *
 * Nothing on the money path or the authorization boundary is mocked:
 * PrismaService, PublicRateLimitGuard (real Redis, this suite's namespace),
 * SiteService, StoreOrderService (the paid door), PaymentsService,
 * CommerceService, InvoiceWorkflowService, RevenueAttributionService,
 * RevenuePostingService, ExpensePostingService, PostingService,
 * ChartOfAccountsSeederService, the listener CommerceIntegrationService and
 * CrmService read and write real rows. Stand-ins off the money path: the CRM
 * timeline, stats, lists, flow and custom-field caches, SubscriptionsService,
 * PublicEventsService, PromoCodeService, InventoryRiskService,
 * TransactionalEmailService, ExpensesService (a recorder: store_order.refunded
 * books one when it names no invoice) and the timeline. The PR210 review cases
 * also drive the owner's fulfil route (the REAL MarketplaceController, D-121's
 * refund door); the only identity stand-in is a middleware that attaches the
 * seeded user named by `x-test-user`, as AuthMiddleware does after token
 * verification (no guard is overridden). No provider is
 * called: the PayPal SDK client is stubbed at getPaypalClient (it records the
 * credentials it is built from), and global fetch is a tap that records every
 * request and answers only Stripe's Checkout Session API and PayPal's sandbox
 * token and verify-webhook-signature APIs (anything else throws).
 *
 * Fixtures: prefix `v61b_` (registered in test/helpers/fixture-prefixes.json);
 * provider credentials are obviously fake values built at runtime; rows are
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v61b_';

const RATE_LIMIT_NS = `${P}${Date.now()}`;

/** Every env key a storefront or pay-link credential reading looks at, cleared before each case and restored after. */
const PROVIDER_ENV = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_ENVIRONMENT',
  'STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];
const PREVIOUS_ENV: Record<string, string | undefined> = Object.fromEntries(
  ['RATE_LIMIT_KEY_NAMESPACE', 'WIPAY_API_KEY', 'WIPAY_ACCOUNT_NUMBER', 'PUBLIC_URL_ALLOWLIST', ...PROVIDER_ENV].map((k) => [k, process.env[k]]),
);

const ID = {
  owner: `${P}owner`,
  bizPlatform: `${P}biz_platform`, // USD, no provider credential of its own
  bizMixed: `${P}biz_mixed`, // USD, settings set per case
  bizOwn: `${P}biz_own`, // USD, its own complete PayPal pair (and webhook id) and Stripe triple
  prodPlatform: `${P}prod_platform`,
  prodMixed: `${P}prod_mixed`,
  prodOwn: `${P}prod_own`,
  invLink: `${P}inv_link`,
  invCapture: `${P}inv_capture`,
  contactPlatform: `${P}contact_platform`,
  // OPK-08 (SEC-W11OPK-1): SENT USD invoices a PayPal order's later purchase unit names.
  contactMixed: `${P}contact_mixed`,
  contactOwn: `${P}contact_own`,
  invVictim: `${P}inv_victim`, // bizMixed (no PayPal of its own)
  invOwn: `${P}inv_own`, // bizOwn (its own PayPal)
  invOwnLater: `${P}inv_own_later`, // bizOwn
  invPlatformLater: `${P}inv_platform_later`, // bizPlatform (no PayPal of its own)
};
const SLUG = { platform: `${P}store-platform`, mixed: `${P}store-mixed`, own: `${P}store-own` };
const PAY_TOKEN = `${P}pay_link_token`;
const PUBLIC_ORIGIN = 'https://shop.v61b.test';
const RETURN_URL = `${PUBLIC_ORIGIN}/book/return`;
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const UNIT_PRICE = 40;
const QUANTITY = 2;
const ORDER_TOTAL = UNIT_PRICE * QUANTITY;

/** An obviously fake credential value, built at runtime (no provider key shape). */
const fake = (...parts: string[]) => `${P}${parts.join('_')}_fake`;

/** The platform's PayPal app and Stripe account (the deployment env), never a store's under D-138. */
const PLATFORM_PAYPAL = { PAYPAL_CLIENT_ID: fake('platform', 'paypal', 'client'), PAYPAL_CLIENT_SECRET: fake('platform', 'paypal', 'secret') };
const PLATFORM_PAYPAL_WEBHOOK = { PAYPAL_WEBHOOK_ID: fake('platform', 'paypal', 'webhook') };
const PLATFORM_STRIPE = {
  STRIPE_PUBLISHABLE_KEY: fake('platform', 'stripe', 'publishable'),
  STRIPE_SECRET_KEY: fake('platform', 'stripe', 'secret'),
  STRIPE_WEBHOOK_SECRET: fake('platform', 'stripe', 'webhook'),
};
/** A store's own sets, as Settings > Payments saves them in its business settings. */
const OWN_PAYPAL = { paypalClientId: fake('own', 'paypal', 'client'), paypalClientSecret: fake('own', 'paypal', 'secret') };
const OWN_PAYPAL_WEBHOOK = { paypalWebhookId: fake('own', 'paypal', 'webhook') };
const OWN_STRIPE = {
  stripePublishableKey: fake('own', 'stripe', 'publishable'),
  stripeSecretKey: fake('own', 'stripe', 'secret'),
  stripeWebhookSecret: fake('own', 'stripe', 'webhook'),
};
/** Another store's own complete Stripe set (OPK-09: its webhook secret signs only its own orders' events). */
const MIXED_STRIPE = {
  stripePublishableKey: fake('mixed', 'stripe', 'publishable'),
  stripeSecretKey: fake('mixed', 'stripe', 'secret'),
  stripeWebhookSecret: fake('mixed', 'stripe', 'webhook'),
};

const STRIPE_REDIRECT = 'https://checkout.stripe.com/c/pay/v61b-session';
const PAYPAL_SANDBOX = 'api-m.sandbox.paypal.com';

let db: any;
let app: any;
let redis: any;
let payments: any;
/** PR210 review (RF-12): the paid door, as the pre-D-138 PayPal webhook settled a store order with it. */
let storeOrders: any;
/** PR210 review (RF-10): the PrismaService the services share (a read is made to fail once through it). */
let prismaService: any;

/** store_order.* events in emit order. */
let seen: string[] = [];
/** PR210 review: the Expenses store_order.refunded booked (ExpensesService.createExpense recorder), by business. */
let expenses: Array<{ businessId: string; amount: number }> = [];
/** Listener work started by an emit, awaited by settle(). */
const inflight: Promise<unknown>[] = [];

/** Every outbound request the server made in the current case (global fetch tap). */
let requests: Array<{ host: string; path: string; authorization: string | null; body: string }> = [];
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
/** The credentials each PayPal SDK client was built from (getPaypalClient stubbed), and the orders it was asked for. */
let paypalBuilt: unknown[][] = [];
let paypalOrdered: any[] = [];
let paypalSpy: ReturnType<typeof vi.spyOn> | undefined;
let stripeSessions = 0;
/**
 * PR210-PAYPAL-STORE-REFUND: the PayPal app that signed this case's deliveries. Null: PayPal's verify-webhook-signature
 * answers SUCCESS for any app, as before. Set: SUCCESS only when the check is made with that app's own token and its own
 * webhook id (PayPal verifies a delivery against the webhook it was sent for), FAILURE otherwise.
 */
type PaypalApp = { clientId: string; clientSecret: string; webhookId: string };
let paypalSigner: PaypalApp | null = null;
/** The app (its Basic authorization) each PayPal access token the tap minted in this case was asked for. */
let paypalTokens = new Map<string, string>();

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
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The env for this case: only these provider keys are set. */
function setEnv(vars: Record<string, string>) {
  for (const k of PROVIDER_ENV) delete process.env[k];
  Object.assign(process.env, vars);
}

/** A store's business settings, replaced (Settings > Payments writes these keys). */
async function setSettings(businessId: string, metaData: Record<string, unknown> | null) {
  await db.business.update({ where: { id: businessId }, data: { metaData: metaData ?? undefined } });
  if (metaData === null) await db.$executeRawUnsafe(`UPDATE businesses SET meta_data = NULL WHERE id = $1`, businessId);
}

/** The gateway ids a storefront's public gateway list offers for a USD amount. */
async function storefrontGatewayIds(slug: string): Promise<string[]> {
  await clearRateLimits();
  const res = await agent().get(`/site/storefront/public/${encodeURIComponent(slug)}/gateways?currency=USD`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  for (const g of res.body) expect(Object.keys(g).sort(), 'ids, names and currencies only').toEqual(['currencies', 'id', 'name']);
  return res.body.map((g: { id: string }) => g.id);
}

/** The public storefront checkout of one USD cart. */
async function checkout(slug: string, productId: string, paymentMethod: string, extra: Record<string, unknown> = {}) {
  await clearRateLimits();
  const res = await agent()
    .post(`/site/storefront/public/${encodeURIComponent(slug)}/checkout`)
    .send({
      items: [{ productId, quantity: QUANTITY }],
      customer: { name: 'Vee SixtyOne', email: CUSTOMER_EMAIL },
      paymentMethod,
      returnUrl: RETURN_URL,
      ...extra,
    });
  await settle();
  return res;
}

/** The generic storefront checkout (POST /payments/create-checkout {payableType: storefront_order}). */
async function genericCheckout(orderId: string, gateway: 'paypal' | 'stripe') {
  await clearRateLimits();
  return agent().post('/payments/create-checkout').send({ payableType: 'storefront_order', payableId: orderId, gateway, returnUrl: RETURN_URL });
}

let orderSeq = 0;
/** An UNPAID USD storefront order of the business, written directly (the generic checkout and the webhooks name it). */
async function seedOrder(businessId: string, productId: string, paymentMethod: string | null): Promise<string> {
  orderSeq += 1;
  const id = `${P}order_${orderSeq}`;
  await db.marketplaceOrder.create({
    data: {
      id,
      businessId,
      orderNumber: `${P}ORD-${orderSeq}`,
      status: 'PENDING',
      type: 'STOREFRONT',
      customerName: 'Vee SixtyOne',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: ORDER_TOTAL,
      total: ORDER_TOTAL,
      currency: 'USD',
      paymentStatus: 'UNPAID',
      paymentMethod,
      items: { create: [{ productId, name: 'V61B Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL, currency: 'USD' }] },
    },
  });
  return id;
}

/** What a refused checkout must leave as it was. */
async function counts(businessId: string) {
  const [orders, invoices, paymentRows, slots, webhookEvents] = await Promise.all([
    db.marketplaceOrder.count({ where: { businessId } }),
    db.invoice.count({ where: { businessId } }),
    db.payment.count({ where: { businessId } }),
    db.idempotencyKey.count({ where: { businessId } }),
    db.webhookEvent.count({ where: { providerEventId: { startsWith: P } } }),
  ]);
  return { orders, invoices, payments: paymentRows, slots, webhookEvents };
}

const notOffered = (name: 'PayPal' | 'Stripe') => ({
  code: 'PAYMENT_METHOD_NOT_OFFERED',
  message: `${name} is not configured for this business: choose another payment method`,
});

/** Stripe and PayPal requests of this case (the tap records every one). */
const stripeRequests = () => requests.filter((r) => r.host === 'api.stripe.com');
const paypalRequests = () => requests.filter((r) => r.host === PAYPAL_SANDBOX);
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

/** A PayPal webhook delivery with every transmission header present (the signature check is PayPal's, through the tap). */
async function paypalWebhook(event: Record<string, unknown>) {
  await clearRateLimits();
  const res = await agent()
    .post('/payments/paypal/webhook')
    .set('content-type', 'application/json')
    .set('paypal-transmission-id', `${P}transmission`)
    .set('paypal-transmission-time', new Date().toISOString())
    .set('paypal-transmission-sig', `${P}signature`)
    .set('paypal-cert-url', `https://${PAYPAL_SANDBOX}/v1/notifications/certs/${P}cert`)
    .set('paypal-auth-algo', 'SHA256withRSA')
    .send(JSON.stringify(event));
  await settle();
  return res;
}

/** PayPal's PAYMENT.CAPTURE.COMPLETED for a capture naming `customId` (an invoice or a storefront order). */
function captureCompleted(eventId: string, captureId: string, customId: string, value = ORDER_TOTAL.toFixed(2)) {
  return { id: eventId, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId, custom_id: customId, amount: { value, currency_code: 'USD' } } };
}

/** PayPal's CHECKOUT.ORDER.COMPLETED for an order whose purchase unit names `customId`. */
function orderCompleted(eventId: string, paypalOrderId: string, captureId: string, customId: string) {
  return {
    id: eventId,
    event_type: 'CHECKOUT.ORDER.COMPLETED',
    resource: {
      id: paypalOrderId,
      purchase_units: [
        {
          reference_id: customId,
          custom_id: customId,
          payments: { captures: [{ id: captureId, amount: { value: ORDER_TOTAL.toFixed(2), currency_code: 'USD' } }] },
        },
      ],
    },
  };
}

/** PayPal's CHECKOUT.ORDER.COMPLETED with one captured purchase unit per [customId, captureId]. */
function multiUnitOrderCompleted(eventId: string, paypalOrderId: string, units: Array<[customId: string, captureId: string]>) {
  return {
    id: eventId,
    event_type: 'CHECKOUT.ORDER.COMPLETED',
    resource: {
      id: paypalOrderId,
      purchase_units: units.map(([customId, captureId]) => ({
        reference_id: customId,
        custom_id: customId,
        payments: { captures: [{ id: captureId, amount: { value: ORDER_TOTAL.toFixed(2), currency_code: 'USD' } }] },
      })),
    },
  };
}

/** The order's money state, as one comparable string. */
async function orderState(orderId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return `${stored.status}/${stored.paymentStatus}/${stored.paymentRef ?? ''}`;
}

/** OPK-08: an invoice's status and its payments (`provider:providerPaymentId:status:amount@businessId`), as one comparable value. */
async function invoiceState(invoiceId: string) {
  const stored = await db.invoice.findUnique({ where: { id: invoiceId } });
  const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } });
  return {
    status: stored.status,
    payments: rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}@${p.businessId}`),
  };
}

/** OPK-09 / OPK-10: a Stripe delivery to POST /payments/stripe/webhook, signed (t=, v1= HMAC-SHA256 of `t.raw`) with `secret`. */
async function stripeWebhook(event: Record<string, unknown>, secret: string) {
  await clearRateLimits();
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const res = await agent()
    .post('/payments/stripe/webhook')
    .set('content-type', 'application/json')
    .set('stripe-signature', `t=${t},v1=${v1}`)
    .send(raw);
  await settle();
  return res;
}

/** Stripe's checkout.session.completed of a storefront order's paid session, as createStorePayment makes the session. */
function sessionCompleted(eventId: string, sessionId: string, orderId: string, businessId: string) {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: orderId,
        metadata: { orderId, businessId },
        amount_total: ORDER_TOTAL * 100,
        currency: 'usd',
        payment_status: 'paid',
      },
    },
  };
}

/** The storefront order's settlement through the paid door: its one invoice's status and payments. */
async function orderInvoice(orderId: string, businessId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  const invoices = await db.invoice.findMany({ where: { businessId, invoiceNumber: { contains: stored.orderNumber } } });
  const rows = invoices.length ? await db.payment.findMany({ where: { invoiceId: { in: invoices.map((i: any) => i.id) } } }) : [];
  return {
    invoices: invoices.map((i: any) => i.status),
    payments: rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}`),
  };
}

/**
 * PR210-PAYPAL-STORE-REFUND's fixtures, under this suite's registered prefix. The plan allocated 'w1fi_', which the
 * registry cannot take (fixture-prefix-registry.spec.ts NEW_PREFIX: k<NN><a-z>_ or v<NN><a-z>_ only), and a suite a
 * packet extends keeps its own prefix: so every id below is v61b_w1fi_..., cleaned up with the suite's own patterns.
 */
const R = `${P}w1fi_`;

/** The PayPal apps that sign deliveries in the PR210 cases (the tap's paypalSigner). */
const PLATFORM_APP: PaypalApp = {
  clientId: PLATFORM_PAYPAL.PAYPAL_CLIENT_ID,
  clientSecret: PLATFORM_PAYPAL.PAYPAL_CLIENT_SECRET,
  webhookId: PLATFORM_PAYPAL_WEBHOOK.PAYPAL_WEBHOOK_ID,
};
const OWN_APP: PaypalApp = {
  clientId: OWN_PAYPAL.paypalClientId,
  clientSecret: OWN_PAYPAL.paypalClientSecret,
  webhookId: OWN_PAYPAL_WEBHOOK.paypalWebhookId,
};
/** Another store's own complete PayPal app (bizMixed's, saved per case). */
const MIXED_APP: PaypalApp = {
  clientId: fake('mixed', 'paypal', 'client'),
  clientSecret: fake('mixed', 'paypal', 'secret'),
  webhookId: fake('mixed', 'paypal', 'webhook'),
};
const settingsOf = (app: PaypalApp) => ({ paypalClientId: app.clientId, paypalClientSecret: app.clientSecret, paypalWebhookId: app.webhookId });

/** The token and verify requests of one signature check, as the app and webhook id they were made with. */
function paypalChecks(): Array<{ path: string; authorization: string | null; webhookId?: string }> {
  return paypalRequests().map((r) =>
    r.path === '/v1/notifications/verify-webhook-signature'
      ? { path: r.path, authorization: paypalTokens.get((r.authorization ?? '').replace(/^Bearer /, '')) ?? null, webhookId: JSON.parse(r.body).webhook_id }
      : { path: r.path, authorization: r.authorization },
  );
}

/** One signature check made with `app`: its token request, then its verify request with its own webhook id. */
const checkedWith = (app: PaypalApp) => [
  { path: '/v1/oauth2/token', authorization: basic(app.clientId, app.clientSecret) },
  { path: '/v1/notifications/verify-webhook-signature', authorization: basic(app.clientId, app.clientSecret), webhookId: app.webhookId },
];

/** A USD storefront order of the business, settled through the paid door by its store's own capture signed with `app`. */
async function settledPaypalOrder(businessId: string, productId: string, app: PaypalApp, tag: string) {
  const orderId = await seedOrder(businessId, productId, 'PAYPAL');
  const captureId = `${R}cap_${tag}`;
  paypalSigner = app;
  const res = await paypalWebhook(captureCompleted(`${R}WH_cap_${tag}`, captureId, orderId));
  expect(res.status, `settling ${tag}: ${JSON.stringify(res.body)}`).toBe(201);
  expect(await orderState(orderId), `settling ${tag}`).toBe(`CONFIRMED/PAID/${captureId}`);
  requests = [];
  return { orderId, captureId };
}

/** A SENT USD invoice of a business with no PayPal of its own, paid by a capture the platform's app signed. */
async function paidPlatformInvoice(tag: string) {
  const invoiceId = `${R}inv_${tag}`;
  await db.invoice.create({
    data: {
      id: invoiceId,
      businessId: ID.bizPlatform,
      contactId: ID.contactPlatform,
      invoiceNumber: `${R}INV-${tag}`,
      status: 'SENT',
      currency: 'USD',
      subtotal: ORDER_TOTAL,
      total: ORDER_TOTAL,
      items: { create: [{ id: `${invoiceId}_item1`, description: 'w1fi item', quantity: 1, unitPrice: ORDER_TOTAL, total: ORDER_TOTAL }] },
    },
  });
  const captureId = `${R}cap_${tag}`;
  paypalSigner = PLATFORM_APP;
  const res = await paypalWebhook(captureCompleted(`${R}WH_cap_${tag}`, captureId, invoiceId));
  expect(res.status, `paying ${tag}: ${JSON.stringify(res.body)}`).toBe(201);
  requests = [];
  return { invoiceId, captureId };
}

/**
 * PayPal's PAYMENT.CAPTURE.REFUNDED / .REVERSED: a refund resource that names the capture it returns only through
 * supplementary_data.related_ids.capture_id, or only through its 'up' link (no custom_id, no invoice_id). `extra` adds
 * fields to the resource (a custom_id, for the cross-tenant cases).
 */
function captureRefund(
  eventType: 'PAYMENT.CAPTURE.REFUNDED' | 'PAYMENT.CAPTURE.REVERSED',
  eventId: string,
  refundId: string,
  captureId: string,
  names: 'related_ids' | 'up_link',
  extra: Record<string, unknown> = {},
) {
  const self = { href: `https://${PAYPAL_SANDBOX}/v2/payments/refunds/${refundId}`, rel: 'self', method: 'GET' };
  const up = { href: `https://${PAYPAL_SANDBOX}/v2/payments/captures/${captureId}`, rel: 'up', method: 'GET' };
  return {
    id: eventId,
    event_type: eventType,
    resource_type: 'refund',
    resource: {
      id: refundId,
      status: 'COMPLETED',
      amount: { value: ORDER_TOTAL.toFixed(2), currency_code: 'USD' },
      ...(names === 'related_ids' ? { supplementary_data: { related_ids: { capture_id: captureId } } } : {}),
      links: names === 'related_ids' ? [self] : [self, up],
      ...extra,
    },
  };
}

/** A storefront order's money: the order row, its checkout invoice (INV-<orderNumber>), that invoice's payments and their postings. */
async function orderBooks(orderId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  const invoice = await db.invoice.findFirst({ where: { businessId: stored.businessId, invoiceNumber: `INV-${stored.orderNumber}` } });
  return { order: `${stored.status}/${stored.paymentStatus}`, ...(await invoiceBooks(invoice?.id ?? null)) };
}

/** An invoice's status, its payments (`provider:providerPaymentId:status:amount@businessId`) and their postings (`type:status:amount`). */
async function invoiceBooks(invoiceId: string | null) {
  if (!invoiceId) return { invoice: null, payments: [], postings: [] };
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  const rows = await db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const txns = rows.length
    ? await db.financialTransaction.findMany({
        where: { sourceType: 'Payment', sourceId: { in: rows.map((r: any) => r.id) } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  return {
    invoice: invoice.status,
    payments: rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}@${p.businessId}`),
    postings: txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`),
  };
}

/** PR210 review: a PayPal refund resource's amount (the refund, not the capture), for captureRefund's `extra`. */
const refunding = (value: number) => ({ amount: { value: value.toFixed(2), currency_code: 'USD' } });

/**
 * PR210 review (D-121): what the order shows of its refunds: metadata.refundedTotal, and its 'refunded' /
 * 'partially_refunded' timeline steps as `status:refundAmount:refundedTotal:by:refund` (by: the provider, or 'hand' for
 * the owner's fulfil refund; refund: the provider's refund id).
 */
async function orderRefunds(orderId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  const meta = (stored.metadata ?? {}) as Record<string, any>;
  const timeline: any[] = Array.isArray(meta.statusTimeline) ? meta.statusTimeline : [];
  return {
    refundedTotal: meta.refundedTotal ?? null,
    steps: timeline
      .filter((s) => s?.status === 'refunded' || s?.status === 'partially_refunded')
      .map((s) => `${s.status}:${s.refundAmount}:${s.refundedTotal ?? ''}:${s.provider ?? 'hand'}:${s.providerRefundId ?? ''}`),
  };
}

/** PR210 review (D-121): the owner's fulfil call, POST /marketplace/businesses/:businessId/orders/:orderId/fulfill. */
async function fulfil(orderId: string, body: Record<string, unknown>, businessId = ID.bizOwn) {
  const res = await agent().post(`/marketplace/businesses/${businessId}/orders/${orderId}/fulfill`).set('x-test-user', ID.owner).send(body);
  await settle();
  return res;
}

/** PR210 review (COR-PR210-1): the store's revenue as Sales > Orders states it (GET /site/businesses/:id/orders/summary). */
async function storeRevenue(businessId = ID.bizOwn): Promise<number> {
  const res = await agent().get(`/site/businesses/${businessId}/orders/summary`).set('x-test-user', ID.owner);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return Number(res.body.totalRevenue);
}

/** PR210 review: the hand-recorded refund rows on the order's checkout invoice (the D-121 door's manual_refund_ rows). */
async function handRefunds(orderId: string): Promise<string[]> {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  const invoice = await db.invoice.findFirst({ where: { businessId: stored.businessId, invoiceNumber: `INV-${stored.orderNumber}` } });
  const rows = await db.payment.findMany({
    where: { invoiceId: invoice.id, providerPaymentId: { startsWith: 'manual_refund_' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((p: any) => `${p.providerPaymentId}:${p.status}:${Number(p.amount)}`);
}

beforeAll(async () => {
  process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
  delete process.env.WIPAY_API_KEY;
  delete process.env.WIPAY_ACCOUNT_NUMBER;
  // The storefront's return URL origin (a Stripe checkout's return URL must be on it).
  process.env.PUBLIC_URL_ALLOWLIST = PUBLIC_ORIGIN;
  setEnv({});

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
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
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
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  Logger.overrideLogger(false);
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  const stub = {};

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    // PR210 review: MarketplaceController for the owner's fulfil refund (the D-121 door).
    controllers: [SiteController, PaymentsController, MarketplaceController],
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
          createExpense: async (input: { businessId: string; amount: number }) => {
            expenses.push({ businessId: input.businessId, amount: input.amount });
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

  // The PayPal webhook reads the raw body, as in production (app-bootstrap.ts).
  app = moduleRef.createNestApplication({ rawBody: true });
  // PR210 review: identity attachment only, for the seeded v61b_ owner (as AuthMiddleware does after token verification).
  // No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  payments = app.get(PaymentsService);
  storeOrders = app.get(StoreOrderService);
  prismaService = app.get(PrismaService);
  // Fulfilment routing runs un-awaited after a paid order; it is off the money path and held here.
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
  app.get(EventEmitter2).onAny((name: string | string[]) => {
    const n = Array.isArray(name) ? name.join('.') : String(name);
    if (n.startsWith('store_order.')) seen.push(n);
  });

  await cleanup();
  await clearRateLimits();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  for (const [id, slug] of [
    [ID.bizPlatform, SLUG.platform],
    [ID.bizMixed, SLUG.mixed],
    [ID.bizOwn, SLUG.own],
  ] as const) {
    await db.business.create({
      data: { id, name: `V61B ${slug}`, slug, ownerId: ID.owner, currency: 'USD', accountingBasis: 'CASH', storeEnabled: true },
    });
    await db.membership.create({ data: { id: `${id}_m_owner`, userId: ID.owner, businessId: id, role: 'OWNER' } });
    // P233 WEDGE-HIDE-STORE-SERVER: this suite tests public store checkout on businesses that already sell online.
    await db.marketplaceOrder.create({
      data: { id: `${id}_legacy_seed`, businessId: id, orderNumber: `${id.toUpperCase()}-LEGACY-0`, status: 'completed', customerName: 'Legacy Seed', total: 1, subtotal: 1, currency: 'USD' },
    });
    await app.get(ChartOfAccountsSeederService).ensureDefaults(id);
  }
  for (const [id, businessId] of [
    [ID.prodPlatform, ID.bizPlatform],
    [ID.prodMixed, ID.bizMixed],
    [ID.prodOwn, ID.bizOwn],
  ] as const) {
    await db.product.create({ data: { id, businessId, name: 'V61B Widget', price: UNIT_PRICE, currency: 'USD', category: 'PRODUCT', isActive: true } });
    await db.service.create({ data: { id: `${id}_listing`, businessId, name: 'V61B Widget', duration: 30, price: UNIT_PRICE, sourceProductId: id } });
  }
  // OPK-05: the business with no keys of its own sends USD invoices; one has an active pay link.
  await db.contact.create({
    data: { id: ID.contactPlatform, businessId: ID.bizPlatform, firstName: 'Vee', lastName: 'SixtyOne', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
  for (const [id, number] of [[ID.invLink, 'INV-V61B-1'], [ID.invCapture, 'INV-V61B-2']] as const) {
    await db.invoice.create({
      data: {
        id,
        businessId: ID.bizPlatform,
        contactId: ID.contactPlatform,
        invoiceNumber: `${P}${number}`,
        status: 'SENT',
        currency: 'USD',
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        items: { create: [{ id: `${id}_item1`, description: 'v61b item', quantity: 1, unitPrice: ORDER_TOTAL, total: ORDER_TOTAL }] },
      },
    });
  }
  await db.paymentLink.create({ data: { token: PAY_TOKEN, invoiceId: ID.invLink, businessId: ID.bizPlatform, active: true } });
  // OPK-08 (SEC-W11OPK-1): each business's SENT USD invoice of the order total, with a contact of its own.
  for (const [id, businessId] of [[ID.contactMixed, ID.bizMixed], [ID.contactOwn, ID.bizOwn]] as const) {
    const email = `${P}${id.slice(P.length)}@test.local`;
    await db.contact.create({ data: { id, businessId, firstName: 'Vee', lastName: 'SixtyOne', email, emailNormalized: email } });
  }
  for (const [id, businessId, contactId, number] of [
    [ID.invVictim, ID.bizMixed, ID.contactMixed, 'INV-V61B-3'],
    [ID.invOwn, ID.bizOwn, ID.contactOwn, 'INV-V61B-4'],
    [ID.invOwnLater, ID.bizOwn, ID.contactOwn, 'INV-V61B-5'],
    [ID.invPlatformLater, ID.bizPlatform, ID.contactPlatform, 'INV-V61B-6'],
  ] as const) {
    await db.invoice.create({
      data: {
        id,
        businessId,
        contactId,
        invoiceNumber: `${P}${number}`,
        status: 'SENT',
        currency: 'USD',
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        items: { create: [{ id: `${id}_item1`, description: 'v61b item', quantity: 1, unitPrice: ORDER_TOTAL, total: ORDER_TOTAL }] },
      },
    });
  }
}, 90_000);

beforeEach(async () => {
  await settle();
  await clearRateLimits();
  seen = [];
  expenses = [];
  setEnv({});
  await setSettings(ID.bizPlatform, null);
  await setSettings(ID.bizMixed, null);
  await setSettings(ID.bizOwn, { ...OWN_PAYPAL, ...OWN_PAYPAL_WEBHOOK, ...OWN_STRIPE });

  requests = [];
  stripeSessions = 0;
  paypalSigner = null;
  paypalTokens = new Map();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = new URL(String(input?.url ?? input));
    const headers = new Headers(init?.headers ?? {});
    requests.push({ host: url.host, path: url.pathname, authorization: headers.get('authorization'), body: String(init?.body ?? '') });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.host === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessions += 1;
      return json({ id: `${P}cs_${stripeSessions}`, url: STRIPE_REDIRECT });
    }
    if (url.host === PAYPAL_SANDBOX && url.pathname === '/v1/oauth2/token') {
      const token = `${P}paypal_access_${paypalTokens.size + 1}`;
      paypalTokens.set(token, headers.get('authorization') ?? '');
      return json({ access_token: token });
    }
    if (url.host === PAYPAL_SANDBOX && url.pathname === '/v1/notifications/verify-webhook-signature') {
      if (!paypalSigner) return json({ verification_status: 'SUCCESS' });
      const app = paypalTokens.get((headers.get('authorization') ?? '').replace(/^Bearer /, ''));
      const webhookId = JSON.parse(String(init?.body ?? '{}')).webhook_id;
      const signedFor = app === basic(paypalSigner.clientId, paypalSigner.clientSecret) && webhookId === paypalSigner.webhookId;
      return json({ verification_status: signedFor ? 'SUCCESS' : 'FAILURE' });
    }
    throw new Error(`v61b: unexpected network call to ${url.href}`);
  }) as typeof fetch);

  // The PayPal SDK client (the provider edge): records the credentials it is built from and the orders it is asked for.
  paypalBuilt = [];
  paypalOrdered = [];
  paypalSpy = vi.spyOn(payments as any, 'getPaypalClient').mockImplementation((...credentials: unknown[]) => {
    paypalBuilt.push(credentials);
    return {
      client: {},
      ordersController: {
        createOrder: vi.fn(async (req: any) => {
          paypalOrdered.push(req?.body?.purchaseUnits);
          return { result: { id: `${P}pp_order_${paypalOrdered.length}`, links: [] } };
        }),
      },
    };
  });
});

afterEach(async () => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  paypalSpy?.mockRestore();
  paypalSpy = undefined;
  await settle();
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

describe('W11-STORE-OWN-PAYMENT-KEYS (D-138): a storefront offers PayPal and Stripe only with the business own complete credentials', () => {
  it("OPK-01 (D-138): with the platform's PayPal in the env and no PayPal of the store's own, the storefront gateway list leaves PayPal out, and the public checkout (with and without a retry key) and the generic storefront checkout answer 400 PAYMENT_METHOD_NOT_OFFERED: no order, retry slot, invoice or payment written, no store_order.created, no PayPal client built", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    // At the base: ['paypal'] (the platform's app stood in for the store).
    expect(await storefrontGatewayIds(SLUG.platform), 'the storefront list').not.toContain('paypal');

    const before = await counts(ID.bizPlatform);
    for (const extra of [{}, { idempotencyKey: `${P}key_opk01` }, { idempotencyKey: `${P}key_opk01` }]) {
      const res = await checkout(SLUG.platform, ID.prodPlatform, 'PAYPAL', extra);
      // At the base: 201, a PAYPAL order whose PayPal client was built from the platform's pair.
      expect(res.status, `${JSON.stringify(extra)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body, JSON.stringify(extra)).toMatchObject(notOffered('PayPal'));
    }
    expect(await counts(ID.bizPlatform), 'no order, retry slot, invoice or payment').toEqual(before);
    expect(seen, 'no store_order.created').toEqual([]);

    const orderId = await seedOrder(ID.bizPlatform, ID.prodPlatform, 'PAYPAL');
    const seeded = await counts(ID.bizPlatform);
    const generic = await genericCheckout(orderId, 'paypal');
    // At the base: 201 { type: 'paypal_order' } through a client built from the platform's pair.
    expect(generic.status, JSON.stringify(generic.body)).toBe(400);
    expect(generic.body).toMatchObject(notOffered('PayPal'));
    expect(await counts(ID.bizPlatform), 'the generic checkout writes nothing').toEqual(seeded);
    expect(await orderState(orderId)).toBe('PENDING/UNPAID/');

    expect(paypalBuilt, 'no PayPal client is built (from the platform pair or any other)').toEqual([]);
    expect(paypalOrdered, 'PayPal is asked for nothing').toEqual([]);
    expect(requests, 'no provider request').toEqual([]);
  });

  it("OPK-02 (D-138): with the platform's Stripe in the env and no Stripe of the store's own, the storefront gateway list leaves Stripe out, and the public checkout (with and without a retry key) and the generic storefront checkout answer 400 PAYMENT_METHOD_NOT_OFFERED: nothing written, no Stripe request", async () => {
    setEnv({ ...PLATFORM_STRIPE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PLATFORM_STRIPE.STRIPE_PUBLISHABLE_KEY });
    // At the base: ['stripe'].
    expect(await storefrontGatewayIds(SLUG.platform), 'the storefront list').not.toContain('stripe');

    const before = await counts(ID.bizPlatform);
    for (const extra of [{}, { idempotencyKey: `${P}key_opk02` }, { idempotencyKey: `${P}key_opk02` }]) {
      const res = await checkout(SLUG.platform, ID.prodPlatform, 'stripe', extra);
      // At the base: 201, a STRIPE order whose Checkout Session was made with the platform's secret key.
      expect(res.status, `${JSON.stringify(extra)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body, JSON.stringify(extra)).toMatchObject(notOffered('Stripe'));
    }
    expect(await counts(ID.bizPlatform), 'no order, retry slot, invoice or payment').toEqual(before);
    expect(seen, 'no store_order.created').toEqual([]);

    const orderId = await seedOrder(ID.bizPlatform, ID.prodPlatform, 'STRIPE');
    const seeded = await counts(ID.bizPlatform);
    const generic = await genericCheckout(orderId, 'stripe');
    // At the base: 201 { type: 'redirect' } to a session made with the platform's secret key.
    expect(generic.status, JSON.stringify(generic.body)).toBe(400);
    expect(generic.body).toMatchObject(notOffered('Stripe'));
    expect(await counts(ID.bizPlatform), 'the generic checkout writes nothing').toEqual(seeded);
    expect(await orderState(orderId)).toBe('PENDING/UNPAID/');

    expect(stripeRequests(), 'no Stripe request').toEqual([]);
    expect(requests, 'no provider request').toEqual([]);
  });

  it("OPK-03 (D-138): a store's key is never mixed with the platform's: its PayPal client id beside the platform's secret, its PayPal secret beside the platform's id, its Stripe publishable key beside the platform's secret and webhook secret, and its Stripe keys beside the platform's webhook secret are each not offered (storefront list, public and generic checkout 400 PAYMENT_METHOD_NOT_OFFERED), nothing written, no client built and no request sent", async () => {
    const rows: Array<[label: string, method: 'PAYPAL' | 'STRIPE', settings: Record<string, unknown>, env: Record<string, string>]> = [
      ['store PayPal id, platform secret', 'PAYPAL', { paypalClientId: OWN_PAYPAL.paypalClientId }, { PAYPAL_CLIENT_SECRET: PLATFORM_PAYPAL.PAYPAL_CLIENT_SECRET }],
      ['store PayPal id, platform pair', 'PAYPAL', { paypalClientId: OWN_PAYPAL.paypalClientId }, PLATFORM_PAYPAL],
      ['store PayPal secret, platform id', 'PAYPAL', { paypalClientSecret: OWN_PAYPAL.paypalClientSecret }, { PAYPAL_CLIENT_ID: PLATFORM_PAYPAL.PAYPAL_CLIENT_ID }],
      [
        'store Stripe publishable key, platform secret and webhook secret',
        'STRIPE',
        { stripePublishableKey: OWN_STRIPE.stripePublishableKey },
        { STRIPE_SECRET_KEY: PLATFORM_STRIPE.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET },
      ],
      [
        'store Stripe keys, platform webhook secret',
        'STRIPE',
        { stripePublishableKey: OWN_STRIPE.stripePublishableKey, stripeSecretKey: OWN_STRIPE.stripeSecretKey },
        PLATFORM_STRIPE,
      ],
    ];
    for (const [label, method, settings, env] of rows) {
      setEnv(env);
      await setSettings(ID.bizMixed, settings);
      paypalBuilt = [];
      requests = [];
      seen = [];
      const gateway = method === 'PAYPAL' ? 'paypal' : 'stripe';
      const name = method === 'PAYPAL' ? 'PayPal' : 'Stripe';
      // At the base: offered (each key from the settings or else the env, one by one).
      expect(await storefrontGatewayIds(SLUG.mixed), `${label}: the storefront list`).not.toContain(gateway);

      const before = await counts(ID.bizMixed);
      const res = await checkout(SLUG.mixed, ID.prodMixed, method.toLowerCase());
      // At the base: 201, the PayPal client built from [store id, platform secret] / the session made with the platform's secret.
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body, label).toMatchObject(notOffered(name));
      expect(await counts(ID.bizMixed), `${label}: nothing written`).toEqual(before);
      expect(seen, `${label}: no store_order.created`).toEqual([]);

      const orderId = await seedOrder(ID.bizMixed, ID.prodMixed, method);
      const seeded = await counts(ID.bizMixed);
      const generic = await genericCheckout(orderId, gateway);
      expect(generic.status, `${label} generic: ${JSON.stringify(generic.body)}`).toBe(400);
      expect(generic.body, `${label} generic`).toMatchObject(notOffered(name));
      expect(await counts(ID.bizMixed), `${label} generic: nothing written`).toEqual(seeded);

      expect(paypalBuilt, `${label}: no PayPal client built`).toEqual([]);
      expect(requests, `${label}: no provider request`).toEqual([]);
    }
  });

  it("OPK-04 (D-138) controls: a store's own complete PayPal pair and Stripe triple, with a different platform set in the env, are offered; the public and the generic checkout build the PayPal client from the store's pair and make the Stripe session with the store's secret key, never the platform's", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK, ...PLATFORM_STRIPE });
    const ids = await storefrontGatewayIds(SLUG.own);
    expect(ids, "the store's own PayPal and Stripe are offered").toEqual(expect.arrayContaining(['paypal', 'stripe']));

    // PayPal: the public checkout, then the generic checkout of another of its orders.
    const pp = await checkout(SLUG.own, ID.prodOwn, ' PayPal ');
    expect(pp.status, JSON.stringify(pp.body)).toBe(201);
    expect(pp.body.order).toMatchObject({ paymentMethod: 'PAYPAL', currency: 'USD', paymentStatus: 'UNPAID' });
    expect(pp.body.payment).toMatchObject({ status: 'PAYPAL_AWAITING_APPROVAL' });
    const ppOrder = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const ppGeneric = await genericCheckout(ppOrder, 'paypal');
    expect(ppGeneric.status, JSON.stringify(ppGeneric.body)).toBe(201);
    expect(ppGeneric.body).toMatchObject({ type: 'paypal_order' });
    expect(paypalBuilt, "both PayPal clients are built from the store's own pair").toEqual([
      [OWN_PAYPAL.paypalClientId, OWN_PAYPAL.paypalClientSecret],
      [OWN_PAYPAL.paypalClientId, OWN_PAYPAL.paypalClientSecret],
    ]);
    expect(
      paypalOrdered.map((units) => `${units[0].customId}:${units[0].amount.currencyCode}:${units[0].amount.value}`),
      'one USD PayPal order for each storefront order',
    ).toEqual([`${pp.body.order.id}:USD:${ORDER_TOTAL.toFixed(2)}`, `${ppOrder}:USD:${ORDER_TOTAL.toFixed(2)}`]);

    // Stripe: the public checkout, then the generic checkout of another of its orders.
    const st = await checkout(SLUG.own, ID.prodOwn, 'STRIPE');
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    expect(st.body.order).toMatchObject({ paymentMethod: 'STRIPE', currency: 'USD' });
    expect(st.body.payment).toMatchObject({ status: 'REDIRECT', redirectUrl: STRIPE_REDIRECT });
    const stOrder = await seedOrder(ID.bizOwn, ID.prodOwn, 'STRIPE');
    const stGeneric = await genericCheckout(stOrder, 'stripe');
    expect(stGeneric.status, JSON.stringify(stGeneric.body)).toBe(201);
    expect(stGeneric.body).toEqual({ type: 'redirect', redirectUrl: STRIPE_REDIRECT });
    const sessions = stripeRequests();
    expect(sessions.map((r) => r.authorization), "both sessions are made with the store's own secret key").toEqual([
      `Bearer ${OWN_STRIPE.stripeSecretKey}`,
      `Bearer ${OWN_STRIPE.stripeSecretKey}`,
    ]);
    expect(
      sessions.map((r) => {
        const sent = new URLSearchParams(r.body);
        return `${sent.get('metadata[businessId]')}|${sent.get('client_reference_id')}|${sent.get('line_items[0][price_data][currency]')}`;
      }),
      'each names this store and its order',
    ).toEqual([`${ID.bizOwn}|${st.body.order.id}|usd`, `${ID.bizOwn}|${stOrder}|usd`]);
    expect(paypalRequests(), 'no PayPal HTTP request').toEqual([]);
  });

  it("OPK-05 (control; the invoice pay link is not changed here): with the platform's PayPal and Stripe in the env and no keys of the business's own, the pay-link gateway list (token route) and the bare-id list still offer both, as built (a deviation recorded for an owner ruling); an invoice's PayPal capture webhook is still verified with the platform's app and recorded once", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK, ...PLATFORM_STRIPE });
    await clearRateLimits();
    const byToken = await agent().get(`/payments/public/invoice-link/${encodeURIComponent(PAY_TOKEN)}/gateways`);
    expect(byToken.status, JSON.stringify(byToken.body)).toBe(200);
    expect(byToken.body.map((g: { id: string }) => g.id).sort(), 'the pay-link list (as built)').toEqual(['paypal', 'stripe']);
    await clearRateLimits();
    const bareId = await agent().get(`/payments/invoice/${encodeURIComponent(ID.invLink)}/gateways`);
    expect(bareId.status, JSON.stringify(bareId.body)).toBe(200);
    expect(bareId.body.map((g: { id: string }) => g.id).sort(), 'the bare-id list (as built)').toEqual(['paypal', 'stripe']);

    // An invoice's PayPal capture: verified with the platform's app (the business has no PayPal of its own), recorded once.
    const res = await paypalWebhook(captureCompleted(`${P}WH_invoice`, `${P}cap_invoice`, ID.invCapture));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [token, verify] = paypalRequests();
    expect(paypalRequests().map((r) => r.path)).toEqual(['/v1/oauth2/token', '/v1/notifications/verify-webhook-signature']);
    expect(token.authorization, "the platform's app, as built").toBe(basic(PLATFORM_PAYPAL.PAYPAL_CLIENT_ID, PLATFORM_PAYPAL.PAYPAL_CLIENT_SECRET));
    expect(JSON.parse(verify.body).webhook_id, "the platform's webhook id, as built").toBe(PLATFORM_PAYPAL_WEBHOOK.PAYPAL_WEBHOOK_ID);
    const rows = await db.payment.findMany({ where: { invoiceId: ID.invCapture } });
    expect(rows.map((p: any) => `${p.provider}:${p.providerPaymentId}:${p.status}:${Number(p.amount)}`)).toEqual([
      `paypal:${P}cap_invoice:SUCCESSFUL:${ORDER_TOTAL}`,
    ]);
  });

  it("OPK-06 (D-138) the storefront PayPal capture: PayPal's capture webhook naming a storefront order is verified only with the store's own complete pair and its own webhook id: (a) a store with no PayPal of its own is 400, nothing verified with the platform's app or recorded, the order UNPAID; (b) a store with its own pair and webhook id is verified with them and the order settled once through the paid door, for PAYMENT.CAPTURE.COMPLETED and CHECKOUT.ORDER.COMPLETED; (c) a store with its own pair and no webhook id of its own is 400, the platform's webhook id not mixed in, nothing recorded", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });

    // (a) The platform's app may not settle a store's order.
    const platformOrder = await seedOrder(ID.bizPlatform, ID.prodPlatform, 'PAYPAL');
    for (const [label, event] of [
      ['capture', captureCompleted(`${P}WH_a_capture`, `${P}cap_a_capture`, platformOrder)],
      ['order', orderCompleted(`${P}WH_a_order`, `${P}pp_a_order`, `${P}cap_a_order`, platformOrder)],
    ] as const) {
      requests = [];
      const before = await counts(ID.bizPlatform);
      const res = await paypalWebhook(event);
      // At the base: 201, verified with the platform's app and webhook id, and the order settled PAID.
      expect(res.status, `(a) ${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(paypalRequests(), `(a) ${label}: nothing is asked of the platform's app`).toEqual([]);
      expect(await counts(ID.bizPlatform), `(a) ${label}: nothing recorded`).toEqual(before);
      expect(await orderState(platformOrder), `(a) ${label}`).toBe('PENDING/UNPAID/');
    }

    // (b) The store's own pair and webhook id verify its capture; the paid door settles the order once.
    const ownExpected = {
      token: basic(OWN_PAYPAL.paypalClientId, OWN_PAYPAL.paypalClientSecret),
      webhookId: OWN_PAYPAL_WEBHOOK.paypalWebhookId,
    };
    for (const [label, makeEvent] of [
      ['capture', (orderId: string) => captureCompleted(`${P}WH_b_capture`, `${P}cap_b_capture`, orderId)],
      ['order', (orderId: string) => orderCompleted(`${P}WH_b_order`, `${P}pp_b_order`, `${P}cap_b_order`, orderId)],
    ] as const) {
      const orderId = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
      requests = [];
      const res = await paypalWebhook(makeEvent(orderId));
      expect(res.status, `(b) ${label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(paypalRequests().map((r) => r.path), `(b) ${label}`).toEqual(['/v1/oauth2/token', '/v1/notifications/verify-webhook-signature']);
      const [token, verify] = paypalRequests();
      // At the base: the platform's app (Basic of the platform pair) and the platform's webhook id.
      expect(
        { token: token.authorization, webhookId: JSON.parse(verify.body).webhook_id },
        `(b) ${label}: verified with the store's own pair and webhook id`,
      ).toEqual(ownExpected);
      const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
      expect(stored.paymentStatus, `(b) ${label}: settled`).toBe('PAID');
      const invoices = await db.invoice.findMany({ where: { businessId: ID.bizOwn, invoiceNumber: { contains: stored.orderNumber } } });
      expect(invoices.map((i: any) => i.status), `(b) ${label}: one PAID invoice`).toEqual(['PAID']);
      const rows = await db.payment.findMany({ where: { invoiceId: invoices[0].id } });
      expect(rows.map((p: any) => `${p.provider}:${p.status}:${Number(p.amount)}`), `(b) ${label}: one payment`).toEqual([`paypal:SUCCESSFUL:${ORDER_TOTAL}`]);
    }

    // (c) The store's own pair with no webhook id of its own: the platform's webhook id is not mixed in.
    await setSettings(ID.bizMixed, { ...OWN_PAYPAL });
    const mixedOrder = await seedOrder(ID.bizMixed, ID.prodMixed, 'PAYPAL');
    requests = [];
    const before = await counts(ID.bizMixed);
    const res = await paypalWebhook(captureCompleted(`${P}WH_c_capture`, `${P}cap_c_capture`, mixedOrder));
    // At the base: 201, verified with the platform's app and webhook id, and the order settled PAID.
    expect(res.status, `(c): ${JSON.stringify(res.body)}`).toBe(400);
    expect(paypalRequests(), '(c): nothing is asked of PayPal').toEqual([]);
    expect(await counts(ID.bizMixed), '(c): nothing recorded').toEqual(before);
    expect(await orderState(mixedOrder)).toBe('PENDING/UNPAID/');
  });

  it("OPK-07 (D-138) a PayPal capture settles a storefront order only when the webhook was verified with that order's own store's app: (a) an order event verified with store A's own app whose second purchase unit names store B's order settles A's order only, B's stays UNPAID with nothing recorded; (b) an order event whose first purchase unit names nothing KeyFlow knows (verified with the platform's app) settles none of the storefront orders its other units name", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    await setSettings(ID.bizMixed, { ...OWN_PAYPAL, paypalWebhookId: fake('mixed', 'paypal', 'webhook') });

    // (a) Store A (bizOwn) verifies the event; its second unit names store B's (bizMixed's) order.
    const orderA = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const orderB = await seedOrder(ID.bizMixed, ID.prodMixed, 'PAYPAL');
    const beforeB = await counts(ID.bizMixed);
    requests = [];
    const res = await paypalWebhook(multiUnitOrderCompleted(`${P}WH_7a`, `${P}pp_7a`, [[orderA, `${P}cap_7a_own`], [orderB, `${P}cap_7a_other`]]));
    expect(res.status, `(a): ${JSON.stringify(res.body)}`).toBe(201);
    const [token] = paypalRequests();
    expect(token?.authorization, "(a): verified with store A's own app").toBe(basic(OWN_PAYPAL.paypalClientId, OWN_PAYPAL.paypalClientSecret));
    expect((await db.marketplaceOrder.findUnique({ where: { id: orderA } })).paymentStatus, "(a): A's order is settled").toBe('PAID');
    // At the base: B's order PAID too (the event was verified with the platform's app and every unit settled).
    expect(await orderState(orderB), "(a): B's order is not settled by A's app").toBe('PENDING/UNPAID/');
    expect(await counts(ID.bizMixed), "(a): nothing recorded for B").toEqual({ ...beforeB, webhookEvents: beforeB.webhookEvents + 1 });

    // (b) The first unit names nothing KeyFlow knows: verified with the platform's app (the env-level check, as before).
    const orderC = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const beforeC = await counts(ID.bizOwn);
    requests = [];
    const res2 = await paypalWebhook(multiUnitOrderCompleted(`${P}WH_7b`, `${P}pp_7b`, [[`${P}unknown_ref`, `${P}cap_7b_unknown`], [orderC, `${P}cap_7b_store`]]));
    expect(res2.status, `(b): ${JSON.stringify(res2.body)}`).toBe(201);
    const [platformToken] = paypalRequests();
    expect(platformToken?.authorization, "(b): the platform's app verified it").toBe(basic(PLATFORM_PAYPAL.PAYPAL_CLIENT_ID, PLATFORM_PAYPAL.PAYPAL_CLIENT_SECRET));
    // At the base: the store's order PAID through the paid door on a capture into the platform's account.
    expect(await orderState(orderC), "(b): the platform's app settles no store's order").toBe('PENDING/UNPAID/');
    expect(await counts(ID.bizOwn), '(b): nothing recorded for the store').toEqual({ ...beforeC, webhookEvents: beforeC.webhookEvents + 1 });
  });

  it("OPK-08 (review SEC-W11OPK-1) a PayPal capture settles an invoice only when the webhook was verified with the PayPal app that invoice's business takes PayPal with: (a) an order event verified with store A's own app (unit 1 = A's storefront order) whose second unit names business B's SENT invoice settles A's order only, B's invoice stays SENT with no payment; (b) unit 1 = A's own invoice (verified with A's own PayPal settings), unit 2 = B's invoice: A's invoice is PAID, B's stays SENT; (c) an order event verified with the platform's app records nothing for an invoice of a business that holds its own PayPal, and still settles one of a business with no PayPal of its own (the invoice pay link's PayPal, as built)", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const ownApp = basic(OWN_PAYPAL.paypalClientId, OWN_PAYPAL.paypalClientSecret);
    const untouched = { status: 'SENT', payments: [] };
    expect(await invoiceState(ID.invVictim), "B's invoice (business B holds no PayPal of its own)").toEqual(untouched);

    // (a) The review's repro: store A pays itself on its own app; the second unit names B's invoice.
    const orderA = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const beforeB = await counts(ID.bizMixed);
    requests = [];
    const res = await paypalWebhook(
      multiUnitOrderCompleted(`${P}WH_8a`, `${P}pp_8a`, [[orderA, `${P}cap_8a_own`], [ID.invVictim, `${P}cap_8a_victim`]]),
    );
    expect(res.status, `(a): ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body).toMatchObject({ processed: 'CHECKOUT.ORDER.COMPLETED' });
    expect(paypalRequests()[0]?.authorization, "(a): verified with store A's own app").toBe(ownApp);
    expect(await orderState(orderA), "(a): A's own order is settled").toBe(`CONFIRMED/PAID/${P}cap_8a_own`);
    // At fc23ff18: B's invoice PAID, with paypal:v61b_cap_8a_victim:SUCCESSFUL:80 under business B (the money in A's account).
    expect(await invoiceState(ID.invVictim), "(a): B's invoice is not settled by A's app").toEqual(untouched);
    expect(await counts(ID.bizMixed), '(a): nothing recorded for B (the event claim is the only new row)').toEqual({ ...beforeB, webhookEvents: beforeB.webhookEvents + 1 });

    // (b) PROBE-P2: unit 1 is A's own invoice, so A's own PayPal settings verify the event.
    requests = [];
    const res2 = await paypalWebhook(
      multiUnitOrderCompleted(`${P}WH_8b`, `${P}pp_8b`, [[ID.invOwn, `${P}cap_8b_own`], [ID.invVictim, `${P}cap_8b_victim`]]),
    );
    expect(res2.status, `(b): ${JSON.stringify(res2.body)}`).toBe(201);
    expect(paypalRequests()[0]?.authorization, "(b): verified with A's own PayPal settings").toBe(ownApp);
    expect(await invoiceState(ID.invOwn), "(b): A's own invoice is settled").toEqual({
      status: 'PAID',
      payments: [`paypal:${P}cap_8b_own:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizOwn}`],
    });
    // At fc23ff18 (and at 5872f8f7): B's invoice PAID with paypal:v61b_cap_8b_victim under business B.
    expect(await invoiceState(ID.invVictim), "(b): B's invoice is not settled by A's app").toEqual(untouched);
    expect(await counts(ID.bizMixed), '(b): nothing recorded for B (the two event claims are the only new rows)').toEqual({ ...beforeB, webhookEvents: beforeB.webhookEvents + 2 });

    // (c) Unit 1 names nothing KeyFlow knows: the platform's app verifies the event (the env-level check, as before).
    requests = [];
    const res3 = await paypalWebhook(
      multiUnitOrderCompleted(`${P}WH_8c`, `${P}pp_8c`, [
        [`${P}unknown_ref_8c`, `${P}cap_8c_unknown`],
        [ID.invOwnLater, `${P}cap_8c_own`],
        [ID.invPlatformLater, `${P}cap_8c_platform`],
      ]),
    );
    expect(res3.status, `(c): ${JSON.stringify(res3.body)}`).toBe(201);
    expect(paypalRequests()[0]?.authorization, "(c): the platform's app verified it").toBe(
      basic(PLATFORM_PAYPAL.PAYPAL_CLIENT_ID, PLATFORM_PAYPAL.PAYPAL_CLIENT_SECRET),
    );
    // At fc23ff18: A's invoice PAID on a capture into the platform's account.
    expect(await invoiceState(ID.invOwnLater), "(c): the platform's app settles no invoice of a business with its own PayPal").toEqual(untouched);
    // As built (OPK-05's deviation, for an owner ruling): the platform's app is the pay-link PayPal of a business with none of its own.
    expect(await invoiceState(ID.invPlatformLater), '(c): a business with no PayPal of its own, as built').toEqual({
      status: 'PAID',
      payments: [`paypal:${P}cap_8c_platform:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizPlatform}`],
    });
  });

  it("OPK-09 (review SEC-W11OPK-2, OPK-COR-1) the storefront Stripe checkout D-138 starts on the store's own account settles with that account's own event: checkout.session.completed signed with the store's own webhook secret settles the order once through the paid door, with a different platform STRIPE_* env and with none; a redelivery writes nothing; an event naming one store's order signed with another store's own secret is refused 400 and settles nothing", async () => {
    setEnv({ ...PLATFORM_STRIPE, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PLATFORM_STRIPE.STRIPE_PUBLISHABLE_KEY });

    // (a) The public checkout makes the session on the store's own account; that account's event settles the order.
    const st = await checkout(SLUG.own, ID.prodOwn, 'STRIPE');
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    expect(stripeRequests().map((r) => r.authorization), "the session is made on the store's own account").toEqual([`Bearer ${OWN_STRIPE.stripeSecretKey}`]);
    const orderId: string = st.body.order.id;
    const sessionId: string = st.body.payment.paymentId;
    expect(await orderState(orderId)).toBe('PENDING/UNPAID/');
    requests = [];
    const event = sessionCompleted(`${P}evt_9a`, sessionId, orderId, ID.bizOwn);
    const res = await stripeWebhook(event, OWN_STRIPE.stripeWebhookSecret);
    // At fc23ff18: 400 'Invalid Stripe webhook signature' (only the platform's secret or an invoice's business's is tried).
    expect(res.status, `(a): ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body).toMatchObject({ ok: true, received: true, processed: 'checkout.session.completed' });
    expect(await orderState(orderId), '(a): settled').toBe(`CONFIRMED/PAID/${sessionId}`);
    const settled = { invoices: ['PAID'], payments: [`stripe:${sessionId}:SUCCESSFUL:${ORDER_TOTAL}`] };
    expect(await orderInvoice(orderId, ID.bizOwn), '(a): one PAID invoice, one payment').toEqual(settled);
    const again = await stripeWebhook(event, OWN_STRIPE.stripeWebhookSecret);
    expect(again.status, `(a) redelivery: ${JSON.stringify(again.body)}`).toBe(201);
    expect(again.body, '(a): the redelivery is acknowledged, not processed').not.toHaveProperty('processed');
    expect(await orderInvoice(orderId, ID.bizOwn), '(a): the redelivery writes nothing').toEqual(settled);

    // (b) No platform Stripe in the env at all: the store's own account still settles its order.
    setEnv({});
    const orderB = await seedOrder(ID.bizOwn, ID.prodOwn, 'STRIPE');
    const resB = await stripeWebhook(sessionCompleted(`${P}evt_9b`, `${P}cs_9b`, orderB, ID.bizOwn), OWN_STRIPE.stripeWebhookSecret);
    // At fc23ff18: 400 'Invalid Stripe webhook signature'.
    expect(resB.status, `(b): ${JSON.stringify(resB.body)}`).toBe(201);
    expect(await orderState(orderB), '(b): settled').toBe(`CONFIRMED/PAID/${P}cs_9b`);

    // (c) A store's own secret signs only its own orders' events (the secret is chosen by the order the event names).
    setEnv({ ...PLATFORM_STRIPE });
    await setSettings(ID.bizMixed, { ...MIXED_STRIPE });
    const orderOwn = await seedOrder(ID.bizOwn, ID.prodOwn, 'STRIPE');
    const orderMixed = await seedOrder(ID.bizMixed, ID.prodMixed, 'STRIPE');
    const before = { own: await counts(ID.bizOwn), mixed: await counts(ID.bizMixed) };
    for (const [label, signed, secret] of [
      ["store B's order, store A's secret", sessionCompleted(`${P}evt_9c_b`, `${P}cs_9c_b`, orderMixed, ID.bizMixed), OWN_STRIPE.stripeWebhookSecret],
      ["store A's order, store B's secret", sessionCompleted(`${P}evt_9c_a`, `${P}cs_9c_a`, orderOwn, ID.bizOwn), MIXED_STRIPE.stripeWebhookSecret],
    ] as const) {
      const r = await stripeWebhook(signed, secret);
      expect(r.status, `(c) ${label}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body, `(c) ${label}`).toMatchObject({ message: 'Invalid Stripe webhook signature' });
    }
    expect(await orderState(orderOwn), "(c): A's order").toBe('PENDING/UNPAID/');
    expect(await orderState(orderMixed), "(c): B's order").toBe('PENDING/UNPAID/');
    expect({ own: await counts(ID.bizOwn), mixed: await counts(ID.bizMixed) }, '(c): nothing recorded').toEqual(before);
    expect(requests, 'no provider request at settlement (after the checkout)').toEqual([]);
  });

  it("OPK-10 (review SEC-W11OPK-3; W1F-STORE-STRIPE-R0, owner ruling D-196 `storestripe`): the platform's STRIPE_WEBHOOK_SECRET never settles a store order — neither for a store holding its own complete Stripe set nor for a store with no Stripe of its own: 400, the order UNPAID, nothing recorded, one refusal row (a retry adds none)", async () => {
    setEnv({ ...PLATFORM_STRIPE });

    // (a) A store with its own complete Stripe set: a platform-signed session naming its order is refused.
    const orderOwn = await seedOrder(ID.bizOwn, ID.prodOwn, 'STRIPE');
    const before = await counts(ID.bizOwn);
    const event = sessionCompleted(`${P}evt_10a`, `${P}cs_10a`, orderOwn, ID.bizOwn);
    const res = await stripeWebhook(event, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
    // At fc23ff18: 201 processed and the order CONFIRMED/PAID/v61b_cs_10a.
    expect(res.status, `(a): ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body).toMatchObject({ message: 'Stripe event does not match the order' });
    expect(await orderState(orderOwn), '(a): not settled').toBe('PENDING/UNPAID/');
    const kept = async () =>
      (await db.webhookEvent.findMany({ where: { providerEventId: `${P}evt_10a` } })).map(
        (w: any) => `${w.provider}:${w.eventType}@${w.businessId}`,
      );
    expect(await kept(), '(a): one refusal row').toEqual([`stripe-refused:checkout.session.completed:business@${ID.bizOwn}`]);
    const retry = await stripeWebhook(event, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
    expect(retry.status, `(a) retry: ${JSON.stringify(retry.body)}`).toBe(400);
    expect(await kept(), '(a): a retry adds no row').toHaveLength(1);
    expect(await counts(ID.bizOwn), '(a): nothing recorded but the refusal').toEqual({ ...before, webhookEvents: before.webhookEvents + 1 });

    // (b) W1F-STORE-STRIPE-R0 (owner ruling D-196 `storestripe`, D-138): a store with no Stripe of its own is ALSO
    // never settled by the platform's STRIPE_WEBHOOK_SECRET (400, order UNPAID, nothing recorded, one refusal row).
    const orderPlatform = await seedOrder(ID.bizPlatform, ID.prodPlatform, 'STRIPE');
    const beforePlatform = await counts(ID.bizPlatform);
    const eventB = sessionCompleted(`${P}evt_10b`, `${P}cs_10b`, orderPlatform, ID.bizPlatform);
    const res2 = await stripeWebhook(eventB, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
    expect(res2.status, `(b): ${JSON.stringify(res2.body)}`).toBe(400);
    expect(res2.body, '(b)').toMatchObject({ message: 'Stripe event does not match the order' });
    expect(await orderState(orderPlatform), '(b): not settled by platform signature').toBe('PENDING/UNPAID/');
    const keptB = async () =>
      (await db.webhookEvent.findMany({ where: { providerEventId: `${P}evt_10b` } })).map(
        (w: any) => `${w.provider}:${w.eventType}@${w.businessId}`,
      );
    expect(await keptB(), '(b): one refusal row').toEqual([`stripe-refused:checkout.session.completed:business@${ID.bizPlatform}`]);
    const retryB = await stripeWebhook(eventB, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
    expect(retryB.status, `(b) retry: ${JSON.stringify(retryB.body)}`).toBe(400);
    expect(await keptB(), '(b): a retry adds no row').toHaveLength(1);
    expect(await counts(ID.bizPlatform), '(b): nothing recorded but the refusal').toEqual({
      ...beforePlatform,
      webhookEvents: beforePlatform.webhookEvents + 1,
    });
  });
});

describe("PR210-PAYPAL-STORE-REFUND (D-138; Codex P1 on PR #210): a store's own PayPal refund and reversal webhooks are verified with that store's app and reverse the store order's payment", () => {
  it("RF-01: a store's own PAYMENT.CAPTURE.REFUNDED naming its capture only in supplementary_data.related_ids, and its PAYMENT.CAPTURE.REVERSED naming it only in the 'up' link, are verified with that store's own app and webhook id (never the platform's, which is in the env) and recorded once on the order's checkout invoice: the refund row, the settlement's posting reversed, the invoice reopened; a redelivery and PayPal's resend of the refund under a new event id record nothing new", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    for (const [label, eventType, names] of [
      ['refund', 'PAYMENT.CAPTURE.REFUNDED', 'related_ids'],
      ['reversal', 'PAYMENT.CAPTURE.REVERSED', 'up_link'],
    ] as const) {
      const { orderId, captureId } = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, `rf01_${label}`);
      const capture = `paypal:${captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizOwn}`;
      expect(await orderBooks(orderId), `${label}: settled once through the paid door`).toEqual({
        order: 'CONFIRMED/PAID',
        invoice: 'PAID',
        payments: [capture],
        postings: [`INCOME:POSTED:${ORDER_TOTAL}`],
      });

      const refundId = `${R}rf_rf01_${label}`;
      const event = captureRefund(eventType, `${R}WH_rf01_${label}`, refundId, captureId, names);
      seen = [];
      const res = await paypalWebhook(event);
      // At the base: 400 'Invalid PayPal webhook signature': the refund names no invoice and no order, so it was checked
      // with the platform's app and webhook id, which did not sign it (PayPal keeps redelivering; nothing is recorded).
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body, label).toEqual({ ok: true, received: true, processed: eventType });
      expect(paypalChecks(), `${label}: checked with the store's own app and webhook id only`).toEqual(checkedWith(OWN_APP));
      // Review COR-PR210-1 / SEC-PR210-4 (D-121): the order is refunded with its books. At 813031ae it stayed
      // CONFIRMED/PAID, with no refundedTotal, no step and no store_order.refunded, while its invoice was SENT.
      const refunded = {
        order: 'REFUNDED/REFUNDED',
        invoice: 'SENT',
        payments: [capture, `paypal:${refundId}:REFUNDED:-${ORDER_TOTAL}@${ID.bizOwn}`],
        postings: [`INCOME:REVERSED:${ORDER_TOTAL}`, `REVERSAL:POSTED:${ORDER_TOTAL}`],
      };
      expect(await orderBooks(orderId), `${label}: recorded once on the order's checkout invoice, and the order refunded`).toEqual(refunded);
      const shown = { refundedTotal: ORDER_TOTAL, steps: [`refunded:${ORDER_TOTAL}:${ORDER_TOTAL}:paypal:${refundId}`] };
      expect(await orderRefunds(orderId), `${label}: the order shows PayPal's refund`).toEqual(shown);
      expect(seen, `${label}: one store_order.refunded`).toEqual(['store_order.refunded']);
      expect(expenses, `${label}: it names the invoice, so no Expense is booked beside the refund`).toEqual([]);

      requests = [];
      seen = [];
      const again = await paypalWebhook(event);
      expect(again.status, `${label} redelivery: ${JSON.stringify(again.body)}`).toBe(201);
      expect(again.body, `${label}: the redelivery is acknowledged, not processed`).toEqual({ ok: true, received: true });
      expect(await orderBooks(orderId), `${label}: the redelivery records nothing`).toEqual(refunded);

      const resent = await paypalWebhook({ ...event, id: `${R}WH_rf01_${label}_resent` });
      expect(resent.status, `${label} resent: ${JSON.stringify(resent.body)}`).toBe(201);
      expect(await orderBooks(orderId), `${label}: the same refund under a new event id records nothing (deduped on the refund id)`).toEqual(refunded);
      expect(await orderRefunds(orderId), `${label}: and adds no step`).toEqual(shown);
      expect(seen, `${label}: and emits nothing`).toEqual([]);
    }
  });

  it("RF-02: the platform's signature never verifies a refund or reversal of a store's capture: a delivery the platform's app signed, naming only the store's capture, is checked with the store's own app (the platform's app, in the env, is never asked) and refused 400, nothing recorded and no claim kept; behind the route, the refund processor called with the platform's verifier records nothing for the store's order either", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const { orderId, captureId } = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, 'rf02');
    const paid = await orderBooks(orderId);
    paypalSigner = PLATFORM_APP;
    for (const [label, eventType, names] of [
      ['refund', 'PAYMENT.CAPTURE.REFUNDED', 'related_ids'],
      ['reversal', 'PAYMENT.CAPTURE.REVERSED', 'up_link'],
    ] as const) {
      requests = [];
      const eventId = `${R}WH_rf02_${label}`;
      const res = await paypalWebhook(captureRefund(eventType, eventId, `${R}rf_rf02_${label}`, captureId, names));
      // At the base: 201 processed: checked with the platform's app and webhook id (which signed it), and the refund
      // recorded on the store's order, whose money was taken into the store's own PayPal account.
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body, label).toMatchObject({ message: 'Invalid PayPal webhook signature' });
      expect(paypalChecks(), `${label}: checked with the store's own app only, never the platform's`).toEqual(checkedWith(OWN_APP));
      expect(await orderBooks(orderId), `${label}: nothing recorded`).toEqual(paid);
      expect(await db.webhookEvent.count({ where: { providerEventId: eventId } }), `${label}: no claim kept`).toBe(0);
    }

    // The recording guard behind the route: a refund of a store's capture is recorded only for that store's own app.
    const direct = captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf02_direct`, `${R}rf_rf02_direct`, captureId, 'related_ids');
    await (payments as any).processPaypalRefund(direct.resource, direct.id);
    // At the base: the refund recorded on the store's order.
    expect(await orderBooks(orderId), 'the processor called with the platform verifier records nothing').toEqual(paid);
    await (payments as any).processPaypalRefund(direct.resource, direct.id, { businessId: ID.bizMixed, store: true });
    expect(await orderBooks(orderId), "nor called with another store's verifier").toEqual(paid);
  });

  it("RF-03: a store missing any of its own PayPal values when its capture's refund arrives (no webhook id of its own; no secret of its own) is refused 400 before any request: nothing asked of PayPal (the platform's app and webhook id are not mixed in), nothing recorded", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    await setSettings(ID.bizMixed, settingsOf(MIXED_APP));
    const { orderId, captureId } = await settledPaypalOrder(ID.bizMixed, ID.prodMixed, MIXED_APP, 'rf03');
    const paid = await orderBooks(orderId);
    for (const [n, label, settings] of [
      [1, 'no webhook id of its own', { paypalClientId: MIXED_APP.clientId, paypalClientSecret: MIXED_APP.clientSecret }],
      [2, 'no secret of its own', { paypalClientId: MIXED_APP.clientId, paypalWebhookId: MIXED_APP.webhookId }],
    ] as const) {
      await setSettings(ID.bizMixed, settings);
      requests = [];
      const res = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf03_${n}`, `${R}rf_rf03_${n}`, captureId, 'related_ids'));
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(400);
      // At the base: the token and verify requests were made with the platform's app and webhook id.
      expect(paypalRequests(), `${label}: nothing is asked of PayPal`).toEqual([]);
      expect(await orderBooks(orderId), `${label}: nothing recorded`).toEqual(paid);
    }
  });

  it("RF-04: a refund is verified by the store whose capture it returns, and a store's own app records refunds of that store's captures only: (a) a delivery store A's app signed whose custom_id names A's order and whose capture is store B's is checked with B's own app and refused 400, B's books untouched; (b) a delivery store A's app signed whose custom_id names A's order and whose capture is an invoice capture of a business with no PayPal of its own is acknowledged and records nothing on that invoice", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    await setSettings(ID.bizMixed, settingsOf(MIXED_APP));
    const storeB = await settledPaypalOrder(ID.bizMixed, ID.prodMixed, MIXED_APP, 'rf04_b');
    const paidB = await orderBooks(storeB.orderId);
    const orderA = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const invoice = await paidPlatformInvoice('rf04');
    const paidInvoice = await invoiceBooks(invoice.invoiceId);
    expect(paidInvoice.payments, 'the invoice is paid by the platform-signed capture').toEqual([
      `paypal:${invoice.captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizPlatform}`,
    ]);
    paypalSigner = OWN_APP;

    // (a) Store B's capture, named beside store A's order.
    requests = [];
    const res = await paypalWebhook(
      captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf04_a`, `${R}rf_rf04_a`, storeB.captureId, 'related_ids', { custom_id: orderA }),
    );
    // At the base: 201 processed: verified with A's own app (chosen by the custom_id) and the refund recorded on B's
    // order, under B, for money A's app returned.
    expect(res.status, `(a): ${JSON.stringify(res.body)}`).toBe(400);
    expect(paypalChecks(), "(a): checked with B's own app, the store of the capture").toEqual(checkedWith(MIXED_APP));
    expect(await orderBooks(storeB.orderId), "(a): nothing recorded for B").toEqual(paidB);

    // (b) An invoice capture of a business with no PayPal of its own, named beside store A's order.
    requests = [];
    const res2 = await paypalWebhook(
      captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf04_b`, `${R}rf_rf04_b`, invoice.captureId, 'related_ids', { custom_id: orderA }),
    );
    expect(res2.status, `(b): ${JSON.stringify(res2.body)}`).toBe(201);
    expect(paypalChecks(), "(b): verified with A's own app (the custom_id names A's order)").toEqual(checkedWith(OWN_APP));
    // At the base: the refund recorded on the platform business's invoice (reopened SENT), money A's app returned.
    expect(await invoiceBooks(invoice.invoiceId), '(b): nothing recorded on the invoice').toEqual(paidInvoice);
    expect(await orderState(orderA), "(b): A's order untouched").toBe('PENDING/UNPAID/');
  });

  it("RF-05 (control: an invoice's refund keeps its path): a refund naming only the capture of an invoice of a business with no PayPal of its own is verified with the platform's app and webhook id and recorded once on that invoice, as before; a redelivery records nothing", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const invoice = await paidPlatformInvoice('rf05');
    const capture = `paypal:${invoice.captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizPlatform}`;
    expect(await invoiceBooks(invoice.invoiceId)).toEqual({ invoice: 'PAID', payments: [capture], postings: [`INCOME:POSTED:${ORDER_TOTAL}`] });
    paypalSigner = PLATFORM_APP;
    const event = captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf05`, `${R}rf_rf05`, invoice.captureId, 'related_ids');
    const res = await paypalWebhook(event);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.REFUNDED' });
    expect(paypalChecks(), "checked with the platform's app and webhook id, as before").toEqual(checkedWith(PLATFORM_APP));
    const refunded = {
      invoice: 'SENT',
      payments: [capture, `paypal:${R}rf_rf05:REFUNDED:-${ORDER_TOTAL}@${ID.bizPlatform}`],
      postings: [`INCOME:REVERSED:${ORDER_TOTAL}`, `REVERSAL:POSTED:${ORDER_TOTAL}`],
    };
    expect(await invoiceBooks(invoice.invoiceId), 'recorded once').toEqual(refunded);
    const again = await paypalWebhook(event);
    expect(again.body, 'the redelivery is acknowledged, not processed').toEqual({ ok: true, received: true });
    expect(await invoiceBooks(invoice.invoiceId), 'the redelivery records nothing').toEqual(refunded);
  });

  it("RF-06 (review COR-PR210-1; D-121): an order settled by CHECKOUT.ORDER.COMPLETED and refunded by two PayPal partial refunds (30, then 50) shows each: after the 30 it stays PAID with refundedTotal 30 and a 'partially_refunded' step naming PayPal's refund, and nothing announces a refund; after the 50 it is REFUNDED once (one store_order.refunded naming the invoice, no Expense) and Sales > Orders no longer counts its revenue; a resend adds nothing", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const orderId = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const captureId = `${R}cap_rf06`;
    paypalSigner = OWN_APP;
    const settled = await paypalWebhook(orderCompleted(`${R}WH_ord_rf06`, `${R}pp_rf06`, captureId, orderId));
    expect(settled.status, JSON.stringify(settled.body)).toBe(201);
    expect(await orderState(orderId), 'settled by the order event').toBe(`CONFIRMED/PAID/${captureId}`);
    const capture = `paypal:${captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizOwn}`;
    const revenueBefore = await storeRevenue();

    seen = [];
    const first = `${R}rf_rf06_1`;
    const res = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf06_1`, first, captureId, 'related_ids', refunding(30)));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await orderBooks(orderId), 'the 30 is recorded on the checkout invoice').toMatchObject({
      order: 'CONFIRMED/PAID',
      invoice: 'PARTIALLY_PAID',
      payments: [capture, `paypal:${first}:REFUNDED:-30@${ID.bizOwn}`],
    });
    // At 813031ae: refundedTotal null and no step: nothing on the order said it was partly refunded.
    expect(await orderRefunds(orderId), 'the order shows it is partly refunded').toEqual({
      refundedTotal: 30,
      steps: [`partially_refunded:30:30:paypal:${first}`],
    });
    expect(seen, 'partly refunded: no store_order.refunded').toEqual([]);
    expect(await storeRevenue(), 'still a paid order').toBe(revenueBefore);

    const second = `${R}rf_rf06_2`;
    const event = captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf06_2`, second, captureId, 'related_ids', refunding(50));
    const res2 = await paypalWebhook(event);
    expect(res2.status, JSON.stringify(res2.body)).toBe(201);
    const refunded = await orderBooks(orderId);
    // At 813031ae: the invoice SENT and the order still CONFIRMED/PAID.
    expect(refunded, 'the rest is recorded and the order refunded').toMatchObject({
      order: 'REFUNDED/REFUNDED',
      invoice: 'SENT',
      payments: [capture, `paypal:${first}:REFUNDED:-30@${ID.bizOwn}`, `paypal:${second}:REFUNDED:-50@${ID.bizOwn}`],
    });
    const shown = {
      refundedTotal: ORDER_TOTAL,
      steps: [`partially_refunded:30:30:paypal:${first}`, `refunded:50:${ORDER_TOTAL}:paypal:${second}`],
    };
    expect(await orderRefunds(orderId)).toEqual(shown);
    expect(seen, 'one store_order.refunded').toEqual(['store_order.refunded']);
    expect(expenses, 'it names the invoice: no Expense beside the refund').toEqual([]);
    // At 813031ae: the same total before and after (the order stayed PAID).
    expect(await storeRevenue(), "Sales > Orders no longer counts the refunded order's revenue").toBe(revenueBefore - ORDER_TOTAL);

    seen = [];
    const resent = await paypalWebhook({ ...event, id: `${R}WH_rf06_2_resent` });
    expect(resent.status, JSON.stringify(resent.body)).toBe(201);
    expect(await orderBooks(orderId), 'a resend records nothing').toEqual(refunded);
    expect(await orderRefunds(orderId), 'adds no step').toEqual(shown);
    expect(seen, 'and emits nothing').toEqual([]);
  });

  it("RF-07 (review COR-PR210-2, the owner first; D-121): a partial refund the owner records by hand (the fulfil refund door, which does not call PayPal), then PayPal's notice of the refund the owner makes in PayPal for it, is recorded once: the notice is paired with the hand-recorded refund and adds no row, posting or step (nor does its resend); a second PayPal refund of the same amount, made in PayPal alone, is its own refund and is recorded", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const { orderId, captureId } = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, 'rf07');
    const byHand = await fulfil(orderId, { action: 'refund', refundAmount: 30, reason: 'damaged item' });
    expect(byHand.status, JSON.stringify(byHand.body)).toBe(201);
    const recorded = await orderBooks(orderId);
    expect(recorded, 'the hand refund of 30').toMatchObject({ order: 'CONFIRMED/PAID', invoice: 'PARTIALLY_PAID' });
    expect(await handRefunds(orderId)).toEqual([expect.stringMatching(/^manual_refund_.+_part_[0-9a-f]{32}:REFUNDED:-30$/)]);
    expect(recorded.payments, 'the capture and the hand refund only').toHaveLength(2);
    const shown = { refundedTotal: 30, steps: ['partially_refunded:30:30:hand:'] };
    expect(await orderRefunds(orderId)).toEqual(shown);

    seen = [];
    const notice = captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf07_1`, `${R}rf_rf07_1`, captureId, 'related_ids', refunding(30));
    const res = await paypalWebhook(notice);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.REFUNDED' });
    // At 813031ae: a second -30 row (PayPal's) and a second refund posting: 60 of 80 refunded, the order saying 30.
    expect(await orderBooks(orderId), "PayPal's notice of the hand-recorded refund records nothing new").toEqual(recorded);
    expect(await orderRefunds(orderId), 'nor adds a step').toEqual(shown);
    expect(seen).toEqual([]);
    const resent = await paypalWebhook({ ...notice, id: `${R}WH_rf07_1_resent` });
    expect(resent.status, JSON.stringify(resent.body)).toBe(201);
    expect(await orderBooks(orderId), 'nor does its resend').toEqual(recorded);

    // A second refund of 30, made in PayPal alone (nothing recorded by hand for it), is recorded.
    const second = `${R}rf_rf07_2`;
    const res2 = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf07_2`, second, captureId, 'related_ids', refunding(30)));
    expect(res2.status, JSON.stringify(res2.body)).toBe(201);
    expect(await orderBooks(orderId)).toMatchObject({
      order: 'CONFIRMED/PAID',
      invoice: 'PARTIALLY_PAID',
      payments: [...recorded.payments, `paypal:${second}:REFUNDED:-30@${ID.bizOwn}`],
    });
    expect(await orderRefunds(orderId)).toEqual({
      refundedTotal: 60,
      steps: ['partially_refunded:30:30:hand:', `partially_refunded:30:60:paypal:${second}`],
    });
  });

  it("RF-08 (review COR-PR210-2, PayPal first; D-121): after PayPal's partial refund of 30 is recorded (and shown on the order), the owner's hand refund of the same 30 is refused 409 with nothing written; the owner's full refund takes what is left (50) and refunds the order once, and PayPal's notice of that 50 is then not recorded again; a hand refund equal to a PayPal refund already recorded is refused even when it is all that is left (it is not taken as the full refund)", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const { orderId, captureId } = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, 'rf08');
    const capture = `paypal:${captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizOwn}`;
    const first = `${R}rf_rf08_1`;
    const res = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf08_1`, first, captureId, 'related_ids', refunding(30)));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const afterPaypal = await orderBooks(orderId);
    expect(afterPaypal.payments).toEqual([capture, `paypal:${first}:REFUNDED:-30@${ID.bizOwn}`]);
    const shown = { refundedTotal: 30, steps: [`partially_refunded:30:30:paypal:${first}`] };
    // At 813031ae: refundedTotal null, which invited the owner to record the refund again.
    expect(await orderRefunds(orderId), "the order shows PayPal's partial refund").toEqual(shown);

    seen = [];
    const same = await fulfil(orderId, { action: 'refund', refundAmount: 30, reason: 'damaged item' });
    // At 813031ae: 201, a hand-recorded -30 beside PayPal's: 60 of 80 refunded, refundedTotal 60.
    expect(same.status, JSON.stringify(same.body)).toBe(409);
    expect(String(same.body.message), 'the refusal names PayPal').toMatch(/PayPal/);
    expect(await orderBooks(orderId), 'nothing written').toEqual(afterPaypal);
    expect(await orderRefunds(orderId)).toEqual(shown);
    expect(await handRefunds(orderId)).toEqual([]);
    expect(seen).toEqual([]);

    const rest = await fulfil(orderId, { action: 'refund' });
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    const refunded = await orderBooks(orderId);
    expect(refunded, 'the full refund takes what is left').toMatchObject({ order: 'REFUNDED/REFUNDED', invoice: 'SENT' });
    expect(await handRefunds(orderId)).toEqual([expect.stringMatching(/^manual_refund_.+:REFUNDED:-50$/)]);
    expect(seen, 'refunded once').toEqual(['store_order.refunded']);
    const shownRefunded = await orderRefunds(orderId);
    expect(shownRefunded.refundedTotal).toBe(ORDER_TOTAL);

    seen = [];
    const restNotice = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf08_2`, `${R}rf_rf08_2`, captureId, 'related_ids', refunding(50)));
    expect(restNotice.status, JSON.stringify(restNotice.body)).toBe(201);
    expect(await orderBooks(orderId), "PayPal's notice of the rest records nothing new").toEqual(refunded);
    expect(await orderRefunds(orderId)).toEqual(shownRefunded);
    expect(seen).toEqual([]);

    // PayPal's 40 recorded, then the owner's hand refund of 40, which is all that is left: the same refund, refused.
    const other = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, 'rf08_left');
    const left = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf08_3`, `${R}rf_rf08_3`, other.captureId, 'related_ids', refunding(40)));
    expect(left.status, JSON.stringify(left.body)).toBe(201);
    const leftBooks = await orderBooks(other.orderId);
    const leftShown = await orderRefunds(other.orderId);
    expect(leftShown.refundedTotal).toBe(40);
    const all = await fulfil(other.orderId, { action: 'refund', refundAmount: 40, reason: 'damaged item' });
    // At 813031ae: 201 as the full refund of what was left: the order REFUNDED, 80 refunded of which PayPal returned 40.
    expect(all.status, JSON.stringify(all.body)).toBe(409);
    expect(await orderBooks(other.orderId), 'nothing written').toEqual(leftBooks);
    expect(await orderRefunds(other.orderId)).toEqual(leftShown);
  });

  it("RF-09 (review COR-PR210-2, racing): the owner's hand refund of 30 and PayPal's notice of the same 30 arriving together record one refund of 30, whichever is first (the hand refund is refused, or the notice is paired with it)", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    for (const n of [1, 2, 3]) {
      const { orderId, captureId } = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, `rf09_${n}`);
      const [byHand, notice] = await Promise.all([
        fulfil(orderId, { action: 'refund', refundAmount: 30, reason: 'damaged item' }),
        paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf09_${n}`, `${R}rf_rf09_${n}`, captureId, 'related_ids', refunding(30))),
      ]);
      expect([201, 409], `race ${n}: ${JSON.stringify(byHand.body)}`).toContain(byHand.status);
      expect(notice.status, `race ${n}: ${JSON.stringify(notice.body)}`).toBe(201);
      const books = await orderBooks(orderId);
      const refunds = books.payments.filter((p: string) => p.includes(':REFUNDED:'));
      // At 813031ae: two refunds of 30, the hand-recorded one and PayPal's.
      expect(refunds, `race ${n}: one refund recorded (${JSON.stringify(books)})`).toHaveLength(1);
      expect(refunds[0]).toMatch(/:REFUNDED:-30@/);
      expect((await orderRefunds(orderId)).refundedTotal, `race ${n}`).toBe(30);
    }
  });

  it("RF-10 (review SEC-PR210-1; V1-15c): a failed read of the refunded capture's payment fails the delivery (500) and gives its claim back, nothing recorded, so PayPal's redelivery records the refund; at 813031ae it was acknowledged as processed with nothing recorded and every redelivery acked as a duplicate", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const { orderId, captureId } = await settledPaypalOrder(ID.bizOwn, ID.prodOwn, OWN_APP, 'rf10');
    const paid = await orderBooks(orderId);
    const eventId = `${R}WH_rf10`;
    const event = captureRefund('PAYMENT.CAPTURE.REFUNDED', eventId, `${R}rf_rf10`, captureId, 'related_ids');
    // One read fails: the refund processor's read of the capture's payment (the one that selects its amount).
    const real = prismaService.client;
    let failed = 0;
    const payment = new Proxy(real.payment, {
      get(target: any, key: string | symbol) {
        const value = Reflect.get(target, key);
        if (key !== 'findUnique') return typeof value === 'function' ? value.bind(target) : value;
        return (args: any) => {
          if (failed === 0 && args?.where?.providerPaymentId === captureId && args?.select?.amount) {
            failed += 1;
            return Promise.reject(new Error('v61b: the read of the capture payment failed'));
          }
          return value.call(target, args);
        };
      },
    });
    prismaService.client = new Proxy(real, {
      get(target: any, key: string | symbol) {
        if (key === 'payment') return payment;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    let res: any;
    try {
      res = await paypalWebhook(event);
    } finally {
      prismaService.client = real;
    }
    expect(failed, 'the read was made to fail once').toBe(1);
    // At 813031ae: 201 processed (the failed read taken as no capture, the refund refused as not the store's), the claim kept.
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(await db.webhookEvent.count({ where: { providerEventId: eventId } }), 'the claim is given back').toBe(0);
    expect(await orderBooks(orderId), 'nothing recorded').toEqual(paid);

    const again = await paypalWebhook(event);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body, "PayPal's redelivery is processed").toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.REFUNDED' });
    expect(await orderBooks(orderId), 'and records the refund').toMatchObject({ order: 'REFUNDED/REFUNDED', invoice: 'SENT' });
  });

  it("RF-11 (review SEC-PR210-3 / COR-PR210-4; V1-15c): a refund signed with a store's own app that names its order (custom_id) and a capture KeyFlow has not recorded yet fails the delivery (409) and gives its claim back, nothing recorded; once the capture settles the order, PayPal's redelivery of the refund records it and refunds the order", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const orderId = await seedOrder(ID.bizOwn, ID.prodOwn, 'PAYPAL');
    const captureId = `${R}cap_rf11`;
    const eventId = `${R}WH_rf11`;
    const refundId = `${R}rf_rf11`;
    const event = captureRefund('PAYMENT.CAPTURE.REFUNDED', eventId, refundId, captureId, 'related_ids', { custom_id: orderId });
    paypalSigner = OWN_APP;
    const before = await counts(ID.bizOwn);
    const early = await paypalWebhook(event);
    // At 813031ae: 201 processed with nothing recorded and the claim kept, so the redelivery below was acked as a duplicate.
    expect(early.status, JSON.stringify(early.body)).toBe(409);
    expect(paypalChecks(), "verified with the store's own app").toEqual(checkedWith(OWN_APP));
    expect(await db.webhookEvent.count({ where: { providerEventId: eventId } }), 'the claim is given back').toBe(0);
    expect(await counts(ID.bizOwn), 'nothing recorded').toEqual(before);

    const settled = await paypalWebhook(captureCompleted(`${R}WH_cap_rf11`, captureId, orderId));
    expect(settled.status, JSON.stringify(settled.body)).toBe(201);
    expect(await orderState(orderId)).toBe(`CONFIRMED/PAID/${captureId}`);
    const again = await paypalWebhook(event);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true, processed: 'PAYMENT.CAPTURE.REFUNDED' });
    expect(await orderBooks(orderId), 'the redelivery records the refund').toEqual({
      order: 'REFUNDED/REFUNDED',
      invoice: 'SENT',
      payments: [`paypal:${captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizOwn}`, `paypal:${refundId}:REFUNDED:-${ORDER_TOTAL}@${ID.bizOwn}`],
      postings: [`INCOME:REVERSED:${ORDER_TOTAL}`, `REVERSAL:POSTED:${ORDER_TOTAL}`],
    });
  });

  it("RF-12 (review SEC-PR210-2 / COR-PR210-3; D-138): a store order whose PayPal capture the platform's app settled before D-138 (its store holds no PayPal setting of its own, so the capture is in the platform's account): the platform-signed refund naming only that capture is verified with the platform's app and webhook id and recorded, the order refunded, as the base recorded it; a store holding a PayPal setting of its own is never checked with the platform's app (RF-02, RF-03)", async () => {
    setEnv({ ...PLATFORM_PAYPAL, ...PLATFORM_PAYPAL_WEBHOOK });
    const orderId = await seedOrder(ID.bizPlatform, ID.prodPlatform, 'PAYPAL');
    const captureId = `${R}cap_rf12`;
    // What the pre-D-138 PayPal webhook recorded for a platform-verified capture naming the order (the paid door).
    await storeOrders.updatePaymentStatus(orderId, 'PAID', captureId, 'paypal');
    await settle();
    const capture = `paypal:${captureId}:SUCCESSFUL:${ORDER_TOTAL}@${ID.bizPlatform}`;
    expect(await orderBooks(orderId), 'settled by the platform before D-138').toEqual({
      order: 'CONFIRMED/PAID',
      invoice: 'PAID',
      payments: [capture],
      postings: [`INCOME:POSTED:${ORDER_TOTAL}`],
    });
    paypalSigner = PLATFORM_APP;
    seen = [];
    const refundId = `${R}rf_rf12`;
    const res = await paypalWebhook(captureRefund('PAYMENT.CAPTURE.REFUNDED', `${R}WH_rf12`, refundId, captureId, 'related_ids'));
    // At 813031ae: 400 'Invalid PayPal webhook signature' before any request (checked with the store's own set, of which
    // it has none), on every redelivery: the refund the platform's account made was never recorded.
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(paypalChecks(), "checked with the platform's app and webhook id").toEqual(checkedWith(PLATFORM_APP));
    expect(await orderBooks(orderId), 'recorded, the order refunded').toEqual({
      order: 'REFUNDED/REFUNDED',
      invoice: 'SENT',
      payments: [capture, `paypal:${refundId}:REFUNDED:-${ORDER_TOTAL}@${ID.bizPlatform}`],
      postings: [`INCOME:REVERSED:${ORDER_TOTAL}`, `REVERSAL:POSTED:${ORDER_TOTAL}`],
    });
    expect(seen).toEqual(['store_order.refunded']);
  });
});
