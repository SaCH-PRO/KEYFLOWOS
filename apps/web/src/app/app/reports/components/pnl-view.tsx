"use client";

import { DollarSign, TrendingUp, ArrowDownRight, PieChart, FileText, Wallet } from "lucide-react";
import Link from "next/link";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge, CollapsibleSection } from "./shared-components";

export function PnlView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  const c = report.comparison;
  const revenueItems = Object.entries(m.revenue.byStatus).map(([status, data]) => ({
    status, count: data.count, total: data.total,
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/app/commerce?tab=invoices">
          <MetricCard
            label="Revenue"
            value={formatCurrency(m.revenue.total, m.currency)}
            subtext={`${m.revenue.invoiceCount} invoices`}
            icon={TrendingUp}
            color="text-[hsl(var(--kf-success))]"
            trend="up"
            trendPct={c?.revenue.changePct}
            prevValue={c ? formatCurrency(c.revenue.total, m.currency) : undefined}
            explanation="Gross revenue from paid invoices."
          />
        </Link>
        <Link href="/app/expenses">
          <MetricCard
            label="Expenses"
            value={formatCurrency(m.expenses.total, m.currency)}
            subtext={`${m.expenses.count} entries`}
            icon={ArrowDownRight}
            color="text-[hsl(var(--kf-error))]"
            trendPct={c ? -c.expenses.changePct : undefined}
            prevValue={c ? formatCurrency(c.expenses.total, m.currency) : undefined}
            explanation="Total business costs including operating expenses, supplies, and services."
          />
        </Link>
        <MetricCard
          label="Net Profit"
          value={formatCurrency(m.profitability.netProfit, m.currency)}
          subtext={`${m.profitability.profitMargin}% margin`}
          icon={DollarSign}
          color={m.profitability.netProfit >= 0 ? "text-[hsl(var(--kf-success))]" : "text-[hsl(var(--kf-error))]"}
          trend={m.profitability.netProfit >= 0 ? "up" : "down"}
          trendPct={c?.profitability.changePct}
          prevValue={c ? formatCurrency(c.profitability.netProfit, m.currency) : undefined}
          explanation="Bottom line after all expenses."
          formula="Revenue - Expenses"
          goodValue="Healthy businesses maintain 15-30% margins."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CollapsibleSection title="Revenue Breakdown" icon={TrendingUp} defaultOpen persistKey="pnl-revenue-breakdown">
          <DataTable
            headers={["Status", "Count", "Amount"]}
            rows={revenueItems.map(r => [
              <StatusBadge key={r.status} status={r.status} />,
              r.count.toString(),
              formatCurrency(r.total, m.currency),
            ])}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Expense Breakdown" icon={PieChart} defaultOpen persistKey="pnl-expense-breakdown">
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
                description="No expenses recorded for this period."
                actionLabel="Go to Expenses"
                onAction={() => { window.location.href = "/app/expenses"; }}
                tip="Categorize expenses to see a full breakdown here."
              />
            }
          />
        </CollapsibleSection>
      </div>

      <CollapsibleSection title="P&L Analysis" icon={FileText} defaultOpen persistKey="pnl-analysis">
        <NarrativeSection content={report.aiNarrative} />
      </CollapsibleSection>

      <div className="kf-card p-4">
        <h3 className="text-sm font-semibold mb-3">Financial Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-border/20">
            <span className="text-sm text-muted-foreground">Gross Revenue</span>
            <span className="text-sm font-medium" style={{ color: "hsl(var(--kf-success))" }}>{formatCurrency(m.revenue.total, m.currency)}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-border/20">
            <span className="text-sm text-muted-foreground">Total Expenses</span>
            <span className="text-sm font-medium" style={{ color: "hsl(var(--kf-error))" }}>({formatCurrency(m.expenses.total, m.currency)})</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-border/20">
            <span className="text-sm font-semibold">Net Profit / (Loss)</span>
            <span className={`text-sm font-bold`} style={{ color: m.profitability.netProfit >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>
              {m.profitability.netProfit < 0 ? "(" : ""}{formatCurrency(Math.abs(m.profitability.netProfit), m.currency)}{m.profitability.netProfit < 0 ? ")" : ""}
            </span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-muted-foreground">Profit Margin</span>
            <span className="text-sm font-medium" style={{ color: m.profitability.profitMargin >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>
              {m.profitability.profitMargin}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
