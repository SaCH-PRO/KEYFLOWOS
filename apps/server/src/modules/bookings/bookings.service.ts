import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventEmitter2) {}

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
    });
    this.events.emit('booking.created', { bookingId: booking.id, businessId: booking.businessId });
    return booking;
  }
}
