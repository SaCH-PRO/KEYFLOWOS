import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ModelGatewayService,
  GatewayMessage,
  GatewayToolDefinition,
  TaskCategory,
} from '../ai/model-gateway.service';
import { AiMemoryService } from '../ai/ai-memory.service';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  CortexQuery,
  CortexResponse,
  CortexStreamChunk,
  CortexMessage,
  CortexSession,
  CortexContextSnapshot,
  CortexProvider,
  CortexActionResult,
  CortexActionType,
  CortexPersona,
} from './key-cortex.types';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import {
  AdaptiveRouterService,
  RouteDecision,
} from './adaptive-router.service';
import { KeyCortexToolRegistryService } from './key-cortex-tool-registry.service';
import { KeyCortexLifecycleService } from './key-cortex-lifecycle.service';
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import type { ConnectorCommand, ConnectorResult } from './key-cortex-connector.types';
import {
  blockedCortexAction,
  mapCortexBatchResult,
  pendingApprovalCortexAction,
  unverifiedCortexBatchAction,
} from './key-cortex-batch-result.mapper';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexGenomeBridgeService, AutonomyCheck } from './key-cortex-genome-bridge.service';
import { AutonomyOrchestratorService } from '../key-autonomy/autonomy-orchestrator.service';
import { KeyCortexPlannerService } from './key-cortex-planner.service';
import type { AutonomyVerdict } from '../key-autonomy/autonomy-orchestrator.types';
import { KeyCortexMemoryRetrievalService } from './key-cortex-memory-retrieval.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyProactiveEngineService } from './key-proactive-engine.service';
import { TrustExplanationService } from './trust-explanation.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { KeyCortexSessionService } from './key-cortex-session.service';
import {
  KeyCortexPromptContextService,
  isToolCallRecord,
  readersOwnCognitionMemory,
} from './key-cortex-prompt-context.service';
import { userCanAccessBusiness } from '../../core/auth/business.guard';
import { defaultScopesForRole } from '../../core/authority/module-vocabulary';
import type { CortexMemberAuthority } from './key-cortex.controller';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { KeyCortexActionDetectionService } from './key-cortex-action-detection.service';
import { KeyCortexStructuredOutputService } from './key-cortex-structured-output.service';
import { KeyCortexExpertiseLensService } from './key-cortex-expertise-lens.service';
import { KeyCortexMoodDetectionService } from './key-cortex-mood-detection.service';
import { KeyCortexSuggestionService } from './key-cortex-suggestion.service';
import { KeyCortexGenomeContextService } from './key-cortex-genome-context.service';
import { KeyCortexSystemPromptService } from './key-cortex-system-prompt.service';
import { KeyCortexQualityService } from './key-cortex-quality.service';
import {
  GenomeEnrichedContext,
  GenomeRecommendation,
  Suggestion,
} from './key-cortex-reasoning.types';
import type { MemoryFragment } from './unified-memory.types';

/**
 * What the autonomy authority made of one parsed command (V1-02 review
 * repair). Only 'executable' commands reach the executor; the rest are settled
 * without executing them (settleUnexecutedCommands).
 */
type ParsedCommandDecision<C> = {
  command: C;
  disposition: 'executable' | 'approval_required' | 'denied' | 'failed_closed';
  reason: string;
};

/** How many memory fragments a chat turn's system prompt carries (processQuery and its stream path). */
const CHAT_MEMORY_FRAGMENTS = 10;
/**
 * W10-CORTEX-CHAT-SCOPE review CR-W10CCS-1: what chatMemoryFragments asks for on top of
 * CHAT_MEMORY_FRAGMENTS, so that what it leaves out does not empty the prompt's memory block (the
 * headroom rule of buildMemoryContext): the tool-call records of the business-wide stores
 * (UnifiedMemoryRetrievalService reads at most 50 business_events and 50 cognitive_events, which rank
 * highest on recency in an active business) and the cognition memory of anyone but the reader (it
 * reads at most 50 rows; review SEC-W10CCS-R2).
 */
const CHAT_MEMORY_HEADROOM = 150;

/** The tool a model tool call names, or '' for a call that names none. */
function toolCallName(call: unknown): string {
  const name = (call as { function?: { name?: unknown } } | null)?.function?.name;
  return typeof name === 'string' ? name : '';
}

/**
 * KeyCortexQueryPipelineService
 *
 * Implements the full v3 genome-aware query pipeline (non-streaming and SSE
 * streaming). This is the heavy-lifting counterpart to the thin
 * KeyCortexReasoningService orchestrator.
 */
@Injectable()
export class KeyCortexQueryPipelineService {
  private readonly logger = new Logger(KeyCortexQueryPipelineService.name);

  private readonly MAX_CONTEXT_TOKENS: number;

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly personalityService: KeyCortexPersonalityService,
    private readonly contextService: KeyCortexContextService,
    private readonly actionsService: KeyCortexActionsService,
    private readonly sessionService: KeyCortexSessionService,
    private readonly promptContextService: KeyCortexPromptContextService,
    private readonly toolLoopService: KeyCortexToolLoopService,
    private readonly actionDetectionService: KeyCortexActionDetectionService,
    private readonly suggestionService: KeyCortexSuggestionService,
    private readonly genomeContextService: KeyCortexGenomeContextService,
    private readonly systemPromptService: KeyCortexSystemPromptService,
    private readonly structuredOutputService: KeyCortexStructuredOutputService,
    private readonly moodDetectionService: KeyCortexMoodDetectionService,
    @Optional()
    @Inject(KeyCortexMemoryRetrievalService)
    private readonly memoryRetrieval?: KeyCortexMemoryRetrievalService,
    @Optional()
    @Inject(AdaptiveRouterService)
    private readonly adaptiveRouter?: AdaptiveRouterService,
    @Optional()
    @Inject(KeyCortexConnectorService)
    private readonly connectorService?: KeyCortexConnectorService,
    @Optional()
    @Inject(KeyCortexCommandService)
    private readonly commandService?: KeyCortexCommandService,
    @Optional()
    @Inject(KeyCortexExecutorService)
    private readonly executorService?: KeyCortexExecutorService,
    @Optional()
    @Inject(KeyCortexContextV2Service)
    private readonly contextV2Service?: KeyCortexContextV2Service,
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(KeyCortexEventService)
    private readonly eventService?: KeyCortexEventService,
    @Optional()
    @Inject(KeyProactiveEngineService)
    private readonly proactive?: KeyProactiveEngineService,
    @Optional()
    @Inject(TrustExplanationService)
    private readonly trustExplanation?: TrustExplanationService,
    @Optional()
    @Inject(KeyCortexLearningService)
    private readonly learningService?: KeyCortexLearningService,
    @Optional()
    @Inject(AutonomyOrchestratorService)
    private readonly autonomyOrchestrator?: AutonomyOrchestratorService,
    @Optional()
    @Inject(KeyCortexToolRegistryService)
    private readonly toolRegistry?: KeyCortexToolRegistryService,
    @Optional()
    @Inject(KeyCortexLifecycleService)
    private readonly lifecycle?: KeyCortexLifecycleService,
    @Optional()
    @Inject(KeyCortexQualityService)
    private readonly qualityService?: KeyCortexQualityService,
    @Optional()
    @Inject(KeyCortexPlannerService)
    private readonly planner?: KeyCortexPlannerService,
    @Optional()
    @Inject(KeyCortexExpertiseLensService)
    private readonly expertiseLens?: KeyCortexExpertiseLensService,
  ) {
    this.MAX_CONTEXT_TOKENS = parseInt(
      process.env.KEY_CORTEX_MAX_CONTEXT_TOKENS ?? '8000',
      10,
    );
  }

  async processQuery(
    query: CortexQuery,
    flags: { integrationV2Enabled: boolean; genomeV3Enabled: boolean },
  ): Promise<CortexResponse> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    this.logger.log(
      `[processQuery][${correlationId}] business=${query.businessId} user=${query.userId} persona=${query.persona ?? 'default'} v2=${flags.integrationV2Enabled} v3=${flags.genomeV3Enabled}`,
    );

    await this.logEvent(correlationId, 'STEP_1_RECEIVE_QUERY', {
      businessId: query.businessId,
      userId: query.userId,
      queryText: query.text.substring(0, 200),
      v2Enabled: flags.integrationV2Enabled,
      v3Enabled: flags.genomeV3Enabled,
    });

    const safetyCheck = await this.runSafetyCheck(query.text, query.businessId, correlationId);
    if (safetyCheck?.blocked) {
      return this.buildBlockedResponse(correlationId, safetyCheck.reason);
    }

    try {
      const session = await this.sessionService.getOrCreateSession(query);

      // Phase 3: detect goal-oriented intents and delegate to the planner
      const goalIntent = this.detectGoalIntent(query.text);
      if (goalIntent && this.planner) {
        try {
          const goal = await this.planner.createGoal(query.businessId, {
            title: goalIntent.title,
            description: goalIntent.description,
            priority: 1,
          });
          const plan = await this.planner.createPlanFromGoal(goal.businessId, goal.id, query.userId);
          if (!plan) {
            throw new Error('Planner returned no plan');
          }
          await this.planner.executePlan(plan.id, { traceId: correlationId });

          await this.sessionService.saveMessage(session.id, {
            role: 'system',
            content: `Created goal "${goal.title}" and executed a ${plan.steps.length}-step plan.`,
            timestamp: new Date(),
          });

          return this.buildGoalResponse(
            query,
            session,
            goal,
            plan,
            correlationId,
            Date.now() - startTime,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Goal delegation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let turnIdentity:
        | {
            correlationId: string;
            sessionId: string;
            commandId: string;
            businessId: string;
            userId?: string | null;
          }
        | undefined;
      if (this.lifecycle) {
        try {
          const { identity } = await this.lifecycle.startTurn({
            businessId: query.businessId,
            userId: query.userId,
            sessionId: session.id,
            rawInput: query.text,
            mode: query.enableActions ? 'do' : 'ask',
            persona: query.persona,
            provider: query.provider,
          });
          turnIdentity = identity;
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Lifecycle startTurn failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const routeDecision: RouteDecision = this.adaptiveRouter
        ? await this.adaptiveRouter.route(query, session, session.messages.slice(-10))
        : {
            taskCategory: this.structuredOutputService.classifyTaskCategory(query),
            layers: ['reasoning', 'ethics'],
            promptVariant: 'standard',
            includeGenomeContext: true,
            includeMemoryContext: true,
            includeActions: query.enableActions ?? false,
            complexity: 'moderate',
            domain: 'general',
            urgency: 'low',
            emotionalWeight: 'low',
            timeHorizon: 'tactical',
            dataRequirement: 'none',
          };

      await this.logEvent(correlationId, 'STEP_1B_ADAPTIVE_ROUTE', {
        taskCategory: routeDecision.taskCategory,
        layers: routeDecision.layers,
        promptVariant: routeDecision.promptVariant,
        includeGenomeContext: routeDecision.includeGenomeContext,
        includeActions: routeDecision.includeActions,
      });

      let genomeContext: GenomeEnrichedContext | null = null;
      if (
        routeDecision.includeGenomeContext &&
        flags.genomeV3Enabled &&
        this.genomeBridgeService
      ) {
        try {
          genomeContext = await this.genomeContextService.getGenomeEnrichedContext(
            query.businessId,
          );
          this.logger.log(
            `[processQuery][${correlationId}] Genome context loaded: ${genomeContext.recommendations.length} recommendations, ${genomeContext.signals.length} signals`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Genome context failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_2_GENOME_INTELLIGENCE', {
        genomeAvailable: !!genomeContext,
        dnaScores: genomeContext?.dnaScores ?? null,
        recommendationCount: genomeContext?.recommendations.length ?? 0,
        signalCount: genomeContext?.signals.length ?? 0,
      });

      let memoryFragments: MemoryFragment[] = [];
      if (routeDecision.includeMemoryContext && this.memoryRetrieval) {
        try {
          memoryFragments = await this.chatMemoryFragments(query);
          this.logger.log(
            `[processQuery][${correlationId}] Loaded ${memoryFragments.length} memory fragment(s)`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Memory retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_2B_MEMORY_CONTEXT', {
        memoryFragments: memoryFragments.length,
      });

      let contextSnapshot: CortexContextSnapshot;
      let v2Context: any;

      if (flags.integrationV2Enabled && this.contextV2Service) {
        try {
          v2Context = await this.contextV2Service.getFullContext(query.businessId);
          contextSnapshot =
            await this.contextService.buildContextSnapshot(query.businessId);
          this.systemPromptService.enrichSnapshotFromV2(contextSnapshot, v2Context);
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] V2 context failed, falling back: ${err instanceof Error ? err.message : String(err)}`,
          );
          contextSnapshot =
            await this.contextService.buildContextSnapshot(query.businessId);
        }
      } else {
        contextSnapshot =
          await this.contextService.buildContextSnapshot(query.businessId);
      }

      if (genomeContext) {
        this.systemPromptService.enrichSnapshotFromGenome(
          contextSnapshot,
          genomeContext,
        );
      }

      await this.logEvent(correlationId, 'STEP_3_FULL_CONTEXT', {
        v2Available: !!v2Context,
        genomeStage: contextSnapshot.genomeStage,
        executiveReadiness: contextSnapshot.executiveReadiness,
      });

      let parsedCommands: Array<{
        module: string;
        action: string;
        parameters: Record<string, unknown>;
        requiresApproval: boolean;
        naturalLanguage: string;
      }> = [];

      if (
        routeDecision.includeActions &&
        flags.integrationV2Enabled &&
        this.commandService &&
        query.enableActions
      ) {
        try {
          const capabilities = this.connectorService!.getAllCapabilities();
          const parsedIntents = await (this.commandService as any).parseIntent(
            query.text,
            {
              businessId: query.businessId,
              userId: query.userId,
              businessName: contextSnapshot.businessId,
              currentPage: 'cortex_chat',
              recentActions: [],
            },
          );
          parsedCommands = parsedIntents.map((intent: any) => ({
            module: intent.module,
            action: intent.action,
            parameters: intent.parameters,
            requiresApproval: intent.requiresApproval,
            naturalLanguage: intent.naturalLanguage,
          }));
          this.logger.log(
            `[processQuery][${correlationId}] Parsed ${parsedCommands.length} command(s) from user input`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Command parsing failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_4_PARSE_INTENT', {
        commandsParsed: parsedCommands.length,
        commands: parsedCommands.map((c: any) => ({
          module: c.module,
          action: c.action,
        })),
      });

      // KF-EXEC-AUTH-FAIL-CLOSED-001 (#155), V1-02: fails closed. The same
      // evaluation gates the stream path (streamQuery) before executeBatch.
      const parsedAutonomy = await this.evaluateParsedCommandAutonomy(
        parsedCommands,
        query,
        session,
        flags,
        correlationId,
        'processQuery',
      );
      const {
        executable: autonomyCheckedCommands,
        error: autonomyCheckError,
      } = parsedAutonomy;

      await this.logEvent(
        correlationId,
        'STEP_5_CHECK_AUTONOMY',
        this.autonomyEvidence(parsedCommands.length, parsedAutonomy),
      );

      let rankedRecommendations: GenomeRecommendation[] = [];
      if (flags.genomeV3Enabled && this.genomeBridgeService) {
        try {
          rankedRecommendations =
            await this.genomeContextService.getRankedRecommendations(
              query.businessId,
              5,
            );
          this.logger.log(
            `[processQuery][${correlationId}] Got ${rankedRecommendations.length} ranked genome recommendations`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Ranked recommendations failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_6_RANKED_RECOMMENDATIONS', {
        recommendationCount: rankedRecommendations.length,
        topCategories: rankedRecommendations.slice(0, 3).map((r: any) => r.category),
      });

      let detectedPersona: CortexPersona | undefined;
      if (!query.persona) {
        try {
          detectedPersona =
            (await this.personalityService.classifyPersona(
              query.text,
              query.businessId,
            )) ?? undefined;
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Persona classification failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const persona: CortexPersona =
        query.persona ?? detectedPersona ?? session.persona ?? 'jarvis';
      const personalityConfig =
        this.personalityService.getPersonalityConfig(persona);

      let toneInfo: { tone: string; temperatureAdjustment: number } = {
        tone: '',
        temperatureAdjustment: 0,
      };
      try {
        toneInfo = await this.personalityService.selectTone(
          query.text,
          persona,
          query.mood,
        );
      } catch (err: any) {
        this.logger.warn(
          `[processQuery][${correlationId}] Tone selection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let systemPrompt: string;
      if (flags.genomeV3Enabled && genomeContext) {
        systemPrompt = this.systemPromptService.buildV3SystemPrompt(
          persona,
          contextSnapshot,
          v2Context,
          genomeContext,
          rankedRecommendations,
          autonomyCheckedCommands.length > 0,
        );
      } else if (flags.integrationV2Enabled) {
        systemPrompt = this.systemPromptService.buildV2SystemPrompt(
          persona,
          contextSnapshot,
          v2Context,
          autonomyCheckedCommands.length > 0,
        );
      } else {
        systemPrompt = this.personalityService.buildSystemPrompt(
          persona,
          contextSnapshot,
        );
      }

      try {
        const valueBlock = await this.personalityService.buildValueBlock(
          query.businessId,
        );
        if (valueBlock) {
          systemPrompt += `\n\n${valueBlock}`;
        }
      } catch {
        // Non-blocking
      }

      const detailLevel = this.getCalmModeDetailLevel(session);
      systemPrompt += `\nRespond with ${detailLevel} level of detail.`;

      systemPrompt += `\nUse a ${routeDecision.promptVariant} reasoning style.`;
      systemPrompt += `\nActive reasoning layers: ${routeDecision.layers.join(', ')}.`;
      if (toneInfo.tone) {
        systemPrompt += `\nAdopt a ${toneInfo.tone} tone.`;
      }

      // Expertise lens: the professional discipline this task calls for, and the
      // shape the answer should take. Framing only — it confers no access — and a
      // failure here must never block the response.
      let lensLabel: string | undefined;
      try {
        if (this.expertiseLens) {
          const selection = await this.expertiseLens.select(
            query.text,
            query.businessId,
          );
          systemPrompt += `\n\n${this.expertiseLens.buildPromptFraming(selection)}`;
          lensLabel = selection.lens.label;
        }
      } catch (err) {
        this.logger.debug(
          `[processQuery][${correlationId}] Expertise lens skipped: ${(err as Error).message}`,
        );
      }

      if (memoryFragments.length > 0) {
        systemPrompt += `\n\n${this.formatMemoryContextBlock(memoryFragments)}`;
      }

      await this.logEvent(correlationId, 'STEP_7_BUILD_PROMPT', {
        promptLength: systemPrompt.length,
        genomeEnriched: flags.genomeV3Enabled && !!genomeContext,
        expertiseLens: lensLabel,
        detailLevel,
      });

      const taskCategory = routeDecision.taskCategory;
      const structuredInstructions =
        this.structuredOutputService.buildStructuredOutputInstructions();
      const enrichedSystemPrompt = systemPrompt.includes('=== RESPONSE FORMAT ===')
        ? systemPrompt
        : `${systemPrompt}\n\n${structuredInstructions}`;

      // W11-CORTEX-MEMORY-COGNITION review SEC-W11MC-1 (D-130): read for the requester, as chatMemoryFragments is.
      const memoryContext = await this.promptContextService.buildMemoryContext(
        query.businessId,
        session,
        query.userId,
      );
      const messages = this.promptContextService.buildMessages(
        query,
        contextSnapshot,
        enrichedSystemPrompt,
        session,
        memoryContext,
      );

      const baseTemperature =
        routeDecision.temperatureOverride ?? personalityConfig.temperature;
      const effectiveTemperature = Math.max(
        0,
        Math.min(2, baseTemperature + toneInfo.temperatureAdjustment),
      );

      const completionResult = await this.modelGateway.complete({
        businessId: query.businessId,
        taskCategory,
        messages,
        temperature: effectiveTemperature,
        maxTokens: routeDecision.maxTokensOverride ?? this.MAX_CONTEXT_TOKENS,
        tools: routeDecision.includeActions
          ? (this.toolRegistry?.buildGatewayDefinitions() ??
             ((await this.actionsService.buildToolDefinitions(
               query.businessId,
             )) as unknown as GatewayToolDefinition[]))
          : undefined,
        responseFormat: { type: 'text' },
      });

      // W10-CORTEX-CHAT-SCOPE review SEC-W10CCS-R1 (D-71, D-57): the model's tool calls run only as far
      // as the member may run them (memberToolLoop).
      const toolLoopResult = await this.memberToolLoop(completionResult, query, 'processQuery', correlationId, (screened) =>
        this.toolLoopService.handleToolCalls(
          screened,
          messages,
          query,
          {
            ...routeDecision,
            temperatureOverride: effectiveTemperature,
          },
          personalityConfig,
          taskCategory,
          turnIdentity,
          this.MAX_CONTEXT_TOKENS,
        ),
      );

      const latencyMs = Date.now() - startTime;
      const provider = completionResult.provider as CortexProvider;
      const model = completionResult.model;

      const structured = this.structuredOutputService.parseStructuredResponse(
        completionResult.content ?? '',
      );

      const finalContent =
        toolLoopResult?.content ??
        structured.recommendation ??
        completionResult.content ??
        '';

      if (this.qualityService) {
        try {
          const quality = await this.qualityService.checkQuality({
            text: finalContent,
            taskCategory,
          });
          if (!quality.acceptable) {
            this.logger.warn(
              `[processQuery][${correlationId}] Quality issues detected: ${quality.issues.join(', ')}`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Quality check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const assistantMessage: CortexMessage = {
        id: this.sessionService.generateId(),
        role: 'assistant',
        content: finalContent,
        timestamp: new Date(),
        metadata: {
          provider,
          model,
          tokensUsed: completionResult.usage?.totalTokens ?? 0,
          cost: completionResult.usage?.estimatedCost ?? 0,
          latencyMs,
          mood: query.mood ?? this.moodDetectionService.detectMood(query.text),
          correlationId,
          genomeEnriched: flags.genomeV3Enabled && !!genomeContext,
          role: structured.role,
          confidence: Math.max(
            0,
            Math.min(1, (structured.confidence ?? 70) / 100),
          ),
          taskCategory,
          fallbackUsed: completionResult.fallbackUsed,
          fallbackProvider: completionResult.fallbackProvider,
        } as any,
      };

      await this.logEvent(correlationId, 'STEP_8_AI_REASONING', {
        provider,
        model,
        taskCategory,
        tokensUsed: completionResult.usage?.totalTokens ?? 0,
        latencyMs,
        fallbackUsed: completionResult.fallbackUsed,
        fallbackProvider: completionResult.fallbackProvider,
      });

      await this.sessionService.updateSessionCognitionMetadata(session.id, {
        detectedRole: structured.role,
        detectedFunction: taskCategory,
        layersUsed: routeDecision.layers,
        llmCallsMade: 1,
        responseTimeMs: latencyMs,
      });

      await this.sessionService.updateRunningSummary(
        session.id,
        query.text,
        assistantMessage.content,
      );

      if (this.learningService) {
        try {
          await this.learningService.recordObservation({
            sessionId: session.id,
            businessId: query.businessId,
            userId: query.userId,
            roleId: session.detectedRole,
            functionId: session.detectedFunction,
            query: query.text,
            recommendation: assistantMessage.content,
            confidence: assistantMessage.metadata?.confidence ?? 0.7,
            metadata: {
              correlationId,
              taskCategory,
              provider,
              model,
            },
          });
        } catch (err: any) {
          this.logger.warn(
            `[processQuery] Learning observation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const structuredResponseFields = {
        role: structured.role,
        analysis: structured.analysis,
        hiddenSignals: structured.hiddenSignals,
        risks: structured.risks,
        successMetrics: structured.successMetrics,
        nextStep: structured.nextStep,
        frameworks: structured.frameworks,
      };

      let executedActions: CortexActionResult[] = toolLoopResult?.actions ?? [];

      if (query.enableActions && executedActions.length === 0) {
        const toParsedConnectorCommand = (
          cmd: (typeof parsedCommands)[number],
        ): ConnectorCommand =>
          this.commandService!.toConnectorCommand(
            {
              intent: cmd.action,
              confidence: 0.95,
              module: cmd.module as any,
              action: cmd.action,
              parameters: cmd.parameters,
              requiresApproval: cmd.requiresApproval,
              naturalLanguage: cmd.naturalLanguage,
            },
            query.businessId,
            query.userId,
          );

        if (
          flags.integrationV2Enabled &&
          this.executorService &&
          autonomyCheckedCommands.length > 0
        ) {
          try {
            const connectorCommands = autonomyCheckedCommands.map(
              toParsedConnectorCommand,
            );

            // BatchResult is an object with nested ExecutionRecord results.
            // Never run legacy actions after the v2 executor may have written.
            const batch = await this.executorService.executeBatch(
              connectorCommands,
              { sourceInfo: { businessId: query.businessId, userId: query.userId } },
            );
            executedActions = mapCortexBatchResult(batch);
            if (batch.stoppedEarly) {
              this.logger.warn(`[processQuery][${correlationId}] v2 batch stopped early; trailing commands were not attempted`);
            }

            assistantMessage.metadata!.actionsTriggered = executedActions;
            this.logger.log(
              `[processQuery][${correlationId}] v2 executed ${executedActions.length} command(s)`,
            );
          } catch (err: any) {
            this.logger.error(
              `[processQuery][${correlationId}] v2 execution failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            // Result-shaping failures occur after possible effects. Do not
            // retry through another executor without inspecting the audit.
            executedActions = [unverifiedCortexBatchAction()];
            assistantMessage.metadata!.actionsTriggered = executedActions;
          }
        } else if (parsedCommands.length === 0 && autonomyCheckError === null) {
          // V1-02 review repair (SEC-V102-1): the legacy route (actions the
          // completion names, through actionsService.executeActions and its
          // own, weaker gate) is taken only when no parsed command was put to
          // the authority. Once one was, whatever the authority decided
          // (approved, denied, approval required, or failed closed) is final
          // for this turn and nothing else executes.
          const detectedActions = query.enableActions
            ? this.actionDetectionService.detectActions(completionResult.content ?? '')
            : [];

          if (detectedActions.length > 0 && query.enableActions) {
            executedActions = await this.actionsService.executeActions(
              detectedActions,
              session as any,
            );
            assistantMessage.metadata!.actionsTriggered = executedActions;
          }
        }

        // V1-02 review repair (CR-V102-1, SEC-V102-2): every parsed command the
        // gate kept from the executor is settled without executing it. An
        // approval request is reported with the response; a refusal is
        // audited and recorded by STEP_5, and is not reported as an action
        // because no proposal for it was ever shown to the client.
        if (flags.integrationV2Enabled && this.executorService) {
          const pendingApprovals = (
            await this.settleUnexecutedCommands(
              parsedAutonomy.decisions
                .filter((decision) => decision.disposition !== 'executable')
                .map((decision) => ({
                  ...decision,
                  command: toParsedConnectorCommand(decision.command),
                })),
              correlationId,
              'processQuery',
            )
          ).filter((action) => action.status === 'pending_approval');
          if (pendingApprovals.length > 0) {
            executedActions = [...executedActions, ...pendingApprovals];
            assistantMessage.metadata!.actionsTriggered = executedActions;
          }
        }
      }

      await this.logEvent(correlationId, 'STEP_9_EXECUTE_ACTIONS', {
        actionsExecuted: executedActions.length,
        actionResults: executedActions.map((a: any) => ({
          actionType: a.actionType,
          status: a.status,
        })),
      });

      if (flags.genomeV3Enabled && this.genomeBridgeService) {
        try {
          for (const action of executedActions) {
            await (this.genomeBridgeService as any).reportActionOutcome(
              query.businessId,
              {
                actionId: action.actionType,
                status: action.status,
                description: action.description,
                result: action.result ?? {},
                timestamp: new Date(),
                correlationId,
              },
            );
          }

          const successfulActions = executedActions.filter(
            (a: any) => a.status === 'success',
          );
          for (const action of successfulActions) {
            await (this.genomeBridgeService as any).createEvidence(
              query.businessId,
              {
                type: 'action_outcome',
                description: `KEY executed ${action.actionType}: ${action.description}`,
                source: 'key_cortex',
                metadata: {
                  correlationId,
                  actionType: action.actionType,
                  result: action.result,
                },
              },
            );
          }

          this.logger.log(
            `[processQuery][${correlationId}] Reported ${executedActions.length} action outcomes to genome`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Genome outcome reporting failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_10_REPORT_OUTCOMES', {
        outcomesReported: executedActions.length,
        genomeEnabled: flags.genomeV3Enabled,
      });

      const suggestions = await this.suggestionService.generateSuggestions(
        query.businessId,
        assistantMessage.content,
        v2Context,
        flags.integrationV2Enabled,
      );

      let proactiveSuggestions: Suggestion[] = [];
      if (flags.genomeV3Enabled && genomeContext) {
        try {
          const shouldProactive =
            await this.genomeContextService.shouldSuggestProactiveAction(
              query.businessId,
            );
          if (shouldProactive) {
            proactiveSuggestions =
              await this.genomeContextService.getProactiveSuggestions(
                query.businessId,
                flags.integrationV2Enabled,
              );
            this.logger.log(
              `[processQuery][${correlationId}] Generated ${proactiveSuggestions.length} proactive suggestions`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Proactive suggestions failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_11_GENERATE_RESPONSE', {
        suggestionsCount: suggestions.length,
        proactiveSuggestionsCount: proactiveSuggestions.length,
      });

      await this.sessionService.saveMessage(session.id, {
        role: 'user',
        content: query.text,
        timestamp: new Date(),
      });
      await this.sessionService.saveMessage(session.id, assistantMessage);

      await this.logEvent(correlationId, 'STEP_12_LOG_COMPLETE', {
        sessionId: session.id,
        totalLatencyMs: Date.now() - startTime,
        messageId: assistantMessage.id,
      });

      if (this.proactive) {
        try {
          const proactiveCheck = await (this.proactive as any).shouldAct(
            session.businessId,
          );
          if (proactiveCheck.shouldAct) {
            proactiveSuggestions = proactiveCheck.suggestions;
            this.logger.log(
              `[processQuery][${correlationId}] Proactive actions triggered: ${proactiveSuggestions.length} suggestion(s)`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Proactive check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let explanation: any;
      if (this.trustExplanation && executedActions.length > 0) {
        try {
          const firstAction = executedActions[0];
          explanation = await (this.trustExplanation as any).explain(
            firstAction.actionType,
            firstAction.result ?? {},
            contextSnapshot,
            null,
            firstAction.status === 'success',
            firstAction.requiresApproval ?? false,
          );
          this.logger.log(
            `[processQuery][${correlationId}] Trust explanation generated for ${firstAction.actionType}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Trust explanation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_13_14_COMPLETION_LAYER', {
        proactiveSuggestions: proactiveSuggestions.length,
        hasExplanation: !!explanation,
      });

      let calibratedConfidence =
        assistantMessage.metadata?.confidence ??
        this.calculateConfidence(assistantMessage.content, contextSnapshot);
      let knowledgeGap: string | undefined;
      if (this.learningService) {
        try {
          const calibration = await this.learningService.calibrateConfidence(
            calibratedConfidence,
            query.businessId,
            {
              roleId: session.detectedRole,
              functionId: session.detectedFunction,
            },
          );
          calibratedConfidence = calibration.calibrated;
          knowledgeGap = calibration.knowledgeGap;
        } catch (err: any) {
          this.logger.warn(
            `[processQuery] Confidence calibration failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `[processQuery][${correlationId}] Completed in ${latencyMs}ms | provider=${provider} model=${model} tokens=${assistantMessage.metadata?.tokensUsed} commands=${parsedCommands.length} autonomyApproved=${autonomyCheckedCommands.length} executed=${executedActions.length} genome=${flags.genomeV3Enabled && !!genomeContext}`,
      );

      return {
        message: assistantMessage,
        actions: executedActions,
        contextUsed: contextSnapshot,
        suggestions,
        followUpQuestions: suggestions.slice(0, 3),
        confidence: calibratedConfidence,
        ...structuredResponseFields,
        proactiveSuggestions:
          proactiveSuggestions.length > 0 ? proactiveSuggestions : undefined,
        explanation: explanation ?? undefined,
        knowledgeGap,
        genomeInsights: genomeContext
          ? {
              dnaScores: genomeContext.dnaScores,
              stage: genomeContext.genomeStage,
              topRecommendation: rankedRecommendations[0] ?? null,
              urgentSignals: genomeContext.signals.filter(
                (s: any) => s.severity === 'critical' || s.severity === 'high',
              ),
              proactiveSuggestions: proactiveSuggestions.slice(0, 3),
            }
          : undefined,
      } as CortexResponse;
    } catch (error: any) {
      this.logger.error(
        `[processQuery][${correlationId}] Failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.logEvent(correlationId, 'PROCESS_QUERY_ERROR', {
        error: error instanceof Error ? error.message : String(error),
        businessId: query.businessId,
        userId: query.userId,
      });

      throw new ServiceUnavailableException(
        `KEY Cortex reasoning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async *streamQuery(
    query: CortexQuery,
    flags: { integrationV2Enabled: boolean; genomeV3Enabled: boolean },
  ): AsyncGenerator<CortexStreamChunk> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    this.logger.log(
      `[streamQuery][${correlationId}] business=${query.businessId} user=${query.userId} stream=true v2=${flags.integrationV2Enabled} v3=${flags.genomeV3Enabled}`,
    );

    const safetyCheck = await this.runSafetyCheck(query.text, query.businessId, correlationId);
    if (safetyCheck?.blocked) {
      yield { type: 'text_delta', content: this.buildBlockedMessage(safetyCheck.reason) };
      yield { type: 'done' };
      return;
    }

    try {
      const session = await this.sessionService.getOrCreateSession(query);

      let turnIdentity:
        | {
            correlationId: string;
            sessionId: string;
            commandId: string;
            businessId: string;
            userId?: string | null;
          }
        | undefined;
      if (this.lifecycle) {
        try {
          const { identity } = await this.lifecycle.startTurn({
            businessId: query.businessId,
            userId: query.userId,
            sessionId: session.id,
            rawInput: query.text,
            mode: query.enableActions ? 'do' : 'ask',
            persona: query.persona,
            provider: query.provider,
          });
          turnIdentity = identity;
        } catch (err: any) {
          this.logger.warn(
            `[streamQuery][${correlationId}] Lifecycle startTurn failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const routeDecision: RouteDecision = this.adaptiveRouter
        ? await this.adaptiveRouter.route(query, session, session.messages.slice(-10))
        : {
            taskCategory: this.structuredOutputService.classifyTaskCategory(query),
            layers: ['reasoning', 'ethics'],
            promptVariant: 'standard',
            includeGenomeContext: true,
            includeMemoryContext: true,
            includeActions: query.enableActions ?? false,
            complexity: 'moderate',
            domain: 'general',
            urgency: 'low',
            emotionalWeight: 'low',
            timeHorizon: 'tactical',
            dataRequirement: 'none',
          };

      let genomeContext: GenomeEnrichedContext | null = null;
      if (
        routeDecision.includeGenomeContext &&
        flags.genomeV3Enabled &&
        this.genomeBridgeService
      ) {
        try {
          genomeContext = await this.genomeContextService.getGenomeEnrichedContext(
            query.businessId,
          );
        } catch {
          // Non-critical
        }
      }

      const contextSnapshot =
        await this.contextService.buildContextSnapshot(query.businessId);

      let v2Context: any;
      if (flags.integrationV2Enabled && this.contextV2Service) {
        try {
          v2Context = await this.contextV2Service.getFullContext(query.businessId);
          this.systemPromptService.enrichSnapshotFromV2(contextSnapshot, v2Context);
        } catch {
          // Non-critical
        }
      }

      if (genomeContext) {
        this.systemPromptService.enrichSnapshotFromGenome(
          contextSnapshot,
          genomeContext,
        );
      }

      let detectedPersona: CortexPersona | undefined;
      if (!query.persona) {
        try {
          detectedPersona =
            (await this.personalityService.classifyPersona(
              query.text,
              query.businessId,
            )) ?? undefined;
        } catch (err: any) {
          this.logger.warn(
            `[streamQuery][${correlationId}] Persona classification failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const persona: CortexPersona =
        query.persona ?? detectedPersona ?? session.persona ?? 'jarvis';
      const personalityConfig =
        this.personalityService.getPersonalityConfig(persona);

      let toneInfo: { tone: string; temperatureAdjustment: number } = {
        tone: '',
        temperatureAdjustment: 0,
      };
      try {
        toneInfo = await this.personalityService.selectTone(
          query.text,
          persona,
          query.mood,
        );
      } catch (err: any) {
        this.logger.warn(
          `[streamQuery][${correlationId}] Tone selection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let systemPrompt: string;
      if (flags.genomeV3Enabled && genomeContext) {
        systemPrompt = this.systemPromptService.buildV3SystemPrompt(
          persona,
          contextSnapshot,
          v2Context,
          genomeContext,
          genomeContext.recommendations.slice(0, 5),
          false,
        );
      } else if (flags.integrationV2Enabled) {
        systemPrompt = this.systemPromptService.buildV2SystemPrompt(
          persona,
          contextSnapshot,
          v2Context,
          false,
        );
      } else {
        systemPrompt = this.personalityService.buildSystemPrompt(
          persona,
          contextSnapshot,
        );
      }

      const taskCategory = routeDecision.taskCategory;
      const structuredInstructions =
        this.structuredOutputService.buildStructuredOutputInstructions();
      let enrichedSystemPrompt = systemPrompt.includes('=== RESPONSE FORMAT ===')
        ? systemPrompt
        : `${systemPrompt}\n\n${structuredInstructions}`;

      enrichedSystemPrompt += `\nUse a ${routeDecision.promptVariant} reasoning style.`;
      enrichedSystemPrompt += `\nActive reasoning layers: ${routeDecision.layers.join(', ')}.`;
      if (toneInfo.tone) {
        enrichedSystemPrompt += `\nAdopt a ${toneInfo.tone} tone.`;
      }

      let streamMemoryFragments: MemoryFragment[] = [];
      if (routeDecision.includeMemoryContext && this.memoryRetrieval) {
        try {
          streamMemoryFragments = await this.chatMemoryFragments(query);
        } catch {
          // Non-critical
        }
      }

      if (streamMemoryFragments.length > 0) {
        enrichedSystemPrompt += `\n\n${this.formatMemoryContextBlock(streamMemoryFragments)}`;
      }

      const baseTemperature =
        routeDecision.temperatureOverride ?? personalityConfig.temperature;
      const effectiveTemperature = Math.max(
        0,
        Math.min(2, baseTemperature + toneInfo.temperatureAdjustment),
      );

      // W11-CORTEX-MEMORY-COGNITION review SEC-W11MC-1 (D-130): read for the requester, as chatMemoryFragments is.
      const memoryContext = await this.promptContextService.buildMemoryContext(
        query.businessId,
        session,
        query.userId,
      );
      const messages = this.promptContextService.buildMessages(
        query,
        contextSnapshot,
        enrichedSystemPrompt,
        session,
        memoryContext,
      );

      yield {
        type: 'thought',
        thought: genomeContext
          ? `Analyzing genome-aware context for ${contextSnapshot.genomeStage} stage business — ${genomeContext.signals.length} active signals, ${genomeContext.recommendations.length} recommendations available...`
          : `Analyzing context for ${contextSnapshot.genomeStage} stage business${flags.integrationV2Enabled ? ' with full module awareness' : ''}...`,
      };

      let accumulatedText = '';
      let finalProvider: CortexProvider = query.provider ?? 'openai';
      let finalModel = '';
      let fallbackUsed = false;
      let fallbackProvider: string | undefined;

      const stream = this.modelGateway.streamComplete({
        businessId: query.businessId,
        taskCategory,
        messages,
        temperature: effectiveTemperature,
        maxTokens: routeDecision.maxTokensOverride ?? this.MAX_CONTEXT_TOKENS,
        tools: routeDecision.includeActions
          ? (this.toolRegistry?.buildGatewayDefinitions() ??
             ((await this.actionsService.buildToolDefinitions(
               query.businessId,
             )) as unknown as GatewayToolDefinition[]))
          : undefined,
      });

      const toolCallBuffers = new Map<
        number,
        { id?: string; name?: string; arguments: string }
      >();

      for await (const chunk of stream) {
        if (chunk.provider) finalProvider = chunk.provider as CortexProvider;
        if (chunk.model) finalModel = chunk.model;
        if (chunk.fallbackUsed !== undefined) fallbackUsed = chunk.fallbackUsed;
        if (chunk.fallbackProvider) fallbackProvider = chunk.fallbackProvider;

        if (chunk.content) {
          accumulatedText += chunk.content;
          yield {
            type: 'text_delta',
            content: chunk.content,
          };
        }

        if (chunk.toolCall) {
          const { index, id, name, argumentsDelta } = chunk.toolCall;
          let entry = toolCallBuffers.get(index);
          if (!entry) {
            entry = { arguments: '' };
            toolCallBuffers.set(index, entry);
          }
          if (id) entry.id = id;
          if (name) entry.name = name;
          if (argumentsDelta) entry.arguments += argumentsDelta;

          if (entry.name) {
            let params: Record<string, unknown> = {};
            try {
              params = JSON.parse(entry.arguments);
            } catch {
              params = { raw: entry.arguments };
            }
            yield {
              type: 'tool_call',
              toolCall: {
                name: entry.name,
                params,
              },
            };
          }
        }

        if (chunk.error) {
          yield {
            type: 'error',
            error: chunk.error,
          };
        }
      }

      // Execute any streamed tool calls through the same autonomy-checked helper
      // used by the non-streaming path.
      const collectedToolCalls = Array.from(toolCallBuffers.entries())
        .filter(([, tc]) => tc.name)
        .map(([index, tc]) => ({
          id: tc.id ?? `tc_${index}`,
          type: 'function' as const,
          function: {
            name: tc.name!,
            arguments: tc.arguments,
          },
        }));

      if (collectedToolCalls.length > 0 && this.toolLoopService) {
        try {
          // W10-CORTEX-CHAT-SCOPE review SEC-W10CCS-R1 (D-71, D-57): as processQuery (memberToolLoop).
          const toolLoopResult = await this.memberToolLoop({ toolCalls: collectedToolCalls }, query, 'streamQuery', correlationId, (screened) =>
            this.toolLoopService.handleToolCalls(
              screened,
              messages,
              query,
              {
                ...routeDecision,
                temperatureOverride: effectiveTemperature,
              },
              personalityConfig,
              taskCategory,
              turnIdentity,
              this.MAX_CONTEXT_TOKENS,
            ),
          );

          if (toolLoopResult?.content) {
            accumulatedText += `\n\n${toolLoopResult.content}`;
            yield {
              type: 'text_delta',
              content: toolLoopResult.content,
            };
          }

          for (const action of toolLoopResult?.actions ?? []) {
            yield {
              type: 'action_delta',
              action: {
                actionType: action.actionType,
                description: action.description,
                status: action.status,
              },
            };
          }
        } catch (err: any) {
          this.logger.warn(
            `[streamQuery][${correlationId}] Tool loop execution failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (this.qualityService && accumulatedText.length > 0) {
        try {
          const quality = await this.qualityService.checkQuality({
            text: accumulatedText,
            taskCategory,
          });
          if (!quality.acceptable) {
            this.logger.warn(
              `[streamQuery][${correlationId}] Quality issues detected: ${quality.issues.join(', ')}`,
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `[streamQuery][${correlationId}] Quality check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const detectedActions = query.enableActions
        ? this.actionDetectionService.detectActions(accumulatedText)
        : [];

      if (detectedActions.length > 0) {
        for (const action of detectedActions) {
          yield {
            type: 'action_delta',
            action: {
              actionType: action.actionType,
              description: action.description,
              status: action.status,
              estimatedImpact: action.estimatedImpact,
            },
          };
        }

        let executedActions: CortexActionResult[] = [];
        if (flags.integrationV2Enabled && this.executorService) {
          // V1-02: the commands parsed from the model's text pass the same
          // fail-closed autonomy evaluation as processQuery's before anything
          // reaches the executor. An evaluation that throws, or a verdict that
          // is not usable, leaves none executable; nothing falls back to the
          // legacy executor.
          const detectedCommands = detectedActions.map((a) => ({
            module: 'autopilot' as const,
            action: a.actionType.toLowerCase(),
            parameters: { description: a.description } as Record<string, unknown>,
            requiresApproval: a.requiresApproval === true,
          }));
          const streamAutonomy = await this.evaluateParsedCommandAutonomy(
            detectedCommands,
            query,
            session,
            flags,
            correlationId,
            'streamQuery',
          );
          const { executable } = streamAutonomy;
          // V1-02 review repair (SEC-V102-2): the stream's autonomy outcome is
          // evidenced like processQuery's STEP_5_CHECK_AUTONOMY.
          await this.logEvent(
            correlationId,
            'STREAM_CHECK_AUTONOMY',
            this.autonomyEvidence(detectedCommands.length, streamAutonomy),
          );
          const toStreamConnectorCommand = (
            cmd: (typeof detectedCommands)[number],
          ): ConnectorCommand => ({
            module: cmd.module,
            action: cmd.action,
            parameters: cmd.parameters,
            businessId: query.businessId,
            userId: query.userId,
            source: 'key_cortex' as const,
            timestamp: new Date(),
            correlationId,
          });
          if (executable.length > 0) {
            try {
              const connectorCommands = executable.map(toStreamConnectorCommand);
              const batch = await this.executorService.executeBatch(
                connectorCommands,
                { sourceInfo: { businessId: query.businessId, userId: query.userId } },
              );
              executedActions = mapCortexBatchResult(batch);
              if (batch.stoppedEarly) {
                this.logger.warn(`[streamQuery][${correlationId}] v2 batch stopped early; trailing commands were not attempted`);
              }

              if (flags.genomeV3Enabled && this.genomeBridgeService) {
                for (const action of executedActions) {
                  await (this.genomeBridgeService as any).reportActionOutcome(
                    query.businessId,
                    {
                      actionId: action.actionType,
                      status: action.status,
                      description: action.description,
                      result: action.result ?? {},
                      timestamp: new Date(),
                      correlationId,
                    },
                  );
                }
              }
            } catch (err: unknown) {
              // A completed v2 batch must never be replayed by a legacy backend
              // because result shaping, audit or reporting raised an exception.
              this.logger.error(
                `[streamQuery][${correlationId}] v2 batch outcome unavailable: ${err instanceof Error ? err.message : String(err)}`,
              );
              if (executedActions.length === 0) {
                executedActions = [unverifiedCortexBatchAction()];
              }
            }
          }

          // V1-02 review repair (CR-V102-1, SEC-V102-2): every detected action
          // the gate kept from the executor is settled without executing it
          // (an approval request through the executor's approval flow, or an
          // audited refusal), so each detection-time proposal above gets a
          // follow-up delta backed by a real record.
          executedActions = [
            ...executedActions,
            ...(await this.settleUnexecutedCommands(
              streamAutonomy.decisions
                .filter((decision) => decision.disposition !== 'executable')
                .map((decision) => ({
                  ...decision,
                  command: toStreamConnectorCommand(decision.command),
                })),
              correlationId,
              'streamQuery',
            )),
          ];
        } else {
          executedActions = await this.actionsService.executeActions(
            detectedActions,
            session as any,
          );
        }

        for (const result of executedActions) {
          yield {
            type: 'action_delta',
            action: {
              actionType: result.actionType,
              description: result.description,
              status: result.status,
              ...(result.approvalRequestId
                ? { approvalRequestId: result.approvalRequestId }
                : {}),
            },
          };
        }
      }

      if (genomeContext && genomeContext.signals.length > 0) {
        const urgentSignals = genomeContext.signals.filter(
          (s: any) => s.severity === 'critical' || s.severity === 'high',
        );
        if (urgentSignals.length > 0) {
          yield {
            type: 'thought',
            thought: `Genome alert: ${urgentSignals.length} signal(s) requiring attention — ${urgentSignals.map((s: any) => s.message).join('; ')}`,
          };
        }
      }

      const structured =
        this.structuredOutputService.parseStructuredResponse(accumulatedText);

      const latencyMs = Date.now() - startTime;
      const assistantMessage: CortexMessage = {
        id: this.sessionService.generateId(),
        role: 'assistant',
        content: structured.recommendation || accumulatedText,
        timestamp: new Date(),
        metadata: {
          provider: finalProvider,
          model: finalModel,
          latencyMs,
          mood: query.mood ?? this.moodDetectionService.detectMood(query.text),
          correlationId,
          genomeEnriched: flags.genomeV3Enabled && !!genomeContext,
          role: structured.role,
          confidence: Math.max(
            0,
            Math.min(1, (structured.confidence ?? 70) / 100),
          ),
          taskCategory,
          fallbackUsed,
          fallbackProvider,
        } as any,
      };

      await this.sessionService.saveMessage(session.id, {
        role: 'user',
        content: query.text,
        timestamp: new Date(),
      });
      await this.sessionService.saveMessage(session.id, assistantMessage);

      await this.sessionService.updateSessionCognitionMetadata(session.id, {
        detectedRole: structured.role,
        detectedFunction: taskCategory,
        layersUsed: ['emotion', 'reasoning', 'context', 'ethics'],
        llmCallsMade: 1,
        responseTimeMs: latencyMs,
      });

      await this.logEvent(correlationId, 'STREAM_QUERY_COMPLETE', {
        sessionId: session.id,
        provider: finalProvider,
        model: finalModel,
        taskCategory,
        latencyMs,
        tokens: accumulatedText.length / 4,
        fallbackUsed,
        fallbackProvider,
      });

      this.logger.log(
        `[streamQuery][${correlationId}] Completed in ${latencyMs}ms | provider=${finalProvider} model=${finalModel} taskCategory=${taskCategory}`,
      );

      yield { type: 'done' };
    } catch (error: any) {
      this.logger.error(
        `[streamQuery][${correlationId}] Failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.logEvent(correlationId, 'STREAM_QUERY_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });

      yield {
        type: 'error',
        error: `Streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private async logEvent(
    correlationId: string,
    step: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (this.eventService) {
      try {
        await (this.eventService as any).logEvent({
          correlationId,
          step,
          data,
          timestamp: new Date(),
          service: 'KeyCortexReasoningService',
        });
      } catch {
        // Non-critical
      }
    }
  }

  // ── Autonomy helpers ──────────────────────────────────────

  /**
   * Evaluate a batch of parsed commands against the autonomy authority
   * (KF-EXEC-AUTH-FAIL-CLOSED-001, #155; V1-02 applies it to both
   * processQuery and streamQuery). A command is executable only when its
   * verdict is usable, allowed, needs no approval, is not tier 'manual', and
   * the command itself needs no approval.
   *
   * Fail closed: nothing parsed is executable until the whole batch has been
   * evaluated. An authority error, or an unusable verdict, may only narrow the
   * executable set, never widen it: the batch is atomic, so commands approved
   * before the failure are not kept either.
   *
   * `decisions` names, per command and in order, what the authority made of
   * it (V1-02 review repair): 'executable'; 'approval_required' (allowed, but
   * the verdict or the command needs approval); 'denied'; or, when the check
   * failed, 'failed_closed' for every command of the batch.
   */
  private async evaluateParsedCommandAutonomy<
    C extends {
      module: string;
      action: string;
      parameters?: Record<string, unknown>;
      requiresApproval?: boolean;
    },
  >(
    commands: C[],
    query: CortexQuery,
    session: CortexSession,
    flags: { integrationV2Enabled: boolean; genomeV3Enabled: boolean },
    correlationId: string,
    path: 'processQuery' | 'streamQuery',
  ): Promise<{
    executable: C[];
    decisions: Array<ParsedCommandDecision<C>>;
    results: Record<string, AutonomyVerdict | AutonomyCheck>;
    error: string | null;
  }> {
    let executable: C[] = [];
    let decisions: Array<ParsedCommandDecision<C>> = [];
    const results: Record<string, AutonomyVerdict | AutonomyCheck> = {};
    let error: string | null = null;

    if (commands.length > 0) {
      try {
        const approvedCommands: C[] = [];
        const evaluated: Array<ParsedCommandDecision<C>> = [];

        for (const cmd of commands) {
          const actionKey = `${cmd.module}.${cmd.action}`;
          let autonomyCheck: AutonomyVerdict | AutonomyCheck;

          if (this.autonomyOrchestrator) {
            autonomyCheck = await this.autonomyOrchestrator.evaluateAction(
              query.businessId,
              actionKey,
              cmd.parameters ?? {},
              { proposedBy: query.userId, role: session.detectedRole },
            );
          } else if (flags.genomeV3Enabled && this.genomeBridgeService) {
            autonomyCheck = await this.genomeBridgeService.checkAutonomy(
              query.businessId,
              actionKey,
              cmd.parameters ?? {},
            );
          } else {
            autonomyCheck = {
              allowed: false,
              tier: 'manual',
              requiresApproval: true,
              reason: 'No autonomy oracle available',
            } as AutonomyCheck;
          }

          if (!this.isUsableAutonomyVerdict(autonomyCheck)) {
            throw new Error(`Unusable autonomy verdict for ${actionKey}`);
          }

          results[`${cmd.module}:${cmd.action}`] = autonomyCheck;

          const requiresApproval =
            ('requiresApproval' in autonomyCheck &&
              autonomyCheck.requiresApproval) ||
            ('tier' in autonomyCheck && autonomyCheck.tier === 'manual');
          const isAllowed =
            autonomyCheck.allowed &&
            !requiresApproval &&
            !cmd.requiresApproval;

          if (isAllowed) {
            approvedCommands.push(cmd);
          } else {
            this.logger.log(
              `[${path}][${correlationId}] Action ${actionKey} requires approval — autonomy: ${'reason' in autonomyCheck ? autonomyCheck.reason : ''}`,
            );
          }
          evaluated.push({
            command: cmd,
            disposition: isAllowed
              ? 'executable'
              : autonomyCheck.allowed
                ? 'approval_required'
                : 'denied',
            reason:
              autonomyCheck.reason ||
              (autonomyCheck.allowed
                ? 'Approval required'
                : 'Blocked by the autonomy authority'),
          });
        }

        // W10-CORTEX-CHAT-SCOPE (review SEC-W9MRK-3, owner ruling D-57): a command the authority
        // would run, or put up for approval, runs only for a member who may run it as a direct
        // command (memberCommandRefusals). A refused one is settled as 'denied' with its refusal,
        // before anything executes or is proposed. A member that cannot be read throws here, and
        // the whole batch fails closed in the catch below.
        const refusals = await this.memberCommandRefusals(
          evaluated
            .filter((decision) => decision.disposition !== 'denied')
            .map((decision) => decision.command),
          query,
        );
        for (const decision of evaluated) {
          const refusal = refusals.get(decision.command);
          if (refusal === undefined) continue;
          decision.disposition = 'denied';
          decision.reason = refusal;
          this.logger.warn(
            `[${path}][${correlationId}] Action ${decision.command.module}.${decision.command.action} refused for this member: ${refusal}`,
          );
        }

        executable = approvedCommands.filter((cmd) => !refusals.has(cmd));
        decisions = evaluated;
        this.logger.log(
          `[${path}][${correlationId}] Autonomy check: ${executable.length}/${commands.length} commands approved`,
        );
      } catch (err: unknown) {
        // The batch is atomic: commands approved before the failure are not
        // kept, because `executable` is only assigned above.
        error = err instanceof Error ? err.message : String(err);
        const reason = `Authority check failed closed; execution blocked for safety: ${error}`;
        decisions = commands.map((command) => ({
          command,
          disposition: 'failed_closed' as const,
          reason,
        }));
        this.logger.error(
          `[${path}][${correlationId}] Autonomy check failed, failing closed: ${executable.length}/${commands.length} parsed commands executable: ${error}`,
        );
      }
    }

    return { executable, decisions, results, error };
  }

  /**
   * W10-CORTEX-CHAT-SCOPE (review SEC-W9MRK-3; owner ruling D-57): why each of `commands` may not
   * run for the member the chat runs for, by the rule POST cortex/execute holds a direct command to
   * (cortexCommandRefusal: the action's own module write scope, the crm owner-only rule, a money
   * report's revenue:read, and deny by default for a module or an action the KEY capability registry
   * does not map or list). A parsed chat command, and a stream's detected action, run through the
   * same executor as a direct command (executeBatch); they ran after the autonomy authority alone, so
   * a member with revenue 'none' had finance.generate_pnl run and its P&L returned, and any member's
   * command ran whatever their module scopes.
   *
   * The member is read as CortexMemberAuthorityGuard reads it for that route (memberAuthority).
   * A requester with no membership in the business, who is no platform SUPER_ADMIN, has every
   * command refused (the guard refuses such a request: D-104, membership is the single rule). A read
   * that fails throws, so the caller fails the batch closed. No command, no read.
   */
  private async memberCommandRefusals<C extends { module: string; action: string }>(
    commands: C[],
    query: CortexQuery,
  ): Promise<Map<C, string>> {
    const refusals = new Map<C, string>();
    if (commands.length === 0) return refusals;
    // Loaded on use: the controller module imports this service's own consumers (the
    // reasoning service), so a top-level import would be a cycle.
    const { cortexCommandRefusal } = await import('./key-cortex.controller');
    const authority = await this.memberAuthority(query.businessId, query.userId);
    for (const command of commands) {
      const refusal = authority
        ? cortexCommandRefusal(authority, command.module, command.action)
        : `Not a member of this business: "${command.module}.${command.action}" runs only for a member of the business (D-104)`;
      if (refusal) refusals.set(command, refusal);
    }
    return refusals;
  }

  /**
   * W10-CORTEX-CHAT-SCOPE review SEC-W10CCS-R1 (owner rulings D-71, D-57, D-73, D-104): the tool loop of
   * a chat turn (processQuery and its stream path), run on the model's tool calls the member may run.
   * KeyCortexToolLoopService runs each call through the registry (registry.execute), which reads no
   * membership, and a bridged flow tool dispatches with no principal (CORTEX_BRIDGE), so a STAFF member
   * with revenue 'none' had finance_profit_and_loss answer the P&L (D-57) and crm_list_contacts read the
   * whole contact book, both of which a plan refuses that member. Each call is now held to the rule the
   * plan queue holds a plan's member to before it dispatches a tool (memberToolCallRefusals).
   *
   * A refused call reaches neither the tool loop nor the model's follow-up; it is reported 'blocked'
   * with its refusal, and the refusal is said in the answer. The calls the member may run go through
   * the tool loop as before. No tool call, or none refused: the tool loop gets the turn's completion
   * unchanged.
   */
  private async memberToolLoop<T extends { toolCalls?: unknown }>(
    completion: T,
    query: CortexQuery,
    path: 'processQuery' | 'streamQuery',
    correlationId: string,
    runToolLoop: (completion: T) => Promise<{ content: string; actions: CortexActionResult[] } | undefined>,
  ): Promise<{ content: string; actions: CortexActionResult[] } | undefined> {
    const calls: unknown[] = Array.isArray(completion?.toolCalls) ? completion.toolCalls : [];
    if (calls.length === 0) return runToolLoop(completion);
    const refusals = await this.memberToolCallRefusals(calls.map(toolCallName), query);
    if (refusals.size === 0) return runToolLoop(completion);

    const allowed = calls.filter((call) => !refusals.has(toolCallName(call)));
    const refused = calls.filter((call) => refusals.has(toolCallName(call)));
    const blocked: CortexActionResult[] = refused.map((call) => {
      const name = toolCallName(call);
      const refusal = refusals.get(name) as string;
      this.logger.warn(`[${path}][${correlationId}] Tool call ${name || '(no tool)'} refused for this member: ${refusal}`);
      return {
        actionType: (name ? name.toUpperCase().replace(/\./g, '_') : 'EXECUTE_TOOL') as CortexActionType,
        status: 'blocked',
        description: `Not run: ${refusal}`,
        error: refusal,
        requiresApproval: false,
      };
    });
    await this.logEvent(correlationId, path === 'processQuery' ? 'STEP_7B_TOOL_CALLS_REFUSED' : 'STREAM_TOOL_CALLS_REFUSED', {
      totalToolCalls: calls.length,
      refusedToolCalls: refused.map((call) => ({ tool: toolCallName(call), refusal: refusals.get(toolCallName(call)) })),
    });

    const note = refused.map((call) => `I did not run ${toolCallName(call) || 'a tool call'}: ${refusals.get(toolCallName(call))}`).join('\n');
    const ran = allowed.length > 0 ? await runToolLoop({ ...completion, toolCalls: allowed }) : undefined;
    if (!ran) return { content: note, actions: blocked };
    return { content: ran.content ? `${ran.content}\n\n${note}` : note, actions: [...ran.actions, ...blocked] };
  }

  /**
   * W10-CORTEX-CHAT-SCOPE review SEC-W10CCS-R1 (D-71, D-57, D-73, D-104): why the member the chat runs for
   * may not run each of the tools `names` (keyed by tool name), by memberToolRunAuthority with no
   * principal, the rule the plan queue applies to a plan's member (and the Pro Auto monitor to the
   * owner): every module scope of the tool (D-71; a money report's revenue:read, D-57), the OWNER for an
   * owner-only tool and for a contact read no visibility clause bounds (a bridged flow tool runs with no
   * principal), the CRM sub-permission, D-46 for a platform SUPER_ADMIN who is no member, and deny by
   * default for a tool the authority map does not map (a dotted organ or legacy cortex tool, such as
   * cortex.execute_tool, which runs any tool by name): only the business owner runs one. The owner (an
   * OWNER membership, D-116/D-125) with no explicit scope map runs every tool but those refused to everyone
   * (W11A-SEAM-REPAIR: the KEY connector reads included). A call that names no tool, and every
   * call of a requester with no user, is refused (D-104: membership is the single rule; a user with no
   * membership is refused by the rule itself). A read that fails refuses every call (fail closed).
   */
  private async memberToolCallRefusals(names: string[], query: CortexQuery): Promise<Map<string, string>> {
    const refusals = new Map<string, string>();
    const named = [...new Set(names)];
    if (named.includes('')) refusals.set('', 'A tool call that names no tool is not run');
    const tools = named.filter((name) => name !== '');
    if (tools.length === 0) return refusals;
    if (!query.userId) {
      for (const name of tools) refusals.set(name, `Not a member of this business: "${name}" runs only for a member of the business (D-104)`);
      return refusals;
    }
    try {
      // Loaded on use, as the plan queue's other callers load it: plan-step-authority imports
      // graph-actions.controller, which imports the flow orchestrator.
      const { memberToolRunAuthority } = await import('../ai/plan-step-authority');
      for (const name of tools) {
        const { refusal } = await memberToolRunAuthority(this.prisma, query.businessId, query.userId, name);
        if (refusal) refusals.set(name, refusal);
      }
    } catch (err: unknown) {
      const reason = `The member's authority could not be read, so the tool call is not run (failed closed): ${err instanceof Error ? err.message : String(err)}`;
      for (const name of tools) refusals.set(name, reason);
    }
    return refusals;
  }

  /**
   * W10-CORTEX-CHAT-SCOPE: the member a chat turn acts for, as CortexMemberAuthorityGuard loads it
   * for POST cortex/execute: a platform SUPER_ADMIN (its User role) keeps the bypass, a member only
   * of the businesses it holds a membership in (D-46); anyone else is its membership's role and
   * scopes, the explicit scope map or else the role's defaults (as ModuleScopeGuard computes them),
   * or null when it holds no membership. The chat routes run no such guard, so it is read here.
   */
  private async memberAuthority(businessId: string, userId: string | undefined): Promise<CortexMemberAuthority | null> {
    if (!userId) return null;
    const [user, membership] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId, businessId } },
        select: { role: true, permissionScopes: true },
      }),
    ]);
    if (user?.role === 'SUPER_ADMIN') {
      return { userId, businessId, role: 'SUPER_ADMIN', superAdmin: true, scopes: {}, member: !!membership };
    }
    if (!membership) return null;
    const explicit = membership.permissionScopes;
    const scopes: Record<string, string> =
      explicit && typeof explicit === 'object' && !Array.isArray(explicit)
        ? (explicit as Record<string, string>)
        : defaultScopesForRole(membership.role);
    return { userId, businessId, role: membership.role, superAdmin: false, scopes, member: true };
  }

  /**
   * W10-CORTEX-CHAT-SCOPE (W9-KEY-CORTEX-AUDIT residual; review SEC-W9KCA-2, CR-W9KCA-4): the memory
   * fragments a chat turn renders into its system prompt (processQuery and its stream path), read by
   * the rule KeyCortexPromptContextService.buildMemoryContext applies to the same prompt. The episodic
   * stores (AiExecutionLog and CortexActionLog: what someone asked KEY to do, tool answers included)
   * are the requesting member's own (MemoryRetrievalOptions.userId); a requester who is no member of
   * the business reads none (fail closed); and no KEY tool call's record is taken from the
   * business-wide stores (isToolCallRecord: another member's tool answer and typed input). The
   * business-wide stores are otherwise not narrowed. Both calls read every member's episodes before.
   *
   * Review SEC-W10CCS-R2: cognition memory (CognitionMemory) is a per-member store, read business-wide
   * by the retrieval service: processQuery writes one row on every turn (recordObservation: what the
   * member typed, verbatim, and KEY's whole answer to them, which can carry P&L figures another member
   * may not see under D-57). A cognition fragment is kept only when its row is the reader's own
   * (readersOwnCognitionMemory, shared with buildMemoryContext since W11-CORTEX-MEMORY-COGNITION); a
   * requester who is no member reads none.
   *
   * Review CR-W10CCS-1: by buildMemoryContext's whole rule, its headroom included: it asks for
   * CHAT_MEMORY_FRAGMENTS + CHAT_MEMORY_HEADROOM and keeps the first CHAT_MEMORY_FRAGMENTS of what it may
   * render, so an active business's recent tool-call records no longer leave the prompt with no memory.
   */
  private async chatMemoryFragments(query: CortexQuery): Promise<MemoryFragment[]> {
    if (!this.memoryRetrieval) return [];
    const reader = await this.episodicMemoryReader(query.businessId, query.userId);
    const fragments = (
      await this.memoryRetrieval.retrieveContext(query.businessId, {
        query: query.text,
        limit: CHAT_MEMORY_FRAGMENTS + CHAT_MEMORY_HEADROOM,
        ...(reader ? { userId: reader } : { includeEpisodic: false }),
      })
    ).filter((fragment) => !isToolCallRecord(fragment));
    // W11-CORTEX-MEMORY-COGNITION (D-130): the shared rule, which buildMemoryContext applies to the same prompt.
    const own = await readersOwnCognitionMemory(this.prisma, query.businessId, reader, fragments, this.logger, 'chatMemory');
    return fragments
      .filter((fragment) => fragment.sourceType !== 'cognition_memory' || own.has(fragment.id))
      .slice(0, CHAT_MEMORY_FRAGMENTS);
  }

  /**
   * W10-CORTEX-CHAT-SCOPE: the member whose episodic memory a chat prompt may read, by
   * buildMemoryContext's own predicate (BusinessGuard's userCanAccessBusiness): the requester when
   * they own the business or hold a membership in it, else nobody. No requester, a requester who is
   * no member (a platform SUPER_ADMIN passes BusinessGuard without one), or a check that cannot be
   * made: nobody, so no episodic memory is read.
   */
  private async episodicMemoryReader(businessId: string, userId: string | undefined): Promise<string | null> {
    if (!userId) return null;
    try {
      return (await userCanAccessBusiness(this.prisma, userId, businessId)) ? userId : null;
    } catch (err: unknown) {
      this.logger.warn(
        `[chatMemory][${businessId}] membership check failed, no episodic memory read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * The STEP_5_CHECK_AUTONOMY evidence of one evaluation. streamQuery logs the
   * same record as STREAM_CHECK_AUTONOMY (V1-02 review repair, SEC-V102-2).
   */
  private autonomyEvidence(
    totalCommands: number,
    evaluation: {
      executable: unknown[];
      results: Record<string, AutonomyVerdict | AutonomyCheck>;
      error: string | null;
    },
  ): Record<string, unknown> {
    return {
      totalCommands,
      approvedCommands: evaluation.executable.length,
      outcome:
        evaluation.error === null
          ? 'evaluated'
          : 'authority_check_failed_closed',
      authorityCheckFailed: evaluation.error !== null,
      authorityCheckError: evaluation.error,
      autonomyMap: Object.fromEntries(
        Object.entries(evaluation.results).map(([k, v]) => [k, v.allowed]),
      ),
    };
  }

  /**
   * Settle the commands the autonomy gate kept from the executor, without
   * executing any of them (V1-02 review repair, CR-V102-1 and SEC-V102-2):
   *
   *   - 'approval_required': the executor's own approval flow
   *     (executeWithApproval) records a pending proposal, as execute() does
   *     for an action that needs approval. Nothing runs until a human approves
   *     it. A request that cannot be created is a refusal, never an execution.
   *   - 'denied' and 'failed_closed': refused before execution.
   *
   * Each leaves one actor-attributed ai_execution_logs row through the
   * executor's logExecution, the row execute() writes for its own refusals and
   * approvals (R0-09e). A failed audit write is logged and never changes the
   * answer.
   */
  private async settleUnexecutedCommands(
    decisions: Array<ParsedCommandDecision<ConnectorCommand>>,
    correlationId: string,
    path: 'processQuery' | 'streamQuery',
  ): Promise<CortexActionResult[]> {
    const executor = this.executorService;
    const settled: CortexActionResult[] = [];
    if (!executor) return settled;

    for (const { command, disposition, reason } of decisions) {
      if (disposition === 'executable') continue;
      const startedAt = new Date();
      let recordId: string = randomUUID();
      let outcome: ConnectorResult;
      let display: CortexActionResult;

      if (disposition === 'approval_required') {
        try {
          const approval = await executor.executeWithApproval(command);
          recordId = approval.id;
          outcome = {
            success: false,
            data: { approvalStatus: approval.status },
            error: 'Approval pending',
            executionTimeMs: 0,
            command,
          };
          display = pendingApprovalCortexAction(command, approval.id);
        } catch (err: unknown) {
          const refusal = `Approval request could not be created; not executed: ${err instanceof Error ? err.message : String(err)}`;
          this.logger.error(
            `[${path}][${correlationId}] ${command.module}.${command.action}: ${refusal}`,
          );
          outcome = { success: false, error: refusal, executionTimeMs: 0, command };
          display = blockedCortexAction(command, refusal);
        }
      } else {
        outcome = { success: false, error: reason, executionTimeMs: 0, command };
        display = blockedCortexAction(command, reason);
      }

      try {
        await executor.logExecution({
          id: recordId,
          command,
          result: outcome,
          startedAt,
          finishedAt: new Date(),
          durationMs: 0,
          traceId: correlationId,
          rolledBack: false,
        });
      } catch (err: unknown) {
        this.logger.error(
          `[${path}][${correlationId}] Audit of unexecuted ${command.module}.${command.action} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      settled.push(display);
    }

    return settled;
  }

  /**
   * A verdict is usable only when it is an object that states every field the
   * execution decision reads: a boolean `allowed`, a boolean `requiresApproval`
   * and a recognized `tier`. Anything else (nothing returned, a string, a
   * truthy non-boolean, an `allowed` with the approval semantics left out) is
   * not an answer from the authority and must not be read as one: an omitted
   * `requiresApproval` or `tier` is not a statement that no approval is needed.
   */
  private isUsableAutonomyVerdict(verdict: unknown): boolean {
    if (typeof verdict !== 'object' || verdict === null) {
      return false;
    }
    const { allowed, requiresApproval, tier } = verdict as Record<
      string,
      unknown
    >;
    return (
      typeof allowed === 'boolean' &&
      typeof requiresApproval === 'boolean' &&
      (tier === 'manual' || tier === 'supervised' || tier === 'full')
    );
  }

  // ── Safety helpers ────────────────────────────────────────

  private async runSafetyCheck(
    text: string,
    businessId: string,
    correlationId: string,
  ): Promise<{ blocked: true; reason?: string } | undefined> {
    if (!this.qualityService) {
      return undefined;
    }
    try {
      const safety = await this.qualityService.checkSafety({
        text,
        businessId,
      });
      if (!safety.safe && safety.severity === 'high') {
        this.logger.warn(
          `[processQuery][${correlationId}] Safety blocked query: ${safety.reason}`,
        );
        await this.logEvent(correlationId, 'STEP_1A_SAFETY_BLOCKED', {
          reason: safety.reason,
          severity: safety.severity,
        });
        return { blocked: true, reason: safety.reason };
      }
    } catch (err: any) {
      this.logger.warn(
        `[processQuery][${correlationId}] Safety check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  }

  private buildBlockedMessage(reason?: string): string {
    return `I'm unable to process that request. ${reason ?? 'It was blocked by our safety system.'}`;
  }

  private buildBlockedResponse(
    correlationId: string,
    reason?: string,
  ): CortexResponse {
    return {
      message: {
        id: this.sessionService.generateId(),
        role: 'assistant',
        content: this.buildBlockedMessage(reason),
        timestamp: new Date(),
        metadata: { correlationId, safetyBlocked: true },
      },
      actions: [],
      contextUsed: undefined,
      suggestions: [],
      followUpQuestions: [],
      confidence: 0,
    } as CortexResponse;
  }

  private detectGoalIntent(text: string): { title: string; description?: string } | null {
    const lower = text.toLowerCase();
    const goalPatterns = [
      /(?:set|create|add|define)\s+(?:a\s+)?goal\s+(?:to|for)?\s*(.+)/i,
      /(?:my\s+)?goal\s+(?:is\s+)?(?:to\s+)?(.+)/i,
      /(?:make\s+a\s+plan\s+(?:to|for)\s+)(.+)/i,
      /(?:plan\s+(?:to|for)\s+)(.+)/i,
      /(?:objective|target|aim)\s+(?:is\s+)?(?:to\s+)?(.+)/i,
    ];

    for (const pattern of goalPatterns) {
      const match = lower.match(pattern);
      if (match?.[1]?.trim()) {
        const title = match[1].trim().replace(/[.!?]$/, '');
        return { title: title.charAt(0).toUpperCase() + title.slice(1), description: text };
      }
    }

    if (lower.includes('goal') && lower.length < 200) {
      return { title: text, description: text };
    }

    return null;
  }

  private buildGoalResponse(
    query: CortexQuery,
    session: CortexSession,
    goal: any,
    plan: any,
    correlationId: string,
    latencyMs: number,
  ): CortexResponse {
    const message: CortexMessage = {
      id: this.sessionService.generateId(),
      role: 'assistant',
      content: `I created the goal "${goal.title}" and built a ${plan.steps.length}-step plan. I'll start working on it for you.`,
      timestamp: new Date(),
      metadata: {
        goalId: goal.id,
        planId: plan.id,
        latencyMs,
      } as any,
    };

    return {
      message,
      actions: plan.steps.map((step: any, index: number) => ({
        actionType: `${step.module ?? 'general'}.${step.action}`.toUpperCase().replace(/\s+/g, '_') as CortexActionType,
        status: step.status ?? 'pending',
        description: step.description ?? `Step ${index + 1}: ${step.action}`,
      })),
      contextUsed: undefined,
      suggestions: ['Show me the plan details', 'Track goal progress'],
      followUpQuestions: ['Show me the plan details', 'Track goal progress'],
      confidence: 0.95,
    } as CortexResponse;
  }

  private formatMemoryContextBlock(fragments: MemoryFragment[]): string {
    const lines = ['=== RELEVANT MEMORY ==='];
    for (const f of fragments.slice(0, 10)) {
      const header = `[${f.sourceType}] ${f.title ?? 'Memory'}`;
      lines.push(`${header}: ${f.content ?? ''}`.trim());
    }
    return lines.join('\n');
  }

  private calculateConfidence(
    content: string,
    context: CortexContextSnapshot,
  ): number {
    let score = 0.7;

    if (content.includes('$') || content.includes('%')) score += 0.1;
    if (content.toLowerCase().includes(context.genomeStage.toLowerCase()))
      score += 0.05;
    if (content.length > 200) score += 0.05;

    if (content.length < 50) score -= 0.2;
    if (/I don't have|I cannot|I'm not sure/i.test(content)) score -= 0.15;

    return Math.min(Math.max(score, 0), 1);
  }

  private getCalmModeDetailLevel(
    session: { preferredDetail?: string; persona?: string },
  ): string {
    const preference = session.preferredDetail ?? 'auto';

    if (preference === 'simple' || preference === 'beginner') return 'simple';
    if (preference === 'detailed' || preference === 'intermediate')
      return 'detailed';
    if (preference === 'expert' || preference === 'advanced') return 'expert';

    const persona = session.persona ?? 'jarvis';
    if (persona === 'jarvis') return 'detailed';
    if (persona === 'executive') return 'simple';
    if (persona === 'analyst') return 'expert';

    return 'detailed';
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
