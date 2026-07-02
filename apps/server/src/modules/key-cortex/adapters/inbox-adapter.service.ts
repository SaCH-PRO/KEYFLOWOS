import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { KeyInboxService } from '../../key-inbox/key-inbox.service';
import { KeyInboxIntelligenceService } from '../../key-inbox/key-inbox-intelligence.service';

/**
 * Typed adapter that exposes the key-inbox methods expected by
 * KeyCortexConnectorService.  Delegates to KeyInboxService where a real
 * implementation exists; otherwise returns a typed placeholder.
 */
@Injectable()
export class InboxAdapterService {
  constructor(
    private readonly inbox: KeyInboxService,
    private readonly intelligence: KeyInboxIntelligenceService,
    private readonly prisma: PrismaService,
  ) {}

  async getThreads(input: {
    businessId: string;
    status?: string;
    priority?: string;
    assignedTo?: string;
    limit?: number;
  }) {
    return this.inbox.listThreads(input.businessId, {
      status: input.status,
      priority: input.priority,
      limit: input.limit ?? 50,
    });
  }

  async sendReply(input: {
    businessId: string;
    threadId: string;
    body: string;
    channel?: string;
    attachments?: string[];
  }) {
    return this.inbox.addReply(
      input.businessId,
      input.threadId,
      input.body,
      input.attachments?.map((url) => ({ url })),
      { mode: 'send' },
    );
  }

  async classifyMessage(input: {
    businessId: string;
    threadId: string;
    intent?: string;
    priority?: string;
    assignTo?: string;
  }) {
    const thread = await this.inbox.getThread(input.businessId, input.threadId);
    if (!thread) {
      return null;
    }
    const messages = thread.messages ?? [];
    const latest = messages[0];
    if (!latest) {
      return null;
    }
    const updated = await this.inbox.analyzeMessage(input.businessId, latest.id);
    const patch: {
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      status?: 'OPEN' | 'WAITING' | 'DONE' | 'ARCHIVED';
      metadata?: Record<string, unknown>;
    } = {};
    if (input.priority) {
      patch.priority = input.priority.toUpperCase() as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    }
    if (input.assignTo) {
      patch.status = 'WAITING';
    }
    const metadata: Record<string, unknown> = {};
    if (input.intent) metadata.aiIntentOverride = input.intent;
    if (input.assignTo) metadata.assignedTo = input.assignTo;
    patch.metadata = metadata;
    await this.inbox.updateThread(input.businessId, input.threadId, patch);
    return updated;
  }

  async closeThread(input: {
    businessId: string;
    threadId: string;
    resolution?: string;
  }) {
    return this.inbox.updateThread(input.businessId, input.threadId, {
      status: 'DONE',
      metadata: input.resolution ? { resolution: input.resolution, closedAt: new Date().toISOString() } : undefined,
    });
  }

  async snoozeThread(input: {
    businessId: string;
    threadId: string;
    until?: string;
    reason?: string;
  }) {
    return this.inbox.updateThread(input.businessId, input.threadId, {
      status: 'WAITING',
      metadata: {
        snoozeUntil: input.until ?? null,
        snoozeReason: input.reason ?? null,
      },
    });
  }

  async assignThread(input: {
    businessId: string;
    threadId: string;
    userId: string;
  }) {
    return this.inbox.updateThread(input.businessId, input.threadId, {
      status: 'WAITING',
      metadata: { assignedTo: input.userId, assignedAt: new Date().toISOString() },
    });
  }

  async getIntelligenceReport(input: {
    businessId: string;
    threadId?: string;
    scope?: string;
  }) {
    if (input.threadId) {
      const analyzed = await this.inbox.analyzeThread(input.businessId, input.threadId);
      return analyzed;
    }
    return this.intelligence.generateReport(input.businessId, {
      scope: (input.scope?.toUpperCase() ?? 'DAILY') as any,
    });
  }

  async mergeThreads(input: {
    businessId: string;
    masterThreadId: string;
    duplicateThreadId: string;
  }) {
    const master = await this.inbox.getThread(input.businessId, input.masterThreadId);
    const duplicate = await this.inbox.getThread(input.businessId, input.duplicateThreadId);
    if (!master || !duplicate) {
      return null;
    }
    await this.prisma.client.keyInboxMessage.updateMany({
      where: { threadId: input.duplicateThreadId, businessId: input.businessId },
      data: { threadId: input.masterThreadId },
    });
    await this.inbox.updateThread(input.businessId, input.duplicateThreadId, {
      status: 'ARCHIVED',
      metadata: { mergedIntoId: input.masterThreadId, mergedAt: new Date().toISOString() },
    });
    return {
      masterThreadId: input.masterThreadId,
      duplicateThreadId: input.duplicateThreadId,
      merged: true,
    };
  }

  async getUnreadThreads(input: { businessId: string; limit?: number }) {
    return this.inbox.listThreads(input.businessId, {
      status: 'OPEN',
      limit: input.limit ?? 50,
    });
  }

  async getThreadDetails(input: { businessId: string; threadId: string }) {
    return this.inbox.getThread(input.businessId, input.threadId);
  }

  async getInboxSummary(input: { businessId: string }) {
    const [open, waiting, done] = await Promise.all([
      this.prisma.client.keyInboxThread.count({ where: { businessId: input.businessId, status: 'OPEN' } }),
      this.prisma.client.keyInboxThread.count({ where: { businessId: input.businessId, status: 'WAITING' } }),
      this.prisma.client.keyInboxThread.count({ where: { businessId: input.businessId, status: 'DONE' } }),
    ]);
    return { open, waiting, done };
  }

  async getClassificationStats(input: { businessId: string }) {
    const threads = await this.prisma.client.keyInboxThread.findMany({
      where: { businessId: input.businessId },
      select: { aiIntent: true, aiSentiment: true, priority: true },
    });
    const intents: Record<string, number> = {};
    const sentiments: Record<string, number> = {};
    for (const t of threads) {
      const intent = t.aiIntent ?? 'unknown';
      intents[intent] = (intents[intent] ?? 0) + 1;
      const sentiment = t.aiSentiment ?? 'unknown';
      sentiments[sentiment] = (sentiments[sentiment] ?? 0) + 1;
    }
    return { intents, sentiments, total: threads.length };
  }

  async getResponseTimes(input: { businessId: string; from?: string; to?: string }) {
    const from = input.from ? new Date(input.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = input.to ? new Date(input.to) : new Date();
    const messages = await this.prisma.client.keyInboxMessage.findMany({
      where: {
        businessId: input.businessId,
        direction: 'OUTBOUND',
        sentAt: { gte: from, lte: to },
      },
      select: { sentAt: true, threadId: true },
      orderBy: { sentAt: 'asc' },
      take: 500,
    });
    const threadIds = [...new Set(messages.map((m: { threadId: string }) => m.threadId))];
    const inbound = await this.prisma.client.keyInboxMessage.findMany({
      where: {
        businessId: input.businessId,
        threadId: { in: threadIds },
        direction: 'INBOUND',
      },
      select: { threadId: true, receivedAt: true },
    });
    const latestInboundByThread: Record<string, Date> = {};
    for (const m of inbound) {
      if (m.receivedAt && (!latestInboundByThread[m.threadId] || m.receivedAt > latestInboundByThread[m.threadId])) {
        latestInboundByThread[m.threadId] = m.receivedAt;
      }
    }
    let totalMs = 0;
    let count = 0;
    for (const m of messages) {
      const inboundTime = latestInboundByThread[m.threadId];
      if (m.sentAt && inboundTime && m.sentAt > inboundTime) {
        totalMs += m.sentAt.getTime() - inboundTime.getTime();
        count++;
      }
    }
    const averageMinutes = count > 0 ? Math.round(totalMs / count / 60000) : 0;
    return { averageMinutes, sampleSize: count };
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'get_threads': {
        const threads = await this.getThreads({
          businessId: command.businessId,
          status: command.parameters.status as string,
          priority: command.parameters.priority as string,
          assignedTo: command.parameters.assignedTo as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, threads);
      }
      case 'send_reply': {
        const reply = await this.sendReply({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          body: command.parameters.body as string,
          channel: command.parameters.channel as string,
          attachments: command.parameters.attachments as string[],
        });
        return connectorOk(command, start, reply);
      }
      case 'classify_message': {
        const classified = await this.classifyMessage({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          intent: command.parameters.intent as string,
          priority: command.parameters.priority as string,
          assignTo: command.parameters.assignTo as string,
        });
        return connectorOk(command, start, classified);
      }
      case 'close_thread': {
        const closed = await this.closeThread({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          resolution: command.parameters.resolution as string,
        });
        return connectorOk(command, start, closed);
      }
      case 'snooze_thread': {
        const snoozed = await this.snoozeThread({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          until: command.parameters.until as string,
          reason: command.parameters.reason as string,
        });
        return connectorOk(command, start, snoozed);
      }
      case 'assign_thread': {
        const assigned = await this.assignThread({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
          userId: command.parameters.userId as string,
        });
        return connectorOk(command, start, assigned);
      }
      case 'get_intelligence_report': {
        const report = await this.getIntelligenceReport({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
        });
        return connectorOk(command, start, report);
      }
      case 'merge_threads': {
        const merged = await this.mergeThreads({
          businessId: command.businessId,
          masterThreadId: command.parameters.masterThreadId as string,
          duplicateThreadId: command.parameters.duplicateThreadId as string,
        });
        return connectorOk(command, start, merged);
      }
      case 'get_unread_threads': {
        const unread = await this.getUnreadThreads({
          businessId: command.businessId,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, unread);
      }
      case 'get_thread_details': {
        const details = await this.getThreadDetails({
          businessId: command.businessId,
          threadId: command.parameters.threadId as string,
        });
        return connectorOk(command, start, details);
      }
      case 'get_inbox_summary': {
        const summary = await this.getInboxSummary({ businessId: command.businessId });
        return connectorOk(command, start, summary);
      }
      case 'get_classification_stats': {
        const stats = await this.getClassificationStats({ businessId: command.businessId });
        return connectorOk(command, start, stats);
      }
      case 'get_response_times': {
        const responseTimes = await this.getResponseTimes({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
        });
        return connectorOk(command, start, responseTimes);
      }
      default:
        return connectorFail(command, start, `Unknown inbox action: ${command.action}`);
    }
  }
}
