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

const QUEUE_DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const QUEUE_DRAIN_BATCH_SIZE = 20;
const QUEUE_MAX_AGE_HOURS = 48;

@Injectable()
export class TransactionalEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransactionalEmailService.name);
  private drainInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GmailService) private readonly gmail: GmailService,
  ) {}

  onModuleInit() {
    this.drainInterval = setInterval(() => {
      this.drainQueue().catch((e) =>
        this.logger.error(`Queue drain failed: ${(e as Error).message}`),
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
      this.logger.warn(`Referral CTA injection skipped for ${businessId}/${recipientEmail}: ${(err as Error).message}`);
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
      this.logger.error(`Failed to log notification: ${(err as Error).message}`);
    }
  }

  async send(params: {
    businessId: string;
    type: NotificationType;
    recipientEmail: string;
    recipientName: string;
    contactId?: string;
    templateData: Record<string, any>;
    dedupeKey?: string;
  }): Promise<{ status: 'SENT' | 'FAILED' | 'QUEUED'; messageId?: string }> {
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

    if (params.dedupeKey) {
      const existing = await this.prisma.client.customerNotificationLog.findFirst({
        where: {
          businessId: params.businessId,
          messageId: params.dedupeKey,
          status: { in: ['SENT', 'QUEUED', 'DRAINED'] },
        },
        select: { id: true, status: true, messageId: true },
      });
      if (existing) {
        this.logger.debug(
          `Skipping duplicate ${params.type} for ${params.recipientEmail} (dedupeKey=${params.dedupeKey})`,
        );
        return { status: existing.status as 'SENT' | 'QUEUED', messageId: existing.messageId ?? undefined };
      }
    }

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
      this.logger.error(`Template rendering failed for ${params.type}: ${(err as Error).message}`);
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

        this.logger.log(`Sent ${params.type} to ${params.recipientEmail} for business ${params.businessId}`);
        return { status: 'SENT', messageId: result.messageId };
      } catch (err: any) {
        lastError = err as Error;
        this.logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for ${params.type} to ${params.recipientEmail}: ${lastError.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }

    this.logger.error(`All ${MAX_RETRIES} attempts failed for ${params.type} to ${params.recipientEmail}: ${lastError?.message}`);
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
        this.logger.error(`Queue drain failed for entry ${entry.id}: ${(err as Error).message}`);
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
