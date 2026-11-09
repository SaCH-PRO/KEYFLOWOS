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
  | 'PENDING'
  // V1-44 (owner ruling D-28): credit-note states; only CREDIT_TRANSITIONS moves into or out of them.
  | 'PARTIALLY_CREDITED'
  | 'FULLY_CREDITED';

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
  // V1-44 (D-28): no transition() caller and no payment reconcile moves into
  // or out of a credited state; credit notes alone do (CREDIT_TRANSITIONS).
  PARTIALLY_CREDITED: new Set<InvoiceStatus>([]),
  FULLY_CREDITED: new Set<InvoiceStatus>([]),
};

/**
 * V1-44-DM-CREDIT-NOTE (CF-42, owner ruling D-28): FULLY_CREDITED and
 * PARTIALLY_CREDITED are real invoice states, driven by credit notes that post
 * to the ledger (no enum migration: InvoiceStatus has carried both all along).
 * These are the moves an applied or voided credit note makes, through
 * reconcileFromCredits only (CreditNoteService writes no Invoice.status):
 *
 *   - an issued invoice (SENT, PENDING, OVERDUE, FAILED, PARTIALLY_PAID, PAID)
 *     may be credited in part or in full (a paid deposit part-credited is what
 *     V1-28's depositPosition reads);
 *   - a credited invoice moves between the credited states as notes are
 *     applied and voided, and once its last APPLIED note is voided returns to
 *     the status its payment rows give it: SENT, PARTIALLY_PAID or PAID (an
 *     OVERDUE one is SENT again and the overdue scheduler re-flips it);
 *   - DRAFT and VOID are never credited, and a credit note never voids an
 *     invoice or returns it to DRAFT.
 */
const CREDITED_STATUSES: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['PARTIALLY_CREDITED', 'FULLY_CREDITED']);
const CREDIT_TRANSITIONS: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  DRAFT: new Set<InvoiceStatus>([]),
  SENT: CREDITED_STATUSES,
  PENDING: CREDITED_STATUSES,
  OVERDUE: CREDITED_STATUSES,
  FAILED: CREDITED_STATUSES,
  PARTIALLY_PAID: CREDITED_STATUSES,
  PAID: CREDITED_STATUSES,
  PARTIALLY_CREDITED: new Set<InvoiceStatus>(['PARTIALLY_CREDITED', 'FULLY_CREDITED', 'SENT', 'PARTIALLY_PAID', 'PAID']),
  FULLY_CREDITED: new Set<InvoiceStatus>(['PARTIALLY_CREDITED', 'SENT', 'PARTIALLY_PAID', 'PAID']),
  VOID: new Set<InvoiceStatus>([]),
};

/** V1-44: whether a credit note may move an invoice from `from` to `to` (CREDIT_TRANSITIONS). */
export function isLegalCreditTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return CREDIT_TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * V1-44 (D-28): the invoice status once its APPLIED credit notes sum to
 * `credited`. Pure. Compared in integer cents (D-13): credited short of the
 * total is PARTIALLY_CREDITED, reaching it FULLY_CREDITED, whatever was paid.
 * With nothing credited, a credited invoice (its last note voided) takes the
 * status its payment rows give it (SENT, PARTIALLY_PAID, PAID); any other
 * status is left as it is.
 */
export function deriveStatusAfterCredit(
  current: InvoiceStatus,
  total: number,
  credited: number,
  balance: BalanceSummary,
): InvoiceStatus {
  const creditedCents = toCents(Number(credited) || 0);
  if (creditedCents > 0) return creditedCents >= readTotalCents(total).cents ? 'FULLY_CREDITED' : 'PARTIALLY_CREDITED';
  if (!CREDITED_STATUSES.has(current)) return current;
  if (balance.isFullyPaid) return 'PAID';
  if (balance.net > 0) return 'PARTIALLY_PAID';
  return 'SENT';
}

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
 * Trial-N round 2 (RC-DEP-2): an invoice's Payment rows of its own tenant.
 * Payment sits outside the tenant extension and has no FK to Business (M31),
 * so a row carrying another businessId is not this invoice's money, as the
 * receipt, receivables and payments-ops balance readers (SEC-V29B-1,
 * SEC-V49-1) and the booking settlement (trial-N N1-SEC) already read it.
 */
export function ownTenantPayments<T extends { businessId: string }>(invoice: { businessId: string; payments: T[] }): T[] {
  return invoice.payments.filter((p) => p.businessId === invoice.businessId);
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

  /**
   * Loads invoice + payments and returns the canonical balance summary, over
   * the invoice's own-tenant rows (trial-N round 2, RC-DEP-2: ownTenantPayments).
   */
  async getBalance(invoiceId: string): Promise<BalanceSummary> {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return balanceOfStoredRows(Number(invoice.total), ownTenantPayments(invoice), invoice.currency);
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
   * them after its commit. Without options: own $transaction, events emitted
   * after it commits.
   *
   * R0-PL-03 review (ST-PL03-3 / CR-1): `onIllegalTransition` says what to do
   * when the status derived from the payment rows is not reachable from the
   * current one (DRAFT -> PARTIALLY_PAID, or any move out of a status the
   * transition map does not know: PARTIAL). 'throw' (default, payments and
   * webhooks): 409. 'keep' (the manual refund): leave the status as it is,
   * write nothing, queue no event, and return changed: false with the fresh
   * balance. A credited invoice (PARTIALLY_CREDITED, FULLY_CREDITED) is
   * reconciled by reconcileCreditedFromPayments (V1-44 review CR-V44-1): it
   * keeps its status and refuses, or under 'keep' keeps, only money beyond
   * what its credit notes leave owing.
   *
   * V1-42c review (SEC-V42C-1): one move, one event. The provider webhooks
   * call this without a transaction, after their payment / refund commit and
   * outside the invoice lock, so two deliveries could reconcile side by side:
   * each read PAID, each wrote SENT by id alone, each returned changed: true
   * and each queued invoice.reopened (and a reconcile that read before a
   * money door committed a payment wrote SENT over the PAID that door left).
   * Without `tx` the read, the write and the posting now run in one
   * transaction under the invoice row lock every money write takes
   * (SELECT ... FOR NO KEY UPDATE, as CommerceService.lockInvoiceForPayment
   * and PaymentsService.lockInvoice), so reconciles of one invoice run one
   * after the other and each reads every payment committed before it. With
   * `tx`, the caller's door holds that lock already. Either way the status
   * write is compare-and-set on the status read, as transition() (V1-42): a
   * writer that moved it in between leaves nothing to update, and this call
   * returns changed: false with no write, posting or event.
   */
  async reconcileFromPayments(
    invoiceId: string,
    extra: {
      tx?: Prisma.TransactionClient;
      eventBuffer?: Array<{ name: string; payload: unknown }>;
      onIllegalTransition?: 'throw' | 'keep';
    } = {},
  ): Promise<{ status: InvoiceStatus; balance: BalanceSummary; changed: boolean }> {
    if (extra.tx) return this.reconcileIn(extra.tx, invoiceId, extra);
    const buffer: Array<{ name: string; payload: unknown }> = extra.eventBuffer ?? [];
    const result = await this.prisma.client.$transaction(async (t) => {
      const tx = t as unknown as Prisma.TransactionClient;
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR NO KEY UPDATE`;
      return this.reconcileIn(tx, invoiceId, { ...extra, eventBuffer: buffer });
    });
    if (!extra.eventBuffer) for (const e of buffer) this.events.emit(e.name, e.payload);
    return result;
  }

  private async reconcileIn(
    db: Prisma.TransactionClient,
    invoiceId: string,
    extra: {
      eventBuffer?: Array<{ name: string; payload: unknown }>;
      onIllegalTransition?: 'throw' | 'keep';
    },
  ): Promise<{ status: InvoiceStatus; balance: BalanceSummary; changed: boolean }> {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    // V1-29 review (CR-V29-4): a row the manual refund flipped before V1-29
    // is read as its payment plus its refund, not subtracted twice.
    // Trial-N round 2 (RC-DEP-2): the status is derived from the invoice's
    // own-tenant rows. Every row on the invoice was read, so a SUCCESSFUL row
    // tagged with another business moved it to PAID (and a booking deposit's
    // PAID status is what it holds and forfeits, D-26), and a foreign negative
    // REFUNDED row reopened it.
    const balance = balanceOfStoredRows(Number(invoice.total), ownTenantPayments(invoice), invoice.currency);
    const current = invoice.status as InvoiceStatus;
    if (CREDITED_STATUSES.has(current)) {
      return this.reconcileCreditedFromPayments(db, invoice, current, balance, extra);
    }
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
    // FIN3 — status update + COGS posting in one transaction (`db`) so a
    // posting failure rolls back the PAID write. Listeners only see PAID
    // after the ledger entries have been committed alongside it.
    // V1-42c review (SEC-V42C-1): compare-and-set on the status read above.
    let updated;
    try {
      updated = await db.invoice.update({
        where: { id: invoiceId, status: invoice.status },
        data: {
          status: next,
          ...paidAt,
        },
        include: { items: true, contact: true, booking: true },
      });
    } catch (err) {
      if ((err as { code?: string } | null)?.code !== 'P2025') throw err;
      const now = await db.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
      this.logger.warn(
        `reconcileFromPayments: invoice ${invoiceId} moved from ${current} while ${current} -> ${next} was in flight (now ${now?.status ?? 'gone'}); left as it is, no event`,
      );
      return { status: (now?.status ?? current) as InvoiceStatus, balance, changed: false };
    }
    if (next === 'PAID') {
      await this.postCogsForPaidInvoice(invoiceId, updated.businessId, updated.paidAt, updated.currency, db);
    }
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
   * V1-44 review (CR-V44-1): the payment reconcile of a credited invoice
   * (PARTIALLY_CREDITED, FULLY_CREDITED). Applying a note made these states
   * reachable, and the transition map holds no move out of them, so every
   * payment door (recordPayment, mark-paid, the V1-41 pending confirm) was
   * refused 409 and what the credit left owing could never be collected.
   *
   * Owed is the total less the APPLIED notes (in cents, D-13; the total's
   * higher reading, as isOverpaid). Money up to it is accepted: the payment,
   * its posting and its receivable reduction commit, and the status stays the
   * credited one, as deriveStatusAfterCredit holds it whatever was paid (D-28;
   * V1-28's depositPosition reads the settlement from the rows). No status
   * write, no posting, no event (paidAt: below). Money beyond it is a 409 under 'throw' (the caller's
   * payment rolls back, nothing written) and kept under 'keep' (a refund): the
   * balance readers and mark-paid's remaining do not net credits, so an
   * over-settlement here would be an over-collection nobody sees. A fully
   * credited invoice owes nothing, so a payment on it is refused as on PAID.
   *
   * W4-CREDIT-REFUND-PAIDAT (review CRB-CR-1; CR-V44-2, D-14, D-78): paidAt
   * follows the rule reconcileFromCredits uses for a credited status. The
   * status is the credited one deriveStatusAfterCredit holds whatever was
   * paid (D-78: a paid remainder stays PARTIALLY_CREDITED, and a payment moves
   * no credit), so it is not written; the invoice is settled while its own
   * payment rows net of refunds settle the total (CN-06), and otherwise it
   * holds no paidAt. A refund that unsettles a credited invoice (in full, in
   * part, or kept under 'keep' above what the credits leave owing) clears it
   * here, as reconcileIn clears it on a refund's reopen (D-14), rather than
   * at the next credit move, so one money position ends with one paidAt
   * whatever the path (CN-31). Nothing is stamped: a credited status is never
   * PAID (D-78). The write is tenant-bound and compare-and-set,
   * { id, businessId, status } as read (the invoice's own business, whose
   * rows and notes were read); a writer that moved the status in between
   * leaves it as it is (logged, as reconcileIn). No posting, no event, and
   * changed stays false (it reports a status move).
   */
  private async reconcileCreditedFromPayments(
    db: Prisma.TransactionClient,
    invoice: { id: string; businessId: string; total: unknown; paidAt?: Date | null },
    current: InvoiceStatus,
    balance: BalanceSummary,
    extra: { onIllegalTransition?: 'throw' | 'keep' },
  ): Promise<{ status: InvoiceStatus; balance: BalanceSummary; changed: boolean }> {
    const applied = await db.creditNote.aggregate({
      where: { invoiceId: invoice.id, businessId: invoice.businessId, status: 'APPLIED' },
      _sum: { amount: true },
    });
    const creditedCents = toCents(Number(applied._sum.amount ?? 0) || 0);
    const owedCents = Math.max(0, readTotalCents(Number(invoice.total)).maxCents - creditedCents);
    if (toCents(balance.net) > owedCents) {
      const detail = `net received ${balance.net} is above the ${fromCents(owedCents)} its credit notes leave owing of ${balance.total}`;
      if (extra.onIllegalTransition !== 'keep') {
        throw new ConflictException(
          `Cannot record a payment beyond what a ${current} invoice still owes after its credit notes (${fromCents(owedCents)} owed)`,
        );
      }
      this.logger.warn(`reconcileFromPayments: invoice ${invoice.id} kept at ${current}; ${detail}`);
    }
    // CRB-CR-1 (D-14, D-78): settled is the credited status while the payment rows settle the total.
    if (invoice.paidAt && !balance.isFullyPaid) {
      try {
        await db.invoice.update({
          where: { id: invoice.id, businessId: invoice.businessId, status: current },
          data: { paidAt: null },
        });
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== 'P2025') throw err;
        const now = await db.invoice.findFirst({
          where: { id: invoice.id, businessId: invoice.businessId },
          select: { status: true },
        });
        this.logger.warn(
          `reconcileFromPayments: invoice ${invoice.id} moved from ${current} while its unsettled paidAt was being cleared (now ${now?.status ?? 'gone'}); left as it is`,
        );
        return { status: (now?.status ?? current) as InvoiceStatus, balance, changed: false };
      }
    }
    return { status: current, balance, changed: false };
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
      // V1-82 (FOLLOW3-B1-VOID-NET-RECEIVED): a void takes the invoice row
      // lock (FOR NO KEY UPDATE) before it reads the status and the
      // payments. That orders it only against the doors that take the same
      // lock (recordPayment, the refund doors, reconcileFromPayments): no
      // such door commits a payment between the check below and the
      // compare-and-set. The provider settlement doors take no invoice lock
      // and this one does not stop them (review SEC-V82-1 / CR-B1-1, see
      // assertNothingReceivedNet).
      if (to === 'VOID') {
        await db.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR NO KEY UPDATE`;
      }
      const existing = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, status: true, businessId: true, total: true, currency: true },
      });
      if (!existing) throw new NotFoundException('Invoice not found');
      const from = existing.status as InvoiceStatus;
      this.assertLegalTransition(from, to);
      if (from === to && !ALLOWED_TRANSITIONS[from]?.has(to)) {
        throw new ConflictException(`Invoice is already ${to}`);
      }
      if (to === 'VOID') {
        await this.assertNothingReceivedNet(db, existing);
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
   * V1-82 (FOLLOW3-B1-VOID-NET-RECEIVED, VL-02): an invoice that still holds
   * money received net of refunds is not voided. The map lets PARTIALLY_PAID
   * move to OVERDUE and FAILED, and both of those to VOID, so a part-paid
   * invoice reached VOID with its payment SUCCESSFUL and onInvoiceVoided then
   * reversed the whole recognition: on ACCRUAL AR -40, income 0, cash 40; on
   * CASH income 40 on a VOID invoice. Every VOID writer goes through
   * transition() (the status route, bulk void and KEY's bulk path, the AI
   * void_invoice, the KEY compensations, updateInvoice), so the check lives
   * here. D-14: money received is returned by a refund row first; with
   * nothing received net (no payment, or each refunded) VOID is allowed, so
   * an OVERDUE or FAILED invoice that was never paid still voids. D-27:
   * PENDING and FAILED rows are not money received (balanceOfStoredRows reads
   * SUCCESSFUL less refunds). The rows are the invoice's own tenant's
   * (RC-DEP-2, as reconcileFromCredits reads them).
   *
   * The caller holds the invoice row lock (transition takes it first for a
   * void). That orders this read only against the doors that take the same
   * lock: CommerceService.recordPayment and recordPublicPaymentIntent
   * (lockInvoiceForPayment), the manual and provider refunds, and
   * reconcileFromPayments. Such a door either committed before the lock was
   * granted, and this read sees its payment, or waits for this decision and
   * then finds the invoice VOID (recordPayment refuses it 409).
   *
   * Review SEC-V82-1 / CR-B1-1: it does NOT order the provider settlement
   * doors. The Stripe charge / session webhook, the PayPal capture webhook,
   * the WiPay callback and capturePaypalOrder record a SUCCESSFUL payment
   * through PaymentsService.createPaymentWithPosting, which takes no invoice
   * lock and does not re-check for VOID inside its transaction. The insert's
   * foreign-key check takes FOR KEY SHARE, which FOR NO KEY UPDATE does not
   * block, so a provider payment still uncommitted when this read runs, or
   * committed after it, leaves the invoice VOID with money received net (on
   * ACCRUAL AR -40, income 0, cash 40). That gap predates V1-82 and its fix
   * lies outside this file. Follow-up: those doors take
   * PaymentsService.lockInvoice and refuse (or flag) a VOID invoice inside
   * their transaction; VN-08 in invoice-void-net-received.integration.test.ts
   * is the todo for it.
   */
  private async assertNothingReceivedNet(
    db: Prisma.TransactionClient,
    invoice: { id: string; businessId: string; status: string; total: unknown; currency: string },
  ): Promise<void> {
    const payments = await db.payment.findMany({
      where: { invoiceId: invoice.id, businessId: invoice.businessId },
      select: { amount: true, status: true },
    });
    const balance = balanceOfStoredRows(Number(invoice.total), payments, invoice.currency);
    if (balance.net > 0) {
      throw new ConflictException(
        `Cannot void a ${invoice.status} invoice that still holds ${invoice.currency} ${balance.net.toFixed(2)} received net of refunds; refund the money received first, then void it`,
      );
    }
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
   * V1-44-DM-CREDIT-NOTE (CF-42, D-28): move the invoice after a credit note
   * was applied or voided. CreditNoteService writes no Invoice.status; it calls
   * this on its own transaction, once the note's status is written, holding the
   * invoice row lock every money door takes (SELECT ... FOR NO KEY UPDATE), so
   * this reads every APPLIED note committed before it plus the caller's own.
   * The status is deriveStatusAfterCredit over the APPLIED notes and the
   * business's own payment rows; a move outside CREDIT_TRANSITIONS is a 409
   * (the caller's note and posting roll back with it), and the write is
   * compare-and-set on the status read, as transition() (V1-42). No posting
   * (the note's is the caller's) and no event: no listener reads a credit move,
   * and an invoice returning to PAID was paid already (no second invoice.paid,
   * receipt or COGS).
   *
   * W3-CREDIT-RECONCILE-BIND (V1-44 review SEC-V44-6, function half): the
   * invoice is locked and read by { id, businessId }, the business the caller
   * acts in. The schema does not tie credit_notes.business_id to the
   * invoice's, so a lookup by id alone let a note naming another tenant's
   * invoice move it (CN-21 refuses that at the caller; CN-30 here). Another
   * business's invoice is a 404 with nothing locked or written. The lock is
   * the one every money door takes; the caller already holds it, and a row
   * lock its own transaction holds is granted again at once.
   *
   * W3-CREDIT-RECONCILE-BIND (V1-44b todo CR-V44-2; D-14, D-78): paidAt says
   * when the invoice was settled, and the credit move clears it whenever the
   * status it leaves is not PAID and the payment rows no longer settle the
   * invoice: a credited invoice whose money went back, returned by the void
   * of its note to SENT or PARTIALLY_PAID (as reconcileFromPayments clears it
   * on a refund's reopen, D-14), or credited further once nothing settles it
   * (a credited status is never PAID, D-78), including a move that leaves it
   * in the credited status it holds (review W3CRB-ST-1, CN-31). It only ever
   * stamped paidAt before. A PAID invoice credited with its payment rows still
   * settling the total keeps its paidAt, and so does its return to PAID once
   * the note is voided (CN-06); a return to PAID with none stamps it. This
   * covers credit moves only: the refund that unsettles a credited invoice
   * goes through reconcileCreditedFromPayments, which clears its paidAt by the
   * same rule (W4-CREDIT-REFUND-PAIDAT, review CRB-CR-1).
   */
  async reconcileFromCredits(
    invoiceId: string,
    extra: { tx: Prisma.TransactionClient; businessId: string },
  ): Promise<{ status: InvoiceStatus; changed: boolean }> {
    const db = extra.tx;
    const { businessId } = extra;
    // SEC-V44-6: the lock decides; no row in this business, nothing is read or written.
    if (!businessId) throw new NotFoundException('Invoice not found');
    const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM invoices WHERE id = ${invoiceId} AND business_id = ${businessId} FOR NO KEY UPDATE`;
    if (locked.length === 0) throw new NotFoundException('Invoice not found');
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId, businessId },
      select: { id: true, businessId: true, status: true, total: true, currency: true, paidAt: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const payments = await db.payment.findMany({
      where: { invoiceId, businessId },
      select: { amount: true, status: true },
    });
    const applied = await db.creditNote.aggregate({
      where: { invoiceId, businessId, status: 'APPLIED' },
      _sum: { amount: true },
    });
    const balance = balanceOfStoredRows(Number(invoice.total), payments, invoice.currency);
    const current = invoice.status as InvoiceStatus;
    const next = deriveStatusAfterCredit(current, Number(invoice.total), Number(applied._sum.amount ?? 0), balance);
    // CR-V44-2 (D-14, D-78): settled is PAID, or a credited status while the
    // payment rows still settle the total (CN-06). After a credit move,
    // anything else holds no paidAt (the refund door's half: reconcileCreditedFromPayments, CRB-CR-1).
    const settled = next === 'PAID' || (CREDITED_STATUSES.has(next) && balance.isFullyPaid);
    if (next === current) {
      // W3CRB-ST-1 (CR-V44-2): a credit move that leaves a credited invoice
      // in its credited status (a second partial note, or one of two voided)
      // still clears a paidAt nothing settles, so one money position ends
      // with one paidAt whatever the path (CN-31). The status is not
      // written, and changed stays false (it reports a status move). A
      // status the credits leave as it is and is not credited (no APPLIED
      // note) belongs to the payment doors and is left alone.
      if (CREDITED_STATUSES.has(current) && !settled && invoice.paidAt) {
        await compareAndSet(
          () => db.invoice.update({ where: { id: invoiceId, status: invoice.status }, data: { paidAt: null } }),
          `Invoice status changed while ${current} was being reconciled; reload it and try again`,
        );
      }
      return { status: current, changed: false };
    }
    if (!isLegalCreditTransition(current, next)) {
      throw new ConflictException(`Illegal invoice status transition for a credit note: ${current} -> ${next}`);
    }
    const paidAt = settled
      ? next === 'PAID' && !invoice.paidAt
        ? { paidAt: new Date() }
        : {}
      : invoice.paidAt
        ? { paidAt: null }
        : {};
    await compareAndSet(
      () =>
        db.invoice.update({
          where: { id: invoiceId, status: invoice.status },
          data: { status: next, ...paidAt },
        }),
      `Invoice status changed while ${current} -> ${next} was in flight; reload it and try again`,
    );
    return { status: next, changed: true };
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
