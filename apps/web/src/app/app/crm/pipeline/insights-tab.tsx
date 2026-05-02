"use client";

import React, { useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Zap,
  AlertTriangle,
  DollarSign,
  Clock,
  CheckCircle2,
  ListChecks,
  Target,
  Filter,
  Tag,
  ChevronDown,
  Download,
  RefreshCw,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { Contact } from "@/lib/client";
import { exportInsightsReport, type InsightsExportFormat } from "@/lib/contacts-export";
import { AiCommandCenter } from "./ai-command-center";
import { type Period, PERIOD_LABELS, PERIOD_MS, stagger, formatTTD } from "./components/insights/insights-shared";
import { LazyWidget } from "./components/insights/lazy-widget";
import { HeroStats } from "./components/insights/hero-stats";
import { FunnelChart } from "./components/insights/pipeline-funnel";
import { RevenueBreakdown, RevenueByClient } from "./components/insights/revenue-forecast";
import { GrowthTrend } from "./components/insights/contact-growth";
import { DataCompleteness, TaskHealth } from "./components/insights/data-quality";
import { LeadScoreDistribution } from "./components/insights/lead-scores";
import { EngagementHeatmap } from "./components/insights/engagement-heatmap";
import { ConversionTimeline } from "./components/insights/conversion-timeline";
import { TagPerformance } from "./components/insights/tag-performance";
import { SourceConversion, ChannelPreference, TopSources } from "./components/insights/source-channels";

interface InsightsTabProps {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  contacts: Contact[];
  loading?: boolean;
  businessId: string | null;
  onViewCold: () => void;
  onViewReady: () => void;
  onViewExpiringQuotes: () => void;
  onViewOverdueInvoices: () => void;
  onRefresh?: () => void;
  onNavigatePipeline?: (filter?: { status?: string; segment?: string }) => void;
}

function InsightsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading insights">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/50 bg-card p-3.5">
            <Skeleton className="h-3 w-14 mb-2" />
            <Skeleton className="h-7 w-16 mb-1.5" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <div className="lg:col-span-3 rounded-xl border border-border/50 bg-card p-3.5 space-y-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-6 w-full rounded-md" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 rounded-xl border border-border/50 bg-card p-3.5 space-y-2.5">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

function InsightEmptyState({ icon: Icon, message, label }: { icon: React.ElementType; message: string; label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      {label && (
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-3 self-start">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </h3>
      )}
      <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-border/30 flex items-center justify-center mb-2">
        <Icon className="w-4 h-4 text-muted-foreground/50" />
      </div>
      <p className="text-[10px] text-muted-foreground/50 max-w-[180px] leading-relaxed">{message}</p>
    </div>
  );
}

const AlertCards = React.memo(function AlertCards({
  data, revenueData, onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices,
}: {
  data: FlowIntelligenceData;
  revenueData: RevenueData | null;
  onViewCold: () => void;
  onViewReady: () => void;
  onViewExpiringQuotes: () => void;
  onViewOverdueInvoices: () => void;
}) {
  const alerts = useMemo(() => {
    const items: { key: string; priority: number; icon: React.ElementType; label: string; sub: string; onClick: () => void; variant: "success" | "danger" | "warning" }[] = [];
    if (data.contactsReadyToAdvance > 0) items.push({ key: "ready", priority: 1, icon: Zap, label: `${data.contactsReadyToAdvance} ready to advance`, sub: "High engagement", onClick: onViewReady, variant: "success" });
    if (revenueData?.overdueInvoices && revenueData.overdueInvoices.count > 0) items.push({ key: "invoices", priority: 2, icon: DollarSign, label: `${revenueData.overdueInvoices.count} overdue invoices`, sub: `${formatTTD(revenueData.overdueInvoices.value)} outstanding`, onClick: onViewOverdueInvoices, variant: "danger" });
    if (data.contactsGoingCold > 0) items.push({ key: "cold", priority: 3, icon: AlertTriangle, label: `${data.contactsGoingCold} going cold`, sub: "Re-engage soon", onClick: onViewCold, variant: "warning" });
    if (revenueData?.expiringQuotes && revenueData.expiringQuotes.count > 0) items.push({ key: "quotes", priority: 4, icon: Clock, label: `${revenueData.expiringQuotes.count} quotes expiring`, sub: `${formatTTD(revenueData.expiringQuotes.value)} at risk`, onClick: onViewExpiringQuotes, variant: "warning" });
    return items.sort((a, b) => a.priority - b.priority);
  }, [data, revenueData, onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices]);

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04]">
        <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /></div>
        <div><span className="text-xs text-emerald-400 font-semibold">All clear</span><p className="text-[10px] text-emerald-400/50">No action items</p></div>
      </div>
    );
  }

  const variantStyles = { success: "border-emerald-500/20 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]", danger: "border-red-500/20 bg-red-500/[0.03] hover:bg-red-500/[0.06]", warning: "border-amber-500/20 bg-amber-500/[0.03] hover:bg-amber-500/[0.06]" };
  const iconStyles = { success: "bg-emerald-500/12 text-emerald-400", danger: "bg-red-500/12 text-red-400", warning: "bg-amber-500/12 text-amber-400" };

  return (
    <div className="space-y-1.5" role="group" aria-label="Action alerts">
      {alerts.map((a) => {
        const Icon = a.icon;
        return (
          <button key={a.key} onClick={a.onClick} className={`flex items-center gap-2.5 w-full p-2.5 rounded-lg border transition-all duration-200 text-left group ${variantStyles[a.variant]}`} aria-label={`${a.label} — ${a.sub}`}>
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${iconStyles[a.variant]}`}><Icon className="w-3.5 h-3.5" /></div>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-foreground">{a.label}</div><div className="text-[10px] text-muted-foreground/50">{a.sub}</div></div>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground/70 -translate-x-1 group-hover:translate-x-0 transition-all" />
          </button>
        );
      })}
    </div>
  );
});

function InsightsTabInner({
  flowIntelligence, revenueData, contacts, loading,
  businessId, onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices,
  onRefresh, onNavigatePipeline,
}: InsightsTabProps) {
  const [period, setPeriod] = useState<Period>("30d");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const togglePeriodMenu = useCallback(() => setShowPeriodMenu((p) => !p), []);
  const closePeriodMenu = useCallback(() => setShowPeriodMenu(false), []);
  const toggleExportMenu = useCallback(() => setShowExportMenu((p) => !p), []);
  const closeExportMenu = useCallback(() => setShowExportMenu(false), []);
  const handleSelectPeriod = useCallback((p: Period) => { setPeriod(p); setShowPeriodMenu(false); }, []);
  const handleRefresh = useCallback(async () => { setRefreshing(true); onRefresh?.(); setTimeout(() => setRefreshing(false), 1000); }, [onRefresh]);

  const filteredContacts = useMemo(() => {
    if (period === "custom") {
      const start = customStart ? new Date(customStart).getTime() : 0;
      const end = customEnd ? new Date(customEnd).getTime() + 86_400_000 : Date.now();
      return contacts.filter((c) => { const d = c.createdAt ? new Date(c.createdAt).getTime() : 0; return d >= start && d <= end; });
    }
    const cutoff = Date.now() - PERIOD_MS[period];
    return contacts.filter((c) => { const d = c.createdAt ? new Date(c.createdAt).getTime() : 0; return d >= cutoff; });
  }, [contacts, period, customStart, customEnd]);

  const periodContacts = filteredContacts.length > 0 ? filteredContacts : contacts;

  const handleExport = useCallback(async (format: InsightsExportFormat) => {
    setShowExportMenu(false);
    await exportInsightsReport({
      totalContacts: contacts.length, leads: flowIntelligence?.leads ?? 0, prospects: flowIntelligence?.prospects ?? 0, clients: flowIntelligence?.clients ?? 0,
      conversionRate: flowIntelligence && flowIntelligence.leads > 0 ? ((flowIntelligence.clients / flowIntelligence.leads) * 100).toFixed(1) + "%" : "0%",
      pipelineValue: revenueData ? revenueData.fromActivePipeline + revenueData.fromRecurringClients + revenueData.fromColdLeads : 0,
      newThisWeek: flowIntelligence?.newThisWeek ?? 0, period: period === "custom" ? `${customStart || "start"} to ${customEnd || "now"}` : PERIOD_LABELS[period], contacts: periodContacts,
    }, format);
  }, [contacts, flowIntelligence, revenueData, period, customStart, customEnd, periodContacts]);

  if (loading) return <InsightsSkeleton />;

  if (!flowIntelligence && !revenueData && contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 flex items-center justify-center mb-4 border border-border/30"><BarChart3 className="w-6 h-6 text-muted-foreground/50" /></div>
        <p className="text-sm font-semibold text-foreground/60 mb-1">No Insights Yet</p>
        <p className="text-xs text-muted-foreground/50 max-w-[240px] leading-relaxed">Add contacts and activities to unlock pipeline analytics.</p>
      </div>
    );
  }

  const hasRevenueClients = periodContacts.some((c) => c.meta?.totalRevenue && c.meta.totalRevenue > 0);
  const hasClients = periodContacts.some((c) => c.status === "CLIENT");
  const hasTags = periodContacts.some((c) => Array.isArray(c.tags) && c.tags.length > 0);
  const hasLeadScores = periodContacts.some((c) => (c as Record<string, unknown>).leadScore != null);
  const hasMeta = periodContacts.some((c) => (c as Record<string, unknown>).meta);
  return (
    <motion.div initial="hidden" animate="visible" variants={stagger.container} className="space-y-3">
      <motion.div variants={stagger.item} className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]" />
          <h2 className="text-sm font-semibold tracking-tight">Insights</h2>
          <span className="text-[10px] text-muted-foreground/50 font-medium">{contacts.length} contacts</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] transition-colors disabled:opacity-50" aria-label="Refresh insights">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/50 ${refreshing ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Refresh</span>
          </button>
          <div className="relative">
            <button onClick={toggleExportMenu} className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] transition-colors" aria-haspopup="listbox" aria-expanded={showExportMenu} aria-label="Export report">
              <Download className="w-3.5 h-3.5 text-muted-foreground/50" /><span className="hidden sm:inline">Export</span><ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${showExportMenu ? "rotate-180" : ""}`} />
            </button>
            {showExportMenu && (<><div className="fixed inset-0 z-10" onClick={closeExportMenu} /><div className="absolute right-0 top-full mt-1 z-20 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl py-1 min-w-[140px]">
              {([{ format: "pdf" as const, label: "Export as PDF" }, { format: "csv" as const, label: "Export as CSV" }]).map((opt) => (
                <button key={opt.format} onClick={() => handleExport(opt.format)} className="w-full text-left px-3 py-2 text-[11px] hover:bg-white/[0.05] transition-colors text-muted-foreground hover:text-foreground">{opt.label}</button>
              ))}</div></>)}
          </div>
          <div className="relative">
            <button onClick={togglePeriodMenu} className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] transition-colors" aria-haspopup="listbox" aria-expanded={showPeriodMenu} aria-label={`Time period: ${PERIOD_LABELS[period]}`}>
              <Calendar className="w-3.5 h-3.5 text-muted-foreground/50" />{PERIOD_LABELS[period]}<ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform ${showPeriodMenu ? "rotate-180" : ""}`} />
            </button>
            {showPeriodMenu && (<><div className="fixed inset-0 z-10" onClick={closePeriodMenu} /><div className="absolute right-0 top-full mt-1 z-20 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl py-1 min-w-[170px]" role="listbox" aria-label="Select time period">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (<button key={p} role="option" aria-selected={p === period} onClick={() => handleSelectPeriod(p)} className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/[0.05] transition-colors ${p === period ? "font-semibold text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`}>{PERIOD_LABELS[p]}</button>))}
              {period === "custom" && (<div className="px-3 py-2 space-y-1.5 border-t border-border/20 mt-0.5 pt-2">
                <div className="flex items-center gap-1.5"><label className="text-[10px] text-muted-foreground/50 w-8">From</label><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="flex-1 text-[10px] bg-white/[0.03] border border-border/30 rounded-md px-2 py-1 text-foreground" /></div>
                <div className="flex items-center gap-1.5"><label className="text-[10px] text-muted-foreground/50 w-8">To</label><input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="flex-1 text-[10px] bg-white/[0.03] border border-border/30 rounded-md px-2 py-1 text-foreground" /></div>
              </div>)}
            </div></>)}
          </div>
        </div>
      </motion.div>

      <HeroStats flowIntelligence={flowIntelligence} revenueData={revenueData} contacts={periodContacts} onNavigatePipeline={onNavigatePipeline} />

      <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
        {flowIntelligence ? (
          <LazyWidget className="lg:col-span-7 rounded-xl border border-border/50 bg-card p-3.5" height={180}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-2.5"><Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />Pipeline Funnel</h3>
            <FunnelChart data={flowIntelligence} />
          </LazyWidget>
        ) : null}
        <div className={`${flowIntelligence ? "lg:col-span-5" : "lg:col-span-12"} rounded-xl border border-border/50 bg-card p-4`}>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5 mb-3"><AlertTriangle className="w-3.5 h-3.5 text-amber-400/60" />Action Items</h3>
          {flowIntelligence ? <AlertCards data={flowIntelligence} revenueData={revenueData} onViewCold={onViewCold} onViewReady={onViewReady} onViewExpiringQuotes={onViewExpiringQuotes} onViewOverdueInvoices={onViewOverdueInvoices} /> : (
            <div className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04]"><div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /></div><span className="text-xs text-emerald-400/70 font-medium">All clear — no action items right now</span></div>
          )}
        </div>
      </motion.div>

      <LazyWidget height={200}>
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
          {revenueData && <div className="lg:col-span-5 rounded-xl border border-border/50 bg-card p-3.5"><RevenueBreakdown data={revenueData} /></div>}
          <div className={`rounded-xl border border-border/50 bg-card p-4 ${revenueData ? "lg:col-span-7" : "lg:col-span-12"}`}><GrowthTrend contacts={contacts} period={period} /></div>
        </motion.div>
      </LazyWidget>

      <LazyWidget height={200}>
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
          <div className="lg:col-span-5 rounded-xl border border-border/50 bg-card p-4"><DataCompleteness contacts={periodContacts} /></div>
          <div className="lg:col-span-4 rounded-xl border border-border/50 bg-card p-4"><LeadScoreDistribution contacts={periodContacts} />{!hasLeadScores && <InsightEmptyState icon={Target} message="Scores appear as contacts engage" />}</div>
          <div className="lg:col-span-3 rounded-xl border border-border/50 bg-card p-4"><TaskHealth contacts={periodContacts} />{!hasMeta && <InsightEmptyState icon={ListChecks} message="Health data appears with tasks" />}</div>
        </motion.div>
      </LazyWidget>

      <LazyWidget height={200}>
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
          <div className="lg:col-span-6 rounded-xl border border-border/50 bg-card p-4">{hasRevenueClients ? <RevenueByClient contacts={periodContacts} onNavigatePipeline={onNavigatePipeline} /> : <InsightEmptyState icon={DollarSign} message="Revenue data appears with invoices" label="Revenue by Client" />}</div>
          <div className="lg:col-span-6 rounded-xl border border-border/50 bg-card p-4"><EngagementHeatmap contacts={periodContacts} /></div>
        </motion.div>
      </LazyWidget>

      <LazyWidget height={200}>
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
          <div className="lg:col-span-4 rounded-xl border border-border/50 bg-card p-4">{hasClients ? <ConversionTimeline contacts={periodContacts} /> : <InsightEmptyState icon={Clock} message="Conversion data appears with stage changes" label="Conversion Timeline" />}</div>
          <div className="lg:col-span-4 rounded-xl border border-border/50 bg-card p-4">{hasTags ? <TagPerformance contacts={periodContacts} onNavigatePipeline={onNavigatePipeline} /> : <InsightEmptyState icon={Tag} message="Tag analytics appear with tagged contacts" label="Tag Performance" />}</div>
          <div className="lg:col-span-4 rounded-xl border border-border/50 bg-card p-4 space-y-5"><SourceConversion contacts={periodContacts} /><TopSources contacts={periodContacts} /><ChannelPreference contacts={periodContacts} />{!periodContacts.some((c) => c.source) && <InsightEmptyState icon={Filter} message="Source data appears with attributed contacts" />}</div>
        </motion.div>
      </LazyWidget>

      <motion.div variants={stagger.item}>
        <a
          href="/app/commerce?tab=insights"
          className="flex items-center gap-3 p-3.5 rounded-xl border border-border/50 bg-card hover:bg-white/[0.04] transition-colors group"
        >
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 flex items-center justify-center shrink-0 border border-border/30">
            <DollarSign className="w-4 h-4 text-muted-foreground/60" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-foreground/80">Financial Overview</span>
            <p className="text-[10px] text-muted-foreground/50">Revenue velocity, cash flow health, and detailed financial analytics are available in Commerce Insights.</p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground/70 -translate-x-1 group-hover:translate-x-0 transition-all shrink-0" />
        </a>
      </motion.div>

      <LazyWidget height={100}>
        <motion.div variants={stagger.item}><AiCommandCenter businessId={businessId} contactCount={contacts.length} /></motion.div>
      </LazyWidget>
    </motion.div>
  );
}

class InsightsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[InsightsTab] Render crash:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/30">
            <BarChart3 className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-sm font-semibold text-foreground/60 mb-1">Insights Error</p>
          <p className="text-xs text-muted-foreground/50 max-w-[280px] leading-relaxed mb-3">
            {this.state.error?.message || "Something went wrong rendering insights."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] border border-border/50 hover:bg-white/[0.08] transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function InsightsTabWrapper(props: InsightsTabProps) {
  return (
    <InsightsErrorBoundary>
      <InsightsTabInner {...props} />
    </InsightsErrorBoundary>
  );
}

export const InsightsTab = React.memo(InsightsTabWrapper);
