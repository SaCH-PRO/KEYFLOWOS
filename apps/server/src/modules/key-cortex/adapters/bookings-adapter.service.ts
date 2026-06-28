import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BookingsService } from '../../bookings/bookings.service';
import { CatalogService } from '../../catalog/catalog.service';

const DAY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Typed adapter that exposes the bookings methods expected by
 * KeyCortexConnectorService.  Delegates to BookingsService where a real
 * implementation exists; otherwise returns a typed placeholder or
 * throws NotImplementedException.
 */
@Injectable()
export class BookingsAdapterService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async createBooking(input: {
    businessId: string;
    contactId: string;
    serviceId: string;
    startTime: string;
    endTime?: string;
    staffId?: string;
    notes?: string;
  }) {
    const service = await this.prisma.client.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
    });
    const start = new Date(input.startTime);
    const end = input.endTime
      ? new Date(input.endTime)
      : new Date(start.getTime() + (service?.duration ?? 60) * 60000);

    return this.bookings.createBooking({
      businessId: input.businessId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      staffId: input.staffId ?? '',
      startTime: start,
      endTime: end,
      notes: input.notes,
    });
  }

  async cancelBooking(input: {
    businessId: string;
    bookingId: string;
    reason?: string;
    notifyClient?: boolean;
  }) {
    return this.bookings.updateBookingStatus(
      input.businessId,
      input.bookingId,
      'CANCELLED',
    );
  }

  async rescheduleBooking(input: {
    businessId: string;
    bookingId: string;
    newStartTime: string;
    newEndTime?: string;
    notifyClient?: boolean;
  }) {
    return this.bookings.rescheduleBooking(
      input.businessId,
      input.bookingId,
      new Date(input.newStartTime),
    );
  }

  async confirmBooking(input: {
    businessId: string;
    bookingId: string;
    sendConfirmation?: boolean;
  }) {
    return this.bookings.confirmBooking(input.bookingId);
  }

  async addService(input: {
    businessId: string;
    name: string;
    duration: number;
    price?: number;
    description?: string;
    buffer?: number;
  }) {
    return this.catalog.createService({
      businessId: input.businessId,
      name: input.name,
      duration: input.duration,
      price: input.price ?? 0,
      description: input.description,
      bufferMins: input.buffer ?? 0,
    });
  }

  async updateService(input: {
    businessId: string;
    serviceId: string;
    name?: string;
    duration?: number;
    price?: number;
    active?: boolean;
  }) {
    return this.catalog.updateService({
      businessId: input.businessId,
      serviceId: input.serviceId,
      name: input.name,
      duration: input.duration,
      price: input.price,
    });
  }

  async setAvailability(input: {
    businessId: string;
    staffId: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  }) {
    const dayIndex = DAY_TO_INDEX[input.dayOfWeek.toLowerCase()];
    if (dayIndex === undefined) {
      throw new Error(`Invalid dayOfWeek: ${input.dayOfWeek}`);
    }
    return this.prisma.client.availability.create({
      data: {
        staffId: input.staffId,
        dayOfWeek: dayIndex,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    });
  }

  async blockTime(_input: {
    businessId: string;
    staffId: string;
    startTime: string;
    endTime: string;
    reason?: string;
  }) {
    throw new NotImplementedException('blockTime is not implemented');
  }

  async getUpcomingBookings(input: {
    businessId: string;
    from?: string;
    to?: string;
    contactId?: string;
    staffId?: string;
    limit?: number;
  }) {
    const from = input.from ? new Date(input.from) : new Date();
    const to = input.to ? new Date(input.to) : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.client.booking.findMany({
      where: {
        businessId: input.businessId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        startTime: { gte: from, lte: to },
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.staffId ? { staffId: input.staffId } : {}),
      },
      orderBy: { startTime: 'asc' },
      take: input.limit ?? 50,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
    });
  }
}
