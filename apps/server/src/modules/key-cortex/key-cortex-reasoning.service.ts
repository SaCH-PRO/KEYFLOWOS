import {
  Injectable,
  Logger,
  Inject,
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
} from './key-cortex.types';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';

/**
 * KeyCortexReasoningService -- The Core Reasoning Brain of KEY Cortex.
 *
 * This is the heart of the JARVIS-like AI system for KeyFlowOS. It orchestrates
 * multi-provider AI processing, action detection, insight generation, and the
 * signature "profit machine" feature that identifies revenue opportunities across
 * business data.
 *
 * Responsibilities:
 * - Process user queries through the ModelGatewayService
 * - Select appropriate AI provider based on query type and preferences
 * - Handle streaming (SSE) and non-streaming responses
 * - Detect and trigger actions from AI responses
 * - Generate business insights and profit opportunities
 * - Track token usage, latency, and costs
 */
@Injectable()
export class KeyCortexReasoningService {
  private readonly logger = new Logger(KeyCortexReasoningService.name);

  /** Maximum tokens allowed in a context window before optimization. */
  private readonly MAX_CONTEXT_TOKENS: number;

  /** Session TTL in seconds (default: 24 hours). */
  private readonly SESSION_TTL: number;

  /** Cost tracking: estimated cost per 1K tokens by provider. */
  private readonly COST_PER_1K_TOKENS: Record<CortexProvider, { input: number; output: number }> = {
    openai: { input: 0.0025, output: 0.01 },
    anthropic: { input: 0.003, output: 0.015 },
    xai: { input: 0.005, output: 0.015 },
    kimi: { input: 0.001, output: 0.004 },
    native: { input: 0, output: 0 },
    opensource: { input: 0, output: 0 },
  };

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly personalityService: KeyCortexPersonalityService,
    private readonly contextService: KeyCortexContextService,
    private readonly actionsService: KeyCortexActionsService,
  ) {
    this.MAX_CONTEXT_TOKENS =
      parseInt(process.env.KEY_CORTEX_MAX_CONTEXT_TOKENS ?? '8000', 10);
    this.SESSION_TTL =
      parseInt(process.env.KEY_CORTEX_SESSION_TTL_HOURS ?? '24', 10) * 3600;
  }

  // ---------------------------------------------------------------------------
  // 1. Non-Streaming Query Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a user query end-to-end (non-streaming).
   *
   * Flow:
   *  1. Get or create a session
   *  2. Build a context snapshot via KeyCortexContextService
   *  3. Get personality config via KeyCortexPersonalityService
   *  4. Build a system prompt with context + personality
   *  5. Select the best AI provider for this query
   *  6. Call ModelGatewayService.complete()
   *  7. Detect actions in the AI response
   *  8. Execute actions via KeyCortexActionsService
   *  9. Save the message to the session
   * 10. Return a fully populated CortexResponse
   */
  async processQuery(query: CortexQuery): Promise<CortexResponse> {
    const startTime = Date.now();
    this.logger.log(
      `[processQuery] business=${query.businessId} user=${query.userId} persona=${query.persona ?? 'default'}`,
    );

    try {
      // Step 1 -- Get or create session
      const session = await this.getOrCreateSession(query);

      // Step 2 -- Build context snapshot
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(query.businessId);

      // Step 3 -- Get personality configuration
      const persona: CortexPersona = query.persona ?? session.persona ?? 'jarvis';
      const personalityConfig =
        this.personalityService.getPersonalityConfig(persona);

      // Step 4 -- Build system prompt with context + personality
      const systemPrompt = this.personalityService.buildSystemPrompt(
        persona,
        contextSnapshot,
      );

      // Step 5 -- Select AI provider
      const preferences: AiPreferences = {
        preferredProvider: query.provider ?? personalityConfig.persona,
        budgetMode: false,
      };
      const { provider, model } = await this.selectProvider(query, preferences);

      // Step 6 -- Build message array and call model gateway
      const messages = this.buildMessages(query, contextSnapshot, systemPrompt);
      const completionResult = await this.modelGateway.complete({
        messages,
        model,
        temperature: personalityConfig.temperature,
        maxTokens: this.MAX_CONTEXT_TOKENS,
        tools: await this.actionsService.buildToolDefinitions(query.businessId),
      });

      const latencyMs = Date.now() - startTime;

      // Build the assistant message
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
        },
      };

      // Step 7 -- Detect actions in response
      const detectedActions = query.enableActions
        ? await this.detectActions(completionResult.content)
        : [];

      // Step 8 -- Execute actions (if any)
      let executedActions: CortexActionResult[] = [];
      if (detectedActions.length > 0 && query.enableActions) {
        executedActions = await this.actionsService.executeActions(
          detectedActions,
          session,
        );
        assistantMessage.metadata!.actionsTriggered = executedActions;
      }

      // Step 9 -- Save messages to session
      await this.saveMessage(session.id, {
        role: 'user',
        content: query.text,
        timestamp: new Date(),
      });
      await this.saveMessage(session.id, assistantMessage);

      // Step 10 -- Generate follow-up suggestions
      const suggestions = await this.generateSuggestions(
        query.businessId,
        assistantMessage.content,
      );

      this.logger.log(
        `[processQuery] Completed in ${latencyMs}ms | provider=${provider} model=${model} tokens=${assistantMessage.metadata?.tokensUsed}`,
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
      };
    } catch (error) {
      this.logger.error(
        `[processQuery] Failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        `KEY Cortex reasoning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Streaming Query Processing (SSE)
  // ---------------------------------------------------------------------------

  /**
   * Process a user query with Server-Sent Events (SSE) streaming.
   *
   * Flow:
   *  1-5. Same setup as processQuery (session, context, personality, provider)
   *  6. Call ModelGatewayService.streamComplete() -- yields chunks
   *  7. Yield CortexStreamChunk for each text delta
   *  8. Detect actions from accumulated text
   *  9. Yield action chunks
   * 10. Save final message to session
   */
  async *streamQuery(
    query: CortexQuery,
  ): AsyncGenerator<CortexStreamChunk> {
    const startTime = Date.now();
    this.logger.log(
      `[streamQuery] business=${query.businessId} user=${query.userId} stream=true`,
    );

    try {
      // Steps 1-5 -- Same setup as non-streaming
      const session = await this.getOrCreateSession(query);
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(query.businessId);
      const persona: CortexPersona =
        query.persona ?? session.persona ?? 'jarvis';
      const personalityConfig =
        this.personalityService.getPersonalityConfig(persona);
      const systemPrompt = this.personalityService.buildSystemPrompt(
        persona,
        contextSnapshot,
      );
      const preferences: AiPreferences = {
        preferredProvider: query.provider ?? personalityConfig.persona,
        budgetMode: false,
      };
      const { provider, model } = await this.selectProvider(query, preferences);
      const messages = this.buildMessages(query, contextSnapshot, systemPrompt);

      // Yield initial "thought" chunk
      yield {
        type: 'thought',
        thought: `Analyzing context for ${contextSnapshot.genomeStage} stage business...`,
      };

      // Step 6 -- Stream completion
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

      // Step 8 -- Detect actions from accumulated text
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

        // Execute actions
        const executedActions = await this.actionsService.executeActions(
          detectedActions,
          session,
        );

        // Yield execution results
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

      // Step 10 -- Save final message
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
        },
      };

      await this.saveMessage(session.id, {
        role: 'user',
        content: query.text,
        timestamp: new Date(),
      });
      await this.saveMessage(session.id, assistantMessage);

      this.logger.log(
        `[streamQuery] Completed in ${latencyMs}ms | provider=${provider} model=${model}`,
      );

      yield { type: 'done' };
    } catch (error) {
      this.logger.error(
        `[streamQuery] Failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      yield {
        type: 'error',
        error: `Streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Action Detection
  // ---------------------------------------------------------------------------

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
          // Avoid duplicates
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

  // ---------------------------------------------------------------------------
  // 4. Insight Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate AI-powered business insights based on query and business data.
   *
   * Combines business genome context with AI analysis to surface opportunities,
   * risks, trends, and anomalies relevant to the user's query.
   */
  async generateInsights(
    businessId: string,
    query: string,
  ): Promise<CortexInsight[]> {
    this.logger.log(`[generateInsights] business=${businessId}`);

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

      // Extract JSON from response
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn('[generateInsights] No JSON array found in response');
        return [];
      }

      const insights: CortexInsight[] = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      return insights
        .filter(
          (i) =>
            i.type && i.title && i.description && typeof i.confidence === 'number',
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

  // ---------------------------------------------------------------------------
  // 5. Profit Opportunities -- The "Profit Machine"
  // ---------------------------------------------------------------------------

  /**
   * Find profit opportunities across business data.
   *
   * This is KEY Cortex's signature differentiator -- the "profit machine".
   * It queries business data (invoices, leads, tasks, projects) and uses AI
   * to identify revenue opportunities, cost savings, and automation potential.
   *
   * Returns a ranked list of CortexProfitOpportunity objects sorted by
   * estimated revenue impact and confidence.
   */
  async findProfitOpportunities(
    businessId: string,
  ): Promise<CortexProfitOpportunity[]> {
    this.logger.log(`[findProfitOpportunities] business=${businessId}`);

    try {
      // Gather business data
      const [
        invoices,
        leads,
        tasks,
        projects,
        contextSnapshot,
      ] = await Promise.all([
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

      // Calculate derived metrics
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

      // Build the profit analysis prompt
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
        model: 'gpt-4o', // Use stronger model for profit analysis
        temperature: 0.8,
        maxTokens: 4000,
      });

      // Extract JSON array
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

      // Validate, normalize, and sort by estimated revenue * confidence
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

      // Sort by (estimatedRevenue * confidence) descending
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

  // ---------------------------------------------------------------------------
  // 6. Smart Provider Selection
  // ---------------------------------------------------------------------------

  /**
   * Select the optimal AI provider based on query characteristics and preferences.
   *
   * Selection logic:
   * - Reasoning/Analysis -> Kimi (Moonshot) for deep reasoning, fallback to GPT-4o
   * - Fast responses -> GPT-4o-mini or Grok-2-mini
   * - Creative/Ideation -> Claude Sonnet or GPT-4o
   * - Budget mode -> GPT-4o-mini primarily
   * - User override -> Respect query.preferredProvider
   */
  async selectProvider(
    query: CortexQuery,
    preferences: AiPreferences,
  ): Promise<{ provider: CortexProvider; model: string }> {
    // User override takes highest priority
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

    // Detect query type from content
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
      // Prefer Kimi for deep reasoning
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

    // Default: GPT-4o for balanced performance
    return { provider: 'openai', model: 'gpt-4o' };
  }

  // ---------------------------------------------------------------------------
  // 7. Message Building
  // ---------------------------------------------------------------------------

  /**
   * Build the message array for the model gateway from query, context, and system prompt.
   */
  buildMessages(
    query: CortexQuery,
    context: CortexContextSnapshot,
    systemPrompt: string,
  ): GatewayMessage[] {
    const messages: GatewayMessage[] = [];

    // System prompt with personality + context
    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Add context summary as a system message
    const contextSummary = this.contextService.formatContextForPrompt(context);
    messages.push({
      role: 'system',
      content: contextSummary,
    });

    // Add user query
    messages.push({
      role: 'user',
      content: query.text,
    });

    return messages;
  }

  // ---------------------------------------------------------------------------
  // 8. Mood Detection
  // ---------------------------------------------------------------------------

  /**
   * Detect the user's mood from their query text.
   *
   * Uses keyword heuristics to determine mood -- lightweight and fast.
   * For production, this can be replaced with a dedicated classifier model.
   */
  async detectMood(query: string): Promise<CortexMood> {
    const text = query.toLowerCase();

    // Urgent indicators
    if (
      /\b(?:urgent|asap|emergency|critical|deadline|now|immediately|hurry)\b/.test(
        text,
      )
    ) {
      return 'urgent';
    }

    // Creative indicators
    if (
      /\b(?:idea|creative|brainstorm|imagine|design|innovative|fun|exciting|inspiration)\b/.test(
        text,
      )
    ) {
      return 'creative';
    }

    // Analytical indicators
    if (
      /\b(?:analyze|data|metric|report|numbers|compare|evaluate|performance|kpi|roi)\b/.test(
        text,
      )
    ) {
      return 'analytical';
    }

    // Casual indicators
    if (
      /\b(?:hey|hi|hello|thanks|please|help me|can you|would you|maybe|perhaps)\b/.test(
        text,
      ) &&
      text.length < 150
    ) {
      return 'casual';
    }

    // Default
    return 'focused';
  }

  // ---------------------------------------------------------------------------
  // 9. Suggestion Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate follow-up suggestions based on the last assistant message and business context.
   */
  async generateSuggestions(
    businessId: string,
    lastMessage: string,
  ): Promise<string[]> {
    try {
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(businessId);

      const suggestionPrompt = `Based on the following AI assistant response and business context, suggest 3 natural follow-up questions or commands the user might want to ask next.

Assistant's last message (excerpt): "${lastMessage.slice(0, 500)}"

Business context:
- Genome Stage: ${contextSnapshot.genomeStage}
- Pending invoices: ${contextSnapshot.pendingInvoices}
- Active projects: ${contextSnapshot.activeProjects.length}
- Unread messages: ${contextSnapshot.unreadMessages}

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
        'Create a task from this',
        'What are the next steps?',
      ];
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get an existing session or create a new one.
   */
  private async getOrCreateSession(
    query: CortexQuery,
  ): Promise<{ id: string; persona: CortexPersona; [key: string]: unknown }> {
    // Check Redis for active session
    if (query.sessionId) {
      const cached = await this.redis.get(`cortex:session:${query.sessionId}`);
      if (cached) {
        const session = JSON.parse(cached);
        // Extend TTL
        await this.redis.setex(
          `cortex:session:${query.sessionId}`,
          this.SESSION_TTL,
          cached,
        );
        return session;
      }

      // Fall through to DB lookup
      const dbSession = await this.prisma.cortexSession.findUnique({
        where: { id: query.sessionId },
      });
      if (dbSession) {
        // Cache in Redis
        await this.redis.setex(
          `cortex:session:${query.sessionId}`,
          this.SESSION_TTL,
          JSON.stringify(dbSession),
        );
        return dbSession as unknown as { id: string; persona: CortexPersona };
      }
    }

    // Create new session
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

    // Cache in Redis
    await this.redis.setex(
      `cortex:session:${newSession.id}`,
      this.SESSION_TTL,
      JSON.stringify(newSession),
    );

    this.logger.log(`[getOrCreateSession] Created new session=${newSession.id}`);

    return newSession as unknown as { id: string; persona: CortexPersona };
  }

  /**
   * Save a message to a session (Redis cache + Prisma persistence).
   */
  private async saveMessage(
    sessionId: string,
    message: Omit<CortexMessage, 'id'> & { id?: string },
  ): Promise<void> {
    // Update Prisma
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

    // Invalidate and update Redis cache
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

  /**
   * Estimate cost based on provider and token usage.
   */
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

  /**
   * Calculate a confidence score for the response quality.
   */
  private calculateConfidence(
    content: string,
    context: CortexContextSnapshot,
  ): number {
    let score = 0.7; // Base confidence

    // Boost if content references business data
    if (content.includes('$') || content.includes('%')) score += 0.1;
    if (content.toLowerCase().includes(context.genomeStage.toLowerCase()))
      score += 0.05;
    if (content.length > 200) score += 0.05;

    // Penalize generic responses
    if (content.length < 50) score -= 0.2;
    if (/I don't have|I cannot|I'm not sure/i.test(content)) score -= 0.15;

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Check if an action type is valid.
   */
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

  /**
   * Determine if an action type requires user approval before execution.
   */
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

  /**
   * Generate fallback profit opportunities when AI analysis fails.
   */
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
        estimatedRevenue: (metrics.totalLeadValue ?? 0) * 0.2, // Assume 20% conversion
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
        estimatedRevenue: 5000, // Estimated value of unblocking
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
        estimatedRevenue: 10000, // Estimated savings
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

    return ops.sort((a, b) => b.estimatedRevenue * b.confidence - a.estimatedRevenue * a.confidence);
  }

  /**
   * Get default suggestions based on business context.
   */
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

  /**
   * Generate a unique identifier.
   */
  private generateId(): string {
    return `crtx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
