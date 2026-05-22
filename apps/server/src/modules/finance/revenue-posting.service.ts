import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService, buildExternalRef } from './posting.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { TimelineService } from '../timeline/timeline.service';

export type AccountingBasis = 'CASH' | 'ACCRUAL';

interface PostingOpts {
  tx?: Prisma.TransactionClient;
  /** Override the basis (used by backfill to replay accrual flows). */
  basis?: AccountingBasis;
  createdById?: string | null;
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

  private db(opts: PostingOpts): Prisma.TransactionClient {
    return (opts.tx ?? this.prisma.client) as unknown as Prisma.TransactionClient;
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
   * Product.category. Rounding drift is absorbed by the largest split so
   * the credits sum exactly to `total`.
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
  async onPaymentRecorded(paymentId: string, opts: PostingOpts = {}) {
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

    const [depositId, creditId] = await Promise.all([
      this.resolveCoa(payment.businessId, depositKey),
      this.resolveCoa(payment.businessId, creditKey),
    ]);
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
    this.timeline.recordEvent({
      businessId: payment.businessId,
      module: 'FINANCE',
      action: 'payment_recorded',
      entityType: 'payment',
      entityId: payment.id,
      title: `Payment recorded: ${payment.currency} ${gross}`,
      detail: `Invoice ${payment.invoice?.invoiceNumber ?? payment.invoiceId}`,
      contactId: payment.invoice?.contactId ?? undefined,
      data: { amount: gross, currency: payment.currency, provider: payment.provider },
      occurredAt: new Date(),
    }).catch(() => {});
    return result;
  }

  /**
   * Reverse the payment recording when the payment is refunded. Idempotent
   * — re-running on an already-reversed transaction is a no-op.
   */
  async onPaymentRefunded(paymentId: string, opts: PostingOpts = {}) {
    const db = this.db(opts);
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, businessId: true },
    });
    if (!payment) return null;
    const externalRef = buildExternalRef('Payment', payment.id, 'payment_recorded');
    if (!externalRef) return null;
    const original = await db.financialTransaction.findUnique({
      where: { businessId_externalRef: { businessId: payment.businessId, externalRef } },
      select: { id: true, status: true },
    });
    if (!original) return null;
    if (original.status === 'REVERSED') {
      return { transactionId: original.id, externalRef, alreadyPosted: true };
    }
    const result = await this.posting.reverse(
      payment.businessId,
      original.id,
      { reason: 'Payment refunded', createdById: opts.createdById ?? null },
      opts.tx,
    );
    Promise.resolve(this.timeline.recordEvent({
      businessId: payment.businessId,
      module: 'FINANCE',
      action: 'payment_refunded',
      entityType: 'payment',
      entityId: payment.id,
      title: 'Payment refunded — ledger reversed',
      occurredAt: new Date(),
    })).catch(() => {});
    return result;
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
    } catch (err) {
      this.logger.warn(
        `RevenuePostingService.${label} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
