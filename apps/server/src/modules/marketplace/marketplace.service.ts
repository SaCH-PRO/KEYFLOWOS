import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService, NotificationType } from '../notifications/transactional-email.service';
import { FulfillmentRoutingService, canTransitionOrder } from './fulfillment-routing.service';
import {
  PreorderDelayedPayload,
  StoreOrderCreatedPayload,
  StoreOrderPaidPayload,
  StoreOrderShippedPayload,
  StoreOrderDeliveredPayload,
  StoreOrderCancelledPayload,
  StoreOrderRefundedPayload,
} from '../../core/event-bus/events.types';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TransactionalEmailService))
    private readonly emailService: TransactionalEmailService,
    @Inject(FulfillmentRoutingService) private readonly fulfillmentRoutingService: FulfillmentRoutingService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  private generateOrderNumber(): string {
    const prefix = 'MKT';
    const timestamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${rand}`;
  }

  private generatePONumber(): string {
    const prefix = 'PO';
    const timestamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${rand}`;
  }

  async createListing(businessId: string, data: any) {
    return this.prisma.client.marketplaceListing.create({
      data: {
        businessId,
        productId: data.productId,
        marketReach: data.marketReach || 'LOCAL',
        countries: data.countries || [],
        regions: data.regions || [],
        fulfillmentStrategy: data.fulfillmentStrategy || 'LOCAL_STOCK',
        supplierName: data.supplierName,
        supplierEmail: data.supplierEmail,
        supplierPhone: data.supplierPhone,
        supplierCountry: data.supplierCountry,
        depositPercent: data.depositPercent,
        pricingOverrides: data.pricingOverrides,
        shippingEnabled: data.shippingEnabled ?? true,
        digitalDelivery: data.digitalDelivery ?? false,
        hsCode: data.hsCode,
        originCountry: data.originCountry,
        weight: data.weight,
        weightUnit: data.weightUnit || 'kg',
        dimensions: data.dimensions,
        minOrderQty: data.minOrderQty || 1,
        maxOrderQty: data.maxOrderQty,
        leadTimeDays: data.leadTimeDays,
      },
      include: { product: true },
    });
  }

  async getListings(businessId: string, filters?: { marketReach?: string; isActive?: boolean }, page = 1, pageSize = 50) {
    const where: any = { businessId };
    if (filters?.marketReach) where.marketReach = filters.marketReach;
    if (filters?.isActive !== undefined) where.isActive = filters.isActive;

    pageSize = Math.min(Math.max(pageSize, 1), 100);
    page = Math.max(page, 1);

    const [data, total] = await Promise.all([
      this.prisma.client.marketplaceListing.findMany({
        where,
        include: { product: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.marketplaceListing.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async updateListing(businessId: string, listingId: string, data: any) {
    const listing = await this.prisma.client.marketplaceListing.findFirst({
      where: { id: listingId, businessId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    return this.prisma.client.marketplaceListing.update({
      where: { id: listingId },
      data: {
        marketReach: data.marketReach,
        countries: data.countries,
        regions: data.regions,
        fulfillmentStrategy: data.fulfillmentStrategy,
        supplierName: data.supplierName,
        supplierEmail: data.supplierEmail,
        supplierPhone: data.supplierPhone,
        supplierCountry: data.supplierCountry,
        depositPercent: data.depositPercent,
        pricingOverrides: data.pricingOverrides,
        shippingEnabled: data.shippingEnabled,
        digitalDelivery: data.digitalDelivery,
        hsCode: data.hsCode,
        originCountry: data.originCountry,
        weight: data.weight,
        weightUnit: data.weightUnit,
        dimensions: data.dimensions,
        minOrderQty: data.minOrderQty,
        maxOrderQty: data.maxOrderQty,
        leadTimeDays: data.leadTimeDays,
        isActive: data.isActive,
      },
      include: { product: true },
    });
  }

  async deleteListing(businessId: string, listingId: string) {
    const listing = await this.prisma.client.marketplaceListing.findFirst({
      where: { id: listingId, businessId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    await this.prisma.client.marketplaceListing.delete({ where: { id: listingId } });
    return { success: true };
  }

  async createShippingZone(businessId: string, data: any) {
    return this.prisma.client.shippingZone.create({
      data: {
        businessId,
        name: data.name,
        countries: data.countries || [],
        regions: data.regions || [],
        baseFee: data.baseFee || 0,
        perKgRate: data.perKgRate || 0,
        freeAbove: data.freeAbove,
        currency: data.currency || 'TTD',
        estimatedDays: data.estimatedDays,
        carrier: data.carrier,
      },
    });
  }

  async getShippingZones(businessId: string) {
    return this.prisma.client.shippingZone.findMany({
      where: { businessId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateShippingZone(businessId: string, zoneId: string, data: any) {
    const zone = await this.prisma.client.shippingZone.findFirst({
      where: { id: zoneId, businessId },
    });
    if (!zone) throw new NotFoundException('Shipping zone not found');

    return this.prisma.client.shippingZone.update({
      where: { id: zoneId },
      data: {
        name: data.name,
        countries: data.countries,
        regions: data.regions,
        baseFee: data.baseFee,
        perKgRate: data.perKgRate,
        freeAbove: data.freeAbove,
        currency: data.currency,
        estimatedDays: data.estimatedDays,
        carrier: data.carrier,
        isActive: data.isActive,
      },
    });
  }

  async deleteShippingZone(businessId: string, zoneId: string) {
    const zone = await this.prisma.client.shippingZone.findFirst({
      where: { id: zoneId, businessId },
    });
    if (!zone) throw new NotFoundException('Shipping zone not found');
    await this.prisma.client.shippingZone.delete({ where: { id: zoneId } });
    return { success: true };
  }

  async createWarehouse(businessId: string, data: any) {
    return this.prisma.client.warehouse.create({
      data: {
        businessId,
        name: data.name,
        address: data.address,
        city: data.city,
        country: data.country,
        type: data.type || 'STORAGE',
        capacity: data.capacity,
      },
    });
  }

  async getWarehouses(businessId: string) {
    return this.prisma.client.warehouse.findMany({
      where: { businessId, isActive: true },
      include: { inventoryStocks: { include: { product: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async updateWarehouse(businessId: string, warehouseId: string, data: any) {
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id: warehouseId, businessId },
    });
    if (!wh) throw new NotFoundException('Warehouse not found');

    return this.prisma.client.warehouse.update({
      where: { id: warehouseId },
      data: {
        name: data.name,
        address: data.address,
        city: data.city,
        country: data.country,
        type: data.type,
        capacity: data.capacity,
        isActive: data.isActive,
      },
    });
  }

  async deleteWarehouse(businessId: string, warehouseId: string) {
    const wh = await this.prisma.client.warehouse.findFirst({
      where: { id: warehouseId, businessId },
    });
    if (!wh) throw new NotFoundException('Warehouse not found');
    await this.prisma.client.warehouse.update({
      where: { id: warehouseId },
      data: { isActive: false },
    });
    return { success: true };
  }

  async upsertInventory(businessId: string, data: any) {
    const existing = await this.prisma.client.inventoryStock.findUnique({
      where: {
        productId_warehouseId: {
          productId: data.productId,
          warehouseId: data.warehouseId,
        },
      },
    });

    if (existing) {
      return this.prisma.client.inventoryStock.update({
        where: { id: existing.id },
        data: {
          quantity: data.quantity ?? existing.quantity,
          reserved: data.reserved ?? existing.reserved,
          reorderAt: data.reorderAt ?? existing.reorderAt,
          costPerUnit: data.costPerUnit ?? existing.costPerUnit,
          currency: data.currency ?? existing.currency,
        },
        include: { product: true, warehouse: true },
      });
    }

    return this.prisma.client.inventoryStock.create({
      data: {
        businessId,
        productId: data.productId,
        warehouseId: data.warehouseId,
        quantity: data.quantity || 0,
        reserved: data.reserved || 0,
        reorderAt: data.reorderAt,
        costPerUnit: data.costPerUnit,
        currency: data.currency || 'TTD',
      },
      include: { product: true, warehouse: true },
    });
  }

  async getInventory(businessId: string, warehouseId?: string) {
    const where: any = { businessId };
    if (warehouseId) where.warehouseId = warehouseId;

    const [inventory, lastMovements] = await Promise.all([
      this.prisma.client.inventoryStock.findMany({
        where,
        include: { product: true, warehouse: true },
        orderBy: { product: { name: 'asc' } },
      }),
      this.prisma.client.stockMovement.findMany({
        where: { businessId, ...(warehouseId ? { warehouseId } : {}) },
        orderBy: { createdAt: 'desc' },
        select: { productId: true, warehouseId: true, createdAt: true, type: true, quantityChange: true },
      }),
    ]);

    const lastMovementMap: Record<string, (typeof lastMovements)[0]> = {};
    for (const m of lastMovements) {
      const key = `${m.productId}|${m.warehouseId}`;
      if (!lastMovementMap[key]) lastMovementMap[key] = m;
    }

    return inventory.map(inv => ({
      ...inv,
      lastMovement: lastMovementMap[`${inv.productId}|${inv.warehouseId}`] ?? null,
    }));
  }

  async createOrder(businessId: string, data: any) {
    const orderNumber = this.generateOrderNumber();

    const items = data.items || [];
    let subtotal = 0;
    const orderItems: any[] = [];

    for (const item of items) {
      const product = await this.prisma.client.product.findFirst({
        where: { id: item.productId, businessId },
      });
      if (!product) throw new BadRequestException(`Product ${item.productId} not found`);

      const unitPrice = product.price;
      const total = unitPrice * item.quantity;
      subtotal += total;

      orderItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        total,
        currency: data.currency || product.currency,
      });
    }

    const shippingFee = data.shippingFee || 0;
    const taxAmount = data.taxAmount || 0;
    const dutyAmount = data.dutyAmount || 0;
    const discountAmount = data.discountAmount || 0;
    const total = subtotal + shippingFee + taxAmount + dutyAmount - discountAmount;

    const initialStatus = data.paymentOnCreation ? 'paid' : 'placed';

    const order = await this.prisma.client.marketplaceOrder.create({
      data: {
        businessId,
        orderNumber,
        status: initialStatus,
        type: data.type || 'STANDARD',
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        customerCountry: data.customerCountry,
        shippingAddress: data.shippingAddress,
        billingAddress: data.billingAddress,
        subtotal,
        shippingFee,
        taxAmount,
        dutyAmount,
        discountAmount,
        total,
        currency: data.currency || 'TTD',
        notes: data.notes,
        items: { create: orderItems },
        metadata: {
          statusTimeline: [{ status: initialStatus, timestamp: new Date().toISOString(), note: 'Order placed' }],
        },
      },
      include: { items: { include: { product: true } }, shipments: true },
    });

    this.sendSellerNewOrderNotification(businessId, order, orderItems).catch((err) =>
      this.logger.error(`Failed to send seller new order notification: ${(err as Error).message}`),
    );

    this.events.emit('store_order.created', { order, businessId } as StoreOrderCreatedPayload);
    if (initialStatus === 'paid') {
      this.events.emit('store_order.paid', { order, businessId } as StoreOrderPaidPayload);
    }

    this.autoRouteOrder(businessId, order.id, initialStatus === 'paid');

    return order;
  }

  private autoRouteOrder(businessId: string, orderId: string, isPaid: boolean): void {
    const doRoute = async () => {
      const now = new Date().toISOString();
      const existing = await this.prisma.client.marketplaceOrder.findUnique({
        where: { id: orderId },
        select: { metadata: true, status: true },
      });
      const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};
      const existingTimeline = Array.isArray(existingMeta.statusTimeline)
        ? (existingMeta.statusTimeline as unknown[])
        : [];

      const routingNote = isPaid
        ? 'Order paid — routing fulfillment'
        : 'Order placed — routing fulfillment and reserving inventory';

      await this.prisma.client.marketplaceOrder.update({
        where: { id: orderId },
        data: {
          metadata: {
            ...existingMeta,
            statusTimeline: [
              ...existingTimeline,
              { status: existing?.status ?? 'placed', timestamp: now, note: routingNote },
            ],
          },
        },
      });

      await this.fulfillmentRoutingService.routeOrder(businessId, orderId);
    };

    doRoute().catch((err) =>
      this.logger.error(`Auto-routing failed for order ${orderId}: ${(err as Error).message}`),
    );
  }

  private async sendSellerNewOrderNotification(businessId: string, order: any, items: any[]) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId },
      select: { email: true, name: true },
    });
    if (!business?.email) return;

    await this.emailService.send({
      businessId,
      type: 'seller_new_order',
      recipientEmail: business.email,
      recipientName: business.name ?? 'Store Owner',
      templateData: {
        orderNumber: order.orderNumber,
        customerName: order.customerName ?? 'Customer',
        customerEmail: order.customerEmail ?? '',
        items: items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
        })),
        total: order.total,
        currency: order.currency ?? 'TTD',
        businessName: business.name ?? 'Store',
      },
      dedupeKey: `seller-new-order-${order.id}`,
    });
  }

  async getOrders(businessId: string, filters?: { status?: string; type?: string }, page = 1, pageSize = 50) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;

    pageSize = Math.min(Math.max(pageSize, 1), 100);
    page = Math.max(page, 1);

    const [data, total] = await Promise.all([
      this.prisma.client.marketplaceOrder.findMany({
        where,
        include: {
          items: { include: { product: true } },
          shipments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.marketplaceOrder.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getOrder(businessId: string, orderId: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: {
        items: { include: { product: true } },
        shipments: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateOrderStatus(businessId: string, orderId: string, status: string, paymentData?: any) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const updateData: any = { status };
    if (paymentData) {
      updateData.paymentStatus = paymentData.paymentStatus;
      updateData.paymentMethod = paymentData.paymentMethod;
      updateData.paymentRef = paymentData.paymentRef;
    }

    const updated = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: updateData,
      include: { items: { include: { product: true } }, shipments: true },
    });

    this.emitOrderLifecycleEvent(businessId, updated, status);

    return updated;
  }

  async createShipment(businessId: string, data: any) {
    return this.prisma.client.shipment.create({
      data: {
        businessId,
        orderId: data.orderId,
        trackingNumber: data.trackingNumber,
        carrier: data.carrier,
        status: data.status || 'PREPARING',
        originCountry: data.originCountry,
        destinationCountry: data.destinationCountry,
        destinationAddress: data.destinationAddress,
        weight: data.weight,
        weightUnit: data.weightUnit || 'kg',
        dimensions: data.dimensions,
        shippingCost: data.shippingCost,
        currency: data.currency || 'TTD',
        estimatedDelivery: data.estimatedDelivery ? new Date(data.estimatedDelivery) : undefined,
      },
      include: { order: true },
    });
  }

  async getShipments(businessId: string, filters?: { status?: string }, page = 1, pageSize = 50) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;

    pageSize = Math.min(Math.max(pageSize, 1), 100);
    page = Math.max(page, 1);

    const [data, total] = await Promise.all([
      this.prisma.client.shipment.findMany({
        where,
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.shipment.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async updateShipment(businessId: string, shipmentId: string, data: any) {
    const shipment = await this.prisma.client.shipment.findFirst({
      where: { id: shipmentId, businessId },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const updateData: Record<string, unknown> = {
      trackingNumber: data.trackingNumber,
      carrier: data.carrier,
      status: data.status,
      originCountry: data.originCountry,
      destinationCountry: data.destinationCountry,
      destinationAddress: data.destinationAddress,
      weight: data.weight,
      weightUnit: data.weightUnit,
      dimensions: data.dimensions,
      shippingCost: data.shippingCost,
      currency: data.currency,
    };
    if (data.status === 'SHIPPED' && !shipment.shippedAt) {
      updateData.shippedAt = new Date();
    }
    if (data.status === 'DELIVERED' && !shipment.deliveredAt) {
      updateData.deliveredAt = new Date();
    }
    if (data.estimatedDelivery) {
      updateData.estimatedDelivery = new Date(data.estimatedDelivery);
    }

    return this.prisma.client.shipment.update({
      where: { id: shipmentId },
      data: updateData,
      include: { order: true },
    });
  }

  async createCustomsDeclaration(businessId: string, data: any) {
    return this.prisma.client.customsDeclaration.create({
      data: {
        businessId,
        declarationType: data.declarationType || 'EXPORT',
        referenceNumber: data.referenceNumber,
        hsCode: data.hsCode,
        goodsDescription: data.goodsDescription,
        originCountry: data.originCountry,
        destinationCountry: data.destinationCountry,
        declaredValue: data.declaredValue,
        currency: data.currency || 'TTD',
        dutyRate: data.dutyRate,
        dutyAmount: data.dutyAmount,
        vatAmount: data.vatAmount,
        totalCharges: data.totalCharges,
        documents: data.documents,
        notes: data.notes,
      },
    });
  }

  async getCustomsDeclarations(businessId: string, filters?: { status?: string; type?: string }, page = 1, pageSize = 50) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.declarationType = filters.type;

    pageSize = Math.min(Math.max(pageSize, 1), 100);
    page = Math.max(page, 1);

    const [data, total] = await Promise.all([
      this.prisma.client.customsDeclaration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.customsDeclaration.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async updateCustomsDeclaration(businessId: string, declId: string, data: any) {
    const decl = await this.prisma.client.customsDeclaration.findFirst({
      where: { id: declId, businessId },
    });
    if (!decl) throw new NotFoundException('Customs declaration not found');

    const updateData: Record<string, unknown> = {
      declarationType: data.declarationType,
      referenceNumber: data.referenceNumber,
      hsCode: data.hsCode,
      goodsDescription: data.goodsDescription,
      originCountry: data.originCountry,
      destinationCountry: data.destinationCountry,
      declaredValue: data.declaredValue,
      currency: data.currency,
      dutyRate: data.dutyRate,
      dutyAmount: data.dutyAmount,
      vatAmount: data.vatAmount,
      totalCharges: data.totalCharges,
      documents: data.documents,
      notes: data.notes,
      status: data.status,
    };
    if (data.status === 'FILED' && !decl.filedAt) {
      updateData.filedAt = new Date();
    }
    if (data.status === 'CLEARED' && !decl.clearedAt) {
      updateData.clearedAt = new Date();
    }

    return this.prisma.client.customsDeclaration.update({
      where: { id: declId },
      data: updateData,
    });
  }

  async createPreOrder(businessId: string, data: any) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: data.productId, businessId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const unitPrice = product.price;
    const total = unitPrice * (data.quantity || 1);

    return this.prisma.client.preOrder.create({
      data: {
        businessId,
        productId: data.productId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        quantity: data.quantity || 1,
        unitPrice,
        depositAmount: data.depositAmount,
        total,
        currency: data.currency || product.currency,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : undefined,
        notes: data.notes,
      },
      include: { product: true },
    });
  }

  async getPreOrders(businessId: string, filters?: { status?: string }, page = 1, pageSize = 50) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;

    pageSize = Math.min(Math.max(pageSize, 1), 100);
    page = Math.max(page, 1);

    const [data, total] = await Promise.all([
      this.prisma.client.preOrder.findMany({
        where,
        include: { product: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.preOrder.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async updatePreOrder(businessId: string, preOrderId: string, data: any) {
    const po = await this.prisma.client.preOrder.findFirst({
      where: { id: preOrderId, businessId },
      include: { product: true },
    });
    if (!po) throw new NotFoundException('Pre-order not found');

    const updateData: Record<string, unknown> = {
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      quantity: data.quantity,
      depositAmount: data.depositAmount,
      notes: data.notes,
      status: data.status,
    };
    if (data.status === 'FULFILLED' && !po.fulfilledAt) {
      updateData.fulfilledAt = new Date();
    }
    const isDateDelayed = data.expectedDate && po.expectedDate &&
      new Date(data.expectedDate) > po.expectedDate;
    if (data.expectedDate) {
      updateData.expectedDate = new Date(data.expectedDate);
    }

    const updated = await this.prisma.client.preOrder.update({
      where: { id: preOrderId },
      data: updateData,
      include: { product: true },
    });

    if (isDateDelayed && updated.customerEmail) {
      this.events.emit('preorder.delayed', {
        businessId,
        preOrderId,
        productId: po.productId,
        productName: po.product?.name ?? 'Product',
        customerName: updated.customerName,
        customerEmail: updated.customerEmail,
        originalExpectedDate: po.expectedDate,
        newExpectedDate: new Date(data.expectedDate),
        reason: data.notes ?? null,
      } as PreorderDelayedPayload);
    }

    return updated;
  }

  async createPurchaseOrder(businessId: string, data: any) {
    const poNumber = this.generatePONumber();

    const items = data.items || [];
    let subtotal = 0;
    for (const item of items) {
      subtotal += (item.unitPrice || 0) * (item.quantity || 1);
    }

    const shippingCost = data.shippingCost || 0;
    const taxAmount = data.taxAmount || 0;
    const total = subtotal + shippingCost + taxAmount;

    return this.prisma.client.purchaseOrder.create({
      data: {
        businessId,
        poNumber,
        supplierName: data.supplierName,
        supplierEmail: data.supplierEmail,
        supplierPhone: data.supplierPhone,
        supplierCountry: data.supplierCountry,
        items,
        subtotal,
        shippingCost,
        taxAmount,
        total,
        currency: data.currency || 'TTD',
        expectedDelivery: data.expectedDelivery ? new Date(data.expectedDelivery) : undefined,
        notes: data.notes,
      },
    });
  }

  async getPurchaseOrders(businessId: string, filters?: { status?: string }, page = 1, pageSize = 50) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;

    pageSize = Math.min(Math.max(pageSize, 1), 100);
    page = Math.max(page, 1);

    const [data, total] = await Promise.all([
      this.prisma.client.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.purchaseOrder.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async updatePurchaseOrder(businessId: string, poId: string, data: any) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id: poId, businessId },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    if (data.status && data.status !== po.status) {
      return this.fulfillmentRoutingService.advancePurchaseOrderStatus(
        businessId,
        poId,
        data.status as 'SUBMITTED' | 'ACKNOWLEDGED' | 'SHIPPED' | 'RECEIVED',
      );
    }

    const updateData: Record<string, unknown> = {
      supplierName: data.supplierName,
      supplierEmail: data.supplierEmail,
      supplierPhone: data.supplierPhone,
      supplierCountry: data.supplierCountry,
      shippingCost: data.shippingCost,
      taxAmount: data.taxAmount,
      notes: data.notes,
    };
    if (data.expectedDelivery) {
      updateData.expectedDelivery = new Date(data.expectedDelivery);
    }

    return this.prisma.client.purchaseOrder.update({
      where: { id: poId },
      data: updateData,
    });
  }

  async advancePurchaseOrderStatus(
    businessId: string,
    poId: string,
    data: { status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'SHIPPED' | 'RECEIVED' },
  ) {
    return this.fulfillmentRoutingService.advancePurchaseOrderStatus(businessId, poId, data.status);
  }

  async getFulfillmentRoutes(businessId: string, orderId: string) {
    return this.fulfillmentRoutingService.getFulfillmentRoutes(businessId, orderId);
  }

  async updateFulfillmentRoute(businessId: string, routeId: string, data: any) {
    return this.fulfillmentRoutingService.updateFulfillmentRoute(businessId, routeId, data);
  }

  async routeOrder(businessId: string, orderId: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const validRoutingStatuses = ['placed', 'awaiting_fulfillment', 'paid'];
    if (!validRoutingStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Cannot manually route order in status "${order.status}". ` +
          `Order must be in placed, paid, or awaiting_fulfillment status.`,
      );
    }

    return this.fulfillmentRoutingService.routeOrder(businessId, orderId);
  }

  async activatePreorderRoute(businessId: string, routeId: string) {
    return this.fulfillmentRoutingService.activatePreorderRoute(businessId, routeId);
  }

  async getInventoryAlerts(businessId: string) {
    return this.fulfillmentRoutingService.getInventoryAlerts(businessId);
  }

  async getDashboard(businessId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalListings,
      activeListings,
      totalOrders,
      pendingOrders,
      totalShipments,
      inTransitShipments,
      pendingCustoms,
      activePreOrders,
      openPurchaseOrders,
      warehouses,
      monthlyRevenue,
    ] = await Promise.all([
      this.prisma.client.marketplaceListing.count({ where: { businessId } }),
      this.prisma.client.marketplaceListing.count({ where: { businessId, isActive: true } }),
      this.prisma.client.marketplaceOrder.count({ where: { businessId } }),
      this.prisma.client.marketplaceOrder.count({ where: { businessId, status: { in: ['placed', 'awaiting_payment', 'awaiting_fulfillment', 'PENDING'] } } }),
      this.prisma.client.shipment.count({ where: { businessId } }),
      this.prisma.client.shipment.count({ where: { businessId, status: 'IN_TRANSIT' } }),
      this.prisma.client.customsDeclaration.count({ where: { businessId, status: { in: ['DRAFT', 'FILED'] } } }),
      this.prisma.client.preOrder.count({ where: { businessId, status: 'PENDING' } }),
      this.prisma.client.purchaseOrder.count({ where: { businessId, status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } } }),
      this.prisma.client.warehouse.count({ where: { businessId, isActive: true } }),
      this.prisma.client.marketplaceOrder.aggregate({
        where: { businessId, paymentStatus: 'PAID', createdAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
    ]);

    const reachBreakdown = await this.prisma.client.marketplaceListing.groupBy({
      by: ['marketReach'],
      where: { businessId, isActive: true },
      _count: true,
    });

    return {
      listings: { total: totalListings, active: activeListings, reachBreakdown: reachBreakdown.map(r => ({ reach: r.marketReach, count: r._count })) },
      orders: { total: totalOrders, pending: pendingOrders },
      shipping: { total: totalShipments, inTransit: inTransitShipments },
      customs: { pending: pendingCustoms },
      preOrders: { active: activePreOrders },
      procurement: { openPOs: openPurchaseOrders },
      warehouses: { count: warehouses },
      revenue: { monthly: monthlyRevenue._sum.total || 0 },
    };
  }

  private generateOrderToken(orderId: string): string {
    return createHash('sha256').update(`${orderId}-${process.env.DATABASE_URL || 'salt'}`).digest('hex').slice(0, 32);
  }

  async getOrderByToken(token: string) {
    const orders = await this.prisma.client.marketplaceOrder.findMany({
      where: {
        metadata: { path: ['publicToken'], equals: token },
      },
      include: {
        items: { include: { product: true } },
        shipments: true,
        business: {
          select: {
            name: true,
            email: true,
            phone: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
          },
        },
      },
      take: 1,
    });

    if (orders.length > 0) {
      const order = orders[0];
      const meta = (order.metadata as Record<string, unknown>) ?? {};
      return {
        ...order,
        statusTimeline: (meta.statusTimeline as unknown[]) ?? [],
        fulfillmentNotes: (meta.fulfillmentNotes as unknown[]) ?? [],
      };
    }

    throw new NotFoundException('Order not found');
  }

  async getOrderToken(businessId: string, orderId: string): Promise<string> {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { id: true, metadata: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const meta = (order.metadata as Record<string, any>) ?? {};
    if (meta.publicToken) return meta.publicToken;

    const token = this.generateOrderToken(orderId);
    await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: { metadata: { ...meta, publicToken: token } },
    });
    return token;
  }

  async fulfillOrder(businessId: string, orderId: string, action: string, data?: any) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: { items: { include: { product: true } }, shipments: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const meta = (order.metadata as Record<string, any>) ?? {};
    const timeline: any[] = meta.statusTimeline ?? [];
    const now = new Date().toISOString();

    let newStatus = order.status;
    const updateData: Record<string, unknown> = {};

    switch (action) {
      case 'confirm': {
        if (!canTransitionOrder(order.status, 'awaiting_payment')) {
          throw new BadRequestException(`Cannot confirm order from ${order.status} status`);
        }
        newStatus = 'awaiting_payment';
        timeline.push({ status: 'awaiting_payment', timestamp: now, note: data?.note ?? 'Order confirmed, awaiting payment' });
        break;
      }

      case 'mark_awaiting_payment': {
        if (!canTransitionOrder(order.status, 'awaiting_payment')) {
          throw new BadRequestException(`Cannot transition order from ${order.status} to awaiting_payment`);
        }
        newStatus = 'awaiting_payment';
        timeline.push({ status: 'awaiting_payment', timestamp: now, note: data?.note });
        break;
      }

      case 'mark_paid': {
        if (!canTransitionOrder(order.status, 'paid')) {
          throw new BadRequestException(`Cannot transition order from ${order.status} to paid`);
        }
        newStatus = 'paid';
        timeline.push({ status: 'paid', timestamp: now, note: data?.note });
        if (data?.paymentMethod) updateData.paymentMethod = data.paymentMethod;
        if (data?.paymentRef) updateData.paymentRef = data.paymentRef;
        updateData.paymentStatus = 'PAID';
        updateData.status = newStatus;
        updateData.metadata = { ...meta, statusTimeline: [...timeline] };
        await this.prisma.client.marketplaceOrder.update({ where: { id: orderId }, data: updateData });
        this.autoRouteOrder(businessId, orderId, true);
        const paidOrder = await this.prisma.client.marketplaceOrder.findFirst({
          where: { id: orderId },
          include: { items: { include: { product: true } }, shipments: true, business: { select: { name: true } } },
        });
        if (paidOrder) {
          this.emitOrderLifecycleEvent(businessId, paidOrder, 'paid');
          this.sendFulfillmentNotification(businessId, paidOrder, 'paid', data).catch((err) =>
            this.logger.error(`Failed to send paid notification: ${(err as Error).message}`),
          );
        }
        return paidOrder;
      }

      case 'route': {
        if (!canTransitionOrder(order.status, 'awaiting_fulfillment')) {
          throw new BadRequestException(`Cannot route order from ${order.status} status`);
        }
        newStatus = 'awaiting_fulfillment';
        timeline.push({ status: 'awaiting_fulfillment', timestamp: now, note: data?.note });
        updateData.status = newStatus;
        updateData.metadata = { ...meta, statusTimeline: timeline };
        await this.prisma.client.marketplaceOrder.update({
          where: { id: orderId },
          data: updateData,
        });
        await this.fulfillmentRoutingService.routeOrder(businessId, orderId);
        const routedOrder = await this.prisma.client.marketplaceOrder.findFirst({
          where: { id: orderId },
          include: { items: { include: { product: true } }, shipments: true, business: { select: { name: true } } },
        });
        return routedOrder;
      }

      case 'process': {
        const target = 'picking_packing';
        if (!canTransitionOrder(order.status, target)) {
          throw new BadRequestException(`Cannot process order in ${order.status} status`);
        }
        newStatus = target;
        timeline.push({ status: target, timestamp: now, note: data?.note });
        await this.fulfillmentRoutingService.createPickPackTasks(businessId, orderId, order.items);
        break;
      }

      case 'ship': {
        if (!canTransitionOrder(order.status, 'shipped')) {
          throw new BadRequestException(`Cannot ship order in ${order.status} status`);
        }
        newStatus = 'shipped';
        timeline.push({
          status: 'shipped',
          timestamp: now,
          carrier: data?.carrier,
          trackingNumber: data?.trackingNumber,
          trackingUrl: data?.trackingUrl,
          note: data?.note,
        });

        let shipmentId: string | undefined;

        if (data?.carrier || data?.trackingNumber) {
          const shipment = await this.prisma.client.shipment.create({
            data: {
              businessId,
              orderId,
              carrier: data.carrier,
              trackingNumber: data.trackingNumber,
              status: 'IN_TRANSIT',
              shippedAt: new Date(),
              estimatedDelivery: data.estimatedDelivery ? new Date(data.estimatedDelivery) : undefined,
              destinationAddress: order.shippingAddress ?? undefined,
            },
          });
          shipmentId = shipment.id;
        }

        const localRoutes = await this.prisma.client.fulfillmentRoute.findMany({
          where: { businessId, orderId, strategy: 'LOCAL_STOCK', status: 'RESERVED' },
        });
        for (const route of localRoutes) {
          await this.fulfillmentRoutingService.decrementInventoryOnShip(businessId, route.id);
          await this.prisma.client.fulfillmentRoute.update({
            where: { id: route.id },
            data: {
              status: 'SHIPPED',
              shipmentId: shipmentId,
            },
          });
        }

        if (shipmentId) {
          await this.prisma.client.fulfillmentRoute.updateMany({
            where: {
              businessId,
              orderId,
              status: { in: ['PICKING_PACKING', 'PO_RAISED', 'PREORDER_ACCEPTED'] },
              shipmentId: null,
            },
            data: { status: 'SHIPPED', shipmentId },
          });
        } else {
          await this.prisma.client.fulfillmentRoute.updateMany({
            where: { businessId, orderId, status: { in: ['PICKING_PACKING', 'PO_RAISED', 'PREORDER_ACCEPTED'] } },
            data: { status: 'SHIPPED' },
          });
        }

        break;
      }

      case 'deliver': {
        if (!canTransitionOrder(order.status, 'delivered')) {
          throw new BadRequestException(`Cannot deliver order in ${order.status} status`);
        }
        newStatus = 'delivered';
        timeline.push({ status: 'delivered', timestamp: now, note: data?.note });

        if (order.shipments?.length > 0) {
          for (const shipment of order.shipments) {
            if (shipment.status !== 'DELIVERED') {
              await this.prisma.client.shipment.update({
                where: { id: shipment.id },
                data: { status: 'DELIVERED', deliveredAt: new Date() },
              });
            }
          }
        }

        await this.prisma.client.fulfillmentRoute.updateMany({
          where: { businessId, orderId, status: 'SHIPPED' },
          data: { status: 'DELIVERED', resolvedAt: new Date() },
        });
        break;
      }

      case 'complete': {
        if (!canTransitionOrder(order.status, 'completed')) {
          throw new BadRequestException(`Cannot complete order in ${order.status} status`);
        }
        newStatus = 'completed';
        timeline.push({ status: 'completed', timestamp: now, note: data?.note });

        await this.prisma.client.fulfillmentRoute.updateMany({
          where: { businessId, orderId, status: 'DELIVERED' },
          data: { status: 'COMPLETED', resolvedAt: new Date() },
        });
        break;
      }

      case 'cancel': {
        if (!canTransitionOrder(order.status, 'cancelled')) {
          throw new BadRequestException(`Cannot cancel order in ${order.status} status`);
        }
        newStatus = 'cancelled';
        timeline.push({ status: 'cancelled', timestamp: now, reason: data?.reason, note: data?.note });

        await this.fulfillmentRoutingService.releaseInventoryReservation(businessId, orderId);

        await this.prisma.client.fulfillmentRoute.updateMany({
          where: { businessId, orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          data: { status: 'CANCELLED' },
        });
        break;
      }

      case 'refund': {
        if (!canTransitionOrder(order.status, 'refunded')) {
          throw new BadRequestException(`Cannot refund order in ${order.status} status`);
        }
        newStatus = 'refunded';
        timeline.push({
          status: 'refunded',
          timestamp: now,
          refundAmount: data?.refundAmount ?? order.total,
          reason: data?.reason,
          note: data?.note,
        });
        updateData.paymentStatus = 'REFUNDED';
        break;
      }

      case 'add_tracking': {
        timeline.push({
          status: 'TRACKING_UPDATED',
          timestamp: now,
          carrier: data?.carrier,
          trackingNumber: data?.trackingNumber,
          trackingUrl: data?.trackingUrl,
        });

        if (data?.carrier || data?.trackingNumber) {
          const existingShipment = order.shipments?.find((s: any) => s.orderId === orderId);
          if (existingShipment) {
            await this.prisma.client.shipment.update({
              where: { id: existingShipment.id },
              data: {
                carrier: data.carrier ?? existingShipment.carrier,
                trackingNumber: data.trackingNumber ?? existingShipment.trackingNumber,
              },
            });
          } else {
            await this.prisma.client.shipment.create({
              data: {
                businessId,
                orderId,
                carrier: data.carrier,
                trackingNumber: data.trackingNumber,
                status: 'PREPARING',
                destinationAddress: order.shippingAddress ?? undefined,
              },
            });
          }
        }
        break;
      }

      default:
        throw new BadRequestException(`Unknown fulfillment action: ${action}`);
    }

    updateData.status = newStatus;
    updateData.metadata = { ...meta, statusTimeline: timeline };

    const updated = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: updateData,
      include: { items: { include: { product: true } }, shipments: true, business: { select: { name: true } } },
    });

    this.emitOrderLifecycleEvent(businessId, updated, newStatus, {
      refundAmount: action === 'refund' ? (data?.refundAmount ?? updated.total) : undefined,
    });

    this.sendFulfillmentNotification(businessId, updated, newStatus, data).catch((err) =>
      this.logger.error(`Failed to send fulfillment notification: ${(err as Error).message}`),
    );

    return updated;
  }

  private emitOrderLifecycleEvent(businessId: string, order: any, status: string, extra?: { refundAmount?: number }) {
    const normalizedStatus = status.toLowerCase();
    switch (normalizedStatus) {
      case 'paid':
        this.events.emit('store_order.paid', { order, businessId } as StoreOrderPaidPayload);
        break;
      case 'shipped':
        this.events.emit('store_order.shipped', { order, businessId } as StoreOrderShippedPayload);
        break;
      case 'delivered':
        this.events.emit('store_order.delivered', { order, businessId } as StoreOrderDeliveredPayload);
        break;
      case 'cancelled':
        this.events.emit('store_order.cancelled', { order, businessId } as StoreOrderCancelledPayload);
        break;
      case 'refunded':
        this.events.emit('store_order.refunded', {
          order,
          businessId,
          refundAmount: extra?.refundAmount ?? order.total,
        } as StoreOrderRefundedPayload);
        break;
    }
  }

  private async sendFulfillmentNotification(
    businessId: string,
    order: any,
    status: string,
    data?: any,
  ) {
    const customerEmail = order.customerEmail;
    const customerName = order.customerName || 'Customer';
    if (!customerEmail) return;

    const notificationMap: Record<string, string> = {
      CONFIRMED: 'order_confirmed',
      SHIPPED: 'order_shipped',
      DELIVERED: 'order_delivered',
      CANCELLED: 'order_cancelled',
      REFUNDED: 'order_refunded',
      paid: 'order_confirmed',
      shipped: 'order_shipped',
      delivered: 'order_delivered',
      cancelled: 'order_cancelled',
      refunded: 'order_refunded',
    };

    const type = notificationMap[status];
    if (!type) return;

    const items = (order.items ?? []).map((i: any) => ({
      name: i.product?.name ?? i.name ?? 'Item',
      quantity: i.quantity,
      unitPrice: i.unitPrice ?? i.price ?? 0,
      total: i.total ?? (i.quantity * (i.unitPrice ?? i.price ?? 0)),
    }));

    const itemsTotal = items.reduce((sum: number, i: any) => sum + (i.total ?? 0), 0);
    const shippingFee = order.shippingFee ?? 0;

    const templateData: Record<string, any> = {
      orderNumber: order.orderNumber ?? order.id,
      customerName,
      items,
      subtotal: itemsTotal,
      shippingFee,
      total: order.total ?? 0,
      currency: order.currency ?? 'USD',
      businessName: order.business?.name ?? 'Store',
      trackingUrl: data?.trackingUrl,
      carrier: data?.carrier,
      trackingNumber: data?.trackingNumber,
      reason: data?.reason,
      refundAmount: data?.refundAmount ?? order.total,
      deliveredAt: (status === 'DELIVERED' || status === 'delivered') ? new Date().toISOString() : undefined,
    };

    await this.emailService.send({
      businessId,
      type: type as NotificationType,
      recipientEmail: customerEmail,
      recipientName: customerName,
      templateData,
      dedupeKey: `${type}-${order.id}`,
    });
  }

  async getDeliveryConfig(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    const meta = (business.metaData as Record<string, any>) ?? {};
    return meta.storefront?.deliveryConfig ?? {
      shipping: { enabled: false, zones: [] },
      localPickup: { enabled: false, address: '', hours: '' },
      digital: { enabled: false },
      service: { enabled: false },
    };
  }

  async updateDeliveryConfig(businessId: string, config: Record<string, any>) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const storefront = meta.storefront ?? {};
    storefront.deliveryConfig = config;

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: { ...meta, storefront } },
    });

    return config;
  }

  async getInventorySummary(businessId: string) {
    const [inventory, warehouses, products] = await Promise.all([
      this.prisma.client.inventoryStock.findMany({
        where: { businessId },
        include: { product: { include: { costProfile: true } }, warehouse: true },
      }),
      this.prisma.client.warehouse.findMany({ where: { businessId, isActive: true } }),
      this.prisma.client.product.findMany({ where: { businessId, deletedAt: null }, select: { id: true } }),
    ]);

    const totalSKUs = inventory.length;
    const totalStockValue = inventory.reduce((sum, inv) => {
      const costPerUnit = inv.costPerUnit ?? inv.product?.costProfile?.landedCostEstimate ?? 0;
      return sum + (inv.quantity * costPerUnit);
    }, 0);
    const belowReorderCount = inventory.filter(inv => inv.reorderAt !== null && inv.quantity <= (inv.reorderAt ?? 0)).length;
    const outOfStockCount = inventory.filter(inv => inv.quantity <= 0).length;
    const inStockCount = inventory.filter(inv => inv.quantity > 0 && (inv.reorderAt === null || inv.quantity > (inv.reorderAt ?? 0))).length;
    const healthScore = totalSKUs > 0 ? Math.round((inStockCount / totalSKUs) * 100) : 100;

    const warehouseBreakdown = warehouses.map(wh => {
      const whInv = inventory.filter(inv => inv.warehouseId === wh.id);
      const totalUnits = whInv.reduce((s, i) => s + i.quantity, 0);
      const capacityUtil = wh.capacity ? Math.min(Math.round((totalUnits / wh.capacity) * 100), 100) : null;
      return { id: wh.id, name: wh.name, skuCount: whInv.length, totalUnits, capacity: wh.capacity, capacityUtilization: capacityUtil };
    });

    return {
      totalSKUs,
      totalStockValue,
      belowReorderCount,
      outOfStockCount,
      inStockCount,
      healthScore,
      warehouseBreakdown,
      totalProducts: products.length,
    };
  }

  async adjustInventory(businessId: string, data: { stockId: string; quantityChange: number; reasonCode: string; note?: string; userId?: string }) {
    const stock = await this.prisma.client.inventoryStock.findFirst({
      where: { id: data.stockId, businessId },
    });
    if (!stock) throw new NotFoundException('Inventory stock record not found');

    const newQuantity = stock.quantity + data.quantityChange;
    if (newQuantity < 0) throw new BadRequestException('Adjustment would result in negative stock quantity');

    const [updated] = await this.prisma.client.$transaction([
      this.prisma.client.inventoryStock.update({
        where: { id: stock.id },
        data: { quantity: newQuantity },
        include: { product: true, warehouse: true },
      }),
      this.prisma.client.stockMovement.create({
        data: {
          businessId,
          warehouseId: stock.warehouseId,
          productId: stock.productId,
          type: 'ADJUSTMENT',
          quantityChange: data.quantityChange,
          reasonCode: data.reasonCode,
          note: data.note,
          createdBy: data.userId,
          referenceId: stock.id,
        },
      }),
    ]);

    return updated;
  }

  async transferInventory(businessId: string, data: { productId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; note?: string; userId?: string }) {
    if (data.quantity <= 0) throw new BadRequestException('Transfer quantity must be positive');
    if (data.fromWarehouseId === data.toWarehouseId) throw new BadRequestException('Source and destination warehouses must be different');

    const fromStock = await this.prisma.client.inventoryStock.findUnique({
      where: { productId_warehouseId: { productId: data.productId, warehouseId: data.fromWarehouseId } },
    });
    if (!fromStock || fromStock.businessId !== businessId) throw new NotFoundException('Source inventory not found');

    const available = fromStock.quantity - fromStock.reserved;
    if (available < data.quantity) throw new BadRequestException(`Insufficient available stock. Available: ${available}`);

    const toWarehouse = await this.prisma.client.warehouse.findFirst({ where: { id: data.toWarehouseId, businessId } });
    if (!toWarehouse) throw new NotFoundException('Destination warehouse not found');

    const toStock = await this.prisma.client.inventoryStock.findUnique({
      where: { productId_warehouseId: { productId: data.productId, warehouseId: data.toWarehouseId } },
    });

    const refId = `TRF-${Date.now()}`;

    await this.prisma.client.$transaction([
      this.prisma.client.inventoryStock.update({
        where: { id: fromStock.id },
        data: { quantity: fromStock.quantity - data.quantity },
      }),
      toStock
        ? this.prisma.client.inventoryStock.update({
            where: { id: toStock.id },
            data: { quantity: toStock.quantity + data.quantity },
          })
        : this.prisma.client.inventoryStock.create({
            data: {
              businessId,
              productId: data.productId,
              warehouseId: data.toWarehouseId,
              quantity: data.quantity,
              reserved: 0,
              currency: fromStock.currency,
              costPerUnit: fromStock.costPerUnit,
              reorderAt: fromStock.reorderAt,
            },
          }),
      this.prisma.client.stockMovement.create({
        data: { businessId, warehouseId: data.fromWarehouseId, productId: data.productId, type: 'TRANSFER_OUT', quantityChange: -data.quantity, reasonCode: 'TRANSFER', note: data.note, createdBy: data.userId, referenceId: refId },
      }),
      this.prisma.client.stockMovement.create({
        data: { businessId, warehouseId: data.toWarehouseId, productId: data.productId, type: 'TRANSFER_IN', quantityChange: data.quantity, reasonCode: 'TRANSFER', note: data.note, createdBy: data.userId, referenceId: refId },
      }),
    ]);

    return { success: true, transferRef: refId };
  }

  async getInventoryMovements(businessId: string, limit = 100) {
    const movements = await this.prisma.client.stockMovement.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const productIds = [...new Set(movements.map(m => m.productId).filter(Boolean))] as string[];
    const warehouseIds = [...new Set(movements.map(m => m.warehouseId).filter(Boolean))] as string[];

    const [prods, whs] = await Promise.all([
      this.prisma.client.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } }),
      this.prisma.client.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, name: true } }),
    ]);

    const prodMap = Object.fromEntries(prods.map(p => [p.id, p]));
    const whMap = Object.fromEntries(whs.map(w => [w.id, w]));

    return movements.map(m => ({
      ...m,
      product: m.productId ? prodMap[m.productId] : null,
      warehouse: m.warehouseId ? whMap[m.warehouseId] : null,
    }));
  }

  async exportInventoryExcel(businessId: string): Promise<Buffer> {
    const inventory = await this.prisma.client.inventoryStock.findMany({
      where: { businessId },
      include: { product: { include: { costProfile: true } }, warehouse: true },
      orderBy: { product: { name: 'asc' } },
    });

    const rows = inventory.map(inv => ({
      SKU: inv.product?.sku || '',
      'Product Name': inv.product?.name || '',
      Warehouse: inv.warehouse?.name || '',
      'Quantity On Hand': inv.quantity,
      Reserved: inv.reserved,
      Available: inv.quantity - inv.reserved,
      'Reorder Level': inv.reorderAt ?? '',
      'Cost Per Unit': inv.costPerUnit ?? inv.product?.costProfile?.landedCostEstimate ?? '',
      Currency: inv.currency,
      Status: inv.quantity <= 0 ? 'Out of Stock' : (inv.reorderAt && inv.quantity <= inv.reorderAt ? 'Low Stock' : 'In Stock'),
    }));

    const wb = new ExcelJS.Workbook();
    const inventoryHeaders = [
      'SKU', 'Product Name', 'Warehouse', 'Quantity On Hand', 'Reserved',
      'Available', 'Reorder Level', 'Cost Per Unit', 'Currency', 'Status',
    ];
    const ws = wb.addWorksheet('Inventory');
    ws.columns = inventoryHeaders.map(header => ({ header, key: header }));
    for (const row of rows) {
      ws.addRow(row);
    }

    const summaryRows = [
      { Metric: 'Total SKUs', Value: inventory.length },
      { Metric: 'Out of Stock', Value: inventory.filter(i => i.quantity <= 0).length },
      { Metric: 'Low Stock', Value: inventory.filter(i => i.reorderAt && i.quantity <= i.reorderAt && i.quantity > 0).length },
      { Metric: 'Report Date', Value: new Date().toISOString().split('T')[0] },
    ];
    const summaryWs = wb.addWorksheet('Summary');
    summaryWs.columns = [
      { header: 'Metric', key: 'Metric' },
      { header: 'Value', key: 'Value' },
    ];
    for (const row of summaryRows) {
      summaryWs.addRow(row);
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }

  async importInventoryExcel(businessId: string, buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const rows: any[] = sheet ? this.sheetToObjects(sheet) : [];

    const warehouses = await this.prisma.client.warehouse.findMany({ where: { businessId, isActive: true } });
    const products = await this.prisma.client.product.findMany({ where: { businessId, deletedAt: null }, select: { id: true, name: true, sku: true } });

    const whByName = Object.fromEntries(warehouses.map(w => [w.name.toLowerCase(), w]));
    const prodBySku = Object.fromEntries(products.filter(p => p.sku).map(p => [p.sku!.toLowerCase(), p]));
    const prodByName = Object.fromEntries(products.map(p => [p.name.toLowerCase(), p]));

    const results = { imported: 0, skipped: 0, errors: [] as string[] };

    for (const row of rows) {
      try {
        const sku = String(row['SKU'] || row['sku'] || '').trim();
        const productName = String(row['Product Name'] || row['product_name'] || row['name'] || '').trim();
        const warehouseName = String(row['Warehouse'] || row['warehouse'] || '').trim();
        const qty = parseInt(row['Quantity On Hand'] ?? row['quantity'] ?? row['qty'] ?? 0, 10);
        const reorderLevel = row['Reorder Level'] !== null ? parseInt(row['Reorder Level'] ?? row['reorder_level'] ?? '', 10) : undefined;
        const costPerUnit = row['Cost Per Unit'] !== null ? parseFloat(row['Cost Per Unit'] ?? row['cost_per_unit'] ?? '') : undefined;

        if (isNaN(qty) || qty < 0) { results.errors.push(`Row skipped: invalid quantity (must be a non-negative integer)`); results.skipped++; continue; }

        const product = (sku && prodBySku[sku.toLowerCase()]) || (productName && prodByName[productName.toLowerCase()]);
        if (!product) { results.errors.push(`Product not found: ${sku || productName}`); results.skipped++; continue; }

        const warehouse = warehouseName ? whByName[warehouseName.toLowerCase()] : warehouses[0];
        if (!warehouse) { results.errors.push(`Warehouse not found: ${warehouseName}`); results.skipped++; continue; }

        const existingStock = await this.prisma.client.inventoryStock.findUnique({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        });
        const previousQty = existingStock?.quantity ?? null;

        await this.upsertInventory(businessId, {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: qty,
          reorderAt: isNaN(reorderLevel as number) ? undefined : reorderLevel,
          costPerUnit: isNaN(costPerUnit as number) ? undefined : costPerUnit,
        });

        const qtyChange = previousQty !== null ? qty - previousQty : qty;
        if (qtyChange !== 0) {
          await this.prisma.client.stockMovement.create({
            data: {
              businessId,
              warehouseId: warehouse.id,
              productId: product.id,
              type: 'ADJUSTMENT',
              quantityChange: qtyChange,
              reasonCode: 'EXCEL_IMPORT',
              note: `Excel import: ${sku || productName}${previousQty !== null ? ` (was ${previousQty})` : ' (new)'}`,
            },
          });
        }

        results.imported++;
      } catch (err: any) {
        results.errors.push(err.message);
        results.skipped++;
      }
    }

    return results;
  }

  async getInventoryExcelTemplate(): Promise<Buffer> {
    const headers = ['SKU', 'Product Name', 'Warehouse', 'Quantity On Hand', 'Reserved', 'Reorder Level', 'Cost Per Unit', 'Currency'];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventory Import Template');
    ws.columns = headers.map(header => ({ header, key: header }));
    ws.addRow({
      SKU: 'EXAMPLE-SKU-001',
      'Product Name': 'Example Product',
      Warehouse: 'Main Warehouse',
      'Quantity On Hand': 100,
      Reserved: 0,
      'Reorder Level': 10,
      'Cost Per Unit': 25.0,
      Currency: 'TTD',
    });
    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }

  private cellValueToPrimitive(value: ExcelJS.CellValue): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object') {
      if ('result' in value && (value as { result?: unknown }).result !== undefined) {
        return this.cellValueToPrimitive((value as { result: ExcelJS.CellValue }).result);
      }
      if ('richText' in value && Array.isArray((value as { richText?: unknown }).richText)) {
        return (value as { richText: Array<{ text?: string }> }).richText
          .map((rt) => rt.text ?? '')
          .join('');
      }
      if ('text' in value && (value as { text?: unknown }).text !== undefined) {
        const text = (value as { text: unknown }).text;
        return typeof text === 'string' ? text : String(text);
      }
      if ('error' in value) return null;
      return String(value);
    }
    return value;
  }

  private sheetToObjects(sheet: ExcelJS.Worksheet): Array<Record<string, unknown>> {
    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const value = this.cellValueToPrimitive(cell.value);
      headers[colNumber - 1] = value === null || value === undefined ? '' : String(value);
    });

    const rows: Array<Record<string, unknown>> = [];
    const lastRow = sheet.actualRowCount > 0 ? sheet.rowCount : 0;
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const record: Record<string, unknown> = {};
      let hasValue = false;
      for (let col = 0; col < headers.length; col++) {
        const header = headers[col];
        if (!header) continue;
        const value = this.cellValueToPrimitive(row.getCell(col + 1).value);
        record[header] = value;
        if (value !== null && value !== '') hasValue = true;
      }
      if (hasValue) rows.push(record);
    }
    return rows;
  }
}
