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
 *     'pending' no longer rewrites the holder's stored outcome.
 *
 * V1-19b-KEY-IDEMPOTENCY-REGISTRY, the registry half (the V1-19 it.todo cases,
 * now real). Measured on the V1-19 head through the real registry: a pending
 * or conflicting key ran the tool (runs=2 for one key); complete()/fail() got
 * neither claimId nor requestHash, so a same-hash 'pending' loser could settle
 * first; release() existed and the registry never called it, so every no-run
 * path left its claim open for good; the request hash was the registry's
 * 32-bit string hash of key-order-sensitive JSON ({to:'Aa'} and {to:'BB'} hash
 * alike, {a,b} and {b,a} do not, and anything it cannot serialize hashes '0').
 * Required: a 'pending' or 'conflict' answer never runs the tool; only the
 * claim holder settles, by its claimId and request hash; every path that
 * returns without running the tool releases the claim; the request hash is the
 * idempotency service's sha256 fingerprint of the request's canonical JSON, and
 * a request with no fingerprint is refused before it claims anything.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL (the
 * tenant-scope extension included: idempotency_keys is a tenant-scoped model),
 * KeyIdempotencyService, the idempotency_keys rows and their unique index;
 * in the consumer cases, KeyCortexToolRegistryService (execute, its Phase 0
 * gate, its request hash, its audit and score writes). Stand-ins there only:
 * the autonomy safety service (allows unless a case blocks it, records
 * nothing), the saga service (unused: no sagaId), the proposal service (hands
 * back an id, as filing a proposal does), and the registered tools, which
 * count their runs (one parks itself as the KEY action boundary would, one
 * throws, one needs a title, two are tier 3 and tier 4).
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
let fingerprint: (toolName: string, input: unknown) => string;

/** The consumer cases' tool: each run it performed, and how long a run takes. */
const TOOL = 'v19a.create_ticket';
const toolRuns: Array<Record<string, unknown>> = [];
const toolDelay = { ms: 0 };

/** The consumer cases' other tools, each standing for one path through execute(). */
const TOOL_TITLED = 'v19a.titled_ticket'; // requires a title (the validation path)
const TOOL_TIER3 = 'v19a.tier3_ticket'; // sent for approval below preApproved
const TOOL_TIER4 = 'v19a.tier4_ticket'; // refused outright below preApproved
const TOOL_PARKED = 'v19a.parked_ticket'; // the handler answers notExecuted while parked
const TOOL_FAILING = 'v19a.failing_ticket'; // the handler throws

/** Steered per case, reset in its finally. */
const safetyGate: { answer: Record<string, unknown>; throws?: string } = { answer: { allowed: true } };
const boundary = { park: false };
const proposalsFiled: string[] = [];

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
  const idempotencyMod: any = await import('../src/modules/key-cortex/key-idempotency.service');
  const { KeyIdempotencyService } = idempotencyMod;
  // V1-19b: the request fingerprint the registry claims under (absent before).
  fingerprint = (toolName, input) => idempotencyMod.fingerprintToolRequest(toolName, input);

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
  const safety = {
    check: async () => {
      if (safetyGate.throws) throw new Error(safetyGate.throws);
      return safetyGate.answer;
    },
    recordExecution: async () => undefined,
  };
  const saga = {};
  const proposals = {
    create: async () => {
      const id = `${P}proposal_${proposalsFiled.length + 1}`;
      proposalsFiled.push(id);
      return { id };
    },
  };
  // Positionally: prisma, safety, idempotency, saga, learning, audit service, event bus, proposals.
  registry = new KeyCortexToolRegistryService(
    moduleRef.get(PrismaService),
    safety as any,
    service,
    saga as any,
    undefined,
    undefined,
    undefined,
    proposals as any,
  );
  const runTicket = async (_ctx: any, input: Record<string, unknown>) => {
    toolRuns.push(input);
    if (toolDelay.ms) await new Promise((r) => setTimeout(r, toolDelay.ms));
    return { success: true, data: { ticket: input.title, run: toolRuns.length } };
  };
  const toolDef = (name: string, extra: Record<string, unknown>) => ({
    name,
    module: 'v19a',
    description: 'v19a: records each run (the external effect counted here)',
    parameters: { type: 'object', properties: {}, required: [] },
    riskTier: 1,
    requiresApproval: false,
    handler: runTicket,
    ...extra,
  });
  registry.register(toolDef(TOOL, {}));
  registry.register(toolDef(TOOL_TITLED, { parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }));
  registry.register(toolDef(TOOL_TIER3, { riskTier: 3, requiresApproval: true }));
  registry.register(toolDef(TOOL_TIER4, { riskTier: 4, requiresApproval: true }));
  registry.register(
    toolDef(TOOL_PARKED, {
      // As the KEY action boundary answers behind a bridged handler (KF-EXEC-ACTION-001).
      handler: async (ctx: any, input: Record<string, unknown>) =>
        boundary.park
          ? { success: false, notExecuted: true, requiresApproval: true, error: 'v19a: Not executed: sent for approval' }
          : runTicket(ctx, input),
    }),
  );
  registry.register(
    toolDef(TOOL_FAILING, {
      handler: async (_ctx: any, input: Record<string, unknown>) => {
        toolRuns.push(input);
        throw new Error('v19a: provider said no');
      },
    }),
  );

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
    // A caller presenting neither hash nor claimId (the tool registry before V1-19b).
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

  it("the reviewer's 'pending' loser sequence, without claimIds (as the registry settled before V1-19b): the first settle wins whole, the second answers false, and no row is left half one outcome and half the other", async () => {
    const key = freshKey('settle_loser');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('new');
    expect((await service.check(req(key, 'hash_1'))).status).toBe('pending');

    // Without a claimId a same-request caller cannot be told from the claimant
    // (the registry now passes its claimId: V1-19b, through the registry below).
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


/** What the claim answers a caller that does not hold it (key-idempotency.service.ts). */
const IN_FLIGHT = 'Idempotency key is being processed by another request';
const CONFLICT = 'Idempotency key was already used for a different request';

/** The stored row of one key, with its id (the claimId check() handed the holder). */
const claimRow = (businessId: string, idempotencyKey: string) =>
  db.idempotencyKey.findFirst({
    where: { businessId, idempotencyKey },
    select: { id: true, status: true, requestHash: true, response: true, error: true },
  });

/** Run fn with complete() and fail() recorded: what each was asked, and whether it settled. */
async function spySettles<T>(fn: () => Promise<T>) {
  const settles: Array<{ op: 'complete' | 'fail'; req: any; settled: boolean }> = [];
  const complete = service.complete.bind(service);
  const fail = service.fail.bind(service);
  service.complete = async (r: any, response: unknown) => {
    const settled = await complete(r, response);
    settles.push({ op: 'complete', req: r, settled });
    return settled;
  };
  service.fail = async (r: any, error: string) => {
    const settled = await fail(r, error);
    settles.push({ op: 'fail', req: r, settled });
    return settled;
  };
  try {
    return { result: await fn(), settles };
  } finally {
    delete service.complete;
    delete service.fail;
  }
}

/** Wait (bounded) until cond holds. */
async function until(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('v19a: timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const ctxFor = (idempotencyKey: string, extra: Record<string, unknown> = {}) => ({
  businessId: ID.biz,
  userId: ID.owner,
  autonomyLevel: 2,
  idempotencyKey,
  ...extra,
});
const runsOf = (title: string) => toolRuns.filter((r) => r.title === title).length;

/**
 * SEC-V19-2 / CR-V19-1, through the only consumer: the real
 * KeyCortexToolRegistryService.execute and its Phase 0 gate. Measured before
 * the V1-19 repair (same sequence): the conflicting request ran and its
 * complete() rewrote the stored row, so a replay of the ORIGINAL request
 * returned the other request's result. Measured on the V1-19 head (V1-19b's
 * red): the conflicting request still ran, and of two concurrent identical
 * calls both ran the tool and both tried to settle.
 */
describe('through the only consumer, KeyCortexToolRegistryService.execute (V1-19 review, SEC-V19-2 / CR-V19-1)', () => {
  it("a reused key with a different input does not rewrite the stored outcome and is not run: it is answered 'conflict', and replaying the original request returns the original outcome without running the tool", async () => {
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

    // V1-19b (observed on the V1-19 head: the 'conflict' answer fell through
    // the Phase 0 gate and the tool ran for B).
    expect(other).toEqual({ success: false, notExecuted: true, error: CONFLICT });
    expect(runsOf(`${key}_B`)).toBe(0);
  });

  it("two concurrent identical calls: the tool runs once, the other call is answered 'pending' without running it, the claim holder alone settles (by its claimId and request hash), and a replay returns the stored outcome without running the tool", async () => {
    const key = freshKey('registry_race');
    const title = `${key}_T`;
    toolDelay.ms = 300;
    let spied: { result: any[]; settles: Array<{ op: string; req: any; settled: boolean }> };
    try {
      spied = await spySettles(() =>
        Promise.all([registry.execute(TOOL, ctxFor(key), { title }), registry.execute(TOOL, ctxFor(key), { title })]),
      );
    } finally {
      toolDelay.ms = 0;
    }
    const { result: results, settles } = spied;

    const row = await claimRow(ID.biz, key);
    expect(row.status).toBe('completed');
    // V1-19b (observed on the V1-19 head: 2, both concurrent calls ran).
    expect(runsOf(title)).toBe(1);
    expect(results).toContainEqual(row.response);
    expect(results).toContainEqual({ success: false, notExecuted: true, error: IN_FLIGHT });
    // V1-19b (observed on the V1-19 head: two settles, [false, true], neither
    // naming a claim or a request hash).
    expect(settles).toEqual([
      { op: 'complete', settled: true, req: { businessId: ID.biz, idempotencyKey: key, requestHash: row.requestHash, claimId: row.id } },
    ]);
    expect(row.requestHash).toBe(fingerprint(TOOL, { title }));

    expect(await registry.execute(TOOL, ctxFor(key), { title })).toEqual({ success: true, data: row.response });
    expect(runsOf(title)).toBe(1);
  });
});

/**
 * V1-19b (the V1-19 it.todo "refuses a 'pending' or 'conflict' answer"). The
 * Phase 0 gate returned early on 'completed' and 'failed' only, so every other
 * answer ran the tool.
 */
describe("V1-19b: a 'pending' or 'conflict' answer never runs the tool (SEC-V19-2 / CR-V19-1)", () => {
  it("a key whose claim another caller holds is answered 'pending': the tool does not run, nothing is settled, and the holder's claim stays open for the holder alone to settle", async () => {
    const key = freshKey('reg_pending');
    const input = { title: `${key}_T` };
    const hash = fingerprint(TOOL, input);
    const holder = await service.check(req(key, hash));
    expect(holder.status).toBe('new');

    const { result, settles } = await spySettles(() => registry.execute(TOOL, ctxFor(key), input));

    expect(result).toEqual({ success: false, notExecuted: true, error: IN_FLIGHT });
    expect(runsOf(input.title)).toBe(0);
    expect(settles).toEqual([]);
    expect(await rowsFor(ID.biz, key)).toEqual([{ status: 'pending', requestHash: hash, response: null, error: null }]);
    expect(await service.complete({ ...req(key, hash), claimId: holder.claimId }, { owner: 'holder' })).toBe(true);
  });

  it("a different request under a key whose first request is still running is answered 'conflict' and not run; the first request's outcome stands", async () => {
    const key = freshKey('reg_conflict_open');
    toolDelay.ms = 300;
    let first: any;
    let second: any;
    try {
      const running = registry.execute(TOOL, ctxFor(key), { title: `${key}_A` });
      // A holds the claim and is inside its tool run.
      await until(() => runsOf(`${key}_A`) === 1);
      second = await registry.execute(TOOL, ctxFor(key), { title: `${key}_B` });
      first = await running;
    } finally {
      toolDelay.ms = 0;
    }

    expect(second).toEqual({ success: false, notExecuted: true, error: CONFLICT });
    expect(runsOf(`${key}_B`)).toBe(0);
    expect(first).toMatchObject({ success: true, data: { ticket: `${key}_A` } });
    expect(await claimRow(ID.biz, key)).toMatchObject({ status: 'completed', response: first });
  });

  it("the same key and input for another tool is another request: 'conflict', not run", async () => {
    const key = freshKey('reg_conflict_tool');
    const input = { title: `${key}_T` };
    expect(await registry.execute(TOOL, ctxFor(key), input)).toMatchObject({ success: true });

    expect(await registry.execute(TOOL_TITLED, ctxFor(key), input)).toEqual({ success: false, notExecuted: true, error: CONFLICT });
    expect(runsOf(input.title)).toBe(1);
  });
});

/**
 * V1-19b (the V1-19 it.todo "passes the claimId check() answered to
 * complete()/fail()"). The registry settled with { businessId, idempotencyKey }
 * only, so any caller of the same request could settle the holder's claim.
 */
describe('V1-19b: only the claim holder settles, by its claimId and request hash (SEC-V19-1)', () => {
  it("a run that throws is settled 'failed' by its holder, naming its claimId and request hash; its replay returns the stored error without running the tool", async () => {
    const key = freshKey('reg_fail');
    const input = { title: `${key}_F` };
    const { result, settles } = await spySettles(() => registry.execute(TOOL_FAILING, ctxFor(key), input));

    expect(result).toEqual({ success: false, error: 'v19a: provider said no' });
    const row = await claimRow(ID.biz, key);
    expect(row).toMatchObject({ status: 'failed', error: 'v19a: provider said no' });
    expect(settles).toEqual([
      { op: 'fail', settled: true, req: { businessId: ID.biz, idempotencyKey: key, requestHash: row.requestHash, claimId: row.id } },
    ]);
    expect(row.requestHash).toBe(fingerprint(TOOL_FAILING, input));

    expect(await registry.execute(TOOL_FAILING, ctxFor(key), input)).toEqual({ success: false, error: 'v19a: provider said no' });
    expect(runsOf(input.title)).toBe(1);
  });
});

/**
 * V1-19b (the V1-19 it.todo "releases its claim on every path that returns
 * without running the tool"; CR-V19-2). Once 'pending' is refused, a claim left
 * open by a call that never ran would refuse every retry of that key for good,
 * the approved re-execution of a proposal included.
 */
describe('V1-19b: every path that returns without running the tool releases its claim (CR-V19-2)', () => {
  it('the autonomy safety gate blocks the call: the claim is released, and the retry under the same key reaches the tool once the gate allows it', async () => {
    const key = freshKey('rel_safety');
    const input = { title: `${key}_S` };
    safetyGate.answer = { allowed: false, reason: 'v19a: autonomy kill switch active' };
    let blocked: any;
    try {
      blocked = await registry.execute(TOOL, ctxFor(key), input);
    } finally {
      safetyGate.answer = { allowed: true };
    }

    expect(blocked).toMatchObject({ success: false, error: 'v19a: autonomy kill switch active' });
    expect(runsOf(input.title)).toBe(0);
    expect(await rowsFor(ID.biz, key)).toEqual([]);

    expect(await registry.execute(TOOL, ctxFor(key), input)).toMatchObject({ success: true });
    expect(runsOf(input.title)).toBe(1);
  });

  it('the safety gate itself fails (throws): the error propagates as before, and the claim is released, not stranded', async () => {
    const key = freshKey('rel_safety_throw');
    const input = { title: `${key}_E` };
    safetyGate.throws = 'v19a: safety store unreachable';
    try {
      await expect(registry.execute(TOOL, ctxFor(key), input)).rejects.toThrow('v19a: safety store unreachable');
    } finally {
      safetyGate.throws = undefined;
    }

    expect(runsOf(input.title)).toBe(0);
    expect(await rowsFor(ID.biz, key)).toEqual([]);
  });

  it('the input fails validation: the claim is released, and a corrected retry under the same key reaches the tool', async () => {
    const key = freshKey('rel_validation');
    expect(await registry.execute(TOOL_TITLED, ctxFor(key), {})).toEqual({ success: false, error: 'Missing required parameters: title' });
    expect(await rowsFor(ID.biz, key)).toEqual([]);

    const input = { title: `${key}_V` };
    expect(await registry.execute(TOOL_TITLED, ctxFor(key), input)).toMatchObject({ success: true });
    expect(runsOf(input.title)).toBe(1);
  });

  it('a tier-4 tool is refused below approval: the claim is released', async () => {
    const key = freshKey('rel_refused');
    const input = { title: `${key}_R` };
    expect(await registry.execute(TOOL_TIER4, ctxFor(key), input)).toMatchObject({ success: false, requiresApproval: false });
    expect(runsOf(input.title)).toBe(0);
    expect(await rowsFor(ID.biz, key)).toEqual([]);
  });

  it("a tier-3 tool is sent for approval: the claim is released, and the approved re-execution under the same key runs the tool once and becomes the key's outcome", async () => {
    const key = freshKey('rel_proposal');
    const input = { title: `${key}_P` };
    const filed = await registry.execute(TOOL_TIER3, ctxFor(key), input);
    expect(filed).toMatchObject({ success: false, requiresApproval: true, data: { proposalId: expect.stringMatching(/^v19a_proposal_/) } });
    expect(runsOf(input.title)).toBe(0);
    expect(await rowsFor(ID.biz, key)).toEqual([]);

    // As KeyCortexActionExecutorPlugin executes an approved proposal: preApproved.
    const approved = await registry.execute(TOOL_TIER3, ctxFor(key, { preApproved: true }), input);
    expect(approved).toMatchObject({ success: true, data: { ticket: input.title } });
    expect(runsOf(input.title)).toBe(1);
    expect(await registry.execute(TOOL_TIER3, ctxFor(key, { preApproved: true }), input)).toEqual({ success: true, data: approved });
    expect(runsOf(input.title)).toBe(1);
  });

  it('the handler answers notExecuted (the KEY action boundary filed it): the claim is released, and the retry under the same key reaches the tool', async () => {
    const key = freshKey('rel_not_executed');
    const input = { title: `${key}_N` };
    boundary.park = true;
    let parked: any;
    try {
      parked = await registry.execute(TOOL_PARKED, ctxFor(key), input);
    } finally {
      boundary.park = false;
    }

    expect(parked).toEqual({ success: false, notExecuted: true, requiresApproval: true, error: 'v19a: Not executed: sent for approval' });
    expect(runsOf(input.title)).toBe(0);
    expect(await rowsFor(ID.biz, key)).toEqual([]);

    expect(await registry.execute(TOOL_PARKED, ctxFor(key), input)).toMatchObject({ success: true });
    expect(runsOf(input.title)).toBe(1);
  });
});

/**
 * V1-19b (the V1-19 it.todo on hashRequest; SEC-V19-3). The claim's conflict
 * guarantee holds only as far as the request hash tells two requests apart.
 * The registry's own hash was a 32-bit string hash of key-order-sensitive
 * JSON.stringify that answered '0' for anything it could not serialize.
 */
describe('V1-19b: the request hash is the idempotency fingerprint of the request (SEC-V19-3)', () => {
  it("{to:'Aa'} and {to:'BB'} are two requests: the second is a 'conflict', never handed the first one's stored outcome; the stored hash is a sha256 fingerprint", async () => {
    const key = freshKey('hash_collide');
    const title = `${key}_X`;
    const first = await registry.execute(TOOL, ctxFor(key), { title, to: 'Aa' });
    expect(first).toMatchObject({ success: true });

    const second = await registry.execute(TOOL, ctxFor(key), { title, to: 'BB' });
    expect(second).toEqual({ success: false, notExecuted: true, error: CONFLICT });
    expect(runsOf(title)).toBe(1);

    const row = await claimRow(ID.biz, key);
    expect(row).toMatchObject({ status: 'completed', response: first });
    expect(row.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.requestHash).toBe(fingerprint(TOOL, { title, to: 'Aa' }));
  });

  it('the same request with its keys in another order is the same request: replayed, not run again', async () => {
    const key = freshKey('hash_order');
    const title = `${key}_O`;
    const first = await registry.execute(TOOL, ctxFor(key), { title, priority: 'high' });
    expect(first).toMatchObject({ success: true });

    expect(await registry.execute(TOOL, ctxFor(key), { priority: 'high', title })).toEqual({ success: true, data: first });
    expect(runsOf(title)).toBe(1);
  });

  it('an input with no JSON form (a circular reference) under an idempotency key is refused before it claims anything: not run, no row', async () => {
    const key = freshKey('hash_unserializable');
    const input: Record<string, unknown> = { title: `${key}_C` };
    input.self = input;

    const result = await registry.execute(TOOL, ctxFor(key), input);
    expect(result).toMatchObject({ success: false, notExecuted: true, error: expect.stringContaining('fingerprint') });
    expect(runsOf(input.title as string)).toBe(0);
    expect(await rowsFor(ID.biz, key)).toEqual([]);
  });
});

/**
 * Still open, outside this write set: a claim stranded by a crash between
 * check() and its settle (the process dies mid-run) is held for good, and now
 * that 'pending' is refused every retry of that key is refused with it. That
 * needs a lease or abandon rule: a design decision, not made here.
 */
describe('the consumer of the claim: what is still open', () => {
  it.todo('a claim stranded by a crash between check() and complete()/fail() is held for good: it needs a lease or abandon rule (a design decision, not made here; V1-19 review CR-V19-2)');
});
