import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface AgentMessagePayload {
  topic: string;
  payload: Record<string, any>;
  senderAgentId: string;
  priority: number;
  correlationId?: string;
}

export interface AgentSubscription {
  id: string;
  topic: string;
  handler: (message: AgentMessagePayload & { messageId: string; createdAt: Date }) => void | Promise<void>;
}

@Injectable()
export class AgentBusService implements OnModuleInit {
  private readonly logger = new Logger(AgentBusService.name);
  private subscriptions = new Map<string, Set<AgentSubscription>>();
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.logger.log('Agent bus service initialized');
  }

  async publish(
    businessId: string,
    message: Omit<AgentMessagePayload, 'senderAgentId'> & { senderAgentId: string },
  ): Promise<string> {
    const record = await this.prisma.client.agentMessage.create({
      data: {
        businessId,
        topic: message.topic,
        payload: message.payload as any,
        senderAgentId: message.senderAgentId,
        priority: message.priority ?? 0,
        expiresAt: new Date(Date.now() + this.TTL_MS),
      },
    });

    // Emit for in-memory subscribers
    const subs = this.subscriptions.get(message.topic);
    if (subs) {
      for (const sub of subs) {
        try {
          await sub.handler({
            ...message,
            messageId: record.id,
            createdAt: record.createdAt,
          });
        } catch (err: any) {
          this.logger.error(`Agent bus handler error for ${message.topic}: ${(err as Error).message}`);
        }
      }
    }

    // Emit on event bus for cross-service listeners
    this.events.emit(`agent.message.${message.topic}`, {
      businessId,
      messageId: record.id,
      ...message,
    });

    this.events.emit('agent.message', {
      businessId,
      messageId: record.id,
      topic: message.topic,
      senderAgentId: message.senderAgentId,
    });

    return record.id;
  }

  subscribe(topic: string, handler: AgentSubscription['handler'], subscriberId?: string): string {
    const subId = subscriberId ?? `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sub: AgentSubscription = { id: subId, topic, handler };

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(sub);

    this.logger.debug(`Agent subscribed to "${topic}" (${subId})`);
    return subId;
  }

  unsubscribe(topic: string, subId: string): boolean {
    const subs = this.subscriptions.get(topic);
    if (!subs) return false;
    for (const sub of subs) {
      if (sub.id === subId) {
        subs.delete(sub);
        this.logger.debug(`Agent unsubscribed from "${topic}" (${subId})`);
        return true;
      }
    }
    return false;
  }

  async getPendingMessages(businessId: string, topic?: string, limit = 50): Promise<Array<{
    id: string;
    topic: string;
    payload: Record<string, any>;
    senderAgentId: string;
    priority: number;
    createdAt: Date;
  }>> {
    const messages = await this.prisma.client.agentMessage.findMany({
      where: {
        businessId,
        processed: false,
        ...(topic ? { topic } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });

    return messages.map((m) => ({
      id: m.id,
      topic: m.topic,
      payload: m.payload as Record<string, any>,
      senderAgentId: m.senderAgentId,
      priority: m.priority,
      createdAt: m.createdAt,
    }));
  }

  async markProcessed(messageIds: string[]): Promise<number> {
    const result = await this.prisma.client.agentMessage.updateMany({
      where: { id: { in: messageIds } },
      data: { processed: true },
    });
    return result.count;
  }

  async cleanupExpiredMessages(): Promise<number> {
    const result = await this.prisma.client.agentMessage.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { processed: true, createdAt: { lt: new Date(Date.now() - this.TTL_MS) } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired agent messages`);
    }
    return result.count;
  }

  getSubscriptionStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [topic, subs] of this.subscriptions.entries()) {
      stats[topic] = subs.size;
    }
    return stats;
  }
}
