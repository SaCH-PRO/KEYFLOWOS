import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMCostService, type RecordCostInput } from './llm-cost.service';

const mockPrismaClient = {
  lLMProviderCost: {
    create: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
} as any;

describe('LLMCostService', () => {
  let service: LLMCostService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    service = new LLMCostService(mockPrisma);
  });

  describe('computeCost', () => {
    it('calculates cost for gpt-4o-mini', () => {
      const cost = service.computeCost('gpt-4o-mini', 1000, 1000);
      // the one table's verified price (2026-08-04): 0.00015 / 0.0006 per 1k, rounded to four decimals as computeCost
      // rounds (0.00015 lands on 0.0001 in floating point; the sub-cent loss is pre-existing and noted for the owner)
      expect(cost.inputCost).toBe(0.0001);
      expect(cost.outputCost).toBe(0.0006);
      expect(cost.totalCost).toBe(0.0007);
    });

    it('calculates cost for claude-3-5-sonnet', () => {
      const cost = service.computeCost('claude-3-5-sonnet-20241022', 2000, 1000);
      expect(cost.inputCost).toBe(0.006);
      expect(cost.outputCost).toBe(0.015);
      expect(cost.totalCost).toBe(0.021);
    });

    it('bills an unknown model at the gpt-4o rate and says it is an estimate, never $0 (RR-UNKNOWN-COST-NOT-ZERO)', () => {
      const cost = service.computeCost('unknown-model', 1000, 1000);
      const gpt4o = service.computeCost('gpt-4o', 1000, 1000);
      expect(cost.inputCost).toBe(gpt4o.inputCost);
      expect(cost.outputCost).toBe(gpt4o.outputCost);
      expect(cost.totalCost).toBe(gpt4o.totalCost);
      expect(cost.totalCost).toBeGreaterThan(0);
      expect(cost.priced).toBe(false);
      expect(gpt4o.priced).toBe(true);
    });
  });

  describe('recordCost', () => {
    it('persists a cost record with computed totals', async () => {
      mockPrismaClient.lLMProviderCost.create.mockResolvedValue({ id: 'cost-1' });

      const input: RecordCostInput = {
        businessId: 'biz-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        taskCategory: 'extraction',
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        latencyMs: 120,
        fallbackUsed: false,
      };

      const result = await service.recordCost(input);

      expect(result.id).toBe('cost-1');
      expect(mockPrismaClient.lLMProviderCost.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: 'biz-1',
          provider: 'openai',
          model: 'gpt-4o-mini',
          taskCategory: 'extraction',
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          // the one table's verified gpt-4o-mini price (0.00015 / 0.0006 per 1k), rounded as computeCost rounds
          inputCost: 0.0001,
          outputCost: 0.0003,
          totalCost: 0.0005,
          latencyMs: 120,
          fallbackUsed: false,
          metadata: { costStatus: 'priced' },
        }),
      });
    });

    it('allows explicit cost values to override computed ones', async () => {
      mockPrismaClient.lLMProviderCost.create.mockResolvedValue({ id: 'cost-2' });

      const input: RecordCostInput = {
        businessId: 'biz-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        taskCategory: 'extraction',
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        inputCost: 0.1,
        outputCost: 0.2,
        totalCost: 0.3,
        latencyMs: 120,
      };

      await service.recordCost(input);

      expect(mockPrismaClient.lLMProviderCost.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inputCost: 0.1,
          outputCost: 0.2,
          totalCost: 0.3,
        }),
      });
    });
  });

  describe('getCurrentMonthSpend', () => {
    it('aggregates spend for the current month', async () => {
      mockPrismaClient.lLMProviderCost.aggregate.mockResolvedValue({
        _sum: { totalCost: 1.234 },
      });
      mockPrismaClient.lLMProviderCost.groupBy.mockResolvedValue([
        { provider: 'openai', _sum: { totalCost: 0.8 } },
        { provider: 'anthropic', _sum: { totalCost: 0.434 } },
      ]);

      const spend = await service.getCurrentMonthSpend('biz-1');

      expect(spend.total).toBe(1.234);
      expect(spend.byProvider).toEqual({
        openai: 0.8,
        anthropic: 0.434,
      });
    });

    it('returns zero spend when no records exist', async () => {
      mockPrismaClient.lLMProviderCost.aggregate.mockResolvedValue({
        _sum: { totalCost: null },
      });
      mockPrismaClient.lLMProviderCost.groupBy.mockResolvedValue([]);

      const spend = await service.getCurrentMonthSpend('biz-1');

      expect(spend.total).toBe(0);
      expect(spend.byProvider).toEqual({});
    });
  });
});
