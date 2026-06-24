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
  ],
})
export class KeyGenomeModule {}
