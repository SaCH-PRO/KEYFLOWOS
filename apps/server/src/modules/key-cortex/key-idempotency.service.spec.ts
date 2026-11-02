import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyIdempotencyService, fingerprintToolRequest } from './key-idempotency.service';

/**
 * An in-memory idempotency_keys table that keeps the constraints the service
 * relies on (V1-19b): the (business_id, idempotency_key) unique index (a
 * second insert fails with Prisma's P2002, as the real table does), and a
 * filtered unique where on update (no match is Prisma's P2025). The earlier
 * mock had no unique index, which is the only reason its "treats pending keys
 * as new (last-writer-wins)" case passed. The real-DB proof of every rule here
 * is test/key-idempotency-claim.integration.test.ts.
 */
function createMockClient() {
  const rows: any[] = [];
  let seq = 0;
  const sameKey = (r: any, k: { businessId: string; idempotencyKey: string }) =>
    r.businessId === k.businessId && r.idempotencyKey === k.idempotencyKey;
  const prismaError = (code: string, message: string) => Object.assign(new Error(message), { code });
  return {
    rows,
    idempotencyKey: {
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => sameKey(r, where.businessId_idempotencyKey)) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (rows.some((r) => sameKey(r, data))) {
          throw prismaError('P2002', 'Unique constraint failed on the fields: (`business_id`,`idempotency_key`)');
        }
        const row = { response: null, error: null, ...data, id: `key_${++seq}`, createdAt: new Date(), updatedAt: new Date() };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const { businessId_idempotencyKey: k, status, id, OR } = where;
        const row = rows.find((r) => sameKey(r, k));
        const matches =
          !!row &&
          (status === undefined || row.status === status) &&
          (id === undefined || row.id === id) &&
          (OR === undefined || OR.some((c: any) => row.requestHash === c.requestHash));
        if (!matches) throw prismaError('P2025', 'Record to update not found.');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const i = rows.findIndex(
          (r) => sameKey(r, where) && r.id === where.id && r.status === where.status,
        );
        if (i < 0) return { count: 0 };
        rows.splice(i, 1);
        return { count: 1 };
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

  // Was "treats pending keys as new (last-writer-wins)": true only of a mock
  // without the unique index. A key whose claim is still open is answered
  // 'pending' (the insert on the unique index is the claim, V1-19 PRS-M26;
  // real DB: "a check() that arrives after the first claimant inserted, while
  // it is still in flight ... is answered 'pending', not 'new'").
  it("answers 'pending' (not 'new') for a key whose claim is still open, and keeps the one claim row", async () => {
    const first = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    expect(first).toEqual({ status: 'new', claimId: expect.any(String) });

    const result = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1' });
    expect(result.status).toBe('pending');
    expect(result.claimId).toBeUndefined();
    expect(client.rows).toHaveLength(1);
  });

  it('settles by claimId: a settle naming another claim changes nothing, the holder\'s settles it', async () => {
    const holder = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1' });

    expect(await service.complete({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1', claimId: 'key_other' }, { by: 'other' })).toBe(false);
    expect(client.rows[0]).toMatchObject({ status: 'pending', response: null });
    expect(await service.complete({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1', claimId: holder.claimId }, { by: 'holder' })).toBe(true);
    expect(client.rows[0]).toMatchObject({ status: 'completed', response: { by: 'holder' } });
  });

  it("release() frees the holder's open claim, and the next check() is 'new' again", async () => {
    const holder = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1' });

    expect(await service.release({ businessId: 'biz_1', idempotencyKey: 'req_1', claimId: 'key_other' })).toBe(false);
    expect(await service.release({ businessId: 'biz_1', idempotencyKey: 'req_1', claimId: holder.claimId! })).toBe(true);
    expect(client.rows).toHaveLength(0);
    expect((await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1' })).status).toBe('new');
  });
});

/**
 * V1-19b (SEC-V19-3): the request hash the claim compares. It was the tool
 * registry's 32-bit string hash of key-order-sensitive JSON.stringify, which
 * answered '0' for any input it could not serialize.
 */
describe('fingerprintToolRequest', () => {
  it('is a sha256 hex digest, deterministic for one request', () => {
    const a = fingerprintToolRequest('crm.create_contact', { name: 'Ann', tags: ['vip'] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintToolRequest('crm.create_contact', { name: 'Ann', tags: ['vip'] })).toBe(a);
  });

  it("tells apart inputs a 32-bit string hash confuses ({to:'Aa'} and {to:'BB'})", () => {
    expect(fingerprintToolRequest('inbox.send_reply', { to: 'Aa' })).not.toBe(fingerprintToolRequest('inbox.send_reply', { to: 'BB' }));
  });

  it('ignores the order of object keys, at every depth', () => {
    expect(fingerprintToolRequest('t', { a: 1, b: { c: 2, d: [{ e: 3, f: 4 }] } })).toBe(
      fingerprintToolRequest('t', { b: { d: [{ f: 4, e: 3 }], c: 2 }, a: 1 }),
    );
  });

  it('keeps array order and value types', () => {
    expect(fingerprintToolRequest('t', { ids: [1, 2] })).not.toBe(fingerprintToolRequest('t', { ids: [2, 1] }));
    expect(fingerprintToolRequest('t', { n: 1 })).not.toBe(fingerprintToolRequest('t', { n: '1' }));
  });

  it('covers the tool name: the same input for another tool is another request', () => {
    expect(fingerprintToolRequest('a.tool', { x: 1 })).not.toBe(fingerprintToolRequest('b.tool', { x: 1 }));
  });

  it('fingerprints the JSON form of the request: a Date is its ISO string, an undefined field is absent', () => {
    expect(fingerprintToolRequest('t', { at: new Date('2026-11-02T10:00:00.000Z') })).toBe(
      fingerprintToolRequest('t', { at: '2026-11-02T10:00:00.000Z' }),
    );
    expect(fingerprintToolRequest('t', { at: new Date('2026-11-02T10:00:00.000Z') })).not.toBe(
      fingerprintToolRequest('t', { at: new Date('2027-11-02T10:00:00.000Z') }),
    );
    expect(fingerprintToolRequest('t', { a: 1, b: undefined })).toBe(fingerprintToolRequest('t', { a: 1 }));
  });

  it('throws for an input with no JSON form, rather than answering one shared hash for all of them', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => fingerprintToolRequest('t', circular)).toThrow(/cannot be fingerprinted/);
    expect(() => fingerprintToolRequest('t', { n: BigInt(1) })).toThrow(/cannot be fingerprinted/);
  });
});
