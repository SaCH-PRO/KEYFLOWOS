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
  AiPreferences,
} from '../ai/model-gateway.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  CortexQuery,
  CortexResponse,
  CortexStreamChunk,
  CortexMessage,
  CortexContextSnapshot,
  CortexProvider,
  CortexMood,
  CortexInsight,
  CortexProfitOpportunity,
  CortexActionResult,
  CortexActionType,
  CortexPersona,
  ConsciousResponse,
} from './key-cortex.types';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';

// ── Integration Layer v2 (optional — services may not exist yet) ──
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';

// ── Genome Integration Layer v3 (optional — services may not exist yet) ──
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexEventService } from './key-cortex-event.service';

// ── v4 Completion Layer (optional — Phase 18 services) ──
import { KeyProactiveEngineService } from './key-proactive-engine.service';
import { TrustExplanationService } from './trust-explanation.service';
import { isFeatureVisible, UserTier } from './calm-mode.config';

// ── Consciousness Layer ──
import { KeyCortexConsciousnessService } from './key-cortex-consciousness.service';

// ── v3 Types ──

export interface GenomeEnrichedContext {
  dnaScores: Record<string, number>;
  genomeStage: string;
  executiveReadiness: number;
  recommendations: GenomeRecommendation[];
  signals: GenomeSignal[];
  opportunities: GenomeOpportunity[];
  autonomyMap: Record<string, boolean>;
  timestamp: Date;
}

export interface GenomeRecommendation {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
  confidence: number;
  genomeScore: number;
}

export interface GenomeSignal {
  id: string;
  type: 'urgent' | 'warning' | 'opportunity' | 'info';
  message: string;
  module: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: Date;
}

export interface GenomeOpportunity {
  id: string;
  title: string;
  estimatedValue: number;
  category: string;
  confidence: number;
}

export interface EnrichedContext {
  businessId: string;
  genome: GenomeEnrichedContext | null;
  contextV2: Record<string, unknown> | null;
  contextSnapshot: CortexContextSnapshot | null;
  timestamp: Date;
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
  source: 'genome' | 'pattern' | 'insight';
  confidence: number;
  action?: string;
}

export interface InteractionFeedback {
  query: string;
  response: string;
  userRating?: number;
  userComment?: string;
  actionsTaken: string[];
  actionsSkipped: string[];
  sessionId: string;
  metadata?: Record<string, unknown>;
}

/**
 * KeyCortexReasoningService — The Core Reasoning Brain of KEY Cortex.
 *
 * This is the heart of the JARVIS-like AI system for KeyFlowOS. It orchestrates
 * multi-provider AI processing, action detection, insight generation, and the
 * signature "profit machine" feature that identifies revenue opportunities across
 * business data.
 *
 * v2 ENHANCEMENTS:
 * - Full integration with KeyCortexConnectorService for universal module access
 * - Natural-language command parsing via KeyCortexCommandService
 * - Real action execution via KeyCortexExecutorService
 * - Rich context assembly via KeyCortexContextV2Service
 * - Business insights via KeyCortexInsightService
 * - New public methods: executeCommand, queryModule, getCapabilities
 *
 * v3 GENOME-AWARE ENHANCEMENTS:
 * - Full genome integration via KeyCortexGenomeBridgeService
 * - DNA-aware reasoning pipeline with 12 steps
 * - Genome-enriched context with caching
 * - Autonomy checking for each parsed intent
 * - Ranked genome recommendations in AI prompts
 * - Action outcome reporting back to genome
 * - Proactive suggestion engine based on genome signals
 * - Decision explanation with genome context
 * - Interaction learning feeding genome outcome learning
 * - Event correlation across all steps via KeyCortexEventService
 *
 * v4 COMPLETION LAYER ENHANCEMENTS:
 * - Proactive action detection via KeyProactiveEngineService
 * - Trust explanation generation via TrustExplanationService
 * - Calm mode detail level adaptation
 *
 * CONSCIOUSNESS LAYER:
 * - Conscious query processing via KeyCortexConsciousnessService
 * - All 9 cognitive layers: emotion, reasoning, reflection, intuition,
 *   metacognition, creativity, ethics, temporal reasoning, and orchestration
 *
 * Responsibilities:
 * - Process user queries through the ModelGatewayService
 * - Select appropriate AI provider based on query type and preferences
 * - Handle streaming (SSE) and non-streaming responses
 * - Detect and trigger actions from AI responses
 * - Generate business insights and profit opportunities
 * - Track token usage, latency, and costs
 * - Execute direct commands and module queries (v2)
 * - Integrate with genome DNA, signals, recommendations (v3)
 * - Proactive suggestions and trust explanations (v4)
 * - Conscious-aware processing with 9 cognitive layers (consciousness)
 */
@Injectable()
export class KeyCortexReasoningService {
  private readonly logger = new Logger(KeyCortexReasoningService.name);

  /** Maximum tokens allowed in a context window before optimization. */
  private readonly MAX_CONTEXT_TOKENS: number;

  /** Session TTL in seconds (default: 24 hours). */
  private readonly SESSION_TTL: number;

  /** Genome-enriched context cache TTL in seconds (default: 60 seconds). */
  private readonly GENOME_CONTEXT_TTL: number;

  /** Cost tracking: estimated cost per 1K tokens by provider. */
  private readonly COST_PER_1K_TOKENS: Record<CortexProvider, { input: number; output: number }> = {
    openai: { input: 0.0025, output: 0.01 },
    anthropic: { input: 0.003, output: 0.015 },
    xai: { input: 0.005, output: 0.015 },
    kimi: { input: 0.001, output: 0.004 },
    native: { input: 0, output: 0 },
    opensource: { input: 0, output: 0 },
  };

  /** Feature flag: enable integration layer v2 if services are available. */
  private readonly integrationV2Enabled: boolean;

  /** Feature flag: enable genome integration layer v3 if services are available. */
  private readonly genomeV3Enabled: boolean;

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly personalityService: KeyCortexPersonalityService,
    private readonly contextService: KeyCortexContextService,
    private readonly actionsService: KeyCortexActionsService,

    // ── v2 Integration Layer (optional — graceful degradation) ──
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
    @Inject(KeyCortexInsightService)
    private readonly insightService?: KeyCortexInsightService,

    // ── v3 Genome Integration Layer (optional — graceful degradation) ──
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(KeyCortexEventService)
    private readonly eventService?: KeyCortexEventService,

    // ── v4 Completion Layer (optional — Phase 18 services) ──
    @Optional()
    @Inject(KeyProactiveEngineService)
    private readonly proactive?: KeyProactiveEngineService,
    @Optional()
    @Inject(TrustExplanationService)
    private readonly trustExplanation?: TrustExplanationService,

    // ── Consciousness Layer (optional — graceful degradation) ──
    @Optional()
    @Inject(KeyCortexConsciousnessService)
    private readonly consciousness?: KeyCortexConsciousnessService,
  ) {
    this.MAX_CONTEXT_TOKENS =
      parseInt(process.env.KEY_CORTEX_MAX_CONTEXT_TOKENS ?? '8000', 10);
    this.SESSION_TTL =
      parseInt(process.env.KEY_CORTEX_SESSION_TTL_HOURS ?? '24', 10) * 3600;
    this.GENOME_CONTEXT_TTL =
      parseInt(process.env.KEY_CORTEX_GENOME_CONTEXT_TTL_SECONDS ?? '60', 10);

    this.integrationV2Enabled = !!(
      this.connectorService &&
      this.commandService &&
      this.executorService &&
      this.contextV2Service
    );

    this.genomeV3Enabled = !!(this.genomeBridgeService && this.eventService);

    if (this.integrationV2Enabled) {
      this.logger.log(
        'KEY Cortex v2 Integration Layer is ACTIVE — full module connectivity enabled.',
      );
    } else {
      this.logger.warn(
        'KEY Cortex v2 Integration Layer is NOT active — running in legacy mode. Some v2 services are unavailable.',
      );
    }

    if (this.genomeV3Enabled) {
      this.logger.log(
        'KEY Cortex v3 Genome Integration Layer is ACTIVE — genome-aware reasoning enabled.',
      );
    } else {
      this.logger.warn(
        'KEY Cortex v3 Genome Integration Layer is NOT active — genome-aware features unavailable.',
      );
    }

    if (this.consciousness) {
      this.logger.log(
        'KEY Cortex Consciousness Layer is ACTIVE — 9 cognitive layers available.',
      );
    } else {
      this.logger.warn(
        'KEY Cortex Consciousness Layer is NOT active — conscious processing unavailable.',
      );
    }
  }

  // ==========================================================================
  // Consciousness-Aware Query Processing
  // ==========================================================================

  /**
   * Process a user query through the consciousness orchestrator.
   *
   * This routes the query through all 9 cognitive layers:
   * - Emotion: affective analysis of user state
   * - ReasoningEngine: enhanced cognitive processing
   * - Reflection: self-correction and learning
   * - Intuition: weak signal detection
   * - Metacognition: self-monitoring and strategy selection
   * - Creativity: novel idea generation
   * - Ethics: moral framework checking
   * - TemporalReasoning: time-aware analysis
   * - ConsciousnessService: final orchestration and synthesis
   *
   * Falls back to regular processQuery() if consciousness service is unavailable.
   *
   * @param query  The user query
   * @returns      ConsciousResponse with all 9 layer outputs
   */
  async processConsciousQuery(query: CortexQuery): Promise<ConsciousResponse> {
    if (!this.consciousness) {
      // Fall back to regular processing
      return this.processQuery(query);
    }

    const session = await this.getOrCreateSession(query);
    return this.consciousness.processConsciously(query.text, session);
  }

  // ==========================================================================
  // 1. Non-Streaming Query Processing (v3 Genome-Aware Pipeline)
  // ==========================================================================

  /**
   * Process a user query end-to-end (non-streaming) with the v3 genome-aware pipeline.
   *
   * v3 GENOME-AWARE FLOW (when genome layer is active):
   *  Step 1:  Receive query + create correlation ID
   *  Step 2:  Get genome intelligence (DNA scores, recommendations, signals)
   *  Step 3:  Get full context (v2 or legacy)
   *  Step 4:  Parse intent into structured commands
   *  Step 5:  Check autonomy for each action (genome-gated)
   *  Step 6:  Get ranked genome recommendations
   *  Step 7:  Build enriched prompt with genome context
   *  Step 8:  AI reasoning via ModelGatewayService
   *  Step 9:  Execute actions (v2 executor or legacy)
   *  Step 10: Report action outcomes to genome
   *  Step 11: Generate response with genome insights
   *  Step 12: Log everything to event service
   *  Step 13: Check if proactive action warranted (v4)
   *  Step 14: Generate trust explanation (v4)
   *
   * v2 FLOW (fallback when genome not available but v2 is):
   *  Same as original v2 flow — uses ContextV2Service + ExecutorService.
   *
   * LEGACY FLOW (final fallback):
   *  Same as original — uses ContextService + ActionsService.
   */
  async processQuery(query: CortexQuery): Promise<CortexResponse> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    this.logger.log(
      `[processQuery][${correlationId}] business=${query.businessId} user=${query.userId} persona=${query.persona ?? 'default'} v2=${this.integrationV2Enabled} v3=${this.genomeV3Enabled}`,
    );

    // ── Step 1: RECEIVE QUERY ──
    await this.logEvent(correlationId, 'STEP_1_RECEIVE_QUERY', {
      businessId: query.businessId,
      userId: query.userId,
      queryText: query.text.substring(0, 200),
      v2Enabled: this.integrationV2Enabled,
      v3Enabled: this.genomeV3Enabled,
    });

    try {
      // Get or create session
      const session = await this.getOrCreateSession(query);

      // ── Step 2: GET GENOME INTELLIGENCE (v3) ──
      let genomeContext: GenomeEnrichedContext | null = null;
      if (this.genomeV3Enabled && this.genomeBridgeService) {
        try {
          genomeContext = await this.getGenomeEnrichedContext(query.businessId);
          this.logger.log(
            `[processQuery][${correlationId}] Genome context loaded: ${genomeContext.recommendations.length} recommendations, ${genomeContext.signals.length} signals`,
          );
        } catch (err) {
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

      // ── Step 3: GET FULL CONTEXT ──
      let contextSnapshot: CortexContextSnapshot;
      let v2Context: Record<string, unknown> | undefined;

      if (this.integrationV2Enabled && this.contextV2Service) {
        try {
          v2Context = await this.contextV2Service.getFullContext(
            query.businessId,
          );
          contextSnapshot =
            await this.contextService.buildContextSnapshot(query.businessId);
          this.enrichSnapshotFromV2(contextSnapshot, v2Context);
        } catch (err) {
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

      // Enrich snapshot with genome data if available
      if (genomeContext) {
        this.enrichSnapshotFromGenome(contextSnapshot, genomeContext);
      }

      await this.logEvent(correlationId, 'STEP_3_FULL_CONTEXT', {
        v2Available: !!v2Context,
        genomeStage: contextSnapshot.genomeStage,
        executiveReadiness: contextSnapshot.executiveReadiness,
      });

      // ── Step 4: PARSE INTENT ──
      let parsedCommands: Array<{
        module: string;
        action: string;
        parameters: Record<string, unknown>;
        requiresApproval: boolean;
        naturalLanguage: string;
      }> = [];

      if (this.integrationV2Enabled && this.commandService && query.enableActions) {
        try {
          const capabilities =
            this.connectorService!.getAllCapabilities();
          const parsedIntents = await this.commandService.parseIntent(
            query.text,
            {
              businessId: query.businessId,
              userId: query.userId,
              businessName: contextSnapshot.businessId,
              currentPage: 'cortex_chat',
              recentActions: [],
            },
          );
          parsedCommands = parsedIntents.map((intent) => ({
            module: intent.module,
            action: intent.action,
            parameters: intent.parameters,
            requiresApproval: intent.requiresApproval,
            naturalLanguage: intent.naturalLanguage,
          }));
          this.logger.log(
            `[processQuery][${correlationId}] Parsed ${parsedCommands.length} command(s) from user input`,
          );
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Command parsing failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_4_PARSE_INTENT', {
        commandsParsed: parsedCommands.length,
        commands: parsedCommands.map((c) => ({ module: c.module, action: c.action })),
      });

      // ── Step 5: CHECK AUTONOMY (v3) ──
      let autonomyCheckedCommands = parsedCommands;
      let autonomyResults: Record<string, boolean> = {};

      if (this.genomeV3Enabled && this.genomeBridgeService && parsedCommands.length > 0) {
        try {
          const approvedCommands: typeof parsedCommands = [];

          for (const cmd of parsedCommands) {
            const canAutonomouslyExecute = await this.genomeBridgeService.checkAutonomy(
              query.businessId,
              { module: cmd.module, action: cmd.action, parameters: cmd.parameters },
            );

            autonomyResults[`${cmd.module}:${cmd.action}`] = canAutonomouslyExecute;

            if (canAutonomouslyExecute || !cmd.requiresApproval) {
              approvedCommands.push(cmd);
            } else {
              this.logger.log(
                `[processQuery][${correlationId}] Action ${cmd.module}.${cmd.action} requires approval — genome autonomy check returned false`,
              );
            }
          }

          autonomyCheckedCommands = approvedCommands;
          this.logger.log(
            `[processQuery][${correlationId}] Autonomy check: ${approvedCommands.length}/${parsedCommands.length} commands approved`,
          );
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Autonomy check failed, using all parsed commands: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_5_CHECK_AUTONOMY', {
        totalCommands: parsedCommands.length,
        approvedCommands: autonomyCheckedCommands.length,
        autonomyMap: autonomyResults,
      });

      // ── Step 6: GET RANKED RECOMMENDATIONS (v3) ──
      let rankedRecommendations: GenomeRecommendation[] = [];
      if (this.genomeV3Enabled && this.genomeBridgeService) {
        try {
          rankedRecommendations = await this.genomeBridgeService.getRankedRecommendations(
            query.businessId,
            v2Context ?? {},
          );
          this.logger.log(
            `[processQuery][${correlationId}] Got ${rankedRecommendations.length} ranked genome recommendations`,
          );
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Ranked recommendations failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_6_RANKED_RECOMMENDATIONS', {
        recommendationCount: rankedRecommendations.length,
        topCategories: rankedRecommendations.slice(0, 3).map((r) => r.category),
      });

      // ── Step 7: BUILD ENRICHED PROMPT (v3 enhanced) ──
      const persona: CortexPersona =
        query.persona ?? session.persona ?? 'jarvis';
      const personalityConfig =
        this.personalityService.getPersonalityConfig(persona);

      let systemPrompt: string;
      if (this.genomeV3Enabled && genomeContext) {
        // v3: Genome-enriched system prompt
        systemPrompt = this.buildV3SystemPrompt(
          persona,
          contextSnapshot,
          v2Context,
          genomeContext,
          rankedRecommendations,
          autonomyCheckedCommands.length > 0,
        );
      } else if (this.integrationV2Enabled) {
        systemPrompt = this.buildV2SystemPrompt(
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

      // v4: Apply calm mode detail level to prompt
      const detailLevel = this.getCalmModeDetailLevel(session);
      systemPrompt += `\nRespond with ${detailLevel} level of detail.`;

      await this.logEvent(correlationId, 'STEP_7_BUILD_PROMPT', {
        promptLength: systemPrompt.length,
        genomeEnriched: this.genomeV3Enabled && !!genomeContext,
        detailLevel,
      });

      // ── Step 8: AI REASONING ──
      const preferences: AiPreferences = {
        preferredProvider: query.provider ?? personalityConfig.persona,
        budgetMode: false,
      };
      const { provider, model } = await this.selectProvider(query, preferences);

      const messages = this.buildMessages(query, contextSnapshot, systemPrompt);
      const completionResult = await this.modelGateway.complete({
        messages,
        model,
        temperature: personalityConfig.temperature,
        maxTokens: this.MAX_CONTEXT_TOKENS,
        tools: await this.actionsService.buildToolDefinitions(query.businessId),
      });

      const latencyMs = Date.now() - startTime;

      const assistantMessage: CortexMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: completionResult.content,
        timestamp: new Date(),
        metadata: {
          provider,
          model,
          tokensUsed: completionResult.usage?.totalTokens ?? 0,
          cost: this.estimateCost(
            provider,
            completionResult.usage?.promptTokens ?? 0,
            completionResult.usage?.completionTokens ?? 0,
          ),
          latencyMs,
          mood: query.mood ?? (await this.detectMood(query.text)),
          correlationId,
          genomeEnriched: this.genomeV3Enabled && !!genomeContext,
        },
      };

      await this.logEvent(correlationId, 'STEP_8_AI_REASONING', {
        provider,
        model,
        tokensUsed: completionResult.usage?.totalTokens ?? 0,
        latencyMs,
      });

      // ── Step 9: EXECUTE ACTIONS ──
      let executedActions: CortexActionResult[] = [];

      if (query.enableActions) {
        if (
          this.integrationV2Enabled &&
          this.executorService &&
          autonomyCheckedCommands.length > 0
        ) {
          // v2: Execute autonomy-checked commands via ExecutorService
          try {
            const connectorCommands = autonomyCheckedCommands.map((cmd) =>
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

            const results = await this.executorService.executeBatch(
              connectorCommands,
              { businessId: query.businessId, userId: query.userId },
            );

            executedActions = results.map((result) => ({
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
          } catch (err) {
            this.logger.error(
              `[processQuery][${correlationId}] v2 execution failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            // Fallback to legacy action detection
            const detectedActions = await this.detectActions(
              completionResult.content,
            );
            if (detectedActions.length > 0) {
              executedActions = await this.actionsService.executeActions(
                detectedActions,
                session,
              );
              assistantMessage.metadata!.actionsTriggered = executedActions;
            }
          }
        } else {
          // Legacy: Detect actions in response + execute
          const detectedActions = query.enableActions
            ? await this.detectActions(completionResult.content)
            : [];

          if (detectedActions.length > 0 && query.enableActions) {
            executedActions = await this.actionsService.executeActions(
              detectedActions,
              session,
            );
            assistantMessage.metadata!.actionsTriggered = executedActions;
          }
        }
      }

      await this.logEvent(correlationId, 'STEP_9_EXECUTE_ACTIONS', {
        actionsExecuted: executedActions.length,
        actionResults: executedActions.map((a) => ({
          actionType: a.actionType,
          status: a.status,
        })),
      });

      // ── Step 10: REPORT OUTCOMES (v3) ──
      if (this.genomeV3Enabled && this.genomeBridgeService) {
        try {
          for (const action of executedActions) {
            await this.genomeBridgeService.reportActionOutcome(
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

          // Create evidence for successful actions
          const successfulActions = executedActions.filter((a) => a.status === 'success');
          for (const action of successfulActions) {
            await this.genomeBridgeService.createEvidence(
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
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Genome outcome reporting failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_10_REPORT_OUTCOMES', {
        outcomesReported: executedActions.length,
        genomeEnabled: this.genomeV3Enabled,
      });

      // ── Step 11: GENERATE RESPONSE (v3 with genome insights) ──
      const suggestions = await this.generateSuggestions(
        query.businessId,
        assistantMessage.content,
        v2Context,
      );

      // v3: Include proactive genome suggestions if warranted
      let proactiveSuggestions: Suggestion[] = [];
      if (this.genomeV3Enabled && genomeContext) {
        try {
          const shouldProactive = await this.shouldSuggestProactiveAction(query.businessId);
          if (shouldProactive) {
            proactiveSuggestions = await this.getProactiveSuggestions(query.businessId);
            this.logger.log(
              `[processQuery][${correlationId}] Generated ${proactiveSuggestions.length} proactive suggestions`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Proactive suggestions failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_11_GENERATE_RESPONSE', {
        suggestionsCount: suggestions.length,
        proactiveSuggestionsCount: proactiveSuggestions.length,
      });

      // ── Step 12: LOG EVERYTHING ──
      await this.saveMessage(session.id, {
        role: 'user',
        content: query.text,
        timestamp: new Date(),
      });
      await this.saveMessage(session.id, assistantMessage);

      await this.logEvent(correlationId, 'STEP_12_LOG_COMPLETE', {
        sessionId: session.id,
        totalLatencyMs: Date.now() - startTime,
        messageId: assistantMessage.id,
      });

      // ── Step 13: Check if proactive action warranted ──
      if (this.proactive) {
        try {
          const proactiveCheck = await this.proactive.shouldAct(session.businessId);
          if (proactiveCheck.shouldAct) {
            proactiveSuggestions = proactiveCheck.suggestions;
            this.logger.log(
              `[processQuery][${correlationId}] Proactive actions triggered: ${proactiveSuggestions.length} suggestion(s)`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Proactive check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // ── Step 14: Generate trust explanation for recommendations ──
      let explanation: Record<string, unknown> | undefined;
      if (this.trustExplanation && executedActions.length > 0) {
        try {
          const firstAction = executedActions[0];
          explanation = await this.trustExplanation.explain(
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
        } catch (err) {
          this.logger.warn(
            `[processQuery][${correlationId}] Trust explanation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.logEvent(correlationId, 'STEP_13_14_COMPLETION_LAYER', {
        proactiveSuggestions: proactiveSuggestions.length,
        hasExplanation: !!explanation,
      });

      // Final summary log
      this.logger.log(
        `[processQuery][${correlationId}] Completed in ${latencyMs}ms | provider=${provider} model=${model} tokens=${assistantMessage.metadata?.tokensUsed} commands=${parsedCommands.length} autonomyApproved=${autonomyCheckedCommands.length} executed=${executedActions.length} genome=${this.genomeV3Enabled && !!genomeContext}`,
      );

      return {
        message: assistantMessage,
        actions: executedActions,
        contextUsed: contextSnapshot,
        suggestions,
        followUpQuestions: suggestions.slice(0, 3),
        confidence: this.calculateConfidence(
          assistantMessage.content,
          contextSnapshot,
        ),
        // v4: Proactive suggestions from completion layer
        proactiveSuggestions: proactiveSuggestions.length > 0 ? proactiveSuggestions : undefined,
        // v4: Trust explanation for transparency
        explanation: explanation ?? undefined,
        // v3: Include genome enrichment in response
        genomeInsights: genomeContext
          ? {
              dnaScores: genomeContext.dnaScores,
              stage: genomeContext.genomeStage,
              topRecommendation: rankedRecommendations[0] ?? null,
              urgentSignals: genomeContext.signals.filter(
                (s) => s.severity === 'critical' || s.severity === 'high',
              ),
              proactiveSuggestions: proactiveSuggestions.slice(0, 3),
            }
          : undefined,
      } as CortexResponse;
    } catch (error) {
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

  // ==========================================================================
  // 2. Streaming Query Processing (SSE) — v3 Enhanced
  // ==========================================================================

  /**
   * Process a user query with Server-Sent Events (SSE) streaming.
   *
   * v3: When genome integration is active, the enriched system prompt
   * includes genome DNA scores, recommendations, and signals.
   */
  async *streamQuery(
    query: CortexQuery,
  ): AsyncGenerator<CortexStreamChunk> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    this.logger.log(
      `[streamQuery][${correlationId}] business=${query.businessId} user=${query.userId} stream=true v2=${this.integrationV2Enabled} v3=${this.genomeV3Enabled}`,
    );

    try {
      // Steps 1-3 — Session, genome context, full context
      const session = await this.getOrCreateSession(query);

      // v3: Get genome context for enrichment
      let genomeContext: GenomeEnrichedContext | null = null;
      if (this.genomeV3Enabled && this.genomeBridgeService) {
        try {
          genomeContext = await this.getGenomeEnrichedContext(query.businessId);
        } catch {
          // Non-critical — continue without genome
        }
      }

      const contextSnapshot =
        await this.contextService.buildContextSnapshot(query.businessId);

      // v2 context enrichment (non-blocking)
      let v2Context: Record<string, unknown> | undefined;
      if (this.integrationV2Enabled && this.contextV2Service) {
        try {
          v2Context = await this.contextV2Service.getFullContext(
            query.businessId,
          );
          this.enrichSnapshotFromV2(contextSnapshot, v2Context);
        } catch {
          // Non-critical — continue with basic context
        }
      }

      // Enrich with genome data
      if (genomeContext) {
        this.enrichSnapshotFromGenome(contextSnapshot, genomeContext);
      }

      const persona: CortexPersona =
        query.persona ?? session.persona ?? 'jarvis';
      const personalityConfig =
        this.personalityService.getPersonalityConfig(persona);

      // Build v3 or v2 system prompt
      let systemPrompt: string;
      if (this.genomeV3Enabled && genomeContext) {
        systemPrompt = this.buildV3SystemPrompt(
          persona,
          contextSnapshot,
          v2Context,
          genomeContext,
          genomeContext.recommendations.slice(0, 5),
          false,
        );
      } else if (this.integrationV2Enabled) {
        systemPrompt = this.buildV2SystemPrompt(
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

      const preferences: AiPreferences = {
        preferredProvider: query.provider ?? personalityConfig.persona,
        budgetMode: false,
      };
      const { provider, model } = await this.selectProvider(query, preferences);
      const messages = this.buildMessages(query, contextSnapshot, systemPrompt);

      // Yield initial "thought" chunk
      yield {
        type: 'thought',
        thought: genomeContext
          ? `Analyzing genome-aware context for ${contextSnapshot.genomeStage} stage business — ${genomeContext.signals.length} active signals, ${genomeContext.recommendations.length} recommendations available...`
          : `Analyzing context for ${contextSnapshot.genomeStage} stage business${this.integrationV2Enabled ? ' with full module awareness' : ''}...`,
      };

      // Stream completion
      let accumulatedText = '';
      const stream = this.modelGateway.streamComplete({
        messages,
        model,
        temperature: personalityConfig.temperature,
        maxTokens: this.MAX_CONTEXT_TOKENS,
        tools: await this.actionsService.buildToolDefinitions(query.businessId),
      });

      for await (const chunk of stream) {
        if (chunk.content) {
          accumulatedText += chunk.content;
          yield {
            type: 'text_delta',
            content: chunk.content,
          };
        }

        if (chunk.toolCall) {
          yield {
            type: 'tool_call',
            toolCall: {
              name: chunk.toolCall.name,
              params: chunk.toolCall.params,
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

      // Detect and execute actions
      const detectedActions = query.enableActions
        ? await this.detectActions(accumulatedText)
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
        if (this.integrationV2Enabled && this.executorService) {
          try {
            const connectorCommands = detectedActions.map((a) => ({
              module: 'autopilot' as any,
              action: a.actionType.toLowerCase(),
              parameters: { description: a.description },
              businessId: query.businessId,
              userId: query.userId,
              source: 'key_cortex' as const,
              timestamp: new Date(),
              correlationId,
            }));
            const results = await this.executorService.executeBatch(
              connectorCommands,
              { businessId: query.businessId, userId: query.userId },
            );
            executedActions = results.map(
              (r) =>
                ({
                  actionType: r.command.action.toUpperCase() as CortexActionType,
                  status: r.success ? 'success' : 'error',
                  description: r.success
                    ? `Executed ${r.command.action}`
                    : `Failed: ${r.error ?? ''}`,
                }) as CortexActionResult,
            );

            // v3: Report outcomes to genome
            if (this.genomeV3Enabled && this.genomeBridgeService) {
              for (const action of executedActions) {
                await this.genomeBridgeService.reportActionOutcome(
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
              session,
            );
          }
        } else {
          executedActions = await this.actionsService.executeActions(
            detectedActions,
            session,
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

      // v3: Yield genome insights if available
      if (genomeContext && genomeContext.signals.length > 0) {
        const urgentSignals = genomeContext.signals.filter(
          (s) => s.severity === 'critical' || s.severity === 'high',
        );
        if (urgentSignals.length > 0) {
          yield {
            type: 'thought',
            thought: `Genome alert: ${urgentSignals.length} signal(s) requiring attention — ${urgentSignals.map((s) => s.message).join('; ')}`,
          };
        }
      }

      // Save final message
      const latencyMs = Date.now() - startTime;
      const assistantMessage: CortexMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: accumulatedText,
        timestamp: new Date(),
        metadata: {
          provider,
          model,
          latencyMs,
          mood: query.mood ?? (await this.detectMood(query.text)),
          correlationId,
          genomeEnriched: this.genomeV3Enabled && !!genomeContext,
        },
      };

      await this.saveMessage(session.id, {
        role: 'user',
        content: query.text,
        timestamp: new Date(),
      });
      await this.saveMessage(session.id, assistantMessage);

      // v3: Log stream completion event
      await this.logEvent(correlationId, 'STREAM_QUERY_COMPLETE', {
        sessionId: session.id,
        provider,
        model,
        latencyMs,
        tokens: accumulatedText.length / 4,
      });

      this.logger.log(
        `[streamQuery][${correlationId}] Completed in ${latencyMs}ms | provider=${provider} model=${model}`,
      );

      yield { type: 'done' };
    } catch (error) {
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

  // ==========================================================================
  // 3. Action Detection (preserved from original)
  // ==========================================================================

  /**
   * Parse action intents from AI-generated text content.
   *
   * Scans the content for structured action markers (e.g. `[[ACTION:CREATE_TASK]]`)
   * and natural-language action indicators, then maps them to CortexActionType.
   */
  async detectActions(content: string): Promise<CortexActionResult[]> {
    const actions: CortexActionResult[] = [];

    // Structured action markers: [[ACTION:TYPE]] ... [[/ACTION]]
    const structuredPattern =
      /\[\[ACTION:(\w+)\]\](.*?)\[\[\/ACTION\]\]/gs;
    let match: RegExpExecArray | null;
    while ((match = structuredPattern.exec(content)) !== null) {
      const actionType = match[1] as CortexActionType;
      const description = match[2].trim();
      if (this.isValidActionType(actionType)) {
        actions.push({
          actionType,
          status: 'pending_approval',
          description,
          requiresApproval: this.requiresApproval(actionType),
        });
      }
    }

    // Natural-language action heuristics
    const actionPatterns: Array<{
      type: CortexActionType;
      patterns: RegExp[];
      requiresApproval: boolean;
    }> = [
      {
        type: 'CREATE_TASK',
        patterns: [
          /(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?task/i,
          /(?:set\s+up|schedule)\s+(?:a\s+)?task/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'CREATE_EVENT',
        patterns: [
          /(?:schedule|create|book)\s+(?:a\s+)?(?:meeting|event|appointment)/i,
          /(?:set\s+up|plan)\s+(?:a\s+)?(?:call|sync|review)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'CREATE_INVOICE',
        patterns: [
          /(?:create|generate|send)\s+(?:an?\s+)?invoice/i,
          /(?:bill|invoice)\s+(?:the\s+)?(?:client|customer)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'CREATE_LEAD',
        patterns: [
          /(?:add|create)\s+(?:a\s+)?(?:new\s+)?lead/i,
          /(?:log|record)\s+(?:a\s+)?(?:potential\s+)?(?:client|customer|opportunity)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'SEND_EMAIL',
        patterns: [
          /(?:send|draft|compose)\s+(?:an?\s+)?email/i,
          /(?:email|write\s+to)\s+(?:the\s+)?(?:client|team|customer)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'ANALYZE_DATA',
        patterns: [
          /(?:analyze|examine|review)\s+(?:the\s+)?(?:data|metrics|numbers|performance)/i,
          /(?:run|generate)\s+(?:an?\s+)?(?:analysis|report)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'GENERATE_REPORT',
        patterns: [
          /(?:generate|create|produce)\s+(?:a\s+)?report/i,
          /(?:pull|get)\s+(?:a\s+)?(?:summary|report|dashboard)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'EXECUTE_FLOW',
        patterns: [
          /(?:run|execute|trigger)\s+(?:a\s+)?(?:workflow|flow|automation)/i,
          /(?:start|initiate)\s+(?:the\s+)?(?:process|pipeline)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'CREATE_DOCUMENT',
        patterns: [
          /(?:create|draft|write)\s+(?:a\s+)?(?:document|proposal|contract|memo)/i,
          /(?:generate|prepare)\s+(?:a\s+)?(?:doc|file|agreement)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'SCHEDULE_REMINDER',
        patterns: [
          /(?:set|create)\s+(?:a\s+)?reminder/i,
          /(?:remind\s+me|don't\s+let\s+me\s+forget)/i,
        ],
        requiresApproval: false,
      },
      {
        type: 'UPDATE_CRM',
        patterns: [
          /(?:update|change)\s+(?:the\s+)?(?:CRM|contact|deal|opportunity)/i,
          /(?:move|advance)\s+(?:the\s+)?(?:deal|lead)\s+(?:to|into)/i,
        ],
        requiresApproval: true,
      },
      {
        type: 'SEARCH_KNOWLEDGE',
        patterns: [
          /(?:search|find|look\s+up)\s+(?:in\s+)?(?:knowledge\s+base|docs|wiki|help)/i,
          /(?:what\s+do\s+we\s+know|find\s+information)\s+about/i,
        ],
        requiresApproval: false,
      },
    ];

    for (const actionDef of actionPatterns) {
      for (const pattern of actionDef.patterns) {
        if (pattern.test(content)) {
          const alreadyDetected = actions.some(
            (a) => a.actionType === actionDef.type,
          );
          if (!alreadyDetected) {
            actions.push({
              actionType: actionDef.type,
              status: 'pending_approval',
              description: `Detected intent: ${actionDef.type}`,
              requiresApproval: actionDef.requiresApproval,
            });
          }
          break;
        }
      }
    }

    return actions;
  }

  // ==========================================================================
  // 4. Insight Generation (preserved + v2 delegation)
  // ==========================================================================

  /**
   * Generate AI-powered business insights based on query and business data.
   *
   * v2: When KeyCortexInsightService is available, it is used for richer
   * cross-module analysis. Otherwise falls back to the original AI prompt.
   */
  async generateInsights(
    businessId: string,
    query: string,
  ): Promise<CortexInsight[]> {
    this.logger.log(`[generateInsights] business=${businessId}`);

    // v2: Delegate to InsightService when available
    if (this.insightService) {
      try {
        this.logger.log('[generateInsights] Delegating to v2 InsightService');
        const recommendations =
          await this.insightService.generateRecommendations(businessId);
        return recommendations.map((rec) => ({
          type: (rec.type ?? 'suggestion') as CortexInsight['type'],
          title: rec.title,
          description: rec.description,
          confidence: rec.confidence ?? 0.7,
          estimatedValue: rec.estimatedValue,
          recommendedAction: rec.recommendedAction,
          dataSource: rec.dataSource ?? 'insight_service',
        }));
      } catch (err) {
        this.logger.warn(
          `[generateInsights] v2 delegation failed, using legacy: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Legacy insight generation
    try {
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(businessId);

      const insightsPrompt = `You are KEY Cortex, an elite AI business intelligence engine.
Analyze the following business context and user query. Generate 3-5 actionable insights.

=== BUSINESS CONTEXT ===
Genome Stage: ${contextSnapshot.genomeStage}
Executive Readiness: ${contextSnapshot.executiveReadiness}%
DNA Scores: ${JSON.stringify(contextSnapshot.genomeDna)}
Active Projects: ${contextSnapshot.activeProjects.join(', ')}
Pending Invoices: ${contextSnapshot.pendingInvoices}
Unread Messages: ${contextSnapshot.unreadMessages}
Recent Tasks: ${contextSnapshot.recentTasks.slice(0, 5).join(', ')}
Key Metrics: ${JSON.stringify(contextSnapshot.keyMetrics)}
========================

User Query: "${query}"

Generate insights in this JSON format:
[
  {
    "type": "opportunity|risk|trend|anomaly|suggestion",
    "title": "Short title",
    "description": "Detailed description with specifics",
    "confidence": 0.85,
    "estimatedValue": "Optional $ value or time savings",
    "recommendedAction": "What to do next",
    "dataSource": "Which data source this came from"
  }
]`;

      const result = await this.modelGateway.complete({
        messages: [{ role: 'user', content: insightsPrompt }],
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2000,
      });

      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn('[generateInsights] No JSON array found in response');
        return [];
      }

      const insights: CortexInsight[] = JSON.parse(jsonMatch[0]);

      return insights
        .filter(
          (i) =>
            i.type &&
            i.title &&
            i.description &&
            typeof i.confidence === 'number',
        )
        .map((i) => ({
          ...i,
          confidence: Math.min(Math.max(i.confidence, 0), 1),
        }));
    } catch (error) {
      this.logger.error(
        `[generateInsights] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ==========================================================================
  // 5. Profit Opportunities — The "Profit Machine" (preserved + v2)
  // ==========================================================================

  /**
   * Find profit opportunities across business data.
   *
   * v2: Delegates to KeyCortexInsightService.findProfitOpportunities when
   * available. Falls back to the original local implementation.
   */
  async findProfitOpportunities(
    businessId: string,
  ): Promise<CortexProfitOpportunity[]> {
    this.logger.log(`[findProfitOpportunities] business=${businessId}`);

    // v2: Delegate to InsightService
    if (this.insightService) {
      try {
        this.logger.log(
          '[findProfitOpportunities] Delegating to v2 InsightService',
        );
        return await this.insightService.findProfitOpportunities(businessId);
      } catch (err) {
        this.logger.warn(
          `[findProfitOpportunities] v2 delegation failed, using legacy: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Legacy implementation (preserved in full)
    try {
      const [invoices, leads, tasks, projects, contextSnapshot] =
        await Promise.all([
          this.prisma.invoice.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              total: true,
              status: true,
              clientName: true,
              createdAt: true,
              dueDate: true,
            },
          }),
          this.prisma.lead.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              status: true,
              estimatedValue: true,
              source: true,
              createdAt: true,
            },
          }),
          this.prisma.task.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              status: true,
              priority: true,
              title: true,
              dueDate: true,
              completedAt: true,
            },
          }),
          this.prisma.project.findMany({
            where: { businessId },
            orderBy: { updatedAt: 'desc' },
            take: 30,
            select: {
              id: true,
              status: true,
              budget: true,
              spent: true,
              name: true,
            },
          }),
          this.contextService.buildContextSnapshot(businessId),
        ]);

      const totalInvoiceValue = invoices
        .filter((i) => i.status === 'sent' || i.status === 'paid')
        .reduce((sum, i) => sum + (i.total || 0), 0);

      const overdueInvoices = invoices.filter(
        (i) =>
          i.status === 'sent' &&
          i.dueDate &&
          new Date(i.dueDate) < new Date(),
      );

      const overdueValue = overdueInvoices.reduce(
        (sum, i) => sum + (i.total || 0),
        0,
      );

      const unconvertedLeads = leads.filter(
        (l) => l.status === 'new' || l.status === 'contacted',
      );
      const totalLeadValue = unconvertedLeads.reduce(
        (sum, l) => sum + (l.estimatedValue || 0),
        0,
      );

      const stuckTasks = tasks.filter(
        (t) =>
          t.status !== 'completed' &&
          t.dueDate &&
          new Date(t.dueDate) < new Date(),
      );

      const projectsOverBudget = projects.filter(
        (p) => p.budget && p.spent && p.spent > p.budget,
      );

      const profitPrompt = `You are KEY Cortex -- the world's most aggressive profit-focused AI business engine.
Analyze the following business data and identify EVERY revenue opportunity, cost saving, and automation potential.
Think like a ruthless CFO meets growth hacker. Nothing is off-limits.

=== BUSINESS DATA ===
Genome Stage: ${contextSnapshot.genomeStage}
Executive Readiness: ${contextSnapshot.executiveReadiness}%
DNA Scores: ${JSON.stringify(contextSnapshot.genomeDna)}

INVOICES:
- Total outstanding value: $${totalInvoiceValue.toFixed(2)}
- Overdue invoices: ${overdueInvoices.length} (value: $${overdueValue.toFixed(2)})
- Total invoices analyzed: ${invoices.length}

LEADS:
- Unconverted leads: ${unconvertedLeads.length}
- Total estimated value of unconverted leads: $${totalLeadValue.toFixed(2)}
- Lead sources: ${[...new Set(leads.map((l) => l.source).filter(Boolean))].join(', ')}

TASKS:
- Stuck/overdue tasks: ${stuckTasks.length}
- Total active tasks: ${tasks.filter((t) => t.status !== 'completed').length}

PROJECTS:
- Projects over budget: ${projectsOverBudget.length}
- Active projects: ${projects.filter((p) => p.status === 'active').length}
- Budget at risk: $${projectsOverBudget.reduce((s, p) => s + ((p.spent || 0) - (p.budget || 0)), 0).toFixed(2)}

KEY METRICS:
${JSON.stringify(contextSnapshot.keyMetrics, null, 2)}
========================

Generate profit opportunities in this JSON format. Be SPECIFIC with dollar amounts and percentages.
Rank by estimated revenue impact (highest first).

[
  {
    "id": "po_1",
    "title": "Specific, actionable title",
    "description": "Detailed explanation with specific numbers from the data",
    "estimatedRevenue": 15000,
    "estimatedEffort": "low|medium|high",
    "confidence": 0.9,
    "category": "automation|upsell|cost_reduction|new_revenue|retention",
    "actionSteps": ["Step 1", "Step 2", "Step 3"],
    "dataSources": ["invoices", "leads", "tasks", "projects", "genome"]
  }
]`;

      const result = await this.modelGateway.complete({
        messages: [{ role: 'user', content: profitPrompt }],
        model: 'gpt-4o',
        temperature: 0.8,
        maxTokens: 4000,
      });

      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn(
          '[findProfitOpportunities] No JSON array found in response',
        );
        return this.buildFallbackProfitOpportunities({
          overdueValue,
          unconvertedLeadCount: unconvertedLeads.length,
          totalLeadValue,
          stuckTaskCount: stuckTasks.length,
          projectsOverBudgetCount: projectsOverBudget.length,
        });
      }

      const opportunities: CortexProfitOpportunity[] = JSON.parse(jsonMatch[0]);

      const validated = opportunities
        .filter(
          (o) =>
            o.id &&
            o.title &&
            o.description &&
            typeof o.estimatedRevenue === 'number' &&
            o.confidence &&
            o.category,
        )
        .map((o) => ({
          ...o,
          estimatedRevenue: Math.max(0, o.estimatedRevenue),
          confidence: Math.min(Math.max(o.confidence, 0), 1),
          estimatedEffort: (o.estimatedEffort ?? 'medium') as
            | 'low'
            | 'medium'
            | 'high',
          actionSteps: o.actionSteps ?? [],
          dataSources: o.dataSources ?? [],
        }));

      validated.sort(
        (a, b) =>
          b.estimatedRevenue * b.confidence -
          a.estimatedRevenue * a.confidence,
      );

      this.logger.log(
        `[findProfitOpportunities] Found ${validated.length} opportunities for business=${businessId}`,
      );

      return validated;
    } catch (error) {
      this.logger.error(
        `[findProfitOpportunities] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.buildFallbackProfitOpportunities({});
    }
  }

  // ==========================================================================
  // 6. Smart Provider Selection (preserved)
  // ==========================================================================

  /**
   * Select the optimal AI provider based on query characteristics and preferences.
   */
  async selectProvider(
    query: CortexQuery,
    preferences: AiPreferences,
  ): Promise<{ provider: CortexProvider; model: string }> {
    if (query.provider) {
      const modelMap: Record<CortexProvider, string> = {
        openai: 'gpt-4o',
        anthropic: 'claude-3-5-sonnet-20241022',
        xai: 'grok-2',
        kimi: 'moonshot-v1-8k',
        native: 'native-llm',
        opensource: 'llama-3.1-70b',
      };
      return { provider: query.provider, model: modelMap[query.provider] };
    }

    const text = query.text.toLowerCase();

    const isReasoning =
      /(?:analyze|reason|think|why|how\s+does|explain|compare|evaluate|assess)/i.test(
        text,
      );
    const isCreative =
      /(?:idea|creative|brainstorm|imagine|design|write|draft|compose)/i.test(
        text,
      );
    const isFast = query.stream === false && text.length < 100;
    const isBudget = preferences.budgetMode;

    if (isBudget) {
      return { provider: 'openai', model: 'gpt-4o-mini' };
    }

    if (isReasoning) {
      return { provider: 'kimi', model: 'moonshot-v1-8k' };
    }

    if (isCreative) {
      return {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
      };
    }

    if (isFast) {
      return { provider: 'openai', model: 'gpt-4o-mini' };
    }

    return { provider: 'openai', model: 'gpt-4o' };
  }

  // ==========================================================================
  // 7. Message Building (preserved)
  // ==========================================================================

  /**
   * Build the message array for the model gateway from query, context, and system prompt.
   */
  buildMessages(
    query: CortexQuery,
    context: CortexContextSnapshot,
    systemPrompt: string,
  ): GatewayMessage[] {
    const messages: GatewayMessage[] = [];

    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    const contextSummary = this.contextService.formatContextForPrompt(context);
    messages.push({
      role: 'system',
      content: contextSummary,
    });

    messages.push({
      role: 'user',
      content: query.text,
    });

    return messages;
  }

  // ==========================================================================
  // 8. Mood Detection (preserved)
  // ==========================================================================

  /**
   * Detect the user's mood from their query text.
   */
  async detectMood(query: string): Promise<CortexMood> {
    const text = query.toLowerCase();

    if (
      /\b(?:urgent|asap|emergency|critical|deadline|now|immediately|hurry)\b/.test(
        text,
      )
    ) {
      return 'urgent';
    }

    if (
      /\b(?:idea|creative|brainstorm|imagine|design|innovative|fun|exciting|inspiration)\b/.test(
        text,
      )
    ) {
      return 'creative';
    }

    if (
      /\b(?:analyze|data|metric|report|numbers|compare|evaluate|performance|kpi|roi)\b/.test(
        text,
      )
    ) {
      return 'analytical';
    }

    if (
      /\b(?:hey|hi|hello|thanks|please|help me|can you|would you|maybe|perhaps)\b/.test(
        text,
      ) &&
      text.length < 150
    ) {
      return 'casual';
    }

    return 'focused';
  }

  // ==========================================================================
  // 9. Suggestion Generation (preserved + v2 enrichment)
  // ==========================================================================

  /**
   * Generate follow-up suggestions based on the last assistant message and business context.
   *
   * v2: When the integration layer is active, suggestions include module-aware
   * recommendations based on the full business context.
   */
  async generateSuggestions(
    businessId: string,
    lastMessage: string,
    v2Context?: Record<string, unknown>,
  ): Promise<string[]> {
    try {
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(businessId);

      let extraContext = '';
      if (v2Context && this.integrationV2Enabled) {
        const moduleNames = Object.keys(v2Context).join(', ');
        extraContext = `\nAvailable modules: ${moduleNames}. You can suggest actions across any of these modules.`;
      }

      const suggestionPrompt = `Based on the following AI assistant response and business context, suggest 3 natural follow-up questions or commands the user might want to ask next.

Assistant's last message (excerpt): "${lastMessage.slice(0, 500)}"

Business context:
- Genome Stage: ${contextSnapshot.genomeStage}
- Pending invoices: ${contextSnapshot.pendingInvoices}
- Active projects: ${contextSnapshot.activeProjects.length}
- Unread messages: ${contextSnapshot.unreadMessages}${extraContext}

Return ONLY a JSON array of 3 strings. Each should be a complete, natural sentence.
Example: ["Can you break that down by month?", "Create a task for this", "What are the risks?"]`;

      const result = await this.modelGateway.complete({
        messages: [{ role: 'user', content: suggestionPrompt }],
        model: 'gpt-4o-mini',
        temperature: 0.8,
        maxTokens: 500,
      });

      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.getDefaultSuggestions(contextSnapshot);
      }

      const suggestions: string[] = JSON.parse(jsonMatch[0]);
      return suggestions
        .filter((s) => typeof s === 'string' && s.length > 5)
        .slice(0, 3);
    } catch (error) {
      this.logger.warn(
        `[generateSuggestions] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [
        'Can you explain that in more detail?',
        'Create a task from this analysis',
        'What are the next steps?',
      ];
    }
  }

  // ==========================================================================
  // 10. v3 NEW METHODS — Genome-Aware Reasoning
  // ==========================================================================

  /**
   * Get a genome-enriched context by combining genome intelligence with the v2 context.
   * Results are cached for 60 seconds to avoid repeated calls.
   *
   * v3 Pipeline Step 2 helper.
   *
   * @param businessId  The business ID to get context for
   * @returns           Genome-enriched context object
   */
  async getGenomeEnrichedContext(
    businessId: string,
  ): Promise<GenomeEnrichedContext> {
    // Check cache first
    const cacheKey = `genome:context:${businessId}`;
    const cached = await this.redis.getJson<GenomeEnrichedContext>(cacheKey);
    if (cached) {
      this.logger.debug(
        `[getGenomeEnrichedContext] Cache hit for business=${businessId}`,
      );
      return cached;
    }

    if (!this.genomeBridgeService) {
      throw new ServiceUnavailableException(
        'Genome bridge service is not available',
      );
    }

    this.logger.debug(
      `[getGenomeEnrichedContext] Building genome-enriched context for business=${businessId}`,
    );

    // Call genome bridge for intelligence
    const genomeIntelligence =
      await this.genomeBridgeService.getGenomeIntelligence(businessId);

    // Merge into a single enriched context object
    const enriched: GenomeEnrichedContext = {
      dnaScores: genomeIntelligence.dnaScores ?? {},
      genomeStage: genomeIntelligence.genomeStage ?? 'unknown',
      executiveReadiness: genomeIntelligence.executiveReadiness ?? 0,
      recommendations: (genomeIntelligence.recommendations ?? []).map(
        (rec: any) => ({
          id: rec.id ?? this.generateId(),
          title: rec.title ?? 'Untitled recommendation',
          description: rec.description ?? '',
          impact: rec.impact ?? 'medium',
          category: rec.category ?? 'general',
          confidence: rec.confidence ?? 0.5,
          genomeScore: rec.genomeScore ?? 0,
        }),
      ),
      signals: (genomeIntelligence.signals ?? []).map((sig: any) => ({
        id: sig.id ?? this.generateId(),
        type: sig.type ?? 'info',
        message: sig.message ?? '',
        module: sig.module ?? 'general',
        severity: sig.severity ?? 'low',
        createdAt: sig.createdAt ? new Date(sig.createdAt) : new Date(),
      })),
      opportunities: (genomeIntelligence.opportunities ?? []).map(
        (opp: any) => ({
          id: opp.id ?? this.generateId(),
          title: opp.title ?? 'Untitled opportunity',
          estimatedValue: opp.estimatedValue ?? 0,
          category: opp.category ?? 'general',
          confidence: opp.confidence ?? 0.5,
        }),
      ),
      autonomyMap: genomeIntelligence.autonomyMap ?? {},
      timestamp: new Date(),
    };

    // Cache for 60 seconds
    await this.redis.setJson(cacheKey, enriched, this.GENOME_CONTEXT_TTL);

    this.logger.debug(
      `[getGenomeEnrichedContext] Built genome-enriched context: ${enriched.recommendations.length} recommendations, ${enriched.signals.length} signals, ${enriched.opportunities.length} opportunities`,
    );

    return enriched;
  }

  /**
   * Determine whether KEY should suggest a proactive action based on genome signals.
   *
   * v3 Pipeline Step 11 helper.
   *
   * Checks for:
   * - Critical or high-severity genome signals
   * - Declining DNA score trends
   * - Outstanding opportunities with high confidence
   *
   * @param businessId  The business ID to check
   * @returns           True if proactive action is warranted
   */
  async shouldSuggestProactiveAction(businessId: string): Promise<boolean> {
    if (!this.genomeBridgeService) {
      return false;
    }

    try {
      // Get latest genome context (uses cache)
      const genomeContext = await this.getGenomeEnrichedContext(businessId);

      // Check for urgent/critical signals
      const hasCriticalSignals = genomeContext.signals.some(
        (s) => s.severity === 'critical' || s.severity === 'high',
      );
      if (hasCriticalSignals) {
        this.logger.debug(
          `[shouldSuggestProactiveAction] business=${businessId}: critical signals detected — proactive action warranted`,
        );
        return true;
      }

      // Check for declining DNA trends (compare with cached previous)
      const previousScores = await this.redis.getJson<Record<string, number>>(
        `genome:dna:previous:${businessId}`,
      );
      if (previousScores && genomeContext.dnaScores) {
        for (const [key, currentScore] of Object.entries(
          genomeContext.dnaScores,
        )) {
          const previousScore = previousScores[key];
          if (previousScore && currentScore < previousScore - 10) {
            this.logger.debug(
              `[shouldSuggestProactiveAction] business=${businessId}: DNA score ${key} declined from ${previousScore} to ${currentScore} — proactive action warranted`,
            );
            return true;
          }
        }
      }

      // Store current scores for next comparison
      await this.redis.setJson(
        `genome:dna:previous:${businessId}`,
        genomeContext.dnaScores,
        3600,
      );

      // Check for high-confidence opportunities
      const hasHighValueOpportunities = genomeContext.opportunities.some(
        (o) => o.confidence > 0.8 && o.estimatedValue > 5000,
      );
      if (hasHighValueOpportunities) {
        this.logger.debug(
          `[shouldSuggestProactiveAction] business=${businessId}: high-value opportunities detected — proactive action warranted`,
        );
        return true;
      }

      return false;
    } catch (err) {
      this.logger.warn(
        `[shouldSuggestProactiveAction] business=${businessId}: check failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Get proactive suggestions based on genome intelligence.
   *
   * v3 Pipeline Step 11 helper.
   *
   * Gets genome-ranked recommendations, filters to top 3 most impactful,
   * and formats as human-readable suggestions.
   *
   * @param businessId  The business ID to get suggestions for
   * @returns           Array of up to 3 proactive suggestions
   */
  async getProactiveSuggestions(businessId: string): Promise<Suggestion[]> {
    if (!this.genomeBridgeService) {
      return [];
    }

    try {
      // Get genome context (uses cache)
      const genomeContext = await this.getGenomeEnrichedContext(businessId);

      // Also get v2 context for richer suggestions
      let v2Context: Record<string, unknown> = {};
      if (this.integrationV2Enabled && this.contextV2Service) {
        try {
          v2Context =
            (await this.contextV2Service.getFullContext(businessId)) ?? {};
        } catch {
          // Non-critical
        }
      }

      // Get genome-ranked recommendations
      const rankedRecs = await this.genomeBridgeService.getRankedRecommendations(
        businessId,
        v2Context,
      );

      // Filter to top 3 most impactful
      const topRecs = rankedRecs
        .filter((r) => r.impact === 'high' || r.confidence > 0.7)
        .slice(0, 3);

      // Format as suggestions
      const suggestions: Suggestion[] = topRecs.map((rec) => ({
        id: rec.id ?? this.generateId(),
        title: rec.title,
        description: rec.description,
        impact: rec.impact as 'high' | 'medium' | 'low',
        category: rec.category,
        source: 'genome',
        confidence: rec.confidence,
        action: `Consider ${rec.title.toLowerCase()} to improve ${rec.category}`,
      }));

      // If no high-impact recommendations, use urgent signals
      if (suggestions.length === 0) {
        const urgentSignals = genomeContext.signals.filter(
          (s) => s.severity === 'critical' || s.severity === 'high',
        );
        for (const signal of urgentSignals.slice(0, 3)) {
          suggestions.push({
            id: signal.id,
            title: `Action needed: ${signal.module}`,
            description: signal.message,
            impact:
              signal.severity === 'critical'
                ? 'high'
                : signal.severity === 'high'
                  ? 'high'
                  : 'medium',
            category: signal.module,
            source: 'genome',
            confidence: 0.9,
            action: `Address ${signal.type} in ${signal.module}: ${signal.message}`,
          });
        }
      }

      this.logger.debug(
        `[getProactiveSuggestions] business=${businessId}: generated ${suggestions.length} proactive suggestions`,
      );

      return suggestions;
    } catch (err) {
      this.logger.warn(
        `[getProactiveSuggestions] business=${businessId}: failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Explain a decision by looking it up in the event log and generating
   * a human-readable explanation that includes genome context at the time.
   *
   * v3 Pipeline Step 11 / public API.
   *
   * @param decisionId  The decision ID (correlationId or event ID)
   * @returns           Human-readable explanation string
   */
  async explainDecision(decisionId: string): Promise<string> {
    this.logger.debug(`[explainDecision] Looking up decision: ${decisionId}`);

    try {
      // Look up the decision in the event log
      let eventLog: Array<{
        step: string;
        timestamp: Date;
        data: Record<string, unknown>;
      }> = [];

      if (this.eventService) {
        try {
          eventLog = await this.eventService.getEventLog(decisionId);
        } catch {
          // Event service may not have this decision
        }
      }

      // If no event log, try to reconstruct from session/prisma
      let decisionData: Record<string, unknown> = {};
      if (eventLog.length === 0) {
        // Try to find the session message with this correlation ID
        const session = await this.prisma.cortexSession.findFirst({
          where: {
            messages: {
              path: ['metadata', 'correlationId'],
              equals: decisionId,
            },
          },
          include: { messages: true },
        });
        if (session) {
          decisionData = {
            sessionId: session.id,
            businessId: session.businessId,
            messages: session.messages,
          };
        }
      } else {
        decisionData = {
          eventLog,
          steps: eventLog.map((e) => e.step),
        };
      }

      // Get genome context at the time of decision (best effort)
      let genomeContext: GenomeEnrichedContext | null = null;
      if (this.genomeBridgeService && decisionData.businessId) {
        try {
          genomeContext = await this.getGenomeEnrichedContext(
            decisionData.businessId as string,
          );
        } catch {
          // Genome context may not be available
        }
      }

      // Use AI to generate a human-readable explanation
      const explanationPrompt = `You are KEY's decision-explanation engine. Explain this decision clearly and concisely.

Decision ID: ${decisionId}

Decision Steps:
${eventLog.length > 0 ? eventLog.map((e) => `- ${e.step} at ${e.timestamp}`).join('\n') : 'Steps not available in event log'}

${genomeContext ? `Genome Context at Decision Time:
- Genome Stage: ${genomeContext.genomeStage}
- Executive Readiness: ${genomeContext.executiveReadiness}%
- DNA Scores: ${JSON.stringify(genomeContext.dnaScores)}
- Active Signals: ${genomeContext.signals.length}
- Top Recommendation: ${genomeContext.recommendations[0]?.title ?? 'None'}` : 'Genome context not available'}

Write a 3-4 sentence explanation of this decision that a non-technical business owner can understand. Be transparent about what data was used and why the decision was made. Use first person ("I decided...").`;

      const result = await this.modelGateway.complete({
        messages: [
          {
            role: 'system',
            content:
              'You are KEY, an AI business partner. Explain your decisions clearly and transparently.',
          },
          { role: 'user', content: explanationPrompt },
        ],
        model: 'gpt-4o-mini',
        temperature: 0.4,
        maxTokens: 500,
      });

      return (
        result.content?.trim() ??
        `I made decision ${decisionId} based on the available business context and genome intelligence at that time.`
      );
    } catch (error) {
      this.logger.error(
        `[explainDecision] Failed for ${decisionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return `Unable to explain decision ${decisionId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Learn from a user interaction by recording feedback, updating preferences,
   * and feeding outcomes to the genome outcome learning system.
   *
   * v3 Pipeline Step 10+ / public API.
   *
   * @param sessionId   The session ID for the interaction
   * @param interaction The interaction feedback data
   */
  async learnFromInteraction(
    sessionId: string,
    interaction: InteractionFeedback,
  ): Promise<void> {
    this.logger.log(
      `[learnFromInteraction] session=${sessionId} rating=${interaction.userRating ?? 'none'}`,
    );

    try {
      // Record user feedback in Prisma
      await this.prisma.client.keyInteractionFeedback.create({
        data: {
          sessionId,
          query: interaction.query.substring(0, 500),
          response: interaction.response.substring(0, 2000),
          userRating: interaction.userRating ?? null,
          userComment: interaction.userComment ?? null,
          actionsTaken: JSON.stringify(interaction.actionsTaken),
          actionsSkipped: JSON.stringify(interaction.actionsSkipped),
          metadata: interaction.metadata
            ? JSON.stringify(interaction.metadata)
            : null,
        },
      });

      // Update preference model based on feedback
      if (interaction.userRating !== undefined) {
        const rating = interaction.userRating;
        const redisKey = `learning:ratings:${sessionId}`;
        const existing = await this.redis.getJson<{
          ratings: number[];
          count: number;
        }>(redisKey);

        const ratings = existing?.ratings ?? [];
        ratings.push(rating);

        await this.redis.setJson(
          redisKey,
          {
            ratings,
            count: ratings.length,
            average: ratings.reduce((a, b) => a + b, 0) / ratings.length,
          },
          86400 * 30, // 30 days
        );

        this.logger.debug(
          `[learnFromInteraction] Rating ${rating}/5 recorded. Average: ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)}`,
        );
      }

      // Feed to genome outcome learning
      if (this.genomeV3Enabled && this.genomeBridgeService) {
        try {
          // Report successful actions as positive outcomes
          for (const actionId of interaction.actionsTaken) {
            await this.genomeBridgeService.reportActionOutcome(
              interaction.metadata?.businessId as string,
              {
                actionId,
                status: 'success',
                description: `User-rated ${interaction.userRating ?? 'N/A'}/5 — action taken`,
                result: {
                  userRating: interaction.userRating,
                  userComment: interaction.userComment,
                  sessionId,
                },
                timestamp: new Date(),
                correlationId: sessionId,
              },
            );
          }

          // Report skipped actions as neutral/negative outcomes
          for (const actionId of interaction.actionsSkipped) {
            await this.genomeBridgeService.reportActionOutcome(
              interaction.metadata?.businessId as string,
              {
                actionId,
                status: 'skipped',
                description: `User skipped this action — may indicate low relevance`,
                result: {
                  userRating: interaction.userRating,
                  sessionId,
                },
                timestamp: new Date(),
                correlationId: sessionId,
              },
            );
          }

          // Create evidence for the overall interaction
          if (interaction.userRating && interaction.userRating >= 4) {
            await this.genomeBridgeService.createEvidence(
              interaction.metadata?.businessId as string,
              {
                type: 'user_feedback_positive',
                description: `User rated interaction ${interaction.userRating}/5: "${interaction.userComment ?? 'No comment'}"`,
                source: 'key_cortex',
                metadata: {
                  sessionId,
                  rating: interaction.userRating,
                  actionsTaken: interaction.actionsTaken,
                },
              },
            );
          }

          this.logger.log(
            `[learnFromInteraction] Genome outcome learning updated for session=${sessionId}`,
          );
        } catch (err) {
          this.logger.warn(
            `[learnFromInteraction] Genome outcome learning failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Log the learning event
      await this.logEvent(sessionId, 'INTERACTION_LEARNED', {
        sessionId,
        userRating: interaction.userRating,
        actionsTaken: interaction.actionsTaken.length,
        actionsSkipped: interaction.actionsSkipped.length,
      });
    } catch (error) {
      this.logger.error(
        `[learnFromInteraction] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // 11. v2 PUBLIC API — Direct Command Execution
  // ==========================================================================

  /**
   * Execute a command directly via the integration layer.
   * Used by the controller for direct command execution endpoints.
   *
   * Falls back to legacy action execution if v2 is not available.
   * v3: Reports outcomes to genome after execution.
   */
  async executeCommand(
    businessId: string,
    userId: string,
    module: string,
    action: string,
    parameters: Record<string, unknown>,
  ): Promise<CortexActionResult> {
    const correlationId = this.generateCorrelationId();
    this.logger.log(
      `[executeCommand][${correlationId}] business=${businessId} module=${module} action=${action}`,
    );

    if (this.integrationV2Enabled && this.executorService && this.connectorService) {
      try {
        const command = {
          module: module as any,
          action,
          parameters,
          businessId,
          userId,
          source: 'key_cortex' as const,
          timestamp: new Date(),
          correlationId,
        };

        const result = await this.executorService.execute(command, {
          businessId,
          userId,
        });

        const actionResult: CortexActionResult = {
          actionType: (action.toUpperCase().replace(/\s+/g, '_') ??
            'EXECUTE_TOOL') as CortexActionType,
          status: result.success ? 'success' : 'error',
          description: result.success
            ? `Successfully executed ${action} on ${module}`
            : `Execution failed: ${result.error ?? 'Unknown error'}`,
          result: result.success
            ? (result.data as Record<string, unknown>)
            : undefined,
          error: result.error,
          requiresApproval: false,
        };

        // v3: Report outcome to genome
        if (this.genomeV3Enabled && this.genomeBridgeService) {
          await this.genomeBridgeService.reportActionOutcome(businessId, {
            actionId: action,
            status: actionResult.status,
            description: actionResult.description,
            result: actionResult.result ?? {},
            timestamp: new Date(),
            correlationId,
          });
        }

        return actionResult;
      } catch (err) {
        this.logger.error(
          `[executeCommand][${correlationId}] v2 execution failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          actionType: 'EXECUTE_TOOL',
          status: 'error',
          description: `Command execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          error: err instanceof Error ? err.message : 'Unknown error',
          requiresApproval: false,
        };
      }
    }

    // Legacy fallback
    return {
      actionType: 'EXECUTE_TOOL',
      status: 'error',
      description:
        'Integration layer v2 is not active. Command execution requires the connector and executor services.',
      error: 'V2_NOT_AVAILABLE',
      requiresApproval: false,
    };
  }

  // ==========================================================================
  // 12. v2 PUBLIC API — Module Query
  // ==========================================================================

  /**
   * Query data from a specific KeyFlowOS module.
   * Used by the controller for direct module querying.
   */
  async queryModule(
    businessId: string,
    module: string,
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    this.logger.log(
      `[queryModule] business=${businessId} module=${module} query=${queryName}`,
    );

    if (this.integrationV2Enabled && this.connectorService) {
      try {
        const result = await this.connectorService.query(
          module as any,
          queryName,
          { ...params, businessId },
        );
        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Query failed',
        };
      }
    }

    // Legacy: query via Prisma for known modules
    try {
      const data = await this.legacyModuleQuery(
        businessId,
        module,
        queryName,
        params,
      );
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Legacy query failed',
      };
    }
  }

  // ==========================================================================
  // 13. v2 PUBLIC API — Get Capabilities
  // ==========================================================================

  /**
   * Return all available module capabilities.
   * Used by the controller for the capabilities endpoint.
   */
  getCapabilities(): Array<{
    module: string;
    actions: string[];
    queries: string[];
    description: string;
  }> {
    if (this.integrationV2Enabled && this.connectorService) {
      return this.connectorService
        .getAllCapabilities()
        .map((cap) => ({
          module: cap.module,
          actions: cap.actions.map((a) => a.name),
          queries: cap.queries.map((q) => q.name),
          description: cap.description,
        }));
    }

    // Legacy: return static capability list
    return this.getLegacyCapabilities();
  }

  // ==========================================================================
  // v3 System Prompt Builder (Genome-Aware)
  // ==========================================================================

  /**
   * Build a genome-aware system prompt that includes:
   * - Personality + business context
   * - Genome DNA scores and stage
   * - Genome recommendations (top 5 ranked)
   * - Genome signals (urgent signals highlighted)
   * - Role-specific module expertise
   * - Available module capabilities
   * - Context from all connected modules (v2)
   * - Autonomy check results
   */
  private buildV3SystemPrompt(
    persona: CortexPersona,
    context: CortexContextSnapshot,
    v2Context: Record<string, unknown> | undefined,
    genomeContext: GenomeEnrichedContext,
    rankedRecommendations: GenomeRecommendation[],
    hasParsedCommands?: boolean,
  ): string {
    // Start with v2 base prompt
    const basePrompt = this.buildV2SystemPrompt(
      persona,
      context,
      v2Context,
      hasParsedCommands,
    );

    // Add genome context block
    const genomeBlock = this.buildGenomeContextBlock(
      genomeContext,
      rankedRecommendations,
    );

    // Add genome-aware behavioral guidance
    const behavioralGuidance = this.buildGenomeBehavioralGuidance(
      genomeContext.dnaScores,
    );

    const parts = [basePrompt, genomeBlock, behavioralGuidance].filter(Boolean);

    return parts.join('\n\n');
  }

  /**
   * Build the genome context block for the system prompt.
   */
  private buildGenomeContextBlock(
    genomeContext: GenomeEnrichedContext,
    rankedRecommendations: GenomeRecommendation[],
  ): string {
    const lines: string[] = ['=== GENOME INTELLIGENCE ==='];

    // DNA scores
    lines.push('DNA Scores:');
    for (const [key, score] of Object.entries(genomeContext.dnaScores)) {
      const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
      lines.push(`  ${key}: ${bar} ${score}%`);
    }

    lines.push(`Genome Stage: ${genomeContext.genomeStage}`);
    lines.push(`Executive Readiness: ${genomeContext.executiveReadiness}%`);

    // Urgent signals
    const urgentSignals = genomeContext.signals.filter(
      (s) => s.severity === 'critical' || s.severity === 'high',
    );
    if (urgentSignals.length > 0) {
      lines.push(`\n🚨 URGENT SIGNALS (${urgentSignals.length}):`);
      for (const signal of urgentSignals) {
        lines.push(`  [${signal.severity.toUpperCase()}] ${signal.module}: ${signal.message}`);
      }
    }

    // Top 5 ranked recommendations
    const top5 = rankedRecommendations.slice(0, 5);
    if (top5.length > 0) {
      lines.push(`\n📋 TOP RECOMMENDATIONS:`);
      for (const rec of top5) {
        lines.push(
          `  ${rec.impact === 'high' ? '🔥' : rec.impact === 'medium' ? '⚡' : '•'} [${rec.impact.toUpperCase()}] ${rec.title} (${rec.category}, ${Math.round(rec.confidence * 100)}% confidence)`,
        );
      }
    }

    // Opportunities
    if (genomeContext.opportunities.length > 0) {
      const topOpps = genomeContext.opportunities
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
        .slice(0, 3);
      lines.push(`\n💰 TOP OPPORTUNITIES:`);
      for (const opp of topOpps) {
        lines.push(
          `  ${opp.title}: $${opp.estimatedValue.toLocaleString()} (${opp.category})`,
        );
      }
    }

    lines.push('=========================');

    return lines.join('\n');
  }

  /**
   * Build behavioral guidance based on DNA scores.
   * Tells the AI how to adapt its behavior based on genome DNA.
   */
  private buildGenomeBehavioralGuidance(
    dnaScores: Record<string, number>,
  ): string {
    const guidance: string[] = [
      '=== GENOME-AWARE BEHAVIORAL GUIDANCE ===',
    ];

    for (const [key, score] of Object.entries(dnaScores)) {
      const category = key.toLowerCase();
      if (score < 30) {
        guidance.push(
          `${category.toUpperCase()} DNA is LOW (${score}%). Be proactive with ${category} suggestions. Recommend quick wins. Focus on fundamentals.`,
        );
      } else if (score < 60) {
        guidance.push(
          `${category.toUpperCase()} DNA is MODERATE (${score}%). Provide balanced ${category} recommendations. Highlight improvement opportunities.`,
        );
      } else if (score >= 80) {
        guidance.push(
          `${category.toUpperCase()} DNA is HIGH (${score}%). Leverage ${category} strengths in recommendations. Suggest advanced optimizations.`,
        );
      }
    }

    guidance.push('=========================');

    return guidance.join('\n');
  }

  // ==========================================================================
  // v2 System Prompt Builder (preserved)
  // ==========================================================================

  /**
   * Build an enhanced system prompt that includes:
   * - Personality + business context
   * - Role-specific module expertise
   * - Available module capabilities
   * - Context from all connected modules (v2)
   */
  private buildV2SystemPrompt(
    persona: CortexPersona,
    context: CortexContextSnapshot,
    v2Context?: Record<string, unknown>,
    hasParsedCommands?: boolean,
  ): string {
    // Start with personality base
    const basePrompt = this.personalityService.buildSystemPrompt(
      persona,
      context,
    );

    // Add role expertise
    const roleExpertise = this.personalityService.getRoleSystemPrompt(persona);

    // Add module capabilities summary
    let capabilitiesBlock = '';
    if (this.integrationV2Enabled && this.connectorService) {
      try {
        capabilitiesBlock =
          this.connectorService.formatCapabilitiesForPrompt();
      } catch {
        capabilitiesBlock = '';
      }
    }

    // Add v2 context summary
    let v2ContextBlock = '';
    if (v2Context && Object.keys(v2Context).length > 0) {
      const summaries: string[] = [];
      for (const [mod, ctx] of Object.entries(v2Context)) {
        if (ctx && typeof ctx === 'object') {
          const summary = this.summarizeModuleContext(mod, ctx);
          if (summary) summaries.push(summary);
        }
      }
      if (summaries.length > 0) {
        v2ContextBlock = `=== MODULE SNAPSHOTS ===\n${summaries.join('\n')}\n========================`;
      }
    }

    // Command-awareness hint
    const commandHint = hasParsedCommands
      ? '\nI have detected actionable commands in your message and will execute them after confirming with you.'
      : '';

    const parts = [
      basePrompt,
      roleExpertise,
      capabilitiesBlock,
      v2ContextBlock,
      commandHint,
    ].filter(Boolean);

    return parts.join('\n\n');
  }

  // ==========================================================================
  // v2/v3 Context Enrichment (preserved + enhanced)
  // ==========================================================================

  /**
   * Enrich a context snapshot with data from the v2 context service.
   */
  private enrichSnapshotFromV2(
    snapshot: CortexContextSnapshot,
    v2Context: Record<string, unknown>,
  ): void {
    try {
      const crmCtx = v2Context['crm'] as any;
      if (crmCtx?.contactCount) {
        snapshot.keyMetrics['totalContacts'] = crmCtx.contactCount;
      }

      const commerceCtx = v2Context['commerce'] as any;
      if (commerceCtx?.totalRevenue) {
        snapshot.keyMetrics['totalRevenue'] = commerceCtx.totalRevenue;
      }
      if (commerceCtx?.outstandingRevenue) {
        snapshot.keyMetrics['outstandingRevenue'] =
          commerceCtx.outstandingRevenue;
      }

      const bookingsCtx = v2Context['bookings'] as any;
      if (bookingsCtx?.upcomingCount) {
        snapshot.keyMetrics['upcomingBookings'] = bookingsCtx.upcomingCount;
      }
    } catch {
      // Non-critical enrichment
    }
  }

  /**
   * Enrich a context snapshot with genome data.
   */
  private enrichSnapshotFromGenome(
    snapshot: CortexContextSnapshot,
    genomeContext: GenomeEnrichedContext,
  ): void {
    try {
      // Merge DNA scores into keyMetrics
      for (const [key, score] of Object.entries(genomeContext.dnaScores)) {
        snapshot.keyMetrics[`dna_${key}`] = score;
      }

      // Override genome stage if genome provides one
      if (genomeContext.genomeStage) {
        snapshot.genomeStage = genomeContext.genomeStage;
      }

      // Override executive readiness
      if (genomeContext.executiveReadiness) {
        snapshot.executiveReadiness = genomeContext.executiveReadiness;
      }

      // Add genome recommendation count to metrics
      snapshot.keyMetrics['genomeRecommendations'] =
        genomeContext.recommendations.length;
      snapshot.keyMetrics['genomeSignals'] = genomeContext.signals.length;
      snapshot.keyMetrics['genomeOpportunities'] =
        genomeContext.opportunities.length;
    } catch {
      // Non-critical enrichment
    }
  }

  /**
   * Summarize a module's context for inclusion in the system prompt.
   */
  private summarizeModuleContext(
    module: string,
    context: Record<string, unknown>,
  ): string {
    try {
      switch (module) {
        case 'crm': {
          const ctx = context as any;
          return `CRM: ${ctx.contactCount ?? '?'} contacts, ${ctx.leadCount ?? '?'} leads, ${ctx.recentContacts?.length ?? 0} recent interactions.`;
        }
        case 'commerce': {
          const ctx = context as any;
          return `Commerce: $${ctx.totalRevenue ?? 0} total revenue, $${ctx.outstandingRevenue ?? 0} outstanding, ${ctx.productCount ?? 0} products.`;
        }
        case 'bookings': {
          const ctx = context as any;
          return `Bookings: ${ctx.upcomingCount ?? 0} upcoming, ${ctx.todayCount ?? 0} today.`;
        }
        case 'autopilot': {
          const ctx = context as any;
          return `Autopilot: ${ctx.activeTaskCount ?? 0} active tasks, ${ctx.activeLoopCount ?? 0} active loops.`;
        }
        default:
          return `${module}: ${Object.keys(context).length} data points.`;
      }
    } catch {
      return '';
    }
  }

  // ==========================================================================
  // v3 Event Logging Helper
  // ==========================================================================

  /**
   * Log an event to the event service if available.
   */
  private async logEvent(
    correlationId: string,
    step: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (this.eventService) {
      try {
        await this.eventService.logEvent({
          correlationId,
          step,
          data,
          timestamp: new Date(),
          service: 'KeyCortexReasoningService',
        });
      } catch {
        // Non-critical — event logging should not break the pipeline
      }
    }
  }

  // ==========================================================================
  // Legacy Module Query (fallback)
  // ==========================================================================

  /**
   * Direct Prisma-based queries for legacy mode when connector is unavailable.
   */
  private async legacyModuleQuery(
    businessId: string,
    module: string,
    queryName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (module) {
      case 'crm': {
        if (queryName === 'get_contacts') {
          return this.prisma.contact.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { updatedAt: 'desc' },
          });
        }
        if (queryName === 'get_contact') {
          return this.prisma.contact.findFirst({
            where: {
              businessId,
              id: params.contactId as string,
              deletedAt: null,
            },
          });
        }
        break;
      }
      case 'commerce': {
        if (queryName === 'get_invoices') {
          return this.prisma.invoice.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { createdAt: 'desc' },
          });
        }
        break;
      }
      case 'bookings': {
        if (queryName === 'get_bookings') {
          return this.prisma.booking.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { startTime: 'desc' },
          });
        }
        break;
      }
      case 'autopilot': {
        if (queryName === 'get_tasks') {
          return this.prisma.autopilotTask.findMany({
            where: { businessId },
            take: (params.limit as number) ?? 50,
            orderBy: { createdAt: 'desc' },
          });
        }
        break;
      }
    }
    throw new Error(`Unknown legacy query: ${module}.${queryName}`);
  }

  // ==========================================================================
  // Legacy Capabilities (fallback)
  // ==========================================================================

  /**
   * Static capability list used when the connector service is unavailable.
   */
  private getLegacyCapabilities(): Array<{
    module: string;
    actions: string[];
    queries: string[];
    description: string;
  }> {
    return [
      {
        module: 'crm',
        actions: [
          'create_contact',
          'update_contact',
          'add_task',
          'get_contact',
        ],
        queries: ['get_contacts', 'get_contact'],
        description: 'Customer relationship management — contacts, leads, tasks, timeline.',
      },
      {
        module: 'commerce',
        actions: ['create_invoice', 'get_invoice', 'update_invoice'],
        queries: ['get_invoices', 'get_products'],
        description: 'Invoicing, products, orders, quotes, payments.',
      },
      {
        module: 'bookings',
        actions: ['create_booking', 'update_booking', 'cancel_booking'],
        queries: ['get_bookings', 'get_availability'],
        description: 'Appointments, scheduling, availability management.',
      },
      {
        module: 'autopilot',
        actions: ['create_task', 'update_task', 'run_loop'],
        queries: ['get_tasks', 'get_loops'],
        description: 'Background task automation, delegation loops, monitoring.',
      },
      {
        module: 'content',
        actions: ['create_post', 'schedule_post'],
        queries: ['get_posts', 'get_campaigns'],
        description: 'Content creation, social media, campaigns, SEO.',
      },
      {
        module: 'analytics',
        actions: ['generate_report', 'run_analysis'],
        queries: ['get_metrics', 'get_dashboard'],
        description: 'Business analytics, metrics, reports, dashboards.',
      },
    ];
  }

  // ==========================================================================
  // Private Helpers (preserved from original)
  // ==========================================================================

  private async getOrCreateSession(
    query: CortexQuery,
  ): Promise<{ id: string; persona: CortexPersona; [key: string]: unknown }> {
    if (query.sessionId) {
      const cached = await this.redis.get(
        `cortex:session:${query.sessionId}`,
      );
      if (cached) {
        const session = JSON.parse(cached);
        await this.redis.setex(
          `cortex:session:${query.sessionId}`,
          this.SESSION_TTL,
          cached,
        );
        return session;
      }

      const dbSession = await this.prisma.cortexSession.findUnique({
        where: { id: query.sessionId },
      });
      if (dbSession) {
        await this.redis.setex(
          `cortex:session:${query.sessionId}`,
          this.SESSION_TTL,
          JSON.stringify(dbSession),
        );
        return dbSession as unknown as {
          id: string;
          persona: CortexPersona;
        };
      }
    }

    const newSession = await this.prisma.cortexSession.create({
      data: {
        id: this.generateId(),
        businessId: query.businessId,
        userId: query.userId,
        persona: (query.persona ?? 'jarvis') as string,
        voice: (query.voice ?? 'echo') as string,
        mood: (query.mood ?? 'focused') as string,
        preferredProvider: (query.provider ?? 'openai') as string,
        status: 'active',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessedAt: new Date(),
      },
    });

    await this.redis.setex(
      `cortex:session:${newSession.id}`,
      this.SESSION_TTL,
      JSON.stringify(newSession),
    );

    this.logger.log(
      `[getOrCreateSession] Created new session=${newSession.id}`,
    );

    return newSession as unknown as { id: string; persona: CortexPersona };
  }

  private async saveMessage(
    sessionId: string,
    message: Omit<CortexMessage, 'id'> & { id?: string },
  ): Promise<void> {
    const session = await this.prisma.cortexSession.findUnique({
      where: { id: sessionId },
      select: { messages: true },
    });

    if (session) {
      const messages = (session.messages as unknown as CortexMessage[]) ?? [];
      messages.push(message as CortexMessage);

      await this.prisma.cortexSession.update({
        where: { id: sessionId },
        data: {
          messages: messages as unknown as Record<string, unknown>[],
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        },
      });
    }

    const cached = await this.redis.get(`cortex:session:${sessionId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      parsed.messages = parsed.messages ?? [];
      parsed.messages.push(message);
      parsed.lastAccessedAt = new Date().toISOString();
      await this.redis.setex(
        `cortex:session:${sessionId}`,
        this.SESSION_TTL,
        JSON.stringify(parsed),
      );
    }
  }

  private estimateCost(
    provider: CortexProvider,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const rates = this.COST_PER_1K_TOKENS[provider] ?? { input: 0, output: 0 };
    return (
      (promptTokens / 1000) * rates.input +
      (completionTokens / 1000) * rates.output
    );
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

  private isValidActionType(type: string): type is CortexActionType {
    const validTypes: CortexActionType[] = [
      'CREATE_TASK',
      'CREATE_EVENT',
      'SEND_MESSAGE',
      'CREATE_DOCUMENT',
      'ANALYZE_DATA',
      'GENERATE_REPORT',
      'EXECUTE_FLOW',
      'QUERY_DATABASE',
      'UPDATE_RECORD',
      'SCHEDULE_REMINDER',
      'CREATE_INVOICE',
      'SEND_EMAIL',
      'CREATE_LEAD',
      'UPDATE_CRM',
      'SEARCH_KNOWLEDGE',
      'EXECUTE_TOOL',
    ];
    return validTypes.includes(type as CortexActionType);
  }

  private requiresApproval(actionType: CortexActionType): boolean {
    const highImpactActions: CortexActionType[] = [
      'SEND_EMAIL',
      'CREATE_INVOICE',
      'EXECUTE_FLOW',
      'UPDATE_CRM',
      'SEND_MESSAGE',
      'EXECUTE_TOOL',
    ];
    return highImpactActions.includes(actionType);
  }

  private buildFallbackProfitOpportunities(metrics: {
    overdueValue?: number;
    unconvertedLeadCount?: number;
    totalLeadValue?: number;
    stuckTaskCount?: number;
    projectsOverBudgetCount?: number;
  }): CortexProfitOpportunity[] {
    const ops: CortexProfitOpportunity[] = [];

    if ((metrics.overdueValue ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_1',
        title: 'Collect overdue invoices',
        description: `You have $${(metrics.overdueValue ?? 0).toFixed(2)} in overdue invoices. Follow up immediately to recover this revenue.`,
        estimatedRevenue: metrics.overdueValue ?? 0,
        estimatedEffort: 'low',
        confidence: 0.95,
        category: 'retention',
        actionSteps: [
          'Send reminder emails for all overdue invoices',
          'Call high-value clients personally',
          'Offer early payment discounts',
        ],
        dataSources: ['invoices'],
      });
    }

    if ((metrics.unconvertedLeadCount ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_2',
        title: 'Convert dormant leads',
        description: `You have ${metrics.unconvertedLeadCount} unconverted leads worth $${(metrics.totalLeadValue ?? 0).toFixed(2)}. Re-engage them with targeted outreach.`,
        estimatedRevenue: (metrics.totalLeadValue ?? 0) * 0.2,
        estimatedEffort: 'medium',
        confidence: 0.75,
        category: 'new_revenue',
        actionSteps: [
          'Segment leads by source and value',
          'Send personalized re-engagement emails',
          'Schedule follow-up calls for high-value leads',
        ],
        dataSources: ['leads'],
      });
    }

    if ((metrics.stuckTaskCount ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_3',
        title: 'Unblock stuck tasks',
        description: `${metrics.stuckTaskCount} tasks are past their due date. Clearing these bottlenecks will improve team velocity and client satisfaction.`,
        estimatedRevenue: 5000,
        estimatedEffort: 'medium',
        confidence: 0.7,
        category: 'automation',
        actionSteps: [
          'Review all overdue tasks with the team',
          'Identify blockers and reassign if needed',
          'Automate recurring task types',
        ],
        dataSources: ['tasks'],
      });
    }

    if ((metrics.projectsOverBudgetCount ?? 0) > 0) {
      ops.push({
        id: 'po_fallback_4',
        title: 'Control project budget overruns',
        description: `${metrics.projectsOverBudgetCount} projects are over budget. Immediate cost control measures can prevent further losses.`,
        estimatedRevenue: 10000,
        estimatedEffort: 'high',
        confidence: 0.8,
        category: 'cost_reduction',
        actionSteps: [
          'Audit all active project budgets',
          'Implement weekly spend tracking',
          'Renegotiate vendor contracts',
        ],
        dataSources: ['projects'],
      });
    }

    return ops.sort(
      (a, b) =>
        b.estimatedRevenue * b.confidence -
        a.estimatedRevenue * a.confidence,
    );
  }

  private getDefaultSuggestions(
    context: CortexContextSnapshot,
  ): string[] {
    const suggestions: string[] = [
      'Can you break that down by category?',
      'Create a task from this analysis',
      'What are the risks I should watch for?',
    ];

    if (context.pendingInvoices > 0) {
      suggestions.push(
        `Follow up on ${context.pendingInvoices} pending invoices`,
      );
    }

    if (context.activeProjects.length > 0) {
      suggestions.push('Show me project status updates');
    }

    return suggestions.slice(0, 3);
  }

  private generateId(): string {
    return `crtx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * v4: Determine detail level based on calm mode / user tier.
   * Maps user preference to simple | detailed | expert detail levels.
   */
  private getCalmModeDetailLevel(
    session: { preferredDetail?: string; persona?: string },
  ): string {
    const preference = session.preferredDetail ?? 'auto';

    if (preference === 'simple' || preference === 'beginner') return 'simple';
    if (preference === 'detailed' || preference === 'intermediate') return 'detailed';
    if (preference === 'expert' || preference === 'advanced') return 'expert';

    // Auto-detect based on persona
    const persona = session.persona ?? 'jarvis';
    if (persona === 'jarvis') return 'detailed';
    if (persona === 'executive') return 'simple';
    if (persona === 'analyst') return 'expert';

    return 'detailed';
  }
}
