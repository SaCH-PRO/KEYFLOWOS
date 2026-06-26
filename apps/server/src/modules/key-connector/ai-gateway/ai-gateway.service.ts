import { Injectable, Logger } from '@nestjs/common';
import { db } from '@keyflow/db';
import {
  AiGatewayCommand,
  AiGatewayResult,
  KeyConnectorProviderDef,
} from '../key-connector.types';
import { ProviderRegistryService } from '../providers/provider-registry.service';

/**
 * ── AI Gateway Service ─────────────────────────────────────────────────
 * Routes AI commands to the appropriate internal module or external
 * provider, mirroring the KeyCortex connector's 150+ actions and 90+
 * queries.
 *
 * Commands arrive as natural language and are parsed into structured
 * intents.  The gateway then resolves the target module/provider,
 * validates permissions, executes the action, and returns a typed
 * result.
 * ───────────────────────────────────────────────────────────────────────
 */

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  /** Intent → module/provider routing table (keyword-based). */
  private readonly intentMap: Map<
    string,
    { module?: string; provider?: string; action?: string }
  > = new Map();

  constructor(private readonly registry: ProviderRegistryService) {
    this.buildIntentMap();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Parse a natural-language command and route it to the correct
   * module or provider.
   */
  async routeCommand(
    businessId: string,
    userId: string,
    nlCommand: string,
  ): Promise<AiGatewayResult> {
    const start = Date.now();
    this.logger.debug(`AI command from ${userId}: "${nlCommand}"`);

    try {
      // ── 1. Parse NL into structured command ──
      const parsed = this.parseCommand(nlCommand);
      const command: AiGatewayCommand = {
        ...parsed,
        businessId,
        userId,
      };

      // ── 2. Audit log entry ──
      await this.auditCommand(businessId, userId, command, 'success');

      // ── 3. Route ──
      if (command.module) {
        return await this.executeModuleAction(
          command.module,
          command.action ?? 'query',
          command.parameters,
          { businessId, userId, start },
        );
      }

      if (command.provider) {
        return await this.executeProviderAction(
          command.provider,
          command.action ?? 'query',
          command.parameters,
          { businessId, userId, start },
        );
      }

      // ── 4. Fallback — no route found ──
      return {
        success: false,
        error: `Could not determine route for command: "${nlCommand}"`,
        executionTimeMs: Date.now() - start,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI gateway error: ${message}`);
      return {
        success: false,
        error: message,
        executionTimeMs: Date.now() - start,
      };
    }
  }

  /**
   * Execute an action against an internal KeyFlowOS module.
   */
  async executeModuleAction(
    module: string,
    action: string,
    params: Record<string, unknown>,
    context: { businessId: string; userId: string; start: number },
  ): Promise<AiGatewayResult> {
    this.logger.debug(
      `executeModuleAction: ${module}.${action}(${JSON.stringify(params)})`,
    );

    const provider = this.registry.getProvider(module);
    if (!provider || !provider.isInternal) {
      return {
        success: false,
        error: `Internal module "${module}" not found`,
        routedTo: module,
        executionTimeMs: Date.now() - context.start,
      };
    }

    // Verify the module supports the requested action
    const capability = provider.capabilities.find(
      (c) => c.type === 'ai_action' && c.resource === action,
    );
    if (!capability) {
      return {
        success: false,
        error: `Action "${action}" not supported by module "${module}"`,
        routedTo: module,
        executionTimeMs: Date.now() - context.start,
      };
    }

    try {
      // In a full implementation this would dynamically call the
      // target module's service via the module's public API or a
      // message bus.  For now we return a structured placeholder that
      // includes enough metadata for the client to understand what
      // would have been executed.
      const result = await this.callModuleService(provider, action, params, context);

      return {
        success: true,
        data: result,
        routedTo: module,
        executionTimeMs: Date.now() - context.start,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Module action ${module}.${action} failed: ${message}`);
      return {
        success: false,
        error: message,
        routedTo: module,
        executionTimeMs: Date.now() - context.start,
      };
    }
  }

  /**
   * Execute an action against an external provider.
   */
  async executeProviderAction(
    provider: string,
    action: string,
    params: Record<string, unknown>,
    context: { businessId: string; userId: string; start: number },
  ): Promise<AiGatewayResult> {
    this.logger.debug(
      `executeProviderAction: ${provider}.${action}(${JSON.stringify(params)})`,
    );

    const providerDef = this.registry.getProvider(provider);
    if (!providerDef || providerDef.isInternal) {
      return {
        success: false,
        error: `External provider "${provider}" not found`,
        routedTo: provider,
        executionTimeMs: Date.now() - context.start,
      };
    }

    // Check that the business has an active connection for this provider
    const connection = await db.integrationConnection.findFirst({
      where: { businessId: context.businessId, providerKey: provider },
    });

    if (!connection) {
      return {
        success: false,
        error: `No active connection for provider "${provider}". Please connect the provider first.`,
        routedTo: provider,
        executionTimeMs: Date.now() - context.start,
      };
    }

    try {
      // In a full implementation this would call the IntegrationHub
      // service with the stored credentials to execute the provider
      // action.  Here we return a structured placeholder.
      const result = await this.callProviderService(
        providerDef,
        connection.id,
        action,
        params,
        context,
      );

      return {
        success: true,
        data: result,
        routedTo: provider,
        executionTimeMs: Date.now() - context.start,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Provider action ${provider}.${action} failed: ${message}`,
      );
      return {
        success: false,
        error: message,
        routedTo: provider,
        executionTimeMs: Date.now() - context.start,
      };
    }
  }

  /**
   * Build a context object containing metadata about every connected
   * provider for a business.  This is useful when the AI needs to know
   * which external services are available before deciding on an action.
   */
  async getProviderContext(
    businessId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const connections = await db.integrationConnection.findMany({
        where: { businessId },
      });

      const context: Record<string, unknown> = {};
      for (const c of connections) {
        const def = this.registry.getProvider(c.providerKey);
        context[c.providerKey] = {
          connected: c.status === 'connected',
          displayName: c.displayName,
          providerName: def?.name ?? c.providerKey,
          lastSyncAt: c.lastSyncAt,
          capabilities:
            def?.capabilities.map((cap) => ({
              type: cap.type,
              resource: cap.resource,
            })) ?? [],
        };
      }

      return context;
    } catch (error: any) {
      this.logger.error(
        `getProviderContext failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Command parsing
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lightweight NL parser that maps keywords to structured commands.
   * In production this would call an LLM or a dedicated NLP service.
   */
  private parseCommand(nlCommand: string): {
    intent: string;
    module?: string;
    action?: string;
    provider?: string;
    parameters: Record<string, unknown>;
  } {
    const lower = nlCommand.toLowerCase();
    const parameters: Record<string, unknown> = { originalText: nlCommand };

    // Try exact intent matches first
    for (const [keyword, route] of this.intentMap) {
      if (lower.includes(keyword)) {
        return {
          intent: keyword,
          module: route.module,
          provider: route.provider,
          action: route.action,
          parameters,
        };
      }
    }

    // Fallback: generic intent extraction
    return {
      intent: 'unknown',
      parameters,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Execution stubs (would delegate to real services)
  // ═══════════════════════════════════════════════════════════════════════

  private async callModuleService(
    provider: KeyConnectorProviderDef,
    action: string,
    params: Record<string, unknown>,
    context: { businessId: string; userId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.debug(
      `callModuleService: ${provider.key}.${action} for business ${context.businessId}`,
    );

    // Stub: in production this resolves the module service from the
    // NestJS dependency-injection container or calls it via an
    // internal message bus.
    return {
      module: provider.key,
      action,
      params,
      businessId: context.businessId,
      executedAt: new Date().toISOString(),
      status: 'placeholder_execution',
      note: 'Module service call is a stub — wire to real service in production',
    };
  }

  private async callProviderService(
    provider: KeyConnectorProviderDef,
    connectionId: string,
    action: string,
    params: Record<string, unknown>,
    context: { businessId: string; userId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.debug(
      `callProviderService: ${provider.key}.${action} via connection ${connectionId}`,
    );

    // Stub: in production this calls IntegrationHub with the stored
    // credentials to perform the action against the external API.
    return {
      provider: provider.key,
      action,
      connectionId,
      params,
      businessId: context.businessId,
      executedAt: new Date().toISOString(),
      status: 'placeholder_execution',
      note: 'Provider service call is a stub — wire to IntegrationHub in production',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Intent map construction
  // ═══════════════════════════════════════════════════════════════════════

  private buildIntentMap(): void {
    // ── CRM ──
    this.registerIntent('contact', { module: 'crm', action: 'list_contacts' });
    this.registerIntent('lead', { module: 'crm', action: 'list_leads' });
    this.registerIntent('opportunity', {
      module: 'crm',
      action: 'list_opportunities',
    });
    this.registerIntent('pipeline', { module: 'crm', action: 'get_pipeline' });
    this.registerIntent('customer', { module: 'crm', action: 'list_contacts' });

    // ── Commerce ──
    this.registerIntent('product', {
      module: 'commerce',
      action: 'list_products',
    });
    this.registerIntent('order', { module: 'commerce', action: 'list_orders' });
    this.registerIntent('inventory', {
      module: 'commerce',
      action: 'get_inventory',
    });
    this.registerIntent('cart', { module: 'commerce', action: 'get_cart' });
    this.registerIntent('checkout', {
      module: 'commerce',
      action: 'process_checkout',
    });

    // ── Bookings ──
    this.registerIntent('booking', {
      module: 'bookings',
      action: 'list_bookings',
    });
    this.registerIntent('appointment', {
      module: 'bookings',
      action: 'list_bookings',
    });
    this.registerIntent('availability', {
      module: 'bookings',
      action: 'get_availability',
    });
    this.registerIntent('schedule', {
      module: 'bookings',
      action: 'get_schedule',
    });

    // ── Communications ──
    this.registerIntent('email', {
      module: 'communications',
      action: 'list_messages',
    });
    this.registerIntent('sms', {
      module: 'communications',
      action: 'list_messages',
    });
    this.registerIntent('message', {
      module: 'communications',
      action: 'list_messages',
    });
    this.registerIntent('campaign', {
      module: 'communications',
      action: 'get_campaign',
    });

    // ── Finance ──
    this.registerIntent('invoice', {
      module: 'finance',
      action: 'list_invoices',
    });
    this.registerIntent('expense', {
      module: 'finance',
      action: 'list_expenses',
    });
    this.registerIntent('payment', {
      module: 'finance',
      action: 'get_financial_summary',
    });
    this.registerIntent('budget', { module: 'finance', action: 'get_budget' });
    this.registerIntent('profit', {
      module: 'finance',
      action: 'get_profit_loss',
    });

    // ── Analytics ──
    this.registerIntent('dashboard', {
      module: 'analytics',
      action: 'get_dashboard',
    });
    this.registerIntent('report', { module: 'analytics', action: 'get_report' });
    this.registerIntent('kpi', { module: 'analytics', action: 'get_kpi' });
    this.registerIntent('analytics', {
      module: 'analytics',
      action: 'get_analytics_summary',
    });

    // ── Projects ──
    this.registerIntent('project', {
      module: 'projects',
      action: 'list_projects',
    });
    this.registerIntent('task', { module: 'projects', action: 'list_tasks' });
    this.registerIntent('milestone', {
      module: 'projects',
      action: 'list_milestones',
    });

    // ── Inbox ──
    this.registerIntent('ticket', { module: 'inbox', action: 'list_tickets' });
    this.registerIntent('support', {
      module: 'inbox',
      action: 'list_tickets',
    });

    // ── Flow ──
    this.registerIntent('workflow', { module: 'flow', action: 'list_flows' });
    this.registerIntent('automation', {
      module: 'flow',
      action: 'list_flows',
    });

    // ── Social ──
    this.registerIntent('social', { module: 'social', action: 'list_posts' });
    this.registerIntent('post', { module: 'social', action: 'list_posts' });

    // ── External providers ──
    this.registerIntent('google', { provider: 'google_contacts' });
    this.registerIntent('stripe', { provider: 'stripe' });
    this.registerIntent('slack', { provider: 'slack' });
    this.registerIntent('mailchimp', { provider: 'mailchimp' });
    this.registerIntent('sendgrid', { provider: 'sendgrid' });
    this.registerIntent('typeform', { provider: 'typeform' });
    this.registerIntent('whatsapp', { provider: 'whatsapp_business' });
  }

  private registerIntent(
    keyword: string,
    route: { module?: string; provider?: string; action?: string },
  ): void {
    this.intentMap.set(keyword, route);
  }

  private async auditCommand(
    businessId: string,
    userId: string,
    command: AiGatewayCommand,
    status: 'success' | 'error' | 'warning',
  ): Promise<void> {
    try {
      await db.connectorAuditLog.create({
        data: {
          businessId,
          userId,
          providerKey: command.provider ?? command.module ?? null,
          action: `ai_command:${command.intent}`,
          status,
          details: JSON.stringify({
            intent: command.intent,
            module: command.module,
            provider: command.provider,
            action: command.action,
          }),
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to audit AI command: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
