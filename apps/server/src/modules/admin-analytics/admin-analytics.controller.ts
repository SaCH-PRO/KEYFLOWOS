import {
  Controller,
  Get,
  Query,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminAnalyticsService } from './admin-analytics.service';

@Controller('api/admin/analytics')
@UseGuards(AuthGuard)
export class AdminAnalyticsController {
  constructor(@Inject(AdminAnalyticsService) private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  async getOverview() {
    return this.analytics.getPlatformOverview();
  }

  @Get('activation-funnel')
  async getActivationFunnel(@Query('days') days?: string) {
    return this.analytics.getActivationFunnel(days ? parseInt(days, 10) : 30);
  }

  @Get('integration-health')
  async getIntegrationHealth() {
    return this.analytics.getIntegrationHealth();
  }

  @Get('feature-usage')
  async getFeatureUsage(@Query('days') days?: string) {
    return this.analytics.getFeatureUsage(days ? parseInt(days, 10) : 7);
  }

  @Get('key-quality')
  async getKeyQuality(@Query('days') days?: string) {
    return this.analytics.getKeyQuality(days ? parseInt(days, 10) : 30);
  }

  @Get('feedback-inbox')
  async getFeedbackInbox(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.analytics.getFeedbackInbox(
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get('recent-events')
  async getRecentEvents(@Query('limit') limit?: string) {
    return this.analytics.getRecentEvents(limit ? parseInt(limit, 10) : 50);
  }

  @Get('roadmap-insights')
  async getRoadmapInsights(@Query('status') status?: string) {
    return this.analytics.getProductRoadmapInsights(status);
  }
}
