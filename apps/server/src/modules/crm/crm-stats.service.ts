import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Contact, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';

export type TopOpenDeal = {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  stage: { id: string; name: string; slug: string };
};

export type ContactMeta = {
  outstandingBalance: number;
  unpaidInvoices: number;
  paidInvoices: number;
  oldestUnpaidInvoiceDueAt: Date | null;
  lastInteractionAt: Date;
  nextDueTaskAt: Date | null;
  overdueTasks: number;
  overdueBookings: number;
  bookingsRecent: number;
  leadScore: number;
  totalRevenue: number;
  invoiceCount: number;
  bookingCount: number;
  openDealsCount?: number;
  openDealsValue?: number;
  topOpenDeal?: TopOpenDeal | null;
  aiDominantSentiment?: string | null;
  aiLastIntent?: string | null;
};

export type ContactWithStats = Contact & {
  meta?: ContactMeta;
};

type ContactHighlight = {
  contactId: string;
  name: string;
  status: string;
  leadScore: number;
  outstandingBalance: number;
  unpaidInvoices: number;
  lastInteractionAt: Date | null;
  tags: string[];
};

type ServiceAffinity = {
  serviceId: string;
  serviceName: string;
  bookings: number;
  revenue: number;
  topContact?: {
    id: string;
    name: string;
    bookings: number;
  };
};

type SegmentInsight = {
  key: string;
  label: string;
  description: string;
  count: number;
  contacts: ContactWithStats[];
};

type TimelineEntry = {
  id: string;
  type: 'event' | 'note' | 'task' | 'invoice' | 'booking';
  contactId: string;
  contactName?: string;
  contactEmail?: string | null;
  title: string;
  description?: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
};

type NextActionSeverity = 'high' | 'medium' | 'info';

type NextAction = {
  id: string;
  contactId: string;
  contactName?: string;
  title: string;
  detail: string;
  severity: NextActionSeverity;
  trigger: string;
};

type AiNextAction = {
  type: 'follow_up' | 'send_quote' | 'payment_reminder' | 'add_note';
  contactId: string;
  contactName: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
};

type FlowHighlightsPayload = {
  highlights: {
    highPotential: ContactHighlight[];
    overdueReminders: ContactHighlight[];
    serviceAffinity: ServiceAffinity[];
  };
  segments: SegmentInsight[];
  timeline: TimelineEntry[];
  nextActions: NextAction[];
  aiNextActions: AiNextAction[];
};

@Injectable()
export class CrmStatsService {
  private readonly logger = new Logger(CrmStatsService.name);
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheMisses++;
      return null;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.cacheMisses++;
      return null;
    }
    this.cacheHits++;
    return entry.data as T;
  }

  private setCache(key: string, data: any, ttlMs = 60000): void {
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
  }

  invalidateCache(businessId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${businessId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  getCacheMetrics() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? Math.round((this.cacheHits / total) * 100) : 0,
      size: this.cache.size,
    };
  }

  private formatContactName(contact: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    if (contact.displayName && contact.displayName.trim()) return contact.displayName.trim();
    const full = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (full) return full;
    if (contact.email) return contact.email;
    if (contact.phone) return contact.phone;
    return 'Unnamed';
  }

  private async assertContact(businessId: string, contactId: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  async getContactStats(businessId: string) {
    const cacheKey = `${businessId}:getContactStats`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const totalCount = await this.prisma.client.contact.count({
      where: contactWhereBase(businessId),
    });

    const statusGroups = await this.prisma.client.contact.groupBy({
      by: ['status'],
      where: contactWhereBase(businessId),
      _count: { id: true },
    });
    const countByStatus: Record<string, number> = { LEAD: 0, PROSPECT: 0, CLIENT: 0, LOST: 0 };
    for (const g of statusGroups) {
      countByStatus[g.status] = g._count.id;
    }

    const sourceGroups = await this.prisma.client.contact.groupBy({
      by: ['source'],
      where: contactWhereBase(businessId),
      _count: { id: true },
    });
    const countBySource = sourceGroups.map((g) => ({
      source: g.source ?? 'unknown',
      count: g._count.id,
    }));

    const recentGrowth: { week: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - i * 7);
      weekStart.setHours(0, 0, 0, 0);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
      weekStart.setDate(diff);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const count = await this.prisma.client.contact.count({
        where: {
          ...contactWhereBase(businessId),
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      });
      recentGrowth.push({ week: weekStart.toISOString(), count });
    }

    const allContacts = await this.prisma.client.contact.findMany({
      where: contactWhereBase(businessId),
      select: { tags: true },
    });
    const tagCounts = new Map<string, number>();
    for (const c of allContacts) {
      for (const tag of c.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const result = { totalCount, countByStatus, countBySource, recentGrowth, topTags };
    this.setCache(cacheKey, result);
    return result;
  }

  async attachContactStats(businessId: string, contacts: Contact[]): Promise<ContactWithStats[]> {
    const ids = contacts.map((c) => c.id);
    const [invoices, tasks, events, notes, bookings, openDeals] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { businessId, contactId: { in: ids }, deletedAt: null },
        select: {
          id: true,
          contactId: true,
          status: true,
          total: true,
          currency: true,
          dueDate: true,
          issueDate: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId, contactId: { in: ids } },
        select: { contactId: true, status: true, dueDate: true, createdAt: true },
      }),
      this.prisma.client.contactEvent.findMany({
        where: { businessId, contactId: { in: ids } },
        select: { contactId: true, createdAt: true },
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId, contactId: { in: ids } },
        select: { contactId: true, createdAt: true },
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, contactId: { in: ids }, deletedAt: null },
        select: { contactId: true, status: true, startTime: true },
      }),
      this.prisma.client.deal.findMany({
        where: { businessId, contactId: { in: ids }, status: 'OPEN', deletedAt: null },
        orderBy: [{ value: 'desc' }],
        select: {
          id: true,
          contactId: true,
          title: true,
          value: true,
          currency: true,
          stage: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    const statsMap = new Map<string, ContactMeta>();
    for (const contact of contacts) {
      statsMap.set(contact.id, {
        outstandingBalance: 0,
        unpaidInvoices: 0,
        paidInvoices: 0,
        oldestUnpaidInvoiceDueAt: null,
        lastInteractionAt: contact.updatedAt,
        nextDueTaskAt: null,
        overdueTasks: 0,
        overdueBookings: 0,
        bookingsRecent: 0,
        leadScore: 50,
        totalRevenue: 0,
        invoiceCount: 0,
        bookingCount: 0,
        openDealsCount: 0,
        openDealsValue: 0,
        topOpenDeal: null,
      });
    }

    for (const deal of openDeals) {
      const stats = statsMap.get(deal.contactId);
      if (!stats) continue;
      stats.openDealsCount = (stats.openDealsCount ?? 0) + 1;
      stats.openDealsValue = (stats.openDealsValue ?? 0) + Number(deal.value ?? 0);
      if (!stats.topOpenDeal) {
        stats.topOpenDeal = {
          id: deal.id,
          title: deal.title,
          value: deal.value,
          currency: deal.currency,
          stage: deal.stage,
        };
      }
    }

    const now = new Date();
    invoices.forEach((inv) => {
      const stats = statsMap.get(inv.contactId);
      if (!stats) return;
      stats.invoiceCount += 1;
      if (['SENT', 'OVERDUE'].includes(inv.status)) {
        stats.outstandingBalance += Number(inv.total ?? 0);
        stats.unpaidInvoices += 1;
        const dueDate = inv.dueDate ?? inv.issueDate ?? inv.createdAt;
        if (dueDate) {
          if (!stats.oldestUnpaidInvoiceDueAt || dueDate < stats.oldestUnpaidInvoiceDueAt) {
            stats.oldestUnpaidInvoiceDueAt = dueDate;
          }
        }
      }
      if (inv.status === 'PAID') {
        stats.paidInvoices += 1;
        stats.totalRevenue += Number(inv.total ?? 0);
      }
    });

    tasks.forEach((task) => {
      const stats = statsMap.get(task.contactId);
      if (!stats) return;
      if (task.status !== 'DONE' && task.dueDate) {
        const due = new Date(task.dueDate);
        if (!stats.nextDueTaskAt || due < stats.nextDueTaskAt) stats.nextDueTaskAt = due;
        if (due < now) stats.overdueTasks += 1;
      }
      if (task.createdAt > stats.lastInteractionAt) stats.lastInteractionAt = task.createdAt;
    });

    events.forEach((event) => {
      const stats = statsMap.get(event.contactId);
      if (stats && event.createdAt > stats.lastInteractionAt) stats.lastInteractionAt = event.createdAt;
    });
    notes.forEach((note) => {
      const stats = statsMap.get(note.contactId);
      if (stats && note.createdAt > stats.lastInteractionAt) stats.lastInteractionAt = note.createdAt;
    });
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 14);
    bookings.forEach((booking) => {
      const stats = statsMap.get(booking.contactId);
      if (!stats) return;
      stats.bookingCount += 1;
      if (booking.status === 'COMPLETED' && booking.startTime > recentCutoff) stats.bookingsRecent += 1;
      if (booking.status === 'PENDING' && booking.startTime < now) stats.overdueBookings += 1;
      if (booking.startTime > stats.lastInteractionAt) stats.lastInteractionAt = booking.startTime;
    });

    // Latest AI rollup per contact (best-effort; failure is silent).
    const aiRollupMap = new Map<string, { sentiment: string | null; intent: string | null }>();
    try {
      const latestInsights = await this.prisma.client.conversationAIInsight.findMany({
        where: { businessId, contactId: { in: ids }, kind: 'message_analysis' },
        orderBy: { createdAt: 'desc' },
        take: ids.length * 5,
        select: { contactId: true, payload: true, createdAt: true },
      });
      for (const ins of latestInsights) {
        if (aiRollupMap.has(ins.contactId)) continue;
        const p = (ins.payload ?? {}) as { sentiment?: string | null; intent?: string | null };
        aiRollupMap.set(ins.contactId, { sentiment: p.sentiment ?? null, intent: p.intent ?? null });
      }
    } catch {
      // ignore
    }

    const updates: { id: string; leadScore: number; lastInteractionAt: Date }[] = [];
    const withStats = contacts.map((contact) => {
      const stats = statsMap.get(contact.id);
      if (!stats) return contact;
      const leadScore =
        50 +
        stats.bookingsRecent * 15 +
        stats.paidInvoices * 10 -
        stats.unpaidInvoices * 5 -
        stats.overdueTasks * 5 +
        (contact.status === 'CLIENT' ? 5 : 0);
      stats.leadScore = leadScore;
      const ai = aiRollupMap.get(contact.id);
      if (ai) {
        stats.aiDominantSentiment = ai.sentiment;
        stats.aiLastIntent = ai.intent;
      }
      if (
        contact.leadScore !== leadScore ||
        !contact.lastInteractionAt ||
        contact.lastInteractionAt.getTime() !== stats.lastInteractionAt.getTime()
      ) {
        updates.push({ id: contact.id, leadScore, lastInteractionAt: stats.lastInteractionAt });
      }
      return {
        ...contact,
        meta: stats,
      };
    });
    if (updates.length > 0) {
      void this.prisma.client.$transaction(
        updates.map((u) =>
          this.prisma.client.contact.update({
            where: { id: u.id },
            data: { leadScore: u.leadScore, lastInteractionAt: u.lastInteractionAt },
          }),
        ),
      ).catch((err) => {
        this.logger.warn('Background lead score update failed', (err as Error).message);
      });
    }
    return withStats;
  }

  async findDuplicates(businessId: string) {
    const contacts = await this.prisma.client.contact.findMany({
      where: contactWhereBase(businessId),
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        emailNormalized: true,
        phone: true,
        phoneNormalized: true,
        status: true,
        companyName: true,
        source: true,
        createdAt: true,
      },
    });

    type DuplicateGroup = {
      field: 'email' | 'phone' | 'name';
      value: string;
      contacts: typeof contacts;
    };

    const groups: DuplicateGroup[] = [];
    const seenKeys = new Set<string>();

    const emailMap = new Map<string, typeof contacts>();
    const phoneMap = new Map<string, typeof contacts>();
    const nameMap = new Map<string, typeof contacts>();

    for (const contact of contacts) {
      if (contact.emailNormalized) {
        const key = contact.emailNormalized;
        if (!emailMap.has(key)) emailMap.set(key, []);
        emailMap.get(key)!.push(contact);
      }

      if (contact.phoneNormalized) {
        const key = contact.phoneNormalized;
        if (!phoneMap.has(key)) phoneMap.set(key, []);
        phoneMap.get(key)!.push(contact);
      }

      const firstName = (contact.firstName ?? '').trim().toLowerCase();
      const lastName = (contact.lastName ?? '').trim().toLowerCase();
      if (firstName && lastName) {
        const key = `${firstName}|${lastName}`;
        if (!nameMap.has(key)) nameMap.set(key, []);
        nameMap.get(key)!.push(contact);
      }
    }

    for (const [value, dupes] of emailMap) {
      if (dupes.length > 1) {
        const key = `email:${value}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          groups.push({ field: 'email', value, contacts: dupes });
        }
      }
    }

    for (const [value, dupes] of phoneMap) {
      if (dupes.length > 1) {
        const key = `phone:${value}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          groups.push({ field: 'phone', value, contacts: dupes });
        }
      }
    }

    for (const [value, dupes] of nameMap) {
      if (dupes.length > 1) {
        const contactIds = new Set(dupes.map((c) => c.id));
        const alreadyCovered = groups.some(
          (g) => g.contacts.length === dupes.length && g.contacts.every((c) => contactIds.has(c.id)),
        );
        if (!alreadyCovered) {
          const key = `name:${value}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            groups.push({ field: 'name', value, contacts: dupes });
          }
        }
      }
    }

    return { groups: groups.slice(0, 20) };
  }

  async contactDetail(params: { businessId: string; contactId: string }) {
    const contact = await this.assertContact(params.businessId, params.contactId);
    const [events, notes, tasks, invoices, bookings] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.contactNote.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.contactTask.findMany({
        where: { businessId: params.businessId, contactId: params.contactId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId: params.businessId, contactId: params.contactId, deletedAt: null },
        select: {
          id: true,
          status: true,
          total: true,
          currency: true,
          dueDate: true,
          issueDate: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      this.prisma.client.booking.findMany({
        where: { businessId: params.businessId, contactId: params.contactId, deletedAt: null },
        select: { id: true, status: true, startTime: true, endTime: true, serviceId: true, staffId: true },
      }),
    ]);

    const meta: ContactMeta = {
      outstandingBalance: 0,
      unpaidInvoices: 0,
      paidInvoices: 0,
      oldestUnpaidInvoiceDueAt: null,
      lastInteractionAt: contact.updatedAt,
      nextDueTaskAt: null,
      overdueTasks: 0,
      overdueBookings: 0,
      bookingsRecent: 0,
      leadScore: 50,
      totalRevenue: 0,
      invoiceCount: 0,
      bookingCount: 0,
    };

    const now = new Date();
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 14);

    for (const inv of invoices) {
      meta.invoiceCount += 1;
      if (['SENT', 'OVERDUE'].includes(inv.status)) {
        meta.outstandingBalance += Number(inv.total ?? 0);
        meta.unpaidInvoices += 1;
        const dueDate = inv.dueDate ?? inv.issueDate ?? inv.createdAt;
        if (dueDate) {
          if (!meta.oldestUnpaidInvoiceDueAt || dueDate < meta.oldestUnpaidInvoiceDueAt) {
            meta.oldestUnpaidInvoiceDueAt = dueDate;
          }
        }
      }
      if (inv.status === 'PAID') {
        meta.paidInvoices += 1;
        meta.totalRevenue += Number(inv.total ?? 0);
      }
    }

    for (const task of tasks) {
      if (task.status !== 'DONE' && task.dueDate) {
        const due = new Date(task.dueDate);
        if (!meta.nextDueTaskAt || due < meta.nextDueTaskAt) meta.nextDueTaskAt = due;
        if (due < now) meta.overdueTasks += 1;
      }
      if (task.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = task.createdAt;
    }

    for (const event of events) {
      if (event.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = event.createdAt;
    }
    for (const note of notes) {
      if (note.createdAt > meta.lastInteractionAt) meta.lastInteractionAt = note.createdAt;
    }
    for (const booking of bookings) {
      meta.bookingCount += 1;
      if (booking.status === 'COMPLETED' && booking.startTime > recentCutoff) meta.bookingsRecent += 1;
      if (booking.status === 'PENDING' && booking.startTime < now) meta.overdueBookings += 1;
      if (booking.startTime > meta.lastInteractionAt) meta.lastInteractionAt = booking.startTime;
    }

    meta.leadScore =
      50 +
      meta.bookingsRecent * 15 +
      meta.paidInvoices * 10 -
      meta.unpaidInvoices * 5 -
      meta.overdueTasks * 5 +
      (contact.status === 'CLIENT' ? 5 : 0);

    return { contact, events, notes, tasks, invoices, bookings, meta };
  }

  async segmentSummary(input: { businessId: string }) {
    const cacheKey = `${input.businessId}:segmentSummary`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const base = contactWhereBase(input.businessId);
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 30);

    const [lead, prospect, client, lost, unpaid, stale, newThisWeek, atRisk, dormant] = await Promise.all([
      this.prisma.client.contact.count({ where: { ...base, status: 'LEAD' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'PROSPECT' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'CLIENT' } }),
      this.prisma.client.contact.count({ where: { ...base, status: 'LOST' } }),
      this.prisma.client.contact.count({
        where: { ...base, invoices: { some: { status: { in: ['SENT', 'OVERDUE'] }, deletedAt: null } } },
      }),
      this.prisma.client.contact.count({
        where: {
          ...base,
          createdAt: { lte: staleCutoff },
          bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } },
        },
      }),
      this.prisma.client.contact.count({ where: { ...base, createdAt: { gte: start } } }),
      this.prisma.client.contact.count({ where: { ...base, relationshipHealth: 'AT_RISK' } }),
      this.prisma.client.contact.count({ where: { ...base, relationshipHealth: 'DORMANT' } }),
    ]);
    const segResult = { lead, prospect, client, lost, unpaid, stale, newThisWeek, atRisk, dormant };
    this.setCache(cacheKey, segResult);
    return segResult;
  }

  async flowHighlights(input: { businessId: string }): Promise<FlowHighlightsPayload> {
    const cacheKey = `${input.businessId}:flowHighlights`;
    const cached = this.getCached<FlowHighlightsPayload>(cacheKey);
    if (cached) return cached;

    const rawContacts = await this.prisma.client.contact.findMany({
      where: contactWhereBase(input.businessId),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const contacts = rawContacts.length > 0
      ? await this.attachContactStats(input.businessId, rawContacts)
      : [];
    const [segments, serviceAffinity, timeline] = await Promise.all([
      this.buildSegmentInsights(input.businessId),
      this.buildServiceAffinity(input.businessId),
      this.timeline.buildTimeline(input.businessId),
    ]);
    const flowResult = {
      highlights: {
        highPotential: this.buildHighlightCards(contacts, 4, (meta) => meta.leadScore),
        overdueReminders: this.buildHighlightCards(
          contacts,
          4,
          (meta) => meta.outstandingBalance,
          (contact) => (contact.meta?.outstandingBalance ?? 0) > 0,
        ),
        serviceAffinity,
      },
      segments,
      timeline,
      nextActions: this.buildNextActions(contacts),
      aiNextActions: [],
    };
    this.setCache(cacheKey, flowResult);
    return flowResult;
  }

  async getContactsPollState(businessId: string) {
    const [result, totalCount] = await Promise.all([
      this.prisma.client.contact.aggregate({
        where: contactWhereBase(businessId),
        _max: { updatedAt: true },
      }),
      this.prisma.client.contact.count({
        where: contactWhereBase(businessId),
      }),
    ]);
    return {
      lastUpdatedAt: result._max.updatedAt?.toISOString() ?? null,
      totalCount,
    };
  }

  async toggleFavorite(businessId: string, contactId: string) {
    const contact = await this.assertContact(businessId, contactId);
    const custom = (contact.custom as Record<string, unknown>) ?? {};
    const isFavorite = !custom.isFavorite;
    const updatedCustom = { ...custom, isFavorite };
    const updated = await this.prisma.client.contact.update({
      where: { id: contactId },
      data: { custom: updatedCustom },
    });
    return { isFavorite, contact: updated };
  }

  async getFavorites(businessId: string) {
    const allContacts = await this.prisma.client.contact.findMany({
      where: contactWhereBase(businessId),
      orderBy: { updatedAt: 'desc' },
    });
    return allContacts.filter((c) => {
      const custom = c.custom as Record<string, unknown> | null;
      return custom?.isFavorite === true;
    });
  }

  private buildHighlightCards(
    contacts: ContactWithStats[],
    limit: number,
    metric: (meta: ContactMeta) => number,
    filter: (contact: ContactWithStats) => boolean = () => true,
  ): ContactHighlight[] {
    const filtered = contacts.filter((contact) => contact.meta && filter(contact));
    return filtered
      .sort((a, b) => metric(b.meta!) - metric(a.meta!))
      .slice(0, limit)
      .map((contact) => this.contactToHighlight(contact));
  }

  private contactToHighlight(contact: ContactWithStats): ContactHighlight {
    const meta = contact.meta;
    return {
      contactId: contact.id,
      name: this.formatContactName(contact),
      status: contact.status,
      leadScore: meta?.leadScore ?? 50,
      outstandingBalance: meta?.outstandingBalance ?? 0,
      unpaidInvoices: meta?.unpaidInvoices ?? 0,
      lastInteractionAt: meta?.lastInteractionAt ?? null,
      tags: contact.tags ?? [],
    };
  }

  private async buildSegmentInsights(businessId: string): Promise<SegmentInsight[]> {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 21);

    const definitions: Array<{
      key: string;
      label: string;
      description: string;
      take?: number;
      countWhere: Prisma.ContactWhereInput;
    }> = [
      {
        key: 'new-this-week',
        label: 'New this week',
        description: 'Fresh leads created since the start of the week',
        take: 6,
        countWhere: { ...contactWhereBase(businessId), createdAt: { gte: startOfWeek } },
      },
      {
        key: 'cold-with-unpaid',
        label: 'Cold leads with unpaid invoices',
        description: 'No recent activity plus outstanding invoices',
        countWhere: {
          ...contactWhereBase(businessId),
          invoices: {
            some: {
              status: { in: ['SENT', 'OVERDUE'] as string[] },
              deletedAt: null,
            },
          },
          bookings: { none: { startTime: { gte: staleCutoff }, deletedAt: null } },
        },
      },
      {
        key: 'top-clients',
        label: 'Top clients',
        description: 'Clients who book and pay frequently',
        countWhere: { ...contactWhereBase(businessId), status: 'CLIENT' },
      },
    ];

    const insights: SegmentInsight[] = [];
    for (const def of definitions) {
      const take = def.take ?? 6;
      const [rawContacts, count] = await Promise.all([
        this.prisma.client.contact.findMany({
          where: def.countWhere,
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.client.contact.count({ where: def.countWhere }),
      ]);
      const contactsWithStats = rawContacts.length > 0
        ? await this.attachContactStats(businessId, rawContacts)
        : [];
      insights.push({
        key: def.key,
        label: def.label,
        description: def.description,
        count,
        contacts: contactsWithStats.slice(0, 6),
      });
    }
    return insights;
  }

  private async buildServiceAffinity(businessId: string): Promise<ServiceAffinity[]> {
    const serviceStats = await this.prisma.client.booking.groupBy({
      by: ['serviceId'],
      where: { businessId, deletedAt: null },
      _count: { serviceId: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: 5,
    });
    if (serviceStats.length === 0) return [];
    const serviceIds = serviceStats.map((stat) => stat.serviceId);
    const services = await this.prisma.client.service.findMany({
      where: { id: { in: serviceIds } },
    });
    const serviceMap = new Map(services.map((service) => [service.id, service]));
    const contactStats = await this.prisma.client.booking.groupBy({
      by: ['serviceId', 'contactId'],
      where: { businessId, deletedAt: null, serviceId: { in: serviceIds } },
      _count: { contactId: true },
    });
    const contactIds = Array.from(new Set(contactStats.map((stat) => stat.contactId)));
    const contacts = await this.prisma.client.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));

    const affinity = serviceStats.map((stat) => {
      const service = serviceMap.get(stat.serviceId);
      if (!service) return null;
      const bestContact = contactStats
        .filter((entry) => entry.serviceId === stat.serviceId)
        .sort((a, b) => b._count.contactId - a._count.contactId)[0];
      const topContact = bestContact ? contactMap.get(bestContact.contactId) : undefined;
      const entry: ServiceAffinity = {
        serviceId: service.id,
        serviceName: service.name,
        bookings: stat._count.serviceId,
        revenue: stat._count.serviceId * service.price,
      };
      if (topContact) {
        entry.topContact = {
          id: topContact.id,
          name: this.formatContactName(topContact),
          bookings: bestContact?._count.contactId ?? 0,
        };
      }
      return entry;
    });
    return affinity.filter((entry): entry is ServiceAffinity => entry !== null);
  }

  private buildNextActions(contacts: ContactWithStats[]): NextAction[] {
    const actions: NextAction[] = [];
    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - 7);
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const now = new Date();
    const pushAction = (action: NextAction) => {
      if (actions.length >= 6) return;
      actions.push(action);
    };

    for (const contact of contacts) {
      if (!contact.meta) continue;
      const {
        outstandingBalance,
        lastInteractionAt,
        nextDueTaskAt,
        overdueTasks,
        overdueBookings,
        oldestUnpaidInvoiceDueAt,
      } = contact.meta;
      const contactName = this.formatContactName(contact);
      if (outstandingBalance > 0) {
        const overdue = oldestUnpaidInvoiceDueAt ? oldestUnpaidInvoiceDueAt < now : false;
        const dueLabel = oldestUnpaidInvoiceDueAt
          ? `Oldest due ${oldestUnpaidInvoiceDueAt.toLocaleDateString()}`
          : `Outstanding balance of ${outstandingBalance.toFixed(2)}`;
        pushAction({
          id: `${contact.id}-invoice`,
          contactId: contact.id,
          contactName,
          title: overdue ? 'Overdue invoice follow-up' : 'Invoice payment follow-up',
          detail: dueLabel,
          severity: overdue ? 'high' : 'medium',
          trigger: 'invoice-unpaid',
        });
      }
      if (overdueBookings > 0) {
        pushAction({
          id: `${contact.id}-booking`,
          contactId: contact.id,
          contactName,
          title: 'Confirm overdue booking',
          detail: `${overdueBookings} booking${overdueBookings > 1 ? 's' : ''} awaiting confirmation`,
          severity: 'high',
          trigger: 'booking-overdue',
        });
      }
      if (overdueTasks > 0) {
        pushAction({
          id: `${contact.id}-task-overdue`,
          contactId: contact.id,
          contactName,
          title: 'Overdue tasks',
          detail: `${overdueTasks} task${overdueTasks > 1 ? 's' : ''} overdue`,
          severity: 'medium',
          trigger: 'task-overdue',
        });
      }
      if (lastInteractionAt <= staleCutoff) {
        pushAction({
          id: `${contact.id}-stale`,
          contactId: contact.id,
          contactName,
          title: 'Re-engage stale contact',
          detail: `No interaction since ${lastInteractionAt.toLocaleDateString()}`,
          severity: 'medium',
          trigger: 'stale-contact',
        });
      }
      if (nextDueTaskAt && nextDueTaskAt <= soon) {
        pushAction({
          id: `${contact.id}-task`,
          contactId: contact.id,
          contactName,
          title: 'Task due soon',
          detail: `Next task due ${nextDueTaskAt.toLocaleDateString()}`,
          severity: 'medium',
          trigger: 'upcoming-task',
        });
      }
      if (actions.length >= 6) break;
    }

    return actions;
  }
}
