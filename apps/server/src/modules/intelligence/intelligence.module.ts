import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller';
import { BusinessIntelligenceController } from './business-intelligence.controller';
import { RulesService } from './rules.service';
import { SignalsService } from './signals.service';
import { CommandBridgeService } from './command-bridge.service';
import { HealthScoreService } from './health-score.service';
import { ScheduledScansService } from './scheduled-scans.service';
import { EntityResolverService } from './entity-resolver.service';
import { BusinessIntelligenceService } from './business-intelligence.service';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { BusinessAssetsModule } from '../business-assets/business-assets.module';

@Module({
  imports: [BlueprintModule, TemporalFlowModule, BusinessGenomeModule, BusinessAssetsModule],
  controllers: [IntelligenceController, BusinessIntelligenceController],
  providers: [
    RulesService,
    SignalsService,
    CommandBridgeService,
    HealthScoreService,
    ScheduledScansService,
    EntityResolverService,
    BusinessIntelligenceService,
  ],
  exports: [
    RulesService,
    SignalsService,
    CommandBridgeService,
    HealthScoreService,
    ScheduledScansService,
    EntityResolverService,
    BusinessIntelligenceService,
  ],
})
export class IntelligenceModule {}
