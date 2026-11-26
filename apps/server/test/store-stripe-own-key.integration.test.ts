/**
 * W1F-STORE-STRIPE-R0 (P128, V1-70; owner rulings D-196 `storestripe` + D-138,
 * SEC-W11OPK-3) — the platform's Stripe signature NEVER settles or refunds a
 * storefront order, on either POST /payments/stripe/webhook or legacy
 * POST /webhooks/stripe; a storefront Stripe order settles and refunds ONLY
 * with events verified by that store's own Stripe account; and
 * createStorePayment sets payment_intent_data.metadata so charge.refunded
 * events from the store's own Stripe account map directly to their store order
 * instead of failing 400.
 *
 * Real Postgres database, real HTTP routes (SiteController, PaymentsController,
 * WebhooksController), real StoreOrderService paid/refund door, real ledger
 * posting and real InvoiceWorkflowService. No provider traffic: global fetch
 * taps only Stripe's Checkout Session API, and the Stripe SDK stub in
 * WebhooksController verifies HMAC-SHA256 signatures locally.
 *
 *   SS-01  Platform STRIPE_WEBHOOK_SECRET refused (400) on POST /payments/stripe/webhook
 *          for store orders (both a store with NO Stripe keys and a store with its own
 *          Stripe keys), across checkout.session.completed,
 *          checkout.session.async_payment_succeeded, payment_intent.succeeded, and
 *          charge.succeeded: order stays PENDING/UNPAID, no invoice/payment/posting,
 *          no dedupe claim, one refusal row under stripe-refused (retry adds none).
 *   SS-02  Platform STRIPE_WEBHOOK_SECRET refused (400) on legacy POST /webhooks/stripe
 *          for store orders (both keyless and own-key stores): order stays PENDING/UNPAID,
 *          one refusal row under stripe-legacy-refused; control: a platform-signed
 *          invoice checkout.session.completed on POST /webhooks/stripe still settles the
 *          invoice once.
 *   SS-03  Store's own Stripe webhook secret settles its store order cleanly on
 *          POST /payments/stripe/webhook, stashing payment_intent in Payment.reference
 *          for refund correlation; redelivery is a no-op; another store's secret is
 *          refused 400.
 *   SS-04  createStorePayment attaches payment_intent_data[metadata][orderId] and
 *          payment_intent_data[metadata][businessId] on both public storefront checkout
 *          and generic POST /payments/create-checkout.
 *   SS-05  Store-signed charge.refunded (full with refunds.data, and partial+final
 *          cumulative without refunds.data) carrying metadata.orderId / businessId
 *          maps directly to its store order instead of 400: records negative REFUNDED
 *          payment row, reverses ledger posting, reopens checkout invoice, updates
 *          MarketplaceOrder status/paymentStatus/metadata.refundedTotal/timeline, and
 *          emits store_order.refunded once with invoiceId (no duplicate Expense).
 *   SS-06  Platform-signed charge.refunded and refund.created targeting a store order
 *          (with or without metadata.orderId) are refused (400) on BOTH
 *          POST /payments/stripe/webhook and POST /webhooks/stripe; cross-store
 *          signed charge.refunded is also refused 400; order, invoice, payment and
 *          ledger stay untouched.
 *
 * Fixtures: prefix `v70f_` (registered in test/helpers/fixture-prefixes.json);
 * cleaned up by raw SQL using sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.mock('stripe', async () => {
  const { createHmac: hmac, timingSafeEqual } = await import('crypto');
  class Stripe {
    webhooks = {
      constructEvent: (payload: Buffer | string, header: string, secret: string) => {
        const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
        const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=').map((x) => x.trim())));
        const expected = Buffer.from(hmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex'));
        const given = Buffer.from(String(parts.v1 ?? ''));
        if (!parts.t || given.length !== expected.length || !timingSafeEqual(given, expected)) {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return JSON.parse(raw);
      },
    };
  }
  return { default: Stripe };
});

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v70f_';
const RATE_LIMIT_NS = `${P}${Date.now()}`;

const STRIPE_ENV = [
  'STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];
const PREVIOUS_ENV: Record<string, string | undefined> = Object.fromEntries(
  ['RATE_LIMIT_KEY_NAMESPACE', 'PUBLIC_URL_ALLOWLIST', ...STRIPE_ENV].map((k) => [k, process.env[k]]),
);

const ID = {
  owner: `${P}owner`,
  bizPlatform: `${P}biz_platform`, // USD, no Stripe keys of its own
  bizOwn: `${P}biz_own`, // USD, its own complete Stripe set
  bizOther: `${P}biz_other`, // USD, another store's own complete Stripe set
  prodPlatform: `${P}prod_platform`,
  prodOwn: `${P}prod_own`,
  prodOther: `${P}prod_other`,
  contactPlatform: `${P}contact_platform`,
  invPlatformControl: `${P}inv_platform_ctrl`,
};
const SLUG = {
  platform: `${P}store-platform`,
  own: `${P}store-own`,
  other: `${P}store-other`,
};
const PUBLIC_ORIGIN = 'https://shop.v70f.test';
const RETURN_URL = `${PUBLIC_ORIGIN}/store/return`;
const CUSTOMER_EMAIL = `${P}buyer@test.local`;
const UNIT_PRICE = 40;
const QUANTITY = 2;
const ORDER_TOTAL = UNIT_PRICE * QUANTITY; // 80 USD

const fake = (...parts: string[]) => `${P}${parts.join('_')}_fake`;

const PLATFORM_STRIPE = {
  STRIPE_PUBLISHABLE_KEY: fake('platform', 'stripe', 'pk'),
  STRIPE_SECRET_KEY: fake('platform', 'stripe', 'sk'),
  STRIPE_WEBHOOK_SECRET: fake('platform', 'stripe', 'whsec'),
};
const OWN_STRIPE = {
  stripePublishableKey: fake('own', 'stripe', 'pk'),
  stripeSecretKey: fake('own', 'stripe', 'sk'),
  stripeWebhookSecret: fake('own', 'stripe', 'whsec'),
};
const OTHER_STRIPE = {
  stripePublishableKey: fake('other', 'stripe', 'pk'),
  stripeSecretKey: fake('other', 'stripe', 'sk'),
  stripeWebhookSecret: fake('other', 'stripe', 'whsec'),
};
const STRIPE_REDIRECT = 'https://checkout.stripe.com/c/pay/v70f-session';

let db: any;
let app: any;
let redis: any;
let seen: string[] = [];
let expenses: Array<{ businessId: string; amount: number }> = [];
const inflight: Promise<unknown>[] = [];
let requests: Array<{ host: string; path: string; authorization: string | null; body: string }> = [];
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let stripeSessionSeq = 0;
let orderSeq = 0;

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

function signStripe(raw: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function postStripeDoor(event: Record<string, unknown>, secret: string) {
  await clearRateLimits();
  const raw = JSON.stringify(event);
  const res = await agent()
    .post('/payments/stripe/webhook')
    .set('content-type', 'application/json')
    .set('stripe-signature', signStripe(raw, secret))
    .send(raw);
  await settle();
  return res;
}

async function postStripeLegacy(event: Record<string, unknown>, secret: string) {
  const raw = JSON.stringify(event);
  const res = await agent()
    .post('/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', signStripe(raw, secret))
    .send(raw);
  await settle();
  return res;
}

async function seedOrder(businessId: string, productId: string): Promise<string> {
  orderSeq += 1;
  const id = `${P}ord_${orderSeq}`;
  await db.marketplaceOrder.create({
    data: {
      id,
      businessId,
      orderNumber: `${P}ORD-${orderSeq}`,
      status: 'PENDING',
      type: 'STOREFRONT',
      customerName: 'V70F Shopper',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: ORDER_TOTAL,
      total: ORDER_TOTAL,
      currency: 'USD',
      paymentStatus: 'UNPAID',
      paymentMethod: 'STRIPE',
      items: {
        create: [
          {
            productId,
            name: 'V70F Widget',
            quantity: QUANTITY,
            unitPrice: UNIT_PRICE,
            total: ORDER_TOTAL,
            currency: 'USD',
          },
        ],
      },
    },
  });
  return id;
}

function storeSessionEvent(
  eventId: string,
  sessionId: string,
  orderId: string,
  businessId: string,
  opts: { type?: string; paymentIntent?: string } = {},
) {
  return {
    id: eventId,
    object: 'event',
    type: opts.type ?? 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: orderId,
        metadata: { orderId, businessId },
        ...(opts.paymentIntent ? { payment_intent: opts.paymentIntent } : {}),
        amount_total: ORDER_TOTAL * 100,
        currency: 'usd',
        payment_status: 'paid',
      },
    },
  };
}

async function orderState(orderId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return `${stored.status}/${stored.paymentStatus}/${stored.paymentRef ?? ''}`;
}

async function orderBooks(orderId: string) {
  const stored = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  const invoice = await db.invoice.findFirst({
    where: { businessId: stored.businessId, invoiceNumber: `INV-${stored.orderNumber}` },
  });
  const rows = invoice
    ? await db.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    : [];
  const txns = rows.length
    ? await db.financialTransaction.findMany({
        where: { sourceType: 'Payment', sourceId: { in: rows.map((r: any) => r.id) } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  return {
    order: `${stored.status}/${stored.paymentStatus}`,
    invoice: invoice?.status ?? null,
    payments: rows.map((p: any) => ({
      provider: p.provider,
      providerPaymentId: p.providerPaymentId,
      reference: p.reference,
      status: p.status,
      amount: Number(p.amount),
      businessId: p.businessId,
    })),
    postings: txns.map((t: any) => `${t.type}:${t.status}:${Number(t.amount)}`),
  };
}

async function orderRefundMeta(orderId: string) {
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

beforeAll(async () => {
  process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;
  process.env.PUBLIC_URL_ALLOWLIST = PUBLIC_ORIGIN;
  Object.assign(process.env, PLATFORM_STRIPE);

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
  const { WebhooksController } = await import('../src/modules/webhooks/webhooks.controller');
  const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
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
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
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
    controllers: [SiteController, PaymentsController, WebhooksController],
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
      InvoiceWorkflowService,
      RevenueAttributionService,
      RevenuePostingService,
      ExpensePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: WebhookDispatcherService, useValue: {} },
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

  app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  vi.spyOn(app.get(MarketplaceService) as any, 'autoRouteOrder').mockImplementation(() => undefined);

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
  for (const [id, slug, metaData] of [
    [ID.bizPlatform, SLUG.platform, undefined],
    [ID.bizOwn, SLUG.own, OWN_STRIPE],
    [ID.bizOther, SLUG.other, OTHER_STRIPE],
  ] as const) {
    await db.business.create({
      data: {
        id,
        name: `V70F ${slug}`,
        slug,
        ownerId: ID.owner,
        currency: 'USD',
        accountingBasis: 'CASH',
        storeEnabled: true,
        ...(metaData ? { metaData } : {}),
      },
    });
    await db.membership.create({ data: { id: `${id}_m_owner`, userId: ID.owner, businessId: id, role: 'OWNER' } });
    await app.get(ChartOfAccountsSeederService).ensureDefaults(id);
  }
  for (const [id, businessId] of [
    [ID.prodPlatform, ID.bizPlatform],
    [ID.prodOwn, ID.bizOwn],
    [ID.prodOther, ID.bizOther],
  ] as const) {
    await db.product.create({
      data: { id, businessId, name: 'V70F Widget', price: UNIT_PRICE, currency: 'USD', category: 'PRODUCT', isActive: true },
    });
    await db.service.create({
      data: { id: `${id}_listing`, businessId, name: 'V70F Widget', duration: 30, price: UNIT_PRICE, sourceProductId: id },
    });
  }
  await db.contact.create({
    data: {
      id: ID.contactPlatform,
      businessId: ID.bizPlatform,
      firstName: 'V70F',
      lastName: 'Client',
      email: CUSTOMER_EMAIL,
      emailNormalized: CUSTOMER_EMAIL,
    },
  });
  await db.invoice.create({
    data: {
      id: ID.invPlatformControl,
      businessId: ID.bizPlatform,
      contactId: ID.contactPlatform,
      invoiceNumber: `${P}INV-CTRL-1`,
      status: 'SENT',
      currency: 'USD',
      subtotal: ORDER_TOTAL,
      total: ORDER_TOTAL,
      items: {
        create: [{ id: `${P}inv_ctrl_item`, description: 'V70F control item', quantity: 1, unitPrice: ORDER_TOTAL, total: ORDER_TOTAL }],
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await settle();
  if (app) await app.close();
  if (db) await cleanup();
  await clearRateLimits();
  if (redis) await redis.quit();
  for (const [k, v] of Object.entries(PREVIOUS_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  Object.assign(process.env, PLATFORM_STRIPE);
  seen = [];
  expenses = [];
  requests = [];
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = new Headers(init?.headers ?? {});
    const body = typeof init?.body === 'string' ? init.body : '';
    requests.push({ host: url.host, path: url.pathname, authorization: headers.get('authorization'), body });
    if (url.host === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessionSeq += 1;
      return new Response(JSON.stringify({ id: `${P}cs_api_${stripeSessionSeq}`, url: STRIPE_REDIRECT }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected outbound fetch in v70f_: ${url.toString()}`);
  });
});

afterEach(async () => {
  await settle();
  fetchSpy?.mockRestore();
});

describe('W1F-STORE-STRIPE-R0 (D-196 storestripe, D-138): platform Stripe signature never settles or refunds a store order; store refunds map to their order', () => {
  it('SS-01: platform STRIPE_WEBHOOK_SECRET is refused (400) on POST /payments/stripe/webhook for store orders (keyless store AND own-key store) across session, async session, payment_intent, and charge events; nothing recorded, no claim, one refusal row (retry adds none)', async () => {
    const orderPlatform = await seedOrder(ID.bizPlatform, ID.prodPlatform);
    const orderOwn = await seedOrder(ID.bizOwn, ID.prodOwn);

    const attempts: Array<{ label: string; orderId: string; businessId: string; event: Record<string, unknown> }> = [
      {
        label: 'keyless checkout.session.completed',
        orderId: orderPlatform,
        businessId: ID.bizPlatform,
        event: storeSessionEvent(`${P}evt_ss01_plat_cs`, `${P}cs_ss01_plat`, orderPlatform, ID.bizPlatform, {
          paymentIntent: `${P}pi_ss01_plat`,
        }),
      },
      {
        label: 'keyless checkout.session.async_payment_succeeded',
        orderId: orderPlatform,
        businessId: ID.bizPlatform,
        event: storeSessionEvent(`${P}evt_ss01_plat_async`, `${P}cs_ss01_plat_a`, orderPlatform, ID.bizPlatform, {
          type: 'checkout.session.async_payment_succeeded',
        }),
      },
      {
        label: 'keyless payment_intent.succeeded (metadata.orderId only)',
        orderId: orderPlatform,
        businessId: ID.bizPlatform,
        event: {
          id: `${P}evt_ss01_plat_pi`,
          object: 'event',
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: `${P}pi_ss01_plat_only`,
              object: 'payment_intent',
              amount_received: ORDER_TOTAL * 100,
              currency: 'usd',
              metadata: { orderId: orderPlatform, businessId: ID.bizPlatform, type: 'store_order' },
            },
          },
        },
      },
      {
        label: 'keyless charge.succeeded (metadata.orderId only)',
        orderId: orderPlatform,
        businessId: ID.bizPlatform,
        event: {
          id: `${P}evt_ss01_plat_ch`,
          object: 'event',
          type: 'charge.succeeded',
          data: {
            object: {
              id: `${P}ch_ss01_plat_only`,
              object: 'charge',
              amount: ORDER_TOTAL * 100,
              currency: 'usd',
              metadata: { orderId: orderPlatform, businessId: ID.bizPlatform, type: 'store_order' },
            },
          },
        },
      },
      {
        label: 'own-key checkout.session.completed',
        orderId: orderOwn,
        businessId: ID.bizOwn,
        event: storeSessionEvent(`${P}evt_ss01_own_cs`, `${P}cs_ss01_own`, orderOwn, ID.bizOwn),
      },
    ];

    for (const a of attempts) {
      const res = await postStripeDoor(a.event, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
      expect(res.status, `${a.label}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body, a.label).toMatchObject({ message: 'Stripe event does not match the order' });
      expect(await db.webhookEvent.count({ where: { provider: 'stripe', providerEventId: String(a.event.id) } }), `${a.label}: no dedupe claim`).toBe(0);
      const refusals = await db.webhookEvent.findMany({ where: { provider: 'stripe-refused', providerEventId: String(a.event.id) } });
      expect(refusals, `${a.label}: one refusal row`).toHaveLength(1);
      expect(refusals[0], a.label).toMatchObject({ businessId: a.businessId, eventType: `${String(a.event.type)}:business` });
    }

    // Retry of the first refused event keeps no second refusal row.
    const retry = await postStripeDoor(attempts[0].event, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
    expect(retry.status).toBe(400);
    expect(
      await db.webhookEvent.count({ where: { provider: 'stripe-refused', providerEventId: String(attempts[0].event.id) } }),
    ).toBe(1);

    expect(await orderState(orderPlatform)).toBe('PENDING/UNPAID/');
    expect(await orderState(orderOwn)).toBe('PENDING/UNPAID/');
    expect(await orderBooks(orderPlatform)).toEqual({ order: 'PENDING/UNPAID', invoice: null, payments: [], postings: [] });
    expect(await orderBooks(orderOwn)).toEqual({ order: 'PENDING/UNPAID', invoice: null, payments: [], postings: [] });
  });

  it('SS-02: platform STRIPE_WEBHOOK_SECRET is refused (400) on legacy POST /webhooks/stripe for store orders (both keyless and own-key stores), keeping stripe-legacy-refused; control: platform-signed invoice checkout on POST /webhooks/stripe still settles the invoice once', async () => {
    const orderPlatform = await seedOrder(ID.bizPlatform, ID.prodPlatform);
    const orderOwn = await seedOrder(ID.bizOwn, ID.prodOwn);

    for (const [tag, orderId, businessId] of [
      ['leg_plat', orderPlatform, ID.bizPlatform],
      ['leg_own', orderOwn, ID.bizOwn],
    ] as const) {
      const event = storeSessionEvent(`${P}evt_${tag}`, `${P}cs_${tag}`, orderId, businessId);
      const res = await postStripeLegacy(event, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
      expect(res.status, `${tag}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(await db.webhookEvent.count({ where: { provider: 'stripe', providerEventId: `${P}evt_${tag}` } })).toBe(0);
      const kept = await db.webhookEvent.findMany({ where: { provider: 'stripe-legacy-refused', providerEventId: `${P}evt_${tag}` } });
      expect(kept, `${tag}: one legacy refusal row`).toHaveLength(1);
      expect(kept[0]).toMatchObject({ businessId, eventType: 'checkout.session.completed:business' });
      expect(await orderState(orderId)).toBe('PENDING/UNPAID/');
    }

    // Control: a regular invoice of bizPlatform still settles via platform signature on legacy POST /webhooks/stripe.
    const invEvt = {
      id: `${P}evt_ss02_inv_ctrl`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `${P}cs_ss02_inv_ctrl`,
          object: 'checkout.session',
          client_reference_id: ID.invPlatformControl,
          metadata: { invoiceId: ID.invPlatformControl, businessId: ID.bizPlatform },
          payment_intent: `${P}pi_ss02_inv_ctrl`,
          amount_total: ORDER_TOTAL * 100,
          currency: 'usd',
          payment_status: 'paid',
        },
      },
    };
    const invRes = await postStripeLegacy(invEvt, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
    expect(invRes.status, JSON.stringify(invRes.body)).toBe(201);
    expect(invRes.body).toMatchObject({ ok: true, received: true, processed: 'checkout.session.completed', deprecated: true });
    const invAfter = await db.invoice.findUnique({ where: { id: ID.invPlatformControl } });
    expect(invAfter.status).toBe('PAID');
  });

  it("SS-03: store's own Stripe webhook secret settles its store order cleanly on POST /payments/stripe/webhook and stashes payment_intent in Payment.reference; redelivery is a no-op; another store's secret is refused 400", async () => {
    const orderId = await seedOrder(ID.bizOwn, ID.prodOwn);
    const sessionId = `${P}cs_ss03_ok`;
    const piId = `${P}pi_ss03_ok`;
    const event = storeSessionEvent(`${P}evt_ss03_ok`, sessionId, orderId, ID.bizOwn, { paymentIntent: piId });

    // Cross-store secret is refused 400.
    const wrong = await postStripeDoor(event, OTHER_STRIPE.stripeWebhookSecret);
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(400);
    expect(await orderState(orderId)).toBe('PENDING/UNPAID/');

    // Store's own secret settles cleanly.
    const res = await postStripeDoor(event, OWN_STRIPE.stripeWebhookSecret);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ ok: true, received: true, processed: 'checkout.session.completed' });
    expect(await orderState(orderId)).toBe(`CONFIRMED/PAID/${sessionId}`);
    expect(await orderBooks(orderId)).toEqual({
      order: 'CONFIRMED/PAID',
      invoice: 'PAID',
      payments: [
        {
          provider: 'stripe',
          providerPaymentId: sessionId,
          reference: piId,
          status: 'SUCCESSFUL',
          amount: ORDER_TOTAL,
          businessId: ID.bizOwn,
        },
      ],
      postings: [`INCOME:POSTED:${ORDER_TOTAL}`],
    });

    // Redelivery writes nothing new.
    const again = await postStripeDoor(event, OWN_STRIPE.stripeWebhookSecret);
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ ok: true, received: true });
    expect((await orderBooks(orderId)).payments).toHaveLength(1);
  });

  it('SS-04: createStorePayment attaches payment_intent_data.metadata (orderId and businessId) on both public storefront checkout and generic POST /payments/create-checkout', async () => {
    await clearRateLimits();
    const pub = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.own)}/checkout`)
      .send({
        items: [{ productId: ID.prodOwn, quantity: QUANTITY }],
        customer: { name: 'V70F Buyer', email: CUSTOMER_EMAIL },
        paymentMethod: 'STRIPE',
        returnUrl: RETURN_URL,
      });
    await settle();
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const pubOrderId: string = pub.body.order.id;

    const genericOrderId = await seedOrder(ID.bizOwn, ID.prodOwn);
    await clearRateLimits();
    const gen = await agent()
      .post('/payments/create-checkout')
      .send({ payableType: 'storefront_order', payableId: genericOrderId, gateway: 'stripe', returnUrl: RETURN_URL });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);

    const stripeCalls = requests.filter((r) => r.host === 'api.stripe.com' && r.path === '/v1/checkout/sessions');
    expect(stripeCalls).toHaveLength(2);
    for (const [idx, expectedOrderId] of [
      [0, pubOrderId],
      [1, genericOrderId],
    ] as const) {
      expect(stripeCalls[idx].authorization).toBe(`Bearer ${OWN_STRIPE.stripeSecretKey}`);
      const params = new URLSearchParams(stripeCalls[idx].body);
      expect(params.get('metadata[orderId]')).toBe(expectedOrderId);
      expect(params.get('metadata[businessId]')).toBe(ID.bizOwn);
      expect(params.get('payment_intent_data[metadata][orderId]')).toBe(expectedOrderId);
      expect(params.get('payment_intent_data[metadata][businessId]')).toBe(ID.bizOwn);
    }
  });

  it('SS-05: store-signed charge.refunded (full with refunds.data, and partial + final cumulative without refunds.data) maps directly to its store order instead of 400: records refund row, reverses posting, reopens invoice, updates order status & refundedTotal, emits store_order.refunded once with invoiceId', async () => {
    // (a) Full refund with refunds.data
    const orderFull = await seedOrder(ID.bizOwn, ID.prodOwn);
    const csFull = `${P}cs_ss05_full`;
    const piFull = `${P}pi_ss05_full`;
    const chFull = `${P}ch_ss05_full`;
    const reFull = `${P}re_ss05_full`;
    const settleFull = await postStripeDoor(
      storeSessionEvent(`${P}evt_ss05_full_pay`, csFull, orderFull, ID.bizOwn, { paymentIntent: piFull }),
      OWN_STRIPE.stripeWebhookSecret,
    );
    expect(settleFull.status, JSON.stringify(settleFull.body)).toBe(201);
    seen = [];
    expenses = [];

    const fullRefundEvent = {
      id: `${P}evt_ss05_full_ref`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: chFull,
          object: 'charge',
          payment_intent: piFull,
          amount: ORDER_TOTAL * 100,
          amount_refunded: ORDER_TOTAL * 100,
          currency: 'usd',
          metadata: { orderId: orderFull, businessId: ID.bizOwn, type: 'store_order' },
          refunds: {
            data: [
              {
                id: reFull,
                amount: ORDER_TOTAL * 100,
                currency: 'usd',
                charge: chFull,
                payment_intent: piFull,
                status: 'succeeded',
                reason: 'requested_by_customer',
              },
            ],
          },
        },
      },
    };
    const resFull = await postStripeDoor(fullRefundEvent, OWN_STRIPE.stripeWebhookSecret);
    expect(resFull.status, JSON.stringify(resFull.body)).toBe(201);
    expect(resFull.body).toEqual({ ok: true, received: true, processed: 'charge.refunded' });

    const booksFull = await orderBooks(orderFull);
    expect(booksFull).toEqual({
      order: 'REFUNDED/REFUNDED',
      invoice: 'SENT',
      payments: [
        {
          provider: 'stripe',
          providerPaymentId: csFull,
          reference: piFull,
          status: 'SUCCESSFUL',
          amount: ORDER_TOTAL,
          businessId: ID.bizOwn,
        },
        {
          provider: 'stripe',
          providerPaymentId: reFull,
          reference: csFull,
          status: 'REFUNDED',
          amount: -ORDER_TOTAL,
          businessId: ID.bizOwn,
        },
      ],
      postings: [`INCOME:REVERSED:${ORDER_TOTAL}`, `REVERSAL:POSTED:${ORDER_TOTAL}`],
    });
    expect(await orderRefundMeta(orderFull)).toEqual({
      refundedTotal: ORDER_TOTAL,
      steps: [`refunded:${ORDER_TOTAL}:${ORDER_TOTAL}:stripe:${reFull}`],
    });
    expect(seen).toEqual(['store_order.refunded']);
    expect(expenses, 'store_order.refunded carries invoiceId so no duplicate Expense is booked').toEqual([]);

    // Redelivery is a no-op.
    seen = [];
    const againFull = await postStripeDoor(fullRefundEvent, OWN_STRIPE.stripeWebhookSecret);
    expect(againFull.status).toBe(201);
    expect(againFull.body).toEqual({ ok: true, received: true });
    expect(await orderBooks(orderFull)).toEqual(booksFull);
    expect(seen).toEqual([]);

    // (b) Partial then final cumulative charge.refunded (no refunds.data, Stripe API >= 2022-11-15)
    const orderPart = await seedOrder(ID.bizOwn, ID.prodOwn);
    const csPart = `${P}cs_ss05_part`;
    const piPart = `${P}pi_ss05_part`;
    const chPart = `${P}ch_ss05_part`;
    const settlePart = await postStripeDoor(
      storeSessionEvent(`${P}evt_ss05_part_pay`, csPart, orderPart, ID.bizOwn, { paymentIntent: piPart }),
      OWN_STRIPE.stripeWebhookSecret,
    );
    expect(settlePart.status).toBe(201);
    seen = [];

    const part1 = await postStripeDoor(
      {
        id: `${P}evt_ss05_part_ref1`,
        object: 'event',
        type: 'charge.refunded',
        data: {
          object: {
            id: chPart,
            object: 'charge',
            payment_intent: piPart,
            amount: ORDER_TOTAL * 100,
            amount_refunded: 3000,
            currency: 'usd',
            metadata: { orderId: orderPart, businessId: ID.bizOwn, type: 'store_order' },
          },
        },
      },
      OWN_STRIPE.stripeWebhookSecret,
    );
    expect(part1.status, JSON.stringify(part1.body)).toBe(201);
    expect(await orderBooks(orderPart)).toMatchObject({ order: 'CONFIRMED/PAID', invoice: 'PARTIALLY_PAID' });
    expect((await orderRefundMeta(orderPart)).refundedTotal).toBe(30);
    expect(seen).toEqual([]);

    const part2 = await postStripeDoor(
      {
        id: `${P}evt_ss05_part_ref2`,
        object: 'event',
        type: 'charge.refunded',
        data: {
          object: {
            id: chPart,
            object: 'charge',
            payment_intent: piPart,
            amount: ORDER_TOTAL * 100,
            amount_refunded: ORDER_TOTAL * 100,
            currency: 'usd',
            metadata: { orderId: orderPart, businessId: ID.bizOwn, type: 'store_order' },
          },
        },
      },
      OWN_STRIPE.stripeWebhookSecret,
    );
    expect(part2.status, JSON.stringify(part2.body)).toBe(201);
    expect(await orderBooks(orderPart)).toMatchObject({ order: 'REFUNDED/REFUNDED', invoice: 'SENT' });
    expect((await orderRefundMeta(orderPart)).refundedTotal).toBe(ORDER_TOTAL);
    expect(seen).toEqual(['store_order.refunded']);
  });

  it('SS-06: platform-signed charge.refunded and refund.created targeting a store order (with or without metadata.orderId) are refused (400) on BOTH POST /payments/stripe/webhook and POST /webhooks/stripe; cross-store signed charge.refunded is also refused 400; order, invoice, payment and ledger stay untouched', async () => {
    const orderId = await seedOrder(ID.bizOwn, ID.prodOwn);
    const csId = `${P}cs_ss06`;
    const piId = `${P}pi_ss06`;
    const chId = `${P}ch_ss06`;
    const settleRes = await postStripeDoor(
      storeSessionEvent(`${P}evt_ss06_pay`, csId, orderId, ID.bizOwn, { paymentIntent: piId }),
      OWN_STRIPE.stripeWebhookSecret,
    );
    expect(settleRes.status).toBe(201);
    const paidBooks = await orderBooks(orderId);
    seen = [];

    const chargeWithMeta = {
      id: `${P}evt_ss06_plat_meta`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: chId,
          object: 'charge',
          payment_intent: piId,
          amount: ORDER_TOTAL * 100,
          amount_refunded: ORDER_TOTAL * 100,
          currency: 'usd',
          metadata: { orderId, businessId: ID.bizOwn, type: 'store_order' },
          refunds: {
            data: [{ id: `${P}re_ss06_plat_meta`, amount: ORDER_TOTAL * 100, currency: 'usd', charge: chId, payment_intent: piId, status: 'succeeded' }],
          },
        },
      },
    };
    const chargeNoMeta = {
      id: `${P}evt_ss06_plat_nometa`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: chId,
          object: 'charge',
          payment_intent: piId,
          amount: ORDER_TOTAL * 100,
          amount_refunded: ORDER_TOTAL * 100,
          currency: 'usd',
          metadata: {},
          refunds: {
            data: [{ id: `${P}re_ss06_plat_nometa`, amount: ORDER_TOTAL * 100, currency: 'usd', charge: chId, payment_intent: piId, status: 'succeeded' }],
          },
        },
      },
    };
    const refundCreated = {
      id: `${P}evt_ss06_plat_rc`,
      object: 'event',
      type: 'refund.created',
      data: {
        object: {
          id: `${P}re_ss06_plat_rc`,
          object: 'refund',
          amount: ORDER_TOTAL * 100,
          currency: 'usd',
          charge: chId,
          payment_intent: piId,
          status: 'succeeded',
        },
      },
    };

    for (const [label, evt] of [
      ['door charge.refunded with orderId', chargeWithMeta],
      ['door charge.refunded without orderId', chargeNoMeta],
      ['door refund.created', refundCreated],
    ] as const) {
      const r = await postStripeDoor(evt, PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET);
      expect(r.status, `${label}: ${JSON.stringify(r.body)}`).toBe(400);
      expect(await db.webhookEvent.count({ where: { provider: 'stripe', providerEventId: evt.id } }), `${label}: no claim`).toBe(0);
      expect(
        await db.webhookEvent.count({ where: { provider: 'stripe-refused', providerEventId: evt.id, businessId: ID.bizOwn } }),
        `${label}: one refusal row`,
      ).toBe(1);
    }

    // Legacy POST /webhooks/stripe also refuses platform-signed refund of a store order.
    const legRef = await postStripeLegacy(
      { ...chargeWithMeta, id: `${P}evt_ss06_leg_meta` },
      PLATFORM_STRIPE.STRIPE_WEBHOOK_SECRET,
    );
    expect(legRef.status, JSON.stringify(legRef.body)).toBe(400);
    expect(
      await db.webhookEvent.count({ where: { provider: 'stripe-legacy-refused', providerEventId: `${P}evt_ss06_leg_meta`, businessId: ID.bizOwn } }),
    ).toBe(1);

    // Cross-store secret signing charge.refunded naming bizOwn's order is refused 400.
    const crossStore = await postStripeDoor(
      { ...chargeWithMeta, id: `${P}evt_ss06_cross` },
      OTHER_STRIPE.stripeWebhookSecret,
    );
    expect(crossStore.status, JSON.stringify(crossStore.body)).toBe(400);

    expect(await orderBooks(orderId), 'books completely untouched').toEqual(paidBooks);
    expect(await orderRefundMeta(orderId)).toEqual({ refundedTotal: null, steps: [] });
    expect(seen).toEqual([]);
  });
});
