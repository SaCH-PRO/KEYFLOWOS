import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { buildPdf, type PdfLine } from './pdf-builder';
import { buildZip, type ZipEntry } from './zip-builder';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

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
    const currency = business.currency ?? 'TTD';

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
      this.computePnl(input.businessId, input.periodStart, input.periodEnd, basis),
      this.computeBalanceSheet(input.businessId, input.periodEnd),
      this.computeCashflow(input.businessId, input.periodStart, input.periodEnd),
      this.computeArAging(input.businessId, input.periodEnd),
      this.computeApAging(input.businessId, input.periodEnd),
      this.computeTaxSummary(input.businessId, input.periodStart, input.periodEnd),
      this.computeTrialBalance(input.businessId, input.periodEnd),
      this.collectGeneralLedger(input.businessId, input.periodStart, input.periodEnd),
      this.collectAuditLog(input.businessId, input.periodStart, input.periodEnd),
    ]);

    const header = {
      business: business.name,
      currency,
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

  private async computePnl(businessId: string, start: Date, end: Date, basis: 'CASH' | 'ACCRUAL') {
    // Ledger-driven P&L. Sum activity on INCOME / EXPENSE / COGS accounts
    // for the period. INCOME credits are revenue; EXPENSE/COGS debits are
    // costs. The `basis` flag is informational here — postings are written
    // by RevenuePostingService / ExpensePostingService respecting the
    // business's accounting basis at point of posting, so the same query
    // works under both regimes.
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, isActive: true, type: { in: ['INCOME', 'EXPENSE', 'COGS'] } },
      select: { id: true, name: true, type: true, code: true },
    });
    if (accounts.length === 0) {
      return { revenue: 0, taxCollected: 0, expenseLines: [], expenseTotal: 0, netProfit: 0, basis };
    }
    const sums = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId'],
      where: {
        businessId,
        accountId: { in: accounts.map((a) => a.id) },
        date: { gte: start, lte: end },
      },
      _sum: { debit: true, credit: true },
    });
    const sumMap = new Map(sums.map((s) => [s.accountId, {
      debit: Number(s._sum.debit ?? 0),
      credit: Number(s._sum.credit ?? 0),
    }] as const));

    let revenue = 0;
    const expenseLines: Array<{ category: string; total: number }> = [];
    for (const a of accounts) {
      const s = sumMap.get(a.id) ?? { debit: 0, credit: 0 };
      if (a.type === 'INCOME') {
        revenue += s.credit - s.debit;
      } else {
        const total = s.debit - s.credit;
        if (total !== 0) expenseLines.push({ category: a.name, total });
      }
    }
    expenseLines.sort((a, b) => b.total - a.total);
    const expenseTotal = expenseLines.reduce((s, l) => s + l.total, 0);

    // Tax collected for the same period — taken from the same ledger
    // (TAX_PAYABLE credits) so the P&L and Tax tab cannot drift.
    const taxAccount = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey: 'TAX_PAYABLE' },
      select: { id: true },
    });
    let taxCollected = 0;
    if (taxAccount) {
      const t = await this.prisma.client.ledgerEntry.aggregate({
        where: { businessId, accountId: taxAccount.id, date: { gte: start, lte: end } },
        _sum: { credit: true, debit: true },
      });
      taxCollected = Number(t._sum.credit ?? 0) - Number(t._sum.debit ?? 0);
    }

    return { revenue, taxCollected, expenseLines, expenseTotal, netProfit: revenue - expenseTotal, basis };
  }

  private async computeBalanceSheet(businessId: string, asOf: Date) {
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, type: true, code: true, systemKey: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    const balances = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { businessId, date: { lte: asOf } },
      _sum: { debit: true, credit: true },
    });
    const balMap = new Map(balances.map((b) => [b.accountId, {
      debit: Number(b._sum.debit ?? 0),
      credit: Number(b._sum.credit ?? 0),
    }] as const));

    const rows = accounts.map((a) => {
      const b = balMap.get(a.id) ?? { debit: 0, credit: 0 };
      // Asset/Expense/COGS naturally debit-positive; others credit-positive.
      const sign = a.type === 'ASSET' || a.type === 'EXPENSE' || a.type === 'COGS' ? 1 : -1;
      const balance = sign * (b.debit - b.credit);
      return { ...a, balance };
    });

    const sumByType = (t: string) =>
      rows.filter((r) => r.type === t).reduce((s, r) => s + r.balance, 0);

    return {
      asOf,
      accounts: rows,
      assets: sumByType('ASSET'),
      liabilities: sumByType('LIABILITY'),
      equity: sumByType('EQUITY'),
      income: sumByType('INCOME'),
      cogs: sumByType('COGS'),
      expenses: sumByType('EXPENSE'),
    };
  }

  private async computeCashflow(businessId: string, start: Date, end: Date) {
    const cashAccounts = await this.prisma.client.chartOfAccount.findMany({
      where: {
        businessId,
        systemKey: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] },
      },
      select: { id: true, name: true, systemKey: true },
    });
    const ids = cashAccounts.map((a) => a.id);
    if (ids.length === 0) {
      return { inflows: 0, outflows: 0, net: 0, byAccount: [] as Array<{ name: string; inflows: number; outflows: number }> };
    }
    const entries = await this.prisma.client.ledgerEntry.findMany({
      where: { businessId, accountId: { in: ids }, date: { gte: start, lte: end } },
      select: { accountId: true, debit: true, credit: true },
    });
    let inflows = 0;
    let outflows = 0;
    const byAcc = new Map<string, { name: string; inflows: number; outflows: number }>();
    for (const a of cashAccounts) byAcc.set(a.id, { name: a.name, inflows: 0, outflows: 0 });
    for (const e of entries) {
      const d = Number(e.debit ?? 0);
      const c = Number(e.credit ?? 0);
      inflows += d;
      outflows += c;
      const slot = byAcc.get(e.accountId);
      if (slot) {
        slot.inflows += d;
        slot.outflows += c;
      }
    }
    return {
      inflows,
      outflows,
      net: inflows - outflows,
      byAccount: Array.from(byAcc.values()),
    };
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

  private async computeTrialBalance(businessId: string, asOf: Date) {
    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, isActive: true },
      select: { id: true, code: true, name: true, type: true, systemKey: true },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });
    const sums = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { businessId, date: { lte: asOf } },
      _sum: { debit: true, credit: true },
    });
    const map = new Map(sums.map((s) => [s.accountId, {
      debit: Number(s._sum.debit ?? 0),
      credit: Number(s._sum.credit ?? 0),
    }] as const));
    return accounts.map((a) => {
      const s = map.get(a.id) ?? { debit: 0, credit: 0 };
      const net = s.debit - s.credit;
      return {
        code: a.code ?? '',
        name: a.name,
        type: a.type,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
      };
    }).filter((r) => r.debit !== 0 || r.credit !== 0);
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

function buildManifest(h: { business: string; currency: string; basis: string; periodStart: string; periodEnd: string; generatedAt: string }): string {
  return [
    'KEYFLOW — Accountant Export',
    `Business:    ${h.business}`,
    `Currency:    ${h.currency}`,
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
    '  trial-balance.csv         — Trial balance as of period end',
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

function trialBalanceCsv(rows: Array<Record<string, unknown>>): string {
  return csv(rows, ['code', 'name', 'type', 'debit', 'credit']);
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

function pnlPdfLines(h: { business: string; currency: string; basis: string; periodStart: string; periodEnd: string }, p: { revenue: number; taxCollected: number; expenseLines: Array<{ category: string; total: number }>; expenseTotal: number; netProfit: number }): PdfLine[] {
  const ccy = h.currency;
  const lines: PdfLine[] = [
    { kind: 'title', text: 'Profit & Loss' },
    { kind: 'text', text: h.business },
    { kind: 'text', text: `${h.periodStart}  →  ${h.periodEnd}    (${h.basis} basis)` },
    { kind: 'spacer' },
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
}

function balanceSheetPdfLines(h: { business: string; currency: string; periodEnd: string }, b: { assets: number; liabilities: number; equity: number; income: number; expenses: number; cogs: number; accounts: Array<{ name: string; type: string; balance: number; code: string | null }> }): PdfLine[] {
  const ccy = h.currency;
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
    { kind: 'title', text: 'Balance Sheet' },
    { kind: 'text', text: h.business },
    { kind: 'text', text: `As of ${h.periodEnd}` },
    { kind: 'spacer' },
    ...section('Assets', 'ASSET', b.assets),
    ...section('Liabilities', 'LIABILITY', b.liabilities),
    ...section('Equity', 'EQUITY', b.equity),
    { kind: 'row', left: '  Retained earnings (period activity)', right: fmtMoney(retained, ccy) },
    { kind: 'rule' },
    { kind: 'row', left: 'Total Liabilities + Equity', right: fmtMoney(b.liabilities + b.equity + retained, ccy) },
  ];
}

function cashflowPdfLines(h: { business: string; currency: string; periodStart: string; periodEnd: string }, c: { inflows: number; outflows: number; net: number; byAccount: Array<{ name: string; inflows: number; outflows: number }> }): PdfLine[] {
  const ccy = h.currency;
  const lines: PdfLine[] = [
    { kind: 'title', text: 'Cashflow Statement' },
    { kind: 'text', text: h.business },
    { kind: 'text', text: `${h.periodStart}  →  ${h.periodEnd}` },
    { kind: 'spacer' },
    { kind: 'heading', text: 'By cash account' },
  ];
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
}
