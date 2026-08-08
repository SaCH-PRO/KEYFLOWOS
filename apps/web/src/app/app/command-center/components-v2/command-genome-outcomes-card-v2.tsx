"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lightbulb, TrendingUp, TrendingDown, Loader2, ArrowRight, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import {
  getGenomeRecommendationOutcomesSummary,
  getGenomeRecommendationLearningSummary,
  type GenomeRecommendationOutcomeSummary,
  type GenomeRecommendationLearningSummary,
} from "@/lib/api/business-genome";

interface CommandGenomeOutcomesCardV2Props {
  businessId: string;
}

export function CommandGenomeOutcomesCardV2({ businessId }: CommandGenomeOutcomesCardV2Props) {
  const [summary, setSummary] = useState<GenomeRecommendationOutcomeSummary | null>(null);
  const [learning, setLearning] = useState<GenomeRecommendationLearningSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getGenomeRecommendationOutcomesSummary(businessId),
      getGenomeRecommendationLearningSummary(businessId),
    ])
      .then(([summaryRes, learningRes]) => {
        if (cancelled) return;
        setSummary(summaryRes.data ?? null);
        setLearning(learningRes.data ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const hasOutcomes = summary && summary.total > 0;

  return (
    <Surface className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/15">
          <Lightbulb className="h-3.5 w-3.5 text-gold-foreground" />
        </div>
        <h3 className="font-display text-sm font-semibold text-foreground">Recommendation Outcomes</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">Loading outcomes...</span>
        </div>
      ) : !hasOutcomes ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            No recommendation outcomes tracked yet. Decisions you record will show up here.
          </p>
          <Link
            href="/app/genome"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View recommendations <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Tracked" value={summary.total} />
            <Metric
              label="Win rate"
              value={`${Math.round(summary.winRate * 100)}%`}
              tone={summary.winRate >= 0.5 ? "success" : summary.winRate > 0 ? "warning" : "neutral"}
            />
            <Metric
              label="Execution"
              value={`${Math.round(summary.executionRate * 100)}%`}
              tone={summary.executionRate >= 0.5 ? "success" : "neutral"}
            />
            <Metric
              label="Avg impact"
              value={learning ? formatImpact(learning.averageImpactScore) : "—"}
              tone={
                learning && learning.averageImpactScore > 0
                  ? "success"
                  : learning && learning.averageImpactScore < 0
                    ? "danger"
                    : "neutral"
              }
            />
          </div>

          {(learning?.topPositiveDomains.length || 0) > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-foreground uppercase tracking-wide">
                <TrendingUp className="w-3 h-3 text-mint" />
                Top winning domains
              </div>
              <div className="flex flex-wrap gap-1.5">
                {learning!.topPositiveDomains.map((d) => (
                  <Badge key={d.domain} color="mint">
                    {d.domain.replace(/_/g, " ")}
                    <span className="opacity-80">+{d.averageImpact.toFixed(1)}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {(learning?.topNegativeDomains.length || 0) > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-foreground uppercase tracking-wide">
                <TrendingDown className="w-3 h-3 text-rose" />
                Needs attention
              </div>
              <div className="flex flex-wrap gap-1.5">
                {learning!.topNegativeDomains.map((d) => (
                  <Badge key={d.domain} color="rose">
                    {d.domain.replace(/_/g, " ")}
                    <span className="opacity-80">{d.averageImpact.toFixed(1)}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {(learning?.recentOutcomes.length || 0) > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-foreground uppercase tracking-wide">
                <Target className="w-3 h-3 text-muted-foreground" />
                Recent observed outcomes
              </div>
              <div className="space-y-1">
                {learning!.recentOutcomes.slice(0, 3).map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted px-2 py-1"
                  >
                    <span className="text-[10px] text-foreground truncate">
                      {o.domain.replace(/_/g, " ")}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium whitespace-nowrap font-mono",
                        (o.impactScore ?? 0) > 0
                          ? "text-mint"
                          : (o.impactScore ?? 0) < 0
                            ? "text-rose"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatImpact(o.impactScore ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Link
            href="/app/genome"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Review all recommendations <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </Surface>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-xl p-2 bg-surface-muted">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold font-mono",
          tone === "neutral" && "text-foreground",
          tone === "success" && "text-mint",
          tone === "warning" && "text-gold",
          tone === "danger" && "text-rose",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatImpact(value: number): string {
  if (value === 0) return "0.0";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}
