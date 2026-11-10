import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WorkloadAggregatorService } from './workload-aggregator.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { contactVisibilityFilter, resolveCrmAccess } from '../crm/crm-permissions.helper';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';

/**
 * The module scope POST businesses/:businessId/calls/:callId/complete requires
 * (CallTaskController.complete, @RequireModuleScope('crm', 'write')): logging a call's outcome is
 * that route, so it is the level a caller must hold to be asked to do it.
 */
const LOG_OUTCOME_SCOPE = { module: 'crm', minLevel: 'write' } as const;

/**
 * The call logs among `calls` whose caller may log their outcome (W9-CALL-LOG-DEADEND, review CR-2
 * dead-end under the CR-2 ruling of V1-84 / FOLLOW3-D4-CALL-LOG-VIS; review repairs SEC-W9CLD-1,
 * SEC-W9CLD-2, CR-W9CLD-1, CR-W9CLD-2). ChaserService's 'unlogged_call' notice and
 * CapacityInsightService's 'unlogged_calls' alert ask the caller to log a stale call's outcome,
 * which is POST calls/:callId/complete; a prompt for a call log that route refuses its caller is a
 * dead-end. The route is answered here for the caller, gate by gate in the route's order, instead
 * of for a session member:
 *
 *   1. BusinessGuard and ModuleScopeGuard: a callerId that names no user (CallLog.callerId may
 *      hold a legacy staff-member id) or a user who is not a member of the business is refused
 *      403; a SUPER_ADMIN passes both. Every call log of such a caller is left out, contactless
 *      ones included (SEC-W9CLD-1, CR-W9CLD-1).
 *   2. ModuleScopeGuard at LOG_OUTCOME_SCOPE: the member's crm level as that guard computes it
 *      (an explicit scope map's crm key, a missing key being 'none', EXPLICIT_MAP_MISSING_KEY;
 *      otherwise the role default, defaultScopesForRole) must reach write. resolveCrmAccess reads
 *      a missing crm key as 'read' with view-all, so its answer is not this gate (SEC-W9CLD-2,
 *      CR-W9CLD-2). A member below write (crm 'none' or 'read', a map without crm, the STAFF
 *      default) is refused the outcome on every call log, contactless ones included.
 *   3. getVisibleCallLog: the V1-08 rule through CallLog.contactId. Being the caller grants no
 *      visibility of the contact (the CR-2 ruling): resolveCrmAccess (the role read from the User
 *      row, as CallLogService.assertCaller reads it for a callerId another writer chose) and
 *      contactVisibilityFilter over the caller's contacts, one contact lookup per restricted
 *      caller. A caller with the whole book (OWNER, SUPER_ADMIN) keeps every call log; a call log
 *      with no contact is the business's and is kept.
 *
 * Lives here rather than in call-log.service.ts or module-scope.guard.ts because those files are
 * outside this packet's write set; ChaserService uses it too.
 */
export async function callLogsTheirCallerMayLog<T extends { callerId: string; contactId: string | null }>(
  prisma: PrismaService,
  businessId: string,
  calls: T[],
): Promise<T[]> {
  // Every distinct caller is resolved, a caller of contactless call logs only included.
  const contactIdsByCaller = new Map<string, string[]>();
  for (const call of calls) {
    const ids = contactIdsByCaller.get(call.callerId) ?? [];
    if (call.contactId) ids.push(call.contactId);
    contactIdsByCaller.set(call.callerId, ids);
  }
  const mayLog = new Map<string, (contactId: string | null) => boolean>();
  for (const [callerId, contactIds] of contactIdsByCaller) {
    mayLog.set(callerId, await callerMayLog(prisma, businessId, callerId, contactIds));
  }
  return calls.filter((call) => mayLog.get(call.callerId)?.(call.contactId) ?? false);
}

const REFUSED = (): boolean => false;

/** Which of `callerId`'s call logs, by contact (null: contactless), they may log. See above. */
async function callerMayLog(
  prisma: PrismaService,
  businessId: string,
  callerId: string,
  contactIds: string[],
): Promise<(contactId: string | null) => boolean> {
  // 1. A user, and a member of the business unless SUPER_ADMIN.
  const user = await prisma.client.user.findUnique({ where: { id: callerId }, select: { role: true } });
  if (!user) return REFUSED;
  if (user.role !== 'SUPER_ADMIN') {
    const membership = await prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: callerId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return REFUSED;
    // 2. The crm level exactly as ModuleScopeGuard.canActivate computes it.
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    if (rankOf(scopes[LOG_OUTCOME_SCOPE.module] || 'none') < LEVEL_RANK[LOG_OUTCOME_SCOPE.minLevel]) return REFUSED;
  }
  if (contactIds.length === 0) return () => true;
  // 3. The V1-08 rule over the caller's contacts.
  let canOpen: ((contactId: string) => boolean) | null;
  try {
    const access = await resolveCrmAccess(prisma, businessId, callerId);
    canOpen = await contactVisibilityFilter(prisma, businessId, access, callerId, contactIds);
  } catch (err) {
    // The membership went between the reads: refused as in 1.
    if (!(err instanceof ForbiddenException)) throw err;
    return REFUSED;
  }
  return (contactId) => !contactId || !canOpen || canOpen(contactId);
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

    // 6. Unlogged call outcomes (>24h after scheduled time). A call log whose outcome POST
    // complete refuses its caller (not a member, crm below write, a contact they may not open) is
    // left out (W9-CALL-LOG-DEADEND, review CR-2): the caller cannot log it.
    const callCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const unloggedCalls = await callLogsTheirCallerMayLog(
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
