/**
 * KeyConnector Organ Adapter
 *
 * Plugs internal module integrations into KEY's nervous system.
 * Delegates internal module actions to KeyCortexConnectorService.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { KeyConnectorService } from '../../key-connector/key-connector.service';
import { connectionView } from '../../key-connector/connection-view';
import { KeyCortexConnectorService } from '../key-cortex-connector.service';
import { KeyOrganAdapter } from './key-organ-adapter.interface';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolResult,
} from '../key-cortex-tool-registry.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';
import { deepRedact } from '../../../core/security/redaction';

/** deepRedact's marker, so both passes below answer a withheld field the same way. */
const WITHHELD = '***REDACTED***';

/**
 * The stored connector credential columns of IntegrationConnection (authData,
 * authDataRef). Matched case-insensitively on the field NAME, as deepRedact
 * matches; neither name holds one of the shared SENSITIVE_FIELD_PATTERNS, and
 * authData's own keys are whatever the provider needs (a bare `key`, a
 * `username`), so the whole value is withheld.
 */
const CONNECTOR_CREDENTIAL_FIELD = 'authdata';

function withholdConnectorCredentials(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) withholdConnectorCredentials(item);
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase().includes(CONNECTOR_CREDENTIAL_FIELD)) obj[key] = WITHHELD;
      else withholdConnectorCredentials(obj[key]);
    }
  }
  return value;
}

/**
 * W11-KEY-ORGAN-OUTPUT-REDACT review SEC-W11OR-1: key_connector.execute_internal
 * answered the KeyCortexConnectorService answer as it came, and module actions
 * behind it answer raw credential rows: social.get_connected_accounts answers
 * each SocialConnection with its token and refreshToken, and
 * settings.configure_integration answers the upserted IntegrationConnection
 * with its stored authData and authDataRef. The answer goes to the LLM
 * provider, into CortexActionLog.result (auditResultText takes only the call's
 * input values out, and unified-memory retrieval reads results back into
 * prompts) and into the BusinessEvent the registry emits.
 *
 * So this tool answers a copy: the JSON form (what the LLM and both audit sinks
 * receive anyway; a BigInt as its decimal text) with every connector
 * credential column withheld and then deepRedact's shared policy applied
 * (SENSITIVE_FIELD_PATTERNS: token, secret, password, apikey, ...), at any
 * depth, whatever module or action produced it. The caller's object is not
 * touched (an adapter may answer a shared object). An answer with no JSON form
 * (a cycle) keeps only its outcome: the action may already have written, so it
 * is not reported as failed.
 *
 * A backstop, not the projection: the rows should leave their modules without
 * secrets (follow-up for the social and settings adapters, and for the other
 * doors that forward KeyCortexConnectorService answers).
 */
function internalAnswerView(result: unknown): unknown {
  let plain: unknown;
  try {
    const json = JSON.stringify(result, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    if (json === undefined) return undefined;
    plain = JSON.parse(json);
  } catch {
    const outcome = (result ?? {}) as { success?: unknown; error?: unknown };
    return {
      success: outcome.success,
      ...(typeof outcome.error === 'string' ? { error: outcome.error } : {}),
      dataWithheld: 'the module answer has no JSON form',
    };
  }
  return deepRedact(withholdConnectorCredentials(plain));
}

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
          const entries = await this.keyConnector.listProviders(ctx.businessId, input.category as string);
          // W11-KEY-ORGAN-OUTPUT-REDACT: each entry's connection is mapped with
          // its stored credentials (authData); answer it as connectionView, the
          // shape GET key-connector/providers answers (SEC-W7KC-1).
          const providers = entries.map((entry) => ({
            provider: entry.provider,
            connection: entry.connection ? connectionView(entry.connection) : undefined,
          }));
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
          // W11-KEY-ORGAN-OUTPUT-REDACT: listConnections maps every row with its
          // stored provider credentials (authData), and this answer goes to the
          // LLM provider and into CortexActionLog.result. Answer each one as
          // connectionView, as GET key-connector/connections does (SEC-W7KC-1).
          const connections = (await this.keyConnector.listConnections(ctx.businessId)).map((connection) =>
            connectionView(connection),
          );
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
          // W11-KEY-ORGAN-OUTPUT-REDACT review SEC-W11OR-1: answered through
          // internalAnswerView, never as the raw module answer (see there).
          return { success: true, data: internalAnswerView(result) };
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
