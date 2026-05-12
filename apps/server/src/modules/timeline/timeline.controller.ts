import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { TimelineService } from './timeline.service';
import { QueryTimelineDto } from './dto/query-timeline.dto';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';

@Controller('timeline')
@UseGuards(AuthGuard, CrmRateLimitGuard)
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get('businesses/:businessId/events')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(120, 60_000)
  async queryEvents(@Param('businessId') businessId: string, @Query() query: QueryTimelineDto) {
    return this.timeline.queryTimeline(businessId, {
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @Get('businesses/:businessId/summary/:date')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async getDaySummary(@Param('businessId') businessId: string, @Param('date') date: string) {
    return this.timeline.getBusinessDaySummary(businessId, new Date(date));
  }

  @Get('businesses/:businessId/upcoming')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async getUpcoming(@Param('businessId') businessId: string, @Query('limit') limit?: string) {
    return this.timeline.getUpcomingActions(businessId, { limit: limit ? parseInt(limit, 10) : 50 });
  }
}
