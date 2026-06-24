import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GenomeSalesMotionService } from './genome-sales-motion.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeSalesMotion: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const now = new Date();
          const row = { id: `mot_${nextId++}`, ...data, createdAt: now, updatedAt: now };
          stored.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.motionType) {
            results = results.filter((r) => r.motionType === where.motionType);
          }
          if (where?.stage) {
            results = results.filter((r) => r.stage === where.stage);
          }
          if (where?.channel) {
            results = results.filter((r) => r.channel === where.channel);
          }
          if (where?.isActive !== undefined) {
            results = results.filter((r) => r.isActive === where.isActive);
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
  const service = new GenomeSalesMotionService(prisma);
  return { service, prisma, stored };
}

describe('GenomeSalesMotionService', () => {
  it('creates a sales motion', async () => {
    const { service } = makeService();
    const motion = await service.upsertMotion({
      businessId: 'biz_1',
      name: 'Inbound content',
      motionType: 'INBOUND',
      stage: 'AWARENESS',
      conversionRate: 0.05,
      volume: 1000,
      confidence: 0.8,
    });

    expect(motion.businessId).toBe('biz_1');
    expect(motion.name).toBe('Inbound content');
    expect(motion.motionType).toBe('INBOUND');
    expect(motion.isActive).toBe(true);
  });

  it('lists motions by type', async () => {
    const { service } = makeService();
    await service.upsertMotion({ businessId: 'biz_1', name: 'A', motionType: 'INBOUND' });
    await service.upsertMotion({ businessId: 'biz_1', name: 'B', motionType: 'OUTBOUND' });

    const inbound = await service.listMotions('biz_1', { motionType: 'INBOUND' });
    expect(inbound).toHaveLength(1);
    expect(inbound[0].name).toBe('A');
  });

  it('deletes a motion with ownership check', async () => {
    const { service, stored } = makeService();
    const motion = await service.upsertMotion({ businessId: 'biz_1', name: 'A', motionType: 'REFERRAL' });

    await service.deleteMotion('biz_1', motion.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a motion from another business', async () => {
    const { service } = makeService();
    const motion = await service.upsertMotion({ businessId: 'biz_1', name: 'A', motionType: 'REFERRAL' });

    await expect(service.deleteMotion('biz_2', motion.id)).rejects.toThrow(NotFoundException);
  });
});
