import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AnalyticsEngineService } from './analytics-engine.service';
import { ProjectionService } from './projection.service';
import { GrowthInsightGeneratorService } from './growth-insight-generator.service';
import { MaturityAssessmentService } from './maturity-assessment.service';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RequireModuleScope } from '../../core/auth/module-scope.guard';

@Controller('api/businesses/:businessId/analytics')
@UseGuards(BusinessGuard)
export class AnalyticsController {
  constructor(
    private readonly engine: AnalyticsEngineService,
    private readonly projection: ProjectionService,
    private readonly intelligence: GrowthInsightGeneratorService,
    private readonly maturity: MaturityAssessmentService,
  ) {}

  @Get('overview')
  @RequireModuleScope('analytics')
  async getOverview(
    @Param('businessId') businessId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.engine.getOverview(businessId, days);
  }

  @Get('snapshots')
  @RequireModuleScope('analytics')
  async getSnapshots(
    @Param('businessId') businessId: string,
    @Query('type') type: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.engine.getSnapshots(businessId, type, days);
  }

  @Get('trends')
  @RequireModuleScope('analytics')
  async getTrends(
    @Param('businessId') businessId: string,
    @Query('metric') metric: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.engine.getTrends(businessId, metric, days);
  }

  @Get('metrics')
  @RequireModuleScope('analytics')
  async getMetrics(@Param('businessId') businessId: string) {
    return this.engine.getAvailableMetrics(businessId);
  }

  @Post('projections/revenue')
  @RequireModuleScope('analytics')
  async generateRevenueProjection(
    @Param('businessId') businessId: string,
    @Query('months', new DefaultValuePipe(3), ParseIntPipe) months: number,
  ) {
    return this.projection.generateRevenueProjection(businessId, months);
  }

  @Post('projections/contacts')
  @RequireModuleScope('analytics')
  async generateContactProjection(
    @Param('businessId') businessId: string,
    @Query('months', new DefaultValuePipe(3), ParseIntPipe) months: number,
  ) {
    return this.projection.generateContactGrowthProjection(businessId, months);
  }

  @Get('projections')
  @RequireModuleScope('analytics')
  async getProjections(@Param('businessId') businessId: string) {
    return this.projection.getLatestProjections(businessId);
  }

  @Post('insights/generate')
  @RequireModuleScope('analytics')
  async generateInsights(@Param('businessId') businessId: string) {
    return this.intelligence.generateInsights(businessId);
  }

  @Get('insights')
  @RequireModuleScope('analytics')
  async getInsights(
    @Param('businessId') businessId: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('type') type?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    return this.intelligence.getInsights(businessId, {
      insightType: type,
      category,
      status,
      limit,
      offset,
    });
  }

  @Post('insights/:id/read')
  @RequireModuleScope('analytics')
  async markInsightRead(@Param('id') id: string) {
    return this.intelligence.markInsightRead(id);
  }

  @Post('insights/:id/dismiss')
  @RequireModuleScope('analytics')
  async dismissInsight(@Param('id') id: string) {
    return this.intelligence.dismissInsight(id);
  }

  @Post('maturity/assess')
  @RequireModuleScope('analytics')
  async assessMaturity(@Param('businessId') businessId: string) {
    return this.maturity.assessBusiness(businessId);
  }

  @Get('maturity/latest')
  @RequireModuleScope('analytics')
  async getLatestMaturity(@Param('businessId') businessId: string) {
    return this.maturity.getLatestAssessment(businessId);
  }

  @Get('maturity/history')
  @RequireModuleScope('analytics')
  async getMaturityHistory(@Param('businessId') businessId: string) {
    return this.maturity.getAssessmentHistory(businessId);
  }
}
