import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Inject, UseGuards } from '@nestjs/common';
import { SeoService } from './seo.service';
import { SeoGoogleSearchConsoleService } from './seo-gsc.service';
import { SeoGoogleAnalyticsService } from './seo-ga4.service';
import { SeoContentService } from './seo-content.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SeoAdminGuard } from './seo-admin.guard';

@Controller('seo')
@UseGuards(AuthGuard, SeoAdminGuard, BusinessGuard)
export class SeoController {
  constructor(
    @Inject(SeoService) private readonly seo: SeoService,
    @Inject(SeoGoogleSearchConsoleService) private readonly gsc: SeoGoogleSearchConsoleService,
    @Inject(SeoGoogleAnalyticsService) private readonly ga4: SeoGoogleAnalyticsService,
    @Inject(SeoContentService) private readonly content: SeoContentService,
  ) {}

  @Get('businesses/:businessId/dashboard')
  getDashboard(@Param('businessId') businessId: string) {
    return this.seo.getDashboard(businessId);
  }

  @Get('businesses/:businessId/pages')
  getPages(
    @Param('businessId') businessId: string,
    @Query('pageType') pageType?: string,
    @Query('indexingStatus') indexingStatus?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    return this.seo.getPages(businessId, { pageType, indexingStatus, sortBy });
  }

  @Get('businesses/:businessId/pages/:pageId')
  getPageDetail(
    @Param('businessId') businessId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.seo.getPageDetail(businessId, pageId);
  }

  @Post('businesses/:businessId/pages/sync')
  syncPages(@Param('businessId') businessId: string) {
    return this.seo.syncPageInventory(businessId);
  }

  @Get('businesses/:businessId/keywords')
  getKeywords(
    @Param('businessId') businessId: string,
    @Query('tracked') tracked?: string,
    @Query('trend') trend?: string,
  ) {
    return this.seo.getKeywords(businessId, {
      tracked: tracked === undefined ? undefined : tracked === 'true',
      trend,
    });
  }

  @Post('businesses/:businessId/keywords')
  addKeyword(
    @Param('businessId') businessId: string,
    @Body() body: { keyword: string; pageId?: string; isPrimary?: boolean },
  ) {
    return this.seo.addKeyword(businessId, body);
  }

  @Delete('businesses/:businessId/keywords/:keywordId')
  removeKeyword(
    @Param('businessId') businessId: string,
    @Param('keywordId') keywordId: string,
  ) {
    return this.seo.removeKeyword(businessId, keywordId);
  }

  @Get('businesses/:businessId/keywords/:keywordId/history')
  getKeywordHistory(
    @Param('businessId') businessId: string,
    @Param('keywordId') keywordId: string,
    @Query('days') days?: string,
  ) {
    return this.seo.getRankingHistory(businessId, keywordId, days ? parseInt(days, 10) : 30);
  }

  @Get('businesses/:businessId/issues')
  getIssues(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
  ) {
    return this.seo.getIssues(businessId, { status, severity, category });
  }

  @Patch('businesses/:businessId/issues/:issueId/resolve')
  resolveIssue(
    @Param('businessId') businessId: string,
    @Param('issueId') issueId: string,
  ) {
    return this.seo.resolveIssue(businessId, issueId);
  }

  @Post('businesses/:businessId/issues/detect')
  detectIssues(@Param('businessId') businessId: string) {
    return this.seo.detectIssues(businessId);
  }

  @Get('businesses/:businessId/briefs')
  getContentBriefs(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
  ) {
    return this.seo.getContentBriefs(businessId, { status });
  }

  @Get('businesses/:businessId/briefs/:briefId')
  getContentBriefDetail(
    @Param('businessId') businessId: string,
    @Param('briefId') briefId: string,
  ) {
    return this.seo.getContentBriefDetail(businessId, briefId);
  }

  @Patch('businesses/:businessId/briefs/:briefId')
  updateBriefStatus(
    @Param('businessId') businessId: string,
    @Param('briefId') briefId: string,
    @Body() body: { status: string; approvedBy?: string },
  ) {
    return this.seo.updateContentBriefStatus(businessId, briefId, body.status, body.approvedBy);
  }

  @Post('businesses/:businessId/briefs/generate')
  generateBrief(
    @Param('businessId') businessId: string,
    @Body() body: { targetKeyword: string; targetPath?: string; contentType?: string; notes?: string },
  ) {
    return this.content.generateBrief(businessId, body);
  }

  @Post('businesses/:businessId/briefs/auto-generate')
  autoGenerateBriefs(
    @Param('businessId') businessId: string,
    @Body() body: { limit?: number },
  ) {
    return this.content.generateBriefsForGaps(businessId, body.limit ?? 3);
  }

  @Get('businesses/:businessId/content-gaps')
  getContentGaps(@Param('businessId') businessId: string) {
    return this.content.detectContentGaps(businessId);
  }

  @Get('businesses/:businessId/revenue-attribution')
  getRevenueAttribution(@Param('businessId') businessId: string) {
    return this.seo.getRevenueAttribution(businessId);
  }

  @Get('businesses/:businessId/connectors/gsc')
  getGscStatus(@Param('businessId') businessId: string) {
    return this.gsc.getConnectionStatus(businessId);
  }

  @Post('businesses/:businessId/connectors/gsc')
  connectGsc(
    @Param('businessId') businessId: string,
    @Body() body: { siteUrl: string; accessToken?: string; refreshToken?: string },
  ) {
    return this.gsc.saveConnection(businessId, body);
  }

  @Delete('businesses/:businessId/connectors/gsc')
  disconnectGsc(@Param('businessId') businessId: string) {
    return this.gsc.disconnectGsc(businessId);
  }

  @Post('businesses/:businessId/connectors/gsc/sync')
  syncGsc(
    @Param('businessId') businessId: string,
    @Body() body: { days?: number },
  ) {
    return this.gsc.syncSearchData(businessId, body.days ?? 28);
  }

  @Get('businesses/:businessId/connectors/ga4')
  getGa4Status(@Param('businessId') businessId: string) {
    return this.ga4.getConnectionStatus(businessId);
  }

  @Post('businesses/:businessId/connectors/ga4')
  connectGa4(
    @Param('businessId') businessId: string,
    @Body() body: { propertyId: string; accessToken?: string; refreshToken?: string },
  ) {
    return this.ga4.saveConnection(businessId, body);
  }

  @Delete('businesses/:businessId/connectors/ga4')
  disconnectGa4(@Param('businessId') businessId: string) {
    return this.ga4.disconnectGa4(businessId);
  }

  @Post('businesses/:businessId/connectors/ga4/sync')
  syncGa4(
    @Param('businessId') businessId: string,
    @Body() body: { days?: number },
  ) {
    return this.ga4.syncAnalyticsData(businessId, body.days ?? 28);
  }
}
