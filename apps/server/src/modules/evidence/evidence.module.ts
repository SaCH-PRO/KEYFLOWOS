import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { EvidencePredictionService } from './evidence-prediction.service';

@Module({
  providers: [EvidenceService, EvidencePredictionService],
  controllers: [EvidenceController],
  exports: [EvidenceService, EvidencePredictionService],
})
export class EvidenceModule {}
