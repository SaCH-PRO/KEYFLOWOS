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

  listProducts(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null },
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
  }) {
    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const data: any = {
      businessId: input.businessId,
      invoiceNumber: `INV-${Date.now()}`,
      status: 'DRAFT',
      issueDate: new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      total,
      currency: input.currency ?? 'TTD',
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
      include: { contact: true, quote: true, payments: true },
    });
  }

  async markInvoicePaid(invoiceId: string, actorId?: string | null) {
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
}
