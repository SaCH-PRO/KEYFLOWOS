import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { GenomeFactService } from './genome-fact.service';
import { GenomeEvidenceService } from './genome-evidence.service';
import { KeyGenomeBackfillService } from './key-genome-backfill.service';

@Module({
  imports: [PrismaModule],
  providers: [GenomeFactService, GenomeEvidenceService, KeyGenomeBackfillService],
  exports: [GenomeFactService, GenomeEvidenceService, KeyGenomeBackfillService],
})
export class KeyGenomeModule {}
