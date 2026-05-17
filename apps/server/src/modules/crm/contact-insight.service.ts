import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { BestChannelService, type BestChannelExplanation } from './best-channel.service';
import { contactWhereWithId } from './crm.helpers';

export const CONTACT_INSIGHT_SCHEMA_VERSION = 1;

export type SuggestedActionKind =
  | 'schedule_call'
  | 'send_whatsapp'
  | 'send_email'
  | 'enroll_in_sequence'
  | 'create_task'
  | 'create_invoice'
  | 'book_appointment'
  | 'review_dormant';

export interface ContactInsightSuggestedAction {
  kind: SuggestedActionKind;
  label: string;
  description: string;
  channel?: 'email' | 'whatsapp' | 'sms' | 'call';
  prefill?: {
    message?: string;
    subject?: string;
    taskTitle?: string;
    dueDate?: string;
    priority?: 'HIGH' | 'NORMAL' | 'LOW';
  };
}

export interface ContactInsightPayload {
  /** Schema version of this payload. */
  version: number;
  /** Cached AI relationship summary (1 paragraph). */
  relationshipSummary: string;
  /** Best channel from m2-best-channel-time, e.g. "whatsapp". */
  bestChannel: 'email' | 'whatsapp' | 'sms' | 'call' | null;
  bestChannelConfidence: number | null;
  bestTimeWindow: { label: string; tz: string } | null;
  /** Dominant topics from m2-conversation-ai. */
  dominantTopics: string[];
  /** Sum of won deals + paid invoices in the workspace currency. */
  lifetimeValue: number;
  currency: string;
  /** Open deal count and value across all open deals. */
  openDeals: { count: number; value: number };
  /** 0-100; higher = more risk. */
  churnRisk: number;
  churnRiskReason: string;
  /** Single suggested next action to surface as a CTA. */
  suggestedAction: ContactInsightSuggestedAction;
  /** When the source data was last touched (most recent contact event). */
  lastInteractionAt: string | null;
  /** Free-form short tags for the card (e.g. ["high-value", "dormant"]). */
  tags: string[];
}

interface ContactInsightAggregate {
  payload: ContactInsightPayload;
  computedAt: string;
  stale: boolean;
  modelUsed: string | null;
}

const MAX_TOPICS = 4;

function safeJsonObject(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

function parseLooseJson<T>(content: string, fallback: T): T {
  try {
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
  } catch (err) {
      console.error(`Silent catch:`, err);
    }
  return fallback;
}

@Injectable()
export class ContactInsightService {
  private readonly logger = new Logger(ContactInsightService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BestChannelService) private readonly bestChannel: BestChannelService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * Returns the cached snapshot. If none exists, computes synchronously.
   * If stale, returns the cached snapshot (with `stale: true`) and triggers a
   * background recompute. Caller can decide whether to wait.
   */
  async getSnapshot(
    businessId: string,
    contactId: string,
    options: { forceRecompute?: boolean } = {},
  ): Promise<ContactInsightAggregate> {
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const existing = await this.db.contactInsightSnapshot.findUnique({
      where: { contactId },
    });

    if (existing && !options.forceRecompute && existing.version === CONTACT_INSIGHT_SCHEMA_VERSION && !existing.stale) {
      return this.toAggregate(existing);
    }

    if (existing && !options.forceRecompute) {
      // Return stale snapshot immediately and recompute in background.
      void this.recompute(businessId, contactId).catch((err) => {
        this.logger.warn(
          `Background recompute failed for contact=${contactId}: ${(err as Error).message}`,
        );
      });
      return { ...this.toAggregate(existing), stale: true };
    }

    return this.recompute(businessId, contactId);
  }

  /** Mark a contact's snapshot stale (no-op if no snapshot exists). */
  async markStale(businessId: string, contactId: string): Promise<void> {
    try {
      await this.db.contactInsightSnapshot.updateMany({
        where: { businessId, contactId },
        data: { stale: true },
      });
    } catch (err) {
      this.logger.warn(`markStale failed for contact=${contactId}: ${(err as Error).message}`);
    }
  }

  /**
   * Aggregate from all sources, call the AI gateway for the relationship summary,
   * persist the snapshot, and emit CONTACT_INSIGHT_RECOMPUTED.
   */
  async recompute(businessId: string, contactId: string): Promise<ContactInsightAggregate> {
    const start = Date.now();
    const aggregate = await this.aggregate(businessId, contactId);
    const { summary, modelUsed } = await this.generateRelationshipSummary(businessId, aggregate);
    aggregate.relationshipSummary = summary;

    const saved = await this.db.contactInsightSnapshot.upsert({
      where: { contactId },
      create: {
        businessId,
        contactId,
        version: CONTACT_INSIGHT_SCHEMA_VERSION,
        payload: aggregate as unknown as object,
        stale: false,
        modelUsed,
      },
      update: {
        version: CONTACT_INSIGHT_SCHEMA_VERSION,
        payload: aggregate as unknown as object,
        stale: false,
        modelUsed,
        computedAt: new Date(),
      },
    });

    this.events.emit('crm.contact_insight.recomputed', {
      businessId,
      contactId,
      computedAt: saved.computedAt.toISOString(),
      durationMs: Date.now() - start,
    });

    return this.toAggregate(saved);
  }

  // -----------------------------------------------------------------
  // Aggregation
  // -----------------------------------------------------------------

  /**
   * Dashboard-level intelligence aggregates for a business.
   * Returns at-risk counts, high-value counts, neglected counts,
   * and a lead-score distribution histogram.
   */
  async getIntelligenceSummary(businessId: string) {
    const [
      atRisk,
      highValue,
      neglected,
      scoreDistribution,
    ] = await Promise.all([
      this.db.contact.count({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { relationshipHealth: 'AT_RISK' },
            { relationshipHealth: 'DORMANT' },
          ],
        },
      }),
      this.db.contact.count({
        where: {
          businessId,
          deletedAt: null,
          leadScore: { gte: 80 },
        },
      }),
      this.db.contact.count({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { lastContactedAt: { lte: new Date(Date.now() - 30 * 86400000) } },
            { lastContactedAt: null },
          ],
        },
      }),
      this.db.contact.groupBy({
        by: ['leadScore'],
        where: { businessId, deletedAt: null, leadScore: { not: null } },
        _count: { leadScore: true },
      }),
    ]);

    const buckets = [
      { label: 'Hot (80-100)', min: 80, max: 100 },
      { label: 'Warm (60-79)', min: 60, max: 79 },
      { label: 'Neutral (40-59)', min: 40, max: 59 },
      { label: 'Cool (20-39)', min: 20, max: 39 },
      { label: 'Cold (0-19)', min: 0, max: 19 },
    ];

    const histogram = buckets.map((b) => ({
      ...b,
      count: scoreDistribution
        .filter((s) => {
          const score = s.leadScore ?? 0;
          return score >= b.min && score <= b.max;
        })
        .reduce((sum, s) => sum + s._count.leadScore, 0),
    }));

    return {
      atRisk,
      highValue,
      neglected,
      totalAnalyzed: await this.db.contact.count({ where: { businessId, deletedAt: null } }),
      scoreDistribution: histogram,
    };
  }

  /**
   * Compute and persist new contact intelligence fields (Phase 4 MD).
   * Called by the lead-scoring scheduler or on-demand.
   */
  async computeContactIntelligenceFields(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        leadScore: true,
        lastInteractionAt: true,
        lastContactedAt: true,
      },
    });
    if (!contact) return;

    const daysSinceLastInteraction = contact.lastInteractionAt
      ? Math.floor((Date.now() - contact.lastInteractionAt.getTime()) / 86400000)
      : 999;

    const [
      invoiceAgg,
      paidInvoiceAgg,
      bookingAgg,
      cancelledBookingAgg,
      quoteAgg,
      acceptedQuoteAgg,
    ] = await Promise.all([
      this.db.invoice.aggregate({
        where: { businessId, contactId, deletedAt: null },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.db.invoice.aggregate({
        where: { businessId, contactId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.db.booking.aggregate({
        where: { businessId, contactId, deletedAt: null },
        _count: { _all: true },
      }),
      this.db.booking.aggregate({
        where: { businessId, contactId, deletedAt: null, status: 'CANCELLED' },
        _count: { _all: true },
      }),
      this.db.quote.aggregate({
        where: { businessId, contactId, deletedAt: null },
        _count: { _all: true },
      }),
      this.db.quote.aggregate({
        where: { businessId, contactId, deletedAt: null, status: 'ACCEPTED' },
        _count: { _all: true },
      }),
    ]);

    const totalInvoices = invoiceAgg._count._all ?? 0;
    const paidInvoices = (paidInvoiceAgg as any)?._count?._all ?? 0;
    const totalPaid = Number((paidInvoiceAgg as any)?._sum?.total ?? 0);
    const totalBookings = (bookingAgg as any)?._count?._all ?? 0;
    const cancelledBookings = (cancelledBookingAgg as any)?._count?._all ?? 0;
    const quoteSentCount = (quoteAgg as any)?._count?._all ?? 0;
    const quoteAcceptedCount = (acceptedQuoteAgg as any)?._count?._all ?? 0;
    const unpaidInvoiceCount = totalInvoices - paidInvoices;

    const { calculateLeadScore, calculatePaymentReliability, calculateCancellationRisk, calculateFollowUpPriority, generateNextBestAction } =
      await import('./contact-scoring.engine');

    const leadScore = calculateLeadScore({
      totalPaid,
      invoiceCount: totalInvoices,
      unpaidInvoiceCount,
      bookingCount: totalBookings,
      cancelledBookingCount: cancelledBookings,
      daysSinceLastInteraction,
      quoteSentCount,
      quoteAcceptedCount,
    });

    const paymentReliability = calculatePaymentReliability(paidInvoices, totalInvoices, 14);
    const cancellationRate = calculateCancellationRisk(cancelledBookings, totalBookings);
    const followUpPriority = calculateFollowUpPriority({
      leadScore,
      daysSinceLastInteraction,
      unpaidInvoiceCount,
      quotePendingCount: quoteSentCount - quoteAcceptedCount,
    });
    const nextBestAction = generateNextBestAction({
      leadScore,
      daysSinceLastInteraction,
      unpaidInvoiceCount,
      quotePendingCount: quoteSentCount - quoteAcceptedCount,
      bookingCount: totalBookings,
    });

    // Fetch additional data for missing intelligence fields
    const [bookingsWithServices, recentNotes, openDeals, conversationInsights] = await Promise.all([
      this.db.booking.findMany({
        where: { businessId, contactId, deletedAt: null },
        select: { service: { select: { name: true } } },
        take: 100,
      }),
      this.db.contactNote.findMany({
        where: { businessId, contactId },
        select: { body: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.db.deal.findMany({
        where: { businessId, contactId, status: 'OPEN', deletedAt: null },
        select: { value: true, stage: true },
      }),
      this.db.conversationAIInsight.findFirst({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        select: { sentiment: true },
      }),
    ]);

    // preferredServices: most booked services
    const serviceCounts: Record<string, number> = {};
    bookingsWithServices.forEach((b) => {
      const name = b.service?.name;
      if (name) serviceCounts[name] = (serviceCounts[name] ?? 0) + 1;
    });
    const preferredServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // responsivenessScore: heuristic based on interaction recency and note frequency
    const noteCount = recentNotes.length;
    const daysSinceLastNote = recentNotes[0]
      ? Math.floor((Date.now() - new Date(recentNotes[0].createdAt).getTime()) / 86400000)
      : 999;
    const responsivenessScore = Math.min(100, Math.round(
      (noteCount > 5 ? 40 : noteCount * 8) +
      (daysSinceLastNote < 7 ? 30 : daysSinceLastNote < 30 ? 15 : 0) +
      (totalBookings > 0 ? 20 : 0) +
      (paidInvoices > 0 ? 10 : 0),
    ));

    // sentimentScore: from conversation insights or neutral default
    const rawSentiment = conversationInsights?.sentiment;
    const sentimentScore = typeof rawSentiment === 'number'
      ? Math.round(rawSentiment * 100)
      : 50;

    // referralLikelihood: based on satisfaction indicators
    const referralLikelihood = Math.min(100, Math.round(
      (sentimentScore > 70 ? 30 : sentimentScore > 40 ? 15 : 0) +
      (totalPaid > 1000 ? 25 : totalPaid > 100 ? 10 : 0) +
      (totalBookings >= 3 ? 25 : totalBookings >= 1 ? 10 : 0) +
      (paymentReliability > 80 ? 20 : 0),
    ));

    // riskFlags: array of risk signals
    const riskFlags: string[] = [];
    if (unpaidInvoiceCount > 0) riskFlags.push('unpaid_invoices');
    if (cancellationRate > 30) riskFlags.push('high_cancellation_rate');
    if (daysSinceLastInteraction > 60) riskFlags.push('dormant');
    if (paymentReliability < 50 && totalInvoices > 1) riskFlags.push('poor_payment_history');
    if (leadScore < 30 && totalPaid > 0) riskFlags.push('declining_engagement');

    // opportunities: array of upsell/cross-sell signals
    const opportunities: string[] = [];
    if (quoteSentCount > quoteAcceptedCount) opportunities.push('pending_quotes');
    if (openDeals.length > 0) opportunities.push('open_deals');
    if (totalBookings >= 2 && preferredServices.length > 1) opportunities.push('cross_sell_services');
    if (totalPaid > 500 && daysSinceLastInteraction < 30) opportunities.push('upsell_ready');
    if (totalBookings >= 3 && cancellationRate < 10) opportunities.push('loyalty_program');
    if (recentNotes.length >= 2 && sentimentScore > 60) opportunities.push('referral_ask');

    await this.db.contact.update({
      where: { id: contactId },
      data: {
        leadScore,
        lifetimeValue: totalPaid,
        averageSpend: totalInvoices > 0 ? totalPaid / totalInvoices : 0,
        paymentReliability,
        bookingFrequency: totalBookings,
        cancellationRate,
        followUpPriority,
        nextBestAction,
        conversionProbability: leadScore,
        responsivenessScore,
        sentimentScore,
        referralLikelihood,
        ...(preferredServices.length > 0 ? { preferredServices } : {}),
        ...(riskFlags.length > 0 ? { riskFlags } : {}),
        ...(opportunities.length > 0 ? { opportunities } : {}),
      },
    });
  }

  // -----------------------------------------------------------------

  private async aggregate(businessId: string, contactId: string): Promise<ContactInsightPayload> {
    const [contact, deals, invoices, openTasks, conversationInsights, channelExplanation, lastEvent] =
      await Promise.all([
        this.db.contact.findFirst({
          where: contactWhereWithId(businessId, contactId),
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            whatsappNumber: true,
            status: true,
            relationshipHealth: true,
            tags: true,
            lastContactedAt: true,
            lastInteractionAt: true,
            preferredChannel: true,
          },
        }),
        this.db.deal.findMany({
          where: { businessId, contactId, deletedAt: null },
          select: { status: true, value: true, currency: true },
        }),
        this.db.invoice.findMany({
          where: { businessId, contactId, deletedAt: null },
          select: { status: true, total: true, currency: true },
        }),
        this.db.contactTask.findMany({
          where: { businessId, contactId, status: { not: 'DONE' }, deletedAt: null },
          select: { id: true, title: true, dueDate: true, priority: true },
          orderBy: { dueDate: 'asc' },
          take: 5,
        }),
        this.db.conversationAIInsight.findMany({
          where: { businessId, contactId },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: { intent: true, payload: true, createdAt: true },
        }),
        this.bestChannel.explain(businessId, contactId).catch(() => null as BestChannelExplanation | null),
        this.db.contactEvent.findFirst({
          where: { businessId, contactId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

    if (!contact) throw new NotFoundException('Contact not found');

    const wonDealValue = deals
      .filter((d) => d.status === 'WON')
      .reduce((sum, d) => sum + Number(d.value ?? 0), 0);
    const openDeals = deals.filter((d) => d.status === 'OPEN');
    const openDealValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
    const paidInvoiceTotal = invoices
      .filter((i) => i.status === 'PAID')
      .reduce((sum, i) => sum + Number(i.total ?? 0), 0);
    const currency = invoices[0]?.currency ?? deals[0]?.currency ?? 'TTD';
    const lifetimeValue = wonDealValue + paidInvoiceTotal;

    const dominantTopics = this.extractDominantTopics(conversationInsights);
    const churn = this.computeChurnRisk({
      relationshipHealth: contact.relationshipHealth,
      lastInteractionAt: contact.lastInteractionAt ?? contact.lastContactedAt ?? null,
      openInvoicesOverdue: invoices.filter((i) => i.status === 'OVERDUE').length,
      openDealsCount: openDeals.length,
      lifetimeValue,
    });

    const bestChannel = (channelExplanation?.channel ?? null) as ContactInsightPayload['bestChannel'];
    const bestChannelConfidence = channelExplanation?.confidence ?? null;
    const bestTimeWindow = channelExplanation?.timeWindow
      ? { label: channelExplanation.timeWindow.label, tz: channelExplanation.timeWindow.tz }
      : null;

    const suggestedAction = this.buildSuggestedAction({
      contact,
      bestChannel,
      churnRisk: churn.score,
      openTasks,
      openDealCount: openDeals.length,
    });

    const tags: string[] = [];
    if (lifetimeValue >= 5000) tags.push('high-value');
    if (churn.score >= 60) tags.push('at-risk');
    if (contact.relationshipHealth === 'DORMANT') tags.push('dormant');
    if (openDeals.length > 0) tags.push(`${openDeals.length} open ${openDeals.length === 1 ? 'deal' : 'deals'}`);

    return {
      version: CONTACT_INSIGHT_SCHEMA_VERSION,
      relationshipSummary: '',
      bestChannel,
      bestChannelConfidence,
      bestTimeWindow,
      dominantTopics,
      lifetimeValue,
      currency,
      openDeals: { count: openDeals.length, value: openDealValue },
      churnRisk: churn.score,
      churnRiskReason: churn.reason,
      suggestedAction,
      lastInteractionAt: (lastEvent?.createdAt ?? contact.lastInteractionAt ?? null)?.toISOString() ?? null,
      tags,
    };
  }

  private extractDominantTopics(
    insights: Array<{ intent: string | null; payload: unknown; createdAt: Date }>,
  ): string[] {
    const tally = new Map<string, number>();
    for (const ins of insights) {
      if (ins.intent && ins.intent.length > 0) {
        tally.set(ins.intent, (tally.get(ins.intent) ?? 0) + 2);
      }
      const obj = safeJsonObject(ins.payload);
      const topics = obj?.topics;
      if (Array.isArray(topics)) {
        for (const t of topics) {
          if (typeof t === 'string' && t.trim().length > 0) {
            const key = t.trim().toLowerCase();
            tally.set(key, (tally.get(key) ?? 0) + 1);
          }
        }
      }
    }
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOPICS)
      .map(([k]) => k);
  }

  private computeChurnRisk(input: {
    relationshipHealth: string | null;
    lastInteractionAt: Date | null;
    openInvoicesOverdue: number;
    openDealsCount: number;
    lifetimeValue: number;
  }): { score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    const days = input.lastInteractionAt
      ? Math.floor((Date.now() - input.lastInteractionAt.getTime()) / 86_400_000)
      : 365;
    if (days >= 180) {
      score += 45;
      reasons.push(`no contact in ${days}d`);
    } else if (days >= 90) {
      score += 30;
      reasons.push(`silent for ${days}d`);
    } else if (days >= 45) {
      score += 15;
      reasons.push(`${days}d since last touch`);
    }

    switch (input.relationshipHealth) {
      case 'DORMANT':
        score += 30;
        reasons.push('flagged dormant');
        break;
      case 'COLD':
        score += 20;
        reasons.push('cold');
        break;
      case 'WARM':
        score -= 5;
        break;
      case 'HOT':
        score -= 15;
        break;
      default:
        break;
    }

    if (input.openInvoicesOverdue > 0) {
      score += Math.min(20, 8 * input.openInvoicesOverdue);
      reasons.push(`${input.openInvoicesOverdue} overdue invoice${input.openInvoicesOverdue === 1 ? '' : 's'}`);
    }

    if (input.openDealsCount === 0 && input.lifetimeValue === 0) {
      score += 10;
      reasons.push('no deals or revenue');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const reason = reasons.length > 0 ? reasons.join(', ') : 'recent activity, healthy signals';
    return { score, reason };
  }

  private buildSuggestedAction(input: {
    contact: {
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      whatsappNumber: string | null;
      status: string | null;
      relationshipHealth: string | null;
      preferredChannel: string | null;
    };
    bestChannel: ContactInsightPayload['bestChannel'];
    churnRisk: number;
    openTasks: Array<{ id: string; title: string; dueDate: Date | null; priority: string | null }>;
    openDealCount: number;
  }): ContactInsightSuggestedAction {
    const firstName = input.contact.firstName?.trim() || 'there';
    const fullName = `${input.contact.firstName ?? ''} ${input.contact.lastName ?? ''}`.trim() || 'this client';
    const channel =
      (input.bestChannel ??
        (input.contact.preferredChannel as ContactInsightPayload['bestChannel']) ??
        (input.contact.whatsappNumber ? 'whatsapp' : input.contact.email ? 'email' : 'call')) ?? 'email';

    if (input.churnRisk >= 60 || input.contact.relationshipHealth === 'DORMANT') {
      const message = `Hi ${firstName}, it's been a while — wanted to check in and see how things are going on your end. Anything we can help with?`;
      return {
        kind: channel === 'whatsapp' ? 'send_whatsapp' : channel === 'email' ? 'send_email' : 'enroll_in_sequence',
        label: channel === 'whatsapp' ? `Re-engage on WhatsApp` : channel === 'email' ? `Re-engage by email` : `Enroll in re-engagement sequence`,
        description: `${fullName} is showing churn signals — open the conversation with a low-pressure check-in.`,
        channel: channel as ContactInsightSuggestedAction['channel'],
        prefill: { message, subject: `Quick check-in` },
      };
    }

    const overdueTask = input.openTasks.find((t) => t.dueDate && t.dueDate.getTime() < Date.now());
    if (overdueTask) {
      return {
        kind: 'create_task',
        label: `Complete: ${overdueTask.title}`,
        description: `An overdue task is blocking momentum with ${fullName}.`,
        prefill: { taskTitle: overdueTask.title, priority: 'HIGH' },
      };
    }

    if (input.openDealCount > 0) {
      return {
        kind: 'schedule_call',
        label: `Schedule a call with ${firstName}`,
        description: `There ${input.openDealCount === 1 ? 'is 1 open deal' : `are ${input.openDealCount} open deals`} — a quick call can move it forward.`,
        channel: 'call',
        prefill: { taskTitle: `Call ${fullName}`, priority: 'HIGH' },
      };
    }

    if (input.contact.status === 'LEAD') {
      const message = `Hi ${firstName}! Thanks for the interest — would you have time for a quick call this week to see how we can help?`;
      return {
        kind: channel === 'whatsapp' ? 'send_whatsapp' : 'send_email',
        label: channel === 'whatsapp' ? `WhatsApp ${firstName}` : `Email ${firstName}`,
        description: `New lead — open the conversation and book discovery.`,
        channel: channel as ContactInsightSuggestedAction['channel'],
        prefill: { message, subject: `Quick intro` },
      };
    }

    if (input.contact.status === 'CLIENT') {
      return {
        kind: channel === 'whatsapp' ? 'send_whatsapp' : 'send_email',
        label: `Check in with ${firstName}`,
        description: `Healthy client — touch base to keep the relationship warm and surface upsell.`,
        channel: channel as ContactInsightSuggestedAction['channel'],
        prefill: {
          message: `Hi ${firstName}! Hope all's well — wanted to check in and see if there's anything else we can help with.`,
          subject: `Checking in`,
        },
      };
    }

    return {
      kind: 'create_task',
      label: `Plan next step for ${firstName}`,
      description: `No urgent signal — schedule a follow-up so the relationship doesn't drift.`,
      prefill: { taskTitle: `Follow up with ${fullName}`, priority: 'NORMAL' },
    };
  }

  // -----------------------------------------------------------------
  // AI relationship summary
  // -----------------------------------------------------------------

  private async generateRelationshipSummary(
    businessId: string,
    aggregate: ContactInsightPayload,
  ): Promise<{ summary: string; modelUsed: string | null }> {
    const fallbackSummary = this.buildHeuristicSummary(aggregate);
    const systemPrompt = `You are an expert CRM analyst writing a one-paragraph relationship summary about a single contact.

Rules:
- Output a single JSON object: { "summary": string }.
- The summary must be one paragraph, 2-4 sentences, plain prose, no bullet points.
- Reference the dominant topics, lifetime value, churn risk and best channel naturally where relevant.
- Be concrete and useful for a busy operator who is about to take action — avoid vague filler.
- Currency is TTD (Trinidad & Tobago) by default; use the provided currency code verbatim.

DATA:
${JSON.stringify(
  {
    bestChannel: aggregate.bestChannel,
    bestChannelConfidence: aggregate.bestChannelConfidence,
    bestTimeWindow: aggregate.bestTimeWindow,
    dominantTopics: aggregate.dominantTopics,
    lifetimeValue: aggregate.lifetimeValue,
    currency: aggregate.currency,
    openDeals: aggregate.openDeals,
    churnRisk: aggregate.churnRisk,
    churnRiskReason: aggregate.churnRiskReason,
    lastInteractionAt: aggregate.lastInteractionAt,
    tags: aggregate.tags,
  },
  null,
  2,
)}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'contact_insight_summary',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Write the one-paragraph relationship summary.' },
        ],
        maxTokens: 220,
        temperature: 0.3,
        outputCategory: 'general',
        responseMode: 'structured_json',
      });
      const parsed = parseLooseJson<{ summary?: string }>(result.content, {});
      const summary = (parsed.summary ?? '').trim();
      return {
        summary: summary.length > 0 ? summary : fallbackSummary,
        modelUsed: result.model ?? null,
      };
    } catch (err) {
      this.logger.warn(`AI relationship summary failed; using heuristic. ${(err as Error).message}`);
      return { summary: fallbackSummary, modelUsed: null };
    }
  }

  private buildHeuristicSummary(p: ContactInsightPayload): string {
    const parts: string[] = [];
    parts.push(
      `Lifetime value of ${p.currency} ${Math.round(p.lifetimeValue).toLocaleString()} across ${p.openDeals.count} open deal${p.openDeals.count === 1 ? '' : 's'}.`,
    );
    if (p.bestChannel) {
      parts.push(
        `Best reached on ${p.bestChannel}${p.bestTimeWindow ? ` (${p.bestTimeWindow.label})` : ''}.`,
      );
    }
    if (p.dominantTopics.length > 0) {
      parts.push(`Recent conversations focus on ${p.dominantTopics.slice(0, 3).join(', ')}.`);
    }
    if (p.churnRisk >= 50) {
      parts.push(`Churn risk is ${p.churnRisk}/100 — ${p.churnRiskReason}.`);
    }
    return parts.join(' ');
  }

  // -----------------------------------------------------------------
  private toAggregate(
    row: { payload: unknown; computedAt: Date; stale: boolean; modelUsed: string | null },
  ): ContactInsightAggregate {
    const obj = safeJsonObject(row.payload) ?? {};
    return {
      payload: obj as unknown as ContactInsightPayload,
      computedAt: row.computedAt.toISOString(),
      stale: row.stale,
      modelUsed: row.modelUsed,
    };
  }
}
