import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmSequenceAnalyticsService, type AnalyticsRange } from './crm-sequence-analytics.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';

function parseRange(from?: string, to?: string): AnalyticsRange {
  const range: AnalyticsRange = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.from = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) range.to = d;
  }
  return range;
}

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmSequenceController {
  constructor(
    @Inject(CrmSequenceService) private readonly sequences: CrmSequenceService,
    @Inject(CrmSequenceAnalyticsService) private readonly analytics: CrmSequenceAnalyticsService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/sequences')
  listSequences(@Param('businessId') businessId: string) {
    return this.sequences.listSequences(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/sequences')
  createSequence(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; description?: string; steps?: unknown; graph?: unknown; status?: string },
  ) {
    return this.sequences.createSequence(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/sequences/:id')
  getSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.getSequence(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/sequences/:id')
  updateSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; steps?: unknown; graph?: unknown; status?: string },
  ) {
    return this.sequences.updateSequence(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/sequences/:id')
  deleteSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.deleteSequence(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/sequences/:id/duplicate')
  duplicateSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.duplicateSequence(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/sequences/:id/enroll')
  enrollContacts(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { contactIds: string[] },
  ) {
    return this.sequences.enrollContacts(businessId, id, body.contactIds);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/sequences/:id/enrollments/:enrollmentId/advance')
  advanceEnrollment(
    @Param('businessId') businessId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.sequences.advanceEnrollment(businessId, enrollmentId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/sequences/:id/variants/report')
  getVariantReport(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.getVariantReport(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/sequences/:id/nodes/:nodeId/promote-variant')
  promoteVariant(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { variantId: string },
  ) {
    return this.sequences.promoteVariant(businessId, id, nodeId, body.variantId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/sequences/:id/enrollments/:enrollmentId/unenroll')
  unenrollContact(
    @Param('businessId') businessId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.sequences.unenrollContact(businessId, enrollmentId);
  }

  // -- Analytics ----------------------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/sequences/analytics/summary')
  sequencesSummary(
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.getSequencesSummary(businessId, parseRange(from, to));
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/sequences/analytics/lifecycle')
  lifecycleReport(
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.getLifecycleReport(businessId, parseRange(from, to));
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/sequences/:id/analytics')
  sequenceAnalytics(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.getSequenceAnalytics(businessId, id, parseRange(from, to));
  }

  // -- Attribution settings ----------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/sequences/settings/attribution')
  async getAttributionSettings(@Param('businessId') businessId: string) {
    const days = await this.analytics.getAttributionWindowDays(businessId);
    return { attributionWindowDays: days };
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('sequences')
  @CrmRateLimit(20, 60_000)
  @Patch('businesses/:businessId/sequences/settings/attribution')
  async updateAttributionSettings(
    @Param('businessId') businessId: string,
    @Body() body: { attributionWindowDays?: number | null },
  ) {
    const days = await this.analytics.setAttributionWindowDays(
      businessId,
      body?.attributionWindowDays ?? null,
    );
    return { attributionWindowDays: days };
  }
}
