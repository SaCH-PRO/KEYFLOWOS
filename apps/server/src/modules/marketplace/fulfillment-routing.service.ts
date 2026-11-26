import { Injectable, Logger, BadRequestException, ConflictException, Inject, NotFoundException } from '@nestjs/common';
import { ownStockRows, resolveInventoryMode } from '../../core/inventory/inventory-mode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { InventoryLowPayload, InventoryOutPayload, PurchaseOrderReceivedPayload } from '../../core/event-bus/events.types';
import { ExpensePostingService } from '../finance/expense-posting.service';
import { appendOrderTimeline, appendOrderTimelineAdvancingStatus } from './order-metadata';
import type { BusinessMetaTx } from '../../core/prisma/business-meta';
import { isLostTransactionConflict, lockStockRowPairsInOrder, lockStockRowsInOrder } from '../../core/inventory/stock-lock-order';
import { createStockRowOrConflict, ownedProductsAndWarehouses, retryOnOwnStockRowRace } from '../../core/inventory/stock-ownership';
import { readPurchaseOrderLine, STOCK_QUANTITY_MAX } from '../../core/inventory/purchase-order-lines';

/**
 * W10-SOP-FIX review (SOPFIX-SEC-1, SOPFIX-R1; D-112): the client the routing
 * engine reads and writes an order's routes with, the transaction its claim
 * on the order holds (routeOrder).
 */
type RoutingTx = BusinessMetaTx;

/**
 * The claim routeOrder takes on an order: one transaction-scoped advisory
 * lock per business and order (transaction scoped because the pooler runs in
 * transaction mode, as the booking slot claim's). maxWait and timeout leave
 * room for a router that waits for another to finish routing the same order.
 */
const ROUTING_LOCK_NAMESPACE = 'marketplace-order-routing:';
export const ROUTING_CLAIM_TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

/**
 * W11-PO-RECEIPT-CLAIM: the 409 a purchase order status change answers when
 * the status it read before its write was changed by another request first
 * (advancePurchaseOrderStatus compares and sets that status). Not marked
 * retryable: D-134 rules such a 409 final for a KEY plan step
 * (inventory_advance_purchase_order); the caller reloads the purchase order.
 */
export const PURCHASE_ORDER_CHANGED = 'The purchase order was changed by another request; reload it and try again';

/**
 * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-1): how many times routeOrder runs
 * its claim transaction. Its stock locks are taken in one global order
 * (core/inventory/stock-lock-order.ts), so routing does not deadlock with a
 * writer that follows the order; a transaction lost to a deadlock or a
 * serialization failure anyway (a writer outside that order) is run once more
 * before routing is reported failed: StoreOrderRoutingListener turns a
 * failure into store_order.routing_failed (an operator "routing failed" action
 * and a failed contact event), and nothing else routes a provider-paid
 * storefront order again.
 */
const ROUTING_CLAIM_ATTEMPTS = 2;

/**
 * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-2, SEAMZ4-CR-3): the statuses
 * routing moves a paid order on from (to routed, or supplier_ordered), the
 * marketplace's own statuses before routing. Any other status is kept: one
 * past routing, and a storefront status (CONFIRMED and the rest of the
 * storefront's uppercase vocabulary, LEGACY_STATUS_MAP below), which the
 * storefront's readers (StoreOrderService.getOrderSummary and listOrders, the
 * store order list and fulfilment panel, the customer's tracking) know and
 * 'routed' is not.
 */
const ROUTING_ADVANCES_FROM: ReadonlySet<string> = new Set(['placed', 'awaiting_payment', 'paid', 'awaiting_fulfillment']);

/**
 * W10-SOP-FIX review (SOPFIX-SEC-1) / W10-Z4-ROUTE-FIX (SEAMZ4-CR-2): takes the
 * routing claim on an order on the caller's transaction (held to its commit).
 * routeOrder takes it before it reads the order's routes; the fulfil cancel
 * takes it before it releases the order's reservations, so a cancel meets an
 * order being routed only once its routes have committed.
 */
export async function claimOrderRouting(tx: RoutingTx, businessId: string, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ROUTING_LOCK_NAMESPACE}${businessId}:${orderId}`}))`;
}

export interface OrderStatusTimelineEntry {
  status: string;
  timestamp: string;
  note?: string;
}

export interface OrderMetadata {
  statusTimeline?: OrderStatusTimelineEntry[];
  publicToken?: string;
  stockNotDecrementedProductIds?: string[];
  [key: string]: unknown;
}

export interface RouteMetadata {
  inventoryMode?: 'tracked' | 'untracked' | 'virtual';
  noReservationRequired?: boolean;
  taskIds?: string[];
  taskNote?: string;
  [key: string]: unknown;
}

export interface OrderItemShape {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  listingId?: string | null;
  variantId?: string | null;
  name?: string | null;
  sku?: string | null;
  total?: number | null;
}

export interface MarketplaceOrderShape {
  id: string;
  status: string;
  currency?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  metadata?: unknown;
  fulfillmentRoutes?: unknown[];
  items?: OrderItemShape[];
  [key: string]: unknown;
}

export interface FulfillmentRouteShape {
  id: string;
  businessId: string;
  orderId: string;
  orderItemId: string | null;
  strategy: FulfillmentStrategy;
  status: FulfillmentRouteStatus;
  warehouseId?: string | null;
  supplierId?: string | null;
  shipmentId?: string | null;
  metadata?: RouteMetadata | null;
  order?: {
    items: OrderItemShape[];
    status: string;
    metadata?: OrderMetadata | null;
    currency?: string | null;
    orderNumber?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
  };
}

export interface ListingShape {
  id: string;
  productId: string;
  warehouseId?: string | null;
  price?: number | null;
  fulfillmentStrategy?: string | null;
  leadTimeDays?: number | null;
  depositPercent?: number | null;
  supplierName?: string | null;
  supplierEmail?: string | null;
  supplierPhone?: string | null;
  supplierCountry?: string | null;
  product?: {
    id: string;
    inventoryMode?: string | null;
    fulfillmentModel?: string | null;
  } | null;
}

export interface InventoryAlert {
  type: 'OUT_OF_STOCK' | 'LOW_STOCK';
  severity: 'critical' | 'warning';
  productId: string;
  productName: string;
  productSku?: string | null;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  reserved: number;
  available: number;
  reorderAt: number;
  salesVelocity30d?: number;
  avgDailySales?: number;
  daysOfStockLeft?: number;
  suggestedReorderQty?: number;
}

export type FulfillmentStrategy =
  | 'LOCAL_STOCK'
  | 'DROPSHIP'
  | 'PREORDER'
  | 'MANUAL'
  | 'HYBRID'
  | 'SERVICE';

export type FulfillmentRouteStatus =
  | 'PENDING'
  | 'RESERVED'
  | 'PO_RAISED'
  | 'PREORDER_ACCEPTED'
  | 'AWAITING_MANUAL'
  | 'PICKING_PACKING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export const ORDER_STATUSES = [
  'placed',
  'awaiting_payment',
  'paid',
  'awaiting_fulfillment',
  'routed',
  'supplier_ordered',
  'picking_packing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  placed: ['awaiting_payment', 'paid', 'cancelled'],
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['awaiting_fulfillment', 'routed', 'supplier_ordered', 'cancelled', 'refunded'],
  awaiting_fulfillment: ['routed', 'supplier_ordered', 'cancelled'],
  routed: ['supplier_ordered', 'picking_packing', 'cancelled'],
  supplier_ordered: ['picking_packing', 'cancelled'],
  picking_packing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
  refunded: [],
};

const LEGACY_STATUS_MAP: Record<string, string> = {
  PENDING: 'placed',
  CONFIRMED: 'awaiting_payment',
  PROCESSING: 'picking_packing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

export function normalizeOrderStatus(status: string): string {
  return LEGACY_STATUS_MAP[status] ?? status;
}

export function canTransitionOrder(from: string, to: string): boolean {
  const normalizedFrom = normalizeOrderStatus(from);
  return VALID_ORDER_TRANSITIONS[normalizedFrom]?.includes(to) ?? false;
}

/**
 * W11-ORDER-CANCEL-RELEASE review OCR-COR-1: the order status a stored status names, read in any case and with any
 * surrounding spaces (the marketplace vocabulary, or the storefront's through LEGACY_STATUS_MAP); undefined for a label
 * of neither (e.g. 'on_hold'). PATCH /marketplace/.../status writes any status as sent, so a stored status is not
 * always spelled as canTransitionOrder's tables are.
 */
export function namedOrderStatus(status?: string | null): string | undefined {
  const trimmed = (status ?? '').trim();
  if (!trimmed) return undefined;
  for (const spelling of [trimmed, trimmed.toUpperCase(), trimmed.toLowerCase()]) {
    const named = Object.prototype.hasOwnProperty.call(LEGACY_STATUS_MAP, spelling) ? LEGACY_STATUS_MAP[spelling] : spelling;
    if (Object.prototype.hasOwnProperty.call(VALID_ORDER_TRANSITIONS, named)) return named;
  }
  return undefined;
}

/**
 * W11-ORDER-CANCEL-RELEASE review OCR-COR-1 (owner ruling D-136) & W1F-ORDER-TRANSITIONS (D-198):
 * whether a cancel (PATCH /marketplace/.../status 'cancelled', PATCH /site/.../status CANCELLED, or
 * MarketplaceService.fulfillOrder 'cancel') may cancel an order stored with this status. A status of either
 * vocabulary, in any case and with any surrounding spaces, may be cancelled as canTransitionOrder says: 'processing',
 * 'pending' and 'confirmed' are open, a shipped, delivered, completed, cancelled or refunded one is not (D-136). A label
 * of neither vocabulary (e.g. 'on_hold', written by the marketplace route as sent) names no step past which a cancel is
 * refused, so it may be cancelled.
 */
export function statusEditMayCancel(status: string): boolean {
  const named = namedOrderStatus(status);
  return named === undefined || VALID_ORDER_TRANSITIONS[named].includes('cancelled');
}

/**
 * W1F-ORDER-TRANSITIONS (owner ruling D-198 `orderstatus`, SEC-W11OCR-2):
 * whether a status-edit PATCH (PATCH /marketplace/.../status or PATCH /site/.../status) may move an order from
 * `from` to `to`. Both statuses are read case-insensitively and trimmed across the marketplace and storefront
 * vocabularies:
 *   - SHIPPED: may stay shipped (idempotent) or move forward to delivered / completed; moving backwards (including
 *     to pending, confirmed, processing, picking_packing, routed, paid, cancelled, or an unknown label like on_hold
 *     or CANCELED) is refused (fix a mistake with a return or refund).
 *   - DELIVERED: may stay delivered (idempotent) or move forward to completed; moving backwards (including to
 *     shipped) is refused.
 *   - COMPLETED: may stay completed (idempotent); moving backwards is refused.
 *   - CANCELLED / REFUNDED: terminal — cannot be reopened or overwritten by a status edit.
 *   - Open statuses (including 'on_hold'): may move to any open, shipped, delivered, or completed status (cancels
 *     are handled separately through releaseOrderFulfilmentForCancel).
 */
export function statusEditMayTransition(from: string, to: string): boolean {
  const fromNamed = namedOrderStatus(from);
  const toNamed = namedOrderStatus(to);
  if (fromNamed === 'shipped') {
    return toNamed === 'shipped' || toNamed === 'delivered' || toNamed === 'completed';
  }
  if (fromNamed === 'delivered') {
    return toNamed === 'delivered' || toNamed === 'completed';
  }
  if (fromNamed === 'completed') {
    return toNamed === 'completed';
  }
  if (fromNamed === 'cancelled' || fromNamed === 'refunded') {
    return false;
  }
  return true;
}

/**
 * W1F-ORDER-TRANSITIONS (D-198): asserts statusEditMayTransition(from, to), throwing 400 BadRequestException
 * when moving a shipped, delivered, or completed order backwards or reopening a cancelled/refunded order.
 */
export function assertStatusEditTransition(from: string, to: string): void {
  if (statusEditMayTransition(from, to)) return;
  const fromNamed = namedOrderStatus(from);
  if (fromNamed === 'cancelled' || fromNamed === 'refunded') {
    throw new BadRequestException(
      `Cannot move order from ${from} to ${to.trim()}: a ${fromNamed} order cannot be reopened or modified`,
    );
  }
  throw new BadRequestException(
    `Cannot move order from ${from} to ${to.trim()}: a ${fromNamed ?? from} order cannot move backwards (use a return or refund instead)`,
  );
}

/**
 * W11-ORDER-CANCEL-RELEASE review OCR-COR-2 (D-136): the 409 a cancel answers when the order's status
 * changed between releaseOrderFulfilmentForCancel's read (under the routing claim) and the cancel's write (a
 * compare-and-set on that status).
 */
export const ORDER_STATUS_CHANGED_DURING_CANCEL =
  "This order's status changed while it was being cancelled (it was shipped or edited meanwhile): nothing was written. " +
  'Reload the order and cancel it again if it can still be cancelled';

/**
 * W1F-ORDER-TRANSITIONS (D-198 `orderstatus`, reverse race): the 409 a status edit or fulfil 'ship' answers when the
 * order's status changed between its read and its compare-and-set write (e.g. a concurrent cancel or delivery committed
 * meanwhile): nothing was written.
 */
export const ORDER_STATUS_CHANGED_DURING_EDIT =
  "This order's status changed while it was being updated (it was cancelled, shipped, or edited meanwhile): nothing was written. " +
  'Reload the order and try again';

/**
 * W11-ORDER-CANCEL-RELEASE (F-35; owner ruling D-136): the release of an order's fulfilment for a cancel, on the
 * cancel's own transaction (run with ROUTING_CLAIM_TX_OPTIONS), which then writes the order's cancelled status and step.
 * Every cancel runs it: the fulfil 'cancel' action (FulfillmentRoutingService.cancelOrderFulfilment, which delegates
 * here) and the two status edits that cancel an order, PATCH /marketplace/.../orders/:orderId/status 'cancelled'
 * (MarketplaceService.updateOrderStatus) and PATCH /site/.../orders/:orderId/status CANCELLED (StoreOrderService.
 * updateOrderStatus). The status edits wrote the status alone: the order's routes stayed RESERVED and their stock
 * reserved for good, an order being routed got its RESERVED routes and reservations after the edit, and a shipped or
 * delivered order was cancelled.
 *
 * It takes the order's routing claim (claimOrderRouting), waiting for a router to commit, then re-reads the order's
 * status: 400 'Cannot cancel order in <status> status' when it can no longer be cancelled (canTransitionOrder, which
 * reads the storefront's vocabulary through LEGACY_STATUS_MAP: PENDING, CONFIRMED and PROCESSING can; SHIPPED,
 * DELIVERED, COMPLETED, CANCELLED and REFUNDED cannot, D-136), the caller's transaction then rolled back with nothing
 * written. Otherwise it locks the stock rows the order's LOCAL_STOCK routes reserved from (each route's product in its
 * warehouse, and no other row of the product: review Z4RV-CR-1) in the global order (core/inventory/stock-lock-order.
 * ts), gives back what each reserved and cancels every route not COMPLETED or CANCELLED. A router that comes after it
 * meets the order cancelled and creates nothing. It releases reservations only: it restocks nothing a paid storefront
 * checkout decremented, and records no refund.
 *
 * W11-ORDER-CANCEL-RELEASE review repairs & W1F-ORDER-TRANSITIONS (D-198): `mayCancel` is the check on the status
 * read; both the status-edit cancels and FulfillmentRoutingService.cancelOrderFulfilment pass `statusEditMayCancel`,
 * which reads the status case-insensitively with any surrounding spaces and admits open labels such as 'on_hold'
 * (OCR-COR-1). It returns the status it read, on which every cancel's order write is a compare-and-set (OCR-COR-2):
 * a status-edit ship (which takes no routing claim) committing while this waits for stock rows is never overwritten
 * (ORDER_STATUS_CHANGED_DURING_CANCEL, 409, the transaction rolled back), while fulfil 'ship' serializes on
 * claimOrderRouting and likewise compare-and-sets on its readStatus.
 */
export async function releaseOrderFulfilmentForCancel(
  tx: RoutingTx,
  businessId: string,
  orderId: string,
  mayCancel: (status: string) => boolean = (status) => canTransitionOrder(status, 'cancelled'),
): Promise<string> {
  await claimOrderRouting(tx, businessId, orderId);
  const order = await tx.marketplaceOrder.findFirst({
    where: { id: orderId, businessId },
    select: { status: true, items: { select: { id: true, productId: true, quantity: true } } },
  });
  if (!order) throw new NotFoundException('Order not found');
  if (!mayCancel(order.status)) {
    throw new BadRequestException(`Cannot cancel order in ${order.status} status`);
  }

  const itemsById = new Map(order.items.map((item) => [item.id, item]));
  const routes = await tx.fulfillmentRoute.findMany({
    where: { businessId, orderId, strategy: 'LOCAL_STOCK', status: { in: ['RESERVED', 'PICKING_PACKING'] } },
  });
  const releases = routes.flatMap((route) => {
    const routeMeta = (route.metadata ?? {}) as RouteMetadata;
    const item = route.orderItemId ? itemsById.get(route.orderItemId) : undefined;
    const untracked =
      routeMeta.noReservationRequired || routeMeta.inventoryMode === 'untracked' || routeMeta.inventoryMode === 'virtual';
    return !route.warehouseId || untracked || !item ? [] : [{ warehouseId: route.warehouseId, item }];
  });

  // Every stock row these routes reserved from, locked at once in the global order before the first is written:
  // only those rows (W10-Z4-ROUTE-FIX review Z4RV-CR-1). Locking the product's rows in every warehouse, a cancel of
  // one line held two rows of its product, and a transfer writing them in the other order (from row, then to row)
  // deadlocked with it: the cancel was rolled back, its route RESERVED and its unit reserved.
  await lockStockRowPairsInOrder(
    tx,
    businessId,
    releases.map(({ warehouseId, item }) => ({ productId: item.productId, warehouseId })),
  );
  for (const { warehouseId, item } of releases) {
    // Read under the lock: what is reserved now, every reservation committed before it counted.
    const stock = await tx.inventoryStock.findFirst({ where: { businessId, productId: item.productId, warehouseId } });
    if (stock) {
      await tx.inventoryStock.update({
        where: { id: stock.id },
        data: { reserved: Math.max(0, stock.reserved - item.quantity) },
      });
    }
  }

  await tx.fulfillmentRoute.updateMany({
    where: { businessId, orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    data: { status: 'CANCELLED' },
  });
  return order.status;
}

@Injectable()
export class FulfillmentRoutingService {
  private readonly logger = new Logger(FulfillmentRoutingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ExpensePostingService) private readonly expensePosting: ExpensePostingService,
  ) {}

  private generatePONumber(): string {
    const prefix = 'PO';
    const timestamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${rand}`;
  }

  /**
   * W10-SOP-FIX review (SOPFIX-SEC-1, SOPFIX-R1; D-112): routing claims the
   * order before it reads the order's routes. A paid order is routed by two
   * routers on purpose (mark_paid's or createOrder's un-awaited autoRouteOrder,
   * and StoreOrderRoutingListener on the paid door's store_order.paid, the
   * safety net), and the manual POST .../route can run beside them. Each read
   * the order's routes, found none and created its own: two LOCAL_STOCK
   * RESERVED routes for one line (the second reservation written over the
   * first), and a DROPSHIP line raised a supplier PurchaseOrder per router.
   *
   * The claim is a transaction-scoped advisory lock on the business and order,
   * taken first in the transaction that reads the routes and writes the new
   * ones with the order's status and timeline steps. A router that meets the
   * order being routed waits for that transaction to commit and then reads its
   * routes (READ COMMITTED: each statement reads what has committed), so it
   * takes the existing-routes path and creates nothing. A failure rolls the
   * routes back with the claim, so the order can be routed again. What follows
   * routing (stock alerts, notifications to the business) runs once the routes
   * have committed.
   *
   * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-1): the claim holds every stock row
   * lock it takes to commit, so they are taken first, all at once and in the
   * global order (routeClaimedOrder, core/inventory/stock-lock-order.ts):
   * reserved line by line in line order, two orders naming the same products in
   * opposite order deadlocked (40P01) and one was left unrouted with
   * store_order.routing_failed. A claim transaction lost to a deadlock or a
   * serialization failure anyway is run once more (ROUTING_CLAIM_ATTEMPTS);
   * the work an aborted attempt queued for after commit is dropped with it.
   */
  async routeOrder(businessId: string, orderId: string): Promise<any[]> {
    const { routes, afterCommit } = await this.claimAndRouteOrder(businessId, orderId);
    for (const work of afterCommit) {
      await work().catch((err) =>
        this.logger.error(`After routing order ${orderId}: ${(err as Error).message}`),
      );
    }
    return routes;
  }

  /**
   * routeOrder's claim transaction, run again once when it is lost to a deadlock or a serialization failure
   * (ROUTING_CLAIM_ATTEMPTS). Returns the routes and the work to run once they have committed; what an aborted attempt
   * queued is dropped with it.
   */
  private async claimAndRouteOrder(
    businessId: string,
    orderId: string,
  ): Promise<{ routes: FulfillmentRouteShape[]; afterCommit: Array<() => Promise<void>> }> {
    for (let attempt = 1; ; attempt += 1) {
      const afterCommit: Array<() => Promise<void>> = [];
      try {
        const routes = await this.prisma.client.$transaction(async (tx) => {
          await claimOrderRouting(tx, businessId, orderId);
          return this.routeClaimedOrder(tx, businessId, orderId, afterCommit);
        }, ROUTING_CLAIM_TX_OPTIONS);
        return { routes, afterCommit };
      } catch (err) {
        if (attempt >= ROUTING_CLAIM_ATTEMPTS || !isLostTransactionConflict(err)) throw err;
        this.logger.warn(`Routing order ${orderId} lost a lock conflict (attempt ${attempt}); routing it again`);
      }
    }
  }

  /** routeOrder's work, under its claim on the order: every read and write on `tx`. */
  private async routeClaimedOrder(
    tx: RoutingTx,
    businessId: string,
    orderId: string,
    afterCommit: Array<() => Promise<void>>,
  ): Promise<FulfillmentRouteShape[]> {
    const order = await tx.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: {
        items: { include: { product: true } },
        fulfillmentRoutes: true,
      },
    });

    if (!order) throw new BadRequestException('Order not found');
    // V1-66 (QUICK-SALE-SERVER): counter sales decrement stock atomically inside completeCheckout
    // and are completed at the counter, so fulfillment routing never reserves stock for them.
    if (order.type === 'QUICK_SALE') return [];

    const normalizedStatus = normalizeOrderStatus(order.status);
    // W10-Z4-ROUTE-FIX (SEAMZ4-CR-3; D-112): an order stored PAID is paid. The paid door leaves a storefront order
    // CONFIRMED / PAID (its fulfilment vocabulary), which reads as awaiting_payment here, so its routing wrote
    // 'awaiting_payment' on a paid order.
    const isPaid =
      normalizedStatus === 'paid' ||
      normalizedStatus === 'awaiting_fulfillment' ||
      String(order.paymentStatus ?? '').toUpperCase() === 'PAID';
    // W10-Z4-ROUTE-FIX (SEAMZ4-CR-2, SEAMZ4-CR-3): the status routing moves a paid order on to is written only from a
    // marketplace status before routing (ROUTING_ADVANCES_FROM), and only while the order still has the status read
    // here (appendOrderTimelineAdvancingStatus): the paid door and the cancel do not take the claim, and the status
    // computed from this read was written over the paid or cancelled they committed meanwhile. An order not paid gets
    // no status written (it was written its own status back).
    const advancesFrom = isPaid && ROUTING_ADVANCES_FROM.has(order.status) ? order.status : null;

    // An order routed already is answered with its routes, whatever status routing moved it to: the router that
    // waited for the claim meets the order routed (a DROPSHIP order supplier_ordered), and refusing that status
    // reported a routing failure for an order that is routed (store_order.routing_failed: an operator action and a
    // failed contact event).
    const existingRoutes = order.fulfillmentRoutes as FulfillmentRouteShape[] | undefined;
    if (existingRoutes && existingRoutes.length > 0) {
      if (advancesFrom) {
        const hasDropship = existingRoutes.some((r) => r.strategy === 'DROPSHIP' || r.strategy === 'HYBRID');
        const finalStatus = hasDropship ? 'supplier_ordered' : 'routed';
        const now = new Date().toISOString();
        // W10-SOP-FIX (SOP-V4): status and step in one statement (order-metadata.ts), not the metadata read above
        // written back over what the paid marking, autoRouteOrder and the paid listeners wrote meanwhile.
        await appendOrderTimelineAdvancingStatus(tx, businessId, orderId, [], {
          from: advancesFrom,
          to: finalStatus,
          steps: [{ status: finalStatus, timestamp: now, note: 'Order status advanced after payment — routes already created' }],
        });
      }
      return existingRoutes;
    }

    const validRoutingStatuses = ['placed', 'awaiting_fulfillment', 'paid', 'routed', 'awaiting_payment'];
    if (!validRoutingStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Cannot route order in status "${order.status}". ` +
          `Order must be in placed, paid, or awaiting_fulfillment status first.`,
      );
    }

    // W11-STOREFRONT-ROUTE-DECREMENTED (F-36; owner ruling D-136): a storefront checkout
    // (StoreOrderService.completeCheckout) decrements tracked stock at payment and records
    // StockMovement { type: 'sale', referenceId: order.orderNumber, quantityChange < 0 }.
    // Under the claim and before taking stock row locks, identify products already taken
    // at checkout: route them as LOCAL_STOCK:RESERVED with noReservationRequired and
    // stockDecrementedAtCheckout (no stock lock, no reservation, no supplier PO / preorder).
    const checkoutSaleMovements = order.orderNumber
      ? await tx.stockMovement.findMany({
          where: {
            businessId,
            referenceId: order.orderNumber,
            type: 'sale',
            quantityChange: { lt: 0 },
          },
          select: { id: true, productId: true, warehouseId: true },
          orderBy: { id: 'asc' },
        })
      : [];
    const decrementedWarehouseByProduct = new Map<string, string>();
    for (const movement of checkoutSaleMovements) {
      if (movement.productId && movement.warehouseId && !decrementedWarehouseByProduct.has(movement.productId)) {
        decrementedWarehouseByProduct.set(movement.productId, movement.warehouseId);
      }
    }

    // W10-Z4-ROUTE-FIX (SEAMZ4-CR-1): every stock row any line can reserve from (each line's product, in every
    // warehouse of the business) is locked here, all at once, in the global order, before the first reservation; a
    // line reserves only from these rows. Locked line by line in line order and held to commit, two orders with the
    // same products in opposite order each held one row and waited for the other's (40P01).
    // Products already decremented at checkout are excluded so we lock only rows this tx may write.
    const lockedStockIds = await lockStockRowsInOrder(
      tx,
      businessId,
      (order.items as OrderItemShape[])
        .filter((item) => !decrementedWarehouseByProduct.has(item.productId))
        .map((item) => item.productId),
    );

    // V1-70 (W1F-SETTLE-NO-STOCK; owner ruling D-199 `paidnostock`): lines the
    // paid door already alerted the business about via
    // `store_order.stock_not_decremented` (missing/insufficient own stock or
    // held-elsewhere stock on a provider settlement) must not trigger a second
    // `seller_low_stock` email from routing.
    const orderMeta = (order.metadata ?? {}) as OrderMetadata;
    const alreadyAlertedProductIds = new Set<string>(
      Array.isArray(orderMeta.stockNotDecrementedProductIds)
        ? orderMeta.stockNotDecrementedProductIds.filter((id): id is string => typeof id === 'string')
        : [],
    );

    const routes: FulfillmentRouteShape[] = [];

    for (const item of order.items as OrderItemShape[]) {
      const listing = await (
        item.listingId
          ? tx.marketplaceListing.findFirst({
              where: { id: item.listingId, businessId, isActive: true },
            })
          : tx.marketplaceListing.findFirst({
              where: { productId: item.productId, businessId, isActive: true },
            })
      );

      const decrementedWarehouseId = decrementedWarehouseByProduct.get(item.productId);
      if (decrementedWarehouseId !== undefined) {
        const route = await tx.fulfillmentRoute.create({
          data: {
            businessId,
            orderId,
            orderItemId: item.id,
            listingId: listing?.id,
            strategy: 'LOCAL_STOCK',
            status: 'RESERVED',
            sourceType: 'WAREHOUSE',
            warehouseId: decrementedWarehouseId,
            notes: 'Stock taken at checkout — no reservation',
            metadata: {
              inventoryMode: 'tracked',
              noReservationRequired: true,
              stockDecrementedAtCheckout: true,
            },
          },
        });
        routes.push(route as unknown as FulfillmentRouteShape);
        continue;
      }

      const rawStrategy = listing?.fulfillmentStrategy ?? 'LOCAL_STOCK';
      const strategy = (rawStrategy.toUpperCase() as FulfillmentStrategy);

      let route: FulfillmentRouteShape;

      switch (strategy) {
        case 'LOCAL_STOCK':
          route = await this.routeLocalStock(
            tx,
            afterCommit,
            businessId,
            orderId,
            item,
            listing,
            lockedStockIds,
            alreadyAlertedProductIds,
          );
          break;
        case 'DROPSHIP':
          route = await this.routeDropship(tx, businessId, orderId, item, listing, order as unknown as MarketplaceOrderShape);
          break;
        case 'PREORDER':
          route = await this.routePreorder(tx, businessId, orderId, item, listing, order as unknown as MarketplaceOrderShape);
          break;
        case 'HYBRID':
          route = await this.routeHybrid(
            tx,
            afterCommit,
            businessId,
            orderId,
            item,
            listing,
            order as unknown as MarketplaceOrderShape,
            lockedStockIds,
            alreadyAlertedProductIds,
          );
          break;
        case 'MANUAL':
          route = await this.routeManual(tx, afterCommit, businessId, orderId, item, listing, alreadyAlertedProductIds);
          break;
        case 'SERVICE':
          route = await this.routeService(tx, businessId, orderId, item, listing);
          break;
        default:
          route = await this.routeManual(tx, afterCommit, businessId, orderId, item, listing, alreadyAlertedProductIds);
      }

      routes.push(route);
    }

    const hasDropship = routes.some(
      (r) => r.strategy === 'DROPSHIP' || r.strategy === 'HYBRID',
    );
    const now = new Date().toISOString();

    const finalStatus = hasDropship ? 'supplier_ordered' : 'routed';
    const advanceStep: OrderStatusTimelineEntry = hasDropship
      ? { status: 'supplier_ordered', timestamp: now, note: 'Purchase orders raised for dropship items' }
      : { status: 'routed', timestamp: now, note: 'Order routed — awaiting processing' };

    // W10-SOP-FIX (SOP-V4): status and steps in one statement. The metadata read with the order at the top was written
    // back whole, over the paid marking's step, autoRouteOrder's step and the paid listener's contact link written while
    // the routes were created (and this order is routed by mark_paid and StoreOrderRoutingListener together).
    // W10-Z4-ROUTE-FIX (SEAMZ4-CR-2, SEAMZ4-CR-3): the status (and its step) only for a paid order in a status routing
    // moves on, and only while it still has the status read under the claim (advancesFrom).
    await appendOrderTimelineAdvancingStatus(
      tx,
      businessId,
      orderId,
      [{ status: 'routes_created', timestamp: now, note: 'Routes created by fulfillment engine; inventory reserved' }],
      advancesFrom ? { from: advancesFrom, to: finalStatus, steps: [advanceStep] } : null,
    );

    return routes;
  }

  /**
   * @param lockedStockIds the stock rows the claim locked (routeClaimedOrder): the line reserves from one of these
   *   only, so it writes no stock row outside the claim's one locking statement (W10-Z4-ROUTE-FIX, SEAMZ4-CR-1). A row
   *   created after that statement is not reserved from by this routing.
   */
  private async routeLocalStock(
    tx: RoutingTx,
    afterCommit: Array<() => Promise<void>>,
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    lockedStockIds: readonly string[],
    alreadyAlertedProductIds: ReadonlySet<string> = new Set(),
  ): Promise<FulfillmentRouteShape> {
    // W11-CHECKOUT-PAIR-SCOPE review (CPS-SEC-3, CPS-COR-1; D-137): only the business's own stock rows count as stock
    // kept for the product (ownStockRows), as at the paid door: another business's planted row made a no-mode line the
    // door had sold as untracked read as tracked here, and it was failed for stock (this routing reserves from the
    // business's own rows only).
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { inventoryMode: true, _count: { select: { inventoryStocks: { where: ownStockRows(businessId) } } } },
    });

    // See core/inventory/inventory-mode.ts. Resolving NULL to 'tracked' routed
    // every unconfigured product as if stock were being kept for it.
    const inventoryMode = resolveInventoryMode(
      product?.inventoryMode,
      (product?._count.inventoryStocks ?? 0) > 0,
    ).toLowerCase();

    if (inventoryMode === 'untracked' || inventoryMode === 'virtual') {
      const route = await tx.fulfillmentRoute.create({
        data: {
          businessId,
          orderId,
          orderItemId: item.id,
          listingId: listing?.id,
          strategy: 'LOCAL_STOCK',
          status: 'RESERVED',
          sourceType: 'WAREHOUSE',
          notes: `${inventoryMode === 'virtual' ? 'Virtual/digital' : 'Untracked'} product — no inventory reservation required`,
          metadata: { inventoryMode, noReservationRequired: true },
        },
      });
      return route as unknown as FulfillmentRouteShape;
    }

    // V1-70 (W1F-SETTLE-NO-STOCK; D-199, R1-COR-01): never partially reserve stock for a tracked
    // product whose stock was left untouched (and COGS skipped) at checkout settlement (e.g.
    // multi-line duplicate-product shortfall, inactive warehouse, or post-commit restock window).
    if (alreadyAlertedProductIds.has(item.productId)) {
      const route = await tx.fulfillmentRoute.create({
        data: {
          businessId,
          orderId,
          orderItemId: item.id,
          listingId: listing?.id,
          strategy: 'LOCAL_STOCK',
          status: 'FAILED',
          sourceType: 'WAREHOUSE',
          notes: `Stock not decremented at checkout; awaiting restock or refund (required: ${item.quantity})`,
          metadata: { inventoryMode: 'tracked', stockNotDecrementedAtCheckout: true },
        },
      });
      return route as unknown as FulfillmentRouteShape;
    }

    // Read under the claim's row lock, so the reservation below counts every reservation committed before it.
    const stock = await tx.inventoryStock.findFirst({
      where: { id: { in: [...lockedStockIds] }, productId: item.productId, businessId },
      orderBy: { quantity: 'desc' },
    });

    const available = stock ? stock.quantity - stock.reserved : 0;

    if (available >= item.quantity) {
      await tx.inventoryStock.update({
        where: { id: stock!.id },
        data: { reserved: stock!.reserved + item.quantity },
      });

      const taskNote = `Pick/pack task pending for item ${item.id} x${item.quantity}`;
      const route = await tx.fulfillmentRoute.create({
        data: {
          businessId,
          orderId,
          orderItemId: item.id,
          listingId: listing?.id,
          strategy: 'LOCAL_STOCK',
          status: 'RESERVED',
          sourceType: 'WAREHOUSE',
          warehouseId: stock!.warehouseId,
          notes: `Reserved ${item.quantity} units from warehouse`,
          metadata: {
            inventoryMode: 'tracked',
            task: {
              type: 'PICK_AND_PACK',
              productId: item.productId,
              quantity: item.quantity,
              warehouseId: stock!.warehouseId,
              status: 'PENDING',
              note: taskNote,
            },
          },
        },
      });

      // Read once the reservation has committed (routeOrder), as it was read after the reservation's own write.
      const stockId = stock!.id;
      afterCommit.push(() => this.checkAndAlertReorderThreshold(businessId, stockId));

      return route as unknown as FulfillmentRouteShape;
    } else {
      const route = await tx.fulfillmentRoute.create({
        data: {
          businessId,
          orderId,
          orderItemId: item.id,
          listingId: listing?.id,
          strategy: 'LOCAL_STOCK',
          status: 'FAILED',
          sourceType: 'WAREHOUSE',
          notes: `Insufficient stock. Available: ${available}, Required: ${item.quantity}`,
          metadata: { inventoryMode: 'tracked' },
        },
      });

      this.logger.warn(
        `Insufficient stock for product ${item.productId} in order ${orderId}. ` +
          `Available: ${available}, Required: ${item.quantity}`,
      );

      if (!alreadyAlertedProductIds.has(item.productId)) {
        afterCommit.push(async () => {
          await this.notifyInsufficientStock(businessId, orderId, item, available).catch((err) =>
            this.logger.error(`Failed to send insufficient-stock notification: ${(err as Error).message}`),
          );
        });
      }

      return route as unknown as FulfillmentRouteShape;
    }
  }

  private async hasCheckoutStockShortfallNotice(
    businessId: string,
    orderId: string,
    productId: string,
  ): Promise<boolean> {
    if (!this.prisma.client.notification) return false;
    const existingNotices = await this.prisma.client.notification.findMany({
      where: {
        businessId,
        type: 'store_order.stock_not_decremented',
        data: { path: ['orderId'], equals: orderId },
      },
      select: { data: true },
    });
    return existingNotices.some((n) => {
      const products = (n.data as { products?: Array<{ productId?: string }> } | null)?.products;
      return Array.isArray(products) && products.some((p) => p?.productId === productId);
    });
  }

  private async notifyInsufficientStock(
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    available: number,
  ): Promise<void> {
    // V1-70 (W1F-SETTLE-NO-STOCK; D-199): defense-in-depth — never send a
    // second seller_low_stock email when the paid door already alerted the
    // business for this order and product line.
    if (await this.hasCheckoutStockShortfallNotice(businessId, orderId, item.productId)) {
      return;
    }

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId },
      select: { email: true, name: true },
    });
    if (!business?.email) return;

    await this.emailService.send({
      businessId,
      type: 'seller_low_stock',
      recipientEmail: business.email,
      recipientName: business.name ?? 'Store Owner',
      templateData: {
        orderId,
        productName: item.name,
        sku: item.sku ?? 'N/A',
        requiredQty: item.quantity,
        availableQty: available,
        businessName: business.name ?? 'Store',
        message: `Order cannot be fulfilled for "${item.name}" (SKU: ${item.sku ?? 'N/A'}). Required: ${item.quantity}, Available: ${available}. Please replenish stock or update the order manually.`,
      },
      dedupeKey: `stock-alert-${orderId}-${item.productId}`,
    });
  }

  private async resolveSupplierSourceLink(tx: RoutingTx, productId: string): Promise<{
    id: string;
    priority: number;
    sourceCost?: number | null;
    leadTimeDays?: number | null;
    supplierProduct: {
      supplierConnection: {
        displayName?: string | null;
      };
    };
  } | null> {
    return tx.productSourceLink.findFirst({
      where: {
        productId,
        isActive: true,
        availabilityState: { not: 'unavailable' },
      },
      include: {
        supplierProduct: {
          include: { supplierConnection: true },
        },
      },
      orderBy: { priority: 'asc' },
    });
  }

  private async routeDropship(
    tx: RoutingTx,
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    order: MarketplaceOrderShape,
  ): Promise<FulfillmentRouteShape> {
    const sourceLink = await this.resolveSupplierSourceLink(tx, item.productId);

    let supplierName: string;
    let supplierEmail: string | null;
    let supplierPhone: string | null;
    let supplierCountry: string | null;
    let unitCost: number;
    let leadTimeDays: number | null;
    let sourceLinkId: string | null = null;

    if (sourceLink) {
      const connection = sourceLink.supplierProduct.supplierConnection;
      supplierName = connection.displayName ?? 'Unknown Supplier';
      supplierEmail = null;
      supplierPhone = null;
      supplierCountry = null;
      unitCost = sourceLink.sourceCost ?? item.unitPrice;
      leadTimeDays = sourceLink.leadTimeDays ?? listing?.leadTimeDays ?? null;
      sourceLinkId = sourceLink.id;
    } else {
      supplierName = listing?.supplierName ?? 'Unknown Supplier';
      supplierEmail = listing?.supplierEmail ?? null;
      supplierPhone = listing?.supplierPhone ?? null;
      supplierCountry = listing?.supplierCountry ?? null;
      unitCost = item.unitPrice;
      leadTimeDays = listing?.leadTimeDays ?? null;
    }

    const subtotal = unitCost * item.quantity;

    const po = await tx.purchaseOrder.create({
      data: {
        businessId,
        poNumber: this.generatePONumber(),
        status: 'DRAFT',
        supplierName,
        supplierEmail,
        supplierPhone,
        supplierCountry,
        items: [
          {
            productId: item.productId,
            name: item.name,
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: unitCost,
            total: subtotal,
            orderId,
            orderItemId: item.id,
            sourceLinkId,
          },
        ],
        subtotal,
        shippingCost: 0,
        taxAmount: 0,
        total: subtotal,
        currency: order.currency ?? 'TTD',
        expectedDelivery: leadTimeDays ? new Date(Date.now() + leadTimeDays * 86400000) : undefined,
        notes: `Auto-generated for order ${order.orderNumber}`,
      },
    });

    const route = await tx.fulfillmentRoute.create({
      data: {
        businessId,
        orderId,
        orderItemId: item.id,
        listingId: listing?.id,
        strategy: 'DROPSHIP',
        status: 'PO_RAISED',
        sourceType: 'SUPPLIER',
        purchaseOrderId: po.id,
        sourceLinkId,
        notes: `Dropship PO ${po.poNumber} raised for supplier: ${supplierName}`,
        metadata: {
          supplierName,
          leadTimeDays,
          unitCost,
          usedSourceLink: !!sourceLink,
          sourceLinkPriority: sourceLink?.priority ?? null,
        },
      },
    });

    return route as unknown as FulfillmentRouteShape;
  }

  private async routePreorder(
    tx: RoutingTx,
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    order: MarketplaceOrderShape,
  ): Promise<FulfillmentRouteShape> {
    const leadTimeDays = listing?.leadTimeDays ?? 14;
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + leadTimeDays);

    const depositPercent = listing?.depositPercent ?? 0;
    const itemTotal = item.total ?? item.unitPrice * item.quantity;
    const depositAmount = depositPercent > 0 ? (itemTotal * depositPercent) / 100 : undefined;

    const preOrder = await tx.preOrder.create({
      data: {
        businessId,
        productId: item.productId,
        customerName: order.customerName ?? 'Unknown Customer',
        customerEmail: order.customerEmail ?? null,
        customerPhone: order.customerPhone ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        depositAmount,
        total: item.total ?? item.unitPrice * item.quantity,
        currency: order.currency ?? 'TTD',
        expectedDate,
        status: 'PENDING',
        notes: `Auto-created from order ${order.orderNumber ?? ''}`,
      },
    });

    const route = await tx.fulfillmentRoute.create({
      data: {
        businessId,
        orderId,
        orderItemId: item.id,
        listingId: listing?.id,
        strategy: 'PREORDER',
        status: 'PREORDER_ACCEPTED',
        sourceType: 'PREORDER',
        preOrderId: preOrder.id,
        notes: `Preorder accepted. Expected delivery: ${expectedDate.toISOString().split('T')[0]}`,
        metadata: { expectedDate: expectedDate.toISOString(), leadTimeDays },
      },
    });

    return route as unknown as FulfillmentRouteShape;
  }

  private async routeHybrid(
    tx: RoutingTx,
    afterCommit: Array<() => Promise<void>>,
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    order: MarketplaceOrderShape,
    lockedStockIds: readonly string[],
    alreadyAlertedProductIds: ReadonlySet<string> = new Set(),
  ): Promise<FulfillmentRouteShape> {
    const stock = await tx.inventoryStock.findFirst({
      where: { id: { in: [...lockedStockIds] }, productId: item.productId, businessId },
      orderBy: { quantity: 'desc' },
    });

    const available = stock ? stock.quantity - stock.reserved : 0;

    if (!alreadyAlertedProductIds.has(item.productId) && available >= item.quantity) {
      this.logger.log(
        `Hybrid: local stock satisfied for product ${item.productId} (${available}/${item.quantity})`,
      );
      return this.routeLocalStock(
        tx,
        afterCommit,
        businessId,
        orderId,
        item,
        listing,
        lockedStockIds,
        alreadyAlertedProductIds,
      );
    }

    const sourceLink = await this.resolveSupplierSourceLink(tx, item.productId);
    const hasSupplier = !!(sourceLink || listing?.supplierName);

    if (hasSupplier) {
      this.logger.log(
        `Hybrid: fallback to dropship for product ${item.productId}. ` +
          `Local stock insufficient (${available}/${item.quantity}). ` +
          `Using ${sourceLink ? `ProductSourceLink priority=${sourceLink.priority}` : 'listing supplier'}`,
      );
      return this.routeDropship(tx, businessId, orderId, item, listing, order);
    }

    this.logger.log(
      `Hybrid: fallback to preorder for product ${item.productId}. No local stock or supplier available.`,
    );
    return this.routePreorder(tx, businessId, orderId, item, listing, order);
  }

  private async routeManual(
    tx: RoutingTx,
    afterCommit: Array<() => Promise<void>>,
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    alreadyAlertedProductIds: ReadonlySet<string> = new Set(),
  ): Promise<FulfillmentRouteShape> {
    const route = await tx.fulfillmentRoute.create({
      data: {
        businessId,
        orderId,
        orderItemId: item.id,
        listingId: listing?.id,
        strategy: 'MANUAL',
        status: 'AWAITING_MANUAL',
        sourceType: 'MANUAL',
        notes: `Manual fulfillment required for ${item.name ?? 'item'} x${item.quantity}`,
      },
    });

    if (!alreadyAlertedProductIds.has(item.productId)) {
      afterCommit.push(async () => {
        await this.notifyManualFulfillmentRequired(businessId, orderId, item).catch((err) =>
          this.logger.error(`Failed to send manual-fulfillment notification: ${(err as Error).message}`),
        );
      });
    }

    return route as unknown as FulfillmentRouteShape;
  }

  private async notifyManualFulfillmentRequired(
    businessId: string,
    orderId: string,
    item: OrderItemShape,
  ): Promise<void> {
    // V1-70 (W1F-SETTLE-NO-STOCK; D-199, R1-COR-02): never send a duplicate
    // seller_low_stock email when checkout already alerted the business for this line.
    if (await this.hasCheckoutStockShortfallNotice(businessId, orderId, item.productId)) {
      return;
    }

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId },
      select: { email: true, name: true },
    });
    if (!business?.email) return;

    await this.emailService.send({
      businessId,
      type: 'seller_low_stock',
      recipientEmail: business.email,
      recipientName: business.name ?? 'Store Owner',
      templateData: {
        orderId,
        productName: item.name ?? 'Item',
        sku: 'N/A',
        requiredQty: item.quantity,
        availableQty: 0,
        businessName: business.name ?? 'Store',
        message: `Order ${orderId} requires manual fulfillment for "${item.name ?? 'an item'}" x${item.quantity}. Please process this order manually.`,
      },
      dedupeKey: `manual-fulfillment-${orderId}-${item.id}`,
    });
  }

  private async routeService(
    tx: RoutingTx,
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
  ): Promise<FulfillmentRouteShape> {
    const route = await tx.fulfillmentRoute.create({
      data: {
        businessId,
        orderId,
        orderItemId: item.id,
        listingId: listing?.id,
        strategy: 'SERVICE',
        status: 'RESERVED',
        sourceType: 'SERVICE',
        notes: `Service fulfillment for ${item.name} x${item.quantity}`,
      },
    });

    return route as unknown as FulfillmentRouteShape;
  }

  async getFulfillmentRoutes(businessId: string, orderId: string): Promise<any[]> {
    return this.prisma.client.fulfillmentRoute.findMany({
      where: { businessId, orderId },
      include: {
        warehouse: true,
        purchaseOrder: true,
        preOrder: true,
        shipment: true,
        listing: { include: { product: true } },
      },
    });
  }

  async updateFulfillmentRoute(
    businessId: string,
    routeId: string,
    data: {
      status?: FulfillmentRouteStatus;
      shipmentId?: string;
      notes?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    const route = await this.prisma.client.fulfillmentRoute.findFirst({
      where: { id: routeId, businessId },
    });
    if (!route) throw new BadRequestException('Fulfillment route not found');

    if (data.shipmentId) {
      const shipment = await this.prisma.client.shipment.findFirst({
        where: { id: data.shipmentId, businessId },
      });
      if (!shipment) {
        throw new BadRequestException('Shipment not found or does not belong to this business');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (data.status) updateData.status = data.status;
    if (data.shipmentId) updateData.shipmentId = data.shipmentId;
    if (data.notes) updateData.notes = data.notes;
    if (data.metadata) {
      updateData.metadata = { ...((route.metadata as Record<string, unknown>) ?? {}), ...data.metadata };
    }
    if (data.status === 'COMPLETED' || data.status === 'DELIVERED') {
      updateData.resolvedAt = new Date();
    }

    return this.prisma.client.fulfillmentRoute.update({
      where: { id: routeId },
      data: updateData,
      include: {
        warehouse: true,
        purchaseOrder: true,
        preOrder: true,
        shipment: true,
      },
    });
  }

  /**
   * W11-SHIP-STOCK-DECREMENT (F-26; owner ruling D-136): the fulfil 'ship'
   * action's fulfilment, shipment, route, stock decrement, and audit movement
   * writes, on the ship's own transaction (run with ROUTING_CLAIM_TX_OPTIONS),
   * which then appends the timeline step and writes the order's shipped status
   * (MarketplaceService.fulfillOrder).
   *
   * Replaces the standalone decrementInventoryOnShip(businessId, routeId),
   * which ran outside any transaction or lock and was only invoked for
   * LOCAL_STOCK routes still RESERVED — missing routes already moved to
   * PICKING_PACKING by 'process', losing concurrent routing reservations, and
   * letting concurrent 'ship' calls both succeed and double-decrement.
   *
   * Order of operations inside `tx`:
   *   1. validate optional `carrier`, `trackingNumber`, and `estimatedDelivery`
   *      inputs (400 on malformed values before mutating state);
   *   2. claimOrderRouting(tx, businessId, orderId) — serializes with routing,
   *      concurrent ships, and cancels on this order;
   *   3. re-read the order's status, shippingAddress, and items under the claim
   *      and refuse 400 unless canTransitionOrder(status, 'shipped');
   *   4. read the order's LOCAL_STOCK routes in RESERVED or PICKING_PACKING;
   *   5. lock the (productId, warehouseId) inventory_stocks rows of the tracked
   *      ones in the global order (lockStockRowPairsInOrder), skipping routes
   *      that are noReservationRequired, untracked, virtual, or lack a
   *      warehouseId or order item — strictly BEFORE creating the Shipment row
   *      (whose FK takes FOR KEY SHARE on marketplace_orders, avoiding a 40P01
   *      cycle with completeCheckout which locks inventory_stocks then
   *      marketplace_orders FOR UPDATE);
   *   6. create the Shipment when carrier or trackingNumber is given;
   *   7. for each LOCAL_STOCK route, compare-and-set RESERVED/PICKING_PACKING
   *      to SHIPPED (with shipmentId when created); only when count === 1 and
   *      the route is tracked, read the locked stock row, clamp quantity and
   *      reserved at 0, update it, write a SALE/SHIP StockMovement audit row
   *      naming the acting member, and collect the stock id for post-commit
   *      reorder alerting;
   *   8. move remaining PICKING_PACKING, PO_RAISED, and PREORDER_ACCEPTED
   *      routes (e.g. MANUAL, DROPSHIP, PREORDER) to SHIPPED.
   *
   * Returns the deduplicated ids of stock rows decremented (so the caller runs
   * checkAndAlertReorderThreshold after the transaction commits) and the order
   * status read under the claim (W1F-ORDER-TRANSITIONS, D-198: so the caller
   * compare-and-sets the order's status write on that readStatus).
   */
  async shipOrderFulfilment(
    tx: RoutingTx,
    businessId: string,
    orderId: string,
    data?: { carrier?: unknown; trackingNumber?: unknown; estimatedDelivery?: unknown },
    actorId: string | null = null,
  ): Promise<{ decrementedStockIds: string[]; readStatus: string }> {
    const carrier =
      data?.carrier === undefined || data?.carrier === null
        ? undefined
        : typeof data.carrier === 'string'
          ? data.carrier
          : (() => {
              throw new BadRequestException('carrier must be a string');
            })();
    const trackingNumber =
      data?.trackingNumber === undefined || data?.trackingNumber === null
        ? undefined
        : typeof data.trackingNumber === 'string'
          ? data.trackingNumber
          : (() => {
              throw new BadRequestException('trackingNumber must be a string');
            })();
    let estimatedDelivery: Date | undefined;
    if (data?.estimatedDelivery !== undefined && data?.estimatedDelivery !== null && data?.estimatedDelivery !== '') {
      if (typeof data.estimatedDelivery !== 'string' && !(data.estimatedDelivery instanceof Date)) {
        throw new BadRequestException('estimatedDelivery must be a valid date');
      }
      const parsed = data.estimatedDelivery instanceof Date ? data.estimatedDelivery : new Date(data.estimatedDelivery);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('estimatedDelivery must be a valid date');
      }
      estimatedDelivery = parsed;
    }

    await claimOrderRouting(tx, businessId, orderId);

    const order = await tx.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: {
        status: true,
        shippingAddress: true,
        items: { select: { id: true, productId: true, quantity: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!canTransitionOrder(order.status, 'shipped')) {
      throw new BadRequestException(`Cannot ship order in ${order.status} status`);
    }

    const itemsById = new Map(order.items.map((item) => [item.id, item]));
    const localRoutes = await tx.fulfillmentRoute.findMany({
      where: {
        businessId,
        orderId,
        strategy: 'LOCAL_STOCK',
        status: { in: ['RESERVED', 'PICKING_PACKING'] },
      },
    });

    const routeEntries = localRoutes.map((route) => {
      const routeMeta = (route.metadata ?? {}) as RouteMetadata;
      const item = route.orderItemId ? itemsById.get(route.orderItemId) : undefined;
      const untracked =
        routeMeta.noReservationRequired ||
        routeMeta.inventoryMode === 'untracked' ||
        routeMeta.inventoryMode === 'virtual';
      const tracked = Boolean(!untracked && route.warehouseId && item && item.quantity > 0);
      return { route, routeMeta, item, tracked };
    });

    await lockStockRowPairsInOrder(
      tx,
      businessId,
      routeEntries.flatMap(({ route, item, tracked }) =>
        tracked && route.warehouseId && item ? [{ productId: item.productId, warehouseId: route.warehouseId }] : [],
      ),
    );

    let shipmentId: string | undefined;
    if (carrier || trackingNumber) {
      const shipment = await tx.shipment.create({
        data: {
          businessId,
          orderId,
          carrier,
          trackingNumber,
          status: 'IN_TRANSIT',
          shippedAt: new Date(),
          estimatedDelivery,
          destinationAddress: order.shippingAddress ?? undefined,
        },
      });
      shipmentId = shipment.id;
    }

    const decrementedStockIds = new Set<string>();
    for (const { route, routeMeta, item, tracked } of routeEntries) {
      const transitioned = await tx.fulfillmentRoute.updateMany({
        where: {
          id: route.id,
          businessId,
          status: { in: ['RESERVED', 'PICKING_PACKING'] },
        },
        data: {
          status: 'SHIPPED',
          ...(shipmentId ? { shipmentId } : {}),
        },
      });
      if (transitioned.count !== 1) continue;

      if (!tracked || !route.warehouseId || !item) {
        if (routeMeta.noReservationRequired || routeMeta.inventoryMode === 'untracked' || routeMeta.inventoryMode === 'virtual') {
          this.logger.log(`Skipping inventory decrement for ${routeMeta.inventoryMode ?? 'untracked'} route ${route.id}`);
        }
        continue;
      }

      const stock = await tx.inventoryStock.findFirst({
        where: { businessId, productId: item.productId, warehouseId: route.warehouseId },
      });
      if (!stock) continue;

      const newQuantity = Math.max(0, stock.quantity - item.quantity);
      const newReserved = Math.max(0, stock.reserved - item.quantity);

      await tx.inventoryStock.update({
        where: { id: stock.id },
        data: { quantity: newQuantity, reserved: newReserved },
      });

      const quantityDelta = newQuantity - stock.quantity;
      if (quantityDelta !== 0) {
        await tx.stockMovement.create({
          data: {
            businessId,
            warehouseId: route.warehouseId,
            productId: item.productId,
            type: 'SALE',
            quantityChange: quantityDelta,
            reasonCode: 'SHIP',
            referenceId: orderId,
            createdBy: actorId ?? null,
          },
        });
      }

      decrementedStockIds.add(stock.id);
    }

    if (shipmentId) {
      await tx.fulfillmentRoute.updateMany({
        where: {
          businessId,
          orderId,
          status: { in: ['PICKING_PACKING', 'PO_RAISED', 'PREORDER_ACCEPTED'] },
          shipmentId: null,
        },
        data: { status: 'SHIPPED', shipmentId },
      });
    }
    await tx.fulfillmentRoute.updateMany({
      where: {
        businessId,
        orderId,
        status: { in: ['PICKING_PACKING', 'PO_RAISED', 'PREORDER_ACCEPTED'] },
      },
      data: { status: 'SHIPPED' },
    });

    return { decrementedStockIds: [...decrementedStockIds], readStatus: order.status };
  }

  /**
   * W10-Z4-ROUTE-FIX (seam review SEAMZ4-CR-2): the fulfil 'cancel' action's
   * release of an order's fulfilment, on the cancel's own transaction, which
   * then writes the order's cancelled status and step (MarketplaceService.
   * fulfillOrder).
   *
   * It takes the order's routing claim first (claimOrderRouting). The cancel
   * released the reservations of the routes committed when it ran, with no
   * claim: an order being routed had none yet, and the router then committed
   * its RESERVED routes, their reserved stock and 'routed' over the cancelled
   * status. Under the claim the cancel waits for a router to commit, then
   * re-reads the order's status (400 when it can no longer be cancelled), locks
   * the stock rows its LOCAL_STOCK routes reserved from (each route's product in
   * its warehouse, and no other row of the product: review Z4RV-CR-1) in the
   * global order (core/inventory/stock-lock-order.ts), gives back what each
   * reserved and cancels every route not COMPLETED or CANCELLED. A router that comes after
   * it meets the order cancelled and creates nothing.
   *
   * W11-ORDER-CANCEL-RELEASE & W1F-ORDER-TRANSITIONS (D-198): delegates to
   * releaseOrderFulfilmentForCancel with statusEditMayCancel (case-insensitive
   * open-status read including 'on_hold') and returns the status read under the
   * claim so the caller compare-and-sets its status write.
   */
  async cancelOrderFulfilment(tx: RoutingTx, businessId: string, orderId: string): Promise<string> {
    return releaseOrderFulfilmentForCancel(tx, businessId, orderId, statusEditMayCancel);
  }

  async checkAndAlertReorderThreshold(businessId: string, stockId: string): Promise<void> {
    const stock = await this.prisma.client.inventoryStock.findUnique({
      where: { id: stockId },
      include: { product: true, warehouse: true },
    });

    if (!stock || stock.businessId !== businessId || !stock.reorderAt) return;

    const available = stock.quantity - stock.reserved;

    if (available <= 0) {
      this.logger.warn(
        `[STOCK ALERT] OUT OF STOCK: Product "${stock.product.name}" ` +
          `(${stock.product.sku ?? stock.productId}) in warehouse "${stock.warehouse.name}". ` +
          `Business: ${businessId}`,
      );
      this.events.emit('inventory.out', {
        businessId,
        productId: stock.productId,
        productName: stock.product.name,
        productSku: stock.product.sku,
        warehouseId: stock.warehouseId,
        warehouseName: stock.warehouse.name,
      } as InventoryOutPayload);
    } else if (available <= stock.reorderAt) {
      this.logger.warn(
        `[STOCK ALERT] LOW STOCK: Product "${stock.product.name}" ` +
          `(${stock.product.sku ?? stock.productId}) in warehouse "${stock.warehouse.name}". ` +
          `Available: ${available}, Reorder threshold: ${stock.reorderAt}. Business: ${businessId}`,
      );
      this.events.emit('inventory.low', {
        businessId,
        productId: stock.productId,
        productName: stock.product.name,
        productSku: stock.product.sku,
        warehouseId: stock.warehouseId,
        warehouseName: stock.warehouse.name,
        quantity: available,
        reorderAt: stock.reorderAt,
      } as InventoryLowPayload);
    }
  }

  /**
   * W10-Z4-ROUTE-FIX review (Z4RV-SEC-1): the stock a purchase order received
   * adds, one entry per line that adds any (a product, a warehouse, a quantity
   * above 0): the line's product, its warehouse or else the business's default
   * one, and its quantity (received, else ordered).
   *
   * Each line's product and warehouse must be the business's (a soft-deleted
   * product of the business counts), or the receipt is refused (400) before
   * anything is written. A purchase order's items are stored as its creator
   * sent them (createPurchaseOrder, body: any), and the receipt wrote the stock
   * row of whatever (productId, warehouseId) a line named: another business's
   * row (its quantity, and its weighted-average cost), or a new row of this
   * business for another business's product, which makes that product read as
   * stock-tracked (resolveInventoryMode) and its storefront refuse to sell it.
   *
   * W11-PO-LINES (owner ruling D-136; F-40): each stored line is read first by
   * core/inventory/purchase-order-lines.ts, the reader createPurchaseOrder
   * checks a line with. A line naming a product whose ids are not non-empty
   * strings, or whose stock quantity is not a whole number of 0 or more, is
   * refused (400 'Purchase order line N is malformed; nothing was received')
   * before any stock is read or written; only the strings and numbers read are
   * passed on (the ownership check, the stock locks and the writes). The ids
   * were coerced with String() for the check and passed raw after it, so a
   * one-element array (String(['x']) is 'x') reached Prisma (500), digit text
   * was added to an integer column (500) and a fraction was stored truncated.
   * A legacy quantity stored as digit text ('5') is received as that number
   * (D-136), and the line's cost is Number(unitCost) when finite and above 0,
   * on an updated and a created stock row alike (a text cost on a new row was
   * a 500). A line that is not an object, or names no product, adds no stock
   * and is passed over, as before.
   */
  private async receivedStockLines(
    businessId: string,
    items: Prisma.JsonValue,
    defaultWarehouseId: string | undefined,
  ): Promise<Array<{ line: number; productId: string; warehouseId: string; quantity: number; unitCost: number | undefined }>> {
    const lines = (Array.isArray(items) ? items : []).flatMap((item, index) => {
      const read = readPurchaseOrderLine(item, 'receipt');
      if (read.problem) {
        if (read.problem.field === 'line') return [];
        throw new BadRequestException(`Purchase order line ${index + 1} is malformed; nothing was received`);
      }
      const { productId, stockQuantity: quantity = 0, unitCost } = read.line;
      const warehouseId = read.line.warehouseId ?? defaultWarehouseId;
      return productId && warehouseId && quantity > 0 ? [{ line: index + 1, productId, warehouseId, quantity, unitCost }] : [];
    });
    if (lines.length === 0) return lines;

    // Read with no soft-delete or tenant filter (raw SQL), by the business's own id (core/inventory/stock-ownership.ts,
    // the check a transfer makes too, W10-Z5-TRANSFER-FIX Z5SEC-2).
    const { products: ownProducts, warehouses: ownWarehouses } = await ownedProductsAndWarehouses(
      this.prisma.client,
      businessId,
      lines.map((l) => l.productId),
      lines.map((l) => l.warehouseId),
    );
    const foreign = lines.find((l) => !ownProducts.has(l.productId) || !ownWarehouses.has(l.warehouseId));
    if (foreign) {
      throw new BadRequestException(
        `Purchase order line ${foreign.line} names a product or a warehouse that is not this business's; nothing was received`,
      );
    }
    return lines;
  }

  async advancePurchaseOrderStatus(
    businessId: string,
    poId: string,
    targetStatus: 'SUBMITTED' | 'ACKNOWLEDGED' | 'SHIPPED' | 'RECEIVED',
  ): Promise<any> {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id: poId, businessId },
    });
    if (!po) throw new BadRequestException('Purchase order not found');

    const validTransitions: Record<string, string[]> = {
      DRAFT: ['SUBMITTED'],
      SUBMITTED: ['ACKNOWLEDGED', 'DRAFT'],
      ACKNOWLEDGED: ['SHIPPED', 'SUBMITTED'],
      SHIPPED: ['RECEIVED'],
      RECEIVED: [],
    };

    if (!validTransitions[po.status]?.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition PO from ${po.status} to ${targetStatus}`,
      );
    }

    const updateData: Record<string, unknown> = { status: targetStatus };

    if (targetStatus === 'SUBMITTED' && !po.submittedAt) {
      updateData.submittedAt = new Date();
    }
    if (targetStatus === 'ACKNOWLEDGED' && !po.acknowledgedAt) {
      updateData.acknowledgedAt = new Date();
    }
    if (targetStatus === 'SHIPPED' && !po.shippedAt) {
      updateData.shippedAt = new Date();
    }
    if (targetStatus === 'RECEIVED' && !po.receivedAt) {
      updateData.receivedAt = new Date();
    }

    let updatedPO: any;

    if (targetStatus === 'RECEIVED') {
      const warehouses = await this.prisma.client.warehouse.findMany({
        where: { businessId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const defaultWarehouseId = warehouses[0]?.id;
      // W10-Z4-ROUTE-FIX review (Z4RV-SEC-1): the stock each line adds, every line's product and warehouse checked to
      // be the business's first (400 otherwise, nothing written).
      const receipts = await this.receivedStockLines(businessId, po.items, defaultWarehouseId);

      // W11-STOCK-ROW-RACE (D-137): a line's stock row created meanwhile by another writer of the business (a transfer or
      // an inventory set into the same new pair) runs the transaction once more, which then adds to that row; a row of
      // another business_id (a planted row) keeps the 409 (retryOnOwnStockRowRace, core/inventory/stock-ownership.ts).
      // The run again repeats the status compare-and-set below (W11-PO-RECEIPT-CLAIM): the first run rolled back, so the
      // purchase order is received once, or the run again answers 409 when another request moved it meanwhile.
      updatedPO = await retryOnOwnStockRowRace(this.prisma.client, businessId, () => this.prisma.client.$transaction(async (rawTx) => {
        const tx = rawTx as unknown as Prisma.TransactionClient;
        // W10-Z4-ROUTE-FIX (SEAMZ4-CR-1): the stock rows the lines add to, locked first, at once, in the global order
        // (core/inventory/stock-lock-order.ts), then the purchase order, its routes and the stock written. Updated line
        // by line in line order and held to commit, a receipt with lines [B, A] and a routing reserving [A, B] each
        // held one row and waited for the other's (40P01), and one was rolled back. Review Z4RV-CR-1: only the
        // (product, warehouse) rows the lines write; every warehouse's row of a line's product made a receipt hold two
        // rows of it, which a transfer writing them in the other order deadlocked with, and the receipt was rolled back.
        await lockStockRowPairsInOrder(rawTx, businessId, receipts);
        // W11-PO-LINES review (SEC-POL-4): the purchase order moves from the status read above, compared and set here.
        // The status was read before this transaction and the update did not compare it, so two receipts of one SHIPPED
        // purchase order at once both committed and added its stock twice (two RECEIPT movements). The second now waits
        // for the first's row lock (behind the stock locks above, as before), reads RECEIVED and updates nothing.
        // W11-PO-RECEIPT-CLAIM: this is the transaction's first purchase order write, and a lost claim is a 409 (the
        // purchase order was changed by another request after it was read), no longer the transition table's 400 (that
        // stays for a RECEIVED made after the first committed: it reads RECEIVED above). Thrown before any route, stock
        // row, movement or posting is written, the transaction rolls back and purchaseOrder.received is not emitted. A
        // line into a pair with no stock row takes no stock lock: this update's row lock serializes the two receipts,
        // and the loser's update matches nothing once the winner commits.
        const moved = await tx.purchaseOrder.updateMany({
          where: { id: poId, businessId, status: po.status },
          data: updateData,
        });
        if (moved.count !== 1) throw new ConflictException(PURCHASE_ORDER_CHANGED);
        const updated = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });

        await tx.fulfillmentRoute.updateMany({
          where: { businessId, purchaseOrderId: poId },
          data: { status: 'PICKING_PACKING' },
        });

        // The purchase order's lines as read above (no writer changes a purchase order's items after it is created).
        for (const { line, productId, warehouseId, quantity: qty, unitCost } of receipts) {
          // Review Z4RV-SEC-1: the business's own row, read under the lock above. This read the row of the line's
          // (productId, warehouseId) with no business filter, so a line naming another business's product and
          // warehouse added to that business's stock and rewrote its weighted-average cost.
          const existing = await tx.inventoryStock.findFirst({
            where: { businessId, productId, warehouseId },
          });

          if (existing) {
            // W11-PO-LINES review (POL-CR-1): the row holds at most STOCK_QUANTITY_MAX (int4); a line taking it above
            // that answered 500 (P2020). Read under the lock, after any earlier line of this receipt into the same row.
            if (existing.quantity + qty > STOCK_QUANTITY_MAX) {
              throw new BadRequestException(
                `Purchase order line ${line} would take its stock row above ${STOCK_QUANTITY_MAX}; nothing was received`,
              );
            }
            // FIN3 — Weighted-average cost recompute on receipt:
            //   newAvg = (oldQty*oldCost + recvQty*recvCost) / (oldQty + recvQty)
            // Falls back to the existing cost if the PO line carries no
            // unitCost (treats freight-only or zero-cost receipts as
            // not-priced rather than blowing away an established cost).
            // W11-PO-LINES: unitCost is the line's Number(unitCost) when finite and above 0, read once
            // (receivedStockLines), else undefined.
            let nextCostPerUnit = existing.costPerUnit ?? null;
            if (unitCost !== undefined) {
              const oldQty = Math.max(existing.quantity, 0);
              const oldCost = existing.costPerUnit ?? 0;
              const denom = oldQty + qty;
              nextCostPerUnit = denom > 0
                ? (oldQty * oldCost + qty * unitCost) / denom
                : unitCost;
              // W11-PO-LINES review (found reproducing SEC-POL-2): a cost so large the average overflows to Infinity was
              // written as NULL (Prisma sends Infinity as null), erasing the row's cost. Refused instead.
              if (!Number.isFinite(nextCostPerUnit)) {
                throw new BadRequestException(
                  `Purchase order line ${line} has a cost too large to average into its stock row; nothing was received`,
                );
              }
            }
            await tx.inventoryStock.update({
              where: { id: existing.id },
              data: {
                quantity: existing.quantity + qty,
                ...(nextCostPerUnit != null ? { costPerUnit: nextCostPerUnit } : {}),
              },
            });
          } else {
            // W10-Z5-TRANSFER-FIX (Z5SEC-2): a row of another business_id holding this (product, warehouse), planted by
            // the old cross-business receipt, is a 409 naming no ids (the purchase order stays as it was), not an
            // unhandled P2002 (a 500). The row is left for an operator to repair. W11-STOCK-ROW-RACE: the pair is carried
            // on the 409 so the run again above can tell such a row from the business's own, created meanwhile.
            await createStockRowOrConflict({ productId, warehouseId }, () =>
              tx.inventoryStock.create({
                data: {
                  businessId,
                  productId,
                  warehouseId,
                  quantity: qty,
                  reserved: 0,
                  currency: updated.currency ?? 'TTD',
                  // W11-PO-LINES: the same cost as the update path (item.unitCost passed raw: a text cost was a 500).
                  ...(unitCost !== undefined ? { costPerUnit: unitCost } : {}),
                },
              }),
            );
          }

          await tx.stockMovement.create({
            data: {
              businessId,
              warehouseId,
              productId,
              type: 'RECEIPT',
              quantityChange: qty,
              reasonCode: 'PO_RECEIPT',
              note: `Received via PO ${updated.poNumber}`,
              referenceId: poId,
            },
          });
        }

        // FIN3 — post the inventory leg in the SAME transaction as the
        // PO update + stock writes. A failed posting must roll back the
        // PO state change (no half-received PO without a ledger entry).
        if (Number(updated.total) > 0) {
          await this.expensePosting.onPurchaseOrderReceived(
            {
              id: updated.id,
              businessId: updated.businessId,
              total: Number(updated.total),
              currency: updated.currency,
              receivedAt: updated.receivedAt ?? new Date(),
              paymentStatus: (updated as { paymentStatus?: string }).paymentStatus ?? 'UNPAID',
              paymentMethod:
                (updated as { paymentStatus?: string }).paymentStatus === 'PAID'
                  ? 'bank_transfer'
                  : null,
              supplierName: updated.supplierName,
              poNumber: updated.poNumber,
            },
            tx,
          );
        }

        return updated;
      }));
    } else {
      // W11-PO-RECEIPT-CLAIM: compared and set on the status read above, as the receipt is. Written unconditionally, two
      // changes from SUBMITTED at once (to ACKNOWLEDGED and to DRAFT) both answered and the last write won. One update
      // (the row and its status checked together, Prisma P2025 when it no longer matches): the loser answers 409.
      updatedPO = await this.prisma.client.purchaseOrder
        .update({
          where: { id: poId, businessId, status: po.status },
          data: updateData,
        })
        .catch((err: unknown) => {
          if ((err as { code?: unknown } | null)?.code === 'P2025') throw new ConflictException(PURCHASE_ORDER_CHANGED);
          throw err;
        });
    }

    if (targetStatus === 'RECEIVED') {
      const poItems = (updatedPO.items as any[]) ?? [];
      this.events.emit('purchaseOrder.received', {
        businessId,
        purchaseOrderId: poId,
        poNumber: updatedPO.poNumber,
        supplierName: updatedPO.supplierName,
        items: poItems,
        total: updatedPO.total,
        currency: updatedPO.currency,
      } as PurchaseOrderReceivedPayload);
    }

    return updatedPO;
  }

  async activatePreorderRoute(businessId: string, routeId: string): Promise<any> {
    const route = await this.prisma.client.fulfillmentRoute.findFirst({
      where: { id: routeId, businessId, strategy: 'PREORDER' },
      include: { order: { include: { items: true } } },
    });

    if (!route) throw new BadRequestException('Preorder route not found');

    if (route.status !== 'PREORDER_ACCEPTED') {
      throw new BadRequestException(
        `Preorder route must be in PREORDER_ACCEPTED status to activate. Current: ${route.status}`,
      );
    }

    const updatedRoute = await this.prisma.client.fulfillmentRoute.update({
      where: { id: routeId },
      data: {
        status: 'PICKING_PACKING',
        resolvedAt: new Date(),
        metadata: {
          ...((route.metadata as RouteMetadata) ?? {}),
          activatedAt: new Date().toISOString(),
          note: 'Preorder stock arrived — advanced to pick/pack',
        },
      },
    });

    const allRoutes = await this.prisma.client.fulfillmentRoute.findMany({
      where: { orderId: route.orderId, businessId },
    });

    const allReady = allRoutes.every((r) =>
      ['PICKING_PACKING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(r.status),
    );

    if (allReady) {
      const now = new Date().toISOString();
      // W10-SOP-FIX (SOP-V4): status and step in one statement, not the metadata read with the route written back.
      await appendOrderTimeline(
        this.prisma.client,
        businessId,
        route.orderId,
        [{ status: 'picking_packing', timestamp: now, note: 'All preorder items ready — advanced to pick/pack' }],
        { status: 'picking_packing' },
      );
    }

    return updatedRoute;
  }

  async createPickPackTasks(
    businessId: string,
    orderId: string,
    items: OrderItemShape[],
  ): Promise<void> {
    const now = new Date().toISOString();

    const routes = await this.prisma.client.fulfillmentRoute.findMany({
      where: { businessId, orderId },
    });

    if (routes.length === 0) {
      for (const item of items) {
        await this.prisma.client.fulfillmentRoute.create({
          data: {
            businessId,
            orderId,
            orderItemId: item.id,
            strategy: 'MANUAL',
            status: 'PICKING_PACKING',
            sourceType: 'WAREHOUSE',
            notes: `Pick/pack task created for ${item.name} x${item.quantity}`,
            metadata: {
              task: {
                type: 'PICK_AND_PACK',
                productId: item.productId,
                productName: item.name,
                sku: item.sku,
                quantity: item.quantity,
                createdAt: now,
                status: 'PENDING',
              },
            },
          },
        });
      }
    } else {
      for (const route of routes) {
        if (['RESERVED', 'PO_RAISED', 'PREORDER_ACCEPTED', 'AWAITING_MANUAL'].includes(route.status)) {
          const item = items.find((i) => i.id === route.orderItemId);
          await this.prisma.client.fulfillmentRoute.update({
            where: { id: route.id },
            data: {
              status: 'PICKING_PACKING',
              metadata: {
                ...((route.metadata as RouteMetadata) ?? {}),
                task: {
                  type: 'PICK_AND_PACK',
                  productName: item?.name,
                  sku: item?.sku,
                  quantity: item?.quantity,
                  createdAt: now,
                  status: 'PENDING',
                },
              },
            },
          });
        }
      }
    }
  }

  async getInventoryAlerts(businessId: string): Promise<InventoryAlert[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [stocks, recentOrderItems] = await Promise.all([
      this.prisma.client.inventoryStock.findMany({
        where: { businessId },
        include: { product: true, warehouse: true },
      }),
      this.prisma.client.marketplaceOrderItem.findMany({
        where: {
          order: { businessId, createdAt: { gte: thirtyDaysAgo } },
        },
        select: { productId: true, quantity: true },
      }),
    ]);

    const salesByProduct: Record<string, number> = {};
    for (const item of recentOrderItems) {
      if (!item.productId) continue;
      salesByProduct[item.productId] = (salesByProduct[item.productId] || 0) + (item.quantity || 0);
    }

    const alerts: InventoryAlert[] = [];

    for (const stock of stocks) {
      if (!stock.reorderAt) continue;
      const available = stock.quantity - stock.reserved;

      const salesVelocity30d = salesByProduct[stock.productId] || 0;
      const avgDailySales = salesVelocity30d / 30;
      const daysOfStockLeft = avgDailySales > 0 ? Math.round(available / avgDailySales) : null;
      const leadTimeDays = 14;
      const safetyStockDays = 7;
      const suggestedReorderQty = avgDailySales > 0
        ? Math.ceil(avgDailySales * (leadTimeDays + safetyStockDays))
        : Math.max(stock.reorderAt * 3, 10);

      const velocityFields = {
        salesVelocity30d,
        avgDailySales: Math.round(avgDailySales * 10) / 10,
        daysOfStockLeft: daysOfStockLeft ?? undefined,
        suggestedReorderQty,
      };

      if (available <= 0) {
        alerts.push({
          type: 'OUT_OF_STOCK',
          severity: 'critical',
          productId: stock.productId,
          productName: stock.product.name,
          productSku: stock.product.sku,
          warehouseId: stock.warehouseId,
          warehouseName: stock.warehouse.name,
          quantity: stock.quantity,
          reserved: stock.reserved,
          available: 0,
          reorderAt: stock.reorderAt,
          ...velocityFields,
        });
      } else if (available <= stock.reorderAt) {
        alerts.push({
          type: 'LOW_STOCK',
          severity: 'warning',
          productId: stock.productId,
          productName: stock.product.name,
          productSku: stock.product.sku,
          warehouseId: stock.warehouseId,
          warehouseName: stock.warehouse.name,
          quantity: stock.quantity,
          reserved: stock.reserved,
          available,
          reorderAt: stock.reorderAt,
          ...velocityFields,
        });
      }
    }

    return alerts.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return (b.avgDailySales || 0) - (a.avgDailySales || 0);
    });
  }
}
