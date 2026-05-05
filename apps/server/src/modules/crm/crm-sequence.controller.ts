import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CrmSequenceService } from './crm-sequence.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmSequenceController {
  constructor(
    @Inject(CrmSequenceService) private readonly sequences: CrmSequenceService,
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
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/sequences/:id/enrollments/:enrollmentId/unenroll')
  unenrollContact(
    @Param('businessId') businessId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.sequences.unenrollContact(businessId, enrollmentId);
  }
}
