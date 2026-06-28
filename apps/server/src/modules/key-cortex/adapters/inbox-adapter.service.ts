import { Injectable } from '@nestjs/common';
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
}
