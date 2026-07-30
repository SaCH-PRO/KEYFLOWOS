"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  HelpCircle,
  Plus,
  SlidersHorizontal,
  Calendar,
  Download,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Target,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  fetchExpenseBudgets,
  fetchExpenseSummary,
  fetchVendorAnalytics,
  ExpenseBudget,
  ExpenseSummary,
  VendorAnalytics,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

function formatCurrency(amount: number): string {
  return `TTD $${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function _formatK(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return String(Math.round(amount));
}

export default function BudgetingOverviewPage() {
  const router = useRouter();
  const [businessId, _setBusinessId] = useState<string | null>(() => getStoredBusinessId() ?? null);
  const [budgets, setBudgets] = useState<ExpenseBudget[]>([]);
  const [_summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [vendors, setVendors] = useState<VendorAnalytics[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      queueMicrotask(() => setLoading(true));
      try {
        const [budRes, sumRes, venRes] = await Promise.all([
          fetchExpenseBudgets(businessId),
          fetchExpenseSummary(businessId, "30d"),
          fetchVendorAnalytics(businessId, "30d"),
        ]);
        if (budRes.data) setBudgets(budRes.data);
        if (sumRes.data) setSummary(sumRes.data);
        if (venRes.data) setVendors(venRes.data);
      } catch {
        toast.error("Failed to load budgeting data");
      }
      setLoading(false);
    })();
  }, [businessId]);

  const stats = useMemo(() => {
    const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
    const totalActual = budgets.reduce((s, b) => s + b.spent, 0);
    const totalCommitted = budgets.reduce((s, b) => s + Math.max(0, b.amount - b.remaining - b.spent), 0);
    const forecast = totalActual + totalCommitted * 0.5;
    const atRisk = budgets.filter((b) => b.isNearAlert && !b.isOverBudget).length;
    const overBudget = budgets.filter((b) => b.isOverBudget).length;
    const percentUsed = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0;
    return { totalBudget, totalActual, totalCommitted, forecast, atRisk, overBudget, percentUsed };
  }, [budgets]);

  const alerts = useMemo(() => {
    const items: { type: "danger" | "warning" | "success"; title: string; desc: string }[] = [];
    const overBudgetCats = budgets.filter((b) => b.isOverBudget);
    if (overBudgetCats.length > 0) {
      items.push({
        type: "danger",
        title: `${overBudgetCats[0].category?.name || "Category"} forecast is over budget`,
        desc: `Projected to exceed plan by ${formatCurrency(Math.abs(overBudgetCats[0].remaining))} this month.`,
      });
    }
    const atRiskCats = budgets.filter((b) => b.isNearAlert && !b.isOverBudget);
    if (atRiskCats.length > 0) {
      items.push({
        type: "warning",
        title: `${atRiskCats[0].category?.name || "Category"} is at risk`,
        desc: `${Math.round(atRiskCats[0].percentUsed)}% used with time left in the period.`,
      });
    }
    const healthy = budgets.find((b) => !b.isOverBudget && !b.isNearAlert && b.percentUsed > 20);
    if (healthy) {
      items.push({
        type: "success",
        title: `${healthy.category?.name || "Category"} is healthy`,
        desc: "Recurring subscriptions are stable.",
      });
    }
    return items;
  }, [budgets]);

  const topDrivers = useMemo(() => {
    return vendors
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((v, i) => ({ ...v, rank: i + 1 }));
  }, [vendors]);

  const barColors = ["bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-blue-500", "bg-slate-400"];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Budgeting</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Monitor actual spend against plan, committed spend, and forecast.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden sm:flex items-center justify-center w-9 h-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              onClick={() => router.push("/app/budgeting/planner")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New budget</span>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <Calendar className="w-4 h-4" />
            May 2026
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <SlidersHorizontal className="w-4 h-4" />
            View by: Department
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <Target className="w-4 h-4" />
            Scenario: Approved budget
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ml-auto">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            {
              label: "Budget used",
              value: `${stats.percentUsed}%`,
              sub: `${formatCurrency(stats.totalActual)} actual spend`,
              icon: Target,
              iconColor: "text-blue-600",
              iconBg: "bg-blue-50",
              link: "View variance ->",
            },
            {
              label: "Committed",
              value: formatCurrency(stats.totalCommitted),
              sub: "Approved but not paid",
              icon: CheckCircle,
              iconColor: "text-purple-600",
              iconBg: "bg-purple-50",
              link: "View commitments ->",
            },
            {
              label: "Forecast spend",
              value: formatCurrency(stats.forecast),
              sub: `${formatCurrency(Math.max(0, stats.totalBudget - stats.forecast))} remaining`,
              icon: TrendingUp,
              iconColor: "text-amber-600",
              iconBg: "bg-amber-50",
              link: "Open forecast ->",
            },
            {
              label: "At risk",
              value: `${stats.atRisk} department${stats.atRisk !== 1 ? "s" : ""}`,
              sub: stats.overBudget > 0 ? "Likely to exceed plan" : "On track",
              icon: AlertTriangle,
              iconColor: "text-rose-600",
              iconBg: "bg-rose-50",
              link: "Resolve risks ->",
            },
          ].map((card, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", card.iconBg)}>
                  <card.icon className={cn("w-3.5 h-3.5", card.iconColor)} />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-xl font-bold tracking-tight text-foreground">{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{card.sub}</p>
              <p className="text-[11px] text-[hsl(var(--kf-accent1))] mt-1 font-medium cursor-pointer hover:underline">{card.link}</p>
            </div>
          ))}
        </div>

        {/* Main grid */}
        <div className="flex flex-col xl:flex-row gap-5">
          {/* Budget performance */}
          <div className="flex-1 min-w-0">
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">Budget performance</h3>
              <p className="text-xs text-muted-foreground mb-4">Actual + committed + forecast by department.</p>

              {/* Simple bar chart */}
              <div className="flex items-end gap-3 h-32 mb-6 px-2">
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((month, i) => {
                  const h = [45, 52, 48, 60, 58, 72][i];
                  const isCurrent = month === "May";
                  return (
                    <div key={month} className="flex-1 flex flex-col items-center gap-1.5">
                      <div
                        className={cn("w-full rounded-t-md transition-all", isCurrent ? "bg-[hsl(var(--kf-accent1))]" : "bg-blue-500")}
                        style={{ height: `${h}%` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{month}</span>
                    </div>
                  );
                })}
              </div>

              {/* Table */}
              {loading ? (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">Department</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">Budget</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">Actual</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs hidden md:table-cell">Committed</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs hidden lg:table-cell">Forecast</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">Variance</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgets
                        .filter((b) => b.amount > 0)
                        .sort((a, b) => b.amount - a.amount)
                        .map((b) => {
                          const forecast = b.spent + (b.amount - b.remaining - b.spent) * 0.5;
                          const variance = b.amount - forecast;
                          const pct = Math.min(100, Math.round(b.percentUsed));
                          const isOver = b.isOverBudget;
                          const isRisk = b.isNearAlert && !isOver;
                          return (
                            <tr key={b.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden flex-shrink-0">
                                    <div
                                      className={cn("h-full rounded-full", isOver ? "bg-rose-500" : isRisk ? "bg-amber-500" : "bg-emerald-500")}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-medium text-foreground">{b.category?.name || "Uncategorized"}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{formatCurrency(b.amount)}</td>
                              <td className="px-3 py-2.5 text-right text-xs text-foreground font-medium">{formatCurrency(b.spent)}</td>
                              <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden md:table-cell">{formatCurrency(Math.max(0, b.amount - b.remaining - b.spent))}</td>
                              <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden lg:table-cell">{formatCurrency(forecast)}</td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={cn("text-xs font-semibold", variance < 0 ? "text-rose-600" : "text-emerald-600")}>
                                  {variance < 0 ? "-" : ""}{formatCurrency(Math.abs(variance))}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={cn(
                                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                                    isOver ? "bg-rose-50 text-rose-700" : isRisk ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                                  )}
                                >
                                  {isOver ? "Over" : isRisk ? "At risk" : "On track"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      {budgets.filter((b) => b.amount > 0).length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                            No budgets set. Create a budget to start tracking.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div className="w-full xl:w-[340px] flex-shrink-0 space-y-4">
            {/* Alerts */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Alerts & recommendations</h3>
              {alerts.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">All budgets on track</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {alerts.map((alert, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-lg p-3",
                        alert.type === "danger" ? "bg-rose-50" : alert.type === "warning" ? "bg-amber-50" : "bg-emerald-50"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle
                          className={cn(
                            "w-3.5 h-3.5",
                            alert.type === "danger" ? "text-rose-600" : alert.type === "warning" ? "text-amber-600" : "text-emerald-600"
                          )}
                        />
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            alert.type === "danger" ? "text-rose-700" : alert.type === "warning" ? "text-amber-700" : "text-emerald-700"
                          )}
                        >
                          {alert.title}
                        </span>
                      </div>
                      <p
                        className={cn(
                          "text-[11px] leading-relaxed",
                          alert.type === "danger" ? "text-rose-600" : alert.type === "warning" ? "text-amber-600" : "text-emerald-600"
                        )}
                      >
                        {alert.desc}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top spend drivers */}
            <div className="rounded-xl border border-border bg-card shadow-sm p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Top spend drivers</h3>
              <div className="space-y-3">
                {topDrivers.map((v, i) => (
                  <div key={v.name} className="flex items-center gap-3">
                    <div
                      className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0", barColors[i % barColors.length])}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{v.name}</p>
                      <p className="text-[11px] text-muted-foreground">{v.count} transactions</p>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(v.total)}</span>
                  </div>
                ))}
                {topDrivers.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-2">No vendor data</p>
                )}
              </div>
              <button
                onClick={() => router.push("/app/expenses")}
                className="w-full mt-3 px-3 py-2 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                Drill into variance
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
