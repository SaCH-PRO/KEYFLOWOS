import { BadRequestException, Injectable } from '@nestjs/common';
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
      include: { contact: true, service: true, staff: true },
    });
  }

  listServices(businessId: string) {
    return this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createService(input: {
    businessId: string;
    name: string;
    description?: string | null;
    duration: number;
    price: number;
    currency?: string | null;
  }) {
    return this.prisma.client.service.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        duration: input.duration,
        price: input.price,
        currency: input.currency ?? 'TTD',
      },
    });
  }

  updateService(input: {
    serviceId: string;
    name?: string;
    description?: string | null;
    duration?: number;
    price?: number;
    currency?: string | null;
  }) {
    return this.prisma.client.service.update({
      where: { id: input.serviceId },
      data: {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        duration: input.duration ?? undefined,
        price: input.price ?? undefined,
        currency: input.currency ?? undefined,
      },
    });
  }

  async deleteService(serviceId: string) {
    await this.prisma.client.service.delete({ where: { id: serviceId } });
    return { success: true, id: serviceId };
  }

  listStaff(businessId: string) {
    return this.prisma.client.staffMember.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createStaff(input: { businessId: string; name: string }) {
    return this.prisma.client.staffMember.create({
      data: {
        businessId: input.businessId,
        name: input.name,
      },
    });
  }

  updateStaff(input: { staffId: string; name?: string }) {
    return this.prisma.client.staffMember.update({
      where: { id: input.staffId },
      data: {
        name: input.name ?? undefined,
      },
    });
  }

  async deleteStaff(staffId: string) {
    await this.prisma.client.staffMember.delete({ where: { id: staffId } });
    return { success: true, id: staffId };
  }

  listAvailability(staffId: string) {
    return this.prisma.client.availability.findMany({
      where: { staffId, deletedAt: null },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  createAvailability(input: { staffId: string; dayOfWeek: number; startTime: string; endTime: string }) {
    return this.prisma.client.availability.create({
      data: {
        staffId: input.staffId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    });
  }

  async deleteAvailability(availabilityId: string) {
    await this.prisma.client.availability.delete({ where: { id: availabilityId } });
    return { success: true, id: availabilityId };
  }

  async createBooking(input: {
    businessId: string;
    contactId: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
    endTime: Date;
  }) {
    await this.assertSlotAvailable(input.businessId, input.staffId, input.startTime, input.endTime);
    const booking = await this.prisma.client.booking.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        serviceId: input.serviceId,
        staffId: input.staffId,
        startTime: input.startTime,
        endTime: input.endTime,
      },
      include: { contact: true, service: true, staff: true },
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
    if (booking.contactId) {
      await this.automation.handle({
        type: 'booking.created',
        businessId: booking.businessId,
        contactId: booking.contactId,
        bookingId: booking.id,
        status: booking.status,
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
      await this.automation.handle({
        type: 'booking.confirmed',
        businessId: booking.businessId,
        contactId: booking.contactId,
        bookingId: booking.id,
        status: 'CONFIRMED',
      });
    }
    return booking;
  }

  async updateBookingStatus(input: { bookingId: string; status: string }) {
    const booking = await this.prisma.client.booking.update({
      where: { id: input.bookingId },
      data: { status: input.status },
      include: { contact: true },
    });
    if (booking.contactId) {
      await this.crm.logContactEvent({
        businessId: booking.businessId,
        contactId: booking.contactId,
        type: `booking.${input.status.toLowerCase()}`,
        data: {
          bookingId: booking.id,
          startTime: booking.startTime,
          endTime: booking.endTime,
          staffId: booking.staffId,
        },
        actorType: 'SYSTEM',
        source: 'bookings',
      });
      await this.automation.handle({
        type: 'booking.status_changed',
        businessId: booking.businessId,
        contactId: booking.contactId,
        bookingId: booking.id,
        status: input.status,
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

    await this.assertSlotAvailable(input.businessId, input.staffId, start, end);
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
      include: { contact: true, service: true, staff: true },
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
    if (booking.contactId) {
      await this.automation.handle({
        type: 'booking.created',
        businessId: booking.businessId,
        contactId: booking.contactId,
        bookingId: booking.id,
        status: booking.status,
      });
    }

    return { success: true, bookingId: booking.id, invoiceId: invoice?.id };
  }

  private async assertSlotAvailable(businessId: string, staffId: string, startTime: Date, endTime: Date) {
    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }
    const dayOfWeek = startTime.getDay();
    const availabilities = await this.prisma.client.availability.findMany({
      where: { staffId, deletedAt: null },
    });
    if (availabilities.length > 0) {
      const matches = availabilities.some((availability) => {
        if (availability.dayOfWeek !== dayOfWeek) return false;
        const [startHour, startMin] = availability.startTime.split(':').map(Number);
        const [endHour, endMin] = availability.endTime.split(':').map(Number);
        const slotStart = new Date(startTime);
        slotStart.setHours(startHour, startMin, 0, 0);
        const slotEnd = new Date(startTime);
        slotEnd.setHours(endHour, endMin, 0, 0);
        return startTime >= slotStart && endTime <= slotEnd;
      });
      if (!matches) {
        throw new BadRequestException('Selected time is outside staff availability');
      }
    }

    const overlapping = await this.prisma.client.booking.findFirst({
      where: {
        businessId,
        staffId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        OR: [
          {
            startTime: { lt: endTime },
            endTime: { gt: startTime },
          },
        ],
      },
    });
    if (overlapping) {
      throw new BadRequestException('Selected time overlaps an existing booking');
    }
  }
}
