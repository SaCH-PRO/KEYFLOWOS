/**
 * KEY Cortex Action Service
 *
 * The hands of JARVIS. Executes business actions proposed by the reasoning
 * engine — but ONLY after passing the autonomy gate.
 *
 * Every executed action creates a genome memory event, feeding the
 * closed-loop learning system.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { AiExecutionLogService } from '../ai/ai-execution-log.service';
import type {
  CortexActionProposal,
  CortexActionResult,
  CortexApprovalRequest,
  GenomeContextSnapshot,
} from './key-cortex.types';

@Injectable()
export class KeyCortexActionService {
  private readonly logger = new Logger(KeyCortexActionService.name);
  private readonly pendingApprovals = new Map<string, CortexApprovalRequest>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly flowOrchestrator: FlowOrchestratorService,
    private readonly executionLog: AiExecutionLogService,
  ) {}

  /**
   * Execute an action — either directly (if low risk) or queue for approval.
   */
  async execute(
    businessId: string,
    proposal: CortexActionProposal,
    genomeContext: GenomeContextSnapshot,
  ): Promise<CortexActionResult> {
    // Check autonomy gate
    const canAutoExecute = this.canAutoExecute(proposal, genomeContext);

    if (!canAutoExecute) {
      // Queue for approval
      const approvalRequest = this.queueForApproval(businessId, proposal);
      return {
        actionId: proposal.id,
        success: false,
        error: `Action requires approval. Request ID: ${approvalRequest.proposal.id}`,
        executedAt: new Date(),
      };
    }

    // Execute directly
    return this.executeDirect(businessId, proposal);
  }

  /**
   * Approve or reject a pending action.
   */
  async approveAction(requestId: string, approved: boolean, userId?: string): Promise<CortexActionResult> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      return {
        actionId: requestId,
        success: false,
        error: 'Approval request not found or expired',
        executedAt: new Date(),
      };
    }

    if (approved) {
      request.status = 'APPROVED';
      this.pendingApprovals.delete(requestId);
      const result = await this.executeDirect(request.businessId, request.proposal);

      // Log the approval
      await this.executionLog.log({
        businessId: request.businessId,
        action: `cortex_action_approved:${request.proposal.actionType}`,
        mode: 'manual_approved',
        actor: userId ?? 'user',
        success: result.success,
        inputSummary: request.proposal,
        outputSummary: result,
      }).catch(() => {});

      return result;
    } else {
      request.status = 'REJECTED';
      this.pendingApprovals.delete(requestId);

      await this.executionLog.log({
        businessId: request.businessId,
        action: `cortex_action_rejected:${request.proposal.actionType}`,
        mode: 'manual_rejected',
        actor: userId ?? 'user',
        success: false,
        inputSummary: request.proposal,
      }).catch(() => {});

      return {
        actionId: requestId,
        success: false,
        error: 'Action rejected by user',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Get all pending approvals for a business.
   */
  getPendingApprovals(businessId: string): CortexApprovalRequest[] {
    const results: CortexApprovalRequest[] = [];
    for (const req of this.pendingApprovals.values()) {
      if (req.businessId === businessId && req.status === 'PENDING') {
        results.push(req);
      }
    }
    return results;
  }

  /**
   * Check if an action can be auto-executed.
   */
  private canAutoExecute(proposal: CortexActionProposal, ctx: GenomeContextSnapshot): boolean {
    // No auto-execute if autonomy is blocked
    if (!ctx.autonomyGate.automationAllowed) return false;

    // HIGH and CRITICAL risk always need approval
    if (proposal.riskLevel === 'HIGH' || proposal.riskLevel === 'CRITICAL') return false;

    // MEDIUM risk needs approval if automation is sensitive
    if (proposal.riskLevel === 'MEDIUM') return false;

    // LOW risk is safe to auto-execute
    if (proposal.riskLevel === 'LOW') return true;

    // Default: require approval
    return false;
  }

  /**
   * Execute an action directly using the flow orchestrator.
   */
  private async executeDirect(businessId: string, proposal: CortexActionProposal): Promise<CortexActionResult> {
    const startTime = Date.now();

    try {
      let result: Record<string, unknown> = {};

      switch (proposal.actionType) {
        case 'create_booking':
          result = await this.executeCreateBooking(businessId, proposal.payload);
          break;

        case 'send_invoice_reminder':
          result = await this.executeSendInvoiceReminder(businessId, proposal.payload);
          break;

        case 'create_quote':
          result = await this.executeCreateQuote(businessId, proposal.payload);
          break;

        case 'create_recommendation':
          result = await this.executeCreateRecommendation(businessId, proposal.payload);
          break;

        case 'GENERAL':
        default:
          // For now, generic actions are logged but not auto-executed
          // The user gets the proposal and can act on it manually
          result = { status: 'proposed', message: 'Action proposed for manual execution' };
          break;
      }

      // Log execution
      await this.executionLog.log({
        businessId,
        action: `cortex_executed:${proposal.actionType}`,
        mode: 'autonomous',
        actor: 'key_cortex',
        success: true,
        durationMs: Date.now() - startTime,
        inputSummary: proposal,
        outputSummary: result,
      }).catch(() => {});

      // Emit genome memory event for learning
      this.events.emit('cortex.action.executed', {
        businessId,
        actionType: proposal.actionType,
        proposal,
        result,
      });

      return {
        actionId: proposal.id,
        success: true,
        result,
        executedAt: new Date(),
      };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.error(`Action execution failed: ${error}`);

      await this.executionLog.log({
        businessId,
        action: `cortex_failed:${proposal.actionType}`,
        mode: 'autonomous',
        actor: 'key_cortex',
        success: false,
        inputSummary: proposal,
        outputSummary: { error },
      }).catch(() => {});

      return {
        actionId: proposal.id,
        success: false,
        error,
        executedAt: new Date(),
      };
    }
  }

  private queueForApproval(businessId: string, proposal: CortexActionProposal): CortexApprovalRequest {
    const request: CortexApprovalRequest = {
      proposal,
      sessionId: '',
      businessId,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
      status: 'PENDING',
    };

    this.pendingApprovals.set(proposal.id, request);
    this.logger.log(`Action ${proposal.id} queued for approval: ${proposal.title}`);

    return request;
  }

  // ── Specific Action Handlers ──

  private async executeCreateBooking(businessId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Use the flow orchestrator to create a booking
    const result = await this.flowOrchestrator.executeToolDirectly(
      businessId,
      'bookings_create_booking',
      payload,
    );
    return { status: 'completed', tool: 'bookings_create_booking', result };
  }

  private async executeSendInvoiceReminder(businessId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.flowOrchestrator.executeToolDirectly(
      businessId,
      'finance_send_reminder',
      payload,
    );
    return { status: 'completed', tool: 'finance_send_reminder', result };
  }

  private async executeCreateQuote(businessId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.flowOrchestrator.executeToolDirectly(
      businessId,
      'quotes_create_quote',
      payload,
    );
    return { status: 'completed', tool: 'quotes_create_quote', result };
  }

  private async executeCreateRecommendation(businessId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { domain, title, insight, recommendation, expectedGain, riskLevel, effortLevel } = payload;

    await this.prisma.client.genomeRecommendation.create({
      data: {
        businessId,
        domain: String(domain ?? 'general'),
        title: String(title ?? 'Untitled'),
        insight: String(insight ?? ''),
        diagnosis: String(payload.diagnosis ?? ''),
        recommendation: String(recommendation ?? ''),
        expectedGain: expectedGain ? String(expectedGain) : null,
        expectedGainScore: Number(payload.expectedGainScore ?? 50),
        riskLevel: (riskLevel as any) ?? 'MEDIUM',
        effortLevel: (effortLevel as any) ?? 'MEDIUM',
        confidence: Number(payload.confidence ?? 70),
        evidenceIds: [],
        status: 'ACTIVE',
      },
    });

    return { status: 'created', type: 'recommendation' };
  }
}
