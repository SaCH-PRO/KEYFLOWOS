import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { defer, lastValueFrom, of } from 'rxjs';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
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
const AutonomyProfileAuditInterceptor = (controllerModule as Record<string, any>).AutonomyProfileAuditInterceptor;
const loosenedAutonomySettings = (controllerModule as Record<string, any>).loosenedAutonomySettings;

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

interface StoredProfile {
  globalKillSwitch: boolean;
  maxDailyAutoActions: number;
  maxDailySpendTtd: number;
  maxTierWithoutApproval: number;
  notifyOnBlock: boolean;
}

/** The schema defaults (BusinessAutonomyProfile): kill switch off, 10 actions a day, no spend cap, tier ceiling 3. */
const DEFAULT_PROFILE: StoredProfile = { globalKillSwitch: false, maxDailyAutoActions: 10, maxDailySpendTtd: 0, maxTierWithoutApproval: 3, notifyOnBlock: true };

/** KeyAutonomySafetyService.ensureProfile, holding `stored` for every tenant. */
function guardSafety(stored: Partial<StoredProfile> = {}) {
  return {
    ensureProfile: vi.fn(async (businessId: string) => ({ id: `prof_${businessId}`, businessId, ...DEFAULT_PROFILE, ...stored })),
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
  // ADMINs the OWNER restricted (an explicit scope map makes the stored tier authoritative): tier 0 and tier 2.
  'u_admin_t0@biz_1': { role: 'ADMIN', maxApprovalTier: 0, permissionScopes: {} },
  'u_admin_t2@biz_1': { role: 'ADMIN', maxApprovalTier: 2, permissionScopes: {} },
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
  const guardFor = (owners: Record<string, string> = {}, stored: Partial<StoredProfile> = {}) => {
    expect(typeof AutonomyProfileWriteGuard, 'AutonomyProfileWriteGuard is exported by key-cortex.controller.ts').toBe('function');
    return new AutonomyProfileWriteGuard(guardPrisma(MEMBERS, owners), guardSafety(stored));
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
    // The stored ceiling is 2, so 3 is a raise (review CR-V103-1: an unchanged ceiling is no raise).
    const guard = guardFor({}, { maxTierWithoutApproval: 2 });
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
    const safety = guardSafety();
    const guard = new (AutonomyProfileWriteGuard ?? Object)(prisma, safety);
    const res = await decide(guard, { user: { id: 'u_super', role: 'SUPER_ADMIN' }, body: { maxDailyAutoActions: 1 }, query: {}, params: {} });
    expect(res).toBeInstanceOf(BadRequestException);
    expect(prisma.client.membership.findUnique).not.toHaveBeenCalled();
    expect(safety.ensureProfile).not.toHaveBeenCalled();
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
    const guard = new (AutonomyProfileWriteGuard ?? Object)(prisma, guardSafety());
    // BusinessGuard resolved the body's biz_1 (params, then body, then query) even though the query names biz_2.
    const res = await decide(guard, { user: { id: 'u_dual' }, body: { businessId: 'biz_1', globalKillSwitch: false }, query: { businessId: 'biz_2' }, params: {}, guardedBusinessId: 'biz_1' });
    expect(res).toBeInstanceOf(ForbiddenException);
    expect(prisma.client.membership.findUnique.mock.calls[0][0].where.userId_businessId).toEqual({ userId: 'u_dual', businessId: 'biz_1' });
    expect(await decide(guard, patchRequest({ id: 'u_dual' }, { globalKillSwitch: false }, 'biz_2'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Review repairs: the write is judged against the profile it       */
/*     leaves (ST-1), an unchanged field is no change (CR-V103-1), and  */
/*     every write is audited (ST-2)                                    */
/* ------------------------------------------------------------------ */

describe('V1-03 review ST-1 / CR-V103-1: a write that loosens the profile needs the tier of the ceiling the profile keeps', () => {
  const guardFor = (stored: Partial<StoredProfile> = {}) => new AutonomyProfileWriteGuard(guardPrisma(MEMBERS), guardSafety(stored));

  it('loosenedAutonomySettings names each setting that lets KEY act more or with less oversight, and nothing else', () => {
    const stored = { ...DEFAULT_PROFILE, globalKillSwitch: true, maxDailySpendTtd: 100 };
    expect(loosenedAutonomySettings(stored, {})).toEqual([]);
    // Resubmitting every stored value (the web form) loosens nothing.
    expect(loosenedAutonomySettings(stored, { ...stored })).toEqual([]);
    expect(loosenedAutonomySettings(stored, { globalKillSwitch: false })).toEqual(['globalKillSwitch']);
    expect(loosenedAutonomySettings(stored, { maxDailyAutoActions: 11 })).toEqual(['maxDailyAutoActions']);
    // 0 (or below) is an unlimited spend cap (KeyAutonomySafetyService.check), so it lifts a cap of 100.
    expect(loosenedAutonomySettings(stored, { maxDailySpendTtd: 0 })).toEqual(['maxDailySpendTtd']);
    expect(loosenedAutonomySettings(stored, { maxDailySpendTtd: -1 })).toEqual(['maxDailySpendTtd']);
    expect(loosenedAutonomySettings(stored, { maxDailySpendTtd: 101 })).toEqual(['maxDailySpendTtd']);
    expect(loosenedAutonomySettings(stored, { maxTierWithoutApproval: 4 })).toEqual(['maxTierWithoutApproval']);
    expect(loosenedAutonomySettings(stored, { notifyOnBlock: false })).toEqual(['notifyOnBlock']);
    // Tightening: kill switch on, lower ceiling and caps, a cap where there was none, notices on.
    expect(loosenedAutonomySettings({ ...DEFAULT_PROFILE, notifyOnBlock: false }, {
      globalKillSwitch: true, maxTierWithoutApproval: 1, maxDailyAutoActions: 2, maxDailySpendTtd: 50, notifyOnBlock: true,
    })).toEqual([]);
  });

  it("ST-1(b): an ADMIN at tier 3 releasing the kill switch over the OWNER's ceiling of 4 is 403 (KEY would run tier-4 tools unapproved)", async () => {
    const res = await decide(guardFor({ globalKillSwitch: true, maxTierWithoutApproval: 4 }), patchRequest({ id: 'u_admin' }, { globalKillSwitch: false }));
    expect(res).toBeInstanceOf(ForbiddenException);
    expect((res as Error).message).toContain('you have tier 3');
  });

  it('ST-1(b): the same ADMIN releasing the kill switch while bringing the ceiling down to their tier 3 is allowed', async () => {
    const guard = guardFor({ globalKillSwitch: true, maxTierWithoutApproval: 4 });
    expect(await decide(guard, patchRequest({ id: 'u_admin' }, { globalKillSwitch: false, maxTierWithoutApproval: 3 }))).toBe(true);
  });

  it("ST-1: an ADMIN at tier 3 raising a daily cap or lifting the spend cap under the OWNER's ceiling of 4 is 403, kill switch on or off", async () => {
    for (const globalKillSwitch of [false, true]) {
      const guard = guardFor({ globalKillSwitch, maxTierWithoutApproval: 4, maxDailySpendTtd: 100 });
      for (const body of [{ maxDailyAutoActions: 11 }, { maxDailySpendTtd: 0 }, { maxDailySpendTtd: 500 }, { notifyOnBlock: false }]) {
        expect(await decide(guard, patchRequest({ id: 'u_admin' }, body)), `${globalKillSwitch} ${JSON.stringify(body)}`).toBeInstanceOf(ForbiddenException);
      }
    }
  });

  it('ST-1(a): an ADMIN the OWNER restricted to tier 0 cannot release the kill switch, remove the spend cap or raise the action cap', async () => {
    const guard = guardFor({ globalKillSwitch: true, maxTierWithoutApproval: 4, maxDailySpendTtd: 100 });
    expect(await decide(guard, patchRequest({ id: 'u_admin_t0' }, { globalKillSwitch: false, maxDailySpendTtd: 0, maxDailyAutoActions: 1_000_000 })))
      .toBeInstanceOf(ForbiddenException);
    const atDefaultCeiling = guardFor({ globalKillSwitch: true, maxDailySpendTtd: 100 });
    for (const body of [{ globalKillSwitch: false }, { maxDailySpendTtd: 0 }, { maxDailyAutoActions: 11 }, { notifyOnBlock: false }]) {
      expect(await decide(atDefaultCeiling, patchRequest({ id: 'u_admin_t0' }, body)), JSON.stringify(body)).toBeInstanceOf(ForbiddenException);
    }
  });

  it('ST-1: a restricted ADMIN still tightens (kill switch on, lower ceiling and caps, a new spend cap) and may loosen only once the ceiling is within their tier', async () => {
    const guard = guardFor({ maxTierWithoutApproval: 4, maxDailySpendTtd: 100 });
    for (const body of [{ globalKillSwitch: true }, { maxTierWithoutApproval: 0 }, { maxDailyAutoActions: 2 }, { maxDailySpendTtd: 50 }, { notifyOnBlock: true }]) {
      expect(await decide(guard, patchRequest({ id: 'u_admin_t0' }, body)), JSON.stringify(body)).toBe(true);
    }
    expect(await decide(guardFor({ globalKillSwitch: true }), patchRequest({ id: 'u_admin_t0' }, { globalKillSwitch: false, maxTierWithoutApproval: 0 }))).toBe(true);
  });

  it("CR-V103-1: an ADMIN saving the web form's full body with the OWNER's stored ceiling of 4, to switch the kill switch ON, is allowed", async () => {
    const guard = guardFor({ globalKillSwitch: false, maxTierWithoutApproval: 4 });
    const form = { globalKillSwitch: true, maxDailyAutoActions: 10, maxDailySpendTtd: 0, maxTierWithoutApproval: 4, notifyOnBlock: true };
    expect(await decide(guard, patchRequest({ id: 'u_admin' }, form))).toBe(true);
  });

  it('CR-V103-1: an ADMIN restricted to tier 2 saving the unchanged default form (ceiling 3) is allowed; changing nothing is no raise', async () => {
    const form = { ...DEFAULT_PROFILE };
    expect(await decide(guardFor(), patchRequest({ id: 'u_admin_t2' }, form))).toBe(true);
    // ...but the same form releasing the kill switch over that ceiling of 3 is 403.
    expect(await decide(guardFor({ globalKillSwitch: true }), patchRequest({ id: 'u_admin_t2' }, { ...form, globalKillSwitch: false })))
      .toBeInstanceOf(ForbiddenException);
  });

  it('CR-V103-1: the full form raising the ceiling above the stored one and the caller tier is still 403 with the tier message', async () => {
    const res = await decide(guardFor(), patchRequest({ id: 'u_admin' }, { ...DEFAULT_PROFILE, maxTierWithoutApproval: 4 }));
    expect(res).toBeInstanceOf(ForbiddenException);
    expect((res as Error).message).toBe('Setting maxTierWithoutApproval to 4 requires approval tier 4; you have tier 3');
  });

  it('a field of the wrong type is 400 before it could be misread as no change', async () => {
    const guard = guardFor({ globalKillSwitch: true });
    for (const body of [{ globalKillSwitch: 'false' }, { notifyOnBlock: 0 }, { maxDailyAutoActions: '1000' }, { maxDailySpendTtd: Number.NaN }]) {
      expect(await decide(guard, patchRequest({ id: 'u_admin' }, body)), JSON.stringify(body)).toBeInstanceOf(BadRequestException);
    }
  });

  it('the stored profile is the one KeyAutonomySafetyService.ensureProfile holds for the guarded tenant; a failed read fails closed (403)', async () => {
    const safety = guardSafety();
    const guard = new AutonomyProfileWriteGuard(guardPrisma(MEMBERS), safety);
    expect(await decide(guard, patchRequest({ id: 'u_dual' }, { globalKillSwitch: false }, 'biz_2'))).toBe(true);
    expect(safety.ensureProfile.mock.calls).toEqual([['biz_2']]);
    const failing = { ensureProfile: vi.fn(async () => { throw new Error('db down'); }) };
    expect(await decide(new AutonomyProfileWriteGuard(guardPrisma(MEMBERS), failing), patchRequest({ id: 'u_admin' }, { globalKillSwitch: true })))
      .toBeInstanceOf(ForbiddenException);
  });

  it('an admitted write leaves the decision on the request for the audit row: writer, tier, stored profile, loosened settings', async () => {
    const req = patchRequest({ id: 'u_admin' }, { globalKillSwitch: false, maxDailyAutoActions: 20 });
    expect(await decide(guardFor({ globalKillSwitch: true }), req)).toBe(true);
    expect((req as any).autonomyProfileWrite).toEqual({
      businessId: 'biz_1',
      actorId: 'u_admin',
      actorTier: 3,
      before: { ...DEFAULT_PROFILE, globalKillSwitch: true },
      loosened: ['globalKillSwitch', 'maxDailyAutoActions'],
    });
  });
});

describe('V1-03 review ST-2, SEC-V103-1..3: every autonomy-profile write is a compare-and-set on the judged profile, committed with its audit row (AutonomyProfileAuditInterceptor)', () => {
  const decision = {
    businessId: 'biz_1',
    actorId: 'u_admin',
    actorTier: 3,
    before: { ...DEFAULT_PROFILE, globalKillSwitch: true },
    loosened: ['globalKillSwitch'],
  };
  /** The row the write leaves, as the transaction reads it back. */
  const leftRow = { id: 'prof_1', businessId: 'biz_1', ...DEFAULT_PROFILE, globalKillSwitch: false, createdAt: new Date(), updatedAt: new Date() };

  /** PrismaService with an interactive transaction whose client records every call. */
  function txPrisma(opts: { count?: number; create?: (...args: any[]) => Promise<unknown> } = {}) {
    const calls: string[] = [];
    const tx = {
      businessAutonomyProfile: {
        updateMany: vi.fn(async () => { calls.push('updateMany'); return { count: opts.count ?? 1 }; }),
        findUniqueOrThrow: vi.fn(async () => { calls.push('findUniqueOrThrow'); return leftRow; }),
      },
      teamActivityLog: { create: vi.fn(async (...args: any[]) => { calls.push('teamActivityLog.create'); return (opts.create ?? (async () => ({})))(...args); }) },
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
          calls.push('BEGIN');
          const out = await fn(tx);
          calls.push('COMMIT');
          return out;
        }),
        // Outside the transaction: nothing may write here.
        teamActivityLog: { create: vi.fn() },
        businessAutonomyProfile: { update: vi.fn(), updateMany: vi.fn() },
      },
    };
    return { tx, prisma, calls, interceptor: new AutonomyProfileAuditInterceptor(prisma) };
  }

  /** The PATCH as Nest runs it: the route interceptor around the real handler (safety is `{}`, so only the bound write can write). */
  function runPatch(interceptor: any, req: Record<string, unknown>, dto: Record<string, unknown>, businessId = 'biz_1') {
    const controller = build(stubs());
    return lastValueFrom(interceptor.intercept(httpContext(req), { handle: () => defer(() => controller.updateAutonomyProfile(dto as any, businessId)) }));
  }

  it('the PATCH handler carries the audit interceptor', () => {
    const interceptors: unknown[] = Reflect.getMetadata(INTERCEPTORS_METADATA, KeyCortexController.prototype.updateAutonomyProfile) ?? [];
    expect(AutonomyProfileAuditInterceptor).toBeDefined();
    expect(interceptors).toContain(AutonomyProfileAuditInterceptor);
  });

  it("writes one team_activity_logs row in the write's transaction: the guard's tenant and writer, the replaced profile as before, the row it left as after", async () => {
    const { tx, prisma, calls, interceptor } = txPrisma();
    const out = await runPatch(interceptor, { autonomyProfileWrite: decision }, { globalKillSwitch: false });
    expect(out).toBe(leftRow);
    expect(calls).toEqual(['BEGIN', 'updateMany', 'findUniqueOrThrow', 'teamActivityLog.create', 'COMMIT']);
    expect(prisma.client.teamActivityLog.create).not.toHaveBeenCalled();
    expect(tx.teamActivityLog.create).toHaveBeenCalledTimes(1);
    const { data } = (tx.teamActivityLog.create.mock.calls[0] as any[])[0];
    expect(data).toMatchObject({
      businessId: 'biz_1',
      userId: 'u_admin',
      module: 'settings',
      action: 'key_autonomy_profile_updated',
      entityType: 'businessAutonomyProfile',
      entityId: 'prof_1',
      meta: {
        before: decision.before,
        after: { ...DEFAULT_PROFILE, globalKillSwitch: false },
        changed: ['globalKillSwitch'],
        loosened: ['globalKillSwitch'],
        actorTier: 3,
      },
    });
    expect(data.title).toContain('globalKillSwitch true -> false');
  });

  it('SEC-V103-1: the write is a compare-and-set on the whole judged profile and writes only the settings that differ from it', async () => {
    const { tx, prisma, interceptor } = txPrisma();
    // The web form: every field, the ceiling resubmitted at its stored value.
    await runPatch(interceptor, { autonomyProfileWrite: decision }, { ...decision.before, globalKillSwitch: false });
    expect(prisma.client.businessAutonomyProfile.update).not.toHaveBeenCalled();
    const [{ where, data }] = tx.businessAutonomyProfile.updateMany.mock.calls[0] as any[];
    expect(where).toEqual({ businessId: 'biz_1', ...decision.before });
    const { updatedAt, ...settings } = data;
    expect(settings).toEqual({ globalKillSwitch: false });
    expect(updatedAt).toBeInstanceOf(Date);
  });

  it("SEC-V103-1: a stale write (the stored profile changed after the guard judged it) is 409, writes no audit row and answers no success; a stale no-op save too", async () => {
    for (const dto of [{ maxTierWithoutApproval: 3 }, { globalKillSwitch: false }]) {
      const { tx, interceptor } = txPrisma({ count: 0 });
      await expect(runPatch(interceptor, { autonomyProfileWrite: decision }, dto), JSON.stringify(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(tx.teamActivityLog.create).not.toHaveBeenCalled();
    }
    // The no-op save still runs the compare-and-set (Prisma skips an UPDATE with no data, so updatedAt is set).
    const noop = txPrisma({ count: 0 });
    await expect(runPatch(noop.interceptor, { autonomyProfileWrite: decision }, { ...decision.before })).rejects.toBeInstanceOf(ConflictException);
    const [{ data }] = noop.tx.businessAutonomyProfile.updateMany.mock.calls[0] as any[];
    expect(Object.keys(data)).toEqual(['updatedAt']);
    expect(noop.tx.teamActivityLog.create).not.toHaveBeenCalled();
  });

  it('SEC-V103-3: a failed audit insert fails the transaction it shares with the write (500), so the change rolls back with it', async () => {
    const { calls, interceptor } = txPrisma({ create: async () => { throw new Error('db down'); } });
    const res = runPatch(interceptor, { autonomyProfileWrite: decision }, { globalKillSwitch: false });
    await expect(res).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(res).rejects.toThrow('nothing was changed');
    // The insert threw inside the transaction callback: the write was never committed.
    expect(calls).toEqual(['BEGIN', 'updateMany', 'findUniqueOrThrow', 'teamActivityLog.create']);
  });

  it('a write that reached the interceptor without a guard decision is 500 and the handler never runs', async () => {
    const { prisma, interceptor } = txPrisma();
    const handle = vi.fn(() => of(leftRow));
    await expect(lastValueFrom(interceptor.intercept(httpContext({}), { handle }))).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(handle).not.toHaveBeenCalled();
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('a handler that answers without running the bound write is not answered as a success (500)', async () => {
    const { prisma, interceptor } = txPrisma();
    await expect(lastValueFrom(interceptor.intercept(httpContext({ autonomyProfileWrite: decision }), { handle: () => of(leftRow) })))
      .rejects.toBeInstanceOf(InternalServerErrorException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('the handler writes only the tenant the guard judged: another businessId is 403 and nothing is written', async () => {
    const { prisma, interceptor } = txPrisma();
    await expect(runPatch(interceptor, { autonomyProfileWrite: decision }, { globalKillSwitch: true }, 'biz_2')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });
});
