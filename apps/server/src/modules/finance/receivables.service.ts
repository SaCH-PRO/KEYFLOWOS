import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { balanceOfStoredRows } from '../commerce/invoice-workflow.service';
import { readInvoiceMoney } from '../commerce/commerce-stats.service';
import { normalizeCurrency } from './posting.service';
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

/** One currency's receivables (D-251, D-13): never added to another currency's. */
export interface AgingCurrencyReport {
  currency: string;
  totals: AgingBucket[];
  totalOutstanding: number;
  totalOverdue: number;
  customers: CustomerAgingRow[];
  ledgerArBalance: number;
  ledgerReconciled: boolean;
  ledgerDelta: number;
}

export interface AgingReport {
  asOf: string;
  /** The business currency: the top-level figures are this currency's receivables only (D-251, D-13). */
  currency: string;
  totals: AgingBucket[];
  totalOutstanding: number;
  totalOverdue: number;
  customers: CustomerAgingRow[];
  ledgerArBalance: number;
  ledgerReconciled: boolean;
  ledgerDelta: number;
  /** Every currency that is owed something, the business currency included, each on its own. */
  byCurrency: Record<string, AgingCurrencyReport>;
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
 *     posts against deposit accounts directly). We fall back to the
 *     invoice balance read contract over its Payment rows of its own tenant
 *     (balanceOfStoredRows: integer cents, each refund a separate negative
 *     REFUNDED row, D-14; a row flipped to REFUNDED before V1-29 read as its
 *     payment plus its refund): paid = the net received, outstanding = the
 *     remaining (V1-29b-REFUND-READERS, CR-V29-2). Payment sits outside the
 *     tenant extension and has no FK to Business (M31), so a row carrying
 *     another businessId is not this invoice's money: the same rows the
 *     receipt, the invoice / reminder emails and the evidence match read
 *     (ownTenantReceiptBalance), so they state the same figures (review
 *     SEC-V29B-1).
 *
 * `ledgerArBalance` / `ledgerReconciled` are returned in both cases so
 * Reports can surface posting drift.
 *
 * V1-64, owner ruling D-251 (with D-13, D-250): the aging states the figure
 * the Executive Summary and the commerce stats state, on credited and
 * multi-currency books too. It reads the same invoices through the same read
 * (readInvoiceMoney, open receivables only):
 *   - the open statuses are SENT, OVERDUE, PARTIALLY_PAID and
 *     PARTIALLY_CREDITED. A credited invoice was left out; a PENDING one was
 *     read and no longer is (the summary's rule; reported for a ruling);
 *   - a credited invoice's APPLIED notes are netted once: from the payment
 *     rows' side by creditAwareBalance (CASH, and the ACCRUAL fallback), from
 *     the ledger's side by the note's own AR postings (ACCRUAL, below);
 *   - every figure is per currency. The top level is the business currency's
 *     receivables, named by `currency` (it added every currency under the
 *     last invoice's code); the others sit under `byCurrency`, each with its
 *     own ledger AR balance;
 *   - what is owed never exceeds the invoice total less its credits (D-250).
 * The basis strategy above is unchanged: on ACCRUAL the AR ledger stays the
 * source per invoice, now with the credit notes' AR entries attributed to
 * their invoice (they were on the AR account but tied to no invoice).
 */
@Injectable()
export class ReceivablesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChartOfAccountsSeederService)
    private readonly coaSeeder: ChartOfAccountsSeederService,
  ) {}

  /**
   * The AR account's balance in ONE currency (D-251, D-13): the business
   * currency unless `currency` names another. It added every currency's
   * entries into one figure, which the aging route sets beside figures that
   * are one currency's.
   */
  async getLedgerArBalance(businessId: string, asOf?: Date, currency?: string): Promise<number> {
    if (typeof businessId !== 'string' || businessId.length === 0) return 0;
    const account = await this.coaSeeder.getBySystemKey(businessId, 'ACCOUNTS_RECEIVABLE');
    if (!account) return 0;
    const code = normalizeCurrency(currency) || (await this.businessCurrency(businessId));
    const where: Prisma.LedgerEntryWhereInput = {
      businessId,
      accountId: account.id,
      // Case-insensitive: a pre-V1-37 transaction may hold 'ttd' (it was stored as given).
      transaction: { currency: { equals: code, mode: 'insensitive' } },
    };
    if (asOf) where.date = { lte: asOf };
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where,
      _sum: { debit: true, credit: true },
    });
    const debit = (agg._sum.debit as Prisma.Decimal | null) ?? ZERO;
    const credit = (agg._sum.credit as Prisma.Decimal | null) ?? ZERO;
    return Number(new D(debit.toString()).sub(new D(credit.toString())).toFixed(2));
  }

  /** The business currency as stored and compared (D-13): trimmed, upper-case, TTD when none. */
  private async businessCurrency(businessId: string): Promise<string> {
    const biz = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } });
    return normalizeCurrency(biz?.currency) || 'TTD';
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
   *
   * D-251: a credit note's AR entries (CreditNoteService posts them with
   * sourceType 'CREDIT_NOTE', and its void reverses them under the same
   * source) belong to the note's invoice, through this business's own note
   * rows (credit_notes.business_id is not tied to the invoice's, SEC-V44-6).
   * Without them a credited invoice read as owing its credit too.
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
          {
            transaction: { sourceType: 'CREDIT_NOTE' },
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

    const noteSourceIds = new Set<string>();
    for (const e of entries) {
      if (e.transaction?.sourceType === 'CREDIT_NOTE' && e.transaction.sourceId) noteSourceIds.add(e.transaction.sourceId);
    }
    const noteMap = new Map<string, string>();
    if (noteSourceIds.size > 0) {
      const notes = await this.prisma.client.creditNote.findMany({
        where: { businessId, id: { in: Array.from(noteSourceIds) }, invoiceId: { in: invoiceIds } },
        select: { id: true, invoiceId: true },
      });
      for (const n of notes) noteMap.set(n.id, n.invoiceId);
    }

    for (const e of entries) {
      const src = e.transaction;
      if (!src?.sourceId) continue;
      let invoiceId: string | undefined;
      if (src.sourceType === 'Invoice') invoiceId = src.sourceId;
      else if (src.sourceType === 'Payment') invoiceId = paymentMap.get(src.sourceId);
      else if (src.sourceType === 'CREDIT_NOTE') invoiceId = noteMap.get(src.sourceId);
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
    const home = await this.businessCurrency(businessId);
    // D-251: the open receivables as the Executive Summary and the commerce
    // stats read them (own-tenant payment rows and APPLIED notes, D-75; the
    // balance contract; never more than the total less the credits, D-250).
    const invoices = (await readInvoiceMoney(this.prisma.client, businessId, asOf, { openOnly: true })).filter(
      (inv) => inv.currency !== '',
    );

    const invoiceIds = invoices.map((i) => i.id);
    const ledgerArByInvoice =
      basis === 'ACCRUAL'
        ? await this.getLedgerArByInvoice(businessId, invoiceIds, asOf)
        : new Map<string, number>();

    const contactIds = Array.from(new Set(invoices.map((i) => i.contactId).filter((id): id is string => !!id)));
    const contacts = contactIds.length
      ? await this.prisma.client.contact.findMany({
          where: { businessId, id: { in: contactIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const contactOf = new Map(contacts.map((c) => [c.id, c]));

    type Bucket = { totals: AgingBucket[]; totalOutstanding: number; totalOverdue: number; customerMap: Map<string, CustomerAgingRow> };
    const buckets = new Map<string, Bucket>();
    const bucketOf = (code: string): Bucket => {
      let b = buckets.get(code);
      if (!b) {
        b = { totals: EMPTY_TOTALS(), totalOutstanding: 0, totalOverdue: 0, customerMap: new Map() };
        buckets.set(code, b);
      }
      return b;
    };

    for (const inv of invoices) {
      let outstanding: number;
      if (basis === 'ACCRUAL' && ledgerArByInvoice.has(inv.id)) {
        outstanding = Math.max(0, +(ledgerArByInvoice.get(inv.id) ?? 0).toFixed(2));
      } else {
        // CASH basis, and an ACCRUAL invoice with no AR posting: what the
        // invoice's rows leave owed, read through the balance contract net of
        // its APPLIED credit notes (readInvoiceMoney).
        outstanding = inv.remaining;
      }
      if (outstanding < 0.005) continue;

      const cur = bucketOf(inv.currency);
      const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : null;
      const daysOverdue =
        dueMs !== null ? Math.floor((asOf.getTime() - dueMs) / (24 * 60 * 60 * 1000)) : 0;
      const bucket = bucketFor(daysOverdue);
      const totalRow = cur.totals.find((t) => t.bucket === bucket)!;
      totalRow.total = +(totalRow.total + outstanding).toFixed(2);
      totalRow.invoiceCount += 1;
      cur.totalOutstanding = +(cur.totalOutstanding + outstanding).toFixed(2);
      if (bucket !== 'current') cur.totalOverdue = +(cur.totalOverdue + outstanding).toFixed(2);

      const cid = inv.contactId ?? 'unattributed';
      let row = cur.customerMap.get(cid);
      if (!row) {
        const contact = inv.contactId ? contactOf.get(inv.contactId) : undefined;
        const name = contact
          ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email
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
        cur.customerMap.set(cid, row);
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

    // One report per currency owed, each beside its own ledger AR balance;
    // the business currency always has one (zeros when nothing is owed in it).
    const byCurrency: Record<string, AgingCurrencyReport> = {};
    for (const code of Array.from(new Set([home, ...buckets.keys()])).sort()) {
      const b = bucketOf(code);
      const ledgerArBalance = await this.getLedgerArBalance(businessId, asOf, code);
      const ledgerDelta = +(b.totalOutstanding - ledgerArBalance).toFixed(2);
      byCurrency[code] = {
        currency: code,
        totals: b.totals,
        totalOutstanding: b.totalOutstanding,
        totalOverdue: b.totalOverdue,
        customers: Array.from(b.customerMap.values()).sort((x, y) => y.total - x.total),
        ledgerArBalance,
        ledgerReconciled: Math.abs(ledgerDelta) < 0.01,
        ledgerDelta,
      };
    }
    const top = byCurrency[home];

    return {
      asOf: asOf.toISOString(),
      currency: home,
      totals: top.totals,
      totalOutstanding: top.totalOutstanding,
      totalOverdue: top.totalOverdue,
      customers: top.customers,
      ledgerArBalance: top.ledgerArBalance,
      ledgerReconciled: top.ledgerReconciled,
      ledgerDelta: top.ledgerDelta,
      basis,
      byCurrency,
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
        currency: true,
        issueDate: true,
        dueDate: true,
        // Own-tenant rows only (M31, review SEC-V29B-1).
        payments: { where: { businessId }, select: { amount: true, status: true } },
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
      // The invoice's balance over its Payment rows (V1-29b-REFUND-READERS,
      // CR-V29-2): `net` is the money received less refunds, `remaining` what
      // is still owed, both in integer cents. The SUCCESSFUL rows alone were
      // written for the pre-V1-29 flip and read a refunded invoice as paid.
      const balance = balanceOfStoredRows(total, inv.payments, inv.currency);
      const net = balance.net;
      const ledgerBalance = +(ledgerArByInvoice.get(inv.id) ?? 0).toFixed(2);
      const outstanding =
        basis === 'ACCRUAL' && ledgerArByInvoice.has(inv.id)
          ? Math.max(0, ledgerBalance)
          : balance.remaining;
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
