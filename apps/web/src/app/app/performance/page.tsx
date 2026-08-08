"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Camera, ChevronDown, ChevronRight, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { StandardModuleLayout } from "@/components/ui/standard-module-layout";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { Button, Input } from "@keyflow/ui";
import {
  scorecard as fetchScorecard,
  takeSnapshot,
  teamSummary,
  trend as fetchTrend,
  type Scorecard,
  type TrendPoint,
} from "@/lib/api/staff-performance";

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function toDateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentMonthPeriod() {
  const now = new Date();
  return {
    periodStart: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    periodEnd: toDateInputValue(now),
  };
}

function scoreColor(score: number) {
  if (score >= 80) return "hsl(var(--kf-success))";
  if (score >= 60) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-error))";
}

export default function PerformancePage() {
  const businessId = getStoredBusinessId();

  const [period, setPeriod] = useState(currentMonthPeriod);
  const [team, setTeam] = useState<Scorecard[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Scorecard | null>(null);
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await teamSummary(businessId, period);
    if (error) toast.error(error);
    else if (data) setTeam(data);
    setLoading(false);
  }, [businessId, period]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const selectStaff = async (assignmentId: string) => {
    if (!businessId) return;
    if (selectedId === assignmentId) {
      setSelectedId(null);
      setDetail(null);
      setTrendPoints([]);
      return;
    }
    setSelectedId(assignmentId);
    setDetailLoading(true);
    setDetail(null);
    setTrendPoints([]);
    const [cardRes, trendRes] = await Promise.all([
      fetchScorecard(businessId, assignmentId, period),
      fetchTrend(businessId, assignmentId),
    ]);
    if (cardRes.error) toast.error(cardRes.error);
    else if (cardRes.data) setDetail(cardRes.data);
    if (trendRes.error) toast.error(trendRes.error);
    else if (trendRes.data) setTrendPoints(trendRes.data);
    setDetailLoading(false);
  };

  const handleSnapshot = async () => {
    if (!businessId || !selectedId) return;
    setSnapshotLoading(true);
    const { error } = await takeSnapshot(businessId, {
      assignmentId: selectedId,
      periodStart: new Date(period.periodStart).toISOString(),
      periodEnd: new Date(period.periodEnd).toISOString(),
    });
    if (error) toast.error(error);
    else {
      toast.success("Snapshot saved");
      const trendRes = await fetchTrend(businessId, selectedId);
      if (trendRes.data) setTrendPoints(trendRes.data);
    }
    setSnapshotLoading(false);
  };

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={period.periodStart}
        onChange={(e) => setPeriod((p) => ({ ...p, periodStart: e.target.value }))}
        className="w-36"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="date"
        value={period.periodEnd}
        onChange={(e) => setPeriod((p) => ({ ...p, periodEnd: e.target.value }))}
        className="w-36"
      />
      <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} className="gap-1">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        Refresh
      </Button>
    </div>
  );

  return (
    <StandardModuleLayout
      workspace="team"
      icon={Activity}
      title="Performance"
      subtitle="Team scorecards from tasks, logged hours, and approval responsiveness."
      headerRight={headerRight}
    >
      <div className="space-y-4">
        <SectionCard
          title="Team summary"
          subtitle={`${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)} · click a row for detail`}
          icon={Activity}
          noPadding
        >
          {loading && team.length === 0 ? (
            <div className="p-4">
              <SkeletonList rows={5} cols={5} />
            </div>
          ) : team.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No staff assignments"
              description="Performance scorecards are computed for active staff positions in your org structure."
              variant="compact"
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs w-8" />
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Staff</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Tasks done</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">On-time</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Utilization</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs">Overall score</th>
                </tr>
              </thead>
              <tbody>
                {team.map((card) => {
                  const onTimePct = card.tasksAssigned > 0 ? Math.round((card.tasksOnTime / card.tasksAssigned) * 100) : null;
                  return (
                    <tr
                      key={card.assignmentId}
                      onClick={() => selectStaff(card.assignmentId)}
                      className="border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {selectedId === card.assignmentId ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">{card.staffName}</td>
                      <td className="px-4 py-3 text-right">
                        {card.tasksCompleted}/{card.tasksAssigned}
                      </td>
                      <td className="px-4 py-3 text-right">{onTimePct === null ? "—" : `${onTimePct}%`}</td>
                      <td className="px-4 py-3 text-right">{card.utilizationPct}%</td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold" style={{ color: scoreColor(card.overallScore) }}>
                          {card.overallScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SectionCard>

        {selectedId && (
          <SectionCard
            title={detail ? `${detail.staffName} — scorecard` : "Scorecard"}
            subtitle={`${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)}`}
            icon={TrendingUp}
            headerRight={
              <Button variant="outline" size="sm" onClick={handleSnapshot} disabled={snapshotLoading || !detail} className="gap-1">
                {snapshotLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                Save snapshot
              </Button>
            }
          >
            {detailLoading ? (
              <SkeletonList rows={4} cols={3} />
            ) : detail ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Metric label="Overall score" value={String(detail.overallScore)} />
                  <Metric label="Tasks completed" value={`${detail.tasksCompleted}/${detail.tasksAssigned}`} />
                  <Metric label="On time" value={String(detail.tasksOnTime)} />
                  <Metric label="Overdue open" value={String(detail.tasksOverdueOpen)} />
                  <Metric label="Hours worked" value={detail.hoursWorked.toFixed(1)} />
                  <Metric label="Expected hours" value={String(detail.expectedHours)} />
                  <Metric label="Utilization" value={`${detail.utilizationPct}%`} />
                  <Metric
                    label="Avg approval response"
                    value={detail.avgApprovalResponseHours === null ? "—" : `${detail.avgApprovalResponseHours}h`}
                  />
                </div>

                <div>
                  <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> Trend (snapshots)
                  </h4>
                  {trendPoints.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No snapshots yet — save one to start tracking this trend.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {trendPoints.map((point) => (
                        <div
                          key={`${point.periodStart}-${point.periodEnd}`}
                          className="flex items-center gap-3 text-sm rounded-lg border border-border/40 px-3 py-2"
                        >
                          <span className="text-muted-foreground text-xs flex-1">
                            {formatDate(point.periodStart)} – {formatDate(point.periodEnd)}
                          </span>
                          <Badge variant="outline">{point.tasksOnTime}/{point.tasksAssigned} on time</Badge>
                          <Badge variant="outline">{point.utilizationPct}% util</Badge>
                          <span className="font-semibold w-8 text-right" style={{ color: scoreColor(point.overallScore) }}>
                            {point.overallScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Scorecard unavailable.</p>
            )}
          </SectionCard>
        )}
      </div>
    </StandardModuleLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
