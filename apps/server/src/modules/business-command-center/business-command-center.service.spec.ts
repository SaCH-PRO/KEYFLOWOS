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
import { GenomeRecommendationService } from '../business-genome/key-genome/genome-recommendation.service';
import { CommandCenterKeyGenomeBridgeService } from './command-center-key-genome-bridge.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { runWithTenant } from '../../core/tenant/tenant-context';
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

const mockCrossDomainBrief = {
  healthScore: 72,
  readinessScore: 68,
  confidenceScore: 80,
  overallRiskLevel: 'MEDIUM',
  domainHealth: { finance: 75, customer_sales_revenue: 70, operations_delivery: 65, marketing_growth: 80 },
  domainReadiness: { finance: 75, customer_sales_revenue: 70, operations_delivery: 65, marketing_growth: 80 },
  topRecommendations: [],
  topOpportunities: [],
  unsafeAutomationBlocks: [],
  staleFactCount: 2,
  criticalMissingFactCount: 1,
};

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

// ---------------------------------------------------------------------------
// V1-47-COCKPIT-TRUTH fixtures: two tenants' rows behind an in-memory Prisma
// stand-in whose count() honours the where clause it is handed, so "counts
// ignore another tenant's rows" is measured on the query, not assumed.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const DELETED = new Date('2026-01-01T00:00:00Z');

const TENANT_ROWS: Record<'contact' | 'invoice' | 'payment', Row[]> = {
  contact: [
    { businessId: 'biz_1', deletedAt: null, archivedAt: null, visibility: 'TEAM', ownerId: 'u_staff', shares: [] },
    { businessId: 'biz_1', deletedAt: null, archivedAt: null, visibility: 'PRIVATE', ownerId: 'u_owner', shares: [] },
    { businessId: 'biz_1', deletedAt: DELETED, archivedAt: null, visibility: 'TEAM', ownerId: 'u_owner', shares: [] },
    { businessId: 'biz_1', deletedAt: null, archivedAt: DELETED, visibility: 'TEAM', ownerId: 'u_owner', shares: [] },
    { businessId: 'biz_2', deletedAt: null, archivedAt: null, visibility: 'TEAM', ownerId: 'u_other', shares: [] },
    { businessId: 'biz_2', deletedAt: null, archivedAt: null, visibility: 'TEAM', ownerId: 'u_other', shares: [] },
    { businessId: 'biz_2', deletedAt: null, archivedAt: null, visibility: 'TEAM', ownerId: 'u_other', shares: [] },
  ],
  invoice: [
    { businessId: 'biz_1', deletedAt: null, status: 'SENT' },
    { businessId: 'biz_1', deletedAt: null, status: 'PARTIALLY_PAID' },
    { businessId: 'biz_1', deletedAt: null, status: 'OVERDUE' },
    { businessId: 'biz_1', deletedAt: null, status: 'PAID' },
    { businessId: 'biz_1', deletedAt: null, status: 'DRAFT' },
    { businessId: 'biz_1', deletedAt: null, status: 'VOID' },
    { businessId: 'biz_1', deletedAt: DELETED, status: 'SENT' },
    { businessId: 'biz_2', deletedAt: null, status: 'SENT' },
    { businessId: 'biz_2', deletedAt: null, status: 'OVERDUE' },
  ],
  payment: [
    { businessId: 'biz_1', status: 'SUCCESSFUL' },
    { businessId: 'biz_1', status: 'SUCCESSFUL' },
    { businessId: 'biz_2', status: 'SUCCESSFUL' },
    { businessId: 'biz_2', status: 'SUCCESSFUL' },
    { businessId: 'biz_2', status: 'FAILED' },
  ],
};

/** The subset of Prisma's where semantics the cockpit counts use. */
function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Row[]).every((w) => matchesWhere(row, w));
    if (key === 'OR') return (cond as Row[]).some((w) => matchesWhere(row, w));
    if (key === 'shares') {
      const userId = ((cond as Row).some as Row).userId;
      return ((row.shares as string[]) ?? []).includes(userId as string);
    }
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Row;
      if ('in' in c) return (c.in as unknown[]).includes(row[key]);
      if ('notIn' in c) return !(c.notIn as unknown[]).includes(row[key]);
      throw new Error(`unsupported where operator on ${key}: ${JSON.stringify(c)}`);
    }
    return row[key] === cond;
  });
}

type MembershipFixture = { role: string; permissionScopes?: Record<string, string> | null };

function makeCountingPrisma(opts: {
  users?: Record<string, { role: string }>;
  memberships?: Record<string, MembershipFixture>;
  fail?: Partial<Record<'contact' | 'invoice' | 'payment', boolean>>;
} = {}) {
  const users = opts.users ?? { u_owner: { role: 'USER' } };
  const memberships = opts.memberships ?? { 'u_owner:biz_1': { role: 'OWNER', permissionScopes: null } };
  const counter = (model: 'contact' | 'invoice' | 'payment') =>
    vi.fn(async (args: { where?: Row } = {}) => {
      if (opts.fail?.[model]) throw new Error(`${model} table unavailable`);
      return TENANT_ROWS[model].filter((row) => matchesWhere(row, args.where)).length;
    });
  return {
    client: {
      contact: { count: counter('contact') },
      invoice: { count: counter('invoice') },
      payment: { count: counter('payment') },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const u = users[where.id];
          return u ? { id: where.id, ...u } : null;
        }),
      },
      membership: {
        findUnique: vi.fn(async ({ where }: { where: { userId_businessId: { userId: string; businessId: string } } }) => {
          const { userId, businessId } = where.userId_businessId;
          const m = memberships[`${userId}:${businessId}`];
          return m ? { userId, businessId, permissionScopes: null, ...m } : null;
        }),
      },
    },
  };
}

describe('BusinessCommandCenterService', () => {
  let service: BusinessCommandCenterService;
  const mockSignalList = vi.fn().mockResolvedValue([]);
  const mockRecommendationList = vi.fn().mockResolvedValue([]);

  beforeEach(async () => {
    mockSignalList.mockReset().mockResolvedValue([]);
    mockRecommendationList.mockReset().mockResolvedValue([]);
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
        { provide: GenomeRecommendationService, useValue: { listRecommendations: mockRecommendationList } },
        { provide: CommandCenterKeyGenomeBridgeService, useValue: { buildCrossDomainBrief: vi.fn().mockResolvedValue(mockCrossDomainBrief) } },
        // V1-47: the Release 0 result counts read through the global PrismaService.
        { provide: PrismaService, useValue: makeCountingPrisma() },
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

  it('includes cross-domain intelligence from the bridge', async () => {
    const snapshot = await service.snapshot('biz_1');
    expect(snapshot.keyGenome.crossDomain).toBeDefined();
    expect(snapshot.keyGenome.crossDomain?.healthScore).toBe(72);
    expect(snapshot.keyGenome.crossDomain?.staleFactCount).toBe(2);
    expect(snapshot.keyGenome.crossDomain?.criticalMissingFactCount).toBe(1);
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

  it('creates a GENOME_RECOMMENDATION priority item for active recommendations', async () => {
    mockRecommendationList.mockResolvedValueOnce([
      {
        id: 'rec_1',
        businessId: 'biz_1',
        domain: 'VISION_IDENTITY',
        title: 'Provide blocking fact: identity.business_name',
        insight: 'key_inbox readiness is 25% because identity.business_name is missing.',
        diagnosis: 'Missing blocking fact: Business name',
        recommendation: 'Capture the identity.business_name fact in the Business Genome to unlock key_inbox operations.',
        expectedGain: 'Improves key_inbox readiness and enables automation.',
        expectedGainScore: 85,
        riskLevel: 'HIGH',
        effortLevel: 'LOW',
        confidence: 0.75,
        evidenceIds: [],
        suggestedExperimentId: null,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        outcomeTrackedAt: null,
      },
    ]);
    const snapshot = await service.snapshot('biz_1');
    const item = snapshot.topPriorities.find((i) => i.type === 'GENOME_RECOMMENDATION');
    expect(item).toBeDefined();
    expect(item!.title).toContain('business_name');
    expect(item!.priority).toBe('HIGH');
  });
});

// ---------------------------------------------------------------------------
// V1-47-COCKPIT-TRUTH (CF-19, COMMAND-001): a failed source is reported as
// FAILED, never as a healthy zero; the Release 0 records (contacts, open
// invoices, payments) are counted per tenant; missing and zero stay distinct.
// ---------------------------------------------------------------------------
describe('V1-47-COCKPIT-TRUTH: per-source status, Release 0 result counts, degraded', () => {
  type Build = {
    prisma?: ReturnType<typeof makeCountingPrisma>;
    pendingThrows?: boolean;
    signalsThrow?: boolean;
    recommendationsThrow?: boolean;
  };

  async function build(o: Build = {}) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BusinessCommandCenterService,
        { provide: BusinessIntelligenceService, useValue: { generateExecutiveBrief: async () => mockBrief } },
        { provide: KeyExecutiveModeService, useValue: { generateModeBrief: async (_biz: string, mode: string) => makeModeBrief(mode) } },
        {
          provide: KeyActionProposalService,
          useValue: {
            list: async (_biz: string, query: { status?: string }) => {
              if (o.pendingThrows && query?.status === 'PENDING') throw new Error('proposal store unavailable');
              return query?.status === 'PENDING' ? [mockKeyProposal] : [];
            },
          },
        },
        { provide: TemporalFlowService, useValue: { analyze: async () => mockTemporal } },
        { provide: GenomeEvolutionService, useValue: { list: async () => [mockProposal] } },
        { provide: BlueprintService, useValue: { calculateGenomeIntegrity: async () => mockGenome } },
        { provide: BusinessAssetsService, useValue: { list: async () => mockAssets } },
        { provide: ConstitutionVersionService, useValue: { latest: async () => mockConstitution, staleness: async () => mockStaleness } },
        { provide: GenomeScoringService, useValue: { computeFactScores: vi.fn().mockResolvedValue([]), computeBusinessScore: vi.fn().mockReturnValue(mockKeyGenomeScore) } },
        { provide: GenomeModuleReadinessService, useValue: { computeReadiness: vi.fn().mockResolvedValue(mockModuleReadiness) } },
        {
          provide: GenomeSignalService,
          useValue: { listSignals: async () => { if (o.signalsThrow) throw new Error('signal store unavailable'); return []; } },
        },
        {
          provide: GenomeRecommendationService,
          useValue: { listRecommendations: async () => { if (o.recommendationsThrow) throw new Error('recommendation store unavailable'); return []; } },
        },
        { provide: CommandCenterKeyGenomeBridgeService, useValue: { buildCrossDomainBrief: vi.fn().mockResolvedValue(mockCrossDomainBrief) } },
        { provide: PrismaService, useValue: o.prisma ?? makeCountingPrisma() },
      ],
    }).compile();
    return moduleRef.get(BusinessCommandCenterService);
  }

  /** The guarded HTTP route runs the handler inside the TenantInterceptor's scope. */
  const as = <T>(businessId: string, userId: string, fn: () => Promise<T>) => runWithTenant(businessId, userId, fn);

  const SOURCE_LABELS = [
    'executiveBrief', 'modeBriefs', 'pendingApprovals', 'approvedAwaitingExecution', 'temporalAnalysis',
    'genomeProposals', 'genome', 'rawAssets', 'latestConstitution', 'constitutionStaleness', 'keyGenomeFacts',
    'keyGenomeScore', 'moduleReadiness', 'crossDomainBrief', 'genomeSignals', 'genomeRecommendations',
    'callerAccess', 'contacts', 'openInvoices', 'payments',
  ];

  it('RED-BEFORE (CF-19): a throwing source is reported FAILED with its fetchedAt, the snapshot is still returned and degraded is true', async () => {
    const service = await build({ pendingThrows: true });
    const snapshot = await as('biz_1', 'u_owner', () => service.snapshot('biz_1'));
    expect(snapshot.businessId).toBe('biz_1');
    expect(snapshot.sources?.pendingApprovals).toMatchObject({ label: 'pendingApprovals', status: 'FAILED' });
    expect(Number.isNaN(Date.parse(snapshot.sources.pendingApprovals.fetchedAt))).toBe(false);
    // Its sibling reads the same store and answered: only the failed source is FAILED.
    expect(snapshot.sources.approvedAwaitingExecution).toMatchObject({ label: 'approvedAwaitingExecution', status: 'OK' });
    expect(snapshot.degraded).toBe(true);
  });

  it('RED-BEFORE (COMMAND-001): a failed count is missing (null, FAILED), not a zero; the other counts are still read and degraded is true', async () => {
    const service = await build({ prisma: makeCountingPrisma({ fail: { contact: true } }) });
    const snapshot = await as('biz_1', 'u_owner', () => service.snapshot('biz_1'));
    expect(snapshot.results?.contacts).toMatchObject({ count: null, status: 'FAILED', href: '/app/crm/contacts' });
    expect(snapshot.sources.contacts).toMatchObject({ label: 'contacts', status: 'FAILED' });
    expect(snapshot.results.openInvoices).toMatchObject({ count: 3, status: 'OK' });
    expect(snapshot.results.payments).toMatchObject({ count: 2, status: 'OK' });
    expect(snapshot.degraded).toBe(true);
  });

  it('genome signals and recommendations that throw no longer reject the whole snapshot: each is a FAILED source', async () => {
    const service = await build({ signalsThrow: true, recommendationsThrow: true });
    const snapshot = await as('biz_1', 'u_owner', () => service.snapshot('biz_1'));
    expect(snapshot.sources?.genomeSignals).toMatchObject({ label: 'genomeSignals', status: 'FAILED' });
    expect(snapshot.sources.genomeRecommendations).toMatchObject({ label: 'genomeRecommendations', status: 'FAILED' });
    expect(snapshot.topPriorities.some((i) => i.type === 'GENOME_SIGNAL' || i.type === 'GENOME_RECOMMENDATION')).toBe(false);
    expect(snapshot.degraded).toBe(true);
  });

  it('GREEN: every source healthy gives degraded false, and every source is OK with its own label and a fetchedAt', async () => {
    const service = await build();
    const snapshot = await as('biz_1', 'u_owner', () => service.snapshot('biz_1'));
    expect(snapshot.degraded).toBe(false);
    expect(Object.keys(snapshot.sources ?? {}).sort()).toEqual([...SOURCE_LABELS].sort());
    for (const [key, source] of Object.entries(snapshot.sources)) {
      expect(source).toMatchObject({ label: key, status: 'OK' });
      expect(Number.isNaN(Date.parse(source.fetchedAt)), `${key}.fetchedAt`).toBe(false);
    }
  });

  it("Release 0 counts ignore another tenant's rows, soft-deleted and archived contacts, deleted invoices and invoices that are not open", async () => {
    const prisma = makeCountingPrisma({
      users: { u_owner: { role: 'USER' }, u_other: { role: 'USER' } },
      memberships: { 'u_owner:biz_1': { role: 'OWNER' }, 'u_other:biz_2': { role: 'OWNER' } },
    });
    const service = await build({ prisma });
    const a = await as('biz_1', 'u_owner', () => service.snapshot('biz_1'));
    expect(a.results).toEqual({
      contacts: { label: 'Contacts', count: 2, status: 'OK', href: '/app/crm/contacts' },
      openInvoices: { label: 'Open invoices', count: 3, status: 'OK', href: '/app/commerce/invoices' },
      payments: { label: 'Payments', count: 2, status: 'OK', href: '/app/payments' },
    });
    for (const model of ['contact', 'invoice', 'payment'] as const) {
      const where = (prisma.client[model].count.mock.calls[0]?.[0] as { where: Row } | undefined)?.where;
      expect(where?.businessId, `${model}.count is scoped to the tenant`).toBe('biz_1');
    }
    const b = await as('biz_2', 'u_other', () => service.snapshot('biz_2'));
    expect([b.results.contacts.count, b.results.openInvoices.count, b.results.payments.count]).toEqual([3, 2, 3]);
  });

  it('zero is a real zero, distinct from missing: a tenant with no records reads 0 / OK and is not degraded', async () => {
    const prisma = makeCountingPrisma({ memberships: { 'u_owner:biz_empty': { role: 'OWNER' } } });
    const service = await build({ prisma });
    const snapshot = await as('biz_empty', 'u_owner', () => service.snapshot('biz_empty'));
    expect([snapshot.results?.contacts, snapshot.results?.openInvoices, snapshot.results?.payments].map((r) => [r?.count, r?.status])).toEqual([
      [0, 'OK'], [0, 'OK'], [0, 'OK'],
    ]);
    expect(snapshot.degraded).toBe(false);
  });

  it("a member is counted only what the list routes show them: no revenue scope gives RESTRICTED (null, never read); another member's PRIVATE contact is not counted", async () => {
    const prisma = makeCountingPrisma({
      users: { u_staff: { role: 'USER' } },
      memberships: { 'u_staff:biz_1': { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } },
    });
    const service = await build({ prisma });
    const snapshot = await as('biz_1', 'u_staff', () => service.snapshot('biz_1'));
    expect(snapshot.results?.contacts).toMatchObject({ count: 1, status: 'OK' });
    expect(snapshot.results.openInvoices).toMatchObject({ count: null, status: 'RESTRICTED' });
    expect(snapshot.results.payments).toMatchObject({ count: null, status: 'RESTRICTED' });
    expect(prisma.client.invoice.count).not.toHaveBeenCalled();
    expect(prisma.client.payment.count).not.toHaveBeenCalled();
    // A scope the caller lacks is not a failure of the cockpit.
    expect(snapshot.degraded).toBe(false);
  });

  it('with no caller for this tenant in the request context (an internal caller, or another tenant) nothing is counted: RESTRICTED, never a guess', async () => {
    const prisma = makeCountingPrisma();
    const service = await build({ prisma });
    const internal = await service.snapshot('biz_1');
    const foreign = await as('biz_2', 'u_owner', () => service.snapshot('biz_1'));
    for (const snapshot of [internal, foreign]) {
      for (const key of ['contacts', 'openInvoices', 'payments'] as const) {
        expect(snapshot.results?.[key]).toMatchObject({ count: null, status: 'RESTRICTED' });
      }
    }
    expect(prisma.client.contact.count).not.toHaveBeenCalled();
    expect(prisma.client.invoice.count).not.toHaveBeenCalled();
    expect(prisma.client.payment.count).not.toHaveBeenCalled();
  });
});
