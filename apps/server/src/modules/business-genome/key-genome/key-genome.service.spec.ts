import { describe, expect, it, vi } from 'vitest';
import { KeyGenomeService } from './key-genome.service';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import type { GenomeScoringService } from './genome-scoring.service';
import type { GenomeModuleReadinessService } from './genome-module-readiness.service';
import type { GenomeFactData } from './key-genome.types';
import type { DnaSectionKey, GenomeStage } from '../../blueprint/blueprint.types';

function makeService(scoringOverrides?: Partial<GenomeScoringService>) {
  const prisma = {
    client: {
      businessBlueprint: {
        findUnique: vi.fn().mockResolvedValue({
          identity: { name: 'Acme', archetype: 'Innovator', industry: 'SaaS', mission: 'Empower teams' },
          operatingModel: { revenueModel: 'subscription', deliveryMode: 'digital', serviceArea: 'global' },
          goals: { northStar: 'ARR 1M' },
          constraints: { budgetRange: 'low' },
          brand: { voice: 'confident' },
          customerModel: { idealCustomer: 'Startups' },
          financials: { currency: 'TTD', pricingModel: 'subscription', avgTicket: 500, monthlyTarget: 10000 },
          intelligence: {},
          workflowModel: { primaryWorkflow: 'project-based' },
          aiPreferences: { autonomyLevel: 5 },
          founderProfile: { founderName: 'Alice', background: 'Engineer', skills: ['coding'], weeklyAvailabilityHours: 40 },
          legalProfile: { country: 'TT' },
          registrationProfile: {},
          taxProfile: {},
          ownershipProfile: {},
          marketProfile: { targetGeography: 'Caribbean' },
          offerArchitecture: {},
          salesSystem: {},
          marketingSystem: {},
          operationsSystem: {},
          projectionProfile: {},
          riskProfile: {},
          complianceProfile: {},
          executionRoadmap: {},
          documentProfile: {},
        }),
      },
    },
  } as unknown as PrismaService;

  const scoring = {
    computeFactScores: vi.fn().mockResolvedValue([]),
    computeBusinessScore: vi.fn().mockReturnValue({
      businessId: 'biz_1',
      overall: 0,
      integrity: 0,
      readiness: 0,
      confidence: 0,
      sections: [],
      computedAt: new Date().toISOString(),
    }),
    ...scoringOverrides,
  } as unknown as GenomeScoringService;

  const moduleReadiness = {
    computeReadiness: vi.fn().mockResolvedValue([]),
    getReadiness: vi.fn().mockResolvedValue(null),
  } as unknown as GenomeModuleReadinessService;

  return {
    service: new KeyGenomeService(prisma, scoring, moduleReadiness),
    prisma,
    scoring,
    moduleReadiness,
  };
}

function scores(overrides: Partial<Record<DnaSectionKey, number>> = {}): Record<DnaSectionKey, number> {
  return {
    founder: 0,
    vision: 0,
    business: 0,
    market: 0,
    financial: 0,
    legal: 0,
    operations: 0,
    sales: 0,
    marketing: 0,
    growth: 0,
    technology: 0,
    risk: 0,
    ...overrides,
  };
}

describe('KeyGenomeService', () => {
  it('calculates integrity from the blueprint row', async () => {
    const { service } = makeService();
    const result = await service.calculateIntegrity('biz_1');

    expect(result.genomeIntegrity).toBeGreaterThan(0);
    expect(result.dnaSections.length).toBe(12);
    expect(result.threePillarMinimumMet).toBeDefined();
    expect(result.genomeStage).toBeDefined();
  });

  it('uses fact-based scores when GenomeFact rows exist', async () => {
    const facts = [{ id: 'fact_1' }] as unknown as GenomeFactData[];
    const { service, scoring } = makeService({
      computeFactScores: vi.fn().mockResolvedValue(facts),
      computeBusinessScore: vi.fn().mockReturnValue({
        businessId: 'biz_1',
        overall: 0.65,
        integrity: 0.5,
        readiness: 0.4,
        confidence: 0.6,
        sections: [
          {
            section: 'VISION_IDENTITY',
            weight: 6,
            score: {
              completeness: 1,
              quality: 0.5,
              confidence: 0.6,
              freshness: 0.8,
              operationalReadiness: 0.7,
              riskPenalty: 0,
              overall: 0.72,
            },
          },
        ],
        computedAt: new Date().toISOString(),
      }),
    });

    const result = await service.calculateIntegrity('biz_1');

    expect(result.genomeIntegrity).toBe(65);
    expect(scoring.computeBusinessScore).toHaveBeenCalledWith('biz_1', facts);
    const vision = result.dnaSections.find((s) => s.key === 'vision');
    expect(vision?.integrity).toBe(72);
    expect(vision?.confidence).toBe(60);
  });

  it('falls back to blueprint-derived scores when no facts exist', async () => {
    const { service, scoring } = makeService();
    const result = await service.calculateIntegrity('biz_1');

    expect(scoring.computeBusinessScore).not.toHaveBeenCalled();
    expect(result.genomeIntegrity).toBeGreaterThanOrEqual(0);
  });

  it('recomputes scores and readiness from a single call', async () => {
    const { service, moduleReadiness } = makeService();
    const result = await service.recomputeScores('biz_1');

    expect(result.integrity).toBeDefined();
    expect(result.keyGenomeScore).toBeDefined();
    expect(moduleReadiness.computeReadiness).toHaveBeenCalledWith('biz_1', []);
  });

  it.each([
    ['empty', 0, {}, 'CONCEPT'],
    ['three pillars at 50', 0, { founder: 50, business: 50, market: 50 }, 'VALIDATED_CONCEPT'],
    ['registered entity thresholds', 55, { founder: 60, business: 60, market: 60, legal: 60, financial: 45 }, 'REGISTERED_ENTITY'],
    ['revenue engine thresholds', 65, { sales: 60, marketing: 60 }, 'REVENUE_ENGINE'],
    ['operating business thresholds', 80, { operations: 70 }, 'OPERATING_BUSINESS'],
    ['growth business thresholds', 90, { growth: 70 }, 'GROWTH_BUSINESS'],
    ['enterprise ready', 95, {}, 'ENTERPRISE_READY'],
  ] as [string, number, Partial<Record<DnaSectionKey, number>>, GenomeStage][])(
    'returns %s stage',
    (_label, integrity, scoreOverrides, expectedStage) => {
      const { service } = makeService();
      expect(service.determineGenomeStage(integrity, scores(scoreOverrides))).toBe(expectedStage);
    },
  );

  it('detects the Three-Pillar Minimum', () => {
    const { service } = makeService();
    expect(service.checkThreePillarMinimum(scores({ founder: 50, business: 50, market: 50 }))).toBe(true);
    expect(service.checkThreePillarMinimum(scores({ founder: 40, business: 50, market: 50 }))).toBe(false);
  });
});
