import { Inject, Injectable, Logger } from '@nestjs/common';
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
} from './email-templates';

export type NotificationType =
  | 'booking_confirmed'
  | 'booking_reminder'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'invoice_sent'
  | 'payment_receipt';

export interface NotificationPreferences {
  booking_confirmed?: boolean;
  booking_reminder?: boolean;
  booking_rescheduled?: boolean;
  booking_cancelled?: boolean;
  invoice_sent?: boolean;
  payment_receipt?: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  booking_confirmed: true,
  booking_reminder: true,
  booking_rescheduled: true,
  booking_cancelled: true,
  invoice_sent: true,
  payment_receipt: true,
};

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GmailService) private readonly gmail: GmailService,
  ) {}

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
  }) {
    try {
      await (this.prisma.client as any).customerNotificationLog.create({
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
      data: { notificationPreferences: updated as any },
    });
    return updated;
  }

  async getNotificationLog(businessId: string, opts?: { limit?: number; type?: string }) {
    return (this.prisma.client as any).customerNotificationLog.findMany({
      where: {
        businessId,
        ...(opts?.type ? { type: opts.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }
}
