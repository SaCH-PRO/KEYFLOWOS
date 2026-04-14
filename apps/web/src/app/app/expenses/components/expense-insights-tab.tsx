"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, TrendingUp, TrendingDown, Store, FileQuestion, Receipt,
  Target, BarChart3, Lightbulb, ArrowRight, PieChart, ShieldAlert,
  Zap, DollarSign, Sparkles, Brain, Shield,
  ChevronDown, ChevronUp, Users, Percent,
} from "lucide-react";
import { Expense, ExpenseCategory, ExpenseSummary, VendorAnalytics, ExpenseBudget, MarginAnalysis } from "@/lib/client";
import { formatCurrency } from "./expense-utils";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProjectOption, ContactOption, ServiceOption } from "./use-expenses-data";

type TabKey = "transactions" | "budgets" | "categories" | "insights";

interface InsightCard {
  id: string;
  type: "warning" | "risk" | "opportunity" | "info";
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  detail?: string;
  modules?: string[];
  actionLabel?: string;
  actionTab?: TabKey;
  priority: number;
}

interface ExpenseInsightsTabProps {
  businessId: string;
  expenses: Expense[];
  categories: ExpenseCategory[];
  summary: ExpenseSummary | null;
  vendors: VendorAnalytics[];
  budgets: ExpenseBudget[];
  marginData?: MarginAnalysis | null;
  projects?: ProjectOption[];
  contacts?: ContactOption[];
  services?: ServiceOption[];
  onNavigate: (tab: TabKey) => void;
  periodTotalCount?: number;
  periodUncategorizedCount?: number;
  periodMissingReceiptCount?: number;
  periodRecurringCount?: number;
}

const TYPE_STYLES: Record<string, { border: string; bg: string; iconColor: string; badge: string; badgeLabel: string }> = {
  warning: { border: "border-red-500/30", bg: "hsl(var(--kf-error) / 0.05)", iconColor: "hsl(var(--kf-error))", badge: "hsl(var(--kf-error) / 0.15)", badgeLabel: "Action Required" },
  risk: { border: "border-amber-500/30", bg: "hsl(var(--kf-warning) / 0.05)", iconColor: "hsl(var(--kf-warning))", badge: "hsl(var(--kf-warning) / 0.15)", badgeLabel: "Monitor" },
  opportunity: { border: "border-emerald-500/30", bg: "hsl(var(--kf-success) / 0.05)", iconColor: "hsl(var(--kf-success))", badge: "hsl(var(--kf-success) / 0.15)", badgeLabel: "Opportunity" },
  info: { border: "border-blue-500/30", bg: "hsl(var(--kf-info) / 0.05)", iconColor: "hsl(var(--kf-info))", badge: "hsl(var(--kf-info) / 0.15)", badgeLabel: "Insight" },
};

export function ExpenseInsightsTab({
  expenses, categories, summary, vendors, budgets, marginData,
  projects: _projects = [], contacts: _contacts = [], services: _services = [],
  onNavigate,
  periodTotalCount, periodUncategorizedCount, periodMissingReceiptCount, periodRecurringCount,
}: ExpenseInsightsTabProps) {
  const [showAllInsights, setShowAllInsights] = useState(false);

  const totalExpenseCount = periodTotalCount ?? summary?.count ?? expenses.length;
  const uncategorizedExpenseCount = periodUncategorizedCount ?? expenses.filter(e => !e.categoryId).length;
  const missingReceiptExpenseCount = periodMissingReceiptCount ?? expenses.filter(e => !e.receiptUrl).length;
  const recurringExpenseCount = periodRecurringCount ?? expenses.filter(e => e.isRecurring).length;

  const insights = useMemo(() => {
    const cards: InsightCard[] = [];
    const overBudget = budgets.filter(b => b.isOverBudget);
    if (overBudget.length > 0) {
      const names = overBudget.map(b => b.category?.name || "Total").join(", ");
      const totalOver = overBudget.reduce((sum, b) => sum + Math.abs(b.remaining), 0);
      cards.push({
        id: "over-budget",
        type: "warning",
        icon: AlertTriangle,
        title: `${overBudget.length} Budget${overBudget.length > 1 ? "s" : ""} Exceeded`,
        description: `${names} ${overBudget.length > 1 ? "have" : "has"} exceeded the monthly limit by ${formatCurrency(totalOver)}.`,
        detail: "Review spending in these categories to identify where costs can be trimmed or budgets need adjusting.",
        modules: ["Revenue", "Reports"],
        actionLabel: "Review Budgets",
        actionTab: "budgets",
        priority: 10,
      });
    }

    const nearLimit = budgets.filter(b => b.isNearAlert && !b.isOverBudget);
    if (nearLimit.length > 0) {
      const dayOfMonth = new Date().getDate();
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const dayPct = Math.round((dayOfMonth / daysInMonth) * 100);
      cards.push({
        id: "near-limit",
        type: "risk",
        icon: Target,
        title: `${nearLimit.length} Budget${nearLimit.length > 1 ? "s" : ""} Approaching Limit`,
        description: `${nearLimit.map(b => b.category?.name || "Total").join(", ")} at ${nearLimit[0]?.percentUsed ?? 0}% used. We're ${dayPct}% through the month.`,
        detail: nearLimit[0]?.percentUsed > dayPct + 10 ? "Spending is outpacing the month — projected overshoot by month-end." : "On track if current pace holds.",
        modules: ["Revenue"],
        actionLabel: "View Budgets",
        actionTab: "budgets",
        priority: 8,
      });
    }

    const changePct = summary?.comparison?.changePercent ?? 0;
    if (changePct > 20) {
      cards.push({
        id: "spending-spike",
        type: "risk",
        icon: TrendingUp,
        title: `Spending Up ${changePct.toFixed(0)}% vs Last Period`,
        description: `Total spend is ${formatCurrency(summary?.total ?? 0)} compared to ${formatCurrency(summary?.comparison?.prevTotal ?? 0)} in the prior period.`,
        detail: "Check for one-time purchases, new recurring costs, or unexpected vendor charges that may explain the increase.",
        modules: ["Revenue", "Reports"],
        actionLabel: "View Transactions",
        actionTab: "transactions",
        priority: 7,
      });
    } else if (changePct < -15 && (summary?.total ?? 0) > 0) {
      cards.push({
        id: "spending-down",
        type: "opportunity",
        icon: TrendingDown,
        title: `Spending Down ${Math.abs(changePct).toFixed(0)}% vs Last Period`,
        description: `Good cost discipline — spending reduced to ${formatCurrency(summary?.total ?? 0)}.`,
        detail: "If this isn't due to reduced activity, your margin may be improving.",
        modules: ["Revenue"],
        priority: 3,
      });
    }

    if (vendors.length > 0) {
      const topVendor = vendors[0];
      const totalSpend = summary?.total ?? 0;
      const vendorPct = totalSpend > 0 ? Math.round((topVendor.total / totalSpend) * 100) : 0;
      if (vendorPct > 35) {
        cards.push({
          id: "vendor-concentration",
          type: "risk",
          icon: Store,
          title: `Vendor Concentration: ${topVendor.name} at ${vendorPct}%`,
          description: `${topVendor.name} accounts for ${formatCurrency(topVendor.total)} — ${vendorPct}% of all spending this period.`,
          detail: "High vendor concentration creates supply-chain risk. Consider diversifying or negotiating better terms.",
          modules: ["Projects"],
          priority: 6,
        });
      }
    }

    if (uncategorizedExpenseCount > 0) {
      cards.push({
        id: "uncategorized",
        type: uncategorizedExpenseCount > 5 ? "warning" : "risk",
        icon: FileQuestion,
        title: `${uncategorizedExpenseCount} Uncategorized Expense${uncategorizedExpenseCount > 1 ? "s" : ""}`,
        description: `Uncategorized expenses reduce budget tracking accuracy and weaken financial reports.`,
        modules: ["Reports", "Documents"],
        actionLabel: "Review & Categorize",
        actionTab: "transactions",
        priority: uncategorizedExpenseCount > 5 ? 9 : 5,
      });
    }

    if (missingReceiptExpenseCount > 3 && totalExpenseCount > 0) {
      const missingPct = Math.round((missingReceiptExpenseCount / totalExpenseCount) * 100);
      cards.push({
        id: "missing-receipts",
        type: "info",
        icon: Receipt,
        title: `${missingReceiptExpenseCount} Expenses Missing Receipts (${missingPct}%)`,
        description: "Attaching receipts improves tax compliance, audit readiness, and financial document accuracy.",
        modules: ["Documents", "Reports"],
        actionLabel: "View Expenses",
        actionTab: "transactions",
        priority: 4,
      });
    }

    if (budgets.length === 0 && totalExpenseCount > 5) {
      cards.push({
        id: "no-budgets",
        type: "opportunity",
        icon: Target,
        title: "No Budgets Configured",
        description: "Set spending limits per category to get overspend alerts, cost control, and AI-powered budget recommendations.",
        modules: ["Reports", "Flows"],
        actionLabel: "Set Up Budgets",
        actionTab: "budgets",
        priority: 5,
      });
    }

    if (categories.length === 0 && totalExpenseCount > 0) {
      cards.push({
        id: "no-categories",
        type: "opportunity",
        icon: PieChart,
        title: "No Categories Created",
        description: "Create categories to unlock spending breakdowns, budget tracking, and smarter AI insights.",
        actionLabel: "Create Categories",
        actionTab: "categories",
        priority: 5,
      });
    }

    if (summary?.byCategory && summary.byCategory.length > 0) {
      const topCat = summary.byCategory[0];
      if (topCat.percent > 40) {
        cards.push({
          id: "category-concentration",
          type: "info",
          icon: PieChart,
          title: `${topCat.name} Dominates at ${topCat.percent}% of Spend`,
          description: `${formatCurrency(topCat.total)} goes to "${topCat.name}" — consider whether this reflects healthy allocation.`,
          detail: "High category concentration may indicate operational dependency or an opportunity to diversify.",
          modules: ["Revenue"],
          priority: 4,
        });
      }

      const spikeCategories = summary.byCategory.filter(c => {
        if (!c.prevTotal || c.prevTotal < 50) return false;
        const change = ((c.total - c.prevTotal) / c.prevTotal) * 100;
        return change > 50;
      });
      if (spikeCategories.length > 0) {
        cards.push({
          id: "category-anomaly",
          type: "warning",
          icon: AlertTriangle,
          title: `${spikeCategories.length} Category Spending Anomal${spikeCategories.length > 1 ? "ies" : "y"}`,
          description: `${spikeCategories.map(c => c.name).join(", ")} show${spikeCategories.length === 1 ? "s" : ""} unusually high spending compared to the prior period.`,
          detail: `Largest spike: ${spikeCategories[0].name} at ${formatCurrency(spikeCategories[0].total)} vs ${formatCurrency(spikeCategories[0].prevTotal)} previously.`,
          modules: ["Revenue", "Reports"],
          actionLabel: "View Categories",
          actionTab: "categories",
          priority: 8,
        });
      }
    }

    if (recurringExpenseCount > 3) {
      const recurringTotal = expenses.filter(e => e.isRecurring).reduce((s, e) => s + e.amount, 0);
      cards.push({
        id: "recurring-cost",
        type: "info",
        icon: Zap,
        title: `${recurringExpenseCount} Recurring Expenses`,
        description: "Recurring costs are predictable but can drift upward over time. Review them periodically.",
        modules: ["Revenue", "Flows"],
        actionLabel: "Review Recurring",
        actionTab: "transactions",
        priority: 3,
      });
    }

    cards.sort((a, b) => b.priority - a.priority);
    return cards;
  }, [expenses, categories, summary, vendors, budgets, totalExpenseCount, uncategorizedExpenseCount, missingReceiptExpenseCount, recurringExpenseCount]);

  const marginAnalysis = useMemo(() => {
    const totalSpend = summary?.total ?? 0;
    if (totalSpend === 0) return null;

    const recurringTotal = expenses.filter(e => e.isRecurring).reduce((s, e) => s + e.amount, 0);
    const recurringPct = Math.round((recurringTotal / totalSpend) * 100);

    const costPerDay = summary?.dailyTrend?.length
      ? totalSpend / summary.dailyTrend.length
      : totalSpend / 30;

    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projectedMonthly = costPerDay * daysInMonth;
    const projectedRemaining = costPerDay * (daysInMonth - dayOfMonth);

    const prevTotal = summary?.comparison?.prevTotal ?? 0;
    const marginTrend = prevTotal > 0
      ? ((totalSpend - prevTotal) / prevTotal) * 100
      : 0;

    return {
      totalSpend,
      recurringTotal,
      recurringPct,
      costPerDay,
      projectedMonthly,
      projectedRemaining,
      marginTrend,
      prevTotal,
    };
  }, [summary, expenses]);

  const vendorDistribution = useMemo(() => {
    if (vendors.length === 0) return null;
    const totalSpend = summary?.total ?? 0;
    if (totalSpend === 0) return null;

    const topVendors = vendors.slice(0, 5).map(v => ({
      ...v,
      percent: Math.round((v.total / totalSpend) * 100),
    }));

    const top3Pct = topVendors.slice(0, 3).reduce((s, v) => s + v.percent, 0);
    const concentrationLevel = top3Pct > 70 ? "high" : top3Pct > 50 ? "moderate" : "healthy";

    return { topVendors, top3Pct, concentrationLevel, totalSpend };
  }, [vendors, summary]);

  const costControlGuidance = useMemo(() => {
    const tips: { id: string; icon: typeof Lightbulb; title: string; description: string; impact: "high" | "medium" | "low" }[] = [];
    const totalSpend = summary?.total ?? 0;

    if (recurringExpenseCount > 2) {
      tips.push({
        id: "audit-recurring",
        icon: Zap,
        title: "Audit Recurring Subscriptions",
        description: `${recurringExpenseCount} recurring expenses detected. Review for unused or duplicate services to reduce fixed costs.`,
        impact: "high",
      });
    }

    if (vendors.length > 0) {
      const topVendor = vendors[0];
      const vendorPct = totalSpend > 0 ? Math.round((topVendor.total / totalSpend) * 100) : 0;
      if (vendorPct > 30) {
        tips.push({
          id: "negotiate-vendor",
          icon: Users,
          title: `Negotiate with ${topVendor.name}`,
          description: `${topVendor.name} gets ${vendorPct}% of your spend (${formatCurrency(topVendor.total)}). High volume gives you leverage to negotiate 5-15% discounts.`,
          impact: "high",
        });
      }
      if (vendors.length >= 3) {
        const smallVendors = vendors.filter(v => v.count === 1);
        if (smallVendors.length > 3) {
          tips.push({
            id: "consolidate-vendors",
            icon: Store,
            title: "Consolidate Small Vendors",
            description: `${smallVendors.length} vendors used only once. Consolidating purchases can reduce fees and simplify bookkeeping.`,
            impact: "medium",
          });
        }
      }
    }

    if (uncategorizedExpenseCount > 5) {
      tips.push({
        id: "categorize-expenses",
        icon: PieChart,
        title: "Complete Expense Categorization",
        description: `${uncategorizedExpenseCount} uncategorized expenses. Categorization enables budget alerts and anomaly detection.`,
        impact: "medium",
      });
    }

    if (budgets.length > 0) {
      const wellManaged = budgets.filter(b => !b.isOverBudget && b.percentUsed < 80);
      if (wellManaged.length === budgets.length && budgets.length > 2) {
        tips.push({
          id: "tighten-budgets",
          icon: Target,
          title: "Tighten Budget Limits",
          description: `All ${budgets.length} budgets under 80%. Consider lowering limits to build a buffer and redirect savings.`,
          impact: "low",
        });
      }
    }

    const changePct = summary?.comparison?.changePercent ?? 0;
    if (changePct > 15) {
      tips.push({
        id: "spending-trend",
        icon: TrendingUp,
        title: "Address Rising Spend Trend",
        description: `Spending is up ${changePct.toFixed(0)}% vs prior period. Identify the top 2-3 categories driving the increase and set targeted budgets.`,
        impact: "high",
      });
    }

    if (summary?.byCategory && summary.byCategory.length > 0) {
      const spikeCats = summary.byCategory.filter(c => {
        if (!c.prevTotal || c.prevTotal < 50) return false;
        return ((c.total - c.prevTotal) / c.prevTotal) * 100 > 40;
      });
      if (spikeCats.length > 0) {
        tips.push({
          id: "investigate-spikes",
          icon: AlertTriangle,
          title: "Investigate Category Spikes",
          description: `${spikeCats.map(c => c.name).join(", ")} spiked this period. Determine if these are one-time costs or emerging patterns that need budget controls.`,
          impact: "high",
        });
      }
    }

    tips.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.impact] - order[b.impact];
    });
    return tips;
  }, [summary, vendors, budgets, uncategorizedExpenseCount, recurringExpenseCount]);

  const warningCount = insights.filter(i => i.type === "warning").length;
  const riskCount = insights.filter(i => i.type === "risk").length;
  const opportunityCount = insights.filter(i => i.type === "opportunity").length;

  if (totalExpenseCount === 0 && budgets.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="No insights available yet"
        description="Start tracking expenses, setting budgets, and adding categories to unlock spending intelligence and actionable recommendations."
        actionLabel="Add Expense"
        onAction={() => onNavigate("transactions")}
        tip="The more expense data you log, the smarter your insights become."
      />
    );
  }

  const visibleInsights = showAllInsights ? insights : insights.slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}>
          <Lightbulb className="w-3.5 h-3.5" />
          Spending Intelligence
        </div>
        {warningCount > 0 && (
          <span className="text-[10px] px-2 py-1 rounded-full font-medium" style={{ background: "hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))" }}>{warningCount} action{warningCount > 1 ? "s" : ""} required</span>
        )}
        {riskCount > 0 && (
          <span className="text-[10px] px-2 py-1 rounded-full font-medium" style={{ background: "hsl(var(--kf-warning) / 0.15)", color: "hsl(var(--kf-warning))" }}>{riskCount} to monitor</span>
        )}
        {opportunityCount > 0 && (
          <span className="text-[10px] px-2 py-1 rounded-full font-medium" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>{opportunityCount} opportunit{opportunityCount > 1 ? "ies" : "y"}</span>
        )}
      </div>

      {marginAnalysis && (
        <div className="kf-card rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Percent className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Margin & Cost Analysis
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-white/5 rounded-lg p-3">
              <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Total Spend</span>
              <span className="text-sm font-bold">{formatCurrency(marginAnalysis.totalSpend)}</span>
              {marginAnalysis.marginTrend !== 0 && (
                <span className="text-[10px] flex items-center gap-0.5 mt-0.5" style={{ color: marginAnalysis.marginTrend > 0 ? "hsl(var(--kf-error))" : "hsl(var(--kf-success))" }}>
                  {marginAnalysis.marginTrend > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {marginAnalysis.marginTrend > 0 ? "+" : ""}{marginAnalysis.marginTrend.toFixed(0)}% vs prev
                </span>
              )}
            </div>
            {marginData && marginData.totalRevenue > 0 ? (
              <>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Revenue</span>
                  <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-success))" }}>{formatCurrency(marginData.totalRevenue)}</span>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">{formatCurrency(marginData.paidRevenue)} collected</span>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Gross Profit</span>
                  <span className="text-sm font-bold" style={{ color: marginData.grossProfit >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>{formatCurrency(marginData.grossProfit)}</span>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">{marginData.grossMargin}% margin</span>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Expense Ratio</span>
                  <span className="text-sm font-bold" style={{ color: marginData.expenseToRevenueRatio > 80 ? "hsl(var(--kf-error))" : marginData.expenseToRevenueRatio > 60 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-success))" }}>{marginData.expenseToRevenueRatio}%</span>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">of revenue</span>
                </div>
              </>
            ) : (
              <>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Recurring</span>
                  <span className="text-sm font-bold">{formatCurrency(marginAnalysis.recurringTotal)}</span>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">{marginAnalysis.recurringPct}% of total</span>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Daily Burn</span>
                  <span className="text-sm font-bold">{formatCurrency(marginAnalysis.costPerDay)}</span>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">avg per day</span>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <span className="text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider block">Month Projection</span>
                  <span className="text-sm font-bold">{formatCurrency(marginAnalysis.projectedMonthly)}</span>
                  <span className="text-[10px] text-muted-foreground block mt-0.5">{formatCurrency(marginAnalysis.projectedRemaining)} remaining</span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full bg-muted/20 overflow-hidden flex">
              {marginData && marginData.totalRevenue > 0 ? (
                <>
                  <div
                    className="h-full rounded-l-full"
                    style={{ width: `${Math.min(marginData.expenseToRevenueRatio, 100)}%`, background: marginData.expenseToRevenueRatio > 80 ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent1))" }}
                    title="Expenses"
                  />
                  <div
                    className="h-full rounded-r-full"
                    style={{ width: `${Math.max(100 - marginData.expenseToRevenueRatio, 0)}%`, background: "hsl(var(--kf-success))" }}
                    title="Profit"
                  />
                </>
              ) : (
                <>
                  <div className="h-full rounded-l-full" style={{ width: `${marginAnalysis.recurringPct}%`, background: "hsl(var(--kf-accent1))" }} title="Recurring" />
                  <div className="h-full rounded-r-full" style={{ width: `${100 - marginAnalysis.recurringPct}%`, background: "hsl(var(--kf-accent2))" }} title="One-time" />
                </>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
              {marginData && marginData.totalRevenue > 0 ? (
                <>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} /> Expenses</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-success))" }} /> Profit</span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent1))" }} /> Recurring</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-accent2))" }} /> Variable</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {marginData && marginData.byClient.length > 0 && (
        <div className="kf-card rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Client Profitability
          </h3>
          <div className="space-y-2">
            {marginData.byClient.slice(0, 5).map((client) => (
              <div key={client.contactId} className="flex items-center gap-3">
                <span className="text-xs font-medium w-28 truncate">{client.name}</span>
                <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(Math.min(client.margin, 100), 0)}%` }}
                    transition={{ duration: 0.5 }}
                    className="h-full rounded-full"
                    style={{ background: client.margin >= 30 ? "hsl(var(--kf-success))" : client.margin >= 0 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))" }}
                  />
                </div>
                <span className="text-xs font-semibold w-20 text-right">{formatCurrency(client.profit)}</span>
                <span className={`text-[10px] w-10 text-right font-medium ${client.margin >= 30 ? "text-green-400" : client.margin >= 0 ? "text-amber-400" : "text-red-400"}`}>{client.margin}%</span>
              </div>
            ))}
          </div>
          {marginData.byClient.some(c => c.margin < 10) && (
            <div className="bg-white/[0.03] rounded-lg p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
              <div>
                <p className="text-xs font-medium">Low-Margin Client Alert</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {marginData.byClient.filter(c => c.margin < 10).length} client{marginData.byClient.filter(c => c.margin < 10).length > 1 ? "s" : ""} with margins below 10%. Review pricing or reduce costs for these accounts.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {marginData && marginData.byProject.length > 0 && (
        <div className="kf-card rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Project Profitability
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {marginData.byProject.map((proj) => (
              <div key={proj.projectId} className="bg-white/5 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold truncate">{proj.name}</span>
                  <span className="text-[10px] text-muted-foreground">{proj.count} expense{proj.count !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-red-400">Costs: {formatCurrency(proj.expenses)}</span>
                  {proj.revenue > 0 && <span className="text-emerald-400">Rev: {formatCurrency(proj.revenue)}</span>}
                </div>
                {proj.revenue > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={proj.profit >= 0 ? "text-emerald-400" : "text-red-400"}>
                        Profit: {formatCurrency(proj.profit)}
                      </span>
                      <span className={`font-bold ${proj.margin >= 20 ? "text-emerald-400" : proj.margin >= 0 ? "text-amber-400" : "text-red-400"}`}>
                        {proj.margin}%
                      </span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${proj.margin >= 20 ? "bg-emerald-500" : proj.margin >= 0 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(Math.max(proj.margin, 0), 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {marginData && marginData.byService.length > 0 && (
        <div className="kf-card rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Service Profitability
          </h3>
          <div className="space-y-2">
            {marginData.byService.map((svc) => (
              <div key={svc.serviceId} className="bg-white/5 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium flex-1 truncate">{svc.name}</span>
                  <span className="text-xs text-muted-foreground">{svc.count} item{svc.count !== 1 ? "s" : ""}</span>
                  <span className="text-xs text-red-400">{formatCurrency(svc.expenses)}</span>
                </div>
                {svc.revenue > 0 && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-emerald-400">Revenue: {formatCurrency(svc.revenue)}</span>
                    <span className={`font-bold ${svc.margin >= 20 ? "text-emerald-400" : svc.margin >= 0 ? "text-amber-400" : "text-red-400"}`}>
                      Margin: {svc.margin}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {vendorDistribution && (
        <div className="kf-card rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Store className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              Vendor Distribution
            </h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              vendorDistribution.concentrationLevel === "high"
                ? "bg-red-500/10 text-red-400"
                : vendorDistribution.concentrationLevel === "moderate"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-green-500/10 text-green-400"
            }`}>
              {vendorDistribution.concentrationLevel === "high" ? "High concentration" : vendorDistribution.concentrationLevel === "moderate" ? "Moderate concentration" : "Healthy distribution"}
            </span>
          </div>
          <div className="space-y-2">
            {vendorDistribution.topVendors.map((v, i) => (
              <div key={v.name} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">{i + 1}</span>
                <span className="text-xs font-medium w-28 truncate">{v.name}</span>
                <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${v.percent}%` }}
                    transition={{ duration: 0.5, delay: i * 0.08 }}
                    className="h-full rounded-full"
                    style={{ background: v.percent > 35 ? "hsl(var(--kf-error))" : v.percent > 20 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-accent2))" }}
                  />
                </div>
                <span className="text-xs font-semibold w-24 text-right">{formatCurrency(v.total)}</span>
                <span className="text-[10px] text-muted-foreground w-8 text-right">{v.percent}%</span>
              </div>
            ))}
          </div>
          {vendorDistribution.concentrationLevel !== "healthy" && (
            <div className="bg-white/[0.03] rounded-lg p-3 flex items-start gap-2.5">
              <Shield className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
              <div>
                <p className="text-xs font-medium">Diversification Recommendation</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Top 3 vendors account for {vendorDistribution.top3Pct}% of total spend.
                  {vendorDistribution.concentrationLevel === "high"
                    ? " Consider sourcing alternatives for your largest vendor to reduce supply-chain risk and create negotiation leverage."
                    : " Monitor vendor share and establish backup suppliers for critical categories."
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {costControlGuidance.length > 0 && (
        <div className="kf-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/40" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.06))" }}>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Brain className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              AI Cost-Control Guidance
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Smart recommendations based on your spending patterns</p>
          </div>
          <div className="divide-y divide-border/20">
            {costControlGuidance.map((tip, i) => {
              const TipIcon = tip.icon;
              return (
                <motion.div
                  key={tip.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="px-4 py-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-lg shrink-0 mt-0.5" style={{
                      background: tip.impact === "high" ? "hsl(var(--kf-error) / 0.1)" : tip.impact === "medium" ? "hsl(var(--kf-warning) / 0.1)" : "hsl(var(--kf-info) / 0.1)",
                    }}>
                      <TipIcon className="w-3.5 h-3.5" style={{
                        color: tip.impact === "high" ? "hsl(var(--kf-error))" : tip.impact === "medium" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-info))",
                      }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold">{tip.title}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                          tip.impact === "high" ? "bg-red-500/10 text-red-400" :
                          tip.impact === "medium" ? "bg-amber-500/10 text-amber-400" :
                          "bg-blue-500/10 text-blue-400"
                        }`}>{tip.impact}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{tip.description}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {insights.length === 0 ? (
        <div className="kf-card rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(var(--kf-success) / 0.1)" }}>
            <ShieldAlert className="w-6 h-6" style={{ color: "hsl(var(--kf-success))" }} />
          </div>
          <p className="text-sm font-semibold mb-1">All Clear</p>
          <p className="text-xs text-muted-foreground">No spending warnings or actionable insights at this time. Keep tracking to stay informed.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            {visibleInsights.map((insight, i) => {
              const style = TYPE_STYLES[insight.type];
              const Icon = insight.icon;
              return (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`kf-card rounded-xl border ${style.border} overflow-hidden`}
                >
                  <div className="p-4 space-y-3" style={{ background: style.bg }}>
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 rounded-lg shrink-0 mt-0.5" style={{ background: `${style.iconColor.replace(")", " / 0.15)")}` }}>
                        <Icon className="w-4 h-4" style={{ color: style.iconColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: style.badge, color: style.iconColor }}>{style.badgeLabel}</span>
                        </div>
                        <h4 className="text-sm font-semibold mb-1">{insight.title}</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
                        {insight.detail && (
                          <p className="text-[11px] text-muted-foreground/70 mt-1.5 italic">{insight.detail}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {insight.modules && insight.modules.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground/50">Affects:</span>
                          {insight.modules.map(mod => (
                            <span key={mod} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{mod}</span>
                          ))}
                        </div>
                      )}
                      {insight.actionLabel && insight.actionTab && (
                        <button
                          onClick={() => onNavigate(insight.actionTab!)}
                          className="flex items-center gap-1 text-[11px] font-medium transition-colors"
                          style={{ color: style.iconColor }}
                        >
                          {insight.actionLabel}
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
          {insights.length > 4 && (
            <button
              onClick={() => setShowAllInsights(!showAllInsights)}
              className="w-full py-2 text-xs text-muted-foreground hover:text-white transition-colors flex items-center justify-center gap-1"
            >
              {showAllInsights ? (
                <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
              ) : (
                <><ChevronDown className="w-3.5 h-3.5" /> Show {insights.length - 4} more insight{insights.length - 4 > 1 ? "s" : ""}</>
              )}
            </button>
          )}
        </>
      )}

      <div className="kf-card rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Cross-Module Data Propagation
        </h3>
        <p className="text-xs text-muted-foreground">Expense data flows into project cost panels, client profitability, and service pricing across your platform.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Revenue", icon: DollarSign, desc: marginData && marginData.totalRevenue > 0 ? `${marginData.grossMargin}% margin` : "Margin & profitability", color: "hsl(var(--kf-success))", active: !!(marginData && marginData.totalRevenue > 0) },
            { label: "Projects", icon: BarChart3, desc: marginData && marginData.byProject.length > 0 ? `${marginData.byProject.length} linked` : "Cost tracking", color: "hsl(var(--kf-info))", active: !!(marginData && marginData.byProject.length > 0) },
            { label: "Clients", icon: Users, desc: marginData && marginData.byClient.length > 0 ? `${marginData.byClient.length} tracked` : "Profitability", color: "hsl(var(--kf-accent2))", active: !!(marginData && marginData.byClient.length > 0) },
            { label: "Services", icon: Sparkles, desc: marginData && marginData.byService.length > 0 ? `${marginData.byService.length} costed` : "Pricing impact", color: "hsl(var(--kf-accent1))", active: !!(marginData && marginData.byService.length > 0) },
          ].map(mod => (
            <div key={mod.label} className={`bg-white/5 rounded-lg p-3 flex items-center gap-2.5 ${mod.active ? "ring-1 ring-white/10" : ""}`}>
              <div className="p-1.5 rounded-lg" style={{ background: `${mod.color.replace(")", " / 0.1)")}` }}>
                <mod.icon className="w-3.5 h-3.5" style={{ color: mod.color }} />
              </div>
              <div>
                <p className="text-xs font-medium">{mod.label}</p>
                <p className="text-[10px] text-muted-foreground">{mod.desc}</p>
              </div>
              {mod.active && <span className="w-1.5 h-1.5 rounded-full ml-auto shrink-0" style={{ background: "hsl(var(--kf-success))" }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
