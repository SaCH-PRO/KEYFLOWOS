import { Injectable, Inject, NotFoundException, BadRequestException, Logger, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexApprovalOrchestratorService } from '../key-cortex/key-cortex-approval-orchestrator.service';

export interface CreateApprovalRequestInput {
  businessId: string;
  requestType: string;
  requesterId: string;
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  threshold?: number;
  steps: { stepOrder: number; approverId: string }[];
}

export interface DecideStepInput {
  approvalRequestId: string;
  approverId: string;
  decision: 'approve' | 'reject';
  comment?: string;
}

export interface DelegateStepInput {
  approvalRequestId: string;
  approverId: string;
  delegatedTo: string;
  comment?: string;
}

@Injectable()
export class ApprovalRequestService {
  private readonly logger = new Logger(ApprovalRequestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
    @Inject(forwardRef(() => KeyCortexApprovalOrchestratorService))
    @Inject(forwardRef(() => KeyCortexApprovalOrchestratorService)) private readonly proposalOrchestrator?: KeyCortexApprovalOrchestratorService,
  ) {}

  async createRequest(input: CreateApprovalRequestInput) {
    if (!input.steps || input.steps.length === 0) {
      throw new BadRequestException('At least one approval step is required');
    }

    const sortedSteps = [...input.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const amount = this.extractAmount(input.payload);
    if (input.threshold !== undefined && amount !== undefined && amount <= input.threshold) {
      const request = await this.prisma.client.approvalRequest.create({
        data: {
          businessId: input.businessId,
          requestType: input.requestType,
          requesterId: input.requesterId,
          title: input.title,
          description: input.description,
          payload: (input.payload ?? null) as any,
          threshold: input.threshold ?? null,
          status: 'approved',
          currentStep: sortedSteps.length,
          resolvedAt: new Date(),
          resolution: 'approved',
          steps: {
            create: sortedSteps.map((s) => ({
              stepOrder: s.stepOrder,
              approverId: s.approverId,
              status: 'approved',
              decidedAt: new Date(),
              decision: 'approved',
              comment: 'Auto-approved: under threshold',
            })),
          },
        },
        include: { steps: true },
      });

      this.emitEvent(input.businessId, 'approval.auto_approved', request);
      return request;
    }

    const request = await this.prisma.client.approvalRequest.create({
      data: {
        businessId: input.businessId,
        requestType: input.requestType,
        requesterId: input.requesterId,
        title: input.title,
        description: input.description,
        payload: (input.payload ?? null) as any,
        threshold: input.threshold ?? null,
        status: 'pending',
        currentStep: 0,
        steps: {
          create: sortedSteps.map((s) => ({
            stepOrder: s.stepOrder,
            approverId: s.approverId,
            status: 'pending',
          })),
        },
      },
      include: { steps: true },
    });

    this.emitEvent(input.businessId, 'approval.created', request);

    await this.shadowMigrateToProposal(request, input);

    return request;
  }

  async decideStep(input: DecideStepInput) {
    const request = await this.prisma.client.approvalRequest.findFirst({
      where: { id: input.approvalRequestId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });

    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'pending') {
      throw new BadRequestException(`Request is already ${request.status}`);
    }

    const currentStep = request.steps.find(
      (s) => s.stepOrder === request.currentStep && s.status === 'pending',
    );

    if (!currentStep) {
      throw new BadRequestException('No pending step found');
    }

    if (currentStep.approverId !== input.approverId && currentStep.delegatedTo !== input.approverId) {
      throw new BadRequestException('You are not authorized to decide this step');
    }

    const nextStep = request.steps.find((s) => s.stepOrder === request.currentStep + 1);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: currentStep.id },
        data: {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          decision: input.decision,
          decidedAt: new Date(),
          comment: input.comment,
        },
      });

      if (input.decision === 'reject') {
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: 'rejected',
            resolvedAt: new Date(),
            resolution: 'rejected',
          },
        });
      } else if (nextStep) {
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: { currentStep: nextStep.stepOrder },
        });
      } else {
        await tx.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: 'approved',
            resolvedAt: new Date(),
            resolution: 'approved',
          },
        });
      }
    });

    const updated = await this.prisma.client.approvalRequest.findUnique({
      where: { id: request.id },
      include: { steps: true },
    });

    this.emitEvent(request.businessId, `approval.step_${input.decision}d`, updated!);
    return updated;
  }

  async delegateStep(input: DelegateStepInput) {
    const request = await this.prisma.client.approvalRequest.findFirst({
      where: { id: input.approvalRequestId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });

    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'pending') {
      throw new BadRequestException(`Request is already ${request.status}`);
    }

    const currentStep = request.steps.find(
      (s) => s.stepOrder === request.currentStep && s.status === 'pending',
    );

    if (!currentStep) throw new BadRequestException('No pending step found');
    if (currentStep.approverId !== input.approverId) {
      throw new BadRequestException('Only the assigned approver can delegate');
    }

    await this.prisma.client.approvalStep.update({
      where: { id: currentStep.id },
      data: {
        status: 'delegated',
        delegatedTo: input.delegatedTo,
        comment: input.comment,
      },
    });

    const updated = await this.prisma.client.approvalRequest.findUnique({
      where: { id: request.id },
      include: { steps: true },
    });

    this.emitEvent(request.businessId, 'approval.delegated', updated!);
    return updated;
  }

  async cancelRequest(requestId: string, requesterId: string) {
    const request = await this.prisma.client.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Approval request not found');
    if (request.requesterId !== requesterId) {
      throw new BadRequestException('Only the requester can cancel');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException(`Cannot cancel a ${request.status} request`);
    }

    const updated = await this.prisma.client.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'cancelled', resolvedAt: new Date(), resolution: 'cancelled' },
      include: { steps: true },
    });

    this.emitEvent(request.businessId, 'approval.cancelled', updated);
    return updated;
  }

  async getById(requestId: string) {
    const request = await this.prisma.client.approvalRequest.findUnique({
      where: { id: requestId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });

    if (!request) throw new NotFoundException('Approval request not found');
    return request;
  }

  async listForBusiness(
    businessId: string,
    options?: { status?: string; requestType?: string; limit?: number; offset?: number },
  ) {
    const where: any = { businessId };
    if (options?.status) where.status = options.status;
    if (options?.requestType) where.requestType = options.requestType;

    const [items, total] = await Promise.all([
      this.prisma.client.approvalRequest.findMany({
        where,
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: options?.offset ?? 0,
        take: options?.limit ?? 50,
      }),
      this.prisma.client.approvalRequest.count({ where }),
    ]);

    return { items, total, offset: options?.offset ?? 0, limit: options?.limit ?? 50 };
  }

  async getPendingForUser(businessId: string, userId: string) {
    const requests = await this.prisma.client.approvalRequest.findMany({
      where: {
        businessId,
        status: 'pending',
        steps: {
          some: {
            status: 'pending',
            OR: [{ approverId: userId }, { delegatedTo: userId }],
          },
        },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return requests.filter((req) => {
      const currentStep = req.steps.find((s) => s.stepOrder === req.currentStep);
      return currentStep && (currentStep.approverId === userId || currentStep.delegatedTo === userId);
    });
  }

  async escalateRequest(requestId: string, reason?: string) {
    const request = await this.prisma.client.approvalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'pending') {
      throw new BadRequestException(`Cannot escalate a ${request.status} request`);
    }

    const updated = await this.prisma.client.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'escalated', resolvedAt: new Date(), resolution: 'escalated' },
      include: { steps: true },
    });

    this.emitEvent(request.businessId, 'approval.escalated', updated, { reason });
    return updated;
  }

  async checkApprovalStatus(
    businessId: string,
    requestType: string,
    subjectKey: string,
    subjectValue: string,
  ) {
    const requests = await this.prisma.client.approvalRequest.findMany({
      where: {
        businessId,
        requestType,
        payload: { path: [subjectKey], equals: subjectValue },
      },
      select: { id: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const pending = requests.find((r) => r.status === 'pending');
    const approved = requests.find((r) => r.status === 'approved');

    return {
      required: false,
      hasPending: !!pending,
      hasApproved: !!approved,
      requestId: pending?.id ?? approved?.id,
    };
  }

  private extractAmount(payload?: Record<string, unknown>): number | undefined {
    if (!payload) return undefined;
    const amount = payload.amount ?? payload.total ?? payload.value ?? payload.threshold;
    if (typeof amount === 'number') return amount;
    if (typeof amount === 'string') {
      const parsed = parseFloat(amount);
      if (!isNaN(parsed)) return parsed;
    }
    return undefined;
  }

  private emitEvent(
    businessId: string,
    eventType: string,
    request: any,
    extra?: Record<string, unknown>,
  ) {
    this.emitter.emit(eventType, {
      businessId,
      approvalRequestId: request.id,
      requestType: request.requestType,
      status: request.status,
      title: request.title,
      ...extra,
    });
  }

  /**
   * Shadow-migrate a legacy ApprovalRequest into a canonical KeyActionProposal.
   * This keeps the legacy table functional while ensuring every approval is
   * visible in the unified governance ledger.
   */
  private async shadowMigrateToProposal(
    request: any,
    input: CreateApprovalRequestInput,
  ): Promise<void> {
    if (!this.proposalOrchestrator) return;

    try {
      const proposal = await this.proposalOrchestrator.propose({
        businessId: input.businessId,
        userId: input.requesterId,
        sourceType: 'HUMAN_WORKFLOW',
        sourceId: request.id,
        actionType: 'REQUEST_APPROVAL',
        title: input.title,
        description: input.description,
        summary: input.description,
        parameters: input.payload,
        affectedEntities: { requestType: input.requestType, steps: input.steps },
      });

      await this.prisma.client.approvalRequest.update({
        where: { id: request.id },
        data: { migratedToProposalId: proposal.id },
      });

      request.migratedToProposalId = proposal.id;
    } catch (err: unknown) {
      this.logger.warn(
        `Shadow migration of ApprovalRequest ${request.id} to KeyActionProposal failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
