import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { PublicRateLimitGuard, PublicRateLimit } from '../../../core/guards/public-rate-limit.guard';

@Controller('site/presence')
export class PresenceController {
  constructor(@Inject(PresenceService) private readonly presence: PresenceService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/draft')
  getDraft(@Param('businessId') businessId: string) {
    return this.presence.getDraft(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/draft')
  saveDraft(
    @Param('businessId') businessId: string,
    @Body() body: { payload: unknown },
    @Req() req: any,
  ) {
    return this.presence.saveDraft(businessId, body?.payload, req?.user?.id);
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/publish')
  publish(@Param('businessId') businessId: string, @Req() req: any) {
    return this.presence.publish(businessId, req?.user?.id);
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
}
