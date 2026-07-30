import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BookingNoShowWatcherService } from './booking-no-show-watcher.service';

function createMockPrisma(overrides: any = {}) {
  return {
    client: {
      booking: {
        findMany: vi.fn().mockResolvedValue(overrides.bookings ?? []),
      },
      business: {
        findMany: vi.fn().mockResolvedValue(overrides.businesses ?? []),
      },
    },
  };
}

function createEventBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

function createBooking(overrides: any = {}) {
  return {
    id: 'bk_1',
    startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    endTime: new Date(Date.now() - 60 * 60 * 1000),
    status: 'CONFIRMED',
    contact: { id: 'c1', firstName: 'Bob', lastName: 'Smith', email: 'bob@example.com', phone: '555-0100' },
    service: { id: 'svc_1', name: 'Consultation', duration: 60, price: 100 },
    staff: { id: 'stf_1', name: 'Dr. Smith' },
    notes: null,
    ...overrides,
  };
}

describe('BookingNoShowWatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits proactive.booking_no_show events for past confirmed bookings', async () => {
    const bookings = [createBooking(), createBooking({ id: 'bk_2' })];
    const mockPrisma = createMockPrisma({ bookings });
    const eventBus = createEventBus();
    const service = new BookingNoShowWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scan('biz_1');

    expect(count).toBe(2);
    expect(mockPrisma.client.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz_1',
          status: 'CONFIRMED',
          startTime: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'proactive_watcher',
        type: 'proactive.booking_no_show',
        businessId: 'biz_1',
        payload: expect.objectContaining({ bookingId: 'bk_1' }),
      }),
    );
  });

  it('returns 0 when no past confirmed bookings exist', async () => {
    const mockPrisma = createMockPrisma({ bookings: [] });
    const eventBus = createEventBus();
    const service = new BookingNoShowWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scan('biz_1');

    expect(count).toBe(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('scanAll iterates active businesses', async () => {
    const businesses = [{ id: 'biz_1' }];
    const bookings = [createBooking()];
    const mockPrisma = createMockPrisma({ businesses, bookings });
    const eventBus = createEventBus();
    const service = new BookingNoShowWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scanAll();

    expect(count).toBe(1);
  });

  it('scanAll isolates failures per business', async () => {
    const businesses = [{ id: 'biz_ok' }, { id: 'biz_fail' }];
    const mockPrisma = createMockPrisma({ businesses });
    mockPrisma.client.booking.findMany
      .mockResolvedValueOnce([createBooking()])
      .mockRejectedValueOnce(new Error('DB error'));
    const eventBus = createEventBus();
    const service = new BookingNoShowWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scanAll();

    expect(count).toBe(1);
  });
});
