import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { PrismaService } from '../../../core/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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

  async createLoop(input: {
    businessId: string;
    name: string;
    frequency?: string;
    taskTemplate?: Record<string, unknown>;
    conditions?: Array<Record<string, unknown>>;
    active?: boolean;
  }) {
    const intervalMin = this.parseFrequency(input.frequency);
    const loopType = `custom_${Date.now()}`;
    return this.prisma.client.delegationLoop.create({
      data: {
        businessId: input.businessId,
        loopType,
        name: input.name,
        description: 'AI-created delegation loop',
        enabled: input.active ?? false,
        intervalMin,
        config: {
          taskTemplate: input.taskTemplate ?? {},
          conditions: input.conditions ?? [],
        },
        nextRunAt: input.active ? new Date(Date.now() + 60_000) : null,
      },
    });
  }

  private parseFrequency(frequency?: string): number {
    switch (frequency) {
      case 'hourly':
        return 60;
      case 'daily':
        return 1440;
      case 'weekly':
        return 10080;
      case 'monthly':
        return 43200;
      default:
        return 1440;
    }
  }

  async getLoopStatus(input: { businessId: string; loopId: string }) {
    return this.prisma.client.delegationLoop.findFirst({
      where: { id: input.loopId, businessId: input.businessId },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
    });
  }

  async getTaskHistory(input: { businessId: string; taskId?: string; limit?: number }) {
    const where: any = { businessId: input.businessId };
    if (input.taskId) where.id = input.taskId;
    return this.prisma.client.autopilotTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: input.limit ?? 50,
    });
  }

  async getGovernanceReport(input: { businessId: string }) {
    const [stats, alerts] = await Promise.all([
      this.autopilot.getTaskStats(input.businessId),
      this.autopilot.getCriticalAlerts(input.businessId),
    ]);
    return { stats, alerts };
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
      case 'list_loops': {
        const loops = await this.listLoops({
          businessId: command.businessId,
          active: command.parameters.active as boolean,
        });
        return connectorOk(command, start, loops);
      }
      case 'get_loop_status': {
        const status = await this.getLoopStatus({
          businessId: command.businessId,
          loopId: command.parameters.loopId as string,
        });
        return connectorOk(command, start, status);
      }
      case 'get_task_history': {
        const history = await this.getTaskHistory({
          businessId: command.businessId,
          taskId: command.parameters.taskId as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, history);
      }
      case 'get_governance_report': {
        const report = await this.getGovernanceReport({ businessId: command.businessId });
        return connectorOk(command, start, report);
      }
      default:
        return connectorFail(command, start, `Unknown autopilot action: ${command.action}`);
    }
  }
}
