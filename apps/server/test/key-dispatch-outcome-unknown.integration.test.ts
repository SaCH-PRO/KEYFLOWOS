/**
 * RR-DISPATCH-NO-BLIND-RETRY (V1-72, P116, D-261/D-262/D-263) on real Postgres:
 *
 * Proves end-to-end against DATABASE_URL that when a non-READ (WRITE) tool fails
 * with an ambiguous error (dropped socket, 5xx) in ActionDispatcherService.dispatch:
 *   - OU-01: The tool executes ONCE (no blind retries), returns success: false with
 *            error prefixed 'OUTCOME_UNKNOWN: ', writes ONE AiExecutionLog row with
 *            the idempotencyKey and 'OUTCOME_UNKNOWN: ' errorMessage, and a second
 *            dispatch with the same idempotencyKey executes NOTHING (idempotent hit).
 *   - OU-02: Cross-tenant isolation: the same idempotencyKey in bizB is independent
 *            of bizA's OUTCOME_UNKNOWN log row, executes once for bizB, and caches
 *            bizB's own result without affecting bizA.
 *   - OU-03: Controls on real Postgres: 5xx ServiceUnavailableException on WRITE stops
 *            at 1 attempt (OUTCOME_UNKNOWN + idempotent replay); READ tool and
 *            effectNotApplied: true on WRITE still retry and record success.
 *
 * Real: PrismaService, AiExecutionLogService, ActionDispatcherService, against DATABASE_URL.
 * Fixtures: prefix `v72b_` (registered in test/helpers/fixture-prefixes.json), hard-deleted
 * via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72b_';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
};

const WRITE_TOOL = 'crm_create_contact';
const READ_TOOL = 'fetch_business_summary';

let db: any;
let prisma: any;
let makeDispatcher: (
  handler: (businessId: string, toolName: string, callIndex: number) => unknown,
) => { dispatcher: any; executeToolDirectly: ReturnType<typeof vi.fn> };

async function cleanup() {
  for (const sql of [
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

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');

  prisma = new PrismaService();
  const events = { emit: () => true };
  const ALLOW = {
    allowed: true,
    tier: 1,
    reason: 'v72b: allowed',
    requiresFormalApproval: false,
    requiresAdminApproval: false,
    requiresQuickConfirm: false,
  };
  const governance = { evaluate: async () => ({ ...ALLOW }) };

  makeDispatcher = (handler) => {
    let calls = 0;
    const executeToolDirectly = vi.fn(async (businessId: string, toolName: string) => {
      calls += 1;
      return handler(businessId, toolName, calls);
    });
    const executionLog = new AiExecutionLogService(prisma);
    const dispatcher = new ActionDispatcherService(
      prisma,
      events as any,
      executionLog,
      governance as any,
      { executeToolDirectly } as any,
      { registerAction: async () => undefined } as any,
    );
    const internals = dispatcher as unknown as { logger: unknown; RETRY_DELAYS: number[] };
    internals.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    internals.RETRY_DELAYS = [0, 0];
    return { dispatcher, executeToolDirectly };
  };

  await cleanup();
  await db.user.create({ data: { id: ID.ownerA, email: `${P}owner_a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}owner_b@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V72B Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V72B Biz B', ownerId: ID.ownerB } });
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
              (SELECT count(*) FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS logs`,
    );
    expect(left).toEqual([{ businesses: 0, users: 0, memberships: 0, logs: 0 }]);
  }
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('RR-DISPATCH-NO-BLIND-RETRY (D-263): OUTCOME_UNKNOWN persists on AiExecutionLog and blocks duplicate replay (real Postgres)', () => {
  it('OU-01 RED: WRITE tool ambiguous failure runs ONCE, writes ONE AiExecutionLog row with OUTCOME_UNKNOWN and idempotencyKey, and a second dispatch with the same key executes NOTHING', async () => {
    const idempotencyKey = `${P}idem_ou01`;
    const { dispatcher, executeToolDirectly } = makeDispatcher(() => {
      throw new Error('socket hang up');
    });

    const first = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Grace' },
      idempotencyKey,
      retryCount: 2,
    });

    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(first.success).toBe(false);
    expect(first.error).toBe('OUTCOME_UNKNOWN: socket hang up');

    const logsAfterFirst = await db.aiExecutionLog.findMany({
      where: { businessId: ID.bizA, idempotencyKey },
      select: { businessId: true, toolName: true, success: true, errorMessage: true, idempotencyKey: true },
    });
    expect(logsAfterFirst).toEqual([
      {
        businessId: ID.bizA,
        toolName: WRITE_TOOL,
        success: false,
        errorMessage: 'OUTCOME_UNKNOWN: socket hang up',
        idempotencyKey,
      },
    ]);

    // Second dispatch with the same businessId + idempotencyKey: findIdempotentExecution hits and executes NOTHING.
    const second = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Grace' },
      idempotencyKey,
      retryCount: 2,
    });

    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      success: false,
      error: 'OUTCOME_UNKNOWN: socket hang up',
      durationMs: 0,
    });

    const logsAfterSecond = await db.aiExecutionLog.count({
      where: { businessId: ID.bizA, idempotencyKey },
    });
    expect(logsAfterSecond).toBe(1);
  });

  it('OU-02 cross-tenant isolation: the same idempotencyKey in bizB is independent of bizA OUTCOME_UNKNOWN row', async () => {
    const sharedKey = `${P}idem_ou01`;
    const { dispatcher, executeToolDirectly } = makeDispatcher((businessId) => {
      if (businessId === ID.bizB) return { id: `${P}contact_b`, firstName: 'Lin' };
      throw new Error('should not be called for bizA');
    });

    // bizB uses the exact same idempotencyKey that already recorded OUTCOME_UNKNOWN in bizA.
    // findIdempotentExecution scopes by (businessId, idempotencyKey), so bizB does NOT get bizA's cached failure.
    const bizBFirst = await dispatcher.dispatch({
      businessId: ID.bizB,
      toolName: WRITE_TOOL,
      args: { firstName: 'Lin' },
      idempotencyKey: sharedKey,
      retryCount: 2,
    });

    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(bizBFirst).toMatchObject({
      success: true,
      result: { id: `${P}contact_b`, firstName: 'Lin' },
    });

    // bizA's OUTCOME_UNKNOWN row is untouched and bizA still returns cached OUTCOME_UNKNOWN without executing.
    const bizAAgain = await dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Grace' },
      idempotencyKey: sharedKey,
      retryCount: 2,
    });
    expect(executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(bizAAgain).toMatchObject({
      success: false,
      error: 'OUTCOME_UNKNOWN: socket hang up',
      durationMs: 0,
    });

    // Reverse direction: a key recorded for bizB does not short-circuit bizA.
    const bizBKey = `${P}idem_ou02_bizb`;
    const reverse = makeDispatcher((businessId) => {
      if (businessId === ID.bizB) return { id: `${P}contact_b2` };
      throw new Error('socket hang up');
    });
    const bOk = await reverse.dispatcher.dispatch({
      businessId: ID.bizB,
      toolName: WRITE_TOOL,
      args: { firstName: 'Lin' },
      idempotencyKey: bizBKey,
      retryCount: 2,
    });
    expect(reverse.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(bOk).toMatchObject({ success: true, result: { id: `${P}contact_b2` } });

    // Re-dispatching bizB with bizBKey returns cached success without executing again.
    const bCached = await reverse.dispatcher.dispatch({
      businessId: ID.bizB,
      toolName: WRITE_TOOL,
      args: { firstName: 'Lin' },
      idempotencyKey: bizBKey,
      retryCount: 2,
    });
    expect(reverse.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(bCached).toMatchObject({ success: true, durationMs: 0 });

    // Dispatching bizA with bizBKey is NOT satisfied by bizB's row: it executes once for bizA and fails OUTCOME_UNKNOWN.
    const aWithBKey = await reverse.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Grace' },
      idempotencyKey: bizBKey,
      retryCount: 2,
    });
    expect(reverse.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(aWithBKey).toMatchObject({ success: false, error: 'OUTCOME_UNKNOWN: socket hang up' });
  });

  it('OU-03 controls on real Postgres: WRITE 5xx stops at 1 attempt with idempotent replay; READ tool and effectNotApplied: true WRITE tool retry and succeed', async () => {
    // 5xx ServiceUnavailableException on WRITE -> 1 attempt, OUTCOME_UNKNOWN, idempotent replay executes nothing
    const key503 = `${P}idem_ou03_503`;
    const write503 = makeDispatcher(() => {
      throw new ServiceUnavailableException('upstream 503');
    });
    const r503First = await write503.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Sam' },
      idempotencyKey: key503,
      retryCount: 2,
    });
    expect(write503.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(r503First).toMatchObject({ success: false, error: 'OUTCOME_UNKNOWN: upstream 503' });

    const r503Second = await write503.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Sam' },
      idempotencyKey: key503,
      retryCount: 2,
    });
    expect(write503.executeToolDirectly).toHaveBeenCalledTimes(1);
    expect(r503Second).toMatchObject({ success: false, error: 'OUTCOME_UNKNOWN: upstream 503', durationMs: 0 });
    expect(await db.aiExecutionLog.count({ where: { businessId: ID.bizA, idempotencyKey: key503 } })).toBe(1);

    // READ tool -> retries on transient socket hang up and logs success
    const keyRead = `${P}idem_ou03_read`;
    const readTool = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) throw new Error('socket hang up');
      return { revenue: 42 };
    });
    const rRead = await readTool.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: READ_TOOL,
      args: {},
      idempotencyKey: keyRead,
      retryCount: 2,
    });
    expect(readTool.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(rRead).toMatchObject({ success: true, result: { revenue: 42 } });
    expect(await db.aiExecutionLog.findFirst({ where: { businessId: ID.bizA, idempotencyKey: keyRead } })).toMatchObject({
      success: true,
      errorMessage: null,
    });

    // WRITE tool with effectNotApplied: true -> retries and logs success
    const keyEna = `${P}idem_ou03_ena`;
    const writeEna = makeDispatcher((_biz, _tool, call) => {
      if (call === 1) throw Object.assign(new Error('pre-write guard failed'), { effectNotApplied: true });
      return { id: `${P}contact_ena` };
    });
    const rEna = await writeEna.dispatcher.dispatch({
      businessId: ID.bizA,
      toolName: WRITE_TOOL,
      args: { firstName: 'Turing' },
      idempotencyKey: keyEna,
      retryCount: 2,
    });
    expect(writeEna.executeToolDirectly).toHaveBeenCalledTimes(2);
    expect(rEna).toMatchObject({ success: true, result: { id: `${P}contact_ena` } });
    expect(await db.aiExecutionLog.findFirst({ where: { businessId: ID.bizA, idempotencyKey: keyEna } })).toMatchObject({
      success: true,
      errorMessage: null,
    });
  });
});
