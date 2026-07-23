import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiUsageAdminController } from './ai-usage-admin.controller';
import { AiUsageAlertSchedulerService } from './ai-usage-alert-scheduler.service';
import { AgentController } from './agent.controller';
import { AiListener } from './ai.listener';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { OutputTemplateService } from './output-template.service';
import { OutputTemplateController } from './output-template.controller';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiFlowController } from './flow.controller';
import { GraphActionsController } from './graph-actions.controller';
import { BusinessGraphService } from './business-graph.service';
import { AiOversightService } from './ai-oversight.service';
import { ApprovalRoutingService } from './approval-routing.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerService } from './planner.service';
import { AiMemoryService } from './ai-memory.service';
import { StrategicIntelligenceService } from './strategic-intelligence.service';
import { ProAutoMonitorService } from './pro-auto-monitor.service';
import { ProfileIntelligenceService } from './profile-intelligence.service';
import { BlueprintOnboardingService } from './blueprint-onboarding.service';
import { BlueprintOnboardingController } from './blueprint-onboarding.controller';
import { WorkspaceRecommendationsService } from './workspace-recommendations.service';
import { ModelGatewayService } from './model-gateway.service';
import { LLMCostService } from './llm-cost.service';
import { BusinessMatchingService } from './business-matching.service';
import { MatchRefreshSchedulerService } from './match-refresh-scheduler.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RedisModule } from '../../core/redis/redis.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { TimelineModule } from '../timeline/timeline.module';
import { FinanceModule } from '../finance/finance.module';
import { CommandModule } from '../command/command.module';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { TaskAssignmentModule } from '../task-assignments/task-assignment.module';
import { KeyAutonomyModule } from '../key-autonomy/key-autonomy.module';
import { KeyCortexModule } from '../key-cortex/key-cortex.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { ConversationGenomeExtractorService } from './conversation-genome-extractor.service';
import { CodeExecutorService } from './code-executor.service';
import { CodeExecutorController } from './code-executor.controller';
import { ExpensesModule } from '../expenses/expenses.module';
import { ContractsModule } from '../contracts/contracts.module';
import { HelpdeskModule } from '../helpdesk/helpdesk.module';
import { KeyInboxModule } from '../key-inbox/key-inbox.module';
import { CommunicationsModule } from '../communications/communications.module';
import { McpModule } from '../mcp/mcp.module';
import { StructureModule } from '../structure/structure.module';
import { PayrollModule } from '../payroll/payroll.module';
import { StaffPerformanceModule } from '../staff-performance/staff-performance.module';
import { KeyCommandService } from './key-command.service';
import { KeyToolRegistryService } from './key-tool-registry.service';
import { AutopilotRulesService } from './autopilot-rules.service';
import { PlanExecutorService } from './plan-executor.service';
import { FeedbackLoopService } from './feedback-loop.service';
import { ActionDispatcherService } from './action-dispatcher.service';
import { ProactiveSuggestionService } from './proactive-suggestion.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { AgentTriggerService } from './agent-trigger.service';
import { AgentHealthService } from './agent-health.service';
import { AgentBusService } from './agent-bus.service';
import { AgentStateMachineService } from './agent-state-machine.service';
import { PatternDetectorService } from './pattern-detector.service';
import { DefaultTriggersService } from './default-triggers.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { ConnectorIntelligenceService } from './connector-intelligence.service';
import { ConversationalAIService } from './conversational-ai.service';
import { CalendarIntelligenceService } from './calendar-intelligence.service';
import { UndoService } from './undo.service';
import { QueueService } from './queue.service';
import { CronSchedulerService } from './cron-scheduler.service';
import { AiMessageSenderService } from './ai-message-sender.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { RoleEngineService } from './role-engine.service';
import { UnifiedInboxService } from './unified-inbox.service';
import { JourneyOrchestratorService } from './journey-orchestrator.service';
import { MorningBriefingService } from './morning-briefing.service';
import { GoalTrackerService } from './goal-tracker.service';
import { WorkloadAggregatorService } from './workload-aggregator.service';
import { TaskPrioritizerService } from './task-prioritizer.service';
import { CapacityInsightService } from './capacity-insight.service';
import { TaskRebalancerService } from './task-rebalancer.service';
import { ChaserService } from './chaser.service';
import { CrossBusinessIntelligenceService } from './cross-business-intelligence.service';
import { AiIntelligenceController } from './ai-intelligence.controller';
import { KeyAgentConfigService } from './key-agent-config.service';
import { AiApprovalsController } from './ai-approvals.controller';
import { AiApprovalsService } from './ai-approvals.service';

@Module({
  imports: [PrismaModule, RedisModule, SubscriptionsModule, forwardRef(() => BlueprintModule), TimelineModule, forwardRef(() => FinanceModule), CommandModule, GoogleDriveModule, TaskAssignmentModule, forwardRef(() => KeyAutonomyModule), forwardRef(() => KeyCortexModule), forwardRef(() => ExpensesModule), forwardRef(() => ContractsModule), HelpdeskModule, forwardRef(() => KeyInboxModule), forwardRef(() => CommunicationsModule), McpModule, StructureModule, PayrollModule, StaffPerformanceModule, KeyGenomeModule],
  controllers: [AiController, AiSettingsController, OutputTemplateController, AiFlowController, GraphActionsController, AiUsageAdminController, AiIntelligenceController, BlueprintOnboardingController, AiApprovalsController, CodeExecutorController],
  providers: [
    AiListener,
    ModelGatewayService,
    LLMCostService,
    AiAdvisorService,
    AiUsageService,
    AiUsageAlertSchedulerService,
    OutputTemplateService,
    FlowOrchestratorService,
    ConversationGenomeExtractorService,
    CodeExecutorService,
    BusinessGraphService,
    AiOversightService,
    ApprovalRoutingService,
    AiApprovalsService,
    AiExecutionLogService,
    IntentParserService,
    PlannerService,
    AiMemoryService,
    StrategicIntelligenceService,
    ProAutoMonitorService,
    ProfileIntelligenceService,
    BlueprintOnboardingService,
    WorkspaceRecommendationsService,
    BusinessMatchingService,
    MatchRefreshSchedulerService,
    KeyCommandService,
    KeyToolRegistryService,
    AutopilotRulesService,
    PlanExecutorService,
    WorkloadAggregatorService,
    FeedbackLoopService,
    ActionDispatcherService,
    ProactiveSuggestionService,
    WorkflowTemplateService,
    AgentTriggerService,
    AgentHealthService,
    AgentBusService,
    AgentStateMachineService,
    PatternDetectorService,
    DefaultTriggersService,
    DocumentIntelligenceService,
    ConnectorIntelligenceService,
    ConversationalAIService,
    CalendarIntelligenceService,
    UndoService,
    QueueService,
    CronSchedulerService,
    AiMessageSenderService,
    SemanticMemoryService,
    RoleEngineService,
    UnifiedInboxService,
    JourneyOrchestratorService,
    MorningBriefingService,
    GoalTrackerService,
    WorkloadAggregatorService,
    TaskPrioritizerService,
    CapacityInsightService,
    TaskRebalancerService,
    AiSettingsService,
    ChaserService,
    CrossBusinessIntelligenceService,
    KeyAgentConfigService,
  ],
  exports: [
    ModelGatewayService,
    LLMCostService,
    AiAdvisorService,
    AiUsageService,
    AiUsageAlertSchedulerService,
    OutputTemplateService,
    FlowOrchestratorService,
    BusinessGraphService,
    AiOversightService,
    ApprovalRoutingService,
    AiExecutionLogService,
    IntentParserService,
    PlannerService,
    AiMemoryService,
    StrategicIntelligenceService,
    ProAutoMonitorService,
    ProfileIntelligenceService,
    WorkspaceRecommendationsService,
    BusinessMatchingService,
    KeyCommandService,
    KeyToolRegistryService,
    AutopilotRulesService,
    PlanExecutorService,
    FeedbackLoopService,
    ActionDispatcherService,
    ProactiveSuggestionService,
    WorkflowTemplateService,
    AgentTriggerService,
    AgentHealthService,
    AgentBusService,
    AgentStateMachineService,
    PatternDetectorService,
    DefaultTriggersService,
    DocumentIntelligenceService,
    ConnectorIntelligenceService,
    ConversationalAIService,
    CalendarIntelligenceService,
    UndoService,
    QueueService,
    CronSchedulerService,
    AiMessageSenderService,
    SemanticMemoryService,
    RoleEngineService,
    UnifiedInboxService,
    JourneyOrchestratorService,
    MorningBriefingService,
    GoalTrackerService,
    WorkloadAggregatorService,
    TaskPrioritizerService,
    CapacityInsightService,
    TaskRebalancerService,
    ChaserService,
    KeyAgentConfigService,
  ],
})
export class AiModule {}
