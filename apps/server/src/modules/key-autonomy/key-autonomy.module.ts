import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { GenomeDocumentPackModule } from '../business-genome/document-pack/genome-document-pack.module';
import { KeyActionProposalController } from './key-action-proposal.controller';
import { KeyActionProposalService } from './key-action-proposal.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionPolicyService } from './key-action-policy.service';

@Module({
  imports: [PrismaModule, TemporalFlowModule, BusinessGenomeModule, GenomeDocumentPackModule],
  controllers: [KeyActionProposalController],
  providers: [KeyActionProposalService, KeyActionExecutorService, KeyActionPolicyService],
  exports: [KeyActionProposalService, KeyActionExecutorService, KeyActionPolicyService],
})
export class KeyAutonomyModule {}
