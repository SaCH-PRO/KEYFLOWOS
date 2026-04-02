import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { BookingCompletedPayload, BookingConfirmedPayload, BookingCreatedPayload, BookingRescheduledPayload } from '../../core/event-bus/events.types';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { AutomationService } from '../automation/automation.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

type BusinessHoursMap = Record<string, DayHours>;

const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private reminderInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(AutomationService) private readonly automation: AutomationService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
  ) {}

  onModuleInit() {
    this.reminderInterval = setInterval(() => {
      this.processBookingReminders().catch((e) =>
        this.logger.error(`Booking reminder check failed: ${(e as Error).message}`),
      );
    }, REMINDER_CHECK_INTERVAL_MS);
    this.logger.log('Booking reminder scheduler started (5min interval)');
  }

  onModuleDestroy() {
    if (this.reminderInterval) clearInterval(this.reminderInterval);
  }

  private async processBookingReminders() {
    const businesses = await this.prisma.client.business.findMany({
      where: { bookingReminderMins: { not: null, gt: 0 } },
      select: { id: true, bookingReminderMins: true },
    });

    for (const biz of businesses) {
      const reminderMins = biz.bookingReminderMins ?? 60;
      const now = new Date();
      const windowStart = new Date(now.getTime() + (reminderMins - 5) * 60_000);
      const windowEnd = new Date(now.getTime() + (reminderMins + 5) * 60_000);

      const upcomingBookings = await this.prisma.client.booking.findMany({
        where: {
          businessId: biz.id,
          startTime: { gte: windowStart, lte: windowEnd },
          status: { in: ['CONFIRMED', 'PENDING'] },
          reminderSentAt: null,
        },
        include: {
          contact: true,
          service: true,
        },
      });

      for (const booking of upcomingBookings) {
        if (!booking.contact?.email) continue;

        try {
          const endTime = new Date(
            new Date(booking.startTime).getTime() + (booking.service?.duration || 60) * 60_000,
          );

          await this.emailService.send({
            businessId: biz.id,
            type: 'booking_reminder',
            recipientEmail: booking.contact.email,
            recipientName: booking.contact.firstName || booking.contact.email,
            contactId: booking.contactId || undefined,
            templateData: {
              serviceName: booking.service?.name || 'Your appointment',
              startTime: booking.startTime.toISOString(),
              endTime: endTime.toISOString(),
              staffName: '',
              bookingId: booking.id,
            },
            dedupeKey: `booking-reminder-${booking.id}`,
          });

          await this.prisma.client.booking.update({
            where: { id: booking.id },
            data: { reminderSentAt: now },
          });

          this.logger.debug(`Sent booking reminder for booking ${booking.id}`);
        } catch (e) {
          this.logger.error(`Failed to send reminder for booking ${booking.id}: ${(e as Error).message}`);
        }
      }
    }
  }

  listBookings(businessId: string) {
    return this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { startTime: 'desc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true, bufferMins: true, leadTimeMins: true } },
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

  async updateBookingNotes(businessId: string, bookingId: string, notes: string) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
    });
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }
    return this.prisma.client.booking.update({
      where: { id: bookingId },
      data: { notes: notes || null },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true, bufferMins: true, leadTimeMins: true } },
        staff: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true, status: true, total: true } },
      },
    });
  }

  async rescheduleBooking(businessId: string, bookingId: string, newStartTime: Date) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
      include: {
        service: { select: { duration: true } },
      },
    });
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw new BadRequestException('Cannot reschedule a cancelled or completed booking');
    }

    const previousStartTime = booking.startTime;
    const previousEndTime = booking.endTime;
    const start = new Date(newStartTime);
    const duration = booking.service?.duration ?? 60;
    const end = new Date(start.getTime() + duration * 60000);

    const service = await this.prisma.client.service.findUnique({
      where: { id: booking.serviceId },
      select: { bufferMins: true, leadTimeMins: true },
    });

    if (service?.leadTimeMins && service.leadTimeMins > 0) {
      const minStart = new Date(Date.now() + service.leadTimeMins * 60000);
      if (start < minStart) {
        throw new BadRequestException(
          `This service requires at least ${service.leadTimeMins} minutes advance notice.`,
        );
      }
    }

    const bufferMins = service?.bufferMins ?? 0;
    if (bufferMins > 0) {
      const bufferMs = bufferMins * 60000;
      const bufferedStart = new Date(start.getTime() - bufferMs);
      const bufferedEnd = new Date(end.getTime() + bufferMs);
      const staffFilter = booking.staffId ? { staffId: booking.staffId } : {};
      const overlap = await this.prisma.client.booking.findFirst({
        where: {
          businessId,
          ...staffFilter,
          id: { not: booking.id },
          status: { not: 'CANCELLED' },
          deletedAt: null,
          startTime: { lt: bufferedEnd },
          endTime: { gt: bufferedStart },
        },
      });
      if (overlap) {
        throw new BadRequestException(
          `This time conflicts with another booking (including ${bufferMins}-min buffer).`,
        );
      }
    }

    let hasStaffSchedule = false;
    if (booking.staffId) {
      const staffAvailabilities = await this.prisma.client.availability.findMany({
        where: {
          staffId: booking.staffId,
          staff: { businessId, deletedAt: null },
        },
      });
      if (staffAvailabilities.length > 0) {
        hasStaffSchedule = true;
        const dayOfWeek = start.getDay();
        const slotAvail = staffAvailabilities.filter((a) => a.dayOfWeek === dayOfWeek);
        if (slotAvail.length === 0) {
          throw new BadRequestException('The selected staff member is not available on this day.');
        }
        const startMinsOfDay = start.getHours() * 60 + start.getMinutes();
        const endMinsOfDay = (end.getHours() * 60 + end.getMinutes()) || 1440;
        const withinAny = slotAvail.some((a) => {
          const [sh, sm] = a.startTime.split(':').map(Number);
          const [eh, em] = a.endTime.split(':').map(Number);
          return startMinsOfDay >= sh * 60 + sm && endMinsOfDay <= eh * 60 + em;
        });
        if (!withinAny) {
          throw new BadRequestException('The selected time is outside this staff member\'s available hours.');
        }
      }
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { businessHours: true },
    });
    if (!hasStaffSchedule) {
      const hours = business?.businessHours as BusinessHoursMap | null;
      if (hours) {
        const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayKey = dayKeys[start.getDay()];
        const dayHours = hours[dayKey];
        if (dayHours?.closed) {
          throw new BadRequestException('The business is closed on this day.');
        }
        if (dayHours && dayHours.open && dayHours.close) {
          const [oh, om] = dayHours.open.split(':').map(Number);
          const [ch, cm] = dayHours.close.split(':').map(Number);
          const openMin = oh * 60 + om;
          const closeMin = ch * 60 + cm;
          const bookingStartMin = start.getHours() * 60 + start.getMinutes();
          const bookingEndMin = (end.getHours() * 60 + end.getMinutes()) || 1440;
          if (bookingStartMin < openMin || bookingEndMin > closeMin) {
            throw new BadRequestException(
              `The selected time is outside business hours (${dayHours.open} – ${dayHours.close}).`,
            );
          }
        }
      }
    }

    const updated = await this.prisma.client.booking.update({
      where: { id: bookingId },
      data: { startTime: start, endTime: end },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
    });

    if (booking.contactId) {
      const payload: BookingRescheduledPayload = {
        booking: updated,
        contact: updated.contact ?? undefined,
        businessId,
        previousStartTime,
        previousEndTime,
      };
      this.events.emit('booking.rescheduled', payload);

      await this.crm.logContactEvent({
        businessId,
        contactId: booking.contactId,
        type: 'booking.rescheduled',
        data: {
          bookingId,
          previousStartTime,
          previousEndTime,
          newStartTime: start,
          newEndTime: end,
        },
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
    notes?: string;
  }) {
    const createData: Prisma.BookingUncheckedCreateInput = {
      businessId: input.businessId,
      serviceId: input.serviceId,
      startTime: input.startTime,
      endTime: input.endTime,
    };
    if (input.contactId) createData.contactId = input.contactId;
    if (input.staffId) createData.staffId = input.staffId;
    if (input.notes) createData.notes = input.notes;

    const booking = await this.prisma.client.booking.create({
      data: createData,
      include: { contact: true },
    });

    const bookingWithContact = booking as typeof booking & { contact?: { id: string; firstName: string; lastName: string; email: string | null } };

    const payload: BookingCreatedPayload = {
      booking,
      contact: bookingWithContact.contact ?? undefined,
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

    const businessConfig = business as typeof business & { storeEnabled?: boolean };
    if (businessConfig.storeEnabled === false) {
      throw new BadRequestException('This store is currently unavailable.');
    }

    const service = await this.prisma.client.service.findFirstOrThrow({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
    });

    const start = new Date(input.startTime);
    const end = new Date(start.getTime() + service.duration * 60000);

    if (service.leadTimeMins && service.leadTimeMins > 0) {
      const minStart = new Date(Date.now() + service.leadTimeMins * 60000);
      if (start < minStart) {
        throw new BadRequestException(
          `This service requires at least ${service.leadTimeMins} minutes advance notice.`,
        );
      }
    }

    if (service.bufferMins && service.bufferMins > 0) {
      const bufferMs = service.bufferMins * 60000;
      const bufferedStart = new Date(start.getTime() - bufferMs);
      const bufferedEnd = new Date(end.getTime() + bufferMs);
      const overlapWhere: Prisma.BookingWhereInput = {
        businessId: input.businessId,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startTime: { lt: bufferedEnd },
        endTime: { gt: bufferedStart },
        ...(input.staffId ? { staffId: input.staffId } : { serviceId: service.id }),
      };
      const overlapping = await this.prisma.client.booking.findFirst({
        where: overlapWhere,
      });
      if (overlapping) {
        throw new BadRequestException(
          `This time slot is unavailable due to a ${service.bufferMins}-minute buffer between appointments.`,
        );
      }
    }

    let hasStaffScheduleOverride = false;
    if (input.staffId) {
      const staffAvailabilities = await this.prisma.client.availability.findMany({
        where: {
          staffId: input.staffId,
          staff: { businessId: input.businessId, deletedAt: null },
        },
      });
      if (staffAvailabilities.length > 0) {
        hasStaffScheduleOverride = true;
        const dayOfWeek = start.getDay();
        const slotAvail = staffAvailabilities.filter((a) => a.dayOfWeek === dayOfWeek);
        if (slotAvail.length === 0) {
          throw new BadRequestException('The selected staff member is not available on this day.');
        }
        const startMinsOfDay = start.getHours() * 60 + start.getMinutes();
        const endMinsOfDay = (end.getHours() * 60 + end.getMinutes()) || 1440;
        const withinAny = slotAvail.some((a) => {
          const [sh, sm] = a.startTime.split(':').map(Number);
          const [eh, em] = a.endTime.split(':').map(Number);
          return startMinsOfDay >= sh * 60 + sm && endMinsOfDay <= eh * 60 + em;
        });
        if (!withinAny) {
          throw new BadRequestException('The selected time is outside this staff member\'s available hours.');
        }
      }
    }

    const hours = business.businessHours as BusinessHoursMap | null;
    if (hours && !hasStaffScheduleOverride) {
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
        const endMins = startMins + (service.duration || 0) + (service.bufferMins || 0);
        if (startMins < openMins || endMins > closeMins) {
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

    const bookingData: Prisma.BookingUncheckedCreateInput = {
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
      contact,
      businessId: booking.businessId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      eventName: 'booking.created',
    };
    this.logger.debug(`Emitting booking.created for booking=${booking.id} business=${booking.businessId}`);
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

      const invoice = await this.commerce.createInvoiceForService(businessId, booking.contactId, service);
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

  async getReminderSettings(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { bookingReminderMins: true },
    });
    if (!business) throw new BadRequestException('Business not found');
    return { bookingReminderMins: business.bookingReminderMins };
  }

  async updateReminderSettings(businessId: string, bookingReminderMins: number) {
    const validOptions = [15, 30, 60, 120, 1440, 2880];
    if (!validOptions.includes(bookingReminderMins)) {
      throw new BadRequestException('Invalid reminder interval. Valid options: 15, 30, 60, 120, 1440, 2880 minutes.');
    }
    const updated = await this.prisma.client.business.update({
      where: { id: businessId },
      data: { bookingReminderMins },
      select: { bookingReminderMins: true },
    });
    return { bookingReminderMins: updated.bookingReminderMins };
  }
}
