import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';

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
    private readonly prisma: PrismaService,
    private readonly emailService: TransactionalEmailService,
  ) {}

  private generatePONumber(): string {
    const prefix = 'PO';
    const timestamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${rand}`;
  }

  async routeOrder(businessId: string, orderId: string): Promise<any[]> {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: {
        items: { include: { product: true } },
        fulfillmentRoutes: true,
      },
    });

    if (!order) throw new BadRequestException('Order not found');

    const validRoutingStatuses = ['placed', 'awaiting_fulfillment', 'paid', 'routed', 'awaiting_payment'];
    const normalizedStatus = normalizeOrderStatus(order.status);
    if (!validRoutingStatuses.includes(normalizedStatus)) {
      throw new BadRequestException(
        `Cannot route order in status "${order.status}". ` +
          `Order must be in placed, paid, or awaiting_fulfillment status first.`,
      );
    }

    const existingRoutes = order.fulfillmentRoutes as FulfillmentRouteShape[] | undefined;
    if (existingRoutes && existingRoutes.length > 0) {
      const isPaid = normalizedStatus === 'paid' || normalizedStatus === 'awaiting_fulfillment';
      if (isPaid) {
        const hasDropship = existingRoutes.some((r) => r.strategy === 'DROPSHIP' || r.strategy === 'HYBRID');
        const finalStatus = hasDropship ? 'supplier_ordered' : 'routed';
        const now = new Date().toISOString();
        const existingMeta = (order.metadata as OrderMetadata) ?? {};
        const existingTimeline: OrderStatusTimelineEntry[] = existingMeta.statusTimeline ?? [];
        await this.prisma.client.marketplaceOrder.update({
          where: { id: orderId },
          data: {
            status: finalStatus,
            metadata: {
              ...existingMeta,
              statusTimeline: [
                ...existingTimeline,
                { status: finalStatus, timestamp: now, note: 'Order status advanced after payment — routes already created' },
              ],
            },
          },
        });
      }
      return existingRoutes;
    }

    const routes: FulfillmentRouteShape[] = [];

    for (const item of order.items as OrderItemShape[]) {
      const listing = await (
        item.listingId
          ? this.prisma.client.marketplaceListing.findFirst({
              where: { id: item.listingId, businessId, isActive: true },
            })
          : this.prisma.client.marketplaceListing.findFirst({
              where: { productId: item.productId, businessId, isActive: true },
            })
      );

      const rawStrategy = listing?.fulfillmentStrategy ?? 'LOCAL_STOCK';
      const strategy = (rawStrategy.toUpperCase() as FulfillmentStrategy);

      let route: FulfillmentRouteShape;

      switch (strategy) {
        case 'LOCAL_STOCK':
          route = await this.routeLocalStock(businessId, orderId, item, listing);
          break;
        case 'DROPSHIP':
          route = await this.routeDropship(businessId, orderId, item, listing, order as unknown as MarketplaceOrderShape);
          break;
        case 'PREORDER':
          route = await this.routePreorder(businessId, orderId, item, listing, order as unknown as MarketplaceOrderShape);
          break;
        case 'HYBRID':
          route = await this.routeHybrid(businessId, orderId, item, listing, order as unknown as MarketplaceOrderShape);
          break;
        case 'MANUAL':
          route = await this.routeManual(businessId, orderId, item, listing);
          break;
        case 'SERVICE':
          route = await this.routeService(businessId, orderId, item, listing);
          break;
        default:
          route = await this.routeManual(businessId, orderId, item, listing);
      }

      routes.push(route);
    }

    const hasDropship = routes.some(
      (r) => r.strategy === 'DROPSHIP' || r.strategy === 'HYBRID',
    );
    const now = new Date().toISOString();
    const existingMeta = (order.metadata as OrderMetadata) ?? {};
    const existingTimeline: OrderStatusTimelineEntry[] = existingMeta.statusTimeline ?? [];

    const isPaid = normalizedStatus === 'paid' || normalizedStatus === 'awaiting_fulfillment';
    const finalStatus = isPaid ? (hasDropship ? 'supplier_ordered' : 'routed') : normalizedStatus;

    const timelineEntries: OrderStatusTimelineEntry[] = [
      { status: 'routes_created', timestamp: now, note: 'Routes created by fulfillment engine; inventory reserved' },
    ];
    if (isPaid && hasDropship) {
      timelineEntries.push({ status: 'supplier_ordered', timestamp: now, note: 'Purchase orders raised for dropship items' });
    } else if (isPaid) {
      timelineEntries.push({ status: 'routed', timestamp: now, note: 'Order routed — awaiting processing' });
    }

    await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        status: finalStatus,
        metadata: {
          ...existingMeta,
          statusTimeline: [...existingTimeline, ...timelineEntries],
        },
      },
    });

    return routes;
  }

  private async routeLocalStock(
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
  ): Promise<FulfillmentRouteShape> {
    const product = await this.prisma.client.product.findUnique({
      where: { id: item.productId },
      select: { inventoryMode: true },
    });

    const inventoryMode = (product?.inventoryMode ?? 'tracked').toLowerCase();

    if (inventoryMode === 'untracked' || inventoryMode === 'virtual') {
      const route = await this.prisma.client.fulfillmentRoute.create({
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

    const stock = await this.prisma.client.inventoryStock.findFirst({
      where: { productId: item.productId, businessId },
      orderBy: { quantity: 'desc' },
    });

    const available = stock ? stock.quantity - stock.reserved : 0;

    if (available >= item.quantity) {
      await this.prisma.client.inventoryStock.update({
        where: { id: stock!.id },
        data: { reserved: stock!.reserved + item.quantity },
      });

      const taskNote = `Pick/pack task pending for item ${item.id} x${item.quantity}`;
      const route = await this.prisma.client.fulfillmentRoute.create({
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

      await this.checkAndAlertReorderThreshold(businessId, stock!.id);

      return route as unknown as FulfillmentRouteShape;
    } else {
      const route = await this.prisma.client.fulfillmentRoute.create({
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

      this.notifyInsufficientStock(businessId, orderId, item, available).catch((err) =>
        this.logger.error(`Failed to send insufficient-stock notification: ${(err as Error).message}`),
      );

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

  private async resolveSupplierSourceLink(productId: string): Promise<{
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
    return this.prisma.client.productSourceLink.findFirst({
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
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    order: MarketplaceOrderShape,
  ): Promise<FulfillmentRouteShape> {
    const sourceLink = await this.resolveSupplierSourceLink(item.productId);

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

    const po = await this.prisma.client.purchaseOrder.create({
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

    const route = await this.prisma.client.fulfillmentRoute.create({
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

    const preOrder = await this.prisma.client.preOrder.create({
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

    const route = await this.prisma.client.fulfillmentRoute.create({
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
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
    order: MarketplaceOrderShape,
  ): Promise<FulfillmentRouteShape> {
    const stock = await this.prisma.client.inventoryStock.findFirst({
      where: { productId: item.productId, businessId },
      orderBy: { quantity: 'desc' },
    });

    const available = stock ? stock.quantity - stock.reserved : 0;

    if (available >= item.quantity) {
      this.logger.log(
        `Hybrid: local stock satisfied for product ${item.productId} (${available}/${item.quantity})`,
      );
      return this.routeLocalStock(businessId, orderId, item, listing);
    }

    const sourceLink = await this.resolveSupplierSourceLink(item.productId);
    const hasSupplier = !!(sourceLink || listing?.supplierName);

    if (hasSupplier) {
      this.logger.log(
        `Hybrid: fallback to dropship for product ${item.productId}. ` +
          `Local stock insufficient (${available}/${item.quantity}). ` +
          `Using ${sourceLink ? `ProductSourceLink priority=${sourceLink.priority}` : 'listing supplier'}`,
      );
      return this.routeDropship(businessId, orderId, item, listing, order);
    }

    this.logger.log(
      `Hybrid: fallback to preorder for product ${item.productId}. No local stock or supplier available.`,
    );
    return this.routePreorder(businessId, orderId, item, listing, order);
  }

  private async routeManual(
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
  ): Promise<FulfillmentRouteShape> {
    const route = await this.prisma.client.fulfillmentRoute.create({
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

    this.notifyManualFulfillmentRequired(businessId, orderId, item).catch((err) =>
      this.logger.error(`Failed to send manual-fulfillment notification: ${(err as Error).message}`),
    );

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
    businessId: string,
    orderId: string,
    item: OrderItemShape,
    listing: ListingShape | null,
  ): Promise<FulfillmentRouteShape> {
    const route = await this.prisma.client.fulfillmentRoute.create({
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

  async releaseInventoryReservation(businessId: string, orderId: string): Promise<void> {
    const routes = await this.prisma.client.fulfillmentRoute.findMany({
      where: {
        businessId,
        orderId,
        strategy: 'LOCAL_STOCK',
        status: { in: ['RESERVED', 'PICKING_PACKING'] },
      },
      include: { order: { include: { items: true } } },
    });

    for (const route of routes) {
      if (!route.warehouseId) continue;

      const routeMeta = (route.metadata ?? {}) as RouteMetadata;
      if (routeMeta.noReservationRequired || routeMeta.inventoryMode === 'untracked' || routeMeta.inventoryMode === 'virtual') {
        await this.prisma.client.fulfillmentRoute.update({ where: { id: route.id }, data: { status: 'CANCELLED' } });
        continue;
      }

      const orderItem = (route.order.items as OrderItemShape[]).find((i) => i.id === route.orderItemId);
      if (!orderItem) continue;

      const stock = await this.prisma.client.inventoryStock.findFirst({
        where: { productId: orderItem.productId, warehouseId: route.warehouseId },
      });

      if (stock) {
        await this.prisma.client.inventoryStock.update({
          where: { id: stock.id },
          data: { reserved: Math.max(0, stock.reserved - orderItem.quantity) },
        });
      }

      await this.prisma.client.fulfillmentRoute.update({
        where: { id: route.id },
        data: { status: 'CANCELLED' },
      });
    }
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
    } else if (available <= stock.reorderAt) {
      this.logger.warn(
        `[STOCK ALERT] LOW STOCK: Product "${stock.product.name}" ` +
          `(${stock.product.sku ?? stock.productId}) in warehouse "${stock.warehouse.name}". ` +
          `Available: ${available}, Reorder threshold: ${stock.reorderAt}. Business: ${businessId}`,
      );
    }
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

    const updatedPO = await this.prisma.client.purchaseOrder.update({
      where: { id: poId },
      data: updateData,
    });

    if (targetStatus === 'RECEIVED') {
      await this.prisma.client.fulfillmentRoute.updateMany({
        where: { businessId, purchaseOrderId: poId },
        data: { status: 'PICKING_PACKING' },
      });
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
      const orderMeta = (route.order.metadata as OrderMetadata) ?? {};
      const existingTimeline: OrderStatusTimelineEntry[] = orderMeta.statusTimeline ?? [];
      await this.prisma.client.marketplaceOrder.update({
        where: { id: route.orderId },
        data: {
          status: 'picking_packing',
          metadata: {
            ...orderMeta,
            statusTimeline: [
              ...existingTimeline,
              { status: 'picking_packing', timestamp: now, note: 'All preorder items ready — advanced to pick/pack' },
            ],
          },
        },
      });
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
    const stocks = await this.prisma.client.inventoryStock.findMany({
      where: { businessId },
      include: { product: true, warehouse: true },
    });

    const alerts: InventoryAlert[] = [];

    for (const stock of stocks) {
      if (!stock.reorderAt) continue;
      const available = stock.quantity - stock.reserved;

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
        });
      }
    }

    return alerts;
  }
}
