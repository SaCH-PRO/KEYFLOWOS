import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceAdapterService } from './intelligence-adapter.service';
import { BusinessIntelligenceService } from '../../intelligence/business-intelligence.service';
import { GrowthIntelligenceService } from '../../growth-intelligence/growth-intelligence.service';
import { BusinessCommandCenterService } from '../../business-command-center/business-command-center.service';
import { AnalyticsEngineService } from '../../analytics/analytics-engine.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'intelligence',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('IntelligenceAdapterService', () => {
  let service: IntelligenceAdapterService;
  let businessIntelligence: BusinessIntelligenceService;
  let growth: GrowthIntelligenceService;
  let commandCenter: BusinessCommandCenterService;
  let analytics: AnalyticsEngineService;

  beforeEach(() => {
    businessIntelligence = { generateExecutiveBrief: vi.fn() } as unknown as BusinessIntelligenceService;
    growth = {
      generateInsights: vi.fn(),
      listInsights: vi.fn(),
      getDashboard: vi.fn(),
    } as unknown as GrowthIntelligenceService;
    commandCenter = { snapshot: vi.fn() } as unknown as BusinessCommandCenterService;
    analytics = { getTrends: vi.fn() } as unknown as AnalyticsEngineService;

    service = new IntelligenceAdapterService(businessIntelligence, growth, commandCenter, analytics);
  });

  it('analyze_sentiment returns positive for good words', async () => {
    const result = await service.execute(mkCmd('analyze_sentiment', { text: 'This is great and amazing' }));
    expect(result.success).toBe(true);
    expect((result.data as { sentiment: string }).sentiment).toBe('positive');
  });

  it('detect_opportunities generates and filters insights', async () => {
    (growth.generateInsights as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (growth.listInsights as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'i1', type: 'upsell', confidence: 0.9, title: 'Upsell' },
      { id: 'i2', type: 'churn', confidence: 0.5, title: 'Churn' },
    ]);
    const result = await service.execute(mkCmd('detect_opportunities', { minConfidence: 0.7, limit: 5 }));
    expect(result.success).toBe(true);
    expect((result.data as { opportunities: unknown[] }).opportunities).toHaveLength(1);
    expect((result.data as { opportunities: unknown[] }).opportunities[0]).toEqual(expect.objectContaining({ id: 'i1' }));
  });

  it('generate_forecast produces future values', async () => {
    (analytics.getTrends as ReturnType<typeof vi.fn>).mockResolvedValue([
      { date: '2026-06-01', value: 10 },
      { date: '2026-06-02', value: 20 },
      { date: '2026-06-03', value: 30 },
    ]);
    const result = await service.execute(mkCmd('generate_forecast', { metric: 'totalRevenue', horizon: '3d' }));
    expect(result.success).toBe(true);
    expect((result.data as { forecast: number[] }).forecast).toHaveLength(3);
  });

  it('run_comprehensive_analysis aggregates brief, dashboard and snapshot', async () => {
    (businessIntelligence.generateExecutiveBrief as ReturnType<typeof vi.fn>).mockResolvedValue({ summary: 'brief' });
    (growth.getDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({ kpis: {} });
    (commandCenter.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ health: {} });
    const result = await service.execute(mkCmd('run_comprehensive_analysis'));
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      executiveBrief: { summary: 'brief' },
      growthDashboard: { kpis: {} },
      commandCenterSnapshot: { health: {} },
    }));
  });

  it('getSnapshot delegates to BusinessCommandCenterService.snapshot', async () => {
    (commandCenter.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ health: {} });
    const result = await service.getSnapshot('biz_123');
    expect(result).toEqual({ health: {} });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown intelligence action');
  });
});
