import { BadRequestException, NotFoundException, ForbiddenException, HttpException, Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Booking, BookingStatus, Invoice, Prisma } from '@prisma/client';
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
import { contactWhereWithId } from '../crm/crm.helpers';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { CommerceService } from '../commerce/commerce.service';
import { RevenueAttributionService } from '../commerce/revenue-attribution.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { PublicEventsService } from '../public-events/public-events.service';
import { TimelineService } from '../timeline/timeline.service';
import { schedulersDisabled } from '../../core/config/env';
import { getTenantContext } from '../../core/tenant/tenant-context';
import {
  depositPosition,
  derivePaymentStatus,
  readSettlementInvoices,
  settlementInvoiceSelect,
  toCents,
} from './booking-payment-status.listener';

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

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/** A booking's claim on a calendar: what assertSlotFree compares and claimSlot locks. */
type SlotParams = {
  businessId: string;
  serviceId: string;
  staffId?: string | null;
  start: Date;
  end: Date;
  bufferMins?: number | null;
  excludeBookingId?: string;
};

/**
 * V1-16 (M41): the slot claim's advisory lock. One transaction-scoped lock per
 * business and resource (the staff member, else the service: exactly what
 * assertSlotFree compares), so claims on one calendar commit one after another
 * and claims on different calendars do not wait for each other. Transaction
 * scoped because the pooler runs in transaction mode: Postgres releases it at
 * commit or rollback, on whichever connection the transaction had.
 */
const SLOT_LOCK_NAMESPACE = 'booking-slot:';
const SLOT_CLAIM_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** Statuses that give the slot back: the ones assertSlotFree's `notIn` does not count. */
const SLOT_RELEASING_STATUSES: BookingStatus[] = ['CANCELLED', 'NO_SHOW'];
const holdsSlot = (status: BookingStatus) => !SLOT_RELEASING_STATUSES.includes(status);

/** What a status write needs to know about the booking to decide whether it claims a slot. */
type StatusWriteTarget = Pick<Booking, 'id' | 'businessId' | 'serviceId' | 'staffId' | 'startTime' | 'endTime' | 'status'>;

/**
 * V1-28 (M42): the statuses a paid invoice confirms. Both hold the slot, as
 * CONFIRMED does, so the move is a conditional update and never a claim.
 */
const AWAITING_CONFIRMATION: BookingStatus[] = ['PENDING', 'UNCONFIRMED'];

/**
 * V1-28 (CF-43): one booking's final invoice is drawn up under this lock, so
 * two completions (or a completion and the Create-invoice button) racing for
 * it draw up one; the second waits and finds it.
 */
const FINAL_INVOICE_LOCK_NAMESPACE = 'booking-final-invoice:';

/** D-26: Booking.paymentStatus once a customer cancel has forfeited a paid deposit. */
const DEPOSIT_FORFEITED = 'DEPOSIT_FORFEITED';

/** The completion answer's code for an invoice that was not drawn up (V1-28 review, SEC-V28-1). */
export const INVOICE_NOT_CREATED = 'INVOICE_NOT_CREATED';

/**
 * V1-28 review (SEC-V28-1): the invoiceError an operator reads, at the level
 * GlobalHttpExceptionFilter would answer the same failure: a 4xx
 * HttpException's own message (a refusal meant for the caller); anything else
 * (a database or programming error, whose text carries server paths, source
 * excerpts and column names) a fixed sentence. The detail is logged.
 */
function completionInvoiceError(err: unknown): string {
  const lead = 'The booking is completed, but its invoice could not be created';
  if (err instanceof HttpException && err.getStatus() < 500 && err.message) return `${lead}: ${err.message}`;
  return `${lead}. Use Create invoice on the booking to try again.`;
}

/**
 * V1-28 (CF-43): what drawing up a booking's final invoice did. The final
 * invoice bills the price LESS what the booking's live deposit invoice (not
 * VOID, not deleted) covers of it (depositPosition): an unpaid deposit is
 * still owed on its own invoice and covers what it bills, a PAID one covers
 * the money it holds (less refunds), and a credited one only what it still
 * bills; so deposit + final == price. NOT_REQUIRED: nothing is owed beyond
 * the deposit, or there is nothing to bill (free service, no contact).
 */
export type FinalInvoiceOutcome =
  | {
      status: 'CREATED' | 'EXISTING';
      invoiceId: string;
      invoiceNumber: string | null;
      amount: number;
      depositInvoiceId: string | null;
      depositAmount: number;
    }
  | { status: 'NOT_REQUIRED'; invoiceId: null; reason: string; depositInvoiceId: string | null; depositAmount: number };

/** The completion response's invoicing outcome: FAILED is explicit, never swallowed (V1-28), and never the raw error text. */
export type CompletionInvoicing =
  | FinalInvoiceOutcome
  | { status: 'FAILED'; invoiceId: null; code: typeof INVOICE_NOT_CREATED; error: string };

/** D-26: the forfeit recorded on a booking cancelled after its deposit was paid. */
export interface DepositForfeit {
  depositInvoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
}

/** An instant as a wall clock reads it: calendar day, weekday (0 = Sunday), minutes past midnight. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutes: number;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const wallClockFormats = new Map<string, Intl.DateTimeFormat>();

/** Throws RangeError for a zone this runtime does not know. */
function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = wallClockFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    wallClockFormats.set(timeZone, format);
  }
  return format;
}

/**
 * V1-16 (CF-44): `instant` on the business's clock. Opening hours and staff
 * hours are wall-clock times in Business.timezone; they were read with
 * getHours/getDay, the SERVER's clock, which in production (TZ unset) is UTC,
 * so a UTC-4 business's 13:00-17:00 was refused. No zone means the server's,
 * as before, through the same Date getters.
 */
function wallClock(instant: Date, timeZone: string | undefined): WallClock {
  if (!timeZone) {
    return {
      year: instant.getFullYear(),
      month: instant.getMonth() + 1,
      day: instant.getDate(),
      weekday: instant.getDay(),
      minutes: instant.getHours() * 60 + instant.getMinutes(),
    };
  }
  const parts: Record<string, string> = {};
  for (const part of wallClockFormat(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_NAMES.indexOf(parts.weekday),
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

/**
 * The instant at which the business's clock reads `minutes` past midnight on
 * year-month-day: the UTC reading shifted by the zone's offset, taken twice so
 * a day that changes offset (DST) lands on the offset in force at that time.
 */
function zonedInstant(year: number, month: number, day: number, minutes: number, timeZone: string | undefined): Date {
  if (!timeZone) return new Date(year, month - 1, day, 0, minutes);
  const asUtc = Date.UTC(year, month - 1, day, 0, minutes);
  const offsetAt = (ms: number) => {
    const clock = wallClock(new Date(ms), timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, 0, clock.minutes) - (ms - (ms % 60_000));
  };
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
}

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private reminderInterval: ReturnType<typeof setInterval> | null = null;
  private emailWarnedBusinesses = new Set<string>();
  private warnedZones = new Set<string>();

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
    if (schedulersDisabled()) {
      this.logger.log('Scheduler disabled (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
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
    // V1-16: back from CANCELLED or NO_SHOW, the booking takes its slot again,
    // through the claim (writeBookingStatus).
    const updated = await this.writeBookingStatus(booking, status, (db, where) =>
      db.booking.update({
        where,
        data: { status },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          service: { select: { id: true, name: true, duration: true, price: true } },
          staff: { select: { id: true, name: true } },
        },
      }),
    );

    // D-26: a cancel after the deposit was paid forfeits it, recorded on the
    // booking. A booking brought back from CANCELLED takes the status its
    // invoices state again (V1-28 review, SEC-V28-3): DEPOSIT_PAID only while
    // the deposit still holds money; one refunded meanwhile leaves UNPAID.
    // Trial-N (N2-SEC): the reinstatement is read from the row as written, not
    // from the status read before the write: a cancel that committed between
    // that read and this write (its forfeit included) left a live booking
    // DEPOSIT_FORFEITED, which no invoice.paid could advance. It is written
    // only while the booking is still not CANCELLED.
    let depositForfeit: DepositForfeit | null = null;
    if (status === 'CANCELLED') {
      depositForfeit = await this.forfeitPaidDeposit(businessId, booking);
      if (depositForfeit) updated.paymentStatus = DEPOSIT_FORFEITED;
    } else if (updated.paymentStatus === DEPOSIT_FORFEITED) {
      const reinstated = derivePaymentStatus(await readSettlementInvoices(this.prisma, businessId, updated));
      const restored = await this.prisma.client.booking.updateMany({
        where: { id: booking.id, businessId, paymentStatus: DEPOSIT_FORFEITED, status: { not: 'CANCELLED' } },
        data: { paymentStatus: reinstated },
      });
      if (restored.count > 0) updated.paymentStatus = reinstated;
    }

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

    // V1-28 (CF-43): the invoicing outcome is part of the completion answer.
    // A failure leaves the booking COMPLETED and says so (invoiceError); it
    // was logged and swallowed, so the operator could not tell an invoiced
    // booking from one that was not.
    let invoicing: CompletionInvoicing | null = null;
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
      invoicing = await this.autoGenerateInvoiceForCompletedBooking(updated, businessId);
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

    if (invoicing) {
      return {
        ...updated,
        invoiceId: invoicing.invoiceId ?? updated.invoiceId,
        invoicing,
        invoiceError: invoicing.status === 'FAILED' ? invoicing.error : null,
        invoiceErrorCode: invoicing.status === 'FAILED' ? invoicing.code : null,
      };
    }
    if (status === 'CANCELLED') return { ...updated, depositForfeit };
    return updated;
  }

  /**
   * D-26: a deposit is forfeit when the customer cancels after paying it. The
   * forfeit is recorded on the booking (paymentStatus DEPOSIT_FORFEITED) and
   * on the contact's timeline; nothing moves automatically: the deposit
   * invoice keeps its status, and no refund, credit note or posting is
   * written. The owner may refund it by hand through the refund path (a
   * negative refund row, D-14). What was paid is read from the live deposit
   * invoice in the table, not from Booking.paymentStatus, so a booking whose
   * paymentStatus was never written (before V1-28) is covered too.
   * Cancelling again records nothing new.
   *
   * V1-28 review: what is forfeit is the money the live deposit (not VOID,
   * not deleted) holds, by the rule the booking's status is derived from
   * (depositPosition): all of a PAID deposit nothing was refunded on, the net
   * received on one that was refunded, whether D-14 left it PAID or reopened
   * it to PARTIALLY_PAID or SENT, and nothing on a deposit still owed. So a
   * deposit refunded in full forfeits nothing, and one refunded in part
   * forfeits what it still holds. The timeline row names who cancelled (SEC-V28-2): the authenticated member
   * whose request this is (TenantInterceptor's context for this business), or
   * SYSTEM for a caller with none (a KEY tool, undo or compensation run
   * outside a member's request); it claimed USER with no actor.
   *
   * Trial-N (N2-SEC): the forfeit is written only while the booking is still
   * CANCELLED. A reinstatement that committed between the cancel's status
   * write and this one left a live booking DEPOSIT_FORFEITED; now nothing is
   * forfeit on it. The deposit's payment rows are its own tenant's (N1-SEC).
   */
  private async forfeitPaidDeposit(
    businessId: string,
    booking: Pick<Booking, 'id' | 'contactId' | 'depositInvoiceId'>,
  ): Promise<DepositForfeit | null> {
    if (!booking.depositInvoiceId) return null;
    const deposit = await this.prisma.client.invoice.findFirst({
      where: { id: booking.depositInvoiceId, businessId, deletedAt: null, status: { not: 'VOID' } },
      select: settlementInvoiceSelect(businessId),
    });
    if (!deposit) return null;
    const { heldCents } = depositPosition(deposit);
    if (heldCents <= 0) return null;
    const forfeit: DepositForfeit = {
      depositInvoiceId: deposit.id,
      invoiceNumber: deposit.invoiceNumber,
      amount: heldCents / 100,
      currency: deposit.currency,
    };
    const recorded = await this.prisma.client.booking.updateMany({
      where: { id: booking.id, businessId, status: 'CANCELLED', paymentStatus: { in: ['UNPAID', 'DEPOSIT_PAID'] } },
      data: { paymentStatus: DEPOSIT_FORFEITED },
    });
    if (recorded.count === 0) {
      const current = await this.prisma.client.booking.findUnique({ where: { id: booking.id }, select: { status: true, paymentStatus: true } });
      return current?.status === 'CANCELLED' && current.paymentStatus === DEPOSIT_FORFEITED ? forfeit : null;
    }
    if (booking.contactId) {
      await this.crm.logContactEvent({
        businessId,
        contactId: booking.contactId,
        type: 'booking.deposit_forfeited',
        data: { bookingId: booking.id, ...forfeit },
        ...this.requestActor(businessId),
        source: 'bookings',
      });
    }
    return forfeit;
  }

  /**
   * The actor of a write made on a member's request: the authenticated user
   * TenantInterceptor bound for this business; with no request context, or
   * one for another business, SYSTEM (the crm-import convention).
   */
  private requestActor(businessId: string): { actorType: 'USER'; actorId: string } | { actorType: 'SYSTEM' } {
    const context = getTenantContext();
    const actorId = context?.businessId === businessId ? context.userId : undefined;
    return actorId ? { actorType: 'USER', actorId } : { actorType: 'SYSTEM' };
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
      select: { id: true },
    });
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }
    // V1-28 (CF-43): the same final invoice completion draws up, net of the
    // deposit; it billed the full price again.
    const outcome = await this.issueFinalInvoice(businessId, bookingId);
    if (outcome.status === 'NOT_REQUIRED') {
      throw new BadRequestException(outcome.reason);
    }
    return {
      invoiceId: outcome.invoiceId,
      invoiceNumber: outcome.invoiceNumber,
      alreadyExisted: outcome.status === 'EXISTING',
      amount: outcome.amount,
      depositInvoiceId: outcome.depositInvoiceId,
    };
  }

  /**
   * V1-28 (CF-43): the booking's final invoice, drawn up once. It bills the
   * service price less the booking's live deposit invoice (integer cents,
   * D-13), and its line names the deposit invoice, so deposit + final ==
   * price; it billed the full price again, so a 100 service with a 25 deposit
   * was billed 125. A deposit that covers the price leaves nothing to bill.
   *
   * Under the booking's advisory lock: the booking is re-read inside it, so of
   * two callers racing (two completions, or a completion and the Create-invoice
   * button) one draws the invoice up and the other finds it. The invoice is
   * created through CommerceService (its own connection, committed); if the
   * link to the booking then fails, that DRAFT is withdrawn. A number
   * collision is retried by CommerceService's allocator (V1-43, SEC-V28-1).
   */
  private async issueFinalInvoice(businessId: string, bookingId: string): Promise<FinalInvoiceOutcome> {
    const key = `${FINAL_INVOICE_LOCK_NAMESPACE}${bookingId}`;
    // Assigned inside the transaction callback; declared through a cast so
    // the compiler does not narrow them to their initial undefined.
    let drawn = undefined as string | undefined;
    let created = undefined as { invoice: Invoice; booking: Booking } | undefined;
    let outcome: FinalInvoiceOutcome;
    try {
      outcome = await this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const booking = await tx.booking.findFirst({ where: { id: bookingId, businessId, deletedAt: null } });
        if (!booking) throw new NotFoundException('Booking not found');
        const live = booking.depositInvoiceId
          ? await tx.invoice.findFirst({
              where: { id: booking.depositInvoiceId, businessId, deletedAt: null, status: { not: 'VOID' } },
              select: settlementInvoiceSelect(businessId),
            })
          : null;
        // V1-28 review (SEC-V28-3, CR-V28-2): the deposit nets out what it
        // covers of the price, not its face total: a refunded deposit holds
        // nothing and a credited one bills less (depositPosition).
        const depositCents = live ? depositPosition(live).coversCents : 0;
        const deposit = depositCents > 0 ? live : null;
        const depositPart = { depositInvoiceId: deposit?.id ?? null, depositAmount: depositCents / 100 };

        if (booking.invoiceId) {
          const existing = await tx.invoice.findFirst({
            where: { id: booking.invoiceId, businessId },
            select: { id: true, invoiceNumber: true, total: true },
          });
          if (existing) {
            return {
              status: 'EXISTING' as const,
              invoiceId: existing.id,
              invoiceNumber: existing.invoiceNumber,
              amount: toCents(existing.total) / 100,
              ...depositPart,
            };
          }
        }
        const notRequired = (reason: string): FinalInvoiceOutcome => ({ status: 'NOT_REQUIRED', invoiceId: null, reason, ...depositPart });
        if (!booking.contactId || !booking.serviceId) return notRequired('Booking is missing a contact or service');
        const service = await tx.service.findFirst({ where: { id: booking.serviceId, businessId, deletedAt: null } });
        if (!service) return notRequired('Booking is missing a contact or service');
        if ((service.price ?? 0) <= 0) return notRequired('Service has no price configured');
        const finalCents = toCents(service.price) - depositCents;
        if (finalCents <= 0) return notRequired('The deposit covers the price; there is no balance to invoice');

        const amount = finalCents / 100;
        const contactId = booking.contactId;
        const options = deposit
          ? { kind: 'FULL' as const, amountOverride: amount, descriptionSuffix: ` (balance after deposit ${deposit.invoiceNumber})` }
          : undefined;
        // V1-43 (D-15): numbered by CommerceService's allocator, which retries a
        // number collision itself (the SEC-V28-1 retry that lived here).
        const invoice = await this.commerce.createInvoiceForService(businessId, contactId, service, options);
        if (!invoice) throw new BadRequestException('Failed to create invoice');
        drawn = invoice.id;
        await tx.booking.update({ where: { id: booking.id }, data: { invoiceId: invoice.id } });
        created = { invoice, booking: { ...booking, invoiceId: invoice.id } };
        return {
          status: 'CREATED' as const,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amount,
          ...depositPart,
        };
      }, SLOT_CLAIM_TX_OPTIONS);
    } catch (err) {
      await this.withdrawDraftInvoices(businessId, [drawn]);
      throw err;
    }
    if (created) {
      // Single source of truth: RevenueEventListener subscribes to
      // `booking.invoice_created` and writes the canonical
      // `invoice.from_booking` row on the contact timeline. Do NOT also
      // call this.crm.logContactEvent here — that would bypass the bus
      // and risk duplicate timeline rows.
      const payload: BookingInvoiceCreatedPayload = { ...created, businessId };
      this.events.emit('booking.invoice_created', payload);
    }
    return outcome;
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

  /**
   * The one overlap check, used by every path that puts a booking on a calendar.
   *
   * There were two copies of this and a third path with none. Both copies sat
   * inside `if (service.bufferMins > 0)`, and `bufferMins` is `Int?` with no
   * default, so for any service nobody had configured neither ran — reproduced
   * live: two public requests for the same slot, seconds apart, both 201.
   *
   * That is fixed, and this exists so the fix cannot rot back. Three entry
   * points create or move a booking:
   *
   *   publicCreateBooking   the customer-facing widget
   *   rescheduleBooking     moving an existing one
   *   createBooking         staff booking from inside the app
   *
   * The third had NO check of any kind — not overlap, not lead time, nothing.
   * Anyone with app access could double-book a slot the public widget would
   * have refused, which is the more embarrassing direction for it to fail.
   *
   * A zero buffer means "must not overlap". The buffer only widens the window.
   */
  /**
   * The times a customer can actually book.
   *
   * There was no such endpoint. The public booking widget asked people to
   * hand-type an ISO 8601 timestamp into a text box —
   * `<Input label="Start Time (ISO)" placeholder="2025-12-01T15:00:00Z" />` —
   * so the only way to discover a free time was to guess one and submit.
   *
   * That was survivable while the server accepted almost anything. It is not
   * survivable now that overlap is enforced on every path: a customer guesses,
   * gets "that time slot has already been booked", and has no way to find one
   * that is not. Closing the validation hole without this makes the widget
   * worse, not better, which is why it belongs in the same piece of work.
   *
   * THE RULES ARE NOT RE-IMPLEMENTED HERE. Every candidate is put through
   * `assertSlotFree` — the same guard publicCreateBooking, rescheduleBooking
   * and createBooking use. A picker that computes availability its own way is
   * how you get a slot shown as free and rejected on submit, which is the
   * defect class this codebase keeps producing: two sources of truth that
   * agree until they do not.
   *
   * Lead time, business hours and staff working hours are applied the same way
   * the validator applies them, on the same clock: Business.timezone (V1-16).
   */
  async getAvailableSlots(params: {
    businessId: string;
    serviceId: string;
    date: Date;
    staffId?: string;
    slotIntervalMins?: number;
  }): Promise<{ date: string; slots: string[] }> {
    const { businessId, serviceId, staffId } = params;
    const interval = params.slotIntervalMins ?? 30;

    const service = await this.prisma.client.service.findFirst({
      where: { id: serviceId, businessId, deletedAt: null },
      select: { duration: true, bufferMins: true, leadTimeMins: true },
    });
    if (!service) throw new NotFoundException('Service not found');

    // V1-16: the route hands over the day asked for as a server-local midnight,
    // so its calendar date is read back on the server's clock; from there on,
    // the weekday, the hours and every slot are the business's own clock
    // (Business.timezone). The day was a server-local midnight moved with
    // setHours, which shifted the hours by the server's offset and, east of
    // UTC, reported the previous day.
    const year = params.date.getFullYear();
    const month = params.date.getMonth() + 1;
    const dayOfMonth = params.date.getDate();
    const date = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
    const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayKey = dayKeys[weekday];
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { businessHours: true, timezone: true },
    });
    const zone = this.businessZone(business?.timezone);

    // Staff working hours win over business hours when the staff member has
    // any configured, exactly as the booking validator decides it.
    let windows: Array<{ openMin: number; closeMin: number }> = [];
    if (staffId) {
      const availability = await this.prisma.client.availability.findMany({
        where: { staffId, staff: { businessId, deletedAt: null } },
      });
      if (availability.length > 0) {
        windows = availability
          .filter((a) => a.dayOfWeek === weekday)
          .map((a) => {
            const [sh, sm] = a.startTime.split(':').map(Number);
            const [eh, em] = a.endTime.split(':').map(Number);
            return { openMin: sh * 60 + sm, closeMin: eh * 60 + em };
          });
        // Configured, but not for this day: the staff member does not work today.
        if (windows.length === 0) return { date, slots: [] };
      }
    }

    if (windows.length === 0) {
      const hours = business?.businessHours as BusinessHoursMap | null;
      const dayHours = hours?.[dayKey];
      if (!dayHours || dayHours.closed || !dayHours.open || !dayHours.close) {
        return { date, slots: [] };
      }
      const [oh, om] = dayHours.open.split(':').map(Number);
      const [ch, cm] = dayHours.close.split(':').map(Number);
      windows = [{ openMin: oh * 60 + om, closeMin: ch * 60 + cm }];
    }

    const earliest = service.leadTimeMins && service.leadTimeMins > 0
      ? new Date(Date.now() + service.leadTimeMins * 60000)
      : new Date();

    const slots: string[] = [];
    for (const w of windows) {
      for (let m = w.openMin; m + service.duration <= w.closeMin; m += interval) {
        const start = zonedInstant(year, month, dayOfMonth, m, zone);
        // A time the clocks skip that day (DST) is not a time anyone can book.
        if (wallClock(start, zone).minutes !== m) continue;
        const end = new Date(start.getTime() + service.duration * 60000);
        if (start < earliest) continue;

        // The same guard the write paths use. Throws when taken; a throw here
        // means "not offerable", which is the whole question being asked.
        try {
          await this.assertSlotFree({
            businessId,
            serviceId,
            staffId,
            start,
            end,
            bufferMins: service.bufferMins,
          });
          slots.push(start.toISOString());
        } catch {
          // taken — omit it
        }
      }
    }

    return { date, slots };
  }

  /**
   * `db` is the claim's transaction when called from claimSlot (V1-16), so the
   * re-read sees every booking committed before the lock was granted.
   */
  private async assertSlotFree(params: SlotParams, db: Pick<PrismaTx, 'booking'> = this.prisma.client): Promise<void> {
    const bufferMins = params.bufferMins ?? 0;
    const bufferMs = bufferMins * 60000;

    const clash = await db.booking.findFirst({
      where: {
        businessId: params.businessId,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        deletedAt: null,
        startTime: { lt: new Date(params.end.getTime() + bufferMs) },
        endTime: { gt: new Date(params.start.getTime() - bufferMs) },
        ...(params.excludeBookingId ? { id: { not: params.excludeBookingId } } : {}),
        // Without a staff member the service itself is the resource being
        // consumed; with one, that person is.
        ...(params.staffId ? { staffId: params.staffId } : { serviceId: params.serviceId }),
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

  /**
   * V1-16 (M41): the write half of assertSlotFree, and the race it left open.
   *
   * Every path read the slot with assertSlotFree and wrote it several awaits
   * later, so concurrent requests all passed the read before any of them
   * wrote: ten simultaneous public requests for one slot wrote seven bookings
   * (booking-concurrency.integration.test.ts, at the V1-06 head). The callers
   * keep their early read, which refuses a taken slot before contacts,
   * invoices or events are touched; the write goes through here, which takes
   * the calendar's advisory lock, reads again with the same guard inside the
   * transaction and writes, so the second of two claims sees the first. No
   * migration and no constraint: the table already holds overlapping rows.
   */
  private claimSlot<T>(slot: SlotParams, write: (tx: PrismaTx) => Promise<T>): Promise<T> {
    const key = `${SLOT_LOCK_NAMESPACE}${slot.businessId}:${slot.staffId || slot.serviceId}`;
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      await this.assertSlotFree(slot, tx);
      return write(tx);
    }, SLOT_CLAIM_TX_OPTIONS);
  }

  /**
   * V1-16 (SEC-V16-1): a booking's status write, which can take a slot too. A
   * CANCELLED or NO_SHOW booking gave its slot back, and assertSlotFree stops
   * counting it, so moving it to any other status holds the slot again. That is
   * a claim like a create: it goes through claimSlot and is refused with the
   * overlap message when the slot was booked after the cancellation. It was a
   * bare update, which put a second live booking on that slot.
   *
   * A move between two slot-holding statuses keeps the slot the booking already
   * holds: a plain update, no lock, and no overlap re-read, which legacy rows
   * that already overlap would fail. The update is conditional on the booking
   * still holding the slot, so a cancel that lands between the read and this
   * write turns it into a reinstatement, and that goes through the claim. A move
   * to CANCELLED or NO_SHOW gives the slot back and stays a plain update.
   */
  private async writeBookingStatus<T>(
    booking: StatusWriteTarget,
    status: BookingStatus,
    write: (db: Pick<PrismaTx, 'booking'>, where: Prisma.BookingWhereUniqueInput) => Promise<T>,
  ): Promise<T> {
    if (!holdsSlot(status)) return write(this.prisma.client, { id: booking.id });
    if (holdsSlot(booking.status)) {
      try {
        return await write(this.prisma.client, { id: booking.id, status: { notIn: SLOT_RELEASING_STATUSES } });
      } catch (err) {
        // P2025: the booking no longer holds its slot (cancelled meanwhile).
        if ((err as { code?: unknown } | null)?.code !== 'P2025') throw err;
      }
    }
    const service = await this.prisma.client.service.findUnique({
      where: { id: booking.serviceId },
      select: { bufferMins: true },
    });
    const slot: SlotParams = {
      businessId: booking.businessId,
      serviceId: booking.serviceId,
      staffId: booking.staffId,
      start: booking.startTime,
      end: booking.endTime,
      bufferMins: service?.bufferMins,
      excludeBookingId: booking.id,
    };
    return this.claimSlot(slot, (tx) => write(tx, { id: booking.id }));
  }

  /**
   * The zone a business keeps its hours in (V1-16). Business.timezone is an
   * IANA name with a default; a value this runtime cannot read is reported
   * once and the server's zone is used, as it was for every business before.
   */
  private businessZone(timezone: string | null | undefined): string | undefined {
    if (!timezone) return undefined;
    try {
      wallClockFormat(timezone);
      return timezone;
    } catch {
      if (!this.warnedZones.has(timezone)) {
        this.warnedZones.add(timezone);
        this.logger.warn(`Unknown business timezone "${timezone}"; reading business hours in the server's zone.`);
      }
      return undefined;
    }
  }

  /**
   * Invoices drawn up for a public booking whose write then failed, most often
   * because a concurrent claim took the slot (V1-16): DRAFTs nobody was sent,
   * for a booking that does not exist. Soft-deleted so they do not stand as
   * debts in the business's list. Best effort: the caller is already failing
   * with the reason that matters.
   */
  private async withdrawDraftInvoices(businessId: string, ids: Array<string | undefined>): Promise<void> {
    const drawn = ids.filter((id): id is string => !!id);
    if (drawn.length === 0) return;
    try {
      await this.prisma.client.invoice.updateMany({
        where: { id: { in: drawn }, businessId, status: 'DRAFT', deletedAt: null },
        data: { deletedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`Could not withdraw invoices ${drawn.join(', ')} of an unwritten booking: ${(e as Error).message}`);
    }
  }

  /**
   * The service's advance-notice rule, as the public widget has always applied
   * it. publicCreateBooking and createBooking both call this (V1-06), so the
   * in-app path refuses with the same message rather than not at all.
   */
  private assertLeadTime(leadTimeMins: number | null | undefined, start: Date): void {
    if (!leadTimeMins || leadTimeMins <= 0) return;
    const minStart = new Date(Date.now() + leadTimeMins * 60000);
    if (start < minStart) {
      throw new BadRequestException(
        `This service requires at least ${leadTimeMins} minutes advance notice.`,
      );
    }
  }

  /**
   * The optional ids a create writes onto the booking must be live rows of the
   * booking's business; anything else answers like an unknown id (404). Both
   * create paths call this (V1-06 review): the public widget wrote any staffId
   * or orgUnitId it was handed, so an anonymous caller could put another
   * business's staff member or org unit on this business's booking, and its
   * name then showed in this business's booking list and notifications.
   */
  private async assertOwnedRefs(params: {
    businessId: string;
    staffId?: string | null;
    orgUnitId?: string | null;
  }): Promise<void> {
    if (params.staffId) {
      const staff = await this.prisma.client.staffMember.findFirst({
        where: { id: params.staffId, businessId: params.businessId, deletedAt: null },
        select: { id: true },
      });
      if (!staff) throw new NotFoundException('Staff member not found');
    }
    if (params.orgUnitId) {
      const orgUnit = await this.prisma.client.orgUnit.findFirst({
        where: { id: params.orgUnitId, businessId: params.businessId },
        select: { id: true },
      });
      if (!orgUnit) throw new NotFoundException('Org unit not found');
    }
  }

  /**
   * Staff working hours, else business hours: the public path's rules and
   * messages, moved out of publicCreateBooking (V1-06) so createBooking applies
   * the same ones and the two cannot drift apart.
   *
   * A staff member with any availability rows is held to them and business
   * hours are not consulted. Otherwise the day must not be closed, and start
   * through end plus the buffer must fit inside the day's opening hours.
   *
   * Both checks measure the end as start-of-day minutes plus the booking's
   * length, so a booking that runs past midnight (in-app, the client chooses
   * the end) is outside every day's hours rather than judged by the end's time
   * of day alone. A day row without open/close times sets no hours, as in
   * rescheduleBooking. Read on the business's clock, `timeZone` (V1-16): it
   * was the server's, which put a UTC-4 business's afternoon outside its hours.
   */
  private async assertWithinSchedule(params: {
    businessId: string;
    staffId?: string | null;
    hours: BusinessHoursMap | null;
    start: Date;
    end: Date;
    bufferMins?: number | null;
    timeZone?: string;
  }): Promise<void> {
    const { start, end } = params;
    const startClock = wallClock(start, params.timeZone);
    const startMinsOfDay = startClock.minutes;
    const durationMins = Math.round((end.getTime() - start.getTime()) / 60000);
    if (params.staffId) {
      const staffAvailabilities = await this.prisma.client.availability.findMany({
        where: {
          staffId: params.staffId,
          staff: { businessId: params.businessId, deletedAt: null },
        },
      });
      if (staffAvailabilities.length > 0) {
        const dayOfWeek = startClock.weekday;
        const slotAvail = staffAvailabilities.filter((a) => a.dayOfWeek === dayOfWeek);
        if (slotAvail.length === 0) {
          throw new BadRequestException('The selected staff member is not available on this day.');
        }
        // An end at midnight is 1440, as the end's time of day `|| 1440` was.
        const endMinsOfDay = startMinsOfDay + durationMins;
        const withinAny = slotAvail.some((a) => {
          const [sh, sm] = a.startTime.split(':').map(Number);
          const [eh, em] = a.endTime.split(':').map(Number);
          return startMinsOfDay >= sh * 60 + sm && endMinsOfDay <= eh * 60 + em;
        });
        if (!withinAny) {
          throw new BadRequestException('The selected time is outside this staff member\'s available hours.');
        }
        return;
      }
    }

    const hours = params.hours;
    if (!hours) return;
    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayHours = hours[dayKeys[startClock.weekday]];
    if (dayHours?.closed) {
      throw new BadRequestException('This business is closed on the selected day.');
    }
    if (dayHours && dayHours.open && dayHours.close) {
      const [oh, om] = dayHours.open.split(':').map(Number);
      const [ch, cm] = dayHours.close.split(':').map(Number);
      const openMins = oh * 60 + om;
      const closeMins = ch * 60 + cm;
      const endMins = startMinsOfDay + durationMins + (params.bufferMins || 0);
      if (startMinsOfDay < openMins || endMins > closeMins) {
        throw new BadRequestException('The selected time is outside business hours.');
      }
    }
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

    const slot: SlotParams = {
      businessId,
      serviceId: booking.serviceId,
      staffId: booking.staffId,
      start,
      end,
      bufferMins: service?.bufferMins,
      excludeBookingId: booking.id,
    };
    await this.assertSlotFree(slot);

    // Hours and weekdays on the business's clock, as the create paths read them (V1-16).
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { businessHours: true, timezone: true },
    });
    const zone = this.businessZone(business?.timezone);
    const startClock = wallClock(start, zone);
    const endClock = wallClock(end, zone);

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
        const dayOfWeek = startClock.weekday;
        const slotAvail = staffAvailabilities.filter((a) => a.dayOfWeek === dayOfWeek);
        if (slotAvail.length === 0) {
          throw new BadRequestException('The selected staff member is not available on this day.');
        }
        const startMinsOfDay = startClock.minutes;
        const endMinsOfDay = endClock.minutes || 1440;
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

    if (!hasStaffSchedule) {
      const hours = business?.businessHours as BusinessHoursMap | null;
      if (hours) {
        const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayKey = dayKeys[startClock.weekday];
        const dayHours = hours[dayKey];
        if (dayHours?.closed) {
          throw new BadRequestException('The business is closed on this day.');
        }
        if (dayHours && dayHours.open && dayHours.close) {
          const [oh, om] = dayHours.open.split(':').map(Number);
          const [ch, cm] = dayHours.close.split(':').map(Number);
          const openMin = oh * 60 + om;
          const closeMin = ch * 60 + cm;
          const bookingStartMin = startClock.minutes;
          const bookingEndMin = endClock.minutes || 1440;
          if (bookingStartMin < openMin || bookingEndMin > closeMin) {
            throw new BadRequestException(
              `The selected time is outside business hours (${dayHours.open} – ${dayHours.close}).`,
            );
          }
        }
      }
    }

    const updated = await this.claimSlot(slot, (tx) =>
      tx.booking.update({
        where: { id: bookingId },
        data: { startTime: start, endTime: end },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          service: { select: { id: true, name: true, duration: true, price: true } },
          staff: { select: { id: true, name: true } },
        },
      }),
    );

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
    /** The member making the booking: their CRM view bounds which contact they may book. */
    actorUserId?: string;
  }) {
    // Staff booking from inside the app had NO check of any kind — not
    // overlap, not lead time, nothing. It went straight to booking.create, so
    // anyone with app access could double-book a slot the public widget would
    // have refused. The buffer is read from the service for the same reason
    // the other two paths read it: a configured buffer widens the window.
    //
    // V1-06: it also wrote whatever ids it was handed, so another business's
    // service, contact, staff member or org unit was booked into this one.
    // Each must be a live row of this business, and the contact one the actor's
    // CRM view shows (as GET contacts/:id decides it); anything else answers
    // like an unknown id. Without staffId the service is the resource
    // (assertSlotFree). The client chooses endTime, so it must follow startTime.
    const startMs = input.startTime.getTime();
    const endMs = input.endTime.getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new BadRequestException('startTime and endTime must be valid dates.');
    }
    if (endMs <= startMs) throw new BadRequestException('The end time must be after the start time.');
    const bookedService = await this.prisma.client.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
      select: { bufferMins: true, leadTimeMins: true },
    });
    if (!bookedService) throw new NotFoundException('Service not found');
    const contactWhere: Prisma.ContactWhereInput = { ...contactWhereWithId(input.businessId, input.contactId) };
    if (input.actorUserId) {
      const access = await resolveCrmAccess(this.prisma, input.businessId, input.actorUserId);
      const visClause = visibilityClause(access, input.actorUserId);
      if (visClause) contactWhere.AND = [visClause as Prisma.ContactWhereInput];
    }
    const contact = await this.prisma.client.contact.findFirst({ where: contactWhere, select: { id: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.assertOwnedRefs(input);

    // The public path's rules, in its order and with its messages.
    this.assertLeadTime(bookedService.leadTimeMins, input.startTime);
    const slot: SlotParams = {
      businessId: input.businessId,
      serviceId: input.serviceId,
      staffId: input.staffId,
      start: input.startTime,
      end: input.endTime,
      bufferMins: bookedService.bufferMins,
    };
    await this.assertSlotFree(slot);
    const business = await this.prisma.client.business.findUnique({
      where: { id: input.businessId },
      select: { businessHours: true, timezone: true },
    });
    await this.assertWithinSchedule({
      businessId: input.businessId,
      staffId: input.staffId,
      hours: (business?.businessHours ?? null) as BusinessHoursMap | null,
      start: input.startTime,
      end: input.endTime,
      bufferMins: bookedService.bufferMins,
      timeZone: this.businessZone(business?.timezone),
    });

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

    const booking = await this.claimSlot(slot, (tx) =>
      tx.booking.create({
        data: createData,
        include: { contact: true },
      }),
    );

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
    const write = (db: Pick<PrismaTx, 'booking'>, where: Prisma.BookingWhereUniqueInput) =>
      db.booking.update({ where, data: { status: 'CONFIRMED' }, include: { contact: true } });
    // V1-16: confirming a cancelled or no-show booking takes its slot again,
    // through the claim. A booking that is not there fails in the update, as before.
    const current = await this.prisma.client.booking.findUnique({ where: { id: bookingId } });
    const booking = current
      ? await this.writeBookingStatus(current, 'CONFIRMED', write)
      : await write(this.prisma.client, { id: bookingId });
    await this.announceConfirmed(booking);
    return booking;
  }

  /**
   * V1-28 (M42): invoice.paid confirms the booking the invoice pays for: the
   * booking whose final invoice (Booking.invoiceId) or deposit invoice
   * (Booking.depositInvoiceId) it is, under the event's business, with that
   * invoice PAID in the table. Only a booking still waiting for confirmation
   * (PENDING, UNCONFIRMED) moves, by a conditional update, so a completed,
   * cancelled or no-show booking is never brought back by a payment and a
   * replay confirms nothing twice. Returns the confirmed booking, or null.
   */
  async confirmBookingForPaidInvoice(businessId: string, invoiceId: string) {
    if (!businessId || !invoiceId) return null;
    const target = await this.prisma.client.booking.findFirst({
      where: {
        businessId,
        deletedAt: null,
        status: { in: AWAITING_CONFIRMATION },
        OR: [
          { invoiceId, invoice: { is: { businessId, status: 'PAID' } } },
          { depositInvoiceId: invoiceId, depositInvoice: { is: { businessId, status: 'PAID' } } },
        ],
      },
      select: { id: true },
    });
    if (!target) return null;
    const moved = await this.prisma.client.booking.updateMany({
      where: { id: target.id, businessId, status: { in: AWAITING_CONFIRMATION } },
      data: { status: 'CONFIRMED' },
    });
    if (moved.count === 0) return null;
    const booking = await this.prisma.client.booking.findUnique({ where: { id: target.id }, include: { contact: true } });
    if (!booking) return null;
    await this.announceConfirmed(booking);
    return booking;
  }

  /** booking.confirmed on the bus and on the contact's timeline, for a booking just confirmed by the system. */
  private async announceConfirmed(booking: Booking & { contact?: BookingConfirmedPayload['contact'] | null }) {
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
    await this.assertOwnedRefs(input);

    const start = new Date(input.startTime);
    const end = new Date(start.getTime() + service.duration * 60000);

    this.assertLeadTime(service.leadTimeMins, start);

    const slot: SlotParams = {
      businessId: input.businessId,
      serviceId: service.id,
      staffId: input.staffId,
      start,
      end,
      bufferMins: service.bufferMins,
    };
    await this.assertSlotFree(slot);

    await this.assertWithinSchedule({
      businessId: input.businessId,
      staffId: input.staffId,
      hours: business.businessHours as BusinessHoursMap | null,
      start,
      end,
      bufferMins: service.bufferMins,
      timeZone: this.businessZone(business.timezone),
    });

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

    // The early read above refused a taken slot before the contact and invoices
    // were touched; the claim settles the race with requests in flight. Losing
    // it leaves the invoices drawn up above for a booking that was not written.
    const booking = await this.claimSlot(slot, (tx) => tx.booking.create({ data: bookingData })).catch(
      async (err: unknown) => {
        await this.withdrawDraftInvoices(input.businessId, [invoice?.id, depositInvoice?.id]);
        throw err;
      },
    );

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

    // V1-28 (D-07: token links only): the customer's own link to the invoice
    // this booking drew up, /public/invoice/<token>, where its payment state
    // and receipt are (V1-48, V1-49). The confirmation pages opened the
    // operator's authenticated receipt, which answers a customer 401.
    const invoiceUrl = invoice ? await this.customerInvoiceUrl(input.businessId, invoice.id) : undefined;
    const depositInvoiceUrl = depositInvoice ? await this.customerInvoiceUrl(input.businessId, depositInvoice.id) : undefined;

    return {
      success: true,
      bookingId: booking.id,
      invoiceId: invoice?.id,
      depositInvoiceId: depositInvoice?.id,
      depositAmount: depositInvoice?.total ?? 0,
      invoiceUrl,
      depositInvoiceUrl,
    };
  }

  /**
   * The customer's pay-link URL for an invoice the public create just drew
   * up, through CommerceService.publicInvoiceUrl (the one place such a URL is
   * built). Best effort: the booking is written, so a link that cannot be
   * issued leaves the answer without one rather than failing it.
   */
  private async customerInvoiceUrl(businessId: string, invoiceId: string): Promise<string | undefined> {
    try {
      return (await this.commerce.publicInvoiceUrl(invoiceId, businessId)) ?? undefined;
    } catch (e) {
      this.logger.warn(`No customer link for invoice ${invoiceId}: ${(e as Error).message}`);
      return undefined;
    }
  }

  /**
   * The final invoice of a booking just completed (issueFinalInvoice, net of
   * the deposit), as an outcome: a failure is FAILED with a code and a
   * sentence, which the status route returns as invoiceErrorCode and
   * invoiceError (V1-28). It was swallowed; the raw error text is only logged
   * (SEC-V28-1).
   */
  private async autoGenerateInvoiceForCompletedBooking(
    booking: { id: string },
    businessId: string,
  ): Promise<CompletionInvoicing> {
    try {
      const outcome = await this.issueFinalInvoice(businessId, booking.id);
      if (outcome.status === 'CREATED') {
        this.logger.log(`Auto-generated invoice ${outcome.invoiceId} for completed booking ${booking.id}`);
      }
      return outcome;
    } catch (err) {
      // V1-28 review (SEC-V28-1): the detail is logged; the answer carries a
      // code and a sentence fit for any member (completionInvoiceError).
      this.logger.error(
        `Failed to auto-generate invoice for booking ${booking.id}: ${(err as Error)?.message || 'Unknown error'}`,
        (err as Error)?.stack,
      );
      return {
        status: 'FAILED',
        invoiceId: null,
        code: INVOICE_NOT_CREATED,
        error: completionInvoiceError(err),
      };
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
