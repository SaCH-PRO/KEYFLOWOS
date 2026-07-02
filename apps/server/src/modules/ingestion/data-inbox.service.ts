import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { ListIngestionItemsQuery } from './dto/ingestion-item.dto';

export interface IngestionItemListResult {
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class DataInboxService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestionOrchestrator) private readonly orchestrator: IngestionOrchestrator,
  ) {}

  async listItems(businessId: string, query: ListIngestionItemsQuery): Promise<IngestionItemListResult> {
    const {
      status,
      sourceType,
      intentType,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      cursor,
      limit = 25,
    } = query;

    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const orderBy: Prisma.IngestionItemOrderByWithRelationInput = {
      [sortBy === 'confidence' ? 'confidence' : sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt']:
        sortOrder,
    };

    const where: Prisma.IngestionItemWhereInput = { businessId };
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    if (intentType) where.intentType = { contains: intentType, mode: 'insensitive' };

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { subject: { contains: term, mode: 'insensitive' } },
        { body: { contains: term, mode: 'insensitive' } },
        { summary: { contains: term, mode: 'insensitive' } },
        { fromName: { contains: term, mode: 'insensitive' } },
        { fromEmail: { contains: term, mode: 'insensitive' } },
        { fromPhone: { contains: term, mode: 'insensitive' } },
        { intentType: { contains: term, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.client.ingestionItem.findMany({
      where,
      orderBy,
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
    const item = await this.prisma.client.ingestionItem.findFirst({
      where: { id: itemId, businessId },
    });
    if (!item) throw new NotFoundException('Ingestion item not found');
    return this.serializeItem(item);
  }

  async approveItem(businessId: string, itemId: string, userId: string) {
    await this.guardOwnership(businessId, itemId);
    return this.orchestrator.execute(itemId, userId || 'user');
  }

  async rejectItem(businessId: string, itemId: string, reason?: string) {
    await this.guardOwnership(businessId, itemId);
    return this.orchestrator.reject(itemId, 'user', reason);
  }

  async correctItem(
    businessId: string,
    itemId: string,
    correctedActions: unknown[],
    note?: string,
  ) {
    await this.guardOwnership(businessId, itemId);
    if (!Array.isArray(correctedActions) || correctedActions.length === 0) {
      throw new BadRequestException('correctedActions must be a non-empty array');
    }
    return this.orchestrator.correct(itemId, correctedActions as Record<string, unknown>[], note);
  }

  private async guardOwnership(businessId: string, itemId: string) {
    const item = await this.prisma.client.ingestionItem.findFirst({
      where: { id: itemId, businessId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Ingestion item not found');
  }

  private serializeItem(item: Record<string, unknown>) {
    return {
      ...item,
      attachments: item.attachments ?? [],
      extractedData: item.extractedData ?? {},
      proposedActions: item.proposedActions ?? [],
      userFeedback: item.userFeedback ?? null,
      executedResults: item.executedResults ?? null,
    };
  }
}
