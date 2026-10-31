import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IdentityService } from './identity.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { Reflector } from '@nestjs/core';
import { ROLE_DEFAULT_SCOPES, DEFAULT_APPROVAL_TIERS } from '../../core/authority/module-vocabulary';

/**
 * The C1 outage, proved closed at the writer AND at the enforcer.
 *
 * `module-vocabulary.spec.ts` proves the two tables are the same object. That is
 * necessary and it is not sufficient: what actually broke was the round trip — a map
 * WRITTEN by `inviteTeamMember` and then READ by `ModuleScopeGuard`, where the guard
 * consults an explicit map instead of its defaults. So these tests write through the
 * real service and then admit through the real guard, rather than asserting on a
 * constant either one happens to import.
 */

const ADMIN_REQUESTER = 'requester_1';
const BUSINESS = 'biz_1';

class TeamPrismaFake {
  memberships: any[] = [];
  users: any[] = [{ id: ADMIN_REQUESTER, email: 'owner@x.test', role: 'USER' }];
  private seq = 0;

  constructor() {
    this.memberships.push({
      id: 'mem_owner',
      userId: ADMIN_REQUESTER,
      businessId: BUSINESS,
      role: 'OWNER',
      permissionScopes: null,
      maxApprovalTier: 0,
    });
  }

  client: any = {
    membership: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return this.memberships.find((m) => m.id === where.id) ?? null;
        const k = where.userId_businessId;
        return this.memberships.find((m) => m.userId === k.userId && m.businessId === k.businessId) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        this.memberships.find((m) => m.userId === where.userId && m.businessId === where.businessId) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `mem_${++this.seq}`, ...data };
        this.memberships.push(row);
        return { ...row, user: { id: data.userId, email: 'x@y.test', name: null, firstName: null, lastName: null, avatarUrl: null } };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = this.memberships.find((m) => m.id === where.id)!;
        Object.assign(row, data);
        return { ...row, user: { id: row.userId, email: 'x@y.test', name: null, firstName: null, lastName: null, avatarUrl: null } };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) =>
        this.users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `user_${++this.seq}`, ...data };
        this.users.push(row);
        return row;
      }),
    },
    teamActivityLog: { create: vi.fn(async () => ({})) },
  };
}

const blueprint = { inferFromOnboarding: vi.fn(async () => ({})) } as unknown as BlueprintService;

function serviceWith(fake: TeamPrismaFake) {
  return new IdentityService(fake as unknown as PrismaService, blueprint);
}

/** Admit a request through the REAL guard against whatever the writer persisted. */
async function guardAdmits(
  fake: TeamPrismaFake,
  userId: string,
  module: string,
  minLevel: 'read' | 'write' | 'admin',
): Promise<boolean> {
  class Probe {
    @RequireModuleScope(module, minLevel)
    handler() {}
  }
  const guard = new ModuleScopeGuard(fake as unknown as PrismaService, new Reflector());
  const ctx: any = {
    getHandler: () => Probe.prototype.handler,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId }, params: { businessId: BUSINESS } }) }),
  };
  try {
    return await guard.canActivate(ctx);
  } catch {
    return false;
  }
}

describe('C1 — invited members reach the operations and analytics routes', () => {
  it.each([
    ['ADMIN', 'admin'],
    ['STAFF', 'read'],
  ])('an invited %s is admitted to operations at %s', async (role, level) => {
    // THE REGRESSION: inviteTeamMember wrote an 11-key map, the guard read
    // `scopes['operations'] || 'none'`, and every invited member — ADMIN included —
    // was refused on all 58 operations routes.
    const fake = new TeamPrismaFake();
    const invited = await serviceWith(fake).inviteTeamMember(BUSINESS, 'new@x.test', role, ADMIN_REQUESTER);

    expect(await guardAdmits(fake, invited.userId, 'operations', level as any)).toBe(true);
    expect(await guardAdmits(fake, invited.userId, 'analytics', level as any)).toBe(true);
  });

  it('an invited STAFF is still refused write on operations', async () => {
    // Convergence restored the guard's declared defaults; it did not widen them.
    const fake = new TeamPrismaFake();
    const invited = await serviceWith(fake).inviteTeamMember(BUSINESS, 'staff@x.test', 'STAFF', ADMIN_REQUESTER);
    expect(await guardAdmits(fake, invited.userId, 'operations', 'write')).toBe(false);
  });

  it('a role change does not strip operations or analytics', async () => {
    const fake = new TeamPrismaFake();
    const service = serviceWith(fake);
    const invited = await service.inviteTeamMember(BUSINESS, 'new@x.test', 'STAFF', ADMIN_REQUESTER);

    await service.updateMemberRole(BUSINESS, invited.id, 'ADMIN', ADMIN_REQUESTER);

    expect(await guardAdmits(fake, invited.userId, 'operations', 'admin')).toBe(true);
    expect(await guardAdmits(fake, invited.userId, 'analytics', 'admin')).toBe(true);
  });

  it('an explicit scope update accepts operations and analytics', async () => {
    // These two names were rejected as `Invalid module`, so the outage could not even
    // be repaired by hand through the API.
    const fake = new TeamPrismaFake();
    const service = serviceWith(fake);
    const invited = await service.inviteTeamMember(BUSINESS, 'new@x.test', 'STAFF', ADMIN_REQUESTER);

    await expect(
      service.updateMemberPermissions(BUSINESS, invited.id, { operations: 'write', analytics: 'read' }, 1, ADMIN_REQUESTER),
    ).resolves.toBeTruthy();

    expect(await guardAdmits(fake, invited.userId, 'operations', 'write')).toBe(true);
    expect(await guardAdmits(fake, invited.userId, 'analytics', 'read')).toBe(true);
    // The same map denies everything it does not name — legacy explicit-map behaviour.
    expect(await guardAdmits(fake, invited.userId, 'crm', 'read')).toBe(false);
  });

  it('still rejects a module name that is not in the canonical vocabulary', async () => {
    const fake = new TeamPrismaFake();
    const service = serviceWith(fake);
    const invited = await service.inviteTeamMember(BUSINESS, 'new@x.test', 'STAFF', ADMIN_REQUESTER);

    await expect(
      service.updateMemberPermissions(BUSINESS, invited.id, { finance: 'admin' }, 0, ADMIN_REQUESTER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('C1 — connect is reachable only by explicit grant', () => {
  it('is denied by role default for an invited ADMIN', async () => {
    const fake = new TeamPrismaFake();
    const invited = await serviceWith(fake).inviteTeamMember(BUSINESS, 'a@x.test', 'ADMIN', ADMIN_REQUESTER);
    expect(await guardAdmits(fake, invited.userId, 'connect', 'read')).toBe(false);
  });

  it('is denied by role default for an owner with no explicit map', async () => {
    const fake = new TeamPrismaFake();
    expect(await guardAdmits(fake, ADMIN_REQUESTER, 'connect', 'read')).toBe(false);
  });

  it('is admitted once explicitly granted, and only then', async () => {
    const fake = new TeamPrismaFake();
    const service = serviceWith(fake);
    const invited = await service.inviteTeamMember(BUSINESS, 'a@x.test', 'ADMIN', ADMIN_REQUESTER);

    await service.updateMemberPermissions(BUSINESS, invited.id, { connect: 'write' }, 0, ADMIN_REQUESTER);

    expect(await guardAdmits(fake, invited.userId, 'connect', 'write')).toBe(true);
    expect(await guardAdmits(fake, invited.userId, 'connect', 'admin')).toBe(false);
  });
});

/**
 * R0-ID-F1-ROLE-ROUTE-AUTHORITY (ST-1). `updateMemberRole` rewrites the target's
 * scope map and approval tier to the role defaults, so it is a permissions write:
 * it needs what `updateMemberPermissions` needs (OWNER, SUPER_ADMIN or team:admin),
 * a non-OWNER cannot aim it at its own membership, and a non-OWNER cannot grant a
 * role whose defaults exceed its own authority (K2). The OWNER requester above is
 * the positive control ("a role change does not strip operations or analytics").
 */
describe('ST-1 — the role route is a permissions write, bounded by the caller', () => {
  function addMember(
    fake: TeamPrismaFake,
    m: { id: string; userId: string; role: string; permissionScopes?: Record<string, string> | null; maxApprovalTier?: number },
    userRole = 'USER',
  ) {
    fake.users.push({ id: m.userId, email: `${m.userId}@x.test`, role: userRole });
    fake.memberships.push({ businessId: BUSINESS, permissionScopes: null, maxApprovalTier: 0, ...m });
  }
  const snapshot = (fake: TeamPrismaFake, id: string) => JSON.stringify(fake.memberships.find((m) => m.id === id));

  /** A STAFF target restricted by the OWNER, plus the caller under test. */
  function setup(caller: { role: string; permissionScopes?: Record<string, string> | null; maxApprovalTier?: number }, userRole = 'USER') {
    const fake = new TeamPrismaFake();
    addMember(fake, { id: 'mem_target', userId: 'u_target', role: 'STAFF', permissionScopes: { crm: 'read', team: 'none' }, maxApprovalTier: 0 });
    addMember(fake, { id: 'mem_caller', userId: 'u_caller', ...caller }, userRole);
    return { fake, service: serviceWith(fake) };
  }

  it.each([
    ['STAFF', 'the same role (scope reset)'],
    ['ADMIN', 'a higher role'],
  ])('a team:write ADMIN cannot set %s (%s) on another member: Forbidden, nothing written', async (role) => {
    const { fake, service } = setup({ role: 'ADMIN' }); // role defaults: team:write
    const before = snapshot(fake, 'mem_target');
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', role, 'u_caller')).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshot(fake, 'mem_target')).toBe(before);
    expect(fake.client.membership.update).not.toHaveBeenCalled();
    expect(fake.client.teamActivityLog.create).not.toHaveBeenCalled();
  });

  it('a non-OWNER with team:admin cannot change its own membership', async () => {
    const { fake, service } = setup({ role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin' }, maxApprovalTier: 3 });
    const before = snapshot(fake, 'mem_caller');
    for (const role of ['ADMIN', 'STAFF']) {
      await expect(service.updateMemberRole(BUSINESS, 'mem_caller', role, 'u_caller')).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(snapshot(fake, 'mem_caller')).toBe(before);
    expect(fake.client.membership.update).not.toHaveBeenCalled();
  });

  it('a non-OWNER with team:admin and authority at or above the role changes another member', async () => {
    const { fake, service } = setup({ role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin' }, maxApprovalTier: 3 });
    const updated = await service.updateMemberRole(BUSINESS, 'mem_target', 'ADMIN', 'u_caller');
    expect(updated.role).toBe('ADMIN');
    const row = fake.memberships.find((m) => m.id === 'mem_target');
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.ADMIN);
    expect(row.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS.ADMIN);
    expect(await guardAdmits(fake, 'u_target', 'operations', 'admin')).toBe(true);
    // The actor is recorded.
    expect(fake.client.teamActivityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u_caller', action: 'role_changed', entityId: 'mem_target' }) }),
    );
  });

  it('a team:admin caller cannot grant a role whose default scopes exceed its own', async () => {
    // Tier 3 is enough for ADMIN, but `settings` is only read here.
    const { fake, service } = setup({
      role: 'ADMIN',
      permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin', settings: 'read' },
      maxApprovalTier: 3,
    });
    const before = snapshot(fake, 'mem_target');
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'ADMIN', 'u_caller')).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshot(fake, 'mem_target')).toBe(before);
  });

  it('a team:admin caller cannot grant a role whose default approval tier exceeds its own', async () => {
    // Every scope is at ADMIN level, but the caller's tier is 1 and ADMIN's is 3.
    const { fake, service } = setup({ role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin' }, maxApprovalTier: 1 });
    const before = snapshot(fake, 'mem_target');
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'ADMIN', 'u_caller')).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshot(fake, 'mem_target')).toBe(before);
    // STAFF (tier 0, read-only defaults) is within that caller's authority.
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'STAFF', 'u_caller')).resolves.toMatchObject({ role: 'STAFF' });
  });

  it('a SUPER_ADMIN user is admitted as on the permissions route', async () => {
    const { service } = setup({ role: 'STAFF', permissionScopes: { team: 'none' } }, 'SUPER_ADMIN');
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'ADMIN', 'u_caller')).resolves.toMatchObject({ role: 'ADMIN' });
  });

  it('fails closed without a requester: nothing written', async () => {
    const { fake, service } = setup({ role: 'ADMIN' });
    const before = snapshot(fake, 'mem_target');
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'ADMIN', undefined as unknown as string)).rejects.toThrow();
    expect(snapshot(fake, 'mem_target')).toBe(before);
    expect(fake.client.membership.update).not.toHaveBeenCalled();
  });

  it('the OWNER membership cannot be changed, even by the OWNER', async () => {
    const fake = new TeamPrismaFake();
    await expect(serviceWith(fake).updateMemberRole(BUSINESS, 'mem_owner', 'ADMIN', ADMIN_REQUESTER)).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.memberships.find((m) => m.id === 'mem_owner').role).toBe('OWNER');
  });
});

/**
 * R0-ID-F1-ROLE-ROUTE-AUTHORITY review repairs. The role route's rules were not
 * applied to its sibling PATCH .../permissions, and the ceiling compared only module
 * levels and the tier of what was granted:
 *   ST-F1  a non-OWNER team:admin member rewrote its OWN map and tier through .../permissions;
 *   ST-F2  .../permissions had no grantor ceiling;
 *   ST-F3  the ceiling ignored the CRM ownership sub-permissions (crm_view, crm_edit,
 *          crm_reassign, crm_delete), which resolveCrmAccess defaults from the level
 *          when a map omits them;
 *   ST-F5  nothing bounded WHOM a requester could rewrite: a tier-0 team:admin member
 *          demoted a tier-3 ADMIN.
 */
describe('ST-1 review repairs — both authority writes share one rule set', () => {
  function addMember(
    fake: TeamPrismaFake,
    m: { id: string; userId: string; role: string; permissionScopes?: Record<string, string> | null; maxApprovalTier?: number },
    userRole = 'USER',
  ) {
    fake.users.push({ id: m.userId, email: `${m.userId}@x.test`, role: userRole });
    fake.memberships.push({ businessId: BUSINESS, permissionScopes: null, maxApprovalTier: 0, ...m });
  }
  const snapshot = (fake: TeamPrismaFake, id: string) => JSON.stringify(fake.memberships.find((m) => m.id === id));
  const ADMIN_TEAM_ADMIN = { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin' };
  /** CRM-restricted to "my book", with no reassign or delete. */
  const CRM_OWNED_ONLY = { crm_view: 'owned', crm_edit: 'owned', crm_reassign: 'false', crm_delete: 'none' };

  type Member = { role: string; permissionScopes?: Record<string, string> | null; maxApprovalTier?: number };
  function setup(
    caller: Member,
    target: Member = { role: 'STAFF', permissionScopes: { crm: 'read', team: 'none' }, maxApprovalTier: 0 },
  ) {
    const fake = new TeamPrismaFake();
    addMember(fake, { id: 'mem_target', userId: 'u_target', ...target });
    addMember(fake, { id: 'mem_caller', userId: 'u_caller', ...caller });
    return { fake, service: serviceWith(fake) };
  }

  it('ST-F1: a non-OWNER team:admin member cannot rewrite its OWN permissions: Forbidden, nothing written', async () => {
    for (const caller of [
      { role: 'ADMIN', permissionScopes: ADMIN_TEAM_ADMIN, maxApprovalTier: 3 },
      { role: 'STAFF', permissionScopes: { crm: 'read', team: 'admin' }, maxApprovalTier: 0 },
    ]) {
      const { fake, service } = setup(caller);
      const before = snapshot(fake, 'mem_caller');
      await expect(
        service.updateMemberPermissions(BUSINESS, 'mem_caller', { ...ROLE_DEFAULT_SCOPES.OWNER }, 4, 'u_caller'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Not even a narrowing: a self-target is refused outright, as on the role route.
      await expect(
        service.updateMemberPermissions(BUSINESS, 'mem_caller', { crm: 'read', team: 'admin' }, 0, 'u_caller'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(snapshot(fake, 'mem_caller')).toBe(before);
      expect(fake.client.membership.update).not.toHaveBeenCalled();
      expect(fake.client.teamActivityLog.create).not.toHaveBeenCalled();
    }
  });

  it('the permissions write needs team:admin in the service too (it checked team:write): Forbidden for a team:write ADMIN', async () => {
    const { fake, service } = setup({ role: 'ADMIN' }); // role defaults: team:write
    const before = snapshot(fake, 'mem_target');
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { crm: 'read', team: 'none' }, 0, 'u_caller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshot(fake, 'mem_target')).toBe(before);
  });

  it('ST-F2: a team:admin member cannot grant scopes or a tier above its own through .../permissions', async () => {
    const { fake, service } = setup({ role: 'STAFF', permissionScopes: { crm: 'read', team: 'admin' }, maxApprovalTier: 0 });
    const before = snapshot(fake, 'mem_target');
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { ...ROLE_DEFAULT_SCOPES.OWNER }, 4, 'u_caller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // One module above its own level is enough ...
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { crm: 'read', settings: 'read' }, 0, 'u_caller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // ... and so is the tier alone.
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { crm: 'read' }, 1, 'u_caller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshot(fake, 'mem_target')).toBe(before);
    expect(fake.client.membership.update).not.toHaveBeenCalled();

    // Positive control: within its own authority, the same caller succeeds.
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { crm: 'read', team: 'read' }, 0, 'u_caller'),
    ).resolves.toMatchObject({ permissionScopes: { crm: 'read', team: 'read' } });
  });

  it('ST-F3: a CRM-restricted grantor cannot confer CRM ownership authority beyond its own, on either route', async () => {
    const caller = { role: 'ADMIN', permissionScopes: { ...ADMIN_TEAM_ADMIN, ...CRM_OWNED_ONLY }, maxApprovalTier: 3 };
    const target = { role: 'STAFF', permissionScopes: { crm: 'read', ...CRM_OWNED_ONLY, crm_edit: 'none' }, maxApprovalTier: 0 };
    const { fake, service } = setup(caller, target);
    const before = snapshot(fake, 'mem_target');
    // Role defaults carry no crm_* keys, so resolveCrmAccess gives the target the
    // level defaults: view all (STAFF), or view all + edit any + reassign + delete any (ADMIN).
    for (const role of ['STAFF', 'ADMIN']) {
      await expect(service.updateMemberRole(BUSINESS, 'mem_target', role, 'u_caller'), role).rejects.toBeInstanceOf(ForbiddenException);
    }
    // The same through .../permissions: omitting the sub-keys, or naming a wider one.
    for (const scopes of [
      { crm: 'read' },
      { crm: 'read', ...CRM_OWNED_ONLY, crm_view: 'all' },
      { crm: 'write', ...CRM_OWNED_ONLY, crm_edit: 'any' },
      { crm: 'write', ...CRM_OWNED_ONLY, crm_reassign: 'true' },
      { crm: 'write', ...CRM_OWNED_ONLY, crm_delete: 'owned' },
    ]) {
      await expect(
        service.updateMemberPermissions(BUSINESS, 'mem_target', scopes, 0, 'u_caller'),
        JSON.stringify(scopes),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(snapshot(fake, 'mem_target')).toBe(before);
    expect(fake.client.membership.update).not.toHaveBeenCalled();

    // Positive control: the same restrictions, a higher crm level and another module.
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { crm: 'write', ...CRM_OWNED_ONLY, revenue: 'read' }, 1, 'u_caller'),
    ).resolves.toBeTruthy();
  });

  it('ST-F5: a requester cannot rewrite a member whose current authority exceeds its own, on either route', async () => {
    // STAFF defaults + team:admin at tier 0; the target is a tier-3 ADMIN with team:admin.
    const caller = { role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, team: 'admin' }, maxApprovalTier: 0 };
    const { fake, service } = setup(caller, { role: 'ADMIN', permissionScopes: ADMIN_TEAM_ADMIN, maxApprovalTier: 3 });
    const before = snapshot(fake, 'mem_target');
    // STAFF defaults are within the caller's own authority: only the target ceiling refuses.
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'STAFF', 'u_caller')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateMemberPermissions(BUSINESS, 'mem_target', { crm: 'read' }, 0, 'u_caller'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshot(fake, 'mem_target')).toBe(before);
    expect(fake.client.membership.update).not.toHaveBeenCalled();
  });

  it('ST-F5 positive control: the same requester changes a member within its own authority', async () => {
    const caller = { role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, team: 'admin' }, maxApprovalTier: 0 };
    const { fake, service } = setup(caller, { role: 'STAFF', permissionScopes: null, maxApprovalTier: 0 });
    await expect(service.updateMemberRole(BUSINESS, 'mem_target', 'STAFF', 'u_caller')).resolves.toMatchObject({ role: 'STAFF' });
    expect(fake.memberships.find((m) => m.id === 'mem_target').permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
  });

  it('the OWNER is not bounded on .../permissions: it grants any map and tier to another member', async () => {
    const fake = new TeamPrismaFake();
    addMember(fake, { id: 'mem_target', userId: 'u_target', role: 'STAFF', permissionScopes: { crm: 'read' }, maxApprovalTier: 0 });
    await expect(
      serviceWith(fake).updateMemberPermissions(BUSINESS, 'mem_target', { ...ROLE_DEFAULT_SCOPES.OWNER }, 4, ADMIN_REQUESTER),
    ).resolves.toBeTruthy();
    expect(fake.memberships.find((m) => m.id === 'mem_target').maxApprovalTier).toBe(4);
  });
});
