import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { buildPdf, type PdfLine } from './pdf-builder';
import { buildZip, type ZipEntry } from './zip-builder';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { normalizeCurrency } from './posting.service';

/**
 * FIN7 — Accountant Export package builder.
 *
 * Returns a single ZIP buffer containing:
 *   - profit-and-loss.pdf
 *   - cashflow.pdf
 *   - balance-sheet.pdf
 *   - ar-aging.csv
 *   - ap-aging.csv
 *   - tax-summary.csv
 *   - trial-balance.csv
 *   - general-ledger.csv     (every LedgerEntry in the period)
 *   - audit-log.csv          (every TeamActivityLog row in the period)
 *   - manifest.txt           (period, basis, generated-at, file index)
 *
 * All numeric figures source from the same ledger that powers the
 * Reports tab so the accountant sees the same numbers as the operator.
 *
 * W10-BOOKS-EXPORTS (CR-BSX-03, owner ruling D-13): every statement reports
 * each currency apart, as the Books view and the balance-sheet exports do. The
 * pack grouped ledger entries by account only and labelled every figure with
 * the raw business currency, so a USD business's TTD cash was added into its
 * USD balance sheet (assets 357 = USD 277 + TTD 80), P&L, cashflow and trial
 * balance. The statements are now built per (account, normalized currency):
 * the business currency first, then each other currency on its own, every
 * amount labelled with its code, nothing converted or added across currencies.
 */

export interface AccountantExportInput {
  businessId: string;
  periodStart: Date;
  periodEnd: Date;
  basis?: 'CASH' | 'ACCRUAL';
  userId?: string | null;
}

export interface AccountantExportResult {
  filename: string;
  contentType: 'application/zip';
  buffer: Buffer;
  bytes: number;
  generatedAt: string;
}

/** One account's ledger debit and credit in one currency (W10-BOOKS-EXPORTS, D-13). */
type AccountSum = { debit: Prisma.Decimal; credit: Prisma.Decimal };
/** Normalized currency code -> account id -> that account's sums in the currency. */
type SumsByCurrency = Map<string, Map<string, AccountSum>>;

const ZERO = new Prisma.Decimal(0);
const ZERO_SUM: AccountSum = { debit: ZERO, credit: ZERO };

/** One currency's P&L for the period. */
interface PnlFigures {
  currency: string;
  revenue: number;
  taxCollected: number;
  expenseLines: Array<{ category: string; total: number }>;
  expenseTotal: number;
  netProfit: number;
  basis: 'CASH' | 'ACCRUAL';
}

/** One currency's balance sheet as of the period end. */
interface BalanceSheetFigures {
  currency: string;
  asOf: Date;
  accounts: Array<{ name: string; type: string; balance: number; code: string | null }>;
  assets: number;
  liabilities: number;
  equity: number;
  income: number;
  cogs: number;
  expenses: number;
}

/** One currency's cash movement for the period. */
interface CashflowFigures {
  currency: string;
  inflows: number;
  outflows: number;
  net: number;
  byAccount: Array<{ name: string; inflows: number; outflows: number }>;
}

/** One trial-balance row: one account in one currency. */
interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  currency: string;
}

/** The business currency first, then each other currency by code (W10-BOOKS-EXPORTS, D-13). */
function currencyOrder(businessCurrency: string, codes: Iterable<string>): string[] {
  return [businessCurrency, ...[...new Set(codes)].filter((c) => c !== businessCurrency).sort()];
}

@Injectable()
export class AccountantExportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChartOfAccountsSeederService) private readonly coa: ChartOfAccountsSeederService,
  ) {}

  async build(input: AccountantExportInput): Promise<AccountantExportResult> {
    if (!(input.periodStart instanceof Date) || isNaN(input.periodStart.getTime())) {
      throw new BadRequestException('Invalid periodStart');
    }
    if (!(input.periodEnd instanceof Date) || isNaN(input.periodEnd.getTime())) {
      throw new BadRequestException('Invalid periodEnd');
    }
    if (input.periodEnd.getTime() < input.periodStart.getTime()) {
      throw new BadRequestException('periodEnd must be on or after periodStart');
    }
    await this.coa.ensureDefaults(input.businessId);

    const business = await this.prisma.client.business.findUnique({
      where: { id: input.businessId },
      select: { name: true, currency: true, accountingBasis: true, address: true, email: true, phone: true },
    });
    if (!business) throw new BadRequestException('Business not found');
    const basis = (input.basis ?? business.accountingBasis ?? 'CASH') as 'CASH' | 'ACCRUAL';
    // W10-BOOKS-EXPORTS (CR-BSX-03, D-13): normalized, as the posting door and the
    // Books view read it (a business stored as ' usd' is USD, never ' usd').
    const currency = normalizeCurrency(business.currency) || 'TTD';

    const [
      pnl,
      balance,
      cashflow,
      arAging,
      apAging,
      taxSummary,
      trialBalance,
      generalLedger,
      auditLog,
    ] = await Promise.all([
      this.computePnl(input.businessId, input.periodStart, input.periodEnd, basis, currency),
      this.computeBalanceSheet(input.businessId, input.periodEnd, currency),
      this.computeCashflow(input.businessId, input.periodStart, input.periodEnd, currency),
      this.computeArAging(input.businessId, input.periodEnd),
      this.computeApAging(input.businessId, input.periodEnd),
      this.computeTaxSummary(input.businessId, input.periodStart, input.periodEnd),
      this.computeTrialBalance(input.businessId, input.periodEnd, currency),
      this.collectGeneralLedger(input.businessId, input.periodStart, input.periodEnd),
      this.collectAuditLog(input.businessId, input.periodStart, input.periodEnd),
    ]);

    // Every other currency any statement reports on its own (W10-BOOKS-EXPORTS, D-13).
    const otherCurrencies = [...new Set([...pnl, ...balance, ...cashflow, ...trialBalance].map((s) => s.currency))]
      .filter((code) => code !== currency)
      .sort();
    const header = {
      business: business.name,
      currency,
      otherCurrencies,
      basis,
      periodStart: ymd(input.periodStart),
      periodEnd: ymd(input.periodEnd),
      generatedAt: new Date().toISOString(),
    };

    const entries: ZipEntry[] = [
      { name: 'manifest.txt', data: Buffer.from(buildManifest(header), 'utf8') },
      { name: 'profit-and-loss.pdf', data: buildPdf(pnlPdfLines(header, pnl)) },
      { name: 'balance-sheet.pdf', data: buildPdf(balanceSheetPdfLines(header, balance)) },
      { name: 'cashflow.pdf', data: buildPdf(cashflowPdfLines(header, cashflow)) },
      { name: 'ar-aging.csv', data: Buffer.from(arAgingCsv(arAging), 'utf8') },
      { name: 'ap-aging.csv', data: Buffer.from(apAgingCsv(apAging), 'utf8') },
      { name: 'tax-summary.csv', data: Buffer.from(taxSummaryCsv(taxSummary), 'utf8') },
      { name: 'trial-balance.csv', data: Buffer.from(trialBalanceCsv(trialBalance), 'utf8') },
      { name: 'general-ledger.csv', data: Buffer.from(generalLedgerCsv(generalLedger), 'utf8') },
      { name: 'audit-log.csv', data: Buffer.from(auditLogCsv(auditLog), 'utf8') },
    ];

    const buffer = buildZip(entries);
    const ts = new Date().toISOString().slice(0, 10);
    const safeName = (business.name || 'business').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
    return {
      filename: `accountant-export-${safeName}-${ymd(input.periodStart)}_${ymd(input.periodEnd)}-${ts}.zip`,
      contentType: 'application/zip',
      buffer,
      bytes: buffer.length,
      generatedAt: header.generatedAt,
    };
  }

  // -------------------------------------------------------------------
  // Compute helpers — all source data through Prisma.
  // -------------------------------------------------------------------

  /**
   * W10-BOOKS-EXPORTS (CR-BSX-03, owner ruling D-13): ledger debit and credit
   * summed per account, keyed by normalized currency. Every posting balances in
   * its one currency (PostingService), so each currency's figures stand on their
   * own. Grouped by the stored code and folded by normalizeCurrency, the door's
   * own rule as LedgerBalanceService reads it: a legacy ' usd' row is USD, and a
   * row naming no currency is the business currency's.
   */
  private async sumsByCurrency(where: Prisma.LedgerEntryWhereInput, businessCurrency: string): Promise<SumsByCurrency> {
    const groups = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId', 'currency'],
      where,
      _sum: { debit: true, credit: true },
    });
    const out: SumsByCurrency = new Map();
    for (const g of groups) {
      const code = normalizeCurrency(g.currency) || businessCurrency;
      const perAccount = out.get(code) ?? new Map<string, AccountSum>();
      const sum = perAccount.get(g.accountId) ?? ZERO_SUM;
      perAccount.set(g.accountId, {
        debit: sum.debit.add(new Prisma.Decimal(String(g._sum.debit ?? 0))),
        credit: sum.credit.add(new Prisma.Decimal(String(g._sum.credit ?? 0))),
      });
      out.set(code, perAccount);
    }
    return out;
  }

  private async computePnl(businessId: string, start: Date, end: Date, basis: 'CASH' | 'ACCRUAL', currency: string): Promise<PnlFigures[]> {
    // Ledger-driven P&L. Sum activity on INCOME / EXPENSE / COGS accounts
    // for the period. INCOME credits are revenue; EXPENSE/COGS debits are
    // costs. The `basis` flag is informational here — postings are written
    // by RevenuePostingService / ExpensePostingService respecting the
    // business's accounting basis at point of posting, so the same query
    // works under both regimes. One P&L per currency (W10-BOOKS-EXPORTS, D-13).
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, isActive: true, type: { in: ['INCOME', 'EXPENSE', 'COGS'] } },
      select: { id: true, name: true, type: true, code: true },
    });
    // Tax collected for the same period — taken from the same ledger
    // (TAX_PAYABLE credits) so the P&L and Tax tab cannot drift.
    const taxAccount = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey: 'TAX_PAYABLE' },
      select: { id: true },
    });
    const ids = [...accounts.map((a) => a.id), ...(taxAccount ? [taxAccount.id] : [])];
    const sums: SumsByCurrency = ids.length > 0
      ? await this.sumsByCurrency({ businessId, accountId: { in: ids }, date: { gte: start, lte: end } }, currency)
      : new Map();

    return currencyOrder(currency, sums.keys()).map((code) => {
      const perAccount = sums.get(code) ?? new Map<string, AccountSum>();
      let revenue = ZERO;
      const expenses: Array<{ category: string; total: Prisma.Decimal }> = [];
      for (const a of accounts) {
        const s = perAccount.get(a.id) ?? ZERO_SUM;
        if (a.type === 'INCOME') {
          revenue = revenue.add(s.credit.sub(s.debit));
        } else {
          const total = s.debit.sub(s.credit);
          if (!total.isZero()) expenses.push({ category: a.name, total });
        }
      }
      expenses.sort((a, b) => b.total.comparedTo(a.total));
      const expenseTotal = expenses.reduce((sum, l) => sum.add(l.total), ZERO);
      const tax = taxAccount ? perAccount.get(taxAccount.id) : undefined;
      return {
        currency: code,
        revenue: revenue.toNumber(),
        taxCollected: tax ? tax.credit.sub(tax.debit).toNumber() : 0,
        expenseLines: expenses.map((l) => ({ category: l.category, total: l.total.toNumber() })),
        expenseTotal: expenseTotal.toNumber(),
        netProfit: revenue.sub(expenseTotal).toNumber(),
        basis,
      };
    });
  }

  private async computeBalanceSheet(businessId: string, asOf: Date, currency: string): Promise<BalanceSheetFigures[]> {
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, type: true, code: true, systemKey: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    // One sheet per currency the active accounts hold, as the Books balance
    // sheet (LedgerReportingService.getBalanceSheet) reads it (W10-BOOKS-EXPORTS, D-13).
    const sums: SumsByCurrency = accounts.length > 0
      ? await this.sumsByCurrency({ businessId, accountId: { in: accounts.map((a) => a.id) }, date: { lte: asOf } }, currency)
      : new Map();

    return currencyOrder(currency, sums.keys()).map((code) => {
      const perAccount = sums.get(code) ?? new Map<string, AccountSum>();
      const rows = accounts.map((a) => {
        const b = perAccount.get(a.id) ?? ZERO_SUM;
        // Asset/Expense/COGS naturally debit-positive; others credit-positive.
        const sign = a.type === 'ASSET' || a.type === 'EXPENSE' || a.type === 'COGS' ? 1 : -1;
        return { ...a, balance: b.debit.sub(b.credit).mul(sign) };
      });
      const sumByType = (t: string) =>
        rows.filter((r) => r.type === t).reduce((s, r) => s.add(r.balance), ZERO).toNumber();
      return {
        currency: code,
        asOf,
        accounts: rows.map((r) => ({ ...r, balance: r.balance.toNumber() })),
        assets: sumByType('ASSET'),
        liabilities: sumByType('LIABILITY'),
        equity: sumByType('EQUITY'),
        income: sumByType('INCOME'),
        cogs: sumByType('COGS'),
        expenses: sumByType('EXPENSE'),
      };
    });
  }

  private async computeCashflow(businessId: string, start: Date, end: Date, currency: string): Promise<CashflowFigures[]> {
    const cashAccounts = await this.prisma.client.chartOfAccount.findMany({
      where: {
        businessId,
        systemKey: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] },
      },
      select: { id: true, name: true, systemKey: true },
    });
    const ids = cashAccounts.map((a) => a.id);
    if (ids.length === 0) {
      return [{ currency, inflows: 0, outflows: 0, net: 0, byAccount: [] }];
    }
    // One cashflow per currency (W10-BOOKS-EXPORTS, D-13).
    const sums = await this.sumsByCurrency({ businessId, accountId: { in: ids }, date: { gte: start, lte: end } }, currency);
    return currencyOrder(currency, sums.keys()).map((code) => {
      const perAccount = sums.get(code) ?? new Map<string, AccountSum>();
      // The business currency lists every cash account (as before); another
      // currency lists the cash accounts that moved in it.
      const listed = cashAccounts.filter((a) => code === currency || perAccount.has(a.id));
      let inflows = ZERO;
      let outflows = ZERO;
      const byAccount = listed.map((a) => {
        const s = perAccount.get(a.id) ?? ZERO_SUM;
        inflows = inflows.add(s.debit);
        outflows = outflows.add(s.credit);
        return { name: a.name, inflows: s.debit.toNumber(), outflows: s.credit.toNumber() };
      });
      return {
        currency: code,
        inflows: inflows.toNumber(),
        outflows: outflows.toNumber(),
        net: inflows.sub(outflows).toNumber(),
        byAccount,
      };
    });
  }

  private async computeArAging(businessId: string, asOf: Date) {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      select: {
        id: true, invoiceNumber: true, total: true, dueDate: true, issueDate: true, currency: true,
        contact: { select: { firstName: true, lastName: true, displayName: true, email: true } },
      },
    });
    return invoices.map((inv) => {
      const due = inv.dueDate ?? inv.issueDate;
      const days = Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / 86400000));
      const bucket = days === 0 ? 'Current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      const name = inv.contact?.displayName
        || `${inv.contact?.firstName ?? ''} ${inv.contact?.lastName ?? ''}`.trim()
        || 'Unknown';
      return {
        invoiceNumber: inv.invoiceNumber,
        contact: name,
        email: inv.contact?.email ?? '',
        issueDate: ymd(inv.issueDate),
        dueDate: inv.dueDate ? ymd(inv.dueDate) : '',
        daysOverdue: days,
        bucket,
        amount: Number(inv.total ?? 0),
        currency: inv.currency,
      };
    });
  }

  private async computeApAging(businessId: string, asOf: Date) {
    const bills = await this.prisma.client.expense.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'BILL',
      },
      select: { id: true, description: true, vendor: true, amount: true, currency: true, dueDate: true, date: true },
    });
    return bills.map((b) => {
      const due = b.dueDate ?? b.date;
      const days = Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / 86400000));
      const bucket = days === 0 ? 'Current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      return {
        description: b.description,
        vendor: b.vendor ?? '',
        billDate: ymd(b.date),
        dueDate: b.dueDate ? ymd(b.dueDate) : '',
        daysOverdue: days,
        bucket,
        amount: Number(b.amount ?? 0),
        currency: b.currency,
      };
    });
  }

  private async computeTaxSummary(businessId: string, start: Date, end: Date) {
    const liabilities = await this.prisma.client.taxLiability.findMany({
      where: {
        businessId,
        // True interval-overlap: a liability whose period spans the
        // requested window must also be included, not only periods
        // wholly contained inside it.
        periodStart: { lte: end },
        periodEnd: { gte: start },
      },
      orderBy: { periodEnd: 'asc' },
    });
    return liabilities.map((l) => ({
      type: l.type,
      periodStart: ymd(l.periodStart),
      periodEnd: ymd(l.periodEnd),
      taxableSales: Number(l.taxableSales),
      taxCollected: Number(l.taxCollected),
      taxPaid: Number(l.taxPaid),
      amountDue: Number(l.amountDue),
      status: l.status,
    }));
  }

  private async computeTrialBalance(businessId: string, asOf: Date, currency: string): Promise<TrialBalanceRow[]> {
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, isActive: true },
      select: { id: true, code: true, name: true, type: true, systemKey: true },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });
    // One row per (account, currency), naming its currency: the business
    // currency's rows first, then each other currency's, each currency
    // balancing on its own (W10-BOOKS-EXPORTS, CR-BSX-03, D-13).
    const sums: SumsByCurrency = accounts.length > 0
      ? await this.sumsByCurrency({ businessId, accountId: { in: accounts.map((a) => a.id) }, date: { lte: asOf } }, currency)
      : new Map();
    return currencyOrder(currency, sums.keys()).flatMap((code) => {
      const perAccount = sums.get(code) ?? new Map<string, AccountSum>();
      return accounts.flatMap((a): TrialBalanceRow[] => {
        const s = perAccount.get(a.id) ?? ZERO_SUM;
        const net = s.debit.sub(s.credit);
        if (net.isZero()) return [];
        return [{
          code: a.code ?? '',
          name: a.name,
          type: a.type,
          debit: net.isPositive() ? net.toNumber() : 0,
          credit: net.isNegative() ? net.neg().toNumber() : 0,
          currency: code,
        }];
      });
    });
  }

  private async collectGeneralLedger(businessId: string, start: Date, end: Date) {
    const entries = await this.prisma.client.ledgerEntry.findMany({
      where: { businessId, date: { gte: start, lte: end } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, date: true, debit: true, credit: true, memo: true, currency: true,
        account: { select: { code: true, name: true, systemKey: true } },
        transaction: { select: { id: true, type: true, externalRef: true, sourceType: true, sourceId: true } },
      },
    });
    return entries.map((e) => ({
      date: ymd(e.date),
      txnId: e.transaction.id,
      txnType: e.transaction.type,
      sourceType: e.transaction.sourceType ?? '',
      sourceId: e.transaction.sourceId ?? '',
      account: e.account.name,
      accountCode: e.account.code ?? '',
      systemKey: e.account.systemKey ?? '',
      debit: Number(e.debit ?? 0),
      credit: Number(e.credit ?? 0),
      currency: e.currency,
      memo: e.memo ?? '',
    }));
  }

  private async collectAuditLog(businessId: string, start: Date, end: Date) {
    // Stream every TeamActivityLog row in the period using id-keyset pagination.
    // We deliberately do NOT filter by module — the accountant export is a
    // forensic artefact and must include the full audit trail.
    const PAGE = 1000;
    type Row = {
      id: string;
      createdAt: Date;
      userId: string;
      module: string;
      action: string;
      entityType: string | null;
      entityId: string | null;
      title: string;
      detail: string | null;
    };
    const all: Row[] = [];
    // Stable (createdAt, id) keyset: walk forward by createdAt, breaking
    // ties on id. Avoids the duplicate/missing-row hazard of cursoring on
    // a single non-monotonic field when many rows share a timestamp.
    let lastCreatedAt: Date = start;
    let lastId: string | null = null;
    while (true) {
      const page: Row[] = await this.prisma.client.teamActivityLog.findMany({
        where: {
          businessId,
          createdAt: { lte: end },
          OR: lastId
            ? [
                { createdAt: { gt: lastCreatedAt } },
                { AND: [{ createdAt: { equals: lastCreatedAt } }, { id: { gt: lastId } }] },
              ]
            : [{ createdAt: { gte: lastCreatedAt } }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, createdAt: true, userId: true, module: true, action: true,
          entityType: true, entityId: true, title: true, detail: true,
        },
        take: PAGE,
      });
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < PAGE) break;
      const tail = page[page.length - 1];
      lastCreatedAt = tail.createdAt;
      lastId = tail.id;
    }
    return all.map((r) => ({
      timestamp: r.createdAt.toISOString(),
      userId: r.userId,
      module: r.module,
      action: r.action,
      entityType: r.entityType ?? '',
      entityId: r.entityId ?? '',
      title: r.title,
      detail: r.detail ?? '',
    }));
  }
}

// ---------------------------------------------------------------------
// Pure formatters
// ---------------------------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const out: string[] = [columns.join(',')];
  for (const r of rows) out.push(columns.map((c) => csvEscape(r[c])).join(','));
  return out.join('\n') + '\n';
}

function buildManifest(h: { business: string; currency: string; otherCurrencies: string[]; basis: string; periodStart: string; periodEnd: string; generatedAt: string }): string {
  return [
    'KEYFLOW — Accountant Export',
    `Business:    ${h.business}`,
    `Currency:    ${h.currency}`,
    // W10-BOOKS-EXPORTS (CR-BSX-03, D-13): other currencies are reported on their own.
    ...(h.otherCurrencies.length > 0
      ? [`Also held:   ${h.otherCurrencies.join(', ')} (each reported on its own; never converted or added to ${h.currency})`]
      : []),
    `Basis:       ${h.basis}`,
    `Period:      ${h.periodStart}  →  ${h.periodEnd}`,
    `Generated:   ${h.generatedAt}`,
    '',
    'Files:',
    '  profit-and-loss.pdf       — P&L for the period',
    '  balance-sheet.pdf         — Balance Sheet as of period end',
    '  cashflow.pdf              — Cash inflows / outflows for the period',
    '  ar-aging.csv              — Accounts Receivable aging',
    '  ap-aging.csv              — Accounts Payable aging (open bills)',
    '  tax-summary.csv           — Tax liabilities (VAT / Business Levy)',
    '  trial-balance.csv         — Trial balance as of period end, one row per account and currency',
    '  general-ledger.csv        — Every ledger entry in the period',
    '  audit-log.csv             — Finance/commerce activity log',
    '',
  ].join('\n');
}

function arAgingCsv(rows: Array<{ invoiceNumber: string; contact: string; email: string; issueDate: string; dueDate: string; daysOverdue: number; bucket: string; amount: number; currency: string }>): string {
  return csv(rows, ['invoiceNumber', 'contact', 'email', 'issueDate', 'dueDate', 'daysOverdue', 'bucket', 'amount', 'currency']);
}

function apAgingCsv(rows: Array<{ description: string; vendor: string; billDate: string; dueDate: string; daysOverdue: number; bucket: string; amount: number; currency: string }>): string {
  return csv(rows, ['description', 'vendor', 'billDate', 'dueDate', 'daysOverdue', 'bucket', 'amount', 'currency']);
}

function taxSummaryCsv(rows: Array<Record<string, unknown>>): string {
  return csv(rows, ['type', 'periodStart', 'periodEnd', 'taxableSales', 'taxCollected', 'taxPaid', 'amountDue', 'status']);
}

/** One row per (account, currency), naming its currency (W10-BOOKS-EXPORTS, CR-BSX-03, D-13). */
function trialBalanceCsv(rows: TrialBalanceRow[]): string {
  return csv(rows as unknown as Array<Record<string, unknown>>, ['code', 'name', 'type', 'debit', 'credit', 'currency']);
}

function generalLedgerCsv(rows: Array<Record<string, unknown>>): string {
  return csv(rows, ['date', 'txnId', 'txnType', 'sourceType', 'sourceId', 'accountCode', 'account', 'systemKey', 'debit', 'credit', 'currency', 'memo']);
}

function auditLogCsv(rows: Array<Record<string, unknown>>): string {
  return csv(rows, ['timestamp', 'userId', 'module', 'action', 'entityType', 'entityId', 'title', 'detail']);
}

function fmtMoney(n: number, currency: string): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${currency} ${abs}`;
}

/**
 * W10-BOOKS-EXPORTS (CR-BSX-03, owner ruling D-13): one statement per currency
 * in one PDF. The business currency's figures come first, under the statement's
 * header and a note naming the other currencies; each other currency follows
 * under its own heading ("TTD figures", "TTD balances"), every amount labelled
 * with its code. Nothing is converted or added across currencies. With the
 * business currency alone the statement reads as it always did.
 */
function perCurrencyStatement<T extends { currency: string }>(
  header: PdfLine[],
  sections: T[],
  body: (s: T) => PdfLine[],
  headingOf: (currency: string) => string,
): PdfLine[] {
  const [first, ...others] = sections;
  const lines: PdfLine[] = [...header];
  if (others.length > 0) {
    // Two short lines: the builder draws one line per text and never wraps.
    lines.push(
      { kind: 'text', text: `Amounts in ${first.currency}. ${others.map((s) => s.currency).join(', ')} amounts follow on their own;` },
      { kind: 'text', text: `they are not converted or added to the ${first.currency} figures.` },
    );
  }
  lines.push({ kind: 'spacer' }, ...body(first));
  for (const s of others) {
    lines.push({ kind: 'spacer' }, { kind: 'heading', text: headingOf(s.currency) }, { kind: 'spacer' }, ...body(s));
  }
  return lines;
}

function pnlPdfLines(h: { business: string; basis: string; periodStart: string; periodEnd: string }, sections: PnlFigures[]): PdfLine[] {
  const body = (p: PnlFigures): PdfLine[] => {
    const ccy = p.currency;
    const lines: PdfLine[] = [
      { kind: 'heading', text: 'Revenue' },
      { kind: 'row', left: '  Sales (net of tax)', right: fmtMoney(p.revenue, ccy) },
      { kind: 'row', left: '  Tax collected', right: fmtMoney(p.taxCollected, ccy) },
      { kind: 'rule' },
      { kind: 'row', left: 'Total Revenue', right: fmtMoney(p.revenue, ccy) },
      { kind: 'spacer' },
      { kind: 'heading', text: 'Operating Expenses' },
    ];
    for (const e of p.expenseLines) lines.push({ kind: 'row', left: `  ${e.category}`, right: fmtMoney(e.total, ccy) });
    lines.push({ kind: 'rule' });
    lines.push({ kind: 'row', left: 'Total Expenses', right: fmtMoney(p.expenseTotal, ccy) });
    lines.push({ kind: 'spacer' });
    lines.push({ kind: 'rule' });
    lines.push({ kind: 'row', left: 'Net Profit', right: fmtMoney(p.netProfit, ccy) });
    return lines;
  };
  return perCurrencyStatement([
    { kind: 'title', text: 'Profit & Loss' },
    { kind: 'text', text: h.business },
    { kind: 'text', text: `${h.periodStart}  →  ${h.periodEnd}    (${h.basis} basis)` },
  ], sections, body, (code) => `${code} figures`);
}

function balanceSheetPdfLines(h: { business: string; periodEnd: string }, sheets: BalanceSheetFigures[]): PdfLine[] {
  const body = (b: BalanceSheetFigures): PdfLine[] => {
    const ccy = b.currency;
    const section = (title: string, type: string, total: number): PdfLine[] => {
      const out: PdfLine[] = [{ kind: 'heading', text: title }];
      for (const a of b.accounts.filter((x) => x.type === type && Math.abs(x.balance) > 0.005)) {
        out.push({ kind: 'row', left: `  ${a.code ? a.code + ' · ' : ''}${a.name}`, right: fmtMoney(a.balance, ccy) });
      }
      out.push({ kind: 'rule' });
      out.push({ kind: 'row', left: `Total ${title}`, right: fmtMoney(total, ccy) });
      out.push({ kind: 'spacer' });
      return out;
    };
    const retained = b.income - b.cogs - b.expenses;
    return [
      ...section('Assets', 'ASSET', b.assets),
      ...section('Liabilities', 'LIABILITY', b.liabilities),
      ...section('Equity', 'EQUITY', b.equity),
      { kind: 'row', left: '  Retained earnings (period activity)', right: fmtMoney(retained, ccy) },
      { kind: 'rule' },
      { kind: 'row', left: 'Total Liabilities + Equity', right: fmtMoney(b.liabilities + b.equity + retained, ccy) },
    ];
  };
  return perCurrencyStatement([
    { kind: 'title', text: 'Balance Sheet' },
    { kind: 'text', text: h.business },
    { kind: 'text', text: `As of ${h.periodEnd}` },
  ], sheets, body, (code) => `${code} balances`);
}

function cashflowPdfLines(h: { business: string; periodStart: string; periodEnd: string }, sections: CashflowFigures[]): PdfLine[] {
  const body = (c: CashflowFigures): PdfLine[] => {
    const ccy = c.currency;
    const lines: PdfLine[] = [{ kind: 'heading', text: 'By cash account' }];
    for (const a of c.byAccount) {
      lines.push({ kind: 'row', left: `  ${a.name} — inflows`, right: fmtMoney(a.inflows, ccy) });
      lines.push({ kind: 'row', left: `  ${a.name} — outflows`, right: fmtMoney(a.outflows, ccy) });
    }
    lines.push({ kind: 'rule' });
    lines.push({ kind: 'row', left: 'Total inflows', right: fmtMoney(c.inflows, ccy) });
    lines.push({ kind: 'row', left: 'Total outflows', right: fmtMoney(c.outflows, ccy) });
    lines.push({ kind: 'rule' });
    lines.push({ kind: 'row', left: 'Net cash movement', right: fmtMoney(c.net, ccy) });
    return lines;
  };
  return perCurrencyStatement([
    { kind: 'title', text: 'Cashflow Statement' },
    { kind: 'text', text: h.business },
    { kind: 'text', text: `${h.periodStart}  →  ${h.periodEnd}` },
  ], sections, body, (code) => `${code} figures`);
}
