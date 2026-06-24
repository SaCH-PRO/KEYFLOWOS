import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GenomeOperationalProcessService } from './genome-operational-process.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeOperationalProcess: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const now = new Date();
          const row = { id: `proc_${nextId++}`, ...data, createdAt: now, updatedAt: now };
          stored.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.processType) {
            results = results.filter((r) => r.processType === where.processType);
          }
          if (where?.ownerRole) {
            results = results.filter((r) => r.ownerRole === where.ownerRole);
          }
          if (where?.hasSop !== undefined) {
            results = results.filter((r) => r.hasSop === where.hasSop);
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
  const service = new GenomeOperationalProcessService(prisma);
  return { service, prisma, stored };
}

describe('GenomeOperationalProcessService', () => {
  it('creates an operational process', async () => {
    const { service } = makeService();
    const process = await service.upsertProcess({
      businessId: 'biz_1',
      name: 'Order fulfillment',
      processType: 'FULFILLMENT',
      hasSop: true,
      ownerRole: 'Operations Lead',
      confidence: 0.8,
    });

    expect(process.businessId).toBe('biz_1');
    expect(process.name).toBe('Order fulfillment');
    expect(process.processType).toBe('FULFILLMENT');
    expect(process.hasSop).toBe(true);
  });

  it('flags missing SOP on core process as high risk', async () => {
    const { service } = makeService();
    const process = await service.upsertProcess({
      businessId: 'biz_1',
      name: 'Delivery',
      processType: 'DELIVERY',
      hasSop: false,
    });

    expect(process.riskLevel).toBe('HIGH');
    expect(process.bottlenecks.some((b) => b.label === 'Missing SOP')).toBe(true);
  });

  it('flags high failure rate as quality risk', async () => {
    const { service } = makeService();
    const process = await service.upsertProcess({
      businessId: 'biz_1',
      name: 'Quality check',
      processType: 'QUALITY',
      hasSop: true,
      failureRate: 0.25,
    });

    expect(process.bottlenecks.some((b) => b.label === 'High failure rate')).toBe(true);
  });

  it('lists processes by type', async () => {
    const { service } = makeService();
    await service.upsertProcess({ businessId: 'biz_1', name: 'A', processType: 'DELIVERY' });
    await service.upsertProcess({ businessId: 'biz_1', name: 'B', processType: 'ADMIN' });

    const delivery = await service.listProcesses('biz_1', { processType: 'DELIVERY' });
    expect(delivery).toHaveLength(1);
    expect(delivery[0].name).toBe('A');
  });

  it('deletes a process with ownership check', async () => {
    const { service, stored } = makeService();
    const process = await service.upsertProcess({ businessId: 'biz_1', name: 'A', processType: 'SUPPORT' });

    await service.deleteProcess('biz_1', process.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a process from another business', async () => {
    const { service } = makeService();
    const process = await service.upsertProcess({ businessId: 'biz_1', name: 'A', processType: 'SUPPORT' });

    await expect(service.deleteProcess('biz_2', process.id)).rejects.toThrow(NotFoundException);
  });
});
