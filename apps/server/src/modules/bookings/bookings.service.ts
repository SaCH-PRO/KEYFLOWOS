import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingStatus, Prisma } from '@prisma/client';
import {
  BookingCompletedPayload,
  BookingConfirmedPayload,
  BookingCreatedPayload,
  BookingInvoiceCreatedPayload,
  BookingNoShowPayload,
  BookingRescheduledPayload,
} from '../../core/event-bus/events.types';
import {
  WORK_OBLIGATION_RAISED,
  WORK_OBLIGATION_SETTLED,
  type ObligationRaisedPayload,
  type ObligationSettledPayload,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { RevenueAttributionService } from '../commerce/revenue-attribution.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { TimelineService } from '../timeline/timeline.service';

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

type BusinessHoursMap = Record<string, DayHours>;

const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Placeholder until BusinessGenome carries a per-business rebook interval.
 * Named as a constant rather than buried inline so the day it moves, grep finds
 * exactly one site.
 */
const REBOOK_AFTER_DAYS = 42;

/**
 * Structural, not `BookingWithRelations`.
 *
 * The completion path hands this helper a booking selected with a NARROW
 * contact (`id, firstName, lastName, email, phone`), so demanding the full
 * relation type would force a widening cast at the only call site — and a cast
 * there would silently accept a future caller whose select is narrower still.
 * Naming exactly the four fields used means the compiler checks the contract
 * rather than the shape.
 */
type RebookableBooking = {
  id: string;
  contactId: string | null;
  startTime: Date | null;
  endTime: Date | null;
  contact?: { firstName: string | null; lastName: string | null } | null;
  service?: { name: string } | null;
};

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: { contact: true; service: true };
}>;

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private reminderInterval: ReturnType<typeof setInterval> | null = null;
  private emailWarnedBusinesses = new Set<string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(RevenueAttributionService) private readonly revenueAttribution: RevenueAttributionService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
    @Inject(PublicEventsService) private readonly publicEvents: PublicEventsService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
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
    let businesses: Array<{ id: string; bookingReminderMins: number | null }>;
    try {
      businesses = await this.prisma.client.business.findMany({
        where: { bookingReminderMins: { gt: 0 } },
        select: { id: true, bookingReminderMins: true },
      });
    } catch (e) {
      this.logger.warn(`Booking reminder check skipped — DB unavailable: ${(e as Error).message}`);
      return;
    }

    if (businesses.length === 0) return;

    for (const biz of businesses) {
      const reminderMins = biz.bookingReminderMins ?? 60;
      const now = new Date();
      const windowStart = new Date(now.getTime() + (reminderMins - 5) * 60_000);
      const windowEnd = new Date(now.getTime() + (reminderMins + 5) * 60_000);

      let upcomingBookings: BookingWithRelations[];
      try {
        upcomingBookings = await this.prisma.client.booking.findMany({
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
      } catch (e) {
        this.logger.warn(`Skipping reminders for business ${biz.id}: ${(e as Error).message}`);
        continue;
      }

      for (const booking of upcomingBookings) {
        if (!booking.contact?.email) continue;

        const endTime = new Date(
          new Date(booking.startTime).getTime() + (booking.service?.duration || 60) * 60_000,
        );

        let emailSent = false;
        try {
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
              location: (booking as any).location ?? null,
              locationPlaceId: (booking as any).locationPlaceId ?? null,
              locationLatLng: (booking as any).locationLatLng ?? null,
            },
            dedupeKey: `booking-reminder-${booking.id}`,
          });
          emailSent = true;
          this.emailWarnedBusinesses.delete(biz.id);
        } catch (e) {
          const msg = (e as Error).message;
          if (!this.emailWarnedBusinesses.has(biz.id)) {
            this.emailWarnedBusinesses.add(biz.id);
            this.logger.warn(`Email transport unavailable for business ${biz.id}, suppressing further warnings until resolved: ${msg}`);
          }
        }

        if (emailSent) {
          try {
            await this.prisma.client.booking.update({
              where: { id: booking.id },
              data: { reminderSentAt: now },
            });
            this.logger.debug(`Sent booking reminder for booking ${booking.id}`);
          } catch (e) {
            this.logger.error(`Failed to mark reminder sent for booking ${booking.id}: ${(e as Error).message}`);
          }
        }
      }
    }
  }

  listBookings(businessId: string, orgUnitId?: string) {
    return this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null, ...(orgUnitId ? { orgUnitId } : {}) },
      orderBy: { startTime: 'desc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true, bufferMins: true, leadTimeMins: true } },
        staff: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true, status: true, total: true, currency: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * A finished appointment is a rebook this business owes the client.
   *
   * The first producer on the obligation contract, and chosen because it is the
   * most ordinary thing a small business forgets: the cut is done, the client
   * is happy, and nobody books the next one. A salon's rebook and an
   * accountant's VAT return are the same row on the same clock, and this is the
   * cheap half of proving that.
   *
   * REBOOK_AFTER_DAYS is hard-coded, and that is a deliberate, temporary lie
   * about how this should work. The right source is the genome — a barber's
   * interval is three weeks, a dentist's is six months, and the business itself
   * knows which it is. Until BusinessGenome carries a default clock, 42 days is
   * a stated placeholder rather than a silent one.
   *
   * Fire-and-forget: emit() on EventEmitter2 is synchronous dispatch to
   * listeners that return promises nobody awaits, so a slow or failing listener
   * cannot make marking a booking complete fail. The listener owns its own
   * errors; see obligation.listener.ts.
   */
  private raiseRebookObligation(businessId: string, booking: RebookableBooking): void {
    if (!booking.contactId) return;

    const completedAt = booking.endTime ?? booking.startTime ?? new Date();
    const dueAt = new Date(completedAt.getTime() + REBOOK_AFTER_DAYS * 24 * 60 * 60 * 1000);
    // Contact has firstName/lastName, no `name`. Falling back to a generic
    // noun rather than rendering "Rebook null" or "Rebook undefined".
    const label = [booking.contact?.firstName, booking.contact?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const who = label || 'this client';
    const what = booking.service?.name?.trim();

    const payload: ObligationRaisedPayload = {
      businessId,
      // The five-tuple. sourceId is the BOOKING, not the contact: a rebook is
      // owed once per completed appointment, and keying on the contact would
      // make every visit overwrite the last one's obligation.
      sourceModule: 'bookings',
      sourceType: 'booking',
      sourceId: booking.id,
      actionType: 'REBOOK',
      title: what ? `Rebook ${who} for ${what}` : `Rebook ${who}`,
      description: `Their last appointment completed ${completedAt.toISOString().slice(0, 10)}.`,
      category: 'SALES',
      dueAt,
      owedToType: 'CONTACT',
      owedToId: booking.contactId,
      owedToLabel: label || null,
      contactId: booking.contactId,
      entityType: 'booking',
      entityId: booking.id,
      priority: 55,
    };

    this.events.emit(WORK_OBLIGATION_RAISED, payload);
  }

  /**
   * A new booking for this client settles the rebook we owed them.
   *
   * The other half of `raiseRebookObligation`, and without it the loop never
   * closes: a completed appointment raises a REBOOK keyed on THAT appointment's
   * id, and this booking has no idea which prior appointment it fulfils — only
   * who it is for. So it settles BY PARTY. See ObligationSettledPayload.
   *
   * Missing until an audit found it. The listener existed with no emitter,
   * which made it a dead listener, and the visible symptom would have been a
   * "due this week" list slowly filling with rebooks that had already happened.
   */
  private settleRebookObligation(businessId: string, contactId: string | null, bookingId: string): void {
    if (!contactId) return;
    const payload: ObligationSettledPayload = {
      businessId,
      actionType: 'REBOOK',
      owedToId: contactId,
      dischargeRef: `booking:${bookingId}`,
    };
    this.events.emit(WORK_OBLIGATION_SETTLED, payload);
  }

  async updateBookingStatus(businessId: string, bookingId: string, status: BookingStatus) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
    });
    if (!booking) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('Booking not found');
    }
    const allowed: BookingStatus[] = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
    if (!allowed.includes(status)) {
      const { BadRequestException } = await import('@nestjs/common');
      throw new BadRequestException(
        'Invalid status. Must be one of: PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW',
      );
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
      this.raiseRebookObligation(businessId, updated);
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

    if (status === 'NO_SHOW' && booking.contactId) {
      const payload: BookingNoShowPayload = {
        booking: updated,
        contact: updated.contact ?? undefined,
        businessId,
        markedAt: new Date(),
      };
      // Single source of truth: the event-bus subscriber (BookingNoShowListener
      // + RevenueEventListener) owns timeline + notification side-effects for
      // no-shows. Do not write to the timeline directly here.
      this.events.emit('booking.no_show', payload);
    }

    return updated;
  }

  /**
   * Public version of the auto-invoice helper that powers the booking-detail
   * "Create invoice" button. Idempotent: if the booking already has an invoice,
   * returns it unchanged; otherwise creates one from the booking's service and
   * links it via `Booking.invoiceId`.
   */
  async createInvoiceFromBooking(businessId: string, bookingId: string) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
      include: {
        service: true,
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }
    if (booking.invoiceId) {
      const existing = await this.prisma.client.invoice.findUnique({
        where: { id: booking.invoiceId },
        select: { id: true, invoiceNumber: true },
      });
      if (existing) {
        return {
          invoiceId: existing.id,
          invoiceNumber: existing.invoiceNumber,
          alreadyExisted: true,
        };
      }
    }
    if (!booking.contactId || !booking.serviceId || !booking.service) {
      throw new BadRequestException('Booking is missing a contact or service');
    }
    if ((booking.service.price ?? 0) <= 0) {
      throw new BadRequestException('Service has no price configured');
    }

    const invoice = await this.commerce.createInvoiceForService(
      businessId,
      booking.contactId,
      booking.service,
    );
    if (!invoice) {
      throw new BadRequestException('Failed to create invoice');
    }
    await this.prisma.client.booking.update({
      where: { id: booking.id },
      data: { invoiceId: invoice.id },
    });

    const invoiceWithNumber = invoice as typeof invoice & { invoiceNumber: string };
    const payload: BookingInvoiceCreatedPayload = {
      booking: { ...booking, invoiceId: invoice.id },
      invoice,
      businessId,
    };
    // Single source of truth: RevenueEventListener subscribes to
    // `booking.invoice_created` and writes the canonical
    // `invoice.from_booking` row on the contact timeline. Do NOT also
    // call this.crm.logContactEvent here — that would bypass the bus
    // and risk duplicate timeline rows.
    this.events.emit('booking.invoice_created', payload);
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoiceWithNumber.invoiceNumber,
      alreadyExisted: false,
    };
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

  async updateBookingLocation(
    businessId: string,
    bookingId: string,
    input: {
      location?: string | null;
      locationPlaceId?: string | null;
      locationLatLng?: { lat: number; lng: number } | null;
    },
  ) {
    const booking = await this.prisma.client.booking.findFirst({
      where: { id: bookingId, businessId, deletedAt: null },
    });
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }

    const data: Prisma.BookingUncheckedUpdateInput = {};
    if (input.location !== undefined) {
      const trimmed = typeof input.location === 'string' ? input.location.trim() : '';
      data.location = trimmed ? trimmed : null;
      if (!trimmed) {
        data.locationPlaceId = null;
        data.locationLatLng = Prisma.JsonNull;
      }
    }
    if (input.locationPlaceId !== undefined && data.locationPlaceId === undefined) {
      data.locationPlaceId = input.locationPlaceId || null;
    }
    if (input.locationLatLng !== undefined && data.locationLatLng === undefined) {
      data.locationLatLng = input.locationLatLng
        ? (input.locationLatLng as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    return this.prisma.client.booking.update({
      where: { id: bookingId },
      data,
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

  async getBookingStats(businessId: string, orgUnitId?: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);

    const baseWhere = { businessId, deletedAt: null, ...(orgUnitId ? { orgUnitId } : {}) };

    const [todayCount, weekCount, pendingCount, totalBookings] = await Promise.all([
      this.prisma.client.booking.count({
        where: { ...baseWhere, startTime: { gte: startOfDay, lt: endOfDay } },
      }),
      this.prisma.client.booking.count({
        where: { ...baseWhere, startTime: { gte: startOfWeek, lt: endOfWeek } },
      }),
      this.prisma.client.booking.count({
        where: { ...baseWhere, status: 'PENDING' },
      }),
      this.prisma.client.booking.count({
        where: baseWhere,
      }),
    ]);

    return { todayCount, weekCount, pendingCount, totalBookings };
  }

  async createBooking(input: {
    businessId: string;
    contactId: string;
    serviceId: string;
    staffId?: string;
    startTime: Date;
    endTime: Date;
    notes?: string;
    location?: string;
    locationPlaceId?: string;
    locationLatLng?: { lat: number; lng: number };
    orgUnitId?: string;
  }) {
    const createData: Prisma.BookingUncheckedCreateInput = {
      businessId: input.businessId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      startTime: input.startTime,
      endTime: input.endTime,
    };
    if (input.staffId) createData.staffId = input.staffId;
    if (input.notes) createData.notes = input.notes;
    if (input.location) createData.location = input.location;
    if (input.locationPlaceId) createData.locationPlaceId = input.locationPlaceId;
    if (input.locationLatLng) {
      createData.locationLatLng = input.locationLatLng as unknown as Prisma.InputJsonValue;
    }
    if (input.orgUnitId) createData.orgUnitId = input.orgUnitId;

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
    // Closes the rebook loop: this booking settles the REBOOK we owed
    // this client. Settles BY PARTY, because a new booking knows who it
    // is for and not which completed appointment made a rebook owed.
    this.settleRebookObligation(booking.businessId, booking.contactId, booking.id);
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
    
    return booking;
  }

  async publicCreateBooking(input: {
    businessId: string;
    serviceId: string;
    staffId?: string | null;
    startTime: Date;
    contact: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; companyName?: string | null };
    notes?: string | null;
    location?: string | null;
    locationPlaceId?: string | null;
    locationLatLng?: { lat: number; lng: number } | null;
    storefrontSlug?: string | null;
    visitorId?: string | null;
    referralCode?: string | null;
    orgUnitId?: string | null;
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

    const sourceDetail = input.storefrontSlug
      ? `storefront:${input.storefrontSlug}`
      : 'public-booking';
    const contact = await this.crm.findOrCreateContact(input.businessId, {
      ...input.contact,
      source: 'storefront',
      sourceDetail,
      ...(input.referralCode ? { custom: { referralCode: input.referralCode } } : {}),
    });
    if (!contact) {
      throw new Error('Failed to create or find contact');
    }
    if (input.visitorId) {
      await this.publicEvents
        .backstitchVisitor({
          businessId: input.businessId,
          visitorId: input.visitorId,
          contactId: contact.id,
          sourceDetail,
        })
        .catch(() => undefined);
    }
    await this.publicEvents.logStorefrontEvent({
      businessId: input.businessId,
      contactId: contact.id,
      type: 'booking.started',
      sourceDetail,
      data: {
        serviceId: service.id,
        startTime: start.toISOString(),
        referralCode: input.referralCode ?? null,
      },
    });

    // S2 invoice gating. Three modes per service:
    //   - depositRequired=true → create a DEPOSIT invoice up-front
    //     (booking.depositInvoiceId), full invoice waits for completion.
    //   - invoiceTiming === 'BOOKING' (and no deposit) → create FULL invoice now.
    //   - invoiceTiming === 'COMPLETION' (default) → no invoice now;
    //     bookings.completed flow generates it on completion.
    let invoice: { id: string; total: number; currency: string } | null = null;
    let depositInvoice: { id: string; total: number; currency: string } | null = null;
    if (service.price > 0) {
      const depositAmount = this.commerce.computeServiceDeposit(service);
      const invoiceTiming = service.invoiceTiming ?? 'COMPLETION';
      if (depositAmount > 0) {
        depositInvoice = await this.commerce.createInvoiceForService(
          input.businessId,
          contact.id,
          service,
          { kind: 'DEPOSIT', amountOverride: depositAmount },
        );
      } else if (invoiceTiming === 'BOOKING') {
        invoice = await this.commerce.createInvoiceForService(input.businessId, contact.id, service);
      }
    }

    const bookingData: Prisma.BookingUncheckedCreateInput = {
      businessId: input.businessId,
      contactId: contact.id,
      serviceId: service.id,
      startTime: start,
      endTime: end,
    };
    if (input.staffId) bookingData.staffId = input.staffId;
    if (invoice?.id) bookingData.invoiceId = invoice.id;
    if (depositInvoice?.id) bookingData.depositInvoiceId = depositInvoice.id;
    if (input.notes && input.notes.trim()) bookingData.notes = input.notes.trim();
    if (input.location && input.location.trim()) bookingData.location = input.location.trim();
    if (input.locationPlaceId && input.locationPlaceId.trim())
      bookingData.locationPlaceId = input.locationPlaceId.trim();
    if (
      input.locationLatLng &&
      typeof input.locationLatLng.lat === 'number' &&
      typeof input.locationLatLng.lng === 'number'
    ) {
      bookingData.locationLatLng = {
        lat: input.locationLatLng.lat,
        lng: input.locationLatLng.lng,
      };
    }
    if (input.orgUnitId) bookingData.orgUnitId = input.orgUnitId;

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
    // Closes the rebook loop: this booking settles the REBOOK we owed
    // this client. Settles BY PARTY, because a new booking knows who it
    // is for and not which completed appointment made a rebook owed.
    this.settleRebookObligation(booking.businessId, booking.contactId, booking.id);
    if (booking.contactId) {
      await this.publicEvents.logStorefrontEvent({
        businessId: booking.businessId,
        contactId: booking.contactId,
        type: 'booking.created',
        sourceDetail,
        data: {
          bookingId: booking.id,
          serviceId: booking.serviceId,
          startTime: booking.startTime,
          endTime: booking.endTime,
          invoiceId: invoice?.id,
          depositInvoiceId: depositInvoice?.id,
          depositAmount: depositInvoice?.total ?? null,
          referralCode: input.referralCode ?? null,
        },
      });
    }

    // Revenue attribution row for the booking itself (recognized at the
    // service price even if invoice/payment lands later — gives growth
    // dashboards an immediate view of pipeline value). Hard requirement
    // for storefront-originated revenue: failures propagate to the caller.
    await this.revenueAttribution.record({
      businessId: input.businessId,
      source: 'storefront',
      sourceDetail,
      revenueType: 'BOOKING',
      revenueId: booking.id,
      amount: service.price ?? 0,
      currency: 'TTD',
      contactId: contact.id,
      referralCode: input.referralCode ?? null,
      visitorId: input.visitorId ?? null,
      occurredAt: booking.createdAt,
    });

    return {
      success: true,
      bookingId: booking.id,
      invoiceId: invoice?.id,
      depositInvoiceId: depositInvoice?.id,
      depositAmount: depositInvoice?.total ?? 0,
    };
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
        // Emit on the bus so RevenueEventListener writes the canonical
        // `invoice.from_booking` timeline row exactly once.
        const payload: BookingInvoiceCreatedPayload = {
          booking: { ...booking, invoiceId: invoice.id },
          invoice,
          businessId,
        };
        this.events.emit('booking.invoice_created', payload);
        this.logger.log(`Auto-generated invoice ${invoice.id} for completed booking ${booking.id}`);
      }
    } catch (err: any) {
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
