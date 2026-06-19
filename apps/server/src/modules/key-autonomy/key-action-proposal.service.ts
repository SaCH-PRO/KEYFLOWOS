import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionPolicyService } from './key-action-policy.service';
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
    @Inject(KeyActionPolicyService) private readonly policy: KeyActionPolicyService,
    @Inject(KeyActionExecutorService) private readonly executor: KeyActionExecutorService,
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

    return this.serialize(row);
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

    return this.serialize(row);
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

    await this.prisma.client.keyActionProposal.update({
      where: { id: proposalId },
      data: { status: 'EXECUTING' },
    });

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
