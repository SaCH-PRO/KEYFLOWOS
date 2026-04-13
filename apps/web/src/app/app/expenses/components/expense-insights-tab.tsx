"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, TrendingUp, TrendingDown, Store, FileQuestion, Receipt,
  Target, BarChart3, Lightbulb, ArrowRight, PieChart, ShieldAlert,
  Zap, DollarSign, FileText,
} from "lucide-react";
import { Expense, ExpenseCategory, ExpenseSummary, VendorAnalytics, ExpenseBudget } from "@/lib/client";
import { formatCurrency } from "./expense-utils";
import { EmptyState } from "@/components/ui/empty-state";

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
  onNavigate: (tab: TabKey) => void;
}

const TYPE_STYLES: Record<string, { border: string; bg: string; iconColor: string; badge: string; badgeLabel: string }> = {
  warning: { border: "border-red-500/30", bg: "hsl(var(--kf-error) / 0.05)", iconColor: "hsl(var(--kf-error))", badge: "hsl(var(--kf-error) / 0.15)", badgeLabel: "Action Required" },
  risk: { border: "border-amber-500/30", bg: "hsl(var(--kf-warning) / 0.05)", iconColor: "hsl(var(--kf-warning))", badge: "hsl(var(--kf-warning) / 0.15)", badgeLabel: "Monitor" },
  opportunity: { border: "border-emerald-500/30", bg: "hsl(var(--kf-success) / 0.05)", iconColor: "hsl(var(--kf-success))", badge: "hsl(var(--kf-success) / 0.15)", badgeLabel: "Opportunity" },
  info: { border: "border-blue-500/30", bg: "hsl(var(--kf-info) / 0.05)", iconColor: "hsl(var(--kf-info))", badge: "hsl(var(--kf-info) / 0.15)", badgeLabel: "Insight" },
};

export function ExpenseInsightsTab({ expenses, categories, summary, vendors, budgets, onNavigate }: ExpenseInsightsTabProps) {
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

    const uncategorized = expenses.filter(e => !e.categoryId);
    if (uncategorized.length > 0) {
      cards.push({
        id: "uncategorized",
        type: uncategorized.length > 5 ? "warning" : "risk",
        icon: FileQuestion,
        title: `${uncategorized.length} Uncategorized Expense${uncategorized.length > 1 ? "s" : ""}`,
        description: `Uncategorized expenses reduce budget tracking accuracy and weaken financial reports.`,
        detail: `${formatCurrency(uncategorized.reduce((s, e) => s + e.amount, 0))} in spend has no category assignment.`,
        modules: ["Reports", "Documents"],
        actionLabel: "Review & Categorize",
        actionTab: "transactions",
        priority: uncategorized.length > 5 ? 9 : 5,
      });
    }

    const missingReceipts = expenses.filter(e => !e.receiptUrl);
    if (missingReceipts.length > 3 && expenses.length > 0) {
      const missingPct = Math.round((missingReceipts.length / expenses.length) * 100);
      cards.push({
        id: "missing-receipts",
        type: "info",
        icon: Receipt,
        title: `${missingReceipts.length} Expenses Missing Receipts (${missingPct}%)`,
        description: "Attaching receipts improves tax compliance, audit readiness, and financial document accuracy.",
        modules: ["Documents", "Reports"],
        actionLabel: "View Expenses",
        actionTab: "transactions",
        priority: 4,
      });
    }

    if (budgets.length === 0 && expenses.length > 5) {
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

    if (categories.length === 0 && expenses.length > 0) {
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
    }

    const recurring = expenses.filter(e => e.isRecurring);
    if (recurring.length > 3) {
      const recurringTotal = recurring.reduce((s, e) => s + e.amount, 0);
      cards.push({
        id: "recurring-cost",
        type: "info",
        icon: Zap,
        title: `${recurring.length} Recurring Expenses (${formatCurrency(recurringTotal)})`,
        description: "Recurring costs are predictable but can drift upward over time. Review them periodically.",
        modules: ["Revenue", "Flows"],
        actionLabel: "Review Recurring",
        actionTab: "transactions",
        priority: 3,
      });
    }

    cards.sort((a, b) => b.priority - a.priority);
    return cards;
  }, [expenses, categories, summary, vendors, budgets]);

  const warningCount = insights.filter(i => i.type === "warning").length;
  const riskCount = insights.filter(i => i.type === "risk").length;
  const opportunityCount = insights.filter(i => i.type === "opportunity").length;

  if (expenses.length === 0 && budgets.length === 0) {
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

      {insights.length === 0 ? (
        <div className="kf-card rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(var(--kf-success) / 0.1)" }}>
            <ShieldAlert className="w-6 h-6" style={{ color: "hsl(var(--kf-success))" }} />
          </div>
          <p className="text-sm font-semibold mb-1">All Clear</p>
          <p className="text-xs text-muted-foreground">No spending warnings or actionable insights at this time. Keep tracking to stay informed.</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          {insights.map((insight, i) => {
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
      )}

      <div className="kf-card rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Cross-Module Connections
        </h3>
        <p className="text-xs text-muted-foreground">Expenses feed intelligence across your entire business platform.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Revenue", icon: DollarSign, desc: "Margin & profitability", color: "hsl(var(--kf-success))" },
            { label: "Reports", icon: BarChart3, desc: "Financial summaries", color: "hsl(var(--kf-info))" },
            { label: "Documents", icon: FileText, desc: "Tax & compliance", color: "hsl(var(--kf-accent2))" },
            { label: "Flows", icon: Zap, desc: "Budget alerts", color: "hsl(var(--kf-accent1))" },
          ].map(mod => (
            <div key={mod.label} className="bg-white/5 rounded-lg p-3 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg" style={{ background: `${mod.color.replace(")", " / 0.1)")}` }}>
                <mod.icon className="w-3.5 h-3.5" style={{ color: mod.color }} />
              </div>
              <div>
                <p className="text-xs font-medium">{mod.label}</p>
                <p className="text-[10px] text-muted-foreground">{mod.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
