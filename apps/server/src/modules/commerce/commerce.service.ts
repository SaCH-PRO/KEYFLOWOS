import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InvoicePaidPayload } from '../../core/event-bus/events.types';
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
          bookingId: invoice.bookingId,
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
          bookingId: invoice.bookingId,
        },
        actorType: params.actorId ? 'USER' : 'SYSTEM',
        actorId: params.actorId ?? undefined,
        source: 'commerce',
      });
    }
    return invoice;
  }
}
