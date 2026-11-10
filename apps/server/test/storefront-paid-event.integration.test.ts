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
 * Review repairs (SEC-V18-1, SEC-V18-2 / CR-V18-2, CR-V18-1):
 *
 *   V18-07  a paid event that names another business (B) for an order of
 *           business A writes nothing into B: no invoice, no "payment
 *           received" notification, no paid timeline event, for a STANDARD
 *           (marketplace) PAID order and for a checked-out storefront order.
 *           Control: the same STANDARD event in A is acted on. At the base B
 *           got an invoice, a notification and a timeline event; red when the
 *           listener's stored-order read loses its businessId
 *   V18-08  a storefront order set PAID outside completeCheckout (what the
 *           marketplace fulfillOrder 'mark_paid' and PATCH .../status
 *           {status:'paid'} do) has no invoice and no payment: its paid event
 *           writes no invoice and tells nobody it was paid (no notification,
 *           no paid timeline event), also when the event names another order's
 *           checkout invoice. The marketplace routes themselves refuse it
 *           since the trial-N review (V18-10)
 *   V18-09  the order cross-links reader finds completeCheckout's invoice
 *           (INV-<orderNumber>, no notes marker) as the order's revenue
 *
 * Trial-N integration review (G6PUB-SEC-3, NEW-2, G6ML-1, G6ML-3):
 *
 *   V18-10  the marketplace routes (fulfil mark_paid, PATCH .../status with
 *           status paid or paymentStatus PAID) refuse a STOREFRONT order with
 *           400: it is paid only through completeCheckout (a provider
 *           settlement or the offline completion). Nothing is written and no
 *           store_order.paid is emitted. Controls: a fulfilment status still
 *           moves, and a STANDARD order is still marked paid there
 *   V18-11  a provider settlement through updatePaymentStatus names its
 *           provider, so the payment is that provider's and its deposit leg is
 *           PAYMENT_PROCESSOR (it was unknown:unknown, posted to CASH)
 *
 * Trial-N repair round 2 (recheck G6RC-2, G6RC-3):
 *
 *   V18-12  PATCH .../orders/:id/status writes no payment field
 *           (paymentStatus, paymentMethod, paymentRef) of a STOREFRONT order,
 *           in any direction: a settled order cannot be set back to UNPAID.
 *           Its payment fields are written only by completeCheckout (a
 *           provider settlement, or the offline completion with revenue
 *           write). Controls: the status alone still moves; a STANDARD
 *           order's payment fields are still written
 *   V18-13  POST /marketplace/businesses/:id/orders decides the type itself
 *           (STANDARD): a body type STOREFRONT creates no STOREFRONT order
 *
 * Trial-N repair round 2, recheck (G6PUB-RC1-3, D-14):
 *
 *   V18-14  refunding a checked-out storefront order (StoreOrderService.
 *           refundOrder, the site refund route) is a D-14 refund on its
 *           invoice: one negative REFUNDED row of the order total linked to the
 *           payment and naming the refunder, the SUCCESSFUL original kept, the
 *           payment_recorded posting reversed (deposit net 0, trial balance
 *           balanced), the invoice back to SENT with paidAt cleared, the order
 *           REFUNDED; one store_order.refunded, and no Expense (the listener
 *           booked the order total as an Expense, beside a PAID invoice and a
 *           SUCCESSFUL payment). A second refund is refused and writes nothing
 *   V18-15  an order nothing was paid on is not refunded (409): no event, no
 *           Expense, nothing written (the listener booked the total as an
 *           Expense for an UNPAID order)
 *
 * W9-STORE-PAID-LISTENERS (FOLLOW10; D-18, SEC-V18-3), the former it.todo cases:
 *
 *   V18-T2  the store_order.paid listeners that did not read the stored payment
 *           status (WebhookDispatcherService: the outbound webhook;
 *           RevenueEventListener: the paid timeline entry;
 *           StoreOrderRoutingListener: fulfilment routing) act only on an order
 *           stored PAID in the event's business. A STANDARD order set 'paid' by
 *           PATCH .../status without a payment (the emission still open after
 *           V18-10), an UNPAID storefront order (a queued or forged event) and an
 *           event naming another business get no webhook delivery, no paid
 *           timeline entry and no routing. Controls: a STANDARD order stored PAID
 *           and a checked-out storefront order get all three. The listeners run
 *           on their own bus in this case (so the other cases' event lists are
 *           unchanged); the payloads are the ones the real emitters put on the
 *           suite's bus
 *   V18-T3  live pin, no source change (trial-N repair round 2 satisfied it): a
 *           CASH and a MANUAL storefront order reach PAID through SiteController
 *           POST /site/businesses/:businessId/orders/:orderId/complete-offline
 *           (revenue write, the signed-in member records it) with one invoice,
 *           one payment and one posting; a second completion writes nothing; the
 *           store fulfillment panel's Complete offline action posts to that route
 *           (web spec fulfillment-panel-complete-offline FPO-01..04)
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
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v18a_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  product: `${P}product`,
  /** A second tenant whose contact has the same email (SEC-V18-1). */
  bizB: `${P}biz_b`,
  contactB: `${P}contact_b`,
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
const contactEvents: Array<{ businessId: string; type: string; orderId?: string }> = [];
/** Expenses the listener asked ExpensesService to book (store_order.refunded books one). */
const expenses: Array<{ businessId: string; amount: number; notes?: string }> = [];

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
    `DELETE FROM webhooks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  storedBalanceFn = workflowMod.balanceOfStoredRows;

  const crmStub = {
    findOrCreateContact: async (businessId: string, input: { email?: string | null }) =>
      input?.email
        ? db.contact.findFirst({ where: { businessId, emailNormalized: input.email.toLowerCase() }, select: { id: true } })
        : null,
    logContactEvent: async (input: { businessId: string; type: string; data?: { orderId?: string } }) => {
      contactEvents.push({ businessId: input.businessId, type: input.type, orderId: input.data?.orderId });
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
      {
        provide: ExpensesService,
        useValue: {
          createExpense: async (input: { businessId: string; amount: number; notes?: string }) => {
            expenses.push({ businessId: input.businessId, amount: input.amount, notes: input.notes });
            return null;
          },
        },
      },
      { provide: TransactionalEmailService, useValue: {} },
      // The marketplace order routes' service (V18-10): real, over the same rows and bus.
      MarketplaceService,
      FulfillmentRoutingService,
      // The D-14 refund door (markPaymentRefunded), real (V18-14). Its stand-ins are off the refund path.
      CommerceService,
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: {} },
      { provide: CatalogService, useValue: {} },
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
  // G6PUB-R3-STORE-ORDER-DOORS (RC2-4): the order door takes a WiPay order only for a business with a WiPay merchant
  // pair (V18-11 and V18-12 place WiPay orders), so this business has its own pair.
  await db.business.create({
    data: {
      id: ID.biz,
      name: 'V18A Storefront',
      ownerId: ID.owner,
      currency: 'TTD',
      accountingBasis: 'CASH',
      metaData: { wipayApiKey: `${P}wipay_key`, wipayAccountNumber: `${P}wipay_account` },
    },
  });
  await db.membership.create({ data: { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await app.get(ChartOfAccountsSeederService).ensureDefaults(ID.biz);
  await db.contact.create({
    data: { id: ID.contact, businessId: ID.biz, firstName: 'Vee', lastName: 'Eighteen', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
  await db.product.create({
    data: { id: ID.product, businessId: ID.biz, name: 'V18A Widget', price: UNIT_PRICE, currency: 'TTD', category: 'PRODUCT', isActive: true },
  });

  await db.business.create({ data: { id: ID.bizB, name: 'V18A Other Tenant', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.membership.create({ data: { id: `${ID.owner}_mb`, userId: ID.owner, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({
    data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Vee', lastName: 'Eighteen', email: CUSTOMER_EMAIL, emailNormalized: CUSTOMER_EMAIL },
  });
}, 60_000);

/** What one business holds about an order: its invoices, its "payment received" notifications and its paid timeline events. */
async function paidTraces(businessId: string, orderId: string) {
  const [invoices, notifications] = await Promise.all([
    db.invoice.findMany({ where: { businessId }, select: { invoiceNumber: true, notes: true } }),
    db.notification.findMany({ where: { businessId, type: 'store_order.paid' }, select: { data: true } }),
  ]);
  return {
    invoices: invoices.length,
    notifications: notifications.filter((n: any) => n.data?.orderId === orderId).length,
    timeline: contactEvents.filter((e) => e.businessId === businessId && e.orderId === orderId && e.type === 'store_order.paid').length,
  };
}

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
    // Control for V18-05/07/08: the settled order's paid event is acted on.
    expect(await paidTraces(ID.biz, order.id), 'one "payment received" notification and one paid timeline event').toMatchObject({
      notifications: 1,
      timeline: 1,
    });
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

  it('V18-07 a paid event naming another business writes nothing into it (STANDARD and storefront orders of A)', async () => {
    // A STANDARD (marketplace) order of A, already PAID: the listener's legacy
    // invoice path would write into whichever business the payload names.
    const standard = await db.marketplaceOrder.create({
      data: {
        businessId: ID.biz,
        orderNumber: `${P}std_07`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        customerName: 'Vee Eighteen',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        currency: 'TTD',
        items: { create: [{ productId: ID.product, name: 'V18A Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL }] },
      },
      include: { items: true },
    });
    const storefront = await placeOrder();
    seen = [];
    await storeOrders.completeCheckout({ orderId: storefront.id, paymentRef: `${P}ref_07`, provider: 'stripe', method: 'card' });
    await settle();
    const [paidEvent] = seen.filter((e) => e.name === 'store_order.paid');
    expect(paidEvent?.payload?.invoiceId).toBeTruthy();
    const beforeA = await counts();
    const beforeB = await paidTraces(ID.bizB, standard.id);
    expect(beforeB).toEqual({ invoices: 0, notifications: 0, timeline: 0 });

    await events.emitAsync('store_order.paid', { order: standard, businessId: ID.bizB });
    await events.emitAsync('store_order.paid', { ...paidEvent.payload, businessId: ID.bizB });
    await events.emitAsync('store_order.paid', { order: paidEvent.payload.order, businessId: ID.bizB });
    await settle();

    expect(await paidTraces(ID.bizB, standard.id), 'B: nothing for A\'s STANDARD order').toEqual({ invoices: 0, notifications: 0, timeline: 0 });
    expect(await paidTraces(ID.bizB, storefront.id), 'B: nothing for A\'s storefront order').toEqual({ invoices: 0, notifications: 0, timeline: 0 });
    expect(await counts(), 'A: nothing written either').toEqual(beforeA);
    await expectOnePaidInvoice(storefront);

    // Control: the same STANDARD event in its own business is acted on, so the
    // refusal above is the tenant check and not a dead listener.
    await events.emitAsync('store_order.paid', { order: standard, businessId: ID.biz });
    await settle();
    expect((await paidTraces(ID.biz, standard.id)).notifications, 'A is told about its own order').toBe(1);
  });

  it('V18-08 a storefront order set PAID outside completeCheckout: no invoice, and nobody is told it was paid', async () => {
    const order = await placeOrder();
    // What MarketplaceService.fulfillOrder('mark_paid') and PATCH .../orders/:id/status
    // {status:'paid', paymentStatus:'PAID'} write: PAID, with no invoice and no payment.
    const markedPaid = await db.marketplaceOrder.update({
      where: { id: order.id },
      data: { status: 'paid', paymentStatus: 'PAID' },
      include: { items: true },
    });
    const other = await placeOrder();
    seen = [];
    await storeOrders.completeCheckout({ orderId: other.id, paymentRef: `${P}ref_08`, provider: 'stripe', method: 'card' });
    await settle();
    const [otherPaid] = seen.filter((e) => e.name === 'store_order.paid');
    expect(otherPaid?.payload?.invoiceId).toBeTruthy();
    const before = await counts();

    // The marketplace emission (no invoiceId), and one naming another order's checkout invoice.
    await events.emitAsync('store_order.paid', { order: markedPaid, businessId: ID.biz });
    await events.emitAsync('store_order.paid', { order: markedPaid, businessId: ID.biz, invoiceId: otherPaid.payload.invoiceId });
    await settle();

    expect(await invoicesOf(order), 'no invoice for an order no payment settled').toEqual([]);
    expect(await counts(), 'no invoice, payment or FinancialTransaction written').toEqual(before);
    const traces = await paidTraces(ID.biz, order.id);
    expect(traces.notifications, 'no "payment received" notification').toBe(0);
    expect(traces.timeline, 'no paid timeline event').toBe(0);
    await expectOnePaidInvoice(other);
  });

  it('V18-09 the order cross-links reader reports completeCheckout\'s invoice as the order\'s revenue', async () => {
    const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
    const order = await placeOrder();
    await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_09`, provider: 'stripe', method: 'card' });
    await settle();
    const { invoice } = await expectOnePaidInvoice(order);

    const links = await app.get(CommerceIntegrationService).getOrderCrossLinks(ID.biz, order.id);

    expect(links.revenue.map((i: any) => `${i.invoiceNumber}:${i.status}:${Number(i.total)}`)).toEqual([`INV-${order.orderNumber}:PAID:${ORDER_TOTAL}`]);
    expect(links.revenue[0].id).toBe(invoice.id);
    expect(links.order.total).toBe(ORDER_TOTAL);
    expect(links.margin).toBe(ORDER_TOTAL);
  });

  it('V18-10 (V18-T1; trial-N review G6PUB-SEC-3, NEW-2, G6ML-1) the marketplace routes cannot set a STOREFRONT order paid: mark_paid and PATCH status paid / paymentStatus PAID are refused (400); nothing written, no store_order.paid', async () => {
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);
    const order = await placeOrder('CASH');
    seen = [];
    const before = await counts();

    // At 2db133a4: paid/PAID with no invoice, payment or posting, and store_order.paid emitted (offline completion then no-ops).
    await expect(market.fulfillOrder(ID.biz, order.id, 'mark_paid', {}), 'POST .../fulfill mark_paid').rejects.toThrow(/storefront order/i);
    await expect(market.updateOrderStatus(ID.biz, order.id, 'paid', { status: 'paid', paymentStatus: 'PAID' }), 'PATCH status paid + PAID').rejects.toThrow(/storefront order/i);
    await expect(market.updateOrderStatus(ID.biz, order.id, 'paid', { status: 'paid' }), 'PATCH status paid').rejects.toThrow(/storefront order/i);
    await expect(market.updateOrderStatus(ID.biz, order.id, 'CONFIRMED', { status: 'CONFIRMED', paymentStatus: 'paid' }), 'PATCH paymentStatus paid').rejects.toThrow(/storefront order/i);
    await settle();

    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`).toBe('PENDING/PENDING');
    expect(storeEvents(), 'no store_order.paid').not.toContain('store_order.paid');
    expect(await invoicesOf(order)).toEqual([]);
    expect(await counts(), 'no invoice, payment or posting').toEqual(before);

    // Controls: a fulfilment status still moves through PATCH, and a STANDARD (marketplace) order is still marked paid there.
    const moved = await market.updateOrderStatus(ID.biz, order.id, 'PROCESSING', { status: 'PROCESSING' });
    expect(`${moved.status}/${moved.paymentStatus}`).toBe('PROCESSING/PENDING');
    const standard = await db.marketplaceOrder.create({
      data: {
        businessId: ID.biz,
        orderNumber: `${P}std_10`,
        type: 'STANDARD',
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Vee Eighteen',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        currency: 'TTD',
      },
    });
    const paidStandard = await market.updateOrderStatus(ID.biz, standard.id, 'paid', { status: 'paid', paymentStatus: 'PAID' });
    await settle();
    expect(`${paidStandard.status}/${paidStandard.paymentStatus}`).toBe('paid/PAID');
  });

  it('V18-11 (trial-N review G6ML-3) a provider settlement through updatePaymentStatus names its provider: the payment is that provider\'s and its deposit leg is PAYMENT_PROCESSOR, not CASH', async () => {
    const order = await placeOrder('WIPAY');

    await storeOrders.updatePaymentStatus(order.id, 'PAID', `${P}wtx_11`, 'wipay');
    await settle();

    const { payment, posting } = await expectOnePaidInvoice(order);
    // At 2db133a4: unknown:unknown, and the money posted to CASH (till cash).
    expect(`${payment.provider}:${payment.method}:${payment.providerPaymentId}`).toBe(`wipay:wipay:${P}wtx_11`);
    const deposit = posting.entries.filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey) && Number(e.debit) > 0).map((e: any) => e.account.systemKey);
    expect(deposit).toEqual(['PAYMENT_PROCESSOR']);
  });

  it('V18-12 (trial-N recheck G6RC-2) PATCH .../orders/:id/status writes no payment field of a STOREFRONT order: paymentStatus, paymentMethod and paymentRef are refused (400) in every direction, a settled order stays PAID with its books; controls: the status alone still moves, and a STANDARD order\'s payment fields are still written', async () => {
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);
    const settled = await placeOrder('WIPAY');
    await storeOrders.updatePaymentStatus(settled.id, 'PAID', `${P}wtx_12`, 'wipay');
    await settle();
    await expectOnePaidInvoice(settled);
    const paidBefore = await db.marketplaceOrder.findUnique({ where: { id: settled.id } });
    const unpaid = await placeOrder('CASH');
    const unpaidBefore = await db.marketplaceOrder.findUnique({ where: { id: unpaid.id } });
    const before = await counts();
    seen = [];

    // At 644bb6ad: each one is written verbatim (ZZPROBE-3: the settled order reads CONFIRMED/UNPAID with its books
    // still on, so the provider paths treat it as payable again and its next settlement fails on INV-<orderNumber>).
    const attempts: Array<[string, string, Record<string, unknown>]> = [
      ['settled order set UNPAID', settled.id, { status: 'CONFIRMED', paymentStatus: 'UNPAID' }],
      ['settled order set REFUNDED', settled.id, { status: 'CONFIRMED', paymentStatus: 'REFUNDED' }],
      ['settled order paymentRef rewritten', settled.id, { status: 'CONFIRMED', paymentRef: `${P}forged_ref` }],
      ['unpaid order paymentMethod rewritten', unpaid.id, { status: 'CONFIRMED', paymentMethod: 'WIPAY' }],
      ['unpaid order paymentStatus FAILED', unpaid.id, { status: 'CONFIRMED', paymentStatus: 'FAILED' }],
      ['unpaid order paymentRef cleared', unpaid.id, { status: 'CONFIRMED', paymentRef: null }],
    ];
    for (const [label, id, body] of attempts) {
      await expect(market.updateOrderStatus(ID.biz, id, body.status as string, body), label).rejects.toThrow(/storefront order/i);
    }
    await settle();

    const paidAfter = await db.marketplaceOrder.findUnique({ where: { id: settled.id } });
    const unpaidAfter = await db.marketplaceOrder.findUnique({ where: { id: unpaid.id } });
    const shape = (o: any) => `${o.status}/${o.paymentStatus}/${o.paymentMethod}/${o.paymentRef}`;
    expect(shape(paidAfter), 'the settled order is unchanged').toBe(shape(paidBefore));
    expect(shape(unpaidAfter), 'the unpaid order is unchanged').toBe(shape(unpaidBefore));
    expect(await counts(), 'nothing written').toEqual(before);
    expect(storeEvents(), 'no lifecycle event').toEqual([]);
    await expectOnePaidInvoice(settled);

    // Controls: the fulfilment status alone still moves, and a STANDARD order's payment fields are its own to write.
    const moved = await market.updateOrderStatus(ID.biz, settled.id, 'PROCESSING', { status: 'PROCESSING' });
    expect(`${moved.status}/${moved.paymentStatus}`).toBe('PROCESSING/PAID');
    const standard = await db.marketplaceOrder.create({
      data: {
        businessId: ID.biz,
        orderNumber: `${P}std_12`,
        type: 'STANDARD',
        status: 'placed',
        paymentStatus: 'UNPAID',
        customerName: 'Vee Eighteen',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: ORDER_TOTAL,
        total: ORDER_TOTAL,
        currency: 'TTD',
      },
    });
    const written = await market.updateOrderStatus(ID.biz, standard.id, 'CONFIRMED', { status: 'CONFIRMED', paymentMethod: 'BANK', paymentRef: `${P}std_ref` });
    await settle();
    expect(`${written.status}/${written.paymentMethod}/${written.paymentRef}`).toBe(`CONFIRMED/BANK/${P}std_ref`);
  });

  it('V18-13 (trial-N recheck G6RC-3, SEC-V18-3) POST /marketplace/businesses/:id/orders decides the order type itself: a body type STOREFRONT (any case) creates a STANDARD order, so no STOREFRONT order is created paid with no invoice and no store_order.paid names one', async () => {
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);
    // Fulfilment auto-routing runs un-awaited after the create and is off this case's path: held so it writes nothing behind the case.
    const routing = vi.spyOn(market as any, 'autoRouteOrder').mockImplementation(() => undefined);
    seen = [];
    const created: any[] = [];
    try {
      for (const type of ['STOREFRONT', 'storefront']) {
        created.push(
          await market.createOrder(
            ID.biz,
            {
              type,
              paymentOnCreation: true,
              customerName: 'Vee Eighteen',
              customerEmail: CUSTOMER_EMAIL,
              items: [{ productId: ID.product, quantity: 1 }],
            },
            // G6PUB-R3-STORE-ORDER-DOORS (D-77): a paid create records its payment through the paid door, by a member
            // with revenue write (the route passes the authenticated member).
            ID.owner,
          ),
        );
      }
      await settle();
    } finally {
      routing.mockRestore();
    }

    // At 644bb6ad: STOREFRONT/paid/UNPAID with no invoice, payment or posting, and store_order.paid emitted for it (ZZPROBE-2).
    const stored = await db.marketplaceOrder.findMany({ where: { id: { in: created.map((o) => o.id) } }, select: { type: true } });
    expect(stored.map((o: any) => o.type), 'the stored type').toEqual(['STANDARD', 'STANDARD']);
    expect(created.map((o) => o.type), 'the answered type').toEqual(['STANDARD', 'STANDARD']);
    const paidStorefront = seen.filter((e) => e.name === 'store_order.paid' && String(e.payload?.order?.type ?? '').toUpperCase() === 'STOREFRONT');
    expect(paidStorefront, 'no store_order.paid names a STOREFRONT order').toEqual([]);
  });

  it('V18-14 (trial-N recheck G6PUB-RC1-3, D-14) refunding a checked-out storefront order is a D-14 refund on its invoice: a negative REFUNDED row naming the refunder, the posting reversed, the invoice back to SENT, the order REFUNDED, and no Expense; a second refund writes nothing', async () => {
    const order = await placeOrder('CASH');
    await storeOrders.completeCheckout({ orderId: order.id, paymentRef: `${P}ref_14`, provider: 'cash', method: 'cash', actorId: ID.owner });
    await settle();
    const { invoice, payment } = await expectOnePaidInvoice(order);
    seen = [];
    expenses.length = 0;

    const refunded = await storeOrders.refundOrder(order.id, ID.biz, ID.owner);
    await settle();

    expect(`${refunded.status}/${refunded.paymentStatus}`, 'the answered order').toBe('REFUNDED/REFUNDED');
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`, 'the stored order').toBe('REFUNDED/REFUNDED');

    // At c549a12f: payments [SUCCESSFUL:80] only, the invoice PAID, and an Expense of 80 (RR-1).
    const rows = await paymentsOf([invoice.id]);
    expect(rows.map((p) => `${p.status}:${Number(p.amount)}`), 'the original kept, one negative refund row (D-14)').toEqual([
      `SUCCESSFUL:${ORDER_TOTAL}`,
      `REFUNDED:${-ORDER_TOTAL}`,
    ]);
    const refundRow = rows[1];
    expect(refundRow.reference, 'the refund links to the payment').toBe(payment.providerPaymentId);
    expect(refundRow.recordedBy, 'the refunder').toBe(ID.owner);
    const reopened = await db.invoice.findUnique({ where: { id: invoice.id } });
    expect(`${reopened.status}/${reopened.paidAt}`, 'a full refund reopens the invoice to SENT, paidAt cleared (D-14)').toBe('SENT/null');
    const balance = storedBalanceFn(Number(invoice.total), rows.map((p) => ({ amount: Number(p.amount), status: p.status })), invoice.currency);
    expect(balance.net, 'nothing net received').toBe(0);

    const postings = await postingsOf([invoice.id, payment.id, refundRow.id]);
    expect(postings.length, 'the recording and its reversal').toBeGreaterThanOrEqual(2);
    const depositNet = money(
      postings
        .flatMap((t: any) => t.entries)
        .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
        .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
    );
    expect(depositNet, 'the cash taken is given back on the ledger').toBe(0);
    const totals = await db.ledgerEntry.aggregate({ where: { businessId: ID.biz }, _sum: { debit: true, credit: true } });
    expect(money(Number(totals._sum.debit ?? 0)), 'tenant trial balance').toBe(money(Number(totals._sum.credit ?? 0)));

    expect(storeEvents().filter((n) => n === 'store_order.refunded'), 'one store_order.refunded').toHaveLength(1);
    expect(expenses, 'no Expense: the refund is on the invoice, not a cost').toEqual([]);

    // A second refund is refused and writes nothing.
    const before = await counts();
    seen = [];
    const again = await storeOrders.refundOrder(order.id, ID.biz, ID.owner).then(
      () => ({ status: 200 }),
      (e: any) => ({ status: e?.status ?? e?.getStatus?.() }),
    );
    await settle();
    expect(again.status, 'already refunded').toBe(400);
    expect(await counts()).toEqual(before);
    expect(storeEvents()).toEqual([]);
    expect(expenses).toEqual([]);
  });

  it('V18-15 (trial-N recheck G6PUB-RC1-3) an order nothing was paid on is not refunded (409): no store_order.refunded, no Expense, nothing written', async () => {
    const order = await placeOrder();
    expect(order.paymentStatus).toBe('UNPAID');
    const before = await counts();
    seen = [];
    expenses.length = 0;

    const outcome = await storeOrders.refundOrder(order.id, ID.biz, ID.owner).then(
      () => ({ status: 200, message: 'refunded' }),
      (e: any) => ({ status: e?.status ?? e?.getStatus?.(), message: String(e?.message) }),
    );
    await settle();

    // At c549a12f: REFUNDED/REFUNDED and an Expense of 80 for an order nobody paid (RR-2).
    expect(outcome.status, outcome.message).toBe(409);
    const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
    expect(`${stored.status}/${stored.paymentStatus}`, 'the order is untouched').toBe('PENDING/UNPAID');
    expect(storeEvents(), 'no store_order.refunded').toEqual([]);
    expect(expenses, 'no Expense').toEqual([]);
    expect(await counts(), 'no invoice, payment or posting').toEqual(before);
  });

  it('V18-T2 (W9-STORE-PAID-LISTENERS, was it.todo; D-18, SEC-V18-3) the store_order.paid listeners that did not read the stored paymentStatus (webhook-dispatcher.service.ts, revenue-event.listener.ts, store-order-routing.listener.ts) act only on an order stored PAID in the event\'s business: a STANDARD order set paid by PATCH .../status without a payment, an UNPAID storefront order and an event naming another business get no webhook delivery, no paid timeline entry and no fulfilment routing; controls: a STANDARD order stored PAID and a checked-out storefront order get all three', async () => {
    const { Test } = await import('@nestjs/testing');
    const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
    const { RevenueEventListener } = await import('../src/modules/crm/revenue-event.listener');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
    const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);

    // The outbound webhook receivers of business A and business B (fetch answered here: no network).
    const HOOK = { A: 'https://v18a-hooks-a.test.invalid/store-order-paid', B: 'https://v18a-hooks-b.test.invalid/store-order-paid' };
    await db.webhook.create({
      data: { id: `${P}wh_a`, businessId: ID.biz, name: 'V18-T2 A', url: HOOK.A, events: ['store_order.paid'], secret: `${P}fake_signing_value_a` },
    });
    await db.webhook.create({
      data: { id: `${P}wh_b`, businessId: ID.bizB, name: 'V18-T2 B', url: HOOK.B, events: ['store_order.paid'], secret: `${P}fake_signing_value_b` },
    });
    const deliveries: Array<{ hook: string; event: string; orderId?: string }> = [];
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      const hook = url === HOOK.A ? 'A' : url === HOOK.B ? 'B' : null;
      if (!hook) return realFetch(input, init);
      const body = JSON.parse(String(init?.body ?? '{}'));
      deliveries.push({ hook, event: body.event, orderId: body.data?.order?.id });
      return new Response('ok', { status: 200 });
    });

    // The CRM timeline writes RevenueEventListener asks for (its decision is real; the write is recorded).
    const timelineWrites: Array<{ businessId: string; type: string; orderId?: string }> = [];
    const listenerModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
      providers: [
        PrismaService,
        WebhookDispatcherService,
        RevenueEventListener,
        StoreOrderRoutingListener,
        {
          provide: CrmTimelineService,
          useValue: {
            logEvent: async (businessId: string, _contactId: string, type: string, data: { orderId?: string }) => {
              timelineWrites.push({ businessId, type, orderId: data?.orderId });
              return null;
            },
          },
        },
        { provide: ContactInsightService, useValue: { markStale: async () => null } },
        { provide: CrmService, useValue: {} },
        // The suite's real routing service, over the same rows.
        { provide: FulfillmentRoutingService, useValue: app.get(FulfillmentRoutingService) },
      ],
    }).compile();
    const listenerApp = listenerModule.createNestApplication();
    await listenerApp.init();
    const paidBus = listenerApp.get(EventEmitter2);
    const routingEvents: Array<{ name: string; orderId?: string; businessId?: string }> = [];
    paidBus.onAny((name: string | string[], payload: any) => {
      const n = Array.isArray(name) ? name.join('.') : String(name);
      if (n !== 'store_order.paid') routingEvents.push({ name: n, orderId: payload?.orderId, businessId: payload?.businessId });
    });
    // Await the work an emit starts (two are { async: true } listeners: they start on the next tick).
    const handlers: Array<[Record<string, any>, string]> = [
      [listenerApp.get(WebhookDispatcherService), 'onStoreOrderPaid'],
      [listenerApp.get(RevenueEventListener), 'onStoreOrderPaid'],
      [listenerApp.get(RevenueEventListener), 'onFulfillmentRouted'],
      [listenerApp.get(RevenueEventListener), 'onRoutingFailed'],
      [listenerApp.get(StoreOrderRoutingListener), 'onStoreOrderPaid'],
    ];
    for (const [instance, name] of handlers) {
      const original = instance[name].bind(instance);
      instance[name] = (...args: unknown[]) => {
        const work = original(...args);
        inflight.push(Promise.resolve(work));
        return work;
      };
    }
    const deliver = async (payload: any) => {
      await paidBus.emitAsync('store_order.paid', payload);
      for (let round = 0; round < 6; round += 1) {
        await new Promise((r) => setImmediate(r));
        await settle();
      }
    };
    const traces = async (orderId: string) => ({
      webhooks: deliveries.filter((d) => d.orderId === orderId).map((d) => `${d.hook}:${d.event}`),
      timeline: timelineWrites
        .filter((t) => t.orderId === orderId)
        .map((t) => `${t.businessId === ID.biz ? 'A' : t.businessId === ID.bizB ? 'B' : t.businessId}:${t.type}`)
        .sort(),
      routing: routingEvents.filter((e) => e.orderId === orderId).map((e) => e.name),
      routes: await db.fulfillmentRoute.count({ where: { orderId } }),
    });
    const NOTHING = { webhooks: [], timeline: [], routing: [], routes: 0 };
    const standardOrder = (suffix: string) =>
      db.marketplaceOrder.create({
        data: {
          businessId: ID.biz,
          orderNumber: `${P}std_t2_${suffix}`,
          type: 'STANDARD',
          status: 'placed',
          paymentStatus: 'UNPAID',
          customerName: 'Vee Eighteen',
          customerEmail: CUSTOMER_EMAIL,
          subtotal: ORDER_TOTAL,
          total: ORDER_TOTAL,
          currency: 'TTD',
          items: { create: [{ productId: ID.product, name: 'V18A Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL }] },
        },
      });
    const emittedPaid = (orderId: string) => seen.filter((e) => e.name === 'store_order.paid' && e.payload?.order?.id === orderId).map((e) => e.payload);

    try {
      // (1) A STANDARD order set 'paid' by PATCH .../status with no payment: the real route emits store_order.paid
      // for an order stored UNPAID (SEC-V18-3). At the base all three listeners acted on it.
      const unpaidStandard = await standardOrder('unpaid');
      seen = [];
      const patched = await market.updateOrderStatus(ID.biz, unpaidStandard.id, 'paid', { status: 'paid' });
      await settle();
      expect(`${patched.status}/${patched.paymentStatus}`, 'PATCH .../status paid without a payment').toBe('paid/UNPAID');
      const [patchedEvent] = emittedPaid(unpaidStandard.id);
      expect(patchedEvent, 'the route emitted store_order.paid').toBeTruthy();
      await deliver(patchedEvent);
      expect(await traces(unpaidStandard.id), 'STANDARD order stored UNPAID: no webhook, no paid timeline entry, no routing').toEqual(NOTHING);
      expect((await db.marketplaceOrder.findUnique({ where: { id: unpaidStandard.id } })).status, 'not routed').toBe('paid');

      // (2) An UNPAID storefront order's paid event (a queued or forged copy, as V18-05).
      const unpaidStorefront = await placeOrder();
      const storedUnpaid = await db.marketplaceOrder.findUnique({ where: { id: unpaidStorefront.id }, include: { items: true } });
      expect(storedUnpaid.paymentStatus).toBe('UNPAID');
      await deliver({ order: storedUnpaid, businessId: ID.biz });
      expect(await traces(unpaidStorefront.id), 'storefront order stored UNPAID: nothing').toEqual(NOTHING);

      // (3) A STANDARD order of A stored PAID (PATCH with paymentStatus PAID), its event naming business B:
      // B holds no such order, so B's webhook, B's contact (same email) and B's routing see nothing.
      const paidStandard = await standardOrder('paid');
      seen = [];
      await market.updateOrderStatus(ID.biz, paidStandard.id, 'paid', { status: 'paid', paymentStatus: 'PAID' });
      await settle();
      const [paidStandardEvent] = emittedPaid(paidStandard.id);
      expect(paidStandardEvent?.order?.paymentStatus).toBe('PAID');
      await deliver({ ...paidStandardEvent, businessId: ID.bizB });
      expect(await traces(paidStandard.id), 'an event naming another business: nothing in either').toEqual(NOTHING);

      // Control (4): the same event in its own business is acted on by all three listeners.
      await deliver(paidStandardEvent);
      const acted = await traces(paidStandard.id);
      expect(acted.webhooks, 'A\'s webhook is delivered once').toEqual(['A:store_order.paid']);
      expect(acted.timeline, 'A\'s contact gets the paid timeline entry').toContain('A:store_order.paid');
      expect(acted.routing, 'the order is routed').toEqual(['store_order.fulfillment_routed']);
      expect(acted.routes, 'fulfilment routes written').toBeGreaterThan(0);

      // Control (5): a checked-out storefront order (completeCheckout's emission) is acted on by all three.
      const checkedOut = await placeOrder();
      seen = [];
      await storeOrders.completeCheckout({ orderId: checkedOut.id, paymentRef: `${P}ref_t2`, provider: 'stripe', method: 'card' });
      await settle();
      const [checkoutEvent] = emittedPaid(checkedOut.id);
      expect(checkoutEvent?.invoiceId).toBeTruthy();
      await deliver(checkoutEvent);
      const settled = await traces(checkedOut.id);
      expect(settled.webhooks).toEqual(['A:store_order.paid']);
      expect(settled.timeline).toContain('A:store_order.paid');
      expect(settled.routing, 'routing ran for the settled order').toHaveLength(1);
      await expectOnePaidInvoice(checkedOut);
    } finally {
      fetchSpy.mockRestore();
      await settle();
      await listenerApp.close();
    }
  });

  it('V18-T3 (W9-STORE-PAID-LISTENERS, was it.todo; D-18, V1-33) live pin: CASH and MANUAL storefront orders reach PAID through POST /site/businesses/:businessId/orders/:orderId/complete-offline (revenue write, the signed-in member records it) with one invoice, one payment and one posting, a second completion writes nothing, and the store fulfillment panel\'s Complete offline action posts to that route (CR-V18-3, web spec fulfillment-panel-complete-offline FPO-01..04)', async () => {
    const fs = await import('fs');
    const { RequestMethod } = await import('@nestjs/common');
    const { PATH_METADATA, METHOD_METADATA } = await import('@nestjs/common/constants');
    const { SiteController } = await import('../src/modules/site/site.controller');
    const { MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');

    // The route: POST /site/businesses/:businessId/orders/:orderId/complete-offline, revenue write.
    const handler = SiteController.prototype.completeOfflineOrder;
    expect(Reflect.getMetadata(PATH_METADATA, SiteController)).toBe('site');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('businesses/:businessId/orders/:orderId/complete-offline');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(MODULE_SCOPE_KEY, handler)).toEqual({ module: 'revenue', minLevel: 'write' });

    // The handler over the suite's real StoreOrderService (its other services are off this route).
    const controller = new (SiteController as any)({}, storeOrders, {}, {}, {}, {}, {}, {}, {});
    for (const method of ['CASH', 'MANUAL']) {
      const order = await placeOrder(method);
      expect(order.paymentStatus, `${method} order placed unpaid`).not.toBe('PAID');
      seen = [];

      const completed = await controller.completeOfflineOrder(ID.biz, order.id, { user: { id: ID.owner } });
      await settle();

      expect(completed.paymentStatus, `${method} order completed offline`).toBe('PAID');
      const { payment } = await expectOnePaidInvoice(order);
      expect(`${payment.provider}:${payment.method}:${payment.recordedBy}`, 'the payment names its method and the member').toBe(
        `${method.toLowerCase()}:${method.toLowerCase()}:${ID.owner}`,
      );
      expect(storeEvents().filter((n) => n === 'store_order.paid'), 'one store_order.paid').toHaveLength(1);

      // A second completion answers the paid order and writes nothing.
      const before = await counts();
      seen = [];
      const again = await controller.completeOfflineOrder(ID.biz, order.id, { user: { id: ID.owner } });
      await settle();
      expect(again.paymentStatus).toBe('PAID');
      expect(await counts(), 'nothing written by a second completion').toEqual(before);
      expect(storeEvents(), 'no second store_order.paid').toEqual([]);
      await expectOnePaidInvoice(order);
    }

    // The web caller: the store fulfillment panel's Complete offline action posts to this route, offered for CASH / MANUAL.
    const panel = fs.readFileSync(path.resolve(__dirname, '../../web/src/app/app/store/components/fulfillment-panel.tsx'), 'utf8');
    expect(panel).toContain('path: `/site/businesses/${businessId}/orders/${order.id}/complete-offline`');
    expect(panel).toMatch(/OFFLINE_PAYMENT_METHODS = new Set\(\["CASH", "MANUAL"\]\)/);
    expect(fs.existsSync(path.resolve(__dirname, '../../web/src/app/app/store/components/__tests__/fulfillment-panel-complete-offline.test.tsx'))).toBe(true);
  });
});
