import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { IdentityService } from '../src/modules/identity/identity.service';
import type { BlueprintService } from '../src/modules/blueprint/blueprint.service';

const blueprintMock = {
  inferFromOnboarding: async () => ({}),
} as unknown as BlueprintService;
import { PrismaService } from '../src/core/prisma/prisma.service';

/**
 * Minimal in-memory Prisma stand-in that supports the operations
 * `IdentityService.bootstrapUser` and `reconcileUserId` need.
 *
 * Modelled tables: user (unique id + unique email), business, membership,
 * session. AI tables are intentionally omitted to make sure the reconcile
 * code defends against `tx.aiX === undefined`.
 */
function makePrismaMock() {
  const users: any[] = [];
  const businesses: any[] = [];
  const memberships: any[] = [];
  const sessions: any[] = [];

  const findUserByWhere = (where: any) => {
    if (where?.id) return users.find((u) => u.id === where.id) ?? null;
    if (where?.email) return users.find((u) => u.email === where.email) ?? null;
    return null;
  };

  const userTable = {
    findUnique: vi.fn(({ where }: any) => findUserByWhere(where)),
    findFirst: vi.fn(({ where }: any) => {
      return (
        users.find((u) => {
          if (where?.name && u.name !== where.name) return false;
          if (where?.NOT?.id && u.id === where.NOT.id) return false;
          return true;
        }) ?? null
      );
    }),
    create: vi.fn(({ data }: any) => {
      if (users.some((u) => u.id === data.id)) {
        const e: any = new Error('Unique constraint failed on (id)');
        e.code = 'P2002';
        throw e;
      }
      if (users.some((u) => u.email === data.email)) {
        const e: any = new Error('Unique constraint failed on (email)');
        e.code = 'P2002';
        throw e;
      }
      const row = {
        firstName: null,
        lastName: null,
        phone: null,
        avatarUrl: null,
        name: null,
        role: 'USER',
        ...data,
      };
      users.push(row);
      return row;
    }),
    update: vi.fn(({ where, data }: any) => {
      const u = findUserByWhere(where);
      if (!u) throw new Error('user not found');
      if (data.email && data.email !== u.email && users.some((x) => x.email === data.email)) {
        const e: any = new Error('Unique constraint failed on (email)');
        e.code = 'P2002';
        throw e;
      }
      Object.assign(u, data);
      return u;
    }),
    delete: vi.fn(({ where }: any) => {
      const idx = users.findIndex((u) => u.id === where.id);
      if (idx === -1) throw new Error('user not found');
      const [removed] = users.splice(idx, 1);
      return removed;
    }),
  };

  const businessTable = {
    count: vi.fn(({ where }: any) => businesses.filter((b) => b.ownerId === where?.ownerId).length),
    findFirst: vi.fn(({ where, orderBy }: any) => {
      let rows = businesses.filter((b) => {
        if (where?.ownerId && b.ownerId !== where.ownerId) return false;
        if (where?.deletedAt === null && b.deletedAt !== null) return false;
        return true;
      });
      if (orderBy?.createdAt === 'asc') {
        rows = rows.slice().sort((a, b) => a.createdAt - b.createdAt);
      }
      return rows[0] ?? null;
    }),
    create: vi.fn(({ data }: any) => {
      const row = { id: `biz_${businesses.length + 1}`, deletedAt: null, createdAt: Date.now(), ...data };
      businesses.push(row);
      return row;
    }),
    updateMany: vi.fn(({ where, data }: any) => {
      let count = 0;
      for (const b of businesses) {
        if (where?.ownerId && b.ownerId === where.ownerId) {
          Object.assign(b, data);
          count += 1;
        }
      }
      return { count };
    }),
  };

  const membershipTable = {
    count: vi.fn(({ where }: any) => memberships.filter((m) => m.userId === where?.userId).length),
    findMany: vi.fn(({ where }: any) =>
      memberships.filter((m) => m.userId === where?.userId).map((m) => ({ role: m.role })),
    ),
    upsert: vi.fn(({ where, create, update }: any) => {
      const key = where.userId_businessId;
      const existing = memberships.find(
        (m) => m.userId === key.userId && m.businessId === key.businessId,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      memberships.push(create);
      return create;
    }),
    updateMany: vi.fn(({ where, data }: any) => {
      let count = 0;
      for (const m of memberships) {
        if (where?.userId && m.userId === where.userId) {
          Object.assign(m, data);
          count += 1;
        }
      }
      return { count };
    }),
  };

  const sessionTable = {
    count: vi.fn(({ where }: any) => sessions.filter((x) => x.userId === where?.userId).length),
    updateMany: vi.fn(({ where, data }: any) => {
      let count = 0;
      for (const s of sessions) {
        if (where?.userId && s.userId === where.userId) {
          Object.assign(s, data);
          count += 1;
        }
      }
      return { count };
    }),
  };

  const noopUpdateMany = { updateMany: vi.fn(async () => ({ count: 0 })) };

  const client: any = {
    user: userTable,
    business: businessTable,
    membership: membershipTable,
    session: sessionTable,
    userIdentity: { count: vi.fn(async () => 0) },
    aiExecutionLog: noopUpdateMany,
    aiApprovalItem: noopUpdateMany,
    aiPlan: noopUpdateMany,
    teamActivityLog: noopUpdateMany,
    $transaction: vi.fn(async (fn: any) => fn(client)),
    // The row lock adoptInvitePlaceholder takes (SELECT ... FOR UPDATE).
    $queryRaw: vi.fn(async () => []),
  };

  return {
    prisma: { client } as unknown as PrismaService,
    state: { users, businesses, memberships, sessions },
  };
}

/** The pre-existing local account another caller must never be moved onto. */
function seedHolder(state: ReturnType<typeof makePrismaMock>['state'], role: 'USER' | 'SUPER_ADMIN' = 'USER') {
  state.users.push({
    id: 'old-local-id',
    email: 'collision@test.local',
    name: 'Existing Name',
    firstName: 'Existing',
    lastName: null,
    phone: null,
    avatarUrl: null,
    role,
  });
  state.businesses.push({
    id: 'biz_pre',
    name: "Existing's Workspace",
    ownerId: 'old-local-id',
    deletedAt: null,
    createdAt: 1,
  });
  state.memberships.push({ userId: 'old-local-id', businessId: 'biz_pre', role: 'OWNER' });
  state.sessions.push({ id: 'sess_1', userId: 'old-local-id' });
}

function expectHolderUntouched(state: ReturnType<typeof makePrismaMock>['state'], role: 'USER' | 'SUPER_ADMIN') {
  expect(state.users).toEqual([
    expect.objectContaining({ id: 'old-local-id', email: 'collision@test.local', role, firstName: 'Existing' }),
  ]);
  expect(state.businesses).toEqual([expect.objectContaining({ id: 'biz_pre', ownerId: 'old-local-id' })]);
  expect(state.memberships).toEqual([{ userId: 'old-local-id', businessId: 'biz_pre', role: 'OWNER' }]);
  expect(state.sessions).toEqual([{ id: 'sess_1', userId: 'old-local-id' }]);
}

describe('IdentityService.bootstrapUser', () => {
  // R0-SEC-01-BOOTSTRAP-TAKEOVER. Until this packet the case below was the
  // task #308 reconcile: bootstrap moved the row, its role, memberships,
  // sessions and Business.ownerId to whichever caller presented the email.
  // That is the account takeover; a different-id holder is now a 409.
  it.each(['USER', 'SUPER_ADMIN'] as const)(
    'refuses with 409 account_email_in_use and writes nothing when a %s with a different id already holds the email',
    async (role) => {
      const { prisma, state } = makePrismaMock();
      seedHolder(state, role);
      const service = new IdentityService(prisma, blueprintMock);

      const attempt = service.bootstrapUser({
        userId: 'new-supabase-id',
        email: 'collision@test.local',
        firstName: 'Updated',
        lastName: 'Name',
        company: 'Takeover Co',
      });

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await attempt.catch((err: ConflictException) => {
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toMatchObject({ code: 'account_email_in_use' });
      });

      expectHolderUntouched(state, role);
      const client = (prisma as any).client;
      expect(client.user.create).not.toHaveBeenCalled();
      expect(client.user.update).not.toHaveBeenCalled();
      expect(client.user.delete).not.toHaveBeenCalled();
      expect(client.business.create).not.toHaveBeenCalled();
      expect(client.business.updateMany).not.toHaveBeenCalled();
      expect(client.membership.upsert).not.toHaveBeenCalled();
      expect(client.membership.updateMany).not.toHaveBeenCalled();
      expect(client.$transaction).not.toHaveBeenCalled();
    },
  );

  it('a returning user with the same id is idempotent: same row, same role, same business, one membership', async () => {
    const { prisma, state } = makePrismaMock();
    seedHolder(state, 'SUPER_ADMIN');
    const service = new IdentityService(prisma, blueprintMock);

    const first = await service.bootstrapUser({ userId: 'old-local-id', email: 'collision@test.local' });
    const second = await service.bootstrapUser({ userId: 'old-local-id', email: 'collision@test.local' });

    for (const result of [first, second]) {
      expect(result.user).toMatchObject({ id: 'old-local-id', email: 'collision@test.local', role: 'SUPER_ADMIN' });
      expect(result.business.id).toBe('biz_pre');
      expect(result.isNewBusiness).toBe(false);
    }
    expect(state.users).toHaveLength(1);
    expect(state.businesses).toHaveLength(1);
    expect(state.memberships).toEqual([{ userId: 'old-local-id', businessId: 'biz_pre', role: 'OWNER' }]);
  });

  it('creates a fresh User and Business for a brand-new Supabase user (no regression)', async () => {
    const { prisma, state } = makePrismaMock();
    const service = new IdentityService(prisma, blueprintMock);

    const result = await service.bootstrapUser({
      userId: 'brand-new-id',
      email: 'fresh@test.local',
      firstName: 'Fresh',
    });

    expect(result.user.id).toBe('brand-new-id');
    expect(result.user.email).toBe('fresh@test.local');
    expect(result.business.ownerId).toBe('brand-new-id');
    expect(state.users).toHaveLength(1);
    expect(state.businesses).toHaveLength(1);
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({
      userId: 'brand-new-id',
      businessId: result.business.id,
      role: 'OWNER',
    });
  });

  it('never asks for an ownership proof when an account holds the email (the 409 path stays proof-free)', async () => {
    const { prisma, state } = makePrismaMock();
    seedHolder(state, 'SUPER_ADMIN');
    const service = new IdentityService(prisma, blueprintMock);
    const proveEmailOwnership = vi.fn(async () => true);

    const attempt = service.bootstrapUser(
      { userId: 'new-supabase-id', email: 'collision@test.local' },
      { proveEmailOwnership },
    );

    await expect(attempt).rejects.toMatchObject({ response: { code: 'account_email_in_use' } });
    expect(proveEmailOwnership).not.toHaveBeenCalled();
    expectHolderUntouched(state, 'SUPER_ADMIN');
  });
});

/**
 * R0-SEC-01 review repair (SEC01-T1, CR-1): the placeholder inviteTeamMember
 * creates for an address with no account, with its pending STAFF membership.
 */
function seedInvitePlaceholder(state: ReturnType<typeof makePrismaMock>['state'], meta: Record<string, unknown> = { invitePlaceholder: true }) {
  state.users.push({
    id: 'invite-placeholder-id',
    email: 'invitee@test.local',
    name: 'invitee',
    firstName: null,
    lastName: null,
    phone: null,
    avatarUrl: null,
    role: 'USER',
    metaData: meta,
    referralCode: null,
    deletedAt: null,
    bannedAt: null,
  });
  state.memberships.push({ userId: 'invite-placeholder-id', businessId: 'biz_inviter', role: 'STAFF' });
}

describe('IdentityService.bootstrapUser — a pending team invitation (R0-SEC-01 review repair)', () => {
  it('with proof of email ownership, adopts the placeholder: the STAFF membership moves to the caller, which also gets its own workspace', async () => {
    const { prisma, state } = makePrismaMock();
    seedInvitePlaceholder(state);
    const service = new IdentityService(prisma, blueprintMock);
    const proveEmailOwnership = vi.fn(async () => true);

    const result = await service.bootstrapUser(
      { userId: 'invitee-sub', email: 'invitee@test.local', firstName: 'Ivy' },
      { proveEmailOwnership },
    );

    expect(proveEmailOwnership).toHaveBeenCalledTimes(1);
    expect(result.user).toMatchObject({ id: 'invitee-sub', email: 'invitee@test.local', role: 'USER' });
    expect(state.users.map((u) => u.id)).toEqual(['invitee-sub']);
    expect(state.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'invitee-sub', businessId: 'biz_inviter', role: 'STAFF' }),
        expect.objectContaining({ userId: 'invitee-sub', businessId: result.business.id, role: 'OWNER' }),
      ]),
    );
    // The adoption re-checked the row under a lock inside the move's transaction.
    expect((prisma as any).client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'no proof is offered', prove: undefined },
    { label: 'the proof resolves false', prove: async () => false },
    {
      label: 'the proof throws',
      prove: async () => {
        throw new Error('supabase down');
      },
    },
  ])('when $label, answers 409 invite_email_unverified and writes nothing', async ({ prove }) => {
    const { prisma, state } = makePrismaMock();
    seedInvitePlaceholder(state);
    const service = new IdentityService(prisma, blueprintMock);

    const attempt = service.bootstrapUser(
      { userId: 'invitee-sub', email: 'invitee@test.local' },
      prove ? { proveEmailOwnership: prove } : {},
    );

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await attempt.catch((err: ConflictException) => {
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({ code: 'invite_email_unverified' });
    });
    const client = (prisma as any).client;
    expect(client.user.create).not.toHaveBeenCalled();
    expect(client.user.update).not.toHaveBeenCalled();
    expect(client.user.delete).not.toHaveBeenCalled();
    expect(client.membership.updateMany).not.toHaveBeenCalled();
    expect(client.membership.upsert).not.toHaveBeenCalled();
    expect(state.users.map((u) => u.id)).toEqual(['invite-placeholder-id']);
    expect(state.memberships).toEqual([{ userId: 'invite-placeholder-id', businessId: 'biz_inviter', role: 'STAFF' }]);
  });

  it('a placeholder whose invitation was removed carries nothing: adopted without asking for proof', async () => {
    const { prisma, state } = makePrismaMock();
    seedInvitePlaceholder(state);
    state.memberships.length = 0;
    const service = new IdentityService(prisma, blueprintMock);
    const proveEmailOwnership = vi.fn(async () => false);

    const result = await service.bootstrapUser(
      { userId: 'owner-of-address', email: 'invitee@test.local' },
      { proveEmailOwnership },
    );

    expect(proveEmailOwnership).not.toHaveBeenCalled();
    expect(result.user.id).toBe('owner-of-address');
    expect(state.users.map((u) => u.id)).toEqual(['owner-of-address']);
    expect(state.memberships).toEqual([
      expect.objectContaining({ userId: 'owner-of-address', businessId: result.business.id, role: 'OWNER' }),
    ]);
  });

  it.each([
    { label: 'has no invite marker', meta: {} },
    { label: 'carries a marker that is not exactly true', meta: { invitePlaceholder: 'true' } },
  ])('a row that $label is an account: 409 account_email_in_use, no proof asked, no transaction', async ({ meta }) => {
    const { prisma, state } = makePrismaMock();
    seedInvitePlaceholder(state, meta);
    const service = new IdentityService(prisma, blueprintMock);
    const proveEmailOwnership = vi.fn(async () => true);

    const attempt = service.bootstrapUser(
      { userId: 'invitee-sub', email: 'invitee@test.local' },
      { proveEmailOwnership },
    );

    await expect(attempt).rejects.toMatchObject({ response: { code: 'account_email_in_use' } });
    expect(proveEmailOwnership).not.toHaveBeenCalled();
    expect((prisma as any).client.$transaction).not.toHaveBeenCalled();
    expect(state.users.map((u) => u.id)).toEqual(['invite-placeholder-id']);
  });
});

describe('IdentityService.reconcileUserId (never for an account; bootstrap uses it only to adopt an invite placeholder)', () => {
  // The row-migration mechanics task #308 relied on. Since R0-SEC-01 its only
  // caller is adoptInvitePlaceholder (above); asserted here directly, without
  // the guard that caller passes.
  it('moves the row, memberships, sessions and Business.ownerId from the old id to the new one', async () => {
    const { prisma, state } = makePrismaMock();
    seedHolder(state, 'USER');
    const service = new IdentityService(prisma, blueprintMock);

    const user = await (service as any).reconcileUserId('old-local-id', {
      userId: 'new-supabase-id',
      email: 'collision@test.local',
      firstName: 'Updated',
      lastName: 'Name',
    });

    expect(user.id).toBe('new-supabase-id');
    expect(user.email).toBe('collision@test.local');
    expect(state.users).toHaveLength(1);
    expect(state.users[0].id).toBe('new-supabase-id');
    expect(state.users[0].firstName).toBe('Existing');
    expect(state.businesses[0].ownerId).toBe('new-supabase-id');
    expect(state.memberships[0].userId).toBe('new-supabase-id');
    expect(state.sessions[0].userId).toBe('new-supabase-id');
  });
});
