/**
 * W10-Z4-ROUTE-FIX (owner ruling D-112; seam review findings SEAMZ4-CR-1..4):
 * fulfilment routing beside the other writers of an order and its stock, on a
 * real database.
 *
 * FulfillmentRoutingService.routeOrder (b5fd64f1) claims an order with a
 * transaction-scoped advisory lock and writes everything routing makes (routes,
 * supplier POs, preorders, stock reservations, the order's status and steps) in
 * that one transaction. Each case below was red at f38185ce:
 *
 *   RC-01 (SEAMZ4-CR-1) two paid orders naming the same tracked products in
 *         opposite line order (O1 [A, B], O2 [B, A]; 10 in stock each), routed
 *         at once with each held after its first reservation until the other
 *         has made its own: each transaction held one stock row and waited for
 *         the other's (Postgres 40P01), one aborted, its order kept no routes
 *         and StoreOrderRoutingListener emitted store_order.routing_failed (an
 *         operator "routing failed" action and a failed contact event) for a
 *         paid order that nothing routes again. Now every routing claim locks
 *         the stock rows it can touch in one order (id ascending) before its
 *         first reservation: both orders routed, each routed once (no deadlock
 *         lost and retried), 2 reserved of each product.
 *   RC-02 (SEAMZ4-CR-1) the same cycle between routing and the paid door's
 *         stock decrement (StoreOrderService.completeCheckout, a storefront
 *         order [B, A] settled by its provider while a paid order [A, B] is
 *         routed): a deadlock aborted one of them (the customer's settlement or
 *         the routing). Now the door locks its stock rows in the same order at
 *         the start of its transaction: both commit.
 *   RC-03 (SEAMZ4-CR-1) the same cycle between routing and a purchase order
 *         received (advancePurchaseOrderStatus RECEIVED, lines [B, A]): both
 *         commit, stock received and reserved exactly.
 *   RC-04 (SEAMZ4-CR-1) a routing claim that loses a deadlock or a
 *         serialization failure anyway (40P01 or 40001 raised by Postgres, or
 *         Prisma's P2034) is run again once, so the listener reports the order
 *         routed with one route set and one reservation (the lost attempt rolled
 *         back), not a routing failure; a second loss in a row is reported.
 *   RC-05 (SEAMZ4-CR-2) a placed order being routed by createOrder's
 *         un-awaited autoRouteOrder(false) is marked paid meanwhile: the router
 *         wrote back the status it read ('placed') over paid, and the paid
 *         routers then met routes on a 'placed' order and moved nothing, so the
 *         order stayed placed/PAID. Now routing writes a status only for an
 *         order it read paid, and only while the order still has the status it
 *         read (one conditional UPDATE): the order ends routed/PAID.
 *   RC-06 (SEAMZ4-CR-2) a paid order cancelled while it is being routed: the
 *         cancel released no reservation (none had committed) and the router
 *         then wrote 'routed' over 'cancelled', leaving a RESERVED route and
 *         reserved stock on a cancelled order. Now the cancel takes the
 *         order's routing claim: it waits for the router, then releases what
 *         the routes reserved and cancels them.
 *   RC-07 (SEAMZ4-CR-3) a storefront order settled by its provider or offline
 *         is CONFIRMED / PAID; the routing listener routed it and wrote
 *         'awaiting_payment' (CONFIRMED's marketplace reading) on the paid
 *         order, which the storefront summary, the order list's filters and the
 *         customer's tracking do not know. Now routing reads a stored PAID as
 *         paid and keeps a storefront status (the storefront's own vocabulary)
 *         as it is: the order stays CONFIRMED / PAID with its routes.
 *   RC-08 (SEAMZ4-CR-4) GET .../orders/:id/token read the whole metadata and
 *         wrote its copy back with the token, undoing a step committed between
 *         its read and its write, and replaced a token another call had just
 *         set. Now the token is written in one statement only where none is
 *         stored, and a token stored first is the one returned.
 *   RC-09 (F-25, closed by RC-01's lock order) two paid orders with the same
 *         tracked line, routed at once: both read reserved 0 before either
 *         wrote, and the second wrote 0 + 1 over the first's 1. Now the claim
 *         locks the row before the read: 2 reserved.
 *
 * Nothing on these paths is mocked: PrismaService, FulfillmentRoutingService,
 * StoreOrderRoutingListener, MarketplaceService, StoreOrderService (the paid
 * door), InvoiceWorkflowService, RevenuePostingService, ExpensePostingService
 * and PostingService write real rows. Stand-ins are off these paths: CrmService
 * (resolves the seeded contact), PublicEventsService, PromoCodeService,
 * InventoryRiskService, TransactionalEmailService and the timeline. The
 * interleavings are forced, not hoped for: a case holds a transaction at the
 * point the review's probe held it (after its first stock row write, or where
 * a router reserves), each hold bounded by a window so that a fixed engine,
 * which never reaches the hold while the other party is waiting on a lock,
 * passes it.
 *
 * Fixtures: prefix `v18r_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v18r_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  warehouse: `${P}wh`,
  /** Two tracked products, 10 in stock each in the one warehouse. */
  productA: `${P}prod_a`,
  productB: `${P}prod_b`,
  stockA: `${P}stock_a`,
  stockB: `${P}stock_b`,
  /** An untracked product (no stock kept). */
  productU: `${P}prod_u`,
};
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const PRICE = 10;
const IN_STOCK = 10;
/** How long a hold waits for the other party before it lets its own transaction go on. */
const HOLD_WINDOW_MS = 1_500;

let db: any;
let app: any;
let events: any;
let storeOrders: any;
let market: any;
let routing: any;
let listener: any;
let prismaService: any;

/** store_order.* events in emit order. */
let seen: Array<{ name: string; payload: any }> = [];
/** Routing started un-awaited (autoRouteOrder, the listener on the bus), awaited by drain(). */
const inflight: Promise<unknown>[] = [];
let orderSeq = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      /* best-effort */
    }
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
  const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');

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
  // The routing listener as production builds it, called by a case (or put on the bus by one).
  listener = new (StoreOrderRoutingListener as any)(prismaService, routing, events);

  events.onAny((name: string | string[], payload: any) => {
    const n = Array.isArray(name) ? name.join('.') : String(name);
    if (n.startsWith('store_order.')) seen.push({ name: n, payload });
  });

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V18R Routing', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.membership.create({ data: { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({
    data: { id: ID.contact, businessId: ID.biz, firstName: 'Vee', lastName: 'Router', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
  await db.warehouse.create({ data: { id: ID.warehouse, businessId: ID.biz, name: 'V18R Warehouse' } });
  for (const [id, name] of [
    [ID.productA, 'V18R Tracked A'],
    [ID.productB, 'V18R Tracked B'],
  ]) {
    await db.product.create({
      data: { id, businessId: ID.biz, name, price: PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked' },
    });
  }
  await db.product.create({
    data: { id: ID.productU, businessId: ID.biz, name: 'V18R Untracked', price: PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true },
  });
  await db.inventoryStock.create({ data: { id: ID.stockA, businessId: ID.biz, productId: ID.productA, warehouseId: ID.warehouse, quantity: IN_STOCK, reserved: 0 } });
  await db.inventoryStock.create({ data: { id: ID.stockB, businessId: ID.biz, productId: ID.productB, warehouseId: ID.warehouse, quantity: IN_STOCK, reserved: 0 } });
}, 60_000);

afterAll(async () => {
  await drain();
  await cleanup();
  await app?.close();
});

beforeEach(async () => {
  await drain();
  seen = [];
  await db.inventoryStock.updateMany({ where: { businessId: ID.biz }, data: { quantity: IN_STOCK, reserved: 0 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Await routing started un-awaited, until nothing new has started for a few quiet windows. */
async function drain() {
  for (let quiet = 0; quiet < 4; ) {
    const busy = inflight.length > 0;
    while (inflight.length > 0) await inflight.shift()!.catch(() => undefined);
    await sleep(75);
    quiet = busy || inflight.length > 0 ? 0 : quiet + 1;
  }
}

/** routeOrder (real) tracked, so a case can await the routing an un-awaited caller started. */
function trackRouting() {
  const real = routing.routeOrder.bind(routing);
  return vi.spyOn(routing, 'routeOrder').mockImplementation((...args: any[]) => {
    const work = (real as (...a: any[]) => Promise<any>)(...args);
    inflight.push(work);
    return work;
  });
}

/** StoreOrderRoutingListener on the suite's bus ({ async: true }: on a later tick), its work awaited by drain(). */
function listenerOnTheBus() {
  const onPaid = (payload: unknown) => {
    inflight.push(new Promise((resolve) => setImmediate(() => resolve(listener.onStoreOrderPaid(payload)))));
  };
  events.on('store_order.paid', onPaid);
  return () => events.off('store_order.paid', onPaid);
}

/** An order of the business with its lines inserted one by one, in the order given (the order routing reads them in). */
async function orderWithLines(
  productIds: string[],
  fields: { type?: string; status: string; paymentStatus: string; paymentMethod?: string },
) {
  orderSeq += 1;
  const total = PRICE * productIds.length;
  const order = await db.marketplaceOrder.create({
    data: {
      businessId: ID.biz,
      orderNumber: `${P}ord_${orderSeq}_${Date.now()}`,
      type: fields.type ?? 'STANDARD',
      status: fields.status,
      paymentStatus: fields.paymentStatus,
      paymentMethod: fields.paymentMethod ?? null,
      customerName: 'Vee Router',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: total,
      total,
      currency: 'TTD',
      metadata: { statusTimeline: [{ status: fields.status, timestamp: '2026-11-12T10:00:00.000Z', note: 'Order placed' }] },
    },
  });
  for (const productId of productIds) {
    await db.marketplaceOrderItem.create({
      data: { orderId: order.id, productId, name: productId, quantity: 1, unitPrice: PRICE, total: PRICE },
    });
  }
  return order;
}

/** A paid STANDARD order stored paid / PAID (the shape the paid door leaves it in). */
const paidOrder = (productIds: string[]) => orderWithLines(productIds, { status: 'paid', paymentStatus: 'PAID', paymentMethod: 'CASH' });

const stockOf = async (id: string) => {
  const s = await db.inventoryStock.findUnique({ where: { id } });
  return `${s.quantity}/${s.reserved}`;
};
const routesOf = async (orderId: string) =>
  (await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId }, orderBy: { createdAt: 'asc' } })).map(
    (r: any) => `${r.strategy}:${r.status}`,
  );
const statusOf = async (orderId: string) => {
  const o = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return `${o.status}/${o.paymentStatus}`;
};
const stepsOf = async (orderId: string) =>
  ((((await db.marketplaceOrder.findUnique({ where: { id: orderId } })).metadata as any)?.statusTimeline ?? []) as any[]).map((t) => t.status);
/** The routing events the listener emitted for an order: fulfillment_routed:<routeCount> or routing_failed:<error>. */
const announcedFor = (orderId: string) =>
  seen
    .filter((e) => e.payload?.orderId === orderId && /^store_order\.(fulfillment_routed|routing_failed)$/.test(e.name))
    .map((e) => (e.name === 'store_order.routing_failed' ? `routing_failed:${e.payload.error}` : `fulfillment_routed:${e.payload.routeCount}`));

/**
 * Every interactive transaction run through PrismaService.client (the routing claim, the paid door, a purchase order
 * received) has its inventory_stocks row writes (tx.inventoryStock.update) passed to `afterWrite` once each has run,
 * inside the transaction, with that transaction's number; with `method` 'findFirst', its stock row reads instead.
 * Restored by the returned function.
 */
function hookStockWrites(afterWrite: (txNo: number, args: any) => Promise<void>, method: 'update' | 'findFirst' = 'update') {
  const real = prismaService.client;
  let txNo = 0;
  const bound = (target: any, prop: PropertyKey) => {
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const wrapTx = (tx: any, no: number) =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop !== 'inventoryStock') return bound(target, prop);
        const delegate = Reflect.get(target, prop);
        return new Proxy(delegate, {
          get(d, p) {
            if (p !== method) return bound(d, p);
            return async (args: any) => {
              const result = await d[method](args);
              await afterWrite(no, args);
              return result;
            };
          },
        });
      },
    });
  prismaService.client = new Proxy(real, {
    get(target, prop) {
      if (prop !== '$transaction') return bound(target, prop);
      return (arg: any, options?: any) =>
        typeof arg === 'function'
          ? target.$transaction((tx: any) => arg(wrapTx(tx, ++txNo)), options)
          : target.$transaction(arg, options);
    },
  });
  return {
    transactions: () => txNo,
    restore: () => {
      prismaService.client = real;
    },
  };
}

/**
 * The review's probe: each of `parties` transactions is held right after its first stock row write until every party
 * has made its own first write (each then holds one stock row), or HOLD_WINDOW_MS has passed. Records which row each
 * party wrote first.
 */
function holdAfterFirstStockWrite(parties: number) {
  const first = new Map<number, string>();
  let allIn!: () => void;
  const gathered = new Promise<void>((resolve) => (allIn = resolve));
  const hook = hookStockWrites(async (no, args) => {
    if (first.has(no)) return;
    first.set(no, String(args?.where?.id));
    if (first.size >= parties) allIn();
    await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
  });
  return { firstWrites: () => [...first.values()], transactions: hook.transactions, restore: hook.restore };
}

/** The routing claim's own body (routeClaimedOrder), counted: one call per claim transaction run. */
const countClaims = () => vi.spyOn(routing as any, 'routeClaimedOrder');

describe('W10-Z4-ROUTE-FIX routing beside the order and stock writers (real database)', () => {
  it('RC-01 (SEAMZ4-CR-1) two paid orders with the same tracked products in opposite line order, routed at once and each held after its first reservation: no deadlock, both routed once (2 LOCAL_STOCK RESERVED routes each), 2 reserved of each product, and no store_order.routing_failed', async () => {
    const o1 = await paidOrder([ID.productA, ID.productB]);
    const o2 = await paidOrder([ID.productB, ID.productA]);
    const claims = countClaims();
    const held = holdAfterFirstStockWrite(2);
    try {
      await Promise.all([
        listener.onStoreOrderPaid({ order: { id: o1.id }, businessId: ID.biz }),
        listener.onStoreOrderPaid({ order: { id: o2.id }, businessId: ID.biz }),
      ]);
    } finally {
      held.restore();
    }
    // The interleave the review forced: each router's first reservation was on a different product.
    expect(new Set(held.firstWrites()).size, `each router reserved a different row first (${held.firstWrites().join(', ')})`).toBe(2);
    // At f38185ce one transaction aborted with 40P01 and the listener reported it.
    expect(announcedFor(o1.id), 'O1 routed, no routing failure').toEqual(['fulfillment_routed:2']);
    expect(announcedFor(o2.id), 'O2 routed, no routing failure').toEqual(['fulfillment_routed:2']);
    expect(await routesOf(o1.id)).toEqual(['LOCAL_STOCK:RESERVED', 'LOCAL_STOCK:RESERVED']);
    expect(await routesOf(o2.id)).toEqual(['LOCAL_STOCK:RESERVED', 'LOCAL_STOCK:RESERVED']);
    expect(await statusOf(o1.id)).toBe('routed/PAID');
    expect(await statusOf(o2.id)).toBe('routed/PAID');
    expect(await stockOf(ID.stockA), 'A: 2 reserved').toBe(`${IN_STOCK}/2`);
    expect(await stockOf(ID.stockB), 'B: 2 reserved').toBe(`${IN_STOCK}/2`);
    // Taken in one order, the stock locks never cycle: each order was claimed and routed once, no deadlock lost and run again.
    expect(claims, 'one routing claim per order').toHaveBeenCalledTimes(2);
  });

  it('RC-02 (SEAMZ4-CR-1) routing a paid order [A, B] while the paid door settles a storefront order [B, A] (its stock decremented in its transaction), each held after its first stock write: no deadlock, the settlement and the routing both commit with exact stock', async () => {
    const routed = await paidOrder([ID.productA, ID.productB]);
    const storefront = await orderWithLines([ID.productB, ID.productA], { type: 'STOREFRONT', status: 'PENDING', paymentStatus: 'UNPAID', paymentMethod: 'WIPAY' });
    const claims = countClaims();
    const held = holdAfterFirstStockWrite(2);
    let settled: string | number;
    try {
      // The settlement first (it writes B first), then the router (it reserves A first).
      const settlement = storeOrders
        .updatePaymentStatus(storefront.id, 'PAID', `${P}wipay_${storefront.id}`, 'wipay')
        .then((o: any) => `${o.status}/${o.paymentStatus}`, (err: any) => `${err?.code ?? err?.name}: ${err?.message}`);
      await sleep(300);
      const route = listener.onStoreOrderPaid({ order: { id: routed.id }, businessId: ID.biz });
      [settled] = await Promise.all([settlement, route]);
    } finally {
      held.restore();
    }
    expect(new Set(held.firstWrites()).size, `the door and the router wrote different rows first (${held.firstWrites().join(', ')})`).toBe(2);
    expect(settled!, 'the provider settlement commits').toBe('CONFIRMED/PAID');
    expect(announcedFor(routed.id), 'the paid order is routed, no routing failure').toEqual(['fulfillment_routed:2']);
    expect(await routesOf(routed.id)).toEqual(['LOCAL_STOCK:RESERVED', 'LOCAL_STOCK:RESERVED']);
    expect(await stockOf(ID.stockA), 'A: 1 sold, 1 reserved').toBe(`${IN_STOCK - 1}/1`);
    expect(await stockOf(ID.stockB), 'B: 1 sold, 1 reserved').toBe(`${IN_STOCK - 1}/1`);
    expect(claims, 'the paid order was claimed and routed once').toHaveBeenCalledTimes(1);
  });

  it('RC-03 (SEAMZ4-CR-1) routing a paid order [A, B] while a purchase order with lines [B, A] is received, each held after its first stock write: no deadlock, 5 received and 1 reserved of each', async () => {
    const routed = await paidOrder([ID.productA, ID.productB]);
    const po = await db.purchaseOrder.create({
      data: {
        businessId: ID.biz,
        poNumber: `${P}po_${Date.now()}`,
        status: 'SHIPPED',
        supplierName: 'V18R Supplier',
        items: [
          { productId: ID.productB, name: 'B', quantity: 5, unitPrice: 4, unitCost: 4, total: 20, warehouseId: ID.warehouse },
          { productId: ID.productA, name: 'A', quantity: 5, unitPrice: 4, unitCost: 4, total: 20, warehouseId: ID.warehouse },
        ],
        subtotal: 40,
        shippingCost: 0,
        taxAmount: 0,
        total: 40,
        currency: 'TTD',
      },
    });
    const claims = countClaims();
    const held = holdAfterFirstStockWrite(2);
    let received: string;
    try {
      const receipt = routing
        .advancePurchaseOrderStatus(ID.biz, po.id, 'RECEIVED')
        .then((r: any) => r.status, (err: any) => `${err?.code ?? err?.name}: ${err?.message}`);
      await sleep(300);
      const route = listener.onStoreOrderPaid({ order: { id: routed.id }, businessId: ID.biz });
      [received] = await Promise.all([receipt, route]);
    } finally {
      held.restore();
    }
    expect(new Set(held.firstWrites()).size, `the receipt and the router wrote different rows first (${held.firstWrites().join(', ')})`).toBe(2);
    expect(received!, 'the purchase order is received').toBe('RECEIVED');
    expect(announcedFor(routed.id), 'the paid order is routed, no routing failure').toEqual(['fulfillment_routed:2']);
    expect(await stockOf(ID.stockA), 'A: 5 received, 1 reserved').toBe(`${IN_STOCK + 5}/1`);
    expect(await stockOf(ID.stockB), 'B: 5 received, 1 reserved').toBe(`${IN_STOCK + 5}/1`);
    expect(claims, 'the paid order was claimed and routed once').toHaveBeenCalledTimes(1);
  });

  it('RC-04 (SEAMZ4-CR-1) a routing claim that loses a deadlock or serialization failure (40P01 or 40001 from Postgres, Prisma P2034) after reserving is run again once: the listener reports the order routed, with one route and one unit reserved (the lost attempt rolled back); a second loss in a row is reported as a routing failure', async () => {
    const { Prisma } = await import('@prisma/client');
    const raise = (code: string) => async (tx: any) =>
      tx.$executeRawUnsafe(`DO $$ BEGIN RAISE EXCEPTION 'v18r lost the routing claim' USING ERRCODE = '${code}'; END $$`);
    /** Other transactions a loss started, settled once the losing attempt has rolled back. */
    const others: Promise<unknown>[] = [];
    const losses: Array<[string, (tx: any) => Promise<unknown>]> = [
      // A real lock cycle on a model write, the shape the driver adapter gives a deadlock (PrismaClientUnknownRequestError
      // naming PostgresError code "40P01", no Prisma code): another transaction holds B and then asks for A, which the
      // routing holds, while the routing asks for B. The routing waited first, so its deadlock check fires first and
      // Postgres aborts it.
      [
        'deadlock (lock cycle)',
        async (tx: any) => {
          let holdsB!: () => void;
          const holding = new Promise<void>((resolve) => (holdsB = resolve));
          others.push(
            db.$transaction(
              async (other: any) => {
                await other.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', ID.stockB);
                holdsB();
                await sleep(300);
                await other.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', ID.stockA);
              },
              { timeout: 20_000, maxWait: 5_000 },
            ),
          );
          await holding;
          await tx.inventoryStock.update({ where: { id: ID.stockB }, data: { reserved: { increment: 0 } } });
        },
      ],
      ['40P01 (raised)', raise('40P01')],
      ['40001 (raised)', raise('40001')],
      [
        'P2034',
        async () => {
          throw new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock. Please retry your transaction', {
            code: 'P2034',
            clientVersion: 'test',
          });
        },
      ],
    ];
    for (const [code, lose] of losses) {
      await db.inventoryStock.updateMany({ where: { businessId: ID.biz }, data: { quantity: IN_STOCK, reserved: 0 } });
      seen = [];
      const order = await paidOrder([ID.productA]);
      const real = routing.routeLocalStock.bind(routing);
      let calls = 0;
      const spy = vi.spyOn(routing as any, 'routeLocalStock').mockImplementation(async (...args: any[]) => {
        calls += 1;
        const route = await real(...args);
        if (calls === 1) await lose(args[0]);
        return route;
      });
      try {
        await listener.onStoreOrderPaid({ order: { id: order.id }, businessId: ID.biz });
      } finally {
        spy.mockRestore();
        await Promise.allSettled(others.splice(0));
      }
      expect(announcedFor(order.id), `${code}: routed on the second attempt, no routing failure`).toEqual(['fulfillment_routed:1']);
      expect(await routesOf(order.id), `${code}: one route`).toEqual(['LOCAL_STOCK:RESERVED']);
      expect(await stockOf(ID.stockA), `${code}: one unit reserved`).toBe(`${IN_STOCK}/1`);
      expect((await stepsOf(order.id)).filter((s) => s === 'routes_created'), `${code}: routes_created once`).toHaveLength(1);
    }

    // Two losses in a row: one retry only, then the failure is reported and nothing is left behind.
    await db.inventoryStock.updateMany({ where: { businessId: ID.biz }, data: { quantity: IN_STOCK, reserved: 0 } });
    seen = [];
    const order = await paidOrder([ID.productA]);
    const real = routing.routeLocalStock.bind(routing);
    const spy = vi.spyOn(routing as any, 'routeLocalStock').mockImplementation(async (...args: any[]) => {
      const route = await real(...args);
      await raise('40P01')(args[0]);
      return route;
    });
    let attempts = 0;
    try {
      await listener.onStoreOrderPaid({ order: { id: order.id }, businessId: ID.biz });
      attempts = spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
    expect(attempts, 'two attempts').toBe(2);
    expect(announcedFor(order.id).map((a) => a.split(':')[0]), 'the second loss is reported').toEqual(['routing_failed']);
    expect(await routesOf(order.id), 'no route').toEqual([]);
    expect(await stockOf(ID.stockA), 'nothing reserved').toBe(`${IN_STOCK}/0`);
    expect(await statusOf(order.id)).toBe('paid/PAID');
  });

  it('RC-05 (SEAMZ4-CR-2) a placed order being routed by createOrder\'s autoRouteOrder(false) is marked paid meanwhile (mark_paid through the paid door, both paid routers on): the placed router no longer writes back the status it read, and the order ends routed/PAID with one route', async () => {
    const tracked = trackRouting();
    const off = listenerOnTheBus();
    // The first router (createOrder's) is held where it reserves until the marking has returned, or the window passes.
    const real = routing.routeLocalStock.bind(routing);
    let markingDone!: () => void;
    const marked = new Promise<void>((resolve) => (markingDone = resolve));
    let arrived!: () => void;
    const firstRouterIn = new Promise<void>((resolve) => (arrived = resolve));
    let calls = 0;
    vi.spyOn(routing as any, 'routeLocalStock').mockImplementation(async (...args: any[]) => {
      calls += 1;
      if (calls === 1) {
        arrived();
        await Promise.race([marked, sleep(5_000)]);
      }
      return real(...args);
    });
    let orderId = '';
    let routers = 0;
    try {
      const order = await market.createOrder(
        ID.biz,
        { customerName: 'Vee Router', customerEmail: CUSTOMER_EMAIL, items: [{ productId: ID.productA, quantity: 1 }] },
        ID.owner,
      );
      orderId = order.id;
      await firstRouterIn;
      const paid = await market.fulfillOrder(ID.biz, order.id, 'mark_paid', { paymentMethod: 'CASH', note: 'rc05' }, ID.owner);
      expect(paid.paymentStatus).toBe('PAID');
      markingDone();
      await drain();
      routers = tracked.mock.calls.length;
    } finally {
      markingDone();
      off();
      tracked.mockRestore();
      await drain();
    }
    expect(routers, 'three routers: createOrder, mark_paid and the listener').toBe(3);
    // At f38185ce the placed router wrote 'placed' over paid and the paid routers met a placed order: placed/PAID.
    expect(await statusOf(orderId), 'the paid order is routed').toBe('routed/PAID');
    expect(await routesOf(orderId), 'one route').toEqual(['LOCAL_STOCK:RESERVED']);
    expect(await stockOf(ID.stockA), 'one unit reserved').toBe(`${IN_STOCK}/1`);
    const steps = await stepsOf(orderId);
    expect(steps.filter((s) => s === 'routes_created'), `routes_created once (${steps.join(' | ')})`).toHaveLength(1);
    expect(steps.filter((s) => s === 'routed'), `routed once (${steps.join(' | ')})`).toHaveLength(1);
    expect(steps.indexOf('routed') > steps.lastIndexOf('paid'), `routed after the paid marking (${steps.join(' | ')})`).toBe(true);
  });

  it('RC-06 (SEAMZ4-CR-2) a paid order cancelled while it is being routed: the cancel waits for the router, then releases the reservation and cancels the route; the order ends cancelled with no RESERVED route and nothing reserved', async () => {
    const order = await paidOrder([ID.productA]);
    const real = routing.routeLocalStock.bind(routing);
    let cancelDone!: () => void;
    const cancelled = new Promise<void>((resolve) => (cancelDone = resolve));
    let arrived!: () => void;
    const reserved = new Promise<void>((resolve) => (arrived = resolve));
    // The router is held after it has reserved and made its route (not committed) until the cancel has returned, or
    // the window passes.
    vi.spyOn(routing as any, 'routeLocalStock').mockImplementation(async (...args: any[]) => {
      const route = await real(...args);
      arrived();
      await Promise.race([cancelled, sleep(HOLD_WINDOW_MS)]);
      return route;
    });
    const routingDone = routing.routeOrder(ID.biz, order.id).then(
      (routes: any[]) => routes.length,
      (err: any) => `${err?.name}: ${err?.message}`,
    );
    await reserved;
    const answer = await market
      .fulfillOrder(ID.biz, order.id, 'cancel', { reason: 'rc06' }, ID.owner)
      .then((o: any) => o.status, (err: any) => `${err?.name}: ${err?.message}`);
    cancelDone();
    expect(await routingDone, 'the router committed its route').toBe(1);
    expect(answer, 'the cancel is answered with the order cancelled').toBe('cancelled');
    // At f38185ce: routed/PAID, its route RESERVED and one unit reserved, on an order the member cancelled.
    expect(await statusOf(order.id), 'the order stays cancelled').toBe('cancelled/PAID');
    expect(await routesOf(order.id), 'its route is cancelled').toEqual(['LOCAL_STOCK:CANCELLED']);
    expect(await stockOf(ID.stockA), 'nothing left reserved').toBe(`${IN_STOCK}/0`);
    const steps = await stepsOf(order.id);
    expect(steps.indexOf('cancelled') > steps.indexOf('routes_created'), `cancelled after the routing (${steps.join(' | ')})`).toBe(true);
  });

  it('RC-07 (SEAMZ4-CR-3) a storefront order settled by its provider, and one completed offline, then routed by the listener on store_order.paid: each stays CONFIRMED / PAID with its route, so the storefront summary counts it as confirmed and the customer\'s tracking shows CONFIRMED', async () => {
    const off = listenerOnTheBus();
    try {
      for (const settle of ['provider', 'offline'] as const) {
        const before = await storeOrders.getOrderSummary(ID.biz);
        const placed = await storeOrders.createOrder({
          businessId: ID.biz,
          cartItems: [{ productId: ID.productU, quantity: 1 }],
          customerInfo: { name: 'Vee Router', email: CUSTOMER_EMAIL },
          paymentMethod: settle === 'provider' ? 'CARD' : 'CASH',
        });
        expect(placed.type).toBe('STOREFRONT');
        seen = [];
        if (settle === 'provider') {
          await storeOrders.updatePaymentStatus(placed.id, 'PAID', `${P}card_${placed.id}`, 'stripe');
        } else {
          await storeOrders.completeOfflineOrder(placed.id, ID.biz, ID.owner);
        }
        await drain();
        expect(announcedFor(placed.id), `${settle}: routed by the listener`).toEqual(['fulfillment_routed:1']);
        expect(await routesOf(placed.id), `${settle}: its route`).toEqual(['LOCAL_STOCK:RESERVED']);
        // At f38185ce the router stored awaiting_payment on the paid storefront order.
        expect(await statusOf(placed.id), `${settle}: the storefront status is kept`).toBe('CONFIRMED/PAID');
        const after = await storeOrders.getOrderSummary(ID.biz);
        expect(after.confirmedOrders - before.confirmedOrders, `${settle}: counted as confirmed in the storefront summary`).toBe(1);
        expect((await storeOrders.getPublicOrder(placed.id, CUSTOMER_EMAIL)).status, `${settle}: the customer's tracking`).toBe('CONFIRMED');
        expect(await stepsOf(placed.id), `${settle}: the routing step`).toContain('routes_created');
      }
    } finally {
      off();
      await drain();
    }
  });

  it('RC-08 (SEAMZ4-CR-4) GET .../orders/:id/token writes the token in one statement: a step committed while it runs is kept, and a token another call stored first is the one returned (and stays stored)', async () => {
    /** Run `work` while a transaction holds the order's row with `change` written and not committed; commit it once `work` waits. */
    const whileRowHeld = async (orderId: string, change: string, work: () => Promise<string>) => {
      let commit!: () => void;
      const go = new Promise<void>((resolve) => (commit = resolve));
      let held!: (pid: number) => void;
      const isHeld = new Promise<number>((resolve) => (held = resolve));
      const holder = db.$transaction(
        async (tx: any) => {
          await tx.$executeRawUnsafe(`UPDATE marketplace_orders SET metadata = ${change} WHERE id = $1`, orderId);
          const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
          held(pid);
          await go;
        },
        { timeout: 20_000, maxWait: 5_000 },
      );
      const holderPid = await isHeld;
      const answer = work();
      // Commit once the token write waits behind this transaction's row lock (or after a window: a write that never
      // waits).
      for (let i = 0; i < 40; i += 1) {
        const [{ waiting }] = await db.$queryRawUnsafe(
          'SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
          holderPid,
        );
        if (waiting > 0) break;
        await sleep(50);
      }
      commit();
      await holder;
      return answer;
    };

    // A step committed between the token read and the token write.
    const order = await orderWithLines([ID.productU], { status: 'placed', paymentStatus: 'UNPAID' });
    const step = `jsonb_set(metadata, '{statusTimeline}', (metadata -> 'statusTimeline') || '[{"status":"routes_created","note":"v18r concurrent step"}]'::jsonb)`;
    const token = await whileRowHeld(order.id, step, () => market.getOrderToken(ID.biz, order.id));
    const stored = (await db.marketplaceOrder.findUnique({ where: { id: order.id } })).metadata as any;
    expect(stored.publicToken, 'the token is stored').toBe(token);
    expect((stored.statusTimeline ?? []).map((t: any) => t.status), 'the concurrent step is kept').toEqual(['placed', 'routes_created']);

    // A token another call stored first.
    const second = await orderWithLines([ID.productU], { status: 'placed', paymentStatus: 'UNPAID' });
    const other = `${P}token_stored_first`;
    const answered = await whileRowHeld(second.id, `metadata || '{"publicToken":"${other}"}'::jsonb`, () => market.getOrderToken(ID.biz, second.id));
    expect(answered, 'the token stored first is returned').toBe(other);
    expect(((await db.marketplaceOrder.findUnique({ where: { id: second.id } })).metadata as any).publicToken, 'and stays stored').toBe(other);
    expect((await market.getOrderByToken(other)).id, 'the link it was given still opens the order').toBe(second.id);

    // Unchanged: a stored token is returned as it is, and an order of another business is 404.
    expect(await market.getOrderToken(ID.biz, second.id)).toBe(other);
    const notFound = await market.getOrderToken(`${P}no_such_biz`, second.id).then(() => 200, (err: any) => err?.getStatus?.());
    expect(notFound).toBe(404);
  });
  it('RC-09 (F-25, closed by the SEAMZ4-CR-1 lock order) two paid orders with the same tracked line routed at once, each held after reading the stock row until the other has read it: each reservation counts the other, 2 reserved (the second no longer writes reserved 1 over the first\'s)', async () => {
    const o1 = await paidOrder([ID.productA]);
    const o2 = await paidOrder([ID.productA]);
    const reads = new Set<number>();
    let allIn!: () => void;
    const gathered = new Promise<void>((resolve) => (allIn = resolve));
    const hook = hookStockWrites(async (no) => {
      if (reads.has(no)) return;
      reads.add(no);
      if (reads.size >= 2) allIn();
      await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
    }, 'findFirst');
    try {
      await Promise.all([
        listener.onStoreOrderPaid({ order: { id: o1.id }, businessId: ID.biz }),
        listener.onStoreOrderPaid({ order: { id: o2.id }, businessId: ID.biz }),
      ]);
    } finally {
      hook.restore();
    }
    expect(announcedFor(o1.id)).toEqual(['fulfillment_routed:1']);
    expect(announcedFor(o2.id)).toEqual(['fulfillment_routed:1']);
    expect(await routesOf(o1.id)).toEqual(['LOCAL_STOCK:RESERVED']);
    expect(await routesOf(o2.id)).toEqual(['LOCAL_STOCK:RESERVED']);
    // At f38185ce both read reserved 0 before either wrote, and the second wrote 0 + 1 over the first's 1.
    expect(await stockOf(ID.stockA), 'two units reserved, one per order').toBe(`${IN_STOCK}/2`);
  });
});
