import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CortexActionResult,
  CortexActionType,
} from './key-cortex.types';

/**
 * KeyCortexCommandExecutionService
 *
 * Executes direct commands, module queries, and exposes module capabilities.
 * Acts as the v2 command execution surface for the reasoning orchestrator.
 */
@Injectable()
export class KeyCortexCommandExecutionService {
  private readonly logger = new Logger(KeyCortexCommandExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(KeyCortexConnectorService)
    private readonly connectorService?: KeyCortexConnectorService,
    @Optional()
    @Inject(KeyCortexExecutorService)
    private readonly executorService?: KeyCortexExecutorService,
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
  ) {}

  /**
   * Execute a command directly via the integration layer.
   */
  async executeCommand(
    businessId: string,
    userId: string,
    module: string,
    action: string,
    parameters: Record<string, unknown>,
    integrationV2Enabled = false,
    genomeV3Enabled = false,
    correlationId?: string,
  ): Promise<CortexActionResult> {
    const cid = correlationId ?? this.generateCorrelationId();
    this.logger.log(
      `[executeCommand][${cid}] business=${businessId} module=${module} action=${action}`,
    );

    if (integrationV2Enabled && this.executorService && this.connectorService) {
      try {
        const command = {
          module: module as any,
          action,
          parameters,
          businessId,
          userId,
          source: 'key_cortex' as const,
          timestamp: new Date(),
          correlationId: cid,
        };

        const result = await (this.executorService as any).execute(command, {
          businessId,
          userId,
        });

        const actionResult: CortexActionResult = {
          actionType: (action.toUpperCase().replace(/\s+/g, '_') ??
            'EXECUTE_TOOL') as CortexActionType,
          status: result.success ? 'success' : 'error',
          description: result.success
            ? `Successfully executed ${action} on ${module}`
            : `Execution failed: ${result.error ?? 'Unknown error'}`,
          result: result.success
            ? (result.data as Record<string, unknown>)
            : undefined,
          error: result.error,
          requiresApproval: false,
        };

        if (genomeV3Enabled && this.genomeBridgeService) {
          await (this.genomeBridgeService as any).reportActionOutcome(businessId, {
            actionId: action,
            status: actionResult.status,
            description: actionResult.description,
            result: actionResult.result ?? {},
            timestamp: new Date(),
            correlationId: cid,
          });
        }

        return actionResult;
      } catch (err: any) {
        this.logger.error(
          `[executeCommand][${cid}] v2 execution failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          actionType: 'EXECUTE_TOOL',
          status: 'error',
          description: `Command execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          error: err instanceof Error ? err.message : 'Unknown error',
          requiresApproval: false,
        };
      }
    }

    return {
      actionType: 'EXECUTE_TOOL',
      status: 'error',
      description:
        'Integration layer v2 is not active. Command execution requires the connector and executor services.',
      error: 'V2_NOT_AVAILABLE',
      requiresApproval: false,
    };
  }

  /**
   * Query data from a specific KeyFlowOS module.
   */
  async queryModule(
    businessId: string,
    module: string,
    queryName: string,
    params: Record<string, unknown>,
    integrationV2Enabled = false,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    this.logger.log(
      `[queryModule] business=${businessId} module=${module} query=${queryName}`,
    );

    if (integrationV2Enabled && this.connectorService) {
      try {
        const result = await (this.connectorService as any).query(
          module as any,
          queryName,
          { ...params, businessId },
        );
        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Query failed',
        };
      }
    }

    try {
      const data = await this.legacyModuleQuery(
        businessId,
        module,
        queryName,
        params,
      );
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Legacy query failed',
      };
    }
  }

  /**
   * Return all available module capabilities.
   */
  getCapabilities(
    integrationV2Enabled = false,
  ): Array<{
    module: string;
    actions: string[];
    queries: string[];
    description: string;
  }> {
    if (integrationV2Enabled && this.connectorService) {
      return this.connectorService
        .getAllCapabilities()
        .map((cap: any) => ({
          module: cap.module,
          actions: cap.actions.map((a: any) => a.name),
          queries: cap.queries.map((q: any) => q.name),
          description: cap.description,
        }));
    }

    return this.getLegacyCapabilities();
  }

  /**
   * Direct Prisma-based queries for legacy mode.
   */
  private async legacyModuleQuery(
    businessId: string,
    module: string,
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (module) {
      case 'crm': {
        if (queryName === 'get_contacts') {
          return (this.prisma.client as any).contact.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { updatedAt: 'desc' },
          });
        }
        if (queryName === 'get_contact') {
          return (this.prisma.client as any).contact.findFirst({
            where: {
              businessId,
              id: params.contactId as string,
              deletedAt: null,
            },
          });
        }
        break;
      }
      case 'commerce': {
        if (queryName === 'get_invoices') {
          return (this.prisma.client as any).invoice.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { createdAt: 'desc' },
          });
        }
        break;
      }
      case 'bookings': {
        if (queryName === 'get_bookings') {
          return (this.prisma.client as any).booking.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { startTime: 'desc' },
          });
        }
        break;
      }
      case 'autopilot': {
        if (queryName === 'get_tasks') {
          return (this.prisma.client as any).autopilotTask.findMany({
            where: { businessId },
            take: (params.limit as number) ?? 50,
            orderBy: { createdAt: 'desc' },
          });
        }
        break;
      }
    }
    throw new Error(`Unknown legacy query: ${module}.${queryName}`);
  }

  /**
   * Static capability list used when the connector service is unavailable.
   */
  private getLegacyCapabilities(): Array<{
    module: string;
    actions: string[];
    queries: string[];
    description: string;
  }> {
    return [
      {
        module: 'crm',
        actions: [
          'create_contact',
          'update_contact',
          'add_task',
          'get_contact',
        ],
        queries: ['get_contacts', 'get_contact'],
        description:
          'Customer relationship management — contacts, leads, tasks, timeline.',
      },
      {
        module: 'commerce',
        actions: ['create_invoice', 'get_invoice', 'update_invoice'],
        queries: ['get_invoices', 'get_products'],
        description: 'Invoicing, products, orders, quotes, payments.',
      },
      {
        module: 'bookings',
        actions: ['create_booking', 'update_booking', 'cancel_booking'],
        queries: ['get_bookings', 'get_availability'],
        description: 'Appointments, scheduling, availability management.',
      },
      {
        module: 'autopilot',
        actions: ['create_task', 'update_task', 'run_loop'],
        queries: ['get_tasks', 'get_loops'],
        description: 'Background task automation, delegation loops, monitoring.',
      },
      {
        module: 'content',
        actions: ['create_post', 'schedule_post'],
        queries: ['get_posts', 'get_campaigns'],
        description: 'Content creation, social media, campaigns, SEO.',
      },
      {
        module: 'analytics',
        actions: ['generate_report', 'run_analysis'],
        queries: ['get_metrics', 'get_dashboard'],
        description: 'Business analytics, metrics, reports, dashboards.',
      },
    ];
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
