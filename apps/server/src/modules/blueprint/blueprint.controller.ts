import { Body, Controller, Get, Inject, Optional, Param, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  blueprintForReader,
  constitutionContentForReader,
  genomeIntegrityForReader,
  readsRevenueFor,
} from '../business-genome/key-genome/genome-composites-for-reader';
import { BlueprintReaderInterceptor } from './blueprint-reader.interceptor';
import { BlueprintService } from './blueprint.service';

import { BlueprintPatch, DnaSectionKey } from './blueprint.types';

type ReaderRequest = { user?: { id?: string; role?: string } };

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
// FU-GENOME-SURFACES-REVENUE round 1: the write routes' blueprint answers, as GET serves them (D-233).
@UseInterceptors(BlueprintReaderInterceptor)
export class BlueprintController {
  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    // FU-GENOME-SURFACES-REVENUE (D-233): reads the request member's revenue level. Optional so every existing
    // construction keeps working; without it the money composites are withheld (fail closed).
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  /**
   * FU-GENOME-SURFACES-REVENUE (D-233, D-234, D-128, D-100): whether the request's member reads revenue in the business
   * (ModuleScopeGuard's reading). No member reads none.
   */
  private readsRevenue(businessId: string, req?: ReaderRequest): Promise<boolean> {
    const user = req?.user;
    return readsRevenueFor(this.prisma, businessId, user?.id ? { id: user.id, role: user.role } : null);
  }

  @Get()
  async get(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    // D-233: the genome composites, the financial and sales DNA and the columns they are counted from need revenue read.
    const blueprint = await this.blueprint.getBlueprint(businessId);
    return blueprintForReader(blueprint as unknown as Record<string, unknown>, await this.readsRevenue(businessId, req));
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
  async getGenome(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    // D-233: the composites withheld, the financial and sales DNA left out, for a member without revenue read.
    const result = await this.blueprint.calculateGenomeIntegrity(businessId);
    return genomeIntegrityForReader(result, await this.readsRevenue(businessId, req));
  }

  @Get('genome/integrity')
  async getIntegrity(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    const result = await this.blueprint.calculateGenomeIntegrity(businessId);
    return genomeIntegrityForReader({
      genomeIntegrity: result.genomeIntegrity,
      genomeDnaScores: result.genomeDnaScores,
      genomeDnaConfidence: result.genomeDnaConfidence,
      genomeStage: result.genomeStage,
      threePillarMinimumMet: result.threePillarMinimumMet,
      executiveReadinessScore: result.executiveReadinessScore,
      readinessBreakdown: result.readinessBreakdown,
    }, await this.readsRevenue(businessId, req));
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
  async getGenomeRecommendations(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    // D-233: the weakest section is chosen among the sections the member is served (a ranking names a money section).
    const recommendations = await this.blueprint.getRecommendations(businessId, { readsRevenue: await this.readsRevenue(businessId, req) });
    return { recommendations };
  }

  @Get('genome/constitution')
  async getConstitution(@Param('businessId') businessId: string, @Req() req?: ReaderRequest) {
    const constitution = await this.blueprint.generateConstitution(businessId);
    return constitutionContentForReader(constitution, await this.readsRevenue(businessId, req));
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
