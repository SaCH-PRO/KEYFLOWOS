import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { PresenceService, type PresenceActor } from './presence.service';
import { PresenceOverviewService } from './presence-overview.service';
import { StorefrontIntelligenceService } from './storefront-intelligence.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { PublicRateLimitGuard, PublicRateLimit } from '../../../core/guards/public-rate-limit.guard';

/** The authenticated caller AuthMiddleware attached (id and platform role), or undefined. */
function presenceActor(req: { user?: { id?: unknown; role?: unknown } } | undefined): PresenceActor | undefined {
  const user = req?.user;
  if (typeof user?.id !== 'string' || !user.id) return undefined;
  return { id: user.id, role: typeof user.role === 'string' ? user.role : undefined };
}

@Controller('site/presence')
export class PresenceController {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(PresenceOverviewService) private readonly overview: PresenceOverviewService,
    @Inject(StorefrontIntelligenceService) private readonly intelligence: StorefrontIntelligenceService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/draft')
  getDraft(@Param('businessId') businessId: string) {
    return this.presence.getDraft(businessId);
  }

  /**
   * Any member saves the draft; a new public slug is OWNER only (R0-09b, owner
   * ruling D-11), decided in PresenceService from the authenticated caller.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/draft')
  saveDraft(
    @Param('businessId') businessId: string,
    @Body() body: { payload: unknown },
    @Req() req: any,
  ) {
    return this.presence.saveDraft(businessId, body?.payload, presenceActor(req));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/diff')
  getDiff(@Param('businessId') businessId: string) {
    return this.presence.previewDiff(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/preview')
  createPreview(@Param('businessId') businessId: string) {
    return this.presence.createPreviewToken(businessId);
  }

  /**
   * Any member publishes; only the owner's publish moves Business.slug, and a
   * non-owner's goes live at the current address (R0-09b, owner ruling D-11).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/publish')
  publish(@Param('businessId') businessId: string, @Req() req: any) {
    return this.presence.publish(businessId, presenceActor(req));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/publish')
  unpublish(@Param('businessId') businessId: string) {
    return this.presence.unpublish(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/completeness')
  completeness(@Param('businessId') businessId: string) {
    return this.presence.getSectionCompleteness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/overview')
  getOverview(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    const d = days ? Math.min(Math.max(parseInt(days, 10) || 30, 1), 365) : 30;
    return this.overview.getOverview(businessId, d);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/action-cards/sync')
  syncActionCards(@Param('businessId') businessId: string) {
    return this.overview.syncActionCardsToQueue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/leads')
  listLeads(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.overview.listStorefrontLeads(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/orders')
  listOrders(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.overview.listStorefrontOrders(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/bookings')
  listBookings(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.overview.listStorefrontBookings(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/insights')
  getInsights(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    const d = days ? Math.min(Math.max(parseInt(days, 10) || 30, 1), 365) : 30;
    return this.intelligence.getOrGenerate(businessId, d);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/today-stats')
  getTodayStats(@Param('businessId') businessId: string) {
    return this.overview.getTodayStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/insights/regenerate')
  regenerateInsights(
    @Param('businessId') businessId: string,
    @Body() body?: { days?: number },
  ) {
    const d = body?.days ? Math.min(Math.max(body.days, 1), 365) : 30;
    return this.intelligence.regenerate(businessId, d);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/insights/:insightId/delegate')
  delegateInsight(
    @Param('businessId') businessId: string,
    @Param('insightId') insightId: string,
  ) {
    return this.intelligence.delegateInsight(businessId, insightId);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(60, 60_000)
  @Get('preview/:token')
  getPreview(@Param('token') token: string) {
    return this.presence.getByPreviewToken(token);
  }

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(120, 60_000)
  @Get('public/:slug')
  getPublic(@Param('slug') slug: string) {
    return this.presence.getPublishedBySlug(slug);
  }

    @UseGuards(PublicRateLimitGuard)
    @PublicRateLimit(120, 60_000)
    @Get('directory')
    getDirectory(
      @Query('industry') industry?: string,
      @Query('city') city?: string,
      @Query('q') q?: string,
      @Query('page') page?: string,
      @Query('pageSize') pageSize?: string,
    ) {
      return this.presence.listDirectory({
        industry: industry?.trim() || undefined,
        city: city?.trim() || undefined,
        q: q?.trim() || undefined,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      });
    }
  }
