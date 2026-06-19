import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyInboxService } from './key-inbox.service';
import { InboxSuggestedAction } from './key-inbox.types';

export interface ActionExecutionResult {
  type: string;
  success: boolean;
  message: string;
  redirectUrl?: string;
  entityId?: string;
  entityType?: string;
}

@Injectable()
export class KeyInboxActionExecutorService {
  private readonly logger = new Logger(KeyInboxActionExecutorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
  ) {}

  async execute(
    businessId: string,
    threadId: string,
    action: InboxSuggestedAction,
    opts?: { messageId?: string; userId?: string },
  ): Promise<ActionExecutionResult> {
    const thread = await this.prisma.client.keyInboxThread.findFirst({
      where: { id: threadId, businessId },
      include: { messages: { orderBy: { receivedAt: 'desc' }, take: 1 } },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const latestMessage = thread.messages[0];
    const messageId = opts?.messageId ?? latestMessage?.id;

    switch (action.type) {
      case 'create_task':
        return this.createTask(businessId, thread, action);
      case 'create_contact':
        return this.createContact(businessId, thread, latestMessage);
      case 'schedule_followup':
        return this.scheduleFollowup(businessId, thread, action);
      case 'escalate':
        return this.escalate(thread);
      case 'draft_reply':
        return this.draftReply(businessId, thread, action, messageId);
      case 'create_invoice':
        return this.deepLink('invoice', businessId, thread);
      case 'create_booking':
        return this.deepLink('booking', businessId, thread);
      case 'none':
      case 'review':
        return { type: action.type, success: true, message: 'Marked for review' };
      default:
        return { type: action.type, success: false, message: `Unsupported action type: ${action.type}` };
    }
  }

  private async createTask(
    businessId: string,
    thread: { id: string; contactId: string | null },
    action: InboxSuggestedAction,
  ): Promise<ActionExecutionResult> {
    if (!thread.contactId) {
      return { type: 'create_task', success: false, message: 'No contact resolved for this thread' };
    }

    const title = typeof action.payload?.title === 'string' ? action.payload.title : 'Follow up from Key Inbox';
    const task = await this.prisma.client.contactTask.create({
      data: {
        businessId,
        contactId: thread.contactId,
        title,
        source: 'key_inbox',
        status: 'OPEN',
        priority: 'NORMAL',
      },
    });

    return { type: 'create_task', success: true, message: `Task created`, entityId: task.id, entityType: 'ContactTask' };
  }

  private async createContact(
    businessId: string,
    thread: { id: string; channel: string; contactId: string | null },
    message?: { senderName?: string | null; senderEmail?: string | null; senderPhone?: string | null } | null,
  ): Promise<ActionExecutionResult> {
    if (thread.contactId) {
      return { type: 'create_contact', success: true, message: 'Contact already exists', entityId: thread.contactId, entityType: 'Contact' };
    }

    const [firstName, ...rest] = (message?.senderName ?? '').split(' ');
    const contact = await this.prisma.client.contact.create({
      data: {
        businessId,
        firstName: firstName || null,
        lastName: rest.join(' ') || null,
        email: message?.senderEmail ?? null,
        phone: message?.senderPhone ?? null,
        source: 'key_inbox',
        sourceDetail: thread.channel,
        status: 'LEAD',
      },
    });

    await this.prisma.client.keyInboxThread.update({
      where: { id: thread.id },
      data: { contactId: contact.id },
    });

    return { type: 'create_contact', success: true, message: 'Contact created', entityId: contact.id, entityType: 'Contact' };
  }

  private async scheduleFollowup(
    businessId: string,
    thread: { id: string; contactId: string | null },
    action: InboxSuggestedAction,
  ): Promise<ActionExecutionResult> {
    if (!thread.contactId) {
      return { type: 'schedule_followup', success: false, message: 'No contact resolved for this thread' };
    }

    const title = typeof action.payload?.title === 'string' ? action.payload.title : 'Scheduled follow-up';
    const dueDate = this.parseDueDate(action.payload?.dueDate);

    const task = await this.prisma.client.contactTask.create({
      data: {
        businessId,
        contactId: thread.contactId,
        title,
        source: 'key_inbox',
        status: 'OPEN',
        priority: 'NORMAL',
        dueDate,
      },
    });

    return { type: 'schedule_followup', success: true, message: 'Follow-up scheduled', entityId: task.id, entityType: 'ContactTask' };
  }

  private async escalate(thread: { id: string }): Promise<ActionExecutionResult> {
    await this.prisma.client.keyInboxThread.update({
      where: { id: thread.id },
      data: { priority: 'URGENT', status: 'WAITING' },
    });

    return { type: 'escalate', success: true, message: 'Thread escalated to urgent' };
  }

  private async draftReply(
    businessId: string,
    thread: { id: string; channel: string },
    action: InboxSuggestedAction,
    messageId?: string,
  ): Promise<ActionExecutionResult> {
    const contentText = typeof action.payload?.draft === 'string'
      ? action.payload.draft
      : typeof action.payload?.content === 'string'
        ? action.payload.content
        : '';

    if (!contentText.trim()) {
      return { type: 'draft_reply', success: false, message: 'No draft content provided' };
    }

    const result = await this.keyInbox.addMessage({
      businessId,
      threadId: thread.id,
      channel: thread.channel,
      direction: 'OUTBOUND',
      contentText,
      metadata: { source: 'ai_draft_reply', parentMessageId: messageId },
    });

    return { type: 'draft_reply', success: true, message: 'Draft reply saved', entityId: result.message.id, entityType: 'KeyInboxMessage' };
  }

  private deepLink(type: 'invoice' | 'booking', businessId: string, thread: { id: string; contactId: string | null }): ActionExecutionResult {
    const params = new URLSearchParams();
    params.set('source', 'key_inbox');
    params.set('threadId', thread.id);
    if (thread.contactId) params.set('contactId', thread.contactId);
    if (type === 'invoice') params.set('createInvoice', '1');
    if (type === 'booking') params.set('createBooking', '1');

    const path = type === 'invoice' ? '/app/financial-flow' : '/app/bookings';
    return {
      type: `create_${type}`,
      success: true,
      message: `Open ${type} creation page`,
      redirectUrl: `${path}?${params.toString()}`,
    };
  }

  private parseDueDate(value: unknown): Date | undefined {
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    if (typeof value === 'number') {
      return new Date(value);
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow;
  }
}
