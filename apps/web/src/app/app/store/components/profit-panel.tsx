"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchStoreOrders, fetchMarginAnalysis, type StoreOrder } from "@/lib/api/store";
import {
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Package,
} from "lucide-react";

interface ProfitProduct {
  id: string;
  name: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

interface ProfitSummary {
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  netRevenue: number;
  totalDiscounts: number;
  totalRefunds: number;
}

interface DailyProfit {
  date: string;
  revenue: number;
  profit: number;
}

/**
 * Profit is derived, not stored.
 *
 * Revenue and units come from the order items; unit cost comes from the margin
 * analysis (commerce-insights.controller.ts:45), which is the same landed-cost
 * engine the Commerce screens use — so this panel and the margin report cannot
 * disagree. Everything below replaces DEMO_SUMMARY, DEMO_PRODUCTS and a
 * seeded-random trend series.
 *
 * Orders that were cancelled or refunded are excluded from revenue and counted
 * separately, because a refunded sale is not profit.
 */
const EXCLUDED_FROM_REVENUE = new Set(["cancelled", "refunded"]);

function isRefunded(o: StoreOrder) {
  return (o.status ?? "").toLowerCase() === "refunded";
}

function isCounted(o: StoreOrder) {
  return !EXCLUDED_FROM_REVENUE.has((o.status ?? "").toLowerCase());
}

function buildProducts(orders: StoreOrder[], costByProduct: Map<string, number>): ProfitProduct[] {
  const acc = new Map<string, ProfitProduct>();

  for (const order of orders) {
    if (!isCounted(order)) continue;

    for (const item of order.items ?? []) {
      const unitCost = costByProduct.get(item.productId) ?? 0;
      const existing = acc.get(item.productId);
      const revenue = item.total;
      const cost = unitCost * item.quantity;

      if (existing) {
        existing.unitsSold += item.quantity;
        existing.revenue += revenue;
        existing.cost += cost;
      } else {
        acc.set(item.productId, {
          id: item.productId,
          name: item.name,
          unitsSold: item.quantity,
          revenue,
          cost,
          profit: 0,
          margin: 0,
        });
      }
    }
  }

  for (const p of acc.values()) {
    p.profit = p.revenue - p.cost;
    p.margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
  }

  return [...acc.values()];
}

function buildSummary(orders: StoreOrder[], products: ProfitProduct[]): ProfitSummary {
  const counted = orders.filter(isCounted);

  const totalRevenue = counted.reduce((s, o) => s + o.total, 0);
  const totalCost = products.reduce((s, p) => s + p.cost, 0);
  const totalDiscounts = counted.reduce((s, o) => s + (o.discountAmount ?? 0), 0);
  const totalRefunds = orders.filter(isRefunded).reduce((s, o) => s + o.total, 0);
  const grossProfit = totalRevenue - totalCost;

  return {
    totalRevenue,
    totalCost,
    grossProfit,
    grossMargin: totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0,
    netRevenue: totalRevenue - totalDiscounts - totalRefunds,
    totalDiscounts,
    totalRefunds,
  };
}

/** One bucket per day in the window, so gaps render as gaps rather than closing up. */
function buildTrend(
  orders: StoreOrder[],
  costByProduct: Map<string, number>,
  days: number,
  now: Date,
): DailyProfit[] {
  const buckets = new Map<string, DailyProfit>();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    buckets.set(key, { date: key, revenue: 0, profit: 0 });
  }

  for (const order of orders) {
    if (!isCounted(order)) continue;
    const key = (order.createdAt ?? "").split("T")[0];
    const bucket = buckets.get(key);
    if (!bucket) continue;

    const cost = (order.items ?? []).reduce(
      (s, i) => s + (costByProduct.get(i.productId) ?? 0) * i.quantity,
      0,
    );
    bucket.revenue += order.total;
    bucket.profit += order.total - cost;
  }

  return [...buckets.values()];
}


function ProfitCard({ label, value, sub, color, icon: Icon, trend }: {
  label: string; value: string; sub?: string; color: string; icon: React.ElementType; trend?: number;
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `hsl(${color} / 0.1)` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: `hsl(${color})` }} />
        </div>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          {trend >= 0 ? (
            <ArrowUpRight className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
          ) : (
            <ArrowDownRight className="w-3 h-3" style={{ color: "hsl(var(--kf-error))" }} />
          )}
          <span className="text-[10px] font-semibold" style={{ color: trend >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>
            {trend >= 0 ? "+" : ""}{trend.toFixed(1)}% vs last month
          </span>
        </div>
      )}
    </div>
  );
}

type TrendPeriod = "30d" | "90d";
type TrendMode = "daily" | "weekly";

function aggregateWeekly(data: DailyProfit[]): DailyProfit[] {
  const weeks: DailyProfit[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const chunk = data.slice(i, i + 7);
    weeks.push({
      date: chunk[0].date,
      revenue: chunk.reduce((s, d) => s + d.revenue, 0),
      profit: chunk.reduce((s, d) => s + d.profit, 0),
    });
  }
  return weeks;
}

function TrendChart({ rawData, mode }: { rawData: DailyProfit[]; mode: TrendMode }) {
  const data = mode === "weekly" ? aggregateWeekly(rawData) : rawData;
  const maxRev = Math.max(...data.map((d) => d.revenue), 1);

  return (
    <div className="space-y-3">
      <div className="h-32 flex items-end gap-px">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-px" title={`${d.date}: Revenue $${d.revenue}, Profit $${d.profit}`}>
            <div className="w-full rounded-t-sm" style={{ height: `${(d.revenue / maxRev) * 100}%`, background: "hsl(var(--kf-accent1)/0.3)", minHeight: "2px" }} />
            <div className="w-full rounded-t-sm" style={{ height: `${(d.profit / maxRev) * 100}%`, background: "hsl(var(--kf-success)/0.6)", minHeight: "1px" }} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--kf-accent1)/0.3)" }} />
          <span className="text-[10px] text-muted-foreground">Revenue</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--kf-success)/0.6)" }} />
          <span className="text-[10px] text-muted-foreground">Profit</span>
        </div>
      </div>
    </div>
  );
}

export function ProfitPanel() {
  const [sortBy, setSortBy] = useState<"revenue" | "profit" | "margin">("profit");
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("30d");
  const [trendMode, setTrendMode] = useState<TrendMode>("daily");
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [costByProduct, setCostByProduct] = useState<Map<string, number>>(new Map());
  const [productsMissingCost, setProductsMissingCost] = useState(0);
  const [loading, setLoading] = useState(true);

  const businessId = getStoredBusinessId() ?? "";

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!businessId) {
        setLoading(false);
        return;
      }

      const [orderRes, marginRes] = await Promise.all([
        fetchStoreOrders(businessId, { pageSize: 100 }),
        fetchMarginAnalysis(businessId),
      ]);
      if (cancelled) return;

      if (orderRes.error) toast.error(orderRes.error);
      // A missing margin report degrades cost to zero rather than blanking the
      // panel; the "no cost data" notice below is what keeps that honest.
      if (marginRes.error) toast.error(marginRes.error);

      const costs = new Map<string, number>();
      for (const p of marginRes.data?.products ?? []) {
        costs.set(p.productId, p.landedCost);
      }

      setOrders(orderRes.data?.data ?? []);
      setCostByProduct(costs);
      setProductsMissingCost(
        Math.max((marginRes.data?.totalProducts ?? 0) - (marginRes.data?.productsWithCostData ?? 0), 0),
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const products = useMemo(
    () => buildProducts(orders, costByProduct).sort((a, b) => b[sortBy] - a[sortBy]),
    [orders, costByProduct, sortBy],
  );

  const summary = useMemo(
    () => buildSummary(orders, buildProducts(orders, costByProduct)),
    [orders, costByProduct],
  );

  const trendData = useMemo(
    () => buildTrend(orders, costByProduct, trendPeriod === "30d" ? 30 : 90, new Date()),
    [orders, costByProduct, trendPeriod],
  );

  if (loading) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <p className="text-sm text-muted-foreground">Loading profitability…</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {productsMissingCost > 0 && (
        // Without a cost profile, landed cost reads as 0 and the product shows a
        // 100% margin. Saying so is the difference between a gap and a lie.
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {productsMissingCost} product{productsMissingCost === 1 ? " has" : "s have"} no cost
            profile, so their cost counts as $0 and their margin reads high. Set costs in Commerce
            to make these figures exact.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {/* trend={8.5} and trend={12.3} were hardcoded period-over-period deltas.
            Computing them needs a prior-period comparison this panel does not
            fetch, so the arrows are gone rather than invented. */}
        <ProfitCard label="Revenue" value={`$${summary.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} color="var(--kf-accent1)" icon={DollarSign} />
        <ProfitCard label="Cost of Goods" value={`$${summary.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} color="var(--kf-warning)" icon={Package} />
        <ProfitCard label="Gross Profit" value={`$${summary.grossProfit.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} color="var(--kf-success)" icon={TrendingUp} />
        <ProfitCard label="Gross Margin" value={`${summary.grossMargin.toFixed(1)}%`} color="var(--kf-info)" icon={TrendingUp} />
        <ProfitCard label="Net Revenue" value={`$${summary.netRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} sub={`-$${summary.totalDiscounts.toFixed(2)} discounts, -$${summary.totalRefunds.toFixed(2)} refunds`} color="var(--kf-success)" icon={DollarSign} />
      </div>

      <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">Revenue & Profit Trend</h3>
          <div className="flex items-center gap-1">
            {(["30d", "90d"] as const).map((p) => (
              <button key={p} onClick={() => setTrendPeriod(p)} aria-pressed={trendPeriod === p} className="px-2 py-1 rounded-md text-[10px] font-medium transition-colors" style={{ background: trendPeriod === p ? "hsl(var(--kf-accent1)/0.1)" : "transparent", color: trendPeriod === p ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))" }}>
                {p === "30d" ? "30 days" : "90 days"}
              </button>
            ))}
            <span className="w-px h-4 mx-0.5" style={{ background: "hsl(var(--kf-border)/0.3)" }} />
            {(["daily", "weekly"] as const).map((m) => (
              <button key={m} onClick={() => setTrendMode(m)} aria-pressed={trendMode === m} className="px-2 py-1 rounded-md text-[10px] font-medium transition-colors" style={{ background: trendMode === m ? "hsl(var(--kf-accent1)/0.1)" : "transparent", color: trendMode === m ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))" }}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <TrendChart rawData={trendData} mode={trendMode} />
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <div className="p-4 flex items-center justify-between">
          <h3 className="text-xs font-semibold">Per-Product Profitability</h3>
          <div className="flex items-center gap-1">
            {(["revenue", "profit", "margin"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                aria-pressed={sortBy === key}
                className="px-2 py-1 rounded-md text-[10px] font-medium transition-colors"
                style={{
                  background: sortBy === key ? "hsl(var(--kf-accent1)/0.1)" : "transparent",
                  color: sortBy === key ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                }}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderTop: "1px solid hsl(var(--kf-border)/0.3)" }}>
                <th className="text-left px-4 py-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Product</th>
                <th className="text-right px-4 py-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Sold</th>
                <th className="text-right px-4 py-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Revenue</th>
                <th className="text-right px-4 py-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Cost</th>
                <th className="text-right px-4 py-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Profit</th>
                <th className="text-right px-4 py-2.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Margin</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="transition-colors hover:bg-[hsl(var(--kf-muted)/0.06)]"
                  style={{ borderTop: "1px solid hsl(var(--kf-border)/0.15)" }}
                >
                  <td className="px-4 py-2.5 font-medium">{p.name}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{p.unitsSold}</td>
                  <td className="px-4 py-2.5 text-right">${p.revenue.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">${p.cost.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold" style={{ color: "hsl(var(--kf-success))" }}>${p.profit.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: p.margin >= 60 ? "hsl(var(--kf-success)/0.1)" : "hsl(var(--kf-warning)/0.1)", color: p.margin >= 60 ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }}>
                      {p.margin.toFixed(1)}%
                    </span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
