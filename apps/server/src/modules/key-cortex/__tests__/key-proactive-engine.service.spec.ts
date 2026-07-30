import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyProactiveEngineService } from '../key-proactive-engine.service';

const mockContextSnapshot = (
  overrides: Partial<{
    pendingInvoices: number;
    executiveReadiness: number;
    genomeDna: Record<string, number>;
  }> = {},
) => ({
  businessId: 'biz_1',
  genomeDna: { execution: 50, strategy: 50, finance: 50, marketing: 50, operations: 50, ...overrides.genomeDna },
  genomeStage: 'startup',
  executiveReadiness: overrides.executiveReadiness ?? 50,
  recentTasks: [],
  recentEvents: [],
  keyMetrics: {},
  activeProjects: 0,
  pendingInvoices: overrides.pendingInvoices ?? 0,
  unreadMessages: 0,
  teamStatus: [],
  timestamp: new Date(),
});

function createMockPrisma(businesses: Array<{ id: string }> = []) {
  return {
    client: {
      business: {
        findMany: vi.fn().mockResolvedValue(businesses),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
      },
      lead: {
        count: vi.fn().mockResolvedValue(0),
      },
      invoice: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { total: 0 } }),
      },
    },
  };
}

const mockContextService = {
  buildContextSnapshot: vi.fn().mockResolvedValue(mockContextSnapshot()),
};

const mockSignalService = {
  createSignal: vi.fn().mockResolvedValue({ id: 'sig_1' }),
};

function createService(
  mockPrisma = createMockPrisma(),
  withSignalService = true,
): { service: KeyProactiveEngineService; mockPrisma: ReturnType<typeof createMockPrisma> } {
  const service = new KeyProactiveEngineService(
    mockPrisma as any,
    mockContextService as any,
    withSignalService ? (mockSignalService as any) : undefined,
  );
  return { service, mockPrisma };
}

describe('KeyProactiveEngineService — real business scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getActiveBusinesses returns businesses with autopilot and recent activity', async () => {
    const mockPrisma = createMockPrisma([{ id: 'biz_1' }, { id: 'biz_2' }]);
    const { service } = createService(mockPrisma);

    const ids = await (service as any).getActiveBusinesses();

    expect(ids).toEqual(['biz_1', 'biz_2']);
    expect(mockPrisma.client.business.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          autopilotEnabled: true,
        }),
        select: { id: true },
        take: 500,
        distinct: ['id'],
      }),
    );
  });

  it('getActiveBusinesses returns empty array on query failure', async () => {
    const mockPrisma = createMockPrisma();
    mockPrisma.client.business.findMany.mockRejectedValue(new Error('DB down'));
    const { service } = createService(mockPrisma);

    const ids = await (service as any).getActiveBusinesses();

    expect(ids).toEqual([]);
  });

  it('evaluateProactiveActions scans active businesses and returns triggers', async () => {
    const mockPrisma = createMockPrisma([{ id: 'biz_1' }]);
    mockContextService.buildContextSnapshot.mockResolvedValue(
      mockContextSnapshot({ pendingInvoices: 10, overdueTasks: 5, unconvertedLeads: 8 }),
    );
    mockPrisma.client.task.count.mockResolvedValue(5);
    mockPrisma.client.lead.count.mockResolvedValue(8);

    const { service } = createService(mockPrisma);
    const triggers = await service.evaluateProactiveActions();

    expect(triggers.length).toBeGreaterThanOrEqual(3);
    expect(triggers.map((t) => t.type)).toEqual(
      expect.arrayContaining(['invoice_overdue', 'missed_task', 'lead_dormant']),
    );
  });

  it('evaluateProactiveActions creates genome signals when signal service is available', async () => {
    const mockPrisma = createMockPrisma([{ id: 'biz_1' }]);
    mockContextService.buildContextSnapshot.mockResolvedValue(
      mockContextSnapshot({ pendingInvoices: 10 }),
    );

    const { service } = createService(mockPrisma);
    await service.evaluateProactiveActions();

    expect(mockSignalService.createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        sourceModule: 'key_autonomy',
        signalType: 'RISK_PATTERN',
        section: 'FINANCE',
        domain: 'cashflow',
      }),
    );
  });

  it('evaluateProactiveActions skips signal persistence when signal service is absent', async () => {
    const mockPrisma = createMockPrisma([{ id: 'biz_1' }]);
    mockContextService.buildContextSnapshot.mockResolvedValue(
      mockContextSnapshot({ pendingInvoices: 6, executiveReadiness: 95 }),
    );

    const { service } = createService(mockPrisma, false);
    const triggers = await service.evaluateProactiveActions();

    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe('invoice_overdue');
    expect(mockSignalService.createSignal).not.toHaveBeenCalled();
  });

  it('gatherSignals returns anomaly score based on context', async () => {
    const mockPrisma = createMockPrisma();
    mockContextService.buildContextSnapshot.mockResolvedValue(
      mockContextSnapshot({ pendingInvoices: 8, executiveReadiness: 30 }),
    );

    const { service } = createService(mockPrisma);
    const signals = await service.gatherSignals('biz_1');

    expect(signals.pendingInvoices).toBe(8);
    expect(signals.anomalyScore).toBeGreaterThan(70);
  });

  it('evaluateProactiveActions isolates failures per business', async () => {
    const mockPrisma = createMockPrisma([{ id: 'biz_ok' }, { id: 'biz_fail' }]);
    mockContextService.buildContextSnapshot.mockImplementation((businessId: string) => {
      if (businessId === 'biz_fail') {
        return Promise.reject(new Error('snapshot failed'));
      }
      return Promise.resolve(mockContextSnapshot({ pendingInvoices: 6, executiveReadiness: 95 }));
    });

    const { service } = createService(mockPrisma);
    const triggers = await service.evaluateProactiveActions();

    expect(triggers).toHaveLength(1);
    expect(triggers[0].businessId).toBe('biz_ok');
    expect(triggers[0].type).toBe('invoice_overdue');
  });
});
