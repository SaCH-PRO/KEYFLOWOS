import { Inject, Injectable, Logger, ForbiddenException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AI_CREDIT_COSTS, AI_OVERAGE_RATE_TTD, AI_OVERAGE_RATE_USD, isBillableAiFeature } from '../subscriptions/plans';
import { OutputCategory, ResolvedTemplate, injectQualityDirectives, validateAiOutput, buildQualityDirectiveSuffix } from './ai-quality';
import { OutputTemplateService } from './output-template.service';
import { ModelGatewayService, TaskCategory, GatewayMessage, BudgetStatus, AiProvider, GatewayRequest, GatewayResponse, StreamChunk } from './model-gateway.service';
import OpenAI from 'openai';

/**
 * responseMode controls quality directive injection and output validation:
 * - 'user_text' (default): injects quality directives + validates output.
 *   Use for all user-facing AI text: chat, reports, documents, marketing copy, briefings.
 * - 'structured_json': skips quality directives and validation.
 *   Use ONLY when the system prompt demands strict machine-parseable JSON output
 *   (search parsers, command interpreters, data extractors) where formatting
 *   directives would corrupt the JSON schema and break downstream JSON.parse() calls.
 */
type AiResponseMode = 'user_text' | 'structured_json';

interface AiCallOptions {
  businessId: string;
  userId?: string;
  feature: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  outputCategory?: OutputCategory;
  responseMode?: AiResponseMode;
  taskCategory?: TaskCategory;
  /** @deprecated Use responseMode: 'structured_json' instead */
  skipQualityDirectives?: boolean;
}

interface AiCallResult {
  content: string;
  provider?: string;
  model?: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
    estimatedCost: number;
  };
}

interface UsageSummary {
  currentPlan: string;
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  isUnlimited: boolean;
  overageCredits: number;
  overageCost: number;
  overageCurrency: string;
  totalEstimatedCost: number;
  periodStart: Date;
  periodEnd: Date;
  byFeature: Array<{ feature: string; credits: number; calls: number; cost: number }>;
  budget?: BudgetStatus;
}

/**
 * Exported so a test can assert every feature passed to trackAndComplete has an
 * entry. An unmapped feature falls through to 'general' and is billed at the
 * top model rate without anyone choosing that, which is exactly how the entire
 * cortex background workload ended up on gpt-4o.
 */
export const FEATURE_TASK_MAP: Record<string, TaskCategory> = {
  flow_chat: 'tool-calling',
  plan_decompose: 'reasoning',
  intent_parse: 'classification',
  briefing: 'summarization',
  cash_flow_forecast: 'reasoning',
  business_model: 'reasoning',
  seo_score: 'extraction',
  simulate: 'reasoning',
  chat: 'general',
  profile_interview: 'extraction',
  // Both arrived with integration/2026-07-consolidation and spend money without
  // declaring what kind of work they are, so they fell through to 'general' and
  // were billed at gpt-4o rates that nobody chose. Both pull structured fields
  // out of free text, which is what 'extraction' already covers.
  genome_extraction: 'extraction',
  contract_clause_extract: 'extraction',
  strategic_dashboard: 'reasoning',
  revenue_forecast: 'reasoning',
  profitability: 'reasoning',
  pricing_advisor: 'reasoning',
  seasonal_patterns: 'reasoning',
  opportunities: 'reasoning',
  risks: 'reasoning',
  weekly_plan: 'reasoning',
  crm_insight: 'summarization',
  crm_churn_risk: 'classification',
  crm_search: 'extraction',
  commerce_analyze: 'reasoning',
  ai_reminder: 'content-generation',
  ai_pricing: 'reasoning',
  schedule_optimizer: 'reasoning',
  no_show_predictor: 'classification',
  campaign_content: 'content-generation',
  marketing_strategy: 'reasoning',
  draft_followup_message: 'content-generation',
  draft_campaign_bundle: 'content-generation',
  draft_payment_reminder: 'content-generation',
  draft_storefront_copy: 'content-generation',
  draft_project_update: 'content-generation',
  intro_draft: 'content-generation',
  need_match: 'reasoning',
  relationship_insights: 'reasoning',
  seo_content_brief: 'content-generation',
  seo_gap_analysis: 'reasoning',
  growth_insight: 'reasoning',
  // Tracked modalities
  conversation_handle: 'classification',
  document_extract: 'extraction',
  calendar_suggest: 'analysis',
  semantic_embedding: 'extraction',
  vision_extract: 'extraction',
  vision_product: 'extraction',
  vision_contact: 'extraction',
  audio_tts: 'content-generation',
  audio_stt: 'extraction',
  flow_chat_stream: 'tool-calling',
  feedback_loop: 'analysis',
  pattern_detect: 'analysis',
  profile_intel: 'extraction',
  storefront_intel: 'reasoning',
  calendar_insight: 'analysis',
  revenue_action: 'reasoning',
  note_summarize: 'summarization',
  automation_generate: 'tool-calling',

  // ─── Cortex background work ────────────────────────────────────────────────
  //
  // None of these were mapped, so resolveTaskCategory fell through to 'general'
  // — which the balanced routing table points at gpt-4o, the most expensive
  // model available. They are the highest-VOLUME calls in the system by a wide
  // margin (reflection alone can make 21 per business per tick, and it ticks
  // every 30 minutes), and not one of them is a reasoning task: they rank,
  // classify and summarise, which is exactly what the map already sends to
  // gpt-4o-mini for sixty other features.
  //
  // gpt-4o vs gpt-4o-mini is roughly 12x on input and 9x on output, so this
  // costs nothing in behaviour and removes most of the background bill.
  //
  // A feature absent from this map is silently billed at the top rate, which is
  // why the omission was invisible. `ai-usage-feature-coverage.spec.ts` now
  // asserts every feature string passed to trackAndComplete appears here.
  'reflection-rank': 'analysis',
  'reflection-outcome': 'classification',
  'dream-connections': 'analysis',
  // Left on the expensive tier deliberately: hypothesis generation is the one
  // place where output quality is the whole point, and it runs twice per
  // business per night rather than 48 times a day.
  'dream-hypotheses': 'creative',
  'synthesis-report': 'summarization',
  'intuition-semantic': 'analysis',
  'intuition-anomaly-explain': 'analysis',

  // Ideation. Kept on the expensive tier on purpose — this is the one place
  // where the quality of the output IS the product, and each runs once a day
  // rather than on a 10- or 30-minute sweep. The cost lever here is how many
  // techniques get invoked per run, not which model answers them.
  'creativity-strategy': 'creative',
  'creativity-lateral': 'creative',
  'creativity-combination': 'creative',
  'creativity-inversion': 'creative',
  'creativity-analogy': 'creative',
  'creativity-constraint-removal': 'creative',
  'creativity-extreme-users': 'creative',
  'creativity-trend-riding': 'creative',
  'creativity-problem-first': 'creative',

  // Interpreting a user's phrasing into a structured intent. Classification by
  // any other name, and previously billed as open-ended reasoning.
  key_flow_interpret: 'classification',
  key_delegation_interpret: 'classification',
  key_calendar_interpret: 'classification',
  key_inbox_classify: 'classification',

  key_inbox_intelligence: 'analysis',
  key_inbox_brief: 'summarization',
  calendar_action_intelligence: 'analysis',
  blueprint_onboarding: 'extraction',

  // There is a dedicated category for this; it was falling through to general.
  emotion_detection: 'emotion-analysis',

  // Genuinely multi-step reasoning, and named so deliberately rather than by
  // omission.
  reasoning_engine: 'reasoning',
};

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  // Per-business AI-call ceiling per minute. Chat is the product's main
  // interface and each turn can involve several AI calls (reply, tools,
  // background extraction), so the ceiling needs conversational headroom.
  private readonly RATE_LIMIT_PER_MINUTE = 120;
  private readonly rateLimitMap = new Map<string, number[]>();
  private rateLimitCleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SubscriptionsService) private readonly subscriptionsService: SubscriptionsService,
    @Inject(OutputTemplateService) private readonly outputTemplateService: OutputTemplateService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
  ) {
    this.rateLimitCleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      for (const [key, timestamps] of this.rateLimitMap.entries()) {
        const filtered = timestamps.filter(t => t > cutoff);
        if (filtered.length === 0) {
          this.rateLimitMap.delete(key);
        } else {
          this.rateLimitMap.set(key, filtered);
        }
      }
    }, 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.rateLimitCleanupTimer);
  }

  checkRateLimit(businessId: string): void {
    const now = Date.now();
    const cutoff = now - 60_000;
    const timestamps = this.rateLimitMap.get(businessId) || [];
    const recent = timestamps.filter(t => t > cutoff);

    if (recent.length >= this.RATE_LIMIT_PER_MINUTE) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'AI rate limit exceeded. Please wait a moment before trying again.',
          code: 'RATE_LIMIT_EXCEEDED',
        },
        429,
      );
    }

    recent.push(now);
    this.rateLimitMap.set(businessId, recent);
  }

  private injectDirectivesIntoMessages(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    template: ResolvedTemplate,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const modified = [...messages];
    const systemIdx = modified.findIndex(m => m.role === 'system');

    if (systemIdx >= 0) {
      modified[systemIdx] = {
        ...modified[systemIdx],
        content: injectQualityDirectives(modified[systemIdx].content, template),
      };
    } else {
      modified.unshift({
        role: 'system',
        content: buildQualityDirectiveSuffix(template),
      });
    }

    return modified;
  }

  private resolveTaskCategory(feature: string, explicit?: TaskCategory): TaskCategory {
    if (explicit) return explicit;
    return FEATURE_TASK_MAP[feature] || 'general';
  }

  async callAi(options: AiCallOptions): Promise<AiCallResult> {
    const { businessId, userId, feature, maxTokens = 500, temperature = 0.7 } = options;
    const outputCategory: OutputCategory = options.outputCategory || 'general';

    const isStructuredJson =
      options.responseMode === 'structured_json' ||
      options.skipQualityDirectives === true;

    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;

    await this.assertCreditsFor(businessId, feature, creditCost);

    let messages = options.messages;
    let resolvedTemplate: ResolvedTemplate | null = null;

    if (!isStructuredJson) {
      try {
        resolvedTemplate = await this.outputTemplateService.resolveTemplate(businessId, outputCategory);
        messages = this.injectDirectivesIntoMessages(messages, resolvedTemplate);
      } catch (err: any) {
        this.logger.warn(`Quality directive injection failed for ${feature}: ${(err as Error).message}`);
      }
    }

    const taskCategory = this.resolveTaskCategory(feature, options.taskCategory);

    const executeCall = async (msgs: typeof messages) => {
      const gatewayMessages: GatewayMessage[] = msgs.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await this.gateway.complete({
        businessId,
        taskCategory,
        messages: gatewayMessages,
        maxTokens,
        temperature,
        modelOverride: options.model || undefined,
        providerOverride: options.model ? 'openai' : undefined,
      });

      return {
        content: response.content ?? '',
        provider: response.provider,
        model: response.model,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        estimatedCost: response.usage.estimatedCost,
        latencyMs: response.latencyMs,
        fallbackUsed: response.fallbackUsed,
        fallbackProvider: response.fallbackProvider,
      };
    };

    try {
      let result = await executeCall(messages);

      if (!isStructuredJson) {
        const requiredSections = resolvedTemplate?.requiredSections ?? [];
        const validation = validateAiOutput(result.content, outputCategory, requiredSections);
        if (!validation.passed) {
          this.logger.warn(`[Quality] ${feature} failed validation: ${validation.issues.join('; ')}. Retrying...`);
          const retryMessages = [
            ...messages,
            { role: 'assistant' as const, content: result.content },
            {
              role: 'user' as const,
              content: `The previous response did not meet quality standards. Issues: ${validation.issues.join('; ')}. Please provide a complete, specific, high-quality response that addresses all the quality requirements.`,
            },
          ];
          try {
            const retry = await executeCall(retryMessages);
            result = {
              ...retry,
              promptTokens: result.promptTokens + retry.promptTokens,
              completionTokens: result.completionTokens + retry.completionTokens,
              totalTokens: result.totalTokens + retry.totalTokens,
              estimatedCost: result.estimatedCost + retry.estimatedCost,
            };
          } catch (retryErr) {
            this.logger.warn(`Quality retry failed for ${feature}: ${(retryErr as Error).message}`);
          }
        }
      }

      this.persistUsageLog(
        {
          businessId,
          userId: userId || undefined,
          feature,
          model: result.model,
          provider: result.provider,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          estimatedCost: Math.round(result.estimatedCost * 10000) / 10000,
          creditsUsed: creditCost,
          latencyMs: result.latencyMs,
          fallbackUsed: result.fallbackUsed,
          fallbackProvider: result.fallbackProvider,
          taskCategory,
          metadata: {
            maxTokens,
            temperature,
            outputCategory,
          },
        },
        businessId,
        creditCost,
      ).catch((err) => this.logger.error(`Background usage log failed: ${(err as Error).message}`));

      return {
        content: result.content,
        provider: result.provider,
        model: result.model,
        usage: {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          creditsUsed: creditCost,
          estimatedCost: Math.round(result.estimatedCost * 10000) / 10000,
        },
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`AI call failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * The one place an AI call is allowed or refused.
   *
   * Replaces six identical check-and-throw blocks. They were identical, which
   * is exactly why they were worth collapsing: the system-work exemption below
   * had to be added in six places or none, and "or none" is how a rule becomes
   * true in five of six call paths and nobody notices.
   *
   * SYSTEM WORK IS NOT CHECKED AT ALL, not merely not counted. Excluding
   * indexing from the allowance while still BLOCKING it on that allowance would
   * be the worst of both: the customer is not charged for embeddings, and their
   * search index quietly stops updating the moment they run out of credits —
   * degrading the product for a reason that has nothing to do with what they
   * bought. There is nothing to enforce against a pool the work does not spend.
   *
   * @throws ForbiddenException when a billable feature has no allowance left.
   */
  async assertCreditsFor(businessId: string, feature: string, creditCost: number): Promise<void> {
    if (!isBillableAiFeature(feature)) return;

    const verdict = await this.checkCredits(businessId, creditCost);
    if (verdict.allowed) return;

    throw new ForbiddenException(
      `AI credit limit reached. You've used ${verdict.used}/${verdict.limit} credits this month. ` +
        `Upgrade your plan for more AI credits.`,
    );
  }

  async checkCredits(businessId: string, creditsNeeded = 1): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
    remaining: number;
    isUnlimited: boolean;
  }> {
    const sub = await this.subscriptionsService.getActiveSubscription(businessId);
    const limit = sub.limits.aiCreditsPerMonth;

    if (limit === -1) {
      return { allowed: true, used: 0, limit: -1, remaining: -1, isUnlimited: true };
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usedAgg = await this.prisma.client.aiUsageLog.aggregate({
      where: {
        businessId,
        createdAt: { gte: startOfMonth },
        // Only what the customer actually asked for. Work the product does on
        // its own behalf — indexing, genome extraction, background scans — is
        // recorded for cost visibility and does not spend their allowance.
        //
        // Measured before this existed: 184 of 243 credits in a month were
        // `semantic_embedding`, so KEYFLOW's own indexing exhausted the plan
        // and locked the owner out of the features they were paying for.
        billable: true,
      },
      _sum: { creditsUsed: true },
    });

    const used = usedAgg._sum.creditsUsed ?? 0;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: remaining >= creditsNeeded,
      used,
      limit,
      remaining,
      isUnlimited: false,
    };
  }

  async getUsageSummary(businessId: string): Promise<UsageSummary> {
    const sub = await this.subscriptionsService.getActiveSubscription(businessId);
    const limit = sub.limits.aiCreditsPerMonth;
    const isUnlimited = limit === -1;

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [usageAgg, byFeatureRaw, totalCostAgg] = await Promise.all([
      this.prisma.client.aiUsageLog.aggregate({
        where: { businessId, createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true },
      }),
      this.prisma.client.aiUsageLog.groupBy({
        by: ['feature'],
        where: { businessId, createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true },
        _count: true,
      }),
      this.prisma.client.aiUsageLog.aggregate({
        where: { businessId, createdAt: { gte: periodStart } },
        _sum: { estimatedCost: true },
      }),
    ]);

    const creditsUsed = usageAgg._sum.creditsUsed ?? 0;
    const totalEstimatedCost = totalCostAgg._sum.estimatedCost ?? 0;

    const overageCredits = isUnlimited ? 0 : Math.max(0, creditsUsed - limit);
    const currency = sub.subscription?.currency || 'TTD';
    const overageRate = currency === 'USD' ? AI_OVERAGE_RATE_USD : AI_OVERAGE_RATE_TTD;
    const overageCost = overageCredits * overageRate;

    const byFeature = byFeatureRaw.map((f) => ({
      feature: f.feature,
      credits: f._sum.creditsUsed ?? 0,
      calls: f._count,
      cost: Math.round((f._sum.estimatedCost ?? 0) * 100) / 100,
    }));

    let budget: BudgetStatus | undefined;
    try {
      budget = await this.gateway.getBudgetStatus(businessId);
    } catch (err: any) {
        this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
      }

    return {
      currentPlan: sub.plan,
      creditsUsed,
      creditsLimit: limit,
      creditsRemaining: isUnlimited ? -1 : Math.max(0, limit - creditsUsed),
      isUnlimited,
      overageCredits,
      overageCost: Math.round(overageCost * 100) / 100,
      overageCurrency: currency,
      totalEstimatedCost: Math.round(totalEstimatedCost * 10000) / 10000,
      periodStart,
      periodEnd,
      byFeature,
      budget,
    };
  }

  async getUsageHistory(businessId: string, limit = 50, offset = 0) {
    const [logs, total] = await Promise.all([
      this.prisma.client.aiUsageLog.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          feature: true,
          model: true,
          provider: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
          creditsUsed: true,
          latencyMs: true,
          fallbackUsed: true,
          fallbackProvider: true,
          taskCategory: true,
          createdAt: true,
        },
      }),
      this.prisma.client.aiUsageLog.count({ where: { businessId } }),
    ]);

    return { logs, total, limit, offset };
  }

  async getProviderStats(businessId: string) {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [byProvider, fallbackStats, avgLatency] = await Promise.all([
      this.prisma.client.aiUsageLog.groupBy({
        by: ['provider'],
        where: { businessId, createdAt: { gte: periodStart } },
        _sum: { creditsUsed: true, estimatedCost: true, totalTokens: true },
        _count: true,
        _avg: { latencyMs: true },
      }),
      this.prisma.client.aiUsageLog.count({
        where: { businessId, createdAt: { gte: periodStart }, fallbackUsed: true },
      }),
      this.prisma.client.aiUsageLog.aggregate({
        where: { businessId, createdAt: { gte: periodStart } },
        _avg: { latencyMs: true },
      }),
    ]);

    let budgetStatus: BudgetStatus | undefined;
    try {
      budgetStatus = await this.gateway.getBudgetStatus(businessId);
    } catch (err: any) {
        this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
      }

    const providerBudgetMap = new Map(
      budgetStatus?.byProvider?.map(b => [b.provider, b]) || [],
    );

    return {
      byProvider: byProvider.map(p => ({
        provider: p.provider,
        calls: p._count,
        credits: p._sum.creditsUsed ?? 0,
        cost: Math.round((p._sum.estimatedCost ?? 0) * 100) / 100,
        tokens: p._sum.totalTokens ?? 0,
        avgLatencyMs: Math.round(p._avg.latencyMs ?? 0),
        budget: providerBudgetMap.get(p.provider as AiProvider) || null,
      })),
      fallbackCount: fallbackStats,
      avgLatencyMs: Math.round(avgLatency._avg.latencyMs ?? 0),
      overallBudget: budgetStatus?.overall || null,
    };
  }

  async getBillingSummary(businessId: string) {
    const sub = await this.subscriptionsService.getActiveSubscription(businessId);
    const usage = await this.getUsageSummary(businessId);

    const subscriptionCost = sub.subscription?.priceMonthly ?? 0;
    const currency = sub.subscription?.currency || 'TTD';
    const totalMonthlyCost = subscriptionCost + usage.overageCost;

    return {
      subscription: {
        plan: sub.plan,
        status: sub.status,
        monthlyCost: subscriptionCost,
        currency,
        periodEnd: sub.subscription?.currentPeriodEnd,
      },
      aiUsage: {
        creditsUsed: usage.creditsUsed,
        creditsLimit: usage.creditsLimit,
        isUnlimited: usage.isUnlimited,
        overageCredits: usage.overageCredits,
        overageCost: usage.overageCost,
        estimatedApiCost: usage.totalEstimatedCost,
      },
      totalMonthlyCost,
      currency,
      breakdown: [
        { item: `${sub.plan} Plan`, amount: subscriptionCost },
        ...(usage.overageCost > 0
          ? [{ item: `AI Overage (${usage.overageCredits} credits)`, amount: usage.overageCost }]
          : []),
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Tracked wrapper methods — enforce rate limits, credit checks, and logging
  // for AI modalities that cannot use callAi() (streaming, tool-calling, vision,
  // audio, embeddings).
  // ---------------------------------------------------------------------------

  /**
   * Wraps gateway.complete() with rate limiting, credit enforcement, and usage
   * logging. Use this for any service that needs tool-calling, JSON mode, or
   * other gateway features not available through callAi().
   */
  async trackAndComplete(
    businessId: string,
    userId: string | undefined,
    feature: string,
    request: Omit<GatewayRequest, 'businessId' | 'taskCategory'> & { taskCategory?: TaskCategory },
  ): Promise<GatewayResponse> {
    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.assertCreditsFor(businessId, feature, creditCost);

    const taskCategory = this.resolveTaskCategory(feature, request.taskCategory);
    const startTime = Date.now();

    try {
      const response = await this.gateway.complete({
        ...request,
        businessId,
        taskCategory,
      });

      const latencyMs = Date.now() - startTime;

      this.persistUsageLog(
        {
          businessId,
          userId: userId || undefined,
          feature,
          model: response.model,
          provider: response.provider,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          estimatedCost: Math.round(response.usage.estimatedCost * 10000) / 10000,
          creditsUsed: creditCost,
          latencyMs,
          fallbackUsed: response.fallbackUsed,
          fallbackProvider: response.fallbackProvider,
          taskCategory,
          metadata: {
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            toolCount: request.tools?.length,
          },
        },
        businessId,
        creditCost,
      ).catch((err) => this.logger.error(`Background usage log failed: ${(err as Error).message}`));
      return response;
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`trackAndComplete failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Wraps gateway.streamComplete() with rate limiting, credit enforcement, and
   * usage logging. Yields stream chunks transparently; accumulates usage from the
   * final 'usage' chunk and writes one aiUsageLog row.
   */
  async *trackAndStream(
    businessId: string,
    userId: string | undefined,
    feature: string,
    request: Omit<GatewayRequest, 'businessId' | 'taskCategory'> & { taskCategory?: TaskCategory },
  ): AsyncGenerator<StreamChunk> {
    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.assertCreditsFor(businessId, feature, creditCost);

    const taskCategory = this.resolveTaskCategory(feature, request.taskCategory);
    const startTime = Date.now();

    let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number } | undefined;
    let provider: string | undefined;
    let model: string | undefined;
    let fallbackUsed = false;

    try {
      const stream = this.gateway.streamComplete({
        ...request,
        businessId,
        taskCategory,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'usage' && chunk.usage) {
          lastUsage = chunk.usage;
          if (chunk.provider) provider = chunk.provider;
          if (chunk.model) model = chunk.model;
        }
        if (chunk.type === 'error') {
          fallbackUsed = true;
        }
        yield chunk;
      }

      const latencyMs = Date.now() - startTime;

      this.persistUsageLog(
        {
          businessId,
          userId: userId || undefined,
          feature,
          model: model || 'gpt-4o',
          provider: provider || 'openai',
          promptTokens: lastUsage?.promptTokens ?? 0,
          completionTokens: lastUsage?.completionTokens ?? 0,
          totalTokens: lastUsage?.totalTokens ?? 0,
          estimatedCost: Math.round((lastUsage?.estimatedCost ?? 0) * 10000) / 10000,
          creditsUsed: creditCost,
          latencyMs,
          fallbackUsed,
          fallbackProvider: undefined,
          taskCategory,
          metadata: {
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            streamed: true,
          },
        },
        businessId,
        creditCost,
      ).catch((err) => this.logger.error(`Background usage log failed: ${(err as Error).message}`));
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`trackAndStream failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Wraps OpenAI embeddings API with rate limiting, credit enforcement, and
   * usage logging.
   */
  async trackEmbedding(
    businessId: string,
    userId: string | undefined,
    feature: string,
    texts: string[],
    model = 'text-embedding-3-small',
  ): Promise<number[][]> {
    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.assertCreditsFor(businessId, feature, creditCost);

    const startTime = Date.now();
    const client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    try {
      const response = await client.embeddings.create({ model, input: texts });
      const latencyMs = Date.now() - startTime;

      // Estimate tokens: ~1 token per 4 characters (rough heuristic)
      const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
      const estimatedTokens = Math.ceil(totalChars / 4);
      // text-embedding-3-small: $0.00002 per 1k tokens
      const estimatedCost = (estimatedTokens / 1000) * 0.00002;

      const embeddings = response.data.map(d => d.embedding);

      this.persistUsageLog(
        {
          businessId,
          userId: userId || undefined,
          feature,
          model,
          provider: 'openai',
          promptTokens: estimatedTokens,
          completionTokens: 0,
          totalTokens: estimatedTokens,
          estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          creditsUsed: creditCost,
          latencyMs,
          taskCategory: 'extraction',
          metadata: { batchSize: texts.length },
        },
        businessId,
        creditCost,
      ).catch((err) => this.logger.error(`Background usage log failed: ${(err as Error).message}`));
      return embeddings;
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`trackEmbedding failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Wraps OpenAI vision-capable chat completion with rate limiting, credit
   * enforcement, and usage logging. Accepts messages with vision content arrays.
   */
  async trackVision(
    businessId: string,
    userId: string | undefined,
    feature: string,
    messages: Array<{ role: string; content: any }>,
    maxTokens = 1200,
    temperature = 0.2,
    model = 'gpt-4o',
  ): Promise<{ content: string | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number } }> {
    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.assertCreditsFor(businessId, feature, creditCost);

    const startTime = Date.now();
    const client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    try {
      const response = await client.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        max_tokens: maxTokens,
        temperature,
      });

      const latencyMs = Date.now() - startTime;
      const choice = response.choices[0];
      const content = choice?.message?.content ?? null;
      const usage = response.usage;

      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

      // Vision model pricing
      const costs: Record<string, { input: number; output: number }> = {
        'gpt-4o': { input: 0.005, output: 0.015 },
        'gpt-4o-mini': { input: 0.0004, output: 0.0016 },
      };
      const costRates = costs[model] || costs['gpt-4o'];
      const estimatedCost = (promptTokens / 1000) * costRates.input + (completionTokens / 1000) * costRates.output;

      this.persistUsageLog(
        {
          businessId,
          userId: userId || undefined,
          feature,
          model,
          provider: 'openai',
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          creditsUsed: creditCost,
          latencyMs,
          taskCategory: 'extraction',
          metadata: { maxTokens, temperature, vision: true },
        },
        businessId,
        creditCost,
      ).catch((err) => this.logger.error(`Background usage log failed: ${(err as Error).message}`));
      return { content, usage: { promptTokens, completionTokens, totalTokens, estimatedCost } };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`trackVision failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Wraps OpenAI audio APIs (TTS and STT) with rate limiting, credit
   * enforcement, and usage logging.
   */
  async trackAudio(
    businessId: string,
    userId: string | undefined,
    feature: string,
    mode: 'tts' | 'stt',
    params: {
      text?: string;
      voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'ash' | 'coral' | 'sage';
      audioFile?: Buffer;
      fileName?: string;
      model?: string;
    },
  ): Promise<Buffer | string> {
    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.assertCreditsFor(businessId, feature, creditCost);

    const startTime = Date.now();
    const client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    try {
      let result: Buffer | string;
      let model = params.model || 'gpt-4o-mini-tts';
      let estimatedCost = 0;

      if (mode === 'tts') {
        const response = await client.audio.speech.create({
          model,
          voice: params.voice || 'alloy',
          input: params.text || '',
        });
        result = Buffer.from(await response.arrayBuffer());
        // TTS: $0.015 per 1k characters (approx)
        estimatedCost = ((params.text?.length || 0) / 1000) * 0.015;
      } else {
        const response = await client.audio.transcriptions.create({
          model: params.model || 'whisper-1',
          file: new File([params.audioFile! as unknown as BlobPart], params.fileName || 'audio.mp3', { type: 'audio/mp3' }),
        });
        result = response.text;
        model = params.model || 'whisper-1';
        // STT: $0.006 per minute (approx $0.0001 per second)
        estimatedCost = 0.0001;
      }

      const latencyMs = Date.now() - startTime;

      this.persistUsageLog(
        {
          businessId,
          userId: userId || undefined,
          feature,
          model,
          provider: 'openai',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          creditsUsed: creditCost,
          latencyMs,
          taskCategory: mode === 'tts' ? 'content-generation' : 'extraction',
          metadata: { mode, voice: params.voice },
        },
        businessId,
        creditCost,
      ).catch((err) => this.logger.error(`Background usage log failed: ${(err as Error).message}`));
      return result;
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`trackAudio failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Usage persistence — fire-and-forget with retry so AI responses are never
  // blocked by logging hiccups.
  // ---------------------------------------------------------------------------

  private async persistUsageLog(
    data: {
      businessId: string;
      userId?: string;
      feature: string;
      model?: string;
      provider?: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCost: number;
      creditsUsed: number;
      latencyMs?: number;
      fallbackUsed?: boolean;
      fallbackProvider?: string;
      taskCategory: string;
      metadata?: unknown;
    },
    businessId: string,
    creditCost: number,
  ): Promise<void> {
    // Classified HERE, at the single write site, rather than by each caller.
    // Every track* method funnels through this function, so a new AI feature
    // cannot be added to the product and silently land in the customer's
    // allowance because its author did not know the distinction existed.
    const billable = isBillableAiFeature(data.feature);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.client.aiUsageLog.create({ data: { ...data, billable } as any });
        await this.checkAlertThresholds(businessId, creditCost);
        return;
      } catch (err: any) {
        this.logger.error(
          `AI usage log attempt ${attempt + 1} failed for ${data.feature}: ${(err as Error).message}`,
        );
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }
    this.logger.error(
      `CRITICAL: Failed to persist AI usage log after 3 attempts. Feature=${data.feature} business=${businessId}`,
    );
  }

  /**
   * Fire-and-forget audio usage logger for services that already perform the
   * OpenAI audio call themselves.
   */
  trackAudioUsage(opts: {
    businessId: string;
    userId?: string;
    type: 'audio_tts' | 'audio_stt';
    model?: string;
    inputLength?: number;
    outputLength?: number;
    metadata?: Record<string, unknown>;
  }): void {
    const feature = opts.type;
    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    const mode = opts.type === 'audio_tts' ? 'tts' : 'stt';
    const estimatedCost =
      mode === 'tts'
        ? ((opts.inputLength ?? 0) / 1000) * 0.015
        : ((opts.outputLength ?? 0) / 1000) * 0.006;
    this.persistUsageLog(
      {
        businessId: opts.businessId,
        userId: opts.userId,
        feature,
        model: opts.model,
        provider: 'openai',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
        creditsUsed: creditCost,
        taskCategory: mode === 'tts' ? 'content-generation' : 'extraction',
        metadata: opts.metadata,
      },
      opts.businessId,
      creditCost,
    ).catch((err) => this.logger.error(`Background audio usage log failed: ${(err as Error).message}`));
  }

  // ---------------------------------------------------------------------------
  // Legacy / alias tracking methods used by KEY Cortex services
  // ---------------------------------------------------------------------------

  async track(opts: {
    businessId: string;
    userId?: string;
    feature?: string;
    model?: string;
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    durationMs?: number;
    cost?: number;
  }): Promise<void> {
    const feature = opts.feature || 'key_cortex';
    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.persistUsageLog(
      {
        businessId: opts.businessId,
        userId: opts.userId,
        feature,
        model: opts.model,
        provider: 'openai',
        promptTokens: opts.promptTokens ?? opts.tokensUsed ?? 0,
        completionTokens: opts.completionTokens ?? 0,
        totalTokens: opts.tokensUsed ?? (opts.promptTokens ?? 0) + (opts.completionTokens ?? 0),
        estimatedCost: opts.cost ?? 0,
        creditsUsed: creditCost,
        latencyMs: opts.durationMs,
        taskCategory: 'general',
      },
      opts.businessId,
      creditCost,
    );
  }

  async log(opts: {
    businessId: string;
    userId?: string;
    feature?: string;
    model?: string;
    tokensUsed?: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const feature = opts.feature || 'key_cortex';
    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    await this.persistUsageLog(
      {
        businessId: opts.businessId,
        userId: opts.userId,
        feature,
        model: opts.model,
        provider: 'openai',
        promptTokens: opts.tokensUsed ?? 0,
        completionTokens: 0,
        totalTokens: opts.tokensUsed ?? 0,
        estimatedCost: opts.costUsd ?? 0,
        creditsUsed: creditCost,
        taskCategory: 'general',
        metadata: opts.metadata,
      },
      opts.businessId,
      creditCost,
    );
  }

  async trackText(opts: {
    businessId: string;
    userId?: string;
    type?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  }): Promise<void> {
    const feature = opts.type || 'document_qa';
    const creditCost = AI_CREDIT_COSTS[feature] || 1;
    const promptTokens = opts.inputTokens ?? 0;
    const completionTokens = opts.outputTokens ?? 0;
    await this.persistUsageLog(
      {
        businessId: opts.businessId,
        userId: opts.userId,
        feature,
        model: opts.model,
        provider: 'openai',
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0,
        creditsUsed: creditCost,
        taskCategory: 'extraction',
      },
      opts.businessId,
      creditCost,
    );
  }

  // ---------------------------------------------------------------------------
  // Alert thresholds
  // ---------------------------------------------------------------------------

  private async checkAlertThresholds(businessId: string, _creditCost: number): Promise<void> {
    try {
      const sub = await this.subscriptionsService.getActiveSubscription(businessId);
      const limit = sub.limits.aiCreditsPerMonth;
      if (limit === -1) return; // unlimited plan

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const usedAgg = await this.prisma.client.aiUsageLog.aggregate({
        where: {
          businessId,
          createdAt: { gte: startOfMonth },
        },
        _sum: { creditsUsed: true },
      });

      const used = usedAgg._sum.creditsUsed ?? 0;
      const pct = limit > 0 ? (used / limit) * 100 : 0;

      // Depleted
      if (used >= limit) {
        const existing = await this.prisma.client.aiUsageAlert.findFirst({
          where: { businessId, type: 'credit_depleted', notified: false },
        });
        if (!existing) {
          await this.prisma.client.aiUsageAlert.create({
            data: {
              businessId,
              type: 'credit_depleted',
              threshold: 100,
              metadata: { used, limit },
            },
          });
        }
        return;
      }

      // 80% threshold
      if (pct >= 80) {
        const existing = await this.prisma.client.aiUsageAlert.findFirst({
          where: { businessId, type: 'budget_threshold', threshold: 80, notified: false },
        });
        if (!existing) {
          await this.prisma.client.aiUsageAlert.create({
            data: {
              businessId,
              type: 'budget_threshold',
              threshold: 80,
              metadata: { used, limit, pct: Math.round(pct) },
            },
          });
        }
      }

      // 50% threshold
      if (pct >= 50) {
        const existing = await this.prisma.client.aiUsageAlert.findFirst({
          where: { businessId, type: 'budget_threshold', threshold: 50, notified: false },
        });
        if (!existing) {
          await this.prisma.client.aiUsageAlert.create({
            data: {
              businessId,
              type: 'budget_threshold',
              threshold: 50,
              metadata: { used, limit, pct: Math.round(pct) },
            },
          });
        }
      }
    } catch (err: any) {
      this.logger.warn(`Alert threshold check failed: ${(err as Error).message}`);
    }
  }
}
