/**
 * SWP-STORE-OVERSELL (BUG-017, P33):
 * Storefront checkout (StoreOrderService.createOrder) refuses tracked lines
 * above own active-warehouse available stock (sum of max(0, quantity - reserved))
 * with 409 INSUFFICIENT_STOCK naming the product and counts, never the product id.
 * Multi-warehouse stock (e.g. 6 + 4 = 10 across two active warehouses) completes
 * through both createOrder and completeCheckout; allow_backorder and untracked
 * products are accepted; inactive warehouses and another business's planted rows
 * never count as available stock.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import IORedis from 'ioredis';
import { sqlLikePrefix } from './helpers/sql-like';

const P = 'v64i_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  wh1: `${P}wh1`,
  wh2: `${P}wh2`,
  whInactive: `${P}whInactive`,
  whB: `${P}whB`,
  prodTracked: `${P}prodTracked`,
  prodReserved: `${P}prodReserved`,
  prodBackorder: `${P}prodBackorder`,
  prodUntracked: `${P}prodUntracked`,
  svcTracked: `${P}svcTracked`,
  svcReserved: `${P}svcReserved`,
  svcBackorder: `${P}svcBackorder`,
  svcUntracked: `${P}svcUntracked`,
  stockWh1: `${P}stockWh1`,
  stockWh2: `${P}stockWh2`,
  stockWhInactive: `${P}stockWhInactive`,
  stockPlantedB: `${P}stockPlantedB`,
  stockReserved: `${P}stockReserved`,
  stockBackorder: `${P}stockBackorder`,
  contactA: `${P}contactA`,
};

const SLUG_A = `${P}store-a`;
const NAMES = {
  tracked: 'Artisan Sea Moss Gel',
  reserved: 'Spiced Ginger Tonic',
  backorder: 'Preorder Rum Cake',
  untracked: 'Digital Guide',
};

let db: any;
let app: INestApplication;
let redis: IORedis;
let storeOrders: any;
const PREV_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;

async function cleanup() {
  for (const sql of [
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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
  if (!redis) return;
  try {
    const keys = await redis.keys(`pub_rate_limit:${P}:*`);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    /* ignore */
  }
}

function agent() {
  return request(app.getHttpServer());
}

async function resetStocks() {
  await db.inventoryStock.update({ where: { id: ID.stockWh1 }, data: { quantity: 6, reserved: 0 } });
  await db.inventoryStock.update({ where: { id: ID.stockWh2 }, data: { quantity: 4, reserved: 0 } });
  await db.inventoryStock.update({ where: { id: ID.stockWhInactive }, data: { quantity: 100, reserved: 0 } });
  await db.inventoryStock.update({ where: { id: ID.stockPlantedB }, data: { quantity: 999, reserved: 0 } });
  await db.inventoryStock.update({ where: { id: ID.stockReserved }, data: { quantity: 10, reserved: 7 } });
  await db.inventoryStock.update({ where: { id: ID.stockBackorder }, data: { quantity: 2, reserved: 0 } });
}

beforeAll(async () => {
  process.env.RATE_LIMIT_KEY_NAMESPACE = P;
  const { PrismaClient } = await import('@prisma/client');
  db = new PrismaClient();
  await cleanup();

  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
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
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');

  redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  const allowAll = { canActivate: () => true };
  const noop = {};
  const noopPromo = { validate: async () => null, apply: () => ({ discount: 0, freeShipping: false }), incrementUsage: async () => {} };

  const mod = await Test.createTestingModule({
    controllers: [SiteController],
    providers: [
      { provide: PrismaService, useValue: { client: db } },
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: REDIS_CLIENT, useValue: redis },
      PublicRateLimitGuard,
      SiteService,
      StoreOrderService,
      { provide: PromoCodeService, useValue: noopPromo },
      { provide: IntakeService, useValue: noop },
      { provide: QualificationService, useValue: noop },
      { provide: StorefrontConversionService, useValue: noop },
      { provide: CustomerReferralService, useValue: noop },
      { provide: CaseStudyService, useValue: noop },
      { provide: PaymentsService, useValue: noop },
      { provide: CrmService, useValue: { findOrCreateContact: async () => ({ id: ID.contactA }) } },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined } },
      { provide: InvoiceWorkflowService, useValue: { transition: async () => ({}) } },
      { provide: InventoryRiskService, useValue: { evaluateProduct: async () => null } },
      { provide: RevenueAttributionService, useValue: { record: async () => undefined } },
      { provide: RevenuePostingService, useValue: { onPaymentRecorded: async () => ({ transactionId: `${P}ft_1` }) } },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: AiUsageService, useValue: noop },
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

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V64I Store A', slug: SLUG_A, ownerId: ID.ownerA, storeEnabled: true, currency: 'TTD' },
      { id: ID.bizB, name: 'V64I Store B', slug: `${P}store-b`, ownerId: ID.ownerB, storeEnabled: true, currency: 'TTD' },
    ],
  });
  // P233 WEDGE-HIDE-STORE-SERVER: bizA tests public store checkout oversell guards on a selling store.
  await db.marketplaceOrder.create({
    data: { id: `${ID.bizA}_legacy_seed`, businessId: ID.bizA, orderNumber: `${ID.bizA.toUpperCase()}-LEGACY-0`, status: 'completed', customerName: 'Legacy Seed', total: 1, subtotal: 1, currency: 'TTD' },
  });

  await db.contact.create({
    data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Buyer', lastName: 'Oversell', email: `${P}buyer@test.local` },
  });

  await db.warehouse.createMany({
    data: [
      { id: ID.wh1, businessId: ID.bizA, name: 'Port of Spain Main', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: ID.wh2, businessId: ID.bizA, name: 'San Fernando Annex', isActive: true, createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: ID.whInactive, businessId: ID.bizA, name: 'Closed Depot', isActive: false, createdAt: new Date('2026-01-03T00:00:00Z') },
      { id: ID.whB, businessId: ID.bizB, name: 'Other Biz Warehouse', isActive: true, createdAt: new Date('2026-01-04T00:00:00Z') },
    ],
  });

  await db.product.createMany({
    data: [
      { id: ID.prodTracked, businessId: ID.bizA, name: NAMES.tracked, price: 50, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodReserved, businessId: ID.bizA, name: NAMES.reserved, price: 30, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'show_oos' },
      { id: ID.prodBackorder, businessId: ID.bizA, name: NAMES.backorder, price: 80, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'allow_backorder' },
      { id: ID.prodUntracked, businessId: ID.bizA, name: NAMES.untracked, price: 25, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: null },
    ],
  });

  await db.service.createMany({
    data: [
      { id: ID.svcTracked, businessId: ID.bizA, name: NAMES.tracked, price: 50, duration: 0, sourceProductId: ID.prodTracked },
      { id: ID.svcReserved, businessId: ID.bizA, name: NAMES.reserved, price: 30, duration: 0, sourceProductId: ID.prodReserved },
      { id: ID.svcBackorder, businessId: ID.bizA, name: NAMES.backorder, price: 80, duration: 0, sourceProductId: ID.prodBackorder },
      { id: ID.svcUntracked, businessId: ID.bizA, name: NAMES.untracked, price: 25, duration: 0, sourceProductId: ID.prodUntracked },
    ],
  });

  await db.inventoryStock.createMany({
    data: [
      { id: ID.stockWh1, businessId: ID.bizA, productId: ID.prodTracked, warehouseId: ID.wh1, quantity: 6, reserved: 0 },
      { id: ID.stockWh2, businessId: ID.bizA, productId: ID.prodTracked, warehouseId: ID.wh2, quantity: 4, reserved: 0 },
      { id: ID.stockWhInactive, businessId: ID.bizA, productId: ID.prodTracked, warehouseId: ID.whInactive, quantity: 100, reserved: 0 },
      { id: ID.stockPlantedB, businessId: ID.bizB, productId: ID.prodTracked, warehouseId: ID.whB, quantity: 999, reserved: 0 },
      { id: ID.stockReserved, businessId: ID.bizA, productId: ID.prodReserved, warehouseId: ID.wh1, quantity: 10, reserved: 7 },
      { id: ID.stockBackorder, businessId: ID.bizA, productId: ID.prodBackorder, warehouseId: ID.wh1, quantity: 2, reserved: 0 },
    ],
  });
}, 30_000);

beforeEach(async () => {
  await clearRateLimits();
  await resetStocks();
});

afterAll(async () => {
  await clearRateLimits();
  if (PREV_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREV_RATE_LIMIT_NS;
  if (app) await app.close();
  if (redis) await redis.quit();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
}, 30_000);

describe('SWP-STORE-OVERSELL (BUG-017): storefront refuses orders above own active-warehouse available stock', () => {
  it('SOO-01 RED-BEFORE: 10 in stock over two active warehouses (plus inactive 100 & other-tenant 999), checkout 50 -> 409 INSUFFICIENT_STOCK naming product & counts, never product id, zero orders/movements written', async () => {
    const ordersBefore = await db.marketplaceOrder.count({ where: { businessId: ID.bizA } });
    const movesBefore = await db.stockMovement.count({ where: { businessId: ID.bizA } });

    const res = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [{ productId: ID.prodTracked, quantity: 50 }],
        customer: { name: 'Oversell Buyer', email: `${P}over50@test.local` },
        paymentMethod: 'CASH',
      });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.message).toContain(NAMES.tracked);
    expect(res.body.message).toContain('10');
    expect(res.body.message).toContain('50');
    expect(JSON.stringify(res.body)).not.toContain(ID.prodTracked);

    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(ordersBefore);
    expect(await db.stockMovement.count({ where: { businessId: ID.bizA } })).toBe(movesBefore);
  });

  it('SOO-02 RED-BEFORE: split duplicate cart lines totaling 11 against 10 available -> 409 INSUFFICIENT_STOCK naming product, no id, zero orders written', async () => {
    const ordersBefore = await db.marketplaceOrder.count({ where: { businessId: ID.bizA } });

    const res = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [
          { productId: ID.prodTracked, quantity: 6 },
          { productId: ID.prodTracked, quantity: 5 },
        ],
        customer: { name: 'Split Buyer', email: `${P}split11@test.local` },
        paymentMethod: 'CASH',
      });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.message).toContain(NAMES.tracked);
    expect(JSON.stringify(res.body)).not.toContain(ID.prodTracked);
    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(ordersBefore);
  });

  it('SOO-03 RED-BEFORE: reserved units are subtracted (10 qty - 7 reserved = 3 available): checkout 4 -> 409 naming product & 3; checkout 3 -> 201', async () => {
    const res4 = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [{ productId: ID.prodReserved, quantity: 4 }],
        customer: { name: 'Reserved Buyer', email: `${P}res4@test.local` },
        paymentMethod: 'CASH',
      });

    expect(res4.status, JSON.stringify(res4.body)).toBe(409);
    expect(res4.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res4.body.message).toContain(NAMES.reserved);
    expect(res4.body.message).toContain('3');
    expect(JSON.stringify(res4.body)).not.toContain(ID.prodReserved);

    const res3 = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [{ productId: ID.prodReserved, quantity: 3 }],
        customer: { name: 'Reserved Buyer OK', email: `${P}res3@test.local` },
        paymentMethod: 'CASH',
      });
    expect(res3.status, JSON.stringify(res3.body)).toBe(201);
  });

  it('SOO-04 RED-BEFORE: checkout 10 across two active warehouses (6 + 4) succeeds and completeCheckout decrements both active warehouses to 0 without touching inactive or other-tenant stock', async () => {
    const res = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [{ productId: ID.prodTracked, quantity: 10 }],
        customer: { name: 'Exact Ten Buyer', email: `${P}ten@test.local` },
        paymentMethod: 'CASH',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const orderId = res.body?.order?.id ?? res.body?.id;
    expect(orderId).toBeTruthy();

    await storeOrders.completeCheckout({ orderId, paymentRef: `${P}pay_ten` });

    const [s1, s2, sInact, sB] = await Promise.all([
      db.inventoryStock.findUnique({ where: { id: ID.stockWh1 } }),
      db.inventoryStock.findUnique({ where: { id: ID.stockWh2 } }),
      db.inventoryStock.findUnique({ where: { id: ID.stockWhInactive } }),
      db.inventoryStock.findUnique({ where: { id: ID.stockPlantedB } }),
    ]);
    expect(s1.quantity).toBe(0);
    expect(s2.quantity).toBe(0);
    expect(sInact.quantity).toBe(100);
    expect(sB.quantity).toBe(999);
  });

  it('SOO-05 RED-BEFORE: completeCheckout stock refusal names the product and counts, never the product id', async () => {
    const seeded = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_over_direct`,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-OVER-50`,
        status: 'PENDING',
        type: 'STOREFRONT',
        customerName: 'Direct Buyer',
        customerEmail: `${P}direct@test.local`,
        subtotal: 2500,
        shippingFee: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: 2500,
        currency: 'TTD',
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        items: {
          create: [{ productId: ID.prodTracked, name: NAMES.tracked, quantity: 50, unitPrice: 50, total: 2500, currency: 'TTD' }],
        },
      },
    });

    let err: any;
    try {
      await storeOrders.completeCheckout({ orderId: seeded.id, paymentRef: `${P}pay_fail50` });
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect(err.getStatus?.()).toBe(409);
    const body = err.getResponse?.();
    const serialized = JSON.stringify(body ?? err.message);
    expect(serialized).toContain('INSUFFICIENT_STOCK');
    expect(serialized).toContain(NAMES.tracked);
    expect(serialized).toContain('10');
    expect(serialized).toContain('50');
    expect(serialized).not.toContain(ID.prodTracked);
  });

  it('SOO-06 CONTROL: allow_backorder tracked product accepts order above stock and completes', async () => {
    const res = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [{ productId: ID.prodBackorder, quantity: 20 }],
        customer: { name: 'Backorder Buyer', email: `${P}bo@test.local` },
        paymentMethod: 'CASH',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const orderId = res.body?.order?.id ?? res.body?.id;
    await storeOrders.completeCheckout({ orderId, paymentRef: `${P}pay_bo` });
    const stock = await db.inventoryStock.findUnique({ where: { id: ID.stockBackorder } });
    expect(stock.quantity).toBe(-18);
  });

  it('SOO-07 CONTROL: untracked product (no inventoryMode, no own stock rows) accepts checkout for 50', async () => {
    const res = await agent()
      .post(`/site/storefront/public/${SLUG_A}/checkout`)
      .send({
        items: [{ productId: ID.prodUntracked, quantity: 50 }],
        customer: { name: 'Untracked Buyer', email: `${P}untr@test.local` },
        paymentMethod: 'CASH',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
