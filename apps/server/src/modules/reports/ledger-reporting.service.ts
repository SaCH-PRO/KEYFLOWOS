import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LedgerBalanceService } from '../finance/ledger-balance.service';
import { ReceivablesService, AgingReport } from '../finance/receivables.service';

export type ReportBasis = 'cash' | 'accrual';

export interface PnlAccountLine {
  accountId: string;
  systemKey: string | null;
  name: string;
  amount: number;
}

export interface PnlGroup {
  total: number;
  accounts: PnlAccountLine[];
}

export interface PnlReport {
  basis: ReportBasis;
  currency: string;
  period: { from: string; to: string };
  revenue: PnlGroup;
  discounts: PnlGroup;
  cogs: PnlGroup;
  grossProfit: number;
  operatingExpenses: PnlGroup;
  netProfit: number;
}

export interface CashflowReport {
  basis: ReportBasis;
  currency: string;
  period: { from: string; to: string };
  cashIn: number;
  cashOut: number;
  netMovement: number;
  byAccount: Array<{
    accountId: string;
    systemKey: string | null;
    name: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
  /**
   * Indirect-method working-capital adjustments. Populated only on
   * accrual basis: under accrual, the cashflow statement starts from
   * net income and adjusts for AR/AP/Tax movement, so cash-from-ops
   * differs from raw net cash movement. Under cash basis these are
   * always zero (raw cash movement IS cash from ops).
   */
  accrualAdjustments: {
    netIncome: number;
    arChange: number;
    apChange: number;
    taxPayableChange: number;
    cashFromOperations: number;
  };
  upcomingReceivables: { total: number; count: number };
  upcomingPayables: { total: number; count: number };
}

export interface BalanceSheetReport {
  asOf: string;
  currency: string;
  assets: { total: number; lines: PnlAccountLine[]; cashAndBank: number; accountsReceivable: number; inventory: number };
  liabilities: { total: number; lines: PnlAccountLine[]; accountsPayable: number; taxPayable: number; loans: number };
  equity: { total: number; lines: PnlAccountLine[]; ownerEquity: number; retainedEarnings: number };
  netEquityFromIncome: number;
  identityHolds: boolean;
  identityDelta: number;
}

export interface TaxSummaryReport {
  currency: string;
  period: { from: string; to: string };
  taxableSales: number;
  taxCollected: number;
  taxPaidOnPurchases: number;
  estimatedDue: number;
  invoiceTaxes: { taxAmount: number; subtotal: number; ledgerToInvoiceDelta: number };
  liabilities: Array<{
    id: string;
    type: string;
    periodStart: string;
    periodEnd: string;
    taxableSales: number;
    taxCollected: number;
    taxPaid: number;
    amountDue: number;
    status: string;
  }>;
}

export interface DimensionRow {
  key: string;
  label: string;
  total: number;
  count: number;
}

const D = Prisma.Decimal;
const ZERO = new D(0);
const CASH_KEYS = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR', 'CREDIT_CARD']);

function toNum(d: Prisma.Decimal | number | string | null | undefined): number {
  if (d == null) return 0;
  return Number(typeof d === 'object' && 'toString' in d ? d.toString() : d);
}

/**
 * FIN4 — Read-only report query layer. Every figure traces back to
 * `LedgerEntry` via `FinancialTransaction`. The same business may be on
 * cash or accrual basis (per `Business.accountingBasis`), and the
 * `basis` query param overrides per-request for PnL/Cashflow.
 *
 * Cash basis filter: only count entries whose parent FinancialTransaction
 * also touched a Cash/Bank/Processor/Credit-Card account. This produces
 * the classic cash-only revenue/expense view from a single ledger.
 */
@Injectable()
export class LedgerReportingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerBalanceService) private readonly balances: LedgerBalanceService,
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
  ) {}

  // ---- helpers --------------------------------------------------------

  private async getCurrency(businessId: string): Promise<string> {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    return biz?.currency ?? 'TTD';
  }

  private async cashTouchingTxIds(businessId: string, from: Date, to: Date): Promise<Set<string>> {
    const ids = await this.prisma.client.ledgerEntry.findMany({
      where: {
        businessId,
        date: { gte: from, lte: to },
        account: { systemKey: { in: Array.from(CASH_KEYS) } },
      },
      select: { transactionId: true },
      distinct: ['transactionId'],
    });
    return new Set(ids.map((r) => r.transactionId));
  }

  /**
   * FIN4 — proper cash-basis P&L derivation.
   *
   * For every FinancialTransaction in the period that touches a cash
   * account, classify the cash movement against income/COGS/expense:
   *
   *  • Direct cash sale/expense (e.g. Cash↔Revenue, Expense↔Cash on the
   *    same txn): attribute amounts to the in-txn INCOME/COGS/EXPENSE
   *    line directly.
   *  • Customer payment (Cash↔AR, sourceType='Payment'): trace the
   *    payment back to its originating Invoice posting and allocate the
   *    cash collected proportionally across that invoice's INCOME line
   *    composition.
   *  • Vendor bill payment (AP↔Cash, sourceType='Expense' kind=
   *    bill_paid): trace to the sibling 'bill_created' posting (same
   *    sourceId) and allocate the cash paid across its EXPENSE/COGS
   *    composition.
   *  • Pure asset swaps (e.g. Cash↔Inventory) carry no income/expense
   *    leg under cash basis and are skipped.
   */
  private async computeCashBasisPnl(
    businessId: string,
    from: Date,
    to: Date,
  ): Promise<{
    income: PnlAccountLine[];
    cogs: PnlAccountLine[];
    expense: PnlAccountLine[];
    operatingCashByAccount: Array<{ accountId: string; name: string; systemKey: string | null; inflow: number; outflow: number; net: number }>;
    operatingCashIn: number;
    operatingCashOut: number;
  }> {
    const txns = await this.prisma.client.financialTransaction.findMany({
      where: {
        businessId,
        status: 'POSTED',
        date: { gte: from, lte: to },
        entries: { some: { account: { systemKey: { in: Array.from(CASH_KEYS) } } } },
      },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        entries: {
          select: {
            accountId: true,
            debit: true,
            credit: true,
            account: { select: { id: true, name: true, type: true, systemKey: true } },
          },
        },
      },
    });

    type Bucket = Map<string, { name: string; systemKey: string | null; amount: number }>;
    const income: Bucket = new Map();
    const cogs: Bucket = new Map();
    const expense: Bucket = new Map();
    type CashBucket = Map<string, { name: string; systemKey: string | null; inflow: number; outflow: number }>;
    const opCash: CashBucket = new Map();
    const addOpCash = (
      accountId: string,
      name: string,
      systemKey: string | null,
      delta: number,
    ) => {
      const cur = opCash.get(accountId) ?? { name, systemKey, inflow: 0, outflow: 0 };
      if (delta > 0) cur.inflow += delta;
      else cur.outflow += -delta;
      opCash.set(accountId, cur);
    };
    const add = (
      m: Bucket,
      accountId: string,
      name: string,
      systemKey: string | null,
      amount: number,
    ) => {
      const cur = m.get(accountId) ?? { name, systemKey, amount: 0 };
      cur.amount += amount;
      m.set(accountId, cur);
    };

    // Pre-fetch source rows for tracing settlements.
    const paymentIds = txns
      .filter((t) => t.sourceType === 'Payment' && !!t.sourceId)
      .map((t) => t.sourceId as string);
    const billIds = txns
      .filter((t) => t.sourceType === 'Expense' && !!t.sourceId)
      .map((t) => t.sourceId as string);
    const payments = paymentIds.length
      ? await this.prisma.client.payment.findMany({
          where: { id: { in: paymentIds } },
          select: { id: true, invoiceId: true },
        })
      : [];
    const paymentToInvoice = new Map(payments.map((p) => [p.id, p.invoiceId]));
    const invoiceIds = Array.from(new Set(payments.map((p) => p.invoiceId).filter(Boolean) as string[]));

    type SourceTxn = { sourceType: string | null; sourceId: string | null; entries: typeof txns[number]['entries'] };
    const sourceTxns: SourceTxn[] = (invoiceIds.length || billIds.length)
      ? await this.prisma.client.financialTransaction.findMany({
          where: {
            businessId,
            OR: [
              ...(invoiceIds.length ? [{ sourceType: 'Invoice', sourceId: { in: invoiceIds } }] : []),
              ...(billIds.length ? [{ sourceType: 'Expense', sourceId: { in: billIds } }] : []),
            ],
          },
          select: {
            sourceType: true,
            sourceId: true,
            entries: {
              select: {
                accountId: true,
                debit: true,
                credit: true,
                account: { select: { id: true, name: true, type: true, systemKey: true } },
              },
            },
          },
        })
      : [];
    const sourceByKey = new Map<string, SourceTxn[]>();
    for (const st of sourceTxns) {
      const k = `${st.sourceType}:${st.sourceId}`;
      const arr = sourceByKey.get(k) ?? [];
      arr.push(st);
      sourceByKey.set(k, arr);
    }

    for (const t of txns) {
      let cashEffect = 0;
      const cashEntries: typeof t.entries = [];
      const directIncome: typeof t.entries = [];
      const directCogs: typeof t.entries = [];
      const directExpense: typeof t.entries = [];
      let touchesAR = false;
      let touchesAP = false;
      for (const e of t.entries) {
        const sk = e.account.systemKey;
        if (sk && CASH_KEYS.has(sk)) {
          cashEffect += toNum(e.debit) - toNum(e.credit);
          cashEntries.push(e);
          continue;
        }
        if (e.account.type === 'INCOME') directIncome.push(e);
        else if (e.account.type === 'COGS') directCogs.push(e);
        else if (e.account.type === 'EXPENSE') directExpense.push(e);
        if (sk === 'ACCOUNTS_RECEIVABLE') touchesAR = true;
        if (sk === 'ACCOUNTS_PAYABLE') touchesAP = true;
      }

      const recordOperatingCash = () => {
        for (const ce of cashEntries) {
          const delta = toNum(ce.debit) - toNum(ce.credit);
          if (Math.abs(delta) < 0.005) continue;
          addOpCash(ce.accountId, ce.account.name, ce.account.systemKey, delta);
        }
      };

      if (directIncome.length || directCogs.length || directExpense.length) {
        // Direct cash sale or direct paid expense.
        for (const e of directIncome) add(income, e.accountId, e.account.name, e.account.systemKey, toNum(e.credit) - toNum(e.debit));
        for (const e of directCogs) add(cogs, e.accountId, e.account.name, e.account.systemKey, toNum(e.debit) - toNum(e.credit));
        for (const e of directExpense) add(expense, e.accountId, e.account.name, e.account.systemKey, toNum(e.debit) - toNum(e.credit));
        recordOperatingCash();
        continue;
      }

      // Customer payment settling AR — trace to invoice and allocate.
      if (touchesAR && cashEffect > 0 && t.sourceType === 'Payment' && t.sourceId) {
        const invoiceId = paymentToInvoice.get(t.sourceId);
        if (!invoiceId) continue;
        const lines = (sourceByKey.get(`Invoice:${invoiceId}`) ?? [])
          .flatMap((s) => s.entries)
          .filter((e) => e.account.type === 'INCOME');
        const total = lines.reduce((s, e) => s + (toNum(e.credit) - toNum(e.debit)), 0);
        if (total <= 0) continue;
        for (const e of lines) {
          const lineAmt = toNum(e.credit) - toNum(e.debit);
          add(income, e.accountId, e.account.name, e.account.systemKey, cashEffect * (lineAmt / total));
        }
        recordOperatingCash();
        continue;
      }

      // Vendor bill payment settling AP — trace to bill and allocate.
      if (touchesAP && cashEffect < 0 && t.sourceType === 'Expense' && t.sourceId) {
        const lines = (sourceByKey.get(`Expense:${t.sourceId}`) ?? [])
          .flatMap((s) => s.entries)
          .filter((e) => e.account.type === 'EXPENSE' || e.account.type === 'COGS');
        const total = lines.reduce((s, e) => s + (toNum(e.debit) - toNum(e.credit)), 0);
        if (total <= 0) continue;
        const cashOut = -cashEffect;
        for (const e of lines) {
          const lineAmt = toNum(e.debit) - toNum(e.credit);
          const dest = e.account.type === 'COGS' ? cogs : expense;
          add(dest, e.accountId, e.account.name, e.account.systemKey, cashOut * (lineAmt / total));
        }
        recordOperatingCash();
      }
      // Otherwise: pure asset swap, financing, opening balance — not
      // operating; skipped from both P&L and operating cash.
    }

    const toLines = (m: Bucket): PnlAccountLine[] =>
      Array.from(m.entries())
        .map(([id, v]) => ({ accountId: id, name: v.name, systemKey: v.systemKey, amount: +v.amount.toFixed(2) }))
        .filter((r) => Math.abs(r.amount) >= 0.005);

    const operatingCashByAccount = Array.from(opCash.entries())
      .map(([id, v]) => ({
        accountId: id,
        name: v.name,
        systemKey: v.systemKey,
        inflow: +v.inflow.toFixed(2),
        outflow: +v.outflow.toFixed(2),
        net: +(v.inflow - v.outflow).toFixed(2),
      }))
      .filter((r) => r.inflow >= 0.005 || r.outflow >= 0.005);
    const operatingCashIn = +operatingCashByAccount.reduce((s, r) => s + r.inflow, 0).toFixed(2);
    const operatingCashOut = +operatingCashByAccount.reduce((s, r) => s + r.outflow, 0).toFixed(2);

    return {
      income: toLines(income),
      cogs: toLines(cogs),
      expense: toLines(expense),
      operatingCashByAccount,
      operatingCashIn,
      operatingCashOut,
    };
  }

  /**
   * Sum debit/credit per account in a period, optionally restricted by
   * a set of FinancialTransaction ids (used for cash-basis filtering).
   * Returns one row per account with its COA metadata.
   */
  private async aggregateByAccount(
    businessId: string,
    from: Date,
    to: Date,
    types: string[],
    txIdFilter?: Set<string>,
  ): Promise<PnlAccountLine[]> {
    const where: Prisma.LedgerEntryWhereInput = {
      businessId,
      date: { gte: from, lte: to },
      account: { type: { in: types } },
    };
    if (txIdFilter) {
      if (txIdFilter.size === 0) return [];
      where.transactionId = { in: Array.from(txIdFilter) };
    }
    const rows = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId'],
      where,
      _sum: { debit: true, credit: true },
    });
    if (rows.length === 0) return [];
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, name: true, type: true, systemKey: true },
    });
    const meta = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((r) => {
      const m = meta.get(r.accountId);
      const debit = toNum(r._sum.debit);
      const credit = toNum(r._sum.credit);
      // Normal balance: INCOME/LIABILITY/EQUITY -> credit positive;
      // ASSET/EXPENSE/COGS -> debit positive.
      const isCreditNormal = m && ['INCOME', 'LIABILITY', 'EQUITY'].includes(m.type);
      const amount = isCreditNormal ? credit - debit : debit - credit;
      return {
        accountId: r.accountId,
        name: m?.name ?? '(unknown)',
        systemKey: m?.systemKey ?? null,
        amount: +amount.toFixed(2),
      };
    }).filter((r) => Math.abs(r.amount) >= 0.005);
  }

  // ---- PnL ------------------------------------------------------------

  async getPnl(
    businessId: string,
    from: Date,
    to: Date,
    basis: ReportBasis = 'accrual',
  ): Promise<PnlReport> {
    const currency = await this.getCurrency(businessId);

    let income: PnlAccountLine[];
    let cogsLines: PnlAccountLine[];
    let expenseLines: PnlAccountLine[];
    if (basis === 'cash') {
      const c = await this.computeCashBasisPnl(businessId, from, to);
      income = c.income;
      cogsLines = c.cogs;
      expenseLines = c.expense;
    } else {
      [income, cogsLines, expenseLines] = await Promise.all([
        this.aggregateByAccount(businessId, from, to, ['INCOME']),
        this.aggregateByAccount(businessId, from, to, ['COGS']),
        this.aggregateByAccount(businessId, from, to, ['EXPENSE']),
      ]);
    }

    const discountsLines = income.filter((l) => l.systemKey === 'DISCOUNTS_GIVEN');
    const revenueLines = income.filter((l) => l.systemKey !== 'DISCOUNTS_GIVEN');
    const sum = (rows: PnlAccountLine[]) => +rows.reduce((s, r) => s + r.amount, 0).toFixed(2);

    const revenueTotal = sum(revenueLines);
    const discountTotal = sum(discountsLines);
    const cogsTotal = sum(cogsLines);
    const opexTotal = sum(expenseLines);
    const grossProfit = +(revenueTotal - discountTotal - cogsTotal).toFixed(2);
    const netProfit = +(grossProfit - opexTotal).toFixed(2);

    return {
      basis,
      currency,
      period: { from: from.toISOString(), to: to.toISOString() },
      revenue: { total: revenueTotal, accounts: revenueLines.sort((a, b) => b.amount - a.amount) },
      discounts: { total: discountTotal, accounts: discountsLines },
      cogs: { total: cogsTotal, accounts: cogsLines.sort((a, b) => b.amount - a.amount) },
      grossProfit,
      operatingExpenses: { total: opexTotal, accounts: expenseLines.sort((a, b) => b.amount - a.amount) },
      netProfit,
    };
  }

  // ---- Cashflow -------------------------------------------------------

  async getCashflow(
    businessId: string,
    from: Date,
    to: Date,
    basis: ReportBasis = 'accrual',
  ): Promise<CashflowReport> {
    const currency = await this.getCurrency(businessId);

    let byAccount: Array<{ accountId: string; systemKey: string | null; name: string; inflow: number; outflow: number; net: number }>;
    let cashIn: number;
    let cashOut: number;
    let accrualAdjustments = {
      netIncome: 0, arChange: 0, apChange: 0, taxPayableChange: 0, cashFromOperations: 0,
    };

    if (basis === 'cash') {
      // Cash basis: report ONLY cash movements that represent operating
      // activity (cash sales, AR collections traced to invoice income,
      // AP payments traced to bill expenses, direct paid expenses).
      // Pure asset swaps (e.g. inventory purchase paid in cash) and
      // financing flows (owner contributions) are excluded.
      const cash = await this.computeCashBasisPnl(businessId, from, to);
      byAccount = cash.operatingCashByAccount;
      cashIn = cash.operatingCashIn;
      cashOut = cash.operatingCashOut;
      const netIncome = +(
        cash.income.reduce((s, r) => s + r.amount, 0)
        - cash.cogs.reduce((s, r) => s + r.amount, 0)
        - cash.expense.reduce((s, r) => s + r.amount, 0)
      ).toFixed(2);
      // Under cash basis CFO == NetIncome (no accrual bridge needed).
      accrualAdjustments = {
        netIncome,
        arChange: 0,
        apChange: 0,
        taxPayableChange: 0,
        cashFromOperations: netIncome,
      };
    } else {
      // Accrual basis: report all cash movements (including financing
      // and investing) and provide indirect-method accrual adjustments.
      const where: Prisma.LedgerEntryWhereInput = {
        businessId,
        date: { gte: from, lte: to },
        account: { systemKey: { in: Array.from(CASH_KEYS) } },
      };
      const rows = await this.prisma.client.ledgerEntry.groupBy({
        by: ['accountId'],
        where,
        _sum: { debit: true, credit: true },
      });
      const accounts = rows.length
        ? await this.prisma.client.chartOfAccount.findMany({
            where: { id: { in: rows.map((r) => r.accountId) } },
            select: { id: true, name: true, systemKey: true },
          })
        : [];
      const meta = new Map(accounts.map((a) => [a.id, a]));

      byAccount = rows.map((r) => {
        const inflow = toNum(r._sum.debit);
        const outflow = toNum(r._sum.credit);
        const m = meta.get(r.accountId);
        return {
          accountId: r.accountId,
          systemKey: m?.systemKey ?? null,
          name: m?.name ?? '(unknown)',
          inflow: +inflow.toFixed(2),
          outflow: +outflow.toFixed(2),
          net: +(inflow - outflow).toFixed(2),
        };
      });
      cashIn = +byAccount.reduce((s, r) => s + r.inflow, 0).toFixed(2);
      cashOut = +byAccount.reduce((s, r) => s + r.outflow, 0).toFixed(2);

      const pnl = await this.getPnl(businessId, from, to, 'accrual');
      const arChange = await this.balanceMovement(businessId, from, to, 'ACCOUNTS_RECEIVABLE', 'asset');
      const apChange = await this.balanceMovement(businessId, from, to, 'ACCOUNTS_PAYABLE', 'liability');
      const taxPayableChange = await this.balanceMovement(businessId, from, to, 'TAX_PAYABLE', 'liability');
      const cashFromOperations = +(pnl.netProfit - arChange + apChange + taxPayableChange).toFixed(2);
      accrualAdjustments = {
        netIncome: pnl.netProfit,
        arChange: +arChange.toFixed(2),
        apChange: +apChange.toFixed(2),
        taxPayableChange: +taxPayableChange.toFixed(2),
        cashFromOperations,
      };
    }
    const netMovement = +(cashIn - cashOut).toFixed(2);

    // Forward-looking: outstanding receivables/payables. Both come
    // from the same aging routines used by the dedicated A/R and A/P
    // aging reports (ledger-derived, FIN3-style). This guarantees
    // upcoming totals/counts match the standalone aging views and
    // exclude already-settled documents.
    const [aging, apAging] = await Promise.all([
      this.receivables.getAging(businessId, to).catch(() => null as AgingReport | null),
      this.getApAging(businessId, to).catch(() => null as Awaited<ReturnType<typeof this.getApAging>> | null),
    ]);

    return {
      basis,
      currency,
      period: { from: from.toISOString(), to: to.toISOString() },
      cashIn,
      cashOut,
      netMovement,
      byAccount,
      accrualAdjustments,
      upcomingReceivables: {
        total: aging?.totalOutstanding ?? 0,
        count: aging?.customers.length ?? 0,
      },
      upcomingPayables: {
        total: +(apAging?.total ?? 0).toFixed(2),
        count: apAging?.count ?? 0,
      },
    };
  }

  /**
   * Sum the net balance change of the system-keyed account over the
   * period (debit - credit normalised by account nature).
   */
  private async balanceMovement(
    businessId: string,
    from: Date,
    to: Date,
    systemKey: string,
    nature: 'asset' | 'liability',
  ): Promise<number> {
    const coa = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey },
      select: { id: true },
    });
    if (!coa) return 0;
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where: { businessId, accountId: coa.id, date: { gte: from, lte: to } },
      _sum: { debit: true, credit: true },
    });
    const debit = toNum(agg._sum.debit);
    const credit = toNum(agg._sum.credit);
    return nature === 'asset' ? debit - credit : credit - debit;
  }

  private async balanceAt(
    businessId: string,
    asOf: Date,
    systemKey: string,
    nature: 'asset' | 'liability',
  ): Promise<number> {
    const coa = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey },
      select: { id: true },
    });
    if (!coa) return 0;
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where: { businessId, accountId: coa.id, date: { lte: asOf } },
      _sum: { debit: true, credit: true },
    });
    const debit = toNum(agg._sum.debit);
    const credit = toNum(agg._sum.credit);
    return nature === 'asset' ? debit - credit : credit - debit;
  }

  // ---- Balance Sheet --------------------------------------------------

  async getBalanceSheet(businessId: string, asOf: Date): Promise<BalanceSheetReport> {
    const currency = await this.getCurrency(businessId);
    const trial = await this.balances.getTrialBalance(businessId, asOf);

    type Bucket = { total: number; lines: PnlAccountLine[] };
    const mk = (): Bucket => ({ total: 0, lines: [] });
    const assets = mk();
    const liabilities = mk();
    const equity = mk();
    let income = 0;
    let cogs = 0;
    let expense = 0;

    for (const a of trial) {
      const debit = toNum(a.debit);
      const credit = toNum(a.credit);
      const line: PnlAccountLine = {
        accountId: a.accountId,
        systemKey: a.systemKey,
        name: a.name,
        amount: 0,
      };
      switch (a.type) {
        case 'ASSET': {
          line.amount = +(debit - credit).toFixed(2);
          if (Math.abs(line.amount) < 0.005) continue;
          assets.lines.push(line);
          assets.total = +(assets.total + line.amount).toFixed(2);
          break;
        }
        case 'LIABILITY': {
          line.amount = +(credit - debit).toFixed(2);
          if (Math.abs(line.amount) < 0.005) continue;
          liabilities.lines.push(line);
          liabilities.total = +(liabilities.total + line.amount).toFixed(2);
          break;
        }
        case 'EQUITY': {
          line.amount = +(credit - debit).toFixed(2);
          if (Math.abs(line.amount) < 0.005) continue;
          equity.lines.push(line);
          equity.total = +(equity.total + line.amount).toFixed(2);
          break;
        }
        case 'INCOME':
          income += credit - debit;
          break;
        case 'COGS':
          cogs += debit - credit;
          break;
        case 'EXPENSE':
          expense += debit - credit;
          break;
      }
    }

    const netEquityFromIncome = +(income - cogs - expense).toFixed(2);
    const totalEquityWithRetained = +(equity.total + netEquityFromIncome).toFixed(2);
    const identityDelta = +(assets.total - liabilities.total - totalEquityWithRetained).toFixed(2);

    const findBy = (lines: PnlAccountLine[], keys: string[]): number =>
      +lines.filter((l) => l.systemKey && keys.includes(l.systemKey)).reduce((s, l) => s + l.amount, 0).toFixed(2);

    return {
      asOf: asOf.toISOString(),
      currency,
      assets: {
        ...assets,
        cashAndBank: findBy(assets.lines, ['CASH', 'BANK', 'PAYMENT_PROCESSOR']),
        accountsReceivable: findBy(assets.lines, ['ACCOUNTS_RECEIVABLE']),
        inventory: findBy(assets.lines, ['INVENTORY_ASSET']),
      },
      liabilities: {
        ...liabilities,
        accountsPayable: findBy(liabilities.lines, ['ACCOUNTS_PAYABLE']),
        taxPayable: findBy(liabilities.lines, ['TAX_PAYABLE']),
        loans: findBy(liabilities.lines, ['LOAN_PAYABLE']),
      },
      equity: {
        ...equity,
        ownerEquity: findBy(equity.lines, ['OWNER_EQUITY', 'OWNER_DRAWINGS']),
        retainedEarnings: findBy(equity.lines, ['RETAINED_EARNINGS']),
      },
      netEquityFromIncome,
      identityHolds: Math.abs(identityDelta) < 0.05,
      identityDelta,
    };
  }

  // ---- Tax Summary ----------------------------------------------------

  async getTaxSummary(businessId: string, from: Date, to: Date): Promise<TaxSummaryReport> {
    const currency = await this.getCurrency(businessId);

    // FIN4: derive tax figures from the ledger AND reconcile with
    // invoice tax fields. Net revenue (taxable sales) = INCOME credits
    // minus debits in the period. Tax collected = credits to
    // TAX_PAYABLE in the period. Tax paid on purchases = debits to
    // TAX_PAYABLE (input tax recovery). We then cross-check against the
    // sum of `Invoice.taxAmount` for invoices issued in the period —
    // any divergence (e.g. invoices not yet posted to the ledger) is
    // surfaced under `invoiceTaxes`.
    const [revenueLines, taxAgg, invoiceAgg] = await Promise.all([
      this.aggregateByAccount(businessId, from, to, ['INCOME']),
      (async () => {
        const taxPayableCoa = await this.prisma.client.chartOfAccount.findFirst({
          where: { businessId, systemKey: 'TAX_PAYABLE' },
          select: { id: true },
        });
        if (!taxPayableCoa) return { credit: 0, debit: 0 };
        const agg = await this.prisma.client.ledgerEntry.aggregate({
          where: { businessId, accountId: taxPayableCoa.id, date: { gte: from, lte: to } },
          _sum: { debit: true, credit: true },
        });
        return { credit: toNum(agg._sum.credit), debit: toNum(agg._sum.debit) };
      })(),
      this.prisma.client.invoice.aggregate({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['SENT', 'PAID', 'PARTIALLY_PAID', 'OVERDUE'] },
          issueDate: { gte: from, lte: to },
        },
        _sum: { taxAmount: true, subtotal: true },
      }),
    ]);

    const taxableSales = +revenueLines.reduce((s, l) => s + l.amount, 0).toFixed(2);
    const taxCollected = +taxAgg.credit.toFixed(2);
    const taxPaidOnPurchases = +taxAgg.debit.toFixed(2);
    const invoiceTaxAmount = +(toNum(invoiceAgg._sum.taxAmount) || 0).toFixed(2);
    const invoiceSubtotal = +(toNum(invoiceAgg._sum.subtotal) || 0).toFixed(2);

    const liabilities = await this.prisma.client.taxLiability.findMany({
      where: { businessId, periodEnd: { gte: from }, periodStart: { lte: to } },
      orderBy: { periodEnd: 'desc' },
      take: 24,
    });

    const estimatedDue = Math.max(0, +(taxCollected - taxPaidOnPurchases).toFixed(2));

    return {
      currency,
      period: { from: from.toISOString(), to: to.toISOString() },
      taxableSales,
      taxCollected,
      taxPaidOnPurchases,
      estimatedDue,
      invoiceTaxes: {
        taxAmount: invoiceTaxAmount,
        subtotal: invoiceSubtotal,
        ledgerToInvoiceDelta: +(taxCollected - invoiceTaxAmount).toFixed(2),
      },
      liabilities: liabilities.map((l) => ({
        id: l.id,
        type: l.type,
        periodStart: l.periodStart.toISOString(),
        periodEnd: l.periodEnd.toISOString(),
        taxableSales: toNum(l.taxableSales),
        taxCollected: toNum(l.taxCollected),
        taxPaid: toNum(l.taxPaid),
        amountDue: toNum(l.amountDue),
        status: l.status,
      })),
    };
  }

  // ---- Revenue & Expense by Dimension --------------------------------

  async getRevenueBy(
    businessId: string,
    dimension: 'customer' | 'product' | 'service' | 'source',
    from: Date,
    to: Date,
  ): Promise<DimensionRow[]> {
    if (dimension === 'customer') {
      const grouped = await this.prisma.client.ledgerEntry.findMany({
        where: {
          businessId,
          date: { gte: from, lte: to },
          account: { type: 'INCOME' },
          transaction: { contactId: { not: null } },
        },
        select: {
          credit: true,
          debit: true,
          transaction: { select: { contactId: true } },
        },
      });
      const map = new Map<string, { total: number; count: number }>();
      for (const e of grouped) {
        const id = e.transaction?.contactId;
        if (!id) continue;
        const v = map.get(id) ?? { total: 0, count: 0 };
        v.total += toNum(e.credit) - toNum(e.debit);
        v.count += 1;
        map.set(id, v);
      }
      const ids = Array.from(map.keys());
      const contacts = ids.length
        ? await this.prisma.client.contact.findMany({
            where: { id: { in: ids } },
            select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
          })
        : [];
      const labels = new Map(
        contacts.map((c) => [
          c.id,
          c.displayName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || c.id,
        ]),
      );
      return Array.from(map.entries())
        .map(([key, v]) => ({ key, label: labels.get(key) ?? 'Unknown', total: +v.total.toFixed(2), count: v.count }))
        .filter((r) => Math.abs(r.total) >= 0.005)
        .sort((a, b) => b.total - a.total);
    }

    if (dimension === 'product' || dimension === 'service') {
      // FIN4: ledger-derived. We sum ledger credit−debit on INCOME
      // accounts per FinancialTransaction (the authoritative figure),
      // then split that net per-txn revenue across invoice items
      // proportionally by `item.total / invoice.subtotal`. The ledger
      // remains the source of total amount; source rows are used only
      // for the dimension split (productId / category) which the
      // ledger does not carry.
      const incomeEntries = await this.prisma.client.ledgerEntry.findMany({
        where: { businessId, date: { gte: from, lte: to }, account: { type: 'INCOME' } },
        select: { transactionId: true, debit: true, credit: true, transaction: { select: { sourceType: true, sourceId: true } } },
      });
      const perTxn = new Map<string, { net: number; invoiceId?: string }>();
      for (const e of incomeEntries) {
        const cur = perTxn.get(e.transactionId) ?? { net: 0, invoiceId: undefined };
        cur.net += toNum(e.credit) - toNum(e.debit);
        if (e.transaction?.sourceType === 'Invoice' && e.transaction.sourceId) {
          cur.invoiceId = e.transaction.sourceId;
        }
        perTxn.set(e.transactionId, cur);
      }
      const invoiceIds = Array.from(new Set(Array.from(perTxn.values()).map((v) => v.invoiceId).filter(Boolean) as string[]));
      const invoices = invoiceIds.length
        ? await this.prisma.client.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: {
              id: true, subtotal: true,
              items: {
                where: dimension === 'service'
                  ? { product: { category: 'SERVICE' } }
                  : { product: { category: { in: ['PRODUCT', 'PACKAGE'] } } },
                select: { total: true, productId: true, description: true, product: { select: { name: true } } },
              },
            },
          })
        : [];
      const invoiceById = new Map(invoices.map((i) => [i.id, i]));
      const map = new Map<string, { label: string; total: number; count: number }>();
      for (const v of perTxn.values()) {
        if (!v.invoiceId) continue;
        const inv = invoiceById.get(v.invoiceId);
        if (!inv) continue;
        const subtotal = Number(inv.subtotal ?? 0);
        if (subtotal <= 0) continue;
        for (const it of inv.items) {
          const share = Number(it.total) / subtotal;
          const allocated = v.net * share;
          if (!Number.isFinite(allocated) || Math.abs(allocated) < 0.005) continue;
          const k = it.productId ?? `desc:${it.description}`;
          const cur = map.get(k) ?? { label: it.product?.name ?? it.description ?? 'Unknown', total: 0, count: 0 };
          cur.total += allocated;
          cur.count += 1;
          map.set(k, cur);
        }
      }
      return Array.from(map.entries())
        .map(([key, v]) => ({ key, label: v.label, total: +v.total.toFixed(2), count: v.count }))
        .sort((a, b) => b.total - a.total);
    }

    // 'source' — group by Revenue COA systemKey.
    const lines = await this.aggregateByAccount(businessId, from, to, ['INCOME']);
    return lines
      .map((l) => ({ key: l.systemKey ?? l.accountId, label: l.name, total: l.amount, count: 1 }))
      .sort((a, b) => b.total - a.total);
  }

  async getExpenseBy(
    businessId: string,
    dimension: 'vendor' | 'category' | 'project',
    from: Date,
    to: Date,
  ): Promise<DimensionRow[]> {
    if (dimension === 'category') {
      const lines = await this.aggregateByAccount(businessId, from, to, ['EXPENSE', 'COGS']);
      return lines
        .map((l) => ({ key: l.systemKey ?? l.accountId, label: l.name, total: l.amount, count: 1 }))
        .sort((a, b) => b.total - a.total);
    }

    // FIN4: vendor + project — sum ledger debit-credit on EXPENSE/COGS
    // accounts grouped by FinancialTransaction; then group by the
    // dimension key looked up from the originating Expense source row
    // (ledger has no vendor/project columns, source is used only for
    // labelling, the amount comes straight from the ledger).
    const expEntries = await this.prisma.client.ledgerEntry.findMany({
      where: { businessId, date: { gte: from, lte: to }, account: { type: { in: ['EXPENSE', 'COGS'] } } },
      select: { transactionId: true, debit: true, credit: true, transaction: { select: { sourceType: true, sourceId: true, contactId: true } } },
    });
    const perTxn = new Map<string, { net: number; sourceId?: string; contactId?: string }>();
    for (const e of expEntries) {
      const cur = perTxn.get(e.transactionId) ?? { net: 0, sourceId: undefined, contactId: undefined };
      cur.net += toNum(e.debit) - toNum(e.credit);
      if (e.transaction?.sourceType === 'Expense' && e.transaction.sourceId) cur.sourceId = e.transaction.sourceId;
      if (e.transaction?.contactId) cur.contactId = e.transaction.contactId;
      perTxn.set(e.transactionId, cur);
    }
    const expenseIds = Array.from(new Set(Array.from(perTxn.values()).map((v) => v.sourceId).filter(Boolean) as string[]));
    const expenseMeta = expenseIds.length
      ? await this.prisma.client.expense.findMany({
          where: { id: { in: expenseIds } },
          select: { id: true, vendor: true, contactId: true, projectId: true },
        })
      : [];
    const expenseById = new Map(expenseMeta.map((e) => [e.id, e]));

    if (dimension === 'vendor') {
      const contactIds = Array.from(new Set([
        ...Array.from(perTxn.values()).map((v) => v.contactId).filter(Boolean) as string[],
        ...expenseMeta.map((e) => e.contactId).filter(Boolean) as string[],
      ]));
      const contacts = contactIds.length
        ? await this.prisma.client.contact.findMany({
            where: { id: { in: contactIds } },
            select: { id: true, displayName: true, firstName: true, lastName: true },
          })
        : [];
      const contactLabel = new Map(contacts.map((c) => [c.id, c.displayName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()]));
      const map = new Map<string, { label: string; total: number; count: number }>();
      for (const v of perTxn.values()) {
        if (Math.abs(v.net) < 0.005) continue;
        const exp = v.sourceId ? expenseById.get(v.sourceId) : undefined;
        const contactId = exp?.contactId ?? v.contactId ?? null;
        const vendor = exp?.vendor ?? null;
        const k = contactId ?? vendor ?? 'unknown';
        const label = (contactId && contactLabel.get(contactId)) || vendor || 'Unknown';
        const cur = map.get(k) ?? { label, total: 0, count: 0 };
        cur.total += v.net;
        cur.count += 1;
        map.set(k, cur);
      }
      return Array.from(map.entries())
        .map(([key, v]) => ({ key, label: v.label, total: +v.total.toFixed(2), count: v.count }))
        .sort((a, b) => b.total - a.total);
    }

    // project
    const projectIds = Array.from(new Set(expenseMeta.map((e) => e.projectId).filter(Boolean) as string[]));
    const projects = projectIds.length
      ? await this.prisma.client.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        })
      : [];
    const labels = new Map(projects.map((p) => [p.id, p.name]));
    const map = new Map<string, { label: string; total: number; count: number }>();
    for (const v of perTxn.values()) {
      if (Math.abs(v.net) < 0.005) continue;
      const exp = v.sourceId ? expenseById.get(v.sourceId) : undefined;
      const id = exp?.projectId;
      if (!id) continue;
      const cur = map.get(id) ?? { label: labels.get(id) ?? 'Unknown', total: 0, count: 0 };
      cur.total += v.net;
      cur.count += 1;
      map.set(id, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, total: +v.total.toFixed(2), count: v.count }))
      .sort((a, b) => b.total - a.total);
  }

  // ---- A/R + A/P aging passthroughs ---------------------------------

  async getArAging(businessId: string, asOf: Date) {
    return this.receivables.getAging(businessId, asOf);
  }

  async getApAging(businessId: string, asOf: Date = new Date()) {
    const currency = await this.getCurrency(businessId);
    const apCoa = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey: 'ACCOUNTS_PAYABLE' },
      select: { id: true },
    });

    const buckets = {
      current: { total: 0, count: 0 },
      d_1_30: { total: 0, count: 0 },
      d_31_60: { total: 0, count: 0 },
      d_61_90: { total: 0, count: 0 },
      d_over_90: { total: 0, count: 0 },
    };
    type Row = { key: string; label: string; total: number; current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number };
    const vendors = new Map<string, Row>();
    let total = 0;

    if (!apCoa) {
      return {
        asOf: asOf.toISOString(), currency, total: 0, count: 0, buckets, vendors: [],
      };
    }

    // FIN4: derive AP aging from the ledger by netting per economic
    // document (sourceType + sourceId), NOT per transaction. A bill
    // creation and its later payment are typically separate
    // FinancialTransactions sharing the same `sourceId`, so per-txn
    // netting would falsely leave settled bills "open". For each
    // (sourceType, sourceId) group, remaining liability = Σ credits −
    // Σ debits to AP across all member transactions. Groups with zero
    // remaining are fully settled and dropped. Orphan AP postings
    // without a sourceId are netted by transactionId as a fallback.
    const apEntries = await this.prisma.client.ledgerEntry.findMany({
      where: { businessId, accountId: apCoa.id, date: { lte: asOf } },
      select: {
        transactionId: true,
        debit: true,
        credit: true,
        transaction: { select: { sourceType: true, sourceId: true, contactId: true } },
      },
    });
    type Group = { key: string; sourceType: string | null; sourceId: string | null; contactId: string | null; remaining: number };
    const groups = new Map<string, Group>();
    for (const e of apEntries) {
      const t = e.transaction;
      const sType = t?.sourceType ?? null;
      const sId = t?.sourceId ?? null;
      const key = sType && sId ? `${sType}:${sId}` : `txn:${e.transactionId}`;
      const g = groups.get(key) ?? { key, sourceType: sType, sourceId: sId, contactId: t?.contactId ?? null, remaining: 0 };
      g.remaining += toNum(e.credit) - toNum(e.debit);
      groups.set(key, g);
    }
    const openGroups = Array.from(groups.values()).filter((g) => g.remaining > 0.005);

    if (openGroups.length === 0) {
      return { asOf: asOf.toISOString(), currency, total: 0, count: 0, buckets, vendors: [] };
    }

    const expenseIds = openGroups
      .filter((g) => g.sourceType === 'Expense' && !!g.sourceId)
      .map((g) => g.sourceId as string);
    const expenseMeta = expenseIds.length
      ? await this.prisma.client.expense.findMany({
          where: { id: { in: expenseIds } },
          select: { id: true, vendor: true, contactId: true, dueDate: true },
        })
      : [];
    const expenseById = new Map(expenseMeta.map((e) => [e.id, e]));

    for (const g of openGroups) {
      const remaining = g.remaining;
      const meta = g.sourceType === 'Expense' && g.sourceId ? expenseById.get(g.sourceId) : undefined;
      const dueDate = meta?.dueDate ?? null;
      const vendor = meta?.vendor ?? null;
      const contactId = meta?.contactId ?? g.contactId ?? null;

      total += remaining;
      const days = dueDate ? Math.floor((asOf.getTime() - dueDate.getTime()) / 86400000) : 0;
      let bucket: keyof typeof buckets = 'current';
      let field: keyof Omit<Row, 'key' | 'label' | 'total'> = 'current';
      if (!dueDate || days <= 0) { bucket = 'current'; field = 'current'; }
      else if (days <= 30) { bucket = 'd_1_30'; field = 'd1to30'; }
      else if (days <= 60) { bucket = 'd_31_60'; field = 'd31to60'; }
      else if (days <= 90) { bucket = 'd_61_90'; field = 'd61to90'; }
      else { bucket = 'd_over_90'; field = 'd90plus'; }
      buckets[bucket].total += remaining;
      buckets[bucket].count += 1;

      const key = contactId ?? vendor ?? 'unspecified';
      const row = vendors.get(key) ?? {
        key,
        label: vendor ?? 'Unknown vendor',
        total: 0, current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0,
      };
      row.total += remaining;
      row[field] += remaining;
      vendors.set(key, row);
    }

    // Round once at the end.
    const round = (n: number) => +n.toFixed(2);
    for (const k of Object.keys(buckets) as Array<keyof typeof buckets>) {
      buckets[k].total = round(buckets[k].total);
    }

    return {
      asOf: asOf.toISOString(),
      currency,
      total: round(total),
      count: vendors.size,
      buckets,
      vendors: Array.from(vendors.values()).map((v) => ({
        ...v,
        total: round(v.total),
        current: round(v.current),
        d1to30: round(v.d1to30),
        d31to60: round(v.d31to60),
        d61to90: round(v.d61to90),
        d90plus: round(v.d90plus),
      })).sort((a, b) => b.total - a.total),
    };
  }
}
