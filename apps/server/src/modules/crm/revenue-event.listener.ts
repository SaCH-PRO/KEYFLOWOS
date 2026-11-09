import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ContactEventType } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { ContactInsightService } from './contact-insight.service';
import { CrmService } from './crm.service';
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
 * FOLLOW3-A9 review (SEC-A9-2 / CR-A9-1): the invoice status transitions
 * whose timeline entries are deduped per transition, not per invoice (see
 * log()): each names the type that takes it back and the data field that
 * says when it happened.
 */
const INVOICE_TRANSITIONS: Partial<Record<ContactEventType, { counter: ContactEventType; mark: string }>> = {
  'invoice.paid': { counter: 'invoice.reopened', mark: 'paidAt' },
  'invoice.reopened': { counter: 'invoice.paid', mark: 'reopenedAt' },
};

/**
 * V1-55b-FEED-DEDUPE-REST (V55-07; D-08: Activity is the user-visible feed).
 * The contact events this listener logs from a bus event whose feed row
 * ActivityEventListener writes on the same emit: the ContactEvent is kept on
 * the contact's timeline, and its Activity copy (an actorless second feed row
 * for the event) is not written. invoice.paid: ActivityEventListener.onInvoicePaid
 * writes the paid row ('Payment received').
 */
const FEED_ROW_BY_ACTIVITY_LISTENER: ReadonlySet<ContactEventType> = new Set<ContactEventType>(['invoice.paid']);

/** A transition time (Date or its JSON string) as epoch ms, or null when absent / unreadable. */
function transitionTime(v: unknown): number | null {
  if (v == null || v === '') return null;
  const t = new Date(v as string | number | Date).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Central listener that turns revenue/operations events on the bus into
 * canonical ContactEvent rows on the contact timeline (and triggers the
 * insight snapshot to recompute). Every other module emits — only this
 * listener writes timeline rows for these events, so we have one place
 * to enforce idempotency and shape.
 *
 * Idempotency: each event carries (or is given) a stable `dedupeKey`
 * `rev:<type>:<entityId>`; before writing we check the contact's last 25
 * events of the same type for a matching key in `data.dedupeKey`
 * (invoice.paid / invoice.reopened: per transition, INVOICE_TRANSITIONS).
 */
@Injectable()
export class RevenueEventListener {
  private readonly logger = new Logger(RevenueEventListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(ContactInsightService) private readonly insights: ContactInsightService,
    @Inject(CrmService) private readonly crm: CrmService,
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
    await this.advanceLifecycleOnPaid(p.businessId, inv?.id ?? null);
  }

  /**
   * PR196-CRM-LIFECYCLE (owner ruling D-81): a paid invoice moves its own
   * contact LEAD/PROSPECT -> CLIENT. Only invoice.paid does (not
   * booking.confirmed, store_order.paid or payment.received). The contact is the
   * invoice row's, read in the event's business, never the payload's contactId;
   * the move is CrmService's audited compare-and-set, so replays and concurrent
   * deliveries move it once, and a later invoice.reopened does not move it back.
   */
  private async advanceLifecycleOnPaid(businessId: string, invoiceId: string | null) {
    if (!businessId || !invoiceId) return;
    try {
      const invoice = await this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, businessId },
        select: { contactId: true, invoiceNumber: true },
      });
      if (!invoice?.contactId) return;
      await this.crm.advanceToClientOnInvoicePaid({
        businessId,
        contactId: invoice.contactId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
      });
    } catch (err) {
      this.logger.warn(`D-81 lifecycle advance failed for invoice=${invoiceId}: ${(err as Error).message}`);
    }
  }

  /**
   * FOLLOW3-A9: a refund's D-14 reopen (PAID / PARTIALLY_PAID -> SENT,
   * InvoiceWorkflowService.reconcileFromPayments) is logged beside the
   * invoice.paid entry it takes back, so the timeline does not keep a
   * refunded invoice as paid. The write also marks the insight stale (log()).
   */
  @OnEvent('invoice.reopened', { async: true })
  async onInvoiceReopened(p: InvoiceStatusPayload & { previousStatus?: string }) {
    const inv = p.invoice as { id?: string; contactId?: string | null; invoiceNumber?: string; total?: unknown; currency?: string | null; updatedAt?: unknown } | undefined;
    await this.log(p.businessId, inv?.contactId ?? null, 'invoice.reopened', {
      invoiceId: inv?.id,
      invoiceNumber: inv?.invoiceNumber,
      total: inv?.total,
      currency: inv?.currency,
      previousStatus: p.previousStatus ?? null,
      status: p.status,
      // FOLLOW3-A9 review (SEC-A9-2 / CR-A9-1): the reopen write's time names
      // this transition, as paidAt names an invoice.paid one (see log()).
      reopenedAt: inv?.updatedAt ?? null,
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
      //
      // FOLLOW3-A9 review (SEC-A9-2 / CR-A9-1): invoice.paid and
      // invoice.reopened are status transitions, and the reconcile writes
      // each one compare-and-set, so pay -> full refund -> pay again inside
      // the window is three real moves. A same-type row of the invoice is a
      // duplicate only when it is this transition: no counter-transition
      // (invoice.reopened for a paid, invoice.paid for a reopen) of the
      // invoice was logged after it, and its transition time (paidAt /
      // reopenedAt) is this event's when both carry one.
      const transition = INVOICE_TRANSITIONS[type];
      const recents = await this.prisma.client.contactEvent.findMany({
        where: {
          businessId,
          contactId,
          type: transition ? { in: [type, transition.counter] } : type,
          createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
        },
        orderBy: { createdAt: 'desc' },
        take: transition ? 50 : 25,
      });
      const matchingId = String(entityId);
      const sameEntity = (rd: Record<string, unknown>) => {
        if (rd.dedupeKey === dedupeKey) return true;
        for (const k of ['invoiceId', 'quoteId', 'recurringInvoiceId', 'orderId', 'externalId']) {
          if (rd[k] != null && String(rd[k]) === matchingId) return true;
        }
        return false;
      };
      const dataOf = (row: { data?: unknown }) => (row.data ?? null) as Record<string, unknown> | null;
      let isDup: boolean;
      if (!transition) {
        isDup = recents.some((row) => {
          const rd = dataOf(row);
          return rd ? sameEntity(rd) : false;
        });
      } else {
        // Newest first: the latest counter-transition of this invoice, if any.
        const lastCounter = recents.find((row) => {
          const rd = dataOf(row);
          return row.type === transition.counter && rd != null && sameEntity(rd);
        });
        const at = transitionTime(data[transition.mark]);
        isDup = recents.some((row) => {
          const rd = dataOf(row);
          if (row.type !== type || !rd || !sameEntity(rd)) return false;
          if (lastCounter && !(new Date(row.createdAt).getTime() > new Date(lastCounter.createdAt).getTime())) return false;
          const rowAt = transitionTime(rd[transition.mark]);
          return at == null || rowAt == null || at === rowAt;
        });
      }
      if (isDup) return;
      await this.timeline.logEvent(
        businessId,
        contactId,
        type,
        { ...data, dedupeKey },
        { actorType: 'SYSTEM', source: 'event-bus', ...(FEED_ROW_BY_ACTIVITY_LISTENER.has(type) ? { feedCopy: false } : {}) },
      );
      await this.insights.markStale(businessId, contactId);
    } catch (err: any) {
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
