import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { ProductAnalyticsService } from './product-analytics.service';

@Controller('analytics/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class ProductAnalyticsController {
  constructor(@Inject(ProductAnalyticsService) private readonly analytics: ProductAnalyticsService) {}

  @Post('events')
  @RequireModuleScope('settings', 'read')
  async ingestEvent(
    @Param('businessId') businessId: string,
    @Body() body: {
      eventName: string;
      userId?: string;
      sessionId?: string;
      module?: string;
      entityType?: string;
      entityId?: string;
      properties?: Record<string, unknown>;
    },
  ) {
    return this.analytics.ingestEvent({ ...body, businessId });
  }

  @Post('events/batch')
  @RequireModuleScope('settings', 'read')
  async ingestEventsBatch(
    @Param('businessId') businessId: string,
    @Body() body: { events: Array<{ eventName: string; userId?: string; sessionId?: string; module?: string; entityType?: string; entityId?: string; properties?: Record<string, unknown> }> },
  ) {
    return this.analytics.ingestEventsBatch(body.events.map((e) => ({ ...e, businessId })));
  }

  @Post('feedback')
  @RequireModuleScope('settings', 'read')
  async createFeedback(
    @Param('businessId') businessId: string,
    @Body() body: {
      userId?: string;
      module?: string;
      page?: string;
      feedbackType: string;
      rating?: number;
      message?: string;
      context?: Record<string, unknown>;
    },
  ) {
    return this.analytics.createFeedback({ ...body, businessId });
  }

  @Get('feedback')
  @RequireModuleScope('settings', 'read')
  async listFeedback(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('feedbackType') feedbackType?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.analytics.listFeedback({
      businessId,
      module,
      feedbackType,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('ai-quality')
  @RequireModuleScope('settings', 'read')
  async createAiQualitySignal(
    @Param('businessId') businessId: string,
    @Body() body: {
      userId?: string;
      commandId?: string;
      module?: string;
      signalType: string;
      rating?: number;
      comment?: string;
      context?: Record<string, unknown>;
    },
  ) {
    return this.analytics.createAiQualitySignal({ ...body, businessId });
  }

  @Get('ai-quality')
  @RequireModuleScope('settings', 'read')
  async listAiQuality(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('signalType') signalType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.analytics.listAiQualitySignals({
      businessId,
      module,
      signalType,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('events')
  @RequireModuleScope('settings', 'read')
  async listEvents(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('eventName') eventName?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.analytics.listEvents({
      businessId,
      module,
      eventName,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('activation-funnel')
  @RequireModuleScope('settings', 'read')
  async getActivationFunnel(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.analytics.getActivationFunnel(businessId, days ? parseInt(days, 10) : 30);
  }
}
