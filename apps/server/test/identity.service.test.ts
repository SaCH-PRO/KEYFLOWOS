import { describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../src/modules/identity/identity.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private businesses: any[] = [];
  client: any = {
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
    expect(owned[0].name).toBe('Acme');
    expect(all).toHaveLength(2);
  });
});
