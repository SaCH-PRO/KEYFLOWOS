import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { LLMProviderCost } from '@prisma/client';

export interface RecordCostInput {
  businessId: string;
  sessionId?: string | null;
  provider: string;
  model: string;
  taskCategory: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  latencyMs: number;
  fallbackUsed?: boolean;
  metadata?: Record<string, unknown> | null;
}

/**
 * USD per 1,000 tokens. Every model this product can actually reach.
 *
 * MEASURED ON PRODUCTION 2026-08-10: of 465 recorded AI calls, **374 reported a
 * cost of exactly $0.00** — because `text-embedding-3-small` and
 * `gpt-4o-mini-tts` were absent from this table and the lookup below fell
 * through to `|| { input: 0, output: 0 }`. Four fifths of the product's
 * inference was invisible to its own meter, and the meter said so in the most
 * convincing way available: a precise-looking zero.
 *
 * That matters beyond reporting. `AI_OVERAGE_RATE_TTD` bills customers for
 * usage beyond their plan, and gross margin per plan is computed from these
 * numbers. A zero here is not a missing datum, it is a wrong one.
 *
 * Non-token-priced models (audio, embeddings) are still listed. Their per-token
 * rate is tiny but real, and listing them is what stops them silently rejoining
 * the zero bucket.
 */
export const TOKEN_COST_PER_1K: Record<string, { input: number; output: number }> = {
  // Chat / reasoning — the routing table's primaries and fallbacks.
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.0004, output: 0.0016 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.001, output: 0.005 },
  'grok-2': { input: 0.005, output: 0.015 },
  'grok-2-mini': { input: 0.001, output: 0.005 },
  'moonshot-v1-8k': { input: 0.003, output: 0.003 },
  'moonshot-v1-32k': { input: 0.006, output: 0.006 },
  'moonshot-v1-128k': { input: 0.012, output: 0.012 },

  // Embeddings. 374 of the 465 calls above, and every one of them recorded $0.
  // Input-only: there are no completion tokens, so output is 0 by nature rather
  // than by omission — which is exactly why the old fallback was undetectable.
  'text-embedding-3-small': { input: 0.00002, output: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },

  // Audio. Billed per minute upstream, not per token; these are the
  // token-equivalent rates the gateway records against so the model appears in
  // cost reporting at all. Approximate on purpose, and better than zero.
  'gpt-4o-mini-tts': { input: 0.0006, output: 0.012 },
  'tts-1': { input: 0.015, output: 0 },
  'whisper-1': { input: 0.006, output: 0 },
};

/**
 * Models seen with no price, so the gap is reported once rather than per call.
 * Module-level and unbounded is fine: it holds model names, of which there are
 * a dozen, not a per-request value.
 */
const unpricedModelsWarned = new Set<string>();

@Injectable()
export class LLMCostService {
  private readonly logger = new Logger(LLMCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  computeCost(model: string, promptTokens: number, completionTokens: number): { inputCost: number; outputCost: number; totalCost: number } {
    const known = TOKEN_COST_PER_1K[model];

    if (!known) {
      // Say so, once per model. The previous behaviour returned a silent zero,
      // which is the fabricated-success shape this codebase keeps finding: an
      // answer that is indistinguishable from a real one and is wrong. Four
      // fifths of production inference sat behind it.
      //
      // It still returns zero rather than throwing — a pricing gap must not
      // break an AI response the user is waiting on — but zero is now
      // accompanied by something a human can act on, and
      // `llm-cost-coverage.spec.ts` fails the build for any model the routing
      // table can reach that is missing here, so this branch should only ever
      // fire for a model somebody added at runtime.
      if (!unpricedModelsWarned.has(model)) {
        unpricedModelsWarned.add(model);
        this.logger.warn(
          `No token price for model "${model}" — its cost will be recorded as $0 and ` +
            `every margin figure derived from it will be understated. Add it to ` +
            `TOKEN_COST_PER_1K in llm-cost.service.ts.`,
        );
      }
    }

    const costs = known ?? { input: 0, output: 0 };
    const inputCost = (promptTokens / 1000) * costs.input;
    const outputCost = (completionTokens / 1000) * costs.output;
    return {
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
      totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
    };
  }

  async recordCost(input: RecordCostInput): Promise<LLMProviderCost> {
    const costs = this.computeCost(input.model, input.promptTokens, input.completionTokens);
    return this.prisma.client.lLMProviderCost.create({
      data: {
        businessId: input.businessId,
        sessionId: input.sessionId ?? null,
        provider: input.provider,
        model: input.model,
        taskCategory: input.taskCategory,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        inputCost: input.inputCost || costs.inputCost,
        outputCost: input.outputCost || costs.outputCost,
        totalCost: input.totalCost || costs.totalCost,
        latencyMs: input.latencyMs,
        fallbackUsed: input.fallbackUsed ?? false,
        metadata: input.metadata ?? {},
      },
    });
  }

  async getCurrentMonthSpend(
    businessId: string,
  ): Promise<{ total: number; byProvider: Record<string, number> }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalAgg, byProviderRaw] = await Promise.all([
      this.prisma.client.lLMProviderCost.aggregate({
        where: { businessId, createdAt: { gte: startOfMonth } },
        _sum: { totalCost: true },
      }),
      (this.prisma.client.lLMProviderCost.groupBy as any)({
        by: ['provider'],
        where: { businessId, createdAt: { gte: startOfMonth } },
        _sum: { totalCost: true },
      }),
    ]);

    const byProvider: Record<string, number> = {};
    for (const row of byProviderRaw as any[]) {
      byProvider[row.provider] = row._sum?.totalCost ?? 0;
    }

    return {
      total: totalAgg._sum.totalCost ?? 0,
      byProvider,
    };
  }
}
