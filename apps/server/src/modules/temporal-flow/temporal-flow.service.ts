import { ForbiddenException, Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import type {
  TemporalFlowAnalysis,
  TemporalFlowEventInput,
  TemporalFlowGenomeCandidate,
  TemporalFlowMemoryInsight,
} from './temporal-flow.types';

export interface TemporalFlowListQuery {
  source?: string;
  type?: string;
  module?: string;
  status?: string;
  importance?: string;
  genomeImpactPotential?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE (NAV-A1 security review; D-100, D-179): who reads the timeline. The member a request
 * acts for (AuthMiddleware's `req.user`). A read given a reader's filter answers only the events of the modules they
 * may read. A call given none reads as before: TemporalFlowController's routes pass one; the other callers (the
 * command center snapshot, the executive brief and KEY modes, KEY's timeline tools, the genome evolution's signals)
 * do not yet, and are the review's follow-ups (FU-TEMPORAL-FLOW-INBOX-SCOPE review N-1), not readers this rule covers.
 */
export type TemporalFlowReader = { id?: string; role?: string } | null | undefined;

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE: the modules that own timeline events. Withholding is computed over these only, so a
 * reader who reads all four (the owner, an ADMIN or STAFF member on role defaults) sees every event, as before
 * (orchestrator delta M-1: a module none for every role, such as connect, withholds nothing).
 */
const EVENT_OWNERS = ['operations', 'bookings', 'revenue', 'storefront'] as const;
type EventOwner = (typeof EVENT_OWNERS)[number];

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE: how an event names the module that owns it, by its `module`, its `source` and its
 * `type` (case-insensitive). An event names a module when any of the three does; a reader sees it only when they read
 * every module it names. Every writer of the timeline, and the module its own reads require:
 *   - TemporalFlowKeyInboxListener: module key_inbox, type key_inbox.*, source key_inbox or the thread's channel
 *     (whatsapp, instagram, email, ...) -> operations (KeyInboxController: @RequireModuleScope('operations'));
 *   - GoogleCalendarTemporalSyncService: module calendar, source GOOGLE_CALENDAR, type google_calendar.* ->
 *     bookings (CalendarController's event reads: bookings read); booking.* types too;
 *   - money-bearing types (invoice.*, payment.*, ...) and a module that names finance -> revenue (D-100);
 *   - KEY's timeline notes and reminders (KeyCortex temporal_flow.create_event / set_reminder: source key_cortex,
 *     free text that can carry money) -> revenue, unless their module names another owner or a business-wide module;
 *   - Shopify events (source SHOPIFY, type shopify.*) -> storefront and revenue (orders are money);
 *   - business-wide (BUSINESS_WIDE, their owners' own reads being membership only): BusinessAssetsService (module
 *     business-assets), BlueprintService and ConstitutionVersionService (module business-genome), the KEY action
 *     services (module key-autonomy), and an event recorded by hand (source MANUAL, the Schedule hub's form);
 *   - anything else (an unknown module, source or type: WEBHOOK, module connect, an unclassified APP type) fails
 *     closed (D-63, D-227, D-234): it is withheld from a reader who misses any event-owning module.
 * A `_` in a pattern is a one-character wildcard to ILIKE: it can only match more events, so withhold more.
 */
const OWNER_PATTERNS: Record<EventOwner, { modules: string[]; sources: string[]; typePrefixes: string[] }> = {
  operations: {
    modules: ['operations', 'key_inbox', 'key-inbox', 'keyinbox', 'inbox'],
    sources: ['key_inbox', 'whatsapp', 'instagram', 'email', 'gmail', 'meta', 'facebook', 'messenger', 'slack', 'sms', 'telegram', 'tiktok'],
    typePrefixes: ['key_inbox.', 'whatsapp.', 'instagram.', 'email.', 'gmail.', 'meta.', 'facebook.', 'messenger.', 'slack.', 'sms.', 'telegram.', 'tiktok.'],
  },
  bookings: {
    modules: ['bookings', 'booking', 'calendar'],
    sources: ['google_calendar'],
    typePrefixes: ['google_calendar.', 'calendar.', 'booking.'],
  },
  revenue: {
    modules: ['revenue', 'finance', 'invoice', 'invoices', 'payment', 'payments', 'billing', 'money'],
    sources: ['stripe', 'paypal', 'wipay', 'shopify'],
    typePrefixes: [
      'invoice.', 'payment.', 'quote.', 'estimate.', 'refund.', 'payout.', 'deposit.', 'subscription.',
      'credit_note.', 'revenue.', 'finance.', 'money.', 'stripe.', 'paypal.', 'wipay.', 'shopify.', 'order.',
    ],
  },
  storefront: {
    modules: ['storefront', 'shop', 'store'],
    sources: ['shopify'],
    typePrefixes: ['shopify.', 'storefront.', 'order.'],
  },
};

/** Business-wide modules (their owners' reads are membership only) and the hand-recorded source. */
const BUSINESS_WIDE = { modules: ['business-assets', 'business-genome', 'key-autonomy'], sources: ['manual'] };
/** KEY's own timeline writes: revenue-owned unless their module names an owner or a business-wide module. */
const KEY_NOTE_SOURCE = 'key_cortex';

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): the temporal memories' sourceModule values and the modules a reader
 * needs to see one (TemporalFlowMemoryService.summarize* write key_inbox). Any other value (the genome bridge's
 * temporal_flow patterns, built from events of every module) fails closed.
 */
const MEMORY_SOURCE_OWNERS: Record<string, readonly EventOwner[]> = { key_inbox: ['operations'] };

const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const });
const ciPrefix = (value: string) => ({ startsWith: value, mode: 'insensitive' as const });

/**
 * `module` is nullable: each of its terms is bound to a non-null value, so a NOT around it keeps an event whose module
 * is null (SQL's NOT of a NULL comparison would drop it).
 */
const moduleIs = (value: string) => ({ AND: [{ module: { not: null } }, { module: ci(value) }] });

/** An event whose module names an event-owning module or a business-wide one. */
const KNOWN_MODULE = {
  OR: [...EVENT_OWNERS.flatMap((o) => OWNER_PATTERNS[o].modules), ...BUSINESS_WIDE.modules].map(moduleIs),
};

/** FU-TEMPORAL-FLOW-INBOX-SCOPE: the condition an event owned by `owner` meets. */
function ownedBy(owner: EventOwner): Record<string, unknown> {
  const p = OWNER_PATTERNS[owner];
  return {
    OR: [
      ...p.modules.map(moduleIs),
      ...p.sources.map((src) => ({ source: ci(src) })),
      ...p.typePrefixes.map((prefix) => ({ type: ciPrefix(prefix) })),
      ...(owner === 'revenue' ? [{ AND: [{ source: ci(KEY_NOTE_SOURCE) }, { NOT: KNOWN_MODULE }] }] : []),
    ],
  };
}

/** FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 2): an event no rule classifies (fails closed). */
const UNCLASSIFIED = {
  AND: [
    { NOT: { OR: EVENT_OWNERS.map(ownedBy) } },
    { NOT: { OR: [...BUSINESS_WIDE.modules.map(moduleIs), ...BUSINESS_WIDE.sources.map((src) => ({ source: ci(src) }))] } },
  ],
};

/** The events withheld from a reader who misses the `withheld` owners (non-empty). */
const withheldEvents = (withheld: readonly EventOwner[]) => ({ OR: [...withheld.map(ownedBy), UNCLASSIFIED] });

@Injectable()
export class TemporalFlowService {
  private readonly logger = new Logger(TemporalFlowService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TemporalFlowMemoryService) private readonly memoryService?: TemporalFlowMemoryService,
    @Inject(SemanticMemoryService) private readonly semanticMemory?: SemanticMemoryService,
  ) {}

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE review repair (SEC N-3): given a writer's filter (readerFilter), an upsert whose
   * (source, externalId) names an existing event the writer cannot read is refused (403) before anything is written,
   * so a member cannot overwrite a KEY Inbox event, nor read back the fields the upsert keeps (its sender handle).
   */
  async emit(input: TemporalFlowEventInput, writerFilter?: Record<string, unknown>) {
    const data = this.buildCreateData(input);

    if (input.externalId && writerFilter) {
      const key = { businessId: input.businessId, source: input.source, externalId: input.externalId };
      const existing = await this.prisma.client.temporalFlowEvent.findFirst({ where: key, select: { id: true } });
      if (existing) {
        const visible = await this.prisma.client.temporalFlowEvent.findFirst({
          where: this.scoped({ id: existing.id, businessId: input.businessId }, writerFilter),
          select: { id: true },
        });
        if (!visible) throw new ForbiddenException('This event belongs to a module you cannot read');
      }
    }

    if (input.externalId) {
      return this.prisma.client.temporalFlowEvent.upsert({
        where: {
          businessId_source_externalId: {
            businessId: input.businessId,
            source: input.source,
            externalId: input.externalId,
          },
        },
        create: data,
        update: this.buildUpdateData(input),
      });
    }

    return this.prisma.client.temporalFlowEvent.create({
      data: { ...data, id: randomUUID() },
    });
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE (D-100, D-179): the condition that withholds from `reader` the events of every
   * event-owning module (EVENT_OWNERS) they cannot read, and, when they miss any, every unclassified event (fails
   * closed, delta item 2), applied in the query itself, before its order and limit, so a page holds as many events as the
   * reader may see and no count or page boundary counts a withheld one. The reader's levels are read as
   * ModuleScopeGuard reads them (memberModuleLevel: the membership of this business, its explicit permissionScopes
   * map, a JSON array included, a missing key being none, D-179; else its role's defaults); a platform SUPER_ADMIN
   * passes, as the guard passes them. No reader, or no membership of this business: every owning module is withheld.
   * undefined: nothing is withheld (a reader of every event-owning module sees every event, as before: delta M-1).
   */
  async readerFilter(businessId: string, reader: TemporalFlowReader): Promise<Record<string, unknown> | undefined> {
    const withheld = await this.withheldOwners(businessId, reader);
    return withheld.length ? { NOT: withheldEvents(withheld) } : undefined;
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE: the event-owning modules `reader` cannot read in `businessId` (read as readerFilter
   * says). [] for a reader of all of them and for a platform SUPER_ADMIN.
   */
  private async withheldOwners(businessId: string, reader: TemporalFlowReader): Promise<EventOwner[]> {
    if (reader?.role === 'SUPER_ADMIN' && reader.id) return [];
    const membership = reader?.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: reader.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    const reads = (module: EventOwner) =>
      !!membership && rankOf(memberModuleLevel(membership, module)) >= LEVEL_RANK.read;
    return EVENT_OWNERS.filter((module) => !reads(module));
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): the condition that withholds from `reader` the temporal memories they
   * may not see, in the query before its order and limit: a memory whose sourceModule needs a module they cannot read
   * (MEMORY_SOURCE_OWNERS; an unknown one fails closed), and a memory built from an event withheld from them (its
   * sourceEventIds name one). undefined: nothing is withheld (a reader of every event-owning module).
   */
  async readerMemoryFilter(businessId: string, reader: TemporalFlowReader): Promise<Record<string, unknown> | undefined> {
    const withheld = await this.withheldOwners(businessId, reader);
    if (!withheld.length) return undefined;
    const allowed = Object.entries(MEMORY_SOURCE_OWNERS)
      .filter(([, owners]) => owners.every((o) => !withheld.includes(o)))
      .map(([sourceModule]) => sourceModule);
    if (!allowed.length) return { id: { in: [] } };
    const hidden = await this.prisma.client.temporalFlowEvent.findMany({
      where: { AND: [{ businessId }, withheldEvents(withheld)] },
      select: { id: true },
    });
    const hiddenIds = hidden.map((e: { id: string }) => e.id);
    return {
      AND: [
        { sourceModule: { in: allowed } },
        ...(hiddenIds.length ? [{ NOT: { sourceEventIds: { hasSome: hiddenIds } } }] : []),
      ],
    };
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): the memories of `businessId` a reader with `memoryFilter`
   * (readerMemoryFilter) may see, as TemporalFlowMemoryService.findMany reads them. An entity id that is not a string
   * matches nothing.
   */
  async listMemory(
    businessId: string,
    query: { entityType?: string; entityId?: string | null; type?: string; limit?: number | string },
    memoryFilter: Record<string, unknown>,
  ) {
    if (query.entityId !== undefined && query.entityId !== null && typeof query.entityId !== 'string') return [];
    const limit = Number(query.limit);
    return this.prisma.client.temporalFlowMemory.findMany({
      where: this.scoped(
        {
          businessId,
          ...(query.entityType ? { entityType: String(query.entityType) } : {}),
          ...(query.entityId !== undefined ? { entityId: query.entityId ?? null } : {}),
          ...(query.type ? { type: String(query.type) } : {}),
        },
        memoryFilter,
      ),
      orderBy: { updatedAt: 'desc' },
      take: Number.isInteger(limit) && limit > 0 ? limit : 100,
    });
  }

  /** FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): of `memoryIds`, the ones of `businessId` `memoryFilter` lets through. */
  async visibleMemoryIds(businessId: string, memoryIds: string[], memoryFilter: Record<string, unknown>): Promise<Set<string>> {
    const ids = memoryIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (!ids.length) return new Set();
    const rows = await this.prisma.client.temporalFlowMemory.findMany({
      where: this.scoped({ businessId, id: { in: ids } }, memoryFilter),
      select: { id: true },
    });
    return new Set(rows.map((r: { id: string }) => r.id));
  }

  /** FU-TEMPORAL-FLOW-INBOX-SCOPE: `where` with the reader's filter (readerFilter) added, when one is given. */
  private scoped(where: Record<string, unknown>, filter: Record<string, unknown> | undefined) {
    return filter ? { AND: [where, filter] } : where;
  }

  async list(
    businessId: string,
    query: TemporalFlowListQuery = {},
    readerFilter?: Record<string, unknown>,
  ) {
    const where: Record<string, unknown> = { businessId };

    if (query.source) where.source = query.source;
    if (query.type) where.type = query.type;
    if (query.module) where.module = query.module;
    if (query.status) where.status = query.status;
    if (query.importance) where.importance = query.importance;
    if (query.genomeImpactPotential != null) where.genomeImpactPotential = query.genomeImpactPotential;

    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lte: new Date(query.to) }),
      };
    }

    where.visibility = { not: 'HIDDEN' };

    return this.prisma.client.temporalFlowEvent.findMany({
      where: this.scoped(where, readerFilter),
      orderBy: { occurredAt: 'desc' },
      take: query.limit ?? 100,
    });
  }

  async calendarRange(businessId: string, from: string, to: string, readerFilter?: Record<string, unknown>) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    return this.prisma.client.temporalFlowEvent.findMany({
      where: this.scoped(
        {
          businessId,
          visibility: { not: 'HIDDEN' },
          OR: [
            { startsAt: { gte: fromDate, lte: toDate } },
            { occurredAt: { gte: fromDate, lte: toDate } },
            { reminderAt: { gte: fromDate, lte: toDate } },
          ],
        },
        readerFilter,
      ),
      orderBy: [{ startsAt: 'asc' }, { occurredAt: 'asc' }],
    });
  }

  async remindersDue(businessId: string, readerFilter?: Record<string, unknown>) {
    return this.prisma.client.temporalFlowEvent.findMany({
      where: this.scoped(
        {
          businessId,
          reminderAt: { lte: new Date() },
          status: { in: ['RECORDED', 'ACTION_REQUIRED'] },
          visibility: { not: 'HIDDEN' },
        },
        readerFilter,
      ),
      orderBy: { reminderAt: 'asc' },
      take: 50,
    });
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE review repair (SEC N-2): given the writer's filter, an event they cannot read is not
   * resolved and answers { count: 0 }, as an event that does not exist does.
   */
  async markResolved(businessId: string, eventId: string, writerFilter?: Record<string, unknown>) {
    return this.prisma.client.temporalFlowEvent.updateMany({
      where: this.scoped({ id: eventId, businessId }, writerFilter),
      data: {
        status: 'RESOLVED',
        completedAt: new Date(),
      },
    });
  }

  async analyze(
    businessId: string,
    readerFilter?: Record<string, unknown>,
    memoryFilter?: Record<string, unknown>,
  ): Promise<TemporalFlowAnalysis> {
    const recent = await this.list(businessId, { limit: 500 }, readerFilter);

    const urgentItems: TemporalFlowAnalysis['urgentItems'] = [];
    const opportunities: TemporalFlowAnalysis['opportunities'] = [];
    const risks: TemporalFlowAnalysis['risks'] = [];

    const now = new Date();
    const overdueInvoices = recent.filter(
      (e) => e.source === 'APP' && e.type === 'invoice.overdue' && e.status !== 'RESOLVED',
    );
    if (overdueInvoices.length) {
      urgentItems.push({
        title: 'Overdue invoices need follow-up',
        reason: `${overdueInvoices.length} invoice(s) are overdue.`,
      });
      risks.push({
        title: 'Cash flow risk from overdue invoices',
        severity: 'HIGH',
        evidence: overdueInvoices.map((e) => e.title),
      });
    }

    const assetExpiryReminders = recent.filter(
      (e) => e.type === 'asset.expiring_soon' && e.status !== 'RESOLVED',
    );
    if (assetExpiryReminders.length) {
      urgentItems.push({
        title: 'Assets expiring soon',
        reason: `${assetExpiryReminders.length} asset reminder(s) require attention.`,
      });
      risks.push({
        title: 'Operational/legal risk from expiring assets',
        severity: 'MEDIUM',
        evidence: assetExpiryReminders.map((e) => e.title),
      });
    }

    const criticalRecorded = recent.filter(
      (e) => e.importance === 'CRITICAL' && e.status !== 'RESOLVED' && e.status !== 'DISMISSED',
    );
    for (const event of criticalRecorded) {
      urgentItems.push({
        title: event.title,
        reason: 'Critical event requires attention.',
        eventId: event.id,
      });
    }

    const whatsappLeads = recent.filter((e) => e.source === 'WHATSAPP' && e.type.includes('lead'));
    if (whatsappLeads.length >= 3) {
      opportunities.push({
        title: 'WhatsApp is becoming a lead channel',
        evidence: whatsappLeads.slice(0, 5).map((e) => e.title),
      });
    }

    const instagramDms = recent.filter((e) => e.source === 'INSTAGRAM' && e.type === 'instagram.dm.received');
    if (instagramDms.length >= 5) {
      opportunities.push({
        title: 'Instagram DM volume suggests marketing momentum',
        evidence: instagramDms.slice(0, 5).map((e) => e.title),
      });
    }

    const bookings = recent.filter((e) => e.type === 'booking.created');
    if (bookings.length >= 5) {
      opportunities.push({
        title: 'Booking volume rising — review Operations DNA',
        evidence: [`${bookings.length} bookings recorded recently.`],
      });
    }

    const genomeProposalCandidates = await this.findGenomeSignals(businessId, recent);

    const memoryInsights = await this.buildMemoryInsights(businessId, memoryFilter);

    const summaryParts = [
      `${recent.length} events analyzed.`,
      urgentItems.length ? `${urgentItems.length} urgent item(s).` : 'No urgent items.',
      opportunities.length ? `${opportunities.length} opportunity(s) detected.` : 'No major opportunities detected.',
      risks.length ? `${risks.length} risk(s) flagged.` : 'No risks flagged.',
      genomeProposalCandidates.length
        ? `${genomeProposalCandidates.length} Genome evolution candidate(s).`
        : 'No Genome candidates yet.',
      memoryInsights.length ? `${memoryInsights.length} memory-backed insight(s).` : '',
    ].filter(Boolean);

    return {
      summary: summaryParts.join(' '),
      urgentItems,
      opportunities,
      risks,
      genomeProposalCandidates,
      memoryInsights: memoryInsights.length ? memoryInsights : undefined,
    };
  }

  /**
   * FU-TEMPORAL-FLOW-INBOX-SCOPE delta (item 1): given a memory filter (readerMemoryFilter), the memories and the
   * semantic recall carry only memories the reader may see.
   */
  private async buildMemoryInsights(
    businessId: string,
    memoryFilter?: Record<string, unknown>,
  ): Promise<TemporalFlowMemoryInsight[]> {
    const insights: NonNullable<TemporalFlowAnalysis['memoryInsights']> = [];
    if (!this.memoryService) return insights;

    const recentMemory = memoryFilter
      ? await this.listMemory(businessId, { limit: 20 }, memoryFilter)
      : await this.memoryService.findMany(businessId, { limit: 20 });
    for (const memory of recentMemory) {
      if (memory.confidence < 0.6) continue;
      if (memory.type === 'summary') {
        insights.push({
          title: `Memory: ${memory.entityType} ${memory.entityId ?? ''}`,
          reason: memory.content,
          memoryId: memory.id,
        });
      }
    }

    if (this.semanticMemory) {
      try {
        const recall = await this.semanticMemory.search({
          businessId,
          query: 'overdue invoice complaint urgent follow-up',
          limit: 3,
          sourceTypes: ['temporal_memory'],
          minSimilarity: 0.72,
        });
        const visible = memoryFilter
          ? await this.visibleMemoryIds(businessId, recall.map((hit) => hit.sourceId), memoryFilter)
          : undefined;
        for (const hit of recall) {
          if (visible && !visible.has(hit.sourceId)) continue;
          insights.push({
            title: 'Memory recall: follow-up context',
            reason: hit.content,
            evidence: [`similarity ${hit.similarity.toFixed(2)}`],
          });
        }
      } catch {
        // semantic search is optional; ignore failures
      }
    }

    return insights;
  }

  async findGenomeSignals(
    businessId: string,
    recent?: Awaited<ReturnType<typeof this.list>>,
  ): Promise<TemporalFlowGenomeCandidate[]> {
    const events = recent ?? (await this.list(businessId, { limit: 500 }));
    const candidates: TemporalFlowGenomeCandidate[] = [];

    const whatsappLeads = events.filter(
      (e) => e.source === 'WHATSAPP' && e.type.includes('lead'),
    );
    if (whatsappLeads.length >= 3) {
      candidates.push({
        section: 'marketing',
        reason: 'WhatsApp appears to be a meaningful acquisition source.',
        evidence: [`${whatsappLeads.length} WhatsApp lead events detected.`],
        eventIds: whatsappLeads.map((e) => e.id),
      });
    }

    const instagramDms = events.filter(
      (e) => e.source === 'INSTAGRAM' && e.type === 'instagram.dm.received',
    );
    if (instagramDms.length >= 5) {
      candidates.push({
        section: 'marketing',
        reason: 'Instagram DM volume indicates active audience engagement.',
        evidence: [`${instagramDms.length} Instagram DM events detected.`],
        eventIds: instagramDms.map((e) => e.id),
      });
    }

    const bookings = events.filter((e) => e.type === 'booking.created');
    if (bookings.length >= 5) {
      candidates.push({
        section: 'operations',
        reason: 'Rising booking volume suggests operations workflows are material.',
        evidence: [`${bookings.length} booking events detected.`],
        eventIds: bookings.map((e) => e.id),
      });
    }

    const invoices = events.filter((e) => e.type === 'invoice.paid');
    if (invoices.length >= 3) {
      candidates.push({
        section: 'sales',
        reason: 'Paid invoice activity confirms a working sales channel.',
        evidence: [`${invoices.length} paid invoice events detected.`],
        eventIds: invoices.map((e) => e.id),
      });
    }

    const assetExpiries = events.filter((e) => e.type === 'asset.expiring_soon');
    if (assetExpiries.length >= 1) {
      candidates.push({
        section: 'risk',
        reason: 'Expiring assets indicate active risk management needs.',
        evidence: [`${assetExpiries.length} asset expiry reminder(s) detected.`],
        eventIds: assetExpiries.map((e) => e.id),
      });
    }

    return candidates;
  }

  private buildCreateData(input: TemporalFlowEventInput) {
    return {
      businessId: input.businessId,
      userId: input.userId,
      source: input.source,
      type: input.type,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      summary: input.summary,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      occurredAt: input.occurredAt ?? new Date(),
      status: input.status ?? 'RECORDED',
      importance: input.importance ?? 'NORMAL',
      visibility: input.visibility ?? 'USER',
      payload: input.payload ?? {},
      signals: input.signals ?? {},
      tags: input.tags ?? [],
      reminderAt: input.reminderAt,
      genomeImpactPotential: input.genomeImpactPotential ?? false,
      keyAnalysisStatus: input.keyAnalysisStatus ?? 'PENDING',
      threadId: input.threadId,
      messageId: input.messageId,
      contactId: input.contactId,
      memoryEmbeddingId: input.memoryEmbeddingId,
      externalId: input.externalId,
      externalUrl: input.externalUrl,
    };
  }

  private buildUpdateData(input: TemporalFlowEventInput) {
    return {
      userId: input.userId,
      type: input.type,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      summary: input.summary,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      occurredAt: input.occurredAt ?? new Date(),
      status: input.status ?? 'RECORDED',
      importance: input.importance ?? 'NORMAL',
      visibility: input.visibility ?? 'USER',
      payload: input.payload ?? {},
      signals: input.signals ?? {},
      tags: input.tags ?? [],
      reminderAt: input.reminderAt,
      genomeImpactPotential: input.genomeImpactPotential ?? false,
      keyAnalysisStatus: input.keyAnalysisStatus ?? 'PENDING',
      threadId: input.threadId,
      messageId: input.messageId,
      contactId: input.contactId,
      memoryEmbeddingId: input.memoryEmbeddingId,
      externalUrl: input.externalUrl,
    };
  }
}
