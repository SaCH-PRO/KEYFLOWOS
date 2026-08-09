/**
 * KeyConnector Organ Adapter
 *
 * Plugs internal module integrations into KEY's nervous system.
 * Delegates internal module actions to KeyCortexConnectorService.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { KeyConnectorService } from '../../key-connector/key-connector.service';
import { KeyCortexConnectorService } from '../key-cortex-connector.service';
import { KeyOrganAdapter } from './key-organ-adapter.interface';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

@Injectable()
export class KeyConnectorAdapterService extends KeyOrganAdapter {
  readonly organId = 'key_connector';
  readonly organName = 'Key Connector';
  private readonly logger = new Logger(KeyConnectorAdapterService.name);

  constructor(
    private readonly keyConnector: KeyConnectorService,
    @Inject(forwardRef(() => KeyCortexConnectorService)) private readonly cortexConnector: KeyCortexConnectorService,
    eventBus: KeyCortexEventBusService,
  ) {
    super();
    this.connect(eventBus);
  }

  async getState(businessId: string): Promise<import('./key-organ-adapter.interface').KeyOrganState> {
    try {
      const connections = await this.keyConnector.listConnections(businessId);
      return {
        healthy: true,
        status: 'Connector hub active',
        metadata: {
          connectionCount: connections.length,
        },
      };
    } catch (err: unknown) {
      this.logger.error(`getState failed: ${err instanceof Error ? err.message : String(err)}`);
      return { healthy: false, status: 'Connector state unavailable', gaps: ['connector_error'] };
    }
  }

  listTools(): KeyCortexToolDefinition[] {
    return [
      this.makeTool(
        'key_connector.list_providers',
        'List available integration providers',
        1,
        false,
        [],
        {
          category: { type: 'string' },
        },
        async (ctx, input) => {
          const providers = await this.keyConnector.listProviders(ctx.businessId, input.category as string);
          return { success: true, data: { providers, count: providers.length } };
        },
      ),
      this.makeTool(
        'key_connector.list_connections',
        'List active connections for the business',
        1,
        false,
        [],
        {},
        async (ctx) => {
          const connections = await this.keyConnector.listConnections(ctx.businessId);
          return { success: true, data: { connections, count: connections.length } };
        },
      ),
      this.makeTool(
        'key_connector.check_health',
        'Check health of a connection',
        1,
        false,
        ['connectionId'],
        {},
        async (ctx, input) => {
          const health = await this.keyConnector.checkHealth(ctx.businessId, input.connectionId as string);
          return { success: true, data: health };
        },
      ),
      this.makeTool(
        'key_connector.execute_internal',
        'Execute an action against an internal module via the universal connector',
        2,
        true,
        ['module', 'action'],
        {
          params: { type: 'object' },
        },
        async (ctx, input) => {
          const result = await this.cortexConnector.execute({
            module: input.module as any,
            action: input.action as string,
            parameters: (input.params as Record<string, unknown>) ?? {},
            businessId: ctx.businessId,
            userId: ctx.userId ?? 'key_cortex',
            source: 'key_cortex',
            timestamp: new Date(),
            correlationId: ctx.correlationId ?? ctx.sessionId ?? 'unknown',
          });
          return { success: true, data: result };
        },
      ),
      this.makeTool(
        'key_connector.trigger_sync',
        'Trigger a sync job for a connection',
        2,
        true,
        ['connectionId'],
        {},
        async (ctx, input) => {
          const result = await this.keyConnector.triggerSync(ctx.businessId, input.connectionId as string);
          return { success: true, data: result };
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
