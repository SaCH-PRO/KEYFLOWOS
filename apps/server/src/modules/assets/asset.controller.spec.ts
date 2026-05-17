import { describe, expect, it, vi } from 'vitest';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

describe('AssetController', () => {
  function createMockService(): AssetService {
    return {
      createAsset: vi.fn(async (input) => ({ id: 'a_1', ...input, createdAt: new Date() })),
      getAsset: vi.fn(async (id) => ({ id, businessId: 'biz_1', name: 'Asset', type: 'image', createdAt: new Date() })),
      listAssets: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 50 })),
      updateAsset: vi.fn(async (id, data) => ({ id, ...data, createdAt: new Date() })),
      tagAsset: vi.fn(async (id, tags) => ({ id, tags, createdAt: new Date() })),
      untagAsset: vi.fn(async (id, tags) => ({ id, tags: [], createdAt: new Date() })),
      trackUsage: vi.fn(async (id) => ({ id, usageCount: 1, createdAt: new Date() })),
      deleteAsset: vi.fn(async () => ({ success: true })),
      getFolders: vi.fn(async () => ['marketing', 'branding']),
    } as any;
  }

  it('creates an asset', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.create('biz_1', {
      businessId: 'biz_1',
      name: 'Hero',
      type: 'image',
      url: 'https://cdn.example.com/hero.jpg',
      storageKey: 'hero.jpg',
      uploadedBy: 'user_1',
    } as any, { user: { id: 'user_1' } } as any);

    expect(result.businessId).toBe('biz_1');
    expect(svc.createAsset).toHaveBeenCalled();
  });

  it('lists assets', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.list('biz_1', {} as any);
    expect(result.total).toBe(0);
    expect(svc.listAssets).toHaveBeenCalledWith('biz_1', expect.any(Object));
  });

  it('gets asset by id', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.getById('a_1');
    expect(result.id).toBe('a_1');
  });

  it('updates an asset', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.update('a_1', { name: 'New' });
    expect(svc.updateAsset).toHaveBeenCalledWith('a_1', { name: 'New' });
  });

  it('tags an asset', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.tag('a_1', { tags: ['hero'] });
    expect(svc.tagAsset).toHaveBeenCalledWith('a_1', ['hero']);
  });

  it('untags an asset', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.untag('a_1', { tags: ['old'] });
    expect(svc.untagAsset).toHaveBeenCalledWith('a_1', ['old']);
  });

  it('tracks usage', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.trackUsage('a_1', { usedInType: 'ContentRequest', usedInId: 'cr_1' });
    expect(svc.trackUsage).toHaveBeenCalledWith('a_1', { usedInType: 'ContentRequest', usedInId: 'cr_1' });
  });

  it('deletes an asset', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.delete('a_1');
    expect(result.success).toBe(true);
  });

  it('gets folders', async () => {
    const svc = createMockService();
    const ctrl = new AssetController(svc);

    const result = await ctrl.getFolders('biz_1');
    expect(result).toContain('marketing');
  });
});
