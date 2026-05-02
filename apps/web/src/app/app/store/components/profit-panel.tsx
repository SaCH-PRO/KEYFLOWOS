"use client";

import { useState } from "react";
import { motion } from "framer-motion";
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

const DEMO_SUMMARY: ProfitSummary = {
  totalRevenue: 4250.00,
  totalCost: 1487.50,
  grossProfit: 2762.50,
  grossMargin: 65.0,
  netRevenue: 3925.00,
  totalDiscounts: 225.00,
  totalRefunds: 100.00,
};

const DEMO_PRODUCTS: ProfitProduct[] = [
  { id: "p1", name: "Deep Tissue Massage", unitsSold: 12, revenue: 1440.00, cost: 360.00, profit: 1080.00, margin: 75.0 },
  { id: "p2", name: "Essential Oil Set", unitsSold: 8, revenue: 719.92, cost: 320.00, profit: 399.92, margin: 55.5 },
  { id: "p3", name: "Full Body Treatment", unitsSold: 5, revenue: 1250.00, cost: 375.00, profit: 875.00, margin: 70.0 },
  { id: "p4", name: "Facial Treatment", unitsSold: 6, revenue: 600.00, cost: 240.00, profit: 360.00, margin: 60.0 },
  { id: "p5", name: "Recovery Balm", unitsSold: 15, revenue: 600.00, cost: 150.00, profit: 450.00, margin: 75.0 },
  { id: "p6", name: "Face Mask Pack", unitsSold: 4, revenue: 200.00, cost: 80.00, profit: 120.00, margin: 60.0 },
];

function seedRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
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

function generateTrendData(days: number, seed: number): DailyProfit[] {
  const rng = seedRandom(seed);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date("2026-04-05");
    d.setDate(d.getDate() - (days - 1 - i));
    const revenue = Math.round(80 + rng() * 200);
    const profit = Math.round(revenue * (0.5 + rng() * 0.25));
    return { date: d.toISOString().split("T")[0], revenue, profit };
  });
}

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

const TREND_DATA_30 = generateTrendData(30, 42);
const TREND_DATA_90 = generateTrendData(90, 99);

function TrendChart({ period, mode }: { period: TrendPeriod; mode: TrendMode }) {
  const rawData = period === "30d" ? TREND_DATA_30 : TREND_DATA_90;
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
  const summary = DEMO_SUMMARY;
  const products = [...DEMO_PRODUCTS].sort((a, b) => b[sortBy] - a[sortBy]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <ProfitCard label="Revenue" value={`$${summary.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} color="var(--kf-accent1)" icon={DollarSign} trend={8.5} />
        <ProfitCard label="Cost of Goods" value={`$${summary.totalCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} sub="This month" color="var(--kf-warning)" icon={Package} />
        <ProfitCard label="Gross Profit" value={`$${summary.grossProfit.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} color="var(--kf-success)" icon={TrendingUp} trend={12.3} />
        <ProfitCard label="Gross Margin" value={`${summary.grossMargin.toFixed(1)}%`} sub="Target: 60%" color="var(--kf-info)" icon={TrendingUp} />
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
        <TrendChart period={trendPeriod} mode={trendMode} />
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
