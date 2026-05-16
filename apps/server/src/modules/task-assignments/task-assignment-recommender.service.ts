import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface AssignmentRecommendation {
  assignableType: string;
  assignableId: string;
  name: string;
  score: number;
  reason: string;
}

@Injectable()
export class TaskAssignmentRecommenderService {
  private readonly logger = new Logger(TaskAssignmentRecommenderService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recommend(
    businessId: string,
    input: { taskType: string; taskId?: string; taskTitle?: string },
  ): Promise<{ recommendations: AssignmentRecommendation[] }> {
    const candidates = await this.getCandidates(businessId);
    if (candidates.length === 0) {
      return { recommendations: [] };
    }

    const scores = await Promise.all(
      candidates.map(async (c) => {
        const workload = await this.workloadScore(c.assignableType, c.assignableId, businessId);
        const velocity = await this.velocityScore(c.assignableType, c.assignableId, businessId);
        const skill = input.taskTitle
          ? await this.skillScore(c.assignableType, c.assignableId, input.taskTitle, businessId)
          : 50;
        const availability = Math.max(0, 100 - workload * 10); // penalize heavily above 10 tasks

        const composite = Math.round(
          availability * 0.35 + velocity * 0.30 + skill * 0.25 + (100 - workload * 5) * 0.10,
        );

        const reasons: string[] = [];
        if (workload === 0) reasons.push('no open tasks');
        else if (workload <= 3) reasons.push('light workload');
        else reasons.push(`${workload} open tasks`);
        if (velocity > 70) reasons.push('high completion rate');
        if (skill > 60) reasons.push('skill match');

        return {
          assignableType: c.assignableType,
          assignableId: c.assignableId,
          name: c.name,
          score: Math.min(100, Math.max(0, composite)),
          reason: reasons.join(', '),
        };
      }),
    );

    const sorted = scores.sort((a, b) => b.score - a.score).slice(0, 5);
    return { recommendations: sorted };
  }

  private async getCandidates(businessId: string) {
    const [users, staff] = await Promise.all([
      this.prisma.client.user.findMany({
        where: { businesses: { some: { businessId } } },
        select: { id: true, name: true, email: true },
        take: 100,
      }),
      this.prisma.client.staffMember.findMany({
        where: { businessId },
        select: { id: true, name: true },
        take: 100,
      }),
    ]);

    return [
      ...users.map((u) => ({
        assignableType: 'User',
        assignableId: u.id,
        name: u.name ?? u.email ?? u.id,
      })),
      ...staff.map((s) => ({
        assignableType: 'StaffMember',
        assignableId: s.id,
        name: s.name,
      })),
    ];
  }

  private async workloadScore(assignableType: string, assignableId: string, _businessId: string): Promise<number> {
    const assignments = await this.prisma.client.taskAssignment.findMany({
      where: { assignableType, assignableId, unassignedAt: null },
      select: { taskType: true, taskId: true },
    });

    const contactTaskIds = assignments.filter((a) => a.taskType === 'ContactTask').map((a) => a.taskId);
    const projectTaskIds = assignments.filter((a) => a.taskType === 'ProjectTask').map((a) => a.taskId);

    const [openContacts, openProjects] = await Promise.all([
      contactTaskIds.length > 0
        ? this.prisma.client.contactTask.count({
            where: { id: { in: contactTaskIds }, status: { not: 'DONE' } },
          })
        : 0,
      projectTaskIds.length > 0
        ? this.prisma.client.projectTask.count({
            where: { id: { in: projectTaskIds }, isCompleted: false },
          })
        : 0,
    ]);

    return openContacts + openProjects;
  }

  private async velocityScore(assignableType: string, assignableId: string, _businessId: string): Promise<number> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [assignedAll, completedCount] = await Promise.all([
      this.prisma.client.taskAssignment.count({
        where: { assignableType, assignableId, assignedAt: { gte: since } },
      }),
      this.prisma.client.taskAssignment.count({
        where: {
          assignableType,
          assignableId,
          taskType: 'ContactTask',
          assignedAt: { gte: since },
        },
      }).then(async (count) => {
        if (count === 0) return 0;
        const assignments = await this.prisma.client.taskAssignment.findMany({
          where: { assignableType, assignableId, taskType: 'ContactTask', assignedAt: { gte: since } },
          select: { taskId: true },
          take: 200,
        });
        const taskIds = assignments.map((a) => a.taskId);
        if (taskIds.length === 0) return 0;
        return this.prisma.client.contactTask.count({
          where: { id: { in: taskIds }, status: 'DONE', completedAt: { gte: since } },
        });
      }),
    ]);

    if (assignedAll === 0) return 50; // neutral
    return Math.round((completedCount / assignedAll) * 100);
  }

  private async skillScore(
    assignableType: string,
    assignableId: string,
    taskTitle: string,
    _businessId: string,
  ): Promise<number> {
    const taskWords = this.tokenize(taskTitle);
    if (taskWords.length === 0) return 50;

    const assignments = await this.prisma.client.taskAssignment.findMany({
      where: { assignableType, assignableId, taskType: 'ContactTask' },
      select: { taskId: true },
      take: 50,
      orderBy: { assignedAt: 'desc' },
    });

    if (assignments.length === 0) return 50;

    const taskIds = assignments.map((a) => a.taskId);
    const tasks = await this.prisma.client.contactTask.findMany({
      where: { id: { in: taskIds }, status: 'DONE' },
      select: { title: true },
      take: 50,
    });

    if (tasks.length === 0) return 50;

    let totalOverlap = 0;
    for (const t of tasks) {
      const histWords = this.tokenize(t.title ?? '');
      const overlap = taskWords.filter((w) => histWords.includes(w)).length;
      totalOverlap += overlap / Math.max(taskWords.length, histWords.length);
    }

    return Math.round((totalOverlap / tasks.length) * 100);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .filter((w) => !this.stopWords.has(w));
  }

  private stopWords = new Set([
    'the', 'and', 'for', 'with', 'you', 'that', 'this', 'from', 'have', 'has', 'had',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'must',
    'about', 'into', 'over', 'after', 'before', 'during', 'under', 'above',
    'call', 'send', 'follow', 'up', 'task', 'contact', 'client',
  ]);
}
