import { Injectable, Logger, BadRequestException, Inject, NotFoundException } from '@nestjs/common';
import { resolveInventoryMode } from '../../core/inventory/inventory-mode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { InventoryLowPayload, InventoryOutPayload, PurchaseOrderReceivedPayload } from '../../core/event-bus/events.types';
import { ExpensePostingService } from '../finance/expense-posting.service';
import { appendOrderTimeline, appendOrderTimelineAdvancingStatus } from './order-metadata';
import type { BusinessMetaTx } from '../../core/prisma/business-meta';
import { isLostTransactionConflict, lockStockRowPairsInOrder, lockStockRowsInOrder } from '../../core/inventory/stock-lock-order';

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

/** A purchase order line as stored in its items JSON (the fields a receipt reads). */
interface PurchaseOrderLineJson {
  productId?: string | null;
  warehouseId?: string | null;
  quantity?: number;
  receivedQuantity?: number;
  unitCost?: number | null;
}

export interface OrderStatusTimelineEntry {
  status: string;
  timestamp: string;
  note?: string;
}

export interface OrderMetadata {
  statusTimeline?: OrderStatusTimelineEntry[];
  publicToken?: string;
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

    // W10-Z4-ROUTE-FIX (SEAMZ4-CR-1): every stock row any line can reserve from (each line's product, in every
    // warehouse of the business) is locked here, all at once, in the global order, before the first reservation; a
    // line reserves only from these rows. Locked line by line in line order and held to commit, two orders with the
    // same products in opposite order each held one row and waited for the other's (40P01).
    const lockedStockIds = await lockStockRowsInOrder(
      tx,
      businessId,
      (order.items as OrderItemShape[]).map((item) => item.productId),
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

      const rawStrategy = listing?.fulfillmentStrategy ?? 'LOCAL_STOCK';
      const strategy = (rawStrategy.toUpperCase() as FulfillmentStrategy);

      let route: FulfillmentRouteShape;

      switch (strategy) {
        case 'LOCAL_STOCK':
          route = await this.routeLocalStock(tx, afterCommit, businessId, orderId, item, listing, lockedStockIds);
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
          );
          break;
        case 'MANUAL':
          route = await this.routeManual(tx, afterCommit, businessId, orderId, item, listing);
          break;
        case 'SERVICE':
          route = await this.routeService(tx, businessId, orderId, item, listing);
          break;
        default:
          route = await this.routeManual(tx, afterCommit, businessId, orderId, item, listing);
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
  ): Promise<FulfillmentRouteShape> {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { inventoryMode: true, _count: { select: { inventoryStocks: true } } },
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

      afterCommit.push(async () => {
        this.notifyInsufficientStock(businessId, orderId, item, available).catch((err) =>
          this.logger.error(`Failed to send insufficient-stock notification: ${(err as Error).message}`),
        );
      });

      return route as unknown as FulfillmentRouteShape;
    }
  }

  private async notifyInsufficientStock(
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    available: number,
  ): Promise<void> {
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
  ): Promise<FulfillmentRouteShape> {
    const stock = await tx.inventoryStock.findFirst({
      where: { id: { in: [...lockedStockIds] }, productId: item.productId, businessId },
      orderBy: { quantity: 'desc' },
    });

    const available = stock ? stock.quantity - stock.reserved : 0;

    if (available >= item.quantity) {
      this.logger.log(
        `Hybrid: local stock satisfied for product ${item.productId} (${available}/${item.quantity})`,
      );
      return this.routeLocalStock(tx, afterCommit, businessId, orderId, item, listing, lockedStockIds);
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

    afterCommit.push(async () => {
      this.notifyManualFulfillmentRequired(businessId, orderId, item).catch((err) =>
        this.logger.error(`Failed to send manual-fulfillment notification: ${(err as Error).message}`),
      );
    });

    return route as unknown as FulfillmentRouteShape;
  }

  private async notifyManualFulfillmentRequired(
    businessId: string,
    orderId: string,
    item: OrderItemShape,
  ): Promise<void> {
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

  async decrementInventoryOnShip(businessId: string, routeId: string): Promise<void> {
    const route = await this.prisma.client.fulfillmentRoute.findFirst({
      where: {
        id: routeId,
        businessId,
        strategy: 'LOCAL_STOCK',
        status: { in: ['RESERVED', 'PICKING_PACKING'] },
      },
      include: { order: { include: { items: true } } },
    });

    if (!route) return;

    const routeMeta = (route.metadata ?? {}) as RouteMetadata;
    if (routeMeta.noReservationRequired || routeMeta.inventoryMode === 'untracked' || routeMeta.inventoryMode === 'virtual') {
      this.logger.log(`Skipping inventory decrement for ${routeMeta.inventoryMode ?? 'untracked'} route ${routeId}`);
      return;
    }

    if (!route.warehouseId) return;

    const orderItem = (route.order.items as OrderItemShape[]).find((i) => i.id === route.orderItemId);
    if (!orderItem) return;

    const stock = await this.prisma.client.inventoryStock.findFirst({
      where: { productId: orderItem.productId, warehouseId: route.warehouseId },
    });

    if (stock) {
      const newQuantity = Math.max(0, stock.quantity - orderItem.quantity);
      const newReserved = Math.max(0, stock.reserved - orderItem.quantity);

      await this.prisma.client.inventoryStock.update({
        where: { id: stock.id },
        data: { quantity: newQuantity, reserved: newReserved },
      });

      await this.checkAndAlertReorderThreshold(businessId, stock.id);
    }
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
   */
  async cancelOrderFulfilment(tx: RoutingTx, businessId: string, orderId: string): Promise<void> {
    await claimOrderRouting(tx, businessId, orderId);
    const order = await tx.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { status: true, items: { select: { id: true, productId: true, quantity: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!canTransitionOrder(order.status, 'cancelled')) {
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
  }

  async checkAndAlertReorderThreshold(businessId: string, stockId: string): Promise<void> {
    const stock = await this.prisma.client.inventoryStock.findUnique({
      where: { id: stockId },
      include: { product: true, warehouse: true },
    });

    if (!stock || !stock.reorderAt) return;

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
   */
  private async receivedStockLines(
    businessId: string,
    items: Prisma.JsonValue,
    defaultWarehouseId: string | undefined,
  ): Promise<Array<{ line: number; productId: string; warehouseId: string; quantity: number; item: PurchaseOrderLineJson }>> {
    const lines = (Array.isArray(items) ? (items as Array<PurchaseOrderLineJson | null>) : []).flatMap((item, index) => {
      const productId = item?.productId;
      const quantity = item?.receivedQuantity ?? item?.quantity ?? 0;
      const warehouseId = item?.warehouseId || defaultWarehouseId;
      return item && productId && warehouseId && quantity > 0
        ? [{ line: index + 1, productId, warehouseId, quantity, item }]
        : [];
    });
    if (lines.length === 0) return lines;

    // Read with no soft-delete or tenant filter (raw SQL), by the business's own id.
    const productIds = [...new Set(lines.map((l) => String(l.productId)))];
    const warehouseIds = [...new Set(lines.map((l) => String(l.warehouseId)))];
    const [products, warehouses] = await Promise.all([
      this.prisma.client.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM products WHERE business_id = ${businessId} AND id IN (${Prisma.join(productIds)})`,
      this.prisma.client.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM warehouses WHERE business_id = ${businessId} AND id IN (${Prisma.join(warehouseIds)})`,
    ]);
    const ownProducts = new Set(products.map((row) => row.id));
    const ownWarehouses = new Set(warehouses.map((row) => row.id));
    const foreign = lines.find(
      (l) => !ownProducts.has(String(l.productId)) || !ownWarehouses.has(String(l.warehouseId)),
    );
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

      updatedPO = await this.prisma.client.$transaction(async (rawTx) => {
        const tx = rawTx as unknown as Prisma.TransactionClient;
        // W10-Z4-ROUTE-FIX (SEAMZ4-CR-1): the stock rows the lines add to, locked first, at once, in the global order
        // (core/inventory/stock-lock-order.ts), then the purchase order, its routes and the stock written. Updated line
        // by line in line order and held to commit, a receipt with lines [B, A] and a routing reserving [A, B] each
        // held one row and waited for the other's (40P01), and one was rolled back. Review Z4RV-CR-1: only the
        // (product, warehouse) rows the lines write; every warehouse's row of a line's product made a receipt hold two
        // rows of it, which a transfer writing them in the other order deadlocked with, and the receipt was rolled back.
        await lockStockRowPairsInOrder(rawTx, businessId, receipts);
        const updated = await tx.purchaseOrder.update({
          where: { id: poId },
          data: updateData,
        });

        await tx.fulfillmentRoute.updateMany({
          where: { businessId, purchaseOrderId: poId },
          data: { status: 'PICKING_PACKING' },
        });

        // The purchase order's lines as read above (no writer changes a purchase order's items after it is created).
        for (const { productId, warehouseId, quantity: qty, item } of receipts) {
          // Review Z4RV-SEC-1: the business's own row, read under the lock above. This read the row of the line's
          // (productId, warehouseId) with no business filter, so a line naming another business's product and
          // warehouse added to that business's stock and rewrote its weighted-average cost.
          const existing = await tx.inventoryStock.findFirst({
            where: { businessId, productId, warehouseId },
          });

          if (existing) {
            // FIN3 — Weighted-average cost recompute on receipt:
            //   newAvg = (oldQty*oldCost + recvQty*recvCost) / (oldQty + recvQty)
            // Falls back to the existing cost if the PO line carries no
            // unitCost (treats freight-only or zero-cost receipts as
            // not-priced rather than blowing away an established cost).
            let nextCostPerUnit = existing.costPerUnit ?? null;
            if (item.unitCost != null && item.unitCost > 0) {
              const oldQty = Math.max(existing.quantity, 0);
              const oldCost = existing.costPerUnit ?? 0;
              const denom = oldQty + qty;
              nextCostPerUnit = denom > 0
                ? (oldQty * oldCost + qty * Number(item.unitCost)) / denom
                : Number(item.unitCost);
            }
            await tx.inventoryStock.update({
              where: { id: existing.id },
              data: {
                quantity: existing.quantity + qty,
                ...(nextCostPerUnit != null ? { costPerUnit: nextCostPerUnit } : {}),
              },
            });
          } else {
            await tx.inventoryStock.create({
              data: {
                businessId,
                productId,
                warehouseId,
                quantity: qty,
                reserved: 0,
                currency: updated.currency ?? 'TTD',
                ...(item.unitCost ? { costPerUnit: item.unitCost } : {}),
              },
            });
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
      });
    } else {
      updatedPO = await this.prisma.client.purchaseOrder.update({
        where: { id: poId },
        data: updateData,
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
