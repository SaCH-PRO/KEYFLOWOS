import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CustomerJourneyService, type JourneyStage } from './customer-journey.service';
import { AttributionService, type AttributionDimension, type AttributionModel } from './attribution.service';
import { GrowthIntelligenceService } from './growth-intelligence.service';

@Controller('growth-intelligence')
@UseGuards(AuthGuard, BusinessGuard)
export class GrowthIntelligenceController {
  constructor(
    @Inject(GrowthIntelligenceService) private readonly growth: GrowthIntelligenceService,
    @Inject(CustomerJourneyService) private readonly journeys: CustomerJourneyService,
    @Inject(AttributionService) private readonly attribution: AttributionService,
  ) {}

  @Get('businesses/:businessId/dashboard')
  getDashboard(@Param('businessId') businessId: string) {
    return this.growth.getDashboard(businessId);
  }

  @Get('businesses/:businessId/journeys')
  listJourneys(
    @Param('businessId') businessId: string,
    @Query('stage') stage?: string,
    @Query('limit') limit?: string,
  ) {
    return this.journeys.listJourneys(businessId, {
      stage: stage as JourneyStage | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('businesses/:businessId/journeys/:contactId')
  async getJourney(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    const journey = await this.journeys.getJourney(businessId, contactId);
    if (!journey) return { found: false, journey: null };
    return { found: true, journey };
  }

  @Post('businesses/:businessId/journeys/backfill')
  backfill(@Param('businessId') businessId: string) {
    return this.journeys.backfillBusiness(businessId);
  }

  @Get('businesses/:businessId/attribution')
  getAttribution(
    @Param('businessId') businessId: string,
    @Query('model') model?: string,
    @Query('dimension') dimension?: string,
  ) {
    return this.attribution.getResults({
      businessId,
      model: model as AttributionModel | undefined,
      dimension: dimension as AttributionDimension | undefined,
    });
  }

  @Post('businesses/:businessId/attribution/recompute')
  recomputeAttribution(@Param('businessId') businessId: string, @Body() body: { periodStart?: string; periodEnd?: string }) {
    return this.attribution.compute({
      businessId,
      periodStart: body?.periodStart ? new Date(body.periodStart) : undefined,
      periodEnd: body?.periodEnd ? new Date(body.periodEnd) : undefined,
    });
  }

  @Get('businesses/:businessId/insights')
  listInsights(@Param('businessId') businessId: string, @Query('status') status?: string) {
    return this.growth.listInsights(businessId, { status });
  }

  @Post('businesses/:businessId/insights/regenerate')
  regenerate(@Param('businessId') businessId: string) {
    return this.growth.generateInsights(businessId);
  }

  @Post('businesses/:businessId/insights/:insightId/status')
  updateInsight(
    @Param('businessId') businessId: string,
    @Param('insightId') insightId: string,
    @Body() body: { status: 'acknowledged' | 'dismissed' | 'applied' },
  ) {
    if (!body?.status) throw new BadRequestException('status required');
    return this.growth.acknowledgeInsight(businessId, insightId, body.status);
  }
}
