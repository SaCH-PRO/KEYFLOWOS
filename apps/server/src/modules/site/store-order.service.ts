import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PromoCodeService } from './promo-code.service';
import { CrmService } from '../crm/crm.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { InvoiceWorkflowService } from '../commerce/invoice-workflow.service';
import { InventoryRiskService } from '../commerce/inventory-risk.service';
import { RevenueAttributionService } from '../commerce/revenue-attribution.service';

@Injectable()
export class StoreOrderService {
  private readonly logger = new Logger(StoreOrderService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PromoCodeService) private readonly promoCodeService: PromoCodeService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
    @Inject(InvoiceWorkflowService) private readonly invoiceWorkflow: InvoiceWorkflowService,
    @Inject(InventoryRiskService) private readonly inventoryRisk: InventoryRiskService,
    @Inject(RevenueAttributionService) private readonly revenueAttribution: RevenueAttributionService,
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
    storefrontSlug?: string | null;
    visitorId?: string | null;
    referralCode?: string | null;
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
          referralCode: input.referralCode ?? null,
          visitorId: input.visitorId ?? null,
          storefrontSlug: input.storefrontSlug ?? null,
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

    try {
      const sourceDetail = input.storefrontSlug
        ? `storefront:${input.storefrontSlug}`
        : `order:${order.orderNumber}`;
      const nameParts = (input.customerInfo.name ?? '').trim().split(/\s+/);
      // When we have a visitorId, route through upsertStorefrontContact so
      // first-touch attribution (firstSource / utmMedium / utmCampaign /
      // firstReferrer / firstLandingPath) is enriched onto the Contact.
      const contact = input.visitorId
        ? await this.publicEvents.upsertStorefrontContact({
            businessId: input.businessId,
            sourceDetail,
            referralCode: input.referralCode ?? null,
            visitorId: input.visitorId,
            identity: {
              firstName: nameParts[0] ?? null,
              lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
              email: input.customerInfo.email ?? null,
              phone: input.customerInfo.phone ?? null,
            },
          })
        : await this.crm.findOrCreateContact(input.businessId, {
            firstName: nameParts[0] ?? null,
            lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
            email: input.customerInfo.email ?? null,
            phone: input.customerInfo.phone ?? null,
            source: 'storefront',
            sourceDetail,
            ...(input.referralCode ? { custom: { referralCode: input.referralCode } } : {}),
          });
      if (contact?.id) {
        if (input.visitorId) {
          await this.publicEvents.backstitchVisitor({
            businessId: input.businessId,
            visitorId: input.visitorId,
            contactId: contact.id,
            sourceDetail,
          }).catch(() => undefined);
        }
        const baseData = {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: order.total,
          currency: order.currency,
          itemCount: order.items.length,
          referralCode: input.referralCode ?? null,
        };
        await this.publicEvents.logStorefrontEvent({
          businessId: input.businessId,
          contactId: contact.id,
          type: 'checkout.started',
          sourceDetail,
          data: baseData,
        });
        await this.publicEvents.logStorefrontEvent({
          businessId: input.businessId,
          contactId: contact.id,
          type: 'store_order.created',
          sourceDetail,
          data: baseData,
        });
        if (order.paymentStatus === 'PAID') {
          await this.publicEvents.logStorefrontEvent({
            businessId: input.businessId,
            contactId: contact.id,
            type: 'payment.completed',
            sourceDetail,
            data: baseData,
          });
        }
      }
    } catch (err) {
      this.logger.warn(`[store-order] CRM hook failed: ${(err as Error).message}`);
    }

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
    if (paymentStatus === 'PAID') {
      // Route through completeCheckout so Invoice + Payment + stock decrement
      // + RevenueAttribution all land in one transaction.
      return this.completeCheckout({
        orderId,
        paymentRef,
        provider: 'unknown',
        method: 'unknown',
      });
    }

    const order = await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: {
        paymentStatus,
        ...(paymentRef && { paymentRef }),
      },
      include: { items: true },
    });
    return order;
  }

  /**
   * Atomically finalize a successful storefront checkout.
   *
   * Creates, in a single transaction:
   *   1. Invoice + InvoiceItems (status PAID, going through workflow service)
   *   2. Payment (status SUCCESSFUL) linked to invoice + business
   *   3. InventoryStock decrement + StockMovement audit row per item
   *   4. RevenueAttribution row (source='storefront', revenueType='ORDER')
   *   5. MarketplaceOrder updated to status CONFIRMED, paymentStatus PAID
   *
   * Failure of any step rolls back the whole thing — we never want a paid
   * order with no invoice or stock that didn't decrement. After the
   * transaction commits we do best-effort side-effects (event emission,
   * inventory-risk evaluation, CRM timeline write); failures there are
   * logged but never fail the checkout.
   */
  async completeCheckout(input: {
    orderId: string;
    paymentRef?: string;
    provider?: string;
    method?: string;
    paidAmount?: number;
  }) {
    const order = await this.prisma.client.marketplaceOrder.findUnique({
      where: { id: input.orderId },
      include: { items: true, business: { select: { defaultTaxRate: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.paymentStatus === 'PAID') {
      // Idempotent: if we already completed this order, return as-is.
      this.logger.debug(`[store-order] completeCheckout no-op for already-PAID order ${order.id}`);
      return this.prisma.client.marketplaceOrder.findUnique({
        where: { id: order.id },
        include: { items: true },
      });
    }

    // Resolve customer contact OUTSIDE the tx so CRM dedup logic
    // (which has its own internal logic) doesn't expand the tx footprint.
    let contactId: string | null = null;
    let referralCode: string | null = null;
    try {
      const meta = (order.metadata as Record<string, unknown> | null) ?? {};
      referralCode = typeof meta.referralCode === 'string' ? meta.referralCode : null;
      const nameParts = (order.customerName ?? '').trim().split(/\s+/);
      const contact = await this.crm.findOrCreateContact(order.businessId, {
        firstName: nameParts[0] ?? null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        email: order.customerEmail,
        phone: order.customerPhone,
        source: 'storefront',
        sourceDetail: `order:${order.orderNumber}`,
        ...(referralCode ? { custom: { referralCode } } : {}),
      });
      contactId = contact?.id ?? null;
    } catch (err) {
      this.logger.warn(`[store-order] CRM resolve failed for order ${order.id}: ${(err as Error).message}`);
    }
    if (!contactId) {
      // Invoice requires a contact. Surface this clearly rather than
      // silently dropping the row.
      throw new BadRequestException(
        'Cannot finalize checkout: unable to resolve a contact for this order. Provide a customer email or phone.',
      );
    }

    // Pick a default warehouse for stock decrement (first active per business).
    const defaultWarehouse = await this.prisma.client.warehouse.findFirst({
      where: { businessId: order.businessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const amount = input.paidAmount ?? order.total;
    const provider = input.provider ?? order.paymentMethod?.toLowerCase() ?? 'manual';
    const method = (input.method ?? order.paymentMethod ?? 'manual').toLowerCase();
    const paymentRef = input.paymentRef ?? order.paymentRef ?? `${provider}_${order.id}_${Date.now()}`;
    const invoiceNumber = `INV-${order.orderNumber}`;

    // Pre-load product inventory mode so we can enforce stock invariants
    // for tracked products inside the tx. Untracked / virtual products
    // skip stock decrement explicitly (per-product config), not silently.
    const productIds = order.items.map((i) => i.productId);
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, inventoryMode: true, name: true },
    });
    const productMode = new Map(products.map((p) => [p.id, p.inventoryMode ?? 'tracked']));

    // Buffer for invoice events emitted by InvoiceWorkflowService.transition
    // calls inside the transaction. We flush AFTER the tx commits so
    // listeners (e.g. InvoiceReceiptListener) never act on uncommitted
    // state if a later tx step rolls back.
    const pendingEvents: Array<{ name: string; payload: unknown }> = [];

    const result = await this.prisma.client.$transaction(async (tx) => {
      // 1. Invoice — created DRAFT then immediately walked DRAFT→SENT→PAID
      // through the canonical InvoiceWorkflowService inside this same
      // transaction so the row is never observable in DRAFT outside the
      // commit boundary. Events are buffered for post-commit emission.
      const now = new Date();
      const invoice = await tx.invoice.create({
        data: {
          businessId: order.businessId,
          contactId: contactId!,
          invoiceNumber,
          status: 'DRAFT',
          subtotal: order.subtotal,
          taxAmount: order.taxAmount,
          discountAmount: order.discountAmount ?? 0,
          total: order.total,
          currency: order.currency,
          issueDate: now,
          notes: `Storefront order ${order.orderNumber}`,
          items: {
            create: order.items.map((item) => ({
              description: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          },
        },
      });
      const txClient = tx as unknown as Prisma.TransactionClient;
      await this.invoiceWorkflow.transition(invoice.id, 'SENT', { sentAt: now, tx: txClient, eventBuffer: pendingEvents });
      await this.invoiceWorkflow.transition(invoice.id, 'PAID', { paidAt: now, tx: txClient, eventBuffer: pendingEvents });

      // 2. Payment row
      await tx.payment.create({
        data: {
          provider,
          providerPaymentId: paymentRef,
          amount,
          currency: order.currency,
          status: 'SUCCESSFUL',
          method,
          invoiceId: invoice.id,
          businessId: order.businessId,
        },
      });

      // 3. Stock decrement + movement rows. Tracked products MUST have a
      //    warehouse + stock row with sufficient quantity; otherwise we
      //    fail the entire checkout (rolling back invoice + payment) so
      //    we never sell stock we can't fulfill. Untracked / virtual
      //    products are explicitly skipped per their inventoryMode.
      const decrementedProductIds: string[] = [];
      const trackedItems = order.items.filter((i) => {
        const mode = productMode.get(i.productId) ?? 'tracked';
        return mode === 'tracked';
      });
      if (trackedItems.length > 0 && !defaultWarehouse) {
        throw new BadRequestException(
          'Cannot finalize checkout: no active warehouse configured for tracked products.',
        );
      }
      for (const item of order.items) {
        const mode = productMode.get(item.productId) ?? 'tracked';
        if (mode !== 'tracked') {
          this.logger.debug(`[store-order] skipping stock decrement for ${mode} product ${item.productId}`);
          continue;
        }
        const stock = await tx.inventoryStock.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: defaultWarehouse!.id,
            },
          },
        });
        if (!stock) {
          throw new BadRequestException(
            `Cannot finalize checkout: tracked product ${item.productId} has no stock row in the default warehouse.`,
          );
        }
        if (stock.quantity < item.quantity) {
          throw new BadRequestException(
            `Cannot finalize checkout: insufficient stock for product ${item.productId} (have ${stock.quantity}, need ${item.quantity}).`,
          );
        }
        await tx.inventoryStock.update({
          where: { id: stock.id },
          data: { quantity: stock.quantity - item.quantity },
        });
        await tx.stockMovement.create({
          data: {
            businessId: order.businessId,
            warehouseId: defaultWarehouse!.id,
            productId: item.productId,
            quantityChange: -item.quantity,
            type: 'sale',
            referenceId: order.orderNumber,
          },
        });
        decrementedProductIds.push(item.productId);
      }

      // 4. Revenue attribution — hard requirement; failures roll back.
      await this.revenueAttribution.record(
        {
          businessId: order.businessId,
          source: 'storefront',
          sourceDetail: `order:${order.orderNumber}`,
          revenueType: 'ORDER',
          revenueId: order.id,
          amount: order.total,
          currency: order.currency,
          contactId,
          referralCode,
        },
        tx as unknown as Prisma.TransactionClient,
      );

      // 5. Order — paid + confirmed
      const updatedOrder = await tx.marketplaceOrder.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          paymentRef,
        },
        include: { items: true },
      });

      return { updatedOrder, invoice, decrementedProductIds };
    });

    // Tx committed — now safe to flush buffered invoice events and
    // dispatch the storefront-funnel timeline + CRM hooks.
    for (const evt of pendingEvents) {
      this.events.emit(evt.name, evt.payload);
    }

    try {
      const baseData = {
        orderId: result.updatedOrder.id,
        orderNumber: result.updatedOrder.orderNumber,
        invoiceId: result.invoice.id,
        total: result.updatedOrder.total,
        currency: result.updatedOrder.currency,
        paymentRef,
      };
      await this.publicEvents.logStorefrontEvent({
        businessId: order.businessId,
        contactId: contactId!,
        type: 'payment.completed',
        sourceDetail: `order:${order.orderNumber}`,
        data: baseData,
      });
    } catch (err) {
      this.logger.warn(`[store-order] post-checkout timeline write failed: ${(err as Error).message}`);
    }

    this.events.emit('store_order.paid', { order: result.updatedOrder, businessId: order.businessId, invoiceId: result.invoice.id });

    // Re-evaluate inventory risk for affected products & emit signals so
    // inventory-risk listeners (action queue, alerts) can react.
    for (const productId of result.decrementedProductIds) {
      try {
        const risk = await this.inventoryRisk.evaluateProduct(productId, order.businessId);
        if (!risk) continue;
        for (const signal of risk.signals) {
          if (signal.type === 'out_of_stock' || signal.type === 'low_stock') {
            this.events.emit(`inventory.${signal.type}`, {
              businessId: order.businessId,
              productId,
              productName: risk.productName,
              signal,
              triggeredBy: { type: 'order', id: order.id, orderNumber: order.orderNumber },
            });
          }
        }
      } catch (err) {
        this.logger.warn(`[store-order] inventory-risk eval failed for ${productId}: ${(err as Error).message}`);
      }
    }

    return result.updatedOrder;
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
