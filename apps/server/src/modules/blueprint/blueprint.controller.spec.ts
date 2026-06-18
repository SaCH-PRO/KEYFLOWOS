import { describe, expect, it, vi } from 'vitest';
import { BlueprintController } from './blueprint.controller';
import type { BlueprintService } from './blueprint.service';
import type { DnaSectionKey, GenomeIntegrityResult } from './blueprint.types';

function makeController() {
  const blueprint = {
    getBlueprint: vi.fn().mockResolvedValue({ id: 'bp_1' }),
    updateBlueprint: vi.fn().mockResolvedValue({ id: 'bp_1', updated: true }),
    inferFromOnboarding: vi.fn().mockResolvedValue({ id: 'bp_1' }),
    inferFromEvents: vi.fn().mockResolvedValue({ id: 'bp_1' }),
    getRecommendedSetupSteps: vi.fn().mockResolvedValue([]),
    getSetupSteps: vi.fn().mockResolvedValue([]),
    calculateGenomeIntegrity: vi.fn().mockResolvedValue({
      genomeIntegrity: 65,
      genomeDnaScores: {
        founder: 60, vision: 50, business: 70, market: 55, financial: 40,
        legal: 30, operations: 20, sales: 10, marketing: 10, growth: 0, technology: 15,
      },
      genomeDnaConfidence: {
        founder: 60, vision: 50, business: 70, market: 55, financial: 40,
        legal: 30, operations: 20, sales: 10, marketing: 10, growth: 0, technology: 15, risk: 0,
      },
      genomeStage: 'VALIDATED_CONCEPT',
      threePillarMinimumMet: true,
      dnaSections: [],
      executiveReadinessScore: 35,
      readinessBreakdown: { legal: 30, financial: 40, market: 55, operations: 20, sales: 10, marketing: 10, risk: 0 },
    } as unknown as GenomeIntegrityResult),
    getRecommendations: vi.fn().mockResolvedValue([{ id: 'r1', section: 'financial', title: 'Add costs', reason: '...' }]),
    generateConstitution: vi.fn().mockResolvedValue({ version: 1, sections: {} }),
    updateDnaSection: vi.fn().mockResolvedValue({ id: 'bp_1', updated: true }),
  } as unknown as BlueprintService;

  const controller = new BlueprintController(blueprint);
  return { controller, blueprint };
}

describe('BlueprintController genome endpoints', () => {
  it('GET /genome returns full genome integrity result', async () => {
    const { controller, blueprint } = makeController();
    const result = await controller.getGenome('biz_1');
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
    expect(result.genomeIntegrity).toBe(65);
  });

  it('GET /genome/integrity returns integrity summary', async () => {
    const { controller, blueprint } = makeController();
    const result = await controller.getIntegrity('biz_1');
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
    expect(result.threePillarMinimumMet).toBe(true);
    expect(result.genomeDnaScores.founder).toBe(60);
    expect(result.executiveReadinessScore).toBe(35);
    expect(result.readinessBreakdown).toEqual({ legal: 30, financial: 40, market: 55, operations: 20, sales: 10, marketing: 10, risk: 0 });
  });

  it('GET /genome/three-pillar-status returns pillar scores', async () => {
    const { controller, blueprint } = makeController();
    const result = await controller.getThreePillarStatus('biz_1');
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
    expect(result.met).toBe(true);
    expect(result.founder).toBe(60);
    expect(result.business).toBe(70);
    expect(result.market).toBe(55);
  });

  it('GET /genome/recommendations returns genome recommendations', async () => {
    const { controller, blueprint } = makeController();
    const result = await controller.getGenomeRecommendations('biz_1');
    expect(blueprint.getRecommendations).toHaveBeenCalledWith('biz_1');
    expect(result.recommendations).toHaveLength(1);
  });

  it('GET /genome/constitution returns generated constitution', async () => {
    const { controller, blueprint } = makeController();
    const result = await controller.getConstitution('biz_1');
    expect(blueprint.generateConstitution).toHaveBeenCalledWith('biz_1');
    expect(result.version).toBe(1);
  });

  it('PATCH /genome/dna/:section updates a DNA section', async () => {
    const { controller, blueprint } = makeController();
    const section: DnaSectionKey = 'financial';
    const data = { monthlyFixedCosts: 3000 };
    const result = await controller.updateDnaSection('biz_1', section, { data });
    expect(blueprint.updateDnaSection).toHaveBeenCalledWith('biz_1', section, data);
    expect(result).toEqual({ id: 'bp_1', updated: true });
  });
});
