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
import { KeyCortexPromptContextService } from './key-cortex-prompt-context.service';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { KeyCortexActionDetectionService } from './key-cortex-action-detection.service';
import { KeyCortexStructuredOutputService } from './key-cortex-structured-output.service';
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
          const plan = await this.planner.createPlanFromGoal(goal.id, query.userId);
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
          memoryFragments = await this.memoryRetrieval.retrieveContext(
            query.businessId,
            { query: query.text, limit: 10 },
          );
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

      let autonomyCheckedCommands = parsedCommands;
      const autonomyResults: Record<string, AutonomyVerdict | AutonomyCheck> = {};

      if (parsedCommands.length > 0) {
        try {
          const approvedCommands: typeof parsedCommands = [];

          for (const cmd of parsedCommands) {
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
                requiresApproval: true,
                reason: 'No autonomy oracle available',
              } as AutonomyCheck;
            }

            autonomyResults[`${cmd.module}:${cmd.action}`] = autonomyCheck;

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
                `[processQuery][${correlationId}] Action ${actionKey} requires approval — autonomy: ${'reason' in autonomyCheck ? autonomyCheck.reason : ''}`,
              );
            }
          }

          autonomyCheckedCommands = approvedCommands;
          this.logger.log(
            `[processQuery][${correlationId}] Autonomy check: ${approvedCommands.length}/${parsedCommands.length} commands approved`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[processQuery][${correlationId}] Autonomy check failed, using all parsed commands: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_5_CHECK_AUTONOMY', {
        totalCommands: parsedCommands.length,
        approvedCommands: autonomyCheckedCommands.length,
        autonomyMap: Object.fromEntries(
          Object.entries(autonomyResults).map(([k, v]) => [k, v.allowed]),
        ),
      });

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

      if (memoryFragments.length > 0) {
        systemPrompt += `\n\n${this.formatMemoryContextBlock(memoryFragments)}`;
      }

      await this.logEvent(correlationId, 'STEP_7_BUILD_PROMPT', {
        promptLength: systemPrompt.length,
        genomeEnriched: flags.genomeV3Enabled && !!genomeContext,
        detailLevel,
      });

      const taskCategory = routeDecision.taskCategory;
      const structuredInstructions =
        this.structuredOutputService.buildStructuredOutputInstructions();
      const enrichedSystemPrompt = systemPrompt.includes('=== RESPONSE FORMAT ===')
        ? systemPrompt
        : `${systemPrompt}\n\n${structuredInstructions}`;

      const memoryContext = await this.promptContextService.buildMemoryContext(
        query.businessId,
        session,
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

      const toolLoopResult = await this.toolLoopService.handleToolCalls(
        completionResult,
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
        if (
          flags.integrationV2Enabled &&
          this.executorService &&
          autonomyCheckedCommands.length > 0
        ) {
          try {
            const connectorCommands = autonomyCheckedCommands.map((cmd: any) =>
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
              ),
            );

            const results = await (this.executorService as any).executeBatch(
              connectorCommands,
              { businessId: query.businessId, userId: query.userId },
            );

            executedActions = results.map((result: any) => ({
              actionType: (result.command.action
                .toUpperCase()
                .replace(/\s+/g, '_') ?? 'EXECUTE_TOOL') as CortexActionType,
              status: result.success ? 'success' : 'error',
              description: result.success
                ? `Executed ${result.command.action} on ${result.command.module}`
                : `Failed: ${result.error ?? 'Unknown error'}`,
              result: result.success
                ? (result.data as Record<string, unknown>)
                : undefined,
              error: result.error,
              requiresApproval: false,
            }));

            assistantMessage.metadata!.actionsTriggered = executedActions;
            this.logger.log(
              `[processQuery][${correlationId}] v2 executed ${executedActions.length} command(s)`,
            );
          } catch (err: any) {
            this.logger.error(
              `[processQuery][${correlationId}] v2 execution failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            const detectedActions = await this.actionDetectionService.detectActions(
              completionResult.content ?? '',
            );
            if (detectedActions.length > 0) {
              executedActions = await this.actionsService.executeActions(
                detectedActions,
                session as any,
              );
              assistantMessage.metadata!.actionsTriggered = executedActions;
            }
          }
        } else {
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
          streamMemoryFragments = await this.memoryRetrieval.retrieveContext(
            query.businessId,
            { query: query.text, limit: 10 },
          );
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

      const memoryContext = await this.promptContextService.buildMemoryContext(
        query.businessId,
        session,
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

        if (chunk.toolCall?.name) {
          let params: Record<string, unknown> = {};
          if ((chunk.toolCall as any).argumentsDelta) {
            try {
              params = JSON.parse((chunk.toolCall as any).argumentsDelta);
            } catch {
              params = { raw: (chunk.toolCall as any).argumentsDelta };
            }
          }
          yield {
            type: 'tool_call',
            toolCall: {
              name: chunk.toolCall.name,
              params,
            },
          };
        }

        if (chunk.error) {
          yield {
            type: 'error',
            error: chunk.error,
          };
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
          try {
            const connectorCommands = detectedActions.map((a: any) => ({
              module: 'autopilot' as any,
              action: a.actionType.toLowerCase(),
              parameters: { description: a.description },
              businessId: query.businessId,
              userId: query.userId,
              source: 'key_cortex' as const,
              timestamp: new Date(),
              correlationId,
            }));
            const results = await (this.executorService as any).executeBatch(
              connectorCommands,
              { businessId: query.businessId, userId: query.userId },
            );
            executedActions = results.map(
              (r: any) =>
                ({
                  actionType: r.command.action.toUpperCase() as CortexActionType,
                  status: r.success ? 'success' : 'error',
                  description: r.success
                    ? `Executed ${r.command.action}`
                    : `Failed: ${r.error ?? ''}`,
                }) as CortexActionResult,
            );

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
          } catch {
            executedActions = await this.actionsService.executeActions(
              detectedActions,
              session as any,
            );
          }
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
