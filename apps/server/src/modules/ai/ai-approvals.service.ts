import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiOversightService } from './ai-oversight.service';

export interface ListAiApprovalsQuery {
  status?: 'pending' | 'approved' | 'rejected' | 'escalated' | 'deferred';
  module?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface AiApprovalItemListResult {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class AiApprovalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiOversightService) private readonly oversight: AiOversightService,
  ) {}

  async listItems(businessId: string, query: ListAiApprovalsQuery): Promise<AiApprovalItemListResult> {
    const { status = 'pending', module, search, cursor, limit = 25 } = query;
    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);

    const where: Record<string, unknown> = { businessId };
    if (status) where.status = status;
    if (module) where.module = module;
    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { toolName: { contains: term, mode: 'insensitive' } },
        { rationale: { contains: term, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.client.aiApprovalItem.findMany({
      where,
      orderBy: [{ riskTier: 'desc' }, { createdAt: 'asc' }],
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id ?? null : null;

    return {
      items: sliced.map((item) => this.serializeItem(item)),
      nextCursor,
      hasMore,
    };
  }

  async getItem(businessId: string, itemId: string) {
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: { id: itemId, businessId },
    });
    if (!item) throw new NotFoundException('Approval item not found');
    return this.serializeItem(item);
  }

  async resolveItem(
    businessId: string,
    itemId: string,
    resolution: 'approved' | 'rejected' | 'deferred',
    resolvedByUserId: string,
  ) {
    return this.oversight.resolveApproval(itemId, businessId, resolution, resolvedByUserId);
  }

  async resolveBatch(
    businessId: string,
    itemIds: string[],
    resolution: 'approved' | 'rejected' | 'deferred',
    resolvedByUserId: string,
  ) {
    if (resolution === 'deferred') {
      const results = await Promise.allSettled(
        itemIds.map((id) => this.oversight.resolveApproval(id, businessId, resolution, resolvedByUserId)),
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { succeeded, failed, total: itemIds.length };
    }
    return this.oversight.resolveApprovalsBatch(businessId, itemIds, resolution, resolvedByUserId);
  }

  async getStats(businessId: string) {
    const [pending, approvedToday, rejectedToday, escalated] = await Promise.all([
      this.prisma.client.aiApprovalItem.count({ where: { businessId, status: 'pending' } }),
      this.prisma.client.aiApprovalItem.count({
        where: {
          businessId,
          status: 'approved',
          resolvedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.client.aiApprovalItem.count({
        where: {
          businessId,
          status: 'rejected',
          resolvedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.client.aiApprovalItem.count({ where: { businessId, status: 'escalated' } }),
    ]);

    const byModule = await this.prisma.client.aiApprovalItem.groupBy({
      by: ['module'],
      where: { businessId, status: 'pending' },
      _count: { module: true },
    });

    return {
      pending,
      approvedToday,
      rejectedToday,
      escalated,
      byModule: byModule.map((row) => ({ module: row.module ?? 'unknown', count: row._count.module })),
    };
  }

  private serializeItem(item: Record<string, unknown>) {
    return {
      ...item,
      inputPayload: item.inputPayload ?? {},
      affectedEntities: item.affectedEntities ?? [],
    };
  }
}
