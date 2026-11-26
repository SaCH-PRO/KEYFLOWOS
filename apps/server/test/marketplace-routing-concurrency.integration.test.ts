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
 *         Its movementsWritten 0 records today's behaviour (the route writes
 *         no stock movement and names no actor), not a rule: that is the
 *         review's SEC-UPS-2 follow-up, since ruled (D-139) and built by
 *         W11-INV-SET-MOVEMENT (RC-45..RC-57): each set now writes its one
 *         SET movement.
 *   RC-24 (review SEC-UPS-1) two requests creating the same new own pair at
 *         once (a double submit, a retry) both read no row (the pair lock
 *         locks nothing while no row exists) and both inserted: the loser's
 *         unique violation answered 409 'held by another record' though the
 *         only row holding the pair was the business's own, just committed.
 *         Now the loser runs its transaction once more, reads that row and
 *         updates it; the 409 is left for a pair a row the business does not
 *         read holds (a planted row, D-137; RC-23).
 *
 * W11-PO-LINES (owner ruling D-136; F-33, F-40): a purchase order's lines were
 * stored as sent (MarketplaceService.createPurchaseOrder, body: any; the route
 * and the KEY tool inventory_create_purchase_order) and read at receipt with
 * their ids coerced by String() for the ownership check, then passed raw to
 * the lock and to Prisma. Each case below was red at 00532f2f:
 *
 *   RC-25 (F-33) lines naming another business's product or warehouse were
 *         stored on a DRAFT purchase order, refused only at receipt (RC-10).
 *         Now refused at create with 400 naming the line (the receipt's
 *         wording), nothing saved.
 *   RC-26 (F-33) malformed bodies (items not a list, a line not an object, an
 *         id not a non-empty string, a quantity that is not a number, a
 *         product line whose quantity is not a positive whole number, D-136,
 *         a price or cost that is not a number of 0 or more) were stored, or
 *         answered 500. Now 400 naming the line, nothing saved; free-text
 *         lines, own products and a body with no items keep today's totals.
 *   RC-27 (F-40) legacy stored lines answered 500 at receipt (an id that is a
 *         one-element array passes String(); digit text added to an integer;
 *         a text cost on a new row), stored a fraction truncated, or skipped a
 *         word as quantity. Now a malformed id or stock quantity is 400 with
 *         nothing received, and digit text is received as that number (D-136).
 *
 * W11-PO-RECEIPT-CLAIM (the packet's cases RC-27..RC-30 are RC-30..RC-33 here:
 * RC-27..RC-29 were taken by W11-PO-LINES): advancePurchaseOrderStatus reads
 * the purchase order before its transaction and checks the transition on that
 * read; its write is a compare-and-set on the status read. Each caller is held
 * after that read until the other has read too:
 *
 *   RC-30, RC-31 two RECEIVED calls at once (a line into an existing stock row;
 *         a line into a pair with no row, serialized by the purchase order's
 *         row alone). At fb00af1c both committed (stock 10 -> 16, two RECEIPT
 *         movements, two purchaseOrder.received); at 92468080 (SEC-POL-4, RC-29)
 *         the other was refused 400 'Cannot transition PO from RECEIVED to
 *         RECEIVED'. Now 409 'changed by another request', nothing written,
 *         one ledger posting and one event.
 *   RC-32 two non-RECEIVED changes at once from SUBMITTED: both committed (the
 *         last write won). Now one wins and the other is 409.
 *   RC-33 (green before and after) a RECEIVED made after the first committed
 *         keeps the transition table's 400 and writes nothing.
 *
 * W11-STOCK-ROW-RACE (the packet's cases RC-31..RC-34 are RC-34..RC-37 here;
 * D-137 keeps the 'ask an operator' 409 for planted rows only): a stock writer
 * creating a (product, warehouse) row that does not exist yet takes no lock on
 * it (the pair lock locks existing rows only), and createStockRowOrConflict
 * answered every unique violation with 409 'held by another record; ask an
 * operator to repair it', also when the row was the business's own, created a
 * moment earlier by a concurrent writer. Each case below was red at 488b35d5
 * (RC-36 by its upsert's run count alone, since the review pin):
 *
 *   RC-34 transfers of M from the first and from the second warehouse into a
 *         third where M has no row, each held after its first stock write
 *         until both have made it: ['committed', 409 'ask an operator']. Now
 *         the loser runs its transaction once more and adds to the new row.
 *   RC-35 the same between a transfer into a new pair and a purchase order
 *         received with a line into an existing row, then a line into that
 *         pair, each held once it has read no row of the pair until the other
 *         has (the receipt reads it after its first stock write): both
 *         commit, the purchase order received once.
 *   RC-36 (its answers the same before and after) a pair a planted row
 *         holds still answers the 409 for a transfer, a receipt and POST
 *         .../inventory, writing nothing. Review SRR-CR-1: each transaction is
 *         run exactly once (the holder read finds another business_id; at
 *         488b35d5 the upsert ran twice); 'at most twice' let a run again of
 *         every 409 pass.
 *   RC-37 a transfer note that is not text (42, an object, an array, true)
 *         answered 500 (PrismaClientValidationError). Now 400 'Transfer note
 *         must be text', nothing written; a text note is stored as sent.
 *   RC-38 (review SRR-CR-2) the receipt as the loser: a purchase order
 *         received, held at its read of a new pair while POST .../inventory
 *         creates the business's own row there and commits, runs its
 *         transaction once more and is received once. RC-35 always has the
 *         transfer lose, so the receipt's run again was taken by no case:
 *         without it this answers the 'ask an operator' 409, PO SHIPPED.
 *
 * W11-ORDER-CANCEL-RELEASE (F-35; owner ruling D-136: a shipped or delivered
 * order is not cancelled by a status edit; the packet's cases RC-20..RC-23 are
 * RC-39..RC-42 here, RC-20..RC-38 being taken): the fulfil 'cancel' action
 * takes the order's routing claim and releases its reservations
 * (FulfillmentRoutingService.cancelOrderFulfilment, RC-06, RC-11), but the two
 * status edits that cancel an order, PATCH /marketplace/businesses/:businessId/
 * orders/:orderId/status {status:'cancelled'} (MarketplaceService.
 * updateOrderStatus) and PATCH /site/businesses/:businessId/orders/:orderId/
 * status {status:'CANCELLED'} (StoreOrderService.updateOrderStatus), wrote the
 * status alone: no claim, no release, no transition check. Each case below was
 * red at bb316619, called through the route's handler (as the routes run it,
 * with the body as sent and the member's id):
 *
 *   RC-39 (packet RC-20) a routed paid order with tracked A x2 PATCHed
 *         'cancelled', 'CANCELLED' (the web orders tab's spelling) or
 *         ' Cancelled ': it was stored cancelled with its route RESERVED and
 *         A still reserved 2 (held for good), no cancelled step, and the
 *         padded spelling emitted no store_order.cancelled. Now the route is
 *         CANCELLED, A reserved back to 0, the status stored as sent (trimmed:
 *         review SEC-W11OCR-1) with a cancelled step, the payment kept, and
 *         store_order.cancelled emitted once. Payment fields the member may
 *         write are still written.
 *   RC-40 (packet RC-21) PATCH 'cancelled' while routeOrder is held where it
 *         reserves (RC-06's hold): the edit committed at once and the router
 *         then committed its RESERVED route and reservation on the cancelled
 *         order. Now the edit waits for the router, then releases.
 *   RC-41 (packet RC-22; D-136) PATCH 'cancelled' on an order stored shipped,
 *         delivered, completed, cancelled or refunded (and the storefront's
 *         SHIPPED, DELIVERED, CANCELLED) was written. Now 400 with nothing
 *         written (the order row, its route and its reservation as they were)
 *         and no event.
 *   RC-42 (packet RC-23) a CONFIRMED / PAID storefront order (paid offline,
 *         its stock decremented by the paid door) routed by the listener,
 *         then PATCH /site CANCELLED: stored CANCELLED with its route RESERVED
 *         and its reservation held. Now the route is CANCELLED and the
 *         reservation released (the quantity the checkout decremented is not
 *         restocked: out of scope). A SHIPPED, DELIVERED, COMPLETED, CANCELLED
 *         or REFUNDED storefront order is 400 with nothing written.
 *
 * W11-ORDER-CANCEL-RELEASE review repairs (each red at 3fdf2399, the packet
 * head):
 *
 *   RC-43 (OCR-COR-1) an open order stored with a spelling outside
 *         canTransitionOrder's case-sensitive vocabulary ('processing',
 *         'pending', 'confirmed', 'Processing', ' routed ', or a label of the
 *         marketplace route's own such as 'on_hold'; the route writes any
 *         status as sent) was refused 400 'Cannot cancel order in <status>
 *         status' by both status edits, so no route could cancel it (at
 *         bb316619 each was cancelled). Now it is cancelled and released (its
 *         route CANCELLED, A reserved back to 0); a closed status in any case
 *         ('Shipped', ' delivered ', 'Completed', 'REFUNDED') is still 400
 *         with nothing written (control).
 *   RC-44 (OCR-COR-2) a ship that commits while the cancel waits (the
 *         cancel has taken the claim and read the status, and waits to lock
 *         the stock row its route reserved from): PATCH 'shipped' (no claim)
 *         answered 200 and the cancel then wrote cancelled over the shipped
 *         order, released its reservation and announced it cancelled (D-136
 *         broken under concurrency). Now the cancel's write is a
 *         compare-and-set on the status it read: 409 with nothing written,
 *         the order stored shipped with its route RESERVED and its unit
 *         reserved, and no store_order.cancelled. The same on PATCH /site
 *         (SHIPPED while CANCELLED waits).
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
  /** W11-STOCK-ROW-RACE: a third warehouse of the business, created by its describe block (no stock row of its own). */
  warehouse3: `${P}wh_3`,
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
    `DELETE FROM shipments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM purchase_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pre_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM stock_movements WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_listings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM inventory_stocks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM warehouses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

  // SWP-STORE-LISTING-SERVER (P12): live storefront listing Services for products ordered via StoreOrderService.
  for (const [bizId, prodId, name] of [
    [ID.biz, ID.productA, 'V18R Tracked A'],
    [ID.biz, ID.productB, 'V18R Tracked B'],
    [ID.biz, ID.productU, 'V18R Untracked'],
    [ID.biz, ID.productM, 'V18R Two Warehouses'],
    [ID.bizB, ID.productXB, 'V18R Other Stocked'],
    [ID.bizB, ID.productXB2, 'V18R Other Unstocked'],
  ] as const) {
    await db.service.create({
      data: {
        id: `${prodId}_listing`,
        businessId: bizId,
        name,
        duration: 0,
        price: PRICE,
        sourceProductId: prodId,
      },
    });
  }
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
  let bothWaited = false;
  try {
    firstAnswer = answerOf(first());
    firstWaited = await within(5_000, async () => (await waitingSessions()) >= 1);
    secondAnswer = answerOf(second());
    bothWaited = await within(HOLD_WINDOW_MS, async () => (await waitingSessions()) >= 2);
  } finally {
    letGo();
    await holder;
  }
  // bothWaited (W11-INV-SET-MOVEMENT acceptance B-2): the second party was waiting too when the holder let go.
  return { firstWaited, bothWaited, answers: await Promise.all([firstAnswer, secondAnswer]) };
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

/**
 * POST .../inventory as the route runs it: its handler (MarketplaceController.upsertInventory), with the body as sent
 * and the member AuthGuard put on the request (W11-INV-SET-MOVEMENT: the set's movement names them).
 */
const upsertByRoute = (businessId: string, body: Record<string, unknown>, memberId: string = ID.owner) =>
  Promise.resolve().then(() => controller.upsertInventory(businessId, body, { user: { id: memberId } }));
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
    // planted row (read by its pair alone) and answered success. movementsWritten was pinned 0 here (no stock movement,
    // no actor) until the owner ruled the SEC-UPS-2 follow-up (D-139; W11-INV-SET-MOVEMENT, RC-45..RC-57): a set that
    // changes the quantity (10 to 7; a new row holding 3) writes its one ADJUSTMENT/SET movement; the refused one none.
    expect(outcomes).toEqual({
      'own existing pair, quantity as the web form sends it': { answer: 'committed', stockRowsWritten: 1, movementsWritten: 1 },
      'own new pair': { answer: 'committed', stockRowsWritten: 1, movementsWritten: 1 },
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

  it("RC-24 (W11-INV-UPSERT-SCOPE review SEC-UPS-1; D-137 keeps the 409 for planted rows only) two POST .../inventory requests creating the same new own pair at once (a double submit or a retry, then two requests sending different fields), each held after reading no row until the other has read too: both commit, one row of the business holding both requests' fields, and neither answers 409 'held by another record' (no planted row exists)", async () => {
    const pair = { productId: ID.productU, warehouseId: ID.warehouse2 };
    const probes: Array<[name: string, first: Record<string, unknown>, second: Record<string, unknown>]> = [
      ['the same body twice (a double submit, a retry)', { ...pair, quantity: 3 }, { ...pair, quantity: 3 }],
      ['two bodies sending different fields', { ...pair, quantity: 3 }, { ...pair, costPerUnit: '2.5', reorderAt: '1' }],
    ];
    const outcomes: Record<string, unknown> = {};
    const rows: Record<string, unknown> = {};
    try {
      for (const [name, first, second] of probes) {
        await resetBusinessStock();
        const reads = new Set<number>();
        let allIn!: () => void;
        const gathered = new Promise<void>((resolve) => (allIn = resolve));
        // Each transaction is held after its stock row read until both have read (neither sees a row), or the window
        // passes: a request that waits on a lock before its read never reaches the hold while the other waits.
        const hook = hookStockWrites(async (no) => {
          if (reads.has(no)) return;
          reads.add(no);
          if (reads.size >= 2) allIn();
          await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
        }, 'findFirst');
        try {
          outcomes[name] = await answerAndWrites(() =>
            Promise.all([upsertAnswer(upsertByRoute(ID.biz, first)), upsertAnswer(upsertByRoute(ID.biz, second))]),
          );
        } finally {
          hook.restore();
        }
        const held = await db.inventoryStock.findMany({ where: { productId: ID.productU, warehouseId: ID.warehouse2 } });
        rows[name] = held.map((r: any) => [r.businessId, r.quantity, r.reserved, r.reorderAt, r.costPerUnit, r.currency]);
      }
    } finally {
      await resetBusinessStock();
    }
    // Before this repair the second insert waited on the unique pair behind the first, then failed on it (P2002), which
    // createStockRowOrConflict answered as a planted row: ['committed', '409: A stock row ... held by another record'].
    // W11-INV-SET-MOVEMENT (D-139): movementsWritten was 0. The request that creates the row holding 3 writes its one
    // SET movement; the other (the same 3 again, or no quantity named) changes no quantity and writes none (RC-51).
    expect(outcomes).toEqual({
      'the same body twice (a double submit, a retry)': { answer: ['committed', 'committed'], stockRowsWritten: 1, movementsWritten: 1 },
      'two bodies sending different fields': { answer: ['committed', 'committed'], stockRowsWritten: 1, movementsWritten: 1 },
    });
    expect(rows, "one row of this business; the later request's fields applied over the earlier's row").toEqual({
      'the same body twice (a double submit, a retry)': [[ID.biz, 3, 0, null, null, 'TTD']],
      'two bodies sending different fields': [[ID.biz, 3, 0, 1, 2.5, 'TTD']],
    });
  });

  // The SEC-UPS-2 follow-up (a set wrote no stock movement and named no actor, took a quantity below reserved and let a
  // member set reserved by hand) was ruled by the owner (D-139) and is live as RC-45..RC-57 (W11-INV-SET-MOVEMENT, the
  // describe block at the end of this file).
  // The Z5SEC-2 operator census and repair follow-up is now live in scripts/cleanup-planted-stock-rows.ts
  // (W11-PLANTED-STOCK-CENSUS, D-137) and proven in test/data-cleanup-scripts.integration.test.ts (PSC-01..03).
});

/** POST .../purchase-orders as the route runs it: its handler (MarketplaceController.createPurchaseOrder), with the body as sent. */
const createPurchaseOrderByRoute = (body: unknown) => Promise.resolve().then(() => controller.createPurchaseOrder(ID.biz, body));
/** The suite's purchase orders, whatever their business. */
const purchaseOrderCount = async () => {
  const [{ n }]: any[] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  return n as number;
};
/**
 * A purchase order create's answer as the route gives it ('created <status> <subtotal>/<total>', else the HTTP status
 * and message as routeAnswer reads it), how many purchase orders it wrote, and the lines it stored.
 */
async function purchaseOrderCreate(body: unknown) {
  const before = await purchaseOrderCount();
  let stored: unknown;
  const answer = await routeAnswer(
    createPurchaseOrderByRoute(body).then((po: any) => {
      stored = po?.items;
      return `created ${po?.status} ${po?.subtotal}/${po?.total}`;
    }),
  );
  return { answer, purchaseOrdersWritten: (await purchaseOrderCount()) - before, stored };
}

describe('W11-PO-LINES purchase order lines checked at create and at receipt (D-136; real database)', () => {
  const supplier = { supplierName: 'V18R Supplier' };
  const ownLine = { productId: ID.productA, name: 'A', quantity: 3, unitPrice: 4, unitCost: 4, total: 12, warehouseId: ID.warehouse };

  it("RC-25 (W11-PO-LINES; F-33, Z4RV-SEC-1 at create) POST .../purchase-orders with a line naming another business's product (with no warehouse, in its warehouse, or in this business's), a line into its warehouse (a free-text line, or this business's product), or this business's line then another business's product, is refused with 400 naming the line and no id, and no purchase order is saved", async () => {
    const foreign = (n: number) => `400: Purchase order line ${n} names a product or a warehouse that is not this business's; nothing was saved`;
    const probes: Array<[name: string, items: unknown[], answer: string]> = [
      ["B's product, no warehouse", [{ productId: ID.productXB, name: 'XB', quantity: 2, unitPrice: 1, unitCost: 1, total: 2 }], foreign(1)],
      [
        "B's product in B's warehouse (the review's probe)",
        [{ productId: ID.productXB, name: 'XB', quantity: 1000, unitPrice: 0.01, unitCost: 0.01, total: 10, warehouseId: ID.warehouseB }],
        foreign(1),
      ],
      ["B's unstocked product in this business's warehouse", [{ productId: ID.productXB2, name: 'XB2', quantity: 1, unitPrice: 1, warehouseId: ID.warehouse }], foreign(1)],
      ["a free-text line into B's warehouse", [{ name: 'Freight', quantity: 1, unitPrice: 5, warehouseId: ID.warehouseB }], foreign(1)],
      ["this business's product into B's warehouse", [{ ...ownLine, warehouseId: ID.warehouseB }], foreign(1)],
      [
        "this business's line first, then B's product",
        [ownLine, { productId: ID.productXB, name: 'XB', quantity: 5, unitPrice: 1, unitCost: 1, total: 5, warehouseId: ID.warehouseB }],
        foreign(2),
      ],
    ];
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [name, items, answer] of probes) {
      const { stored: _stored, ...outcome } = await purchaseOrderCreate({ ...supplier, items });
      outcomes[name] = outcome;
      expected[name] = { answer, purchaseOrdersWritten: 0 };
    }
    // At 00532f2f each was saved: 'created DRAFT ...', 1 purchase order written (refused only at receipt, RC-10).
    expect(outcomes).toEqual(expected);
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
  });

  it("RC-26 (W11-PO-LINES; F-33, D-136 whole stock quantities) POST .../purchase-orders with items not a list, a line not an object, a productId or warehouseId that is not a non-empty string, a quantity that is not a number, a product line whose quantity is not a positive whole number, or a price or cost that is not a number of 0 or more, is refused with 400 naming the line and nothing is saved; a free-text line, this business's product with and without a warehouse, and a body with no items are created with today's subtotal and total", async () => {
    const list = '400: Purchase order items must be a list of lines';
    const line = (n: number, what: string) => `400: Purchase order line ${n} ${what}`;
    const object = (n: number) => line(n, 'must be an object');
    const productId = (n: number) => line(n, 'productId must be a non-empty string');
    const warehouseId = (n: number) => line(n, 'warehouseId must be a non-empty string');
    const numeric = (n: number, field = 'quantity') => line(n, `${field} must be a number`);
    const whole = (n: number, field = 'quantity') => line(n, `${field} must be a whole number above 0 on a product line`);
    const money = (n: number, field: string) => line(n, `${field} must be a number of 0 or more`);
    const refusals: Array<[name: string, body: Record<string, unknown>, answer: string]> = [
      ['items an object', { ...supplier, items: { productId: ID.productA, quantity: 1 } }, list],
      ['items a string', { ...supplier, items: 'abc' }, list],
      ['a line null', { ...supplier, items: [null] }, object(1)],
      ['a line a number (after a good line)', { ...supplier, items: [ownLine, 5] }, object(2)],
      ['a line an array', { ...supplier, items: [[ownLine]] }, object(1)],
      ['productId a number', { ...supplier, items: [{ ...ownLine, productId: 42 }] }, productId(1)],
      ["productId an array of this business's product", { ...supplier, items: [{ ...ownLine, productId: [ID.productA] }] }, productId(1)],
      ['productId a filter object', { ...supplier, items: [{ ...ownLine, productId: { not: '' } }] }, productId(1)],
      ["warehouseId an array of this business's warehouse", { ...supplier, items: [{ ...ownLine, warehouseId: [ID.warehouse] }] }, warehouseId(1)],
      ["a product line's quantity as text", { ...supplier, items: [{ ...ownLine, quantity: '5' }] }, numeric(1)],
      ["a product line's quantity a fraction", { ...supplier, items: [{ ...ownLine, quantity: 1.5 }] }, whole(1)],
      ["a product line's quantity 0", { ...supplier, items: [{ ...ownLine, quantity: 0 }] }, whole(1)],
      ["a product line's quantity negative", { ...supplier, items: [{ ...ownLine, quantity: -1 }] }, whole(1)],
      ["a product line's quantity an object", { ...supplier, items: [{ ...ownLine, quantity: {} }] }, numeric(1)],
      ["a product line with no quantity", { ...supplier, items: [{ productId: ID.productA, name: 'A', unitPrice: 4 }] }, whole(1)],
      ["a product line's receivedQuantity a fraction", { ...supplier, items: [{ ...ownLine, receivedQuantity: 2.5 }] }, whole(1, 'receivedQuantity')],
      ['a free-text line quantity as a word', { ...supplier, items: [{ name: 'Freight', quantity: 'two', unitPrice: 5 }] }, numeric(1)],
      ['unitCost a word', { ...supplier, items: [{ ...ownLine, unitCost: 'x' }] }, money(1, 'unitCost')],
      ['unitPrice negative', { ...supplier, items: [{ ...ownLine, unitPrice: -4 }] }, money(1, 'unitPrice')],
    ];
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [name, body, answer] of refusals) {
      const { stored: _stored, ...outcome } = await purchaseOrderCreate(body);
      outcomes[name] = outcome;
      expected[name] = { answer, purchaseOrdersWritten: 0 };
    }
    const freeText = [{ name: 'Freight', quantity: 2, unitPrice: 7.5, total: 15 }];
    const ownNoWarehouse = [{ productId: ID.productA, name: 'A', quantity: 2, unitPrice: 2.5, total: 5 }];
    const controls: Array<[name: string, body: Record<string, unknown>, answer: string, stored: unknown]> = [
      ['a free-text line with no productId, shipping and tax', { ...supplier, items: freeText, shippingCost: 5, taxAmount: 1 }, 'created DRAFT 15/21', freeText],
      ['a free-text line with no quantity (counted as 1)', { ...supplier, items: [{ name: 'Setup', unitPrice: 9 }] }, 'created DRAFT 9/9', [{ name: 'Setup', unitPrice: 9 }]],
      ["this business's product into its warehouse", { ...supplier, items: [ownLine] }, 'created DRAFT 12/12', [ownLine]],
      ["this business's product with no warehouse", { ...supplier, items: ownNoWarehouse }, 'created DRAFT 5/5', ownNoWarehouse],
      ["this business's product and a free-text line", { ...supplier, items: [ownLine, ...freeText] }, 'created DRAFT 27/27', [ownLine, ...freeText]],
      ['a body with no items', { ...supplier }, 'created DRAFT 0/0', []],
    ];
    for (const [name, body, answer, stored] of controls) {
      outcomes[name] = await purchaseOrderCreate(body);
      expected[name] = { answer, purchaseOrdersWritten: 1, stored };
    }
    // At 00532f2f items an object and a null line answered 500 (TypeError), a quantity that is a word or an object 500 (a
    // NaN subtotal, PrismaClientValidationError), and every other refusal was saved as DRAFT (a negative unitPrice with a
    // negative total). The controls were created as they are now.
    expect(outcomes).toEqual(expected);
    expect(JSON.stringify(Object.fromEntries(refusals.map(([name]) => [name, outcomes[name]]))), "no refusal names an id of the suite's").not.toContain(P);
  });

  it("RC-27 (W11-PO-LINES; F-40, D-136 digit text received as that number) a legacy SHIPPED purchase order received with a line whose productId or warehouseId is an array, or whose quantity is a word or a fraction, is refused with 400 naming the line and stays SHIPPED with nothing written; a quantity or receivedQuantity stored as digit text is received as that number, and a cost stored as digit text on a new stock row is its cost; never a 500", async () => {
    const malformed = (n: number) => `400: Purchase order line ${n} is malformed; nothing was received`;
    const probes: Array<[name: string, items: unknown[], answer: string]> = [
      ["productId an array of this business's product", [{ ...ownLine, productId: [ID.productA] }], malformed(1)],
      ["warehouseId an array of this business's warehouse (after a good line)", [ownLine, { ...ownLine, productId: ID.productB, warehouseId: [ID.warehouse] }], malformed(2)],
      ['quantity a word', [{ ...ownLine, quantity: 'abc' }], malformed(1)],
      ['quantity a fraction', [{ ...ownLine, quantity: 1.5 }], malformed(1)],
      ['quantity a fraction as text', [{ ...ownLine, quantity: '1.5' }], malformed(1)],
      ["quantity '5' (digit text)", [{ productId: ID.productA, name: 'A', quantity: '5', unitPrice: 0, warehouseId: ID.warehouse }], 'committed'],
      ["receivedQuantity '2' (digit text) of 5 ordered", [{ productId: ID.productA, name: 'A', quantity: 5, receivedQuantity: '2', warehouseId: ID.warehouse }], 'committed'],
      ["unitCost '3' (digit text) on a new stock row", [{ productId: ID.productU, name: 'U', quantity: 4, unitPrice: 3, unitCost: '3', warehouseId: ID.warehouse2 }], 'committed'],
      // Green before and after: lines that add no stock (not an object, or naming no product) are passed over, as before.
      [
        "lines that add no stock (null, 5, a free-text line with quantity 'abc') beside a good line",
        [null, 5, { name: 'Freight', quantity: 'abc', unitPrice: 'x' }, { productId: ID.productA, name: 'A', quantity: 3, warehouseId: ID.warehouse }],
        'committed',
      ],
    ];
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const statuses: Record<string, string> = {};
    const stockAfter: Record<string, unknown> = {};
    // The costs as earlier cases left them (a receipt with a cost rewrites them): none of these probes changes a cost.
    const seededA = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    const seededB = await db.inventoryStock.findUnique({ where: { id: ID.stockB } });
    try {
      for (const [name, items, answer] of probes) {
        await resetBusinessStock();
        const po = await shippedPurchaseOrder(items);
        outcomes[name] = await answerAndWrites(() =>
          routeAnswer(routing.advancePurchaseOrderStatus(ID.biz, po.id, 'RECEIVED').then((r: any) => ({ success: r?.status === 'RECEIVED' }))),
        );
        expected[name] = answer === 'committed' ? { answer, stockRowsWritten: 1, movementsWritten: 1 } : { answer, stockRowsWritten: 0, movementsWritten: 0 };
        statuses[name] = (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status;
        const rows = await db.inventoryStock.findMany({
          where: { businessId: ID.biz, productId: { in: [ID.productA, ID.productB, ID.productU] }, warehouseId: { in: [ID.warehouse, ID.warehouse2] } },
        });
        stockAfter[name] = rows.map((r: any) => `${r.productId}@${r.warehouseId}:${r.quantity}/${r.reserved}/${r.costPerUnit}`).sort();
      }
    } finally {
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { costPerUnit: seededA.costPerUnit } });
      await resetBusinessStock();
    }
    // At 00532f2f the arrays, quantity '1.5' and '5', receivedQuantity '2' and unitCost '3' answered 500
    // (PrismaClientValidationError; each rolled back, the purchase order left SHIPPED), quantity 'abc' was skipped (the
    // purchase order RECEIVED with nothing added), and quantity 1.5 was received (one row and one movement written).
    expect(outcomes).toEqual(expected);
    expect(JSON.stringify(outcomes), 'never a 500').not.toContain('500');
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
    expect(statuses).toEqual(Object.fromEntries(probes.map(([name, , answer]) => [name, answer === 'committed' ? 'RECEIVED' : 'SHIPPED'])));
    const seeded = [`${ID.productA}@${ID.warehouse}:${IN_STOCK}/0/${seededA.costPerUnit}`, `${ID.productB}@${ID.warehouse}:${IN_STOCK}/0/${seededB.costPerUnit}`];
    const withA = (quantity: number) => [`${ID.productA}@${ID.warehouse}:${quantity}/0/${seededA.costPerUnit}`, seeded[1]];
    expect(stockAfter).toEqual({
      "productId an array of this business's product": seeded,
      "warehouseId an array of this business's warehouse (after a good line)": seeded,
      'quantity a word': seeded,
      'quantity a fraction': seeded,
      'quantity a fraction as text': seeded,
      "quantity '5' (digit text)": withA(IN_STOCK + 5),
      "receivedQuantity '2' (digit text) of 5 ordered": withA(IN_STOCK + 2),
      "unitCost '3' (digit text) on a new stock row": [...seeded, `${ID.productU}@${ID.warehouse2}:4/0/3`],
      "lines that add no stock (null, 5, a free-text line with quantity 'abc') beside a good line": withA(IN_STOCK + 3),
    });
  });

  it("RC-28 (W11-PO-LINES review SEC-POL-1, POL-CR-1, SEC-POL-2; D-136) POST .../purchase-orders with a product line whose stock quantity is above 2147483647 (the most an integer stock column holds), a shippingCost or taxAmount that is not a number, or a subtotal or total that is not finite, is refused with 400 and nothing is saved; a legacy SHIPPED purchase order received with a stock quantity above 2147483647 (a number or digit text), or one that would take its stock row above it, is refused with 400 naming the line, stays SHIPPED and writes nothing; never a 500", async () => {
    const line = (n: number, what: string) => `400: Purchase order line ${n} ${what}`;
    const tooMany = (n: number, field = 'quantity') => line(n, `${field} must be at most 2147483647 on a product line`);
    const creates: Array<[name: string, body: Record<string, unknown>, answer: string, written: number]> = [
      ["a product line's quantity 3e9", { ...supplier, items: [{ ...ownLine, quantity: 3e9, unitPrice: 0 }] }, tooMany(1), 0],
      ["a product line's quantity 1e300", { ...supplier, items: [{ ...ownLine, quantity: 1e300, unitPrice: 0 }] }, tooMany(1), 0],
      ["a product line's receivedQuantity 2147483648", { ...supplier, items: [{ ...ownLine, receivedQuantity: 2147483648 }] }, tooMany(1, 'receivedQuantity'), 0],
      [
        'a free-text line whose quantity times price is not finite',
        { ...supplier, items: [{ name: 'X', quantity: 1e200, unitPrice: 1e200 }] },
        '400: Purchase order subtotal must be a finite number; nothing was saved',
        0,
      ],
      [
        'a shippingCost and a taxAmount whose sum is not finite',
        { ...supplier, items: [], shippingCost: 1e308, taxAmount: 1e308 },
        '400: Purchase order total must be a finite number; nothing was saved',
        0,
      ],
      ['a shippingCost as text', { ...supplier, items: [ownLine], shippingCost: '5' }, '400: Purchase order shippingCost must be a number; nothing was saved', 0],
      ['a taxAmount an object', { ...supplier, items: [ownLine], taxAmount: {} }, '400: Purchase order taxAmount must be a number; nothing was saved', 0],
      // Green before and after: the most a stock row holds is a stock quantity a product line may carry.
      ["a product line's quantity 2147483647", { ...supplier, items: [{ ...ownLine, quantity: 2147483647, unitPrice: 0 }] }, 'created DRAFT 0/0', 1],
    ];
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [name, body, answer, written] of creates) {
      const { stored: _stored, ...outcome } = await purchaseOrderCreate(body);
      outcomes[name] = outcome;
      expected[name] = { answer, purchaseOrdersWritten: written };
    }

    const malformed = (n: number) => `400: Purchase order line ${n} is malformed; nothing was received`;
    const aboveRow = (n: number) => `400: Purchase order line ${n} would take its stock row above 2147483647; nothing was received`;
    const a = (quantity: unknown) => ({ productId: ID.productA, name: 'A', quantity, warehouseId: ID.warehouse });
    const u = (quantity: unknown) => ({ productId: ID.productU, name: 'U', quantity, warehouseId: ID.warehouse2 });
    const receipts: Array<[name: string, items: unknown[], answer: string]> = [
      ['quantity 3e9', [a(3e9)], malformed(1)],
      ['quantity 1e300', [a(1e300)], malformed(1)],
      ["quantity '3000000000' (digit text)", [a('3000000000')], malformed(1)],
      ["receivedQuantity '9999999999' (digit text) of 5 ordered", [{ ...a(5), receivedQuantity: '9999999999' }], malformed(1)],
      ['quantity 2147483647 onto the stock row holding 10', [a(2147483647)], aboveRow(1)],
      ['two lines of 2000000000 onto one new stock row', [u(2_000_000_000), u(2_000_000_000)], aboveRow(2)],
      // Found reproducing SEC-POL-2: the average overflowed to Infinity, which Prisma wrote as a NULL cost (committed).
      [
        'unitCost 1e308 on 2 units onto the stock row holding 10 (an average that overflows)',
        [{ ...a(2), unitCost: 1e308 }],
        '400: Purchase order line 1 has a cost too large to average into its stock row; nothing was received',
      ],
      // Green before and after: the most a stock row holds, onto a new row.
      ['quantity 2147483647 onto a new stock row', [u(2147483647)], 'committed'],
    ];
    const statuses: Record<string, string> = {};
    const expectedStatuses: Record<string, string> = {};
    const seededA = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    try {
      for (const [name, items, answer] of receipts) {
        await resetBusinessStock();
        const po = await shippedPurchaseOrder(items);
        outcomes[`receipt: ${name}`] = await answerAndWrites(() =>
          routeAnswer(routing.advancePurchaseOrderStatus(ID.biz, po.id, 'RECEIVED').then((r: any) => ({ success: r?.status === 'RECEIVED' }))),
        );
        expected[`receipt: ${name}`] =
          answer === 'committed' ? { answer, stockRowsWritten: 1, movementsWritten: 1 } : { answer, stockRowsWritten: 0, movementsWritten: 0 };
        statuses[name] = (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status;
        expectedStatuses[name] = answer === 'committed' ? 'RECEIVED' : 'SHIPPED';
      }
    } finally {
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { costPerUnit: seededA.costPerUnit } });
      await resetBusinessStock();
    }
    // At f3e7740a quantity 3e9, 1e300 and 2147483648 were created as DRAFT, the non-finite subtotal and total and the
    // text shippingCost and object taxAmount answered 500 (PrismaClientValidationError), and every receipt refusal
    // answered 500 (P2020 for an integer out of range, PrismaClientValidationError for 1e300), each rolled back; the
    // overflowing average was received with the row's cost written as NULL.
    expect(outcomes).toEqual(expected);
    expect((await db.inventoryStock.findUnique({ where: { id: ID.stockA } })).costPerUnit, "stock A's cost as it was").toBe(seededA.costPerUnit);
    expect(JSON.stringify(outcomes), 'never a 500').not.toContain('500');
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
    expect(statuses).toEqual(expectedStatuses);
  });

  it('RC-29 (W11-PO-LINES review SEC-POL-4) two receipts of one SHIPPED purchase order at once, each having read it SHIPPED and waiting behind a lock on its stock row, receive it once: one commits, adding its stock with one movement, and the other is refused with 409 (W11-PO-RECEIPT-CLAIM: the purchase order was changed by another request) and writes nothing', async () => {
    await resetBusinessStock();
    const po = await shippedPurchaseOrder([{ productId: ID.productA, name: 'A', quantity: 3, warehouseId: ID.warehouse }]);
    const receive = () =>
      routeAnswer(routing.advancePurchaseOrderStatus(ID.biz, po.id, 'RECEIVED').then((r: any) => ({ success: r?.status === 'RECEIVED' })));
    try {
      const before = await stockState();
      const { firstWaited, answers } = await behindHolder(ID.stockA, receive, receive);
      const after = await stockState();
      const status = (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status;
      // At f3e7740a both committed: stock A went from 10 to 16 with two RECEIPT movements (the status was read before
      // the transaction and the update did not compare it). W11-PO-RECEIPT-CLAIM: the loser of the compare-and-set
      // answered 400 'Cannot transition PO from RECEIVED to RECEIVED' at 92468080 (a sequential refusal's text); it is
      // the 409 a lost claim gets (RC-30), and a receipt made after the first committed keeps the 400 (RC-33).
      expect({ firstWaited, answers: [...answers].sort(), stockA: await stockOf(ID.stockA), movementsWritten: after.movements - before.movements, status }).toEqual({
        firstWaited: true,
        answers: ['409: The purchase order was changed by another request; reload it and try again', 'committed'],
        stockA: `${IN_STOCK + 3}/0`,
        movementsWritten: 1,
        status: 'RECEIVED',
      });
    } finally {
      await resetBusinessStock();
    }
  });
});

/**
 * W11-PO-RECEIPT-CLAIM: every read of a purchase order on PrismaService.client (purchaseOrder.findFirst, the read
 * advancePurchaseOrderStatus makes before its transaction; a read on a transaction client is not one) is held once it
 * has run until `parties` reads have run, or HOLD_WINDOW_MS has passed, so every caller has read the status before any
 * writes it. Records the status each read returned. Restored by the returned function.
 */
function holdPurchaseOrderReads(parties: number) {
  const real = prismaService.client;
  const statuses: string[] = [];
  let allIn!: () => void;
  const gathered = new Promise<void>((resolve) => (allIn = resolve));
  const bound = (target: any, prop: PropertyKey) => {
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  prismaService.client = new Proxy(real, {
    get(target, prop) {
      if (prop !== 'purchaseOrder') return bound(target, prop);
      return new Proxy(Reflect.get(target, prop), {
        get(delegate, p) {
          if (p !== 'findFirst') return bound(delegate, p);
          return async (args: any) => {
            const po = await delegate.findFirst(args);
            statuses.push(po?.status ?? 'none');
            if (statuses.length >= parties) allIn();
            await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
            return po;
          };
        },
      });
    },
  });
  return {
    statusesRead: () => [...statuses],
    restore: () => {
      prismaService.client = real;
    },
  };
}

/** purchaseOrder.received events emitted on the suite's bus, counted by purchase order. Stopped by the returned function. */
function countReceivedEvents() {
  const ids: string[] = [];
  const onAny = (name: string | string[], payload: any) => {
    if ((Array.isArray(name) ? name.join('.') : String(name)) === 'purchaseOrder.received') ids.push(payload?.purchaseOrderId);
  };
  events.onAny(onAny);
  return { of: (poId: string) => ids.filter((id) => id === poId).length, stop: () => events.offAny(onAny) };
}

/** The ledger postings of a purchase order (financial_transactions whose source is it). */
const ledgerPostingsOf = async (poId: string) => {
  const [{ n }]: any[] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM financial_transactions WHERE source_id = ${poId}`;
  return n as number;
};
/** The RECEIPT stock movements a purchase order wrote. */
const receiptMovementsOf = (poId: string) => db.stockMovement.count({ where: { referenceId: poId, type: 'RECEIPT' } });

/** A purchase order of the business in `status` with one line of 3 units at cost 2 (total 6, so its receipt is posted). */
const claimPurchaseOrder = (status: string, line: { productId: string; warehouseId: string }) =>
  db.purchaseOrder.create({
    data: {
      businessId: ID.biz,
      poNumber: `${P}po_${++orderSeq}_${Date.now()}`,
      status,
      supplierName: 'V18R Supplier',
      items: [{ ...line, name: 'Claimed', quantity: 3, unitPrice: 2, unitCost: 2, total: 6 }],
      subtotal: 6,
      shippingCost: 0,
      taxAmount: 0,
      total: 6,
      currency: 'TTD',
    },
  });

/** advancePurchaseOrderStatus(RECEIVED) as the route answers it: 'committed' when it returned the PO RECEIVED. */
const receiveAnswer = (poId: string) =>
  routeAnswer(routing.advancePurchaseOrderStatus(ID.biz, poId, 'RECEIVED').then((r: any) => ({ success: r?.status === 'RECEIVED' })));

/** The refusal a status change gets when the status it read was changed by another request first (W11-PO-RECEIPT-CLAIM). */
const CLAIM_LOST = '409: The purchase order was changed by another request; reload it and try again';

describe('W11-PO-RECEIPT-CLAIM a purchase order status change is a compare-and-set on the status it read (real database)', () => {
  it('RC-30 (W11-PO-RECEIPT-CLAIM; packet case RC-27) two RECEIVED calls at once on one SHIPPED purchase order whose line goes into an existing stock row, each having read it SHIPPED before either writes: exactly one answers RECEIVED and the other 409 with nothing written; the stock is received once (+3, its weighted-average cost recomputed once) with one RECEIPT movement, one ledger posting and one purchaseOrder.received', async () => {
    await resetBusinessStock();
    const seededA = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    await db.inventoryStock.update({ where: { id: ID.stockA }, data: { costPerUnit: 4 } });
    const po = await claimPurchaseOrder('SHIPPED', { productId: ID.productA, warehouseId: ID.warehouse });
    const received = countReceivedEvents();
    const gate = holdPurchaseOrderReads(2);
    try {
      const answers = await Promise.all([receiveAnswer(po.id), receiveAnswer(po.id)]);
      gate.restore();
      const rowA = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
      // At 92468080 (W11-PO-LINES review SEC-POL-4 compared the status already) the other was refused with
      // '400: Cannot transition PO from RECEIVED to RECEIVED', a sequential refusal's text; at fb00af1c both answered
      // RECEIVED: stock 10 -> 16, two RECEIPT movements, the cost averaged twice, two purchaseOrder.received.
      expect({
        statusesRead: gate.statusesRead(),
        answers: [...answers].sort(),
        stockA: `${rowA.quantity}/${rowA.reserved}`,
        // To 9 places (the stored double comes back a last digit off): averaged twice it was 3.25.
        costA: Number(rowA.costPerUnit.toFixed(9)),
        receiptMovements: await receiptMovementsOf(po.id),
        ledgerPostings: await ledgerPostingsOf(po.id),
        receivedEvents: received.of(po.id),
        status: (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status,
      }).toEqual({
        statusesRead: ['SHIPPED', 'SHIPPED'],
        answers: [CLAIM_LOST, 'committed'],
        stockA: `${IN_STOCK + 3}/0`,
        costA: Number(((IN_STOCK * 4 + 3 * 2) / (IN_STOCK + 3)).toFixed(9)),
        receiptMovements: 1,
        ledgerPostings: 1,
        receivedEvents: 1,
        status: 'RECEIVED',
      });
    } finally {
      gate.restore();
      received.stop();
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { costPerUnit: seededA.costPerUnit } });
      await resetBusinessStock();
    }
  });

  it("RC-31 (W11-PO-RECEIPT-CLAIM; packet case RC-28) the same with the line into a (product, warehouse) that has no stock row yet (no stock row to lock; the purchase order's row serializes the two): one row is created holding 3 at cost 2, and the other answers 409 that the purchase order changed (not a second receipt, not the 'held by another record' 409), with one RECEIPT movement, one ledger posting and one purchaseOrder.received", async () => {
    await resetBusinessStock();
    const pair = { businessId: ID.biz, productId: ID.productA, warehouseId: ID.warehouse2 };
    expect(await db.inventoryStock.count({ where: pair }), 'product A has no stock row in the second warehouse').toBe(0);
    const po = await claimPurchaseOrder('SHIPPED', { productId: ID.productA, warehouseId: ID.warehouse2 });
    const received = countReceivedEvents();
    const gate = holdPurchaseOrderReads(2);
    try {
      const answers = await Promise.all([receiveAnswer(po.id), receiveAnswer(po.id)]);
      gate.restore();
      const rows = await db.inventoryStock.findMany({ where: pair });
      // At 92468080 the other was refused with '400: Cannot transition PO from RECEIVED to RECEIVED'.
      expect({
        statusesRead: gate.statusesRead(),
        answers: [...answers].sort(),
        rows: rows.map((r: any) => `${r.quantity}/${r.reserved}/${r.costPerUnit}`),
        receiptMovements: await receiptMovementsOf(po.id),
        ledgerPostings: await ledgerPostingsOf(po.id),
        receivedEvents: received.of(po.id),
        status: (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status,
      }).toEqual({
        statusesRead: ['SHIPPED', 'SHIPPED'],
        answers: [CLAIM_LOST, 'committed'],
        rows: ['3/0/2'],
        receiptMovements: 1,
        ledgerPostings: 1,
        receivedEvents: 1,
        status: 'RECEIVED',
      });
    } finally {
      gate.restore();
      received.stop();
      await resetBusinessStock();
    }
  });

  it("RC-32 (W11-PO-RECEIPT-CLAIM; packet case RC-29) two status changes at once from SUBMITTED, one to ACKNOWLEDGED and one to DRAFT, each having read it SUBMITTED before either writes: exactly one wins and the purchase order ends in the winner's status (acknowledgedAt set only if ACKNOWLEDGED won); the other answers 409", async () => {
    const po = await claimPurchaseOrder('SUBMITTED', { productId: ID.productA, warehouseId: ID.warehouse });
    const move = (to: string) =>
      routeAnswer(routing.advancePurchaseOrderStatus(ID.biz, po.id, to as any).then((r: any) => `moved to ${r?.status}`));
    const gate = holdPurchaseOrderReads(2);
    try {
      const answers = (await Promise.all([move('ACKNOWLEDGED'), move('DRAFT')])) as string[];
      gate.restore();
      const winners = answers.filter((a) => a.startsWith('moved to ')).map((a) => a.slice('moved to '.length));
      const after = await db.purchaseOrder.findUnique({ where: { id: po.id } });
      // At 92468080 both answered (the non-RECEIVED update did not compare the status it read): the purchase order ended
      // in whichever wrote last.
      expect({ statusesRead: gate.statusesRead(), winners: winners.length, losers: answers.filter((a) => !a.startsWith('moved to ')) }).toEqual({
        statusesRead: ['SUBMITTED', 'SUBMITTED'],
        winners: 1,
        losers: [CLAIM_LOST],
      });
      expect(['ACKNOWLEDGED', 'DRAFT']).toContain(winners[0]);
      expect({ status: after.status, acknowledgedAt: after.acknowledgedAt !== null }).toEqual({
        status: winners[0],
        acknowledgedAt: winners[0] === 'ACKNOWLEDGED',
      });
    } finally {
      gate.restore();
    }
  });

  it("RC-33 (W11-PO-RECEIPT-CLAIM; packet case RC-30, a characterization) a second RECEIVED made after the first committed still answers 400 'Cannot transition PO from RECEIVED to RECEIVED' and writes nothing: no stock row, movement, ledger posting or purchaseOrder.received, and the purchase order unchanged", async () => {
    await resetBusinessStock();
    const seededA = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    const po = await claimPurchaseOrder('SHIPPED', { productId: ID.productA, warehouseId: ID.warehouse });
    const received = countReceivedEvents();
    try {
      expect(await receiveAnswer(po.id)).toBe('committed');
      const poAfterFirst = JSON.stringify(await db.purchaseOrder.findUnique({ where: { id: po.id } }));
      const second = await answerAndWrites(() => receiveAnswer(po.id));
      expect({
        second,
        purchaseOrderUnchanged: JSON.stringify(await db.purchaseOrder.findUnique({ where: { id: po.id } })) === poAfterFirst,
        stockA: await stockOf(ID.stockA),
        receiptMovements: await receiptMovementsOf(po.id),
        ledgerPostings: await ledgerPostingsOf(po.id),
        receivedEvents: received.of(po.id),
      }).toEqual({
        second: { answer: '400: Cannot transition PO from RECEIVED to RECEIVED', stockRowsWritten: 0, movementsWritten: 0 },
        purchaseOrderUnchanged: true,
        stockA: `${IN_STOCK + 3}/0`,
        receiptMovements: 1,
        ledgerPostings: 1,
        receivedEvents: 1,
      });
    } finally {
      received.stop();
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { costPerUnit: seededA.costPerUnit } });
      await resetBusinessStock();
    }
  });
});

/** A transfer of product M as POST .../inventory/transfer runs it, as the route answers it ('committed', or the status and message). */
const transferMAnswer = (fromWarehouseId: string, toWarehouseId: string, quantity: number, note?: unknown) =>
  routeAnswer(
    transferByRoute(ID.biz, { productId: ID.productM, fromWarehouseId, toWarehouseId, quantity, ...(note === undefined ? {} : { note }) }),
  );
/** Every stock row of a (product, warehouse), whatever its business (raw SQL: no tenant filter): [businessId, quantity, reserved]. */
const rowsOfPair = async (productId: string, warehouseId: string) =>
  ((await db.$queryRaw`
    SELECT business_id, quantity, reserved FROM inventory_stocks WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}`) as any[]).map(
    (r) => [r.business_id, r.quantity, r.reserved],
  );
/** The 409 a stock row create gets where a row the business does not read holds its (product, warehouse) (D-137). */
const HELD_ELSEWHERE = '409: A stock row for this product and warehouse is held by another record; ask an operator to repair it';

describe('W11-STOCK-ROW-RACE a stock row created at once by two writers of the same business is retried once, not sent to an operator (D-137; real database)', () => {
  beforeAll(async () => {
    // Created after the suite's two warehouses, so the first stays the business's default (the receipt's fallback).
    await db.warehouse.create({ data: { id: ID.warehouse3, businessId: ID.biz, name: 'V18R Warehouse 3' } });
  });
  afterAll(async () => {
    await db.$executeRaw`DELETE FROM stock_movements WHERE warehouse_id = ${ID.warehouse3}`;
    await db.$executeRaw`DELETE FROM inventory_stocks WHERE warehouse_id = ${ID.warehouse3}`;
    await db.$executeRaw`DELETE FROM warehouses WHERE id = ${ID.warehouse3}`;
  });

  it("RC-34 (W11-STOCK-ROW-RACE; packet case RC-31; D-137 keeps the 409 for planted rows only) transfers of product M from the first and from the second warehouse into a third where M has no stock row yet, each held after its first stock write until both have made it: both commit, one row of the business in the third warehouse holding 2, each source row 1 lower, 4 movements, and neither answers 409 'ask an operator' (the row holding the pair is the business's own)", async () => {
    await resetBusinessStock();
    expect(await rowsOfPair(ID.productM, ID.warehouse3), 'M has no stock row in the third warehouse').toEqual([]);
    const hold = holdAfterFirstStockWrite(2, ['update']);
    try {
      const before = await stockState();
      const answers = await Promise.all([
        transferMAnswer(ID.warehouse, ID.warehouse3, 1, 'rc34 from the first'),
        transferMAnswer(ID.warehouse2, ID.warehouse3, 1, 'rc34 from the second'),
      ]);
      hold.restore();
      const after = await stockState();
      // Measured at fb00af1c and at 488b35d5: ['committed', '409: ... ask an operator to repair it'], the third
      // warehouse's row the business's own; retrying the refused transfer committed.
      expect({
        heldAfterFirstWrites: hold.firstWrites().slice(0, 2).sort(),
        answers: [...answers].sort(),
        newRows: await rowsOfPair(ID.productM, ID.warehouse3),
        sources: [await stockOf(ID.stockMLo), await stockOf(ID.stockMHi)],
        movementsWritten: after.movements - before.movements,
      }).toEqual({
        heldAfterFirstWrites: [ID.stockMLo, ID.stockMHi].sort(),
        answers: ['committed', 'committed'],
        newRows: [[ID.biz, 2, 0]],
        sources: [`${IN_STOCK - 1}/0`, `${IN_STOCK - 1}/0`],
        movementsWritten: 4,
      });
    } finally {
      hold.restore();
      await resetBusinessStock();
    }
  });

  it("RC-35 (W11-STOCK-ROW-RACE; packet case RC-32; D-137) a transfer of M into the third warehouse (no row yet) and a purchase order received with lines [A into its existing row, then M into the third warehouse], each held after reading no row of the new pair until the other has read too (the receipt after its first stock write): both commit, the new row holds the transferred plus the received quantity, and the purchase order is received once (RECEIVED, two RECEIPT movements, one ledger posting, one purchaseOrder.received)", async () => {
    await resetBusinessStock();
    expect(await rowsOfPair(ID.productM, ID.warehouse3), 'M has no stock row in the third warehouse').toEqual([]);
    const po = await db.purchaseOrder.create({
      data: {
        businessId: ID.biz,
        poNumber: `${P}po_${++orderSeq}_${Date.now()}`,
        status: 'SHIPPED',
        supplierName: 'V18R Supplier',
        items: [
          { productId: ID.productA, warehouseId: ID.warehouse, name: 'A', quantity: 3, unitPrice: 2, unitCost: 2, total: 6 },
          { productId: ID.productM, warehouseId: ID.warehouse3, name: 'M', quantity: 3, unitPrice: 2, unitCost: 2, total: 6 },
        ],
        subtotal: 12,
        shippingCost: 0,
        taxAmount: 0,
        total: 12,
        currency: 'TTD',
      },
    });
    const seededA = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    const received = countReceivedEvents();
    // Each transaction is held once it has read the new pair's row (none) until the other has read it too, so both
    // create it: the transfer reads it before its first stock write, the receipt after its first (line A's update). A
    // hold after each one's first stock write alone leaves the race to timing: the receipt reads its second line's row
    // after that hold, and saw the transfer's row when the transfer had committed first (measured: green once in two
    // runs at 488b35d5). A retried transaction (the third) passes the hold.
    const reads = new Map<number, string>();
    let allIn!: () => void;
    const gathered = new Promise<void>((resolve) => (allIn = resolve));
    const firstWrites = new Map<number, string>();
    const writes = hookStockWrites(async (no, args) => {
      if (!firstWrites.has(no)) firstWrites.set(no, String(args?.where?.id));
    });
    const hook = hookStockWrites(async (no, args) => {
      if (args?.where?.warehouseId !== ID.warehouse3 || reads.has(no)) return;
      reads.set(no, String(args?.where?.productId));
      if (reads.size >= 2) allIn();
      await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
    }, 'findFirst');
    try {
      const before = await stockState();
      const answers = await Promise.all([transferMAnswer(ID.warehouse, ID.warehouse3, 1, 'rc35'), receiveAnswer(po.id)]);
      hook.restore();
      writes.restore();
      const after = await stockState();
      // At 488b35d5 whichever created the third warehouse's row second answered '409: ... ask an operator to repair it'
      // (the transfer, or the receipt with the purchase order left SHIPPED).
      expect({
        bothReadTheNewPair: [...reads.values()].slice(0, 2),
        firstWrites: [...firstWrites.values()].slice(0, 2).sort(),
        answers,
        newRows: await rowsOfPair(ID.productM, ID.warehouse3),
        stockA: await stockOf(ID.stockA),
        transferSource: await stockOf(ID.stockMLo),
        status: (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status,
        receiptMovements: await receiptMovementsOf(po.id),
        ledgerPostings: await ledgerPostingsOf(po.id),
        receivedEvents: received.of(po.id),
        movementsWritten: after.movements - before.movements,
      }).toEqual({
        bothReadTheNewPair: [ID.productM, ID.productM],
        firstWrites: [ID.stockA, ID.stockMLo].sort(),
        answers: ['committed', 'committed'],
        newRows: [[ID.biz, 1 + 3, 0]],
        stockA: `${IN_STOCK + 3}/0`,
        transferSource: `${IN_STOCK - 1}/0`,
        status: 'RECEIVED',
        receiptMovements: 2,
        ledgerPostings: 1,
        receivedEvents: 1,
        movementsWritten: 4,
      });
    } finally {
      hook.restore();
      writes.restore();
      received.stop();
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { costPerUnit: seededA.costPerUnit } });
      await resetBusinessStock();
    }
  });

  it("RC-36 (W11-STOCK-ROW-RACE; packet case RC-33, a characterization; D-137 planted rows left for an operator) a pair a planted row holds (this business's id on the other business's product or warehouse) still answers 409 'ask an operator' for B's transfer, B's purchase order received and B's POST .../inventory, writes nothing, names no id, and runs each call's transaction once (the pair's holder is read and is not B's own row, so no run again)", async () => {
    await plantRows([
      [ID.plantedXBInB2, ID.productXB, ID.warehouseB2],
      [ID.plantedXB2InB, ID.productXB2, ID.warehouseB],
    ]);
    const outcomes: Record<string, unknown> = {};
    const runs: Record<string, number> = {};
    let poStatus: unknown;
    let planted: unknown;
    // Every interactive transaction the call runs on PrismaService.client ($transaction), counted; nothing held.
    const counted = async (name: string, call: () => Promise<unknown>) => {
      const hook = hookStockWrites(async () => undefined);
      try {
        outcomes[name] = await answerAndWrites(call);
      } finally {
        hook.restore();
      }
      runs[name] = hook.transactions();
    };
    try {
      await counted("B's transfer into B's second warehouse, where a planted row holds XB", () =>
        routeAnswer(
          transferByRoute(ID.bizB, { productId: ID.productXB, fromWarehouseId: ID.warehouseB, toWarehouseId: ID.warehouseB2, quantity: 2, note: 'rc36' }),
        ),
      );
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
      await counted("B's purchase order received into XB2 in B's warehouse, where a planted row holds it", () =>
        routeAnswer(routing.advancePurchaseOrderStatus(ID.bizB, po.id, 'RECEIVED').then((r: any) => ({ success: r?.status === 'RECEIVED' }))),
      );
      poStatus = (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status;
      await counted("B's POST .../inventory for XB2 in B's warehouse, where a planted row holds it", () =>
        upsertAnswer(upsertByRoute(ID.bizB, { productId: ID.productXB2, warehouseId: ID.warehouseB, quantity: 3 })),
      );
      planted = Object.fromEntries(
        (await db.inventoryStock.findMany({ where: { id: { in: [ID.plantedXBInB2, ID.plantedXB2InB] } } })).map((p: any) => [
          p.id,
          [p.businessId, p.quantity, p.reserved, p.costPerUnit],
        ]),
      );
    } finally {
      await removeRows([ID.plantedXBInB2, ID.plantedXB2InB]);
      await restoreOtherBusinessRow();
    }
    const refused = { answer: HELD_ELSEWHERE, stockRowsWritten: 0, movementsWritten: 0 };
    expect(outcomes).toEqual({
      "B's transfer into B's second warehouse, where a planted row holds XB": refused,
      "B's purchase order received into XB2 in B's warehouse, where a planted row holds it": refused,
      "B's POST .../inventory for XB2 in B's warehouse, where a planted row holds it": refused,
    });
    expect(JSON.stringify(outcomes), "no answer names an id of the suite's").not.toContain(P);
    expect(poStatus, 'the purchase order stays SHIPPED').toBe('SHIPPED');
    expect(planted, 'the planted rows untouched').toEqual({
      [ID.plantedXBInB2]: [ID.biz, IN_STOCK, 0, 5],
      [ID.plantedXB2InB]: [ID.biz, IN_STOCK, 0, 5],
    });
    // W11-STOCK-ROW-RACE review (SRR-CR-1; D-137): each call's transaction runs exactly once. retryOnOwnStockRowRace
    // reads the pair's holder after the 409 and finds another business_id (the planted row's), so the 409 is answered
    // straight away; only a pair the business's own row holds is run again (RC-34, RC-35, RC-38). Pinned at once, not
    // 'at most twice': with the holder read removed (every 409 run again), each call ran twice and still answered the
    // planted row's 409, which the earlier bound let pass. At 488b35d5 the upsert ran twice (SEC-UPS-1 ran every P2002
    // again).
    expect(runs).toEqual(Object.fromEntries(Object.keys(outcomes).map((name) => [name, 1])));
  });

  it("RC-37 (W11-STOCK-ROW-RACE; packet case RC-34) a transfer note that is not text (42, an object, an array, true), as the route's body or a KEY tool's arguments send it, is refused with 400 'Transfer note must be text' before anything is written; a text note is stored on both movements exactly as sent (not trimmed), and a transfer with no note or a null note commits with none", async () => {
    const probes: Array<[name: string, note: unknown]> = [
      ['note 42', 42],
      ['note {a: 1}', { a: 1 }],
      ["note ['x']", ['x']],
      ['note true', true],
      ['a text note, spaces kept', '  rc37 text  '],
      ['no note', undefined],
      ['a null note', null],
    ];
    const outcomes: Record<string, unknown> = {};
    const notes: Record<string, unknown> = {};
    try {
      for (const [name, note] of probes) {
        await resetBusinessStock();
        let ref: string | undefined;
        outcomes[name] = await answerAndWrites(() =>
          routeAnswer(
            transferByRoute(ID.biz, {
              productId: ID.productM,
              fromWarehouseId: ID.warehouse2,
              toWarehouseId: ID.warehouse,
              quantity: 2,
              ...(note === undefined ? {} : { note }),
            }).then((r: any) => {
              ref = r?.transferRef;
              return r;
            }),
          ),
        );
        if (ref) {
          notes[name] = (await db.stockMovement.findMany({ where: { businessId: ID.biz, referenceId: ref }, orderBy: { type: 'asc' } })).map(
            (m: any) => `${m.type}:${JSON.stringify(m.note)}`,
          );
        }
      }
    } finally {
      await resetBusinessStock();
    }
    const refused = { answer: '400: Transfer note must be text', stockRowsWritten: 0, movementsWritten: 0 };
    const committed = { answer: 'committed', stockRowsWritten: 2, movementsWritten: 2 };
    // At 488b35d5 the four answered 500 (PrismaClientValidationError on the movement's note), nothing written.
    expect(outcomes).toEqual({
      'note 42': refused,
      'note {a: 1}': refused,
      "note ['x']": refused,
      'note true': refused,
      'a text note, spaces kept': committed,
      'no note': committed,
      'a null note': committed,
    });
    expect(notes).toEqual({
      'a text note, spaces kept': ['TRANSFER_IN:"  rc37 text  "', 'TRANSFER_OUT:"  rc37 text  "'],
      'no note': ['TRANSFER_IN:null', 'TRANSFER_OUT:null'],
      'a null note': ['TRANSFER_IN:null', 'TRANSFER_OUT:null'],
    });
  });

  it("RC-38 (W11-STOCK-ROW-RACE review SRR-CR-2; D-137 keeps the 409 for planted rows only) a purchase order received with a line of M into the third warehouse (no row yet), held once it has read no row of that pair while POST .../inventory creates the business's own row there (5) and commits: the receipt loses the create, its transaction runs once more and adds to that row: it answers RECEIVED (not 409 'ask an operator'), the row holds 5 + 3, and the purchase order is received once (one RECEIPT movement, one ledger posting, one purchaseOrder.received)", async () => {
    await resetBusinessStock();
    expect(await rowsOfPair(ID.productM, ID.warehouse3), 'M has no stock row in the third warehouse').toEqual([]);
    const po = await claimPurchaseOrder('SHIPPED', { productId: ID.productM, warehouseId: ID.warehouse3 });
    const received = countReceivedEvents();
    // RC-35 always has the transfer lose (the receipt creates the row as soon as it is let go, while the transfer first
    // updates its source row), so the receipt's run again was never taken there. Here the receipt is the loser by
    // construction: it is held at its first read of the new pair (it has locked nothing of that pair: no row exists)
    // until the upsert, started only then, has created the row and committed. The receipt's run again (the third
    // transaction) passes the hold and repeats the W11-PO-RECEIPT-CLAIM status compare-and-set: its first run rolled
    // back, so the purchase order is still SHIPPED and is received once.
    let readByReceipt!: () => void;
    const receiptRead = new Promise<void>((resolve) => (readByReceipt = resolve));
    let letGo!: () => void;
    const upsertDone = new Promise<void>((resolve) => (letGo = resolve));
    let heldTransaction: number | undefined;
    let releasedBy: 'the upsert' | 'the window' | undefined;
    const hook = hookStockWrites(async (no, args) => {
      if (heldTransaction !== undefined || args?.where?.warehouseId !== ID.warehouse3) return;
      heldTransaction = no;
      readByReceipt();
      releasedBy = await Promise.race([upsertDone.then(() => 'the upsert' as const), sleep(HOLD_WINDOW_MS).then(() => 'the window' as const)]);
    }, 'findFirst');
    try {
      const before = await stockState();
      const receipt = receiveAnswer(po.id);
      const receiptHeldFirst = await Promise.race([receiptRead.then(() => true), sleep(HOLD_WINDOW_MS).then(() => false)]);
      const upsert = await upsertAnswer(upsertByRoute(ID.biz, { productId: ID.productM, warehouseId: ID.warehouse3, quantity: 5 }));
      letGo();
      const answer = await receipt;
      const transactions = hook.transactions();
      hook.restore();
      const after = await stockState();
      // With the receipt's retryOnOwnStockRowRace removed (its transaction run once): '409: ... ask an operator to
      // repair it', the purchase order SHIPPED, no RECEIPT movement, no ledger posting, no purchaseOrder.received.
      expect({
        receiptHeldFirst,
        releasedBy,
        upsert,
        receipt: answer,
        transactions,
        newRows: await rowsOfPair(ID.productM, ID.warehouse3),
        status: (await db.purchaseOrder.findUnique({ where: { id: po.id } })).status,
        receiptMovements: await receiptMovementsOf(po.id),
        ledgerPostings: await ledgerPostingsOf(po.id),
        receivedEvents: received.of(po.id),
        movementsWritten: after.movements - before.movements,
      }).toEqual({
        receiptHeldFirst: true,
        releasedBy: 'the upsert',
        upsert: 'committed',
        receipt: 'committed',
        // The receipt's first run, the upsert, the receipt's run again.
        transactions: 3,
        newRows: [[ID.biz, 5 + 3, 0]],
        status: 'RECEIVED',
        receiptMovements: 1,
        ledgerPostings: 1,
        receivedEvents: 1,
        // The receipt's one RECEIPT movement, and (W11-INV-SET-MOVEMENT, D-139; was 1) the upsert's SET movement for
        // the 5 it created the row with.
        movementsWritten: 2,
      });
    } finally {
      letGo();
      hook.restore();
      received.stop();
      await resetBusinessStock();
    }
  });
});

/**
 * W11-ORDER-CANCEL-RELEASE: PATCH /marketplace/businesses/:businessId/orders/:orderId/status as the route runs it
 * (MarketplaceController.updateOrderStatus), with the body as sent and the member's id.
 */
const marketStatusByRoute = (orderId: string, body: Record<string, unknown>) =>
  Promise.resolve().then(() => controller.updateOrderStatus(ID.biz, orderId, body, { user: { id: ID.owner } }));
/** The site route's handler (SiteController.updateOrderStatus) over the suite's StoreOrderService; built by the describe block below. */
let siteController: any;
/** PATCH /site/businesses/:businessId/orders/:orderId/status as the route runs it, with the body as sent and the member's id. */
const siteStatusByRoute = (orderId: string, status: string) =>
  Promise.resolve().then(() => siteController.updateOrderStatus(ID.biz, orderId, { status }, { user: { id: ID.owner } }));
/** A status edit's answer as the route gives it: '<status>/<paymentStatus>' of the order returned, else the HTTP status and message. */
const statusAnswer = (work: Promise<any>) =>
  work.then(
    (o: any) => `${o?.status}/${o?.paymentStatus}`,
    (err: any) =>
      typeof err?.getStatus === 'function' ? `${err.getStatus()}: ${err.message}` : `500: ${err?.code ?? err?.name}: ${err?.message}`,
  );
/** The store_order.cancelled events emitted for an order since `seen` was cleared, each as the status its payload carries. */
const cancelledEventsOf = (orderId: string) =>
  seen.filter((e) => e.name === 'store_order.cancelled' && e.payload?.order?.id === orderId).map((e) => e.payload.order.status);
/** The order's stored row as one comparable string (status, payment fields, metadata, updatedAt). */
const orderRowOf = async (orderId: string) => {
  const o = await db.marketplaceOrder.findUnique({ where: { id: orderId } });
  return JSON.stringify([o.status, o.paymentStatus, o.paymentMethod, o.paymentRef, o.metadata, o.updatedAt]);
};

/** A paid STANDARD order with one line of tracked A x2, routed: its LOCAL_STOCK route RESERVED and 2 of A reserved. */
async function routedOrderOfA2() {
  const order = await paidOrder([ID.productA]);
  await db.marketplaceOrderItem.updateMany({ where: { orderId: order.id }, data: { quantity: 2, total: PRICE * 2 } });
  expect((await routing.routeOrder(ID.biz, order.id)).length, 'routed').toBe(1);
  expect(await statusOf(order.id)).toBe('routed/PAID');
  expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:RESERVED']);
  expect(await stockOf(ID.stockA), '2 of A reserved').toBe(`${IN_STOCK}/2`);
  return order;
}

/**
 * A storefront order of tracked A x2 paid offline by the owner (the paid door decrements its stock) and routed by the
 * listener on store_order.paid: CONFIRMED / PAID, its route RESERVED, A at 8 with 2 reserved. The listener must be on the
 * bus (listenerOnTheBus).
 */
async function routedStorefrontOrderOfA2() {
  const placed = await storeOrders.createOrder({
    businessId: ID.biz,
    cartItems: [{ productId: ID.productA, quantity: 2 }],
    customerInfo: { name: 'Vee Router', email: CUSTOMER_EMAIL },
    paymentMethod: 'CASH',
  });
  expect(placed.type).toBe('STOREFRONT');
  await storeOrders.completeOfflineOrder(placed.id, ID.biz, ID.owner);
  await drain();
  expect(announcedFor(placed.id), 'routed by the listener').toEqual(['fulfillment_routed:1']);
  expect(await statusOf(placed.id)).toBe('CONFIRMED/PAID');
  expect(await routesOf(placed.id)).toEqual(['LOCAL_STOCK:RESERVED']);
  expect(await stockOf(ID.stockA), 'the paid door decremented 2, routing reserved 0 (F-36 / D-136)').toBe(`${IN_STOCK - 2}/0`);
  return placed;
}

/** W11-ORDER-CANCEL-RELEASE review OCR-COR-2: the 409 a status-edit cancel answers when the status it read changed before its write. */
const CANCEL_STATUS_CHANGED =
  "This order's status changed while it was being cancelled (it was shipped or edited meanwhile): nothing was written. " +
  'Reload the order and cancel it again if it can still be cancelled';
/** The store_order.* events emitted for an order since `seen` was cleared, by name. */
const eventsOfOrder = (orderId: string) => seen.filter((e) => e.payload?.order?.id === orderId).map((e) => e.name);

/**
 * W11-ORDER-CANCEL-RELEASE review OCR-COR-2: the cancel's interleave. A holder transaction locks the stock row
 * `heldRow`; `cancel` is started and runs until it waits behind the holder (it has taken the order's routing claim and
 * read its status, and waits to lock the row its route reserved from); `other` is started and awaited (a status edit
 * that takes no claim and locks no stock row commits while the cancel waits; bounded, so a party that waited too is
 * answered, not hung); then the holder lets go and the cancel finishes. Returns whether the cancel waited and both
 * answers.
 */
async function whileTheCancelWaits(heldRow: string, cancel: () => Promise<unknown>, other: () => Promise<unknown>) {
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
  let cancelAnswer: Promise<unknown> = Promise.resolve();
  let otherAnswer: unknown;
  let cancelWaited = false;
  try {
    cancelAnswer = answerOf(cancel());
    cancelWaited = await within(5_000, async () => (await waitingSessions()) >= 1);
    otherAnswer = await Promise.race([answerOf(other()), sleep(10_000).then(() => 'still waiting after 10 s')]);
  } finally {
    letGo();
    await holder;
  }
  return { cancelWaited, otherAnswer, cancelAnswer: await cancelAnswer };
}

describe('W11-ORDER-CANCEL-RELEASE a status edit that cancels an order takes the routing claim and releases its reservations (F-35, D-136; real database)', () => {
  beforeAll(async () => {
    const { SiteController } = await import('../src/modules/site/site.controller');
    siteController = new (SiteController as any)({}, storeOrders, {}, {}, {}, {}, {}, {}, {});
  });
  afterAll(async () => {
    await drain();
    await resetBusinessStock();
  });

  it("RC-39 (W11-ORDER-CANCEL-RELEASE; packet case RC-20; F-35) PATCH /marketplace/.../status cancelled ('cancelled', 'CANCELLED' as the web orders tab sends it, and ' Cancelled ') on a routed paid order with tracked A x2 releases it: its route CANCELLED, A reserved back to 0, the status stored as sent but trimmed (review SEC-W11OCR-1: ' Cancelled ' is stored 'Cancelled', which the closed-order money guards read as cancelled) with a cancelled step, the payment kept, and store_order.cancelled emitted once; a cancel carrying payment fields the member may write still writes them", async () => {
    for (const sent of ['cancelled', 'CANCELLED', ' Cancelled ']) {
      await setStock(ID.stockA, IN_STOCK);
      const order = await routedOrderOfA2();
      seen = [];
      const answer = await statusAnswer(marketStatusByRoute(order.id, { status: sent }));
      // At bb316619: stored as sent with its route RESERVED and A at 10/2 (held for good), no cancelled step, and
      // ' Cancelled ' emitted no store_order.cancelled. Review SEC-W11OCR-1: at 3fdf2399 ' Cancelled ' was released and
      // announced cancelled but stored with its spaces, which isClosedStorefrontOrder (upper-cased, not trimmed) does
      // not read as cancelled, so the paid doors recorded a payment on it.
      const stored = sent.trim();
      expect(
        {
          answer,
          stored: await statusOf(order.id),
          routes: await routesOf(order.id),
          stockA: await stockOf(ID.stockA),
          cancelledEvents: cancelledEventsOf(order.id),
          lastStep: (await stepsOf(order.id)).at(-1),
        },
        JSON.stringify(sent),
      ).toEqual({
        answer: `${stored}/PAID`,
        stored: `${stored}/PAID`,
        routes: ['LOCAL_STOCK:CANCELLED'],
        stockA: `${IN_STOCK}/0`,
        cancelledEvents: [stored],
        lastStep: 'cancelled',
      });
    }

    // Payment fields the member may write (an order not on the doors, not paid) are written as today, with the cancel.
    await setStock(ID.stockA, IN_STOCK);
    const unpaid = await orderWithLines([ID.productA], { status: 'placed', paymentStatus: 'UNPAID' });
    expect((await routing.routeOrder(ID.biz, unpaid.id)).length, 'a placed order is routed too (no status advance)').toBe(1);
    expect(await stockOf(ID.stockA)).toBe(`${IN_STOCK}/1`);
    seen = [];
    const answer = await statusAnswer(marketStatusByRoute(unpaid.id, { status: 'CANCELLED', paymentStatus: 'pending', paymentMethod: 'cash' }));
    const stored = await db.marketplaceOrder.findUnique({ where: { id: unpaid.id } });
    expect({
      answer,
      stored: `${stored.status}/${stored.paymentStatus}/${stored.paymentMethod}`,
      routes: await routesOf(unpaid.id),
      stockA: await stockOf(ID.stockA),
      cancelledEvents: cancelledEventsOf(unpaid.id),
      lastStep: (await stepsOf(unpaid.id)).at(-1),
    }).toEqual({
      answer: 'CANCELLED/PENDING',
      stored: 'CANCELLED/PENDING/cash',
      routes: ['LOCAL_STOCK:CANCELLED'],
      stockA: `${IN_STOCK}/0`,
      cancelledEvents: ['CANCELLED'],
      lastStep: 'cancelled',
    });
  }, 30_000);

  it("RC-40 (W11-ORDER-CANCEL-RELEASE; packet case RC-21) PATCH /marketplace/.../status 'cancelled' while routeOrder is held where it reserves (RC-06's hold): the edit waits for the router, then releases; the order ends cancelled with its route CANCELLED, nothing reserved and no 'routed' written over it (the router's 'routed' step comes before the cancelled one)", async () => {
    const order = await paidOrder([ID.productA]);
    const real = routing.routeLocalStock.bind(routing);
    let cancelDone!: () => void;
    const cancelled = new Promise<void>((resolve) => (cancelDone = resolve));
    let arrived!: () => void;
    const reserved = new Promise<void>((resolve) => (arrived = resolve));
    // The router is held after it has reserved and made its route (not committed) until the edit has returned, or the
    // window passes.
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
    seen = [];
    const answer = await statusAnswer(marketStatusByRoute(order.id, { status: 'cancelled' }));
    cancelDone();
    expect(await routingDone, 'the router committed its route').toBe(1);
    // At bb316619: answered cancelled at once; the router then committed its RESERVED route and 1 reserved on the
    // cancelled order.
    const steps = await stepsOf(order.id);
    expect({
      answer,
      stored: await statusOf(order.id),
      routes: await routesOf(order.id),
      stockA: await stockOf(ID.stockA),
      cancelledEvents: cancelledEventsOf(order.id),
      // The router's 'routed' (it committed first, the order still paid) comes before the cancel, never after it.
      routedBeforeCancelled: steps.lastIndexOf('routed') < steps.lastIndexOf('cancelled'),
      cancelledAfterRouting: steps.lastIndexOf('cancelled') > steps.indexOf('routes_created'),
    }).toEqual({
      answer: 'cancelled/PAID',
      stored: 'cancelled/PAID',
      routes: ['LOCAL_STOCK:CANCELLED'],
      stockA: `${IN_STOCK}/0`,
      cancelledEvents: ['cancelled'],
      routedBeforeCancelled: true,
      cancelledAfterRouting: true,
    });
  }, 30_000);

  it("RC-41 (W11-ORDER-CANCEL-RELEASE; packet case RC-22; D-136) PATCH /marketplace/.../status 'cancelled' or 'CANCELLED' on an order stored shipped, delivered, completed, cancelled or refunded (or the storefront's SHIPPED, DELIVERED, CANCELLED) is refused with 400 and writes nothing: the order row, its route and its reservation as they were, and no event", async () => {
    for (const storedStatus of ['shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'SHIPPED', 'DELIVERED', 'CANCELLED']) {
      await setStock(ID.stockA, IN_STOCK);
      const order = await paidOrder([ID.productA]);
      expect((await routing.routeOrder(ID.biz, order.id)).length).toBe(1);
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: storedStatus } });
      const before = await orderRowOf(order.id);
      seen = [];
      const answers: string[] = [];
      for (const sent of ['cancelled', 'CANCELLED']) answers.push(await statusAnswer(marketStatusByRoute(order.id, { status: sent })));
      // At bb316619: both answered '<sent>/PAID' and stored, the route RESERVED and the unit reserved on a closed order.
      expect(
        {
          answers,
          row: await orderRowOf(order.id),
          routes: await routesOf(order.id),
          stockA: await stockOf(ID.stockA),
          events: seen.map((e) => e.name),
        },
        storedStatus,
      ).toEqual({
        answers: [`400: Cannot cancel order in ${storedStatus} status`, `400: Cannot cancel order in ${storedStatus} status`],
        row: before,
        routes: ['LOCAL_STOCK:RESERVED'],
        stockA: `${IN_STOCK}/1`,
        events: [],
      });
    }
  }, 30_000);

  it('RC-42 (W11-ORDER-CANCEL-RELEASE; packet case RC-23) a CONFIRMED / PAID storefront order (paid offline, its stock decremented by the paid door) routed by the listener, then PATCH /site/.../status CANCELLED (and \' cancelled \'): its route CANCELLED and its reservation released (the decremented quantity is not restocked), stored CANCELLED / PAID with a cancelled step and one store_order.cancelled; a SHIPPED, DELIVERED, COMPLETED, CANCELLED or REFUNDED storefront order is 400 with nothing written and no event; control: a PENDING one is cancelled', async () => {
    const off = listenerOnTheBus();
    try {
      for (const sent of ['CANCELLED', ' cancelled ']) {
        await setStock(ID.stockA, IN_STOCK);
        const placed = await routedStorefrontOrderOfA2();
        seen = [];
        const answer = await statusAnswer(siteStatusByRoute(placed.id, sent));
        // At bb316619: stored CANCELLED with its route RESERVED and A at 8/2 (the reservation held for good).
        expect(
          {
            answer,
            stored: await statusOf(placed.id),
            routes: await routesOf(placed.id),
            stockA: await stockOf(ID.stockA),
            cancelledEvents: cancelledEventsOf(placed.id),
            lastStep: (await stepsOf(placed.id)).at(-1),
          },
          JSON.stringify(sent),
        ).toEqual({
          answer: 'CANCELLED/PAID',
          stored: 'CANCELLED/PAID',
          routes: ['LOCAL_STOCK:CANCELLED'],
          stockA: `${IN_STOCK - 2}/0`,
          cancelledEvents: ['CANCELLED'],
          lastStep: 'cancelled',
        });
      }

      for (const storedStatus of ['SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED']) {
        await setStock(ID.stockA, IN_STOCK);
        const placed = await routedStorefrontOrderOfA2();
        await db.marketplaceOrder.update({ where: { id: placed.id }, data: { status: storedStatus } });
        const before = await orderRowOf(placed.id);
        seen = [];
        const answer = await statusAnswer(siteStatusByRoute(placed.id, 'CANCELLED'));
        // At bb316619: 'CANCELLED/PAID', written over the closed order with its reservation held.
        expect(
          {
            answer,
            row: await orderRowOf(placed.id),
            routes: await routesOf(placed.id),
            stockA: await stockOf(ID.stockA),
            events: seen.map((e) => e.name),
          },
          storedStatus,
        ).toEqual({
          answer: `400: Cannot cancel order in ${storedStatus} status`,
          row: before,
          routes: ['LOCAL_STOCK:RESERVED'],
          stockA: `${IN_STOCK - 2}/0`,
          events: [],
        });
      }

      // Control: a PENDING storefront order (a CASH order not paid yet, PENDING / PENDING; not routed) is cancelled.
      const pending = await storeOrders.createOrder({
        businessId: ID.biz,
        cartItems: [{ productId: ID.productA, quantity: 1 }],
        customerInfo: { name: 'Vee Router', email: CUSTOMER_EMAIL },
        paymentMethod: 'CASH',
      });
      await drain();
      seen = [];
      expect(await statusOf(pending.id)).toBe('PENDING/PENDING');
      expect(await statusAnswer(siteStatusByRoute(pending.id, 'cancelled'))).toBe('CANCELLED/PENDING');
      expect(await routesOf(pending.id)).toEqual([]);
      expect(cancelledEventsOf(pending.id)).toEqual(['CANCELLED']);
    } finally {
      off();
      await drain();
    }
  }, 30_000);

  it("RC-43 (W11-ORDER-CANCEL-RELEASE review OCR-COR-1; D-136) an open order stored with a spelling outside canTransitionOrder's case-sensitive vocabulary ('processing', 'pending', 'confirmed', 'Processing', ' routed ', 'on_hold'), written by PATCH /marketplace/.../status as sent, is cancelled by PATCH /marketplace/.../status 'cancelled' and by PATCH /site/.../status CANCELLED and released (route CANCELLED, A reserved back to 0, one store_order.cancelled); a closed status in any case ('Shipped', ' delivered ', 'Completed', 'REFUNDED') is still 400 with nothing written and no event", async () => {
    for (const spelling of ['processing', 'pending', 'confirmed', 'Processing', ' routed ', 'on_hold']) {
      await setStock(ID.stockA, IN_STOCK);
      const order = await routedOrderOfA2();
      // W1F-ORDER-TRANSITIONS review R1-SEC-01: PATCH /marketplace/.../status trims surrounding spaces while keeping
      // caller casing. For padded spellings (e.g. legacy pre-R1 rows stored ' routed '), seed the padded value directly
      // after verifying PATCH trims it so cancel-of-padded-row coverage stays intact.
      expect(await statusAnswer(marketStatusByRoute(order.id, { status: spelling })), JSON.stringify(spelling)).toBe(`${spelling.trim()}/PAID`);
      if (spelling !== spelling.trim()) {
        await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: spelling } });
      }
      seen = [];
      const answer = await statusAnswer(marketStatusByRoute(order.id, { status: 'cancelled' }));
      // At 3fdf2399: 400 'Cannot cancel order in <spelling> status', the order left open with its route RESERVED and A at
      // 10/2; the fulfil 'cancel' refuses it too, so no route could cancel it. At bb316619 the edit cancelled it.
      expect(
        {
          answer,
          stored: await statusOf(order.id),
          routes: await routesOf(order.id),
          stockA: await stockOf(ID.stockA),
          cancelledEvents: cancelledEventsOf(order.id),
          lastStep: (await stepsOf(order.id)).at(-1),
        },
        JSON.stringify(spelling),
      ).toEqual({
        answer: 'cancelled/PAID',
        stored: 'cancelled/PAID',
        routes: ['LOCAL_STOCK:CANCELLED'],
        stockA: `${IN_STOCK}/0`,
        cancelledEvents: ['cancelled'],
        lastStep: 'cancelled',
      });
    }

    // The site route: a storefront order the marketplace route moved to 'processing' (its own spelling), then PATCH
    // /site CANCELLED.
    const off = listenerOnTheBus();
    try {
      await setStock(ID.stockA, IN_STOCK);
      const placed = await routedStorefrontOrderOfA2();
      expect(await statusAnswer(marketStatusByRoute(placed.id, { status: 'processing' }))).toBe('processing/PAID');
      seen = [];
      const answer = await statusAnswer(siteStatusByRoute(placed.id, 'CANCELLED'));
      // At 3fdf2399: 400 'Cannot cancel order in processing status', its reservation held.
      expect({
        answer,
        stored: await statusOf(placed.id),
        routes: await routesOf(placed.id),
        stockA: await stockOf(ID.stockA),
        cancelledEvents: cancelledEventsOf(placed.id),
      }).toEqual({
        answer: 'CANCELLED/PAID',
        stored: 'CANCELLED/PAID',
        routes: ['LOCAL_STOCK:CANCELLED'],
        stockA: `${IN_STOCK - 2}/0`,
        cancelledEvents: ['CANCELLED'],
      });
    } finally {
      off();
      await drain();
    }

    // Control (D-136): a closed status in any case, with any surrounding spaces, is not cancelled by either status edit.
    for (const storedStatus of ['Shipped', ' delivered ', 'Completed', 'REFUNDED']) {
      await setStock(ID.stockA, IN_STOCK);
      const order = await paidOrder([ID.productA]);
      expect((await routing.routeOrder(ID.biz, order.id)).length).toBe(1);
      await db.marketplaceOrder.update({ where: { id: order.id }, data: { status: storedStatus } });
      const before = await orderRowOf(order.id);
      seen = [];
      const answers = [
        await statusAnswer(marketStatusByRoute(order.id, { status: 'cancelled' })),
        await statusAnswer(siteStatusByRoute(order.id, 'CANCELLED')),
      ];
      expect(
        { answers, row: await orderRowOf(order.id), routes: await routesOf(order.id), stockA: await stockOf(ID.stockA), events: seen.map((e) => e.name) },
        JSON.stringify(storedStatus),
      ).toEqual({
        answers: [`400: Cannot cancel order in ${storedStatus} status`, `400: Cannot cancel order in ${storedStatus} status`],
        row: before,
        routes: ['LOCAL_STOCK:RESERVED'],
        stockA: `${IN_STOCK}/1`,
        events: [],
      });
    }
  }, 60_000);

  it("RC-44 (W11-ORDER-CANCEL-RELEASE review OCR-COR-2, SEC-W11OCR-2; D-136) a ship that commits while a status-edit cancel waits (the cancel has taken the claim and read the order open, and waits to lock the stock row its route reserved from): PATCH /marketplace/.../status 'shipped' answers 200 and the cancel is then refused 409 with nothing written (the order stored shipped, its route RESERVED and its unit reserved, no store_order.cancelled, no cancelled step); the same for PATCH /site/.../status SHIPPED while CANCELLED waits", async () => {
    await setStock(ID.stockA, IN_STOCK);
    const order = await routedOrderOfA2();
    seen = [];
    const race = await whileTheCancelWaits(
      ID.stockA,
      () => statusAnswer(marketStatusByRoute(order.id, { status: 'cancelled' })),
      () => statusAnswer(marketStatusByRoute(order.id, { status: 'shipped' })),
    );
    // At 3fdf2399: the cancel answered 200 'cancelled/PAID' after the ship's 200: stored cancelled with its route
    // CANCELLED and A at 10/0, events [store_order.shipped, store_order.cancelled].
    expect({
      ...race,
      stored: await statusOf(order.id),
      routes: await routesOf(order.id),
      stockA: await stockOf(ID.stockA),
      events: eventsOfOrder(order.id),
      cancelledStep: (await stepsOf(order.id)).includes('cancelled'),
    }).toEqual({
      cancelWaited: true,
      otherAnswer: 'shipped/PAID',
      cancelAnswer: `409: ${CANCEL_STATUS_CHANGED}`,
      stored: 'shipped/PAID',
      routes: ['LOCAL_STOCK:RESERVED'],
      stockA: `${IN_STOCK}/2`,
      events: ['store_order.shipped'],
      cancelledStep: false,
    });

    const off = listenerOnTheBus();
    try {
      await setStock(ID.stockA, IN_STOCK);
      const placed = await routedStorefrontOrderOfA2();
      // Under F-36 (W11-STOREFRONT-ROUTE-DECREMENTED), new storefront routes carry
      // noReservationRequired: true and take no stock lock on cancel. To keep exercising
      // the PATCH /site CANCELLED vs SHIPPED CAS race while waiting on ID.stockA (as for a
      // legacy pre-D-137 storefront route holding a reservation), attach a reserved route.
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { reserved: 2 } });
      await db.fulfillmentRoute.updateMany({
        where: { businessId: ID.biz, orderId: placed.id },
        data: { metadata: { inventoryMode: 'tracked' } },
      });
      seen = [];
      const siteRace = await whileTheCancelWaits(
        ID.stockA,
        () => statusAnswer(siteStatusByRoute(placed.id, 'CANCELLED')),
        () => statusAnswer(siteStatusByRoute(placed.id, 'SHIPPED')),
      );
      // At 3fdf2399: 200 'CANCELLED/PAID' written over the SHIPPED order, its reservation released.
      expect({
        ...siteRace,
        stored: await statusOf(placed.id),
        routes: await routesOf(placed.id),
        stockA: await stockOf(ID.stockA),
        events: eventsOfOrder(placed.id),
        cancelledStep: (await stepsOf(placed.id)).includes('cancelled'),
      }).toEqual({
        cancelWaited: true,
        otherAnswer: 'SHIPPED/PAID',
        cancelAnswer: `409: ${CANCEL_STATUS_CHANGED}`,
        stored: 'SHIPPED/PAID',
        routes: ['LOCAL_STOCK:RESERVED'],
        stockA: `${IN_STOCK - 2}/2`,
        events: ['store_order.shipped'],
        cancelledStep: false,
      });
    } finally {
      off();
      await drain();
    }
  }, 60_000);
});

/** W11-INV-SET-MOVEMENT: a member of the business other than its owner (an id as AuthGuard sets it; stock_movements.created_by has no foreign key). */
const SET_MEMBER = `${P}member_set`;
/** The suite's stock movements a call added, oldest first: [type, reasonCode, quantityChange, createdBy, referenceId, businessId, productId, warehouseId, note]. */
async function movementsAddedBy(call: () => Promise<unknown>) {
  const suiteMovements = (): Promise<any[]> =>
    db.$queryRawUnsafe(
      `SELECT id, type, reason_code, quantity_change, created_by, reference_id, business_id, product_id, warehouse_id, note FROM stock_movements
        WHERE business_id LIKE ${sqlLikePrefix(P)} OR product_id LIKE ${sqlLikePrefix(P)} OR warehouse_id LIKE ${sqlLikePrefix(P)}
        ORDER BY created_at, id`,
    );
  const before = new Set((await suiteMovements()).map((m) => m.id));
  const answer = await call();
  const added = (await suiteMovements())
    .filter((m) => !before.has(m.id))
    .map((m) => [m.type, m.reason_code, m.quantity_change, m.created_by, m.reference_id, m.business_id, m.product_id, m.warehouse_id, m.note]);
  return { answer, added };
}
/** A stock row as stored: [quantity, reserved, reorderAt, costPerUnit], or null when the pair has no row. */
const pairRow = async (productId: string, warehouseId: string) => {
  const rows = await db.inventoryStock.findMany({ where: { productId, warehouseId } });
  return rows.length === 0 ? null : rows.map((r: any) => [r.businessId, r.quantity, r.reserved, r.reorderAt, r.costPerUnit]);
};
/**
 * The same, its counts alone: [businessId, quantity, reserved]. For the suite's seeded rows, whose cost and reorder
 * level earlier cases of this file leave as their receipts and sets made them.
 */
const pairCounts = async (productId: string, warehouseId: string) =>
  ((await pairRow(productId, warehouseId)) as any[] | null)?.map((r) => r.slice(0, 3)) ?? null;
/** An inventory import workbook in the template's columns (getInventoryExcelTemplate), one row per record. */
async function inventoryWorkbook(rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const headers = ['SKU', 'Product Name', 'Warehouse', 'Quantity On Hand', 'Reserved', 'Reorder Level', 'Cost Per Unit', 'Currency'];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  ws.addRow(headers);
  for (const row of rows) ws.addRow(headers.map((h) => row[h] ?? null));
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
/** An upsert's answer with the stable code its refusal carries: '<status> <code>: <message>'. */
const upsertAnswerWithCode = (work: Promise<unknown>) =>
  work.then(
    (row: any) => (typeof row?.id === 'string' ? 'committed' : row),
    (err: any) =>
      typeof err?.getStatus === 'function' ? `${err.getStatus()} ${(err.getResponse() as any)?.code}: ${err.message}` : `500: ${err?.code ?? err?.name}`,
  );

describe('W11-INV-SET-MOVEMENT a direct stock set writes one ADJUSTMENT movement with its actor and protects reserved (D-139; real database)', () => {
  const A = { productId: ID.productA, warehouseId: ID.warehouse };
  const NEW = { productId: ID.productU, warehouseId: ID.warehouse2 };
  const setMovement = (change: number, pair: { productId: string; warehouseId: string }, member = SET_MEMBER) => [
    'ADJUSTMENT',
    'SET',
    change,
    member,
    null,
    ID.biz,
    pair.productId,
    pair.warehouseId,
    null,
  ];
  afterEach(async () => {
    await resetBusinessStock();
  });

  it('RC-45 (W11-INV-SET-MOVEMENT; D-139) POST .../inventory setting an existing row from 10 to 7, then to 12, writes one ADJUSTMENT movement each (reasonCode SET, the difference -3 then +5, createdBy the acting member, referenceId null, the row\'s business, product and warehouse), in the transaction of the stock write; a set to the stored quantity, and a body naming no quantity (reorderAt and cost only), write none', async () => {
    await resetBusinessStock();
    const seeded = await db.inventoryStock.findUnique({ where: { id: ID.stockA } });
    const outcomes: Record<string, unknown> = {};
    let row: unknown;
    try {
      outcomes['10 to 7'] = await movementsAddedBy(() => upsertAnswer(upsertByRoute(ID.biz, { ...A, quantity: '7' }, SET_MEMBER)));
      outcomes['7 to 12, by the owner'] = await movementsAddedBy(() => upsertAnswer(upsertByRoute(ID.biz, { ...A, quantity: 12 }, ID.owner)));
      outcomes['12 to 12'] = await movementsAddedBy(() => upsertAnswer(upsertByRoute(ID.biz, { ...A, quantity: 12 }, SET_MEMBER)));
      outcomes['no quantity named'] = await movementsAddedBy(() => upsertAnswer(upsertByRoute(ID.biz, { ...A, reorderAt: 2, costPerUnit: 1.5 }, SET_MEMBER)));
      row = await pairRow(A.productId, A.warehouseId);
    } finally {
      await db.inventoryStock.update({ where: { id: ID.stockA }, data: { reorderAt: seeded.reorderAt, costPerUnit: seeded.costPerUnit } });
    }
    // At 5c17e7b4 (the base) every one of these committed with no movement, and the controller passed no member.
    expect(outcomes).toEqual({
      '10 to 7': { answer: 'committed', added: [setMovement(-3, A)] },
      '7 to 12, by the owner': { answer: 'committed', added: [setMovement(5, A, ID.owner)] },
      '12 to 12': { answer: 'committed', added: [] },
      'no quantity named': { answer: 'committed', added: [] },
    });
    expect(row, 'the row holds the last set and the fields sent').toEqual([[ID.biz, 12, 0, 2, 1.5]]);
  });

  it('RC-46 (W11-INV-SET-MOVEMENT; D-139) POST .../inventory for a pair with no row creates it and writes one ADJUSTMENT/SET movement for its whole quantity naming the member; a new row created with quantity 0, or with no quantity named, writes none', async () => {
    const outcomes: Record<string, unknown> = {};
    const rows: Record<string, unknown> = {};
    for (const [name, body] of [
      ['new row holding 3', { ...NEW, quantity: 3 }],
      ['new row holding 0', { ...NEW, quantity: 0 }],
      ['new row, no quantity named', { ...NEW, reorderAt: 1 }],
    ] as Array<[string, Record<string, unknown>]>) {
      await resetBusinessStock();
      outcomes[name] = await movementsAddedBy(() => upsertAnswer(upsertByRoute(ID.biz, body, SET_MEMBER)));
      rows[name] = await pairRow(NEW.productId, NEW.warehouseId);
    }
    expect(outcomes).toEqual({
      'new row holding 3': { answer: 'committed', added: [setMovement(3, NEW)] },
      'new row holding 0': { answer: 'committed', added: [] },
      'new row, no quantity named': { answer: 'committed', added: [] },
    });
    expect(rows).toEqual({
      'new row holding 3': [[ID.biz, 3, 0, null, null]],
      'new row holding 0': [[ID.biz, 0, 0, null, null]],
      'new row, no quantity named': [[ID.biz, 0, 0, 1, null]],
    });
  });

  it('RC-47 (W11-INV-SET-MOVEMENT; D-139) POST .../inventory with a quantity below the row\'s reserved quantity (10 in stock, 4 reserved: 3, 0, and 3 as the web form\'s text) is refused with 400 and writes nothing (no stock row change, no movement); a quantity equal to reserved, and one above it, commit with their movement and leave reserved as it was', async () => {
    const outcomes: Record<string, unknown> = {};
    const rows: Record<string, unknown> = {};
    for (const [name, quantity] of [
      ['3 with 4 reserved', 3],
      ["'3' with 4 reserved", '3'],
      ['0 with 4 reserved', 0],
      ['4 with 4 reserved', 4],
      ['6 with 4 reserved', 6],
    ] as Array<[string, unknown]>) {
      await resetBusinessStock();
      await setStock(ID.stockA, IN_STOCK, 4);
      const writes = await answerAndWrites(() => movementsAddedBy(() => upsertAnswerWithCode(upsertByRoute(ID.biz, { ...A, quantity }, SET_MEMBER))));
      outcomes[name] = { ...(writes.answer as object), stockRowsWritten: writes.stockRowsWritten };
      rows[name] = await pairCounts(A.productId, A.warehouseId);
    }
    const refused = {
      answer: '400 QUANTITY_BELOW_RESERVED: Inventory quantity cannot be less than the quantity reserved for orders (4)',
      added: [],
      stockRowsWritten: 0,
    };
    // At 5c17e7b4 all five committed: a count below reserved left the row with more reserved than it holds.
    expect(outcomes).toEqual({
      '3 with 4 reserved': refused,
      "'3' with 4 reserved": refused,
      '0 with 4 reserved': refused,
      '4 with 4 reserved': { answer: 'committed', added: [setMovement(-6, A)], stockRowsWritten: 1 },
      '6 with 4 reserved': { answer: 'committed', added: [setMovement(-4, A)], stockRowsWritten: 1 },
    });
    expect(rows).toEqual({
      '3 with 4 reserved': [[ID.biz, IN_STOCK, 4]],
      "'3' with 4 reserved": [[ID.biz, IN_STOCK, 4]],
      '0 with 4 reserved': [[ID.biz, IN_STOCK, 4]],
      '4 with 4 reserved': [[ID.biz, 4, 4]],
      '6 with 4 reserved': [[ID.biz, 6, 4]],
    });
  });

  it("RC-48 (W11-INV-SET-MOVEMENT; D-139 reserved is not hand-editable) POST .../inventory with a body naming reserved is refused with 400 RESERVED_NOT_EDITABLE, writing nothing, when it differs from the stored value (0, 5 or '9' on a row with 4 reserved, with or without a quantity; 2 for a pair with no row); naming the stored value (4 or '4'; 0 for a new pair) is accepted and reserved stays what order reservations made it", async () => {
    const outcomes: Record<string, unknown> = {};
    const rows: Record<string, unknown> = {};
    const probes: Array<[string, { productId: string; warehouseId: string }, Record<string, unknown>]> = [
      ['existing row: reserved 0 (clearing it)', A, { reserved: 0 }],
      ['existing row: reserved 5 with quantity 8', A, { reserved: 5, quantity: 8 }],
      ["existing row: reserved '9' with quantity 20", A, { reserved: '9', quantity: 20 }],
      ['existing row: reserved 4 (the stored value) with quantity 8', A, { reserved: 4, quantity: 8 }],
      ["existing row: reserved '4' (the stored value) alone", A, { reserved: '4' }],
      ['new pair: reserved 2 with quantity 5', NEW, { reserved: 2, quantity: 5 }],
      ['new pair: reserved 0 with quantity 5', NEW, { reserved: 0, quantity: 5 }],
    ];
    for (const [name, pair, fields] of probes) {
      await resetBusinessStock();
      await setStock(ID.stockA, IN_STOCK, 4);
      const writes = await answerAndWrites(() => movementsAddedBy(() => upsertAnswerWithCode(upsertByRoute(ID.biz, { ...pair, ...fields }, SET_MEMBER))));
      outcomes[name] = { ...(writes.answer as object), stockRowsWritten: writes.stockRowsWritten };
      rows[name] = await pairCounts(pair.productId, pair.warehouseId);
    }
    const refused = {
      answer: '400 RESERVED_NOT_EDITABLE: Inventory reserved cannot be set directly; only order reservations change it',
      added: [],
      stockRowsWritten: 0,
    };
    // At 5c17e7b4 all seven committed, the first clearing the 4 units routes held reserved.
    expect(outcomes).toEqual({
      'existing row: reserved 0 (clearing it)': refused,
      'existing row: reserved 5 with quantity 8': refused,
      "existing row: reserved '9' with quantity 20": refused,
      'existing row: reserved 4 (the stored value) with quantity 8': { answer: 'committed', added: [setMovement(-2, A)], stockRowsWritten: 1 },
      "existing row: reserved '4' (the stored value) alone": { answer: 'committed', added: [], stockRowsWritten: 0 },
      'new pair: reserved 2 with quantity 5': refused,
      'new pair: reserved 0 with quantity 5': { answer: 'committed', added: [setMovement(5, NEW)], stockRowsWritten: 1 },
    });
    expect(rows).toEqual({
      'existing row: reserved 0 (clearing it)': [[ID.biz, IN_STOCK, 4]],
      'existing row: reserved 5 with quantity 8': [[ID.biz, IN_STOCK, 4]],
      "existing row: reserved '9' with quantity 20": [[ID.biz, IN_STOCK, 4]],
      'existing row: reserved 4 (the stored value) with quantity 8': [[ID.biz, 8, 4]],
      "existing row: reserved '4' (the stored value) alone": [[ID.biz, IN_STOCK, 4]],
      'new pair: reserved 2 with quantity 5': null,
      'new pair: reserved 0 with quantity 5': [[ID.biz, 5, 0]],
    });
  });

  it("RC-49 (W11-INV-SET-MOVEMENT; D-139 the Excel import keeps its single EXCEL_IMPORT movement) POST .../inventory/import-excel writes exactly one ADJUSTMENT/EXCEL_IMPORT movement per imported row whose quantity changes (an existing row 10 to 6, a new pair holding 3) and no SET movement, none for a row left at its quantity, ignores the sheet's Reserved column, and skips a row whose quantity is below the row's reserved quantity with that row's error, naming the row's product (acceptance B-1), writing nothing for it", async () => {
    await resetBusinessStock();
    await setStock(ID.stockMLo, IN_STOCK, 4);
    const buffer = await inventoryWorkbook([
      { 'Product Name': 'V18R Tracked A', Warehouse: 'V18R Warehouse', 'Quantity On Hand': 6, Reserved: 9 },
      { 'Product Name': 'V18R Untracked', Warehouse: 'V18R Warehouse 2', 'Quantity On Hand': 3 },
      { 'Product Name': 'V18R Tracked B', Warehouse: 'V18R Warehouse', 'Quantity On Hand': IN_STOCK },
      { 'Product Name': 'V18R Two Warehouses', Warehouse: 'V18R Warehouse', 'Quantity On Hand': 2 },
    ]);
    const outcome = await movementsAddedBy(() => Promise.resolve().then(() => controller.importInventoryExcel(ID.biz, { buffer })));
    const rows = {
      A: await pairCounts(ID.productA, ID.warehouse),
      new: await pairCounts(ID.productU, ID.warehouse2),
      B: await pairCounts(ID.productB, ID.warehouse),
      'M, 4 reserved': await pairCounts(ID.productM, ID.warehouse),
    };
    // At 5c17e7b4 the fourth row was imported too (2 in stock with 4 reserved, one more EXCEL_IMPORT movement of -8).
    expect(outcome).toEqual({
      answer: { imported: 3, skipped: 1, errors: ['V18R Two Warehouses: Inventory quantity cannot be less than the quantity reserved for orders (4)'] },
      added: [
        ['ADJUSTMENT', 'EXCEL_IMPORT', -4, null, null, ID.biz, ID.productA, ID.warehouse, 'Excel import: V18R Tracked A (was 10)'],
        ['ADJUSTMENT', 'EXCEL_IMPORT', 3, null, null, ID.biz, ID.productU, ID.warehouse2, 'Excel import: V18R Untracked (new)'],
      ],
    });
    expect(rows).toEqual({
      A: [[ID.biz, 6, 0]],
      new: [[ID.biz, 3, 0]],
      B: [[ID.biz, IN_STOCK, 0]],
      'M, 4 reserved': [[ID.biz, IN_STOCK, 4]],
    });
  });

  it('RC-50 (W11-INV-SET-MOVEMENT; D-139 under the stock lock order) two POST .../inventory sets of one existing row at once (to 7 and to 4, each waiting behind a held lock on the row before it reads it) both commit and write two SET movements, each the difference from the quantity its own transaction read, whose sum equals the final change', async () => {
    await resetBusinessStock();
    let interleave: any;
    const outcome = await movementsAddedBy(async () => {
      interleave = await behindHolder(
        ID.stockA,
        () => upsertAnswer(upsertByRoute(ID.biz, { ...A, quantity: 7 }, SET_MEMBER)),
        () => upsertAnswer(upsertByRoute(ID.biz, { ...A, quantity: 4 }, ID.owner)),
      );
      return interleave.answers;
    });
    const [[, final]] = (await pairRow(A.productId, A.warehouseId)) as any[];
    // Review COR-R2-3: compared sorted by change, not by created_at (the two commit within a millisecond of each other).
    const changes = outcome.added.map((m: any[]) => [m[1], m[2], m[3]]).sort((a: any[], b: any[]) => a[1] - b[1] || String(a[2]).localeCompare(String(b[2])));
    // Acceptance B-2: both sets were waiting behind the holder when it let go (they overlapped; not one after the other).
    expect([interleave.firstWaited, interleave.bothWaited, outcome.answer]).toEqual([true, true, ['committed', 'committed']]);
    expect([4, 7], 'the row ends at one of the two sets').toContain(final);
    // At 5c17e7b4: no movement at all.
    expect(changes, 'two SET movements, each from what its transaction read under the lock').toEqual(
      final === 4
        ? [
            ['SET', -3, SET_MEMBER],
            ['SET', -3, ID.owner],
          ]
        : [
            ['SET', -6, ID.owner],
            ['SET', 3, SET_MEMBER],
          ],
    );
    expect(changes.reduce((sum: number, c: any[]) => sum + c[1], 0), 'the movements sum to the final change').toBe(final - IN_STOCK);
  }, 30_000);

  it("RC-51 (W11-INV-SET-MOVEMENT; D-139, W11-STOCK-ROW-RACE's retry) two POST .../inventory sets creating the same new pair at once (3 and 5, each held after reading no row until the other has read too; then 3 twice, a double submit) both commit on one row, and the movements written sum to the row's final quantity: the creator's whole quantity, then the difference the retried set made (none when it set the same quantity)", async () => {
    const outcomes: Record<string, unknown> = {};
    for (const [name, first, second] of [
      ['3 and 5', 3, 5],
      ['3 twice', 3, 3],
    ] as Array<[string, number, number]>) {
      await resetBusinessStock();
      const reads = new Set<number>();
      let allIn!: () => void;
      const gathered = new Promise<void>((resolve) => (allIn = resolve));
      const hook = hookStockWrites(async (no) => {
        if (reads.has(no)) return;
        reads.add(no);
        if (reads.size >= 2) allIn();
        await Promise.race([gathered, sleep(HOLD_WINDOW_MS)]);
      }, 'findFirst');
      let outcome: any;
      let transactions = 0;
      try {
        outcome = await movementsAddedBy(() =>
          Promise.all([
            upsertAnswer(upsertByRoute(ID.biz, { ...NEW, quantity: first }, SET_MEMBER)),
            upsertAnswer(upsertByRoute(ID.biz, { ...NEW, quantity: second }, SET_MEMBER)),
          ]),
        );
        transactions = hook.transactions();
      } finally {
        hook.restore();
      }
      const held = (await pairRow(NEW.productId, NEW.warehouseId)) as any[];
      const changes: number[] = outcome.added.map((m: any[]) => m[2]);
      outcomes[name] = {
        answer: outcome.answer,
        // Review COR-2: both first runs and the loser's run again (the two did overlap; not one set after the other).
        transactions,
        rows: held.length,
        allSetByTheMember: outcome.added.every((m: any[]) => m[0] === 'ADJUSTMENT' && m[1] === 'SET' && m[3] === SET_MEMBER && m[4] === null),
        movements: changes.length,
        sumEqualsFinalQuantity: changes.reduce((sum, c) => sum + c, 0) === held[0][1],
        finalIsOneOfTheSets: [first, second].includes(held[0][1]),
      };
    }
    // At 5c17e7b4: no movement at all (movements 0, the sum 0 against a row holding 3 or 5).
    expect(outcomes).toEqual({
      '3 and 5': { answer: ['committed', 'committed'], transactions: 3, rows: 1, allSetByTheMember: true, movements: 2, sumEqualsFinalQuantity: true, finalIsOneOfTheSets: true },
      '3 twice': { answer: ['committed', 'committed'], transactions: 3, rows: 1, allSetByTheMember: true, movements: 1, sumEqualsFinalQuantity: true, finalIsOneOfTheSets: true },
    });
  });

  it("RC-52 (W11-INV-SET-MOVEMENT; D-139 the movement names its actor) a direct set that reaches the service with no acting member (the handler called with no authenticated user, which AuthGuard never lets through) is refused and writes nothing: no stock change is recorded without the member who made it", async () => {
    await resetBusinessStock();
    const outcomes: Record<string, unknown> = {};
    for (const [name, call] of [
      ['a request with no user', () => controller.upsertInventory(ID.biz, { ...A, quantity: 7 }, {})],
      ['a user with an empty id', () => controller.upsertInventory(ID.biz, { ...A, quantity: 7 }, { user: { id: '' } })],
      ['the service called with no member', () => market.upsertInventory(ID.biz, { ...A, quantity: 7 })],
      ['a body claiming its own actor and import path', () => market.upsertInventory(ID.biz, { ...A, quantity: 7, actorId: ID.owner, createdBy: ID.owner, source: 'EXCEL_IMPORT', skipSetMovement: true })],
    ] as Array<[string, () => Promise<unknown>]>) {
      outcomes[name] = await answerAndWrites(() => upsertAnswer(Promise.resolve().then(call)));
    }
    const refused = { answer: '401: An inventory set needs the member making it', stockRowsWritten: 0, movementsWritten: 0 };
    expect(outcomes).toEqual({
      'a request with no user': refused,
      'a user with an empty id': refused,
      'the service called with no member': refused,
      'a body claiming its own actor and import path': refused,
    });
  });

  it("RC-53 (W11-INV-SET-MOVEMENT review SEC-1, COR-1; D-139) a member's POST .../inventory whose body names its own actor, reason, type, reference, note and import path (createdBy, actorId, userId, reasonCode, type, referenceId, note, source, skipSetMovement) writes the one movement as the route's: ADJUSTMENT/SET, createdBy the authenticated member, referenceId and note null", async () => {
    await resetBusinessStock();
    const outcome = await movementsAddedBy(() =>
      upsertAnswer(
        upsertByRoute(
          ID.biz,
          {
            ...A,
            quantity: 7,
            createdBy: ID.owner,
            actorId: ID.owner,
            userId: ID.owner,
            reasonCode: 'EXCEL_IMPORT',
            type: 'RECEIPT',
            referenceId: 'x',
            note: 'x',
            source: 'EXCEL_IMPORT',
            skipSetMovement: true,
            label: 'x',
            quantityChange: 99,
            businessId: ID.bizB,
          },
          SET_MEMBER,
        ),
      ),
    );
    expect(outcome).toEqual({ answer: 'committed', added: [setMovement(-3, A)] });
  });

  it('RC-54 (W11-INV-SET-MOVEMENT review SEC-2; D-139 one transaction) a set whose movement write fails (stockMovement.create made to throw inside the transaction) leaves the stock row as it was, for an existing row and for a new pair: no stock change commits without its movement', async () => {
    const outcomes: Record<string, unknown> = {};
    const rows: Record<string, unknown> = {};
    for (const [name, pair] of [
      ['existing row 10 to 7', A],
      ['new pair holding 7', NEW],
    ] as Array<[string, { productId: string; warehouseId: string }]>) {
      await resetBusinessStock();
      const real = prismaService.client;
      const bound = (target: any, prop: PropertyKey) => {
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      };
      let movementWritesTried = 0;
      prismaService.client = new Proxy(real, {
        get(target, prop) {
          if (prop !== '$transaction') return bound(target, prop);
          return (arg: any, options?: any) =>
            target.$transaction(
              (tx: any) =>
                arg(
                  new Proxy(tx, {
                    get(t, p) {
                      if (p !== 'stockMovement') return bound(t, p);
                      return {
                        create: async () => {
                          movementWritesTried++;
                          throw new Error('rc54: the movement write fails');
                        },
                      };
                    },
                  }),
                ),
              options,
            );
        },
      });
      try {
        const writes = await answerAndWrites(() => upsertAnswer(upsertByRoute(ID.biz, { ...pair, quantity: 7 }, SET_MEMBER)));
        outcomes[name] = { ...writes, movementWritesTried };
      } finally {
        prismaService.client = real;
      }
      rows[name] = await pairCounts(pair.productId, pair.warehouseId);
    }
    const rolledBack = { answer: '500: Error', stockRowsWritten: 0, movementsWritten: 0, movementWritesTried: 1 };
    expect(outcomes).toEqual({ 'existing row 10 to 7': rolledBack, 'new pair holding 7': rolledBack });
    expect(rows).toEqual({ 'existing row 10 to 7': [[ID.biz, IN_STOCK, 0]], 'new pair holding 7': null });
  });

  it('RC-55 (W11-INV-SET-MOVEMENT review SEC-R2-2; D-139 under the row lock) a set to 3 that waits behind a transaction holding the row while it reserves 5 (a routing in flight) reads the row once that commits: it is refused 400 QUANTITY_BELOW_RESERVED and writes nothing; the row keeps 10 with 5 reserved', async () => {
    await resetBusinessStock();
    let letGo!: () => void;
    const go = new Promise<void>((resolve) => (letGo = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const holder = db.$transaction(
      async (tx: any) => {
        await tx.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', ID.stockA);
        await tx.$executeRawUnsafe('UPDATE inventory_stocks SET reserved = 5 WHERE id = $1', ID.stockA);
        holding();
        await go;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    // Review COR-R3-2: a holder that fails before it holds ends the case with its error, not a hang.
    await Promise.race([held, holder]);
    let waited = false;
    let outcome: any;
    try {
      outcome = await movementsAddedBy(async () => {
        const answer = upsertAnswerWithCode(upsertByRoute(ID.biz, { ...A, quantity: 3 }, SET_MEMBER));
        waited = await within(5_000, async () => (await waitingSessions()) >= 1);
        letGo();
        await holder;
        return answer;
      });
    } finally {
      letGo();
      await holder.catch(() => undefined);
    }
    expect({ waited, ...outcome, row: await pairCounts(A.productId, A.warehouseId) }).toEqual({
      waited: true,
      answer: '400 QUANTITY_BELOW_RESERVED: Inventory quantity cannot be less than the quantity reserved for orders (5)',
      added: [],
      row: [[ID.biz, IN_STOCK, 5]],
    });
  }, 30_000);

  it("RC-56 (W11-INV-SET-MOVEMENT review SEC-R2-1; D-139) a set to 2 of a pair whose row is created after the set's lock statement ran (it locked nothing) and before its read (a receipt creating the row with 10, committed), while a routing in flight holds that new row reserving 5: the set does not act on the row it read unlocked (10 with 0 reserved). It locks the row and reads it again, waits for the reservation, and is refused 400 QUANTITY_BELOW_RESERVED with nothing written; the row keeps 10 with 5 reserved", async () => {
    await resetBusinessStock();
    const newRowId = `${P}stock_rc56`;
    const real = prismaService.client;
    const bound = (target: any, prop: PropertyKey) => {
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    };
    let letGo!: () => void;
    const go = new Promise<void>((resolve) => (letGo = resolve));
    let holder: Promise<unknown> = Promise.resolve();
    let interposed = 0;
    /** Between the set's lock statement and its first read: the row is created and committed, then held by a reservation of 5. */
    const interpose = async () => {
      if (interposed++ > 0) return;
      await db.$executeRaw`
        INSERT INTO inventory_stocks (id, business_id, product_id, warehouse_id, quantity, reserved, currency, updated_at)
        VALUES (${newRowId}, ${ID.biz}, ${NEW.productId}, ${NEW.warehouseId}, ${IN_STOCK}, 0, 'TTD', now())`;
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      holder = db.$transaction(
        async (tx: any) => {
          await tx.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', newRowId);
          await tx.$executeRawUnsafe('UPDATE inventory_stocks SET reserved = 5 WHERE id = $1', newRowId);
          holding();
          await go;
        },
        { timeout: 20_000, maxWait: 5_000 },
      );
      await Promise.race([held, holder]);
    };
    prismaService.client = new Proxy(real, {
      get(target, prop) {
        if (prop !== '$transaction') return bound(target, prop);
        return (arg: any, options?: any) =>
          typeof arg !== 'function'
            ? target.$transaction(arg, options)
            : target.$transaction(
                (tx: any) =>
                  arg(
                    new Proxy(tx, {
                      get(t, p) {
                        if (p !== 'inventoryStock') return bound(t, p);
                        const delegate = Reflect.get(t, p);
                        return new Proxy(delegate, {
                          get(d, m) {
                            if (m !== 'findFirst') return bound(d, m);
                            return async (args: any) => {
                              await interpose();
                              return d.findFirst(args);
                            };
                          },
                        });
                      },
                    }),
                  ),
                options,
              );
      },
    });
    let waited = false;
    let outcome: any;
    let row: unknown;
    try {
      outcome = await movementsAddedBy(async () => {
        const answer = upsertAnswerWithCode(upsertByRoute(ID.biz, { ...NEW, quantity: 2 }, SET_MEMBER));
        // The set waits behind the reservation: at its second lock (the repair), or, before it, at its update.
        waited = await within(5_000, async () => interposed > 0 && (await waitingSessions()) >= 1);
        letGo();
        await holder;
        return answer;
      });
      row = await pairCounts(NEW.productId, NEW.warehouseId);
    } finally {
      prismaService.client = real;
      letGo();
      await holder.catch(() => undefined);
      await removeRows([newRowId]);
    }
    // At 629d778b: 'committed' with one SET movement of -8, the row left holding 2 with 5 reserved.
    expect({ interposed: interposed > 0, waited, ...outcome, row }).toEqual({
      interposed: true,
      waited: true,
      answer: '400 QUANTITY_BELOW_RESERVED: Inventory quantity cannot be less than the quantity reserved for orders (5)',
      added: [],
      row: [[ID.biz, IN_STOCK, 5]],
    });
  }, 30_000);

  it("RC-57 (W11-INV-SET-MOVEMENT review SEC-R3-1, COR-R3-4; D-139) a set to 2 whose pair's row appears after its lock statement, is deleted before its second lock statement (which then locks nothing), and is created again (10) before its second read while a routing in flight holds that row reserving 5: the set does not act on the second row it read unlocked either. Its transaction is run again, waits for the reservation, and is refused 400 QUANTITY_BELOW_RESERVED with nothing written; the row keeps 10 with 5 reserved", async () => {
    await resetBusinessStock();
    const firstRowId = `${P}stock_rc57_a`;
    const secondRowId = `${P}stock_rc57_b`;
    const real = prismaService.client;
    const bound = (target: any, prop: PropertyKey) => {
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    };
    const insertRow = (id: string) => db.$executeRaw`
      INSERT INTO inventory_stocks (id, business_id, product_id, warehouse_id, quantity, reserved, currency, updated_at)
      VALUES (${id}, ${ID.biz}, ${NEW.productId}, ${NEW.warehouseId}, ${IN_STOCK}, 0, 'TTD', now())`;
    let letGo!: () => void;
    const go = new Promise<void>((resolve) => (letGo = resolve));
    let holder: Promise<unknown> = Promise.resolve();
    let lockStatements = 0;
    let reads = 0;
    let holderHolds = false;
    /** Before the set's lock statements: the second one finds the first row deleted (and locks nothing). */
    const beforeLock = async () => {
      if (++lockStatements === 2) await removeRows([firstRowId]);
    };
    /** Before the set's reads: the first finds a row created after the first lock statement; the second, another one, held reserving 5. */
    const beforeRead = async () => {
      reads++;
      if (reads === 1) await insertRow(firstRowId);
      if (reads !== 2) return;
      await insertRow(secondRowId);
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      holder = db.$transaction(
        async (tx: any) => {
          await tx.$queryRawUnsafe('SELECT id FROM inventory_stocks WHERE id = $1 FOR UPDATE', secondRowId);
          await tx.$executeRawUnsafe('UPDATE inventory_stocks SET reserved = 5 WHERE id = $1', secondRowId);
          holding();
          await go;
        },
        { timeout: 20_000, maxWait: 5_000 },
      );
      await Promise.race([held, holder]);
      holderHolds = true;
    };
    prismaService.client = new Proxy(real, {
      get(target, prop) {
        if (prop !== '$transaction') return bound(target, prop);
        return (arg: any, options?: any) =>
          typeof arg !== 'function'
            ? target.$transaction(arg, options)
            : target.$transaction(
                (tx: any) =>
                  arg(
                    new Proxy(tx, {
                      get(t, p) {
                        if (p === '$queryRaw') {
                          return async (...args: any[]) => {
                            await beforeLock();
                            return t.$queryRaw(...args);
                          };
                        }
                        if (p !== 'inventoryStock') return bound(t, p);
                        const delegate = Reflect.get(t, p);
                        return new Proxy(delegate, {
                          get(d, m) {
                            if (m !== 'findFirst') return bound(d, m);
                            return async (args: any) => {
                              await beforeRead();
                              return d.findFirst(args);
                            };
                          },
                        });
                      },
                    }),
                  ),
                options,
              );
      },
    });
    let waited = false;
    let outcome: any;
    let row: unknown;
    try {
      outcome = await movementsAddedBy(async () => {
        const answer = upsertAnswerWithCode(upsertByRoute(ID.biz, { ...NEW, quantity: 2 }, SET_MEMBER));
        // The set waits behind the reservation: at its run again's lock (the repair), or, before it, at its update.
        waited = await within(10_000, async () => holderHolds && (await waitingSessions()) >= 1);
        letGo();
        await holder;
        return answer;
      });
      row = await pairCounts(NEW.productId, NEW.warehouseId);
    } finally {
      prismaService.client = real;
      letGo();
      await holder.catch(() => undefined);
      await removeRows([firstRowId, secondRowId]);
    }
    // At 5548fa3e: 'committed' with one SET movement of -8, the second row left holding 2 with 5 reserved.
    expect({ secondRowHeld: holderHolds, waited, ...outcome, row }).toEqual({
      secondRowHeld: true,
      waited: true,
      answer: '400 QUANTITY_BELOW_RESERVED: Inventory quantity cannot be less than the quantity reserved for orders (5)',
      added: [],
      row: [[ID.biz, IN_STOCK, 5]],
    });
  }, 30_000);
});

describe('W11-SHIP-STOCK-DECREMENT (F-26; D-136)', () => {
  /** Paid STANDARD order with explicit per-line quantities (e.g. tracked A×2 or A×3). */
  async function paidOrderWithLines(lines: Array<{ productId: string; quantity: number }>) {
    orderSeq += 1;
    const total = lines.reduce((sum, l) => sum + PRICE * l.quantity, 0);
    const order = await db.marketplaceOrder.create({
      data: {
        businessId: ID.biz,
        orderNumber: `${P}ord_${orderSeq}_${Date.now()}`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        customerName: 'Vee Router',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: total,
        total,
        currency: 'TTD',
        metadata: { statusTimeline: [{ status: 'paid', timestamp: '2026-11-12T10:00:00.000Z', note: 'Order placed' }] },
      },
    });
    for (const line of lines) {
      await db.marketplaceOrderItem.create({
        data: {
          orderId: order.id,
          productId: line.productId,
          name: line.productId,
          quantity: line.quantity,
          unitPrice: PRICE,
          total: PRICE * line.quantity,
        },
      });
    }
    return order;
  }

  const shipMovementsFor = async (orderId: string) =>
    (
      await db.stockMovement.findMany({
        where: { businessId: ID.biz, referenceId: orderId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((m: any) => ({
      productId: m.productId,
      warehouseId: m.warehouseId,
      type: m.type,
      quantityChange: m.quantityChange,
      reasonCode: m.reasonCode,
      createdBy: m.createdBy,
    }));

  const shippedEventsFor = (orderId: string) =>
    seen.filter((e) => e.name === 'store_order.shipped' && e.payload?.order?.id === orderId).length;

  it('RC-58 (W11-SHIP-STOCK-DECREMENT; packet case RC-24; F-26, D-136) route → process → ship of tracked A×2 decrements A to 8/0, moves the route to SHIPPED with shipmentId, writes one SALE/SHIP StockMovement naming the acting member, and emits one store_order.shipped', async () => {
    const order = await paidOrderWithLines([{ productId: ID.productA, quantity: 2 }]);
    await routing.routeOrder(ID.biz, order.id);
    expect(await stockOf(ID.stockA)).toBe('10/2');
    expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:RESERVED']);

    await market.fulfillOrder(ID.biz, order.id, 'process', {}, ID.owner);
    expect(await statusOf(order.id)).toBe('picking_packing/PAID');
    expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:PICKING_PACKING']);
    expect(await stockOf(ID.stockA)).toBe('10/2');

    await market.fulfillOrder(
      ID.biz,
      order.id,
      'ship',
      { carrier: 'DHL', trackingNumber: `${P}TRK_RC58` },
      ID.owner,
    );

    const routes = await db.fulfillmentRoute.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    const shipments = await db.shipment.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect({
      status: await statusOf(order.id),
      stockA: await stockOf(ID.stockA),
      routes: routes.map((r: any) => `${r.strategy}:${r.status}:${Boolean(r.shipmentId)}`),
      shipmentCount: shipments.length,
      linkedShipment: routes[0]?.shipmentId === shipments[0]?.id,
      movements: await shipMovementsFor(order.id),
      shippedEvents: shippedEventsFor(order.id),
    }).toEqual({
      status: 'shipped/PAID',
      stockA: '8/0',
      routes: ['LOCAL_STOCK:SHIPPED:true'],
      shipmentCount: 1,
      linkedShipment: true,
      movements: [
        {
          productId: ID.productA,
          warehouseId: ID.warehouse,
          type: 'SALE',
          quantityChange: -2,
          reasonCode: 'SHIP',
          createdBy: ID.owner,
        },
      ],
      shippedEvents: 1,
    });
  }, 20_000);

  it('RC-59 (W11-SHIP-STOCK-DECREMENT; packet case RC-25; F-26, D-136) ship while the route is still RESERVED (status set to picking_packing by PATCH) decrements A to 8/0 once and writes one SALE/SHIP StockMovement', async () => {
    const order = await paidOrderWithLines([{ productId: ID.productA, quantity: 2 }]);
    await routing.routeOrder(ID.biz, order.id);
    expect(await stockOf(ID.stockA)).toBe('10/2');

    // PATCH status directly to picking_packing leaves the LOCAL_STOCK route RESERVED.
    await market.updateOrderStatus(ID.biz, order.id, 'picking_packing');
    expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:RESERVED']);

    await market.fulfillOrder(ID.biz, order.id, 'ship', {}, ID.owner);

    expect({
      status: await statusOf(order.id),
      stockA: await stockOf(ID.stockA),
      routes: await routesOf(order.id),
      movements: await shipMovementsFor(order.id),
      shippedEvents: shippedEventsFor(order.id),
    }).toEqual({
      status: 'shipped/PAID',
      stockA: '8/0',
      routes: ['LOCAL_STOCK:SHIPPED'],
      movements: [
        {
          productId: ID.productA,
          warehouseId: ID.warehouse,
          type: 'SALE',
          quantityChange: -2,
          reasonCode: 'SHIP',
          createdBy: ID.owner,
        },
      ],
      shippedEvents: 1,
    });
  }, 20_000);

  it('RC-60 (W11-SHIP-STOCK-DECREMENT; packet case RC-26; F-26, D-136) two ship calls at once: one answers 200 and the other 400; A ends at 8/0 with one shipment, one SALE/SHIP movement and one store_order.shipped event', async () => {
    const order = await paidOrderWithLines([{ productId: ID.productA, quantity: 2 }]);
    await routing.routeOrder(ID.biz, order.id);
    await market.fulfillOrder(ID.biz, order.id, 'process', {}, ID.owner);

    const results = await Promise.allSettled([
      market.fulfillOrder(ID.biz, order.id, 'ship', { carrier: 'DHL', trackingNumber: `${P}TRK_RC60_1` }, ID.owner),
      market.fulfillOrder(ID.biz, order.id, 'ship', { carrier: 'DHL', trackingNumber: `${P}TRK_RC60_2` }, ID.owner),
    ]);

    const summary = results
      .map((r) => {
        if (r.status === 'fulfilled') return `200:${r.value.status}`;
        const err: any = r.reason;
        const code = typeof err?.getStatus === 'function' ? err.getStatus() : 500;
        return `${code}:${err?.message ?? String(err)}`;
      })
      .sort();

    const shipments = await db.shipment.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect({
      summary,
      status: await statusOf(order.id),
      stockA: await stockOf(ID.stockA),
      routes: await routesOf(order.id),
      shipmentCount: shipments.length,
      movements: await shipMovementsFor(order.id),
      shippedEvents: shippedEventsFor(order.id),
    }).toEqual({
      summary: ['200:shipped', '400:Cannot ship order in shipped status'],
      status: 'shipped/PAID',
      stockA: '8/0',
      routes: ['LOCAL_STOCK:SHIPPED'],
      shipmentCount: 1,
      movements: [
        {
          productId: ID.productA,
          warehouseId: ID.warehouse,
          type: 'SALE',
          quantityChange: -2,
          reasonCode: 'SHIP',
          createdBy: ID.owner,
        },
      ],
      shippedEvents: 1,
    });
  }, 20_000);

  it('RC-61 (W11-SHIP-STOCK-DECREMENT; packet case RC-27; F-26, D-136) ship order O1 (A×2) while routing order O2 (A×3) is held after its reservation: ship waits on the stock lock, both commit, and A ends at 8/3 with no lost reservation', async () => {
    const o1 = await paidOrderWithLines([{ productId: ID.productA, quantity: 2 }]);
    await routing.routeOrder(ID.biz, o1.id);
    await market.fulfillOrder(ID.biz, o1.id, 'process', {}, ID.owner);
    expect(await stockOf(ID.stockA)).toBe('10/2');

    const o2 = await paidOrderWithLines([{ productId: ID.productA, quantity: 3 }]);

    let o2Reserved!: () => void;
    const o2Held = new Promise<void>((resolve) => (o2Reserved = resolve));
    let releaseO2!: () => void;
    const goO2 = new Promise<void>((resolve) => (releaseO2 = resolve));
    let hookedOnce = false;

    const hook = hookStockWrites(async (_txNo, args) => {
      if (hookedOnce || args?.where?.id !== ID.stockA) return;
      hookedOnce = true;
      o2Reserved();
      await goO2;
    });

    let shipWaited = false;
    try {
      const routeO2 = routing.routeOrder(ID.biz, o2.id);
      await o2Held;

      const shipO1 = market.fulfillOrder(ID.biz, o1.id, 'ship', {}, ID.owner);
      // Under the fix, ship locks stockA FOR UPDATE and blocks behind O2's uncommitted reservation until O2 commits.
      const start = Date.now();
      while (Date.now() - start < 4_000) {
        if ((await waitingSessions()) >= 1) {
          shipWaited = true;
          break;
        }
        await sleep(50);
      }

      releaseO2();
      await Promise.all([routeO2, shipO1]);
    } finally {
      releaseO2();
      hook.restore();
    }

    expect({
      shipWaited,
      stockA: await stockOf(ID.stockA),
      o1Status: await statusOf(o1.id),
      o1Routes: await routesOf(o1.id),
      o2Status: await statusOf(o2.id),
      o2Routes: await routesOf(o2.id),
      o1Movements: await shipMovementsFor(o1.id),
    }).toEqual({
      shipWaited: true,
      stockA: '8/3',
      o1Status: 'shipped/PAID',
      o1Routes: ['LOCAL_STOCK:SHIPPED'],
      o2Status: 'routed/PAID',
      o2Routes: ['LOCAL_STOCK:RESERVED'],
      o1Movements: [
        {
          productId: ID.productA,
          warehouseId: ID.warehouse,
          type: 'SALE',
          quantityChange: -2,
          reasonCode: 'SHIP',
          createdBy: ID.owner,
        },
      ],
    });
  }, 30_000);

  it('RC-62 (W11-SHIP-STOCK-DECREMENT; packet case RC-28; F-26, D-136) shipping an untracked line writes no stock and no StockMovement', async () => {
    const order = await paidOrderWithLines([{ productId: ID.productU, quantity: 2 }]);
    await routing.routeOrder(ID.biz, order.id);
    await market.fulfillOrder(ID.biz, order.id, 'process', {}, ID.owner);
    await market.fulfillOrder(ID.biz, order.id, 'ship', {}, ID.owner);

    const untrackedStocks = await db.inventoryStock.findMany({
      where: { businessId: ID.biz, productId: ID.productU },
    });
    expect({
      status: await statusOf(order.id),
      routes: await routesOf(order.id),
      untrackedStockCount: untrackedStocks.length,
      stockA: await stockOf(ID.stockA),
      movements: await shipMovementsFor(order.id),
      shippedEvents: shippedEventsFor(order.id),
    }).toEqual({
      status: 'shipped/PAID',
      routes: ['LOCAL_STOCK:SHIPPED'],
      untrackedStockCount: 0,
      stockA: '10/0',
      movements: [],
      shippedEvents: 1,
    });
  }, 20_000);

  it('RC-63 (W11-SHIP-STOCK-DECREMENT review P50-SEC-1) malformed carrier, trackingNumber, or estimatedDelivery returns 400 with nothing written (order, routes, stock, shipments, movements unchanged)', async () => {
    const order = await paidOrderWithLines([{ productId: ID.productA, quantity: 2 }]);
    await routing.routeOrder(ID.biz, order.id);
    await market.fulfillOrder(ID.biz, order.id, 'process', {}, ID.owner);

    const badPayloads = [
      { carrier: 12345 },
      { trackingNumber: { set: 'TRK' } },
      { carrier: 'DHL', trackingNumber: 'TRK-BAD-DATE', estimatedDelivery: 'not-a-date' },
      { carrier: 'DHL', estimatedDelivery: 999999 },
    ];
    const codes: number[] = [];
    for (const payload of badPayloads) {
      try {
        await market.fulfillOrder(ID.biz, order.id, 'ship', payload, ID.owner);
        codes.push(200);
      } catch (err: any) {
        codes.push(typeof err?.getStatus === 'function' ? err.getStatus() : 500);
      }
    }

    const shipments = await db.shipment.findMany({ where: { businessId: ID.biz, orderId: order.id } });
    expect({
      codes,
      status: await statusOf(order.id),
      routes: await routesOf(order.id),
      stockA: await stockOf(ID.stockA),
      shipmentCount: shipments.length,
      movements: await shipMovementsFor(order.id),
      shippedEvents: shippedEventsFor(order.id),
    }).toEqual({
      codes: [400, 400, 400, 400],
      status: 'picking_packing/PAID',
      routes: ['LOCAL_STOCK:PICKING_PACKING'],
      stockA: '10/2',
      shipmentCount: 0,
      movements: [],
      shippedEvents: 0,
    });
  }, 20_000);

  it('RC-64 (W11-SHIP-STOCK-DECREMENT review P50-CONC-1 / D-136) concurrent ship (with carrier/tracking) and cancel serialize under the routing claim: exactly one commits and the other answers 400 with consistent stock and routes', async () => {
    const order = await paidOrderWithLines([{ productId: ID.productA, quantity: 2 }]);
    await routing.routeOrder(ID.biz, order.id);
    await market.fulfillOrder(ID.biz, order.id, 'process', {}, ID.owner);

    const [shipRes, cancelRes] = await Promise.allSettled([
      market.fulfillOrder(ID.biz, order.id, 'ship', { carrier: 'DHL', trackingNumber: `${P}TRK_RC64` }, ID.owner),
      market.fulfillOrder(ID.biz, order.id, 'cancel', { reason: 'rc64' }, ID.owner),
    ]);

    const statusOfResult = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled'
        ? `200:${r.value.status}`
        : `${typeof r.reason?.getStatus === 'function' ? r.reason.getStatus() : 500}`;

    const outcomes = [statusOfResult(shipRes), statusOfResult(cancelRes)];
    const finalStatus = await statusOf(order.id);
    if (finalStatus === 'shipped/PAID') {
      expect(outcomes).toEqual(['200:shipped', '400']);
      expect(await stockOf(ID.stockA)).toBe('8/0');
      expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:SHIPPED']);
      expect((await shipMovementsFor(order.id)).length).toBe(1);
    } else {
      expect(finalStatus).toBe('cancelled/PAID');
      expect(outcomes).toEqual(['400', '200:cancelled']);
      expect(await stockOf(ID.stockA)).toBe('10/0');
      expect(await routesOf(order.id)).toEqual(['LOCAL_STOCK:CANCELLED']);
      expect(await shipMovementsFor(order.id)).toEqual([]);
    }
  }, 20_000);
});

describe('W11-STOREFRONT-ROUTE-DECREMENTED (F-36, D-136): routing does not reserve storefront lines already decremented at checkout (real database)', () => {
  async function paidStandardOrderOf(productId: string, quantity: number) {
    orderSeq += 1;
    const total = PRICE * quantity;
    const order = await db.marketplaceOrder.create({
      data: {
        businessId: ID.biz,
        orderNumber: `${P}ord_${orderSeq}_${Date.now()}`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        customerName: 'Vee Router',
        customerEmail: CUSTOMER_EMAIL,
        subtotal: total,
        total,
        currency: 'TTD',
        metadata: { statusTimeline: [{ status: 'paid', timestamp: '2026-11-12T10:00:00.000Z', note: 'Order placed' }] },
      },
    });
    await db.marketplaceOrderItem.create({
      data: {
        orderId: order.id,
        productId,
        name: 'V18R Tracked B',
        quantity,
        unitPrice: PRICE,
        total,
      },
    });
    return order;
  }

  beforeEach(async () => {
    await setStock(ID.stockA, IN_STOCK);
    await setStock(ID.stockB, IN_STOCK);
    seen = [];
  });

  it('RC-65 (W11-STOREFRONT-ROUTE-DECREMENTED; packet case RC-29; F-36, D-136) storefront checkout of tracked B×3 settled by provider, then listener routes it: B ends at 7/0 with one LOCAL_STOCK:RESERVED route in default warehouse carrying stockDecrementedAtCheckout & noReservationRequired; after storefront PATCH SHIPPED, DELIVERED and COMPLETED, B stays 7/0', async () => {
    const off = listenerOnTheBus();
    try {
      const placed = await storeOrders.createOrder({
        businessId: ID.biz,
        cartItems: [{ productId: ID.productB, quantity: 3 }],
        customerInfo: { name: 'Vee Storefront', email: CUSTOMER_EMAIL },
        paymentMethod: 'CASH',
      });
      expect(placed.type).toBe('STOREFRONT');
      await storeOrders.updatePaymentStatus(placed.id, 'PAID', `${P}rc65_provider_ref`, 'PAYPAL');
      await drain();

      expect(announcedFor(placed.id), 'routed by listener').toEqual(['fulfillment_routed:1']);
      expect(await statusOf(placed.id)).toBe('CONFIRMED/PAID');
      expect(await stockOf(ID.stockB), 'checkout took 3, routing reserved 0').toBe(`${IN_STOCK - 3}/0`);

      const routes = await db.fulfillmentRoute.findMany({
        where: { businessId: ID.biz, orderId: placed.id },
      });
      expect(routes.length).toBe(1);
      expect(routes[0]).toMatchObject({
        strategy: 'LOCAL_STOCK',
        status: 'RESERVED',
        sourceType: 'WAREHOUSE',
        warehouseId: ID.warehouse,
        notes: 'Stock taken at checkout — no reservation',
        metadata: {
          inventoryMode: 'tracked',
          noReservationRequired: true,
          stockDecrementedAtCheckout: true,
        },
      });

      for (const nextStatus of ['SHIPPED', 'DELIVERED', 'COMPLETED'] as const) {
        const ans = await statusAnswer(siteStatusByRoute(placed.id, nextStatus));
        expect(ans, nextStatus).toBe(`${nextStatus}/PAID`);
        expect(await stockOf(ID.stockB), `after ${nextStatus}`).toBe(`${IN_STOCK - 3}/0`);
      }
    } finally {
      off();
      await drain();
    }
  }, 30_000);

  it('RC-66 (W11-STOREFRONT-ROUTE-DECREMENTED; packet case RC-30 control; F-36, D-136) a STANDARD order created paid with tracked B×2 (no checkout sale movement) still reserves 2', async () => {
    const order = await paidStandardOrderOf(ID.productB, 2);
    expect(order.type).toBe('STANDARD');
    await routing.routeOrder(ID.biz, order.id);

    expect(await stockOf(ID.stockB)).toBe(`${IN_STOCK}/2`);
    const routes = await db.fulfillmentRoute.findMany({
      where: { businessId: ID.biz, orderId: order.id },
    });
    expect(routes.length).toBe(1);
    expect(routes[0].strategy).toBe('LOCAL_STOCK');
    expect(routes[0].status).toBe('RESERVED');
    expect((routes[0].metadata as Record<string, unknown> | null)?.stockDecrementedAtCheckout).toBeFalsy();
  }, 20_000);

  it('RC-67 (W11-STOREFRONT-ROUTE-DECREMENTED; packet case RC-31; F-36, D-136) a storefront line whose listing is DROPSHIP but whose tracked product was decremented at checkout raises no PurchaseOrder and routes LOCAL_STOCK:RESERVED with stockDecrementedAtCheckout', async () => {
    const listing = await db.marketplaceListing.create({
      data: {
        id: `${P}rc67_listing`,
        businessId: ID.biz,
        productId: ID.productB,
        fulfillmentStrategy: 'DROPSHIP',
        supplierName: 'V18R RC67 Supplier',
        isActive: true,
      },
    });
    const off = listenerOnTheBus();
    try {
      const placed = await storeOrders.createOrder({
        businessId: ID.biz,
        cartItems: [{ productId: ID.productB, quantity: 3 }],
        customerInfo: { name: 'Vee Dropship Storefront', email: CUSTOMER_EMAIL },
        paymentMethod: 'CASH',
      });
      await storeOrders.updatePaymentStatus(placed.id, 'PAID', `${P}rc67_provider_ref`, 'PAYPAL');
      await drain();

      expect(await stockOf(ID.stockB), 'checkout took 3, routing reserved 0').toBe(`${IN_STOCK - 3}/0`);
      const pos = await db.purchaseOrder.findMany({
        where: { businessId: ID.biz, fulfillmentRoutes: { some: { orderId: placed.id } } },
      });
      expect(pos.length, 'no supplier PurchaseOrder raised').toBe(0);

      const routes = await db.fulfillmentRoute.findMany({
        where: { businessId: ID.biz, orderId: placed.id },
      });
      expect(routes.length).toBe(1);
      expect(routes[0]).toMatchObject({
        strategy: 'LOCAL_STOCK',
        status: 'RESERVED',
        sourceType: 'WAREHOUSE',
        warehouseId: ID.warehouse,
        listingId: listing.id,
        notes: 'Stock taken at checkout — no reservation',
        metadata: {
          inventoryMode: 'tracked',
          noReservationRequired: true,
          stockDecrementedAtCheckout: true,
        },
      });
    } finally {
      off();
      await drain();
      await db.marketplaceListing.deleteMany({ where: { id: listing.id } });
    }
  }, 30_000);

  it('RC-68 (W11-STOREFRONT-ROUTE-DECREMENTED; packet case RC-32; F-36, D-136) cancelling a routed checkout-decremented storefront order via PATCH CANCELLED leaves reserved untouched (0 when alone, and does not steal a sibling STANDARD order reservation)', async () => {
    const off = listenerOnTheBus();
    try {
      const placed = await storeOrders.createOrder({
        businessId: ID.biz,
        cartItems: [{ productId: ID.productB, quantity: 3 }],
        customerInfo: { name: 'Vee Cancel Storefront', email: CUSTOMER_EMAIL },
        paymentMethod: 'CASH',
      });
      await storeOrders.updatePaymentStatus(placed.id, 'PAID', `${P}rc68_provider_ref`, 'PAYPAL');
      await drain();
      expect(await stockOf(ID.stockB)).toBe(`${IN_STOCK - 3}/0`);

      // Route a sibling STANDARD order reserving 2 units on B -> 7/2.
      const sibling = await paidStandardOrderOf(ID.productB, 2);
      await routing.routeOrder(ID.biz, sibling.id);
      expect(await stockOf(ID.stockB)).toBe(`${IN_STOCK - 3}/2`);

      // Cancel the storefront order: its route cancels, and B stays 7/2 (sibling reservation untouched!).
      expect(await statusAnswer(siteStatusByRoute(placed.id, 'CANCELLED'))).toBe('CANCELLED/PAID');
      expect(await routesOf(placed.id)).toEqual(['LOCAL_STOCK:CANCELLED']);
      expect(await stockOf(ID.stockB)).toBe(`${IN_STOCK - 3}/2`);
    } finally {
      off();
      await drain();
    }
  }, 30_000);
});
