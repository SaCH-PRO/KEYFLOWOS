import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingCompletedPayload, BookingConfirmedPayload, BookingCreatedPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { AutomationService } from '../automation/automation.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(AutomationService) private readonly automation: AutomationService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
  ) {}

  listBookings(businessId: string) {
    return this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { startTime: 'desc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
    });
  }

  async updateBookingStatus(businessId: string, bookingId: string, status: string) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
    });
    if (!booking) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('Booking not found');
    }
    const allowed = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];
    if (!allowed.includes(status)) {
      const { BadRequestException } = await import('@nestjs/common');
      throw new BadRequestException('Invalid status. Must be one of: PENDING, CONFIRMED, CANCELLED, COMPLETED');
    }
    const updated = await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: { status },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
    });

    if (status === 'CONFIRMED' && booking.contactId) {
      this.events.emit('booking.confirmed', {
        booking: updated,
        contact: updated.contact ?? undefined,
        businessId,
        eventName: 'booking.confirmed',
      });
      await this.crm.logContactEvent({
        businessId,
        contactId: booking.contactId,
        type: 'booking.confirmed',
        data: { bookingId, status },
        actorType: 'USER',
        source: 'bookings',
      });
    }

    if (status === 'COMPLETED' && booking.contactId) {
      this.events.emit('booking.completed', {
        booking: updated,
        contact: updated.contact ?? undefined,
        businessId,
      } as BookingCompletedPayload);
      await this.crm.logContactEvent({
        businessId,
        contactId: booking.contactId,
        type: 'booking.completed',
        data: { bookingId, status, serviceName: updated.service?.name },
        actorType: 'USER',
        source: 'bookings',
      });
      await this.autoGenerateInvoiceForCompletedBooking(updated, businessId);
    }

    if (status === 'CANCELLED' && booking.contactId) {
      this.events.emit('booking.cancelled', {
        booking: updated,
        contact: updated.contact ?? undefined,
        businessId,
      });
      await this.crm.logContactEvent({
        businessId,
        contactId: booking.contactId,
        type: 'booking.cancelled',
        data: { bookingId, status },
        actorType: 'USER',
        source: 'bookings',
      });
    }

    return updated;
  }

  async getBookingStats(businessId: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [todayCount, weekCount, pendingCount, totalBookings] = await Promise.all([
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, startTime: { gte: startOfDay, lt: endOfDay } },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, startTime: { gte: startOfWeek, lt: endOfWeek } },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, status: 'PENDING' },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null },
      }),
    ]);

    return { todayCount, weekCount, pendingCount, totalBookings };
  }

  async createBooking(input: {
    businessId: string;
    contactId?: string;
    serviceId: string;
    staffId: string;
    startTime: Date;
    endTime: Date;
  }) {
    const createData: any = {
      businessId: input.businessId,
      serviceId: input.serviceId,
      startTime: input.startTime,
      endTime: input.endTime,
    };
    if (input.contactId) createData.contactId = input.contactId;
    if (input.staffId) createData.staffId = input.staffId;

    const booking = await this.prisma.client.booking.create({
      data: createData,
      include: { contact: true },
    });

    const payload: BookingCreatedPayload = {
      booking,
      contact: (booking as any).contact ?? undefined,
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
    staffId?: string | null;
    startTime: Date;
    contact: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null };
  }) {
    const business = await this.prisma.client.business.findFirstOrThrow({
      where: { id: input.businessId, deletedAt: null },
    });

    if ((business as any).storeEnabled === false) {
      throw new BadRequestException('This store is currently unavailable.');
    }

    const service = await this.prisma.client.service.findFirstOrThrow({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
    });

    const start = new Date(input.startTime);
    const end = new Date(start.getTime() + service.duration * 60000);

    const hours = (business as any).businessHours as Record<string, { open: string; close: string; closed: boolean }> | null;
    if (hours) {
      const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const dayKey = dayKeys[start.getDay()];
      const dayHours = hours[dayKey];
      if (dayHours?.closed) {
        throw new BadRequestException('This business is closed on the selected day.');
      }
      if (dayHours) {
        const [oh, om] = dayHours.open.split(':').map(Number);
        const [ch, cm] = dayHours.close.split(':').map(Number);
        const startMins = start.getHours() * 60 + start.getMinutes();
        const openMins = oh * 60 + om;
        const closeMins = ch * 60 + cm;
        if (startMins < openMins || startMins >= closeMins) {
          throw new BadRequestException('The selected time is outside business hours.');
        }
      }
    }

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

    const bookingData: any = {
      businessId: input.businessId,
      contactId: contact.id,
      serviceId: service.id,
      startTime: start,
      endTime: end,
    };
    if (input.staffId) bookingData.staffId = input.staffId;
    if (invoice?.id) bookingData.invoiceId = invoice.id;

    const booking = await this.prisma.client.booking.create({
      data: bookingData,
    });

    const payload: BookingCreatedPayload = {
      booking,
      contact: contact as any,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.created',
    };
    console.log(`[BOOKING] Emitting booking.created event for booking ${booking.id}, business ${booking.businessId}`);
    this.events.emit('booking.created', payload);
    console.log(`[BOOKING] Event emitted, listeners count: ${this.events.listenerCount('booking.created')}`);
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

  private async autoGenerateInvoiceForCompletedBooking(booking: any, businessId: string) {
    try {
      if (booking.invoiceId) {
        this.logger.log(`Booking ${booking.id} already has invoice ${booking.invoiceId}, skipping auto-invoice`);
        return;
      }
      if (!booking.contactId || !booking.serviceId) return;

      const service = await this.prisma.client.service.findFirst({
        where: { id: booking.serviceId, businessId, deletedAt: null },
      });
      if (!service || service.price <= 0) return;

      const invoice = await this.commerce.createInvoiceForService(businessId, booking.contactId, service as any);
      if (invoice) {
        await this.prisma.client.booking.update({
          where: { id: booking.id },
          data: { invoiceId: invoice.id },
        });
        this.logger.log(`Auto-generated invoice ${invoice.id} for completed booking ${booking.id}`);
      }
    } catch (err) {
      this.logger.error(`Failed to auto-generate invoice for booking ${booking.id}: ${(err as Error).message}`);
    }
  }
}
