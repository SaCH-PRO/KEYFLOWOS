import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface LogActivityInput {
  businessId: string;
  entityType: string;
  entityId?: string;
  action: string;
  description?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface BulkActivityInput {
  businessId: string;
  events: Array<Record<string, unknown>>;
}

export interface CreateAuditNoteInput {
  businessId: string;
  entityType: string;
  entityId?: string;
  note: string;
}

export interface ExportAuditLogInput {
  businessId: string;
  from?: string;
  to?: string;
  entityType?: string;
  format?: string;
}

export interface DeleteOldLogsInput {
  businessId: string;
  olderThanDays: number;
  entityType?: string;
}

export interface RecentActivityInput {
  businessId: string;
  limit?: number;
}

export interface CreateActivityInput {
  businessId: string;
  module: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  title: string;
  detail?: string | null;
  tone?: string | null;
  contactId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);
  constructor(private readonly prisma: PrismaService) {}

  async logActivity(businessId: string, data: { type: string; description: string; userId?: string; metadata?: Record<string, unknown> }) {
    return this.prisma.client.activityLog.create({
      data: { businessId, ...data, createdAt: new Date() },
    });
  }

  async getActivity(businessId: string, limit = 50) {
    return this.prisma.client.activityLog.findMany({
      where: { businessId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRecentActivity(businessId: string, since: Date) {
    return this.prisma.client.activityLog.findMany({
      where: { businessId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActivityStats(businessId: string) {
    const total = await this.prisma.client.activityLog.count({ where: { businessId } });
    const today = await this.prisma.client.activityLog.count({
      where: { businessId, createdAt: { gte: new Date(Date.now() - 86400000) } },
    });
    return { total, today };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Connector-facing typed methods
  // ═══════════════════════════════════════════════════════════════════════════

  async log(input: LogActivityInput) {
    return this.prisma.client.activityLog.create({
      data: {
        businessId: input.businessId,
        type: input.entityType,
        description: input.description ?? `${input.action}`,
        metadata: {
          entityId: input.entityId,
          action: input.action,
          source: input.source ?? 'connector',
          ...input.metadata,
        },
        createdAt: new Date(),
      },
    });
  }

  async logBulk(input: BulkActivityInput) {
    if (!input.events.length) return { created: 0 };
    const data = input.events.map((event) => ({
      businessId: input.businessId,
      type: (event.entityType as string) ?? 'general',
      description: (event.description as string) ?? `${event.action ?? 'event'}`,
      metadata: event as Record<string, unknown>,
      createdAt: new Date(),
    }));
    const result = await this.prisma.client.activityLog.createMany({ data });
    return { created: result.count };
  }

  async createAuditNote(input: CreateAuditNoteInput) {
    return this.prisma.client.activityLog.create({
      data: {
        businessId: input.businessId,
        type: 'audit_note',
        description: input.note,
        metadata: { entityType: input.entityType, entityId: input.entityId },
        createdAt: new Date(),
      },
    });
  }

  async exportAuditLog(input: ExportAuditLogInput) {
    const where: Record<string, unknown> = { businessId: input.businessId };
    if (input.entityType) where.type = input.entityType;
    if (input.from || input.to) {
      where.createdAt = {};
      if (input.from) (where.createdAt as Record<string, unknown>).gte = new Date(input.from);
      if (input.to) (where.createdAt as Record<string, unknown>).lte = new Date(input.to);
    }
    const rows = await this.prisma.client.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    if ((input.format ?? 'json').toLowerCase() === 'csv') {
      const header = 'id,type,description,metadata,createdAt';
      const lines = rows.map((r) =>
        [r.id, r.type, `"${(r.description ?? '').replace(/"/g, '""')}"`, JSON.stringify(r.metadata ?? {}), r.createdAt.toISOString()].join(','),
      );
      return { format: 'csv', data: [header, ...lines].join('\n'), count: rows.length };
    }
    return { format: 'json', data: rows, count: rows.length };
  }

  async deleteOldLogs(input: DeleteOldLogsInput) {
    const cutoff = new Date(Date.now() - input.olderThanDays * 86400000);
    const where: Record<string, unknown> = { businessId: input.businessId, createdAt: { lt: cutoff } };
    if (input.entityType) where.type = input.entityType;
    const result = await this.prisma.client.activityLog.deleteMany({ where });
    return { deleted: result.count };
  }

  async getRecent(input: RecentActivityInput) {
    return this.getActivity(input.businessId, input.limit ?? 50);
  }

  /**
   * Create a row in the legacy `Activity` table (not `ActivityLog`).
   * Used by AI/KEY Cortex tools that need observable business activity.
   */
  async createActivity(input: CreateActivityInput) {
    return this.prisma.client.activity.create({
      data: {
        businessId: input.businessId,
        module: input.module,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        title: input.title,
        detail: input.detail ?? null,
        tone: input.tone ?? null,
        contactId: input.contactId ?? null,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        occurredAt: new Date(),
      },
    });
  }
}
