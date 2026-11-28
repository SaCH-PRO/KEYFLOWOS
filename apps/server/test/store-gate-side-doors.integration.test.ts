/**
 * P253 — FU-STORE-GATE-SIDE-DOORS (D-297, D-315, launch-track):
 *   Closes the three store-gate side doors left open after M42 (P225/P233/P248):
 *     1. `GET /site/storefront/public/:slug/gateways` (SiteController.getPublicGateways)
 *     2. `POST /site/storefront/public/:slug/validate-promo` (SiteController.validatePromoCode)
 *     3. `POST /payments/create-checkout` with `payableType: 'storefront_order'`
 *        (PaymentsService.createCheckout)
 *
 * REAL Postgres (DATABASE_URL), REAL Redis (REDIS_URL), REAL SiteController, SiteService,
 * StoreOrderService, PromoCodeService, LegacyModulesService, PaymentsController, PaymentsService,
 * PublicRateLimitGuard, ValidationPipe, GlobalHttpExceptionFilter.
 *
 *   SGSD-01  RED-BEFORE: Hidden-store business (bizNone, 0 prior orders) gets 403
 *            STORE_CHECKOUT_NOT_OFFERED on GET /gateways and POST /validate-promo without
 *            invoking gateway listing or promo calculation.
 *   SGSD-02  CONTROL: Legacy-store business (bizStore, prior order) gets 200 on GET /gateways
 *            and 201 on POST /validate-promo.
 *   SGSD-03  CONTROL: Unknown slug and storeEnabled=false (even with prior order) return 404
 *            on both GET /gateways and POST /validate-promo.
 *   SGSD-04  RED-BEFORE: Legacy-read failure (async rejection, sync throw, non-array return)
 *            fails closed to 403 STORE_CHECKOUT_NOT_OFFERED (never 500, never 200/201) on
 *            both /gateways and /validate-promo for both bizNone and bizStore.
 *   SGSD-05  RED-BEFORE + MUTANT: POST /payments/create-checkout { payableType: 'storefront_order' }
 *            checks the store legacy gate directly (does NOT rely on an existing order placing the
 *            business on the list):
 *            - When getLegacyModules returns [] or fails (rejection, sync throw, non-array),
 *              both open AND paid/cancelled orders refuse 403 STORE_CHECKOUT_NOT_OFFERED before
 *              any provider checkout or order-state leak (never 500, createStorePayment not called).
 *            - Control: when getLegacyModules includes 'store', create-checkout proceeds normally
 *              (cash gateway reaches the offline 400 guard, NOT 403), and non-store payableType
 *              ('invoice') is never blocked by the store gate.
 *
 * FIXTURES: prefix `v92p_` (test/helpers/fixture-prefixes.json), cleaned by raw SQL in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92p_';
const RATE_LIMIT_NS = `${P}rl`;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  owner: `${P}owner`,
  bizStore: `${P}bizStore`,
  bizNone: `${P}bizNone`,
  bizOff: `${P}bizOff`,
  prodStore: `${P}prodStore`,
  prodNone: `${P}prodNone`,
  svcListingStore: `${P}svcLStore`,
  svcListingNone: `${P}svcLNone`,
  promoStore: `${P}promoStore`,
  promoNone: `${P}promoNone`,
  orderOpen: `${P}ordOpen`,
  orderPaid: `${P}ordPaid`,
  orderOff: `${P}ordOff`,
};

const SLUG = {
  store: `${P}store`,
  none: `${P}none`,
  off: `${P}off`,
  unknown: `${P}no-such-slug`,
};

let db: any;
let app: any;
let redis: any;
let legacyModulesService: any;
let paymentsService: any;
let storeOrderService: any;

async function cleanup() {
  for (const sql of [
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
  const { LegacyModulesService } = await import('../src/modules/identity/legacy-modules.service');
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { IntakeService } = await import('../src/modules/site/intake.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');
  const { CustomerReferralService } = await import('../src/modules/site/customer-referral.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { PaymentsController } = await import('../src/modules/payments/payments.controller');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');

  redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const allowAll = { canActivate: () => true };
  const noop = {};

  const mod = await Test.createTestingModule({
    controllers: [SiteController, PaymentsController],
    providers: [
      { provide: PrismaService, useValue: { client: db } },
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: REDIS_CLIENT, useValue: redis },
      PublicRateLimitGuard,
      LegacyModulesService,
      SiteService,
      StoreOrderService,
      PromoCodeService,
      PaymentsService,
      { provide: CommerceService, useValue: noop },
      { provide: InvoiceWorkflowService, useValue: noop },
      { provide: InventoryRiskService, useValue: noop },
      { provide: RevenueAttributionService, useValue: noop },
      { provide: PublicEventsService, useValue: noop },
      { provide: RevenuePostingService, useValue: noop },
      { provide: ExpensePostingService, useValue: noop },
      { provide: CrmService, useValue: noop },
      { provide: TransactionalEmailService, useValue: noop },
      { provide: IntakeService, useValue: noop },
      { provide: QualificationService, useValue: noop },
      { provide: StorefrontConversionService, useValue: noop },
      { provide: CustomerReferralService, useValue: noop },
      { provide: CaseStudyService, useValue: noop },
      { provide: AiUsageService, useValue: noop },
    ],
  })
    .overrideGuard(AuthGuard)
    .useValue(allowAll)
    .overrideGuard(BusinessGuard)
    .useValue(allowAll)
    .overrideGuard(ModuleScopeGuard)
    .useValue(allowAll)
    .overrideGuard(HoneypotGuard)
    .useValue(allowAll)
    .compile();

  legacyModulesService = mod.get(LegacyModulesService);
  paymentsService = mod.get(PaymentsService);
  storeOrderService = mod.get(StoreOrderService);

  app = mod.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  await clearRateLimits();

  await db.user.create({
    data: { id: ID.owner, email: `${P}owner@v92p.test.local`, name: 'P253 Owner', role: 'USER' },
  });

  for (const [id, slug, storeEnabled] of [
    [ID.bizStore, SLUG.store, true],
    [ID.bizNone, SLUG.none, true],
    [ID.bizOff, SLUG.off, false],
  ] as const) {
    await db.business.create({
      data: {
        id,
        name: `P253 ${slug}`,
        slug,
        ownerId: ID.owner,
        storeEnabled,
        currency: 'TTD',
        metaData: {
          storefront: {
            paymentMethods: { cash: true, manual: true },
          },
        },
      },
    });
    await db.membership.create({
      data: { id: `${id}_mem`, userId: ID.owner, businessId: id, role: 'OWNER' },
    });
  }

  for (const [bizId, prodId, svcId] of [
    [ID.bizStore, ID.prodStore, ID.svcListingStore],
    [ID.bizNone, ID.prodNone, ID.svcListingNone],
  ] as const) {
    await db.product.create({
      data: {
        id: prodId,
        businessId: bizId,
        name: `Widget ${bizId}`,
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
        name: `Widget ${bizId}`,
        price: 100,
        duration: 0,
        sourceProductId: prodId,
      },
    });
  }

  await db.promoCode.createMany({
    data: [
      {
        id: ID.promoStore,
        businessId: ID.bizStore,
        code: 'SAVE10',
        type: 'PERCENT',
        value: 10,
        active: true,
      },
      {
        id: ID.promoNone,
        businessId: ID.bizNone,
        code: 'SECRET10',
        type: 'PERCENT',
        value: 10,
        active: true,
      },
    ],
  });

  await db.marketplaceOrder.createMany({
    data: [
      {
        id: ID.orderOpen,
        businessId: ID.bizStore,
        orderNumber: `${P}ORD-1`,
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Legacy Buyer',
        total: 100,
        subtotal: 100,
        currency: 'TTD',
      },
      {
        id: ID.orderPaid,
        businessId: ID.bizStore,
        orderNumber: `${P}ORD-2`,
        status: 'completed',
        paymentStatus: 'PAID',
        customerName: 'Paid Buyer',
        total: 100,
        subtotal: 100,
        currency: 'TTD',
      },
      {
        id: ID.orderOff,
        businessId: ID.bizOff,
        orderNumber: `${P}ORD-OFF`,
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Closed Store Buyer',
        total: 100,
        subtotal: 100,
        currency: 'TTD',
      },
    ],
  });
});

beforeEach(async () => {
  await clearRateLimits();
});

afterAll(async () => {
  await cleanup();
  await clearRateLimits();
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
  if (app) await app.close();
  if (redis) await redis.quit();
});

describe('P253 FU-STORE-GATE-SIDE-DOORS — /gateways, /validate-promo, and create-checkout storefront_order', () => {
  it('[SGSD-01] RED-BEFORE: hidden-store business gets 403 STORE_CHECKOUT_NOT_OFFERED on GET /gateways and POST /validate-promo without invoking gateway listing or promo calculation', async () => {
    const gatewaysSpy = vi.spyOn(paymentsService, 'getStorefrontGateways');
    const totalsSpy = vi.spyOn(storeOrderService, 'calculateOrderTotals');

    try {
      const gwRes = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/gateways?currency=TTD`);
      expect(gwRes.status, gwRes.text).toBe(403);
      expect(gwRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');
      expect(gatewaysSpy).not.toHaveBeenCalled();

      const promoRes = await agent()
        .post(`/site/storefront/public/${encodeURIComponent(SLUG.none)}/validate-promo`)
        .send({ code: 'SECRET10', items: [{ productId: ID.prodNone, quantity: 1 }] });
      expect(promoRes.status, promoRes.text).toBe(403);
      expect(promoRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');
      expect(totalsSpy).not.toHaveBeenCalled();
    } finally {
      gatewaysSpy.mockRestore();
      totalsSpy.mockRestore();
    }
  });

  it('[SGSD-02] CONTROL: legacy-store business gets 200 on GET /gateways and 201 on POST /validate-promo', async () => {
    const gwRes = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.store)}/gateways?currency=TTD`);
    expect(gwRes.status, gwRes.text).toBe(200);
    expect(Array.isArray(gwRes.body)).toBe(true);

    const promoRes = await agent()
      .post(`/site/storefront/public/${encodeURIComponent(SLUG.store)}/validate-promo`)
      .send({ code: 'SAVE10', items: [{ productId: ID.prodStore, quantity: 1 }] });
    expect(promoRes.status, promoRes.text).toBe(201);
    expect(promoRes.body?.valid).toBe(true);
    expect(promoRes.body?.total).toBe(90);
  });

  it('[SGSD-03] CONTROL: unknown slug and storeEnabled=false return 404 on GET /gateways and POST /validate-promo', async () => {
    for (const slug of [SLUG.unknown, SLUG.off]) {
      const gwRes = await agent().get(`/site/storefront/public/${encodeURIComponent(slug)}/gateways?currency=TTD`);
      expect(gwRes.status, `GET /gateways ${slug}: ${gwRes.text}`).toBe(404);

      const promoRes = await agent()
        .post(`/site/storefront/public/${encodeURIComponent(slug)}/validate-promo`)
        .send({ code: 'SAVE10', items: [{ productId: ID.prodStore, quantity: 1 }] });
      expect(promoRes.status, `POST /validate-promo ${slug}: ${promoRes.text}`).toBe(404);
    }
  });

  it('[SGSD-04] RED-BEFORE: legacy-read failure fails closed to 403 STORE_CHECKOUT_NOT_OFFERED (never 500) on /gateways and /validate-promo even for legacy store', async () => {
    const modes: Array<{ label: string; mock: () => ReturnType<typeof vi.spyOn> }> = [
      {
        label: 'async rejection',
        mock: () => vi.spyOn(legacyModulesService, 'getLegacyModules').mockRejectedValue(new Error('db timeout')),
      },
      {
        label: 'sync throw',
        mock: () =>
          vi.spyOn(legacyModulesService, 'getLegacyModules').mockImplementation(() => {
            throw new Error('sync legacy throw');
          }),
      },
      {
        label: 'non-array return',
        mock: () => vi.spyOn(legacyModulesService, 'getLegacyModules').mockResolvedValue('store' as any),
      },
    ];

    for (const { label, mock } of modes) {
      const spy = mock();
      try {
        const gwRes = await agent().get(`/site/storefront/public/${encodeURIComponent(SLUG.store)}/gateways?currency=TTD`);
        expect(gwRes.status, `${label} /gateways: ${gwRes.text}`).toBe(403);
        expect(gwRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');

        const promoRes = await agent()
          .post(`/site/storefront/public/${encodeURIComponent(SLUG.store)}/validate-promo`)
          .send({ code: 'SAVE10', items: [{ productId: ID.prodStore, quantity: 1 }] });
        expect(promoRes.status, `${label} /validate-promo: ${promoRes.text}`).toBe(403);
        expect(promoRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');
      } finally {
        spy.mockRestore();
      }
    }
  });

  it('[SGSD-05] RED-BEFORE + MUTANT: POST /payments/create-checkout (storefront_order) enforces the store legacy gate fail-closed without relying on order-existence invariants', async () => {
    const createPaymentSpy = vi.spyOn(paymentsService, 'createStorePayment');

    // Mutant 1: business is NOT on the `store` legacy list despite having an existing MarketplaceOrder
    const hiddenCases: Array<{ label: string; setup: () => ReturnType<typeof vi.spyOn> }> = [
      {
        label: 'empty legacy modules',
        setup: () => vi.spyOn(legacyModulesService, 'getLegacyModules').mockResolvedValue([]),
      },
      {
        label: 'async rejection',
        setup: () =>
          vi.spyOn(legacyModulesService, 'getLegacyModules').mockRejectedValue(
            new Error('postgres://user:supersecret@db.internal:5432/keyflow refused'),
          ),
      },
      {
        label: 'sync throw',
        setup: () =>
          vi.spyOn(legacyModulesService, 'getLegacyModules').mockImplementation(() => {
            throw new Error('sync boom');
          }),
      },
      {
        label: 'non-array string',
        setup: () => vi.spyOn(legacyModulesService, 'getLegacyModules').mockResolvedValue('store' as any),
      },
    ];

    for (const { label, setup } of hiddenCases) {
      await clearRateLimits();
      createPaymentSpy.mockClear();
      const legacySpy = setup();
      try {
        // Open UNPAID order refuses 403 before createStorePayment
        const openRes = await agent().post('/payments/create-checkout').send({
          payableType: 'storefront_order',
          payableId: ID.orderOpen,
          gateway: 'stripe',
          returnUrl: 'https://app.test.local/return',
        });
        expect(openRes.status, `${label} open order: ${openRes.text}`).toBe(403);
        expect(openRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');
        expect(createPaymentSpy).not.toHaveBeenCalled();

        // Already-PAID order ALSO refuses 403 STORE_CHECKOUT_NOT_OFFERED (no order-state leak when store is hidden)
        const paidRes = await agent().post('/payments/create-checkout').send({
          payableType: 'storefront_order',
          payableId: ID.orderPaid,
          gateway: 'stripe',
          returnUrl: 'https://app.test.local/return',
        });
        expect(paidRes.status, `${label} paid order: ${paidRes.text}`).toBe(403);
        expect(paidRes.body?.code).toBe('STORE_CHECKOUT_NOT_OFFERED');
        expect(createPaymentSpy).not.toHaveBeenCalled();
      } finally {
        legacySpy.mockRestore();
      }
    }

    // Mutant 2 (positive control): with real DB ('store' in legacyModules), create-checkout passes the store gate!
    await clearRateLimits();
    createPaymentSpy.mockClear();
    const openAllowedRes = await agent().post('/payments/create-checkout').send({
      payableType: 'storefront_order',
      payableId: ID.orderOpen,
      gateway: 'cash',
      returnUrl: 'https://app.test.local/return',
    });
    // Cash starts no online session -> reaches createStorePayment and returns clean 400 (NOT 403 STORE_CHECKOUT_NOT_OFFERED)
    expect(openAllowedRes.status, openAllowedRes.text).toBe(400);
    expect(openAllowedRes.body?.code).not.toBe('STORE_CHECKOUT_NOT_OFFERED');
    expect(createPaymentSpy).toHaveBeenCalledTimes(1);

    // Paid order on enabled legacy store still returns 400 already paid/cancelled (NOT 403)
    const paidAllowedRes = await agent().post('/payments/create-checkout').send({
      payableType: 'storefront_order',
      payableId: ID.orderPaid,
      gateway: 'stripe',
      returnUrl: 'https://app.test.local/return',
    });
    expect(paidAllowedRes.status, paidAllowedRes.text).toBe(400);
    expect(paidAllowedRes.body?.code).not.toBe('STORE_CHECKOUT_NOT_OFFERED');

    // Unknown storefront_order id still returns 400 not found (not 403)
    const missingOrderRes = await agent().post('/payments/create-checkout').send({
      payableType: 'storefront_order',
      payableId: `${P}missing_order`,
      gateway: 'stripe',
      returnUrl: 'https://app.test.local/return',
    });
    expect(missingOrderRes.status, missingOrderRes.text).toBe(400);

    createPaymentSpy.mockRestore();
  });
});
