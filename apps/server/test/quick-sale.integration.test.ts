/**
 * P83 — V1-66 (QUICK-SALE-SERVER, P1 launch-track, Journey L):
 *
 * Real Postgres + real Redis + real HTTP NestJS app (`MarketplaceController`,
 * `MarketplaceService`, `StoreOrderService`, `CommerceController`,
 * `CommerceService`, `InvoiceWorkflowService`, `InvoiceReceiptBuilderService`,
 * `RevenuePostingService`, `ExpensePostingService`, `PostingService`,
 * `ChartOfAccountsSeederService`, `RevenueAttributionService`,
 * `SubscriptionsService`, `AuthGuard`, `BusinessGuard`, `ModuleScopeGuard`,
 * `CrmRateLimitGuard`, `PublicRateLimitGuard`).
 *
 * Proves:
 *   - [QS-01] Two-item cash quick sale atomically creates:
 *             MarketplaceOrder (type QUICK_SALE, PAID, CASH, discountAmount 0),
 *             PAID Invoice bound to per-business 'Walk-in customer' contact,
 *             SUCCESSFUL Payment through the ledger door (Dr CASH / Cr REVENUE),
 *             COGS posting (Dr COGS / Cr INVENTORY),
 *             InventoryStock decrement + 'sale' StockMovement rows,
 *             PaymentLink receipt token working on existing
 *             GET /commerce/public/invoice-link/:token/receipt (200, no new public route),
 *             and quick-sale invoice is EXCLUDED from SubscriptionsService monthly invoice cap
 *             while a forged regular INV-QS-* invoice IS still counted.
 *   - [QS-02] Oversell (single line or summed duplicate lines) refused 409
 *             INSUFFICIENT_STOCK in plain words naming the product and counts,
 *             with ZERO order/invoice/payment/ledger/COGS/stock/link/idempotency rows written.
 *   - [QS-03] Idempotency-Key replay writes nothing and returns the original sale +
 *             receipt token; different payload under the same key is refused 409.
 *   - [QS-04] Concurrent first-sale race on a brand-new business creates EXACTLY ONE
 *             'Walk-in customer' contact under pg_advisory_xact_lock and decrements
 *             stock accurately across all concurrent sales.
 *   - [QS-05] Bank-transfer quick sale with named contact debits BANK (not CASH),
 *             enforces cross-tenant & CRM PRIVATE contact visibility (404),
 *             refuses unsupported payment methods (400), and refuses discounts in v1 (400).
 *   - [QS-06] RBAC (revenue:write), D-46 (non-member SUPER_ADMIN refused 403),
 *             tenant isolation (cross-tenant 403), unauthenticated (401), and
 *             STAFF with explicit revenue:write admitted (201).
 *
 * Fixtures use pre-allocated prefix `v66e_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import IORedis from 'ioredis';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66e_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  staffReadA: `${P}staffReadA`,
  staffWriteA: `${P}staffWriteA`,
  ownerB: `${P}ownerB`,
  superAdmin: `${P}superAdmin`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizRace: `${P}bizRace`,
  whA: `${P}whA`,
  whRace: `${P}whRace`,
  prod1: `${P}prod1`,
  prod2: `${P}prod2`,
  prodRace: `${P}prodRace`,
  stock1: `${P}stock1`,
  stock2: `${P}stock2`,
  stockRace: `${P}stockRace`,
  contactNamedA: `${P}contactNamedA`,
  contactPrivateOwnerA: `${P}contactPrivA`,
  contactB: `${P}contactB`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
let redis: IORedis;
let subscriptionsService: any;
let marketplaceService: any;
let storeOrderService: any;
const emittedEvents: Array<{ name: string; payload: any }> = [];
/* eslint-enable @typescript-eslint/no-explicit-any */

const PREV_RATE_LIMIT_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;

async function clearRateLimits() {
  if (!redis) return;
  try {
    for (const pattern of [`pubrl:*`, `pub_rate_limit:${P}:*`, `crm_rl:*`]) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    }
  } catch {
    /* ignore */
  }
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function cleanupDynamicRows() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)} AND id NOT IN ('${ID.contactNamedA}', '${ID.contactPrivateOwnerA}', '${ID.contactB}')`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
  await db.business.update({ where: { id: ID.bizRace }, data: { defaultTaxRate: 0 } });
  await db.product.update({ where: { id: ID.prodRace }, data: { price: 60 } });
  await db.inventoryStock.update({ where: { id: ID.stock1 }, data: { quantity: 10, reserved: 0, costPerUnit: 50 } });
  await db.inventoryStock.update({ where: { id: ID.stock2 }, data: { quantity: 5, reserved: 0, costPerUnit: 30 } });
  await db.inventoryStock.update({ where: { id: ID.stockRace }, data: { quantity: 10, reserved: 0, costPerUnit: 20 } });
}

async function businessRowCounts(businessId: string) {
  const [orders, invoices, payments, ledgerTxs, ledgerEntries, stockMovements, paymentLinks, idempotencyKeys] =
    await Promise.all([
      db.marketplaceOrder.count({ where: { businessId } }),
      db.invoice.count({ where: { businessId } }),
      db.payment.count({ where: { businessId } }),
      db.financialTransaction.count({ where: { businessId } }),
      db.ledgerEntry.count({ where: { businessId } }),
      db.stockMovement.count({ where: { businessId } }),
      db.paymentLink.count({ where: { businessId } }),
      db.idempotencyKey.count({ where: { businessId } }),
    ]);
  return { orders, invoices, payments, ledgerTxs, ledgerEntries, stockMovements, paymentLinks, idempotencyKeys };
}

beforeAll(async () => {
  process.env.RATE_LIMIT_KEY_NAMESPACE = P;
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [MarketplaceController, CommerceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      MarketplaceService,
      FulfillmentRoutingService,
      CommerceIntegrationService,
      StoreOrderService,
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenueAttributionService,
      RevenuePostingService,
      ExpensePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      SubscriptionsService,
      {
        provide: EventEmitter2,
        useValue: {
          emit: (name: string, payload: unknown) => {
            emittedEvents.push({ name, payload });
            return true;
          },
          emitAsync: async (name: string, payload: unknown) => {
            emittedEvents.push({ name, payload });
            return [];
          },
          on: () => undefined,
          off: () => undefined,
          once: () => undefined,
          removeListener: () => undefined,
        },
      },
      { provide: PromoCodeService, useValue: { validate: async () => null, apply: () => ({ discount: 0, freeShipping: false }), incrementUsage: async () => {} } },
      { provide: InventoryRiskService, useValue: { evaluateProduct: async () => null } },
      { provide: TransactionalEmailService, useValue: { send: async () => undefined } },
      { provide: ExpensesService, useValue: {} },
      { provide: CrmService, useValue: { findOrCreateContact: async () => null, logContactEvent: async () => null } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();

  subscriptionsService = moduleRef.get(SubscriptionsService);
  marketplaceService = moduleRef.get(MarketplaceService);
  storeOrderService = moduleRef.get(StoreOrderService);
  const coaSeeder = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  app.use(async (req: any, _res: any, next: any) => {
    const id = typeof req.headers[HEADER] === 'string' ? req.headers[HEADER] : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();
  await clearRateLimits();

  for (const [id, email, role] of [
    [ID.ownerA, `${P}owner-a@test.local`, 'USER'],
    [ID.staffReadA, `${P}staff-read-a@test.local`, 'USER'],
    [ID.staffWriteA, `${P}staff-write-a@test.local`, 'USER'],
    [ID.ownerB, `${P}owner-b@test.local`, 'USER'],
    [ID.superAdmin, `${P}super@test.local`, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email, role } });
  }

  await db.business.create({
    data: { id: ID.bizA, name: 'V66E Counter Shop A', slug: `${P}shop-a`, ownerId: ID.ownerA, currency: 'TTD', defaultTaxRate: 0 },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V66E Counter Shop B', slug: `${P}shop-b`, ownerId: ID.ownerB, currency: 'TTD', defaultTaxRate: 0 },
  });
  await db.business.create({
    data: { id: ID.bizRace, name: 'V66E Race Shop', slug: `${P}shop-race`, ownerId: ID.ownerA, currency: 'TTD', defaultTaxRate: 0 },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}m_staffReadA`, userId: ID.staffReadA, businessId: ID.bizA, role: 'STAFF' },
      { id: `${P}m_staffWriteA`, userId: ID.staffWriteA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'write', crm: 'read' } },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
      { id: `${P}m_ownerRace`, userId: ID.ownerA, businessId: ID.bizRace, role: 'OWNER' },
    ],
  });

  await coaSeeder.ensureDefaults(ID.bizA);
  await coaSeeder.ensureDefaults(ID.bizB);
  await coaSeeder.ensureDefaults(ID.bizRace);

  await db.warehouse.createMany({
    data: [
      { id: ID.whA, businessId: ID.bizA, name: 'Main Counter Stockroom', isActive: true },
      { id: ID.whRace, businessId: ID.bizRace, name: 'Race Counter Stockroom', isActive: true },
    ],
  });

  await db.product.createMany({
    data: [
      { id: ID.prod1, businessId: ID.bizA, name: 'Trini Cocoa Tea Tin', sku: `${P}SKU1`, price: 120, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prod2, businessId: ID.bizA, name: 'Sorrel Syrup Bottle', sku: `${P}SKU2`, price: 80, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodRace, businessId: ID.bizRace, name: 'Ginger Beer Pack', sku: `${P}SKUR`, price: 60, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
    ],
  });

  await db.inventoryStock.createMany({
    data: [
      { id: ID.stock1, businessId: ID.bizA, warehouseId: ID.whA, productId: ID.prod1, quantity: 10, reserved: 0, costPerUnit: 50, currency: 'TTD' },
      { id: ID.stock2, businessId: ID.bizA, warehouseId: ID.whA, productId: ID.prod2, quantity: 5, reserved: 0, costPerUnit: 30, currency: 'TTD' },
      { id: ID.stockRace, businessId: ID.bizRace, warehouseId: ID.whRace, productId: ID.prodRace, quantity: 10, reserved: 0, costPerUnit: 20, currency: 'TTD' },
    ],
  });

  await db.contact.createMany({
    data: [
      { id: ID.contactNamedA, businessId: ID.bizA, firstName: 'Kendra', lastName: 'Baptiste', email: `${P}kendra@test.local`, visibility: 'TEAM' },
      { id: ID.contactPrivateOwnerA, businessId: ID.bizA, firstName: 'Secret', lastName: 'VIP', email: `${P}vip@test.local`, ownerId: ID.ownerA, visibility: 'PRIVATE' },
      { id: ID.contactB, businessId: ID.bizB, firstName: 'Other', lastName: 'Tenant', email: `${P}other@test.local`, visibility: 'TEAM' },
    ],
  });
});

beforeEach(async () => {
  emittedEvents.length = 0;
  await cleanupDynamicRows();
  await clearRateLimits();
});

afterAll(async () => {
  if (PREV_RATE_LIMIT_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREV_RATE_LIMIT_NS;
  if (app) await app.close();
  if (db) await cleanup();
  if (redis) await redis.quit();
});

function postQuickSale(bizId: string, body: Record<string, unknown>, actorId?: string, headers: Record<string, string> = {}) {
  const req = request(app.getHttpServer()).post(`/marketplace/businesses/${bizId}/quick-sales`);
  if (actorId) req.set(HEADER, actorId);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send(body);
}

describe('P83 — QUICK-SALE-SERVER (POST /marketplace/businesses/:businessId/quick-sales)', () => {
  it('[QS-01] two-item cash quick sale atomically writes order, PAID invoice, SUCCESSFUL payment, ledger (CASH/REVENUE), COGS (COGS/INVENTORY), decrements stock, serves public receipt token, and does NOT count toward monthly invoice cap', async () => {
    const res = await postQuickSale(
      ID.bizA,
      {
        items: [
          { productId: ID.prod1, quantity: 2 },
          { productId: ID.prod2, quantity: 1 },
        ],
        paymentMethod: 'cash',
      },
      ID.ownerA,
    );

    expect(res.status).toBe(201);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.type).toBe('QUICK_SALE');
    expect(res.body.order.paymentStatus).toBe('PAID');
    expect(res.body.order.paymentMethod).toBe('CASH');
    expect(res.body.order.total).toBe(320);
    expect(res.body.order.discountAmount).toBe(0);
    expect((res.body.order.metadata as Record<string, unknown>)?.source).toBe('QUICK_SALE');
    expect(res.body.receiptToken).toEqual(expect.any(String));
    expect(res.body.receiptToken.length).toBeGreaterThanOrEqual(20);
    expect(res.body.receiptPath).toBe(`/commerce/public/invoice-link/${res.body.receiptToken}/receipt`);

    // Order + invoice + payment persisted once
    const order = await db.marketplaceOrder.findUnique({ where: { id: res.body.order.id }, include: { items: true } });
    expect(order).not.toBeNull();
    expect(order.type).toBe('QUICK_SALE');
    expect(order.items).toHaveLength(2);

    const invoice = await db.invoice.findUnique({
      where: { id: res.body.invoice.id },
      include: { contact: true, items: true, payments: true },
    });
    expect(invoice).not.toBeNull();
    expect(invoice.status).toBe('PAID');
    expect(invoice.total).toBe(320);
    expect(invoice.items).toHaveLength(2);
    expect(invoice.contact.firstName).toBe('Walk-in');
    expect(invoice.contact.lastName).toBe('customer');
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].status).toBe('SUCCESSFUL');
    expect(invoice.payments[0].amount).toBe(320);
    expect(invoice.payments[0].method).toBe('cash');
    expect(invoice.payments[0].recordedBy).toBe(ID.ownerA);

    // Revenue + Cash ledger transaction
    const payTx = await db.financialTransaction.findFirst({
      where: { businessId: ID.bizA, sourceType: 'Payment', sourceId: invoice.payments[0].id },
      include: { entries: { include: { account: true } } },
    });
    expect(payTx).not.toBeNull();
    const cashDebit = payTx.entries.find((e: any) => e.account.systemKey === 'CASH' && Number(e.debit) > 0);
    const revCredit = payTx.entries.find((e: any) => Number(e.credit) > 0);
    expect(Number(cashDebit?.debit)).toBe(320);
    expect(Number(revCredit?.credit)).toBe(320);

    // COGS ledger transaction (2 * 50 + 1 * 30 = 130)
    const cogsTx = await db.financialTransaction.findFirst({
      where: { businessId: ID.bizA, sourceType: 'MarketplaceOrder', sourceId: order.id },
      include: { entries: { include: { account: true } } },
    });
    expect(cogsTx).not.toBeNull();
    const cogsDebit = cogsTx.entries.find((e: any) => e.account.systemKey === 'COGS' && Number(e.debit) > 0);
    const invCredit = cogsTx.entries.find((e: any) => e.account.systemKey === 'INVENTORY_ASSET' && Number(e.credit) > 0);
    expect(Number(cogsDebit?.debit)).toBe(130);
    expect(Number(invCredit?.credit)).toBe(130);

    // Stock decremented + sale movement rows written
    const [s1, s2, movements] = await Promise.all([
      db.inventoryStock.findUnique({ where: { id: ID.stock1 } }),
      db.inventoryStock.findUnique({ where: { id: ID.stock2 } }),
      db.stockMovement.findMany({ where: { businessId: ID.bizA, referenceId: order.orderNumber } }),
    ]);
    expect(s1.quantity).toBe(8);
    expect(s2.quantity).toBe(4);
    expect(movements).toHaveLength(2);
    expect(movements.every((m: any) => m.type === 'sale' && m.quantityChange < 0)).toBe(true);

    // Existing unauthenticated public receipt route serves this sale's receipt token (200)
    const receiptRes = await request(app.getHttpServer()).get(
      `/commerce/public/invoice-link/${res.body.receiptToken}/receipt`,
    );
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(receiptRes.body.status).toBe('PAID');
    expect(receiptRes.body.total).toBe(320);
    expect(receiptRes.body.amountPaid).toBe(320);
    expect(receiptRes.body.amountDue).toBe(0);
    expect(receiptRes.body.items).toHaveLength(2);
    expect(receiptRes.body.contact).toEqual({ firstName: 'Walk-in', lastName: 'customer' });

    // Plans ruling (D-160): quick-sale invoice does NOT count toward monthly invoice cap
    const limitCheck = await subscriptionsService.checkLimit(ID.bizA, 'invoices');
    expect(limitCheck.current).toBe(0);
    expect(limitCheck.allowed).toBe(true);

    const billingDashboard = await subscriptionsService.getBillingDashboard(ID.bizA);
    const invUsage = billingDashboard.resourceUsage.find((r: any) => r.key === 'invoices');
    expect(invUsage?.current).toBe(0);

    // Anti-forgery check: a regular invoice with an INV-QS-* number but no QUICK_SALE order STILL counts
    await db.invoice.create({
      data: {
        id: `${P}inv_forged_qs`,
        businessId: ID.bizA,
        contactId: ID.contactNamedA,
        invoiceNumber: `INV-QS-FORGED-${Date.now()}`,
        status: 'SENT',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
      },
    });
    const afterForge = await subscriptionsService.checkLimit(ID.bizA, 'invoices');
    expect(afterForge.current).toBe(1);
  });

  it('[QS-02] oversell (single line or summed duplicate lines) is refused 409 in plain words with ZERO rows committed', async () => {
    const beforeCounts = await businessRowCounts(ID.bizA);

    const overRes = await postQuickSale(
      ID.bizA,
      {
        items: [{ productId: ID.prod1, quantity: 11 }],
        paymentMethod: 'cash',
      },
      ID.ownerA,
    );
    expect(overRes.status).toBe(409);
    expect(overRes.body.code).toBe('INSUFFICIENT_STOCK');
    expect(String(overRes.body.message)).toContain('Trini Cocoa Tea Tin');
    expect(String(overRes.body.message)).not.toContain(ID.prod1);

    // Duplicate lines summing above available stock (6 + 5 = 11 > 10)
    const dupOverRes = await postQuickSale(
      ID.bizA,
      {
        items: [
          { productId: ID.prod1, quantity: 6 },
          { productId: ID.prod1, quantity: 5 },
        ],
        paymentMethod: 'cash',
      },
      ID.ownerA,
    );
    expect(dupOverRes.status).toBe(409);
    expect(dupOverRes.body.code).toBe('INSUFFICIENT_STOCK');

    expect(await businessRowCounts(ID.bizA)).toEqual(beforeCounts);
    expect((await db.inventoryStock.findUnique({ where: { id: ID.stock1 } })).quantity).toBe(10);
  });

  it('[QS-03] Idempotency-Key replay writes nothing and returns the original sale + receipt; different payload with same key is 409', async () => {
    const payload = {
      items: [{ productId: ID.prod1, quantity: 2 }],
      paymentMethod: 'cash',
    };

    const first = await postQuickSale(ID.bizA, payload, ID.ownerA, { 'Idempotency-Key': `${P}idem-1` });
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);

    const afterFirst = await businessRowCounts(ID.bizA);
    expect((await db.inventoryStock.findUnique({ where: { id: ID.stock1 } })).quantity).toBe(8);

    // Replay identical request -> same ids/token, zero extra writes
    const replay = await postQuickSale(ID.bizA, payload, ID.ownerA, { 'Idempotency-Key': `${P}idem-1` });
    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect(replay.body.invoice.id).toBe(first.body.invoice.id);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.receiptToken).toBe(first.body.receiptToken);

    expect(await businessRowCounts(ID.bizA)).toEqual(afterFirst);
    expect((await db.inventoryStock.findUnique({ where: { id: ID.stock1 } })).quantity).toBe(8);

    // Different payload under the same Idempotency-Key -> 409 Conflict, zero extra writes
    const mismatch = await postQuickSale(
      ID.bizA,
      { items: [{ productId: ID.prod1, quantity: 3 }], paymentMethod: 'cash' },
      ID.ownerA,
      { 'Idempotency-Key': `${P}idem-1` },
    );
    expect(mismatch.status).toBe(409);
    expect(await businessRowCounts(ID.bizA)).toEqual(afterFirst);
  });

  it('[QS-04] concurrent first sales on a brand-new business create EXACTLY ONE Walk-in customer contact and decrement stock accurately', async () => {
    const contactsBefore = await db.contact.count({ where: { businessId: ID.bizRace } });
    expect(contactsBefore).toBe(0);

    const results = await Promise.all([
      postQuickSale(ID.bizRace, { items: [{ productId: ID.prodRace, quantity: 2 }], paymentMethod: 'cash' }, ID.ownerA),
      postQuickSale(ID.bizRace, { items: [{ productId: ID.prodRace, quantity: 3 }], paymentMethod: 'bank_transfer' }, ID.ownerA),
      postQuickSale(ID.bizRace, { items: [{ productId: ID.prodRace, quantity: 1 }], paymentMethod: 'cash' }, ID.ownerA),
    ]);

    for (const r of results) {
      expect(r.status).toBe(201);
    }

    const walkInContacts = await db.contact.findMany({ where: { businessId: ID.bizRace } });
    expect(walkInContacts).toHaveLength(1);
    expect(walkInContacts[0].firstName).toBe('Walk-in');
    expect(walkInContacts[0].lastName).toBe('customer');

    const invoices = await db.invoice.findMany({ where: { businessId: ID.bizRace } });
    expect(invoices).toHaveLength(3);
    for (const inv of invoices) {
      expect(inv.contactId).toBe(walkInContacts[0].id);
    }

    // 10 - (2 + 3 + 1) = 4
    expect((await db.inventoryStock.findUnique({ where: { id: ID.stockRace } })).quantity).toBe(4);
  });

  it('[QS-05] bank_transfer with named contact debits BANK, enforces CRM contact visibility & cross-tenant isolation, and rejects unsupported payment methods & discounts in v1', async () => {
    const ok = await postQuickSale(
      ID.bizA,
      {
        items: [{ productId: ID.prod2, quantity: 2 }],
        paymentMethod: 'bank_transfer',
        contactId: ID.contactNamedA,
      },
      ID.ownerA,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.order.paymentMethod).toBe('BANK_TRANSFER');
    expect(ok.body.invoice.contactId).toBe(ID.contactNamedA);

    const payTx = await db.financialTransaction.findFirst({
      where: { businessId: ID.bizA, sourceType: 'Payment', sourceId: ok.body.payment.id },
      include: { entries: { include: { account: true } } },
    });
    expect(payTx).not.toBeNull();
    const bankDebit = payTx.entries.find((e: any) => e.account.systemKey === 'BANK' && Number(e.debit) > 0);
    expect(Number(bankDebit?.debit)).toBe(160);

    const receiptRes = await request(app.getHttpServer()).get(
      `/commerce/public/invoice-link/${ok.body.receiptToken}/receipt`,
    );
    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.contact).toEqual({ firstName: 'Kendra', lastName: 'Baptiste' });

    const countsAfterOk = await businessRowCounts(ID.bizA);

    // Cross-tenant contactId refused 404
    const foreignContact = await postQuickSale(
      ID.bizA,
      { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'cash', contactId: ID.contactB },
      ID.ownerA,
    );
    expect(foreignContact.status).toBe(404);

    // PRIVATE contact owned by ownerA refused 404 when called by staffWriteA
    const privateContact = await postQuickSale(
      ID.bizA,
      { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'cash', contactId: ID.contactPrivateOwnerA },
      ID.staffWriteA,
    );
    expect(privateContact.status).toBe(404);

    // Unsupported payment method refused 400
    const badMethod = await postQuickSale(
      ID.bizA,
      { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'stripe' },
      ID.ownerA,
    );
    expect(badMethod.status).toBe(400);

    // Discount refused 400 in v1 (taxorder ruling D-164)
    const withDiscount = await postQuickSale(
      ID.bizA,
      { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'cash', discountAmount: 10 },
      ID.ownerA,
    );
    expect(withDiscount.status).toBe(400);

    expect(await businessRowCounts(ID.bizA)).toEqual(countsAfterOk);
  });

  it('[QS-06] RBAC (revenue:write), D-46 (non-member SUPER_ADMIN refused 403), cross-tenant refused 403, unauthenticated refused 401, STAFF with revenue:write admitted', async () => {
    const before = await businessRowCounts(ID.bizA);
    const body = { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'cash' };

    // Unauthenticated -> 401
    expect((await postQuickSale(ID.bizA, body)).status).toBe(401);

    // STAFF with default revenue:read -> 403
    expect((await postQuickSale(ID.bizA, body, ID.staffReadA)).status).toBe(403);

    // Cross-tenant OWNER of bizB -> 403
    expect((await postQuickSale(ID.bizA, body, ID.ownerB)).status).toBe(403);

    // D-46: non-member SUPER_ADMIN -> 403
    expect((await postQuickSale(ID.bizA, body, ID.superAdmin)).status).toBe(403);

    expect(await businessRowCounts(ID.bizA)).toEqual(before);

    // STAFF with explicit revenue:write -> 201
    const staffOk = await postQuickSale(ID.bizA, body, ID.staffWriteA);
    expect(staffOk.status).toBe(201);
    expect(staffOk.body.payment.status).toBe('SUCCESSFUL');
  });

  it('[QS-07] SEC-QS-1: Idempotency-Key binds to actorId and checks named contact CRM visibility BEFORE replay', async () => {
    const idemKey = `${P}priv-idem-1`;
    const privBody = {
      items: [{ productId: ID.prod2, quantity: 1 }],
      paymentMethod: 'cash',
      contactId: ID.contactPrivateOwnerA,
    };

    // Owner creates quick sale for their own PRIVATE contact
    const first = await postQuickSale(ID.bizA, privBody, ID.ownerA, { 'Idempotency-Key': idemKey });
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.invoice.contactId).toBe(ID.contactPrivateOwnerA);

    // Another member (staffWriteA) sending the SAME Idempotency-Key + SAME payload
    // must get 404 (contact visibility check runs BEFORE readReplay; never 201 PII leak or 409 oracle)
    const staffSame = await postQuickSale(ID.bizA, privBody, ID.staffWriteA, { 'Idempotency-Key': idemKey });
    expect(staffSame.status).toBe(404);

    // Even if staffWriteA sends a non-private payload with ownerA's Idempotency-Key,
    // requestHash includes actorId -> 409 conflict, never replays ownerA's private receipt
    const staffOther = await postQuickSale(
      ID.bizA,
      { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'cash' },
      ID.staffWriteA,
      { 'Idempotency-Key': idemKey },
    );
    expect(staffOther.status).toBe(409);

    // Owner replaying with the same key still succeeds cleanly
    const ownerReplay = await postQuickSale(ID.bizA, privBody, ID.ownerA, { 'Idempotency-Key': idemKey });
    expect(ownerReplay.status).toBe(201);
    expect(ownerReplay.body.replayed).toBe(true);
    expect(ownerReplay.body.order.id).toBe(first.body.order.id);
    expect(ownerReplay.body.receiptToken).toBe(first.body.receiptToken);
  });

  it('[QS-08] CONC-QS-2: concurrent identical Idempotency-Key retries on last unit of stock both return 201 with identical IDs and zero INSUFFICIENT_STOCK errors', async () => {
    await db.inventoryStock.update({ where: { id: ID.stock2 }, data: { quantity: 1, reserved: 0 } });
    const idemKey = `${P}last-unit-idem`;
    const body = { items: [{ productId: ID.prod2, quantity: 1 }], paymentMethod: 'cash' };

    const [r1, r2] = await Promise.all([
      postQuickSale(ID.bizA, body, ID.ownerA, { 'Idempotency-Key': idemKey }),
      postQuickSale(ID.bizA, body, ID.ownerA, { 'Idempotency-Key': idemKey }),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.order.id).toBe(r2.body.order.id);
    expect(r1.body.invoice.id).toBe(r2.body.invoice.id);
    expect(r1.body.payment.id).toBe(r2.body.payment.id);
    expect(r1.body.receiptToken).toBe(r2.body.receiptToken);
    expect([r1.body.replayed, r2.body.replayed].sort()).toEqual([false, true]);

    expect((await db.inventoryStock.findUnique({ where: { id: ID.stock2 } })).quantity).toBe(0);
    expect(await db.marketplaceOrder.count({ where: { businessId: ID.bizA } })).toBe(1);
    expect(await db.payment.count({ where: { businessId: ID.bizA } })).toBe(1);
  });

  it('[QS-09] FIN-QS-4: QUICK_SALE order refuses post-checkout status edits and non-refund fulfillOrder actions across HTTP and service doors', async () => {
    const created = await postQuickSale(
      ID.bizRace,
      { items: [{ productId: ID.prodRace, quantity: 1 }], paymentMethod: 'cash' },
      ID.ownerA,
    );
    expect(created.status).toBe(201);
    const qsOrderId: string = created.body.order.id;

    // HTTP PATCH /marketplace/businesses/:businessId/orders/:orderId/status -> 400
    for (const status of ['placed', 'cancelled', 'processing']) {
      const res = await request(app.getHttpServer())
        .patch(`/marketplace/businesses/${ID.bizRace}/orders/${qsOrderId}/status`)
        .set(HEADER, ID.ownerA)
        .send({ status });
      expect(res.status).toBe(400);
    }

    // StoreOrderService.updateOrderStatus -> rejects BadRequestException
    await expect(storeOrderService.updateOrderStatus(qsOrderId, 'CANCELLED', ID.bizRace)).rejects.toThrow(/quick sale/i);
    await expect(storeOrderService.updateOrderStatus(qsOrderId, 'PENDING', ID.bizRace)).rejects.toThrow(/quick sale/i);

    // MarketplaceService.fulfillOrder non-refund actions -> rejects BadRequestException
    await expect(
      marketplaceService.fulfillOrder(ID.bizRace, qsOrderId, { action: 'cancel' }, ID.ownerA),
    ).rejects.toThrow(/quick sale/i);
    await expect(
      marketplaceService.fulfillOrder(ID.bizRace, qsOrderId, { action: 'process' }, ID.ownerA),
    ).rejects.toThrow(/quick sale/i);

    // Order remains COMPLETED / PAID untouched
    const order = await db.marketplaceOrder.findUnique({ where: { id: qsOrderId } });
    expect(order.status).toBe('COMPLETED');
    expect(order.paymentStatus).toBe('PAID');
  });

  it('[QS-10] COR-QS-1 & COR-QS-2: persists invoice.taxRate, uses D-13 integer-cents rounding (10.04 @ 12.5% -> 1.26 tax / 11.30 total), and refuses quantity > 1_000_000', async () => {
    await db.business.update({ where: { id: ID.bizRace }, data: { defaultTaxRate: 12.5 } });
    await db.product.update({ where: { id: ID.prodRace }, data: { price: 10.04 } });

    const res = await postQuickSale(
      ID.bizRace,
      { items: [{ productId: ID.prodRace, quantity: 1 }], paymentMethod: 'cash' },
      ID.ownerA,
    );
    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe(10.04);
    expect(res.body.order.taxAmount).toBe(1.26);
    expect(res.body.order.total).toBe(11.3);

    const invoice = await db.invoice.findUnique({ where: { id: res.body.invoice.id } });
    expect(invoice).not.toBeNull();
    expect(invoice.taxRate).toBe(12.5);
    expect(invoice.subtotal).toBe(10.04);
    expect(invoice.taxAmount).toBe(1.26);
    expect(invoice.total).toBe(11.3);

    // Quantity cap (> 1_000_000) refused 400
    const hugeQty = await postQuickSale(
      ID.bizRace,
      { items: [{ productId: ID.prodRace, quantity: 1_000_001 }], paymentMethod: 'cash' },
      ID.ownerA,
    );
    expect(hugeQty.status).toBe(400);
  });
});
