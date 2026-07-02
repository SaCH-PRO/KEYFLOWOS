import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Typed adapter that exposes the flow/automation methods expected by
 * KeyCortexConnectorService.  Implemented directly against the Automation
 * Prisma model because FlowService currently only exposes analytics.
 */
@Injectable()
export class FlowAdapterService {
  constructor(private readonly prisma: PrismaService) {}

  async createAutomation(input: {
    businessId: string;
    name: string;
    trigger: string;
    actions: Array<Record<string, unknown>>;
    conditions?: Array<Record<string, unknown>>;
    active?: boolean;
  }) {
    return this.prisma.client.automation.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        trigger: input.trigger,
        enabled: input.active ?? false,
        actionData: input.actions as never,
        condition: input.conditions ? JSON.stringify(input.conditions) : null,
      },
    });
  }

  async enableAutomation(input: { businessId: string; flowId: string }) {
    return this.prisma.client.automation.update({
      where: { id: input.flowId, businessId: input.businessId },
      data: { enabled: true },
    });
  }

  async disableAutomation(input: { businessId: string; flowId: string }) {
    return this.prisma.client.automation.update({
      where: { id: input.flowId, businessId: input.businessId },
      data: { enabled: false },
    });
  }

  async triggerFlow(input: {
    businessId: string;
    flowId: string;
    contactId: string;
    payload?: Record<string, unknown>;
  }) {
    const flow = await this.prisma.client.automation.findFirst({
      where: { id: input.flowId, businessId: input.businessId },
    });
    if (!flow) {
      throw new NotFoundException('Automation not found');
    }
    return this.prisma.client.automation.update({
      where: { id: input.flowId },
      data: {
        lastRunAt: new Date(),
        runCount: { increment: 1 },
      },
    });
  }

  async deleteAutomation(input: { businessId: string; flowId: string }) {
    return this.prisma.client.automation.update({
      where: { id: input.flowId, businessId: input.businessId },
      data: { deletedAt: new Date() },
    });
  }

  async updateAutomation(input: {
    businessId: string;
    flowId: string;
    name?: string;
    actions?: Array<Record<string, unknown>>;
    conditions?: Array<Record<string, unknown>>;
    active?: boolean;
  }) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.actions !== undefined) data.actionData = input.actions;
    if (input.conditions !== undefined) {
      data.condition = input.conditions ? JSON.stringify(input.conditions) : null;
    }
    if (input.active !== undefined) data.enabled = input.active;

    return this.prisma.client.automation.update({
      where: { id: input.flowId, businessId: input.businessId },
      data,
    });
  }

  async cloneAutomation(input: { businessId: string; flowId: string; newName: string }) {
    const source = await this.prisma.client.automation.findFirst({
      where: { id: input.flowId, businessId: input.businessId },
    });
    if (!source) {
      throw new NotFoundException('Automation not found');
    }
    return this.prisma.client.automation.create({
      data: {
        businessId: input.businessId,
        name: input.newName,
        trigger: source.trigger,
        enabled: false,
        actionData: source.actionData as never,
        condition: source.condition,
      },
    });
  }

  async runTest(input: { businessId: string; flowId: string; contactId: string }) {
    const flow = await this.prisma.client.automation.findFirst({
      where: { id: input.flowId, businessId: input.businessId },
    });
    if (!flow) {
      throw new NotFoundException('Automation not found');
    }
    return {
      success: true,
      flowId: flow.id,
      contactId: input.contactId,
      actionsSimulated: Array.isArray(flow.actionData) ? flow.actionData.length : 0,
    };
  }

  async listAutomations(input: { businessId: string; active?: boolean }) {
    return this.prisma.client.automation.findMany({
      where: {
        businessId: input.businessId,
        deletedAt: null,
        ...(input.active !== undefined ? { enabled: input.active } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getFlowStatus(input: { businessId: string; flowId: string }) {
    return this.prisma.client.automation.findFirst({
      where: { id: input.flowId, businessId: input.businessId, deletedAt: null },
    });
  }

  async getFlowRuns(input: { businessId: string; flowId: string; limit?: number }) {
    const flow = await this.prisma.client.automation.findFirst({
      where: { id: input.flowId, businessId: input.businessId },
    });
    return {
      flowId: input.flowId,
      lastRunAt: flow?.lastRunAt ?? null,
      runCount: flow?.runCount ?? 0,
      // Legacy Automation model does not store per-run history; this is a summary.
      runs: [],
    };
  }

  async getFlowAnalytics(input: { businessId: string; flowId?: string }) {
    const where: any = { businessId: input.businessId, deletedAt: null };
    if (input.flowId) where.id = input.flowId;
    const flows = await this.prisma.client.automation.findMany({ where });
    return {
      total: flows.length,
      active: flows.filter((f: { enabled: boolean }) => f.enabled).length,
      inactive: flows.filter((f: { enabled: boolean }) => !f.enabled).length,
      totalRuns: flows.reduce((sum: number, f: { runCount?: number }) => sum + (f.runCount ?? 0), 0),
    };
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_automation': {
        const flow = await this.createAutomation({
          businessId: command.businessId,
          name: command.parameters.name as string,
          trigger: command.parameters.trigger as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: (command.parameters.active as boolean) || false,
        });
        return connectorOk(command, start, flow);
      }
      case 'enable_automation': {
        const enabled = await this.enableAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return connectorOk(command, start, enabled);
      }
      case 'disable_automation': {
        const disabled = await this.disableAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return connectorOk(command, start, disabled);
      }
      case 'trigger_flow': {
        const triggered = await this.triggerFlow({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          contactId: command.parameters.contactId as string,
          payload: command.parameters.payload as Record<string, unknown>,
        });
        return connectorOk(command, start, triggered);
      }
      case 'delete_automation': {
        await this.deleteAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return connectorOk(command, start, { deleted: true });
      }
      case 'update_automation': {
        const updated = await this.updateAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          name: command.parameters.name as string,
          actions: command.parameters.actions as Array<Record<string, unknown>>,
          conditions: command.parameters.conditions as Array<Record<string, unknown>>,
          active: command.parameters.active as boolean,
        });
        return connectorOk(command, start, updated);
      }
      case 'clone_automation': {
        const cloned = await this.cloneAutomation({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          newName: command.parameters.newName as string,
        });
        return connectorOk(command, start, cloned);
      }
      case 'run_test': {
        const testResult = await this.runTest({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          contactId: command.parameters.contactId as string,
        });
        return connectorOk(command, start, testResult);
      }
      case 'get_flow_status': {
        const status = await this.getFlowStatus({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return connectorOk(command, start, status);
      }
      case 'list_automations': {
        const automations = await this.listAutomations({
          businessId: command.businessId,
          active: command.parameters.active as boolean,
        });
        return connectorOk(command, start, automations);
      }
      case 'get_flow_runs': {
        const runs = await this.getFlowRuns({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
          limit: (command.parameters.limit as number) || 20,
        });
        return connectorOk(command, start, runs);
      }
      case 'get_flow_analytics': {
        const analytics = await this.getFlowAnalytics({
          businessId: command.businessId,
          flowId: command.parameters.flowId as string,
        });
        return connectorOk(command, start, analytics);
      }
      default:
        return connectorFail(command, start, `Unknown flow action: ${command.action}`);
    }
  }
}
