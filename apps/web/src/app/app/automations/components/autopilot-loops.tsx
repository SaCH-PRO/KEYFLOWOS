"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  Play,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  CreditCard,
  UserCheck,
  ShoppingBag,
  CalendarCheck,
  Sparkles,
} from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

interface DelegationLoop {
  id: string;
  loopType: string;
  name: string;
  description: string | null;
  enabled: boolean;
  riskTier: number;

  config: Record<string, unknown>;
  stats: { totalRuns?: number; totalActionsCreated?: number; totalItemsMatched?: number } | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  intervalMin: number;
  runs: LoopRun[];
}

interface LoopRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  itemsScanned: number;
  itemsMatched: number;
  actionsCreated: number;
  actionsBlocked: number;
  error: string | null;
}

const LOOP_ICONS: Record<string, typeof CreditCard> = {
  payment_recovery: CreditCard,
  lead_reactivation: UserCheck,
  post_purchase: ShoppingBag,
  booking_prep: CalendarCheck,
  weekly_hygiene: Sparkles,
};

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Auto", color: "text-emerald-400" },
  2: { label: "Confirm", color: "text-amber-400" },
  3: { label: "Approve", color: "text-red-400" },
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatInterval(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function AutopilotLoops({ businessId }: { businessId: string | null }) {
  const [loops, setLoops] = useState<DelegationLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLoop, setExpandedLoop] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, LoopRun[]>>({});
  const [runningLoops, setRunningLoops] = useState<Set<string>>(new Set());
  const [togglingLoops, setTogglingLoops] = useState<Set<string>>(new Set());

  const fetchLoops = useCallback(async () => {
    if (!businessId) return;
    try {
      setError(null);
      const res = await apiGet<DelegationLoop[]>(`/autopilot/businesses/${businessId}/loops`);
      if (res.data) setLoops(res.data);
      if (res.error) setError(res.error);
    } catch {
      setError("Failed to load delegation loops");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchLoops();
  }, [fetchLoops]);

  const toggleLoop = async (loopId: string, enabled: boolean) => {
    if (!businessId) return;
    setTogglingLoops((prev) => new Set(prev).add(loopId));
    try {
      const res = await apiPatch<DelegationLoop>(`/autopilot/businesses/${businessId}/loops/${loopId}`, { enabled });
      if (res.data) {
        setLoops((prev) => prev.map((l) => (l.id === loopId ? { ...l, ...res.data! } : l)));
      }
    } catch {
      setError("Failed to toggle loop");
    } finally {
      setTogglingLoops((prev) => {
        const next = new Set(prev);
        next.delete(loopId);
        return next;
      });
    }
  };

  const runNow = async (loopId: string) => {
    if (!businessId) return;
    setRunningLoops((prev) => new Set(prev).add(loopId));
    try {
      await apiPost<{ runId: string; status: string; itemsMatched: number; actionsCreated: number }>({
        path: `/autopilot/businesses/${businessId}/loops/${loopId}/run`,
        body: {},
      });
      await fetchLoops();
    } catch {
      setError("Failed to run loop");
    } finally {
      setRunningLoops((prev) => {
        const next = new Set(prev);
        next.delete(loopId);
        return next;
      });
    }
  };

  const loadHistory = async (loopId: string) => {
    if (!businessId) return;
    if (expandedLoop === loopId) {
      setExpandedLoop(null);
      return;
    }
    setExpandedLoop(loopId);
    try {
      const res = await apiGet<LoopRun[]>(`/autopilot/businesses/${businessId}/loops/${loopId}/runs?limit=10`);
      if (res.data) {
        setRunHistory((prev) => ({ ...prev, [loopId]: res.data! }));
      }
    } catch {
      setError("Failed to load run history");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loops.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        No delegation loops available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
          <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400/70 hover:text-red-400">×</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-medium text-foreground">Delegation Loops</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pre-built automation cycles that scan, match, and create tasks — governed by your AI tier settings.
          </p>
        </div>
        <button
          onClick={fetchLoops}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-card border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {loops.map((loop) => {
        const Icon = LOOP_ICONS[loop.loopType] || Sparkles;
        const tier = TIER_LABELS[loop.riskTier] || TIER_LABELS[2];
        const stats = loop.stats || {};
        const isRunning = runningLoops.has(loop.id);
        const isToggling = togglingLoops.has(loop.id);
        const isExpanded = expandedLoop === loop.id;
        const history = runHistory[loop.id] || [];

        return (
          <div
            key={loop.id}
            className="rounded-lg border border-border bg-card overflow-hidden"
          >
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5 p-2 rounded-md bg-muted/50 border border-border">
                  <Icon className="h-4 w-4 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-foreground truncate">{loop.name}</h4>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${tier.color}`}>
                      <Shield className="h-2.5 w-2.5" />
                      Tier {loop.riskTier} · {tier.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{loop.description}</p>

                  <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {loop.lastRunAt ? formatRelativeTime(loop.lastRunAt) : "Never run"}
                    </span>
                    <span>Every {formatInterval(loop.intervalMin)}</span>
                    {(stats.totalRuns ?? 0) > 0 && (
                      <>
                        <span>{stats.totalRuns} run{(stats.totalRuns ?? 0) !== 1 ? "s" : ""}</span>
                        <span>{stats.totalActionsCreated ?? 0} actions</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => runNow(loop.id)}
                    disabled={isRunning}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                  >
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Run
                  </button>

                  <button
                    onClick={() => toggleLoop(loop.id, !loop.enabled)}
                    disabled={isToggling}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      loop.enabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform ${
                        loop.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => loadHistory(loop.id)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border bg-muted/30 px-4 py-3">
                <h5 className="text-xs font-medium text-muted-foreground mb-2">Recent Runs</h5>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No runs recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {history.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-card border border-border"
                      >
                        {run.status === "completed" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                        ) : run.status === "failed" ? (
                          <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                        ) : (
                          <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin flex-shrink-0" />
                        )}
                        <span className="text-muted-foreground">{formatRelativeTime(run.startedAt)}</span>
                        <span className="text-foreground">{run.itemsMatched} matched</span>
                        <span className="text-primary">{run.actionsCreated} actions</span>
                        {run.actionsBlocked > 0 && (
                          <span className="text-amber-400">{run.actionsBlocked} blocked</span>
                        )}
                        {run.error && (
                          <span className="text-red-400 truncate max-w-[200px]">{run.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
