/**
 * RR-DISPATCH-ATOMIC-CLAIM (V1-72, P126, D-261/D-262/D-17/D-103/D-134) on real Postgres:
 *
 * Proves end-to-end against DATABASE_URL that ActionDispatcherService.dispatch takes an
 * atomic durable claim on `dispatch:<idempotencyKey>` via KeyIdempotencyService BEFORE
 * running the governance/execution loop (replacing the racy findFirst on AiExecutionLog):
 *
 *   - AC-01: Concurrent Promise.all of multiple dispatches with the same (businessId,
 *            idempotencyKey) against a slow tool stub executes the tool EXACTLY ONCE;
 *            all racing callers receive `{ success: false }` with 'in progress' WITHOUT
 *            executing the tool and WITHOUT counting against the circuit breaker (even
 *            when racing count exceeds CIRCUIT_THRESHOLD).
 *   - AC-02: Replay after completion returns the stored completed outcome from
 *            idempotency_keys without re-executing the tool (even if AiExecutionLog is
 *            absent).
 *   - AC-03: Replay after failure (including OUTCOME_UNKNOWN from RR-DISPATCH-NO-BLIND-RETRY)
 *            returns the stored failed outcome without re-executing the tool and without
 *            counting a second circuit-breaker failure.
 *   - AC-04: A stranded 'pending' claim older than KEY_IDEMPOTENCY_CLAIM_LEASE_MS (D-103)
 *            is atomically taken over, audited on CortexActionLog as
 *            KEY_IDEMPOTENCY_TAKEOVER_ACTION, executed once, and settled as 'completed'.
 *   - AC-05: Cross-tenant isolation: claiming `dispatch:<key>` in bizA (in-flight or
 *            settled) never blocks or replays for bizB using the same key.
 *   - AC-06: Dispatch without `idempotencyKey` executes normally without creating rows in
 *            `idempotency_keys`.
 *   - AC-07: Governance refusal releases the open claim cleanly (no stuck 'pending' row),
 *            so once allowed, a subsequent dispatch with the same key executes and settles.
 *   - AC-08: Real NestJS DI wiring via Test.createTestingModule confirms KeyIdempotencyService
 *            is injected into ActionDispatcherService and backs dispatch() claims.
 *
 * Real: PrismaService, KeyIdempotencyService, AiExecutionLogService, ActionDispatcherService,
 * against DATABASE_URL.
 * Fixtures: prefix `v72c_` (registered in test/helpers/fixture-prefixes.json), hard-deleted
 * via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72c_';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
};

const WRITE_TOOL = 'crm_create_contact';
const CLOSED_CIRCUIT = { open: false, failures: 0, lastFailure: null };

let db: any;
let prisma: any;
let keyIdempotency: any;
let KEY_IDEMPOTENCY_CLAIM_LEASE_MS: number;
let KEY_IDEMPOTENCY_TAKEOVER_ACTION: string;
let ActionDispatcherCtor: any;
let KeyIdempotencyCtor: any;
let PrismaServiceCtor: any;
let AiExecutionLogServiceCtor: any;
let AiOversightServiceCtor: any;
let FlowOrchestratorServiceCtor: any;
let UndoServiceCtor: any;

interface MakeDispatcherOpts {
  governance?: { evaluate: (businessId: string, toolName: string) => Promise<any> };
}

let makeDispatcher: (
  handler: (businessId: string, toolName: string, callIndex: number) => unknown,
  opts?: MakeDispatcherOpts,
) => { dispatcher: any; executeToolDirectly: ReturnType<typeof vi.fn> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanup() {
  for (const sql of [
    `DELETE FROM cortex_action_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  ({ PrismaService: PrismaServiceCtor } = await import('../src/core/prisma/prisma.service'));
  ({ AiExecutionLogService: AiExecutionLogServiceCtor } = await import('../src/modules/ai/ai-execution-log.service'));
  ({ AiOversightService: AiOversightServiceCtor } = await import('../src/modules/ai/ai-oversight.service'));
  ({ FlowOrchestratorService: FlowOrchestratorServiceCtor } = await import('../src/modules/ai/flow-orchestrator.service'));
  ({ UndoService: UndoServiceCtor } = await import('../src/modules/ai/undo.service'));
  ({ ActionDispatcherService: ActionDispatcherCtor } = await import('../src/modules/ai/action-dispatcher.service'));
  const idemMod = await import('../src/modules/key-cortex/key-idempotency.service');
  KeyIdempotencyCtor = idemMod.KeyIdempotencyService;
  KEY_IDEMPOTENCY_CLAIM_LEASE_MS = idemMod.KEY_IDEMPOTENCY_CLAIM_LEASE_MS;
  KEY_IDEMPOTENCY_TAKEOVER_ACTION = idemMod.KEY_IDEMPOTENCY_TAKEOVER_ACTION;

  prisma = new PrismaServiceCtor();
  keyIdempotency = new KeyIdempotencyCtor(prisma);

  const events = { emit: () => true };
  const ALLOW = {
    allowed: true,
    tier: 1,
    reason: 'v72c: allowed',
    requiresFormalApproval: false,
    requiresAdminApproval: false,
    requiresQuickConfirm: false,
  };
  const defaultGovernance = { evaluate: async () => ({ ...ALLOW }) };

  makeDispatcher = (handler, opts) => {
    let calls = 0;
    const executeToolDirectly = vi.fn(async (businessId: string, toolName: string) => {
      calls += 1;
      return handler(businessId, toolName, calls);
    });
    const executionLog = new AiExecutionLogServiceCtor(prisma);
    const dispatcher = new ActionDispatcherCtor(
      prisma,
      events as any,
      executionLog,
      (opts?.governance ?? defaultGovernance) as any,
      { executeToolDirectly } as any,
      { registerAction: async () => undefined } as any,
      undefined,
      keyIdempotency,
    );
    const internals = dispatcher as unknown as { logger: unknown; RETRY_DELAYS: number[] };
    internals.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    internals.RETRY_DELAYS = [0, 0];
    return { dispatcher, executeToolDirectly };
  };

  await cleanup();
  await db.user.create({ data: { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V72C Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V72C Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
}, 180_000);

afterAll(async () => {
  if (db) {
    await cleanup();
    const left = await db.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
              (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users,
              (SELECT count(*) FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS memberships,
              (SELECT count(*) FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS logs,
              (SELECT count(*) FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS claims,
              (SELECT count(*) FROM cortex_action_logs WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS audits`,
    );
    expect(left).toEqual([{ businesses: 0, users: 0, memberships: 0, logs: 0, claims: 0, audits: 0 }]);
  }
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('RR-DISPATCH-ATOMIC-CLAIM (V1-72): ActionDispatcherService takes atomic durable claim via KeyIdempotencyService (real Postgres)', () => {
  it('AC-01: concurrent Promise.all dispatches with the same (businessId, idempotencyKey) execute the tool ONCE; racing callers get "in progress" without counting on the circuit breaker', async () => {
    const idempotencyKey = `${P}race_concurrent`;
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const { dispatcher, executeToolDirectly } = makeDispatcher(async (_biz, _tool, callIndex) => {
      if (callIndex === 1) {
        markEntered();
        await firstGate;
      }
      return { id: `${P}contact_race_1`, created: true };
    });

    const ctx = {
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Ada' },
      idempotencyKey,
      source: 'plan_worker',
      retryCount: 2,
    };

    // Start caller 1 and wait until it is guaranteed inside the tool handler (holding the 'pending' claim).
    const firstPromise = dispatcher.dispatch({ ...ctx });
    await firstEntered;

    // Launch 6 concurrent racing callers (> CIRCUIT_THRESHOLD = 5) while caller 1 is in-flight.
    const racingResults = await Promise.all(Array.from({ length: 6 }, () => dispatcher.dispatch({ ...ctx })));

    // Release caller 1 now that all 6 racers have been answered.
    releaseFirst();
    const firstResult = await firstPromise;

    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(firstResult).toMatchObject({
      success: true,
      result: { id: `${P}contact_race_1`, created: true },
    });

    expect(racingResults).toHaveLength(6);
    for (const loser of racingResults) {
      expect(loser.success).toBe(false);
      expect(loser.error).toMatch(/in progress/i);
    }

    // Racing 'pending' answers must NOT count against the circuit breaker.
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, ID.bizA)).toEqual(CLOSED_CIRCUIT);

    // Durable claim row settled as 'completed' under `dispatch:<idempotencyKey>`.
    const claimRow = await db.idempotencyKey.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: ID.bizA,
          idempotencyKey: `dispatch:${idempotencyKey}`,
        },
      },
    });
    expect(claimRow).toMatchObject({
      businessId: ID.bizA,
      idempotencyKey: `dispatch:${idempotencyKey}`,
      status: 'completed',
    });

    // Also prove simultaneous Promise.all from the same tick on a fresh key executes the tool exactly once.
    const burstKey = `${P}race_burst`;
    const burst = makeDispatcher(async () => {
      await sleep(150);
      return { id: `${P}contact_burst` };
    });
    const burstResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        burst.dispatcher.dispatch({
          businessId: ID.bizA,
          toolName: WRITE_TOOL,
          args: { firstName: 'Burst' },
          idempotencyKey: burstKey,
          source: 'plan_worker',
          retryCount: 2,
        }),
      ),
    );
    expect(burst.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(burstResults.filter((r) => r.success)).toHaveLength(1);
    expect(burstResults.filter((r) => !r.success).every((r) => /in progress/i.test(r.error ?? ''))).toBe(true);
    expect(burst.dispatcher.getCircuitStatus(WRITE_TOOL, ID.bizA)).toEqual(CLOSED_CIRCUIT);
  });

  it('AC-02: re-dispatch after completion replays stored result from idempotency_keys without executing (even if AiExecutionLog is removed)', async () => {
    const idempotencyKey = `${P}replay_ok`;
    const { dispatcher, executeToolDirectly } = makeDispatcher(() => ({
      id: `${P}contact_ok`,
      tags: ['vip'],
    }));

    const ctx = {
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Grace' },
      idempotencyKey,
      source: 'plan_worker',
      retryCount: 2,
    };

    const first = await dispatcher.dispatch(ctx);
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      success: true,
      result: { id: `${P}contact_ok`, tags: ['vip'] },
    });

    // Remove the AiExecutionLog row to prove replay comes from idempotency_keys, not AiExecutionLog.findFirst.
    await db.$executeRawUnsafe(
      `DELETE FROM ai_execution_logs WHERE business_id = '${ID.bizA}' AND idempotency_key = '${idempotencyKey}'`,
    );

    const second = await dispatcher.dispatch(ctx);
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      success: true,
      result: { id: `${P}contact_ok`, tags: ['vip'] },
      durationMs: 0,
    });
  });

  it('AC-03: re-dispatch after failure (including OUTCOME_UNKNOWN from P116) replays stored failed outcome without executing or recounting the circuit', async () => {
    const idempotencyKey = `${P}replay_fail`;
    const { dispatcher, executeToolDirectly } = makeDispatcher(() => {
      throw new Error('socket hang up');
    });

    const ctx = {
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Alan' },
      idempotencyKey,
      source: 'plan_worker',
      retryCount: 2,
    };

    const first = await dispatcher.dispatch(ctx);
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      success: false,
      error: 'OUTCOME_UNKNOWN: socket hang up',
    });
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, ID.bizA)).toMatchObject({ open: false, failures: 1 });

    // Claim row settled as 'failed' with the OUTCOME_UNKNOWN error.
    const claimRow = await db.idempotencyKey.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: ID.bizA,
          idempotencyKey: `dispatch:${idempotencyKey}`,
        },
      },
    });
    expect(claimRow).toMatchObject({
      businessId: ID.bizA,
      idempotencyKey: `dispatch:${idempotencyKey}`,
      status: 'failed',
      error: 'OUTCOME_UNKNOWN: socket hang up',
    });

    // Replay returns stored failed outcome without executing and without incrementing circuit failures.
    const second = await dispatcher.dispatch(ctx);
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      success: false,
      error: 'OUTCOME_UNKNOWN: socket hang up',
      durationMs: 0,
    });
    expect(dispatcher.getCircuitStatus(WRITE_TOOL, ID.bizA)).toMatchObject({ open: false, failures: 1 });
  });

  it('AC-04: stranded pending claim older than the D-103 lease is taken over, audited on CortexActionLog, executed once, and completed', async () => {
    const idempotencyKey = `${P}stranded_lease`;
    const claimKey = `dispatch:${idempotencyKey}`;
    const staleClaimId = `${P}stale_claim_id`;
    const expiredAt = new Date(Date.now() - KEY_IDEMPOTENCY_CLAIM_LEASE_MS - 60_000);

    await db.idempotencyKey.create({
      data: {
        id: staleClaimId,
        businessId: ID.bizA,
        idempotencyKey: claimKey,
        status: 'pending',
        createdAt: expiredAt,
        updatedAt: expiredAt,
      },
    });
    // Ensure updated_at is backdated past the lease (Prisma @updatedAt overwrites on create/update).
    await db.$executeRawUnsafe(
      `UPDATE idempotency_keys SET updated_at = $1 WHERE id = $2`,
      expiredAt,
      staleClaimId,
    );

    const { dispatcher, executeToolDirectly } = makeDispatcher(() => ({
      id: `${P}contact_recovered`,
      recovered: true,
    }));

    const res = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Katherine' },
      idempotencyKey,
      source: 'plan_worker',
      retryCount: 2,
    });

    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      success: true,
      result: { id: `${P}contact_recovered`, recovered: true },
    });

    const settledRow = await db.idempotencyKey.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: ID.bizA,
          idempotencyKey: claimKey,
        },
      },
    });
    expect(settledRow).toMatchObject({
      businessId: ID.bizA,
      idempotencyKey: claimKey,
      status: 'completed',
    });
    expect(settledRow.id).not.toBe(staleClaimId);

    // D-103 takeover audit row written to CortexActionLog.
    const takeoverLogs = await db.cortexActionLog.findMany({
      where: {
        businessId: ID.bizA,
        actionType: KEY_IDEMPOTENCY_TAKEOVER_ACTION,
      },
    });
    const matching = takeoverLogs.filter((l: any) => typeof l.result === 'string' && l.result.includes(staleClaimId));
    expect(matching).toHaveLength(1);
  });

  it('AC-05: cross-tenant isolation: claiming dispatch:<key> in bizA (in-flight and settled) never blocks or replays for bizB', async () => {
    const sharedKey = `${P}tenant_shared`;
    const { dispatcher, executeToolDirectly } = makeDispatcher(async (businessId) => {
      if (businessId === ID.bizA) {
        await sleep(150);
        return { tenant: 'A', id: `${P}a_item` };
      }
      return { tenant: 'B', id: `${P}b_item` };
    });

    // Run bizA (slow, in-flight) and bizB concurrently with the exact same idempotencyKey.
    const [resA, resB] = await Promise.all([
      dispatcher.dispatch({
        businessId: ID.bizA,
        toolName: WRITE_TOOL,
        args: { firstName: 'Alpha' },
        idempotencyKey: sharedKey,
        source: 'plan_worker',
      }),
      (async () => {
        await sleep(25);
        return dispatcher.dispatch({
          businessId: ID.bizB,
          toolName: WRITE_TOOL,
          args: { firstName: 'Beta' },
          idempotencyKey: sharedKey,
          source: 'plan_worker',
        });
      })(),
    ]);

    expect(executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(resA).toMatchObject({ success: true, result: { tenant: 'A', id: `${P}a_item` } });
    expect(resB).toMatchObject({ success: true, result: { tenant: 'B', id: `${P}b_item` } });

    // Both businesses have distinct rows in idempotency_keys and replay their own outcomes.
    const rows = await db.idempotencyKey.findMany({
      where: { idempotencyKey: `dispatch:${sharedKey}`, businessId: { in: [ID.bizA, ID.bizB] } },
      orderBy: { businessId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.status)).toEqual(['completed', 'completed']);

    const replayA = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Alpha' },
      idempotencyKey: sharedKey,
      source: 'plan_worker',
    });
    const replayB = await dispatcher.dispatch({
      businessId: ID.bizB,
      toolName: WRITE_TOOL,
      args: { firstName: 'Beta' },
      idempotencyKey: sharedKey,
      source: 'plan_worker',
    });
    expect(executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(replayA).toMatchObject({ success: true, result: { tenant: 'A', id: `${P}a_item` }, durationMs: 0 });
    expect(replayB).toMatchObject({ success: true, result: { tenant: 'B', id: `${P}b_item` }, durationMs: 0 });
  });

  it('AC-06: dispatches without idempotencyKey run normally and write no rows to idempotency_keys', async () => {
    const beforeCount = await db.idempotencyKey.count({ where: { businessId: ID.bizA } });
    const { dispatcher, executeToolDirectly } = makeDispatcher((_biz, _tool, call) => ({
      run: call,
    }));

    const first = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'NoKey1' },
      source: 'plan_worker',
    });
    const second = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'NoKey2' },
      source: 'plan_worker',
    });

    expect(executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ success: true, result: { run: 1 } });
    expect(second).toMatchObject({ success: true, result: { run: 2 } });

    const afterCount = await db.idempotencyKey.count({ where: { businessId: ID.bizA } });
    expect(afterCount).toBe(beforeCount);
  });

  it('AC-07: governance refusal releases the open claim cleanly so a retry after policy allows executes and settles', async () => {
    const idempotencyKey = `${P}gov_release`;
    let allowed = false;
    const governance = {
      evaluate: async () =>
        allowed
          ? { allowed: true, tier: 1, reason: 'v72c: allowed' }
          : { allowed: false, tier: 3, reason: 'Blocked by policy' },
    };
    const { dispatcher, executeToolDirectly } = makeDispatcher(
      () => ({ id: `${P}contact_after_gov` }),
      { governance },
    );

    const ctx = {
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'PolicyTest' },
      idempotencyKey,
      source: 'plan_worker',
    };

    const refused = await dispatcher.dispatch(ctx);
    expect(refused).toMatchObject({ success: false, error: 'Blocked by policy' });
    expect(executeToolDirectly).toHaveBeenCalledTimes(0);

    // No stuck 'pending' claim remains in idempotency_keys.
    const afterRefusal = await db.idempotencyKey.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: ID.bizA,
          idempotencyKey: `dispatch:${idempotencyKey}`,
        },
      },
    });
    expect(afterRefusal).toBeNull();

    // Once governance allows, the same idempotencyKey executes once and settles as 'completed'.
    allowed = true;
    const succeeded = await dispatcher.dispatch(ctx);
    expect(succeeded).toMatchObject({ success: true, result: { id: `${P}contact_after_gov` } });
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);

    const afterSuccess = await db.idempotencyKey.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: ID.bizA,
          idempotencyKey: `dispatch:${idempotencyKey}`,
        },
      },
    });
    expect(afterSuccess).toMatchObject({ status: 'completed' });
  });

  it('AC-08: real NestJS DI wiring injects KeyIdempotencyService into ActionDispatcherService', async () => {
    const executeToolDirectly = vi.fn(async () => ({ id: `${P}di_contact` }));
    // Pass a plain wrapper around `db` (without PrismaService.onModuleDestroy) so
    // moduleRef.close() does not disconnect the shared @keyflow/db pool before afterAll().
    const diPrisma = { client: db };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaServiceCtor, useValue: diPrisma },
        { provide: EventEmitter2, useValue: { emit: () => true } },
        { provide: AiExecutionLogServiceCtor, useValue: new AiExecutionLogServiceCtor(diPrisma) },
        { provide: AiOversightServiceCtor, useValue: { evaluate: async () => ({ allowed: true, tier: 1, reason: 'ok' }) } },
        { provide: FlowOrchestratorServiceCtor, useValue: { executeToolDirectly } },
        { provide: UndoServiceCtor, useValue: { registerAction: async () => undefined } },
        KeyIdempotencyCtor,
        ActionDispatcherCtor,
      ],
    }).compile();

    try {
      const resolvedDispatcher = moduleRef.get(ActionDispatcherCtor);
      const resolvedIdempotency = moduleRef.get(KeyIdempotencyCtor);
      expect(
        (resolvedDispatcher as unknown as { keyIdempotency?: unknown }).keyIdempotency === resolvedIdempotency,
        'expected ActionDispatcherService.keyIdempotency to be the DI-injected KeyIdempotencyService instance',
      ).toBe(true);

      const idempotencyKey = `${P}di_wired_key`;
      const res = await resolvedDispatcher.dispatch({
        businessId: ID.bizA,
        toolName: WRITE_TOOL,
        args: { firstName: 'DI' },
        idempotencyKey,
        source: 'plan_worker',
      });
      expect(res).toMatchObject({ success: true, result: { id: `${P}di_contact` } });

      const claimRow = await db.idempotencyKey.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId: ID.bizA,
            idempotencyKey: `dispatch:${idempotencyKey}`,
          },
        },
      });
      expect(claimRow).toMatchObject({ status: 'completed' });
    } finally {
      await moduleRef.close();
    }
  });
});
