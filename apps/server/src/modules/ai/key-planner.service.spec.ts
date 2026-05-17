import { describe, expect, it, vi } from 'vitest';
import { KeyPlannerService } from './key-planner.service';

function createMockPrisma() {
  const store = {
    products: [] as any[],
    invoices: [] as any[],
    socialPosts: [] as any[],
    contentRequests: [] as any[],
  };

  return {
    client: {
      product: {
        count: vi.fn(async () => store.products.length),
        findMany: vi.fn(async () => store.products),
      },
      invoice: {
        count: vi.fn(async () => store.invoices.length),
      },
      socialPost: {
        count: vi.fn(async () => store.socialPosts.length),
      },
      contentRequest: {
        count: vi.fn(async () => store.contentRequests.length),
        findMany: vi.fn(async () => store.contentRequests),
      },
    },
    store,
  };
}

describe('KeyPlannerService', () => {
  it('detects promotion need for high inventory + no sales', async () => {
    const prisma = createMockPrisma();
    prisma.store.products = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    prisma.store.invoices = [];
    const svc = new KeyPlannerService(prisma as any);

    const needs = await svc.detectContentNeeds('biz_1');
    const promotion = needs.find((n) => n.type === 'promotion');
    expect(promotion).toBeDefined();
    expect(promotion?.priority).toBe('high');
    expect(promotion?.suggestedContentTypes).toContain('social_post');
  });

  it('detects launch need for new products', async () => {
    const prisma = createMockPrisma();
    prisma.store.products = [
      { id: 'p1', name: 'New Widget', createdAt: new Date() },
    ];
    const svc = new KeyPlannerService(prisma as any);

    const needs = await svc.detectContentNeeds('biz_1');
    const launch = needs.find((n) => n.type === 'launch');
    expect(launch).toBeDefined();
    expect(launch?.priority).toBe('high');
  });

  it('detects engagement need for no recent posts', async () => {
    const prisma = createMockPrisma();
    prisma.store.socialPosts = [];
    const svc = new KeyPlannerService(prisma as any);

    const needs = await svc.detectContentNeeds('biz_1');
    const engagement = needs.find((n) => n.type === 'engagement');
    expect(engagement).toBeDefined();
    expect(engagement?.priority).toBe('normal');
  });

  it('detects stuck content in pipeline', async () => {
    const prisma = createMockPrisma();
    prisma.store.contentRequests = [{ id: 'cr1', status: 'in_production' }];
    const svc = new KeyPlannerService(prisma as any);

    const needs = await svc.detectContentNeeds('biz_1');
    const stuck = needs.find((n) => n.type === 'pipeline_attention');
    expect(stuck).toBeDefined();
    expect(stuck?.priority).toBe('low');
  });

  it('returns empty when nothing needs attention', async () => {
    const prisma = createMockPrisma();
    prisma.store.products = []; // no products, no promotion or launch
    prisma.store.invoices = [{ id: 'i1', createdAt: new Date() }];
    prisma.store.socialPosts = [{ id: 'sp1', createdAt: new Date() }];
    prisma.store.contentRequests = [{ id: 'cr1', businessGoal: 'mother', createdAt: new Date() }];
    const svc = new KeyPlannerService(prisma as any);

    const needs = await svc.detectContentNeeds('biz_1');
    // Should only have seasonal and pipeline; seasonal is covered by contentRequests
    const hasPromotion = needs.some((n) => n.type === 'promotion');
    const hasEngagement = needs.some((n) => n.type === 'engagement');
    expect(hasPromotion).toBe(false);
    expect(hasEngagement).toBe(false);
  });

  it('sorts needs by priority', async () => {
    const prisma = createMockPrisma();
    prisma.store.products = [
      { id: 'p1', name: 'Widget', createdAt: new Date() },
    ];
    prisma.store.socialPosts = [];
    prisma.store.contentRequests = [{ id: 'cr1', status: 'draft' }];
    const svc = new KeyPlannerService(prisma as any);

    const needs = await svc.detectContentNeeds('biz_1');
    expect(needs[0].priority).toBe('high'); // launch
    expect(needs[1].priority).toBe('normal'); // engagement
    expect(needs[2].priority).toBe('low'); // pipeline
  });
});
