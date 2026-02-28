"use client";

import { useMemo, useState } from "react";
import {
  BarChart3, TrendingUp, Users, ArrowRight, DollarSign,
  Clock, Zap, AlertTriangle, Filter, ChevronDown,
} from "lucide-react";
import { FlowIntelligence } from "@/components/contacts";
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

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
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
    </div>
  );
}

const FUNNEL_STAGES = [
  { key: "leads", label: "Leads", color: "hsl(var(--kf-accent1))" },
  { key: "prospects", label: "Prospects", color: "hsl(var(--kf-accent2))" },
  { key: "clients", label: "Clients", color: "hsl(142 76% 36%)" },
] as const;

function FunnelChart({ data }: { data: FlowIntelligenceData }) {
  const maxCount = Math.max(data.leads, data.prospects, data.clients, 1);
  const stages = [
    { ...FUNNEL_STAGES[0], count: data.leads },
    { ...FUNNEL_STAGES[1], count: data.prospects },
    { ...FUNNEL_STAGES[2], count: data.clients },
  ];

  const leadToProspect = data.leads > 0 ? ((data.prospects / data.leads) * 100).toFixed(1) : "0";
  const prospectToClient = data.prospects > 0 ? ((data.clients / data.prospects) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-3">
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
}

function ConversionMetrics({ data }: { data: FlowIntelligenceData }) {
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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className="p-3 rounded-xl bg-white/[0.02] border border-border/50">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{m.label}</div>
          <div className="text-2xl font-bold mt-1" style={{ color: m.color }}>{m.value}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{m.sub}</div>
        </div>
      ))}
    </div>
  );
}

function TopSources({ contacts }: { contacts: Contact[] }) {
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

  if (sources.length === 0) return null;

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
}

function TopSegments({ contacts }: { contacts: Contact[] }) {
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

  if (segments.length === 0) return null;

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
}

function RevenueBreakdown({ data }: { data: RevenueData }) {
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
          TTD {total.toLocaleString()}
        </span>
      </div>

      <div className="h-4 bg-muted rounded-full overflow-hidden flex">
        {sources.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={s.label}
              className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-700"
              style={{ width: `${pct}%`, background: s.color }}
              title={`${s.label}: TTD ${s.value.toLocaleString()}`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {sources.map((s) => (
          <div key={s.label}>
            <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: s.color }} />
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            <div className="text-sm font-semibold">TTD {s.value.toLocaleString()}</div>
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
                <span className="text-muted-foreground"> · TTD {data.expiringQuotes.value.toLocaleString()}</span>
              </span>
            </div>
          )}
          {data.overdueInvoices.count > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-sm">
              <DollarSign className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>
                <strong>{data.overdueInvoices.count}</strong> overdue invoices
                <span className="text-muted-foreground"> · TTD {data.overdueInvoices.value.toLocaleString()}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertCards({
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
  const alerts = [];

  if (data.contactsReadyToAdvance > 0) {
    alerts.push(
      <button
        key="ready"
        onClick={onViewReady}
        className="flex items-center gap-3 p-3 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/30 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors text-left w-full"
      >
        <Zap className="w-5 h-5 text-[hsl(var(--kf-accent2))] flex-shrink-0" />
        <div>
          <div className="text-sm font-medium">{data.contactsReadyToAdvance} ready to advance</div>
          <div className="text-xs text-muted-foreground">High engagement detected</div>
        </div>
      </button>,
    );
  }

  if (data.contactsGoingCold > 0) {
    alerts.push(
      <button
        key="cold"
        onClick={onViewCold}
        className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left w-full"
      >
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
        <div>
          <div className="text-sm font-medium">{data.contactsGoingCold} going cold</div>
          <div className="text-xs text-muted-foreground">Re-engage before they&apos;re lost</div>
        </div>
      </button>,
    );
  }

  if (revenueData?.expiringQuotes && revenueData.expiringQuotes.count > 0) {
    alerts.push(
      <button
        key="quotes"
        onClick={onViewExpiringQuotes}
        className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left w-full"
      >
        <Clock className="w-5 h-5 text-amber-500 flex-shrink-0" />
        <div>
          <div className="text-sm font-medium">{revenueData.expiringQuotes.count} quotes expiring</div>
          <div className="text-xs text-muted-foreground">TTD {revenueData.expiringQuotes.value.toLocaleString()} at risk</div>
        </div>
      </button>,
    );
  }

  if (revenueData?.overdueInvoices && revenueData.overdueInvoices.count > 0) {
    alerts.push(
      <button
        key="invoices"
        onClick={onViewOverdueInvoices}
        className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 transition-colors text-left w-full"
      >
        <DollarSign className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div>
          <div className="text-sm font-medium">{revenueData.overdueInvoices.count} overdue invoices</div>
          <div className="text-xs text-muted-foreground">TTD {revenueData.overdueInvoices.value.toLocaleString()} outstanding</div>
        </div>
      </button>,
    );
  }

  if (alerts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {alerts}
    </div>
  );
}

export function InsightsTab({
  flowIntelligence, revenueData, contacts, loading,
  onViewCold, onViewReady, onViewExpiringQuotes, onViewOverdueInvoices,
}: InsightsTabProps) {
  const [period, setPeriod] = useState<Period>("30d");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);

  const filteredContacts = useMemo(() => {
    const now = Date.now();
    const ms: Record<Period, number> = {
      "7d": 7 * 86400000,
      "30d": 30 * 86400000,
      "90d": 90 * 86400000,
    };
    const cutoff = now - ms[period];
    return contacts.filter((c) => {
      const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
      return d >= cutoff;
    });
  }, [contacts, period]);

  if (loading) return <InsightsSkeleton />;

  if (!flowIntelligence && !revenueData) {
    return (
      <div className="kf-card p-8 text-center">
        <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">Insights Coming Soon</p>
        <p className="text-muted-foreground text-sm">
          Add more contacts and activities to unlock AI-powered insights about your pipeline.
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
            onClick={() => setShowPeriodMenu(!showPeriodMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            {PERIOD_LABELS[period]}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showPeriodMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPeriodMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPeriod(p); setShowPeriodMenu(false); }}
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
        <TopSources contacts={filteredContacts.length > 0 ? filteredContacts : contacts} />
        <TopSegments contacts={filteredContacts.length > 0 ? filteredContacts : contacts} />
      </div>
    </div>
  );
}
