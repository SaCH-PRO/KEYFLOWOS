import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { GenomeFactService } from './genome-fact.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { KeyGenomeBackfillService } from './key-genome-backfill.service';
import { GenomeSignalService } from './genome-signal.service';

@Module({
  imports: [PrismaModule],
  providers: [
    GenomeFactService,
    GenomeEvidenceService,
    GenomeScoringService,
    GenomeModuleReadinessService,
    KeyGenomeBackfillService,
    GenomeSignalService,
  ],
  exports: [
    GenomeFactService,
    GenomeEvidenceService,
    GenomeScoringService,
    GenomeModuleReadinessService,
    KeyGenomeBackfillService,
    GenomeSignalService,
  ],
})
export class KeyGenomeModule {}
