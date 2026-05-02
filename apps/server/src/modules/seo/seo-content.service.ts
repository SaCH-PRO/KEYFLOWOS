import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class SeoContentService {
  private readonly logger = new Logger(SeoContentService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    private readonly events: EventEmitter2,
  ) {}

  async detectContentGaps(businessId: string) {
    const trackedKeywords = await this.prisma.client.seoKeyword.findMany({
      where: { businessId, isTracked: true },
      include: { page: true },
    });

    const gaps: Array<{
      keyword: string;
      currentPosition: number | null;
      hasPage: boolean;
      pageId?: string;
      opportunityScore: number;
      reason: string;
    }> = [];

    for (const kw of trackedKeywords) {
      let opportunityScore = 0;
      let reason = '';
      const hasPage = !!kw.pageId;

      if (!hasPage) {
        opportunityScore = 80;
        reason = 'No dedicated page targeting this keyword';
      } else if (kw.currentPosition && kw.currentPosition > 10 && kw.currentPosition <= 30) {
        opportunityScore = 70;
        reason = `Ranking on page 2-3 (position ${kw.currentPosition}). Improve to reach page 1.`;
      } else if (kw.currentPosition && kw.currentPosition > 3 && kw.currentPosition <= 10) {
        opportunityScore = 60;
        reason = `Ranking on page 1 (position ${kw.currentPosition}). Push to top 3 for major traffic gain.`;
      } else if (kw.impressions > 100 && kw.ctr < 0.02) {
        opportunityScore = 50;
        reason = 'High impressions, low CTR — meta description and title need optimization';
      }

      if (opportunityScore > 0) {
        gaps.push({
          keyword: kw.keyword,
          currentPosition: kw.currentPosition,
          hasPage,
          pageId: kw.pageId ?? undefined,
          opportunityScore,
          reason,
        });
      }
    }

    return gaps.sort((a, b) => b.opportunityScore - a.opportunityScore);
  }

  async generateBrief(businessId: string, data: {
    targetKeyword: string;
    targetPath?: string;
    contentType?: string;
    notes?: string;
  }) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { name: true, industry: true, country: true },
    });

    const relatedKeywords = await this.prisma.client.seoKeyword.findMany({
      where: { businessId, isTracked: true },
      select: { keyword: true, currentPosition: true },
      take: 20,
    });

    const systemPrompt = `You are an SEO content strategist for ${business?.name ?? 'a business'} ` +
      `(${business?.industry ?? 'general'} industry, based in ${business?.country ?? 'Trinidad and Tobago'}). ` +
      `Generate a detailed content brief in JSON format. ` +
      `Output ONLY valid JSON with this exact shape: ` +
      `{"title": string, "primaryKeyword": string, "secondaryKeywords": string[], ` +
      `"searchIntent": "informational"|"navigational"|"commercial"|"transactional", ` +
      `"recommendedWordCount": number, "outline": [{"heading": string, "level": "h2"|"h3", "talkingPoints": string[]}], ` +
      `"metaTitle": string, "metaDescription": string, "callToAction": string, ` +
      `"competitorAngle": string, "internalLinkSuggestions": string[]}`;

    const userPrompt = `Generate a content brief for the keyword: "${data.targetKeyword}"\n` +
      `Content type: ${data.contentType ?? 'blog post / landing page'}\n` +
      (data.targetPath ? `Target page path: ${data.targetPath}\n` : '') +
      `Related tracked keywords: ${relatedKeywords.map(k => k.keyword).join(', ')}\n` +
      (data.notes ? `Additional notes: ${data.notes}\n` : '') +
      `\nUse Caribbean / Trinidad-relevant context where appropriate. Currency is TTD. ` +
      `Be specific and actionable. Return only JSON.`;

    let aiResult: any = null;
    try {
      aiResult = await this.aiUsage.callAi({
        businessId,
        feature: 'seo_content_brief',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 2000,
        temperature: 0.6,
        responseMode: 'structured_json',
      });
    } catch (err) {
      this.logger.error(`AI brief generation failed: ${(err as Error).message}`);
    }

    let parsed: any = {
      title: `Content brief: ${data.targetKeyword}`,
      primaryKeyword: data.targetKeyword,
      secondaryKeywords: [],
      searchIntent: 'informational',
      recommendedWordCount: 1200,
      outline: [],
      metaTitle: '',
      metaDescription: '',
      callToAction: '',
      competitorAngle: '',
      internalLinkSuggestions: [],
    };

    if (aiResult?.content) {
      try {
        const cleaned = aiResult.content
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        parsed = { ...parsed, ...JSON.parse(cleaned) };
      } catch (err) {
        this.logger.warn(`Failed to parse AI brief JSON: ${(err as Error).message}`);
      }
    }

    let pageId: string | undefined;
    if (data.targetPath) {
      const page = await this.prisma.client.seoPage.findUnique({
        where: { businessId_path: { businessId, path: data.targetPath } },
      });
      pageId = page?.id;
    }

    const brief = await this.prisma.client.contentBrief.create({
      data: {
        businessId,
        pageId,
        title: parsed.title,
        targetKeyword: data.targetKeyword,
        secondaryKeywords: parsed.secondaryKeywords ?? [],
        contentType: data.contentType ?? 'article',
        searchIntent: parsed.searchIntent,
        recommendedWordCount: parsed.recommendedWordCount ?? 1200,
        outline: parsed.outline ?? [],
        suggestedMetaTitle: parsed.metaTitle,
        suggestedMetaDescription: parsed.metaDescription,
        callToAction: parsed.callToAction,
        competitorAngle: parsed.competitorAngle,
        internalLinkSuggestions: parsed.internalLinkSuggestions ?? [],
        status: 'draft',
        priority: 'medium',
        approvalStatus: 'pending',
      },
    });

    this.events.emit('seo.content_brief_created', {
      businessId,
      briefId: brief.id,
      targetKeyword: brief.targetKeyword,
      title: brief.title,
    });

    return brief;
  }

  async generateBriefsForGaps(businessId: string, limit = 3) {
    const gaps = await this.detectContentGaps(businessId);
    const topGaps = gaps.slice(0, limit);

    const briefs = [];
    for (const gap of topGaps) {
      try {
        const brief = await this.generateBrief(businessId, {
          targetKeyword: gap.keyword,
          notes: `Content gap detected: ${gap.reason} (opportunity score: ${gap.opportunityScore})`,
        });
        briefs.push(brief);
      } catch (err) {
        this.logger.warn(`Failed to generate brief for ${gap.keyword}: ${(err as Error).message}`);
      }
    }

    return { generated: briefs.length, briefs };
  }
}
