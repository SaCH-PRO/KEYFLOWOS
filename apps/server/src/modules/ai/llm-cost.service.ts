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
 * USD per 1,000 tokens. The ONE price table (RR-UNKNOWN-COST-NOT-ZERO): the
 * gateway imports it, filterCandidatesByBudget, getBudgetStatus and the admin
 * spend view read it, and every routing judgement is made against it. Every
 * model this product can actually reach is listed.
 *
 * LAST VERIFIED AGAINST PROVIDER PRICING: 2026-08-04 (the chat rows, in the
 * gateway's table of that date; the embedding and audio rows measured on
 * production 2026-08-10). Re-verification against the providers' pricing pages
 * was not possible from the 2026-11-23 build environment (network allowlist);
 * the owner re-checks these at the next pricing review. A wrong price here is
 * a one-line edit; the safety property below (no $0 for an unknown model)
 * does not depend on which price is current.
 *
 * MEASURED ON PRODUCTION 2026-08-10: of 465 recorded AI calls, **374 reported a
 * cost of exactly $0.00** because `text-embedding-3-small` and
 * `gpt-4o-mini-tts` were absent from this table and the lookup fell through
 * to `|| { input: 0, output: 0 }`. Four fifths of the product's inference was
 * invisible to its own meter. A zero here is not a missing datum, it is a
 * wrong one: `AI_OVERAGE_RATE_TTD` bills customers for usage beyond their
 * plan, and gross margin per plan is computed from these numbers. So priceFor
 * never answers zero: an unpriced model is billed at the gpt-4o rate (the
 * deliberate overstatement, so a budget cannot be bypassed by an unknown
 * model) and every row written for it is marked `costStatus 'unpriced_estimate'`.
 *
 * Non-token-priced models (audio, embeddings) are still listed. Their per-token
 * rate is tiny but real, and listing them is what stops them silently
 * rejoining the zero bucket. Input-only models have output 0 by nature.
 */
export const TOKEN_COST_PER_1K: Record<string, { input: number; output: number }> = {
  // Chat / reasoning: the routing table's primaries and fallbacks.
  'gpt-4o': { input: 0.0025, output: 0.010 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'gemini-2.5-pro': { input: 0.00125, output: 0.010 },
  'grok-2': { input: 0.005, output: 0.015 },
  'grok-2-mini': { input: 0.001, output: 0.005 },
  'moonshot-v1-8k': { input: 0.003, output: 0.003 },
  'moonshot-v1-32k': { input: 0.006, output: 0.006 },
  'moonshot-v1-128k': { input: 0.012, output: 0.012 },

  // Embeddings. 374 of the 465 calls above, and every one of them recorded $0.
  // Input-only: there are no completion tokens, so output is 0 by nature rather
  // than by omission, which is exactly why the old fallback was undetectable.
  'text-embedding-3-small': { input: 0.00002, output: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },

  // Audio. Billed per minute upstream, not per token; these are the
  // token-equivalent rates the gateway records against so the model appears in
  // cost reporting at all. Approximate on purpose, and better than zero.
  'gpt-4o-mini-tts': { input: 0.0006, output: 0.012 },
  'tts-1': { input: 0.015, output: 0 },
  'whisper-1': { input: 0.006, output: 0 },
};

/** The model an unpriced call is billed as: the most expensive common chat model, so the estimate overstates. */
export const UNPRICED_FALLBACK_MODEL = 'gpt-4o';

/** How a cost row was priced: 'priced' from the table; 'unpriced_estimate' when the model is not in it and the figure is the gpt-4o-rate estimate priceFor answers. */
export type CostStatus = 'priced' | 'unpriced_estimate';

/**
 * Models seen with no price, so the gap is reported once rather than per call.
 * Module-level and unbounded is fine: it holds model names, of which there are
 * a dozen, not a per-request value.
 */
const unpricedModelsWarned = new Set<string>();
const logger = new Logger('ModelPricing');

/**
 * Price for a model, never zero. The single lookup: a model in the table is
 * `priced`; any other is billed at UNPRICED_FALLBACK_MODEL's rate with
 * `priced: false`, and the gap is logged once per model.
 */
export function priceFor(model: string): { input: number; output: number; priced: boolean } {
  // Own keys only: a model named like an Object.prototype member is not a price.
  const known = Object.hasOwn(TOKEN_COST_PER_1K, model) ? TOKEN_COST_PER_1K[model] : undefined;
  if (known) return { ...known, priced: true };
  if (!unpricedModelsWarned.has(model)) {
    unpricedModelsWarned.add(model);
    logger.warn(
      `No token price for model "${model}": billing it at the ${UNPRICED_FALLBACK_MODEL} rate and marking its rows ` +
        `costStatus 'unpriced_estimate'. Add it to TOKEN_COST_PER_1K in llm-cost.service.ts.`,
    );
  }
  return { ...TOKEN_COST_PER_1K['gpt-4o'], priced: false };
}

/** The costStatus a row for `model` carries. */
export function costStatusFor(model: string): CostStatus {
  return Object.hasOwn(TOKEN_COST_PER_1K, model) ? 'priced' : 'unpriced_estimate';
}

@Injectable()
export class LLMCostService {
  private readonly logger = new Logger(LLMCostService.name);

  constructor(private readonly prisma: PrismaService) {}

  computeCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): { inputCost: number; outputCost: number; totalCost: number; priced: boolean } {
    // Never a silent zero: an unknown model is billed at the fallback rate
    // (overstated on purpose) and flagged, so the figure cannot pass for a
    // real one (RR-UNKNOWN-COST-NOT-ZERO). A pricing gap still never breaks an
    // AI response the user is waiting on, and llm-cost-coverage.spec.ts fails
    // the build for any model the routing table can reach that is missing.
    const costs = priceFor(model);
    const inputCost = (promptTokens / 1000) * costs.input;
    const outputCost = (completionTokens / 1000) * costs.output;
    return {
      inputCost: Math.round(inputCost * 10000) / 10000,
      outputCost: Math.round(outputCost * 10000) / 10000,
      totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
      priced: costs.priced,
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
        // Every row says how it was priced (RR-UNKNOWN-COST-NOT-ZERO).
        metadata: { ...(input.metadata ?? {}), costStatus: costStatusFor(input.model) },
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
