"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Loader2,
  Network,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet, apiPostSimple } from "@/lib/api";

type Kpis = {
  totalContacts: number;
  activeJourneys: number;
  conversions30d: number;
  conversionRate: number;
  attributedRevenue: number;
  attributedRevenueLabel: string;
  touchpoints30d: number;
  avgDaysToConversion: number;
  avgJourneyHealth: number;
};

type FunnelEntry = { stage: string; count: number; totalRevenue: number };
type ChannelMixEntry = { channel: string; touchpoints: number; share: number; revenue: number };
type AttributionRow = { key: string; label: string | null; revenue: number; conversions: number };
type AttributionByModel = Record<string, AttributionRow[]>;
type Attribution = { dimension: string; periodStart?: string; periodEnd?: string; byModel: AttributionByModel };
type RiskContact = {
  id: string;
  contactId: string;
  contactName: string;
  stage: string;
  lastTouchAt: string | null;
  lastChannel: string | null;
  healthScore: number;
  riskLevel: string;
  totalRevenue: number;
};
type TopContact = {
  id: string;
  contactId: string;
  contactName: string;
  stage: string;
  totalRevenue: number;
  touchpointCount: number;
  channels: string[];
  healthScore: number;
};
type Insight = {
  id: string;
  category: string;
  insightType: string;
  severity: string;
  title: string;
  description: string | null;
  recommendation: string | null;
  rationale: string | null;
  suggestedAction: string | null;
  source: string | null;
  estimatedImpact: number | null;
  impactCurrency: string | null;
  actionLabel: string | null;
  actionRoute: string | null;
  status: string;
};

type Dashboard = {
  kpis: Kpis;
  funnel: FunnelEntry[];
  channelMix: ChannelMixEntry[];
  attribution: Attribution;
  atRiskContacts: RiskContact[];
  topContacts: TopContact[];
  insights: Insight[];
};

const STAGE_ORDER = ["AWARENESS", "INTEREST", "CONSIDERATION", "CONVERSION", "RETENTION", "ADVOCACY", "CHURNED"];
const STAGE_COLORS: Record<string, string> = {
  AWARENESS: "#60A5FA",
  INTEREST: "#A78BFA",
  CONSIDERATION: "#F59E0B",
  CONVERSION: "#10B981",
  RETENTION: "#22D3EE",
  ADVOCACY: "#F472B6",
  CHURNED: "#9CA3AF",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "hsl(var(--kf-error))",
  warning: "#F59E0B",
  opportunity: "#10B981",
  info: "#60A5FA",
};

function formatTTD(amount: number) {
  return `TT$${amount.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function GrowthIntelligencePanel({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [model, setModel] = useState<"first_touch" | "last_touch" | "linear">("last_touch");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<Dashboard>(`/growth-intelligence/businesses/${businessId}/dashboard`);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setData(res.data);
        setError(null);
      }
    } catch (err) {
      setError((err as Error).message ?? "Failed to load growth intelligence");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = async () => {
    if (!businessId || regenerating) return;
    setRegenerating(true);
    try {
      await apiPostSimple(`/growth-intelligence/businesses/${businessId}/insights/regenerate`, {});
      await load();
    } finally {
      setRegenerating(false);
    }
  };

  const backfill = async () => {
    if (!businessId || backfilling) return;
    setBackfilling(true);
    try {
      await apiPostSimple(`/growth-intelligence/businesses/${businessId}/journeys/backfill`, {});
      await load();
    } finally {
      setBackfilling(false);
    }
  };

  const updateInsight = async (insightId: string, status: "acknowledged" | "dismissed" | "applied") => {
    await apiPostSimple(`/growth-intelligence/businesses/${businessId}/insights/${insightId}/status`, { status });
    await load();
  };

  const funnel = useMemo(() => {
    if (!data) return [] as FunnelEntry[];
    const map = new Map(data.funnel.map(f => [f.stage, f]));
    return STAGE_ORDER.map(stage => map.get(stage) ?? { stage, count: 0, totalRevenue: 0 });
  }, [data]);

  const maxFunnel = useMemo(() => Math.max(1, ...funnel.map(f => f.count)), [funnel]);
  const attributionRows = data?.attribution.byModel?.[model] ?? [];
  const attributionMax = Math.max(1, ...attributionRows.map(r => r.revenue));

  if (loading && !data) {
    return (
      <SectionCard
        title="Growth Intelligence"
        subtitle="Customer journey, attribution & AI recommendations"
        icon={TrendingUp}
      >
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading growth intelligence…
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <SectionCard
        title="Growth Intelligence"
        subtitle="Customer journey, attribution & AI recommendations"
        icon={TrendingUp}
      >
        <div className="p-4 kf-radius-md text-sm" style={{ background: "hsl(var(--kf-error)/0.1)", color: "hsl(var(--kf-error))" }}>
          {error}
        </div>
      </SectionCard>
    );
  }

  if (!data) return null;

  return (
    <SectionCard
      title="Growth Intelligence"
      subtitle="Customer journey, attribution & AI recommendations"
      icon={TrendingUp}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={backfill}
            disabled={backfilling}
            className="text-xs px-2.5 py-1.5 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition disabled:opacity-50 flex items-center gap-1.5"
            title="Backfill journeys from existing CRM/commerce events"
          >
            {backfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />}
            Backfill
          </button>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="text-xs px-2.5 py-1.5 kf-radius-md text-white hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5"
            style={{ background: "linear-gradient(135deg, #10B981 0%, #14B8A6 100%)" }}
          >
            {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Recompute insights
          </button>
          <button
            onClick={load}
            className="text-xs p-1.5 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile icon={Users} label="Active journeys" value={data.kpis.activeJourneys.toLocaleString()} sub={`${data.kpis.totalContacts.toLocaleString()} total`} accent="#60A5FA" />
          <KpiTile icon={CheckCircle2} label="Conversions (30d)" value={data.kpis.conversions30d.toLocaleString()} sub={`${data.kpis.conversionRate}% rate`} accent="#10B981" />
          <KpiTile icon={Wallet} label="Attributed revenue" value={data.kpis.attributedRevenueLabel} sub={`${data.kpis.touchpoints30d} touchpoints`} accent="#F59E0B" />
          <KpiTile icon={BarChart3} label="Avg journey health" value={`${data.kpis.avgJourneyHealth}/100`} sub={`${data.kpis.avgDaysToConversion}d to convert`} accent="#A78BFA" />
        </div>

        {/* Funnel */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Lifecycle funnel</h4>
            <span className="text-xs text-muted-foreground">{data.kpis.totalContacts.toLocaleString()} contacts</span>
          </div>
          <div className="space-y-1.5">
            {funnel.map(stage => (
              <div key={stage.stage} className="flex items-center gap-3">
                <div className="w-32 text-xs text-muted-foreground">{stage.stage}</div>
                <div className="flex-1 relative h-6 bg-muted/30 kf-radius-md overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-r-md transition-all"
                    style={{
                      width: `${(stage.count / maxFunnel) * 100}%`,
                      background: STAGE_COLORS[stage.stage] ?? "#9CA3AF",
                    }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-medium">
                    {stage.count.toLocaleString()}
                    {stage.totalRevenue > 0 && (
                      <span className="ml-2 text-[10px] opacity-80">· {formatTTD(stage.totalRevenue)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Channel mix + Attribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Channel mix (30d)</h4>
            {data.channelMix.length === 0 ? (
              <EmptyHint label="No touchpoints in the last 30 days" />
            ) : (
              <div className="space-y-2">
                {data.channelMix.slice(0, 8).map(c => (
                  <div key={c.channel} className="flex items-center gap-2 text-xs">
                    <div className="w-20 capitalize text-muted-foreground">{c.channel}</div>
                    <div className="flex-1 h-2 bg-muted/30 kf-radius-md overflow-hidden">
                      <div className="h-full rounded-r-md" style={{ width: `${c.share}%`, background: "#60A5FA" }} />
                    </div>
                    <div className="w-12 text-right tabular-nums">{c.share}%</div>
                    <div className="w-20 text-right tabular-nums text-muted-foreground">{c.touchpoints}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Attribution by channel</h4>
              <div className="flex gap-1">
                {(["first_touch", "last_touch", "linear"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setModel(m)}
                    className={`text-[10px] px-2 py-0.5 kf-radius-sm border transition ${
                      model === m
                        ? "bg-foreground text-background border-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
            {attributionRows.length === 0 ? (
              <EmptyHint label="Recompute insights to populate attribution" />
            ) : (
              <div className="space-y-2">
                {attributionRows.slice(0, 8).map(r => (
                  <div key={r.key} className="flex items-center gap-2 text-xs">
                    <div className="w-24 capitalize text-muted-foreground truncate">{r.label || r.key}</div>
                    <div className="flex-1 h-2 bg-muted/30 kf-radius-md overflow-hidden">
                      <div className="h-full rounded-r-md" style={{ width: `${(r.revenue / attributionMax) * 100}%`, background: "#10B981" }} />
                    </div>
                    <div className="w-24 text-right tabular-nums">{formatTTD(r.revenue)}</div>
                    <div className="w-12 text-right text-muted-foreground tabular-nums">{r.conversions}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Insights */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Recommendations
            </h4>
            <span className="text-xs text-muted-foreground">{data.insights.length} active</span>
          </div>
          {data.insights.length === 0 ? (
            <EmptyHint label="No active recommendations. Click ‘Recompute insights’ to refresh." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.insights.map(ins => (
                <div
                  key={ins.id}
                  className="p-3 kf-radius-md border border-border bg-background/50 flex flex-col gap-2"
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="w-2 h-2 rounded-full mt-1.5"
                      style={{ background: SEVERITY_COLORS[ins.severity] ?? "#9CA3AF" }}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <div className="text-sm font-semibold">{ins.title}</div>
                        {ins.source === "ai" && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 kf-radius-sm font-semibold uppercase tracking-wide flex items-center gap-1"
                            style={{ background: "rgba(168, 85, 247, 0.15)", color: "#A855F7" }}
                            title="Rationale and suggested action written by AI"
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                            AI
                          </span>
                        )}
                      </div>
                      {ins.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{ins.description}</div>
                      )}
                      {ins.recommendation && (
                        <div className="text-xs mt-1.5 text-foreground/80">
                          <span className="font-medium">Recommendation: </span>
                          {ins.recommendation}
                        </div>
                      )}
                      {ins.rationale && (
                        <div className="text-xs mt-1.5 italic text-muted-foreground">
                          <span className="font-medium not-italic text-foreground/70">Why it matters: </span>
                          {ins.rationale}
                        </div>
                      )}
                      {ins.suggestedAction && (
                        <div className="text-xs mt-1.5 text-foreground/90">
                          <span className="font-medium">Try first: </span>
                          {ins.suggestedAction}
                        </div>
                      )}
                      {ins.estimatedImpact !== null && ins.estimatedImpact > 0 && (
                        <div className="text-[11px] mt-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          Est. impact: {formatTTD(ins.estimatedImpact)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    {ins.actionRoute ? (
                      <button
                        onClick={() => router.push(ins.actionRoute!)}
                        className="text-xs flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {ins.actionLabel ?? "Open"} <ArrowUpRight className="w-3 h-3" />
                      </button>
                    ) : <span />}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateInsight(ins.id, "applied")}
                        className="text-[10px] px-1.5 py-0.5 kf-radius-sm border border-border text-muted-foreground hover:text-emerald-500"
                        title="Mark applied"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => updateInsight(ins.id, "dismissed")}
                        className="text-[10px] px-1.5 py-0.5 kf-radius-sm border border-border text-muted-foreground hover:text-red-500"
                        title="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* At-risk + Top contacts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> At-risk contacts
            </h4>
            {data.atRiskContacts.length === 0 ? (
              <EmptyHint label="No at-risk contacts right now." />
            ) : (
              <div className="space-y-1.5">
                {data.atRiskContacts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/app/contacts/${c.contactId}`)}
                    className="w-full flex items-center justify-between p-2 kf-radius-md border border-border hover:bg-muted/30 transition text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{c.contactName}</div>
                      <div className="text-[10px] text-muted-foreground">{c.stage} · {c.lastChannel ?? "no channel"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs tabular-nums">{c.healthScore}/100</div>
                      <div className={`text-[10px] uppercase ${c.riskLevel === "high" ? "text-red-500" : "text-amber-500"}`}>{c.riskLevel}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-500" /> Top revenue contacts
            </h4>
            {data.topContacts.length === 0 ? (
              <EmptyHint label="No converted contacts yet." />
            ) : (
              <div className="space-y-1.5">
                {data.topContacts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/app/contacts/${c.contactId}`)}
                    className="w-full flex items-center justify-between p-2 kf-radius-md border border-border hover:bg-muted/30 transition text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{c.contactName}</div>
                      <div className="text-[10px] text-muted-foreground">{c.stage} · {c.touchpointCount} touchpoints</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs tabular-nums">{formatTTD(c.totalRevenue)}</div>
                      <div className="text-[10px] text-muted-foreground">{c.channels.length} channels</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="p-3 kf-radius-md border border-border bg-background/50">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3 h-3" style={{ color: accent }} />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="text-xs text-muted-foreground p-3 kf-radius-md border border-dashed border-border bg-muted/10">
      {label}
    </div>
  );
}
