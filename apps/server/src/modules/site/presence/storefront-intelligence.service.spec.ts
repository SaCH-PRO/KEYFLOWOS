import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StorefrontIntelligenceService,
  PRESENCE_INSIGHTS_SCHEMA_VERSION,
} from './storefront-intelligence.service';

function makePrisma(overrides: any = {}) {
  return {
    client: {
      business: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'biz-1',
          slug: 'acme',
          whatsapp: '+18681234567',
          storeEnabled: true,
        }),
      },
      marketplaceOrder: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'o1', status: 'placed', paymentStatus: 'PAID', total: 100, currency: 'TTD',
            createdAt: new Date(),
            items: [{ productId: 'p1', quantity: 1, total: 100 }],
          },
          {
            id: 'o2', status: 'placed', paymentStatus: 'PAID', total: 100, currency: 'TTD',
            createdAt: new Date(),
            items: [{ productId: 'p1', quantity: 1, total: 100 }],
          },
          {
            id: 'o3', status: 'placed', paymentStatus: 'PAID', total: 100, currency: 'TTD',
            createdAt: new Date(),
            items: [{ productId: 'p1', quantity: 1, total: 100 }],
          },
        ]),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', name: 'Coconut Oil 500ml', price: 100, isActive: true },
        ]),
      },
      service: { findMany: vi.fn().mockResolvedValue([]) },
      booking: { findMany: vi.fn().mockResolvedValue([]) },
      contact: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryStock: { findMany: vi.fn().mockResolvedValue([]) },
      presenceDailyStat: { findMany: vi.fn().mockResolvedValue([]) },
      leadFormSubmission: { findMany: vi.fn().mockResolvedValue([]) },
      leadForm: { findMany: vi.fn().mockResolvedValue([]) },
      publicEvent: { findMany: vi.fn().mockResolvedValue([]) },
      presenceInsightSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve({
          ...create,
          computedAt: new Date(),
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      revenueAction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ra-1', ...data, status: 'PENDING' }),
        ),
        update: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'ra-1', ...data }),
        ),
      },
      ...overrides,
    },
  };
}

const failingGateway = {
  complete: vi.fn().mockRejectedValue(new Error('AI offline')),
};

const mockAiUsage = {
  trackAndComplete: vi.fn().mockImplementation(async (_biz: string, _uid: string | undefined, _feature: string, request: any) => {
    return failingGateway.complete(request);
  }),
};

describe('StorefrontIntelligenceService', () => {
  beforeEach(() => {
    process.env.PRESENCE_INSIGHTS_AI = '0'; // force template-only path
  });

  it('regenerate returns deterministic snapshot with template narrative when AI is disabled', async () => {
    const prisma = makePrisma();
    const service = new StorefrontIntelligenceService(prisma as any, failingGateway as any, mockAiUsage as any);

    const result = await service.regenerate('biz-1', 30);

    expect(result.snapshot.version).toBe(PRESENCE_INSIGHTS_SCHEMA_VERSION);
    expect(result.snapshot.windowDays).toBe(30);
    expect(result.narrativeSource).toBe('template');
    expect(result.snapshot.narrative.source).toBe('template');
    expect(result.snapshot.narrative.modelUsed).toBeNull();
    // money block has revenue + top product insights
    const ids = result.snapshot.categories.money.insights.map((i) => i.id);
    expect(ids).toContain('money.monthly_revenue');
    expect(ids.some((i) => i.startsWith('money.top_revenue_product:'))).toBe(true);
    // Categories with no signal still get a summary, never invented insights.
    expect(result.snapshot.categories.goods.insights).toEqual([]);
    expect(result.snapshot.categories.goods.summary).toMatch(/Not enough/);
    expect(prisma.client.presenceInsightSnapshot.upsert).toHaveBeenCalled();
    // AI gateway must NOT be called when env kill switch is set.
    expect(failingGateway.complete).not.toHaveBeenCalled();
  });

  it('falls back to template narrative when AI gateway throws', async () => {
    delete process.env.PRESENCE_INSIGHTS_AI;
    const prisma = makePrisma();
    const service = new StorefrontIntelligenceService(prisma as any, failingGateway as any, mockAiUsage as any);

    const result = await service.regenerate('biz-1', 14);
    expect(result.narrativeSource).toBe('template');
    expect(result.snapshot.narrative.headline).toMatch(/storefront revenue|gathering signal|converting/i);
    expect(failingGateway.complete).toHaveBeenCalled();
  });

  it('respects min-sample-size gate (no insights with too little data)', async () => {
    const prisma = makePrisma({
      marketplaceOrder: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'o1', status: 'placed', paymentStatus: 'PAID', total: 100, currency: 'TTD',
            createdAt: new Date(),
            items: [{ productId: 'p1', quantity: 1, total: 100 }],
          },
        ]),
      },
    });
    const service = new StorefrontIntelligenceService(prisma as any, failingGateway as any, mockAiUsage as any);

    const result = await service.regenerate('biz-1', 30);
    // 1 paid order is below MIN_SAMPLES.orders (3): no money insights surfaced.
    expect(result.snapshot.categories.money.insights).toEqual([]);
  });

  it('regenerate auto-enqueues every actionable insight as a PRESENCE_RECOMMENDATION_* revenue action', async () => {
    const prisma = makePrisma();
    const service = new StorefrontIntelligenceService(prisma as any, failingGateway as any, mockAiUsage as any);

    const gen = await service.regenerate('biz-1', 30);
    const actionable = Object.values(gen.snapshot.categories).flatMap((b) =>
      b.insights.filter((i) => i.actionable),
    );
    expect(actionable.length).toBeGreaterThan(0);
    expect(prisma.client.revenueAction.create).toHaveBeenCalledTimes(actionable.length);
    const relatedIds = new Set<string>();
    for (const call of prisma.client.revenueAction.create.mock.calls) {
      expect(call[0].data.type).toBe('presence_recommendation');
      relatedIds.add(call[0].data.relatedId);
    }
    // Each insight got its own row (no cross-insight collision).
    expect(relatedIds.size).toBe(actionable.length);
  });

  it('delegateInsight is idempotent on top of auto-enqueue', async () => {
    const prisma = makePrisma();
    const service = new StorefrontIntelligenceService(prisma as any, failingGateway as any, mockAiUsage as any);

    const gen = await service.regenerate('biz-1', 30);
    const target = gen.snapshot.categories.money.insights.find((i) => i.actionable);
    expect(target).toBeDefined();

    prisma.client.presenceInsightSnapshot.findUnique.mockResolvedValueOnce({
      payload: gen.snapshot,
      stale: false,
      computedAt: new Date(),
      narrativeSource: 'template',
    });
    prisma.client.revenueAction.findUnique.mockResolvedValueOnce({
      id: 'ra-1', status: 'PENDING',
    });
    const res = await service.delegateInsight('biz-1', target!.id);
    expect(res.created).toBe(false);
    expect(res.revenueActionId).toBe('ra-1');
  });

  it('emits services.low_time_on_page insight from PublicEvent dwell signal', async () => {
    const baseTs = new Date('2026-04-01T12:00:00Z').getTime();
    // 10 sessions, each: service_view at t, then next event 4s later — avg 4s.
    const events: any[] = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        type: 'service_view',
        sessionId: `s${i}`,
        visitorId: `v${i}`,
        payload: { serviceId: 'svc-1' },
        ts: new Date(baseTs + i * 60_000),
        source: null, medium: null, campaign: null,
      });
      events.push({
        type: 'page_view',
        sessionId: `s${i}`,
        visitorId: `v${i}`,
        payload: {},
        ts: new Date(baseTs + i * 60_000 + 4_000),
        source: null, medium: null, campaign: null,
      });
    }
    const prisma = makePrisma({
      service: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'svc-1', name: 'Hair Cut', isActive: true, basePrice: 50 },
        ]),
      },
      publicEvent: { findMany: vi.fn().mockResolvedValue(events) },
    });
    const service = new StorefrontIntelligenceService(prisma as any, failingGateway as any, mockAiUsage as any);
    const gen = await service.regenerate('biz-1', 30);
    const ids = gen.snapshot.categories.services.insights.map((i) => i.id);
    expect(ids).toContain('services.low_time_on_page:svc-1');
  });
});
