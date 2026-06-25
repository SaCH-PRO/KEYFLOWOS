import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { GenomeFactService } from './genome-fact.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { KeyGenomeBackfillService } from './key-genome-backfill.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeExperimentService } from './genome-experiment.service';
import { KeyGenomeGovernanceService } from './key-genome-governance.service';
import { GenomeMemoryService } from './genome-memory.service';
import { OutcomeLearningService } from './outcome-learning.service';
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
import { GenomeOutcomeLearningService } from './genome-outcome-learning.service';

@Module({
  imports: [PrismaModule],
  providers: [
    GenomeFactService,
    GenomeEvidenceService,
    GenomeScoringService,
    GenomeModuleReadinessService,
    KeyGenomeBackfillService,
    GenomeSignalService,
    GenomeRecommendationService,
    GenomeExperimentService,
    KeyGenomeGovernanceService,
    GenomeMemoryService,
    OutcomeLearningService,
    GenomeDepartmentService,
    DepartmentReadinessService,
    GenomeFinancialMetricService,
    FinanceGenomeService,
    GenomeCustomerSegmentService,
    GenomeSalesMotionService,
    CustomerSalesGenomeService,
    GenomeOperationalProcessService,
    GenomeDeliveryCapabilityService,
    OperationsGenomeService,
    GenomeGrowthChannelService,
    GenomeContentStrategyService,
    MarketingGenomeService,
    GenomeCrossDomainService,
    GenomeRecommendationRankerService,
    GenomeOpportunityDetectorService,
    GenomeAutonomyGateService,
    GenomeRecommendationOutcomeService,
    GenomeOutcomeLearningService,
  ],
  exports: [
    GenomeFactService,
    GenomeEvidenceService,
    GenomeScoringService,
    GenomeModuleReadinessService,
    KeyGenomeBackfillService,
    GenomeSignalService,
    GenomeRecommendationService,
    GenomeExperimentService,
    KeyGenomeGovernanceService,
    GenomeMemoryService,
    OutcomeLearningService,
    GenomeDepartmentService,
    DepartmentReadinessService,
    GenomeFinancialMetricService,
    FinanceGenomeService,
    GenomeCustomerSegmentService,
    GenomeSalesMotionService,
    CustomerSalesGenomeService,
    GenomeOperationalProcessService,
    GenomeDeliveryCapabilityService,
    OperationsGenomeService,
    GenomeGrowthChannelService,
    GenomeContentStrategyService,
    MarketingGenomeService,
    GenomeCrossDomainService,
    GenomeRecommendationRankerService,
    GenomeOpportunityDetectorService,
    GenomeAutonomyGateService,
    GenomeRecommendationOutcomeService,
    GenomeOutcomeLearningService,
  ],
})
export class KeyGenomeModule {}
