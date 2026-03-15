"use client";

import { Card } from "@keyflow/ui";
import { DollarSign, TrendingUp, FileText, AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge, ProgressBar } from "./shared-components";

export function RevenueView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Revenue" value={formatCurrency(m.revenue.total, m.currency)} icon={DollarSign} color="text-emerald-400" />
        <MetricCard label="Avg Invoice" value={formatCurrency(m.revenue.averageInvoice, m.currency)} icon={FileText} color="text-blue-400" />
        <MetricCard label="Outstanding" value={formatCurrency(m.revenue.outstanding, m.currency)} subtext={`${m.revenue.overdueCount} overdue`} icon={AlertTriangle} color="text-amber-400" />
        <MetricCard label="Invoices Paid" value={m.revenue.invoiceCount.toString()} icon={CheckCircle2} color="text-emerald-400" />
      </div>

      <Card className="p-5 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">Revenue Analysis</h3>
        </div>
        <NarrativeSection content={report.aiNarrative} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">Invoice Status Breakdown</h3>
          <div className="space-y-3">
            {Object.entries(m.revenue.byStatus).map(([status, data]) => (
              <div key={status} className="space-y-1">
                <div className="flex justify-between items-center">
                  <StatusBadge status={status} />
                  <span className="text-xs text-muted-foreground">{data.count} invoices · {formatCurrency(data.total, m.currency)}</span>
                </div>
                <ProgressBar value={data.total} max={m.revenue.total || 1} color={status === "PAID" ? "bg-emerald-400" : status === "OVERDUE" ? "bg-red-400" : "bg-amber-400"} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">Top Clients by Revenue</h3>
          <DataTable
            headers={["Client", "Revenue"]}
            rows={m.revenue.topClients.map(c => [c.name, formatCurrency(c.total, m.currency)])}
            emptyState={
              <EmptyState
                icon={Users}
                title="No client revenue data"
                description="No paid invoices found for this period. Try selecting a wider date range."
                tip="Revenue is tracked from paid invoices linked to contacts."
              />
            }
          />
        </Card>
      </div>
    </div>
  );
}
