import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GenomeDeliveryCapabilityService } from './genome-delivery-capability.service';

function makePrisma() {
  const stored: any[] = [];
  let nextId = 1;

  const prisma = {
    client: {
      genomeDeliveryCapability: {
        create: vi.fn().mockImplementation(({ data }: { data: any }) => {
          const now = new Date();
          const row = { id: `cap_${nextId++}`, ...data, createdAt: now, updatedAt: now };
          stored.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockImplementation(({ where, take }: { where?: any; take?: number }) => {
          let results = [...stored];
          if (where?.businessId) {
            results = results.filter((r) => r.businessId === where.businessId);
          }
          if (where?.capabilityType) {
            results = results.filter((r) => r.capabilityType === where.capabilityType);
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
  const service = new GenomeDeliveryCapabilityService(prisma);
  return { service, prisma, stored };
}

describe('GenomeDeliveryCapabilityService', () => {
  it('creates a delivery capability', async () => {
    const { service } = makeService();
    const cap = await service.upsertCapability({
      businessId: 'biz_1',
      name: 'Consulting delivery',
      capabilityType: 'CONSULTING',
      currentCapacity: 10,
      maxCapacity: 12,
      utilizationRate: 0.7,
      confidence: 0.8,
    });

    expect(cap.businessId).toBe('biz_1');
    expect(cap.name).toBe('Consulting delivery');
    expect(cap.capabilityType).toBe('CONSULTING');
  });

  it('detects overloaded capability as critical risk', async () => {
    const { service } = makeService();
    const cap = await service.upsertCapability({
      businessId: 'biz_1',
      name: 'Support',
      capabilityType: 'SUPPORT',
      utilizationRate: 1.1,
    });

    expect(cap.riskLevel).toBe('CRITICAL');
    expect(cap.constraints.some((c) => c.label === 'Overloaded')).toBe(true);
  });

  it('detects low quality score as high risk', async () => {
    const { service } = makeService();
    const cap = await service.upsertCapability({
      businessId: 'biz_1',
      name: 'Fulfillment',
      capabilityType: 'FULFILLMENT',
      qualityScore: 35,
    });

    expect(cap.constraints.some((c) => c.label === 'Low quality score')).toBe(true);
  });

  it('lists capabilities by type', async () => {
    const { service } = makeService();
    await service.upsertCapability({ businessId: 'biz_1', name: 'A', capabilityType: 'SERVICE' });
    await service.upsertCapability({ businessId: 'biz_1', name: 'B', capabilityType: 'PRODUCT' });

    const services = await service.listCapabilities('biz_1', { capabilityType: 'SERVICE' });
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('A');
  });

  it('deletes a capability with ownership check', async () => {
    const { service, stored } = makeService();
    const cap = await service.upsertCapability({ businessId: 'biz_1', name: 'A', capabilityType: 'SERVICE' });

    await service.deleteCapability('biz_1', cap.id);
    expect(stored).toHaveLength(0);
  });

  it('throws NotFoundException when deleting a capability from another business', async () => {
    const { service } = makeService();
    const cap = await service.upsertCapability({ businessId: 'biz_1', name: 'A', capabilityType: 'SERVICE' });

    await expect(service.deleteCapability('biz_2', cap.id)).rejects.toThrow(NotFoundException);
  });
});
