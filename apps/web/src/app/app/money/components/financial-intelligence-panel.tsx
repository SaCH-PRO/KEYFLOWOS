"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Zap,
  Sparkles,
  Target,
  PieChart,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface CashflowPrediction {
  month: string;
  projected: number;
  conservative: number;
  optimistic: number;
}

interface FinancialInsight {
  id: string;
  type: "opportunity" | "risk" | "optimization" | "prediction";
  title: string;
  description: string;
  impact: string;
  actionLabel?: string;
}

interface ExpenseCategory {
  category: string;
  amount: number;
  budget: number;
  trend: number;
}

interface ForecastDto {
  currency: string;
  scenarios: {
    expected: Array<{ date: string; cash: number }>;
    conservative: Array<{ date: string; cash: number }>;
    optimistic: Array<{ date: string; cash: number }>;
  };
  dangerDates: Array<{ date: string; projectedCash: number; reason: string }>;
}

interface InsightStripDto {
  headline: string;
  body: string;
  source: string;
}

interface OverviewDto {
  cashBalance: number;
  revenueThisMonth: number;
  expensesThisMonth: number;
  netProfitThisMonth: number;
  currency: string;
}

interface ExpenseBreakdownDto {
  items: Array<{ category: string; amount: number; budget: number }>;
}

export function FinancialIntelligencePanel() {
  const businessId = getStoredBusinessId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<CashflowPrediction[]>([]);
  const [insights, setInsights] = useState<FinancialInsight[]>([]);
  const [expenses, setExpenses] = useState<ExpenseCategory[]>([]);
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const [forecastRes, insightRes, breakdownRes, overviewRes] = await Promise.all([
        apiGet<ForecastDto>(`/finance/businesses/${businessId}/cashflow-forecast?days=180`),
        apiGet<InsightStripDto>(`/finance/businesses/${businessId}/intelligence/insight`),
        apiGet<ExpenseBreakdownDto>(`/finance/businesses/${businessId}/expense-breakdown`),
        apiGet<OverviewDto>(`/finance/businesses/${businessId}/overview`),
      ]);

      if (overviewRes.data) setOverview(overviewRes.data);

      if (forecastRes.data) {
        const months = new Map<string, { projected: number; conservative: number; optimistic: number }>();
        const pushMonth = (dateStr: string, key: "projected" | "conservative" | "optimistic", value: number) => {
          const d = new Date(dateStr);
          const label = d.toLocaleDateString("default", { month: "short" });
          const existing = months.get(label) ?? { projected: 0, conservative: 0, optimistic: 0 };
          existing[key] = Math.round(value);
          months.set(label, existing);
        };

        forecastRes.data.scenarios.expected.forEach((p) => pushMonth(p.date, "projected", p.cash));
        forecastRes.data.scenarios.conservative.forEach((p) => pushMonth(p.date, "conservative", p.cash));
        forecastRes.data.scenarios.optimistic.forEach((p) => pushMonth(p.date, "optimistic", p.cash));

        const merged = Array.from(months.entries()).map(([month, values]) => ({
          month,
          ...values,
        }));
        setPredictions(merged.slice(0, 6));
      }

      if (insightRes.data) {
        const type: FinancialInsight["type"] = insightRes.data.source === "ai" ? "prediction" : "risk";
        setInsights([
          {
            id: "insight-1",
            type,
            title: insightRes.data.headline,
            description: insightRes.data.body,
            impact: "AI-generated",
            actionLabel: "Review",
          },
        ]);
      }

      if (breakdownRes.data?.items) {
        const items = breakdownRes.data.items.map((item) => {
          const previousBudget = item.budget || item.amount * 1.05;
          const trend = previousBudget ? Math.round(((item.amount - previousBudget) / previousBudget) * 100) : 0;
          return { ...item, trend };
        });
        setExpenses(items);
      }

      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load financial intelligence");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [businessId]);

  const maxProjected = useMemo(
    () => Math.max(...predictions.map((p) => p.optimistic || p.projected), 1),
    [predictions],
  );

  const fmtMoney = (n?: number) => {
    if (n === undefined || n === null) return "—";
    const currency = overview?.currency ?? "TTD";
    return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  if (loading && !lastRefresh) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading financial intelligence…</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 rounded-xl bg-muted/30 animate-pulse" />
          <div className="h-24 rounded-xl bg-muted/30 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-rose-500">Could not load intelligence</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <button
              onClick={load}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI Summary */}
      {overview && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="rounded-xl border border-border/40 bg-card/40 p-3">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">Cash Balance</p>
            <p className="text-base font-semibold mt-0.5">{fmtMoney(overview.cashBalance)}</p>
          </div>
          <div className="rounded-xl border border-border/40 bg-card/40 p-3">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">Net Profit</p>
            <p className={`text-base font-semibold mt-0.5 ${overview.netProfitThisMonth >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {fmtMoney(overview.netProfitThisMonth)}
            </p>
          </div>
        </motion.div>
      )}

      {/* Cashflow Prediction */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            6-Month Cash Flow Forecast
          </h3>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-accent1))]" /> Projected</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-muted-foreground/40" /> Conservative</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Optimistic</span>
          </div>
        </div>
        {predictions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No forecast data available.</p>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {predictions.map((pred, i) => {
              const projectedHeight = ((pred.projected || 0) / maxProjected) * 100;
              const conservativeHeight = ((pred.conservative || 0) / maxProjected) * 100;
              const optimisticHeight = ((pred.optimistic || 0) / maxProjected) * 100;
              return (
                <div key={pred.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full relative flex justify-center" style={{ height: "100px" }}>
                    {/* Conservative range */}
                    <div
                      className="absolute bottom-0 w-6 rounded-t-md bg-muted/20"
                      style={{ height: `${conservativeHeight}%` }}
                    />
                    {/* Optimistic range */}
                    <div
                      className="absolute bottom-0 w-6 rounded-t-md bg-emerald-500/10"
                      style={{ height: `${optimisticHeight}%` }}
                    />
                    {/* Projected */}
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${projectedHeight}%` }}
                      transition={{ delay: i * 0.08, duration: 0.5, ease: "easeOut" }}
                      className="absolute bottom-0 w-3 rounded-t-md bg-[hsl(var(--kf-accent1))]"
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">{pred.month}</span>
                  <span className="text-[9px] text-muted-foreground">${((pred.projected || 0) / 1000).toFixed(1)}k</span>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Expense Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <PieChart className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          Expense vs Budget
        </h3>
        {expenses.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No expense data this month.</p>
        ) : (
          <div className="space-y-2.5">
            {expenses.map((expense, i) => {
              const pct = expense.budget > 0 ? (expense.amount / expense.budget) * 100 : 0;
              return (
                <motion.div
                  key={expense.category}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground">{expense.category}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">${Math.round(expense.amount)} / ${Math.round(expense.budget)}</span>
                      <span className={`text-[10px] font-medium ${expense.trend > 0 ? "text-rose-500" : expense.trend < 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                        {expense.trend !== 0 ? `${expense.trend > 0 ? "+" : ""}${expense.trend}%` : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(pct, 100)}%` }}
                      transition={{ delay: i * 0.08 + 0.2, duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: pct > 100 ? "#ef4444" : pct > 85 ? "#f59e0b" : "#10b981",
                      }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* AI Insights */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Financial Intelligence
          </h3>
          <button
            onClick={load}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="space-y-2">
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No insights yet. Run a scan to generate intelligence.</p>
          ) : (
            insights.map((insight, i) => {
              const config = {
                opportunity: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Zap },
                risk: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
                optimization: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Target },
                prediction: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: Sparkles },
              }[insight.type];
              const Icon = config.icon;
              return (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.3 }}
                  className={`rounded-xl border ${config.border} ${config.bg} p-3`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">{insight.impact}</span>
                        {insight.actionLabel && (
                          <button className="text-[10px] font-medium text-[hsl(var(--kf-accent2))] hover:underline">
                            {insight.actionLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
