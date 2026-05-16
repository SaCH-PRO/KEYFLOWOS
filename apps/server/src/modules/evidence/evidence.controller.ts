import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { EvidenceService } from './evidence.service';
import { EvidencePredictionService } from './evidence-prediction.service';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { ListEvidenceQueryDto } from './dto/list-evidence-query.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly prediction: EvidencePredictionService,
  ) {}

  @Post('businesses/:businessId/evidence')
  @RateLimit(30, 60_000)
  async submit(
    @Param('businessId') businessId: string,
    @Body() body: SubmitEvidenceDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.evidence.submit({
      businessId,
      evidenceType: body.evidenceType,
      url: body.url,
      storageKey: body.storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      submittedBy: req.user?.id ?? 'system',
      linkedType: body.linkedType,
      linkedId: body.linkedId,
      metadata: body.metadata,
    });
  }

  @Get('businesses/:businessId/evidence')
  @RateLimit(60, 60_000)
  async list(
    @Param('businessId') businessId: string,
    @Query() query: ListEvidenceQueryDto,
  ) {
    return this.evidence.listForBusiness(businessId, {
      evidenceType: query.type,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  }

  @Get('evidence/:evidenceId')
  @RateLimit(60, 60_000)
  async getById(@Param('evidenceId') evidenceId: string) {
    return this.evidence.getById(evidenceId);
  }

  @Get('businesses/:businessId/evidence/for/:linkedType/:linkedId')
  @RateLimit(60, 60_000)
  async getForObject(
    @Param('businessId') businessId: string,
    @Param('linkedType') linkedType: string,
    @Param('linkedId') linkedId: string,
  ) {
    return this.evidence.getForObject(linkedType, linkedId, businessId);
  }

  @Post('evidence/:evidenceId/verify')
  @RateLimit(20, 60_000)
  async verify(
    @Param('evidenceId') evidenceId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.evidence.verify({
      evidenceId,
      verifierId: req.user?.id ?? 'system',
    });
  }

  @Delete('evidence/:evidenceId')
  @RateLimit(20, 60_000)
  async delete(
    @Param('evidenceId') evidenceId: string,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.evidence.delete(evidenceId, req.user?.id ?? 'system');
  }

  @Get('businesses/:businessId/tasks/:taskType/:taskId/evidence-check')
  @RateLimit(60, 60_000)
  async checkTaskEvidence(
    @Param('businessId') businessId: string,
    @Param('taskType') taskType: string,
    @Param('taskId') taskId: string,
  ) {
    return this.evidence.checkTaskEvidence(taskType, taskId);
  }

  @Post('businesses/:businessId/evidence/predict-requirement')
  @RateLimit(30, 60_000)
  async predictRequirement(
    @Param('businessId') businessId: string,
    @Body() body: { taskType: 'ContactTask' | 'ProjectTask'; title: string },
  ) {
    return this.prediction.predict(businessId, body);
  }
}
