import { describe, expect, it, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

interface PrismaMockOptions {
  availabilities?: Array<{ staffId: string; dayOfWeek: number; startTime: string; endTime: string }>;
  businessHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
  storeEnabled?: boolean;
  services?: Array<any>;
}

class PrismaMock {
  bookings: any[] = [];
  services!: any[];
  availabilities!: PrismaMockOptions['availabilities'];
  businessHours!: PrismaMockOptions['businessHours'];
  storeEnabled!: boolean;
  client: any;

  constructor(opts: PrismaMockOptions = {}) {
    const self = this;
    self.services = opts.services ?? [
      { id: 'service_1', businessId: 'biz_1', duration: 60, price: 100, name: 'Consult', deletedAt: null, leadTimeMins: 0, bufferMins: 0 },
    ];
    self.availabilities = opts.availabilities ?? [];
    self.businessHours = opts.businessHours ?? null;
    self.storeEnabled = opts.storeEnabled ?? true;

    self.client = {
      booking: {
        findMany: vi.fn(({ where }: any) =>
          self.bookings.filter((b) => b.businessId === where.businessId && b.deletedAt === null),
        ),
        findFirst: vi.fn(() => null),
        create: vi.fn(({ data }: any) => {
          const item = {
            ...data,
            id: `booking_${self.bookings.length + 1}`,
            deletedAt: null,
            createdAt: new Date(),
          };
          self.bookings.push(item);
          return item;
        }),
      },
      availability: {
        findMany: vi.fn(({ where }: any) =>
          self.availabilities!.filter((a) => a.staffId === where.staffId),
        ),
      },
      service: {
        findFirstOrThrow: vi.fn(({ where }: any) => {
          const match = self.services.find(
            (s) => s.id === where.id && s.businessId === where.businessId && s.deletedAt === null,
          );
          if (!match) throw new Error('not found');
          return match;
        }),
        // createBooking now reads the service to find its buffer before
        // checking the slot is free — the in-app path used to have no overlap
        // check of any kind.
        findFirst: vi.fn(({ where }: any) => {
          return (
            self.services.find(
              (s) => s.id === where.id && s.businessId === where.businessId && s.deletedAt === null,
            ) ?? null
          );
        }),
      },
      contact: {
        findFirst: vi.fn(() => null),
        create: vi.fn(),
      },
      business: {
        findFirstOrThrow: vi.fn(() => ({
          id: 'biz_1',
          deletedAt: null,
          storeEnabled: self.storeEnabled,
          businessHours: self.businessHours,
        })),
      },
    };
  }
}

function makeService(prisma: PrismaService, opts: { findOrCreateContact?: any; createInvoiceForService?: any } = {}) {
  const events = { emit: vi.fn(), listenerCount: vi.fn(() => 0) } as unknown as EventEmitter2;
  const crm = {
    findOrCreateContact: opts.findOrCreateContact ?? vi.fn().mockResolvedValue({ id: 'contact_public' }),
    logContactEvent: vi.fn(),
  };
  const commerce = {
    createInvoiceForService: opts.createInvoiceForService ?? vi.fn().mockResolvedValue(null),
    computeServiceDeposit: vi.fn().mockReturnValue(0),
  };
  return new BookingsService(
    prisma,
    events,
    crm as any,
    commerce as any,
    { record: vi.fn().mockResolvedValue(undefined), summarizeBySource: vi.fn() } as any,
    { checkAndEnforceLimit: vi.fn() } as any,
    { sendTransactionalEmail: vi.fn() } as any,
    { track: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn() } as any,
    { recordEvent: vi.fn().mockResolvedValue(undefined) } as any,
  );
}

// Use a deterministic local-time Monday at 10:00 (Jan 7, 2030 is a Monday in any timezone)
const monday10am = () => new Date(2030, 0, 7, 10, 0, 0);
const tuesday10am = () => new Date(2030, 0, 8, 10, 0, 0);
const monday7am = () => new Date(2030, 0, 7, 7, 0, 0);

describe('BookingsService', () => {
  it('emits booking.created on createBooking', async () => {
    const emit = vi.fn();
    const events = { emit } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const crm = { findOrCreateContact: vi.fn(), logContactEvent: vi.fn() };
    const service = new BookingsService(
      prisma,
      events,
      crm as any,
      { createInvoiceForService: vi.fn() } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { checkAndEnforceLimit: vi.fn() } as any,
      { sendTransactionalEmail: vi.fn() } as any,
      { track: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn() } as any,
      { recordEvent: vi.fn().mockResolvedValue(undefined) } as any,
    );

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
    const crm = { findOrCreateContact: vi.fn(), logContactEvent: vi.fn() };
    const service = new BookingsService(
      prisma,
      events,
      crm as any,
      { createInvoiceForService: vi.fn() } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { checkAndEnforceLimit: vi.fn() } as any,
      { sendTransactionalEmail: vi.fn() } as any,
      { track: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn() } as any,
      { recordEvent: vi.fn().mockResolvedValue(undefined) } as any,
    );

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

  it('creates booking and invoice in publicCreateBooking', async () => {
    const emit = vi.fn();
    const events = { emit, listenerCount: vi.fn(() => 0) } as unknown as EventEmitter2;
    const prisma = new PrismaMock() as unknown as PrismaService;
    const createInvoiceForService = vi.fn().mockResolvedValue({ id: 'inv_1' });
    const findOrCreateContact = vi.fn().mockResolvedValue({ id: 'contact_public' });
    const logContactEvent = vi.fn();
    const service = new BookingsService(
      prisma,
      events,
      { findOrCreateContact, logContactEvent } as any,
      { createInvoiceForService, computeServiceDeposit: vi.fn().mockReturnValue(25) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { checkAndEnforceLimit: vi.fn() } as any,
      { sendTransactionalEmail: vi.fn() } as any,
      { track: vi.fn(), backstitchVisitor: vi.fn(), logStorefrontEvent: vi.fn() } as any,
      { recordEvent: vi.fn().mockResolvedValue(undefined) } as any,
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
      source: 'storefront',
      sourceDetail: 'public-booking',
    });
    expect(result.success).toBe(true);
    expect(result.depositInvoiceId).toBe('inv_1');
    expect(emit).toHaveBeenCalledWith(
      'booking.created',
      expect.objectContaining({
        booking: expect.objectContaining({ id: expect.any(String) }),
        businessId: 'biz_1',
      }),
    );
  });

  describe('staff availability checks', () => {
    it('rejects booking when the staff member has no availability for the selected day', async () => {
      const prisma = new PrismaMock({
        availabilities: [
          { staffId: 'staff_1', dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
        ],
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      await expect(
        service.publicCreateBooking({
          businessId: 'biz_1',
          serviceId: 'service_1',
          staffId: 'staff_1',
          startTime: tuesday10am(),
          contact: { email: 'a@example.com' },
        }),
      ).rejects.toThrowError('not available on this day');
    });

    it('rejects booking when the time falls outside the staff member\'s available hours', async () => {
      const prisma = new PrismaMock({
        availabilities: [
          { staffId: 'staff_1', dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
        ],
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      await expect(
        service.publicCreateBooking({
          businessId: 'biz_1',
          serviceId: 'service_1',
          staffId: 'staff_1',
          startTime: monday7am(),
          contact: { email: 'a@example.com' },
        }),
      ).rejects.toThrowError('outside this staff member');
    });

    it('accepts booking when the staff schedule covers the requested slot', async () => {
      const prisma = new PrismaMock({
        availabilities: [
          { staffId: 'staff_1', dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
        ],
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      const result = await service.publicCreateBooking({
        businessId: 'biz_1',
        serviceId: 'service_1',
        staffId: 'staff_1',
        startTime: monday10am(),
        contact: { email: 'a@example.com' },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('business hours checks', () => {
    it('rejects booking when the business is closed on the selected day', async () => {
      const prisma = new PrismaMock({
        businessHours: {
          mon: { open: '09:00', close: '17:00', closed: false },
          tue: { open: '00:00', close: '00:00', closed: true },
          wed: { open: '09:00', close: '17:00', closed: false },
          thu: { open: '09:00', close: '17:00', closed: false },
          fri: { open: '09:00', close: '17:00', closed: false },
          sat: { open: '00:00', close: '00:00', closed: true },
          sun: { open: '00:00', close: '00:00', closed: true },
        },
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      await expect(
        service.publicCreateBooking({
          businessId: 'biz_1',
          serviceId: 'service_1',
          staffId: null,
          startTime: tuesday10am(),
          contact: { email: 'a@example.com' },
        }),
      ).rejects.toThrowError('closed on the selected day');
    });

    it('rejects booking when the time is outside business hours', async () => {
      const prisma = new PrismaMock({
        businessHours: {
          mon: { open: '09:00', close: '17:00', closed: false },
          tue: { open: '09:00', close: '17:00', closed: false },
          wed: { open: '09:00', close: '17:00', closed: false },
          thu: { open: '09:00', close: '17:00', closed: false },
          fri: { open: '09:00', close: '17:00', closed: false },
          sat: { open: '00:00', close: '00:00', closed: true },
          sun: { open: '00:00', close: '00:00', closed: true },
        },
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      await expect(
        service.publicCreateBooking({
          businessId: 'biz_1',
          serviceId: 'service_1',
          staffId: null,
          startTime: monday7am(),
          contact: { email: 'a@example.com' },
        }),
      ).rejects.toThrowError('outside business hours');
    });

    it('accepts booking that falls within business hours', async () => {
      const prisma = new PrismaMock({
        businessHours: {
          mon: { open: '09:00', close: '17:00', closed: false },
          tue: { open: '09:00', close: '17:00', closed: false },
          wed: { open: '09:00', close: '17:00', closed: false },
          thu: { open: '09:00', close: '17:00', closed: false },
          fri: { open: '09:00', close: '17:00', closed: false },
          sat: { open: '00:00', close: '00:00', closed: true },
          sun: { open: '00:00', close: '00:00', closed: true },
        },
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      const result = await service.publicCreateBooking({
        businessId: 'biz_1',
        serviceId: 'service_1',
        staffId: null,
        startTime: monday10am(),
        contact: { email: 'a@example.com' },
      });

      expect(result.success).toBe(true);
    });

    it('skips business-hours check when the staff member has explicit availability', async () => {
      const prisma = new PrismaMock({
        availabilities: [
          { staffId: 'staff_1', dayOfWeek: 1, startTime: '06:00', endTime: '22:00' },
        ],
        businessHours: {
          mon: { open: '09:00', close: '17:00', closed: false },
          tue: { open: '09:00', close: '17:00', closed: false },
          wed: { open: '09:00', close: '17:00', closed: false },
          thu: { open: '09:00', close: '17:00', closed: false },
          fri: { open: '09:00', close: '17:00', closed: false },
          sat: { open: '00:00', close: '00:00', closed: true },
          sun: { open: '00:00', close: '00:00', closed: true },
        },
      }) as unknown as PrismaService;
      const service = makeService(prisma);

      const result = await service.publicCreateBooking({
        businessId: 'biz_1',
        serviceId: 'service_1',
        staffId: 'staff_1',
        startTime: monday7am(),
        contact: { email: 'a@example.com' },
      });

      expect(result.success).toBe(true);
    });
  });
});
