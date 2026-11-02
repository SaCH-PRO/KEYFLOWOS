/**
 * V1-32-KEY-PROPOSAL-CLAIM: a KeyActionProposal is executed by one atomic
 * claim, and only while the person who approved it still holds the authority
 * they approved it under (REAL database). M46 and CF-29
 * (KEY-PROPOSAL-CLAIM-001): read-then-update allows double execution.
 *
 * KeyActionProposalService.execute is the one door every non-boundary proposal
 * is executed through (POST key-autonomy/.../proposals/:id/execute via
 * KeyCortexApprovalOrchestratorService.executeApproved, and the approve route's
 * autoExecute). Two defects were read from the V1 base
 * (key-action-proposal.service.ts:245-390):
 *   - The status check and the EXECUTING write are separate statements: the
 *     proposal is read, checked for 'APPROVED', evaluated, and then written
 *     EXECUTING unconditionally. Two concurrent executes (a double submit, a
 *     retry, a second tab) both pass the check, both write EXECUTING and both
 *     run the executor plugin, so the effect happens twice. A proposal that is
 *     cancelled between the read and the write is executed anyway.
 *   - The approval is a status and a name. Nothing re-reads the approver at
 *     execution: an approval given by a member who has since been removed,
 *     demoted, banned or deleted still executes the action.
 *
 * Required, and pinned here: the EXECUTING write is the claim, one conditional
 * write (keyActionProposal.updateMany on {id, businessId, status 'APPROVED'})
 * that only one execute can win (count === 1). Every other execute is refused
 * 409 before the executor runs or a 'key.action.executing' event is emitted,
 * and writes nothing. In the claim's transaction the approver is re-read on
 * locked rows (user, business, membership); an approver who no longer has
 * authority in the business, or whose authority is less than the one recorded
 * when they approved (basis, membership row or approval tier), blocks the
 * execution with 403. The approval then no longer stands: the proposal goes
 * back to PENDING with the reason recorded (as the action boundary does for
 * EVIDENCE_PRINCIPAL_REVOKED / EVIDENCE_AUTHORITY_CHANGED), so a member who
 * does hold the authority can approve it again. An APPROVED row with no
 * recorded authority (approved before this change) is held to the removal
 * rule only; one with no named approver at all does not execute.
 *
 * WHAT IS REAL: PrismaService and the Prisma client against DATABASE_URL,
 * KeyActionProposalService (create, approve, execute, the claim and the
 * approver re-read), KeyActionPolicyService, KeyActionBoundaryService (which
 * answers "not mine" for CREATE_TASK from its own code), the key_action_proposals,
 * users, businesses and memberships rows. Stand-ins: the executor plugin (it
 * records every proposal it is handed, the external effect this packet counts,
 * and answers success after a short delay so concurrent executes overlap; no
 * plugin or provider is reached), the temporal event sink (records), the
 * autonomy orchestrator (allows; a test can hold it to line concurrent
 * executes up after their status check) and the genome policy (allows).
 *
 * Every seeded row carries the `v32a_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v32a_';

const ID = {
  owner: `${P}owner`, // OWNER membership of biz and Business.ownerId
  admin: `${P}admin`, // ADMIN membership of biz (approval tier 3 by role default)
  staff: `${P}staff`, // STAFF membership of biz (approval tier 0 by role default)
  biz: `${P}biz`,
  mOwner: `${P}m_owner`,
  mAdmin: `${P}m_admin`,
  mStaff: `${P}m_staff`,
};

/** How long the executor stand-in takes, so concurrent executes overlap. */
const EXECUTOR_DELAY_MS = 40;

let db: any;
let app: any;
let proposals: any;

/** Every proposal the executor plugin was handed (the external effect). */
const executions: Array<{ proposalId: string; executedBy: unknown }> = [];
/** Every lifecycle event the service emitted. */
const temporalEvents: Array<{ type: string; entityId: string; payload: any }> = [];
/** Runs inside the autonomy evaluation, i.e. after execute's status check and before its EXECUTING write. */
let onEvaluate: ((proposalId: string) => Promise<void>) | null = null;

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

async function seedMemberships() {
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`);
  await db.membership.create({ data: { id: ID.mOwner, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({ data: { id: ID.mAdmin, userId: ID.admin, businessId: ID.biz, role: 'ADMIN' } });
  await db.membership.create({ data: { id: ID.mStaff, userId: ID.staff, businessId: ID.biz, role: 'STAFF' } });
}

/** A barrier: each caller waits until `n` have arrived (or a timeout, so unfixed code cannot hang). */
function barrier(n: number, timeoutMs = 3000) {
  let arrived = 0;
  let release!: () => void;
  const all = new Promise<void>((r) => { release = r; });
  const timer = setTimeout(() => release(), timeoutMs);
  return async () => {
    arrived += 1;
    if (arrived >= n) { clearTimeout(timer); release(); }
    await all;
  };
}

/** Settle every promise; the fulfilled values and the rejection reasons, apart. */
async function race<T>(calls: Array<() => Promise<T>>) {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return {
    fulfilled: settled.filter((s): s is PromiseFulfilledResult<Awaited<T>> => s.status === 'fulfilled').map((s) => s.value),
    rejected: settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected').map((s) => s.reason),
  };
}

async function settle<T>(p: Promise<T>): Promise<{ ok?: T; err?: any }> {
  try { return { ok: await p }; } catch (err) { return { err }; }
}

/** A CREATE_TASK proposal in biz, proposed by KEY. */
async function propose(title = 'v32a follow up with the supplier') {
  const created = await proposals.create(ID.biz, {
    sourceType: 'EXECUTIVE_MODE',
    sourceMode: 'COO',
    title,
    actionType: 'CREATE_TASK',
    payload: { title },
  });
  return created.id as string;
}

/** A CREATE_TASK proposal approved through the service by `approver`. */
async function approvedBy(approver: string) {
  const id = await propose();
  const approved = await proposals.approve(ID.biz, id, approver);
  expect(approved.status).toBe('APPROVED');
  return id;
}

/** execute(), as KeyCortexApprovalOrchestratorService.executeApproved calls it. */
const execute = (proposalId: string, by: string) => proposals.execute(ID.biz, proposalId, by, true, true);

const ran = (proposalId: string) => executions.filter((e) => e.proposalId === proposalId);
const eventsFor = (proposalId: string, type: string) =>
  temporalEvents.filter((e) => e.entityId === proposalId && e.type === type);

async function row(proposalId: string) {
  const rows: any[] = await db.$queryRawUnsafe(
    `SELECT status, approved_by, approved_at, executed_by, executed_at, failure_reason, execution_result
       FROM key_action_proposals WHERE id = $1`,
    proposalId,
  );
  return rows[0];
}

/** The loser of a claim: 409, before anything ran. */
function expectConflict(reason: unknown) {
  expect(reason, String(reason)).toBeInstanceOf(ConflictException);
}

/** An approval that no longer stands: 403, nothing ran, the proposal waits for a new approval. */
async function expectApprovalLapsed(proposalId: string, outcome: { ok?: unknown; err?: any }) {
  expect(outcome.err, `expected a refusal, but execute returned status ${(outcome.ok as any)?.status}`).toBeInstanceOf(ForbiddenException);
  expect(String(outcome.err.message)).toMatch(/approv/i);
  expect(ran(proposalId)).toHaveLength(0);
  expect(eventsFor(proposalId, 'key.action.executing')).toHaveLength(0);
  expect(eventsFor(proposalId, 'key.action.executed')).toHaveLength(0);
  const after = await row(proposalId);
  expect(after.status).toBe('PENDING');
  expect(after.approved_by).toBeNull();
  expect(after.executed_at).toBeNull();
  expect(after.failure_reason).toMatch(/approv/i);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves (no request scope here, so no tenant is ambient).
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { CapabilityContractService } = await import('../src/modules/capabilities/capability-contract.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyActionPolicyService } = await import('../src/modules/key-autonomy/key-action-policy.service');
  const { KeyActionExecutorService } = await import('../src/modules/key-autonomy/key-action-executor.service');
  const { KeyActionGenomePolicyService } = await import('../src/modules/key-autonomy/key-action-genome-policy.service');
  const { AutonomyOrchestratorService } = await import('../src/modules/key-autonomy/autonomy-orchestrator.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');

  const executor = {
    execute: async (_businessId: string, proposal: { id: string }, executedBy?: string) => {
      executions.push({ proposalId: proposal.id, executedBy });
      await new Promise((r) => setTimeout(r, EXECUTOR_DELAY_MS));
      return { success: true, result: { ran: proposal.id } };
    },
  };
  const temporal = {
    emit: async (e: { type: string; entityId: string; payload: any }) => {
      temporalEvents.push({ type: e.type, entityId: e.entityId, payload: e.payload });
      return {};
    },
  };
  const autonomy = {
    evaluateAction: async (_businessId: string, _actionKey: string, _payload: unknown, ctx: { proposalId: string }) => {
      if (onEvaluate) await onEvaluate(ctx.proposalId);
      return { allowed: true, requiresApproval: false, tier: 'full', confidence: 1, reason: 'v32a: allowed', ruleTrace: [], createdAt: new Date() };
    },
  };
  const genome = {
    evaluateExecution: async () => ({ allowed: true, requiresExtraConfirmation: false, message: 'v32a: allowed', blockedReasons: [], missingFacts: [] }),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PrismaService,
      KeyActionProposalService,
      KeyActionPolicyService,
      KeyActionBoundaryService,
      CapabilityContractService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TemporalFlowService, useValue: temporal },
      { provide: KeyActionExecutorService, useValue: executor },
      { provide: KeyActionGenomePolicyService, useValue: genome },
      { provide: AutonomyOrchestratorService, useValue: autonomy },
    ],
  }).compile();
  app = moduleRef;
  await app.init();
  proposals = moduleRef.get(KeyActionProposalService);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.admin, email: `${P}admin@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V32A Biz', ownerId: ID.owner } });
  await seedMemberships();
}, 120_000);

beforeEach(async () => {
  await db.$executeRawUnsafe(`DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await seedMemberships();
  await db.$executeRawUnsafe(`UPDATE users SET banned_at = NULL, deleted_at = NULL WHERE id LIKE ${sqlLikePrefix(P)}`);
  executions.length = 0;
  temporalEvents.length = 0;
  onEvaluate = null;
});

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('biz has its OWNER (membership and Business.ownerId), one ADMIN and one STAFF member, and a CREATE_TASK proposal is not an action-boundary record', async () => {
    expect(await db.membership.findMany({ where: { businessId: ID.biz }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } })).toEqual([
      { userId: ID.admin, role: 'ADMIN' },
      { userId: ID.owner, role: 'OWNER' },
      { userId: ID.staff, role: 'STAFF' },
    ]);
    expect(await db.business.findUnique({ where: { id: ID.biz }, select: { ownerId: true } })).toEqual({ ownerId: ID.owner });
    const id = await propose();
    const created = await row(id);
    expect(created.status).toBe('PENDING');
    const sealed: any[] = await db.$queryRawUnsafe(`SELECT capability_name, action_fingerprint FROM key_action_proposals WHERE id = $1`, id);
    expect(sealed[0]).toEqual({ capability_name: null, action_fingerprint: null });
  });
});

/**
 * M46 / KEY-PROPOSAL-CLAIM-001. The status check and the EXECUTING write were
 * separate statements. Required: one conditional claim
 * (updateMany {id, businessId, status 'APPROVED'}, count === 1); every other
 * execute is refused 409 before the executor runs and writes nothing.
 */
describe('an approved proposal is claimed once: concurrent executes run the executor exactly once', () => {
  it('two concurrent execute(id) calls that both pass the status check: the executor runs once, one call returns EXECUTED and the other is refused 409', async () => {
    const id = await approvedBy(ID.admin);
    onEvaluate = barrier(2);

    const { fulfilled, rejected } = await race([() => execute(id, ID.owner), () => execute(id, ID.admin)]);

    expect(ran(id)).toHaveLength(1);
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ id, status: 'EXECUTED' });
    expect(rejected).toHaveLength(1);
    expectConflict(rejected[0]);
    // The loser emitted nothing: one 'executing' and one 'executed' event in all.
    expect(eventsFor(id, 'key.action.executing')).toHaveLength(1);
    expect(eventsFor(id, 'key.action.executed')).toHaveLength(1);
    const after = await row(id);
    expect(after.status).toBe('EXECUTED');
    expect(after.executed_by).toBe(ran(id)[0].executedBy);
    expect(after.execution_result).toEqual({ ran: id });
  });

  it('three concurrent executes by three members: the executor runs once and the other two are refused 409', async () => {
    const id = await approvedBy(ID.owner);
    onEvaluate = barrier(3);

    const { fulfilled, rejected } = await race([
      () => execute(id, ID.owner),
      () => execute(id, ID.admin),
      () => execute(id, ID.staff),
    ]);

    expect(ran(id)).toHaveLength(1);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    rejected.forEach(expectConflict);
    expect(eventsFor(id, 'key.action.executing')).toHaveLength(1);
    expect((await row(id)).status).toBe('EXECUTED');
  });

  it('a proposal cancelled after execute read it APPROVED is not executed: the claim finds no APPROVED row and is refused 409', async () => {
    const id = await approvedBy(ID.admin);
    onEvaluate = async (proposalId) => {
      await db.$executeRawUnsafe(`UPDATE key_action_proposals SET status = 'CANCELLED' WHERE id = $1`, proposalId);
    };

    const outcome = await settle(execute(id, ID.owner));

    expectConflict(outcome.err);
    expect(ran(id)).toHaveLength(0);
    expect(eventsFor(id, 'key.action.executing')).toHaveLength(0);
    const after = await row(id);
    expect(after.status).toBe('CANCELLED');
    expect(after.executed_at).toBeNull();
  });

  it('regression control: an executed proposal executed again is refused and runs nothing', async () => {
    const id = await approvedBy(ID.admin);
    await execute(id, ID.owner);
    expect(ran(id)).toHaveLength(1);

    const again = await settle(execute(id, ID.owner));

    expect(again.err).toBeDefined();
    expect(String(again.err.message)).toMatch(/must be approved before execution/);
    expect(ran(id)).toHaveLength(1);
    expect((await row(id)).status).toBe('EXECUTED');
  });
});

/**
 * CF-29 / KEY-PROPOSAL-CLAIM-001. An approval was a status and a name; nothing
 * re-read the approver at execution. Required: the approver is re-read in the
 * claim's transaction; one who has since been removed or downgraded blocks the
 * execution (403), and the approval no longer stands (back to PENDING).
 */
describe('the approver is re-read at execution: an approver who was removed or downgraded blocks execution', () => {
  it('control: an approver whose authority is unchanged: the proposal executes once', async () => {
    const id = await approvedBy(ID.admin);

    const executed = await execute(id, ID.owner);

    expect(executed).toMatchObject({ id, status: 'EXECUTED', approvedBy: ID.admin });
    expect(ran(id)).toEqual([{ proposalId: id, executedBy: ID.owner }]);
  });

  it('an approver whose membership was removed after approving: refused 403, nothing runs, the proposal waits for a new approval', async () => {
    const id = await approvedBy(ID.admin);
    await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = $1`, ID.mAdmin);

    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));
  });

  it('an ADMIN approver demoted to STAFF after approving: refused 403, nothing runs', async () => {
    const id = await approvedBy(ID.admin);
    await db.$executeRawUnsafe(`UPDATE memberships SET role = 'STAFF' WHERE id = $1`, ID.mAdmin);

    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));
  });

  it('an approver whose approval tier was lowered (same role) after approving: refused 403, nothing runs', async () => {
    const id = await approvedBy(ID.admin);
    await db.$executeRawUnsafe(`UPDATE memberships SET max_approval_tier = 1 WHERE id = $1`, ID.mAdmin);

    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));
  });

  it.each([
    ['banned', 'banned_at'],
    ['deleted', 'deleted_at'],
  ])('an approver whose account was %s after approving: refused 403, nothing runs', async (_label, column) => {
    const id = await approvedBy(ID.admin);
    await db.$executeRawUnsafe(`UPDATE users SET ${column} = now() WHERE id = $1`, ID.admin);

    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));
  });

  it('a lapsed approval can be given again by a member who holds the authority, and the proposal then executes once', async () => {
    const id = await approvedBy(ID.admin);
    await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = $1`, ID.mAdmin);
    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));

    const reapproved = await proposals.approve(ID.biz, id, ID.owner);
    expect(reapproved).toMatchObject({ status: 'APPROVED', approvedBy: ID.owner });
    const executed = await execute(id, ID.owner);

    expect(executed).toMatchObject({ status: 'EXECUTED', approvedBy: ID.owner });
    expect(ran(id)).toHaveLength(1);
  });

  it('control: an approver promoted after approving (STAFF to ADMIN) is not a downgrade: the proposal executes', async () => {
    const id = await approvedBy(ID.staff);
    await db.$executeRawUnsafe(`UPDATE memberships SET role = 'ADMIN' WHERE id = $1`, ID.mStaff);

    const executed = await execute(id, ID.owner);

    expect(executed.status).toBe('EXECUTED');
    expect(ran(id)).toHaveLength(1);
  });

  it('two concurrent executes after the approver was removed: neither runs the executor', async () => {
    const id = await approvedBy(ID.admin);
    await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = $1`, ID.mAdmin);
    onEvaluate = barrier(2);

    const { fulfilled, rejected } = await race([() => execute(id, ID.owner), () => execute(id, ID.owner)]);

    expect(fulfilled).toHaveLength(0);
    expect(rejected).toHaveLength(2);
    expect(ran(id)).toHaveLength(0);
    expect((await row(id)).status).toBe('PENDING');
  });
});

/**
 * Rows APPROVED before this change carry a name and no recorded authority.
 * They are held to the removal rule (the approver must still have authority in
 * the business); a row with no named approver does not execute at all.
 */
describe('approvals recorded without an authority snapshot (rows approved before this change)', () => {
  async function legacyApproved(approver: string | null) {
    const id = await propose();
    await db.$executeRawUnsafe(
      `UPDATE key_action_proposals SET status = 'APPROVED', approved_by = $2, approved_at = now() WHERE id = $1`,
      id,
      approver,
    );
    return id;
  }

  it('control: a legacy approval whose approver is still a member executes', async () => {
    const id = await legacyApproved(ID.admin);

    const executed = await execute(id, ID.owner);

    expect(executed.status).toBe('EXECUTED');
    expect(ran(id)).toHaveLength(1);
  });

  it('a legacy approval whose approver was removed: refused 403, nothing runs', async () => {
    const id = await legacyApproved(ID.admin);
    await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id = $1`, ID.mAdmin);

    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));
  });

  it('an APPROVED row that names no approver: refused 403, nothing runs', async () => {
    const id = await legacyApproved(null);

    await expectApprovalLapsed(id, await settle(execute(id, ID.owner)));
  });
});
