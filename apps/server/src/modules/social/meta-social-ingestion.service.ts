import { Inject, Injectable, Logger } from '@nestjs/common';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface MetaSocialInboundResult {
  contactId: string;
  isNew: boolean;
  threadId: string;
  messageId: string;
}

interface LegacyDmBody {
  type?: string;
  platform?: string;
  from?: { id?: string; name?: string };
  message?: string;
  externalId?: string;
}

interface MetaMessagingMessage {
  mid?: string;
  text?: string;
  attachments?: Array<{ type?: string; payload?: { url?: string } }>;
}

interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MetaMessagingMessage;
}

interface MetaEntry {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: MetaEntry[];
}

@Injectable()
export class MetaSocialIngestionService {
  private readonly logger = new Logger(MetaSocialIngestionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async receiveInbound(
    businessId: string,
    rawPayload: unknown,
  ): Promise<MetaSocialInboundResult> {
    const parsed = this.parseInbound(rawPayload);
    if (!parsed) {
      throw new Error('Unrecognized Meta social webhook payload');
    }

    const { channel, senderId, senderName, text, externalMessageId, receivedAt, provider, isLegacy } = parsed;

    if (!senderId) {
      throw new Error('Missing sender id');
    }

    if (externalMessageId) {
      const existing = await this.prisma.client.keyInboxMessage.findFirst({
        where: { businessId, channel, externalMessageId },
      });
      if (existing) {
        this.logger.debug(`Duplicate ${channel} message ${externalMessageId} ignored`);
        const thread = await this.prisma.client.keyInboxThread.findFirst({
          where: { id: existing.threadId, businessId },
        });
        return {
          contactId: thread?.contactId ?? '',
          isNew: false,
          threadId: existing.threadId,
          messageId: existing.id,
        };
      }
    }

    const [firstName, ...rest] = (senderName ?? '').split(' ');
    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: `meta_${channel}`,
      externalId: senderId,
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
    });

    if (isLegacy) {
      await this.recordLegacyEngagement(businessId, channel, senderId, senderName, text, externalMessageId);
    }

    const subject = this.truncate(text ?? `New ${channel} message`, 100);

    const thread = await this.keyInbox.upsertThread({
      businessId,
      channel,
      externalThreadId: senderId,
      contactId: resolved.contactId || undefined,
      subject,
      status: 'OPEN',
      priority: 'NORMAL',
      metadata: { provider, rawPayload },
    });

    const { message } = await this.keyInbox.addMessage({
      businessId,
      threadId: thread.id,
      channel,
      direction: 'INBOUND',
      senderName: senderName ?? null,
      senderHandle: senderId,
      senderEmail: null,
      senderPhone: null,
      contentText: text ?? null,
      contentHtml: null,
      attachments: this.extractAttachments(parsed.attachments),
      externalMessageId: externalMessageId ?? null,
      receivedAt,
      metadata: { provider, rawPayload },
    });

    return {
      contactId: resolved.contactId,
      isNew: resolved.isNew,
      threadId: thread.id,
      messageId: message.id,
    };
  }

  private parseInbound(
    rawPayload: unknown,
  ): {
    channel: 'instagram' | 'messenger';
    senderId: string;
    senderName?: string;
    text?: string;
    externalMessageId?: string;
    receivedAt: Date;
    provider: 'meta';
    isLegacy: boolean;
    attachments?: MetaMessagingMessage['attachments'];
  } | null {
    const payload = rawPayload as MetaWebhookBody & LegacyDmBody;

    // Legacy simplified shape used by earlier integrations/tests.
    if (
      typeof payload.type === 'string' &&
      payload.type.toUpperCase() === 'DM' &&
      typeof payload.from?.id === 'string'
    ) {
      const platform = (payload.platform ?? '').toLowerCase();
      const channel = platform === 'instagram' ? 'instagram' : 'messenger';
      return {
        channel,
        senderId: payload.from.id,
        senderName: payload.from.name,
        text: payload.message ?? undefined,
        externalMessageId: payload.externalId,
        receivedAt: new Date(),
        provider: 'meta',
        isLegacy: true,
      };
    }

    // Real Meta Graph webhook shape (page / instagram).
    if (Array.isArray(payload.entry) && payload.entry.length > 0) {
      const object = (payload.object ?? '').toLowerCase();
      const channel: 'instagram' | 'messenger' = object === 'instagram' ? 'instagram' : 'messenger';
      const event = payload.entry[0]?.messaging?.[0];
      const message = event?.message;

      if (event?.sender?.id && message) {
        return {
          channel,
          senderId: event.sender.id,
          senderName: undefined,
          text: message.text,
          externalMessageId: message.mid,
          receivedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
          provider: 'meta',
          isLegacy: false,
          attachments: message.attachments,
        };
      }
    }

    return null;
  }

  private async recordLegacyEngagement(
    businessId: string,
    channel: 'instagram' | 'messenger',
    senderId: string,
    senderName: string | undefined,
    text: string | undefined,
    externalId: string | undefined,
  ): Promise<void> {
    try {
      await this.prisma.client.socialEngagement.create({
        data: {
          businessId,
          platform: channel === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK',
          type: 'DM',
          externalId: externalId ?? null,
          fromUserId: senderId,
          fromUserName: senderName ?? null,
          content: text ?? null,
          aiHandled: false,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record legacy social engagement: ${(err as Error).message}`);
    }
  }

  private extractAttachments(
    attachments?: MetaMessagingMessage['attachments'],
  ): Record<string, unknown>[] {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    return attachments.map((a) => ({
      type: a.type ?? 'unknown',
      url: a.payload?.url ?? null,
    }));
  }

  private truncate(value: string, maxLength: number): string {
    if (!value) return value;
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  }
}
