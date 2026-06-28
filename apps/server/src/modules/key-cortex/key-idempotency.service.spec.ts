import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyIdempotencyService } from './key-idempotency.service';

function createMockClient() {
  const rows: any[] = [];
  return {
    rows,
    idempotencyKey: {
      findUnique: vi.fn(async ({ where }: any) => {
        return rows.find(
          (r) =>
            r.businessId === where.businessId_idempotencyKey.businessId &&
            r.idempotencyKey === where.businessId_idempotencyKey.idempotencyKey,
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: 'key_1', createdAt: new Date(), updatedAt: new Date() };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find(
          (r) =>
            r.businessId === where.businessId_idempotencyKey.businessId &&
            r.idempotencyKey === where.businessId_idempotencyKey.idempotencyKey,
        );
        if (!row) throw new Error('Not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
  };
}

describe('KeyIdempotencyService', () => {
  let service: KeyIdempotencyService;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    service = new KeyIdempotencyService({ client } as any);
  });

  it('creates a pending key and returns new for first request', async () => {
    const result = await service.check({
      businessId: 'biz_1',
      idempotencyKey: 'req_1',
      requestHash: 'abc',
    });

    expect(result.status).toBe('new');
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0].status).toBe('pending');
  });

  it('returns completed response for duplicate key', async () => {
    await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    await service.complete({ businessId: 'biz_1', idempotencyKey: 'req_1' }, { id: 'c1' });

    const result = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    expect(result.status).toBe('completed');
    expect(result.response).toEqual({ id: 'c1' });
  });

  it('returns failed error for duplicate failed key', async () => {
    await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    await service.fail({ businessId: 'biz_1', idempotencyKey: 'req_1' }, 'Bad request');

    const result = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Bad request');
  });

  it('treats pending keys as new (last-writer-wins)', async () => {
    await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    const result = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    expect(result.status).toBe('new');
  });
});
