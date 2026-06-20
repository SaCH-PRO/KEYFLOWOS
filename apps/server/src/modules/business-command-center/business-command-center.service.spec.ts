import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BusinessCommandCenterService } from './business-command-center.service';
import { BusinessIntelligenceService } from '../intelligence/business-intelligence.service';
import { KeyExecutiveModeService } from '../intelligence/key-executive-mode.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { BusinessAssetsService } from '../business-assets/business-assets.service';
import { ConstitutionVersionService } from '../business-genome/constitution-version.service';
import { GenomeScoringService } from '../business-genome/key-genome/genome-scoring.service';
import { GenomeModuleReadinessService } from '../business-genome/key-genome/genome-module-readiness.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import type { BusinessExecutiveBrief } from '../intelligence/business-intelligence.types';
import type { KeyExecutiveModeBrief } from '../intelligence/key-executive-mode.types';
import type { TemporalFlowAnalysis } from '../temporal-flow/temporal-flow.types';
import type { GenomeEvolutionProposalData } from '../business-genome/genome-evolution.types';
import type { GenomeIntegrityResult } from '../blueprint/blueprint.types';
import type { ConstitutionVersionData, ConstitutionStaleness } from '../business-genome/constitution-version.types';
import type { KeyActionProposalData } from '../key-autonomy/key-action-proposal.types';

const mockBrief: BusinessExecutiveBrief = {
  businessId: 'biz_1',
  generatedAt: new Date().toISOString(),
  summary: 'Business summary.',
  genomeIntegrity: 78,
  executiveReadinessScore: 65,
  genomeStage: 'OPERATING_BUSINESS',
  insights: [
    {
      id: 'cash-risk',
      domain: 'FINANCE',
      priority: 'HIGH',
      title: 'Cash flow risk',
      finding: 'Overdue invoices threaten cash flow.',
      evidence: ['Invoice #101 overdue'],
      confidence: 0.9,
      recommendedAction: { label: 'Review finance', actionType: 'REVIEW_FINANCE', href: '/app/finance' },
    },
    {
      id: 'low-priority',
      domain: 'OPERATIONS',
      priority: 'LOW',
      title: 'Low priority item',
      finding: 'Minor operational note.',
      evidence: [],
      confidence: 0.5,
    },
  ],
  topPriorities: [],
};

const makeModeBrief = (mode: string): KeyExecutiveModeBrief => ({
  businessId: 'biz_1',
  mode: mode as any,
  generatedAt: new Date().toISOString(),
  title: mode,
  summary: `${mode} summary.`,
  diagnosis: `${mode} diagnosis.`,
  findings: [],
  recommendedActions: [],
  risks: [],
  opportunities: [],
});

const mockTemporal: TemporalFlowAnalysis = {
  summary: 'Temporal summary.',
  urgentItems: [
    { title: 'Overdue invoice #101', reason: 'Invoice #101 is 7 days overdue.', eventId: 'ev_1' },
  ],
  opportunities: [{ title: 'Instagram momentum', evidence: ['3 DMs this week'] }],
  risks: [{ title: 'Cash flow risk from overdue invoices', severity: 'HIGH', evidence: ['Invoice #101 overdue'] }],
  genomeProposalCandidates: [],
};

const mockProposal: GenomeEvolutionProposalData = {
  id: 'gep_1',
  businessId: 'biz_1',
  section: 'marketing',
  proposedPatch: {},
  reason: 'Improve targeting',
  evidence: ['ev_2'],
  confidence: 0.8,
  status: 'PENDING',
  createdBy: null,
  approvedBy: null,
  approvedAt: null,
  rejectedAt: null,
  sourceEventIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockGenome: GenomeIntegrityResult = {
  genomeIntegrity: 78,
  genomeDnaScores: {} as any,
  genomeDnaConfidence: {} as any,
  genomeStage: 'OPERATING_BUSINESS',
  threePillarMinimumMet: true,
  dnaSections: [
    { key: 'marketing', label: 'Marketing', integrity: 35, confidence: 0.6, summary: '', fieldsCaptured: 0, fieldsTotal: 0, missingFields: [], recommendation: '' },
    { key: 'financial', label: 'Financial', integrity: 75, confidence: 0.7, summary: '', fieldsCaptured: 0, fieldsTotal: 0, missingFields: [], recommendation: '' },
  ],
  executiveReadinessScore: 65,
  readinessBreakdown: {},
};

const mockAssets = [
  { id: 'a1', businessId: 'biz_1', type: 'DOMAIN', name: 'Domain', status: 'ACTIVE', expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), metadata: {}, createdAt: new Date(), updatedAt: new Date() },
  { id: 'a2', businessId: 'biz_1', type: 'LICENSE', name: 'License', status: 'ACTIVE', expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
];

const mockConstitution: ConstitutionVersionData = {
  id: 'cv_1',
  businessId: 'biz_1',
  version: 1,
  title: 'Constitution',
  status: 'ACTIVE',
  content: {},
  generatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const mockStaleness: ConstitutionStaleness = {
  stale: true,
  reason: 'Genome has changed since the last Constitution.',
  currentGenomeIntegrity: 78,
  constitutionGenomeIntegrity: 72,
  currentExecutiveReadiness: 65,
  constitutionExecutiveReadiness: 60,
  currentGenomeStage: 'OPERATING_BUSINESS',
  constitutionGenomeStage: 'OPERATING_BUSINESS',
};

const mockKeyGenomeScore = {
  businessId: 'biz_1',
  overall: 0.45,
  integrity: 0.6,
  readiness: 0.5,
  confidence: 0.55,
  sections: [
    {
      section: 'VISION_IDENTITY',
      weight: 6,
      score: {
        completeness: 0.5,
        quality: 0.7,
        confidence: 0.6,
        freshness: 0.9,
        operationalReadiness: 0.5,
        riskPenalty: 0.03,
        overall: 0.35,
      },
    },
    {
      section: 'FINANCIAL',
      weight: 12,
      score: {
        completeness: 0.8,
        quality: 0.7,
        confidence: 0.5,
        freshness: 0.8,
        operationalReadiness: 0.6,
        riskPenalty: 0.03,
        overall: 0.55,
      },
    },
  ],
  computedAt: new Date().toISOString(),
};

const mockModuleReadiness = [
  {
    businessId: 'biz_1',
    module: 'key_inbox',
    readinessScore: 25,
    requiredFacts: [],
    missingFacts: [
      {
        section: 'VISION_IDENTITY',
        domain: 'identity',
        field: 'business_name',
        reason: 'Missing blocking fact: Business name',
        impact: 'BLOCKING' as const,
      },
    ],
    optionalFacts: [],
    blockedReasons: ['Missing blocking fact: identity.business_name'],
    recommendedSetupActions: ['Provide blocking fact: identity.business_name'],
    automationAllowed: false,
    riskLevel: 'HIGH' as const,
    lastComputedAt: new Date().toISOString(),
  },
  {
    businessId: 'biz_1',
    module: 'finance',
    readinessScore: 80,
    requiredFacts: [],
    missingFacts: [],
    optionalFacts: [],
    blockedReasons: [],
    recommendedSetupActions: [],
    automationAllowed: true,
    riskLevel: 'LOW' as const,
    lastComputedAt: new Date().toISOString(),
  },
];

const mockKeyProposal: KeyActionProposalData = {
  id: 'kap_1',
  businessId: 'biz_1',
  sourceType: 'EXECUTIVE_MODE',
  sourceMode: 'STRATEGIST',
  title: 'Generate Constitution version',
  summary: 'Generate a new Constitution version.',
  rationale: 'Constitution is stale.',
  evidence: ['Genome changed'],
  actionType: 'GENERATE_CONSTITUTION_VERSION',
  payload: {},
  riskLevel: 'MEDIUM',
  status: 'PENDING',
  requiresApproval: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('BusinessCommandCenterService', () => {
  let service: BusinessCommandCenterService;
  const mockSignalList = vi.fn().mockResolvedValue([]);

  beforeEach(async () => {
    mockSignalList.mockReset().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        BusinessCommandCenterService,
        { provide: BusinessIntelligenceService, useValue: { generateExecutiveBrief: async () => mockBrief } },
        { provide: KeyExecutiveModeService, useValue: { generateModeBrief: async (_biz: string, mode: string) => makeModeBrief(mode) } },
        { provide: KeyActionProposalService, useValue: { list: async (_biz: string, query: { status?: string }) => (query?.status === 'PENDING' ? [mockKeyProposal] : []) } },
        { provide: TemporalFlowService, useValue: { analyze: async () => mockTemporal } },
        { provide: GenomeEvolutionService, useValue: { list: async () => [mockProposal] } },
        { provide: BlueprintService, useValue: { calculateGenomeIntegrity: async () => mockGenome } },
        { provide: BusinessAssetsService, useValue: { list: async () => mockAssets } },
        { provide: ConstitutionVersionService, useValue: { latest: async () => mockConstitution, staleness: async () => mockStaleness } },
        { provide: GenomeScoringService, useValue: { computeFactScores: vi.fn().mockResolvedValue([]), computeBusinessScore: vi.fn().mockReturnValue(mockKeyGenomeScore) } },
        { provide: GenomeModuleReadinessService, useValue: { computeReadiness: vi.fn().mockResolvedValue(mockModuleReadiness) } },
        { provide: GenomeSignalService, useValue: { listSignals: mockSignalList } },
      ],
    }).compile();

    service = moduleRef.get(BusinessCommandCenterService);
  });

  it('returns a snapshot with businessId and generatedAt', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.businessId).toBe('biz_1');
    expect(new Date(snapshot.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it('includes health metrics', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.health.genomeIntegrity).toBe(78);
    expect(snapshot.health.executiveReadinessScore).toBe(65);
    expect(snapshot.health.pendingApprovalCount).toBe(1);
    expect(snapshot.health.urgentTemporalCount).toBe(1);
    expect(snapshot.health.pendingGenomeProposalCount).toBe(1);
    expect(snapshot.health.assetRiskCount).toBe(1);
    expect(snapshot.health.constitutionStale).toBe(true);
  });

  it('maps pending KEY approvals', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.pendingApprovals.length).toBe(1);
    expect(snapshot.pendingApprovals[0].type).toBe('KEY_APPROVAL');
    expect(snapshot.pendingApprovals[0].title).toBe('Generate Constitution version');
  });

  it('maps urgent Temporal Flow items', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.urgentItems.length).toBe(1);
    expect(snapshot.urgentItems[0].type).toBe('TEMPORAL_URGENT');
    expect(snapshot.urgentItems[0].priority).toBe('HIGH');
  });

  it('maps risks from executive brief and temporal flow', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.risks.some((r) => r.type === 'RISK' && r.title.includes('Cash'))).toBe(true);
  });

  it('maps opportunities from temporal flow', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.opportunities.length).toBeGreaterThan(0);
    expect(snapshot.opportunities[0].type).toBe('OPPORTUNITY');
  });

  it('maps pending Genome Evolution proposals', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.genome.pendingProposals.length).toBe(1);
    expect(snapshot.genome.pendingProposals[0].type).toBe('GENOME_PROPOSAL');
  });

  it('maps asset expiry risks', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.risks.some((r) => r.type === 'ASSET_RISK')).toBe(true);
  });

  it('reports stale Constitution', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.constitution.stale).toBe(true);
    expect(snapshot.constitution.latestVersion).toBe(1);
  });

  it('includes executive mode cards', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.executiveModes.length).toBe(8);
    expect(snapshot.executiveModes[0].href).toContain('/app/key-modes?mode=');
  });

  it('ranks top priorities by priority and type weight', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.topPriorities.length).toBeGreaterThan(0);
    const priorities = snapshot.topPriorities.map((p) => p.priority);
    const ranks = priorities.map((p) => ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[p]));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
    }
  });

  it('provides recommended actions from top priorities', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.recommendedActions.length).toBeGreaterThan(0);
  });

  it('includes KEY Genome score in snapshot', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.keyGenome.overall).toBe(45);
    expect(snapshot.keyGenome.confidence).toBe(55);
    expect(snapshot.keyGenome.weakestSections.length).toBeGreaterThan(0);
  });

  it('includes module readiness in snapshot', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.moduleReadiness.length).toBe(2);
    expect(snapshot.moduleReadiness.some((m) => m.module === 'key_inbox')).toBe(true);
  });

  it('creates a MODULE_READINESS priority item for blocked modules', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.topPriorities.some((i) => i.type === 'MODULE_READINESS')).toBe(true);
  });

  it('creates a MISSING_FACT priority item for blocking missing facts', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.topPriorities.some((i) => i.type === 'MISSING_FACT' && i.priority === 'HIGH')).toBe(true);
  });

  it('creates a KEY_GENOME_GAP item for weak sections', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.topPriorities.some((i) => i.type === 'KEY_GENOME_GAP')).toBe(true);
  });

  it('includes KEY Genome metrics in health', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.health.keyGenomeOverall).toBe(45);
    expect(snapshot.health.blockedModuleCount).toBe(1);
    expect(snapshot.health.missingBlockingFactCount).toBe(1);
  });

  it('mentions KEY Genome in summary when facts exist', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.summary).toContain('KEY Genome');
  });

  it('creates a GENOME_SIGNAL priority item for high-confidence NEW signals', async () => {
    mockSignalList.mockResolvedValueOnce([
      {
        id: 'sig_1',
        businessId: 'biz_1',
        sourceModule: 'key_inbox',
        sourceEntityType: 'KeyInboxThread',
        sourceEntityId: 'thread_1',
        signalType: 'FACT_CONFLICT',
        section: 'CUSTOMER_MARKET',
        domain: 'customer',
        field: 'pain_points',
        proposedValue: ['weekend delivery'],
        reason: 'Customers keep asking about weekend delivery.',
        evidence: [{ summary: 'Three customers asked about weekend delivery.', sourceModule: 'key_inbox', sourceEntityType: 'KeyInboxThread' }],
        confidence: 0.85,
        status: 'NEW',
        createdAt: new Date().toISOString(),
      },
    ]);
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.topPriorities.some((i) => i.type === 'GENOME_SIGNAL')).toBe(true);
  });

  it('does not surface low-confidence NEW signals in Command Center', async () => {
    mockSignalList.mockResolvedValueOnce([
      {
        id: 'sig_low',
        businessId: 'biz_1',
        sourceModule: 'temporal_flow',
        sourceEntityType: 'TemporalEvent',
        sourceEntityId: 'ev_low',
        signalType: 'OPERATIONS_PATTERN',
        section: 'OPERATIONS_DELIVERY',
        domain: 'operations',
        field: 'capacity',
        proposedValue: null,
        reason: 'Maybe a capacity issue.',
        evidence: [{ summary: 'One ambiguous event.', sourceModule: 'temporal_flow', sourceEntityType: 'TemporalEvent' }],
        confidence: 0.4,
        status: 'NEW',
        createdAt: new Date().toISOString(),
      },
    ]);
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.topPriorities.some((i) => i.type === 'GENOME_SIGNAL')).toBe(false);
  });

  it('ranks FACT_CONFLICT signals as CRITICAL', async () => {
    mockSignalList.mockResolvedValueOnce([
      {
        id: 'sig_conflict',
        businessId: 'biz_1',
        sourceModule: 'executive_mode',
        sourceEntityType: 'CFO',
        sourceEntityId: 'finding_1',
        signalType: 'FACT_CONFLICT',
        section: 'FINANCIAL',
        domain: 'finance',
        field: 'pricing_model',
        proposedValue: 'subscription',
        reason: 'Pricing model conflicts between sources.',
        evidence: [{ summary: 'CFO review found conflicting pricing data.', sourceModule: 'executive_mode', sourceEntityType: 'CFO' }],
        confidence: 0.9,
        status: 'NEW',
        createdAt: new Date().toISOString(),
      },
    ]);
    const snapshot = await service.snapshot('biz_1');
    const signalItem = snapshot.topPriorities.find((i) => i.type === 'GENOME_SIGNAL');
    expect(signalItem).toBeDefined();
    expect(signalItem!.priority).toBe('CRITICAL');
  });
});
