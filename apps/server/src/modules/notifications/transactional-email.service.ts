import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GmailService } from '../commerce/gmail.service';
import { appUrl } from '../../core/config/runtime-urls';
import {
  TemplateContext,
  bookingConfirmedTemplate,
  bookingReminderTemplate,
  bookingRescheduledTemplate,
  bookingCancelledTemplate,
  bookingCreatedTemplate,
  bookingCompletedTemplate,
  bookingNoShowTemplate,
  invoiceSentTemplate,
  invoiceOverdueTemplate,
  invoiceDueSoonTemplate,
  paymentReceiptTemplate,
  paymentFailedTemplate,
  orderConfirmedTemplate,
  orderShippedTemplate,
  orderDeliveredTemplate,
  orderRefundedTemplate,
  orderCancelledTemplate,
  sellerNewOrderTemplate,
  sellerLowStockTemplate,
  documentGeneratedTemplate,
  reviewRequestTemplate,
  preorderDelayNoticeTemplate,
  reorderPromptTemplate,
  quoteViewedOwnerTemplate,
  quoteAcceptedOwnerTemplate,
  quoteRejectedOwnerTemplate,
  quoteAcceptedCustomerTemplate,
  quoteRejectedCustomerTemplate,
  quoteSentTemplate,
} from './email-templates';
import { schedulersDisabled } from '../../core/config/env';

export type NotificationType =
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'booking_created'
  | 'booking_completed'
  | 'booking_no_show'
  | 'invoice_sent'
  | 'invoice_overdue'
  | 'invoice_due_soon'
  | 'payment_receipt'
  | 'payment_failed'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_refunded'
  | 'order_cancelled'
  | 'seller_new_order'
  | 'seller_low_stock'
  | 'document_generated'
  | 'review_request'
  | 'preorder_delay_notice'
  | 'reorder_prompt'
  | 'quote_viewed_owner'
  | 'quote_accepted_owner'
  | 'quote_rejected_owner'
  | 'quote_accepted_customer'
  | 'quote_rejected_customer'
  | 'quote_sent';

export interface NotificationPreferences {
  booking_confirmed?: boolean;
  booking_reminder?: boolean;
  booking_rescheduled?: boolean;
  booking_cancelled?: boolean;
  booking_created?: boolean;
  booking_completed?: boolean;
  booking_no_show?: boolean;
  invoice_sent?: boolean;
  invoice_overdue?: boolean;
  invoice_due_soon?: boolean;
  payment_receipt?: boolean;
  payment_failed?: boolean;
  order_confirmed?: boolean;
  order_shipped?: boolean;
  order_delivered?: boolean;
  order_refunded?: boolean;
  order_cancelled?: boolean;
  seller_new_order?: boolean;
  seller_low_stock?: boolean;
  document_generated?: boolean;
  review_request?: boolean;
  preorder_delay_notice?: boolean;
  reorder_prompt?: boolean;
  quote_viewed_owner?: boolean;
  quote_accepted_owner?: boolean;
  quote_rejected_owner?: boolean;
  quote_accepted_customer?: boolean;
  quote_rejected_customer?: boolean;
  quote_sent?: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  booking_confirmed: true,
  booking_reminder: true,
  booking_rescheduled: true,
  booking_cancelled: true,
  booking_created: true,
  booking_completed: true,
  booking_no_show: true,
  invoice_sent: true,
  invoice_overdue: true,
  invoice_due_soon: true,
  payment_receipt: true,
  payment_failed: true,
  order_confirmed: true,
  order_shipped: true,
  order_delivered: true,
  order_refunded: true,
  order_cancelled: true,
  seller_new_order: true,
  seller_low_stock: true,
  document_generated: true,
  review_request: true,
  preorder_delay_notice: true,
  reorder_prompt: true,
  quote_viewed_owner: true,
  quote_accepted_owner: true,
  quote_rejected_owner: true,
  quote_accepted_customer: true,
  quote_rejected_customer: true,
  quote_sent: true,
};

/**
 * Log lines name no recipient address and no message content (SEC-C2-1,
 * W3-C2b-EMAIL-LOG-LEAK; IA-044, CF-029). main.ts creates the app with no
 * `logger` option, so every level reaches the default ConsoleLogger.
 *
 * The recipient is named by contact id, as the playbook executor's lines do
 * since FOLLOW3-C2; a send with no contact (an owner or seller notice, or a
 * queued row without one) names no recipient at all.
 */
function recipientForLog(contactId?: string | null): string {
  return contactId ? `contact ${contactId}` : 'a recipient with no contact';
}

/** Anything shaped like an email address: the pattern SystemEmailService redacts (9B-D2). */
const ADDRESS_PATTERN = /[^\s<>"'`(),;:[\]]+@[^\s<>"'`(),;:[\]]+/g;

/**
 * Error text from Gmail, a template or a lookup, for a log line: the message's
 * subject (when given) and every address-shaped token are replaced, so an
 * error that quotes the message cannot put its recipient or content in the
 * logs. The rest of the text stays: it is what an operator needs.
 *
 * Any value is read as text first (CR-1, W3-C2b review): a thrown value's
 * message need not be a string, and a log line must never turn a failed send
 * into a TypeError that skips its FAILED result and notification row.
 */
function redactForLog(text: unknown, subject?: string): string {
  const asText = typeof text === 'string' ? text : String(text);
  const withoutSubject = subject ? asText.split(subject).join('<subject>') : asText;
  return withoutSubject.replace(ADDRESS_PATTERN, '<address>');
}

/**
 * A failed notification-log write, for a log line: the error class and the
 * Prisma code only. A Prisma validation error quotes its whole argument (the
 * recipient, the subject, the template data).
 */
function errorClassForLog(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} ${code}` : name;
}

const QUEUE_DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const QUEUE_DRAIN_BATCH_SIZE = 20;
const QUEUE_MAX_AGE_HOURS = 48;

/**
 * W3-D17b-REVIEW-SOLICIT-DEDUPE (V1-89): a keyed send claims its dedupe key
 * before any effect, on the existing idempotency_keys table (unique on business
 * and key; no migration) under this namespaced slot, as V1-45 and V1-31b claim
 * theirs. The claim is a mutex, not the record: it is given back once the
 * send's outcome row is written, and customer_notification_logs stays what a
 * later send is deduped against (SENT, QUEUED or DRAINED blocks; FAILED does
 * not).
 */
const DEDUPE_CLAIM_PREFIX = 'transactional-email.dedupe:';
/**
 * A claim older than this belongs to a send that died between its claim and its
 * release (a crash or a lost connection): it is taken over by a compare-and-set
 * delete on the version read. A live send (three attempts, 1 s and 2 s apart)
 * finishes well inside it.
 */
const DEDUPE_CLAIM_STALE_MS = 15 * 60 * 1000;

export interface TransactionalSendParams {
  businessId: string;
  type: NotificationType;
  recipientEmail: string;
  recipientName: string;
  contactId?: string;
  templateData: Record<string, any>;
  dedupeKey?: string;
}

type TransactionalSendResult = { status: 'SENT' | 'FAILED' | 'QUEUED'; messageId?: string };

type BusinessContext = TemplateContext & { id: string; preferences: NotificationPreferences };

@Injectable()
export class TransactionalEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransactionalEmailService.name);
  private drainInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GmailService) private readonly gmail: GmailService,
  ) {}

  onModuleInit() {
    if (schedulersDisabled()) {
      this.logger.log('Scheduler disabled (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
    this.drainInterval = setInterval(() => {
      this.drainQueue().catch((e) =>
        this.logger.error(`Queue drain failed: ${redactForLog(String((e as Error)?.message ?? e))}`),
      );
    }, QUEUE_DRAIN_INTERVAL_MS);
    this.logger.log('Notification queue drain scheduler started (5min interval)');
  }

  onModuleDestroy() {
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
      this.drainInterval = null;
    }
  }

  private async getBusinessContext(businessId: string): Promise<TemplateContext & { id: string; preferences: NotificationPreferences } | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        country: true,
        primaryColor: true,
        secondaryColor: true,
        notificationPreferences: true,
        gmailRefreshToken: true,
      },
    });
    if (!business) return null;

    const prefs = (business.notificationPreferences as NotificationPreferences) ?? {};
    const mergedPrefs = { ...DEFAULT_PREFERENCES, ...prefs };

    const addressParts = [business.address, business.city, business.country].filter(Boolean);

    return {
      id: business.id,
      businessName: business.name,
      businessEmail: business.email ?? undefined,
      businessPhone: business.phone ?? undefined,
      businessAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
      primaryColor: business.primaryColor ?? undefined,
      secondaryColor: business.secondaryColor ?? undefined,
      customerName: '',
      preferences: mergedPrefs,
    };
  }

  private isEnabled(preferences: NotificationPreferences, type: NotificationType): boolean {
    return preferences[type] !== false;
  }

  /**
   * Inject a `referUrl` deep-link into the template data for the first
   * booking-confirmed / order-confirmed email a customer receives from a
   * given business. Returns true when the CTA was attached so the caller
   * can persist an idempotency marker after the send succeeds.
   *
   * Idempotency is enforced by looking for a previous `referral_invite`
   * row in `customer_notification_logs` keyed by businessId + recipient
   * email (lowercased) — any subsequent purchases will skip the CTA.
   */
  private async maybeAttachReferralInvite(
    businessId: string,
    recipientEmail: string,
    templateData: Record<string, any>,
    contactId?: string,
  ): Promise<boolean> {
    if (!recipientEmail) return false;
    if (templateData.referUrl) return false;

    const normalizedEmail = recipientEmail.toLowerCase();
    const markerKey = `referral-invite-${businessId}-${normalizedEmail}`;

    try {
      const existingMarker = await this.prisma.client.customerNotificationLog.findFirst({
        where: { businessId, messageId: markerKey },
        select: { id: true },
      });
      if (existingMarker) return false;

      const existingByType = await this.prisma.client.customerNotificationLog.findFirst({
        where: {
          businessId,
          type: 'referral_invite',
          recipientEmail: { equals: recipientEmail, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (existingByType) return false;

      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { slug: true },
      });
      const slug = business?.slug?.trim();
      if (!slug) return false;

      const base = appUrl();
      if (!base) return false;

      const url = `${base}/me/refer?slug=${encodeURIComponent(slug)}&email=${encodeURIComponent(normalizedEmail)}`;
      templateData.referUrl = url;
      return true;
    } catch (err: any) {
      // SEC-C2-1: the contact by id; a lookup error that quotes the marker key is redacted.
      this.logger.warn(
        `Referral CTA injection skipped for ${recipientForLog(contactId)} in business ${businessId}: ${redactForLog(String((err as Error)?.message ?? err))}`,
      );
      return false;
    }
  }

  private async logNotification(params: {
    businessId: string;
    contactId?: string;
    type: NotificationType;
    recipientEmail: string;
    recipientName?: string;
    subject: string;
    status: 'SENT' | 'FAILED' | 'QUEUED';
    messageId?: string;
    error?: string;
    templateData?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.client.customerNotificationLog.create({
        data: {
          businessId: params.businessId,
          contactId: params.contactId ?? null,
          type: params.type,
          recipientEmail: params.recipientEmail,
          recipientName: params.recipientName ?? null,
          subject: params.subject,
          status: params.status,
          messageId: params.messageId ?? null,
          error: params.error ?? null,
          templateData: params.templateData ?? undefined,
          sentAt: params.status === 'SENT' ? new Date() : null,
        },
      });
    } catch (err: any) {
      // SEC-C2-1: the error class only; a Prisma validation error quotes the row.
      this.logger.error(
        `Failed to log notification (${params.status} ${params.type} to ${recipientForLog(params.contactId)}): ${errorClassForLog(err)}`,
      );
    }
  }

  async send(params: TransactionalSendParams): Promise<TransactionalSendResult> {
    const ctx = await this.getBusinessContext(params.businessId);
    if (!ctx) {
      this.logger.warn(`Business not found: ${params.businessId}`);
      return { status: 'FAILED' };
    }

    if (!this.isEnabled(ctx.preferences, params.type)) {
      this.logger.debug(`Notification type ${params.type} disabled for business ${params.businessId}`);
      return { status: 'FAILED' };
    }

    // "Do not contact" is enforced HERE, once, rather than by each caller.
    //
    // It was enforced by convention: DelegationLoopService checks
    // `contact.doNotContact` before payment recovery, and the campaign sender
    // filters on doNotContact and marketingOptIn. Every other caller was on its
    // honour — and the invoice-send path added to this codebase on 2026-08-05
    // promptly forgot, which is the argument for putting it in the pathway
    // instead of in a checklist.
    //
    // Scoped to the tenant on purpose: a contactId from another business must
    // not silently resolve. If the id does not belong here, refuse rather than
    // send blind.
    if (params.contactId) {
      const contact = await this.prisma.client.contact.findFirst({
        where: { id: params.contactId, businessId: params.businessId },
        select: { doNotContact: true },
      });

      if (!contact) {
        this.logger.warn(
          `[notify] refusing ${params.type}: contact ${params.contactId} is not in business ${params.businessId}`,
        );
        return { status: 'FAILED' };
      }

      if (contact.doNotContact) {
        this.logger.warn(`[notify] refusing ${params.type}: contact ${params.contactId} is marked do-not-contact`);
        return { status: 'FAILED' };
      }
    }

    if (!params.dedupeKey) return this.deliver(params, ctx);
    const dedupeKey = params.dedupeKey;

    const sent = await this.dedupedSend(params.businessId, dedupeKey);
    if (sent) {
      this.logger.debug(
        `Skipping duplicate ${params.type} for ${recipientForLog(params.contactId)} (dedupeKey=${redactForLog(dedupeKey)})`,
      );
      return sent;
    }

    // W3-D17b-REVIEW-SOLICIT-DEDUPE: the read above is check-then-act; two
    // concurrent sends with one key both passed it and both reached the
    // provider. The claim makes the dedupe atomic: only one send holds the key
    // until its outcome row is written.
    const claimId = await this.claimDedupeKey(params.businessId, dedupeKey);
    if (!claimId) {
      this.logger.debug(
        `Skipping duplicate ${params.type} for ${recipientForLog(params.contactId)} (dedupeKey=${redactForLog(dedupeKey)}): a concurrent send holds it`,
      );
      return { status: 'QUEUED' };
    }
    try {
      // Read again under the claim: a holder that wrote its row and gave the
      // key back between the read above and this claim is seen here.
      const settled = await this.dedupedSend(params.businessId, dedupeKey);
      if (settled) {
        this.logger.debug(
          `Skipping duplicate ${params.type} for ${recipientForLog(params.contactId)} (dedupeKey=${redactForLog(dedupeKey)})`,
        );
        return settled;
      }
      return await this.deliver(params, ctx);
    } finally {
      await this.releaseDedupeClaim(params.businessId, claimId);
    }
  }

  /** The send already made under a dedupe key (SENT, QUEUED or DRAINED), as a result; null when there is none. */
  private async dedupedSend(businessId: string, dedupeKey: string): Promise<TransactionalSendResult | null> {
    const existing = await this.prisma.client.customerNotificationLog.findFirst({
      where: {
        businessId,
        messageId: dedupeKey,
        status: { in: ['SENT', 'QUEUED', 'DRAINED'] },
      },
      select: { id: true, status: true, messageId: true },
    });
    return existing ? { status: existing.status as 'SENT' | 'QUEUED', messageId: existing.messageId ?? undefined } : null;
  }

  /**
   * W3-D17b-REVIEW-SOLICIT-DEDUPE: insert-first claim of a dedupe key. Returns
   * the claim row's id, or null when another send holds the key (the unique
   * index refused the insert). A holder older than DEDUPE_CLAIM_STALE_MS is
   * taken over once, by deleting exactly the version read, so of two senders
   * that find the same dead claim one at most proceeds.
   */
  private async claimDedupeKey(businessId: string, dedupeKey: string): Promise<string | null> {
    const idempotencyKey = `${DEDUPE_CLAIM_PREFIX}${dedupeKey}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const claim = await this.prisma.client.idempotencyKey.create({
          data: { businessId, idempotencyKey, status: 'claimed', response: { kind: 'transactional_email_dedupe' } },
          select: { id: true },
        });
        return claim.id;
      } catch (err: unknown) {
        if ((err as { code?: string })?.code !== 'P2002') throw err;
      }
      if (attempt > 0) return null;
      const holder = await this.prisma.client.idempotencyKey.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey } },
        select: { id: true, updatedAt: true },
      });
      if (holder) {
        if (Date.now() - holder.updatedAt.getTime() < DEDUPE_CLAIM_STALE_MS) return null;
        const { count } = await this.prisma.client.idempotencyKey.deleteMany({
          where: { id: holder.id, businessId, idempotencyKey, updatedAt: holder.updatedAt },
        });
        if (count !== 1) return null;
        this.logger.warn(`Took over a stale dedupe claim in business ${businessId} (dedupeKey=${redactForLog(dedupeKey)})`);
      }
      // The holder is gone (given back, or taken over just now): claim again once.
    }
    return null;
  }

  /** Gives a dedupe claim back, fenced to this claim's own row. A failed release leaves a claim that goes stale. */
  private async releaseDedupeClaim(businessId: string, claimId: string): Promise<void> {
    try {
      await this.prisma.client.idempotencyKey.deleteMany({ where: { id: claimId, businessId } });
    } catch (err: unknown) {
      this.logger.warn(`Dedupe claim ${claimId} in business ${businessId} not given back: ${errorClassForLog(err)}`);
    }
  }

  /** The send itself, once it may go (business found, type enabled, contact may be contacted, not a duplicate). */
  private async deliver(params: TransactionalSendParams, ctx: BusinessContext): Promise<TransactionalSendResult> {
    const gmailStatus = await this.gmail.getGmailStatus(params.businessId);
    if (!gmailStatus.connected) {
      this.logger.debug(`Gmail not connected for business ${params.businessId}, queuing notification`);
      await this.logNotification({
        businessId: params.businessId,
        contactId: params.contactId,
        type: params.type,
        recipientEmail: params.recipientEmail,
        recipientName: params.recipientName,
        subject: `Queued: ${params.type}`,
        status: 'QUEUED',
        messageId: params.dedupeKey,
        templateData: params.templateData as Record<string, unknown>,
      });
      return { status: 'QUEUED' };
    }

    const baseCtx: TemplateContext = {
      ...ctx,
      customerName: params.recipientName,
    };
    const data = params.templateData;

    let referralAttached = false;
    if (params.type === 'booking_confirmed' || params.type === 'order_confirmed') {
      referralAttached = await this.maybeAttachReferralInvite(
        params.businessId,
        params.recipientEmail,
        data,
        params.contactId,
      );
    }

    let rendered: { subject: string; html: string };
    try {
      switch (params.type) {
        case 'booking_confirmed':
          rendered = bookingConfirmedTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
            endTime: data.endTime,
            staffName: data.staffName,
            bookingId: data.bookingId,
            location: data.location,
            locationPlaceId: data.locationPlaceId,
            locationLatLng: data.locationLatLng,
            referUrl: data.referUrl,
          });
          break;
        case 'booking_reminder':
          rendered = bookingReminderTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
            endTime: data.endTime,
            staffName: data.staffName,
            bookingId: data.bookingId,
            location: data.location,
            locationPlaceId: data.locationPlaceId,
            locationLatLng: data.locationLatLng,
          });
          break;
        case 'booking_rescheduled':
          rendered = bookingRescheduledTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            newStartTime: data.newStartTime,
            newEndTime: data.newEndTime,
            previousStartTime: data.previousStartTime,
            staffName: data.staffName,
            location: data.location,
            locationPlaceId: data.locationPlaceId,
            locationLatLng: data.locationLatLng,
          });
          break;
        case 'booking_cancelled':
          rendered = bookingCancelledTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
          });
          break;
        case 'booking_created':
          rendered = bookingCreatedTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
            endTime: data.endTime,
            staffName: data.staffName,
            bookingId: data.bookingId,
            location: data.location,
            businessUrl: data.businessUrl,
          });
          break;
        case 'invoice_sent':
          rendered = invoiceSentTemplate({
            ...baseCtx,
            invoiceNumber: data.invoiceNumber,
            total: data.total,
            currency: data.currency,
            dueDate: data.dueDate,
            invoiceUrl: data.invoiceUrl,
            items: data.items,
          });
          break;
        case 'invoice_overdue':
          rendered = invoiceOverdueTemplate({
            ...baseCtx,
            invoiceNumber: data.invoiceNumber,
            total: data.total,
            currency: data.currency,
            dueDate: data.dueDate,
            invoiceUrl: data.invoiceUrl,
            daysOverdue: data.daysOverdue,
          });
          break;
        case 'payment_receipt':
          rendered = paymentReceiptTemplate({
            ...baseCtx,
            invoiceNumber: data.invoiceNumber,
            total: data.total,
            currency: data.currency,
            paidAt: data.paidAt,
            invoiceUrl: data.invoiceUrl,
          });
          break;
        case 'order_confirmed':
          rendered = orderConfirmedTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            items: data.items,
            subtotal: data.subtotal,
            shippingFee: data.shippingFee,
            total: data.total,
            currency: data.currency,
            estimatedDelivery: data.estimatedDelivery,
            orderStatusUrl: data.orderStatusUrl,
            referUrl: data.referUrl,
          });
          break;
        case 'order_shipped':
          rendered = orderShippedTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            carrier: data.carrier,
            trackingNumber: data.trackingNumber,
            trackingUrl: data.trackingUrl,
            estimatedDelivery: data.estimatedDelivery,
            orderStatusUrl: data.orderStatusUrl,
          });
          break;
        case 'order_delivered':
          rendered = orderDeliveredTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            deliveredAt: data.deliveredAt,
            orderStatusUrl: data.orderStatusUrl,
          });
          break;
        case 'order_refunded':
          rendered = orderRefundedTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            refundAmount: data.refundAmount,
            currency: data.currency,
            reason: data.reason,
            orderStatusUrl: data.orderStatusUrl,
          });
          break;
        case 'order_cancelled':
          rendered = orderCancelledTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            reason: data.reason,
            orderStatusUrl: data.orderStatusUrl,
          });
          break;
        case 'seller_new_order':
          rendered = sellerNewOrderTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            itemCount: data.itemCount,
            total: data.total,
            currency: data.currency,
          });
          break;
        case 'seller_low_stock':
          rendered = sellerLowStockTemplate({
            ...baseCtx,
            productName: data.productName,
            currentStock: data.currentStock,
            reorderLevel: data.reorderLevel,
          });
          break;
        case 'document_generated':
          rendered = documentGeneratedTemplate({
            ...baseCtx,
            documentTitle: data.documentTitle,
            documentTypeName: data.documentTypeName,
            categoryName: data.categoryName,
            riskTier: data.riskTier,
            documentId: data.documentId,
            version: data.version,
            sections: data.sections,
            documentUrl: data.documentUrl,
          });
          break;
        case 'review_request':
          rendered = reviewRequestTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            productNames: data.productNames,
          });
          break;
        case 'preorder_delay_notice':
          rendered = preorderDelayNoticeTemplate({
            ...baseCtx,
            productName: data.productName,
            originalExpectedDate: data.originalExpectedDate,
            newExpectedDate: data.newExpectedDate,
            reason: data.reason,
          });
          break;
        case 'reorder_prompt':
          rendered = reorderPromptTemplate({
            ...baseCtx,
            orderNumber: data.orderNumber,
            productNames: data.productNames,
            daysSincePurchase: data.daysSincePurchase,
          });
          break;
        case 'quote_viewed_owner':
          rendered = quoteViewedOwnerTemplate({
            ...baseCtx,
            quoteNumber: data.quoteNumber,
            contactDisplayName: data.contactDisplayName,
            total: data.total,
            currency: data.currency,
            viewedAt: data.viewedAt,
            quoteUrl: data.quoteUrl,
          });
          break;
        case 'quote_accepted_owner':
          rendered = quoteAcceptedOwnerTemplate({
            ...baseCtx,
            quoteNumber: data.quoteNumber,
            contactDisplayName: data.contactDisplayName,
            total: data.total,
            currency: data.currency,
            acceptedAt: data.acceptedAt,
            quoteUrl: data.quoteUrl,
          });
          break;
        case 'quote_rejected_owner':
          rendered = quoteRejectedOwnerTemplate({
            ...baseCtx,
            quoteNumber: data.quoteNumber,
            contactDisplayName: data.contactDisplayName,
            total: data.total,
            currency: data.currency,
            rejectedAt: data.rejectedAt,
            reason: data.reason,
            quoteUrl: data.quoteUrl,
          });
          break;
        case 'quote_accepted_customer':
          rendered = quoteAcceptedCustomerTemplate({
            ...baseCtx,
            quoteNumber: data.quoteNumber,
            total: data.total,
            currency: data.currency,
            acceptedAt: data.acceptedAt,
            quoteUrl: data.quoteUrl,
          });
          break;
        case 'quote_rejected_customer':
          rendered = quoteRejectedCustomerTemplate({
            ...baseCtx,
            quoteNumber: data.quoteNumber,
            total: data.total,
            currency: data.currency,
            rejectedAt: data.rejectedAt,
            reason: data.reason,
            quoteUrl: data.quoteUrl,
          });
          break;
        case 'quote_sent':
          rendered = quoteSentTemplate({
            ...baseCtx,
            quoteNumber: data.quoteNumber,
            total: data.total,
            currency: data.currency,
            items: data.items,
            quoteUrl: data.quoteUrl,
            expiryDate: data.expiryDate,
          });
          break;
        case 'booking_completed':
          rendered = bookingCompletedTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
            staffName: data.staffName,
            bookingId: data.bookingId,
          });
          break;
        case 'booking_no_show':
          rendered = bookingNoShowTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
            staffName: data.staffName,
            bookingId: data.bookingId,
            rescheduleUrl: data.rescheduleUrl,
          });
          break;
        case 'payment_failed':
          rendered = paymentFailedTemplate({
            ...baseCtx,
            invoiceNumber: data.invoiceNumber,
            total: data.total,
            currency: data.currency,
            retryUrl: data.retryUrl,
            errorMessage: data.errorMessage,
          });
          break;
        case 'invoice_due_soon':
          rendered = invoiceDueSoonTemplate({
            ...baseCtx,
            invoiceNumber: data.invoiceNumber,
            total: data.total,
            currency: data.currency,
            dueDate: data.dueDate,
            invoiceUrl: data.invoiceUrl,
          });
          break;
        default:
          this.logger.warn(`Unknown notification type: ${params.type}`);
          return { status: 'FAILED' };
      }
    } catch (err: any) {
      this.logger.error(
        `Template rendering failed for ${params.type} to ${recipientForLog(params.contactId)}: ${redactForLog(String((err as Error)?.message ?? err))}`,
      );
      await this.logNotification({
        businessId: params.businessId,
        contactId: params.contactId,
        type: params.type,
        recipientEmail: params.recipientEmail,
        recipientName: params.recipientName,
        subject: `Failed: ${params.type}`,
        status: 'FAILED',
        error: (err as Error).message,
      });
      return { status: 'FAILED' };
    }

    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.gmail.sendEmail({
          businessId: params.businessId,
          to: params.recipientEmail,
          subject: rendered.subject,
          htmlBody: rendered.html,
        });

        await this.logNotification({
          businessId: params.businessId,
          contactId: params.contactId,
          type: params.type,
          recipientEmail: params.recipientEmail,
          recipientName: params.recipientName,
          subject: rendered.subject,
          status: 'SENT',
          messageId: params.dedupeKey ?? result.messageId,
        });

        if (referralAttached) {
          await this.logNotification({
            businessId: params.businessId,
            contactId: params.contactId,
            type: 'referral_invite' as NotificationType,
            recipientEmail: params.recipientEmail,
            recipientName: params.recipientName,
            subject: `Referral CTA included in ${params.type}`,
            status: 'SENT',
            messageId: `referral-invite-${params.businessId}-${params.recipientEmail.toLowerCase()}`,
            templateData: { sourceType: params.type, referUrl: data.referUrl },
          });
        }

        // SEC-C2-1: the contact by id, never the address (IA-044, CF-029).
        this.logger.log(`Sent ${params.type} to ${recipientForLog(params.contactId)} for business ${params.businessId}`);
        return { status: 'SENT', messageId: result.messageId };
      } catch (err: any) {
        lastError = err as Error;
        this.logger.warn(
          `Attempt ${attempt}/${MAX_RETRIES} failed for ${params.type} to ${recipientForLog(params.contactId)}: ${redactForLog(String(lastError?.message ?? err), rendered.subject)}`,
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }

    this.logger.error(
      `All ${MAX_RETRIES} attempts failed for ${params.type} to ${recipientForLog(params.contactId)}: ${redactForLog(String(lastError?.message ?? 'unknown error'), rendered.subject)}`,
    );
    await this.logNotification({
      businessId: params.businessId,
      contactId: params.contactId,
      type: params.type,
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      subject: rendered.subject,
      status: 'FAILED',
      error: lastError?.message ?? 'Unknown error after retries',
    });
    return { status: 'FAILED' };
  }

  async getPreferences(businessId: string): Promise<NotificationPreferences> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { notificationPreferences: true },
    });
    const prefs = (business?.notificationPreferences as NotificationPreferences) ?? {};
    return { ...DEFAULT_PREFERENCES, ...prefs };
  }

  async updatePreferences(businessId: string, prefs: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const current = await this.getPreferences(businessId);
    const updated = { ...current, ...prefs };
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { notificationPreferences: updated },
    });
    return updated;
  }

  async getNotificationLog(businessId: string, opts?: { limit?: number; type?: string }) {
    return this.prisma.client.customerNotificationLog.findMany({
      where: {
        businessId,
        ...(opts?.type ? { type: opts.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async drainQueue(): Promise<number> {
    const cutoff = new Date(Date.now() - QUEUE_MAX_AGE_HOURS * 60 * 60 * 1000);

    const queued = await this.prisma.client.customerNotificationLog.findMany({
      where: {
        status: 'QUEUED',
        createdAt: { gte: cutoff },
        templateData: { not: Prisma.DbNull },
      },
      orderBy: { createdAt: 'asc' },
      take: QUEUE_DRAIN_BATCH_SIZE,
    });

    if (queued.length === 0) return 0;

    let sent = 0;
    for (const entry of queued) {
      const gmailStatus = await this.gmail.getGmailStatus(entry.businessId);
      if (!gmailStatus.connected) continue;

      const notifType = entry.type as NotificationType;
      const data = entry.templateData as Record<string, unknown>;
      if (!data) continue;

      try {
        const result = await this.send({
          businessId: entry.businessId,
          type: notifType,
          recipientEmail: entry.recipientEmail,
          recipientName: entry.recipientName ?? 'Customer',
          contactId: entry.contactId ?? undefined,
          templateData: data,
        });

        if (result.status === 'SENT') {
          await this.prisma.client.customerNotificationLog.update({
            where: { id: entry.id },
            data: { status: 'DRAINED', sentAt: new Date() },
          });
          sent++;
        }
      } catch (err: any) {
        this.logger.error(`Queue drain failed for entry ${entry.id}: ${redactForLog(String((err as Error)?.message ?? err))}`);
      }
    }

    await this.prisma.client.customerNotificationLog.updateMany({
      where: {
        status: 'QUEUED',
        createdAt: { lt: cutoff },
      },
      data: { status: 'EXPIRED', error: 'Queued notification expired after 48 hours' },
    });

    if (sent > 0) {
      this.logger.log(`Queue drain: sent ${sent}/${queued.length} queued notifications`);
    }
    return sent;
  }
}
