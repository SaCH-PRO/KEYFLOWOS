"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3, DollarSign, Clock, TrendingUp, AlertTriangle,
  CheckCircle2, RefreshCw, FileText, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchCommerceStats,
  type CommerceStats, type Invoice, type Quote,
} from "@/lib/client";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } } },
};

function InsightsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading commerce insights">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-3.5">
            <Skeleton className="h-3 w-14 mb-2" />
            <Skeleton className="h-7 w-16 mb-1.5" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
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
      sparkColor: "hsl(var(--kf-warning))",
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const statsRes = await fetchCommerceStats(businessId);
      if (statsRes.data) setStats(statsRes.data);
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
      <Link
        href="/app/reports?tab=revenue"
        className="kf-card p-3 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-medium">View Full Revenue &amp; Commerce Report</span>
          <span className="text-xs text-muted-foreground">— trends, charts, cash flow &amp; AI insights</span>
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
      </Link>

      <motion.div variants={stagger.item} className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]" />
          <h2 className="text-sm font-semibold tracking-tight">Commerce Snapshot</h2>
          <span className="text-[10px] text-muted-foreground/50 font-medium">{stats.invoiceCount} invoices &middot; {stats.quoteCount} quotes</span>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] transition-colors disabled:opacity-50" aria-label="Refresh insights">
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/50 ${refreshing ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Refresh</span>
        </button>
      </motion.div>

      <HeroStats stats={stats} currency={currency} />

      <motion.div variants={stagger.item}>
        <AlertCards stats={stats} invoices={invoices} quotes={quotes} currency={currency} />
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
