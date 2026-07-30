/**
 * KEY Trust Explanation Service — Phase 18F
 * Layer 7: Every recommendation explains itself.
 *
 * Every action produces:
 * - Why it was suggested
 * - Evidence supporting it
 * - Risks involved
 * - Genome facts used
 * - What's missing
 * - What happens if nothing is done
 * - What will be tracked afterward
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  TrustExplanation,
  GenomeEvidenceResponse,
} from './cortex-genome-contracts';
import { CortexActionType, CortexContextSnapshot } from './key-cortex.types';

@Injectable()
export class TrustExplanationService {
  private readonly logger = new Logger(TrustExplanationService.name);

  // ═══════════════════════════════════════════════════════════
  // Generate full trust explanation for an action
  // ═══════════════════════════════════════════════════════════

  async explain(
    actionType: CortexActionType,
    params: Record<string, unknown>,
    context: CortexContextSnapshot,
    evidence: GenomeEvidenceResponse | null,
    allowed: boolean,
    requiresApproval: boolean,
  ): Promise<TrustExplanation> {
    this.logger.debug(`[explain] action=${actionType} allowed=${allowed}`);

    return {
      reasoning: this.buildReasoning(actionType, params, context, allowed),
      evidence: this.buildEvidence(evidence),
      risks: this.assessRisks(actionType, context),
      genomeFacts: this.extractGenomeFacts(context),
      knowledgeGaps: this.identifyGaps(context, evidence),
      inactionConsequence: this.explainInaction(actionType, context),
      trackingPlan: this.defineTracking(actionType),
      rollbackPlan: this.buildRollbackPlan(actionType, requiresApproval),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Reasoning: Why was this suggested?
  // ═══════════════════════════════════════════════════════════

  private buildReasoning(
    actionType: CortexActionType,
    params: Record<string, unknown>,
    context: CortexContextSnapshot,
    allowed: boolean,
  ): string {
    const parts: string[] = [];

    parts.push(`I detected the intent: ${this.humanizeAction(actionType)}.`);

    if (context.genomeStage) {
      parts.push(`Your business is in the "${context.genomeStage}" stage.`);
    }

    if (context.executiveReadiness > 0) {
      parts.push(`Executive readiness is at ${context.executiveReadiness}%.`);
    }

    if (!allowed) {
      parts.push('This action requires a higher autonomy tier or manual approval.');
    }

    if (params.title) {
      parts.push(`Target: "${params.title}".`);
    }

    return parts.join(' ');
  }

  // ═══════════════════════════════════════════════════════════
  // Evidence: What supports this?
  // ═══════════════════════════════════════════════════════════

  private buildEvidence(evidence: GenomeEvidenceResponse | null): TrustExplanation['evidence'] {
    if (!evidence || evidence.evidence.length === 0) {
      return [
        { source: 'context', data: 'Business context snapshot used for reasoning.', relevance: 0.8 },
      ];
    }

    return evidence.evidence.map((e) => ({
      source: e.source,
      data: JSON.stringify(e.data).slice(0, 200),
      relevance: e.relevance,
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // Risk Assessment
  // ═══════════════════════════════════════════════════════════

  private assessRisks(
    actionType: CortexActionType,
    context: CortexContextSnapshot,
  ): TrustExplanation['risks'] {
    const risks: TrustExplanation['risks'] = [];

    const highRiskActions = ['CREATE_INVOICE', 'SEND_EMAIL', 'EXECUTE_FLOW'];
    if (highRiskActions.includes(actionType)) {
      risks.push({
        description: `This ${this.humanizeAction(actionType)} has financial or operational impact.`,
        probability: 'medium',
        impact: 'Incorrect execution could affect customer relationships or revenue.',
      });
    }

    if (context.executiveReadiness < 50) {
      risks.push({
        description: 'Business readiness is below 50%. Actions may have unexpected side effects.',
        probability: 'medium',
        impact: 'Incomplete business context could lead to suboptimal decisions.',
      });
    }

    if (risks.length === 0) {
      risks.push({
        description: 'Low risk action. Standard execution path.',
        probability: 'low',
        impact: 'Minimal business impact if incorrect.',
      });
    }

    return risks;
  }

  // ═══════════════════════════════════════════════════════════
  // Genome Facts: What Genome dimensions were used?
  // ═══════════════════════════════════════════════════════════

  private extractGenomeFacts(context: CortexContextSnapshot): TrustExplanation['genomeFacts'] {
    return Object.entries(context.genomeDna).map(([dimension, score]) => ({
      dimension,
      score,
      fact: `${dimension}: ${score}/100`,
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // Knowledge Gaps: What's missing?
  // ═══════════════════════════════════════════════════════════

  private identifyGaps(
    context: CortexContextSnapshot,
    evidence: GenomeEvidenceResponse | null,
  ): string[] {
    const gaps: string[] = [];

    gaps.push('External market conditions are not factored into this recommendation.');
    gaps.push('Real-time competitor data is unavailable.');

    if (!evidence || evidence.gaps.length > 0) {
      gaps.push('Some supporting evidence is incomplete or estimated.');
    }

    if (context.unreadMessages > 10) {
      gaps.push(`${context.unreadMessages} unread messages may contain relevant context.`);
    }

    return gaps;
  }

  // ═══════════════════════════════════════════════════════════
  // Inaction: What if we do nothing?
  // ═══════════════════════════════════════════════════════════

  private explainInaction(
    actionType: CortexActionType,
    context: CortexContextSnapshot,
  ): string {
    switch (actionType) {
      case 'CREATE_INVOICE':
        return `Without invoicing, ${context.pendingInvoices} pending items remain unbilled. This delays cash flow and may confuse clients about payment expectations.`;
      case 'CREATE_TASK':
        return 'Without task creation, the work item is not tracked. It may be forgotten or deprioritized.';
      case 'CREATE_LEAD':
        return 'Without lead capture, the potential customer may be lost to follow-up.';
      case 'CREATE_EVENT':
        return 'Without scheduling, the meeting or deadline may be missed.';
      case 'SEND_EMAIL':
        return 'Without sending, the communication is delayed. This may slow down deals or responses.';
      default:
        return `Without this action, the ${this.humanizeAction(actionType)} remains unaddressed. I will monitor and alert you if it becomes more urgent.`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Tracking Plan: What will we measure?
  // ═══════════════════════════════════════════════════════════

  private defineTracking(actionType: CortexActionType): TrustExplanation['trackingPlan'] {
    const metricMap: Record<string, string> = {
      CREATE_TASK: 'task_completion_rate',
      CREATE_EVENT: 'event_attendance_rate',
      CREATE_INVOICE: 'invoice_payment_rate',
      CREATE_LEAD: 'lead_conversion_rate',
      SEND_EMAIL: 'email_response_rate',
      SEND_MESSAGE: 'message_delivery_rate',
      CREATE_DOCUMENT: 'document_usage_rate',
      ANALYZE_DATA: 'insight_accuracy',
      GENERATE_REPORT: 'report_engagement',
      EXECUTE_FLOW: 'flow_success_rate',
      UPDATE_CRM: 'crm_data_quality',
      SCHEDULE_REMINDER: 'reminder_effectiveness',
      SEARCH_KNOWLEDGE: 'search_result_relevance',
      EXECUTE_TOOL: 'tool_execution_success',
    };

    return [{
      metric: metricMap[actionType] ?? 'action_success_rate',
      target: 'Track success/error rate over 24 hours',
      timeframe: '24 hours',
    }, {
      metric: 'user_satisfaction',
      target: 'User confirms action was correct',
      timeframe: '1 week',
    }];
  }

  // ═══════════════════════════════════════════════════════════
  // Rollback Plan
  // ═══════════════════════════════════════════════════════════

  private buildRollbackPlan(
    actionType: CortexActionType,
    requiresApproval: boolean,
  ): string {
    if (requiresApproval) {
      return 'Approval-required actions can be rejected before execution. No rollback needed.';
    }

    const reversibleActions = ['CREATE_TASK', 'CREATE_EVENT', 'SCHEDULE_REMINDER'];
    if (reversibleActions.includes(actionType)) {
      return `This action can be undone via the activity log or by deleting the created ${this.humanizeAction(actionType).toLowerCase()}.`;
    }

    return 'This action has limited rollback. Please review before confirming.';
  }

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  private humanizeAction(actionType: string): string {
    return actionType
      .replace(/_/g, ' ')
      .replace(/CREATE/g, 'Create')
      .replace(/SEND/g, 'Send')
      .replace(/UPDATE/g, 'Update')
      .replace(/EXECUTE/g, 'Execute')
      .replace(/GENERATE/g, 'Generate')
      .replace(/ANALYZE/g, 'Analyze')
      .replace(/SEARCH/g, 'Search')
      .replace(/SCHEDULE/g, 'Schedule')
      .replace(/QUERY/g, 'Query')
      .toLowerCase();
  }
}
