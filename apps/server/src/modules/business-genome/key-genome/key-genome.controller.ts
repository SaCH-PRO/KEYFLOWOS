import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
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
    return this.recommendationService.generateRecommendations({
      ...(body ?? {}),
      businessId,
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
    @Body() body: { reason?: string },
  ) {
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
  ) {
    return this.recommendationService.applyRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/ignore')
  async ignoreRecommendation(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: { reason?: string },
  ) {
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
  ) {
    return this.recommendationService.escalateRecommendation(businessId, recommendationId);
  }

  @Post('recommendations/:recommendationId/track-outcome')
  async trackRecommendationOutcome(
    @Param('businessId') businessId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() body: RecommendationOutcome,
  ) {
    return this.recommendationService.trackOutcome(businessId, recommendationId, body);
  }

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
  ): Promise<GenomeRecommendationExecutionStatus | null> {
    return this.outcomeService.getExecutionStatus(businessId, recommendationId);
  }

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

  @Get('outcomes/summary')
  async getRecommendationOutcomesSummary(
    @Param('businessId') businessId: string,
  ) {
    return this.outcomeService.getSummary(businessId);
  }

  @Get('outcomes/learning-summary')
  async getRecommendationLearningSummary(
    @Param('businessId') businessId: string,
  ): Promise<GenomeRecommendationLearningSummary> {
    return this.outcomeService.getLearningSummary(businessId);
  }

  @Patch('outcomes/:outcomeId/observation')
  async updateOutcomeObservation(
    @Param('businessId') businessId: string,
    @Param('outcomeId') outcomeId: string,
    @Body() body: Omit<UpdateGenomeRecommendationOutcomeObservationInput, 'outcomeId' | 'businessId'>,
  ) {
    return this.outcomeService.updateObservation({ ...body, outcomeId, businessId });
  }

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
  ) {
    return this.memoryService.listMemoryEvents(businessId, {
      sourceType,
      eventType,
      domain,
      section,
      outcome: outcome as GenomeOutcome | undefined,
      minImpactScore: minImpactScore !== undefined ? Number(minImpactScore) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

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
  ) {
    return this.memoryService.findSimilarMemory(businessId, {
      domain,
      eventType,
      outcome,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('memory/:memoryEventId')
  async getMemoryEvent(
    @Param('businessId') businessId: string,
    @Param('memoryEventId') memoryEventId: string,
  ) {
    return this.memoryService.getMemoryEvent(businessId, memoryEventId);
  }

  @Get('governance')
  async governance(@Param('businessId') businessId: string) {
    return this.governanceService.summary(businessId);
  }

  @Get('governance/queue')
  async governanceQueue(@Param('businessId') businessId: string) {
    return this.governanceService.queue(businessId);
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
  // ---------------------------------------------------------------------------

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

  @Post('finance/metrics')
  async upsertFinanceMetric(
    @Param('businessId') businessId: string,
    @Body() body: UpsertGenomeFinancialMetricInput,
  ) {
    return this.financeMetrics.upsertMetric({ ...body, businessId });
  }

  @Get('finance/snapshot')
  async getFinanceSnapshot(@Param('businessId') businessId: string) {
    return this.financeGenome.getLatestFinanceSnapshot(businessId);
  }

  @Post('finance/snapshot/compute')
  async computeFinanceSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.financeGenome.computeFinanceSnapshot(businessId, period);
  }

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

  @Post('finance/signals/generate')
  async generateFinanceSignals(@Param('businessId') businessId: string) {
    return this.financeGenome.generateFinanceSignals(businessId);
  }

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

  @Get('customer-sales/snapshot')
  async getCustomerSalesSnapshot(@Param('businessId') businessId: string) {
    return this.customerSalesGenome.getLatestCustomerSalesSnapshot(businessId);
  }

  @Post('customer-sales/snapshot/compute')
  async computeCustomerSalesSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.customerSalesGenome.computeCustomerSalesSnapshot(businessId, period);
  }

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
  // ---------------------------------------------------------------------------

  @Get('cross-domain/snapshot')
  async getCrossDomainSnapshot(@Param('businessId') businessId: string) {
    return this.crossDomainGenome.getLatestCrossDomainSnapshot(businessId);
  }

  @Post('cross-domain/snapshot/compute')
  async computeCrossDomainSnapshot(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.crossDomainGenome.computeCrossDomainSnapshot(businessId, period);
  }

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

  @Get('cross-domain/recommendations/ranked')
  async getRankedRecommendations(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('maxEffortLevel') maxEffortLevel?: string,
  ) {
    return this.recommendationRanker.rankRecommendations(businessId, {
      status,
      limit: limit !== undefined ? Number(limit) : undefined,
      minConfidence:
        minConfidence !== undefined ? Number(minConfidence) : undefined,
      maxEffortLevel: maxEffortLevel as 'LOW' | 'MEDIUM' | 'HIGH' | undefined,
    });
  }

  @Post('cross-domain/recommendations/ranked/generate')
  async generateAndRankRecommendations(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('maxEffortLevel') maxEffortLevel?: string,
  ) {
    return this.recommendationRanker.generateAndRankRecommendations(businessId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      minConfidence:
        minConfidence !== undefined ? Number(minConfidence) : undefined,
      maxEffortLevel: maxEffortLevel as 'LOW' | 'MEDIUM' | 'HIGH' | undefined,
    });
  }

  @Get('cross-domain/opportunities')
  async getOpportunities(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('minPotentialImpact') minPotentialImpact?: string,
    @Query('includeRiskMitigation') includeRiskMitigation?: string,
  ) {
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

  @Post('cross-domain/opportunities/detect')
  async detectOpportunities(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('minPotentialImpact') minPotentialImpact?: string,
    @Query('includeRiskMitigation') includeRiskMitigation?: string,
  ) {
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

  @Post('cross-domain/autonomy-gate/check')
  async checkAutonomyGate(
    @Param('businessId') businessId: string,
    @Body() body: CheckGenomeAutonomyGateInput,
  ) {
    return this.autonomyGate.checkGate({ ...body, businessId });
  }
}
