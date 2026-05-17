import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface PrioritizedTask {
  id: string;
  type: 'ContactTask' | 'ProjectTask' | 'ContentRequest' | 'ApprovalRequest' | 'CallLog';
  title: string;
  businessId: string;
  score: number;
  revenueImpact: number;
  deadlineProximity: number;
  dependencyScore: number;
  clientTierScore: number;
  aiConfidence: number;
  dueDate: Date | null;
  assignedTo: string[];
  recommendedAction: string;
}

/**
 * TaskPrioritizer scores every open task by weighted factors:
 * - Revenue impact (30%): linked deal value, invoice amount
 * - Deadline proximity (30%): days until due, overdue penalty
 * - Dependency criticality (20%): blocking other tasks
 * - Client tier (10%): VIP client = higher priority
 * - AI confidence (10%): pattern match to historically urgent items
 */
@Injectable()
export class TaskPrioritizerService {
  private readonly logger = new Logger(TaskPrioritizerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPrioritizedQueue(businessId: string): Promise<PrioritizedTask[]> {
    const now = new Date();
    const tasks: PrioritizedTask[] = [];

    // 1. ContactTasks
    const contactTasks = await this.prisma.client.contactTask.findMany({
      where: { businessId, status: { not: 'COMPLETED' }, deletedAt: null },
      include: { contact: { select: { id: true, status: true, lifetimeValue: true } } },
      take: 200,
    });

    for (const task of contactTasks) {
      const dueDate = task.dueDate;
      const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const revenueImpact = this.scoreRevenue(task.contact?.lifetimeValue ?? 0);
      const deadlineProximity = this.scoreDeadline(daysUntilDue);
      const clientTier = task.contact?.status === 'CLIENT' ? 1.0 : task.contact?.status === 'PROSPECT' ? 0.7 : 0.3;
      const aiConfidence = 0.5; // baseline

      const score =
        revenueImpact * 0.30 +
        deadlineProximity * 0.30 +
        0.5 * 0.20 + // no dependency data for contact tasks
        clientTier * 0.10 +
        aiConfidence * 0.10;

      tasks.push({
        id: task.id,
        type: 'ContactTask',
        title: task.title,
        businessId,
        score: Math.round(score * 100),
        revenueImpact,
        deadlineProximity,
        dependencyScore: 0.5,
        clientTierScore: clientTier,
        aiConfidence,
        dueDate,
        assignedTo: [],
        recommendedAction: daysUntilDue < 0 ? 'URGENT: overdue follow-up' : daysUntilDue <= 2 ? 'Follow up soon' : 'Standard priority',
      });
    }

    // 2. ProjectTasks
    const projectTasks = await this.prisma.client.projectTask.findMany({
      where: { businessId, isCompleted: false, deletedAt: null },
      include: {
        project: { select: { id: true, name: true, hourlyRate: true } },
      },
      take: 200,
    });

    for (const task of projectTasks) {
      const dueDate = task.dueDate;
      const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const revenueImpact = this.scoreRevenue((task.project?.hourlyRate ?? 0) * (task.estimatedHours ?? 0));
      const deadlineProximity = this.scoreDeadline(daysUntilDue);
      const dependencyScore = 0.5; // would need dependency graph
      const aiConfidence = 0.5;

      const score =
        revenueImpact * 0.30 +
        deadlineProximity * 0.30 +
        dependencyScore * 0.20 +
        0.5 * 0.10 + // no client tier for project tasks
        aiConfidence * 0.10;

      tasks.push({
        id: task.id,
        type: 'ProjectTask',
        title: task.title,
        businessId,
        score: Math.round(score * 100),
        revenueImpact,
        deadlineProximity,
        dependencyScore,
        clientTierScore: 0.5,
        aiConfidence,
        dueDate,
        assignedTo: [],
        recommendedAction: daysUntilDue < 0 ? 'URGENT: overdue project task' : 'Continue work',
      });
    }

    // 3. ContentRequests
    const contentRequests = await this.prisma.client.contentRequest.findMany({
      where: { businessId, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      take: 100,
    });

    for (const cr of contentRequests) {
      const dueDate = cr.dueDate;
      const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const revenueImpact = 0.5; // content has indirect revenue
      const deadlineProximity = this.scoreDeadline(daysUntilDue);
      const dependencyScore = cr.status === 'APPROVED' ? 0.9 : cr.status === 'IN_PRODUCTION' ? 0.7 : 0.4;
      const aiConfidence = 0.5;

      const score =
        revenueImpact * 0.30 +
        deadlineProximity * 0.30 +
        dependencyScore * 0.20 +
        0.5 * 0.10 +
        aiConfidence * 0.10;

      tasks.push({
        id: cr.id,
        type: 'ContentRequest',
        title: cr.businessGoal,
        businessId,
        score: Math.round(score * 100),
        revenueImpact,
        deadlineProximity,
        dependencyScore,
        clientTierScore: 0.5,
        aiConfidence,
        dueDate,
        assignedTo: cr.assignedTeamMemberIds,
        recommendedAction: `Content in ${cr.status} — ${daysUntilDue < 0 ? 'overdue' : daysUntilDue + ' days remaining'}`,
      });
    }

    // 4. ApprovalRequests
    const approvals = await this.prisma.client.approvalRequest.findMany({
      where: { businessId, status: 'pending' },
      include: { steps: true },
      take: 100,
    });

    for (const ar of approvals) {
      const amount = this.extractAmount(ar.payload);
      const daysOpen = Math.ceil((now.getTime() - ar.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const revenueImpact = this.scoreRevenue(amount);
      const deadlineProximity = this.scoreDeadline(-daysOpen); // negative = already open
      const dependencyScore = 0.8; // approvals block downstream work
      const aiConfidence = 0.5;

      const score =
        revenueImpact * 0.30 +
        deadlineProximity * 0.30 +
        dependencyScore * 0.20 +
        0.5 * 0.10 +
        aiConfidence * 0.10;

      const currentStep = ar.steps.find((s) => s.stepOrder === ar.currentStep);
      tasks.push({
        id: ar.id,
        type: 'ApprovalRequest',
        title: ar.title,
        businessId,
        score: Math.round(score * 100),
        revenueImpact,
        deadlineProximity,
        dependencyScore,
        clientTierScore: 0.5,
        aiConfidence,
        dueDate: null,
        assignedTo: currentStep ? [currentStep.approverId] : [],
        recommendedAction: `Approval pending for ${daysOpen} days — ${currentStep ? 'awaiting ' + currentStep.approverId : 'no active step'}`,
      });
    }

    // Sort by score descending
    return tasks.sort((a, b) => b.score - a.score);
  }

  private scoreRevenue(amount: number): number {
    if (amount >= 10000) return 1.0;
    if (amount >= 5000) return 0.9;
    if (amount >= 1000) return 0.7;
    if (amount >= 500) return 0.5;
    if (amount > 0) return 0.3;
    return 0.2;
  }

  private scoreDeadline(daysUntilDue: number): number {
    if (daysUntilDue < 0) return 1.0; // overdue
    if (daysUntilDue === 0) return 0.95; // due today
    if (daysUntilDue <= 1) return 0.85; // due tomorrow
    if (daysUntilDue <= 3) return 0.7;
    if (daysUntilDue <= 7) return 0.5;
    if (daysUntilDue <= 14) return 0.3;
    return 0.1;
  }

  private extractAmount(payload: any): number {
    if (!payload || typeof payload !== 'object') return 0;
    const keys = ['amount', 'total', 'value', 'threshold'];
    for (const key of keys) {
      const val = payload[key];
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) return parsed;
      }
    }
    return 0;
  }
}
