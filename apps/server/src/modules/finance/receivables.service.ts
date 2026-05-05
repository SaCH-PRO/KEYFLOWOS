import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

export interface AgingBucket {
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
  total: number;
  invoiceCount: number;
}

export interface CustomerAgingRow {
  contactId: string;
  contactName: string | null;
  total: number;
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  d90plus: number;
}

export interface AgingReport {
  asOf: string;
  currency: string;
  totals: AgingBucket[];
  totalOutstanding: number;
  totalOverdue: number;
  customers: CustomerAgingRow[];
  ledgerArBalance: number;
  ledgerReconciled: boolean;
  ledgerDelta: number;
  /** Posting basis sourcing the report: 'ACCRUAL' uses ledger AR as the
   *  primary balance source; 'CASH' falls back to invoice-payment math
   *  because no AR entries exist on cash basis. */
  basis: 'CASH' | 'ACCRUAL';
}

export interface CustomerBalance {
  contactId: string;
  contactName: string | null;
  invoicedTotal: number;
  paidTotal: number;
  outstanding: number;
  overdue: number;
  aging: AgingBucket[];
  ledgerArBalance: number;
  ledgerReconciled: boolean;
  ledgerDelta: number;
  basis: 'CASH' | 'ACCRUAL';
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    issueDate: string | null;
    dueDate: string | null;
    total: number;
    paid: number;
    outstanding: number;
    daysOverdue: number;
    /** Net AR balance for this invoice from the ledger (accrual). */
    ledgerArBalance: number;
  }>;
}

const D = Prisma.Decimal;
const ZERO = new D(0);

function bucketFor(daysOverdue: number): AgingBucket['bucket'] {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

const EMPTY_TOTALS = (): AgingBucket[] => [
  { bucket: 'current', total: 0, invoiceCount: 0 },
  { bucket: '1-30', total: 0, invoiceCount: 0 },
  { bucket: '31-60', total: 0, invoiceCount: 0 },
  { bucket: '61-90', total: 0, invoiceCount: 0 },
  { bucket: '90+', total: 0, invoiceCount: 0 },
];

/**
 * FIN2 — receivables aging + per-customer balance.
 *
 * Source-of-truth strategy:
 *   ACCRUAL businesses — the AR ledger is canonical. Outstanding per
 *     invoice is derived by summing ledger entries on the AR account
 *     attributable to each invoice (the invoice-finalize entry plus any
 *     payment entries against that invoice). Invoice rows supply due
 *     date / status metadata only.
 *   CASH businesses — there are no AR ledger entries by design (revenue
 *     posts against deposit accounts directly). We fall back to
 *     invoice.total minus net payments for outstanding.
 *
 * `ledgerArBalance` / `ledgerReconciled` are returned in both cases so
 * Reports can surface posting drift.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChartOfAccountsSeederService)
    private readonly coaSeeder: ChartOfAccountsSeederService,
  ) {}

  async getLedgerArBalance(businessId: string, asOf?: Date): Promise<number> {
    const account = await this.coaSeeder.getBySystemKey(businessId, 'ACCOUNTS_RECEIVABLE');
    if (!account) return 0;
    const where: Prisma.LedgerEntryWhereInput = { businessId, accountId: account.id };
    if (asOf) where.date = { lte: asOf };
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where,
      _sum: { debit: true, credit: true },
    });
    const debit = (agg._sum.debit as Prisma.Decimal | null) ?? ZERO;
    const credit = (agg._sum.credit as Prisma.Decimal | null) ?? ZERO;
    return Number(new D(debit.toString()).sub(new D(credit.toString())).toFixed(2));
  }

  async getLedgerArForContact(
    businessId: string,
    contactId: string,
    asOf?: Date,
  ): Promise<number> {
    const account = await this.coaSeeder.getBySystemKey(businessId, 'ACCOUNTS_RECEIVABLE');
    if (!account) return 0;
    const dateFilter = asOf ? { lte: asOf } : undefined;
    const where: Prisma.LedgerEntryWhereInput = {
      businessId,
      accountId: account.id,
      ...(dateFilter ? { date: dateFilter } : {}),
      transaction: { contactId },
    };
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where,
      _sum: { debit: true, credit: true },
    });
    const debit = (agg._sum.debit as Prisma.Decimal | null) ?? ZERO;
    const credit = (agg._sum.credit as Prisma.Decimal | null) ?? ZERO;
    return Number(new D(debit.toString()).sub(new D(credit.toString())).toFixed(2));
  }

  /**
   * Aggregate AR ledger entries grouped by the invoice they belong to.
   * Pulls invoice-source entries directly via FinancialTransaction.sourceId
   * and payment-source entries indirectly via Payment.invoiceId, so a
   * single map keyed by invoiceId yields net AR per receivable.
   */
  private async getLedgerArByInvoice(
    businessId: string,
    invoiceIds: string[],
    asOf: Date,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (invoiceIds.length === 0) return result;
    const account = await this.coaSeeder.getBySystemKey(businessId, 'ACCOUNTS_RECEIVABLE');
    if (!account) return result;

    const entries = await this.prisma.client.ledgerEntry.findMany({
      where: {
        businessId,
        accountId: account.id,
        date: { lte: asOf },
        OR: [
          {
            transaction: { sourceType: 'Invoice', sourceId: { in: invoiceIds } },
          },
          {
            transaction: { sourceType: 'Payment' },
          },
        ],
      },
      select: {
        debit: true,
        credit: true,
        transaction: { select: { sourceType: true, sourceId: true } },
      },
    });

    const paymentSourceIds = new Set<string>();
    for (const e of entries) {
      if (e.transaction?.sourceType === 'Payment' && e.transaction.sourceId) {
        paymentSourceIds.add(e.transaction.sourceId);
      }
    }
    const paymentMap = new Map<string, string>();
    if (paymentSourceIds.size > 0) {
      const payments = await this.prisma.client.payment.findMany({
        where: { id: { in: Array.from(paymentSourceIds) } },
        select: { id: true, invoiceId: true },
      });
      for (const p of payments) if (p.invoiceId) paymentMap.set(p.id, p.invoiceId);
    }

    for (const e of entries) {
      const src = e.transaction;
      if (!src?.sourceId) continue;
      let invoiceId: string | undefined;
      if (src.sourceType === 'Invoice') invoiceId = src.sourceId;
      else if (src.sourceType === 'Payment') invoiceId = paymentMap.get(src.sourceId);
      if (!invoiceId || !invoiceIds.includes(invoiceId)) continue;
      const delta = Number(e.debit ?? 0) - Number(e.credit ?? 0);
      result.set(invoiceId, +((result.get(invoiceId) ?? 0) + delta).toFixed(2));
    }
    return result;
  }

  private async getBasis(businessId: string): Promise<'CASH' | 'ACCRUAL'> {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { accountingBasis: true },
    });
    const v = (biz as unknown as { accountingBasis?: string } | null)?.accountingBasis;
    return v === 'ACCRUAL' ? 'ACCRUAL' : 'CASH';
  }

  async getAging(businessId: string, asOf: Date = new Date()): Promise<AgingReport> {
    const basis = await this.getBasis(businessId);
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PENDING'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        contactId: true,
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        payments: { select: { amount: true, status: true } },
      },
    });

    const invoiceIds = invoices.map((i) => i.id);
    const ledgerArByInvoice =
      basis === 'ACCRUAL'
        ? await this.getLedgerArByInvoice(businessId, invoiceIds, asOf)
        : new Map<string, number>();

    const totals = EMPTY_TOTALS();
    const customerMap = new Map<string, CustomerAgingRow>();
    let totalOutstanding = 0;
    let totalOverdue = 0;
    let currency = 'TTD';

    for (const inv of invoices) {
      currency = inv.currency || currency;
      let outstanding: number;
      if (basis === 'ACCRUAL' && ledgerArByInvoice.has(inv.id)) {
        outstanding = Math.max(0, +(ledgerArByInvoice.get(inv.id) ?? 0).toFixed(2));
      } else {
        // CASH-basis fallback: count only SUCCESSFUL payments. Manual
        // refund flow (CommerceService.markPaymentRefunded) flips the
        // existing payment's status from SUCCESSFUL → REFUNDED, so the
        // refund effect is already reflected by the row dropping out of
        // SUCCESSFUL — subtracting it again would double-count.
        const paid = inv.payments
          .filter((p) => p.status === 'SUCCESSFUL')
          .reduce((s, p) => s + Number(p.amount), 0);
        outstanding = Math.max(0, Number(inv.total) - paid);
      }
      if (outstanding < 0.005) continue;

      const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : null;
      const daysOverdue =
        dueMs !== null ? Math.floor((asOf.getTime() - dueMs) / (24 * 60 * 60 * 1000)) : 0;
      const bucket = bucketFor(daysOverdue);
      const totalRow = totals.find((t) => t.bucket === bucket)!;
      totalRow.total = +(totalRow.total + outstanding).toFixed(2);
      totalRow.invoiceCount += 1;
      totalOutstanding = +(totalOutstanding + outstanding).toFixed(2);
      if (bucket !== 'current') totalOverdue = +(totalOverdue + outstanding).toFixed(2);

      const cid = inv.contactId ?? 'unattributed';
      let row = customerMap.get(cid);
      if (!row) {
        const name = inv.contact
          ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || inv.contact.email
          : null;
        row = {
          contactId: cid,
          contactName: name ?? null,
          total: 0,
          current: 0,
          d1to30: 0,
          d31to60: 0,
          d61to90: 0,
          d90plus: 0,
        };
        customerMap.set(cid, row);
      }
      row.total = +(row.total + outstanding).toFixed(2);
      switch (bucket) {
        case 'current':
          row.current = +(row.current + outstanding).toFixed(2);
          break;
        case '1-30':
          row.d1to30 = +(row.d1to30 + outstanding).toFixed(2);
          break;
        case '31-60':
          row.d31to60 = +(row.d31to60 + outstanding).toFixed(2);
          break;
        case '61-90':
          row.d61to90 = +(row.d61to90 + outstanding).toFixed(2);
          break;
        case '90+':
          row.d90plus = +(row.d90plus + outstanding).toFixed(2);
          break;
      }
    }

    const ledgerArBalance = await this.getLedgerArBalance(businessId, asOf);
    const ledgerDelta = +(totalOutstanding - ledgerArBalance).toFixed(2);
    const ledgerReconciled = Math.abs(ledgerDelta) < 0.01;

    return {
      asOf: asOf.toISOString(),
      currency,
      totals,
      totalOutstanding,
      totalOverdue,
      customers: Array.from(customerMap.values()).sort((a, b) => b.total - a.total),
      ledgerArBalance,
      ledgerReconciled,
      ledgerDelta,
      basis,
    };
  }

  async getCustomerBalance(
    businessId: string,
    contactId: string,
    asOf: Date = new Date(),
  ): Promise<CustomerBalance> {
    const basis = await this.getBasis(businessId);
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const invoices = await this.prisma.client.invoice.findMany({
      where: { businessId, contactId, deletedAt: null, status: { not: 'VOID' } },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        issueDate: true,
        dueDate: true,
        payments: { select: { amount: true, status: true } },
      },
    });
    const ledgerArByInvoice =
      basis === 'ACCRUAL'
        ? await this.getLedgerArByInvoice(businessId, invoices.map((i) => i.id), asOf)
        : new Map<string, number>();

    let invoicedTotal = 0;
    let paidTotal = 0;
    let outstandingTotal = 0;
    let overdueTotal = 0;
    const aging = EMPTY_TOTALS();

    const detail = invoices.map((inv) => {
      const total = Number(inv.total);
      // CASH-basis: rely on SUCCESSFUL rows only — manual refund flow
      // status-flips the original to REFUNDED, so it's already removed
      // from `paid`. Subtracting refunded amounts again would double-count.
      const paid = inv.payments
        .filter((p) => p.status === 'SUCCESSFUL')
        .reduce((s, p) => s + Number(p.amount), 0);
      const net = paid;
      const ledgerBalance = +(ledgerArByInvoice.get(inv.id) ?? 0).toFixed(2);
      const outstanding =
        basis === 'ACCRUAL' && ledgerArByInvoice.has(inv.id)
          ? Math.max(0, ledgerBalance)
          : Math.max(0, total - net);
      invoicedTotal = +(invoicedTotal + total).toFixed(2);
      paidTotal = +(paidTotal + Math.max(0, net)).toFixed(2);
      outstandingTotal = +(outstandingTotal + outstanding).toFixed(2);
      const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : null;
      const daysOverdue =
        dueMs !== null ? Math.floor((asOf.getTime() - dueMs) / (24 * 60 * 60 * 1000)) : 0;
      if (outstanding > 0.005) {
        const bucket = bucketFor(daysOverdue);
        const slot = aging.find((b) => b.bucket === bucket)!;
        slot.total = +(slot.total + outstanding).toFixed(2);
        slot.invoiceCount += 1;
        if (bucket !== 'current') overdueTotal = +(overdueTotal + outstanding).toFixed(2);
      }
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        issueDate: inv.issueDate ? inv.issueDate.toISOString() : null,
        dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
        total,
        paid: +Math.max(0, net).toFixed(2),
        outstanding: +outstanding.toFixed(2),
        daysOverdue: Math.max(0, daysOverdue),
        ledgerArBalance: ledgerBalance,
      };
    });

    const name = contact
      ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email
      : null;
    const ledgerArBalance = await this.getLedgerArForContact(businessId, contactId, asOf);
    const ledgerDelta = +(outstandingTotal - ledgerArBalance).toFixed(2);
    const ledgerReconciled = Math.abs(ledgerDelta) < 0.01;
    return {
      contactId,
      contactName: name ?? null,
      invoicedTotal,
      paidTotal,
      outstanding: outstandingTotal,
      overdue: overdueTotal,
      aging,
      ledgerArBalance,
      ledgerReconciled,
      ledgerDelta,
      basis,
      invoices: detail,
    };
  }
}
