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
    aiExecutionLog: noopUpdateMany,
    aiApprovalItem: noopUpdateMany,
    aiPlan: noopUpdateMany,
    teamActivityLog: noopUpdateMany,
    $transaction: vi.fn(async (fn: any) => fn(client)),
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
});

describe('IdentityService.reconcileUserId (kept for an explicit operator migration; bootstrap no longer calls it)', () => {
  // The row-migration mechanics task #308 relied on, kept so an operator path
  // can reuse them (docs/auth-pathway.md, "Fixed by R0-SEC-01"). Asserted here
  // directly because no request handler reaches it any more.
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
