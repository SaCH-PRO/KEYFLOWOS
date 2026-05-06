import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import type {
  InvoicePaidPayload,
  InvoiceStatusPayload,
  PaymentFailedPayload,
  QuoteAcceptedPayload,
  QuoteSentPayload,
  QuoteStalePayload,
  RevenueActionCreatedPayload,
  RevenueActionCompletedPayload,
  StoreOrderRoutingFailedPayload,
} from '../../core/event-bus/events.types';

const TICK_MS = 5 * 60 * 1000;

export type RevenueActionType =
  | 'OVERDUE_INVOICE'
  | 'STALE_QUOTE'
  | 'ACCEPTED_QUOTE_NO_INVOICE'
  | 'PAID_INVOICE_NO_RECEIPT'
  | 'RECURRING_FAILURE'
  | 'DORMANT_HIGH_VALUE'
  // FIN8 — finance intelligence detectors mirrored into the same queue.
  | 'FIN_CASHFLOW_RISK'
  | 'FIN_SLOW_PAYER'
  | 'FIN_MARGIN_DECLINE'
  | 'FIN_OVERSPENDING'
  | 'FIN_MISSING_RECEIPT'
  | 'FIN_UNCATEGORISED'
  | 'FIN_TAX_RESERVE_GAP'
  | 'FIN_DUPLICATE_EXPENSE';

export interface RevenueActionRecommendation {
  explanation: string;
  suggestedAction: string;
  draft?: { subject?: string; body?: string };
  source: 'ai' | 'template';
}

interface UpsertInput {
  businessId: string;
  type: RevenueActionType;
  title: string;
  detail?: string | null;
  priority: number;
  contactId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  amountAtRisk?: number | null;
  dueAt?: Date | null;
  recommendation?: RevenueActionRecommendation | null;
}

@Injectable()
export class RevenueActionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevenueActionService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[RevenueActionService] Scheduler disabled via env');
      return;
    }
    this.logger.log(`[RevenueActionService] Starting reconciler — every ${TICK_MS / 60000}m`);
    this.intervalRef = setInterval(() => {
      void this.reconcileAll().catch((e) =>
        this.logger.error(`reconcile tick failed: ${(e as Error).message}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  // ---------- Event triggers ----------

  @OnEvent('invoice.overdue', { async: true })
  async onInvoiceOverdue(payload: InvoiceStatusPayload) {
    await this.generateForOverdueInvoice(payload.businessId, payload.invoice.id);
  }

  @OnEvent('quote.stale', { async: true })
  async onQuoteStale(payload: QuoteStalePayload) {
    await this.generateForStaleQuote(payload.businessId, payload.quote.id);
  }

  @OnEvent('quote.sent', { async: true })
  async onQuoteSent(payload: QuoteSentPayload) {
    await this.generateQuoteSentFollowUp(payload.businessId, payload.quote.id);
  }

  @OnEvent('store_order.routing_failed', { async: true })
  async onStoreOrderRoutingFailed(payload: StoreOrderRoutingFailedPayload) {
    await this.generateForRoutingFailure(
      payload.businessId,
      payload.orderId,
      payload.contactId ?? null,
      payload.error,
    );
  }

  @OnEvent('quote.accepted', { async: true })
  async onQuoteAccepted(payload: QuoteAcceptedPayload) {
    // Slight delay isn't necessary; we already check invoiceId at gen time.
    await this.generateForAcceptedQuote(payload.businessId, payload.quote.id);
  }

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: InvoicePaidPayload) {
    await this.generateForPaidInvoiceMissingReceipt(payload.businessId, payload.invoice.id);
  }

  @OnEvent('payment.failed', { async: true })
  async onPaymentFailed(payload: PaymentFailedPayload) {
    if (!payload.invoiceId) return;
    // Only fire RECURRING_FAILURE when the invoice is actually tied to a
    // recurring schedule — one-off failed payments are handled by other
    // surfaces (overdue invoice action, payment retries).
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: payload.invoiceId, businessId: payload.businessId, deletedAt: null },
      select: { recurringInvoiceId: true },
    });
    if (!inv?.recurringInvoiceId) return;
    await this.generateForRecurringFailure(payload.businessId, inv.recurringInvoiceId, 'recurring');
  }

  // ---------- Reconciler (5-min sweep) ----------

  /**
   * Sweeps every business with recent commerce activity and runs all six
   * generators. Idempotent: each generator either inserts a new row or
   * skips via the `(businessId, type, relatedType, relatedId)` unique key.
   */
  async reconcileAll(): Promise<{ businessesScanned: number; actionsCreated: number }> {
    // Pull every business that has at least one open commerce object so we
    // don't fan out across the entire businesses table.
    const businesses = await this.prisma.client.business.findMany({
      where: {
        deletedAt: null,
        OR: [
          { invoices: { some: { deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PAID', 'PARTIALLY_PAID'] } } } },
          { quotes: { some: { deletedAt: null, status: { in: ['SENT', 'ACCEPTED'] } } } },
          { recurringInvoices: { some: { isActive: true } } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    let created = 0;
    for (const { id: businessId } of businesses) {
      try {
        created += await this.reconcileBusiness(businessId);
      } catch (e) {
        this.logger.warn(`reconcile failed for ${businessId}: ${(e as Error).message}`);
      }
    }
    if (created > 0) {
      this.logger.log(
        `[RevenueActionService] Reconciler scanned ${businesses.length} businesses, created ${created} actions`,
      );
    }
    // Auto-unsnooze: bring SNOOZED rows back to PENDING when their snooze
    // window has elapsed so they re-appear in the inbox.
    await this.prisma.client.revenueAction.updateMany({
      where: { status: 'SNOOZED', snoozedUntil: { not: null, lte: new Date() } },
      data: { status: 'PENDING', snoozedUntil: null },
    });
    return { businessesScanned: businesses.length, actionsCreated: created };
  }

  async reconcileBusiness(businessId: string): Promise<number> {
    let created = 0;
    // 1. OVERDUE invoices
    const overdue = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, status: 'OVERDUE' },
      select: { id: true },
      take: 200,
    });
    for (const inv of overdue) created += (await this.generateForOverdueInvoice(businessId, inv.id)) ? 1 : 0;

    // 2. STALE quotes (rely on commerce.getStaleQuotes via scheduler — but
    //    also catch here: SENT quote, sentAt > 7d, no view/accept/reject and
    //    no recent follow-up.)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    const stale = await this.prisma.client.quote.findMany({
      where: {
        businessId, deletedAt: null, status: 'SENT',
        sentAt: { lte: sevenDaysAgo },
        viewedAt: null, acceptedAt: null, rejectedAt: null,
        OR: [{ lastFollowUpAt: null }, { lastFollowUpAt: { lte: sevenDaysAgo } }],
      },
      select: { id: true },
      take: 100,
    });
    for (const q of stale) created += (await this.generateForStaleQuote(businessId, q.id)) ? 1 : 0;

    // 3. Accepted quotes that never got an invoice
    const acceptedNoInvoice = await this.prisma.client.quote.findMany({
      where: { businessId, deletedAt: null, status: 'ACCEPTED', invoiceId: null },
      select: { id: true },
      take: 100,
    });
    for (const q of acceptedNoInvoice) created += (await this.generateForAcceptedQuote(businessId, q.id)) ? 1 : 0;

    // 4. Paid invoices missing a receipt notification log entry
    const paid = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, status: 'PAID', receiptSentAt: null },
      select: { id: true },
      take: 100,
    });
    for (const inv of paid) created += (await this.generateForPaidInvoiceMissingReceipt(businessId, inv.id)) ? 1 : 0;

    // 5. Recurring failures (recent)
    const failed = await this.prisma.client.recurringInvoice.findMany({
      where: { businessId, isActive: true, failureCount: { gt: 0 } },
      select: { id: true },
      take: 100,
    });
    for (const r of failed) created += (await this.generateForRecurringFailure(businessId, r.id, 'recurring')) ? 1 : 0;

    // 6. High-value dormant customers
    created += await this.generateForDormantHighValue(businessId);
    return created;
  }

  // ---------- Generators ----------

  async generateForOverdueInvoice(businessId: string, invoiceId: string): Promise<boolean> {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: { contact: true },
    });
    if (!inv || inv.status !== 'OVERDUE') return false;
    const days = inv.dueDate
      ? Math.max(0, Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86_400_000))
      : 0;
    const contactName = formatContactName(inv.contact);
    const recommendation = await this.draftRecommendation(businessId, {
      kind: 'OVERDUE_INVOICE',
      contactName,
      currency: inv.currency,
      amount: Number(inv.total ?? 0),
      reference: inv.invoiceNumber ?? inv.id.slice(0, 8),
      daysOverdue: days,
    });
    return this.upsertAction({
      businessId,
      type: 'OVERDUE_INVOICE',
      title: `Chase overdue invoice #${inv.invoiceNumber ?? inv.id.slice(0, 8)}`,
      detail: `${contactName} is ${days} day${days === 1 ? '' : 's'} late on ${inv.currency} ${Number(inv.total).toFixed(2)}.`,
      priority: days >= 14 ? 1 : 2,
      contactId: inv.contactId,
      relatedType: 'invoice',
      relatedId: inv.id,
      amountAtRisk: Number(inv.total ?? 0),
      dueAt: inv.dueDate,
      recommendation,
    });
  }

  async generateForStaleQuote(businessId: string, quoteId: string): Promise<boolean> {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId, deletedAt: null },
      include: { contact: true },
    });
    if (!quote || quote.status !== 'SENT' || quote.acceptedAt || quote.rejectedAt) return false;
    const sentAt = quote.sentAt ?? quote.createdAt;
    const days = Math.max(0, Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000));
    const contactName = formatContactName(quote.contact);
    const recommendation = await this.draftRecommendation(businessId, {
      kind: 'STALE_QUOTE',
      contactName,
      currency: quote.currency,
      amount: Number(quote.total ?? 0),
      reference: quote.quoteNumber ?? quote.id.slice(0, 8),
      daysSinceSent: days,
    });
    return this.upsertAction({
      businessId,
      type: 'STALE_QUOTE',
      title: `Follow up on stale quote #${quote.quoteNumber ?? quote.id.slice(0, 8)}`,
      detail: `${contactName} hasn't engaged with this quote in ${days} day${days === 1 ? '' : 's'}.`,
      priority: 2,
      contactId: quote.contactId,
      relatedType: 'quote',
      relatedId: quote.id,
      amountAtRisk: Number(quote.total ?? 0),
      recommendation,
    });
  }

  /**
   * Quote-sent follow-up: schedule a STALE_QUOTE-style action with a 3-day
   * dueAt so the owner sees a reminder unless the quote progresses. Idempotent
   * via the (businessId, type, relatedType, relatedId) unique key.
   */
  async generateQuoteSentFollowUp(businessId: string, quoteId: string): Promise<boolean> {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId, deletedAt: null },
      include: { contact: true },
    });
    if (!quote || quote.status !== 'SENT' || quote.acceptedAt || quote.rejectedAt) return false;
    const contactName = formatContactName(quote.contact);
    const ref = quote.quoteNumber ?? quote.id.slice(0, 8);
    return this.upsertAction({
      businessId,
      type: 'STALE_QUOTE',
      title: `Follow up on quote #${ref}`,
      detail: `${contactName} was sent quote #${ref}. Reach out in 3 days if there is no movement.`,
      priority: 2,
      contactId: quote.contactId,
      relatedType: 'quote',
      relatedId: quote.id,
      amountAtRisk: Number(quote.total ?? 0),
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      recommendation: null,
    });
  }

  async generateForRoutingFailure(
    businessId: string,
    orderId: string,
    contactId: string | null,
    error: string,
  ): Promise<boolean> {
    return this.upsertAction({
      businessId,
      type: 'OVERDUE_INVOICE',
      title: `Fulfillment routing failed for order ${orderId.slice(0, 8)}`,
      detail: `The system could not route this order automatically. Reason: ${error.slice(0, 200)}`,
      priority: 1,
      contactId,
      relatedType: 'store_order',
      relatedId: orderId,
      amountAtRisk: null,
      recommendation: null,
    });
  }

  async generateForAcceptedQuote(businessId: string, quoteId: string): Promise<boolean> {
    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId, deletedAt: null },
      include: { contact: true },
    });
    if (!quote || quote.status !== 'ACCEPTED' || quote.invoiceId) return false;
    const contactName = formatContactName(quote.contact);
    const recommendation = await this.draftRecommendation(businessId, {
      kind: 'ACCEPTED_QUOTE_NO_INVOICE',
      contactName,
      currency: quote.currency,
      amount: Number(quote.total ?? 0),
      reference: quote.quoteNumber ?? quote.id.slice(0, 8),
    });
    return this.upsertAction({
      businessId,
      type: 'ACCEPTED_QUOTE_NO_INVOICE',
      title: `Convert accepted quote #${quote.quoteNumber ?? quote.id.slice(0, 8)} to an invoice`,
      detail: `${contactName} accepted this quote but no invoice has been issued yet.`,
      priority: 1,
      contactId: quote.contactId,
      relatedType: 'quote',
      relatedId: quote.id,
      amountAtRisk: Number(quote.total ?? 0),
      recommendation,
    });
  }

  async generateForPaidInvoiceMissingReceipt(businessId: string, invoiceId: string): Promise<boolean> {
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      include: { contact: true },
    });
    if (!inv || inv.status !== 'PAID') return false;
    if (inv.receiptSentAt) return false;
    const recentLogWhere: Prisma.CustomerNotificationLogWhereInput = {
      businessId,
      type: 'invoice.receipt_sent',
      templateData: { path: ['invoiceId'], equals: inv.id },
      status: { in: ['SENT', 'QUEUED'] },
    };
    const recentLog = await this.prisma.client.customerNotificationLog.findFirst({
      where: recentLogWhere,
      select: { id: true },
    });
    if (recentLog) return false;
    const contactName = formatContactName(inv.contact);
    const recommendation = await this.draftRecommendation(businessId, {
      kind: 'PAID_INVOICE_NO_RECEIPT',
      contactName,
      currency: inv.currency,
      amount: Number(inv.total ?? 0),
      reference: inv.invoiceNumber ?? inv.id.slice(0, 8),
    });
    return this.upsertAction({
      businessId,
      type: 'PAID_INVOICE_NO_RECEIPT',
      title: `Send receipt for invoice #${inv.invoiceNumber ?? inv.id.slice(0, 8)}`,
      detail: `${contactName} paid but hasn't received a receipt.`,
      priority: 3,
      contactId: inv.contactId,
      relatedType: 'invoice',
      relatedId: inv.id,
      amountAtRisk: 0,
      recommendation,
    });
  }

  async generateForRecurringFailure(
    businessId: string,
    relatedId: string,
    relatedType: 'invoice' | 'recurring' = 'invoice',
  ): Promise<boolean> {
    let recurring: { id: string; name: string; failureCount: number; lastError: string | null; contactId: string; total: number; currency: string } | null = null;
    let scheduleName = 'recurring schedule';
    let amount = 0;
    let currency = 'TTD';
    let contactId: string | null = null;
    if (relatedType === 'invoice') {
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id: relatedId, businessId, deletedAt: null },
        include: { recurringInvoice: { include: { contact: true } } },
      });
      // Only emit a RECURRING_FAILURE when the invoice is actually tied to
      // a recurring schedule — one-off invoice failures are handled by the
      // overdue-invoice action surface.
      if (!inv?.recurringInvoice) return false;
      recurring = {
        id: inv.recurringInvoice.id,
        name: inv.recurringInvoice.name,
        failureCount: inv.recurringInvoice.failureCount,
        lastError: inv.recurringInvoice.lastError,
        contactId: inv.recurringInvoice.contactId,
        total: Number(inv.recurringInvoice.total),
        currency: inv.recurringInvoice.currency,
      };
      scheduleName = inv.recurringInvoice.name;
      amount = Number(inv.total ?? inv.recurringInvoice.total ?? 0);
      currency = inv.currency;
      contactId = inv.contactId;
    } else {
      const r = await this.prisma.client.recurringInvoice.findFirst({
        where: { id: relatedId, businessId },
        include: { contact: true },
      });
      if (!r || r.failureCount === 0) return false;
      recurring = {
        id: r.id, name: r.name, failureCount: r.failureCount, lastError: r.lastError,
        contactId: r.contactId, total: Number(r.total), currency: r.currency,
      };
      scheduleName = r.name;
      amount = Number(r.total);
      currency = r.currency;
      contactId = r.contactId;
    }
    if (!recurring) return false;
    const recommendation = await this.draftRecommendation(businessId, {
      kind: 'RECURRING_FAILURE',
      contactName: '',
      currency,
      amount,
      reference: scheduleName,
      lastError: recurring.lastError ?? null,
      failureCount: recurring.failureCount,
    });
    return this.upsertAction({
      businessId,
      type: 'RECURRING_FAILURE',
      title: `Recurring "${scheduleName}" needs attention`,
      detail: `Failed ${recurring.failureCount} time${recurring.failureCount === 1 ? '' : 's'}. Last error: ${recurring.lastError ?? 'unknown'}`,
      priority: 1,
      contactId,
      relatedType: 'recurring',
      relatedId: recurring.id,
      amountAtRisk: amount,
      recommendation,
    });
  }

  async generateForDormantHighValue(businessId: string): Promise<number> {
    // Use the canonical CRM relationshipHealth flag (set by RHM jobs in #431)
    // and the lifetime revenue threshold to surface high-value dormant clients.
    const candidates = await this.prisma.client.contact.findMany({
      where: {
        businessId,
        deletedAt: null,
        relationshipHealth: 'DORMANT',
      },
      select: {
        id: true, firstName: true, lastName: true, email: true, displayName: true,
        invoices: { where: { status: 'PAID' }, select: { total: true, paidAt: true } },
      },
      take: 200,
    });
    const HIGH_VALUE = 1000;
    let created = 0;
    for (const c of candidates) {
      const lifetime = c.invoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
      if (lifetime < HIGH_VALUE) continue;
      const lastPaid = c.invoices
        .map((i) => (i.paidAt ? new Date(i.paidAt).getTime() : 0))
        .reduce((m, t) => Math.max(m, t), 0);
      const daysSince = lastPaid
        ? Math.max(0, Math.floor((Date.now() - lastPaid) / 86_400_000))
        : null;
      const contactName = formatContactName(c);
      const recommendation = await this.draftRecommendation(businessId, {
        kind: 'DORMANT_HIGH_VALUE',
        contactName,
        currency: 'TTD',
        amount: lifetime,
        daysSinceContact: daysSince,
      });
      const ok = await this.upsertAction({
        businessId,
        type: 'DORMANT_HIGH_VALUE',
        title: `Reconnect with ${contactName}`,
        detail: `Lifetime revenue ${Math.round(lifetime).toLocaleString()} but no activity in ${daysSince ?? '90+'} days.`,
        priority: 2,
        contactId: c.id,
        relatedType: 'contact',
        relatedId: c.id,
        amountAtRisk: lifetime,
        recommendation,
      });
      if (ok) created++;
    }
    return created;
  }

  // ---------- Persistence ----------

  /**
   * Public surface so other modules (e.g. FIN8 finance intelligence)
   * can mirror their detections into the same RevenueAction queue —
   * preserving idempotency and the "never resurrect a COMPLETED /
   * DISMISSED row" guarantee that the private `upsertAction` enforces.
   *
   * Returns `{ created, actionId }` so the caller can persist a foreign
   * key back to the mirrored row.
   */
  async upsertExternal(
    input: UpsertInput,
  ): Promise<{ created: boolean; actionId: string | null }> {
    const created = await this.upsertAction(input);
    const row = await this.prisma.client.revenueAction
      .findUnique({
        where: {
          businessId_type_relatedType_relatedId: {
            businessId: input.businessId,
            type: input.type,
            relatedType: input.relatedType ?? '',
            relatedId: input.relatedId ?? '',
          },
        },
        select: { id: true },
      })
      .catch(() => null);
    return { created, actionId: row?.id ?? null };
  }

  private async upsertAction(input: UpsertInput): Promise<boolean> {
    try {
      const existing = await this.prisma.client.revenueAction.findUnique({
        where: {
          businessId_type_relatedType_relatedId: {
            businessId: input.businessId,
            type: input.type,
            relatedType: input.relatedType ?? '',
            relatedId: input.relatedId ?? '',
          },
        },
      });
      const recommendationJson: Prisma.InputJsonValue | typeof Prisma.JsonNull = input.recommendation
        ? (input.recommendation as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
      if (existing) {
        // Refresh PENDING/SNOOZED rows; never resurrect a COMPLETED/DISMISSED row.
        if (existing.status === 'COMPLETED' || existing.status === 'DISMISSED') return false;
        await this.prisma.client.revenueAction.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            detail: input.detail ?? null,
            priority: input.priority,
            amountAtRisk: input.amountAtRisk ?? null,
            dueAt: input.dueAt ?? null,
            recommendation: recommendationJson,
            contactId: input.contactId ?? null,
          },
        });
        return false;
      }
      const created = await this.prisma.client.revenueAction.create({
        data: {
          businessId: input.businessId,
          type: input.type,
          title: input.title,
          detail: input.detail ?? null,
          priority: input.priority,
          contactId: input.contactId ?? null,
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
          amountAtRisk: input.amountAtRisk ?? null,
          dueAt: input.dueAt ?? null,
          recommendation: recommendationJson,
        },
      });
      const payload: RevenueActionCreatedPayload = {
        businessId: input.businessId,
        actionId: created.id,
        type: input.type,
        priority: input.priority,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        amountAtRisk: input.amountAtRisk ?? null,
      };
      this.events.emit('revenue_action.created', payload);
      return true;
    } catch (e) {
      this.logger.warn(`upsertAction failed (${input.type}): ${(e as Error).message}`);
      return false;
    }
  }

  // ---------- Public CRUD for the controller ----------

  /**
   * Create a RevenueAction directly from an AI revenue-briefing chase suggestion.
   * Uses a deterministic key derived from the chase target so repeated delegations
   * of the same chase don't pile up duplicates.
   */
  async createFromBriefing(
    businessId: string,
    chase: {
      title: string;
      detail: string;
      amountAtRisk?: number | null;
      contactId?: string | null;
      relatedType?: string | null;
      relatedId?: string | null;
    },
  ): Promise<{ created: boolean; actionId?: string }> {
    const relatedType = chase.relatedType ?? 'briefing';
    const relatedId =
      chase.relatedId ??
      `briefing:${chase.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
    try {
      const existing = await this.prisma.client.revenueAction.findUnique({
        where: {
          businessId_type_relatedType_relatedId: {
            businessId,
            type: 'CHASE_FROM_BRIEFING',
            relatedType,
            relatedId,
          },
        },
        select: { id: true, status: true },
      });
      if (existing) {
        if (existing.status === 'COMPLETED' || existing.status === 'DISMISSED') {
          return { created: false, actionId: existing.id };
        }
        await this.prisma.client.revenueAction.update({
          where: { id: existing.id },
          data: {
            title: chase.title,
            detail: chase.detail,
            amountAtRisk: chase.amountAtRisk ?? null,
            contactId: chase.contactId ?? null,
          },
        });
        return { created: false, actionId: existing.id };
      }
      const created = await this.prisma.client.revenueAction.create({
        data: {
          businessId,
          type: 'CHASE_FROM_BRIEFING',
          title: chase.title,
          detail: chase.detail,
          priority: 2,
          contactId: chase.contactId ?? null,
          relatedType,
          relatedId,
          amountAtRisk: chase.amountAtRisk ?? null,
          recommendation: {
            explanation: 'Delegated from your AI revenue briefing.',
            suggestedAction: chase.detail || 'Reach out to this customer.',
            source: 'ai',
          } as Prisma.InputJsonValue,
        },
      });
      const payload: RevenueActionCreatedPayload = {
        businessId,
        actionId: created.id,
        type: 'CHASE_FROM_BRIEFING' as RevenueActionType,
        priority: 2,
        relatedType,
        relatedId,
        amountAtRisk: chase.amountAtRisk ?? null,
      };
      this.events.emit('revenue_action.created', payload);
      return { created: true, actionId: created.id };
    } catch (e) {
      this.logger.warn(`createFromBriefing failed: ${(e as Error).message}`);
      return { created: false };
    }
  }

  async list(businessId: string, opts?: { status?: string; limit?: number }) {
    const status = opts?.status ?? 'PENDING';
    const where: Prisma.RevenueActionWhereInput = { businessId };
    if (status !== 'ALL') where.status = status;
    if (status === 'PENDING') {
      // Hide snoozed rows whose window hasn't elapsed.
      where.OR = [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }];
    }
    return this.prisma.client.revenueAction.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: opts?.limit ?? 100,
    });
  }

  async topPriority(businessId: string, limit = 5) {
    return this.list(businessId, { status: 'PENDING', limit });
  }

  async complete(businessId: string, id: string, userId?: string | null, resolution?: string | null) {
    return this.transition(businessId, id, 'COMPLETED', userId, resolution);
  }
  async dismiss(businessId: string, id: string, userId?: string | null, resolution?: string | null) {
    return this.transition(businessId, id, 'DISMISSED', userId, resolution);
  }
  async snooze(businessId: string, id: string, until: Date, userId?: string | null) {
    const row = await this.prisma.client.revenueAction.findFirst({ where: { id, businessId } });
    if (!row) throw new Error('action not found');
    const updated = await this.prisma.client.revenueAction.update({
      where: { id },
      data: { status: 'SNOOZED', snoozedUntil: until, resolvedBy: userId ?? null },
    });
    const payload: RevenueActionCompletedPayload = {
      businessId, actionId: id, type: row.type,
      resolution: 'snoozed', relatedType: row.relatedType, relatedId: row.relatedId,
      resolvedBy: userId ?? null,
    };
    this.events.emit('revenue_action.completed', payload);
    return updated;
  }

  private async transition(
    businessId: string, id: string,
    status: 'COMPLETED' | 'DISMISSED',
    userId?: string | null, resolution?: string | null,
  ) {
    const row = await this.prisma.client.revenueAction.findFirst({ where: { id, businessId } });
    if (!row) throw new Error('action not found');
    const updated = await this.prisma.client.revenueAction.update({
      where: { id },
      data: {
        status,
        completedAt: new Date(),
        resolvedBy: userId ?? null,
        resolution: resolution ?? null,
      },
    });
    const payload: RevenueActionCompletedPayload = {
      businessId, actionId: id, type: row.type,
      resolution: status === 'COMPLETED' ? 'completed' : 'dismissed',
      relatedType: row.relatedType, relatedId: row.relatedId,
      resolvedBy: userId ?? null,
    };
    this.events.emit('revenue_action.completed', payload);
    return updated;
  }

  // ---------- Overview KPIs + revenue pulse ----------

  async overviewKpis(businessId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      collectedRows, outstandingRows, overdueRows, quotePipelineRows,
      recurringRows, paidThisMonthRows, billedThisMonthRows,
    ] = await Promise.all([
      this.prisma.client.payment.aggregate({
        where: { businessId, status: 'SUCCESSFUL', createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        _sum: { total: true }, _count: true,
      }),
      this.prisma.client.quote.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] } },
        _sum: { total: true }, _count: true,
      }),
      this.prisma.client.recurringInvoice.findMany({
        where: { businessId, isActive: true },
        select: { total: true, frequency: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: monthStart } },
        _sum: { total: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, issueDate: { gte: monthStart } },
        _sum: { total: true },
      }),
    ]);

    const collectedThisMonth = Number(collectedRows._sum.amount ?? 0);
    const outstanding = Number(outstandingRows._sum.total ?? 0);
    const overdue = Number(overdueRows._sum.total ?? 0);
    const quotePipeline = Number(quotePipelineRows._sum.total ?? 0);

    const recurringExpected = recurringRows.reduce((sum, r) => {
      // Normalize to monthly cadence for the "expected this month" KPI.
      const t = Number(r.total ?? 0);
      switch (r.frequency) {
        case 'WEEKLY': return sum + t * 4;
        case 'BIWEEKLY': return sum + t * 2;
        case 'MONTHLY': return sum + t;
        case 'QUARTERLY': return sum + t / 3;
        case 'YEARLY': return sum + t / 12;
        default: return sum + t;
      }
    }, 0);

    const billed = Number(billedThisMonthRows._sum.total ?? 0);
    const collected = Number(paidThisMonthRows._sum.total ?? 0);
    const cashCollectionRate = billed > 0 ? Math.min(1, collected / billed) : 0;

    return {
      collectedThisMonth,
      outstanding,
      outstandingCount: outstandingRows._count,
      overdue,
      overdueCount: overdueRows._count,
      quotePipeline,
      quoteCount: quotePipelineRows._count,
      recurringExpected,
      recurringActive: recurringRows.length,
      cashCollectionRate,
    };
  }

  /** 12-week mini-chart: weekly collected, billed, and pending. */
  async revenuePulse(businessId: string) {
    const now = new Date();
    const weeks: { weekStart: string; collected: number; billed: number; outstanding: number }[] = [];
    const start = new Date(now);
    start.setDate(start.getDate() - 7 * 11);
    start.setHours(0, 0, 0, 0);

    const [payments, invoices] = await Promise.all([
      this.prisma.client.payment.findMany({
        where: { businessId, status: 'SUCCESSFUL', createdAt: { gte: start } },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, issueDate: { gte: start } },
        select: { total: true, status: true, issueDate: true, dueDate: true },
      }),
    ]);

    for (let w = 0; w < 12; w++) {
      const weekStart = new Date(start);
      weekStart.setDate(weekStart.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const collected = payments
        .filter((p) => p.createdAt >= weekStart && p.createdAt < weekEnd)
        .reduce((s, p) => s + Number(p.amount ?? 0), 0);
      const billed = invoices
        .filter((i) => i.issueDate && i.issueDate >= weekStart && i.issueDate < weekEnd)
        .reduce((s, i) => s + Number(i.total ?? 0), 0);
      const outstanding = invoices
        .filter((i) => i.issueDate && i.issueDate >= weekStart && i.issueDate < weekEnd && i.status !== 'PAID')
        .reduce((s, i) => s + Number(i.total ?? 0), 0);
      weeks.push({ weekStart: weekStart.toISOString().slice(0, 10), collected, billed, outstanding });
    }
    return weeks;
  }

  // ---------- Recommendation drafting ----------

  private async draftRecommendation(
    businessId: string,
    ctx: {
      kind: RevenueActionType;
      contactName: string;
      currency: string;
      amount: number;
      reference?: string;
      daysOverdue?: number;
      daysSinceSent?: number;
      daysSinceContact?: number | null;
      lastError?: string | null;
      failureCount?: number;
    },
  ): Promise<RevenueActionRecommendation> {
    const fallback = templateRecommendation(ctx);
    try {
      const prompt = buildRecommendationPrompt(ctx);
      const res = await this.gateway.complete({
        businessId,
        taskCategory: 'content-generation',
        maxTokens: 320,
        temperature: 0.4,
        messages: [
          { role: 'system', content: 'You are a concise revenue operations assistant. Reply ONLY with valid JSON matching {"explanation":string,"suggestedAction":string,"draft":{"subject":string,"body":string}}. Keep explanation under 200 chars and body under 600 chars. Never invent specific dates or invoice numbers beyond what is provided.' },
          { role: 'user', content: prompt },
        ],
      });
      const content = res.content?.trim();
      if (!content) return fallback;
      const parsed = safeJsonParse(content);
      if (!parsed || typeof parsed.explanation !== 'string' || typeof parsed.suggestedAction !== 'string') {
        return fallback;
      }
      return {
        explanation: String(parsed.explanation).slice(0, 400),
        suggestedAction: String(parsed.suggestedAction).slice(0, 200),
        draft: parsed.draft && typeof parsed.draft === 'object'
          ? {
              subject: typeof parsed.draft.subject === 'string' ? parsed.draft.subject.slice(0, 140) : undefined,
              body: typeof parsed.draft.body === 'string' ? parsed.draft.body.slice(0, 1200) : undefined,
            }
          : undefined,
        source: 'ai',
      };
    } catch (e) {
      this.logger.debug?.(`AI recommendation fallback (${ctx.kind}): ${(e as Error).message}`);
      return fallback;
    }
  }
}

// ---------- Helpers ----------

function formatContactName(c: { firstName?: string | null; lastName?: string | null; displayName?: string | null; email?: string | null } | null | undefined): string {
  if (!c) return 'Customer';
  const composed = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return composed || c.displayName || c.email || 'Customer';
}

function safeJsonParse(s: string): any {
  try {
    // strip code fences if the model wrapped its JSON
    const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function templateRecommendation(ctx: {
  kind: RevenueActionType;
  contactName: string;
  currency: string;
  amount: number;
  reference?: string;
  daysOverdue?: number;
  daysSinceSent?: number;
  daysSinceContact?: number | null;
  lastError?: string | null;
  failureCount?: number;
}): RevenueActionRecommendation {
  const amt = `${ctx.currency} ${Math.round(ctx.amount).toLocaleString()}`;
  const ref = ctx.reference ?? '';
  switch (ctx.kind) {
    case 'OVERDUE_INVOICE':
      return {
        explanation: `Invoice ${ref} for ${ctx.contactName} is ${ctx.daysOverdue ?? 0} days past due (${amt}). A polite, specific reminder usually recovers this.`,
        suggestedAction: 'Send a payment reminder email',
        draft: {
          subject: `Friendly reminder: invoice ${ref}`,
          body: `Hi ${ctx.contactName},\n\nThis is a quick reminder that invoice ${ref} for ${amt} is now ${ctx.daysOverdue ?? 'a few'} days overdue. If you've already paid, please ignore this note. Otherwise, here's the payment link to settle it in a few seconds.\n\nThanks,\n`,
        },
        source: 'template',
      };
    case 'STALE_QUOTE':
      return {
        explanation: `${ctx.contactName} hasn't engaged with quote ${ref} (${amt}) in ${ctx.daysSinceSent ?? 0} days. A nudge often unblocks the deal.`,
        suggestedAction: 'Send a follow-up message',
        draft: {
          subject: `Following up on quote ${ref}`,
          body: `Hi ${ctx.contactName},\n\nJust circling back on quote ${ref} I sent across — happy to walk you through it or tweak the scope. Let me know if there's anything I can clarify.\n\nThanks,\n`,
        },
        source: 'template',
      };
    case 'ACCEPTED_QUOTE_NO_INVOICE':
      return {
        explanation: `${ctx.contactName} accepted quote ${ref} (${amt}) but no invoice has been issued. Convert it now to start the clock.`,
        suggestedAction: 'Convert quote to invoice',
        source: 'template',
      };
    case 'PAID_INVOICE_NO_RECEIPT':
      return {
        explanation: `${ctx.contactName} paid invoice ${ref} (${amt}) but no receipt has been sent. A receipt boosts trust and lowers refund disputes.`,
        suggestedAction: 'Send a receipt email',
        source: 'template',
      };
    case 'RECURRING_FAILURE':
      return {
        explanation: `Recurring schedule "${ref}" failed ${ctx.failureCount ?? 1} time(s). Last error: ${ctx.lastError ?? 'unknown'}. Review and re-run before the next cycle.`,
        suggestedAction: 'Review recurring schedule',
        source: 'template',
      };
    case 'DORMANT_HIGH_VALUE':
      return {
        explanation: `${ctx.contactName} is a high-value client (${amt} lifetime) but has been quiet for ${ctx.daysSinceContact ?? '90+'} days. A short check-in often reignites the relationship.`,
        suggestedAction: 'Send a check-in message',
        draft: {
          subject: `Checking in`,
          body: `Hi ${ctx.contactName},\n\nIt's been a while — wanted to drop a quick line to see how things are going on your side and whether there's anything we can help with this quarter.\n\nTalk soon,\n`,
        },
        source: 'template',
      };
  }
}

function buildRecommendationPrompt(ctx: {
  kind: RevenueActionType;
  contactName: string;
  currency: string;
  amount: number;
  reference?: string;
  daysOverdue?: number;
  daysSinceSent?: number;
  daysSinceContact?: number | null;
  lastError?: string | null;
  failureCount?: number;
}): string {
  const lines: string[] = [
    `Action type: ${ctx.kind}`,
    `Customer: ${ctx.contactName}`,
    `Amount: ${ctx.currency} ${ctx.amount}`,
  ];
  if (ctx.reference) lines.push(`Reference: ${ctx.reference}`);
  if (ctx.daysOverdue != null) lines.push(`Days overdue: ${ctx.daysOverdue}`);
  if (ctx.daysSinceSent != null) lines.push(`Days since sent: ${ctx.daysSinceSent}`);
  if (ctx.daysSinceContact != null) lines.push(`Days since last activity: ${ctx.daysSinceContact}`);
  if (ctx.lastError) lines.push(`Last error: ${ctx.lastError}`);
  if (ctx.failureCount != null) lines.push(`Failure count: ${ctx.failureCount}`);
  lines.push('Draft a brief, friendly explanation of why this matters, a one-line suggested action, and (when applicable) a short customer-ready email subject + body. Return JSON only.');
  return lines.join('\n');
}
