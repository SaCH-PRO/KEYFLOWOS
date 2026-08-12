import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingWaitlistService, WAITLIST_STATUSES } from './booking-waitlist.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function mockEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry_1',
    businessId: 'biz_1',
    contactId: 'contact_1',
    serviceId: 'service_1',
    preferredStaffId: null,
    status: WAITLIST_STATUSES.WAITING,
    preferredDateFrom: null,
    preferredDateTo: null,
    preferredTimeOfDay: null,
    notes: null,
    offeredBookingId: null,
    offeredAt: null,
    convertedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    deletedAt: null,
    contact: { id: 'contact_1', firstName: 'Jane', lastName: 'Doe', displayName: null },
    service: { id: 'service_1', name: 'Consultation', duration: 60 },
    preferredStaff: null,
    ...overrides,
  };
}

describe('BookingWaitlistService', () => {
  let service: BookingWaitlistService;
  let prismaMock: any;
  let emit: ReturnType<typeof vi.fn>;
  let waitlistItems: any[] = [];

  beforeEach(async () => {
    emit = vi.fn();
    waitlistItems = [];
    prismaMock = {
      client: {
        contact: { findFirst: vi.fn(() => Promise.resolve({ id: 'contact_1' })) },
        service: { findFirst: vi.fn(() => Promise.resolve({ id: 'service_1' })) },
        staffMember: { findFirst: vi.fn(() => Promise.resolve({ id: 'staff_1' })) },
        bookingWaitlistEntry: {
          create: vi.fn((args: any) => Promise.resolve(mockEntry(args.data))),
          findFirst: vi.fn(() => Promise.resolve(null)),
          findMany: vi.fn((args: any) => {
            let items = [...waitlistItems];
            if (args.orderBy?.[0]?.createdAt === 'asc') {
              items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            }
            return Promise.resolve(items);
          }),
          update: vi.fn((args: any) => Promise.resolve(mockEntry(args.data))),
          count: vi.fn(() => Promise.resolve(waitlistItems.length)),
        },
        booking: {
          create: vi.fn((args: any) => Promise.resolve({
            id: 'booking_1',
            ...args.data,
            contact: { id: args.data.contactId, firstName: 'Jane', lastName: 'Doe' },
            service: { id: args.data.serviceId, name: 'Consultation' },
            staff: args.data.staffId ? { id: args.data.staffId, name: 'Sarah' } : null,
          })),
          update: vi.fn((args: any) => Promise.resolve({ id: args.where.id, status: args.data.status })),
        },
        $transaction: vi.fn(async (fn: any) => {
          if (typeof fn === 'function') {
            return fn(prismaMock.client);
          }
          return Promise.all(fn);
        }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingWaitlistService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: { emit } },
      ],
    }).compile();

    service = moduleRef.get(BookingWaitlistService);
  });

  describe('addToWaitlist', () => {
    it('creates a WAITING entry with validated relationships', async () => {
      const result = await service.addToWaitlist({
        businessId: 'biz_1',
        contactId: 'contact_1',
        serviceId: 'service_1',
        preferredStaffId: 'staff_1',
        preferredDateFrom: '2026-08-15T00:00:00Z',
        preferredTimeOfDay: 'morning',
        notes: 'Any time that week',
      });

      expect(result.status).toBe(WAITLIST_STATUSES.WAITING);
      expect(result.preferredTimeOfDay).toBe('morning');
      expect(prismaMock.client.bookingWaitlistEntry.create).toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith('booking.waitlist.added', expect.any(Object));
    });

    it('rejects an unknown contact', async () => {
      prismaMock.client.contact.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.addToWaitlist({ businessId: 'biz_1', contactId: 'bad_contact', serviceId: 'service_1' }),
      ).rejects.toThrow('Contact not found');
    });

    it('rejects an unknown preferred staff member', async () => {
      prismaMock.client.staffMember.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.addToWaitlist({
          businessId: 'biz_1',
          contactId: 'contact_1',
          serviceId: 'service_1',
          preferredStaffId: 'bad_staff',
        }),
      ).rejects.toThrow('Preferred staff member not found');
    });

    it('rejects a from-date after to-date', async () => {
      await expect(
        service.addToWaitlist({
          businessId: 'biz_1',
          contactId: 'contact_1',
          serviceId: 'service_1',
          preferredDateFrom: '2026-08-15T00:00:00Z',
          preferredDateTo: '2026-08-10T00:00:00Z',
        }),
      ).rejects.toThrow('preferredDateFrom must be before');
    });
  });

  describe('findWaitlistMatchesForSlot', () => {
    it('returns only entries for the same service', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        mockEntry({ id: 'a', serviceId: 'service_1' }),
        mockEntry({ id: 'b', serviceId: 'service_2' }),
      ]);

      const matches = await service.findWaitlistMatchesForSlot('biz_1', {
        startTime: new Date('2026-08-12T10:00:00Z'),
        endTime: new Date('2026-08-12T11:00:00Z'),
        serviceId: 'service_1',
      });

      expect(matches.map((m: any) => m.id)).toEqual(['a']);
    });

    it('respects preferred staff', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        mockEntry({ id: 'a', preferredStaffId: 'staff_1' }),
        mockEntry({ id: 'b', preferredStaffId: null }),
      ]);

      const matches = await service.findWaitlistMatchesForSlot('biz_1', {
        startTime: new Date('2026-08-12T10:00:00Z'),
        endTime: new Date('2026-08-12T11:00:00Z'),
        serviceId: 'service_1',
        staffId: 'staff_2',
      });

      expect(matches.map((m: any) => m.id)).toEqual(['b']);
    });

    it('respects preferred date range', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        mockEntry({ id: 'a', preferredDateFrom: new Date('2026-08-10T00:00:00Z'), preferredDateTo: new Date('2026-08-14T23:59:59Z') }),
        mockEntry({ id: 'b', preferredDateFrom: new Date('2026-08-15T00:00:00Z'), preferredDateTo: new Date('2026-08-20T23:59:59Z') }),
      ]);

      const matches = await service.findWaitlistMatchesForSlot('biz_1', {
        startTime: new Date('2026-08-13T10:00:00Z'),
        endTime: new Date('2026-08-13T11:00:00Z'),
        serviceId: 'service_1',
      });

      expect(matches.map((m: any) => m.id)).toEqual(['a']);
    });

    it('respects preferred time-of-day bucket', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        mockEntry({ id: 'a', preferredTimeOfDay: 'morning' }),
        mockEntry({ id: 'b', preferredTimeOfDay: 'afternoon' }),
      ]);

      const matches = await service.findWaitlistMatchesForSlot('biz_1', {
        startTime: new Date('2026-08-12T09:00:00Z'),
        endTime: new Date('2026-08-12T10:00:00Z'),
        serviceId: 'service_1',
      });

      expect(matches.map((m: any) => m.id)).toEqual(['a']);
    });

    it('returns oldest waiting entry first', async () => {
      waitlistItems = [
        mockEntry({ id: 'a', createdAt: new Date('2026-08-05T00:00:00Z') }),
        mockEntry({ id: 'b', createdAt: new Date('2026-08-03T00:00:00Z') }),
      ];

      const matches = await service.findWaitlistMatchesForSlot('biz_1', {
        startTime: new Date('2026-08-12T10:00:00Z'),
        endTime: new Date('2026-08-12T11:00:00Z'),
        serviceId: 'service_1',
      });

      expect(matches.map((m: any) => m.id)).toEqual(['b']);
    });
  });

  describe('offerSlot', () => {
    it('creates an UNCONFIRMED placeholder and marks entry OFFERED', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry());

      const result = await service.offerSlot('entry_1', {
        startTime: new Date('2026-08-12T10:00:00Z'),
        endTime: new Date('2026-08-12T11:00:00Z'),
        serviceId: 'service_1',
        staffId: 'staff_1',
      });

      expect(result.booking.status).toBe('UNCONFIRMED');
      expect(prismaMock.client.bookingWaitlistEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WAITLIST_STATUSES.OFFERED, offeredBookingId: 'booking_1' }),
        }),
      );
      expect(emit).toHaveBeenCalledWith('booking.waitlist.slot_offered', expect.any(Object));
    });

    it('refuses to offer a non-WAITING entry', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry({ status: WAITLIST_STATUSES.OFFERED }));
      await expect(
        service.offerSlot('entry_1', {
          startTime: new Date('2026-08-12T10:00:00Z'),
          endTime: new Date('2026-08-12T11:00:00Z'),
          serviceId: 'service_1',
        }),
      ).rejects.toThrow('Cannot offer slot');
    });
  });

  describe('convertWaitlistEntry', () => {
    it('confirms the placeholder booking and marks entry CONVERTED', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(
        mockEntry({ status: WAITLIST_STATUSES.OFFERED, offeredBookingId: 'booking_1' }),
      );

      const result = await service.convertWaitlistEntry('biz_1', 'entry_1');

      expect(result.booking.status).toBe('CONFIRMED');
      expect(prismaMock.client.bookingWaitlistEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WAITLIST_STATUSES.CONVERTED }),
        }),
      );
      expect(emit).toHaveBeenCalledWith('booking.waitlist.converted', expect.any(Object));
    });

    it('refuses to convert an entry that was not offered', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry({ status: WAITLIST_STATUSES.WAITING }));
      await expect(service.convertWaitlistEntry('biz_1', 'entry_1')).rejects.toThrow('no offered slot');
    });
  });

  describe('cancelWaitlistEntry', () => {
    it('cancels the entry and any offered placeholder booking', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(
        mockEntry({ status: WAITLIST_STATUSES.OFFERED, offeredBookingId: 'booking_1' }),
      );

      await service.cancelWaitlistEntry('biz_1', 'entry_1');

      expect(prismaMock.client.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'booking_1' }, data: { status: 'CANCELLED' } }),
      );
      expect(emit).toHaveBeenCalledWith('booking.waitlist.cancelled', expect.any(Object));
    });
  });
});
