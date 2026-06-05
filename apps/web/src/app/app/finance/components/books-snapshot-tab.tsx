"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  BookOpen,
  CheckSquare,
  Calculator,
  AlertTriangle,
  Clock,
  ArrowRight,
  Zap,
  FileText,
  CreditCard,
} from "lucide-react";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import type { FinanceOverview, FinanceOverviewActionItem } from "@/lib/client";

interface BooksSnapshotTabProps {
  data: FinanceOverview | null;
  currency: string;
  loading: boolean;
  onNavigate?: (tab: string) => void;
}

/* ─── Skeleton ─── */
function SnapshotSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading books snapshot">
      <div className="rounded-2xl border border-border/50 bg-card p-5 h-28">
        <div className="h-3 w-24 rounded bg-muted/40 animate-pulse mb-3" />
        <div className="h-8 w-40 rounded bg-muted/40 animate-pulse mb-2" />
        <div className="h-3 w-32 rounded bg-muted/40 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-4 h-24">
            <div className="h-8 w-8 rounded-lg bg-muted/40 animate-pulse mb-2" />
            <div className="h-4 w-24 rounded bg-muted/40 animate-pulse mb-1" />
            <div className="h-3 w-32 rounded bg-muted/40 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-4 h-28">
            <div className="h-8 w-8 rounded-lg bg-muted/40 animate-pulse mb-2" />
            <div className="h-4 w-24 rounded bg-muted/40 animate-pulse mb-1" />
            <div className="h-3 w-32 rounded bg-muted/40 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border/50 bg-card">
        <div className="px-4 py-3 border-b border-border/40">
          <div className="h-3 w-24 rounded bg-muted/40 animate-pulse" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="h-8 w-8 rounded-lg bg-muted/40 animate-pulse" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-32 rounded bg-muted/40 animate-pulse" />
              <div className="h-2 w-24 rounded bg-muted/40 animate-pulse" />
            </div>
            <div className="h-3 w-16 rounded bg-muted/40 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Books Hero ─── */
function BooksHero({
  cashBalance,
  revenueThisMonth,
  expensesThisMonth,
  netProfitThisMonth,
  currency,
}: {
  cashBalance: number;
  revenueThisMonth: number;
  expensesThisMonth: number;
  netProfitThisMonth: number;
  currency: string;
}) {
  const profitPositive = netProfitThisMonth >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 sm:p-6"
    >
      <div className="absolute -right-20 -top-20 w-64 h-64 bg-gradient-to-br from-emerald-500/5 to-amber-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cash on Hand</p>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            {formatCurrency(cashBalance, currency)}
          </h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-emerald-500">
              <TrendingUp className="w-3 h-3" />
              {formatCurrencyCompact(revenueThisMonth, currency)} in
            </span>
            <span className="text-border">|</span>
            <span className="inline-flex items-center gap-1 text-rose-500">
              <TrendingDown className="w-3 h-3" />
              {formatCurrencyCompact(expensesThisMonth, currency)} out
            </span>
            <span className="text-border">|</span>
            <span className={`inline-flex items-center gap-1 ${profitPositive ? "text-emerald-500" : "text-rose-500"}`}>
              {profitPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {formatCurrencyCompact(netProfitThisMonth, currency)} net
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${profitPositive ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"}`}>
            {profitPositive ? "Profitable" : "Loss"} MTD
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── At a Glance ─── */
function BooksAtAGlance({
  data,
  currency,
}: {
  data: FinanceOverview;
  currency: string;
}) {
  const stages = [
    {
      label: "Cash",
      amount: data.cashBalance,
      count: data.cashAccountCount,
      icon: Wallet,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Revenue",
      amount: data.revenueThisMonth,
      count: undefined,
      icon: TrendingUp,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Expenses",
      amount: data.expensesThisMonth,
      count: undefined,
      icon: TrendingDown,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
    },
    {
      label: "Net Profit",
      amount: data.netProfitThisMonth,
      count: undefined,
      icon: Calculator,
      color: data.netProfitThisMonth >= 0 ? "text-emerald-500" : "text-rose-500",
      bg: data.netProfitThisMonth >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">At a Glance</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stages.map((stage) => {
          const Icon = stage.icon;
          return (
            <div
              key={stage.label}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border/30 bg-white/[0.02]"
            >
              <div className={`w-8 h-8 rounded-lg ${stage.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${stage.color}`} />
              </div>
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{stage.label}</span>
              <span className="text-sm font-bold text-foreground">
                {stage.amount !== 0 ? formatCurrencyCompact(stage.amount, currency) : "—"}
              </span>
              {stage.count != null && stage.count > 0 && (
                <span className="text-[9px] text-muted-foreground/50">{stage.count} account{stage.count === 1 ? "" : "s"}</span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ─── Action Cards ─── */
function BooksActionCards({
  data,
  currency,
  onNavigate,
}: {
  data: FinanceOverview;
  currency: string;
  onNavigate?: (tab: string) => void;
}) {
  const cards: {
    id: string;
    icon: React.ElementType;
    title: string;
    desc: string;
    cta: string;
    onClick: () => void;
    urgent: boolean;
    color: string;
    bg: string;
  }[] = [];

  if (data.cashRunwayMonths != null && data.cashRunwayMonths < 3) {
    cards.push({
      id: "runway",
      icon: AlertTriangle,
      title: "Low cash runway",
      desc: `${data.cashRunwayMonths.toFixed(1)} months of cash remaining`,
      cta: "View cashflow",
      onClick: () => onNavigate?.("cashflow"),
      urgent: true,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
    });
  }

  if (data.overdueInvoiceCount > 0) {
    cards.push({
      id: "overdue",
      icon: FileText,
      title: `${data.overdueInvoiceCount} overdue invoice${data.overdueInvoiceCount === 1 ? "" : "s"}`,
      desc: `${formatCurrency(data.overdueInvoices, currency)} unpaid`,
      cta: "View",
      onClick: () => onNavigate?.("journal"),
      urgent: true,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    });
  }

  if (data.pendingActionCount > 0) {
    cards.push({
      id: "actions",
      icon: Zap,
      title: `${data.pendingActionCount} pending action${data.pendingActionCount === 1 ? "" : "s"}`,
      desc: "Needs attention in your books",
      cta: "Review",
      onClick: () => onNavigate?.("journal"),
      urgent: false,
      color: "text-[hsl(var(--kf-accent1))]",
      bg: "bg-[hsl(var(--kf-accent1))]/10",
    });
  }

  if (data.taxReserved > 0) {
    cards.push({
      id: "tax",
      icon: Calculator,
      title: `${formatCurrencyCompact(data.taxReserved, currency)} tax reserved`,
      desc: "Set aside for tax obligations",
      cta: "View tax",
      onClick: () => onNavigate?.("journal"),
      urgent: false,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
    });
  }

  if (cards.length === 0) {
    cards.push({
      id: "healthy",
      icon: CheckSquare,
      title: "All caught up",
      desc: "No urgent book actions",
      cta: "View accounts",
      onClick: () => onNavigate?.("accounts"),
      urgent: false,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    });
  }

  const display = cards.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)).slice(0, 3);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {display.map((card, idx) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.08 }}
            className={`rounded-xl border border-border/60 bg-card p-4 hover:border-[hsl(var(--kf-accent1))]/30 transition-all ${card.urgent ? "border-rose-500/20" : ""}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
              {card.urgent && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-rose-500/10 text-rose-500 uppercase tracking-wider">
                  Action
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-0.5">{card.title}</h3>
            <p className="text-xs text-muted-foreground mb-3">{card.desc}</p>
            <button
              onClick={card.onClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/5 text-foreground hover:bg-foreground/10 transition-colors"
            >
              {card.cta}
              <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ─── Activity Feed ─── */
function BooksActivityFeed({
  actions,
  currency,
}: {
  actions: FinanceOverviewActionItem[];
  currency: string;
}) {
  const items = useMemo(() => {
    return actions
      .filter((a) => a.status === "pending" || a.status === "open")
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        title: a.title,
        subtitle: a.detail,
        amount: a.amountAtRisk,
        type: a.type,
      }));
  }, [actions]);

  const typeMeta: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
    reconcile: { icon: CheckSquare, color: "text-violet-500", bg: "bg-violet-500/10" },
    review: { icon: BookOpen, color: "text-blue-500", bg: "bg-blue-500/10" },
    tax: { icon: Calculator, color: "text-indigo-500", bg: "bg-indigo-500/10" },
    alert: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
    payment: { icon: CreditCard, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    default: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted/20" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="rounded-2xl border border-border/60 bg-card"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Action Queue</p>
        {items.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{items.length} pending</span>
        )}
      </div>
      <div className="divide-y divide-border/30">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <CheckSquare className="w-5 h-5 text-emerald-500/50 mx-auto mb-2" />
            All clear — no pending actions.
          </div>
        ) : (
          items.map((item) => {
            const meta = typeMeta[item.type] ?? typeMeta.default;
            const Icon = meta.icon;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{item.title}</p>
                  {item.subtitle && <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>}
                </div>
                {item.amount != null && item.amount > 0 && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-semibold text-foreground">{formatCurrency(item.amount, currency)}</p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

/* ─── Main Component ─── */
export function BooksSnapshotTab({ data, currency, loading, onNavigate }: BooksSnapshotTabProps) {
  if (loading || !data) return <SnapshotSkeleton />;

  return (
    <div className="space-y-5">
      <BooksHero
        cashBalance={data.cashBalance}
        revenueThisMonth={data.revenueThisMonth}
        expensesThisMonth={data.expensesThisMonth}
        netProfitThisMonth={data.netProfitThisMonth}
        currency={currency}
      />
      <BooksAtAGlance data={data} currency={currency} />
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">Actions</h2>
        </div>
        <BooksActionCards data={data} currency={currency} onNavigate={onNavigate} />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90">Activity</h2>
        </div>
        <BooksActivityFeed actions={data.actions} currency={currency} />
      </div>
    </div>
  );
}
