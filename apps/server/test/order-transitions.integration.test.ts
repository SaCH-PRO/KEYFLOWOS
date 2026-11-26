/**
 * W1F-ORDER-TRANSITIONS (P123, owner ruling D-198 `orderstatus`, SEC-W11OCR-2 + reverse race):
 * Real-database integration tests proving:
 *
 *   OT-01  PATCH /marketplace/.../orders/:id/status refuses moving a SHIPPED order
 *          backwards (any case / padding, both marketplace & storefront vocabularies,
 *          and custom/unknown labels like 'on_hold', 'CANCELED', 'FAILED'), including
 *          when paymentStatus: 'PAID' is supplied on an UNPAID shipped order;
 *          idempotent shipped->shipped and forward shipped->delivered/completed stay valid.
 *   OT-02  PATCH /marketplace/.../orders/:id/status refuses moving a DELIVERED or
 *          COMPLETED order backwards (including DELIVERED -> SHIPPED);
 *          idempotent delivered->delivered / completed->completed and forward
 *          delivered->completed stay valid.
 *   OT-03  PATCH /site/.../orders/:id/status refuses moving a SHIPPED, DELIVERED, or
 *          COMPLETED storefront order backwards (case-insensitive stored status);
 *          idempotent same-status and forward SHIPPED->DELIVERED/COMPLETED,
 *          DELIVERED->COMPLETED stay valid.
 *   OT-04  Terminal CANCELLED and REFUNDED orders cannot be reopened or overwritten
 *          via PATCH /marketplace or PATCH /site.
 *   OT-05  MarketplaceService.fulfillOrder(..., 'cancel') reads stored status
 *          case-insensitively (and admits 'on_hold' as an open status), releasing
 *          reservations and cancelling routes; refuses closed statuses in any case.
 *   OT-06  Reverse race (compare-and-set on PATCH shipped / PATCH /site SHIPPED):
 *          a PATCH 'shipped' or PATCH /site 'SHIPPED' that read an open order before
 *          a concurrent cancel committed is refused 409 with nothing written and no
 *          store_order.shipped event — the committed cancel is never overwritten.
 *   OT-07  fulfillOrder(..., 'cancel') compare-and-set: a PATCH 'shipped' committing
 *          while fulfillOrder('cancel') waits on stock row locks causes fulfillOrder
 *          'cancel' to fail 409 and roll back its route cancellation & stock release;
 *          the shipped order stays shipped with reservations intact.
 *   OT-08  fulfillOrder(..., 'ship') compare-and-set: a status change committing while
 *          fulfillOrder('ship') waits on stock row locks causes fulfillOrder('ship')
 *          to fail 409 and roll back shipment, route update, stock decrement, and
 *          StockMovement; the committed status is never overwritten backwards.
 *   OT-09  Real concurrent Postgres Promise.allSettled races across all ship-vs-cancel
 *          pairs leave exactly one consistent terminal state (one 200, one 400/409),
 *          never double-releasing reservations and never leaving a shipped order
 *          cancelled or a cancelled order overwritten by a ship.
 *
 * Fixtures: prefix `v70d_` (registered in test/helpers/fixture-prefixes.json with
 * packet "V1-70 (W1F-ORDER-TRANSITIONS)"); hard-deleted by raw SQL using sqlLikePrefix(P).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v70d_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  warehouse: `${P}wh`,
  productA: `${P}prod_a`,
  stockA: `${P}stock_a`,
};
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const PRICE = 25;
const IN_STOCK = 10;

let db: any;
let app: any;
let events: any;
let storeOrders: any;
let market: any;
let routing: any;
let prismaService: any;
let marketController: any;
let siteController: any;

let seen: Array<{ name: string; payload: any }> = [];
let orderSeq = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function within(ms: number, check: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(30);
  }
  return false;
}

async function waitingSessions(): Promise<number> {
  const rows: Array<{ count: bigint | number | string }> = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM revenue_attributions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM shipments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM purchase_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pre_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_listings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function resetStock() {
  await db.inventoryStock.update({
    where: { id: ID.stockA },
    data: { quantity: IN_STOCK, reserved: 0 },
  });
}

async function createStandardOrder(opts: { status?: string; paymentStatus?: string; qty?: number; route?: boolean } = {}) {
  orderSeq += 1;
  const qty = opts.qty ?? 2;
  const total = PRICE * qty;
  const order = await db.marketplaceOrder.create({
    data: {
      businessId: ID.biz,
      orderNumber: `${P}ord_${orderSeq}_${Date.now()}`,
      type: 'STANDARD',
      status: opts.status ?? 'paid',
      paymentStatus: opts.paymentStatus ?? 'PAID',
      paymentMethod: 'CASH',
      customerName: 'V70D Tester',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: total,
      total,
      currency: 'TTD',
      metadata: { statusTimeline: [{ status: opts.status ?? 'paid', timestamp: '2026-11-26T00:00:00.000Z', note: 'Seeded' }] },
    },
  });
  await db.marketplaceOrderItem.create({
    data: {
      orderId: order.id,
      productId: ID.productA,
      name: 'V70D Tracked A',
      quantity: qty,
      unitPrice: PRICE,
      total,
    },
  });
  if (opts.route) {
    await routing.routeOrder(ID.biz, order.id);
  }
  return order;
}

async function createStorefrontOrder(opts: { status?: string; paymentStatus?: string; qty?: number; withReservedRoute?: boolean } = {}) {
  orderSeq += 1;
  const qty = opts.qty ?? 2;
  const total = PRICE * qty;
  const order = await db.marketplaceOrder.create({
    data: {
      businessId: ID.biz,
      orderNumber: `${P}sf_${orderSeq}_${Date.now()}`,
      type: 'STOREFRONT',
      status: opts.status ?? 'CONFIRMED',
      paymentStatus: opts.paymentStatus ?? 'PAID',
      paymentMethod: 'CASH',
      customerName: 'V70D Storefront',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: total,
      total,
      currency: 'TTD',
      metadata: { statusTimeline: [{ status: opts.status ?? 'CONFIRMED', timestamp: '2026-11-26T00:00:00.000Z', note: 'Seeded' }] },
    },
  });
  const item = await db.marketplaceOrderItem.create({
    data: {
      orderId: order.id,
      productId: ID.productA,
      name: 'V70D Tracked A',
      quantity: qty,
      unitPrice: PRICE,
      total,
    },
  });
  if (opts.withReservedRoute) {
    await db.fulfillmentRoute.create({
      data: {
        businessId: ID.biz,
        orderId: order.id,
        orderItemId: item.id,
        strategy: 'LOCAL_STOCK',
        status: 'RESERVED',
        sourceType: 'WAREHOUSE',
        warehouseId: ID.warehouse,
        metadata: { inventoryMode: 'tracked' },
      },
    });
    await db.inventoryStock.update({
      where: { id: ID.stockA },
      data: { reserved: { increment: qty } },
    });
  }
  return order;
}

const marketPatch = (orderId: string, body: Record<string, unknown>) =>
  Promise.resolve().then(() => marketController.updateOrderStatus(ID.biz, orderId, body, { user: { id: ID.owner } }));

const sitePatch = (orderId: string, status: string) =>
  Promise.resolve().then(() => siteController.updateOrderStatus(ID.biz, orderId, { status }, { user: { id: ID.owner } }));

const fulfil = (orderId: string, action: string, data: Record<string, unknown> = {}) =>
  Promise.resolve().then(() => marketController.fulfillOrder(ID.biz, orderId, { action, ...data }, { user: { id: ID.owner } }));

type Outcome = { code: number; status?: string; paymentStatus?: string; message?: string };

const outcomeOf = (p: Promise<any>): Promise<Outcome> =>
  p.then(
    (o: any) => ({ code: 200, status: o?.status, paymentStatus: o?.paymentStatus }),
    (err: any) => ({
      code: typeof err?.getStatus === 'function' ? err.getStatus() : 500,
      message: err?.message ?? String(err),
    }),
  );

const statusOf = async (orderId: string) => {
  const o = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return `${o.status}/${o.paymentStatus}`;
};

const orderRowSnapshot = async (orderId: string) => {
  const o = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return JSON.stringify([o.status, o.paymentStatus, o.paymentMethod, o.paymentRef, o.metadata, o.updatedAt]);
};

const routesOf = async (orderId: string) =>
  (await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId }, orderBy: { id: 'asc' } })).map(
    (r: any) => `${r.strategy}:${r.status}`,
  );

const stockA = async () => {
  const s = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
  return `${s.quantity}/${s.reserved}`;
};

const stepsOf = async (orderId: string): Promise<string[]> => {
  const o = await db.marketplaceOrder.findUnique({ where: { id: orderId }, select: { metadata: true } });
  const timeline = (o?.metadata as any)?.statusTimeline ?? [];
  return timeline.map((t: any) => t.status);
};

const eventsOf = (orderId: string) => seen.filter((e) => e.payload?.order?.id === orderId).map((e) => e.name);

const shipmentsCountOf = (orderId: string) => db.shipment.count({ where: { businessId: ID.biz, orderId } });

const shipMovementsOf = (orderId: string) =>
  db.stockMovement.findMany({ where: { businessId: ID.biz, referenceId: orderId, reasonCode: 'SHIP' } });

/**
 * Forces a stock-row lock wait for `first` (which acquires routing claim + locks stockA),
 * runs `second` while `first` is blocked on stockA, then releases the holder and awaits `first`.
 */
async function whileWaitingOnStock(first: () => Promise<any>, second: () => Promise<any>) {
  let letGo!: () => void;
  const go = new Promise<void>((resolve) => (letGo = resolve));
  let holding!: () => void;
  const held = new Promise<void>((resolve) => (holding = resolve));
  const holder = db.$transaction(
    async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', ID.stockA);
      holding();
      await go;
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  await held;
  let firstPromise: Promise<Outcome> = Promise.resolve({ code: 0 });
  let secondOutcome: Outcome | string = '';
  let waited = false;
  try {
    firstPromise = outcomeOf(first());
    waited = await within(5_000, async () => (await waitingSessions()) >= 1);
    secondOutcome = await Promise.race([outcomeOf(second()), sleep(10_000).then(() => 'timed_out')]);
  } finally {
    letGo();
    await holder;
  }
  return { waited, firstOutcome: await firstPromise, secondOutcome };
}

/**
 * Intercepts `prismaService.client.marketplaceOrder.findFirst` once for the given orderId
 * so that the reader pauses right after reading the order, allowing `interpose()` to run
 * and commit before the reader continues to its write.
 */
async function pauseAfterOrderRead<T>(orderId: string, interpose: () => Promise<void>, work: () => Promise<T>): Promise<T> {
  const realClient = prismaService.client;
  let fired = false;
  const bound = (target: any, prop: PropertyKey) => {
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  prismaService.client = new Proxy(realClient, {
    get(target, prop) {
      if (prop !== 'marketplaceOrder') return bound(target, prop);
      const delegate = target.marketplaceOrder;
      return new Proxy(delegate, {
        get(d, m) {
          if (m !== 'findFirst') return bound(d, m);
          return async (args: any) => {
            const row = await d.findFirst(args);
            if (!fired && args?.where?.id === orderId && row) {
              fired = true;
              // Restore real client before running interpose so interpose executes un-proxied.
              prismaService.client = realClient;
              await interpose();
            }
            return row;
          };
        },
      });
    },
  });
  try {
    return await work();
  } finally {
    prismaService.client = realClient;
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const workflowMod = await import('../src/modules/commerce/invoice-workflow.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { RevenueAttributionService } = await import('../src/modules/commerce/revenue-attribution.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { SiteController } = await import('../src/modules/site/site.controller');

  const crmStub = {
    findOrCreateContact: async (businessId: string, input: { email?: string | null }) =>
      input?.email
        ? db.contact.findFirst({ where: { businessId, emailNormalized: input.email.toLowerCase() }, select: { id: true } })
        : null,
    logContactEvent: async () => null,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    providers: [
      PrismaService,
      StoreOrderService,
      workflowMod.InvoiceWorkflowService,
      RevenueAttributionService,
      RevenuePostingService,
      ExpensePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: CrmService, useValue: crmStub },
      { provide: PromoCodeService, useValue: {} },
      {
        provide: PublicEventsService,
        useValue: { logStorefrontEvent: async () => null, upsertStorefrontContact: async () => null, backstitchVisitor: async () => null },
      },
      { provide: InventoryRiskService, useValue: { evaluateProduct: async () => null } },
      { provide: TransactionalEmailService, useValue: { send: async () => null } },
      MarketplaceService,
      FulfillmentRoutingService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  events = app.get(EventEmitter2);
  storeOrders = app.get(StoreOrderService);
  market = app.get(MarketplaceService);
  routing = app.get(FulfillmentRoutingService);
  prismaService = app.get(PrismaService);
  marketController = new (MarketplaceController as any)(market, {}, prismaService);
  siteController = new (SiteController as any)({}, storeOrders, {}, {}, {}, {}, {}, {}, {});

  events.onAny((name: string | string[], payload: any) => {
    const n = Array.isArray(name) ? name.join('.') : String(name);
    if (n.startsWith('store_order.')) seen.push({ name: n, payload });
  });

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V70D Transitions', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.membership.create({ data: { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({
    data: { id: ID.contact, businessId: ID.biz, firstName: 'Vee', lastName: 'Seventy', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
  await db.warehouse.create({ data: { id: ID.warehouse, businessId: ID.biz, name: 'V70D Warehouse' } });
  await db.product.create({
    data: { id: ID.productA, businessId: ID.biz, name: 'V70D Tracked A', price: PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked' },
  });
  await db.inventoryStock.create({
    data: { id: ID.stockA, businessId: ID.biz, productId: ID.productA, warehouseId: ID.warehouse, quantity: IN_STOCK, reserved: 0, currency: 'TTD' },
  });
}, 30_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
}, 30_000);

beforeEach(async () => {
  seen = [];
  await resetStock();
});

describe('W1F-ORDER-TRANSITIONS (D-198 orderstatus, SEC-W11OCR-2 & reverse race; real Postgres)', () => {
  it('OT-01 PATCH /marketplace refuses moving a SHIPPED order backwards (case-insensitive) and refuses backwards move with paymentStatus PAID; idempotent & forward moves stay valid', async () => {
    const backwardsTargets = [
      'placed',
      'PENDING',
      'pending',
      'CONFIRMED',
      'awaiting_payment',
      'paid',
      'awaiting_fulfillment',
      'routed',
      'supplier_ordered',
      'picking_packing',
      'PROCESSING',
      'processing',
      'on_hold',
      'CANCELED',
      'FAILED',
      'cancelled',
      'CANCELLED',
    ];

    for (const storedStatus of ['shipped', 'SHIPPED', ' Shipped ']) {
      await resetStock();
      const order = await createStandardOrder({ route: true });
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: storedStatus } });
      const before = await orderRowSnapshot(order.id);
      seen = [];

      for (const target of backwardsTargets) {
        const res = await outcomeOf(marketPatch(order.id, { status: target }));
        expect(res.code, `${storedStatus} -> ${target} (${res.message ?? ''})`).toBe(400);
      }

      expect(await orderRowSnapshot(order.id), `${storedStatus} row unchanged`).toBe(before);
      expect(await routesOf(order.id), `${storedStatus} route unchanged`).toEqual(['LOCAL_STOCK:RESERVED']);
      expect(await stockA(), `${storedStatus} stock unchanged`).toBe(`${IN_STOCK}/2`);
      expect(eventsOf(order.id), `${storedStatus} emitted no events`).toEqual([]);
    }

    // UNPAID shipped order: backwards status with paymentStatus PAID must also be refused 400 with no payment/invoice recorded.
    const unpaidShipped = await createStandardOrder({ status: 'SHIPPED', paymentStatus: 'UNPAID' });
    const invoicesBefore = await db.invoice.count({ where: { businessId: ID.biz } });
    const unpaidBefore = await orderRowSnapshot(unpaidShipped.id);
    seen = [];
    const badPaid = await outcomeOf(marketPatch(unpaidShipped.id, { status: 'pending', paymentStatus: 'PAID', paymentMethod: 'cash' }));
    expect(badPaid.code, `UNPAID SHIPPED -> pending/PAID (${badPaid.message ?? ''})`).toBe(400);
    expect(await orderRowSnapshot(unpaidShipped.id)).toBe(unpaidBefore);
    expect(await db.invoice.count({ where: { businessId: ID.biz } })).toBe(invoicesBefore);
    expect(eventsOf(unpaidShipped.id)).toEqual([]);

    // Controls: idempotent shipped->shipped and forward shipped->delivered / SHIPPED->COMPLETED succeed.
    const ctrl1 = await createStandardOrder({ status: 'shipped', paymentStatus: 'PAID' });
    expect((await outcomeOf(marketPatch(ctrl1.id, { status: 'shipped' }))).code).toBe(200);
    expect((await outcomeOf(marketPatch(ctrl1.id, { status: 'delivered' }))).code).toBe(200);
    expect(await statusOf(ctrl1.id)).toBe('delivered/PAID');

    const ctrl2 = await createStandardOrder({ status: 'SHIPPED', paymentStatus: 'PAID' });
    expect((await outcomeOf(marketPatch(ctrl2.id, { status: 'SHIPPED' }))).code).toBe(200);
    expect((await outcomeOf(marketPatch(ctrl2.id, { status: 'COMPLETED' }))).code).toBe(200);
    expect(await statusOf(ctrl2.id)).toBe('COMPLETED/PAID');
  }, 30_000);

  it('OT-02 PATCH /marketplace refuses moving a DELIVERED or COMPLETED order backwards (case-insensitive); idempotent & forward moves stay valid', async () => {
    const backwardsFromDelivered = [
      'shipped',
      'SHIPPED',
      'picking_packing',
      'PROCESSING',
      'processing',
      'routed',
      'paid',
      'CONFIRMED',
      'PENDING',
      'placed',
      'on_hold',
      'CANCELED',
      'FAILED',
      'cancelled',
      'CANCELLED',
    ];

    for (const storedStatus of ['delivered', 'DELIVERED', ' delivered ']) {
      const order = await createStandardOrder({ status: storedStatus, paymentStatus: 'PAID' });
      const before = await orderRowSnapshot(order.id);
      seen = [];

      for (const target of backwardsFromDelivered) {
        const res = await outcomeOf(marketPatch(order.id, { status: target }));
        expect(res.code, `${storedStatus} -> ${target} (${res.message ?? ''})`).toBe(400);
      }

      expect(await orderRowSnapshot(order.id), `${storedStatus} row unchanged`).toBe(before);
      expect(eventsOf(order.id), `${storedStatus} emitted no events`).toEqual([]);
    }

    // Controls from DELIVERED: idempotent delivered->delivered and forward delivered->completed.
    const delCtrl = await createStandardOrder({ status: 'delivered', paymentStatus: 'PAID' });
    expect((await outcomeOf(marketPatch(delCtrl.id, { status: 'delivered' }))).code).toBe(200);
    expect((await outcomeOf(marketPatch(delCtrl.id, { status: 'completed' }))).code).toBe(200);
    expect(await statusOf(delCtrl.id)).toBe('completed/PAID');

    // COMPLETED refuses any backwards move including delivered & shipped; idempotent completed->completed allowed.
    const comp = await createStandardOrder({ status: 'completed', paymentStatus: 'PAID' });
    const compBefore = await orderRowSnapshot(comp.id);
    seen = [];
    for (const target of ['delivered', 'DELIVERED', 'shipped', 'SHIPPED', 'processing', 'pending', 'on_hold', 'cancelled']) {
      const res = await outcomeOf(marketPatch(comp.id, { status: target }));
      expect(res.code, `completed -> ${target} (${res.message ?? ''})`).toBe(400);
    }
    expect(await orderRowSnapshot(comp.id)).toBe(compBefore);
    expect(eventsOf(comp.id)).toEqual([]);
    expect((await outcomeOf(marketPatch(comp.id, { status: 'completed' }))).code).toBe(200);
  }, 30_000);

  it('OT-03 PATCH /site refuses moving a SHIPPED, DELIVERED, or COMPLETED order backwards (case-insensitive stored status); idempotent & forward moves stay valid', async () => {
    for (const storedStatus of ['SHIPPED', 'shipped']) {
      await resetStock();
      const order = await createStorefrontOrder({ status: storedStatus, paymentStatus: 'PAID', withReservedRoute: true });
      const before = await orderRowSnapshot(order.id);
      seen = [];

      for (const target of ['PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED']) {
        const res = await outcomeOf(sitePatch(order.id, target));
        expect(res.code, `/site ${storedStatus} -> ${target} (${res.message ?? ''})`).toBe(400);
      }
      expect(await orderRowSnapshot(order.id)).toBe(before);
      expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:RESERVED']);
      expect(await stockA()).toBe(`${IN_STOCK}/2`);
      expect(eventsOf(order.id)).toEqual([]);
    }

    for (const storedStatus of ['DELIVERED', 'delivered']) {
      const order = await createStorefrontOrder({ status: storedStatus, paymentStatus: 'PAID' });
      const before = await orderRowSnapshot(order.id);
      seen = [];

      for (const target of ['SHIPPED', 'PROCESSING', 'CONFIRMED', 'PENDING', 'CANCELLED']) {
        const res = await outcomeOf(sitePatch(order.id, target));
        expect(res.code, `/site ${storedStatus} -> ${target} (${res.message ?? ''})`).toBe(400);
      }
      expect(await orderRowSnapshot(order.id)).toBe(before);
      expect(eventsOf(order.id)).toEqual([]);
    }

    const completed = await createStorefrontOrder({ status: 'COMPLETED', paymentStatus: 'PAID' });
    const compBefore = await orderRowSnapshot(completed.id);
    seen = [];
    for (const target of ['DELIVERED', 'SHIPPED', 'PROCESSING', 'CONFIRMED', 'PENDING', 'CANCELLED']) {
      const res = await outcomeOf(sitePatch(completed.id, target));
      expect(res.code, `/site COMPLETED -> ${target} (${res.message ?? ''})`).toBe(400);
    }
    expect(await orderRowSnapshot(completed.id)).toBe(compBefore);
    expect(eventsOf(completed.id)).toEqual([]);

    // Controls: idempotent and forward transitions on /site stay valid.
    const ctrl = await createStorefrontOrder({ status: 'SHIPPED', paymentStatus: 'PAID' });
    expect((await outcomeOf(sitePatch(ctrl.id, 'SHIPPED'))).code).toBe(200);
    expect((await outcomeOf(sitePatch(ctrl.id, 'DELIVERED'))).code).toBe(200);
    expect((await outcomeOf(sitePatch(ctrl.id, 'DELIVERED'))).code).toBe(200);
    expect((await outcomeOf(sitePatch(ctrl.id, 'COMPLETED'))).code).toBe(200);
    expect((await outcomeOf(sitePatch(ctrl.id, 'COMPLETED'))).code).toBe(200);
    expect(await statusOf(ctrl.id)).toBe('COMPLETED/PAID');
  }, 30_000);

  it('OT-04 terminal CANCELLED and REFUNDED orders cannot be reopened or overwritten via PATCH /marketplace or PATCH /site', async () => {
    for (const storedStatus of ['cancelled', 'CANCELLED', 'refunded', 'REFUNDED']) {
      const mOrder = await createStandardOrder({ status: storedStatus, paymentStatus: 'PAID' });
      const mBefore = await orderRowSnapshot(mOrder.id);
      seen = [];
      for (const target of ['shipped', 'SHIPPED', 'delivered', 'completed', 'processing', 'PENDING', 'on_hold', 'cancelled']) {
        const res = await outcomeOf(marketPatch(mOrder.id, { status: target }));
        expect(res.code, `/marketplace ${storedStatus} -> ${target} (${res.message ?? ''})`).toBe(400);
      }
      expect(await orderRowSnapshot(mOrder.id)).toBe(mBefore);
      expect(eventsOf(mOrder.id)).toEqual([]);

      const sOrder = await createStorefrontOrder({ status: storedStatus, paymentStatus: 'PAID' });
      const sBefore = await orderRowSnapshot(sOrder.id);
      seen = [];
      for (const target of ['SHIPPED', 'DELIVERED', 'COMPLETED', 'PROCESSING', 'CONFIRMED', 'PENDING', 'CANCELLED']) {
        const res = await outcomeOf(sitePatch(sOrder.id, target));
        expect(res.code, `/site ${storedStatus} -> ${target} (${res.message ?? ''})`).toBe(400);
      }
      expect(await orderRowSnapshot(sOrder.id)).toBe(sBefore);
      expect(eventsOf(sOrder.id)).toEqual([]);
    }
  }, 30_000);

  it("OT-05 fulfillOrder('cancel') reads status case-insensitively and admits 'on_hold' as open (releasing reservations); refuses closed statuses in any case", async () => {
    for (const spelling of ['processing', 'Processing', 'pending', 'confirmed', ' routed ', 'on_hold']) {
      await resetStock();
      const order = await createStandardOrder({ route: true });
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: spelling } });
      expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:RESERVED']);
      expect(await stockA()).toBe(`${IN_STOCK}/2`);
      seen = [];

      const res = await outcomeOf(fulfil(order.id, 'cancel', { reason: `cancel from ${spelling}` }));
      expect(
        {
          code: res.code,
          status: res.status,
          stored: await statusOf(order.id),
          routes: await routesOf(order.id),
          stock: await stockA(),
          events: eventsOf(order.id),
          lastStep: (await stepsOf(order.id)).at(-1),
        },
        JSON.stringify(spelling),
      ).toEqual({
        code: 200,
        status: 'cancelled',
        stored: 'cancelled/PAID',
        routes: ['LOCAL_STOCK:CANCELLED'],
        stock: `${IN_STOCK}/0`,
        events: ['store_order.cancelled'],
        lastStep: 'cancelled',
      });
    }

    for (const closed of ['shipped', 'Shipped', 'SHIPPED', 'delivered', 'DELIVERED', ' delivered ', 'Completed', 'cancelled', 'CANCELLED', 'REFUNDED']) {
      await resetStock();
      const order = await createStandardOrder({ route: true });
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: closed } });
      const before = await orderRowSnapshot(order.id);
      seen = [];

      const res = await outcomeOf(fulfil(order.id, 'cancel', { reason: 'should fail' }));
      expect(
        {
          code: res.code,
          message: res.message,
          row: await orderRowSnapshot(order.id),
          routes: await routesOf(order.id),
          stock: await stockA(),
          events: eventsOf(order.id),
        },
        JSON.stringify(closed),
      ).toEqual({
        code: 400,
        message: `Cannot cancel order in ${closed} status`,
        row: before,
        routes: ['LOCAL_STOCK:RESERVED'],
        stock: `${IN_STOCK}/2`,
        events: [],
      });
    }
  }, 45_000);

  it("OT-06 reverse race (compare-and-set): PATCH /marketplace 'shipped' and PATCH /site 'SHIPPED' that read an open order before a cancel commits are refused 409 and never overwrite the committed cancel", async () => {
    // 1. PATCH /marketplace 'shipped' vs fulfillOrder('cancel')
    await resetStock();
    const mOrder = await createStandardOrder({ route: true });
    expect(await statusOf(mOrder.id)).toBe('routed/PAID');
    expect(await stockA()).toBe(`${IN_STOCK}/2`);
    seen = [];

    const mShipOutcome = await pauseAfterOrderRead(
      mOrder.id,
      async () => {
        const cancelRes = await outcomeOf(fulfil(mOrder.id, 'cancel', { reason: 'committed before ship' }));
        expect(cancelRes.code, 'interposed cancel committed').toBe(200);
      },
      () => outcomeOf(marketPatch(mOrder.id, { status: 'shipped' })),
    );

    expect({
      shipCode: mShipOutcome.code,
      stored: await statusOf(mOrder.id),
      routes: await routesOf(mOrder.id),
      stock: await stockA(),
      events: eventsOf(mOrder.id),
    }).toEqual({
      shipCode: 409,
      stored: 'cancelled/PAID',
      routes: ['LOCAL_STOCK:CANCELLED'],
      stock: `${IN_STOCK}/0`,
      events: ['store_order.cancelled'],
    });

    // 2. PATCH /site 'SHIPPED' vs PATCH /site 'CANCELLED'
    await resetStock();
    const sOrder = await createStorefrontOrder({ status: 'CONFIRMED', paymentStatus: 'PAID', withReservedRoute: true });
    expect(await stockA()).toBe(`${IN_STOCK}/2`);
    seen = [];

    const sShipOutcome = await pauseAfterOrderRead(
      sOrder.id,
      async () => {
        const cancelRes = await outcomeOf(sitePatch(sOrder.id, 'CANCELLED'));
        expect(cancelRes.code, 'interposed site cancel committed').toBe(200);
      },
      () => outcomeOf(sitePatch(sOrder.id, 'SHIPPED')),
    );

    expect({
      shipCode: sShipOutcome.code,
      stored: await statusOf(sOrder.id),
      routes: await routesOf(sOrder.id),
      stock: await stockA(),
      events: eventsOf(sOrder.id),
    }).toEqual({
      shipCode: 409,
      stored: 'CANCELLED/PAID',
      routes: ['LOCAL_STOCK:CANCELLED'],
      stock: `${IN_STOCK}/0`,
      events: ['store_order.cancelled'],
    });
  }, 30_000);

  it("OT-07 fulfillOrder('cancel') compare-and-set: PATCH /marketplace 'shipped' committing while fulfillOrder('cancel') waits on stock locks causes cancel to fail 409 and roll back its release", async () => {
    await resetStock();
    const order = await createStandardOrder({ route: true });
    expect(await statusOf(order.id)).toBe('routed/PAID');
    expect(await stockA()).toBe(`${IN_STOCK}/2`);
    seen = [];

    const race = await whileWaitingOnStock(
      () => fulfil(order.id, 'cancel', { reason: 'ot07 race' }),
      () => marketPatch(order.id, { status: 'shipped' }),
    );

    expect({
      waited: race.waited,
      shipOutcome: typeof race.secondOutcome === 'object' ? `${race.secondOutcome.code}:${race.secondOutcome.status}` : race.secondOutcome,
      cancelCode: race.firstOutcome.code,
      stored: await statusOf(order.id),
      routes: await routesOf(order.id),
      stock: await stockA(),
      events: eventsOf(order.id),
      cancelledStep: (await stepsOf(order.id)).includes('cancelled'),
    }).toEqual({
      waited: true,
      shipOutcome: '200:shipped',
      cancelCode: 409,
      stored: 'shipped/PAID',
      routes: ['LOCAL_STOCK:RESERVED'],
      stock: `${IN_STOCK}/2`,
      events: ['store_order.shipped'],
      cancelledStep: false,
    });
  }, 30_000);

  it("OT-08 fulfillOrder('ship') compare-and-set: PATCH /marketplace 'delivered' committing while fulfillOrder('ship') waits on stock locks causes ship to fail 409 and roll back shipment, route, stock decrement, and movement", async () => {
    await resetStock();
    const order = await createStandardOrder({ route: true });
    await fulfil(order.id, 'process');
    expect(await statusOf(order.id)).toBe('picking_packing/PAID');
    expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:PICKING_PACKING']);
    expect(await stockA()).toBe(`${IN_STOCK}/2`);
    seen = [];

    const race = await whileWaitingOnStock(
      () => fulfil(order.id, 'ship', { carrier: 'DHL', trackingNumber: `${P}TRK_OT08` }),
      () => marketPatch(order.id, { status: 'delivered' }),
    );

    expect({
      waited: race.waited,
      deliverOutcome: typeof race.secondOutcome === 'object' ? `${race.secondOutcome.code}:${race.secondOutcome.status}` : race.secondOutcome,
      shipCode: race.firstOutcome.code,
      stored: await statusOf(order.id),
      routes: await routesOf(order.id),
      stock: await stockA(),
      shipments: await shipmentsCountOf(order.id),
      movements: (await shipMovementsOf(order.id)).length,
      events: eventsOf(order.id),
    }).toEqual({
      waited: true,
      deliverOutcome: '200:delivered',
      shipCode: 409,
      stored: 'delivered/PAID',
      routes: ['LOCAL_STOCK:PICKING_PACKING'],
      stock: `${IN_STOCK}/2`,
      shipments: 0,
      movements: 0,
      events: ['store_order.delivered'],
    });
  }, 30_000);

  it('OT-09 real concurrent Postgres Promise.allSettled ship-vs-cancel races across all pairs yield exactly one winner and consistent stock, routes, and events', async () => {
    const assertConsistent = async (
      label: string,
      orderId: string,
      shipRes: Outcome,
      cancelRes: Outcome,
      shipDecrementsStock: boolean,
    ) => {
      const codes = [shipRes.code, cancelRes.code].sort();
      expect(codes[0], `${label}: one winner 200 (${JSON.stringify({ shipRes, cancelRes })})`).toBe(200);
      expect([400, 409], `${label}: loser refused 400 or 409 (${JSON.stringify({ shipRes, cancelRes })})`).toContain(codes[1]);

      const finalStatus = await statusOf(orderId);
      const routes = await routesOf(orderId);
      const stock = await stockA();
      const evs = eventsOf(orderId);

      if (shipRes.code === 200) {
        expect(finalStatus.toLowerCase(), `${label}: shipped winner stored`).toBe('shipped/paid');
        expect(evs, `${label}: no cancelled event`).toEqual(['store_order.shipped']);
        expect((await stepsOf(orderId)).includes('cancelled'), `${label}: no cancelled step`).toBe(false);
        if (shipDecrementsStock) {
          expect(routes, `${label}: route SHIPPED`).toEqual(['LOCAL_STOCK:SHIPPED']);
          expect(stock, `${label}: stock decremented once`).toBe(`${IN_STOCK - 2}/0`);
          expect((await shipMovementsOf(orderId)).length, `${label}: one SHIP movement`).toBe(1);
        } else {
          expect(routes, `${label}: route stays RESERVED`).toEqual(['LOCAL_STOCK:RESERVED']);
          expect(stock, `${label}: reservation intact`).toBe(`${IN_STOCK}/2`);
        }
      } else {
        expect(finalStatus.toLowerCase(), `${label}: cancelled winner stored`).toBe('cancelled/paid');
        expect(evs, `${label}: no shipped event`).toEqual(['store_order.cancelled']);
        expect(routes, `${label}: route CANCELLED`).toEqual(['LOCAL_STOCK:CANCELLED']);
        expect(stock, `${label}: reservation released once, never negative`).toBe(`${IN_STOCK}/0`);
        expect(await shipmentsCountOf(orderId), `${label}: no shipment`).toBe(0);
        expect((await shipMovementsOf(orderId)).length, `${label}: no SHIP movement`).toBe(0);
      }
    };

    // Pair A: fulfillOrder('ship') vs PATCH /marketplace 'cancelled'
    await resetStock();
    const orderA = await createStandardOrder({ route: true });
    await fulfil(orderA.id, 'process');
    seen = [];
    const [shipA, cancelA] = await Promise.all([
      outcomeOf(fulfil(orderA.id, 'ship', { carrier: 'DHL', trackingNumber: `${P}TRK_A` })),
      outcomeOf(marketPatch(orderA.id, { status: 'cancelled' })),
    ]);
    await assertConsistent('Pair A fulfill-ship vs PATCH-cancel', orderA.id, shipA, cancelA, true);

    // Pair B: fulfillOrder('ship') vs fulfillOrder('cancel')
    await resetStock();
    const orderB = await createStandardOrder({ route: true });
    await fulfil(orderB.id, 'process');
    seen = [];
    const [shipB, cancelB] = await Promise.all([
      outcomeOf(fulfil(orderB.id, 'ship', { carrier: 'DHL', trackingNumber: `${P}TRK_B` })),
      outcomeOf(fulfil(orderB.id, 'cancel', { reason: 'race B' })),
    ]);
    await assertConsistent('Pair B fulfill-ship vs fulfill-cancel', orderB.id, shipB, cancelB, true);

    // Pair C: PATCH /marketplace 'shipped' vs fulfillOrder('cancel')
    await resetStock();
    const orderC = await createStandardOrder({ route: true });
    seen = [];
    const [shipC, cancelC] = await Promise.all([
      outcomeOf(marketPatch(orderC.id, { status: 'shipped' })),
      outcomeOf(fulfil(orderC.id, 'cancel', { reason: 'race C' })),
    ]);
    await assertConsistent('Pair C PATCH-shipped vs fulfill-cancel', orderC.id, shipC, cancelC, false);

    // Pair D: PATCH /site 'SHIPPED' vs PATCH /site 'CANCELLED'
    await resetStock();
    const orderD = await createStorefrontOrder({ status: 'CONFIRMED', paymentStatus: 'PAID', withReservedRoute: true });
    seen = [];
    const [shipD, cancelD] = await Promise.all([
      outcomeOf(sitePatch(orderD.id, 'SHIPPED')),
      outcomeOf(sitePatch(orderD.id, 'CANCELLED')),
    ]);
    await assertConsistent('Pair D PATCH-/site-SHIPPED vs PATCH-/site-CANCELLED', orderD.id, shipD, cancelD, false);
  }, 45_000);
});
