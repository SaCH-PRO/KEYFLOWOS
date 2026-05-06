import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import {
  PnlReport,
  CashflowReport,
  BalanceSheetReport,
  TaxSummaryReport,
  DimensionRow,
} from './ledger-reporting.service';

const esc = (s: unknown): string => {
  if (s == null) return '';
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const toCsv = (rows: Array<Array<string | number | null | undefined>>): string =>
  rows.map((r) => r.map(esc).join(',')).join('\n');

function fmt(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

// ---- CSV ------------------------------------------------------------

export function pnlToCsv(r: PnlReport): string {
  const rows: Array<Array<string | number>> = [
    ['Profit & Loss'],
    ['Basis', r.basis],
    ['Currency', r.currency],
    ['From', r.period.from],
    ['To', r.period.to],
    [],
    ['Section', 'Account', 'Amount'],
  ];
  for (const a of r.revenue.accounts) rows.push(['Revenue', a.name, a.amount]);
  rows.push(['Revenue Total', '', r.revenue.total]);
  for (const a of r.discounts.accounts) rows.push(['Discounts', a.name, a.amount]);
  rows.push(['Discounts Total', '', r.discounts.total]);
  for (const a of r.cogs.accounts) rows.push(['COGS', a.name, a.amount]);
  rows.push(['COGS Total', '', r.cogs.total]);
  rows.push(['Gross Profit', '', r.grossProfit]);
  for (const a of r.operatingExpenses.accounts) rows.push(['Operating Expense', a.name, a.amount]);
  rows.push(['Operating Expenses Total', '', r.operatingExpenses.total]);
  rows.push(['Net Profit', '', r.netProfit]);
  return toCsv(rows);
}

export function cashflowToCsv(r: CashflowReport): string {
  const rows: Array<Array<string | number>> = [
    ['Cashflow'],
    ['Currency', r.currency],
    ['From', r.period.from],
    ['To', r.period.to],
    [],
    ['Account', 'Inflow', 'Outflow', 'Net'],
  ];
  for (const a of r.byAccount) rows.push([a.name, a.inflow, a.outflow, a.net]);
  rows.push(['Totals', r.cashIn, r.cashOut, r.netMovement]);
  rows.push([]);
  rows.push(['Upcoming Receivables', r.upcomingReceivables.total, '', r.upcomingReceivables.count]);
  rows.push(['Upcoming Payables', r.upcomingPayables.total, '', r.upcomingPayables.count]);
  return toCsv(rows);
}

export function balanceSheetToCsv(r: BalanceSheetReport): string {
  const rows: Array<Array<string | number>> = [
    ['Balance Sheet'],
    ['Currency', r.currency],
    ['As of', r.asOf],
    [],
    ['Section', 'Account', 'Amount'],
  ];
  for (const a of r.assets.lines) rows.push(['Asset', a.name, a.amount]);
  rows.push(['Assets Total', '', r.assets.total]);
  for (const a of r.liabilities.lines) rows.push(['Liability', a.name, a.amount]);
  rows.push(['Liabilities Total', '', r.liabilities.total]);
  for (const a of r.equity.lines) rows.push(['Equity', a.name, a.amount]);
  rows.push(['Retained Earnings (period income)', '', r.netEquityFromIncome]);
  rows.push(['Equity Total', '', r.equity.total + r.netEquityFromIncome]);
  rows.push(['Identity holds (A = L + E)', r.identityHolds ? 'YES' : 'NO', r.identityDelta]);
  return toCsv(rows);
}

export function taxSummaryToCsv(r: TaxSummaryReport): string {
  const rows: Array<Array<string | number>> = [
    ['Tax Summary'],
    ['Currency', r.currency],
    ['From', r.period.from],
    ['To', r.period.to],
    [],
    ['Metric', 'Amount'],
    ['Taxable Sales', r.taxableSales],
    ['Tax Collected', r.taxCollected],
    ['Tax Paid on Purchases', r.taxPaidOnPurchases],
    ['Estimated Due', r.estimatedDue],
    [],
    ['Liabilities'],
    ['Type', 'Period Start', 'Period End', 'Taxable Sales', 'Tax Collected', 'Tax Paid', 'Amount Due', 'Status'],
  ];
  for (const l of r.liabilities) {
    rows.push([l.type, l.periodStart, l.periodEnd, l.taxableSales, l.taxCollected, l.taxPaid, l.amountDue, l.status]);
  }
  return toCsv(rows);
}

export function dimensionToCsv(title: string, rows: DimensionRow[]): string {
  const out: Array<Array<string | number>> = [[title], ['Key', 'Label', 'Total', 'Count']];
  for (const r of rows) out.push([r.key, r.label, r.total, r.count]);
  return toCsv(out);
}

export function arAgingToCsv(r: any): string {
  const rows: Array<Array<string | number>> = [
    ['A/R Aging'],
    ['As of', r.asOf],
    ['Currency', r.currency],
    ['Total Outstanding', r.totalOutstanding],
    ['Total Overdue', r.totalOverdue],
    ['Ledger AR Balance', r.ledgerArBalance],
    ['Ledger Reconciled', r.ledgerReconciled ? 'YES' : 'NO'],
    [],
    ['Customer', 'Total', 'Current', '1-30', '31-60', '61-90', '90+'],
  ];
  for (const c of r.customers ?? []) {
    rows.push([c.contactName ?? c.contactId, c.total, c.current, c.d1to30, c.d31to60, c.d61to90, c.d90plus]);
  }
  return toCsv(rows);
}

export function apAgingToCsv(r: any): string {
  const rows: Array<Array<string | number>> = [
    ['A/P Aging'],
    ['As of', r.asOf],
    ['Currency', r.currency],
    ['Total Outstanding', r.total],
    [],
    ['Vendor', 'Total', 'Current', '1-30', '31-60', '61-90', '90+'],
  ];
  for (const v of r.vendors ?? []) {
    rows.push([v.label, v.total, v.current, v.d1to30, v.d31to60, v.d61to90, v.d90plus]);
  }
  return toCsv(rows);
}

// ---- Printable HTML (server-rendered "PDF") -------------------------

const baseHtml = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; padding: 32px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 600; border-top: 1px solid #999; border-bottom: 2px solid #111; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  @media print { body { padding: 0; } }
</style>
<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 200); });</script>
</head><body>${body}</body></html>`;

const num = (n: number, c: string) => `<td class="num">${esc(fmt(n, c))}</td>`;

export function pnlToHtml(r: PnlReport): string {
  const section = (label: string, rows: Array<{ name: string; amount: number }>, total: number) => {
    const lines = rows.map((a) => `<tr><td>${esc(a.name)}</td>${num(a.amount, r.currency)}</tr>`).join('');
    return `<h2>${esc(label)}</h2><table>${lines}<tr class="total"><td>Total ${esc(label)}</td>${num(total, r.currency)}</tr></table>`;
  };
  const body = `
    <h1>Profit &amp; Loss</h1>
    <div class="meta">${esc(r.period.from)} → ${esc(r.period.to)} · Basis: ${esc(r.basis)} · ${esc(r.currency)}</div>
    ${section('Revenue', r.revenue.accounts, r.revenue.total)}
    ${r.discounts.total ? section('Discounts', r.discounts.accounts, r.discounts.total) : ''}
    ${r.cogs.total ? section('Cost of Goods Sold', r.cogs.accounts, r.cogs.total) : ''}
    <h2>Gross Profit</h2><table><tr class="total"><td>Gross Profit</td>${num(r.grossProfit, r.currency)}</tr></table>
    ${section('Operating Expenses', r.operatingExpenses.accounts, r.operatingExpenses.total)}
    <h2>Net Profit</h2><table><tr class="total"><td>Net Profit</td>${num(r.netProfit, r.currency)}</tr></table>
  `;
  return baseHtml('Profit & Loss', body);
}

export function cashflowToHtml(r: CashflowReport): string {
  const lines = r.byAccount
    .map((a) => `<tr><td>${esc(a.name)}</td>${num(a.inflow, r.currency)}${num(a.outflow, r.currency)}${num(a.net, r.currency)}</tr>`)
    .join('');
  const body = `
    <h1>Cashflow</h1>
    <div class="meta">${esc(r.period.from)} → ${esc(r.period.to)} · ${esc(r.currency)}</div>
    <table>
      <tr><th>Account</th><th class="num">Inflow</th><th class="num">Outflow</th><th class="num">Net</th></tr>
      ${lines}
      <tr class="total"><td>Totals</td>${num(r.cashIn, r.currency)}${num(r.cashOut, r.currency)}${num(r.netMovement, r.currency)}</tr>
    </table>
    <h2>Looking Ahead</h2>
    <table>
      <tr><td>Upcoming receivables</td>${num(r.upcomingReceivables.total, r.currency)}<td class="num">${r.upcomingReceivables.count}</td></tr>
      <tr><td>Upcoming payables</td>${num(r.upcomingPayables.total, r.currency)}<td class="num">${r.upcomingPayables.count}</td></tr>
    </table>
  `;
  return baseHtml('Cashflow', body);
}

export function balanceSheetToHtml(r: BalanceSheetReport): string {
  const sec = (label: string, lines: Array<{ name: string; amount: number }>, total: number) => {
    const rows = lines.map((a) => `<tr><td>${esc(a.name)}</td>${num(a.amount, r.currency)}</tr>`).join('');
    return `<h2>${esc(label)}</h2><table>${rows}<tr class="total"><td>Total ${esc(label)}</td>${num(total, r.currency)}</tr></table>`;
  };
  const equityTotal = r.equity.total + r.netEquityFromIncome;
  const body = `
    <h1>Balance Sheet</h1>
    <div class="meta">As of ${esc(r.asOf)} · ${esc(r.currency)}</div>
    ${sec('Assets', r.assets.lines, r.assets.total)}
    ${sec('Liabilities', r.liabilities.lines, r.liabilities.total)}
    <h2>Equity</h2>
    <table>
      ${r.equity.lines.map((a) => `<tr><td>${esc(a.name)}</td>${num(a.amount, r.currency)}</tr>`).join('')}
      <tr><td>Retained Earnings (period income)</td>${num(r.netEquityFromIncome, r.currency)}</tr>
      <tr class="total"><td>Total Equity</td>${num(equityTotal, r.currency)}</tr>
    </table>
    <p class="meta">Accounting identity: Assets − (Liabilities + Equity) = ${esc(r.identityDelta)} ${r.identityHolds ? '✓' : '⚠'}</p>
  `;
  return baseHtml('Balance Sheet', body);
}

export function taxSummaryToHtml(r: TaxSummaryReport): string {
  const liabilityRows = r.liabilities
    .map((l) => `<tr><td>${esc(l.type)}</td><td>${esc(l.periodStart)}</td><td>${esc(l.periodEnd)}</td>${num(l.taxableSales, r.currency)}${num(l.taxCollected, r.currency)}${num(l.taxPaid, r.currency)}${num(l.amountDue, r.currency)}<td>${esc(l.status)}</td></tr>`)
    .join('');
  const body = `
    <h1>Tax Summary</h1>
    <div class="meta">${esc(r.period.from)} → ${esc(r.period.to)} · ${esc(r.currency)}</div>
    <table>
      <tr><td>Taxable sales</td>${num(r.taxableSales, r.currency)}</tr>
      <tr><td>Tax collected on sales</td>${num(r.taxCollected, r.currency)}</tr>
      <tr><td>Tax paid on purchases</td>${num(r.taxPaidOnPurchases, r.currency)}</tr>
      <tr class="total"><td>Estimated due</td>${num(r.estimatedDue, r.currency)}</tr>
    </table>
    ${r.liabilities.length ? `<h2>Recorded Liabilities</h2><table><tr><th>Type</th><th>From</th><th>To</th><th class="num">Sales</th><th class="num">Collected</th><th class="num">Paid</th><th class="num">Due</th><th>Status</th></tr>${liabilityRows}</table>` : ''}
  `;
  return baseHtml('Tax Summary', body);
}

export function arAgingToHtml(r: any): string {
  const rows = (r.customers ?? [])
    .map((c: any) => `<tr><td>${esc(c.contactName ?? c.contactId)}</td>${num(c.total, r.currency)}${num(c.current, r.currency)}${num(c.d1to30, r.currency)}${num(c.d31to60, r.currency)}${num(c.d61to90, r.currency)}${num(c.d90plus, r.currency)}</tr>`)
    .join('');
  const body = `
    <h1>A/R Aging</h1>
    <div class="meta">As of ${esc(r.asOf)} · ${esc(r.currency)} · Outstanding ${esc(fmt(r.totalOutstanding, r.currency))} · Overdue ${esc(fmt(r.totalOverdue, r.currency))}</div>
    <table>
      <tr><th>Customer</th><th class="num">Total</th><th class="num">Current</th><th class="num">1-30</th><th class="num">31-60</th><th class="num">61-90</th><th class="num">90+</th></tr>
      ${rows}
    </table>
  `;
  return baseHtml('A/R Aging', body);
}

export function apAgingToHtml(r: any): string {
  const rows = (r.vendors ?? [])
    .map((v: any) => `<tr><td>${esc(v.label)}</td>${num(v.total, r.currency)}${num(v.current, r.currency)}${num(v.d1to30, r.currency)}${num(v.d31to60, r.currency)}${num(v.d61to90, r.currency)}${num(v.d90plus, r.currency)}</tr>`)
    .join('');
  const body = `
    <h1>A/P Aging</h1>
    <div class="meta">As of ${esc(r.asOf)} · ${esc(r.currency)} · Outstanding ${esc(fmt(r.total, r.currency))}</div>
    <table>
      <tr><th>Vendor</th><th class="num">Total</th><th class="num">Current</th><th class="num">1-30</th><th class="num">31-60</th><th class="num">61-90</th><th class="num">90+</th></tr>
      ${rows}
    </table>
  `;
  return baseHtml('A/P Aging', body);
}

export function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(csv);
}

export function sendHtml(res: Response, html: string): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// ---- Real PDF rendering (pdfkit) -----------------------------------

type PdfSection = { heading?: string; rows: Array<[string, string]>; emphasis?: boolean };

async function renderPdf(filename: string, title: string, meta: string, sections: PdfSection[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).fillColor('#111').text(title);
  doc.moveDown(0.25).fontSize(9).fillColor('#666').text(meta);
  doc.moveDown(0.75);

  for (const s of sections) {
    if (s.heading) {
      doc.moveDown(0.5).fontSize(12).fillColor('#111').text(s.heading);
      doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor('#ddd').stroke();
      doc.moveDown(0.3);
    }
    for (const [label, value] of s.rows) {
      const y = doc.y;
      const labelWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - 140;
      doc.fontSize(s.emphasis ? 10 : 9).fillColor('#222').font(s.emphasis ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, doc.page.margins.left, y, { width: labelWidth });
      doc.text(value, doc.page.margins.left + labelWidth, y, { width: 140, align: 'right' });
      doc.moveDown(0.15);
    }
  }
  doc.end();
  // Filename used in Content-Disposition by sendPdf; included here for trace.
  void filename;
  return done;
}

export function sendPdf(res: Response, name: string, pdf: Buffer): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
}

export async function pnlToPdf(r: PnlReport): Promise<Buffer> {
  const sections: PdfSection[] = [
    { heading: 'Revenue', rows: r.revenue.accounts.map((a) => [a.name, fmt(a.amount, r.currency)]) },
    { rows: [['Total Revenue', fmt(r.revenue.total, r.currency)]], emphasis: true },
  ];
  if (r.discounts.total) {
    sections.push({ heading: 'Discounts', rows: r.discounts.accounts.map((a) => [a.name, fmt(a.amount, r.currency)]) });
    sections.push({ rows: [['Total Discounts', fmt(r.discounts.total, r.currency)]], emphasis: true });
  }
  if (r.cogs.total) {
    sections.push({ heading: 'Cost of Goods Sold', rows: r.cogs.accounts.map((a) => [a.name, fmt(a.amount, r.currency)]) });
    sections.push({ rows: [['Total COGS', fmt(r.cogs.total, r.currency)]], emphasis: true });
  }
  sections.push({ rows: [['Gross Profit', fmt(r.grossProfit, r.currency)]], emphasis: true });
  sections.push({ heading: 'Operating Expenses', rows: r.operatingExpenses.accounts.map((a) => [a.name, fmt(a.amount, r.currency)]) });
  sections.push({ rows: [['Total Operating Expenses', fmt(r.operatingExpenses.total, r.currency)]], emphasis: true });
  sections.push({ rows: [['Net Profit', fmt(r.netProfit, r.currency)]], emphasis: true });
  return renderPdf('pnl', 'Profit & Loss', `${r.period.from} → ${r.period.to} · ${r.basis} basis · ${r.currency}`, sections);
}

export async function cashflowToPdf(r: CashflowReport): Promise<Buffer> {
  const sections: PdfSection[] = [
    {
      heading: 'Cash movement by account',
      rows: r.byAccount.map((a) => [a.name, `${fmt(a.inflow, r.currency)} / ${fmt(a.outflow, r.currency)} (net ${fmt(a.net, r.currency)})`]),
    },
    {
      rows: [
        ['Cash In', fmt(r.cashIn, r.currency)],
        ['Cash Out', fmt(r.cashOut, r.currency)],
        ['Net Movement', fmt(r.netMovement, r.currency)],
      ],
      emphasis: true,
    },
  ];
  if (r.basis === 'accrual') {
    sections.push({
      heading: 'Indirect-method bridge (accrual)',
      rows: [
        ['Net income', fmt(r.accrualAdjustments.netIncome, r.currency)],
        ['Δ Accounts receivable', fmt(-r.accrualAdjustments.arChange, r.currency)],
        ['Δ Accounts payable', fmt(r.accrualAdjustments.apChange, r.currency)],
        ['Δ Tax payable', fmt(r.accrualAdjustments.taxPayableChange, r.currency)],
        ['Cash from operations', fmt(r.accrualAdjustments.cashFromOperations, r.currency)],
      ],
    });
  }
  sections.push({
    heading: 'Looking ahead',
    rows: [
      ['Upcoming receivables', `${fmt(r.upcomingReceivables.total, r.currency)} (${r.upcomingReceivables.count})`],
      ['Upcoming payables', fmt(r.upcomingPayables.total, r.currency)],
    ],
  });
  return renderPdf('cashflow', 'Cashflow', `${r.period.from} → ${r.period.to} · ${r.basis} basis · ${r.currency}`, sections);
}

export async function balanceSheetToPdf(r: BalanceSheetReport): Promise<Buffer> {
  return renderPdf('balance-sheet', 'Balance Sheet', `As of ${r.asOf} · ${r.currency}`, [
    { heading: 'Assets', rows: r.assets.lines.map((a) => [a.name, fmt(a.amount, r.currency)]) },
    { rows: [['Total Assets', fmt(r.assets.total, r.currency)]], emphasis: true },
    { heading: 'Liabilities', rows: r.liabilities.lines.map((a) => [a.name, fmt(a.amount, r.currency)]) },
    { rows: [['Total Liabilities', fmt(r.liabilities.total, r.currency)]], emphasis: true },
    {
      heading: 'Equity',
      rows: [
        ...r.equity.lines.map((a) => [a.name, fmt(a.amount, r.currency)] as [string, string]),
        ['Retained earnings (period)', fmt(r.netEquityFromIncome, r.currency)],
      ],
    },
    { rows: [['Total Equity', fmt(r.equity.total + r.netEquityFromIncome, r.currency)]], emphasis: true },
    { rows: [['Identity (A − L − E)', `${fmt(r.identityDelta, r.currency)} ${r.identityHolds ? 'OK' : 'OUT OF BALANCE'}`]] },
  ]);
}

export async function taxSummaryToPdf(r: TaxSummaryReport): Promise<Buffer> {
  const sections: PdfSection[] = [
    {
      rows: [
        ['Taxable sales', fmt(r.taxableSales, r.currency)],
        ['Tax collected on sales', fmt(r.taxCollected, r.currency)],
        ['Tax paid on purchases', fmt(r.taxPaidOnPurchases, r.currency)],
        ['Estimated due', fmt(r.estimatedDue, r.currency)],
      ],
      emphasis: true,
    },
  ];
  if (r.liabilities.length) {
    sections.push({
      heading: 'Recorded liabilities',
      rows: r.liabilities.map((l) => [`${l.type} · ${l.periodStart} – ${l.periodEnd}`, `${fmt(l.amountDue, r.currency)} (${l.status})`] as [string, string]),
    });
  }
  return renderPdf('tax', 'Tax Summary', `${r.period.from} → ${r.period.to} · ${r.currency}`, sections);
}

export async function arAgingToPdf(r: { asOf: string; currency: string; totalOutstanding: number; totalOverdue: number; customers: Array<{ contactName?: string | null; total: number; current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number }> }): Promise<Buffer> {
  return renderPdf('ar-aging', 'A/R Aging', `As of ${r.asOf} · ${r.currency} · Outstanding ${fmt(r.totalOutstanding, r.currency)} · Overdue ${fmt(r.totalOverdue, r.currency)}`, [
    {
      rows: r.customers.map((c) => [
        c.contactName ?? 'Unknown',
        `cur ${fmt(c.current, r.currency)} / 1-30 ${fmt(c.d1to30, r.currency)} / 31-60 ${fmt(c.d31to60, r.currency)} / 61-90 ${fmt(c.d61to90, r.currency)} / 90+ ${fmt(c.d90plus, r.currency)} (total ${fmt(c.total, r.currency)})`,
      ]),
    },
  ]);
}

export async function dimensionToPdf(title: string, period: string, rows: DimensionRow[]): Promise<Buffer> {
  return renderPdf('dimension', title, period, [
    {
      rows: rows.map((r) => [r.label, `${r.total.toFixed(2)} (${r.count})`] as [string, string]),
    },
  ]);
}

export async function apAgingToPdf(r: { asOf: string; currency: string; total: number; vendors: Array<{ label: string; total: number; current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number }> }): Promise<Buffer> {
  return renderPdf('ap-aging', 'A/P Aging', `As of ${r.asOf} · ${r.currency} · Outstanding ${fmt(r.total, r.currency)}`, [
    {
      rows: r.vendors.map((v) => [
        v.label,
        `cur ${fmt(v.current, r.currency)} / 1-30 ${fmt(v.d1to30, r.currency)} / 31-60 ${fmt(v.d31to60, r.currency)} / 61-90 ${fmt(v.d61to90, r.currency)} / 90+ ${fmt(v.d90plus, r.currency)} (total ${fmt(v.total, r.currency)})`,
      ]),
    },
  ]);
}
