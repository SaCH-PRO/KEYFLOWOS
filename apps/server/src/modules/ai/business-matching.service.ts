import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';

export interface MatchResult {
  businessId: string;
  score: number;
  reasons: string[];
  explanation: string;
  matchType: 'complementary_skills' | 'same_industry' | 'referral_partner' | 'collaboration' | 'general';
}

interface BusinessProfile {
  id: string;
  name: string;
  slug?: string | null;
  logoUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  skills: string[];
  businessStage?: string | null;
  city?: string | null;
  country?: string | null;
  tagline?: string | null;
  acceptingWork: boolean;
  currentCapacity?: string | null;
  leadTime?: string | null;
  preferredProjectTypes: string[];
  budgetFit?: string | null;
  positioningStatement?: string | null;
  profileCompleteness: number;
  products?: { id: string; name: string; price: number; currency: string; category: string }[];
  services?: { id: string; name: string; price: number; currency: string }[];
  _count?: { communityPosts: number; cohortMembers: number; networkConnectionsTo: number };
}

const DB_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECOMMENDATIONS = 6;

@Injectable()
export class BusinessMatchingService {
  private readonly logger = new Logger(BusinessMatchingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async getRecommendations(businessId: string, forceRefresh = false): Promise<(MatchResult & { business: BusinessProfile })[]> {
    if (!forceRefresh) {
      const dbCached = await this.loadFromDb(businessId);
      if (dbCached) return dbCached;
    }

    const matches = await this.computeMatches(businessId);
    await this.persistToDb(businessId, matches);
    return matches;
  }

  async refreshStaleMatches(stalenessMs = DB_CACHE_TTL_MS): Promise<number> {
    const cutoff = new Date(Date.now() - stalenessMs);

    const businessesWithStaleMatches = await this.prisma.client.business.findMany({
      where: {
        deletedAt: null,
        profileCompleteness: { gte: 20 },
        OR: [
          { matchesAsSource: { none: {} } },
          { matchesAsSource: { every: { computedAt: { lt: cutoff } } } },
        ],
      },
      select: { id: true },
      take: 50,
    });

    let refreshed = 0;
    for (const biz of businessesWithStaleMatches) {
      try {
        const matches = await this.computeMatches(biz.id);
        await this.persistToDb(biz.id, matches);
        refreshed++;
      } catch (err) {
        this.logger.warn(`Failed to refresh matches for ${biz.id}: ${(err as Error).message}`);
      }
    }

    return refreshed;
  }

  async getMatchHistory(businessId: string, limit = 50): Promise<{
    id: string;
    targetBusinessId: string;
    targetBusinessName: string;
    score: number;
    matchType: string;
    computedAt: Date;
  }[]> {
    const rows = await this.prisma.client.businessMatch.findMany({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        targetBusinessId: true,
        score: true,
        matchType: true,
        computedAt: true,
        targetBusiness: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      targetBusinessId: r.targetBusinessId,
      targetBusinessName: r.targetBusiness.name,
      score: r.score,
      matchType: r.matchType,
      computedAt: r.computedAt,
    }));
  }

  // ==========================================
  // AI SUGGESTION EVENT TRACKING
  // Captures the funnel: shown -> clicked -> message/quote -> connection.
  // ==========================================

  async recordSuggestionEvent(
    businessId: string,
    input: {
      eventType: string;
      source: string;
      targetBusinessId?: string | null;
      score?: number | null;
      matchType?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<{ id: string } | null> {
    try {
      const allowedTypes = new Set([
        'SUGGESTION_CLICKED',
        'INTRO_DRAFT_GENERATED',
        'INTRO_DRAFT_USED',
        'MESSAGE_SENT',
        'CONNECTION_MADE',
        'QUOTE_REQUESTED',
        'COLLAB_CREATED',
        'DEAL_WON',
      ]);
      if (!allowedTypes.has(input.eventType)) {
        return null;
      }
      if (input.targetBusinessId && input.targetBusinessId === businessId) {
        return null;
      }
      const created = await this.prisma.client.aiSuggestionEvent.create({
        data: {
          businessId,
          targetBusinessId: input.targetBusinessId ?? null,
          eventType: input.eventType,
          source: input.source.slice(0, 64),
          score: input.score ?? null,
          matchType: input.matchType?.slice(0, 64) ?? null,
          metadata: (input.metadata ?? {}) as any,
        },
        select: { id: true },
      });
      return created;
    } catch (err) {
      this.logger.warn(`Failed to record AI suggestion event: ${(err as Error).message}`);
      return null;
    }
  }

  async getSuggestionFunnel(businessId: string): Promise<{
    totals: {
      clicked: number;
      introDraftsGenerated: number;
      introDraftsUsed: number;
      messagesSent: number;
      connectionsMade: number;
      quotesRequested: number;
      collabsCreated: number;
      dealsWon: number;
    };
    bySource: Record<string, { clicked: number; messagesSent: number; quotesRequested: number; connectionsMade: number; dealsWon: number }>;
    conversionRates: {
      clickToMessage: number;
      clickToQuote: number;
      clickToConnection: number;
      clickToDeal: number;
      draftUsageRate: number;
    };
    convertedSuggestions: Array<{
      targetBusinessId: string;
      targetBusinessName: string;
      source: string;
      score: number | null;
      clickedAt: string;
      outcomeType: string;
      outcomeAt: string;
    }>;
    recent: Array<{
      id: string;
      eventType: string;
      source: string;
      score: number | null;
      matchType: string | null;
      targetBusinessId: string | null;
      targetBusinessName: string | null;
      createdAt: string;
    }>;
  }> {
    const events = await this.prisma.client.aiSuggestionEvent.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: {
        targetBusiness: { select: { id: true, name: true } },
      },
    });

    const rankOutcome = (t: string) => {
      switch (t) {
        case 'MESSAGE_SENT': return 1;
        case 'CONNECTION_MADE': return 2;
        case 'QUOTE_REQUESTED': return 3;
        case 'COLLAB_CREATED': return 4;
        case 'DEAL_WON': return 5;
        default: return 0;
      }
    };

    const totals = {
      clicked: 0,
      introDraftsGenerated: 0,
      introDraftsUsed: 0,
      messagesSent: 0,
      connectionsMade: 0,
      quotesRequested: 0,
      collabsCreated: 0,
      dealsWon: 0,
    };
    const bySource: Record<string, { clicked: number; messagesSent: number; quotesRequested: number; connectionsMade: number; dealsWon: number }> = {};
    const ensureSource = (s: string) => {
      if (!bySource[s]) bySource[s] = { clicked: 0, messagesSent: 0, quotesRequested: 0, connectionsMade: 0, dealsWon: 0 };
      return bySource[s];
    };

    // Track first click per (target, source) so we can compute conversion per suggestion.
    const firstClick = new Map<string, { source: string; score: number | null; createdAt: Date; targetName: string }>();
    const targetOutcomes = new Map<string, { outcomeType: string; outcomeAt: Date }>();

    for (const e of events) {
      const src = e.source;
      switch (e.eventType) {
        case 'SUGGESTION_CLICKED':
          totals.clicked++;
          ensureSource(src).clicked++;
          if (e.targetBusinessId) {
            const key = `${e.targetBusinessId}::${src}`;
            const existing = firstClick.get(key);
            if (!existing || e.createdAt < existing.createdAt) {
              firstClick.set(key, {
                source: src,
                score: e.score,
                createdAt: e.createdAt,
                targetName: e.targetBusiness?.name ?? 'Unknown',
              });
            }
          }
          break;
        case 'INTRO_DRAFT_GENERATED':
          totals.introDraftsGenerated++;
          break;
        case 'INTRO_DRAFT_USED':
          totals.introDraftsUsed++;
          break;
        case 'MESSAGE_SENT':
          totals.messagesSent++;
          ensureSource(src).messagesSent++;
          if (e.targetBusinessId) {
            const existing = targetOutcomes.get(e.targetBusinessId);
            if (!existing || rankOutcome('MESSAGE_SENT') > rankOutcome(existing.outcomeType)) {
              targetOutcomes.set(e.targetBusinessId, { outcomeType: 'MESSAGE_SENT', outcomeAt: e.createdAt });
            }
          }
          break;
        case 'CONNECTION_MADE':
          totals.connectionsMade++;
          ensureSource(src).connectionsMade++;
          if (e.targetBusinessId) {
            const existing = targetOutcomes.get(e.targetBusinessId);
            if (!existing || rankOutcome('CONNECTION_MADE') > rankOutcome(existing.outcomeType)) {
              targetOutcomes.set(e.targetBusinessId, { outcomeType: 'CONNECTION_MADE', outcomeAt: e.createdAt });
            }
          }
          break;
        case 'QUOTE_REQUESTED':
          totals.quotesRequested++;
          ensureSource(src).quotesRequested++;
          if (e.targetBusinessId) {
            const existing = targetOutcomes.get(e.targetBusinessId);
            if (!existing || rankOutcome('QUOTE_REQUESTED') > rankOutcome(existing.outcomeType)) {
              targetOutcomes.set(e.targetBusinessId, { outcomeType: 'QUOTE_REQUESTED', outcomeAt: e.createdAt });
            }
          }
          break;
        case 'COLLAB_CREATED':
          totals.collabsCreated++;
          if (e.targetBusinessId) {
            const existing = targetOutcomes.get(e.targetBusinessId);
            if (!existing || rankOutcome('COLLAB_CREATED') > rankOutcome(existing.outcomeType)) {
              targetOutcomes.set(e.targetBusinessId, { outcomeType: 'COLLAB_CREATED', outcomeAt: e.createdAt });
            }
          }
          break;
        case 'DEAL_WON':
          totals.dealsWon++;
          ensureSource(src).dealsWon++;
          if (e.targetBusinessId) {
            targetOutcomes.set(e.targetBusinessId, { outcomeType: 'DEAL_WON', outcomeAt: e.createdAt });
          }
          break;
      }
    }

    const convertedSuggestions: Array<{
      targetBusinessId: string;
      targetBusinessName: string;
      source: string;
      score: number | null;
      clickedAt: string;
      outcomeType: string;
      outcomeAt: string;
    }> = [];
    for (const [key, click] of firstClick.entries()) {
      const [targetId] = key.split('::');
      const outcome = targetOutcomes.get(targetId);
      if (outcome && outcome.outcomeAt >= click.createdAt) {
        convertedSuggestions.push({
          targetBusinessId: targetId,
          targetBusinessName: click.targetName,
          source: click.source,
          score: click.score,
          clickedAt: click.createdAt.toISOString(),
          outcomeType: outcome.outcomeType,
          outcomeAt: outcome.outcomeAt.toISOString(),
        });
      }
    }
    convertedSuggestions.sort((a, b) => new Date(b.outcomeAt).getTime() - new Date(a.outcomeAt).getTime());

    const safeRate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
    const conversionRates = {
      clickToMessage: safeRate(totals.messagesSent, totals.clicked),
      clickToQuote: safeRate(totals.quotesRequested, totals.clicked),
      clickToConnection: safeRate(totals.connectionsMade, totals.clicked),
      clickToDeal: safeRate(totals.dealsWon, totals.clicked),
      draftUsageRate: safeRate(totals.introDraftsUsed, totals.introDraftsGenerated),
    };

    const recent = events.slice(0, 25).map((e) => ({
      id: e.id,
      eventType: e.eventType,
      source: e.source,
      score: e.score,
      matchType: e.matchType,
      targetBusinessId: e.targetBusinessId,
      targetBusinessName: e.targetBusiness?.name ?? null,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      totals,
      bySource,
      conversionRates,
      convertedSuggestions: convertedSuggestions.slice(0, 25),
      recent,
    };
  }

  async submitFeedback(businessId: string, targetBusinessId: string, feedback: 'HELPFUL' | 'DISMISSED', matchScore?: number, matchType?: string) {
    const result = await this.prisma.client.matchFeedback.upsert({
      where: { businessId_targetBusinessId: { businessId, targetBusinessId } },
      create: { businessId, targetBusinessId, feedback, matchScore, matchType },
      update: { feedback, matchScore, matchType },
    });
    try {
      await this.prisma.client.businessMatch.deleteMany({ where: { businessId } });
    } catch (err) {
      this.logger.warn(`Failed to invalidate match cache for ${businessId}: ${(err as Error).message}`);
    }
    return result;
  }

  async getFeedback(businessId: string) {
    return this.prisma.client.matchFeedback.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMatchAnalytics(businessId: string) {
    const feedback = await this.prisma.client.matchFeedback.findMany({
      where: { businessId },
    });
    const total = feedback.length;
    const helpful = feedback.filter((f) => f.feedback === 'HELPFUL').length;
    const dismissed = feedback.filter((f) => f.feedback === 'DISMISSED').length;
    const helpfulRate = total > 0 ? Math.round((helpful / total) * 100) : 0;

    const byType: Record<string, { helpful: number; dismissed: number; total: number }> = {};
    for (const f of feedback) {
      const type = f.matchType || 'unknown';
      if (!byType[type]) byType[type] = { helpful: 0, dismissed: 0, total: 0 };
      byType[type].total++;
      if (f.feedback === 'HELPFUL') byType[type].helpful++;
      else byType[type].dismissed++;
    }

    const avgScoreHelpful = helpful > 0
      ? Math.round(feedback.filter((f) => f.feedback === 'HELPFUL' && f.matchScore).reduce((sum, f) => sum + (f.matchScore || 0), 0) / helpful)
      : null;
    const avgScoreDismissed = dismissed > 0
      ? Math.round(feedback.filter((f) => f.feedback === 'DISMISSED' && f.matchScore).reduce((sum, f) => sum + (f.matchScore || 0), 0) / dismissed)
      : null;

    return { total, helpful, dismissed, helpfulRate, avgScoreHelpful, avgScoreDismissed, byType };
  }

  private async loadFromDb(businessId: string): Promise<(MatchResult & { business: BusinessProfile })[] | null> {
    const cutoff = new Date(Date.now() - DB_CACHE_TTL_MS);

    const rows = await this.prisma.client.businessMatch.findMany({
      where: {
        businessId,
        computedAt: { gte: cutoff },
      },
      orderBy: { score: 'desc' },
      take: MAX_RECOMMENDATIONS,
    });

    if (rows.length === 0) return null;

    const targetIds = rows.map((r) => r.targetBusinessId);
    const targets = await this.prisma.client.business.findMany({
      where: { id: { in: targetIds }, deletedAt: null },
      select: {
        id: true, name: true, slug: true, logoUrl: true,
        headline: true, bio: true, industry: true, skills: true,
        businessStage: true, city: true, country: true, tagline: true,
        acceptingWork: true, currentCapacity: true, leadTime: true,
        preferredProjectTypes: true, budgetFit: true,
        positioningStatement: true, profileCompleteness: true,
        products: {
          where: { isActive: true },
          select: { id: true, name: true, price: true, currency: true, category: true },
          take: 3,
          orderBy: { createdAt: 'desc' },
        },
        services: {
          select: { id: true, name: true, price: true },
          take: 3,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { communityPosts: true, cohortMembers: true, networkConnectionsTo: true },
        },
      },
    });

    const targetMap = new Map(targets.map((t) => [t.id, t]));

    return rows
      .filter((r) => targetMap.has(r.targetBusinessId))
      .map((r) => {
        const target = targetMap.get(r.targetBusinessId)!;
        return {
          businessId: r.targetBusinessId,
          score: r.score,
          reasons: r.reasons,
          explanation: r.explanation,
          matchType: r.matchType as MatchResult['matchType'],
          business: target as BusinessProfile,
        };
      });
  }

  private async persistToDb(businessId: string, matches: (MatchResult & { business: BusinessProfile })[]): Promise<void> {
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.businessMatch.deleteMany({ where: { businessId } });

        if (matches.length > 0) {
          await tx.businessMatch.createMany({
            data: matches.map((m) => ({
              businessId,
              targetBusinessId: m.businessId,
              score: m.score,
              reasons: m.reasons,
              explanation: m.explanation,
              matchType: m.matchType,
              computedAt: new Date(),
            })),
          });
        }
      });
    } catch (err) {
      this.logger.warn(`Failed to persist matches for ${businessId}: ${(err as Error).message}`);
    }
  }

  private async computeMatches(businessId: string): Promise<(MatchResult & { business: BusinessProfile })[]> {
    const sourceBusiness = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true, name: true, industry: true, skills: true,
        businessStage: true, city: true, country: true,
        acceptingWork: true, currentCapacity: true,
        preferredProjectTypes: true, budgetFit: true,
        positioningStatement: true, headline: true, bio: true,
      },
    });

    if (!sourceBusiness) return [];

    const dismissedFeedback = await this.prisma.client.matchFeedback.findMany({
      where: { businessId, feedback: 'DISMISSED' },
      select: { targetBusinessId: true },
    });
    const dismissedIds = dismissedFeedback.map((f) => f.targetBusinessId);

    const candidates = await this.prisma.client.business.findMany({
      where: {
        id: { notIn: [businessId, ...dismissedIds] },
        deletedAt: null,
        profileCompleteness: { gte: 20 },
      },
      select: {
        id: true, name: true, slug: true, logoUrl: true,
        headline: true, bio: true, industry: true, skills: true,
        businessStage: true, city: true, country: true, tagline: true,
        acceptingWork: true, currentCapacity: true, leadTime: true,
        preferredProjectTypes: true, budgetFit: true,
        positioningStatement: true, profileCompleteness: true,
        products: {
          where: { isActive: true },
          select: { id: true, name: true, price: true, currency: true, category: true },
          take: 3,
          orderBy: { createdAt: 'desc' },
        },
        services: {
          select: { id: true, name: true, price: true },
          take: 3,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { communityPosts: true, cohortMembers: true, networkConnectionsTo: true },
        },
      },
      take: 100,
      orderBy: { profileCompleteness: 'desc' },
    });

    const scored = candidates.map((candidate) => {
      const { score, reasons, matchType } = this.scoreMatch(sourceBusiness, candidate);
      return { candidate, score, reasons, matchType };
    });

    scored.sort((a, b) => b.score - a.score);
    const topMatches = scored.slice(0, MAX_RECOMMENDATIONS).filter((m) => m.score > 0);

    if (topMatches.length === 0) return [];

    let explanations: string[] = [];
    try {
      explanations = await this.generateExplanations(sourceBusiness, topMatches);
    } catch (err) {
      this.logger.warn(`AI explanation generation failed: ${(err as Error).message}`);
      explanations = topMatches.map((m) => m.reasons.join('. '));
    }

    return topMatches.map((m, i) => ({
      businessId: m.candidate.id,
      score: Math.round(m.score),
      reasons: m.reasons,
      explanation: explanations[i] || m.reasons.join('. '),
      matchType: m.matchType,
      business: m.candidate as BusinessProfile,
    }));
  }

  private scoreMatch(
    source: { industry?: string | null; skills: string[]; city?: string | null; country?: string | null; preferredProjectTypes: string[]; budgetFit?: string | null; currentCapacity?: string | null },
    candidate: { industry?: string | null; skills: string[]; city?: string | null; country?: string | null; preferredProjectTypes: string[]; budgetFit?: string | null; acceptingWork: boolean; currentCapacity?: string | null; profileCompleteness: number },
  ): { score: number; reasons: string[]; matchType: MatchResult['matchType'] } {
    let score = 0;
    const reasons: string[] = [];
    let matchType: MatchResult['matchType'] = 'general';

    const sourceSkills = new Set(source.skills.map((s) => s.toLowerCase()));
    const candidateSkills = new Set(candidate.skills.map((s) => s.toLowerCase()));

    const commonSkills = [...sourceSkills].filter((s) => candidateSkills.has(s));
    const complementarySkills = [...candidateSkills].filter((s) => !sourceSkills.has(s));

    if (complementarySkills.length > 0 && commonSkills.length > 0) {
      score += Math.min(complementarySkills.length * 8, 30);
      score += Math.min(commonSkills.length * 3, 10);
      reasons.push('Complementary skills with shared expertise');
      matchType = 'complementary_skills';
    } else if (complementarySkills.length > 0) {
      score += Math.min(complementarySkills.length * 6, 25);
      reasons.push('Offers different skills that could complement yours');
      matchType = 'complementary_skills';
    } else if (commonSkills.length > 0) {
      score += Math.min(commonSkills.length * 4, 15);
      reasons.push('Shared skill set');
    }

    if (source.industry && candidate.industry) {
      const sameIndustry = source.industry.toLowerCase() === candidate.industry.toLowerCase();
      if (sameIndustry) {
        const hasDifferentSkills = complementarySkills.length > 0;
        if (hasDifferentSkills) {
          score += 20;
          reasons.push('Same industry, different specialties');
          matchType = matchType === 'general' ? 'same_industry' : matchType;
        } else {
          score += 10;
          reasons.push('Same industry');
          matchType = matchType === 'general' ? 'same_industry' : matchType;
        }
      }
    }

    const sourceProjectTypes = new Set(source.preferredProjectTypes.map((p) => p.toLowerCase()));
    const candidateProjectTypes = new Set(candidate.preferredProjectTypes.map((p) => p.toLowerCase()));
    const complementaryProjects = [...candidateProjectTypes].filter((p) => !sourceProjectTypes.has(p));
    const sharedProjects = [...sourceProjectTypes].filter((p) => candidateProjectTypes.has(p));

    if (complementaryProjects.length > 0) {
      score += Math.min(complementaryProjects.length * 5, 15);
      reasons.push('Works on different project types');
      if (matchType === 'general') matchType = 'referral_partner';
    }
    if (sharedProjects.length > 0) {
      score += Math.min(sharedProjects.length * 3, 10);
    }

    if (source.country && candidate.country &&
        source.country.toLowerCase() === candidate.country.toLowerCase()) {
      score += 8;
      if (source.city && candidate.city &&
          source.city.toLowerCase() === candidate.city.toLowerCase()) {
        score += 7;
        reasons.push('Located in the same city');
      } else {
        reasons.push('In the same country');
      }
    }

    if (candidate.acceptingWork) {
      score += 5;
      if (candidate.currentCapacity === 'OPEN') {
        score += 3;
        reasons.push('Currently accepting work');
      }
    }

    if (source.budgetFit && candidate.budgetFit &&
        source.budgetFit === candidate.budgetFit) {
      score += 5;
      reasons.push('Similar budget range');
    }

    score += Math.min(Math.floor(candidate.profileCompleteness / 10), 5);

    if (matchType === 'general' && reasons.length > 1) {
      matchType = 'collaboration';
    }

    return { score, reasons, matchType };
  }

  private async generateExplanations(
    source: { name: string; industry?: string | null; skills: string[]; preferredProjectTypes: string[] },
    matches: Array<{ candidate: { name: string; industry?: string | null; skills: string[]; preferredProjectTypes: string[] }; reasons: string[]; score: number }>,
  ): Promise<string[]> {
    const matchSummaries = matches.map((m, i) =>
      `${i + 1}. "${m.candidate.name}" (Industry: ${m.candidate.industry || 'N/A'}, Skills: ${m.candidate.skills.slice(0, 5).join(', ') || 'N/A'}, Project Types: ${m.candidate.preferredProjectTypes.slice(0, 3).join(', ') || 'N/A'}, Score: ${m.score}, Reasons: ${m.reasons.join('; ')})`
    ).join('\n');

    const result = await this.aiUsage.callAi({
      businessId: source.name,
      feature: 'business_matching',
      model: 'gpt-4o-mini',
      maxTokens: 600,
      temperature: 0.6,
      responseMode: 'structured_json',
      messages: [
        {
          role: 'system',
          content: `You generate short, helpful match explanations for a business networking platform for Caribbean entrepreneurs. Given a source business and its recommended matches, write a brief 1-sentence explanation for EACH match explaining why they are a good fit. Be specific and actionable. Return ONLY a JSON array of strings, one explanation per match, in order. No markdown, no extra text.`,
        },
        {
          role: 'user',
          content: `Source business: "${source.name}" (Industry: ${source.industry || 'N/A'}, Skills: ${source.skills.slice(0, 5).join(', ') || 'N/A'}, Project Types: ${source.preferredProjectTypes.slice(0, 3).join(', ') || 'N/A'})\n\nRecommended matches:\n${matchSummaries}`,
        },
      ],
    });

    try {
      const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      this.logger.warn('Failed to parse AI explanation response');
    }

    return matches.map((m) => m.reasons.join('. '));
  }

  // ==========================================
  // SMART INTRO MESSAGE DRAFTING
  // ==========================================

  async draftIntroMessage(
    fromBusinessId: string,
    toBusinessId: string,
    options?: { context?: string; goal?: 'introduce' | 'collaborate' | 'quote' | 'referral'; source?: string },
  ): Promise<{ draft: string; tone: string; suggestedFollowUp?: string }> {
    if (fromBusinessId === toBusinessId) {
      return { draft: '', tone: 'neutral' };
    }
    const goal = options?.goal ?? 'introduce';
    const source = options?.source ?? 'message_modal';

    void this.recordSuggestionEvent(fromBusinessId, {
      eventType: 'INTRO_DRAFT_GENERATED',
      source,
      targetBusinessId: toBusinessId,
      metadata: { goal },
    });

    const [from, to] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: fromBusinessId },
        select: {
          id: true, name: true, industry: true, skills: true, headline: true,
          tagline: true, businessStage: true, city: true, country: true,
          preferredProjectTypes: true, positioningStatement: true,
        },
      }),
      this.prisma.client.business.findUnique({
        where: { id: toBusinessId },
        select: {
          id: true, name: true, industry: true, skills: true, headline: true,
          tagline: true, businessStage: true, city: true, country: true,
          preferredProjectTypes: true, positioningStatement: true,
          acceptingWork: true, currentCapacity: true,
        },
      }),
    ]);

    if (!from || !to) {
      throw new Error('Business not found');
    }

    let priorInteractions = 0;
    try {
      priorInteractions = await this.prisma.client.businessMessage.count({
        where: {
          OR: [
            { fromBusinessId, toBusinessId },
            { fromBusinessId: toBusinessId, toBusinessId: fromBusinessId },
          ],
        },
      });
    } catch {}

    const sourceSkills = new Set(from.skills.map((s) => s.toLowerCase()));
    const sharedSkills = to.skills.filter((s) => sourceSkills.has(s.toLowerCase())).slice(0, 3);
    const complementarySkills = to.skills.filter((s) => !sourceSkills.has(s.toLowerCase())).slice(0, 3);
    const sameIndustry = from.industry && to.industry && from.industry.toLowerCase() === to.industry.toLowerCase();
    const sameCity = from.city && to.city && from.city.toLowerCase() === to.city.toLowerCase();

    const goalInstructions: Record<string, string> = {
      introduce: 'a warm first-touch introduction to start a connection',
      collaborate: 'a proposal to explore a collaboration or joint project',
      quote: 'a request for pricing or a quote on services',
      referral: 'a referral hand-off introducing a potential client',
    };

    const result = await this.aiUsage.callAi({
      businessId: fromBusinessId,
      feature: 'intro_draft',
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.7,
      responseMode: 'structured_json',
      messages: [
        {
          role: 'system',
          content: `You draft short, authentic outreach messages for Caribbean entrepreneurs on a business networking platform. The tone is warm, professional, peer-to-peer (NEVER salesy or formal). Keep messages 2-4 sentences, personalised to the recipient, and end with a clear, low-pressure question or next step. Do NOT use placeholders like [Your Name] or generic openers. Return ONLY a JSON object: {"draft": string, "tone": "warm"|"professional"|"casual", "suggestedFollowUp"?: string}. No markdown.`,
        },
        {
          role: 'user',
          content:
            `Sender: "${from.name}" — ${from.headline || from.tagline || 'No headline'} — Industry: ${from.industry || 'N/A'} — Skills: ${from.skills.slice(0, 5).join(', ') || 'N/A'}\n` +
            `Recipient: "${to.name}" — ${to.headline || to.tagline || 'No headline'} — Industry: ${to.industry || 'N/A'} — Skills: ${to.skills.slice(0, 5).join(', ') || 'N/A'}\n` +
            `Context: Goal is ${goalInstructions[goal]}.` +
            (sharedSkills.length ? ` They share skills: ${sharedSkills.join(', ')}.` : '') +
            (complementarySkills.length ? ` Recipient brings complementary skills: ${complementarySkills.join(', ')}.` : '') +
            (sameIndustry ? ` Same industry.` : '') +
            (sameCity ? ` Both based in ${from.city}.` : '') +
            (priorInteractions > 0 ? ` They have ${priorInteractions} prior message(s) — reference reconnecting.` : ' This is a first-time introduction.') +
            (options?.context ? `\nExtra context from sender: "${options.context.slice(0, 400)}"` : ''),
        },
      ],
    });

    try {
      const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.draft === 'string' && parsed.draft.trim()) {
        return {
          draft: parsed.draft,
          tone: typeof parsed.tone === 'string' ? parsed.tone : 'warm',
          suggestedFollowUp: typeof parsed.suggestedFollowUp === 'string' ? parsed.suggestedFollowUp : undefined,
        };
      }
    } catch {
      this.logger.warn('Failed to parse intro draft response');
    }

    const fallback = `Hi ${to.name}, I'm ${from.name}${from.industry ? ` working in ${from.industry}` : ''}.` +
      (sharedSkills.length ? ` Saw we share work in ${sharedSkills.join(', ')}.` : complementarySkills.length ? ` Your work in ${complementarySkills.join(', ')} caught my eye.` : '') +
      ` Open to a quick chat?`;
    return { draft: fallback, tone: 'warm' };
  }

  // ==========================================
  // NEED -> PROVIDER MATCHING
  // ==========================================

  async matchProvidersForNeed(
    businessId: string,
    need: { title?: string; description: string; budgetMin?: number; budgetMax?: number; timeline?: string; projectType?: string; categoryHint?: string },
    limit = 5,
  ): Promise<Array<MatchResult & { business: BusinessProfile; relevanceReason: string }>> {
    const text = `${need.title || ''} ${need.description || ''} ${need.projectType || ''} ${need.categoryHint || ''}`.toLowerCase();
    if (!text.trim()) return [];

    const tokens = Array.from(new Set(text
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3)));

    const orFilters: any[] = [];
    for (const tok of tokens.slice(0, 12)) {
      orFilters.push({ skills: { has: tok } });
      orFilters.push({ industry: { contains: tok, mode: 'insensitive' } });
      orFilters.push({ headline: { contains: tok, mode: 'insensitive' } });
      orFilters.push({ bio: { contains: tok, mode: 'insensitive' } });
      orFilters.push({ preferredProjectTypes: { has: tok } });
    }

    const candidates = await this.prisma.client.business.findMany({
      where: {
        id: { not: businessId },
        deletedAt: null,
        acceptingWork: true,
        profileCompleteness: { gte: 20 },
        ...(orFilters.length > 0 ? { OR: orFilters } : {}),
      },
      select: {
        id: true, name: true, slug: true, logoUrl: true,
        headline: true, bio: true, industry: true, skills: true,
        businessStage: true, city: true, country: true, tagline: true,
        acceptingWork: true, currentCapacity: true, leadTime: true,
        preferredProjectTypes: true, budgetFit: true,
        positioningStatement: true, profileCompleteness: true,
        products: { where: { isActive: true }, select: { id: true, name: true, price: true, currency: true, category: true }, take: 3, orderBy: { createdAt: 'desc' } },
        services: { select: { id: true, name: true, price: true }, take: 3, orderBy: { createdAt: 'desc' } },
        _count: { select: { communityPosts: true, cohortMembers: true, networkConnectionsTo: true } },
      },
      take: 50,
      orderBy: { profileCompleteness: 'desc' },
    });

    const scored = candidates.map((c) => {
      let score = 0;
      const reasons: string[] = [];
      const skillsLower = c.skills.map((s) => s.toLowerCase());
      const matchedSkills = tokens.filter((t) => skillsLower.includes(t));
      if (matchedSkills.length > 0) {
        score += matchedSkills.length * 12;
        reasons.push(`Skills match: ${matchedSkills.slice(0, 3).join(', ')}`);
      }
      const projTypesLower = c.preferredProjectTypes.map((p) => p.toLowerCase());
      const matchedProjects = tokens.filter((t) => projTypesLower.includes(t));
      if (matchedProjects.length > 0) {
        score += matchedProjects.length * 8;
        reasons.push(`Works on: ${matchedProjects.slice(0, 2).join(', ')}`);
      }
      const haystack = `${c.headline || ''} ${c.bio || ''} ${c.industry || ''}`.toLowerCase();
      const textHits = tokens.filter((t) => haystack.includes(t));
      if (textHits.length > 0) {
        score += Math.min(textHits.length * 3, 12);
      }
      if (c.acceptingWork) {
        score += 5;
        if (c.currentCapacity === 'OPEN') score += 4;
      }
      if (need.budgetMin || need.budgetMax) {
        if (c.budgetFit) {
          score += 4;
          reasons.push(`Budget fit: ${c.budgetFit}`);
        }
      }
      score += Math.min(Math.floor(c.profileCompleteness / 10), 5);
      return { candidate: c, score, reasons };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, limit);

    if (top.length === 0) return [];

    let aiReasons: string[] = [];
    try {
      const summary = top.map((m, i) =>
        `${i + 1}. "${m.candidate.name}" — Skills: ${m.candidate.skills.slice(0, 5).join(', ') || 'N/A'} — Industry: ${m.candidate.industry || 'N/A'}`
      ).join('\n');
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'need_match',
        model: 'gpt-4o-mini',
        maxTokens: 500,
        temperature: 0.5,
        responseMode: 'structured_json',
        messages: [
          {
            role: 'system',
            content: `You write short relevance explanations for service-provider matches based on a stated need. Return ONLY a JSON array of strings (one per provider, in order). Each string is ONE sentence (≤22 words) explaining why the provider fits this specific need. No markdown.`,
          },
          {
            role: 'user',
            content: `Need: "${need.title || ''} — ${need.description.slice(0, 300)}"${need.budgetMin || need.budgetMax ? `\nBudget: ${need.budgetMin || '?'} – ${need.budgetMax || '?'}` : ''}${need.timeline ? `\nTimeline: ${need.timeline}` : ''}\n\nProviders:\n${summary}`,
          },
        ],
      });
      const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) aiReasons = parsed.map(String);
    } catch (err) {
      this.logger.warn(`AI relevance reason failed: ${(err as Error).message}`);
    }

    return top.map((m, i) => ({
      businessId: m.candidate.id,
      score: Math.round(m.score),
      reasons: m.reasons,
      explanation: aiReasons[i] || m.reasons.join('. '),
      relevanceReason: aiReasons[i] || m.reasons.join('. '),
      matchType: 'collaboration' as MatchResult['matchType'],
      business: m.candidate as BusinessProfile,
    }));
  }

  /**
   * Triggered when a community post (QUESTION/OPPORTUNITY) is created.
   * Notifies top-matched providers about a relevant post.
   * Returns the matched provider IDs (used by caller for notifications).
   */
  async matchProvidersForPost(args: {
    fromBusinessId: string;
    postId: string;
    title?: string;
    content: string;
    type?: string;
    tags?: string[];
  }, limit = 3): Promise<Array<{ businessId: string; score: number; explanation: string }>> {
    const text = `${args.title || ''} ${args.content || ''} ${(args.tags || []).join(' ')}`.trim();
    if (text.length < 10) return [];

    const matches = await this.matchProvidersForNeed(args.fromBusinessId, {
      title: args.title,
      description: args.content,
      categoryHint: (args.tags || []).join(' '),
    }, limit);

    return matches.map((m) => ({
      businessId: m.businessId,
      score: m.score,
      explanation: m.explanation,
    }));
  }

  // ==========================================
  // RELATIONSHIP INSIGHTS
  // ==========================================

  async getRelationshipInsights(businessId: string): Promise<{
    underutilized: Array<{
      businessId: string;
      name: string;
      logoUrl?: string | null;
      headline?: string | null;
      industry?: string | null;
      lastInteractionAt?: string | null;
      reason: string;
      suggestedAction: 'reconnect' | 'collaborate' | 'review' | 'follow_up';
    }>;
    suggestions: string[];
  }> {
    const cutoffMs = 60 * 24 * 60 * 60 * 1000; // 60 days
    const cutoff = new Date(Date.now() - cutoffMs);

    // Pull dismissals so we can filter their targets out of the suggestions.
    // A dismissal is "active" when snoozedUntil is null (permanent) or still in the future.
    const now = new Date();
    const activeDismissals = await this.prisma.client.relationshipInsightDismissal.findMany({
      where: {
        businessId,
        OR: [
          { snoozedUntil: null },
          { snoozedUntil: { gt: now } },
        ],
      },
      select: { targetBusinessId: true },
    });
    const dismissedIds = new Set(activeDismissals.map((d) => d.targetBusinessId));

    const [followingOut, followingIn, recentMessages] = await Promise.all([
      this.prisma.client.networkConnection.findMany({
        where: { fromBusinessId: businessId, type: 'FOLLOW' },
        select: {
          toBusinessId: true,
          createdAt: true,
          toBusiness: {
            select: { id: true, name: true, logoUrl: true, headline: true, industry: true, acceptingWork: true, currentCapacity: true },
          },
        },
        take: 100,
      }),
      this.prisma.client.networkConnection.findMany({
        where: { toBusinessId: businessId, type: 'FOLLOW' },
        select: {
          fromBusinessId: true,
          createdAt: true,
          fromBusiness: {
            select: { id: true, name: true, logoUrl: true, headline: true, industry: true, acceptingWork: true, currentCapacity: true },
          },
        },
        take: 100,
      }),
      this.prisma.client.businessMessage.findMany({
        where: {
          OR: [
            { fromBusinessId: businessId },
            { toBusinessId: businessId },
          ],
        },
        select: { fromBusinessId: true, toBusinessId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    const lastInteraction = new Map<string, Date>();
    for (const m of recentMessages) {
      const other = m.fromBusinessId === businessId ? m.toBusinessId : m.fromBusinessId;
      const existing = lastInteraction.get(other);
      if (!existing || m.createdAt > existing) lastInteraction.set(other, m.createdAt);
    }

    const candidates = new Map<string, {
      businessId: string;
      name: string;
      logoUrl?: string | null;
      headline?: string | null;
      industry?: string | null;
      acceptingWork?: boolean;
      currentCapacity?: string | null;
      connectedAt: Date;
      lastInteractionAt: Date | null;
      mutual: boolean;
    }>();

    const inFollowSet = new Set(followingIn.map((c) => c.fromBusinessId));

    for (const c of followingOut) {
      if (!c.toBusiness) continue;
      if (dismissedIds.has(c.toBusinessId)) continue;
      candidates.set(c.toBusinessId, {
        businessId: c.toBusinessId,
        name: c.toBusiness.name,
        logoUrl: c.toBusiness.logoUrl,
        headline: c.toBusiness.headline,
        industry: c.toBusiness.industry,
        acceptingWork: c.toBusiness.acceptingWork,
        currentCapacity: c.toBusiness.currentCapacity,
        connectedAt: c.createdAt,
        lastInteractionAt: lastInteraction.get(c.toBusinessId) || null,
        mutual: inFollowSet.has(c.toBusinessId),
      });
    }
    for (const c of followingIn) {
      if (!c.fromBusiness) continue;
      if (candidates.has(c.fromBusinessId)) continue;
      if (dismissedIds.has(c.fromBusinessId)) continue;
      candidates.set(c.fromBusinessId, {
        businessId: c.fromBusinessId,
        name: c.fromBusiness.name,
        logoUrl: c.fromBusiness.logoUrl,
        headline: c.fromBusiness.headline,
        industry: c.fromBusiness.industry,
        acceptingWork: c.fromBusiness.acceptingWork,
        currentCapacity: c.fromBusiness.currentCapacity,
        connectedAt: c.createdAt,
        lastInteractionAt: lastInteraction.get(c.fromBusinessId) || null,
        mutual: false,
      });
    }

    const underutilized: Array<{
      businessId: string;
      name: string;
      logoUrl?: string | null;
      headline?: string | null;
      industry?: string | null;
      lastInteractionAt?: string | null;
      reason: string;
      suggestedAction: 'reconnect' | 'collaborate' | 'review' | 'follow_up';
      _priority: number;
    }> = [];

    for (const c of candidates.values()) {
      const hasInteraction = !!c.lastInteractionAt;
      const isStale = !c.lastInteractionAt || c.lastInteractionAt < cutoff;
      const isOldConnection = c.connectedAt < cutoff;

      if (!hasInteraction && isOldConnection) {
        underutilized.push({
          businessId: c.businessId,
          name: c.name,
          logoUrl: c.logoUrl,
          headline: c.headline,
          industry: c.industry,
          lastInteractionAt: null,
          reason: c.mutual ? 'You both follow each other but have never connected directly' : 'Connected but never engaged',
          suggestedAction: 'reconnect',
          _priority: c.mutual ? 90 : 60,
        });
      } else if (hasInteraction && isStale) {
        const days = Math.floor((Date.now() - c.lastInteractionAt!.getTime()) / 86400000);
        underutilized.push({
          businessId: c.businessId,
          name: c.name,
          logoUrl: c.logoUrl,
          headline: c.headline,
          industry: c.industry,
          lastInteractionAt: c.lastInteractionAt!.toISOString(),
          reason: `Last spoke ${days} days ago — worth a check-in`,
          suggestedAction: 'follow_up',
          _priority: 70 + (c.acceptingWork ? 10 : 0),
        });
      }
    }

    underutilized.sort((a, b) => b._priority - a._priority);
    const top = underutilized.slice(0, 6).map(({ _priority, ...rest }) => rest);

    const suggestions: string[] = [];
    if (top.length === 0 && candidates.size === 0) {
      suggestions.push('Start building your network — explore the directory and connect with peers.');
    } else if (top.length === 0) {
      suggestions.push('Your network is well-tended — keep the momentum going.');
    } else {
      const reconnectCount = top.filter((t) => t.suggestedAction === 'reconnect').length;
      const followUpCount = top.filter((t) => t.suggestedAction === 'follow_up').length;
      if (reconnectCount > 0) suggestions.push(`${reconnectCount} connection${reconnectCount > 1 ? 's' : ''} you've never engaged — try a quick intro.`);
      if (followUpCount > 0) suggestions.push(`${followUpCount} relationship${followUpCount > 1 ? 's have' : ' has'} gone quiet — a check-in could re-open the door.`);
    }

    return { underutilized: top, suggestions };
  }

  /**
   * Dismiss or snooze a relationship insight suggestion.
   * - snoozeDays > 0  -> hide for that many days, then resurface
   * - snoozeDays = 0 / undefined -> permanent dismissal (snoozedUntil = null)
   */
  async dismissRelationshipInsight(
    businessId: string,
    targetBusinessId: string,
    snoozeDays?: number,
  ): Promise<{ businessId: string; targetBusinessId: string; snoozedUntil: string | null; dismissedAt: string }> {
    if (!targetBusinessId) {
      throw new BadRequestException('targetBusinessId is required');
    }
    if (businessId === targetBusinessId) {
      throw new BadRequestException('Cannot dismiss your own business');
    }

    const snoozedUntil = snoozeDays && snoozeDays > 0
      ? new Date(Date.now() + snoozeDays * 24 * 60 * 60 * 1000)
      : null;
    const dismissedAt = new Date();

    const row = await this.prisma.client.relationshipInsightDismissal.upsert({
      where: { businessId_targetBusinessId: { businessId, targetBusinessId } },
      create: { businessId, targetBusinessId, dismissedAt, snoozedUntil },
      update: { dismissedAt, snoozedUntil },
    });

    return {
      businessId: row.businessId,
      targetBusinessId: row.targetBusinessId,
      dismissedAt: row.dismissedAt.toISOString(),
      snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    };
  }

  /**
   * Restore (un-dismiss) a previously dismissed/snoozed relationship insight.
   */
  async restoreRelationshipInsight(businessId: string, targetBusinessId: string): Promise<{ removed: boolean }> {
    const result = await this.prisma.client.relationshipInsightDismissal.deleteMany({
      where: { businessId, targetBusinessId },
    });
    return { removed: result.count > 0 };
  }
}
