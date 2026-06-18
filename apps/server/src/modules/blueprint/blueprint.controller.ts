import { Body, Controller, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { BlueprintService } from './blueprint.service';

import { BlueprintPatch, DnaSectionKey } from './blueprint.types';

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintController {
  constructor(@Inject(BlueprintService) private readonly blueprint: BlueprintService) {}

  @Get()
  async get(@Param('businessId') businessId: string) {
    return this.blueprint.getBlueprint(businessId);
  }

  @Patch()
  async update(
    @Param('businessId') businessId: string,
    @Body() body: BlueprintPatch,
  ) {
    return this.blueprint.updateBlueprint(businessId, body);
  }

  @Post('infer/onboarding')
  async inferFromOnboarding(
    @Param('businessId') businessId: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.blueprint.inferFromOnboarding(businessId, body.answers || {});
  }

  @Post('infer/events')
  async inferFromEvents(@Param('businessId') businessId: string) {
    return this.blueprint.inferFromEvents(businessId);
  }

  @Get('recommendations')
  async recommendations(@Param('businessId') businessId: string) {
    const steps = await this.blueprint.getRecommendedSetupSteps(businessId);
    return { steps };
  }

  @Get('setup-steps')
  async setupSteps(@Param('businessId') businessId: string) {
    const steps = await this.blueprint.getSetupSteps(businessId);
    return { steps };
  }

  // --- Business Genome endpoints ------------------------------------------------

  @Get('genome')
  async getGenome(@Param('businessId') businessId: string) {
    return this.blueprint.calculateGenomeIntegrity(businessId);
  }

  @Get('genome/integrity')
  async getIntegrity(@Param('businessId') businessId: string) {
    const result = await this.blueprint.calculateGenomeIntegrity(businessId);
    return {
      genomeIntegrity: result.genomeIntegrity,
      genomeDnaScores: result.genomeDnaScores,
      genomeDnaConfidence: result.genomeDnaConfidence,
      genomeStage: result.genomeStage,
      threePillarMinimumMet: result.threePillarMinimumMet,
      executiveReadinessScore: result.executiveReadinessScore,
      readinessBreakdown: result.readinessBreakdown,
    };
  }

  @Get('genome/three-pillar-status')
  async getThreePillarStatus(@Param('businessId') businessId: string) {
    const result = await this.blueprint.calculateGenomeIntegrity(businessId);
    return {
      met: result.threePillarMinimumMet,
      founder: result.genomeDnaScores.founder,
      business: result.genomeDnaScores.business,
      market: result.genomeDnaScores.market,
    };
  }

  @Get('genome/recommendations')
  async getGenomeRecommendations(@Param('businessId') businessId: string) {
    const recommendations = await this.blueprint.getRecommendations(businessId);
    return { recommendations };
  }

  @Get('genome/constitution')
  async getConstitution(@Param('businessId') businessId: string) {
    return this.blueprint.generateConstitution(businessId);
  }

  @Patch('genome/dna/:section')
  @UseGuards(GenomeGateGuard)
  async updateDnaSection(
    @Param('businessId') businessId: string,
    @Param('section') section: DnaSectionKey,
    @Body() body: { data?: Record<string, unknown> },
  ) {
    return this.blueprint.updateDnaSection(businessId, section, body.data || {});
  }
}
