import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GmailService } from '../commerce/gmail.service';
import {
  TemplateContext,
  bookingConfirmedTemplate,
  bookingReminderTemplate,
  bookingRescheduledTemplate,
  bookingCancelledTemplate,
  invoiceSentTemplate,
  paymentReceiptTemplate,
  orderConfirmedTemplate,
  orderShippedTemplate,
  orderDeliveredTemplate,
  orderRefundedTemplate,
  orderCancelledTemplate,
  sellerNewOrderTemplate,
  sellerLowStockTemplate,
  documentGeneratedTemplate,
} from './email-templates';

export type NotificationType =
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'invoice_sent'
  | 'payment_receipt'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_refunded'
  | 'order_cancelled'
  | 'seller_new_order'
  | 'seller_low_stock'
  | 'document_generated';

export interface NotificationPreferences {
  booking_confirmed?: boolean;
  booking_reminder?: boolean;
  booking_rescheduled?: boolean;
  booking_cancelled?: boolean;
  invoice_sent?: boolean;
  payment_receipt?: boolean;
  order_confirmed?: boolean;
  order_shipped?: boolean;
  order_delivered?: boolean;
  order_refunded?: boolean;
  order_cancelled?: boolean;
  seller_new_order?: boolean;
  seller_low_stock?: boolean;
  document_generated?: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  booking_confirmed: true,
  booking_reminder: true,
  booking_rescheduled: true,
  booking_cancelled: true,
  invoice_sent: true,
  payment_receipt: true,
  order_confirmed: true,
  order_shipped: true,
  order_delivered: true,
  order_refunded: true,
  order_cancelled: true,
  seller_new_order: true,
  seller_low_stock: true,
  document_generated: true,
};

const QUEUE_DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const QUEUE_DRAIN_BATCH_SIZE = 20;
const QUEUE_MAX_AGE_HOURS = 48;

@Injectable()
export class TransactionalEmailService implements OnModuleInit {
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
    } catch (err) {
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
          });
          break;
        case 'booking_cancelled':
          rendered = bookingCancelledTemplate({
            ...baseCtx,
            serviceName: data.serviceName,
            startTime: data.startTime,
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
        default:
          this.logger.warn(`Unknown notification type: ${params.type}`);
          return { status: 'FAILED' };
      }
    } catch (err) {
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

        this.logger.log(`Sent ${params.type} to ${params.recipientEmail} for business ${params.businessId}`);
        return { status: 'SENT', messageId: result.messageId };
      } catch (err) {
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
      } catch (err) {
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
