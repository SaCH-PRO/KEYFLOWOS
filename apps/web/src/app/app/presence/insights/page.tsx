"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchPresenceInsights,
  regeneratePresenceInsights,
  delegatePresenceInsight,
  type PresenceInsightSnapshotResponse,
  type PresenceInsight,
  type PresenceInsightCategory,
} from "@/lib/client";

const CATEGORIES: {
  key: PresenceInsightCategory;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "money", label: "Money", Icon: Banknote },
  { key: "time", label: "Time", Icon: Clock },
  { key: "people", label: "People", Icon: Users },
  { key: "services", label: "Services", Icon: Wrench },
  { key: "goods", label: "Goods", Icon: Package },
];

export default function PresenceInsightsPage() {
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [data, setData] = useState<PresenceInsightSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(() => !!businessId);
  const [regenerating, setRegenerating] = useState(false);
  const [activeCategory, setActiveCategory] = useState<PresenceInsightCategory>("money");
  const [error, setError] = useState<string | null>(null);
  const [delegatingId, setDelegatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchPresenceInsights(businessId).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else setData(res.data ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const handleRegenerate = async () => {
    if (!businessId) return;
    setRegenerating(true);
    const res = await regeneratePresenceInsights(businessId);
    setRegenerating(false);
    if (res.error) {
      toast.error(res.error);
    } else if (res.data) {
      setData(res.data);
      toast.success("Insights refreshed");
    }
  };

  const handleDelegate = async (insight: PresenceInsight) => {
    if (!businessId) return;
    setDelegatingId(insight.id);
    const res = await delegatePresenceInsight(businessId, insight.id);
    setDelegatingId(null);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(
        res.data?.created
          ? "Sent to your Revenue Action Queue"
          : "Already in your Revenue Action Queue",
      );
    }
  };

  const counts = useMemo(() => {
    const out: Record<PresenceInsightCategory, number> = {
      money: 0, time: 0, people: 0, services: 0, goods: 0,
    };
    if (!data) return out;
    for (const c of CATEGORIES) {
      out[c.key] = data.snapshot.categories[c.key]?.insights.length ?? 0;
    }
    return out;
  }, [data]);

  if (!businessId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Pick a workspace to view your storefront insights.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading insights…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error ?? "Failed to load insights."}
        </div>
      </div>
    );
  }

  const block = data.snapshot.categories[activeCategory];

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-xl border border-border/40 bg-slate-950/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-orange-300/80 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Storefront intelligence
              {data.narrativeSource === "template" && (
                <span className="text-muted-foreground/70">· template narrative</span>
              )}
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-snug">
              {data.snapshot.narrative.headline}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {data.snapshot.narrative.body}
            </p>
            <div className="mt-2 text-[11px] text-muted-foreground/70">
              Window: last {data.snapshot.windowDays} days · Generated{" "}
              {new Date(data.computedAt).toLocaleString()}
              {data.stale && " · stale"}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="shrink-0"
          >
            {regenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border/40">
        {CATEGORIES.map((c) => {
          const active = c.key === activeCategory;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setActiveCategory(c.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors",
                active
                  ? "border-orange-500 text-orange-300 bg-slate-900/40"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-slate-900/30",
              )}
            >
              <c.Icon className="w-3.5 h-3.5" />
              {c.label}
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-800/80 px-1 text-[10px] text-muted-foreground">
                {counts[c.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border/40 bg-slate-950/30 p-4 text-xs text-muted-foreground">
        {block.summary}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {block.insights.length === 0 && (
          <div className="md:col-span-2 rounded-lg border border-dashed border-border/40 p-6 text-center text-sm text-muted-foreground">
            No insights in this category yet — keep collecting real signal and
            we&apos;ll surface them as soon as the threshold is met.
          </div>
        )}
        {block.insights.map((i) => (
          <InsightCard
            key={i.id}
            insight={i}
            onDelegate={handleDelegate}
            delegating={delegatingId === i.id}
          />
        ))}
      </div>
    </div>
  );
}

function InsightCard({
  insight,
  onDelegate,
  delegating,
}: {
  insight: PresenceInsight;
  onDelegate: (i: PresenceInsight) => void;
  delegating: boolean;
}) {
  const sevTone =
    insight.severity === "warning"
      ? "border-amber-500/30 bg-amber-500/5"
      : insight.severity === "success"
        ? "border-emerald-500/30 bg-emerald-500/5"
        : "border-border/40 bg-slate-950/40";
  const sevIcon =
    insight.severity === "warning" ? (
      <AlertTriangle className="w-4 h-4 text-amber-400" />
    ) : insight.severity === "success" ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    ) : (
      <BarChart3 className="w-4 h-4 text-sky-400" />
    );
  return (
    <div className={cn("rounded-xl border p-4 flex flex-col gap-3", sevTone)}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">{sevIcon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">{insight.title}</div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {insight.detail}
          </p>
        </div>
        {insight.metric && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {insight.metric.label}
            </div>
            <div className="text-sm font-semibold">{insight.metric.value}</div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground/60">
          n={insight.sampleSize}
        </div>
        <div className="flex items-center gap-2">
          {insight.cta && (
            <Link
              href={insight.cta.href}
              className="text-xs text-orange-300 hover:text-orange-200 inline-flex items-center gap-1"
            >
              {insight.cta.label}
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
          {insight.actionable && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onDelegate(insight)}
              disabled={delegating}
            >
              {delegating ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : null}
              Delegate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
