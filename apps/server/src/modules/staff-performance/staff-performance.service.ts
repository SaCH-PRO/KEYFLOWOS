import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ScorecardMetrics {
  assignmentId: string;
  staffName: string;
  periodStart: Date;
  periodEnd: Date;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksOnTime: number;
  tasksOverdueOpen: number;
  hoursWorked: number;
  expectedHours: number;
  utilizationPct: number;
  approvalsHandled: number;
  avgApprovalResponseHours: number | null;
  overallScore: number;
}

/**
 * Staff performance tracking: computes a per-position scorecard from data the
 * business already generates — tasks (on-time completion), logged hours
 * (utilization), and approval responsiveness — then lets you persist
 * period snapshots so trends are visible over time.
 *
 * Score: 50% on-time task completion + 30% utilization + 20% approval
 * responsiveness (fast = full marks, >48h avg = 0).
 */
@Injectable()
export class StaffPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  private assignmentName(a: { contactName: string | null; contactEmail: string | null; userId: string | null } | null): string {
    if (!a) return 'Unknown';
    return a.contactName ?? a.contactEmail ?? a.userId ?? 'Staff member';
  }

  private expectedHoursFor(periodStart: Date, periodEnd: Date): number {
    let days = 0;
    const d = new Date(periodStart);
    while (d < periodEnd) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) days++;
      d.setDate(d.getDate() + 1);
    }
    return days * 8;
  }

  async computeScorecard(
    businessId: string,
    assignmentId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ScorecardMetrics> {
    const assignment = await this.prisma.client.orgAssignment.findFirst({
      where: { id: assignmentId, businessId },
    });
    if (!assignment) throw new NotFoundException('Staff assignment not found');

    // ── Tasks (membership path: tasks are assigned to the userId) ──
    let tasksAssigned = 0;
    let tasksCompleted = 0;
    let tasksOnTime = 0;
    let tasksOverdueOpen = 0;
    let hoursWorked = 0;

    if (assignment.userId) {
      const [assigned, completed, onTime, overdue, hours] = await Promise.all([
        this.prisma.client.projectTask.count({
          where: { businessId, assigneeId: assignment.userId, deletedAt: null, dueDate: { gte: periodStart, lt: periodEnd } },
        }),
        this.prisma.client.projectTask.count({
          where: { businessId, assigneeId: assignment.userId, deletedAt: null, isCompleted: true, updatedAt: { gte: periodStart, lt: periodEnd } },
        }),
        this.prisma.client.projectTask.count({
          where: {
            businessId,
            assigneeId: assignment.userId,
            deletedAt: null,
            isCompleted: true,
            dueDate: { not: null },
            updatedAt: { gte: periodStart, lt: periodEnd },
          },
        }),
        this.prisma.client.projectTask.count({
          where: { businessId, assigneeId: assignment.userId, deletedAt: null, isCompleted: false, dueDate: { lt: new Date() } },
        }),
        this.prisma.client.timeEntry.aggregate({
          where: { businessId, userId: assignment.userId, startTime: { gte: periodStart, lt: periodEnd } },
          _sum: { durationMinutes: true },
        }),
      ]);
      tasksAssigned = assigned;
      tasksCompleted = completed;
      hoursWorked = (hours._sum.durationMinutes ?? 0) / 60;

      // On-time: completed with updatedAt <= dueDate (checked row by row).
      const onTimeRows = await this.prisma.client.projectTask.findMany({
        where: {
          businessId,
          assigneeId: assignment.userId,
          deletedAt: null,
          isCompleted: true,
          dueDate: { not: null },
          updatedAt: { gte: periodStart, lt: periodEnd },
        },
        select: { dueDate: true, updatedAt: true },
      });
      tasksOnTime = onTimeRows.filter((r) => r.dueDate && r.updatedAt <= r.dueDate).length;
      tasksOverdueOpen = overdue;
    }

    // ── Approval responsiveness (position-scoped approvals) ──
    const approvals = await this.prisma.client.aiApprovalItem.findMany({
      where: {
        businessId,
        approverAssignmentId: assignmentId,
        status: { in: ['approved', 'rejected'] },
        resolvedAt: { gte: periodStart, lt: periodEnd },
      },
      select: { createdAt: true, resolvedAt: true },
    });
    const approvalsHandled = approvals.length;
    const avgApprovalResponseHours = approvalsHandled
      ? Math.round(
          (approvals.reduce((s, a) => s + ((a.resolvedAt?.getTime() ?? 0) - a.createdAt.getTime()) / 3600000, 0) /
            approvalsHandled) *
            100,
        ) / 100
      : null;

    const expectedHours = this.expectedHoursFor(periodStart, periodEnd);
    const utilizationPct = expectedHours > 0 ? Math.min(100, Math.round((hoursWorked / expectedHours) * 100)) : 0;

    const taskScore =
      tasksAssigned === 0
        ? (tasksOverdueOpen === 0 ? 100 : Math.max(0, 100 - tasksOverdueOpen * 20))
        : Math.round((tasksOnTime / tasksAssigned) * 100);
    const approvalScore =
      avgApprovalResponseHours === null ? 100 : Math.max(0, Math.round(100 - (avgApprovalResponseHours / 48) * 100));

    const overallScore = Math.round(taskScore * 0.5 + utilizationPct * 0.3 + approvalScore * 0.2);

    return {
      assignmentId,
      staffName: this.assignmentName(assignment),
      periodStart,
      periodEnd,
      tasksAssigned,
      tasksCompleted,
      tasksOnTime,
      tasksOverdueOpen,
      hoursWorked: Math.round(hoursWorked * 100) / 100,
      expectedHours,
      utilizationPct,
      approvalsHandled,
      avgApprovalResponseHours,
      overallScore,
    };
  }

  async teamSummary(businessId: string, periodStart: Date, periodEnd: Date) {
    const assignments = await this.prisma.client.orgAssignment.findMany({
      where: { businessId, endedAt: null },
      select: { id: true },
      take: 50,
    });
    const cards: ScorecardMetrics[] = [];
    for (const a of assignments) {
      cards.push(await this.computeScorecard(businessId, a.id, periodStart, periodEnd));
    }
    return cards.sort((a, b) => b.overallScore - a.overallScore);
  }

  async takeSnapshot(businessId: string, assignmentId: string, periodStart: Date, periodEnd: Date) {
    const card = await this.computeScorecard(businessId, assignmentId, periodStart, periodEnd);
    return this.prisma.client.staffPerformanceSnapshot.upsert({
      where: { businessId_assignmentId_periodStart_periodEnd: { businessId, assignmentId, periodStart, periodEnd } },
      create: {
        businessId,
        assignmentId,
        periodStart,
        periodEnd,
        tasksAssigned: card.tasksAssigned,
        tasksCompleted: card.tasksCompleted,
        tasksOnTime: card.tasksOnTime,
        tasksOverdueOpen: card.tasksOverdueOpen,
        hoursWorked: card.hoursWorked,
        expectedHours: card.expectedHours,
        approvalsHandled: card.approvalsHandled,
        avgApprovalResponseHours: card.avgApprovalResponseHours,
        overallScore: card.overallScore,
      },
      update: {
        tasksAssigned: card.tasksAssigned,
        tasksCompleted: card.tasksCompleted,
        tasksOnTime: card.tasksOnTime,
        tasksOverdueOpen: card.tasksOverdueOpen,
        hoursWorked: card.hoursWorked,
        expectedHours: card.expectedHours,
        approvalsHandled: card.approvalsHandled,
        avgApprovalResponseHours: card.avgApprovalResponseHours,
        overallScore: card.overallScore,
        computedAt: new Date(),
      },
    });
  }

  async trend(businessId: string, assignmentId: string, limit = 8) {
    const rows = await this.prisma.client.staffPerformanceSnapshot.findMany({
      where: { businessId, assignmentId },
      orderBy: { periodEnd: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      overallScore: r.overallScore,
      tasksOnTime: r.tasksOnTime,
      tasksAssigned: r.tasksAssigned,
      hoursWorked: Number(r.hoursWorked),
      utilizationPct: Number(r.expectedHours) > 0 ? Math.round((Number(r.hoursWorked) / Number(r.expectedHours)) * 100) : 0,
    }));
  }
}
