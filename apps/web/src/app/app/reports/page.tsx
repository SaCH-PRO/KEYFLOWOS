"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  BarChart3, Download, Loader2, RefreshCw, ChevronDown, Send, Clock, Lightbulb, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCardSkeleton, ChartSkeleton } from "@/components/ui/skeleton";
import { TabNav } from "@/components/ui/tab-nav";
import { ContactPickerDrawer } from "@/components/contacts";
import { fetchReport, GeneratedReport } from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { ReportType, REPORT_TABS, DATE_PRESETS, getDateRange, formatDate } from "./components/report-types";
import { ExecutiveView } from "./components/executive-view";
import { PnlView } from "./components/pnl-view";
import { RevenueView } from "./components/revenue-view";
import { ExpensesView } from "./components/expenses-view";
import { ClientsView } from "./components/clients-view";
import { BookingsView } from "./components/bookings-view";
import { MarketingView } from "./components/marketing-view";
import { exportReportPDF } from "./components/export-pdf";

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
  const [showGuide, setShowGuide] = useState(false);
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
      await exportReportPDF(report);
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
        titleExtra={
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Choose Report Type", desc: "Select from Executive, P&L, Revenue, Expenses, or Clients report views." },
                        { step: "2", title: "Set Date Range", desc: "Pick a preset period or set custom start and end dates for your report." },
                        { step: "3", title: "Generate Report", desc: "AI analyzes your business data and generates comprehensive insights." },
                        { step: "4", title: "View AI Insights", desc: "Get intelligent summaries, trends, and actionable recommendations." },
                        { step: "5", title: "Export Data", desc: "Download reports as PDF for sharing with partners or accountants." },
                        { step: "6", title: "Schedule Reports", desc: "Set up recurring report generation to stay on top of your metrics." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
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
              onClick={() => generateReport()}
              className="text-sm px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
            >
              Generate
            </button>
          </div>
        )}

        <button
          onClick={() => generateReport()}
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
              {activeTab === "executive" && <ExecutiveView report={report} />}
              {activeTab === "pnl" && <PnlView report={report} />}
              {activeTab === "revenue" && <RevenueView report={report} />}
              {activeTab === "expenses" && <ExpensesView report={report} />}
              {activeTab === "clients" && <ClientsView report={report} />}
              {activeTab === "bookings" && <BookingsView report={report} />}
              {activeTab === "marketing" && <MarketingView report={report} />}

              <div className="mt-6 text-center">
                <p className="text-xs text-muted-foreground/60">
                  Report generated on {formatDate(report.generatedAt)} | Period: {formatDate(report.metrics.period.start)} — {formatDate(report.metrics.period.end)} | All amounts in {report.metrics.currency}
                </p>
              </div>
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
    </div>
  );
}
