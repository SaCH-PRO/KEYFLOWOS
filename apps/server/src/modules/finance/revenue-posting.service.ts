import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService, buildExternalRef, type PostingResult } from './posting.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { TimelineService, type RecordEventInput } from '../timeline/timeline.service';
import { isSystemActor } from '../../core/auth/system-actor';
import { fromCents, toCents } from '../commerce/money';

export type AccountingBasis = 'CASH' | 'ACCRUAL';

interface PostingOpts {
  tx?: any;
  /** Override the basis (used by backfill to replay accrual flows). */
  basis?: AccountingBasis;
  createdById?: string | null;
}

interface PaymentPostingOpts extends PostingOpts {
  /**
   * W3-V1-55c review (SEC-V55C-4, PL07-ST-3; D-90): the person on whose
   * behalf a SYSTEM recorder (KEY) recorded the payment, kept as
   * data.initiatedBy on the payment's FINANCE payment_recorded row, as the CRM
   * invoice.payment_recorded copy keeps it. Ignored unless `createdById` is the
   * system actor, and never the system actor itself. Audit data, never authority.
   */
  initiatedBy?: string | null;
}

interface RefundPostingOpts extends PostingOpts {
  /**
   * R0-CMF2-PAYMENT-ACTOR-GAPS: write the refund's audit row, posted or not,
   * with `tx` (the caller's refund transaction), so it commits with the
   * refund and rolls back with it. A failed insert is not swallowed: it fails
   * the refund (R0-CMF2 review SEC-CMF2-1 / CR-CMF2-1).
   */
  auditInTransaction?: boolean;
  /**
   * V1-29c-REFUND-WRITE-DOOR: the refund row this call records and the amount
   * it refunds (currency units, > 0). The provider refund door passes it.
   * Omitted with `auditInTransaction` (the manual refund), it is the newest
   * refund row linked to the payment, the one that refund wrote in this
   * transaction. Omitted otherwise, the call refunds all that is left.
   */
  refund?: { paymentId: string; amount: number };
}

/**
 * V1-29c: a partial refund of a payment is posted as its own REFUND
 * transaction, numbered per payment (Payment:<id>:payment_refunded:<n>, n = 1,
 * 2, ...), so a later refund finds the earlier ones by their unique key. The
 * refund doors serialize the refunds of one invoice (its row lock), so n is
 * never taken twice; a racing duplicate would fail on the unique key.
 */
const PARTIAL_REFUND_KIND = 'payment_refunded';

/** A ledger amount (Decimal, number or string) in integer cents. */
function centsOf(value: unknown): number {
  return toCents(Number(value ?? 0));
}

/**
 * V1-82 (FOLLOW3-B3): `total` cents apportioned pro rata to `weights` (cents,
 * none negative, summing above zero) by the largest-remainder method. Each
 * share is the floor of total x weight / sum; the cents left over go one each
 * to the largest remainders, a tie to the earlier weight, so the result is
 * deterministic and the shares sum to `total` exactly. Spreading the discount
 * (sum - total) pro rata gives the same shares. BigInt, so the products are
 * exact at any ledger amount.
 */
function apportionCents(total: number, weights: readonly number[]): number[] {
  const t = BigInt(total);
  const sum = weights.reduce((s, w) => s + BigInt(w), BigInt(0));
  const shares = weights.map((w) => (t * BigInt(w)) / sum);
  let left = t - shares.reduce((s, x) => s + x, BigInt(0));
  const byRemainder = weights
    .map((w, i) => ({ i, r: (t * BigInt(w)) % sum }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of byRemainder) {
    if (left <= BigInt(0)) break;
    shares[i] = shares[i]! + BigInt(1);
    left -= BigInt(1);
  }
  return shares.map((s) => Number(s));
}

/**
 * FIN2 — Revenue posting recipes.
 *
 * Single owner of the mapping: invoice/payment/refund/void source events
 * → ledger entries. Every recipe is idempotent (uses PostingService's
 * deterministic externalRef), so listeners and backfill can replay
 * without double-posting.
 *
 * Basis behaviour (per audit Phase 1):
 *   CASH (default):
 *     - Invoice finalize/void → no-op.
 *     - Payment recorded     → Dr deposit + Dr fee / Cr Revenue.
 *     - Payment refunded     → reversal of the recording entry.
 *   ACCRUAL:
 *     - Invoice finalized    → Dr AR / Cr Revenue.
 *     - Invoice voided       → reversal of the finalized entry.
 *     - Payment recorded     → Dr deposit + Dr fee / Cr AR.
 *     - Payment refunded     → reversal of the payment entry.
 */
@Injectable()
export class RevenuePostingService {
  private readonly logger = new Logger(RevenuePostingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(ChartOfAccountsSeederService)
    private readonly coaSeeder: ChartOfAccountsSeederService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  /** Map a payment provider/method to a deposit-side COA system key. */
  static depositSystemKey(provider?: string | null, method?: string | null): string {
    const p = (provider ?? '').toLowerCase();
    const m = (method ?? '').toLowerCase();
    if (p === 'cash' || m === 'cash') return 'CASH';
    if (
      p === 'bank_transfer' ||
      m === 'bank_transfer' ||
      p === 'check' ||
      m === 'check'
    ) {
      return 'BANK';
    }
    if (
      p === 'stripe' ||
      p === 'paypal' ||
      p === 'wipay' ||
      p === 'card' ||
      m === 'card' ||
      m === 'paypal' ||
      m === 'wipay' ||
      m === 'stripe' ||
      m === 'google_pay'
    ) {
      return 'PAYMENT_PROCESSOR';
    }
    return 'CASH';
  }

  private db(opts: PostingOpts): any {
    return opts.tx ?? this.prisma.client;
  }

  private async getBasis(
    businessId: string,
    override?: AccountingBasis,
    opts: PostingOpts = {},
  ): Promise<AccountingBasis> {
    if (override) return override;
    const biz = await this.db(opts).business.findUnique({
      where: { id: businessId },
      select: { accountingBasis: true },
    });
    const v = (biz as unknown as { accountingBasis?: string } | null)?.accountingBasis;
    return v === 'ACCRUAL' ? 'ACCRUAL' : 'CASH';
  }

  private async resolveCoa(businessId: string, key: string): Promise<string> {
    const row = await this.coaSeeder.getBySystemKey(businessId, key);
    if (!row) throw new Error(`FIN2: missing COA system account ${key} for business ${businessId}`);
    return row.id;
  }

  /**
   * Post the accrual-basis recognition for a finalized (SENT or higher)
   * invoice. No-op on cash basis. Idempotent on (Invoice, id, finalized).
   */
  async onInvoiceFinalized(invoiceId: string, opts: PostingOpts = {}) {
    const invoice = await this.db(opts).invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        businessId: true,
        contactId: true,
        currency: true,
        total: true,
        issueDate: true,
        invoiceNumber: true,
        status: true,
        deletedAt: true,
        items: {
          select: {
            total: true,
            product: { select: { category: true } },
          },
        },
      },
    });
    if (!invoice || invoice.deletedAt) return null;
    if (invoice.status === 'DRAFT') return null;
    const basis = await this.getBasis(invoice.businessId, opts.basis, opts);
    if (basis === 'CASH') return null;
    const total = Number(invoice.total ?? 0);
    if (!(total > 0)) return null;

    const arId = await this.resolveCoa(invoice.businessId, 'ACCOUNTS_RECEIVABLE');
    const revenueSplits = await this.resolveRevenueSplits(
      invoice.businessId,
      invoice.items ?? [],
      total,
    );

    const entries: Array<{ accountId: string; debit?: number; credit?: number; memo: string }> = [
      { accountId: arId, debit: total, memo: 'Accounts receivable (invoice finalized)' },
    ];
    for (const split of revenueSplits) {
      entries.push({
        accountId: split.accountId,
        credit: split.amount,
        memo: `Revenue recognised (${split.label})`,
      });
    }

    const result = await this.posting.post(
      {
        businessId: invoice.businessId,
        type: 'INCOME',
        date: invoice.issueDate ?? new Date(),
        amount: total,
        currency: invoice.currency,
        description: `Invoice ${invoice.invoiceNumber} finalized`,
        contactId: invoice.contactId,
        sourceType: 'Invoice',
        sourceId: invoice.id,
        kind: 'invoice_finalized',
        reference: invoice.invoiceNumber,
        createdById: opts.createdById ?? null,
        entries,
      },
      opts.tx,
    );
    this.timeline.recordEvent({
      businessId: invoice.businessId,
      module: 'FINANCE',
      action: 'invoice_finalized',
      entityType: 'invoice',
      entityId: invoice.id,
      title: `Invoice ${invoice.invoiceNumber} posted to ledger`,
      detail: `${invoice.currency} ${total}`,
      contactId: invoice.contactId ?? undefined,
      data: { invoiceNumber: invoice.invoiceNumber, total, currency: invoice.currency },
      occurredAt: new Date(),
    }).catch(() => {});
    return result;
  }

  /**
   * Map invoice line items to per-category revenue COA splits. Falls back
   * to a single REVENUE credit when no items carry a recognised
   * Product.category. A positive drift (tax, rounding) is absorbed by the
   * largest split so the credits sum exactly to `total`. A negative drift (a
   * net document discount) across two or more splits is apportioned pro rata
   * instead (V1-82), so no credit goes negative.
   */
  private async resolveRevenueSplits(
    businessId: string,
    items: ReadonlyArray<{ total: number | string | Prisma.Decimal | null; product?: { category?: string | null } | null }>,
    total: number,
  ): Promise<Array<{ accountId: string; amount: number; label: string }>> {
    const categoryToKey = (cat?: string | null): { key: string; label: string } => {
      const c = (cat ?? '').toUpperCase();
      if (c === 'SERVICE') return { key: 'REVENUE_SERVICE', label: 'service' };
      if (c === 'PRODUCT') return { key: 'REVENUE_PRODUCT', label: 'product' };
      if (c === 'PACKAGE') return { key: 'REVENUE_PACKAGE', label: 'package' };
      return { key: 'REVENUE', label: 'general' };
    };

    const buckets = new Map<string, { label: string; amount: number }>();
    for (const item of items ?? []) {
      const amt = Number(item.total ?? 0);
      if (!(amt > 0)) continue;
      const { key, label } = categoryToKey(item.product?.category);
      const cur = buckets.get(key);
      if (cur) {
        cur.amount = +(cur.amount + amt).toFixed(2);
      } else {
        buckets.set(key, { label, amount: +amt.toFixed(2) });
      }
    }

    if (buckets.size === 0) {
      const accountId = await this.resolveCoa(businessId, 'REVENUE');
      return [{ accountId, amount: total, label: 'accrual' }];
    }

    const splits: Array<{ key: string; label: string; amount: number; accountId: string }> = [];
    for (const [key, val] of buckets) {
      const accountId = await this.resolveCoa(businessId, key).catch(async () =>
        this.resolveCoa(businessId, 'REVENUE'),
      );
      splits.push({ key, label: val.label, amount: val.amount, accountId });
    }

    const sum = splits.reduce((s, x) => s + x.amount, 0);
    const drift = +(total - sum).toFixed(2);
    if (drift <= -0.01 && splits.length > 1) {
      // V1-82 (FOLLOW3-B3): a net discount. On the largest split alone it
      // made that credit negative once the discount exceeded the split, and
      // validatePosting refused the recognition (the send rolled back). The
      // credits are the total apportioned pro rata to the splits instead, in
      // integer cents; a split whose share is no cent posts no leg.
      const shares = apportionCents(toCents(total), splits.map((s) => toCents(s.amount)));
      return splits
        .map((s, i) => ({ accountId: s.accountId, amount: fromCents(shares[i]!), label: s.label }))
        .filter((s) => s.amount > 0);
    }
    if (Math.abs(drift) >= 0.01 && splits.length > 0) {
      let max = splits[0]!;
      for (const s of splits) if (s.amount > max.amount) max = s;
      max.amount = +(max.amount + drift).toFixed(2);
    }
    return splits.map((s) => ({ accountId: s.accountId, amount: s.amount, label: s.label }));
  }

  /**
   * Reverse the accrual recognition when an invoice is voided. Cash-basis
   * invoices have no recognition entry to reverse — no-op.
   */
  async onInvoiceVoided(invoiceId: string, opts: PostingOpts = {}) {
    const db = this.db(opts);
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, businessId: true },
    });
    if (!invoice) return null;
    const externalRef = buildExternalRef('Invoice', invoice.id, 'invoice_finalized');
    if (!externalRef) return null;
    const original = await db.financialTransaction.findUnique({
      where: { businessId_externalRef: { businessId: invoice.businessId, externalRef } },
      select: { id: true, status: true },
    });
    if (!original) return null;
    if (original.status === 'REVERSED') return { transactionId: original.id, externalRef, alreadyPosted: true };
    return this.posting.reverse(
      invoice.businessId,
      original.id,
      { reason: 'Invoice voided', createdById: opts.createdById ?? null },
      opts.tx,
    );
  }

  /**
   * Post the deposit-side entries for a SUCCESSFUL payment row. On accrual
   * basis the credit goes to AR (clearing the receivable); on cash basis
   * the credit goes to Revenue directly. Processor fees (when present)
   * are debited to EXPENSE_BANK_FEES so the deposit account math nets.
   */
  async onPaymentRecorded(paymentId: string, opts: PaymentPostingOpts = {}) {
    const payment = await this.db(opts).payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        provider: true,
        method: true,
        businessId: true,
        invoiceId: true,
        createdAt: true,
        processorFee: true,
        invoice: { select: { contactId: true, invoiceNumber: true } },
      },
    });
    if (!payment) return null;
    if (payment.status !== 'SUCCESSFUL') return null;
    const gross = Number(payment.amount ?? 0);
    if (!(gross > 0)) return null;

    const basis = await this.getBasis(payment.businessId, opts.basis, opts);
    const fee = Math.max(0, Number(payment.processorFee ?? 0));
    const net = Math.max(0, +(gross - fee).toFixed(4));

    const depositKey = RevenuePostingService.depositSystemKey(payment.provider, payment.method);
    const creditKey = basis === 'ACCRUAL' ? 'ACCOUNTS_RECEIVABLE' : 'REVENUE';

    // Resolve in sequence, not with Promise.all: on a never-seeded tenant the
    // first lookup seeds the whole chart of accounts, and two lookups racing
    // each other into that seed is what failed the first payment a tenant
    // ever recorded (journey harness D1). The seeder also serializes seeding
    // per business; resolving in order keeps this path to one run regardless.
    const depositId = await this.resolveCoa(payment.businessId, depositKey);
    const creditId = await this.resolveCoa(payment.businessId, creditKey);
    const feeId = fee > 0 ? await this.resolveCoa(payment.businessId, 'EXPENSE_BANK_FEES') : null;

    const entries: Array<{ accountId: string; debit?: number; credit?: number; memo: string }> = [
      { accountId: depositId, debit: net, memo: `${depositKey} deposit (${payment.provider})` },
    ];
    if (feeId && fee > 0) {
      entries.push({ accountId: feeId, debit: fee, memo: 'Processor fee' });
    }
    entries.push({
      accountId: creditId,
      credit: gross,
      memo: basis === 'ACCRUAL' ? 'Clear receivable' : 'Revenue (cash basis)',
    });

    const result = await this.posting.post(
      {
        businessId: payment.businessId,
        type: 'INCOME',
        date: payment.createdAt ?? new Date(),
        amount: gross,
        currency: payment.currency,
        description: `Payment for invoice ${payment.invoice?.invoiceNumber ?? payment.invoiceId}`,
        contactId: payment.invoice?.contactId ?? null,
        sourceType: 'Payment',
        sourceId: payment.id,
        kind: 'payment_recorded',
        reference: payment.invoice?.invoiceNumber ?? payment.invoiceId,
        createdById: opts.createdById ?? null,
        entries,
      },
      opts.tx,
    );
    // W3-V1-55c review (SEC-V55C-3, D-90): a payment already posted already
    // has its one feed row; a re-run (scripts/finance-backfill-revenue.ts)
    // writes no second one.
    if (result.alreadyPosted) return result;
    // W3-V1-55c (owner ruling D-90, on D-08): this is the payment's one feed
    // row, and it names who recorded the payment, as the CRM
    // invoice.payment_recorded copy did: KEY is a SYSTEM actor, a person is
    // USER; with no actor (a provider callback, a service caller) none is named.
    // Review SEC-V55C-4 (PL07-ST-3): beside KEY only, the person its command
    // ran for is kept as data.initiatedBy, as the copy keeps it (audit data,
    // never authority; never a system actor itself).
    const recordedBy = opts.createdById ?? null;
    const initiatedBy =
      isSystemActor(recordedBy) && opts.initiatedBy && !isSystemActor(opts.initiatedBy) ? opts.initiatedBy : null;
    const entry: RecordEventInput = {
      businessId: payment.businessId,
      module: 'FINANCE',
      action: 'payment_recorded',
      entityType: 'payment',
      entityId: payment.id,
      title: `Payment recorded: ${payment.currency} ${gross}`,
      detail: `Invoice ${payment.invoice?.invoiceNumber ?? payment.invoiceId}`,
      contactId: payment.invoice?.contactId ?? undefined,
      data: { amount: gross, currency: payment.currency, provider: payment.provider, ...(initiatedBy ? { initiatedBy } : {}) },
      ...(recordedBy ? { actorType: isSystemActor(recordedBy) ? 'SYSTEM' as const : 'USER' as const, actorId: recordedBy } : {}),
      occurredAt: new Date(),
    };
    if (opts.tx) {
      // Review SEC-V55C-2: inside the caller's payment transaction the row is
      // written with it, as the manual refund's row is (SEC-CMF2-1 /
      // CR-CMF2-1, onPaymentRefunded): it commits with the payment, a payment
      // that rolls back leaves none, and a failed insert fails the payment
      // instead of leaving one no feed row names (not caught; the best-effort
      // TimelineService swallows every error, so it is not used here).
      await opts.tx.activity.create({
        data: {
          businessId: entry.businessId,
          module: entry.module,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          title: entry.title,
          detail: entry.detail,
          contactId: entry.contactId,
          data: entry.data as Prisma.InputJsonValue,
          actorType: entry.actorType,
          actorId: entry.actorId,
          occurredAt: entry.occurredAt,
        },
      });
    } else {
      // No transaction to join (a direct call): the posting has committed on
      // its own, so the row is recorded best-effort after it, as before.
      Promise.resolve(this.timeline.recordEvent(entry)).catch(() => {});
    }
    return result;
  }

  /**
   * Reverse the payment recording when the payment is refunded. Idempotent
   * — re-running on an already-reversed transaction is a no-op.
   *
   * R0-CMF2-PAYMENT-ACTOR-GAPS (ST-R011-2): the FINANCE payment_refunded
   * activity entry names the refunder (`createdById`, the actor the reversal
   * already carries). With `auditInTransaction` (the manual refund,
   * CommerceService.markPaymentRefunded) the entry is written for every
   * refund, posted or not, as an `activities` row through `tx`, inside the
   * refund transaction: it commits with the refund, a refund that rolls back
   * leaves none, and a failed insert fails the refund instead of leaving a
   * REFUNDED payment that names nobody (R0-CMF2 review SEC-CMF2-1 /
   * CR-CMF2-1: the best-effort TimelineService swallows every error, so it
   * is not used for this row). Without it (provider refunds) nothing changes:
   * a reversal records its entry best-effort at once, and a payment with no
   * posting records nothing.
   *
   * V1-29c-REFUND-WRITE-DOOR (BR-07): a refund posts the amount it refunds.
   * One that leaves part of the payment posts a REFUND transaction for that
   * amount, the recording's credit account debited and its deposit account
   * credited, and the recording stays POSTED. One that refunds what is left
   * (or a call that names no refund) reverses the recording once, as before,
   * and reverses each earlier partial REFUND posting (PostingService.reverse),
   * so the payment's transactions net to zero exactly once and every reader
   * that nets an original against its REVERSAL (the cash-basis P&L and
   * operating cash flow, ledger-reporting computeCashBasisPnl) reads a fully
   * refunded payment as nothing received (review CRR-V29C-2: the V1-29c
   * ADJUSTMENT that folded the partials back read as a new collection on an
   * ACCRUAL business). Whether a refund leaves part of the payment is read
   * from the payment's linked refund rows, this one included, not from the
   * partial postings alone (review CRR-V29C-1): a linked refund row that was
   * never posted (payments-ops refundCharge) still refunds its part, and the
   * refund of what is left after it reverses the recording.
   * SEC-V29-2: the audit entry names the amount refunded (`amount`), the
   * refund row (`refundPaymentId`) and the payment's own amount
   * (`paymentAmount`).
   */
  async onPaymentRefunded(paymentId: string, opts: RefundPostingOpts = {}) {
    const db = this.db(opts);
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        businessId: true,
        invoiceId: true,
        amount: true,
        currency: true,
        provider: true,
        method: true,
        providerPaymentId: true,
        invoice: { select: { contactId: true, invoiceNumber: true } },
      },
    });
    if (!payment) return null;
    const externalRef = buildExternalRef('Payment', payment.id, 'payment_recorded');
    if (!externalRef) return null;
    const refund = opts.refund ?? (opts.auditInTransaction ? await this.newestLinkedRefund(db, payment) : null);
    const original = await db.financialTransaction.findUnique({
      where: { businessId_externalRef: { businessId: payment.businessId, externalRef } },
      select: {
        id: true,
        status: true,
        entries: { select: { accountId: true, debit: true, credit: true, account: { select: { systemKey: true } } } },
      },
    });
    let result: PostingResult | null = null;
    let reversed = false;
    let partlyPosted = false;
    let partialsReversed = 0;
    if (original?.status === 'REVERSED') {
      result = { transactionId: original.id, externalRef, alreadyPosted: true };
    } else if (original) {
      const earlier = await this.partialRefundsOf(db, payment.businessId, payment.id);
      const replayed = refund ? earlier.find((p) => p.refundPaymentId === refund.paymentId) : undefined;
      const postedCents = earlier.reduce((s, p) => s + p.cents, 0);
      // Review CRR-V29C-1: what the payment's refunds add up to is read from
      // its linked refund rows (the row of this refund included, written in
      // the caller's transaction), and never less than what is posted.
      const refundedCents = refund
        ? Math.max(await this.linkedRefundCents(db, payment), postedCents + toCents(refund.amount))
        : 0;
      if (replayed) {
        result = { transactionId: replayed.id, externalRef: replayed.externalRef, alreadyPosted: true };
      } else if (refund && refundedCents < toCents(Number(payment.amount ?? 0))) {
        const accounts = await this.refundAccounts(payment, original.entries, opts);
        result = await this.posting.post(
          {
            businessId: payment.businessId,
            type: 'REFUND',
            date: new Date(),
            amount: refund.amount,
            currency: payment.currency,
            description: `Partial refund of a payment for invoice ${payment.invoice?.invoiceNumber ?? payment.invoiceId}`,
            contactId: payment.invoice?.contactId ?? null,
            sourceType: 'Payment',
            sourceId: payment.id,
            kind: `${PARTIAL_REFUND_KIND}:${earlier.length + 1}`,
            reference: payment.invoice?.invoiceNumber ?? payment.invoiceId,
            metadata: { refundPaymentId: refund.paymentId },
            createdById: opts.createdById ?? null,
            entries: [
              { accountId: accounts.creditId, debit: refund.amount, memo: 'Payment refunded (partial)' },
              { accountId: accounts.depositId, credit: refund.amount, memo: 'Refund paid out' },
            ],
          },
          opts.tx,
        );
        partlyPosted = true;
      } else {
        result = await this.posting.reverse(
          payment.businessId,
          original.id,
          { reason: 'Payment refunded', createdById: opts.createdById ?? null },
          opts.tx,
        );
        reversed = true;
        // Review CRR-V29C-2: the partial refunds are taken back by their own
        // REVERSALs (each original then REVERSED), so the recording, the
        // partials and their reversals net to zero in every reader.
        for (const partial of earlier) {
          if (partial.status === 'REVERSED') continue;
          await this.posting.reverse(
            payment.businessId,
            partial.id,
            { reason: 'Payment refunded in full', createdById: opts.createdById ?? null },
            opts.tx,
          );
          partialsReversed += 1;
        }
      }
    }
    const refundedBy = opts.createdById ?? null;
    const entry: RecordEventInput = {
      businessId: payment.businessId,
      module: 'FINANCE',
      action: 'payment_refunded',
      entityType: 'payment',
      entityId: payment.id,
      title: reversed
        ? 'Payment refunded — ledger reversed'
        : partlyPosted
          ? 'Payment partly refunded — refund posted'
          : 'Payment refunded',
      detail: `Invoice ${payment.invoice?.invoiceNumber ?? payment.invoiceId}`,
      contactId: payment.invoice?.contactId ?? undefined,
      data: {
        invoiceId: payment.invoiceId,
        amount: refund ? refund.amount : payment.amount,
        paymentAmount: payment.amount,
        refundPaymentId: refund?.paymentId ?? null,
        currency: payment.currency,
        ledgerReversed: reversed,
        ledgerRefundPosted: partlyPosted,
        ledgerPartialRefundsReversed: partialsReversed,
        refundedBy,
      },
      // KEY is a SYSTEM actor, a person is USER; with no actor none is named.
      actorType: refundedBy ? (isSystemActor(refundedBy) ? 'SYSTEM' : 'USER') : undefined,
      actorId: refundedBy ?? undefined,
      occurredAt: new Date(),
    };
    if (opts.auditInTransaction) {
      // Not caught: an audit row that cannot be written rolls the refund back.
      await db.activity.create({
        data: {
          businessId: entry.businessId,
          module: entry.module,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          title: entry.title,
          detail: entry.detail,
          contactId: entry.contactId,
          data: entry.data as Prisma.InputJsonValue,
          actorType: entry.actorType,
          actorId: entry.actorId,
          occurredAt: entry.occurredAt,
        },
      });
    } else if (reversed || partlyPosted) {
      Promise.resolve(this.timeline.recordEvent(entry)).catch(() => {});
    }
    return result;
  }

  /**
   * V1-29c: the partial refund postings of a payment, in order, found by
   * their numbered keys (see PARTIAL_REFUND_KIND).
   */
  private async partialRefundsOf(
    db: Prisma.TransactionClient,
    businessId: string,
    paymentId: string,
  ): Promise<Array<{ id: string; externalRef: string; status: string | null; cents: number; refundPaymentId: string | null }>> {
    const found: Array<{ id: string; externalRef: string; status: string | null; cents: number; refundPaymentId: string | null }> = [];
    for (let n = 1; ; n += 1) {
      const externalRef = `${buildExternalRef('Payment', paymentId, PARTIAL_REFUND_KIND)}:${n}`;
      const row = await db.financialTransaction.findUnique({
        where: { businessId_externalRef: { businessId, externalRef } },
        select: { id: true, status: true, amount: true, metadata: true },
      });
      if (!row) return found;
      const meta = row.metadata as { refundPaymentId?: unknown } | null;
      found.push({
        id: row.id,
        externalRef,
        status: row.status ?? null,
        cents: centsOf(row.amount),
        refundPaymentId: typeof meta?.refundPaymentId === 'string' ? meta.refundPaymentId : null,
      });
    }
  }

  /**
   * V1-29c review (CRR-V29C-1): what a payment's linked refund rows refund,
   * in cents: its negative REFUNDED rows of its invoice and tenant whose
   * reference is its providerPaymentId (the manual refund, the provider
   * refund door and payments-ops refundCharge all link so), posted or not.
   */
  private async linkedRefundCents(
    db: Prisma.TransactionClient,
    payment: { businessId: string; invoiceId: string; providerPaymentId: string },
  ): Promise<number> {
    const rows = await db.payment.findMany({
      where: {
        businessId: payment.businessId,
        invoiceId: payment.invoiceId,
        status: 'REFUNDED',
        amount: { lt: 0 },
        reference: payment.providerPaymentId,
      },
      select: { amount: true },
    });
    return rows.reduce((s, r) => s + Math.abs(centsOf(r.amount)), 0);
  }

  /**
   * V1-29c (SEC-V29-2): the newest refund row linked to a payment (a negative
   * REFUNDED row of its invoice and tenant whose reference is its
   * providerPaymentId). The manual refund writes it in the transaction that
   * calls onPaymentRefunded, under the invoice lock.
   */
  private async newestLinkedRefund(
    db: Prisma.TransactionClient,
    payment: { businessId: string; invoiceId: string; providerPaymentId: string },
  ): Promise<{ paymentId: string; amount: number } | null> {
    const row = await db.payment.findFirst({
      where: {
        businessId: payment.businessId,
        invoiceId: payment.invoiceId,
        status: 'REFUNDED',
        amount: { lt: 0 },
        reference: payment.providerPaymentId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, amount: true },
    });
    return row ? { paymentId: row.id, amount: fromCents(Math.abs(centsOf(row.amount))) } : null;
  }

  /**
   * V1-29c: the accounts a refund of `payment` moves: the deposit account its
   * recording debited and the account it credited (Revenue on cash basis, AR
   * on accrual), read from the recording itself so a later basis change does
   * not split one payment across accounts. A recording that does not name
   * them falls back to the accounts onPaymentRecorded would use now.
   */
  private async refundAccounts(
    payment: { businessId: string; provider: string | null; method: string | null },
    entries: ReadonlyArray<{ accountId: string; debit: unknown; credit: unknown; account?: { systemKey: string | null } | null }> | undefined,
    opts: PostingOpts,
  ): Promise<{ depositId: string; creditId: string }> {
    const lines = entries ?? [];
    const credit = lines.find((e) => centsOf(e.credit) > 0);
    const deposit = lines
      .filter((e) => centsOf(e.debit) > 0 && e.account?.systemKey !== 'EXPENSE_BANK_FEES')
      .sort((a, b) => centsOf(b.debit) - centsOf(a.debit))[0];
    if (credit && deposit) return { depositId: deposit.accountId, creditId: credit.accountId };
    const basis = await this.getBasis(payment.businessId, opts.basis, opts);
    return {
      depositId: await this.resolveCoa(payment.businessId, RevenuePostingService.depositSystemKey(payment.provider, payment.method)),
      creditId: await this.resolveCoa(payment.businessId, basis === 'ACCRUAL' ? 'ACCOUNTS_RECEIVABLE' : 'REVENUE'),
    };
  }

  /**
   * Convenience wrapper used by listeners that already have the source
   * row id and want a best-effort post: any error is logged and swallowed
   * so out-of-band events (webhooks, schedulers) do not crash on a
   * missing seed account or duplicate write race.
   */
  async safePost<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err: any) {
      this.logger.warn(
        `RevenuePostingService.${label} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
