import { Injectable, Logger, Inject } from '@nestjs/common';
import { genomeReaderReadsRevenue, financialProposalsWithProvenance, isMoneyLabel, PROPOSAL_CLASSIFY_SELECT, proposalTextStatesMoney, type GenomeReader } from '../business-genome/key-genome/genome-finance-scope';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
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
 * D-238 (round 3, security m1): whether a proposal event's own payload or metadata text (a rejection reason, a title, a
 * summary) states money, so a non-financial proposal's event that names a figure is not handed on.
 */
function eventTextStatesMoney(e: { payload?: unknown; metadata?: unknown }): boolean {
  const texts: unknown[] = [];
  for (const o of [e.payload, e.metadata]) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    for (const key of ['reason', 'rejectionReason', 'failureReason', 'title', 'summary', 'description']) texts.push((o as Record<string, unknown>)[key]);
  }
  // The proposal vocabulary, as the proposal's own row is read (review of the Codex fixes, security MAJOR-1: 'card
  // declined', 'paid late' and 'balance owed' are not money labels).
  return texts.some((t) => typeof t === 'string' && (isMoneyLabel(t) || proposalTextStatesMoney(t)));
}

/** The most rows one filtered timeline read scans before it answers what it has. */
const MAX_READER_SCAN = 10_000;

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
   * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; security review MAJOR-5): KeyActionProposalService writes each KEY
   * proposal's lifecycle here (entityType key_action_proposal: proposed, executed with its result, approval lapsed with
   * its reason). For a reader without revenue read, an event of a financial proposal, of a proposal that cannot be read
   * (fail closed) or whose own title or description states money is left out; every other event is unchanged. A call
   * with no `reader` argument (the scheduler, KEY tools applying their own authority) is unchanged; a request with no
   * user passes `null` and reads none.
   */
  private async forReader<E extends { entityType?: string | null; entityId?: string | null; title?: string | null; description?: string | null; payload?: unknown; metadata?: unknown }>(
    businessId: string,
    events: E[],
    reader: GenomeReader | null | undefined,
  ): Promise<E[]> {
    if (reader === undefined) return events;
    const proposals = events.filter((e) => e.entityType === 'key_action_proposal');
    if (proposals.length === 0) return events;
    if (await genomeReaderReadsRevenue(this.prisma, businessId, reader ?? undefined)) return events;
    const ids = [...new Set(proposals.map((e) => e.entityId).filter((id): id is string => typeof id === 'string' && !!id))];
    let rows: Map<string, Record<string, unknown>>;
    try {
      const found = ids.length
        ? await this.prisma.client.keyActionProposal.findMany({
            where: { businessId, id: { in: ids } },
            select: PROPOSAL_CLASSIFY_SELECT,
          })
        : [];
      rows = new Map(found.map((r: { id: string }) => [r.id, r as Record<string, unknown>]));
    } catch {
      return events.filter((e) => e.entityType !== 'key_action_proposal');
    }
    // Financial by the proposal row (its own fields or the recommendation it was bridged from), fail closed.
    const entries = [...rows.entries()];
    const flags = await financialProposalsWithProvenance(this.prisma, businessId, entries.map(([, row]) => row as never));
    const financial = new Map<string, boolean>(entries.map(([id], i) => [id, flags[i]]));
    return events.filter((e) => {
      if (e.entityType !== 'key_action_proposal') return true;
      const known = e.entityId ? financial.get(e.entityId) : undefined;
      return known === false && !isMoneyLabel(e.title) && !isMoneyLabel(e.description) && !eventTextStatesMoney(e);
    });
  }

  async list(businessId: string, query: TemporalFlowListQuery = {}, reader?: GenomeReader | null) {
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

    const limit = query.limit ?? 100;
    if (reader === undefined) {
      return this.prisma.client.temporalFlowEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, take: limit });
    }
    // Codex P2 on #218 and its review: when the rows are filtered for a reader, the limit counts what the reader may
    // see. The first read is `limit` rows (all a revenue reader, or a page with nothing hidden, needs); while rows were
    // withheld the read pages on, in a stable order, until the limit is met, the rows end, or MAX_READER_SCAN rows have
    // been scanned (then the page may be short). A negative limit serves nothing and a fraction is truncated.
    const want = Math.max(0, Math.trunc(Number(limit)) || 0);
    if (want === 0) return [];
    const visible: Awaited<ReturnType<typeof this.prisma.client.temporalFlowEvent.findMany>> = [];
    let skip = 0;
    while (visible.length < want && skip < MAX_READER_SCAN) {
      const take = Math.min(skip === 0 ? want : Math.min(Math.max(want, 100), 1000), Math.max(MAX_READER_SCAN - skip, 1));
      const page = await this.prisma.client.temporalFlowEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      });
      visible.push(...(await this.forReader(businessId, page, reader)));
      skip += page.length;
      if (page.length < take) break;
    }
    return visible.slice(0, want);
  }

  async calendarRange(businessId: string, from: string, to: string, reader?: GenomeReader | null) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: {
        businessId,
        visibility: { not: 'HIDDEN' },
        OR: [
          { startsAt: { gte: fromDate, lte: toDate } },
          { occurredAt: { gte: fromDate, lte: toDate } },
          { reminderAt: { gte: fromDate, lte: toDate } },
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { occurredAt: 'asc' }],
    });
    return this.forReader(businessId, events, reader);
  }

  async remindersDue(businessId: string, reader?: GenomeReader | null) {
    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: {
        businessId,
        reminderAt: { lte: new Date() },
        status: { in: ['RECORDED', 'ACTION_REQUIRED'] },
        visibility: { not: 'HIDDEN' },
      },
      orderBy: { reminderAt: 'asc' },
      take: 50,
    });
    return this.forReader(businessId, events, reader);
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

  async analyze(businessId: string): Promise<TemporalFlowAnalysis> {
    const recent = await this.list(businessId, { limit: 500 });

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
