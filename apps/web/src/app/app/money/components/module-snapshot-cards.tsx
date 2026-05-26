"use client";

import React from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  Receipt,
  Landmark,
  ArrowRight,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  CreditCard,
  FileText,
  Calculator,
  Clock,
} from "lucide-react";
import { formatCurrency, formatCurrencyCompact } from "@/lib/currency";
import type { FinanceOverview, ExpenseSummary, RevenueOverview } from "@/lib/client";

interface ModuleSnapshotCardsProps {
  overview: FinanceOverview | null;
  expenseSummary: ExpenseSummary | null;
  revenueOverview: RevenueOverview | null;
  currency: string;
}

function ModuleCard({
  icon: Icon,
  label,
  heroValue,
  heroSub,
  metrics,
  accent,
  href,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  heroValue: string;
  heroSub?: string;
  metrics: { label: string; value: string; color?: string }[];
  accent: "emerald" | "rose" | "amber" | "blue" | "violet";
  href: string;
  delay: number;
}) {
  const router = useRouter();
  const accentMap: Record<string, { bg: string; fg: string; border: string; glow: string }> = {
    emerald: {
      bg: "bg-emerald-500/10",
      fg: "text-emerald-500",
      border: "border-emerald-500/20",
      glow: "from-emerald-500/5",
    },
    rose: {
      bg: "bg-rose-500/10",
      fg: "text-rose-500",
      border: "border-rose-500/20",
      glow: "from-rose-500/5",
    },
    amber: {
      bg: "bg-amber-500/10",
      fg: "text-amber-500",
      border: "border-amber-500/20",
      glow: "from-amber-500/5",
    },
    blue: {
      bg: "bg-blue-500/10",
      fg: "text-blue-500",
      border: "border-blue-500/20",
      glow: "from-blue-500/5",
    },
    violet: {
      bg: "bg-violet-500/10",
      fg: "text-violet-500",
      border: "border-violet-500/20",
      glow: "from-violet-500/5",
    },
  };
  const theme = accentMap[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      onClick={() => router.push(href)}
      className={`relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 sm:p-5 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/30 transition-all group`}
    >
      <div className={`absolute -right-12 -top-12 w-40 h-40 bg-gradient-to-br ${theme.glow} to-transparent rounded-full blur-2xl pointer-events-none`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg ${theme.bg} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${theme.fg}`} />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] transition-colors" />
        </div>

        <div className="mb-3">
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{heroValue}</p>
          {heroSub && <p className="text-[11px] text-muted-foreground mt-0.5">{heroSub}</p>}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{m.label}:</span>
              <span className={`text-[11px] font-semibold ${m.color ?? "text-foreground"}`}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function ModuleSnapshotCards({
  overview,
  expenseSummary,
  revenueOverview,
  currency,
}: ModuleSnapshotCardsProps) {
  /* ── Revenue ── */
  const revenueOutstanding = revenueOverview?.kpis?.outstanding ?? 0;
  const revenueCollected = revenueOverview?.kpis?.collectedThisMonth ?? 0;
  const revenueOverdueCount = revenueOverview?.kpis?.overdueCount ?? 0;
  const revenueOverdueAmount = revenueOverview?.kpis?.overdue ?? 0;

  /* ── Expenses ── */
  const expensesTotal = expenseSummary?.total ?? 0;
  const expensesCount = expenseSummary?.count ?? 0;
  const expensesBillsDue = overview?.billsDue ?? 0;
  const expensesBillsCount = overview?.billsDueCount ?? 0;
  const expensesChange = expenseSummary?.comparison?.changePercent ?? 0;
  const expensesDirection = expenseSummary?.comparison?.direction ?? "flat";

  /* ── Books ── */
  const booksCash = overview?.cashBalance ?? 0;
  const booksNetProfit = overview?.netProfitThisMonth ?? 0;
  const booksRunway = overview?.cashRunwayMonths ?? null;
  const booksAccounts = overview?.cashAccountCount ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Revenue */}
      <ModuleCard
        icon={TrendingUp}
        label="Revenue"
        heroValue={formatCurrency(revenueOutstanding, currency)}
        heroSub={revenueOutstanding > 0 ? "Outstanding" : "No outstanding revenue"}
        metrics={[
          {
            label: "Collected",
            value: formatCurrencyCompact(revenueCollected, currency),
            color: "text-emerald-400",
          },
          {
            label: "Overdue",
            value: revenueOverdueCount > 0
              ? `${revenueOverdueCount} · ${formatCurrencyCompact(revenueOverdueAmount, currency)}`
              : "None",
            color: revenueOverdueCount > 0 ? "text-amber-400" : "text-emerald-400",
          },
        ]}
        accent="blue"
        href="/app/commerce?tab=snapshot"
        delay={0}
      />

      {/* Expenses */}
      <ModuleCard
        icon={Receipt}
        label="Expenses"
        heroValue={formatCurrency(expensesTotal, currency)}
        heroSub={expensesCount > 0 ? `${expensesCount} transactions` : "No expenses this period"}
        metrics={[
          {
            label: "Bills due",
            value: expensesBillsCount > 0
              ? `${expensesBillsCount} · ${formatCurrencyCompact(expensesBillsDue, currency)}`
              : "None",
            color: expensesBillsCount > 0 ? "text-amber-400" : "text-emerald-400",
          },
          {
            label: "Trend",
            value: expensesDirection === "up"
              ? `+${expensesChange}%`
              : expensesDirection === "down"
                ? `${expensesChange}%`
                : "Flat",
            color: expensesDirection === "up" ? "text-rose-400" : expensesDirection === "down" ? "text-emerald-400" : "text-muted-foreground",
          },
        ]}
        accent="rose"
        href="/app/expenses?tab=snapshot"
        delay={0.08}
      />

      {/* Books */}
      <ModuleCard
        icon={Landmark}
        label="Books"
        heroValue={formatCurrency(booksCash, currency)}
        heroSub={booksAccounts > 0 ? `${booksAccounts} account${booksAccounts === 1 ? "" : "s"}` : "No accounts"}
        metrics={[
          {
            label: "Net profit",
            value: formatCurrencyCompact(booksNetProfit, currency),
            color: booksNetProfit >= 0 ? "text-emerald-400" : "text-rose-400",
          },
          {
            label: "Runway",
            value: booksRunway != null ? `${booksRunway.toFixed(1)}mo` : "—",
            color: booksRunway != null && booksRunway < 3 ? "text-rose-400" : "text-emerald-400",
          },
        ]}
        accent="emerald"
        href="/app/finance?tab=snapshot"
        delay={0.16}
      />
    </div>
  );
}
