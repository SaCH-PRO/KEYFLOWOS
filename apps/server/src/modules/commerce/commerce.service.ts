import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicePaidPayload, InvoiceStatusPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Service } from '@keyflow/db';
import { CrmService } from '../crm/crm.service';
import { AutomationService } from '../automation/automation.service';

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly crm: CrmService,
    private readonly automation: AutomationService,
  ) {}

  listProducts(businessId: string) {
    return this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createProduct(input: { businessId: string; name: string; price: number; currency?: string; description?: string | null }) {
    return this.prisma.client.product.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        price: input.price,
        currency: input.currency ?? 'TTD',
        description: input.description ?? null,
      },
    });
  }

  updateProduct(input: {
    productId: string;
    name?: string;
    price?: number;
    currency?: string | null;
    description?: string | null;
  }) {
    return this.prisma.client.product.update({
      where: { id: input.productId },
      data: {
        name: input.name ?? undefined,
        price: input.price ?? undefined,
        currency: input.currency ?? undefined,
        description: input.description ?? undefined,
      },
    });
  }

  async deleteProduct(productId: string) {
    await this.prisma.client.product.delete({ where: { id: productId } });
    return { success: true, id: productId };
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

  listInvoices(businessId: string) {
    return this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { contact: true, quote: true, payments: true },
    });
  }

  getInvoice(invoiceId: string) {
    return this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { contact: true, items: true, quote: true, payments: true },
    });
  }

  async createInvoice(input: {
    businessId: string;
    contactId: string;
    issueDate?: Date;
    dueDate?: Date | null;
    status?: 'DRAFT' | 'SENT' | 'PAID' | 'VOID' | 'OVERDUE';
    currency?: string;
    items: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
  }) {
    const { items, total } = this.prepareLineItems(input.items);
    const invoiceNumber = `INV-${Date.now()}`;
    const invoice = await this.prisma.client.invoice.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        invoiceNumber,
        status: input.status ?? 'DRAFT',
        issueDate: input.issueDate ?? new Date(),
        dueDate: input.dueDate ?? null,
        total,
        currency: input.currency ?? 'TTD',
        items: { create: items },
      },
      include: { items: true, contact: true },
    });
    if (invoice.contactId) {
      await this.crm.logContactEvent({
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        type: 'invoice.created',
        data: {
          invoiceId: invoice.id,
          total: invoice.total,
          currency: invoice.currency,
          status: invoice.status,
        },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }
    return invoice;
  }

  async updateInvoice(input: {
    invoiceId: string;
    contactId?: string;
    issueDate?: Date;
    dueDate?: Date | null;
    status?: 'DRAFT' | 'SENT' | 'PAID' | 'VOID' | 'OVERDUE' | 'FAILED';
    currency?: string;
    items?: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
  }) {
    const hasItems = Array.isArray(input.items);
    const lineData = hasItems ? this.prepareLineItems(input.items ?? []) : null;
    return this.prisma.client.$transaction(async (tx) => {
      if (hasItems) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: input.invoiceId } });
      }
      const updated = await tx.invoice.update({
        where: { id: input.invoiceId },
        data: {
          contactId: input.contactId ?? undefined,
          issueDate: input.issueDate ?? undefined,
          dueDate: input.dueDate ?? undefined,
          status: input.status ?? undefined,
          currency: input.currency ?? undefined,
          total: lineData ? lineData.total : undefined,
        },
      });
      if (lineData) {
        await tx.invoiceItem.createMany({
          data: lineData.items.map((item) => ({
            invoiceId: updated.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            productId: item.productId ?? null,
          })),
        });
      }
      return tx.invoice.findUnique({
        where: { id: updated.id },
        include: { items: true, contact: true, quote: true, payments: true },
      });
    });
  }

  async deleteInvoice(invoiceId: string) {
    await this.prisma.client.invoice.delete({ where: { id: invoiceId } });
    return { success: true, id: invoiceId };
  }

  listQuotes(businessId: string) {
    return this.prisma.client.quote.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { contact: true, items: true },
    });
  }

  getQuote(quoteId: string) {
    return this.prisma.client.quote.findUnique({
      where: { id: quoteId },
      include: { contact: true, items: true, invoice: true },
    });
  }

  async createQuote(input: {
    businessId: string;
    contactId: string;
    issueDate?: Date;
    expiryDate?: Date | null;
    status?: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    currency?: string;
    items: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
  }) {
    const { items, total } = this.prepareLineItems(input.items);
    const quoteNumber = `QUO-${Date.now()}`;
    const quote = await this.prisma.client.quote.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        quoteNumber,
        status: input.status ?? 'DRAFT',
        issueDate: input.issueDate ?? new Date(),
        expiryDate: input.expiryDate ?? null,
        total,
        currency: input.currency ?? 'TTD',
        items: { create: items },
      },
      include: { items: true, contact: true },
    });
    if (quote.contactId) {
      await this.crm.logContactEvent({
        businessId: quote.businessId,
        contactId: quote.contactId,
        type: 'quote.created',
        data: {
          quoteId: quote.id,
          total: quote.total,
          currency: quote.currency,
          status: quote.status,
        },
        actorType: 'SYSTEM',
        source: 'commerce',
      });
    }
    return quote;
  }

  async updateQuote(input: {
    quoteId: string;
    contactId?: string;
    issueDate?: Date;
    expiryDate?: Date | null;
    status?: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    currency?: string;
    items?: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>;
  }) {
    const hasItems = Array.isArray(input.items);
    const lineData = hasItems ? this.prepareLineItems(input.items ?? []) : null;
    return this.prisma.client.$transaction(async (tx) => {
      if (hasItems) {
        await tx.quoteItem.deleteMany({ where: { quoteId: input.quoteId } });
      }
      const updated = await tx.quote.update({
        where: { id: input.quoteId },
        data: {
          contactId: input.contactId ?? undefined,
          issueDate: input.issueDate ?? undefined,
          expiryDate: input.expiryDate ?? undefined,
          status: input.status ?? undefined,
          currency: input.currency ?? undefined,
          total: lineData ? lineData.total : undefined,
        },
      });
      if (lineData) {
        await tx.quoteItem.createMany({
          data: lineData.items.map((item) => ({
            quoteId: updated.id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            productId: item.productId ?? null,
          })),
        });
      }
      return tx.quote.findUnique({ where: { id: updated.id }, include: { items: true, contact: true } });
    });
  }

  async deleteQuote(quoteId: string) {
    await this.prisma.client.quote.delete({ where: { id: quoteId } });
    return { success: true, id: quoteId };
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
    if (params.status === 'SENT' && invoice.contactId) {
      await this.automation.handle({
        type: 'invoice.sent',
        businessId: invoice.businessId,
        contactId: invoice.contactId,
        invoiceId: invoice.id,
        total: invoice.total,
        currency: invoice.currency,
      });
    }
    return invoice;
  }

  private prepareLineItems(
    items: Array<{ description: string; quantity: number; unitPrice: number; total?: number; productId?: string | null }>,
  ) {
    const prepared = items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total ?? item.quantity * item.unitPrice,
      productId: item.productId ?? null,
    }));
    const total = prepared.reduce((sum, item) => sum + (item.total ?? 0), 0);
    return { items: prepared, total };
  }
}
