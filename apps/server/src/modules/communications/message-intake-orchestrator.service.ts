import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { InteractionClassifierService, type ClassifiedIntent } from './interaction-classifier.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { CrmService } from '../crm/crm.service';
import { CrmCommunicationService } from '../crm/crm-communication.service';
import { CommandService } from '../command/command.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';
import { AiMessageSenderService } from '../ai/ai-message-sender.service';
import { TimelineService } from '../timeline/timeline.service';

export interface InboundMessageEvent {
  businessId: string;
  connectorType: string;
  sourceChannel: 'whatsapp' | 'email' | 'sms' | 'instagram' | 'messenger';
  externalId?: string;
  from: string;
  fromName?: string;
  to?: string;
  subject?: string;
  body: string;
  rawPayload?: Record<string, unknown>;
  receivedAt?: Date;
}

export type MessageIntakeActionType =
  | 'create_thread_and_message'
  | 'send_reply'
  | 'create_command'
  | 'create_follow_up_task'
  | 'log_note';

export interface MessageIntakeAction {
  type: MessageIntakeActionType;
  payload: Record<string, unknown>;
}

export interface MessageIntakePlan {
  intakeId: string;
  sourceChannel: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  intentType: string;
  actions: MessageIntakeAction[];
  summary: string;
}

interface ActionResult {
  action: MessageIntakeActionType;
  success: boolean;
  entityId?: string;
  error?: string;
}

function riskLevelToTier(level?: string): number {
  switch (level) {
    case 'HIGH':
      return 3;
    case 'MEDIUM':
      return 2;
    default:
      return 1;
  }
}

function channelToReplyChannel(channel: string): 'email' | 'whatsapp' | 'sms' | undefined {
  if (channel === 'email') return 'email';
  if (channel === 'whatsapp') return 'whatsapp';
  if (channel === 'sms') return 'sms';
  return undefined;
}

@Injectable()
export class MessageIntakeOrchestrator {
  private readonly logger = new Logger(MessageIntakeOrchestrator.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(InteractionClassifierService) private readonly classifier: InteractionClassifierService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmCommunicationService) private readonly crmCommunication: CrmCommunicationService,
    @Inject(CommandService) private readonly commandService: CommandService,
    @Inject(TaskAssignmentService) private readonly taskAssignment: TaskAssignmentService,
    @Inject(AiMessageSenderService) private readonly sender: AiMessageSenderService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  /**
   * Receive an inbound message and hold it in the intake queue. This resolves the
   * sender, classifies intent, builds an action plan, and creates an approval item.
   * The message is NOT written to the inbox until a user approves the plan.
   */
  async receive(event: InboundMessageEvent): Promise<{ intakeId: string; contactId: string }> {
    const normalizedFrom = event.sourceChannel === 'email' ? event.from.toLowerCase().trim() : event.from;

    if (event.externalId) {
      const existing = await this.prisma.client.messageIntake.findUnique({
        where: {
          businessId_sourceChannel_externalId: {
            businessId: event.businessId,
            sourceChannel: event.sourceChannel,
            externalId: event.externalId,
          },
        },
      });
      if (existing) {
        return { intakeId: existing.id, contactId: existing.contactId ?? '' };
      }
    }

    const resolved = await this.entityResolution.resolveContact(event.businessId, {
      source: event.connectorType,
      externalId: event.externalId,
      email: event.sourceChannel === 'email' ? normalizedFrom : undefined,
      phone: event.sourceChannel === 'whatsapp' || event.sourceChannel === 'sms' ? normalizedFrom : undefined,
      firstName: event.fromName?.split(' ')[0],
      lastName: event.fromName?.split(' ').slice(1).join(' ') || undefined,
    });

    const intake = await this.prisma.client.messageIntake.create({
      data: {
        businessId: event.businessId,
        connectorType: event.connectorType,
        sourceChannel: event.sourceChannel,
        externalId: event.externalId,
        from: normalizedFrom,
        fromName: event.fromName,
        to: event.to,
        subject: event.subject,
        body: event.body,
        rawPayload: event.rawPayload ?? {},
        contactId: resolved.contactId,
        status: 'pending',
        detectedAt: event.receivedAt ?? new Date(),
      },
    });

    try {
      await this.buildPlan(intake.id);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to build message intake plan for ${intake.id}: ${message}`);
      await this.prisma.client.messageIntake.update({
        where: { id: intake.id },
        data: { status: 'error', errorMessage: message },
      });
    }

    return { intakeId: intake.id, contactId: resolved.contactId };
  }

  async buildPlan(intakeId: string): Promise<MessageIntakePlan> {
    const intake = await this.prisma.client.messageIntake.findFirst({
      where: { id: intakeId },
      include: { contact: true },
    });
    if (!intake) throw new NotFoundException('Message intake not found');

    const classification = this.classifier.classify(intake.body, intake.subject ?? undefined, intake.sourceChannel);
    const confidence = classification.confidence / 100;
    const riskTier = riskLevelToTier(classification.riskLevel);

    const plan: MessageIntakePlan = {
      intakeId: intake.id,
      sourceChannel: intake.sourceChannel,
      contactId: intake.contactId ?? undefined,
      contactName: intake.contact ? `${intake.contact.firstName ?? ''} ${intake.contact.lastName ?? ''}`.trim() : undefined,
      contactEmail: intake.contact?.email ?? undefined,
      contactPhone: intake.contact?.phone ?? undefined,
      intentType: classification.intentType,
      actions: [
        {
          type: 'create_thread_and_message',
          payload: {
            channel: intake.sourceChannel,
            channelId: normalizedChannelId(intake.sourceChannel, intake.from),
            subject: intake.subject,
            body: intake.body,
            rawPayload: intake.rawPayload,
            externalId: intake.externalId,
          },
        },
      ],
      summary: `${classification.intentType.replace(/_/g, ' ')} from ${intake.from}${
        intake.subject ? ` — ${intake.subject}` : ''
      }`,
    };

    const replyChannel = channelToReplyChannel(intake.sourceChannel);
    const replyBody = this.draftReply(classification, plan.contactName);

    if (classification.intentType !== 'spam') {
      if (replyChannel) {
        plan.actions.push({
          type: 'send_reply',
          payload: {
            channel: replyChannel,
            body: replyBody,
            subject: intake.subject ? `Re: ${intake.subject}` : undefined,
          },
        });
      } else {
        plan.actions.push({
          type: 'log_note',
          payload: {
            body: `Suggested reply for ${intake.sourceChannel}: ${replyBody}`,
          },
        });
      }
    }

    const command = this.intentToCommand(classification);
    if (command) {
      plan.actions.push({
        type: 'create_command',
        payload: command,
      });
    }

    if (classification.intentType === 'complaint' || classification.intentType === 'support') {
      plan.actions.push({
        type: 'create_follow_up_task',
        payload: {
          title: `Follow up: ${classification.intentType} from ${intake.from}`,
          priority: 'HIGH',
        },
      });
    }

    const affectedEntities: Record<string, unknown>[] = [{ type: 'messageIntake', id: intake.id }];
    if (intake.contactId) affectedEntities.push({ type: 'contact', id: intake.contactId });

    const approvalItem = await this.governance.createApprovalItem(intake.businessId, {
      toolName: 'message_intake_action',
      module: 'communications',
      title: `Message intake: ${plan.summary}`,
      description: `KEY intercepted a ${intake.sourceChannel} message and proposes:\n${plan.actions
        .map((a) => `- ${a.type}: ${JSON.stringify(a.payload)}`)
        .join('\n')}`,
      rationale: classification.recommendedAction,
      inputPayload: { intakeId: intake.id, plan },
      affectedEntities,
    });

    await this.prisma.client.messageIntake.update({
      where: { id: intakeId },
      data: {
        status: 'reviewing',
        contactId: intake.contactId,
        confidence,
        intentType: classification.intentType,
        riskTier,
        extractedData: classification.extractedData as Record<string, unknown>,
        proposedActions: plan as unknown as Record<string, unknown>,
      },
    });

    this.logger.log(`Message intake ${intakeId} plan created (approval ${approvalItem.id})`);
    return plan;
  }

  async executePlan(businessId: string, intakeId: string, userId: string): Promise<{ success: boolean; results: ActionResult[] }> {
    const intake = await this.prisma.client.messageIntake.findFirst({
      where: { id: intakeId, businessId },
    });
    if (!intake) throw new NotFoundException('Message intake not found');
    if (intake.status === 'approved') {
      throw new BadRequestException('This message intake has already been executed');
    }
    if (intake.status !== 'reviewing') {
      throw new BadRequestException(`Message intake is ${intake.status}, cannot execute`);
    }

    const plan = intake.proposedActions as unknown as MessageIntakePlan | null;
    if (!plan) throw new BadRequestException('No action plan found for this intake');

    const results: ActionResult[] = [];
    let threadId: string | undefined;

    try {
      for (const action of plan.actions) {
        switch (action.type) {
          case 'create_thread_and_message': {
            const payload = action.payload as {
              channel: string;
              channelId: string;
              subject?: string;
              body: string;
              rawPayload?: Record<string, unknown>;
              externalId?: string;
            };
            // Writes to key_inbox_* — the single omnichannel store.
            //
            // This wrote conversation_threads, a second inbound store with its
            // own screen. Gmail and Google Forms landed in key_inbox_threads,
            // everything arriving through this webhook landed here, and neither
            // screen showed the other's messages — a business's conversations
            // split in half by channel, with the four inbox_* KEY tools able to
            // see only one half.
            const now = new Date();
            const thread = await this.prisma.client.keyInboxThread.create({
              data: {
                businessId,
                contactId: intake.contactId,
                channel: payload.channel,
                channelId: payload.channelId,
                externalThreadId: payload.externalId ?? null,
                subject: payload.subject,
                status: 'open',
                priority: 'normal',
                lastMessageAt: now,
                lastInboundAt: now,
              },
            });
            const message = await this.prisma.client.keyInboxMessage.create({
              data: {
                businessId,
                threadId: thread.id,
                channel: payload.channel,
                direction: 'inbound',
                contentText: payload.body,
                rawPayload: payload.rawPayload ?? {},
                intent: intake.intentType,
                externalMessageId: payload.externalId,
                receivedAt: now,
              },
            });
            threadId = thread.id;
            results.push({ action: 'create_thread_and_message', success: true, entityId: thread.id });
            this.logger.log(`Created thread ${thread.id} and message ${message.id} from intake ${intakeId}`);
            break;
          }
          case 'send_reply': {
            const payload = action.payload as {
              channel: 'email' | 'whatsapp' | 'sms';
              body: string;
              subject?: string;
            };
            if (!intake.contactId) {
              results.push({ action: 'send_reply', success: false, error: 'No contact to reply to' });
              break;
            }
            const sent = await this.sender.sendMessage({
              businessId,
              contactId: intake.contactId,
              channel: payload.channel,
              body: payload.body,
              subject: payload.subject,
            });
            results.push({
              action: 'send_reply',
              success: sent.success,
              entityId: sent.success ? undefined : undefined,
              error: sent.error,
            });
            break;
          }
          case 'create_command': {
            const payload = action.payload as {
              title: string;
              description?: string;
              category: string;
              actionType: string;
              priority?: number;
              urgency?: number;
            };
            const item = await this.commandService.create(businessId, {
              title: payload.title,
              description: payload.description,
              category: payload.category as any,
              actionType: payload.actionType,
              sourceModule: 'KEY_AI',
              sourceType: 'message_intake',
              sourceId: intakeId,
              contactId: intake.contactId ?? undefined,
              ownerId: intake.contactId ?? undefined,
              ownerType: intake.contactId ? 'KEY' : undefined,
              priority: payload.priority ?? 60,
              urgency: payload.urgency ?? 50,
              recommendedBy: 'KEY',
              executableByKey: true,
            });
            results.push({ action: 'create_command', success: true, entityId: item.id });
            break;
          }
          case 'create_follow_up_task': {
            if (!intake.contactId) {
              results.push({ action: 'create_follow_up_task', success: false, error: 'No contact for follow-up' });
              break;
            }
            const payload = action.payload as { title: string; priority?: string };
            const task = await this.crm.addTask({
              businessId,
              contactId: intake.contactId,
              title: payload.title,
              priority: payload.priority ?? 'HIGH',
              source: 'message_intake',
              creatorId: userId,
            });
            await this.taskAssignment.assign({
              taskType: 'ContactTask',
              taskId: task.id,
              assignableType: 'KEY',
              assignableId: 'key_ai',
              assignedBy: userId,
              reason: 'Auto-assigned by Message intake orchestrator for follow-up',
            });
            results.push({ action: 'create_follow_up_task', success: true, entityId: task.id });
            break;
          }
          case 'log_note': {
            if (!intake.contactId) {
              results.push({ action: 'log_note', success: false, error: 'No contact to log note against' });
              break;
            }
            const payload = action.payload as { body: string };
            const note = await this.crm.addNote({
              businessId,
              contactId: intake.contactId,
              body: payload.body,
              authorId: userId,
              source: 'message_intake',
            });
            results.push({ action: 'log_note', success: true, entityId: (note as { id?: string }).id });
            break;
          }
        }
      }

      await this.prisma.client.messageIntake.update({
        where: { id: intakeId },
        data: {
          status: 'approved',
          processedAt: new Date(),
          threadId,
        },
      });

      await this.resolvePendingApproval(businessId, intakeId, 'approved', userId);

      this.timeline.recordEvent({
        businessId,
        module: 'communications',
        action: 'message_intake.approved',
        entityType: 'message_intake',
        entityId: intakeId,
        title: 'Message intake approved',
        detail: plan.summary,
        category: 'AI',
        actorType: 'USER',
        actorId: userId,
        status: 'COMPLETED',
        data: { intentType: plan.intentType, results: results.map((r) => ({ action: r.action, success: r.success })) },
        occurredAt: new Date(),
      }).catch((err) => this.logger.warn(`Timeline event failed: ${(err as Error).message}`));

      return { success: true, results };
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Message intake execution failed for ${intakeId}: ${message}`);
      await this.prisma.client.messageIntake.update({
        where: { id: intakeId },
        data: { status: 'error', errorMessage: message },
      });
      return { success: false, results };
    }
  }

  async rejectIntake(businessId: string, intakeId: string, userId?: string): Promise<void> {
    const intake = await this.prisma.client.messageIntake.findFirst({
      where: { id: intakeId, businessId },
    });
    if (!intake) throw new NotFoundException('Message intake not found');
    await this.prisma.client.messageIntake.update({
      where: { id: intakeId },
      data: { status: 'rejected', processedAt: new Date() },
    });
    if (userId) {
      await this.resolvePendingApproval(businessId, intakeId, 'rejected', userId).catch((err) => {
        this.logger.warn(`Failed to resolve approval on reject: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private async resolvePendingApproval(
    businessId: string,
    intakeId: string,
    resolution: 'approved' | 'rejected',
    userId: string,
  ) {
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: {
        businessId,
        status: 'pending',
        inputPayload: { path: ['intakeId'], equals: intakeId },
      },
    });
    if (item) {
      await this.governance.resolveApproval(item.id, businessId, resolution, userId);
    }
  }

  private draftReply(classification: ClassifiedIntent, contactName?: string): string {
    const name = contactName?.split(' ')[0] || 'there';
    switch (classification.intentType) {
      case 'quote_request':
        return `Hi ${name}, thanks for reaching out. I'd be happy to prepare a quote for you. Could you share a few more details about what you need?`;
      case 'booking_request':
        return `Hi ${name}, we'd love to get you booked. What date and time works best for you?`;
      case 'payment_question':
        return `Hi ${name}, I can help with that. Let me check your account and get back to you shortly.`;
      case 'complaint':
        return `Hi ${name}, I'm really sorry to hear this. Let me look into it personally and follow up with you as soon as possible.`;
      case 'review':
        return `Hi ${name}, thank you for your support! If you have a moment, we'd appreciate your review.`;
      case 'support':
        return `Hi ${name}, I'm here to help. Can you share a bit more about the issue so I can assist you?`;
      default:
        return `Hi ${name}, thanks for your message. How can I help you today?`;
    }
  }

  private intentToCommand(classification: ClassifiedIntent):
    | { title: string; description: string; category: string; actionType: string; priority: number; urgency: number }
    | null {
    switch (classification.intentType) {
      case 'quote_request':
        return {
          title: 'Draft quote for inbound message',
          description: classification.recommendedAction,
          category: 'SALES',
          actionType: 'quote_request',
          priority: 75,
          urgency: 65,
        };
      case 'booking_request':
        return {
          title: 'Schedule booking from inbound message',
          description: classification.recommendedAction,
          category: 'TIME',
          actionType: 'booking_request',
          priority: 80,
          urgency: 70,
        };
      case 'payment_question':
        return {
          title: 'Resolve payment question',
          description: classification.recommendedAction,
          category: 'MONEY',
          actionType: 'payment_question',
          priority: 70,
          urgency: 60,
        };
      case 'complaint':
        return {
          title: 'Escalate complaint',
          description: classification.recommendedAction,
          category: 'GOVERNANCE',
          actionType: 'complaint',
          priority: 95,
          urgency: 90,
        };
      case 'vendor':
        return {
          title: 'Evaluate vendor inquiry',
          description: classification.recommendedAction,
          category: 'WORK',
          actionType: 'vendor_inquiry',
          priority: 60,
          urgency: 50,
        };
      default:
        return null;
    }
  }
}

function normalizedChannelId(channel: string, from: string): string {
  if (channel === 'email') return from.toLowerCase().trim();
  if (channel === 'whatsapp' || channel === 'sms') return from.replace(/[^0-9+]/g, '');
  return from;
}
