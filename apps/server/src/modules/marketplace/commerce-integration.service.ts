import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import {
  StoreOrderCreatedPayload,
  StoreOrderPaidPayload,
  StoreOrderShippedPayload,
  StoreOrderDeliveredPayload,
  StoreOrderCancelledPayload,
  StoreOrderRefundedPayload,
  InventoryLowPayload,
  InventoryOutPayload,
  PurchaseOrderReceivedPayload,
  PreorderDelayedPayload,
} from '../../core/event-bus/events.types';

@Injectable()
export class CommerceIntegrationService {
  private readonly logger = new Logger(CommerceIntegrationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
  ) {}

  /**
   * Resolve a contactId for an order using metadata links first, then falling
   * back to an email/phone lookup against the business's contacts.
   */
  private async resolveContactId(businessId: string, order: any): Promise<string | null> {
    const meta = (order.metadata as Record<string, any>) ?? {};
    const metaContactId = (meta.links as Record<string, any>)?.contactId as string | undefined;
    if (metaContactId) return metaContactId;

    if (order.customerEmail) {
      const contact = await this.prisma.client.contact.findFirst({
        where: { businessId, emailNormalized: order.customerEmail.toLowerCase(), deletedAt: null },
        select: { id: true },
      });
      if (contact) return contact.id;
    }

    if (order.customerPhone) {
      const contact = await this.prisma.client.contact.findFirst({
        where: { businessId, phone: order.customerPhone, deletedAt: null },
        select: { id: true },
      });
      if (contact) return contact.id;
    }

    return null;
  }

  private async linkContactToOrder(businessId: string, orderId: string, contactId: string): Promise<void> {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { metadata: true },
    });
    if (!order) return;

    const meta = (order.metadata as Record<string, unknown>) ?? {};
    const links = (meta.links as Record<string, unknown>) ?? {};
    if (links.contactId === contactId) return;

    await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: { metadata: { ...meta, links: { ...links, contactId } } },
    });
  }

  private async linkProjectToOrder(businessId: string, orderId: string, projectId: string): Promise<void> {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      select: { metadata: true },
    });
    if (!order) return;

    const meta = (order.metadata as Record<string, unknown>) ?? {};
    const links = (meta.links as Record<string, unknown>) ?? {};
    if (links.projectId === projectId) return;

    await this.prisma.client.marketplaceOrder.update({
      where: { id: orderId },
      data: { metadata: { ...meta, links: { ...links, projectId } } },
    });
  }

  private async createNotification(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.client.notification.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
      },
    }).catch((e) => this.logger.error(`Failed to create notification: ${(e as Error).message}`));
  }

  @OnEvent('store_order.created')
  async handleOrderCreated(payload: StoreOrderCreatedPayload) {
    try {
      const order = payload.order;
      if (!order.customerEmail && !order.customerPhone) return;

      const contact = await this.crm.findOrCreateContact(payload.businessId, {
        firstName: order.customerName?.split(' ')[0] ?? null,
        lastName: order.customerName?.split(' ').slice(1).join(' ') || null,
        email: order.customerEmail ?? null,
        phone: order.customerPhone ?? null,
        source: 'store_order',
        sourceDetail: `Order ${order.orderNumber ?? order.id}`,
        tags: ['customer', 'store-order'],
      });

      if (contact?.id) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId: contact.id,
          type: 'store_order.created',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            total: order.total,
            currency: order.currency,
            status: order.status,
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });

        await this.linkContactToOrder(payload.businessId, order.id, contact.id);
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.created',
        title: 'New Store Order',
        body: `Order ${order.orderNumber ?? order.id} placed by ${order.customerName ?? 'Customer'} for ${order.currency} ${order.total?.toFixed?.(2) ?? order.total}`,
        data: { orderId: order.id, orderNumber: order.orderNumber, total: order.total },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.created handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.paid')
  async handleOrderPaid(payload: StoreOrderPaidPayload) {
    try {
      const order = payload.order;

      await this.createRevenueRecord(payload.businessId, order);

      let contactId: string | null = null;
      if (order.customerEmail || order.customerPhone) {
        const contact = await this.crm.findOrCreateContact(payload.businessId, {
          firstName: order.customerName?.split(' ')[0] ?? null,
          lastName: order.customerName?.split(' ').slice(1).join(' ') || null,
          email: order.customerEmail ?? null,
          phone: order.customerPhone ?? null,
          source: 'store_order',
          sourceDetail: `Order ${order.orderNumber ?? order.id}`,
          tags: ['customer', 'store-order', 'paid'],
        });
        contactId = contact?.id ?? null;

        if (contactId) {
          await this.crm.logContactEvent({
            businessId: payload.businessId,
            contactId,
            type: 'store_order.paid',
            data: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              total: order.total,
              currency: order.currency,
            },
            actorType: 'SYSTEM',
            source: 'commerce',
          });

          await this.linkContactToOrder(payload.businessId, order.id, contactId);
        }
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.paid',
        title: 'Order Payment Received',
        body: `Order ${order.orderNumber ?? order.id} paid — ${order.currency} ${order.total?.toFixed?.(2) ?? order.total}`,
        data: { orderId: order.id, orderNumber: order.orderNumber, total: order.total, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.paid handler failed: ${(e as Error).message}`);
    }
  }

  private async createRevenueRecord(businessId: string, order: any) {
    try {
      const existing = await this.prisma.client.invoice.findFirst({
        where: {
          businessId,
          notes: { contains: `order:${order.id}` },
          deletedAt: null,
        },
      });
      if (existing) return;

      const items = (order.items ?? []).map((item: any) => ({
        description: item.name ?? item.product?.name ?? 'Product',
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice ?? 0,
        total: item.total ?? (item.quantity ?? 1) * (item.unitPrice ?? 0),
      }));

      const subtotal = items.reduce((s: number, i: any) => s + i.total, 0);

      const contactId = await this.resolveContactId(businessId, order);
      if (!contactId) throw new Error(`Cannot create invoice: no contact resolved for order ${order.id}`);

      await this.prisma.client.invoice.create({
        data: {
          businessId,
          contactId,
          invoiceNumber: `INV-ORD-${order.orderNumber ?? order.id.slice(-8).toUpperCase()}`,
          status: 'PAID',
          issueDate: new Date(),
          paidAt: new Date(),
          subtotal,
          taxAmount: order.taxAmount ?? 0,
          discountAmount: order.discountAmount ?? 0,
          total: order.total ?? subtotal,
          currency: order.currency ?? 'TTD',
          notes: `Auto-generated from store order ${order.orderNumber ?? order.id}. order:${order.id}`,
          items: {
            create: items,
          },
        },
      });

      this.logger.log(`[CommerceIntegration] Revenue record created for order ${order.orderNumber ?? order.id}`);
    } catch (e) {
      this.logger.error(`[CommerceIntegration] Failed to create revenue record: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.shipped')
  async handleOrderShipped(payload: StoreOrderShippedPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.shipped',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            trackingNumber: order.trackingNumber,
            carrier: order.carrier,
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      if (order.shippingFee && order.shippingFee > 0) {
        await this.expenses.createExpense({
          businessId: payload.businessId,
          description: `Shipping cost for order ${order.orderNumber ?? order.id}`,
          amount: order.shippingFee,
          currency: order.currency ?? 'TTD',
          date: new Date(),
          vendor: order.carrier ?? 'Shipping Carrier',
          tags: ['shipping', 'order-expense'],
          notes: `order:${order.id}`,
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.shipped',
        title: 'Order Shipped',
        body: `Order ${order.orderNumber ?? order.id} has been shipped.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.shipped handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.delivered')
  async handleOrderDelivered(payload: StoreOrderDeliveredPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.delivered',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            deliveredAt: new Date(),
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      if (order.customerEmail || contactId) {
        await this.scheduleReviewRequest(payload.businessId, order, contactId);
        await this.scheduleReorderPrompt(payload.businessId, order, contactId);
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.delivered',
        title: 'Order Delivered',
        body: `Order ${order.orderNumber ?? order.id} has been delivered.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.delivered handler failed: ${(e as Error).message}`);
    }
  }

  private async scheduleReorderPrompt(businessId: string, order: any, contactId: string | null) {
    try {
      const reorderDelayMs = 30 * 24 * 60 * 60 * 1000;
      const deliveredAt = new Date();
      await this.prisma.client.scheduledAgentJob.upsert({
        where: {
          businessId_entityId_checkpoint: {
            businessId,
            entityId: order.id,
            checkpoint: 'reorder_prompt',
          },
        },
        update: {
          status: 'PENDING',
          scheduledFor: new Date(deliveredAt.getTime() + reorderDelayMs),
        },
        create: {
          businessId,
          jobType: 'post_purchase_reorder_prompt',
          entityId: order.id,
          checkpoint: 'reorder_prompt',
          scheduledFor: new Date(deliveredAt.getTime() + reorderDelayMs),
          payload: {
            contactId,
            orderNumber: order.orderNumber,
            orderId: order.id,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            currency: order.currency,
            total: order.total,
            deliveredAt: deliveredAt.toISOString(),
            productNames: (order.items ?? []).map((i: any) => i.name ?? i.product?.name).filter(Boolean),
          },
        },
      });
      this.logger.log(`[CommerceIntegration] Reorder prompt scheduled for order ${order.orderNumber ?? order.id}`);
    } catch (e) {
      this.logger.warn(`[CommerceIntegration] Failed to schedule reorder prompt: ${(e as Error).message}`);
    }
  }

  private async scheduleReviewRequest(businessId: string, order: any, contactId: string | null) {
    try {
      const reviewDelayMs = 3 * 24 * 60 * 60 * 1000;
      await this.prisma.client.scheduledAgentJob.upsert({
        where: {
          businessId_entityId_checkpoint: {
            businessId,
            entityId: order.id,
            checkpoint: 'review_request',
          },
        },
        update: {
          status: 'PENDING',
          scheduledFor: new Date(Date.now() + reviewDelayMs),
        },
        create: {
          businessId,
          jobType: 'post_purchase_review_request',
          entityId: order.id,
          checkpoint: 'review_request',
          scheduledFor: new Date(Date.now() + reviewDelayMs),
          payload: {
            contactId,
            orderNumber: order.orderNumber,
            orderId: order.id,
            customerEmail: order.customerEmail,
            customerName: order.customerName,
            currency: order.currency,
            total: order.total,
            productNames: (order.items ?? []).map((i: any) => i.name ?? i.product?.name).filter(Boolean),
          },
        },
      });
      this.logger.log(`[CommerceIntegration] Review request scheduled for order ${order.orderNumber ?? order.id}`);
    } catch (e) {
      this.logger.warn(`[CommerceIntegration] Failed to schedule review request: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.cancelled')
  async handleOrderCancelled(payload: StoreOrderCancelledPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.cancelled',
          data: { orderId: order.id, orderNumber: order.orderNumber },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.cancelled',
        title: 'Order Cancelled',
        body: `Order ${order.orderNumber ?? order.id} has been cancelled.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.cancelled handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('store_order.refunded')
  async handleOrderRefunded(payload: StoreOrderRefundedPayload) {
    try {
      const order = payload.order;
      const contactId = await this.resolveContactId(payload.businessId, order);

      if (contactId) {
        await this.crm.logContactEvent({
          businessId: payload.businessId,
          contactId,
          type: 'store_order.refunded',
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            refundAmount: payload.refundAmount ?? order.total,
          },
          actorType: 'SYSTEM',
          source: 'commerce',
        });
      }

      if (payload.refundAmount && payload.refundAmount > 0) {
        await this.expenses.createExpense({
          businessId: payload.businessId,
          description: `Refund for order ${order.orderNumber ?? order.id}`,
          amount: payload.refundAmount,
          currency: order.currency ?? 'TTD',
          date: new Date(),
          vendor: order.customerName ?? 'Customer',
          tags: ['refund', 'order-expense'],
          notes: `order:${order.id}`,
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'store_order.refunded',
        title: 'Order Refunded',
        body: `Order ${order.orderNumber ?? order.id} has been refunded (${order.currency} ${(payload.refundAmount ?? order.total)?.toFixed?.(2) ?? ''}).`,
        data: { orderId: order.id, orderNumber: order.orderNumber, refundAmount: payload.refundAmount, contactId },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] store_order.refunded handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('inventory.low')
  async handleInventoryLow(payload: InventoryLowPayload) {
    try {
      await this.createNotification({
        businessId: payload.businessId,
        type: 'inventory.low',
        title: 'Low Stock Alert',
        body: `Product "${payload.productName}" is running low in ${payload.warehouseName}. Only ${payload.quantity} units available (reorder at ${payload.reorderAt}).`,
        data: {
          productId: payload.productId,
          productName: payload.productName,
          warehouseId: payload.warehouseId,
          quantity: payload.quantity,
          reorderAt: payload.reorderAt,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] inventory.low handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('inventory.out')
  async handleInventoryOut(payload: InventoryOutPayload) {
    try {
      await this.createNotification({
        businessId: payload.businessId,
        type: 'inventory.out',
        title: 'Out of Stock',
        body: `Product "${payload.productName}" is out of stock in ${payload.warehouseName}.`,
        data: {
          productId: payload.productId,
          productName: payload.productName,
          warehouseId: payload.warehouseId,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] inventory.out handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('purchaseOrder.received')
  async handlePurchaseOrderReceived(payload: PurchaseOrderReceivedPayload) {
    try {
      if (payload.total > 0) {
        await this.expenses.createExpense({
          businessId: payload.businessId,
          description: `Purchase Order ${payload.poNumber} received — sourcing cost`,
          amount: payload.total,
          currency: payload.currency,
          date: new Date(),
          vendor: payload.supplierName ?? 'Supplier',
          tags: ['purchase-order', 'sourcing-cost'],
          notes: `purchaseOrder:${payload.purchaseOrderId}`,
        });
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'purchaseOrder.received',
        title: 'Purchase Order Received',
        body: `Purchase order ${payload.poNumber} from ${payload.supplierName ?? 'supplier'} has been received.`,
        data: {
          purchaseOrderId: payload.purchaseOrderId,
          poNumber: payload.poNumber,
          total: payload.total,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] purchaseOrder.received handler failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('preorder.delayed')
  async handlePreorderDelayed(payload: PreorderDelayedPayload) {
    try {
      if (payload.customerEmail) {
        await this.sendPreorderDelayNotice(payload).catch((err) =>
          this.logger.error(`Failed to send preorder delay notice: ${(err as Error).message}`),
        );
      }

      await this.createNotification({
        businessId: payload.businessId,
        type: 'preorder.delayed',
        title: 'Pre-order Delayed',
        body: `Pre-order for "${payload.productName}" for ${payload.customerName ?? 'customer'} has been delayed.`,
        data: {
          preOrderId: payload.preOrderId,
          productId: payload.productId,
          productName: payload.productName,
          customerName: payload.customerName,
          newExpectedDate: payload.newExpectedDate,
        },
      });
    } catch (e) {
      this.logger.error(`[CommerceIntegration] preorder.delayed handler failed: ${(e as Error).message}`);
    }
  }

  private async sendPreorderDelayNotice(payload: PreorderDelayedPayload) {
    if (!payload.customerEmail) return;

    const newDateStr = payload.newExpectedDate
      ? new Date(payload.newExpectedDate).toLocaleDateString('en-TT', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'a later date';

    const originalDateStr = payload.originalExpectedDate
      ? new Date(payload.originalExpectedDate).toLocaleDateString('en-TT', { year: 'numeric', month: 'long', day: 'numeric' })
      : undefined;

    await this.emailService.send({
      businessId: payload.businessId,
      type: 'preorder_delay_notice',
      recipientEmail: payload.customerEmail,
      recipientName: payload.customerName ?? 'Customer',
      templateData: {
        customerName: payload.customerName ?? 'Customer',
        productName: payload.productName,
        originalExpectedDate: originalDateStr,
        newExpectedDate: newDateStr,
        reason: payload.reason ?? undefined,
      },
      dedupeKey: `preorder-delay-${payload.preOrderId}`,
    });
  }

  async promoteProductToContent(businessId: string, productId: string): Promise<{ post: any; message: string }> {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new Error('Product not found');

    const content = [
      `🎉 Introducing ${product.name}!`,
      product.description ? `\n\n${product.description}` : '',
      `\n\nAvailable now for ${product.currency} ${product.price.toFixed(2)}.`,
      `\n\n#${product.name.replace(/\s+/g, '')} #shop #new`,
    ].join('');

    const post = await this.prisma.client.socialPost.create({
      data: {
        businessId,
        content: content.trim(),
        mediaUrls: product.imageUrl ? [product.imageUrl] : [],
        status: 'DRAFT',
        channelIds: [],
      },
    });

    this.logger.log(`[CommerceIntegration] Created content campaign draft for product ${product.name}`);

    return {
      post,
      message: `Content campaign draft created for product "${product.name}". Review and publish from your Content section.`,
    };
  }

  async createProjectForBundleOrder(businessId: string, orderId: string, options?: { name?: string; description?: string; contactId?: string }) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new Error('Order not found');

    const serviceItems = (order.items as any[]).filter((item: any) =>
      item.product?.category === 'SERVICE',
    );
    if (serviceItems.length === 0) {
      return { created: false, message: 'No service items found in order. Projects are only created for service+product bundle orders.' };
    }

    const orderMeta = (order.metadata as Record<string, unknown>) ?? {};
    const orderLinks = (orderMeta.links as Record<string, string | undefined>) ?? {};
    const linkedProjectId = orderLinks.projectId ?? null;
    const linkedContactId = orderLinks.contactId ?? null;

    if (linkedProjectId) {
      const existingProject = await this.prisma.client.project.findFirst({
        where: { id: linkedProjectId, businessId, deletedAt: null },
      });
      if (existingProject) {
        return { created: false, project: existingProject, message: 'Project already exists for this order.' };
      }
    }

    let resolvedContactId: string | null = options?.contactId ?? linkedContactId ?? null;

    if (resolvedContactId) {
      const contactCheck = await this.prisma.client.contact.findFirst({
        where: { id: resolvedContactId, businessId, deletedAt: null },
        select: { id: true },
      });
      if (!contactCheck) {
        this.logger.warn(`[CommerceIntegration] contactId ${resolvedContactId} does not belong to business ${businessId} — ignoring`);
        resolvedContactId = null;
      }
    }

    const contactId = resolvedContactId;
    const projectName = options?.name ?? `Order ${order.orderNumber ?? orderId} - Custom Work`;
    const description = options?.description ?? `Project for service work linked to order ${order.orderNumber ?? orderId}.\nService items: ${serviceItems.map((i: any) => i.name).join(', ')}`;

    const project = await this.prisma.client.project.create({
      data: {
        businessId,
        name: projectName,
        description,
        status: 'ACTIVE',
        priority: 'NORMAL',
        contactId: contactId ?? null,
        dueDate: null,
      },
      include: { tasks: true },
    });

    await this.linkProjectToOrder(businessId, orderId, project.id);

    this.logger.log(`[CommerceIntegration] Created project ${project.id} for bundle order ${orderId}`);

    return { created: true, project, message: `Project "${projectName}" created for custom service work.` };
  }

  async getOrderCrossLinks(businessId: string, orderId: string) {
    const order = await this.prisma.client.marketplaceOrder.findFirst({
      where: { id: orderId, businessId },
      include: {
        items: { include: { product: true } },
        shipments: true,
      },
    });
    if (!order) throw new Error('Order not found');

    const orderMeta = (order.metadata as Record<string, unknown>) ?? {};
    const orderLinks = (orderMeta.links as Record<string, string | undefined>) ?? {};
    const linkedContactId = orderLinks.contactId ?? null;
    const linkedProjectId = orderLinks.projectId ?? null;

    const [invoices, expenses, contact, project] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          notes: { contains: `order:${orderId}` },
        },
        select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, paidAt: true },
      }),
      this.prisma.client.expense.findMany({
        where: {
          businessId,
          deletedAt: null,
          notes: { contains: `order:${orderId}` },
        },
        select: { id: true, description: true, amount: true, currency: true, date: true, vendor: true },
      }),
      linkedContactId
        ? this.prisma.client.contact.findFirst({
            where: { id: linkedContactId, businessId, deletedAt: null },
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          })
        : Promise.resolve(null),
      linkedProjectId
        ? this.prisma.client.project.findFirst({
            where: { id: linkedProjectId, businessId, deletedAt: null },
            select: { id: true, name: true, status: true, priority: true },
          })
        : Promise.resolve(null),
    ]);

    const margin = invoices.reduce((s, i) => s + (i.total ?? 0), 0) -
      expenses.reduce((s, e) => s + (e.amount ?? 0), 0);

    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        currency: order.currency,
      },
      revenue: invoices,
      expenses,
      contact,
      project,
      margin,
    };
  }

  async getContactOrderHistory(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
    });
    if (!contact) throw new Error('Contact not found');

    const ordersViaContactId = await this.prisma.client.marketplaceOrder.findMany({
      where: {
        businessId,
        metadata: { path: ['links', 'contactId'], equals: contactId },
      },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    }).catch(() => [] as any[]);

    const ordersViaEmail = contact.email
      ? await this.prisma.client.marketplaceOrder.findMany({
          where: { businessId, customerEmail: contact.email },
          include: { items: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
        }).catch(() => [] as any[])
      : [];

    const allOrders = [...ordersViaContactId];
    const seenIds = new Set(ordersViaContactId.map((o: any) => o.id));
    for (const o of ordersViaEmail) {
      if (!seenIds.has(o.id)) allOrders.push(o);
    }

    const totalSpent = allOrders
      .filter((o: any) => ['paid', 'CONFIRMED', 'shipped', 'delivered', 'completed'].includes(o.status))
      .reduce((s: number, o: any) => s + (o.total ?? 0), 0);

    const productsBought = allOrders
      .flatMap((o: any) => o.items ?? [])
      .map((i: any) => ({ productId: i.productId, name: i.name ?? i.product?.name }));

    return {
      contact: {
        id: contact.id,
        name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
        email: contact.email,
      },
      orders: allOrders,
      orderCount: allOrders.length,
      totalSpent,
      productsBought,
    };
  }

  async processPostPurchaseJobs(businessId: string) {
    const now = new Date();
    const dueJobs = await this.prisma.client.scheduledAgentJob.findMany({
      where: {
        businessId,
        jobType: { in: ['post_purchase_review_request', 'post_purchase_reorder_prompt'] },
        status: 'PENDING',
        scheduledFor: { lte: now },
      },
      take: 20,
    });

    for (const job of dueJobs) {
      try {
        const p = job.payload as any;
        if (job.jobType === 'post_purchase_review_request') {
          if (p.customerEmail) {
            await this.sendReviewRequestEmail(businessId, p);
          }
          if (p.contactId) {
            await this.addCrmTaskIfAbsent(businessId, p.contactId, `review-${p.orderId}`,
              `Request product review for order ${p.orderNumber ?? p.orderId}`);
          }
        } else if (job.jobType === 'post_purchase_reorder_prompt') {
          if (p.customerEmail) {
            await this.sendReorderPromptEmail(businessId, p);
          }
          if (p.contactId) {
            await this.addCrmTaskIfAbsent(businessId, p.contactId, `reorder-${p.orderId}`,
              `Follow up for reorder — order ${p.orderNumber ?? p.orderId}`);
          }
        }
        await this.prisma.client.scheduledAgentJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', executedAt: new Date() },
        });
      } catch (e) {
        this.logger.error(`[CommerceIntegration] Failed to process post-purchase job ${job.id} (${job.jobType}): ${(e as Error).message}`);
        await this.prisma.client.scheduledAgentJob.update({
          where: { id: job.id },
          data: { status: 'FAILED' },
        });
      }
    }

    return { processed: dueJobs.length };
  }

  private async addCrmTaskIfAbsent(businessId: string, contactId: string, _dedupeKey: string, title: string) {
    try {
      const existing = await this.prisma.client.contactTask.findFirst({
        where: { businessId, contactId, title },
        select: { id: true },
      });
      if (existing) return;

      await this.crm.addTask({
        businessId,
        contactId,
        title,
        priority: 'NORMAL',
        dueDate: new Date().toISOString(),
        source: 'commerce-integration',
      });
    } catch (e) {
      this.logger.warn(`[CommerceIntegration] addCrmTaskIfAbsent failed: ${(e as Error).message}`);
    }
  }

  private async sendReviewRequestEmail(businessId: string, p: any) {
    await this.emailService.send({
      businessId,
      type: 'review_request',
      recipientEmail: p.customerEmail,
      recipientName: p.customerName ?? 'Customer',
      templateData: {
        customerName: p.customerName ?? 'Customer',
        orderNumber: p.orderNumber ?? p.orderId,
        productNames: p.productNames ?? [],
      },
      dedupeKey: `review-request-${p.orderId}`,
    });
  }

  private async sendReorderPromptEmail(businessId: string, p: any) {
    let daysSincePurchase: number | undefined;
    if (p.deliveredAt) {
      const delivered = new Date(p.deliveredAt);
      daysSincePurchase = Math.round((Date.now() - delivered.getTime()) / (1000 * 60 * 60 * 24));
    }

    await this.emailService.send({
      businessId,
      type: 'reorder_prompt',
      recipientEmail: p.customerEmail,
      recipientName: p.customerName ?? 'Customer',
      templateData: {
        customerName: p.customerName ?? 'Customer',
        orderNumber: p.orderNumber ?? p.orderId,
        productNames: p.productNames ?? [],
        daysSincePurchase,
      },
      dedupeKey: `reorder-prompt-${p.orderId}`,
    });
  }
}
