"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  BarChart3, Download, Loader2, RefreshCw, ChevronDown, Send, Clock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/ui/page-header";
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
