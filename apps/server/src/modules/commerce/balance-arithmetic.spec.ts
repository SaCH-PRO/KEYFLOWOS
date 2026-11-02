/**
 * V1-36-DM-BALANCE-READ-CONTRACT — one invoice balance read contract (CF-17).
 *
 * What an invoice has been paid and what is left on it is computeBalance over
 * its stored Payment rows (balanceOfStoredRows, invoice-workflow.service.ts):
 * integer cents (V1-22, D-13), SUCCESSFUL rows in, REFUNDED rows out, each
 * refund a separate negative REFUNDED row beside its SUCCESSFUL original
 * (V1-29, D-14), a row flipped to REFUNDED before V1-29 read as its payment
 * plus its refund. Before V1-36 the arithmetic was written out again on the
 * web invoice list, the stat cards, the payment form and the revenue
 * surfaces, each summing the SUCCESSFUL rows alone: after a refund they read
 * the money as still received ("100% paid", remaining 0, an over-payment
 * warning for the 40 still owed, refunded money counted as revenue).
 *
 *   BA-01  the web mirror (packages/shared/src/invoice-balance.ts) is the server function:
 *          computeInvoiceBalance = computeBalance, readStoredPaymentRows = readStoredPayments,
 *          invoiceBalanceOfStoredRows = balanceOfStoredRows, on fixed edge cases and on 2000
 *          seeded random row sets (cents, sub-cent legacy totals, refunds of both signs,
 *          PENDING / FAILED rows)
 *   BA-02  the CF-17 case through the mirror: SUCCESSFUL 100 with 40 refunded on 100 reads paid
 *          100, refunded 40, net 60, remaining 40, 60% paid; recording 40 is not an over-payment
 *   BA-03  the database form of the contract (CASH_NET_PAYMENT_WHERE: the rows whose amounts sum
 *          to the net) selects exactly the rows whose sum is balanceOfStoredRows(...).net
 *   BA-04  ratchet: no write-set surface reads money as a SUCCESSFUL-only sum (a `.filter` on
 *          status === 'SUCCESSFUL', or a Payment aggregate / findMany of amounts pinned to
 *          SUCCESSFUL) or as a status-blind sum of an invoice's payment rows (a `.reduce` over
 *          `payments` adding `.amount` with no status in the chain: PENDING, FAILED and flipped
 *          rows counted as received, V1-29b); outside the write sets the known readers are an
 *          exact inventory that only shrinks; a new one fails, naming file:line
 *   BA-05  the web surfaces read the shared contract: each imports invoiceBalanceOfStoredRows
 *          from @keyflow/shared, and the package index re-exports ./invoice-balance
 *   BA-06  scanner self-test: an injected SUCCESSFUL-only sum is found
 *   BA-07  reachability (review V36-CR-1): which write-set web files a Next.js route renders. The
 *          three web files the V1-36 write set names render on no route (invoice-list.tsx and
 *          invoice-stat-cards.tsx have no importer; invoices-panel.tsx is imported only by
 *          billing/billing-panel.tsx, which nothing imports). BA-04 / BA-05 on them prove the files
 *          read the contract, not that a screen does. The live web balance surfaces (the nav
 *          "Invoices" hub invoices/page.tsx, the invoice detail page, the finance payment-record
 *          modal) were outside the write set and in the BA-04 inventory at V1-36.
 *   BA-08  (V1-29b-REFUND-READERS, review V36-CR-1) the live web balance surfaces (the nav
 *          "Invoices" hub, the invoice detail page, the finance payment-record modal) are rendered
 *          by a route, import invoiceBalanceOfStoredRows from @keyflow/shared and hold no
 *          SUCCESSFUL-only or status-blind sum
 *   BA-09  (V1-29b-REFUND-READERS, reviews CR-V29-1/2/3) the server balance readers outside the
 *          V1-29 / V1-36 write sets (the invoice / reminder email and evidence match, CASH-basis
 *          receivables, the open payables, the receipt email and the public receipt) hold no such
 *          sum, read stored rows through balanceOfStoredRows (directly or through
 *          ownTenantReceiptBalance, which does) and never call computeBalance on them (it reads a
 *          pre-V1-29 flipped row as a refund twice); sumSuccessfulPayments, the last inventory
 *          entry of the commerce email path, has no production caller
 *
 * The mirror is loaded by path from the tree this spec runs in (a worktree
 * resolves @keyflow/shared to the main tree's built dist).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as workflow from './invoice-workflow.service';
import { fromCents, sumMoney, toCents } from './money';

const SERVER = join(__dirname, '..', '..', '..');
const REPO = join(SERVER, '..', '..');
const SHARED_BALANCE = join(REPO, 'packages', 'shared', 'src', 'invoice-balance.ts');
const SHARED_INDEX = join(REPO, 'packages', 'shared', 'src', 'index.ts');

type Row = { amount: number | string; status: string };

async function mirror(): Promise<any> {
  expect(existsSync(SHARED_BALANCE), 'packages/shared/src/invoice-balance.ts (the web mirror of computeBalance) exists').toBe(true);
  return import(SHARED_BALANCE);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const FIXED: Array<{ name: string; total: number; rows: Row[] }> = [
  { name: 'no payments', total: 100, rows: [] },
  { name: 'CF-17: SUCCESSFUL 100, refund -40', total: 100, rows: [{ amount: 100, status: 'SUCCESSFUL' }, { amount: -40, status: 'REFUNDED' }] },
  { name: '60 + 40, the 40 refunded', total: 100, rows: [{ amount: 60, status: 'SUCCESSFUL' }, { amount: 40, status: 'SUCCESSFUL' }, { amount: -40, status: 'REFUNDED' }] },
  { name: 'full refund', total: 100, rows: [{ amount: 100, status: 'SUCCESSFUL' }, { amount: -100, status: 'REFUNDED' }] },
  { name: 'flipped pre-V1-29 row', total: 100, rows: [{ amount: 60, status: 'REFUNDED' }] },
  { name: 'flipped row then re-settled', total: 100, rows: [{ amount: 60, status: 'REFUNDED' }, { amount: 100, status: 'SUCCESSFUL' }] },
  { name: 'PENDING and FAILED are not cash', total: 100, rows: [{ amount: 30, status: 'PENDING' }, { amount: 70, status: 'FAILED' }, { amount: 10, status: 'SUCCESSFUL' }] },
  { name: '33.33 x 3 + 0.01', total: 100, rows: [33.33, 33.33, 33.33, 0.01].map((amount) => ({ amount, status: 'SUCCESSFUL' })) },
  { name: '0.1 + 0.2 on 0.3', total: 0.3, rows: [{ amount: 0.1, status: 'SUCCESSFUL' }, { amount: 0.2, status: 'SUCCESSFUL' }] },
  { name: 'legacy sub-cent total settled at 9.40', total: 9.405, rows: [{ amount: 9.4, status: 'SUCCESSFUL' }] },
  { name: 'legacy sub-cent total overpaid at 9.42', total: 9.405, rows: [{ amount: 9.42, status: 'SUCCESSFUL' }] },
  { name: 'over-payment', total: 100, rows: [{ amount: 120, status: 'SUCCESSFUL' }] },
  { name: 'zero total', total: 0, rows: [{ amount: 5, status: 'SUCCESSFUL' }] },
  { name: 'string amounts (Prisma Decimal read as text)', total: 50, rows: [{ amount: '20.10', status: 'SUCCESSFUL' }, { amount: '-5.05', status: 'REFUNDED' }] },
  { name: 'non-numeric amount counts 0', total: 50, rows: [{ amount: 'x', status: 'SUCCESSFUL' }, { amount: 10, status: 'SUCCESSFUL' }] },
  { name: 'half-cent rows', total: 10, rows: [{ amount: 1.005, status: 'SUCCESSFUL' }, { amount: -0.005, status: 'REFUNDED' }] },
  { name: 'refunds above payments', total: 100, rows: [{ amount: 20, status: 'SUCCESSFUL' }, { amount: -50, status: 'REFUNDED' }] },
];

/** mulberry32: a seeded PRNG, so the random cases are the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCases(count: number): Array<{ total: number; rows: Row[] }> {
  const rnd = prng(36);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const amount = () => {
    const cents = Math.floor(rnd() * 50_000);
    // One in five is not a whole cent (legacy rows, float noise).
    return rnd() < 0.2 ? cents / 100 + pick([0.005, 0.0049, 0.0051, 0.001, 1e-9]) : cents / 100;
  };
  const out: Array<{ total: number; rows: Row[] }> = [];
  for (let i = 0; i < count; i++) {
    const rows: Row[] = [];
    const n = Math.floor(rnd() * 6);
    for (let j = 0; j < n; j++) {
      const status = pick(['SUCCESSFUL', 'SUCCESSFUL', 'SUCCESSFUL', 'REFUNDED', 'REFUNDED', 'PENDING', 'FAILED']);
      // A refund row is negative (D-14) or, flipped before V1-29, positive.
      const a = amount();
      rows.push({ amount: status === 'REFUNDED' && rnd() < 0.7 ? -a : a, status });
    }
    const total = rnd() < 0.1 ? 0 : rnd() < 0.15 ? Math.floor(rnd() * 100_000) / 100 + 0.005 : Math.floor(rnd() * 100_000) / 100;
    out.push({ total, rows });
  }
  return out;
}

const RANDOM = randomCases(2000);

describe('BA-01: the web mirror is the server function', () => {
  it('computeInvoiceBalance = computeBalance; readStoredPaymentRows = readStoredPayments; invoiceBalanceOfStoredRows = balanceOfStoredRows (fixed cases)', async () => {
    const m = await mirror();
    for (const c of FIXED) {
      expect(m.computeInvoiceBalance(c.total, c.rows, 'TTD'), `${c.name}: computeBalance`).toEqual(
        workflow.computeBalance(c.total, c.rows as Array<{ amount: number; status: string }>, 'TTD'),
      );
      expect(m.readStoredPaymentRows(c.rows), `${c.name}: readStoredPayments`).toEqual(workflow.readStoredPayments(c.rows));
      expect(m.invoiceBalanceOfStoredRows(c.total, c.rows, 'USD'), `${c.name}: balanceOfStoredRows`).toEqual(
        workflow.balanceOfStoredRows(c.total, c.rows, 'USD'),
      );
    }
  });

  it('the same on 2000 seeded random row sets', async () => {
    const m = await mirror();
    for (const [i, c] of RANDOM.entries()) {
      const label = `random #${i}: total ${c.total}, rows ${JSON.stringify(c.rows)}`;
      expect(m.computeInvoiceBalance(c.total, c.rows), label).toEqual(
        workflow.computeBalance(c.total, c.rows as Array<{ amount: number; status: string }>),
      );
      expect(m.invoiceBalanceOfStoredRows(c.total, c.rows), label).toEqual(workflow.balanceOfStoredRows(c.total, c.rows));
    }
  });
});

describe('BA-02: the CF-17 case through the mirror', () => {
  it('SUCCESSFUL 100 with 40 refunded on 100: paid 100, refunded 40, net 60, remaining 40, 60% paid; recording 40 is not an over-payment, 40.01 is', async () => {
    const m = await mirror();
    const rows: Row[] = [{ amount: 100, status: 'SUCCESSFUL' }, { amount: -40, status: 'REFUNDED' }];
    const b = m.invoiceBalanceOfStoredRows(100, rows, 'TTD');
    // RED-BEFORE (V1-34 head): the web summed SUCCESSFUL rows: paid 100, remaining 0, "100% paid".
    expect(b).toEqual({ total: 100, paid: 100, refunded: 40, net: 60, remaining: 40, isFullyPaid: false, isOverpaid: false });
    expect(m.invoicePaidPercent(b)).toBe(60);
    expect(m.computeInvoiceBalance(100, [...rows, { amount: 40, status: 'SUCCESSFUL' }]).isOverpaid).toBe(false);
    expect(m.computeInvoiceBalance(100, [...rows, { amount: 40.01, status: 'SUCCESSFUL' }]).isOverpaid).toBe(true);
    expect(m.invoicePaidPercent(m.computeInvoiceBalance(100, []))).toBe(0);
    expect(m.invoicePaidPercent(m.computeInvoiceBalance(0, [{ amount: 5, status: 'SUCCESSFUL' }]))).toBe(0);
    // A legacy sub-cent total settled at the reading the base settled it with reads 100%, not 99%.
    expect(m.invoicePaidPercent(m.computeInvoiceBalance(9.405, [{ amount: 9.4, status: 'SUCCESSFUL' }]))).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BA-03: the database form of the contract
// ---------------------------------------------------------------------------

/** Evaluates the Prisma where shapes CASH_NET_PAYMENT_WHERE may use, on one row. */
function matches(row: { amount: number; status: string }, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return (cond as any[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as any[]).every((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, cond);
    const value = (row as any)[key];
    if (cond === null || typeof cond !== 'object') return value === cond;
    return Object.entries(cond).every(([op, x]: [string, any]) => {
      switch (op) {
        case 'equals': return value === x;
        case 'in': return (x as any[]).includes(value);
        case 'notIn': return !(x as any[]).includes(value);
        case 'lt': return value < x;
        case 'lte': return value <= x;
        case 'gt': return value > x;
        case 'gte': return value >= x;
        case 'not': return value !== x;
        default: throw new Error(`matches(): operator ${op} is not modelled`);
      }
    });
  });
}

describe('BA-03: the database form of the contract', () => {
  it('summing the amounts of the rows CASH_NET_PAYMENT_WHERE selects is balanceOfStoredRows(...).net (fixed and random cases); a legacy sub-cent row may move it by one cent, never more', () => {
    const where = (workflow as any).CASH_NET_PAYMENT_WHERE;
    expect(where, 'invoice-workflow.service.ts exports CASH_NET_PAYMENT_WHERE').toBeTruthy();
    let exact = 0;
    for (const c of [...FIXED, ...RANDOM]) {
      const rows = c.rows.map((r) => ({ amount: Number(r.amount) || 0, status: r.status }));
      const viaWhere = sumMoney(rows.filter((r) => matches(r, where)).map((r) => r.amount));
      const net = workflow.balanceOfStoredRows(0, rows).net;
      if (rows.every((r) => fromCents(toCents(r.amount)) === r.amount)) {
        // Every row written since V1-22 is a whole number of cents: the two readings are one.
        exact += 1;
        expect(viaWhere, JSON.stringify(c.rows)).toBe(net);
      } else {
        // computeBalance rounds paid and refunded to cents separately; one sum rounds once.
        expect(Math.abs(toCents(viaWhere) - toCents(net)), JSON.stringify(c.rows)).toBeLessThanOrEqual(1);
      }
    }
    expect(exact, 'most cases are whole-cent rows').toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// BA-04 .. BA-06: the ratchet
// ---------------------------------------------------------------------------

export interface SuccessfulOnlyRead {
  file: string;
  line: number;
  form: 'filter' | 'prisma' | 'reduce';
}

/** Comments blanked (line and block), string contents kept, offsets kept. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

/** The text of the call whose `(` is at `open`, up to its matching `)`. */
function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** `.filter((p) => p.status === 'SUCCESSFUL')`, any parameter name, typed or not, either quote. */
const FILTER_SUCCESSFUL =
  /\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::\s*[^)=]+)?\)?\s*=>\s*\1\s*\.\s*status\s*===\s*(['"])SUCCESSFUL\2/g;
/** A Payment read (`<x>.payment.aggregate|groupBy|findMany(`). */
const PAYMENT_READ = /\.\s*payment\s*\.\s*(aggregate|groupBy|findMany)\s*\(/g;
const PINNED_SUCCESSFUL = /\bstatus\s*:\s*(?:(['"])SUCCESSFUL\1|\{\s*(?:equals\s*:\s*(['"])SUCCESSFUL\2|in\s*:\s*\[\s*(['"])SUCCESSFUL\3\s*\]))/;
const READS_AMOUNT = /_sum\s*:\s*\{[^}]*\bamount\b|\bamount\s*:\s*true\b/;
/**
 * V1-29b: a `.reduce(` whose receiver chain (back to the statement start) is a payment-row
 * collection (`payments`, `inv.payments`, `(invoice?.payments ?? [])`) with no `.status` in it,
 * adding `.amount`: a status-blind sum that counts PENDING, FAILED and flipped REFUNDED rows as
 * received. A chain with a SUCCESSFUL filter is the 'filter' form already.
 */
const REDUCE_CALL = /\.reduce\s*\(/g;
const PAYMENT_ROWS = /(?:^|[^\w$])payments\b/;
const STATUS_IN_CHAIN = /\.\s*status\b/;
const ADDS_AMOUNT = /\.\s*amount\b/;

/** The text from the start of the statement (after the last `;`, `{` or `}`) up to `index`. */
function statementBefore(src: string, index: number): string {
  const start = Math.max(src.lastIndexOf(';', index - 1), src.lastIndexOf('{', index - 1), src.lastIndexOf('}', index - 1));
  return src.slice(start + 1, index);
}

/** Every SUCCESSFUL-only money read in one source file. `file` is repo-relative. */
export function scanSuccessfulOnlyReads(file: string, source: string): SuccessfulOnlyRead[] {
  const src = stripComments(source);
  const out: SuccessfulOnlyRead[] = [];
  for (const m of src.matchAll(FILTER_SUCCESSFUL)) out.push({ file, line: lineAt(src, m.index ?? 0), form: 'filter' });
  for (const m of src.matchAll(PAYMENT_READ)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const call = callText(src, open);
    if (PINNED_SUCCESSFUL.test(call) && READS_AMOUNT.test(call)) out.push({ file, line: lineAt(src, m.index ?? 0), form: 'prisma' });
  }
  for (const m of src.matchAll(REDUCE_CALL)) {
    const at = m.index ?? 0;
    const receiver = statementBefore(src, at);
    if (!PAYMENT_ROWS.test(receiver) || STATUS_IN_CHAIN.test(receiver)) continue;
    if (ADDS_AMOUNT.test(callText(src, at + m[0].length - 1))) out.push({ file, line: lineAt(src, at), form: 'reduce' });
  }
  return out.sort((a, b) => a.line - b.line);
}

function walk(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

const repoPath = (full: string) => relative(REPO, full).split(sep).join('/');
const isServerSource = (p: string) => p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts');
const isWebSource = (p: string) => /\.(ts|tsx)$/.test(p) && !/\.(test|spec)\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts');

function scanTree(): SuccessfulOnlyRead[] {
  const files = [
    ...walk(join(SERVER, 'src'), isServerSource),
    ...walk(join(REPO, 'apps', 'web', 'src'), isWebSource),
  ];
  return files.flatMap((f) => scanSuccessfulOnlyReads(repoPath(f), readFileSync(f, 'utf8')));
}

/** Where the contract itself lives: computeBalance and its web mirror sum SUCCESSFUL rows by definition. */
const CANONICAL = new Set([
  'apps/server/src/modules/commerce/invoice-workflow.service.ts',
  'packages/shared/src/invoice-balance.ts',
]);

/** The V1-36 write set's balance surfaces: no SUCCESSFUL-only read may remain in any of them. */
const WRITE_SET_SURFACES = [
  'apps/server/src/modules/commerce/commerce.service.ts',
  'apps/server/src/modules/commerce/revenue-reporting.service.ts',
  'apps/server/src/modules/commerce/revenue-action.service.ts',
  'apps/server/src/modules/finance/finance-overview.service.ts',
  'apps/web/src/app/app/commerce/invoices/components/invoice-list.tsx',
  'apps/web/src/app/app/commerce/invoices/components/invoice-stat-cards.tsx',
  'apps/web/src/app/app/commerce/invoices/invoices-panel.tsx',
];

/**
 * The V1-29b-REFUND-READERS write set's balance readers (CR-V29-1/2/3, the V1-22 residual,
 * V36-CR-1): no SUCCESSFUL-only or status-blind read may remain in any of them.
 */
const REFUND_READER_SURFACES = {
  server: [
    'apps/server/src/modules/commerce/commerce.controller.ts',
    'apps/server/src/modules/finance/receivables.service.ts',
    'apps/server/src/modules/payments/payments-ops.service.ts',
    'apps/server/src/modules/commerce/invoice-receipt.listener.ts',
    'apps/server/src/modules/commerce/invoice-receipt-builder.service.ts',
  ],
  web: [
    'apps/web/src/app/app/commerce/invoices/page.tsx',
    'apps/web/src/app/app/commerce/invoices/[id]/page.tsx',
    'apps/web/src/app/app/finance/components/payment-record-modal.tsx',
  ],
};
const REFUND_READER_FILES = [...REFUND_READER_SURFACES.server, ...REFUND_READER_SURFACES.web];

/**
 * SUCCESSFUL-only and status-blind money reads outside the V1-36 and
 * V1-29b write sets. Exact counts; the list only shrinks: each is a surface
 * that still reads a refunded invoice as paid and moves onto the contract in
 * its own packet. V1-29b removed receivables.service.ts (2, CR-V29-2),
 * commerce.controller.ts (1, CR-V29-1), payment-record-modal.tsx (1),
 * invoices/[id]/page.tsx (1) and invoices/page.tsx (2) (V36-CR-1); the
 * status-blind form it added found payments-ops.service.ts (fixed here) and
 * the two entries marked V1-29b below.
 */
const KNOWN_OUTSIDE_WRITE_SET: Record<string, { count: number; why: string }> = {
  'apps/server/src/modules/crm/crm-revenue.service.ts': {
    count: 1,
    why: 'contact lifetime revenue and payment counts (successfulPayments); refunds not subtracted',
  },
  'apps/server/src/modules/commerce/invoice-email.types.ts': {
    count: 1,
    why: 'sumSuccessfulPayments: no production caller since V1-49 (the email figures read ownTenantReceiptBalance; BA-09 keeps it uncalled)',
  },
  'apps/server/src/modules/key-cortex/key-cortex-context-v2.service.ts': {
    count: 1,
    why: 'V1-29b (status-blind form): the "changes since" digest sums new Payment amounts (paymentTotal) with no refund netting',
  },
  'apps/web/src/app/app/finance/components/records/record-card.tsx': {
    count: 1,
    why: 'V1-29b (status-blind form): the finance record card progress bar (PaymentProgress) sums every payment row of an invoice record',
  },
};

describe('BA-04: SUCCESSFUL-only money reads are ratcheted out', () => {
  const found = scanTree();
  const byFile = new Map<string, SuccessfulOnlyRead[]>();
  for (const r of found) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const fmt = (rs: SuccessfulOnlyRead[]) => rs.map((r) => `${r.file}:${r.line} (${r.form})`).join(', ');

  it('no write-set balance surface reads money as a SUCCESSFUL-only sum', () => {
    const offenders = WRITE_SET_SURFACES.flatMap((f) => byFile.get(f) ?? []);
    // RED-BEFORE (V1-34 head): the web list, stat cards and payment form, the Finance overview
    // revenue, the revenue KPIs / pulse and the collected-vs-expected report.
    expect(fmt(offenders), 'SUCCESSFUL-only reads in the V1-36 write set').toBe('');
  });

  it('no V1-29b-REFUND-READERS balance reader reads money as a SUCCESSFUL-only or status-blind sum', () => {
    const offenders = REFUND_READER_FILES.flatMap((f) => byFile.get(f) ?? []);
    // RED-BEFORE (int/trial-I 7f4b81a2): receivables.service.ts x2 (CASH basis), commerce.controller.ts
    // (evidence match), payments-ops.service.ts (status-blind float sum), invoices/page.tsx x2,
    // invoices/[id]/page.tsx and payment-record-modal.tsx (fallback figures).
    expect(fmt(offenders), 'SUCCESSFUL-only / status-blind reads in the V1-29b write set').toBe('');
  });

  it('outside the write sets the SUCCESSFUL-only and status-blind readers are exactly the known inventory (a new one fails; one that disappears lowers the inventory)', () => {
    const ownedElsewhere = (file: string) => CANONICAL.has(file) || WRITE_SET_SURFACES.includes(file) || REFUND_READER_FILES.includes(file);
    const actual: Record<string, number> = {};
    for (const [file, rs] of byFile) {
      if (ownedElsewhere(file)) continue;
      actual[file] = rs.length;
    }
    const expected = Object.fromEntries(Object.entries(KNOWN_OUTSIDE_WRITE_SET).map(([f, v]) => [f, v.count]));
    const unexpected = found.filter((r) => !ownedElsewhere(r.file) && !(r.file in expected));
    expect(fmt(unexpected), 'new SUCCESSFUL-only / status-blind money reads (use balanceOfStoredRows / the shared mirror / CASH_NET_PAYMENT_WHERE)').toBe('');
    expect(actual).toEqual(expected);
  });

  it('the scan sees the tree (the canonical home and the inventory are found)', () => {
    expect(byFile.get('apps/server/src/modules/commerce/invoice-workflow.service.ts')?.length ?? 0, 'computeBalance itself').toBeGreaterThan(0);
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('BA-05: the web surfaces read the shared contract', () => {
  const WEB = WRITE_SET_SURFACES.filter((f) => f.startsWith('apps/web/'));

  it('the shared package index re-exports ./invoice-balance', () => {
    const reexports = /export\s+\*\s+from\s+["']\.\/invoice-balance["']/.test(readFileSync(SHARED_INDEX, 'utf8'));
    expect(reexports, 'packages/shared/src/index.ts: export * from "./invoice-balance"').toBe(true);
  });

  it.each(WEB)('%s imports invoiceBalanceOfStoredRows from @keyflow/shared', (file) => {
    const src = stripComments(readFileSync(join(REPO, file), 'utf8'));
    const imports = /import\s*\{[^}]*\binvoiceBalanceOfStoredRows\b[^}]*\}\s*from\s*["']@keyflow\/shared["']/.test(src);
    expect(imports, `${file} imports invoiceBalanceOfStoredRows from @keyflow/shared`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BA-07: which write-set web files a route renders (review V36-CR-1)
// ---------------------------------------------------------------------------

const WEB_SRC = join(REPO, 'apps', 'web', 'src');
const WEB_APP = join(WEB_SRC, 'app');
/** Next.js App Router entry files: everything a route renders is imported from one of these. */
const ROUTE_ENTRY = /^(page|layout|template|loading|error|global-error|not-found|default|route|sitemap|robots|manifest)\.(tsx|ts)$/;
/** Static (`from '...'`, `import '...'`) and dynamic (`import('...')`, `require('...')`) specifiers. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

function resolveWebImport(fromFile: string, spec: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = join(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Repo-relative web source files reachable from a route entry (or middleware) through imports; tests excluded. */
function routeReachableWebFiles(): Set<string> {
  const files = walk(WEB_SRC, isWebSource);
  const known = new Set(files);
  const edges = new Map<string, string[]>();
  for (const f of files) {
    const targets: string[] = [];
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(IMPORT_SPECIFIER)) {
      const to = resolveWebImport(f, m[2], known);
      if (to) targets.push(to);
    }
    edges.set(f, targets);
  }
  const entries = files.filter(
    (f) => (f.startsWith(WEB_APP + sep) && ROUTE_ENTRY.test(basename(f))) || f === join(WEB_SRC, 'middleware.ts'),
  );
  const seen = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    for (const to of edges.get(queue.pop() as string) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return new Set([...seen].map(repoPath));
}

/**
 * The V1-36 write-set web files that no route renders, at the V1-36 review.
 * Exact; the list only shrinks. BA-04 / BA-05 hold on these files, but no
 * screen shows what they compute.
 */
const UNREACHABLE_WRITE_SET_WEB: Record<string, string> = {
  'apps/web/src/app/app/commerce/invoices/components/invoice-list.tsx': 'no importer',
  'apps/web/src/app/app/commerce/invoices/components/invoice-stat-cards.tsx': 'no importer',
  'apps/web/src/app/app/commerce/invoices/invoices-panel.tsx':
    'imported only by commerce/billing/billing-panel.tsx, which nothing imports (commerce/billing/page.tsx redirects to /app/settings/billing)',
};

describe('BA-07: which write-set web files a route renders (V36-CR-1)', () => {
  const reachable = routeReachableWebFiles();

  it('the import graph sees the live balance surfaces: the nav "Invoices" hub, the invoice detail page, and Sales -> finance pipeline -> payment-record modal', () => {
    expect(readFileSync(join(WEB_SRC, 'lib', 'nav-config.ts'), 'utf8'), 'the nav "Invoices" door is /app/commerce/invoices').toMatch(
      /label:\s*"Invoices",\s*href:\s*"\/app\/commerce\/invoices"/,
    );
    for (const f of [
      'apps/web/src/app/app/commerce/invoices/page.tsx',
      'apps/web/src/app/app/commerce/invoices/[id]/page.tsx',
      'apps/web/src/app/app/finance/components/finance-pipeline.tsx',
      'apps/web/src/app/app/finance/components/payment-record-modal.tsx',
    ]) {
      expect(reachable.has(f), `${f} is rendered by a route`).toBe(true);
    }
  });

  it('the write-set web files no route renders are exactly the known inventory (one wired onto a route lowers it)', () => {
    const unreachable = WRITE_SET_SURFACES.filter((f) => f.startsWith('apps/web/') && !reachable.has(f)).sort();
    expect(unreachable).toEqual(Object.keys(UNREACHABLE_WRITE_SET_WEB).sort());
  });

});

describe('BA-08: the live web balance surfaces read the shared contract (V1-29b-REFUND-READERS, V36-CR-1)', () => {
  const reachable = routeReachableWebFiles();
  const scanned = scanTree();

  it.each(REFUND_READER_SURFACES.web)('%s is rendered by a route, imports invoiceBalanceOfStoredRows from @keyflow/shared and holds no SUCCESSFUL-only or status-blind sum', (file) => {
    expect(reachable.has(file), `${file} is rendered by a route`).toBe(true);
    const src = stripComments(readFileSync(join(REPO, file), 'utf8'));
    // RED-BEFORE (int/trial-I 7f4b81a2): none of the three imported the contract; the hub read
    // "100% paid" and nothing unpaid for 60 + 40 with the 40 refunded (mirror: 60%, remaining 40).
    const imports = /import\s*\{[^}]*\binvoiceBalanceOfStoredRows\b[^}]*\}\s*from\s*["']@keyflow\/shared["']/.test(src);
    expect(imports, `${file} imports invoiceBalanceOfStoredRows from @keyflow/shared`).toBe(true);
    expect(scanned.filter((r) => r.file === file).map((r) => `${r.line} (${r.form})`), file).toEqual([]);
  });
});

describe('BA-09: the server balance readers outside the V1-29 / V1-36 write sets read stored rows through the contract (V1-29b-REFUND-READERS)', () => {
  const SERVER_SRC = (file: string) => stripComments(readFileSync(join(REPO, file), 'utf8'));

  it.each(REFUND_READER_SURFACES.server)('%s reads stored rows through balanceOfStoredRows (or ownTenantReceiptBalance) and never calls computeBalance on them', (file) => {
    const src = SERVER_SRC(file);
    // RED-BEFORE: the receipt builder called computeBalance (a flipped row subtracted twice); the
    // controller, receivables and payables summed rows by hand.
    expect(/\b(?:balanceOfStoredRows|ownTenantReceiptBalance)\s*\(/.test(src), `${file} calls balanceOfStoredRows or ownTenantReceiptBalance`).toBe(true);
    expect(src.match(/\bcomputeBalance\s*\(/g) ?? [], `${file}: no computeBalance call over stored rows`).toEqual([]);
  });

  it('ownTenantReceiptBalance (the receipt emails, the email context, the evidence match) is balanceOfStoredRows over the own-tenant rows', () => {
    const src = SERVER_SRC('apps/server/src/modules/commerce/invoice-receipt-builder.service.ts');
    const body = src.match(/export function ownTenantReceiptBalance\([\s\S]*?\n\}/)?.[0] ?? '';
    expect(body, 'ownTenantReceiptBalance is defined').not.toBe('');
    expect(body).toMatch(/\bbalanceOfStoredRows\s*\(/);
  });

  it('sumSuccessfulPayments (invoice-email.types.ts, the last inventory entry of the email path) has no production caller', () => {
    const callers = walk(join(SERVER, 'src'), isServerSource)
      .filter((f) => !f.endsWith(join('commerce', 'invoice-email.types.ts')))
      .filter((f) => /\bsumSuccessfulPayments\b/.test(stripComments(readFileSync(f, 'utf8'))))
      .map(repoPath);
    expect(callers).toEqual([]);
  });
});

describe('BA-06: scanner self-test', () => {
  it('finds an injected filter sum, typed filter, Prisma aggregate and findMany pinned to SUCCESSFUL, and a status-blind reduce of payment amounts; ignores comments, other statuses, reads without amounts and reduces of other rows', () => {
    const src = [
      "const a = rows.filter((p) => p.status === 'SUCCESSFUL').reduce((s, p) => s + p.amount, 0);",
      'const b = rows.filter((x: any) => x.status === "SUCCESSFUL");',
      "const c = rows.filter(p => p.status === 'SUCCESSFUL');",
      "await this.prisma.client.payment.aggregate({ where: { businessId, status: 'SUCCESSFUL' }, _sum: { amount: true } });",
      "await tx.payment.findMany({ where: { status: { in: ['SUCCESSFUL'] } }, select: { amount: true } });",
      "// rows.filter((p) => p.status === 'SUCCESSFUL')",
      "/* this.prisma.client.payment.aggregate({ where: { status: 'SUCCESSFUL' }, _sum: { amount: true } }) */",
      "const d = rows.filter((p) => p.status === 'FAILED');",
      "await this.prisma.client.payment.findMany({ where: { status: 'SUCCESSFUL' }, select: { createdAt: true } });",
      "if (p.status === 'SUCCESSFUL') entries.push(p);",
      'const e = inv.payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);',
      'const f = (invoice?.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);',
      'const g = inv.payments',
      "  .filter((p) => p.status === 'SUCCESSFUL')",
      '  .reduce((s, p) => s + p.amount, 0);',
      'const h = successfulPayments.reduce((s, p) => s + p.amount, 0);',
      'const i = expenses.reduce((s, x) => s + x.amount, 0);',
      'const j = payments.reduce((n, p) => n + 1, 0);',
    ].join('\n');
    // 11: a status-blind sum of payment rows; 12: the same behind `?? []`; 13-15: the filter form,
    // counted once; 16: a named, already filtered list; 17: not payment rows; 18: not an amount.
    expect(scanSuccessfulOnlyReads('x.ts', src).map((r) => `${r.line}:${r.form}`)).toEqual([
      '1:filter', '2:filter', '3:filter', '4:prisma', '5:prisma', '11:reduce', '12:reduce', '14:filter',
    ]);
  });
});
