/**
 * V1-18-PUB-STOREFRONT-PAID-EVENT (M37, CF-45, F206) — storefront paid-event
 * integrity on a REAL database, with the REAL event bus, the REAL marketplace
 * listener, the REAL invoice workflow and the REAL ledger posting.
 *
 * At the V1 base two defects fabricated paid invoices once the storefront was
 * used:
 *
 *   CF-45  updateOrderStatus mapped CONFIRMED to `store_order.paid`
 *          (store-order.service.ts:360). The merchant's Confirm button on an
 *          UNPAID order told every paid listener that money had arrived.
 *   F206   CommerceIntegrationService.createRevenueRecord (the marketplace
 *          listener on `store_order.paid`, commerce-integration.service.ts:
 *          159-245) deduplicated on `notes contains order:<id>`. The invoice
 *          completeCheckout writes is INV-<orderNumber> with the notes
 *          "Storefront order <orderNumber>", so the listener never saw it and
 *          wrote a second, raw PAID invoice INV-ORD-<orderNumber>: no payment,
 *          no posting, the order's revenue twice on the books. It ignored the
 *          invoiceId the paid event carries.
 *
 * Contract pinned here (each case its own order, all in one CASH-basis TTD
 * business):
 *
 *   V18-01  CONFIRMED on an UNPAID order emits `store_order.confirmed` only:
 *           no invoice for the order, no payment, no FinancialTransaction, the
 *           order stays UNPAID
 *   V18-02  completeCheckout yields ONE invoice (INV-<orderNumber>, PAID), ONE
 *           SUCCESSFUL payment of the order total and ONE
 *           Payment:<id>:payment_recorded posting; debits equal credits, the
 *           ledger cash net equals the balance read contract's net (the order
 *           total) and the tenant's trial balance balances
 *   V18-03  the paid event replayed (twice, with its invoiceId) creates no
 *           second invoice, payment or posting: the listener resolves
 *           payload.invoiceId
 *   V18-04  a paid event without an invoiceId (the legacy payload shape) for a
 *           checked-out order creates no second invoice
 *   V18-05  a paid event for an UNPAID storefront order (what CONFIRMED emitted
 *           at the base; a queued or forged one) creates no invoice, no payment
 *           and no posting, and tells nobody the order was paid: no
 *           "payment received" notification, no store_order.paid timeline
 *           event (assertion added with the fix; red on the base source too)
 *   V18-06  Confirm after checkout (the merchant's button on a paid order)
 *           emits `store_order.confirmed` and leaves one invoice, one payment
 *           and one posting
 *
 * Nothing on the money path is mocked: PrismaService, StoreOrderService
 * (createOrder's server-side pricing, completeCheckout's transaction),
 * InvoiceWorkflowService, RevenueAttributionService, RevenuePostingService,
 * ExpensePostingService, PostingService, ChartOfAccountsSeederService and the
 * listener under test, CommerceIntegrationService, write real rows. The event
 * bus is the production EventEmitterModule (wildcard, '.' delimiter), so the
 * listener runs because the event fired, not because the test called it. The
 * stand-ins are off the money path: CrmService (resolves the seeded contact by
 * email; logs nothing), PublicEventsService, PromoCodeService,
 * InventoryRiskService, ExpensesService, TransactionalEmailService and the
 * revenue-posting timeline. Listener handlers are wrapped (same instance, same
 * method) only so a case can await the work an un-awaited emit started.
 *
 * Fixtures: prefix `v18a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v18a_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  product: `${P}product`,
};
const CUSTOMER_EMAIL = `${P}customer@test.local`;
const UNIT_PRICE = 40;
const QUANTITY = 2;
const ORDER_TOTAL = UNIT_PRICE * QUANTITY;
const DEPOSIT_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);

let db: any;
let app: any;
let events: any;
let storeOrders: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

/** store_order.* events in emit order, with their payloads. */
let seen: Array<{ name: string; payload: any }> = [];
/** Listener work started by an emit, awaited by settle(). */
const inflight: Promise<unknown>[] = [];
/** Contact timeline events the listener asked CrmService to log. */
const contactEvents: Array<{ type: string; orderId?: string }> = [];

async function settle() {
  while (inflight.length > 0) {
    await inflight.shift()!.catch(() => undefined);
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
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** A storefront order placed through the public checkout path (server-side pricing). */
async function placeOrder(paymentMethod = 'CARD') {
  const order = await storeOrders.createOrder({
    businessId: ID.biz,
    cartItems: [{ productId: ID.product, quantity: QUANTITY }],
    customerInfo: { name: 'Vee Eighteen', email: CUSTOMER_EMAIL },
    paymentMethod,
  });
  await settle();
  return order;
}

/** Every invoice this order has: completeCheckout's INV-<n> and the listener's INV-ORD-<n> both carry the order number. */
async function invoicesOf(order: { orderNumber: string }): Promise<any[]> {
  return db.invoice.findMany({
    where: { businessId: ID.biz, invoiceNumber: { contains: order.orderNumber } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function paymentsOf(invoiceIds: string[]): Promise<any[]> {
  return db.payment.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** Every FinancialTransaction sourced by one of these invoices or payments, with entries. */
async function postingsOf(sourceIds: string[]): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceId: { in: sourceIds } },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

async function counts() {
  const [invoices, payments, postings] = await Promise.all([
    db.invoice.count({ where: { businessId: ID.biz } }),
    db.payment.count({ where: { businessId: ID.biz } }),
    db.financialTransaction.count({ where: { businessId: ID.biz } }),
  ]);
  return { invoices, payments, postings };
}

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

/**
 * The paid order's books: one PAID invoice INV-<orderNumber> for the order
 * total, one SUCCESSFUL payment of that total on it, one balanced
 * Payment:<id>:payment_recorded posting and nothing else sourced by the
 * order's invoices or payments; ledger cash net = balance net = total; the
 * tenant's trial balance balances.
 */
async function expectOnePaidInvoice(order: { orderNumber: string }) {
  const invoices = await invoicesOf(order);
  expect(invoices.map((i) => `${i.invoiceNumber}:${i.status}`), 'invoices of the order').toEqual([`INV-${order.orderNumber}:PAID`]);
  const [invoice] = invoices;
  expect(Number(invoice.total)).toBe(ORDER_TOTAL);

  const payments = await paymentsOf([invoice.id]);
  expect(payments.map((p) => `${p.status}:${Number(p.amount)}`), 'payments of the order').toEqual([`SUCCESSFUL:${ORDER_TOTAL}`]);
  const [payment] = payments;

  const postings = await postingsOf([invoice.id, payment.id]);
  expect(postings.map((t) => `${t.externalRef}:${t.status}`), 'postings of the order').toEqual([
    `Payment:${payment.id}:payment_recorded:POSTED`,
  ]);
  const [posting] = postings;
  expect(money(sum(posting.entries, 'debit')), 'debits = credits').toBe(money(sum(posting.entries, 'credit')));
  expect(money(sum(posting.entries, 'debit'))).toBe(ORDER_TOTAL);

  const cashNet = money(
    posting.entries
      .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
      .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
  );
  const balance = storedBalanceFn(Number(invoice.total), payments.map((p) => ({ amount: Number(p.amount), status: p.status })), invoice.currency);
  expect(cashNet, 'ledger cash net = balance net').toBe(balance.net);
  expect(balance.net).toBe(ORDER_TOTAL);

  const totals = await db.ledgerEntry.aggregate({ where: { businessId: ID.biz }, _sum: { debit: true, credit: true } });
  expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance').toBe(money(Number(totals._sum.credit ?? 0)));
  return { invoice, payment, posting };
}

function storeEvents(): string[] {
  return seen.map((e) => e.name);
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
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

  const crmStub = {
    findOrCreateContact: async (businessId: string, input: { email?: string | null }) =>
      input?.email
        ? db.contact.findFirst({ where: { businessId, emailNormalized: input.email.toLowerCase() }, select: { id: true } })
        : null,
    logContactEvent: async (input: { type: string; data?: { orderId?: string } }) => {
      contactEvents.push({ type: input.type, orderId: input.data?.orderId });
      return null;
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    providers: [
      PrismaService,
      StoreOrderService,
      CommerceIntegrationService,
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
      { provide: ExpensesService, useValue: { createExpense: async () => null } },
      { provide: TransactionalEmailService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  events = app.get(EventEmitter2);
  storeOrders = app.get(StoreOrderService);

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
  await db.business.create({ data: { id: ID.biz, name: 'V18A Storefront', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.membership.create({ data: { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({
    data: { id: ID.contact, businessId: ID.biz, firstName: 'Vee', lastName: 'Eighteen', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
  await db.product.create({
    data: { id: ID.product, businessId: ID.biz, name: 'V18A Widget', price: UNIT_PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true },
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

describe('V1-18 storefront paid-event integrity (real database, real event bus)', () => {
  it('V18-01 CONFIRMED on an UNPAID order emits store_order.confirmed only: no invoice, payment or posting', async () => {
    const order = await placeOrder();
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.type).toBe('STOREFRONT');
    const before = await counts();
    seen = [];

    await storeOrders.updateOrderStatus(order.id, 'CONFIRMED', ID.biz);
    await settle();

    expect(storeEvents()).toEqual(['store_order.confirmed']);
    expect(await invoicesOf(order), 'no invoice for an unpaid order').toEqual([]);
    expect(await counts(), 'no invoice, payment or FinancialTransaction written').toEqual(before);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.paymentStatus).toBe('UNPAID');
  });

  it('V18-02 completeCheckout: one PAID invoice, one SUCCESSFUL payment, one balanced payment_recorded posting', async () => {
    const order = await placeOrder();
    seen = [];

    const paid = await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_02`, provider: 'stripe', method: 'card' });
    await settle();

    expect(paid.paymentStatus).toBe('PAID');
    expect(storeEvents()).toEqual(['store_order.paid']);
    const { invoice } = await expectOnePaidInvoice(order);
    expect(seen[0].payload.invoiceId).toBe(invoice.id);
  });

  it('V18-03 the paid event replayed with its invoiceId creates no second invoice, payment or posting', async () => {
    const order = await placeOrder();
    seen = [];
    await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_03`, provider: 'stripe', method: 'card' });
    await settle();
    const [paidEvent] = seen.filter((e) => e.name === 'store_order.paid');
    expect(paidEvent?.payload?.invoiceId).toBeTruthy();
    const before = await counts();

    await events.emitAsync('store_order.paid', paidEvent.payload);
    await events.emitAsync('store_order.paid', paidEvent.payload);
    await settle();

    const { invoice } = await expectOnePaidInvoice(order);
    expect(paidEvent.payload.invoiceId).toBe(invoice.id);
    expect(await counts()).toEqual(before);
  });

  it('V18-04 a paid event without an invoiceId (legacy shape) for a checked-out order creates no second invoice', async () => {
    const order = await placeOrder();
    const paid = await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_04`, provider: 'stripe', method: 'card' });
    await settle();
    const before = await counts();

    await events.emitAsync('store_order.paid', { order: paid, businessId: ID.biz });
    await settle();

    await expectOnePaidInvoice(order);
    expect(await counts()).toEqual(before);
  });

  it('V18-05 a paid event for an UNPAID storefront order creates no invoice, payment or posting', async () => {
    const order = await placeOrder();
    const confirmed = await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: 'CONFIRMED' }, include: { items: true } });
    expect(confirmed.paymentStatus).toBe('UNPAID');
    const before = await counts();

    // What updateOrderStatus(CONFIRMED) emitted at the base; a queued or forged copy.
    await events.emitAsync('store_order.paid', { order: confirmed, businessId: ID.biz });
    await settle();

    expect(await invoicesOf(order), 'no invoice for an unpaid order').toEqual([]);
    expect(await counts(), 'no invoice, payment or FinancialTransaction written').toEqual(before);
    const notified = await db.notification.findMany({ where: { businessId: ID.biz, type: 'store_order.paid' } });
    expect(notified.filter((n: any) => n.data?.orderId === order.id), 'no "payment received" notification').toEqual([]);
    expect(contactEvents.filter((e) => e.orderId === order.id && e.type === 'store_order.paid'), 'no paid timeline event').toEqual([]);
  });

  it('V18-06 Confirm after checkout emits store_order.confirmed and leaves one invoice, payment and posting', async () => {
    const order = await placeOrder();
    await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_06`, provider: 'stripe', method: 'card' });
    await settle();
    const before = await counts();
    seen = [];

    await storeOrders.updateOrderStatus(order.id, 'CONFIRMED', ID.biz);
    await settle();

    expect(storeEvents()).toEqual(['store_order.confirmed']);
    await expectOnePaidInvoice(order);
    expect(await counts()).toEqual(before);
  });
});
