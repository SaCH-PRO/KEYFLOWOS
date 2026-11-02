import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import * as controllerModule from '../key-cortex.controller';
import { KeyCortexExecutorService } from '../key-cortex-executor.service';
import type { ConnectorCommand } from '../key-cortex-connector.types';

/**
 * V1-03-KEY-CORTEX-PRINCIPAL (build map M45, M47, CF-28; owner ruling D-17).
 *
 * Two defects named by the packet:
 *
 *  1. A client-controlled principal fed autonomy decisions and audit
 *     attribution: POST execute and POST batch built the ConnectorCommand with
 *     `userId: dto.userId ?? 'system'`, so the executor's evaluateAction got
 *     `proposedBy` from the request body. R0-09c-KEY-ACTOR-BINDING already moved
 *     every handler to the principal AuthGuard admitted (requestActorId), so at
 *     the V1 base these cases are REGRESSION CONTROLS: a body `userId` naming
 *     someone else is ignored, a request with no principal is 401 (never
 *     'system'), and the real KeyCortexExecutorService hands evaluateAction
 *     `proposedBy` === the authenticated id.
 *
 *  2. PATCH api/v1/cortex/autonomy-profile (the global kill switch and the
 *     autonomy tier ceiling) was guarded by membership alone: any STAFF member
 *     could switch the kill switch off or raise maxTierWithoutApproval. Required:
 *     only OWNER or ADMIN (or the business owner of record, or SUPER_ADMIN) may
 *     write it, and nobody may raise maxTierWithoutApproval above the approval
 *     tier they hold themselves (resolveMembershipApprovalTier: OWNER 4, ADMIN 3,
 *     STAFF 0 by default). The check is a route guard on the PATCH handler
 *     (AutonomyProfileWriteGuard) that reads the tenant BusinessGuard checked.
 *
 * Handlers are called positionally, as Nest calls them: the trailing argument
 * is the principal @CurrentUser() reads. The real-database half is
 * test/autonomy-profile-authority.integration.test.ts.
 */

const KeyCortexController = controllerModule.KeyCortexController;
const AutonomyProfileWriteGuard = (controllerModule as Record<string, any>).AutonomyProfileWriteGuard;

const STAFF = { id: 'user_staff', role: 'USER' };
const OWNER_ID = 'user_owner';

type Stubs = ReturnType<typeof stubs>;

function stubs() {
  const executor = {
    execute: vi.fn(async (c: ConnectorCommand) => ({ success: true, executionTimeMs: 1, command: c })),
    executeBatch: vi.fn(async (cmds: ConnectorCommand[]) => ({
      results: cmds.map((c) => ({ result: { success: true, executionTimeMs: 1, command: c } })),
    })),
    rollback: vi.fn(async () => undefined),
  };
  const command = {
    parseIntent: vi.fn(async () => [{ intent: 'crm.list_contacts', confidence: 0.9, requiresApproval: false }]),
    toConnectorCommand: vi.fn((_intent: unknown, businessId: string, userId: string): ConnectorCommand => ({
      module: 'crm' as any,
      action: 'list_contacts',
      parameters: {},
      businessId,
      userId,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: 'corr_parsed',
    })),
  };
  const connector = { getAllCapabilities: vi.fn(() => []) };
  const contextV2 = { getFullContext: vi.fn(async () => ({})) };
  const reasoning = { processQuery: vi.fn(async () => ({ text: 'ok' })) };
  const conversation = {
    createSession: vi.fn(async (businessId: string, userId: string) => ({ id: 'sess_new', businessId, userId, messages: [] })),
    getSession: vi.fn(async () => null),
  };
  const context = { buildContextSnapshot: vi.fn(async () => ({})) };
  return { executor, command, connector, contextV2, reasoning, conversation, context };
}

function build(s: Stubs, executorOverride?: unknown) {
  return new KeyCortexController(
    s.reasoning as any,
    s.conversation as any,
    {} as any, // voice
    {} as any, // personality
    {} as any, // actions
    s.context as any,
    s.connector as any,
    s.command as any,
    (executorOverride ?? s.executor) as any,
    s.contextV2 as any,
    {} as any, // insight
    {} as any, // monitorV2
    {} as any, // sandbox
    {} as any, // flowStudio
    {} as any, // evolution
    {} as any, // phone
    {} as any, // document
    {} as any, // learning
    {} as any, // safety
    {} as any, // approvalOrchestrator
    {} as any, // consciousness
    {} as any, // sessionService
    {} as any, // awareness
  );
}

/* ------------------------------------------------------------------ */
/*  1. The principal (regression controls at the V1 base: R0-09c)      */
/* ------------------------------------------------------------------ */

describe('V1-03: the KEY cortex principal is the one AuthGuard admitted, never a body userId or system', () => {
  it('POST execute (structured) with a body userId naming the OWNER runs as the authenticated STAFF member', async () => {
    const s = stubs();
    await build(s).executeCommand(
      { command: '', businessId: 'biz_1', userId: OWNER_ID, module: 'crm' as any, action: 'list_contacts', parameters: {} } as any,
      STAFF,
    );
    expect(s.executor.execute).toHaveBeenCalledTimes(1);
    expect(s.executor.execute.mock.calls[0][0].userId).toBe(STAFF.id);
  });

  it('POST execute (natural language) parses and builds the command for the authenticated member, not the body userId', async () => {
    const s = stubs();
    await build(s).executeCommand({ command: 'list my contacts', businessId: 'biz_1', userId: OWNER_ID } as any, STAFF);
    expect((s.command.parseIntent.mock.calls[0] as any[])[1].userId).toBe(STAFF.id);
    expect(s.command.toConnectorCommand.mock.calls[0][2]).toBe(STAFF.id);
    expect(s.executor.execute.mock.calls[0][0].userId).toBe(STAFF.id);
  });

  it("POST execute with no authenticated user is 401 and nothing runs (never 'system')", async () => {
    const s = stubs();
    for (const dto of [
      { command: '', businessId: 'biz_1', module: 'crm', action: 'list_contacts', parameters: {} },
      { command: 'list my contacts', businessId: 'biz_1', userId: OWNER_ID },
    ]) {
      await expect(build(s).executeCommand(dto as any, undefined)).rejects.toThrow(UnauthorizedException);
    }
    expect(s.executor.execute).not.toHaveBeenCalled();
    expect(s.command.parseIntent).not.toHaveBeenCalled();
  });

  it('POST batch (structured and natural) attributes every command to the authenticated member, not the body userId', async () => {
    const s = stubs();
    await build(s).executeBatch(
      {
        businessId: 'biz_1',
        userId: OWNER_ID,
        commands: [
          { type: 'structured', module: 'crm', action: 'list_contacts', parameters: {} },
          { type: 'natural', command: 'list my contacts' },
        ],
      } as any,
      STAFF,
    );
    const sent = s.executor.executeBatch.mock.calls[0][0] as ConnectorCommand[];
    expect(sent.map((c) => c.userId)).toEqual([STAFF.id, STAFF.id]);
    expect((s.command.parseIntent.mock.calls[0] as any[])[1].userId).toBe(STAFF.id);
  });

  it("POST batch with no authenticated user is 401 and nothing runs (never 'system')", async () => {
    const s = stubs();
    await expect(
      build(s).executeBatch(
        { businessId: 'biz_1', commands: [{ type: 'structured', module: 'crm', action: 'list_contacts', parameters: {} }] } as any,
        undefined,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(s.executor.executeBatch).not.toHaveBeenCalled();
  });

  it('POST rollback and POST chat act for the authenticated member; a body userId is ignored', async () => {
    const s = stubs();
    const controller = build(s);
    await controller.rollback({ correlationId: 'corr_1', businessId: 'biz_1', userId: OWNER_ID } as any, STAFF);
    expect((s.executor.rollback.mock.calls[0] as any[])[0].command.userId).toBe(STAFF.id);

    await controller.chat({ text: 'hello', businessId: 'biz_1', userId: OWNER_ID } as any, STAFF);
    expect((s.reasoning.processQuery.mock.calls[0] as any[])[0].userId).toBe(STAFF.id);
    // The session the chat runs in is the authenticated member's own.
    expect(s.conversation.createSession.mock.calls.every((c: any[]) => c[1] === STAFF.id)).toBe(true);
  });

  it('POST sessions creates the session for the authenticated member, not the body userId; with no user it is 401', async () => {
    const s = stubs();
    const controller = build(s);
    await controller.createSession({ businessId: 'biz_1', userId: OWNER_ID } as any, STAFF);
    expect(s.conversation.createSession.mock.calls[0][1]).toBe(STAFF.id);
    await expect(controller.createSession({ businessId: 'biz_1', userId: OWNER_ID } as any, undefined)).rejects.toThrow(UnauthorizedException);
    expect(s.conversation.createSession).toHaveBeenCalledTimes(1);
  });

  describe('through the real KeyCortexExecutorService: evaluateAction receives proposedBy === the authenticated id', () => {
    let executor: any;
    afterEach(() => {
      if (executor?.approvalCleanupInterval) clearInterval(executor.approvalCleanupInterval);
    });

    function realExecutor() {
      const prisma = {
        client: {
          aiExecutionLog: { create: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
          user: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
          businessSetting: { findUnique: vi.fn(async () => null) },
        },
      };
      const connector = {
        execute: vi.fn(async (c: ConnectorCommand) => ({ success: true, data: {}, executionTimeMs: 1, command: c })),
        getAllCapabilities: () => [],
      };
      const orchestrator = { evaluateAction: vi.fn(async () => ({ allowed: true, requiresApproval: false })) };
      executor = new KeyCortexExecutorService(connector as any, prisma as any, { emit: vi.fn() } as any, {} as any, orchestrator as any);
      return { orchestrator, connector };
    }

    it('POST execute with a body userId naming the OWNER: proposedBy is the STAFF member', async () => {
      const s = stubs();
      const { orchestrator, connector } = realExecutor();
      await build(s, executor).executeCommand(
        { command: '', businessId: 'biz_1', userId: OWNER_ID, module: 'crm' as any, action: 'list_contacts', parameters: {} } as any,
        STAFF,
      );
      expect(orchestrator.evaluateAction).toHaveBeenCalledTimes(1);
      const call = orchestrator.evaluateAction.mock.calls[0] as any[];
      expect(call[0]).toBe('biz_1');
      expect(call[3]).toEqual({ proposedBy: STAFF.id });
      expect(connector.execute.mock.calls[0][0].userId).toBe(STAFF.id);
    });

    it('POST batch with a body userId naming the OWNER: every evaluateAction gets proposedBy = the STAFF member', async () => {
      const s = stubs();
      const { orchestrator } = realExecutor();
      await build(s, executor).executeBatch(
        {
          businessId: 'biz_1',
          userId: OWNER_ID,
          commands: [
            { type: 'structured', module: 'crm', action: 'list_contacts', parameters: {} },
            { type: 'natural', command: 'list my contacts' },
          ],
        } as any,
        STAFF,
      );
      const proposedBy = orchestrator.evaluateAction.mock.calls.map((c: any[]) => c[3]?.proposedBy);
      expect(proposedBy).toEqual([STAFF.id, STAFF.id]);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  2. Autonomy-profile write authority (CF-28: open at the V1 base)   */
/* ------------------------------------------------------------------ */

interface MembershipRow { role: string; maxApprovalTier: number; permissionScopes: unknown }

function guardPrisma(memberships: Record<string, MembershipRow>, owners: Record<string, string> = {}) {
  return {
    client: {
      membership: {
        findUnique: vi.fn(async ({ where }: any) => memberships[`${where.userId_businessId.userId}@${where.userId_businessId.businessId}`] ?? null),
      },
      business: {
        findFirst: vi.fn(async ({ where }: any) => (owners[where.id] === where.ownerId ? { id: where.id } : null)),
      },
    },
  };
}

function httpContext(req: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

/** A request BusinessGuard admitted for `businessId` (it attaches guardedBusinessId). */
function patchRequest(user: { id: string; role?: string } | undefined, body: Record<string, unknown>, businessId = 'biz_1') {
  return { user, body: { businessId, ...body }, query: {}, params: {}, guardedBusinessId: user?.role === 'SUPER_ADMIN' ? undefined : businessId };
}

const MEMBERS: Record<string, MembershipRow> = {
  'u_owner@biz_1': { role: 'OWNER', maxApprovalTier: 0, permissionScopes: null },
  'u_admin@biz_1': { role: 'ADMIN', maxApprovalTier: 0, permissionScopes: null },
  'u_staff@biz_1': { role: 'STAFF', maxApprovalTier: 0, permissionScopes: null },
  // An OWNER deliberately restricted to tier 2 (an explicit scope map makes the stored tier authoritative).
  'u_owner_t2@biz_1': { role: 'OWNER', maxApprovalTier: 2, permissionScopes: { crm: 'admin' } },
  // OWNER of biz_2 and STAFF of biz_1.
  'u_dual@biz_1': { role: 'STAFF', maxApprovalTier: 0, permissionScopes: null },
  'u_dual@biz_2': { role: 'OWNER', maxApprovalTier: 0, permissionScopes: null },
};

async function decide(guard: any, req: Record<string, unknown>): Promise<true | Error> {
  try {
    return (await guard.canActivate(httpContext(req))) as true;
  } catch (err) {
    return err as Error;
  }
}

describe('V1-03: PATCH autonomy-profile is limited to OWNER/ADMIN at the required tier (AutonomyProfileWriteGuard)', () => {
  const guardFor = (owners: Record<string, string> = {}) => {
    expect(typeof AutonomyProfileWriteGuard, 'AutonomyProfileWriteGuard is exported by key-cortex.controller.ts').toBe('function');
    return new AutonomyProfileWriteGuard(guardPrisma(MEMBERS, owners));
  };

  it('the PATCH handler carries AutonomyProfileWriteGuard; GET autonomy-profile does not (members keep reading it)', () => {
    const patchGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, KeyCortexController.prototype.updateAutonomyProfile) ?? [];
    const getGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, KeyCortexController.prototype.getAutonomyProfile) ?? [];
    expect(AutonomyProfileWriteGuard).toBeDefined();
    expect(patchGuards).toContain(AutonomyProfileWriteGuard);
    expect(getGuards).not.toContain(AutonomyProfileWriteGuard);
  });

  it('STAFF switching the kill switch off is 403', async () => {
    const res = await decide(guardFor(), patchRequest({ id: 'u_staff' }, { globalKillSwitch: false }));
    expect(res).toBeInstanceOf(ForbiddenException);
  });

  it('STAFF changing any other field (daily caps, notifications) is 403', async () => {
    const guard = guardFor();
    for (const body of [{ maxDailyAutoActions: 500 }, { maxDailySpendTtd: 0 }, { notifyOnBlock: false }, { globalKillSwitch: true }]) {
      expect(await decide(guard, patchRequest({ id: 'u_staff' }, body)), JSON.stringify(body)).toBeInstanceOf(ForbiddenException);
    }
  });

  it('a user with no membership who is not the owner of record is 403', async () => {
    expect(await decide(guardFor(), patchRequest({ id: 'u_stranger' }, { globalKillSwitch: false }))).toBeInstanceOf(ForbiddenException);
  });

  it('ADMIN raising maxTierWithoutApproval to 4 (above their tier 3) is 403', async () => {
    expect(await decide(guardFor(), patchRequest({ id: 'u_admin' }, { maxTierWithoutApproval: 4 }))).toBeInstanceOf(ForbiddenException);
  });

  it('ADMIN within their tier (maxTierWithoutApproval 3 or lower), the kill switch and the daily caps is allowed', async () => {
    const guard = guardFor();
    for (const body of [{ maxTierWithoutApproval: 3 }, { maxTierWithoutApproval: 1 }, { globalKillSwitch: true }, { globalKillSwitch: false, maxDailyAutoActions: 20 }]) {
      expect(await decide(guard, patchRequest({ id: 'u_admin' }, body)), JSON.stringify(body)).toBe(true);
    }
  });

  it('OWNER raising maxTierWithoutApproval to 4 and switching the kill switch off is allowed', async () => {
    expect(await decide(guardFor(), patchRequest({ id: 'u_owner' }, { maxTierWithoutApproval: 4, globalKillSwitch: false }))).toBe(true);
  });

  it('an OWNER restricted to tier 2 cannot raise maxTierWithoutApproval to 3 (the tier is the one the membership holds)', async () => {
    const guard = guardFor();
    expect(await decide(guard, patchRequest({ id: 'u_owner_t2' }, { maxTierWithoutApproval: 3 }))).toBeInstanceOf(ForbiddenException);
    expect(await decide(guard, patchRequest({ id: 'u_owner_t2' }, { maxTierWithoutApproval: 2 }))).toBe(true);
  });

  it('the owner of record (Business.ownerId) with no membership row is the OWNER, at the OWNER tier', async () => {
    const guard = guardFor({ biz_1: 'u_founder' });
    expect(await decide(guard, patchRequest({ id: 'u_founder' }, { maxTierWithoutApproval: 4 }))).toBe(true);
  });

  it('SUPER_ADMIN (the platform bypass BusinessGuard grants) is allowed', async () => {
    expect(await decide(guardFor(), patchRequest({ id: 'u_super', role: 'SUPER_ADMIN' }, { maxTierWithoutApproval: 4 }))).toBe(true);
  });

  it('no authenticated user is 401', async () => {
    expect(await decide(guardFor(), patchRequest(undefined, { globalKillSwitch: false }))).toBeInstanceOf(UnauthorizedException);
  });

  it('no tenant is 400, before any authority read', async () => {
    const prisma = guardPrisma(MEMBERS);
    const guard = new (AutonomyProfileWriteGuard ?? Object)(prisma);
    const res = await decide(guard, { user: { id: 'u_super', role: 'SUPER_ADMIN' }, body: { maxDailyAutoActions: 1 }, query: {}, params: {} });
    expect(res).toBeInstanceOf(BadRequestException);
    expect(prisma.client.membership.findUnique).not.toHaveBeenCalled();
  });

  it('a non-numeric maxTierWithoutApproval is refused before it can slip past the tier check', async () => {
    const guard = guardFor();
    for (const value of ['4', Number.POSITIVE_INFINITY, Number.NaN, { gt: 0 }]) {
      const res = await decide(guard, patchRequest({ id: 'u_admin' }, { maxTierWithoutApproval: value }));
      expect(res instanceof BadRequestException || res instanceof ForbiddenException, String(value)).toBe(true);
    }
  });

  it('the role is read in the tenant BusinessGuard checked: STAFF of biz_1 (OWNER of biz_2) naming biz_1 is 403, naming biz_2 is allowed', async () => {
    const prisma = guardPrisma(MEMBERS);
    const guard = new (AutonomyProfileWriteGuard ?? Object)(prisma);
    // BusinessGuard resolved the body's biz_1 (params, then body, then query) even though the query names biz_2.
    const res = await decide(guard, { user: { id: 'u_dual' }, body: { businessId: 'biz_1', globalKillSwitch: false }, query: { businessId: 'biz_2' }, params: {}, guardedBusinessId: 'biz_1' });
    expect(res).toBeInstanceOf(ForbiddenException);
    expect(prisma.client.membership.findUnique.mock.calls[0][0].where.userId_businessId).toEqual({ userId: 'u_dual', businessId: 'biz_1' });
    expect(await decide(guard, patchRequest({ id: 'u_dual' }, { globalKillSwitch: false }, 'biz_2'))).toBe(true);
  });
});
