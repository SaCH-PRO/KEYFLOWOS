import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PromoCodeService } from './promo-code.service';

@Injectable()
export class StoreOrderService {
  private readonly logger = new Logger(StoreOrderService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PromoCodeService) private readonly promoCodeService: PromoCodeService,
  ) {}

  async validateCart(items: { productId: string; quantity: number }[], businessId: string) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const productIds = items.map((i) => i.productId);
    const products = await this.prisma.client.product.findMany({
      where: {
        id: { in: productIds },
        businessId,
        deletedAt: null,
        isActive: true,
      },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));
    const errors: string[] = [];

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        errors.push(`Product ${item.productId} not found or unavailable`);
        continue;
      }
      if (item.quantity < 1) {
        errors.push(`Invalid quantity for ${product.name}`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }

    return {
      valid: true,
      products: items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: product.price,
          quantity: item.quantity,
          total: product.price * item.quantity,
          currency: product.currency,
        };
      }),
    };
  }

  async calculateOrderTotals(
    items: { productId: string; quantity: number }[],
    businessId: string,
    promoCode?: string,
    shippingZoneId?: string,
  ) {
    const validated = await this.validateCart(items, businessId);
    const subtotal = validated.products.reduce((sum, p) => sum + p.total, 0);
    const currency = validated.products[0]?.currency ?? 'TTD';

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { defaultTaxRate: true, currency: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    let discountAmount = 0;
    let freeShipping = false;
    let promoDetails: any = null;

    if (promoCode) {
      const promo = await this.promoCodeService.validate(businessId, promoCode, subtotal);
      const result = this.promoCodeService.apply(promo, subtotal);
      discountAmount = result.discount;
      freeShipping = result.freeShipping;
      promoDetails = {
        id: promo.id,
        code: promo.code,
        type: promo.type,
        value: promo.value,
        discount: discountAmount,
        freeShipping,
      };
    }

    let shippingFee = 0;
    let shippingDetails: any = null;
    if (shippingZoneId && !freeShipping) {
      const zone = await this.prisma.client.shippingZone.findFirst({
        where: { id: shippingZoneId, businessId, isActive: true },
      });
      if (zone) {
        shippingFee = zone.baseFee;
        if (zone.freeAbove !== null && subtotal >= zone.freeAbove) {
          shippingFee = 0;
        }
        shippingDetails = {
          zoneId: zone.id,
          zoneName: zone.name,
          fee: shippingFee,
          estimatedDays: zone.estimatedDays,
          carrier: zone.carrier,
        };
      }
    }

    const taxRate = business.defaultTaxRate ?? 0;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = Math.round(((taxableAmount * taxRate) / 100) * 100) / 100;
    const total = Math.round((subtotal - discountAmount + taxAmount + shippingFee) * 100) / 100;

    return {
      items: validated.products,
      subtotal,
      discountAmount,
      taxRate,
      taxAmount,
      shippingFee,
      total,
      currency,
      promo: promoDetails,
      shipping: shippingDetails,
    };
  }

  async createOrder(input: {
    businessId: string;
    cartItems: { productId: string; quantity: number }[];
    customerInfo: { name: string; email?: string; phone?: string; country?: string };
    promoCode?: string;
    shippingInfo?: {
      zoneId?: string;
      address?: Record<string, any>;
    };
    paymentMethod?: string;
    notes?: string;
  }) {
    const totals = await this.calculateOrderTotals(
      input.cartItems,
      input.businessId,
      input.promoCode,
      input.shippingInfo?.zoneId,
    );

    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const order = await this.prisma.client.marketplaceOrder.create({
      data: {
        businessId: input.businessId,
        orderNumber,
        status: 'PENDING',
        type: 'STOREFRONT',
        customerName: input.customerInfo.name,
        customerEmail: input.customerInfo.email ?? null,
        customerPhone: input.customerInfo.phone ?? null,
        customerCountry: input.customerInfo.country ?? null,
        shippingAddress: input.shippingInfo?.address ?? undefined,
        subtotal: totals.subtotal,
        shippingFee: totals.shippingFee,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        total: totals.total,
        currency: totals.currency,
        paymentMethod: input.paymentMethod ?? null,
        paymentStatus: input.paymentMethod === 'CASH' ? 'PENDING' : 'UNPAID',
        promoCodeId: totals.promo?.id ?? null,
        notes: input.notes ?? null,
        metadata: {
          taxRate: totals.taxRate,
          promoCode: totals.promo?.code ?? null,
          shipping: totals.shipping,
        },
        items: {
          create: totals.items.map((item) => ({
            productId: item.productId,
            name: item.name,
            sku: item.sku ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            currency: item.currency,
          })),
        },
      },
      include: { items: true },
    });

    if (totals.promo?.id) {
      await this.promoCodeService.incrementUsage(totals.promo.id);
    }

    this.events.emit('store_order.created', { order, businessId: input.businessId });

    return order;
  }

  async getOrder(orderId: string, businessId?: string) {
    const where: any = { id: orderId };
    if (businessId) where.businessId = businessId;

    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where,
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getPublicOrder(orderId: string, email: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, customerEmail: email },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      taxAmount: order.taxAmount,
      discountAmount: order.discountAmount,
      total: order.total,
      currency: order.currency,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      })),
      createdAt: order.createdAt,
    };
  }

  async updateOrderStatus(orderId: string, status: string, businessId: string) {
    const existing = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!existing) throw new NotFoundException('Order not found');

    const order = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: { status },
      include: { items: true },
    });

    const eventMap: Record<string, string> = {
      CONFIRMED: 'store_order.paid',
      SHIPPED: 'store_order.shipped',
      DELIVERED: 'store_order.delivered',
      CANCELLED: 'store_order.cancelled',
    };

    const eventName = eventMap[status];
    if (eventName) {
      this.events.emit(eventName, { order, businessId: order.businessId });
    }

    return order;
  }

  async updatePaymentStatus(orderId: string, paymentStatus: string, paymentRef?: string) {
    const order = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        paymentStatus,
        ...(paymentRef && { paymentRef }),
        ...(paymentStatus === 'PAID' && { status: 'CONFIRMED' }),
      },
      include: { items: true },
    });

    if (paymentStatus === 'PAID') {
      this.events.emit('store_order.paid', { order, businessId: order.businessId });
    }

    return order;
  }

  async listOrders(
    businessId: string,
    filters?: {
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(filters?.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 20, 1), 100);

    const where: any = { businessId };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters?.search) {
      where.OR = [
        { customerName: { contains: filters.search, mode: 'insensitive' } },
        { customerEmail: { contains: filters.search, mode: 'insensitive' } },
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.client.marketplaceOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.marketplaceOrder.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getOrderSummary(businessId: string) {
    const [totalOrders, pendingOrders, confirmedOrders, shippedOrders, completedOrders, cancelledOrders, revenueResult] =
      await Promise.all([
        this.prisma.client.marketplaceOrder.count({ where: { businessId } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'PENDING' } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'CONFIRMED' } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'SHIPPED' } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: { in: ['COMPLETED', 'DELIVERED'] } } }),
        this.prisma.client.marketplaceOrder.count({ where: { businessId, status: 'CANCELLED' } }),
        this.prisma.client.marketplaceOrder.findMany({
          where: { businessId, paymentStatus: 'PAID' },
          select: { total: true },
        }),
      ]);

    const totalRevenue = revenueResult.reduce((sum, o) => sum + o.total, 0);

    return {
      totalOrders,
      pendingOrders,
      confirmedOrders,
      shippedOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
    };
  }

  async refundOrder(orderId: string, businessId: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === 'REFUNDED') {
      throw new BadRequestException('Order has already been refunded');
    }

    const updated = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        status: 'REFUNDED',
        paymentStatus: 'REFUNDED',
      },
      include: { items: true },
    });

    this.events.emit('store_order.refunded', { order: updated, businessId, refundAmount: updated.total });

    return updated;
  }
}
