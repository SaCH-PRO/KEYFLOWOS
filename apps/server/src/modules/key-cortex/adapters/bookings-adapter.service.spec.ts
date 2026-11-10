import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingsAdapterService, KEY_AVAILABILITY_MAX_DAYS } from './bookings-adapter.service';
import { BookingsService } from '../../bookings/bookings.service';
import { CatalogService } from '../../catalog/catalog.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'bookings',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('BookingsAdapterService', () => {
  let service: BookingsAdapterService;
  let bookings: BookingsService;
  let catalog: CatalogService;
  let prisma: { client: any };

  beforeEach(() => {
    bookings = {
      createBooking: vi.fn(),
      updateBookingStatus: vi.fn(),
      rescheduleBooking: vi.fn(),
      confirmBooking: vi.fn(),
      getAvailableSlots: vi.fn(),
    } as unknown as BookingsService;

    catalog = {
      listServices: vi.fn(),
      createService: vi.fn(),
      updateService: vi.fn(),
    } as unknown as CatalogService;

    prisma = {
      client: {
        service: { findFirst: vi.fn() },
        staffMember: { findMany: vi.fn() },
        business: { findUnique: vi.fn() },
        booking: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        calendarEvent: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        availability: { findMany: vi.fn(), create: vi.fn() },
      },
    };

    service = new BookingsAdapterService(bookings, prisma as unknown as PrismaService, catalog);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('create_booking delegates to BookingsService.createBooking', async () => {
    (prisma.client.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ duration: 60 });
    (bookings.createBooking as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'b1' });
    const result = await service.execute(mkCmd('create_booking', { contactId: 'c1', serviceId: 's1', startTime: '2026-07-01T14:00:00.000Z' }));
    expect(result.success).toBe(true);
    expect(bookings.createBooking).toHaveBeenCalled();
  });

  it('cancel_booking delegates to updateBookingStatus CANCELLED', async () => {
    (bookings.updateBookingStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'b1', status: 'CANCELLED' });
    const result = await service.execute(mkCmd('cancel_booking', { bookingId: 'b1' }));
    expect(result.success).toBe(true);
    expect(bookings.updateBookingStatus).toHaveBeenCalledWith('biz_123', 'b1', 'CANCELLED');
  });

  it('add_service delegates to CatalogService.createService', async () => {
    (catalog.createService as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    const result = await service.execute(mkCmd('add_service', { name: 'Massage', duration: 60, price: 100 }));
    expect(result.success).toBe(true);
    expect(catalog.createService).toHaveBeenCalledWith(expect.objectContaining({ name: 'Massage', duration: 60, price: 100 }));
  });

  it('update_service delegates to CatalogService.updateService', async () => {
    (catalog.updateService as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 's1' });
    const result = await service.execute(mkCmd('update_service', { serviceId: 's1', price: 120 }));
    expect(result.success).toBe(true);
    expect(catalog.updateService).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 's1', price: 120 }));
  });

  it('set_availability creates availability row', async () => {
    (prisma.client.availability.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'a1' });
    const result = await service.execute(mkCmd('set_availability', { staffId: 'staff1', dayOfWeek: 'mon', startTime: '09:00', endTime: '17:00' }));
    expect(result.success).toBe(true);
    expect(prisma.client.availability.create).toHaveBeenCalled();
  });

  it('block_time creates a calendar event block', async () => {
    (prisma.client.calendarEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'block1' });
    const result = await service.execute(mkCmd('block_time', { staffId: 'staff1', startTime: '2026-07-01T12:00:00.000Z', endTime: '2026-07-01T13:00:00.000Z', reason: 'Lunch' }));
    expect(result.success).toBe(true);
    expect(prisma.client.calendarEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'BLOCK', module: 'BOOKINGS', staffId: 'staff1' }),
    }));
  });

  // ── Queries (Phase 1.2) ───────────────────────────────────────────────────

  it('get_upcoming_bookings delegates to helper', async () => {
    (prisma.client.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'b1' }]);
    const result = await service.execute(mkCmd('get_upcoming_bookings', { from: '2026-07-01', to: '2026-07-07', contactId: 'c1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'b1' }]);
    expect(prisma.client.booking.findMany).toHaveBeenCalled();
  });

  it('get_services delegates to CatalogService.listServices', async () => {
    (catalog.listServices as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 's1' }]);
    const result = await service.execute(mkCmd('get_services', { activeOnly: true }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 's1' }]);
  });

  it('get_staff_schedule returns availability, bookings, and blocks', async () => {
    (prisma.client.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'b1' }]);
    (prisma.client.calendarEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'block1' }]);
    (prisma.client.availability.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'a1' }]);
    const result = await service.execute(mkCmd('get_staff_schedule', { staffId: 'staff1', date: '2026-07-01' }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ bookings: [{ id: 'b1' }], blocks: [{ id: 'block1' }], availability: [{ id: 'a1' }] });
  });

  it('get_availability returns open slots', async () => {
    (prisma.client.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ duration: 60 });
    (prisma.client.staffMember.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'staff1',
      name: 'Dr. Smith',
      availabilities: [{ dayOfWeek: 2 }],
    }]);
    (prisma.client.business.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessHours: null,
      timezone: 'America/Port_of_Spain',
    });
    // W9-KEY-AVAILABILITY-TZ (CR-V16-1): the slots are BookingsService.getAvailableSlots'
    // answer (the public picker's, on the business's clock); booking-concurrency.
    // integration.test.ts proves that answer against a real database. The day is a
    // Tuesday the staff member works, still to come (SEC-KAT-1: past days are not asked about).
    (bookings.getAvailableSlots as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: '2030-07-09',
      slots: ['2030-07-09T13:00:00.000Z'],
    });
    (prisma.client.calendarEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.execute(mkCmd('get_availability', {
      serviceId: 's1',
      from: '2030-07-09T00:00:00.000Z',
      to: '2030-07-09T23:59:59.999Z',
    }));

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as any[]).length).toBeGreaterThan(0);
    expect((result.data as any[])[0]).toMatchObject({ staffId: 'staff1', staffName: 'Dr. Smith' });
    expect(result.data).toEqual([
      { startTime: '2030-07-09T13:00:00.000Z', endTime: '2030-07-09T14:00:00.000Z', staffId: 'staff1', staffName: 'Dr. Smith' },
    ]);
    // One call for the one staff member and the one calendar day asked for.
    expect(bookings.getAvailableSlots).toHaveBeenCalledTimes(1);
    const [call] = (bookings.getAvailableSlots as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call).toMatchObject({ businessId: 'biz_123', serviceId: 's1', staffId: 'staff1' });
    expect([call.date.getFullYear(), call.date.getMonth(), call.date.getDate()]).toEqual([2030, 6, 9]);
  });

  it('get_availability refuses a range over KEY_AVAILABILITY_MAX_DAYS days before reading staff or asking about a day (SEC-KAT-1)', async () => {
    (prisma.client.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ duration: 60 });
    await expect(service.execute(mkCmd('get_availability', {
      serviceId: 's1',
      from: '2030-01-01',
      to: '2030-03-04',
    }))).rejects.toThrow(`at most ${KEY_AVAILABILITY_MAX_DAYS} days`);
    expect(KEY_AVAILABILITY_MAX_DAYS).toBe(62);
    expect(prisma.client.staffMember.findMany).not.toHaveBeenCalled();
    expect(bookings.getAvailableSlots).not.toHaveBeenCalled();
  });

  it('get_availability leaves out a business-hours start whose buffer runs past closing, as KEY create_booking refuses it (CR-W9KAT-1)', async () => {
    (prisma.client.service.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ duration: 60, bufferMins: 15 });
    (prisma.client.staffMember.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'staff1', name: 'Own Hours', availabilities: [{ dayOfWeek: 1 }] },
      { id: 'staff2', name: 'Business Hours', availabilities: [] },
    ]);
    // Port_of_Spain (UTC-4) opens Mondays 09:00-12:00: 13:00Z-16:00Z.
    (prisma.client.business.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessHours: { mon: { open: '09:00', close: '12:00', closed: false } },
      timezone: 'America/Port_of_Spain',
    });
    (bookings.getAvailableSlots as ReturnType<typeof vi.fn>).mockImplementation(async ({ staffId }: { staffId: string }) => ({
      date: '2030-01-28',
      slots: staffId === 'staff1'
        ? ['2030-01-28T14:00:00.000Z', '2030-01-28T15:00:00.000Z']
        : ['2030-01-28T14:30:00.000Z', '2030-01-28T15:00:00.000Z'],
    }));
    (prisma.client.calendarEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.execute(mkCmd('get_availability', { serviceId: 's1', from: '2030-01-28', to: '2030-01-28' }));

    expect(result.success).toBe(true);
    // staff2's 15:00Z (11:00 local) ends its buffer at 12:15: left out; staff1's own hours are read without it.
    expect((result.data as any[]).map((s) => `${s.staffId} ${s.startTime}`)).toEqual([
      'staff1 2030-01-28T14:00:00.000Z',
      'staff1 2030-01-28T15:00:00.000Z',
      'staff2 2030-01-28T14:30:00.000Z',
    ]);
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown bookings action');
  });
});
