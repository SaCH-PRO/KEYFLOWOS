import { describe, expect, it, vi } from 'vitest';
import { AssetService } from './asset.service';

function createMockPrisma() {
  const store = {
    assets: new Map<string, any>(),
  };
  let idCounter = 0;

  return {
    client: {
      asset: {
        create: vi.fn(async (args: any) => {
          const id = `asset_${++idCounter}`;
          const record = { id, ...args.data, createdAt: new Date(), updatedAt: new Date() };
          store.assets.set(id, record);
          return record;
        }),
        findUnique: vi.fn(async (args: any) => store.assets.get(args.where.id) ?? null),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.assets.values()).filter((a: any) => {
            if (args.where?.businessId && a.businessId !== args.where.businessId) return false;
            if (args.where?.type && a.type !== args.where.type) return false;
            if (args.where?.folder && a.folder !== args.where.folder) return false;
            if (args.where?.tags?.has && !a.tags.includes(args.where.tags.has)) return false;
            if (args.where?.name?.contains) {
              const search = args.where.name.contains.toLowerCase();
              if (!a.name.toLowerCase().includes(search)) return false;
            }
            return true;
          });
          return items.sort((a: any, b: any) => b.createdAt - a.createdAt);
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.assets.get(args.where.id);
          if (!existing) return null;
          const data = { ...args.data };
          if (data.usageCount?.increment !== undefined) {
            data.usageCount = (existing.usageCount ?? 0) + data.usageCount.increment;
          }
          const updated = { ...existing, ...data, updatedAt: new Date() };
          store.assets.set(args.where.id, updated);
          return updated;
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        delete: vi.fn(async (args: any) => {
          store.assets.delete(args.where.id);
          return { id: args.where.id };
        }),
        count: vi.fn(async (args: any) => {
          const items = Array.from(store.assets.values()).filter((a: any) => {
            if (args.where?.businessId && a.businessId !== args.where.businessId) return false;
            if (args.where?.type && a.type !== args.where.type) return false;
            if (args.where?.folder && a.folder !== args.where.folder) return false;
            if (args.where?.tags?.has && !a.tags.includes(args.where.tags.has)) return false;
            if (args.where?.name?.contains) {
              const search = args.where.name.contains.toLowerCase();
              if (!a.name.toLowerCase().includes(search)) return false;
            }
            return true;
          });
          return items.length;
        }),
      },
    },
    store,
  };
}

function createMockEmitter() {
  return { emit: vi.fn() };
}

describe('AssetService', () => {
  it('creates an asset', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    const result = await svc.createAsset({
      businessId: 'biz_1',
      name: 'Hero Image',
      type: 'image',
      url: 'https://cdn.example.com/hero.jpg',
      storageKey: 'hero.jpg',
      uploadedBy: 'user_1',
      tags: ['hero', 'homepage'],
      folder: 'marketing',
    });

    expect(result.id).toBeDefined();
    expect(result.name).toBe('Hero Image');
    expect(result.type).toBe('image');
    expect(result.tags).toContain('hero');
    expect(result.folder).toBe('marketing');
    expect(emitter.emit).toHaveBeenCalledWith('asset.created', expect.any(Object));
  });

  it('lists assets with filters', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    await svc.createAsset({ businessId: 'biz_1', name: 'Image A', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1' });
    await svc.createAsset({ businessId: 'biz_1', name: 'Video B', type: 'video', url: 'u2', storageKey: 's2', uploadedBy: 'u1' });
    await svc.createAsset({ businessId: 'biz_2', name: 'Image C', type: 'image', url: 'u3', storageKey: 's3', uploadedBy: 'u1' });

    const result = await svc.listAssets('biz_1', { type: 'image' });
    expect(result.total).toBe(1);
    expect(result.items[0].name).toBe('Image A');
  });

  it('searches assets by name', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    await svc.createAsset({ businessId: 'biz_1', name: 'Summer Banner', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1' });
    await svc.createAsset({ businessId: 'biz_1', name: 'Winter Promo', type: 'image', url: 'u2', storageKey: 's2', uploadedBy: 'u1' });

    const result = await svc.listAssets('biz_1', { search: 'summer' });
    expect(result.total).toBe(1);
    expect(result.items[0].name).toBe('Summer Banner');
  });

  it('updates an asset', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    const created = await svc.createAsset({
      businessId: 'biz_1', name: 'Old Name', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1',
    });

    const result = await svc.updateAsset(created.id, { name: 'New Name', folder: 'branding' });
    expect(result.name).toBe('New Name');
    expect(result.folder).toBe('branding');
  });

  it('tags an asset', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    const created = await svc.createAsset({
      businessId: 'biz_1', name: 'Asset', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1', tags: ['a'],
    });

    const result = await svc.tagAsset(created.id, ['b', 'c']);
    expect(result.tags).toContain('a');
    expect(result.tags).toContain('b');
    expect(result.tags).toContain('c');
  });

  it('untags an asset', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    const created = await svc.createAsset({
      businessId: 'biz_1', name: 'Asset', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1', tags: ['a', 'b', 'c'],
    });

    const result = await svc.untagAsset(created.id, ['b']);
    expect(result.tags).toContain('a');
    expect(result.tags).not.toContain('b');
    expect(result.tags).toContain('c');
  });

  it('tracks usage', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    const created = await svc.createAsset({
      businessId: 'biz_1', name: 'Asset', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1',
    });

    const result = await svc.trackUsage(created.id, { usedInType: 'ContentRequest', usedInId: 'cr_1' });
    expect(result.usageCount).toBe(1);
  });

  it('deletes an asset', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    const created = await svc.createAsset({
      businessId: 'biz_1', name: 'Asset', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1',
    });

    const result = await svc.deleteAsset(created.id);
    expect(result.success).toBe(true);
  });

  it('gets folders', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    await svc.createAsset({ businessId: 'biz_1', name: 'A', type: 'image', url: 'u1', storageKey: 's1', uploadedBy: 'u1', folder: 'marketing' });
    await svc.createAsset({ businessId: 'biz_1', name: 'B', type: 'image', url: 'u2', storageKey: 's2', uploadedBy: 'u1', folder: 'branding' });
    await svc.createAsset({ businessId: 'biz_1', name: 'C', type: 'image', url: 'u3', storageKey: 's3', uploadedBy: 'u1', folder: 'marketing' });

    const result = await svc.getFolders('biz_1');
    expect(result).toContain('marketing');
    expect(result).toContain('branding');
  });

  it('rejects getting non-existent asset', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new AssetService(prisma as any, emitter as any);

    await expect(svc.getAsset('nonexistent')).rejects.toThrow('Asset not found');
  });
});
