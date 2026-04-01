"use client";

import { Card } from "@keyflow/ui";
import { DollarSign, TrendingUp, FileText, AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge, ProgressBar } from "./shared-components";
import { RevenueProjectionChart } from "./revenue-projection-chart";

export function RevenueView({ report, businessId }: { report: GeneratedReport; businessId?: string | null }) {
  const m = report.metrics;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Revenue" value={formatCurrency(m.revenue.total, m.currency)} icon={DollarSign} color="text-[hsl(var(--kf-success))]" />
        <MetricCard label="Avg Invoice" value={formatCurrency(m.revenue.averageInvoice, m.currency)} icon={FileText} color="text-[hsl(var(--kf-info))]" />
        <MetricCard label="Outstanding" value={formatCurrency(m.revenue.outstanding, m.currency)} subtext={`${m.revenue.overdueCount} overdue`} icon={AlertTriangle} color="text-[hsl(var(--kf-warning))]" />
        <MetricCard label="Invoices Paid" value={m.revenue.invoiceCount.toString()} icon={CheckCircle2} color="text-[hsl(var(--kf-success))]" />
      </div>

      <Card className="p-5 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">Revenue Analysis</h3>
        </div>
        <NarrativeSection content={report.aiNarrative} />
      </Card>

      <RevenueProjectionChart
        businessId={businessId}
        currency={m.currency}
        currentRevenue={m.revenue.total}
        periodStart={m.period.start}
        periodEnd={m.period.end}
        invoiceCount={m.revenue.invoiceCount}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
          <h3 className="text-sm font-semibold mb-3">Invoice Status Breakdown</h3>
          <div className="space-y-3">
            {Object.entries(m.revenue.byStatus).map(([status, data]) => (
              <div key={status} className="space-y-1">
                <div className="flex justify-between items-center">
                  <StatusBadge status={status} />
                  <span className="text-xs text-muted-foreground">{data.count} invoices · {formatCurrency(data.total, m.currency)}</span>
                </div>
                <ProgressBar value={data.total} max={m.revenue.total || 1} color={status === "PAID" ? "bg-[hsl(var(--kf-success))]" : status === "OVERDUE" ? "bg-[hsl(var(--kf-error))]" : "bg-[hsl(var(--kf-warning))]"} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
          <h3 className="text-sm font-semibold mb-3">Top Clients by Revenue</h3>
          <DataTable
            headers={["Client", "Revenue"]}
            rows={m.revenue.topClients.map(c => [c.name, formatCurrency(c.total, m.currency)])}
            emptyState={
              <EmptyState
                icon={Users}
                title="No client revenue data"
                description="No paid invoices found for this period. Try selecting a wider date range."
                actionLabel="Go to Invoices"
                onAction={() => { window.location.href = "/app/commerce?tab=invoices"; }}
                tip="Revenue is tracked from paid invoices linked to contacts."
              />
            }
          />
        </Card>
      </div>
    </div>
  );
}
