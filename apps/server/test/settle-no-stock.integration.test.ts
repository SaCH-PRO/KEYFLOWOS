/**
 * P130 — V1-70 (W1F-SETTLE-NO-STOCK, owner ruling D-199 `paidnostock`):
 *
 * 1. When a provider online settlement (Stripe card or PayPal — NOT offline
 *    cash/manual completion) completes for an order whose own stock is genuinely
 *    missing or insufficient (or whose business has no active warehouse):
 *    - Record the payment (PAID invoice, SUCCESSFUL payment row, balanced ledger
 *      revenue posting — never drop the customer's paid money),
 *    - Keep the order (CONFIRMED / PAID — never fail or roll back),
 *    - Leave stock untouched (no negative stock, no sale StockMovement, no bogus
 *      COGS for lines where stock was not taken; sufficient sibling lines still
 *      decrement and post COGS normally),
 *    - Alert the business ONCE via a durable Notification
 *      (`store_order.stock_not_decremented`) instructing it to restock or refund.
 *
 * 2. Single alert (no double email): after such a provider settlement with
 *    missing/insufficient stock, FulfillmentRoutingService (`routeOrder`) marks
 *    the route FAILED for stock but does NOT also send a duplicate
 *    `seller_low_stock` email for the same line. Control: a non-checkout-alerted
 *    order routed with insufficient stock STILL sends `seller_low_stock`.
 *
 * 3. Offline cash/manual completion (`completeOfflineOrder`) MUST KEEP its
 *    refusal when stock is missing or insufficient (no invoice, no payment, no
 *    posting, no notification).
 *
 * 4. Business-scoped stock reads: `CommerceIntelligenceService.recommendFulfillmentStrategy`
 *    and `MarketplaceService.getWarehouses` scope `inventoryStocks` with
 *    `ownStockRows(businessId)` so another business's planted stock rows are
 *    never counted or returned.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v70e_` prefix and is
 * hard-deleted by raw SQL (`sqlLikePrefix`) in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v70e_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  ownerNoWh: `${P}ownerNoWh`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizNoWh: `${P}bizNoWh`,
  whA: `${P}whA`,
  whB: `${P}whB`,
  contactA: `${P}contactA`,
  contactNoWh: `${P}contactNoWh`,
  prodInsufficient: `${P}prodInsufficient`,
  prodMissing: `${P}prodMissing`,
  prodSufficient: `${P}prodSufficient`,
  prodNoWh: `${P}prodNoWh`,
  prodIntel: `${P}prodIntel`,
  prodB: `${P}prodB`,
  prodControl: `${P}prodControl`,
  stockInsufficient: `${P}stockInsufficient`,
  stockSufficient: `${P}stockSufficient`,
  stockIntelOwn: `${P}stockIntelOwn`,
  stockPlantedOnProdA: `${P}stockPlantedOnProdA`,
  stockPlantedInWhA: `${P}stockPlantedInWhA`,
  stockControl: `${P}stockControl`,
};

const NAMES = {
  insufficient: 'Limited Hibiscus Syrup',
  missing: 'Seasonal Sorrel Concentrate',
  sufficient: 'Everyday Ginger Beer',
  noWh: 'Warehouse-Less Pepper Sauce',
  intel: 'Scoped Strategy Bottle',
  prodB: 'Foreign Tenant Secret Item',
  control: 'Standard Order Control Item',
};

let db: any;
let moduleRef: any;
let storeOrders: any;
let routing: any;
let routingListener: any;
let commerceIntel: any;
let marketplace: any;
let events: any;
let emailSent: Array<Record<string, any>> = [];
let aiPrompts: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function resetMutableStocks() {
  await db.inventoryStock.update({
    where: { id: ID.stockInsufficient },
    data: { quantity: 2, reserved: 0, costPerUnit: 15 },
  });
  await db.inventoryStock.update({
    where: { id: ID.stockSufficient },
    data: { quantity: 10, reserved: 0, costPerUnit: 20 },
  });
  await db.inventoryStock.update({
    where: { id: ID.stockControl },
    data: { quantity: 1, reserved: 0, costPerUnit: 10 },
  });
}

async function seedOrder(opts: {
  id: string;
  businessId: string;
  orderNumber: string;
  type?: string;
  status?: string;
  paymentMethod: string;
  paymentStatus: string;
  customerEmail: string;
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number }>;
}) {
  const subtotal = opts.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  return db.marketplaceOrder.create({
    data: {
      id: opts.id,
      businessId: opts.businessId,
      orderNumber: opts.orderNumber,
      type: opts.type ?? 'STOREFRONT',
      status: opts.status ?? 'PENDING',
      customerName: 'Test Customer',
      customerEmail: opts.customerEmail,
      subtotal,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: subtotal,
      currency: 'USD',
      paymentMethod: opts.paymentMethod,
      paymentStatus: opts.paymentStatus,
      items: {
        create: opts.items.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.unitPrice * i.quantity,
          currency: 'USD',
        })),
      },
    },
    include: { items: true },
  });
}

async function stockNoticesForOrder(businessId: string, orderId: string) {
  const all = await db.notification.findMany({
    where: { businessId, type: 'store_order.stock_not_decremented' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return all.filter((n: any) => (n.data as any)?.orderId === orderId);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { CommerceIntelligenceService } = await import('../src/modules/commerce/commerce-intelligence.service');
  const { LandedCostEngine } = await import('../src/modules/commerce/landed-cost-engine.service');
  const { MarginAnalysisService } = await import('../src/modules/commerce/margin-analysis.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');

  Logger.overrideLogger(false);

  events = new EventEmitter2();

  const emailSpy = {
    send: vi.fn(async (payload: Record<string, any>) => {
      emailSent.push(payload);
      return { sent: true };
    }),
  };

  const aiUsageSpy = {
    callAi: vi.fn(async (req: any) => {
      const sys = Array.isArray(req?.messages) ? req.messages.map((m: any) => m.content).join('\n') : '';
      aiPrompts.push(sys);
      return {
        content: JSON.stringify({
          recommendedModel: 'local_stock',
          confidence: 0.9,
          reasoning: 'stubbed',
          tradeoffs: [],
          actionSteps: [],
        }),
      };
    }),
  };

  moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      { provide: EventEmitter2, useValue: events },
      PostingService,
      ChartOfAccountsSeederService,
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      RevenuePostingService,
      ExpensePostingService,
      InvoiceWorkflowService,
      RevenueAttributionService,
      InventoryRiskService,
      StoreOrderService,
      FulfillmentRoutingService,
      StoreOrderRoutingListener,
      LandedCostEngine,
      MarginAnalysisService,
      CommerceIntelligenceService,
      MarketplaceService,
      { provide: PromoCodeService, useValue: { validate: async () => null, apply: () => ({ discount: 0, freeShipping: false }), incrementUsage: async () => {} } },
      {
        provide: CrmService,
        useValue: {
          findOrCreateContact: async (businessId: string) => ({
            id: businessId === ID.bizNoWh ? ID.contactNoWh : ID.contactA,
          }),
        },
      },
      { provide: PublicEventsService, useValue: { logStorefrontEvent: async () => undefined } },
      { provide: TransactionalEmailService, useValue: emailSpy },
      { provide: CommerceIntegrationService, useValue: {} },
      { provide: AiUsageService, useValue: aiUsageSpy },
    ],
  }).compile();

  await moduleRef.init();

  storeOrders = moduleRef.get(StoreOrderService);
  routing = moduleRef.get(FulfillmentRoutingService);
  routingListener = moduleRef.get(StoreOrderRoutingListener);
  commerceIntel = moduleRef.get(CommerceIntelligenceService);
  marketplace = moduleRef.get(MarketplaceService);

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@example.test`, role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@example.test`, role: 'USER' },
      { id: ID.ownerNoWh, email: `${P}ownerNoWh@example.test`, role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V70E Store A', slug: `${P}store-a`, email: `${P}bizA@example.test`, ownerId: ID.ownerA, storeEnabled: true, currency: 'USD' },
      { id: ID.bizB, name: 'V70E Store B', slug: `${P}store-b`, email: `${P}bizB@example.test`, ownerId: ID.ownerB, storeEnabled: true, currency: 'USD' },
      { id: ID.bizNoWh, name: 'V70E No-Warehouse Store', slug: `${P}store-nowh`, email: `${P}bizNoWh@example.test`, ownerId: ID.ownerNoWh, storeEnabled: true, currency: 'USD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}memA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { id: `${P}memB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
      { id: `${P}memNoWh`, userId: ID.ownerNoWh, businessId: ID.bizNoWh, role: 'OWNER' },
    ],
  });

  await db.contact.createMany({
    data: [
      { id: ID.contactA, businessId: ID.bizA, firstName: 'Buyer', lastName: 'Alpha', email: `${P}buyerA@example.test` },
      { id: ID.contactNoWh, businessId: ID.bizNoWh, firstName: 'Buyer', lastName: 'NoWh', email: `${P}buyerNoWh@example.test` },
    ],
  });

  await db.warehouse.createMany({
    data: [
      { id: ID.whA, businessId: ID.bizA, name: 'Main Depot A', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: ID.whB, businessId: ID.bizB, name: 'Foreign Depot B', isActive: true, createdAt: new Date('2026-01-02T00:00:00Z') },
    ],
  });

  await db.product.createMany({
    data: [
      { id: ID.prodInsufficient, businessId: ID.bizA, name: NAMES.insufficient, price: 25, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodMissing, businessId: ID.bizA, name: NAMES.missing, price: 40, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodSufficient, businessId: ID.bizA, name: NAMES.sufficient, price: 30, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodNoWh, businessId: ID.bizNoWh, name: NAMES.noWh, price: 35, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodIntel, businessId: ID.bizA, name: NAMES.intel, price: 50, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodB, businessId: ID.bizB, name: NAMES.prodB, price: 99, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      { id: ID.prodControl, businessId: ID.bizA, name: NAMES.control, price: 20, currency: 'USD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
    ],
  });

  await db.inventoryStock.createMany({
    data: [
      { id: ID.stockInsufficient, businessId: ID.bizA, productId: ID.prodInsufficient, warehouseId: ID.whA, quantity: 2, reserved: 0, costPerUnit: 15, currency: 'USD' },
      { id: ID.stockSufficient, businessId: ID.bizA, productId: ID.prodSufficient, warehouseId: ID.whA, quantity: 10, reserved: 0, costPerUnit: 20, currency: 'USD' },
      { id: ID.stockIntelOwn, businessId: ID.bizA, productId: ID.prodIntel, warehouseId: ID.whA, quantity: 3, reserved: 0, costPerUnit: 12, currency: 'USD' },
      // Cross-tenant planted rows (D-137):
      // 1) B's row sitting on A's product (in B's warehouse) -> must NOT count in A's recommendFulfillmentStrategy
      { id: ID.stockPlantedOnProdA, businessId: ID.bizB, productId: ID.prodIntel, warehouseId: ID.whB, quantity: 500, reserved: 0, costPerUnit: 1, currency: 'USD' },
      // 2) B's row sitting in A's warehouse (for B's product) -> must NOT appear in A's getWarehouses
      { id: ID.stockPlantedInWhA, businessId: ID.bizB, productId: ID.prodB, warehouseId: ID.whA, quantity: 777, reserved: 0, costPerUnit: 1, currency: 'USD' },
      { id: ID.stockControl, businessId: ID.bizA, productId: ID.prodControl, warehouseId: ID.whA, quantity: 1, reserved: 0, costPerUnit: 10, currency: 'USD' },
    ],
  });
});

beforeEach(async () => {
  emailSent = [];
  aiPrompts = [];
  await resetMutableStocks();
});

afterAll(async () => {
  if (moduleRef) await moduleRef.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
});

describe('V1-70 (W1F-SETTLE-NO-STOCK, D-199 paidnostock)', () => {
  it('SNS-01 Stripe online settlement with genuinely insufficient own stock records the payment, keeps the order CONFIRMED/PAID, leaves stock untouched with no COGS, and alerts the business once to restock or refund', async () => {
    const order = await seedOrder({
      id: `${P}ord_stripe_insuff`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-STRIPE-INSUFF`,
      paymentMethod: 'STRIPE',
      paymentStatus: 'UNPAID',
      customerEmail: `${P}buyerA@example.test`,
      items: [{ productId: ID.prodInsufficient, name: NAMES.insufficient, quantity: 5, unitPrice: 25 }],
    });
    const providerPaymentId = `${P}pi_stripe_insuff_1`;
    const bNoticesBefore = await db.notification.count({ where: { businessId: ID.bizB } });

    const settled = await storeOrders.updatePaymentStatus(order.id, 'PAID', providerPaymentId, 'stripe');

    expect(settled.status).toBe('CONFIRMED');
    expect(settled.paymentStatus).toBe('PAID');
    expect(settled.paymentRef).toBe(providerPaymentId);

    // Payment + Invoice + Revenue ledger posting all recorded.
    const invoice = await db.invoice.findFirst({
      where: { businessId: ID.bizA, invoiceNumber: `INV-${order.orderNumber}` },
    });
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe('PAID');
    expect(Number(invoice.total)).toBe(125);

    const payments = await db.payment.findMany({
      where: { businessId: ID.bizA, invoiceId: invoice.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].provider).toBe('stripe');
    expect(payments[0].providerPaymentId).toBe(providerPaymentId);
    expect(payments[0].status).toBe('SUCCESSFUL');
    expect(Number(payments[0].amount)).toBe(125);

    const postings = await db.financialTransaction.findMany({
      where: { businessId: ID.bizA, sourceType: 'Payment', sourceId: payments[0].id },
    });
    expect(postings).toHaveLength(1);

    // Stock was NOT decremented (never negative, no partial consumption, no sale movement, no bogus COGS).
    const stockAfter = await db.inventoryStock.findUnique({ where: { id: ID.stockInsufficient } });
    expect(stockAfter.quantity).toBe(2);
    const movements = await db.stockMovement.findMany({
      where: { businessId: ID.bizA, referenceId: order.orderNumber },
    });
    expect(movements).toHaveLength(0);
    const cogs = await db.financialTransaction.findMany({
      where: { businessId: ID.bizA, sourceType: 'MarketplaceOrder', sourceId: order.id },
    });
    expect(cogs).toHaveLength(0);

    // Durable alert created ONCE for bizA instructing to restock or refund; bizB untouched.
    const notices = await stockNoticesForOrder(ID.bizA, order.id);
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain(order.orderNumber);
    expect(notices[0].body).toContain(NAMES.insufficient);
    expect(notices[0].body.toLowerCase()).toContain('restock');
    expect(notices[0].body.toLowerCase()).toContain('refund');
    expect(notices[0].body).not.toContain(ID.prodInsufficient);
    expect((notices[0].data as any).provider).toBe('stripe');
    expect((notices[0].data as any).products).toEqual([
      expect.objectContaining({ productId: ID.prodInsufficient, quantity: 5, available: 2 }),
    ]);
    expect(await db.notification.count({ where: { businessId: ID.bizB } })).toBe(bNoticesBefore);

    // Redelivery / idempotency: no second payment or notification.
    await storeOrders.updatePaymentStatus(order.id, 'PAID', providerPaymentId, 'stripe');
    expect(await db.payment.count({ where: { businessId: ID.bizA, invoiceId: invoice.id } })).toBe(1);
    expect(await stockNoticesForOrder(ID.bizA, order.id)).toHaveLength(1);
  });

  it('SNS-02 PayPal online settlement with genuinely missing own stock row alongside a sufficient own-stock line records payment, decrements only the sufficient line with its COGS, and alerts only for the missing line', async () => {
    const order = await seedOrder({
      id: `${P}ord_paypal_mixed`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-PAYPAL-MIXED`,
      paymentMethod: 'PAYPAL',
      paymentStatus: 'UNPAID',
      customerEmail: `${P}buyerA@example.test`,
      items: [
        { productId: ID.prodMissing, name: NAMES.missing, quantity: 2, unitPrice: 40 },
        { productId: ID.prodSufficient, name: NAMES.sufficient, quantity: 1, unitPrice: 30 },
      ],
    });
    const providerPaymentId = `${P}cap_paypal_mixed_1`;

    const settled = await storeOrders.updatePaymentStatus(order.id, 'PAID', providerPaymentId, 'paypal');

    expect(settled.status).toBe('CONFIRMED');
    expect(settled.paymentStatus).toBe('PAID');

    const invoice = await db.invoice.findFirst({
      where: { businessId: ID.bizA, invoiceNumber: `INV-${order.orderNumber}` },
    });
    expect(invoice?.status).toBe('PAID');
    expect(Number(invoice.total)).toBe(110);

    const payment = await db.payment.findFirst({
      where: { businessId: ID.bizA, invoiceId: invoice.id },
    });
    expect(payment?.provider).toBe('paypal');
    expect(payment?.providerPaymentId).toBe(providerPaymentId);
    expect(payment?.status).toBe('SUCCESSFUL');

    // Sufficient sibling line decremented once with 1 movement and its COGS (20) alone.
    const suffStock = await db.inventoryStock.findUnique({ where: { id: ID.stockSufficient } });
    expect(suffStock.quantity).toBe(9);
    const movements = await db.stockMovement.findMany({
      where: { businessId: ID.bizA, referenceId: order.orderNumber },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].productId).toBe(ID.prodSufficient);
    expect(movements[0].quantityChange).toBe(-1);

    const cogs = await db.financialTransaction.findMany({
      where: { businessId: ID.bizA, sourceType: 'MarketplaceOrder', sourceId: order.id },
    });
    expect(cogs).toHaveLength(1);
    expect(Number(cogs[0].amount)).toBe(20);

    // One alert naming ONLY the missing-stock line (not the sufficient line).
    const notices = await stockNoticesForOrder(ID.bizA, order.id);
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain(NAMES.missing);
    expect(notices[0].body).not.toContain(NAMES.sufficient);
    expect(notices[0].body.toLowerCase()).toContain('restock');
    expect(notices[0].body.toLowerCase()).toContain('refund');
    expect((notices[0].data as any).provider).toBe('paypal');
    expect((notices[0].data as any).products).toEqual([
      expect.objectContaining({ productId: ID.prodMissing, quantity: 2, available: 0 }),
    ]);
  });

  it('SNS-03 Provider online settlement when business has no active warehouse still records the payment, keeps the order, and alerts to restock or refund', async () => {
    const order = await seedOrder({
      id: `${P}ord_stripe_nowh`,
      businessId: ID.bizNoWh,
      orderNumber: `${P}ORD-STRIPE-NOWH`,
      paymentMethod: 'STRIPE',
      paymentStatus: 'UNPAID',
      customerEmail: `${P}buyerNoWh@example.test`,
      items: [{ productId: ID.prodNoWh, name: NAMES.noWh, quantity: 1, unitPrice: 35 }],
    });
    const providerPaymentId = `${P}pi_stripe_nowh_1`;

    const settled = await storeOrders.updatePaymentStatus(order.id, 'PAID', providerPaymentId, 'stripe');

    expect(settled.status).toBe('CONFIRMED');
    expect(settled.paymentStatus).toBe('PAID');

    const invoice = await db.invoice.findFirst({
      where: { businessId: ID.bizNoWh, invoiceNumber: `INV-${order.orderNumber}` },
    });
    expect(invoice?.status).toBe('PAID');
    const payment = await db.payment.findFirst({
      where: { businessId: ID.bizNoWh, invoiceId: invoice.id },
    });
    expect(payment?.status).toBe('SUCCESSFUL');

    const notices = await stockNoticesForOrder(ID.bizNoWh, order.id);
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain(NAMES.noWh);
    expect(notices[0].body.toLowerCase()).toContain('restock');
    expect(notices[0].body.toLowerCase()).toContain('refund');
  });

  it('SNS-04 Single alert: fulfillment routing after a provider shortfall settlement does NOT also send seller_low_stock email for that line (while a non-checkout-alerted shortfall order still sends seller_low_stock)', async () => {
    // 1) Insufficient own stock settled by Stripe, then routed via StoreOrderRoutingListener
    const stripeOrder = await seedOrder({
      id: `${P}ord_route_insuff`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-ROUTE-INSUFF`,
      paymentMethod: 'STRIPE',
      paymentStatus: 'UNPAID',
      customerEmail: `${P}buyerA@example.test`,
      items: [
        { productId: ID.prodInsufficient, name: NAMES.insufficient, quantity: 4, unitPrice: 25 },
        { productId: ID.prodSufficient, name: NAMES.sufficient, quantity: 1, unitPrice: 30 },
      ],
    });

    await storeOrders.updatePaymentStatus(stripeOrder.id, 'PAID', `${P}pi_route_insuff`, 'stripe');
    await routingListener.onStoreOrderPaid({ order: { id: stripeOrder.id }, businessId: ID.bizA });
    // Also verify direct routeOrder call does not send anything extra.
    await routing.routeOrder(ID.bizA, stripeOrder.id);
    await new Promise((r) => setTimeout(r, 50));

    const stripeRoutes = await db.fulfillmentRoute.findMany({
      where: { businessId: ID.bizA, orderId: stripeOrder.id },
    });
    const itemById = new Map((stripeOrder.items as any[]).map((i) => [i.id, i.productId]));
    const statusByProd = new Map(stripeRoutes.map((r: any) => [itemById.get(r.orderItemId), r.status]));
    expect(statusByProd.get(ID.prodInsufficient)).toBe('FAILED');
    expect(statusByProd.get(ID.prodSufficient)).toBe('RESERVED');

    // One checkout notification, ZERO duplicate seller_low_stock emails.
    expect(await stockNoticesForOrder(ID.bizA, stripeOrder.id)).toHaveLength(1);
    expect(emailSent.filter((e) => e.type === 'seller_low_stock')).toHaveLength(0);

    // 2) Missing own stock row settled by PayPal, then routed
    const paypalOrder = await seedOrder({
      id: `${P}ord_route_missing`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-ROUTE-MISSING`,
      paymentMethod: 'PAYPAL',
      paymentStatus: 'UNPAID',
      customerEmail: `${P}buyerA@example.test`,
      items: [{ productId: ID.prodMissing, name: NAMES.missing, quantity: 1, unitPrice: 40 }],
    });

    await storeOrders.updatePaymentStatus(paypalOrder.id, 'PAID', `${P}cap_route_missing`, 'paypal');
    await routingListener.onStoreOrderPaid({ order: { id: paypalOrder.id }, businessId: ID.bizA });
    await new Promise((r) => setTimeout(r, 50));

    const paypalRoutes = await db.fulfillmentRoute.findMany({
      where: { businessId: ID.bizA, orderId: paypalOrder.id },
    });
    expect(paypalRoutes).toHaveLength(1);
    expect(paypalRoutes[0].status).toBe('FAILED');
    expect(await stockNoticesForOrder(ID.bizA, paypalOrder.id)).toHaveLength(1);
    expect(emailSent.filter((e) => e.type === 'seller_low_stock')).toHaveLength(0);

    // 3) Control: a STANDARD order routed directly with insufficient stock (not checkout-alerted)
    //    STILL sends seller_low_stock email once.
    const controlOrder = await seedOrder({
      id: `${P}ord_route_control`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-ROUTE-CTRL`,
      type: 'STANDARD',
      status: 'paid',
      paymentMethod: 'MANUAL',
      paymentStatus: 'PAID',
      customerEmail: `${P}buyerA@example.test`,
      items: [{ productId: ID.prodControl, name: NAMES.control, quantity: 3, unitPrice: 20 }],
    });
    await routing.routeOrder(ID.bizA, controlOrder.id);
    // Give fire-and-forget notifyInsufficientStock promise a turn to invoke emailSpy.send
    await new Promise((r) => setTimeout(r, 50));

    const controlEmails = emailSent.filter(
      (e) => e.type === 'seller_low_stock' && e.templateData?.orderId === controlOrder.id,
    );
    expect(controlEmails).toHaveLength(1);
  });

  it('SNS-05 Offline CASH and MANUAL completions MUST KEEP their refusal on insufficient or missing stock (zero invoice, payment, posting, or notification)', async () => {
    // CASH order with insufficient own stock (need 5, have 2)
    const cashOrder = await seedOrder({
      id: `${P}ord_cash_insuff`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-CASH-INSUFF`,
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      customerEmail: `${P}buyerA@example.test`,
      items: [{ productId: ID.prodInsufficient, name: NAMES.insufficient, quantity: 5, unitPrice: 25 }],
    });

    let cashErr: any;
    try {
      await storeOrders.completeOfflineOrder(cashOrder.id, ID.bizA, ID.ownerA);
    } catch (e) {
      cashErr = e;
    }
    expect(cashErr).toBeTruthy();
    expect(cashErr.getStatus?.()).toBe(409);
    expect(await db.invoice.findFirst({ where: { businessId: ID.bizA, invoiceNumber: `INV-${cashOrder.orderNumber}` } })).toBeNull();
    expect(await stockNoticesForOrder(ID.bizA, cashOrder.id)).toHaveLength(0);
    const cashReload = await db.marketplaceOrder.findUnique({ where: { id: cashOrder.id } });
    expect(cashReload.paymentStatus).toBe('PENDING');
    expect((await db.inventoryStock.findUnique({ where: { id: ID.stockInsufficient } })).quantity).toBe(2);

    // MANUAL order with genuinely missing own stock row
    const manualOrder = await seedOrder({
      id: `${P}ord_manual_missing`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-MANUAL-MISS`,
      paymentMethod: 'MANUAL',
      paymentStatus: 'UNPAID',
      customerEmail: `${P}buyerA@example.test`,
      items: [{ productId: ID.prodMissing, name: NAMES.missing, quantity: 1, unitPrice: 40 }],
    });

    let manualErr: any;
    try {
      await storeOrders.completeOfflineOrder(manualOrder.id, ID.bizA, ID.ownerA);
    } catch (e) {
      manualErr = e;
    }
    expect(manualErr).toBeTruthy();
    expect(manualErr.getStatus?.()).toBe(400);
    expect(await db.invoice.findFirst({ where: { businessId: ID.bizA, invoiceNumber: `INV-${manualOrder.orderNumber}` } })).toBeNull();
    expect(await stockNoticesForOrder(ID.bizA, manualOrder.id)).toHaveLength(0);
    const manualReload = await db.marketplaceOrder.findUnique({ where: { id: manualOrder.id } });
    expect(manualReload.paymentStatus).toBe('UNPAID');
  });

  it('SNS-06a Business-scoped inventoryStocks read: CommerceIntelligenceService.recommendFulfillmentStrategy excludes another business\'s planted stock rows', async () => {
    // bizA owns 3 units, bizB planted 500 units on prodIntel. Must report 3 units, never 503.
    await commerceIntel.recommendFulfillmentStrategy(ID.bizA, ID.prodIntel);
    expect(aiPrompts).toHaveLength(1);
    expect(aiPrompts[0]).toContain('Total Stock on Hand: 3 units');
    expect(aiPrompts[0]).not.toContain('503 units');
  });

  it('SNS-06b Business-scoped inventoryStocks read: MarketplaceService.getWarehouses excludes another business\'s planted stock rows', async () => {
    // whA has bizA's own stock rows plus bizB's planted row (prodB, qty 777).
    // Must return ONLY bizA's stock rows and NEVER leak bizB's stock row or product.
    const warehouses = await marketplace.getWarehouses(ID.bizA);
    const whA = warehouses.find((w: any) => w.id === ID.whA);
    expect(whA).toBeTruthy();
    const stockIds = (whA.inventoryStocks as any[]).map((s) => s.id);
    expect(stockIds).toContain(ID.stockIntelOwn);
    expect(stockIds).not.toContain(ID.stockPlantedInWhA);
    expect((whA.inventoryStocks as any[]).every((s) => s.businessId === ID.bizA)).toBe(true);
    expect(JSON.stringify(whA)).not.toContain(NAMES.prodB);
  });
});
