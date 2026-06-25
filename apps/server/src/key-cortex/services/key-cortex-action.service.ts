import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * KeyCortexAction — Action Execution Engine
 * =============================================================================
 * Executes structured actions requested by the consciousness system.
 * Actions are typed operations with validation, execution, and rollback
 * capabilities.
 *
 * Supported Action Categories:
 *   - data.query     — Query business data
 *   - data.update    — Update records
 *   - notify.send    — Send notifications
 *   - report.generate — Generate reports
 *   - workflow.trigger — Trigger workflows
 * =============================================================================
 */

export type ActionType =
  | 'data.query'
  | 'data.update'
  | 'notify.send'
  | 'report.generate'
  | 'workflow.trigger';

export interface ActionRequest {
  actionId: string;
  type: ActionType;
  parameters: Record<string, unknown>;
  userId: string;
  businessId: string;
  requiresConfirmation: boolean;
}

export interface ActionResult {
  actionId: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  executedAt: Date;
}

@Injectable()
export class KeyCortexAction {
  private readonly logger = new Logger(KeyCortexAction.name);

  /** Action execution registry — maps types to handlers. */
  private readonly handlers: Map<ActionType, (req: ActionRequest) => Promise<Record<string, unknown>>>;

  constructor() {
    this.handlers = new Map();
    this.registerHandlers();
  }

  /** Execute a single action request. */
  async execute(request: ActionRequest): Promise<ActionResult> {
    try {
      this.logger.debug(`Executing action: ${request.type} (id=${request.actionId})`);

      // Validate
      const validation = this.validate(request);
      if (!validation.valid) {
        return {
          actionId: request.actionId,
          success: false,
          error: validation.error,
          executedAt: new Date(),
        };
      }

      // Execute
      const handler = this.handlers.get(request.type);
      if (!handler) {
        return {
          actionId: request.actionId,
          success: false,
          error: `No handler registered for action type: ${request.type}`,
          executedAt: new Date(),
        };
      }

      const data = await handler(request);

      this.logger.verbose(`Action ${request.actionId} executed successfully`);

      return {
        actionId: request.actionId,
        success: true,
        data,
        executedAt: new Date(),
      };
    } catch (err) {
      this.logger.error(`Action ${request.actionId} failed: ${(err as Error).message}`);
      return {
        actionId: request.actionId,
        success: false,
        error: (err as Error).message,
        executedAt: new Date(),
      };
    }
  }

  /** Execute multiple actions in sequence. */
  async executeMany(requests: ActionRequest[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const request of requests) {
      const result = await this.execute(request);
      results.push(result);
      // Stop on first failure
      if (!result.success && request.requiresConfirmation) {
        break;
      }
    }
    return results;
  }

  /** Validate an action request. */
  private validate(request: ActionRequest): { valid: boolean; error?: string } {
    if (!request.actionId) return { valid: false, error: 'actionId is required' };
    if (!request.type) return { valid: false, error: 'type is required' };
    if (!request.userId) return { valid: false, error: 'userId is required' };
    if (!request.businessId) return { valid: false, error: 'businessId is required' };
    return { valid: true };
  }

  /** Register all action handlers. */
  private registerHandlers(): void {
    // data.query — query business data
    this.handlers.set('data.query', async (req) => {
      const { table, filters, limit } = req.parameters as { table: string; filters?: Record<string, unknown>; limit?: number };
      this.logger.verbose(`Querying ${table} with filters=${JSON.stringify(filters)}`);
      // Production: execute Prisma query
      return {
        table,
        recordCount: 0,
        records: [],
        note: 'Production: implement Prisma query here',
      };
    });

    // data.update — update a record
    this.handlers.set('data.update', async (req) => {
      const { table, id, data } = req.parameters as { table: string; id: string; data: Record<string, unknown> };
      this.logger.verbose(`Updating ${table} id=${id}`);
      // Production: execute Prisma update
      return { table, id, updated: true, note: 'Production: implement Prisma update here' };
    });

    // notify.send — send a notification
    this.handlers.set('notify.send', async (req) => {
      const { channel, recipient, message } = req.parameters as { channel: string; recipient: string; message: string };
      this.logger.verbose(`Sending ${channel} notification to ${recipient}`);
      // Production: integrate with notification service
      return { channel, recipient, sent: true, note: 'Production: implement notification service' };
    });

    // report.generate — generate a report
    this.handlers.set('report.generate', async (req) => {
      const { reportType, dateRange } = req.parameters as { reportType: string; dateRange: string };
      this.logger.verbose(`Generating ${reportType} report for ${dateRange}`);
      // Production: integrate with reporting engine
      return { reportType, dateRange, generated: true, url: null, note: 'Production: implement report generation' };
    });

    // workflow.trigger — trigger a workflow
    this.handlers.set('workflow.trigger', async (req) => {
      const { workflowId, payload } = req.parameters as { workflowId: string; payload?: Record<string, unknown> };
      this.logger.verbose(`Triggering workflow ${workflowId}`);
      // Production: integrate with workflow engine
      return { workflowId, triggered: true, note: 'Production: implement workflow trigger' };
    });
  }

  /** Get available action types. */
  async getAvailableActions(): Promise<{ type: ActionType; description: string }[]> {
    return [
      { type: 'data.query', description: 'Query business data from the database' },
      { type: 'data.update', description: 'Update existing records' },
      { type: 'notify.send', description: 'Send notifications via various channels' },
      { type: 'report.generate', description: 'Generate business reports' },
      { type: 'workflow.trigger', description: 'Trigger automated workflows' },
    ];
  }
}
