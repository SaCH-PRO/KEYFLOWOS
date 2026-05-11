import { describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../src/modules/identity/identity.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { BlueprintService } from '../src/modules/blueprint/blueprint.service';

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

const blueprintMock = {
  inferFromOnboarding: vi.fn(async () => ({})),
} as unknown as BlueprintService;

describe('IdentityService', () => {
  it('creates and lists businesses scoped by owner', async () => {
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new IdentityService(prisma, blueprintMock);

    await service.createBusiness({ name: 'Acme', ownerId: 'user_1' });
    await service.createBusiness({ name: 'Beta', ownerId: 'user_2' });

    const owned = await service.listBusinesses('user_1');
    const user2Businesses = await service.listBusinesses('user_2');

    expect(owned).toHaveLength(1);
    expect(owned[0].name).toBe('Acme');
    expect(user2Businesses).toHaveLength(1);
    expect(user2Businesses[0].name).toBe('Beta');
  });
});
