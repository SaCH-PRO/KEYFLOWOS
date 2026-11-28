/**
 * V1-64 (SWP-STORE-LISTING-SERVER, BUG-055, ruling `storelisting`):
 * The public store lists ONLY products added to the store (having a live
 * listing Service with `sourceProductId = product.id` and `deletedAt = null`),
 * public service lists exclude product listing services (`sourceProductId = null`),
 * and storefront checkout refuses any product not on the store with
 * `400 PRODUCT_NOT_IN_STORE` before writing any order or promo usage.
 *
 * Real Postgres, real NestJS controllers (CatalogController, CommerceController,
 * BookingsController, SiteController) and real StoreOrderService / CatalogService /
 * SiteService behind GlobalHttpExceptionFilter and ValidationPipe.
 *
 * Fixture prefix: `v64h_` (registered in test/helpers/fixture-prefixes.json).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64h_';
const RATE_LIMIT_NS = P;
const PREVIOUS_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;
process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  ownerOff: `${P}ownerOff`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizOff: `${P}bizOff`,
  prodListed: `${P}prod_listed`,
  prodDupListed: `${P}prod_dup_listed`,
  prodUnlisted: `${P}prod_unlisted`,
  prodRemoved: `${P}prod_removed`,
  prodOtherTenantListed: `${P}prod_other_tenant`,
  prodOff: `${P}prod_off`,
  ownerEmpty: `${P}owner_empty`,
  bizEmpty: `${P}biz_empty`,
  prodEmptyUnlisted: `${P}prod_empty_unlisted`,
  ownerReadded: `${P}owner_readded`,
  bizReadded: `${P}biz_readded`,
  prodReadded: `${P}prod_readded`,
  svcReaddedDeleted: `${P}svc_readded_del`,
  svcReaddedLive: `${P}svc_readded_live`,
  svcBookable: `${P}svc_bookable`,
  svcListing1: `${P}svc_listing1`,
  svcListingDupA: `${P}svc_listing_dup_a`,
  svcListingDupB: `${P}svc_listing_dup_b`,
  svcListingRemoved: `${P}svc_listing_removed`,
  svcListingCrossTenant: `${P}svc_listing_xtenant`,
  svcListingOff: `${P}svc_listing_off`,
};

const SLUG = {
  a: `${P}store-a`,
  b: `${P}store-b`,
  off: `${P}store-off`,
  empty: `${P}store-empty`,
  readded: `${P}store-readded`,
};

const CANARY = 'V64H_SECRET_';

let db: any;
let app: any;
let redis: any;
let storeOrders: any;
let presenceService: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM site_pages_published WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

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
  const { CatalogController } = await import('../src/modules/catalog/catalog.controller');
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
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
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
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PresenceService } = await import('../src/modules/site/presence/presence.service');

  redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  const allowAll = { canActivate: () => true };
  const noop = {};
  const noopCrm = { findOrCreateContact: async () => ({ id: `${P}ct_stub` }) };
  const noopPromo = { validate: async () => null, apply: () => ({ discount: 0, freeShipping: false }), incrementUsage: async () => {} };

  const mod = await Test.createTestingModule({
    controllers: [CatalogController, CommerceController, BookingsController, SiteController],
    providers: [
      { provide: PrismaService, useValue: { client: db } },
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: REDIS_CLIENT, useValue: redis },
      PublicRateLimitGuard,
      CatalogService,
      CommerceService,
      SiteService,
      StoreOrderService,
      BookingsService,
      PresenceService,
      { provide: CommerceStatsService, useValue: noop },
      { provide: InvoiceWorkflowService, useValue: noop },
      { provide: InvoiceReceiptBuilderService, useValue: noop },
      { provide: GmailService, useValue: noop },
      { provide: CommerceVisionService, useValue: noop },
      { provide: StoreReadinessService, useValue: noop },
      { provide: PaymentEvidenceService, useValue: noop },
      { provide: TimeEntryService, useValue: noop },
      { provide: PublicEventsService, useValue: noop },
      { provide: CrmService, useValue: noopCrm },
      { provide: RevenuePostingService, useValue: noop },
      { provide: ExpensePostingService, useValue: noop },
      { provide: InventoryRiskService, useValue: noop },
      { provide: BookingWaitlistService, useValue: noop },
      { provide: CalendarService, useValue: noop },
      { provide: BookingOptimizerService, useValue: noop },
      { provide: RevenueAttributionService, useValue: noop },
      { provide: TransactionalEmailService, useValue: noop },
      { provide: TimelineService, useValue: noop },
      { provide: PromoCodeService, useValue: noopPromo },
      { provide: IntakeService, useValue: noop },
      { provide: QualificationService, useValue: noop },
      { provide: StorefrontConversionService, useValue: noop },
      { provide: CustomerReferralService, useValue: noop },
      { provide: CaseStudyService, useValue: noop },
      { provide: PaymentsService, useValue: noop },
      { provide: AiUsageService, useValue: noop },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true, current: 0, limit: -1 }) } },
    ],
  })
    .overrideGuard(AuthGuard).useValue(allowAll)
    .overrideGuard(BusinessGuard).useValue(allowAll)
    .overrideGuard(ModuleScopeGuard).useValue(allowAll)
    .overrideGuard(PlanLimitGuard).useValue(allowAll)
    .overrideGuard(HoneypotGuard).useValue(allowAll)
    .compile();

  app = mod.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  storeOrders = mod.get(StoreOrderService);
  presenceService = mod.get(PresenceService);

  await cleanup();
  await clearRateLimits();

  for (const [id, email] of [
    [ID.ownerA, `${P}owner-a@test.local`],
    [ID.ownerB, `${P}owner-b@test.local`],
    [ID.ownerOff, `${P}owner-off@test.local`],
    [ID.ownerEmpty, `${P}owner-empty@test.local`],
    [ID.ownerReadded, `${P}owner-readded@test.local`],
  ] as const) {
    await db.user.create({ data: { id, email, name: id, role: 'USER' } });
  }

  for (const [id, slug, ownerId, storeEnabled] of [
    [ID.bizA, SLUG.a, ID.ownerA, true],
    [ID.bizB, SLUG.b, ID.ownerB, true],
    [ID.bizOff, SLUG.off, ID.ownerOff, false],
    [ID.bizEmpty, SLUG.empty, ID.ownerEmpty, true],
    [ID.bizReadded, SLUG.readded, ID.ownerReadded, true],
  ] as const) {
    await db.business.create({
      data: { id, name: `V64H ${slug}`, slug, ownerId, currency: 'TTD', storeEnabled },
    });
    await db.membership.create({ data: { userId: ownerId, businessId: id, role: 'OWNER' } });
  }
  // P233 WEDGE-HIDE-STORE-SERVER: bizA and bizReadded test public store checkout listing membership on selling stores.
  for (const businessId of [ID.bizA, ID.bizReadded] as const) {
    await db.marketplaceOrder.create({
      data: { id: `${businessId}_legacy_seed`, businessId, orderNumber: `${businessId.toUpperCase()}-LEGACY-0`, status: 'completed', customerName: 'Legacy Seed', total: 1, subtotal: 1, currency: 'TTD' },
    });
  }

  await db.sitePagePublished.create({
    data: {
      businessId: ID.bizA,
      payload: presenceService.defaultPayload(),
      version: 1,
      publishedAt: new Date(),
    },
  });

  const mkProd = (id: string, businessId: string, name: string) =>
    db.product.create({
      data: {
        id,
        businessId,
        name,
        price: 100,
        currency: 'TTD',
        category: 'PRODUCT',
        isActive: true,
        sku: `${CANARY}sku-${id}`,
        downloadUrl: `https://files.example.test/${CANARY}${id}`,
      },
    });

  await mkProd(ID.prodListed, ID.bizA, 'Listed Candle');
  await mkProd(ID.prodDupListed, ID.bizA, 'Dup-Listed Mug');
  await mkProd(ID.prodUnlisted, ID.bizA, 'Unlisted Draft Item');
  await mkProd(ID.prodRemoved, ID.bizA, 'Removed From Store Item');
  await mkProd(ID.prodOtherTenantListed, ID.bizA, 'Cross-Tenant Planted Item');
  await mkProd(ID.prodOff, ID.bizOff, 'Closed Store Listed Item');
  await mkProd(ID.prodEmptyUnlisted, ID.bizEmpty, 'Empty Store Unlisted Item');
  await mkProd(ID.prodReadded, ID.bizReadded, 'Re-added Store Item');
  await db.service.create({
    data: {
      id: ID.svcReaddedDeleted,
      businessId: ID.bizReadded,
      name: 'Re-added Store Item (old)',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodReadded,
      deletedAt: new Date(),
    },
  });
  await db.service.create({
    data: {
      id: ID.svcReaddedLive,
      businessId: ID.bizReadded,
      name: 'Re-added Store Item',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodReadded,
    },
  });

  // Standalone bookable service (sourceProductId = null): MUST appear on public services.
  await db.service.create({
    data: {
      id: ID.svcBookable,
      businessId: ID.bizA,
      name: 'Bookable Consultation',
      duration: 60,
      price: 200,
      sourceProductId: null,
    },
  });

  // Live listing Service for prodListed.
  await db.service.create({
    data: {
      id: ID.svcListing1,
      businessId: ID.bizA,
      name: 'Listed Candle',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodListed,
    },
  });

  // Two duplicate live listing Services for prodDupListed -> product MUST appear once.
  await db.service.create({
    data: {
      id: ID.svcListingDupA,
      businessId: ID.bizA,
      name: 'Dup-Listed Mug',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodDupListed,
    },
  });
  await db.service.create({
    data: {
      id: ID.svcListingDupB,
      businessId: ID.bizA,
      name: 'Dup-Listed Mug (dup)',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodDupListed,
    },
  });

  // Soft-deleted listing Service for prodRemoved ("Remove from store").
  await db.service.create({
    data: {
      id: ID.svcListingRemoved,
      businessId: ID.bizA,
      name: 'Removed From Store Item',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodRemoved,
      deletedAt: new Date(),
    },
  });

  // Cross-tenant planted listing Service in bizB referencing bizA's product.
  await db.service.create({
    data: {
      id: ID.svcListingCrossTenant,
      businessId: ID.bizB,
      name: 'Planted Cross-Tenant Listing',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodOtherTenantListed,
    },
  });

  // Live listing Service in closed store bizOff (still 404).
  await db.service.create({
    data: {
      id: ID.svcListingOff,
      businessId: ID.bizOff,
      name: 'Closed Store Listed Item',
      duration: 30,
      price: 100,
      sourceProductId: ID.prodOff,
    },
  });
}, 60_000);

afterAll(async () => {
  try { await cleanup(); } catch { /* best-effort */ }
  try { if (redis) { await clearRateLimits(); await redis.quit(); } } catch { /* best-effort */ }
  try { await app?.close(); } catch { /* best-effort */ }
  if (PREVIOUS_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_RATE_LIMIT_NS;
});

describe('SWP-STORE-LISTING-SERVER (BUG-055, ruling storelisting): public store membership', () => {
  it('SLM-01 RED-BEFORE: public product routes return only listed products (never-added and removed products are absent; duplicate listings deduplicate to once)', async () => {
    const [catRes, comRes, siteRes] = await Promise.all([
      agent().get(`/catalog/public/businesses/${ID.bizA}/products`),
      agent().get(`/commerce/public/businesses/${ID.bizA}/products`),
      agent().get(`/site/storefront/public/${SLUG.a}`),
    ]);

    expect(catRes.status).toBe(200);
    expect(comRes.status).toBe(200);
    expect(siteRes.status).toBe(200);

    const expectedIds = [ID.prodListed, ID.prodDupListed].sort();

    expect(catRes.body.map((p: any) => p.id).sort()).toEqual(expectedIds);
    expect(comRes.body.map((p: any) => p.id).sort()).toEqual(expectedIds);
    expect(siteRes.body.products.map((p: any) => p.id).sort()).toEqual(expectedIds);

    // V1-23 projection preserved: no secret fields leak.
    expect(JSON.stringify(catRes.body)).not.toContain(CANARY);
    expect(JSON.stringify(comRes.body)).not.toContain(CANARY);
    expect(JSON.stringify(siteRes.body)).not.toContain(CANARY);
  });

  it('SLM-02 RED-BEFORE: public services routes exclude product listing services (sourceProductId != null) and keep standalone bookable services', async () => {
    const [bookRes, siteRes] = await Promise.all([
      agent().get(`/bookings/public/businesses/${ID.bizA}/services`),
      agent().get(`/site/storefront/public/${SLUG.a}`),
    ]);

    expect(bookRes.status).toBe(200);
    expect(siteRes.status).toBe(200);

    expect(bookRes.body.map((s: any) => s.id)).toEqual([ID.svcBookable]);
    expect(siteRes.body.services.map((s: any) => s.id)).toEqual([ID.svcBookable]);
  });

  it('SLM-03 RED-BEFORE: StoreOrderService.createOrder and public checkout refuse a never-added product with 400 PRODUCT_NOT_IN_STORE and write zero orders', async () => {
    const beforeCount = await db.marketplaceOrder.count({ where: { businessId: ID.bizA } });

    const res = await agent()
      .post(`/site/storefront/public/${SLUG.a}/checkout`)
      .send({
        items: [{ productId: ID.prodUnlisted, quantity: 1 }],
        customer: { name: 'Buyer Unlisted', email: `${P}buyer1@test.local` },
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('PRODUCT_NOT_IN_STORE');
    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(beforeCount);
  });

  it('SLM-04 RED-BEFORE: checkout refuses a removed-from-store product (soft-deleted listing Service) with 400 PRODUCT_NOT_IN_STORE and writes zero orders', async () => {
    const beforeCount = await db.marketplaceOrder.count({ where: { businessId: ID.bizA } });

    const res = await agent()
      .post(`/site/storefront/public/${SLUG.a}/checkout`)
      .send({
        items: [{ productId: ID.prodRemoved, quantity: 1 }],
        customer: { name: 'Buyer Removed', email: `${P}buyer2@test.local` },
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('PRODUCT_NOT_IN_STORE');
    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(beforeCount);
  });

  it('SLM-05 RED-BEFORE (tenancy): another business listing Service referencing bizA product neither lists it on bizA nor allows bizA checkout', async () => {
    const beforeCount = await db.marketplaceOrder.count({ where: { businessId: ID.bizA } });

    const catRes = await agent().get(`/catalog/public/businesses/${ID.bizA}/products`);
    expect(catRes.status).toBe(200);
    expect(catRes.body.map((p: any) => p.id)).not.toContain(ID.prodOtherTenantListed);

    const checkoutRes = await agent()
      .post(`/site/storefront/public/${SLUG.a}/checkout`)
      .send({
        items: [{ productId: ID.prodOtherTenantListed, quantity: 1 }],
        customer: { name: 'Buyer CrossTenant', email: `${P}buyer3@test.local` },
        paymentMethod: 'CASH',
      });

    expect(checkoutRes.status).toBe(400);
    expect(JSON.stringify(checkoutRes.body)).toContain('PRODUCT_NOT_IN_STORE');
    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(beforeCount);
  });

  it('SLM-06 CONTROL: checkout succeeds for a listed product (creates one order)', async () => {
    const res = await agent()
      .post(`/site/storefront/public/${SLUG.a}/checkout`)
      .send({
        items: [{ productId: ID.prodListed, quantity: 1 }],
        customer: { name: 'Buyer Listed', email: `${P}buyer4@test.local` },
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body.order?.id ?? res.body.id).toBeTruthy();

    // Direct StoreOrderService.createOrder also enforces PRODUCT_NOT_IN_STORE.
    await expect(
      storeOrders.createOrder({
        businessId: ID.bizA,
        cartItems: [{ productId: ID.prodUnlisted, quantity: 1 }],
        customerInfo: { name: 'Direct Caller', email: `${P}direct@test.local` },
        paymentMethod: 'CASH',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('SLM-07 CONTROL: closed store (storeEnabled=false) still returns 404 even with a live listing Service', async () => {
    const [catRes, comRes, svcRes, siteRes] = await Promise.all([
      agent().get(`/catalog/public/businesses/${ID.bizOff}/products`),
      agent().get(`/commerce/public/businesses/${ID.bizOff}/products`),
      agent().get(`/bookings/public/businesses/${ID.bizOff}/services`),
      agent().get(`/site/storefront/public/${SLUG.off}`),
    ]);
    expect(catRes.status).toBe(404);
    expect(comRes.status).toBe(404);
    expect(svcRes.status).toBe(404);
    expect(siteRes.status).toBe(404);
  });

  it('SLM-08 (R1 MINOR #5/#6): mixed cart [listed, unlisted] and duplicate unlisted items return 400 PRODUCT_NOT_IN_STORE with deduplicated productIds and zero orders written', async () => {
    const beforeCount = await db.marketplaceOrder.count({ where: { businessId: ID.bizA } });

    const mixedRes = await agent()
      .post(`/site/storefront/public/${SLUG.a}/checkout`)
      .send({
        items: [
          { productId: ID.prodListed, quantity: 1 },
          { productId: ID.prodUnlisted, quantity: 1 },
        ],
        customer: { name: 'Buyer Mixed', email: `${P}mixed@test.local` },
        paymentMethod: 'CASH',
      });
    expect(mixedRes.status).toBe(400);
    expect(mixedRes.body.code).toBe('PRODUCT_NOT_IN_STORE');
    expect(mixedRes.body.details?.productIds).toEqual([ID.prodUnlisted]);

    const dupRes = await agent()
      .post(`/site/storefront/public/${SLUG.a}/checkout`)
      .send({
        items: [
          { productId: ID.prodUnlisted, quantity: 1 },
          { productId: ID.prodUnlisted, quantity: 2 },
        ],
        customer: { name: 'Buyer DupUnlisted', email: `${P}dup-unlisted@test.local` },
        paymentMethod: 'CASH',
      });
    expect(dupRes.status).toBe(400);
    expect(dupRes.body.code).toBe('PRODUCT_NOT_IN_STORE');
    expect(dupRes.body.details?.productIds).toEqual([ID.prodUnlisted]);

    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(beforeCount);
  });

  it('SLM-09 (R1 MINOR #5): validate-promo rejects unlisted product with 400 PRODUCT_NOT_IN_STORE', async () => {
    const res = await agent()
      .post(`/site/storefront/public/${SLUG.a}/validate-promo`)
      .send({
        code: 'SAVE10',
        items: [{ productId: ID.prodUnlisted, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRODUCT_NOT_IN_STORE');
  });

  it('SLM-10 (R1 MINOR #5): re-added product (soft-deleted listing + live listing) appears once across all public product routes and checkout succeeds', async () => {
    const [catRes, comRes, siteRes] = await Promise.all([
      agent().get(`/catalog/public/businesses/${ID.bizReadded}/products`),
      agent().get(`/commerce/public/businesses/${ID.bizReadded}/products`),
      agent().get(`/site/storefront/public/${SLUG.readded}`),
    ]);
    expect(catRes.status).toBe(200);
    expect(comRes.status).toBe(200);
    expect(siteRes.status).toBe(200);
    expect(catRes.body.map((p: any) => p.id)).toEqual([ID.prodReadded]);
    expect(comRes.body.map((p: any) => p.id)).toEqual([ID.prodReadded]);
    expect((siteRes.body.products ?? []).map((p: any) => p.id)).toEqual([ID.prodReadded]);
    expect(siteRes.body.services ?? []).toEqual([]);

    const checkoutRes = await agent()
      .post(`/site/storefront/public/${SLUG.readded}/checkout`)
      .send({
        items: [{ productId: ID.prodReadded, quantity: 1 }],
        customer: { name: 'Buyer Readded', email: `${P}readded@test.local` },
        paymentMethod: 'CASH',
      });
    expect(checkoutRes.status).toBe(201);
  });

  it('SLM-11 (R1 MINOR #5): open store with active unlisted product and zero live listings returns 200 [] on all three public product routes', async () => {
    const [catRes, comRes, siteRes] = await Promise.all([
      agent().get(`/catalog/public/businesses/${ID.bizEmpty}/products`),
      agent().get(`/commerce/public/businesses/${ID.bizEmpty}/products`),
      agent().get(`/site/storefront/public/${SLUG.empty}`),
    ]);
    expect(catRes.status).toBe(200);
    expect(comRes.status).toBe(200);
    expect(siteRes.status).toBe(200);
    expect(catRes.body).toEqual([]);
    expect(comRes.body).toEqual([]);
    expect(siteRes.body.products ?? []).toEqual([]);
  });

  it('SLM-12 (R1 MAJOR #2): public booking slots and booking creation refuse a product-backed listing Service (sourceProductId != null) with 404 and write zero bookings', async () => {
    const beforeBookings = await db.booking.count({ where: { businessId: ID.bizA } });
    const futureDate = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);

    const slotsRes = await agent().get(`/bookings/public/businesses/${ID.bizA}/slots?serviceId=${ID.svcListing1}&date=${futureDate}`);
    expect(slotsRes.status).toBe(404);

    const bookRes = await agent()
      .post(`/bookings/public/businesses/${ID.bizA}`)
      .send({
        serviceId: ID.svcListing1,
        startTime: `${futureDate}T14:00:00.000Z`,
        firstName: 'Should',
        lastName: 'Fail',
        email: `${P}booking-fail@test.local`,
        phone: '+18685550100',
      });
    expect(bookRes.status).toBe(404);
    expect(String(bookRes.body?.message ?? '')).toMatch(/Service not found/i);
    expect(await db.booking.count({ where: { businessId: ID.bizA } })).toBe(beforeBookings);
  });

  it('SLM-13 (R1 MAJOR #3): PresenceService.getPublishedBySlug exposes only listed active products and standalone services (no unlisted products, no product listing Services)', async () => {
    const published = await presenceService.getPublishedBySlug(SLUG.a);
    expect(published).toBeTruthy();
    const productIds = (published.catalog?.products ?? published.products ?? []).map((p: any) => p.id).sort();
    const serviceIds = (published.catalog?.services ?? published.services ?? []).map((s: any) => s.id).sort();
    expect(productIds).toEqual([ID.prodDupListed, ID.prodListed].sort());
    expect(serviceIds).toEqual([ID.svcBookable]);
  });
});
