import { describe, expect, it, vi } from 'vitest';
import { BlueprintService } from './blueprint.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { DnaSectionKey, GenomeStage } from './blueprint.types';

function makeService(row?: Record<string, unknown>) {
  const prisma = {
    client: {
      businessBlueprint: {
        findUnique: vi.fn().mockResolvedValue(row ?? null),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data })),
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
      business: {
        findUnique: vi.fn().mockResolvedValue({ id: 'biz_1', name: 'Test Business', metaData: {} }),
      },
    },
  } as unknown as PrismaService;

  return new BlueprintService(prisma);
}

function emptyBlueprintRow(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    identity: {},
    operatingModel: {},
    goals: {},
    constraints: {},
    brand: {},
    customerModel: {},
    financials: {},
    intelligence: {},
    workflowModel: {},
    aiPreferences: {},
    founderProfile: {},
    legalProfile: {},
    registrationProfile: {},
    taxProfile: {},
    ownershipProfile: {},
    marketProfile: {},
    offerArchitecture: {},
    salesSystem: {},
    marketingSystem: {},
    operationsSystem: {},
    projectionProfile: {},
    riskProfile: {},
    complianceProfile: {},
    executionRoadmap: {},
    documentProfile: {},
    readinessScore: 0,
    confidenceScores: {},
    completeness: 0,
    lastAnalyzedAt: null,
    updatedAt: new Date(),
  };
}

function fullBlueprintRow(): Record<string, unknown> {
  return {
    ...emptyBlueprintRow(),
    identity: {
      name: 'Acme',
      archetype: 'Innovator',
      industry: 'SaaS',
      tagline: 'Do more',
      oneLiner: 'We help teams ship faster.',
      mission: 'Empower teams',
      vision: 'World where every team is productive',
      values: ['speed', 'quality'],
      country: 'TT',
    },
    operatingModel: {
      revenueModel: 'subscription',
      deliveryMode: 'digital',
      serviceArea: 'global',
      channels: ['online'],
      teamSize: '5',
      primaryWorkflow: 'project-based',
    },
    goals: {
      northStar: 'ARR 1M',
      ninetyDayGoals: ['launch'],
      twelveMonthGoals: ['scale'],
      priorities: ['sales'],
    },
    constraints: {
      budgetRange: 'low',
      timeCommitment: 'full-time',
      riskTolerance: 'medium',
    },
    brand: {
      voice: 'confident',
      tone: 'friendly',
      primaryColor: '#000',
      valueProps: ['fast', 'easy'],
    },
    customerModel: {
      idealCustomer: 'Startups',
      segments: ['startups', 'agencies'],
      painPoints: ['slow delivery'],
    },
    financials: {
      currency: 'TTD',
      pricingModel: 'subscription',
      avgTicket: 500,
      monthlyTarget: 10000,
    },
    workflowModel: {
      primaryWorkflow: 'project-based',
    },
    aiPreferences: {
      autonomyLevel: 'medium',
      tone: 'professional',
      outreachStyle: 'direct',
      reportingCadence: 'weekly',
    },
    founderProfile: {
      founderName: 'Alice',
      background: 'Engineer',
      skills: ['coding', 'sales'],
      weeklyAvailabilityHours: 40,
    },
    legalProfile: {
      country: 'TT',
      recommendedEntityType: 'LIMITED_COMPANY',
      regulatedIndustry: false,
    },
    registrationProfile: {
      businessNameStatus: 'RESERVED',
      companiesRegistryStatus: 'REGISTERED',
      vatStatus: 'NOT_REQUIRED',
    },
    taxProfile: {
      country: 'TT',
      taxIdStatus: 'APPLIED',
      taxReadinessScore: 80,
    },
    ownershipProfile: {
      hasPartners: false,
      owners: [{ name: 'Alice', percent: 100 }],
    },
    complianceProfile: {
      complianceItems: [{ id: '1', label: 'Tax filing', status: 'NOT_STARTED', priority: 'HIGH' }],
      complianceScore: 50,
    },
    marketProfile: {
      targetGeography: 'Caribbean',
      marketCategory: 'B2B SaaS',
      demandSignals: ['inbound growth'],
    },
    salesSystem: {
      salesChannels: ['website'],
      pipelineStages: ['lead', 'closed'],
    },
    marketingSystem: {
      channels: ['linkedin'],
      launchPlan: ['announcement'],
    },
    operationsSystem: {
      coreWorkflows: ['design', 'build'],
      fulfillmentProcess: ['ship'],
    },
    projectionProfile: {
      startupCapital: 10000,
      monthlyFixedCosts: 3000,
      variableCostPercent: 20,
    },
    executionRoadmap: {
      today: ['setup'],
      sevenDayPlan: ['validate'],
      thirtyDayPlan: ['launch'],
    },
  };
}

function partialThreePillarRow(): Record<string, unknown> {
  return {
    ...emptyBlueprintRow(),
    // Founder DNA: 2 of 4 fields = 50%
    founderProfile: {
      founderName: 'Alice',
      weeklyAvailabilityHours: 40,
    },
    // Business DNA: 7 of 14 fields = 50%
    identity: { name: 'Acme', archetype: 'Innovator', industry: 'SaaS' },
    operatingModel: { revenueModel: 'subscription', deliveryMode: 'digital', serviceArea: 'global', teamSize: '5' },
    // Market DNA: 3 of 6 fields = 50%
    customerModel: { idealCustomer: 'Startups', segments: ['startups'], painPoints: ['slow'] },
  };
}

describe('BlueprintService genome integrity', () => {
  it('returns all zeros for an empty blueprint', () => {
    const service = makeService(emptyBlueprintRow());
    const result = (service as any).buildGenomeIntegrityResult(emptyBlueprintRow());

    expect(result.genomeIntegrity).toBe(0);
    expect(result.genomeStage).toBe('CONCEPT');
    expect(result.threePillarMinimumMet).toBe(false);
    for (const section of result.dnaSections) {
      expect(section.integrity).toBe(0);
    }
  });

  it('returns 100 integrity and ENTERPRISE_READY for a fully populated blueprint', () => {
    const service = makeService(fullBlueprintRow());
    const result = (service as any).buildGenomeIntegrityResult(fullBlueprintRow());

    expect(result.genomeIntegrity).toBe(100);
    expect(result.genomeStage).toBe('ENTERPRISE_READY');
    expect(result.threePillarMinimumMet).toBe(true);
    for (const section of result.dnaSections) {
      expect(section.integrity).toBe(100);
    }
  });

  it('detects Three-Pillar Minimum met at exactly 50% per pillar', () => {
    const service = makeService(partialThreePillarRow());
    const result = (service as any).buildGenomeIntegrityResult(partialThreePillarRow());

    expect(result.genomeDnaScores.founder).toBe(50);
    expect(result.genomeDnaScores.business).toBe(50);
    expect(result.genomeDnaScores.market).toBe(50);
    expect(result.threePillarMinimumMet).toBe(true);
    expect(result.genomeStage).toBe('VALIDATED_CONCEPT');
  });

  it('does not throw when Genesis JSON columns are missing/null', () => {
    const row = {
      ...emptyBlueprintRow(),
      founderProfile: null,
      legalProfile: undefined,
      marketProfile: null,
      salesSystem: undefined,
    };
    const service = makeService(row);

    expect(() => (service as any).buildGenomeIntegrityResult(row)).not.toThrow();
  });

  it('computes integrity via calculateGenomeIntegrity using the DB row', async () => {
    const row = fullBlueprintRow();
    const service = makeService(row);
    const result = await service.calculateGenomeIntegrity('biz_1');

    expect(result.genomeIntegrity).toBe(100);
    expect(result.genomeStage).toBe('ENTERPRISE_READY');
  });
});

describe('BlueprintService stage determination', () => {
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
      ...overrides,
    };
  }

  it.each<[string, number, Partial<Record<DnaSectionKey, number>>, GenomeStage]>([
    ['empty', 0, {}, 'CONCEPT'],
    ['three pillars at 50', 0, { founder: 50, business: 50, market: 50 }, 'VALIDATED_CONCEPT'],
    ['registered entity thresholds', 55, { founder: 60, business: 60, market: 60, legal: 60, financial: 45 }, 'REGISTERED_ENTITY'],
    ['revenue engine thresholds', 65, { sales: 60, marketing: 60 }, 'REVENUE_ENGINE'],
    ['operating business thresholds', 80, { operations: 70 }, 'OPERATING_BUSINESS'],
    ['growth business thresholds', 90, { growth: 70 }, 'GROWTH_BUSINESS'],
    ['enterprise ready', 95, {}, 'ENTERPRISE_READY'],
  ])(
    'returns %s stage',
    (_label, integrity, scoreOverrides, expectedStage) => {
      const service = makeService();
      const result = service.determineGenomeStage(integrity, scores(scoreOverrides));
      expect(result).toBe(expectedStage);
    },
  );
});
