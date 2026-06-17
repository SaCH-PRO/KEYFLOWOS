import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { GenomeGateGuard } from './genome-gate.guard';
import type { BlueprintService } from '../../modules/blueprint/blueprint.service';

function makeGuard(threePillarMet: boolean, scores: Record<string, number> = {}) {
  const blueprint = {
    calculateGenomeIntegrity: vi.fn().mockResolvedValue({
      genomeIntegrity: 42,
      threePillarMinimumMet: threePillarMet,
      genomeDnaScores: {
        founder: scores.founder ?? 0,
        business: scores.business ?? 0,
        market: scores.market ?? 0,
      },
    }),
  } as unknown as BlueprintService;

  return { guard: new GenomeGateGuard(blueprint), blueprint };
}

function makeContext(businessId: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: { businessId } }),
    }),
  } as any;
}

describe('GenomeGateGuard', () => {
  it('allows access when Three-Pillar Minimum is met', async () => {
    const { guard } = makeGuard(true);
    const result = await guard.canActivate(makeContext('biz_1'));
    expect(result).toBe(true);
  });

  it('blocks access when Three-Pillar Minimum is not met', async () => {
    const { guard } = makeGuard(false, { founder: 40, business: 60, market: 30 });
    await expect(guard.canActivate(makeContext('biz_1'))).rejects.toThrow(ForbiddenException);
  });

  it('includes missing pillars and integrity in the rejection payload', async () => {
    const { guard } = makeGuard(false, { founder: 40, business: 60, market: 30 });
    try {
      await guard.canActivate(makeContext('biz_1'));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe('GENOME_GATE_BLOCKED');
      expect(response.genomeIntegrity).toBe(42);
      expect(response.missingPillars).toEqual(['founder', 'market']);
    }
  });

  it('blocks when all pillars are zero', async () => {
    const { guard } = makeGuard(false);
    await expect(guard.canActivate(makeContext('biz_1'))).rejects.toThrow(ForbiddenException);
  });

  it('reads business_id param as fallback', async () => {
    const { guard, blueprint } = makeGuard(true);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ params: { business_id: 'biz_fallback' } }),
      }),
    } as any;

    await guard.canActivate(context);
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_fallback');
  });
});
