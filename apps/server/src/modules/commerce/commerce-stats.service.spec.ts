import { describe, expect, it } from 'vitest';
import { CommerceStatsService } from './commerce-stats.service';

/**
 * V1-37-DM-CURRENCY (CF-38, M23; owner ruling D-13: one currency per business,
 * defaulting to the business currency; TTD and USD supported).
 *
 * At the V1-36 head CommerceStatsService.getCommerceStats added every PAID
 * invoice's total into one `totalRevenue` whatever its currency: a TTD 100
 * invoice and a USD 250 invoice read as 350 of nothing. Outstanding, overdue,
 * this month's paid, the average, the status breakdown, the top products and
 * the revenue by month summed the same way, and the sums were float additions.
 *
 * Contract pinned here: every money figure is per currency, under
 * `byCurrency[<code>]`, always carrying TTD and USD (D-13) plus any other
 * currency a stored row holds (its own bucket, never folded in). The top-level
 * money fields (what the cockpit and billing cards read) are the business
 * currency's bucket, named by `currency`; no figure anywhere adds two
 * currencies. Sums are cents-safe (sumMoney).
 *
 * The Prisma stub below answers the reads from an in-memory table and honours
 * their where/by/orderBy/take, so the service is free to shape its queries.
 */

type Inv = {
  id: string;
  businessId: string;
  currency: string;
  status: string;
  total: number;
  paidAt: Date | null;
  dueDate: Date | null;
  deletedAt: Date | null;
  items: Array<{ description: string; total: number }>;
};

const now = new Date();
const thisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 2), 12);
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
const future = new Date(Date.now() + 10 * 24 * 3600 * 1000);

function inv(id: string, currency: string, status: string, total: number, extra: Partial<Inv> = {}): Inv {
  return {
    id,
    businessId: 'biz',
    currency,
    status,
    total,
    paidAt: status === 'PAID' ? thisMonth : null,
    dueDate: null,
    deletedAt: null,
    items: [{ description: `${id} item`, total }],
    ...extra,
  };
}

function matches(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'invoice') {
      if (!matches(row.__invoice, cond)) return false;
      continue;
    }
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as any;
      if ('in' in c && !c.in.includes(v)) return false;
      if ('notIn' in c && c.notIn.includes(v)) return false;
      if ('gte' in c && !(v && v >= c.gte)) return false;
      if ('gt' in c && !(v && v > c.gt)) return false;
      if ('lt' in c && !(v && v < c.lt)) return false;
      if ('lte' in c && !(v && v <= c.lte)) return false;
      if ('not' in c && v === c.not) return false;
      if ('equals' in c && v !== c.equals) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

function pick(row: any, select: any) {
  if (!select) return { ...row };
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

function groupBy(rows: any[], args: any) {
  const by: string[] = args.by;
  const groups = new Map<string, any[]>();
  for (const r of rows.filter((x) => matches(x, args.where))) {
    const key = JSON.stringify(by.map((b) => r[b]));
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  let out = [...groups.values()].map((g) => {
    const o: any = {};
    for (const b of by) o[b] = g[0][b];
    if (args._count) o._count = Object.fromEntries(Object.keys(args._count).map((k) => [k, g.length]));
    if (args._sum) o._sum = Object.fromEntries(Object.keys(args._sum).map((k) => [k, g.reduce((s, x) => s + Number(x[k] ?? 0), 0)]));
    return o;
  });
  const order = args.orderBy?._sum?.total;
  if (order) out = out.sort((a, b) => (order === 'desc' ? b._sum.total - a._sum.total : a._sum.total - b._sum.total));
  if (args.take) out = out.slice(0, args.take);
  return out;
}

function makePrisma(invoices: Inv[], businessCurrency: string) {
  const items = invoices.flatMap((i) => i.items.map((it) => ({ ...it, invoiceId: i.id, __invoice: i })));
  const client = {
    business: {
      findUnique: async (args: any) => (args.where.id === 'biz' ? pick({ id: 'biz', currency: businessCurrency }, args.select) : null),
      findFirst: async (args: any) => (matches({ id: 'biz', currency: businessCurrency }, args.where) ? pick({ id: 'biz', currency: businessCurrency }, args.select) : null),
    },
    product: { count: async () => 3 },
    quote: {
      count: async () => 2,
      groupBy: async () => [
        { status: 'ACCEPTED', _count: { id: 1 } },
        { status: 'SENT', _count: { id: 1 } },
      ],
    },
    invoice: {
      count: async (args: any) => invoices.filter((r) => matches(r, args?.where)).length,
      findMany: async (args: any) => invoices.filter((r) => matches(r, args?.where)).map((r) => pick(r, args?.select)),
      groupBy: async (args: any) => groupBy(invoices, args),
    },
    invoiceItem: {
      groupBy: async (args: any) => groupBy(items, args),
    },
    $queryRaw: async () => [1],
  };
  return { client } as any;
}

/** Every number reachable from `value`, with its path. */
function numbersIn(value: any, path = '$'): Array<[string, number]> {
  if (typeof value === 'number') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => numbersIn(v, `${path}.${k}`));
  return [];
}

// A TTD business: TTD 100 + 0.1 + 0.2 paid (cents: 100.30), USD 250 paid,
// TTD 40 outstanding (SENT, not yet due), USD 60 overdue, TTD 15 paid last month.
const MIXED: Inv[] = [
  inv('t1', 'TTD', 'PAID', 100, { items: [{ description: 'Haircut', total: 100 }] }),
  inv('t2', 'TTD', 'PAID', 0.1, { items: [{ description: 'Tip', total: 0.1 }] }),
  inv('t3', 'TTD', 'PAID', 0.2, { items: [{ description: 'Tip', total: 0.2 }] }),
  inv('u1', 'USD', 'PAID', 250, { items: [{ description: 'Colour', total: 250 }] }),
  inv('t4', 'TTD', 'SENT', 40, { dueDate: future }),
  inv('u2', 'USD', 'OVERDUE', 60, { dueDate: past }),
  inv('t5', 'TTD', 'PAID', 15, { paidAt: lastMonth, items: [{ description: 'Haircut', total: 15 }] }),
];

async function statsOf(invoices: Inv[], businessCurrency = 'TTD') {
  const svc = new CommerceStatsService({ client: makePrisma(invoices, businessCurrency).client } as any);
  return (await svc.getCommerceStats('biz')) as any;
}

describe('V1-37 CommerceStatsService: per-currency figures, never a heterogeneous sum (CF-38)', () => {
  it('CS-01 RED-BEFORE: TTD and USD PAID invoices are never summed into one figure; byCurrency {TTD, USD}', async () => {
    const s = await statsOf(MIXED);
    expect(s.byCurrency, 'byCurrency').toBeDefined();
    expect(Object.keys(s.byCurrency).sort()).toEqual(['TTD', 'USD']);
    expect(s.byCurrency.TTD.totalRevenue).toBe(115.3);
    expect(s.byCurrency.USD.totalRevenue).toBe(250);
    // No figure anywhere is a TTD + USD sum: revenue 365.30 (also the PAID
    // status total), this month 350.30, outstanding 100.00 (compared in cents).
    const combined = [36530, 35030, 10000];
    for (const [where, n] of numbersIn(s)) {
      if (where.endsWith('Count') || where.endsWith('.count') || where.endsWith('Rate') || where.includes('quoteStatusBreakdown')) continue;
      expect(combined.includes(Math.round(n * 100)), `${where} = ${n} adds two currencies`).toBe(false);
    }
  });

  it('CS-02: the top-level money fields are the business currency bucket, named by `currency`', async () => {
    const s = await statsOf(MIXED, 'TTD');
    expect(s.currency).toBe('TTD');
    expect(s.totalRevenue).toBe(s.byCurrency.TTD.totalRevenue);
    expect(s.outstandingAmount).toBe(s.byCurrency.TTD.outstandingAmount);
    expect(s.overdueAmount).toBe(s.byCurrency.TTD.overdueAmount);
    expect(s.monthlyPaid).toBe(s.byCurrency.TTD.monthlyPaid);
    expect(s.averageInvoiceValue).toBe(s.byCurrency.TTD.averageInvoiceValue);
    expect(s.invoiceStatusBreakdown).toEqual(s.byCurrency.TTD.invoiceStatusBreakdown);
    expect(s.topProducts).toEqual(s.byCurrency.TTD.topProducts);
    expect(s.revenueByMonth).toEqual(s.byCurrency.TTD.revenueByMonth);

    const u = await statsOf(MIXED, 'USD');
    expect(u.currency).toBe('USD');
    expect(u.totalRevenue).toBe(250);
    expect(u.overdueAmount).toBe(60);
    expect(u.outstandingAmount).toBe(60);
  });

  it('CS-03: outstanding, overdue, this month, average and counts per currency (cents-safe)', async () => {
    const { byCurrency: b } = await statsOf(MIXED);
    expect(b.TTD).toMatchObject({ totalRevenue: 115.3, outstandingAmount: 40, overdueAmount: 0, monthlyPaid: 100.3, paidInvoiceCount: 4, invoiceCount: 5 });
    expect(b.TTD.averageInvoiceValue).toBe(28.83); // 115.30 / 4, to the cent
    expect(b.USD).toMatchObject({ totalRevenue: 250, outstandingAmount: 60, overdueAmount: 60, monthlyPaid: 250, paidInvoiceCount: 1, invoiceCount: 2, averageInvoiceValue: 250 });
  });

  it('CS-04: status breakdown, top products and revenue by month are per currency', async () => {
    const { byCurrency: b } = await statsOf(MIXED);
    expect(b.TTD.invoiceStatusBreakdown).toEqual({ PAID: { count: 4, total: 115.3 }, SENT: { count: 1, total: 40 } });
    expect(b.USD.invoiceStatusBreakdown).toEqual({ PAID: { count: 1, total: 250 }, OVERDUE: { count: 1, total: 60 } });
    expect(b.TTD.topProducts).toEqual([
      { name: 'Haircut', revenue: 115, count: 2 },
      { name: 'Tip', revenue: 0.3, count: 2 },
    ]);
    expect(b.USD.topProducts).toEqual([{ name: 'Colour', revenue: 250, count: 1 }]);
    expect(b.TTD.revenueByMonth).toHaveLength(6);
    expect(b.USD.revenueByMonth).toHaveLength(6);
    expect(b.TTD.revenueByMonth[5]).toMatchObject({ revenue: 100.3, invoiceCount: 3 });
    expect(b.TTD.revenueByMonth[4]).toMatchObject({ revenue: 15, invoiceCount: 1 });
    expect(b.USD.revenueByMonth[5]).toMatchObject({ revenue: 250, invoiceCount: 1 });
    expect(b.USD.revenueByMonth[4]).toMatchObject({ revenue: 0, invoiceCount: 0 });
  });

  it('CS-05: TTD and USD are always present (zero); a stored legacy currency gets its own bucket, never folded in', async () => {
    const empty = await statsOf([]);
    expect(Object.keys(empty.byCurrency).sort()).toEqual(['TTD', 'USD']);
    expect(empty.byCurrency.USD).toMatchObject({ totalRevenue: 0, outstandingAmount: 0, overdueAmount: 0, monthlyPaid: 0, averageInvoiceValue: 0 });
    expect(empty.totalRevenue).toBe(0);

    const legacy = await statsOf([...MIXED, inv('e1', 'EUR', 'PAID', 70, { items: [{ description: 'Euro job', total: 70 }] })]);
    expect(Object.keys(legacy.byCurrency).sort()).toEqual(['EUR', 'TTD', 'USD']);
    expect(legacy.byCurrency.EUR.totalRevenue).toBe(70);
    expect(legacy.byCurrency.TTD.totalRevenue).toBe(115.3);
    expect(legacy.byCurrency.USD.totalRevenue).toBe(250);
  });

  it('CS-06: counts that are not money stay whole-business (invoiceCount, quotes, products, conversion)', async () => {
    const s = await statsOf(MIXED);
    expect(s.invoiceCount).toBe(7);
    expect(s.quoteCount).toBe(2);
    expect(s.productCount).toBe(3);
    expect(s.quoteConversionRate).toBe(50);
  });
});
