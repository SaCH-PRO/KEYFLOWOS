import { describe, it, expect, vi } from 'vitest';
import { BookingsService } from './bookings.service';
import { BookingWaitlistListener } from './booking-waitlist.listener';

describe('Bookings completion invoicing & waitlist slot offer notifications', () => {
  it('BookingWaitlistListener.onSlotOffered logs a CRM timeline event and sends an email notification', async () => {
    const waitlistMock: any = {};
    const sendEmail = vi.fn().mockResolvedValue({ status: 'SENT' });
    const logContactEvent = vi.fn().mockResolvedValue(undefined);
    const listener = new BookingWaitlistListener(
      waitlistMock,
      { send: sendEmail } as any,
      { logContactEvent } as any,
    );

    await listener.onSlotOffered({
      businessId: 'biz_1',
      actorType: 'SYSTEM',
      entry: {
        id: 'entry_1',
        contactId: 'contact_1',
        serviceId: 'service_1',
        service: { id: 'service_1', name: 'Deep Tissue Massage' },
        contact: { id: 'contact_1', firstName: 'Maya', lastName: 'Lin' },
      },
      booking: {
        id: 'booking_hold_1',
        startTime: new Date('2026-08-20T14:00:00Z'),
        endTime: new Date('2026-08-20T15:00:00Z'),
        contact: {
          id: 'contact_1',
          firstName: 'Maya',
          lastName: 'Lin',
          email: 'maya@example.com',
        },
        service: { id: 'service_1', name: 'Deep Tissue Massage' },
        staff: { id: 'staff_1', name: 'Alex' },
      },
    });

    expect(logContactEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        contactId: 'contact_1',
        type: 'booking.waitlist_offered',
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        type: 'booking_created',
        recipientEmail: 'maya@example.com',
        recipientName: 'Maya Lin',
        contactId: 'contact_1',
        dedupeKey: 'waitlist-offer-entry_1-booking_hold_1',
      }),
    );
  });

  it('createInvoiceFromBooking deducts an existing deposit invoice and bills only the remaining balance', async () => {
    const createInvoiceForService = vi.fn().mockResolvedValue({
      id: 'inv_balance_1',
      invoiceNumber: 'INV-BAL-001',
      total: 350,
      currency: 'USD',
    });
    const updateBooking = vi.fn().mockResolvedValue({ id: 'bk_1', invoiceId: 'inv_balance_1' });
    const emit = vi.fn();

    const prismaMock: any = {
      client: {
        booking: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'bk_1',
            businessId: 'biz_1',
            contactId: 'contact_1',
            serviceId: 'service_1',
            invoiceId: null,
            depositInvoiceId: 'inv_dep_1',
            service: {
              id: 'service_1',
              name: 'Strategy Workshop',
              price: 500,
              depositRequired: true,
              depositType: 'PERCENT',
              depositValue: 30,
            },
            contact: { id: 'contact_1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
          }),
          update: updateBooking,
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'inv_dep_1',
            invoiceNumber: 'INV-DEP-001',
            total: 150,
            status: 'PAID',
          }),
        },
      },
    };

    const service = new BookingsService(
      prismaMock,
      { emit } as any,
      {} as any,
      {
        createInvoiceForService,
        computeServiceDeposit: vi.fn().mockReturnValue(150),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const res = await service.createInvoiceFromBooking('biz_1', 'bk_1');

    expect(res).toEqual({
      invoiceId: 'inv_balance_1',
      invoiceNumber: 'INV-BAL-001',
      alreadyExisted: false,
    });
    expect(createInvoiceForService).toHaveBeenCalledWith(
      'biz_1',
      'contact_1',
      expect.objectContaining({ id: 'service_1', price: 500 }),
      { kind: 'BALANCE', amountOverride: 350 },
    );
    expect(updateBooking).toHaveBeenCalledWith({
      where: { id: 'bk_1' },
      data: { invoiceId: 'inv_balance_1' },
    });
  });

  it('createInvoiceFromBooking reuses depositInvoiceId when a 100% deposit already covers the service price', async () => {
    const createInvoiceForService = vi.fn();
    const updateBooking = vi.fn().mockResolvedValue({ id: 'bk_full_dep', invoiceId: 'inv_dep_full' });

    const prismaMock: any = {
      client: {
        booking: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'bk_full_dep',
            businessId: 'biz_1',
            contactId: 'contact_1',
            serviceId: 'service_1',
            invoiceId: null,
            depositInvoiceId: 'inv_dep_full',
            service: {
              id: 'service_1',
              name: 'Prepaid Session',
              price: 200,
              depositRequired: true,
              depositType: 'PERCENT',
              depositValue: 100,
            },
            contact: { id: 'contact_1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
          }),
          update: updateBooking,
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'inv_dep_full',
            invoiceNumber: 'INV-DEP-100',
            total: 200,
            status: 'PAID',
          }),
        },
      },
    };

    const service = new BookingsService(
      prismaMock,
      { emit: vi.fn() } as any,
      {} as any,
      { createInvoiceForService } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const res = await service.createInvoiceFromBooking('biz_1', 'bk_full_dep');

    expect(res).toEqual({
      invoiceId: 'inv_dep_full',
      invoiceNumber: 'INV-DEP-100',
      alreadyExisted: true,
    });
    expect(createInvoiceForService).not.toHaveBeenCalled();
    expect(updateBooking).toHaveBeenCalledWith({
      where: { id: 'bk_full_dep' },
      data: { invoiceId: 'inv_dep_full' },
    });
  });
});
