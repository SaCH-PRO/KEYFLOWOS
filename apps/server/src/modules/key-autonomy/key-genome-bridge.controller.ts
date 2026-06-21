import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeRecommendationActionBridgeService } from './genome-recommendation-action-bridge.service';
import type {
  BridgeGenomeRecommendationResult,
  GenomeRecommendationActionKind,
  GenomeRecommendationActionPreview,
} from '../business-genome/key-genome/key-genome.types';

@Controller('business-genome/businesses/:businessId/key-genome/recommendations/:recommendationId')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyGenomeBridgeController {
  constructor(
    @Inject(GenomeRecommendationActionBridgeService)
    private readonly bridgeService: GenomeRecommendationActionBridgeService,
  ) {}

  @Get('action-preview')
  async previewRecommendationAction(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
  ): Promise<GenomeRecommendationActionPreview> {
    return this.bridgeService.previewRecommendationAction(businessId, recommendationId);
  }

  @Post('bridge-action')
  async bridgeRecommendationAction(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: { actionKind?: GenomeRecommendationActionKind; confirmBridge?: boolean },
  ): Promise<BridgeGenomeRecommendationResult> {
    return this.bridgeService.bridgeRecommendation({
      businessId,
      recommendationId,
      actionKind: body.actionKind,
      confirmBridge: body.confirmBridge,
    });
  }
}
