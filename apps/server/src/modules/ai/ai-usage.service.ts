import { Inject, Injectable, Logger, ForbiddenException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AI_CREDIT_COSTS, AI_OVERAGE_RATE_TTD, AI_OVERAGE_RATE_USD } from '../subscriptions/plans';
import OpenAI from 'openai';
import { OutputCategory, ResolvedTemplate, injectQualityDirectives, validateAiOutput, buildQualityDirectiveSuffix } from './ai-quality';
import { OutputTemplateService } from './output-template.service';

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
  /** @deprecated Use responseMode: 'structured_json' instead */
  skipQualityDirectives?: boolean;
}

interface AiCallResult {
  content: string;
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
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  private readonly openai: OpenAI;
  private readonly defaultModel = 'gpt-4o';

  private readonly RATE_LIMIT_PER_MINUTE = 30;
  private readonly rateLimitMap = new Map<string, number[]>();
  private rateLimitCleanupTimer: ReturnType<typeof setInterval>;

  private readonly TOKEN_COST_PER_1K: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.0004, output: 0.0016 },
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SubscriptionsService) private readonly subscriptionsService: SubscriptionsService,
    @Inject(OutputTemplateService) private readonly outputTemplateService: OutputTemplateService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

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

  async callAi(options: AiCallOptions): Promise<AiCallResult> {
    const { businessId, feature, maxTokens = 500, temperature = 0.7 } = options;
    const model = options.model || this.defaultModel;
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

    const executeCall = async (msgs: typeof messages) => {
      const response = await this.openai.chat.completions.create({
        model,
        messages: msgs,
        max_tokens: maxTokens,
        temperature,
      });

      const content = response.choices[0]?.message?.content ?? '';
      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
      const totalTokens = promptTokens + completionTokens;
      const costs = this.TOKEN_COST_PER_1K[model] || this.TOKEN_COST_PER_1K['gpt-4o'];
      const estimatedCost =
        (promptTokens / 1000) * costs.input +
        (completionTokens / 1000) * costs.output;

      return { content, promptTokens, completionTokens, totalTokens, estimatedCost };
    };

    try {
      let { content, promptTokens, completionTokens, totalTokens, estimatedCost } = await executeCall(messages);

      if (!isStructuredJson) {
        const requiredSections = resolvedTemplate?.requiredSections ?? [];
        const validation = validateAiOutput(content, outputCategory, requiredSections);
        if (!validation.passed) {
          this.logger.warn(`[Quality] ${feature} failed validation: ${validation.issues.join('; ')}. Retrying...`);
          const retryMessages = [
            ...messages,
            { role: 'assistant' as const, content },
            {
              role: 'user' as const,
              content: `The previous response did not meet quality standards. Issues: ${validation.issues.join('; ')}. Please provide a complete, specific, high-quality response that addresses all the quality requirements.`,
            },
          ];
          try {
            const retry = await executeCall(retryMessages);
            content = retry.content;
            promptTokens += retry.promptTokens;
            completionTokens += retry.completionTokens;
            totalTokens += retry.totalTokens;
            estimatedCost += retry.estimatedCost;
          } catch (retryErr) {
            this.logger.warn(`Quality retry failed for ${feature}: ${(retryErr as Error).message}`);
          }
        }
      }

      await this.prisma.client.aiUsageLog.create({
        data: {
          businessId,
          feature,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          creditsUsed: creditCost,
          metadata: {
            maxTokens,
            temperature,
            outputCategory,
          },
        },
      });

      return {
        content,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          creditsUsed: creditCost,
          estimatedCost: Math.round(estimatedCost * 10000) / 10000,
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
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
          creditsUsed: true,
          createdAt: true,
        },
      }),
      this.prisma.client.aiUsageLog.count({ where: { businessId } }),
    ]);

    return { logs, total, limit, offset };
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
