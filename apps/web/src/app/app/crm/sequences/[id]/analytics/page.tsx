"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, TrendingUp, AlertTriangle, Trophy, Users } from "lucide-react";
import { Button, Card, ContentContainer, Badge } from "@keyflow/ui";
import {
  SequenceAnalytics,
  fetchSequenceAnalytics,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const RANGES: { id: string; label: string; days: number | null }[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: null },
];

function pct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatCurrency(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "TTD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value.toFixed(0)}`;
  }
}

export default function SequenceAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const sequenceId = params?.id;
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState<string>("30d");
  const [analytics, setAnalytics] = useState<SequenceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const computeRange = useCallback((id: string) => {
    const r = RANGES.find((x) => x.id === id) ?? RANGES[1];
    if (!r.days) return undefined;
    const to = new Date();
    const from = new Date(to.getTime() - r.days * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(async (bid: string, rid: string) => {
    if (!sequenceId) return;
    setLoading(true);
    const { data } = await fetchSequenceAnalytics(bid, sequenceId, computeRange(rid));
    setAnalytics(data ?? null);
    setLoading(false);
  }, [sequenceId, computeRange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = (await ensureWorkspace()) ?? getStoredBusinessId();
      if (cancelled || !id) return;
      setBusinessId(id);
      await load(id, rangeId);
    })();
    return () => { cancelled = true; };
    // Only run on mount; range changes are handled by the range button onClick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRangeChange = (id: string) => {
    setRangeId(id);
    if (businessId) void load(businessId, id);
  };

  const maxFunnel = useMemo(
    () => Math.max(1, ...((analytics?.funnel ?? []).map((f) => f.count))),
    [analytics],
  );
  const maxStepReached = useMemo(
    () => Math.max(1, ...((analytics?.steps ?? []).map((s) => s.reached))),
    [analytics],
  );

  return (
    <ContentContainer>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <Link
            href={`/app/crm/sequences/${sequenceId ?? ""}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" /> Back to builder
          </Link>
          <h1 className="text-xl font-semibold mt-2 truncate">
            {analytics?.name ?? "Sequence analytics"}
          </h1>
          <p className="text-xs text-muted-foreground">
            Funnel, per-step performance, and attributed deals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 overflow-hidden text-xs">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => handleRangeChange(r.id)}
                className={`px-2 py-1 ${rangeId === r.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Link href="/app/crm/sequences/lifecycle">
            <Button variant="subtle" size="sm">Lifecycle report</Button>
          </Link>
        </div>
      </div>

      {loading || !analytics ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading analytics…</div>
      ) : (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Enrolled</div>
              <div className="text-2xl font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                {analytics.enrollment.total}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {analytics.enrollment.active} active · {analytics.enrollment.completed} done · {analytics.enrollment.failed} failed
              </div>
            </Card>
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Reply rate (avg)</div>
              <div className="text-2xl font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                {pct(
                  analytics.steps.length
                    ? analytics.steps.reduce((s, x) => s + (x.replyRate ?? 0), 0) / analytics.steps.length
                    : null,
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">across {analytics.steps.length} step(s)</div>
            </Card>
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Attributed deals</div>
              <div className="text-2xl font-semibold flex items-center gap-2">
                <Trophy className="w-4 h-4 text-[hsl(var(--kf-success))]" />
                {analytics.attribution.deals}
              </div>
              <div className="text-[11px] text-muted-foreground">{analytics.attribution.contacts} contact(s) hit goal</div>
            </Card>
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Attributed value</div>
              <div className="text-2xl font-semibold">
                {formatCurrency(analytics.attribution.value, analytics.attribution.currency)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Window: {analytics.attributionWindowDays}d
              </div>
            </Card>
          </div>

          {/* Funnel */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">Enrollment funnel</h3>
                <p className="text-xs text-muted-foreground">From enrolment to goal hit.</p>
              </div>
            </div>
            <div className="space-y-2">
              {analytics.funnel.map((step, idx) => {
                const widthPct = (step.count / maxFunnel) * 100;
                const stageColor =
                  step.stage === "goal"
                    ? "bg-[hsl(var(--kf-success))]/60"
                    : step.stage === "replied"
                    ? "bg-[hsl(var(--kf-success))]/45"
                    : step.stage === "opened"
                    ? "bg-[hsl(var(--kf-info))]/55"
                    : step.stage === "sent"
                    ? "bg-[hsl(var(--kf-accent1))]/45"
                    : "bg-[hsl(var(--kf-accent1))]/60";
                return (
                  <div key={`${step.label}-${idx}`} className="flex items-center gap-3">
                    <div className="w-40 text-xs text-muted-foreground truncate">{step.label}</div>
                    <div className="flex-1 h-6 bg-muted/30 rounded-md overflow-hidden">
                      <div
                        className={`h-full ${stageColor}`}
                        style={{ width: `${Math.max(2, widthPct)}%` }}
                      />
                    </div>
                    <div className="w-14 text-right text-xs tabular-nums font-medium">{step.count}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Per-step heatmap */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">Per-step performance</h3>
                <p className="text-xs text-muted-foreground">Drop-off heatmap and reply rates.</p>
              </div>
            </div>
            {analytics.steps.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No actionable steps in this sequence yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-2 pr-3">Step</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Reached</th>
                      <th className="py-2 pr-3">Advanced</th>
                      <th className="py-2 pr-3">Drop-off</th>
                      <th className="py-2 pr-3">Open</th>
                      <th className="py-2 pr-3">Click</th>
                      <th className="py-2 pr-3">Reply</th>
                      <th className="py-2 pr-3">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.steps.map((s, idx) => {
                      const heatIntensity = Math.min(1, s.dropOffRate);
                      const heat = `rgba(239, 68, 68, ${0.1 + heatIntensity * 0.45})`;
                      const reachWidth = (s.reached / maxStepReached) * 100;
                      return (
                        <tr key={s.nodeId} className="border-t border-border/40">
                          <td className="py-2 pr-3">
                            <div className="font-medium truncate max-w-[180px]">{s.label}</div>
                            <div className="text-[10px] text-muted-foreground">step {idx + 1}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <Badge className="text-[10px]">{s.nodeType}</Badge>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-muted/40 rounded">
                                <div className="h-full bg-[hsl(var(--kf-accent1))]/60 rounded" style={{ width: `${reachWidth}%` }} />
                              </div>
                              <span className="tabular-nums">{s.reached}</span>
                            </div>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{s.advanced}</td>
                          <td className="py-2 pr-3">
                            <div
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                              style={{ background: heat }}
                              title={`${s.dropOff} contact(s) dropped off`}
                            >
                              {s.dropOffRate > 0.4 && <AlertTriangle className="w-3 h-3 text-[hsl(var(--kf-error))]" />}
                              <span className="tabular-nums">{pct(s.dropOffRate)}</span>
                              <span className="text-muted-foreground">({s.dropOff})</span>
                            </div>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">{pct(s.openRate)}</td>
                          <td className="py-2 pr-3 tabular-nums">{pct(s.clickRate)}</td>
                          <td className="py-2 pr-3 tabular-nums">{pct(s.replyRate)}</td>
                          <td className="py-2 pr-3 tabular-nums">{s.failed}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Attributed deals */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-sm">Attributed deals (won)</h3>
                <p className="text-xs text-muted-foreground">
                  Deals won within {analytics.attributionWindowDays} days after enrollment (last-touch).
                </p>
              </div>
            </div>
            {analytics.attribution.items.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                No attributed deals in this period.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2 pr-3">Deal</th>
                    <th className="py-2 pr-3">Value</th>
                    <th className="py-2 pr-3">Enrolled</th>
                    <th className="py-2 pr-3">Won</th>
                    <th className="py-2 pr-3">Days to win</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.attribution.items.map((d) => {
                    const enrolledAt = new Date(d.enrolledAt);
                    const wonAt = new Date(d.wonAt);
                    const days = Math.max(0, Math.round((wonAt.getTime() - enrolledAt.getTime()) / 86400_000));
                    return (
                      <tr key={`${d.dealId}`} className="border-t border-border/40">
                        <td className="py-2 pr-3 font-mono text-[10px]">{d.dealId.slice(0, 8)}…</td>
                        <td className="py-2 pr-3">{formatCurrency(d.value, d.currency)}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{enrolledAt.toLocaleDateString()}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{wonAt.toLocaleDateString()}</td>
                        <td className="py-2 pr-3 tabular-nums">{days}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </ContentContainer>
  );
}
