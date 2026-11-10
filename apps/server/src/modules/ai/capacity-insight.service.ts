import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WorkloadAggregatorService } from './workload-aggregator.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { contactVisibilityFilter, resolveCrmAccess } from '../crm/crm-permissions.helper';

/**
 * The call logs among `calls` whose caller may open them (W9-CALL-LOG-DEADEND, review CR-2
 * dead-end under the CR-2 ruling of V1-84 / FOLLOW3-D4-CALL-LOG-VIS). Being a call log's caller
 * grants no visibility of its contact: every call-log route answers a member 404 for a call log on
 * a contact they may not open (V1-08 rule through CallLog.contactId, CallLogService
 * getVisibleCallLog / visibleCallLogsWhere), so a prompt telling the caller to log its outcome is
 * a dead-end. The rule here is that one, for the caller instead of a session member: their CRM
 * access from resolveCrmAccess (the role read from their User row, as CallLogService.assertCaller
 * reads it for a callerId another writer chose) and contactVisibilityFilter over the call logs'
 * contacts, one contact lookup per restricted caller. A caller with the whole book (OWNER,
 * SUPER_ADMIN) keeps every call log, as the routes keep them; a call log with no contact is the
 * business's and is kept; a caller who is no longer a member opens no contact. Lives here rather
 * than in call-log.service.ts because that file is outside this packet's write set;
 * ChaserService uses it too.
 */
export async function callLogsTheirCallerMayOpen<T extends { callerId: string; contactId: string | null }>(
  prisma: PrismaService,
  businessId: string,
  calls: T[],
): Promise<T[]> {
  const contactIdsByCaller = new Map<string, string[]>();
  for (const call of calls) {
    if (!call.contactId) continue;
    const ids = contactIdsByCaller.get(call.callerId) ?? [];
    ids.push(call.contactId);
    contactIdsByCaller.set(call.callerId, ids);
  }
  const mayOpen = new Map<string, ((contactId: string) => boolean) | null>();
  for (const [callerId, contactIds] of contactIdsByCaller) {
    try {
      const access = await resolveCrmAccess(prisma, businessId, callerId);
      mayOpen.set(callerId, await contactVisibilityFilter(prisma, businessId, access, callerId, contactIds));
    } catch (err) {
      // Not a member of the business (or no such user): they open no contact here.
      if (!(err instanceof ForbiddenException)) throw err;
      mayOpen.set(callerId, () => false);
    }
  }
  return calls.filter((call) => {
    if (!call.contactId) return true;
    const canOpen = mayOpen.get(call.callerId);
    return !canOpen || canOpen(call.contactId);
  });
}

export interface CapacityAlert {
  type: 'overload' | 'bottleneck' | 'stalled_content' | 'approval_backlog' | 'missing_evidence' | 'unlogged_calls';
  severity: 'high' | 'medium' | 'low';
  businessId: string;
  message: string;
  affectedUserIds: string[];
  affectedEntityIds: string[];
  recommendedAction: string;
}

/**
 * CapacityInsightService detects operational problems every 15 minutes:
 * - Overloaded staff (>100% utilization)
 * - Bottlenecked projects (all assignees full)
 * - Stalled content requests (>3 days in same status)
 * - Approval backlog (>2 days pending)
 * - Missing evidence on due tasks
 * - Unlogged call outcomes (>24h)
 */
@Injectable()
export class CapacityInsightService {
  private readonly logger = new Logger(CapacityInsightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workload: WorkloadAggregatorService,
    private readonly events: EventEmitter2,
  ) {}

  async scanBusiness(businessId: string): Promise<CapacityAlert[]> {
    const alerts: CapacityAlert[] = [];
    const now = new Date();

    // 1. Overloaded staff
    const workload = await this.workload.getWorkloadForBusiness(businessId);
    for (const entry of workload.overloaded) {
      alerts.push({
        type: 'overload',
        severity: entry.utilizationPercent > 150 ? 'high' : 'medium',
        businessId,
        message: `${entry.userName} is at ${entry.utilizationPercent}% capacity (${entry.totalAssignedHours}h assigned / ${entry.capacityHours}h capacity)`,
        affectedUserIds: [entry.userId],
        affectedEntityIds: [],
        recommendedAction: 'Redistribute tasks to underutilized team members',
      });
      this.events.emit('manager.overload_detected', {
        businessId,
        userId: entry.userId,
        userName: entry.userName,
        utilizationPercent: entry.utilizationPercent,
        totalAssignedHours: entry.totalAssignedHours,
        capacityHours: entry.capacityHours,
      });
    }

    // 2. Bottlenecked projects — projects where ALL assignees are overloaded
    const projectTasks = await this.prisma.client.projectTask.findMany({
      where: { businessId, isCompleted: false, deletedAt: null },
      include: { project: { select: { id: true, name: true } } },
    });
    const overloadedUserIds = new Set(workload.overloaded.map((e) => e.userId));
    for (const projectId of [...new Set(projectTasks.map((pt) => pt.projectId))]) {
      const project = projectTasks.find((pt) => pt.projectId === projectId)?.project;
      if (!project) continue;
      const taskIds = projectTasks.filter((pt) => pt.projectId === projectId).map((pt) => pt.id);
      const assignments = await this.prisma.client.taskAssignment.findMany({
        where: { taskType: 'ProjectTask', taskId: { in: taskIds }, unassignedAt: null },
      });
      const assigneeIds = [...new Set(assignments.map((a) => a.assignableId))];
      if (assigneeIds.length > 0 && assigneeIds.every((id) => overloadedUserIds.has(id))) {
        alerts.push({
          type: 'bottleneck',
          severity: 'high',
          businessId,
          message: `Project "${project.name}" is bottlenecked — all assignees are overloaded`,
          affectedUserIds: assigneeIds,
          affectedEntityIds: [projectId],
          recommendedAction: 'Assign additional resources or extend deadlines',
        });
      }
    }

    // 3. Stalled content requests (>3 days in same status)
    const stalledCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const stalledContent = await this.prisma.client.contentRequest.findMany({
      where: {
        businessId,
        status: { notIn: ['DELIVERED', 'CANCELLED', 'DRAFT'] },
        updatedAt: { lt: stalledCutoff },
      },
      select: { id: true, businessGoal: true, status: true, assignedTeamMemberIds: true },
    });
    for (const cr of stalledContent) {
      alerts.push({
        type: 'stalled_content',
        severity: 'medium',
        businessId,
        message: `Content request "${cr.businessGoal}" has been in ${cr.status} for 3+ days`,
        affectedUserIds: cr.assignedTeamMemberIds,
        affectedEntityIds: [cr.id],
        recommendedAction: 'Nudge producer or reassign',
      });
    }

    // 4. Approval backlog (>2 days pending)
    const approvalCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const approvalBacklog = await this.prisma.client.approvalRequest.findMany({
      where: { businessId, status: 'pending', createdAt: { lt: approvalCutoff } },
      include: { steps: true },
    });
    for (const ar of approvalBacklog) {
      const currentStep = ar.steps.find((s) => s.stepOrder === ar.currentStep);
      alerts.push({
        type: 'approval_backlog',
        severity: 'high',
        businessId,
        message: `Approval "${ar.title}" has been pending for 2+ days`,
        affectedUserIds: currentStep ? [currentStep.approverId] : [],
        affectedEntityIds: [ar.id],
        recommendedAction: 'Remind approver or offer delegation',
      });
    }

    // 5. Missing evidence on tasks with evidenceRequired
    const tasksNeedingEvidence = await this.prisma.client.projectTask.findMany({
      where: { businessId, isCompleted: false, evidenceRequired: true, deletedAt: null },
      select: { id: true, title: true },
    });
    for (const task of tasksNeedingEvidence) {
      const evidenceCount = await this.prisma.client.evidence.count({
        where: { linkedType: 'ProjectTask', linkedId: task.id },
      });
      if (evidenceCount === 0) {
        alerts.push({
          type: 'missing_evidence',
          severity: 'medium',
          businessId,
          message: `Project task "${task.title}" requires evidence but has none submitted`,
          affectedUserIds: [],
          affectedEntityIds: [task.id],
          recommendedAction: 'Request evidence from task owner',
        });
      }
    }

    // 6. Unlogged call outcomes (>24h after scheduled time). A call log whose contact its caller
    // may not open is left out (W9-CALL-LOG-DEADEND, review CR-2): the caller cannot log it.
    const callCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const unloggedCalls = await callLogsTheirCallerMayOpen(
      this.prisma,
      businessId,
      await this.prisma.client.callLog.findMany({
        where: {
          businessId,
          completedAt: null,
          scheduledAt: { lt: callCutoff },
        },
        select: { id: true, callerId: true, contactId: true },
      }),
    );
    for (const call of unloggedCalls) {
      alerts.push({
        type: 'unlogged_calls',
        severity: 'low',
        businessId,
        message: `Call task was scheduled >24h ago but outcome not logged`,
        affectedUserIds: [call.callerId],
        affectedEntityIds: [call.id],
        recommendedAction: 'Remind caller to log outcome',
      });
    }

    // Emit events for high-severity alerts
    for (const alert of alerts.filter((a) => a.severity === 'high')) {
      this.events.emit('manager.alert_detected', alert);
    }

    return alerts;
  }
}
