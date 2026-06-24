import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GenomeGrowthChannelService } from './genome-growth-channel.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeGrowthChannel: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const now = new Date();
          const row = { id: `ch_${nextId++}`, ...data, createdAt: now, updatedAt: now };
          stored.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.status) {
            results = results.filter((r) => r.status === where.status);
          }
          if (where?.channelType) {
            results = results.filter((r) => r.channelType === where.channelType);
          }
          if (where?.confidence?.gte !== undefined) {
            results = results.filter((r) => r.confidence >= where.confidence.gte);
          }
          return Promise.resolve(results.slice(0, take));
        }),
        findFirst: vi.fn().mockImplementation(({ where }: { where: any }) => {
          if (where.id) {
            return Promise.resolve(
              stored.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null,
            );
          }
          if (where.key?.equals && where.key?.mode === 'insensitive') {
            const key = where.key.equals.toLowerCase();
            return Promise.resolve(
              stored.find(
                (r) =>
                  r.businessId === where.businessId && r.key.toLowerCase() === key,
              ) ?? null,
            );
          }
          if (typeof where.key === 'string') {
            return Promise.resolve(
              stored.find(
                (r) => r.businessId === where.businessId && r.key === where.key,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
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
  const service = new GenomeGrowthChannelService(prisma);
  return { service, prisma, stored };
}

describe('GenomeGrowthChannelService', () => {
  it('creates a growth channel', async () => {
    const { service } = makeService();
    const channel = await service.create('biz_1', {
      key: 'paid_social',
      label: 'Paid Social',
      channelType: 'paid',
      monthlyBudget: 5000,
      currency: 'TTD',
      targetCac: 120,
      targetConversionRate: 0.03,
      confidence: 0.8,
    });

    expect(channel.businessId).toBe('biz_1');
    expect(channel.key).toBe('paid_social');
    expect(channel.label).toBe('Paid Social');
    expect(channel.channelType).toBe('paid');
    expect(channel.monthlyBudget).toBe(5000);
    expect(channel.targetCac).toBe(120);
    expect(channel.confidence).toBe(0.8);
    expect(channel.status).toBe('ACTIVE');
  });

  it('normalizes key and rejects duplicates case-insensitively', async () => {
    const { service } = makeService();
    await service.create('biz_1', {
      key: 'Paid_Social',
      label: 'Paid Social',
      channelType: 'paid',
    });

    await expect(
      service.create('biz_1', {
        key: 'paid social',
        label: 'Paid Social Duplicate',
        channelType: 'paid',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects empty key', async () => {
    const { service } = makeService();
    await expect(
      service.create('biz_1', {
        key: '   ',
        label: 'No Key',
        channelType: 'owned',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists channels with filters', async () => {
    const { service } = makeService();
    await service.create('biz_1', {
      key: 'paid_social',
      label: 'Paid Social',
      channelType: 'paid',
      status: 'ACTIVE',
    });
    await service.create('biz_1', {
      key: 'seo',
      label: 'SEO',
      channelType: 'owned',
      status: 'TESTING',
    });

    const paid = await service.findMany('biz_1', { channelType: 'paid' });
    expect(paid).toHaveLength(1);
    expect(paid[0].key).toBe('paid_social');

    const testing = await service.findMany('biz_1', { status: 'TESTING' });
    expect(testing).toHaveLength(1);
  });

  it('finds channel by id', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', {
      key: 'seo',
      label: 'SEO',
      channelType: 'owned',
    });

    const found = await service.findById('biz_1', created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);

    const wrongBusiness = await service.findById('biz_2', created.id);
    expect(wrongBusiness).toBeNull();
  });

  it('updates a channel', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', {
      key: 'seo',
      label: 'SEO',
      channelType: 'owned',
      targetCac: 100,
    });

    const updated = await service.update('biz_1', created.id, {
      label: 'Organic Search',
      targetCac: 80,
      status: 'TESTING',
    });

    expect(updated.label).toBe('Organic Search');
    expect(updated.targetCac).toBe(80);
    expect(updated.status).toBe('TESTING');
  });

  it('throws NotFoundException when updating a channel from another business', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', {
      key: 'seo',
      label: 'SEO',
      channelType: 'owned',
    });

    await expect(
      service.update('biz_2', created.id, { label: 'Hacked' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes a channel with ownership check', async () => {
    const { service, stored } = makeService();
    const created = await service.create('biz_1', {
      key: 'seo',
      label: 'SEO',
      channelType: 'owned',
    });

    await service.delete('biz_1', created.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a channel from another business', async () => {
    const { service } = makeService();
    const created = await service.create('biz_1', {
      key: 'seo',
      label: 'SEO',
      channelType: 'owned',
    });

    await expect(service.delete('biz_2', created.id)).rejects.toThrow(NotFoundException);
  });

  it('clamps confidence to 0-1', async () => {
    const { service } = makeService();
    const low = await service.create('biz_1', {
      key: 'low',
      label: 'Low',
      channelType: 'owned',
      confidence: -0.5,
    });
    const high = await service.create('biz_1', {
      key: 'high',
      label: 'High',
      channelType: 'owned',
      confidence: 1.5,
    });

    expect(low.confidence).toBe(0);
    expect(high.confidence).toBe(1);
  });
});
