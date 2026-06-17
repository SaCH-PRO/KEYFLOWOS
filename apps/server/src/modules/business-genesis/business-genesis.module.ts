import { Module } from '@nestjs/common';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { AiModule } from '../ai/ai.module';
import { DocumentsModule } from '../documents/documents.module';
import { GovernanceModule } from '../governance/governance.module';
import { BusinessGenesisController } from './business-genesis.controller';
import { GenomeChatController } from './genome-chat.controller';
import { BusinessGenesisService } from './business-genesis.service';
import { GenesisProjectionService } from './projection-engine.service';
import { GenesisReadinessScorer } from './readiness-scorer.service';
import { GenesisActionPlanBuilder } from './action-plan-builder.service';
import { GenesisDocumentPackService } from './genesis-document-pack.service';
import { GenesisRiskRegisterService } from './genesis-risk-register.service';
import { MarketStrategyContextBuilder } from './market-strategy-context-builder.service';
import { MarketStrategyAiGenerator } from './market-strategy-ai-generator.service';
import { MarketStrategyRepository } from './market-strategy.repository';
import { MarketStrategyDocumentBuilder } from './market-strategy-document-builder.service';
import { MarketStrategyMapper } from './market-strategy.mapper';
import { GenesisMarketStrategyService } from './genesis-market-strategy.service';
import { GenomeChatService } from './genome-chat.service';

@Module({
  imports: [BlueprintModule, AiModule, DocumentsModule, GovernanceModule],
  controllers: [BusinessGenesisController, GenomeChatController],
  providers: [
    BusinessGenesisService,
    GenesisProjectionService,
    GenesisReadinessScorer,
    GenesisActionPlanBuilder,
    GenesisDocumentPackService,
    GenesisRiskRegisterService,
    MarketStrategyContextBuilder,
    MarketStrategyAiGenerator,
    MarketStrategyRepository,
    MarketStrategyDocumentBuilder,
    MarketStrategyMapper,
    GenesisMarketStrategyService,
    GenomeChatService,
  ],
  exports: [BusinessGenesisService, GenesisMarketStrategyService, GenomeChatService],
})
export class BusinessGenesisModule {}
