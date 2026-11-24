import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiOversightService } from './ai-oversight.service';
import {
  actorMaySee,
  actorReadsEverything,
  approvalActorOf,
  approvalItemNeeds,
  approvalItemNotFound,
  approvalItemCost,
  approvalItemsVisibleTo,
  APPROVAL_ITEM_CLASSIFY_SELECT,
  APPROVALS_CLASSIFY_BUDGET,
  type ApprovalActor,
} from './approval-item-sight';

/**
 * FU-AI-APPROVALS-MONEY-SIGHT (security): the most rows one list page reads past the ones it hands back (items the
 * member may not read are skipped), and the most rows a stats bucket reads to count, for a member who does not read
 * both revenue and expenses. Past either, the rest is withheld (fail closed): the page ends with hasMore and a cursor
 * at the last row read; the count counts what was read.
 */
const LIST_SCAN_MAX = 1_000;
const STATS_READ_MAX = 1_000;

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

  /**
   * FU-AI-APPROVALS-MONEY-SIGHT (D-100, D-234, D-238): the items `viewerId` may read (approvalItemNeeds: money needs
   * revenue read, an expense expenses read, an unclassified financial item both). Items are read in the route's order
   * and the ones the member may not read are skipped, so a page holds up to `limit` readable items and its cursor is
   * the last row read; a member who reads both is served exactly as before.
   */
  async listItems(businessId: string, query: ListAiApprovalsQuery, viewerId?: string | null): Promise<AiApprovalItemListResult> {
    const { status = 'pending', module, search, cursor, limit = 25 } = query;
    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const actor = await approvalActorOf(this.prisma, businessId, viewerId);

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

    const kept: Array<Record<string, unknown> & { id: string }> = [];
    const everything = actorReadsEverything(actor);
    if (!everything && cursor) {
      // Validate cursor belongs to this business/query and is visible to the actor so probing a hidden ID is
      // indistinguishable from an unknown/foreign cursor (SEC-3).
      const cursorRow = await this.prisma.client.aiApprovalItem.findFirst({
        where: { ...where, id: cursor },
      });
      if (!cursorRow || !actorMaySee(actor, approvalItemNeeds(cursorRow))) {
        return { items: [], nextCursor: null, hasMore: false };
      }
    }

    let after: string | undefined = cursor || undefined;
    let more = true;
    let scanned = 0;
    let spent = 0;
    const target = everything ? take : take + 1;
    while (kept.length < target && more) {
      const rows = await this.prisma.client.aiApprovalItem.findMany({
        where,
        orderBy: [{ riskTier: 'desc' }, { createdAt: 'asc' }],
        take: take + 1,
        cursor: after ? { id: after } : undefined,
        skip: after ? 1 : 0,
      });
      more = rows.length > take;
      const batch = everything && more ? rows.slice(0, take) : rows;
      if (batch.length === 0) break;
      let stopped = false;
      let lastScanned: string | null = null;
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        if (!everything) {
          // Fail closed past the scan bound or the classification budget: stop scanning, never emit a hidden ID.
          spent += approvalItemCost(row);
          if (scanned >= LIST_SCAN_MAX || spent > APPROVALS_CLASSIFY_BUDGET) {
            more = false;
            stopped = true;
            break;
          }
          scanned++;
        }
        lastScanned = row.id;
        if (everything || actorMaySee(actor, approvalItemNeeds(row))) kept.push(row);
        if (kept.length === target) {
          stopped = true;
          break;
        }
      }
      if (lastScanned) after = lastScanned;
      if (stopped) break;
    }

    if (everything) {
      const hasMore = more && kept.length > 0;
      return {
        items: kept.map((item) => this.serializeItem(item)),
        nextCursor: hasMore ? kept[kept.length - 1].id : null,
        hasMore,
      };
    }

    const hasMore = kept.length > take;
    const page = hasMore ? kept.slice(0, take) : kept;
    return {
      items: page.map((item) => this.serializeItem(item)),
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  /** FU-AI-APPROVALS-MONEY-SIGHT: an item `viewerId` may not read is answered as one not in the business. */
  async getItem(businessId: string, itemId: string, viewerId?: string | null) {
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: { id: itemId, businessId },
    });
    if (!item) throw approvalItemNotFound();
    const actor = await approvalActorOf(this.prisma, businessId, viewerId);
    if (!actorMaySee(actor, approvalItemNeeds(item))) throw approvalItemNotFound();
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

  /**
   * FU-AI-APPROVALS-MONEY-SIGHT: the counts of the items `viewerId` may read. A member who reads revenue and expenses
   * is counted in the database as before; anyone else has each bucket read (up to STATS_READ_MAX rows, within the
   * classification budget) and only the items they may read counted.
   */
  async getStats(businessId: string, viewerId?: string | null) {
    const actor = await approvalActorOf(this.prisma, businessId, viewerId);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const buckets = {
      pending: { businessId, status: 'pending' },
      approvedToday: { businessId, status: 'approved', resolvedAt: { gte: dayAgo } },
      rejectedToday: { businessId, status: 'rejected', resolvedAt: { gte: dayAgo } },
      escalated: { businessId, status: 'escalated' },
    };
    if (!actorReadsEverything(actor)) return this.statsFor(actor, buckets);

    const [pending, approvedToday, rejectedToday, escalated] = await Promise.all([
      this.prisma.client.aiApprovalItem.count({ where: buckets.pending }),
      this.prisma.client.aiApprovalItem.count({ where: buckets.approvedToday }),
      this.prisma.client.aiApprovalItem.count({ where: buckets.rejectedToday }),
      this.prisma.client.aiApprovalItem.count({ where: buckets.escalated }),
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

  private async statsFor(actor: ApprovalActor, buckets: Record<'pending' | 'approvedToday' | 'rejectedToday' | 'escalated', Record<string, unknown>>) {
    const read = (where: Record<string, unknown>) =>
      this.prisma.client.aiApprovalItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: STATS_READ_MAX,
        select: { id: true, ...APPROVAL_ITEM_CLASSIFY_SELECT },
      });
    const [pending, approvedToday, rejectedToday, escalated] = await Promise.all([
      read(buckets.pending),
      read(buckets.approvedToday),
      read(buckets.rejectedToday),
      read(buckets.escalated),
    ]);
    const visiblePending = approvalItemsVisibleTo(actor, pending);
    const byModule = new Map<string, number>();
    for (const item of visiblePending) {
      const key = item.module ?? 'unknown';
      byModule.set(key, (byModule.get(key) ?? 0) + 1);
    }
    return {
      pending: visiblePending.length,
      approvedToday: approvalItemsVisibleTo(actor, approvedToday).length,
      rejectedToday: approvalItemsVisibleTo(actor, rejectedToday).length,
      escalated: approvalItemsVisibleTo(actor, escalated).length,
      byModule: [...byModule].map(([module, count]) => ({ module, count })),
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
