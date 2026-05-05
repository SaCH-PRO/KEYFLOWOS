import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ContactEventType } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { ContactInsightService } from './contact-insight.service';
import type {
  QuoteCreatedPayload,
  QuoteSentPayload,
  QuoteViewedPayload,
  QuoteAcceptedPayload,
  QuoteRejectedPayload,
  QuoteStalePayload,
  QuoteConvertedPayload,
  InvoiceCreatedPayload,
  InvoiceStatusPayload,
  InvoicePaidPayload,
  PaymentReceivedPayload,
  PaymentFailedPayload,
  RecurringInvoiceCreatedPayload,
  RecurringInvoiceUpdatedPayload,
  RecurringInvoiceDeletedPayload,
  RecurringInvoiceGeneratedPayload,
  RecurringInvoiceFailedPayload,
  StoreOrderPaidPayload,
  StoreOrderRefundedPayload,
  StoreOrderRoutingFailedPayload,
  BookingInvoiceCreatedPayload,
} from '../../core/event-bus/events.types';

type FulfillmentRoutedPayload = {
  businessId: string;
  contactId: string | null;
  orderId: string;
  strategies?: string[];
  routeCount?: number;
};

/**
 * Central listener that turns revenue/operations events on the bus into
 * canonical ContactEvent rows on the contact timeline (and triggers the
 * insight snapshot to recompute). Every other module emits — only this
 * listener writes timeline rows for these events, so we have one place
 * to enforce idempotency and shape.
 *
 * Idempotency: each event carries (or is given) a stable `dedupeKey`
 * `rev:<type>:<entityId>`; before writing we check the contact's last 25
 * events of the same type for a matching key in `data.dedupeKey`.
 */
@Injectable()
export class RevenueEventListener {
  private readonly logger = new Logger(RevenueEventListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(ContactInsightService) private readonly insights: ContactInsightService,
  ) {}

  // ---- quote.* ----
  @OnEvent('quote.created', { async: true })
  async onQuoteCreated(p: QuoteCreatedPayload) {
    const quote = p.quote as { id?: string; contactId?: string | null; quoteNumber?: string; total?: unknown; currency?: string | null } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.created', {
      quoteId: quote?.id,
      quoteNumber: quote?.quoteNumber,
      total: quote?.total,
      currency: quote?.currency,
    });
  }

  @OnEvent('quote.sent', { async: true })
  async onQuoteSent(p: QuoteSentPayload) {
    const quote = p.quote as { id?: string; contactId?: string | null; quoteNumber?: string; total?: unknown; currency?: string | null } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.sent', {
      quoteId: quote?.id,
      quoteNumber: quote?.quoteNumber,
      total: quote?.total,
      currency: quote?.currency,
    });
  }

  @OnEvent('quote.accepted', { async: true })
  async onQuoteAccepted(p: QuoteAcceptedPayload) {
    const quote = p.quote as { id?: string; contactId?: string | null; quoteNumber?: string; total?: unknown } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.accepted', {
      quoteId: quote?.id,
      quoteNumber: quote?.quoteNumber,
      total: quote?.total,
      acceptedAt: p.acceptedAt,
      source: p.source,
    });
  }

  @OnEvent('quote.rejected', { async: true })
  async onQuoteRejected(p: QuoteRejectedPayload) {
    const quote = p.quote as { id?: string; contactId?: string | null; quoteNumber?: string } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.rejected', {
      quoteId: quote?.id,
      quoteNumber: quote?.quoteNumber,
      rejectedAt: p.rejectedAt,
      reason: p.reason ?? null,
      source: p.source,
    });
  }

  @OnEvent('quote.viewed', { async: true })
  async onQuoteViewed(p: QuoteViewedPayload) {
    const quote = p.quote as { id?: string; contactId?: string | null; quoteNumber?: string } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.viewed', {
      quoteId: quote?.id,
      quoteNumber: quote?.quoteNumber,
      viewedAt: p.viewedAt,
      source: p.source,
    });
  }

  @OnEvent('quote.stale', { async: true })
  async onQuoteStale(p: QuoteStalePayload) {
    const quote = p.quote as { id?: string; contactId?: string | null } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.stale', {
      quoteId: quote?.id,
      sentAt: p.sentAt,
      daysSinceSent: p.daysSinceSent,
    });
  }

  @OnEvent('quote.converted', { async: true })
  async onQuoteConverted(p: QuoteConvertedPayload) {
    const quote = p.quote as { id?: string; contactId?: string | null } | undefined;
    const invoice = p.invoice as { id?: string; invoiceNumber?: string; total?: unknown } | undefined;
    await this.log(p.businessId, quote?.contactId ?? null, 'quote.converted', {
      quoteId: quote?.id,
      invoiceId: invoice?.id,
      invoiceNumber: invoice?.invoiceNumber,
      total: invoice?.total,
    });
  }

  // ---- invoice.* ----
  @OnEvent('invoice.created', { async: true })
  async onInvoiceCreated(p: InvoiceCreatedPayload) {
    const inv = p.invoice as { id?: string; contactId?: string | null; invoiceNumber?: string; total?: unknown; currency?: string | null } | undefined;
    const type = p.source === 'booking' ? 'invoice.from_booking' : 'invoice.created';
    await this.log(p.businessId, inv?.contactId ?? null, type, {
      invoiceId: inv?.id,
      invoiceNumber: inv?.invoiceNumber,
      total: inv?.total,
      currency: inv?.currency,
      source: p.source,
      quoteId: p.quoteId ?? null,
    });
  }

  /**
   * Booking → invoice path. Bookings emits `booking.invoice_created`
   * after creating an invoice from a service; we own the timeline write
   * here so bookings doesn't have to call CRM directly. Idempotent via
   * the shared content-based dedupe in this.log().
   */
  @OnEvent('booking.invoice_created', { async: true })
  async onBookingInvoiceCreated(p: BookingInvoiceCreatedPayload) {
    const inv = p.invoice as { id?: string; invoiceNumber?: string; total?: unknown; currency?: string | null } | undefined;
    const bk = p.booking as { id?: string; contactId?: string | null } | undefined;
    await this.log(p.businessId, bk?.contactId ?? null, 'invoice.from_booking', {
      bookingId: bk?.id,
      invoiceId: inv?.id,
      invoiceNumber: inv?.invoiceNumber,
      total: inv?.total,
      currency: inv?.currency,
      source: 'booking',
    });
  }

  @OnEvent('invoice.sent', { async: true })
  async onInvoiceSent(p: InvoiceStatusPayload) {
    const inv = p.invoice as { id?: string; contactId?: string | null; invoiceNumber?: string; total?: unknown; currency?: string | null; dueDate?: unknown } | undefined;
    await this.log(p.businessId, inv?.contactId ?? null, 'invoice.sent', {
      invoiceId: inv?.id,
      invoiceNumber: inv?.invoiceNumber,
      total: inv?.total,
      currency: inv?.currency,
      dueDate: inv?.dueDate,
    });
  }

  @OnEvent('invoice.overdue', { async: true })
  async onInvoiceOverdue(p: InvoiceStatusPayload) {
    const inv = p.invoice as { id?: string; contactId?: string | null; invoiceNumber?: string; total?: unknown; currency?: string | null } | undefined;
    await this.log(p.businessId, inv?.contactId ?? null, 'invoice.overdue', {
      invoiceId: inv?.id,
      invoiceNumber: inv?.invoiceNumber,
      total: inv?.total,
      currency: inv?.currency,
    });
  }

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(p: InvoicePaidPayload) {
    const inv = p.invoice as { id?: string; contactId?: string | null; invoiceNumber?: string; total?: unknown; currency?: string | null; paidAt?: unknown } | undefined;
    await this.log(p.businessId, inv?.contactId ?? null, 'invoice.paid', {
      invoiceId: inv?.id,
      invoiceNumber: inv?.invoiceNumber,
      total: inv?.total,
      currency: inv?.currency,
      paidAt: inv?.paidAt,
    });
  }

  // ---- payment.* (connector-driven) ----
  @OnEvent('payment.received', { async: true })
  async onPaymentReceived(p: PaymentReceivedPayload) {
    if (!p.contactId) return;
    await this.log(p.businessId, p.contactId, 'payment.received', {
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      invoiceId: p.invoiceId ?? null,
      externalId: p.externalId ?? null,
    });
  }

  @OnEvent('payment.failed', { async: true })
  async onPaymentFailed(p: PaymentFailedPayload) {
    const contactId = await this.contactFromInvoice(p.businessId, p.invoiceId ?? null);
    if (!contactId) return;
    await this.log(p.businessId, contactId, 'payment.failed', {
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      error: p.error,
      invoiceId: p.invoiceId ?? null,
    });
  }

  // ---- recurring_invoice.* ----
  @OnEvent('recurring_invoice.created', { async: true })
  async onRecurringCreated(p: RecurringInvoiceCreatedPayload) {
    if (!p.recurringInvoice?.contactId) return;
    await this.log(p.businessId, p.recurringInvoice.contactId, 'recurring_invoice.created', {
      recurringInvoiceId: p.recurringInvoice.id,
      name: p.recurringInvoice.name,
    });
  }

  @OnEvent('recurring_invoice.updated', { async: true })
  async onRecurringUpdated(p: RecurringInvoiceUpdatedPayload) {
    if (!p.recurringInvoice?.contactId) return;
    await this.log(p.businessId, p.recurringInvoice.contactId, 'recurring_invoice.updated', {
      recurringInvoiceId: p.recurringInvoice.id,
      name: p.recurringInvoice.name,
    });
  }

  @OnEvent('recurring_invoice.deleted', { async: true })
  async onRecurringDeleted(p: RecurringInvoiceDeletedPayload) {
    if (!p.contactId) return;
    await this.log(p.businessId, p.contactId, 'recurring_invoice.deleted', {
      recurringInvoiceId: p.recurringInvoiceId,
    });
  }

  @OnEvent('recurring_invoice.generated', { async: true })
  async onRecurringGenerated(p: RecurringInvoiceGeneratedPayload) {
    const invoice = p.invoice as { id?: string; invoiceNumber?: string; total?: unknown; contactId?: string | null } | undefined;
    const contactId = p.recurringInvoice?.contactId ?? invoice?.contactId ?? null;
    if (!contactId) return;
    await this.log(p.businessId, contactId, 'recurring_invoice.generated', {
      recurringInvoiceId: p.recurringInvoice?.id,
      invoiceId: invoice?.id,
      invoiceNumber: invoice?.invoiceNumber,
      total: invoice?.total,
    });
  }

  @OnEvent('recurring_invoice.failed', { async: true })
  async onRecurringFailed(p: RecurringInvoiceFailedPayload) {
    if (!p.recurringInvoice?.contactId) return;
    const errMsg = typeof p.error === 'string' ? p.error : String(p.error ?? '');
    await this.log(p.businessId, p.recurringInvoice.contactId, 'recurring_invoice.failed', {
      recurringInvoiceId: p.recurringInvoice.id,
      error: errMsg.slice(0, 500),
    });
  }

  // ---- store_order.* ----
  @OnEvent('store_order.paid', { async: true })
  async onStoreOrderPaid(p: StoreOrderPaidPayload) {
    const order = p.order as { id?: string; customerEmail?: string | null; total?: unknown; currency?: string | null } | undefined;
    if (!order?.id) return;
    const contactId = await this.contactFromOrderEmail(p.businessId, order.customerEmail ?? null);
    if (!contactId) return;
    await this.log(p.businessId, contactId, 'store_order.paid', {
      orderId: order.id,
      total: order.total,
      currency: order.currency,
    });
  }

  @OnEvent('store_order.refunded', { async: true })
  async onStoreOrderRefunded(p: StoreOrderRefundedPayload) {
    const order = p.order as { id?: string; customerEmail?: string | null; currency?: string | null } | undefined;
    if (!order?.id) return;
    const contactId = await this.contactFromOrderEmail(p.businessId, order.customerEmail ?? null);
    if (!contactId) return;
    await this.log(p.businessId, contactId, 'store_order.refunded', {
      orderId: order.id,
      refundAmount: p.refundAmount ?? null,
      currency: order.currency,
    });
  }

  @OnEvent('store_order.fulfillment_routed', { async: true })
  async onFulfillmentRouted(p: FulfillmentRoutedPayload) {
    if (!p.contactId) return;
    await this.log(p.businessId, p.contactId, 'store_order.fulfillment_routed', {
      orderId: p.orderId,
      strategies: p.strategies,
      routeCount: p.routeCount,
    });
  }

  @OnEvent('store_order.routing_failed', { async: true })
  async onRoutingFailed(p: StoreOrderRoutingFailedPayload) {
    if (!p.contactId) return;
    await this.log(p.businessId, p.contactId, 'store_order.fulfillment_routed', {
      orderId: p.orderId,
      failed: true,
      error: p.error,
    });
  }

  private async contactFromOrderEmail(businessId: string, email: string | null) {
    if (!email) return null;
    try {
      const contact = await this.prisma.client.contact.findFirst({
        where: { businessId, email, deletedAt: null },
        select: { id: true },
      });
      return contact?.id ?? null;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  private async log(
    businessId: string,
    contactId: string | undefined | null,
    type: ContactEventType,
    data: Record<string, unknown>,
  ) {
    if (!businessId || !contactId) return;
    const entityId =
      data.invoiceId ??
      data.quoteId ??
      data.recurringInvoiceId ??
      data.orderId ??
      data.externalId ??
      `${type}:${Date.now()}`;
    const dedupeKey = `rev:${type}:${entityId}`;
    try {
      // Content-based dedupe: any same-type event for this contact in the
      // last 10 minutes that references the same entity (by dedupeKey, or by
      // matching id field in legacy rows that were written directly by
      // commerce/bookings before the central listener took over) is treated
      // as a duplicate. This keeps us idempotent against both event-bus
      // re-emits AND direct-write callers we have not yet migrated.
      const recents = await this.prisma.client.contactEvent.findMany({
        where: {
          businessId,
          contactId,
          type,
          createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
      const matchingId = String(entityId);
      const isDup = recents.some((row) => {
        const rd = (row.data ?? null) as Record<string, unknown> | null;
        if (!rd) return false;
        if (rd.dedupeKey === dedupeKey) return true;
        for (const k of ['invoiceId', 'quoteId', 'recurringInvoiceId', 'orderId', 'externalId']) {
          if (rd[k] != null && String(rd[k]) === matchingId) return true;
        }
        return false;
      });
      if (isDup) return;
      await this.timeline.logEvent(
        businessId,
        contactId,
        type,
        { ...data, dedupeKey },
        { actorType: 'SYSTEM', source: 'event-bus' },
      );
      await this.insights.markStale(businessId, contactId);
    } catch (err) {
      this.logger.warn(
        `revenue-event log failed for ${type} contact=${contactId}: ${(err as Error).message}`,
      );
    }
  }

  private async contactFromInvoice(businessId: string, invoiceId?: string | null) {
    if (!invoiceId) return null;
    try {
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, businessId },
        select: { contactId: true },
      });
      return inv?.contactId ?? null;
    } catch {
      return null;
    }
  }
}
