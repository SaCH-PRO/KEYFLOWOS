import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InteractionClassifierService } from './interaction-classifier.service';
import { ProfitTrajectoryService } from './profit-trajectory.service';
import { ResponseDraftService } from './response-draft.service';
import { TriggerDefinitionService } from './trigger-definition.service';
import { CommandService } from '../command/command.service';

interface MessageReceivedEvent {
  connectorType: string;
  businessId: string;
  channel: string;
  from: string;
  to?: string;
  subject?: string;
  body?: string;
  externalId?: string | null;
  contactId: string | null;
  timestamp: Date;
}

/**
 * Omnichannel inbound message processor.
 *
 * Listens for `message.received` events and:
 * 1. Creates/updates a ConversationThread
 * 2. Creates a ConversationMessage
 * 3. Classifies the interaction intent
 * 4. Scores profit trajectory
 * 5. Generates a KEY response draft (if appropriate)
 * 6. Creates a CommandItem for high-value/risk interactions
 * 7. Evaluates automation triggers
 */
@Injectable()
export class OmnichannelProcessorService implements OnModuleInit {
  private readonly logger = new Logger(OmnichannelProcessorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(InteractionClassifierService) private readonly classifier: InteractionClassifierService,
    @Inject(ProfitTrajectoryService) private readonly profit: ProfitTrajectoryService,
    @Inject(ResponseDraftService) private readonly drafts: ResponseDraftService,
    @Inject(TriggerDefinitionService) private readonly triggers: TriggerDefinitionService,
    @Inject(CommandService) private readonly commands: CommandService,
  ) {}

  onModuleInit() {
    this.events.on('message.received', async (payload: MessageReceivedEvent) => {
      try {
        await this.processInbound(payload);
      } catch (e) {
        this.logger.error(`Failed to process inbound message: ${(e as Error).message}`);
      }
    });

    this.logger.log('Omnichannel processor listening for message.received events');
  }

  async processInbound(event: MessageReceivedEvent) {
    const { businessId, contactId, channel, body, subject, from, timestamp } = event;

    if (!businessId) {
      this.logger.warn('Inbound message missing businessId');
      return;
    }

    // 1. Find or create thread
    const thread = await this.findOrCreateThread(businessId, contactId, channel, from, subject);

    // 2. Create message
    const message = await this.prisma.client.conversationMessage.create({
      data: {
        threadId: thread.id,
        direction: 'inbound',
        body: body ?? '',
        externalId: event.externalId ?? null,
        rawPayload: {
          from,
          to: event.to,
          subject,
          channel,
          connectorType: event.connectorType,
        },
      },
    });

    // 3. Classify intent
    const classification = this.classifier.classify(body ?? '', subject, channel);
    const intent = await this.classifier.saveIntent(businessId, {
      messageId: message.id,
      contactId: contactId ?? undefined,
      ...classification,
    });

    // 4. Score profit trajectory
    const profitScore = contactId
      ? await this.profit.scoreInteraction(businessId, contactId, classification.intentType, body ?? '')
      : null;

    // 5. Generate response draft (skip spam, auto-reply to simple ones)
    let draft = null;
    if (classification.intentType !== 'spam') {
      const contact = contactId
        ? await this.prisma.client.contact.findUnique({
            where: { id: contactId },
            select: { firstName: true, lastName: true, displayName: true },
          })
        : null;

      const contactName = contact?.displayName ?? contact?.firstName ?? 'there';
      const draftBody = this.drafts.generateBody(classification.intentType, {
        contactName,
        detectedDate: classification.extractedData?.detectedDate as string,
      });

      draft = await this.drafts.createDraft(
        businessId,
        'system',
        {
          channel: channel as 'email' | 'sms' | 'whatsapp' | 'call' | 'form',
          purpose: `Reply to ${classification.intentType}`,
          body: draftBody,
          tone: classification.intentType === 'complaint' ? 'empathetic' : 'friendly',
          requiresApproval: classification.riskLevel === 'HIGH',
          riskTier: classification.riskLevel === 'HIGH' ? 'HIGH' : 'LOW',
          evidence: {
            intentId: intent.id,
            intentType: classification.intentType,
            confidence: classification.confidence,
            profitScore: profitScore?.score ?? 0,
          },
        },
        {
          threadId: thread.id,
        },
      );
    }

    // 6. Create command for high-value/risk interactions
    let command = null;
    if (
      classification.intentType === 'complaint' ||
      classification.intentType === 'booking_request' ||
      classification.intentType === 'quote_request' ||
      (profitScore && profitScore.score >= 70)
    ) {
      const categoryMap: Record<string, string> = {
        complaint: 'GOVERNANCE',
        booking_request: 'TIME',
        quote_request: 'SALES',
        payment_question: 'MONEY',
        new_lead: 'SALES',
        support: 'WORK',
        review: 'MARKETING',
        referral: 'MARKETING',
        vendor: 'PEOPLE',
      };

      command = await this.commands.create(businessId, {
        sourceModule: 'COMMUNICATIONS',
        sourceType: classification.intentType,
        sourceId: intent.id,
        title: `${classification.intentType.replace(/_/g, ' ')} from ${from}`,
        description: body ?? '',
        category: categoryMap[classification.intentType] ?? 'WORK',
        actionType: classification.intentType === 'complaint' ? 'escalate' : 'respond',
        status: 'OPEN',
        priority: classification.intentType === 'complaint' ? 90 : 70,
        urgency: classification.intentType === 'complaint' ? 90 : 50,
        impactScore: profitScore?.score ?? 50,
        expectedValue: profitScore?.revenuePotential?.toString() ?? undefined,
        currency: profitScore?.currency ?? undefined,
        riskTier: classification.riskLevel === 'HIGH' ? 3 : 1,
        requiresApproval: classification.riskLevel === 'HIGH',
        recommendedBy: 'SYSTEM',
      });
    }

    // 7. Evaluate triggers
    const triggerMatches = await this.triggers.evaluateTriggers(businessId, channel, 'inbound_message', {
      subject: subject ?? '',
      body: body ?? '',
      from,
    });

    for (const match of triggerMatches) {
      this.logger.log(`Trigger ${match.triggerId} matched for ${businessId}`);
      for (const action of match.actions) {
        await this.executeTriggerAction(businessId, action, event, thread, intent);
      }
    }

    // 8. Create contact event
    if (contactId) {
      await this.prisma.client.contactEvent.create({
        data: {
          businessId,
          contactId,
          type: 'message_received',
          data: {
            intentType: classification.intentType,
            confidence: classification.confidence,
            profitScore: profitScore?.score,
            draftId: draft?.id,
            commandId: command?.id,
          },
          source: channel,
        },
      });
    }

    this.logger.log(
      `Processed ${channel} from ${from} for ${businessId}: intent=${classification.intentType}, profit=${profitScore?.score ?? 'N/A'}`,
    );
  }

  private async findOrCreateThread(
    businessId: string,
    contactId: string | null,
    channel: string,
    from: string,
    subject?: string,
  ) {
    const existing = contactId
      ? await this.prisma.client.conversationThread.findFirst({
          where: {
            businessId,
            contactId,
            channel: channel.toLowerCase(),
            status: { not: 'archived' },
          },
          orderBy: { lastMessageAt: 'desc' },
        })
      : null;

    if (existing) {
      await this.prisma.client.conversationThread.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date() },
      });
      return existing;
    }

    return this.prisma.client.conversationThread.create({
      data: {
        businessId,
        contactId,
        channel: channel.toLowerCase(),
        channelId: from,
        subject: subject ?? null,
        status: 'open',
        lastMessageAt: new Date(),
      },
    });
  }

  private async executeTriggerAction(
    businessId: string,
    action: Record<string, unknown>,
    event: MessageReceivedEvent,
    thread: { id: string; contactId?: string | null },
    intent: { id: string; intentType?: string | null },
  ) {
    const type = action.type as string;
    switch (type) {
      case 'auto_reply': {
        const template = action.template as string;
        const body = this.resolveTemplate(template, event);
        const draft = await this.drafts.createDraft(
          businessId,
          'SYSTEM',
          {
            channel: event.channel as 'email' | 'sms' | 'whatsapp' | 'call' | 'form',
            purpose: `auto_reply:${template}`,
            body,
            tone: 'friendly',
            requiresApproval: false,
            riskTier: 'LOW',
            evidence: { triggerTemplate: template, autoApproved: true },
          },
          { threadId: thread.id },
        );
        // Auto-approve and mark as sent for true auto-reply
        await this.drafts.approveDraft(draft.businessId, draft.id, 'SYSTEM');
        await this.drafts.markSent(draft.businessId, draft.id);
        this.logger.log(`Auto-reply draft ${draft.id} created and sent for thread ${thread.id}`);
        break;
      }
      case 'create_command': {
        const commandType = (action.commandType as string) ?? 'review_inbound';
        const priority = (action.priority as string) ?? 'NORMAL';
        const priorityNum = priority === 'HIGH' ? 80 : priority === 'CRITICAL' ? 95 : 50;
        await this.commands.create(businessId, {
          sourceModule: 'communications',
          sourceType: 'trigger',
          sourceId: intent.id,
          title: `Inbound ${commandType.replace(/_/g, ' ')}`,
          description: `Automated command from ${event.channel} trigger`,
          category: 'WORK',
          actionType: `TRIGGER_${commandType.toUpperCase()}`,
          status: 'OPEN',
          priority: priorityNum,
          urgency: priorityNum,
          impactScore: 60,
          riskTier: 2,
          requiresApproval: false,
          executableByKey: true,
          recommendedBy: 'SYSTEM',
          contactId: thread.contactId ?? undefined,
        });
        this.logger.log(`Command created from trigger: ${commandType}`);
        break;
      }
      case 'notify_owner': {
        await this.commands.create(businessId, {
          sourceModule: 'communications',
          sourceType: 'trigger',
          sourceId: intent.id,
          title: `New ${event.channel} message needs attention`,
          description: `Inbound message from ${event.from} via ${event.channel}. Trigger matched: notify owner.`,
          category: 'WORK',
          actionType: 'NOTIFY_OWNER',
          status: 'OPEN',
          priority: 85,
          urgency: 85,
          impactScore: 70,
          riskTier: 2,
          requiresApproval: false,
          executableByKey: false,
          recommendedBy: 'SYSTEM',
          contactId: thread.contactId ?? undefined,
        });
        this.logger.log(`Owner notification command created for thread ${thread.id}`);
        break;
      }
      case 'send_sms': {
        const template = action.template as string;
        const body = this.resolveTemplate(template, event);
        await this.drafts.createDraft(
          businessId,
          'SYSTEM',
          {
            channel: 'sms',
            purpose: `trigger_sms:${template}`,
            body,
            tone: 'friendly',
            requiresApproval: true,
            riskTier: 'MEDIUM',
            evidence: { triggerTemplate: template, channel: event.channel },
          },
          { threadId: thread.id },
        );
        this.logger.log(`SMS draft created from trigger for thread ${thread.id}`);
        break;
      }
      default:
        this.logger.warn(`Unknown trigger action: ${type}`);
    }
  }

  private resolveTemplate(template: string, event: MessageReceivedEvent): string {
    const name = event.from ?? 'there';
    switch (template) {
      case 'off_hours_ack':
        return `Hi ${name}, thanks for reaching out! We're currently outside business hours but we'll get back to you as soon as we're back. — KEYFLOWOS`;
      case 'missed_call':
        return `Hi ${name}, sorry we missed your call. We'll call you back as soon as possible. — KEYFLOWOS`;
      case 'general_ack':
        return `Hi ${name}, thanks for your message. We've received it and will respond shortly. — KEYFLOWOS`;
      default:
        return `Hi ${name}, thank you for reaching out. We're reviewing your message and will get back to you shortly.`;
    }
  }
}
