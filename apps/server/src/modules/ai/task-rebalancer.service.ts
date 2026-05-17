import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WorkloadAggregatorService } from './workload-aggregator.service';
import { TaskAssignmentService } from '../task-assignments/task-assignment.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface RebalanceResult {
  success: boolean;
  transfers: Array<{
    taskType: string;
    taskId: string;
    fromUserId: string;
    toUserId: string;
    reason: string;
  }>;
  errors: string[];
}

/**
 * TaskRebalancer redistributes work when staff are overloaded.
 * Finds underutilized staff with matching skills and transfers assignments.
 */
@Injectable()
export class TaskRebalancerService {
  private readonly logger = new Logger(TaskRebalancerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workload: WorkloadAggregatorService,
    private readonly taskAssignment: TaskAssignmentService,
    private readonly events: EventEmitter2,
  ) {}

  async rebalanceBusiness(businessId: string): Promise<RebalanceResult> {
    const report = await this.workload.getWorkloadForBusiness(businessId);
    const transfers: RebalanceResult['transfers'] = [];
    const errors: string[] = [];

    for (const overloaded of report.overloaded) {
      // Find candidates with capacity
      const candidates = report.entries
        .filter((e) => e.userId !== overloaded.userId && e.utilizationPercent < 70 && e.capacityHours > 0)
        .sort((a, b) => a.utilizationPercent - b.utilizationPercent);

      if (candidates.length === 0) {
        this.logger.warn(`No rebalancing candidates for overloaded user ${overloaded.userId}`);
        continue;
      }

      // Get open assignments for overloaded user
      const assignments = await this.prisma.client.taskAssignment.findMany({
        where: {
          assignableType: 'User',
          assignableId: overloaded.userId,
          unassignedAt: null,
        },
        select: { taskType: true, taskId: true },
      });

      for (const assignment of assignments) {
        const bestCandidate = candidates.find((c) => c.utilizationPercent < 80);
        if (!bestCandidate) break;

        try {
          await this.taskAssignment.unassign({
            taskType: assignment.taskType as any,
            taskId: assignment.taskId,
            assignableType: 'User',
            assignableId: overloaded.userId,
            reason: 'Rebalanced by KEY Manager',
          });

          await this.taskAssignment.assign({
            taskType: assignment.taskType as any,
            taskId: assignment.taskId,
            assignableType: 'User',
            assignableId: bestCandidate.userId,
            assignedBy: 'key_ai',
            reason: 'Rebalanced by KEY Manager',
          });

          transfers.push({
            taskType: assignment.taskType,
            taskId: assignment.taskId,
            fromUserId: overloaded.userId,
            toUserId: bestCandidate.userId,
            reason: `${overloaded.userName} overloaded (${overloaded.utilizationPercent}%) → ${bestCandidate.userName} at ${bestCandidate.utilizationPercent}%`,
          });

          bestCandidate.utilizationPercent += 10;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to transfer ${assignment.taskType}/${assignment.taskId}: ${msg}`);
        }
      }
    }

    if (transfers.length > 0) {
      this.events.emit('manager.task_rebalanced', { businessId, transfers });
    }

    return { success: errors.length === 0 || transfers.length > 0, transfers, errors };
  }
}
