"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  GitPullRequest,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { fetchProjectMissionControl, type ProjectMissionControlSnapshot } from "@/lib/api/admin-analytics";

function EvidenceBar({
  completed,
  total,
  basis,
}: {
  completed: number | null;
  total: number | null;
  basis: string;
}) {
  if (completed === null || total === null || total <= 0) {
    return (
      <div>
        <div className="flex items-center justify-between text-xs">
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
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Evidence progress</span>
        <span className="font-mono">{completed}/{total}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{basis}</p>
    </div>
  );
}

const healthTone: Record<string, string> = {
  GREEN: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  YELLOW: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  RED: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  STALE: "text-orange-300 border-orange-500/30 bg-orange-500/10",
  UNKNOWN: "text-slate-300 border-slate-500/30 bg-slate-500/10",
};

export default function MissionControlPage() {
  const [snapshot, setSnapshot] = useState<ProjectMissionControlSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchProjectMissionControl();
    if (res.error || !res.data) {
      setError(res.error || "Mission Control unavailable");
      setSnapshot(null);
    } else {
      setSnapshot(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const checkTotals = useMemo(() => {
    if (!snapshot) return { pass: 0, fail: 0, pending: 0 };
    const checks = snapshot.pullRequests.flatMap((pr) => pr.checks);
    return {
      pass: checks.filter((c) => c.status === "PASS").length,
      fail: checks.filter((c) => c.status === "FAIL").length,
      pending: checks.filter((c) => c.status === "PENDING" || c.status === "UNKNOWN").length,
    };
  }, [snapshot]);

  if (loading && !snapshot) {
    return <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (error || !snapshot) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-8 text-center">
        <AlertTriangle className="w-6 h-6 mx-auto text-rose-300" />
        <p className="mt-3 text-sm">{error || "Mission Control unavailable"}</p>
        <button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border/60 bg-slate-950/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">KEYFLOWOS</div>
            <h1 className="mt-1 text-2xl font-semibold">Mission Control</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only programme truth from live GitHub evidence. No mutation controls are exposed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Programme health</div>
            <div className={`mt-1 inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${healthTone[snapshot.health]}`}>
              {snapshot.health}
            </div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Main</div>
            <div className="mt-2 font-mono text-xs">{snapshot.sourceMain?.slice(0, 10) ?? "UNKNOWN"}</div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Checks passing</div>
            <div className="mt-2 text-lg font-semibold">{checkTotals.pass}</div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Checks failing</div>
            <div className="mt-2 text-lg font-semibold text-rose-300">{checkTotals.fail}</div>
          </div>
          <div className="rounded-xl border border-border/50 p-3">
            <div className="text-[10px] text-muted-foreground">Pending/unknown</div>
            <div className="mt-2 text-lg font-semibold text-amber-300">{checkTotals.pending}</div>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-muted-foreground">
          Source: {snapshot.repository} · Generated {new Date(snapshot.generatedAt).toLocaleString()} · GitHub {snapshot.freshness.github}
        </div>
      </section>

      {snapshot.blockers.length > 0 && (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <AlertTriangle className="w-4 h-4" /> Current blockers
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.blockers.map((blocker, i) => (
              <div key={`${blocker.source}-${i}`} className="text-xs">
                <span className="font-mono text-amber-200">{blocker.source}</span>
                <span className="text-muted-foreground"> — {blocker.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Programme workstreams</h2>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {snapshot.workstreams.map((stream) => (
            <div key={stream.id} className="rounded-2xl border border-border/50 bg-card/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{stream.label}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">{stream.phase} · {stream.status}</p>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {stream.pullRequest ? `PR #${stream.pullRequest}` : stream.issue ? `#${stream.issue}` : "NO PR"}
                </div>
              </div>
              <div className="mt-4"><EvidenceBar {...stream.progress} /></div>
              <div className="mt-4 rounded-xl bg-slate-900/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next legal action</div>
                <p className="mt-1 text-xs">{stream.nextLegalAction}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Exact-head proof rail</h2>
        </div>
        <div className="space-y-3">
          {snapshot.pullRequests.map((pr) => (
            <div key={pr.number} className="rounded-2xl border border-border/50 bg-card/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">PR #{pr.number}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${healthTone[pr.health]}`}>{pr.health}</span>
                  </div>
                  <h3 className="mt-1 text-sm font-medium">{pr.title}</h3>
                  <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                    {pr.branch ?? "UNKNOWN BRANCH"} · {pr.headSha?.slice(0, 12) ?? "UNKNOWN HEAD"}
                  </div>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <div>{pr.draft ? "DRAFT" : "READY FOR REVIEW"}</div>
                  <div>mergeable: {pr.mergeable === null ? "UNKNOWN" : String(pr.mergeable)}</div>
                </div>
              </div>
              <div className="mt-4"><EvidenceBar {...pr.proof} /></div>
              <div className="mt-4 flex flex-wrap gap-2">
                {pr.checks.map((check, i) => (
                  <span
                    key={`${check.name}-${i}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[10px]"
                  >
                    {check.status === "PASS" ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> :
                     check.status === "FAIL" ? <AlertTriangle className="w-3 h-3 text-rose-300" /> :
                     <CircleDot className="w-3 h-3 text-amber-300" />}
                    {check.name}: {check.status}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/50 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Worker/session lanes</h2>
        </div>
        {snapshot.workers.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No trustworthy packet-scoped heartbeat source is wired yet. Mission Control intentionally shows this as unknown rather than inferring workers from comments.
          </p>
        ) : null}
      </section>
    </div>
  );
}
