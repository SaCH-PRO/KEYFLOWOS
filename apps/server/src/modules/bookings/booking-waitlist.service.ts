import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface AddToWaitlistInput {
  businessId: string;
  contactId: string;
  serviceId: string;
  preferredStaffId?: string | null;
  preferredDateFrom?: Date | string | null;
  preferredDateTo?: Date | string | null;
  preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | string | null;
  notes?: string | null;
}

export interface FreedSlot {
  startTime: Date;
  endTime: Date;
  serviceId: string;
  staffId?: string | null;
}

export interface FindMatchesOptions {
  limit?: number;
  excludeEntryIds?: string[];
}

export const WAITLIST_STATUSES = {
  WAITING: 'WAITING',
  OFFERED: 'OFFERED',
  CONVERTED: 'CONVERTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

/**
 * Booking waitlist: queue a contact when their preferred slot is unavailable,
 * then offer them the first matching slot that frees up.
 *
 * Matching is FIFO within a tenant. The rules intentionally narrow:
 *   - service must match
 *   - preferred staff, if set, must match
 *   - preferred date range, if set, must contain the slot start
 *   - preferred time-of-day bucket, if set, must contain the slot hour
 *
 * This is the minimal coherent v1. Notifications and auto-conversion are
 * deliberately out of scope here; they belong in listeners that react to
 * `booking.waitlist.slot_offered`.
 */
@Injectable()
export class BookingWaitlistService {
  private readonly logger = new Logger(BookingWaitlistService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async addToWaitlist(input: AddToWaitlistInput) {
    const {
      businessId,
      contactId,
      serviceId,
      preferredStaffId,
      preferredDateFrom,
      preferredDateTo,
      preferredTimeOfDay,
      notes,
    } = input;

    // Validate foreign keys and tenancy up-front so a bad request fails loudly
    // rather than creating an orphan waitlist entry.
    const [contact, service, staff] = await Promise.all([
      this.prisma.client.contact.findFirst({
        where: { id: contactId, businessId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.client.service.findFirst({
        where: { id: serviceId, businessId, deletedAt: null },
        select: { id: true },
      }),
      preferredStaffId
        ? this.prisma.client.staffMember.findFirst({
            where: { id: preferredStaffId, businessId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve({ id: preferredStaffId }),
    ]);

    if (!contact) throw new BadRequestException('Contact not found in this business');
    if (!service) throw new BadRequestException('Service not found in this business');
    if (preferredStaffId && !staff) {
      throw new BadRequestException('Preferred staff member not found in this business');
    }

    const fromDate = preferredDateFrom ? new Date(preferredDateFrom) : null;
    const toDate = preferredDateTo ? new Date(preferredDateTo) : null;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('preferredDateFrom is not a valid date');
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('preferredDateTo is not a valid date');
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('preferredDateFrom must be before or equal to preferredDateTo');
    }

    const normalizedTimeOfDay = preferredTimeOfDay
      ? this.normalizeTimeOfDay(preferredTimeOfDay)
      : null;

    const entry = await this.prisma.client.bookingWaitlistEntry.create({
      data: {
        businessId,
        contactId,
        serviceId,
        preferredStaffId: preferredStaffId ?? null,
        status: WAITLIST_STATUSES.WAITING,
        preferredDateFrom: fromDate,
        preferredDateTo: toDate,
        preferredTimeOfDay: normalizedTimeOfDay,
        notes: notes ?? null,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        service: { select: { id: true, name: true, duration: true } },
        preferredStaff: { select: { id: true, name: true } },
      },
    });

    this.events.emit('booking.waitlist.added', { entry, businessId });
    return entry;
  }

  async listWaitlist(
    businessId: string,
    filters: {
      status?: string;
      serviceId?: string;
      contactId?: string;
      preferredStaffId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const where: Record<string, unknown> = {
      businessId,
      deletedAt: null,
    };
    if (filters.status) where.status = filters.status;
    if (filters.serviceId) where.serviceId = filters.serviceId;
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.preferredStaffId) where.preferredStaffId = filters.preferredStaffId;

    const [items, total] = await Promise.all([
      this.prisma.client.bookingWaitlistEntry.findMany({
        where,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, displayName: true } },
          service: { select: { id: true, name: true, duration: true } },
          preferredStaff: { select: { id: true, name: true } },
          offeredBooking: {
            select: { id: true, startTime: true, endTime: true, status: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }],
        take: Math.min(filters.limit ?? 50, 200),
        skip: filters.offset ?? 0,
      }),
      this.prisma.client.bookingWaitlistEntry.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Find the first waitlist entries that match a newly-freed slot.
   *
   * The returned entries are NOT modified; the caller decides whether to
   * create a placeholder booking and offer the slot.
   */
  async findWaitlistMatchesForSlot(
    businessId: string,
    slot: FreedSlot,
    opts: FindMatchesOptions = {},
  ) {
    const limit = Math.min(opts.limit ?? 1, 50);

    const waitingEntries = await this.prisma.client.bookingWaitlistEntry.findMany({
      where: {
        businessId,
        status: WAITLIST_STATUSES.WAITING,
        deletedAt: null,
        serviceId: slot.serviceId,
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 200, // read a chunk so filtering in memory is bounded
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        service: { select: { id: true, name: true, duration: true } },
        preferredStaff: { select: { id: true, name: true } },
      },
    });

    const excluded = new Set(opts.excludeEntryIds ?? []);
    const matches = [];
    for (const entry of waitingEntries) {
      if (excluded.has(entry.id)) continue;
      if (this.matchesSlot(entry, slot)) {
        matches.push(entry);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  /**
   * Create a placeholder booking from a waitlist entry and mark the entry OFFERED.
   *
   * The placeholder booking is UNCONFIRMED: the contact still has to accept it
   * (via `convertWaitlistEntry`) before it becomes a real appointment.
   */
  async offerSlot(entryId: string, slot: FreedSlot, actorType: 'SYSTEM' | 'USER' = 'SYSTEM') {
    const entry = await this.prisma.client.bookingWaitlistEntry.findFirst({
      where: { id: entryId, deletedAt: null },
      include: {
        business: { select: { id: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true, duration: true } },
        preferredStaff: { select: { id: true, name: true } },
      },
    });

    if (!entry) throw new NotFoundException('Waitlist entry not found');
    if (entry.status !== WAITLIST_STATUSES.WAITING) {
      throw new BadRequestException(`Cannot offer slot to entry with status ${entry.status}`);
    }

    const businessId = entry.businessId;
    const staffId = entry.preferredStaffId ?? slot.staffId ?? null;

    const placeholder = await this.prisma.client.booking.create({
      data: {
        businessId,
        contactId: entry.contactId,
        serviceId: entry.serviceId,
        staffId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        status: 'UNCONFIRMED',
        notes: entry.notes ? `Waitlist request: ${entry.notes}` : 'Hold for waitlisted contact',
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true } },
        staff: { select: { id: true, name: true } },
      },
    });

    const updated = await this.prisma.client.bookingWaitlistEntry.update({
      where: { id: entryId },
      data: {
        status: WAITLIST_STATUSES.OFFERED,
        offeredBookingId: placeholder.id,
        offeredAt: new Date(),
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        service: { select: { id: true, name: true } },
        preferredStaff: { select: { id: true, name: true } },
        offeredBooking: {
          select: { id: true, startTime: true, endTime: true, status: true },
        },
      },
    });

    this.events.emit('booking.waitlist.slot_offered', {
      entry: updated,
      booking: placeholder,
      businessId,
      actorType,
    });

    return { entry: updated, booking: placeholder };
  }

  /**
   * Accept an offered slot: confirm the placeholder booking and mark the
   * waitlist entry CONVERTED.
   */
  async convertWaitlistEntry(businessId: string, entryId: string) {
    const entry = await this.prisma.client.bookingWaitlistEntry.findFirst({
      where: { id: entryId, businessId, deletedAt: null },
      include: { offeredBooking: true },
    });

    if (!entry) throw new NotFoundException('Waitlist entry not found');
    if (entry.status !== WAITLIST_STATUSES.OFFERED || !entry.offeredBookingId) {
      throw new BadRequestException('Waitlist entry has no offered slot to convert');
    }

    const [convertedEntry, confirmedBooking] = await this.prisma.client.$transaction([
      this.prisma.client.bookingWaitlistEntry.update({
        where: { id: entryId },
        data: {
          status: WAITLIST_STATUSES.CONVERTED,
          convertedAt: new Date(),
        },
      }),
      this.prisma.client.booking.update({
        where: { id: entry.offeredBookingId },
        data: { status: 'CONFIRMED' },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true } },
          staff: { select: { id: true, name: true } },
        },
      }),
    ]);

    this.events.emit('booking.waitlist.converted', {
      entry: convertedEntry,
      booking: confirmedBooking,
      businessId,
    });

    return { entry: convertedEntry, booking: confirmedBooking };
  }

  /**
   * Cancel a waitlist entry. If it has an offered placeholder booking, that
   * booking is cancelled too.
   */
  async cancelWaitlistEntry(businessId: string, entryId: string) {
    const entry = await this.prisma.client.bookingWaitlistEntry.findFirst({
      where: { id: entryId, businessId, deletedAt: null },
    });
    if (!entry) throw new NotFoundException('Waitlist entry not found');

    const [cancelledEntry] = await this.prisma.client.$transaction(async (tx) => {
      const entryUpdate = tx.bookingWaitlistEntry.update({
        where: { id: entryId },
        data: { status: WAITLIST_STATUSES.CANCELLED, deletedAt: new Date() },
      });
      if (entry.offeredBookingId) {
        const bookingUpdate = tx.booking.update({
          where: { id: entry.offeredBookingId },
          data: { status: 'CANCELLED' },
        });
        return Promise.all([entryUpdate, bookingUpdate]);
      }
      return Promise.all([entryUpdate]);
    });

    this.events.emit('booking.waitlist.cancelled', {
      entry: cancelledEntry,
      businessId,
    });

    return cancelledEntry;
  }

  /**
   * Preview which waitlist entries would match a proposed slot, without
   * creating any bookings or changing any state.
   */
  async previewMatchesForSlot(businessId: string, slot: FreedSlot, opts: FindMatchesOptions = {}) {
    return this.findWaitlistMatchesForSlot(businessId, slot, opts);
  }

  private matchesSlot(
    entry: {
      preferredStaffId: string | null;
      preferredDateFrom: Date | null;
      preferredDateTo: Date | null;
      preferredTimeOfDay: string | null;
    },
    slot: FreedSlot,
  ): boolean {
    if (entry.preferredStaffId && entry.preferredStaffId !== slot.staffId) {
      return false;
    }

    const slotStart = new Date(slot.startTime);
    if (entry.preferredDateFrom && slotStart.getTime() < entry.preferredDateFrom.getTime()) {
      return false;
    }
    if (entry.preferredDateTo && slotStart.getTime() > entry.preferredDateTo.getTime()) {
      return false;
    }

    if (entry.preferredTimeOfDay) {
      const hour = slotStart.getHours();
      const bucket = this.hourToBucket(hour);
      if (bucket !== entry.preferredTimeOfDay) return false;
    }

    return true;
  }

  private normalizeTimeOfDay(value: string): string | null {
    const lower = value.trim().toLowerCase();
    if (lower === 'morning' || lower === 'am') return 'morning';
    if (lower === 'afternoon') return 'afternoon';
    if (lower === 'evening' || lower === 'pm') return 'evening';
    return null;
  }

  private hourToBucket(hour: number): string {
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }
}
