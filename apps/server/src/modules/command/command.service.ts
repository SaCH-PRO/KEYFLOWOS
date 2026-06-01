import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateCommandItemDto } from './dto/create-command-item.dto';
import { UpdateCommandItemDto } from './dto/update-command-item.dto';

@Injectable()
export class CommandService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async create(businessId: string, dto: CreateCommandItemDto) {
    return this.prisma.client.commandItem.create({
      data: {
        businessId,
        sourceModule: dto.sourceModule,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        actionType: dto.actionType,
        status: dto.status ?? 'OPEN',
        priority: dto.priority ?? 50,
        urgency: dto.urgency ?? 50,
        impactScore: dto.impactScore ?? 0,
        expectedValue: dto.expectedValue ? dto.expectedValue : null,
        currency: dto.currency,
        riskTier: dto.riskTier ?? 1,
        requiresApproval: dto.requiresApproval ?? false,
        executableByKey: dto.executableByKey ?? false,
        executionTool: dto.executionTool,
        executionPayload: dto.executionPayload ?? undefined,
        recommendedBy: dto.recommendedBy,
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
        dueAt: dto.dueAt,
        snoozedUntil: dto.snoozedUntil,
      },
    });
  }

  async findMany(businessId: string, filters: {
    status?: string;
    category?: string;
    sourceModule?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.sourceModule) where.sourceModule = filters.sourceModule;

    const [items, total] = await Promise.all([
      this.prisma.client.commandItem.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { urgency: 'desc' }, { createdAt: 'desc' }],
        take: filters.limit ?? 25,
        skip: filters.offset ?? 0,
      }),
      this.prisma.client.commandItem.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(businessId: string, id: string) {
    const item = await this.prisma.client.commandItem.findFirst({
      where: { id, businessId },
    });
    if (!item) throw new NotFoundException('Command item not found');
    return item;
  }

  async update(businessId: string, id: string, dto: UpdateCommandItemDto) {
    await this.findOne(businessId, id);
    return this.prisma.client.commandItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.urgency !== undefined && { urgency: dto.urgency }),
        ...(dto.impactScore !== undefined && { impactScore: dto.impactScore }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.executableByKey !== undefined && { executableByKey: dto.executableByKey }),
        ...(dto.executionTool !== undefined && { executionTool: dto.executionTool }),
        ...(dto.executionPayload !== undefined && { executionPayload: dto.executionPayload }),
        ...(dto.ownerType !== undefined && { ownerType: dto.ownerType }),
        ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
        ...(dto.dueAt !== undefined && { dueAt: dto.dueAt }),
        ...(dto.snoozedUntil !== undefined && { snoozedUntil: dto.snoozedUntil }),
        ...(dto.completedAt !== undefined && { completedAt: dto.completedAt }),
        ...(dto.dismissedAt !== undefined && { dismissedAt: dto.dismissedAt }),
      },
    });
  }

  async dismiss(businessId: string, id: string) {
    await this.findOne(businessId, id);
    return this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
  }

  async snooze(businessId: string, id: string, until: Date) {
    await this.findOne(businessId, id);
    return this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'DISMISSED', snoozedUntil: until },
    });
  }

  async approve(businessId: string, id: string) {
    await this.findOne(businessId, id);
    return this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'EXECUTED', completedAt: new Date() },
    });
  }

  async execute(businessId: string, id: string, result?: Record<string, unknown>) {
    await this.findOne(businessId, id);
    return this.prisma.client.commandItem.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        completedAt: new Date(),
        executionPayload: result ? { ...(result as Record<string, unknown>) } : undefined,
      },
    });
  }

  async delete(businessId: string, id: string) {
    await this.findOne(businessId, id);
    return this.prisma.client.commandItem.delete({ where: { id } });
  }

  async summary(businessId: string) {
    const [open, waitingApproval, executableByKey, byCategory] = await Promise.all([
      this.prisma.client.commandItem.count({ where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      this.prisma.client.commandItem.count({ where: { businessId, status: 'WAITING_APPROVAL' } }),
      this.prisma.client.commandItem.count({ where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS'] }, executableByKey: true } }),
      this.prisma.client.commandItem.groupBy({
        by: ['category'],
        where: { businessId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL'] } },
        _count: { category: true },
      }),
    ]);

    return {
      open,
      waitingApproval,
      executableByKey,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count.category })),
    };
  }
}
