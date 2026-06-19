import { describe, it, expect, beforeEach } from 'vitest';
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

  beforeEach(async () => {
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
});
