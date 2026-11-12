import { Controller, ForbiddenException, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { TenantInterceptor } from '../../core/tenant/tenant.interceptor';
import { getTenantContext } from '../../core/tenant/tenant-context';
import { TimelineService } from './timeline.service';
import { QueryTimelineDto, parseTimelineLimit } from './dto/query-timeline.dto';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';

/**
 * The caller of a read of `businessId`: the user of the tenant scope
 * TenantInterceptor opens once BusinessGuard has verified the caller for that
 * business. Read from the scope rather than from a handler parameter because
 * queryEvents' parameter list is pinned (V1-25, EF-10a). No scope for this
 * business means no verified caller: refused, never served unfiltered.
 */
function callerOf(businessId: string): string {
  const ctx = getTenantContext();
  if (!ctx?.userId || ctx.businessId !== businessId) {
    throw new ForbiddenException('Unable to verify the caller for this business');
  }
  return ctx.userId;
}

/**
 * V1-84 (FOLLOW3-D1-TIMELINE-SCOPE): every read serves only the rows the
 * caller may read (timeline-visibility.ts: module scopes over the D-63 table,
 * contact visibility), and /upcoming is bounded like /events.
 *
 * TenantInterceptor is declared here as well as globally (app.module.ts) so
 * the caller's scope exists wherever this controller is mounted; nested, it
 * opens the same scope again.
 */
@Controller('timeline')
@UseGuards(AuthGuard, CrmRateLimitGuard)
@UseInterceptors(TenantInterceptor)
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get('businesses/:businessId/events')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(120, 60_000)
  async queryEvents(@Param('businessId') businessId: string, @Query() query: QueryTimelineDto) {
    const viewer = await this.timeline.resolveViewer(businessId, callerOf(businessId));
    return this.timeline.queryTimeline(
      businessId,
      {
        ...query,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      viewer,
    );
  }

  @Get('businesses/:businessId/summary/:date')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async getDaySummary(@Param('businessId') businessId: string, @Param('date') date: string) {
    const viewer = await this.timeline.resolveViewer(businessId, callerOf(businessId));
    return this.timeline.getBusinessDaySummary(businessId, new Date(date), viewer);
  }

  @Get('businesses/:businessId/upcoming')
  @UseGuards(BusinessGuard)
  @CrmRateLimit(60, 60_000)
  async getUpcoming(@Param('businessId') businessId: string, @Query('limit') limit?: string) {
    const take = parseTimelineLimit(limit, 50);
    const viewer = await this.timeline.resolveViewer(businessId, callerOf(businessId));
    return this.timeline.getUpcomingActions(businessId, { limit: take }, viewer);
  }
}
