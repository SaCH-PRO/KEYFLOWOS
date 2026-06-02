import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller';
import { RulesService } from './rules.service';
import { SignalsService } from './signals.service';
import { CommandBridgeService } from './command-bridge.service';
import { HealthScoreService } from './health-score.service';
import { ScheduledScansService } from './scheduled-scans.service';
import { EntityResolverService } from './entity-resolver.service';

@Module({
  controllers: [IntelligenceController],
  providers: [RulesService, SignalsService, CommandBridgeService, HealthScoreService, ScheduledScansService, EntityResolverService],
  exports: [RulesService, SignalsService, CommandBridgeService, HealthScoreService, ScheduledScansService, EntityResolverService],
})
export class IntelligenceModule {}
