import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { FlowSignal, Prisma } from '@prisma/client';
import type {
  FlowSignalDto,
  FlowSignalInput,
  FlowSignalListResult,
  FlowSignalQuery,
  FlowSignalStatus,
} from './flow-signal.types';

@Injectable()
export class FlowSignalService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(input: FlowSignalInput): Promise<FlowSignalDto> {
    // Deduplicate unresolved signals for the same business/type/entity so
    // repeated emitters (e.g. periodic watchers) do not spam the role queue.
    if (input.entityType && input.entityId) {
      const existing = await this.prisma.client.flowSignal.findFirst({
        where: {
          businessId: input.businessId,
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId,
          status: { in: ['RECORDED', 'ACTION_REQUIRED'] },
        },
      });

      if (existing) {
        const updated = await this.prisma.client.flowSignal.update({
          where: { id: existing.id },
          data: {
            occurredAt: input.occurredAt ?? new Date(),
            importance: input.importance ?? existing.importance,
            payload: (input.payload as Prisma.InputJsonValue) ?? existing.payload,
          },
        });
        return this.toDto(updated);
      }
    }

    const data: Prisma.FlowSignalCreateInput = {
      id: randomUUID(),
      business: { connect: { id: input.businessId } },
      userId: input.userId,
      flows: input.flows ?? [],
      source: input.source,
      type: input.type,
      module: input.module ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      title: input.title,
      summary: input.summary ?? null,
      description: input.description ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      reminderAt: input.reminderAt ?? null,
      status: 'RECORDED',
      importance: input.importance ?? 'NORMAL',
      visibility: input.visibility ?? 'USER',
      ownerRoleHint: input.ownerRoleHint ?? null,
      payload: (input.payload as Prisma.InputJsonValue) ?? {},
      signals: (input.signals as Prisma.InputJsonValue) ?? {},
      tags: input.tags ?? [],
    };

    const row = await this.prisma.client.flowSignal.create({ data });
    return this.toDto(row);
  }

  async list(businessId: string, query: FlowSignalQuery = {}): Promise<FlowSignalListResult> {
    const where: Prisma.FlowSignalWhereInput = { businessId };

    if (query.flows) {
      const flows = Array.isArray(query.flows) ? query.flows : [query.flows];
      where.flows = { hasEvery: flows };
    }
    if (query.source) where.source = query.source;
    if (query.type) where.type = query.type;
    if (query.module) where.module = query.module;
    if (query.status) {
      where.status = Array.isArray(query.status) ? { in: query.status } : query.status;
    }
    if (query.importance) {
      where.importance = Array.isArray(query.importance) ? { in: query.importance } : query.importance;
    }
    if (query.ownerRoleHint) where.ownerRoleHint = query.ownerRoleHint;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.client.flowSignal.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: query.limit ?? 100,
        skip: query.offset ?? 0,
      }),
      this.prisma.client.flowSignal.count({ where }),
    ]);

    return { items: items.map((row) => this.toDto(row)), total };
  }

  async remindersDue(businessId: string): Promise<FlowSignalDto[]> {
    const rows = await this.prisma.client.flowSignal.findMany({
      where: {
        businessId,
        reminderAt: { lte: new Date() },
        status: { in: ['RECORDED', 'ACTION_REQUIRED'] },
      },
      orderBy: { reminderAt: 'asc' },
      take: 50,
    });
    return rows.map((row) => this.toDto(row));
  }

  async markResolved(businessId: string, signalId: string): Promise<FlowSignalDto> {
    const row = await this.prisma.client.flowSignal.update({
      where: { id: signalId, businessId },
      data: { status: 'RESOLVED' as FlowSignalStatus, completedAt: new Date() },
    });
    return this.toDto(row);
  }

  async markActionRequired(businessId: string, signalId: string): Promise<FlowSignalDto> {
    const row = await this.prisma.client.flowSignal.update({
      where: { id: signalId, businessId },
      data: { status: 'ACTION_REQUIRED' as FlowSignalStatus },
    });
    return this.toDto(row);
  }

  async snooze(businessId: string, signalId: string, until: Date): Promise<FlowSignalDto> {
    const row = await this.prisma.client.flowSignal.update({
      where: { id: signalId, businessId },
      data: { status: 'SNOOZED' as FlowSignalStatus, reminderAt: until },
    });
    return this.toDto(row);
  }

  async findByEntity(
    businessId: string,
    entityType: string,
    entityId: string,
    statuses?: FlowSignalStatus[],
  ): Promise<FlowSignalDto[]> {
    const rows = await this.prisma.client.flowSignal.findMany({
      where: {
        businessId,
        entityType,
        entityId,
        ...(statuses && { status: { in: statuses } }),
      },
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  private toDto(row: FlowSignal): FlowSignalDto {
    return {
      id: row.id,
      businessId: row.businessId,
      userId: row.userId,
      flows: row.flows,
      source: row.source,
      type: row.type,
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      summary: row.summary,
      description: row.description,
      occurredAt: row.occurredAt,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      reminderAt: row.reminderAt,
      status: row.status,
      importance: row.importance,
      visibility: row.visibility,
      ownerRoleHint: row.ownerRoleHint,
      payload: (row.payload as Record<string, unknown>) ?? {},
      signals: (row.signals as Record<string, unknown>) ?? {},
      tags: row.tags,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
