"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  BarChart3, TrendingUp, Users, ArrowRight, DollarSign,
  Clock, Zap, AlertTriangle, Filter, ChevronDown,
  CheckCircle2, ListChecks, Target, ShieldCheck,
  ArrowUpRight, ArrowDownRight, Activity,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { Contact } from "@/lib/client";

type Period = "7d" | "30d" | "90d";

interface InsightsTabProps {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  contacts: Contact[];
  loading?: boolean;
  onViewCold: () => void;
  onViewReady: () => void;
  onViewExpiringQuotes: () => void;
  onViewOverdueInvoices: () => void;
}

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

const PERIOD_MS: Record<Period, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function InsightsSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading insights">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kf-stat-card p-4">
            <Skeleton className="h-3 w-16 mb-3" />
            <Skeleton className="h-8 w-20 mb-1" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-3 kf-card p-5 space-y-4">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 kf-card p-5 space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="kf-card p-5"><Skeleton className="h-32 w-full" /></div>
        <div className="kf-card p-5"><Skeleton className="h-32 w-full" /></div>
      </div>
    </div>
  );
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
    <div className="space-y-2.5" role="img" aria-label={`Pipeline funnel: ${data.leads} leads, ${data.prospects} prospects, ${data.clients} clients`}>
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.count / maxCount) * 100, 12);
        return (
          <div key={stage.key}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-foreground/80">{stage.label}</span>
              <span className="font-mono font-semibold" style={{ color: stage.color }}>{stage.count}</span>
            </div>
            <div className="h-7 bg-white/[0.03] rounded-lg overflow-hidden relative group">
              <div
                className={`h-full rounded-lg bg-gradient-to-r ${stage.gradient} transition-all duration-700 ease-out`}
                style={{ width: `${widthPct}%` }}
              />
              <div className="absolute inset-0 bg-white/0 group-hover:bg-white/[0.03] transition-colors rounded-lg" />
            </div>
            {i < stages.length - 1 && (
              <div className="flex items-center gap-1 mt-1 ml-2">
                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/60" />
                <span className="text-[10px] text-muted-foreground/70 font-medium">
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
  flowIntelligence,
  revenueData,
  contacts,
}: {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  contacts: Contact[];
}) {
  const totalRevenue = revenueData
    ? revenueData.fromActivePipeline + revenueData.fromRecurringClients + revenueData.fromColdLeads
    : 0;
  const overallConversion = flowIntelligence && flowIntelligence.leads > 0
    ? ((flowIntelligence.clients / flowIntelligence.leads) * 100).toFixed(1)
    : "0";
  const newThisWeek = flowIntelligence?.newThisWeek ?? 0;
  const convThisWeek = flowIntelligence?.conversionsThisWeek ?? 0;

  const stats = [
    {
      label: "Total Contacts",
      value: contacts.length.toString(),
      sub: `${flowIntelligence?.leads ?? 0} leads, ${flowIntelligence?.clients ?? 0} clients`,
      icon: Users,
      accentVar: "--kf-accent2",
      trend: newThisWeek > 0 ? "up" as const : null,
      trendLabel: newThisWeek > 0 ? `+${newThisWeek} this week` : undefined,
    },
    {
      label: "Conversion Rate",
      value: `${overallConversion}%`,
      sub: `${flowIntelligence?.leads ?? 0} → ${flowIntelligence?.clients ?? 0}`,
      icon: TrendingUp,
      accentVar: "--kf-accent1",
      trend: convThisWeek > 0 ? "up" as const : null,
      trendLabel: convThisWeek > 0 ? `${convThisWeek} this week` : undefined,
    },
    {
      label: "Pipeline Value",
      value: formatTTD(totalRevenue),
      sub: revenueData ? `${formatTTD(revenueData.fromActivePipeline)} active` : "No data",
      icon: DollarSign,
      accentVar: "--kf-accent1",
      trend: null,
      trendLabel: undefined,
    },
    {
      label: "New This Week",
      value: newThisWeek.toString(),
      sub: `${convThisWeek} conversion${convThisWeek !== 1 ? "s" : ""}, ${flowIntelligence?.lost ?? 0} lost`,
      icon: Activity,
      accentVar: "--kf-accent2",
      trend: flowIntelligence && flowIntelligence.lost > 0 ? "down" as const : null,
      trendLabel: flowIntelligence && flowIntelligence.lost > 0 ? `${flowIntelligence.lost} lost` : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="Key metrics">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/80 p-4 group hover:border-border transition-all duration-300"
          >
            <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.04] -translate-y-1/2 translate-x-1/2"
              style={{ background: `hsl(var(${s.accentVar}))` }}
            />
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="w-3.5 h-3.5 text-muted-foreground/70" />
              <span className="text-[11px] text-muted-foreground/80 font-medium uppercase tracking-wider">{s.label}</span>
            </div>
            <div className="text-2xl font-bold tracking-tight" style={{ color: `hsl(var(${s.accentVar}))` }}>
              {s.value}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] text-muted-foreground/60">{s.sub}</span>
            </div>
            {s.trend && s.trendLabel && (
              <div className={`flex items-center gap-0.5 mt-1.5 text-[10px] font-medium ${s.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                {s.trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {s.trendLabel}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

const AlertCards = React.memo(function AlertCards({
  data,
  revenueData,
  onViewCold,
  onViewReady,
  onViewExpiringQuotes,
  onViewOverdueInvoices,
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
      <div className="flex items-center gap-2 px-3 py-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
        <span className="text-xs text-emerald-400/80 font-medium">All clear — no action items right now</span>
      </div>
    );
  }

  const variantStyles = {
    success: "border-emerald-500/25 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.1] text-emerald-400",
    danger: "border-red-500/25 bg-red-500/[0.06] hover:bg-red-500/[0.1] text-red-400",
    warning: "border-amber-500/25 bg-amber-500/[0.06] hover:bg-amber-500/[0.1] text-amber-400",
  };

  return (
    <div className="space-y-2" role="group" aria-label="Action alerts">
      {alerts.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            onClick={a.onClick}
            className={`flex items-center gap-3 w-full p-3 rounded-xl border transition-all duration-200 text-left group ${variantStyles[a.variant]}`}
            aria-label={`${a.label} — ${a.sub}`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{a.label}</div>
              <div className="text-[10px] text-muted-foreground/60">{a.sub}</div>
            </div>
            <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-60 -translate-x-1 group-hover:translate-x-0 transition-all" />
          </button>
        );
      })}
    </div>
  );
});

const RevenueBreakdown = React.memo(function RevenueBreakdown({ data }: { data: RevenueData }) {
  const total = data.fromActivePipeline + data.fromRecurringClients + data.fromColdLeads;
  const sources = [
    { label: "Active Pipeline", value: data.fromActivePipeline, gradient: "from-orange-500 to-orange-400" },
    { label: "Recurring", value: data.fromRecurringClients, gradient: "from-emerald-500 to-emerald-400" },
    { label: "Cold (if won)", value: data.fromColdLeads, gradient: "from-slate-500 to-slate-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          Revenue Forecast
        </h3>
        <span className="text-sm font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
          {formatTTD(total)}
        </span>
      </div>

      <div className="h-2.5 bg-white/[0.03] rounded-full overflow-hidden flex" role="img" aria-label={`Revenue: ${formatTTD(total)}`}>
        {sources.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={s.label}
              className={`h-full first:rounded-l-full last:rounded-r-full bg-gradient-to-r ${s.gradient} transition-all duration-700`}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${formatTTD(s.value)}`}
            />
          );
        })}
      </div>

      <div className="space-y-1.5">
        {sources.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full bg-gradient-to-r ${s.gradient}`} />
                <span className="text-muted-foreground/70">{s.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{formatTTD(s.value)}</span>
                <span className="text-muted-foreground/40 w-8 text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {(data.expiringQuotes.count > 0 || data.overdueInvoices.count > 0) && (
        <div className="flex gap-2 pt-2 border-t border-border/30">
          {data.expiringQuotes.count > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400/70 px-2 py-1 rounded-md bg-amber-500/[0.06]">
              <Clock className="w-3 h-3" />
              {data.expiringQuotes.count} expiring
            </div>
          )}
          {data.overdueInvoices.count > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400/70 px-2 py-1 rounded-md bg-red-500/[0.06]">
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
    return { completenessAvg: 0, withEmail: 0, withPhone: 0, withCompany: 0, withTags: 0, total: 0 };
  }

  let totalScore = 0;
  let withEmail = 0, withPhone = 0, withCompany = 0, withTags = 0;

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
  }

  return { completenessAvg: Math.round(totalScore / contacts.length), withEmail, withPhone, withCompany, withTags, total: contacts.length };
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
      <div className="text-center py-6 text-muted-foreground/50 text-xs">Add contacts to track data quality</div>
    );
  }

  const color = getCompletenessColor(stats.completenessAvg);
  const fields = [
    { label: "Email", count: stats.withEmail },
    { label: "Phone", count: stats.withPhone },
    { label: "Company", count: stats.withCompany },
    { label: "Tags", count: stats.withTags },
  ];

  const circumference = 2 * Math.PI * 42;
  const dashLength = (stats.completenessAvg / 100) * circumference;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" className="stroke-white/[0.04]" />
            <circle
              cx="50" cy="50" r="42" fill="none" strokeWidth="6"
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeLinecap="round"
              style={{ stroke: color }}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold" style={{ color }}>{stats.completenessAvg}%</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {fields.map((f) => {
            const pct = Math.round((f.count / stats.total) * 100);
            return (
              <div key={f.label} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/60 w-12">{f.label}</span>
                <div className="flex-1 h-1 bg-white/[0.03] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: getCompletenessColor(pct) }}
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
    const ms = PERIOD_MS[period];
    const bucketCount = period === "7d" ? 7 : 6;
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
      if (period === "7d") {
        label = new Date(start).toLocaleDateString("en-TT", { weekday: "short" });
      } else if (period === "30d") {
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
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5" />
          Contact Growth
        </h3>
        {totalNew > 0 && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))]">
            +{totalNew}
          </span>
        )}
      </div>
      <div className="flex items-end gap-[3px] h-20" role="img" aria-label={`Growth: ${totalNew} new contacts`}>
        {buckets.map((b, i) => {
          const heightPct = Math.max((b.count / maxCount) * 100, 3);
          const isZero = b.count === 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group">
              {!isZero && (
                <span className="text-[8px] font-mono font-medium text-muted-foreground/50" aria-label={`${b.count} contacts`}>{b.count}</span>
              )}
              <div
                className="w-full rounded-sm transition-all duration-500 group-hover:opacity-100"
                style={{
                  height: `${heightPct}%`,
                  background: isZero
                    ? "hsl(var(--muted) / 0.3)"
                    : `linear-gradient(to top, hsl(var(--kf-accent2) / 0.4), hsl(var(--kf-accent2) / 0.8))`,
                  opacity: isZero ? 0.3 : 0.7,
                }}
              />
              <span className="text-[8px] text-muted-foreground/40 truncate w-full text-center">{b.label}</span>
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
        <Target className="w-3.5 h-3.5" />
        Lead Scores
      </h3>
      <div className="h-2 bg-white/[0.03] rounded-full overflow-hidden flex">
        {buckets.map((b) => {
          const pct = total > 0 ? (b.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={b.label}
              className={`h-full first:rounded-l-full last:rounded-r-full bg-gradient-to-r ${b.gradient} transition-all duration-500`}
              style={{ width: `${pct}%` }}
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
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
              <span className="text-muted-foreground/60">{b.label}</span>
              <span className="font-mono font-medium text-muted-foreground/80">{b.count}</span>
              <span className="text-muted-foreground/30">({pct}%)</span>
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
        <ListChecks className="w-3.5 h-3.5" />
        Health
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="text-center p-2.5 rounded-xl bg-white/[0.02] border border-border/30">
              <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${it.bad ? "text-red-400/70" : "text-emerald-400/70"}`} />
              <div className={`text-sm font-bold ${it.bad ? "text-red-400" : "text-emerald-400"}`}>{it.value}</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{it.label}</div>
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
        <Filter className="w-3.5 h-3.5" />
        Sources
      </h3>
      <div className="space-y-2">
        {sources.map(([source, count]) => {
          const pct = (count / maxCount) * 100;
          return (
            <div key={source} className="group">
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="capitalize text-muted-foreground/70">{source.replace(/_/g, " ")}</span>
                <span className="font-mono font-medium text-muted-foreground/80">{count}</span>
              </div>
              <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent2))]/60 to-[hsl(var(--kf-accent2))]/90 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const TopSegments = React.memo(function TopSegments({ contacts }: { contacts: Contact[] }) {
  const segments = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const seg = c.segment || c.lifecycleStage || "unassigned";
      map[seg] = (map[seg] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [contacts]);

  const maxCount = segments.length > 0 ? segments[0][1] : 1;
  if (segments.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
        <Users className="w-3.5 h-3.5" />
        Segments
      </h3>
      <div className="space-y-2">
        {segments.map(([segment, count]) => {
          const pct = (count / maxCount) * 100;
          return (
            <div key={segment} className="group">
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="capitalize text-muted-foreground/70">{segment.replace(/_/g, " ")}</span>
                <span className="font-mono font-medium text-muted-foreground/80">{count}</span>
              </div>
              <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))]/60 to-[hsl(var(--kf-accent1))]/90 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function InsightsTabInner({
  flowIntelligence, revenueData, contacts, loading,
  onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices,
}: InsightsTabProps) {
  const [period, setPeriod] = useState<Period>("30d");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);

  const togglePeriodMenu = useCallback(() => setShowPeriodMenu((p) => !p), []);
  const closePeriodMenu = useCallback(() => setShowPeriodMenu(false), []);

  const handleSelectPeriod = useCallback((p: Period) => {
    setPeriod(p);
    setShowPeriodMenu(false);
  }, []);

  const filteredContacts = useMemo(() => {
    const cutoff = Date.now() - PERIOD_MS[period];
    return contacts.filter((c) => {
      const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return d >= cutoff;
    });
  }, [contacts, period]);

  const periodContacts = filteredContacts.length > 0 ? filteredContacts : contacts;

  if (loading) return <InsightsSkeleton />;

  if (!flowIntelligence && !revenueData && contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 flex items-center justify-center mb-4">
          <BarChart3 className="w-6 h-6 text-muted-foreground/50" />
        </div>
        <p className="text-sm font-medium text-foreground/70 mb-1">No Insights Yet</p>
        <p className="text-xs text-muted-foreground/50 max-w-[240px]">
          Add contacts and activities to unlock pipeline analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]" />
          <h2 className="text-sm font-semibold tracking-tight">Insights</h2>
        </div>
        <div className="relative">
          <button
            onClick={togglePeriodMenu}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-border/50 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
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
                className="absolute right-0 top-full mt-1 z-20 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-lg shadow-xl py-1 min-w-[120px]"
                role="listbox"
                aria-label="Select time period"
              >
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    role="option"
                    aria-selected={p === period}
                    onClick={() => handleSelectPeriod(p)}
                    className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/[0.05] transition-colors ${
                      p === period ? "font-semibold text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <HeroStats flowIntelligence={flowIntelligence} revenueData={revenueData} contacts={contacts} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {flowIntelligence && (
          <div className="lg:col-span-3 rounded-2xl border border-border/50 bg-card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              Pipeline Funnel
            </h3>
            <FunnelChart data={flowIntelligence} />
          </div>
        )}

        <div className={`${flowIntelligence ? "lg:col-span-2" : "lg:col-span-5"} rounded-2xl border border-border/50 bg-card p-5 space-y-4`}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
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
            <div className="flex items-center gap-2 px-3 py-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span className="text-xs text-emerald-400/80 font-medium">All clear</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {revenueData && (
          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <RevenueBreakdown data={revenueData} />
          </div>
        )}
        <div className={`rounded-2xl border border-border/50 bg-card p-5 ${!revenueData ? "sm:col-span-2" : ""}`}>
          <GrowthTrend contacts={contacts} period={period} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <DataCompleteness contacts={contacts} />
        </div>
        <div className="rounded-2xl border border-border/50 bg-card p-5 space-y-5">
          <LeadScoreDistribution contacts={contacts} />
          <TaskHealth contacts={contacts} />
          {contacts.length > 0 && !(contacts.some(c => (c as Record<string, unknown>).leadScore != null)) && !(contacts.some(c => (c as Record<string, unknown>).meta)) && (
            <div className="text-center py-4 text-muted-foreground/50 text-xs">Scores and health metrics appear as activity grows</div>
          )}
        </div>
        <div className="sm:col-span-2 lg:col-span-1 rounded-2xl border border-border/50 bg-card p-5 space-y-6">
          <TopSources contacts={periodContacts} />
          <TopSegments contacts={periodContacts} />
        </div>
      </div>
    </div>
  );
}

export const InsightsTab = React.memo(InsightsTabInner);
