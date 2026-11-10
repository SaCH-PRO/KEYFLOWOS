import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BookingsService } from '../../bookings/bookings.service';
import { CatalogService } from '../../catalog/catalog.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * W9-KEY-AVAILABILITY-TZ (CR-V16-1): the calendar day a KEY "date" parameter
 * names, as UTC midnight of that day. A value that starts YYYY-MM-DD names
 * that day as written, offset or not ("2030-01-07T23:00:00-04:00" is the 7th
 * for the business that wrote it); anything else Date reads is taken on UTC,
 * as the adapter read it before.
 */
function calendarDay(value: string, name: string): number {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  const parsed = ymd ? null : new Date(value);
  const day = ymd
    ? Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    : Date.UTC(parsed!.getUTCFullYear(), parsed!.getUTCMonth(), parsed!.getUTCDate());
  if (Number.isNaN(day)) throw new Error(`Invalid ${name} date: ${value}`);
  return day;
}

/**
 * W9-KEY-AVAILABILITY-TZ review repair (SEC-KAT-1): the most calendar days one
 * get_availability answers for, counted from the first day that can still
 * hold a start. Each day asks BookingsService.getAvailableSlots once per staff
 * member, one after another, so an unbounded from..to (any member with
 * bookings read, or a KEY plan, can send one) ran millions of queries on one
 * pool connection. Two months covers "next month" asked on any day.
 */
export const KEY_AVAILABILITY_MAX_DAYS = 62;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The opening hours a business day row sets, in minutes past midnight, or
 * null when the row sets none (missing, closed, or without open/close times):
 * the rows getAvailableSlots offers nothing on and createBooking refuses or
 * leaves unchecked.
 */
function openHours(hours: unknown, weekday: number): { openMin: number; closeMin: number } | null {
  const day = (hours as Record<string, { open?: string; close?: string; closed?: boolean } | undefined> | null)?.[DAY_KEYS[weekday]];
  if (!day || day.closed || !day.open || !day.close) return null;
  const [oh, om] = day.open.split(':').map(Number);
  const [ch, cm] = day.close.split(':').map(Number);
  return { openMin: oh * 60 + om, closeMin: ch * 60 + cm };
}

/**
 * W9-KEY-AVAILABILITY-TZ review repair (CR-W9KAT-1): minutes past midnight
 * `instant` reads on the business's clock, as BookingsService's create
 * validator reads a start (Business.timezone; the server's clock for no zone
 * or one this runtime cannot read, as BookingsService falls back).
 */
function minutesOnClock(instant: Date, timeZone: string | null | undefined): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(instant);
      const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      return (part('hour') % 24) * 60 + part('minute');
    } catch {
      // RangeError: a zone this runtime does not know; the server's clock below.
    }
  }
  return instant.getHours() * 60 + instant.getMinutes();
}

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

  async blockTime(input: {
    businessId: string;
    staffId: string;
    startTime: string;
    endTime: string;
    reason?: string;
  }) {
    const startAt = new Date(input.startTime);
    const endAt = new Date(input.endTime);
    return this.prisma.client.calendarEvent.create({
      data: {
        businessId: input.businessId,
        title: input.reason || 'Blocked time',
        description: input.reason,
        type: 'BLOCK',
        module: 'BOOKINGS',
        startAt,
        endAt,
        status: 'SCHEDULED',
        sourceType: 'manual',
        sourceId: `block-${input.staffId}-${startAt.toISOString()}`,
        staffId: input.staffId,
        meta: { reason: input.reason },
      },
    });
  }

  async getServices(input: { businessId: string; activeOnly?: boolean }) {
    return this.catalog.listServices(input.businessId);
  }

  /**
   * W9-KEY-AVAILABILITY-TZ (CR-V16-1): the slots KEY offers are the ones the
   * public picker offers, asked of BookingsService.getAvailableSlots for each
   * staff member and each day. They were computed here with staff hours read
   * as UTC wall-clock, so on a UTC server a Port_of_Spain (UTC-4) business was
   * offered its staff's 10:00 as 10:00Z, and KEY create_booking and
   * reschedule_booking, which read hours on the business's clock (V1-16),
   * refused the slots KEY had just offered. getAvailableSlots reads
   * Business.timezone, applies the business's hours to a staff member with
   * none of their own and the service's lead time as the validator does, and
   * puts every candidate through the write paths' own overlap guard, so the
   * clock is computed in one place. Time blocked with block_time is still
   * left out here, as before.
   *
   * `from` and `to` are the tool's "date" parameters: calendar days, both
   * included (calendarDay).
   *
   * Review repairs:
   * - SEC-KAT-1: days before yesterday (UTC) are not asked about: on any
   *   business's clock every start on them is past, and getAvailableSlots
   *   leaves past starts out. What remains may span at most
   *   KEY_AVAILABILITY_MAX_DAYS days; a longer range is refused before any
   *   day is asked about. A day the staff member does not work (their own
   *   hours name no such weekday, or, for one with none, the business's hours
   *   set none that day) is not asked about either: getAvailableSlots answers
   *   it with no slots, after three reads.
   * - CR-W9KAT-1: getAvailableSlots fits a start in the business's hours by
   *   the service's duration, while createBooking (KEY create_booking) also
   *   counts the service's buffer before closing. For a staff member on the
   *   business's hours the starts whose buffer runs past closing were offered
   *   and then refused, so they are left out here. Both sides read a staff
   *   member's own hours without the buffer, and rescheduleBooking adds it to
   *   neither kind of hours, so what is offered stays bookable on both KEY
   *   write paths. The picker itself (BookingsService, also behind the public
   *   slots route) is outside this packet.
   */
  async getAvailability(input: {
    businessId: string;
    serviceId: string;
    from: string;
    to: string;
    staffId?: string;
  }) {
    const service = await this.prisma.client.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
    });
    if (!service) {
      throw new Error(`Service ${input.serviceId} not found`);
    }
    const durationMins = service.duration ?? 60;
    const bufferMins = service.bufferMins ?? 0;
    const now = new Date();
    const yesterday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS;
    const firstDay = Math.max(calendarDay(input.from, 'from'), yesterday);
    const lastDay = calendarDay(input.to, 'to');
    const dayCount = Math.floor((lastDay - firstDay) / DAY_MS) + 1;
    if (dayCount > KEY_AVAILABILITY_MAX_DAYS) {
      const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      throw new Error(
        `get_availability answers for at most ${KEY_AVAILABILITY_MAX_DAYS} days at a time; ` +
          `the range asked covers ${dayCount} (${ymd(firstDay)} to ${ymd(lastDay)}). Ask for a shorter range.`,
      );
    }

    const staffWhere: any = {
      businessId: input.businessId,
      deletedAt: null,
      ...(input.staffId ? { id: input.staffId } : {}),
    };
    const staff = await this.prisma.client.staffMember.findMany({
      where: staffWhere,
      select: { id: true, name: true, availabilities: { select: { dayOfWeek: true } } },
    });
    const business = staff.length
      ? await this.prisma.client.business.findUnique({
          where: { id: input.businessId },
          select: { businessHours: true, timezone: true },
        })
      : null;

    const slots: Array<{ startTime: string; endTime: string; staffId: string; staffName?: string | null }> = [];
    for (const s of staff) {
      // getAvailableSlots' choice of window: the staff member's own hours when
      // they have any, else the business's (SEC-KAT-1, CR-W9KAT-1).
      const ownWeekdays = new Set((s.availabilities ?? []).map((a) => a.dayOfWeek));
      const onBusinessHours = ownWeekdays.size === 0;
      const offered: Array<{ start: Date; end: Date }> = [];
      for (let day = firstDay; day <= lastDay; day += DAY_MS) {
        const d = new Date(day);
        const weekday = d.getUTCDay();
        const businessDay = onBusinessHours ? openHours(business?.businessHours, weekday) : null;
        if (onBusinessHours ? !businessDay : !ownWeekdays.has(weekday)) continue;
        // Handed over as the public slots route hands it: that calendar day's
        // midnight on the server's clock, which getAvailableSlots reads back.
        const { slots: starts } = await this.bookings.getAvailableSlots({
          businessId: input.businessId,
          serviceId: input.serviceId,
          date: new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
          staffId: s.id,
        });
        for (const iso of starts) {
          const start = new Date(iso);
          // CR-W9KAT-1: createBooking's business-hours check, buffer included.
          if (
            businessDay &&
            bufferMins > 0 &&
            minutesOnClock(start, business?.timezone) + durationMins + bufferMins > businessDay.closeMin
          ) {
            continue;
          }
          offered.push({ start, end: new Date(start.getTime() + durationMins * 60000) });
        }
      }
      if (offered.length === 0) continue;

      // One read of the staff member's blocks across everything offered (a
      // day's windows need not come in order).
      const earliest = offered.reduce((min, o) => (o.start < min ? o.start : min), offered[0].start);
      const latest = offered.reduce((max, o) => (o.end > max ? o.end : max), offered[0].end);
      const blocks = await this.prisma.client.calendarEvent.findMany({
        where: {
          businessId: input.businessId,
          staffId: s.id,
          deletedAt: null,
          type: 'BLOCK',
          startAt: { lt: latest },
          endAt: { gt: earliest },
        },
        select: { startAt: true, endAt: true },
      });
      for (const { start, end } of offered) {
        // endAt is nullable in the schema; the read's `gt` already leaves those rows out.
        if (blocks.some((b) => b.endAt !== null && b.startAt < end && b.endAt > start)) continue;
        slots.push({
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          staffId: s.id,
          staffName: s.name,
        });
      }
    }
    return slots;
  }

  async getStaffSchedule(input: { businessId: string; staffId: string; date: string }) {
    const day = new Date(input.date);
    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);

    const [bookings, blocks, availability] = await Promise.all([
      this.prisma.client.booking.findMany({
        where: {
          businessId: input.businessId,
          staffId: input.staffId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          startTime: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { startTime: 'asc' },
        include: { contact: { select: { id: true, firstName: true, lastName: true } }, service: { select: { id: true, name: true } } },
      }),
      this.prisma.client.calendarEvent.findMany({
        where: {
          businessId: input.businessId,
          staffId: input.staffId,
          deletedAt: null,
          type: 'BLOCK',
          startAt: { gte: startOfDay, lte: endOfDay },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.client.availability.findMany({
        where: { staffId: input.staffId, dayOfWeek: day.getDay() },
      }),
    ]);

    return {
      date: day.toISOString(),
      staffId: input.staffId,
      availability,
      bookings,
      blocks,
    };
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

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_booking': {
        const booking = await this.createBooking({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          serviceId: command.parameters.serviceId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          staffId: command.parameters.staffId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, booking);
      }
      case 'cancel_booking': {
        const cancelled = await this.cancelBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          reason: command.parameters.reason as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        });
        return connectorOk(command, start, cancelled);
      }
      case 'reschedule_booking': {
        const rescheduled = await this.rescheduleBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          newStartTime: command.parameters.newStartTime as string,
          newEndTime: command.parameters.newEndTime as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        });
        return connectorOk(command, start, rescheduled);
      }
      case 'confirm_booking': {
        const confirmed = await this.confirmBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          sendConfirmation: (command.parameters.sendConfirmation as boolean) ?? true,
        });
        return connectorOk(command, start, confirmed);
      }
      case 'add_service': {
        const service = await this.addService({
          businessId: command.businessId,
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          description: command.parameters.description as string,
          buffer: (command.parameters.buffer as number) || 0,
        });
        return connectorOk(command, start, service);
      }
      case 'update_service': {
        const updated = await this.updateService({
          businessId: command.businessId,
          serviceId: command.parameters.serviceId as string,
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          active: command.parameters.active as boolean,
        });
        return connectorOk(command, start, updated);
      }
      case 'set_availability': {
        const avail = await this.setAvailability({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          dayOfWeek: command.parameters.dayOfWeek as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
        });
        return connectorOk(command, start, avail);
      }
      case 'block_time': {
        const blocked = await this.blockTime({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          reason: command.parameters.reason as string,
        });
        return connectorOk(command, start, blocked);
      }
      case 'get_availability': {
        const slots = await this.getAvailability({
          businessId: command.businessId,
          serviceId: command.parameters.serviceId as string,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          staffId: command.parameters.staffId as string,
        });
        return connectorOk(command, start, slots);
      }
      case 'get_upcoming_bookings': {
        const upcoming = await this.getUpcomingBookings({
          businessId: command.businessId,
          from: command.parameters.from as string,
          to: command.parameters.to as string,
          contactId: command.parameters.contactId as string,
          staffId: command.parameters.staffId as string,
          limit: (command.parameters.limit as number) || 50,
        });
        return connectorOk(command, start, upcoming);
      }
      case 'get_services': {
        const services = await this.getServices({
          businessId: command.businessId,
          activeOnly: (command.parameters.activeOnly as boolean) ?? true,
        });
        return connectorOk(command, start, services);
      }
      case 'get_staff_schedule': {
        const schedule = await this.getStaffSchedule({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          date: command.parameters.date as string,
        });
        return connectorOk(command, start, schedule);
      }
      default:
        return connectorFail(command, start, `Unknown bookings action: ${command.action}`);
    }
  }
}
