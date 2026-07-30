/**
 * KeyCortexActionsService — Legacy action execution facade.
 *
 * This service now delegates all execution to the canonical
 * KeyCortexToolRegistry. It exists to preserve the existing
 * CortexActionType API and approval flow while the body migrates
 * to the unified tool registry.
 *
 * Long-term: callers should use KeyCortexToolRegistryService directly.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  OnModuleInit,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyToolRegistryService } from '../ai/key-tool-registry.service';
import { KeyCommandService } from '../ai/key-command.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { AutonomyOrchestratorService } from '../key-autonomy/autonomy-orchestrator.service';
import { AutonomyLevelService } from '../key-autonomy/autonomy-level.service';
import { KeyCortexSafeDatabaseService } from './key-cortex-safe-database.service';
import {
  KeyCortexEventBusService,
  KeyCortexEvent,
} from './key-cortex-event-bus.service';
import {
  KeyCortexToolContext,
  KeyCortexToolDefinition,
  KeyCortexToolRegistryService,
  KeyCortexToolResult,
} from './key-cortex-tool-registry.service';
import {
  CortexActionResult,
  CortexActionType,
  CortexSession,
  GatewayToolDefinition,
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

@Injectable()
export class KeyCortexActionsService implements OnModuleInit {
  private readonly logger = new Logger(KeyCortexActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(KeyToolRegistryService)
    private readonly toolRegistry: KeyToolRegistryService | undefined,
    private readonly commandService: KeyCommandService,
    private readonly keyCortexToolRegistry: KeyCortexToolRegistryService,
    @Optional()
    @Inject(KeyActionProposalService)
    private readonly proposalService?: KeyActionProposalService,
    @Optional()
    @Inject(AutonomyOrchestratorService)
    private readonly autonomyOrchestrator?: AutonomyOrchestratorService,
    @Optional()
    @Inject(AutonomyLevelService)
    private readonly autonomyLevelService?: AutonomyLevelService,
    private readonly eventBus?: KeyCortexEventBusService,
    @Optional()
    @Inject(KeyCortexSafeDatabaseService)
    private readonly safeDatabase?: KeyCortexSafeDatabaseService,
  ) {}

  onModuleInit(): void {
    this.registerLegacyTools();
  }

  // ========================================================================
  // Legacy tool registration (migrated to canonical registry)
  // ========================================================================

  private registerLegacyTools(): void {
    const definitions: KeyCortexToolDefinition[] = [
      this.makeTool('cortex.create_task', 'workflow', 'Create a task or to-do item', 1, false, ['title'], { description: { type: 'string' }, assigneeId: { type: 'string' }, dueDate: { type: 'string' }, priority: { type: 'string' } }, this.handleCreateTask.bind(this)),
      this.makeTool('cortex.create_event', 'calendar', 'Create a calendar event', 1, false, ['title', 'startTime'], { endTime: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } }, this.handleCreateEvent.bind(this)),
      this.makeTool('cortex.send_message', 'communication', 'Send a message or notification', 2, true, ['recipientId', 'content'], { channel: { type: 'string', enum: ['in_app', 'email', 'sms', 'push'] } }, this.handleSendMessage.bind(this)),
      this.makeTool('cortex.create_document', 'document', 'Create a document', 1, false, ['title', 'content'], { type: { type: 'string' } }, this.handleCreateDocument.bind(this)),
      this.makeTool('cortex.analyze_data', 'data', 'Run data analysis', 1, false, ['dataSource'], { metric: { type: 'string' }, timeframe: { type: 'string' } }, this.handleAnalyzeData.bind(this)),
      this.makeTool('cortex.generate_report', 'data', 'Generate a business report', 1, false, ['reportType'], { timeframe: { type: 'string' }, format: { type: 'string' } }, this.handleGenerateReport.bind(this)),
      this.makeTool('cortex.execute_flow', 'workflow', 'Execute a workflow or automation', 3, true, ['flowId'], { flowInputs: { type: 'object' } }, this.handleExecuteFlow.bind(this)),
      this.makeTool('cortex.create_lead', 'crm', 'Create a new CRM lead', 2, true, ['name', 'email'], { phone: { type: 'string' }, source: { type: 'string' }, notes: { type: 'string' } }, this.handleCreateLead.bind(this)),
      this.makeTool('cortex.update_crm', 'crm', 'Update a CRM record', 2, true, ['entityType', 'entityId'], { updates: { type: 'object' } }, this.handleUpdateCrm.bind(this)),
      this.makeTool('cortex.create_invoice', 'finance', 'Generate an invoice for a customer', 3, true, ['customerId', 'items'], { dueDate: { type: 'string' }, notes: { type: 'string' } }, this.handleCreateInvoice.bind(this)),
      this.makeTool('cortex.send_email', 'communication', 'Send an email', 3, true, ['to', 'subject', 'body'], { cc: { type: 'string' }, bcc: { type: 'string' } }, this.handleSendEmail.bind(this)),
      this.makeTool('cortex.search_knowledge', 'ai', 'Search the knowledge base', 1, false, ['query'], { limit: { type: 'number' } }, this.handleSearchKnowledge.bind(this)),
      this.makeTool('cortex.execute_tool', 'ai', 'Execute any registered tool by name', 2, true, ['toolName'], { toolParams: { type: 'object' } }, this.handleExecuteTool.bind(this)),
      this.makeTool('cortex.query_database', 'data', 'Run a raw database query', 4, true, ['query'], {}, this.handleQueryDatabase.bind(this)),
      this.makeTool('cortex.update_record', 'data', 'Update any record', 3, true, ['recordType', 'recordId'], { data: { type: 'object' } }, this.handleUpdateRecord.bind(this)),
      this.makeTool('cortex.schedule_reminder', 'calendar', 'Schedule a reminder', 1, false, ['message', 'triggerTime'], { recipientId: { type: 'string' } }, this.handleScheduleReminder.bind(this)),
    ];

    this.keyCortexToolRegistry.registerMany(definitions);
    this.logger.log(`[KeyCortexActionsService] Registered ${definitions.length} legacy tools into canonical registry`);
  }

  private makeTool(
    name: string,
    module: string,
    description: string,
    riskTier: 1 | 2 | 3 | 4,
    requiresApproval: boolean,
    required: string[],
    properties: Record<string, unknown>,
    legacyHandler: (params: Record<string, unknown>, businessId: string) => Promise<KeyCortexToolResult>,
  ): KeyCortexToolDefinition {
    return {
      name,
      module,
      description,
      riskTier,
      requiresApproval,
      parameters: { type: 'object', properties, required },
      handler: async (ctx, input) => legacyHandler(input, ctx.businessId),
    };
  }

  // ========================================================================
  // Batch & Single Action Execution
  // ========================================================================

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
        const verdict = await this.evaluateAutonomy(action, session);
        if (!verdict.allowed) {
          results.push({
            ...action,
            status: 'blocked',
            description: verdict.reason || `Action "${action.actionType}" blocked by autonomy guard.`,
            requiresApproval: false,
            error: verdict.reason,
          });
          continue;
        }

        if (verdict.requiresApproval) {
          const approval = await this.requestApproval(action, session);
          if (!approval.approved) {
            results.push({
              ...action,
              status: 'pending_approval',
              description: `Action "${action.actionType}" awaiting user approval.`,
              requiresApproval: true,
              estimatedImpact: action.estimatedImpact ?? 'High-impact business action',
              approvalRequestId: approval.approvalRequestId,
            });
            continue;
          }
        }

        const result = await this.executeAction(action, session.businessId, session.userId, session.id);
        results.push(result);
        await this.trackActionExecution(result, session.id);
        this.emitActionEvent(action.actionType, result, session);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Action "${action.actionType}" failed: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        const failedResult: CortexActionResult = {
          ...action,
          status: 'error',
          description: `Failed to execute ${action.actionType}`,
          error: message,
        };
        results.push(failedResult);
        await this.trackActionExecution(failedResult, session.id);
      }
    }

    this.logger.log(
      `Batch execution complete: ${results.filter((r: any) => r.status === 'success').length}/${results.length} succeeded`,
    );
    return results;
  }

  async executeAction(
    action: CortexActionResult,
    businessId: string,
    userId?: string,
    sessionId?: string,
  ): Promise<CortexActionResult> {
    const { actionType, result: params = {} } = action;
    this.logger.debug(`Executing action "${actionType}" for business ${businessId}`);
    this.validateActionParams(actionType, params);

    const toolName = this.actionTypeToToolName(actionType);
    const autonomyLevel = await this.resolveAutonomyLevel(businessId);
    const ctx: KeyCortexToolContext = {
      businessId,
      userId,
      sessionId,
      autonomyLevel,
    };

    const toolResult = await this.keyCortexToolRegistry.execute(toolName, ctx, params as Record<string, unknown>);

    return {
      actionType,
      status: toolResult.success ? 'success' : 'error',
      description: toolResult.success
        ? `Executed ${actionType}`
        : `Failed to execute ${actionType}: ${toolResult.error}`,
      result: toolResult.success ? (toolResult.data as Record<string, unknown> ?? {}) : undefined,
      error: toolResult.success ? undefined : toolResult.error,
    };
  }

  private actionTypeToToolName(actionType: CortexActionType): string {
    return `cortex.${actionType.toLowerCase()}`;
  }

  private async resolveAutonomyLevel(businessId: string): Promise<number> {
    if (this.autonomyLevelService) {
      try {
        const level = await this.autonomyLevelService.resolve(businessId);
        return level.level;
      } catch (err) {
        this.logger.warn(`resolveAutonomyLevel failed: ${(err as Error).message}`);
      }
    }
    return 0;
  }

  // ========================================================================
  // Autonomy + Approval Gate
  // ========================================================================

  private async evaluateAutonomy(
    action: CortexActionResult,
    session?: CortexSession,
  ): Promise<{ allowed: boolean; requiresApproval: boolean; reason?: string }> {
    if (!this.autonomyOrchestrator) {
      // Legacy static fallback
      return {
        allowed: true,
        requiresApproval: HIGH_IMPACT_ACTIONS.includes(action.actionType),
      };
    }

    try {
      const verdict = await this.autonomyOrchestrator.evaluateAction(
        session?.businessId ?? 'unknown',
        `key_cortex.${action.actionType}`,
        (action.result as Record<string, unknown>) ?? {},
        { proposedBy: session?.userId },
      );
      return {
        allowed: verdict.allowed,
        requiresApproval: verdict.requiresApproval || verdict.tier === 'manual',
        reason: verdict.reason,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[evaluateAutonomy] ${action.actionType}: ${message}`);
      return { allowed: false, requiresApproval: true, reason: `Autonomy evaluation failed: ${message}` };
    }
  }

  requiresApproval(action: CortexActionResult): boolean {
    // Static legacy fallback; callers should prefer evaluateAutonomy when a session is available.
    return HIGH_IMPACT_ACTIONS.includes(action.actionType);
  }

  async requestApproval(
    action: CortexActionResult,
    session?: CortexSession,
  ): Promise<{ approved: boolean; approvalRequestId?: string }> {
    this.logger.warn(
      `Approval required for "${action.actionType}" — ` +
        `Impact: ${action.estimatedImpact ?? 'unknown'}`,
    );

    const businessId = session?.businessId ?? 'unknown';

    try {
      const request = this.proposalService
        ? await this.proposalService.create(
            businessId,
            {
              sourceType: 'KEY_CORTEX',
              sourceMode: 'key_cortex',
              title: action.description || `Execute ${action.actionType}`,
              summary: `High-impact action requires approval: ${action.estimatedImpact ?? 'unknown impact'}`,
              actionType: 'EXECUTE_TOOL',
              payload: {
                toolName: this.actionTypeToToolName(action.actionType),
                originalActionType: action.actionType,
                parameters: (action.result as Record<string, unknown>) ?? {},
                estimatedImpact: action.estimatedImpact ?? 'unknown',
                sessionId: session?.id,
              },
            },
            session?.userId,
          )
        : null;

      if (!request) {
        this.logger.error('[requestApproval] No approval or proposal service available');
        return { approved: false };
      }

      this.logger.log(
        `[requestApproval] Created proposal ${request.id} for ${action.actionType}`,
      );

      return { approved: false, approvalRequestId: request.id };
    } catch (err: any) {
      this.logger.error(
        `[requestApproval] Failed to persist approval proposal: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { approved: false };
    }
  }

  async getPendingApprovals(businessId: string): Promise<any[]> {
    if (this.proposalService) {
      return this.proposalService.list(businessId, { status: 'PENDING' });
    }
    return [];
  }

  // ========================================================================
  // Tool Registry Integration (legacy API preserved)
  // ========================================================================

  async getAvailableTools(
    businessId: string,
  ): Promise<Array<{ name: string; description: string; params: object }>> {
    this.logger.debug(`Fetching available tools for business ${businessId}`);
    try {
      const tools = this.keyCortexToolRegistry.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        params: tool.parameters.properties,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch tools: ${message}`);
      throw new ServiceUnavailableException(`Tool registry unavailable: ${message}`);
    }
  }

  async buildToolDefinitions(
    _businessId: string,
  ): Promise<GatewayToolDefinition[]> {
    return this.keyCortexToolRegistry.buildGatewayDefinitions();
  }

  // ========================================================================
  // Audit & History
  // ========================================================================

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
    }
  }

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
  // Action Handlers — migrated to canonical registry closures
  // ========================================================================

  private async handleCreateTask(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    return { success: true, data: { taskId: task.id, title: task.title } };
  }

  private async handleCreateEvent(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { title, startTime, endTime, attendees, description } = params;
    const event = await (this.prisma.client as any).calendarEvent.create({
      data: {
        title: String(title),
        startTime: new Date(String(startTime)),
        endTime: endTime ? new Date(String(endTime)) : null,
        description: description ? String(description) : null,
        attendees: attendees ? JSON.stringify(attendees) : '[]',
        businessId,
      },
    });
    return { success: true, data: { eventId: event.id, title: event.title, startTime: event.startTime } };
  }

  private async handleSendMessage(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    return { success: true, data: { messageId: message.id, channel } };
  }

  private async handleCreateDocument(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    return { success: true, data: { documentId: doc.id, title: doc.title, type } };
  }

  private async handleAnalyzeData(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { dataSource, metric, timeframe = '30d' } = params;
    // Phase 3 Skeleton: old AI-module registry removed; use safe database wrapper for known sources.
    const sourceMap: Record<string, string> = {
      invoices: 'Invoice',
      deals: 'Deal',
      contacts: 'Contact',
      bookings: 'Booking',
      tasks: 'ProjectTask',
    };
    const model = sourceMap[String(dataSource).toLowerCase()];
    if (!model || !this.safeDatabase) {
      return { success: false, error: `Analysis not available for data source "${dataSource}"` };
    }
    const result = await this.safeDatabase.safeQuery(
      { businessId, autonomyLevel: 2 },
      { model, take: 100 },
    );
    if (!result.success) return result;
    return {
      success: true,
      data: {
        source: dataSource,
        metric,
        timeframe,
        rowCount: (result.data as any)?.count ?? 0,
        sample: (result.data as any)?.rows?.slice(0, 5) ?? [],
      },
    };
  }

  private async handleGenerateReport(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    await (this.commandService as any).enqueue({
      type: 'GENERATE_REPORT',
      payload: { reportId: report.id, reportType, timeframe, format, businessId },
    });
    return { success: true, data: { reportId: report.id, status: 'generating' } };
  }

  private async handleExecuteFlow(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    await (this.commandService as any).enqueue({
      type: 'EXECUTE_FLOW',
      payload: { executionId: execution.id, flowId, inputs: flowInputs, businessId },
    });
    return { success: true, data: { executionId: execution.id, flowId, status: 'running' } };
  }

  private async handleCreateLead(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    return { success: true, data: { leadId: lead.id, name: lead.name, email: lead.email } };
  }

  private async handleUpdateCrm(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { entityType, entityId, updates } = params;
    const modelMap: Record<string, string> = {
      lead: 'lead',
      contact: 'contact',
      deal: 'deal',
      customer: 'customer',
    };
    const modelName = modelMap[String(entityType)];
    if (!modelName) {
      return { success: false, error: `Unknown CRM entity type: ${entityType}` };
    }
    const updated = await (this.prisma as any)[modelName].update({
      where: { id: String(entityId), businessId },
      data: { ...(updates as Record<string, unknown>), updatedAt: new Date() },
    });
    return { success: true, data: { entityType, entityId: (updated as { id: string }).id } };
  }

  private async handleCreateInvoice(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { customerId, items, dueDate, notes } = params;
    const itemsArray = items as Array<{ description: string; quantity: number; unitPrice: number }>;
    const totalAmount = itemsArray.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
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
    return { success: true, data: { invoiceId: invoice.id, totalAmount, itemCount: itemsArray.length } };
  }

  private async handleSearchKnowledge(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { query, limit = 5 } = params;
    // Phase 3 Skeleton: old AI-module registry removed; search KnowledgeSource directly.
    try {
      const sources = await (this.prisma.client as any).knowledgeSource.findMany({
        where: {
          businessId,
          OR: [
            { title: { contains: String(query), mode: 'insensitive' } },
            { content: { contains: String(query), mode: 'insensitive' } },
          ],
        },
        take: Math.min(Number(limit), 25),
        orderBy: { createdAt: 'desc' },
      });
      return {
        success: true,
        data: {
          query,
          count: sources.length,
          results: sources.map((s: any) => ({ id: s.id, title: s.title, sourceType: s.sourceType })),
        },
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async handleExecuteTool(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { toolName, toolParams = {} } = params;
    // Phase 3 Skeleton: delegate to canonical registry instead of old AI-module registry.
    return this.keyCortexToolRegistry.execute(String(toolName), { businessId, autonomyLevel: 2 }, toolParams as Record<string, unknown>);
  }

  private async handleQueryDatabase(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { query } = params;
    if (!this.safeDatabase) {
      return {
        success: false,
        error: `Raw database queries are disabled. Requested: "${String(query)}".`,
      };
    }
    // Phase 3 Skeleton: route through safe database wrapper with model allow-list.
    const model = String(query).charAt(0).toUpperCase() + String(query).slice(1);
    return this.safeDatabase.safeQuery(
      { businessId, autonomyLevel: 2 },
      { model, take: 25 },
    );
  }

  private async handleUpdateRecord(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { recordType, recordId, data } = params;
    if (this.safeDatabase) {
      // Phase 3 Skeleton: route through safe database wrapper.
      return this.safeDatabase.safeUpdate(
        { businessId, autonomyLevel: 2 },
        { model: String(recordType), id: String(recordId), data: data as Record<string, unknown> },
      );
    }
    const updated = await (this.prisma as any)[String(recordType)].update({
      where: { id: String(recordId), businessId },
      data: data as Record<string, unknown>,
    });
    return { success: true, data: { recordType, recordId: (updated as { id: string }).id } };
  }

  private async handleSendEmail(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
    const { to, subject, body, cc, bcc } = params;
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
    return { success: true, data: { recipient: to, subject } };
  }

  private async handleScheduleReminder(params: Record<string, unknown>, businessId: string): Promise<KeyCortexToolResult> {
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
    return { success: true, data: { reminderId: reminder.id, triggerTime: reminder.triggerTime } };
  }

  // ========================================================================
  // Event emission
  // ========================================================================

  private emitActionEvent(
    actionType: CortexActionType,
    result: CortexActionResult,
    session: CortexSession,
  ): void {
    if (!this.eventBus) return;
    this.eventBus.emit({
      source: 'key_cortex',
      type: `action.${result.status}`,
      businessId: session.businessId,
      userId: session.userId,
      payload: {
        actionType,
        status: result.status,
        description: result.description,
        result: result.result,
        error: result.error,
        sessionId: session.id,
      },
      metadata: {
        sessionId: session.id,
        correlationId: session.id,
        importance: result.status === 'error' ? 'high' : 'normal',
      },
    });
  }

  // ========================================================================
  // Validation
  // ========================================================================

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
