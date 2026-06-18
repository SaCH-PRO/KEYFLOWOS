import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import type {
  TemporalFlowAnalysis,
  TemporalFlowEventInput,
  TemporalFlowGenomeCandidate,
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

@Injectable()
export class TemporalFlowService {
  private readonly logger = new Logger(TemporalFlowService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

  async list(businessId: string, query: TemporalFlowListQuery = {}) {
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
      where,
      orderBy: { occurredAt: 'desc' },
      take: query.limit ?? 100,
    });
  }

  async calendarRange(businessId: string, from: string, to: string) {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    return this.prisma.client.temporalFlowEvent.findMany({
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
  }

  async remindersDue(businessId: string) {
    return this.prisma.client.temporalFlowEvent.findMany({
      where: {
        businessId,
        reminderAt: { lte: new Date() },
        status: { in: ['RECORDED', 'ACTION_REQUIRED'] },
        visibility: { not: 'HIDDEN' },
      },
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

    const summaryParts = [
      `${recent.length} events analyzed.`,
      urgentItems.length ? `${urgentItems.length} urgent item(s).` : 'No urgent items.',
      opportunities.length ? `${opportunities.length} opportunity(s) detected.` : 'No major opportunities detected.',
      risks.length ? `${risks.length} risk(s) flagged.` : 'No risks flagged.',
      genomeProposalCandidates.length
        ? `${genomeProposalCandidates.length} Genome evolution candidate(s).`
        : 'No Genome candidates yet.',
    ];

    return {
      summary: summaryParts.join(' '),
      urgentItems,
      opportunities,
      risks,
      genomeProposalCandidates,
    };
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
      externalUrl: input.externalUrl,
    };
  }
}
