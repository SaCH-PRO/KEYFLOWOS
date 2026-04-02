"use client";

import { Card } from "@keyflow/ui";
import { DollarSign, TrendingUp, ArrowDownRight, PieChart, FileText, Wallet } from "lucide-react";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge } from "./shared-components";

export function PnlView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  const revenueItems = Object.entries(m.revenue.byStatus).map(([status, data]) => ({
    status, count: data.count, total: data.total,
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Revenue" value={formatCurrency(m.revenue.total, m.currency)} subtext={`${m.revenue.invoiceCount} invoices`} icon={TrendingUp} color="text-emerald-400" trend="up" explanation="Gross revenue from paid invoices." />
        <MetricCard label="Expenses" value={formatCurrency(m.expenses.total, m.currency)} subtext={`${m.expenses.count} entries`} icon={ArrowDownRight} color="text-red-400" explanation="Total business costs including operating expenses, supplies, and services." />
        <MetricCard label="Net Profit" value={formatCurrency(m.profitability.netProfit, m.currency)} subtext={`${m.profitability.profitMargin}% margin`} icon={DollarSign} color={m.profitability.netProfit >= 0 ? "text-emerald-400" : "text-red-400"} trend={m.profitability.netProfit >= 0 ? "up" : "down"} explanation="Bottom line after all expenses. The profit margin shows what percentage of revenue is kept as profit." formula="Revenue − Expenses" goodValue="Healthy businesses maintain 15-30% margins." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" /> Revenue Breakdown
          </h3>
          <DataTable
            headers={["Status", "Count", "Amount"]}
            rows={revenueItems.map(r => [
              <StatusBadge key={r.status} status={r.status} />,
              r.count.toString(),
              formatCurrency(r.total, m.currency),
            ])}
          />
        </Card>

        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-red-400" /> Expense Breakdown
          </h3>
          <DataTable
            headers={["Category", "Count", "Amount"]}
            rows={m.expenses.byCategory.map(e => [
              e.category,
              e.count.toString(),
              formatCurrency(e.total, m.currency),
            ])}
            emptyState={
              <EmptyState
                icon={Wallet}
                title="No expense data"
                description="No expenses recorded for this period. Try selecting a wider date range."
                actionLabel="Go to Expenses"
                onAction={() => { window.location.href = "/app/expenses"; }}
                tip="Categorize expenses to see a full breakdown here."
              />
            }
          />
        </Card>
      </div>

      <Card className="p-5 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">P&L Analysis</h3>
        </div>
        <NarrativeSection content={report.aiNarrative} />
      </Card>

      <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
        <h3 className="text-sm font-semibold mb-3">Financial Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-border/20">
            <span className="text-sm text-muted-foreground">Gross Revenue</span>
            <span className="text-sm font-medium text-emerald-400">{formatCurrency(m.revenue.total, m.currency)}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-border/20">
            <span className="text-sm text-muted-foreground">Total Expenses</span>
            <span className="text-sm font-medium text-red-400">({formatCurrency(m.expenses.total, m.currency)})</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-border/20">
            <span className="text-sm font-semibold">Net Profit / (Loss)</span>
            <span className={`text-sm font-bold ${m.profitability.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {m.profitability.netProfit < 0 ? "(" : ""}{formatCurrency(Math.abs(m.profitability.netProfit), m.currency)}{m.profitability.netProfit < 0 ? ")" : ""}
            </span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-muted-foreground">Profit Margin</span>
            <span className={`text-sm font-medium ${m.profitability.profitMargin >= 0 ? "text-emerald-400" : "text-red-400"}`}>{m.profitability.profitMargin}%</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
