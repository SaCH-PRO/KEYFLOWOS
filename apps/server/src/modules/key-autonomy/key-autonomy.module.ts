import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { GenomeDocumentPackModule } from '../business-genome/document-pack/genome-document-pack.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { KeyActionProposalController } from './key-action-proposal.controller';
import { KeyActionProposalService } from './key-action-proposal.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { KeyGenomeBridgeController } from './key-genome-bridge.controller';
import { GenomeRecommendationActionBridgeService } from './genome-recommendation-action-bridge.service';

@Module({
  imports: [PrismaModule, TemporalFlowModule, BusinessGenomeModule, GenomeDocumentPackModule, KeyGenomeModule],
  controllers: [KeyActionProposalController, KeyGenomeBridgeController],
  providers: [KeyActionProposalService, KeyActionExecutorService, KeyActionPolicyService, KeyActionGenomePolicyService, GenomeRecommendationActionBridgeService],
  exports: [KeyActionProposalService, KeyActionExecutorService, KeyActionPolicyService, KeyActionGenomePolicyService, GenomeRecommendationActionBridgeService],
})
export class KeyAutonomyModule {}
