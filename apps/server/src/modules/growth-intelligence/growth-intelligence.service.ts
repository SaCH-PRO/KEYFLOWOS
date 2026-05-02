import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { AttributionService } from './attribution.service';
import { AiUsageService } from '../ai/ai-usage.service';

function toNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val !== null && val !== undefined && typeof val === 'object' && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val ?? 0);
}

function formatTTD(amount: number) {
  return `TT$${amount.toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

@Injectable()
export class GrowthIntelligenceService {
  private readonly logger = new Logger(GrowthIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CustomerJourneyService) private readonly journeys: CustomerJourneyService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * Returns the full Growth Intelligence dashboard payload — KPIs, funnel, channel mix,
   * top campaigns, attribution comparison, top contacts at risk, top contacts ready to upsell,
   * and prioritized AI recommendations.
   */
  async getDashboard(businessId: string) {
    const [stages, byChannel, comparison, insights, atRisk, topContacts, kpis] = await Promise.all([
      this.journeys.getStageBreakdown(businessId),
      this.getChannelMix(businessId),
      this.attribution.getModelComparison(businessId, 'channel', 8),
      this.listInsights(businessId, { limit: 10 }),
      this.getAtRiskContacts(businessId, 6),
      this.getTopContacts(businessId, 6),
      this.computeKpis(businessId),
    ]);

    return {
      kpis,
      funnel: stages,
      channelMix: byChannel,
      attribution: comparison,
      atRiskContacts: atRisk,
      topContacts,
      insights,
    };
  }

  async computeKpis(businessId: string) {
    const now = new Date();
    const thirty = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [activeJourneys, conversions30d, totalRevenueAgg, recentTouchpoints, stageCounts] = await Promise.all([
      this.db.customerJourney.count({
        where: { businessId, lastTouchAt: { gte: thirty } },
      }),
      this.db.customerJourney.count({
        where: { businessId, convertedAt: { gte: thirty } },
      }),
      this.db.customerJourney.aggregate({
        where: { businessId, convertedAt: { gte: thirty } },
        _sum: { conversionValue: true },
        _avg: { daysToConversion: true, healthScore: true },
      }),
      this.db.journeyTouchpoint.count({
        where: { businessId, occurredAt: { gte: thirty } },
      }),
      this.db.customerJourney.groupBy({
        by: ['stage'],
        where: { businessId },
        _count: true,
      }),
    ]);

    const totalContacts = stageCounts.reduce((s, x) => s + x._count, 0);
    const conversionRate = activeJourneys > 0 ? (conversions30d / activeJourneys) * 100 : 0;
    const attributedRevenue = toNumber(totalRevenueAgg._sum.conversionValue ?? 0);
    const avgConversionDays = totalRevenueAgg._avg.daysToConversion ?? 0;
    const avgHealth = Math.round(totalRevenueAgg._avg.healthScore ?? 0);

    return {
      totalContacts,
      activeJourneys,
      conversions30d,
      conversionRate: Math.round(conversionRate * 10) / 10,
      attributedRevenue,
      attributedRevenueLabel: formatTTD(attributedRevenue),
      touchpoints30d: recentTouchpoints,
      avgDaysToConversion: Math.round(avgConversionDays * 10) / 10,
      avgJourneyHealth: avgHealth,
    };
  }

  async getChannelMix(businessId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const grouped = await this.db.journeyTouchpoint.groupBy({
      by: ['channel'],
      where: { businessId, occurredAt: { gte: since } },
      _count: true,
      _sum: { value: true },
    });
    const total = grouped.reduce((s, g) => s + g._count, 0) || 1;
    return grouped
      .map(g => ({
        channel: g.channel,
        touchpoints: g._count,
        share: Math.round((g._count / total) * 1000) / 10,
        revenue: toNumber(g._sum.value ?? 0),
      }))
      .sort((a, b) => b.touchpoints - a.touchpoints);
  }

  async getAtRiskContacts(businessId: string, limit = 6) {
    const journeys = await this.db.customerJourney.findMany({
      where: {
        businessId,
        riskLevel: { in: ['medium', 'high'] },
      },
      include: { contact: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: [{ riskLevel: 'desc' }, { lastTouchAt: 'asc' }],
      take: limit,
    });
    return journeys.map(j => ({
      id: j.id,
      contactId: j.contactId,
      contactName: `${j.contact.firstName ?? ''} ${j.contact.lastName ?? ''}`.trim() || j.contact.email || 'Unknown',
      stage: j.stage,
      lastTouchAt: j.lastTouchAt?.toISOString() ?? null,
      lastChannel: j.lastTouchChannel,
      healthScore: j.healthScore,
      riskLevel: j.riskLevel,
      totalRevenue: toNumber(j.totalRevenue),
    }));
  }

  async getTopContacts(businessId: string, limit = 6) {
    const journeys = await this.db.customerJourney.findMany({
      where: { businessId, totalRevenue: { gt: 0 } },
      include: { contact: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { totalRevenue: 'desc' },
      take: limit,
    });
    return journeys.map(j => ({
      id: j.id,
      contactId: j.contactId,
      contactName: `${j.contact.firstName ?? ''} ${j.contact.lastName ?? ''}`.trim() || j.contact.email || 'Unknown',
      stage: j.stage,
      totalRevenue: toNumber(j.totalRevenue),
      touchpointCount: j.touchpointCount,
      channels: j.channels,
      healthScore: j.healthScore,
    }));
  }

  async listInsights(businessId: string, opts: { status?: string; limit?: number } = {}) {
    const insights = await this.db.growthInsight.findMany({
      where: {
        businessId,
        status: opts.status ?? 'active',
      },
      orderBy: [
        { severity: 'desc' },
        { createdAt: 'desc' },
      ],
      take: opts.limit ?? 20,
    });
    return insights.map(i => ({
      id: i.id,
      category: i.category,
      insightType: i.insightType,
      severity: i.severity,
      title: i.title,
      description: i.description,
      recommendation: i.recommendation,
      rationale: i.rationale,
      suggestedAction: i.suggestedAction,
      source: i.source,
      estimatedImpact: i.estimatedImpact ? toNumber(i.estimatedImpact) : null,
      impactCurrency: i.impactCurrency,
      actionLabel: i.actionLabel,
      actionRoute: i.actionRoute,
      dimension: i.dimension,
      dimensionKey: i.dimensionKey,
      metrics: i.metrics,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt?.toISOString() ?? null,
    }));
  }

  async acknowledgeInsight(businessId: string, insightId: string, status: 'acknowledged' | 'dismissed' | 'applied') {
    // Scope the write to (id, businessId) so cross-business mutations are impossible
    // even if a caller knows another business's insight id.
    const result = await this.db.growthInsight.updateMany({
      where: { id: insightId, businessId },
      data: {
        status,
        acknowledgedAt: status === 'acknowledged' ? new Date() : undefined,
        appliedAt: status === 'applied' ? new Date() : undefined,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Insight not found for this business');
    }
    return this.db.growthInsight.findFirst({ where: { id: insightId, businessId } });
  }

  /**
   * Recomputes growth insights from current journey + attribution data. Replaces stale active
   * insights so the dashboard always reflects fresh state.
   *
   * Flow:
   *   1. Compute attribution + journey snapshots from the database.
   *   2. Build heuristic insight drafts (deterministic rules).
   *   3. Ask the AI gateway (single `growth_insight` call) to add a short rationale and
   *      a concrete first action to each draft, in the owner's voice.
   *   4. Persist the enriched drafts. If the AI call fails or the budget is exhausted,
   *      we still persist the heuristic drafts (source = "heuristic") so the dashboard
   *      always has fresh recommendations.
   */
  async generateInsights(businessId: string) {
    // Refresh attribution before reading
    await this.attribution.compute({ businessId });

    const [stageBreakdown, channelMix, lastTouchResults, firstTouchResults, atRiskCount, topContacts, business] = await Promise.all([
      this.journeys.getStageBreakdown(businessId),
      this.getChannelMix(businessId),
      this.attribution.getResults({ businessId, model: 'last_touch', dimension: 'channel' }),
      this.attribution.getResults({ businessId, model: 'first_touch', dimension: 'channel' }),
      this.db.customerJourney.count({ where: { businessId, riskLevel: 'high' } }),
      this.getTopContacts(businessId, 3),
      this.db.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true, archetype: true, currency: true, city: true, country: true },
      }),
    ]);

    // Build heuristic insight drafts (in-memory). Each draft carries a `key` we use to
    // correlate the AI's enrichment back to it.
    const drafts: InsightDraft[] = [];

    // 1. Best last-touch channel
    if (lastTouchResults.length > 0) {
      const best = lastTouchResults[0];
      drafts.push({
        key: `best_channel:${best.dimensionKey}`,
        category: 'channel_performance',
        insightType: 'best_channel',
        severity: 'opportunity',
        title: `${best.dimensionKey} is your top closing channel`,
        description: `${best.dimensionKey} drove ${formatTTD(best.attributedRevenue)} in attributed revenue across ${best.conversions} conversions in the last period (last-touch).`,
        recommendation: `Increase activity on ${best.dimensionKey} — consider raising budget by 20% or pushing more campaigns through this channel.`,
        estimatedImpact: best.attributedRevenue * 0.2,
        dimension: 'channel',
        dimensionKey: best.dimensionKey,
        actionLabel: 'View channel attribution',
        actionRoute: '/app/keyflow-command?panel=growth-intelligence',
        metrics: { revenue: best.attributedRevenue, conversions: best.conversions, model: 'last_touch' },
      });
    }

    // 2. First-touch awareness vs last-touch divergence
    if (firstTouchResults.length > 0 && lastTouchResults.length > 0) {
      const topFirst = firstTouchResults[0];
      const topLast = lastTouchResults[0];
      if (topFirst.dimensionKey !== topLast.dimensionKey) {
        drafts.push({
          key: 'attribution_split',
          category: 'channel_performance',
          insightType: 'attribution_split',
          severity: 'info',
          title: 'Top awareness channel differs from top closing channel',
          description: `${topFirst.dimensionKey} brings the most new contacts in, but ${topLast.dimensionKey} closes the most revenue.`,
          recommendation: `Strengthen the handoff from ${topFirst.dimensionKey} to ${topLast.dimensionKey} with retargeting or follow-up sequences.`,
          actionLabel: 'View attribution',
          actionRoute: '/app/keyflow-command?panel=growth-intelligence',
          metrics: { firstTouch: topFirst.dimensionKey, lastTouch: topLast.dimensionKey },
        });
      }
    }

    // 3. Channel concentration
    if (channelMix.length > 0) {
      const dominant = channelMix[0];
      if (dominant.share > 70 && channelMix.length > 1) {
        drafts.push({
          key: `concentration:${dominant.channel}`,
          category: 'channel_performance',
          insightType: 'channel_concentration',
          severity: 'warning',
          title: 'Heavy reliance on a single channel',
          description: `${dominant.share}% of touchpoints in the last 30 days came from ${dominant.channel}. Channel concentration creates risk if performance dips.`,
          recommendation: 'Diversify into 2–3 secondary channels to reduce risk and capture new audiences.',
          dimension: 'channel',
          dimensionKey: dominant.channel,
          actionLabel: 'View channel mix',
          actionRoute: '/app/keyflow-command?panel=growth-intelligence',
          metrics: { dominantChannel: dominant.channel, share: dominant.share },
        });
      }
    }

    // 4. Funnel stalls
    const stageMap = new Map(stageBreakdown.map(s => [s.stage, s.count]));
    const interest = stageMap.get('INTEREST') ?? 0;
    const consideration = stageMap.get('CONSIDERATION') ?? 0;
    const conversion = stageMap.get('CONVERSION') ?? 0;
    if (interest > 0 && consideration / Math.max(interest, 1) < 0.2) {
      drafts.push({
        key: 'funnel_stall:interest_consideration',
        category: 'campaign_health',
        insightType: 'funnel_stall',
        severity: 'warning',
        title: 'Interest-to-Consideration drop-off',
        description: `Only ${consideration} of ${interest} interested contacts moved into Consideration.`,
        recommendation: 'Send a nurture sequence or qualification call to interested contacts that have stalled.',
        actionLabel: 'View journeys',
        actionRoute: '/app/keyflow-command?panel=growth-intelligence',
        metrics: { interest, consideration },
      });
    }
    if (consideration > 0 && conversion / Math.max(consideration, 1) < 0.3) {
      drafts.push({
        key: 'funnel_stall:consideration_conversion',
        category: 'campaign_health',
        insightType: 'funnel_stall',
        severity: 'warning',
        title: 'Consideration-to-Conversion drop-off',
        description: `${consideration} contacts are considering — only ${conversion} converted.`,
        recommendation: 'Offer a time-limited incentive or follow-up via WhatsApp / phone to push consideration into conversion.',
        actionLabel: 'View journeys',
        actionRoute: '/app/keyflow-command?panel=growth-intelligence',
        metrics: { consideration, conversion },
      });
    }

    // 5. Churn risk
    if (atRiskCount > 0) {
      drafts.push({
        key: 'churn_risk',
        category: 'churn_risk',
        insightType: 'churn_risk',
        severity: atRiskCount > 5 ? 'critical' : 'warning',
        title: `${atRiskCount} contacts at high churn risk`,
        description: 'These contacts have not had a touchpoint in over 90 days and may disengage.',
        recommendation: 'Reach out via their preferred channel with a value-add (offer, content, check-in).',
        actionLabel: 'View at-risk contacts',
        actionRoute: '/app/keyflow-command?panel=growth-intelligence',
        metrics: { atRiskCount },
      });
    }

    // 6. Upsell opportunity
    if (topContacts.length > 0) {
      const top = topContacts[0];
      drafts.push({
        key: `upsell:${top.contactId}`,
        category: 'ltv',
        insightType: 'upsell_opportunity',
        severity: 'opportunity',
        title: `Upsell opportunity: ${top.contactName}`,
        description: `${top.contactName} has generated ${formatTTD(top.totalRevenue)} across ${top.touchpointCount} touchpoints — a strong candidate for an upsell or referral ask.`,
        recommendation: 'Send a personalized upsell offer or a referral request.',
        estimatedImpact: top.totalRevenue * 0.15,
        dimension: 'contact',
        dimensionKey: top.contactId,
        actionLabel: 'Open contact',
        actionRoute: `/app/contacts/${top.contactId}`,
        metrics: { revenue: top.totalRevenue, touchpoints: top.touchpointCount },
      });
    }

    // Try to enrich every draft with a short LLM rationale + suggested first action.
    // If the AI is unavailable (rate limit, budget exhausted, gateway error) we keep
    // the heuristic drafts as-is — the dashboard never goes blank.
    let enrichments: Map<string, AiEnrichment> = new Map();
    if (drafts.length > 0) {
      try {
        enrichments = await this.enrichDraftsWithAi(businessId, drafts, {
          businessName: business?.name ?? 'this business',
          industry: business?.industry ?? null,
          archetype: business?.archetype ?? null,
          location: [business?.city, business?.country].filter(Boolean).join(', ') || null,
          currency: business?.currency ?? 'TTD',
        });
      } catch (err) {
        if (err instanceof ForbiddenException) {
          this.logger.log(`Growth insight enrichment skipped (budget): ${err.message}`);
        } else {
          this.logger.warn(`Growth insight enrichment failed, falling back to heuristics: ${(err as Error).message}`);
        }
      }
    }

    // Mark previous active insights as expired before writing the fresh batch.
    await this.db.growthInsight.updateMany({
      where: { businessId, status: 'active' },
      data: { status: 'dismissed', expiresAt: new Date() },
    });

    const created: Array<{ title: string; severity: string; source: string }> = [];

    for (const draft of drafts) {
      const enrich = enrichments.get(draft.key);
      const source = enrich ? 'ai' : 'heuristic';
      await this.db.growthInsight.create({
        data: {
          businessId,
          category: draft.category,
          insightType: draft.insightType,
          severity: draft.severity,
          title: draft.title,
          description: draft.description,
          recommendation: draft.recommendation,
          rationale: enrich?.rationale ?? null,
          suggestedAction: enrich?.suggestedAction ?? null,
          source,
          estimatedImpact: draft.estimatedImpact,
          dimension: draft.dimension,
          dimensionKey: draft.dimensionKey,
          actionLabel: draft.actionLabel,
          actionRoute: draft.actionRoute,
          metrics: draft.metrics as object,
        },
      });
      created.push({ title: draft.title, severity: draft.severity, source });
    }

    return {
      created: created.length,
      items: created,
      aiEnriched: created.filter(c => c.source === 'ai').length,
    };
  }

  /**
   * Single AI call that enriches every heuristic draft with a short rationale + suggested
   * first action, returning JSON keyed by the draft's `key`. We use `responseMode:
   * 'structured_json'` so the gateway does not inject prose-quality directives that would
   * corrupt the JSON schema.
   */
  private async enrichDraftsWithAi(
    businessId: string,
    drafts: InsightDraft[],
    ctx: { businessName: string; industry: string | null; archetype: string | null; location: string | null; currency: string },
  ): Promise<Map<string, AiEnrichment>> {
    const businessLine = [
      `Business: ${ctx.businessName}`,
      ctx.industry ? `Industry: ${ctx.industry}` : null,
      ctx.archetype ? `Type: ${ctx.archetype}` : null,
      ctx.location ? `Location: ${ctx.location}` : null,
      `Currency: ${ctx.currency}`,
    ].filter(Boolean).join(' | ');

    const insightSummaries = drafts.map(d => ({
      key: d.key,
      title: d.title,
      description: d.description,
      heuristicRecommendation: d.recommendation,
      severity: d.severity,
      category: d.category,
      metrics: d.metrics ?? {},
    }));

    const systemPrompt = `You are a senior growth strategist for a small Caribbean service business (${ctx.currency} currency).
You are reviewing automatically detected growth signals and adding owner-friendly context.
For each signal, write:
  1. "rationale" — 1-2 sentences in plain English explaining WHY this matters for the business right now. Reference the actual numbers from "metrics" when they make the point sharper. No jargon. No restating the title.
  2. "suggestedAction" — one concrete first step the owner can do TODAY (under 25 words). Make it specific to this business and channel; avoid generic advice like "improve marketing".

Return ONLY valid JSON in the exact shape:
{
  "insights": [
    { "key": "<the signal's key, copied verbatim>", "rationale": "<text>", "suggestedAction": "<text>" }
  ]
}
Include one entry per signal. Do not add extra fields. Do not wrap the JSON in markdown.`;

    const userPrompt = `${businessLine}

Signals to enrich (JSON):
${JSON.stringify(insightSummaries, null, 2)}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'growth_insight',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 900,
      temperature: 0.4,
      responseMode: 'structured_json',
    });

    const parsed = this.safeParseEnrichments(result.content);
    const map = new Map<string, AiEnrichment>();
    // Hard caps protect the UI from oversized model outputs and keep the panel
    // visually consistent. Generous enough to fit 1-2 sentences comfortably.
    const RATIONALE_MAX = 400;
    const ACTION_MAX = 220;
    for (const entry of parsed) {
      if (!entry?.key || typeof entry.key !== 'string') continue;
      const rationale = typeof entry.rationale === 'string' ? entry.rationale.trim().slice(0, RATIONALE_MAX) : '';
      const suggestedAction = typeof entry.suggestedAction === 'string' ? entry.suggestedAction.trim().slice(0, ACTION_MAX) : '';
      if (!rationale && !suggestedAction) continue;
      map.set(entry.key, {
        rationale: rationale || null,
        suggestedAction: suggestedAction || null,
      });
    }
    return map;
  }

  private safeParseEnrichments(content: string): Array<{ key?: unknown; rationale?: unknown; suggestedAction?: unknown }> {
    if (!content) return [];
    // Strip ``` fences if the model added them despite the prompt.
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { insights?: unknown }).insights)) {
        return (parsed as { insights: Array<{ key?: unknown; rationale?: unknown; suggestedAction?: unknown }> }).insights;
      }
      return [];
    } catch (err) {
      this.logger.warn(`Failed to parse growth_insight AI output: ${(err as Error).message}`);
      return [];
    }
  }
}

interface InsightDraft {
  key: string;
  category: string;
  insightType: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
  estimatedImpact?: number;
  dimension?: string;
  dimensionKey?: string;
  actionLabel?: string;
  actionRoute?: string;
  metrics?: Record<string, unknown>;
}

interface AiEnrichment {
  rationale: string | null;
  suggestedAction: string | null;
}
