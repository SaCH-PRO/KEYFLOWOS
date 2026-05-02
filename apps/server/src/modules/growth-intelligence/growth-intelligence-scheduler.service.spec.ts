import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrowthIntelligenceSchedulerService } from './growth-intelligence-scheduler.service';

function makeService(overrides: {
  businesses?: Array<{ id: string }>;
  recomputeResult?: { total: number; processed: number; failed: number };
  recomputeThrows?: Error;
  generateThrows?: Error;
}) {
  const findMany = vi.fn().mockResolvedValue(overrides.businesses ?? []);
  const prisma = {
    client: {
      business: { findMany },
    },
  };
  const recomputeAllForBusiness = overrides.recomputeThrows
    ? vi.fn().mockRejectedValue(overrides.recomputeThrows)
    : vi.fn().mockResolvedValue(
        overrides.recomputeResult ?? { total: 1, processed: 1, failed: 0 },
      );
  const generateInsights = overrides.generateThrows
    ? vi.fn().mockRejectedValue(overrides.generateThrows)
    : vi.fn().mockResolvedValue({ created: 1, items: [] });

  const journeys = { recomputeAllForBusiness };
  const growth = { generateInsights };

  const service = new GrowthIntelligenceSchedulerService(
    prisma as any,
    journeys as any,
    growth as any,
  );
  return { service, prisma, journeys, growth, findMany };
}

describe('GrowthIntelligenceSchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when there are no businesses', async () => {
    const { service, journeys, growth } = makeService({});
    const result = await service.runNightlyRecompute();
    expect(result).toEqual({
      businesses: 0,
      journeysRecomputed: 0,
      insightsRefreshed: 0,
      failed: 0,
    });
    expect(journeys.recomputeAllForBusiness).not.toHaveBeenCalled();
    expect(growth.generateInsights).not.toHaveBeenCalled();
  });

  it('recomputes journeys and regenerates insights for every business', async () => {
    const { service, journeys, growth } = makeService({
      businesses: [{ id: 'b1' }, { id: 'b2' }],
      recomputeResult: { total: 5, processed: 5, failed: 0 },
    });
    const result = await service.runNightlyRecompute();
    expect(journeys.recomputeAllForBusiness).toHaveBeenCalledTimes(2);
    expect(growth.generateInsights).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      businesses: 2,
      journeysRecomputed: 10,
      insightsRefreshed: 2,
      failed: 0,
    });
  });

  it('counts journey-level recompute failures without aborting the run', async () => {
    const { service, growth } = makeService({
      businesses: [{ id: 'b1' }],
      recomputeResult: { total: 4, processed: 3, failed: 1 },
    });
    const result = await service.runNightlyRecompute();
    expect(result).toEqual({
      businesses: 1,
      journeysRecomputed: 3,
      insightsRefreshed: 1,
      failed: 1,
    });
    expect(growth.generateInsights).toHaveBeenCalledWith('b1');
  });

  it('continues to the next business when recompute throws', async () => {
    const { service, journeys, growth } = makeService({
      businesses: [{ id: 'b1' }, { id: 'b2' }],
      recomputeThrows: new Error('boom'),
    });
    const result = await service.runNightlyRecompute();
    expect(journeys.recomputeAllForBusiness).toHaveBeenCalledTimes(2);
    // generateInsights still attempted for each business even when recompute throws
    expect(growth.generateInsights).toHaveBeenCalledTimes(2);
    expect(result.failed).toBeGreaterThanOrEqual(2);
    expect(result.insightsRefreshed).toBe(2);
  });

  it('counts insight regeneration failures without aborting the run', async () => {
    const { service, journeys } = makeService({
      businesses: [{ id: 'b1' }, { id: 'b2' }],
      generateThrows: new Error('insights down'),
    });
    const result = await service.runNightlyRecompute();
    expect(journeys.recomputeAllForBusiness).toHaveBeenCalledTimes(2);
    expect(result.insightsRefreshed).toBe(0);
    expect(result.failed).toBe(2);
  });
});
