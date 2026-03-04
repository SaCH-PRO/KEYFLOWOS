"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, DollarSign, Clock, TrendingUp, AlertTriangle,
  CheckCircle2, ArrowRight, RefreshCw, Calendar, ChevronDown,
  FileText, CreditCard, Package, ArrowUpRight, ArrowDownRight,
  Zap, Target,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchCommerceStats, commerceAiCashFlow,
  type CommerceStats, type CommerceCashFlowForecast,
  type Invoice, type Quote,
} from "@/lib/client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";

type Period = "7d" | "30d" | "90d" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "all": "All Time",
};

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } } },
};

const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border)/0.5)",
    borderRadius: "0.75rem",
    color: "hsl(var(--foreground))",
    fontSize: "11px",
    padding: "6px 10px",
  },
  cursor: { fill: "hsl(var(--border)/0.1)" },
};

function InsightsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading commerce insights">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-3.5">
            <Skeleton className="h-3 w-14 mb-2" />
            <Skeleton className="h-7 w-16 mb-1.5" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <div className="lg:col-span-3 rounded-xl border border-border/50 bg-card p-3.5 space-y-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-6 w-full rounded-md" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 rounded-xl border border-border/50 bg-card p-3.5 space-y-2.5">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, color, width = 44, height = 18 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(" ");
  const areaPath = `M0,${height} L${points.split(" ").map((p, i) => (i === 0 ? p.split(",").join(",") : p)).join(" L")} L${width},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-commerce-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-commerce-${color.replace(/[^a-z0-9]/gi, "")})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r="2" fill={color} />
    </svg>
  );
}

const HeroStats = React.memo(function HeroStats({
  stats, currency,
}: {
  stats: CommerceStats;
  currency: string;
}) {
  const revenueByMonth = stats.revenueByMonth ?? [];
  const sparkData = revenueByMonth.map((m) => m.revenue);
  const prevMonthRevenue = revenueByMonth.length >= 2 ? revenueByMonth[revenueByMonth.length - 2].revenue : 0;
  const curMonthRevenue = revenueByMonth.length >= 1 ? revenueByMonth[revenueByMonth.length - 1].revenue : 0;
  const revenueTrend = prevMonthRevenue > 0 ? ((curMonthRevenue - prevMonthRevenue) / prevMonthRevenue * 100).toFixed(0) : null;

  const cards = [
    {
      label: "Total Revenue",
      mobileLabel: "Revenue",
      value: formatCurrencyCompact(stats.totalRevenue, currency),
      sub: `${stats.invoiceCount} invoices`,
      icon: DollarSign,
      accentVar: "--kf-accent1",
      sparkColor: "hsl(142 76% 36%)",
      trend: revenueTrend && Number(revenueTrend) !== 0 ? (Number(revenueTrend) > 0 ? "up" as const : "down" as const) : null,
      trendLabel: revenueTrend ? `${Number(revenueTrend) > 0 ? "+" : ""}${revenueTrend}% vs last month` : undefined,
    },
    {
      label: "Outstanding",
      mobileLabel: "Owed",
      value: formatCurrencyCompact(stats.outstandingAmount, currency),
      sub: `${stats.overdueAmount > 0 ? formatCurrencyCompact(stats.overdueAmount, currency) + " overdue" : "No overdue"}`,
      icon: Clock,
      accentVar: "--kf-accent2",
      sparkColor: "#f59e0b",
      trend: stats.overdueAmount > 0 ? "down" as const : null,
      trendLabel: stats.overdueAmount > 0 ? `${formatCurrencyCompact(stats.overdueAmount, currency)} overdue` : undefined,
    },
    {
      label: "Avg Invoice",
      mobileLabel: "Avg",
      value: formatCurrencyCompact(stats.averageInvoiceValue, currency),
      sub: `${stats.invoiceCount} total`,
      icon: FileText,
      accentVar: "--kf-accent1",
      sparkColor: "hsl(var(--kf-accent1))",
      trend: null,
      trendLabel: undefined,
    },
    {
      label: "Quote Conversion",
      mobileLabel: "Convert",
      value: `${stats.quoteConversionRate}%`,
      sub: `${stats.quoteCount} quotes`,
      icon: TrendingUp,
      accentVar: "--kf-accent2",
      sparkColor: "hsl(var(--kf-accent2))",
      trend: stats.quoteConversionRate >= 50 ? "up" as const : null,
      trendLabel: stats.quoteConversionRate >= 50 ? "Strong conversion" : undefined,
    },
  ];

  return (
    <motion.div variants={stagger.container} initial="hidden" animate="visible" className="grid grid-cols-4 gap-1.5 sm:gap-2.5">
      {cards.map((s) => {
        const Icon = s.icon;
        return (
          <motion.div
            key={s.label}
            variants={stagger.item}
            className="relative overflow-hidden rounded-xl border border-border/50 bg-card p-2 sm:p-3 group hover:border-border/80 transition-all duration-200 text-left"
          >
            <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.04] -translate-y-1/2 translate-x-1/2 blur-xl" style={{ background: `hsl(var(${s.accentVar}))` }} aria-hidden="true" />
            <div className="flex items-center gap-1 mb-1 sm:mb-1.5">
              <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider leading-tight sm:hidden">{s.mobileLabel}</span>
              <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider leading-tight hidden sm:inline">{s.label}</span>
            </div>
            <div className="hidden sm:flex items-center justify-end mb-1">
              <div className="opacity-50 group-hover:opacity-100 transition-opacity">
                <Sparkline data={sparkData.length >= 2 ? sparkData : [0, 0]} color={s.sparkColor} />
              </div>
            </div>
            <div className="text-sm sm:text-xl font-bold tracking-tight leading-tight" style={{ color: `hsl(var(${s.accentVar}))` }}>
              {s.value}
            </div>
            <div className="hidden sm:flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground/50">{s.sub}</span>
            </div>
            {s.trend && s.trendLabel && (
              <div className={`items-center gap-0.5 mt-1 text-[10px] font-semibold hidden sm:flex ${s.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                {s.trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {s.trendLabel}
              </div>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
});

const RevenueTrendChart = React.memo(function RevenueTrendChart({
  revenueByMonth, currency,
}: {
  revenueByMonth: { month: string; revenue: number; invoiceCount: number }[];
  currency: string;
}) {
  if (revenueByMonth.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <BarChart3 className="w-6 h-6 text-muted-foreground/30 mb-2" />
        <p className="text-[10px] text-muted-foreground/50">Revenue data will appear as invoices are paid</p>
      </div>
    );
  }

  const data = revenueByMonth.map((m) => ({
    month: m.month,
    revenue: m.revenue,
    invoices: m.invoiceCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(142 76% 36%)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="hsl(142 76% 36%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrencyCompact(v, currency)} width={60} />
        <Tooltip
          contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
          cursor={RECHARTS_TOOLTIP_STYLE.cursor}
          formatter={(value: number | undefined) => [formatCurrency(value ?? 0, currency), "Revenue"]}
        />
        <Area type="monotone" dataKey="revenue" stroke="hsl(142 76% 36%)" fill="url(#revenueGradient)" strokeWidth={2} dot={{ r: 3, fill: "hsl(142 76% 36%)" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

const InvoiceStatusBreakdown = React.memo(function InvoiceStatusBreakdown({
  breakdown, currency,
}: {
  breakdown: Record<string, { count: number; total: number }>;
  currency: string;
}) {
  const statuses = ["DRAFT", "SENT", "PAID", "OVERDUE"] as const;
  const statusColors: Record<string, string> = {
    DRAFT: "#94a3b8",
    SENT: "#3b82f6",
    PAID: "#10b981",
    OVERDUE: "#ef4444",
  };
  const totalAmount = statuses.reduce((sum, s) => sum + (breakdown[s]?.total ?? 0), 0);

  return (
    <div className="space-y-3">
      {totalAmount > 0 && (
        <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.03] border border-border/30">
          {statuses.map((s) => {
            const pct = totalAmount > 0 ? ((breakdown[s]?.total ?? 0) / totalAmount) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={s}
                className="transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: statusColors[s], opacity: 0.8 }}
                title={`${s}: ${formatCurrency(breakdown[s]?.total ?? 0, currency)} (${pct.toFixed(0)}%)`}
              />
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {statuses.map((s) => {
          const entry = breakdown[s];
          if (!entry || entry.count === 0) return null;
          return (
            <div key={s} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.02]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColors[s] }} />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-foreground/80">{s}</div>
                <div className="text-[10px] text-muted-foreground/50">{entry.count} &middot; {formatCurrencyCompact(entry.total, currency)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const QuoteFunnel = React.memo(function QuoteFunnel({
  breakdown,
}: {
  breakdown: Record<string, number>;
}) {
  const stages = [
    { key: "DRAFT", label: "Draft", color: "#94a3b8" },
    { key: "SENT", label: "Sent", color: "#3b82f6" },
    { key: "ACCEPTED", label: "Accepted", color: "#10b981" },
  ] as const;
  const maxCount = Math.max(...stages.map((s) => breakdown[s.key] ?? 0), 1);

  return (
    <div className="space-y-2">
      {stages.map((s, idx) => {
        const count = breakdown[s.key] ?? 0;
        const pct = (count / maxCount) * 100;
        return (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                {idx > 0 && <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/30" />}
                <span className="text-[10px] font-medium text-foreground/70">{s.label}</span>
              </div>
              <span className="text-[10px] font-bold" style={{ color: s.color }}>{count}</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.03] border border-border/20 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, delay: idx * 0.15 }}
                className="h-full rounded-full"
                style={{ backgroundColor: s.color, opacity: 0.7 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

const TopProductsChart = React.memo(function TopProductsChart({
  topProducts, currency,
}: {
  topProducts: { name: string; revenue: number; count: number }[];
  currency: string;
}) {
  if (topProducts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Package className="w-5 h-5 text-muted-foreground/30 mb-2" />
        <p className="text-[10px] text-muted-foreground/50">Product revenue data will appear with sales</p>
      </div>
    );
  }

  const data = topProducts.slice(0, 5);
  const colors = ["hsl(142 76% 36%)", "hsl(var(--kf-accent1))", "hsl(var(--kf-accent2))", "#f59e0b", "#3b82f6"];

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrencyCompact(v, currency)} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={80} />
        <Tooltip
          contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
          cursor={RECHARTS_TOOLTIP_STYLE.cursor}
          formatter={(value: number | undefined) => [formatCurrency(value ?? 0, currency), "Revenue"]}
        />
        <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={16}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={colors[idx % colors.length]} opacity={0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});

const CashFlowForecastWidget = React.memo(function CashFlowForecastWidget({
  forecast,
  currency,
}: {
  forecast: CommerceCashFlowForecast | null;
  currency: string;
}) {
  if (!forecast) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <TrendingUp className="w-5 h-5 text-muted-foreground/30 mb-2" />
        <p className="text-[10px] text-muted-foreground/50">Cash flow forecast loading...</p>
      </div>
    );
  }

  const periods = [
    { label: "30 Day", data: forecast.forecast.thirtyDay },
    { label: "60 Day", data: forecast.forecast.sixtyDay },
    { label: "90 Day", data: forecast.forecast.ninetyDay },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{forecast.summary}</p>
      <div className="grid grid-cols-3 gap-2">
        {periods.map((p) => (
          <div key={p.label} className="rounded-lg bg-white/[0.02] border border-border/20 p-2 text-center">
            <div className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wider mb-1">{p.label}</div>
            <div className="text-xs font-bold text-emerald-400">{p.data ? formatCurrencyCompact(p.data.expected, currency) : "—"}</div>
            {p.data && (
              <div className="text-[9px] text-muted-foreground/40 mt-0.5">
                {formatCurrencyCompact(p.data.conservative, currency)} – {formatCurrencyCompact(p.data.optimistic, currency)}
              </div>
            )}
          </div>
        ))}
      </div>
      {forecast.risks.length > 0 && (
        <div className="space-y-1">
          {forecast.risks.slice(0, 2).map((r, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px]">
              <AlertTriangle className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
              <span className="text-muted-foreground/60">{r.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function getDaysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

const RevenueRecoveryPlanner = React.memo(function RevenueRecoveryPlanner({
  invoices,
  currency,
}: {
  invoices: Invoice[];
  currency: string;
}) {
  const agedReceivables = useMemo(() => {
    const unpaid = invoices.filter((inv) => inv.status === "OVERDUE" || inv.status === "SENT");
    const buckets = { current: 0, thirtyDay: 0, sixtyDay: 0, ninetyPlus: 0 };
    let totalCollectible = 0;

    unpaid.forEach((inv) => {
      const amount = Number(inv.total);
      totalCollectible += amount;
      const days = getDaysOverdue(inv.dueDate);
      if (days <= 0) buckets.current += amount;
      else if (days <= 30) buckets.thirtyDay += amount;
      else if (days <= 60) buckets.sixtyDay += amount;
      else buckets.ninetyPlus += amount;
    });

    return { ...buckets, totalCollectible, count: unpaid.length };
  }, [invoices]);

  const maxBucket = Math.max(agedReceivables.current, agedReceivables.thirtyDay, agedReceivables.sixtyDay, agedReceivables.ninetyPlus, 1);

  const bars = [
    { label: "Current", amount: agedReceivables.current, color: "bg-emerald-500/60" },
    { label: "1-30 days", amount: agedReceivables.thirtyDay, color: "bg-amber-500/60" },
    { label: "31-60 days", amount: agedReceivables.sixtyDay, color: "bg-orange-500/60" },
    { label: "90+ days", amount: agedReceivables.ninetyPlus, color: "bg-red-500/60" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-lg font-bold">{formatCurrencyCompact(agedReceivables.totalCollectible, currency)}</span>
        <span className="text-[10px] text-muted-foreground/50">collectible across {agedReceivables.count} invoices</span>
      </div>
      <div className="space-y-2.5">
        {bars.map((bar) => {
          const pct = maxBucket > 0 ? (bar.amount / maxBucket) * 100 : 0;
          return (
            <div key={bar.label} className="flex items-center gap-2.5">
              <span className="text-[10px] text-muted-foreground/60 w-16 shrink-0">{bar.label}</span>
              <div className="flex-1 h-5 rounded-md bg-white/[0.03] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className={`h-full rounded-md ${bar.color} flex items-center justify-end pr-2`}
                >
                  {bar.amount > 0 && (
                    <span className="text-[10px] font-semibold text-white/80">{formatCurrencyCompact(bar.amount, currency)}</span>
                  )}
                </motion.div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const AlertCards = React.memo(function AlertCards({
  stats, invoices, quotes, currency,
}: {
  stats: CommerceStats;
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
}) {
  const alerts = useMemo(() => {
    const items: { key: string; priority: number; icon: React.ElementType; label: string; sub: string; variant: "success" | "danger" | "warning" }[] = [];
    const overdueCount = stats.invoiceStatusBreakdown?.OVERDUE?.count ?? 0;
    if (overdueCount > 0) {
      items.push({ key: "overdue", priority: 1, icon: AlertTriangle, label: `${overdueCount} overdue invoice${overdueCount !== 1 ? "s" : ""}`, sub: `${formatCurrencyCompact(stats.overdueAmount, currency)} outstanding`, variant: "danger" });
    }
    const expiringQuotes = quotes.filter((q) => {
      if (q.status !== "SENT" || !q.expiryDate) return false;
      const daysLeft = (new Date(q.expiryDate).getTime() - Date.now()) / 86_400_000;
      return daysLeft > 0 && daysLeft <= 7;
    });
    if (expiringQuotes.length > 0) {
      const total = expiringQuotes.reduce((s, q) => s + q.total, 0);
      items.push({ key: "expiring", priority: 2, icon: Clock, label: `${expiringQuotes.length} quote${expiringQuotes.length !== 1 ? "s" : ""} expiring soon`, sub: `${formatCurrencyCompact(total, currency)} at risk`, variant: "warning" });
    }
    const draftInvoices = stats.invoiceStatusBreakdown?.DRAFT?.count ?? 0;
    if (draftInvoices > 0) {
      items.push({ key: "drafts", priority: 3, icon: FileText, label: `${draftInvoices} draft invoice${draftInvoices !== 1 ? "s" : ""}`, sub: "Ready to send", variant: "warning" });
    }
    if (stats.quoteConversionRate >= 60) {
      items.push({ key: "conversion", priority: 4, icon: TrendingUp, label: `${stats.quoteConversionRate}% quote conversion`, sub: "Strong performance", variant: "success" });
    }
    return items.sort((a, b) => a.priority - b.priority);
  }, [stats, quotes, currency]);

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04]">
        <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /></div>
        <div><span className="text-xs text-emerald-400 font-semibold">All clear</span><p className="text-[10px] text-emerald-400/50">No action items</p></div>
      </div>
    );
  }

  const variantStyles = { success: "border-emerald-500/20 bg-emerald-500/[0.03]", danger: "border-red-500/20 bg-red-500/[0.03]", warning: "border-amber-500/20 bg-amber-500/[0.03]" };
  const iconStyles = { success: "bg-emerald-500/12 text-emerald-400", danger: "bg-red-500/12 text-red-400", warning: "bg-amber-500/12 text-amber-400" };

  return (
    <div className="space-y-1.5" role="group" aria-label="Commerce alerts">
      {alerts.map((a) => {
        const Icon = a.icon;
        return (
          <div key={a.key} className={`flex items-center gap-2.5 w-full p-2.5 rounded-lg border transition-all duration-200 text-left ${variantStyles[a.variant]}`}>
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${iconStyles[a.variant]}`}><Icon className="w-3.5 h-3.5" /></div>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-foreground">{a.label}</div><div className="text-[10px] text-muted-foreground/50">{a.sub}</div></div>
          </div>
        );
      })}
    </div>
  );
});

export interface CommerceInsightsTabProps {
  businessId: string | null;
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
  loading?: boolean;
}

function CommerceInsightsInner({
  businessId, invoices, quotes, currency, loading: parentLoading,
}: CommerceInsightsTabProps) {
  const [stats, setStats] = useState<CommerceStats | null>(null);
  const [cashFlow, setCashFlow] = useState<CommerceCashFlowForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>("30d");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [statsRes, cashFlowRes] = await Promise.all([
        fetchCommerceStats(businessId),
        commerceAiCashFlow(businessId),
      ]);
      if (statsRes.data) setStats(statsRes.data);
      if (cashFlowRes.data) setCashFlow(cashFlowRes.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setTimeout(() => setRefreshing(false), 500);
  }, [loadData]);

  const togglePeriodMenu = useCallback(() => setShowPeriodMenu((p) => !p), []);
  const closePeriodMenu = useCallback(() => setShowPeriodMenu(false), []);
  const handleSelectPeriod = useCallback((p: Period) => { setPeriod(p); setShowPeriodMenu(false); }, []);

  const filteredRevenueByMonth = useMemo(() => {
    if (!stats?.revenueByMonth) return [];
    if (period === "all") return stats.revenueByMonth;
    const monthsToShow = period === "7d" ? 1 : period === "30d" ? 3 : 6;
    return stats.revenueByMonth.slice(-monthsToShow);
  }, [stats, period]);

  if (loading || parentLoading) return <InsightsSkeleton />;

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 flex items-center justify-center mb-4 border border-border/30"><BarChart3 className="w-6 h-6 text-muted-foreground/50" /></div>
        <p className="text-sm font-semibold text-foreground/60 mb-1">No Insights Yet</p>
        <p className="text-xs text-muted-foreground/50 max-w-[240px] leading-relaxed">Create invoices and quotes to unlock commerce analytics.</p>
      </div>
    );
  }

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger.container} className="space-y-3">
      <motion.div variants={stagger.item} className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]" />
          <h2 className="text-sm font-semibold tracking-tight">Commerce Insights</h2>
          <span className="text-[10px] text-muted-foreground/50 font-medium">{stats.invoiceCount} invoices &middot; {stats.quoteCount} quotes</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] transition-colors disabled:opacity-50" aria-label="Refresh insights">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/50 ${refreshing ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Refresh</span>
          </button>
          <div className="relative">
            <button onClick={togglePeriodMenu} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] transition-colors" aria-haspopup="listbox" aria-expanded={showPeriodMenu}>
              <Calendar className="w-3.5 h-3.5 text-muted-foreground/50" />{PERIOD_LABELS[period]}<ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${showPeriodMenu ? "rotate-180" : ""}`} />
            </button>
            {showPeriodMenu && (<><div className="fixed inset-0 z-10" onClick={closePeriodMenu} /><div className="absolute right-0 top-full mt-1 z-20 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl py-1 min-w-[140px]" role="listbox">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (<button key={p} role="option" aria-selected={p === period} onClick={() => handleSelectPeriod(p)} className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/[0.05] transition-colors ${p === period ? "font-semibold text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`}>{PERIOD_LABELS[p]}</button>))}
            </div></>)}
          </div>
        </div>
      </motion.div>

      <HeroStats stats={stats} currency={currency} />

      <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
        <div className="lg:col-span-7 rounded-xl border border-border/50 bg-card p-3.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-2.5">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(142 76% 36%)" }} />Revenue Trend
          </h3>
          <RevenueTrendChart revenueByMonth={filteredRevenueByMonth} currency={currency} />
        </div>
        <div className="lg:col-span-5 rounded-xl border border-border/50 bg-card p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60" />Action Items
          </h3>
          <AlertCards stats={stats} invoices={invoices} quotes={quotes} currency={currency} />
        </div>
      </motion.div>

      <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
        <div className="lg:col-span-5 rounded-xl border border-border/50 bg-card p-3.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-2.5">
            <CreditCard className="w-3.5 h-3.5 text-blue-400/60" />Invoice Status
          </h3>
          <InvoiceStatusBreakdown breakdown={stats.invoiceStatusBreakdown ?? {}} currency={currency} />
        </div>
        <div className="lg:col-span-3 rounded-xl border border-border/50 bg-card p-3.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-2.5">
            <FileText className="w-3.5 h-3.5 text-emerald-400/60" />Quote Funnel
          </h3>
          <QuoteFunnel breakdown={stats.quoteStatusBreakdown ?? {}} />
        </div>
        <div className="lg:col-span-4 rounded-xl border border-border/50 bg-card p-3.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-2.5">
            <Package className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />Top Products
          </h3>
          <TopProductsChart topProducts={stats.topProducts ?? []} currency={currency} />
        </div>
      </motion.div>

      <motion.div variants={stagger.item} className="rounded-xl border border-border/50 bg-card p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-3">
          <Zap className="w-3.5 h-3.5 text-amber-400/60" />Cash Flow Forecast
        </h3>
        <CashFlowForecastWidget forecast={cashFlow} currency={currency} />
      </motion.div>

      <motion.div variants={stagger.item} className="rounded-xl border border-border/50 bg-card p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-3">
          <Target className="w-3.5 h-3.5 text-emerald-400/60" />Revenue Recovery
        </h3>
        <RevenueRecoveryPlanner invoices={invoices} currency={currency} />
      </motion.div>
    </motion.div>
  );
}

class CommerceInsightsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[CommerceInsightsTab] Render crash:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/30">
            <BarChart3 className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-sm font-semibold text-foreground/60 mb-1">Insights Error</p>
          <p className="text-xs text-muted-foreground/50 max-w-[280px] leading-relaxed mb-3">
            {this.state.error?.message || "Something went wrong rendering commerce insights."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] border border-border/50 hover:bg-white/[0.08] transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function CommerceInsightsWrapper(props: CommerceInsightsTabProps) {
  return (
    <CommerceInsightsErrorBoundary>
      <CommerceInsightsInner {...props} />
    </CommerceInsightsErrorBoundary>
  );
}

export const CommerceInsightsTab = React.memo(CommerceInsightsWrapper);
