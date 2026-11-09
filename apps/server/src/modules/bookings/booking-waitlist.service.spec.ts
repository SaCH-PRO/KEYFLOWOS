import { Test } from '@nestjs/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
          // PR196-WAITLIST-EXPIRY: the expiry's compare-and-set.
          updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
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
          // PR196-WAITLIST-EXPIRY: the hold's release is a compare-and-set.
          updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
          // V1-27: offerSlot's placeholder is a slot claim; no booking overlaps here.
          findFirst: vi.fn(() => Promise.resolve(null)),
        },
        $transaction: vi.fn(async (fn: any) => {
          if (typeof fn === 'function') {
            return fn(prismaMock.client);
          }
          return Promise.all(fn);
        }),
        // V1-27: the slot claim's advisory lock.
        $executeRaw: vi.fn(() => Promise.resolve(0)),
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
        mockEntry({
          status: WAITLIST_STATUSES.OFFERED,
          offeredBookingId: 'booking_1',
          // V1-27 (CR-2): the included placeholder, which names the calendar the convert locks.
          offeredBooking: { id: 'booking_1', businessId: 'biz_1', serviceId: 'service_1', staffId: null, status: 'UNCONFIRMED' },
        }),
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

  // ---------------------------------------------------------------------------
  // PR196-WAITLIST-EXPIRY (D-86): offers expire after a fixed 120-minute hold.
  // The real-database proof (races, both orders) is
  // test/booking-waitlist-expiry.integration.test.ts; these pin the shape.
  // ---------------------------------------------------------------------------
  describe('expireStaleOffers (PR196-WAITLIST-EXPIRY)', () => {
    const HOLD_START = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    const HOLD_END = new Date(HOLD_START.getTime() + 60 * 60_000);

    function staleOffer(overrides: Record<string, unknown> = {}) {
      return {
        id: 'entry_stale',
        businessId: 'biz_1',
        contactId: 'contact_1',
        serviceId: 'service_1',
        status: WAITLIST_STATUSES.OFFERED,
        offeredBookingId: 'hold_1',
        offeredAt: new Date(Date.now() - 121 * 60_000),
        contact: { id: 'contact_1', firstName: 'Jane', lastName: 'Doe', displayName: null },
        service: { id: 'service_1', name: 'Consultation' },
        business: { id: 'biz_1', timezone: 'UTC' },
        offeredBooking: {
          id: 'hold_1',
          businessId: 'biz_1',
          serviceId: 'service_1',
          staffId: 'staff_1',
          startTime: HOLD_START,
          endTime: HOLD_END,
        },
        ...overrides,
      };
    }

    it('the hold is a fixed 120 minutes, and the scan reads only OFFERED entries offered at least that long ago', async () => {
      const mod = await import('./booking-waitlist.service');
      expect((mod as any).WAITLIST_OFFER_HOLD_MINUTES).toBe(120);
      const offeredAt = new Date('2031-03-01T10:00:00.000Z');
      expect((mod as any).waitlistOfferExpiresAt(offeredAt).toISOString()).toBe('2031-03-01T12:00:00.000Z');

      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([]);
      const before = Date.now();
      const result = await (service as any).expireStaleOffers();
      const after = Date.now();

      expect(result).toEqual({ expired: 0, cascaded: 0, failed: 0 });
      const scan = prismaMock.client.bookingWaitlistEntry.findMany.mock.calls[0][0];
      expect(scan.where.status).toBe(WAITLIST_STATUSES.OFFERED);
      expect(scan.where.deletedAt).toBeNull();
      const cutoff = (scan.where.offeredAt.lte as Date).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(before - 120 * 60_000);
      expect(cutoff).toBeLessThanOrEqual(after - 120 * 60_000);
    });

    it('expires under the slot lock with a compare-and-set, releases only an UNCONFIRMED hold, and offers the slot to the next WAITING entry', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([staleOffer()]);
      waitlistItems = [mockEntry({ id: 'entry_next', status: WAITLIST_STATUSES.WAITING })];
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry({ id: 'entry_next' }));

      const result = await (service as any).expireStaleOffers();

      expect(result).toEqual({ expired: 1, cascaded: 1, failed: 0 });
      const cas = prismaMock.client.bookingWaitlistEntry.updateMany.mock.calls[0][0];
      expect(cas.where).toMatchObject({
        id: 'entry_stale',
        businessId: 'biz_1',
        status: WAITLIST_STATUSES.OFFERED,
        offeredBookingId: 'hold_1',
      });
      expect(cas.data).toEqual({ status: WAITLIST_STATUSES.EXPIRED });
      const release = prismaMock.client.booking.updateMany.mock.calls[0][0];
      expect(release.where).toMatchObject({ id: 'hold_1', businessId: 'biz_1', status: 'UNCONFIRMED' });
      expect(release.data).toEqual({ status: 'CANCELLED' });
      // The V1-27 slot lock is taken before the compare-and-set.
      const lockOrder = prismaMock.client.$executeRaw.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(prismaMock.client.bookingWaitlistEntry.updateMany.mock.invocationCallOrder[0]);
      // The next WAITING entry gets the same staff and time.
      expect(prismaMock.client.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ staffId: 'staff_1', startTime: HOLD_START, endTime: HOLD_END, status: 'UNCONFIRMED' }),
        }),
      );
      expect(emit).toHaveBeenCalledWith(
        'booking.waitlist.slot_offered',
        expect.objectContaining({ businessId: 'biz_1', actorType: 'SYSTEM' }),
      );
      expect(emit).toHaveBeenCalledWith(
        'booking.waitlist.offer_expired',
        expect.objectContaining({ businessId: 'biz_1', released: true, cascadedToEntryId: 'entry_next', actorType: 'SYSTEM' }),
      );
    });

    it('a lost compare-and-set (converted or expired meanwhile) changes nothing and cascades nothing (F1-D1)', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([staleOffer()]);
      prismaMock.client.bookingWaitlistEntry.updateMany.mockResolvedValueOnce({ count: 0 });
      waitlistItems = [mockEntry({ id: 'entry_next' })];

      const result = await (service as any).expireStaleOffers();

      expect(result).toEqual({ expired: 0, cascaded: 0, failed: 0 });
      expect(prismaMock.client.booking.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.client.booking.create).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith('booking.waitlist.slot_offered', expect.anything());
    });

    it('a hold that is still held (confirmed by staff) is not released and the slot is not cascaded (F1-D2)', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([staleOffer()]);
      prismaMock.client.booking.updateMany.mockResolvedValueOnce({ count: 0 });
      waitlistItems = [mockEntry({ id: 'entry_next' })];

      const result = await (service as any).expireStaleOffers();

      expect(result).toEqual({ expired: 1, cascaded: 0, failed: 0 });
      expect(prismaMock.client.booking.create).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        'booking.waitlist.offer_expired',
        expect.objectContaining({ released: false, cascadedToEntryId: null }),
      );
    });

    it('a slot that has already started is released but not offered again', async () => {
      const past = new Date(Date.now() - 60 * 60_000);
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        staleOffer({
          offeredBooking: { id: 'hold_1', businessId: 'biz_1', serviceId: 'service_1', staffId: 'staff_1', startTime: past, endTime: new Date() },
        }),
      ]);
      waitlistItems = [mockEntry({ id: 'entry_next' })];

      const result = await (service as any).expireStaleOffers();

      expect(result).toEqual({ expired: 1, cascaded: 0, failed: 0 });
      expect(prismaMock.client.booking.create).not.toHaveBeenCalled();
    });

    it('each entry is isolated: one failure does not abort the batch (F1-D6)', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        staleOffer({ id: 'entry_broken' }),
        staleOffer({ id: 'entry_ok', offeredBookingId: 'hold_2', offeredBooking: { ...staleOffer().offeredBooking, id: 'hold_2' } }),
      ]);
      prismaMock.client.bookingWaitlistEntry.updateMany.mockRejectedValueOnce(new Error('connection reset'));

      const result = await (service as any).expireStaleOffers();

      expect(result).toEqual({ expired: 1, cascaded: 0, failed: 1 });
      const ids = prismaMock.client.bookingWaitlistEntry.updateMany.mock.calls.map((c: any[]) => c[0].where.id);
      expect(ids).toEqual(['entry_broken', 'entry_ok']);
    });

    it('a refused cascade is contained: the expiry stands and the batch goes on (F1-D6)', async () => {
      prismaMock.client.bookingWaitlistEntry.findMany.mockResolvedValueOnce([
        staleOffer({ id: 'entry_a' }),
        staleOffer({ id: 'entry_b', offeredBookingId: 'hold_2', offeredBooking: { ...staleOffer().offeredBooking, id: 'hold_2' } }),
      ]);
      waitlistItems = [mockEntry({ id: 'entry_next' })];
      // offerSlot re-reads the candidate and finds it no longer WAITING (another offer won it).
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValue(mockEntry({ id: 'entry_next', status: WAITLIST_STATUSES.OFFERED }));

      const result = await (service as any).expireStaleOffers();

      expect(result).toEqual({ expired: 2, cascaded: 0, failed: 0 });
      expect(prismaMock.client.booking.updateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('convertWaitlistEntry is a compare-and-set (PR196-WAITLIST-EXPIRY, F1-D1)', () => {
    it('the CONVERTED write is conditioned on the entry still being OFFERED with this placeholder, in this business', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(
        mockEntry({
          status: WAITLIST_STATUSES.OFFERED,
          offeredBookingId: 'booking_1',
          offeredBooking: { id: 'booking_1', businessId: 'biz_1', serviceId: 'service_1', staffId: null, status: 'UNCONFIRMED' },
        }),
      );

      await service.convertWaitlistEntry('biz_1', 'entry_1');

      const write = prismaMock.client.bookingWaitlistEntry.update.mock.calls[0][0];
      expect(write.where).toMatchObject({
        id: 'entry_1',
        businessId: 'biz_1',
        status: WAITLIST_STATUSES.OFFERED,
        offeredBookingId: 'booking_1',
      });
      expect(prismaMock.client.booking.update.mock.calls[0][0].where).toMatchObject({ id: 'booking_1', businessId: 'biz_1' });
    });

    it('an entry expired after the read is refused, and the placeholder is not confirmed', async () => {
      const { Prisma } = await import('@prisma/client');
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(
        mockEntry({
          status: WAITLIST_STATUSES.OFFERED,
          offeredBookingId: 'booking_1',
          offeredBooking: { id: 'booking_1', businessId: 'biz_1', serviceId: 'service_1', staffId: null, status: 'UNCONFIRMED' },
        }),
      );
      prismaMock.client.bookingWaitlistEntry.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', { code: 'P2025', clientVersion: 'test' }),
      );

      await expect(service.convertWaitlistEntry('biz_1', 'entry_1')).rejects.toThrow('no offered slot');
      expect(prismaMock.client.booking.update).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith('booking.waitlist.converted', expect.anything());
    });
  });

  describe('offerSlot names its actor and its deadline (PR196-WAITLIST-EXPIRY, F1-D5)', () => {
    it('a USER offer made in a request names the member bound for this business, and carries the 120-minute deadline', async () => {
      const { runWithTenant } = await import('../../core/tenant/tenant-context');
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry());

      await runWithTenant('biz_1', 'user_1', () =>
        service.offerSlot(
          'entry_1',
          { startTime: new Date('2031-08-12T10:00:00Z'), endTime: new Date('2031-08-12T11:00:00Z'), serviceId: 'service_1', staffId: 'staff_1' },
          'USER',
        ),
      );

      const offered = emit.mock.calls.find((c: any[]) => c[0] === 'booking.waitlist.slot_offered')![1];
      expect(offered.actorType).toBe('USER');
      expect(offered.actorId).toBe('user_1');
      const offeredAt = new Date(offered.entry.offeredAt).getTime();
      expect(new Date(offered.offerExpiresAt).getTime()).toBe(offeredAt + 120 * 60_000);
    });

    it('a USER offer with no request bound to this business is recorded as SYSTEM, never as a nameless USER', async () => {
      const { runWithTenant } = await import('../../core/tenant/tenant-context');
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry());

      await runWithTenant('biz_other', 'user_9', () =>
        service.offerSlot(
          'entry_1',
          { startTime: new Date('2031-08-12T10:00:00Z'), endTime: new Date('2031-08-12T11:00:00Z'), serviceId: 'service_1' },
          'USER',
        ),
      );

      const offered = emit.mock.calls.find((c: any[]) => c[0] === 'booking.waitlist.slot_offered')![1];
      expect(offered.actorType).toBe('SYSTEM');
      expect(offered.actorId).toBeUndefined();
    });

    it('the WAITING to OFFERED write is a compare-and-set in the slot claim', async () => {
      prismaMock.client.bookingWaitlistEntry.findFirst.mockResolvedValueOnce(mockEntry());

      await service.offerSlot('entry_1', {
        startTime: new Date('2031-08-12T10:00:00Z'),
        endTime: new Date('2031-08-12T11:00:00Z'),
        serviceId: 'service_1',
      });

      const write = prismaMock.client.bookingWaitlistEntry.update.mock.calls[0][0];
      expect(write.where).toMatchObject({ id: 'entry_1', businessId: 'biz_1', status: WAITLIST_STATUSES.WAITING });
      // Written after the lock, inside the claim.
      expect(prismaMock.client.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prismaMock.client.bookingWaitlistEntry.update.mock.invocationCallOrder[0],
      );
    });
  });
});

// -----------------------------------------------------------------------------
// PR196-WAITLIST-EXPIRY: staff are notified, the customer is not (D-86, F1-D4),
// and the timeline event is canonical (F1-D5).
// -----------------------------------------------------------------------------
describe('BookingWaitlistListener offer notifications (PR196-WAITLIST-EXPIRY)', () => {
  const offeredAt = new Date('2031-03-03T14:00:00.000Z');
  const deadline = new Date('2031-03-03T16:00:00.000Z');

  function offeredPayload(overrides: Record<string, unknown> = {}) {
    return {
      businessId: 'biz_1',
      actorType: 'SYSTEM',
      offerExpiresAt: deadline,
      timeZone: 'America/Port_of_Spain',
      entry: {
        id: 'entry_1',
        contactId: 'contact_1',
        serviceId: 'service_1',
        status: WAITLIST_STATUSES.OFFERED,
        offeredBookingId: 'booking_1',
        offeredAt,
        contact: { id: 'contact_1', firstName: 'Jane', lastName: 'Doe', displayName: null },
        service: { id: 'service_1', name: 'Consultation' },
      },
      booking: {
        id: 'booking_1',
        startTime: new Date('2031-03-05T14:00:00.000Z'),
        endTime: new Date('2031-03-05T15:00:00.000Z'),
        staffId: 'staff_1',
        contact: { id: 'contact_1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.test' },
        service: { id: 'service_1', name: 'Consultation' },
        staff: { id: 'staff_1', name: 'Sarah' },
      },
      ...overrides,
    };
  }

  async function build() {
    const { BookingWaitlistListener } = await import('./booking-waitlist.listener');
    const notifications = { create: vi.fn(async (input: any) => ({ id: 'notif_1', ...input })) };
    const crm = { logContactEvent: vi.fn(async () => ({ id: 'ev_1' })) };
    const listener = new (BookingWaitlistListener as any)({} as any, notifications, crm);
    return { listener, notifications, crm, BookingWaitlistListener };
  }

  it('an offer notifies the business staff with the deadline, and no link to accept', async () => {
    const { listener, notifications } = await build();

    await listener.onSlotOffered(offeredPayload());

    expect(notifications.create).toHaveBeenCalledTimes(1);
    const note = notifications.create.mock.calls[0][0];
    expect(note.businessId).toBe('biz_1');
    expect(note.type).toBe('booking.waitlist_offered');
    expect(note.data).toMatchObject({
      waitlistEntryId: 'entry_1',
      bookingId: 'booking_1',
      contactId: 'contact_1',
      offerExpiresAt: deadline.toISOString(),
      actorType: 'SYSTEM',
    });
    // The deadline is written out for staff (12:00 in Port of Spain is 16:00 UTC).
    expect(note.body).toContain('12:00');
    expect(note.body).toContain('Jane Doe');
    // D-86: no public accept link, no token, no URL anywhere in the notification.
    const text = JSON.stringify(note);
    expect(text).not.toMatch(/https?:|:\/\/|token|\/accept/i);
  });

  it('the customer is not emailed: the listener holds no email sender (D-86, F1-D4)', async () => {
    const { BookingWaitlistListener } = await build();
    const { TransactionalEmailService } = await import('../notifications/transactional-email.service');
    const { SystemEmailService } = await import('../notifications/system-email.service');
    const injected = ((Reflect as any).getMetadata('self:paramtypes', BookingWaitlistListener) ?? []).map((p: any) => p.param);
    expect(injected).not.toContain(TransactionalEmailService);
    expect(injected).not.toContain(SystemEmailService);
  });

  it('the timeline event is a canonical ContactEvent type, named with its actor (F1-D5)', async () => {
    const { isCanonicalContactEventType } = await import('@keyflow/shared');
    const { listener, crm } = await build();

    await listener.onSlotOffered(offeredPayload({ actorType: 'USER', actorId: 'user_1' }));

    expect(crm.logContactEvent).toHaveBeenCalledTimes(1);
    const event = (crm.logContactEvent.mock.calls as any[])[0][0];
    expect(event).toMatchObject({
      businessId: 'biz_1',
      contactId: 'contact_1',
      type: 'booking.waitlist_offered',
      actorType: 'USER',
      actorId: 'user_1',
      source: 'bookings',
    });
    expect(event.data).toMatchObject({ waitlistEntryId: 'entry_1', bookingId: 'booking_1', offerExpiresAt: deadline.toISOString() });
    expect(isCanonicalContactEventType('booking.waitlist_offered')).toBe(true);
  });

  it('a failing timeline write does not stop the staff notification', async () => {
    const { listener, notifications, crm } = await build();
    crm.logContactEvent.mockRejectedValueOnce(new Error('timeline down'));

    await listener.onSlotOffered(offeredPayload());

    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('an expired hold tells staff the slot was moved on or freed', async () => {
    const { listener, notifications } = await build();

    await listener.onOfferExpired({
      businessId: 'biz_1',
      actorType: 'SYSTEM',
      entry: { id: 'entry_1', contactId: 'contact_1', serviceId: 'service_1' },
      bookingId: 'booking_1',
      released: true,
      cascadedToEntryId: 'entry_2',
      startTime: new Date('2031-03-05T14:00:00.000Z'),
      endTime: new Date('2031-03-05T15:00:00.000Z'),
      contactName: 'Jane Doe',
      serviceName: 'Consultation',
      timeZone: 'UTC',
    });

    expect(notifications.create).toHaveBeenCalledTimes(1);
    const note = notifications.create.mock.calls[0][0];
    expect(note).toMatchObject({ businessId: 'biz_1', type: 'booking.waitlist_offer_expired' });
    expect(note.data).toMatchObject({ waitlistEntryId: 'entry_1', bookingId: 'booking_1', cascadedToEntryId: 'entry_2', actorType: 'SYSTEM' });
    expect(JSON.stringify(note)).not.toMatch(/https?:|:\/\/|token|\/accept/i);
  });
});

// -----------------------------------------------------------------------------
// PR196-WAITLIST-EXPIRY (F1-D3): the expiry runs on the bookings scheduler only
// when schedulersDisabled() is false.
// -----------------------------------------------------------------------------
describe('BookingsService schedules waitlist expiry behind the scheduler kill switch (F1-D3)', () => {
  const FIVE_MINUTES = 5 * 60 * 1000;
  let services: any[] = [];

  afterEach(() => {
    for (const s of services) s.onModuleDestroy();
    services = [];
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function build() {
    const { BookingsService } = await import('./bookings.service');
    const waitlist = { expireStaleOffers: vi.fn(async () => ({ expired: 0, cascaded: 0, failed: 0 })) };
    const prisma = { client: { business: { findMany: vi.fn(async () => []) } } };
    const svc = new (BookingsService as any)(
      prisma,
      { emit: vi.fn() },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      waitlist,
    );
    services.push(svc);
    return { svc, waitlist };
  }

  it('opted in under NODE_ENV=test, every 5-minute tick runs expireStaleOffers', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DISABLE_SCHEDULERS', '');
    vi.stubEnv('KF_DISABLE_SCHEDULERS', '');
    vi.stubEnv('ENABLE_SCHEDULERS_IN_TEST', '1');
    const { svc, waitlist } = await build();

    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(waitlist.expireStaleOffers).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(waitlist.expireStaleOffers).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['NODE_ENV=test without the opt-in', { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '' }],
    ['DISABLE_SCHEDULERS=1', { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1', DISABLE_SCHEDULERS: '1' }],
    ['KF_DISABLE_SCHEDULERS=1', { NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' }],
  ])('%s: the expiry never runs', async (_label, env) => {
    vi.useFakeTimers();
    vi.stubEnv('DISABLE_SCHEDULERS', '');
    vi.stubEnv('KF_DISABLE_SCHEDULERS', '');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { svc, waitlist } = await build();

    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(3 * FIVE_MINUTES);
    expect(waitlist.expireStaleOffers).not.toHaveBeenCalled();
  });

  it('an expiry pass that throws is logged, and the next tick still runs', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DISABLE_SCHEDULERS', '');
    vi.stubEnv('KF_DISABLE_SCHEDULERS', '');
    vi.stubEnv('ENABLE_SCHEDULERS_IN_TEST', '1');
    const { svc, waitlist } = await build();
    waitlist.expireStaleOffers.mockRejectedValueOnce(new Error('db down'));

    svc.onModuleInit();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(waitlist.expireStaleOffers).toHaveBeenCalledTimes(2);
  });
});
