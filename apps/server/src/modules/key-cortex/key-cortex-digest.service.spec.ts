import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexDigestService } from './key-cortex-digest.service';

function createMockBiEngine(overrides: any = {}) {
  return {
    getMentalModel: vi.fn().mockResolvedValue(overrides.mentalModel ?? null),
  };
}

function createMockInsightService(overrides: any = {}) {
  return {
    generateBusinessReport: vi.fn().mockResolvedValue(overrides.report ?? null),
  };
}

function createMockMemoryRetrieval(memories: any[] = []) {
  return {
    retrieveContext: vi.fn().mockResolvedValue(memories),
  };
}

function createMockCommunications() {
  return {
    sendBroadcast: vi.fn().mockResolvedValue({ success: true, contentId: 'content_1', queued: 1 }),
  };
}

function createMentalModel(overrides: any = {}) {
  return {
    businessId: 'biz_1',
    generatedAt: new Date(),
    healthScore: 72,
    healthStatus: 'good',
    topRisks: [{ type: 'cashflow', title: 'Overdue invoices', severity: 'high', score: 70, reason: '2 overdue' }],
    topOpportunities: [{ type: 'revenue', title: 'Collect overdue', estimatedValue: 500, confidence: 0.9, reason: 'Quick cash' }],
    keyTrends: ['Revenue flat'],
    attentionItems: [{ type: 'overdue_invoice', title: 'Overdue invoices', count: 2, priority: 'high' }],
    metrics: {
      pendingInvoices: 3,
      overdueInvoices: 2,
      overdueInvoiceTotal: 500,
      overdueTasks: 1,
      activeLeads: 4,
      activeDeals: 2,
      activeDealValue: 1000,
      monthlyRevenue: 5000,
      previousMonthRevenue: 4500,
      revenueTrend: 'up',
      genomeIntegrity: 60,
    },
    ...overrides,
  };
}

function createReport(overrides: any = {}) {
  return {
    scope: 'daily',
    generatedAt: new Date(),
    period: 'Today',
    narrative: 'Business is stable.',
    revenue: {
      period: 'Today',
      totalRevenue: 500,
      previousPeriodRevenue: 400,
      growthRate: 25,
      growthDirection: 'up',
      averageInvoiceValue: 250,
      invoiceCount: 2,
      topCustomers: [],
      revenueByDay: [],
      trends: ['Strong growth'],
    },
    pipeline: { stages: [], totalLeads: 4, totalPipelineValue: 1000, avgDealSize: 500, avgDaysToClose: 10, bottlenecks: [], recommendations: [], funnel: [] },
    cashFlow: { period: 'This Month', moneyIn: 5000, moneyOut: 2000, netFlow: 3000, runway: 6, collectionRate: 80, daysSalesOutstanding: 15, upcomingPaymentsDue: [], collectionIssues: [], forecast: { projectedInflow: 5000, projectedOutflow: 2000, projectedNet: 3000, riskLevel: 'low' } },
    churnRisks: [],
    opportunities: [{ id: 'o1', type: 'overdue_invoice', title: 'Collect $500', description: '2 overdue invoices', estimatedValue: 500, confidence: 0.9, recommendedAction: 'Send reminders', sourceData: {}, priority: 'high', timeframe: 'immediate' }],
    keyMetrics: {},
    topPriorities: ['Collect overdue invoices'],
    score: 75,
    ...overrides,
  };
}

describe('KeyCortexDigestService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateDailyDigest composes mental model, report, and memory context', async () => {
    const biEngine = createMockBiEngine({ mentalModel: createMentalModel() });
    const insightService = createMockInsightService({ report: createReport() });
    const memoryRetrieval = createMockMemoryRetrieval([{ id: 'mf_1', content: 'Past lesson' }]);
    const communications = createMockCommunications();

    const service = new KeyCortexDigestService(
      biEngine as any,
      insightService as any,
      memoryRetrieval as any,
      communications as any,
    );

    const digest = await service.generateDailyDigest('biz_1');

    expect(digest.businessId).toBe('biz_1');
    expect(digest.period).toBe('daily');
    expect(digest.highlights.length).toBeGreaterThan(0);
    expect(digest.alerts.length).toBeGreaterThan(0);
    expect(digest.opportunities.length).toBeGreaterThan(0);
    expect(digest.actions.length).toBeGreaterThan(0);
    expect(digest.summary).toContain('Today');
    expect(biEngine.getMentalModel).toHaveBeenCalledWith('biz_1');
    expect(insightService.generateBusinessReport).toHaveBeenCalledWith('biz_1', 'daily');
    expect(memoryRetrieval.retrieveContext).toHaveBeenCalledWith('biz_1', expect.any(Object));
  });

  it('generateWeeklyDigest requests weekly report', async () => {
    const biEngine = createMockBiEngine({ mentalModel: createMentalModel() });
    const insightService = createMockInsightService({ report: createReport({ scope: 'weekly' }) });
    const memoryRetrieval = createMockMemoryRetrieval();
    const communications = createMockCommunications();

    const service = new KeyCortexDigestService(
      biEngine as any,
      insightService as any,
      memoryRetrieval as any,
      communications as any,
    );

    const digest = await service.generateWeeklyDigest('biz_1');

    expect(digest.period).toBe('weekly');
    expect(digest.summary).toContain('week');
    expect(insightService.generateBusinessReport).toHaveBeenCalledWith('biz_1', 'weekly');
  });

  it('generateDailyDigest handles missing mental model gracefully', async () => {
    const biEngine = createMockBiEngine({ mentalModel: null });
    const insightService = createMockInsightService({ report: createReport() });
    const memoryRetrieval = createMockMemoryRetrieval();
    const communications = createMockCommunications();

    const service = new KeyCortexDigestService(
      biEngine as any,
      insightService as any,
      memoryRetrieval as any,
      communications as any,
    );

    const digest = await service.generateDailyDigest('biz_1');

    expect(digest.highlights.length).toBeGreaterThan(0);
    expect(digest.alerts).toEqual([]);
  });

  it('deliverDailyDigest sends via communications facade', async () => {
    const biEngine = createMockBiEngine({ mentalModel: createMentalModel() });
    const insightService = createMockInsightService({ report: createReport() });
    const memoryRetrieval = createMockMemoryRetrieval();
    const communications = createMockCommunications();

    const service = new KeyCortexDigestService(
      biEngine as any,
      insightService as any,
      memoryRetrieval as any,
      communications as any,
    );

    const { digest, result } = await service.deliverDailyDigest('biz_1', 'email');

    expect(digest.period).toBe('daily');
    expect(result.success).toBe(true);
    expect(result.contentId).toBe('content_1');
    expect(communications.sendBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        segment: 'business_owners',
        channel: 'email',
        body: expect.stringContaining(digest.summary),
      }),
    );
  });

  it('delivery returns success false when communications fails', async () => {
    const biEngine = createMockBiEngine({ mentalModel: createMentalModel() });
    const insightService = createMockInsightService({ report: createReport() });
    const memoryRetrieval = createMockMemoryRetrieval();
    const communications = createMockCommunications();
    communications.sendBroadcast.mockRejectedValue(new Error('No destination'));

    const service = new KeyCortexDigestService(
      biEngine as any,
      insightService as any,
      memoryRetrieval as any,
      communications as any,
    );

    const { result } = await service.deliverDailyDigest('biz_1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No destination');
  });
});
