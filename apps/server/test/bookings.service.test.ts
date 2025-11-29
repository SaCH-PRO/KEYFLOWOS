import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private bookings: any[] = [];
  client = {
    booking: {
      findMany: vi.fn(({ where }: any) =>
        this.bookings.filter((b) => b.businessId === where.businessId && b.deletedAt === null),
      ),
      create: vi.fn(({ data }: any) => {
        const item = {
          ...data,
          id: `booking_${this.bookings.length + 1}`,
          deletedAt: null,
          createdAt: new Date(),
        };
        this.bookings.push(item);
        return item;
      }),
    },
  };
}

describe('BookingsService', () => {
  it('emits booking.created on createBooking', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new BookingsService(prisma, events);

    const booking = await service.createBooking({
      businessId: 'biz_1',
      contactId: 'contact_1',
      serviceId: 'service_1',
      staffId: 'staff_1',
      startTime: new Date(),
      endTime: new Date(),
    });

    expect(emit).toHaveBeenCalledWith(
      'booking.created',
      expect.objectContaining({
        businessId: 'biz_1',
        booking: expect.objectContaining({ id: booking.id }),
      }),
    );
  });

  it('lists bookings per business', async () => {
    const events = { emit: vi.fn() } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const service = new BookingsService(prisma, events);

    await service.createBooking({
      businessId: 'biz_1',
      contactId: 'contact_1',
      serviceId: 'service_1',
      staffId: 'staff_1',
      startTime: new Date(),
      endTime: new Date(),
    });
    await service.createBooking({
      businessId: 'biz_2',
      contactId: 'contact_2',
      serviceId: 'service_2',
      staffId: 'staff_2',
      startTime: new Date(),
      endTime: new Date(),
    });

    const biz1 = await service.listBookings('biz_1');
    expect(biz1).toHaveLength(1);
    expect(biz1[0].businessId).toBe('biz_1');
  });
});
