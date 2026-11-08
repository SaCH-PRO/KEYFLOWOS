import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { KeyInboxMessage, KeyInboxThread } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessEventService } from '../business-events/business-event.service';
import { KEY_INBOX_CHANNELS, KEY_INBOX_SEND_STATUSES } from './key-inbox.constants';

export type SendReplyStatus = 'DRAFT' | 'QUEUED' | 'SENT' | 'FAILED' | 'NOT_SUPPORTED';

export interface SendReplyResult {
  success: boolean;
  status: SendReplyStatus;
  providerMessageId?: string;
  error?: string;
  sentVia?: string;
}

@Injectable()
export class KeyInboxReplySenderService {
  private readonly logger = new Logger(KeyInboxReplySenderService.name);
  private whatsappServiceCache: any = null;
  private gmailServiceCache: any = null;

  constructor(
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessEventService) private readonly businessEvents: BusinessEventService,
  ) {}

  async sendReply(
    businessId: string,
    thread: KeyInboxThread,
    message: KeyInboxMessage,
    userId?: string,
  ): Promise<SendReplyResult> {
    const channel = thread.channel?.toLowerCase() ?? '';
    const referenceMessage = await this.getLatestInboundMessage(thread.id);

    if (channel === KEY_INBOX_CHANNELS.WHATSAPP || channel === KEY_INBOX_CHANNELS.SMS) {
      return this.sendViaWhatsApp(businessId, thread, message, referenceMessage, userId);
    }

    if (channel === KEY_INBOX_CHANNELS.EMAIL) {
      return this.sendViaGmail(businessId, thread, message, referenceMessage, userId);
    }

    if (channel === KEY_INBOX_CHANNELS.FACEBOOK_MESSENGER || channel === KEY_INBOX_CHANNELS.INSTAGRAM_DM) {
      return this.sendViaMetaStub(businessId, thread, message, userId);
    }

    const result: SendReplyResult = {
      success: false,
      status: KEY_INBOX_SEND_STATUSES.NOT_SUPPORTED,
      error: `Outbound replies are not supported for channel: ${thread.channel}`,
      sentVia: undefined,
    };
    await this.persistSendResult(message.id, result, userId);
    this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
    return result;
  }

  emitDraftEvent(businessId: string, threadId: string, messageId: string, userId?: string): void {
    this.emitReplyEvent(businessId, threadId, messageId, 'key_inbox.reply_drafted', userId, {
      success: true,
      status: KEY_INBOX_SEND_STATUSES.DRAFT,
    });
  }

  private async sendViaWhatsApp(
    businessId: string,
    thread: KeyInboxThread,
    message: KeyInboxMessage,
    referenceMessage: KeyInboxMessage | null,
    userId?: string,
  ): Promise<SendReplyResult> {
    const to = referenceMessage?.senderPhone ?? (thread.metadata as Record<string, unknown> | null)?.senderPhone;
    if (!to || typeof to !== 'string') {
      const result: SendReplyResult = {
        success: false,
        status: KEY_INBOX_SEND_STATUSES.FAILED,
        error: 'No recipient phone number found for WhatsApp reply',
        sentVia: 'whatsapp',
      };
      await this.persistSendResult(message.id, result, userId);
      this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
      return result;
    }

    const whatsappService = await this.getWhatsAppService();
    if (!whatsappService) {
      const result: SendReplyResult = {
        success: false,
        status: KEY_INBOX_SEND_STATUSES.FAILED,
        error: 'WhatsApp service is not available',
        sentVia: 'whatsapp',
      };
      await this.persistSendResult(message.id, result, userId);
      this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
      return result;
    }

    try {
      const sendResult = await whatsappService.sendMessage(businessId, {
        to,
        body: message.contentText ?? '',
      });

      const result: SendReplyResult = sendResult.success
        ? { success: true, status: 'SENT', sentVia: 'whatsapp' }
        : { success: false, status: 'FAILED', error: sendResult.error ?? 'WhatsApp send failed', sentVia: 'whatsapp' };

      await this.persistSendResult(message.id, result, userId);
      this.emitReplyEvent(
        businessId,
        thread.id,
        message.id,
        result.success ? 'key_inbox.reply_sent' : 'key_inbox.reply_failed',
        userId,
        result,
      );
      return result;
    } catch (err: any) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`WhatsApp reply failed for message ${message.id}: ${error}`);
      const result: SendReplyResult = { success: false, status: 'FAILED', error, sentVia: 'whatsapp' };
      await this.persistSendResult(message.id, result, userId);
      this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
      return result;
    }
  }

  private async sendViaGmail(
    businessId: string,
    thread: KeyInboxThread,
    message: KeyInboxMessage,
    referenceMessage: KeyInboxMessage | null,
    userId?: string,
  ): Promise<SendReplyResult> {
    const to = referenceMessage?.senderEmail ?? (thread.metadata as Record<string, unknown> | null)?.senderEmail;
    if (!to || typeof to !== 'string') {
      const result: SendReplyResult = {
        success: false,
        status: KEY_INBOX_SEND_STATUSES.FAILED,
        error: 'No recipient email found for Gmail reply',
        sentVia: 'gmail',
      };
      await this.persistSendResult(message.id, result, userId);
      this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
      return result;
    }

    const subject = thread.subject ?? 'Re:';
    const htmlBody = message.contentHtml ?? `<div>${this.escapeHtml(message.contentText ?? '')}</div>`;

    const gmailService = await this.getGmailService();
    if (gmailService) {
      try {
        let providerResult: { messageId?: string; threadId?: string } | undefined;

        if (thread.externalThreadId && referenceMessage?.externalMessageId) {
          providerResult = await gmailService.sendReply({
            businessId,
            threadId: thread.externalThreadId,
            inReplyTo: referenceMessage.externalMessageId,
            to,
            subject,
            htmlBody,
          });
        } else {
          providerResult = await gmailService.sendEmail({
            businessId,
            to,
            subject,
            htmlBody,
          });
        }

        const result: SendReplyResult = {
          success: true,
          status: KEY_INBOX_SEND_STATUSES.SENT,
          providerMessageId: providerResult?.messageId,
          sentVia: 'gmail',
        };
        await this.persistSendResult(message.id, result, userId);
        this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_sent', userId, result);
        return result;
      } catch (err: any) {
        const error = err instanceof Error ? err.message : String(err);
        if (!/gmail not connected/i.test(error)) {
          this.logger.error(`Gmail reply failed for message ${message.id}: ${error}`);
          const result: SendReplyResult = { success: false, status: 'FAILED', error, sentVia: 'gmail' };
          await this.persistSendResult(message.id, result, userId);
          this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
          return result;
        }
      }
    }

    // Platform ESP (Resend) fallback when Gmail OAuth is not connected for this business.
    const espFallbackResult = await this.trySendViaPlatformEsp(businessId, to, subject, htmlBody, message.contentText ?? undefined);
    if (espFallbackResult) {
      await this.persistSendResult(message.id, espFallbackResult, userId);
      this.emitReplyEvent(
        businessId,
        thread.id,
        message.id,
        espFallbackResult.success ? 'key_inbox.reply_sent' : 'key_inbox.reply_failed',
        userId,
        espFallbackResult,
      );
      return espFallbackResult;
    }

    const result: SendReplyResult = {
      success: false,
      status: KEY_INBOX_SEND_STATUSES.FAILED,
      error: gmailService ? 'Gmail not connected' : 'Gmail service is not available',
      sentVia: 'gmail',
    };
    await this.persistSendResult(message.id, result, userId);
    this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
    return result;
  }

  private async trySendViaPlatformEsp(
    businessId: string,
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<SendReplyResult | null> {
    try {
      const [{ ResendEmailAdapter }, { SystemEmailService }] = await Promise.all([
        import('../communications/adapters/resend-email-adapter'),
        import('../notifications/system-email.service'),
      ]);
      if (!ResendEmailAdapter.isEnabled()) return null;
      const systemEmail = new SystemEmailService();
      if (!systemEmail.isConfigured()) return null;

      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { email: true },
      });

      const sent = await systemEmail.sendTransactional({
        to,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        html,
        text,
        replyTo: business?.email ?? undefined,
      });

      return {
        success: true,
        status: KEY_INBOX_SEND_STATUSES.SENT,
        providerMessageId: sent.id,
        sentVia: 'resend',
      };
    } catch (err: any) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Platform ESP fallback failed for business ${businessId}: ${error}`);
      return {
        success: false,
        status: KEY_INBOX_SEND_STATUSES.FAILED,
        error,
        sentVia: 'resend',
      };
    }
  }

  private async sendViaMetaStub(
    businessId: string,
    thread: KeyInboxThread,
    message: KeyInboxMessage,
    userId?: string,
  ): Promise<SendReplyResult> {
    const result: SendReplyResult = {
      success: false,
      status: KEY_INBOX_SEND_STATUSES.NOT_SUPPORTED,
      error: 'Meta outbound DMs are not enabled for this channel. Configure app review and permissions to enable sending.',
      sentVia: thread.channel ?? 'meta',
    };
    await this.persistSendResult(message.id, result, userId);
    this.emitReplyEvent(businessId, thread.id, message.id, 'key_inbox.reply_failed', userId, result);
    return result;
  }

  private async getLatestInboundMessage(threadId: string): Promise<KeyInboxMessage | null> {
    return this.prisma.client.keyInboxMessage.findFirst({
      where: { threadId, direction: 'INBOUND' },
      orderBy: { receivedAt: 'desc' },
    });
  }

  private async getWhatsAppService(): Promise<any | null> {
    if (this.whatsappServiceCache) return this.whatsappServiceCache;
    try {
      const mod = await import('../whatsapp/whatsapp.service');
      this.whatsappServiceCache = this.moduleRef.get(mod.WhatsAppService, { strict: false });
      return this.whatsappServiceCache;
    } catch (err: any) {
      this.logger.warn(`Unable to resolve WhatsAppService: ${(err as Error).message}`);
      return null;
    }
  }

  private async getGmailService(): Promise<any | null> {
    if (this.gmailServiceCache) return this.gmailServiceCache;
    try {
      const mod = await import('../commerce/gmail.service');
      this.gmailServiceCache = this.moduleRef.get(mod.GmailService, { strict: false });
      return this.gmailServiceCache;
    } catch (err: any) {
      this.logger.warn(`Unable to resolve GmailService: ${(err as Error).message}`);
      return null;
    }
  }

  private async persistSendResult(
    messageId: string,
    result: SendReplyResult,
    userId?: string,
  ): Promise<void> {
    await this.prisma.client.keyInboxMessage.update({
      where: { id: messageId },
      data: {
        sendStatus: result.status,
        providerMessageId: result.providerMessageId ?? null,
        sendError: result.error ?? null,
        sentByUserId: userId ?? null,
        sentVia: result.sentVia ?? null,
      },
    });
  }

  private emitReplyEvent(
    businessId: string,
    threadId: string,
    messageId: string,
    eventType: string,
    userId: string | undefined,
    result: Partial<SendReplyResult>,
  ): void {
    this.businessEvents
      .emit({
        businessId,
        eventType,
        subjectType: 'KeyInboxMessage',
        subjectId: messageId,
        actorType: 'human',
        actorId: userId ?? 'system',
        action: eventType.replace(/^key_inbox\./, ''),
        source: 'web',
        metadata: { threadId, ...result },
      })
      .catch((err) => this.logger.warn(`Failed to emit ${eventType}: ${(err as Error).message}`));
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
