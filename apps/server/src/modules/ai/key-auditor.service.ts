import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface AuditResult {
  passed: boolean;
  score: number; // 0-100
  issues: AuditIssue[];
  summary: string;
}

export interface AuditIssue {
  severity: 'critical' | 'warning' | 'info';
  message: string;
  entityId?: string;
  entityType?: string;
}

@Injectable()
export class KeyAuditorService {
  private readonly logger = new Logger(KeyAuditorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async checkEvidence(taskId: string): Promise<AuditResult> {
    const task = await this.prisma.client.contactTask.findUnique({
      where: { id: taskId },
      select: { id: true, evidenceRequired: true, status: true, title: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const issues: AuditIssue[] = [];
    let score = 100;

    if (task.evidenceRequired) {
      const evidence = await this.prisma.client.evidence.findMany({
        where: { linkedType: 'ContactTask', linkedId: taskId },
      });

      if (evidence.length === 0) {
        issues.push({
          severity: 'critical',
          message: `Task "${task.title}" requires evidence but none is attached`,
          entityId: taskId,
          entityType: 'ContactTask',
        });
        score -= 50;
      } else {
        const unverified = evidence.filter((e) => !e.verifiedAt);
        if (unverified.length > 0) {
          issues.push({
            severity: 'warning',
            message: `${unverified.length} of ${evidence.length} evidence items are unverified`,
            entityId: taskId,
            entityType: 'ContactTask',
          });
          score -= 20;
        }
      }
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      summary: `Evidence audit for "${task.title}": ${issues.length === 0 ? 'All clear' : `${issues.length} issue(s) found`}`,
    };
  }

  async checkApproval(requestId: string): Promise<AuditResult> {
    const request = await this.prisma.client.approvalRequest.findUnique({
      where: { id: requestId },
      include: { steps: true },
    });

    if (!request) {
      throw new NotFoundException('Approval request not found');
    }

    const issues: AuditIssue[] = [];
    let score = 100;

    if (request.status === 'pending') {
      const pendingSteps = request.steps.filter((s) => s.status === 'pending');
      if (pendingSteps.length > 0) {
        const createdAt = request.createdAt as Date | undefined;
        const daysPending = createdAt
          ? Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        if (daysPending > 3) {
          issues.push({
            severity: 'warning',
            message: `Approval has been pending for ${daysPending} days`,
            entityId: requestId,
            entityType: 'ApprovalRequest',
          });
          score -= 25;
        }
      }
    }

    if (request.status === 'rejected') {
      issues.push({
        severity: 'critical',
        message: 'Approval was rejected and may need rework',
        entityId: requestId,
        entityType: 'ApprovalRequest',
      });
      score -= 40;
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      summary: `Approval audit for "${request.title}": ${issues.length === 0 ? 'All clear' : `${issues.length} issue(s) found`}`,
    };
  }

  async checkDriveDelivery(requestId: string): Promise<AuditResult> {
    const request = await this.prisma.client.contentRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Content request not found');
    }

    const deliveries = await this.prisma.client.contentDeliveryPackage.findMany({
      where: { contentRequestId: requestId },
    });

    const issues: AuditIssue[] = [];
    let score = 100;

    if (request.status !== 'delivered' && request.status !== 'uploaded_to_drive') {
      issues.push({
        severity: 'warning',
        message: `Content request is in "${request.status}" status, not yet delivered`,
        entityId: requestId,
        entityType: 'ContentRequest',
      });
      score -= 30;
    }

    if (deliveries.length === 0 && request.status === 'approved') {
      issues.push({
        severity: 'critical',
        message: 'Content is approved but no delivery package exists',
        entityId: requestId,
        entityType: 'ContentRequest',
      });
      score -= 50;
    }

    const incompleteDeliveries = deliveries.filter((d: any) => d.status !== 'delivered');
    if (incompleteDeliveries.length > 0) {
      issues.push({
        severity: 'warning',
        message: `${incompleteDeliveries.length} delivery package(s) not yet marked delivered`,
        entityId: requestId,
        entityType: 'ContentDeliveryPackage',
      });
      score -= 20;
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      issues,
      summary: `Drive delivery audit for "${request.businessGoal}": ${issues.length === 0 ? 'All clear' : `${issues.length} issue(s) found`}`,
    };
  }

  async runFullAudit(businessId: string): Promise<Record<string, AuditResult>> {
    const results: Record<string, AuditResult> = {};

    // Audit pending approvals
    const pendingApprovals = await this.prisma.client.approvalRequest.findMany({
      where: { businessId, status: 'pending' },
      take: 10,
    });
    for (const approval of pendingApprovals) {
      results[`approval_${approval.id}`] = await this.checkApproval(approval.id);
    }

    // Audit active content requests
    const activeContent = await this.prisma.client.contentRequest.findMany({
      where: { businessId, status: { not: 'delivered' } },
      take: 10,
    });
    for (const content of activeContent) {
      results[`content_${content.id}`] = await this.checkDriveDelivery(content.id);
    }

    // Audit tasks requiring evidence
    const tasksWithEvidence = await this.prisma.client.contactTask.findMany({
      where: { businessId, evidenceRequired: true, status: { not: 'COMPLETED' } },
      take: 10,
    });
    for (const task of tasksWithEvidence) {
      results[`task_${task.id}`] = await this.checkEvidence(task.id);
    }

    return results;
  }
}
