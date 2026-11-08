import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingCancelledPayload,
  BookingRescheduledPayload,
} from '../../core/event-bus/events.types';
import { BookingWaitlistService } from './booking-waitlist.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { CrmService } from '../crm/crm.service';

export interface WaitlistSlotOfferedPayload {
  entry: {
    id: string;
    contactId: string;
    serviceId: string;
    service?: { id: string; name: string } | null;
    contact?: { id: string; firstName?: string | null; lastName?: string | null; displayName?: string | null } | null;
  };
  booking: {
    id: string;
    startTime: Date | string;
    endTime: Date | string;
    contact?: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null } | null;
    service?: { id: string; name: string } | null;
    staff?: { id: string; name: string } | null;
  };
  businessId: string;
  actorType?: 'SYSTEM' | 'USER';
}

/**
 * When a booking is cancelled or rescheduled, the old slot becomes free.
 * Offer that slot to the first matching waitlist entry, if any.
 *
 * This listener is intentionally simple: it matches ONE entry per freed slot.
 * If multiple entries match, the oldest wins. A future improvement could offer
 * the same slot to several entries and let the first to convert win.
 */
@Injectable()
export class BookingWaitlistListener {
  private readonly logger = new Logger(BookingWaitlistListener.name);

  constructor(
    @Inject(BookingWaitlistService) private readonly waitlist: BookingWaitlistService,
    @Optional() @Inject(TransactionalEmailService) private readonly emailService?: TransactionalEmailService,
    @Optional() @Inject(CrmService) private readonly crm?: CrmService,
  ) {}

  @OnEvent('booking.waitlist.slot_offered', { async: true })
  async onSlotOffered(payload: WaitlistSlotOfferedPayload) {
    const { businessId, entry, booking, actorType } = payload;
    if (!businessId || !entry?.id || !booking?.id) return;

    if (this.crm && entry.contactId) {
      try {
        await this.crm.logContactEvent({
          businessId,
          contactId: entry.contactId,
          type: 'booking.waitlist_offered',
          data: {
            waitlistEntryId: entry.id,
            bookingId: booking.id,
            serviceName: booking.service?.name ?? entry.service?.name ?? null,
            startTime: booking.startTime instanceof Date ? booking.startTime.toISOString() : booking.startTime,
            endTime: booking.endTime instanceof Date ? booking.endTime.toISOString() : booking.endTime,
          },
          actorType: actorType ?? 'SYSTEM',
          source: 'bookings',
        });
      } catch (err) {
        this.logger.warn(
          `Failed to log waitlist offer timeline event for entry ${entry.id}: ${(err as Error).message}`,
        );
      }
    }

    const recipientEmail = booking.contact?.email?.trim();
    if (this.emailService && recipientEmail) {
      const recipientName =
        [booking.contact?.firstName, booking.contact?.lastName].filter(Boolean).join(' ').trim() ||
        entry.contact?.displayName ||
        'Valued Client';
      try {
        await this.emailService.send({
          businessId,
          type: 'booking_created',
          recipientEmail,
          recipientName,
          contactId: entry.contactId,
          templateData: {
            serviceName: booking.service?.name ?? entry.service?.name ?? 'Appointment',
            startTime: booking.startTime,
            endTime: booking.endTime,
            staffName: booking.staff?.name ?? undefined,
            bookingId: booking.id,
          },
          dedupeKey: `waitlist-offer-${entry.id}-${booking.id}`,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to send waitlist slot offer email for entry ${entry.id}: ${(err as Error).message}`,
        );
      }
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
