"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Receipt, FileText, Plus, ArrowUpRight } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { FinanceOverview } from "@/lib/client";

interface MoneyCashHeroProps {
  overview: FinanceOverview | null;
  currency?: string;
}

export function MoneyCashHero({ overview, currency = "TTD" }: MoneyCashHeroProps) {
  const cash = overview?.cashBalance ?? 0;
  const runway = overview?.cashRunwayMonths ?? null;
  const revenue = overview?.revenueThisMonth ?? 0;
  const expenses = overview?.expensesThisMonth ?? 0;
  const net = overview?.netProfitThisMonth ?? 0;
  const trend = revenue > 0 ? ((net / revenue) * 100) : 0;
  const trendUp = net >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 sm:p-6"
    >
      {/* Subtle background gradient */}
      <div className="absolute -right-20 -top-20 w-64 h-64 bg-gradient-to-br from-orange-500/5 to-teal-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        {/* Cash block */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Available Cash
          </p>
          <div className="flex items-baseline gap-3">
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
              {formatCurrency(cash, currency)}
            </h2>
            {runway != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted/50 text-muted-foreground">
                {runway < 3 ? "🔴" : runway < 6 ? "🟡" : "🟢"}
                {runway} mo runway
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className={`inline-flex items-center gap-0.5 ${trendUp ? "text-emerald-500" : "text-rose-500"}`}>
              {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(trend).toFixed(1)}% this month
            </span>
            <span className="text-border">|</span>
            <span>In: {formatCurrency(revenue, currency)}</span>
            <span className="text-border">|</span>
            <span>Out: {formatCurrency(expenses, currency)}</span>
          </div>
        </div>

        {/* Quick create buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/app/commerce?tab=pipeline"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
          >
            <Receipt className="w-3.5 h-3.5" />
            Invoice
          </Link>
          <Link
            href="/app/expenses"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Expense
          </Link>
          <Link
            href="/app/commerce?tab=pipeline"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Quote
          </Link>
          <Link
            href="/app/payments?tab=links"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition-colors"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            Link
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
