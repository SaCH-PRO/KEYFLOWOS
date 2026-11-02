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
 * V1-19 review repairs, pinned here too:
 *   - SEC-V19-1: complete() and fail() updated on (business_id, key) alone, so
 *     a caller answered 'conflict' or 'pending' could overwrite the holder's
 *     stored outcome, and a settled row could be settled again (leaving a row
 *     that was half one outcome, half the other). Required: a settle writes
 *     only the open claim, for the caller's request hash and claimId when it
 *     presents them, and answers whether it settled it. check() hands the
 *     claimant its claimId with 'new'.
 *   - CR-V19-2: nothing released a claim, so a claimant that decided not to
 *     run held the key for good. Required: release(claimId) frees an open
 *     claim, for its claimant only, and the next check() is 'new' again.
 *   - SEC-V19-2 / CR-V19-1, through the only consumer (the real
 *     KeyCortexToolRegistryService.execute): a request answered 'conflict' or
 *     'pending' no longer rewrites the holder's stored outcome. The registry
 *     still runs the tool on those answers: that, its claimId and release
 *     wiring, and its request hash (SEC-V19-3) are outside this write set and
 *     kept as it.todo at the end.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL (the
 * tenant-scope extension included: idempotency_keys is a tenant-scoped model),
 * KeyIdempotencyService, the idempotency_keys rows and their unique index;
 * in the consumer cases, KeyCortexToolRegistryService (execute, its Phase 0
 * gate, its request hash, its audit and score writes). Stand-ins there only:
 * the autonomy safety service (allows, records nothing) and the saga service
 * (unused: no sagaId), and the registered tool, which counts its runs.
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
let registry: any;

/** The consumer cases' tool: each run it performed, and how long a run takes. */
const TOOL = 'v19a.create_ticket';
const toolRuns: Array<Record<string, unknown>> = [];
const toolDelay = { ms: 0 };

async function cleanup() {
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)} OR idempotency_key LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cortex_action_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM tool_outcome_scores WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

  // The only production consumer of the claim, constructed as Nest would (positionally).
  const { KeyCortexToolRegistryService } = await import('../src/modules/key-cortex/key-cortex-tool-registry.service');
  const safety = { check: async () => ({ allowed: true }), recordExecution: async () => undefined };
  const saga = {};
  registry = new KeyCortexToolRegistryService(moduleRef.get(PrismaService), safety as any, service, saga as any);
  registry.register({
    name: TOOL,
    module: 'v19a',
    description: 'v19a: records each run (the external effect counted here)',
    parameters: { type: 'object', properties: {}, required: [] },
    riskTier: 1,
    requiresApproval: false,
    handler: async (_ctx: any, input: Record<string, unknown>) => {
      toolRuns.push(input);
      if (toolDelay.ms) await new Promise((r) => setTimeout(r, toolDelay.ms));
      return { success: true, data: { ticket: input.title, run: toolRuns.length } };
    },
  });

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
 * V1-19 review, SEC-V19-1. complete() and fail() updated on (business_id, key)
 * alone. Measured before this repair: check(h1) 'new'; complete({owner:'A'});
 * check(h2) 'conflict'; complete({owner:'B'}) overwrote the row, and a replay
 * of h1 returned {owner:'B'}. And a 'pending' loser's fail() followed by the
 * holder's complete() left {status:'completed', error:<loser's>, response:A}.
 */
describe('complete() and fail() settle only the open claim, and say whether they did (V1-19 review, SEC-V19-1)', () => {
  it("a caller answered 'conflict' cannot overwrite a settled outcome: its complete() answers false, the row is unchanged, and the original request still replays its own outcome", async () => {
    const key = freshKey('settle_conflict');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');
    expect(await service.complete(req(key, 'hash_1'), { owner: 'A' })).toBe(true);

    expect((await service.check(req(key, 'hash_2'))).status).toBe('conflict');
    expect(await service.complete(req(key, 'hash_2'), { owner: 'B' })).toBe(false);
    // As the tool registry settles today: no hash and no claimId.
    expect(await service.complete(req(key), { owner: 'B' })).toBe(false);
    expect(await service.fail(req(key), 'v19a: loser error')).toBe(false);

    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'completed', requestHash: 'hash_1', response: { owner: 'A' }, error: null }]);
    expect(await service.check(req(key, 'hash_1'))).toEqual({ status: 'completed', response: { owner: 'A' } });
  });

  it('a settled key is never settled again: fail() after complete() and complete() after fail() answer false and change nothing', async () => {
    const done = freshKey('settle_twice_c');
    expect((await service.check(req(done, 'hash_1'))).status).toBe('new');
    expect(await service.complete(req(done, 'hash_1'), { owner: 'A' })).toBe(true);
    expect(await service.fail(req(done, 'hash_1'), 'v19a: late error')).toBe(false);
    expect(await service.complete(req(done, 'hash_1'), { owner: 'again' })).toBe(false);
    expect(await rowsFor(ID.biz, done)).toEqual([{ status: 'completed', requestHash: 'hash_1', response: { owner: 'A' }, error: null }]);

    const failed = freshKey('settle_twice_f');
    expect((await service.check(req(failed, 'hash_1'))).status).toBe('new');
    expect(await service.fail(req(failed, 'hash_1'), 'v19a: first error')).toBe(true);
    expect(await service.complete(req(failed, 'hash_1'), { owner: 'late' })).toBe(false);
    expect(await rowsFor(ID.biz, failed)).toEqual([{ status: 'failed', requestHash: 'hash_1', response: null, error: 'v19a: first error' }]);
  });

  it("while the claim is open, a caller presenting a different request hash cannot settle it; the holder then settles it alone", async () => {
    const key = freshKey('settle_open_conflict');
    const holder = await service.check(req(key, 'hash_1'));
    expect(holder.status).toBe('new');
    expect((await service.check(req(key, 'hash_2'))).status).toBe('conflict');

    expect(await service.fail(req(key, 'hash_2'), 'v19a: loser error')).toBe(false);
    expect(await service.complete(req(key, 'hash_2'), { owner: 'B' })).toBe(false);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: 'hash_1', response: null, error: null }]);

    expect(await service.complete({ ...req(key, 'hash_1'), claimId: holder.claimId }, { owner: 'A' })).toBe(true);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'completed', requestHash: 'hash_1', response: { owner: 'A' }, error: null }]);
  });

  it("check() hands the claimId to the claimant only; with it, complete()/fail() settle that claim and no other: a settle naming another claim changes nothing", async () => {
    const key = freshKey('settle_claim');
    const holder = await service.check(req(key, 'hash_1'));
    expect(holder).toEqual({ status: 'new', claimId: expect.any(String) });
    const loser = await service.check(req(key, 'hash_1'));
    expect(loser.status).toBe('pending');
    expect(loser.claimId).toBeUndefined();

    expect(await service.fail({ ...req(key, 'hash_1'), claimId: `${P}not_the_claim` }, 'v19a: loser error')).toBe(false);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: 'hash_1', response: null, error: null }]);
    expect(await service.complete({ ...req(key, 'hash_1'), claimId: holder.claimId }, { owner: 'A' })).toBe(true);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'completed', requestHash: 'hash_1', response: { owner: 'A' }, error: null }]);
  });

  it('settles are serialized on the row: of eight concurrent complete()/fail() calls on one open claim, exactly one answers true, and the row holds that one outcome only', async () => {
    const key = freshKey('settle_race');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');
    const results = await race(
      Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0
          ? () => service.complete(req(key, 'hash_1'), { owner: `c${i}` })
          : () => service.fail(req(key, 'hash_1'), `v19a: f${i}`),
      ),
    );

    expect(results.filter((r) => r.error).map((r) => describeError(r.error))).toEqual([]);
    const winners = results.map((r, i) => (r.answer === true ? i : -1)).filter((i) => i >= 0);
    expect(winners).toHaveLength(1);
    const w = winners[0];
    expect(await rowsFor(ID.biz, key)).toEqual([
      w % 2 === 0
        ? { status: 'completed', requestHash: 'hash_1', response: { owner: `c${w}` }, error: null }
        : { status: 'failed', requestHash: 'hash_1', response: null, error: `v19a: f${w}` },
    ]);
  });

  it("the reviewer's 'pending' loser sequence, without claimIds (as the registry settles today): the first settle wins whole, the second answers false, and no row is left half one outcome and half the other", async () => {
    const key = freshKey('settle_loser');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('pending');

    // Without a claimId a same-request caller cannot be told from the claimant
    // (the registry passing claimId is the follow-up, it.todo below).
    expect(await service.fail(req(key, 'hash_1'), 'v19a: loser error')).toBe(true);
    expect(await service.complete(req(key, 'hash_1'), { owner: 'A' })).toBe(false);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'failed', requestHash: 'hash_1', response: null, error: 'v19a: loser error' }]);
  });
});

/**
 * V1-19 review, CR-V19-2. Before V1-19 an unsettled 'pending' key could be
 * claimed again; with the claim it is held until settled, and nothing let a
 * claimant that decided not to run (refused, sent for approval) give it up.
 */
describe('release() gives an open claim up, for its claimant only (V1-19 review, CR-V19-2)', () => {
  it("the claimant releases with its claimId: the row is gone, and the next check() is answered 'new' (a retry reaches the action again)", async () => {
    const key = freshKey('release');
    const holder = await service.check(req(key, 'hash_1'));
    expect(holder.status).toBe('new');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('pending');

    expect(await service.release({ ...req(key, 'hash_1'), claimId: holder.claimId })).toBe(true);
    expect(await rowsFor(ID.biz, key)).toEqual([]);

    const retry = await service.check(req(key, 'hash_1'));
    expect(retry).toEqual({ status: 'new', claimId: expect.any(String) });
    expect(retry.claimId).not.toBe(holder.claimId);
    // The released claim's id settles nothing now: the key belongs to the retry.
    expect(await service.complete({ ...req(key, 'hash_1'), claimId: holder.claimId }, { owner: 'stale' })).toBe(false);
    expect(await service.complete({ ...req(key, 'hash_1'), claimId: retry.claimId }, { owner: 'retry' })).toBe(true);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'completed', requestHash: 'hash_1', response: { owner: 'retry' }, error: null }]);
  });

  it("a release naming any other claim frees nothing: the holder's claim stays open", async () => {
    const key = freshKey('release_other');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');

    expect(await service.release({ ...req(key, 'hash_1'), claimId: `${P}not_the_claim` })).toBe(false);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: 'hash_1', response: null, error: null }]);
    expect((await service.check(req(key, 'hash_1'))).status).toBe('pending');
  });

  it('a settled key is never released: its stored outcome still replays', async () => {
    const key = freshKey('release_settled');
    const holder = await service.check(req(key, 'hash_1'));
    expect(await service.complete({ ...req(key, 'hash_1'), claimId: holder.claimId }, { owner: 'A' })).toBe(true);

    expect(await service.release({ ...req(key, 'hash_1'), claimId: holder.claimId })).toBe(false);
    expect(await service.check(req(key, 'hash_1'))).toEqual({ status: 'completed', response: { owner: 'A' } });
  });

  it("a claimId of this business's key releases nothing in another business", async () => {
    const key = freshKey('release_two_biz');
    const mine = await service.check(req(key, 'hash_1', ID.biz));
    expect((await service.check(req(key, 'hash_1', ID.otherBiz))).status).toBe('new');

    expect(await service.release({ ...req(key, 'hash_1', ID.otherBiz), claimId: mine.claimId })).toBe(false);
    expect(await rowsFor(ID.otherBiz, key)).toEqual([{ status: 'pending', requestHash: 'hash_1', response: null, error: null }]);
  });
});

/**
 * SEC-V19-2 / CR-V19-1, through the only consumer: the real
 * KeyCortexToolRegistryService.execute and its Phase 0 gate. Measured before
 * this repair (same sequence): the conflicting request ran and its complete()
 * rewrote the stored row, so a replay of the ORIGINAL request returned the
 * other request's result. What the service repair guarantees there is pinned
 * as required; what is still the registry's (it runs the tool on 'conflict' and
 * 'pending') is pinned as observed, and is the it.todo below.
 */
describe('through the only consumer, KeyCortexToolRegistryService.execute (V1-19 review, SEC-V19-2 / CR-V19-1)', () => {
  const ctxFor = (idempotencyKey: string) => ({ businessId: ID.biz, userId: ID.owner, autonomyLevel: 2, idempotencyKey });
  const runsOf = (title: string) => toolRuns.filter((r) => r.title === title).length;

  it("a reused key with a different input does not rewrite the stored outcome: replaying the original request returns the original outcome, and does not run the tool", async () => {
    const key = freshKey('registry_reuse');
    const first = await registry.execute(TOOL, ctxFor(key), { title: `${key}_A` });
    expect(first).toMatchObject({ success: true, data: { ticket: `${key}_A` } });

    const other = await registry.execute(TOOL, ctxFor(key), { title: `${key}_B` });
    const replay = await registry.execute(TOOL, ctxFor(key), { title: `${key}_A` });

    // The registry stores the whole tool result and replays it as `data`.
    expect(replay).toEqual({ success: true, data: first });
    expect(runsOf(`${key}_A`)).toBe(1);
    const [row] = await rowsFor(ID.biz, key);
    expect(row).toMatchObject({ status: 'completed', response: first });

    // Observed, the registry's part (follow-up, it.todo below): the 'conflict'
    // answer falls through its Phase 0 gate and the tool runs for B.
    expect(other).toMatchObject({ success: true, data: { ticket: `${key}_B` } });
    expect(runsOf(`${key}_B`)).toBe(1);
  });

  it('two concurrent identical calls: the stored outcome is settled once, by one of them, and a replay returns it without running the tool', async () => {
    const key = freshKey('registry_race');
    const title = `${key}_T`;
    const settles: boolean[] = [];
    const complete = service.complete.bind(service);
    service.complete = async (...args: any[]) => {
      const settled = await complete(...args);
      settles.push(settled);
      return settled;
    };
    toolDelay.ms = 300;
    let results: any[];
    try {
      results = await Promise.all([
        registry.execute(TOOL, ctxFor(key), { title }),
        registry.execute(TOOL, ctxFor(key), { title }),
      ]);
    } finally {
      toolDelay.ms = 0;
      delete service.complete;
    }

    expect(settles.sort()).toEqual([false, true]);
    const [row] = await rowsFor(ID.biz, key);
    expect(row.status).toBe('completed');
    expect(results).toContainEqual(row.response);
    const runsBeforeReplay = runsOf(title);
    expect(await registry.execute(TOOL, ctxFor(key), { title })).toEqual({ success: true, data: row.response });
    expect(runsOf(title)).toBe(runsBeforeReplay);

    // Observed, the registry's part (follow-up, it.todo below): the 'pending'
    // answer falls through its Phase 0 gate, so both concurrent calls ran.
    expect(runsBeforeReplay).toBe(2);
  });
});

/**
 * Outside this packet's write set (key-cortex-tool-registry.service.ts is not
 * in it): follow-up fix packet. The service side each needs is in place above
 * (statuses, claimId, release, claim-bound settles).
 */
describe('the consumer of the claim (follow-up, outside the V1-19 write set)', () => {
  it.todo("KeyCortexToolRegistryService.execute refuses a 'pending' or 'conflict' answer instead of running the tool (key-cortex-tool-registry.service.ts:299-304 falls through on any status other than completed/failed; SEC-V19-2 / CR-V19-1: today a concurrent duplicate and every retry of a conflicting request run the tool, observed above). #174 KEY-04 is not closed until this lands, and this service change should not land apart from it");
  it.todo("KeyCortexToolRegistryService.execute passes the claimId check() answered to complete()/fail() (registry lines 426-430 and 460-464 pass neither claimId nor requestHash), so a caller answered 'pending' cannot settle the holder's claim (SEC-V19-1, the 'pending' loser case above)");
  it.todo("KeyCortexToolRegistryService.execute releases its claim (release with the claimId) on every path that returns without running the tool: the safety block (line 326), the validation failure (331), the approval proposal and risk refusal (353-363), and a handler's notExecuted answer (391-397); otherwise, once 'pending' is refused, an approved re-execution under the same key is refused for good (CR-V19-2; key-cortex-tool-registry.not-executed.spec.ts:74 'a retry must reach the handler again'). A claim stranded by a crash between check() and settle still needs a lease or abandon rule (a design decision, not made here)");
  it.todo("KeyCortexToolRegistryService.hashRequest is a collision-resistant fingerprint (sha256 over canonical JSON, as the action boundary fingerprints) instead of a 32-bit string hash of key-order-sensitive JSON.stringify that answers '0' for any input it cannot serialize: requests it hashes alike are one request to the claim (SEC-V19-3: {to:'Aa'} and {to:'BB'} both hash to 6db9e4d5)");
});
