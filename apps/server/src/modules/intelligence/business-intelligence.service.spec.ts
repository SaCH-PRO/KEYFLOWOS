import { describe, expect, it, vi } from 'vitest';
import { BusinessIntelligenceService } from './business-intelligence.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import type { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import type { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import type { BusinessAssetsService } from '../business-assets/business-assets.service';
import type { BlueprintData } from '../blueprint/blueprint.types';
import type { TemporalFlowAnalysis } from '../temporal-flow/temporal-flow.types';

function makeService(options: {
  blueprint?: Partial<BlueprintData>;
  proposals?: any[];
  temporal?: Partial<TemporalFlowAnalysis>;
  assets?: any[];
} = {}) {
  const blueprint = {
    getBlueprint: vi.fn().mockResolvedValue({
      genomeIntegrity: 70,
      executiveReadinessScore: 65,
      genomeStage: 'OPERATING_BUSINESS',
      genomeDnaScores: { founder: 80, business: 45, market: 90 } as Record<string, number>,
      ...(options.blueprint ?? {}),
    } as BlueprintData),
  } as unknown as BlueprintService;

  const temporal = {
    analyze: vi.fn().mockResolvedValue({
      summary: 'All quiet',
      urgentItems: [],
      opportunities: [],
      risks: [],
      genomeProposalCandidates: [],
      ...(options.temporal ?? {}),
    } as TemporalFlowAnalysis),
  } as unknown as TemporalFlowService;

  const genomeEvolution = {
    list: vi.fn().mockResolvedValue(options.proposals ?? []),
  } as unknown as GenomeEvolutionService;

  const businessAssets = {
    list: vi.fn().mockResolvedValue(options.assets ?? []),
  } as unknown as BusinessAssetsService;

  const service = new BusinessIntelligenceService(blueprint, temporal, genomeEvolution, businessAssets);
  return { service, blueprint, temporal, genomeEvolution, businessAssets };
}

describe('BusinessIntelligenceService', () => {
  it('returns a structured executive brief', async () => {
    const { service } = makeService();
    const brief = await service.generateExecutiveBrief('biz_1');

    expect(brief.businessId).toBe('biz_1');
    expect(typeof brief.summary).toBe('string');
    expect(brief.genomeIntegrity).toBe(70);
    expect(brief.executiveReadinessScore).toBe(65);
    expect(brief.genomeStage).toBe('OPERATING_BUSINESS');
    expect(brief.insights.length).toBeGreaterThan(0);
    expect(brief.topPriorities.length).toBeGreaterThan(0);
    expect(brief.topPriorities.length).toBeLessThanOrEqual(brief.insights.length);
  });

  it('flags low executive readiness as a HIGH executive insight', async () => {
    const { service } = makeService({
      blueprint: { executiveReadinessScore: 40 },
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.id === 'executive-readiness');

    expect(insight).toBeDefined();
    expect(insight?.domain).toBe('EXECUTIVE');
    expect(insight?.priority).toBe('HIGH');
    expect(insight?.evidence).toContain('Executive Readiness Score: 40%');
  });

  it('flags low genome integrity as a CRITICAL genome insight', async () => {
    const { service } = makeService({
      blueprint: { genomeIntegrity: 25 },
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.id === 'genome-integrity');

    expect(insight).toBeDefined();
    expect(insight?.domain).toBe('GENOME');
    expect(insight?.priority).toBe('CRITICAL');
  });

  it('creates a GENOME insight for pending evolution proposals', async () => {
    const { service } = makeService({
      proposals: [
        { id: 'p1', section: 'marketing', reason: 'WhatsApp leads', evidence: ['3 leads'], status: 'PENDING' },
      ],
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.id === 'pending-evolution-proposals');

    expect(insight).toBeDefined();
    expect(insight?.domain).toBe('GENOME');
    expect(insight?.evidence).toContain('marketing: WhatsApp leads');
    expect(insight?.recommendedAction?.actionType).toBe('REVIEW_EVOLUTION_PROPOSALS');
  });

  it('creates an ASSETS insight for assets expiring soon', async () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 5);
    const { service } = makeService({
      assets: [{ id: 'a1', name: 'Domain Renewal', expiresAt }],
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.id === 'asset-expiry-risk');

    expect(insight).toBeDefined();
    expect(insight?.domain).toBe('ASSETS');
    expect(insight?.priority).toBe('HIGH');
    expect(insight?.evidence[0]).toContain('Domain Renewal');
  });

  it('includes temporal flow risks', async () => {
    const { service } = makeService({
      temporal: {
        risks: [{ title: 'Cash flow risk from overdue invoices', severity: 'HIGH', evidence: ['Invoice #1 overdue'] }],
      },
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.domain === 'RISK');

    expect(insight).toBeDefined();
    expect(insight?.title).toBe('Cash flow risk from overdue invoices');
    expect(insight?.priority).toBe('HIGH');
  });

  it('includes temporal flow opportunities', async () => {
    const { service } = makeService({
      temporal: {
        opportunities: [{ title: 'WhatsApp leads rising', evidence: ['3 new leads'] }],
      },
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.id.startsWith('temporal-opportunity-'));

    expect(insight).toBeDefined();
    expect(insight?.title).toBe('WhatsApp leads rising');
    expect(insight?.domain).toBe('OPERATIONS');
  });

  it('sorts top priorities by severity', async () => {
    const { service } = makeService({
      blueprint: { genomeIntegrity: 25, executiveReadinessScore: 40 },
      temporal: {
        risks: [{ title: 'Risk A', severity: 'MEDIUM', evidence: [] }],
      },
    });
    const brief = await service.generateExecutiveBrief('biz_1');

    expect(brief.topPriorities[0].priority).toBe('CRITICAL');
    expect(brief.topPriorities[0].id).toBe('genome-integrity');
    expect(brief.topPriorities[1].priority).toBe('HIGH');
  });

  it('creates genome gap insights for low DNA section scores', async () => {
    const { service } = makeService({
      blueprint: { genomeDnaScores: { founder: 80, business: 30, market: 90 } as Record<string, number> },
    });
    const brief = await service.generateExecutiveBrief('biz_1');
    const insight = brief.insights.find((i) => i.id === 'genome-gap-business');

    expect(insight).toBeDefined();
    expect(insight?.domain).toBe('GENOME');
    expect(insight?.title).toContain('Business');
  });
});
