import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyIdempotencyService, fingerprintToolRequest, KEY_IDEMPOTENCY_CLAIM_LEASE_MS } from './key-idempotency.service';
import { runWithTenant } from '../../core/tenant/tenant-context';

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
  const logs: any[] = [];
  let seq = 0;
  const sameKey = (r: any, k: { businessId: string; idempotencyKey: string }) =>
    r.businessId === k.businessId && r.idempotencyKey === k.idempotencyKey;
  const prismaError = (code: string, message: string) => Object.assign(new Error(message), { code });
  const client = {
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
      // W10-CLAIM-LEASE (D-103): the conditional update a takeover is. Every
      // field of the where must match (updatedAt as { lte }), as on the table.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matches = rows.filter((r) =>
          Object.entries(where).every(([field, cond]: [string, any]) =>
            cond && typeof cond === 'object' && 'lte' in cond ? r[field] <= cond.lte : r[field] === cond,
          ),
        );
        for (const r of matches) Object.assign(r, data);
        return { count: matches.length };
      }),
    },
    cortexActionLog: {
      create: vi.fn(async ({ data }: any) => {
        logs.push(data);
        return data;
      }),
    },
    logs,
    // An interactive transaction on the one in-memory table.
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client)),
  };
  return client;
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

  // V1-19b review (SEC-V19b-1): a claimant that failed without throwing keeps
  // its whole answer with the error, so a replay can answer exactly as it did.
  it('fail() keeps the answer it is given with the error, and check() hands both back; without one, the failed answer is the error alone', async () => {
    const holder = await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1' });
    const answer = { success: false, error: 'provider declined', requiresApproval: false };
    expect(await service.fail({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1', claimId: holder.claimId }, 'provider declined', answer)).toBe(true);
    expect(await service.check({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1' })).toEqual({
      status: 'failed',
      error: 'provider declined',
      response: answer,
    });

    await service.check({ businessId: 'biz_1', idempotencyKey: 'req_2' });
    await service.fail({ businessId: 'biz_1', idempotencyKey: 'req_2' }, 'Bad request');
    expect(await service.check({ businessId: 'biz_1', idempotencyKey: 'req_2' })).toStrictEqual({ status: 'failed', error: 'Bad request' });
  });
});

/**
 * W10-CLAIM-LEASE (owner ruling D-103, closing V1-19 review CR-V19-2): a claim
 * still open 15 minutes after it was taken (its claimant crashed before its
 * settle) is taken over by the next check() for the same request, under a new
 * claimId, and the takeover is logged; a finished claim is never run again.
 * The real-DB proof (two concurrent retries, one takeover) is
 * test/key-idempotency-claim.integration.test.ts.
 */
describe('KeyIdempotencyService: the claim lease (D-103, W10-CLAIM-LEASE)', () => {
  const MIN = 60_000;
  let service: KeyIdempotencyService;
  let client: ReturnType<typeof createMockClient>;
  const k = (extra: Record<string, unknown> = {}) => ({ businessId: 'biz_1', idempotencyKey: 'req_1', requestHash: 'h1', ...extra });
  /** Make the open claim look taken `minutes` ago. */
  const age = (minutes: number) => {
    const at = new Date(Date.now() - minutes * MIN);
    Object.assign(client.rows[0], { createdAt: at, updatedAt: at });
  };

  beforeEach(() => {
    client = createMockClient();
    service = new KeyIdempotencyService({ client } as any);
  });

  it('D-103: the lease is a named constant of 15 minutes', () => {
    expect(KEY_IDEMPOTENCY_CLAIM_LEASE_MS).toBe(15 * MIN);
  });

  it('D-103: a claim open 16 minutes is taken over by the next check(): a new claimId, the row kept for the same request, and one log entry naming the old claim and its age', async () => {
    const stranded = await service.check(k());
    age(16);

    const taker = await service.check(k());
    expect(taker).toEqual({ status: 'new', claimId: expect.any(String) });
    expect(taker.claimId).not.toBe(stranded.claimId);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({ id: taker.claimId, status: 'pending', requestHash: 'h1' });
    // The new claim's lease starts now: the next retry is held off.
    expect((await service.check(k())).status).toBe('pending');

    expect(client.logs).toHaveLength(1);
    const [log] = client.logs;
    expect(log).toMatchObject({ businessId: 'biz_1', actionType: 'idempotency.claim_takeover', status: 'success' });
    expect(log.description).toContain(stranded.claimId);
    expect(log.description).toContain('16 min');
    expect(JSON.parse(log.result)).toMatchObject({
      idempotencyKey: 'req_1',
      staleClaimId: stranded.claimId,
      newClaimId: taker.claimId,
      leaseMs: 15 * MIN,
      ruling: 'D-103',
    });
  });

  it('D-103: a claim open 14 minutes is not taken over', async () => {
    const holder = await service.check(k());
    age(14);

    expect(await service.check(k())).toEqual({ status: 'pending', error: expect.any(String) });
    expect(client.rows[0].id).toBe(holder.claimId);
    expect(client.logs).toEqual([]);
  });

  it('D-103: a completed or failed claim, however old, is never re-run: check() answers its stored outcome', async () => {
    const done = await service.check(k());
    await service.complete(k({ claimId: done.claimId }), { id: 'c1' });
    age(60);
    expect(await service.check(k())).toEqual({ status: 'completed', response: { id: 'c1' } });

    const failed = await service.check(k({ idempotencyKey: 'req_2' }));
    await service.fail(k({ idempotencyKey: 'req_2', claimId: failed.claimId }), 'Bad request');
    Object.assign(client.rows[1], { updatedAt: new Date(Date.now() - 60 * MIN) });
    expect(await service.check(k({ idempotencyKey: 'req_2' }))).toEqual({ status: 'failed', error: 'Bad request' });
    expect(client.logs).toEqual([]);
  });

  it("D-103: a stranded claim presented with another request hash is a 'conflict', not taken over", async () => {
    const stranded = await service.check(k());
    age(16);

    expect((await service.check(k({ requestHash: 'h2' }))).status).toBe('conflict');
    expect(client.rows[0].id).toBe(stranded.claimId);
    expect(client.logs).toEqual([]);
  });

  it("D-103: after a takeover the stranded holder's complete(), fail() and release() bind nothing and answer false; the taker settles", async () => {
    const stranded = await service.check(k());
    age(16);
    const taker = await service.check(k());

    expect(await service.complete(k({ claimId: stranded.claimId }), { by: 'stranded' })).toBe(false);
    expect(await service.fail(k({ claimId: stranded.claimId }), 'stranded error')).toBe(false);
    expect(await service.release(k({ claimId: stranded.claimId! }) as any)).toBe(false);
    expect(client.rows[0]).toMatchObject({ status: 'pending', response: null, error: null });

    expect(await service.complete(k({ claimId: taker.claimId }), { by: 'taker' })).toBe(true);
    expect(await service.check(k())).toEqual({ status: 'completed', response: { by: 'taker' } });
  });

  /**
   * W10-CLAIM-LEASE review, SEC-W10CL-1: the takeover's log row named nobody
   * (userId, commandId and correlationId null, the session 'idempotency:<key>',
   * no tool), even when the retry ran inside a member's request, so the D-103
   * takeover could not be tied to who triggered it or to the run it caused.
   */
  it("D-103, SEC-W10CL-1: the takeover's log row names the caller's actor, tool, session, command and correlation", async () => {
    await service.check(k());
    age(16);
    const audit = { actorId: 'user_x', toolName: 'crm.create_contact', sessionId: 'sess_1', commandId: 'cmd_1', correlationId: 'corr_1' };

    const taker = await service.check(k({ audit }));
    expect(taker.status).toBe('new');
    expect(client.logs).toHaveLength(1);
    const [log] = client.logs;
    expect(log).toMatchObject({ userId: 'user_x', sessionId: 'sess_1', commandId: 'cmd_1', correlationId: 'corr_1' });
    expect(log.description).toContain('crm.create_contact');
    expect(log.description).toContain('user_x');
    expect(JSON.parse(log.result)).toMatchObject({ toolName: 'crm.create_contact', actorId: 'user_x', newClaimId: taker.claimId });
  });

  it("D-103, SEC-W10CL-1: a caller naming no actor is attributed to the request's member when the request's tenant is this business, never another business's member", async () => {
    await service.check(k());
    age(16);
    // Inside a member's request in this business, naming no actor (as the chat's bridged tools call).
    await runWithTenant('biz_1', 'user_member', () => service.check(k({ audit: { correlationId: 'corr_2' } })));
    expect(client.logs[0]).toMatchObject({ userId: 'user_member', sessionId: 'corr_2', correlationId: 'corr_2', commandId: null });

    // A request whose tenant is another business names nobody here.
    await service.check(k({ idempotencyKey: 'req_2' }));
    Object.assign(client.rows[1], { updatedAt: new Date(Date.now() - 16 * MIN) });
    await runWithTenant('biz_other', 'user_elsewhere', () => service.check(k({ idempotencyKey: 'req_2' })));
    expect(client.logs[1]).toMatchObject({ userId: null, sessionId: 'idempotency:req_2', commandId: null, correlationId: null });
    expect(JSON.parse(client.logs[1].result)).toMatchObject({ toolName: null, actorId: null });
  });

  it('D-103, SEC-W10CL-1: the attribution never decides the claim: a stranded claim presented with another request stays a conflict whoever retries', async () => {
    const stranded = await service.check(k());
    age(16);
    const answer = await service.check(k({ requestHash: 'h2', audit: { actorId: 'user_x', toolName: 'crm.create_contact' } }));
    expect(answer.status).toBe('conflict');
    expect(client.rows[0].id).toBe(stranded.claimId);
    expect(client.logs).toEqual([]);
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

  // V1-19b review (SEC-V19b-4): the acting user is part of the request, so
  // another member presenting a key is a 'conflict', never this member's replay.
  it('covers the acting user: the same tool and input from another user, or from no user, is another request', () => {
    const ann = fingerprintToolRequest('t', { x: 1 }, 'user_ann');
    expect(fingerprintToolRequest('t', { x: 1 }, 'user_ann')).toBe(ann);
    expect(fingerprintToolRequest('t', { x: 1 }, 'user_bob')).not.toBe(ann);
    expect(fingerprintToolRequest('t', { x: 1 })).not.toBe(ann);
    // No acting user (undefined or null) hashes as the tool and input alone.
    expect(fingerprintToolRequest('t', { x: 1 }, null)).toBe(fingerprintToolRequest('t', { x: 1 }));
    expect(fingerprintToolRequest('t', { x: 1 }, undefined)).toBe(fingerprintToolRequest('t', { x: 1 }));
    // An input field named like the actor is not the actor.
    expect(fingerprintToolRequest('t', { actor: 'user_ann', x: 1 })).not.toBe(fingerprintToolRequest('t', { x: 1 }, 'user_ann'));
  });
});
