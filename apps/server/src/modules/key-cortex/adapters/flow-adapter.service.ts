import { Injectable, NotFoundException } from '@nestjs/common';
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
}
