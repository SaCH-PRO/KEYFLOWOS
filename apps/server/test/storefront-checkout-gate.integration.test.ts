/**
 * WEDGE-HIDE-STORE-SERVER (P233; D-263, D-300, D-304, D-305):
 *   - GET /site/storefront/public/:slug returns `storeCheckout: boolean`, true only when
 *     LegacyModulesService.getLegacyModules(businessId).includes('store') over part 1's
 *     unfiltered `store` key (marketplace_orders: standard orders, QS- quick sales, cancelled orders).
 *   - POST /site/storefront/public/:slug/checkout refuses with 403 STORE_CHECKOUT_NOT_OFFERED
 *     before any write when `storeCheckout !== true`.
 *   - Public products read (GET /commerce/public/businesses/:id/products and GET /site/storefront/public/:slug
 *     products array) and bookings (GET /bookings/public/businesses/:id/services) are unchanged (D-304).
 *
 * REAL Postgres (DATABASE_URL), REAL Redis (REDIS_URL), REAL SiteController, SiteService,
 * LegacyModulesService, StoreOrderService, PromoCodeService, CommerceController, CommerceService,
 * BookingsController, BookingsService, PublicRateLimitGuard, ValidationPipe, GlobalHttpExceptionFilter.
 *
 *   WHS-S01  RED-BEFORE: GET /site/storefront/public/:slug returns storeCheckout === true for bizStore,
 *            bizQuick (QS- cash quick sale, D-305), and bizCancelled (cancelled order)
 *   WHS-S02  RED-BEFORE: GET /site/storefront/public/:slug returns storeCheckout === false for bizNone
 *            (0 orders; bizOther's order never leaks), while still listing its products & services (D-304)
 *   WHS-S03  CONTROL (D-304): GET /commerce/public/businesses/:id/products still returns bizNone's active product
 *   WHS-S04  RED-BEFORE: POST /site/storefront/public/:slug/checkout on bizNone refuses 403
 *            STORE_CHECKOUT_NOT_OFFERED before ANY write (0 orders, 0 items, 0 idempotency_keys,
 *            promo currentUses unchanged, 0 contacts, 0 payment sessions)
 *   WHS-S05  CONTROL: POST /site/storefront/public/:slug/checkout on bizStore, bizQuick (D-305),
 *            and bizCancelled succeeds (201) and creates the order
 *   WHS-S06  CONTROL: storeEnabled=false (even with prior order) and unknown slug return 404 on GET & POST
 *   WHS-S07  CONTROL: GET /bookings/public/businesses/:id/services for bizNone is untouched
 *
 * FIXTURES: prefix `v92g_` (test/helpers/fixture-prefixes.json), cleaned by raw SQL in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92g_';
const RATE_LIMIT_NS = `${P}rl`;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`,
  ownerOther: `${P}ownerOther`,
  bizStore: `${P}bizStore`,
  bizQuick: `${P}bizQuick`,
  bizCancelled: `${P}bizCancelled`,
  bizNone: `${P}bizNone`,
  bizOff: `${P}bizOff`,
  bizOther: `${P}bizOther`,
  prodStore: `${P}prodStore`,
  prodQuick: `${P}prodQuick`,
  prodCancelled: `${P}prodCancelled`,
  prodNone: `${P}prodNone`,
  svcListingStore: `${P}svcLStore`,
  svcListingQuick: `${P}svcLQuick`,
  svcListingCancelled: `${P}svcLCancel`,
  svcListingNone: `${P}svcLNone`,
  svcNone: `${P}svcNone`,
  promoNone: `${P}promoNone`,
};

const SLUG = {
  store: `${P}store`,
  quick: `${P}quick`,
  cancelled: `${P}cancelled`,
  none: `${P}none`,
  off: `${P}off`,
  unknown: `${P}no-such-slug`,
};

let db: any;
let app: any;
let redis: any;
let siteService: any;
let legacyModulesService: any;
const crmContactCalls: Array<{ businessId: string; email?: string }> = [];
const createStorePaymentCalls: Array<Record<string, unknown>> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM promo_codes WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
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
  if (!redis) return;
  const keys: string[] = await redis.keys(`pub_rate_limit:${RATE_LIMIT_NS}:*`);
  if (keys.length) await redis.del(...keys);
}

function agent() {
  return request(app.getHttpServer());
}

async function seedOrder(id: string, businessId: string, orderNumber: string, status = 'placed') {
  await db.marketplaceOrder.create({
    data: {
      id,
      businessId,
      orderNumber,
      status,
      customerName: `${P}Prior Buyer`,
      total: 100,
      subtotal: 100,
      currency: 'TTD',
    },
  });
}

async function seedListedProduct(bizId: string, prodId: string, svcId: string, name: string) {
  await db.product.create({
    data: {
      id: prodId,
      businessId: bizId,
      name,
      price: 100,
      currency: 'TTD',
      category: 'PHYSICAL',
      isActive: true,
      inventoryMode: 'UNLIMITED',
    },
  });
  await db.service.create({
    data: {
      id: svcId,
      businessId: bizId,
      name,
      price: 100,
      duration: 0,
      sourceProductId: prodId,
    },
  });
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? '', 'DATABASE_URL must name the test database').not.toBe('');
  db = (await import('@keyflow/db')).db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { LegacyModulesService } = await import('../src/modules/identity/legacy-modules.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
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

  redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const allowAll = { canActivate: () => true };
  const noop = {};

  const mod = await Test.createTestingModule({
    controllers: [CommerceController, BookingsController, SiteController],
    providers: [
      { provide: PrismaService, useValue: { client: db } },
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: REDIS_CLIENT, useValue: redis },
      PublicRateLimitGuard,
      LegacyModulesService,
      CatalogService,
      CommerceService,
      SiteService,
      StoreOrderService,
      PromoCodeService,
      BookingsService,
      { provide: CommerceStatsService, useValue: noop },
      { provide: InvoiceWorkflowService, useValue: noop },
      { provide: InvoiceReceiptBuilderService, useValue: noop },
      { provide: GmailService, useValue: noop },
      { provide: CommerceVisionService, useValue: noop },
      { provide: StoreReadinessService, useValue: noop },
      { provide: PaymentEvidenceService, useValue: noop },
      { provide: InventoryRiskService, useValue: noop },
      { provide: TimeEntryService, useValue: noop },
      { provide: PublicEventsService, useValue: noop },
      {
        provide: CrmService,
        useValue: {
          findOrCreateContact: async (businessId: string, data?: { email?: string }) => {
            crmContactCalls.push({ businessId, email: data?.email });
            return { id: `${P}ct_stub` };
          },
        },
      },
      { provide: RevenuePostingService, useValue: noop },
      { provide: ExpensePostingService, useValue: noop },
      { provide: BookingWaitlistService, useValue: noop },
      { provide: CalendarService, useValue: noop },
      { provide: BookingOptimizerService, useValue: noop },
      { provide: RevenueAttributionService, useValue: noop },
      { provide: TransactionalEmailService, useValue: noop },
      { provide: TimelineService, useValue: noop },
      { provide: IntakeService, useValue: noop },
      { provide: QualificationService, useValue: noop },
      { provide: StorefrontConversionService, useValue: noop },
      { provide: CustomerReferralService, useValue: noop },
      { provide: CaseStudyService, useValue: noop },
      {
        provide: PaymentsService,
        useValue: {
          createStorePayment: async (args: Record<string, unknown>) => {
            createStorePaymentCalls.push(args);
            return { url: 'https://payments.test.local/session' };
          },
          getStorefrontGateways: async () => [
            { id: 'cash', name: 'Cash on Delivery', currencies: ['TTD'] },
          ],
        },
      },
      { provide: AiUsageService, useValue: noop },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true, current: 0, limit: -1 }) } },
    ],
  })
    .overrideGuard(AuthGuard)
    .useValue(allowAll)
    .overrideGuard(BusinessGuard)
    .useValue(allowAll)
    .overrideGuard(ModuleScopeGuard)
    .useValue(allowAll)
    .overrideGuard(PlanLimitGuard)
    .useValue(allowAll)
    .overrideGuard(HoneypotGuard)
    .useValue(allowAll)
    .compile();

  siteService = mod.get(SiteService);
  legacyModulesService = mod.get(LegacyModulesService);
  app = mod.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  await clearRateLimits();

  for (const id of [ID.owner, ID.ownerOther]) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@v92g.test.local`, name: `${id} Name`, role: 'USER' },
    });
  }

  for (const [id, ownerId, slug, storeEnabled] of [
    [ID.bizStore, ID.owner, SLUG.store, true],
    [ID.bizQuick, ID.owner, SLUG.quick, true],
    [ID.bizCancelled, ID.owner, SLUG.cancelled, true],
    [ID.bizNone, ID.owner, SLUG.none, true],
    [ID.bizOff, ID.owner, SLUG.off, false],
    [ID.bizOther, ID.ownerOther, `${P}other`, true],
  ] as const) {
    await db.business.create({
      data: { id, name: `${id} Business`, ownerId, slug, storeEnabled, currency: 'TTD' },
    });
    await db.membership.create({
      data: { id: `${P}m_${id.slice(P.length)}`, userId: ownerId, businessId: id, role: 'OWNER' },
    });
  }

  await seedOrder(`${P}o_store`, ID.bizStore, `${P}ORD-1001`, 'placed');
  await seedOrder(`${P}o_quick`, ID.bizQuick, `QS-${P.toUpperCase()}01-ABC123`, 'completed');
  await seedOrder(`${P}o_cancel`, ID.bizCancelled, `${P}ORD-1002`, 'cancelled');
  await seedOrder(`${P}o_off`, ID.bizOff, `${P}ORD-1003`, 'placed');
  await seedOrder(`${P}o_other`, ID.bizOther, `${P}ORD-1004`, 'placed');

  await seedListedProduct(ID.bizStore, ID.prodStore, ID.svcListingStore, 'Store Candle');
  await seedListedProduct(ID.bizQuick, ID.prodQuick, ID.svcListingQuick, 'Quick Sale Tea');
  await seedListedProduct(ID.bizCancelled, ID.prodCancelled, ID.svcListingCancelled, 'Cancelled Legacy Mug');
  await seedListedProduct(ID.bizNone, ID.prodNone, ID.svcListingNone, 'Launch Showcase Product');

  await db.service.create({
    data: {
      id: ID.svcNone,
      businessId: ID.bizNone,
      name: 'Consultation Session',
      price: 250,
      duration: 60,
    },
  });

  await db.promoCode.create({
    data: {
      id: ID.promoNone,
      businessId: ID.bizNone,
      code: 'LAUNCH10',
      type: 'PERCENT',
      value: 10,
      maxUses: 5,
      currentUses: 0,
      active: true,
    },
  });
});

beforeEach(async () => {
  crmContactCalls.length = 0;
  createStorePaymentCalls.length = 0;
  await clearRateLimits();
});

afterAll(async () => {
  await clearRateLimits();
  if (PREVIOUS_RATE_LIMIT_NS === undefined) {
    delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  } else {
    process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
  }
  await app?.close();
  await cleanup();
  await redis?.quit();
});

describe('P233 WEDGE-HIDE-STORE-SERVER: storeCheckout flag and server-side checkout refusal', () => {
  it('[WHS-S01] RED-BEFORE: GET /site/storefront/public/:slug returns storeCheckout: true for standard order, quick sale (D-305), and cancelled order', async () => {
    for (const [label, slug] of [
      ['standard store order', SLUG.store],
      ['quick sale (QS-) only (D-305)', SLUG.quick],
      ['cancelled order only', SLUG.cancelled],
    ] as const) {
      const res = await agent().get(`/site/storefront/public/${encodeURIComponent(slug)}`);
      expect(res.status, `${label}: ${res.text}`).toBe(200);
      expect(res.body.storeCheckout, `${label}: strict boolean true`).toBe(true);
    }
  });

  it('[WHS-S02] RED-BEFORE: GET /site/storefront/public/:slug returns storeCheckout: false for a business with no orders (other tenant orders never leak), while preserving listed products and services (D-304)', async () => {
    const res = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.none)}`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.storeCheckout, 'strict boolean false').toBe(false);
    expect(res.body.products.map((p: any) => p.id)).toEqual([ID.prodNone]);
    expect(res.body.services.map((s: any) => s.id)).toEqual([ID.svcNone]);
  });

  it('[WHS-S03] CONTROL (D-304): GET /commerce/public/businesses/:id/products is unchanged for a business without storeCheckout', async () => {
    const res = await agent().get(`/commerce/public/businesses/${encodeURIComponent(ID.bizNone)}/products`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.map((p: any) => p.id)).toEqual([ID.prodNone]);
  });

  it('[WHS-S04] RED-BEFORE: POST /site/storefront/public/:slug/checkout refuses 403 STORE_CHECKOUT_NOT_OFFERED before any write when storeCheckout is false', async () => {
    const basePayload = {
      items: [{ productId: ID.prodNone, quantity: 1 }],
      customer: { name: 'Blocked Buyer', email: `${P}blocked@v92g.test.local` },
      promoCode: 'LAUNCH10',
    };

    const cashWithHeaderKey = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/checkout`)
      .set('Idempotency-Key', `${P}idem-header-1`)
      .send({ ...basePayload, paymentMethod: 'CASH' });
    expect(cashWithHeaderKey.status, cashWithHeaderKey.text).toBe(403);
    expect(cashWithHeaderKey.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');

    const cashWithBodyKey = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/checkout`)
      .send({ ...basePayload, paymentMethod: 'CASH', idempotencyKey: `${P}idem-body-1` });
    expect(cashWithBodyKey.status, cashWithBodyKey.text).toBe(403);
    expect(cashWithBodyKey.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');

    const omittedMethod = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/checkout`)
      .send(basePayload);
    expect(omittedMethod.status, omittedMethod.text).toBe(403);
    expect(omittedMethod.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');

    const invalidMethod = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/checkout`)
      .send({ ...basePayload, paymentMethod: 'BITCOIN_FAKE' });
    expect(invalidMethod.status, invalidMethod.text).toBe(403);
    expect(invalidMethod.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');

    // Verify ZERO writes occurred across every side-effect surface.
    const orderCount = await db.marketplaceOrder.count({ where: { businessId: ID.bizNone } });
    const itemCount = await db.marketplaceOrderItem.count({ where: { productId: ID.prodNone } });
    const retryCount = await db.idempotencyKey.count({ where: { businessId: ID.bizNone } });
    const promo = await db.promoCode.findUnique({ where: { id: ID.promoNone }, select: { currentUses: true } });

    expect(orderCount, 'no marketplace_orders row written').toBe(0);
    expect(itemCount, 'no marketplace_order_items row written').toBe(0);
    expect(retryCount, 'no idempotency_keys slot written').toBe(0);
    expect(promo?.currentUses, 'promo currentUses unchanged').toBe(0);
    expect(crmContactCalls, 'no CRM contact created').toEqual([]);
    expect(createStorePaymentCalls, 'no payment session started').toEqual([]);
  });

  it('[WHS-S05] CONTROL: POST /site/storefront/public/:slug/checkout succeeds (201) for bizStore, bizQuick (D-305), and bizCancelled', async () => {
    for (const [label, slug, productId] of [
      ['standard store order', SLUG.store, ID.prodStore],
      ['quick sale (D-305)', SLUG.quick, ID.prodQuick],
      ['cancelled order', SLUG.cancelled, ID.prodCancelled],
    ] as const) {
      const res = await agent()
        .post(`/site/storefront/public/${encodeURIComponent(slug)}/checkout`)
        .send({
          items: [{ productId, quantity: 1 }],
          customer: { name: 'Legacy Buyer', email: `${P}${label.replace(/[^a-z]/g, '')}@v92g.test.local` },
          paymentMethod: 'CASH',
        });
      expect(res.status, `${label}: ${res.text}`).toBe(201);
      expect(res.body?.order?.id).toBeTruthy();
    }
  });

  it('[WHS-S06] CONTROL: storeEnabled=false (even with a prior order) and unknown slug return 404 on GET and POST', async () => {
    for (const slug of [SLUG.off, SLUG.unknown]) {
      const getRes = await agent().get(`/site/storefront/public/${encodeURIComponent(slug)}`);
      expect(getRes.status, `${slug} GET`).toBe(404);

      const postRes = await agent()
        .post(`/site/storefront/public/${encodeURIComponent(slug)}/checkout`)
        .send({
          items: [{ productId: ID.prodNone, quantity: 1 }],
          customer: { name: 'Visitor', email: `${P}v@v92g.test.local` },
          paymentMethod: 'CASH',
        });
      expect(postRes.status, `${slug} POST`).toBe(404);
    }
  });

  it('[WHS-S07] CONTROL: public bookings services read for bizNone is untouched', async () => {
    const res = await agent().get(`/bookings/public/businesses/${encodeURIComponent(ID.bizNone)}/services`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.map((s: any) => s.id)).toEqual([ID.svcNone]);
  });

  it('[WHS-S08] RED-BEFORE (P248): legacy-modules failure is caught, logged, fails closed to storeCheckout: false, and never 500s GET, /gateways, /validate-promo, or /checkout', async () => {
    // Baseline snapshot of bizNone when legacy read succeeds (so we assert the rest of the response is unchanged).
    const baselineNone = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.none)}`);
    expect(baselineNone.status, baselineNone.text).toBe(200);
    expect(baselineNone.body.storeCheckout).toBe(false);

    const storeOrdersBefore = await db.marketplaceOrder.count({ where: { businessId: ID.bizStore } });
    const storeRetryBefore = await db.idempotencyKey.count({ where: { businessId: ID.bizStore } });

    for (const [mode, setupMock] of [
      ['async rejection', () => vi.spyOn(legacyModulesService, 'getLegacyModules').mockRejectedValue(new Error('legacy read timeout'))],
      ['sync throw', () => vi.spyOn(legacyModulesService, 'getLegacyModules').mockImplementation(() => { throw new Error('legacy read sync failure'); })],
    ] as const) {
      const legacySpy = setupMock();
      const warnSpy = vi.spyOn((siteService as any).logger, 'warn').mockImplementation(() => undefined);
      try {
        // 1. Booking-only / non-store business: 200 with storeCheckout: false and identical payload.
        const getNone = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.none)}`);
        expect(getNone.status, `${mode} GET bizNone: ${getNone.text}`).toBe(200);
        expect(getNone.body).toEqual(baselineNone.body);

        // 2. Legacy store business: 200 with storeCheckout failed closed to false (products still intact).
        const getStore = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.store)}`);
        expect(getStore.status, `${mode} GET bizStore: ${getStore.text}`).toBe(200);
        expect(getStore.body.storeCheckout, `${mode} storeCheckout failed closed`).toBe(false);
        expect(getStore.body.business?.id).toBe(ID.bizStore);
        expect(getStore.body.products.map((p: any) => p.id)).toEqual([ID.prodStore]);

        // 3. /gateways: 200 (never 500).
        const gatewaysRes = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/gateways?currency=TTD`);
        expect(gatewaysRes.status, `${mode} GET /gateways: ${gatewaysRes.text}`).toBe(200);
        expect(Array.isArray(gatewaysRes.body)).toBe(true);
        expect(gatewaysRes.body.length).toBeGreaterThan(0);

        // 4. /validate-promo: 200 (never 500).
        const promoRes = await agent()
          .post(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/validate-promo`)
          .send({
            code: 'LAUNCH10',
            items: [{ productId: ID.prodNone, quantity: 1 }],
          });
        expect(promoRes.status, `${mode} POST /validate-promo: ${promoRes.text}`).toBe(200);
        expect(promoRes.body.valid).toBe(true);

        // 5. /checkout on legacy store business: fails closed to 403 STORE_CHECKOUT_NOT_OFFERED (never 500, zero writes).
        const checkoutRes = await agent()
          .post(`/site/storefront/public/${encodeURIComponent(SLUG.store)}/checkout`)
          .set('Idempotency-Key', `${P}idem-fail-${mode.replace(/\s+/g, '-')}`)
          .send({
            items: [{ productId: ID.prodStore, quantity: 1 }],
            customer: { name: 'Failsafe Buyer', email: `${P}failsafe@v92g.test.local` },
            paymentMethod: 'CASH',
          });
        expect(checkoutRes.status, `${mode} POST /checkout: ${checkoutRes.text}`).toBe(403);
        expect(checkoutRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');

        // Logger recorded the caught failure with the business id (and not silently swallowed).
        expect(warnSpy).toHaveBeenCalled();
        expect(
          warnSpy.mock.calls.some((args) => String(args[0]).includes(ID.bizNone) && String(args[0]).includes('legacy read')),
          `${mode}: warn log must identify the failed business and error`,
        ).toBe(true);
      } finally {
        legacySpy.mockRestore();
        warnSpy.mockRestore();
      }
    }

    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizStore } })).toBe(storeOrdersBefore);
    expect(await db.idempotencyKey.count({ where: { businessId: ID.bizStore } })).toBe(storeRetryBefore);
    expect(crmContactCalls).toEqual([]);
    expect(createStorePaymentCalls).toEqual([]);
  });

  it('[WHS-S09] PIN (P248): POST /site/storefront/public/:slug/checkout returns 404 before 400 for unknown or closed slug with an unsupported payment method', async () => {
    for (const slug of [SLUG.unknown, SLUG.off]) {
      const res = await agent()
        .post(`/site/storefront/public/${encodeURIComponent(slug)}/checkout`)
        .send({
          items: [{ productId: ID.prodNone, quantity: 1 }],
          customer: { name: 'Bad Method Visitor', email: `${P}badmethod@v92g.test.local` },
          paymentMethod: 'BITCOIN_FAKE',
        });
      expect(res.status, `${slug} unsupported method must 404 before 400: ${res.text}`).toBe(404);
    }

    // Control: on a live legacy store slug, the same unsupported method still returns 400.
    const liveRes = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.store)}/checkout`)
      .send({
        items: [{ productId: ID.prodStore, quantity: 1 }],
        customer: { name: 'Bad Method Legacy Buyer', email: `${P}badmethod-live@v92g.test.local` },
        paymentMethod: 'BITCOIN_FAKE',
      });
    expect(liveRes.status, `live legacy store unsupported method must 400: ${liveRes.text}`).toBe(400);
  });
});
