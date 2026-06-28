import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  AiMessageSenderService,
  SendMessageParams,
  SendMessageResult,
} from '../ai/ai-message-sender.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { KeyInboxReplySenderService } from '../key-inbox/key-inbox-reply-sender.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { OutboundContentService } from './outbound-content.service';

export interface SendMessageInput {
  businessId: string;
  contactId: string;
  channel: 'email' | 'whatsapp' | 'sms';
  body: string;
  subject?: string;
  templateId?: string;
  attachments?: string[];
  scheduledAt?: string;
}

export interface SendBroadcastInput {
  businessId: string;
  segment: string;
  channel: 'email' | 'whatsapp' | 'sms';
  body: string;
  templateId?: string;
}

export interface SendReplyInput {
  businessId: string;
  conversationId: string;
  body: string;
  attachments?: string[] | Record<string, unknown>[];
}

export interface ConversationInput {
  businessId: string;
  conversationId: string;
}

export interface GetConversationInput {
  businessId: string;
  contactId: string;
  channel?: string;
  limit?: number;
}

export interface CreateTemplateInput {
  businessId: string;
  name: string;
  channel: string;
  subject?: string;
  body: string;
  variables?: string[];
}

export interface DeleteTemplateInput {
  businessId: string;
  templateId: string;
}

export interface BroadcastResult {
  success: boolean;
  contentId: string;
  queued: number;
  error?: string;
}

export interface TemplateResult {
  success: boolean;
  templateId: string;
  name: string;
  channel: string;
}

/**
 * Unified communications facade.
 *
 * Delegates to the real sending infrastructure already present in the monorepo:
 * - AiMessageSenderService for 1:1 email / WhatsApp / SMS messages.
 * - DeliveryQueueService + OutboundContentService for broadcasts.
 * - KeyInboxService / KeyInboxReplySenderService for conversation reads/replies.
 */
@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageSender: AiMessageSenderService,
    private readonly deliveryQueue: DeliveryQueueService,
    private readonly outboundContent: OutboundContentService,
    private readonly inbox: KeyInboxService,
    private readonly replySender: KeyInboxReplySenderService,
  ) {}

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const params: SendMessageParams = {
      businessId: input.businessId,
      contactId: input.contactId,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
    };

    if (input.scheduledAt) {
      this.logger.warn(
        `sendMessage scheduledAt is not supported for 1:1 sends; sending immediately (business=${input.businessId})`,
      );
    }

    return this.messageSender.sendMessage(params);
  }

  async sendWhatsapp(input: Omit<SendMessageInput, 'channel' | 'subject'>): Promise<SendMessageResult> {
    return this.sendMessage({
      ...input,
      channel: 'whatsapp',
    });
  }

  async sendEmail(input: Omit<SendMessageInput, 'channel'>): Promise<SendMessageResult> {
    return this.sendMessage({
      ...input,
      channel: 'email',
    });
  }

  async sendBroadcast(input: SendBroadcastInput): Promise<BroadcastResult> {
    const contentType = input.channel === 'whatsapp' ? 'whatsapp_message' : 'campaign_email';
    const platform = input.channel === 'whatsapp' ? 'WHATSAPP' : 'EMAIL';

    const destination = await this.prisma.client.channelDestination.findFirst({
      where: {
        businessId: input.businessId,
        isActive: true,
        connection: { provider: input.channel === 'whatsapp' ? 'WHATSAPP' : { in: ['EMAIL', 'GOOGLE'] } },
      },
      include: { connection: true },
    });

    if (!destination) {
      const error = `No active ${input.channel} destination found for business ${input.businessId}`;
      this.logger.error(error);
      return { success: false, contentId: '', queued: 0, error };
    }

    const content = await this.outboundContent.create(input.businessId, {
      contentType,
      subject: input.channel === 'email' ? input.segment : undefined,
      body: input.body,
      contentMeta: {
        segmentTags: [input.segment],
        templateId: input.templateId,
      },
      variants: [
        {
          platform,
          textBody: input.body,
        },
      ],
    });

    const result = await this.deliveryQueue.publishNow(input.businessId, content.id, [destination.id]);

    return {
      success: true,
      contentId: content.id,
      queued: result.queued,
    };
  }

  async sendReply(input: SendReplyInput): Promise<{
    success: boolean;
    status: string;
    messageId?: string;
    error?: string;
  }> {
    const normalizedAttachments = input.attachments?.map((a) =>
      typeof a === 'string' ? { url: a } : a,
    );

    const result = await this.inbox.addReply(
      input.businessId,
      input.conversationId,
      input.body,
      normalizedAttachments,
      { mode: 'send' },
    );

    return {
      success: result.sendResult?.success ?? true,
      status: result.sendResult?.status ?? 'SENT',
      messageId: result.message?.id,
      error: result.sendResult?.error,
    };
  }

  async getConversation(input: GetConversationInput): Promise<unknown> {
    if (!input.contactId) {
      throw new NotFoundException('contactId is required');
    }

    const threads = await this.inbox.listThreads(input.businessId, {
      search: input.contactId,
      channel: input.channel && input.channel !== 'all' ? input.channel : undefined,
      limit: input.limit ?? 50,
    });

    return {
      contactId: input.contactId,
      channel: input.channel ?? 'all',
      threads,
    };
  }

  async getUnreadConversations(input: { businessId: string; limit?: number }): Promise<unknown[]> {
    return this.inbox.listThreads(input.businessId, {
      status: 'OPEN',
      limit: input.limit ?? 50,
    });
  }

  async markRead(input: ConversationInput): Promise<{ success: boolean }> {
    await this.inbox.updateThread(input.businessId, input.conversationId, { status: 'DONE' });
    return { success: true };
  }

  async archiveConversation(input: ConversationInput): Promise<{ success: boolean }> {
    await this.inbox.updateThread(input.businessId, input.conversationId, { status: 'ARCHIVED' });
    return { success: true };
  }

  async createTemplate(input: CreateTemplateInput): Promise<TemplateResult> {
    const content = await this.outboundContent.create(input.businessId, {
      contentType: 'template',
      subject: input.subject,
      body: input.body,
      contentMeta: {
        name: input.name,
        channel: input.channel,
        variables: input.variables ?? [],
      },
    });

    return {
      success: true,
      templateId: content.id,
      name: input.name,
      channel: input.channel,
    };
  }

  async deleteTemplate(input: DeleteTemplateInput): Promise<{ success: boolean; deleted: boolean }> {
    await this.outboundContent.delete(input.businessId, input.templateId);
    return { success: true, deleted: true };
  }
}
