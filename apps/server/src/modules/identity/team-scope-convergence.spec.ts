import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { IdentityService } from './identity.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { Reflector } from '@nestjs/core';

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
