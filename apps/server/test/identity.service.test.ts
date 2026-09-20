import { describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../src/modules/identity/identity.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { BlueprintService } from '../src/modules/blueprint/blueprint.service';

/**
 * The mock models both arms of workspace discovery, because KF-EXEC-TENANT-001
 * made `listBusinesses` Membership-first: it now matches
 * `{ OR: [{ members: { some: { userId } } }, { ownerId }] }` rather than
 * `{ ownerId }` alone.
 *
 * A mock that only understood `where.ownerId` fell through to "return
 * everything" against the new predicate, which is how this file failed in CI
 * while asserting nothing that had actually changed. Modelling the OR keeps the
 * original intent — each user sees exactly their own workspace — and, because
 * `create` now records the nested founding Membership, the first arm is
 * genuinely exercised rather than merely tolerated.
 */
class PrismaMock implements Partial<PrismaService> {
  private businesses: any[] = [];
  private memberships: { userId: string; businessId: string; role: string }[] = [];

  private matches(business: any, where: any): boolean {
    if (where?.deletedAt === null && business.deletedAt !== null) return false;
    if (where?.ownerId) return business.ownerId === where.ownerId;
    if (Array.isArray(where?.OR)) {
      return where.OR.some((clause: any) => {
        if (clause.ownerId) return business.ownerId === clause.ownerId;
        const memberUserId = clause.members?.some?.userId;
        if (memberUserId) {
          return this.memberships.some(
            (m) => m.businessId === business.id && m.userId === memberUserId,
          );
        }
        return false;
      });
    }
    return true;
  }

  client: any = {
    business: {
      findMany: vi.fn(({ where }: any) => this.businesses.filter((b) => this.matches(b, where))),
      create: vi.fn(({ data }: any) => {
        const { members, ...scalars } = data;
        const item = { ...scalars, id: `biz_${this.businesses.length + 1}`, deletedAt: null };
        this.businesses.push(item);
        // The nested founding Membership the constructor now writes.
        if (members?.create) {
          this.memberships.push({ ...members.create, businessId: item.id });
        }
        return item;
      }),
    },
  };

  membershipsFor(businessId: string) {
    return this.memberships.filter((m) => m.businessId === businessId);
  }

  /** Seed a non-founding membership, as inviteTeamMember would. */
  addMembership(userId: string, businessId: string, role: string) {
    this.memberships.push({ userId, businessId, role });
  }
}

const blueprintMock = {
  inferFromOnboarding: vi.fn(async () => ({})),
} as unknown as BlueprintService;

describe('IdentityService', () => {
  it('creates and lists businesses scoped by owner', async () => {
    const prisma = new PrismaMock();
    const service = new IdentityService(prisma as unknown as PrismaService, blueprintMock);

    await service.createBusiness({ name: 'Acme', ownerId: 'user_1' });
    await service.createBusiness({ name: 'Beta', ownerId: 'user_2' });

    const owned = await service.listBusinesses('user_1');
    const user2Businesses = await service.listBusinesses('user_2');

    expect(owned).toHaveLength(1);
    expect(owned[0].name).toBe('Acme');
    expect(user2Businesses).toHaveLength(1);
    expect(user2Businesses[0].name).toBe('Beta');
  });

  it('gives each new business exactly one founding OWNER membership', async () => {
    const prisma = new PrismaMock();
    const service = new IdentityService(prisma as unknown as PrismaService, blueprintMock);

    const business = await service.createBusiness({ name: 'Acme', ownerId: 'user_1' });

    expect(prisma.membershipsFor(business.id)).toEqual([
      { userId: 'user_1', businessId: business.id, role: 'OWNER' },
    ]);
  });

  it('lists a workspace the user belongs to but does not own', async () => {
    // The behaviour change this packet exists for. Under the previous
    // ownerId-only predicate this returned an empty list.
    const prisma = new PrismaMock();
    const service = new IdentityService(prisma as unknown as PrismaService, blueprintMock);

    const business = await service.createBusiness({ name: 'Acme', ownerId: 'user_1' });
    prisma.addMembership('staff_1', business.id, 'STAFF');

    const staffSees = await service.listBusinesses('staff_1');

    expect(staffSees.map((b: any) => b.name)).toEqual(['Acme']);
  });
});
