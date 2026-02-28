"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  BarChart3, TrendingUp, Users, ArrowRight, DollarSign,
  Clock, Zap, AlertTriangle, Filter, ChevronDown,
  CheckCircle2, ListChecks, Target, ShieldCheck,
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
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
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
    <div className="space-y-6" role="status" aria-label="Loading insights">
      <div className="kf-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 p-3 rounded-xl bg-white/[0.02]">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
      <div className="kf-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-40" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="kf-card p-5 space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 p-3 rounded-xl bg-white/[0.02]">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-5 w-10" />
              </div>
            ))}
          </div>
        </div>
        <div className="kf-card p-5 space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

const FUNNEL_STAGES = [
  { key: "leads", label: "Leads", color: "hsl(var(--kf-accent1))" },
  { key: "prospects", label: "Prospects", color: "hsl(var(--kf-accent2))" },
  { key: "clients", label: "Clients", color: "hsl(142 76% 36%)" },
] as const;

const FunnelChart = React.memo(function FunnelChart({ data }: { data: FlowIntelligenceData }) {
  const maxCount = Math.max(data.leads, data.prospects, data.clients, 1);
  const stages = [
    { ...FUNNEL_STAGES[0], count: data.leads },
    { ...FUNNEL_STAGES[1], count: data.prospects },
    { ...FUNNEL_STAGES[2], count: data.clients },
  ];

  const leadToProspect = data.leads > 0 ? ((data.prospects / data.leads) * 100).toFixed(1) : "0";
  const prospectToClient = data.prospects > 0 ? ((data.clients / data.prospects) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-3" role="img" aria-label={`Pipeline funnel: ${data.leads} leads, ${data.prospects} prospects, ${data.clients} clients`}>
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.count / maxCount) * 100, 8);
        return (
          <div key={stage.key}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium">{stage.label}</span>
              <span className="text-muted-foreground">{stage.count}</span>
            </div>
            <div className="h-8 bg-muted/50 rounded-lg overflow-hidden relative">
              <div
                className="h-full rounded-lg transition-all duration-700 ease-out flex items-center justify-end pr-2"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${stage.color}cc, ${stage.color})`,
                }}
              >
                {stage.count > 0 && (
                  <span className="text-[10px] font-bold text-white drop-shadow-sm">
                    {stage.count}
                  </span>
                )}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className="flex items-center gap-1 mt-1 ml-4">
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {i === 0 ? leadToProspect : prospectToClient}% conversion
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

const ConversionMetrics = React.memo(function ConversionMetrics({ data }: { data: FlowIntelligenceData }) {
  const overallConversion = data.leads > 0
    ? ((data.clients / data.leads) * 100).toFixed(1)
    : "0";

  const metrics = [
    {
      label: "Overall Conversion",
      value: `${overallConversion}%`,
      sub: `${data.leads} leads → ${data.clients} clients`,
      color: "hsl(142 76% 36%)",
    },
    {
      label: "New This Week",
      value: data.newThisWeek.toString(),
      sub: "contacts added",
      color: "hsl(var(--kf-accent1))",
    },
    {
      label: "Conversions This Week",
      value: data.conversionsThisWeek.toString(),
      sub: "stage advances",
      color: "hsl(var(--kf-accent2))",
    },
    {
      label: "Lost",
      value: data.lost.toString(),
      sub: "contacts lost",
      color: "hsl(0 84% 60%)",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="group" aria-label="Conversion metrics">
      {metrics.map((m) => (
        <div key={m.label} className="p-3 rounded-xl bg-white/[0.02] border border-border/50">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{m.label}</div>
          <div className="text-2xl font-bold mt-1" style={{ color: m.color }}>{m.value}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{m.sub}</div>
        </div>
      ))}
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
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [contacts]);

  const maxCount = sources.length > 0 ? sources[0][1] : 1;

  if (sources.length === 0) {
    return (
      <div className="kf-card p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          Top Sources
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">No source data yet</p>
      </div>
    );
  }

  return (
    <div className="kf-card p-5 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        Top Sources
      </h3>
      {sources.map(([source, count]) => {
        const pct = (count / maxCount) * 100;
        return (
          <div key={source} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="capitalize">{source.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground font-medium">{count}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-[hsl(var(--kf-accent2))] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
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
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [contacts]);

  const maxCount = segments.length > 0 ? segments[0][1] : 1;

  if (segments.length === 0) {
    return (
      <div className="kf-card p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          Top Segments
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">No segment data yet</p>
      </div>
    );
  }

  return (
    <div className="kf-card p-5 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        Top Segments
      </h3>
      {segments.map(([segment, count]) => {
        const pct = (count / maxCount) * 100;
        return (
          <div key={segment} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="capitalize">{segment.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground font-medium">{count}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-[hsl(var(--kf-accent1))] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

const RevenueBreakdown = React.memo(function RevenueBreakdown({ data }: { data: RevenueData }) {
  const total = data.fromActivePipeline + data.fromRecurringClients + data.fromColdLeads;
  const sources = [
    { label: "Active Pipeline", value: data.fromActivePipeline, color: "hsl(var(--kf-accent1))" },
    { label: "Recurring Clients", value: data.fromRecurringClients, color: "hsl(142 76% 36%)" },
    { label: "Cold Leads (if won)", value: data.fromColdLeads, color: "hsl(var(--kf-muted-foreground))" },
  ];

  return (
    <div className="kf-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Revenue Forecast
        </h3>
        <span className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
          {formatTTD(total)}
        </span>
      </div>

      <div className="h-4 bg-muted rounded-full overflow-hidden flex" role="img" aria-label={`Revenue breakdown: ${formatTTD(total)} total`}>
        {sources.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={s.label}
              className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-700"
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label}: ${formatTTD(s.value)}`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {sources.map((s) => (
          <div key={s.label}>
            <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: s.color }} />
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="text-sm font-semibold">{formatTTD(s.value)}</div>
          </div>
        ))}
      </div>

      {(data.expiringQuotes.count > 0 || data.overdueInvoices.count > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border/50">
          {data.expiringQuotes.count > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 text-sm">
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span>
                <strong>{data.expiringQuotes.count}</strong> expiring quotes
                <span className="text-muted-foreground"> · {formatTTD(data.expiringQuotes.value)}</span>
              </span>
            </div>
          )}
          {data.overdueInvoices.count > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-sm">
              <DollarSign className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>
                <strong>{data.overdueInvoices.count}</strong> overdue invoices
                <span className="text-muted-foreground"> · {formatTTD(data.overdueInvoices.value)}</span>
              </span>
            </div>
          )}
        </div>
      )}
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
    const items: { key: string; priority: number; element: React.ReactNode }[] = [];

    if (data.contactsReadyToAdvance > 0) {
      items.push({
        key: "ready", priority: 1,
        element: (
          <button
            onClick={onViewReady}
            className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/30 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors text-left w-full"
            aria-label={`${data.contactsReadyToAdvance} contacts ready to advance`}
          >
            <Zap className="w-5 h-5 text-[hsl(var(--kf-accent2))] flex-shrink-0" />
            <div>
              <div className="text-sm font-medium">{data.contactsReadyToAdvance} ready to advance</div>
              <div className="text-xs text-muted-foreground">High engagement detected</div>
            </div>
          </button>
        ),
      });
    }

    if (revenueData?.overdueInvoices && revenueData.overdueInvoices.count > 0) {
      items.push({
        key: "invoices", priority: 2,
        element: (
          <button
            onClick={onViewOverdueInvoices}
            className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors text-left w-full"
            aria-label={`${revenueData.overdueInvoices.count} overdue invoices, ${formatTTD(revenueData.overdueInvoices.value)} outstanding`}
          >
            <DollarSign className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium">{revenueData.overdueInvoices.count} overdue invoices</div>
              <div className="text-xs text-muted-foreground">{formatTTD(revenueData.overdueInvoices.value)} outstanding</div>
            </div>
          </button>
        ),
      });
    }

    if (data.contactsGoingCold > 0) {
      items.push({
        key: "cold", priority: 3,
        element: (
          <button
            onClick={onViewCold}
            className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left w-full"
            aria-label={`${data.contactsGoingCold} contacts going cold`}
          >
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium">{data.contactsGoingCold} going cold</div>
              <div className="text-xs text-muted-foreground">Re-engage before they&apos;re lost</div>
            </div>
          </button>
        ),
      });
    }

    if (revenueData?.expiringQuotes && revenueData.expiringQuotes.count > 0) {
      items.push({
        key: "quotes", priority: 4,
        element: (
          <button
            onClick={onViewExpiringQuotes}
            className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left w-full"
            aria-label={`${revenueData.expiringQuotes.count} quotes expiring, ${formatTTD(revenueData.expiringQuotes.value)} at risk`}
          >
            <Clock className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium">{revenueData.expiringQuotes.count} quotes expiring</div>
              <div className="text-xs text-muted-foreground">{formatTTD(revenueData.expiringQuotes.value)} at risk</div>
            </div>
          </button>
        ),
      });
    }

    return items.sort((a, b) => a.priority - b.priority);
  }, [data, revenueData, onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices]);

  if (alerts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="group" aria-label="Action alerts">
      {alerts.map((a) => <React.Fragment key={a.key}>{a.element}</React.Fragment>)}
    </div>
  );
});

interface ContactHealthStats {
  completenessAvg: number;
  withEmail: number;
  withPhone: number;
  withCompany: number;
  withTags: number;
  total: number;
}

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

function computeHealthStats(contacts: Contact[]): ContactHealthStats {
  if (contacts.length === 0) {
    return { completenessAvg: 0, withEmail: 0, withPhone: 0, withCompany: 0, withTags: 0, total: 0 };
  }

  let totalScore = 0;
  let withEmail = 0;
  let withPhone = 0;
  let withCompany = 0;
  let withTags = 0;

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

  return {
    completenessAvg: Math.round(totalScore / contacts.length),
    withEmail,
    withPhone,
    withCompany,
    withTags,
    total: contacts.length,
  };
}

function getCompletenessColor(pct: number): string {
  if (pct >= 75) return "hsl(142 76% 36%)";
  if (pct >= 50) return "hsl(var(--kf-accent2))";
  if (pct >= 25) return "hsl(var(--kf-accent1))";
  return "hsl(0 84% 60%)";
}

function getCompletenessLabel(pct: number): string {
  if (pct >= 75) return "Excellent";
  if (pct >= 50) return "Good";
  if (pct >= 25) return "Fair";
  return "Needs work";
}

const DataCompleteness = React.memo(function DataCompleteness({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => computeHealthStats(contacts), [contacts]);

  if (stats.total === 0) {
    return (
      <div className="kf-card p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          Data Completeness
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">Add contacts to see data completeness scores</p>
      </div>
    );
  }

  const color = getCompletenessColor(stats.completenessAvg);
  const label = getCompletenessLabel(stats.completenessAvg);

  const fields = [
    { label: "Email", count: stats.withEmail, icon: "📧" },
    { label: "Phone", count: stats.withPhone, icon: "📱" },
    { label: "Company", count: stats.withCompany, icon: "🏢" },
    { label: "Tags", count: stats.withTags, icon: "🏷️" },
  ];

  return (
    <div className="kf-card p-5 space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
        Data Completeness
      </h3>

      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3" className="stroke-muted/50" />
            <circle
              cx="18" cy="18" r="15.9" fill="none" strokeWidth="3"
              strokeDasharray={`${stats.completenessAvg} ${100 - stats.completenessAvg}`}
              strokeLinecap="round"
              style={{ stroke: color }}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color }}>{stats.completenessAvg}%</span>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium" style={{ color }}>{label}</div>
          <div className="text-xs text-muted-foreground">
            Average across {stats.total} contact{stats.total !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => {
          const pct = stats.total > 0 ? Math.round((f.count / stats.total) * 100) : 0;
          return (
            <div key={f.label} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
              <span className="text-sm">{f.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{f.label}</span>
                  <span className="text-xs font-medium">{pct}%</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden mt-0.5">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: getCompletenessColor(pct) }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface GrowthBucket {
  label: string;
  count: number;
}

const GrowthTrend = React.memo(function GrowthTrend({ contacts, period }: { contacts: Contact[]; period: Period }) {
  const buckets = useMemo(() => {
    const now = Date.now();
    const ms = PERIOD_MS[period];
    const bucketCount = period === "7d" ? 7 : period === "30d" ? 6 : 6;
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
        const date = new Date(start);
        label = date.toLocaleDateString("en-TT", { weekday: "short" });
      } else if (period === "30d") {
        const date = new Date(start);
        label = date.toLocaleDateString("en-TT", { month: "short", day: "numeric" });
      } else {
        const date = new Date(start);
        label = date.toLocaleDateString("en-TT", { month: "short" });
      }
      result.push({ label, count });
    }
    return result;
  }, [contacts, period]);

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  if (buckets.every((b) => b.count === 0)) {
    return (
      <div className="kf-card p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          Contact Growth
        </h3>
        <div className="text-center py-6 text-muted-foreground text-sm">
          No new contacts in this period
        </div>
      </div>
    );
  }

  const totalNew = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className="kf-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          Contact Growth
        </h3>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))]">
          +{totalNew} new
        </span>
      </div>
      <div className="flex items-end gap-1 h-24" role="img" aria-label={`Growth trend: ${totalNew} new contacts`}>
        {buckets.map((b, i) => {
          const heightPct = Math.max((b.count / maxCount) * 100, 4);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] font-medium text-muted-foreground">{b.count > 0 ? b.count : ""}</span>
              <div
                className="w-full rounded-t-sm transition-all duration-500"
                style={{
                  height: `${heightPct}%`,
                  background: b.count > 0
                    ? `hsl(var(--kf-accent2))`
                    : "hsl(var(--muted))",
                  opacity: b.count > 0 ? 0.8 : 0.3,
                }}
              />
              <span className="text-[9px] text-muted-foreground truncate w-full text-center">{b.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface LeadScoreBucket {
  label: string;
  range: string;
  count: number;
  color: string;
}

const LeadScoreDistribution = React.memo(function LeadScoreDistribution({ contacts }: { contacts: Contact[] }) {
  const buckets = useMemo((): LeadScoreBucket[] => {
    let hot = 0, warm = 0, cool = 0, cold = 0, unscored = 0;

    for (const c of contacts) {
      const score = (c as Record<string, unknown>).leadScore as number | null | undefined;
      if (score == null) { unscored++; continue; }
      if (score >= 75) hot++;
      else if (score >= 50) warm++;
      else if (score >= 25) cool++;
      else cold++;
    }

    return [
      { label: "Hot", range: "75-100", count: hot, color: "hsl(0 84% 60%)" },
      { label: "Warm", range: "50-74", count: warm, color: "hsl(var(--kf-accent1))" },
      { label: "Cool", range: "25-49", count: cool, color: "hsl(var(--kf-accent2))" },
      { label: "Cold", range: "0-24", count: cold, color: "hsl(210 40% 50%)" },
      ...(unscored > 0 ? [{ label: "Unscored", range: "—", count: unscored, color: "hsl(var(--muted-foreground))" }] : []),
    ];
  }, [contacts]);

  const total = contacts.length;
  if (total === 0) return null;

  const scored = buckets.filter((b) => b.label !== "Unscored");
  const hasScored = scored.some((b) => b.count > 0);

  if (!hasScored) {
    return (
      <div className="kf-card p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-muted-foreground" />
          Lead Score Distribution
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">Lead scores will appear as contacts accumulate activity</p>
      </div>
    );
  }

  return (
    <div className="kf-card p-5 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Target className="w-4 h-4 text-muted-foreground" />
        Lead Score Distribution
      </h3>
      <div className="space-y-2">
        {buckets.map((b) => {
          if (b.count === 0) return null;
          const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
          return (
            <div key={b.label} className="flex items-center gap-3">
              <div className="w-16 text-xs font-medium" style={{ color: b.color }}>{b.label}</div>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: b.color }}
                />
              </div>
              <div className="w-12 text-right text-xs text-muted-foreground">{b.count} ({pct}%)</div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const TaskHealth = React.memo(function TaskHealth({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => {
    let overdue = 0;
    let withOverdue = 0;
    let totalUnpaid = 0;
    let totalRevenue = 0;
    let contactsWithMeta = 0;

    for (const c of contacts) {
      const meta = (c as Record<string, unknown>).meta as Record<string, unknown> | null | undefined;
      if (!meta) continue;
      contactsWithMeta++;

      const ot = typeof meta.overdueTasks === "number" ? meta.overdueTasks : 0;
      overdue += ot;
      if (ot > 0) withOverdue++;

      const ui = typeof meta.unpaidInvoices === "number" ? meta.unpaidInvoices : 0;
      totalUnpaid += ui;

      const tr = typeof meta.totalRevenue === "number" ? meta.totalRevenue : 0;
      totalRevenue += tr;
    }

    return { overdue, withOverdue, totalUnpaid, totalRevenue, contactsWithMeta };
  }, [contacts]);

  if (stats.contactsWithMeta === 0) {
    return (
      <div className="kf-card p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-muted-foreground" />
          Task & Revenue Health
        </h3>
        <p className="text-sm text-muted-foreground text-center py-4">Create tasks and invoices to see health metrics</p>
      </div>
    );
  }

  const items = [
    {
      label: "Overdue Tasks",
      value: stats.overdue,
      sub: `across ${stats.withOverdue} contact${stats.withOverdue !== 1 ? "s" : ""}`,
      icon: ListChecks,
      color: stats.overdue > 0 ? "hsl(0 84% 60%)" : "hsl(142 76% 36%)",
      show: true,
    },
    {
      label: "Unpaid Invoices",
      value: stats.totalUnpaid,
      sub: "awaiting payment",
      icon: DollarSign,
      color: stats.totalUnpaid > 0 ? "hsl(var(--kf-accent1))" : "hsl(142 76% 36%)",
      show: true,
    },
    {
      label: "Total Revenue",
      value: formatTTD(stats.totalRevenue),
      sub: "from paid invoices",
      icon: CheckCircle2,
      color: "hsl(142 76% 36%)",
      show: stats.totalRevenue > 0,
    },
  ];

  const visibleItems = items.filter((it) => it.show);
  if (visibleItems.length === 0) return null;

  return (
    <div className="kf-card p-5 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-muted-foreground" />
        Task & Revenue Health
      </h3>
      <div className={`grid gap-3 ${visibleItems.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {visibleItems.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="p-3 rounded-xl bg-white/[0.02] border border-border/50 text-center">
              <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: it.color }} />
              <div className="text-lg font-bold" style={{ color: it.color }}>
                {typeof it.value === "number" ? it.value : it.value}
              </div>
              <div className="text-[10px] text-muted-foreground">{it.label}</div>
              <div className="text-[9px] text-muted-foreground mt-0.5">{it.sub}</div>
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
      <div className="kf-card p-8 text-center">
        <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">No Insights Yet</p>
        <p className="text-muted-foreground text-sm">
          Add contacts and activities to unlock pipeline insights and analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Pipeline Insights
        </h2>
        <div className="relative">
          <button
            onClick={togglePeriodMenu}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
            aria-haspopup="listbox"
            aria-expanded={showPeriodMenu}
            aria-label={`Time period: ${PERIOD_LABELS[period]}`}
          >
            {PERIOD_LABELS[period]}
            <ChevronDown className={`w-3 h-3 transition-transform ${showPeriodMenu ? "rotate-180" : ""}`} />
          </button>
          {showPeriodMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={closePeriodMenu} />
              <div
                className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
                role="listbox"
                aria-label="Select time period"
              >
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    role="option"
                    aria-selected={p === period}
                    onClick={() => handleSelectPeriod(p)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors ${
                      p === period ? "font-semibold text-[hsl(var(--kf-accent1))]" : ""
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

      {flowIntelligence && (
        <div className="kf-card p-5 space-y-5">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Pipeline Funnel
          </h3>
          <FunnelChart data={flowIntelligence} />
        </div>
      )}

      {flowIntelligence && (
        <ConversionMetrics data={flowIntelligence} />
      )}

      {flowIntelligence && (
        <AlertCards
          data={flowIntelligence}
          revenueData={revenueData}
          onViewCold={onViewCold}
          onViewReady={onViewReady}
          onViewExpiringQuotes={onViewExpiringQuotes}
          onViewOverdueInvoices={onViewOverdueInvoices}
        />
      )}

      {revenueData && <RevenueBreakdown data={revenueData} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <GrowthTrend contacts={contacts} period={period} />
        <DataCompleteness contacts={contacts} />
      </div>

      <TaskHealth contacts={contacts} />

      <LeadScoreDistribution contacts={contacts} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <TopSources contacts={periodContacts} />
        <TopSegments contacts={periodContacts} />
      </div>
    </div>
  );
}

export const InsightsTab = React.memo(InsightsTabInner);
