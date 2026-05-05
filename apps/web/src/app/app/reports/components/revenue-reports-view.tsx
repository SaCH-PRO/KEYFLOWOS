"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp, Users, Package, GitBranch, Clock, AlertTriangle, Wallet, RefreshCw, Loader2, FileSpreadsheet, Download,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  fetchRevenueReport,
  type RevenueReportPreset,
  type RevenueBySourceReport,
  type RevenueByContactReport,
  type RevenueByProductReport,
  type QuoteConversionReport,
  type DaysToPayReport,
  type AgingBucketsReport,
  type CollectedVsExpectedReport,
  type RecurringExpectedReport,
} from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "./report-types";
import { MetricCard, DataTable, ProgressBar, CollapsibleSection } from "./shared-components";

type RevenuePresetMeta = {
  id: RevenueReportPreset;
  label: string;
  icon: React.ElementType;
  description: string;
};

export const REVENUE_PRESETS: RevenuePresetMeta[] = [
  { id: "by-source", label: "Revenue by Source", icon: GitBranch, description: "Campaigns, referrals, staff, and acquisition channels." },
  { id: "by-contact", label: "Revenue by Contact", icon: Users, description: "Top clients with drill-down detail." },
  { id: "by-product", label: "Revenue by Service / Product", icon: Package, description: "Catalog items + booked services driving revenue." },
  { id: "quote-conversion", label: "Quote Conversion Rate", icon: TrendingUp, description: "Sent → accepted → invoiced → paid funnel." },
  { id: "days-to-pay", label: "Average Days to Pay", icon: Clock, description: "Collection velocity overall, per contact, per segment." },
  { id: "aging-buckets", label: "Outstanding Aging Buckets", icon: AlertTriangle, description: "0-30, 31-60, 61-90, 90+ day receivables." },
  { id: "collected-vs-expected", label: "Collected vs. Expected", icon: Wallet, description: "Current period vs. prior, with change." },
  { id: "recurring-expected", label: "Recurring Expected Revenue", icon: RefreshCw, description: "Projected recurring runs over the next 30/60/90 days." },
];

export function RevenueReportsView({
  businessId,
  startDate,
  endDate,
  initialPreset,
  onPresetChange,
}: {
  businessId: string | null;
  startDate?: string;
  endDate?: string;
  initialPreset?: RevenueReportPreset;
  onPresetChange?: (p: RevenueReportPreset) => void;
}) {
  const [internalPreset, setInternalPreset] = useState<RevenueReportPreset>(initialPreset || "by-source");
  // Treat `initialPreset` as authoritative when provided so deep-links work
  // without the cascading-render that a useEffect→setState would cause.
  const preset = initialPreset ?? internalPreset;
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!businessId) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRevenueReport(businessId, preset, startDate, endDate);
      if (reqIdRef.current !== myReq) return;
      if (res.data) setData(res.data);
      else setError(res.error || "Failed to load report");
    } catch (e: unknown) {
      if (reqIdRef.current === myReq) setError(String(e));
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [businessId, preset, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handlePreset = (p: RevenueReportPreset) => {
    setInternalPreset(p);
    onPresetChange?.(p);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1" data-walkthrough="revenue-presets">
        {REVENUE_PRESETS.map((p) => {
          const active = preset === p.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => handlePreset(p.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-colors ${
                active
                  ? "bg-[hsl(var(--kf-accent1))]/15 border-[hsl(var(--kf-accent1))]/40 text-[hsl(var(--kf-accent1))]"
                  : "bg-slate-900/60 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
              title={p.description}
            >
              <Icon className="w-4 h-4" />
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <p>{REVENUE_PRESETS.find((p) => p.id === preset)?.description}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportRevenuePresetCSV(preset, data)}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[hsl(var(--kf-accent2))]/15 hover:bg-[hsl(var(--kf-accent2))]/25 text-[hsl(var(--kf-accent2))] disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => exportRevenuePresetPDF(preset, data)}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[hsl(var(--kf-accent1))]/15 hover:bg-[hsl(var(--kf-accent1))]/25 text-[hsl(var(--kf-accent1))] disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "hsl(var(--kf-error) / 0.3)", background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading revenue report…
        </div>
      ) : data ? (
        <motion.div key={preset} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
          {preset === "by-source" && <BySourcePanel report={data as RevenueBySourceReport} />}
          {preset === "by-contact" && <ByContactPanel report={data as RevenueByContactReport} />}
          {preset === "by-product" && <ByProductPanel report={data as RevenueByProductReport} />}
          {preset === "quote-conversion" && <QuoteConversionPanel report={data as QuoteConversionReport} />}
          {preset === "days-to-pay" && <DaysToPayPanel report={data as DaysToPayReport} />}
          {preset === "aging-buckets" && <AgingBucketsPanel report={data as AgingBucketsReport} />}
          {preset === "collected-vs-expected" && <CollectedVsExpectedPanel report={data as CollectedVsExpectedReport} />}
          {preset === "recurring-expected" && <RecurringExpectedPanel report={data as RecurringExpectedReport} />}
        </motion.div>
      ) : (
        <EmptyState icon={TrendingUp} title="No data" description="No data for the selected period." />
      )}
    </div>
  );
}

// ---------- Panels ----------

function BySourcePanel({ report }: { report: RevenueBySourceReport }) {
  return (
    <CollapsibleSection title="Revenue by Source" defaultOpen persistKey="rev-by-source">
      <p className="text-xs text-muted-foreground mb-3">
        Total: <strong>{formatCurrency(report.totalRevenue, report.currency)}</strong>
      </p>
      <DataTable
        headers={["Source", "Channel", "Revenue", "Invoices", "Share"]}
        rows={report.rows.map((r) => [
          r.source,
          <span key="ch" className="text-xs uppercase tracking-wide text-muted-foreground">{r.channel}</span>,
          formatCurrency(r.revenue, report.currency),
          r.invoiceCount.toString(),
          <ProgressBar key="p" value={r.revenue} max={report.totalRevenue || 1} color="hsl(var(--kf-accent1))" />,
        ])}
        emptyText="No paid invoices in this period."
      />
    </CollapsibleSection>
  );
}

function ByContactPanel({ report }: { report: RevenueByContactReport }) {
  const top = report.rows.slice(0, 25);
  return (
    <CollapsibleSection title="Revenue by Contact" defaultOpen persistKey="rev-by-contact">
      <p className="text-xs text-muted-foreground mb-3">
        Total: <strong>{formatCurrency(report.totalRevenue, report.currency)}</strong> · {report.rows.length} contacts
      </p>
      <DataTable
        headers={["Contact", "Revenue", "Invoices", "Avg Invoice", "Last Payment"]}
        rows={top.map((r) => [
          r.name,
          formatCurrency(r.revenue, report.currency),
          r.invoiceCount.toString(),
          formatCurrency(r.avgInvoice, report.currency),
          r.lastPaymentAt ? new Date(r.lastPaymentAt).toLocaleDateString() : "—",
        ])}
        onRowClick={(idx) => {
          const cid = top[idx]?.contactId;
          if (cid) window.location.href = `/app/contacts/${cid}`;
        }}
        emptyText="No paid invoices in this period."
      />
    </CollapsibleSection>
  );
}

function ByProductPanel({ report }: { report: RevenueByProductReport }) {
  return (
    <CollapsibleSection title="Revenue by Service / Product" defaultOpen persistKey="rev-by-product">
      <p className="text-xs text-muted-foreground mb-3">
        Total: <strong>{formatCurrency(report.totalRevenue, report.currency)}</strong>
      </p>
      <DataTable
        headers={["Item", "Type", "Revenue", "Units", "Invoices"]}
        rows={report.rows.map((r) => [
          r.name,
          <span key="t" className="text-xs uppercase tracking-wide text-muted-foreground">{r.category}</span>,
          formatCurrency(r.revenue, report.currency),
          r.unitsSold.toString(),
          r.invoiceCount.toString(),
        ])}
        emptyText="No sold items found in this period."
      />
    </CollapsibleSection>
  );
}

function QuoteConversionPanel({ report }: { report: QuoteConversionReport }) {
  const t = report.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Sent → Accepted" value={`${report.rates.sentToAccepted}%`} icon={TrendingUp} color="text-[hsl(var(--kf-info))]" subtext={`${t.quotesAccepted} of ${t.quotesSent}`} />
        <MetricCard label="Accepted → Invoiced" value={`${report.rates.acceptedToInvoiced}%`} icon={TrendingUp} color="text-[hsl(var(--kf-info))]" subtext={`${t.quotesInvoiced} of ${t.quotesAccepted}`} />
        <MetricCard label="Invoiced → Paid" value={`${report.rates.invoicedToPaid}%`} icon={TrendingUp} color="text-[hsl(var(--kf-success))]" subtext={`${t.quotesPaid} of ${t.quotesInvoiced}`} />
        <MetricCard label="Overall (Sent → Paid)" value={`${report.rates.overall}%`} icon={TrendingUp} color="text-[hsl(var(--kf-accent1))]" subtext={`${t.quotesPaid} of ${t.quotesSent}`} />
      </div>
      <CollapsibleSection title="Funnel" defaultOpen persistKey="rev-quote-funnel">
        <div className="space-y-2">
          {report.funnel.map((stage) => (
            <div key={stage.stage} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{stage.stage}</span>
                <span className="text-muted-foreground">{stage.count} · {stage.pct}%</span>
              </div>
              <ProgressBar value={stage.pct} max={100} color="hsl(var(--kf-accent1))" />
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function DaysToPayPanel({ report }: { report: DaysToPayReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Average Days to Pay" value={`${report.overallAvgDays}`} subtext="days" icon={Clock} color="text-[hsl(var(--kf-info))]" />
        <MetricCard label="Paid Invoices" value={String(report.paidCount)} icon={Wallet} color="text-[hsl(var(--kf-success))]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CollapsibleSection title="By Segment" defaultOpen persistKey="rev-dtp-seg">
          <DataTable
            headers={["Segment", "Avg Days", "Invoices"]}
            rows={report.perSegment.map((r) => [r.segment, r.avgDays.toString(), r.count.toString()])}
            emptyText="No segment data."
          />
        </CollapsibleSection>
        <CollapsibleSection title="Slowest Contacts" defaultOpen persistKey="rev-dtp-contacts">
          <DataTable
            headers={["Contact", "Avg Days", "Invoices"]}
            rows={report.perContact.slice(0, 25).map((r) => [r.name, r.avgDays.toString(), r.count.toString()])}
            emptyText="No contact-level data."
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}

function AgingBucketsPanel({ report }: { report: AgingBucketsReport }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Total Outstanding: <strong>{formatCurrency(report.totalOutstanding, report.currency)}</strong> · {report.totalCount} invoices
      </p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {report.buckets.map((b) => (
          <MetricCard
            key={b.label}
            label={`${b.label} days`}
            value={formatCurrency(b.total, report.currency)}
            subtext={`${b.count} invoices`}
            icon={AlertTriangle}
            color={b.label === "90+" ? "text-[hsl(var(--kf-error))]" : b.label === "61-90" ? "text-[hsl(var(--kf-warning))]" : "text-[hsl(var(--kf-info))]"}
          />
        ))}
      </div>
      <CollapsibleSection title="Distribution" defaultOpen persistKey="rev-aging-dist">
        <div className="space-y-2">
          {report.buckets.map((b) => (
            <div key={b.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{b.label} days</span>
                <span className="text-muted-foreground">{formatCurrency(b.total, report.currency)} · {b.count}</span>
              </div>
              <ProgressBar value={b.total} max={report.totalOutstanding || 1} color={b.label === "90+" ? "hsl(var(--kf-error))" : "hsl(var(--kf-warning))"} />
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}

function CollectedVsExpectedPanel({ report }: { report: CollectedVsExpectedReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Collected (Current)" value={formatCurrency(report.current.collected, report.currency)} icon={Wallet} color="text-[hsl(var(--kf-success))]" trendPct={report.changePct} prevValue={formatCurrency(report.previous.collected, report.currency)} />
        <MetricCard label="Expected (Current)" value={formatCurrency(report.current.expected, report.currency)} icon={TrendingUp} color="text-[hsl(var(--kf-info))]" subtext={`${report.current.pctCollected}% collected`} />
        <MetricCard label="Expected (Previous)" value={formatCurrency(report.previous.expected, report.currency)} icon={TrendingUp} color="text-muted-foreground" subtext={`${report.previous.pctCollected}% collected`} />
      </div>
      <CollapsibleSection title="Periods" defaultOpen persistKey="rev-cve-periods">
        <DataTable
          headers={["Period", "Range", "Expected", "Collected", "% Collected"]}
          rows={[
            ["Current", `${new Date(report.current.period.start).toLocaleDateString()} – ${new Date(report.current.period.end).toLocaleDateString()}`, formatCurrency(report.current.expected, report.currency), formatCurrency(report.current.collected, report.currency), `${report.current.pctCollected}%`],
            ["Previous", `${new Date(report.previous.period.start).toLocaleDateString()} – ${new Date(report.previous.period.end).toLocaleDateString()}`, formatCurrency(report.previous.expected, report.currency), formatCurrency(report.previous.collected, report.currency), `${report.previous.pctCollected}%`],
          ]}
        />
      </CollapsibleSection>
    </div>
  );
}

function RecurringExpectedPanel({ report }: { report: RecurringExpectedReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {report.windows.map((w) => (
          <MetricCard key={w.label} label={`Next ${w.label}`} value={formatCurrency(w.expected, report.currency)} icon={RefreshCw} color="text-[hsl(var(--kf-accent1))]" subtext={`${w.runs} expected runs`} />
        ))}
      </div>
      <CollapsibleSection title="Active Recurring Invoices" defaultOpen persistKey="rev-recurring-rows">
        <DataTable
          headers={["Name", "Contact", "Frequency", "Amount", "Next Run", "Runs (90d)"]}
          rows={report.rows.map((r) => [
            r.name,
            r.contactName,
            r.frequency,
            formatCurrency(r.total, report.currency),
            new Date(r.nextRunDate).toLocaleDateString(),
            r.runsInWindow.toString(),
          ])}
          emptyText="No active recurring invoices."
        />
      </CollapsibleSection>
    </div>
  );
}

// ---------- Exports ----------

function csvDownload(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map((row) =>
    row.map((cell) => {
      const v = String(cell ?? "");
      return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(",")
  ).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function presetToRows(preset: RevenueReportPreset, data: unknown): { headers: string[]; rows: Array<Array<string | number>>; title: string } {
  switch (preset) {
    case "by-source": {
      const r = data as RevenueBySourceReport;
      return {
        title: "Revenue by Source",
        headers: ["Source", "Channel", "Revenue", "Invoices"],
        rows: r.rows.map((x) => [x.source, x.channel, x.revenue, x.invoiceCount]),
      };
    }
    case "by-contact": {
      const r = data as RevenueByContactReport;
      return {
        title: "Revenue by Contact",
        headers: ["Contact", "Revenue", "Invoices", "Avg Invoice", "Last Payment"],
        rows: r.rows.map((x) => [x.name, x.revenue, x.invoiceCount, x.avgInvoice, x.lastPaymentAt ?? ""]),
      };
    }
    case "by-product": {
      const r = data as RevenueByProductReport;
      return {
        title: "Revenue by Service / Product",
        headers: ["Item", "Type", "Revenue", "Units", "Invoices"],
        rows: r.rows.map((x) => [x.name, x.category, x.revenue, x.unitsSold, x.invoiceCount]),
      };
    }
    case "quote-conversion": {
      const r = data as QuoteConversionReport;
      return {
        title: "Quote Conversion Rate",
        headers: ["Stage", "Count", "% of Sent"],
        rows: r.funnel.map((s) => [s.stage, s.count, `${s.pct}%`]),
      };
    }
    case "days-to-pay": {
      const r = data as DaysToPayReport;
      const rows: Array<Array<string | number>> = [
        ["Overall avg days", r.overallAvgDays, r.paidCount],
        ["", "", ""],
        ["By Segment", "Avg Days", "Invoices"],
        ...r.perSegment.map((s) => [s.segment, s.avgDays, s.count] as Array<string | number>),
        ["", "", ""],
        ["By Contact", "Avg Days", "Invoices"],
        ...r.perContact.map((c) => [c.name, c.avgDays, c.count] as Array<string | number>),
      ];
      return { title: "Average Days to Pay", headers: ["Label", "Value", "Count"], rows };
    }
    case "aging-buckets": {
      const r = data as AgingBucketsReport;
      return {
        title: "Outstanding Aging Buckets",
        headers: ["Bucket", "Total", "Count"],
        rows: r.buckets.map((b) => [`${b.label} days`, b.total, b.count]),
      };
    }
    case "collected-vs-expected": {
      const r = data as CollectedVsExpectedReport;
      return {
        title: "Collected vs Expected",
        headers: ["Period", "Expected", "Collected", "% Collected"],
        rows: [
          ["Current", r.current.expected, r.current.collected, `${r.current.pctCollected}%`],
          ["Previous", r.previous.expected, r.previous.collected, `${r.previous.pctCollected}%`],
        ],
      };
    }
    case "recurring-expected": {
      const r = data as RecurringExpectedReport;
      const rows: Array<Array<string | number>> = [
        ...r.windows.map((w) => [`Window ${w.label}`, w.expected, w.runs] as Array<string | number>),
        ["", "", ""],
        ["Recurring", "Amount", "Runs (90d)"],
        ...r.rows.map((row) => [`${row.name} — ${row.contactName} (${row.frequency})`, row.total, row.runsInWindow] as Array<string | number>),
      ];
      return { title: "Recurring Expected Revenue", headers: ["Label", "Amount", "Runs"], rows };
    }
  }
}

export function exportRevenuePresetCSV(preset: RevenueReportPreset, data: unknown) {
  if (!data) return;
  const { title, headers, rows } = presetToRows(preset, data);
  const all: Array<Array<string | number>> = [[title], headers, ...rows];
  csvDownload(`Revenue_${preset}_${new Date().toISOString().split("T")[0]}.csv`, all);
}

export async function exportRevenuePresetPDF(preset: RevenueReportPreset, data: unknown) {
  if (!data) return;
  const jsPDFModule = await import("jspdf");
  const jsPDF = jsPDFModule.default;
  await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const { title, headers, rows } = presetToRows(preset, data);

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 30, "F");
  doc.setTextColor(255, 165, 0);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(title, 15, 18);
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text(`Generated ${new Date().toLocaleString()}`, 15, 25);

  type AutoTableDoc = typeof doc & { autoTable?: (opts: Record<string, unknown>) => void };
  const at = (doc as AutoTableDoc).autoTable?.bind(doc);
  if (at) {
    at({
      startY: 38,
      head: [headers],
      body: rows.map((r) => r.map((c) => (typeof c === "number" ? c.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(c)))),
      margin: { left: 15, right: 15 },
      styles: { fontSize: 9, cellPadding: 3, textColor: [200, 200, 200], fillColor: [20, 30, 50] },
      headStyles: { fillColor: [255, 165, 0], textColor: [0, 0, 0], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [15, 25, 45] },
      theme: "grid",
    });
  }

  doc.save(`Revenue_${preset}_${new Date().toISOString().split("T")[0]}.pdf`);
}

// Convenience hook for derived deep-link presets
export function usePresetFromQuery(searchParams: URLSearchParams | null): RevenueReportPreset | undefined {
  return useMemo(() => {
    const sub = searchParams?.get("rev");
    if (!sub) return undefined;
    if (REVENUE_PRESETS.some((p) => p.id === sub)) return sub as RevenueReportPreset;
    return undefined;
  }, [searchParams]);
}
