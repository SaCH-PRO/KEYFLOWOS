import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateCommandItemDto } from './dto/create-command-item.dto';
import { UpdateCommandItemDto } from './dto/update-command-item.dto';

@Injectable()
export class CommandService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  async create(businessId: string, dto: CreateCommandItemDto) {
    const item = await this.prisma.client.commandItem.create({
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
        contactId: dto.contactId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        dueAt: dto.dueAt,
        snoozedUntil: dto.snoozedUntil,
      },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'create',
      entityType: 'command_item',
      entityId: item.id,
      title: dto.title,
      detail: dto.description ?? undefined,
      category: 'SYSTEM',
      actorType: 'SYSTEM',
      data: { category: dto.category, actionType: dto.actionType, priority: dto.priority },
    });
    this.realtime.emit({
      businessId,
      type: 'command.created',
      payload: { id: item.id, title: item.title, status: item.status, category: item.category },
    });
    // Notify for high-priority or approval-required commands
    if (item.requiresApproval || item.priority >= 80 || item.riskTier >= 3) {
      await this.notifications.create({
        businessId,
        type: 'command',
        title: item.requiresApproval ? `Approval required: ${item.title}` : `High priority: ${item.title}`,
        body: item.description ?? undefined,
        data: { commandId: item.id, category: item.category, priority: item.priority },
      });
    }
    return item;
  }

  async findMany(businessId: string, filters: {
    status?: string;
    category?: string;
    sourceModule?: string;
    ownerId?: string;
    ownerType?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.sourceModule) where.sourceModule = filters.sourceModule;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.ownerType) where.ownerType = filters.ownerType;

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
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
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
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'update',
      entityType: 'command_item',
      entityId: id,
      title: `Updated: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { changedFields: Object.keys(dto) },
    });
    return item;
  }

  async dismiss(businessId: string, id: string) {
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'dismiss',
      entityType: 'command_item',
      entityId: id,
      title: `Dismissed: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { previousStatus: existing.status },
    });
    return item;
  }

  async snooze(businessId: string, id: string, until: Date) {
    if (until.getTime() <= Date.now()) {
      throw new BadRequestException('Snooze until date must be in the future');
    }
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'SNOOZED', snoozedUntil: until },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'snooze',
      entityType: 'command_item',
      entityId: id,
      title: `Snoozed: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { until: until.toISOString(), previousStatus: existing.status },
    });
    return item;
  }

  async complete(businessId: string, id: string) {
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'complete',
      entityType: 'command_item',
      entityId: id,
      title: `Completed: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { previousStatus: existing.status },
    });
    this.realtime.emit({
      businessId,
      type: 'command.completed',
      payload: { id: item.id, title: existing.title },
    });
    return item;
  }

  async assign(businessId: string, id: string, ownerType: string, ownerId: string) {
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { ownerType, ownerId },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'assign',
      entityType: 'command_item',
      entityId: id,
      title: `Assigned: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { ownerType, ownerId, previousOwnerType: existing.ownerType, previousOwnerId: existing.ownerId },
    });
    this.realtime.emit({
      businessId,
      type: 'command.assigned',
      payload: { id: item.id, title: existing.title, ownerType, ownerId },
    });
    return item;
  }

  async reopen(businessId: string, id: string) {
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'OPEN', completedAt: null, dismissedAt: null, snoozedUntil: null },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'reopen',
      entityType: 'command_item',
      entityId: id,
      title: `Reopened: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { previousStatus: existing.status },
    });
    return item;
  }

  async approve(businessId: string, id: string) {
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: { status: 'EXECUTED', completedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'approve',
      entityType: 'command_item',
      entityId: id,
      title: `Approved: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
      data: { previousStatus: existing.status },
    });
    return item;
  }

  async execute(businessId: string, id: string, result?: Record<string, unknown>) {
    const existing = await this.findOne(businessId, id);
    const item = await this.prisma.client.commandItem.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        completedAt: new Date(),
        executionPayload: result ? { ...(result as Record<string, unknown>) } : undefined,
      },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'execute',
      entityType: 'command_item',
      entityId: id,
      title: `Executed: ${existing.title}`,
      category: 'SYSTEM',
      actorType: existing.executableByKey ? 'AI' : 'USER',
      data: { result },
    });
    return item;
  }

  async delete(businessId: string, id: string) {
    const existing = await this.findOne(businessId, id);
    await this.prisma.client.commandItem.delete({ where: { id } });
    await this.timeline.recordEvent({
      businessId,
      module: 'command',
      action: 'delete',
      entityType: 'command_item',
      entityId: id,
      title: `Deleted: ${existing.title}`,
      category: 'SYSTEM',
      actorType: 'USER',
    });
    return existing;
  }

  async bulkComplete(businessId: string, ids: string[]) {
    if (!ids.length) return { count: 0 };
    const existing = await this.prisma.client.commandItem.findMany({
      where: { id: { in: ids }, businessId },
    });
    if (existing.length !== ids.length) {
      throw new NotFoundException('One or more command items not found');
    }
    const { count } = await this.prisma.client.commandItem.updateMany({
      where: { id: { in: ids }, businessId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await Promise.all(
      existing.map((item) =>
        this.timeline.recordEvent({
          businessId,
          module: 'command',
          action: 'complete',
          entityType: 'command_item',
          entityId: item.id,
          title: `Completed: ${item.title}`,
          category: 'SYSTEM',
          actorType: 'USER',
          data: { previousStatus: item.status },
        }),
      ),
    );
    this.realtime.emit({
      businessId,
      type: 'command.bulk_completed',
      payload: { count, ids },
    });
    return { count };
  }

  async bulkDismiss(businessId: string, ids: string[]) {
    if (!ids.length) return { count: 0 };
    const existing = await this.prisma.client.commandItem.findMany({
      where: { id: { in: ids }, businessId },
    });
    if (existing.length !== ids.length) {
      throw new NotFoundException('One or more command items not found');
    }
    const { count } = await this.prisma.client.commandItem.updateMany({
      where: { id: { in: ids }, businessId },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    await Promise.all(
      existing.map((item) =>
        this.timeline.recordEvent({
          businessId,
          module: 'command',
          action: 'dismiss',
          entityType: 'command_item',
          entityId: item.id,
          title: `Dismissed: ${item.title}`,
          category: 'SYSTEM',
          actorType: 'USER',
          data: { previousStatus: item.status },
        }),
      ),
    );
    this.realtime.emit({
      businessId,
      type: 'command.bulk_dismissed',
      payload: { count, ids },
    });
    return { count };
  }

  async bulkDelete(businessId: string, ids: string[]) {
    if (!ids.length) return { count: 0 };
    const existing = await this.prisma.client.commandItem.findMany({
      where: { id: { in: ids }, businessId },
    });
    if (existing.length !== ids.length) {
      throw new NotFoundException('One or more command items not found');
    }
    const { count } = await this.prisma.client.commandItem.deleteMany({
      where: { id: { in: ids }, businessId },
    });
    await Promise.all(
      existing.map((item) =>
        this.timeline.recordEvent({
          businessId,
          module: 'command',
          action: 'delete',
          entityType: 'command_item',
          entityId: item.id,
          title: `Deleted: ${item.title}`,
          category: 'SYSTEM',
          actorType: 'USER',
        }),
      ),
    );
    return { count };
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
