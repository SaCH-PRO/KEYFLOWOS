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
 * TransactionalEmailService, ExpensesService and the timeline. No provider is
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

const STRIPE_REDIRECT = 'https://checkout.stripe.com/c/pay/v61b-session';
const PAYPAL_SANDBOX = 'api-m.sandbox.paypal.com';

let db: any;
let app: any;
let redis: any;
let payments: any;

/** store_order.* events in emit order. */
let seen: string[] = [];
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

/** The order's money state, as one comparable string. */
async function orderState(orderId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return `${stored.status}/${stored.paymentStatus}/${stored.paymentRef ?? ''}`;
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
    controllers: [SiteController, PaymentsController],
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
      { provide: ExpensesService, useValue: { createExpense: async () => null } },
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  payments = app.get(PaymentsService);
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
    await app.get(ChartOfAccountsSeederService).ensureDefaults(id);
  }
  for (const [id, businessId] of [
    [ID.prodPlatform, ID.bizPlatform],
    [ID.prodMixed, ID.bizMixed],
    [ID.prodOwn, ID.bizOwn],
  ] as const) {
    await db.product.create({ data: { id, businessId, name: 'V61B Widget', price: UNIT_PRICE, currency: 'USD', category: 'PRODUCT', isActive: true } });
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
}, 90_000);

beforeEach(async () => {
  await settle();
  await clearRateLimits();
  seen = [];
  setEnv({});
  await setSettings(ID.bizPlatform, null);
  await setSettings(ID.bizMixed, null);
  await setSettings(ID.bizOwn, { ...OWN_PAYPAL, ...OWN_PAYPAL_WEBHOOK, ...OWN_STRIPE });

  requests = [];
  stripeSessions = 0;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = new URL(String(input?.url ?? input));
    const headers = new Headers(init?.headers ?? {});
    requests.push({ host: url.host, path: url.pathname, authorization: headers.get('authorization'), body: String(init?.body ?? '') });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.host === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessions += 1;
      return json({ id: `${P}cs_${stripeSessions}`, url: STRIPE_REDIRECT });
    }
    if (url.host === PAYPAL_SANDBOX && url.pathname === '/v1/oauth2/token') return json({ access_token: `${P}paypal_access` });
    if (url.host === PAYPAL_SANDBOX && url.pathname === '/v1/notifications/verify-webhook-signature') {
      return json({ verification_status: 'SUCCESS' });
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
});
