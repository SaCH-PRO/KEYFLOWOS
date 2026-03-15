"use client";

import { Card } from "@keyflow/ui";
import { BarChart3, TrendingUp, PieChart, Wallet, Store } from "lucide-react";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, ProgressBar } from "./shared-components";

export function ExpensesView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total Expenses" value={formatCurrency(m.expenses.total, m.currency)} subtext={`${m.expenses.count} entries`} icon={Wallet} color="text-red-400" />
        <MetricCard label="Avg Expense" value={formatCurrency(m.expenses.averageExpense, m.currency)} icon={BarChart3} color="text-amber-400" />
        <MetricCard label="Cost-to-Revenue" value={m.profitability.revenueToExpenseRatio ? `${m.profitability.revenueToExpenseRatio}x` : "N/A"} subtext={m.profitability.revenueToExpenseRatio && m.profitability.revenueToExpenseRatio > 1 ? "Revenue exceeds costs" : "Costs exceed revenue"} icon={TrendingUp} color={m.profitability.revenueToExpenseRatio && m.profitability.revenueToExpenseRatio > 1 ? "text-emerald-400" : "text-red-400"} />
      </div>

      <Card className="p-5 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center gap-2 mb-4">
          <PieChart className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">Expense Analysis</h3>
        </div>
        <NarrativeSection content={report.aiNarrative} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">By Category</h3>
          <div className="space-y-3">
            {m.expenses.byCategory.map(cat => (
              <div key={cat.category} className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-sm">{cat.category}</span>
                  <span className="text-xs text-muted-foreground">{formatCurrency(cat.total, m.currency)} ({cat.count})</span>
                </div>
                <ProgressBar value={cat.total} max={m.expenses.byCategory[0]?.total || 1} color="bg-red-400" />
              </div>
            ))}
            {m.expenses.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No categorized expenses</p>}
          </div>
        </Card>

        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">Top Vendors</h3>
          <DataTable
            headers={["Vendor", "Total Spent"]}
            rows={m.expenses.topVendors.map(v => [v.vendor, formatCurrency(v.total, m.currency)])}
            emptyState={
              <EmptyState
                icon={Store}
                title="No vendor data"
                description="No vendor expenses found for this period. Try selecting a wider date range."
                actionLabel="Go to Expenses"
                onAction={() => { window.location.href = "/app/expenses"; }}
                tip="Assign vendors to expenses to track spending per supplier."
              />
            }
          />
        </Card>
      </div>
    </div>
  );
}
