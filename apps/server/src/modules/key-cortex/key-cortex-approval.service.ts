import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import type { KeyActionProposalData } from '../key-autonomy/key-action-proposal.types';

export interface KeyCortexApprovalRequest {
  id: string;
  businessId: string;
  requesterId?: string | null;
  actionType: string;
  actionModule: string;
  description?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'expired' | 'escalated';
  createdAt: Date;
  expiresAt?: Date | null;
  actionDescription: string;
}

/**
 * KeyCortexApprovalService — adapter over the canonical KeyActionProposal system.
 *
 * This service preserves the legacy approval API used by the KEY Cortex gateway
 * and the legacy action facade, but it now persists approvals as
 * `KeyActionProposal` rows and routes execution through the autonomy executor.
 */
@Injectable()
export class KeyCortexApprovalService {
  private readonly logger = new Logger(KeyCortexApprovalService.name);

  constructor(
    @Inject(KeyActionProposalService)
    private readonly proposalService: KeyActionProposalService,
  ) {}

  async createRequest(params: {
    businessId: string;
    requester: string;
    requesterId?: string;
    actionType: string;
    actionModule: string;
    description: string;
    rationale?: string;
    parameters?: Record<string, unknown>;
    estimatedImpact?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    expiresInHours?: number;
    genomeDnaSnapshot?: Record<string, unknown>;
    contextSnapshot?: Record<string, unknown>;
  }): Promise<KeyCortexApprovalRequest> {
    const payload: Record<string, unknown> = {
      originalActionType: params.actionType,
      originalModule: params.actionModule,
      parameters: params.parameters ?? {},
      estimatedImpact: params.estimatedImpact,
      evidence: params.evidence,
      genomeDnaSnapshot: params.genomeDnaSnapshot,
      contextSnapshot: params.contextSnapshot,
      requester: params.requester,
    };

    const proposal = await this.proposalService.create(
      params.businessId,
      {
        sourceType: 'KEY_CORTEX',
        sourceMode: params.actionModule,
        title: params.description || `${params.actionModule}.${params.actionType}`,
        summary: params.rationale,
        actionType: 'EXECUTE_TOOL',
        payload,
      },
      params.requesterId,
    );

    this.logger.log(
      `[Approval] ${params.requester} requests ${params.actionType} as proposal ${proposal.id}`,
    );

    return this.toApprovalRequest(proposal);
  }

  async approve(requestId: string, decidedBy: string, _note?: string): Promise<KeyCortexApprovalRequest> {
    // The requestId is now the canonical KeyActionProposal id.
    const proposal = await this.proposalService.getById(requestId).catch(() => null);
    if (!proposal) {
      throw new NotFoundException('Approval request not found');
    }
    const approved = await this.proposalService.approve(proposal.businessId, requestId, decidedBy);
    return this.toApprovalRequest(approved);
  }

  async reject(requestId: string, decidedBy: string, note?: string): Promise<KeyCortexApprovalRequest> {
    const proposal = await this.proposalService.getById(requestId).catch(() => null);
    if (!proposal) {
      throw new NotFoundException('Approval request not found');
    }
    const rejected = await this.proposalService.reject(proposal.businessId, requestId, decidedBy, note);
    return this.toApprovalRequest(rejected);
  }

  async autoApprove(requestId: string, reason: string): Promise<KeyCortexApprovalRequest> {
    const proposal = await this.proposalService.getById(requestId).catch(() => null);
    if (!proposal) {
      throw new NotFoundException('Approval request not found');
    }
    const approved = await this.proposalService.approve(
      proposal.businessId,
      requestId,
      'system_auto_approve',
    );
    this.logger.log(`[Approval] ${proposal.actionType} AUTO-APPROVED: ${reason}`);
    return this.toApprovalRequest(approved);
  }

  async escalate(requestId: string, reason: string): Promise<KeyCortexApprovalRequest> {
    const proposal = await this.proposalService.getById(requestId).catch(() => null);
    if (!proposal) {
      throw new NotFoundException('Approval request not found');
    }
    // Canonical proposals do not have an escalated status; keep it REJECTED
    // and record the escalation in the failure reason for audit.
    const rejected = await this.proposalService.reject(
      proposal.businessId,
      requestId,
      'system_escalation',
      `Escalated: ${reason}`,
    );
    this.logger.log(`[Approval] ${proposal.actionType} ESCALATED: ${reason}`);
    return {
      ...this.toApprovalRequest(rejected),
      status: 'escalated',
    };
  }

  async getPendingRequests(businessId: string): Promise<KeyCortexApprovalRequest[]> {
    const proposals = await this.proposalService.list(businessId, { status: 'PENDING' });
    return proposals.map((p) => this.toApprovalRequest(p));
  }

  async getRequests(
    businessId: string,
    status?: 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'expired' | 'escalated',
  ): Promise<KeyCortexApprovalRequest[]> {
    const proposals = await this.proposalService.list(businessId, status ? { status: status.toUpperCase() } : {});
    return proposals.map((p) => this.toApprovalRequest(p));
  }

  async getRequest(requestId: string): Promise<KeyCortexApprovalRequest | null> {
    const proposal = await this.proposalService.getById(requestId).catch(() => null);
    return proposal ? this.toApprovalRequest(proposal) : null;
  }

  async expireOldRequests(): Promise<number> {
    // Canonical proposals do not auto-expire in this adapter.
    return 0;
  }

  async getStats(businessId: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    autoApproved: number;
    expired: number;
    escalated: number;
  }> {
    const proposals = await this.proposalService.list(businessId);
    const stats = {
      total: proposals.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      autoApproved: 0,
      expired: 0,
      escalated: 0,
    };
    for (const p of proposals) {
      switch (p.status) {
        case 'PENDING':
          stats.pending++;
          break;
        case 'APPROVED':
          stats.approved++;
          break;
        case 'REJECTED':
          stats.rejected++;
          break;
        default:
          break;
      }
    }
    return stats;
  }

  async shouldRequireApproval(params: {
    businessId: string;
    actionType: string;
    actionModule: string;
    estimatedImpact?: Record<string, unknown>;
    requester: string;
  }): Promise<boolean> {
    if (params.requester === 'delegation_loop') {
      return true;
    }

    const highRiskModules = ['commerce', 'communications', 'finance'];
    if (
      params.requester === 'key_cortex' &&
      highRiskModules.includes(params.actionModule)
    ) {
      return true;
    }

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

    if (params.requester === 'user') {
      return false;
    }

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

    return true;
  }

  // Gateway-compatible aliases
  async approveAction(
    requestId: string,
    opts: { approvedBy: string; approvedAt?: Date; reason?: string },
  ): Promise<KeyCortexApprovalRequest> {
    const result = await this.approve(requestId, opts.approvedBy, opts.reason);
    return { ...result, actionDescription: result.description || requestId };
  }

  async rejectAction(
    requestId: string,
    opts: { rejectedBy: string; rejectedAt?: Date; reason?: string },
  ): Promise<KeyCortexApprovalRequest> {
    const result = await this.reject(requestId, opts.rejectedBy, opts.reason);
    return { ...result, actionDescription: result.description || requestId };
  }

  private toApprovalRequest(proposal: KeyActionProposalData): KeyCortexApprovalRequest {
    const statusMap: Record<string, KeyCortexApprovalRequest['status']> = {
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected',
      EXECUTING: 'approved',
      EXECUTED: 'approved',
      FAILED: 'rejected',
      BLOCKED: 'rejected',
      CANCELLED: 'rejected',
    };
    return {
      id: proposal.id,
      businessId: proposal.businessId,
      requesterId: proposal.userId,
      actionType: proposal.actionType,
      actionModule: proposal.sourceMode || 'key_cortex',
      description: proposal.title,
      status: statusMap[proposal.status] ?? 'pending',
      createdAt: new Date(proposal.createdAt),
      expiresAt: null,
      actionDescription: proposal.title,
    };
  }
}
