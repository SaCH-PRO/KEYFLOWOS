import { Module } from '@nestjs/common';
import { BusinessGenomeModule } from '../business-genome.module';
import { IntelligenceModule } from '../../intelligence/intelligence.module';
import { GenomeDocumentPackController } from './genome-document-pack.controller';
import { GenomeDocumentPackService } from './genome-document-pack.service';

@Module({
  imports: [BusinessGenomeModule, IntelligenceModule],
  controllers: [GenomeDocumentPackController],
  providers: [GenomeDocumentPackService],
  exports: [GenomeDocumentPackService],
})
export class GenomeDocumentPackModule {}
