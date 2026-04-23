import { Inject, Injectable, Logger, ForbiddenException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AI_CREDIT_COSTS, AI_OVERAGE_RATE_TTD, AI_OVERAGE_RATE_USD } from '../subscriptions/plans';
import { OutputCategory, ResolvedTemplate, injectQualityDirectives, validateAiOutput, buildQualityDirectiveSuffix } from './ai-quality';
import { OutputTemplateService } from './output-template.service';
import { ModelGatewayService, TaskCategory, GatewayMessage, BudgetStatus, AiProvider } from './model-gateway.service';

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

const FEATURE_TASK_MAP: Record<string, TaskCategory> = {
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
};

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  private readonly RATE_LIMIT_PER_MINUTE = 30;
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
    const { businessId, feature, maxTokens = 500, temperature = 0.7 } = options;
    const outputCategory: OutputCategory = options.outputCategory || 'general';

    const isStructuredJson =
      options.responseMode === 'structured_json' ||
      options.skipQualityDirectives === true;

    this.checkRateLimit(businessId);

    const creditCost = AI_CREDIT_COSTS[feature] || 1;

    const canProceed = await this.checkCredits(businessId, creditCost);
    if (!canProceed.allowed) {
      throw new ForbiddenException(
        `AI credit limit reached. You've used ${canProceed.used}/${canProceed.limit} credits this month. ` +
        `Upgrade your plan for more AI credits.`,
      );
    }

    let messages = options.messages;
    let resolvedTemplate: ResolvedTemplate | null = null;

    if (!isStructuredJson) {
      try {
        resolvedTemplate = await this.outputTemplateService.resolveTemplate(businessId, outputCategory);
        messages = this.injectDirectivesIntoMessages(messages, resolvedTemplate);
      } catch (err) {
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

      await this.prisma.client.aiUsageLog.create({
        data: {
          businessId,
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
      });

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
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`AI call failed for ${feature}: ${(error as Error).message}`);
      throw error;
    }
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
    } catch {
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
    } catch {
    }

    const providerBudgetMap = new Map<AiProvider, BudgetStatus['byProvider'][number]>();
    for (const b of budgetStatus?.byProvider ?? []) {
      if (b.provider === 'openai' || b.provider === 'anthropic' || b.provider === 'xai') {
        providerBudgetMap.set(b.provider, b);
      }
    }

    const toAiProvider = (provider: string): AiProvider | null => (
      provider === "openai" || provider === "anthropic" || provider === "xai"
        ? provider
        : null
    );

    return {
      byProvider: byProvider.map((p) => {
        const providerKey = toAiProvider(p.provider);
        return {
          provider: p.provider,
          calls: p._count,
          credits: p._sum.creditsUsed ?? 0,
          cost: Math.round((p._sum.estimatedCost ?? 0) * 100) / 100,
          tokens: p._sum.totalTokens ?? 0,
          avgLatencyMs: Math.round(p._avg.latencyMs ?? 0),
          budget: providerKey ? providerBudgetMap.get(providerKey) || null : null,
        };
      }),
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
}
