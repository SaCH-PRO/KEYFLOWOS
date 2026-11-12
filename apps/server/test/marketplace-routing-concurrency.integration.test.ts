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
 * The review of that fix (head 9645c474) found two more; each case below was
 * red at 9645c474:
 *
 *   RC-10 (Z4RV-SEC-1, pre-existing) a purchase order received
 *         (advancePurchaseOrderStatus RECEIVED) read and wrote the stock row of
 *         each line's (productId, warehouseId) as the purchase order's JSON
 *         named them, with no business filter, and created a row where none
 *         existed: a purchase order of business A naming B's product and
 *         warehouse added to B's stock and rewrote B's weighted-average cost,
 *         and one naming a product of B with no stock row planted a row of A
 *         for it (which makes B's product read as tracked). Those rows were
 *         also outside the receipt's stock locks. Now a line naming a product
 *         or a warehouse that is not the business's is refused (400) before
 *         anything is written, and the receipt reads and writes only the
 *         business's rows.
 *   RC-11..RC-13 (Z4RV-CR-1, introduced at 9645c474) one tracked product kept
 *         in two warehouses (S_LO, the lower id, with 10; S_HI with 5), and a
 *         transfer of it from S_HI's warehouse to S_LO's: the transfer was a
 *         batch transaction writing its from row, then its to row (S_HI, then
 *         S_LO, not the id order), while the fulfil cancel, a purchase order
 *         received and routing each locked the product's rows in every
 *         warehouse, written or not. With a holder transaction on S_HI (the
 *         transfer queued behind it, the other party started until it waits
 *         too, then the holder let go), the transfer took S_HI and asked for
 *         S_LO while the other held S_LO and asked for S_HI: 40P01, and the
 *         cancel (RC-11) or the receipt (RC-12) was rolled back, or routing
 *         (RC-13) lost its first claim. Now the transfer locks its two rows in
 *         the global order first, and the cancel and the receipt lock only
 *         the rows they write: each pair commits, routing claims once.
 *   RC-14 (Z4RV-CR-1) the continental-ops stock writers (a delivery note
 *         fulfilled, a goods receipt posted, a stock count adjusted) updated
 *         each line's stock in line order, outside the global order: with
 *         lines [B, A] beside routing [A, B], each held after its first stock
 *         write, they deadlocked. Now each locks its products' rows in the
 *         global order first: both commit, routing claims once.
 *
 * W10-Z5-TRANSFER-FIX: the transfer rewrite (b668df8b, one interactive
 * transaction locking its from and to rows first) read its rows by
 * findFirst({ businessId, productId, warehouseId }); two reviews found, and
 * each case below except RC-16 was red at 0cbcd4c3:
 *
 *   RC-15 (Z5SEC-1 / Z5-CR-1, introduced by b668df8b) POST .../inventory/transfer
 *         (body: any, no DTO) with productId, fromWarehouseId or toWarehouseId
 *         missing: Prisma read the undefined field as no filter, the lock
 *         skipped the incomplete pair, and the transfer committed wrong stock
 *         and answered success (the to row read as the from row and written
 *         q-n then q+n; any warehouse and any row of the product as the
 *         destination; rows of two different products, unlocked, with
 *         movements naming no product). At its parent findUnique on an
 *         incomplete compound key threw before writing. Now a transfer whose
 *         ids are not non-empty strings, or whose quantity is not a positive
 *         whole number, is refused with 400 before any transaction.
 *   RC-16 (Z5SEC-1, a characterization, green before and after) a well-formed
 *         transfer keeps its refusals, texts and order.
 *   RC-17 (Z5SEC-2, pre-existing) the transfer never checked that its product
 *         and warehouses are the business's: a row the old cross-business
 *         purchase order receipt planted (this business's id on another
 *         business's product or warehouse) could be moved out of, creating
 *         rows of this business for another business's product. Now the
 *         product and both warehouses are checked as the receipt checks its
 *         lines (raw SQL by the business's own id): 404 with the existing
 *         texts.
 *   RC-18, RC-19 (Z5SEC-2, pre-existing) such a planted row holds the unique
 *         (product_id, warehouse_id) of the other business's own pair: that
 *         business's purchase order received, or its transfer, into the pair
 *         created its row and failed on an unhandled P2002 (500; the purchase
 *         order stayed SHIPPED). Now 409 naming no other business's id;
 *         nothing is written, and the planted row is left for an operator.
 *
 * W11-INV-UPSERT-SCOPE (the Z4RV-SEC-1 sibling): POST .../inventory
 * (MarketplaceService.upsertInventory, body: any, no DTO) read the stock row by
 * (productId, warehouseId) alone, updated it by id, else created a row of the
 * caller's business for whatever pair the body named. Each case below was red
 * at fb00af1c:
 *
 *   RC-20 with no ambient tenant (the service called directly, as here and as
 *         any non-HTTP caller): a body naming B's stocked pair rewrote B's row
 *         (999 at 0.01), and bodies naming B's product or warehouse created
 *         rows of this business. Now the product and the warehouse must be the
 *         business's (raw SQL by its own id): 404, nothing written.
 *   RC-21 the same with the ambient tenant armed as main.ts arms it: the scoped
 *         read missed B's row and the create hit the unique pair (500, P2002),
 *         and the others planted rows of this business (B's XB2 then read as
 *         stock-tracked). Now the same 404s.
 *   RC-22 malformed ids and fields answered 500 (PrismaClientValidationError)
 *         or stored fractions and negatives. Now 400 naming the field, before
 *         any read (an id filter object would match any row once the read is
 *         by business, the Z5SEC-1 lesson).
 *   RC-23 the business's own rows keep today's partial update (only the fields
 *         sent; digit text from the web form is that number, D-136) and create;
 *         a pair a planted row holds answers 409 (D-137: the operator repairs).
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
  /**
   * A tracked product kept in two warehouses: S_LO (the lower id) in the first warehouse, S_HI in the second. The cases
   * using it give S_LO 10 and S_HI 5, so routing reserves from S_LO.
   */
  productM: `${P}prod_m`,
  warehouse2: `${P}wh_2`,
  stockMLo: `${P}stock_m1`,
  stockMHi: `${P}stock_m2`,
  /** Another business: a product with a stock row (10 at cost 5) in its warehouse, and a product with no stock row. */
  bizB: `${P}biz_b`,
  warehouseB: `${P}wh_b`,
  productXB: `${P}prod_xb`,
  stockXB: `${P}stock_xb`,
  productXB2: `${P}prod_xb2`,
  /** A second warehouse of the other business (no stock row of its own). */
  warehouseB2: `${P}wh_b2`,
  /**
   * Rows the old cross-business purchase order receipt planted (W10-Z5-TRANSFER-FIX, Z5SEC-2): business_id is this
   * business while the product or the warehouse is the other business's. Planted by a case with raw SQL and removed by
   * it.
   */
  plantedXB2InB: `${P}planted_xb2_whb`,
  plantedXBInA: `${P}planted_xb_wh`,
  plantedAInB: `${P}planted_a_whb`,
  plantedXBInB2: `${P}planted_xb_whb2`,
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
let deliveryNotes: any;
let goodsReceipts: any;
let stockCounts: any;
/** MarketplaceController, as POST .../inventory/transfer and POST .../inventory call it (body: any, no DTO). */
let controller: any;
/** @keyflow/db (its setTenantContextProvider) and src/core/tenant/tenant-context, for the cases that arm the ambient tenant. */
let dbModule: any;
let tenantContext: any;

/** store_order.* events in emit order. */
let seen: Array<{ name: string; payload: any }> = [];
/** Routing started un-awaited (autoRouteOrder, the listener on the bus), awaited by drain(). */
const inflight: Promise<unknown>[] = [];
let orderSeq = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  for (const sql of [
    `DELETE FROM delivery_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM goods_receipts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_counts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  dbModule = dbMod;
  tenantContext = await import('../src/core/tenant/tenant-context');

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
  const { DeliveryNoteService } = await import('../src/modules/continental-ops/delivery-note.service');
  const { GoodsReceiptService } = await import('../src/modules/continental-ops/goods-receipt.service');
  const { StockCountService } = await import('../src/modules/continental-ops/stock-count.service');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');

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
      DeliveryNoteService,
      GoodsReceiptService,
      StockCountService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  events = app.get(EventEmitter2);
  storeOrders = app.get(StoreOrderService);
  market = app.get(MarketplaceService);
  routing = app.get(FulfillmentRoutingService);
  prismaService = app.get(PrismaService);
  deliveryNotes = app.get(DeliveryNoteService);
  goodsReceipts = app.get(GoodsReceiptService);
  stockCounts = app.get(StockCountService);
  // The route's handler over the suite's MarketplaceService (the transfer route uses no other dependency).
  controller = new (MarketplaceController as any)(market, {}, prismaService);
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

  // A tracked product kept in two warehouses (the second created after the first, so the first stays the default).
  await db.warehouse.create({ data: { id: ID.warehouse2, businessId: ID.biz, name: 'V18R Warehouse 2' } });
  await db.product.create({
    data: { id: ID.productM, businessId: ID.biz, name: 'V18R Two Warehouses', price: PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked' },
  });
  await db.inventoryStock.create({ data: { id: ID.stockMLo, businessId: ID.biz, productId: ID.productM, warehouseId: ID.warehouse, quantity: IN_STOCK, reserved: 0 } });
  await db.inventoryStock.create({ data: { id: ID.stockMHi, businessId: ID.biz, productId: ID.productM, warehouseId: ID.warehouse2, quantity: IN_STOCK, reserved: 0 } });

  // Another business (inventoryMode not set: tracked only while it keeps a stock row, resolveInventoryMode).
  await db.business.create({ data: { id: ID.bizB, name: 'V18R Other Business', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.warehouse.create({ data: { id: ID.warehouseB, businessId: ID.bizB, name: 'V18R Other Warehouse' } });
  await db.warehouse.create({ data: { id: ID.warehouseB2, businessId: ID.bizB, name: 'V18R Other Warehouse 2' } });
  for (const [id, name] of [
    [ID.productXB, 'V18R Other Stocked'],
    [ID.productXB2, 'V18R Other Unstocked'],
  ]) {
    await db.product.create({ data: { id, businessId: ID.bizB, name, price: PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true } });
  }
  await db.inventoryStock.create({
    data: { id: ID.stockXB, businessId: ID.bizB, productId: ID.productXB, warehouseId: ID.warehouseB, quantity: IN_STOCK, reserved: 0, costPerUnit: 5 },
  });
}, 60_000);

afterAll(async () => {
  // RC-21 restores it in its own finally; this keeps a failed run from leaving the ambient tenant armed.
  dbModule?.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
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
 * inside the transaction, with that transaction's number; with `method` 'findFirst', its stock row reads instead, and
 * with a list, each of those (e.g. update and updateMany, the continental-ops writers' form). Restored by the returned
 * function.
 */
function hookStockWrites(
  afterWrite: (txNo: number, args: any) => Promise<void>,
  method: 'update' | 'findFirst' | Array<'update' | 'updateMany'> = 'update',
) {
  const methods: PropertyKey[] = Array.isArray(method) ? method : [method];
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
            if (!methods.includes(p)) return bound(d, p);
            return async (args: any) => {
              const result = await d[p as string](args);
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
 * party wrote first (its id, or `product:<id>` for an updateMany by product).
 */
function holdAfterFirstStockWrite(parties: number, methods: Array<'update' | 'updateMany'> = ['update']) {
  const first = new Map<number, string>();
  let allIn!: () => void;
  const gathered = new Promise<void>((resolve) => (allIn = resolve));
  const hook = hookStockWrites(async (no, args) => {
    if (first.has(no)) return;
    first.set(no, args?.where?.id ? String(args.where.id) : `product:${args?.where?.productId}`);
    if (first.size >= parties) allIn();
    await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
  }, methods);
  return { firstWrites: () => [...first.values()], transactions: hook.transactions, restore: hook.restore };
}

/** The routing claim's own body (routeClaimedOrder), counted: one call per claim transaction run. */
const countClaims = () => vi.spyOn(routing as any, 'routeClaimedOrder');

const setStock = (id: string, quantity: number, reserved = 0) => db.inventoryStock.update({ where: { id }, data: { quantity, reserved } });

/** Sessions of this database waiting for a lock now. */
async function waitingSessions(): Promise<number> {
  const [{ waiting }] = await db.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0',
  );
  return waiting;
}

/** Polls `holds` until it is true or `windowMs` has passed; says which. */
async function within(windowMs: number, holds: () => Promise<boolean>): Promise<boolean> {
  for (const end = Date.now() + windowMs; Date.now() < end; await sleep(25)) {
    if (await holds()) return true;
  }
  return false;
}

/** A party's answer: what it returned, or `error: <code>: <message>`. */
const answerOf = (work: Promise<unknown>) =>
  work.then(
    (value) => value,
    (err: any) => `error: ${err?.code ?? err?.getStatus?.() ?? err?.name}: ${err?.message}`,
  );

/**
 * The review's interleave (Z4RV-CR-1): a holder transaction locks the stock row `heldRow`; `first` is started and runs
 * until it waits behind the holder; `second` is started and runs until it waits too, or HOLD_WINDOW_MS passes (a party
 * that never waits); then the holder lets go. Returns both answers, and whether `first` waited behind the holder.
 */
async function behindHolder(heldRow: string, first: () => Promise<unknown>, second: () => Promise<unknown>) {
  let letGo!: () => void;
  const go = new Promise<void>((resolve) => (letGo = resolve));
  let holding!: () => void;
  const held = new Promise<void>((resolve) => (holding = resolve));
  const holder = db.$transaction(
    async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', heldRow);
      holding();
      await go;
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  await held;
  let firstAnswer: Promise<unknown> = Promise.resolve();
  let secondAnswer: Promise<unknown> = Promise.resolve();
  let firstWaited = false;
  try {
    firstAnswer = answerOf(first());
    firstWaited = await within(5_000, async () => (await waitingSessions()) >= 1);
    secondAnswer = answerOf(second());
    await within(HOLD_WINDOW_MS, async () => (await waitingSessions()) >= 2);
  } finally {
    letGo();
    await holder;
  }
  return { firstWaited, answers: await Promise.all([firstAnswer, secondAnswer]) };
}

/** A transfer of 2 of product M from S_HI's warehouse to S_LO's (its from row has the higher id). */
const transferHiToLo = () =>
  market
    .transferInventory(ID.biz, { productId: ID.productM, fromWarehouseId: ID.warehouse2, toWarehouseId: ID.warehouse, quantity: 2, note: 'v18r' })
    .then((r: any) => (r?.success ? 'transferred' : r));

/** A purchase order of the business in status SHIPPED with these lines. */
const shippedPurchaseOrder = (items: any[]) =>
  db.purchaseOrder.create({
    data: {
      businessId: ID.biz,
      poNumber: `${P}po_${++orderSeq}_${Date.now()}`,
      status: 'SHIPPED',
      supplierName: 'V18R Supplier',
      items,
      subtotal: 0,
      shippingCost: 0,
      taxAmount: 0,
      total: 0,
      currency: 'TTD',
    },
  });

/** POST .../inventory/transfer as the route runs it: its handler, with the body as sent and the member's id. */
const transferByRoute = (businessId: string, body: Record<string, unknown>) =>
  Promise.resolve().then(() => controller.transferInventory(businessId, body, { user: { id: ID.owner } }));

/**
 * A call's answer as the route gives it: 'committed' when it returned success, else the HTTP status it is answered with
 * (500 for an error that carries none, with its code) and its message.
 */
const routeAnswer = (work: Promise<unknown>) =>
  work.then(
    (r: any) => (r?.success ? 'committed' : r),
    (err: any) =>
      typeof err?.getStatus === 'function' ? `${err.getStatus()}: ${err.message}` : `500: ${err?.code ?? err?.name}`,
  );
/** The status alone ('committed', or the number). */
const routeStatus = (work: Promise<unknown>) =>
  routeAnswer(work).then((a) => (typeof a === 'string' && /^\d{3}: /.test(a) ? Number(a.slice(0, 3)) : a));

/** Every stock row the suite's fixtures own or name (by business, product or warehouse), and its stock movement count. */
async function stockState() {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT id, business_id, product_id, warehouse_id, quantity, reserved, cost_per_unit FROM inventory_stocks
      WHERE business_id LIKE ${sqlLikePrefix(P)} OR product_id LIKE ${sqlLikePrefix(P)} OR warehouse_id LIKE ${sqlLikePrefix(P)}
      ORDER BY id`,
  );
  const [{ n }]: any[] = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM stock_movements
      WHERE business_id LIKE ${sqlLikePrefix(P)} OR product_id LIKE ${sqlLikePrefix(P)} OR warehouse_id LIKE ${sqlLikePrefix(P)}`,
  );
  return { rows: new Map(rows.map((r) => [String(r.id), JSON.stringify(r)])), movements: n as number };
}

/** A call's answer and what it wrote: stock rows changed, created or removed, and stock movements added. */
async function answerAndWrites(call: () => Promise<unknown>) {
  const before = await stockState();
  const answer = await call();
  const after = await stockState();
  const ids = new Set([...before.rows.keys(), ...after.rows.keys()]);
  return {
    answer,
    stockRowsWritten: [...ids].filter((id) => before.rows.get(id) !== after.rows.get(id)).length,
    movementsWritten: after.movements - before.movements,
  };
}

/** This business's stock as the suite seeds it: no row a call created, every row (a planted one too) at IN_STOCK, none reserved. */
async function resetBusinessStock() {
  await db.$executeRawUnsafe(
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)} AND id NOT LIKE ${sqlLikePrefix(P)}`,
  );
  await db.inventoryStock.updateMany({ where: { businessId: ID.biz }, data: { quantity: IN_STOCK, reserved: 0 } });
}

/**
 * Plants rows as the old cross-business purchase order receipt left them (raw SQL, as it wrote them): business_id is
 * this business (ID.biz), the product and the warehouse as given, IN_STOCK of each at cost 5.
 */
async function plantRows(rows: Array<[id: string, productId: string, warehouseId: string]>) {
  for (const [id, productId, warehouseId] of rows) {
    await db.$executeRaw`
      INSERT INTO inventory_stocks (id, business_id, product_id, warehouse_id, quantity, reserved, cost_per_unit, currency, updated_at)
      VALUES (${id}, ${ID.biz}, ${productId}, ${warehouseId}, ${IN_STOCK}, 0, 5, 'TTD', now())`;
  }
}
const removeRows = (ids: string[]) => db.$executeRaw`DELETE FROM inventory_stocks WHERE id = ANY(${ids}::text[])`;

/** POST .../inventory as the route runs it: its handler (MarketplaceController.upsertInventory), with the body as sent. */
const upsertByRoute = (businessId: string, body: Record<string, unknown>) =>
  Promise.resolve().then(() => controller.upsertInventory(businessId, body));
/** An upsert's answer as the route gives it: 'committed' when it returned a stock row, else as routeAnswer reads it. */
const upsertAnswer = (work: Promise<unknown>) => routeAnswer(work.then((row: any) => ({ success: typeof row?.id === 'string' })));

/** The other business's own stock row (XB in WB) as the suite seeds it, read with no tenant: [businessId, quantity, reserved, cost]. */
const otherBusinessRow = async () => {
  const [row]: any[] = await db.$queryRaw`
    SELECT business_id, quantity, reserved, cost_per_unit FROM inventory_stocks WHERE id = ${ID.stockXB}`;
  return [row.business_id, row.quantity, row.reserved, row.cost_per_unit];
};
const restoreOtherBusinessRow = () =>
  db.$executeRaw`UPDATE inventory_stocks SET business_id = ${ID.bizB}, quantity = ${IN_STOCK}, reserved = 0, cost_per_unit = 5 WHERE id = ${ID.stockXB}`;
/** How many stock rows hold a product, whatever their business (raw SQL: no tenant filter). */
const stockRowsOfProduct = async (productId: string) => {
  const [{ n }]: any[] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM inventory_stocks WHERE product_id = ${productId}`;
  return n as number;
};

/**
 * W11-INV-UPSERT-SCOPE: the four bodies a member of this business (ID.biz) sent naming the other business's product or
 * warehouse, measured at fb00af1c, each with the answer it gets now.
 */
const foreignUpserts = (): Array<[name: string, body: Record<string, unknown>, answer: string]> => [
  [
    "B's stocked pair (XB in WB), 999 at cost 0.01",
    { productId: ID.productXB, warehouseId: ID.warehouseB, quantity: 999, costPerUnit: 0.01 },
    '404: Product not found',
  ],
  ["B's unstocked product in B's warehouse (XB2 in WB)", { productId: ID.productXB2, warehouseId: ID.warehouseB, quantity: 5 }, '404: Product not found'],
  ["this business's own product into B's warehouse", { productId: ID.productA, warehouseId: ID.warehouseB, quantity: 5 }, '404: Warehouse not found'],
  ["B's product into this business's warehouse", { productId: ID.productXB, warehouseId: ID.warehouse, quantity: 5 }, '404: Product not found'],
];

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

  it('RC-10 (Z4RV-SEC-1) a purchase order received adds stock only to its own business: a line naming another business\'s product (in its warehouse, or with none) or another business\'s warehouse is refused with 400 before anything is written; the other business\'s stock and cost are untouched, no row is planted for its product, and the purchase order stays SHIPPED', async () => {
    const pos: Record<string, any[]> = {
      // The review's probe: B's stocked product in B's warehouse at a dumping cost, and B's unstocked product.
      "the review's purchase order (B's product in B's warehouse; B's unstocked product, default warehouse)": [
        { productId: ID.productXB, name: 'XB', quantity: 1000, unitPrice: 0.01, unitCost: 0.01, total: 10, warehouseId: ID.warehouseB },
        { productId: ID.productXB2, name: 'XB2', quantity: 1, unitPrice: 1, unitCost: 1, total: 1 },
      ],
      "B's unstocked product only (default warehouse)": [{ productId: ID.productXB2, name: 'XB2', quantity: 1, unitPrice: 1, unitCost: 1, total: 1 }],
      "its own product into B's warehouse": [{ productId: ID.productA, name: 'A', quantity: 3, unitPrice: 1, unitCost: 1, total: 3, warehouseId: ID.warehouseB }],
      "its own line first, then B's product": [
        { productId: ID.productA, name: 'A', quantity: 3, unitPrice: 1, unitCost: 1, total: 3, warehouseId: ID.warehouse },
        { productId: ID.productXB, name: 'XB', quantity: 5, unitPrice: 1, unitCost: 1, total: 5, warehouseId: ID.warehouseB },
      ],
    };
    const answers: Record<string, unknown> = {};
    const statuses: Record<string, string> = {};
    const poIds: string[] = [];
    for (const [name, items] of Object.entries(pos)) {
      const po = await shippedPurchaseOrder(items);
      poIds.push(po.id);
      answers[name] = await routing.advancePurchaseOrderStatus(ID.biz, po.id, 'RECEIVED').then(
        (r: any) => r.status,
        (err: any) => err?.getStatus?.() ?? `${err?.name}: ${err?.message}`,
      );
      statuses[name] = (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status;
    }
    // At 9645c474 each was RECEIVED: B's stock went to 1010 at cost 0.0594 and rows were planted.
    expect(answers, 'each receipt refused').toEqual(Object.fromEntries(Object.keys(pos).map((name) => [name, 400])));
    expect(statuses, 'each purchase order stays SHIPPED').toEqual(Object.fromEntries(Object.keys(pos).map((name) => [name, 'SHIPPED'])));
    const otherStock = await db.inventoryStock.findUnique({ where: { id: ID.stockXB } });
    expect([otherStock.businessId, otherStock.quantity, otherStock.reserved, otherStock.costPerUnit], "B's stock row as it was").toEqual([ID.bizB, IN_STOCK, 0, 5]);
    const planted = await db.inventoryStock.findMany({
      where: { OR: [{ productId: { in: [ID.productXB, ID.productXB2] } }, { warehouseId: ID.warehouseB }] },
      select: { id: true },
    });
    expect(planted.map((r: any) => r.id), "no stock row for B's products or in B's warehouse but B's own").toEqual([ID.stockXB]);
    const unstocked = await db.product.findUnique({ where: { id: ID.productXB2 }, select: { _count: { select: { inventoryStocks: true } } } });
    expect(unstocked._count.inventoryStocks, "B's unstocked product keeps no stock row (it still reads as untracked)").toBe(0);
    expect(await stockOf(ID.stockA), "the refused purchase order's own line is not received either").toBe(`${IN_STOCK}/0`);
    expect(await db.stockMovement.count({ where: { referenceId: { in: poIds } } }), 'no stock movement').toBe(0);
  });

  it('RC-11 (Z4RV-CR-1) a transfer of product M from S_HI\'s warehouse to S_LO\'s, queued behind a holder on S_HI, while the fulfil cancel of an order reserved from S_LO runs: no deadlock, the cancel commits (cancelled, its route CANCELLED, nothing reserved) and the transfer commits (2 moved)', async () => {
    await setStock(ID.stockMHi, 5);
    const order = await paidOrder([ID.productM]);
    expect((await routing.routeOrder(ID.biz, order.id)).length).toBe(1);
    expect(await stockOf(ID.stockMLo), 'routing reserved from S_LO (the row with the most stock)').toBe(`${IN_STOCK}/1`);
    const { firstWaited, answers } = await behindHolder(ID.stockMHi, transferHiToLo, () =>
      market.fulfillOrder(ID.biz, order.id, 'cancel', { reason: 'rc11' }, ID.owner).then((o: any) => o.status),
    );
    expect(firstWaited, 'the transfer queued behind the holder').toBe(true);
    // At 9645c474 the cancel locked S_LO and waited for S_HI, the transfer took S_HI and waited for S_LO: 40P01, the
    // cancel rolled back and the order stayed routed with its route RESERVED.
    expect(answers, '[transfer, cancel]').toEqual(['transferred', 'cancelled']);
    expect(await statusOf(order.id)).toBe('cancelled/PAID');
    expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:CANCELLED']);
    expect(await stockOf(ID.stockMLo), 'S_LO: 2 transferred in, nothing reserved').toBe(`${IN_STOCK + 2}/0`);
    expect(await stockOf(ID.stockMHi), 'S_HI: 2 transferred out').toBe('3/0');
  });

  it('RC-12 (Z4RV-CR-1) the same transfer, queued behind a holder on S_HI, while a purchase order with a line of M into S_LO\'s warehouse is received: no deadlock, both commit (2 moved, 5 received)', async () => {
    await setStock(ID.stockMHi, 5);
    const po = await shippedPurchaseOrder([
      { productId: ID.productM, name: 'M', quantity: 5, unitPrice: 4, unitCost: 4, total: 20, warehouseId: ID.warehouse },
    ]);
    const { firstWaited, answers } = await behindHolder(ID.stockMHi, transferHiToLo, () =>
      routing.advancePurchaseOrderStatus(ID.biz, po.id, 'RECEIVED').then((r: any) => r.status),
    );
    expect(firstWaited, 'the transfer queued behind the holder').toBe(true);
    // At 9645c474 the receipt locked every row of M (S_LO, then S_HI) and lost the deadlock with the transfer.
    expect(answers, '[transfer, receipt]').toEqual(['transferred', 'RECEIVED']);
    expect(await stockOf(ID.stockMLo), 'S_LO: 2 transferred in, 5 received').toBe(`${IN_STOCK + 2 + 5}/0`);
    expect(await stockOf(ID.stockMHi), 'S_HI: 2 transferred out').toBe('3/0');
  });

  it('RC-13 (Z4RV-CR-1) the same transfer, queued behind a holder on S_HI, while a paid order with a line of M is routed: no deadlock, the transfer commits and the order is routed on its first claim (reserved from S_LO)', async () => {
    await setStock(ID.stockMHi, 5);
    const order = await paidOrder([ID.productM]);
    const claims = countClaims();
    const { firstWaited, answers } = await behindHolder(ID.stockMHi, transferHiToLo, () =>
      listener.onStoreOrderPaid({ order: { id: order.id }, businessId: ID.biz }).then(() => 'routed'),
    );
    expect(firstWaited, 'the transfer queued behind the holder').toBe(true);
    expect(answers, '[transfer, routing]').toEqual(['transferred', 'routed']);
    expect(announcedFor(order.id), 'routed, no routing failure').toEqual(['fulfillment_routed:1']);
    expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:RESERVED']);
    expect(await stockOf(ID.stockMLo), 'S_LO: 2 transferred in, 1 reserved').toBe(`${IN_STOCK + 2}/1`);
    expect(await stockOf(ID.stockMHi), 'S_HI: 2 transferred out').toBe('3/0');
    // At 9645c474 routing lost its first claim to the deadlock and was routed on the retry.
    expect(claims, 'one routing claim').toHaveBeenCalledTimes(1);
  });

  it('RC-14 (Z4RV-CR-1) a delivery note fulfilled, a goods receipt posted and a stock count adjusted, each with lines [B, A], beside routing a paid order [A, B], each held after its first stock write: no deadlock, both commit, the order routed on its first claim with stock exact', async () => {
    let docSeq = 0;
    const writers: Array<[string, () => Promise<() => Promise<unknown>>, string, number]> = [
      [
        'delivery note fulfilled',
        async () => {
          const invoice = await db.invoice.create({
            data: { businessId: ID.biz, contactId: ID.contact, invoiceNumber: `${P}inv_${++docSeq}_${Date.now()}`, total: 0 },
          });
          const dn = await db.deliveryNote.create({
            data: {
              businessId: ID.biz,
              invoiceId: invoice.id,
              dnNumber: `${P}dn_${docSeq}_${Date.now()}`,
              items: [
                { productId: ID.productB, description: 'B', quantity: 2 },
                { productId: ID.productA, description: 'A', quantity: 2 },
              ],
            },
          });
          return () => deliveryNotes.fulfill(ID.biz, dn.id, {}).then((d: any) => d.status);
        },
        'DELIVERED',
        IN_STOCK - 2,
      ],
      [
        'goods receipt posted',
        async () => {
          const gr = await db.goodsReceipt.create({
            data: {
              businessId: ID.biz,
              grNumber: `${P}gr_${++docSeq}_${Date.now()}`,
              items: [
                { productId: ID.productB, description: 'B', qtyOrdered: 3, qtyReceived: 3, qtyAccepted: 3, qtyRejected: 0 },
                { productId: ID.productA, description: 'A', qtyOrdered: 3, qtyReceived: 3, qtyAccepted: 3, qtyRejected: 0 },
              ],
            },
          });
          return () => goodsReceipts.post(ID.biz, gr.id).then((g: any) => g.status);
        },
        'POSTED',
        IN_STOCK + 3,
      ],
      [
        'stock count adjusted',
        async () => {
          const sc = await db.stockCount.create({
            data: {
              businessId: ID.biz,
              countNumber: `${P}sc_${++docSeq}_${Date.now()}`,
              status: 'COMPLETED',
              items: [
                { productId: ID.productB, description: 'B', systemQty: IN_STOCK, countedQty: 12, variance: 2 },
                { productId: ID.productA, description: 'A', systemQty: IN_STOCK, countedQty: 12, variance: 2 },
              ],
            },
          });
          return () => stockCounts.adjust(ID.biz, sc.id).then((s: any) => s.status);
        },
        'ADJUSTED',
        12,
      ],
    ];
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [name, prepare, done, quantity] of writers) {
      await db.inventoryStock.updateMany({ where: { businessId: ID.biz }, data: { quantity: IN_STOCK, reserved: 0 } });
      seen = [];
      const order = await paidOrder([ID.productA, ID.productB]);
      const write = await prepare();
      const claims = countClaims();
      const held = holdAfterFirstStockWrite(2, ['update', 'updateMany']);
      let answer: unknown;
      try {
        // The writer first (it writes B first), then the router (it reserves A first).
        const writing = answerOf(write());
        await sleep(300);
        const route = listener.onStoreOrderPaid({ order: { id: order.id }, businessId: ID.biz });
        [answer] = await Promise.all([writing, route]);
      } finally {
        held.restore();
      }
      outcomes[name] = {
        answer,
        routing: announcedFor(order.id),
        routes: await routesOf(order.id),
        stockA: await stockOf(ID.stockA),
        stockB: await stockOf(ID.stockB),
        claims: claims.mock.calls.length,
      };
      claims.mockRestore();
      expected[name] = {
        answer: done,
        routing: ['fulfillment_routed:2'],
        routes: ['LOCAL_STOCK:RESERVED', 'LOCAL_STOCK:RESERVED'],
        stockA: `${quantity}/1`,
        stockB: `${quantity}/1`,
        claims: 1,
      };
    }
    // At 9645c474 each writer and the routing deadlocked: the writer rolled back, or routing lost its first claim.
    expect(outcomes).toEqual(expected);
  }, 30_000);

  it('RC-15 (Z5SEC-1 / Z5-CR-1) POST .../inventory/transfer with productId, fromWarehouseId or toWarehouseId missing, empty, null, a number or a filter object, or with a quantity that is missing, a string or a fraction, is refused with 400 before anything is written: no stock row changed or created and no stock movement', async () => {
    const body = { productId: ID.productM, fromWarehouseId: ID.warehouse2, toWarehouseId: ID.warehouse, quantity: 2, note: 'rc15' };
    const without = (key: keyof typeof body) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== key));
    const probes: Record<string, Record<string, unknown>> = {
      // The review's three probes.
      'no fromWarehouseId (the to row read as the from row: stock made from nothing, a TRANSFER_OUT with no warehouse)': without('fromWarehouseId'),
      'no toWarehouseId (any warehouse, and any row of the product, possibly the from row)': without('toWarehouseId'),
      'no productId (rows of different products, not locked; movements with no product)': without('productId'),
      'productId an empty string': { ...body, productId: '' },
      'fromWarehouseId an empty string': { ...body, fromWarehouseId: '' },
      'toWarehouseId an empty string': { ...body, toWarehouseId: '' },
      'toWarehouseId null': { ...body, toWarehouseId: null },
      'fromWarehouseId a number': { ...body, fromWarehouseId: 42 },
      'productId a filter object': { ...body, productId: { not: '' } },
      'fromWarehouseId a filter object': { ...body, fromWarehouseId: { not: ID.warehouse } },
      'no quantity': without('quantity'),
      'quantity a string': { ...body, quantity: '2' },
      'quantity a fraction': { ...body, quantity: 1.5 },
    };
    const outcomes: Record<string, unknown> = {};
    try {
      for (const [name, sent] of Object.entries(probes)) {
        await resetBusinessStock();
        outcomes[name] = await answerAndWrites(() => routeStatus(transferByRoute(ID.biz, sent)));
      }
    } finally {
      await resetBusinessStock();
    }
    // At 0cbcd4c3 the three probes (and the empty or null ids) committed and answered success: probe 1 wrote the to
    // row q-n then q+n, probe 2 any row of M, probe 3 rows of two products; their parent commit threw before writing.
    expect(outcomes).toEqual(
      Object.fromEntries(Object.keys(probes).map((name) => [name, { answer: 400, stockRowsWritten: 0, movementsWritten: 0 }])),
    );
  });

  it('RC-16 (Z5SEC-1) a well-formed transfer keeps its refusals, their texts and their order (quantity, the same warehouse, the source row, the stock available, the destination warehouse), writes nothing when refused, and commits when it can (a soft-deleted product of the business too)', async () => {
    const body = { productId: ID.productM, fromWarehouseId: ID.warehouse2, toWarehouseId: ID.warehouse, quantity: 2, note: 'rc16' };
    const probes: Record<string, Record<string, unknown>> = {
      'quantity 0 and the same warehouse': { ...body, quantity: 0, toWarehouseId: ID.warehouse2 },
      'quantity -1': { ...body, quantity: -1 },
      'the same warehouse, more than is available': { ...body, toWarehouseId: ID.warehouse2, quantity: IN_STOCK + 1 },
      'no stock row of the product in the source warehouse': { ...body, productId: ID.productU },
      "more than is available, into a warehouse that is not the business's": { ...body, toWarehouseId: ID.warehouseB, quantity: IN_STOCK + 1 },
      'more than is available': { ...body, quantity: IN_STOCK + 1 },
      "into a warehouse that is not the business's": { ...body, toWarehouseId: ID.warehouseB },
      'into a warehouse that does not exist': { ...body, toWarehouseId: `${P}wh_none` },
    };
    const outcomes: Record<string, unknown> = {};
    try {
      for (const [name, sent] of Object.entries(probes)) {
        await resetBusinessStock();
        outcomes[name] = await answerAndWrites(() => routeAnswer(transferByRoute(ID.biz, sent)));
      }
      await resetBusinessStock();
      outcomes['a transfer it can make'] = await answerAndWrites(() => routeAnswer(transferByRoute(ID.biz, body)));
      expect([await stockOf(ID.stockMHi), await stockOf(ID.stockMLo)], 'S_HI 2 out, S_LO 2 in').toEqual([`${IN_STOCK - 2}/0`, `${IN_STOCK + 2}/0`]);
      // A soft-deleted product of the business is still the business's (the purchase order receipt's rule): it moves.
      await resetBusinessStock();
      await db.$executeRaw`UPDATE products SET deleted_at = now() WHERE id = ${ID.productM}`;
      outcomes['a soft-deleted product of the business'] = await answerAndWrites(() => routeAnswer(transferByRoute(ID.biz, body)));
    } finally {
      await db.$executeRaw`UPDATE products SET deleted_at = NULL WHERE id = ${ID.productM}`;
      await resetBusinessStock();
    }
    const refused = (answer: string) => ({ answer, stockRowsWritten: 0, movementsWritten: 0 });
    expect(outcomes).toEqual({
      'quantity 0 and the same warehouse': refused('400: Transfer quantity must be positive'),
      'quantity -1': refused('400: Transfer quantity must be positive'),
      'the same warehouse, more than is available': refused('400: Source and destination warehouses must be different'),
      'no stock row of the product in the source warehouse': refused('404: Source inventory not found'),
      "more than is available, into a warehouse that is not the business's": refused(`400: Insufficient available stock. Available: ${IN_STOCK}`),
      'more than is available': refused(`400: Insufficient available stock. Available: ${IN_STOCK}`),
      "into a warehouse that is not the business's": refused('404: Destination warehouse not found'),
      'into a warehouse that does not exist': refused('404: Destination warehouse not found'),
      'a transfer it can make': { answer: 'committed', stockRowsWritten: 2, movementsWritten: 2 },
      'a soft-deleted product of the business': { answer: 'committed', stockRowsWritten: 2, movementsWritten: 2 },
    });
  });

  it("RC-17 (Z5SEC-2) a transfer moves only its own business's product between its own warehouses: out of a planted row (this business's id on another business's product or warehouse) it is refused with 404 'Source inventory not found', into another business's warehouse with 404 'Destination warehouse not found', naming no other business's id, and nothing is written", async () => {
    await plantRows([
      [ID.plantedXB2InB, ID.productXB2, ID.warehouseB],
      [ID.plantedXBInA, ID.productXB, ID.warehouse],
      [ID.plantedAInB, ID.productA, ID.warehouseB],
    ]);
    const probes: Record<string, Record<string, unknown>> = {
      "B's product out of the planted row in B's warehouse, into this business's warehouse": {
        productId: ID.productXB2, fromWarehouseId: ID.warehouseB, toWarehouseId: ID.warehouse, quantity: 2,
      },
      "B's product out of the planted row in this business's warehouse, into its second warehouse": {
        productId: ID.productXB, fromWarehouseId: ID.warehouse, toWarehouseId: ID.warehouse2, quantity: 2,
      },
      "this business's product out of the planted row in B's warehouse, into this business's warehouse": {
        productId: ID.productA, fromWarehouseId: ID.warehouseB, toWarehouseId: ID.warehouse, quantity: 2,
      },
      "B's product out of the planted row in B's warehouse, into B's second warehouse": {
        productId: ID.productXB2, fromWarehouseId: ID.warehouseB, toWarehouseId: ID.warehouseB2, quantity: 2,
      },
      "this business's product into B's warehouse, where a planted row holds it": {
        productId: ID.productA, fromWarehouseId: ID.warehouse, toWarehouseId: ID.warehouseB, quantity: 2,
      },
    };
    const outcomes: Record<string, unknown> = {};
    try {
      for (const [name, sent] of Object.entries(probes)) {
        await resetBusinessStock();
        outcomes[name] = await answerAndWrites(() => routeAnswer(transferByRoute(ID.biz, sent)));
      }
    } finally {
      await removeRows([ID.plantedXB2InB, ID.plantedXBInA, ID.plantedAInB]);
      await resetBusinessStock();
    }
    const refused = (answer: string) => ({ answer, stockRowsWritten: 0, movementsWritten: 0 });
    // At 0cbcd4c3 the first three committed: stock moved out of the planted rows, and rows of this business were
    // created for B's products (which then read as stock-tracked).
    expect(outcomes).toEqual({
      "B's product out of the planted row in B's warehouse, into this business's warehouse": refused('404: Source inventory not found'),
      "B's product out of the planted row in this business's warehouse, into its second warehouse": refused('404: Source inventory not found'),
      "this business's product out of the planted row in B's warehouse, into this business's warehouse": refused('404: Source inventory not found'),
      "B's product out of the planted row in B's warehouse, into B's second warehouse": refused('404: Source inventory not found'),
      "this business's product into B's warehouse, where a planted row holds it": refused('404: Destination warehouse not found'),
    });
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
    const otherStock = await db.inventoryStock.findUnique({ where: { id: ID.stockXB } });
    expect([otherStock.quantity, otherStock.reserved, otherStock.costPerUnit], "B's own stock row as it was").toEqual([IN_STOCK, 0, 5]);
  });

  it("RC-18 (Z5SEC-2) B's own purchase order received for a (product, warehouse) whose stock row another business holds (planted by the old cross-business receipt) is refused with 409 naming no other business's id, not a 500: the purchase order stays SHIPPED, the planted row is untouched, and nothing is written", async () => {
    await plantRows([[ID.plantedXB2InB, ID.productXB2, ID.warehouseB]]);
    let outcome: unknown;
    try {
      const po = await db.purchaseOrder.create({
        data: {
          businessId: ID.bizB,
          poNumber: `${P}po_b_${++orderSeq}_${Date.now()}`,
          status: 'SHIPPED',
          supplierName: 'V18R Supplier',
          items: [{ productId: ID.productXB2, name: 'XB2', quantity: 3, unitPrice: 1, unitCost: 1, total: 3, warehouseId: ID.warehouseB }],
          subtotal: 0,
          shippingCost: 0,
          taxAmount: 0,
          total: 0,
          currency: 'TTD',
        },
      });
      outcome = await answerAndWrites(() =>
        routeAnswer(routing.advancePurchaseOrderStatus(ID.bizB, po.id, 'RECEIVED').then((r: any) => ({ success: r?.status === 'RECEIVED' }))),
      );
      expect((await db.purchaseOrder.findUnique({ where: { id: po.id } })).status, 'the purchase order stays SHIPPED').toBe('SHIPPED');
      const planted = await db.inventoryStock.findUnique({ where: { id: ID.plantedXB2InB } });
      expect([planted.businessId, planted.quantity, planted.reserved, planted.costPerUnit], 'the planted row untouched').toEqual([ID.biz, IN_STOCK, 0, 5]);
      expect(await db.stockMovement.count({ where: { referenceId: po.id } }), 'no stock movement').toBe(0);
    } finally {
      await removeRows([ID.plantedXB2InB]);
    }
    // At 0cbcd4c3: 500, an unhandled P2002 on the unique key (product_id, warehouse_id).
    expect(outcome).toEqual({
      answer: '409: A stock row for this product and warehouse is held by another record; ask an operator to repair it',
      stockRowsWritten: 0,
      movementsWritten: 0,
    });
    expect(JSON.stringify(outcome), "the answer names no id of the suite's").not.toContain(P);
  });

  it("RC-19 (Z5SEC-2) B's own transfer into a warehouse of B where another business holds the product's stock row (planted) is refused with 409 naming no other business's id, not a 500: B's source row and the planted row are untouched, and nothing is written", async () => {
    await plantRows([[ID.plantedXBInB2, ID.productXB, ID.warehouseB2]]);
    let outcome: unknown;
    try {
      outcome = await answerAndWrites(() =>
        routeAnswer(
          transferByRoute(ID.bizB, { productId: ID.productXB, fromWarehouseId: ID.warehouseB, toWarehouseId: ID.warehouseB2, quantity: 2, note: 'rc19' }),
        ),
      );
      const planted = await db.inventoryStock.findUnique({ where: { id: ID.plantedXBInB2 } });
      expect([planted.businessId, planted.quantity, planted.reserved], 'the planted row untouched').toEqual([ID.biz, IN_STOCK, 0]);
      const own = await db.inventoryStock.findUnique({ where: { id: ID.stockXB } });
      expect([own.quantity, own.reserved, own.costPerUnit], "B's source row as it was").toEqual([IN_STOCK, 0, 5]);
    } finally {
      await removeRows([ID.plantedXBInB2]);
    }
    // At 0cbcd4c3: 500, an unhandled P2002 on the unique key (product_id, warehouse_id).
    expect(outcome).toEqual({
      answer: '409: A stock row for this product and warehouse is held by another record; ask an operator to repair it',
      stockRowsWritten: 0,
      movementsWritten: 0,
    });
    expect(JSON.stringify(outcome), "the answer names no id of the suite's").not.toContain(P);
  });

  it("RC-20 (W11-INV-UPSERT-SCOPE, Z4RV-SEC-1 sibling) POST .../inventory with no ambient tenant, naming the other business's product or warehouse (its stocked pair at 999 / 0.01, its unstocked product in its warehouse, this business's product into its warehouse, its product into this business's warehouse), is refused with 404 'Product not found' or 'Warehouse not found' naming no id: B's own row unchanged, no stock row created, no stock movement", async () => {
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    try {
      for (const [name, body, answer] of foreignUpserts()) {
        outcomes[name] = await answerAndWrites(() => upsertAnswer(upsertByRoute(ID.biz, body)));
        expected[name] = { answer, stockRowsWritten: 0, movementsWritten: 0 };
      }
      expect(await otherBusinessRow(), "B's own stock row as it was [business, quantity, reserved, cost]").toEqual([ID.bizB, IN_STOCK, 0, 5]);
      expect(await stockRowsOfProduct(ID.productXB2), "B's unstocked product has no stock row (it does not read as tracked)").toBe(0);
    } finally {
      await restoreOtherBusinessRow();
      await resetBusinessStock();
    }
    // At fb00af1c the first rewrote B's row to 999 at 0.01 and the other three created rows of this business for B's
    // product or in B's warehouse (B's XB2 then read as stock-tracked).
    expect(outcomes).toEqual(expected);
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
  });

  it("RC-21 (W11-INV-UPSERT-SCOPE, Z4RV-SEC-1 sibling) the same four bodies with the ambient tenant armed as main.ts arms it (setTenantContextProvider, the call run in runWithTenant for this business) are refused with the same 404s: no 500, no stock row planted, B's own row unchanged", async () => {
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    dbModule.setTenantContextProvider({ getCurrentBusinessId: tenantContext.getCurrentBusinessId });
    try {
      for (const [name, body, answer] of foreignUpserts()) {
        outcomes[name] = await answerAndWrites(() =>
          upsertAnswer(tenantContext.runWithTenant(ID.biz, ID.owner, () => upsertByRoute(ID.biz, body))),
        );
        expected[name] = { answer, stockRowsWritten: 0, movementsWritten: 0 };
      }
    } finally {
      // Every other case runs with no ambient tenant.
      dbModule.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
    }
    let otherRow: unknown;
    let xb2Rows: unknown;
    try {
      otherRow = await otherBusinessRow();
      xb2Rows = await stockRowsOfProduct(ID.productXB2);
    } finally {
      await restoreOtherBusinessRow();
      await resetBusinessStock();
    }
    // At fb00af1c the first answered 500 (the tenant-scoped read missed B's row; the create hit the unique pair, P2002)
    // and the other three planted rows of this business: (XB2, WB), (A, WB), (XB, this business's warehouse).
    expect(outcomes).toEqual(expected);
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
    expect(otherRow, "B's own stock row as it was [business, quantity, reserved, cost]").toEqual([ID.bizB, IN_STOCK, 0, 5]);
    expect(xb2Rows, "B's unstocked product has no stock row (at fb00af1c: 1, so B's checkout refused it)").toBe(0);
  });

  it('RC-22 (W11-INV-UPSERT-SCOPE; D-136 whole stock quantities) POST .../inventory with productId or warehouseId missing, empty, null, a number, an array or a filter object, or with a quantity, reserved, reorderAt, costPerUnit or currency of the wrong shape (a fraction, a negative, a word, an object), is refused with 400 naming the field before anything is read or written', async () => {
    const body = { productId: ID.productA, warehouseId: ID.warehouse, quantity: 3 };
    const without = (key: keyof typeof body) => Object.fromEntries(Object.entries(body).filter(([k]) => k !== key));
    const productId = '400: Inventory productId is required (a non-empty string)';
    const warehouseId = '400: Inventory warehouseId is required (a non-empty string)';
    const whole = (field: string) => `400: Inventory ${field} must be a whole number of 0 or more`;
    const probes: Array<[string, Record<string, unknown>, string]> = [
      ['no productId', without('productId'), productId],
      ['productId an empty string', { ...body, productId: '' }, productId],
      ['productId null', { ...body, productId: null }, productId],
      ['productId a number', { ...body, productId: 42 }, productId],
      ['productId a filter object', { ...body, productId: { not: '' } }, productId],
      ['no warehouseId', without('warehouseId'), warehouseId],
      ['warehouseId an array', { ...body, warehouseId: [ID.warehouse] }, warehouseId],
      ['warehouseId a filter object', { ...body, warehouseId: { not: '' } }, warehouseId],
      ['quantity a fraction', { ...body, quantity: 1.5 }, whole('quantity')],
      ['quantity negative', { ...body, quantity: -5 }, whole('quantity')],
      ['quantity a word', { ...body, quantity: 'abc' }, whole('quantity')],
      ['quantity a fraction as text', { ...body, quantity: '1.5' }, whole('quantity')],
      ['quantity an object', { ...body, quantity: {} }, whole('quantity')],
      ['quantity above the largest stored whole number', { ...body, quantity: 2_147_483_648 }, whole('quantity')],
      ['reserved negative', { ...body, reserved: -1 }, whole('reserved')],
      ['reorderAt a fraction', { ...body, reorderAt: 2.5 }, whole('reorderAt')],
      ['costPerUnit a word', { ...body, costPerUnit: 'x' }, '400: Inventory costPerUnit must be a number of 0 or more'],
      ['costPerUnit negative', { ...body, costPerUnit: -1 }, '400: Inventory costPerUnit must be a number of 0 or more'],
      ['currency a number', { ...body, currency: 42 }, '400: Inventory currency must be a non-empty string'],
    ];
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const ownRow = async () => {
      const a = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
      return [a.businessId, a.quantity, a.reserved, a.reorderAt, a.costPerUnit, a.currency];
    };
    let before: unknown;
    let after: unknown;
    try {
      await resetBusinessStock();
      before = await ownRow();
      for (const [name, sent, answer] of probes) {
        await resetBusinessStock();
        outcomes[name] = await answerAndWrites(() => upsertAnswer(upsertByRoute(ID.biz, sent)));
        expected[name] = { answer, stockRowsWritten: 0, movementsWritten: 0 };
      }
      after = await ownRow();
    } finally {
      await resetBusinessStock();
    }
    // At fb00af1c a missing or filter-object id, a quantity as a word or an object, and a costPerUnit word answered 500
    // (PrismaClientValidationError), and a fraction or a negative quantity was stored.
    expect(outcomes).toEqual(expected);
    expect(after, "this business's row (A) as it was, reorderAt and currency too").toEqual(before);
  });

  it("RC-23 (W11-INV-UPSERT-SCOPE; D-137 planted rows left for an operator) on the business's own rows: an existing pair updates only the fields sent (quantity '7' from the web form stored as 7, reorderAt and cost kept, the row returned with its product and warehouse), a new own pair is created for the business, and a pair a planted row holds is refused with 409 naming no id, writing nothing", async () => {
    const outcomes: Record<string, unknown> = {};
    let returned: any;
    let updated: unknown;
    let created: unknown;
    let planted: unknown;
    const seeded = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    try {
      await resetBusinessStock();
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { reorderAt: 4, costPerUnit: 3 } });
      outcomes['own existing pair, quantity as the web form sends it'] = await answerAndWrites(() =>
        upsertAnswer(
          upsertByRoute(ID.biz, { productId: ID.productA, warehouseId: ID.warehouse, quantity: '7', reserved: '' }).then((row: any) => (returned = row)),
        ),
      );
      const a = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
      updated = [a.businessId, a.quantity, a.reserved, a.reorderAt, a.costPerUnit, a.currency];

      outcomes['own new pair'] = await answerAndWrites(() =>
        upsertAnswer(upsertByRoute(ID.biz, { productId: ID.productU, warehouseId: ID.warehouse2, quantity: 3, costPerUnit: '2.5', reorderAt: '1' })),
      );
      const rows = await db.inventoryStock.findMany({ where: { productId: ID.productU, warehouseId: ID.warehouse2 } });
      created = rows.map((r: any) => [r.businessId, r.quantity, r.reserved, r.reorderAt, r.costPerUnit, r.currency]);

      await plantRows([[ID.plantedXB2InB, ID.productXB2, ID.warehouseB]]);
      outcomes["B's own pair, held by a planted row of this business"] = await answerAndWrites(() =>
        upsertAnswer(upsertByRoute(ID.bizB, { productId: ID.productXB2, warehouseId: ID.warehouseB, quantity: 3 })),
      );
      const p = await db.inventoryStock.findUnique({ where: { id: ID.plantedXB2InB } });
      planted = [p.businessId, p.quantity, p.reserved, p.costPerUnit];
    } finally {
      await removeRows([ID.plantedXB2InB]);
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { reorderAt: seeded.reorderAt, costPerUnit: seeded.costPerUnit, currency: seeded.currency } });
      await resetBusinessStock();
    }
    // At fb00af1c the first answered 500 (quantity '7' and reserved '' reached Prisma as text) and the third rewrote the
    // planted row (read by its pair alone) and answered success.
    expect(outcomes).toEqual({
      'own existing pair, quantity as the web form sends it': { answer: 'committed', stockRowsWritten: 1, movementsWritten: 0 },
      'own new pair': { answer: 'committed', stockRowsWritten: 1, movementsWritten: 0 },
      "B's own pair, held by a planted row of this business": {
        answer: '409: A stock row for this product and warehouse is held by another record; ask an operator to repair it',
        stockRowsWritten: 0,
        movementsWritten: 0,
      },
    });
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
    expect(updated, 'quantity 7; reserved, reorderAt, cost and currency kept').toEqual([ID.biz, 7, 0, 4, 3, 'TTD']);
    expect([returned?.id, returned?.product?.id, returned?.warehouse?.id], 'the row returned with its product and warehouse').toEqual([
      ID.stockA,
      ID.productA,
      ID.warehouse,
    ]);
    expect(created, 'one row, of this business').toEqual([[ID.biz, 3, 0, 1, 2.5, 'TTD']]);
    expect(planted, 'the planted row untouched').toEqual([ID.biz, IN_STOCK, 0, 5]);
  });

  it.todo(
    'Z5SEC-2 follow-up (not this packet): an operator census and repair of inventory_stocks rows whose business_id is not the business of their product or warehouse (planted by the old cross-business purchase order receipt); production code refuses around them and never deletes or rewrites them',
  );
  it.todo(
    'Z4RV-SEC-1 follow-up (not this packet): POST .../purchase-orders (MarketplaceService.createPurchaseOrder, body: any) stores lines naming another business\'s product or warehouse as sent; they are refused only when the purchase order is received (RC-10)',
  );
});
