"use client";

import { Card } from "@keyflow/ui";
import {
  DollarSign, TrendingUp, Users, Calendar, Wallet,
  AlertTriangle, Briefcase, Target
} from "lucide-react";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, ProgressBar } from "./shared-components";

export function ExecutiveView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Revenue" value={formatCurrency(m.revenue.total, m.currency)} subtext={`${m.revenue.invoiceCount} paid invoices`} icon={DollarSign} color="text-emerald-400" trend="up" />
        <MetricCard label="Total Expenses" value={formatCurrency(m.expenses.total, m.currency)} subtext={`${m.expenses.count} expense entries`} icon={Wallet} color="text-red-400" />
        <MetricCard label="Net Profit" value={formatCurrency(m.profitability.netProfit, m.currency)} subtext={`${m.profitability.profitMargin}% margin`} icon={TrendingUp} color={m.profitability.netProfit >= 0 ? "text-emerald-400" : "text-red-400"} trend={m.profitability.netProfit >= 0 ? "up" : "down"} />
        <MetricCard label="Total Contacts" value={m.clients.totalContacts.toString()} subtext={`${m.bookings.total} bookings this period`} icon={Users} color="text-blue-400" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium uppercase tracking-wide">Outstanding</span>
          </div>
          <div className="text-xl font-bold text-amber-400">{formatCurrency(m.revenue.outstanding, m.currency)}</div>
          <div className="text-xs text-muted-foreground">{m.revenue.outstandingCount} invoices ({m.revenue.overdueCount} overdue)</div>
        </Card>
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60 space-y-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-medium uppercase tracking-wide">Avg Invoice</span>
          </div>
          <div className="text-xl font-bold">{formatCurrency(m.revenue.averageInvoice, m.currency)}</div>
          <div className="text-xs text-muted-foreground">Per paid invoice</div>
        </Card>
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60 space-y-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-medium uppercase tracking-wide">Bookings</span>
          </div>
          <div className="text-xl font-bold">{m.bookings.completed}/{m.bookings.total}</div>
          <div className="text-xs text-muted-foreground">{m.bookings.completionRate}% completion rate</div>
        </Card>
      </div>

      <Card className="p-5 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center gap-2 mb-4">
          <Briefcase className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">AI Executive Analysis</h3>
        </div>
        <NarrativeSection content={report.aiNarrative} />
      </Card>

      <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Target className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          Top Revenue Clients
        </h3>
        <DataTable
          headers={["Client", "Revenue", "Share"]}
          rows={m.revenue.topClients.map(c => [
            c.name,
            formatCurrency(c.total, m.currency),
            <ProgressBar key={c.name} value={c.total} max={m.revenue.topClients[0]?.total || 1} />
          ])}
          emptyState={
            <EmptyState
              icon={Users}
              title="No client data"
              description="No revenue data found for this period. Try selecting a wider date range."
              tip="Client revenue is calculated from paid invoices."
            />
          }
        />
      </Card>
    </div>
  );
}
