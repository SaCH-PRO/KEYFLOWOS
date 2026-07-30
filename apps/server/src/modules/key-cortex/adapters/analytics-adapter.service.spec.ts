import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsAdapterService } from './analytics-adapter.service';
import { AnalyticsEngineService } from '../../analytics/analytics-engine.service';
import { LedgerReportingService } from '../../reports/ledger-reporting.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'analytics',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('AnalyticsAdapterService', () => {
  let service: AnalyticsAdapterService;
  let engine: AnalyticsEngineService;
  let ledger: LedgerReportingService;
  let prisma: PrismaService;

  beforeEach(() => {
    engine = {
      getOverview: vi.fn(),
      getAvailableMetrics: vi.fn(),
      getTrends: vi.fn(),
    } as unknown as AnalyticsEngineService;

    ledger = {
      getPnl: vi.fn(),
      getCashflow: vi.fn(),
      getBalanceSheet: vi.fn(),
      getTaxSummary: vi.fn(),
      getRevenueBy: vi.fn(),
      getExpenseBy: vi.fn(),
    } as unknown as LedgerReportingService;

    prisma = {
      client: {
        businessEvent: { create: vi.fn() },
      },
    } as unknown as PrismaService;

    service = new AnalyticsAdapterService(engine, ledger, prisma);
  });

  it('create_dashboard composes overview, metrics and trends', async () => {
    (engine.getOverview as ReturnType<typeof vi.fn>).mockResolvedValue({ totalRevenue: 1000 });
    (engine.getAvailableMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'totalRevenue' }]);
    (engine.getTrends as ReturnType<typeof vi.fn>).mockResolvedValue([{ date: '2026-06-01', value: 100 }]);
    const result = await service.execute(mkCmd('create_dashboard'));
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ name: 'KEY Cortex Dashboard' }));
    expect(engine.getOverview).toHaveBeenCalledWith('biz_123', 30);
  });

  it('create_report returns pnl report by type', async () => {
    (ledger.getPnl as ReturnType<typeof vi.fn>).mockResolvedValue({ netProfit: 100 });
    const result = await service.execute(mkCmd('create_report', {
      name: 'June P&L',
      type: 'pnl',
      from: '2026-06-01',
      to: '2026-06-30',
    }));
    expect(result.success).toBe(true);
    expect(ledger.getPnl).toHaveBeenCalledWith('biz_123', new Date('2026-06-01'), new Date('2026-06-30'), 'accrual');
    expect(result.data).toEqual(expect.objectContaining({ name: 'June P&L', type: 'pnl' }));
  });

  it('create_funnel builds stages from overview', async () => {
    (engine.getOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalContacts: 50,
      activeLeads: 20,
      totalQuotes: 10,
      totalBookings: 5,
    });
    (engine.getAvailableMetrics as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await service.execute(mkCmd('create_funnel'));
    expect(result.success).toBe(true);
    expect((result.data as { stages: unknown[] }).stages).toHaveLength(4);
  });

  it('track_event creates a business event', async () => {
    (prisma.client.businessEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'evt_1' });
    const result = await service.execute(mkCmd('track_event', {
      eventName: 'page_view',
      contactId: 'c1',
      properties: { url: '/' },
    }));
    expect(result.success).toBe(true);
    expect(prisma.client.businessEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 'biz_123', eventType: 'page_view' }),
    }));
  });

  it('export_report returns csv payload', async () => {
    (ledger.getPnl as ReturnType<typeof vi.fn>).mockResolvedValue({
      basis: 'accrual',
      currency: 'TTD',
      period: { from: '2026-06-01', to: '2026-06-30' },
      revenue: { total: 100, accounts: [] },
      discounts: { total: 0, accounts: [] },
      cogs: { total: 0, accounts: [] },
      grossProfit: 100,
      operatingExpenses: { total: 0, accounts: [] },
      netProfit: 100,
    });
    const result = await service.execute(mkCmd('export_report', { reportId: 'pnl|2026-06-01|2026-06-30', format: 'csv' }));
    expect(result.success).toBe(true);
    expect((result.data as { content: string }).content).toContain('Profit & Loss');
  });

  it('getOverview delegates to AnalyticsEngineService', async () => {
    (engine.getOverview as ReturnType<typeof vi.fn>).mockResolvedValue({ totalRevenue: 42 });
    const result = await service.getOverview('biz_123');
    expect(result).toEqual({ totalRevenue: 42 });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown analytics action');
  });
});
