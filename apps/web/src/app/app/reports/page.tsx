"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card } from "@keyflow/ui";
import {
  BarChart3, TrendingUp, Users, Calendar, DollarSign, FileText,
  Download, Loader2, RefreshCw, ChevronDown, PieChart, Briefcase,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle2, Clock,
  Send, Building2, Target, Wallet
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { ContactPickerDrawer } from "@/components/contacts";
import { fetchReport, GeneratedReport } from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";

type ReportType = "executive" | "pnl" | "revenue" | "expenses" | "clients";

const REPORT_TABS: Array<{ id: ReportType; label: string; icon: React.ElementType }> = [
  { id: "executive", label: "Executive Summary", icon: Briefcase },
  { id: "pnl", label: "Profit & Loss", icon: Wallet },
  { id: "revenue", label: "Revenue", icon: TrendingUp },
  { id: "expenses", label: "Expenses", icon: PieChart },
  { id: "clients", label: "Client Portfolio", icon: Users },
];

const DATE_PRESETS = [
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "This Quarter", value: "this-quarter" },
  { label: "Last Quarter", value: "last-quarter" },
  { label: "This Year", value: "this-year" },
  { label: "Last 90 Days", value: "last-90" },
  { label: "Custom", value: "custom" },
];

function getDateRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "this-month":
      return { start: new Date(y, m, 1).toISOString(), end: now.toISOString() };
    case "last-month":
      return { start: new Date(y, m - 1, 1).toISOString(), end: new Date(y, m, 0).toISOString() };
    case "this-quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return { start: new Date(y, qStart, 1).toISOString(), end: now.toISOString() };
    }
    case "last-quarter": {
      const qStart = Math.floor(m / 3) * 3 - 3;
      return { start: new Date(y, qStart, 1).toISOString(), end: new Date(y, qStart + 3, 0).toISOString() };
    }
    case "this-year":
      return { start: new Date(y, 0, 1).toISOString(), end: now.toISOString() };
    case "last-90":
      return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(), end: now.toISOString() };
    default:
      return { start: new Date(y, m, 1).toISOString(), end: now.toISOString() };
  }
}

function formatCurrency(amount: number, currency = "TTD") {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-TT", { year: "numeric", month: "long", day: "numeric" });
}

function MetricCard({ label, value, subtext, icon: Icon, color = "text-white", trend }: {
  label: string; value: string; subtext?: string; icon: React.ElementType; color?: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="p-4 space-y-2 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        {subtext && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {trend === "up" && <ArrowUpRight className="w-3 h-3 text-emerald-400" />}
            {trend === "down" && <ArrowDownRight className="w-3 h-3 text-red-400" />}
            {subtext}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function DataTable({ headers, rows, emptyText = "No data" }: {
  headers: string[]; rows: Array<Array<string | React.ReactNode>>; emptyText?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40">
            {headers.map((h, i) => (
              <th key={i} className="text-left py-2 px-3 text-xs text-muted-foreground uppercase tracking-wide font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="py-4 text-center text-muted-foreground">{emptyText}</td></tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-border/20 hover:bg-white/[0.02]">
                {row.map((cell, j) => (
                  <td key={j} className="py-2.5 px-3">{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function NarrativeSection({ content }: { content: string }) {
  const sections = content.split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const lines = section.split("\n").filter(Boolean);
        return (
          <div key={i} className="space-y-1">
            {lines.map((line, j) => {
              const boldMatch = line.match(/^\*\*(.*?)\*\*(.*)$/);
              if (boldMatch) {
                return (
                  <div key={j}>
                    <h4 className="text-sm font-semibold text-white mt-3 mb-1">{boldMatch[1]}</h4>
                    {boldMatch[2] && <p className="text-sm text-muted-foreground leading-relaxed">{boldMatch[2]}</p>}
                  </div>
                );
              }
              if (line.startsWith("- ") || line.startsWith("• ")) {
                return <p key={j} className="text-sm text-muted-foreground leading-relaxed pl-4">• {line.replace(/^[-•]\s*/, "")}</p>;
              }
              if (/^\d+\.\s/.test(line)) {
                return <p key={j} className="text-sm text-muted-foreground leading-relaxed pl-4">{line}</p>;
              }
              return <p key={j} className="text-sm text-muted-foreground leading-relaxed">{line}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PAID: "bg-emerald-500/20 text-emerald-300",
    SENT: "bg-blue-500/20 text-blue-300",
    DRAFT: "bg-slate-500/20 text-slate-300",
    OVERDUE: "bg-red-500/20 text-red-300",
    VOID: "bg-slate-600/20 text-slate-400",
    LEAD: "bg-amber-500/20 text-amber-300",
    CLIENT: "bg-emerald-500/20 text-emerald-300",
    PROSPECT: "bg-blue-500/20 text-blue-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-slate-500/20 text-slate-300"}`}>
      {status}
    </span>
  );
}

function ProgressBar({ value, max, color = "bg-emerald-400" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}

function ExecutiveView({ report }: { report: GeneratedReport }) {
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

      {m.revenue.topClients.length > 0 && (
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
          />
        </Card>
      )}
    </div>
  );
}

function PnlView({ report }: { report: GeneratedReport }) {
  const m = report.metrics;
  const revenueItems = Object.entries(m.revenue.byStatus).map(([status, data]) => ({
    status, count: data.count, total: data.total,
  }));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Revenue" value={formatCurrency(m.revenue.total, m.currency)} subtext={`${m.revenue.invoiceCount} invoices`} icon={TrendingUp} color="text-emerald-400" trend="up" />
        <MetricCard label="Expenses" value={formatCurrency(m.expenses.total, m.currency)} subtext={`${m.expenses.count} entries`} icon={ArrowDownRight} color="text-red-400" />
        <MetricCard label="Net Profit" value={formatCurrency(m.profitability.netProfit, m.currency)} subtext={`${m.profitability.profitMargin}% margin`} icon={DollarSign} color={m.profitability.netProfit >= 0 ? "text-emerald-400" : "text-red-400"} trend={m.profitability.netProfit >= 0 ? "up" : "down"} />
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
            emptyText="No expenses recorded"
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

function RevenueView({ report }: { report: GeneratedReport }) {
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

        {m.revenue.topClients.length > 0 && (
          <Card className="p-4 bg-slate-950/60 backdrop-blur border-border/60">
            <h3 className="text-sm font-semibold mb-3">Top Clients by Revenue</h3>
            <DataTable
              headers={["Client", "Revenue"]}
              rows={m.revenue.topClients.map(c => [c.name, formatCurrency(c.total, m.currency)])}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function ExpensesView({ report }: { report: GeneratedReport }) {
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
            emptyText="No vendor data"
          />
        </Card>
      </div>
    </div>
  );
}

function ClientsView({ report }: { report: GeneratedReport }) {
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

export default function ReportsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportType>("executive");
  const [datePreset, setDatePreset] = useState("this-month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void initWorkspace();
  }, []);

  const generateReport = useCallback(async (overrideTab?: ReportType) => {
    if (!businessId) return;
    setLoading(true);
    setGenerating(true);

    let startDate: string | undefined;
    let endDate: string | undefined;

    if (datePreset === "custom" && customStart && customEnd) {
      startDate = new Date(customStart).toISOString();
      endDate = new Date(customEnd).toISOString();
    } else if (datePreset !== "custom") {
      const range = getDateRange(datePreset);
      startDate = range.start;
      endDate = range.end;
    }

    try {
      setError(null);
      const result = await fetchReport(businessId, overrideTab || activeTab, startDate, endDate);
      if (result.data) {
        setReport(result.data);
      } else {
        setError("Failed to generate report. Please try again.");
      }
    } catch (err) {
      console.error("Report generation error:", err);
      setError("Failed to generate report. Please try again.");
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [businessId, activeTab, datePreset, customStart, customEnd]);

  useEffect(() => {
    if (businessId) void generateReport();
  }, [businessId, activeTab, datePreset, generateReport]);

  const exportPDF = useCallback(async () => {
    if (!report) return;
    setExporting(true);

    try {
      const jsPDFModule = await import("jspdf");
      const jsPDF = jsPDFModule.default;
      await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const m = report.metrics;
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 15;
      const contentW = pageW - margin * 2;
      let y = margin;

      const reportTitles: Record<string, string> = {
        executive: "Executive Summary",
        pnl: "Profit & Loss Statement",
        revenue: "Revenue Analysis Report",
        expenses: "Expense Analysis Report",
        clients: "Client Portfolio Report",
      };

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageW, 45, "F");

      doc.setTextColor(255, 165, 0);
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text(m.business.name || "Business Report", margin, y + 12);

      doc.setTextColor(180, 180, 180);
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text(reportTitles[report.type] || "Report", margin, y + 22);

      doc.setFontSize(9);
      doc.text(`Period: ${formatDate(m.period.start)} — ${formatDate(m.period.end)}`, margin, y + 30);
      doc.text(`Generated: ${formatDate(report.generatedAt)}`, pageW - margin - 60, y + 30);

      y = 55;

      doc.setDrawColor(255, 165, 0);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y);
      y += 8;

      doc.setTextColor(255, 165, 0);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Key Financial Metrics", margin, y);
      y += 7;

      const metrics = [
        ["Total Revenue", formatCurrency(m.revenue.total, m.currency)],
        ["Total Expenses", formatCurrency(m.expenses.total, m.currency)],
        ["Net Profit", formatCurrency(m.profitability.netProfit, m.currency)],
        ["Profit Margin", `${m.profitability.profitMargin}%`],
        ["Outstanding Receivables", formatCurrency(m.revenue.outstanding, m.currency)],
        ["Overdue Invoices", m.revenue.overdueCount.toString()],
        ["Total Contacts", m.clients.totalContacts.toString()],
        ["Bookings (Period)", m.bookings.total.toString()],
      ];

      const at = (doc as any).autoTable?.bind(doc);
      if (at) {
        at({
          startY: y,
          head: [["Metric", "Value"]],
          body: metrics,
          margin: { left: margin, right: margin },
          styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
          headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [15, 25, 45] },
          theme: "grid",
          tableLineColor: [60, 60, 80],
          tableLineWidth: 0.1,
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      if (m.expenses.byCategory.length > 0) {
        if (y > 240) { doc.addPage(); y = margin; }

        doc.setTextColor(255, 165, 0);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Expense Breakdown by Category", margin, y);
        y += 7;

        at?.({
          startY: y,
          head: [["Category", "Amount", "Count"]],
          body: m.expenses.byCategory.map(c => [c.category, formatCurrency(c.total, m.currency), c.count.toString()]),
          margin: { left: margin, right: margin },
          styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
          headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [15, 25, 45] },
          theme: "grid",
          tableLineColor: [60, 60, 80],
          tableLineWidth: 0.1,
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      if (m.revenue.topClients.length > 0) {
        if (y > 240) { doc.addPage(); y = margin; }

        doc.setTextColor(255, 165, 0);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("Top Revenue Clients", margin, y);
        y += 7;

        at?.({
          startY: y,
          head: [["Client", "Revenue"]],
          body: m.revenue.topClients.map(c => [c.name, formatCurrency(c.total, m.currency)]),
          margin: { left: margin, right: margin },
          styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
          headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [15, 25, 45] },
          theme: "grid",
          tableLineColor: [60, 60, 80],
          tableLineWidth: 0.1,
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      if (report.aiNarrative) {
        if (y > 200) { doc.addPage(); y = margin; }

        doc.setTextColor(255, 165, 0);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("AI-Powered Analysis", margin, y);
        y += 7;

        doc.setTextColor(200, 200, 200);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");

        const cleanNarrative = report.aiNarrative.replace(/\*\*/g, "").replace(/^[-•]\s*/gm, "  - ");
        const lines = doc.splitTextToSize(cleanNarrative, contentW);

        for (const line of lines) {
          if (y > 280) { doc.addPage(); y = margin; }
          doc.text(line, margin, y);
          y += 4.5;
        }
      }

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFillColor(15, 23, 42);
        doc.rect(0, doc.internal.pageSize.getHeight() - 12, pageW, 12, "F");
        doc.setTextColor(120, 120, 120);
        doc.setFontSize(7);
        doc.text(`KEYFLOWOS | ${m.business.name} | Confidential`, margin, doc.internal.pageSize.getHeight() - 5);
        doc.text(`Page ${i} of ${pageCount}`, pageW - margin - 20, doc.internal.pageSize.getHeight() - 5);
      }

      const fileName = `${m.business.name?.replace(/\s+/g, "_") || "Report"}_${reportTitles[report.type]?.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setExporting(false);
    }
  }, [report]);

  const tabs = REPORT_TABS.map(t => ({
    key: t.id,
    label: t.label,
    icon: t.icon,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Reports"
        subtitle="Generate intelligent business reports with AI-powered insights"
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={exportPDF}
              disabled={!report || exporting}
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/20 hover:bg-[hsl(var(--kf-accent1))]/30 text-[hsl(var(--kf-accent1))] transition-colors disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export PDF
            </button>
            <button
              onClick={() => setShowContactPicker(true)}
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Send className="w-4 h-4" />
              Broadcast
            </button>
          </div>
        }
      />

      <TabNav
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ReportType)}
        layoutId="reports-tab-pill"
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-slate-900/80 border border-border/60 hover:border-border transition-colors"
          >
            <Clock className="w-4 h-4 text-muted-foreground" />
            {DATE_PRESETS.find(p => p.value === datePreset)?.label}
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
          <AnimatePresence>
            {showDatePicker && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full mt-1 left-0 z-50 bg-slate-900 border border-border/60 rounded-xl p-2 min-w-[180px] shadow-xl"
              >
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => { setDatePreset(p.value); setShowDatePicker(false); }}
                    className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${datePreset === p.value ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]" : "hover:bg-white/5 text-muted-foreground"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {datePreset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="text-sm px-3 py-2 rounded-xl bg-slate-900/80 border border-border/60 focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="text-sm px-3 py-2 rounded-xl bg-slate-900/80 border border-border/60 focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
            />
            <button
              onClick={generateReport}
              className="text-sm px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
            >
              Generate
            </button>
          </div>
        )}

        <button
          onClick={generateReport}
          disabled={generating}
          className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-slate-900/80 border border-border/60 hover:border-border transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div ref={reportRef}>
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 mb-4">
            {error}
          </div>
        )}
        {loading && !report ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--kf-accent1))]" />
            <div className="text-sm text-muted-foreground">Generating your {REPORT_TABS.find(t => t.id === activeTab)?.label} report...</div>
            <div className="text-xs text-muted-foreground/60">AI is analyzing your business data</div>
          </div>
        ) : report ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {generating && (
                <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Refreshing report...
                </div>
              )}
              {activeTab === "executive" && <ExecutiveView report={report} />}
              {activeTab === "pnl" && <PnlView report={report} />}
              {activeTab === "revenue" && <RevenueView report={report} />}
              {activeTab === "expenses" && <ExpensesView report={report} />}
              {activeTab === "clients" && <ClientsView report={report} />}

              <div className="mt-6 text-center">
                <p className="text-xs text-muted-foreground/60">
                  Report generated on {formatDate(report.generatedAt)} | Period: {formatDate(report.metrics.period.start)} — {formatDate(report.metrics.period.end)} | All amounts in {report.metrics.currency}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Select a report type and date range to get started</p>
          </div>
        )}
      </div>

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
