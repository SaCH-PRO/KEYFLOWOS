import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
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

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'get_tasks': {
        const tasks = await this.getTasks({
          businessId: command.businessId,
          status: command.parameters.status as string,
          assignedTo: command.parameters.assignedTo as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, tasks);
      }
      case 'create_task': {
        const task = await this.createTask({
          businessId: command.businessId,
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          assignedTo: command.parameters.assignedTo as string,
          priority: (command.parameters.priority as string) || 'medium',
          dueDate: command.parameters.dueDate as string,
          automationId: command.parameters.automationId as string,
        });
        return connectorOk(command, start, task);
      }
      case 'approve_task': {
        const approved = await this.approveTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, approved);
      }
      case 'reject_task': {
        const rejected = await this.rejectTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          reason: command.parameters.reason as string,
        });
        return connectorOk(command, start, rejected);
      }
      case 'enable_loop': {
        const enabled = await this.enableLoop({
          businessId: command.businessId,
          loopId: command.parameters.loopId as string,
        });
        return connectorOk(command, start, enabled);
      }
      case 'disable_loop': {
        const disabled = await this.disableLoop({
          businessId: command.businessId,
          loopId: command.parameters.loopId as string,
        });
        return connectorOk(command, start, disabled);
      }
      case 'complete_task': {
        const completed = await this.completeTask({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          outcome: command.parameters.outcome as string,
        });
        return connectorOk(command, start, completed);
      }
      case 'create_loop': {
        const loop = await this.createLoop({
          businessId: command.businessId,
          name: command.parameters.name as string,
          frequency: command.parameters.frequency as string,
          taskTemplate: command.parameters.taskTemplate as Record<string, unknown>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: (command.parameters.active as boolean) || false,
        });
        return connectorOk(command, start, loop);
      }
      default:
        return connectorFail(command, start, `Unknown autopilot action: ${command.action}`);
    }
  }
}
