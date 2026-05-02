"use client";

import { motion } from "framer-motion";
import { PieChart, BarChart3, CreditCard, TrendingUp, DollarSign } from "lucide-react";
import { ExpenseSummary, PAYMENT_METHODS } from "@/lib/client";
import { formatCurrency, formatDate, PAYMENT_ICONS } from "./expense-utils";

interface ExpenseStatsProps {
  summary: ExpenseSummary | null;
}

export function ExpenseStats({ summary }: ExpenseStatsProps) {
  const maxMonthly = summary?.monthlyTrend?.length ? Math.max(...summary.monthlyTrend.map(m => m.total), 1) : 1;

  return (
    <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
      {summary && (summary.byCategory?.length > 0 || summary.monthlyTrend?.length > 0) && (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {summary.byCategory?.length > 0 && (
            <div className="kf-card p-4 rounded-xl">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><PieChart className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />Spending by Category</h3>
              <div className="space-y-2.5">
                {summary.byCategory.map(cat => (
                  <div key={cat.categoryId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.color || "#6366f1" }} /><span>{cat.name}</span></div>
                      <div className="flex items-center gap-2"><span className="text-muted-foreground">{formatCurrency(cat.total)}</span><span className="text-[10px] text-muted-foreground/60">{cat.percent}%</span></div>
                    </div>
                    <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${cat.percent}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full rounded-full" style={{ background: cat.color || "#6366f1" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {summary.monthlyTrend?.length > 0 && (
            <div className="kf-card p-4 rounded-xl">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />Monthly Trend</h3>
              <div className="flex items-end gap-2 h-36">
                {summary.monthlyTrend.map(m => {
                  const heightPct = (m.total / maxMonthly) * 100;
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-card border border-border rounded px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">{formatCurrency(m.total)}</div>
                      <div className="w-full flex-1 flex items-end"><div className="w-full rounded-t-md transition-all group-hover:opacity-80" style={{ height: `${Math.max(heightPct, 4)}%`, background: "linear-gradient(to top, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }} /></div>
                      <span className="text-[10px] text-muted-foreground">{m.month.split("-")[1]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {summary?.byPaymentMethod && summary.byPaymentMethod.length > 0 && (
        <div className="kf-card p-4 rounded-xl">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />By Payment Method</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {summary.byPaymentMethod.map(pm => {
              const Icon = PAYMENT_ICONS[pm.method] || DollarSign;
              const label = PAYMENT_METHODS.find(m => m.value === pm.method)?.label || pm.method;
              return (
                <div key={pm.method} className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><Icon className="w-4 h-4 text-muted-foreground" /></div>
                  <div><p className="text-xs text-muted-foreground capitalize">{label}</p><p className="text-sm font-semibold">{formatCurrency(pm.total)}</p><p className="text-[10px] text-muted-foreground">{pm.count} transactions</p></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {summary?.largestExpense && (
        <div className="kf-card p-4 rounded-xl flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-red-400" /></div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Largest Expense This Period</p>
            <p className="text-sm font-semibold">{summary.largestExpense.description}</p>
            <p className="text-xs text-muted-foreground">{summary.largestExpense.vendor && `${summary.largestExpense.vendor} - `}{formatDate(summary.largestExpense.date)}</p>
          </div>
          <p className="text-lg font-bold text-red-400">{formatCurrency(summary.largestExpense.amount)}</p>
        </div>
      )}
    </motion.div>
  );
}
