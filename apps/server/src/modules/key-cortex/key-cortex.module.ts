/**
 * KEY Cortex Module
 * NestJS module definition for the JARVIS-like AI intelligence layer.
 *
 * Orchestrates multi-provider AI reasoning, voice synthesis/recognition,
 * personality management, conversation state, business context awareness,
 * and action execution -- all scoped behind a unified REST + SSE API.
 *
 * v2 -- Integration Layer:
 *   Added universal connector, command parser, action executor, context v2,
 *   insight engine, and background monitor integration. All wired with
 *   forwardRef to break circular dependency chains with domain modules.
 *
 * v3 -- Phase 3 & 4 Services:
 *   Added Sandbox (code generation & execution), Flow Studio (workflow
 *   management), External Connectors (third-party integrations), Phone
 *   Agent (voice calls), Document Intelligence (RAG & extraction), and
 *   Self-Evolution (adaptive learning & tuning). Includes HttpModule for
 *   external HTTP calls via @nestjs/axios.
 *
 * v4 -- Genome Deep Integration Bridge:
 *   Added KeyCortexGenomeBridgeService connecting KEY Cortex to the Business
 *   Genome system. Wires genome intelligence, autonomy gating, opportunity
 *   detection, recommendation ranking, outcome learning, signal creation,
 *   and cross-domain analysis into KEY's decision loop. Adds BlueprintModule
 *   and supporting event/evidence/approval services.
 *
 * v5 -- Real-time WebSocket Layer:
 *   Added KeyCortexGateway (socket.io namespace /key-cortex) for live
 *   bidirectional streaming: chat, approvals, alerts, insights, health
 *   updates, and proactive suggestions. KeyCortexRealtimeService bridges
 *   domain events -> WebSocket pushes via @nestjs/event-emitter.
 */

import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { KeyCortexController } from './key-cortex.controller';
import { KeyCortexAuditController } from './key-cortex-audit.controller';
import { KeyCortexGoalsController } from './key-cortex-goals.controller';
import { AdaptiveRouterService } from './adaptive-router.service';
import { CognitiveTriageService } from './cognitive-triage.service';
import { KeyCortexEfferentBridgeService } from './key-cortex-efferent-bridge.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { FlowSignalBridgeService } from './flow-signal-bridge.service';
import { EventEmitterFlowBridgeService } from './event-emitter-flow-bridge.service';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { KeyCortexActionExecutorPlugin } from './key-cortex-action-executor.plugin';
import { KeyCortexOrganRegistrarService } from './key-cortex-organ-registrar.service';
import { KeyCortexInteroceptionService } from './key-cortex-interoception.service';
import { KeyCortexAwarenessService } from './key-cortex-awareness.service';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';
import { KeyCortexLifecycleService } from './key-cortex-lifecycle.service';
import { KeyCortexSafeDatabaseService } from './key-cortex-safe-database.service';
import { KeyCortexAuditService } from './key-cortex-audit.service';
import { KeyCortexApprovalOrchestratorService } from './key-cortex-approval-orchestrator.service';
import { KeyIdempotencyService } from './key-idempotency.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { KeyCortexSagaExecutorService } from './key-cortex-saga-executor.service';
import { KeyCortexTriggerService } from './key-cortex-trigger.service';

// -- Phase 2 Body: Organ Adapters --
import { TemporalFlowAdapterService } from './organs/temporal-flow-adapter.service';
import { KeyInboxAdapterService } from './organs/key-inbox-adapter.service';
import { KeyGenomeAdapterService } from './organs/key-genome-adapter.service';
import { StorelinkAdapterService } from './organs/storelink-adapter.service';
import { KeyConnectorAdapterService } from './organs/key-connector-adapter.service';

// -- Phase 0.5: Typed Module Adapters for KeyCortexConnectorService --
import {
  CrmAdapterService,
  CommerceAdapterService,
  BookingsAdapterService,
  ContentAdapterService,
  CommunicationsAdapterService,
  FlowAdapterService,
  AutopilotAdapterService,
  TemporalAdapterService,
  InboxAdapterService,
  NotificationsAdapterService,
  ProjectsAdapterService,
  ActivityAdapterService,
  SocialAdapterService,
  FinanceAdapterService,
  AnalyticsAdapterService,
  IntelligenceAdapterService,
  SettingsAdapterService,
  KeyCortexBridgeAdapterService,
} from './adapters';

// -- Core (legacy) --
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';

// -- v2 Integration Layer --
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCapabilityRegistryService } from './key-cortex-capability-registry.service';
import { KeyCortexContextAssemblyService } from './key-cortex-context-assembly.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexMonitorV2Service } from './key-cortex-monitor-v2.service';
import { KeyCortexPlannerService } from './key-cortex-planner.service';

// -- Phase 0.7b: Decomposed reasoning services --
import { KeyCortexSessionService } from './key-cortex-session.service';
import { KeyCortexPromptContextService } from './key-cortex-prompt-context.service';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { KeyCortexActionDetectionService } from './key-cortex-action-detection.service';
import { KeyCortexLegacyInsightService } from './key-cortex-legacy-insight.service';
import { KeyCortexProviderSelectionService } from './key-cortex-provider-selection.service';
import { KeyCortexStructuredOutputService } from './key-cortex-structured-output.service';
import { KeyCortexExpertiseLensService } from './key-cortex-expertise-lens.service';
import { KeyCortexEthicsService } from './key-cortex-ethics.service';
import { KeyCortexEmotionService } from './key-cortex-emotion.service';
import { KeyCortexReasoningEngineService } from './key-cortex-reasoning-engine.service';
import { KeyCortexTemporalReasoningService } from './key-cortex-temporal-reasoning.service';
import { KeyCortexCreativityService } from './key-cortex-creativity.service';
import { KeyCortexReflectionService } from './key-cortex-reflection.service';
import { KeyCortexIntuitionService } from './key-cortex-intuition.service';
import { KeyCortexMetacognitionService } from './key-cortex-metacognition.service';
import { KeyCortexConsciousnessService } from './key-cortex-consciousness.service';
import { KeyCortexMoodDetectionService } from './key-cortex-mood-detection.service';
import { KeyCortexSuggestionService } from './key-cortex-suggestion.service';
import { KeyCortexGenomeContextService } from './key-cortex-genome-context.service';
import { KeyCortexSystemPromptService } from './key-cortex-system-prompt.service';
import { KeyCortexInteractionService } from './key-cortex-interaction.service';
import { KeyCortexCommandExecutionService } from './key-cortex-command-execution.service';
import { KeyCortexQueryPipelineService } from './key-cortex-query-pipeline.service';
import { KeyCortexQualityService } from './key-cortex-quality.service';

// -- v3 Phase 3 & 4 Services --
import { KeyCortexSandboxService } from './key-cortex-sandbox.service';
import { KeyCortexFlowStudioService } from './key-cortex-flow-studio.service';
import { KeyCortexEvolutionService } from './key-cortex-evolution.service';
import { KeyCortexPhoneService } from './key-cortex-phone.service';
import { KeyCortexDocumentService } from './key-cortex-document.service';

// -- v4 Genome Deep Integration Bridge --
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexEvidenceService } from './key-cortex-evidence.service';
import { KeyCortexApprovalService } from './key-cortex-approval.service';

// -- v5 Real-time WebSocket Layer --
import { KeyCortexGateway } from './key-cortex.gateway';
import { KeyCortexWsAuthService } from './key-cortex-ws-auth.service';
import { KeyCortexRealtimeService } from './key-cortex-realtime.service';

// -- Phase D: Data & Persistent Learning --
import { KeyBiEngineService } from './key-bi-engine.service';
import { KeyCortexDigestService } from './key-cortex-digest.service';
import { KeyProactiveEngineService } from './key-proactive-engine.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { KeyCortexMemoryRetrievalService } from './key-cortex-memory-retrieval.service';
import { UnifiedMemoryWriterService } from './unified-memory-writer.service';
import { EvalHarnessService } from './eval-harness.service';
import { CognitiveEventBusService } from './cognitive-event-bus.service';
import { ValueLearningService } from './value-learning.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { MemoryConsolidationService } from './memory-consolidation.service';
import { SelfAssessmentService } from './self-assessment.service';
import {
  InvoiceOverdueWatcherService,
  BookingNoShowWatcherService,
  SentimentWatcherService,
} from './watchers';
import { EscalationService } from './escalation.service';
import { DigitalEmployeeAcceptanceService } from './digital-employee-acceptance.service';
import { KeyCortexMemoryService } from './key-cortex-memory.service';
import { CognitionSessionService } from './cognition-session.service';

// -- Infrastructure --
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RedisModule } from '../../core/redis/redis.module';

// -- AI Gateway --
import { AiModule } from '../ai/ai.module';

// -- Domain modules (forwardRef to break circular deps) --
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CommunicationsModule } from '../communications/communications.module';
import { FlowModule } from '../flow/flow.module';
import { AutopilotModule } from '../autopilot/autopilot.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { KeyInboxModule } from '../key-inbox/key-inbox.module';
import { FlowSignalModule } from '../flow-signal/flow-signal.module';
import { BusinessGenomeModule } from '../business-genome/business-genome.module';
import { KeyGenomeModule } from '../business-genome/key-genome/key-genome.module';
import { BlueprintModule } from '../blueprint/blueprint.module';
import { KeyAutonomyModule } from '../key-autonomy/key-autonomy.module';
import { BusinessEventModule } from '../business-events/business-event.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { KeystoreModule } from '../keystore/keystore.module';
import { PortalModule } from '../portal/portal.module';
import { SiteModule } from '../site/site.module';
import { KeyConnectorModule } from '../key-connector/key-connector.module';
import { ContentService } from '../content/content.service';
import { SocialModule } from '../social/social.module';
import { ActivityLogService } from '../activity/activity.service';
import { FinanceModule } from '../finance/finance.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ReportsModule } from '../reports/reports.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { GrowthIntelligenceModule } from '../growth-intelligence/growth-intelligence.module';
import { BusinessCommandCenterModule } from '../business-command-center/business-command-center.module';
import { IdentityModule } from '../identity/identity.module';
import { CommandModule } from '../command/command.module';
import { IntegrationHubModule } from '../integration-hub/integration-hub.module';

@Module({
  imports: [
    // Database & cache infrastructure
    PrismaModule,
    RedisModule,

    // HTTP client for external connector calls
    HttpModule,

    // AI provider gateway -- forwardRef to break any potential circular
    // dependency between KeyCortex and the legacy AiModule.
    forwardRef(() => AiModule),

    // -- v4: Genome Deep Integration --
    // BlueprintModule provides DNA integrity calculations and genome scoring
    // needed by the bridge for AI-enriched context and proactive decisions.
    forwardRef(() => BlueprintModule),

    // -- v2: Domain module adapters --
    // The universal connector needs to call services in each of these
    // modules.  forwardRef prevents circular dependency issues at
    // bootstrap time (e.g. CrmModule -> AiModule -> KeyCortexModule ->
    // CrmModule).
    forwardRef(() => CrmModule),
    forwardRef(() => CommerceModule),
    forwardRef(() => CatalogModule),
    forwardRef(() => BookingsModule),
    forwardRef(() => CommunicationsModule),
    forwardRef(() => FlowModule),
    forwardRef(() => AutopilotModule),
    forwardRef(() => TemporalFlowModule),
    forwardRef(() => KeyInboxModule),
    forwardRef(() => FlowSignalModule),
    forwardRef(() => BusinessGenomeModule),
    forwardRef(() => KeyGenomeModule),
    forwardRef(() => KeyAutonomyModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => ProjectsModule),

    // -- KeyStore Service Marketplace --
    // Enables KEY Cortex to manage service orders, browse listings, and
    // track deliverable requests through the Keystore module.
    forwardRef(() => KeystoreModule),

    // -- Phase 2 Body: Outward-facing modules --
    forwardRef(() => PortalModule),
    forwardRef(() => SiteModule),
    forwardRef(() => KeyConnectorModule),
    forwardRef(() => SocialModule),

    // -- Phase 2 Organs: Finance, Analytics, Intelligence, Settings --
    forwardRef(() => FinanceModule),
    forwardRef(() => ExpensesModule),
    forwardRef(() => ReportsModule),
    forwardRef(() => AnalyticsModule),
    forwardRef(() => IntelligenceModule),
    forwardRef(() => GrowthIntelligenceModule),
    forwardRef(() => BusinessCommandCenterModule),
    forwardRef(() => IdentityModule),
    forwardRef(() => IntegrationHubModule),
    forwardRef(() => CommandModule),

    // Business events for unified audit trail
    BusinessEventModule,
  ],

  controllers: [
    // REST + SSE surface (see key-cortex.controller.ts)
    KeyCortexController,
    // Mind / Soul / Evolution audit + eval surface
    KeyCortexAuditController,
    // Phase 3: Goals & Plans
    KeyCortexGoalsController,
  ],

  providers: [
    // -- Core (legacy) --
    // Personality engine -- voice, tone, persona management
    KeyCortexPersonalityService,

    // Genome context assembler -- business DNA & activity snapshotting
    KeyCortexContextService,

    // Reasoning engine -- core brain, streaming, provider routing
    KeyCortexReasoningService,

    // -- Phase 0.7b: Decomposed reasoning delegate services --
    KeyCortexSessionService,
    KeyCortexPromptContextService,
    KeyCortexToolLoopService,
    KeyCortexActionDetectionService,
    KeyCortexLegacyInsightService,
    KeyCortexProviderSelectionService,
    KeyCortexStructuredOutputService,
    KeyCortexMoodDetectionService,
    KeyCortexExpertiseLensService,
    KeyCortexEthicsService,
    KeyCortexEmotionService,
    KeyCortexReasoningEngineService,
    KeyCortexTemporalReasoningService,
    KeyCortexCreativityService,
    KeyCortexReflectionService,
    KeyCortexIntuitionService,
    KeyCortexMetacognitionService,
    KeyCortexConsciousnessService,
    KeyCortexSuggestionService,
    KeyCortexGenomeContextService,
    KeyCortexSystemPromptService,
    KeyCortexInteractionService,
    KeyCortexCommandExecutionService,
    KeyCortexQueryPipelineService,
    KeyCortexQualityService,

    // Adaptive router -- lightweight multi-dimensional query classifier
    AdaptiveRouterService,
    CognitiveTriageService,
    KeyCortexEfferentBridgeService,

    // Conversation manager -- session lifecycle & message history
    KeyCortexConversationService,

    // Action executor -- tool calling, approval flow, execution tracking
    KeyCortexActionsService,

    // -- Phase 1 Body: Peripheral Nervous System --
    // Unified event bus and canonical tool registry that all organs plug into.
    KeyCortexEventBusService,
    FlowSignalBridgeService,
    EventEmitterFlowBridgeService,
    KeyCortexToolRegistryService,
    KeyCortexActionExecutorPlugin,

    // -- Phase 2 Body: Organ Adapters --
    // Adapters that wire each organ into the nervous system.
    TemporalFlowAdapterService,
    KeyInboxAdapterService,
    KeyGenomeAdapterService,
    StorelinkAdapterService,
    KeyConnectorAdapterService,

    // -- Phase 2 Body: Organ Registrar --
    // Registers all organ tools into the canonical registry at boot.
    KeyCortexOrganRegistrarService,
    KeyCortexInteroceptionService,
    KeyCortexAwarenessService,
    KeyCortexEndocrineService,

    // -- Phase 3 Body: Skeleton --
    // Identity/lifecycle manager that ties sessions, commands, execution logs,
    // and audit events together with a single correlationId thread.
    KeyCortexLifecycleService,
    // Authority-granted safe database wrappers for QUERY_DATABASE / UPDATE_RECORD.
    KeyCortexSafeDatabaseService,

    // -- Phase 0: Execution Foundation --
    // Unified audit event writer with identity lineage.
    KeyCortexAuditService,
    // Single approval orchestrator that collapses KeyActionProposal,
    // AiApprovalItem, and ApprovalRequest into one canonical path.
    KeyCortexApprovalOrchestratorService,
    // Idempotency and saga/rollback foundation.
    KeyIdempotencyService,
    KeyCortexSagaService,
    KeyCortexCompensationService,
    KeyCortexSagaExecutorService,

    // Voice interface -- TTS / STT with personality voice mapping
    KeyCortexVoiceService,

    // -- v2: Integration Layer --
    // Universal connector -- knows how to talk to every KeyFlowOS module
    KeyCortexConnectorService,

    // -- Phase 0.7: Decomposed connector services --
    KeyCortexCapabilityRegistryService,
    KeyCortexContextAssemblyService,

    // -- Phase 3: Autonomy & Planning --
    KeyCortexPlannerService,

    // -- Phase 4: Proactive Senses --
    KeyProactiveEngineService,
    KeyCortexTriggerService,

    // -- Phase 0.5: Typed module adapters (replaces as-any casts) --
    CrmAdapterService,
    CommerceAdapterService,
    BookingsAdapterService,
    ContentAdapterService,
    CommunicationsAdapterService,
    FlowAdapterService,
    AutopilotAdapterService,
    TemporalAdapterService,
    InboxAdapterService,
    NotificationsAdapterService,
    ProjectsAdapterService,
    ActivityAdapterService,
    SocialAdapterService,
    FinanceAdapterService,
    AnalyticsAdapterService,
    IntelligenceAdapterService,
    SettingsAdapterService,

    // -- Phase 0.7: Phase-2 bridge adapter --
    KeyCortexBridgeAdapterService,

    // -- Phase 0.5: Typed domain services --
    // Content and Activity services are already typed to match the connector's
    // expected API; the remaining modules route through the adapters above.
    ContentService,
    ActivityLogService,

    // NL -> Command parser -- converts natural language to structured commands
    KeyCortexCommandService,

    // Action executor -- real execution with error handling, rollback, audit
    KeyCortexExecutorService,

    // Full context assembler -- aggregates context from all 90+ modules
    KeyCortexContextV2Service,

    // Business insight engine -- profit, revenue, churn, pipeline analysis
    KeyCortexInsightService,

    // Background monitor integration -- autonomous loop management
    KeyCortexMonitorV2Service,

    // -- Phase D: Data & Persistent Learning --
    // Real-time business mental model with Redis caching and health snapshots
    KeyBiEngineService,
    // Daily / weekly digest generation and delivery
    KeyCortexDigestService,
    // Proactive rule-based watchers
    InvoiceOverdueWatcherService,
    BookingNoShowWatcherService,
    SentimentWatcherService,
    // Persistent learning loop + metacognition / confidence calibration
    KeyCortexLearningService,

    // Persistent multi-type KEY Cortex memory
    KeyCortexMemoryService,

    // Canonical structured-memory writer (Phase 0.9 unification)
    UnifiedMemoryWriterService,

    // Unified memory retrieval layer over all KEY memory stores
    UnifiedMemoryRetrievalService,

    // Roadmap-named memory retrieval facade
    KeyCortexMemoryRetrievalService,

    // Automated evaluation harness for Mind / Soul / Evolution
    EvalHarnessService,

    // Mind / Soul / Evolution foundation services
    CognitiveEventBusService,
    ValueLearningService,
    KnowledgeIngestionService,
    MemoryConsolidationService,
    SelfAssessmentService,
    EscalationService,
    DigitalEmployeeAcceptanceService,

    // -- Phase A: Cognition session context primitive --
    CognitionSessionService,

    // -- v3: Phase 3 & 4 Services --
    // Sandbox -- AI-powered code generation & secure execution
    KeyCortexSandboxService,

    // Flow Studio -- visual workflow builder & automation engine
    KeyCortexFlowStudioService,


    // Self-Evolution -- adaptive learning, pattern detection & auto-tuning
    KeyCortexEvolutionService,

    // Phone Agent -- voice calls, scripts, transcripts & analysis
    KeyCortexPhoneService,

    // Document Intelligence -- RAG & extraction, comparison & Q&A
    KeyCortexDocumentService,

    // -- v4: Genome Deep Integration Bridge --
    // The critical bridge connecting KEY Cortex to the Business Genome.
    // Provides bidirectional intelligence flow for autonomous decisions.
    KeyCortexGenomeBridgeService,

    // Event service -- emits bridge events for audit and monitoring
    KeyCortexEventService,

    // Evidence service -- manages evidence creation from KEY actions
    KeyCortexEvidenceService,

    // Approval service -- handles approval gating for supervised actions
    KeyCortexApprovalService,

    // -- v5: Real-time WebSocket Layer --
    // WebSocket handshake auth/authorization (JWT + business membership).
    KeyCortexWsAuthService,

    // WebSocket gateway -- live bidirectional streaming (chat, approvals,
    // alerts, insights, suggestions, health). Runs on /key-cortex namespace.
    KeyCortexGateway,

    // Realtime event bridge -- listens to domain events and forwards them
    // to connected browser clients via the gateway above.
    KeyCortexRealtimeService,
  ],

  exports: [
    // -- Core (legacy) --
    // Re-export all services so other modules can compose
    // KeyCortex capabilities (e.g. autopilot, command centre,
    // onboarding concierge) without duplicating providers.
    KeyCortexPersonalityService,
    KeyCortexContextService,
    KeyCortexReasoningService,
    KeyCortexSessionService,
    KeyCortexPromptContextService,
    KeyCortexToolLoopService,
    KeyCortexActionDetectionService,
    KeyCortexLegacyInsightService,
    KeyCortexProviderSelectionService,
    KeyCortexStructuredOutputService,
    KeyCortexMoodDetectionService,
    KeyCortexExpertiseLensService,
    KeyCortexEthicsService,
    KeyCortexEmotionService,
    KeyCortexReasoningEngineService,
    KeyCortexTemporalReasoningService,
    KeyCortexCreativityService,
    KeyCortexReflectionService,
    KeyCortexIntuitionService,
    KeyCortexMetacognitionService,
    KeyCortexConsciousnessService,
    KeyCortexSuggestionService,
    KeyCortexGenomeContextService,
    KeyCortexSystemPromptService,
    KeyCortexInteractionService,
    KeyCortexCommandExecutionService,
    KeyCortexQueryPipelineService,
    KeyCortexQualityService,
    AdaptiveRouterService,
    CognitiveTriageService,
    KeyCortexEfferentBridgeService,
    KeyCortexConversationService,
    KeyCortexActionsService,
    KeyCortexVoiceService,

    // -- v2: Integration Layer --
    // These are the primary services other modules will consume.
    // Connector + Executor form the "command API" surface.
    // ContextV2 + Insight provide the "query API" surface.
    KeyCortexConnectorService,
    KeyCortexCapabilityRegistryService,
    KeyCortexContextAssemblyService,
    KeyCortexExecutorService,
    KeyCortexContextV2Service,
    KeyCortexInsightService,

    // -- v3: Phase 3 & 4 Services --
    // Sandbox -- reusable code generation & execution for other modules
    KeyCortexSandboxService,

    // Flow Studio -- workflow automation accessible by other modules
    KeyCortexFlowStudioService,


    // Document Intelligence -- RAG & extraction available to other modules
    KeyCortexDocumentService,

    // -- v4: Genome Deep Integration Bridge --
    // Bridge service -- the primary export for genome integration
    KeyCortexGenomeBridgeService,

    // Supporting services -- event emission, evidence tracking, approval gating
    KeyCortexEventService,
    KeyCortexEvidenceService,
    KeyCortexApprovalService,

    // -- v5: Real-time WebSocket Layer --
    // Gateway -- so other modules can push events directly to clients
    KeyCortexGateway,

    // Realtime service -- so other modules can emit domain events that
    // get forwarded to WebSocket clients automatically
    KeyCortexRealtimeService,

    // -- Phase D / Phase 4: Data, Persistent Learning & Proactive Senses --
    KeyBiEngineService,
    KeyProactiveEngineService,
    KeyCortexTriggerService,
    KeyCortexDigestService,
    KeyCortexLearningService,
    // Proactive rule-based watchers
    InvoiceOverdueWatcherService,
    BookingNoShowWatcherService,
    SentimentWatcherService,
    KeyCortexMemoryService,

    // -- Phase A: Cognition session context primitive --
    CognitionSessionService,

    // Canonical structured-memory writer (Phase 0.9 unification)
    UnifiedMemoryWriterService,

    // Unified memory retrieval layer
    UnifiedMemoryRetrievalService,

    // Roadmap-named memory retrieval facade
    KeyCortexMemoryRetrievalService,

    // Automated evaluation harness
    EvalHarnessService,

    // Mind / Soul / Evolution foundation services
    CognitiveEventBusService,
    ValueLearningService,
    KnowledgeIngestionService,
    MemoryConsolidationService,
    SelfAssessmentService,
    EscalationService,
    DigitalEmployeeAcceptanceService,

    // -- Phase 1 Body: Peripheral Nervous System --
    KeyCortexEventBusService,
    KeyCortexToolRegistryService,

    // -- Phase 2 Body: Organ Adapters --
    TemporalFlowAdapterService,
    KeyInboxAdapterService,
    KeyGenomeAdapterService,
    StorelinkAdapterService,
    KeyConnectorAdapterService,

    // -- Phase 0.5: Typed module adapters --
    CrmAdapterService,
    CommerceAdapterService,
    BookingsAdapterService,
    ContentAdapterService,
    CommunicationsAdapterService,
    FlowAdapterService,
    AutopilotAdapterService,
    TemporalAdapterService,
    InboxAdapterService,
    NotificationsAdapterService,
    ProjectsAdapterService,
    ActivityAdapterService,

    // -- Phase 0.7: Phase-2 bridge adapter --
    KeyCortexBridgeAdapterService,

    // -- Phase 2 Body: Organ Registrar --
    KeyCortexOrganRegistrarService,
    KeyCortexInteroceptionService,
    KeyCortexAwarenessService,
    KeyCortexEndocrineService,

    // -- Phase 3 Body: Skeleton --
    KeyCortexLifecycleService,
    KeyCortexSafeDatabaseService,

    // -- Phase 0: Execution Foundation --
    KeyCortexAuditService,
    KeyCortexApprovalOrchestratorService,
    KeyIdempotencyService,
    KeyCortexSagaService,
    KeyCortexCompensationService,
    KeyCortexSagaExecutorService,
  ],
})
export class KeyCortexModule {}
