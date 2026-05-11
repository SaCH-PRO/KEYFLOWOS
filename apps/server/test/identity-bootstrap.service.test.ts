import { describe, expect, it, vi } from 'vitest';
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

describe('IdentityService.bootstrapUser', () => {
  it('reconciles an existing User row whose id differs from the Supabase auth id (task #308)', async () => {
    const { prisma, state } = makePrismaMock();

    state.users.push({
      id: 'old-local-id',
      email: 'collision@test.local',
      name: 'Existing Name',
      firstName: 'Existing',
      lastName: null,
      phone: null,
      avatarUrl: null,
      role: 'USER',
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

    const service = new IdentityService(prisma, blueprintMock);

    const result = await service.bootstrapUser({
      userId: 'new-supabase-id',
      email: 'collision@test.local',
      firstName: 'Updated',
      lastName: 'Name',
    });

    expect(result.user.id).toBe('new-supabase-id');
    expect(result.user.email).toBe('collision@test.local');
    expect(result.business.id).toBe('biz_pre');
    expect(result.business.ownerId).toBe('new-supabase-id');

    expect(state.users).toHaveLength(1);
    expect(state.users[0].id).toBe('new-supabase-id');
    expect(state.users[0].email).toBe('collision@test.local');
    expect(state.users[0].firstName).toBe('Existing');

    expect(state.memberships[0].userId).toBe('new-supabase-id');
    expect(state.sessions[0].userId).toBe('new-supabase-id');
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
