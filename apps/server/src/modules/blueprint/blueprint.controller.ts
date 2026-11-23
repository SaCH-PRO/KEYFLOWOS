import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GenomeGateGuard } from '../../core/auth/genome-gate.guard';
import { BlueprintService, onboardingAnswersPatch } from './blueprint.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { requireRevenueLevel } from '../key-autonomy/key-action-genome-projection';
import { isFinancialBlueprintPatch, isFinancialDnaWrite, MONEY_BLUEPRINT_COLUMNS, OTHER_BLUEPRINT_COLUMNS } from './genome-write-scope';

import { BlueprintPatch, DnaSectionKey } from './blueprint.types';

/**
 * FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): whether an onboarding answer set writes financial genome content: the
 * patch it builds (onboardingAnswersPatch) is financial, or a dotted answer names a money or unknown column (an unknown
 * column is dropped by the build; it fails closed here all the same).
 */
function isFinancialOnboardingWrite(answers: Record<string, unknown>): boolean {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return true;
  const dottedColumns = Object.keys(answers).filter((k) => k.includes('.')).map((k) => k.split('.')[0]);
  if (dottedColumns.some((c) => MONEY_BLUEPRINT_COLUMNS.has(c) || !OTHER_BLUEPRINT_COLUMNS.has(c))) return true;
  const built = onboardingAnswersPatch(answers);
  return Object.keys(built).length > 0 && isFinancialBlueprintPatch(built);
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
    // FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): a money or unknown column, a money field, or a value stating money
    // (genome-write-scope).
    if (isFinancialBlueprintPatch(body)) await this.requireRevenueWrite(businessId, req);
    return this.blueprint.updateBlueprint(businessId, body);
  }

  @Post('infer/onboarding')
  async inferFromOnboarding(
    @Param('businessId') businessId: string,
    @Body() body: { answers: Record<string, unknown> },
    @Req() req?: BlueprintRequest,
  ) {
    // FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): the same rule on the patch the answers build.
    const answers = body?.answers || {};
    if (isFinancialOnboardingWrite(answers)) await this.requireRevenueWrite(businessId, req);
    return this.blueprint.inferFromOnboarding(businessId, answers);
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
    // FU-GENOME-DNA-WRITES-AND-INTEGRITY (D-128): the financial, sales or an unknown section, a money field, or a value
    // stating money (genome-write-scope), so a direct DNA write cannot bypass the evolution approve gate for finance.
    const data = body?.data || {};
    if (isFinancialDnaWrite(section, data)) await this.requireRevenueWrite(businessId, req);
    return this.blueprint.updateDnaSection(businessId, section, data);
  }
}
