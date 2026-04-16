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

interface CachedRecommendations {
  matches: (MatchResult & { business: BusinessProfile })[];
  computedAt: number;
}

@Injectable()
export class BusinessMatchingService {
  private readonly logger = new Logger(BusinessMatchingService.name);
  private readonly cache = new Map<string, CachedRecommendations>();
  private readonly CACHE_TTL_MS = 30 * 60 * 1000;
  private readonly MAX_RECOMMENDATIONS = 6;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async getRecommendations(businessId: string, forceRefresh = false): Promise<(MatchResult & { business: BusinessProfile })[]> {
    if (!forceRefresh) {
      const cached = this.cache.get(businessId);
      if (cached && Date.now() - cached.computedAt < this.CACHE_TTL_MS) {
        return cached.matches;
      }
    }

    const matches = await this.computeMatches(businessId);
    this.cache.set(businessId, { matches, computedAt: Date.now() });
    return matches;
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

    const candidates = await this.prisma.client.business.findMany({
      where: {
        id: { not: businessId },
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
          select: { id: true, name: true, price: true, currency: true },
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
    const topMatches = scored.slice(0, this.MAX_RECOMMENDATIONS).filter((m) => m.score > 0);

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
