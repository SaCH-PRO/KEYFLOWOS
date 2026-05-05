import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CONTACT_EVENT } from '@keyflow/shared';

const DEFAULT_STAGES: Array<{
  name: string;
  slug: string;
  position: number;
  category: 'OPEN' | 'WON' | 'LOST';
  color?: string;
}> = [
  { name: 'Lead', slug: 'lead', position: 0, category: 'OPEN', color: '#94a3b8' },
  { name: 'Qualified', slug: 'qualified', position: 1, category: 'OPEN', color: '#38bdf8' },
  { name: 'Proposal', slug: 'proposal', position: 2, category: 'OPEN', color: '#a855f7' },
  { name: 'Negotiation', slug: 'negotiation', position: 3, category: 'OPEN', color: '#f59e0b' },
  { name: 'Won', slug: 'won', position: 4, category: 'WON', color: '#10b981' },
  { name: 'Lost', slug: 'lost', position: 5, category: 'LOST', color: '#ef4444' },
];

export type DealStatus = 'OPEN' | 'WON' | 'LOST';

export type DealListFilters = {
  businessId: string;
  stageIds?: string[];
  ownerId?: string | null;
  status?: DealStatus | 'ALL';
  contactId?: string;
  minValue?: number;
  maxValue?: number;
  expectedCloseFrom?: Date;
  expectedCloseTo?: Date;
  search?: string;
  tags?: string[];
  skip?: number;
  take?: number;
};

@Injectable()
export class CrmDealsService {
  private readonly logger = new Logger(CrmDealsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  async ensureDefaultStages(businessId: string) {
    const existing = await this.prisma.client.dealStage.count({ where: { businessId } });
    if (existing > 0) return;
    await this.prisma.client.dealStage.createMany({
      data: DEFAULT_STAGES.map((s) => ({
        businessId,
        name: s.name,
        slug: s.slug,
        position: s.position,
        category: s.category,
        color: s.color ?? null,
        isDefault: true,
      })),
      skipDuplicates: true,
    });
  }

  async listStages(businessId: string) {
    await this.ensureDefaultStages(businessId);
    return this.prisma.client.dealStage.findMany({
      where: { businessId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createStage(input: { businessId: string; name: string; slug?: string; color?: string; category?: 'OPEN' | 'WON' | 'LOST'; position?: number }) {
    const trimmedName = input.name?.trim();
    if (!trimmedName) throw new BadRequestException('Stage name is required');
    const slug = (input.slug ?? trimmedName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const max = await this.prisma.client.dealStage.aggregate({
      where: { businessId: input.businessId },
      _max: { position: true },
    });
    const position = input.position ?? ((max._max.position ?? -1) + 1);
    return this.prisma.client.dealStage.create({
      data: {
        businessId: input.businessId,
        name: trimmedName,
        slug,
        color: input.color ?? null,
        category: input.category ?? 'OPEN',
        position,
      },
    });
  }

  async updateStage(input: { businessId: string; stageId: string; name?: string; color?: string; category?: 'OPEN' | 'WON' | 'LOST'; position?: number; archived?: boolean }) {
    const stage = await this.prisma.client.dealStage.findFirst({ where: { id: input.stageId, businessId: input.businessId } });
    if (!stage) throw new NotFoundException('Stage not found');
    return this.prisma.client.dealStage.update({
      where: { id: stage.id },
      data: {
        name: input.name ?? undefined,
        color: input.color ?? undefined,
        category: input.category ?? undefined,
        position: input.position ?? undefined,
        archivedAt: input.archived === true ? new Date() : input.archived === false ? null : undefined,
      },
    });
  }

  async deleteStage(input: { businessId: string; stageId: string; reassignToStageId?: string }) {
    const stage = await this.prisma.client.dealStage.findFirst({ where: { id: input.stageId, businessId: input.businessId } });
    if (!stage) throw new NotFoundException('Stage not found');
    const dealsUsing = await this.prisma.client.deal.count({ where: { stageId: stage.id, deletedAt: null } });
    if (dealsUsing > 0) {
      if (!input.reassignToStageId) {
        throw new BadRequestException('Stage has deals; provide reassignToStageId to move them first.');
      }
      const target = await this.prisma.client.dealStage.findFirst({ where: { id: input.reassignToStageId, businessId: input.businessId } });
      if (!target) throw new BadRequestException('reassignToStageId is invalid');
      await this.prisma.client.deal.updateMany({
        where: { stageId: stage.id, businessId: input.businessId },
        data: { stageId: target.id },
      });
    }
    return this.prisma.client.dealStage.delete({ where: { id: stage.id } });
  }

  private async resolveStageForCreate(businessId: string, stageId?: string) {
    if (stageId) {
      const stage = await this.prisma.client.dealStage.findFirst({ where: { id: stageId, businessId } });
      if (!stage) throw new BadRequestException('Invalid stageId');
      return stage;
    }
    await this.ensureDefaultStages(businessId);
    const first = await this.prisma.client.dealStage.findFirst({
      where: { businessId, archivedAt: null, category: 'OPEN' },
      orderBy: [{ position: 'asc' }],
    });
    if (!first) throw new BadRequestException('No deal stages configured');
    return first;
  }

  async createDeal(input: {
    businessId: string;
    contactId: string;
    title: string;
    description?: string | null;
    companyName?: string | null;
    value?: number | null;
    currency?: string;
    stageId?: string;
    ownerUserId?: string | null;
    source?: string | null;
    sourceDetail?: string | null;
    tags?: string[];
    notes?: string | null;
    expectedCloseAt?: string | null;
    probability?: number | null;
    actorId?: string;
  }) {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('title is required');
    if (!input.contactId) throw new BadRequestException('contactId is required');

    const contact = await this.prisma.client.contact.findFirst({
      where: { id: input.contactId, businessId: input.businessId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const stage = await this.resolveStageForCreate(input.businessId, input.stageId);
    const status = stage.category === 'WON' ? 'WON' : stage.category === 'LOST' ? 'LOST' : 'OPEN';

    const deal = await this.prisma.client.deal.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        title,
        description: input.description ?? null,
        companyName: input.companyName ?? contact.companyName ?? null,
        value: input.value ?? null,
        currency: input.currency ?? 'TTD',
        stageId: stage.id,
        status,
        probability: input.probability ?? null,
        ownerUserId: input.ownerUserId ?? null,
        source: input.source ?? null,
        sourceDetail: input.sourceDetail ?? null,
        tags: input.tags ?? [],
        notes: input.notes ?? null,
        expectedCloseAt: this.parseDate(input.expectedCloseAt),
        wonAt: status === 'WON' ? new Date() : null,
        lostAt: status === 'LOST' ? new Date() : null,
        lastStageChangedAt: new Date(),
      },
      include: { stage: true },
    });

    await this.timeline.logEvent(input.businessId, input.contactId, CONTACT_EVENT.DEAL_CREATED, {
      dealId: deal.id,
      title: deal.title,
      value: deal.value,
      currency: deal.currency,
      stage: { id: stage.id, name: stage.name, slug: stage.slug },
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });

    this.events.emit('crm.deal.created', { businessId: input.businessId, dealId: deal.id, contactId: input.contactId });
    return deal;
  }

  async getDeal(input: { businessId: string; dealId: string }) {
    const deal = await this.prisma.client.deal.findFirst({
      where: { id: input.dealId, businessId: input.businessId, deletedAt: null },
      include: { stage: true, contact: { select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phone: true, companyName: true } } },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  async updateDeal(input: {
    businessId: string;
    dealId: string;
    title?: string;
    description?: string | null;
    companyName?: string | null;
    value?: number | null;
    currency?: string;
    ownerUserId?: string | null;
    source?: string | null;
    sourceDetail?: string | null;
    tags?: string[];
    notes?: string | null;
    expectedCloseAt?: string | null;
    probability?: number | null;
    actorId?: string;
  }) {
    const deal = await this.getDeal({ businessId: input.businessId, dealId: input.dealId });

    const updated = await this.prisma.client.deal.update({
      where: { id: deal.id },
      data: {
        title: input.title?.trim() || undefined,
        description: input.description === undefined ? undefined : input.description,
        companyName: input.companyName === undefined ? undefined : input.companyName,
        value: input.value === undefined ? undefined : input.value,
        currency: input.currency ?? undefined,
        ownerUserId: input.ownerUserId === undefined ? undefined : input.ownerUserId,
        source: input.source === undefined ? undefined : input.source,
        sourceDetail: input.sourceDetail === undefined ? undefined : input.sourceDetail,
        tags: input.tags ?? undefined,
        notes: input.notes === undefined ? undefined : input.notes,
        expectedCloseAt: input.expectedCloseAt === undefined ? undefined : this.parseDate(input.expectedCloseAt),
        probability: input.probability === undefined ? undefined : input.probability,
      },
      include: { stage: true },
    });

    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_UPDATED, {
      dealId: deal.id,
      title: updated.title,
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });

    return updated;
  }

  async moveStage(input: { businessId: string; dealId: string; stageId: string; actorId?: string }) {
    const deal = await this.getDeal({ businessId: input.businessId, dealId: input.dealId });
    const target = await this.prisma.client.dealStage.findFirst({ where: { id: input.stageId, businessId: input.businessId } });
    if (!target) throw new BadRequestException('Invalid stageId');
    if (deal.stageId === target.id) return deal;

    const fromStage = deal.stage;
    const newStatus: DealStatus = target.category === 'WON' ? 'WON' : target.category === 'LOST' ? 'LOST' : 'OPEN';

    const updated = await this.prisma.client.deal.update({
      where: { id: deal.id },
      data: {
        stageId: target.id,
        status: newStatus,
        wonAt: newStatus === 'WON' ? (deal.wonAt ?? new Date()) : null,
        lostAt: newStatus === 'LOST' ? (deal.lostAt ?? new Date()) : null,
        lastStageChangedAt: new Date(),
      },
      include: { stage: true },
    });

    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_STAGE_CHANGED, {
      dealId: deal.id,
      title: deal.title,
      fromStage: fromStage ? { id: fromStage.id, name: fromStage.name, slug: fromStage.slug } : null,
      toStage: { id: target.id, name: target.name, slug: target.slug },
      newStatus,
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });

    if (newStatus === 'WON' && deal.status !== 'WON') {
      await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_WON, {
        dealId: deal.id, title: deal.title, value: deal.value, currency: deal.currency,
      }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    } else if (newStatus === 'LOST' && deal.status !== 'LOST') {
      await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_LOST, {
        dealId: deal.id, title: deal.title, value: deal.value, currency: deal.currency,
      }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    } else if (deal.status !== 'OPEN' && newStatus === 'OPEN') {
      await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_REOPENED, {
        dealId: deal.id, title: deal.title,
      }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    }

    return updated;
  }

  async bulkMoveStage(input: { businessId: string; dealIds: string[]; stageId: string; actorId?: string }) {
    if (!Array.isArray(input.dealIds) || input.dealIds.length === 0) {
      throw new BadRequestException('dealIds is required');
    }
    if (input.dealIds.length > 100) throw new BadRequestException('Maximum 100 deals per bulk operation');
    const results = [];
    for (const id of input.dealIds) {
      try {
        const r = await this.moveStage({ businessId: input.businessId, dealId: id, stageId: input.stageId, actorId: input.actorId });
        results.push({ id, ok: true, stageId: r.stageId, status: r.status });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return { moved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  async winDeal(input: { businessId: string; dealId: string; wonAt?: string; actualValue?: number; actorId?: string }) {
    const deal = await this.getDeal({ businessId: input.businessId, dealId: input.dealId });
    const stage = await this.prisma.client.dealStage.findFirst({
      where: { businessId: input.businessId, category: 'WON', archivedAt: null },
      orderBy: [{ position: 'asc' }],
    });
    if (!stage) throw new BadRequestException('No "Won" stage configured');
    const updated = await this.prisma.client.deal.update({
      where: { id: deal.id },
      data: {
        stageId: stage.id,
        status: 'WON',
        wonAt: this.parseDate(input.wonAt) ?? new Date(),
        lostAt: null,
        lossReason: null,
        value: input.actualValue !== undefined ? input.actualValue : undefined,
        lastStageChangedAt: new Date(),
      },
      include: { stage: true },
    });
    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_STAGE_CHANGED, {
      dealId: deal.id, title: deal.title, toStage: { id: stage.id, name: stage.name, slug: stage.slug }, newStatus: 'WON',
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_WON, {
      dealId: deal.id, title: deal.title, value: updated.value, currency: updated.currency,
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    return updated;
  }

  async loseDeal(input: { businessId: string; dealId: string; lossReason?: string; lostAt?: string; actorId?: string }) {
    const deal = await this.getDeal({ businessId: input.businessId, dealId: input.dealId });
    const stage = await this.prisma.client.dealStage.findFirst({
      where: { businessId: input.businessId, category: 'LOST', archivedAt: null },
      orderBy: [{ position: 'asc' }],
    });
    if (!stage) throw new BadRequestException('No "Lost" stage configured');
    const updated = await this.prisma.client.deal.update({
      where: { id: deal.id },
      data: {
        stageId: stage.id,
        status: 'LOST',
        lostAt: this.parseDate(input.lostAt) ?? new Date(),
        wonAt: null,
        lossReason: input.lossReason ?? null,
        lastStageChangedAt: new Date(),
      },
      include: { stage: true },
    });
    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_STAGE_CHANGED, {
      dealId: deal.id, title: deal.title, toStage: { id: stage.id, name: stage.name, slug: stage.slug }, newStatus: 'LOST',
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_LOST, {
      dealId: deal.id, title: deal.title, value: updated.value, currency: updated.currency, lossReason: updated.lossReason,
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    return updated;
  }

  async deleteDeal(input: { businessId: string; dealId: string; actorId?: string }) {
    const deal = await this.getDeal({ businessId: input.businessId, dealId: input.dealId });
    await this.prisma.client.deal.update({
      where: { id: deal.id },
      data: { deletedAt: new Date() },
    });
    await this.timeline.logEvent(input.businessId, deal.contactId, CONTACT_EVENT.DEAL_DELETED, {
      dealId: deal.id, title: deal.title,
    }, { actorType: 'USER', actorId: input.actorId, source: 'crm' });
    return { ok: true };
  }

  async listDeals(input: DealListFilters) {
    const where: Prisma.DealWhereInput = {
      businessId: input.businessId,
      deletedAt: null,
    };
    if (input.contactId) where.contactId = input.contactId;
    if (input.stageIds && input.stageIds.length > 0) where.stageId = { in: input.stageIds };
    if (input.ownerId) where.ownerUserId = input.ownerId;
    if (input.status && input.status !== 'ALL') where.status = input.status;
    if (input.tags && input.tags.length > 0) where.tags = { hasSome: input.tags };
    if (input.minValue != null || input.maxValue != null) {
      const valueFilter: Prisma.FloatNullableFilter = {};
      if (input.minValue != null) valueFilter.gte = input.minValue;
      if (input.maxValue != null) valueFilter.lte = input.maxValue;
      where.value = valueFilter;
    }
    if (input.expectedCloseFrom || input.expectedCloseTo) {
      const dateFilter: Prisma.DateTimeNullableFilter = {};
      if (input.expectedCloseFrom) dateFilter.gte = input.expectedCloseFrom;
      if (input.expectedCloseTo) dateFilter.lte = input.expectedCloseTo;
      where.expectedCloseAt = dateFilter;
    }
    if (input.search) {
      const s = input.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { companyName: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { notes: { contains: s, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(input.take ?? 50, 200);
    const skip = input.skip ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.client.deal.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip,
        take,
        include: {
          stage: true,
          contact: { select: { id: true, firstName: true, lastName: true, displayName: true, email: true, companyName: true } },
        },
      }),
      this.prisma.client.deal.count({ where }),
    ]);
    return { deals: items, total, skip, take };
  }

  async listContactDeals(input: { businessId: string; contactId: string; status?: DealStatus | 'ALL' }) {
    const where: Prisma.DealWhereInput = {
      businessId: input.businessId,
      contactId: input.contactId,
      deletedAt: null,
    };
    if (input.status && input.status !== 'ALL') where.status = input.status;
    return this.prisma.client.deal.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: { stage: true },
    });
  }

  async getHighestOpenDealsForContacts(businessId: string, contactIds: string[]) {
    if (contactIds.length === 0) return new Map<string, { id: string; title: string; value: number | null; stage: { id: string; name: string; slug: string } }>();
    const deals = await this.prisma.client.deal.findMany({
      where: { businessId, contactId: { in: contactIds }, status: 'OPEN', deletedAt: null },
      orderBy: [{ value: 'desc' }],
      include: { stage: { select: { id: true, name: true, slug: true } } },
    });
    const map = new Map<string, { id: string; title: string; value: number | null; stage: { id: string; name: string; slug: string } }>();
    for (const d of deals) {
      if (!map.has(d.contactId)) {
        map.set(d.contactId, { id: d.id, title: d.title, value: d.value, stage: d.stage });
      }
    }
    return map;
  }

  private parseDate(input?: string | null) {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
