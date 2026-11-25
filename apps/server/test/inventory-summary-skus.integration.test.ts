/**
 * P77 — V1-66 (SWP-INV-SKU-COUNT, BUG-107, Journeys B/G) — Inventory
 * `totalSKUs` in `GET /marketplace/businesses/:businessId/inventory/summary`
 * counts distinct products with stock rows, not total stock rows across
 * warehouses. Per-warehouse `skuCount` / `totalUnits` figures stay unchanged,
 * and `healthScore` stays bounded in 0..100.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v66d_` prefix and is
 * hard-deleted by raw SQL (`sqlLikePrefix`) in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66d_';
const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  ownerEmpty: `${P}ownerEmpty`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizEmpty: `${P}bizEmpty`,
  wh1: `${P}wh1`,
  wh2: `${P}wh2`,
  wh3: `${P}wh3`,
  whB: `${P}whB`,
  prod1: `${P}prod1`,
  prod2: `${P}prod2`,
  prodB: `${P}prodB`,
  stock1w1: `${P}s_1_w1`,
  stock1w2: `${P}s_1_w2`,
  stock1w3: `${P}s_1_w3`,
  stock2w1: `${P}s_2_w1`,
  stock2w2: `${P}s_2_w2`,
  stockB: `${P}s_b`,
};

let db: any;
let app: any;
let ipSeq = 0;

function nextIp() {
  ipSeq += 1;
  return `10.66.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

function getSummary(businessId: string, actorId: string) {
  return request(app.getHttpServer())
    .get(`/marketplace/businesses/${businessId}/inventory/summary`)
    .set('x-forwarded-for', nextIp())
    .set('x-test-user', actorId);
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      ModuleScopeGuard,
      MarketplaceService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: CommerceIntegrationService, useValue: {} },
      { provide: FulfillmentRoutingService, useValue: {} },
      { provide: TransactionalEmailService, useValue: {} },
      { provide: ExpensePostingService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
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
  await app.init();

  await cleanup();

  // Seed users, businesses, memberships
  for (const [userId, bizId, email, name] of [
    [ID.ownerA, ID.bizA, `${P}a@example.test`, 'Biz A'],
    [ID.ownerB, ID.bizB, `${P}b@example.test`, 'Biz B'],
    [ID.ownerEmpty, ID.bizEmpty, `${P}empty@example.test`, 'Biz Empty'],
  ] as const) {
    await db.user.create({ data: { id: userId, email, role: 'USER' } });
    await db.business.create({
      data: { id: bizId, name, ownerId: userId, currency: 'TTD' },
    });
    await db.membership.create({
      data: { userId, businessId: bizId, role: 'OWNER' },
    });
  }

  // Seed 3 active warehouses for Biz A + 1 for Biz B
  await db.warehouse.createMany({
    data: [
      { id: ID.wh1, businessId: ID.bizA, name: 'Main Warehouse', isActive: true, capacity: 100 },
      { id: ID.wh2, businessId: ID.bizA, name: 'South Branch', isActive: true, capacity: 50 },
      { id: ID.wh3, businessId: ID.bizA, name: 'Airport Depot', isActive: true, capacity: 40 },
      { id: ID.whB, businessId: ID.bizB, name: 'Tenant B Warehouse', isActive: true, capacity: 100 },
    ],
  });

  // Seed products
  await db.product.createMany({
    data: [
      { id: ID.prod1, businessId: ID.bizA, name: 'Espresso Beans 1kg', price: 120, currency: 'TTD', inventoryMode: 'tracked' },
      { id: ID.prodB, businessId: ID.bizB, name: 'Tenant B Tea', price: 80, currency: 'TTD', inventoryMode: 'tracked' },
    ],
  });

  // Seed 1 product (prod1) across 3 warehouses in Biz A + 1 stock row in Biz B
  await db.inventoryStock.createMany({
    data: [
      { id: ID.stock1w1, businessId: ID.bizA, productId: ID.prod1, warehouseId: ID.wh1, quantity: 10, costPerUnit: 50 },
      { id: ID.stock1w2, businessId: ID.bizA, productId: ID.prod1, warehouseId: ID.wh2, quantity: 5, costPerUnit: 50 },
      { id: ID.stock1w3, businessId: ID.bizA, productId: ID.prod1, warehouseId: ID.wh3, quantity: 2, costPerUnit: 50 },
      { id: ID.stockB, businessId: ID.bizB, productId: ID.prodB, warehouseId: ID.whB, quantity: 99, costPerUnit: 30 },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('P77 — V1-66 (SWP-INV-SKU-COUNT, BUG-107): inventory summary totalSKUs counts distinct products', () => {
  it('[SKU-01] RED-BEFORE: one product across three warehouses reports totalSKUs=1 (not 3), healthScore<=100, and keeps per-warehouse breakdown intact', async () => {
    const res = await getSummary(ID.bizA, ID.ownerA).expect(200);

    expect(res.body.totalSKUs).toBe(1);
    expect(res.body.totalProducts).toBe(1);
    expect(res.body.totalStockValue).toBe((10 + 5 + 2) * 50);
    expect(res.body.inStockCount).toBe(3);
    expect(res.body.healthScore).toBe(100);
    expect(res.body.healthScore).toBeLessThanOrEqual(100);

    expect(res.body.warehouseBreakdown).toHaveLength(3);
    const byId = new Map<string, any>(res.body.warehouseBreakdown.map((w: any) => [w.id, w]));
    expect(byId.get(ID.wh1)).toMatchObject({ skuCount: 1, totalUnits: 10 });
    expect(byId.get(ID.wh2)).toMatchObject({ skuCount: 1, totalUnits: 5 });
    expect(byId.get(ID.wh3)).toMatchObject({ skuCount: 1, totalUnits: 2 });
  });

  it('[SKU-02] RED-BEFORE: two products across multiple warehouses (5 stock rows, 1 out of stock) reports totalSKUs=2 and bounded healthScore', async () => {
    await db.product.create({
      data: { id: ID.prod2, businessId: ID.bizA, name: 'Matcha Tin', price: 95, currency: 'TTD', inventoryMode: 'tracked' },
    });
    await db.inventoryStock.createMany({
      data: [
        { id: ID.stock2w1, businessId: ID.bizA, productId: ID.prod2, warehouseId: ID.wh1, quantity: 4, costPerUnit: 40 },
        { id: ID.stock2w2, businessId: ID.bizA, productId: ID.prod2, warehouseId: ID.wh2, quantity: 0, costPerUnit: 40 },
      ],
    });

    const res = await getSummary(ID.bizA, ID.ownerA).expect(200);
    expect(res.body.totalSKUs).toBe(2);
    expect(res.body.totalProducts).toBe(2);
    expect(res.body.inStockCount).toBe(4);
    expect(res.body.outOfStockCount).toBe(1);
    expect(res.body.healthScore).toBe(80); // 4 of 5 stock rows in stock

    const byId = new Map<string, any>(res.body.warehouseBreakdown.map((w: any) => [w.id, w]));
    expect(byId.get(ID.wh1)).toMatchObject({ skuCount: 2, totalUnits: 14 });
    expect(byId.get(ID.wh2)).toMatchObject({ skuCount: 2, totalUnits: 5 });
    expect(byId.get(ID.wh3)).toMatchObject({ skuCount: 1, totalUnits: 2 });
  });

  it('[SKU-03] tenant isolation: bizB stock does not leak into bizA and outsider receives 403', async () => {
    await getSummary(ID.bizA, ID.ownerB).expect(403);
    const resB = await getSummary(ID.bizB, ID.ownerB).expect(200);
    expect(resB.body.totalSKUs).toBe(1);
    expect(resB.body.totalStockValue).toBe(99 * 30);
  });

  it('[SKU-04] empty business reports totalSKUs=0 and healthScore=100', async () => {
    const res = await getSummary(ID.bizEmpty, ID.ownerEmpty).expect(200);
    expect(res.body.totalSKUs).toBe(0);
    expect(res.body.totalProducts).toBe(0);
    expect(res.body.healthScore).toBe(100);
    expect(res.body.warehouseBreakdown).toEqual([]);
  });
});
