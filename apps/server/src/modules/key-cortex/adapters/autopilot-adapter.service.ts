import { Injectable, NotImplementedException } from '@nestjs/common';
import { AutopilotService } from '../../autopilot/autopilot.service';
import { DelegationLoopService } from '../../autopilot/delegation-loop.service';

/**
 * Typed adapter that exposes the autopilot methods expected by
 * KeyCortexConnectorService.  Delegates to AutopilotService and
 * DelegationLoopService where real implementations exist; otherwise
 * returns a typed placeholder or throws NotImplementedException.
 */
@Injectable()
export class AutopilotAdapterService {
  constructor(
    private readonly autopilot: AutopilotService,
    private readonly loops: DelegationLoopService,
  ) {}

  async getTasks(input: {
    businessId: string;
    status?: string;
    assignedTo?: string;
    limit?: number;
  }) {
    return this.autopilot.getAllTasks(input.businessId, input.status);
  }

  async createTask(input: {
    businessId: string;
    title: string;
    description?: string;
    assignedTo?: string;
    priority?: string;
    dueDate?: string;
    automationId?: string;
  }) {
    return this.autopilot.createTask({
      businessId: input.businessId,
      title: input.title,
      description: input.description,
      category: 'AI_GENERATED',
      priority: input.priority?.toUpperCase() ?? 'NORMAL',
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      relatedType: input.automationId ? 'automation' : undefined,
      relatedId: input.automationId,
    });
  }

  async approveTask(input: {
    businessId: string;
    taskId: string;
    notes?: string;
  }) {
    return this.autopilot.approveTask(input.taskId, input.businessId, 'key-cortex');
  }

  async rejectTask(input: {
    businessId: string;
    taskId: string;
    reason?: string;
  }) {
    return this.autopilot.denyTask(input.taskId, input.businessId);
  }

  async enableLoop(input: { businessId: string; loopId: string }) {
    return this.loops.updateLoop(input.businessId, input.loopId, { enabled: true });
  }

  async disableLoop(input: { businessId: string; loopId: string }) {
    return this.loops.updateLoop(input.businessId, input.loopId, { enabled: false });
  }

  async completeTask(input: {
    businessId: string;
    taskId: string;
    outcome?: string;
  }) {
    return this.autopilot.updateTaskStatus(
      input.taskId,
      input.businessId,
      'COMPLETED',
      'key-cortex',
    );
  }

  async createLoop(_input: {
    businessId: string;
    name: string;
    frequency?: string;
    taskTemplate?: Record<string, unknown>;
    conditions?: Array<Record<string, unknown>>;
    active?: boolean;
  }) {
    // Delegation loops are seeded per business; this adapter creates a
    // custom loop entry for AI-defined recurring checks.
    throw new NotImplementedException('createLoop not implemented');
  }

  async listLoops(input: { businessId: string; active?: boolean }) {
    const loops = await this.loops.getLoops(input.businessId);
    return input.active !== undefined
      ? loops.filter((loop: { enabled?: boolean }) => loop.enabled === input.active)
      : loops;
  }
}
