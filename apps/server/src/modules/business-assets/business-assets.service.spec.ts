import { describe, expect, it, vi } from 'vitest';
import { BusinessAssetsService } from './business-assets.service';
import { NotFoundException } from '@nestjs/common';

function createMockTemporalFlow() {
  return {
    emit: vi.fn().mockResolvedValue({ id: 'tf_1' }),
  };
}

function createMockPrisma() {
  const store = {
    businessAssets: new Map<string, any>(),
  };
  let idCounter = 0;

  return {
    client: {
      businessAsset: {
        create: vi.fn(async (args: any) => {
          const id = `ba_${++idCounter}`;
          const record = {
            id,
            ...args.data,
            status: args.data.status ?? 'ACTIVE',
            metadata: args.data.metadata ?? {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          store.businessAssets.set(id, record);
          return record;
        }),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.businessAssets.values()).filter((a: any) => {
            if (args.where?.businessId && a.businessId !== args.where.businessId) return false;
            if (args.where?.status?.not && a.status === args.where.status.not) return false;
            return true;
          });
          return items.sort((a: any, b: any) => {
            if (a.type !== b.type) return a.type.localeCompare(b.type);
            return a.name.localeCompare(b.name);
          });
        }),
        findFirst: vi.fn(async (args: any) => {
          return (
            Array.from(store.businessAssets.values()).find((a: any) => {
              if (args.where?.id && a.id !== args.where.id) return false;
              if (args.where?.businessId && a.businessId !== args.where.businessId) return false;
              return true;
            }) ?? null
          );
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.businessAssets.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data, updatedAt: new Date() };
          store.businessAssets.set(args.where.id, updated);
          return updated;
        }),
        delete: vi.fn(async (args: any) => {
          store.businessAssets.delete(args.where.id);
          return { id: args.where.id };
        }),
      },
    },
    store,
  };
}

describe('BusinessAssetsService', () => {
  it('creates an asset', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    const result = await svc.create('biz_1', {
      type: 'DOMAIN',
      name: 'keyflowos.com',
      provider: 'GoDaddy',
      url: 'https://keyflowos.com',
    });

    expect(result.id).toBeDefined();
    expect(result.businessId).toBe('biz_1');
    expect(result.type).toBe('DOMAIN');
    expect(result.name).toBe('keyflowos.com');
    expect(result.status).toBe('ACTIVE');
  });

  it('lists active assets excluding archived', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    await svc.create('biz_1', { type: 'SOFTWARE', name: 'Notion' });
    await svc.create('biz_1', { type: 'SOFTWARE', name: 'Old tool', status: 'ARCHIVED' });

    const result = await svc.list('biz_1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Notion');
  });

  it('updates an asset', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    const created = await svc.create('biz_1', { type: 'BANK', name: 'First Bank' });
    const updated = await svc.update('biz_1', created.id, { name: 'First Citizens Bank' });

    expect(updated.name).toBe('First Citizens Bank');
  });

  it('throws when updating a missing asset', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    await expect(svc.update('biz_1', 'missing', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('removes an asset', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    const created = await svc.create('biz_1', { type: 'LICENSE', name: 'Trade License' });
    await svc.remove('biz_1', created.id);

    const remaining = await svc.list('biz_1');
    expect(remaining).toHaveLength(0);
  });

  it('throws when removing a missing asset', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    await expect(svc.remove('biz_1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('summarizes assets and flags expiring items', async () => {
    const prisma = createMockPrisma();
    const temporal = createMockTemporalFlow();
    const svc = new BusinessAssetsService(prisma as any, temporal as any);

    const soon = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
    await svc.create('biz_1', { type: 'DOMAIN', name: 'keyflowos.com' });
    await svc.create('biz_1', { type: 'LICENSE', name: 'Business License', expiresAt: soon });

    const summary = await svc.summarizeForGenome('biz_1');
    expect(summary.total).toBe(2);
    expect(summary.byType.DOMAIN).toBe(1);
    expect(summary.byType.LICENSE).toBe(1);
    expect(summary.risks.length).toBe(1);
    expect(summary.risks[0]).toContain('Business License expires');
  });
});
