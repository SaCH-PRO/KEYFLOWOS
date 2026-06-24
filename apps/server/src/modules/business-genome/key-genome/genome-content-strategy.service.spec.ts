import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GenomeContentStrategyService } from './genome-content-strategy.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeContentStrategy: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const now = new Date();
          const row = { id: `cs_${nextId++}`, ...data, createdAt: now, updatedAt: now };
          stored.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.confidence?.gte !== undefined) {
            results = results.filter((r) => r.confidence >= where.confidence.gte);
          }
          return Promise.resolve(results.slice(0, take));
        }),
        findFirst: vi.fn().mockImplementation(({ where }: { where: any }) => {
          return Promise.resolve(
            stored.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null,
          );
        }),
        count: vi.fn().mockImplementation(({ where }: { where?: any }) => {
          return Promise.resolve(
            stored.filter((r) => r.businessId === where?.businessId).length,
          );
        }),
        delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          const idx = stored.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          stored.splice(idx, 1);
          return Promise.resolve({});
        }),
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: any }) => {
          const idx = stored.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          const updated = { ...stored[idx], ...data, updatedAt: new Date() };
          stored[idx] = updated;
          return Promise.resolve(updated);
        }),
      },
    },
  } as any;

  return { prisma, stored };
}

function makeService() {
  const { prisma, stored } = makePrisma();
  const service = new GenomeContentStrategyService(prisma);
  return { service, prisma, stored };
}

describe('GenomeContentStrategyService', () => {
  it('creates a content strategy', async () => {
    const { service } = makeService();
    const strategy = await service.create('biz_1', {
      pillars: ['Education', 'Product', 'Culture'],
      formats: ['Video', 'Blog', 'Newsletter'],
      cadence: 'Weekly',
      distributionChannels: ['social', 'email'],
      contentGoals: { awareness: 50, conversion: 30, retention: 20 },
      confidence: 0.85,
    });

    expect(strategy.businessId).toBe('biz_1');
    expect(strategy.pillars).toEqual(['Education', 'Product', 'Culture']);
    expect(strategy.formats).toEqual(['Video', 'Blog', 'Newsletter']);
    expect(strategy.cadence).toBe('Weekly');
    expect(strategy.distributionChannels).toEqual(['social', 'email']);
    expect(strategy.confidence).toBe(0.85);
  });

  it('allows multiple strategies but warns', async () => {
    const { service } = makeService();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await service.create('biz_1', {
      pillars: ['A'],
      formats: ['Blog'],
    });
    await service.create('biz_1', {
      pillars: ['B'],
      formats: ['Video'],
    });

    const list = await service.findMany('biz_1');
    expect(list).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('lists strategies', async () => {
    const { service } = makeService();
    await service.create('biz_1', { pillars: ['A'], formats: ['Blog'] });
    await service.create('biz_1', { pillars: ['B'], formats: ['Video'] });

    const all = await service.findMany('biz_1');
    expect(all).toHaveLength(2);

    const limited = await service.findMany('biz_1', { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('finds strategy by id', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', { pillars: ['A'], formats: ['Blog'] });

    const found = await service.findById('biz_1', created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);

    const wrongBusiness = await service.findById('biz_2', created.id);
    expect(wrongBusiness).toBeNull();
  });

  it('updates a strategy', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', {
      pillars: ['A'],
      formats: ['Blog'],
      cadence: 'Weekly',
    });

    const updated = await service.update('biz_1', created.id, {
      cadence: 'Bi-weekly',
      formats: ['Blog', 'Video'],
    });

    expect(updated.cadence).toBe('Bi-weekly');
    expect(updated.formats).toEqual(['Blog', 'Video']);
    expect(updated.pillars).toEqual(['A']);
  });

  it('throws NotFoundException when updating a strategy from another business', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', { pillars: ['A'], formats: ['Blog'] });

    await expect(
      service.update('biz_2', created.id, { cadence: 'Daily' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes a strategy with ownership check', async () => {
    const { service, stored } = makeService();
    const created = await service.create('biz_1', { pillars: ['A'], formats: ['Blog'] });

    await service.delete('biz_1', created.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a strategy from another business', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', { pillars: ['A'], formats: ['Blog'] });

    await expect(service.delete('biz_2', created.id)).rejects.toThrow(NotFoundException);
  });

  it('clamps confidence to 0-1', async () => {
    const { service } = makeService();
    const low = await service.create('biz_1', {
      pillars: ['A'],
      formats: ['Blog'],
      confidence: -0.5,
    });
    const high = await service.create('biz_1', {
      pillars: ['B'],
      formats: ['Video'],
      confidence: 1.5,
    });

    expect(low.confidence).toBe(0);
    expect(high.confidence).toBe(1);
  });
});
