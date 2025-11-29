import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingCreatedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
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
      contact: booking.contact,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.created',
    };
    this.events.emit('booking.created', payload);
    return booking;
  }

  async confirmBooking(bookingId: string) {
    return this.prisma.client.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED' },
    });
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

    const contact = await this.crm.findOrCreateContact(input.businessId, input.contact);

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
      contact: booking.contact,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.created',
    };
    this.events.emit('booking.created', payload);

    return { success: true, bookingId: booking.id, invoiceId: invoice?.id };
  }
}
