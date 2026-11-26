import { Body, Controller, Get, Inject, Optional, Param, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  blueprintForReader,
  constitutionContentForReader,
  genomeIntegrityForReader,
  readsRevenueFor,
  setupStepsForReader,
} from '../business-genome/key-genome/genome-composites-for-reader';
import { BlueprintReaderInterceptor } from './blueprint-reader.interceptor';
import { BlueprintService } from './blueprint.service';
import { BlueprintPatch, DnaSectionKey } from './blueprint.types';

type BlueprintRequest = { user?: { id?: string; role?: string } };

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class BlueprintController {
  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  private readsRevenue(businessId: string, req?: BlueprintRequest): Promise<boolean> {
    return readsRevenueFor(this.prisma, businessId, req?.user?.id ? { id: req.user.id, role: req.user.role } : null);
  }

  @Get()
  async get(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [bp, readsRevenue] = await Promise.all([
      this.blueprint.getBlueprint(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return blueprintForReader(bp as unknown as Record<string, unknown>, readsRevenue);
  }

  @RequireModuleScope('settings', 'write')
  @UseInterceptors(BlueprintReaderInterceptor)
  @Patch()
  async update(
    @Param('businessId') businessId: string,
    @Body() body: BlueprintPatch,
  ) {
    return this.blueprint.updateBlueprint(businessId, body);
  }

  @RequireModuleScope('settings', 'write')
  @UseInterceptors(BlueprintReaderInterceptor)
  @Post('infer/onboarding')
  async inferFromOnboarding(
    @Param('businessId') businessId: string,
    @Body() body: { answers: Record<string, unknown> },
  ) {
    return this.blueprint.inferFromOnboarding(businessId, body.answers || {});
  }

  @RequireModuleScope('settings', 'write')
  @UseInterceptors(BlueprintReaderInterceptor)
  @Post('infer/events')
  async inferFromEvents(@Param('businessId') businessId: string) {
    return this.blueprint.inferFromEvents(businessId);
  }

  @Get('recommendations')
  async recommendations(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [steps, readsRevenue] = await Promise.all([
      this.blueprint.getRecommendedSetupSteps(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return { steps: setupStepsForReader(steps, readsRevenue) };
  }

  @Get('setup-steps')
  async setupSteps(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [steps, readsRevenue] = await Promise.all([
      this.blueprint.getSetupSteps(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return { steps: setupStepsForReader(steps, readsRevenue) };
  }

  // --- Business Genome endpoints ------------------------------------------------

  @Get('genome')
  async getGenome(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [result, readsRevenue] = await Promise.all([
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return genomeIntegrityForReader(result, readsRevenue);
  }

  @Get('genome/integrity')
  async getIntegrity(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [raw, readsRevenue] = await Promise.all([
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.readsRevenue(businessId, req),
    ]);
    const result = genomeIntegrityForReader(raw, readsRevenue);
    return {
      genomeIntegrity: result.genomeIntegrity,
      genomeDnaScores: result.genomeDnaScores,
      genomeDnaConfidence: result.genomeDnaConfidence,
      genomeStage: result.genomeStage,
      threePillarMinimumMet: result.threePillarMinimumMet,
      executiveReadinessScore: result.executiveReadinessScore,
      readinessBreakdown: result.readinessBreakdown,
      ...('withheldForRevenue' in result && result.withheldForRevenue
        ? { withheldForRevenue: result.withheldForRevenue }
        : {}),
    };
  }

  @Get('genome/three-pillar-status')
  async getThreePillarStatus(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [result, readsRevenue] = await Promise.all([
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return {
      met: result.threePillarMinimumMet,
      founder: result.genomeDnaScores.founder,
      business: readsRevenue ? result.genomeDnaScores.business : null,
      market: result.genomeDnaScores.market,
      ...(!readsRevenue ? { withheldForRevenue: ['business'] } : {}),
    };
  }

  @Get('genome/recommendations')
  async getGenomeRecommendations(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const readsRevenue = await this.readsRevenue(businessId, req);
    const recommendations = await this.blueprint.getRecommendations(businessId, { readsRevenue });
    return { recommendations };
  }

  @Get('genome/constitution')
  async getConstitution(@Param('businessId') businessId: string, @Req() req?: BlueprintRequest) {
    const [constitution, readsRevenue] = await Promise.all([
      this.blueprint.generateConstitution(businessId),
      this.readsRevenue(businessId, req),
    ]);
    return constitutionContentForReader(constitution, readsRevenue);
  }

  @RequireModuleScope('settings', 'write')
  @UseInterceptors(BlueprintReaderInterceptor)
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
