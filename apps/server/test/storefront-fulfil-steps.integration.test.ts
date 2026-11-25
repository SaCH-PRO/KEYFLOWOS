/**
 * W11-STOREFRONT-FULFIL-STEPS (V1-66, Journey G) — Fulfil 'confirm' and 'process'
 * read a STOREFRONT order in its own vocabulary (`CONFIRMED` then `PROCESSING`)
 * while leaving STANDARD (marketplace) orders unchanged.
 *
 * On a REAL Postgres database, through the REAL MarketplaceController and
 * SiteController routes, guards, paid door (StoreOrderService.completeCheckout),
 * StoreOrderRoutingListener, and FulfillmentRoutingService.
 *
 * Contract pinned here:
 *
 *   FS-01  RED-BEFORE: a checked-out paid STOREFRONT order (`CONFIRMED` / `PAID`
 *          through the paid door, routed via StoreOrderRoutingListener):
 *          POST /marketplace/businesses/:b/orders/:id/fulfill { action: 'process' }
 *          answers 201, stores status `'PROCESSING'`, appends a `'picking_packing'`
 *          timeline step, and runs createPickPackTasks (route moves to
 *          `PICKING_PACKING` with a `PICK_AND_PACK` task while preserving
 *          `stockDecrementedAtCheckout`); then `{ action: 'ship' }` answers 201,
 *          stores `'shipped'`, and does not double-decrement tracked stock.
 *   FS-02  an unpaid `CONFIRMED` STOREFRONT order (CASH, not completed offline):
 *          `{ action: 'process' }` answers 400 and leaves the order, routes,
 *          timeline, and pick/pack tasks unchanged. Control: a `STANDARD` order
 *          stored `CONFIRMED` / `PAID` is still refused `'process'` (400).
 *   FS-03  RED-BEFORE: `{ action: 'confirm' }` on a `PENDING` STOREFRONT order
 *          answers 201 and stores `'CONFIRMED'` (not `'awaiting_payment'`);
 *          controls: a `STANDARD` order's `'confirm'` still stores
 *          `'awaiting_payment'` and its `'process'` from `'routed'` still writes
 *          `'picking_packing'` and ships cleanly.
 *
 * Fixtures: prefix `v66c_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66c_';
const RATE_LIMIT_NS = `${P}${Date.now()}`;
const PREVIOUS_ENV_NS = process.env.RATE_LIMIT_KEY_NAMESPACE;

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  warehouse: `${P}wh`,
  product: `${P}prod`,
  service: `${P}prod_listing`,
  stock: `${P}stock`,
};
const SLUG = `${P}store`;
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const UNIT_PRICE = 50;
const QUANTITY = 2;
const INITIAL_STOCK = 10;

let db: any;
let app: any;
let redis: any;
let storeOrders: any;
let routingService: any;

const inflight: Promise<unknown>[] = [];
const emailSend = vi.fn(async (_args?: unknown) => undefined);

async function settle() {
  for (let round = 0; round < 4; ) {
    const hadWork = inflight.length > 0;
    while (inflight.length > 0) {
      await inflight.shift()!.catch(() => undefined);
    }
    await new Promise((r) => setImmediate(r));
    round = hadWork || inflight.length > 0 ? 0 : round + 1;
  }
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM shipments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_listings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function agent() {
  return request(app.getHttpServer());
}

function asOwner<T extends { set: (k: string, v: string) => T }>(req: T): T {
  return req.set('x-test-user', ID.owner);
}

function fulfil(orderId: string, body: Record<string, unknown>) {
  return asOwner(agent().post(`/marketplace/businesses/${ID.biz}/orders/${orderId}/fulfill`).send(body));
}

function siteStatus(orderId: string, status: string) {
  return asOwner(agent().patch(`/site/businesses/${ID.biz}/orders/${orderId}/status`).send({ status }));
}

async function placeStorefrontOrder(paymentMethod = 'CASH', quantity = QUANTITY) {
  const order = await storeOrders.createOrder({
    businessId: ID.biz,
    cartItems: [{ productId: ID.product, quantity }],
    customerInfo: { name: 'Store Buyer', email: CUSTOMER_EMAIL },
    paymentMethod,
  });
  await settle();
  return order;
}

async function resetStock(quantity = INITIAL_STOCK, reserved = 0) {
  await db.inventoryStock.update({
    where: { id: ID.stock },
    data: { quantity, reserved },
  });
}

beforeAll(async () => {
  process.env.RATE_LIMIT_KEY_NAMESPACE = RATE_LIMIT_NS;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
  const { EventEmitterModule } = await import('@nestjs/event-emitter');
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
  const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
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
    controllers: [SiteController, MarketplaceController],
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
      StoreOrderRoutingListener,
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
      { provide: TransactionalEmailService, useValue: { send: emailSend } },
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

  app = moduleRef.createNestApplication();
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

  storeOrders = app.get(StoreOrderService);
  routingService = app.get(FulfillmentRoutingService);
  vi.spyOn(app.get(MarketplaceService) as any, 'autoRouteOrder').mockImplementation(() => undefined);

  // Track async event listener promises (handle* on CommerceIntegrationService and onStoreOrderPaid on
  // StoreOrderRoutingListener) so settle() awaits routing & commerce integration cleanly.
  for (const listener of [app.get(CommerceIntegrationService), app.get(StoreOrderRoutingListener)] as Array<Record<string, any>>) {
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(listener))) {
      if ((!name.startsWith('handle') && !name.startsWith('on')) || typeof listener[name] !== 'function') continue;
      const original = listener[name].bind(listener);
      listener[name] = (...args: unknown[]) => {
        const work = original(...args);
        inflight.push(Promise.resolve(work));
        return work;
      };
    }
  }

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.biz, name: 'V66C Store', slug: SLUG, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH', storeEnabled: true },
  });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({
    data: { id: ID.contact, businessId: ID.biz, firstName: 'Store', lastName: 'Buyer', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
  await db.warehouse.create({ data: { id: ID.warehouse, businessId: ID.biz, name: 'Main Warehouse', isActive: true } });
  await db.product.create({
    data: { id: ID.product, businessId: ID.biz, name: 'V66C Widget', price: UNIT_PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true },
  });
  await db.service.create({
    data: { id: ID.service, businessId: ID.biz, name: 'V66C Widget', duration: 30, price: UNIT_PRICE, sourceProductId: ID.product },
  });
  await db.inventoryStock.create({
    data: { id: ID.stock, businessId: ID.biz, productId: ID.product, warehouseId: ID.warehouse, quantity: INITIAL_STOCK, reserved: 0 },
  });
}, 60_000);

beforeEach(async () => {
  emailSend.mockClear();
  await resetStock(INITIAL_STOCK, 0);
});

afterAll(async () => {
  await settle();
  await cleanup();
  if (app) await app.close();
  if (redis) await redis.quit().catch(() => undefined);
  if (PREVIOUS_ENV_NS === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
  else process.env.RATE_LIMIT_KEY_NAMESPACE = PREVIOUS_ENV_NS;
}, 30_000);

describe('W11-STOREFRONT-FULFIL-STEPS (V1-66, Journey G)', () => {
  it("[FS-01] RED-BEFORE: paid CONFIRMED storefront order processes to PROCESSING with picking_packing timeline step and tasks, then ships without double-decrementing stock", async () => {
    const order = await placeStorefrontOrder('CASH', QUANTITY);
    await storeOrders.completeCheckout({
      orderId: order.id,
      paymentRef: `${P}ref_fs01`,
      provider: 'cash',
      method: 'cash',
      actorId: ID.owner,
    });
    await settle();

    const paid = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(`${paid.type}/${paid.status}/${paid.paymentStatus}`).toBe('STOREFRONT/CONFIRMED/PAID');

    // Checkout decremented stock once; P56 routing created a no-reservation route without touching reserved.
    const stockBeforeProcess = await db.inventoryStock.findUniqueOrThrow({ where: { id: ID.stock } });
    expect(`${stockBeforeProcess.quantity}/${stockBeforeProcess.reserved}`).toBe(`${INITIAL_STOCK - QUANTITY}/0`);

    emailSend.mockClear();
    const procRes = await fulfil(order.id, { action: 'process', note: 'Packing shelf A' });
    await settle();
    expect(procRes.status).toBe(201);
    expect(procRes.body.status).toBe('PROCESSING');
    expect(emailSend).not.toHaveBeenCalled();

    const storedAfterProcess = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(`${storedAfterProcess.status}/${storedAfterProcess.paymentStatus}`).toBe('PROCESSING/PAID');
    const timeline: Array<{ status?: string; note?: string }> =
      ((storedAfterProcess.metadata as Record<string, unknown>)?.statusTimeline as Array<{ status?: string; note?: string }>) ?? [];
    expect(timeline.some((s) => s.status === 'picking_packing' && s.note === 'Packing shelf A')).toBe(true);

    // createPickPackTasks ran and moved the route to PICKING_PACKING while preserving stockDecrementedAtCheckout.
    const routesAfterProcess = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect(routesAfterProcess).toHaveLength(1);
    expect(routesAfterProcess[0].status).toBe('PICKING_PACKING');
    const routeMeta = (routesAfterProcess[0].metadata as Record<string, any>) ?? {};
    expect(routeMeta.task?.type).toBe('PICK_AND_PACK');
    expect(routeMeta.stockDecrementedAtCheckout).toBe(true);

    // Now ship through the same fulfil endpoint: PROCESSING normalizes to picking_packing.
    const shipRes = await fulfil(order.id, { action: 'ship', carrier: 'DHL', trackingNumber: `${P}TRK-01` });
    await settle();
    expect(shipRes.status).toBe(201);
    expect(shipRes.body.status).toBe('shipped');

    const storedAfterShip = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(storedAfterShip.status).toBe('shipped');

    const routesAfterShip = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect(routesAfterShip[0].status).toBe('SHIPPED');

    // No double decrement on ship (P50 + P56 + P57 combined invariant).
    const stockAfterShip = await db.inventoryStock.findUniqueOrThrow({ where: { id: ID.stock } });
    expect(`${stockAfterShip.quantity}/${stockAfterShip.reserved}`).toBe(`${INITIAL_STOCK - QUANTITY}/0`);
  });

  it("[FS-02] unpaid CONFIRMED storefront order (CASH, not completed offline) is refused 'process' (400) with order, routes and tasks unchanged; STANDARD CONFIRMED/PAID control is also refused", async () => {
    const order = await placeStorefrontOrder('CASH', 1);
    const confirmViaSite = await siteStatus(order.id, 'CONFIRMED');
    expect(confirmViaSite.status).toBe(200);

    const before = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(`${before.type}/${before.status}/${before.paymentStatus}`).toBe('STOREFRONT/CONFIRMED/PENDING');
    const routesBefore = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect(routesBefore).toHaveLength(0);

    const procRes = await fulfil(order.id, { action: 'process', note: 'Should refuse unpaid' });
    expect(procRes.status).toBe(400);

    const after = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(`${after.status}/${after.paymentStatus}`).toBe('CONFIRMED/PENDING');
    expect(after.metadata).toEqual(before.metadata);
    const routesAfter = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect(routesAfter).toHaveLength(0);

    // Control: a STANDARD order stored CONFIRMED/PAID does NOT get the STOREFRONT-only exemption.
    const stdOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}std_confirmed_paid`,
        businessId: ID.biz,
        orderNumber: `${P}ORD-STD-CP`,
        type: 'STANDARD',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        customerName: 'Std Buyer',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: UNIT_PRICE,
        total: UNIT_PRICE,
        currency: 'TTD',
        items: {
          create: [{ productId: ID.product, name: 'V66C Widget', quantity: 1, unitPrice: UNIT_PRICE, total: UNIT_PRICE }],
        },
      },
    });
    const stdProc = await fulfil(stdOrder.id, { action: 'process' });
    expect(stdProc.status).toBe(400);
    const stdAfter = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: stdOrder.id } });
    expect(stdAfter.status).toBe('CONFIRMED');
    expect(await db.fulfillmentRoute.count({ where: { businessId: ID.biz, orderId: stdOrder.id } })).toBe(0);
  });

  it("[FS-03] RED-BEFORE: 'confirm' on a PENDING storefront order stores 'CONFIRMED' (not 'awaiting_payment'); controls: STANDARD confirm stores 'awaiting_payment' and STANDARD process from 'routed' still works", async () => {
    const sfOrder = await placeStorefrontOrder('CASH', 1);
    const sfBefore = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: sfOrder.id } });
    expect(`${sfBefore.type}/${sfBefore.status}/${sfBefore.paymentStatus}`).toBe('STOREFRONT/PENDING/PENDING');

    emailSend.mockClear();
    const sfConfirm = await fulfil(sfOrder.id, { action: 'confirm', note: 'Confirmed by staff' });
    await settle();
    expect(sfConfirm.status).toBe(201);
    expect(sfConfirm.body.status).toBe('CONFIRMED');
    // SEC-P57-1: confirming an unpaid PENDING storefront order must not send order_confirmed or consume referral marker.
    expect(emailSend).not.toHaveBeenCalled();

    const sfAfter = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: sfOrder.id } });
    expect(sfAfter.status).toBe('CONFIRMED');
    expect(sfAfter.status).not.toBe('awaiting_payment');
    const sfTimeline: Array<{ status?: string; note?: string }> =
      ((sfAfter.metadata as Record<string, unknown>)?.statusTimeline as Array<{ status?: string; note?: string }>) ?? [];
    expect(sfTimeline.some((s) => s.note === 'Confirmed by staff')).toBe(true);

    // Control 1: STANDARD order confirm still writes 'awaiting_payment'.
    const stdOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}std_confirm_ctrl`,
        businessId: ID.biz,
        orderNumber: `${P}ORD-STD-CTRL`,
        type: 'STANDARD',
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Std Buyer',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: UNIT_PRICE,
        total: UNIT_PRICE,
        currency: 'TTD',
        items: {
          create: [{ productId: ID.product, name: 'V66C Widget', quantity: 1, unitPrice: UNIT_PRICE, total: UNIT_PRICE }],
        },
      },
    });
    const stdConfirm = await fulfil(stdOrder.id, { action: 'confirm', note: 'Std confirm' });
    expect(stdConfirm.status).toBe(201);
    expect(stdConfirm.body.status).toBe('awaiting_payment');
    const stdAfterConfirm = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: stdOrder.id } });
    expect(stdAfterConfirm.status).toBe('awaiting_payment');

    // Control 2: STANDARD order in 'routed' processes to 'picking_packing' and ships cleanly.
    const stdRouted = await db.marketplaceOrder.create({
      data: {
        id: `${P}std_routed_ctrl`,
        businessId: ID.biz,
        orderNumber: `${P}ORD-STD-ROUTED`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        customerName: 'Std Buyer',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: UNIT_PRICE,
        total: UNIT_PRICE,
        currency: 'TTD',
        items: {
          create: [{ productId: ID.product, name: 'V66C Widget', quantity: 1, unitPrice: UNIT_PRICE, total: UNIT_PRICE }],
        },
      },
    });
    await routingService.routeOrder(ID.biz, stdRouted.id);
    const routedCheck = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: stdRouted.id } });
    expect(routedCheck.status).toBe('routed');

    const stdProcess = await fulfil(stdRouted.id, { action: 'process' });
    expect(stdProcess.status).toBe(201);
    expect(stdProcess.body.status).toBe('picking_packing');
    const stdAfterProcess = await db.marketplaceOrder.findUniqueOrThrow({ where: { id: stdRouted.id } });
    expect(stdAfterProcess.status).toBe('picking_packing');

    const stdShip = await fulfil(stdRouted.id, { action: 'ship', carrier: 'Local', trackingNumber: `${P}STD-TRK` });
    expect(stdShip.status).toBe(201);
    expect(stdShip.body.status).toBe('shipped');
  });
});
