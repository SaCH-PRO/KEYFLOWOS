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
import { KeyGenomeGovernanceService } from './key-genome-governance.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeDepartmentService } from './genome-department.service';
import { DepartmentReadinessService } from './department-readiness.service';
import { GenomeFinancialMetricService } from './genome-financial-metric.service';
import { FinanceGenomeService } from './finance-genome.service';
import type {
  CreateGenomeExperimentInput,
  GenerateGenomeRecommendationsInput,
  GenomeOutcome,
  RecommendationOutcome,
  UpsertGenomeFinancialMetricInput,
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
}
