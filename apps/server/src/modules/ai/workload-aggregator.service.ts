import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface WorkloadEntry {
  userId: string;
  userName: string;
  role: string;
  totalAssignedHours: number;
  calendarHours: number;
  capacityHours: number;
  utilizationPercent: number;
  openTaskCount: number;
  pendingApprovalCount: number;
  contentRequestHours: number;
  skills: string[];
}

export interface WorkloadReport {
  businessId: string;
  generatedAt: Date;
  entries: WorkloadEntry[];
  overloaded: WorkloadEntry[];
  underutilized: WorkloadEntry[];
  totalCapacityHours: number;
  totalAssignedHours: number;
}

/**
 * WorkloadAggregator computes per-person load across ALL work modules
 * — tasks, content requests, approvals, and calendar events — to enable
 * L4 Manager capacity detection and rebalancing.
 */
@Injectable()
export class WorkloadAggregatorService {
  private readonly logger = new Logger(WorkloadAggregatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWorkloadForBusiness(businessId: string): Promise<WorkloadReport> {
    const users = await this.prisma.client.membership.findMany({
      where: { businessId },
      include: {
        user: { select: { id: true, name: true, firstName: true, lastName: true } },
        skills: { select: { name: true } },
      },
    });

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const entries: WorkloadEntry[] = [];

    for (const membership of users) {
      const userId = membership.userId;
      const userName = membership.user.name
        || `${membership.user.firstName ?? ''} ${membership.user.lastName ?? ''}`.trim()
        || userId;

      // 1. Open task assignments (ContactTask + ProjectTask)
      const taskAssignments = await this.prisma.client.taskAssignment.findMany({
        where: {
          assignableType: 'User',
          assignableId: userId,
          unassignedAt: null,
        },
        select: { taskType: true, taskId: true },
      });

      const contactTaskIds = taskAssignments.filter((t) => t.taskType === 'ContactTask').map((t) => t.taskId);
      const projectTaskIds = taskAssignments.filter((t) => t.taskType === 'ProjectTask').map((t) => t.taskId);

      const contactTasks = contactTaskIds.length > 0
        ? await this.prisma.client.contactTask.findMany({
            where: { id: { in: contactTaskIds }, status: { not: 'COMPLETED' } },
            select: { id: true },
          })
        : [];

      const projectTasks = projectTaskIds.length > 0
        ? await this.prisma.client.projectTask.findMany({
            where: { id: { in: projectTaskIds }, isCompleted: false },
            select: { id: true, estimatedHours: true, trackedHours: true },
          })
        : [];

      const openTaskCount = contactTasks.length + projectTasks.length;
      let taskHours = 0;
      for (const pt of projectTasks) {
        taskHours += Math.max(0, (pt.estimatedHours ?? 0) - (pt.trackedHours ?? 0));
      }
      // Estimate 0.5h per open contact task
      taskHours += contactTasks.length * 0.5;

      // 2. Content requests assigned to this user
      const contentRequests = await this.prisma.client.contentRequest.findMany({
        where: {
          businessId,
          assignedTeamMemberIds: { has: userId },
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
        select: { estimatedHours: true },
      });
      const contentRequestHours = contentRequests.reduce((sum, cr) => sum + (cr.estimatedHours ?? 0), 0);

      // 3. Pending approvals where user is current approver
      const pendingApprovals = await this.prisma.client.approvalRequest.findMany({
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
        select: { id: true },
      });
      const pendingApprovalCount = pendingApprovals.length;
      // Approximate 0.5 hours per approval review
      const approvalHours = pendingApprovalCount * 0.5;

      // 4. Calendar events this week
      const calendarEvents = await this.prisma.client.calendarEvent.findMany({
        where: {
          businessId,
          startAt: { gte: weekStart, lt: weekEnd },
        },
        select: { startAt: true, endAt: true },
      });
      const calendarHours = calendarEvents.reduce((sum, ev) => {
        const end = ev.endAt ?? new Date(ev.startAt.getTime() + 60 * 60 * 1000);
        const duration = end.getTime() - ev.startAt.getTime();
        return sum + duration / (1000 * 60 * 60);
      }, 0);

      // 5. Capacity
      const capacityHours = (membership.dailyCapacityHours ?? 8) * 5; // per week
      const totalAssignedHours = taskHours + contentRequestHours + approvalHours;
      const utilizationPercent = capacityHours > 0 ? Math.round((totalAssignedHours / capacityHours) * 100) : 0;

      entries.push({
        userId,
        userName,
        role: membership.role,
        totalAssignedHours: Math.round(totalAssignedHours * 10) / 10,
        calendarHours: Math.round(calendarHours * 10) / 10,
        capacityHours: Math.round(capacityHours * 10) / 10,
        utilizationPercent,
        openTaskCount,
        pendingApprovalCount,
        contentRequestHours: Math.round(contentRequestHours * 10) / 10,
        skills: membership.skills.map((s) => s.name),
      });
    }

    const overloaded = entries.filter((e) => e.utilizationPercent > 100);
    const underutilized = entries.filter((e) => e.utilizationPercent < 50 && e.capacityHours > 0);

    return {
      businessId,
      generatedAt: now,
      entries,
      overloaded,
      underutilized,
      totalCapacityHours: entries.reduce((s, e) => s + e.capacityHours, 0),
      totalAssignedHours: entries.reduce((s, e) => s + e.totalAssignedHours, 0),
    };
  }

  async getWorkloadForUser(businessId: string, userId: string): Promise<WorkloadEntry | null> {
    const report = await this.getWorkloadForBusiness(businessId);
    return report.entries.find((e) => e.userId === userId) ?? null;
  }
}
