import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { KeyActionExecutorService } from '../key-action-executor.service';
import type { KeyActionProposalData } from '../key-action-proposal.types';
import type { Prisma } from '@prisma/client';

/**
 * UnifiedAction — the canonical shape of an action that can be queued
 * for human approval before execution by the autonomous KEY system.
 */
export interface UnifiedAction {
  actionType: string;
  payload: Record<string, unknown>;
  title: string;
  summary?: string;
  rationale?: string;
}

/**
 * ActionDispatcher — thin wrapper around KeyActionExecutorService so the
 * approval queue can execute approved actions without depending directly
 * on the proposal-service lifecycle.
 */
export interface ActionDispatcher {
  dispatch(businessId: string, action: UnifiedAction, executedBy?: string): Promise<{
    success: boolean;
    result?: Record<string, unknown>;
    error?: string;
  }>;
}

export interface ApprovalRequest {
  businessId: string;
  action: UnifiedAction;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  expiresInMinutes: number;
  requestedBy: string;
  context: string; // Human-readable description of what will happen
}

export interface ApprovalFilters {
  businessId: string;
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  limit?: number;
  offset?: number;
}

export interface ApprovalStats {
  totalPending: number;
  totalApprovedToday: number;
  totalRejectedToday: number;
  averageApprovalTimeMinutes: number;
  byRiskLevel: Record<string, number>;
}

/**
 * ApprovalQueue — persistent database-backed approval queue for KEY autonomy.
 *
 * ALL state lives in PostgreSQL.  No in-memory Maps, no ephemeral caches.
 * Survives server restarts, deploys, and crashes.
 */
@Injectable()
export class ApprovalQueue {
  private readonly logger = new Logger(ApprovalQueue.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionDispatcher: ActionDispatcher,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // 1. requestApproval — create a ticket in the database
  // ──────────────────────────────────────────────────────────────────────────
  async requestApproval(req: ApprovalRequest) {
    const expiresAt = new Date(Date.now() + req.expiresInMinutes * 60_000);

    const ticket = await this.prisma.client.approvalTicket.create({
      data: {
        businessId: req.businessId,
        actionType: req.action.actionType,
        actionPayload: req.action.payload as Prisma.InputJsonValue,
        riskLevel: req.riskLevel.toUpperCase(),
        status: 'pending',
        requestedBy: req.requestedBy,
        expiresAt,
      },
    });

    this.logger.log(
      `[ApprovalQueue] Ticket ${ticket.id} created (business=${req.businessId}, ` +
        `action=${req.action.actionType}, risk=${req.riskLevel}, expires=${expiresAt.toISOString()})`,
    );

    return ticket;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. approve — validate, mark approved, execute action via dispatcher
  // ──────────────────────────────────────────────────────────────────────────
  async approve(ticketId: string, approverId: string): Promise<void> {
    const ticket = await this.prisma.client.approvalTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException(`Approval ticket ${ticketId} not found`);
    }
    if (ticket.status !== 'pending') {
      throw new BadRequestException(
        `Ticket ${ticketId} is already ${ticket.status}`,
      );
    }
    if (new Date() > ticket.expiresAt) {
      // Auto-expire if someone tries to approve an expired ticket
      await this.prisma.client.approvalTicket.update({
        where: { id: ticketId },
        data: { status: 'expired', updatedAt: new Date() },
      });
      throw new BadRequestException(
        `Ticket ${ticketId} has expired and cannot be approved`,
      );
    }

    // Transaction: mark approved + record execution
    const approvedAt = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.approvalTicket.update({
        where: { id: ticketId },
        data: {
          status: 'approved',
          approvedBy: approverId,
          approvedAt,
        },
      });

      this.logger.log(
        `[ApprovalQueue] Ticket ${ticketId} approved by ${approverId}`,
      );

      // Execute the action via the dispatcher
      const action: UnifiedAction = {
        actionType: ticket.actionType,
        payload: (ticket.actionPayload as Record<string, unknown>) ?? {},
        title: ticket.actionType,
      };

      try {
        const outcome = await this.actionDispatcher.dispatch(
          ticket.businessId,
          action,
          approverId,
        );

        if (outcome.success) {
          await tx.approvalTicket.update({
            where: { id: ticketId },
            data: { executedAt: new Date() },
          });
          this.logger.log(
            `[ApprovalQueue] Ticket ${ticketId} action executed successfully`,
          );
        } else {
          this.logger.error(
            `[ApprovalQueue] Ticket ${ticketId} action execution failed: ${outcome.error}`,
          );
          // We still keep the ticket as "approved" — the action failure is
          // logged separately and can be retried manually if needed.
        }
      } catch (execErr: unknown) {
        const msg =
          execErr instanceof Error ? execErr.message : String(execErr);
        this.logger.error(
          `[ApprovalQueue] Ticket ${ticketId} action execution threw: ${msg}`,
        );
        // Do NOT rethrow — the approval itself succeeded; execution failure
        // is a separate concern recorded in logs.
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. reject — mark as rejected with reason
  // ──────────────────────────────────────────────────────────────────────────
  async reject(
    ticketId: string,
    rejectorId: string,
    reason?: string,
  ): Promise<void> {
    const ticket = await this.prisma.client.approvalTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException(`Approval ticket ${ticketId} not found`);
    }
    if (ticket.status !== 'pending') {
      throw new BadRequestException(
        `Ticket ${ticketId} is already ${ticket.status}`,
      );
    }

    await this.prisma.client.approvalTicket.update({
      where: { id: ticketId },
      data: {
        status: 'rejected',
        rejectedBy: rejectorId,
        rejectedReason: reason ?? null,
      },
    });

    this.logger.log(
      `[ApprovalQueue] Ticket ${ticketId} rejected by ${rejectorId}` +
        (reason ? `: ${reason}` : ''),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. getPending — query database with filters + pagination
  // ──────────────────────────────────────────────────────────────────────────
  async getPending(filters: ApprovalFilters) {
    const where: Prisma.ApprovalTicketWhereInput = {
      businessId: filters.businessId,
      status: 'pending',
    };

    if (filters.riskLevel) {
      where.riskLevel = filters.riskLevel.toUpperCase();
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = filters.offset ?? 0;

    const tickets = await this.prisma.client.approvalTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    return tickets;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. getTicket — fetch a single ticket by id
  // ──────────────────────────────────────────────────────────────────────────
  async getTicket(ticketId: string) {
    return this.prisma.client.approvalTicket.findUnique({
      where: { id: ticketId },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. expireOverdue — mark expired tickets, return count
  // ──────────────────────────────────────────────────────────────────────────
  async expireOverdue(): Promise<number> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      // Find all pending tickets that have passed their expiration
      const overdue = await tx.approvalTicket.findMany({
        where: {
          status: 'pending',
          expiresAt: { lt: new Date() },
        },
        select: { id: true },
      });

      if (overdue.length === 0) return 0;

      // Bulk update them to expired status
      const ids = overdue.map((t) => t.id);
      await tx.approvalTicket.updateMany({
        where: { id: { in: ids } },
        data: { status: 'expired' },
      });

      return overdue.length;
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. escalateOverdue — find old pending tickets and log escalation
  // ──────────────────────────────────────────────────────────────────────────
  async escalateOverdue(thresholdMinutes: number): Promise<number> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60_000);

    const oldPending = await this.prisma.client.approvalTicket.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: threshold },
        expiresAt: { gt: new Date() }, // still not expired
      },
      orderBy: { createdAt: 'asc' },
    });

    if (oldPending.length === 0) return 0;

    for (const ticket of oldPending) {
      this.logger.warn(
        `[ApprovalQueue] ESCALATION: Ticket ${ticket.id} ` +
          `(business=${ticket.businessId}, action=${ticket.actionType}) ` +
          `has been pending for >${thresholdMinutes} minutes ` +
          `(created=${ticket.createdAt.toISOString()})`,
      );
    }

    return oldPending.length;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. getStats — approval statistics for a business
  // ──────────────────────────────────────────────────────────────────────────
  async getStats(businessId: string): Promise<ApprovalStats> {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [
      totalPending,
      totalApprovedToday,
      totalRejectedToday,
      approvedTickets,
      riskLevelCounts,
    ] = await Promise.all([
      // Total pending
      this.prisma.client.approvalTicket.count({
        where: { businessId, status: 'pending' },
      }),

      // Approved today
      this.prisma.client.approvalTicket.count({
        where: {
          businessId,
          status: 'approved',
          approvedAt: { gte: startOfDay },
        },
      }),

      // Rejected today
      this.prisma.client.approvalTicket.count({
        where: {
          businessId,
          status: 'rejected',
          updatedAt: { gte: startOfDay },
        },
      }),

      // For average approval time: all approved tickets with both timestamps
      this.prisma.client.approvalTicket.findMany({
        where: {
          businessId,
          status: 'approved',
          approvedAt: { not: null },
        },
        select: { createdAt: true, approvedAt: true },
      }),

      // Count by risk level
      this.prisma.client.approvalTicket.groupBy({
        by: ['riskLevel'],
        where: { businessId },
        _count: { riskLevel: true },
      }),
    ]);

    // Calculate average approval time in minutes
    let averageApprovalTimeMinutes = 0;
    if (approvedTickets.length > 0) {
      const totalMinutes = approvedTickets.reduce((sum, t) => {
        const created = t.createdAt.getTime();
        const approved = t.approvedAt!.getTime();
        return sum + (approved - created) / 60_000;
      }, 0);
      averageApprovalTimeMinutes = Math.round(
        totalMinutes / approvedTickets.length,
      );
    }

    const byRiskLevel: Record<string, number> = {};
    for (const group of riskLevelCounts) {
      byRiskLevel[group.riskLevel] = group._count.riskLevel;
    }

    return {
      totalPending,
      totalApprovedToday,
      totalRejectedToday,
      averageApprovalTimeMinutes,
      byRiskLevel,
    };
  }
}

/**
 * Default ActionDispatcher implementation — bridges to KeyActionExecutorService.
 */
@Injectable()
export class DefaultActionDispatcher implements ActionDispatcher {
  constructor(
    private readonly executor: KeyActionExecutorService,
  ) {}

  async dispatch(
    businessId: string,
    action: UnifiedAction,
    executedBy?: string,
  ): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
    // Convert UnifiedAction to the KeyActionProposalData shape the executor expects
    const proposal = {
      id: 'approval-queue-direct',
      businessId,
      actionType: action.actionType as KeyActionProposalData['actionType'],
      payload: action.payload,
      title: action.title,
      summary: action.summary ?? null,
      rationale: action.rationale ?? null,
      evidence: [] as string[],
      riskLevel: 'MEDIUM' as const,
      status: 'APPROVED' as const,
      requiresApproval: true,
      sourceType: 'MANUAL' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies KeyActionProposalData;

    return this.executor.execute(businessId, proposal, executedBy);
  }
}
