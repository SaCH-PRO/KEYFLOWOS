import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

class PrismaMock implements Partial<PrismaService> {
  private bookings: any[] = [];
  private services: any[] = [
    { id: 'service_1', businessId: 'biz_1', duration: 60, price: 100, name: 'Consult', deletedAt: null },
  ];
  client: any = {
    booking: {
      findMany: vi.fn(({ where }: any) =>
        this.bookings.filter((b) => b.businessId === where.businessId && b.deletedAt === null),
      ),
      findFirst: vi.fn(() => null),
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
    availability: {
      findMany: vi.fn(() => []),
    },
    service: {
      findFirstOrThrow: vi.fn(({ where }: any) => {
        const match = this.services.find((s) => s.id === where.id && s.businessId === where.businessId && s.deletedAt === null);
        if (!match) throw new Error('not found');
        return match;
      }),
    },
    contact: {
      findFirst: vi.fn(() => null),
      create: vi.fn(),
    },
  };
}

describe('BookingsService', () => {
  it('emits booking.created on createBooking', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { findOrCreateContact: vi.fn(), logContactEvent: vi.fn() };
    const automation = { handle: vi.fn() };
    const service = new BookingsService(
      prisma,
      events,
      crm as any,
      { createInvoiceForService: vi.fn() } as any,
      automation as any,
    );

    const start = new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const booking = await service.createBooking({
      businessId: 'biz_1',
      contactId: 'contact_1',
      serviceId: 'service_1',
      staffId: 'staff_1',
      startTime: start,
      endTime: end,
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
    const crm = { findOrCreateContact: vi.fn(), logContactEvent: vi.fn() };
    const automation = { handle: vi.fn() };
    const service = new BookingsService(
      prisma,
      events,
      crm as any,
      { createInvoiceForService: vi.fn() } as any,
      automation as any,
    );

    const startA = new Date();
    const endA = new Date(startA.getTime() + 60 * 60 * 1000);
    await service.createBooking({
      businessId: 'biz_1',
      contactId: 'contact_1',
      serviceId: 'service_1',
      staffId: 'staff_1',
      startTime: startA,
      endTime: endA,
    });
    const startB = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const endB = new Date(startB.getTime() + 60 * 60 * 1000);
    await service.createBooking({
      businessId: 'biz_2',
      contactId: 'contact_2',
      serviceId: 'service_2',
      staffId: 'staff_2',
      startTime: startB,
      endTime: endB,
    });

    const biz1 = await service.listBookings('biz_1');
    expect(biz1).toHaveLength(1);
    expect(biz1[0].businessId).toBe('biz_1');
  });

  it('creates booking and invoice in publicCreateBooking', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const createInvoiceForService = vi.fn().mockResolvedValue({ id: 'inv_1' });
    const findOrCreateContact = vi.fn().mockResolvedValue({ id: 'contact_public' });
    const logContactEvent = vi.fn();
    const automation = { handle: vi.fn() };
    const service = new BookingsService(
      prisma,
      events,
      { findOrCreateContact, logContactEvent } as any,
      { createInvoiceForService } as any,
      automation as any,
    );

    const result = await service.publicCreateBooking({
      businessId: 'biz_1',
      serviceId: 'service_1',
      staffId: 'staff_1',
      startTime: new Date(),
      contact: { email: 'a@example.com' },
    });

    expect(createInvoiceForService).toHaveBeenCalled();
    expect(findOrCreateContact).toHaveBeenCalledWith('biz_1', {
      email: 'a@example.com',
      source: 'booking',
      sourceDetail: 'public-booking',
    });
    expect(result.success).toBe(true);
    expect(result.invoiceId).toBe('inv_1');
    expect(emit).toHaveBeenCalledWith(
      'booking.created',
      expect.objectContaining({
        booking: expect.objectContaining({ id: expect.any(String) }),
        businessId: 'biz_1',
      }),
    );
  });
});
