/**
 * V1-19-KEY-IDEMPOTENCY-CLAIM: KeyIdempotencyService.check is a claim
 * (REAL database). #174 KEY-04, PRS-M26.
 *
 * KeyIdempotencyService.check() decides whether a KEY action runs. The only
 * production caller is KeyCortexToolRegistryService.execute (its Phase 0
 * idempotency gate), which runs the tool unless check() reports 'completed' or
 * 'failed'. Read from the V1-10 head (key-idempotency.service.ts:32-51, 68-69):
 *   - check() was read-then-insert: findUnique, then create when absent. Two
 *     callers that both read before either inserted both took the create
 *     branch; the loser's INSERT hit the (business_id, idempotency_key) unique
 *     index and surfaced as a raw Prisma P2002 out of check().
 *   - a key found 'pending' (a claimant still in flight) was answered 'new'
 *     ("last-writer-wins"), so any caller that read after the first insert
 *     was told to run the action too.
 *   - the stored request_hash was written and never compared: the same key
 *     presented with a different request was answered with the first
 *     request's stored response (or error).
 *
 * Required, and pinned here: the insert on the unique index is the claim.
 * However many callers race for one key, exactly one is answered 'new'; every
 * other caller, concurrent or later, is answered 'pending' while that claim is
 * open, and none is answered with an error. A key presented with a request
 * hash different from the stored one is answered 'conflict' (never the stored
 * response or error, never 'new'). The replays that worked keep working
 * (regression controls): 'completed' with the stored response, 'failed' with
 * the stored error, a key with no hash on either side replays, and the same key
 * in another business is a different key.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL (the
 * tenant-scope extension included: idempotency_keys is a tenant-scoped model),
 * KeyIdempotencyService, the idempotency_keys rows and their unique index.
 * Nothing is stood in.
 *
 * Every seeded row carries the `v19a_` prefix (business ids, user ids and
 * emails, idempotency keys) and is hard-deleted by raw SQL with
 * sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v19a_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  otherBiz: `${P}biz_other`,
};

let db: any;
let app: any;
let service: any;
let tenant: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)} OR idempotency_key LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** A fresh key for one case, embedding the prefix. */
let keySeq = 0;
const freshKey = (label: string) => `${P}${label}_${++keySeq}`;

const req = (idempotencyKey: string, requestHash?: string, businessId = ID.biz) => ({
  businessId,
  idempotencyKey,
  ...(requestHash !== undefined ? { requestHash } : {}),
});

const rowsFor = (businessId: string, idempotencyKey: string) =>
  db.idempotencyKey.findMany({
    where: { businessId, idempotencyKey },
    select: { status: true, requestHash: true, response: true, error: true },
  });

/** Settle every call; what each one answered, or the error it threw, in call order. */
async function race<T>(calls: Array<() => Promise<T>>) {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return settled.map((s) =>
    s.status === 'fulfilled'
      ? { answer: s.value as any, error: undefined as unknown }
      : { answer: undefined as any, error: s.reason as unknown },
  );
}

const describeError = (e: unknown) =>
  e instanceof Error ? `${(e as any).code ?? e.name}: ${e.message.split('\n').slice(-1)[0]}` : String(e);

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves (no request scope here, so no tenant is ambient).
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { KeyIdempotencyService } = await import('../src/modules/key-cortex/key-idempotency.service');

  const moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      {
        // A factory, as V1-10's suite wires its services: vitest compiles
        // without decorator metadata, so constructor injection by type is not
        // available here.
        provide: KeyIdempotencyService,
        useFactory: (prisma: any) => new KeyIdempotencyService(prisma),
        inject: [PrismaService],
      },
    ],
  }).compile();
  app = moduleRef;
  await app.init();
  service = moduleRef.get(KeyIdempotencyService);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V19A Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V19A Other Biz', ownerId: ID.owner } });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('both businesses exist and no idempotency key of this suite is on record yet', async () => {
    expect(await db.business.count({ where: { id: { in: [ID.biz, ID.otherBiz] } } })).toBe(2);
    expect(await db.idempotencyKey.count({ where: { businessId: { in: [ID.biz, ID.otherBiz] } } })).toBe(0);
  });
});

/**
 * PRS-M26 (#174 KEY-04). check() was read-then-insert, and a pending key was
 * answered 'new'. Required: the INSERT on the unique index is the claim.
 */
describe('check() is a claim: one caller is told to run, every other is told the claim is open (PRS-M26)', () => {
  it("two concurrent check() calls with the same businessId and key: exactly one is answered 'new', the other 'pending', neither throws, and one pending row holds the key", async () => {
    const key = freshKey('pair');
    const results = await race([
      () => service.check(req(key, 'hash_a')),
      () => service.check(req(key, 'hash_a')),
    ]);

    expect(results.map((r) => (r.error ? `threw ${describeError(r.error)}` : null))).toEqual([null, null]);
    expect(results.map((r) => r.answer.status).sort()).toEqual(['new', 'pending']);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: 'hash_a', response: null, error: null }]);
  });

  it("eight concurrent check() calls for one key: exactly one 'new', seven 'pending', none throws", async () => {
    const key = freshKey('herd');
    const results = await race(Array.from({ length: 8 }, () => () => service.check(req(key, 'hash_h'))));

    expect(results.filter((r) => r.error).map((r) => describeError(r.error))).toEqual([]);
    const statuses = results.map((r) => r.answer.status);
    expect(statuses.filter((s) => s === 'new')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(7);
    expect(await db.idempotencyKey.count({ where: { businessId: ID.biz, idempotencyKey: key } })).toBe(1);
  });

  it("a check() that arrives after the first claimant inserted, while it is still in flight (the key is pending), is answered 'pending', not 'new'", async () => {
    const key = freshKey('late');
    expect((await service.check(req(key, 'hash_l'))).status).toBe('new');

    const late = await service.check(req(key, 'hash_l'));
    expect(late.status).toBe('pending');
    // Without a hash on the late caller, there is nothing to compare: still the open claim.
    expect((await service.check(req(key))).status).toBe('pending');
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: 'hash_l', response: null, error: null }]);
  });

  it("inside a tenant context (as the tool registry runs in a request), two concurrent check() calls still yield exactly one 'new' and one 'pending'", async () => {
    const key = freshKey('tenant');
    const results = await tenant.runWithTenant(ID.biz, ID.owner, () =>
      race([
        () => service.check(req(key, 'hash_t')),
        () => service.check(req(key, 'hash_t')),
      ]),
    );

    expect(results.map((r: any) => (r.error ? `threw ${describeError(r.error)}` : null))).toEqual([null, null]);
    expect(results.map((r: any) => r.answer.status).sort()).toEqual(['new', 'pending']);
    expect(await db.idempotencyKey.count({ where: { businessId: ID.biz, idempotencyKey: key } })).toBe(1);
  });

  it('regression control: the same key in another business is a different key (each business gets its own claim)', async () => {
    const key = freshKey('two_biz');
    const [a, b] = await Promise.all([
      service.check(req(key, 'hash_x', ID.biz)),
      service.check(req(key, 'hash_x', ID.otherBiz)),
    ]);
    expect([a.status, b.status]).toEqual(['new', 'new']);
    expect(await rowsFor(ID.otherBiz, key)).toEqual([{ status: 'pending', requestHash: 'hash_x', response: null, error: null }]);
  });
});

/**
 * PRS-M26: the stored request_hash was never compared. Required: a key
 * presented with a different request hash is a conflict, whatever state the
 * key is in, and the stored outcome is not handed to the other request.
 */
describe('check() compares the request hash: a reused key with a different request is a conflict (PRS-M26)', () => {
  it("the same key with a different requestHash after complete() is answered 'conflict', without the stored response; the stored row is unchanged", async () => {
    const key = freshKey('hash_completed');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');
    await service.complete(req(key, 'hash_1'), { ticketId: 't_1' });

    const other = await service.check(req(key, 'hash_2'));
    expect(other.status).toBe('conflict');
    expect(other.response).toBeUndefined();
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'completed', requestHash: 'hash_1', response: { ticketId: 't_1' }, error: null }]);
  });

  it("the same key with a different requestHash after fail() is answered 'conflict', not the stored error", async () => {
    const key = freshKey('hash_failed');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');
    await service.fail(req(key, 'hash_1'), 'v19a: provider said no');

    const other = await service.check(req(key, 'hash_2'));
    expect(other.status).toBe('conflict');
    expect(other.error).not.toBe('v19a: provider said no');
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'failed', requestHash: 'hash_1', response: null, error: 'v19a: provider said no' }]);
  });

  it("the same key with a different requestHash while the first claim is open is answered 'conflict', not 'new' or 'pending'", async () => {
    const key = freshKey('hash_pending');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');

    expect((await service.check(req(key, 'hash_2'))).status).toBe('conflict');
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: 'hash_1', response: null, error: null }]);
  });

  it("two concurrent check() calls for one key with different hashes: one is 'new', the other 'conflict'", async () => {
    const key = freshKey('hash_race');
    const results = await race([
      () => service.check(req(key, 'hash_1')),
      () => service.check(req(key, 'hash_2')),
    ]);

    expect(results.map((r) => (r.error ? `threw ${describeError(r.error)}` : null))).toEqual([null, null]);
    expect(results.map((r) => r.answer.status).sort()).toEqual(['conflict', 'new']);
    expect(await db.idempotencyKey.count({ where: { businessId: ID.biz, idempotencyKey: key } })).toBe(1);
  });
});

/** What worked before keeps working. */
describe('regression controls: replays of a settled key', () => {
  it("check() after complete() with the same requestHash returns 'completed' and the stored response", async () => {
    const key = freshKey('replay_completed');
    expect((await service.check(req(key, 'hash_r'))).status).toBe('new');
    await service.complete(req(key, 'hash_r'), { ticketId: 't_9', ok: true });

    expect(await service.check(req(key, 'hash_r'))).toEqual({ status: 'completed', response: { ticketId: 't_9', ok: true } });
  });

  it("check() after fail() with the same requestHash returns 'failed' and the stored error", async () => {
    const key = freshKey('replay_failed');
    expect((await service.check(req(key, 'hash_r'))).status).toBe('new');
    await service.fail(req(key, 'hash_r'), 'v19a: deterministic error');

    expect(await service.check(req(key, 'hash_r'))).toEqual({ status: 'failed', error: 'v19a: deterministic error' });
  });

  it('a key stored without a hash, or presented without one, replays (there is nothing to compare)', async () => {
    const noHash = freshKey('replay_nohash');
    expect((await service.check(req(noHash))).status).toBe('new');
    await service.complete(req(noHash), { id: 'n_1' });
    expect(await service.check(req(noHash, 'hash_late'))).toEqual({ status: 'completed', response: { id: 'n_1' } });

    const hashed = freshKey('replay_hashed');
    expect((await service.check(req(hashed, 'hash_s'))).status).toBe('new');
    await service.complete(req(hashed, 'hash_s'), { id: 'n_2' });
    expect(await service.check(req(hashed))).toEqual({ status: 'completed', response: { id: 'n_2' } });
  });
});

/**
 * Outside this packet's write set (key-cortex-tool-registry.service.ts is not
 * in it). The registry's Phase 0 gate (key-cortex-tool-registry.service.ts:
 * 293-305) returns early only for 'completed' and 'failed'; any other answer,
 * including the 'pending' and 'conflict' this packet adds, falls through and
 * runs the tool. Until the registry refuses them, the claim above does not by
 * itself stop a duplicate tool call. Follow-up fix packet.
 */
describe('the consumer of the claim (follow-up, outside the V1-19 write set)', () => {
  it.todo("KeyCortexToolRegistryService.execute refuses a 'pending' or 'conflict' answer instead of running the tool (key-cortex-tool-registry.service.ts:299-304 falls through on any status other than completed/failed)");
});
