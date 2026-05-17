import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface Alert {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  entityId?: string;
  entityType?: string;
  businessId: string;
  createdAt: Date;
}

export interface Digest {
  businessId: string;
  generatedAt: Date;
  alerts: Alert[];
  stats: {
    overdueTasks: number;
    stuckContentRequests: number;
    pendingApprovals: number;
    unconfirmedBookings: number;
    callsToday: number;
    evidenceMissing: number;
  };
  recommendations: string[];
}

@Injectable()
export class KeyMonitorService {
  private readonly logger = new Logger(KeyMonitorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async checkOverdueTasks(businessId: string): Promise<Alert[]> {
    const now = new Date();
    const tasks = await this.prisma.client.contactTask.findMany({
      where: {
        businessId,
        status: { not: 'COMPLETED' },
        deletedAt: null,
        dueDate: { lt: now },
      },
      take: 50,
      select: { id: true, title: true, dueDate: true, priority: true },
    });

    return tasks.map((task) => ({
      id: `overdue_task_${task.id}`,
      type: 'overdue_task',
      severity: task.priority === 'HIGH' || task.priority === 'URGENT' ? 'critical' : 'warning',
      message: `Overdue task: "${task.title}" (due ${task.dueDate?.toISOString().split('T')[0]})`,
      entityId: task.id,
      entityType: 'ContactTask',
      businessId,
      createdAt: new Date(),
    }));
  }

  async checkStuckContentRequests(businessId: string): Promise<Alert[]> {
    const stuckStatuses = ['draft', 'submitted', 'assigned', 'in_production', 'internal_review', 'user_review'];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const requests = await this.prisma.client.contentRequest.findMany({
      where: {
        businessId,
        status: { in: stuckStatuses },
        updatedAt: { lt: sevenDaysAgo },
      },
      take: 20,
      select: { id: true, businessGoal: true, status: true, updatedAt: true, priority: true },
    });

    return requests.map((req) => ({
      id: `stuck_content_${req.id}`,
      type: 'stuck_content_request',
      severity: req.priority === 'urgent' ? 'critical' : 'warning',
      message: `Content request "${req.businessGoal}" stuck in "${req.status}" for 7+ days`,
      entityId: req.id,
      entityType: 'ContentRequest',
      businessId,
      createdAt: new Date(),
    }));
  }

  async checkPendingApprovals(businessId: string): Promise<Alert[]> {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const approvals = await this.prisma.client.approvalRequest.findMany({
      where: {
        businessId,
        status: 'pending',
        createdAt: { lt: threeDaysAgo },
      },
      take: 20,
      select: { id: true, title: true, createdAt: true },
    });

    return approvals.map((app) => ({
      id: `pending_approval_${app.id}`,
      type: 'pending_approval',
      severity: 'warning',
      message: `Approval "${app.title}" pending for 3+ days`,
      entityId: app.id,
      entityType: 'ApprovalRequest',
      businessId,
      createdAt: new Date(),
    }));
  }

  async checkUnconfirmedBookings(businessId: string): Promise<Alert[]> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        status: { in: ['PENDING', 'UNCONFIRMED'] },
        startTime: { gte: now, lte: tomorrow },
      },
      take: 20,
      select: { id: true, startTime: true, contactId: true },
    });

    return bookings.map((bk) => ({
      id: `unconfirmed_booking_${bk.id}`,
      type: 'unconfirmed_booking',
      severity: 'warning',
      message: `Booking tomorrow at ${bk.startTime?.toISOString()} is not confirmed`,
      entityId: bk.id,
      entityType: 'Booking',
      businessId,
      createdAt: new Date(),
    }));
  }

  async checkEvidenceMissing(businessId: string): Promise<Alert[]> {
    const tasks = await this.prisma.client.contactTask.findMany({
      where: {
        businessId,
        evidenceRequired: true,
        status: { not: 'COMPLETED' },
        deletedAt: null,
      },
      take: 20,
      select: { id: true, title: true },
    });

    const alerts: Alert[] = [];
    for (const task of tasks) {
      const evidence = await this.prisma.client.evidence.findMany({
        where: { linkedType: 'ContactTask', linkedId: task.id },
        take: 1,
      });
      if (evidence.length === 0) {
        alerts.push({
          id: `missing_evidence_${task.id}`,
          type: 'missing_evidence',
          severity: 'warning',
          message: `Task "${task.title}" requires evidence but has none attached`,
          entityId: task.id,
          entityType: 'ContactTask',
          businessId,
          createdAt: new Date(),
        });
      }
    }
    return alerts;
  }

  async checkCallsWithoutOutcome(businessId: string): Promise<Alert[]> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const calls = await this.prisma.client.callLog.findMany({
      where: {
        businessId,
        scheduledAt: { gte: yesterday },
        completedAt: { not: null },
        outcome: null,
      },
      take: 20,
      select: { id: true, contactId: true, scheduledAt: true },
    });

    return calls.map((call) => ({
      id: `call_no_outcome_${call.id}`,
      type: 'call_without_outcome',
      severity: 'info',
      message: `Call completed but no outcome logged`,
      entityId: call.id,
      entityType: 'CallLog',
      businessId,
      createdAt: new Date(),
    }));
  }

  async generateDailyDigest(businessId: string): Promise<Digest> {
    const [overdueTasks, stuckContent, pendingApprovals, unconfirmedBookings, evidenceMissing, callsWithoutOutcome] =
      await Promise.all([
        this.checkOverdueTasks(businessId),
        this.checkStuckContentRequests(businessId),
        this.checkPendingApprovals(businessId),
        this.checkUnconfirmedBookings(businessId),
        this.checkEvidenceMissing(businessId),
        this.checkCallsWithoutOutcome(businessId),
      ]);

    const allAlerts = [
      ...overdueTasks,
      ...stuckContent,
      ...pendingApprovals,
      ...unconfirmedBookings,
      ...evidenceMissing,
      ...callsWithoutOutcome,
    ];

    // Sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    allAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const stats = {
      overdueTasks: overdueTasks.length,
      stuckContentRequests: stuckContent.length,
      pendingApprovals: pendingApprovals.length,
      unconfirmedBookings: unconfirmedBookings.length,
      callsToday: callsWithoutOutcome.length,
      evidenceMissing: evidenceMissing.length,
    };

    const recommendations = this.generateRecommendations(stats, allAlerts);

    return {
      businessId,
      generatedAt: new Date(),
      alerts: allAlerts.slice(0, 20),
      stats,
      recommendations,
    };
  }

  private generateRecommendations(stats: Digest['stats'], alerts: Alert[]): string[] {
    const recs: string[] = [];

    if (stats.overdueTasks > 0) {
      recs.push(`Reassign or complete ${stats.overdueTasks} overdue task(s)`);
    }
    if (stats.stuckContentRequests > 0) {
      recs.push(`Review ${stats.stuckContentRequests} stuck content request(s) in the pipeline`);
    }
    if (stats.pendingApprovals > 0) {
      recs.push(`Follow up on ${stats.pendingApprovals} pending approval(s)`);
    }
    if (stats.unconfirmedBookings > 0) {
      recs.push(`Confirm ${stats.unconfirmedBookings} booking(s) for tomorrow`);
    }
    if (stats.evidenceMissing > 0) {
      recs.push(`Attach evidence to ${stats.evidenceMissing} task(s) requiring proof`);
    }
    if (stats.callsToday > 0) {
      recs.push(`Log outcomes for ${stats.callsToday} completed call(s)`);
    }
    if (recs.length === 0) {
      recs.push('All systems green — no immediate action required');
    }

    return recs;
  }
}
