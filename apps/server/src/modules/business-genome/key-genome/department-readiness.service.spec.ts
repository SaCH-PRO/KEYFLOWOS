import { describe, expect, it, vi } from 'vitest';
import { DepartmentReadinessService } from './department-readiness.service';
import { GenomeDepartmentService } from './genome-department.service';
import { GenomeModuleReadinessService } from './genome-module-readiness.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeScoringService } from './genome-scoring.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeMemoryService } from './genome-memory.service';
import { KEY_GENOME_DEPARTMENTS } from './key-genome-departments';
import type {
  GenomeDepartmentData,
  GenomeFactData,
  GenomeRecommendationData,
  GenomeSignalData,
  ModuleReadinessData,
  RiskLevel,
  SectionGenomeScore,
} from './key-genome.types';

function makeFact(section: string, domain: string, field: string, overrides: Partial<GenomeFactData> = {}): GenomeFactData {
  const now = new Date().toISOString();
  return {
    id: `fact_${Math.random().toString(36).slice(2)}`,
    businessId: 'biz_1',
    section,
    domain,
    field,
    value: { raw: 'value', type: 'STRING' },
    sourceModule: 'blueprint',
    sourceType: 'BLUEPRINT_BACKFILL',
    sourceEntityType: 'BusinessBlueprint',
    sourceEntityId: 'bp_1',
    verificationStatus: 'USER_VERIFIED',
    riskIfWrong: 'MEDIUM',
    lastVerifiedAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    score: {
      completeness: 1,
      quality: 0.8,
      confidence: 0.8,
      freshness: 1,
      operationalReadiness: 1,
      riskPenalty: 0.03,
      overall: 0.85,
    },
    ...overrides,
  };
}

function makeSectionScore(section: string, overall = 0.85, confidence = 0.8): SectionGenomeScore {
  return {
    section,
    weight: 10,
    score: {
      completeness: overall,
      quality: overall,
      confidence,
      freshness: overall,
      operationalReadiness: overall,
      riskPenalty: 0,
      overall,
    },
  };
}

function makeModuleReadiness(module: string, readinessScore: number, automationAllowed: boolean, missingFacts: ModuleReadinessData['missingFacts'] = []): ModuleReadinessData {
  return {
    businessId: 'biz_1',
    module,
    readinessScore,
    requiredFacts: [],
    missingFacts,
    optionalFacts: [],
    blockedReasons: missingFacts.map((m) => `Missing ${m.impact.toLowerCase()} fact: ${m.domain}.${m.field}`),
    recommendedSetupActions: missingFacts.map((m) => `Provide ${m.impact.toLowerCase()} fact: ${m.domain}.${m.field}`),
    automationAllowed,
    riskLevel: automationAllowed ? 'LOW' : 'HIGH',
    lastComputedAt: new Date().toISOString(),
  };
}

function makeService() {
  const departmentSnapshots: GenomeDepartmentData[] = [];

  const departments = {
    seedDepartments: vi.fn().mockImplementation(async (businessId: string) => {
      const seeded = KEY_GENOME_DEPARTMENTS.map((def) => {
        const existing = departmentSnapshots.find((d) => d.businessId === businessId && d.code === def.code);
        if (existing) return existing;
        const snapshot: GenomeDepartmentData = {
          id: `dept_${def.code}`,
          businessId,
          code: def.code,
          name: def.name,
          description: def.description,
          primarySections: def.primarySections,
          supportingSections: def.supportingSections,
          impactedModules: def.impactedModules,
          coreCapabilities: def.coreCapabilities,
          maturityScore: 0,
          readinessScore: 0,
          confidenceScore: 0,
          riskLevel: 'MEDIUM',
          autonomySensitive: def.autonomySensitive,
          automationAllowed: false,
          gapSummary: [],
          recommendedActions: [],
          lastComputedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        departmentSnapshots.push(snapshot);
        return snapshot;
      });
      return seeded;
    }),
    upsertDepartmentSnapshot: vi.fn().mockImplementation(async (businessId: string, data: Partial<GenomeDepartmentData> & { code: string }) => {
      const existing = departmentSnapshots.find((d) => d.businessId === businessId && d.code === data.code);
      if (existing) {
        Object.assign(existing, data, { updatedAt: new Date().toISOString(), lastComputedAt: new Date().toISOString() });
        return existing;
      }
      const def = KEY_GENOME_DEPARTMENTS.find((d) => d.code === data.code);
      const snapshot: GenomeDepartmentData = {
        id: `dept_${data.code}`,
        businessId,
        code: data.code,
        name: def?.name ?? data.code,
        description: def?.description ?? null,
        primarySections: def?.primarySections ?? [],
        supportingSections: def?.supportingSections ?? [],
        impactedModules: def?.impactedModules ?? [],
        coreCapabilities: def?.coreCapabilities ?? [],
        maturityScore: data.maturityScore ?? 0,
        readinessScore: data.readinessScore ?? 0,
        confidenceScore: data.confidenceScore ?? 0,
        riskLevel: (data.riskLevel as RiskLevel) ?? 'MEDIUM',
        autonomySensitive: def?.autonomySensitive ?? false,
        automationAllowed: data.automationAllowed ?? false,
        gapSummary: data.gapSummary ?? [],
        recommendedActions: data.recommendedActions ?? [],
        lastComputedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      departmentSnapshots.push(snapshot);
      return snapshot;
    }),
  } as unknown as GenomeDepartmentService;

  const scoring = {
    computeFactScores: vi.fn().mockResolvedValue([]),
    computeBusinessScore: vi.fn().mockImplementation((businessId: string, facts: GenomeFactData[] = []) => {
      const sectionMap = new Map<string, GenomeFactData[]>();
      for (const fact of facts) {
        const list = sectionMap.get(fact.section) ?? [];
        list.push(fact);
        sectionMap.set(fact.section, list);
      }

      const sections: SectionGenomeScore[] = Array.from(sectionMap.entries()).map(([section, sectionFacts]) => {
        const avg = sectionFacts.reduce((sum, f) => sum + f.score.overall, 0) / sectionFacts.length;
        const conf = sectionFacts.reduce((sum, f) => sum + f.score.confidence, 0) / sectionFacts.length;
        return makeSectionScore(section, avg, conf);
      });

      return {
        businessId,
        overall: 0.7,
        integrity: 0.7,
        readiness: 0.7,
        confidence: 0.7,
        sections,
        computedAt: new Date().toISOString(),
      };
    }),
  } as any;

  const readiness = {
    computeReadiness: vi.fn().mockResolvedValue([]),
  } as any;

  const signals = {
    listSignals: vi.fn().mockResolvedValue([]),
  } as any;

  const recommendations = {
    listRecommendations: vi.fn().mockResolvedValue([]),
  } as any;

  const memory = {
    listMemoryEvents: vi.fn().mockResolvedValue([]),
  } as any;

  const service = new DepartmentReadinessService(
    departments,
    scoring,
    readiness,
    signals,
    recommendations,
    memory,
  );

  return { service, departments, scoring, readiness, signals, recommendations, memory };
}

describe('DepartmentReadinessService', () => {
  it('computes maturity from primary and supporting section scores', async () => {
    const { service, scoring, readiness } = makeService();

    const facts = [
      makeFact('FINANCIAL', 'finance', 'currency'),
      makeFact('FINANCIAL', 'finance', 'cost_structure'),
      makeFact('BUSINESS_MODEL', 'model', 'revenue_model'),
    ];

    scoring.computeFactScores.mockResolvedValue(facts);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 80, true),
      makeModuleReadiness('commerce', 75, true),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance).toBeDefined();
    // Primary avg = (0.85 + 0.85) / 2 = 0.85; supporting sections have no facts (0).
    // maturity = 0.85 * 100 * 0.7 + 0 * 0.3 = 59.5
    expect(finance!.maturityScore).toBeCloseTo(59.5, 1);
  });

  it('computes readiness from impacted module readiness', async () => {
    const { service, scoring, readiness } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 60, false),
      makeModuleReadiness('commerce', 80, true),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance!.readinessScore).toBe(70); // (60 + 80) / 2
  });

  it('computes confidence from section confidence scores', async () => {
    const { service, scoring, readiness } = makeService();

    const facts = [
      makeFact('MARKETING_GROWTH', 'marketing', 'primary_channel', { score: { ...makeFact('MARKETING_GROWTH', 'marketing', 'primary_channel').score, confidence: 0.6 } }),
      makeFact('CUSTOMER_MARKET', 'customer', 'ideal_customer', { score: { ...makeFact('CUSTOMER_MARKET', 'customer', 'ideal_customer').score, confidence: 0.7 } }),
      makeFact('VISION_IDENTITY', 'identity', 'business_name', { score: { ...makeFact('VISION_IDENTITY', 'identity', 'business_name').score, confidence: 0.9 } }),
    ];

    scoring.computeFactScores.mockResolvedValue(facts);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('marketing', 90, true),
      makeModuleReadiness('key_inbox', 85, true),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const marketing = results.find((d) => d.code === 'CMO_MARKETING');

    // Primary sections: MARKETING_GROWTH (0.6), CUSTOMER_MARKET (0.7), VISION_IDENTITY (0.9) => avg = 0.7333
    expect(marketing!.confidenceScore).toBeCloseTo(73.33, 1);
  });

  it('marks autonomy-sensitive low-readiness department HIGH/CRITICAL', async () => {
    const { service, scoring, readiness } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('key_autonomy', 20, false),
      makeModuleReadiness('command_center', 30, false),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const tech = results.find((d) => d.code === 'TECH_DATA');

    expect(tech!.readinessScore).toBe(25);
    expect(tech!.riskLevel).toBe('CRITICAL');
    expect(tech!.automationAllowed).toBe(false);
  });

  it('allows automation only when thresholds pass', async () => {
    const { service, scoring, readiness } = makeService();

    const facts = [
      makeFact('MARKETING_GROWTH', 'marketing', 'primary_channel'),
      makeFact('CUSTOMER_MARKET', 'customer', 'ideal_customer'),
      makeFact('VISION_IDENTITY', 'identity', 'business_name'),
      makeFact('OFFER_PRODUCT', 'offer', 'core_offer'),
    ];

    scoring.computeFactScores.mockResolvedValue(facts);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('marketing', 90, true),
      makeModuleReadiness('key_inbox', 88, true),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const marketing = results.find((d) => d.code === 'CMO_MARKETING');

    expect(marketing!.readinessScore).toBe(89);
    expect(marketing!.maturityScore).toBeGreaterThanOrEqual(70);
    expect(marketing!.automationAllowed).toBe(true);
    expect(marketing!.riskLevel).toBe('LOW');
  });

  it('requires higher thresholds for autonomy-sensitive departments', async () => {
    const { service, scoring, readiness } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 80, true),
      makeModuleReadiness('commerce', 78, true),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance!.readinessScore).toBe(79);
    expect(finance!.automationAllowed).toBe(false); // autonomy-sensitive needs >= 85
  });

  it('produces missing fact gaps', async () => {
    const { service, scoring, readiness } = makeService();

    // No facts provided, so FINANCIAL required facts will be missing.
    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 0, false, [
        { section: 'FINANCIAL', domain: 'finance', field: 'currency', reason: 'Missing currency', impact: 'BLOCKING' },
      ]),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance!.gapSummary.some((g) => g.type === 'MISSING_FACT' && g.field === 'currency')).toBe(true);
  });

  it('produces module blocker gaps', async () => {
    const { service, scoring, readiness } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 40, false, [
        { section: 'FINANCIAL', domain: 'finance', field: 'currency', reason: 'Missing currency', impact: 'BLOCKING' },
      ]),
      makeModuleReadiness('commerce', 90, true),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance!.gapSummary.some((g) => g.type === 'READINESS_BLOCKER')).toBe(true);
  });

  it('produces recommended setup actions', async () => {
    const { service, scoring, readiness } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 40, false, [
        { section: 'FINANCIAL', domain: 'finance', field: 'currency', reason: 'Missing currency', impact: 'BLOCKING' },
      ]),
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance!.recommendedActions.length).toBeGreaterThan(0);
    expect(finance!.recommendedActions.some((a) => a.priority === 'CRITICAL' || a.priority === 'HIGH')).toBe(true);
  });

  it('upserts computed department snapshots', async () => {
    const { service, departments } = makeService();

    await service.computeDepartmentReadiness('biz_1');

    expect(departments.upsertDepartmentSnapshot).toHaveBeenCalledTimes(KEY_GENOME_DEPARTMENTS.length);
    const firstCall = (departments.upsertDepartmentSnapshot as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(firstCall).toHaveProperty('maturityScore');
    expect(firstCall).toHaveProperty('readinessScore');
    expect(firstCall).toHaveProperty('gapSummary');
  });

  it('computes a single department by code', async () => {
    const { service, scoring, readiness } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('crm', 95, true),
      makeModuleReadiness('commerce', 92, true),
      makeModuleReadiness('key_inbox', 90, true),
    ]);

    const sales = await service.computeOneDepartment('biz_1', 'SALES');
    expect(sales.code).toBe('SALES');
    expect(sales.readinessScore).toBeCloseTo(92.33, 1);
  });

  it('surfaces high-confidence signals as department risks', async () => {
    const { service, scoring, readiness, signals } = makeService();

    scoring.computeFactScores.mockResolvedValue([]);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 90, true),
      makeModuleReadiness('commerce', 90, true),
    ]);

    signals.listSignals.mockResolvedValue([
      {
        id: 'sig_1',
        businessId: 'biz_1',
        sourceModule: 'finance',
        signalType: 'FACT_CONFLICT',
        section: 'FINANCIAL',
        domain: 'finance',
        field: 'currency',
        reason: 'Currency mismatch detected',
        evidence: [],
        confidence: 0.9,
        status: 'NEW',
        createdAt: new Date().toISOString(),
        reviewedAt: null,
      } as GenomeSignalData,
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    expect(finance!.gapSummary.some((g) => g.type === 'RISK' && g.section === 'FINANCIAL')).toBe(true);
  });

  it('boosts confidence for successful memory and penalizes failures', async () => {
    const { service, scoring, readiness, memory } = makeService();

    const facts = [makeFact('FINANCIAL', 'finance', 'currency', { score: { ...makeFact('FINANCIAL', 'finance', 'currency').score, confidence: 0.5 } })];
    scoring.computeFactScores.mockResolvedValue(facts);
    readiness.computeReadiness.mockResolvedValue([
      makeModuleReadiness('finance', 90, true),
      makeModuleReadiness('commerce', 90, true),
    ]);

    memory.listMemoryEvents.mockResolvedValue([
      { section: 'FINANCIAL', domain: 'finance', outcome: 'SUCCESS', confidenceDelta: 0.1, title: 'Good currency update' },
      { section: 'FINANCIAL', domain: 'finance', outcome: 'FAILURE', confidenceDelta: -0.1, title: 'Bad pricing change' },
    ]);

    const results = await service.computeDepartmentReadiness('biz_1');
    const finance = results.find((d) => d.code === 'CFO_FINANCE');

    // FINANCIAL primary section has one fact with confidence 0.5; BUSINESS_MODEL has none.
    // Base confidence = (0.5 + 0) / 2 * 100 = 25; memory adjustment = (1 - 1) * 5 = 0
    expect(finance!.confidenceScore).toBe(25);
  });
});
