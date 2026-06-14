import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';

export interface ListItemsFilters {
  status?: string;
  sourceType?: string;
  search?: string;
  intentType?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'confidence';
  sortOrder?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
}

@Injectable()
export class KeyInboxService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestionOrchestrator) private readonly orchestrator: IngestionOrchestrator,
  ) {}

  async listItems(businessId: string, filters: ListItemsFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
    const sortBy = filters.sortBy ?? 'createdAt';
    const sortOrder = filters.sortOrder ?? 'desc';

    const where: Record<string, unknown> = { businessId };
    if (filters.status) where.status = filters.status;
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.intentType) where.intentType = filters.intentType;
    if (filters.search) {
      where.OR = [
        { summary: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
        { body: { contains: filters.search, mode: 'insensitive' } },
        { fromName: { contains: filters.search, mode: 'insensitive' } },
        { fromEmail: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.client.ingestionItem.findMany({
      where,
      orderBy: sortBy === 'confidence'
        ? [{ confidence: sortOrder }, { createdAt: 'desc' }]
        : [{ [sortBy]: sortOrder }],
      take: limit + 1,
      cursor: filters.cursor ? { id: filters.cursor } : undefined,
      skip: filters.cursor ? 1 : undefined,
      select: {
        id: true,
        sourceType: true,
        sourceConnectorType: true,
        status: true,
        summary: true,
        intentType: true,
        confidence: true,
        fromName: true,
        fromEmail: true,
        fromPhone: true,
        subject: true,
        createdAt: true,
        proposedActions: true,
      },
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? trimmed[trimmed.length - 1].id : null;

    return {
      items: trimmed.map((item) => ({
        ...item,
        proposedActionsCount: Array.isArray(item.proposedActions)
          ? item.proposedActions.length
          : item.proposedActions
            ? ((item.proposedActions as Record<string, unknown>).actions as unknown[])?.length ?? 0
            : 0,
      })),
      nextCursor,
      hasMore,
    };
  }

  async getItem(businessId: string, itemId: string) {
    const item = await this.prisma.client.ingestionItem.findFirst({
      where: { id: itemId, businessId },
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
    });
    if (!item) throw new NotFoundException('Ingestion item not found');
    return item;
  }

  async approve(businessId: string, itemId: string, userId: string) {
    const item = await this.prisma.client.ingestionItem.findFirst({
      where: { id: itemId, businessId },
    });
    if (!item) throw new NotFoundException('Ingestion item not found');
    if (item.status === 'approved' || item.status === 'auto_executed') return item;

    const result = await this.orchestrator.execute(itemId, userId);
    if (result.status === 'error') {
      throw new BadRequestException(result.errorMessage || 'Execution failed');
    }
    return result;
  }

  async reject(businessId: string, itemId: string, userId: string, reason?: string) {
    const item = await this.prisma.client.ingestionItem.findFirst({
      where: { id: itemId, businessId },
    });
    if (!item) throw new NotFoundException('Ingestion item not found');

    return this.orchestrator.reject(itemId, userId, reason);
  }

  async correct(
    businessId: string,
    itemId: string,
    correctedActions: Record<string, unknown>[],
    note?: string,
  ) {
    const item = await this.prisma.client.ingestionItem.findFirst({
      where: { id: itemId, businessId },
    });
    if (!item) throw new NotFoundException('Ingestion item not found');

    return this.orchestrator.correct(itemId, correctedActions, note);
  }
}
