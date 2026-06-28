import { Injectable } from '@nestjs/common';
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

const TOKEN_COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.0004, output: 0.0016 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.001, output: 0.005 },
  'grok-2': { input: 0.005, output: 0.015 },
  'grok-2-mini': { input: 0.001, output: 0.005 },
  'moonshot-v1-8k': { input: 0.003, output: 0.003 },
  'moonshot-v1-32k': { input: 0.006, output: 0.006 },
  'moonshot-v1-128k': { input: 0.012, output: 0.012 },
};

@Injectable()
export class LLMCostService {
  constructor(private readonly prisma: PrismaService) {}

  computeCost(model: string, promptTokens: number, completionTokens: number): { inputCost: number; outputCost: number; totalCost: number } {
    const costs = TOKEN_COST_PER_1K[model] || { input: 0, output: 0 };
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
