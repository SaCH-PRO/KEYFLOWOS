import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RevenuePostingService } from '../finance/revenue-posting.service';
import { ExpensePostingService } from '../finance/expense-posting.service';
import { fromCents, readTotalCents, sumMoney, toCents } from './money';

/**
 * Currency-aware rounding to cents, half away from zero on the decimal value
 * (V1-22: 1.005 -> 1.01; the float `Math.round(x * 100) / 100` it replaces
 * read 1.00). Lives in ./money; re-exported here for its existing importers.
 */
export { roundMoney } from './money';

/**
 * Canonical invoice statuses. Mirrors the string-typed `Invoice.status`
 * column in the schema; the workflow service is the single owner of all
 * transitions between these states.
 */
export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'VOID'
  | 'FAILED'
  | 'PENDING';

/**
 * The statuses an invoice may be shown in to someone who holds only its id or
 * share token: the customer-facing surfaces (`GET /commerce/invoices/:id`, the
 * token pay link, `GET /payments/invoice/:id/status`). Anything else — DRAFT,
 * VOID, FAILED, PENDING — must answer exactly like an unknown id, because the
 * answer itself (that the id exists, what state it is in, what it is worth) is
 * the disclosure. KF-REVENUE-AUTH-PROJECTION-001 review (ST-3): the status
 * route carried its own copy of this rule and had lost it; one list now.
 */
export const SHAREABLE_INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> = ['SENT', 'PAID', 'OVERDUE', 'PARTIALLY_PAID'];

export function isShareableInvoiceStatus(status: string): boolean {
  return (SHAREABLE_INVOICE_STATUSES as ReadonlyArray<string>).includes(status);
}

/**
 * Allowed transitions. Server-side enforcement; UI/clients can request
 * a transition but the workflow throws 409 ConflictException for anything
 * not in this map.
 */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  DRAFT: new Set<InvoiceStatus>(['SENT', 'VOID']),
  SENT: new Set<InvoiceStatus>(['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'FAILED', 'PENDING']),
  PENDING: new Set<InvoiceStatus>(['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'FAILED']),
  PARTIALLY_PAID: new Set<InvoiceStatus>(['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'FAILED']),
  OVERDUE: new Set<InvoiceStatus>(['PARTIALLY_PAID', 'PAID', 'VOID', 'FAILED']),
  FAILED: new Set<InvoiceStatus>(['SENT', 'PARTIALLY_PAID', 'PAID', 'VOID']),
  // PAID can be re-opened to PARTIALLY_PAID by a refund (driven by
  // reconcileFromPayments after a refund row lands). All other transitions
  // out of PAID are terminal for transition() callers; a full refund's
  // return to SENT is the reconcile's alone (REFUND_REOPENS_TO_SENT, V1-29).
  PAID: new Set<InvoiceStatus>(['PARTIALLY_PAID']),
  VOID: new Set<InvoiceStatus>([]),
};

/**
 * V1-29-DM-REFUND-CONVENTION (D-14): the statuses a refund returns to SENT
 * once nothing net is left received. There is no REFUNDED invoice state (the
 * InvoiceStatus enum has none; adding one would be a migration): a fully
 * refunded invoice is owed again, so it is SENT with paidAt cleared. Only the
 * payment rows can drive this move (reconcileFromPayments); the generic
 * transition map above keeps PAID -> SENT illegal, so no UI or status route
 * can un-pay an invoice whose money is still recorded as received.
 */
const REFUND_REOPENS_TO_SENT: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['PAID', 'PARTIALLY_PAID']);

/**
 * V1-42-DM-LIFECYCLE-OWNER-CAS: the statuses the AI undo
 * (CommerceService.undoInvoice) returns to DRAFT: every status but DRAFT
 * (soft-deleted instead) and VOID (terminal, so undoing it is a 409). The undo
 * has always put an invoice back to DRAFT for a person to review
 * (payments-mark-paid MP-16, payments-manual PM-20); it now does so here,
 * compare-and-set, rather than by a raw write in CommerceService.
 *
 * V1-42 review (SEC-V42-1, CR-V42-3): the undo stays non-terminal. The packet
 * voided an issued invoice (SENT, PENDING, OVERDUE, FAILED) instead, but VOID
 * is terminal, and both callers (POST /ai/businesses/:businessId/agent/undo/
 * :undoId and the plan-step undo) check no revenue scope and never bind the
 * undo's tenant to the route's, so a member without revenue authority, or
 * another tenant's owner, could void an invoice for good. Choosing by status
 * also voided an OVERDUE or FAILED invoice a payment had touched, reversing its
 * whole receivable while the payment stayed. Until those routes require
 * revenue:write and bind the tenant (a follow-up packet; they are outside
 * V1-42), every undone invoice returns to DRAFT: status only, no posting, no
 * event. Its payments and its accrual recognition stay as they are, so
 * re-issuing it posts nothing twice (RevenuePostingService.onInvoiceFinalized
 * is idempotent per invoice) and voiding it later reverses the recognition
 * once.
 */
const UNDO_RETURNS_TO_DRAFT: ReadonlySet<string> = new Set<string>([
  'SENT',
  'PENDING',
  'OVERDUE',
  'FAILED',
  'PAID',
  'PARTIALLY_PAID',
  'PARTIALLY_CREDITED',
  'FULLY_CREDITED',
  'PARTIAL',
]);

export interface PaymentLike {
  amount: number;
  status: string; // 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REFUNDED'
}

export interface BalanceSummary {
  total: number;
  paid: number;
  refunded: number;
  net: number;
  remaining: number;
  isFullyPaid: boolean;
  isOverpaid: boolean;
}

/**
 * Compute the canonical invoice balance from the invoice total + payment rows.
 * - SUCCESSFUL contributes positively
 * - REFUNDED contributes negatively (refund rows are stored with negative
 *   `amount` by convention; we abs them so the sign convention is irrelevant)
 * - PENDING / FAILED are ignored
 *
 * V1-29 (M28, D-14): every refund, manual or provider, is a separate negative
 * REFUNDED row beside the SUCCESSFUL original, which stays SUCCESSFUL, so the
 * refunded money is in `paid` once and in `refunded` once: 100 paid and 100
 * refunded is net 0, remaining 100. A row written before V1-29 by the manual
 * refund flipped its original to REFUNDED (a positive REFUNDED row with no
 * SUCCESSFUL twin) and is still read sign-agnostically here, i.e. subtracted
 * twice; stored Payment rows are therefore read through balanceOfStoredRows,
 * which reads such a row as the payment plus its refund (V1-29 review
 * CR-V29-4). Mark-paid still refuses an invoice carrying one (CommerceService
 * .markPaidRemaining). Nothing writes such a row any more.
 *
 * `remaining` is clamped at zero (overpayments don't drive remaining negative).
 * `isOverpaid` flags overpayment for downstream surfacing.
 *
 * V1-22-DM-MONEY-CENTS (M23, D-13): every figure is integer cents. `paid` and
 * `refunded` are the exact decimal sums of their rows rounded once to cents
 * (sumMoney), the total is rounded to cents half away from zero, and PAID /
 * overpaid are exact cent comparisons: no float sum, no +/-0.005 tolerance.
 * Three payments of 33.33 and one of 0.01 settle 100.00 exactly.
 *
 * V1-22 review (CR-V22-1): the total is read by readTotalCents. A whole-cent
 * total (every V1-22 write) has one reading. A legacy total that is not a
 * whole cent (8.36 + 12.5% stored as 9.405) is shown as its decimal rounded
 * half away from zero (9.41) but is settled by the reading the base settled it
 * with too (9.40, what mark-paid recorded), so a stored PAID invoice stays PAID
 * with nothing remaining; it is overpaid only above both readings.
 * `remaining` is 0 exactly when `isFullyPaid`, otherwise total - net.
 */
export function computeBalance(total: number, payments: PaymentLike[], currency = 'TTD'): BalanceSummary {
  void currency; // every currency in scope (D-13: TTD, USD) has 2 decimals
  const paid = sumMoney(payments.filter((p) => p.status === 'SUCCESSFUL').map((p) => Number(p.amount) || 0));
  const refunded = sumMoney(
    payments.filter((p) => p.status === 'REFUNDED').map((p) => Math.abs(Number(p.amount) || 0)),
  );
  const t = readTotalCents(total);
  const netCents = toCents(paid) - toCents(refunded);
  const isFullyPaid = netCents >= t.settleCents;
  return {
    total: fromCents(t.cents),
    paid,
    refunded,
    net: fromCents(netCents),
    remaining: isFullyPaid ? 0 : fromCents(Math.max(0, t.cents - netCents)),
    isFullyPaid,
    isOverpaid: netCents > t.maxCents,
  };
}

/**
 * V1-29 review (CR-V29-4): stored Payment rows as the balance reads them.
 * Before V1-29 the manual refund flipped its original row to REFUNDED and
 * kept the positive amount; computeBalance, which reads refunds whatever
 * their sign, then dropped that row from `paid` and subtracted it again (60
 * paid and refunded on a 100 invoice: net -60, remaining 160). Every refund
 * writer since (the Stripe and PayPal refund webhooks, refundCharge, the
 * manual refund) writes a separate NEGATIVE REFUNDED row beside a SUCCESSFUL
 * original, so a positive REFUNDED row in the table is such a flipped
 * original. It is read as what it stands for under D-14: the payment
 * received (SUCCESSFUL) plus its refund (a negative REFUNDED row of the same
 * amount), counted once in `paid` and once in `refunded`, net 0. Every other
 * row passes unchanged, so for rows written since V1-29 this is computeBalance
 * itself. computeBalance alone stays sign-agnostic for figures that are not
 * stored rows.
 */
export function readStoredPayments(rows: ReadonlyArray<{ amount: number | string; status: string }>): PaymentLike[] {
  return rows.flatMap((p): PaymentLike[] => {
    const amount = Number(p.amount) || 0;
    if (p.status === 'REFUNDED' && amount > 0) {
      return [
        { amount, status: 'SUCCESSFUL' },
        { amount: -amount, status: 'REFUNDED' },
      ];
    }
    return [{ amount, status: p.status }];
  });
}

/**
 * computeBalance over stored Payment rows (readStoredPayments): the balance
 * the reconcile derives the status from and every operator and public
 * balance read in CommerceService serves (V1-29 review CR-V29-4).
 */
export function balanceOfStoredRows(
  total: number,
  rows: ReadonlyArray<{ amount: number | string; status: string }>,
  currency?: string | null,
): BalanceSummary {
  return computeBalance(total, readStoredPayments(rows), currency ?? undefined);
}

/**
 * V1-36-DM-BALANCE-READ-CONTRACT (CF-17): the same contract for a figure that
 * is summed in the database (money received in a period, across invoices).
 * The Payment rows whose amounts add up to balanceOfStoredRows(...).net: the
 * SUCCESSFUL rows (money in) and the negative REFUNDED rows (money out, D-14).
 * A positive REFUNDED row, flipped before V1-29, stands for its payment plus
 * its refund (net 0, readStoredPayments) and is left out; PENDING and FAILED
 * rows are not cash. So `_sum.amount` over `{ ...where, ...CASH_NET_PAYMENT_WHERE }`
 * is the cash received net of refunds, the ledger's cash net for those
 * payments; round it with roundMoney. It equals the sum of the rows' nets
 * exactly for whole-cent rows (every row written since V1-22); a legacy
 * sub-cent row may move it by one cent (computeBalance rounds paid and
 * refunded separately, one sum rounds once). Summing SUCCESSFUL rows alone counted
 * refunded money as received (balance-arithmetic.spec.ts ratchets that form
 * out and pins this filter to balanceOfStoredRows). It carries an `OR`: spread
 * it into a where that has none of its own.
 */
export const CASH_NET_PAYMENT_WHERE = {
  OR: [{ status: 'SUCCESSFUL' }, { status: 'REFUNDED', amount: { lt: 0 } }],
} satisfies Prisma.PaymentWhereInput;

/**
 * Compute the resulting invoice status after a payment is applied. Pure
 * function — no DB. Used by `applyPayment` and by tests.
 *
 * V1-29 (D-14): a refund that leaves nothing net received (net <= 0 with a
 * refund on the invoice) returns a PAID or PARTIALLY_PAID invoice to SENT.
 * The base reopened only on a positive net, so a full refund left the
 * invoice PAID. SENT, OVERDUE and the statuses outside the payment flow keep
 * their status; with no refund a non-positive net changes nothing.
 */
export function deriveStatusAfterPayment(
  currentStatus: InvoiceStatus,
  balance: BalanceSummary,
): InvoiceStatus {
  if (currentStatus === 'VOID') return 'VOID';
  if (balance.isFullyPaid) return 'PAID';
  // Refund reopening: PAID drops below total -> PARTIALLY_PAID.
  if (balance.net > 0) return 'PARTIALLY_PAID';
  if (balance.refunded > 0 && REFUND_REOPENS_TO_SENT.has(currentStatus)) return 'SENT';
  return currentStatus;
}

/**
 * V1-42-DM-LIFECYCLE-OWNER-CAS: run a status write whose `where` carries the
 * status the caller read (`{ id, status: <read> }`). When that row no longer
 * holds that status (another writer committed in between), Prisma finds no
 * record to update (P2025) and the move is refused 409: nothing is written,
 * the caller's transaction rolls back, and no event or posting follows.
 */
async function compareAndSet<T>(write: () => Promise<T>, conflict: string): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2025') throw new ConflictException(conflict);
    throw err;
  }
}

export function isLegalTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * The moves reconcileFromPayments may make: the transition map, plus a
 * refund's return to SENT (V1-29, D-14), which only the payment rows drive.
 */
export function isLegalReconcileTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return isLegalTransition(from, to) || (to === 'SENT' && REFUND_REOPENS_TO_SENT.has(from));
}

@Injectable()
export class InvoiceWorkflowService {
  private readonly logger = new Logger(InvoiceWorkflowService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(RevenuePostingService) private readonly revenuePosting: RevenuePostingService,
    @Inject(ExpensePostingService) private readonly expensePosting: ExpensePostingService,
  ) {}

  /**
   * FIN3 — post the COGS leg (Dr COGS / Cr Inventory) for an invoice
   * that just transitioned to PAID. Hydrates product line items and
   * delegates to ExpensePostingService inside `txClient` (or the
   * default client) so the posting commits with the invoice update.
   * Skipped silently when no inventory tracking exists for the product
   * (FIN3 architectural rule — never fabricate cost values).
   */
  private async postCogsForPaidInvoice(
    invoiceId: string,
    businessId: string,
    paidAt: Date | null,
    currency: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txClient?: any,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (txClient ?? this.prisma.client) as any;
    const items: Array<{ productId: string | null; quantity: number }> = await db.invoiceItem.findMany({
      where: { invoiceId },
      select: { productId: true, quantity: true },
    });
    const productItems = items
      .filter((i: { productId: string | null; quantity: number }) => i.productId && i.quantity > 0)
      .map((i: { productId: string | null; quantity: number }) => ({ productId: i.productId as string, quantity: i.quantity }));
    if (productItems.length === 0) return;
    await this.expensePosting.onProductSold(
      {
        businessId,
        sourceType: 'Invoice',
        sourceId: invoiceId,
        date: paidAt ?? new Date(),
        currency,
        items: productItems,
      },
      txClient,
    );
  }

  /**
   * Throws 409 if `to` is not reachable from `from`. Pure check, useful from
   * controllers that already loaded the invoice.
   */
  assertLegalTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (!isLegalTransition(from, to)) {
      throw new ConflictException(
        `Illegal invoice status transition: ${from} -> ${to}`,
      );
    }
  }

  /** Loads invoice + payments and returns the canonical balance summary. */
  async getBalance(invoiceId: string): Promise<BalanceSummary> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return balanceOfStoredRows(Number(invoice.total), invoice.payments, invoice.currency);
  }

  /**
   * Recompute status from payments and persist if it changed. Centralises
   * the PARTIALLY_PAID / PAID transition path used by every webhook + the
   * manual recordPayment flow. Returns the updated invoice + balance.
   *
   * R0-PL-03: takes the same `tx` / `eventBuffer` options as `transition`.
   * With `tx`, the read, the status write and the COGS posting all run on
   * the caller's transaction, so the caller's payment write and this
   * reconcile commit or roll back together (an illegal transition, e.g. a
   * payment on a DRAFT invoice, rolls the payment back). With `eventBuffer`,
   * invoice.paid / invoice.payment_recorded / invoice.reopened (a refund's
   * return to SENT, V1-42c) are pushed to the buffer and the caller emits
   * them after its commit. Without options the behaviour is unchanged: own
   * $transaction, immediate emit.
   *
   * R0-PL-03 review (ST-PL03-3 / CR-1): `onIllegalTransition` says what to do
   * when the status derived from the payment rows is not reachable from the
   * current one (DRAFT -> PARTIALLY_PAID, or any move out of a status the
   * transition map does not know: PARTIALLY_CREDITED, FULLY_CREDITED,
   * PARTIAL). 'throw' (default, payments and webhooks): 409. 'keep' (the
   * manual refund): leave the status as it is, write nothing, queue no event,
   * and return changed: false with the fresh balance.
   */
  async reconcileFromPayments(
    invoiceId: string,
    extra: {
      tx?: Prisma.TransactionClient;
      eventBuffer?: Array<{ name: string; payload: unknown }>;
      onIllegalTransition?: 'throw' | 'keep';
    } = {},
  ): Promise<{ status: InvoiceStatus; balance: BalanceSummary; changed: boolean }> {
    const reader = extra.tx ?? (this.prisma.client as unknown as Prisma.TransactionClient);
    const invoice = await reader.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    // V1-29 review (CR-V29-4): a row the manual refund flipped before V1-29
    // is read as its payment plus its refund, not subtracted twice.
    const balance = balanceOfStoredRows(Number(invoice.total), invoice.payments, invoice.currency);
    const current = invoice.status as InvoiceStatus;
    const next = deriveStatusAfterPayment(current, balance);
    if (next === current) {
      return { status: current, balance, changed: false };
    }
    if (!isLegalReconcileTransition(current, next)) {
      if (extra.onIllegalTransition === 'keep') {
        this.logger.warn(
          `reconcileFromPayments: invoice ${invoiceId} kept at ${current}; ${current} -> ${next} is not a legal transition (net ${balance.net} of ${balance.total})`,
        );
        return { status: current, balance, changed: false };
      }
      this.assertLegalTransition(current, next);
    }
    // V1-29 (D-14): paidAt says when the invoice was settled. A refund that
    // reopens it (PAID -> PARTIALLY_PAID, or back to SENT) clears it, and
    // the next settlement stamps it again.
    const paidAt = next === 'PAID' ? { paidAt: new Date() } : current === 'PAID' || next === 'SENT' ? { paidAt: null } : {};
    // FIN3 — wrap status update + COGS posting in a single $transaction
    // so a posting failure rolls back the PAID write. Listeners only see
    // PAID after the ledger entries have been committed alongside it.
    const apply = async (db: Prisma.TransactionClient) => {
      const u = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          status: next,
          ...paidAt,
        },
        include: { items: true, contact: true, booking: true },
      });
      if (next === 'PAID') {
        await this.postCogsForPaidInvoice(invoiceId, u.businessId, u.paidAt, u.currency, db);
      }
      return u;
    };
    const updated = extra.tx
      ? await apply(extra.tx)
      : await this.prisma.client.$transaction((tx) => apply(tx as unknown as Prisma.TransactionClient));
    const queue = (name: string, payload: unknown) => {
      if (extra.eventBuffer) extra.eventBuffer.push({ name, payload });
      else this.events.emit(name, payload);
    };
    if (next === 'PAID') {
      queue('invoice.paid', {
        invoice: updated,
        businessId: updated.businessId,
        eventName: 'invoice.paid',
      });
    } else if (next === 'PARTIALLY_PAID') {
      queue('invoice.payment_recorded', {
        invoice: updated,
        businessId: updated.businessId,
        balance,
        eventName: 'invoice.payment_recorded',
      });
    } else if (next === 'SENT') {
      // V1-42c-INVOICE-STATUS-EVENTS (VR-05): a refund's D-14 reopen to SENT
      // (REFUND_REOPENS_TO_SENT, the only way the reconcile reaches SENT) is
      // a status change its listeners must see: the calendar projection kept
      // a fully refunded invoice's due item COMPLETED. It is invoice.reopened,
      // never invoice.sent, so the customer is not emailed or notified again;
      // it is queued on the same post-commit path as invoice.paid and
      // invoice.payment_recorded.
      queue('invoice.reopened', {
        invoice: updated,
        businessId: updated.businessId,
        status: next,
        previousStatus: current,
        balance,
        eventName: 'invoice.reopened',
      });
    }
    return { status: next, balance, changed: true };
  }

  /**
   * Generic transition entry-point used by callers that already know the
   * target status (UI mark-paid, void, send, mark-overdue scheduler, etc).
   * Enforces the allowed-transitions map and emits the matching event.
   *
   * V1-42-DM-LIFECYCLE-OWNER-CAS (CF-39): one caller wins a move. The status
   * is written compare-and-set on the status this call read
   * (`UPDATE ... WHERE id = $1 AND status = <read>`): a concurrent writer that
   * committed in between (a second transition, a payment's reconcile) leaves
   * nothing to update, and this call is refused 409 with no write, posting or
   * event. A move to the status the invoice already holds is refused 409 too
   * (the loser of a race that read after the winner committed), except the
   * map's explicit self-moves (PARTIALLY_PAID -> PARTIALLY_PAID). So of two
   * transition(id, 'OVERDUE') calls exactly one succeeds and invoice.overdue
   * is emitted once, whatever the interleaving.
   */
  async transition(
    invoiceId: string,
    to: InvoiceStatus,
    extra: {
      sentAt?: Date;
      dueDate?: Date | null;
      paidAt?: Date;
      tx?: Prisma.TransactionClient;
      /**
       * When provided, events are pushed to this buffer instead of being
       * emitted synchronously. Callers using a Prisma $transaction MUST
       * pass a buffer and emit it post-commit so listeners never observe
       * uncommitted state on rollback.
       */
      eventBuffer?: Array<{ name: string; payload: unknown }>;
    } = {},
  ) {
    // Wrap in $transaction when caller did not provide one so the FIN2
    // posting either commits with the status update or rolls both back.
    const run = async (db: Prisma.TransactionClient) => {
      const existing = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, status: true, businessId: true },
      });
      if (!existing) throw new NotFoundException('Invoice not found');
      const from = existing.status as InvoiceStatus;
      this.assertLegalTransition(from, to);
      if (from === to && !ALLOWED_TRANSITIONS[from]?.has(to)) {
        throw new ConflictException(`Invoice is already ${to}`);
      }

      const data: Record<string, unknown> = { status: to };
      if (extra.sentAt) data.sentAt = extra.sentAt;
      if (extra.dueDate !== undefined) data.dueDate = extra.dueDate;
      if (to === 'PAID') data.paidAt = extra.paidAt ?? new Date();

      // V1-42: compare-and-set on the status read above (see the doc comment).
      const updated = await compareAndSet(
        () =>
          db.invoice.update({
            where: { id: invoiceId, status: existing.status },
            data,
            include: { items: true, contact: true, booking: true },
          }),
        `Invoice status changed while ${from} -> ${to} was in flight; reload it and try again`,
      );

      // FIN2 — accrual recognition: post AR/Revenue when an invoice goes
      // SENT (or PENDING, which is the awaiting-confirmation flavour of
      // SENT for offline payments), and reverse the recognition when
      // voided. Cash-basis businesses no-op inside the posting service.
      if (to === 'SENT' || to === 'PENDING') {
        await this.revenuePosting.onInvoiceFinalized(invoiceId, { tx: db });
      } else if (to === 'VOID') {
        await this.revenuePosting.onInvoiceVoided(invoiceId, { tx: db });
      }

      return updated;
    };

    const updated = extra.tx
      ? await run(extra.tx)
      : await this.prisma.client.$transaction((tx) => run(tx as unknown as Prisma.TransactionClient));

    const lower = to.toLowerCase();
    const queue = (name: string, payload: unknown) => {
      if (extra.eventBuffer) extra.eventBuffer.push({ name, payload });
      else this.events.emit(name, payload);
    };
    if (to === 'PAID') {
      // FIN3 — same atomicity rule as reconcileFromPayments: COGS must
      // be posted in the same tx as the status flip. If the caller
      // passed a tx, ExpensePostingService runs against that tx; if
      // not, it runs against the default client right after the update.
      await this.postCogsForPaidInvoice(
        invoiceId,
        updated.businessId,
        updated.paidAt,
        updated.currency,
        extra.tx,
      );
      queue('invoice.paid', {
        invoice: updated,
        businessId: updated.businessId,
        eventName: 'invoice.paid',
      });
    } else if (to === 'SENT' || to === 'OVERDUE' || to === 'VOID') {
      queue(`invoice.${lower}`, {
        invoice: updated,
        businessId: updated.businessId,
        status: to,
        eventName: `invoice.${lower}`,
      });
    } else if (to === 'FAILED') {
      queue('invoice.payment_failed', {
        invoice: updated,
        businessId: updated.businessId,
        eventName: 'invoice.payment_failed',
      });
    }
    return updated;
  }

  /**
   * V1-42: the AI undo's return of an invoice to DRAFT, for the statuses in
   * UNDO_RETURNS_TO_DRAFT (every one but DRAFT and VOID). Compare-and-set like
   * transition(); writes the status alone, with no posting and no event,
   * exactly as the undo did before it moved here. Any other status is a 409:
   * CommerceService.undoInvoice soft-deletes a DRAFT, and VOID is terminal.
   * Non-terminal on purpose until its callers are guarded (V1-42 review
   * SEC-V42-1, see UNDO_RETURNS_TO_DRAFT).
   */
  async returnToDraftOnUndo(invoiceId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
      if (!existing) throw new NotFoundException('Invoice not found');
      if (!UNDO_RETURNS_TO_DRAFT.has(existing.status)) {
        throw new ConflictException(`A ${existing.status} invoice cannot be undone to DRAFT`);
      }
      return compareAndSet(
        () => tx.invoice.update({ where: { id: invoiceId, status: existing.status }, data: { status: 'DRAFT' } }),
        'Invoice status changed while it was being undone; reload it and try again',
      );
    });
  }

  /**
   * Idempotent webhook ingestion guard. Returns true if this is the first
   * time we've seen the (provider, providerEventId) pair; false if it's a
   * replay. Callers should short-circuit (ack 200, do nothing) on false.
   */
  async assertNewProviderEvent(
    provider: string,
    providerEventId: string | undefined,
    eventType?: string,
    businessId?: string | null,
  ): Promise<boolean> {
    if (!providerEventId) return true; // Some legacy WiPay callbacks have no event id; fall through to per-row dedup.
    try {
      await this.prisma.client.webhookEvent.create({
        data: {
          provider,
          providerEventId,
          eventType: eventType ?? null,
          businessId: businessId ?? null,
        },
      });
      return true;
    } catch (e: unknown) {
      // P2002 unique-constraint -> already processed.
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') {
        this.logger.log(
          `Duplicate ${provider} webhook ${providerEventId} (${eventType ?? 'unknown'}) — ignored`,
        );
        return false;
      }
      throw e;
    }
  }
}
