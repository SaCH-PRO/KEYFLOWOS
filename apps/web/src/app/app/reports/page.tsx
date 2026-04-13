"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3, Download, Loader2, RefreshCw, ChevronDown, Send, Clock, FileSpreadsheet, GitCompare
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCardSkeleton, ChartSkeleton } from "@/components/ui/skeleton";
import { TabNav } from "@/components/ui/tab-nav";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { REPORTS_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { ContactPickerDrawer } from "@/components/contacts";
import { fetchReport, GeneratedReport } from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { ReportType, REPORT_TABS, DATE_PRESETS, getDateRange, formatDate } from "./components/report-types";
import { ExecutiveView, AiBriefingCard } from "./components/executive-view";
import { PnlView } from "./components/pnl-view";
import { RevenueView } from "./components/revenue-view";
import { ExpensesView } from "./components/expenses-view";
import { ClientsView } from "./components/clients-view";
import { BookingsView } from "./components/bookings-view";
import { MarketingView } from "./components/marketing-view";
import { CashFlowForecastView } from "./components/cash-flow-forecast-view";
import { exportReportPDF, exportReportCSV } from "./components/export-pdf";

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
    if (tab === "cash-flow") {
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
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Reports"
        subtitle="Generate intelligent business reports with AI-powered insights"
        titleExtra={<PageGuideTrigger moduleKey="reports" />}
        rightSlot={
          <div className="flex items-center gap-2">
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
              onClick={() => setShowContactPicker(true)}
              className="inline-flex items-center gap-2 text-sm px-3 min-h-[44px] rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Send className="w-4 h-4" />
              Broadcast
            </button>
          </div>
        }
      />

      <div data-walkthrough="reports-tabs">
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as ReportType)}
          layoutId="reports-tab-pill"
        />
      </div>

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
        {activeTab === "cash-flow" && !report && !loading ? (
          <CashFlowForecastView businessId={businessId} />
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
              {activeTab === "pnl" && <PnlView report={report} />}
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

      <PageGuide
        moduleKey="reports"
        walkthroughSteps={REPORTS_WALKTHROUGH}
      />
    </div>
  );
}
