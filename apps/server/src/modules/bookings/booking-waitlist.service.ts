import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getTenantContext } from '../../core/tenant/tenant-context';

type PrismaClientLike = PrismaService['client'];
type PrismaTx = Parameters<Parameters<PrismaClientLike['$transaction']>[0]>[0];

/**
 * V1-27 (M41, M06): the slot claim for booking writers outside
 * BookingsService. A booking on a calendar is the staff member's (else the
 * service's) time, and every writer that puts one there must check and take it
 * the way BookingsService.claimSlot does (V1-16): under the calendar's advisory
 * transaction lock, re-reading the overlap guard inside that transaction. The
 * waitlist offer's placeholder and the calendar PATCH write-back wrote booking
 * rows with no check at all, so an occupied slot got a second live booking.
 *
 * These mirror BookingsService (bookings.service.ts: SLOT_LOCK_NAMESPACE,
 * assertSlotFree, claimSlot) to the byte: the same lock key, so a claim here
 * and a claim there serialize on one calendar; the same overlap rule and
 * buffer; the same messages, so a refusal reads the same whichever door it
 * came through. They are copies only because bookings.service.ts is outside
 * this packet's write set (V1-28 holds it): folding BookingsService's private
 * pair onto these is the follow-up. booking-slot-writers.integration.test.ts
 * pins the parity (message against BookingsService's own refusal; lock against
 * a claim holding BookingsService's key; a race of all four doors).
 */
const BOOKING_SLOT_LOCK_NAMESPACE = 'booking-slot:';
const BOOKING_SLOT_CLAIM_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const SLOT_RELEASING_BOOKING_STATUSES = ['CANCELLED', 'NO_SHOW'];

/** A booking's claim on a calendar: the resource (staff member, else service) and the window. */
export interface BookingSlotClaim {
  businessId: string;
  serviceId: string;
  staffId?: string | null;
  start: Date;
  end: Date;
  bufferMins?: number | null;
  /** The booking being moved or reinstated, which does not block itself. */
  excludeBookingId?: string;
}

/** Whether a booking in `status` holds its slot (CANCELLED and NO_SHOW give it back). */
export function bookingHoldsSlot(status: string): boolean {
  return !SLOT_RELEASING_BOOKING_STATUSES.includes(status);
}

/**
 * Run `work` in a transaction holding the slot lock of one calendar: the
 * business and the staff member, else the service (BookingsService.claimSlot's
 * key). Postgres releases it at commit or rollback.
 */
export function withBookingSlotLock<T>(
  client: PrismaClientLike,
  slot: Pick<BookingSlotClaim, 'businessId' | 'serviceId' | 'staffId'>,
  work: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  const key = `${BOOKING_SLOT_LOCK_NAMESPACE}${slot.businessId}:${slot.staffId || slot.serviceId}`;
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return work(tx);
  }, BOOKING_SLOT_CLAIM_TX_OPTIONS);
}

/**
 * BookingsService.createBooking's window rule, with its message: a window that
 * does not move forward cannot be checked for overlap. It belongs to the
 * writers that choose a window (offerSlot's placeholder, a calendar move), not
 * to the shared guard: BookingsService.assertSlotFree has no such check, and a
 * status-only reinstatement of a legacy row whose end is not after its start
 * must stay writable, as BookingsService.updateBookingStatus keeps it (CR-1).
 */
export function assertBookingWindowMovesForward(start: Date, end: Date): void {
  if (!(end.getTime() > start.getTime())) {
    throw new BadRequestException('The end time must be after the start time.');
  }
}

/**
 * BookingsService.assertSlotFree: refuse when a live booking of the same
 * resource overlaps the window widened by the service's buffer. Called with the
 * lock's transaction, so it sees every claim committed before the lock was
 * granted. Like BookingsService's, it does not judge the window itself: the
 * callers that choose one check it first (assertBookingWindowMovesForward).
 */
export async function assertBookingSlotFree(db: Pick<PrismaTx, 'booking'>, slot: BookingSlotClaim): Promise<void> {
  const bufferMins = slot.bufferMins ?? 0;
  const bufferMs = bufferMins * 60000;

  const clash = await db.booking.findFirst({
    where: {
      businessId: slot.businessId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      deletedAt: null,
      startTime: { lt: new Date(slot.end.getTime() + bufferMs) },
      endTime: { gt: new Date(slot.start.getTime() - bufferMs) },
      ...(slot.excludeBookingId ? { id: { not: slot.excludeBookingId } } : {}),
      // Without a staff member the service itself is the resource being
      // consumed; with one, that person is.
      ...(slot.staffId ? { staffId: slot.staffId } : { serviceId: slot.serviceId }),
    },
    select: { id: true },
  });

  if (clash) {
    throw new BadRequestException(
      bufferMins > 0
        ? `This time slot is unavailable due to a ${bufferMins}-minute buffer between appointments.`
        : 'That time slot has already been booked. Please choose another.',
    );
  }
}

/** BookingsService.claimSlot: lock the calendar, check the slot again, write. */
export function claimBookingSlot<T>(
  client: PrismaClientLike,
  slot: BookingSlotClaim,
  write: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  return withBookingSlotLock(client, slot, async (tx) => {
    await assertBookingSlotFree(tx, slot);
    return write(tx);
  });
}

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
 * PR196-WAITLIST-EXPIRY (D-86): an offered slot is held for a fixed 120
 * minutes from offeredAt. There is no public accept link: staff are notified
 * of the offer and its deadline (BookingWaitlistListener) and convert it for
 * the customer. Past the deadline the bookings scheduler expires the offer and
 * moves the slot to the next waiting customer (expireStaleOffers). The
 * deadline is derived, not stored: BookingWaitlistEntry has offeredAt and no
 * offerExpiresAt column.
 */
export const WAITLIST_OFFER_HOLD_MINUTES = 120;
const WAITLIST_OFFER_HOLD_MS = WAITLIST_OFFER_HOLD_MINUTES * 60_000;
/** Offers read per expiry pass; the rest wait for the next 5-minute tick. */
const WAITLIST_EXPIRY_BATCH = 100;
/** Waiting entries tried, in FIFO order, when a freed slot is offered on. */
const WAITLIST_CASCADE_CANDIDATES = 3;

/** The moment an offer made at `offeredAt` stops holding its slot. */
export function waitlistOfferExpiresAt(offeredAt: Date | string): Date {
  return new Date(new Date(offeredAt).getTime() + WAITLIST_OFFER_HOLD_MS);
}

export interface WaitlistExpiryResult {
  /** Offers this pass moved from OFFERED to EXPIRED. */
  expired: number;
  /** Freed slots this pass offered to the next waiting entry. */
  cascaded: number;
  /** Entries whose expiry threw; each rolled back and is retried next pass. */
  failed: number;
}

/** Prisma's "no row matched": an update whose where (a compare-and-set) lost. */
function isRecordNotFound(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2025';
}

function contactLabel(
  contact?: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null,
): string {
  if (!contact) return '';
  return contact.displayName?.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
}

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
 * `booking.waitlist.slot_offered` (BookingWaitlistListener notifies staff,
 * D-86). An offer holds its slot for WAITLIST_OFFER_HOLD_MINUTES, after which
 * expireStaleOffers gives the slot to the next waiting entry.
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
   *
   * `actorType` (review SEC-WX-1): left out, the offer is the request's, as
   * BookingsService.requestActor records a write: the member the
   * TenantInterceptor bound for this business, else SYSTEM (offerActor). KEY's
   * bookings_offer_waitlist_slot passes nothing, so a member's KEY offer is
   * theirs, and on the staff bridge or a monitor (no member bound) it is the
   * SYSTEM's. An offer the system makes on its own (the expiry cascade, the
   * booking.cancelled listener) passes 'SYSTEM', even inside a member's request.
   */
  async offerSlot(entryId: string, slot: FreedSlot, actorType: 'SYSTEM' | 'USER' = 'USER') {
    const entry = await this.prisma.client.bookingWaitlistEntry.findFirst({
      where: { id: entryId, deletedAt: null },
      include: {
        business: { select: { id: true, timezone: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true, duration: true, bufferMins: true } },
        preferredStaff: { select: { id: true, name: true } },
      },
    });

    if (!entry) throw new NotFoundException('Waitlist entry not found');
    if (entry.status !== WAITLIST_STATUSES.WAITING) {
      throw new BadRequestException(`Cannot offer slot to entry with status ${entry.status}`);
    }

    const businessId = entry.businessId;
    const staffId = entry.preferredStaffId ?? slot.staffId ?? null;

    // V1-27: the placeholder holds the slot (UNCONFIRMED does not give it
    // back), so writing it is a claim like any create: a freed slot booked
    // again before the offer, or an occupied one handed in by the REST route
    // or KEY, is refused with the overlap message and nothing is written.
    const startTime = new Date(slot.startTime);
    const endTime = new Date(slot.endTime);
    // The placeholder is a create, so it keeps the in-app create's window rule
    // (checked here, before the claim, as BookingsService.createBooking does).
    assertBookingWindowMovesForward(startTime, endTime);
    const offeredAt = new Date();
    const { placeholder, updated } = await claimBookingSlot(
      this.prisma.client,
      {
        businessId,
        serviceId: entry.serviceId,
        staffId,
        start: startTime,
        end: endTime,
        bufferMins: entry.service?.bufferMins,
      },
      async (tx) => {
        const created = await tx.booking.create({
          data: {
            businessId,
            contactId: entry.contactId,
            serviceId: entry.serviceId,
            staffId,
            startTime,
            endTime,
            status: 'UNCONFIRMED',
            notes: entry.notes ? `Waitlist request: ${entry.notes}` : 'Hold for waitlisted contact',
          },
          include: {
            contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
            service: { select: { id: true, name: true } },
            staff: { select: { id: true, name: true } },
          },
        });
        // PR196-WAITLIST-EXPIRY: WAITING -> OFFERED is a compare-and-set in
        // the claim's transaction. Two offers of one entry (a manual or KEY
        // offer, the booking.cancelled listener, an expiry cascade) could both
        // pass the WAITING read above and each write a placeholder; the entry
        // then named only the last, and the other held its slot with nothing
        // left to expire it. The loser now rolls its placeholder back.
        try {
          const offeredEntry = await tx.bookingWaitlistEntry.update({
            where: { id: entryId, businessId, status: WAITLIST_STATUSES.WAITING, deletedAt: null },
            data: {
              status: WAITLIST_STATUSES.OFFERED,
              offeredBookingId: created.id,
              offeredAt,
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
          return { placeholder: created, updated: offeredEntry };
        } catch (err) {
          if (isRecordNotFound(err)) {
            throw new BadRequestException('Cannot offer slot to entry that is no longer WAITING');
          }
          throw err;
        }
      },
    );

    // D-86: the hold's deadline travels with the offer, for the staff
    // notification and the timeline (BookingWaitlistListener).
    const offerExpiresAt = waitlistOfferExpiresAt(updated.offeredAt ?? offeredAt);
    this.events.emit('booking.waitlist.slot_offered', {
      entry: updated,
      booking: placeholder,
      businessId,
      ...this.offerActor(businessId, actorType),
      offerExpiresAt,
      timeZone: entry.business?.timezone ?? null,
    });

    return { entry: updated, booking: placeholder, offerExpiresAt };
  }

  /**
   * F1-D5: the actor an offer is recorded under. A USER offer names the member
   * the TenantInterceptor bound for this business (the staff route, KEY); with no
   * request bound to this business it is the SYSTEM's, never a nameless USER
   * (BookingsService.requestActor's rule).
   */
  private offerActor(
    businessId: string,
    actorType: 'SYSTEM' | 'USER',
  ): { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' } {
    if (actorType !== 'USER') return { actorType: 'SYSTEM' };
    const context = getTenantContext();
    const actorId = context?.businessId === businessId ? context.userId : undefined;
    return actorId ? { actorType: 'USER', actorId } : { actorType: 'SYSTEM' };
  }

  /**
   * Accept an offered slot: confirm the placeholder booking and mark the
   * waitlist entry CONVERTED.
   *
   * V1-27 (CR-2): confirming the placeholder is a slot claim when it no longer
   * holds its slot. Staff can cancel the placeholder (it is an ordinary
   * booking) and the slot can be booked again through a guarded create; the
   * convert then brought the CANCELLED placeholder back onto the occupied slot
   * by id, a second live booking (what V1-16 closed for writeBookingStatus).
   * It now runs under the calendar's slot lock and reads the placeholder again
   * inside it: one that still holds its slot keeps it (no overlap re-read, so
   * legacy overlaps stay convertible, as writeBookingStatus keeps them); one
   * that gave it back is checked with the shared guard, excluding itself, and
   * is refused with its message, writing nothing.
   */
  async convertWaitlistEntry(businessId: string, entryId: string) {
    const entry = await this.prisma.client.bookingWaitlistEntry.findFirst({
      where: { id: entryId, businessId, deletedAt: null },
      include: { offeredBooking: true },
    });

    if (!entry) throw new NotFoundException('Waitlist entry not found');
    // offeredBooking is set exactly when offeredBookingId is (the relation is
    // ON DELETE SET NULL); the placeholder names the calendar to lock.
    const offered = entry.offeredBooking;
    if (entry.status !== WAITLIST_STATUSES.OFFERED || !entry.offeredBookingId || !offered) {
      throw new BadRequestException('Waitlist entry has no offered slot to convert');
    }
    const placeholderId = offered.id;
    const resource = { businessId: offered.businessId, serviceId: offered.serviceId, staffId: offered.staffId };

    const [convertedEntry, confirmedBooking] = await withBookingSlotLock(this.prisma.client, resource, async (tx) => {
      // PR196-WAITLIST-EXPIRY (F1-D1): the conversion is a compare-and-set,
      // taken first under the lock: the entry must still be OFFERED with this
      // placeholder. The status checked above was read before the lock; an
      // expiry that committed since (EXPIRED, its hold CANCELLED, the slot
      // perhaps offered on) is refused here and nothing is written, instead of
      // CONVERTED overwriting EXPIRED and the cancelled hold being confirmed.
      let convertedEntryRow;
      try {
        convertedEntryRow = await tx.bookingWaitlistEntry.update({
          where: {
            id: entryId,
            businessId,
            status: WAITLIST_STATUSES.OFFERED,
            offeredBookingId: placeholderId,
            deletedAt: null,
          },
          data: {
            status: WAITLIST_STATUSES.CONVERTED,
            convertedAt: new Date(),
          },
        });
      } catch (err) {
        if (isRecordNotFound(err)) throw new BadRequestException('Waitlist entry has no offered slot to convert');
        throw err;
      }
      const current = await tx.booking.findFirst({
        where: { id: placeholderId, businessId },
        select: { status: true, startTime: true, endTime: true, serviceId: true, staffId: true, deletedAt: true },
      });
      if (current && !current.deletedAt && !bookingHoldsSlot(current.status)) {
        const service = await tx.service.findUnique({
          where: { id: current.serviceId },
          select: { bufferMins: true },
        });
        await assertBookingSlotFree(tx, {
          businessId: resource.businessId,
          serviceId: current.serviceId,
          staffId: current.staffId,
          start: current.startTime,
          end: current.endTime,
          bufferMins: service?.bufferMins,
          excludeBookingId: placeholderId,
        });
      }
      const confirmedBookingRow = await tx.booking.update({
        where: { id: placeholderId, businessId },
        data: { status: 'CONFIRMED' },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true } },
          staff: { select: { id: true, name: true } },
        },
      });
      return [convertedEntryRow, confirmedBookingRow] as const;
    });

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
   * PR196-WAITLIST-EXPIRY (D-86): expire the offers whose fixed 120-minute
   * hold has run out, give back their slot and offer it to the next waiting
   * entry. Run by the bookings scheduler (BookingsService.onModuleInit, behind
   * schedulersDisabled(), F1-D3); `businessId` narrows a pass to one tenant.
   *
   * Each offer is expired on its own (expireOffer), and a failure is logged
   * and counted without stopping the pass (F1-D6): its transaction rolls back,
   * so the entry is still OFFERED and the next pass retries it.
   */
  async expireStaleOffers(opts: { businessId?: string } = {}): Promise<WaitlistExpiryResult> {
    const cutoff = new Date(Date.now() - WAITLIST_OFFER_HOLD_MS);
    const stale = await this.prisma.client.bookingWaitlistEntry.findMany({
      where: {
        status: WAITLIST_STATUSES.OFFERED,
        deletedAt: null,
        offeredAt: { lte: cutoff },
        ...(opts.businessId ? { businessId: opts.businessId } : {}),
      },
      orderBy: [{ offeredAt: 'asc' }],
      take: WAITLIST_EXPIRY_BATCH,
      select: {
        id: true,
        businessId: true,
        contactId: true,
        serviceId: true,
        offeredBookingId: true,
        contact: { select: { firstName: true, lastName: true, displayName: true } },
        service: { select: { name: true } },
        business: { select: { timezone: true } },
        offeredBooking: {
          select: { id: true, businessId: true, serviceId: true, staffId: true, startTime: true, endTime: true },
        },
      },
    });

    const result: WaitlistExpiryResult = { expired: 0, cascaded: 0, failed: 0 };
    for (const entry of stale) {
      try {
        const outcome = await this.expireOffer(entry, cutoff);
        if (outcome.expired) result.expired += 1;
        if (outcome.cascadedToEntryId) result.cascaded += 1;
      } catch (err) {
        result.failed += 1;
        this.logger.error(
          `Waitlist offer expiry failed for entry ${entry.id} (business ${entry.businessId}); it stays OFFERED for the next pass: ${(err as Error).message}`,
        );
      }
    }
    if (result.expired > 0 || result.failed > 0) {
      this.logger.log(
        `Waitlist expiry: ${result.expired} expired, ${result.cascaded} offered on, ${result.failed} failed`,
      );
    }
    return result;
  }

  /**
   * Expire one offer. Under the V1-27 slot lock of the placeholder's calendar
   * (the lock offerSlot, convertWaitlistEntry and every booking create take):
   *   1. claim the entry with a compare-and-set: still OFFERED, with this
   *      placeholder, offered at or before the cutoff, in its business. A lost
   *      claim (converted, cancelled, already expired by another pass or
   *      replica) writes nothing and moves nothing (F1-D1);
   *   2. release the hold only while it is still the UNCONFIRMED placeholder
   *      on the slot it was offered (another compare-and-set). A hold staff
   *      confirmed, cancelled, moved or deleted is left as it is (F1-D2).
   * After the commit, and only when this run released the hold of a slot that
   * has not started, the slot is offered to the next waiting entry (offerSlot,
   * which claims it again, so a slot booked in the meantime is refused). The
   * placeholder is cancelled by a direct write, not BookingsService's status
   * path: a booking.cancelled event would offer the slot a second time
   * (BookingWaitlistListener) and send the customer a cancellation of an
   * appointment they never had.
   */
  private async expireOffer(
    entry: {
      id: string;
      businessId: string;
      contactId: string;
      serviceId: string;
      offeredBookingId: string | null;
      contact: { firstName: string | null; lastName: string | null; displayName: string | null } | null;
      service: { name: string } | null;
      business: { timezone: string } | null;
      offeredBooking: {
        id: string;
        businessId: string;
        serviceId: string;
        staffId: string | null;
        startTime: Date;
        endTime: Date;
      } | null;
    },
    cutoff: Date,
  ): Promise<{ expired: boolean; cascadedToEntryId: string | null }> {
    const businessId = entry.businessId;
    const claim = {
      id: entry.id,
      businessId,
      status: WAITLIST_STATUSES.OFFERED,
      offeredBookingId: entry.offeredBookingId,
      offeredAt: { lte: cutoff },
      deletedAt: null,
    };
    // A placeholder of another business is never touched (tenant binding);
    // with none left (deleted, offeredBookingId set null) no slot is held.
    const hold = entry.offeredBooking && entry.offeredBooking.businessId === businessId ? entry.offeredBooking : null;

    let released = false;
    if (hold) {
      const outcome = await withBookingSlotLock(
        this.prisma.client,
        { businessId, serviceId: hold.serviceId, staffId: hold.staffId },
        async (tx) => {
          const claimed = await tx.bookingWaitlistEntry.updateMany({
            where: claim,
            data: { status: WAITLIST_STATUSES.EXPIRED },
          });
          if (claimed.count !== 1) return null;
          const freed = await tx.booking.updateMany({
            where: {
              id: hold.id,
              businessId,
              status: 'UNCONFIRMED',
              deletedAt: null,
              staffId: hold.staffId,
              startTime: hold.startTime,
              endTime: hold.endTime,
            },
            data: { status: 'CANCELLED' },
          });
          return { released: freed.count === 1 };
        },
      );
      if (!outcome) return { expired: false, cascadedToEntryId: null };
      released = outcome.released;
    } else {
      const claimed = await this.prisma.client.bookingWaitlistEntry.updateMany({
        where: claim,
        data: { status: WAITLIST_STATUSES.EXPIRED },
      });
      if (claimed.count !== 1) return { expired: false, cascadedToEntryId: null };
    }

    let cascadedToEntryId: string | null = null;
    if (hold && released && new Date(hold.startTime).getTime() > Date.now()) {
      cascadedToEntryId = await this.offerFreedSlot(businessId, entry.id, {
        startTime: new Date(hold.startTime),
        endTime: new Date(hold.endTime),
        serviceId: hold.serviceId,
        staffId: hold.staffId,
      });
    }

    this.events.emit('booking.waitlist.offer_expired', {
      businessId,
      entry: { id: entry.id, contactId: entry.contactId, serviceId: entry.serviceId },
      bookingId: hold?.id ?? null,
      released,
      cascadedToEntryId,
      startTime: hold?.startTime ?? null,
      endTime: hold?.endTime ?? null,
      contactName: contactLabel(entry.contact),
      serviceName: entry.service?.name ?? null,
      timeZone: entry.business?.timezone ?? null,
      actorType: 'SYSTEM',
    });

    return { expired: true, cascadedToEntryId };
  }

  /**
   * Offer a slot an expiry released to the oldest matching waiting entry, with
   * a fresh 120-minute hold. A refused offer (the entry was offered elsewhere
   * meanwhile, or the slot was booked) is logged and the next candidate is
   * tried; nothing here throws into the expiry pass (F1-D6).
   */
  private async offerFreedSlot(businessId: string, expiredEntryId: string, slot: FreedSlot): Promise<string | null> {
    let candidates: Array<{ id: string }>;
    try {
      candidates = await this.findWaitlistMatchesForSlot(businessId, slot, {
        limit: WAITLIST_CASCADE_CANDIDATES,
        excludeEntryIds: [expiredEntryId],
      });
    } catch (err) {
      this.logger.error(
        `Waitlist expiry could not look for the next entry for business ${businessId}, slot ${slot.startTime.toISOString()}: ${(err as Error).message}`,
      );
      return null;
    }
    for (const candidate of candidates) {
      try {
        await this.offerSlot(candidate.id, slot, 'SYSTEM');
        return candidate.id;
      } catch (err) {
        this.logger.warn(
          `Waitlist expiry could not offer slot ${slot.startTime.toISOString()} to entry ${candidate.id} (business ${businessId}): ${(err as Error).message}`,
        );
      }
    }
    return null;
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
