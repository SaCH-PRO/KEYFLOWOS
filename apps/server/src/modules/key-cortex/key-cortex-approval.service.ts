import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ApprovalRequest, ApprovalStatus } from '@prisma/client';

/**
 * KeyCortexApprovalService — General Business Approval System
 *
 * Manages approval requests from KEY Cortex, autopilot, the delegation loop,
 * and users. Supports pending, approved, rejected, expired, auto-approved,
 * and escalated states. Every approval decision is logged as a BusinessEvent
 * for audit trail and genome signal tracking.
 *
 * Design principles:
 *   1. Any autonomous action can require approval based on risk level
 *   2. Low-risk actions are auto-approved to reduce friction
 *   3. High-risk or novel actions require human approval
 *   4. Escalation path ensures nothing gets stuck
 *   5. All decisions carry evidence and rationale
 */
@Injectable()
export class KeyCortexApprovalService {
  private readonly logger = new Logger(KeyCortexApprovalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an approval request. This is the entry point for any action
   * that requires human confirmation before execution.
   *
   * The request carries the full parameter payload so the approver can
   * see exactly what would happen. The genomeDnaSnapshot captures the
   * business DNA at the time of request for correlation analysis.
   */
  async createRequest(params: {
    businessId: string;
    requester: string;
    requesterId?: string;
    actionType: string;
    actionModule: string;
    description: string;
    rationale: string;
    parameters: Record<string, unknown>;
    estimatedImpact?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    expiresInHours?: number;
    genomeDnaSnapshot?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const expiresAt = params.expiresInHours
      ? new Date(Date.now() + params.expiresInHours * 60 * 60 * 1000)
      : null;

    const request = await (this.prisma.client as any).approvalRequest.create({
      data: {
        businessId: params.businessId,
        requester: params.requester,
        requesterId: params.requesterId,
        actionType: params.actionType,
        actionModule: params.actionModule,
        description: params.description,
        rationale: params.rationale,
        parameters: params.parameters as never,
        estimatedImpact: params.estimatedImpact as never,
        evidence: params.evidence as never,
        expiresAt,
        genomeDnaSnapshot: params.genomeDnaSnapshot as never,
        contextSnapshot: params.contextSnapshot as never,
        status: ApprovalStatus.PENDING,
      },
    });

    this.logger.log(
      `[Approval] ${params.requester} requests ${params.actionType}: ${params.description}`,
    );
    return request;
  }

  /**
   * Approve a pending request. The approver's identity and optional note
   * are recorded for audit purposes.
   */
  async approve(
    requestId: string,
    decidedBy: string,
    note?: string,
  ): Promise<ApprovalRequest> {
    const request =
      await (this.prisma.client as any).approvalRequest.findUnique({
        where: { id: requestId },
      });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalStatus.PENDING)
      throw new Error(`Request is ${request.status}`);

    const updated = await (this.prisma.client as any).approvalRequest.update({
      where: { id: requestId },
      data: {
        status: ApprovalStatus.APPROVED,
        decidedBy,
        decisionNote: note,
        decidedAt: new Date(),
      },
    });

    this.logger.log(
      `[Approval] ${request.actionType} APPROVED by ${decidedBy}`,
    );
    return updated;
  }

  /**
   * Reject a pending request. The rejection note should explain why
   * so the requester can learn and adjust.
   */
  async reject(
    requestId: string,
    decidedBy: string,
    note?: string,
  ): Promise<ApprovalRequest> {
    const request =
      await (this.prisma.client as any).approvalRequest.findUnique({
        where: { id: requestId },
      });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalStatus.PENDING)
      throw new Error(`Request is ${request.status}`);

    const updated = await (this.prisma.client as any).approvalRequest.update({
      where: { id: requestId },
      data: {
        status: ApprovalStatus.REJECTED,
        decidedBy,
        decisionNote: note,
        decidedAt: new Date(),
      },
    });

    this.logger.log(
      `[Approval] ${request.actionType} REJECTED by ${decidedBy}: ${note}`,
    );
    return updated;
  }

  /**
   * Auto-approve a request. Used for low-risk actions where the
   * confidence is high and the impact is minimal. The reason is
   * recorded for audit.
   */
  async autoApprove(
    requestId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const updated = await (this.prisma.client as any).approvalRequest.update({
      where: { id: requestId },
      data: {
        status: ApprovalStatus.AUTO_APPROVED,
        decisionNote: reason,
        decidedAt: new Date(),
      },
    });

    this.logger.log(
      `[Approval] ${updated.actionType} AUTO-APPROVED: ${reason}`,
    );
    return updated;
  }

  /**
   * Escalate a request to a higher authority. Used when the initial
   * approver doesn't have sufficient authority or when a request
   * sits pending for too long.
   */
  async escalate(
    requestId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const updated = await (this.prisma.client as any).approvalRequest.update({
      where: { id: requestId },
      data: {
        status: ApprovalStatus.ESCALATED,
        decisionNote: reason,
      },
    });

    this.logger.log(
      `[Approval] ${updated.actionType} ESCALATED: ${reason}`,
    );
    return updated;
  }

  /**
   * Get all pending requests for a business.
   * This is the primary queue that users see in their dashboard.
   */
  async getPendingRequests(businessId: string): Promise<ApprovalRequest[]> {
    return (this.prisma.client as any).approvalRequest.findMany({
      where: { businessId, status: ApprovalStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all requests for a business, optionally filtered by status.
   */
  async getRequests(
    businessId: string,
    status?: ApprovalStatus,
  ): Promise<ApprovalRequest[]> {
    const where: Record<string, unknown> = { businessId };
    if (status) where.status = status;
    return (this.prisma.client as any).approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single request by ID.
   */
  async getRequest(requestId: string): Promise<ApprovalRequest | null> {
    return (this.prisma.client as any).approvalRequest.findUnique({
      where: { id: requestId },
    });
  }

  /**
   * Expire old requests that have passed their expiration time.
   * Should be called by a scheduled job periodically.
   *
   * @returns The number of requests that were expired
   */
  async expireOldRequests(): Promise<number> {
    const result = await (this.prisma.client as any).approvalRequest.updateMany({
      where: {
        status: ApprovalStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: ApprovalStatus.EXPIRED },
    });

    if (result.count > 0) {
      this.logger.log(`[Approval] Expired ${result.count} stale requests`);
    }
    return result.count;
  }

  /**
   * Get approval statistics for a business dashboard.
   */
  async getStats(
    businessId: string,
  ): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    autoApproved: number;
    expired: number;
    escalated: number;
  }> {
    const all = await (this.prisma.client as any).approvalRequest.groupBy({
      by: ['status'],
      where: { businessId },
      _count: true,
    });

    const stats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      autoApproved: 0,
      expired: 0,
      escalated: 0,
    };

    for (const s of all) {
      const key = s.status.toLowerCase() as keyof typeof stats;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stats as any)[key] = s._count;
      stats.total += s._count;
    }

    return stats;
  }

  /**
   * Check if an action type should require approval based on
   * business settings, risk level, and the action's module.
   *
   * This is the policy engine that determines when auto-approval
   * vs human approval is required.
   */
  async shouldRequireApproval(params: {
    businessId: string;
    actionType: string;
    actionModule: string;
    estimatedImpact?: Record<string, unknown>;
    requester: string;
  }): Promise<boolean> {
    // System and delegation loop actions always require approval
    // unless explicitly configured otherwise
    if (params.requester === 'delegation_loop') {
      return true;
    }

    // KEY Cortex actions require approval for high-impact modules
    const highRiskModules = ['commerce', 'communications', 'finance'];
    if (
      params.requester === 'key_cortex' &&
      highRiskModules.includes(params.actionModule)
    ) {
      return true;
    }

    // Autopilot actions auto-approve unless they involve money
    if (params.requester === 'autopilot') {
      const financialActions = [
        'create_invoice',
        'process_refund',
        'adjust_pricing',
        'send_bulk_email',
      ];
      if (financialActions.includes(params.actionType)) {
        return true;
      }
    }

    // Default: user actions don't require approval (they are the approver)
    if (params.requester === 'user') {
      return false;
    }

    // Check estimated impact for high-risk indicators
    if (params.estimatedImpact) {
      const risk = params.estimatedImpact.risk as string | undefined;
      if (risk === 'high' || risk === 'critical') {
        return true;
      }
      const revenue = params.estimatedImpact.revenue as number | undefined;
      if (revenue && revenue > 1000) {
        return true;
      }
    }

    return true; // Default to requiring approval for safety
  }

  // Gateway-compatible aliases
  async approveAction(
    requestId: string,
    opts: { approvedBy: string; approvedAt?: Date; reason?: string },
  ): Promise<ApprovalRequest & { actionDescription: string }> {
    const result = await this.approve(requestId, opts.approvedBy, opts.reason);
    return { ...result, actionDescription: (result as any).description || requestId };
  }

  async rejectAction(
    requestId: string,
    opts: { rejectedBy: string; rejectedAt?: Date; reason?: string },
  ): Promise<ApprovalRequest & { actionDescription: string }> {
    const result = await this.reject(requestId, opts.rejectedBy, opts.reason);
    return { ...result, actionDescription: (result as any).description || requestId };
  }
}
