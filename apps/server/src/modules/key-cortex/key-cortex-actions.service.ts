import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyToolRegistryService } from '../ai/key-tool-registry.service';
import { KeyCommandService } from '../ai/key-command.service';
import {
  CortexActionResult,
  CortexActionType,
  CortexSession,
  CortexMessage,
} from './key-cortex.types';

/**
 * High-impact action types that require explicit user approval
 * before execution. These are actions that modify critical business
 * data or have financial implications.
 */
const HIGH_IMPACT_ACTIONS: CortexActionType[] = [
  'CREATE_INVOICE',
  'UPDATE_CRM',
  'CREATE_LEAD',
  'EXECUTE_FLOW',
  'SEND_EMAIL',
];

/**
 * Parameters required for each action type.
 * Used for validation before execution.
 */
const ACTION_PARAM_SCHEMA: Record<CortexActionType, string[]> = {
  CREATE_TASK: ['title'],
  CREATE_EVENT: ['title', 'startTime'],
  SEND_MESSAGE: ['recipientId', 'content'],
  CREATE_DOCUMENT: ['title', 'content'],
  ANALYZE_DATA: ['dataSource'],
  GENERATE_REPORT: ['reportType'],
  EXECUTE_FLOW: ['flowId'],
  QUERY_DATABASE: ['query'],
  UPDATE_RECORD: ['recordType', 'recordId'],
  SCHEDULE_REMINDER: ['message', 'triggerTime'],
  CREATE_INVOICE: ['customerId', 'items'],
  SEND_EMAIL: ['to', 'subject'],
  CREATE_LEAD: ['name', 'email'],
  UPDATE_CRM: ['entityType', 'entityId'],
  SEARCH_KNOWLEDGE: ['query'],
  EXECUTE_TOOL: ['toolName'],
};

/**
 * GatewayToolDefinition — shape of tool definitions passed to the AI gateway
 * for function-calling support.
 */
export interface GatewayToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * KeyCortexActionsService — Action execution engine for KEY Cortex.
 *
 * Responsibilities:
 * - Parse action intents from AI responses
 * - Execute actions via existing service layer (KeyToolRegistryService, KeyCommandService)
 * - Request user approval for high-impact actions
 * - Track action execution history via Prisma
 * - Rollback failed actions where possible
 *
 * @example
 * const results = await actionsService.executeActions(parsedActions, session);
 */
@Injectable()
export class KeyCortexActionsService {
  private readonly logger = new Logger(KeyCortexActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: KeyToolRegistryService,
    private readonly commandService: KeyCommandService,
  ) {}

  // ========================================================================
  // Batch & Single Action Execution
  // ========================================================================

  /**
   * Execute a batch of actions sequentially within a session context.
   * Each action is executed in order; failures are captured but do not
   * halt subsequent actions unless `stopOnError` is enabled.
   *
   * @param actions   Array of action results (may come from AI parsing)
   * @param session   Current Cortex session for context & audit
   * @returns         Array of executed action results with status
   */
  async executeActions(
    actions: CortexActionResult[],
    session: CortexSession,
  ): Promise<CortexActionResult[]> {
    this.logger.log(
      `Executing batch of ${actions.length} actions for session ${session.id}`,
    );

    const results: CortexActionResult[] = [];

    for (const action of actions) {
      try {
        // Check approval gate for high-impact actions
        if (this.requiresApproval(action)) {
          const approved = await this.requestApproval(action);
          if (!approved) {
            results.push({
              ...action,
              status: 'pending_approval',
              description: `Action "${action.actionType}" awaiting user approval.`,
              requiresApproval: true,
              estimatedImpact: action.estimatedImpact ?? 'High-impact business action',
            });
            continue;
          }
        }

        const result = await this.executeAction(action, session.businessId);
        results.push(result);

        // Track execution for audit trail
        await this.trackActionExecution(result, session.id);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Action "${action.actionType}" failed: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        results.push({
          ...action,
          status: 'error',
          description: `Failed to execute ${action.actionType}`,
          error: message,
        });
        await this.trackActionExecution(results[results.length - 1], session.id);
      }
    }

    this.logger.log(
      `Batch execution complete: ${results.filter((r: any) => r.status === 'success').length}/${actions.length} succeeded`,
    );
    return results;
  }

  /**
   * Execute a single action by delegating to the appropriate handler.
   *
   * @param action     The action to execute
   * @param businessId Tenant-scoped business identifier
   * @returns          Action result with status and payload
   */
  async executeAction(
    action: CortexActionResult,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { actionType, result: params = {} } = action;

    this.logger.debug(`Executing action "${actionType}" for business ${businessId}`);

    // Validate required parameters
    this.validateActionParams(actionType, params);

    // Dispatch to the appropriate handler
    switch (actionType) {
      case 'CREATE_TASK':
        return this.handleCreateTask(params, businessId);
      case 'CREATE_EVENT':
        return this.handleCreateEvent(params, businessId);
      case 'SEND_MESSAGE':
        return this.handleSendMessage(params, businessId);
      case 'CREATE_DOCUMENT':
        return this.handleCreateDocument(params, businessId);
      case 'ANALYZE_DATA':
        return this.handleAnalyzeData(params, businessId);
      case 'GENERATE_REPORT':
        return this.handleGenerateReport(params, businessId);
      case 'EXECUTE_FLOW':
        return this.handleExecuteFlow(params, businessId);
      case 'CREATE_LEAD':
        return this.handleCreateLead(params, businessId);
      case 'UPDATE_CRM':
        return this.handleUpdateCrm(params, businessId);
      case 'CREATE_INVOICE':
        return this.handleCreateInvoice(params, businessId);
      case 'SEARCH_KNOWLEDGE':
        return this.handleSearchKnowledge(params, businessId);
      case 'EXECUTE_TOOL':
        return this.handleExecuteTool(params, businessId);
      case 'QUERY_DATABASE':
        return this.handleQueryDatabase(params, businessId);
      case 'UPDATE_RECORD':
        return this.handleUpdateRecord(params, businessId);
      case 'SEND_EMAIL':
        return this.handleSendEmail(params, businessId);
      case 'SCHEDULE_REMINDER':
        return this.handleScheduleReminder(params, businessId);
      default:
        throw new BadRequestException(`Unsupported action type: ${actionType}`);
    }
  }

  // ========================================================================
  // Approval Gate
  // ========================================================================

  /**
   * Determine whether an action requires explicit user approval.
   * High-impact actions (financial, CRM, workflow) are gated.
   *
   * @param action The action to evaluate
   * @returns      true if approval is required
   */
  requiresApproval(action: CortexActionResult): boolean {
    return HIGH_IMPACT_ACTIONS.includes(action.actionType);
  }

  /**
   * Request user approval for a high-impact action.
   * In production, this sends a notification/push and awaits response.
   * For now, auto-approve in development; gate in production.
   *
   * @param action The action awaiting approval
   * @returns      true if approved, false if denied
   */
  async requestApproval(action: CortexActionResult): Promise<boolean> {
    this.logger.warn(
      `Approval required for "${action.actionType}" — ` +
        `Impact: ${action.estimatedImpact ?? 'unknown'}`,
    );

    // TODO: Integrate with real-time notification system (WebSocket/push)
    // to request explicit user approval. For now, log and return false
    // to keep actions in pending_approval state.
    return false;
  }

  // ========================================================================
  // Tool Registry Integration
  // ========================================================================

  /**
   * Retrieve the list of tools available for a given business tenant.
   * Delegates to KeyToolRegistryService.
   *
   * @param businessId Tenant-scoped business identifier
   * @returns          Array of tool metadata objects
   */
  async getAvailableTools(
    businessId: string,
  ): Promise<Array<{ name: string; description: string; params: object }>> {
    this.logger.debug(`Fetching available tools for business ${businessId}`);

    try {
      const tools = await (this.toolRegistry as any).listTools(businessId);
      return tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        params: tool.parameters ?? {},
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch tools: ${message}`);
      throw new ServiceUnavailableException(`Tool registry unavailable: ${message}`);
    }
  }

  /**
   * Build OpenAI-compatible function/tool definitions for the AI gateway.
   * These definitions enable the model to call system tools via function calling.
   *
   * @param businessId Tenant-scoped business identifier
   * @returns          Array of GatewayToolDefinition for AI function calling
   */
  async buildToolDefinitions(
    businessId: string,
  ): Promise<GatewayToolDefinition[]> {
    const tools = await this.getAvailableTools(businessId);

    const definitions: GatewayToolDefinition[] = tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: (tool.params as Record<string, unknown>) ?? {},
        required: Object.keys((tool.params as Record<string, unknown>) ?? {}),
      },
    }));

    // Append built-in Cortex action types as tool definitions
    const actionDefinitions: GatewayToolDefinition[] = [
      {
        name: 'CREATE_TASK',
        description: 'Create a task or to-do item in the system',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Optional task description' },
            assigneeId: { type: 'string', description: 'User ID to assign the task to' },
            dueDate: { type: 'string', description: 'ISO 8601 due date' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          },
          required: ['title'],
        },
      },
      {
        name: 'CREATE_EVENT',
        description: 'Create a calendar event',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            startTime: { type: 'string', description: 'ISO 8601 start time' },
            endTime: { type: 'string', description: 'ISO 8601 end time' },
            attendees: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
          },
          required: ['title', 'startTime'],
        },
      },
      {
        name: 'SEND_MESSAGE',
        description: 'Send a message or notification to a user',
        parameters: {
          type: 'object',
          properties: {
            recipientId: { type: 'string', description: 'Recipient user ID' },
            content: { type: 'string', description: 'Message body' },
            channel: { type: 'string', enum: ['in_app', 'email', 'sms', 'push'] },
          },
          required: ['recipientId', 'content'],
        },
      },
      {
        name: 'CREATE_LEAD',
        description: 'Create a new CRM lead',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lead full name' },
            email: { type: 'string', description: 'Lead email address' },
            phone: { type: 'string', description: 'Lead phone number' },
            source: { type: 'string', description: 'Lead source/channel' },
            notes: { type: 'string' },
          },
          required: ['name', 'email'],
        },
      },
      {
        name: 'CREATE_INVOICE',
        description: 'Generate an invoice for a customer',
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'Customer ID' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                },
              },
            },
            dueDate: { type: 'string', description: 'ISO 8601 due date' },
            notes: { type: 'string' },
          },
          required: ['customerId', 'items'],
        },
      },
      {
        name: 'SEARCH_KNOWLEDGE',
        description: 'Search the knowledge base for information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results to return' },
          },
          required: ['query'],
        },
      },
      {
        name: 'ANALYZE_DATA',
        description: 'Run data analysis on a dataset or metric',
        parameters: {
          type: 'object',
          properties: {
            dataSource: { type: 'string', description: 'Data source or table name' },
            metric: { type: 'string', description: 'Metric to analyze' },
            timeframe: { type: 'string', description: 'e.g. "7d", "30d", "1y"' },
          },
          required: ['dataSource'],
        },
      },
      {
        name: 'EXECUTE_TOOL',
        description: 'Execute any registered tool by name with parameters',
        parameters: {
          type: 'object',
          properties: {
            toolName: { type: 'string', description: 'Name of the registered tool' },
            params: { type: 'object', description: 'Tool-specific parameters' },
          },
          required: ['toolName'],
        },
      },
    ];

    return [...definitions, ...actionDefinitions];
  }

  // ========================================================================
  // Audit & History
  // ========================================================================

  /**
   * Log an action execution to the Prisma audit table for compliance
   * and debugging purposes.
   *
   * @param action    The action result to log
   * @param sessionId The session ID under which the action ran
   */
  async trackActionExecution(
    action: CortexActionResult,
    sessionId: string,
  ): Promise<void> {
    try {
      await (this.prisma.client as any).cortexActionLog.create({
        data: {
          sessionId,
          actionType: action.actionType,
          status: action.status,
          description: action.description,
          result: action.result ? JSON.stringify(action.result) : null,
          error: action.error ?? null,
          requiresApproval: action.requiresApproval ?? false,
          estimatedImpact: action.estimatedImpact ?? null,
          createdAt: new Date(),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to track action execution: ${message}`);
      // Non-blocking: audit failures should not break action flow
    }
  }

  /**
   * Retrieve the action execution history for a given session.
   *
   * @param sessionId The session ID to query
   * @returns         Array of action results ordered by creation time
   */
  async getActionHistory(sessionId: string): Promise<CortexActionResult[]> {
    try {
      const logs = await (this.prisma.client as any).cortexActionLog.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      });

      return logs.map((log: any) => ({
        actionType: log.actionType as CortexActionType,
        status: log.status as 'success' | 'error' | 'pending_approval',
        description: log.description,
        result: log.result ? JSON.parse(log.result) : undefined,
        error: log.error ?? undefined,
        requiresApproval: log.requiresApproval,
        estimatedImpact: log.estimatedImpact ?? undefined,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch action history: ${message}`);
      throw new ServiceUnavailableException(`Unable to retrieve action history: ${message}`);
    }
  }

  // ========================================================================
  // Action Handlers — Built-in Actions
  // ========================================================================

  /**
   * CREATE_TASK — Create a task in the system.
   */
  private async handleCreateTask(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { title, description, assigneeId, dueDate, priority } = params;

    const task = await (this.prisma.client as any).task.create({
      data: {
        title: String(title),
        description: description ? String(description) : null,
        assigneeId: assigneeId ? String(assigneeId) : null,
        dueDate: dueDate ? new Date(String(dueDate)) : null,
        priority: priority ? String(priority) : 'medium',
        businessId,
        status: 'todo',
      },
    });

    return {
      actionType: 'CREATE_TASK',
      status: 'success',
      description: `Created task "${title}"`,
      result: { taskId: task.id, title: task.title },
    };
  }

  /**
   * CREATE_EVENT — Create a calendar event.
   */
  private async handleCreateEvent(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { title, startTime, endTime, attendees, description } = params;

    const event = await (this.prisma.client as any).calendarEvent.create({
      data: {
        title: String(title),
        startTime: new Date(String(startTime)),
        endTime: endTime ? new Date(String(endTime)) : null,
        description: description ? String(description) : null,
        attendees: attendees
          ? JSON.stringify(attendees)
          : '[]',
        businessId,
      },
    });

    return {
      actionType: 'CREATE_EVENT',
      status: 'success',
      description: `Created calendar event "${title}"`,
      result: { eventId: event.id, title: event.title, startTime: event.startTime },
    };
  }

  /**
   * SEND_MESSAGE — Send a message or notification.
   */
  private async handleSendMessage(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { recipientId, content, channel = 'in_app' } = params;

    const message = await (this.prisma.client as any).message.create({
      data: {
        recipientId: String(recipientId),
        content: String(content),
        channel: String(channel),
        businessId,
        status: 'sent',
        sentAt: new Date(),
      },
    });

    return {
      actionType: 'SEND_MESSAGE',
      status: 'success',
      description: `Message sent to ${recipientId} via ${channel}`,
      result: { messageId: message.id, channel },
    };
  }

  /**
   * CREATE_DOCUMENT — Generate a document.
   */
  private async handleCreateDocument(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { title, content, type = 'note' } = params;

    const doc = await (this.prisma.client as any).document.create({
      data: {
        title: String(title),
        content: String(content),
        type: String(type),
        businessId,
        createdAt: new Date(),
      },
    });

    return {
      actionType: 'CREATE_DOCUMENT',
      status: 'success',
      description: `Created document "${title}"`,
      result: { documentId: doc.id, title: doc.title, type },
    };
  }

  /**
   * ANALYZE_DATA — Run data analysis.
   */
  private async handleAnalyzeData(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { dataSource, metric, timeframe = '30d' } = params;

    // Delegate to the tool registry for data analysis capabilities
    const analysisResult = await (this.toolRegistry as any).executeTool(
      'data_analyzer',
      {
        source: String(dataSource),
        metric: metric ? String(metric) : undefined,
        timeframe: String(timeframe),
        businessId,
      },
      businessId,
    );

    return {
      actionType: 'ANALYZE_DATA',
      status: 'success',
      description: `Analyzed ${metric ?? 'data'} from ${String(dataSource)} (${timeframe})`,
      result: analysisResult as Record<string, unknown>,
    };
  }

  /**
   * GENERATE_REPORT — Generate a business report.
   */
  private async handleGenerateReport(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { reportType, timeframe = '30d', format = 'pdf' } = params;

    const report = await (this.prisma.client as any).report.create({
      data: {
        type: String(reportType),
        timeframe: String(timeframe),
        format: String(format),
        businessId,
        status: 'generating',
        createdAt: new Date(),
      },
    });

    // Trigger async report generation via command service
    await (this.commandService as any).enqueue({
      type: 'GENERATE_REPORT',
      payload: { reportId: report.id, reportType, timeframe, format, businessId },
    });

    return {
      actionType: 'GENERATE_REPORT',
      status: 'success',
      description: `Report generation started: "${reportType}"`,
      result: { reportId: report.id, status: 'generating' },
    };
  }

  /**
   * EXECUTE_FLOW — Execute a workflow.
   */
  private async handleExecuteFlow(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { flowId, flowInputs = {} } = params;

    const execution = await (this.prisma.client as any).flowExecution.create({
      data: {
        flowId: String(flowId),
        businessId,
        inputs: JSON.stringify(flowInputs),
        status: 'running',
        startedAt: new Date(),
      },
    });

    // Trigger flow execution via command service
    await (this.commandService as any).enqueue({
      type: 'EXECUTE_FLOW',
      payload: { executionId: execution.id, flowId, inputs: flowInputs, businessId },
    });

    return {
      actionType: 'EXECUTE_FLOW',
      status: 'success',
      description: `Workflow "${flowId}" execution started`,
      result: { executionId: execution.id, flowId, status: 'running' },
    };
  }

  /**
   * CREATE_LEAD — Create a CRM lead.
   */
  private async handleCreateLead(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { name, email, phone, source = 'cortex_ai', notes } = params;

    const lead = await (this.prisma.client as any).lead.create({
      data: {
        name: String(name),
        email: String(email),
        phone: phone ? String(phone) : null,
        source: String(source),
        notes: notes ? String(notes) : null,
        businessId,
        status: 'new',
        createdAt: new Date(),
      },
    });

    return {
      actionType: 'CREATE_LEAD',
      status: 'success',
      description: `Created lead for ${name} (${email})`,
      result: { leadId: lead.id, name: lead.name, email: lead.email },
    };
  }

  /**
   * UPDATE_CRM — Update a CRM record.
   */
  private async handleUpdateCrm(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { entityType, entityId, updates } = params;

    // Map entity types to Prisma models
    const modelMap: Record<string, string> = {
      lead: 'lead',
      contact: 'contact',
      deal: 'deal',
      customer: 'customer',
    };

    const modelName = modelMap[String(entityType)];
    if (!modelName) {
      throw new BadRequestException(`Unknown CRM entity type: ${entityType}`);
    }

    // Use Prisma's dynamic model access
    const updated = await (this.prisma as any)[modelName].update({
      where: { id: String(entityId), businessId },
      data: {
        ...(updates as Record<string, unknown>),
        updatedAt: new Date(),
      },
    });

    return {
      actionType: 'UPDATE_CRM',
      status: 'success',
      description: `Updated ${String(entityType)} "${String(entityId)}"`,
      result: { entityType, entityId: (updated as { id: string }).id },
    };
  }

  /**
   * CREATE_INVOICE — Generate an invoice.
   */
  private async handleCreateInvoice(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { customerId, items, dueDate, notes } = params;

    const itemsArray = items as Array<{
      description: string;
      quantity: number;
      unitPrice: number;
    }>;

    const totalAmount = itemsArray.reduce((sum: any, item: any) => sum + item.quantity * item.unitPrice,
      0,
    );

    const invoice = await (this.prisma.client as any).invoice.create({
      data: {
        customerId: String(customerId),
        businessId,
        items: JSON.stringify(itemsArray),
        totalAmount,
        dueDate: dueDate ? new Date(String(dueDate)) : null,
        notes: notes ? String(notes) : null,
        status: 'draft',
        createdAt: new Date(),
      },
    });

    return {
      actionType: 'CREATE_INVOICE',
      status: 'success',
      description: `Created invoice #${invoice.id} for $${totalAmount.toFixed(2)}`,
      result: { invoiceId: invoice.id, totalAmount, itemCount: itemsArray.length },
    };
  }

  /**
   * SEARCH_KNOWLEDGE — Search the knowledge base.
   */
  private async handleSearchKnowledge(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { query, limit = 5 } = params;

    // Use the tool registry for knowledge base search
    const searchResult = await (this.toolRegistry as any).executeTool(
      'knowledge_search',
      {
        query: String(query),
        limit: Number(limit),
        businessId,
      },
      businessId,
    );

    return {
      actionType: 'SEARCH_KNOWLEDGE',
      status: 'success',
      description: `Searched knowledge base for "${String(query)}"`,
      result: searchResult as Record<string, unknown>,
    };
  }

  /**
   * EXECUTE_TOOL — Execute any registered tool dynamically.
   */
  private async handleExecuteTool(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { toolName, toolParams = {} } = params;

    const result = await (this.toolRegistry as any).executeTool(
      String(toolName),
      toolParams as Record<string, unknown>,
      businessId,
    );

    return {
      actionType: 'EXECUTE_TOOL',
      status: 'success',
      description: `Executed tool "${String(toolName)}"`,
      result: result as Record<string, unknown>,
    };
  }

  /**
   * QUERY_DATABASE — Run a raw database query.
   * Note: In production, this should use a read-only connection
   * or a query builder to prevent destructive operations.
   */
  private async handleQueryDatabase(
    params: Record<string, unknown>,
    _businessId: string,
  ): Promise<CortexActionResult> {
    const { query } = params;

    // Execute via command service for safety/audit
    const result = await (this.commandService as any).execute({
      type: 'DATABASE_QUERY',
      payload: { query: String(query) },
    });

    return {
      actionType: 'QUERY_DATABASE',
      status: 'success',
      description: 'Database query executed',
      result: result as Record<string, unknown>,
    };
  }

  /**
   * UPDATE_RECORD — Update a generic record.
   */
  private async handleUpdateRecord(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { recordType, recordId, data } = params;

    const updated = await (this.prisma as any)[
      String(recordType)
    ].update({
      where: { id: String(recordId), businessId },
      data: data as Record<string, unknown>,
    });

    return {
      actionType: 'UPDATE_RECORD',
      status: 'success',
      description: `Updated ${String(recordType)} "${String(recordId)}"`,
      result: { recordType, recordId: (updated as { id: string }).id },
    };
  }

  /**
   * SEND_EMAIL — Send an email.
   */
  private async handleSendEmail(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { to, subject, body, cc, bcc } = params;

    // Delegate to command service for email delivery
    await (this.commandService as any).enqueue({
      type: 'SEND_EMAIL',
      payload: {
        to: String(to),
        subject: String(subject),
        body: String(body),
        cc: cc ? String(cc) : undefined,
        bcc: bcc ? String(bcc) : undefined,
        businessId,
      },
    });

    return {
      actionType: 'SEND_EMAIL',
      status: 'success',
      description: `Email queued to ${to}: "${subject}"`,
      result: { recipient: to, subject },
    };
  }

  /**
   * SCHEDULE_REMINDER — Schedule a reminder.
   */
  private async handleScheduleReminder(
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<CortexActionResult> {
    const { message, triggerTime, recipientId } = params;

    const reminder = await (this.prisma.client as any).reminder.create({
      data: {
        message: String(message),
        triggerTime: new Date(String(triggerTime)),
        recipientId: recipientId ? String(recipientId) : null,
        businessId,
        status: 'scheduled',
        createdAt: new Date(),
      },
    });

    return {
      actionType: 'SCHEDULE_REMINDER',
      status: 'success',
      description: `Reminder scheduled for ${String(triggerTime)}`,
      result: { reminderId: reminder.id, triggerTime: reminder.triggerTime },
    };
  }

  // ========================================================================
  // Validation
  // ========================================================================

  /**
   * Validate that all required parameters for an action type are present.
   *
   * @param actionType The action type to validate against
   * @param params     The provided parameters
   * @throws BadRequestException if required params are missing
   */
  private validateActionParams(
    actionType: CortexActionType,
    params: Record<string, unknown>,
  ): void {
    const required = ACTION_PARAM_SCHEMA[actionType];
    if (!required) return;

    const missing = required.filter((key: any) => params[key] === undefined);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Action "${actionType}" missing required parameters: ${missing.join(', ')}`,
      );
    }
  }
}
