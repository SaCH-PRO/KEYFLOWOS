import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../core/prisma/prisma.service';

type BookingStatusPayload = {
  booking?: {
    id?: string;
    contactId?: string | null;
    serviceId?: string | null;
    contact?: { firstName?: string | null; lastName?: string | null } | null;
    service?: { name?: string | null; price?: number | null } | null;
  };
  businessId: string;
};

/**
 * Surfaces booking.no_show / booking.cancelled as a revenue-risk in-app
 * notification (R3-compatible action). Idempotent via dedupe-keyed
 * notification rows scoped to the booking id.
 */
@Injectable()
export class BookingNoShowListener {
  private readonly logger = new Logger(BookingNoShowListener.name);

  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @OnEvent('booking.no_show', { async: true })
  async onNoShow(p: BookingStatusPayload) {
    await this.writeRisk(p, 'no_show');
  }

  @OnEvent('booking.cancelled', { async: true })
  async onCancelled(p: BookingStatusPayload) {
    await this.writeRisk(p, 'cancelled');
  }

  private async writeRisk(p: BookingStatusPayload, kind: 'no_show' | 'cancelled') {
    const b = p.booking;
    if (!b?.id || !p.businessId) return;
    const dedupeKey = `notif:booking.${kind}:${b.id}`;
    const contactName = [b.contact?.firstName, b.contact?.lastName].filter(Boolean).join(' ').trim();
    const serviceName = b.service?.name ?? 'a booking';
    const lostValue = typeof b.service?.price === 'number' ? b.service.price : null;
    try {
      const existing = await this.prisma.client.notification.findFirst({
        where: {
          businessId: p.businessId,
          type: `booking.${kind}`,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && (existing.data as Record<string, unknown> | null)?.dedupeKey === dedupeKey) {
        return;
      }
      await this.notifications.create({
        businessId: p.businessId,
        type: `booking.${kind}`,
        title: kind === 'no_show' ? `No-show: ${serviceName}` : `Cancelled: ${serviceName}`,
        body: contactName
          ? `${contactName} ${kind === 'no_show' ? 'did not attend' : 'cancelled'} ${serviceName}.`
          : `Revenue risk on ${serviceName}.`,
        data: {
          dedupeKey,
          bookingId: b.id,
          contactId: b.contactId ?? null,
          serviceId: b.serviceId ?? null,
          serviceName,
          lostValue,
          riskKind: kind,
        },
      });
    } catch (err) {
      this.logger.warn(
        `booking-no-show notify failed for ${b.id} (${kind}): ${(err as Error).message}`,
      );
    }
  }
}
