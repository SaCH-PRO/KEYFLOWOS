import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { BlueprintService } from './blueprint.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  isFinancialGenomeEvolution,
  patchHoldsFigure,
  requireRevenueLevel,
} from '../key-autonomy/key-action-genome-projection';
import { structuredValueStatesMoney } from '../business-genome/key-genome/genome-finance-scope';

import { BlueprintPatch, DnaSectionKey } from './blueprint.types';

/**
 * FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): the blueprint columns behind the financial and sales DNA sections
 * (DNA_SECTION_CONFIG: financials and projectionProfile, salesSystem) and the offer architecture (the offer ladder: the
 * business model and pricing, D-234).
 */
const MONEY_BLUEPRINT_COLUMNS: ReadonlySet<string> = new Set(['financials', 'projectionProfile', 'salesSystem', 'offerArchitecture']);
/** Every other blueprint column (BlueprintSectionKey); a key not listed in either set fails closed. */
const OTHER_BLUEPRINT_COLUMNS: ReadonlySet<string> = new Set([
  'identity', 'operatingModel', 'goals', 'constraints', 'brand', 'customerModel', 'intelligence', 'workflowModel',
  'aiPreferences', 'founderProfile', 'legalProfile', 'registrationProfile', 'taxProfile', 'ownershipProfile',
  'marketProfile', 'marketingSystem', 'operationsSystem', 'riskProfile', 'complianceProfile', 'executionRoadmap',
  'documentProfile',
]);

/** Whether a blueprint patch writes financial genome content (D-128): a money or unknown column, or money or a figure in it. */
function isFinancialBlueprintPatch(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return true;
  const columns = Object.keys(patch as Record<string, unknown>);
  if (columns.some((c) => MONEY_BLUEPRINT_COLUMNS.has(c) || !OTHER_BLUEPRINT_COLUMNS.has(c))) return true;
  return structuredValueStatesMoney(patch) || patchHoldsFigure(patch);
}

type BlueprintRequest = { user?: { id?: string; role?: string } };

@Controller('blueprint/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class BlueprintController {
  constructor(
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** D-128: writing financial genome content needs revenue write (ModuleScopeGuard's 403 message). */
  private async requireRevenueWrite(businessId: string, req?: BlueprintRequest): Promise<void> {
    const reader = req?.user?.id ? { id: req.user.id, role: req.user.role } : undefined;
    await requireRevenueLevel(this.prisma, businessId, reader, 'write');
  }

  @Get()
  async get(@Param('businessId') businessId: string) {
    return this.blueprint.getBlueprint(businessId);
  }

  @Patch()
  async update(
    @Param('businessId') businessId: string,
    @Body() body: BlueprintPatch,
    @Req() req?: BlueprintRequest,
  ) {
    // FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): the blueprint behind the financial and sales DNA, or money-stating text.
    if (isFinancialBlueprintPatch(body)) await this.requireRevenueWrite(businessId, req);
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
    @Req() req?: BlueprintRequest,
  ) {
    // FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): the evolution approve gate's rule (isFinancialGenomeEvolution: the
    // financial and sales sections, an unknown section, money or a figure in the data), so a direct DNA write cannot
    // bypass it.
    const data = body?.data || {};
    if (isFinancialGenomeEvolution({ section, proposedPatch: data })) await this.requireRevenueWrite(businessId, req);
    return this.blueprint.updateDnaSection(businessId, section, data);
  }
}
