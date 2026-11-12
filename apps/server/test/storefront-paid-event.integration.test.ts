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
 *   V18-T2  three store_order.paid listeners that did not read the stored
 *           payment status (WebhookDispatcherService: the outbound webhook;
 *           RevenueEventListener: its paid timeline entry;
 *           StoreOrderRoutingListener: fulfilment routing) act only on an order
 *           stored PAID in the event's business. A STANDARD order set 'paid' by
 *           PATCH .../status without a payment and stored UNPAID (the emission
 *           still open after V18-10), an UNPAID storefront order (a queued or
 *           forged event) and an event naming another business get no webhook
 *           delivery, no RevenueEventListener timeline entry and no routing from
 *           these three. Controls: a STANDARD order stored PAID and a
 *           checked-out storefront order get all three. The listeners run on
 *           their own bus in this case (so the other cases' event lists are
 *           unchanged); the payloads are the ones the real emitters put on the
 *           suite's bus
 *
 *           Not closed by V18-T2 (review STL-SEC-1, STL-SEC-2 / CR-W9SPL-1),
 *           made live by W10-STORE-ORDER-PAID (FOLLOW11; owner ruling D-112):
 *   V18-T2b the other store_order.paid listeners act only on an order stored
 *           PAID in the event's business. For a STANDARD order set 'paid' by
 *           PATCH .../status without a payment and stored UNPAID,
 *           CommerceIntegrationService.handleOrderPaid (on the suite's bus)
 *           writes no store_order.paid contact timeline event, no "Order Payment
 *           Received" notification and no raw PAID INV-ORD-<n> invoice (it did
 *           all three at the base); on their own bus, for that order, an UNPAID
 *           storefront order and an event naming another business,
 *           JourneyListenerService records no order_paid touchpoint and
 *           CalendarOrdersListener projects nothing (both acted on the payload
 *           at the base). AiListener is kept as it is and pinned: its only act
 *           is dropping the named business's graph cache, so the next snapshot
 *           is read from the stored rows and no payment claim is trusted.
 *           Controls: the same order marked PAID by the owner through the paid
 *           door (V18-T2c) is acted on by all four
 *   V18-T2c D-112: a STANDARD order not created paid is marked PAID (PATCH
 *           .../status with paymentStatus PAID, the fulfil 'mark_paid' action)
 *           only by a member with revenue write, and only through the paid door
 *           (StoreOrderService.completeCheckout, as D-77 does for an order
 *           created paid): one PAID invoice INV-<orderNumber>, one SUCCESSFUL
 *           payment recorded by that member, one balanced payment_recorded
 *           posting and one store_order.paid naming the invoice. A revenue:read
 *           STAFF member and a call with no member are refused 403 with nothing
 *           written and no store_order.paid (at the base both wrote paid/PAID
 *           with no payment, and the listener added a raw INV-ORD invoice); an
 *           order with no customer to invoice is 400. Fulfilment status changes
 *           stay open to the STAFF member. The routes are called through
 *           MarketplaceController, so the actor is the signed-in member
 *
 *           W10-STORE-ORDER-PAID review repairs (D-112; findings SEC-SOP-1..4,
 *           CR-W10SOP-1..5), each red at 3181cbb0 by the review's probes:
 *   V18-T2d PATCH .../status takes plain strings (a Prisma operation object
 *           such as paymentStatus {"set":"PAID"} passed the D-112 gate and was
 *           stored: 400), and every payment field it writes (a settled state
 *           such as COMPLETED or REFUNDED, a method, a reference) takes revenue
 *           write (403); nothing is written
 *   V18-T2e a status change records no payment and emits no store_order.paid:
 *           no "order paid" automation (AgentTriggerService) for an order
 *           stored UNPAID, and no replayed paid fan-out for an order stored
 *           PAID outside the paid door (the Shopify sync's shape)
 *   V18-T2f a marking's own writes (its timeline step, the customer it names)
 *           are on the order before the door emits store_order.paid, so the
 *           routing listener and the marking no longer overwrite each other; a
 *           refused marking takes them back; the member's payment reference is
 *           the order's paymentRef again
 *   V18-T2g an order totalling 0 and a walk-in order (given its customer with
 *           the marking) are marked PAID through the door; they were refused
 *           for good
 *   V18-T2h an order marked paid through the door is refunded through the
 *           D-14 refund door (in full; a partial amount is 400)
 *   V18-T2i / V18-T2j (it.todo, outside this packet's write set): a partial
 *           refund through the door; COGS posted in the door's transaction
 *
 *           W10-SOP-FIX (D-112; findings SOP-V1, SOP-V2, SOP-V4), each red at
 *           6470942a:
 *   V18-T2k three mark_paid calls racing on one UNPAID STANDARD order: one
 *           payment, and only the marking that recorded it runs the work after
 *           the door (routing, the order_confirmed email); the others answer
 *           200 with the order as stored and take their own timeline step back
 *   V18-T2l a PATCH .../status carrying paymentStatus PAID that loses the door
 *           announces nothing (no store_order.shipped for a 'shipped' it did
 *           not write)
 *   V18-T2m with production wiring (routing listener on the bus, the real
 *           autoRouteOrder, the paid listener's contact link) a single
 *           mark_paid keeps every timeline step and the contact link: each
 *           writer changes only its own part of the order's metadata, in one
 *           statement
 *
 *           W10-SOP-FIX review (SOPFIX-SEC-1, SOPFIX-R1), each red at 53fb2438:
 *   V18-T2n an order is routed once however many routers reach it: the
 *   ..T2n4  routing engine claims the order before it reads its routes. With
 *           both routers held where they create routes, one mark_paid (a
 *           DROPSHIP line) and an order created paid (a DROPSHIP line; a
 *           tracked line) each get one route set (one supplier PO; one unit
 *           reserved), and three routing calls at once make one route
 *   V18-T2n5 the router that comes second meets the order routed and is
 *           answered with its routes: the listener emits fulfillment_routed,
 *           not routing_failed, for a routed DROPSHIP order (supplier_ordered)
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
    `DELETE FROM agent_triggers WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // V18-T2n: the supplier POs its DROPSHIP line raises, its listing, its warehouse and its tracked stock.
    `DELETE FROM purchase_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/**
 * W10-STORE-ORDER-PAID review repairs (V18-T2d..V18-T2h): the marketplace
 * route handlers over the suite's real MarketplaceService (the actor is the
 * signed-in member, never a body field), the HTTP status a call is answered
 * with, a STANDARD order of business A, and a member of A.
 */
async function marketRoutes() {
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const market = app.get(MarketplaceService);
  return { market, controller: new (MarketplaceController as any)(market, {}, {}) };
}
const signedIn = (userId: string | null) => ({ user: userId ? { id: userId } : undefined });
const answered = (work: Promise<unknown>) =>
  work.then(
    () => 200,
    (err: any) => (typeof err?.getStatus === 'function' ? err.getStatus() : `${err?.name}: ${err?.message}`),
  );
function standardOrderOfA(suffix: string, extra: Record<string, unknown> = {}) {
  return db.marketplaceOrder.create({
    data: {
      businessId: ID.biz,
      orderNumber: `${P}rp_${suffix}`,
      type: 'STANDARD',
      status: 'placed',
      paymentStatus: 'UNPAID',
      customerName: 'Vee Eighteen',
      customerEmail: CUSTOMER_EMAIL,
      subtotal: ORDER_TOTAL,
      total: ORDER_TOTAL,
      currency: 'TTD',
      metadata: { statusTimeline: [{ status: 'placed', timestamp: '2026-11-01T10:00:00.000Z', note: 'Order placed' }] },
      items: { create: [{ productId: ID.product, name: 'V18A Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL }] },
      ...extra,
    },
  });
}
/** A member of business A with the role's default scopes (a STAFF member's revenue access is read). */
async function memberOfA(suffix: string, role = 'STAFF') {
  const id = `${P}${suffix}`;
  await db.user.upsert({ where: { id }, create: { id, email: `${P}${suffix}@test.local`, role: 'USER' }, update: {} });
  await db.membership.upsert({
    where: { userId_businessId: { userId: id, businessId: ID.biz } },
    create: { id: `${id}_m`, userId: id, businessId: ID.biz, role },
    update: {},
  });
  return id;
}
/**
 * W10-SOP-FIX (SOP-V1, SOP-V2): the paid door (StoreOrderService.completeCheckout, real) held until `parties`
 * markings have reached it, so each has read the order UNPAID and passed its own already-paid check: the race the
 * review reproduced. `go` then decides when each held marking goes through the real door (all at once by default).
 */
function holdPaidDoor(parties: number, go?: (input: any, real: (input: any) => Promise<any>) => Promise<any>) {
  const real = storeOrders.completeCheckout.bind(storeOrders);
  let arrived = 0;
  let allIn!: () => void;
  const gathered = new Promise<void>((resolve) => (allIn = resolve));
  return vi.spyOn(storeOrders, 'completeCheckout').mockImplementation(async (input: any) => {
    arrived += 1;
    if (arrived === parties) allIn();
    await gathered;
    return go ? go(input, real) : real(input);
  });
}

/**
 * W10-SOP-FIX (SOP-V1, SOP-V4): fulfilment routing (FulfillmentRoutingService.routeOrder, real) tracked, so a case
 * can count it and await the routing that mark_paid's un-awaited autoRouteOrder starts (drain).
 */
async function trackRouting() {
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const routing = app.get(FulfillmentRoutingService);
  const real = routing.routeOrder.bind(routing);
  return vi.spyOn(routing, 'routeOrder').mockImplementation((...args: any[]) => {
    const work = (real as (...a: any[]) => Promise<any>)(...args);
    inflight.push(work);
    return work;
  });
}

/**
 * W10-SOP-FIX review (SOPFIX-SEC-1, SOPFIX-R1): the routing engine's route creation for one strategy
 * (FulfillmentRoutingService's routeDropship or routeLocalStock, real) held until `parties` routers have reached it,
 * or `windowMs` has passed. Only a router that read the order with no routes reaches it. At 53fb2438 every router of
 * the order read none, so they were all held here together and each created its own routes (a DROPSHIP line: its own
 * supplier PO): the race the review reproduced, made certain. A router that claims the order before it reads it
 * keeps the others out, and the window lets the claimant through alone.
 */
async function holdRouteCreation(method: 'routeDropship' | 'routeLocalStock', parties: number, windowMs = 500) {
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const routing = app.get(FulfillmentRoutingService) as Record<string, any>;
  const real = routing[method].bind(routing);
  let arrived = 0;
  let allIn!: () => void;
  const gathered = new Promise<void>((resolve) => (allIn = resolve));
  const spy = vi.spyOn(routing, method).mockImplementation(async (...args: unknown[]) => {
    arrived += 1;
    if (arrived >= parties) allIn();
    await Promise.race([gathered, new Promise((resolve) => setTimeout(resolve, windowMs))]);
    return real(...args);
  });
  return { arrivals: () => arrived, restore: () => spy.mockRestore() };
}

/** settle(), until no routing or listener work has started for a few quiet windows (autoRouteOrder runs un-awaited). */
async function drain() {
  for (let quiet = 0; quiet < 4; ) {
    const busy = inflight.length > 0;
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 75));
    quiet = busy || inflight.length > 0 ? 0 : quiet + 1;
  }
}

/** W10-SOP-FIX (SOP-V1): the customer emails MarketplaceService sends (its TransactionalEmailService is a stand-in). */
async function captureEmails() {
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const email = app.get(TransactionalEmailService) as Record<string, unknown>;
  const sent: Array<{ type: string; dedupeKey?: string; templateData?: Record<string, any> }> = [];
  email.send = async (message: any) => {
    sent.push(message);
    return null;
  };
  return { sent, restore: () => delete email.send };
}

/** The order as stored: status/paymentStatus/paymentMethod/paymentRef/customerEmail, and its timeline steps. */
async function orderShape(id: string) {
  const o = await db.marketplaceOrder.findUnique({ where: { id } });
  return {
    row: `${o.status}/${o.paymentStatus}/${o.paymentMethod}/${o.paymentRef}/${o.customerEmail}`,
    steps: (((o.metadata as any)?.statusTimeline ?? []) as any[]).map((t) => t.status),
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
    // W10-STORE-ORDER-PAID (D-112): marking a STANDARD order PAID takes a member with revenue write (the owner here).
    const paidStandard = await market.updateOrderStatus(ID.biz, standard.id, 'paid', { status: 'paid', paymentStatus: 'PAID' }, ID.owner);
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
    // W10-STORE-ORDER-PAID review (SEC-SOP-4): a payment field is written by a member with revenue write (the owner).
    const written = await market.updateOrderStatus(
      ID.biz,
      standard.id,
      'CONFIRMED',
      { status: 'CONFIRMED', paymentMethod: 'BANK', paymentRef: `${P}std_ref` },
      ID.owner,
    );
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

  it('V18-T2 (W9-STORE-PAID-LISTENERS, was it.todo; D-18, SEC-V18-3) three store_order.paid listeners that did not read the stored paymentStatus (webhook-dispatcher.service.ts, revenue-event.listener.ts, store-order-routing.listener.ts) act only on an order stored PAID in the event\'s business: a STANDARD order set paid by PATCH .../status without a payment and stored UNPAID, an UNPAID storefront order and an event naming another business get from these three no webhook delivery, no RevenueEventListener timeline entry and no fulfilment routing; controls: a STANDARD order stored PAID and a checked-out storefront order get all three (the other listeners: V18-T2b; a stored PAID written without a payment: V18-T2c)', async () => {
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
      // (1) A STANDARD order set 'paid' by PATCH .../status with no payment: the real route emitted store_order.paid
      // for an order stored UNPAID (SEC-V18-3). At the base all three listeners acted on it. Only these three are
      // asserted here: the other listeners on the same order (CommerceIntegrationService on the suite's bus, the
      // journey and calendar listeners and AiListener) are V18-T2b (W10-STORE-ORDER-PAID, D-112).
      // W10-STORE-ORDER-PAID review (SEC-SOP-2): the route emits no store_order.paid any more (a status change records
      // no payment); the payload it emitted, { order, businessId } (a queued or forged copy now), is delivered here.
      const unpaidStandard = await standardOrder('unpaid');
      seen = [];
      const patched = await market.updateOrderStatus(ID.biz, unpaidStandard.id, 'paid', { status: 'paid' });
      await settle();
      expect(`${patched.status}/${patched.paymentStatus}`, 'PATCH .../status paid without a payment').toBe('paid/UNPAID');
      expect(emittedPaid(unpaidStandard.id), 'the route emits no store_order.paid (SEC-SOP-2)').toEqual([]);
      const patchedEvent = { order: patched, businessId: ID.biz };
      await deliver(patchedEvent);
      expect(await traces(unpaidStandard.id), 'STANDARD order stored UNPAID: from these three listeners no webhook, no RevenueEventListener timeline entry, no routing').toEqual(NOTHING);
      expect((await db.marketplaceOrder.findUnique({ where: { id: unpaidStandard.id } })).status, 'not routed').toBe('paid');

      // (2) An UNPAID storefront order's paid event (a queued or forged copy, as V18-05).
      const unpaidStorefront = await placeOrder();
      const storedUnpaid = await db.marketplaceOrder.findUnique({ where: { id: unpaidStorefront.id }, include: { items: true } });
      expect(storedUnpaid.paymentStatus).toBe('UNPAID');
      await deliver({ order: storedUnpaid, businessId: ID.biz });
      expect(await traces(unpaidStorefront.id), 'storefront order stored UNPAID: nothing').toEqual(NOTHING);

      // (3) A STANDARD order of A stored PAID (PATCH with paymentStatus PAID), its event naming business B:
      // B holds no such order, so B's webhook, B's contact (same email) and B's routing see nothing. Since
      // W10-STORE-ORDER-PAID (D-112, V18-T2c) that PAID is written only through the paid door by a member with
      // revenue write (the owner here), with its invoice, payment and posting (STL-SEC-1).
      const paidStandard = await standardOrder('paid');
      seen = [];
      await market.updateOrderStatus(ID.biz, paidStandard.id, 'paid', { status: 'paid', paymentStatus: 'PAID' }, ID.owner);
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

  // W10-STORE-ORDER-PAID (FOLLOW11; owner ruling D-112): what V18-T2 did not close (review STL-SEC-1, STL-SEC-2 / CR-W9SPL-1).
  it('V18-T2b (W10-STORE-ORDER-PAID, D-112, was it.todo; W9-STORE-PAID-LISTENERS review STL-SEC-2 / CR-W9SPL-1, D-18) the other store_order.paid listeners act only on an order stored PAID in the event\'s business: for a STANDARD order set paid by PATCH .../status without a payment and stored UNPAID, CommerceIntegrationService.handleOrderPaid writes no store_order.paid contact timeline event, no "Order Payment Received" notification and no raw PAID INV-ORD-<n> invoice; for that order, an UNPAID storefront order and an event naming another business, journey-listener.service records no order_paid touchpoint and calendar orders.listener projects nothing; ai.listener is kept and pinned (it only drops the named business\'s graph cache); control: the order marked PAID by the owner through the paid door is acted on by all four', async () => {
    const { Test } = await import('@nestjs/testing');
    const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { AiListener } = await import('../src/modules/ai/ai.listener');
    const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');
    const { JourneyListenerService } = await import('../src/modules/growth-intelligence/journey-listener.service');
    const { CustomerJourneyService } = await import('../src/modules/growth-intelligence/customer-journey.service');
    const { CalendarOrdersListener } = await import('../src/modules/calendar/listeners/orders.listener');
    const { CalendarProjectionService } = await import('../src/modules/calendar/calendar-projection.service');
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);

    // What these three listeners ask for (their decisions are real; the writes are recorded).
    const touchpoints: Array<{ businessId: string; contactId: string; touchpointType: string; value?: number; orderId?: string }> = [];
    const projections: Array<{ businessId: string; sourceType: string; sourceId: string; type: string }> = [];
    const invalidated: string[] = [];
    const listenerModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
      providers: [
        PrismaService,
        AiListener,
        {
          provide: BusinessGraphService,
          useValue: {
            invalidateCache: (businessId: string) => {
              invalidated.push(businessId);
            },
          },
        },
        JourneyListenerService,
        {
          provide: CustomerJourneyService,
          useValue: {
            recordTouchpoint: async (input: any) => {
              touchpoints.push({
                businessId: input.businessId,
                contactId: input.contactId,
                touchpointType: input.touchpointType,
                value: input.value,
                orderId: input.metadata?.orderId,
              });
              return null;
            },
          },
        },
        CalendarOrdersListener,
        {
          provide: CalendarProjectionService,
          useValue: {
            upsertFromSource: async (input: any) => {
              projections.push({ businessId: input.businessId, sourceType: input.sourceType, sourceId: input.sourceId, type: input.type });
              return null;
            },
          },
        },
      ],
    }).compile();
    const listenerApp = listenerModule.createNestApplication();
    await listenerApp.init();
    const paidBus = listenerApp.get(EventEmitter2);
    // Await the work an emit starts (the calendar listener is { async: true }: it starts on the next tick).
    for (const instance of [listenerApp.get(JourneyListenerService), listenerApp.get(CalendarOrdersListener)] as Array<Record<string, any>>) {
      for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
        if (!name.startsWith('on') || typeof instance[name] !== 'function') continue;
        const original = instance[name].bind(instance);
        instance[name] = (...args: unknown[]) => {
          const work = original(...args);
          inflight.push(Promise.resolve(work));
          return work;
        };
      }
    }
    const deliver = async (payload: any) => {
      await paidBus.emitAsync('store_order.paid', payload);
      for (let round = 0; round < 6; round += 1) {
        await new Promise((r) => setImmediate(r));
        await settle();
      }
    };
    const tag = (businessId: string) => (businessId === ID.biz ? 'A' : businessId === ID.bizB ? 'B' : businessId);
    const traces = (orderId: string) => ({
      touchpoints: touchpoints
        .filter((t) => t.orderId === orderId)
        .map((t) => `${tag(t.businessId)}:${t.contactId === ID.contact ? 'contact' : t.contactId}:${t.touchpointType}:${t.value}`),
      projections: projections.filter((p) => p.sourceId === orderId).map((p) => `${tag(p.businessId)}:${p.sourceType}:${p.type}`),
    });
    const NONE = { touchpoints: [], projections: [] };
    const EXPECTED_SHIP_AT = '2026-12-15T10:00:00.000Z';
    // MarketplaceOrder has no contactId column, so no real emitter's payload names a contact and the journey listener
    // records nothing from one; each payload delivered here names the seeded contact, so the listener's decision is asserted.
    const naming = (payload: any) => ({ ...payload, order: { ...payload.order, contactId: ID.contact } });
    const emittedPaid = (orderId: string) => seen.filter((e) => e.name === 'store_order.paid' && e.payload?.order?.id === orderId).map((e) => e.payload);

    try {
      // (1) A STANDARD order set 'paid' by PATCH .../status with no payment (a fulfilment status change, open to any member):
      // stored paid/UNPAID. The route emitted store_order.paid for it; since the W10-STORE-ORDER-PAID review (SEC-SOP-2)
      // it emits none, and the payload it emitted ({ order, businessId }: a queued or forged copy now) is delivered here.
      const order = await db.marketplaceOrder.create({
        data: {
          businessId: ID.biz,
          orderNumber: `${P}std_t2b`,
          type: 'STANDARD',
          status: 'placed',
          paymentStatus: 'UNPAID',
          customerName: 'Vee Eighteen',
          customerEmail: CUSTOMER_EMAIL,
          subtotal: ORDER_TOTAL,
          total: ORDER_TOTAL,
          currency: 'TTD',
          metadata: { expectedShipAt: EXPECTED_SHIP_AT },
          items: { create: [{ productId: ID.product, name: 'V18A Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL }] },
        },
      });
      seen = [];
      const patched = await market.updateOrderStatus(ID.biz, order.id, 'paid', { status: 'paid' });
      await settle();
      expect(`${patched.status}/${patched.paymentStatus}`, 'PATCH .../status paid without a payment').toBe('paid/UNPAID');
      expect(emittedPaid(order.id), 'the route emits no store_order.paid (SEC-SOP-2)').toEqual([]);
      const patchedEvent = { order: patched, businessId: ID.biz };
      // CommerceIntegrationService.handleOrderPaid on the suite's bus. At the base: a store_order.paid contact timeline
      // event, an 'Order Payment Received' notification and a raw PAID INV-ORD-<n> invoice with no payment.
      await events.emitAsync('store_order.paid', patchedEvent);
      await settle();
      const ignored = await paidTraces(ID.biz, order.id);
      expect({ notifications: ignored.notifications, timeline: ignored.timeline }, 'CommerceIntegrationService: no notification, no paid timeline event').toEqual({
        notifications: 0,
        timeline: 0,
      });
      expect((await invoicesOf(order)).map((i) => i.invoiceNumber), 'no raw PAID INV-ORD invoice').toEqual([]);

      invalidated.length = 0;
      await deliver(naming(patchedEvent));
      // At the base: an order_paid CONVERSION touchpoint of 80 for the contact, and the order projected on the calendar.
      expect(traces(order.id), 'STANDARD order stored UNPAID: no journey touchpoint, no calendar projection').toEqual(NONE);
      // AiListener, kept as it is (pinned): its only act is dropping the named business's graph cache, so the next
      // snapshot is read from the stored rows (where the order is UNPAID); no payment claim of the payload is used.
      expect(invalidated, 'AiListener: A\'s graph cache is dropped, nothing else').toEqual([ID.biz]);

      // (2) An UNPAID storefront order's paid event (a queued or forged copy, as V18-05), with a ship date to project.
      const storefront = await placeOrder();
      const placed = await db.marketplaceOrder.findUnique({ where: { id: storefront.id } });
      const storedUnpaid = await db.marketplaceOrder.update({
        where: { id: storefront.id },
        data: { metadata: { ...((placed.metadata as Record<string, unknown> | null) ?? {}), expectedShipAt: EXPECTED_SHIP_AT } },
        include: { items: true },
      });
      expect(storedUnpaid.paymentStatus).toBe('UNPAID');
      await deliver(naming({ order: storedUnpaid, businessId: ID.biz }));
      expect(traces(storefront.id), 'storefront order stored UNPAID: nothing').toEqual(NONE);

      // (3) Control: the owner marks the STANDARD order PAID through the paid door (V18-T2c).
      seen = [];
      await market.updateOrderStatus(ID.biz, order.id, 'paid', { status: 'paid', paymentStatus: 'PAID' }, ID.owner);
      await settle();
      const [paidEvent] = emittedPaid(order.id);
      expect(paidEvent?.order?.paymentStatus).toBe('PAID');
      const acted = await paidTraces(ID.biz, order.id);
      expect({ notifications: acted.notifications, timeline: acted.timeline }, 'CommerceIntegrationService acts on the order stored PAID').toEqual({
        notifications: 1,
        timeline: 1,
      });

      // Its event naming business B: B holds no such order, so nothing in either (AiListener drops only B's cache).
      invalidated.length = 0;
      await deliver(naming({ ...paidEvent, businessId: ID.bizB }));
      expect(traces(order.id), 'an event naming another business: nothing in either').toEqual(NONE);
      expect(invalidated, 'AiListener: B\'s graph cache only (read again from B\'s own rows)').toEqual([ID.bizB]);

      // The event in its own business: one touchpoint and one projection.
      await deliver(naming(paidEvent));
      expect(traces(order.id), 'the order stored PAID in its business: one journey touchpoint, one calendar projection').toEqual({
        touchpoints: [`A:contact:order_paid:${ORDER_TOTAL}`],
        projections: ['A:marketplace_order:SHIPMENT'],
      });
    } finally {
      await settle();
      await listenerApp.close();
    }
  });

  it('V18-T2c (W10-STORE-ORDER-PAID, D-112, was it.todo; W9-STORE-PAID-LISTENERS review STL-SEC-1, D-18) a STANDARD order not created paid is marked PAID (PATCH .../status with paymentStatus PAID, the fulfil mark_paid action) only by a member with revenue write, through the paid door: a revenue:read STAFF member and a call with no member get 403 with nothing written and no store_order.paid; the owner gets one PAID invoice INV-<orderNumber>, one SUCCESSFUL payment the owner recorded and one balanced posting, and one store_order.paid naming the invoice (no INV-ORD invoice); a second marking writes nothing, an order with no customer to invoice is 400, and fulfilment status changes stay open to the STAFF member', async () => {
    const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
    const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
    const market = app.get(MarketplaceService);
    // The route handlers over the suite's real MarketplaceService: the actor is the signed-in member, never a body field.
    const controller = new (MarketplaceController as any)(market, {}, {});
    const signedIn = (userId: string | null) => ({ user: userId ? { id: userId } : undefined });
    const statusOf = (work: Promise<unknown>) =>
      work.then(
        () => 200,
        (err: any) => (typeof err?.getStatus === 'function' ? err.getStatus() : `${err?.name}: ${err?.message}`),
      );
    // A revenue:read STAFF member of the business (the STAFF role default).
    const STAFF = `${P}staff_t2c`;
    await db.user.create({ data: { id: STAFF, email: `${P}staff_t2c@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${STAFF}_m`, userId: STAFF, businessId: ID.biz, role: 'STAFF' } });
    // Fulfilment auto-routing runs un-awaited after mark_paid and is off this case's money path: held, and its call asserted.
    const routing = vi.spyOn(market as any, 'autoRouteOrder').mockImplementation(() => undefined);
    const standard = (suffix: string, customer: { customerEmail?: string } = { customerEmail: CUSTOMER_EMAIL }) =>
      db.marketplaceOrder.create({
        data: {
          businessId: ID.biz,
          orderNumber: `${P}std_t2c_${suffix}`,
          type: 'STANDARD',
          status: 'placed',
          paymentStatus: 'UNPAID',
          customerName: 'Vee Eighteen',
          ...customer,
          subtotal: ORDER_TOTAL,
          total: ORDER_TOTAL,
          currency: 'TTD',
          items: { create: [{ productId: ID.product, name: 'V18A Widget', quantity: QUANTITY, unitPrice: UNIT_PRICE, total: ORDER_TOTAL }] },
        },
      });
    const shape = async (id: string) => {
      const stored = await db.marketplaceOrder.findUnique({ where: { id } });
      return `${stored.status}/${stored.paymentStatus}`;
    };
    const paidEvents = () => seen.filter((e) => e.name === 'store_order.paid').map((e) => `${e.payload?.order?.id}:${e.payload?.invoiceId}`);

    try {
      const patchOrder = await standard('patch');
      const markOrder = await standard('mark');
      seen = [];
      const before = await counts();

      // Refused (403): a revenue:read STAFF member and a call with no member. At the base each was 200 paid/PAID with
      // no invoice and no payment, its store_order.paid made the listener write a raw PAID INV-ORD invoice, and the
      // V18-T2 listeners (webhook, paid timeline entry, routing) followed.
      for (const actor of [STAFF, null]) {
        expect(
          await statusOf(controller.updateOrderStatus(ID.biz, patchOrder.id, { status: 'paid', paymentStatus: 'PAID' }, signedIn(actor))),
          `PATCH .../status paid/PAID as ${actor}`,
        ).toBe(403);
        expect(
          await statusOf(controller.fulfillOrder(ID.biz, markOrder.id, { action: 'mark_paid', paymentMethod: 'CASH' }, signedIn(actor))),
          `POST .../fulfill mark_paid as ${actor}`,
        ).toBe(403);
      }
      await settle();
      expect([await shape(patchOrder.id), await shape(markOrder.id)], 'refused: the orders as they were').toEqual(['placed/UNPAID', 'placed/UNPAID']);
      expect(await counts(), 'refused: no invoice, payment or posting').toEqual(before);
      expect(storeEvents(), 'refused: no store_order.paid').toEqual([]);
      expect(routing, 'refused: nothing routed').not.toHaveBeenCalled();

      // Fulfilment status changes stay open to the STAFF member (D-112), and write no money.
      const moved = await controller.updateOrderStatus(ID.biz, patchOrder.id, { status: 'awaiting_payment' }, signedIn(STAFF));
      const confirmed = await controller.fulfillOrder(ID.biz, markOrder.id, { action: 'confirm' }, signedIn(STAFF));
      await settle();
      expect([`${moved.status}/${moved.paymentStatus}`, `${confirmed.status}/${confirmed.paymentStatus}`]).toEqual([
        'awaiting_payment/UNPAID',
        'awaiting_payment/UNPAID',
      ]);
      expect(await counts(), 'a status change writes no money').toEqual(before);

      // The owner (revenue write): PATCH .../status with paymentStatus PAID goes through the paid door.
      seen = [];
      const patched = await controller.updateOrderStatus(
        ID.biz,
        patchOrder.id,
        { status: 'paid', paymentStatus: 'PAID', paymentMethod: 'BANK_TRANSFER' },
        signedIn(ID.owner),
      );
      await settle();
      expect(`${patched.status}/${patched.paymentStatus}`).toBe('paid/PAID');
      const viaPatch = await expectOnePaidInvoice(patchOrder);
      expect(`${viaPatch.payment.provider}:${viaPatch.payment.method}:${viaPatch.payment.recordedBy}`, 'the payment names its method and the member').toBe(
        `bank_transfer:bank_transfer:${ID.owner}`,
      );
      expect(paidEvents(), 'one store_order.paid naming the invoice').toEqual([`${patchOrder.id}:${viaPatch.invoice.id}`]);

      // ... and so does the fulfil mark_paid action, which still routes the paid order and notes the step.
      seen = [];
      const marked = await controller.fulfillOrder(
        ID.biz,
        markOrder.id,
        { action: 'mark_paid', paymentMethod: 'CASH', note: 'cash at the counter' },
        signedIn(ID.owner),
      );
      await settle();
      expect(`${marked.status}/${marked.paymentStatus}`).toBe('paid/PAID');
      const viaMark = await expectOnePaidInvoice(markOrder);
      expect(`${viaMark.payment.provider}:${viaMark.payment.method}:${viaMark.payment.recordedBy}`).toBe(`cash:cash:${ID.owner}`);
      expect(paidEvents(), 'one store_order.paid naming the invoice').toEqual([`${markOrder.id}:${viaMark.invoice.id}`]);
      expect(routing, 'mark_paid routes the paid order').toHaveBeenCalledWith(ID.biz, markOrder.id, true);
      const timeline = (((await db.marketplaceOrder.findUnique({ where: { id: markOrder.id } })).metadata as any)?.statusTimeline ?? []) as any[];
      expect(timeline[timeline.length - 1], 'the fulfilment timeline notes the paid step').toMatchObject({ status: 'paid', note: 'cash at the counter' });

      // A second marking writes nothing: the order's money is on its checkout invoice now (400). An order with no
      // customer to make the invoice out to is refused (400) before anything is written.
      const after = await counts();
      seen = [];
      expect(await statusOf(controller.fulfillOrder(ID.biz, markOrder.id, { action: 'mark_paid' }, signedIn(ID.owner))), 'mark_paid again').toBe(400);
      expect(
        await statusOf(controller.updateOrderStatus(ID.biz, patchOrder.id, { status: 'paid', paymentStatus: 'PAID' }, signedIn(ID.owner))),
        'PATCH paid/PAID again',
      ).toBe(400);
      const anonymous = await standard('anon', {});
      expect(
        await statusOf(controller.updateOrderStatus(ID.biz, anonymous.id, { status: 'paid', paymentStatus: 'PAID' }, signedIn(ID.owner))),
        'PATCH paid/PAID with no customer',
      ).toBe(400);
      expect(await statusOf(controller.fulfillOrder(ID.biz, anonymous.id, { action: 'mark_paid' }, signedIn(ID.owner))), 'mark_paid with no customer').toBe(400);
      await settle();
      expect(await shape(anonymous.id)).toBe('placed/UNPAID');
      expect(await counts(), 'nothing more written').toEqual(after);
      expect(storeEvents(), 'no further store_order.paid').toEqual([]);
    } finally {
      routing.mockRestore();
    }
  });

  it('V18-T2d (W10-STORE-ORDER-PAID review SEC-SOP-1, SEC-SOP-4; D-112, D-46) PATCH .../status takes plain strings and writing any payment field takes revenue write: a Prisma operation object ({"set":"PAID"} as paymentStatus, an object status, method or reference, also from the owner and in mark_paid) or a missing status is 400, and a revenue:read STAFF member writing paymentStatus COMPLETED or REFUNDED, a method or a reference is 403, with nothing written and no store_order event; the order stays an open payable, its status alone still moves, and the owner then marks it paid through the paid door', async () => {
    const { controller } = await marketRoutes();
    const STAFF = await memberOfA('staff_t2d');
    const order = await standardOrderOfA('t2d');
    const before = await counts();
    const shape = await orderShape(order.id);
    seen = [];

    // At 3181cbb0 the first was 200 paid/PAID for the STAFF member with no payment, and the listener added a raw PAID
    // INV-ORD invoice, its notification and its timeline event (review probe REVIEW-1).
    const malformed: Array<[string, Record<string, unknown>]> = [
      [STAFF, { status: 'paid', paymentStatus: { set: 'PAID' } }],
      [ID.owner, { status: 'paid', paymentStatus: { set: 'PAID' } }],
      [STAFF, { status: { set: 'refunded' } }],
      [STAFF, { status: 'placed', paymentMethod: { set: 'CASH' } }],
      [STAFF, { status: 'placed', paymentRef: ['x'] }],
      [STAFF, { status: 'placed', paymentStatus: null }],
      [STAFF, { paymentStatus: 'UNPAID' }],
    ];
    for (const [actor, body] of malformed) {
      expect(await answered(controller.updateOrderStatus(ID.biz, order.id, body, signedIn(actor))), `PATCH ${JSON.stringify(body)} as ${actor}`).toBe(400);
    }
    expect(
      await answered(controller.fulfillOrder(ID.biz, order.id, { action: 'mark_paid', paymentRef: { set: 'x' } }, signedIn(ID.owner))),
      'mark_paid with an object reference',
    ).toBe(400);
    // At 3181cbb0 each was 200 and stored as sent: COMPLETED and REFUNDED took the order off the open payables, and
    // REFUNDED made the owner's paid door answer 409 (review probe REVIEW-2).
    for (const body of [
      { status: 'placed', paymentStatus: 'COMPLETED' },
      { status: 'placed', paymentStatus: 'REFUNDED' },
      { status: 'placed', paymentMethod: 'BANK_TRANSFER' },
      { status: 'placed', paymentRef: `${P}staff_ref` },
      { status: 'placed', paymentRef: null },
    ]) {
      expect(await answered(controller.updateOrderStatus(ID.biz, order.id, body, signedIn(STAFF))), `PATCH ${JSON.stringify(body)} as STAFF`).toBe(403);
    }
    await settle();
    expect(await orderShape(order.id), 'the order as it was').toEqual(shape);
    expect(await counts(), 'no invoice, payment or posting').toEqual(before);
    expect(storeEvents(), 'no store_order event').toEqual([]);
    expect(await paidTraces(ID.biz, order.id)).toMatchObject({ notifications: 0, timeline: 0 });
    // PaymentsOpsService.listOpenPayables' order filter (payments-ops.service.ts): still an open payable.
    const open = await db.marketplaceOrder.count({
      where: { id: order.id, paymentStatus: { notIn: ['PAID', 'REFUNDED', 'COMPLETED'] }, status: { not: 'CANCELLED' } },
    });
    expect(open, 'still an open payable').toBe(1);

    // Controls: its status alone still moves for the STAFF member (D-112), and the owner marks it paid through the door.
    const moved = await controller.updateOrderStatus(ID.biz, order.id, { status: 'awaiting_payment' }, signedIn(STAFF));
    expect(`${moved.status}/${moved.paymentStatus}`).toBe('awaiting_payment/UNPAID');
    seen = [];
    const paid = await controller.updateOrderStatus(ID.biz, order.id, { status: 'paid', paymentStatus: 'PAID', paymentMethod: 'CASH' }, signedIn(ID.owner));
    await settle();
    expect(`${paid.status}/${paid.paymentStatus}/${paid.paymentMethod}`).toBe('paid/PAID/CASH');
    const { invoice } = await expectOnePaidInvoice(order);
    expect(seen.filter((e) => e.name === 'store_order.paid').map((e) => e.payload?.invoiceId)).toEqual([invoice.id]);
  });

  it('V18-T2e (W10-STORE-ORDER-PAID review SEC-SOP-2, SEC-SOP-3; D-112) a status change records no payment, so it emits no store_order.paid: a revenue:read STAFF member\'s PATCH .../status paid on an order stored UNPAID starts none of the business\'s "order paid" automations (AgentTriggerService reads every event on the bus), and PATCH paid on an order stored PAID outside the paid door (the Shopify sync\'s shape), twice, writes no invoice, notification or paid timeline event; control: the owner\'s marking through the paid door emits one store_order.paid naming its invoice and starts the automation once', async () => {
    const { controller } = await marketRoutes();
    // (Importing AgentTriggerService transforms the AI module graph, about 4 s: this case has a 30 s timeout.)
    const { AgentTriggerService } = await import('../src/modules/ai/agent-trigger.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const STAFF = await memberOfA('staff_t2e');
    // The real AgentTriggerService over the suite's rows and bus, wired as its onModuleInit wires it (every event but
    // plan.*), so it can be unwired after this case; its planner records the plans it is asked for.
    const plans: Array<{ businessId: string; scope: unknown }> = [];
    const agent = new (AgentTriggerService as any)(
      app.get(PrismaService),
      events,
      { evaluateAutoApproval: async () => ({ autoApproved: false }) },
      {
        createPlan: async (businessId: string, input: { scope: unknown }) => {
          plans.push({ businessId, scope: input.scope });
          return { id: `${P}t2e_plan` };
        },
      },
      {},
      { log: async () => null },
      { handleEvent: async () => [] },
    );
    const relay = (name: string | string[], payload: unknown) => {
      if (typeof name === 'string' && !name.startsWith('plan.')) inflight.push(agent.handleEvent(name, payload));
    };
    events.onAny(relay);
    await db.agentTrigger.create({
      data: { businessId: ID.biz, name: 'V18-T2e when an order is paid', eventPattern: 'store_order.paid', objective: 'Thank the customer', enabled: true },
    });
    try {
      const unpaid = await standardOrderOfA('t2e_unpaid');
      seen = [];
      const patched = await controller.updateOrderStatus(ID.biz, unpaid.id, { status: 'paid' }, signedIn(STAFF));
      await settle();
      expect(`${patched.status}/${patched.paymentStatus}`, 'the status moves (open to every member)').toBe('paid/UNPAID');
      expect(storeEvents(), 'no store_order.paid').toEqual([]);
      // At 3181cbb0: a plan for business A, scope ['store_order.paid'] (review probe REVIEW-6).
      expect(plans, 'no "order paid" automation for an unpaid order').toEqual([]);

      // An order stored PAID with no checkout invoice: shopify.service.ts writes PAID for an order paid at Shopify.
      const synced = await standardOrderOfA('t2e_synced', { paymentStatus: 'PAID', metadata: { source: 'shopify' } });
      const before = await counts();
      for (const round of [1, 2]) {
        const res = await controller.updateOrderStatus(ID.biz, synced.id, { status: 'paid' }, signedIn(STAFF));
        await settle();
        expect(`${res.status}/${res.paymentStatus}`, `PATCH paid, round ${round}`).toBe('paid/PAID');
      }
      // At 3181cbb0: a raw PAID INV-ORD invoice, and a notification and a timeline event for each call (REVIEW-4).
      expect(storeEvents(), 'no store_order.paid').toEqual([]);
      expect(await invoicesOf(synced), 'no INV-ORD invoice').toEqual([]);
      expect(await counts()).toEqual(before);
      expect(await paidTraces(ID.biz, synced.id)).toMatchObject({ notifications: 0, timeline: 0 });
      expect(plans).toEqual([]);

      // Control: the owner marks the unpaid order PAID through the paid door.
      seen = [];
      await controller.updateOrderStatus(ID.biz, unpaid.id, { status: 'paid', paymentStatus: 'PAID' }, signedIn(ID.owner));
      await settle();
      const { invoice } = await expectOnePaidInvoice(unpaid);
      expect(seen.filter((e) => e.name === 'store_order.paid').map((e) => e.payload?.invoiceId), 'one store_order.paid, naming the invoice').toEqual([invoice.id]);
      expect(plans, 'the automation starts once').toEqual([{ businessId: ID.biz, scope: ['store_order.paid'] }]);
    } finally {
      events.offAny(relay);
      await settle();
      await db.agentTrigger.deleteMany({ where: { businessId: ID.biz } });
    }
  }, 30_000);

  it('V18-T2f (W10-STORE-ORDER-PAID review CR-W10SOP-1, CR-W10SOP-4; D-112) what a marking writes on the order is written before the paid door emits store_order.paid: with StoreOrderRoutingListener routing each paid order as the event fires, every order keeps both its mark_paid step and the routing steps; a marking the door refuses takes its step and the customer it named back; the member\'s payment reference is the order\'s paymentRef again (PATCH and mark_paid), while the payment keeps the door\'s unique reference', async () => {
    const { market, controller } = await marketRoutes();
    const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
    const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    // mark_paid's own un-awaited auto-routing is held (another writer, at the base too); the routing listener, a
    // { async: true } listener (it starts on a later tick), runs for real on the suite's bus over the suite's rows.
    const routing = vi.spyOn(market as any, 'autoRouteOrder').mockImplementation(() => undefined);
    const listener = new (StoreOrderRoutingListener as any)(app.get(PrismaService), app.get(FulfillmentRoutingService), events);
    const onPaid = (payload: unknown) => {
      inflight.push(new Promise((resolve) => setImmediate(() => resolve(listener.onStoreOrderPaid(payload)))));
    };
    events.on('store_order.paid', onPaid);
    try {
      // At 3181cbb0 the 'paid' step was written after the event and read-modify-wrote the timeline the listener
      // rewrote at the same time: one of the two was lost (review probe: the paid step in 1 of 6, the routing steps in 2).
      for (const n of [1, 2, 3, 4, 5, 6]) {
        const order = await standardOrderOfA(`t2f_${n}`);
        const marked = await controller.fulfillOrder(ID.biz, order.id, { action: 'mark_paid', paymentMethod: 'CASH', note: `cash ${n}` }, signedIn(ID.owner));
        expect(marked.paymentStatus).toBe('PAID');
        await settle();
        const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
        const timeline = ((stored.metadata as any)?.statusTimeline ?? []) as any[];
        expect(timeline.slice(0, 2).map((t) => `${t.status}:${t.note}`), `order ${n}: its mark_paid step`).toEqual(['placed:Order placed', `paid:cash ${n}`]);
        expect(timeline.map((t) => t.status), `order ${n}: the routing listener's steps`).toContain('routed');
        expect(stored.status, `order ${n}: routed`).toBe('routed');
      }
    } finally {
      events.off('store_order.paid', onPaid);
      await settle();
    }
    try {
      // A marking the door refuses leaves the order as it was: its mark_paid step (the door resolves no contact for
      // this customer: 400), and the customer a marking named for a cancelled walk-in order (the door: 409).
      const unknown = await standardOrderOfA('t2f_unknown', { customerEmail: `${P}nobody@test.local` });
      const cancelled = await standardOrderOfA('t2f_cancelled', { status: 'cancelled', customerEmail: null });
      const before = await counts();
      const shapes = [await orderShape(unknown.id), await orderShape(cancelled.id)];
      seen = [];
      expect(await answered(controller.fulfillOrder(ID.biz, unknown.id, { action: 'mark_paid', note: 'refused' }, signedIn(ID.owner))), 'no contact').toBe(400);
      expect(
        await answered(
          controller.updateOrderStatus(ID.biz, cancelled.id, { status: 'paid', paymentStatus: 'PAID', customerEmail: CUSTOMER_EMAIL }, signedIn(ID.owner)),
        ),
        'a cancelled order',
      ).toBe(409);
      await settle();
      expect([await orderShape(unknown.id), await orderShape(cancelled.id)], 'the orders as they were').toEqual(shapes);
      expect(await counts()).toEqual(before);
      expect(storeEvents()).toEqual([]);

      // CR-W10SOP-4: the member's own reference. At 3181cbb0 PATCH dropped it (the order's paymentRef was the door's
      // marketplace_paid_<id>_<hex>, and it was not noted anywhere).
      const viaPatch = await standardOrderOfA('t2f_ref_patch');
      await controller.updateOrderStatus(
        ID.biz,
        viaPatch.id,
        { status: 'paid', paymentStatus: 'PAID', paymentMethod: 'BANK_TRANSFER', paymentRef: `${P}bankref_77` },
        signedIn(ID.owner),
      );
      await settle();
      const patched = await expectOnePaidInvoice(viaPatch);
      expect((await orderShape(viaPatch.id)).row).toBe(`paid/PAID/BANK_TRANSFER/${P}bankref_77/${CUSTOMER_EMAIL}`);
      expect(patched.payment.providerPaymentId, 'the payment keeps the door\'s unique reference').toMatch(new RegExp(`^marketplace_paid_${viaPatch.id}_`));
      const viaMark = await standardOrderOfA('t2f_ref_mark');
      await controller.fulfillOrder(ID.biz, viaMark.id, { action: 'mark_paid', paymentMethod: 'CASH', paymentRef: `${P}receipt_12` }, signedIn(ID.owner));
      await settle();
      await expectOnePaidInvoice(viaMark);
      const markedRow = await db.marketplaceOrder.findUnique({ where: { id: viaMark.id } });
      expect(`${markedRow.paymentMethod}/${markedRow.paymentRef}`).toBe(`CASH/${P}receipt_12`);
      const steps = ((markedRow.metadata as any)?.statusTimeline ?? []) as any[];
      expect(steps[steps.length - 1], 'the mark_paid step notes it too').toMatchObject({ status: 'paid', reference: `${P}receipt_12` });
    } finally {
      routing.mockRestore();
    }
  });

  it('V18-T2g (W10-STORE-ORDER-PAID review CR-W10SOP-5; D-112) the orders the paid door refused for good are marked PAID through it: an order totalling 0 records a PAID invoice and a SUCCESSFUL payment of 0 by the member (nothing to post), and a walk-in order with no customer email or phone is given one with the marking (customerEmail, by mark_paid or PATCH), its invoice made out to that customer; with none, or one that is not an email or a phone, it is 400 and nothing is written, and a revenue:read member is 403; an order\'s own customer is never replaced', async () => {
    const { market, controller } = await marketRoutes();
    const routing = vi.spyOn(market as any, 'autoRouteOrder').mockImplementation(() => undefined);
    try {
      // A zero total (a 100% discount). At 3181cbb0: 400 "this order totals 0", and nothing else marks an order PAID.
      const free = await standardOrderOfA('t2g_free', { discountAmount: ORDER_TOTAL, total: 0 });
      seen = [];
      const freeMarked = await controller.fulfillOrder(ID.biz, free.id, { action: 'mark_paid', paymentMethod: 'CASH' }, signedIn(ID.owner));
      await settle();
      expect(`${freeMarked.status}/${freeMarked.paymentStatus}`).toBe('paid/PAID');
      const freeInvoices = await invoicesOf(free);
      expect(freeInvoices.map((i) => `${i.invoiceNumber}:${i.status}:${Number(i.total)}`)).toEqual([`INV-${free.orderNumber}:PAID:0`]);
      const freePayments = await paymentsOf(freeInvoices.map((i) => i.id));
      expect(freePayments.map((p) => `${p.status}:${Number(p.amount)}:${p.recordedBy}`)).toEqual([`SUCCESSFUL:0:${ID.owner}`]);
      expect(await postingsOf([freeInvoices[0].id, freePayments[0].id]), 'nothing to post for 0').toEqual([]);
      expect(seen.filter((e) => e.name === 'store_order.paid').map((e) => e.payload?.invoiceId)).toEqual([freeInvoices[0].id]);

      // A walk-in order: no customer email or phone (createOrder allows it for an order not created paid).
      const walkIn = await standardOrderOfA('t2g_walkin', { customerName: 'Walk-in', customerEmail: null });
      const STAFF = await memberOfA('staff_t2g');
      const before = await counts();
      const shape = await orderShape(walkIn.id);
      seen = [];
      for (const body of [{}, { customerEmail: 'not an email' }, { customerEmail: { set: CUSTOMER_EMAIL } }, { customerPhone: '12' }]) {
        expect(
          await answered(controller.fulfillOrder(ID.biz, walkIn.id, { action: 'mark_paid', ...body }, signedIn(ID.owner))),
          `mark_paid ${JSON.stringify(body)}`,
        ).toBe(400);
      }
      expect(
        await answered(controller.updateOrderStatus(ID.biz, walkIn.id, { status: 'paid', paymentStatus: 'PAID' }, signedIn(ID.owner))),
        'PATCH with no customer',
      ).toBe(400);
      expect(
        await answered(controller.fulfillOrder(ID.biz, walkIn.id, { action: 'mark_paid', customerEmail: CUSTOMER_EMAIL }, signedIn(STAFF))),
        'a revenue:read member naming a customer',
      ).toBe(403);
      await settle();
      expect(await orderShape(walkIn.id), 'the order as it was').toEqual(shape);
      expect(await counts()).toEqual(before);
      expect(storeEvents()).toEqual([]);

      const marked = await controller.fulfillOrder(
        ID.biz,
        walkIn.id,
        { action: 'mark_paid', paymentMethod: 'CASH', customerEmail: CUSTOMER_EMAIL },
        signedIn(ID.owner),
      );
      await settle();
      expect(`${marked.status}/${marked.paymentStatus}/${marked.customerEmail}`).toBe(`paid/PAID/${CUSTOMER_EMAIL}`);
      const { invoice } = await expectOnePaidInvoice(walkIn);
      expect(invoice.contactId, 'the invoice is made out to the customer named').toBe(ID.contact);

      // PATCH .../status names one the same way; an order's own customer is never replaced by a marking.
      const walkInPatch = await standardOrderOfA('t2g_walkin_patch', { customerName: 'Walk-in', customerEmail: null });
      await controller.updateOrderStatus(ID.biz, walkInPatch.id, { status: 'paid', paymentStatus: 'PAID', customerEmail: CUSTOMER_EMAIL }, signedIn(ID.owner));
      await settle();
      await expectOnePaidInvoice(walkInPatch);
      const own = await standardOrderOfA('t2g_own');
      await controller.fulfillOrder(ID.biz, own.id, { action: 'mark_paid', customerEmail: `${P}someone_else@test.local` }, signedIn(ID.owner));
      await settle();
      expect((await db.marketplaceOrder.findUnique({ where: { id: own.id } })).customerEmail).toBe(CUSTOMER_EMAIL);
      await expectOnePaidInvoice(own);
    } finally {
      routing.mockRestore();
    }
  });

  it('V18-T2h (W10-STORE-ORDER-PAID review CR-W10SOP-2; D-112, D-14) an order marked paid through the paid door is refunded through the D-14 refund door: a partial refundAmount is 400 with nothing written (the door refunds in full; before D-112 it booked an Expense of the amount), and the full refund is a negative REFUNDED row naming the refunder, the posting reversed, the invoice back to SENT, the order REFUNDED, one store_order.refunded and no Expense', async () => {
    const { market, controller } = await marketRoutes();
    const routing = vi.spyOn(market as any, 'autoRouteOrder').mockImplementation(() => undefined);
    try {
      const order = await standardOrderOfA('t2h');
      await controller.fulfillOrder(ID.biz, order.id, { action: 'mark_paid', paymentMethod: 'CASH' }, signedIn(ID.owner));
      await settle();
      const { invoice, payment } = await expectOnePaidInvoice(order);
      const before = await counts();
      const shape = await orderShape(order.id);
      seen = [];
      expenses.length = 0;

      expect(
        await answered(controller.fulfillOrder(ID.biz, order.id, { action: 'refund', refundAmount: 30 }, signedIn(ID.owner))),
        'a partial refund',
      ).toBe(400);
      await settle();
      expect(await orderShape(order.id), 'the order as it was').toEqual(shape);
      expect(await counts()).toEqual(before);
      expect(storeEvents()).toEqual([]);
      expect(expenses).toEqual([]);

      await controller.fulfillOrder(ID.biz, order.id, { action: 'refund', reason: 'returned' }, signedIn(ID.owner));
      await settle();
      const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
      expect(`${stored.status}/${stored.paymentStatus}`.toUpperCase()).toBe('REFUNDED/REFUNDED');
      const rows = await paymentsOf([invoice.id]);
      expect(rows.map((p) => `${p.status}:${Number(p.amount)}:${p.recordedBy}`), 'the original kept, one negative refund row').toEqual([
        `SUCCESSFUL:${ORDER_TOTAL}:${ID.owner}`,
        `REFUNDED:${-ORDER_TOTAL}:${ID.owner}`,
      ]);
      expect(rows[1].reference, 'the refund links to the payment').toBe(payment.providerPaymentId);
      const reopened = await db.invoice.findUnique({ where: { id: invoice.id } });
      expect(`${reopened.status}/${reopened.paidAt}`).toBe('SENT/null');
      const postings = await postingsOf([invoice.id, payment.id, rows[1].id]);
      const depositNet = money(
        postings
          .flatMap((t: any) => t.entries)
          .filter((e: any) => DEPOSIT_KEYS.has(e.account?.systemKey))
          .reduce((s: number, e: any) => s + Number(e.debit ?? 0) - Number(e.credit ?? 0), 0),
      );
      expect(depositNet, 'the cash taken is given back on the ledger').toBe(0);
      expect(storeEvents().filter((n) => n === 'store_order.refunded'), 'one store_order.refunded').toHaveLength(1);
      expect(expenses, 'no Expense: the refund is on the invoice').toEqual([]);
    } finally {
      routing.mockRestore();
    }
  });

  it('V18-T2k (W10-SOP-FIX, SOP-V1; D-112) three mark_paid calls racing on one UNPAID STANDARD order record one payment and run the work after the paid door once: each is answered 200 with the order PAID (a concurrent double click is not an error), and the order has one PAID invoice, one SUCCESSFUL payment, one posting and one store_order.paid; only the marking that recorded the payment routes the order (routeOrder once: one LOCAL_STOCK RESERVED fulfillment route, one routing step) and tells the customer (one order_confirmed email), and the markings that recorded nothing take their own timeline step back', async () => {
    const { controller } = await marketRoutes();
    const routeOrder = await trackRouting();
    const email = await captureEmails();
    // All three reach the paid door having read the order UNPAID; the door records the payment for one of them.
    const door = holdPaidDoor(3);
    try {
      const order = await standardOrderOfA('t2k');
      seen = [];
      const answers = await Promise.allSettled(
        [1, 2, 3].map((n) =>
          controller.fulfillOrder(
            ID.biz,
            order.id,
            { action: 'mark_paid', paymentMethod: 'CASH', paymentRef: `${P}click_${n}`, note: `click ${n}` },
            signedIn(ID.owner),
          ),
        ),
      );
      await drain();
      expect(
        answers.map((a) => (a.status === 'fulfilled' ? `200:${a.value.paymentStatus}` : `${a.reason?.getStatus?.() ?? a.reason}`)),
        'each marking is answered with the paid order',
      ).toEqual(['200:PAID', '200:PAID', '200:PAID']);

      await expectOnePaidInvoice(order);
      expect(
        seen.filter((e) => e.name === 'store_order.paid' && e.payload?.order?.id === order.id),
        'one store_order.paid',
      ).toHaveLength(1);
      expect((await paidTraces(ID.biz, order.id)).notifications, 'one "Order Payment Received" notification').toBe(1);

      // At 6470942a each marking ran autoRouteOrder: routeOrder once per call, one LOCAL_STOCK RESERVED route each
      // (stock and reserved then drop once per route at ship; a DROPSHIP listing raises one supplier PO per route).
      expect(routeOrder, 'the order is routed by the marking that recorded the payment only').toHaveBeenCalledTimes(1);
      const routes = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
      expect(routes.map((r: any) => `${r.strategy}:${r.status}`), 'one fulfillment route').toEqual(['LOCAL_STOCK:RESERVED']);
      // ... and each sent the paid notification: duplicate order_confirmed emails to the customer.
      const confirmed = email.sent.filter((m) => m.type === 'order_confirmed' && m.templateData?.orderNumber === order.orderNumber);
      expect(confirmed, 'one order_confirmed email').toHaveLength(1);

      const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
      const steps = ((stored.metadata as any)?.statusTimeline ?? []) as any[];
      const markingSteps = steps.filter((t) => t.status === 'paid' && /^click \d$/.test(t.note ?? ''));
      expect(markingSteps.map((t) => t.reference), "the recorder's marking step only").toEqual([stored.paymentRef]);
      expect(stored.paymentRef, "the recorder's own reference").toMatch(new RegExp(`^${P}click_\\d$`));
      expect(steps.filter((t) => t.note === 'Order paid — routing fulfillment'), 'one routing step').toHaveLength(1);
    } finally {
      door.mockRestore();
      routeOrder.mockRestore();
      email.restore();
      await drain();
    }
  });

  it('V18-T2l (W10-SOP-FIX, SOP-V2; D-112) a PATCH .../status carrying paymentStatus PAID that loses the paid door to a concurrent one announces nothing: in the race {status:"paid",paymentStatus:"PAID"} vs {status:"shipped",paymentStatus:"PAID"} where the paid one records the payment (the shipped one meeting its invoice, or reading the order already PAID), the shipped one is answered with the order as stored (paid/PAID) and emits no store_order.shipped (no shipped notification, contact event or shipping Expense); control: where the shipped one records the payment, one store_order.shipped and one shipping Expense', async () => {
    const { controller } = await marketRoutes();
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const crm = app.get(CrmService) as Record<string, any>;
    const patch = (orderId: string, status: string) =>
      controller.updateOrderStatus(ID.biz, orderId, { status, paymentStatus: 'PAID', paymentMethod: 'CASH' }, signedIn(ID.owner));
    /**
     * Both PATCHes reach the paid door having read the order UNPAID. `winner` records the payment. Path 'invoice':
     * the loser goes through the door first and reads the order UNPAID, its contact resolution held until the winner
     * has recorded the payment, so its own INV-<orderNumber> meets the winner's (P2002). Path 'paid-read': the loser
     * goes through the door after the winner and reads the order PAID.
     */
    const race = async (orderId: string, winner: 'paid' | 'shipped', path: 'invoice' | 'paid-read') => {
      const realResolve = crm.findOrCreateContact;
      let loserRead!: () => void;
      const loserIn = new Promise<void>((resolve) => (loserRead = resolve));
      let winnerDone!: () => void;
      const recorded = new Promise<void>((resolve) => (winnerDone = resolve));
      let held = false;
      crm.findOrCreateContact = async (...args: unknown[]) => {
        if (path === 'invoice' && !held) {
          held = true;
          loserRead();
          await recorded;
        }
        return realResolve(...args);
      };
      const door = holdPaidDoor(2, async (input, real) => {
        if (input.paidStatus === winner) {
          if (path === 'invoice') await loserIn;
          try {
            return await real(input);
          } finally {
            winnerDone();
          }
        }
        if (path === 'paid-read') await recorded;
        return real(input);
      });
      try {
        const [paid, shipped] = await Promise.all([patch(orderId, 'paid'), patch(orderId, 'shipped')]);
        await settle();
        return { paid: `${paid.status}/${paid.paymentStatus}`, shipped: `${shipped.status}/${shipped.paymentStatus}` };
      } finally {
        door.mockRestore();
        crm.findOrCreateContact = realResolve;
      }
    };
    const shippedTraces = async (orderId: string) => ({
      events: seen.filter((e) => e.name === 'store_order.shipped' && e.payload?.order?.id === orderId).length,
      notifications: (await db.notification.findMany({ where: { businessId: ID.biz, type: 'store_order.shipped' }, select: { data: true } }))
        .filter((n: any) => n.data?.orderId === orderId).length,
      contactEvents: contactEvents.filter((e) => e.orderId === orderId && e.type === 'store_order.shipped').length,
      expenses: expenses.filter((e) => e.notes === `order:${orderId}`).length,
    });
    for (const path of ['invoice', 'paid-read'] as const) {
      // At 6470942a the shipped PATCH lost the door, its 'shipped' was not written, and it still emitted
      // store_order.shipped with the order as stored: CommerceIntegrationService.handleOrderShipped wrote its
      // notification and contact event and booked the shipping fee as a PAID Expense, for an order not shipped.
      const order = await standardOrderOfA(`t2l_${path}`, { shippingFee: 15 });
      seen = [];
      const answered = await race(order.id, 'paid', path);
      expect(answered, `${path}: the losing PATCH answers the order as stored`).toEqual({ paid: 'paid/PAID', shipped: 'paid/PAID' });
      const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
      expect(`${stored.status}/${stored.paymentStatus}`, `${path}: stored`).toBe('paid/PAID');
      await expectOnePaidInvoice(order);
      expect(seen.filter((e) => e.name === 'store_order.paid' && e.payload?.order?.id === order.id), `${path}: one store_order.paid`).toHaveLength(1);
      expect(await shippedTraces(order.id), `${path}: nothing announced for the PATCH that recorded nothing`).toEqual({
        events: 0,
        notifications: 0,
        contactEvents: 0,
        expenses: 0,
      });
    }

    // Control: the shipped PATCH records the payment; the paid one loses (and has no lifecycle event of its own).
    const order = await standardOrderOfA('t2l_control', { shippingFee: 15 });
    seen = [];
    const answered = await race(order.id, 'shipped', 'invoice');
    expect(answered, 'control: both answer the order as stored').toEqual({ paid: 'shipped/PAID', shipped: 'shipped/PAID' });
    await expectOnePaidInvoice(order);
    expect(await shippedTraces(order.id), 'control: one store_order.shipped, from the PATCH that recorded the payment').toEqual({
      events: 1,
      notifications: 1,
      contactEvents: 1,
      expenses: 1,
    });
  });

  it('V18-T2m (W10-SOP-FIX, SOP-V4; D-112) with production wiring (StoreOrderRoutingListener on the bus, the real un-awaited autoRouteOrder, CommerceIntegrationService linking the contact) a single mark_paid keeps every timeline step: placed, the marking\'s paid step, mark_paid\'s routing step, the routing engine\'s routes_created and routed steps once each, the order routed with one fulfillment route, and the paid listener\'s contact link', async () => {
    const { controller } = await marketRoutes();
    const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
    const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const routeOrder = await trackRouting();
    // The routing listener ({ async: true }: it starts on a later tick) on the suite's bus, as T2f wires it.
    const listener = new (StoreOrderRoutingListener as any)(app.get(PrismaService), app.get(FulfillmentRoutingService), events);
    const onPaid = (payload: unknown) => {
      inflight.push(new Promise((resolve) => setImmediate(() => resolve(listener.onStoreOrderPaid(payload)))));
    };
    events.on('store_order.paid', onPaid);
    try {
      // At 6470942a writeMarking, autoRouteOrder, routeOrder (from both routers) and the paid listener's contact link
      // each read the order's metadata and wrote their copy back: the review lost steps in 4 of 5 single calls.
      for (const n of [1, 2, 3, 4, 5]) {
        const order = await standardOrderOfA(`t2m_${n}`);
        const marked = await controller.fulfillOrder(ID.biz, order.id, { action: 'mark_paid', paymentMethod: 'CASH', note: `cash ${n}` }, signedIn(ID.owner));
        expect(marked.paymentStatus).toBe('PAID');
        await drain();
        const stored = await db.marketplaceOrder.findUnique({ where: { id: order.id } });
        const steps = ((stored.metadata as any)?.statusTimeline ?? []) as any[];
        const described = steps.map((t) => `${t.status}:${t.note}`);
        expect(described.slice(0, 2), `order ${n}: placed, then its marking's step`).toEqual(['placed:Order placed', `paid:cash ${n}`]);
        expect(steps.filter((t) => t.note === 'Order paid — routing fulfillment'), `order ${n}: mark_paid's routing step (${described.join(' | ')})`).toHaveLength(1);
        expect(steps.filter((t) => t.status === 'routes_created'), `order ${n}: routes_created once (${described.join(' | ')})`).toHaveLength(1);
        expect(
          steps.filter((t) => t.status === 'routed' && t.note === 'Order routed — awaiting processing'),
          `order ${n}: routed once (${described.join(' | ')})`,
        ).toHaveLength(1);
        expect(stored.status, `order ${n}: routed`).toBe('routed');
        expect(await db.fulfillmentRoute.count({ where: { businessId: ID.biz, orderId: order.id } }), `order ${n}: one route`).toBe(1);
        expect((stored.metadata as any)?.links?.contactId, `order ${n}: the paid listener's contact link`).toBe(ID.contact);
      }
      expect(routeOrder, 'both routers ran (listener and mark_paid) for each order').toHaveBeenCalledTimes(10);
    } finally {
      events.off('store_order.paid', onPaid);
      routeOrder.mockRestore();
      await drain();
    }
  });

  /**
   * W10-SOP-FIX review (SOPFIX-SEC-1, SOPFIX-R1; D-112): an order is routed once however many routers reach it. The
   * routing engine claims the order before it reads its routes, so a router that meets an order being routed waits
   * and then takes the routes already made. Production wiring: StoreOrderRoutingListener on the suite's bus (as T2f
   * and T2m wire it) beside the real un-awaited autoRouteOrder, and every router that read no routes held where it
   * creates them (holdRouteCreation). At 53fb2438 every router read none, and each made its own routes.
   */
  const T2N = { drop: `${P}t2n_drop`, tracked: `${P}t2n_tracked`, warehouse: `${P}t2n_wh`, stock: `${P}t2n_stock` };
  let t2nFixtures: Promise<void> | undefined;
  /** A product with a DROPSHIP listing, and a tracked product with 10 in stock in a warehouse (made once). */
  const routingFixtures = () =>
    (t2nFixtures ??= (async () => {
      const { market } = await marketRoutes();
      await db.product.create({ data: { id: T2N.drop, businessId: ID.biz, name: 'V18A Dropship', price: 25, currency: 'TTD', category: 'PRODUCT', isActive: true } });
      await market.createListing(ID.biz, { productId: T2N.drop, fulfillmentStrategy: 'DROPSHIP', supplierName: 'V18A Supplier', supplierEmail: `${P}supplier@test.local` });
      await db.product.create({
        data: { id: T2N.tracked, businessId: ID.biz, name: 'V18A Tracked', price: 10, currency: 'TTD', category: 'PRODUCT', isActive: true, inventoryMode: 'tracked' },
      });
      await db.warehouse.create({ data: { id: T2N.warehouse, businessId: ID.biz, name: 'V18A Warehouse' } });
      await db.inventoryStock.create({ data: { id: T2N.stock, businessId: ID.biz, productId: T2N.tracked, warehouseId: T2N.warehouse, quantity: 10, reserved: 0 } });
    })());
  /** Both routers on: the routing listener on the suite's bus, routeOrder tracked (counted, drained). */
  async function bothRouters() {
    await routingFixtures();
    const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
    const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const routeOrder = await trackRouting();
    const listener = new (StoreOrderRoutingListener as any)(app.get(PrismaService), app.get(FulfillmentRoutingService), events);
    const onPaid = (payload: unknown) => {
      inflight.push(new Promise((resolve) => setImmediate(() => resolve(listener.onStoreOrderPaid(payload)))));
    };
    events.on('store_order.paid', onPaid);
    return {
      routeOrder,
      off: async () => {
        events.off('store_order.paid', onPaid);
        routeOrder.mockRestore();
        await drain();
      },
    };
  }
  const supplierPOs = (orderNumber: string) => db.purchaseOrder.findMany({ where: { businessId: ID.biz, notes: `Auto-generated for order ${orderNumber}` } });
  const routesOf = async (orderId: string) =>
    (await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId } })).map((r: any) => `${r.strategy}:${r.status}`);
  const stepsOf = async (orderId: string) =>
    ((((await db.marketplaceOrder.findUnique({ where: { id: orderId } })).metadata as any)?.statusTimeline ?? []) as any[]).map((t) => t.status);
  const createdPaid = async (productId: string) => {
    const { market } = await marketRoutes();
    return market.createOrder(
      ID.biz,
      { paymentOnCreation: true, paymentMethod: 'CASH', customerName: 'Vee Eighteen', customerEmail: CUSTOMER_EMAIL, items: [{ productId, quantity: 1 }] },
      ID.owner,
    );
  };

  it('V18-T2n (W10-SOP-FIX review SOPFIX-SEC-1, SOPFIX-R1; D-112) one mark_paid of an UNPAID STANDARD order with a DROPSHIP line, both routers reaching the routing engine (the door\'s store_order.paid listener and mark_paid\'s autoRouteOrder) and each held where it would create routes: one router creates them, so one supplier PurchaseOrder, one DROPSHIP PO_RAISED route, the order supplier_ordered and routes_created once', async () => {
    const { controller } = await marketRoutes();
    const routers = await bothRouters();
    const held = await holdRouteCreation('routeDropship', 2);
    try {
      const order = await standardOrderOfA('t2n_mark', {
        subtotal: 25,
        total: 25,
        items: { create: [{ productId: T2N.drop, name: 'V18A Dropship', quantity: 1, unitPrice: 25, total: 25 }] },
      });
      routers.routeOrder.mockClear();
      const marked = await controller.fulfillOrder(ID.biz, order.id, { action: 'mark_paid', paymentMethod: 'CASH', note: 't2n' }, signedIn(ID.owner));
      expect(marked.paymentStatus).toBe('PAID');
      await drain();
      expect(routers.routeOrder, 'both routers reached the routing engine').toHaveBeenCalledTimes(2);
      // At 53fb2438 both read no routes, and each raised a supplier PO and a DROPSHIP route (review: 1 of 20 and 1 of 40
      // orders unheld).
      expect((await supplierPOs(order.orderNumber)).length, 'one supplier PO').toBe(1);
      expect(await routesOf(order.id), 'one DROPSHIP route').toEqual(['DROPSHIP:PO_RAISED']);
      expect(held.arrivals(), 'one router created routes').toBe(1);
      expect((await db.marketplaceOrder.findUnique({ where: { id: order.id } })).status).toBe('supplier_ordered');
      expect((await stepsOf(order.id)).filter((s) => s === 'routes_created'), 'routes_created once').toHaveLength(1);
    } finally {
      held.restore();
      await routers.off();
    }
  });

  it('V18-T2n2 (W10-SOP-FIX review SOPFIX-SEC-1; D-112) an order created paid (paymentOnCreation) with a DROPSHIP line, both routers held where they would create routes: one supplier PurchaseOrder of the line\'s cost and one DROPSHIP route (the review saw 5 of 5 such orders raise two POs at 53fb2438)', async () => {
    const routers = await bothRouters();
    const held = await holdRouteCreation('routeDropship', 2);
    try {
      routers.routeOrder.mockClear();
      const order = await createdPaid(T2N.drop);
      await drain();
      expect(routers.routeOrder, 'both routers reached the routing engine').toHaveBeenCalledTimes(2);
      expect((await supplierPOs(order.orderNumber)).map((po: any) => po.total), 'one supplier PO').toEqual([25]);
      expect(await routesOf(order.id), 'one DROPSHIP route').toEqual(['DROPSHIP:PO_RAISED']);
      expect(held.arrivals(), 'one router created routes').toBe(1);
    } finally {
      held.restore();
      await routers.off();
    }
  });

  it('V18-T2n3 (W10-SOP-FIX review SOPFIX-SEC-1; D-112) an order created paid with a tracked line (10 in stock), both routers held where they would create routes: one LOCAL_STOCK RESERVED route in the stock\'s warehouse and one unit reserved (at 53fb2438 two routes each reserved the unit, the second writing reserved 1 over the first)', async () => {
    const routers = await bothRouters();
    const held = await holdRouteCreation('routeLocalStock', 2);
    try {
      routers.routeOrder.mockClear();
      const order = await createdPaid(T2N.tracked);
      await drain();
      expect(routers.routeOrder, 'both routers reached the routing engine').toHaveBeenCalledTimes(2);
      const routes = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
      expect(routes.map((r: any) => `${r.strategy}:${r.status}:${r.warehouseId}`), 'one route').toEqual([`LOCAL_STOCK:RESERVED:${T2N.warehouse}`]);
      const stock = await db.inventoryStock.findUnique({ where: { id: T2N.stock } });
      expect(`${stock.quantity}/${stock.reserved}`, 'one unit reserved').toBe('10/1');
      expect(held.arrivals(), 'one router created routes').toBe(1);
    } finally {
      held.restore();
      await routers.off();
    }
  });

  it('V18-T2n4 (W10-SOP-FIX review SOPFIX-SEC-1, SOPFIX-R1; D-112) any router: three routing calls at once on one placed order (the POST .../route handler\'s service), each held where it would create routes: one route, routes_created once, and each call answered with that route', async () => {
    const { market } = await marketRoutes();
    const held = await holdRouteCreation('routeLocalStock', 3);
    try {
      const order = await standardOrderOfA('t2n_route');
      const answers = await Promise.all([1, 2, 3].map(() => market.routeOrder(ID.biz, order.id)));
      await drain();
      const routeIds = (await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } })).map((r: any) => r.id);
      expect(routeIds, 'one route').toHaveLength(1);
      expect(answers.map((routes: any[]) => routes.map((r) => r.id)), 'each call is answered with that route').toEqual([routeIds, routeIds, routeIds]);
      expect((await stepsOf(order.id)).filter((s) => s === 'routes_created'), 'routes_created once').toHaveLength(1);
      expect(held.arrivals(), 'one call created routes').toBe(1);
    } finally {
      held.restore();
    }
  });

  it('V18-T2n5 (W10-SOP-FIX review SOPFIX-SEC-1; D-112) the router that comes second meets the order already routed, and is answered with its routes: for an order created paid with a DROPSHIP line, routed by createOrder (supplier_ordered, one PO), StoreOrderRoutingListener on the door\'s store_order.paid emits store_order.fulfillment_routed naming the one DROPSHIP route and no store_order.routing_failed (which raises an operator "routing failed" action and a failed contact event for an order that is routed), and nothing more is created', async () => {
    await routingFixtures();
    const { StoreOrderRoutingListener } = await import('../src/modules/marketplace/store-order-routing.listener');
    const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const routeOrder = await trackRouting();
    const listener = new (StoreOrderRoutingListener as any)(app.get(PrismaService), app.get(FulfillmentRoutingService), events);
    try {
      // createOrder's own autoRouteOrder routes it (the listener is not on the bus yet): the first router.
      const order = await createdPaid(T2N.drop);
      await drain();
      expect((await db.marketplaceOrder.findUnique({ where: { id: order.id } })).status).toBe('supplier_ordered');
      expect((await supplierPOs(order.orderNumber)).length).toBe(1);
      // The listener on the same store_order.paid comes second. At 53fb2438 routeOrder refused the order's status
      // (supplier_ordered is not routable) before it looked for its routes, and the listener reported a failure.
      seen = [];
      await listener.onStoreOrderPaid({ order: { id: order.id }, businessId: ID.biz });
      await drain();
      const announced = seen
        .filter((e) => e.payload?.orderId === order.id)
        .map((e) => `${e.name}:${(e.payload.strategies ?? []).join(',')}:${e.payload.routeCount ?? e.payload.error}`);
      expect(announced, 'the second router announces the routes made, and no failure').toEqual(['store_order.fulfillment_routed:DROPSHIP:1']);
      expect((await supplierPOs(order.orderNumber)).length, 'no second supplier PO').toBe(1);
      expect(await routesOf(order.id), 'no second route').toEqual(['DROPSHIP:PO_RAISED']);
      expect((await db.marketplaceOrder.findUnique({ where: { id: order.id } })).status).toBe('supplier_ordered');
    } finally {
      routeOrder.mockRestore();
      await drain();
    }
  });

  it.todo(
    "V18-T2i (W10-STORE-ORDER-PAID review CR-W10SOP-2; needs an owner ruling and StoreOrderService.refundOrder, outside this packet's write set) a partial refund of an order paid through the paid door is recorded on its invoice (D-14): a negative REFUNDED row of the amount refunded and its posting reversed by that amount. Before D-112 a marked-paid order had no payment on the books and its partial refund booked an Expense of the amount; the D-14 refund door refunds in full only (V18-T2h)",
  );

  it.todo(
    "V18-T2j (W10-STORE-ORDER-PAID review CR-W10SOP-3, FIN3; needs StoreOrderService.completeCheckout, outside this packet's write set) the COGS leg of an order marked paid is posted in the paid door's transaction, so a COGS posting failure leaves the order unpaid with nothing recorded, as the base mark_paid did. Today, as for an order created paid (D-77), COGS is posted after the door commits, idempotently, and a failure is logged with nothing to post it again",
  );

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
