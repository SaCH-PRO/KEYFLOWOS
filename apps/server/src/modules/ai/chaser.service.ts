import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ChaseNotice {
  type: 'overdue_task' | 'pending_approval' | 'stalled_content' | 'missing_evidence' | 'unlogged_call';
  businessId: string;
  recipientUserId: string;
  message: string;
  entityId: string;
  entityType: string;
  actionLink?: string;
}

/**
 * ChaserService sends automated nudges for overdue items.
 * Runs daily (8am business timezone) or on demand.
 */
@Injectable()
export class ChaserService {
  private readonly logger = new Logger(ChaserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async chaseBusiness(businessId: string): Promise<ChaseNotice[]> {
    const notices: ChaseNotice[] = [];
    const now = new Date();

    // 1. Overdue tasks (ContactTask + ProjectTask)
    const overdueContactTasks = await this.prisma.client.contactTask.findMany({
      where: {
        businessId,
        status: { not: 'COMPLETED' },
        dueDate: { lt: now },
        deletedAt: null,
      },
      select: { id: true, title: true, dueDate: true },
    });

    for (const task of overdueContactTasks) {
      const assignments = await this.prisma.client.taskAssignment.findMany({
        where: { taskType: 'ContactTask', taskId: task.id, unassignedAt: null },
        select: { assignableId: true },
      });
      for (const a of assignments) {
        notices.push({
          type: 'overdue_task',
          businessId,
          recipientUserId: a.assignableId,
          message: `Task "${task.title}" is overdue (due ${task.dueDate?.toLocaleDateString() ?? 'unknown'})`,
          entityId: task.id,
          entityType: 'ContactTask',
          actionLink: `/app/tasks`,
        });
      }
    }

    const overdueProjectTasks = await this.prisma.client.projectTask.findMany({
      where: {
        businessId,
        isCompleted: false,
        dueDate: { lt: now },
        deletedAt: null,
      },
      select: { id: true, title: true, dueDate: true },
    });

    for (const task of overdueProjectTasks) {
      const assignments = await this.prisma.client.taskAssignment.findMany({
        where: { taskType: 'ProjectTask', taskId: task.id, unassignedAt: null },
        select: { assignableId: true },
      });
      for (const a of assignments) {
        notices.push({
          type: 'overdue_task',
          businessId,
          recipientUserId: a.assignableId,
          message: `Project task "${task.title}" is overdue (due ${task.dueDate?.toLocaleDateString() ?? 'unknown'})`,
          entityId: task.id,
          entityType: 'ProjectTask',
          actionLink: `/app/projects`,
        });
      }
    }

    // 2. Pending approvals >24h
    const approvalCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const pendingApprovals = await this.prisma.client.approvalRequest.findMany({
      where: { businessId, status: 'pending', createdAt: { lt: approvalCutoff } },
      include: { steps: true },
    });

    for (const ar of pendingApprovals) {
      const currentStep = ar.steps.find((s) => s.stepOrder === ar.currentStep);
      if (currentStep?.approverId) {
        notices.push({
          type: 'pending_approval',
          businessId,
          recipientUserId: currentStep.approverId,
          message: `Approval "${ar.title}" has been pending for >24h — your decision is needed`,
          entityId: ar.id,
          entityType: 'ApprovalRequest',
          actionLink: `/app/approvals`,
        });
      }
    }

    // 3. Stalled content requests (>3 days)
    const contentCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const stalledContent = await this.prisma.client.contentRequest.findMany({
      where: {
        businessId,
        status: { notIn: ['DELIVERED', 'CANCELLED', 'DRAFT'] },
        updatedAt: { lt: contentCutoff },
      },
      select: { id: true, businessGoal: true, status: true, assignedTeamMemberIds: true },
    });

    for (const cr of stalledContent) {
      for (const userId of cr.assignedTeamMemberIds) {
        notices.push({
          type: 'stalled_content',
          businessId,
          recipientUserId: userId,
          message: `Content "${cr.businessGoal}" has been stuck in ${cr.status} for 3+ days`,
          entityId: cr.id,
          entityType: 'ContentRequest',
          actionLink: `/app/content-ops`,
        });
      }
    }

    // 4. Missing evidence on due tasks
    const tasksNeedingEvidence = await this.prisma.client.projectTask.findMany({
      where: { businessId, isCompleted: false, evidenceRequired: true, deletedAt: null },
      select: { id: true, title: true },
    });

    for (const task of tasksNeedingEvidence) {
      const evidenceCount = await this.prisma.client.evidence.count({
        where: { linkedType: 'ProjectTask', linkedId: task.id },
      });
      if (evidenceCount === 0) {
        const assignments = await this.prisma.client.taskAssignment.findMany({
          where: { taskType: 'ProjectTask', taskId: task.id, unassignedAt: null },
          select: { assignableId: true },
        });
        for (const a of assignments) {
          notices.push({
            type: 'missing_evidence',
            businessId,
            recipientUserId: a.assignableId,
            message: `Project task "${task.title}" requires evidence — please submit`,
            entityId: task.id,
            entityType: 'ProjectTask',
            actionLink: `/app/evidence`,
          });
        }
      }
    }

    // 5. Unlogged call outcomes (>24h after scheduled)
    const callCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const unloggedCalls = await this.prisma.client.callLog.findMany({
      where: {
        businessId,
        completedAt: null,
        scheduledAt: { lt: callCutoff },
      },
      select: { id: true, callerId: true },
    });

    for (const call of unloggedCalls) {
      notices.push({
        type: 'unlogged_call',
        businessId,
        recipientUserId: call.callerId,
        message: `Call scheduled >24h ago still needs outcome logged`,
        entityId: call.id,
        entityType: 'CallLog',
        actionLink: `/app/call-tasks`,
      });
    }

    // Emit events for each notice
    for (const notice of notices) {
      this.events.emit('manager.chase_notice', notice);
    }

    return notices;
  }
}
