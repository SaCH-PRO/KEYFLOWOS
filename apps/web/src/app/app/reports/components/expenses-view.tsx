"use client";

import { BarChart3, TrendingUp, PieChart, Wallet, Store } from "lucide-react";
import Link from "next/link";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, ProgressBar, CollapsibleSection } from "./shared-components";

export function ExpensesView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  const c = report.comparison;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/app/expenses">
          <MetricCard
            label="Total Expenses"
            value={formatCurrency(m.expenses.total, m.currency)}
            subtext={`${m.expenses.count} entries`}
            icon={Wallet}
            color="text-[hsl(var(--kf-error))]"
            trendPct={c ? -c.expenses.changePct : undefined}
            prevValue={c ? formatCurrency(c.expenses.total, m.currency) : undefined}
            explanation="Sum of all expense entries logged in this period."
          />
        </Link>
        <MetricCard
          label="Avg Expense"
          value={formatCurrency(m.expenses.averageExpense, m.currency)}
          icon={BarChart3}
          color="text-[hsl(var(--kf-warning))]"
          explanation="Average cost per expense entry."
          formula="Total Expenses / Number of Entries"
          goodValue="Track trends to catch spending creep."
        />
        <MetricCard
          label="Cost-to-Revenue"
          value={m.profitability.revenueToExpenseRatio ? `${m.profitability.revenueToExpenseRatio}x` : "N/A"}
          subtext={m.profitability.revenueToExpenseRatio && m.profitability.revenueToExpenseRatio > 1 ? "Revenue exceeds costs" : "Costs exceed revenue"}
          icon={TrendingUp}
          color={m.profitability.revenueToExpenseRatio && m.profitability.revenueToExpenseRatio > 1 ? "text-[hsl(var(--kf-success))]" : "text-[hsl(var(--kf-error))]"}
          explanation="How many times your revenue covers your expenses."
          formula="Total Revenue / Total Expenses"
          goodValue="Above 2x means healthy margins. Below 1x means spending more than earning."
        />
      </div>

      <CollapsibleSection title="Expense Analysis" icon={PieChart} defaultOpen persistKey="exp-analysis">
        <NarrativeSection content={report.aiNarrative} />
      </CollapsibleSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <CollapsibleSection title="By Category" defaultOpen persistKey="exp-by-category">
          <div className="space-y-3">
            {m.expenses.byCategory.map(cat => (
              <div key={cat.category} className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-sm">{cat.category}</span>
                  <span className="text-xs text-muted-foreground">{formatCurrency(cat.total, m.currency)} ({cat.count})</span>
                </div>
                <ProgressBar value={cat.total} max={m.expenses.byCategory[0]?.total || 1} color="hsl(var(--kf-error))" />
              </div>
            ))}
            {m.expenses.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No categorized expenses</p>}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Top Vendors" defaultOpen persistKey="exp-top-vendors">
          <DataTable
            headers={["Vendor", "Total Spent"]}
            rows={m.expenses.topVendors.map(v => [v.vendor, formatCurrency(v.total, m.currency)])}
            emptyState={
              <EmptyState
                icon={Store}
                title="No vendor data"
                description="No vendor expenses found for this period."
                actionLabel="Go to Expenses"
                onAction={() => { window.location.href = "/app/expenses"; }}
                tip="Assign vendors to expenses to track spending per supplier."
              />
            }
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
