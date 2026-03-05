import { BadRequestException, Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { BookingsAiService } from './bookings-ai.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from '../crm/guards/feature-flag.guard';
import { checkAiRateLimit } from '../crm/ai-rate-limit.util';

@Controller('bookings')
@UseGuards(CrmRateLimitGuard)
export class BookingsAiController {
  constructor(
    @Inject(BookingsAiService) private readonly bookingsAi: BookingsAiService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-search')
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
    return this.bookingsAi.naturalLanguageSearch(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-schedule-optimizer')
  aiScheduleOptimizer(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.bookingsAi.scheduleOptimizer(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-no-show-predictor')
  aiNoShowPredictor(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.bookingsAi.noShowPredictor(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-revenue-insights')
  aiRevenueInsights(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.bookingsAi.revenueInsights(businessId);
  }
}
