import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeExperimentService } from './genome-experiment.service';
import type {
  CreateGenomeExperimentInput,
  GenerateGenomeRecommendationsInput,
  RecommendationOutcome,
} from './key-genome.types';

@Controller('business-genome/businesses/:businessId/key-genome')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyGenomeController {
  constructor(
    @Inject(GenomeSignalService) private readonly signalService: GenomeSignalService,
    @Inject(GenomeRecommendationService)
    private readonly recommendationService: GenomeRecommendationService,
    @Inject(GenomeExperimentService) private readonly experimentService: GenomeExperimentService,
  ) {}

  @Get('signals')
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('sourceModule') sourceModule?: string,
    @Query('section') section?: string,
    @Query('signalType') signalType?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.signalService.listSignals(businessId, {
      status,
      sourceModule,
      section,
      signalType,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('signals/:signalId')
  async get(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.getSignal(businessId, signalId);
  }

  @Post('signals/:signalId/review')
  async review(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.reviewSignal(businessId, signalId);
  }

  @Post('signals/:signalId/accept')
  async accept(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.acceptSignal(businessId, signalId);
  }

  @Post('signals/:signalId/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.rejectSignal(businessId, signalId);
  }

  @Post('signals/:signalId/merge')
  async merge(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
  ) {
    return this.signalService.mergeSignal(businessId, signalId);
  }

  @Get('recommendations')
  async listRecommendations(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('domain') domain?: string,
    @Query('minExpectedGainScore') minExpectedGainScore?: string,
    @Query('limit') limit?: string,
  ) {
    return this.recommendationService.listRecommendations(businessId, {
      status,
      domain,
      minExpectedGainScore:
        minExpectedGainScore !== undefined ? Number(minExpectedGainScore) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('recommendations/generate')
  async generateRecommendations(
    @Param('businessId') businessId: string,
    @Body() body?: GenerateGenomeRecommendationsInput,
  ) {
    return this.recommendationService.generateRecommendations({
      businessId,
      ...(body ?? {}),
    });
  }

  @Get('recommendations/:recommendationId')
  async getRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendationService.getRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/accept')
  async acceptRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendationService.acceptRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/dismiss')
  async dismissRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendationService.dismissRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/apply')
  async applyRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.recommendationService.applyRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/track-outcome')
  async trackRecommendationOutcome(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: RecommendationOutcome,
  ) {
    return this.recommendationService.trackOutcome(businessId, recommendationId, body);
  }

  @Get('experiments')
  async listExperiments(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.experimentService.listExperiments(businessId, {
      status,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('experiments')
  async createExperiment(
    @Param('businessId') businessId: string,
    @Body() body: CreateGenomeExperimentInput,
  ) {
    return this.experimentService.createExperiment({ ...body, businessId });
  }

  @Get('experiments/:experimentId')
  async getExperiment(
    @Param('businessId') businessId: string,
    @Param('experimentId') experimentId: string,
  ) {
    return this.experimentService.getExperiment(businessId, experimentId);
  }

  @Post('experiments/:experimentId/start')
  async startExperiment(
    @Param('businessId') businessId: string,
    @Param('experimentId') experimentId: string,
  ) {
    return this.experimentService.startExperiment(businessId, experimentId);
  }

  @Post('experiments/:experimentId/complete')
  async completeExperiment(
    @Param('businessId') businessId: string,
    @Param('experimentId') experimentId: string,
    @Body() body?: RecommendationOutcome,
  ) {
    return this.experimentService.completeExperiment(businessId, experimentId, body);
  }

  @Post('experiments/:experimentId/cancel')
  async cancelExperiment(
    @Param('businessId') businessId: string,
    @Param('experimentId') experimentId: string,
  ) {
    return this.experimentService.cancelExperiment(businessId, experimentId);
  }
}
