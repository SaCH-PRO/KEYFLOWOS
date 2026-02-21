"use client";

import { Card } from "@keyflow/ui";
import { Users, Calendar, DollarSign, Building2 } from "lucide-react";
import { GeneratedReport } from "@/lib/client";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge, ProgressBar } from "./shared-components";

export function ClientsView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Contacts" value={m.clients.totalContacts.toString()} icon={Users} color="text-blue-400" />
        <MetricCard label="Bookings" value={m.bookings.total.toString()} subtext={`${m.bookings.completionRate}% completed`} icon={Calendar} color="text-purple-400" />
        <MetricCard label="Products/Services" value={m.products.total.toString()} icon={Building2} color="text-[hsl(var(--kf-accent1))]" />
        <MetricCard label="Revenue Per Client" value={m.clients.totalContacts > 0 ? formatCurrency(m.revenue.total / m.clients.totalContacts, m.currency) : "N/A"} icon={DollarSign} color="text-emerald-400" />
      </div>

      <Card className="p-5 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">Client Portfolio Analysis</h3>
        </div>
        <NarrativeSection content={report.aiNarrative} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">Contact Segmentation</h3>
          <div className="space-y-3">
            {m.clients.byStatus.map(s => (
              <div key={s.status} className="space-y-1">
                <div className="flex justify-between items-center">
                  <StatusBadge status={s.status} />
                  <span className="text-xs text-muted-foreground">{s.count} contacts</span>
                </div>
                <ProgressBar value={s.count} max={m.clients.totalContacts || 1} color="bg-blue-400" />
              </div>
            ))}
            {m.clients.byStatus.length === 0 && <p className="text-sm text-muted-foreground">No contact data</p>}
          </div>
        </Card>

        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">Booking Performance</h3>
          <div className="space-y-3">
            {[
              { label: "Completed", value: m.bookings.completed, color: "bg-emerald-400" },
              { label: "Confirmed", value: m.bookings.confirmed, color: "bg-blue-400" },
              { label: "Pending", value: m.bookings.pending, color: "bg-amber-400" },
              { label: "Cancelled", value: m.bookings.cancelled, color: "bg-red-400" },
            ].map(b => (
              <div key={b.label} className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-sm">{b.label}</span>
                  <span className="text-xs text-muted-foreground">{b.value}</span>
                </div>
                <ProgressBar value={b.value} max={m.bookings.total || 1} color={b.color} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {m.revenue.topClients.length > 0 && (
        <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
          <h3 className="text-sm font-semibold mb-3">Highest-Value Clients</h3>
          <DataTable
            headers={["Client", "Revenue", "Share"]}
            rows={m.revenue.topClients.map(c => [
              c.name,
              formatCurrency(c.total, m.currency),
              <ProgressBar key={c.name} value={c.total} max={m.revenue.topClients[0]?.total || 1} color="bg-blue-400" />,
            ])}
          />
        </Card>
      )}
    </div>
  );
}
