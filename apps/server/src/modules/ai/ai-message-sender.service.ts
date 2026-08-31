import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GmailService } from '../commerce/gmail.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { TimelineService } from '../timeline/timeline.service';

export interface SendMessageParams {
  businessId: string;
  contactId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  subject?: string;
  body: string;
  fromName?: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  channel: string;
  error?: string;
  fallback?: string;
}

@Injectable()
export class AiMessageSenderService {
  private readonly logger = new Logger(AiMessageSenderService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Optional() @Inject(GmailService) private readonly gmail: GmailService | undefined,
    @Optional() @Inject(SystemEmailService) private readonly systemEmail: SystemEmailService | undefined,
    @Optional() @Inject(forwardRef(() => WhatsAppService)) private readonly whatsapp: WhatsAppService | undefined,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: params.contactId, businessId: params.businessId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        preferredChannel: true,
      },
    });

    if (!contact) {
      return { success: false, channel: params.channel, error: 'Contact not found' };
    }

    switch (params.channel) {
      case 'email':
        return this.sendEmail(params, contact);
      case 'whatsapp':
        return this.sendWhatsApp(params, contact);
      case 'sms':
        return this.sendSms(params, contact);
      default:
        return { success: false, channel: params.channel, error: 'Unsupported channel' };
    }
  }

  private async sendEmail(
    params: SendMessageParams,
    contact: { email: string | null; firstName: string | null; lastName: string | null },
  ): Promise<SendMessageResult> {
    const to = contact.email;
    if (!to) {
      return { success: false, channel: 'email', error: 'Contact has no email address' };
    }

    const subject = params.subject ?? 'Message from your business';

    try {
      // Try Gmail first (business-connected account)
      if (!this.gmail) {
        throw new Error('Gmail service not available');
      }
      const result = await this.gmail.sendEmail({
        businessId: params.businessId,
        to,
        subject,
        htmlBody: this.wrapHtmlBody(params.body, params.fromName),
      });

      await this.logCommunication(params.businessId, params.contactId, 'email', 'out', {
        to,
        subject,
        messageId: result.messageId,
        body: params.body,
      });

      return { success: true, channel: 'email', messageId: result.messageId };
    } catch (gmailErr) {
      this.logger.warn(`Gmail send failed, trying fallback: ${(gmailErr as Error).message}`);

      // Fallback to Resend (system email)
      if (this.systemEmail?.isConfigured()) {
        try {
          const result = await this.systemEmail!.sendTransactional({
            to,
            subject,
            html: this.wrapHtmlBody(params.body, params.fromName),
          });

          await this.logCommunication(params.businessId, params.contactId, 'email', 'out', {
            to,
            subject,
            messageId: result.id,
            body: params.body,
            source: 'resend_fallback',
          });

          return { success: true, channel: 'email', messageId: result.id, fallback: 'resend' };
        } catch (resendErr) {
          this.logger.error(`Resend fallback also failed: ${(resendErr as Error).message}`);
        }
      }

      return { success: false, channel: 'email', error: (gmailErr as Error).message };
    }
  }

  private async sendWhatsApp(
    params: SendMessageParams,
    contact: { phone: string | null; whatsappNumber: string | null },
  ): Promise<SendMessageResult> {
    const phone = contact.whatsappNumber || contact.phone;
    if (!phone) {
      return { success: false, channel: 'whatsapp', error: 'Contact has no phone number' };
    }

    try {
      if (!this.whatsapp) {
        return { success: false, channel: 'whatsapp', error: 'WhatsApp service not available' };
      }
      const result = await this.whatsapp.sendMessage(params.businessId, {
        to: phone,
        body: params.body,
      });

      if (result.success) {
        await this.logCommunication(params.businessId, params.contactId, 'whatsapp', 'out', {
          to: phone,
          body: params.body,
          messageId: result.messageId,
        });
        return { success: true, channel: 'whatsapp', messageId: result.messageId };
      }

      return { success: false, channel: 'whatsapp', error: result.error };
    } catch (err: any) {
      return { success: false, channel: 'whatsapp', error: (err as Error).message };
    }
  }

  private async sendSms(
    params: SendMessageParams,
    contact: { phone: string | null },
  ): Promise<SendMessageResult> {
    const phone = contact.phone;
    if (!phone) {
      return { success: false, channel: 'sms', error: 'Contact has no phone number' };
    }

    // For now, SMS falls back to WhatsApp (Twilio) since Twilio supports both
    // In the future, add dedicated Twilio SMS path
    if (!this.whatsapp) {
      return { success: false, channel: 'sms', error: 'WhatsApp service not available' };
    }
    try {
      const result = await this.whatsapp.sendMessage(params.businessId, {
        to: phone,
        body: params.body,
      });

      if (result.success) {
        await this.logCommunication(params.businessId, params.contactId, 'sms', 'out', {
          to: phone,
          body: params.body,
          messageId: result.messageId,
        });
        return { success: true, channel: 'sms', messageId: result.messageId };
      }

      return { success: false, channel: 'sms', error: result.error };
    } catch (err: any) {
      return { success: false, channel: 'sms', error: (err as Error).message };
    }
  }

  private wrapHtmlBody(body: string, fromName?: string): string {
    const sanitized = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.6;color:#333;">
${sanitized}
${fromName ? `<br><br>— ${fromName}` : ''}
</body></html>`;
  }

  private async logCommunication(
    businessId: string,
    contactId: string,
    channel: string,
    direction: string,
    meta: Record<string, any>,
  ): Promise<void> {
    await this.timeline.recordContactEvent(businessId, contactId, `message.${direction}`, {
      channel,
      ...meta,
    }).catch(() => {});

    this.events.emit('message.sent', {
      businessId,
      contactId,
      channel,
      direction,
      meta,
    });
  }
}
