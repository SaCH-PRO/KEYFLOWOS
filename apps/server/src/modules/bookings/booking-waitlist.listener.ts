import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingCancelledPayload,
  BookingRescheduledPayload,
} from '../../core/event-bus/events.types';
import { BookingWaitlistService, WAITLIST_OFFER_HOLD_MINUTES, waitlistOfferExpiresAt } from './booking-waitlist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CrmService } from '../crm/crm.service';

/**
 * PR196-WAITLIST-EXPIRY: what BookingWaitlistService.offerSlot emits as
 * `booking.waitlist.slot_offered`.
 */
export interface WaitlistSlotOfferedPayload {
  businessId: string;
  actorType?: 'SYSTEM' | 'USER';
  actorId?: string;
  offerExpiresAt?: Date | string;
  timeZone?: string | null;
  entry: {
    id: string;
    contactId: string;
    serviceId?: string;
    offeredAt?: Date | string | null;
    contact?: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null;
    service?: { id?: string; name?: string | null } | null;
  };
  booking: {
    id: string;
    startTime: Date | string;
    endTime: Date | string;
    staffId?: string | null;
    contact?: { firstName?: string | null; lastName?: string | null } | null;
    service?: { id?: string; name?: string | null } | null;
    staff?: { id?: string; name?: string | null } | null;
  };
}

/**
 * PR196-WAITLIST-EXPIRY: what BookingWaitlistService.expireStaleOffers emits
 * as `booking.waitlist.offer_expired`.
 */
export interface WaitlistOfferExpiredPayload {
  businessId: string;
  actorType: 'SYSTEM';
  entry: { id: string; contactId: string; serviceId: string };
  bookingId: string | null;
  /** Whether this expiry gave the placeholder's slot back (it was still UNCONFIRMED). */
  released: boolean;
  /** The waiting entry the freed slot was offered to, if any. */
  cascadedToEntryId: string | null;
  startTime: Date | string | null;
  endTime: Date | string | null;
  contactName: string;
  serviceName: string | null;
  timeZone: string | null;
}

const toIso = (value: Date | string) => new Date(value).toISOString();

/** A moment as staff read it, in the business's time zone (UTC when it has none or an unknown one). */
function formatForStaff(value: Date | string, timeZone?: string | null): string {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timeZone || 'UTC' }).format(date);
  } catch {
    return `${new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)} UTC`;
  }
}

function personName(
  contact?: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null,
): string {
  if (!contact) return '';
  return contact.displayName?.trim() || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
}

/**
 * When a booking is cancelled or rescheduled, the old slot becomes free.
 * Offer that slot to the first matching waitlist entry, if any.
 *
 * This listener is intentionally simple: it matches ONE entry per freed slot.
 * If multiple entries match, the oldest wins. A future improvement could offer
 * the same slot to several entries and let the first to convert win.
 *
 * PR196-WAITLIST-EXPIRY (D-86): it also tells the business's staff about each
 * offer and its 120-minute deadline, and about each lapsed hold, through the
 * in-app notification path (NotificationsService, as BookingNoShowListener
 * does). The waitlisted customer is not emailed: there is no public accept
 * link yet, and only staff can convert an offer (F1-D4). Each offer also
 * writes the canonical `booking.waitlist_offered` ContactEvent with its actor
 * (F1-D5).
 *
 * NotificationsService and CrmService are @Optional only so suites that build
 * this listener with the waitlist service alone keep compiling. BookingsModule
 * imports NotificationsModule and CrmModule, and its BookingNoShowListener and
 * BookingsService already require those two providers, so in the application
 * both always resolve here; the constructor warns if one does not.
 */
@Injectable()
export class BookingWaitlistListener {
  private readonly logger = new Logger(BookingWaitlistListener.name);

  constructor(
    @Inject(BookingWaitlistService) private readonly waitlist: BookingWaitlistService,
    @Optional() @Inject(NotificationsService) private readonly notifications?: NotificationsService,
    @Optional() @Inject(CrmService) private readonly crm?: CrmService,
  ) {
    if (!notifications) this.logger.warn('NotificationsService not provided: waitlist offers notify no staff');
    if (!crm) this.logger.warn('CrmService not provided: waitlist offers write no timeline event');
  }

  @OnEvent('booking.waitlist.slot_offered', { async: true })
  async onSlotOffered(payload: WaitlistSlotOfferedPayload) {
    const { businessId, entry, booking } = payload;
    if (!businessId || !entry?.id || !booking?.id) return;

    const offerExpiresAt = payload.offerExpiresAt
      ? new Date(payload.offerExpiresAt)
      : entry.offeredAt
        ? waitlistOfferExpiresAt(entry.offeredAt)
        : null;
    const actor =
      payload.actorType === 'USER' && payload.actorId
        ? { actorType: 'USER' as const, actorId: payload.actorId }
        : { actorType: 'SYSTEM' as const };
    const serviceName = booking.service?.name ?? entry.service?.name ?? 'an appointment';
    const contactName = personName(entry.contact) || personName(booking.contact) || 'A waitlisted customer';
    const detail = {
      waitlistEntryId: entry.id,
      bookingId: booking.id,
      contactId: entry.contactId,
      serviceName,
      staffId: booking.staffId ?? null,
      startTime: toIso(booking.startTime),
      endTime: toIso(booking.endTime),
      offerExpiresAt: offerExpiresAt ? offerExpiresAt.toISOString() : null,
    };

    if (this.crm && entry.contactId) {
      try {
        await this.crm.logContactEvent({
          businessId,
          contactId: entry.contactId,
          type: 'booking.waitlist_offered',
          data: detail,
          ...actor,
          source: 'bookings',
        });
      } catch (err) {
        this.logger.warn(`Waitlist offer timeline event failed for entry ${entry.id}: ${(err as Error).message}`);
      }
    }

    if (this.notifications) {
      const slotText = formatForStaff(booking.startTime, payload.timeZone);
      const deadlineText = offerExpiresAt ? formatForStaff(offerExpiresAt, payload.timeZone) : null;
      try {
        await this.notifications.create({
          businessId,
          type: 'booking.waitlist_offered',
          title: `Waitlist hold: ${serviceName}`,
          body: deadlineText
            ? `${contactName} is offered ${serviceName} on ${slotText}. The slot is held until ${deadlineText} (${WAITLIST_OFFER_HOLD_MINUTES} minutes). Confirm with them and convert the offer on the waitlist before then, or it moves to the next person waiting.`
            : `${contactName} is offered ${serviceName} on ${slotText}. Confirm with them and convert the offer on the waitlist.`,
          data: {
            ...detail,
            ...actor,
            dedupeKey: `notif:booking.waitlist_offered:${entry.id}:${booking.id}`,
          },
        });
      } catch (err) {
        this.logger.warn(`Waitlist offer staff notification failed for entry ${entry.id}: ${(err as Error).message}`);
      }
    }
  }

  @OnEvent('booking.waitlist.offer_expired', { async: true })
  async onOfferExpired(payload: WaitlistOfferExpiredPayload) {
    const { businessId, entry } = payload;
    if (!businessId || !entry?.id || !this.notifications) return;

    const serviceName = payload.serviceName ?? 'an appointment';
    const who = payload.contactName || 'a waitlisted customer';
    const slotText = payload.startTime ? ` on ${formatForStaff(payload.startTime, payload.timeZone)}` : '';
    const outcome = !payload.released
      ? 'The booking itself was not changed.'
      : payload.cascadedToEntryId
        ? 'The slot was offered to the next person waiting.'
        : 'The slot is free again.';
    try {
      await this.notifications.create({
        businessId,
        type: 'booking.waitlist_offer_expired',
        title: `Waitlist hold expired: ${serviceName}`,
        body: `The ${WAITLIST_OFFER_HOLD_MINUTES}-minute hold for ${who}${slotText} ran out before it was converted. ${outcome}`,
        data: {
          waitlistEntryId: entry.id,
          contactId: entry.contactId,
          bookingId: payload.bookingId,
          released: payload.released,
          cascadedToEntryId: payload.cascadedToEntryId,
          startTime: payload.startTime ? toIso(payload.startTime) : null,
          endTime: payload.endTime ? toIso(payload.endTime) : null,
          actorType: 'SYSTEM',
          dedupeKey: `notif:booking.waitlist_offer_expired:${entry.id}`,
        },
      });
    } catch (err) {
      this.logger.warn(`Waitlist expiry staff notification failed for entry ${entry.id}: ${(err as Error).message}`);
    }
  }

  @OnEvent('booking.cancelled', { async: true })
  async onCancelled(payload: BookingCancelledPayload) {
    await this.handleFreedSlot(payload.businessId, payload.booking);
  }

  @OnEvent('booking.rescheduled', { async: true })
  async onRescheduled(payload: BookingRescheduledPayload) {
    await this.handleFreedSlot(payload.businessId, {
      ...payload.booking,
      startTime: payload.previousStartTime,
      endTime: payload.previousEndTime,
    });
  }

  private async handleFreedSlot(
    businessId: string,
    booking: { startTime: Date; endTime: Date; serviceId: string; staffId?: string | null },
  ) {
    try {
      const matches = await this.waitlist.findWaitlistMatchesForSlot(
        businessId,
        {
          startTime: new Date(booking.startTime),
          endTime: new Date(booking.endTime),
          serviceId: booking.serviceId,
          staffId: booking.staffId ?? null,
        },
        { limit: 1 },
      );

      if (matches.length === 0) return;

      const entry = matches[0];
      const result = await this.waitlist.offerSlot(entry.id, {
        startTime: new Date(booking.startTime),
        endTime: new Date(booking.endTime),
        serviceId: booking.serviceId,
        staffId: booking.staffId ?? null,
      });

      this.logger.log(
        `Offered freed slot ${booking.startTime.toISOString()} to waitlist entry ${entry.id} as booking ${result.booking.id}`,
      );
    } catch (err) {
      // A listener must never take the request down. Log the tuple that
      // identifies the freed slot so a human can retry manually if needed.
      this.logger.error(
        `Failed to offer freed slot to waitlist for business ${businessId}, booking ${booking.startTime.toISOString()}: ${(err as Error).message}`,
      );
    }
  }
}
