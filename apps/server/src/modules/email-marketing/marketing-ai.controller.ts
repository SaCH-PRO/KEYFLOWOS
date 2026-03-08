import { BadRequestException, Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { MarketingAiService } from './marketing-ai.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from '../crm/guards/feature-flag.guard';
import { checkAiRateLimit } from '../crm/ai-rate-limit.util';

@Controller('marketing')
@UseGuards(CrmRateLimitGuard)
export class MarketingAiController {
  constructor(
    @Inject(MarketingAiService) private readonly marketingAi: MarketingAiService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/marketing/ai-search')
  aiSearch(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.marketingAi.naturalLanguageSearch(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/marketing/ai-campaign-content')
  aiCampaignContent(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.marketingAi.campaignContentGenerator(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/marketing/ai-performance')
  aiPerformance(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.marketingAi.campaignPerformanceAnalyzer(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/marketing/ai-audience')
  aiAudience(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.marketingAi.audienceSegmentAdvisor(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/marketing/ai-subject-lines')
  aiSubjectLines(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.marketingAi.subjectLineOptimizer(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/marketing/ai-form-optimizer')
  aiFormOptimizer(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('query must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.marketingAi.leadFormOptimizer(businessId, body.query);
  }
}
