/**
 * KeyInbox Organ Adapter
 *
 * Plugs the omnichannel inbox into KEY's peripheral nervous system.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { KeyInboxService } from '../../key-inbox/key-inbox.service';
import { KeyInboxReplySenderService } from '../../key-inbox/key-inbox-reply-sender.service';
import { KeyOrganAdapter } from './key-organ-adapter.interface';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class KeyInboxAdapterService extends KeyOrganAdapter {
  readonly organId = 'key_inbox';
  readonly organName = 'Key Inbox';
  private readonly logger = new Logger(KeyInboxAdapterService.name);

  constructor(
    private readonly inbox: KeyInboxService,
    private readonly replySender: KeyInboxReplySenderService,
    eventBus: KeyCortexEventBusService,
  ) {
    super();
    this.connect(eventBus);
  }

  async getState(businessId: string): Promise<import('./key-organ-adapter.interface').KeyOrganState> {
    try {
      const [threads, insights] = await Promise.all([
        this.inbox.listThreads(businessId, { limit: 1 }),
        this.inbox.listInsights(businessId, 'DAILY', 1),
      ]);
      return {
        healthy: true,
        status: 'Inbox active',
        metadata: {
          hasUnread: threads.length > 0,
          latestInsightAt: insights[0]?.periodEnd ?? null,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`getState failed: ${err instanceof Error ? err.message : String(err)}`);
      return { healthy: false, status: 'Inbox state unavailable', gaps: ['inbox_error'] };
    }
  }

  listTools(): KeyCortexToolDefinition[] {
    return [
      this.makeTool(
        'key_inbox.list_threads',
        'List inbox threads',
        1,
        false,
        [],
        {
          channel: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string' },
          intent: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
        async (ctx, input) => {
          const threads = await this.inbox.listThreads(ctx.businessId, {
            channel: input.channel as string,
            status: input.status as string,
            priority: input.priority as string,
            intent: input.intent as string,
            limit: input.limit as number,
            offset: input.offset as number,
          });
          return { success: true, data: { threads, count: threads.length } };
        },
      ),
      this.makeTool(
        'key_inbox.get_thread',
        'Get an inbox thread with messages',
        1,
        false,
        ['threadId'],
        {},
        async (ctx, input) => {
          const thread = await this.inbox.getThread(ctx.businessId, input.threadId as string);
          return { success: true, data: { thread } };
        },
      ),
      this.makeTool(
        'key_inbox.send_reply',
        'Send or draft a reply in an inbox thread',
        2,
        true,
        ['threadId', 'contentText'],
        {
          mode: { type: 'string', enum: ['draft', 'send'] },
          attachments: { type: 'array' },
        },
        async (ctx, input) => {
          const result = await this.inbox.addReply(
            ctx.businessId,
            input.threadId as string,
            input.contentText as string,
            (input.attachments as Record<string, unknown>[]) ?? [],
            {
              mode: (input.mode as 'draft' | 'send') ?? 'send',
              userId: ctx.userId,
            },
          );
          return { success: true, data: result };
        },
      ),
      this.makeTool(
        'key_inbox.mark_resolved',
        'Mark an inbox thread as done',
        1,
        false,
        ['threadId'],
        {},
        async (ctx, input) => {
          const thread = await this.inbox.updateThread(ctx.businessId, input.threadId as string, { status: 'DONE' });
          return { success: true, data: { threadId: thread.id, status: thread.status } };
        },
      ),
      this.makeTool(
        'key_inbox.generate_brief',
        'Generate an inbox intelligence brief',
        1,
        false,
        [],
        {
          scope: { type: 'string', enum: ['DAILY', 'WEEKLY', 'CUSTOM'] },
        },
        async (ctx, input) => {
          const brief = await this.inbox.generateBrief(ctx.businessId, (input.scope as any) ?? 'DAILY');
          return { success: true, data: brief };
        },
      ),
    ];
  }

  async executeTool(
    toolName: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): Promise<KeyCortexToolResult> {
    const tool = this.listTools().find((t) => t.name === toolName);
    if (!tool) return { success: false, error: `Tool ${toolName} not found` };
    return tool.handler(ctx, input);
  }

  // ========================================================================
  // Event bridge: surface inbox lifecycle on canonical bus
  // ========================================================================

  @OnEvent('key_inbox.message_received')
  async onMessageReceived(payload: { businessId: string; threadId: string; messageId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'message.received',
      businessId: payload.businessId,
      payload,
      metadata: { entityType: 'Message', entityId: payload.messageId, importance: 'normal' },
    });
  }

  @OnEvent('key_inbox.reply_sent')
  async onReplySent(payload: { businessId: string; threadId: string; messageId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'message.sent',
      businessId: payload.businessId,
      payload,
      metadata: { entityType: 'Message', entityId: payload.messageId },
    });
  }

  @OnEvent('key_inbox.genome_signal_detected')
  async onGenomeSignal(payload: { businessId: string; signalType: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'signal.detected',
      businessId: payload.businessId,
      payload,
      metadata: { importance: 'high' },
    });
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private makeTool(
    name: string,
    description: string,
    riskTier: 1 | 2 | 3 | 4,
    requiresApproval: boolean,
    required: string[],
    properties: Record<string, unknown>,
    handler: KeyCortexToolDefinition['handler'],
  ): KeyCortexToolDefinition {
    return {
      name,
      module: this.organId,
      description,
      riskTier,
      requiresApproval,
      parameters: { type: 'object', properties, required },
      handler,
    };
  }
}
