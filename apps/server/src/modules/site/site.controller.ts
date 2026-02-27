import { Controller, Get, Put, Post, Param, Body, Query, Inject, UseGuards } from '@nestjs/common';
import { SiteService } from './site.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('site')
export class SiteController {
  constructor(@Inject(SiteService) private readonly siteService: SiteService) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'site' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/storefront')
  getStorefrontConfig(@Param('businessId') businessId: string) {
    return this.siteService.getStorefrontConfig(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/storefront')
  updateStorefrontConfig(
    @Param('businessId') businessId: string,
    @Body() config: Record<string, any>,
  ) {
    return this.siteService.updateStorefrontConfig(businessId, config);
  }

  @Get('storefront/public/:slug')
  getPublicStorefront(@Param('slug') slug: string) {
    return this.siteService.getPublicStorefront(slug);
  }

  @Post('businesses/:businessId/analytics/event')
  trackEvent(
    @Param('businessId') businessId: string,
    @Body() body: { type: string; itemId?: string; metadata?: any },
  ) {
    return this.siteService.trackEvent(businessId, body.type, body.itemId, body.metadata);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/analytics')
  getAnalytics(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.siteService.getAnalytics(businessId, days ? parseInt(days, 10) : undefined);
  }
}
