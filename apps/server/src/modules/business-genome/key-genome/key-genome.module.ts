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
  ],
})
export class KeyGenomeModule {}
