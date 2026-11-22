import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CANONICAL_MODULES, LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
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
 * acts for (AuthMiddleware's `req.user`). A read given no reader (an internal caller: the command center, KEY's
 * timeline tools) reads as before; a read given a reader answers only the events of the modules they may read.
 */
export type TemporalFlowReader = { id?: string; role?: string } | null | undefined;

/** The modules that own timeline events, and so may withhold them. */
type OwningModule = (typeof CANONICAL_MODULES)[number];

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE: how an event names the module that owns it, by its `module`, its `source` and its
 * `type` (case-insensitive). An event names a module when any of the three does; a reader sees it only when they read
 * every module it names. Every writer of the timeline, and the module its own reads require:
 *   - TemporalFlowKeyInboxListener: module key_inbox, type key_inbox.*, source key_inbox or the thread's channel
 *     (whatsapp, instagram, email, ...) -> operations (KeyInboxController: @RequireModuleScope('operations'));
 *   - GoogleCalendarTemporalSyncService: module calendar, source GOOGLE_CALENDAR, type google_calendar.* ->
 *     bookings (CalendarController's event reads: bookings read); booking.* types too;
 *   - money-bearing types (invoice.*, payment.*, ...) and a module that names finance -> revenue (D-100);
 *   - a `module` that is a canonical module's own name (a hand-written or KEY-written event) -> that module;
 *   - BusinessAssetsService (module business-assets), BlueprintService and ConstitutionVersionService (module
 *     business-genome), the KEY action services (module key-autonomy) and KEY's timeline notes (module null): their
 *     owners' reads are membership only, so these stay business-wide.
 */
const OWNER_PATTERNS: Partial<Record<OwningModule, { modules: string[]; sources: string[]; typePrefixes: string[] }>> = {
  operations: {
    modules: ['key_inbox', 'key-inbox', 'keyinbox', 'inbox'],
    sources: ['key_inbox', 'whatsapp', 'instagram', 'email', 'gmail', 'meta', 'facebook', 'messenger', 'slack', 'sms', 'telegram', 'tiktok'],
    typePrefixes: ['key_inbox.', 'whatsapp.', 'instagram.', 'email.', 'gmail.', 'meta.', 'facebook.', 'messenger.', 'slack.', 'sms.', 'telegram.', 'tiktok.'],
  },
  bookings: {
    modules: ['calendar', 'booking'],
    sources: ['google_calendar'],
    typePrefixes: ['google_calendar.', 'calendar.', 'booking.'],
  },
  revenue: {
    modules: ['finance', 'invoice', 'invoices', 'payment', 'payments', 'billing', 'money'],
    sources: ['stripe', 'paypal'],
    typePrefixes: [
      'invoice.', 'payment.', 'quote.', 'estimate.', 'refund.', 'payout.', 'deposit.', 'subscription.',
      'credit_note.', 'revenue.', 'finance.', 'money.', 'stripe.', 'paypal.',
    ],
  },
};

const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const });
const ciPrefix = (value: string) => ({ startsWith: value, mode: 'insensitive' as const });

/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE: the condition an event of `module` meets. `module` is nullable: each of its terms is
 * bound to a non-null value, so the NOT a reader's filter wraps it in keeps an event whose module is null (SQL's NOT of
 * a NULL comparison would drop it).
 */
function ownedBy(module: OwningModule): Record<string, unknown> {
  const p = OWNER_PATTERNS[module];
  const modules = [module, ...(p?.modules ?? [])];
  return {
    OR: [
      ...modules.map((m) => ({ AND: [{ module: { not: null } }, { module: ci(m) }] })),
      ...(p?.sources ?? []).map((src) => ({ source: ci(src) })),
      ...(p?.typePrefixes ?? []).map((prefix) => ({ type: ciPrefix(prefix) })),
    ],
  };
}

@Injectable()
export class TemporalFlowService {
  private readonly logger = new Logger(TemporalFlowService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TemporalFlowMemoryService) private readonly memoryService?: TemporalFlowMemoryService,
    @Inject(SemanticMemoryService) private readonly semanticMemory?: SemanticMemoryService,
  ) {}

  async emit(input: TemporalFlowEventInput) {
    const data = this.buildCreateData(input);

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
   * FU-TEMPORAL-FLOW-INBOX-SCOPE (D-100, D-179): the condition that withholds from `reader` the events of every module
   * they cannot read, applied in the query itself, before its order and limit, so a page holds as many events as the
   * reader may see and no count or page boundary counts a withheld one. The reader's levels are read as
   * ModuleScopeGuard reads them (memberModuleLevel: the membership of this business, its explicit permissionScopes
   * map, a JSON array included, a missing key being none, D-179; else its role's defaults); a platform SUPER_ADMIN
   * passes, as the guard passes them. No reader, or no membership of this business: every owning module is withheld.
   * undefined: nothing is withheld.
   */
  async readerFilter(businessId: string, reader: TemporalFlowReader): Promise<Record<string, unknown> | undefined> {
    if (reader?.role === 'SUPER_ADMIN' && reader.id) return undefined;
    const membership = reader?.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: reader.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    const reads = (module: OwningModule) =>
      !!membership && rankOf(memberModuleLevel(membership, module)) >= LEVEL_RANK.read;
    const withheld = CANONICAL_MODULES.filter((module) => !reads(module));
    if (!withheld.length) return undefined;
    return { NOT: { OR: withheld.map(ownedBy) } };
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

  async markResolved(businessId: string, eventId: string) {
    return this.prisma.client.temporalFlowEvent.updateMany({
      where: { id: eventId, businessId },
      data: {
        status: 'RESOLVED',
        completedAt: new Date(),
      },
    });
  }

  async analyze(businessId: string, readerFilter?: Record<string, unknown>): Promise<TemporalFlowAnalysis> {
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

    const memoryInsights = await this.buildMemoryInsights(businessId);

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

  private async buildMemoryInsights(businessId: string): Promise<TemporalFlowMemoryInsight[]> {
    const insights: NonNullable<TemporalFlowAnalysis['memoryInsights']> = [];
    if (!this.memoryService) return insights;

    const recentMemory = await this.memoryService.findMany(businessId, { limit: 20 });
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
        for (const hit of recall) {
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
