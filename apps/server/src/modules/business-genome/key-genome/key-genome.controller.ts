import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../../core/auth/module-scope.guard';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { LEVEL_RANK, rankOf } from '../../../core/authority/module-vocabulary';
import {
  firstN,
  genomeReaderRevenueLevel,
  isFinanceRecommendation,
  isFinanceSignal,
  isMoneyMemoryEvent,
  listRecommendationsForReader,
  listSignalsForReader,
} from './genome-finance-scope';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeExperimentService } from './genome-experiment.service';
import { KeyGenomeGovernanceService } from './key-genome-governance.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeDepartmentService } from './genome-department.service';
import { DepartmentReadinessService } from './department-readiness.service';
import { GenomeFinancialMetricService } from './genome-financial-metric.service';
import { FinanceGenomeService } from './finance-genome.service';
import { GenomeCustomerSegmentService } from './genome-customer-segment.service';
import { GenomeSalesMotionService } from './genome-sales-motion.service';
import { CustomerSalesGenomeService } from './customer-sales-genome.service';
import { GenomeOperationalProcessService } from './genome-operational-process.service';
import { GenomeDeliveryCapabilityService } from './genome-delivery-capability.service';
import { OperationsGenomeService } from './operations-genome.service';
import { GenomeGrowthChannelService } from './genome-growth-channel.service';
import { GenomeContentStrategyService } from './genome-content-strategy.service';
import { MarketingGenomeService } from './marketing-genome.service';
import { GenomeCrossDomainService } from './genome-cross-domain.service';
import { GenomeRecommendationRankerService } from './genome-recommendation-ranker.service';
import { GenomeOpportunityDetectorService } from './genome-opportunity-detector.service';
import { GenomeAutonomyGateService } from './genome-autonomy-gate.service';
import { GenomeRecommendationOutcomeService } from './genome-recommendation-outcome.service';
import type {
  CheckGenomeAutonomyGateInput,
  CloseGenomeRecommendationObservationInput,
  CreateGenomeContentStrategyInput,
  CreateGenomeExperimentInput,
  CreateGenomeGrowthChannelInput,
  GenerateGenomeRecommendationsInput,
  GenomeOutcome,
  GenomeRecommendationExecutionStatus,
  GenomeRecommendationLearningSummary,
  ListGenomeCrossDomainSnapshotsQuery,
  RecommendationOutcome,
  UpdateGenomeContentStrategyInput,
  UpdateGenomeGrowthChannelInput,
  UpdateGenomeRecommendationOutcomeObservationInput,
  UpsertGenomeCustomerSegmentInput,
  UpsertGenomeDeliveryCapabilityInput,
  UpsertGenomeFinancialMetricInput,
  UpsertGenomeOperationalProcessInput,
  UpsertGenomeSalesMotionInput,
} from './key-genome.types';

/**
 * W11-GENOME-FINANCE-SCOPE review repairs (owner rulings D-128 and D-100;
 * SEC-GFS-1..4, GFS-R1, GFS-R2): the finance rows of the genome's shared tables
 * and the reader's revenue level are read by genome-finance-scope.ts, where
 * W11A-SEAM-REPAIR moved the rule (unchanged) so that the KEY organ tools serve
 * a member the rows these routes serve them (D-128, D-131). Re-exported here for
 * the importers of this file.
 */
export { isFinanceRecommendation, isFinanceSignal, isMoneyMemoryEvent };

/** The request fields these handlers read (attached by AuthMiddleware; AuthGuard has passed). */
type GenomeRequest = { user?: { id?: string; role?: string } };

@Controller('business-genome/businesses/:businessId/key-genome')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyGenomeController {
  constructor(
    @Inject(GenomeSignalService) private readonly signalService: GenomeSignalService,
    @Inject(GenomeRecommendationService)
    private readonly recommendationService: GenomeRecommendationService,
    @Inject(GenomeExperimentService) private readonly experimentService: GenomeExperimentService,
    @Inject(KeyGenomeGovernanceService) private readonly governanceService: KeyGenomeGovernanceService,
    @Inject(GenomeMemoryService) private readonly memoryService: GenomeMemoryService,
    @Inject(GenomeDepartmentService) private readonly departments: GenomeDepartmentService,
    @Inject(DepartmentReadinessService) private readonly departmentReadiness: DepartmentReadinessService,
    @Inject(GenomeFinancialMetricService) private readonly financeMetrics: GenomeFinancialMetricService,
    @Inject(FinanceGenomeService) private readonly financeGenome: FinanceGenomeService,
    @Inject(GenomeCustomerSegmentService) private readonly customerSegments: GenomeCustomerSegmentService,
    @Inject(GenomeSalesMotionService) private readonly salesMotions: GenomeSalesMotionService,
    @Inject(CustomerSalesGenomeService) private readonly customerSalesGenome: CustomerSalesGenomeService,
    @Inject(GenomeOperationalProcessService) private readonly operationalProcesses: GenomeOperationalProcessService,
    @Inject(GenomeDeliveryCapabilityService) private readonly deliveryCapabilities: GenomeDeliveryCapabilityService,
    @Inject(OperationsGenomeService) private readonly operationsGenome: OperationsGenomeService,
    @Inject(GenomeGrowthChannelService) private readonly growthChannels: GenomeGrowthChannelService,
    @Inject(GenomeContentStrategyService) private readonly contentStrategies: GenomeContentStrategyService,
    @Inject(MarketingGenomeService) private readonly marketingGenome: MarketingGenomeService,
    @Inject(GenomeCrossDomainService) private readonly crossDomainGenome: GenomeCrossDomainService,
    @Inject(GenomeRecommendationRankerService) private readonly recommendationRanker: GenomeRecommendationRankerService,
    @Inject(GenomeOpportunityDetectorService) private readonly opportunityDetector: GenomeOpportunityDetectorService,
    @Inject(GenomeAutonomyGateService) private readonly autonomyGate: GenomeAutonomyGateService,
    @Inject(GenomeRecommendationOutcomeService)
    private readonly outcomeService: GenomeRecommendationOutcomeService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // W11-GENOME-FINANCE-SCOPE review repairs (D-128, D-100): the member's
  // revenue level, read by ModuleScopeGuard's rule (SUPER_ADMIN passes; else
  // the membership's explicit scope map, a missing key being 'none', or its
  // role defaults). A request without a user (never past AuthGuard) is 'none':
  // the finance rows fail closed.
  // ---------------------------------------------------------------------------

  private async revenueLevel(businessId: string, req?: GenomeRequest): Promise<string> {
    return genomeReaderRevenueLevel(this.prisma, businessId, req?.user);
  }

  /** 403 with ModuleScopeGuard's message when the member's revenue level is below `minLevel`. */
  private async requireRevenue(businessId: string, req: GenomeRequest | undefined, minLevel: 'read' | 'write'): Promise<void> {
    const level = await this.revenueLevel(businessId, req);
    if (rankOf(level) < LEVEL_RANK[minLevel]) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires ${minLevel} access (you have ${level})`);
    }
  }

  private async readsRevenue(businessId: string, req?: GenomeRequest): Promise<boolean> {
    return rankOf(await this.revenueLevel(businessId, req)) >= LEVEL_RANK.read;
  }

  /**
   * SEC-GFS-1 / GFS-R1 (D-128): the ranker, the opportunity detector and the
   * autonomy gate compute the cross-domain snapshot, and with it the finance
   * snapshot, when the business has none yet (their ensureSnapshot). That
   * recompute is a finance write, so a member without revenue write is refused
   * before the service runs; once a snapshot exists they reuse it and no
   * recompute happens.
   */
  private async requireRecomputeAuthorityIfNoSnapshot(businessId: string, req?: GenomeRequest): Promise<void> {
    const latest = await this.crossDomainGenome.getLatestCrossDomainSnapshot(businessId);
    if (!latest) await this.requireRevenue(businessId, req, 'write');
  }

  /** D-128: acting on a finance signal needs revenue write (getSignal 404s an unknown id, as the action would). */
  private async requireSignalAction(businessId: string, signalId: string, req?: GenomeRequest): Promise<void> {
    const signal = await this.signalService.getSignal(businessId, signalId);
    if (isFinanceSignal(signal)) await this.requireRevenue(businessId, req, 'write');
  }

  /** D-128: acting on a finance recommendation needs revenue write (getRecommendation 404s an unknown id, as the action would). */
  private async requireRecommendationAction(businessId: string, recommendationId: string, req?: GenomeRequest): Promise<void> {
    const recommendation = await this.recommendationService.getRecommendation(businessId, recommendationId);
    if (isFinanceRecommendation(recommendation)) await this.requireRevenue(businessId, req, 'write');
  }

  @Get('signals')
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('sourceModule') sourceModule?: string,
    @Query('section') section?: string,
    @Query('signalType') signalType?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
    @Req() req?: GenomeRequest,
  ) {
    const filters = {
      status,
      sourceModule,
      section,
      signalType,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    };
    // SEC-GFS-4 (D-128 read clause): no finance signal for a member without
    // revenue read; the limit counts the signals that member is served. The
    // KEY organ tool key_genome.list_signals applies the same projection
    // (W11A-SEAM-REPAIR).
    return listSignalsForReader(this.signalService, businessId, filters, await this.readsRevenue(businessId, req));
  }

  @Get('signals/:signalId')
  async get(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
    @Req() req?: GenomeRequest,
  ) {
    const signal = await this.signalService.getSignal(businessId, signalId);
    // SEC-GFS-4 (D-128 read clause): a finance signal needs revenue read.
    if (isFinanceSignal(signal)) await this.requireRevenue(businessId, req, 'read');
    return signal;
  }

  @Post('signals/:signalId/review')
  async review(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireSignalAction(businessId, signalId, req); // D-128
    return this.signalService.reviewSignal(businessId, signalId);
  }

  @Post('signals/:signalId/accept')
  async accept(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireSignalAction(businessId, signalId, req); // D-128
    return this.signalService.acceptSignal(businessId, signalId);
  }

  @Post('signals/:signalId/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireSignalAction(businessId, signalId, req); // D-128
    return this.signalService.rejectSignal(businessId, signalId);
  }

  @Post('signals/:signalId/merge')
  async merge(
    @Param('businessId') businessId: string,
    @Param('signalId') signalId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireSignalAction(businessId, signalId, req); // D-128
    return this.signalService.mergeSignal(businessId, signalId);
  }

  @Get('recommendations')
  async listRecommendations(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('domain') domain?: string,
    @Query('minExpectedGainScore') minExpectedGainScore?: string,
    @Query('limit') limit?: string,
    @Req() req?: GenomeRequest,
  ) {
    const filters = {
      status,
      domain,
      minExpectedGainScore:
        minExpectedGainScore !== undefined ? Number(minExpectedGainScore) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    };
    // SEC-GFS-4 (D-128 read clause): no finance recommendation for a member
    // without revenue read; the limit counts the rows that member is served.
    // The KEY organ tool key_genome.list_recommendations applies the same
    // projection (W11A-SEAM-REPAIR).
    return listRecommendationsForReader(this.recommendationService, businessId, filters, await this.readsRevenue(businessId, req));
  }

  @Post('recommendations/generate')
  async generateRecommendations(
    @Param('businessId') businessId: string,
    @Body() body?: GenerateGenomeRecommendationsInput,
    @Req() req?: GenomeRequest,
  ) {
    // Spread FIRST. businessId must be the guarded @Param, never a value the
    // request body chose for itself.
    //
    // GenerateGenomeRecommendationsInput is an `interface`
    // (key-genome.types.ts:378), not a decorated DTO class. It therefore erases
    // to Object, the global ValidationPipe({whitelist:true}) skips native
    // metatypes and strips nothing, and a body carrying businessId arrived here
    // intact — then won, because it was spread last.
    //
    // The sweep in b53eef9e missed this: its gate matches `...` followed by a
    // BARE identifier, and this spread is parenthesised.
    const created = await this.recommendationService.generateRecommendations({
      ...(body ?? {}),
      businessId,
    });
    // SEC-GFS-4 (D-128 read clause): the generator turns NEW finance signals
    // into FINANCIAL recommendations whose insight is the signal's warning
    // text; a member without revenue read is not served them.
    if (await this.readsRevenue(businessId, req)) return created;
    return created.filter((r) => !isFinanceRecommendation(r));
  }

  @Get('recommendations/:recommendationId')
  async getRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Req() req?: GenomeRequest,
  ) {
    const recommendation = await this.recommendationService.getRecommendation(businessId, recommendationId);
    // SEC-GFS-4 (D-128 read clause): a finance recommendation needs revenue read.
    if (isFinanceRecommendation(recommendation)) await this.requireRevenue(businessId, req, 'read');
    return recommendation;
  }

  @Post('recommendations/:recommendationId/accept')
  async acceptRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecommendationAction(businessId, recommendationId, req); // D-128
    return this.recommendationService.acceptRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/dismiss')
  async dismissRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: { reason?: string },
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecommendationAction(businessId, recommendationId, req); // D-128
    return this.recommendationService.dismissRecommendation(
      businessId,
      recommendationId,
      undefined,
      body.reason,
    );
  }

  @Post('recommendations/:recommendationId/apply')
  async applyRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecommendationAction(businessId, recommendationId, req); // D-128
    return this.recommendationService.applyRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/ignore')
  async ignoreRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: { reason?: string },
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecommendationAction(businessId, recommendationId, req); // D-128
    return this.recommendationService.ignoreRecommendation(
      businessId,
      recommendationId,
      undefined,
      body.reason,
    );
  }

  @Post('recommendations/:recommendationId/escalate')
  async escalateRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecommendationAction(businessId, recommendationId, req); // D-128
    return this.recommendationService.escalateRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/track-outcome')
  async trackRecommendationOutcome(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: RecommendationOutcome,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecommendationAction(businessId, recommendationId, req); // D-128
    return this.recommendationService.trackOutcome(businessId, recommendationId, body);
  }

  // ---------------------------------------------------------------------------
  // GFS-R2 (D-100): every outcome row's health scores are the cross-domain
  // composite's (its domain score, else its overall score, which averages the
  // finance health score), so the outcome reads need revenue read; closing an
  // observation window recomputes the cross-domain snapshot, and with it the
  // finance snapshot, so it needs revenue write (D-128, as SEC-GFS-1). The
  // learning windows carry no figure and are unchanged.
  // ---------------------------------------------------------------------------

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('recommendations/:recommendationId/outcome')
  async getRecommendationOutcome(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
  ) {
    return this.outcomeService.getOutcomeByRecommendation(businessId, recommendationId);
  }

  @Get('recommendations/:recommendationId/execution-status')
  async getRecommendationExecutionStatus(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Req() req?: GenomeRequest,
  ): Promise<GenomeRecommendationExecutionStatus | null> {
    // SEC-GFS-4 (D-128 read clause): a finance recommendation's status needs
    // revenue read. An unknown id keeps the service's answer (null).
    const recommendation = await this.recommendationService
      .getRecommendation(businessId, recommendationId)
      .catch((err: unknown) => {
        if (err instanceof NotFoundException) return null;
        throw err;
      });
    if (recommendation && isFinanceRecommendation(recommendation)) await this.requireRevenue(businessId, req, 'read');
    return this.outcomeService.getExecutionStatus(businessId, recommendationId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('outcomes')
  async listRecommendationOutcomes(
    @Param('businessId') businessId: string,
    @Query('domain') domain?: string,
    @Query('decision') decision?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.outcomeService.listOutcomes(businessId, {
      domain,
      decision: decision as any,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100 (GFS-R2)
  @Get('outcomes/summary')
  async getRecommendationOutcomesSummary(
    @Param('businessId') businessId: string,
  ) {
    return this.outcomeService.getSummary(businessId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100 (GFS-R2)
  @Get('outcomes/learning-summary')
  async getRecommendationLearningSummary(
    @Param('businessId') businessId: string,
  ): Promise<GenomeRecommendationLearningSummary> {
    return this.outcomeService.getLearningSummary(businessId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100 (GFS-R2): answers the outcome row with its composite health scores
  @Patch('outcomes/:outcomeId/observation')
  async updateOutcomeObservation(
    @Param('businessId') businessId: string,
    @Param('outcomeId') outcomeId: string,
    @Body() body: Omit<UpdateGenomeRecommendationOutcomeObservationInput, 'outcomeId' | 'businessId'>,
  ) {
    return this.outcomeService.updateObservation({ ...body, outcomeId, businessId });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write') // D-128: recomputes the cross-domain (and finance) snapshot
  @Post('outcomes/:outcomeId/close-observation')
  async closeObservationWindow(
    @Param('businessId') businessId: string,
    @Param('outcomeId') outcomeId: string,
  ) {
    return this.outcomeService.closeObservationWindow({ outcomeId, businessId });
  }

  @Get('outcome-windows/:domain')
  async getOutcomeLearningWindow(
    @Param('businessId') businessId: string,
    @Param('domain') domain: string,
  ) {
    return this.outcomeService.getLearningWindow(businessId, domain);
  }

  @Put('outcome-windows/:domain')
  async setOutcomeLearningWindow(
    @Param('businessId') businessId: string,
    @Param('domain') domain: string,
    @Body() body: { windowDays: number },
  ) {
    return this.outcomeService.setLearningWindow({
      businessId,
      domain,
      windowDays: body.windowDays,
    });
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

  @Get('memory')
  async listMemoryEvents(
    @Param('businessId') businessId: string,
    @Query('sourceType') sourceType?: string,
    @Query('eventType') eventType?: string,
    @Query('domain') domain?: string,
    @Query('section') section?: string,
    @Query('outcome') outcome?: string,
    @Query('minImpactScore') minImpactScore?: string,
    @Query('limit') limit?: string,
    @Req() req?: GenomeRequest,
  ) {
    const filters = {
      sourceType,
      eventType,
      domain,
      section,
      outcome: outcome as GenomeOutcome | undefined,
      minImpactScore: minImpactScore !== undefined ? Number(minImpactScore) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    };
    if (await this.readsRevenue(businessId, req)) return this.memoryService.listMemoryEvents(businessId, filters);
    // SEC-GFS-4 / GFS-R2 (D-100): no finance or composite memory event (health
    // score, overall risk) for a member without revenue read; the limit counts
    // the events that member is served.
    const rows = await this.memoryService.listMemoryEvents(businessId, { ...filters, limit: undefined });
    return firstN(rows.filter((e) => !isMoneyMemoryEvent(e)), filters.limit);
  }

  /**
   * GFS-R2 (D-100): the summary averages every event's impact score (a finance
   * or composite event's is its health score) and lists the latest events, so
   * it needs revenue read; GET memory serves a member without it the events
   * they may read.
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('memory/summary')
  async memorySummary(@Param('businessId') businessId: string) {
    return this.memoryService.summarizeMemory(businessId);
  }

  @Get('memory/similar')
  async findSimilarMemory(
    @Param('businessId') businessId: string,
    @Query('domain') domain?: string,
    @Query('eventType') eventType?: string,
    @Query('outcome') outcome?: string,
    @Query('limit') limit?: string,
    @Req() req?: GenomeRequest,
  ) {
    const query = {
      domain,
      eventType,
      outcome,
      limit: limit !== undefined ? Number(limit) : undefined,
    };
    if (await this.readsRevenue(businessId, req)) return this.memoryService.findSimilarMemory(businessId, query);
    // SEC-GFS-4 (D-100): as GET memory. findSimilarMemory serves 25 by default;
    // the readable ones are taken from the latest 1000 (summarizeMemory's window).
    const rows = await this.memoryService.findSimilarMemory(businessId, { ...query, limit: 1000 });
    return firstN(rows.filter((e) => !isMoneyMemoryEvent(e)), query.limit ?? 25);
  }

  @Get('memory/:memoryEventId')
  async getMemoryEvent(
    @Param('businessId') businessId: string,
    @Param('memoryEventId') memoryEventId: string,
    @Req() req?: GenomeRequest,
  ) {
    const event = await this.memoryService.getMemoryEvent(businessId, memoryEventId);
    // SEC-GFS-4 (D-100): a finance or composite memory event needs revenue read.
    if (isMoneyMemoryEvent(event)) await this.requireRevenue(businessId, req, 'read');
    return event;
  }

  /**
   * SEC-GFS-4 (D-128 read clause): the governance queues list the business's
   * signals and recommendations with their reason or insight as the summary;
   * for a member without revenue read the items naming a finance signal or
   * recommendation are dropped (the counts carry no figure and stay).
   */
  private async withoutFinanceItems<T extends { type?: string; sourceId?: string | null }>(
    businessId: string,
    lists: Array<T[] | undefined>,
  ): Promise<(items: T[] | undefined) => T[] | undefined> {
    if (!lists.some((items) => Array.isArray(items) && items.length > 0)) return (items) => items;
    const [signals, recommendations] = await Promise.all([
      this.signalService.listSignals(businessId, {}),
      this.recommendationService.listRecommendations(businessId, {}),
    ]);
    const hiddenSignals = new Set(signals.filter((s) => isFinanceSignal(s)).map((s) => s.id));
    const hiddenRecommendations = new Set(recommendations.filter((r) => isFinanceRecommendation(r)).map((r) => r.id));
    return (items) =>
      Array.isArray(items)
        ? items.filter(
            (item) =>
              !(item.type === 'SIGNAL' && item.sourceId && hiddenSignals.has(item.sourceId)) &&
              !(item.type === 'RECOMMENDATION' && item.sourceId && hiddenRecommendations.has(item.sourceId)),
          )
        : items;
  }

  @Get('governance')
  async governance(@Param('businessId') businessId: string, @Req() req?: GenomeRequest) {
    const summary = await this.governanceService.summary(businessId);
    if (await this.readsRevenue(businessId, req)) return summary;
    const keep = await this.withoutFinanceItems(businessId, [
      summary.urgentReviewItems,
      summary.signalReviewQueue,
      summary.recommendationQueue,
    ]);
    return {
      ...summary,
      urgentReviewItems: keep(summary.urgentReviewItems),
      signalReviewQueue: keep(summary.signalReviewQueue),
      recommendationQueue: keep(summary.recommendationQueue),
    };
  }

  @Get('governance/queue')
  async governanceQueue(@Param('businessId') businessId: string, @Req() req?: GenomeRequest) {
    const queue = await this.governanceService.queue(businessId);
    if (await this.readsRevenue(businessId, req)) return queue;
    const keep = await this.withoutFinanceItems(businessId, [queue]);
    return keep(queue);
  }

  @Get('departments')
  async listDepartments(
    @Param('businessId') businessId: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('automationAllowed') automationAllowed?: string,
    @Query('minReadinessScore') minReadinessScore?: string,
    @Query('limit') limit?: string,
  ) {
    return this.departments.listDepartments(businessId, {
      riskLevel: riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined,
      automationAllowed: automationAllowed !== undefined ? automationAllowed === 'true' : undefined,
      minReadinessScore: minReadinessScore !== undefined ? Number(minReadinessScore) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('departments/summary')
  async departmentsSummary(@Param('businessId') businessId: string) {
    return this.departments.summary(businessId);
  }

  @Post('departments/seed')
  async seedDepartments(@Param('businessId') businessId: string) {
    return this.departments.seedDepartments(businessId);
  }

  @Post('departments/compute')
  async computeDepartments(@Param('businessId') businessId: string) {
    return this.departmentReadiness.computeDepartmentReadiness(businessId);
  }

  @Get('departments/:code')
  async getDepartment(
    @Param('businessId') businessId: string,
    @Param('code') code: string,
  ) {
    return this.departments.getDepartment(businessId, code);
  }

  @Post('departments/:code/compute')
  async computeDepartment(
    @Param('businessId') businessId: string,
    @Param('code') code: string,
  ) {
    return this.departmentReadiness.computeOneDepartment(businessId, code);
  }

  // ---------------------------------------------------------------------------
  // Phase 13: Finance Genome
  //
  // W11-GENOME-FINANCE-SCOPE, owner ruling D-128 (option a): the genome's
  // financial metrics, snapshot recompute, signals and recommendations are
  // written by members with revenue write; reading the metrics and snapshots
  // (revenue, profit, cash, receivables, payables, runway) needs revenue read
  // (D-100: a member without revenue read sees no money signals at all).
  // BusinessGuard checks membership only, so each of these seven handlers adds
  // ModuleScopeGuard, as the finance controller's money reads do. The review
  // repairs extend the rulings to the sibling routes that reach the same rows
  // (the finance signals, recommendations and memory events above, the
  // outcome reads, the customer-sales snapshot and the cross-domain routes).
  // ---------------------------------------------------------------------------

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100, D-128
  @Get('finance/metrics')
  async listFinanceMetrics(
    @Param('businessId') businessId: string,
    @Query('metricType') metricType?: string,
    @Query('period') period?: string,
    @Query('currency') currency?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.financeMetrics.listMetrics(businessId, {
      metricType,
      period,
      currency,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write') // D-128 (option a)
  @Post('finance/metrics')
  async upsertFinanceMetric(
    @Param('businessId') businessId: string,
    @Body() body: UpsertGenomeFinancialMetricInput,
  ) {
    return this.financeMetrics.upsertMetric({ ...body, businessId });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100, D-128
  @Get('finance/snapshot')
  async getFinanceSnapshot(@Param('businessId') businessId: string) {
    return this.financeGenome.getLatestFinanceSnapshot(businessId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write') // D-128 (option a)
  @Post('finance/snapshot/compute')
  async computeFinanceSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.financeGenome.computeFinanceSnapshot(businessId, period);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100, D-128
  @Get('finance/snapshots')
  async listFinanceSnapshots(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.financeGenome.listFinanceSnapshots(businessId, {
      period,
      riskLevel,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write') // D-128 (option a)
  @Post('finance/signals/generate')
  async generateFinanceSignals(@Param('businessId') businessId: string) {
    return this.financeGenome.generateFinanceSignals(businessId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write') // D-128 (option a)
  @Post('finance/recommendations/generate')
  async generateFinanceRecommendations(@Param('businessId') businessId: string) {
    return this.financeGenome.generateFinanceRecommendations(businessId);
  }

  // ---------------------------------------------------------------------------
  // Phase 14: Customer / Sales / Revenue Genome
  // ---------------------------------------------------------------------------

  @Get('customer-sales/segments')
  async listCustomerSegments(
    @Param('businessId') businessId: string,
    @Query('segmentType') segmentType?: string,
    @Query('channel') channel?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customerSegments.listSegments(businessId, {
      segmentType,
      channel,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('customer-sales/segments')
  async upsertCustomerSegment(
    @Param('businessId') businessId: string,
    @Body() body: UpsertGenomeCustomerSegmentInput,
  ) {
    return this.customerSegments.upsertSegment({ ...body, businessId });
  }

  @Delete('customer-sales/segments/:segmentId')
  async deleteCustomerSegment(
    @Param('businessId') businessId: string,
    @Param('segmentId') segmentId: string,
  ) {
    return this.customerSegments.deleteSegment(businessId, segmentId);
  }

  @Get('customer-sales/motions')
  async listSalesMotions(
    @Param('businessId') businessId: string,
    @Query('motionType') motionType?: string,
    @Query('stage') stage?: string,
    @Query('channel') channel?: string,
    @Query('isActive') isActive?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.salesMotions.listMotions(businessId, {
      motionType,
      stage,
      channel,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('customer-sales/motions')
  async upsertSalesMotion(
    @Param('businessId') businessId: string,
    @Body() body: UpsertGenomeSalesMotionInput,
  ) {
    return this.salesMotions.upsertMotion({ ...body, businessId });
  }

  @Delete('customer-sales/motions/:motionId')
  async deleteSalesMotion(
    @Param('businessId') businessId: string,
    @Param('motionId') motionId: string,
  ) {
    return this.salesMotions.deleteMotion(businessId, motionId);
  }

  // SEC-GFS-3 (D-100): the customer-sales snapshot reads the finance metrics:
  // averageRevenuePerCustomer is the REVENUE metric over the segments' sizes
  // (a one-customer segment serves it whole), lifetimeValue and
  // customerAcquisitionCost are the LIFETIME_VALUE and CUSTOMER_ACQUISITION_COST
  // metrics, and the revenue quality score and risks are worked out from them.
  // Computing and reading it need revenue read, as finance/metrics does; the
  // segments, motions and the qualitative signals and recommendations are
  // unchanged.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('customer-sales/snapshot')
  async getCustomerSalesSnapshot(@Param('businessId') businessId: string) {
    return this.customerSalesGenome.getLatestCustomerSalesSnapshot(businessId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Post('customer-sales/snapshot/compute')
  async computeCustomerSalesSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.customerSalesGenome.computeCustomerSalesSnapshot(businessId, period);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('customer-sales/snapshots')
  async listCustomerSalesSnapshots(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customerSalesGenome.listCustomerSalesSnapshots(businessId, {
      period,
      riskLevel,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('customer-sales/signals/generate')
  async generateCustomerSalesSignals(@Param('businessId') businessId: string) {
    return this.customerSalesGenome.generateCustomerSalesSignals(businessId);
  }

  @Post('customer-sales/recommendations/generate')
  async generateCustomerSalesRecommendations(@Param('businessId') businessId: string) {
    return this.customerSalesGenome.generateCustomerSalesRecommendations(businessId);
  }

  // ---------------------------------------------------------------------------
  // Phase 15: Operations / Delivery Genome
  // ---------------------------------------------------------------------------

  @Get('operations/processes')
  async listOperationalProcesses(
    @Param('businessId') businessId: string,
    @Query('processType') processType?: string,
    @Query('ownerRole') ownerRole?: string,
    @Query('hasSop') hasSop?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.operationalProcesses.listProcesses(businessId, {
      processType,
      ownerRole,
      hasSop: hasSop !== undefined ? hasSop === 'true' : undefined,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('operations/processes')
  async upsertOperationalProcess(
    @Param('businessId') businessId: string,
    @Body() body: UpsertGenomeOperationalProcessInput,
  ) {
    return this.operationalProcesses.upsertProcess({ ...body, businessId });
  }

  @Delete('operations/processes/:processId')
  async deleteOperationalProcess(
    @Param('businessId') businessId: string,
    @Param('processId') processId: string,
  ) {
    return this.operationalProcesses.deleteProcess(businessId, processId);
  }

  @Get('operations/capabilities')
  async listDeliveryCapabilities(
    @Param('businessId') businessId: string,
    @Query('capabilityType') capabilityType?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.deliveryCapabilities.listCapabilities(businessId, {
      capabilityType,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('operations/capabilities')
  async upsertDeliveryCapability(
    @Param('businessId') businessId: string,
    @Body() body: UpsertGenomeDeliveryCapabilityInput,
  ) {
    return this.deliveryCapabilities.upsertCapability({ ...body, businessId });
  }

  @Delete('operations/capabilities/:capabilityId')
  async deleteDeliveryCapability(
    @Param('businessId') businessId: string,
    @Param('capabilityId') capabilityId: string,
  ) {
    return this.deliveryCapabilities.deleteCapability(businessId, capabilityId);
  }

  @Get('operations/snapshot')
  async getOperationsSnapshot(@Param('businessId') businessId: string) {
    return this.operationsGenome.getLatestOperationsSnapshot(businessId);
  }

  @Post('operations/snapshot/compute')
  async computeOperationsSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.operationsGenome.computeOperationsSnapshot(businessId, period);
  }

  @Get('operations/snapshots')
  async listOperationsSnapshots(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.operationsGenome.listOperationsSnapshots(businessId, {
      period,
      riskLevel,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('operations/signals/generate')
  async generateOperationsSignals(@Param('businessId') businessId: string) {
    return this.operationsGenome.generateOperationsSignals(businessId);
  }

  @Post('operations/recommendations/generate')
  async generateOperationsRecommendations(@Param('businessId') businessId: string) {
    return this.operationsGenome.generateOperationsRecommendations(businessId);
  }

  // ---------------------------------------------------------------------------
  // Phase 16: Marketing / Growth Genome
  // ---------------------------------------------------------------------------

  @Get('marketing-growth/channels')
  async listGrowthChannels(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('channelType') channelType?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
  ) {
    return this.growthChannels.findMany(businessId, {
      status,
      channelType,
      minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('marketing-growth/channels')
  async createGrowthChannel(
    @Param('businessId') businessId: string,
    @Body() body: CreateGenomeGrowthChannelInput,
  ) {
    return this.growthChannels.create(businessId, body);
  }

  @Patch('marketing-growth/channels/:channelId')
  async updateGrowthChannel(
    @Param('businessId') businessId: string,
    @Param('channelId') channelId: string,
    @Body() body: UpdateGenomeGrowthChannelInput,
  ) {
    return this.growthChannels.update(businessId, channelId, body);
  }

  @Delete('marketing-growth/channels/:channelId')
  async deleteGrowthChannel(
    @Param('businessId') businessId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.growthChannels.delete(businessId, channelId);
  }

  @Get('marketing-growth/content-strategy')
  async listContentStrategies(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentStrategies.findMany(businessId, {
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('marketing-growth/content-strategy')
  async createContentStrategy(
    @Param('businessId') businessId: string,
    @Body() body: CreateGenomeContentStrategyInput,
  ) {
    return this.contentStrategies.create(businessId, body);
  }

  @Patch('marketing-growth/content-strategy/:strategyId')
  async updateContentStrategy(
    @Param('businessId') businessId: string,
    @Param('strategyId') strategyId: string,
    @Body() body: UpdateGenomeContentStrategyInput,
  ) {
    return this.contentStrategies.update(businessId, strategyId, body);
  }

  @Delete('marketing-growth/content-strategy/:strategyId')
  async deleteContentStrategy(
    @Param('businessId') businessId: string,
    @Param('strategyId') strategyId: string,
  ) {
    return this.contentStrategies.delete(businessId, strategyId);
  }

  @Get('marketing-growth/snapshot')
  async getMarketingGrowthSnapshot(@Param('businessId') businessId: string) {
    return this.marketingGenome.getLatestMarketingGrowthSnapshot(businessId);
  }

  @Post('marketing-growth/snapshot/compute')
  async computeMarketingGrowthSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.marketingGenome.computeMarketingGrowthSnapshot(businessId, period);
  }

  @Get('marketing-growth/snapshots')
  async listMarketingGrowthSnapshots(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketingGenome.listMarketingGrowthSnapshots(businessId, {
      period,
      riskLevel,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Post('marketing-growth/signals/generate')
  async generateMarketingGrowthSignals(@Param('businessId') businessId: string) {
    return this.marketingGenome.generateMarketingGrowthSignals(businessId);
  }

  @Post('marketing-growth/recommendations/generate')
  async generateMarketingGrowthRecommendations(@Param('businessId') businessId: string) {
    return this.marketingGenome.generateMarketingGrowthRecommendations(businessId);
  }

  // ---------------------------------------------------------------------------
  // Phase 17B: Cross-Domain Genome Intelligence
  //
  // W11-GENOME-FINANCE-SCOPE review repairs (SEC-GFS-1, SEC-GFS-2, GFS-R1):
  // the cross-domain snapshot is computed from the finance snapshot (its
  // finance domain score and risk are the finance health score and overall
  // risk, its overall score averages them, its bottlenecks carry the finance
  // warning text such as the runway), and every route below serves it or what
  // is ranked or gated from it. D-100: reading them needs revenue read. D-128:
  // computing it recomputes the finance snapshot (a genome_finance_snapshots
  // row, a FINANCE_SNAPSHOT_COMPUTED memory event, the CFO readiness), so it
  // needs revenue write, and the five routes that compute it when the business
  // has none yet refuse a member without revenue write then
  // (requireRecomputeAuthorityIfNoSnapshot).
  // ---------------------------------------------------------------------------

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('cross-domain/snapshot')
  async getCrossDomainSnapshot(@Param('businessId') businessId: string) {
    return this.crossDomainGenome.getLatestCrossDomainSnapshot(businessId);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write') // D-128: recomputes the finance snapshot
  @Post('cross-domain/snapshot/compute')
  async computeCrossDomainSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.crossDomainGenome.computeCrossDomainSnapshot(businessId, period);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100
  @Get('cross-domain/snapshots')
  async listCrossDomainSnapshots(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('riskLevel') riskLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.crossDomainGenome.listCrossDomainSnapshots(businessId, {
      period,
      riskLevel,
      limit: limit !== undefined ? Number(limit) : undefined,
    } as ListGenomeCrossDomainSnapshotsQuery);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100: overall health, finance viability
  @Get('cross-domain/recommendations/ranked')
  async getRankedRecommendations(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('maxEffortLevel') maxEffortLevel?: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecomputeAuthorityIfNoSnapshot(businessId, req); // D-128
    return this.recommendationRanker.rankRecommendations(businessId, {
      status,
      limit: limit !== undefined ? Number(limit) : undefined,
      minConfidence:
        minConfidence !== undefined ? Number(minConfidence) : undefined,
      maxEffortLevel: maxEffortLevel as 'LOW' | 'MEDIUM' | 'HIGH' | undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100: overall health, finance viability
  @Post('cross-domain/recommendations/ranked/generate')
  async generateAndRankRecommendations(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('maxEffortLevel') maxEffortLevel?: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecomputeAuthorityIfNoSnapshot(businessId, req); // D-128
    return this.recommendationRanker.generateAndRankRecommendations(businessId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      minConfidence:
        minConfidence !== undefined ? Number(minConfidence) : undefined,
      maxEffortLevel: maxEffortLevel as 'LOW' | 'MEDIUM' | 'HIGH' | undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100: finance health thresholds and evidence
  @Get('cross-domain/opportunities')
  async getOpportunities(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('minPotentialImpact') minPotentialImpact?: string,
    @Query('includeRiskMitigation') includeRiskMitigation?: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecomputeAuthorityIfNoSnapshot(businessId, req); // D-128
    return this.opportunityDetector.detectOpportunities(businessId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      minPotentialImpact: minPotentialImpact as
        | 'LOW'
        | 'MEDIUM'
        | 'HIGH'
        | undefined,
      includeRiskMitigation:
        includeRiskMitigation !== undefined
          ? includeRiskMitigation === 'true'
          : undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100: finance health thresholds and evidence
  @Post('cross-domain/opportunities/detect')
  async detectOpportunities(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('minPotentialImpact') minPotentialImpact?: string,
    @Query('includeRiskMitigation') includeRiskMitigation?: string,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecomputeAuthorityIfNoSnapshot(businessId, req); // D-128
    return this.opportunityDetector.detectOpportunities(businessId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      minPotentialImpact: minPotentialImpact as
        | 'LOW'
        | 'MEDIUM'
        | 'HIGH'
        | undefined,
      includeRiskMitigation:
        includeRiskMitigation !== undefined
          ? includeRiskMitigation === 'true'
          : undefined,
    });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read') // D-100: "Finance risk is CRITICAL" reasons
  @Post('cross-domain/autonomy-gate/check')
  async checkAutonomyGate(
    @Param('businessId') businessId: string,
    @Body() body: CheckGenomeAutonomyGateInput,
    @Req() req?: GenomeRequest,
  ) {
    await this.requireRecomputeAuthorityIfNoSnapshot(businessId, req); // D-128
    return this.autonomyGate.checkGate({ ...body, businessId });
  }
}
