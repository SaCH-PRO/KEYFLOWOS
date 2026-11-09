/**
 * V1-10-KEY-PLANNER-CLAIM: KEY plan execution claims the plan atomically and
 * records approval pauses correctly (REAL database). #174 KEY-01/02, PRS-M24
 * and PRS-M25.
 *
 * KeyCortexPlannerService.executePlan is the one saga driver that runs plan
 * steps in production (POST cortex/plans/:planId/execute, the trigger service,
 * the query pipeline). Two defects were read from main:
 *   - PRS-M24: it set the plan 'running' unconditionally, so two concurrent
 *     executes of one plan (a double submit) both ran every step, and every
 *     external effect happened twice; a completed plan ran again on a re-post.
 *     R0-09e's repair (review ST-2) already claims the plan in one conditional
 *     write over RUNNABLE_PLAN_STATUSES on this base, so the claim cases below
 *     are regression controls (a mutation that puts back the unconditional
 *     write turns them red: each step routed twice); the one red case left is
 *     the refusal, which now names the plan 'not claimable'.
 *   - PRS-M25: a step the executor parks for approval (`approvalStatus` in the
 *     result) stops the plan, but the final status was read from the steps as
 *     loaded BEFORE the run (all 'pending'), so the pause was recorded as a
 *     failure: the plan 'failed', its saga 'failed' and a failed plan result
 *     written, for a plan that was only waiting for a human.
 *
 * Required, and pinned here: each step of a plan runs exactly once however
 * many executes race for it; the loser is refused 409 'not claimable' before
 * it routes anything or starts a saga; a completed plan re-runs nothing. A step
 * that waits for approval leaves the plan 'waiting_approval' (not failed), its
 * saga open ('running', not failed or compensated, the parked step still
 * pending) and no plan result. A step that fails still fails the plan and its
 * saga (regression control). R0-09e's behaviour is kept: a member's execute
 * runs every step as that member, and each step writes one ai_execution_logs
 * row naming its actor.
 *
 * Review repairs (V1-10 review ST-1..ST-3), pinned in the last describe:
 *   - ST-1: the pausing run's saga was left 'running' with no completedAt, and
 *     nothing ever closes it (an approval runs the parked step outside the
 *     saga). It is now closed as 'stopped_for_approval' (completedAt set,
 *     neither failed nor compensated; the parked saga step names its approval
 *     request), so no saga is left claiming work in flight. The two pause cases
 *     below were updated from 'running' to that closed record.
 *   - ST-2: Run on a paused plan re-ran the steps that had completed and parked
 *     the paused step a second time (a second approval request). A step that
 *     completed in the run that paused is not run again and a parked step is
 *     not parked again, so Run on a still-paused plan routes nothing, parks
 *     nothing and starts no saga (also for a pause the V1 base recorded as
 *     'failed').
 *   - ST-3: skipApproval from the request body skipped the business's approval
 *     policy for any member allowed to run the plan. It is honoured only for
 *     the business OWNER or SUPER_ADMIN; for a STAFF creator or a system caller
 *     the step follows the policy.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL,
 * KeyCortexPlannerService (claim, run, final status), KeyCortexSagaService
 * (saga_executions and saga_steps rows), KeyCortexExecutorService (the
 * business's approval policy read from its real BusinessSetting row, the
 * approval park, the ai_execution_logs audit row), the AiPlan / AiPlanStep /
 * AiPlanResult rows. Stand-ins: the connector the executor routes through (it
 * records every command it is handed, the external effect this packet counts,
 * and answers success after a short delay so concurrent executes interleave;
 * no adapter or provider is reached); the autonomy orchestrator (allows);
 * PlannerService (plan creation is not exercised: plans are seeded directly).
 *
 * Every seeded row carries the `v10a_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v10a_';

const ID = {
  owner: `${P}owner`, // OWNER membership of biz and Business.ownerId
  staff: `${P}staff`, // STAFF membership of biz (may run only the plans it created)
  superAdmin: `${P}super`, // User.role SUPER_ADMIN, no membership
  biz: `${P}biz`,
};

/** The action the business's approval policy always parks (aiAlwaysRequireApproval). */
const NEEDS_APPROVAL = { module: 'communications', action: 'send_message' };
const NOTE = { module: 'crm', action: 'create_note' };
const TASK = { module: 'crm', action: 'create_task' };
/** The connector stand-in answers failure for this action. */
const FAILS = { module: 'crm', action: 'k10_always_fails' };

/** How long the connector stand-in takes per command, so concurrent executes interleave. */
const CONNECTOR_DELAY_MS = 30;

let db: any;
let app: any;
let planner: any;
let executor: any;

interface Routed { marker: unknown; module: unknown; action: unknown; userId: unknown }
/** Every command the executor routed to the connector (the external effect). */
const routed: Routed[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_plans WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM saga_executions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/**
 * A plan in biz, written directly: one AiPlanStep per entry, in order, each
 * carrying a marker (`<planId>_s<n>`) in its input so a routed command names
 * the step it ran.
 */
async function seedPlan(
  id: string,
  steps: Array<{ module: string; action: string }>,
  userId: string | null = ID.owner,
  /** A plan as an earlier run left it: its status and each step's status. */
  as?: { status: string; stepStatuses: string[] },
) {
  await db.aiPlan.create({
    data: {
      id, businessId: ID.biz, userId, objective: `v10a ${id}`, status: as?.status ?? 'pending',
      steps: {
        create: steps.map((s, i) => ({
          id: `${id}_s${i + 1}`, order: i + 1, module: s.module, action: s.action,
          toolName: `${s.module}.${s.action}`, inputPayload: { marker: `${id}_s${i + 1}` },
          ...(as ? { status: as.stepStatuses[i] } : {}),
        })),
      },
    },
  });
}

const planRow = (id: string) => db.aiPlan.findUnique({
  where: { id },
  select: {
    status: true, startedAt: true, completedAt: true,
    steps: { select: { id: true, status: true }, orderBy: { order: 'asc' } },
    result: { select: { id: true } },
  },
});

/** How many times each step of `planId` was routed, by step marker. */
function routedPerStep(planId: string, from = 0): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of routed.slice(from)) {
    if (typeof r.marker === 'string' && r.marker.startsWith(`${planId}_s`)) counts[r.marker] = (counts[r.marker] ?? 0) + 1;
  }
  return counts;
}

const sagaCount = () => db.sagaExecution.count({ where: { businessId: ID.biz } });
const auditCount = () => db.aiExecutionLog.count({ where: { businessId: ID.biz } });
const asOwner = () => ({ userId: ID.owner, role: 'USER', businessId: ID.biz });
const asStaff = () => ({ userId: ID.staff, role: 'USER', businessId: ID.biz });
const asSuperAdmin = () => ({ userId: ID.superAdmin, role: 'SUPER_ADMIN', businessId: ID.biz });

/** The approval requests the executor holds for `planId`'s steps, by step marker. */
function approvalsFor(planId: string): string[] {
  return [...executor.pendingApprovals.values()]
    .map((r: any) => r?.command?.parameters?.marker)
    .filter((m: unknown): m is string => typeof m === 'string' && m.startsWith(`${planId}_s`));
}

/** Settle every promise; the fulfilled values and the rejection reasons, apart. */
async function race<T>(calls: Array<() => Promise<T>>) {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return {
    fulfilled: settled.filter((s): s is PromiseFulfilledResult<Awaited<T>> => s.status === 'fulfilled').map((s) => s.value),
    rejected: settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected').map((s) => s.reason),
  };
}

/** The loser of a claim: 409, before anything ran (the wording is pinned on its own case). */
function expectConflict(reason: unknown) {
  expect(reason, String(reason)).toBeInstanceOf(ConflictException);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves (no request scope here, so no tenant is ambient).
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexSagaService } = await import('../src/modules/key-cortex/key-cortex-saga.service');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');

  // The connector stand-in: records what it is handed and answers after a delay.
  const connector = {
    getAllCapabilities: () => [],
    execute: async (c: any) => {
      routed.push({ marker: c?.parameters?.marker, module: c?.module, action: c?.action, userId: c?.userId });
      await new Promise((r) => setTimeout(r, CONNECTOR_DELAY_MS));
      if (c?.action === FAILS.action) return { success: false, error: 'v10a: the step failed', executionTimeMs: CONNECTOR_DELAY_MS, command: c };
      return { success: true, data: { done: c?.parameters?.marker ?? null }, executionTimeMs: CONNECTOR_DELAY_MS, command: c };
    },
  };
  const autonomy = { evaluateAction: async () => ({ allowed: true, requiresApproval: false }) };
  const legacyGateOff = { checkGate: async () => { throw new Error('v10a: the legacy autonomy gate is off this path'); } };
  const events = { emit: () => true };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      {
        provide: KeyCortexExecutorService,
        useFactory: (prisma: any) => new KeyCortexExecutorService(
          connector as any, prisma, events as any, legacyGateOff as any, autonomy as any, undefined, undefined,
        ),
        inject: [PrismaService],
      },
      {
        provide: KeyCortexSagaService,
        useFactory: (prisma: any) => new KeyCortexSagaService(prisma),
        inject: [PrismaService],
      },
      {
        // No AiUsageService and no compensation service, as R0-09e's suite wires it.
        provide: KeyCortexPlannerService,
        useFactory: (prisma: any, exec: any, saga: any) => new KeyCortexPlannerService(prisma, {} as any, exec, saga),
        inject: [PrismaService, KeyCortexExecutorService, KeyCortexSagaService],
      },
    ],
  }).compile();
  app = moduleRef;
  await app.init();
  planner = moduleRef.get(KeyCortexPlannerService);
  executor = moduleRef.get(KeyCortexExecutorService);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.superAdmin, email: `${P}super@test.local`, role: 'SUPER_ADMIN' } });
  await db.business.create({ data: { id: ID.biz, name: 'V10A Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  // KEY-R3b-PLAN-AUTHORITY (D-71): a plan step needs the running member's scope for its module, so
  // the STAFF member these cases run its own crm and communications steps as holds crm and content
  // write (role defaults otherwise: revenue stays read, which KP-02 and KP-05 need).
  const { defaultScopesForRole } = await import('../src/core/authority/module-vocabulary');
  await db.membership.create({
    data: {
      id: `${P}m_staff`, userId: ID.staff, businessId: ID.biz, role: 'STAFF',
      permissionScopes: { ...defaultScopesForRole('STAFF'), crm: 'write', content: 'write' },
    },
  });
  // Full autonomy, except the one action every case that pauses uses.
  await db.businessSetting.create({
    data: {
      id: `${P}setting`, businessId: ID.biz, aiAutonomyLevel: 'full',
      aiAlwaysRequireApproval: [`${NEEDS_APPROVAL.module}.${NEEDS_APPROVAL.action}`],
    },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (executor?.approvalCleanupInterval) clearInterval(executor.approvalCleanupInterval);
  if (app) await app.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it("biz has its OWNER (membership and Business.ownerId), one STAFF member, a SUPER_ADMIN user with no membership, and a full-autonomy policy that parks communications.send_message only", async () => {
    expect(await db.membership.findMany({ where: { businessId: ID.biz }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } })).toEqual([
      { userId: ID.owner, role: 'OWNER' },
      { userId: ID.staff, role: 'STAFF' },
    ]);
    expect(await db.user.findUnique({ where: { id: ID.superAdmin }, select: { role: true } })).toEqual({ role: 'SUPER_ADMIN' });
    expect(await db.business.findUnique({ where: { id: ID.biz }, select: { ownerId: true } })).toEqual({ ownerId: ID.owner });
    const asCommand = (s: { module: string; action: string }) => ({
      module: s.module as any, action: s.action, parameters: {}, businessId: ID.biz, userId: ID.owner, source: 'key_cortex', timestamp: new Date(),
    });
    expect(await executor.requiresApproval(asCommand(NEEDS_APPROVAL))).toBe(true);
    expect(await executor.requiresApproval(asCommand(NOTE))).toBe(false);
    expect(await executor.requiresApproval(asCommand(TASK))).toBe(false);
  });
});

/**
 * PRS-M24 (#174 KEY-01). A double submit of one plan ran every step twice.
 * Required: the plan is claimed in one conditional write
 * (aiPlan.updateMany over RUNNABLE_PLAN_STATUSES, count === 1), so exactly one
 * execute runs it and every other is refused 'not claimable' before it routes
 * anything or starts a saga.
 */
describe('a plan is claimed once: concurrent or repeated executes run each step exactly once (PRS-M24)', () => {
  it("regression control (claim landed in R0-09e): two concurrent executePlan(planId) calls on a 2-step plan: each step runs exactly once, one saga starts, and the second call is refused 409", async () => {
    const planId = `${P}plan_concurrent`;
    await seedPlan(planId, [NOTE, TASK]);
    const sagas = await sagaCount();
    const audits = await auditCount();
    const from = routed.length;

    const { fulfilled, rejected } = await race([() => planner.executePlan(planId), () => planner.executePlan(planId)]);

    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1, [`${planId}_s2`]: 1 });
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ planId, status: 'completed', executed: 2 });
    expect(rejected).toHaveLength(1);
    expectConflict(rejected[0]);
    expect(await sagaCount()).toBe(sagas + 1);
    // R0-09e: one ai_execution_logs row per step run, none for the refused call.
    expect(await auditCount()).toBe(audits + 2);
    const row = await planRow(planId);
    expect(row).toMatchObject({ status: 'completed' });
    expect(row.steps.map((s: any) => s.status)).toEqual(['completed', 'completed']);
  });

  it("regression control (claim landed in R0-09e): three concurrent executes by the OWNER: one runs both steps as the OWNER, the other two are refused 409", async () => {
    const planId = `${P}plan_concurrent_member`;
    await seedPlan(planId, [NOTE, TASK]);
    const sagas = await sagaCount();
    const from = routed.length;

    const { fulfilled, rejected } = await race([
      () => planner.executePlan(planId, {}, asOwner()),
      () => planner.executePlan(planId, {}, asOwner()),
      () => planner.executePlan(planId, {}, asOwner()),
    ]);

    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1, [`${planId}_s2`]: 1 });
    expect(routed.slice(from).filter((r) => String(r.marker).startsWith(planId)).map((r) => r.userId)).toEqual([ID.owner, ID.owner]);
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ status: 'completed', executed: 2 });
    expect(rejected).toHaveLength(2);
    for (const reason of rejected) expectConflict(reason);
    expect(await sagaCount()).toBe(sagas + 1);
  });

  it("regression control (claim landed in R0-09e): a completed plan re-runs nothing: a second execute (system trigger or member) is refused 409, routes nothing, starts no saga and writes no audit row", async () => {
    const planId = `${P}plan_completed`;
    await seedPlan(planId, [NOTE, TASK]);
    const first = await planner.executePlan(planId);
    expect(first).toMatchObject({ status: 'completed', executed: 2 });
    const completed = await planRow(planId);
    const sagas = await sagaCount();
    const audits = await auditCount();
    const from = routed.length;

    for (const again of [() => planner.executePlan(planId), () => planner.executePlan(planId, {}, asOwner())]) {
      const { fulfilled, rejected } = await race([again]);
      expect(fulfilled).toEqual([]);
      expectConflict(rejected[0]);
    }

    expect(routedPerStep(planId, from)).toEqual({});
    expect(await sagaCount()).toBe(sagas);
    expect(await auditCount()).toBe(audits);
    expect(await planRow(planId)).toEqual(completed);
  });

  it("RED-BEFORE: the refused execute says the plan is 'not claimable' (a running plan and a completed one alike)", async () => {
    const planId = `${P}plan_not_claimable`;
    await seedPlan(planId, [NOTE]);
    const { fulfilled, rejected } = await race([() => planner.executePlan(planId), () => planner.executePlan(planId)]);
    expect(fulfilled).toHaveLength(1);
    const { rejected: again } = await race([() => planner.executePlan(planId, {}, asOwner())]);
    for (const reason of [...rejected, ...again]) {
      expectConflict(reason);
      expect(String((reason as Error).message)).toMatch(/not claimable/);
    }
    expect(rejected.length + again.length).toBe(2);
  });
});

/**
 * PRS-M25 (#174 KEY-02). A step parked for approval stopped the plan, and the
 * final status was read from the steps loaded before the run, so the pause was
 * recorded as a failure: the plan 'failed', its saga failSaga'd and a failed
 * plan result written. Required: the plan is 'waiting_approval', the saga is
 * left open (not failed, not compensated), and no plan result is written.
 */
describe('an approval pause is recorded as a pause, not a failure (PRS-M25)', () => {
  it("RED-BEFORE: step 2 of 2 needs approval: step 1 runs once, step 2 is parked and not routed; the plan is waiting_approval, its saga is closed 'stopped_for_approval' (not failed, not left running), and no plan result is written", async () => {
    const planId = `${P}plan_pause_step2`;
    await seedPlan(planId, [NOTE, NEEDS_APPROVAL]);
    const audits = await auditCount();
    const from = routed.length;

    const result = await planner.executePlan(planId, {}, asOwner());

    expect(result).toMatchObject({ planId, status: 'waiting_approval', executed: 2 });
    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1 });
    const row = await planRow(planId);
    expect(row).toMatchObject({ status: 'waiting_approval', completedAt: null, result: null });
    expect(row.steps.map((s: any) => s.status)).toEqual(['completed', 'waiting_approval']);

    const saga = await db.sagaExecution.findUnique({
      where: { id: result.sagaId },
      select: { businessId: true, status: true, completedAt: true, steps: { select: { stepIndex: true, status: true }, orderBy: { stepIndex: 'asc' } } },
    });
    // Review ST-1: the saga is closed (completedAt set), neither failed nor
    // compensated, and its parked step is marked as waiting for approval: the
    // approval runs that step outside this saga, so nothing would close it.
    expect(saga).toEqual({
      businessId: ID.biz, status: 'stopped_for_approval', completedAt: expect.any(Date),
      steps: [{ stepIndex: 0, status: 'completed' }, { stepIndex: 1, status: 'waiting_approval' }],
    });
    const parked = await db.sagaStep.findFirst({ where: { sagaId: result.sagaId, stepIndex: 1 }, select: { output: true, completedAt: true } });
    expect(parked).toEqual({ output: { approvalStatus: 'pending', approvalId: expect.any(String) }, completedAt: null });
    expect(approvalsFor(planId)).toEqual([`${planId}_s2`]);
    // The executor still writes its row for each step (R0-09e): the run, then the park.
    const rows = await db.aiExecutionLog.findMany({
      where: { businessId: ID.biz }, orderBy: { createdAt: 'desc' }, take: 2,
      select: { userId: true, action: true, success: true, errorMessage: true },
    });
    expect(await auditCount()).toBe(audits + 2);
    expect(rows.reverse()).toEqual([
      { userId: ID.owner, action: NOTE.action, success: true, errorMessage: null },
      { userId: ID.owner, action: NEEDS_APPROVAL.action, success: false, errorMessage: 'Approval pending' },
    ]);
  });

  it("RED-BEFORE: step 1 of 2 needs approval: nothing is routed, step 2 does not run; the plan is waiting_approval and its saga is closed 'stopped_for_approval', not failed", async () => {
    const planId = `${P}plan_pause_step1`;
    await seedPlan(planId, [NEEDS_APPROVAL, TASK], null);
    const from = routed.length;

    const result = await planner.executePlan(planId);

    expect(result).toMatchObject({ planId, status: 'waiting_approval', executed: 1 });
    expect(routedPerStep(planId, from)).toEqual({});
    const row = await planRow(planId);
    expect(row).toMatchObject({ status: 'waiting_approval', completedAt: null, result: null });
    // The step after the pause is not run (left 'skipped', as before this packet).
    expect(row.steps.map((s: any) => s.status)).toEqual(['waiting_approval', 'skipped']);
    const saga = await db.sagaExecution.findUnique({ where: { id: result.sagaId }, select: { status: true, completedAt: true } });
    expect(saga).toEqual({ status: 'stopped_for_approval', completedAt: expect.any(Date) });
  });

  it("regression control: a step that fails still fails the plan and its saga and records a plan result", async () => {
    const planId = `${P}plan_fails`;
    await seedPlan(planId, [NOTE, FAILS]);
    const from = routed.length;

    const result = await planner.executePlan(planId);

    expect(result).toMatchObject({ planId, status: 'failed', executed: 2 });
    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1, [`${planId}_s2`]: 1 });
    const row = await planRow(planId);
    expect(row).toMatchObject({ status: 'failed', completedAt: null });
    expect(row.result).not.toBeNull();
    expect(row.steps.map((s: any) => s.status)).toEqual(['completed', 'failed']);
    const saga = await db.sagaExecution.findUnique({ where: { id: result.sagaId }, select: { status: true } });
    expect(saga).toEqual({ status: 'failed' });
  });
});

/**
 * V1-10 review repairs. ST-1: a paused plan left its saga 'running' for ever.
 * ST-2: Run on a paused plan repeated the steps that had completed and parked
 * the paused step again (a second approval request, so two approvals ran it
 * twice). ST-3: the request body's skipApproval bypassed the business's
 * approval policy for any member allowed to run the plan.
 */
describe('review repairs: a paused plan is not re-run, its saga is closed, and only the OWNER or SUPER_ADMIN may skip approval', () => {
  it("RED-BEFORE (ST-1, ST-2): Run twice on a plan that pauses at step 2 (OWNER): step 1 is routed once, step 2 is parked once, the second Run routes, parks and audits nothing and starts no saga, and no saga is left 'running'", async () => {
    const planId = `${P}plan_rerun_owner`;
    await seedPlan(planId, [NOTE, NEEDS_APPROVAL]);
    const sagas = await sagaCount();
    const audits = await auditCount();
    const from = routed.length;

    const first = await planner.executePlan(planId, {}, asOwner());
    expect(first).toMatchObject({ planId, status: 'waiting_approval', executed: 2 });
    const second = await planner.executePlan(planId, {}, asOwner());

    expect(second).toEqual({ planId, status: 'waiting_approval', executed: 0, sagaId: null });
    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1 });
    expect(approvalsFor(planId)).toEqual([`${planId}_s2`]);
    expect(await auditCount()).toBe(audits + 2);
    expect(await sagaCount()).toBe(sagas + 1);
    const saga = await db.sagaExecution.findUnique({ where: { id: first.sagaId }, select: { status: true, completedAt: true } });
    expect(saga).toEqual({ status: 'stopped_for_approval', completedAt: expect.any(Date) });
    const row = await planRow(planId);
    expect(row).toMatchObject({ status: 'waiting_approval', completedAt: null, result: null });
    expect(row.steps.map((s: any) => s.status)).toEqual(['completed', 'waiting_approval']);
    // Every saga this suite started has been closed.
    expect(await db.sagaExecution.count({ where: { businessId: ID.biz, status: 'running' } })).toBe(0);
  });

  it("RED-BEFORE (ST-2): the same for a STAFF creator on its own plan: step 1 is routed once, as the STAFF member, and step 2 is parked once", async () => {
    const planId = `${P}plan_rerun_staff`;
    await seedPlan(planId, [NOTE, NEEDS_APPROVAL], ID.staff);
    const sagas = await sagaCount();
    const from = routed.length;

    expect(await planner.executePlan(planId, {}, asStaff())).toMatchObject({ status: 'waiting_approval', executed: 2 });
    expect(await planner.executePlan(planId, {}, asStaff())).toEqual({ planId, status: 'waiting_approval', executed: 0, sagaId: null });

    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1 });
    expect(routed.slice(from).filter((r) => String(r.marker).startsWith(planId)).map((r) => r.userId)).toEqual([ID.staff]);
    expect(approvalsFor(planId)).toEqual([`${planId}_s2`]);
    expect(await sagaCount()).toBe(sagas + 1);
    expect((await planRow(planId)).steps.map((s: any) => s.status)).toEqual(['completed', 'waiting_approval']);
  });

  it("RED-BEFORE (ST-2): a pause the V1 base recorded as 'failed' (steps completed, waiting_approval, skipped) is not re-run either: nothing is routed or parked, no saga starts, and the plan is recorded waiting_approval", async () => {
    const planId = `${P}plan_legacy_pause`;
    await seedPlan(planId, [NOTE, NEEDS_APPROVAL, TASK], ID.owner, { status: 'failed', stepStatuses: ['completed', 'waiting_approval', 'skipped'] });
    const sagas = await sagaCount();
    const audits = await auditCount();
    const from = routed.length;

    const result = await planner.executePlan(planId, {}, asOwner());

    expect(result).toEqual({ planId, status: 'waiting_approval', executed: 0, sagaId: null });
    expect(routedPerStep(planId, from)).toEqual({});
    expect(approvalsFor(planId)).toEqual([]);
    expect(await sagaCount()).toBe(sagas);
    expect(await auditCount()).toBe(audits);
    const row = await planRow(planId);
    expect(row).toMatchObject({ status: 'waiting_approval', completedAt: null });
    expect(row.steps.map((s: any) => s.status)).toEqual(['completed', 'waiting_approval', 'skipped']);
  });

  it('regression control: two concurrent executes of a plan that pauses at step 2: step 1 is routed once and step 2 parked once', async () => {
    const planId = `${P}plan_pause_concurrent`;
    await seedPlan(planId, [NOTE, NEEDS_APPROVAL]);
    const from = routed.length;

    const { fulfilled, rejected } = await race([() => planner.executePlan(planId, {}, asOwner()), () => planner.executePlan(planId, {}, asOwner())]);

    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1 });
    expect(approvalsFor(planId)).toEqual([`${planId}_s2`]);
    expect(fulfilled.map((f: any) => f.status).sort()).toEqual(fulfilled.length === 2 ? ['waiting_approval', 'waiting_approval'] : ['waiting_approval']);
    for (const reason of rejected) expectConflict(reason);
  });

  it("RED-BEFORE (ST-3): a STAFF creator's skipApproval does not bypass the business's approval policy: the step is parked and nothing is routed", async () => {
    const planId = `${P}plan_skip_staff`;
    await seedPlan(planId, [NEEDS_APPROVAL], ID.staff);
    const from = routed.length;

    const result = await planner.executePlan(planId, { skipApproval: true }, asStaff());

    expect(result).toMatchObject({ planId, status: 'waiting_approval', executed: 1 });
    expect(routedPerStep(planId, from)).toEqual({});
    expect(approvalsFor(planId)).toEqual([`${planId}_s1`]);
    expect((await planRow(planId)).steps.map((s: any) => s.status)).toEqual(['waiting_approval']);
  });

  it("RED-BEFORE (ST-3): a system caller's skipApproval (no member) does not bypass the policy either", async () => {
    const planId = `${P}plan_skip_system`;
    await seedPlan(planId, [NEEDS_APPROVAL], null);
    const from = routed.length;

    const result = await planner.executePlan(planId, { skipApproval: true });

    expect(result).toMatchObject({ planId, status: 'waiting_approval', executed: 1 });
    expect(routedPerStep(planId, from)).toEqual({});
    expect(approvalsFor(planId)).toEqual([`${planId}_s1`]);
  });

  it("regression control (ST-3): the OWNER's skipApproval and SUPER_ADMIN's are still honoured: the step runs once, as that actor, and nothing is parked", async () => {
    for (const [planId, creator, actor] of [
      [`${P}plan_skip_owner`, ID.owner, asOwner()],
      [`${P}plan_skip_super`, null, asSuperAdmin()],
    ] as const) {
      await seedPlan(planId, [NEEDS_APPROVAL], creator);
      const from = routed.length;

      const result = await planner.executePlan(planId, { skipApproval: true }, actor);

      expect(result, planId).toMatchObject({ planId, status: 'completed', executed: 1 });
      expect(routedPerStep(planId, from), planId).toEqual({ [`${planId}_s1`]: 1 });
      expect(routed.slice(from).filter((r) => String(r.marker).startsWith(planId)).map((r) => r.userId), planId).toEqual([actor.userId]);
      expect(approvalsFor(planId), planId).toEqual([]);
    }
  });
});

/**
 * Trial-N repair round 2, KEY-PLANS-D46 (blocking). POST cortex/plans/:planId/execute ran every
 * step of a member's plan through the commerce adapter, which writes as KEY_SYSTEM_ACTOR_ID, so the
 * service membership check that refuses a non-member SUPER_ADMIN over HTTP never ran:
 * assertMayExecutePlan returned at once for SUPER_ADMIN, and a STAFF creator with revenue read ran
 * commerce.create_invoice on their own plan. Required: a plan with a step that writes the business's
 * invoices or payments (the commerce module, the revenue scope) runs only for a member who holds
 * revenue write (the OWNER by its role); a SUPER_ADMIN who is not a member is refused (D-46). The
 * refusal comes before the claim: nothing is routed, no saga starts and the plan is left as it was.
 */
describe('Trial-N repair round 2: KEY plans that write invoices or payments (D-46)', () => {
  const INVOICE = { module: 'commerce', action: 'create_invoice' };
  const PAYMENT = { module: 'commerce', action: 'process_payment' };

  it('KP-01 a platform SUPER_ADMIN who is not a member of the business is refused a plan that writes its invoices and payments: 403, nothing routed, no saga, the plan still pending', async () => {
    const planId = `${P}plan_d46_super`;
    await seedPlan(planId, [INVOICE, PAYMENT], null);
    const from = routed.length;
    const sagas = await sagaCount();

    const err = await planner.executePlan(planId, {}, asSuperAdmin()).catch((e: unknown) => e);

    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/not a member/i);
    expect(routedPerStep(planId, from)).toEqual({});
    expect(await sagaCount()).toBe(sagas);
    expect(await planRow(planId)).toMatchObject({ status: 'pending', startedAt: null });
  });

  it('KP-02 a STAFF creator holding revenue read only (its role defaults) is refused its own plan that creates an invoice: 403 and nothing routed', async () => {
    const planId = `${P}plan_d46_staff`;
    await seedPlan(planId, [INVOICE], ID.staff);
    const from = routed.length;

    const err = await planner.executePlan(planId, {}, asStaff()).catch((e: unknown) => e);

    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/revenue requires write/);
    expect(routedPerStep(planId, from)).toEqual({});
    expect((await planRow(planId)).status).toBe('pending');
  });

  it('KP-03 regression control: the OWNER runs the same invoice plan, every step once as the OWNER; a SUPER_ADMIN still runs a plan that writes no invoice', async () => {
    const planId = `${P}plan_d46_owner`;
    await seedPlan(planId, [INVOICE, PAYMENT], ID.owner);
    const from = routed.length;
    expect(await planner.executePlan(planId, {}, asOwner())).toMatchObject({ planId, status: 'completed', executed: 2 });
    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1, [`${planId}_s2`]: 1 });
    expect(routed.slice(from).filter((r) => String(r.marker).startsWith(planId)).map((r) => r.userId)).toEqual([ID.owner, ID.owner]);

    const notes = `${P}plan_d46_super_notes`;
    await seedPlan(notes, [NOTE], null);
    expect(await planner.executePlan(notes, {}, asSuperAdmin())).toMatchObject({ planId: notes, status: 'completed', executed: 1 });
  });
});

/**
 * Trial-N repair round 2, recheck KEY-D46-NOMEMBER (blocking). The D-46 and revenue-write check
 * above ran only when executePlan was handed a member (POST cortex/plans/:planId/execute). The
 * query pipeline (POST cortex/chat: processQuery -> createPlanFromGoal(query.userId) ->
 * executePlan(plan.id, { traceId })) and the cortex triggers call it with no member, and a
 * member's plan then ran as plan.userId with no check: a non-member SUPER_ADMIN (BusinessGuard
 * admits one) or a STAFF member holding revenue read had commerce steps run. Required (D-46 covers
 * every path): with no member, a plan that writes the business's invoices or payments runs as its
 * creator only when that creator could run it over HTTP: a SUPER_ADMIN who is a member, or a member
 * holding revenue write (the OWNER by its role). Otherwise 403 before the claim: nothing routed,
 * no saga, the plan left as it was. The creator's role is read from its User row.
 */
describe('Trial-N repair round 2 recheck: KEY plans run with no member (query pipeline, triggers) that write invoices or payments (D-46)', () => {
  const INVOICE = { module: 'commerce', action: 'create_invoice' };
  const PAYMENT = { module: 'commerce', action: 'process_payment' };

  it('KP-04 a plan created by a platform SUPER_ADMIN who is not a member, run with no member (the query pipeline), is refused: 403, nothing routed, no saga, the plan still pending', async () => {
    const planId = `${P}plan_d46_nomember_super`;
    await seedPlan(planId, [INVOICE, PAYMENT], ID.superAdmin);
    const from = routed.length;
    const sagas = await sagaCount();

    const err = await planner.executePlan(planId, { traceId: 'v10a_kp04' }).catch((e: unknown) => e);

    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/not a member/i);
    expect(routedPerStep(planId, from)).toEqual({});
    expect(await sagaCount()).toBe(sagas);
    expect(await planRow(planId)).toMatchObject({ status: 'pending', startedAt: null });
  });

  it('KP-05 a plan created by a STAFF member holding revenue read only, run with no member (a trigger), is refused: 403 and nothing routed', async () => {
    const planId = `${P}plan_d46_nomember_staff`;
    await seedPlan(planId, [INVOICE], ID.staff);
    const from = routed.length;

    const err = await planner.executePlan(planId, {}).catch((e: unknown) => e);

    expect(err, String(err)).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toMatch(/revenue requires write/);
    expect(routedPerStep(planId, from)).toEqual({});
    expect((await planRow(planId)).status).toBe('pending');
  });

  it("KP-06 regression control: with no member, the OWNER's invoice plan runs every step once as the OWNER, and a STAFF member's plan that writes no invoice runs as that member", async () => {
    const planId = `${P}plan_d46_nomember_owner`;
    await seedPlan(planId, [INVOICE, PAYMENT], ID.owner);
    const from = routed.length;
    expect(await planner.executePlan(planId, {})).toMatchObject({ planId, status: 'completed', executed: 2 });
    expect(routedPerStep(planId, from)).toEqual({ [`${planId}_s1`]: 1, [`${planId}_s2`]: 1 });
    expect(routed.slice(from).filter((r) => String(r.marker).startsWith(planId)).map((r) => r.userId)).toEqual([ID.owner, ID.owner]);

    const notes = `${P}plan_d46_nomember_staff_notes`;
    const notesFrom = routed.length;
    await seedPlan(notes, [NOTE], ID.staff);
    expect(await planner.executePlan(notes, {})).toMatchObject({ planId: notes, status: 'completed', executed: 1 });
    expect(routed.slice(notesFrom).filter((r) => String(r.marker).startsWith(notes)).map((r) => r.userId)).toEqual([ID.staff]);
  });
});
