import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { AutonomyOrchestratorService } from './autonomy-orchestrator.service';
import type {
  CreateKeyActionProposalInput,
  KeyActionProposalData,
  KeyActionProposalStatus,
  KeyExecutableActionType,
  ListKeyActionProposalsQuery,
} from './key-action-proposal.types';
import { KEY_ACTION_PROPOSAL_STATUSES } from './key-action-proposal.types';

@Injectable()
export class KeyActionProposalService {
  private readonly logger = new Logger(KeyActionProposalService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(KeyActionPolicyService) private readonly policy: KeyActionPolicyService,
    @Inject(KeyActionExecutorService) private readonly executor: KeyActionExecutorService,
    @Inject(KeyActionGenomePolicyService) private readonly genomePolicy: KeyActionGenomePolicyService,
    @Inject(forwardRef(() => AutonomyOrchestratorService)) private readonly autonomyOrchestrator: AutonomyOrchestratorService,
  ) {}

  async create(
    businessId: string,
    input: CreateKeyActionProposalInput,
    userId?: string,
  ): Promise<KeyActionProposalData> {
    this.policy.getPolicy(input.actionType);
    const riskLevel = this.policy.riskLevel(input.actionType);
    const requiresApproval = this.policy.requiresApproval(input.actionType);

    const row = await this.prisma.client.keyActionProposal.create({
      data: {
        businessId,
        userId: userId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        sourceMode: input.sourceMode ?? null,
        title: input.title,
        summary: input.summary ?? null,
        rationale: input.rationale ?? null,
        evidence: (input.evidence ?? []) as Prisma.InputJsonValue,
        actionType: input.actionType,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        planId: input.planId ?? null,
        planStepId: input.planStepId ?? null,
        correlationId: input.correlationId ?? null,
        commandId: input.commandId ?? null,
        sessionId: input.sessionId ?? null,
        businessEventId: input.businessEventId ?? null,
        toolName: input.toolName ?? null,
        module: input.module ?? null,
        description: input.description ?? null,
        expectedBenefit: input.expectedBenefit ?? null,
        risks: input.risks ?? null,
        inputPayload: (input.inputPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        affectedEntities: (input.affectedEntities ?? undefined) as Prisma.InputJsonValue | undefined,
        multiStepParentId: input.multiStepParentId ?? null,
        riskLevel,
        status: 'PENDING',
        requiresApproval,
      },
    });

    await this.emitLifecycleEvent(businessId, row.id, input.actionType, 'key.action.proposed', 'NORMAL', {
      sourceType: input.sourceType,
      sourceMode: input.sourceMode,
      riskLevel,
      requiresApproval,
    });

    return this.serialize(row);
  }

  async list(
    businessId: string,
    query: ListKeyActionProposalsQuery = {},
  ): Promise<KeyActionProposalData[]> {
    const rows = await this.prisma.client.keyActionProposal.findMany({
      where: {
        businessId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.actionType ? { actionType: query.actionType } : {}),
        ...(query.createdAfter ? { createdAt: { gte: query.createdAfter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(businessId: string, proposalId: string): Promise<KeyActionProposalData> {
    const row = await this.prisma.client.keyActionProposal.findFirst({
      where: { id: proposalId, businessId },
    });
    if (!row) throw new NotFoundException('Action proposal not found');
    return this.serialize(row);
  }

  async getById(proposalId: string): Promise<KeyActionProposalData> {
    const row = await this.prisma.client.keyActionProposal.findUnique({
      where: { id: proposalId },
    });
    if (!row) throw new NotFoundException('Action proposal not found');
    return this.serialize(row);
  }

  async approve(
    businessId: string,
    proposalId: string,
    approvedBy?: string,
  ): Promise<KeyActionProposalData> {
    const existing = await this.get(businessId, proposalId);
    if (existing.status !== 'PENDING') {
      throw new NotFoundException('Proposal is not pending approval');
    }

    const row = await this.prisma.client.keyActionProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPROVED',
        approvedBy: approvedBy ?? null,
        approvedAt: new Date(),
      },
    });

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      existing.actionType,
      'key.action.approved',
      'NORMAL',
      { approvedBy },
    );

    const proposal = this.serialize(row);
    this.events.emit('key.action.approved', {
      proposalId,
      businessId,
      proposal,
    });

    return proposal;
  }

  async reject(
    businessId: string,
    proposalId: string,
    rejectedBy?: string,
    reason?: string,
  ): Promise<KeyActionProposalData> {
    const existing = await this.get(businessId, proposalId);
    if (existing.status !== 'PENDING') {
      throw new NotFoundException('Proposal is not pending approval');
    }

    const row = await this.prisma.client.keyActionProposal.update({
      where: { id: proposalId },
      data: {
        status: 'REJECTED',
        rejectedBy: rejectedBy ?? null,
        rejectedAt: new Date(),
        rejectionReason: reason ?? null,
      },
    });

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      existing.actionType,
      'key.action.rejected',
      'NORMAL',
      { rejectedBy, reason },
    );

    const proposal = this.serialize(row);
    this.events.emit('key.action.rejected', {
      proposalId,
      businessId,
      proposal,
      reason,
    });

    return proposal;
  }

  async cancel(businessId: string, proposalId: string): Promise<KeyActionProposalData> {
    const existing = await this.get(businessId, proposalId);
    if (existing.status !== 'PENDING' && existing.status !== 'APPROVED') {
      throw new NotFoundException('Proposal cannot be cancelled');
    }

    const row = await this.prisma.client.keyActionProposal.update({
      where: { id: proposalId },
      data: { status: 'CANCELLED' },
    });

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      existing.actionType,
      'key.action.cancelled',
      'NORMAL',
      { previousStatus: existing.status },
    );

    return this.serialize(row);
  }

  async execute(
    businessId: string,
    proposalId: string,
    executedBy?: string,
    confirm = false,
    confirmGenomeRisk = false,
  ): Promise<KeyActionProposalData> {
    const proposal = await this.get(businessId, proposalId);

    if (proposal.status !== 'APPROVED') {
      throw new NotFoundException('Proposal must be approved before execution');
    }

    if (!this.policy.isExecutable(proposal.actionType)) {
      throw new NotFoundException(`Action ${proposal.actionType} is not executable`);
    }

    if ((proposal.riskLevel === 'HIGH' || proposal.riskLevel === 'CRITICAL') && !confirm) {
      throw new NotFoundException('High-risk action requires explicit confirmation');
    }

    const actionKey = `key_autonomy.${proposal.actionType}`;
    const autonomyVerdict = await this.autonomyOrchestrator.evaluateAction(
      businessId,
      actionKey,
      (proposal.payload as Record<string, unknown>) ?? {},
      { proposedBy: executedBy, proposalId: proposal.id },
    );

    if (!autonomyVerdict.allowed) {
      const row = await this.prisma.client.keyActionProposal.update({
        where: { id: proposalId },
        data: {
          status: 'BLOCKED',
          executedBy: executedBy ?? null,
          executedAt: new Date(),
          failureReason: autonomyVerdict.reason,
        },
      });

      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.blocked_by_autonomy',
        'HIGH',
        {
          executedBy,
          reason: autonomyVerdict.reason,
          ruleTrace: autonomyVerdict.ruleTrace,
        },
      );

      throw new BadRequestException(autonomyVerdict.reason);
    }

    if (autonomyVerdict.requiresApproval && !confirm) {
      throw new BadRequestException(autonomyVerdict.reason);
    }

    const genomeDecision = await this.genomePolicy.evaluateExecution(businessId, proposal);

    if (!genomeDecision.allowed) {
      const row = await this.prisma.client.keyActionProposal.update({
        where: { id: proposalId },
        data: {
          status: 'BLOCKED',
          executedBy: executedBy ?? null,
          executedAt: new Date(),
          failureReason: genomeDecision.message,
        },
      });

      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.blocked_by_genome',
        'HIGH',
        {
          executedBy,
          module: genomeDecision.module,
          readinessScore: genomeDecision.readinessScore,
          riskLevel: genomeDecision.riskLevel,
          blockedReasons: genomeDecision.blockedReasons,
          missingFacts: genomeDecision.missingFacts,
        },
      );

      throw new BadRequestException(genomeDecision.message);
    }

    if (genomeDecision.requiresExtraConfirmation && !confirmGenomeRisk) {
      throw new BadRequestException(genomeDecision.message);
    }

    await this.prisma.client.keyActionProposal.update({
      where: { id: proposalId },
      data: { status: 'EXECUTING' },
    });

    if (genomeDecision.requiresExtraConfirmation) {
      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.genome_risk_confirmed',
        'NORMAL',
        {
          executedBy,
          module: genomeDecision.module,
          readinessScore: genomeDecision.readinessScore,
          riskLevel: genomeDecision.riskLevel,
        },
      );
    }

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      proposal.actionType,
      'key.action.executing',
      'NORMAL',
      { executedBy },
    );

    const outcome = await this.executor.execute(businessId, proposal, executedBy);

    if (outcome.success) {
      const row = await this.prisma.client.keyActionProposal.update({
        where: { id: proposalId },
        data: {
          status: 'EXECUTED',
          executedBy: executedBy ?? null,
          executedAt: new Date(),
          executionResult: outcome.result as Prisma.InputJsonValue,
        },
      });

      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.executed',
        'HIGH',
        { executedBy, executionResult: outcome.result },
      );

      return this.serialize(row);
    }

    const row = await this.prisma.client.keyActionProposal.update({
      where: { id: proposalId },
      data: {
        status: 'FAILED',
        executedBy: executedBy ?? null,
        executedAt: new Date(),
        failureReason: outcome.error ?? 'Execution failed',
      },
    });

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      proposal.actionType,
      'key.action.failed',
      'HIGH',
      { executedBy, failureReason: outcome.error },
    );

    return this.serialize(row);
  }

  private async emitLifecycleEvent(
    businessId: string,
    proposalId: string,
    actionType: KeyExecutableActionType,
    type: string,
    importance: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL',
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.temporal
      .emit({
        businessId,
        source: 'KEY',
        type,
        module: 'key-autonomy',
        entityType: 'key_action_proposal',
        entityId: proposalId,
        title: `KEY action ${type.replace('key.action.', '')}`,
        summary: `Action ${actionType}`,
        importance,
        payload: { actionType, ...payload },
      })
      .catch((err) => this.logger.warn(`Temporal emit failed: ${(err as Error).message}`));
  }

  private serialize(row: any): KeyActionProposalData {
    return {
      id: row.id,
      businessId: row.businessId,
      userId: row.userId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceMode: row.sourceMode,
      title: row.title,
      summary: row.summary,
      rationale: row.rationale,
      evidence: (row.evidence ?? []) as string[],
      actionType: row.actionType as KeyExecutableActionType,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      planId: row.planId,
      planStepId: row.planStepId,
      correlationId: row.correlationId,
      commandId: row.commandId,
      sessionId: row.sessionId,
      businessEventId: row.businessEventId,
      toolName: row.toolName,
      module: row.module,
      description: row.description,
      expectedBenefit: row.expectedBenefit,
      risks: row.risks,
      inputPayload: (row.inputPayload ?? null) as Record<string, unknown> | null,
      affectedEntities: (row.affectedEntities ?? null) as Record<string, unknown> | null,
      multiStepParentId: row.multiStepParentId,
      riskLevel: row.riskLevel,
      status: row.status as KeyActionProposalStatus,
      requiresApproval: row.requiresApproval,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt?.toISOString(),
      rejectedBy: row.rejectedBy,
      rejectedAt: row.rejectedAt?.toISOString(),
      rejectionReason: row.rejectionReason,
      executedBy: row.executedBy,
      executedAt: row.executedAt?.toISOString(),
      executionResult: (row.executionResult ?? null) as Record<string, unknown> | null,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
