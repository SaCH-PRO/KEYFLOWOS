import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../core/prisma/prisma.service';

type InvoiceStatusPayload = {
  invoice?: {
    id?: string;
    invoiceNumber?: string;
    total?: unknown;
    currency?: string | null;
    contactId?: string | null;
    contact?: { firstName?: string | null; lastName?: string | null } | null;
  };
  businessId: string;
  status?: string;
};

type PaymentReceivedPayload = {
  businessId: string;
  contactId?: string | null;
  invoiceId?: string | null;
  amount?: number | null;
  currency?: string | null;
  provider?: string | null;
  externalId?: string | null;
};

type QuoteSentPayload = {
  quote?: {
    id?: string;
    quoteNumber?: string;
    contactId?: string | null;
    total?: unknown;
    currency?: string | null;
  };
  businessId: string;
};

/**
 * Subscribes to revenue events and writes idempotent in-app notifications
 * for the business owner. Idempotency is enforced via a `dedupeKey` stored
 * in `Notification.data` and a 24h lookback before writing a duplicate.
 */
@Injectable()
export class NotificationsRevenueListener {
  private readonly logger = new Logger(NotificationsRevenueListener.name);

  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @OnEvent('invoice.overdue', { async: true })
  async onInvoiceOverdue(p: InvoiceStatusPayload) {
    const inv = p.invoice;
    if (!inv?.id) return;
    await this.writeOnce({
      businessId: p.businessId,
      type: 'invoice.overdue',
      title: `Invoice ${inv.invoiceNumber ?? inv.id} is overdue`,
      body: this.contactLabel(inv.contact)
        ? `${this.contactLabel(inv.contact)} has not paid yet.`
        : 'Customer has not paid yet.',
      dedupeKey: `notif:invoice.overdue:${inv.id}`,
      data: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, contactId: inv.contactId ?? null },
    });
  }

  @OnEvent('payment.received', { async: true })
  async onPaymentReceived(p: PaymentReceivedPayload) {
    const dedupeKey = `notif:payment.received:${p.externalId ?? p.invoiceId ?? `${p.contactId ?? ''}:${p.amount ?? 0}`}`;
    await this.writeOnce({
      businessId: p.businessId,
      type: 'payment.received',
      title: 'Payment received',
      body: p.amount != null ? `Received ${p.currency ?? ''} ${p.amount}`.trim() : 'A payment was received.',
      dedupeKey,
      data: {
        invoiceId: p.invoiceId ?? null,
        contactId: p.contactId ?? null,
        amount: p.amount ?? null,
        currency: p.currency ?? null,
        provider: p.provider ?? null,
      },
    });
  }

  @OnEvent('quote.sent', { async: true })
  async onQuoteSent(p: QuoteSentPayload) {
    const q = p.quote;
    if (!q?.id) return;
    await this.writeOnce({
      businessId: p.businessId,
      type: 'quote.sent',
      title: `Quote ${q.quoteNumber ?? q.id} sent`,
      body: 'Follow up if there is no response within 3 days.',
      dedupeKey: `notif:quote.sent:${q.id}`,
      data: { quoteId: q.id, quoteNumber: q.quoteNumber, contactId: q.contactId ?? null },
    });
  }

  private contactLabel(contact?: { firstName?: string | null; lastName?: string | null } | null): string {
    if (!contact) return '';
    return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  }

  private async writeOnce(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    dedupeKey: string;
    data?: Record<string, unknown>;
  }) {
    if (!input.businessId) return;
    try {
      const existing = await this.prisma.client.notification.findFirst({
        where: {
          businessId: input.businessId,
          type: input.type,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && (existing.data as Record<string, unknown> | null)?.dedupeKey === input.dedupeKey) {
        return;
      }
      await this.notifications.create({
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: { ...(input.data ?? {}), dedupeKey: input.dedupeKey },
      });
    } catch (err: any) {
      this.logger.warn(
        `notifications-revenue write failed for ${input.type}: ${(err as Error).message}`,
      );
    }
  }
}
