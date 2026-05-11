import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { OutputTemplateService } from './output-template.service';
import { OutputTemplateController } from './output-template.controller';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FlowController } from './flow.controller';
import { GraphActionsController } from './graph-actions.controller';
import { BusinessGraphService } from './business-graph.service';
import { GovernanceService } from './governance.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerService } from './planner.service';
import { AiMemoryService } from './ai-memory.service';
import { StrategicIntelligenceService } from './strategic-intelligence.service';
import { ProAutoMonitorService } from './pro-auto-monitor.service';
import { ProfileIntelligenceService } from './profile-intelligence.service';
import { WorkspaceRecommendationsService } from './workspace-recommendations.service';
import { ModelGatewayService } from './model-gateway.service';
import { BusinessMatchingService } from './business-matching.service';
import { MatchRefreshSchedulerService } from './match-refresh-scheduler.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BlueprintModule } from '../blueprint/blueprint.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule, BlueprintModule],
  controllers: [AiController, OutputTemplateController, FlowController, GraphActionsController],
  providers: [
    AiListener,
    ModelGatewayService,
    AiAdvisorService,
    AiUsageService,
    OutputTemplateService,
    FlowOrchestratorService,
    BusinessGraphService,
    GovernanceService,
    AiExecutionLogService,
    IntentParserService,
    PlannerService,
    AiMemoryService,
    StrategicIntelligenceService,
    ProAutoMonitorService,
    ProfileIntelligenceService,
    WorkspaceRecommendationsService,
    BusinessMatchingService,
    MatchRefreshSchedulerService,
  ],
  exports: [
    ModelGatewayService,
    AiAdvisorService,
    AiUsageService,
    OutputTemplateService,
    FlowOrchestratorService,
    BusinessGraphService,
    GovernanceService,
    AiExecutionLogService,
    IntentParserService,
    PlannerService,
    AiMemoryService,
    StrategicIntelligenceService,
    ProAutoMonitorService,
    ProfileIntelligenceService,
    WorkspaceRecommendationsService,
    BusinessMatchingService,
  ],
})
export class AiModule {}
