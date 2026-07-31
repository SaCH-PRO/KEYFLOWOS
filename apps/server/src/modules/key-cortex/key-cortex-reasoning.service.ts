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
  AiPreferences,
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
  CortexSession,
  CortexContextSnapshot,
  CortexProvider,
  CortexMood,
  CortexInsight,
  CortexProfitOpportunity,
  CortexActionResult,
  CortexActionType,
  CortexPersona,
} from './key-cortex.types';
import type { ConsciousResponse } from './key-cortex-consciousness.types';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { AdaptiveRouterService } from './adaptive-router.service';

// -- Phase 0.7b: Decomposed reasoning delegate services --
import { KeyCortexSessionService } from './key-cortex-session.service';
import { KeyCortexPromptContextService } from './key-cortex-prompt-context.service';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { KeyCortexActionDetectionService } from './key-cortex-action-detection.service';
import { KeyCortexLegacyInsightService } from './key-cortex-legacy-insight.service';
import { KeyCortexProviderSelectionService } from './key-cortex-provider-selection.service';
import { KeyCortexStructuredOutputService } from './key-cortex-structured-output.service';
import { KeyCortexMoodDetectionService } from './key-cortex-mood-detection.service';
import { KeyCortexSuggestionService } from './key-cortex-suggestion.service';
import { KeyCortexGenomeContextService } from './key-cortex-genome-context.service';
import { KeyCortexSystemPromptService } from './key-cortex-system-prompt.service';
import { KeyCortexInteractionService } from './key-cortex-interaction.service';
import { KeyCortexCommandExecutionService } from './key-cortex-command-execution.service';
import { KeyCortexQueryPipelineService } from './key-cortex-query-pipeline.service';

// -- v2 Integration Layer (optional) --
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';

// -- v3 Genome Integration Layer (optional) --
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexEventService } from './key-cortex-event.service';

// -- v4 Completion Layer (optional) --
import { KeyProactiveEngineService } from './key-proactive-engine.service';
import { TrustExplanationService } from './trust-explanation.service';

// ── Consciousness Layer ──
import { KeyCortexConsciousnessService } from './key-cortex-consciousness.service';

// ── v3 Types ──
// -- Phase D: Learning & Metacognition (optional) --
import { KeyCortexLearningService } from './key-cortex-learning.service';

import {
  GenomeEnrichedContext,
  Suggestion,
  InteractionFeedback,
} from './key-cortex-reasoning.types';

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
 * Phase 0.7b rewrite: this is now a thin orchestrator that delegates the
 * heavy lifting to the focused Phase 0.7b services. The public API surface
 * is preserved so existing callers (controller, gateway, tests) continue to
 * work without changes.
 */
@Injectable()
export class KeyCortexReasoningService {
  private readonly logger = new Logger(KeyCortexReasoningService.name);

  /** Genome-enriched context cache TTL in seconds (default: 60 seconds). */
  private readonly GENOME_CONTEXT_TTL: number;

  /** Feature flag: enable integration layer v2 if all required services are available. */
  private readonly integrationV2Enabled: boolean;

  /** Feature flag: enable genome integration layer v3 if all required services are available. */
  private readonly genomeV3Enabled: boolean;

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly personalityService: KeyCortexPersonalityService,
    private readonly contextService: KeyCortexContextService,
    private readonly actionsService: KeyCortexActionsService,

    // -- Phase 0.7b: Required delegate services --
    private readonly sessionService: KeyCortexSessionService,
    private readonly promptContextService: KeyCortexPromptContextService,
    private readonly toolLoopService: KeyCortexToolLoopService,
    private readonly actionDetectionService: KeyCortexActionDetectionService,
    private readonly legacyInsightService: KeyCortexLegacyInsightService,
    private readonly providerSelectionService: KeyCortexProviderSelectionService,
    private readonly structuredOutputService: KeyCortexStructuredOutputService,
    private readonly moodDetectionService: KeyCortexMoodDetectionService,
    private readonly suggestionService: KeyCortexSuggestionService,
    private readonly genomeContextService: KeyCortexGenomeContextService,
    private readonly systemPromptService: KeyCortexSystemPromptService,
    private readonly interactionService: KeyCortexInteractionService,
    private readonly commandExecutionService: KeyCortexCommandExecutionService,
    private readonly queryPipeline: KeyCortexQueryPipelineService,

    // -- Adaptive Router (Phase C) --
    @Optional()
    @Inject(AdaptiveRouterService)
    private readonly adaptiveRouter?: AdaptiveRouterService,

    // -- Contextual Memory (Phase C) --
    @Optional()
    @Inject(AiMemoryService)
    private readonly aiMemoryService?: AiMemoryService,
    @Optional()
    @Inject(SemanticMemoryService)
    private readonly semanticMemoryService?: SemanticMemoryService,

    // -- v2 Integration Layer (optional — graceful degradation) --
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

    // -- v3 Genome Integration Layer (optional — graceful degradation) --
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(KeyCortexEventService)
    private readonly eventService?: KeyCortexEventService,

    // -- v4 Completion Layer (optional — Phase 18 services) --
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
    // -- Phase D: Learning & Metacognition --
    @Optional()
    @Inject(KeyCortexLearningService)
    private readonly learningService?: KeyCortexLearningService,
  ) {
    this.GENOME_CONTEXT_TTL = parseInt(
      process.env.KEY_CORTEX_GENOME_CONTEXT_TTL_SECONDS ?? '60',
      10,
    );

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
  // 1. Core query processing — delegated to the query pipeline
  // ==========================================================================

  /**
   * Process a user query end-to-end (non-streaming).
   */
  async processQuery(query: CortexQuery): Promise<CortexResponse> {
    return this.queryPipeline.processQuery(query, {
      integrationV2Enabled: this.integrationV2Enabled,
      genomeV3Enabled: this.genomeV3Enabled,
    });
  }

  /**
   * Process a user query as an SSE stream.
   */
  async *streamQuery(query: CortexQuery): AsyncGenerator<CortexStreamChunk> {
    yield* this.queryPipeline.streamQuery(query, {
      integrationV2Enabled: this.integrationV2Enabled,
      genomeV3Enabled: this.genomeV3Enabled,
    });
  }

  // ==========================================================================
  // 2. Action, mood, provider, and insight helpers — delegated
  // ==========================================================================

  /**
   * Parse action intents from AI-generated text content.
   */
  async detectActions(content: string): Promise<CortexActionResult[]> {
    return this.actionDetectionService.detectActions(content);
  }

  /**
   * Detect the user's mood from their query text.
   */
  detectMood(query: string): CortexMood {
    return this.moodDetectionService.detectMood(query);
  }

  /**
   * Generate AI-powered business insights based on query and business data.
   */
  async generateInsights(
    businessId: string,
    query: string,
  ): Promise<CortexInsight[]> {
    return this.legacyInsightService.generateInsights(businessId, query);
  }

  /**
   * Find profit opportunities across business data.
   */
  async findProfitOpportunities(
    businessId: string,
  ): Promise<CortexProfitOpportunity[]> {
    return this.legacyInsightService.findProfitOpportunities(businessId);
  }

  /**
   * Select the optimal AI provider based on query characteristics and preferences.
   */
  async selectProvider(
    query: CortexQuery,
    preferences: AiPreferences,
  ): Promise<{ provider: CortexProvider; model: string }> {
    return this.providerSelectionService.selectProvider(query, preferences);
  }

  // ==========================================================================
  // 3. Message building & task classification (preserved public API)
  // ==========================================================================

  /**
   * Build the message array for the model gateway from query, context, system prompt,
   * session history, and optional memory context.
   */
  buildMessages(
    query: CortexQuery,
    context: CortexContextSnapshot,
    systemPrompt: string,
    session?: CortexSession,
    memoryContext?: {
      runningSummary?: string;
      aiMemory?: string;
      semanticMemory?: string;
      lessons?: string;
    },
  ): GatewayMessage[] {
    const messages: GatewayMessage[] = [];

    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Phase C: Inject running conversation summary
    const runningSummary = memoryContext?.runningSummary ?? session?.runningSummary;
    if (runningSummary) {
      messages.push({
        role: 'system',
        content: `=== CONVERSATION SUMMARY ===\n${runningSummary}\n===========================`,
      });
    }

    // Phase C: Inject structured business memory
    if (memoryContext?.aiMemory) {
      messages.push({
        role: 'system',
        content: memoryContext.aiMemory,
      });
    }

    // Phase C: Inject relevant past conversations / semantic memory
    if (memoryContext?.semanticMemory) {
      messages.push({
        role: 'system',
        content: memoryContext.semanticMemory,
      });
    }

    // Phase D: Inject learned lessons from past feedback
    if (memoryContext?.lessons) {
      messages.push({
        role: 'system',
        content: memoryContext.lessons,
      });
    }

    const contextSummary = this.contextService.formatContextForPrompt(context);
    messages.push({
      role: 'system',
      content: contextSummary,
    });

    // Phase C: Include recent session messages for multi-turn coherence
    if (session && session.messages.length > 0) {
      const recentMessages = session.messages.slice(-10);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'action_result' ? 'system' : msg.role,
          content: msg.content,
        });
      }
    }

    messages.push({
      role: 'user',
      content: query.text,
    });

    return messages;
  }

  /**
   * Classify a user query into a ModelGateway task category.
   */
  classifyTaskCategory(query: CortexQuery): TaskCategory {
    const text = query.text.toLowerCase();

    // Action-heavy queries → tool-calling
    if (query.enableActions && /\b(create|add|schedule|send|update|delete|run|execute|make|book|invoice|task|email|reminder|workflow)\b/.test(text)) {
      return 'tool-calling';
    }

    // Emotional / interpersonal / tone queries
    if (/\b(feel|feeling|stressed|overwhelmed|frustrated|angry|worried|anxious|excited|happy|disappointed|conflict|team morale|burnout)\b/.test(text)) {
      return 'emotion-analysis';
    }

    // Code / technical
    if (/\b(code|script|function|api|bug|error|debug|typescript|javascript|python|sql|query|endpoint|integration)\b/.test(text)) {
      return 'code';
    }

    // Creative / ideation / writing
    if (/\b(idea|brainstorm|creative|write|draft|compose|design|campaign|slogan|content|story|pitch)\b/.test(text)) {
      return 'creative';
    }

    // Forecasting / trends / prediction
    if (/\b(forecast|predict|trend|projection|next month|next quarter|seasonality|runway|growth rate|churn forecast|revenue forecast)\b/.test(text)) {
      return 'forecasting';
    }

    // Data extraction from text
    if (/\b(extract|parse|pull out|find the|get the|what is the|lookup)\b/.test(text)) {
      return 'extraction';
    }

    // Summarization
    if (/\b(summarize|summary|tl;dr|recap|condense|brief|overview)\b/.test(text)) {
      return 'summarization';
    }

    // Classification / routing
    if (/\b(classify|categorize|which type|what kind|is this|route to|assign to)\b/.test(text)) {
      return 'classification';
    }

    // Reasoning-heavy queries
    if (/\b(analyze|reason|think|why|how does|explain|compare|evaluate|assess|strategy|recommend|should i|what if|pros and cons)\b/.test(text)) {
      return 'reasoning';
    }

    // Analysis of existing data
    if (/\b(analysis|metric|kpi|performance|report|number|data|roi|conversion|revenue|expense)\b/.test(text)) {
      return 'analysis';
    }

    return 'general';
  }

  /**
   * Parse a structured response into the KEY 10/10 output shape.
   */
  parseStructuredResponse(content: string): {
    role?: string;
    analysis?: string;
    hiddenSignals: string[];
    recommendation?: string;
    risks: string[];
    successMetrics: string[];
    nextStep?: string;
    confidence: number;
    frameworks: string[];
  } {
    const empty = {
      role: undefined,
      analysis: undefined,
      hiddenSignals: [] as string[],
      recommendation: content || '',
      risks: [] as string[],
      successMetrics: [] as string[],
      nextStep: undefined,
      confidence: 70,
      frameworks: [] as string[],
    };

    if (!content || !content.includes('**')) {
      return empty;
    }

    const sectionLabels = [
      'Role Mode',
      'Analysis',
      'Hidden Signals',
      'Recommendation',
      'Risk Check',
      'Success Metrics',
      'Next Step',
      'Confidence',
    ];

    const normalized = content.replace(/\r\n/g, '\n');

    const findSection = (label: string): { labelStart: number; contentStart: number } | undefined => {
      const patterns = [
        new RegExp(`\\*\\*${label}\\*\\*[\\s:]*`, 'i'),
        new RegExp(`${label}:[\\s]*`, 'i'),
      ];
      for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.index !== undefined) {
          return { labelStart: match.index, contentStart: match.index + match[0].length };
        }
      }
      return undefined;
    };

    const sections: Record<string, string> = {};
    const positions: Array<{ label: string; labelStart: number; contentStart: number }> = [];

    for (const label of sectionLabels) {
      const pos = findSection(label);
      if (pos) {
        positions.push({ label, ...pos });
      }
    }

    positions.sort((a, b) => a.contentStart - b.contentStart);

    for (let i = 0; i < positions.length; i++) {
      const current = positions[i];
      const next = positions[i + 1];
      const end = next ? next.labelStart : normalized.length;
      sections[current.label] = normalized
        .slice(current.contentStart, end)
        .replace(/\n\s*\n/g, '\n')
        .trim();
    }

    const parseList = (raw?: string): string[] => {
      if (!raw) return [];
      return raw
        .split(/\n|•|-\s*|\d+\.\s*/)
        .map(s => s.replace(/^[-•]\s*/, '').trim())
        .filter(s => s.length > 0);
    };

    const role = sections['Role Mode'];
    const frameworks: string[] = [];
    if (role) frameworks.push(`Role: ${role}`);

    return {
      role,
      analysis: sections['Analysis'],
      hiddenSignals: parseList(sections['Hidden Signals']),
      recommendation: sections['Recommendation'] || content,
      risks: parseList(sections['Risk Check']),
      successMetrics: parseList(sections['Success Metrics']),
      nextStep: sections['Next Step'],
      confidence: this.parseConfidence(sections['Confidence'] ?? ''),
      frameworks,
    };
  }

  private parseConfidence(raw: string): number {
    if (!raw) return 70;
    const match = raw.match(/(\d{1,3})/);
    if (!match) return 70;
    const value = parseInt(match[1], 10);
    return Math.min(Math.max(value, 0), 100);
  }


  // ==========================================================================
  // 4. Suggestion Generation (preserved + v2 enrichment)
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

      const result = await (this.modelGateway as any).complete({
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
        .filter((s: any) => typeof s === 'string' && s.length > 5)
        .slice(0, 3);
    } catch (error: any) {
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
  // 5. v3 Genome-Aware Reasoning Helpers (preserved public API)
  // ==========================================================================

  /**
   * Get a genome-enriched context by combining genome intelligence with the v2 context.
   * Results are cached for 60 seconds to avoid repeated calls.
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
      await (this.genomeBridgeService as any).getGenomeIntelligence(businessId);

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
    } catch (err: any) {
      this.logger.warn(
        `[shouldSuggestProactiveAction] business=${businessId}: check failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Get proactive suggestions based on genome intelligence.
   */
  async getProactiveSuggestions(businessId: string): Promise<Suggestion[]> {
    if (!this.genomeBridgeService) {
      return [];
    }

    try {
      // Get genome context (uses cache)
      const genomeContext = await this.getGenomeEnrichedContext(businessId);

      // Also get v2 context for richer suggestions
      let v2Context: any = {};
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
        5,
      );

      // Filter to top 3 most impactful
      const topRecs = rankedRecs
        .filter((r) => r.impact >= 0.7 || r.confidence > 0.7)
        .slice(0, 3);

      // Format as suggestions
      const suggestions: Suggestion[] = topRecs.map((rec) => ({
        id: rec.id ?? this.generateId(),
        title: rec.title,
        description: rec.recommendation ?? rec.insight,
        impact: this.impactNumberToLevel(rec.impact),
        category: rec.domain,
        source: 'genome',
        confidence: rec.confidence,
        action: `Consider ${rec.title.toLowerCase()} to improve ${rec.domain}`,
      }));

      // If no high-impact recommendations, use urgent signals
      if (suggestions.length === 0) {
        const urgentSignals = genomeContext.signals.filter((s: any) => s.severity === 'critical' || s.severity === 'high',
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
    } catch (err: any) {
      this.logger.warn(
        `[getProactiveSuggestions] business=${businessId}: failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Explain a decision by looking it up in the event log and generating
   * a human-readable explanation that includes genome context at the time.
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
          eventLog = await (this.eventService as any).getEventLog(decisionId);
        } catch {
          // Event service may not have this decision
        }
      }

      // If no event log, try to reconstruct from session/prisma
      let decisionData: Record<string, unknown> = {};
      if (eventLog.length === 0) {
        // Try to find the session message with this correlation ID
        const session = await (this.prisma.client as any).cortexSession.findFirst({
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
          steps: eventLog.map((e: any) => e.step),
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
${eventLog.length > 0 ? eventLog.map((e: any) => `- ${e.step} at ${e.timestamp}`).join('\n') : 'Steps not available in event log'}

${genomeContext ? `Genome Context at Decision Time:
- Genome Stage: ${genomeContext.genomeStage}
- Executive Readiness: ${genomeContext.executiveReadiness}%
- DNA Scores: ${JSON.stringify(genomeContext.dnaScores)}
- Active Signals: ${genomeContext.signals.length}
- Top Recommendation: ${genomeContext.recommendations[0]?.title ?? 'None'}` : 'Genome context not available'}

Write a 3-4 sentence explanation of this decision that a non-technical business owner can understand. Be transparent about what data was used and why the decision was made. Use first person ("I decided...").`;

      const result = await (this.modelGateway as any).complete({
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
    } catch (error: any) {
      this.logger.error(
        `[explainDecision] Failed for ${decisionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return `Unable to explain decision ${decisionId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Learn from a user interaction by recording feedback, updating preferences,
   * and feeding outcomes to the genome outcome learning system.
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
      await (this.prisma.client as any).keyInteractionFeedback.create({
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
            average: ratings.reduce((a: any, b: any) => a + b, 0) / ratings.length,
          },
          86400 * 30, // 30 days
        );

        this.logger.debug(
          `[learnFromInteraction] Rating ${rating}/5 recorded. Average: ${(ratings.reduce((a: any, b: any) => a + b, 0) / ratings.length).toFixed(2)}`,
        );
      }

      // Feed to genome outcome learning
      if (this.genomeV3Enabled && this.genomeBridgeService) {
        try {
          // Report successful actions as positive outcomes
          for (const actionId of interaction.actionsTaken) {
            await (this.genomeBridgeService as any).reportActionOutcome(
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
            await (this.genomeBridgeService as any).reportActionOutcome(
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
            await (this.genomeBridgeService as any).createEvidence(
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
        } catch (err: any) {
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
    } catch (error: any) {
      this.logger.error(
        `[learnFromInteraction] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }


  // ==========================================================================
  // 6. v2 PUBLIC API — Direct Command Execution (preserved)
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

        const result = await (this.executorService as any).execute(command, {
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
          await (this.genomeBridgeService as any).reportActionOutcome(businessId, {
            actionId: action,
            status: actionResult.status,
            description: actionResult.description,
            result: actionResult.result ?? {},
            timestamp: new Date(),
            correlationId,
          });
        }

        return actionResult;
      } catch (err: any) {
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
  // 7. v2 PUBLIC API — Module Query (preserved)
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
        const result = await (this.connectorService as any).query(
          module as any,
          queryName,
          { ...params, businessId },
        );
        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (err: any) {
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
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Legacy query failed',
      };
    }
  }

  // ==========================================================================
  // 8. v2 PUBLIC API — Get Capabilities (preserved)
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
        .map((cap: any) => ({
          module: cap.module,
          actions: cap.actions.map((a: any) => a.name),
          queries: cap.queries.map((q: any) => q.name),
          description: cap.description,
        }));
    }

    // Legacy: return static capability list
    return this.getLegacyCapabilities();
  }

  // ==========================================================================
  // 9. Gateway-compatible streaming alias (preserved)
  // ==========================================================================

  /**
   * Gateway-compatible streaming alias.
   * Yields the response as a single text chunk (full-response fallback).
   */
  async *streamReasoning(query: {
    userId: string;
    businessId: string;
    message: string;
    sessionId?: string;
    persona?: string;
    context?: Record<string, unknown>;
  }): AsyncIterable<{
    type: 'text' | 'thought' | 'error';
    content: string;
    done?: boolean;
    metadata?: Record<string, unknown>;
  }> {
    yield { type: 'thought', content: 'Reasoning...' };
    try {
      const response = await this.processQuery({
        text: query.message,
        businessId: query.businessId,
        userId: query.userId,
        sessionId: query.sessionId,
        persona: query.persona as any,
      });
      yield {
        type: 'text',
        content: typeof (response as any)?.response === 'string' ? (response as any).response : JSON.stringify((response as any)?.response ?? ''),
        done: true,
      };
    } catch (err: any) {
      yield {
        type: 'error',
        content: err instanceof Error ? err.message : String(err),
        done: true,
      };
    }
  }

  // ==========================================================================
  // Private Helpers (preserved)
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
        await (this.eventService as any).logEvent({
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
          return (this.prisma.client as any).contact.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { updatedAt: 'desc' },
          });
        }
        if (queryName === 'get_contact') {
          return (this.prisma.client as any).contact.findFirst({
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
          return (this.prisma.client as any).invoice.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { createdAt: 'desc' },
          });
        }
        break;
      }
      case 'bookings': {
        if (queryName === 'get_bookings') {
          return (this.prisma.client as any).booking.findMany({
            where: { businessId, deletedAt: null },
            take: (params.limit as number) ?? 50,
            orderBy: { startTime: 'desc' },
          });
        }
        break;
      }
      case 'autopilot': {
        if (queryName === 'get_tasks') {
          return (this.prisma.client as any).autopilotTask.findMany({
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

  private generateId(): string {
    return `crtx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private impactNumberToLevel(impact: number): 'high' | 'medium' | 'low' {
    if (impact >= 0.7) return 'high';
    if (impact >= 0.4) return 'medium';
    return 'low';
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
}
