/**
 * W11-SHIPPING-EXPENSE-ONCE (owner ruling D-126; finding F-24, money, pre-existing): an order's shipping fee is booked
 * once per order, as a PAID shipping Expense, by the first "shipped" made by a member with revenue write on any order
 * route; a ship by any other member books nothing. On a real database.
 *
 * At fb00af1c CommerceIntegrationService.handleOrderShipped booked order.shippingFee as a PAID Expense (Dr expense /
 * Cr cash, posted to the ledger by ExpensesService.createExpense) on every store_order.shipped, and store_order.shipped
 * is emitted after every PATCH .../orders/:id/status 'shipped' (no transition check), after the fulfil 'ship' and after
 * the storefront PATCH SHIPPED, all open to every member (AuthGuard and BusinessGuard only). A STAFF member with
 * revenue 'none' PATCHed 'shipped' 3 times and the business had 3 PAID Expenses of 15 and 3 ledger postings.
 *
 *   SE-01 a revenue:none STAFF member PATCHes 'shipped' 3 times and runs fulfil route -> process -> ship on another
 *         order: no shipping Expense and no Expense posting; store_order.shipped is still emitted for each.
 *   SE-02 the owner PATCHes 'shipped' 3 times, then picking_packing and 'shipped' again: exactly one PAID Expense of the
 *         stored shippingFee and one posting.
 *   SE-03 two owner PATCH 'shipped' at once: one Expense.
 *   SE-04 the owner runs fulfil route -> process -> ship: one Expense.
 *   SE-05 the storefront PATCH /site SHIPPED by the owner books one; by the STAFF member none.
 *   SE-06 an order that already has a shipping Expense (notes order:<id>, tag shipping; booked before D-126) shipped
 *         by the owner: no new Expense, and the claim records the Expense found.
 *   SE-07 createExpense throws once: the status change still answers (200), the claim is released, and the next owner
 *         ship books one.
 *
 * The harness is test/marketplace-routing-concurrency.integration.test.ts's (a real Nest testing module over the
 * shared database, real guards' rule in the services, the routes' handlers called as the controllers call them), with
 * the real CommerceIntegrationService and ExpensesService (and its ledger posting); TimelineService and CrmService are
 * stubbed. Fixtures carry the v97f_ prefix and are hard-deleted by raw SQL before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v97f_';

const ID = {
  owner: `${P}owner`,
  /** A STAFF member whose explicit scope map gives revenue 'none' (operations write: the fulfilment routes are open). */
  staff: `${P}staff`,
  biz: `${P}biz`,
  contact: `${P}contact`,
};
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const SHIPPING_FEE = 15;
const SUBTOTAL = 100;

let db: any;
let app: any;
let events: any;
let market: any;
let storeOrders: any;
let expensesService: any;
/** MarketplaceController and SiteController, as their routes call the services (identity from req.user). */
let marketController: any;
let siteController: any;

/** store_order.* events in emit order. */
let seen: Array<{ name: string; payload: any }> = [];
/** Listener work started by an emit (CommerceIntegrationService.handle*), awaited by settle(). */
const inflight: Promise<unknown>[] = [];
let orderSeq = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const signedIn = (userId: string) => ({ user: { id: userId } });

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM shipments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
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
      // The listener and the books under test: real.
      CommerceIntegrationService,
      ExpensesService,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  events = app.get(EventEmitter2);
  market = app.get(MarketplaceService);
  storeOrders = app.get(StoreOrderService);
  expensesService = app.get(ExpensesService);
  const prismaService = app.get(PrismaService);
  marketController = new (MarketplaceController as any)(market, app.get(CommerceIntegrationService), prismaService);
  siteController = new (SiteController as any)({}, storeOrders, {}, {}, {}, {}, {}, {}, {});

  // Await the work an emit starts: the bus calls instance[method] at emit time.
  const integration = app.get(CommerceIntegrationService) as Record<string, any>;
  for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(integration))) {
    if (!name.startsWith('handle') || typeof integration[name] !== 'function') continue;
    const original = integration[name].bind(integration);
    integration[name] = (...args: unknown[]) => {
      const work = original(...args);
      inflight.push(Promise.resolve(work));
      return work;
    };
  }
  events.onAny((name: string | string[], payload: any) => {
    const n = Array.isArray(name) ? name.join('.') : String(name);
    if (n.startsWith('store_order.')) seen.push({ name: n, payload });
  });

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V97F Shipping', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.membership.create({ data: { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({
    data: {
      id: `${ID.staff}_m`,
      userId: ID.staff,
      businessId: ID.biz,
      role: 'STAFF',
      permissionScopes: { revenue: 'none', operations: 'write', crm: 'read' },
    },
  });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({
    data: { id: ID.contact, businessId: ID.biz, firstName: 'Vee', lastName: 'Shipper', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
}, 60_000);

afterAll(async () => {
  await settle();
  await cleanup();
  await app?.close();
});

beforeEach(async () => {
  await settle();
  seen = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Await listener work started by emits, until nothing new has started for a few quiet windows. */
async function settle() {
  for (let quiet = 0; quiet < 3; ) {
    const busy = inflight.length > 0;
    while (inflight.length > 0) await inflight.shift()!.catch(() => undefined);
    await sleep(50);
    quiet = busy || inflight.length > 0 ? 0 : quiet + 1;
  }
}

/** An order of the business, stored paid / PAID (a STANDARD order) or CONFIRMED / PAID (a STOREFRONT one). */
async function order(type: 'STANDARD' | 'STOREFRONT' = 'STANDARD') {
  orderSeq += 1;
  const status = type === 'STOREFRONT' ? 'CONFIRMED' : 'paid';
  return db.marketplaceOrder.create({
    data: {
      businessId: ID.biz,
      orderNumber: `${P}ord_${orderSeq}_${Date.now()}`,
      type,
      status,
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      customerName: 'Vee Shipper',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: SUBTOTAL,
      shippingFee: SHIPPING_FEE,
      total: SUBTOTAL + SHIPPING_FEE,
      currency: 'TTD',
      metadata: { statusTimeline: [{ status, timestamp: '2026-11-12T10:00:00.000Z', note: 'Order placed' }] },
    },
  });
}

/** The order's shipping Expenses (notes order:<id>, tag shipping), as getOrderCrossLinks reads them. */
const shippingExpenses = (orderId: string) =>
  db.expense.findMany({
    where: { businessId: ID.biz, deletedAt: null, notes: `order:${orderId}`, tags: { has: 'shipping' } },
    orderBy: { createdAt: 'asc' },
  });
/** Every Expense posting of the business (Dr expense / Cr cash). */
const expensePostings = () => db.financialTransaction.count({ where: { businessId: ID.biz, sourceType: 'Expense' } });
const postingsOf = (expenseIds: string[]) =>
  db.financialTransaction.count({ where: { businessId: ID.biz, sourceType: 'Expense', sourceId: { in: expenseIds } } });
const shippedEvents = (orderId: string) => seen.filter((e) => e.name === 'store_order.shipped' && e.payload?.order?.id === orderId).length;
const claimOf = async (orderId: string) => ((await db.marketplaceOrder.findUnique({ where: { id: orderId } })).metadata as any)?.shippingExpense;
const statusOf = async (orderId: string) => (await db.marketplaceOrder.findUnique({ where: { id: orderId } })).status;

const patchStatus = (orderId: string, status: string, actor: string) =>
  marketController.updateOrderStatus(ID.biz, orderId, { status }, signedIn(actor));
const fulfil = (orderId: string, action: string, actor: string, extra: Record<string, unknown> = {}) =>
  marketController.fulfillOrder(ID.biz, orderId, { action, ...extra }, signedIn(actor));
/** PATCH /site/businesses/:businessId/orders/:orderId/status as SiteController calls it (req.user from the guard). */
const sitePatch = (orderId: string, status: string, actor: string) =>
  (siteController as any).updateOrderStatus(ID.biz, orderId, { status }, signedIn(actor));

describe('W11-SHIPPING-EXPENSE-ONCE (D-126, F-24): the shipping fee is booked once per order, by a member with revenue write', () => {
  it('SE-01 (D-126) a revenue:none STAFF member PATCHing shipped 3 times and running fulfil route, process, ship books no shipping Expense and no Expense posting, and store_order.shipped is still emitted', async () => {
    const patched = await order();
    const fulfilled = await order();
    const postingsBefore = await expensePostings();

    // At fb00af1c: 3 PAID Expenses of 15 (and 3 postings) for the PATCHed order, 1 for the fulfilled one.
    for (let i = 0; i < 3; i += 1) {
      const res = await patchStatus(patched.id, 'shipped', ID.staff);
      expect(res.status, `PATCH ${i + 1}`).toBe('shipped');
    }
    for (const action of ['route', 'process', 'ship']) {
      await fulfil(fulfilled.id, action, ID.staff);
    }
    expect(await statusOf(fulfilled.id)).toBe('shipped');
    await settle();

    expect((await shippingExpenses(patched.id)).length, 'PATCHed order: no shipping Expense').toBe(0);
    expect((await shippingExpenses(fulfilled.id)).length, 'fulfilled order: no shipping Expense').toBe(0);
    expect((await expensePostings()) - postingsBefore, 'no Expense posting').toBe(0);
    expect(await claimOf(patched.id), 'nothing claimed').toBeUndefined();
    // MUST NOT CHANGE: the status change stays open and announced (repeated announcements are out of scope).
    expect({ patched: shippedEvents(patched.id), fulfilled: shippedEvents(fulfilled.id) }, 'store_order.shipped still emitted').toEqual({
      patched: 3,
      fulfilled: 1,
    });
  });

  it('SE-02 (D-126) the owner PATCHing shipped 3 times, then picking_packing and shipped again, books exactly one PAID Expense of the stored shippingFee and one posting', async () => {
    const o = await order();
    const postingsBefore = await expensePostings();

    for (let i = 0; i < 3; i += 1) await patchStatus(o.id, 'shipped', ID.owner);
    await patchStatus(o.id, 'picking_packing', ID.owner);
    await patchStatus(o.id, 'shipped', ID.owner);
    await settle();

    // At fb00af1c: 4 Expenses and 4 postings.
    const booked = await shippingExpenses(o.id);
    expect(booked.map((e: any) => `${e.status} ${Number(e.amount)} ${e.currency}`), 'one PAID Expense of the shipping fee').toEqual([
      `PAID ${SHIPPING_FEE} TTD`,
    ]);
    expect(booked[0].tags).toEqual(['shipping', 'order-expense']);
    expect(await postingsOf(booked.map((e: any) => e.id)), 'one posting').toBe(1);
    expect((await expensePostings()) - postingsBefore, 'no other Expense posting').toBe(1);
    expect((await claimOf(o.id))?.expenseId, 'the claim names the Expense').toBe(booked[0].id);
    expect(shippedEvents(o.id), 'store_order.shipped on each shipped PATCH (unchanged)').toBe(4);
  });

  it('SE-03 (D-126) two owner PATCH shipped calls at once book one Expense', async () => {
    const o = await order();
    const answered = await Promise.all([patchStatus(o.id, 'shipped', ID.owner), patchStatus(o.id, 'shipped', ID.owner)]);
    expect(answered.map((r: any) => r.status)).toEqual(['shipped', 'shipped']);
    await settle();

    // At fb00af1c: 2.
    const booked = await shippingExpenses(o.id);
    expect(booked.length, 'one Expense').toBe(1);
    expect(await postingsOf(booked.map((e: any) => e.id))).toBe(1);
  });

  it('SE-04 (D-126) the owner running fulfil route, process, ship books one Expense', async () => {
    const o = await order();
    for (const action of ['route', 'process', 'ship']) await fulfil(o.id, action, ID.owner);
    expect(await statusOf(o.id)).toBe('shipped');
    await settle();

    const booked = await shippingExpenses(o.id);
    expect(booked.map((e: any) => `${e.status} ${Number(e.amount)}`)).toEqual([`PAID ${SHIPPING_FEE}`]);
    expect(await postingsOf(booked.map((e: any) => e.id))).toBe(1);
    expect(shippedEvents(o.id)).toBe(1);
  });

  it('SE-05 (D-126) the storefront PATCH /site SHIPPED by the owner books one Expense; by the revenue:none STAFF member, none', async () => {
    const byOwner = await order('STOREFRONT');
    const byStaff = await order('STOREFRONT');

    const ownerRes = await sitePatch(byOwner.id, 'SHIPPED', ID.owner);
    const staffRes = await sitePatch(byStaff.id, 'SHIPPED', ID.staff);
    expect([ownerRes.status, staffRes.status]).toEqual(['SHIPPED', 'SHIPPED']);
    // A second SHIPPED by the owner books nothing more.
    await sitePatch(byOwner.id, 'SHIPPED', ID.owner);
    await settle();

    expect((await shippingExpenses(byOwner.id)).map((e: any) => `${e.status} ${Number(e.amount)}`), 'owner: one').toEqual([`PAID ${SHIPPING_FEE}`]);
    // At fb00af1c: 1 for the STAFF member's SHIPPED.
    expect((await shippingExpenses(byStaff.id)).length, 'STAFF: none').toBe(0);
    expect({ owner: shippedEvents(byOwner.id), staff: shippedEvents(byStaff.id) }, 'store_order.shipped still emitted').toEqual({ owner: 2, staff: 1 });
  });

  it('SE-06 (D-126) an order that already has a shipping Expense (notes order:<id>, tag shipping) shipped by the owner books no new Expense, and the claim records the Expense found', async () => {
    const o = await order();
    const legacy = await db.expense.create({
      data: {
        businessId: ID.biz,
        description: `Shipping cost for order ${o.orderNumber}`,
        amount: SHIPPING_FEE,
        currency: 'TTD',
        date: new Date(),
        vendor: 'Shipping Carrier',
        tags: ['shipping', 'order-expense'],
        notes: `order:${o.id}`,
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    const postingsBefore = await expensePostings();

    await patchStatus(o.id, 'shipped', ID.owner);
    await patchStatus(o.id, 'shipped', ID.owner);
    await settle();

    // At fb00af1c: 2 more.
    expect((await shippingExpenses(o.id)).map((e: any) => e.id), 'only the Expense booked before').toEqual([legacy.id]);
    expect((await expensePostings()) - postingsBefore, 'no posting').toBe(0);
    expect((await claimOf(o.id))?.expenseId, 'the claim records it').toBe(legacy.id);
  });

  it('SE-07 (D-126) when createExpense throws once, the status change still answers, the claim is released, and the next owner ship books one Expense', async () => {
    const o = await order();
    const failure = vi.spyOn(expensesService, 'createExpense').mockRejectedValueOnce(new Error('v97f simulated expense failure'));

    const first = await patchStatus(o.id, 'shipped', ID.owner);
    expect(first.status, 'answered 200 with the order shipped').toBe('shipped');
    await settle();
    expect(failure).toHaveBeenCalledTimes(1);
    expect((await shippingExpenses(o.id)).length, 'nothing booked').toBe(0);
    expect(await claimOf(o.id), 'the claim is released').toBeUndefined();

    await patchStatus(o.id, 'shipped', ID.owner);
    await settle();
    const booked = await shippingExpenses(o.id);
    expect(booked.map((e: any) => `${e.status} ${Number(e.amount)}`), 'the next ship books one').toEqual([`PAID ${SHIPPING_FEE}`]);
    expect(await postingsOf(booked.map((e: any) => e.id))).toBe(1);
    expect((await claimOf(o.id))?.expenseId).toBe(booked[0].id);
  });
});
