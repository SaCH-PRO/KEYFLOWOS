import { Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  KeyActionProposalService,
} from '../key-autonomy/key-action-proposal.service';
import {
  KeyActionProposalData,
  KeyActionSourceType,
} from '../key-autonomy/key-action-proposal.types';
import { KeyCortexAuditService } from './key-cortex-audit.service';

export interface ProposeApprovalInput {
  businessId: string;
  userId?: string;
  sourceType?: KeyActionSourceType;
  sourceId?: string;
  sourceMode?: string;
  actionType?: string;
  toolName?: string;
  module?: string;
  title?: string;
  description?: string;
  summary?: string;
  rationale?: string;
  expectedBenefit?: string;
  risks?: string;
  parameters?: Record<string, unknown>;
  affectedEntities?: Record<string, unknown>;
  evidence?: string[];
  planId?: string;
  planStepId?: string;
  correlationId?: string;
  commandId?: string;
  sessionId?: string;
}

export interface ApproveInput {
  proposalId: string;
  userId: string;
  businessId: string;
  autoExecute?: boolean;
}

export interface RejectInput {
  proposalId: string;
  userId: string;
  businessId: string;
  reason?: string;
}

export interface ExecuteInput {
  proposalId: string;
  businessId: string;
  userId?: string;
}

/**
 * Single source of truth for KEY Cortex approvals.
 *
 * All approval paths (tool execution, plan steps, legacy AI oversight,
 * human workflows) must flow through this orchestrator so that:
 * - only `KeyActionProposal` is written,
 * - every state change emits a `BusinessEvent`,
 * - identity thread (sessionId, commandId, correlationId) is preserved.
 */
@Injectable()
export class KeyCortexApprovalOrchestratorService {
  constructor(
    @Inject(forwardRef(() => KeyActionProposalService)) private readonly proposalService: KeyActionProposalService,
    private readonly audit: KeyCortexAuditService,
  ) {}

  async propose(input: ProposeApprovalInput): Promise<KeyActionProposalData> {
    const title =
      input.title ||
      (input.toolName ? `Execute ${input.module ?? 'cortex'}.${input.toolName}` : `Execute ${input.actionType ?? 'action'}`);

    const proposal = await this.proposalService.create(
      input.businessId,
      {
        sourceType: input.sourceType ?? 'KEY_CORTEX',
        sourceId: input.sourceId,
        sourceMode: input.sourceMode,
        title,
        summary: input.summary ?? input.description,
        description: input.description,
        rationale: input.rationale,
        evidence: input.evidence,
        actionType: (input.actionType as any) ?? 'EXECUTE_TOOL',
        payload: input.parameters,
        toolName: input.toolName,
        module: input.module,
        expectedBenefit: input.expectedBenefit,
        risks: input.risks,
        inputPayload: input.parameters,
        affectedEntities: input.affectedEntities,
        planId: input.planId,
        planStepId: input.planStepId,
        correlationId: input.correlationId,
        commandId: input.commandId,
        sessionId: input.sessionId,
      },
      input.userId,
    );

    await this.audit.emit(
      'GOVERNANCE_DECISION',
      'propose',
      'key_action_proposal',
      proposal.id,
      {
        businessId: input.businessId,
        actorType: 'ai',
        actorId: 'key_ai',
        source: 'ai',
        proposalId: proposal.id,
        sessionId: input.sessionId,
        commandId: input.commandId,
        correlationId: input.correlationId,
        metadata: {
          toolName: input.toolName,
          module: input.module,
          actionType: input.actionType,
          title,
        },
      },
      undefined,
      { status: proposal.status, riskLevel: proposal.riskLevel },
    );

    return proposal;
  }

  async approve(input: ApproveInput): Promise<KeyActionProposalData> {
    const before = await this.proposalService.get(input.businessId, input.proposalId);

    const proposal = await this.proposalService.approve(
      input.businessId,
      input.proposalId,
      input.userId,
    );

    await this.audit.emit(
      'GOVERNANCE_DECISION',
      'approve',
      'key_action_proposal',
      proposal.id,
      {
        businessId: input.businessId,
        actorType: 'human',
        actorId: input.userId,
        source: 'web',
        proposalId: proposal.id,
        sessionId: proposal.sessionId ?? undefined,
        commandId: proposal.commandId ?? undefined,
        correlationId: proposal.correlationId ?? undefined,
      },
      { status: before.status },
      { status: proposal.status, approvedBy: proposal.approvedBy },
    );

    if (input.autoExecute) {
      return this.executeApproved(input);
    }

    return proposal;
  }

  async reject(input: RejectInput): Promise<KeyActionProposalData> {
    const before = await this.proposalService.get(input.businessId, input.proposalId);

    const proposal = await this.proposalService.reject(
      input.businessId,
      input.proposalId,
      input.userId,
      input.reason,
    );

    await this.audit.emit(
      'GOVERNANCE_DECISION',
      'reject',
      'key_action_proposal',
      proposal.id,
      {
        businessId: input.businessId,
        actorType: 'human',
        actorId: input.userId,
        source: 'web',
        proposalId: proposal.id,
        sessionId: proposal.sessionId ?? undefined,
        commandId: proposal.commandId ?? undefined,
        correlationId: proposal.correlationId ?? undefined,
        metadata: { reason: input.reason },
      },
      { status: before.status },
      { status: proposal.status, rejectedBy: proposal.rejectedBy, rejectionReason: proposal.rejectionReason },
    );

    return proposal;
  }

  async executeApproved(input: ExecuteInput): Promise<KeyActionProposalData> {
    const before = await this.proposalService.getById(input.proposalId);

    const proposal = await this.proposalService.execute(
      input.businessId,
      input.proposalId,
      input.userId ?? 'key_ai',
      true,
      true,
    );

    await this.audit.emit(
      'ACTION_EXECUTED',
      'execute',
      'key_action_proposal',
      proposal.id,
      {
        businessId: input.businessId,
        actorType: 'ai',
        actorId: input.userId ?? 'key_ai',
        source: 'ai',
        proposalId: proposal.id,
        sessionId: proposal.sessionId ?? undefined,
        commandId: proposal.commandId ?? undefined,
        correlationId: proposal.correlationId ?? undefined,
        metadata: {
          status: proposal.status,
          actionType: proposal.actionType,
        },
      },
      { status: before.status },
      {
        status: proposal.status,
        executedBy: proposal.executedBy,
        executionResult: proposal.executionResult,
        failureReason: proposal.failureReason,
      },
    );

    return proposal;
  }
}
