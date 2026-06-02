import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class FlowEngineService {
  private readonly logger = new Logger(FlowEngineService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async createFlow(businessId: string, createdBy: string, data: {
    name: string;
    description?: string;
    category: string;
    goal?: string;
    triggerSummary?: string;
    riskTier?: number;
    blueprintTags?: string[];
    nodes?: unknown[];
    edges?: unknown[];
  }) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const flow = await tx.automationFlow.create({
        data: {
          businessId,
          name: data.name,
          description: data.description ?? null,
          category: data.category,
          status: 'DRAFT',
          goal: data.goal ?? null,
          triggerSummary: data.triggerSummary ?? null,
          riskTier: data.riskTier ?? 1,
          createdBy,
          blueprintTags: data.blueprintTags ?? [],
        },
      });

      await tx.flowVersion.create({
        data: {
          flowId: flow.id,
          version: 1,
          nodes: (data.nodes ?? []) as any,
          edges: (data.edges ?? []) as any,
          status: 'DRAFT',
        },
      });

      return flow;
    });

    return result;
  }

  async findMany(businessId: string, filters: {
    status?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { businessId, deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;

    const [items, total] = await Promise.all([
      this.prisma.client.automationFlow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 25,
        skip: filters.offset ?? 0,
        include: {
          versions: {
            where: { status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.client.automationFlow.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(businessId: string, id: string) {
    const flow = await this.prisma.client.automationFlow.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 10,
        },
      },
    });
    if (!flow) throw new NotFoundException('Flow not found');
    return flow;
  }

  async findVersions(businessId: string, flowId: string) {
    // Verify ownership before returning versions
    const flow = await this.prisma.client.automationFlow.findFirst({
      where: { id: flowId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!flow) throw new NotFoundException('Flow not found');

    return this.prisma.client.flowVersion.findMany({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
  }

  async publishFlow(businessId: string, flowId: string) {
    const flow = await this.findOne(businessId, flowId);
    const latest = await this.prisma.client.flowVersion.findFirst({
      where: { flowId },
      orderBy: { version: 'desc' },
    });
    if (!latest) throw new NotFoundException('No version found');

    await this.prisma.client.$transaction([
      this.prisma.client.flowVersion.update({
        where: { id: latest.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      }),
      this.prisma.client.automationFlow.update({
        where: { id: flowId },
        data: { status: 'ACTIVE', updatedAt: new Date() },
      }),
    ]);

    return this.prisma.client.automationFlow.findUnique({ where: { id: flowId } });
  }

  async updateFlow(businessId: string, flowId: string, data: {
    name?: string;
    description?: string;
    category?: string;
    goal?: string;
    triggerSummary?: string;
    riskTier?: number;
    blueprintTags?: string[];
    nodes?: unknown[];
    edges?: unknown[];
  }) {
    await this.findOne(businessId, flowId);

    const flow = await this.prisma.client.automationFlow.update({
      where: { id: flowId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.goal !== undefined && { goal: data.goal }),
        ...(data.triggerSummary !== undefined && { triggerSummary: data.triggerSummary }),
        ...(data.riskTier !== undefined && { riskTier: data.riskTier }),
        ...(data.blueprintTags !== undefined && { blueprintTags: data.blueprintTags }),
      },
    });

    if (data.nodes || data.edges) {
      const latest = await this.prisma.client.flowVersion.findFirst({
        where: { flowId },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      await this.prisma.client.flowVersion.create({
        data: {
          flowId,
          version: nextVersion,
          nodes: (data.nodes ?? latest?.nodes ?? []) as any,
          edges: (data.edges ?? latest?.edges ?? []) as any,
          status: 'DRAFT',
        },
      });
    }

    return flow;
  }

  async deleteFlow(businessId: string, flowId: string) {
    await this.findOne(businessId, flowId);

    // Soft delete: mark as deleted rather than removing
    await this.prisma.client.automationFlow.update({
      where: { id: flowId },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });

    return { deleted: true };
  }
}
