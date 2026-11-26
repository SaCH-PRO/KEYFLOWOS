import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GenomeRecommendationActionBridgeService } from './genome-recommendation-action-bridge.service';
import { requireBridgeRevenue } from './key-action-genome-projection';
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
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** The request's reader ({ id, role } as AuthMiddleware attaches it); none reads no revenue. */
  private reader(req?: { user?: { id?: string; role?: string } }) {
    return req?.user?.id ? { id: req.user.id, role: req.user.role } : undefined;
  }

  @Get('action-preview')
  async previewRecommendationAction(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ): Promise<GenomeRecommendationActionPreview> {
    // FU-KEY-ACTION-GENOME-PROJECTION (D-128, D-233): the preview carries a FINANCIAL recommendation's text.
    await requireBridgeRevenue(this.prisma, businessId, recommendationId, this.reader(req), 'read');
    return this.bridgeService.previewRecommendationAction(businessId, recommendationId);
  }

  @Post('bridge-action')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('ai', 'write')
  async bridgeRecommendationAction(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: { actionKind?: GenomeRecommendationActionKind; confirmBridge?: boolean },
    @Req() req?: { user?: { id?: string; role?: string } },
  ): Promise<BridgeGenomeRecommendationResult> {
    // D-128's acting clause: acting on a FINANCIAL recommendation needs revenue write.
    await requireBridgeRevenue(this.prisma, businessId, recommendationId, this.reader(req), 'write');
    return this.bridgeService.bridgeRecommendation({
      businessId,
      recommendationId,
      actionKind: body.actionKind,
      confirmBridge: body.confirmBridge,
    });
  }
}
