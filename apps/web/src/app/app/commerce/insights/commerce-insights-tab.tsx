"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BarChart3,
  DollarSign,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileText,
  ArrowUpRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchCommerceStats,
  type CommerceStats,
  type Invoice,
  type Quote,
} from "@/lib/client";
import { formatCurrencyCompact } from "@/lib/currency";

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  item: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } } },
};

function InsightsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading commerce insights">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

const ActionStrip = React.memo(function ActionStrip({
  stats, invoices: _invoices, quotes, currency,
}: {
  stats: CommerceStats;
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
}) {
  const actions = useMemo(() => {
    const items: { key: string; priority: number; icon: React.ElementType; label: string; sub: string; variant: "success" | "danger" | "warning" | "info" }[] = [];

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

    const outstandingAmount = stats.outstandingAmount ?? 0;
    if (outstandingAmount > 0 && overdueCount === 0) {
      items.push({ key: "outstanding", priority: 4, icon: DollarSign, label: `${formatCurrencyCompact(outstandingAmount, currency)} outstanding`, sub: `${stats.invoiceStatusBreakdown?.SENT?.count ?? 0} awaiting payment`, variant: "info" });
    }

    if (stats.quoteConversionRate >= 60) {
      items.push({ key: "conversion", priority: 5, icon: TrendingUp, label: `${stats.quoteConversionRate}% quote conversion`, sub: "Strong performance", variant: "success" });
    }

    return items.sort((a, b) => a.priority - b.priority);
  }, [stats, quotes, currency]);

  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04]">
        <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /></div>
        <div><span className="text-xs text-emerald-400 font-semibold">All clear</span><p className="text-[10px] text-emerald-400/50">No action items — everything is on track</p></div>
      </div>
    );
  }

  const variantStyles = { success: "border-emerald-500/20 bg-emerald-500/[0.03]", danger: "border-red-500/20 bg-red-500/[0.03]", warning: "border-amber-500/20 bg-amber-500/[0.03]", info: "border-blue-500/20 bg-blue-500/[0.03]" };
  const iconStyles = { success: "bg-emerald-500/12 text-emerald-400", danger: "bg-red-500/12 text-red-400", warning: "bg-amber-500/12 text-amber-400", info: "bg-blue-500/12 text-blue-400" };

  return (
    <div className="space-y-1.5" role="group" aria-label="Commerce action items">
      {actions.map((a) => {
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

      <motion.div variants={stagger.item}>
        <ActionStrip stats={stats} invoices={invoices} quotes={quotes} currency={currency} />
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
