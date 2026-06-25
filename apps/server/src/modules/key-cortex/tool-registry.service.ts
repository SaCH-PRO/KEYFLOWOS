/**
 * KEY Tool Registry Service — Phase 18E
 * Universal tool capability registry.
 * Every tool declares: capabilities, Genome readiness, risk, approval, audit.
 * No tool bypasses Genome judgment.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ToolDeclaration,
  ToolCategory,
} from './cortex-genome-contracts';

// ─────────────────────────────────────────────────────────────
// The 16 declared tools (all existing Cortex actions)
// ─────────────────────────────────────────────────────────────

const DECLARED_TOOLS: ToolDeclaration[] = [
  {
    id: 'task.create', name: 'Create Task', category: 'workflow',
    description: 'Create a task or to-do item in the system',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: true, rollbackSupported: true,
    executorRef: 'KeyCortexActionsService.handleCreateTask',
    parameters: { title: 'string', description: 'string?', assigneeId: 'string?', dueDate: 'date?', priority: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['task_completed'] },
  },
  {
    id: 'event.create', name: 'Create Event', category: 'calendar',
    description: 'Create a calendar event',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: true, rollbackSupported: true,
    executorRef: 'KeyCortexActionsService.handleCreateEvent',
    parameters: { title: 'string', startTime: 'datetime', endTime: 'datetime?', attendees: 'string[]?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['event_attended'] },
  },
  {
    id: 'message.send', name: 'Send Message', category: 'communication',
    description: 'Send a message or notification',
    genomeRequirements: { minStage: 'growth', minReadiness: 30, requiredDna: { operations: 40 } },
    riskLevel: 'medium', requiresApproval: true, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleSendMessage',
    parameters: { recipientId: 'string', content: 'string', channel: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['message_delivered'] },
  },
  {
    id: 'lead.create', name: 'Create Lead', category: 'crm',
    description: 'Create a new CRM lead',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: true, rollbackSupported: true,
    executorRef: 'KeyCortexActionsService.handleCreateLead',
    parameters: { name: 'string', email: 'string', phone: 'string?', source: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['lead_converted'] },
  },
  {
    id: 'invoice.create', name: 'Create Invoice', category: 'finance',
    description: 'Generate an invoice for a customer',
    genomeRequirements: { minStage: 'growth', minReadiness: 50, requiredDna: { finance: 50 } },
    riskLevel: 'high', requiresApproval: true, dryRunSupported: true, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleCreateInvoice',
    parameters: { customerId: 'string', items: 'InvoiceItem[]', dueDate: 'date?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 2555 }, // 7 years
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['invoice_paid', 'revenue_collected'] },
  },
  {
    id: 'email.send', name: 'Send Email', category: 'communication',
    description: 'Send an email to a recipient',
    genomeRequirements: { minStage: 'growth', minReadiness: 40, requiredDna: { marketing: 40 } },
    riskLevel: 'high', requiresApproval: true, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleSendEmail',
    parameters: { to: 'string', subject: 'string', body: 'string', cc: 'string?', bcc: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['email_opened', 'email_replied'] },
  },
  {
    id: 'crm.update', name: 'Update CRM', category: 'crm',
    description: 'Update a CRM record',
    genomeRequirements: { minStage: 'growth', minReadiness: 30, requiredDna: { operations: 40 } },
    riskLevel: 'medium', requiresApproval: true, dryRunSupported: false, rollbackSupported: true,
    executorRef: 'KeyCortexActionsService.handleUpdateCrm',
    parameters: { entityType: 'string', entityId: 'string', updates: 'Record' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['record_updated'] },
  },
  {
    id: 'report.generate', name: 'Generate Report', category: 'data',
    description: 'Generate a business report',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleGenerateReport',
    parameters: { reportType: 'string', timeframe: 'string?', format: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['report_generated'] },
  },
  {
    id: 'flow.execute', name: 'Execute Workflow', category: 'workflow',
    description: 'Execute a workflow or automation',
    genomeRequirements: { minStage: 'growth', minReadiness: 60, requiredDna: { operations: 60 } },
    riskLevel: 'high', requiresApproval: true, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleExecuteFlow',
    parameters: { flowId: 'string', flowInputs: 'Record?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['flow_completed'] },
  },
  {
    id: 'reminder.schedule', name: 'Schedule Reminder', category: 'calendar',
    description: 'Schedule a reminder',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleScheduleReminder',
    parameters: { message: 'string', triggerTime: 'datetime', recipientId: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['reminder_delivered'] },
  },
  {
    id: 'knowledge.search', name: 'Search Knowledge', category: 'ai',
    description: 'Search the knowledge base',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleSearchKnowledge',
    parameters: { query: 'string', limit: 'number?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 30 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: false, successMetrics: ['results_found'] },
  },
  {
    id: 'data.analyze', name: 'Analyze Data', category: 'data',
    description: 'Run data analysis',
    genomeRequirements: { minStage: 'growth', minReadiness: 40, requiredDna: { finance: 30 } },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleAnalyzeData',
    parameters: { dataSource: 'string', metric: 'string?', timeframe: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['analysis_completed'] },
  },
  {
    id: 'tool.execute', name: 'Execute Tool', category: 'ai',
    description: 'Execute any registered tool',
    genomeRequirements: { minStage: 'growth', minReadiness: 50, requiredDna: {} },
    riskLevel: 'medium', requiresApproval: true, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleExecuteTool',
    parameters: { toolName: 'string', toolParams: 'Record?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['tool_executed'] },
  },
  {
    id: 'document.create', name: 'Create Document', category: 'document',
    description: 'Create a document',
    genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
    riskLevel: 'low', requiresApproval: false, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleCreateDocument',
    parameters: { title: 'string', content: 'string', type: 'string?' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['document_created'] },
  },
  {
    id: 'database.query', name: 'Query Database', category: 'data',
    description: 'Run a database query',
    genomeRequirements: { minStage: 'growth', minReadiness: 60, requiredDna: { strategy: 60 } },
    riskLevel: 'medium', requiresApproval: true, dryRunSupported: false, rollbackSupported: false,
    executorRef: 'KeyCortexActionsService.handleQueryDatabase',
    parameters: { query: 'string' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['query_completed'] },
  },
  {
    id: 'record.update', name: 'Update Record', category: 'crm',
    description: 'Update any record',
    genomeRequirements: { minStage: 'growth', minReadiness: 30, requiredDna: { operations: 40 } },
    riskLevel: 'medium', requiresApproval: true, dryRunSupported: false, rollbackSupported: true,
    executorRef: 'KeyCortexActionsService.handleUpdateRecord',
    parameters: { recordType: 'string', recordId: 'string', data: 'Record' },
    auditPayload: { logsInput: true, logsOutput: true, retentionDays: 365 },
    outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['record_updated'] },
  },
];

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools: Map<string, ToolDeclaration> = new Map();

  constructor() {
    // Register all declared tools at boot
    for (const tool of DECLARED_TOOLS) {
      this.tools.set(tool.id, tool);
    }
    this.logger.log(`[registry] ${DECLARED_TOOLS.length} tools registered`);
  }

  // ═══════════════════════════════════════════════════════════
  // Lookup
  // ═══════════════════════════════════════════════════════════

  getTool(id: string): ToolDeclaration | undefined {
    return this.tools.get(id);
  }

  getAllTools(): ToolDeclaration[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: ToolCategory): ToolDeclaration[] {
    return this.getAllTools().filter((t) => t.category === category);
  }

  // ═══════════════════════════════════════════════════════════
  // Genome Readiness Gate
  // ═══════════════════════════════════════════════════════════

  checkReadiness(
    toolId: string,
    genomeStage: string,
    readiness: number,
    dnaScores: Record<string, number>,
  ): { allowed: boolean; reason: string } {
    const tool = this.tools.get(toolId);
    if (!tool) return { allowed: false, reason: `Tool "${toolId}" not found in registry.` };

    const req = tool.genomeRequirements;

    if (readiness < req.minReadiness) {
      return {
        allowed: false,
        reason: `Readiness ${readiness}% below minimum ${req.minReadiness}% for "${tool.name}".`,
      };
    }

    for (const [dim, minScore] of Object.entries(req.requiredDna)) {
      const score = dnaScores[dim] ?? 0;
      if (score < minScore) {
        return {
          allowed: false,
          reason: `DNA dimension "${dim}" score ${score} below minimum ${minScore} for "${tool.name}".`,
        };
      }
    }

    return { allowed: true, reason: `All Genome requirements met for "${tool.name}".` };
  }

  // ═══════════════════════════════════════════════════════════
  // Risk Assessment
  // ═══════════════════════════════════════════════════════════

  getRiskLevel(toolId: string): 'low' | 'medium' | 'high' | 'critical' {
    return this.tools.get(toolId)?.riskLevel ?? 'high';
  }

  requiresApproval(toolId: string): boolean {
    return this.tools.get(toolId)?.requiresApproval ?? true;
  }

  supportsDryRun(toolId: string): boolean {
    return this.tools.get(toolId)?.dryRunSupported ?? false;
  }

  supportsRollback(toolId: string): boolean {
    return this.tools.get(toolId)?.rollbackSupported ?? false;
  }

  // ═══════════════════════════════════════════════════════════
  // Statistics
  // ═══════════════════════════════════════════════════════════

  getStats(): { total: number; byRisk: Record<string, number>; byCategory: Record<string, number> } {
    const all = this.getAllTools();
    const byRisk: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byCategory: Record<string, number> = {};

    for (const tool of all) {
      byRisk[tool.riskLevel] = (byRisk[tool.riskLevel] ?? 0) + 1;
      byCategory[tool.category] = (byCategory[tool.category] ?? 0) + 1;
    }

    return { total: all.length, byRisk, byCategory };
  }
}
