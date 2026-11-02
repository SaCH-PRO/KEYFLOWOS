import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { InvoicePaidPayload } from '../../core/event-bus/events.types';
import { computeBalance } from '../commerce/invoice-workflow.service';

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

/** D-13: money compared and subtracted in integer cents on the Float columns. */
export const toCents = (amount: number | null | undefined) => Math.round(Number(amount ?? 0) * 100);

/**
 * V1-28: the invoice columns a booking's settlement is read from: the status,
 * the total, its payment rows (refunds included) and its APPLIED credit notes
 * (CreditNoteService.apply counts exactly those).
 */
export const SETTLEMENT_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  currency: true,
  payments: { select: { amount: true, status: true } },
  creditNotes: { where: { status: 'APPLIED' }, select: { amount: true } },
} as const satisfies Prisma.InvoiceSelect;

export type SettlementInvoice = Prisma.InvoiceGetPayload<{ select: typeof SETTLEMENT_INVOICE_SELECT }>;

/** Invoice statuses with nothing left to collect on the invoice itself. */
const NOTHING_LEFT_TO_COLLECT: ReadonlySet<string> = new Set(['PAID', 'FULLY_CREDITED']);

/**
 * What a booking's live deposit invoice (not VOID, not deleted) stands for, in
 * integer cents (V1-28 review: SEC-V28-3, CR-V28-2).
 *
 *   billed  its total less the credit notes applied to it (all of it once it
 *           is FULLY_CREDITED, the status CreditNoteService.apply writes)
 *   held    money it holds for the booking: a PAID deposit's billed amount
 *           less what was refunded on it. A refund leaves the invoice PAID
 *           (markPaymentRefunded flips the payment to REFUNDED; a provider
 *           refund adds a negative REFUNDED row; computeBalance counts both),
 *           so the status alone is not money held.
 *   covers  the part of the price the deposit accounts for, which the final
 *           invoice nets out: a PAID deposit collects nothing more, so it
 *           covers what it holds; any other live deposit is still owed on its
 *           own invoice, so it covers what it bills.
 */
export function depositPosition(deposit: SettlementInvoice): { billedCents: number; heldCents: number; coversCents: number } {
  const totalCents = toCents(deposit.total);
  const appliedCents = deposit.creditNotes.reduce((sum, cn) => sum + toCents(Number(String(cn.amount))), 0);
  const creditedCents = deposit.status === 'FULLY_CREDITED' ? totalCents : Math.min(totalCents, appliedCents);
  const billedCents = Math.max(0, totalCents - creditedCents);
  const refundedCents = toCents(computeBalance(Number(deposit.total), deposit.payments, deposit.currency).refunded);
  const heldCents = deposit.status === 'PAID' ? Math.max(0, billedCents - refundedCents) : 0;
  return { billedCents, heldCents, coversCents: deposit.status === 'PAID' ? heldCents : billedCents };
}

/**
 * Booking.paymentStatus as the booking's two invoices state it (V1-28 review,
 * CR-V28-1). PAID only when the final invoice is PAID AND no live deposit is
 * still owed: the final invoice nets the deposit whether or not it was paid,
 * so a paid final alone left the deposit's share uncollected while the booking
 * read PAID. DEPOSIT_PAID when the deposit holds money; else UNPAID.
 * `deposit` is the live deposit invoice (not VOID, not deleted), or null.
 */
export function derivePaymentStatus(invoices: {
  final: Pick<SettlementInvoice, 'status'> | null;
  deposit: SettlementInvoice | null;
}): 'UNPAID' | 'DEPOSIT_PAID' | 'PAID' {
  const { final, deposit } = invoices;
  const depositOwed = !!deposit && !NOTHING_LEFT_TO_COLLECT.has(deposit.status);
  if (final?.status === 'PAID' && !depositOwed) return 'PAID';
  if (deposit && depositPosition(deposit).heldCents > 0) return 'DEPOSIT_PAID';
  return 'UNPAID';
}

/** The booking's final invoice (not deleted) and live deposit invoice (not VOID, not deleted), under its business. */
export async function readSettlementInvoices(
  prisma: PrismaService,
  businessId: string,
  booking: { invoiceId: string | null; depositInvoiceId: string | null },
): Promise<{ final: SettlementInvoice | null; deposit: SettlementInvoice | null }> {
  const [final, deposit] = await Promise.all([
    booking.invoiceId
      ? prisma.client.invoice.findFirst({
          where: { id: booking.invoiceId, businessId, deletedAt: null },
          select: SETTLEMENT_INVOICE_SELECT,
        })
      : null,
    booking.depositInvoiceId
      ? prisma.client.invoice.findFirst({
          where: { id: booking.depositInvoiceId, businessId, deletedAt: null, status: { not: 'VOID' } },
          select: SETTLEMENT_INVOICE_SELECT,
        })
      : null,
  ]);
  return { final: final ?? null, deposit: deposit ?? null };
}

/**
 * V1-28-BK-SETTLEMENT (M42): Booking.paymentStatus (UNPAID | DEPOSIT_PAID |
 * PAID) had no writer, so every booking read UNPAID whatever had been paid.
 *
 * On invoice.paid the booking that invoice belongs to (as its deposit invoice,
 * Booking.depositInvoiceId, or its final invoice, Booking.invoiceId) takes the
 * status its two invoices state (derivePaymentStatus): PAID once the final is
 * paid and no deposit is still owed, DEPOSIT_PAID while only the deposit is
 * held. The database decides, not the event: the invoice must be the event's
 * business's and PAID in the table, and the booking and both its invoices are
 * read under the same business, so a payload naming another tenant moves
 * nothing. The write is a conditional update on the statuses it may advance
 * from, so replays and concurrent deliveries write once.
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

    const target = derivePaymentStatus(await readSettlementInvoices(this.prisma, businessId, booking));
    if (target === 'UNPAID') {
      return { bookingId: booking.id, paymentStatus: booking.paymentStatus, changed: false };
    }
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
