import { Inject, Injectable, Logger } from '@nestjs/common';
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
}
