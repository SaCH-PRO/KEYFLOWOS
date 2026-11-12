import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { AutonomyOrchestratorService } from './autonomy-orchestrator.service';
import { ActionNotClearedError, KeyActionBoundaryService } from './action-boundary/key-action-boundary.service';
import { resolvePrincipalAuthority, type PrincipalAuthority } from './action-boundary/control-clearance';
import type {
  CreateKeyActionProposalInput,
  KeyActionProposalData,
  KeyActionProposalStatus,
  KeyExecutableActionType,
  ListKeyActionProposalsQuery,
} from './key-action-proposal.types';
import { KEY_ACTION_PROPOSAL_STATUSES } from './key-action-proposal.types';

type ProposalDb = PrismaService['client'];
type ProposalTx = Parameters<Extract<Parameters<ProposalDb['$transaction']>[0], (...args: never[]) => unknown>>[0];
type AuthorityReader = Pick<ProposalTx, 'user' | 'business' | 'membership'>;

/**
 * V1-32 (CF-29): what an approval of a non-boundary proposal records in
 * `resolution`, beside `approvedBy`: the authority it was given under, read
 * when it was given. Execution re-reads the approver and compares.
 */
interface RecordedApproval {
  v: 1;
  kind: 'APPROVAL';
  approvedBy: string | null;
  authority: Pick<PrincipalAuthority, 'basis' | 'membershipId' | 'approvalTier'> | null;
  at: string;
}

/** The authority an approval was recorded under, when it was recorded for this approver. */
function recordedAuthority(resolution: unknown, approvedBy: string): RecordedApproval['authority'] {
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return null;
  const r = resolution as Partial<RecordedApproval>;
  if (r.kind !== 'APPROVAL' || r.approvedBy !== approvedBy || !r.authority) return null;
  const { basis, membershipId, approvalTier } = r.authority;
  if (typeof basis !== 'string' || typeof approvalTier !== 'number') return null;
  return { basis, membershipId: typeof membershipId === 'string' ? membershipId : null, approvalTier };
}

type ClaimOutcome =
  | { kind: 'claimed' }
  | { kind: 'conflict' }
  | { kind: 'lapsed'; reason: string; approvedBy: string | null; recorded: boolean };

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
    @Inject(KeyActionBoundaryService) private readonly boundary: KeyActionBoundaryService,
  ) {}

  async create(
    businessId: string,
    input: CreateKeyActionProposalInput,
    userId?: string,
  ): Promise<KeyActionProposalData> {
    this.policy.getPolicy(input.actionType);
    const riskLevel = this.policy.riskLevel(input.actionType);
    // KF-EXEC-ACTION-001: a proposal for a capability the action boundary has
    // adopted is that capability's action record, whoever produced it. It is
    // sealed here (real capability identity, frozen envelope, fingerprint) so
    // that an approval has something exact to name. No producer supplies a
    // trusted requester, so it can only ever be cleared by a human approval.
    const boundaryColumns = this.boundary.sealProposal(businessId, input, userId ?? null);
    const requiresApproval = boundaryColumns ? true : this.policy.requiresApproval(input.actionType);

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
        ...(boundaryColumns ?? {}),
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

    // KF-EXEC-ACTION-001: for an adopted capability an approval is control
    // evidence, not a status. The boundary binds it to the action fingerprint
    // and to this approver, whose authority it reads on locked rows; an
    // approval nobody can be named for is not one.
    let row;
    if (this.boundary.governs(existing)) {
      if (!approvedBy) throw new ForbiddenException('An authenticated approver is required for this action');
      row = await this.boundary.recordEvidence(businessId, proposalId, approvedBy);
    } else {
      // V1-32: the approval records the authority it was given under, so that
      // execution can tell an approver who has since been removed or
      // downgraded. The write is conditional on PENDING: an unconditional one
      // could put an executing proposal back to APPROVED and let it be claimed
      // a second time. It clears a failure reason left by an approval that
      // lapsed: the approval it described has been replaced by this one.
      const now = new Date();
      const authority = approvedBy
        ? await this.readApproverAuthority(this.prisma.client, businessId, approvedBy)
        : null;
      const recorded: RecordedApproval = {
        v: 1,
        kind: 'APPROVAL',
        approvedBy: approvedBy ?? null,
        authority: authority
          ? { basis: authority.basis, membershipId: authority.membershipId, approvalTier: authority.approvalTier }
          : null,
        at: now.toISOString(),
      };
      const { count } = await this.prisma.client.keyActionProposal.updateMany({
        where: { id: proposalId, businessId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedBy: approvedBy ?? null,
          approvedAt: now,
          failureReason: null,
          resolution: recorded as unknown as Prisma.InputJsonValue,
        },
      });
      if (count !== 1) throw new NotFoundException('Proposal is not pending approval');
      row = await this.prisma.client.keyActionProposal.findFirst({ where: { id: proposalId, businessId } });
    }

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

    // For an adopted capability a rejection takes the action's execution
    // claim, so it cannot land beside an execution of the same action. For
    // any other proposal the write is conditional on the status just read
    // (V1-32, SEC-V32-1): a proposal approved again and claimed in between is
    // not overwritten.
    const row = this.boundary.governs(existing)
      ? await this.boundary.voidAction(businessId, proposalId, 'REJECTED', rejectedBy ?? null, reason)
      : await this.writeIfStatus(businessId, proposalId, existing.status, {
          status: 'REJECTED',
          rejectedBy: rejectedBy ?? null,
          rejectedAt: new Date(),
          rejectionReason: reason ?? null,
        });
    if (!row) throw new ConflictException('This proposal is no longer pending approval');

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

    // Conditional on the status just read (V1-32, SEC-V32-1): a cancel that
    // read APPROVED and lost the race to an execution's claim is refused, not
    // recorded over a proposal that is executing.
    const row = this.boundary.governs(existing)
      ? await this.boundary.voidAction(businessId, proposalId, 'CANCELLED', null)
      : await this.writeIfStatus(businessId, proposalId, existing.status, { status: 'CANCELLED' });
    if (!row) {
      throw new ConflictException(
        `This proposal is no longer ${existing.status.toLowerCase()}; it is being executed or has been resolved`,
      );
    }

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

    // KF-EXEC-ACTION-001: an EXECUTE_TOOL proposal for an adopted capability
    // is governed as that capability. Evaluating the wrapper name here meant
    // the tool's own blocklist entry, module and tier were never consulted.
    const governed = this.boundary.governs(proposal);
    const actionKey = governed
      ? (this.boundary.resolveInvocation(proposal).toolName as string)
      : `key_autonomy.${proposal.actionType}`;
    const autonomyVerdict = await this.autonomyOrchestrator.evaluateAction(
      businessId,
      actionKey,
      (proposal.payload as Record<string, unknown>) ?? {},
      { proposedBy: executedBy, proposalId: proposal.id },
    );

    if (!autonomyVerdict.allowed) {
      if (await this.recordBlocked(businessId, proposalId, executedBy, autonomyVerdict.reason)) {
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
      }

      throw new BadRequestException(autonomyVerdict.reason);
    }

    if (autonomyVerdict.requiresApproval && !confirm) {
      throw new BadRequestException(autonomyVerdict.reason);
    }

    const genomeDecision = await this.genomePolicy.evaluateExecution(businessId, proposal);

    if (!genomeDecision.allowed) {
      if (await this.recordBlocked(businessId, proposalId, executedBy, genomeDecision.message)) {
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
      }

      throw new BadRequestException(genomeDecision.message);
    }

    if (genomeDecision.requiresExtraConfirmation && !confirmGenomeRisk) {
      throw new BadRequestException(genomeDecision.message);
    }

    if (governed) {
      return this.executeThroughBoundary(businessId, proposal, executedBy);
    }

    // V1-32 (M46): the claim. Only the execute that wins it goes on to the
    // executor; every other one is refused here, before it emits or runs.
    await this.claimForExecution(businessId, proposal, executedBy);

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
      const { row, recorded } = await this.recordOutcome(businessId, proposalId, {
        status: 'EXECUTED',
        executedBy: executedBy ?? null,
        executedAt: new Date(),
        executionResult: outcome.result as Prisma.InputJsonValue,
        // As the action boundary's EXECUTED write does: no failure reason
        // survives a successful execution.
        failureReason: null,
      });

      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.executed',
        'HIGH',
        { executedBy, executionResult: outcome.result, ...(recorded ? {} : { outcomeRecorded: false }) },
      );

      return this.serialize(row);
    }

    const { row, recorded } = await this.recordOutcome(businessId, proposalId, {
      status: 'FAILED',
      executedBy: executedBy ?? null,
      executedAt: new Date(),
      failureReason: outcome.error ?? 'Execution failed',
    });

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      proposal.actionType,
      'key.action.failed',
      'HIGH',
      { executedBy, failureReason: outcome.error, ...(recorded ? {} : { outcomeRecorded: false }) },
    );

    return this.serialize(row);
  }

  /**
   * V1-32 (SEC-V32-1): a write conditional on the status the caller decided
   * on. The row it wrote, or null when the proposal had moved on.
   */
  private async writeIfStatus(
    businessId: string,
    proposalId: string,
    status: string,
    data: Prisma.KeyActionProposalUpdateManyMutationInput,
  ) {
    const { count } = await this.prisma.client.keyActionProposal.updateMany({
      where: { id: proposalId, businessId, status },
      data,
    });
    if (count !== 1) return null;
    return this.prisma.client.keyActionProposal.findFirst({ where: { id: proposalId, businessId } });
  }

  /**
   * V1-32 (SEC-V32-1): an execution's outcome, written only over its own claim
   * (status EXECUTING). Nothing in this service moves a claimed proposal on;
   * if something else has, the status it was moved to stands, and the outcome
   * is reported by the lifecycle event and the log, not written over it.
   */
  private async recordOutcome(
    businessId: string,
    proposalId: string,
    data: Prisma.KeyActionProposalUpdateManyMutationInput & { status: 'EXECUTED' | 'FAILED' },
  ) {
    const written = await this.writeIfStatus(businessId, proposalId, 'EXECUTING', data);
    if (written) return { row: written, recorded: true };
    const current = await this.prisma.client.keyActionProposal.findFirst({ where: { id: proposalId, businessId } });
    if (!current) throw new NotFoundException('Action proposal not found');
    this.logger.error(
      `[execute] proposal ${proposalId} was moved from EXECUTING to ${current.status} while it ran; ` +
        `its ${data.status} outcome was not written over that`,
    );
    return { row: current, recorded: false };
  }

  /**
   * V1-32 (M46, CF-29, KEY-PROPOSAL-CLAIM-001). The EXECUTING write is the
   * execution claim: one conditional write (updateMany on {id, businessId,
   * status 'APPROVED'}) that only one caller can win (count === 1). The status
   * check in `execute` was a separate read, so two concurrent executes both
   * passed it and both ran the executor; a proposal cancelled after that read
   * ran anyway.
   *
   * In the same transaction, before the claim, the approver is re-read on
   * locked rows (FOR SHARE, as the action boundary's readFresh does): a
   * revocation that has committed is what the read returns, and one that has
   * not waits for the claim. An approver who no longer has authority in the
   * business, or whose authority is less than the one recorded when they
   * approved, means the approval no longer stands. The proposal goes back to
   * PENDING with the reason, as the boundary does for a revoked or changed
   * evidence principal, so someone who holds the authority can approve again.
   */
  private async claimForExecution(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<void> {
    const proposalId = proposal.id;
    const outcome: ClaimOutcome = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.keyActionProposal.findFirst({
        where: { id: proposalId, businessId },
        select: { status: true, approvedBy: true, resolution: true },
      });
      if (!current || current.status !== 'APPROVED') return { kind: 'conflict' };

      // Conditional on the approval just checked, as well as on the status.
      const sameApproval = { id: proposalId, businessId, status: 'APPROVED', approvedBy: current.approvedBy };

      const lapse = await this.approvalLapse(tx, businessId, current.approvedBy, current.resolution);
      if (lapse) {
        const { count } = await tx.keyActionProposal.updateMany({
          where: sameApproval,
          data: {
            status: 'PENDING',
            approvedBy: null,
            approvedAt: null,
            failureReason: lapse,
            resolution: {
              v: 1,
              kind: 'APPROVAL_LAPSED',
              approvedBy: current.approvedBy,
              reason: lapse,
              at: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return { kind: 'lapsed', reason: lapse, approvedBy: current.approvedBy, recorded: count === 1 };
      }

      const { count } = await tx.keyActionProposal.updateMany({
        where: sameApproval,
        data: { status: 'EXECUTING', executedBy: executedBy ?? null },
      });
      return count === 1 ? { kind: 'claimed' } : { kind: 'conflict' };
    });

    if (outcome.kind === 'claimed') return;
    if (outcome.kind === 'conflict') {
      throw new ConflictException('This proposal is already being executed or is no longer approved');
    }
    if (outcome.recorded) {
      await this.emitLifecycleEvent(businessId, proposalId, proposal.actionType, 'key.action.approval_lapsed', 'HIGH', {
        executedBy,
        approvedBy: outcome.approvedBy,
        reason: outcome.reason,
      });
    }
    throw new ForbiddenException(`${outcome.reason}; it needs to be approved again before it can be executed`);
  }

  /** Why the approval on record no longer stands, or null when it does. */
  private async approvalLapse(
    tx: ProposalTx,
    businessId: string,
    approvedBy: string | null,
    resolution: unknown,
  ): Promise<string | null> {
    if (!approvedBy) return 'The approval on record names no approver';

    await tx.$queryRaw`SELECT id FROM users WHERE id = ${approvedBy} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM memberships WHERE user_id = ${approvedBy} AND business_id = ${businessId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR SHARE`;
    const now = await this.readApproverAuthority(tx, businessId, approvedBy);

    if (now.basis === 'none') return 'The approver of this proposal no longer has authority in this business';
    // An approval recorded before V1-32 carries no authority: it is held to
    // the rule above only.
    const given = recordedAuthority(resolution, approvedBy);
    if (
      given &&
      (now.basis !== given.basis || now.membershipId !== given.membershipId || now.approvalTier < given.approvalTier)
    ) {
      return 'The authority of the approver of this proposal has changed since they approved it';
    }
    return null;
  }

  /**
   * The approver's authority, by the rule the action boundary applies to an
   * evidence giver (resolvePrincipalAuthority: SUPER_ADMIN, or a Membership
   * with its approval tier). The recorded owner field grants nothing on its
   * own (owner rulings D-104, D-125, W11-ACTION-BOUNDARY-OWNER-ARM): an
   * approval recorded under the retired 'owner_without_membership' basis
   * lapses here, because its approver now resolves to 'none'.
   */
  private async readApproverAuthority(
    client: AuthorityReader,
    businessId: string,
    userId: string,
  ): Promise<PrincipalAuthority> {
    const [user, business, membership] = await Promise.all([
      client.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true, bannedAt: true } }),
      client.business.findFirst({ where: { id: businessId }, select: { ownerId: true } }),
      client.membership.findUnique({
        where: { userId_businessId: { userId, businessId } },
        select: { id: true, role: true, maxApprovalTier: true, permissionScopes: true },
      }),
    ]);
    return resolvePrincipalAuthority({ userId, user, business, membership });
  }

  /**
   * A refusal recorded on a proposal that is still APPROVED. Conditional, so
   * it cannot overwrite a concurrent execution that has claimed the proposal.
   */
  private async recordBlocked(
    businessId: string,
    proposalId: string,
    executedBy: string | undefined,
    reason: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.client.keyActionProposal.updateMany({
      where: { id: proposalId, businessId, status: 'APPROVED' },
      data: {
        status: 'BLOCKED',
        executedBy: executedBy ?? null,
        executedAt: new Date(),
        failureReason: reason,
      },
    });
    return count === 1;
  }

  /**
   * Execute an adopted capability's proposal. There is no EXECUTING write and
   * no executor plugin: the boundary's claim transaction admits the action,
   * writes the effect and records the outcome, or refuses and writes nothing.
   */
  private async executeThroughBoundary(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<KeyActionProposalData> {
    await this.emitLifecycleEvent(businessId, proposal.id, proposal.actionType, 'key.action.executing', 'NORMAL', {
      executedBy,
    });

    try {
      await this.boundary.admit(businessId, proposal.id, { executedBy: executedBy ?? null, log: true });
    } catch (err: unknown) {
      if (!(err instanceof ActionNotClearedError)) throw err;
      await this.emitLifecycleEvent(businessId, proposal.id, proposal.actionType, 'key.action.failed', 'HIGH', {
        executedBy,
        failureReason: err.message,
        code: err.code,
      });
      throw new BadRequestException(err.message);
    }

    const executed = await this.get(businessId, proposal.id);
    await this.emitLifecycleEvent(businessId, proposal.id, proposal.actionType, 'key.action.executed', 'HIGH', {
      executedBy,
      executionResult: executed.executionResult,
    });
    return executed;
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
      capabilityName: row.capabilityName ?? null,
      capabilityVersion: row.capabilityVersion ?? null,
      executionSurface: row.executionSurface ?? null,
      actionFingerprint: row.actionFingerprint ?? null,
      controlRequirement: (row.controlRequirement ?? null) as Record<string, unknown> | null,
      evidenceExpiresAt: row.evidenceExpiresAt?.toISOString() ?? null,
      requestedBy: row.requestedBy ?? null,
      proposedBy: row.proposedBy ?? null,
      executedFor: row.executedFor ?? null,
      outcomeEvidence: (row.outcomeEvidence ?? null) as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
