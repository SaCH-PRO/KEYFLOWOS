"use client";

import { Card } from "@keyflow/ui";
import {
  DollarSign, TrendingUp, Users, Calendar, Wallet,
  AlertTriangle, Briefcase, Target, Sparkles, ArrowRight,
  ChevronDown, ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GeneratedReport } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate } from "./report-types";
import { MetricCard, DataTable, NarrativeSection, ProgressBar, CollapsibleSection } from "./shared-components";

export function ExecutiveView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  const c = report.comparison;

  return (
    <div className="space-y-6">
      <AiBriefingCard report={report} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/app/commerce?tab=invoices">
          <MetricCard
            label="Total Revenue"
            value={formatCurrency(m.revenue.total, m.currency)}
            subtext={`${m.revenue.invoiceCount} paid invoices`}
            icon={DollarSign}
            color="text-[hsl(var(--kf-success))]"
            trend="up"
            trendPct={c?.revenue.changePct}
            prevValue={c ? formatCurrency(c.revenue.total, m.currency) : undefined}
            explanation="All collected revenue from paid invoices in the reporting period."
          />
        </Link>
        <Link href="/app/expenses">
          <MetricCard
            label="Total Expenses"
            value={formatCurrency(m.expenses.total, m.currency)}
            subtext={`${m.expenses.count} expense entries`}
            icon={Wallet}
            color="text-[hsl(var(--kf-error))]"
            trendPct={c ? -c.expenses.changePct : undefined}
            prevValue={c ? formatCurrency(c.expenses.total, m.currency) : undefined}
            explanation="Total business spending recorded in the Expenses module."
          />
        </Link>
        <MetricCard
          label="Net Profit"
          value={formatCurrency(m.profitability.netProfit, m.currency)}
          subtext={`${m.profitability.profitMargin}% margin`}
          icon={TrendingUp}
          color={m.profitability.netProfit >= 0 ? "text-[hsl(var(--kf-success))]" : "text-[hsl(var(--kf-error))]"}
          trend={m.profitability.netProfit >= 0 ? "up" : "down"}
          trendPct={c?.profitability.changePct}
          prevValue={c ? formatCurrency(c.profitability.netProfit, m.currency) : undefined}
          explanation="Revenue minus expenses. Positive means profitable."
          formula="Total Revenue - Total Expenses"
          goodValue="Aim for 20%+ profit margin."
        />
        <Link href="/app/crm/pipeline">
          <MetricCard
            label={c ? "New Contacts" : "Total Contacts"}
            value={c ? (m.clients.totalContacts - (c.clients.totalContacts || 0)).toString() : m.clients.totalContacts.toString()}
            subtext={c ? `${m.clients.totalContacts} total in CRM` : `${m.bookings.total} bookings this period`}
            icon={Users}
            color="text-[hsl(var(--kf-info))]"
            trendPct={c?.clients.changePct}
            prevValue={c ? c.clients.totalContacts.toString() : undefined}
            explanation={c ? "Contacts created during this period vs. previous period." : "Total contacts in your CRM."}
          />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link href="/app/commerce?tab=invoices&filter=outstanding">
          <Card className="p-4 backdrop-blur border-border/60 hover:border-[hsl(var(--kf-warning))]/40 transition-colors cursor-pointer" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
              <span className="text-xs font-medium uppercase tracking-wide">Outstanding</span>
            </div>
            <div className="text-xl font-bold mt-2" style={{ color: "hsl(var(--kf-warning))" }}>{formatCurrency(m.revenue.outstanding, m.currency)}</div>
            <div className="text-xs text-muted-foreground">{m.revenue.outstandingCount} invoices ({m.revenue.overdueCount} overdue)</div>
          </Card>
        </Link>
        <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" style={{ color: "hsl(var(--kf-info))" }} />
            <span className="text-xs font-medium uppercase tracking-wide">Avg Invoice</span>
          </div>
          <div className="text-xl font-bold mt-2">{formatCurrency(m.revenue.averageInvoice, m.currency)}</div>
          <div className="text-xs text-muted-foreground">Per paid invoice</div>
        </Card>
        <Link href={`/app/bookings?view=schedule&status=${m.bookings.completionRate < 80 ? "pending" : "all"}`}>
          <Card className="p-4 backdrop-blur border-border/60 hover:border-[hsl(var(--kf-accent2))]/40 transition-colors cursor-pointer" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-xs font-medium uppercase tracking-wide">Bookings</span>
            </div>
            <div className="text-xl font-bold mt-2">{m.bookings.completed}/{m.bookings.total}</div>
            <div className="text-xs text-muted-foreground">{m.bookings.completionRate}% completion rate</div>
            {c && (
              <div className="text-[10px] mt-1" style={{ color: c.bookings.changePct >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>
                {c.bookings.changePct >= 0 ? "+" : ""}{c.bookings.changePct}% vs previous
              </div>
            )}
          </Card>
        </Link>
      </div>

      <CollapsibleSection title="AI Executive Analysis" icon={Briefcase} defaultOpen persistKey="exec-ai-analysis">
        <NarrativeSection content={report.aiNarrative} />
      </CollapsibleSection>

      <CollapsibleSection title="Top Revenue Clients" icon={Target} persistKey="exec-top-clients">
        <DataTable
          headers={["Client", "Revenue", "Share"]}
          rows={m.revenue.topClients.map(cl => [
            cl.name,
            formatCurrency(cl.total, m.currency),
            <ProgressBar key={cl.name} value={cl.total} max={m.revenue.topClients[0]?.total || 1} />,
          ])}
          emptyState={
            <EmptyState
              icon={Users}
              title="No client data"
              description="No revenue data found for this period. Try selecting a wider date range."
              actionLabel="Go to Invoices"
              onAction={() => { window.location.href = "/app/commerce?tab=invoices"; }}
              tip="Client revenue is calculated from paid invoices."
            />
          }
        />
      </CollapsibleSection>
    </div>
  );
}

function AiBriefingCard({ report }: { report: GeneratedReport }) {
  const [expanded, setExpanded] = useState(true);
  const m = report.metrics;
  const c = report.comparison;

  const insights: string[] = [];

  if (m.profitability.netProfit > 0) {
    insights.push(`Your business is profitable with a ${m.profitability.profitMargin}% margin.`);
  } else {
    insights.push(`Warning: Net loss of ${formatCurrency(Math.abs(m.profitability.netProfit), m.currency)}. Review expense management.`);
  }

  if (m.revenue.overdueCount > 0) {
    insights.push(`${m.revenue.overdueCount} overdue invoices totaling ${formatCurrency(m.revenue.outstanding, m.currency)} need collection follow-up.`);
  }

  if (c) {
    if (c.revenue.changePct > 0) {
      insights.push(`Revenue grew ${c.revenue.changePct}% compared to previous period.`);
    } else if (c.revenue.changePct < 0) {
      insights.push(`Revenue declined ${Math.abs(c.revenue.changePct)}% vs. previous period. Consider new campaigns.`);
    }
  }

  if (m.bookings.completionRate < 70 && m.bookings.total > 0) {
    insights.push(`Booking completion rate is ${m.bookings.completionRate}%. Consider reminder automations.`);
  }

  if (insights.length === 0) return null;

  return (
    <Card className="overflow-hidden border-border/60" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.08))" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 min-h-[44px]"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
            <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold">AI Business Briefing</h3>
            <p className="text-[10px] text-muted-foreground">
              {formatDate(m.period.start)} — {formatDate(m.period.end)}
            </p>
          </div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span>{insight}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
