/**
 * V1-02b-KEY-LEGACY-GATE review repair (SEC-V102b-1, CR-V102b-1): every
 * outcome of the legacy Cortex action gate writes its CortexActionLog row,
 * attributed to the session's tenant and actor (REAL database).
 *
 * The legacy gate (KeyCortexActionsService.executeActions, keyed on
 * key_cortex.<TYPE>) sends each refusal (a well-formed denial, or each action
 * of a batch that failed closed) and each run action through its audit door,
 * trackActionExecution -> cortexActionLog.create.
 *
 * At the packet head (b12add0e) that create named no businessId and no userId.
 * CortexActionLog.businessId is a required column (a required Business
 * relation), so measured against a real database:
 *   - outside an ambient tenant context Prisma refused the row ("Argument
 *     `business` is missing"), the catch logged "Failed to track action
 *     execution" and swallowed it: no row;
 *   - inside one (runWithTenant, as the HTTP pipeline installs it) the tenant
 *     extension injected businessId and the row was written with user_id NULL.
 * The packet spec passed only because its mocked create accepted any row.
 *
 * Required, and pinned here: the row names business_id and user_id from the
 * session itself, with or without an ambient tenant, for a failed-closed
 * batch, a well-formed denial and a run action; no audit failure is logged;
 * and an audit write the database refuses still does not change the answer.
 *
 * WHAT IS REAL: PrismaService and the Prisma client (with the tenant
 * extension's context provider installed, as main.ts does) against
 * DATABASE_URL, KeyCortexActionsService (the gate, failBatchClosed and
 * trackActionExecution), writing cortex_action_logs rows. Stand-ins only: the
 * autonomy orchestrator (it supplies the verdict under test), the canonical
 * tool registry (records the call, touches no table), the proposal service,
 * the autonomy level service and the event bus.
 *
 * Every seeded row carries the `v02b_` prefix (user, business, session ids)
 * and is hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v02b_';

const ID = {
  user: `${P}user`,
  biz: `${P}biz`,
  /** A business with no row: an audit insert for it fails on the business foreign key. */
  missingBiz: `${P}biz_missing`,
};

const allow = {
  allowed: true,
  requiresApproval: false,
  tier: 'full' as const,
  reason: 'Allowed',
  confidence: 1,
  ruleTrace: [],
  createdAt: new Date(),
};
const deny = { ...allow, allowed: false, tier: 'manual' as const, reason: `${P}denied by constitution` };

const createTask = {
  actionType: 'CREATE_TASK' as const,
  status: 'pending_approval' as const,
  description: 'Create follow-up task',
  result: { title: 'Call Ana' },
};
const createEvent = {
  actionType: 'CREATE_EVENT' as const,
  status: 'pending_approval' as const,
  description: 'Book a call',
  result: { title: 'Call', startTime: '2026-11-03T10:00:00Z' },
};
const createDocument = {
  actionType: 'CREATE_DOCUMENT' as const,
  status: 'pending_approval' as const,
  description: 'Write notes',
  result: { title: 'Notes', content: 'x' },
};

let db: any;
let app: any;
let prisma: any;
let tenant: typeof import('../src/core/tenant/tenant-context');
let ActionsService: typeof import('../src/modules/key-cortex/key-cortex-actions.service').KeyCortexActionsService;

async function cleanup() {
  for (const sql of [
    `DELETE FROM cortex_action_logs WHERE session_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cortex_action_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

let seq = 0;
function sessionFor(label: string, businessId = ID.biz) {
  return { id: `${P}sess_${label}_${++seq}`, businessId, userId: ID.user } as any;
}

/** The rows as stored, read by raw SQL so no extension filters or rewrites them. */
function rowsFor(sessionId: string): Promise<Array<Record<string, any>>> {
  return db.$queryRawUnsafe(
    `SELECT session_id, business_id, user_id, action_type, status, error, requires_approval
       FROM cortex_action_logs WHERE session_id = $1 ORDER BY created_at ASC, id ASC`,
    sessionId,
  );
}

function harness() {
  const toolExecute = vi.fn().mockResolvedValue({ success: true, data: { id: `${P}row_1` } });
  const keyCortexToolRegistry = {
    registerMany: vi.fn(),
    execute: toolExecute,
    listTools: vi.fn().mockReturnValue([]),
    buildGatewayDefinitions: vi.fn().mockReturnValue([]),
  };
  const proposalService = { create: vi.fn().mockResolvedValue({ id: `${P}apr_1` }), list: vi.fn() };
  const autonomyOrchestrator = { evaluateAction: vi.fn() };
  const autonomyLevelService = {
    resolve: vi.fn().mockResolvedValue({ level: 4, mode: 'pro_auto', maxAutoRiskTier: 4, label: 't' }),
  };
  const eventBus = { emit: vi.fn() };
  // Positionally, as Nest constructs it: prisma, tool registry, command service,
  // canonical registry, proposals, orchestrator, autonomy level, event bus, safe database.
  const service = new ActionsService(
    prisma,
    undefined,
    { enqueue: vi.fn() } as any,
    keyCortexToolRegistry as any,
    proposalService as any,
    autonomyOrchestrator as any,
    autonomyLevelService as any,
    eventBus as any,
    undefined,
  );
  const logger = (service as any).logger;
  const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  for (const level of ['warn', 'log', 'debug'] as const) {
    vi.spyOn(logger, level).mockImplementation(() => undefined);
  }
  const auditFailures = () =>
    loggerError.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('Failed to track action execution'));
  return { service, toolExecute, proposalService, autonomyOrchestrator, loggerError, auditFailures };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does: the extension injects the ambient tenant into scoped writes.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile();
  app = moduleRef;
  await app.init();
  prisma = moduleRef.get(PrismaService);

  ({ KeyCortexActionsService: ActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service'));

  await cleanup(); // in case a prior run aborted
  await db.user.create({ data: { id: ID.user, email: `${P}user@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V02B Biz', ownerId: ID.user } });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fixture sanity (real rows)', () => {
  it('the business exists and has no CortexActionLog row yet', async () => {
    expect(await db.business.count({ where: { id: ID.biz } })).toBe(1);
    const [{ n }] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM cortex_action_logs WHERE business_id = $1`,
      ID.biz,
    );
    expect(n).toBe(0);
  });
});

describe('V1-02b legacy gate audit rows (real database)', () => {
  it('V1-02b-DB01 a failed-closed action outside any tenant context writes one row naming the session tenant and actor', async () => {
    const t = harness();
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));
    const session = sessionFor('noctx');

    const results = await t.service.executeActions([createTask], session);

    expect(results.map((r) => r.status)).toEqual(['blocked']);
    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(t.proposalService.create).not.toHaveBeenCalled();
    const rows = await rowsFor(session.id);
    expect(rows).toEqual([
      expect.objectContaining({
        session_id: session.id,
        business_id: ID.biz,
        user_id: ID.user,
        action_type: 'CREATE_TASK',
        status: 'blocked',
        requires_approval: false,
      }),
    ]);
    expect(rows[0].error).toContain('Authority check failed closed');
    expect(rows[0].error).toContain('oracle down');
    expect(t.auditFailures()).toEqual([]);
  });

  it('V1-02b-DB02 the same refusal inside the request tenant context is attributed to the member (user_id is not NULL)', async () => {
    const t = harness();
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));
    const session = sessionFor('ctx');

    const results = await tenant.runWithTenant(ID.biz, ID.user, () => t.service.executeActions([createTask], session));

    expect(results.map((r) => r.status)).toEqual(['blocked']);
    expect(await rowsFor(session.id)).toEqual([
      expect.objectContaining({ business_id: ID.biz, user_id: ID.user, status: 'blocked' }),
    ]);
    expect(t.auditFailures()).toEqual([]);
  });

  it('V1-02b-DB03 a batch that fails closed on action 2 of 3 writes one attributed row per action and runs none', async () => {
    const t = harness();
    t.autonomyOrchestrator.evaluateAction
      .mockResolvedValueOnce(allow)
      .mockResolvedValueOnce({ allowed: true } as any)
      .mockResolvedValue(allow);
    const session = sessionFor('batch');

    const results = await t.service.executeActions([createTask, createEvent, createDocument], session);

    expect(results.map((r) => r.status)).toEqual(['blocked', 'blocked', 'blocked']);
    expect(t.toolExecute).not.toHaveBeenCalled();
    const rows = await rowsFor(session.id);
    expect(rows.map((r) => [r.action_type, r.status, r.business_id, r.user_id]).sort()).toEqual(
      [
        ['CREATE_DOCUMENT', 'blocked', ID.biz, ID.user],
        ['CREATE_EVENT', 'blocked', ID.biz, ID.user],
        ['CREATE_TASK', 'blocked', ID.biz, ID.user],
      ],
    );
    for (const row of rows) expect(row.error).toContain('Unusable autonomy verdict for key_cortex.CREATE_EVENT');
    expect(t.auditFailures()).toEqual([]);
  });

  it.each([
    ['outside any tenant context', false],
    ['inside the request tenant context', true],
  ])('V1-02b-DB04 a well-formed denial %s writes one attributed row and logs no audit failure', async (_label, inContext) => {
    const t = harness();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(deny);
    const session = sessionFor(inContext ? 'deny_ctx' : 'deny_noctx');

    const run = () => t.service.executeActions([createTask], session);
    const results = inContext ? await tenant.runWithTenant(ID.biz, ID.user, run) : await run();

    expect(results.map((r) => r.status)).toEqual(['blocked']);
    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(await rowsFor(session.id)).toEqual([
      expect.objectContaining({
        business_id: ID.biz,
        user_id: ID.user,
        action_type: 'CREATE_TASK',
        status: 'blocked',
        error: deny.reason,
      }),
    ]);
    expect(t.auditFailures()).toEqual([]);
  });

  it('V1-02b-DB05 control: a well-formed allow runs the tool and writes one attributed success row', async () => {
    const t = harness();
    t.autonomyOrchestrator.evaluateAction.mockResolvedValue(allow);
    const session = sessionFor('allow');

    const results = await t.service.executeActions([createTask], session);

    expect(results.map((r) => r.status)).toEqual(['success']);
    expect(t.toolExecute).toHaveBeenCalledTimes(1);
    expect(await rowsFor(session.id)).toEqual([
      expect.objectContaining({ business_id: ID.biz, user_id: ID.user, action_type: 'CREATE_TASK', status: 'success' }),
    ]);
    expect(t.auditFailures()).toEqual([]);
  });

  it('V1-02b-DB06 an audit write the database refuses is logged with the business id and does not change the answer', async () => {
    const t = harness();
    t.autonomyOrchestrator.evaluateAction.mockRejectedValue(new Error('oracle down'));
    const session = sessionFor('missing_biz', ID.missingBiz);

    const results = await t.service.executeActions([createTask], session);

    expect(results.map((r) => r.status)).toEqual(['blocked']);
    expect(t.toolExecute).not.toHaveBeenCalled();
    expect(await rowsFor(session.id)).toEqual([]);
    const failures = t.auditFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(ID.missingBiz);
  });
});
