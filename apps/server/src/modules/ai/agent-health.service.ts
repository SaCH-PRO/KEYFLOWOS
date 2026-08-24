import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiExecutionLogService } from './ai-execution-log.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

export interface AgentHealthReport {
  businessId: string;
  timestamp: string;
  plans: {
    total: number;
    executing: number;
    stalled: number;
    failed: number;
    completedToday: number;
  };
  loops: {
    total: number;
    healthy: number;
    unhealthy: number;
    lastRuns: Array<{ loopId: string; loopType: string; lastRunAt: Date | null; status: string }>;
  };
  approvals: {
    pending: number;
    escalated: number;
    oldestPendingMinutes: number;
  };
  actions: {
    totalToday: number;
    failedToday: number;
    successRate: number;
  };
}

@Injectable()
export class AgentHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentHealthService.name);
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
  ) {}

  onModuleInit() {
    this.checkInterval = safeInterval('AgentHealthService', this.CHECK_MS, () => this.runHealthChecks(), this.logger);
    this.logger.log(`Agent health monitoring started every ${this.CHECK_MS}ms`);
  }

  onModuleDestroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  async runHealthChecks(): Promise<void> {
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true },
        take: 100,
      });

      for (const business of businesses) {
        await this.checkBusinessHealth(business.id);
      }
    } catch (err: any) {
      this.logger.error(`Health check run failed: ${(err as Error).message}`);
    }
  }

  async checkBusinessHealth(businessId: string): Promise<AgentHealthReport> {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const [
      planStats,
      stalledPlans,
      loopStats,
      approvalStats,
      actionStats,
    ] = await Promise.all([
      this.prisma.client.aiPlan.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true,
      }),
      this.prisma.client.aiPlan.findMany({
        where: {
          businessId,
          status: 'executing',
          updatedAt: { lt: tenMinutesAgo },
        },
        select: { id: true, objective: true, updatedAt: true },
      }),
      this.prisma.client.delegationLoop.findMany({
        where: { businessId },
        select: { id: true, loopType: true, enabled: true, lastRunAt: true },
      }),
      this.prisma.client.aiApprovalItem.groupBy({
        by: ['status'],
        where: { businessId },
        _count: true,
      }),
      this.prisma.client.aiExecutionLog.groupBy({
        by: ['success'],
        where: { businessId, createdAt: { gte: today }, actor: 'ai' },
        _count: true,
      }),
    ]);

    // Count plans by status
    const planCounts: Record<string, number> = {};
    for (const s of planStats) {
      planCounts[s.status] = s._count;
    }

    // Count approvals by status
    const approvalCounts: Record<string, number> = {};
    for (const s of approvalStats) {
      approvalCounts[s.status] = s._count;
    }

    // Count actions today
    let totalActionsToday = 0;
    let failedActionsToday = 0;
    for (const s of actionStats) {
      totalActionsToday += s._count;
      if (!s.success) failedActionsToday += s._count;
    }

    // Mark stalled plans
    for (const plan of stalledPlans) {
      await this.prisma.client.aiPlan.update({
        where: { id: plan.id },
        data: { status: 'failed' },
      });
      this.logger.warn(`Stalled plan ${plan.id} marked as failed`);
      this.events.emit('plan.stalled', { planId: plan.id, businessId, objective: plan.objective });
    }

    // Recover stuck steps (executing for >10 minutes with no completion signal)
    const stuckSteps = await this.prisma.client.aiPlanStep.findMany({
      where: {
        plan: { businessId },
        status: 'executing',
        startedAt: { lt: tenMinutesAgo },
      },
      select: { id: true, planId: true, action: true },
    });
    for (const step of stuckSteps) {
      await this.prisma.client.aiPlanStep.update({
        where: { id: step.id },
        data: { status: 'failed', errorMessage: 'Execution timeout — no completion signal received' },
      });
      this.logger.warn(`Stuck step ${step.id} (plan ${step.planId}) marked as failed`);
    }

    // Check loop health
    const loopHealth = loopStats.map((loop) => {
      const lastRun = loop.lastRunAt;
      const hoursSinceLastRun = lastRun
        ? (now.getTime() - new Date(lastRun).getTime()) / (1000 * 60 * 60)
        : Infinity;
      const isUnhealthy = loop.enabled && hoursSinceLastRun > 24;
      return {
        loopId: loop.id,
        loopType: loop.loopType,
        lastRunAt: loop.lastRunAt,
        status: isUnhealthy ? 'unhealthy' : 'healthy',
      };
    });

    const report: AgentHealthReport = {
      businessId,
      timestamp: now.toISOString(),
      plans: {
        total: planStats.reduce((sum, s) => sum + s._count, 0),
        executing: planCounts['executing'] ?? 0,
        stalled: stalledPlans.length,
        failed: planCounts['failed'] ?? 0,
        completedToday: planCounts['completed'] ?? 0,
      },
      loops: {
        total: loopStats.length,
        healthy: loopHealth.filter((l) => l.status === 'healthy').length,
        unhealthy: loopHealth.filter((l) => l.status === 'unhealthy').length,
        lastRuns: loopHealth,
      },
      approvals: {
        pending: approvalCounts['pending'] ?? 0,
        escalated: approvalCounts['escalated'] ?? 0,
        oldestPendingMinutes: 0,
      },
      actions: {
        totalToday: totalActionsToday,
        failedToday: failedActionsToday,
        successRate: totalActionsToday > 0 ? Math.round(((totalActionsToday - failedActionsToday) / totalActionsToday) * 100) : 100,
      },
    };

    return report;
  }

  async getHealthDashboard(businessId: string): Promise<AgentHealthReport> {
    return this.checkBusinessHealth(businessId);
  }
}
