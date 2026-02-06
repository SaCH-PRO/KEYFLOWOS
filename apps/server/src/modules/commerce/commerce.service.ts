import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicePaidPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Service } from '@keyflow/db';
import { CrmService } from '../crm/crm.service';
import { AutomationService } from '../automation/automation.service';

@Injectable()
export class CommerceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(AutomationService) private readonly automation: AutomationService,
  ) {}

  async listProducts(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPublicProducts(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  createProduct(input: { 
    businessId: string; 
    name: string; 
    price: number; 
    currency?: string; 
    description?: string | null;
    category?: string;
    duration?: number | null;
    isActive?: boolean;
  }) {
    return this.prisma.client.product.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        price: input.price,
        currency: input.currency ?? 'TTD',
        description: input.description ?? null,
        category: input.category ?? 'SERVICE',
        duration: input.duration ?? null,
        isActive: input.isActive ?? true,
      },
    });
  }

  updateProduct(input: { 
    businessId: string; 
    productId: string; 
    name?: string; 
    price?: number; 
    currency?: string; 
    description?: string | null;
    category?: string;
    duration?: number | null;
    isActive?: boolean;
  }) {
    return this.prisma.client.product.update({
      where: { id: input.productId, businessId: input.businessId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.duration !== undefined && { duration: input.duration }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
  }

  deleteProduct(businessId: string, productId: string) {
    return this.prisma.client.product.update({
      where: { id: productId, businessId },
      data: { deletedAt: new Date() },
    });
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
    return invoice;
  }

  listInvoices(businessId: string) {
    return this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { contact: true, quote: true, payments: true, items: true },
    });
  }

  async deleteInvoice(invoiceId: string, businessId: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    if (invoice.status === 'PAID') {
      throw new Error('Cannot delete a paid invoice');
    }
    return this.prisma.client.invoice.update({
      where: { id: invoiceId },
      data: { deletedAt: new Date() },
    });
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
            phone: true,
            email: true,
            website: true,
            primaryColor: true,
            secondaryColor: true,
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
      const shareableStatuses = ['SENT', 'PAID', 'OVERDUE'];
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
    return invoice;
  }

  // ========== QUOTES ==========

  listQuotes(businessId: string) {
    return this.prisma.client.quote.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { contact: true, items: true, invoice: true },
    });
  }

  async getQuote(quoteId: string) {
    return this.prisma.client.quote.findUnique({
      where: { id: quoteId },
      include: { contact: true, items: true, invoice: true, business: true },
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
    
    return this.prisma.client.quote.update({
      where: { id: input.quoteId },
      data: updateData,
      include: { items: true, contact: true },
    });
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
    return this.prisma.client.quote.update({
      where: { id: quoteId },
      data: { deletedAt: new Date() },
    });
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

    return invoice;
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
    if (invoice.status === 'PAID') {
      throw new Error('Cannot edit a paid invoice');
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

    return this.prisma.client.invoice.update({
      where: { id: input.invoiceId },
      data: updateData,
      include: { items: true, contact: true },
    });
  }
}
