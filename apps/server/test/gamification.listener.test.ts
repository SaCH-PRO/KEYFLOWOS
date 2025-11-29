import { describe, it, expect, vi } from 'vitest';
import { GamificationListener } from '../src/modules/gamification/gamification.listener';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private meta: Record<string, any> = {};
  client = {
    business: {
      findUnique: vi.fn(({ where }: any) => {
        if (this.meta[where.id]) {
          return { metaData: this.meta[where.id] };
        }
        return null;
      }),
      update: vi.fn(({ where, data }: any) => {
        this.meta[where.id] = data.metaData;
        return { id: where.id, metaData: data.metaData };
      }),
    },
  };
}

describe('GamificationListener', () => {
  it('sets firstBooking when booking.created fires', async () => {
    const prisma = new PrismaMock() as unknown as PrismaService;
    const listener = new GamificationListener(prisma);
    // seed findUnique to return empty meta for business
    (prisma as any).meta = { biz_1: {} };
    await listener.handleFirstBooking({
      booking: { id: 'b1' } as any,
      businessId: 'biz_1',
      contact: undefined,
    });

    expect((prisma as any).client.business.update).toHaveBeenCalled();
  });
});
