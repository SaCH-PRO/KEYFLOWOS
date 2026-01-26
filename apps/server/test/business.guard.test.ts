import { describe, expect, it } from 'vitest';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaServiceMock {
  constructor(private readonly businessAccess: boolean) {}
  client = {
    business: {
      findFirst: async () => (this.businessAccess ? { id: 'biz_1', ownerId: 'user_1' } : null),
    },
    membership: {
      findFirst: async () => (this.businessAccess ? { id: 'membership_1', role: 'OWNER' } : null),
    },
  };
}

const makeContext = (userId?: string, businessId?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: userId ? { id: userId } : undefined,
        params: { businessId },
      }),
    }),
  } as any);

describe('BusinessGuard', () => {
  it('allows access when user is a member/owner', async () => {
    const guard = new BusinessGuard(new PrismaServiceMock(true) as unknown as PrismaService);
    const result = await guard.canActivate(makeContext('user_1', 'biz_1'));
    expect(result).toBe(true);
  });

  it('throws unauthorized when no user', async () => {
    const guard = new BusinessGuard(new PrismaServiceMock(true) as unknown as PrismaService);
    await expect(guard.canActivate(makeContext(undefined, 'biz_1'))).rejects.toThrowError();
  });

  it('throws forbidden when user lacks business access', async () => {
    const guard = new BusinessGuard(new PrismaServiceMock(false) as unknown as PrismaService);
    await expect(guard.canActivate(makeContext('user_1', 'biz_1'))).rejects.toThrowError();
  });
});
