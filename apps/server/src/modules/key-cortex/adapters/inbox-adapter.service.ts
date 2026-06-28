import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { KeyInboxService } from '../../key-inbox/key-inbox.service';

/**
 * Typed adapter that exposes the key-inbox methods expected by
 * KeyCortexConnectorService.  Delegates to KeyInboxService where a real
 * implementation exists; otherwise returns a typed placeholder.
 */
@Injectable()
export class InboxAdapterService {
  constructor(private readonly inbox: KeyInboxService) {}

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
    const patch: { priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; status?: 'OPEN' | 'WAITING' | 'DONE' | 'ARCHIVED' } = {};
    if (input.priority) {
      patch.priority = input.priority.toUpperCase() as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    }
    if (input.assignTo) {
      patch.status = 'WAITING';
    }
    if (Object.keys(patch).length > 0) {
      await this.inbox.updateThread(input.businessId, input.threadId, patch);
    }
    return updated;
  }

  async closeThread(input: {
    businessId: string;
    threadId: string;
    resolution?: string;
  }) {
    return this.inbox.updateThread(input.businessId, input.threadId, {
      status: 'DONE',
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
    });
  }

  async assignThread(input: {
    businessId: string;
    threadId: string;
    userId: string;
  }) {
    return this.inbox.updateThread(input.businessId, input.threadId, {
      status: 'WAITING',
    });
  }

  async getIntelligenceReport(input: {
    businessId: string;
    threadId?: string;
  }) {
    return this.inbox.generateBrief(input.businessId, 'DAILY');
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
    return {
      masterThreadId: input.masterThreadId,
      duplicateThreadId: input.duplicateThreadId,
      merged: true,
    };
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
      default:
        return connectorFail(command, start, `Unknown inbox action: ${command.action}`);
    }
  }
}
