"use client";

import { Users, Calendar, DollarSign, Building2, AlertTriangle, Shield } from "lucide-react";
import Link from "next/link";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, StatusBadge, ProgressBar, CollapsibleSection } from "./shared-components";

export function ClientsView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  const c = report.comparison;

  const clvRanking = m.revenue.topClients.map((client, idx) => {
    const share = m.revenue.total > 0 ? Math.round((client.total / m.revenue.total) * 100) : 0;
    const isAtRisk = share > 30;
    const tier = client.total > (m.revenue.averageInvoice * 5) ? "High" : client.total > (m.revenue.averageInvoice * 2) ? "Medium" : "Standard";
    return { ...client, share, isAtRisk, tier, rank: idx + 1 };
  });

  const concentrationRisk = clvRanking.length > 0 && clvRanking[0]?.share > 40;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/app/crm/pipeline">
          <MetricCard
            label="Total Contacts"
            value={m.clients.totalContacts.toString()}
            icon={Users}
            color="text-[hsl(var(--kf-info))]"
            trendPct={c?.clients.changePct}
            prevValue={c ? c.clients.totalContacts.toString() : undefined}
            explanation="All contacts in your CRM including leads, prospects, and clients."
          />
        </Link>
        <Link href="/app/bookings">
          <MetricCard
            label="Bookings"
            value={m.bookings.total.toString()}
            subtext={`${m.bookings.completionRate}% completed`}
            icon={Calendar}
            color="text-[hsl(var(--kf-accent2))]"
            trendPct={c?.bookings.changePct}
            prevValue={c ? c.bookings.total.toString() : undefined}
            explanation="Total bookings in this period with completion rate."
          />
        </Link>
        <MetricCard
          label="Products/Services"
          value={m.products.total.toString()}
          icon={Building2}
          color="text-[hsl(var(--kf-accent1))]"
          explanation="Active items in your product and service catalog."
        />
        <MetricCard
          label="Revenue Per Client"
          value={m.clients.totalContacts > 0 ? formatCurrency(m.revenue.total / m.clients.totalContacts, m.currency) : "N/A"}
          icon={DollarSign}
          color="text-[hsl(var(--kf-success))]"
          explanation="Average revenue generated per contact."
          formula="Total Revenue / Total Contacts"
          goodValue="Increasing ARPC signals growing customer value."
        />
      </div>

      {concentrationRisk && (
        <div
          className="flex items-center gap-2.5 p-3 rounded-xl text-xs"
          style={{
            background: "hsl(var(--kf-warning) / 0.08)",
            border: "1px solid hsl(var(--kf-warning) / 0.2)",
            color: "hsl(var(--kf-warning))",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <div>
            <p className="font-medium">Revenue concentration risk detected</p>
            <p className="text-[10px] opacity-80 mt-0.5">
              Your top client accounts for {clvRanking[0]?.share}% of revenue. Diversify your client base to reduce risk.
            </p>
          </div>
        </div>
      )}

      <CollapsibleSection title="Client Portfolio Analysis" icon={Users} defaultOpen>
        <NarrativeSection content={report.aiNarrative} />
      </CollapsibleSection>

      <CollapsibleSection title="Client Lifetime Value Ranking" icon={Shield} defaultOpen>
        {clvRanking.length > 0 ? (
          <div className="space-y-2">
            {clvRanking.map(client => (
              <div key={client.name} className="flex items-center justify-between py-2.5 border-b border-border/20 last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-muted-foreground w-5 text-center shrink-0">#{client.rank}</span>
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate block">{client.name}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{
                          background: client.tier === "High" ? "hsl(var(--kf-accent1) / 0.15)" :
                            client.tier === "Medium" ? "hsl(var(--kf-info) / 0.15)" : "hsl(var(--kf-muted) / 0.3)",
                          color: client.tier === "High" ? "hsl(var(--kf-accent1))" :
                            client.tier === "Medium" ? "hsl(var(--kf-info))" : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {client.tier} Value
                      </span>
                      {client.isAtRisk && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5"
                          style={{ background: "hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))" }}
                        >
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Concentration Risk
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                    {formatCurrency(client.total, m.currency)}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">{client.share}% of revenue</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No client revenue data"
            description="No paid invoices found for this period."
            actionLabel="Go to CRM"
            onAction={() => { window.location.href = "/app/crm/pipeline"; }}
            tip="Revenue per client is calculated from paid invoices linked to contacts."
          />
        )}
      </CollapsibleSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <CollapsibleSection title="Contact Segmentation" defaultOpen>
          <div className="space-y-3">
            {m.clients.byStatus.map(s => (
              <div key={s.status} className="space-y-1">
                <div className="flex justify-between items-center">
                  <StatusBadge status={s.status} />
                  <span className="text-xs text-muted-foreground">{s.count} contacts</span>
                </div>
                <ProgressBar value={s.count} max={m.clients.totalContacts || 1} color="hsl(var(--kf-info))" />
              </div>
            ))}
            {m.clients.byStatus.length === 0 && <p className="text-sm text-muted-foreground">No contact data</p>}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Booking Performance" defaultOpen>
          <div className="space-y-3">
            {[
              { label: "Completed", value: m.bookings.completed, color: "hsl(var(--kf-success))" },
              { label: "Confirmed", value: m.bookings.confirmed, color: "hsl(var(--kf-info))" },
              { label: "Pending", value: m.bookings.pending, color: "hsl(var(--kf-warning))" },
              { label: "Cancelled", value: m.bookings.cancelled, color: "hsl(var(--kf-error))" },
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
        </CollapsibleSection>
      </div>
    </div>
  );
}
