import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { InvoicePaidPayload } from '../../core/event-bus/events.types';
import { balanceOfStoredRows, readStoredPayments } from '../commerce/invoice-workflow.service';

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];
/** What the settlement reads need: the invoice delegate of the client or of a transaction. */
type SettlementReader = Pick<PrismaTx, 'invoice'>;

/**
 * Trial-N round 2 (RC-DEP-3): the bound on a derivation's transaction. It is
 * a few reads and one write under the booking row lock; the bound only ends
 * one that is stuck, so it never holds the lock for long.
 */
const DERIVATION_TX_TIMEOUT_MS = 10_000;

/** What one invoice.paid did to a booking's paymentStatus. */
export interface BookingPaymentStatusOutcome {
  bookingId: string | null;
  paymentStatus: string | null;
  changed: boolean;
}

const NOTHING: BookingPaymentStatusOutcome = { bookingId: null, paymentStatus: null, changed: false };

/**
 * The statuses each target may be written from on invoice.paid. Moves only go
 * forward, so a replay, or a deposit event delivered after the final one,
 * writes nothing; a deposit forfeited on cancel (D-26, BookingsService) is
 * never overwritten. (A refund that moves an invoice back re-derives the
 * status instead: onInvoiceRefundMoved.)
 */
const ADVANCES_FROM: Record<'DEPOSIT_PAID' | 'PAID', string[]> = {
  DEPOSIT_PAID: ['UNPAID'],
  PAID: ['UNPAID', 'DEPOSIT_PAID'],
};

/**
 * Trial-N (N2-CR / N3-SEC): the statuses a refund's re-derivation may write
 * over. Never DEPOSIT_FORFEITED: the forfeit (D-26) is a record of the cancel,
 * and only bringing the booking back (BookingsService) lifts it.
 */
const REDERIVES_FROM: ReadonlySet<string> = new Set(['UNPAID', 'DEPOSIT_PAID', 'PAID']);

/** D-13: money compared and subtracted in integer cents on the Float columns. */
export const toCents = (amount: number | null | undefined) => Math.round(Number(amount ?? 0) * 100);

/**
 * V1-28: the invoice columns a booking's settlement is read from: the status,
 * the total, its payment rows (refunds included) and its APPLIED credit notes
 * (CreditNoteService.apply counts exactly those).
 */
const SETTLEMENT_INVOICE_SHAPE = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  currency: true,
  payments: { select: { amount: true, status: true } },
  creditNotes: { where: { status: 'APPLIED' }, select: { amount: true } },
} as const satisfies Prisma.InvoiceSelect;

export type SettlementInvoice = Prisma.InvoiceGetPayload<{ select: typeof SETTLEMENT_INVOICE_SHAPE }>;

/**
 * The settlement select for an invoice read under `businessId` (trial-N
 * N1-SEC): its payment rows of that business only. Payment sits outside the
 * tenant extension and has no FK to Business (M31), so a row carrying another
 * businessId is not this invoice's money, as the receipt, the receivables and
 * the payments-ops balance readers already hold (SEC-V29B-1, SEC-V49-1). Every
 * settlement read passes the business it reads the invoice under. The rows
 * come in the order they were written (trial-N round 2, RC-DEP-1): whether a
 * deposit was paid in full is read from that order (depositPosition).
 */
export function settlementInvoiceSelect(businessId: string) {
  return {
    ...SETTLEMENT_INVOICE_SHAPE,
    payments: {
      where: { businessId },
      select: SETTLEMENT_INVOICE_SHAPE.payments.select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  } satisfies Prisma.InvoiceSelect;
}

/** Invoice statuses with nothing left to collect on the invoice itself. */
const NOTHING_LEFT_TO_COLLECT: ReadonlySet<string> = new Set(['PAID', 'FULLY_CREDITED']);

/**
 * Trial-N round 2 (RC-DEP-1): whether a deposit's own payment rows, read in
 * the order they were written (settlementInvoiceSelect), paid what it bills
 * in full since it last stood at nothing received. The running net follows
 * the balance contract (balanceOfStoredRows: SUCCESSFUL rows in, D-14 negative
 * REFUNDED rows out, a legacy positive REFUNDED flip read as its payment then
 * its refund; PENDING and FAILED rows are not money). A net back at nothing
 * is D-14's full refund, which reopens an invoice to SENT with paidAt cleared,
 * owed afresh: what was paid before it no longer counts. The gross received
 * (paid >= billed) counted refund and repayment churn: 20 paid, refunded, then
 * 10 paid read as settled and held the 10.
 */
function paidInFullSinceReopened(rows: SettlementInvoice['payments'], billedCents: number): boolean {
  let netCents = 0;
  let paidInFull = false;
  for (const row of readStoredPayments(rows)) {
    if (row.status === 'SUCCESSFUL') netCents += toCents(row.amount);
    else if (row.status === 'REFUNDED') netCents -= Math.abs(toCents(row.amount));
    else continue;
    if (netCents <= 0) paidInFull = false;
    else if (netCents >= billedCents) paidInFull = true;
  }
  return paidInFull;
}

/**
 * What a booking's live deposit invoice (not VOID, not deleted) stands for, in
 * integer cents (V1-28 review: SEC-V28-3, CR-V28-2).
 *
 *   billed  its total less the credit notes applied to it (all of it once it
 *           is FULLY_CREDITED, the status CreditNoteService.apply writes)
 *   held    money it holds for the booking, at most what it bills, read
 *           from the shared balance contract (balanceOfStoredRows: SUCCESSFUL
 *           rows less D-14's negative REFUNDED rows; a legacy positive REFUNDED
 *           flip reads as net 0):
 *             - a deposit that was never settled holds nothing: a part payment
 *               on a deposit still owed does not make the booking DEPOSIT_PAID,
 *               and a refund of part of it does not either (trial-N N4), nor
 *               does refund and repayment churn (trial-N round 2, RC-DEP-1). A
 *               deposit was settled when it is PAID (its status is the
 *               evidence: a legacy deposit marked PAID with no rows, FAILED or
 *               PENDING rows only, or rows short of its total, from before
 *               R0-20 recorded every payment, was paid, and the final invoice
 *               netted it as paid) or when its rows, in the order they were
 *               written, paid what it bills in full since it last stood at
 *               nothing received (paidInFullSinceReopened: a paid deposit a
 *               credit note was then applied to, D-28 PARTIALLY_CREDITED, or
 *               one a D-14 refund reopened to PARTIALLY_PAID; one refunded
 *               back to nothing, D-14's SENT, is owed afresh);
 *             - a settled deposit something was refunded on (PAID, or reopened
 *               by a D-14 refund to PARTIALLY_PAID or SENT) holds its net
 *               received;
 *             - a settled deposit nothing was refunded on holds what it bills.
 *   covers  the part of the price the deposit accounts for, which the final
 *           invoice nets out: a deposit with nothing left to collect (PAID,
 *           FULLY_CREDITED) covers what it holds; any other live deposit,
 *           including one D-14 reopened by a refund, is still owed on its own
 *           invoice, so it covers what it bills.
 */
export function depositPosition(deposit: SettlementInvoice): { billedCents: number; heldCents: number; coversCents: number } {
  const totalCents = toCents(deposit.total);
  const appliedCents = deposit.creditNotes.reduce((sum, cn) => sum + toCents(Number(String(cn.amount))), 0);
  const creditedCents = deposit.status === 'FULLY_CREDITED' ? totalCents : Math.min(totalCents, appliedCents);
  const billedCents = Math.max(0, totalCents - creditedCents);
  const balance = balanceOfStoredRows(Number(deposit.total), deposit.payments, deposit.currency);
  const netHeldCents = Math.min(billedCents, Math.max(0, toCents(balance.net)));
  const refunded = toCents(balance.refunded) > 0;
  const settled = deposit.status === 'PAID' || paidInFullSinceReopened(deposit.payments, billedCents);
  const heldCents = !settled ? 0 : refunded ? netHeldCents : billedCents;
  return { billedCents, heldCents, coversCents: NOTHING_LEFT_TO_COLLECT.has(deposit.status) ? heldCents : billedCents };
}

/**
 * Booking.paymentStatus as the booking's two invoices state it (V1-28 review,
 * CR-V28-1). PAID only when the final invoice is PAID AND no live deposit is
 * still owed: the final invoice nets the deposit whether or not it was paid,
 * so a paid final alone left the deposit's share uncollected while the booking
 * read PAID. DEPOSIT_PAID when the deposit holds money; else UNPAID.
 * `deposit` is the live deposit invoice (not VOID, not deleted), or null.
 *
 * A deposit is owed while something is left to collect on it: not when its
 * status says nothing is (PAID, FULLY_CREDITED), nor when what it holds covers
 * what it still bills (trial-N N1-CR: a deposit paid in full and then
 * part-credited, D-28 PARTIALLY_CREDITED, holds the 15 it bills of 25).
 */
export function derivePaymentStatus(invoices: {
  final: Pick<SettlementInvoice, 'status'> | null;
  deposit: SettlementInvoice | null;
}): 'UNPAID' | 'DEPOSIT_PAID' | 'PAID' {
  const { final, deposit } = invoices;
  const position = deposit ? depositPosition(deposit) : null;
  const depositOwed =
    !!deposit && !!position && !NOTHING_LEFT_TO_COLLECT.has(deposit.status) && position.heldCents < position.billedCents;
  if (final?.status === 'PAID' && !depositOwed) return 'PAID';
  if (position && position.heldCents > 0) return 'DEPOSIT_PAID';
  return 'UNPAID';
}

/**
 * The booking's final invoice (not deleted) and live deposit invoice (not
 * VOID, not deleted), under its business, read through `db`: the client, or
 * the transaction holding the booking row lock (BookingPaymentStatusListener).
 */
export async function readSettlementInvoices(
  db: SettlementReader,
  businessId: string,
  booking: { invoiceId: string | null; depositInvoiceId: string | null },
): Promise<{ final: SettlementInvoice | null; deposit: SettlementInvoice | null }> {
  const [final, deposit] = await Promise.all([
    booking.invoiceId
      ? db.invoice.findFirst({
          where: { id: booking.invoiceId, businessId, deletedAt: null },
          select: settlementInvoiceSelect(businessId),
        })
      : null,
    booking.depositInvoiceId
      ? db.invoice.findFirst({
          where: { id: booking.depositInvoiceId, businessId, deletedAt: null, status: { not: 'VOID' } },
          select: settlementInvoiceSelect(businessId),
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
 * Trial-N round 2 (RC-DEP-3): every derivation (invoice.paid, and a refund's
 * invoice.reopened / invoice.payment_recorded) runs in one transaction that
 * locks the booking row (FOR NO KEY UPDATE) before it reads the booking, and
 * reads its invoices and writes its status under that lock. The
 * compare-and-set on the status read covered the booking only, not the
 * invoices the status was derived from: a refund's re-derivation that read the
 * deposit SENT could write UNPAID after the deposit was paid again and its
 * invoice.paid had found DEPOSIT_PAID with nothing to write (and the mirror:
 * an invoice.paid that read the deposit PAID could write DEPOSIT_PAID after a
 * full refund's re-derivation had found UNPAID). Under the lock the
 * derivations of one booking run one after another, each reads the invoices as
 * committed when it holds the lock, and every invoice move emits its event
 * after it commits, so the derivation of the last move runs after it.
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

  /**
   * Trial-N (N2-CR / N3-SEC): under D-14 a refund moves the invoice it is on
   * (a full refund back to SENT, invoice.reopened; a partial one to
   * PARTIALLY_PAID, invoice.payment_recorded), and Booking.paymentStatus was
   * re-derived only on invoice.paid, so a deposit refunded in full left the
   * booking DEPOSIT_PAID with nothing held (and CANCELLED with DEPOSIT_PAID
   * after a cancel that rightly forfeited nothing). On either event the booking
   * takes the status its two invoices state now (derivePaymentStatus), forward
   * or back, by the database's word as on invoice.paid; a forfeited deposit
   * (D-26) is never overwritten. The write is conditional on the status read
   * under the booking row lock (RC-DEP-3), so nothing lands in between.
   * Failures are logged, never thrown into the emitter.
   */
  @OnEvent('invoice.reopened', { async: true })
  @OnEvent('invoice.payment_recorded', { async: true })
  async onInvoiceRefundMoved(payload: Pick<InvoicePaidPayload, 'invoice' | 'businessId'>): Promise<BookingPaymentStatusOutcome> {
    try {
      return await this.rederive(payload);
    } catch (err) {
      this.logger.error(`Booking paymentStatus not re-derived for invoice ${payload?.invoice?.id ?? '?'}: ${(err as Error).message}`);
      return NOTHING;
    }
  }

  private rederive(payload: Pick<InvoicePaidPayload, 'invoice' | 'businessId'>): Promise<BookingPaymentStatusOutcome> {
    return this.underBookingLock(async (tx) => {
      const booking = await this.bookingOf(tx, payload);
      if (!booking) return NOTHING;
      const unchanged = { bookingId: booking.id, paymentStatus: booking.paymentStatus, changed: false };
      if (!REDERIVES_FROM.has(booking.paymentStatus)) return unchanged;
      const target = derivePaymentStatus(await readSettlementInvoices(tx, booking.businessId, booking));
      if (target === booking.paymentStatus) return unchanged;
      const write = await tx.booking.updateMany({
        where: { id: booking.id, businessId: booking.businessId, paymentStatus: booking.paymentStatus },
        data: { paymentStatus: target },
      });
      return write.count > 0 ? { bookingId: booking.id, paymentStatus: target, changed: true } : unchanged;
    });
  }

  /** One derivation, in a transaction whose booking row lock bookingOf takes (trial-N round 2, RC-DEP-3). */
  private underBookingLock(derive: (tx: PrismaTx) => Promise<BookingPaymentStatusOutcome>): Promise<BookingPaymentStatusOutcome> {
    return this.prisma.client.$transaction((tx) => derive(tx), { timeout: DERIVATION_TX_TIMEOUT_MS });
  }

  /**
   * The booking the event's invoice belongs to (as its deposit or final
   * invoice), read under the event's business; null when the payload is
   * malformed, its invoice names another business, or the invoice is not this
   * business's (not deleted). Trial-N round 2 (RC-DEP-3): the booking is read
   * in the derivation's transaction after its row is locked (FOR NO KEY
   * UPDATE, the lock a status write takes), so the status read stays the
   * status until the transaction's own write.
   */
  private async bookingOf(tx: PrismaTx, payload: Pick<InvoicePaidPayload, 'invoice' | 'businessId'>, requireStatus?: 'PAID') {
    const businessId = payload?.businessId;
    const invoiceId = payload?.invoice?.id;
    if (!businessId || !invoiceId) return null;
    // A payload whose invoice names another business than the event is not this tenant's money.
    if (payload.invoice.businessId && payload.invoice.businessId !== businessId) return null;

    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, businessId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!invoice || (requireStatus && invoice.status !== requireStatus)) return null;

    await tx.$queryRaw`SELECT id FROM bookings WHERE business_id = ${businessId} AND deleted_at IS NULL AND (invoice_id = ${invoiceId} OR deposit_invoice_id = ${invoiceId}) FOR NO KEY UPDATE`;
    const booking = await tx.booking.findFirst({
      where: { businessId, deletedAt: null, OR: [{ invoiceId }, { depositInvoiceId: invoiceId }] },
      select: { id: true, invoiceId: true, depositInvoiceId: true, paymentStatus: true },
    });
    return booking ? { ...booking, businessId } : null;
  }

  private apply(payload: InvoicePaidPayload): Promise<BookingPaymentStatusOutcome> {
    return this.underBookingLock(async (tx) => {
      const booking = await this.bookingOf(tx, payload, 'PAID');
      if (!booking) return NOTHING;
      const businessId = booking.businessId;

      const target = derivePaymentStatus(await readSettlementInvoices(tx, businessId, booking));
      if (target === 'UNPAID') {
        return { bookingId: booking.id, paymentStatus: booking.paymentStatus, changed: false };
      }
      const write = await tx.booking.updateMany({
        where: { id: booking.id, businessId, paymentStatus: { in: ADVANCES_FROM[target] } },
        data: { paymentStatus: target },
      });
      if (write.count > 0) {
        return { bookingId: booking.id, paymentStatus: target, changed: true };
      }
      return { bookingId: booking.id, paymentStatus: booking.paymentStatus, changed: false };
    });
  }
}
