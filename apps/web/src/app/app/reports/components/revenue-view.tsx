"use client";

import { DollarSign, TrendingUp, FileText, AlertTriangle, CheckCircle2, Users } from "lucide-react";
import Link from "next/link";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge, ProgressBar, CollapsibleSection } from "./shared-components";
import { RevenueProjectionChart } from "./revenue-projection-chart";

export function RevenueView({ report, businessId }: { report: GeneratedReport; businessId?: string | null }) {
  const m = report.metrics;
  const c = report.comparison;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/app/commerce?tab=invoices">
          <MetricCard
            label="Total Revenue"
            value={formatCurrency(m.revenue.total, m.currency)}
            icon={DollarSign}
            color="text-[hsl(var(--kf-success))]"
            trendPct={c?.revenue.changePct}
            prevValue={c ? formatCurrency(c.revenue.total, m.currency) : undefined}
            explanation="Total collected revenue from all paid invoices in the selected period."
            goodValue="Track month-over-month for growth trends."
          />
        </Link>
        <MetricCard
          label="Avg Invoice"
          value={formatCurrency(m.revenue.averageInvoice, m.currency)}
          icon={FileText}
          color="text-[hsl(var(--kf-info))]"
          explanation="Average value across all paid invoices."
          formula="Total Revenue / Number of Invoices"
          goodValue="Higher averages indicate upselling success."
        />
        <Link href="/app/commerce?tab=invoices&filter=overdue">
          <MetricCard
            label="Outstanding"
            value={formatCurrency(m.revenue.outstanding, m.currency)}
            subtext={`${m.revenue.overdueCount} overdue`}
            icon={AlertTriangle}
            color="text-[hsl(var(--kf-warning))]"
            explanation="Total amount owed from unpaid invoices. Overdue invoices need follow-up."
            goodValue="Keep below 20% of total revenue."
          />
        </Link>
        <MetricCard
          label="Invoices Paid"
          value={m.revenue.invoiceCount.toString()}
          icon={CheckCircle2}
          color="text-[hsl(var(--kf-success))]"
          trendPct={c ? (c.revenue.invoiceCount > 0 ? Math.round(((m.revenue.invoiceCount - c.revenue.invoiceCount) / c.revenue.invoiceCount) * 1000) / 10 : 0) : undefined}
          prevValue={c ? c.revenue.invoiceCount.toString() : undefined}
          explanation="Number of invoices fully paid in this period."
        />
      </div>

      <CollapsibleSection title="Revenue Analysis" icon={TrendingUp} defaultOpen persistKey="rev-analysis">
        <NarrativeSection content={report.aiNarrative} />
      </CollapsibleSection>

      <RevenueProjectionChart
        businessId={businessId}
        currency={m.currency}
        currentRevenue={m.revenue.total}
        periodStart={m.period.start}
        periodEnd={m.period.end}
        invoiceCount={m.revenue.invoiceCount}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <CollapsibleSection title="Invoice Status Breakdown" defaultOpen persistKey="rev-status-breakdown">
          <div className="space-y-3">
            {Object.entries(m.revenue.byStatus).map(([status, data]) => (
              <div key={status} className="space-y-1">
                <div className="flex justify-between items-center">
                  <StatusBadge status={status} />
                  <span className="text-xs text-muted-foreground">{data.count} invoices - {formatCurrency(data.total, m.currency)}</span>
                </div>
                <ProgressBar
                  value={data.total}
                  max={m.revenue.total || 1}
                  color={status === "PAID" ? "hsl(var(--kf-success))" : status === "OVERDUE" ? "hsl(var(--kf-error))" : "hsl(var(--kf-warning))"}
                />
              </div>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Top Clients by Revenue" defaultOpen persistKey="rev-top-clients">
          <DataTable
            headers={["Client", "Revenue"]}
            rows={m.revenue.topClients.map(cl => [cl.name, formatCurrency(cl.total, m.currency)])}
            onRowClick={(_idx) => { window.location.href = "/app/network/contacts"; }}
            emptyState={
              <EmptyState
                icon={Users}
                title="No client revenue data"
                description="No paid invoices found for this period."
                actionLabel="Go to Invoices"
                onAction={() => { window.location.href = "/app/commerce?tab=invoices"; }}
                tip="Revenue is tracked from paid invoices linked to contacts."
              />
            }
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
