/**
 * W9-BALANCE-SHEET-EXPORT review CR-BSX-02 (owner ruling D-13): a PDF report row
 * is one label and its amount, drawn side by side. renderPdf drew the label at
 * the current y and then the amount at that same y; when the label did not fit
 * on the page, pdfkit moved the label to a new page and the amount, drawn at the
 * old y, overflowed onto yet another page. A reader then saw an account name on
 * one page and its figure at the top of the next. The multi-currency balance
 * sheet (RV37b-CR-03) roughly doubles the sheet's length, so small books hit it.
 *
 * Pure: renders through the real pdfkit formatter and reads each page's text
 * runs back out of the PDF (no server, no database).
 */
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { balanceSheetToPdf } from './report-formatters';
import type { BalanceSheetCurrencySheet, BalanceSheetLine, BalanceSheetReport } from './ledger-reporting.service';

const AS_OF = '2026-11-02T00:00:00.000Z';

const line = (prefix: string, i: number, currency: string): BalanceSheetLine => ({
  accountId: `${prefix}_${i}`,
  systemKey: `${prefix.toUpperCase()}_${i}`,
  name: `${prefix} account ${i}`,
  amount: 10 + i,
  currency,
});

function sheet(currency: string, perSection: number): BalanceSheetCurrencySheet {
  const lines = (prefix: string) => Array.from({ length: perSection }, (_, i) => line(prefix, i + 1, currency));
  const sum = (ls: BalanceSheetLine[]) => ls.reduce((s, l) => s + l.amount, 0);
  const assets = lines('Asset');
  const liabilities = lines('Liab');
  const equity = lines('Equity');
  return {
    asOf: AS_OF,
    currency,
    assets: { total: sum(assets), lines: assets, cashAndBank: 0, accountsReceivable: 0, inventory: 0 },
    liabilities: { total: sum(liabilities), lines: liabilities, accountsPayable: 0, taxPayable: 0, loans: 0 },
    equity: { total: sum(equity), lines: equity, ownerEquity: sum(equity), retainedEarnings: 0 },
    netEquityFromIncome: sum(assets) - sum(liabilities) - sum(equity),
    identityHolds: true,
    identityDelta: 0,
  };
}

function report(currency: string, sheets: Record<string, BalanceSheetCurrencySheet>): BalanceSheetReport {
  return { ...sheets[currency], byCurrency: sheets };
}

/** One text run as drawn: where it starts (PDF user space, y grows up the page) and its text. */
type Run = { x: number; y: number; text: string };

/**
 * The text runs of each page of a pdfkit PDF, in drawing order: pdfkit writes one
 * FlateDecode content stream per page, in page order (standard fonts are not
 * embedded, so every stream is a page), and draws one Tm + TJ per text line.
 */
function pdfRuns(pdf: Buffer): Run[][] {
  const pages: Run[][] = [];
  const raw = pdf.toString('latin1');
  const streams = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streams.exec(raw))) {
    const start = m.index + m[0].length;
    let content: string;
    try {
      content = inflateSync(pdf.subarray(start, raw.indexOf('endstream', start))).toString('latin1');
    } catch {
      continue;
    }
    const runs: Run[] = [];
    for (const tj of content.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm[\s\S]*?\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...tj[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join('');
      runs.push({ x: Number(tj[1]), y: Number(tj[2]), text: Buffer.from(hex, 'hex').toString('latin1').replace(/\u00a0/g, ' ') });
    }
    pages.push(runs);
  }
  return pages;
}

const pdfPages = (pdf: Buffer): string[][] => pdfRuns(pdf).map((runs) => runs.map((r) => r.text));

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(n).replace(/ /g, ' ');

const HEADINGS = ['Assets', 'Liabilities', 'Equity', 'TTD balances', 'USD balances'];

/** Every account row of every sheet: its label is followed, on the same page, by its amount. */
function expectRowsWhole(pages: string[][], sheets: BalanceSheetCurrencySheet[]) {
  expect(pages.length, 'the sheet spans more than one page').toBeGreaterThan(1);
  const pairsOnAPage = pages.flatMap((texts) => texts.slice(0, -1).map((t, i) => `${t} => ${texts[i + 1]}`));
  for (const s of sheets) {
    for (const l of [...s.assets.lines, ...s.liabilities.lines, ...s.equity.lines]) {
      expect(pairsOnAPage, `${s.currency}: ${l.name} and its amount on one page`).toContain(`${l.name} => ${money(l.amount, s.currency)}`);
    }
  }
  // No page is only a label or opens with an amount carried over from the page before.
  for (const [i, texts] of pages.entries()) {
    expect(texts.length, `page ${i + 1} holds a whole row`).toBeGreaterThan(1);
    if (i > 0) expect(texts[0], `page ${i + 1} opens with a label, not an amount`).not.toMatch(/^[A-Z]{3} -?[\d,]+\.\d{2}( |$)/);
    // A heading stays with the first row under it.
    if (i < pages.length - 1) expect(HEADINGS, `page ${i + 1} does not end on a heading`).not.toContain(texts[texts.length - 1]);
  }
}

describe('W9-BALANCE-SHEET-EXPORT review CR-BSX-02 (D-13): a PDF row never splits its label and amount across pages', () => {
  it('CR-BSX-02a RED-BEFORE: a two-currency balance sheet (5 to 16 lines per section in USD and TTD) keeps every label and its amount, and every heading and its first row, on one page', async () => {
    // Each size moves the page break to another row or heading.
    for (let perSection = 5; perSection <= 16; perSection++) {
      const usd = sheet('USD', perSection);
      const ttd = sheet('TTD', perSection);
      const pages = pdfPages(await balanceSheetToPdf(report('USD', { USD: usd, TTD: ttd })));
      expectRowsWhole(pages, [usd, ttd]);
      // The TTD sheet follows the USD sheet, under its own heading, once.
      expect(pages.flat().filter((t) => t === 'TTD balances'), `${perSection} lines`).toHaveLength(1);
    }
  });

  it('CR-BSX-02b RED-BEFORE: a single-currency balance sheet with 15 lines per section keeps every label and its amount on one page', async () => {
    const usd = sheet('USD', 15);
    const pages = pdfPages(await balanceSheetToPdf(report('USD', { USD: usd })));
    expectRowsWhole(pages, [usd]);
  });

  it('CR-BSX-02c RED-BEFORE: every section heading starts at the left margin, never in the amount column', async () => {
    const usd = sheet('USD', 3);
    const ttd = sheet('TTD', 3);
    const runs = pdfRuns(await balanceSheetToPdf(report('USD', { USD: usd, TTD: ttd }))).flat();
    const headings = runs.filter((r) => ['Assets', 'Liabilities', 'Equity', 'TTD balances'].includes(r.text));
    expect(headings.map((h) => h.text)).toEqual(['Assets', 'Liabilities', 'Equity', 'TTD balances', 'Assets', 'Liabilities', 'Equity']);
    const margin = runs.find((r) => r.text === 'Balance Sheet')!.x;
    for (const h of headings) expect(h.x, `${h.text} at the left margin`).toBe(margin);
  });

  it('CR-BSX-02d RED-BEFORE: a label that wraps keeps the next row below its last line', async () => {
    const usd = sheet('USD', 2);
    const long = 'Equipment held under a long-term finance lease with the regional development bank, Port of Spain branch';
    usd.assets.lines[0] = { ...usd.assets.lines[0], name: long };
    const runs = pdfRuns(await balanceSheetToPdf(report('USD', { USD: usd }))).flat();
    const first = runs.findIndex((r) => long.startsWith(r.text) && r.text.length > 10);
    expect(first, 'the long label is drawn').toBeGreaterThan(0);
    const [line1, line2, amount, next] = runs.slice(first, first + 4);
    expect(`${line1.text} ${line2.text}`.replace(/\s+/g, ' '), 'the label wraps onto a second line').toBe(long);
    expect(amount.text).toBe(money(usd.assets.lines[0].amount, 'USD'));
    expect(next.text).toBe('Asset account 2');
    // PDF y grows up the page: the next row sits at least a 9pt line below the label's second line.
    expect(line2.y - next.y, 'the next row does not overprint the wrapped label').toBeGreaterThanOrEqual(9);
  });
});
