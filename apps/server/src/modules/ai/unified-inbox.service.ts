import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface InboundMessageContext {
  businessId: string;
  channel: 'whatsapp' | 'email' | 'sms' | 'instagram' | 'messenger';
  from: string;
  contactId?: string;
  body: string;
  messageId?: string;
  subject?: string;
  rawPayload?: Record<string, any>;
}

export interface ThreadFilter {
  channel?: string;
  status?: string;
  assignedRole?: string;
  contactId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class UnifiedInboxService {
  private readonly logger = new Logger(UnifiedInboxService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async ensureThread(
    businessId: string,
    channel: string,
    channelId: string,
    contactId?: string,
    subject?: string,
  ): Promise<{ id: string; contactId: string | null; assignedRole: string | null }> {
    const existing = await this.prisma.client.conversationThread.findFirst({
      where: { businessId, channel, channelId },
      select: { id: true, contactId: true, assignedRole: true },
    });

    if (existing) {
      // Update contact if provided and different
      if (contactId && existing.contactId !== contactId) {
        await this.prisma.client.conversationThread.update({
          where: { id: existing.id },
          data: { contactId },
        });
      }
      return existing;
    }

    const thread = await this.prisma.client.conversationThread.create({
      data: {
        businessId,
        channel,
        channelId,
        contactId: contactId ?? null,
        subject: subject ?? null,
        status: 'open',
      },
    });

    this.events.emit('conversation.thread_created', {
      businessId,
      threadId: thread.id,
      channel,
      contactId,
    });

    return { id: thread.id, contactId: thread.contactId, assignedRole: thread.assignedRole };
  }

  async recordInboundMessage(ctx: InboundMessageContext): Promise<{ threadId: string; messageId: string }> {
    const thread = await this.ensureThread(ctx.businessId, ctx.channel, ctx.from, ctx.contactId, ctx.subject);

    const message = await this.prisma.client.conversationMessage.create({
      data: {
        threadId: thread.id,
        direction: 'inbound',
        body: ctx.body,
        rawPayload: ctx.rawPayload ? (ctx.rawPayload as any) : undefined,
        externalId: ctx.messageId ?? null,
      },
    });

    await this.prisma.client.conversationThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() },
    });

    this.events.emit('conversation.message_received', {
      businessId: ctx.businessId,
      threadId: thread.id,
      messageId: message.id,
      channel: ctx.channel,
    });

    return { threadId: thread.id, messageId: message.id };
  }

  async recordOutboundMessage(
    threadId: string,
    body: string,
    opts?: {
      role?: string;
      aiDraft?: boolean;
      aiApproved?: boolean;
      externalId?: string;
      rawPayload?: Record<string, any>;
    },
  ): Promise<string> {
    const message = await this.prisma.client.conversationMessage.create({
      data: {
        threadId,
        direction: 'outbound',
        body,
        role: opts?.role ?? null,
        aiDraft: opts?.aiDraft ?? false,
        aiApproved: opts?.aiApproved ?? false,
        externalId: opts?.externalId ?? null,
        rawPayload: opts?.rawPayload ? (opts.rawPayload as any) : undefined,
      },
    });

    await this.prisma.client.conversationThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });

    return message.id;
  }

  async loadThreadHistory(
    threadId: string,
    limit = 10,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>> {
    const messages = await this.prisma.client.conversationMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { direction: true, body: true, createdAt: true, aiDraft: true },
    });

    return messages
      .reverse()
      .filter((m) => !m.aiDraft) // Don't include draft messages in history
      .map((m) => ({
        role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
        content: m.body,
        timestamp: m.createdAt,
      }));
  }

  async getInbox(businessId: string, filters?: ThreadFilter): Promise<{
    threads: Array<any>;
    total: number;
  }> {
    const where: any = { businessId };
    if (filters?.channel) where.channel = filters.channel;
    if (filters?.status) where.status = filters.status;
    if (filters?.assignedRole) where.assignedRole = filters.assignedRole;
    if (filters?.contactId) where.contactId = filters.contactId;

    const [threads, total] = await Promise.all([
      this.prisma.client.conversationThread.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true, direction: true },
          },
        },
      }),
      this.prisma.client.conversationThread.count({ where }),
    ]);

    return { threads, total };
  }

  async getThread(threadId: string): Promise<any | null> {
    return this.prisma.client.conversationThread.findUnique({
      where: { id: threadId },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            direction: true,
            body: true,
            role: true,
            intent: true,
            sentiment: true,
            aiDraft: true,
            aiApproved: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async assignRole(threadId: string, role: string): Promise<void> {
    await this.prisma.client.conversationThread.update({
      where: { id: threadId },
      data: { assignedRole: role },
    });
  }

  async resolveThread(threadId: string): Promise<void> {
    await this.prisma.client.conversationThread.update({
      where: { id: threadId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }

  async reopenThread(threadId: string): Promise<void> {
    await this.prisma.client.conversationThread.update({
      where: { id: threadId },
      data: { status: 'open', resolvedAt: null },
    });
  }

  async setPriority(threadId: string, priority: number): Promise<void> {
    await this.prisma.client.conversationThread.update({
      where: { id: threadId },
      data: { priority },
    });
  }

  async getOpenThreadCount(businessId: string): Promise<number> {
    return this.prisma.client.conversationThread.count({
      where: { businessId, status: 'open' },
    });
  }

  async getThreadsByRole(businessId: string, role: string): Promise<any[]> {
    return this.prisma.client.conversationThread.findMany({
      where: { businessId, assignedRole: role, status: 'open' },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true } },
      },
    });
  }
}
