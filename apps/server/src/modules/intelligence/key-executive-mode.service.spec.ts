import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyExecutiveModeService } from './key-executive-mode.service';
import { BusinessIntelligenceService } from './business-intelligence.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { BusinessAssetsService } from '../business-assets/business-assets.service';
import type { BusinessExecutiveBrief } from './business-intelligence.types';
import type { BlueprintData } from '../blueprint/blueprint.types';
import type { TemporalFlowAnalysis } from '../temporal-flow/temporal-flow.types';
import type { GenomeEvolutionProposalData } from '../business-genome/genome-evolution.types';

const allDnaScores = {
  founder: 80,
  vision: 75,
  business: 70,
  market: 65,
  financial: 35,
  legal: 40,
  operations: 70,
  sales: 55,
  marketing: 30,
  growth: 45,
  technology: 60,
  risk: 50,
};

const allDnaConfidence = {
  founder: 0.8,
  vision: 0.75,
  business: 0.7,
  market: 0.65,
  financial: 0.35,
  legal: 0.4,
  operations: 0.7,
  sales: 0.55,
  marketing: 0.3,
  growth: 0.45,
  technology: 0.6,
  risk: 0.5,
};

const mockBrief: BusinessExecutiveBrief = {
  businessId: 'biz_1',
  generatedAt: new Date().toISOString(),
  summary: 'Executive Readiness 55%, Genome Integrity 60%.',
  genomeIntegrity: 60,
  executiveReadinessScore: 55,
  genomeStage: 'OPERATING_BUSINESS',
  insights: [
    {
      id: 'executive-readiness',
      domain: 'EXECUTIVE',
      priority: 'MEDIUM',
      title: 'Executive Readiness is 55%',
      finding: 'The business has moderate executive readiness.',
      evidence: ['Executive Readiness Score: 55%'],
      confidence: 0.95,
      recommendedAction: {
        label: 'Open Business Genome',
        actionType: 'OPEN_GENOME',
        href: '/app/profile?tab=business-genome',
      },
    },
    {
      id: 'genome-integrity',
      domain: 'GENOME',
      priority: 'MEDIUM',
      title: 'Genome Integrity is 60%',
      finding: 'The Business Genome is partially complete.',
      evidence: ['Genome Integrity: 60%'],
      confidence: 0.95,
      recommendedAction: {
        label: 'Open Business Genome',
        actionType: 'OPEN_GENOME',
        href: '/app/profile?tab=business-genome&section=dna-sections',
      },
    },
    {
      id: 'pending-evolution-proposals',
      domain: 'GENOME',
      priority: 'MEDIUM',
      title: '2 pending Genome Evolution proposals',
      finding: 'Temporal Flow generated proposals that can improve the Business Genome.',
      evidence: ['marketing: improve targeting', 'financial: add pricing'],
      confidence: 0.7,
      recommendedAction: {
        label: 'Review proposals',
        actionType: 'REVIEW_EVOLUTION_PROPOSALS',
        href: '/app/profile?tab=business-genome&section=evolution-proposals',
      },
    },
    {
      id: 'generate-document-export',
      domain: 'EXECUTIVE',
      priority: 'MEDIUM',
      title: 'Generate document export',
      finding: 'A document export is recommended.',
      evidence: ['Document pack request'],
      confidence: 0.7,
      recommendedAction: {
        label: 'Generate export',
        actionType: 'GENERATE_DOCUMENT' as any,
      },
    },
  ],
  topPriorities: [],
};

const mockBlueprint = {
  schemaVersion: 1,
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
  confidenceScores: {},
  completeness: 0.5,
  updatedAt: new Date().toISOString(),
  genomeIntegrity: 60,
  executiveReadinessScore: 55,
  genomeStage: 'OPERATING_BUSINESS',
  genomeDnaScores: allDnaScores,
  genomeDnaConfidence: allDnaConfidence,
} as unknown as BlueprintData;

const mockTemporal: TemporalFlowAnalysis = {
  summary: 'Activity detected.',
  urgentItems: [
    { title: 'Overdue invoice #101', reason: 'Invoice #101 is 7 days overdue.', eventId: 'ev_1' },
    { title: 'WhatsApp lead from Acme Corp', reason: 'New WhatsApp lead.', eventId: 'ev_2' },
  ],
  opportunities: [
    { title: 'Instagram DM campaign opportunity', evidence: ['3 DMs this week'] },
    { title: 'Booking volume rising', evidence: ['10 bookings this week'] },
  ],
  risks: [
    { title: 'Cash flow risk from overdue invoices', severity: 'HIGH', evidence: ['Invoice #101 overdue'] },
    { title: 'Asset expiry risk', severity: 'MEDIUM', evidence: ['Domain expires in 14 days'] },
  ],
  genomeProposalCandidates: [
    { section: 'marketing', reason: 'Add WhatsApp channel details.', evidence: ['ev_2'], eventIds: ['ev_2'] },
  ],
};

const mockProposals: GenomeEvolutionProposalData[] = [
  {
    id: 'prop_1',
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
    sourceEventIds: ['ev_2'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prop_2',
    businessId: 'biz_1',
    section: 'financial',
    proposedPatch: {},
    reason: 'Add pricing',
    evidence: [],
    confidence: 0.7,
    status: 'PENDING',
    createdBy: null,
    approvedBy: null,
    approvedAt: null,
    rejectedAt: null,
    sourceEventIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockAssets = [
  { id: 'a1', businessId: 'biz_1', type: 'DOMAIN', name: 'Domain', status: 'ACTIVE', expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), metadata: {}, createdAt: new Date(), updatedAt: new Date() },
  { id: 'a2', businessId: 'biz_1', type: 'LICENSE', name: 'License', status: 'ACTIVE', expiresAt: null, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
];

describe('KeyExecutiveModeService', () => {
  let service: KeyExecutiveModeService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        KeyExecutiveModeService,
        {
          provide: BusinessIntelligenceService,
          useValue: { generateExecutiveBrief: async () => mockBrief },
        },
        {
          provide: BlueprintService,
          useValue: { getBlueprint: async () => mockBlueprint },
        },
        {
          provide: TemporalFlowService,
          useValue: { analyze: async () => mockTemporal },
        },
        {
          provide: GenomeEvolutionService,
          useValue: { list: async () => mockProposals },
        },
        {
          provide: BusinessAssetsService,
          useValue: { list: async () => mockAssets },
        },
      ],
    }).compile();

    service = moduleRef.get(KeyExecutiveModeService);
  });

  it('lists all 8 modes', () => {
    const modes = service.listModes();
    expect(modes).toHaveLength(8);
    expect(modes.map((m) => m.mode).sort()).toEqual([
      'CFO',
      'CMO',
      'COO',
      'EXECUTIVE_ASSISTANT',
      'GROWTH_ADVISOR',
      'LEGAL_GUIDE',
      'RISK_OFFICER',
      'STRATEGIST',
    ]);
  });

  it('rejects invalid mode', async () => {
    await expect(service.generateModeBrief('biz_1', 'INVALID')).rejects.toThrow('Invalid executive mode');
  });

  it('CFO mode flags weak Financial DNA and overdue invoices', async () => {
    const brief = await service.generateModeBrief('biz_1', 'CFO');
    expect(brief.mode).toBe('CFO');
    expect(brief.findings.some((f) => f.title.includes('Financial DNA'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('Overdue invoice'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('Cash flow risk'))).toBe(true);
    expect(brief.risks.length).toBeGreaterThan(0);
  });

  it('CMO mode includes WhatsApp lead and Instagram opportunity', async () => {
    const brief = await service.generateModeBrief('biz_1', 'CMO');
    expect(brief.mode).toBe('CMO');
    expect(brief.findings.some((f) => f.title.includes('WhatsApp lead'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('Instagram DM'))).toBe(true);
  });

  it('COO mode includes asset expiry and booking volume', async () => {
    const brief = await service.generateModeBrief('biz_1', 'COO');
    expect(brief.mode).toBe('COO');
    expect(brief.findings.some((f) => f.title.includes('asset(s) expiring'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('Booking volume'))).toBe(true);
  });

  it('Legal Guide mode includes legal DNA weakness', async () => {
    const brief = await service.generateModeBrief('biz_1', 'LEGAL_GUIDE');
    expect(brief.mode).toBe('LEGAL_GUIDE');
    expect(brief.findings.some((f) => f.title.includes('Legal DNA'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('asset(s) expiring'))).toBe(true);
  });

  it('Risk Officer prioritizes HIGH and CRITICAL risks', async () => {
    const brief = await service.generateModeBrief('biz_1', 'RISK_OFFICER');
    expect(brief.mode).toBe('RISK_OFFICER');
    expect(brief.findings[0].priority).toMatch(/HIGH|CRITICAL/);
    expect(brief.risks.length).toBeGreaterThan(0);
  });

  it('Growth Advisor mode distinguishes readiness', async () => {
    const brief = await service.generateModeBrief('biz_1', 'GROWTH_ADVISOR');
    expect(brief.mode).toBe('GROWTH_ADVISOR');
    expect(brief.findings.some((f) => f.id.includes('opportunity'))).toBe(true);
  });

  it('Executive Assistant mode surfaces urgent items', async () => {
    const brief = await service.generateModeBrief('biz_1', 'EXECUTIVE_ASSISTANT');
    expect(brief.mode).toBe('EXECUTIVE_ASSISTANT');
    expect(brief.findings.some((f) => f.title.includes('Overdue invoice'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('Genome update candidate'))).toBe(true);
  });

  it('Strategist mode surfaces weak DNA and pending proposals', async () => {
    const brief = await service.generateModeBrief('biz_1', 'STRATEGIST');
    expect(brief.mode).toBe('STRATEGIST');
    expect(brief.findings.some((f) => f.title.includes('DNA'))).toBe(true);
    expect(brief.findings.some((f) => f.title.includes('pending Genome Evolution'))).toBe(true);
  });

  it('sorts findings by priority then confidence', async () => {
    const brief = await service.generateModeBrief('biz_1', 'RISK_OFFICER');
    const priorities = brief.findings.map((f) => f.priority);
    const ranks = priorities.map((p) => ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[p]));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeLessThanOrEqual(ranks[i - 1]);
    }
  });

  it('returns recommended actions', async () => {
    const brief = await service.generateModeBrief('biz_1', 'CFO');
    expect(brief.recommendedActions.length).toBeGreaterThan(0);
    expect(brief.recommendedActions[0].actionType).toBeDefined();
  });

  it('maps GENERATE_DOCUMENT to GENERATE_DOCUMENT_EXPORT and marks it as requiring approval', async () => {
    const brief = await service.generateModeBrief('biz_1', 'STRATEGIST');
    const action = brief.recommendedActions.find((a) => a.actionType === 'GENERATE_DOCUMENT_EXPORT');
    expect(action).toBeDefined();
    expect(action?.requiresApproval).toBe(true);
  });

  it('does not mark navigation actions as requiring approval', async () => {
    const brief = await service.generateModeBrief('biz_1', 'STRATEGIST');
    const openGenome = brief.recommendedActions.find((a) => a.actionType === 'OPEN_GENOME');
    expect(openGenome).toBeDefined();
    expect(openGenome?.requiresApproval).toBeFalsy();
  });
});
