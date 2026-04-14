"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, XCircle, Loader2,
  RefreshCw, Search, ChevronDown, ChevronUp,
  Activity,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAiExecutionLogs,
  fetchAiExecutionStats,
  type AiExecutionLogEntry,
  type AiExecutionStats,
} from "@/lib/client";

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/^(crm|commerce|bookings|marketing|social|automations)\s/i, "")
    .replace(/^./, (c) => c.toUpperCase());
}

const MODULE_COLORS: Record<string, string> = {
  crm: "text-blue-400 bg-blue-500/10",
  commerce: "text-emerald-400 bg-emerald-500/10",
  bookings: "text-purple-400 bg-purple-500/10",
  marketing: "text-pink-400 bg-pink-500/10",
  social: "text-cyan-400 bg-cyan-500/10",
  automations: "text-amber-400 bg-amber-500/10",
  planner: "text-indigo-400 bg-indigo-500/10",
};

function LogEntryRow({ entry }: { entry: AiExecutionLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const moduleColor = MODULE_COLORS[entry.module || ""] || "text-muted-foreground/60 bg-muted/30";

  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors text-left"
      >
        <div className="shrink-0">
          {entry.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground/90 truncate">
              {entry.toolName ? formatToolName(entry.toolName) : entry.action}
            </span>
            {entry.module && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${moduleColor}`}>
                {entry.module}
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              entry.riskTier <= 1 ? "bg-emerald-500/10 text-emerald-400" :
              entry.riskTier === 2 ? "bg-blue-500/10 text-blue-400" :
              entry.riskTier === 3 ? "bg-amber-500/10 text-amber-400" :
              "bg-red-500/10 text-red-400"
            }`}>
              T{entry.riskTier}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground/50">{formatTimeAgo(entry.createdAt)}</span>
            {entry.durationMs !== null && (
              <>
                <span className="text-[10px] text-muted-foreground/30">·</span>
                <span className="text-[10px] text-muted-foreground/50">{entry.durationMs}ms</span>
              </>
            )}
            <span className="text-[10px] text-muted-foreground/30">·</span>
            <span className="text-[10px] text-muted-foreground/50">{entry.mode}</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />}
      </button>

      {expanded && (
        <div className="px-10 pb-3 space-y-2">
          {entry.rationale && (
            <div className="text-[11px] text-muted-foreground/60">
              <span className="font-medium text-muted-foreground/70">Rationale:</span> {entry.rationale}
            </div>
          )}
          {entry.errorMessage && (
            <div className="text-[11px] text-red-400/80 bg-red-500/5 rounded-md px-2 py-1.5 border border-red-500/10">
              {entry.errorMessage}
            </div>
          )}
          {entry.actor && (
            <div className="text-[10px] text-muted-foreground/50">
              Actor: <span className="text-foreground/60">{entry.actor}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ExecutionHistoryProps {
  maxEntries?: number;
  showStats?: boolean;
  moduleFilter?: string;
}

export function ExecutionHistory({ maxEntries = 50, showStats = true, moduleFilter }: ExecutionHistoryProps) {
  const [logs, setLogs] = useState<AiExecutionLogEntry[]>([]);
  const [stats, setStats] = useState<AiExecutionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedModule, setSelectedModule] = useState<string>(moduleFilter || "");

  const loadData = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [logsRes, statsRes] = await Promise.all([
        fetchAiExecutionLogs(businessId, {
          module: selectedModule || undefined,
          limit: maxEntries,
        }),
        showStats ? fetchAiExecutionStats(businessId) : Promise.resolve({ data: null, error: null }),
      ]);
      if (logsRes.data) setLogs(logsRes.data);
      if (statsRes.data) setStats(statsRes.data);
    } catch {
      /* fail gracefully */
    } finally {
      setLoading(false);
    }
  }, [maxEntries, showStats, selectedModule]);

  useEffect(() => { loadData(); }, [loadData]);

  const modules = stats?.byModule?.map(m => m.module) ?? Array.from(new Set(logs.map(l => l.module).filter(Boolean))) as string[];

  const filtered = logs.filter(entry => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (entry.toolName && entry.toolName.toLowerCase().includes(term)) ||
      entry.action.toLowerCase().includes(term) ||
      (entry.rationale && entry.rationale.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-4">
      {showStats && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-border/30 bg-card/50">
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Total Actions</div>
            <div className="text-lg font-bold text-foreground/90">{stats.totalActions}</div>
          </div>
          <div className="p-3 rounded-xl border border-border/30 bg-card/50">
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Success Rate</div>
            <div className={`text-lg font-bold ${stats.successRate >= 90 ? "text-emerald-400" : stats.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
              {stats.successRate}%
            </div>
          </div>
          <div className="p-3 rounded-xl border border-border/30 bg-card/50">
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Top Module</div>
            <div className="text-sm font-semibold text-foreground/80">
              {stats.byModule.length > 0 ? stats.byModule.sort((a, b) => b.count - a.count)[0].module : "—"}
            </div>
          </div>
          <div className="p-3 rounded-xl border border-border/30 bg-card/50">
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Period</div>
            <div className="text-sm font-semibold text-foreground/80">{stats.period.days} days</div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            placeholder="Search actions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
          />
        </div>
        <select
          value={selectedModule}
          onChange={(e) => setSelectedModule(e.target.value)}
          className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-xs text-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
          aria-label="Filter by module"
        >
          <option value="">All modules</option>
          {modules.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
          aria-label="Refresh history"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
        </div>
      ) : (
        <div className="rounded-xl border border-border/30 bg-card/50 overflow-hidden">
          {filtered.length > 0 ? (
            filtered.map(entry => (
              <LogEntryRow key={entry.id} entry={entry} />
            ))
          ) : (
            <div className="flex flex-col items-center py-8 gap-2">
              <Activity className="w-6 h-6 text-muted-foreground/30" />
              <span className="text-xs text-muted-foreground/50">No execution history</span>
              <p className="text-[10px] text-muted-foreground/40 text-center max-w-[200px]">
                AI actions and their outcomes will be logged here
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
