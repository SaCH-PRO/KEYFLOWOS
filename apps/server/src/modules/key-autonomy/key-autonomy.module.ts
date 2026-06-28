import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { GenomeDocumentPackModule } from '../business-genome/document-pack/genome-document-pack.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { KeyActionProposalController } from './key-action-proposal.controller';
import { KeyActionProposalService } from './key-action-proposal.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionExecutorRegistryService } from './key-action-executor-registry.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { KeyGenomeBridgeController } from './key-genome-bridge.controller';
import { GenomeRecommendationActionBridgeService } from './genome-recommendation-action-bridge.service';
import { AutonomyOrchestratorService } from './autonomy-orchestrator.service';
import { AutonomyLevelService } from './autonomy-level.service';
import { ConstitutionValuesService } from './constitution-values.service';
import { AuthorityGrantRuleService } from './authority-grant-rule.service';
import { AutonomyRuleDbService } from './autonomy-rule-db.service';
import { SafetyShellService } from './safety-shell.service';
import { ComplianceMapService } from './compliance-map.service';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    BlueprintModule,
    TemporalFlowModule,
    BusinessGenomeModule,
    GenomeDocumentPackModule,
    KeyGenomeModule,
  ],
  controllers: [KeyActionProposalController, KeyGenomeBridgeController],
  providers: [
    KeyActionProposalService,
    KeyActionExecutorService,
    KeyActionExecutorRegistryService,
    KeyActionPolicyService,
    KeyActionGenomePolicyService,
    GenomeRecommendationActionBridgeService,
    AutonomyOrchestratorService,
    AutonomyLevelService,
    ConstitutionValuesService,
    AuthorityGrantRuleService,
    AutonomyRuleDbService,
    SafetyShellService,
    ComplianceMapService,
  ],
  exports: [
    KeyActionProposalService,
    KeyActionExecutorService,
    KeyActionExecutorRegistryService,
    KeyActionPolicyService,
    KeyActionGenomePolicyService,
    GenomeRecommendationActionBridgeService,
    AutonomyOrchestratorService,
    AutonomyLevelService,
    ConstitutionValuesService,
    AuthorityGrantRuleService,
    AutonomyRuleDbService,
    SafetyShellService,
    ComplianceMapService,
  ],
})
export class KeyAutonomyModule {}
