/**
 * Real-database fixture for the KEY action boundary proofs (KF-EXEC-ACTION-001).
 *
 * Nothing on the boundary is mocked: Prisma, the unique index behind the
 * execution claim, the row locks, AiOversightService's policy read, the
 * CapabilityContract and HelpdeskService's insert are all real. The only
 * stand-ins are collaborators the boundary never asks a question of (the
 * temporal event sink, the execution log) and, for the proposal service, the
 * autonomy orchestrator and genome policy, which are recorded so a test can see
 * what identity they were asked about.
 *
 * This file is JavaScript on purpose. apps/server/tsconfig.json pins rootDir to
 * ./src and includes test/**, relying on every file under test/ being excluded
 * as *.test.ts; a TypeScript helper here would be pulled into the server build.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { vi } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../../.env') });

export async function buildBoundaryFixture(P) {
  const dbMod = await import('@keyflow/db');
  const db = dbMod.db;
  const { PrismaService } = await import('../../src/core/prisma/prisma.service');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { HelpdeskService } = await import('../../src/modules/helpdesk/helpdesk.service');
  const { AiOversightService } = await import('../../src/modules/ai/ai-oversight.service');
  const { AiExecutionLogService } = await import('../../src/modules/ai/ai-execution-log.service');
  const { CapabilityContractService } = await import('../../src/modules/capabilities/capability-contract.service');
  const { TemporalFlowService } = await import('../../src/modules/temporal-flow/temporal-flow.service');
  const boundaryMod = await import('../../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { KeyActionProposalService } = await import('../../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyActionPolicyService } = await import('../../src/modules/key-autonomy/key-action-policy.service');

  const prisma = new PrismaService();
  const emitter = new EventEmitter2();
  const events = { emitted: [] };
  emitter.onAny((name, payload) => {
    events.emitted.push({ name: String(name), payload });
  });

  const helpdesk = new HelpdeskService(prisma, emitter);
  // evaluate() is called without a crew or a position envelope here, so the
  // role engine and job-role policy are never consulted; the log, memory and
  // approval-routing collaborators belong to methods the boundary never calls.
  const oversight = new AiOversightService(prisma, {}, {}, {}, {}, {});
  const capabilities = new CapabilityContractService();
  const temporal = { emit: vi.fn(async () => undefined) };
  const executionLog = { logToolExecution: vi.fn(async () => 'log_1') };

  const registry = new Map([
    [CapabilityContractService, capabilities],
    [AiOversightService, oversight],
    [HelpdeskService, helpdesk],
    [TemporalFlowService, temporal],
    [AiExecutionLogService, executionLog],
  ]);
  const moduleRef = {
    get(token) {
      if (!registry.has(token)) throw new Error(`fixture has no provider for ${token?.name ?? String(token)}`);
      return registry.get(token);
    },
  };
  const boundary = new boundaryMod.KeyActionBoundaryService(prisma, moduleRef);
  registry.set(boundaryMod.KeyActionBoundaryService, boundary);

  const autonomyOrchestrator = {
    evaluateAction: vi.fn(async () => ({ allowed: true, requiresApproval: false, reason: 'ok', ruleTrace: [] })),
  };
  const genomePolicy = {
    evaluateExecution: vi.fn(async () => ({
      allowed: true,
      requiresExtraConfirmation: false,
      message: '',
      blockedReasons: [],
      missingFacts: [],
    })),
  };
  const executor = {
    execute: vi.fn(async () => {
      throw new Error('the executor plugin must not run for a capability the boundary has adopted');
    }),
  };
  const proposals = new KeyActionProposalService(
    prisma,
    temporal,
    emitter,
    new KeyActionPolicyService(),
    executor,
    genomePolicy,
    autonomyOrchestrator,
    boundary,
  );

  const ID = {
    owner: `${P}owner`,
    admin: `${P}admin`,
    staff: `${P}staff`,
    staff2: `${P}staff2`,
    stranger: `${P}stranger`,
    superAdmin: `${P}super`,
    bareOwner: `${P}bareowner`,
    bizA: `${P}bizA`,
    bizB: `${P}bizB`,
    bizBare: `${P}bizBare`,
    mOwner: `${P}m_owner`,
    mAdmin: `${P}m_admin`,
    mStaff: `${P}m_staff`,
    mStaff2: `${P}m_staff2`,
    mOwnerB: `${P}m_owner_b`,
    contactA: `${P}contactA`,
    contactB: `${P}contactB`,
  };

  const raw = (sql) => db.$executeRawUnsafe(sql);

  const ACTION_STATE = [
    `DELETE FROM support_tickets WHERE business_id LIKE '${P}%'`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE '${P}%'`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE '${P}%'`,
    `DELETE FROM autopilot_settings WHERE business_id LIKE '${P}%'`,
    `DELETE FROM ai_memories WHERE business_id LIKE '${P}%'`,
  ];

  async function wipeActionState() {
    for (const sql of ACTION_STATE) await raw(sql);
  }

  async function cleanup() {
    for (const sql of [
      ...ACTION_STATE,
      `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
      `DELETE FROM memberships WHERE business_id LIKE '${P}%'`,
      `DELETE FROM businesses WHERE id LIKE '${P}%'`,
      `DELETE FROM users WHERE id LIKE '${P}%'`,
    ]) {
      try {
        await raw(sql);
      } catch {
        /* best-effort */
      }
    }
  }

  async function seedMemberships() {
    await raw(`DELETE FROM memberships WHERE business_id LIKE '${P}%'`);
    await db.membership.create({ data: { id: ID.mOwner, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
    await db.membership.create({ data: { id: ID.mAdmin, userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' } });
    await db.membership.create({ data: { id: ID.mStaff, userId: ID.staff, businessId: ID.bizA, role: 'STAFF' } });
    await db.membership.create({ data: { id: ID.mStaff2, userId: ID.staff2, businessId: ID.bizA, role: 'STAFF' } });
    await db.membership.create({ data: { id: ID.mOwnerB, userId: ID.stranger, businessId: ID.bizB, role: 'OWNER' } });
    // bizBare deliberately has an owner and no Membership row at all.
  }

  async function seed() {
    await cleanup();
    for (const [id, role] of [
      [ID.owner, 'USER'],
      [ID.admin, 'USER'],
      [ID.staff, 'USER'],
      [ID.staff2, 'USER'],
      [ID.stranger, 'USER'],
      [ID.bareOwner, 'USER'],
      [ID.superAdmin, 'SUPER_ADMIN'],
    ]) {
      await db.user.create({ data: { id, email: `${id}@test.local`, role } });
    }
    await db.business.create({ data: { id: ID.bizA, name: 'Boundary A', ownerId: ID.owner } });
    await db.business.create({ data: { id: ID.bizB, name: 'Boundary B', ownerId: ID.stranger } });
    await db.business.create({ data: { id: ID.bizBare, name: 'Boundary Bare', ownerId: ID.bareOwner } });
    await seedMemberships();
    await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Ada' } });
    await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'Bob' } });
  }

  async function reset() {
    await wipeActionState();
    await seedMemberships();
    await raw(`UPDATE businesses SET owner_id = '${ID.bareOwner}' WHERE id = '${ID.bizBare}'`);
    await raw(`UPDATE users SET banned_at = NULL, deleted_at = NULL WHERE id LIKE '${P}%'`);
    events.emitted.length = 0;
    autonomyOrchestrator.evaluateAction.mockClear();
    temporal.emit.mockClear();
    executionLog.logToolExecution.mockClear();
    registry.set(HelpdeskService, helpdesk);
    registry.set(AiOversightService, oversight);
  }

  const like = (businessId) => (businessId ? `= '${businessId}'` : `LIKE '${P}%'`);
  const tickets = (businessId) =>
    db.$queryRawUnsafe(`SELECT * FROM support_tickets WHERE business_id ${like(businessId)} ORDER BY created_at`);
  const claims = (businessId) =>
    db.$queryRawUnsafe(`SELECT * FROM idempotency_keys WHERE business_id ${like(businessId)} ORDER BY created_at`);
  const actions = (businessId) =>
    db.$queryRawUnsafe(`SELECT * FROM key_action_proposals WHERE business_id ${like(businessId)} ORDER BY created_at`);
  const action = async (id) => {
    const rows = await db.$queryRawUnsafe(`SELECT * FROM key_action_proposals WHERE id = '${id}'`);
    return rows[0];
  };

  async function setAutonomy(level, opts = {}) {
    await raw(`DELETE FROM autopilot_settings WHERE business_id = '${ID.bizA}'`);
    if (level === null) return;
    await db.autopilotSettings.create({
      data: {
        businessId: ID.bizA,
        autonomyLevel: level,
        blockedTools: opts.blockedTools ?? [],
        approvedTools: opts.approvedTools ?? [],
      },
    });
  }

  /** The invariant behind "UNKNOWN is impossible": checked after every test. */
  async function assertNoUnknownState() {
    const [allTickets, allClaims, allActions] = await Promise.all([tickets(), claims(), actions()]);
    const executed = allActions.filter((a) => a.status === 'EXECUTED');
    const completed = allClaims.filter((c) => c.status === 'completed');
    const dangling = allClaims.filter((c) => c.status !== 'completed' && c.status !== 'voided');

    // No claim is ever left between "taken" and "done".
    if (dangling.length) {
      throw new Error(`claims left in an intermediate state: ${JSON.stringify(dangling.map((c) => c.status))}`);
    }
    // One ticket per executed action per completed claim, and nothing else.
    if (!(allTickets.length === executed.length && executed.length === completed.length)) {
      throw new Error(
        `tickets ${allTickets.length}, executed actions ${executed.length} and completed claims ${completed.length} disagree`,
      );
    }
    const ticketIds = new Set(allTickets.map((t) => t.id));
    for (const a of executed) {
      const entityId = a.outcome_evidence?.entity?.id;
      if (!entityId || !ticketIds.has(entityId)) {
        throw new Error(`executed action ${a.id} names ticket ${entityId}, which does not exist`);
      }
    }
    for (const c of completed) {
      if (!ticketIds.has(c.response?.supportTicketId)) {
        throw new Error(`completed claim ${c.idempotency_key} names a ticket that does not exist`);
      }
    }
  }

  return {
    db,
    prisma,
    boundary,
    oversight,
    helpdesk,
    capabilities,
    events,
    temporal,
    executionLog,
    proposals,
    autonomyOrchestrator,
    /** Swap a collaborator the boundary resolves through ModuleRef. */
    provide: (token, instance) => void registry.set(token, instance),
    moduleRef,
    tokens: { HelpdeskService, AiOversightService, KeyActionBoundaryService: boundaryMod.KeyActionBoundaryService },
    errors: { ActionNotClearedError: boundaryMod.ActionNotClearedError },
    ID,
    P,
    seed,
    reset,
    cleanup,
    tickets,
    claims,
    actions,
    action,
    setAutonomy,
    assertNoUnknownState,
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Settle a promise into a value the test can assert on either way. */
export async function settle(p) {
  try {
    return { ok: await p };
  } catch (err) {
    return { err };
  }
}
