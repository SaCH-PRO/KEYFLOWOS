import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { KeyInboxMessage, KeyInboxThread } from '@prisma/client';
import { BusinessEventService } from '../business-events/business-event.service';
import type { EventSource } from '../business-events/dto/create-business-event.dto';
import type { InboxAnalysis, InboxSuggestedAction } from './key-inbox.types';

@Injectable()
export class KeyInboxTemporalEmitterService {
  private readonly logger = new Logger(KeyInboxTemporalEmitterService.name);

  constructor(
    @Inject(BusinessEventService) private readonly businessEventService: BusinessEventService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async emitMessageReceived(businessId: string, message: KeyInboxMessage): Promise<void> {
    const source = this.normalizeSource(message.channel);
    const payload = {
      businessId,
      messageId: message.id,
      threadId: message.threadId,
      channel: message.channel,
      direction: message.direction,
      senderHandle: message.senderHandle,
      senderEmail: message.senderEmail,
      receivedAt: message.receivedAt,
    };

    await this.businessEventService.emit({
      businessId,
      eventType: 'key_inbox.message_received',
      subjectType: 'KeyInboxMessage',
      subjectId: message.id,
      actorType: 'system',
      actorId: 'key_inbox_ai',
      action: 'receive',
      source,
      after: payload,
      metadata: { feature: 'key_inbox' },
    });

    this.events.emit('key_inbox.message_received', payload);
  }

  async emitMessageAnalyzed(businessId: string, thread: KeyInboxThread, analysis: InboxAnalysis): Promise<void> {
    const source = this.normalizeSource(thread.channel);
    const payload = {
      businessId,
      threadId: thread.id,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      urgency: analysis.urgency,
      confidence: analysis.confidence,
      summary: analysis.summary,
      entities: analysis.entities,
    };

    await this.businessEventService.emit({
      businessId,
      eventType: 'key_inbox.message_analyzed',
      subjectType: 'KeyInboxThread',
      subjectId: thread.id,
      actorType: 'ai',
      actorId: 'key_inbox_ai',
      action: 'analyze',
      source,
      after: payload,
      metadata: {
        feature: 'key_inbox',
        confidence: analysis.confidence,
        intent: analysis.intent,
      },
    });

    this.events.emit('key_inbox.message_analyzed', payload);
  }

  async emitActionSuggested(
    businessId: string,
    thread: KeyInboxThread,
    actions: InboxSuggestedAction[],
  ): Promise<void> {
    const source = this.normalizeSource(thread.channel);
    const payload = {
      businessId,
      threadId: thread.id,
      actions,
    };

    await this.businessEventService.emit({
      businessId,
      eventType: 'key_inbox.actions_suggested',
      subjectType: 'KeyInboxThread',
      subjectId: thread.id,
      actorType: 'ai',
      actorId: 'key_inbox_ai',
      action: 'suggest_actions',
      source,
      after: payload,
      metadata: {
        feature: 'key_inbox',
        actionCount: actions.length,
      },
    });

    this.events.emit('key_inbox.actions_suggested', payload);
  }

  async emitBriefGenerated(
    businessId: string,
    insightId: string,
    scope: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const payload = {
      businessId,
      insightId,
      scope,
      periodStart,
      periodEnd,
    };

    await this.businessEventService.emit({
      businessId,
      eventType: 'key_inbox.brief_generated',
      subjectType: 'KeyInboxInsight',
      subjectId: insightId,
      actorType: 'ai',
      actorId: 'key_inbox_ai',
      action: 'generate_brief',
      source: 'ai',
      after: payload,
      metadata: {
        feature: 'key_inbox',
        scope,
      },
    });

    this.events.emit('key_inbox.brief_generated', payload);
  }

  private normalizeSource(channel?: string | null): EventSource {
    if (!channel) return 'api';
    const normalized = channel.toLowerCase();
    const validSources: EventSource[] = [
      'web',
      'mobile',
      'email',
      'whatsapp',
      'api',
      'worker',
      'ai',
    ];
    return validSources.includes(normalized as EventSource) ? (normalized as EventSource) : 'api';
  }
}
