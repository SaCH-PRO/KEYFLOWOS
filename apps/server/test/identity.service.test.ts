import { describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../src/modules/identity/identity.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private businesses: any[] = [];
  private memberships: any[] = [];
  client: any = {
    $transaction: async (callback: any) => callback(this.client),
    business: {
      findMany: vi.fn(({ where }: any) => {
        if (where?.ownerId) {
          return this.businesses.filter((b) => b.ownerId === where.ownerId && b.deletedAt === null);
        }
        return this.businesses.filter((b) => b.deletedAt === null);
      }),
      create: vi.fn(({ data }: any) => {
        const item = { ...data, id: `biz_${this.businesses.length + 1}`, deletedAt: null };
        this.businesses.push(item);
        return item;
      }),
    },
    membership: {
      findMany: vi.fn(({ where }: any) => {
        const filtered = this.memberships.filter((m) => {
          if (where?.userId && m.userId !== where.userId) return false;
          if (where?.businessId && m.businessId !== where.businessId) return false;
          return true;
        });
        return filtered.map((membership) => ({
          ...membership,
          business: this.businesses.find((b) => b.id === membership.businessId),
          user: { id: membership.userId },
        }));
      }),
      create: vi.fn(({ data }: any) => {
        const item = { ...data, id: `mem_${this.memberships.length + 1}` };
        this.memberships.push(item);
        return item;
      }),
      upsert: vi.fn(({ where, create, update }: any) => {
        const existing = this.memberships.find(
          (m) => m.userId === where.userId_businessId.userId && m.businessId === where.userId_businessId.businessId,
        );
        if (existing) {
          Object.assign(existing, update);
          return { ...existing, user: { id: existing.userId } };
        }
        const item = { ...create, id: `mem_${this.memberships.length + 1}` };
        this.memberships.push(item);
        return { ...item, user: { id: item.userId } };
      }),
    },
  };
}

describe('IdentityService', () => {
  it('creates and lists businesses scoped by owner', async () => {
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new IdentityService(prisma);

    await service.createBusiness({ name: 'Acme', ownerId: 'user_1' });
    await service.createBusiness({ name: 'Beta', ownerId: 'user_2' });

    const owned = await service.listBusinesses('user_1');
    const all = await service.listBusinesses(undefined);

    expect(owned).toHaveLength(1);
    expect(owned[0].business?.name ?? owned[0].name).toBe('Acme');
    expect(all).toHaveLength(2);
  });
});
