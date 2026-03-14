import { ForbiddenException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicePaidPayload, InvoiceStatusPayload, ProductCreatedPayload, ProductUpdatedPayload, ProductDeactivatedPayload, QuoteCreatedPayload, QuoteSentPayload, QuoteConvertedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Service } from '@keyflow/db';
import { CrmService } from '../crm/crm.service';
import { AutomationService } from '../automation/automation.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CommerceStatsService } from './commerce-stats.service';

@Injectable()
export class CommerceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(AutomationService) private readonly automation: AutomationService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(CommerceStatsService) private readonly statsCache: CommerceStatsService,
  ) {}

  async listProducts(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.product.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async listPublicProducts(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProduct(input: { 
    businessId: string; 
    name: string; 
    price: number; 
    currency?: string; 
    description?: string | null;
    category?: string;
    duration?: number | null;
    imageUrl?: string | null;
    sku?: string | null;
    isActive?: boolean;
  }) {
    const result = await this.prisma.client.product.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        price: input.price,
        currency: input.currency ?? 'TTD',
        description: input.description ?? null,
        category: input.category ?? 'SERVICE',
        duration: input.duration ?? null,
        imageUrl: input.imageUrl ?? null,
        sku: input.sku ?? null,
        isActive: input.isActive ?? true,
      },
    });
    this.statsCache.invalidateCache(input.businessId);
    this.events.emit('product.created', { product: result, businessId: input.businessId } as ProductCreatedPayload);
    return result;
  }

  async updateProduct(input: { 
    businessId: string; 
    productId: string; 
    name?: string; 
    price?: number; 
    currency?: string; 
    description?: string | null;
    category?: string;
    duration?: number | null;
    imageUrl?: string | null;
    sku?: string | null;
    isActive?: boolean;
  }) {
    const result = await this.prisma.client.product.update({
      where: { id: input.productId, businessId: input.businessId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.duration !== undefined && { duration: input.duration }),
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.sku !== undefined && { sku: input.sku }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
    this.statsCache.invalidateCache(input.businessId);
    this.events.emit('product.updated', { product: result, businessId: input.businessId } as ProductUpdatedPayload);
    return result;
  }

  async deleteProduct(businessId: string, productId: string) {
    const result = await this.prisma.client.product.update({
      where: { id: productId, businessId },
      data: { deletedAt: new Date() },
    });
    this.statsCache.invalidateCache(businessId);
    this.events.emit('product.deactivated', { product: result, businessId } as ProductDeactivatedPayload);
    return result;
  }

  async bulkUpdateProducts(businessId: string, ids: string[], action: 'activate' | 'deactivate' | 'delete') {
    const where = { id: { in: ids }, businessId, deletedAt: null };
    let result: { count: number };
    switch (action) {
      case 'activate':
        result = await this.prisma.client.product.updateMany({ where, data: { isActive: true } });
        break;
      case 'deactivate':
        result = await this.prisma.client.product.updateMany({ where, data: { isActive: false } });
        break;
      case 'delete':
        result = await this.prisma.client.product.updateMany({ where, data: { deletedAt: new Date() } });
        break;
    }
    this.statsCache.invalidateCache(businessId);
    return { updated: result.count, action };
  }

  async createInvoiceForService(businessId: string, contactId: string, service: Service) {
    const total = service.price;
    return this.prisma.client.invoice.create({
      data: {
        businessId,
        contactId,
        invoiceNumber: `INV-${Date.now()}`,
        status: 'DRAFT',
        issueDate: new Date(),
        total,
        currency: (service as any).currency ?? 'TTD',
        items: {
          create: [
            {
              description: service.name,
              quantity: 1,
              unitPrice: service.price,
              total,
            },
          ],
        },
      },
      include: { items: true, contact: true },
    });
  }

  private validateTaxAndDiscount(taxRate?: number, discountValue?: number, discountType?: string) {
    if (taxRate !== undefined && taxRate !== null) {
      if (taxRate < 0 || taxRate > 100) {
        throw new Error('Tax rate must be between 0 and 100');
      }
    }
    if (discountValue !== undefined && discountValue !== null) {
      if (discountValue < 0) {
        throw new Error('Discount value must be non-negative');
      }
      if (discountType === 'PERCENT' && discountValue > 100) {
        throw new Error('Percentage discount cannot exceed 100%');
      }
    }
  }

  async createInvoice(input: {
    businessId: string;
    contactId?: string;
    items: { description: string; quantity: number; unitPrice: number }[];
    currency?: string;
    dueDate?: Date | string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
  }) {
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = (subtotal * taxRate) / 100;
    let discountAmount = 0;
    if (input.discountType === 'PERCENT' && input.discountValue) {
      discountAmount = (subtotal * input.discountValue) / 100;
    } else if (input.discountType === 'FIXED' && input.discountValue) {
      discountAmount = input.discountValue;
    }
    const total = subtotal + taxAmount - discountAmount;
    const data: any = {
      businessId: input.businessId,
      invoiceNumber: `INV-${Date.now()}`,
      status: 'DRAFT',
      issueDate: new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      subtotal,
      taxRate,
      taxAmount,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? null,
      discountAmount,
      total,
      currency: input.currency ?? 'TTD',
      notes: input.notes ?? null,
      items: {
        create: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
        })),
      },
    };
    if (input.contactId) {
      data.contactId = input.contactId;
    }
    const invoice = await this.prisma.client.invoice.create({
      data,
      include: { items: true, contact: true },
    });
    this.statsCache.invalidateCache(input.businessId);
    return invoice;
  }

  async listInvoices(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { contact: true, quote: true, payments: true, items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.invoice.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async deleteInvoice(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      throw new Error('Cannot delete a paid or partially paid invoice');
    }
    const result = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { deletedAt: new Date() },
    });
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async getInvoiceWithBusiness(invoiceId: string, requireShareable = false) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contact: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        items: true,
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            city: true,
            country: true,
            phone: true,
            email: true,
            website: true,
            primaryColor: true,
            secondaryColor: true,
            invoiceTemplate: true,
            facebook: true,
            instagram: true,
            twitter: true,
            whatsapp: true,
          },
        },
      },
    });

    if (!invoice) return null;

    if (requireShareable) {
      const shareableStatuses = ['SENT', 'PAID', 'OVERDUE', 'PARTIALLY_PAID'];
      if (!shareableStatuses.includes(invoice.status)) {
        return null;
      }
    }

    if ((!invoice.subtotal || invoice.subtotal === 0) && invoice.items?.length > 0) {
      const computedSubtotal = invoice.items.reduce((sum, item) => sum + (item.total || 0), 0);
      const computedTaxAmount = invoice.taxRate ? computedSubtotal * (invoice.taxRate / 100) : 0;
      return {
        ...invoice,
        subtotal: computedSubtotal,
        taxAmount: invoice.taxAmount ?? computedTaxAmount,
      };
    }

    return invoice;
  }

  async markInvoicePaid(invoiceId: string, actorId?: string | null) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
    if (actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingInvoice.businessId, userId: actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this invoice');
      }
    }
    const invoice = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date() },
      include: { items: true, contact: true, booking: true },
    });

    const payload: InvoicePaidPayload = {
      invoice,
      businessId: invoice.businessId,
      // For wildcard consumers that want the event name
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'invoice.paid',
    };
    this.events.emit('invoice.paid', payload);
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.paid',
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          paidAt: invoice.paidAt,
          bookingId: invoice.booking?.id,
        },
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }
    if (invoice.contactId) {
      await this.automation.handle({
        type: 'invoice.paid',
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        invoiceId,
        total: invoice.total,
        currency: invoice.currency,
      });
    }
    return invoice;
  }

  async markInvoicePaymentFailed(invoiceId: string, actorId?: string | null, reason?: string) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
    if (actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingInvoice.businessId, userId: actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this invoice');
      }
    }
    const invoice = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { status: 'FAILED' },
      include: { contact: true },
    });
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_failed',
        data: { invoiceId: invoice.id, reason },
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        source: 'commerce',
      });
    }
    return invoice;
  }

  async updateQuoteStatus(params: {
    quoteId: string;
    status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    actorId?: string | null;
  }) {
    const existingQuote = await this.prisma.client.quote.findUnique({
      where: { id: params.quoteId },
      select: { businessId: true },
    });
    if (!existingQuote) {
      throw new Error('Quote not found');
    }
    if (params.actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingQuote.businessId, userId: params.actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this quote');
      }
    }
    const quote = await this.prisma.client.quote.update({
      where: { id: params.quoteId },
      data: { status: params.status },
      include: { contact: true },
    });
    if (params.status === 'SENT') {
      this.events.emit('quote.sent', { quote, businessId: quote.businessId } as QuoteSentPayload);
    }
    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: `quote.${params.status.toLowerCase()}`,
        data: { quoteId: quote.id, total: quote.total, currency: quote.currency },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      });
    }
    this.statsCache.invalidateCache(existingQuote.businessId);
    return quote;
  }

  async updateInvoiceStatus(params: {
    invoiceId: string;
    status: 'SENT' | 'OVERDUE' | 'VOID';
    actorId?: string | null;
    sentAt?: Date | string;
    dueDate?: Date | string | null;
  }) {
    const existingInvoice = await this.prisma.client.invoice.findUnique({
      where: { id: params.invoiceId },
      select: { businessId: true },
    });
    if (!existingInvoice) {
      throw new Error('Invoice not found');
    }
    if (params.actorId) {
      const membership = await this.prisma.client.membership.findFirst({
        where: { businessId: existingInvoice.businessId, userId: params.actorId },
      });
      if (!membership) {
        throw new Error('Not authorized to update this invoice');
      }
    }
    const invoice = await this.prisma.client.invoice.update({
      where: { id: params.invoiceId },
      data: {
        status: params.status,
        sentAt: params.sentAt ? new Date(params.sentAt) : undefined,
        dueDate: params.dueDate ? new Date(params.dueDate) : undefined,
      },
      include: { contact: true, booking: true },
    });

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: `invoice.${params.status.toLowerCase()}`,
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          bookingId: invoice.booking?.id,
        },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      });
    }
    if (params.status === 'SENT' || params.status === 'OVERDUE') {
      const payload: InvoiceStatusPayload = {
        invoice,
        businessId: invoice.businessId,
        status: params.status,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        eventName: `invoice.${params.status.toLowerCase()}`,
      };
      this.events.emit(`invoice.${params.status.toLowerCase()}`, payload);
    }
    if (params.status === 'OVERDUE' && invoice.contactId) {
      await this.automation.handle({
        type: 'invoice.overdue',
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        invoiceId: invoice.id,
        total: invoice.total,
        currency: invoice.currency,
      });
    }
    this.statsCache.invalidateCache(existingInvoice.businessId);
    return invoice;
  }

  // ========== QUOTES ==========

  async listQuotes(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.quote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { contact: true, items: true, invoice: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.quote.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getQuote(quoteId: string) {
    return this.prisma.client.quote.findUnique({
      where: { id: quoteId },
      include: {
        contact: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        items: true,
        invoice: true,
        business: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            address: true,
            phone: true,
            email: true,
            website: true,
          },
        },
      },
    });
  }

  async createQuote(input: {
    businessId: string;
    contactId: string;
    items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    expiryDate?: Date | string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
  }) {
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = subtotal * taxRate / 100;
    const discountValue = input.discountValue ?? 0;
    const discountAmount = input.discountType === 'FIXED' ? discountValue : subtotal * discountValue / 100;
    const total = subtotal + taxAmount - discountAmount;
    
    const quote = await this.prisma.client.quote.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        quoteNumber: `QT-${Date.now()}`,
        status: 'DRAFT',
        issueDate: new Date(),
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        subtotal,
        taxRate,
        taxAmount,
        discountType: input.discountType ?? null,
        discountValue,
        discountAmount,
        total,
        currency: input.currency ?? 'TTD',
        notes: input.notes ?? null,
        items: {
          create: input.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.quantity * item.unitPrice,
            productId: item.productId ?? null,
          })),
        },
      },
      include: { items: true, contact: true },
    });
    this.events.emit('quote.created', { quote, businessId: input.businessId } as QuoteCreatedPayload);
    if (input.contactId) {
      await this.crm.logContactEvent({
        businessId: input.businessId,
        contactId: input.contactId,
        type: 'quote.created',
        data: { quoteId: quote.id, total: quote.total, currency: quote.currency },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }
    this.statsCache.invalidateCache(input.businessId);
    return quote;
  }

  async updateQuote(input: {
    quoteId: string;
    businessId: string;
    contactId?: string;
    items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    expiryDate?: Date | string | null;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
  }) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId },
    });
    if (!quote) {
      throw new Error('Quote not found');
    }
    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    if (quote.status === 'ACCEPTED' && quote.invoiceId) {
      throw new Error('Cannot edit a quote that has been converted to an invoice');
    }
    
    const updateData: any = {};
    if (input.contactId) updateData.contactId = input.contactId;
    if (input.currency) updateData.currency = input.currency;
    if (input.expiryDate !== undefined) {
      updateData.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
    }
    if (input.notes !== undefined) updateData.notes = input.notes;
    
    // Get items for recalculating totals
    const currentItems = input.items ?? (await this.prisma.client.quoteItem.findMany({ where: { quoteId: input.quoteId } }));
    const subtotal = currentItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    
    // Handle tax/discount updates
    const taxRate = input.taxRate ?? quote.taxRate ?? 0;
    const discountType = input.discountType ?? quote.discountType;
    const discountValue = input.discountValue ?? quote.discountValue ?? 0;
    
    const taxAmount = subtotal * taxRate / 100;
    const discountAmount = discountType === 'FIXED' ? discountValue : subtotal * discountValue / 100;
    const total = subtotal + taxAmount - discountAmount;
    
    updateData.subtotal = subtotal;
    updateData.taxRate = taxRate;
    updateData.taxAmount = taxAmount;
    updateData.discountType = discountType;
    updateData.discountValue = discountValue;
    updateData.discountAmount = discountAmount;
    updateData.total = total;
    
    if (input.items) {
      await this.prisma.client.quoteItem.deleteMany({ where: { quoteId: input.quoteId } });
      updateData.items = {
        create: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
          productId: item.productId ?? null,
        })),
      };
    }
    
    const updated = await this.prisma.client.quote.update({
      where: { id: input.quoteId },
      data: updateData,
      include: { items: true, contact: true },
    });
    this.statsCache.invalidateCache(input.businessId);
    return updated;
  }

  async deleteQuote(quoteId: string, businessId: string) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId },
    });
    if (!quote) {
      throw new Error('Quote not found');
    }
    if (quote.invoiceId) {
      throw new Error('Cannot delete a quote that has been converted to an invoice');
    }
    const result = await this.prisma.client.quote.update({
      where: { id: quoteId },
      data: { deletedAt: new Date() },
    });
    this.statsCache.invalidateCache(businessId);
    return result;
  }

  async convertQuoteToInvoice(input: {
    quoteId: string;
    businessId: string;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    notes?: string;
    dueDate?: Date | string;
  }) {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: input.quoteId, businessId: input.businessId, deletedAt: null },
      include: { items: true },
    });
    if (!quote) {
      throw new Error('Quote not found');
    }
    if (quote.status !== 'ACCEPTED') {
      throw new Error('Only accepted quotes can be converted to invoices');
    }
    if (quote.invoiceId) {
      throw new Error('Quote has already been converted to an invoice');
    }

    this.validateTaxAndDiscount(input.taxRate, input.discountValue, input.discountType);
    const subtotal = quote.items.reduce((sum, item) => sum + item.total, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = (subtotal * taxRate) / 100;
    let discountAmount = 0;
    if (input.discountType === 'PERCENT' && input.discountValue) {
      discountAmount = (subtotal * input.discountValue) / 100;
    } else if (input.discountType === 'FIXED' && input.discountValue) {
      discountAmount = input.discountValue;
    }
    const total = subtotal + taxAmount - discountAmount;

    const invoice = await this.prisma.client.invoice.create({
      data: {
        businessId: quote.businessId,
        contactId: quote.contactId,
        invoiceNumber: `INV-${Date.now()}`,
        status: 'DRAFT',
        issueDate: new Date(),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        subtotal,
        taxRate,
        taxAmount,
        discountType: input.discountType ?? null,
        discountValue: input.discountValue ?? null,
        discountAmount,
        total,
        currency: quote.currency,
        notes: input.notes ?? null,
        items: {
          create: quote.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            productId: item.productId ?? null,
          })),
        },
      },
      include: { items: true, contact: true },
    });

    await this.prisma.client.quote.update({
      where: { id: quote.id },
      data: { invoiceId: invoice.id },
    });

    this.events.emit('quote.converted', { quote, invoice, businessId: quote.businessId } as QuoteConvertedPayload);

    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: 'invoice.created',
        data: { invoiceId: invoice.id, quoteId: quote.id, total: invoice.total },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }

    this.statsCache.invalidateCache(input.businessId);
    return invoice;
  }

  // ========== PARTIAL PAYMENTS ==========

  async recordPayment(invoiceId: string, businessId: string, input: {
    amount: number;
    method: string;
    reference?: string;
    notes?: string;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: { payments: true },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new Error(`Cannot record payment on a ${invoice.status} invoice`);
    }
    if (input.amount <= 0) {
      throw new Error('Payment amount must be positive');
    }

    const existingPaid = invoice.payments
      .filter((p: any) => p.status === 'SUCCESSFUL')
      .reduce((sum: number, p: any) => sum + p.amount, 0);
    const remaining = Number(invoice.total) - existingPaid;
    const paymentAmount = Math.min(input.amount, remaining);

    const payment = await this.prisma.client.payment.create({
      data: {
        amount: paymentAmount,
        currency: invoice.currency,
        status: 'SUCCESSFUL',
        provider: input.method,
        method: input.method,
        providerPaymentId: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        businessId,
        invoiceId,
      },
    });

    const newPaidTotal = existingPaid + paymentAmount;
    const newStatus = newPaidTotal >= Number(invoice.total) ? 'PAID' : 'PARTIALLY_PAID';

    const updatedInvoice = await this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: {
        status: newStatus,
        ...(newStatus === 'PAID' ? { paidAt: new Date() } : {}),
      },
      include: { payments: true, contact: true, items: true },
    });

    if (newStatus === 'PAID') {
      this.events.emit('invoice.paid', {
        invoice: updatedInvoice,
        businessId,
        eventName: 'invoice.paid',
      } as any);
    }

    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: invoice.contactId,
        type: 'invoice.payment_recorded',
        data: {
          invoiceId,
          amount: paymentAmount,
          method: input.method,
          reference: input.reference,
          totalPaid: newPaidTotal,
          invoiceTotal: invoice.total,
          newStatus,
        },
        actorType: 'USER',
        source: 'commerce',
      });
    }

    this.statsCache.invalidateCache(businessId);

    return {
      payment,
      invoice: updatedInvoice,
      paidAmount: newPaidTotal,
      remaining: Math.max(0, Number(invoice.total) - newPaidTotal),
    };
  }

  async listPayments(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    const payments = await this.prisma.client.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    const paidAmount = payments
      .filter((p: any) => p.status === 'SUCCESSFUL')
      .reduce((sum: number, p: any) => sum + p.amount, 0);
    return {
      payments,
      paidAmount,
      remaining: Math.max(0, Number(invoice.total) - paidAmount),
      invoiceTotal: invoice.total,
    };
  }

  // ========== UPDATE INVOICE ==========

  async updateInvoice(input: {
    invoiceId: string;
    businessId: string;
    contactId?: string;
    items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
    currency?: string;
    dueDate?: Date | string | null;
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED' | null;
    discountValue?: number | null;
    notes?: string | null;
  }) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId: input.businessId },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    this.validateTaxAndDiscount(input.taxRate, input.discountValue ?? undefined, input.discountType ?? undefined);
    if (invoice.status === 'PAID' || invoice.status === 'PARTIALLY_PAID') {
      throw new Error('Cannot edit a paid or partially paid invoice');
    }

    const updateData: any = {};
    if (input.contactId !== undefined) updateData.contactId = input.contactId;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.dueDate !== undefined) {
      updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if (input.notes !== undefined) updateData.notes = input.notes;

    if (input.items) {
      await this.prisma.client.invoiceItem.deleteMany({ where: { invoiceId: input.invoiceId } });
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const taxRate = input.taxRate ?? invoice.taxRate ?? 0;
      const taxAmount = (subtotal * taxRate) / 100;
      let discountAmount = 0;
      const discountType = input.discountType !== undefined ? input.discountType : invoice.discountType;
      const discountValue = input.discountValue !== undefined ? input.discountValue : invoice.discountValue;
      if (discountType === 'PERCENT' && discountValue) {
        discountAmount = (subtotal * discountValue) / 100;
      } else if (discountType === 'FIXED' && discountValue) {
        discountAmount = discountValue;
      }
      const total = subtotal + taxAmount - discountAmount;

      updateData.subtotal = subtotal;
      updateData.taxRate = taxRate;
      updateData.taxAmount = taxAmount;
      updateData.discountType = discountType;
      updateData.discountValue = discountValue;
      updateData.discountAmount = discountAmount;
      updateData.total = total;
      updateData.items = {
        create: input.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
          productId: item.productId ?? null,
        })),
      };
    } else if (input.taxRate !== undefined || input.discountType !== undefined || input.discountValue !== undefined) {
      const subtotal = invoice.subtotal;
      const taxRate = input.taxRate ?? invoice.taxRate ?? 0;
      const taxAmount = (subtotal * taxRate) / 100;
      let discountAmount = 0;
      const discountType = input.discountType !== undefined ? input.discountType : invoice.discountType;
      const discountValue = input.discountValue !== undefined ? input.discountValue : invoice.discountValue;
      if (discountType === 'PERCENT' && discountValue) {
        discountAmount = (subtotal * discountValue) / 100;
      } else if (discountType === 'FIXED' && discountValue) {
        discountAmount = discountValue;
      }
      const total = subtotal + taxAmount - discountAmount;
      updateData.taxRate = taxRate;
      updateData.taxAmount = taxAmount;
      updateData.discountType = discountType;
      updateData.discountValue = discountValue;
      updateData.discountAmount = discountAmount;
      updateData.total = total;
    }

    const result = await this.prisma.client.invoice.update({
      where: { id: input.invoiceId },
      data: updateData,
      include: { items: true, contact: true },
    });
    this.statsCache.invalidateCache(input.businessId);
    return result;
  }

  async getCampaignRevenue(businessId: string, campaignId: string) {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        campaignId,
        deletedAt: null,
        status: { in: ['PAID', 'PARTIALLY_PAID', 'SENT', 'OVERDUE'] },
      },
      select: { id: true, total: true, status: true, currency: true },
    });
    const totalRevenue = invoices
      .filter((i: any) => i.status === 'PAID')
      .reduce((sum: number, i: any) => sum + i.total, 0);
    const pipelineRevenue = invoices
      .filter((i: any) => i.status !== 'PAID')
      .reduce((sum: number, i: any) => sum + i.total, 0);
    return {
      totalRevenue,
      pipelineRevenue,
      invoiceCount: invoices.length,
      currency: invoices[0]?.currency || 'TTD',
    };
  }

  async createPaymentLink(invoiceId: string, businessId: string, expiresInDays?: number) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
    });
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new Error('Cannot create payment link for a paid or voided invoice');
    }

    const existing = await this.prisma.client.paymentLink.findFirst({
      where: { invoiceId, businessId, active: true },
    });
    if (existing) return existing;

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    return this.prisma.client.paymentLink.create({
      data: { invoiceId, businessId, expiresAt },
    });
  }

  async getPaymentLinkByToken(token: string) {
    const link = await this.prisma.client.paymentLink.findUnique({
      where: { token },
      select: {
        id: true,
        token: true,
        active: true,
        expiresAt: true,
        invoiceId: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            currency: true,
            status: true,
          },
        },
      },
    });
    if (!link || !link.active) return null;
    if (link.expiresAt && link.expiresAt < new Date()) return null;
    return link;
  }

  async listPaymentLinks(businessId: string) {
    return this.prisma.client.paymentLink.findMany({
      where: { businessId, active: true },
      include: { invoice: { select: { id: true, invoiceNumber: true, total: true, currency: true, status: true, contact: { select: { firstName: true, lastName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivatePaymentLink(id: string, businessId: string) {
    return this.prisma.client.paymentLink.updateMany({
      where: { id, businessId },
      data: { active: false },
    });
  }

  async recordPublicPaymentIntent(invoiceId: string, method: string, amount?: number) {
    const validMethods = ['bank_transfer', 'cash', 'check', 'other', 'google_pay'];
    if (!validMethods.includes(method)) {
      throw new BadRequestException('Invalid offline payment method');
    }

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, total: true, businessId: true, invoiceNumber: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID') throw new BadRequestException('Invoice is already paid');

    await this.prisma.client.payment.create({
      data: {
        invoiceId,
        amount: amount || 0,
        method,
        reference: `Intent: ${invoice.invoiceNumber}`,
        notes: `Customer indicated ${method} payment via public payment page`,
      },
    });

    if (method === 'bank_transfer' || method === 'cash') {
      await this.prisma.client.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PENDING' },
      });
    }

    return { success: true, method, invoiceNumber: invoice.invoiceNumber };
  }
}
