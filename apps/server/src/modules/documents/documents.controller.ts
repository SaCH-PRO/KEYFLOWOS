import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Inject, Req } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private documentsService: DocumentsService) {}

  @Get('categories')
  getCategories(@Query('businessId') businessId?: string) {
    return this.documentsService.getCategories(businessId);
  }

  @Get('types')
  getDocumentTypes(@Query('category') categorySlug?: string) {
    return this.documentsService.getDocumentTypes(categorySlug);
  }

  @Get('types/:slug')
  getDocumentType(@Param('slug') slug: string) {
    return this.documentsService.getDocumentType(slug);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/instances')
  getInstances(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('category') categorySlug?: string,
    @Query('health') healthStatus?: string,
  ) {
    return this.documentsService.getInstances(businessId, { status, categorySlug, healthStatus });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/instances/:instanceId')
  getInstance(@Param('businessId') businessId: string, @Param('instanceId') instanceId: string) {
    return this.documentsService.getInstance(businessId, instanceId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/generate')
  generateDocument(
    @Param('businessId') businessId: string,
    @Body() body: {
      documentTypeSlug: string;
      title?: string;
      contextInputs?: Record<string, string>;
      toneSettings?: { style?: string; riskAppetite?: string; length?: string; formality?: string };
    },
    @Req() req: { user?: { id?: string } },
  ) {
    return this.documentsService.generateDocument(businessId, body, req.user?.id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/instances/:instanceId/tweak')
  tweakDocument(
    @Param('businessId') businessId: string,
    @Param('instanceId') instanceId: string,
    @Body() body: { instruction: string; sectionKey?: string },
  ) {
    return this.documentsService.tweakDocument(businessId, instanceId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/instances/:instanceId/sections/:sectionKey')
  updateSection(
    @Param('businessId') businessId: string,
    @Param('instanceId') instanceId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() body: { content: string; changedBy?: string },
  ) {
    return this.documentsService.updateSection(businessId, instanceId, sectionKey, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/instances/:instanceId/status')
  updateStatus(
    @Param('businessId') businessId: string,
    @Param('instanceId') instanceId: string,
    @Body() body: { status: string },
  ) {
    return this.documentsService.updateStatus(businessId, instanceId, body.status);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/instances/:instanceId')
  deleteInstance(@Param('businessId') businessId: string, @Param('instanceId') instanceId: string) {
    return this.documentsService.deleteInstance(businessId, instanceId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/health')
  getDocumentHealth(@Param('businessId') businessId: string) {
    return this.documentsService.getDocumentHealth(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/detect-impact')
  detectImpact(
    @Param('businessId') businessId: string,
    @Body() body: { changedFields: string[] },
  ) {
    return this.documentsService.detectImpact(businessId, body.changedFields);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/instances/:instanceId/compare')
  getVersionComparison(
    @Param('businessId') businessId: string,
    @Param('instanceId') instanceId: string,
    @Query('v1') v1: string,
    @Query('v2') v2: string,
  ) {
    return this.documentsService.getVersionComparison(businessId, instanceId, parseInt(v1), parseInt(v2));
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/reviews/:reviewId')
  resolveReview(
    @Param('businessId') businessId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: { status: string; notes?: string; resolvedBy?: string },
  ) {
    return this.documentsService.resolveReview(businessId, reviewId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/standards')
  getOrgStandards(@Param('businessId') businessId: string) {
    return this.documentsService.getOrgStandards(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/standards')
  upsertOrgStandard(
    @Param('businessId') businessId: string,
    @Body() body: { id?: string; category: string; rule: string },
  ) {
    return this.documentsService.upsertOrgStandard(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/standards/:standardId')
  deleteOrgStandard(@Param('businessId') businessId: string, @Param('standardId') standardId: string) {
    return this.documentsService.deleteOrgStandard(businessId, standardId);
  }
}
