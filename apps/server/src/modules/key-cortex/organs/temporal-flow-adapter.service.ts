/**
 * TemporalFlow Organ Adapter
 *
 * Plugs the business timeline into KEY's peripheral nervous system.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TemporalFlowService } from '../../temporal-flow/temporal-flow.service';
import { KeyOrganAdapter } from './key-organ-adapter.interface';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class TemporalFlowAdapterService extends KeyOrganAdapter implements OnModuleInit {
  readonly organId = 'temporal_flow';
  readonly organName = 'Temporal Flow';
  private readonly logger = new Logger(TemporalFlowAdapterService.name);

  constructor(
    private readonly temporalFlow: TemporalFlowService,
    eventBus: KeyCortexEventBusService,
  ) {
    super();
    this.connect(eventBus);
  }

  onModuleInit(): void {
    // Tools are registered by the central adapter registrar in key-cortex.module
  }

  async getState(businessId: string): Promise<import('./key-organ-adapter.interface').KeyOrganState> {
    try {
      const analysis = await this.temporalFlow.analyze(businessId);
      return {
        healthy: true,
        status: 'Timeline active',
        metadata: {
          urgentItems: analysis.urgentItems?.length ?? 0,
          opportunities: analysis.opportunities?.length ?? 0,
          risks: analysis.risks?.length ?? 0,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`getState failed: ${err instanceof Error ? err.message : String(err)}`);
      return { healthy: false, status: 'Timeline analysis failed', gaps: ['analysis_error'] };
    }
  }

  listTools(): KeyCortexToolDefinition[] {
    return [
      this.makeTool(
        'temporal_flow.list_events',
        'List timeline events for a business',
        1,
        false,
        [],
        {
          source: { type: 'string' },
          type: { type: 'string' },
          status: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'number' },
        },
        async (ctx, input) => {
          const events = await this.temporalFlow.list(ctx.businessId, {
            source: input.source as string,
            type: input.type as string,
            status: input.status as string,
            from: input.from as string,
            to: input.to as string,
            limit: input.limit as number,
          });
          return { success: true, data: { events, count: events.length } };
        },
      ),
      this.makeTool(
        'temporal_flow.create_event',
        'Record an event on the business timeline',
        1,
        false,
        ['title'],
        {
          type: { type: 'string' },
          summary: { type: 'string' },
          description: { type: 'string' },
          startsAt: { type: 'string' },
          endsAt: { type: 'string' },
          importance: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
          reminderAt: { type: 'string' },
          entityType: { type: 'string' },
          entityId: { type: 'string' },
        },
        async (ctx, input) => {
          const event = await this.temporalFlow.emit({
            businessId: ctx.businessId,
            source: 'key_cortex',
            type: (input.type as string) ?? 'note',
            title: input.title as string,
            summary: (input.summary as string) ?? '',
            description: input.description as string,
            startsAt: input.startsAt ? new Date(input.startsAt as string) : undefined,
            endsAt: input.endsAt ? new Date(input.endsAt as string) : undefined,
            importance: (input.importance as any) ?? 'normal',
            reminderAt: input.reminderAt ? new Date(input.reminderAt as string) : undefined,
            entityType: input.entityType as string,
            entityId: input.entityId as string,
          });
          return { success: true, data: { eventId: event.id, title: event.title } };
        },
      ),
      this.makeTool(
        'temporal_flow.set_reminder',
        'Set a reminder on the timeline',
        1,
        false,
        ['title', 'reminderAt'],
        {
          description: { type: 'string' },
        },
        async (ctx, input) => {
          const event = await this.temporalFlow.emit({
            businessId: ctx.businessId,
            source: 'key_cortex',
            type: 'reminder',
            title: input.title as string,
            summary: (input.description as string) ?? '',
            reminderAt: new Date(input.reminderAt as string),
          });
          return { success: true, data: { eventId: event.id, reminderAt: event.reminderAt } };
        },
      ),
      this.makeTool(
        'temporal_flow.mark_resolved',
        'Mark a timeline event as resolved',
        1,
        false,
        ['eventId'],
        {},
        async (ctx, input) => {
          const result = await this.temporalFlow.markResolved(ctx.businessId, input.eventId as string);
          return { success: true, data: { updated: result.count } };
        },
      ),
      this.makeTool(
        'temporal_flow.analyze_timeline',
        'Analyze the business timeline for urgent items, risks, and opportunities',
        1,
        false,
        [],
        {},
        async (ctx) => {
          const analysis = await this.temporalFlow.analyze(ctx.businessId);
          return { success: true, data: analysis };
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
  // Event bridge: key_inbox.* → canonical bus as temporal events
  // ========================================================================

  @OnEvent('key_inbox.message_received')
  async onInboxMessageReceived(payload: { businessId: string; threadId: string; messageId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'inbox_message.recorded',
      businessId: payload.businessId,
      payload,
      metadata: { entityType: 'Message', entityId: payload.messageId },
    });
  }

  @OnEvent('key_inbox.opportunity_detected')
  async onOpportunity(payload: { businessId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'opportunity.detected',
      businessId: payload.businessId,
      payload,
    });
  }

  @OnEvent('key_inbox.risk_detected')
  async onRisk(payload: { businessId: string }): Promise<void> {
    if (!this.bus) return;
    await this.bus.publish({
      source: this.organId,
      type: 'risk.detected',
      businessId: payload.businessId,
      payload,
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
