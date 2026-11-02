import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { InvoicePaidPayload } from '../../core/event-bus/events.types';

/** What one invoice.paid did to a booking's paymentStatus. */
export interface BookingPaymentStatusOutcome {
  bookingId: string | null;
  paymentStatus: string | null;
  changed: boolean;
}

const NOTHING: BookingPaymentStatusOutcome = { bookingId: null, paymentStatus: null, changed: false };

/**
 * The statuses each target may be written from. Moves only go forward, so a
 * replay, or a deposit event delivered after the final one, writes nothing; a
 * deposit forfeited on cancel (D-26, BookingsService) is never overwritten.
 */
const ADVANCES_FROM: Record<'DEPOSIT_PAID' | 'PAID', string[]> = {
  DEPOSIT_PAID: ['UNPAID'],
  PAID: ['UNPAID', 'DEPOSIT_PAID'],
};

/**
 * V1-28-BK-SETTLEMENT (M42): Booking.paymentStatus (UNPAID | DEPOSIT_PAID |
 * PAID) had no writer, so every booking read UNPAID whatever had been paid.
 *
 * On invoice.paid the booking that invoice belongs to moves: its deposit
 * invoice (Booking.depositInvoiceId) to DEPOSIT_PAID, its final invoice
 * (Booking.invoiceId) to PAID. The database decides, not the event: the
 * invoice must be the event's business's and PAID in the table, and the
 * booking is looked up under the same business, so a payload naming another
 * tenant, or a stale replay after a refund, moves nothing. The write is a
 * conditional update on the statuses it may advance from, so replays and
 * concurrent deliveries write once.
 *
 * Listener failures are logged and never thrown into the emitter: the payment
 * that raised the event has already committed.
 */
@Injectable()
export class BookingPaymentStatusListener {
  private readonly logger = new Logger(BookingPaymentStatusListener.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @OnEvent('invoice.paid', { async: true })
  async onInvoicePaid(payload: InvoicePaidPayload): Promise<BookingPaymentStatusOutcome> {
    try {
      return await this.apply(payload);
    } catch (err) {
      this.logger.error(`Booking paymentStatus not updated for invoice ${payload?.invoice?.id ?? '?'}: ${(err as Error).message}`);
      return NOTHING;
    }
  }

  private async apply(payload: InvoicePaidPayload): Promise<BookingPaymentStatusOutcome> {
    const businessId = payload?.businessId;
    const invoiceId = payload?.invoice?.id;
    if (!businessId || !invoiceId) return NOTHING;
    // A payload whose invoice names another business than the event is not this tenant's money.
    if (payload.invoice.businessId && payload.invoice.businessId !== businessId) return NOTHING;

    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!invoice || invoice.status !== 'PAID') return NOTHING;

    const booking = await this.prisma.client.booking.findFirst({
      where: { businessId, deletedAt: null, OR: [{ invoiceId }, { depositInvoiceId: invoiceId }] },
      select: { id: true, invoiceId: true, depositInvoiceId: true, paymentStatus: true },
    });
    if (!booking) return NOTHING;

    const target = booking.invoiceId === invoiceId ? 'PAID' : 'DEPOSIT_PAID';
    const write = await this.prisma.client.booking.updateMany({
      where: { id: booking.id, businessId, paymentStatus: { in: ADVANCES_FROM[target] } },
      data: { paymentStatus: target },
    });
    if (write.count > 0) {
      return { bookingId: booking.id, paymentStatus: target, changed: true };
    }
    return { bookingId: booking.id, paymentStatus: booking.paymentStatus, changed: false };
  }
}
