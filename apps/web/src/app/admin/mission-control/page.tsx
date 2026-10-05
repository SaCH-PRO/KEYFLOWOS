"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Code2,
  GitBranch,
  GitPullRequest,
  Layers3,
  Loader2,
  Network,
  RefreshCw,
  Route,
  ShieldCheck,
} from "lucide-react";
import {
  fetchProjectMissionControl,
  type MissionControlProgress,
  type ProjectMissionControlSnapshot,
} from "@/lib/api/admin-analytics";

const healthTone: Record<string, string> = {
  GREEN: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  FRESH: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  MAPPED: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  CONSISTENT: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  YELLOW: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  PARTIAL: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  CONTRADICTED: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  RED: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  STALE: "text-orange-300 border-orange-500/30 bg-orange-500/10",
  UNKNOWN: "text-slate-300 border-slate-500/30 bg-slate-500/10",
  UNVERIFIED: "text-slate-300 border-slate-500/30 bg-slate-500/10",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${healthTone[status] ?? healthTone.UNKNOWN}`}
    >
      {status}
    </span>
  );
}

function EvidenceBar({ completed, total, basis }: MissionControlProgress) {
  if (completed === null || total === null || total <= 0) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">Evidence progress</span>
          <span className="font-mono text-amber-300">UNKNOWN / UNBOUNDED</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-slate-800" />
        <p className="mt-1 text-[10px] text-muted-foreground">{basis}</p>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Evidence progress</span>
        <span className="font-mono">
          {completed}/{total}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{basis}</p>
    </div>
  );
}

function CountCard({
  label,
  named,
  claimed,
  status,
}: {
  label: string;
  named: number | null;
  claimed: number | null;
  status: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <StatusPill status={status} />
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-2xl font-semibold">{named ?? "?"}</span>
        <span className="pb-1 text-xs text-muted-foreground">named</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        durable state claim: <span className="font-mono text-foreground">{claimed ?? "UNKNOWN"}</span>
      </div>
    </div>
  );
}

export default function MissionControlPage() {
  const [snapshot, setSnapshot] = useState<ProjectMissionControlSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchProjectMissionControl();
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const checkTotals = useMemo(() => {
    const checks = snapshot?.pullRequests.flatMap((pullRequest) => pullRequest.checks) ?? [];
    return {
      pass: checks.filter((check) => check.status === "PASS").length,
      fail: checks.filter((check) => check.status === "FAIL").length,
      pending: checks.filter(
        (check) => check.status === "PENDING" || check.status === "UNKNOWN",
      ).length,
    };
  }, [snapshot]);

  if (!snapshot && loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Mission Control evidence…
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-rose-200">
          <AlertTriangle className="h-4 w-4" />
          Mission Control unavailable
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{error ?? "No snapshot returned."}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </section>
    );
  }

  const atlas = snapshot.atlas;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-primary/20 bg-card/40 p-5 shadow-2xl shadow-black/10">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-primary">
              <Network className="h-4 w-4" />
              Owner Mission Control
            </div>
            <h1 className="mt-2 text-2xl font-semibold">KEYFLOWOS Living System Control Panel</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Read-only programme truth from exact-head GitHub evidence and the Living System Atlas.
              Contradictions, missing artifacts, stale proof, and unknown denominators stay visible.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-sm disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Programme health</div>
            <div className="mt-2">
              <StatusPill status={snapshot.health} />
            </div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Atlas truth</div>
            <div className="mt-2">
              <StatusPill status={atlas.status} />
            </div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Main</div>
            <div className="mt-2 font-mono text-xs">{snapshot.sourceMain?.slice(0, 10) ?? "UNKNOWN"}</div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Checks passing</div>
            <div className="mt-2 text-lg font-semibold text-emerald-300">{checkTotals.pass}</div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Checks failing</div>
            <div className="mt-2 text-lg font-semibold text-rose-300">{checkTotals.fail}</div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Pending / unknown</div>
            <div className="mt-2 text-lg font-semibold text-amber-300">{checkTotals.pending}</div>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-muted-foreground">
          {snapshot.repository} · generated {new Date(snapshot.generatedAt).toLocaleString()} · GitHub{" "}
          {snapshot.freshness.github} · Atlas {snapshot.freshness.atlas}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">System Atlas truth</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CountCard label="Canonical journeys" {...atlas.journeyCount} />
          <CountCard label="Canonical kernels" {...atlas.kernelCount} />

          <div className="rounded-2xl border border-border/50 bg-card/30 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Route className="h-4 w-4" />
              Atlas graph
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <div className="text-xl font-semibold">{atlas.graph.nodes ?? "?"}</div>
                <div className="text-[10px] text-muted-foreground">nodes</div>
              </div>
              <div>
                <div className="text-xl font-semibold">{atlas.graph.edges ?? "?"}</div>
                <div className="text-[10px] text-muted-foreground">edges</div>
              </div>
            </div>
            <div className="mt-3 text-[10px] text-muted-foreground">
              schema: {atlas.schema ?? "UNKNOWN"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/30 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Code2 className="h-4 w-4" />
              Traceability
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Packet semantics</span>
                <span className="font-mono">{atlas.graph.packetSemanticPackets ?? "?"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Verified code links</span>
                <span className="font-mono">{atlas.graph.verifiedCodeLinks ?? "?"}</span>
              </div>
              <div className="pt-1">
                <StatusPill status={atlas.graph.packetSemanticStatus ?? "UNKNOWN"} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {atlas.layers.map((layer) => (
            <div key={layer.id} className="rounded-2xl border border-border/50 bg-card/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-[10px] text-primary">{layer.id}</div>
                  <div className="mt-1 text-xs font-medium">{layer.label}</div>
                </div>
                <StatusPill status={layer.status} />
              </div>
              <div className="mt-3">
                <EvidenceBar {...layer.progress} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {(snapshot.blockers.length > 0 || atlas.missingArtifacts.length > 0) && (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            Contradictions / blockers
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.blockers.map((blocker, index) => (
              <div key={`${blocker.source}-${index}`} className="text-xs">
                <span className="font-mono text-amber-200">{blocker.source}</span>
                <span className="text-muted-foreground"> — {blocker.detail}</span>
              </div>
            ))}
            {atlas.missingArtifacts.map((artifact) => (
              <div key={artifact} className="text-xs">
                <span className="font-mono text-amber-200">MISSING_ARTIFACT</span>
                <span className="text-muted-foreground"> — {artifact}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Active programme surfaces</h2>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {snapshot.workstreams.map((stream) => (
            <div key={stream.id} className="rounded-2xl border border-border/50 bg-card/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{stream.label}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {stream.phase}
                  </p>
                </div>
                <StatusPill status={stream.status} />
              </div>
              <div className="mt-4">
                <EvidenceBar {...stream.progress} />
              </div>
              <div className="mt-4 rounded-xl bg-slate-900/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Next legal action
                </div>
                <p className="mt-1 text-xs">{stream.nextLegalAction}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Exact-head proof rail</h2>
        </div>
        <div className="space-y-3">
          {snapshot.pullRequests.length === 0 ? (
            <div className="rounded-2xl border border-border/50 bg-card/20 p-4 text-xs text-muted-foreground">
              No live PR evidence is available. This is not counted as green.
            </div>
          ) : (
            snapshot.pullRequests.map((pullRequest) => (
              <div key={pullRequest.number} className="rounded-2xl border border-border/50 bg-card/30 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">PR #{pullRequest.number}</span>
                      <StatusPill status={pullRequest.health} />
                    </div>
                    <h3 className="mt-1 text-sm font-medium">{pullRequest.title}</h3>
                    <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      {pullRequest.branch ?? "UNKNOWN BRANCH"} ·{" "}
                      {pullRequest.headSha?.slice(0, 12) ?? "UNKNOWN HEAD"}
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground">
                    <div>{pullRequest.draft ? "DRAFT" : "READY FOR REVIEW"}</div>
                    <div>
                      mergeable:{" "}
                      {pullRequest.mergeable === null ? "UNKNOWN" : String(pullRequest.mergeable)}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <EvidenceBar {...pullRequest.proof} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {pullRequest.checks.map((check, index) => (
                    <span
                      key={`${check.name}-${index}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[10px]"
                    >
                      {check.status === "PASS" ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-300" />
                      ) : check.status === "FAIL" ? (
                        <AlertTriangle className="h-3 w-3 text-rose-300" />
                      ) : (
                        <CircleDot className="h-3 w-3 text-amber-300" />
                      )}
                      {check.name}: {check.status}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/50 bg-card/30 p-4">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">KEY cognition</h2>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The Living Atlas has reserved L4 for KEY cognition. Detailed cognitive topology stays
            UNVERIFIED here until its evidence graph is materialized; Mission Control will not infer a
            completion percentage from architecture prose.
          </p>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card/30 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Worker / session lanes</h2>
          </div>
          {snapshot.workers.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No trustworthy packet-scoped heartbeat projection is wired into this read model yet.
              Worker state remains unknown rather than inferred from comments or branch activity.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {snapshot.workers.map((worker) => (
                <div key={worker.id} className="rounded-xl border border-border/50 p-3 text-xs">
                  {worker.kind} · {worker.state} · {worker.packetId ?? "NO PACKET"}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
