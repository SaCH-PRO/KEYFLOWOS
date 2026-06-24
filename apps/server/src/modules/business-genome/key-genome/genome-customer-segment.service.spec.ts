import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GenomeCustomerSegmentService } from './genome-customer-segment.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeCustomerSegment: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const now = new Date();
          const row = { id: `seg_${nextId++}`, ...data, createdAt: now, updatedAt: now };
          stored.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.segmentType) {
            results = results.filter((r) => r.segmentType === where.segmentType);
          }
          if (where?.channel) {
            results = results.filter((r) => r.channel === where.channel);
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
        delete: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          const idx = stored.findIndex((r) => r.id === where.id);
          if (idx === -1) throw new Error('Not found');
          stored.splice(idx, 1);
          return Promise.resolve({});
        }),
      },
    },
  } as any;

  return { prisma, stored };
}

function makeService() {
  const { prisma, stored } = makePrisma();
  const service = new GenomeCustomerSegmentService(prisma);
  return { service, prisma, stored };
}

describe('GenomeCustomerSegmentService', () => {
  it('creates a customer segment', async () => {
    const { service } = makeService();
    const segment = await service.upsertSegment({
      businessId: 'biz_1',
      name: 'Enterprise',
      segmentType: 'HIGH_VALUE',
      estimatedSize: 50,
      lifetimeValue: 50000,
      confidence: 0.85,
    });

    expect(segment.businessId).toBe('biz_1');
    expect(segment.name).toBe('Enterprise');
    expect(segment.segmentType).toBe('HIGH_VALUE');
    expect(segment.confidence).toBe(0.85);
  });

  it('lists segments by type', async () => {
    const { service } = makeService();
    await service.upsertSegment({ businessId: 'biz_1', name: 'A', segmentType: 'HIGH_VALUE' });
    await service.upsertSegment({ businessId: 'biz_1', name: 'B', segmentType: 'AT_RISK' });

    const highValue = await service.listSegments('biz_1', { segmentType: 'HIGH_VALUE' });
    expect(highValue).toHaveLength(1);
    expect(highValue[0].name).toBe('A');
  });

  it('deletes a segment with ownership check', async () => {
    const { service, stored } = makeService();
    const segment = await service.upsertSegment({ businessId: 'biz_1', name: 'A', segmentType: 'NEW' });

    await service.deleteSegment('biz_1', segment.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a segment from another business', async () => {
    const { service } = makeService();
    const segment = await service.upsertSegment({ businessId: 'biz_1', name: 'A', segmentType: 'NEW' });

    await expect(service.deleteSegment('biz_2', segment.id)).rejects.toThrow(NotFoundException);
  });

  it('clamps confidence to 0–1', async () => {
    const { service } = makeService();
    const low = await service.upsertSegment({
      businessId: 'biz_1',
      name: 'Low',
      segmentType: 'CUSTOM',
      confidence: -0.2,
    });
    const high = await service.upsertSegment({
      businessId: 'biz_1',
      name: 'High',
      segmentType: 'CUSTOM',
      confidence: 1.5,
    });

    expect(low.confidence).toBe(0);
    expect(high.confidence).toBe(1);
  });
});
