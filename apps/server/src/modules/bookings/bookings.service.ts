import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingConfirmedPayload, BookingCreatedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { AutomationService } from '../automation/automation.service';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
    private readonly automation: AutomationService,
  ) {}

  listBookings(businessId: string) {
    return this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { startTime: 'desc' },
    });
  }

  async createBooking(input: {
    businessId: string;
    contactId: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
    endTime: Date;
  }) {
    const booking = await this.prisma.client.booking.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        serviceId: input.serviceId,
        staffId: input.staffId,
        startTime: input.startTime,
        endTime: input.endTime,
      },
      include: { contact: true },
    });

    const payload: BookingCreatedPayload = {
      booking,
      contact: booking.contact ?? undefined,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.created',
    };
    this.events.emit('booking.created', payload);
    // Log contact event for CRM timeline
    if (booking.contactId) {
      await this.crm.logContactEvent({
        businessId: booking.businessId,
        contactId: booking.contactId,
        type: 'booking.created',
        data: {
          bookingId: booking.id,
          serviceId: booking.serviceId,
          startTime: booking.startTime,
          endTime: booking.endTime,
        },
        actorType: 'SYSTEM',
        source: 'bookings',
      });
    }
    return booking;
  }

  async confirmBooking(bookingId: string) {
    const booking = await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED' },
      include: { contact: true },
    });
    const payload: BookingConfirmedPayload = {
      booking,
      contact: booking.contact ?? undefined,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.confirmed',
    };
    this.events.emit('booking.confirmed', payload);
    if (booking.contactId) {
      await this.crm.logContactEvent({
        businessId: booking.businessId,
        contactId: booking.contactId,
        type: 'booking.confirmed',
        data: {
          bookingId: booking.id,
          startTime: booking.startTime,
          endTime: booking.endTime,
          staffId: booking.staffId,
        },
        actorType: 'SYSTEM',
        source: 'bookings',
      });
    }
    if (booking.contactId) {
      await this.automation.handle({
        type: 'booking.status_changed',
        businessId: booking.businessId,
        contactId: booking.contactId,
        bookingId: booking.id,
        status: 'CONFIRMED',
      });
    }
    return booking;
  }

  async publicCreateBooking(input: {
    businessId: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
    contact: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null };
  }) {
    const service = await this.prisma.client.service.findFirstOrThrow({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
    });

    const start = new Date(input.startTime);
    const end = new Date(start.getTime() + service.duration * 60000);

    const contact = await this.crm.findOrCreateContact(input.businessId, {
      ...input.contact,
      source: 'booking',
      sourceDetail: 'public-booking',
    });
    if (!contact) {
      throw new Error('Failed to create or find contact');
    }

    const invoice =
      service.price > 0 ? await this.commerce.createInvoiceForService(input.businessId, contact.id, service) : null;

    const booking = await this.prisma.client.booking.create({
      data: {
        businessId: input.businessId,
        contactId: contact.id,
        serviceId: service.id,
        staffId: input.staffId,
        startTime: start,
        endTime: end,
        invoiceId: invoice?.id,
      },
      include: { contact: true },
    });

    const payload: BookingCreatedPayload = {
      booking,
      contact: booking.contact ?? undefined,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.created',
    };
    this.events.emit('booking.created', payload);
    if (booking.contactId) {
      await this.crm.logContactEvent({
        businessId: booking.businessId,
        contactId: booking.contactId,
        type: 'booking.created',
        data: {
          bookingId: booking.id,
          serviceId: booking.serviceId,
          startTime: booking.startTime,
          endTime: booking.endTime,
          invoiceId: invoice?.id,
        },
        actorType: 'SYSTEM',
        source: 'bookings',
      });
    }

    return { success: true, bookingId: booking.id, invoiceId: invoice?.id };
  }
}
