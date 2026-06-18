import { describe, expect, it, vi } from 'vitest';
import { BusinessAssetsController } from './business-assets.controller';
import { BusinessAssetsService } from './business-assets.service';

describe('BusinessAssetsController', () => {
  function createMockService(): BusinessAssetsService {
    return {
      list: vi.fn(async () => [{ id: 'ba_1', name: 'keyflowos.com', type: 'DOMAIN' }]),
      create: vi.fn(async (_businessId, input) => ({ id: 'ba_2', ...input, createdAt: new Date() })),
      update: vi.fn(async (_businessId, assetId, data) => ({ id: assetId, ...data, createdAt: new Date() })),
      remove: vi.fn(async () => undefined),
      summarizeForGenome: vi.fn(async () => ({ total: 1, byType: { DOMAIN: 1 }, risks: [] })),
    } as any;
  }

  it('lists assets', async () => {
    const svc = createMockService();
    const ctrl = new BusinessAssetsController(svc);

    const result = await ctrl.list('biz_1');
    expect(result).toHaveLength(1);
    expect(svc.list).toHaveBeenCalledWith('biz_1');
  });

  it('returns summary', async () => {
    const svc = createMockService();
    const ctrl = new BusinessAssetsController(svc);

    const result = await ctrl.summary('biz_1');
    expect(result.total).toBe(1);
    expect(svc.summarizeForGenome).toHaveBeenCalledWith('biz_1');
  });

  it('creates an asset', async () => {
    const svc = createMockService();
    const ctrl = new BusinessAssetsController(svc);

    const result = await ctrl.create('biz_1', {
      type: 'DOMAIN',
      name: 'keyflowos.com',
    } as any);

    expect(result.id).toBe('ba_2');
    expect(svc.create).toHaveBeenCalledWith('biz_1', expect.objectContaining({ type: 'DOMAIN', name: 'keyflowos.com' }));
  });

  it('updates an asset', async () => {
    const svc = createMockService();
    const ctrl = new BusinessAssetsController(svc);

    const result = await ctrl.update('biz_1', 'ba_1', { name: 'New name' } as any);
    expect(result.id).toBe('ba_1');
    expect(svc.update).toHaveBeenCalledWith('biz_1', 'ba_1', { name: 'New name' });
  });

  it('removes an asset', async () => {
    const svc = createMockService();
    const ctrl = new BusinessAssetsController(svc);

    const result = await ctrl.remove('biz_1', 'ba_1');
    expect(result.deleted).toBe(true);
    expect(svc.remove).toHaveBeenCalledWith('biz_1', 'ba_1');
  });
});
