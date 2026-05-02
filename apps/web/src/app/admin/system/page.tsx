"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  Database,
  Layers,
  Globe,
  GitBranch,
  Settings2,
  Play,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: CheckStatus;
  latencyMs: number;
  checkedAt: string;
  message?: string;
  detail?: string;
}

interface CategoryResult {
  category: string;
  checks: CheckResult[];
  overallStatus: CheckStatus;
}

interface DiagnosticsReport {
  runAt: string;
  durationMs: number;
  overallStatus: CheckStatus;
  healthScore: number;
  categories: CategoryResult[];
}

interface ReleaseInfo {
  webCommit: string;
  apiCommit: string;
  webNodeVersion: string;
  apiNodeVersion: string;
  uptimeSec: number;
}

const CATEGORY_SLUG_MAP: Record<string, string> = {
  "Infrastructure": "infrastructure",
  "Modules": "modules",
  "Integrations": "integrations",
  "Cross-Module Flows": "cross-module",
  "Environment Variables": "env-vars",
};

async function apiFull(): Promise<DiagnosticsReport> {
  const res = await fetch(`${API_BASE}/api/diagnostics/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiCategory(slug: string): Promise<CategoryResult> {
  const res = await fetch(`${API_BASE}/api/diagnostics/${slug}`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiCheck(checkName: string): Promise<CheckResult> {
  const res = await fetch(
    `${API_BASE}/api/diagnostics/check/${encodeURIComponent(checkName)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchReleaseInfo(): Promise<ReleaseInfo> {
  // /api/healthz proxies the api's /readyz internally and reports both sides'
  // commit + node version. Fetch the web side directly and the api side
  // directly so we can show both.
  const [webRes, apiRes] = await Promise.all([
    fetch("/api/healthz", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    fetch(`${API_BASE}/healthz`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  ]);
  return {
    webCommit: webRes?.commit ?? "unknown",
    apiCommit: apiRes?.commit ?? "unknown",
    webNodeVersion: webRes?.nodeVersion ?? "",
    apiNodeVersion: apiRes?.nodeVersion ?? "",
    uptimeSec: Math.max(webRes?.uptimeSec ?? 0, apiRes?.uptimeSec ?? 0),
  };
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

const STATUS_CONFIG: Record<
  CheckStatus,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bg: string;
    border: string;
    label: string;
  }
> = {
  pass: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-400/40",
    label: "Healthy",
  },
  warn: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-400/40",
    label: "Warning",
  },
  fail: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-400/40",
    label: "Failing",
  },
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Infrastructure": Database,
  "Modules": Layers,
  "Integrations": Globe,
  "Cross-Module Flows": GitBranch,
  "Environment Variables": Settings2,
};

function StatusBadge({ status, small }: { status: CheckStatus; small?: boolean }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        cfg.bg,
        cfg.border,
        cfg.color,
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
      )}
    >
      <Icon className={small ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {cfg.label}
    </span>
  );
}

function CheckRow({
  check,
  supportsRerun,
  onRerun,
}: {
  check: CheckResult;
  supportsRerun: boolean;
  onRerun: (name: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const cfg = STATUS_CONFIG[check.status];
  const Icon = cfg.icon;

  const handleRerun = async () => {
    setRunning(true);
    try {
      await onRerun(check.name);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={cn("rounded-xl border p-3 space-y-1 transition-colors", cfg.border, cfg.bg)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", cfg.color)} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground truncate">{check.name}</div>
            {check.message && (
              <div className="text-[11px] text-muted-foreground mt-0.5">{check.message}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {check.latencyMs > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {check.latencyMs}ms
            </span>
          )}
          {supportsRerun && (
            <button
              onClick={handleRerun}
              disabled={running}
              title="Re-run this check"
              className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
            >
              <Play className={cn("w-3 h-3", running && "animate-pulse")} />
            </button>
          )}
          {check.detail && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      {expanded && check.detail && (
        <pre className="text-[10px] text-red-300 bg-red-950/40 rounded-lg p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-words">
          {check.detail}
        </pre>
      )}
    </div>
  );
}

function CategoryCard({
  cat,
  onCategoryUpdate,
}: {
  cat: CategoryResult;
  onCategoryUpdate: (updated: CategoryResult) => void;
}) {
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [checkRunning, setCheckRunning] = useState<string | null>(null);
  const Icon = CATEGORY_ICONS[cat.category] ?? Activity;
  const cfg = STATUS_CONFIG[cat.overallStatus];

  const passCount = cat.checks.filter((c) => c.status === "pass").length;
  const warnCount = cat.checks.filter((c) => c.status === "warn").length;
  const failCount = cat.checks.filter((c) => c.status === "fail").length;

  const slug = CATEGORY_SLUG_MAP[cat.category];

  const handleRefreshCategory = async () => {
    if (!slug) return;
    setRunning(true);
    try {
      const updated = await apiCategory(slug);
      onCategoryUpdate(updated);
    } catch {
    } finally {
      setRunning(false);
    }
  };

  const handleRerunCheck = async (checkName: string) => {
    setCheckRunning(checkName);
    try {
      const updated = await apiCheck(checkName);
      const updatedChecks = cat.checks.map((c) => (c.name === checkName ? updated : c));
      onCategoryUpdate({
        ...cat,
        checks: updatedChecks,
        overallStatus: worstStatus(updatedChecks.map((c) => c.status)),
      });
    } catch {
    } finally {
      setCheckRunning(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-slate-950/70 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <button
          className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity"
          onClick={() => setOpen(!open)}
        >
          <div className={cn("rounded-xl p-2", cfg.bg, cfg.border, "border")}>
            <Icon className={cn("w-4 h-4", cfg.color)} />
          </div>
          <div>
            <div className="text-sm font-semibold">{cat.category}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
              {passCount > 0 && <span className="text-emerald-400">{passCount} passing</span>}
              {warnCount > 0 && <span className="text-amber-400">{warnCount} warning</span>}
              {failCount > 0 && <span className="text-red-400">{failCount} failing</span>}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <StatusBadge status={cat.overallStatus} small />
          {slug && (
            <button
              onClick={handleRefreshCategory}
              disabled={running}
              title={`Re-run ${cat.category} checks`}
              className={cn(
                "rounded-lg border px-2 py-1 text-[11px] font-medium transition-all",
                running
                  ? "border-border/40 text-muted-foreground cursor-not-allowed"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <RefreshCw className={cn("w-3 h-3", running && "animate-spin")} />
            </button>
          )}
          <button onClick={() => setOpen(!open)} className="text-muted-foreground">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-5 pb-4 space-y-2 border-t border-border/50 pt-3">
          {cat.checks.map((check) => (
            <CheckRow
              key={check.name}
              check={check}
              supportsRerun={checkRunning !== check.name}
              onRerun={handleRerunCheck}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HealthScoreRing({ score, status }: { score: number; status: CheckStatus }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="100" height="100" className="-rotate-90">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-slate-800"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeDasharray={`${progress} ${circumference}`}
          strokeLinecap="round"
          className={cn(
            "transition-all duration-700",
            status === "pass"
              ? "text-emerald-400"
              : status === "warn"
              ? "text-amber-400"
              : "text-red-400",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-bold", cfg.color)}>{score}</span>
        <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Score</span>
      </div>
    </div>
  );
}

export default function AdminSystem() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReleaseInfo()
      .then((info) => {
        if (!cancelled) setRelease(info);
      })
      .catch(() => {
        // Silent — the release strip is informational; failure leaves it
        // hidden rather than blocking the diagnostics page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFull();
      setReport(result);
      setLastRun(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to run diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCategoryUpdate = useCallback(
    (updated: CategoryResult) => {
      setReport((prev) => {
        if (!prev) return prev;
        const categories = prev.categories.map((c) =>
          c.category === updated.category ? updated : c,
        );
        const allChecks = categories.flatMap((c) => c.checks);
        const passCount = allChecks.filter((c) => c.status === "pass").length;
        const healthScore = Math.round((passCount / allChecks.length) * 100);
        const overallStatus = worstStatus(categories.map((c) => c.overallStatus));
        return { ...prev, categories, healthScore, overallStatus };
      });
    },
    [],
  );

  const overallCfg = report ? STATUS_CONFIG[report.overallStatus] : null;
  const allChecks = report?.categories.flatMap((c) => c.checks) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time diagnostics across all platform modules, infrastructure, and integrations.
          </p>
        </div>
        <button
          onClick={runDiagnostics}
          disabled={loading}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
            loading
              ? "border-border/40 bg-slate-900/40 text-muted-foreground cursor-not-allowed"
              : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/70",
          )}
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          {loading ? "Running…" : "Run Full Diagnostic"}
        </button>
      </div>

      {release && (
        <div className="rounded-xl border border-border/60 bg-slate-950/50 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Tag className="w-3.5 h-3.5 text-primary/80" />
            <span className="uppercase tracking-wider">Release</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Web</span>
            <code
              className={cn(
                "font-mono px-1.5 py-0.5 rounded border",
                release.webCommit === "unknown"
                  ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
                  : "border-border/60 bg-slate-900/60 text-foreground",
              )}
              title={release.webCommit}
            >
              {release.webCommit.slice(0, 12)}
            </code>
            {release.webNodeVersion && (
              <span className="text-muted-foreground">{release.webNodeVersion}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">API</span>
            <code
              className={cn(
                "font-mono px-1.5 py-0.5 rounded border",
                release.apiCommit === "unknown"
                  ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
                  : "border-border/60 bg-slate-900/60 text-foreground",
              )}
              title={release.apiCommit}
            >
              {release.apiCommit.slice(0, 12)}
            </code>
            {release.apiNodeVersion && (
              <span className="text-muted-foreground">{release.apiNodeVersion}</span>
            )}
          </div>
          {release.webCommit !== "unknown" &&
            release.apiCommit !== "unknown" &&
            release.webCommit !== release.apiCommit && (
              <span className="text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Web and API are on different builds
              </span>
            )}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-300">
          <div className="font-medium mb-1">Diagnostic Failed</div>
          <div className="text-xs opacity-80">{error}</div>
        </div>
      )}

      {!report && !loading && !error && (
        <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-10 flex flex-col items-center justify-center text-center gap-4">
          <div className="rounded-2xl border border-border/60 bg-slate-900/60 p-4">
            <Activity className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">No diagnostic data yet</div>
            <div className="text-xs text-muted-foreground mt-1">
              Click &ldquo;Run Full Diagnostic&rdquo; to check all systems
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 flex flex-col items-center justify-center text-center gap-3">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          <div>
            <div className="text-sm font-medium text-primary">Running diagnostics&hellip;</div>
            <div className="text-xs text-muted-foreground mt-1">
              Checking all modules and integrations
            </div>
          </div>
        </div>
      )}

      {report && !loading && (
        <>
          <div
            className={cn(
              "rounded-2xl border p-5 flex items-center gap-5",
              overallCfg!.border,
              overallCfg!.bg,
            )}
          >
            <HealthScoreRing score={report.healthScore} status={report.overallStatus} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base font-semibold">Overall System Health</span>
                <StatusBadge status={report.overallStatus} />
              </div>
              <div className="text-sm text-muted-foreground">
                {report.categories.length} categories &middot; {allChecks.length} checks &middot;
                completed in {report.durationMs}ms
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs">
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {allChecks.filter((c) => c.status === "pass").length} passing
                </span>
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {allChecks.filter((c) => c.status === "warn").length} warnings
                </span>
                <span className="text-red-400 flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {allChecks.filter((c) => c.status === "fail").length} failing
                </span>
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <div>Last run</div>
              <div className="font-medium text-foreground mt-0.5">{lastRun}</div>
            </div>
          </div>

          <div className="space-y-3">
            {report.categories.map((cat) => (
              <CategoryCard
                key={cat.category}
                cat={cat}
                onCategoryUpdate={handleCategoryUpdate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
