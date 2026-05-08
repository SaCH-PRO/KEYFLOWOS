"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Download,
  Loader2,
  RefreshCw,
  ChevronDown,
  Send,
  Clock,
  FileSpreadsheet,
  GitCompare,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCardSkeleton, ChartSkeleton } from "@/components/ui/skeleton";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { ContactPickerDrawer } from "@/components/contacts";
import { fetchReport, GeneratedReport } from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { ReportType, REPORT_TABS, DATE_PRESETS, getDateRange, formatDate } from "./components/report-types";
import { ExecutiveView, AiBriefingCard } from "./components/executive-view";
import { RevenueView } from "./components/revenue-view";
import { ExpensesView } from "./components/expenses-view";
import { ClientsView } from "./components/clients-view";
import { BookingsView } from "./components/bookings-view";
import { MarketingView } from "./components/marketing-view";
import { CashFlowForecastView } from "./components/cash-flow-forecast-view";
import { BooksReportView, type BooksReportKind } from "./components/BooksReportView";
import { exportReportPDF, exportReportCSV } from "./components/export-pdf";
import { downloadAccountantExport, fetchFinanceSettings, sendAccountantExportEmail } from "@/lib/client";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { RevenueReportsView } from "./components/revenue-reports-view";
import type { RevenueReportPreset } from "@/lib/client";

const REPORT_TAB_KEYS = REPORT_TABS.map((t) => t.id);

export default function ReportsPage() {
  const searchParams = useSearchParams();
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
  const [exportingCSV, setExportingCSV] = useState(false);
  const [comparePrevious, setComparePrevious] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && REPORT_TAB_KEYS.includes(tabParam as ReportType)) {
      setActiveTab(tabParam as ReportType);
    }
  }, [searchParams]);

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
    const tab = overrideTab || activeTab;
    if (!businessId) return;
    if (tab === "cash-flow" || tab === "revenue-detail" || tab === "pnl") {
      setLoading(false);
      setGenerating(false);
      return;
    }
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
      const result = await fetchReport(businessId, overrideTab || activeTab, startDate, endDate, comparePrevious);
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
  }, [businessId, activeTab, datePreset, customStart, customEnd, comparePrevious]);

  useEffect(() => {
    if (businessId) void generateReport();
  }, [businessId, activeTab, datePreset, comparePrevious, generateReport]);

  const exportPDF = useCallback(async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportReportPDF(report);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setExporting(false);
    }
  }, [report]);

  const [exportingZip, setExportingZip] = useState(false);
  const [emailModal, setEmailModal] = useState<{ start: string; end: string } | null>(null);
  const [defaultAccountantEmail, setDefaultAccountantEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    void (async () => {
      const r = await fetchFinanceSettings(businessId);
      if (r.data) setDefaultAccountantEmail(r.data.accountantEmail ?? null);
    })();
  }, [businessId]);

  const openEmailModal = useCallback(() => {
    if (!businessId) return;
    const range = getDateRange(datePreset);
    const startStr = (datePreset === "custom" && customStart) ? customStart : range.start.slice(0, 10);
    const endStr = (datePreset === "custom" && customEnd) ? customEnd : range.end.slice(0, 10);
    setEmailModal({ start: startStr, end: endStr });
  }, [businessId, datePreset, customStart, customEnd]);

  const exportAccountantZip = useCallback(async () => {
    if (!businessId) return;
    const range = getDateRange(datePreset);
    setExportingZip(true);
    try {
      const startStr = (datePreset === "custom" && customStart) ? customStart : range.start.slice(0, 10);
      const endStr = (datePreset === "custom" && customEnd) ? customEnd : range.end.slice(0, 10);
      const { blob, filename } = await downloadAccountantExport(
        businessId,
        startStr,
        endStr,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success("Accountant export ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingZip(false);
    }
  }, [businessId, datePreset, customStart, customEnd]);

  const exportCSV = useCallback(() => {
    if (!report) return;
    setExportingCSV(true);
    try {
      exportReportCSV(report);
    } catch (err) {
      console.error("CSV export error:", err);
    } finally {
      setExportingCSV(false);
    }
  }, [report]);

  const tabs = REPORT_TABS.map(t => ({
    key: t.id,
    label: t.label,
    icon: t.icon,
    tooltip: t.tooltip,
  }));

  return (
    <WorkspaceShell
      icon={BarChart3}
      title="Reports"
      subtitle="Generate intelligent business reports with AI-powered insights"
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as ReportType)}
      tabLayoutId="reports-tab-pill"
      headerRight={
        <div className="flex items-center gap-2">
          <NotesTrigger pageKey="reports" variant="header" />
          <button
            onClick={exportPDF}
            disabled={!report || exporting}
            className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl bg-[hsl(var(--kf-accent1))]/20 hover:bg-[hsl(var(--kf-accent1))]/30 text-[hsl(var(--kf-accent1))] transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            PDF
          </button>
          <button
            onClick={exportCSV}
            disabled={!report || exportingCSV}
            className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl bg-[hsl(var(--kf-accent2))]/20 hover:bg-[hsl(var(--kf-accent2))]/30 text-[hsl(var(--kf-accent2))] transition-colors disabled:opacity-50"
          >
            {exportingCSV ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            CSV
          </button>
          <button
            onClick={exportAccountantZip}
            disabled={!businessId || exportingZip}
            title="Download a ZIP package for your accountant: P&L, Cashflow, Balance Sheet, A/R & A/P aging, Tax Summary, Trial Balance, GL and Audit Log."
            className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl bg-primary/15 hover:bg-primary/25 text-primary transition-colors disabled:opacity-50"
          >
            {exportingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            Accountant ZIP
          </button>
          <button
            onClick={openEmailModal}
            disabled={!businessId}
            title="Email the accountant export ZIP directly to your accountant"
            className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Send to accountant
          </button>
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        </div>
      }
    >

      <div className="flex items-center gap-3 flex-wrap" data-walkthrough="reports-period">
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
              onClick={() => generateReport()}
              className="text-sm px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-foreground hover:opacity-90 transition-opacity"
            >
              Generate
            </button>
          </div>
        )}

        <button
          onClick={() => setComparePrevious(!comparePrevious)}
          className={`inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl border transition-colors ${
            comparePrevious
              ? "bg-[hsl(var(--kf-accent1))]/15 border-[hsl(var(--kf-accent1))]/40 text-[hsl(var(--kf-accent1))]"
              : "bg-slate-900/80 border-border/60 hover:border-border text-muted-foreground"
          }`}
        >
          <GitCompare className="w-4 h-4" />
          Compare
        </button>

        <button
          onClick={() => generateReport()}
          disabled={generating}
          className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl bg-slate-900/80 border border-border/60 hover:border-border transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      <div ref={reportRef} data-walkthrough="reports-ai">
        {error && (
          <div className="rounded-xl border p-4 text-sm mb-4" style={{ borderColor: "hsl(var(--kf-error) / 0.3)", background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
            {error}
          </div>
        )}
        {activeTab.startsWith("books-") || activeTab === "pnl" ? (
          // FIN4: legacy "pnl" tab now reads from the ledger-derived
          // P&L endpoint via BooksReportView, replacing the prior
          // AI-generated metrics flow while preserving the URL/tab.
          <BooksReportView
            businessId={businessId}
            kind={(activeTab === "pnl" ? "books-pnl" : (activeTab as BooksReportKind))}
            startDate={(datePreset === "custom" && customStart) ? new Date(customStart).toISOString() : (datePreset !== "custom" ? getDateRange(datePreset).start : undefined)}
            endDate={(datePreset === "custom" && customEnd) ? new Date(customEnd).toISOString() : (datePreset !== "custom" ? getDateRange(datePreset).end : undefined)}
          />
        ) : activeTab === "cash-flow" && !report && !loading ? (
          <CashFlowForecastView businessId={businessId} />
        ) : activeTab === "revenue-detail" ? (
          <RevenueReportsView
            businessId={businessId}
            startDate={(datePreset === "custom" && customStart) ? new Date(customStart).toISOString() : (datePreset !== "custom" ? getDateRange(datePreset).start : undefined)}
            endDate={(datePreset === "custom" && customEnd) ? new Date(customEnd).toISOString() : (datePreset !== "custom" ? getDateRange(datePreset).end : undefined)}
            initialPreset={(searchParams.get("rev") as RevenueReportPreset | null) || undefined}
          />
        ) : loading && !report ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
              <div>
                <p className="text-sm font-medium">Generating your {REPORT_TABS.find(t => t.id === activeTab)?.label} report...</p>
                <p className="kf-text-caption text-muted-foreground">AI is analyzing your business data</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
            </div>
            <ChartSkeleton />
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
              {activeTab !== "executive" && activeTab !== "cash-flow" && (
                <div className="mb-6">
                  <AiBriefingCard report={report} />
                </div>
              )}
              {activeTab === "executive" && <ExecutiveView report={report} />}
              {/* FIN4: legacy "pnl" tab is rendered above via BooksReportView (ledger-derived). */}
              {activeTab === "revenue" && <RevenueView report={report} businessId={businessId} />}
              {activeTab === "cash-flow" && <CashFlowForecastView businessId={businessId} currency={report.metrics.currency} />}
              {activeTab === "expenses" && <ExpensesView report={report} />}
              {activeTab === "clients" && <ClientsView report={report} />}
              {activeTab === "bookings" && <BookingsView report={report} />}
              {activeTab === "marketing" && <MarketingView report={report} />}

              {activeTab !== "cash-flow" && (
                <div className="mt-6 text-center">
                  <p className="text-xs text-muted-foreground/60">
                    Report generated on {formatDate(report.generatedAt)} | Period: {formatDate(report.metrics.period.start)} — {formatDate(report.metrics.period.end)} | All amounts in {report.metrics.currency}
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No report generated"
            description="Select a report type and date range, then hit Refresh to generate AI-powered insights."
            actionLabel="Generate Report"
            actionIcon={RefreshCw}
            onAction={() => generateReport()}
            tip="Executive reports give you a high-level snapshot — try it first to see your business overview."
          />
        )}
      </div>

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />

      {emailModal && businessId && (
        <SendAccountantEmailModal
          businessId={businessId}
          start={emailModal.start}
          end={emailModal.end}
          defaultEmail={defaultAccountantEmail}
          onClose={() => setEmailModal(null)}
          onSavedDefault={(v) => setDefaultAccountantEmail(v)}
        />
      )}

    </WorkspaceShell>
  );
}

function SendAccountantEmailModal({
  businessId, start, end, defaultEmail, onClose, onSavedDefault,
}: {
  businessId: string;
  start: string;
  end: string;
  defaultEmail: string | null;
  onClose: () => void;
  onSavedDefault: (v: string | null) => void;
}) {
  const [to, setTo] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [saveDefault, setSaveDefault] = useState(!defaultEmail);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!to.trim()) {
      toast.error("Recipient email is required");
      return;
    }
    setSending(true);
    const r = await sendAccountantExportEmail(businessId, {
      start, end,
      to: to.trim(),
      message: message.trim() || null,
      saveRecipient: saveDefault,
    });
    setSending(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(`Sent to ${r.data?.to ?? to.trim()}`);
    if (r.data?.savedAsDefault) onSavedDefault(r.data.to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border border-border rounded-xl shadow-xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Send accountant export</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-card text-muted-foreground">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Sends the accountant export ZIP for <strong>{start}</strong> to <strong>{end}</strong> as an email
            attachment via Keyflow&apos;s mailer.
          </p>
          <label className="block">
            <span className="text-xs font-medium">Recipient email</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="accountant@firm.com"
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-sm"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Cover note (optional)</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Hi — attached is the latest export for your review."
              className="mt-1 w-full rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-sm resize-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveDefault}
              onChange={(e) => setSaveDefault(e.target.checked)}
              className="rounded border-border"
            />
            Remember this as the default recipient
          </label>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-card"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={sending || !to.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send email
          </button>
        </div>
      </div>
    </div>
  );
}
