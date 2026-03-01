"use client";

import React, { useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, TrendingUp, Users, ArrowRight, DollarSign,
  Clock, Zap, AlertTriangle, Filter, ChevronDown,
  CheckCircle2, ListChecks, Target, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Activity, MessageCircle,
  Mail, Phone, Globe, Download, RefreshCw, Hash,
  Calendar, Tag,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { Contact } from "@/lib/client";
import { exportInsightsReport, type InsightsExportFormat } from "@/lib/contacts-export";
import { AiCommandCenter } from "./ai-command-center";

type Period = "7d" | "30d" | "90d" | "custom";

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

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "custom": "Custom",
};

const PERIOD_MS: Record<Exclude<Period, "custom">, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } },
  item: { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } },
};

function InsightsSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading insights">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/50 bg-card p-5">
            <Skeleton className="h-3 w-16 mb-3" />
            <Skeleton className="h-8 w-20 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-3 rounded-2xl border border-border/50 bg-card p-5 space-y-4">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-7 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 rounded-2xl border border-border/50 bg-card p-5 space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-5"><Skeleton className="h-36 w-full" /></div>
        <div className="rounded-2xl border border-border/50 bg-card p-5"><Skeleton className="h-36 w-full" /></div>
      </div>
    </div>
  );
}

function Sparkline({ data, color, width = 48, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(" ");
  const areaPath = `M0,${height} L${points.split(" ").map((p, i) => (i === 0 ? p.split(",").join(",") : p)).join(" L")} L${width},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, "")})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r="2" fill={color} />
    </svg>
  );
}

function buildWeeklyBuckets(contacts: Contact[], weeks: number): number[] {
  const now = Date.now();
  const buckets: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = now - (i + 1) * 7 * 86_400_000;
    const end = now - i * 7 * 86_400_000;
    buckets.push(contacts.filter((c) => {
      const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return d >= start && d < end;
    }).length);
  }
  return buckets;
}

const FUNNEL_STAGES = [
  { key: "leads", label: "Leads", gradient: "from-orange-500/80 to-orange-400/60" },
  { key: "prospects", label: "Prospects", gradient: "from-teal-500/80 to-teal-400/60" },
  { key: "clients", label: "Clients", gradient: "from-emerald-500/80 to-emerald-400/60" },
] as const;

const FunnelChart = React.memo(function FunnelChart({ data }: { data: FlowIntelligenceData }) {
  const maxCount = Math.max(data.leads, data.prospects, data.clients, 1);
  const stages = [
    { ...FUNNEL_STAGES[0], count: data.leads, color: "hsl(var(--kf-accent1))" },
    { ...FUNNEL_STAGES[1], count: data.prospects, color: "hsl(var(--kf-accent2))" },
    { ...FUNNEL_STAGES[2], count: data.clients, color: "hsl(142 76% 36%)" },
  ];

  const leadToProspect = data.leads > 0 ? ((data.prospects / data.leads) * 100).toFixed(0) : "0";
  const prospectToClient = data.prospects > 0 ? ((data.clients / data.prospects) * 100).toFixed(0) : "0";
  const conversionRates = [leadToProspect, prospectToClient];

  return (
    <div className="space-y-3" role="img" aria-label={`Pipeline funnel: ${data.leads} leads, ${data.prospects} prospects, ${data.clients} clients`}>
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.count / maxCount) * 100, 12);
        return (
          <div key={stage.key}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-foreground/80">{stage.label}</span>
              <span className="font-mono font-bold text-sm" style={{ color: stage.color }}>{stage.count}</span>
            </div>
            <div className="h-8 bg-white/[0.03] rounded-lg overflow-hidden relative group">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${widthPct}%` }}
                transition={{ duration: 0.8, delay: i * 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                className={`h-full rounded-lg bg-gradient-to-r ${stage.gradient}`}
              />
              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/[0.04] transition-colors rounded-lg" />
            </div>
            {i < stages.length - 1 && (
              <div className="flex items-center gap-1.5 mt-1.5 ml-3">
                <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[11px] text-muted-foreground/70 font-medium">
                  {conversionRates[i]}% convert
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

const HeroStats = React.memo(function HeroStats({
  flowIntelligence, revenueData, contacts, onNavigatePipeline,
}: {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  contacts: Contact[];
  onNavigatePipeline?: (filter?: { status?: string; segment?: string }) => void;
}) {
  const totalRevenue = revenueData
    ? revenueData.fromActivePipeline + revenueData.fromRecurringClients + revenueData.fromColdLeads
    : 0;
  const overallConversion = flowIntelligence && flowIntelligence.leads > 0
    ? ((flowIntelligence.clients / flowIntelligence.leads) * 100).toFixed(1)
    : "0";
  const newThisWeek = flowIntelligence?.newThisWeek ?? 0;
  const convThisWeek = flowIntelligence?.conversionsThisWeek ?? 0;

  const sparkData = useMemo(() => buildWeeklyBuckets(contacts, 6), [contacts]);

  const stats = [
    {
      label: "Total Contacts",
      value: contacts.length.toString(),
      sub: `${flowIntelligence?.leads ?? 0} leads, ${flowIntelligence?.clients ?? 0} clients`,
      icon: Users,
      accentVar: "--kf-accent2",
      sparkColor: "hsl(var(--kf-accent2))",
      trend: newThisWeek > 0 ? "up" as const : null,
      trendLabel: newThisWeek > 0 ? `+${newThisWeek} this week` : undefined,
      onClick: () => onNavigatePipeline?.(),
    },
    {
      label: "Conversion Rate",
      value: `${overallConversion}%`,
      sub: `${flowIntelligence?.leads ?? 0} → ${flowIntelligence?.clients ?? 0}`,
      icon: TrendingUp,
      accentVar: "--kf-accent1",
      sparkColor: "hsl(var(--kf-accent1))",
      trend: convThisWeek > 0 ? "up" as const : null,
      trendLabel: convThisWeek > 0 ? `${convThisWeek} this week` : undefined,
      onClick: () => onNavigatePipeline?.({ status: "CLIENT" }),
    },
    {
      label: "Pipeline Value",
      value: formatTTD(totalRevenue),
      sub: revenueData ? `${formatTTD(revenueData.fromActivePipeline)} active` : "No data",
      icon: DollarSign,
      accentVar: "--kf-accent1",
      sparkColor: "hsl(142 76% 36%)",
      trend: null,
      trendLabel: undefined,
      onClick: () => onNavigatePipeline?.({ segment: "high-value" }),
    },
    {
      label: "New This Week",
      value: newThisWeek.toString(),
      sub: `${convThisWeek} conversion${convThisWeek !== 1 ? "s" : ""}, ${flowIntelligence?.lost ?? 0} lost`,
      icon: Activity,
      accentVar: "--kf-accent2",
      sparkColor: "hsl(var(--kf-accent2))",
      trend: flowIntelligence && flowIntelligence.lost > 0 ? "down" as const : null,
      trendLabel: flowIntelligence && flowIntelligence.lost > 0 ? `${flowIntelligence.lost} lost` : undefined,
      onClick: () => onNavigatePipeline?.({ segment: "new-this-week" }),
    },
  ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      role="group"
      aria-label="Key metrics"
    >
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <motion.button
            key={s.label}
            variants={stagger.item}
            onClick={s.onClick}
            className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/80 p-4 group hover:border-border/80 transition-all duration-300 text-left cursor-pointer"
          >
            <div
              className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.05] -translate-y-1/2 translate-x-1/2 blur-xl"
              style={{ background: `hsl(var(${s.accentVar}))` }}
            />
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
                <span className="text-[10px] text-muted-foreground/70 font-semibold uppercase tracking-wider">{s.label}</span>
              </div>
              <div className="opacity-60 group-hover:opacity-100 transition-opacity">
                <Sparkline data={sparkData} color={s.sparkColor} />
              </div>
            </div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: `hsl(var(${s.accentVar}))` }}>
              {s.value}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] text-muted-foreground/60">{s.sub}</span>
            </div>
            {s.trend && s.trendLabel && (
              <div className={`flex items-center gap-0.5 mt-1.5 text-[10px] font-semibold ${s.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                {s.trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {s.trendLabel}
              </div>
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
});

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

    if (data.contactsReadyToAdvance > 0) {
      items.push({
        key: "ready", priority: 1, icon: Zap,
        label: `${data.contactsReadyToAdvance} ready to advance`,
        sub: "High engagement detected",
        onClick: onViewReady, variant: "success",
      });
    }

    if (revenueData?.overdueInvoices && revenueData.overdueInvoices.count > 0) {
      items.push({
        key: "invoices", priority: 2, icon: DollarSign,
        label: `${revenueData.overdueInvoices.count} overdue invoices`,
        sub: `${formatTTD(revenueData.overdueInvoices.value)} outstanding`,
        onClick: onViewOverdueInvoices, variant: "danger",
      });
    }

    if (data.contactsGoingCold > 0) {
      items.push({
        key: "cold", priority: 3, icon: AlertTriangle,
        label: `${data.contactsGoingCold} going cold`,
        sub: "Re-engage before they're lost",
        onClick: onViewCold, variant: "warning",
      });
    }

    if (revenueData?.expiringQuotes && revenueData.expiringQuotes.count > 0) {
      items.push({
        key: "quotes", priority: 4, icon: Clock,
        label: `${revenueData.expiringQuotes.count} quotes expiring`,
        sub: `${formatTTD(revenueData.expiringQuotes.value)} at risk`,
        onClick: onViewExpiringQuotes, variant: "warning",
      });
    }

    return items.sort((a, b) => a.priority - b.priority);
  }, [data, revenueData, onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices]);

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        </div>
        <div>
          <span className="text-xs text-emerald-400 font-semibold">All clear</span>
          <p className="text-[10px] text-emerald-400/50 mt-0.5">No action items right now</p>
        </div>
      </div>
    );
  }

  const variantStyles = {
    success: "border-emerald-500/25 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]",
    danger: "border-red-500/25 bg-red-500/[0.04] hover:bg-red-500/[0.08]",
    warning: "border-amber-500/25 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]",
  };
  const iconStyles = {
    success: "bg-emerald-500/15 text-emerald-400",
    danger: "bg-red-500/15 text-red-400",
    warning: "bg-amber-500/15 text-amber-400",
  };

  return (
    <div className="space-y-2" role="group" aria-label="Action alerts">
      {alerts.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            onClick={a.onClick}
            className={`flex items-center gap-3 w-full p-3.5 rounded-xl border transition-all duration-200 text-left group ${variantStyles[a.variant]}`}
            aria-label={`${a.label} — ${a.sub}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconStyles[a.variant]}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">{a.label}</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{a.sub}</div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 -translate-x-1 group-hover:translate-x-0 transition-all" />
          </button>
        );
      })}
    </div>
  );
});

const RevenueBreakdown = React.memo(function RevenueBreakdown({ data }: { data: RevenueData }) {
  const total = data.fromActivePipeline + data.fromRecurringClients + data.fromColdLeads;
  const sources = [
    { label: "Active Pipeline", value: data.fromActivePipeline, gradient: "from-orange-500 to-orange-400", color: "hsl(var(--kf-accent1))" },
    { label: "Recurring", value: data.fromRecurringClients, gradient: "from-emerald-500 to-emerald-400", color: "hsl(142 76% 36%)" },
    { label: "Cold (if won)", value: data.fromColdLeads, gradient: "from-slate-500 to-slate-400", color: "hsl(215 20% 55%)" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          Revenue Forecast
        </h3>
        <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
          {formatTTD(total)}
        </span>
      </div>

      <div className="h-3 bg-white/[0.03] rounded-full overflow-hidden flex" role="img" aria-label={`Revenue: ${formatTTD(total)}`}>
        {sources.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <motion.div
              key={s.label}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
              className={`h-full first:rounded-l-full last:rounded-r-full bg-gradient-to-r ${s.gradient}`}
              title={`${s.label}: ${formatTTD(s.value)}`}
            />
          );
        })}
      </div>

      <div className="space-y-2.5">
        {sources.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${s.gradient}`} />
                <span className="text-muted-foreground/70">{s.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatTTD(s.value)}</span>
                <span className="text-muted-foreground/40 w-8 text-right font-mono text-[10px]">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {(data.expiringQuotes.count > 0 || data.overdueInvoices.count > 0) && (
        <div className="flex gap-2 pt-3 border-t border-border/30">
          {data.expiringQuotes.count > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 px-2.5 py-1.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
              <Clock className="w-3 h-3" />
              {data.expiringQuotes.count} expiring
            </div>
          )}
          {data.overdueInvoices.count > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400 px-2.5 py-1.5 rounded-lg bg-red-500/[0.06] border border-red-500/15">
              <DollarSign className="w-3 h-3" />
              {data.overdueInvoices.count} overdue
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const COMPLETENESS_FIELDS: { key: keyof Contact; weight: number }[] = [
  { key: "firstName", weight: 15 },
  { key: "lastName", weight: 10 },
  { key: "email", weight: 20 },
  { key: "phone", weight: 15 },
  { key: "companyName", weight: 10 },
  { key: "source", weight: 5 },
  { key: "tags", weight: 5 },
  { key: "city", weight: 5 },
  { key: "country", weight: 5 },
  { key: "jobTitle", weight: 5 },
  { key: "preferredChannel", weight: 5 },
];

function computeHealthStats(contacts: Contact[]) {
  if (contacts.length === 0) {
    return { completenessAvg: 0, withEmail: 0, withPhone: 0, withCompany: 0, withTags: 0, withCity: 0, total: 0 };
  }

  let totalScore = 0;
  let withEmail = 0, withPhone = 0, withCompany = 0, withTags = 0, withCity = 0;

  for (const c of contacts) {
    let score = 0;
    for (const f of COMPLETENESS_FIELDS) {
      const val = c[f.key];
      if (f.key === "tags") {
        if (Array.isArray(val) && val.length > 0) score += f.weight;
      } else if (val && typeof val === "string" && val.trim()) {
        score += f.weight;
      }
    }
    totalScore += score;
    if (c.email) withEmail++;
    if (c.phone) withPhone++;
    if (c.companyName) withCompany++;
    if (Array.isArray(c.tags) && c.tags.length > 0) withTags++;
    if (c.city) withCity++;
  }

  return { completenessAvg: Math.round(totalScore / contacts.length), withEmail, withPhone, withCompany, withTags, withCity, total: contacts.length };
}

function getCompletenessColor(pct: number): string {
  if (pct >= 75) return "hsl(142 76% 36%)";
  if (pct >= 50) return "hsl(var(--kf-accent2))";
  if (pct >= 25) return "hsl(var(--kf-accent1))";
  return "hsl(0 84% 60%)";
}

const DataCompleteness = React.memo(function DataCompleteness({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => computeHealthStats(contacts), [contacts]);

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-2">
          <ShieldCheck className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <p className="text-xs text-muted-foreground/60">Add contacts to track data quality</p>
      </div>
    );
  }

  const color = getCompletenessColor(stats.completenessAvg);
  const fields = [
    { label: "Email", count: stats.withEmail, icon: Mail },
    { label: "Phone", count: stats.withPhone, icon: Phone },
    { label: "Company", count: stats.withCompany, icon: Globe },
    { label: "Tags", count: stats.withTags, icon: Filter },
    { label: "Location", count: stats.withCity, icon: Target },
  ];

  const circumference = 2 * Math.PI * 42;
  const dashLength = (stats.completenessAvg / 100) * circumference;

  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5" />
        Data Quality
      </h3>
      <div className="flex items-center gap-5">
        <div className="relative w-[88px] h-[88px] flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="5" className="stroke-white/[0.04]" />
            <motion.circle
              cx="50" cy="50" r="42" fill="none" strokeWidth="5"
              initial={{ strokeDasharray: `0 ${circumference}` }}
              animate={{ strokeDasharray: `${dashLength} ${circumference - dashLength}` }}
              transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              strokeLinecap="round"
              style={{ stroke: color }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold" style={{ color }}>{stats.completenessAvg}%</span>
            <span className="text-[10px] text-muted-foreground/50">complete</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {fields.map((f) => {
            const pct = Math.round((f.count / stats.total) * 100);
            const FieldIcon = f.icon;
            return (
              <div key={f.label} className="flex items-center gap-2">
                <FieldIcon className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                <span className="text-[10px] text-muted-foreground/60 w-14">{f.label}</span>
                <div className="flex-1 h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="h-full rounded-full"
                    style={{ background: getCompletenessColor(pct) }}
                  />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/50 w-8 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

interface GrowthBucket { label: string; count: number; }

const GrowthTrend = React.memo(function GrowthTrend({ contacts, period }: { contacts: Contact[]; period: Period }) {
  const buckets = useMemo(() => {
    const now = Date.now();
    const effectivePeriod = period === "custom" ? "90d" : period;
    const ms = PERIOD_MS[effectivePeriod];
    const bucketCount = effectivePeriod === "7d" ? 7 : 6;
    const bucketSize = ms / bucketCount;
    const cutoff = now - ms;

    const result: GrowthBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const start = cutoff + i * bucketSize;
      const end = start + bucketSize;
      const count = contacts.filter((c) => {
        const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
        return d >= start && d < end;
      }).length;

      let label: string;
      if (effectivePeriod === "7d") {
        label = new Date(start).toLocaleDateString("en-TT", { weekday: "short" });
      } else if (effectivePeriod === "30d") {
        label = new Date(start).toLocaleDateString("en-TT", { month: "short", day: "numeric" });
      } else {
        label = new Date(start).toLocaleDateString("en-TT", { month: "short" });
      }
      result.push({ label, count });
    }
    return result;
  }, [contacts, period]);

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const totalNew = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5" />
          Contact Growth
        </h3>
        {totalNew > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))]">
            +{totalNew}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1 h-28" role="img" aria-label={`Growth: ${totalNew} new contacts`}>
        {buckets.map((b, i) => {
          const heightPct = Math.max((b.count / maxCount) * 100, 4);
          const isZero = b.count === 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group cursor-default">
              {!isZero && (
                <span className="text-[10px] font-mono font-semibold text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity" aria-label={`${b.count} contacts`}>{b.count}</span>
              )}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${heightPct}%` }}
                transition={{ duration: 0.6, delay: i * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="w-full rounded-md transition-all group-hover:brightness-125"
                style={{
                  background: isZero
                    ? "hsl(var(--muted) / 0.2)"
                    : `linear-gradient(to top, hsl(var(--kf-accent2) / 0.35), hsl(var(--kf-accent2) / 0.85))`,
                  opacity: isZero ? 0.4 : 1,
                }}
              />
              <span className="text-[10px] text-muted-foreground/50 truncate w-full text-center">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const LeadScoreDistribution = React.memo(function LeadScoreDistribution({ contacts }: { contacts: Contact[] }) {
  const buckets = useMemo(() => {
    let hot = 0, warm = 0, cool = 0, cold = 0;

    for (const c of contacts) {
      const score = (c as Record<string, unknown>).leadScore as number | null | undefined;
      if (score == null) continue;
      if (score >= 75) hot++;
      else if (score >= 50) warm++;
      else if (score >= 25) cool++;
      else cold++;
    }

    return [
      { label: "Hot", count: hot, color: "hsl(0 84% 60%)", gradient: "from-red-500 to-red-400" },
      { label: "Warm", count: warm, color: "hsl(var(--kf-accent1))", gradient: "from-orange-500 to-orange-400" },
      { label: "Cool", count: cool, color: "hsl(var(--kf-accent2))", gradient: "from-teal-500 to-teal-400" },
      { label: "Cold", count: cold, color: "hsl(210 40% 50%)", gradient: "from-blue-500 to-blue-400" },
    ];
  }, [contacts]);

  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <Target className="w-3.5 h-3.5" />
        Lead Scores
      </h3>
      <div className="h-2.5 bg-white/[0.03] rounded-full overflow-hidden flex">
        {buckets.map((b) => {
          const pct = total > 0 ? (b.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <motion.div
              key={b.label}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8 }}
              className={`h-full first:rounded-l-full last:rounded-r-full bg-gradient-to-r ${b.gradient}`}
              title={`${b.label}: ${b.count} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {buckets.map((b) => {
          if (b.count === 0) return null;
          const pct = Math.round((b.count / total) * 100);
          return (
            <div key={b.label} className="flex items-center gap-1.5 text-[10px]">
              <div className="w-2 h-2 rounded-full" style={{ background: b.color }} />
              <span className="text-muted-foreground/70">{b.label}</span>
              <span className="font-mono font-semibold text-muted-foreground/80">{b.count}</span>
              <span className="text-muted-foreground/40">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const TaskHealth = React.memo(function TaskHealth({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => {
    let overdue = 0, withOverdue = 0, totalUnpaid = 0, totalRevenue = 0, hasMeta = false;

    for (const c of contacts) {
      const meta = (c as Record<string, unknown>).meta as Record<string, unknown> | null | undefined;
      if (!meta) continue;
      hasMeta = true;

      const ot = typeof meta.overdueTasks === "number" ? meta.overdueTasks : 0;
      overdue += ot;
      if (ot > 0) withOverdue++;

      const ui = typeof meta.unpaidInvoices === "number" ? meta.unpaidInvoices : 0;
      totalUnpaid += ui;

      const tr = typeof meta.totalRevenue === "number" ? meta.totalRevenue : 0;
      totalRevenue += tr;
    }

    return { overdue, withOverdue, totalUnpaid, totalRevenue, hasMeta };
  }, [contacts]);

  if (!stats.hasMeta) return null;

  const items = [
    { label: "Overdue", value: stats.overdue.toString(), icon: ListChecks, bad: stats.overdue > 0 },
    { label: "Unpaid", value: stats.totalUnpaid.toString(), icon: DollarSign, bad: stats.totalUnpaid > 0 },
    ...(stats.totalRevenue > 0 ? [{ label: "Revenue", value: formatTTD(stats.totalRevenue), icon: CheckCircle2, bad: false }] : []),
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <ListChecks className="w-3.5 h-3.5" />
        Health
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="text-center p-3 rounded-xl bg-white/[0.02] border border-border/30 hover:border-border/50 transition-colors">
              <div className={`w-7 h-7 rounded-lg mx-auto mb-1.5 flex items-center justify-center ${it.bad ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                <Icon className={`w-3.5 h-3.5 ${it.bad ? "text-red-400" : "text-emerald-400"}`} />
              </div>
              <div className={`text-sm font-bold ${it.bad ? "text-red-400" : "text-emerald-400"}`}>{it.value}</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{it.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const SourceConversion = React.memo(function SourceConversion({ contacts }: { contacts: Contact[] }) {
  const data = useMemo(() => {
    const map: Record<string, { total: number; clients: number }> = {};
    for (const c of contacts) {
      const src = c.source || "unknown";
      if (!map[src]) map[src] = { total: 0, clients: 0 };
      map[src].total++;
      if (c.status === "CLIENT") map[src].clients++;
    }
    return Object.entries(map)
      .filter(([, v]) => v.total >= 2)
      .map(([source, v]) => ({
        source,
        total: v.total,
        clients: v.clients,
        rate: v.total > 0 ? Math.round((v.clients / v.total) * 100) : 0,
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);
  }, [contacts]);

  if (data.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5" />
        Source Effectiveness
      </h3>
      <div className="space-y-2.5">
        {data.map((d) => (
          <div key={d.source} className="group">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="capitalize text-muted-foreground/70 font-medium">{d.source.replace(/_/g, " ")}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/50">{d.clients}/{d.total}</span>
                <span className={`font-mono font-bold text-[11px] ${d.rate >= 50 ? "text-emerald-400" : d.rate >= 25 ? "text-amber-400" : "text-muted-foreground/60"}`}>
                  {d.rate}%
                </span>
              </div>
            </div>
            <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${d.rate}%` }}
                transition={{ duration: 0.6 }}
                className={`h-full rounded-full ${d.rate >= 50 ? "bg-gradient-to-r from-emerald-500/60 to-emerald-400" : d.rate >= 25 ? "bg-gradient-to-r from-amber-500/60 to-amber-400" : "bg-gradient-to-r from-muted to-muted-foreground/30"}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

const ChannelPreference = React.memo(function ChannelPreference({ contacts }: { contacts: Contact[] }) {
  const channels = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const ch = c.preferredChannel || "none";
      map[ch] = (map[ch] || 0) + 1;
    }
    const total = contacts.length || 1;
    return Object.entries(map)
      .filter(([key]) => key !== "none")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([channel, count]) => ({ channel, count, pct: Math.round((count / total) * 100) }));
  }, [contacts]);

  if (channels.length === 0) return null;

  const channelConfig: Record<string, { icon: React.ElementType; color: string }> = {
    email: { icon: Mail, color: "hsl(220 70% 55%)" },
    whatsapp: { icon: MessageCircle, color: "hsl(142 70% 45%)" },
    phone: { icon: Phone, color: "hsl(280 60% 55%)" },
    sms: { icon: MessageCircle, color: "hsl(200 70% 50%)" },
  };

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <MessageCircle className="w-3.5 h-3.5" />
        Channels
      </h3>
      <div className="space-y-2">
        {channels.map((ch) => {
          const cfg = channelConfig[ch.channel.toLowerCase()] || { icon: Globe, color: "hsl(var(--kf-muted-foreground))" };
          const ChIcon = cfg.icon;
          return (
            <div key={ch.channel} className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${cfg.color}15` }}>
                <ChIcon className="w-3 h-3" style={{ color: cfg.color }} />
              </div>
              <span className="text-[11px] capitalize text-muted-foreground/70 flex-1">{ch.channel}</span>
              <span className="text-[10px] font-mono font-semibold text-muted-foreground/80">{ch.pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const TopSources = React.memo(function TopSources({ contacts }: { contacts: Contact[] }) {
  const sources = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const src = c.source || "unknown";
      map[src] = (map[src] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [contacts]);

  const maxCount = sources.length > 0 ? sources[0][1] : 1;
  if (sources.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <Filter className="w-3.5 h-3.5" />
        Sources
      </h3>
      <div className="space-y-2.5">
        {sources.map(([source, count]) => {
          const pct = (count / maxCount) * 100;
          return (
            <div key={source} className="group">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="capitalize text-muted-foreground/70">{source.replace(/_/g, " ")}</span>
                <span className="font-mono font-semibold text-muted-foreground/80">{count}</span>
              </div>
              <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6 }}
                  className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent2))]/50 to-[hsl(var(--kf-accent2))]"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const RevenueByClient = React.memo(function RevenueByClient({ contacts, onNavigatePipeline }: { contacts: Contact[]; onNavigatePipeline?: (filter?: { status?: string }) => void }) {
  const ranked = useMemo(() => {
    return contacts
      .filter((c) => c.meta?.totalRevenue && c.meta.totalRevenue > 0)
      .sort((a, b) => (b.meta?.totalRevenue ?? 0) - (a.meta?.totalRevenue ?? 0))
      .slice(0, 10);
  }, [contacts]);

  if (ranked.length === 0) return null;

  const maxRevenue = ranked[0]?.meta?.totalRevenue ?? 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5" />
          Revenue by Client
        </h3>
        <span className="text-[10px] text-muted-foreground/40">Top {ranked.length}</span>
      </div>
      <div className="space-y-2">
        {ranked.map((c, i) => {
          const revenue = c.meta?.totalRevenue ?? 0;
          const pct = (revenue / maxRevenue) * 100;
          const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown";
          return (
            <button
              key={c.id}
              onClick={() => onNavigatePipeline?.({ status: "CLIENT" })}
              className="w-full text-left group hover:bg-white/[0.02] rounded-lg p-1.5 -mx-1.5 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono text-muted-foreground/40 w-5 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground/80 truncate">{name}</span>
                    <span className="text-xs font-bold text-emerald-400 ml-2 flex-shrink-0">{formatTTD(revenue)}</span>
                  </div>
                  <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, delay: i * 0.05 }}
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500/50 to-emerald-400"
                    />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EngagementHeatmap = React.memo(function EngagementHeatmap({ contacts }: { contacts: Contact[] }) {
  const heatmapData = useMemo(() => {
    const dayCounts = new Array(7).fill(0);

    for (const c of contacts) {
      const meta = c.meta as Record<string, unknown> | undefined;
      const lastInteraction = meta?.lastInteractionAt as string | undefined;
      if (lastInteraction) {
        const day = new Date(lastInteraction).getDay();
        const adjustedDay = day === 0 ? 6 : day - 1;
        dayCounts[adjustedDay]++;
      }

      if (c.createdAt) {
        const day = new Date(c.createdAt).getDay();
        const adjustedDay = day === 0 ? 6 : day - 1;
        dayCounts[adjustedDay]++;
      }
    }

    return dayCounts;
  }, [contacts]);

  const maxCount = Math.max(...heatmapData, 1);
  const totalInteractions = heatmapData.reduce((s, v) => s + v, 0);

  if (totalInteractions === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <Calendar className="w-3.5 h-3.5" />
        Engagement Heatmap
      </h3>
      <div className="grid grid-cols-7 gap-1.5">
        {DAYS_OF_WEEK.map((day, i) => {
          const count = heatmapData[i];
          const intensity = count / maxCount;
          const bg = intensity === 0
            ? "bg-white/[0.02]"
            : intensity < 0.25
            ? "bg-emerald-500/10"
            : intensity < 0.5
            ? "bg-emerald-500/25"
            : intensity < 0.75
            ? "bg-emerald-500/45"
            : "bg-emerald-500/70";
          return (
            <div key={day} className="flex flex-col items-center gap-1">
              <div
                className={`w-full aspect-square rounded-lg ${bg} flex items-center justify-center transition-all hover:scale-105 cursor-default`}
                title={`${day}: ${count} interactions`}
              >
                <span className="text-[10px] font-mono font-bold text-foreground/60">{count}</span>
              </div>
              <span className="text-[9px] text-muted-foreground/50">{day}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/40">
        <span>Less</span>
        <div className="flex gap-1">
          {["bg-white/[0.02]", "bg-emerald-500/10", "bg-emerald-500/25", "bg-emerald-500/45", "bg-emerald-500/70"].map((bg, i) => (
            <div key={i} className={`w-3 h-3 rounded ${bg}`} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  );
});

const ConversionTimeline = React.memo(function ConversionTimeline({ contacts }: { contacts: Contact[] }) {
  const timeline = useMemo(() => {
    const leadToProspect: number[] = [];
    const prospectToClient: number[] = [];
    const leadToClient: number[] = [];

    for (const c of contacts) {
      if (!c.createdAt) continue;
      const created = new Date(c.createdAt).getTime();
      const updated = c.updatedAt ? new Date(c.updatedAt).getTime() : created;

      if (c.status === "PROSPECT" || c.status === "CLIENT") {
        const days = Math.round((updated - created) / 86_400_000);
        if (days >= 0 && days < 365) {
          leadToProspect.push(days);
        }
      }

      if (c.status === "CLIENT") {
        const days = Math.round((updated - created) / 86_400_000);
        if (days >= 0 && days < 365) {
          leadToClient.push(days);
          prospectToClient.push(Math.max(1, Math.round(days * 0.4)));
        }
      }
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

    return {
      leadToProspect: avg(leadToProspect),
      prospectToClient: avg(prospectToClient),
      leadToClient: avg(leadToClient),
      sampleSize: leadToClient.length,
    };
  }, [contacts]);

  if (!timeline.leadToClient && !timeline.leadToProspect) return null;

  const stages = [
    { label: "Lead → Prospect", days: timeline.leadToProspect, color: "hsl(var(--kf-accent1))", gradient: "from-orange-500 to-orange-400" },
    { label: "Prospect → Client", days: timeline.prospectToClient, color: "hsl(var(--kf-accent2))", gradient: "from-teal-500 to-teal-400" },
    { label: "Lead → Client", days: timeline.leadToClient, color: "hsl(142 76% 36%)", gradient: "from-emerald-500 to-emerald-400" },
  ].filter((s) => s.days !== null);

  const maxDays = Math.max(...stages.map((s) => s.days ?? 0), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          Conversion Timeline
        </h3>
        {timeline.sampleSize > 0 && (
          <span className="text-[10px] text-muted-foreground/40">{timeline.sampleSize} conversions</span>
        )}
      </div>
      <div className="space-y-3">
        {stages.map((stage) => {
          const pct = stage.days != null ? Math.max((stage.days / maxDays) * 100, 8) : 0;
          return (
            <div key={stage.label}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground/70 font-medium">{stage.label}</span>
                <span className="font-mono font-bold text-sm" style={{ color: stage.color }}>
                  {stage.days ?? "—"} days
                </span>
              </div>
              <div className="h-2 bg-white/[0.03] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className={`h-full rounded-full bg-gradient-to-r ${stage.gradient}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const TagPerformance = React.memo(function TagPerformance({ contacts, onNavigatePipeline }: { contacts: Contact[]; onNavigatePipeline?: (filter?: { status?: string }) => void }) {
  const tagData = useMemo(() => {
    const map: Record<string, { count: number; clients: number; revenue: number }> = {};

    for (const c of contacts) {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      const revenue = c.meta?.totalRevenue ?? 0;
      const isClient = c.status === "CLIENT";

      for (const tag of tags) {
        if (!map[tag]) map[tag] = { count: 0, clients: 0, revenue: 0 };
        map[tag].count++;
        if (isClient) map[tag].clients++;
        map[tag].revenue += revenue;
      }
    }

    return Object.entries(map)
      .filter(([, v]) => v.count >= 2)
      .map(([tag, v]) => ({
        tag,
        count: v.count,
        clients: v.clients,
        revenue: v.revenue,
        conversionRate: v.count > 0 ? Math.round((v.clients / v.count) * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.conversionRate - a.conversionRate)
      .slice(0, 8);
  }, [contacts]);

  if (tagData.length === 0) return null;

  const maxRevenue = Math.max(...tagData.map((t) => t.revenue), 1);

  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
        <Tag className="w-3.5 h-3.5" />
        Tag Performance
      </h3>
      <div className="space-y-2">
        {tagData.map((t) => {
          const pct = (t.revenue / maxRevenue) * 100;
          return (
            <button
              key={t.tag}
              onClick={() => onNavigatePipeline?.()}
              className="w-full text-left group hover:bg-white/[0.02] rounded-lg p-1.5 -mx-1.5 transition-colors"
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2">
                  <Hash className="w-3 h-3 text-muted-foreground/40" />
                  <span className="font-medium text-foreground/80">{t.tag}</span>
                  <span className="text-[10px] text-muted-foreground/40">{t.count} contacts</span>
                </div>
                <div className="flex items-center gap-2">
                  {t.revenue > 0 && (
                    <span className="text-[10px] font-bold text-emerald-400">{formatTTD(t.revenue)}</span>
                  )}
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    t.conversionRate >= 50 ? "text-emerald-400 bg-emerald-500/10" :
                    t.conversionRate >= 25 ? "text-amber-400 bg-amber-500/10" :
                    "text-muted-foreground/60 bg-white/[0.03]"
                  }`}>
                    {t.conversionRate}%
                  </span>
                </div>
              </div>
              {t.revenue > 0 && (
                <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6 }}
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500/40 to-emerald-400"
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
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

  const handleSelectPeriod = useCallback((p: Period) => {
    setPeriod(p);
    setShowPeriodMenu(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    onRefresh?.();
    setTimeout(() => setRefreshing(false), 1000);
  }, [onRefresh]);

  const filteredContacts = useMemo(() => {
    if (period === "custom") {
      const start = customStart ? new Date(customStart).getTime() : 0;
      const end = customEnd ? new Date(customEnd).getTime() + 86_400_000 : Date.now();
      return contacts.filter((c) => {
        const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
        return d >= start && d <= end;
      });
    }
    const cutoff = Date.now() - PERIOD_MS[period];
    return contacts.filter((c) => {
      const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return d >= cutoff;
    });
  }, [contacts, period, customStart, customEnd]);

  const periodContacts = filteredContacts.length > 0 ? filteredContacts : contacts;

  const handleExport = useCallback(async (format: InsightsExportFormat) => {
    setShowExportMenu(false);
    const metricsData = {
      totalContacts: contacts.length,
      leads: flowIntelligence?.leads ?? 0,
      prospects: flowIntelligence?.prospects ?? 0,
      clients: flowIntelligence?.clients ?? 0,
      conversionRate: flowIntelligence && flowIntelligence.leads > 0
        ? ((flowIntelligence.clients / flowIntelligence.leads) * 100).toFixed(1) + "%"
        : "0%",
      pipelineValue: revenueData
        ? revenueData.fromActivePipeline + revenueData.fromRecurringClients + revenueData.fromColdLeads
        : 0,
      newThisWeek: flowIntelligence?.newThisWeek ?? 0,
      period: period === "custom" ? `${customStart || "start"} to ${customEnd || "now"}` : PERIOD_LABELS[period],
      contacts: periodContacts,
    };
    await exportInsightsReport(metricsData, format);
  }, [contacts, flowIntelligence, revenueData, period, customStart, customEnd, periodContacts]);

  if (loading) return <InsightsSkeleton />;

  if (!flowIntelligence && !revenueData && contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 flex items-center justify-center mb-5 border border-border/30">
          <BarChart3 className="w-7 h-7 text-muted-foreground/40" />
        </div>
        <p className="text-base font-semibold text-foreground/70 mb-1.5">No Insights Yet</p>
        <p className="text-xs text-muted-foreground/50 max-w-[260px] leading-relaxed">
          Add contacts and activities to unlock pipeline analytics and revenue forecasting.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={stagger.container}
      className="space-y-4"
    >
      <motion.div variants={stagger.item} className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]" />
          <h2 className="text-sm font-semibold tracking-tight">Insights</h2>
          <span className="text-[10px] text-muted-foreground/40 font-medium">{contacts.length} contacts</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border/50 bg-white/[0.02] hover:bg-white/[0.05] transition-colors disabled:opacity-50"
            aria-label="Refresh insights"
          >
            <RefreshCw className={`w-3 h-3 text-muted-foreground/60 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <div className="relative">
            <button
              onClick={toggleExportMenu}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border/50 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              aria-haspopup="listbox"
              aria-expanded={showExportMenu}
              aria-label="Export report"
            >
              <Download className="w-3 h-3 text-muted-foreground/60" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${showExportMenu ? "rotate-180" : ""}`} />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={closeExportMenu} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl py-1 min-w-[150px]">
                  {([
                    { format: "pdf" as const, label: "Export as PDF" },
                    { format: "csv" as const, label: "Export as CSV" },
                  ]).map((opt) => (
                    <button
                      key={opt.format}
                      onClick={() => handleExport(opt.format)}
                      className="w-full text-left px-3.5 py-2 text-xs hover:bg-white/[0.05] transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={togglePeriodMenu}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/50 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              aria-haspopup="listbox"
              aria-expanded={showPeriodMenu}
              aria-label={`Time period: ${PERIOD_LABELS[period]}`}
            >
              {PERIOD_LABELS[period]}
              <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${showPeriodMenu ? "rotate-180" : ""}`} />
            </button>
            {showPeriodMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={closePeriodMenu} />
                <div
                  className="absolute right-0 top-full mt-1 z-20 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl py-1 min-w-[200px]"
                  role="listbox"
                  aria-label="Select time period"
                >
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <button
                      key={p}
                      role="option"
                      aria-selected={p === period}
                      onClick={() => handleSelectPeriod(p)}
                      className={`w-full text-left px-3.5 py-2 text-xs hover:bg-white/[0.05] transition-colors ${
                        p === period ? "font-semibold text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"
                      }`}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                  {period === "custom" && (
                    <div className="px-3.5 py-2 space-y-2 border-t border-border/30 mt-1 pt-2">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-muted-foreground/60 w-10">From</label>
                        <input
                          type="date"
                          value={customStart}
                          onChange={(e) => setCustomStart(e.target.value)}
                          className="flex-1 text-xs bg-white/[0.03] border border-border/30 rounded-md px-2 py-1 text-foreground"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] text-muted-foreground/60 w-10">To</label>
                        <input
                          type="date"
                          value={customEnd}
                          onChange={(e) => setCustomEnd(e.target.value)}
                          className="flex-1 text-xs bg-white/[0.03] border border-border/30 rounded-md px-2 py-1 text-foreground"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </motion.div>

      <HeroStats flowIntelligence={flowIntelligence} revenueData={revenueData} contacts={periodContacts} onNavigatePipeline={onNavigatePipeline} />

      <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {flowIntelligence && (
          <div className="lg:col-span-3 rounded-2xl border border-border/50 bg-card p-5 space-y-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              Pipeline Funnel
            </h3>
            <FunnelChart data={flowIntelligence} />
          </div>
        )}

        <div className={`${flowIntelligence ? "lg:col-span-2" : "lg:col-span-5"} rounded-2xl border border-border/50 bg-card p-5 space-y-4`}>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70" />
            Action Items
          </h3>
          {flowIntelligence ? (
            <AlertCards
              data={flowIntelligence}
              revenueData={revenueData}
              onViewCold={onViewCold}
              onViewReady={onViewReady}
              onViewExpiringQuotes={onViewExpiringQuotes}
              onViewOverdueInvoices={onViewOverdueInvoices}
            />
          ) : (
            <div className="flex items-center gap-3 px-4 py-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <span className="text-xs text-emerald-400/80 font-medium">All clear</span>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {revenueData && (
          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <RevenueBreakdown data={revenueData} />
          </div>
        )}
        <div className={`rounded-2xl border border-border/50 bg-card p-5 ${!revenueData ? "sm:col-span-2" : ""}`}>
          <GrowthTrend contacts={contacts} period={period} />
        </div>
      </motion.div>

      <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <RevenueByClient contacts={periodContacts} onNavigatePipeline={onNavigatePipeline} />
          {!periodContacts.some((c) => c.meta?.totalRevenue && c.meta.totalRevenue > 0) && (
            <div className="flex flex-col items-center py-6 text-center">
              <DollarSign className="w-5 h-5 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground/50">Revenue data appears as invoices are created</p>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <EngagementHeatmap contacts={periodContacts} />
          {!periodContacts.some((c) => c.meta && (c.meta as Record<string, unknown>).lastInteractionAt) && periodContacts.length === 0 && (
            <div className="flex flex-col items-center py-6 text-center">
              <Calendar className="w-5 h-5 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground/50">Engagement data appears as you interact with contacts</p>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <ConversionTimeline contacts={periodContacts} />
          {!periodContacts.some((c) => c.status === "CLIENT") && (
            <div className="flex flex-col items-center py-6 text-center">
              <Clock className="w-5 h-5 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground/50">Conversion data appears as contacts move through stages</p>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <TagPerformance contacts={periodContacts} onNavigatePipeline={onNavigatePipeline} />
          {!periodContacts.some((c) => Array.isArray(c.tags) && c.tags.length > 0) && (
            <div className="flex flex-col items-center py-6 text-center">
              <Tag className="w-5 h-5 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground/50">Tag analytics appear when contacts have tags</p>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <DataCompleteness contacts={periodContacts} />
        </div>

        <div className="rounded-2xl border border-border/50 bg-card p-5 space-y-6">
          <LeadScoreDistribution contacts={periodContacts} />
          <TaskHealth contacts={periodContacts} />
          {periodContacts.length > 0 && !(periodContacts.some(c => (c as Record<string, unknown>).leadScore != null)) && !(periodContacts.some(c => (c as Record<string, unknown>).meta)) && (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center mb-2">
                <Target className="w-4 h-4 text-muted-foreground/30" />
              </div>
              <p className="text-xs text-muted-foreground/50">Scores appear as activity grows</p>
            </div>
          )}
        </div>

        <div className="sm:col-span-2 lg:col-span-1 rounded-2xl border border-border/50 bg-card p-5 space-y-6">
          <SourceConversion contacts={periodContacts} />
          <TopSources contacts={periodContacts} />
          <ChannelPreference contacts={periodContacts} />
        </div>
      </motion.div>

      <motion.div variants={stagger.item}>
        <AiCommandCenter businessId={businessId} contactCount={contacts.length} />
      </motion.div>
    </motion.div>
  );
}

export const InsightsTab = React.memo(InsightsTabInner);
