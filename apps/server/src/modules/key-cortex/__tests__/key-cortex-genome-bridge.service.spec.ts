import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexGenomeBridgeService } from '../key-cortex-genome-bridge.service';

const mockPrisma = {
  client: {
    businessGenome: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    genomeSignal: {
      findMany: vi.fn(),
    },
    genomeRecommendation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    genomeEvolutionProposal: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    genomeCrossDomainSnapshot: {
      findFirst: vi.fn(),
    },
    genomeModuleReadiness: {
      findMany: vi.fn(),
    },
    genomeEvidence: {
      create: vi.fn(),
    },
    genomeRecommendationOutcome: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    cognitionMemory: {
      create: vi.fn(),
    },
  },
};

const mockRanker = {
  rankRecommendations: vi.fn(),
};

const mockAutonomyGate = {
  checkGate: vi.fn(),
};

const mockOpportunityDetector = {
  detectOpportunities: vi.fn(),
};

const mockCrossDomain = {
  getLatestCrossDomainSnapshot: vi.fn(),
};

const mockSignalService = {
  listSignals: vi.fn(),
  createSignal: vi.fn(),
};

const mockModuleReadiness = {
  getReadiness: vi.fn(),
};

const mockGenomeEvidence = {
  attachEvidence: vi.fn(),
};

const mockOutcomeService = {
  recordOutcome: vi.fn(),
};

function createService(): KeyCortexGenomeBridgeService {
  return new KeyCortexGenomeBridgeService(
    mockPrisma as any,
    undefined,
    undefined,
    mockRanker as any,
    mockAutonomyGate as any,
    mockOpportunityDetector as any,
    mockCrossDomain as any,
    mockSignalService as any,
    mockModuleReadiness as any,
    mockGenomeEvidence as any,
    mockOutcomeService as any,
  );
}

describe('KeyCortexGenomeBridgeService', () => {
  let service: KeyCortexGenomeBridgeService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = createService();
  });

  describe('getGenomeIntelligence', () => {
    it('returns genome intelligence with real recommendations and signals', async () => {
      mockPrisma.client.businessGenome.findUnique.mockResolvedValue({
        businessId: 'biz_1',
        dnaScores: { finance: 75 },
        stage: 'growth',
        executiveReadiness: 80,
      });
      mockSignalService.listSignals.mockResolvedValue([
        { id: 'sig_1', signalType: 'risk', reason: 'Cash runway low', sourceModule: 'finance', createdAt: new Date().toISOString() },
      ]);
      mockRanker.rankRecommendations.mockResolvedValue({
        rankedRecommendations: [
          {
            id: 'rec_1',
            domain: 'finance',
            title: 'Reduce burn',
            insight: 'Burn is high',
            recommendation: 'Cut costs',
            confidence: 0.9,
            expectedGainScore: 80,
            effortLevel: 'LOW',
            rankScore: 0.95,
            rankReason: 'High impact, low effort',
            riskLevel: 'MEDIUM',
            financialViability: 'STRONG',
            capacityGating: 'NO_CONSTRAINT',
            readinessGating: { blockingDomains: [], readyDomains: ['finance'] },
          },
        ],
      });
      mockOpportunityDetector.detectOpportunities.mockResolvedValue({
        prioritizedOpportunities: [
          { id: 'opp_1', label: 'Reinvest cash', affectedDomains: ['finance'], potentialImpact: 'HIGH', confidence: 0.8, estimatedValueScore: 90, suggestedAction: 'Invest', requiredConditions: [], evidence: [] },
        ],
      });
      mockCrossDomain.getLatestCrossDomainSnapshot.mockResolvedValue({
        overallHealthScore: 72,
        overallRiskLevel: 'MEDIUM',
      });
      mockModuleReadiness.getReadiness.mockResolvedValue([
        { module: 'finance', readinessScore: 85, automationAllowed: true, riskLevel: 'LOW' },
      ]);

      const intel = await service.getGenomeIntelligence('biz_1');

      expect(intel.businessId).toBe('biz_1');
      expect(intel.genomeStage).toBe('growth');
      expect(intel.recommendations).toHaveLength(1);
      expect(intel.recommendations[0]).toMatchObject({
        id: 'rec_1',
        title: 'Reduce burn',
        category: 'finance',
      });
      expect(intel.signals).toHaveLength(1);
      expect(intel.signals[0]).toMatchObject({
        type: 'risk',
        message: 'Cash runway low',
        severity: 'high',
      });
      expect(intel.opportunities).toHaveLength(1);
      expect(intel.autonomyMap).toEqual({ finance: true });
    });

    it('returns empty arrays when genome services are unavailable', async () => {
      const bareService = new KeyCortexGenomeBridgeService(mockPrisma as any);
      mockPrisma.client.businessGenome.findUnique.mockResolvedValue({
        businessId: 'biz_1',
        dnaScores: {},
        stage: 'unknown',
        executiveReadiness: 0,
      });

      const intel = await bareService.getGenomeIntelligence('biz_1');
      expect(intel.recommendations).toEqual([]);
      expect(intel.signals).toEqual([]);
      expect(intel.opportunities).toEqual([]);
    });
  });

  describe('checkAutonomy', () => {
    it('maps ALLOW to full autonomy', async () => {
      mockAutonomyGate.checkGate.mockResolvedValue({
        decision: 'ALLOW',
        riskLevel: 'LOW',
        blockingReasons: [],
        approvalReasons: ['Ready'],
      });

      const check = await service.checkAutonomy('biz_1', 'CREATE_INVOICE', { amount: 100 });
      expect(check.allowed).toBe(true);
      expect(check.tier).toBe('full');
      expect(check.requiresApproval).toBe(false);
    });

    it('maps ALLOW_WITH_APPROVAL to supervised', async () => {
      mockAutonomyGate.checkGate.mockResolvedValue({
        decision: 'ALLOW_WITH_APPROVAL',
        riskLevel: 'MEDIUM',
        blockingReasons: [],
        approvalReasons: ['High impact'],
      });

      const check = await service.checkAutonomy('biz_1', 'CREATE_INVOICE');
      expect(check.allowed).toBe(false);
      expect(check.tier).toBe('supervised');
      expect(check.requiresApproval).toBe(true);
    });

    it('maps BLOCK to manual', async () => {
      mockAutonomyGate.checkGate.mockResolvedValue({
        decision: 'BLOCK',
        riskLevel: 'CRITICAL',
        blockingReasons: ['Risk critical'],
        approvalReasons: [],
      });

      const check = await service.checkAutonomy('biz_1', 'DELETE_DATABASE');
      expect(check.allowed).toBe(false);
      expect(check.tier).toBe('manual');
    });
  });

  describe('getRankedRecommendations', () => {
    it('maps ranker result to bridge shape', async () => {
      mockRanker.rankRecommendations.mockResolvedValue({
        rankedRecommendations: [
          {
            id: 'rec_1',
            domain: 'sales',
            title: 'Follow up leads',
            insight: 'Leads cooling',
            recommendation: 'Call leads',
            confidence: 0.85,
            expectedGainScore: 70,
            effortLevel: 'MEDIUM',
            rankScore: 0.88,
            rankReason: 'High confidence',
            riskLevel: 'LOW',
            financialViability: 'GOOD',
            capacityGating: 'SOFT_CONSTRAINT',
            readinessGating: { blockingDomains: [], readyDomains: ['sales'] },
          },
        ],
      });

      const recs = await service.getRankedRecommendations('biz_1', 5);
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({
        id: 'rec_1',
        domain: 'sales',
        title: 'Follow up leads',
        safeToExecute: true,
      });
    });
  });

  describe('recordOutcome', () => {
    it('records outcome and creates cognition memory', async () => {
      mockPrisma.client.genomeRecommendation.findFirst.mockResolvedValue({ id: 'rec_1', domain: 'finance' });
      mockOutcomeService.recordOutcome.mockResolvedValue({ id: 'out_1' });

      await service.recordOutcome('biz_1', {
        success: true,
        module: 'finance',
        action: 'CREATE_INVOICE',
        result: 'success',
        approvalRequired: false,
      });

      expect(mockOutcomeService.recordOutcome).toHaveBeenCalled();
      expect(mockPrisma.client.cognitionMemory.create).toHaveBeenCalled();
    });
  });

  describe('reportActionOutcome', () => {
    it('records outcome and creates evidence on success', async () => {
      mockPrisma.client.genomeRecommendation.findFirst.mockResolvedValue({ id: 'rec_1' });
      mockOutcomeService.recordOutcome.mockResolvedValue({ id: 'out_1' });
      mockGenomeEvidence.attachEvidence.mockResolvedValue({ id: 'ev_1' });

      await service.reportActionOutcome('biz_1', {
        module: 'finance',
        action: 'CREATE_INVOICE',
        result: 'success',
        description: 'Invoice created',
      });

      expect(mockOutcomeService.recordOutcome).toHaveBeenCalled();
      expect(mockGenomeEvidence.attachEvidence).toHaveBeenCalled();
    });
  });
});
