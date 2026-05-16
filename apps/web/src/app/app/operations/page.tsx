"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Pause,
  Zap,
  Filter,
  Bot,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAgentHealth,
  fetchAiExecutionLogs,
  fetchUndoableActions,
  undoAction,
  type AiExecutionLogEntry,
} from "@/lib/client";

interface AgentStateItem {
  planId: string;
  businessId: string;
  state: string;
  currentStepAction?: string;
  progressPercent: number;
  startedAt?: string;
}

interface AgentTriggerItem {
  id: string;
  name: string;
  eventPattern: string;
  objective: string;
  enabled: boolean;
  autoExecute: boolean;
}

export default function OperationsPage() {
  const businessId = getStoredBusinessId();
  const [activeTab, setActiveTab] = useState<"live" | "history" | "triggers" | "patterns" | "undo" | "journeys">("live");
  const [loading, setLoading] = useState(true);
  const [agentStates, setAgentStates] = useState<AgentStateItem[]>([]);
  const [executionLogs, setExecutionLogs] = useState<AiExecutionLogEntry[]>([]);
  const [triggers, setTriggers] = useState<AgentTriggerItem[]>([]);
  const [undoableActions, setUndoableActions] = useState<Array<{ id: string; actionType: string; entityType: string; entityId: string; createdAt: string; canUndo: boolean }>>([]);
  const [health, setHealth] = useState<any>(null);
  const [filterModule, setFilterModule] = useState<string>("all");
  const [journeys, setJourneys] = useState<any[]>([]);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const [statesRes, logsRes, triggersRes, healthRes, undoRes, journeysRes] = await Promise.all([
        fetch(`/api/ai/businesses/${businessId}/agent/states`).then((r) => r.json()),
        fetchAiExecutionLogs(businessId, { limit: 50 }),
        fetch(`/api/ai/businesses/${businessId}/agent/triggers`).then((r) => r.json()),
        fetchAgentHealth(businessId),
        fetchUndoableActions(businessId),
        fetch(`/api/ai/businesses/${businessId}/journeys`).then((r) => r.json()),
      ]);
      if (Array.isArray(statesRes)) setAgentStates(statesRes);
      if (logsRes.data) setExecutionLogs(logsRes.data);
      if (Array.isArray(triggersRes)) setTriggers(triggersRes);
      if (healthRes.data) setHealth(healthRes.data);
      if (undoRes.data?.actions) setUndoableActions(undoRes.data.actions);
      if (journeysRes?.instances) setJourneys(journeysRes.instances);
    } catch {
      toast.error("Failed to load operations data");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
    refreshRef.current = setInterval(load, 10_000);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [load]);

  const filteredLogs = filterModule === "all"
    ? executionLogs
    : executionLogs.filter((l) => l.module === filterModule);

  const modules = Array.from(new Set(executionLogs.map((l) => l.module).filter((m): m is string => !!m)));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground/90">Operations Feed</h1>
            <p className="text-xs text-muted-foreground/60">Live view of AI agents, executions, and automations</p>
          </div>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Row */}
      {health && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Active Plans" value={health.plans?.executing ?? 0} color="text-blue-400" />
          <StatCard label="Completed Today" value={health.plans?.completedToday ?? 0} color="text-emerald-400" />
          <StatCard label="Failed" value={health.plans?.failed ?? 0} color="text-red-400" />
          <StatCard label="Success Rate" value={`${health.actions?.successRate ?? 100}%`} color="text-emerald-400" />
          <StatCard label="Actions Today" value={health.actions?.totalToday ?? 0} color="text-foreground/80" />
          <StatCard label="Pending Approvals" value={health.approvals?.pending ?? 0} color="text-amber-400" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center border-b border-border/30">
        {([
          { id: "live" as const, label: "Live Agents", icon: Zap },
          { id: "history" as const, label: "Execution History", icon: Clock },
          { id: "triggers" as const, label: "Triggers", icon: Bot },
          { id: "patterns" as const, label: "Patterns", icon: AlertTriangle },
          { id: "journeys" as const, label: "Journeys", icon: Activity },
          { id: "undo" as const, label: "Undo", icon: Undo2 },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
              activeTab === t.id
                ? "border-[hsl(var(--kf-accent1))] text-foreground/90"
                : "border-transparent text-muted-foreground/50 hover:text-foreground/70"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Live Agents */}
      {activeTab === "live" && (
        <div className="space-y-3">
          {agentStates.length === 0 ? (
            <EmptyState message="No active AI agents running right now" />
          ) : (
            agentStates.map((agent) => (
              <AgentStateCard key={agent.planId} agent={agent} />
            ))
          )}
        </div>
      )}

      {/* Execution History */}
      {activeTab === "history" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground/50" />
            <select
              value={filterModule}
              onChange={(e) => setFilterModule(e.target.value)}
              className="text-xs bg-muted/20 border border-border/30 rounded-lg px-2 py-1"
            >
              <option value="all">All modules</option>
              {modules.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          {filteredLogs.length === 0 ? (
            <EmptyState message="No execution logs yet" />
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log) => (
                <ExecutionLogRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Triggers */}
      {activeTab === "triggers" && (
        <div className="space-y-3">
          {triggers.length === 0 ? (
            <EmptyState message="No agent triggers configured" />
          ) : (
            triggers.map((trigger) => (
              <TriggerCard key={trigger.id} trigger={trigger} />
            ))
          )}
        </div>
      )}

      {/* Patterns */}
      {activeTab === "patterns" && (
        <PatternsPanel businessId={businessId} />
      )}

      {/* Journeys */}
      {activeTab === "journeys" && (
        <div className="space-y-3">
          {journeys.length === 0 ? (
            <EmptyState message="No active journeys. Journeys are triggered automatically when business events occur." />
          ) : (
            journeys.map((journey) => (
              <div key={journey.id} className="p-4 rounded-xl border border-border/30 bg-card/30">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{journey.templateKey}</div>
                    <div className="text-xs text-muted-foreground/60 mt-0.5">
                      Triggered by <code className="text-[10px] bg-muted/30 px-1 rounded">{journey.triggerEvent}</code>
                      {" · "}
                      Status: <span className="capitalize">{journey.status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      journey.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                      journey.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                      'bg-blue-500/10 text-blue-400'
                    }`}>
                      {journey.status}
                    </span>
                  </div>
                </div>
                {journey.plan && (
                  <div className="mt-2 text-xs text-muted-foreground/40">
                    Plan: {journey.plan.objective}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Undo */}
      {activeTab === "undo" && (
        <UndoPanel businessId={businessId} actions={undoableActions} onUndo={load} />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="p-3 rounded-xl border border-border/30 bg-card/30">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground/60 mt-0.5">{label}</div>
    </div>
  );
}

function AgentStateCard({ agent }: { agent: AgentStateItem }) {
  const stateColors: Record<string, string> = {
    executing: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    awaiting_input: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    paused: "bg-slate-500/10 text-slate-400 border-slate-500/30",
    completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/10 text-red-400 border-red-500/30",
    stalled: "bg-red-500/10 text-red-400 border-red-500/30",
  };

  const stateIcons: Record<string, typeof Zap> = {
    executing: Zap,
    awaiting_input: Clock,
    paused: Pause,
    completed: CheckCircle2,
    failed: XCircle,
    stalled: AlertTriangle,
  };

  const Icon = stateIcons[agent.state] ?? Zap;
  const colorClass = stateColors[agent.state] ?? stateColors.executing;

  return (
    <div className={`p-4 rounded-xl border ${colorClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className="w-4 h-4" />
          <div>
            <div className="text-sm font-semibold capitalize">{agent.state.replace(/_/g, " ")}</div>
            {agent.currentStepAction && (
              <div className="text-xs opacity-70">{agent.currentStepAction}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium">{agent.progressPercent}%</div>
          <div className="w-24 h-1.5 rounded-full bg-black/10 mt-1">
            <div
              className="h-full rounded-full bg-current transition-all"
              style={{ width: `${agent.progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionLogRow({ log }: { log: AiExecutionLogEntry }) {
  const isAuto = log.actor === "ai" || log.mode === "autonomous";
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border text-xs ${
      log.success
        ? "border-emerald-500/20 bg-emerald-500/5"
        : "border-red-500/20 bg-red-500/5"
    }`}>
      {log.success ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{log.action}</span>
          {log.toolName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground/60">
              {log.toolName}
            </span>
          )}
          {isAuto && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
              Auto
            </span>
          )}
        </div>
        {log.errorMessage && (
          <div className="text-red-400/70 mt-0.5">{log.errorMessage}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-muted-foreground/40">
          {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ""}
        </div>
        {log.durationMs && (
          <div className="text-[10px] text-muted-foreground/30">{log.durationMs}ms</div>
        )}
      </div>
    </div>
  );
}

function TriggerCard({ trigger }: { trigger: AgentTriggerItem }) {
  return (
    <div className="p-4 rounded-xl border border-border/30 bg-card/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{trigger.name}</div>
          <div className="text-xs text-muted-foreground/60 mt-0.5">
            On <code className="text-[10px] bg-muted/30 px-1 rounded">{trigger.eventPattern}</code>
            {" \u2192 "}
            {trigger.objective}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trigger.autoExecute && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
              Auto
            </span>
          )}
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
            trigger.enabled
              ? "bg-blue-500/10 text-blue-400"
              : "bg-muted/30 text-muted-foreground/50"
          }`}>
            {trigger.enabled ? "Active" : "Off"}
          </span>
        </div>
      </div>
    </div>
  );
}

function PatternsPanel({ businessId }: { businessId: string | null }) {
  const [patterns, setPatterns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPatterns = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/businesses/${businessId}/agent/patterns`);
      const data = await res.json();
      if (data.patterns) setPatterns(data.patterns);
    } catch {
      toast.error("Failed to load patterns");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  const runScan = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/businesses/${businessId}/agent/patterns/scan`, { method: "POST" });
      const data = await res.json();
      if (data.patterns) {
        setPatterns(data.patterns);
        toast.success(`Found ${data.patterns.length} patterns`);
      }
    } catch {
      toast.error("Scan failed");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { loadPatterns(); }, [loadPatterns]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Detected Patterns</span>
        <button
          onClick={runScan}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] text-xs font-medium hover:bg-[hsl(var(--kf-accent1))]/25 transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Scan Now
        </button>
      </div>
      {patterns.length === 0 ? (
        <EmptyState message="No patterns detected yet. Run a scan to analyze your data." />
      ) : (
        patterns.map((pattern) => (
          <div
            key={pattern.id}
            className={`p-4 rounded-xl border ${
              pattern.severity === "critical"
                ? "border-red-500/30 bg-red-500/5"
                : pattern.severity === "warning"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-border/30 bg-card/30"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{pattern.title}</div>
                <div className="text-xs text-muted-foreground/60 mt-1">{pattern.description}</div>
                {pattern.suggestedAction && (
                  <div className="text-xs mt-2 text-[hsl(var(--kf-accent1))]">
                    Suggested: {pattern.suggestedAction}
                  </div>
                )}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                pattern.severity === "critical"
                  ? "bg-red-500/10 text-red-400"
                  : pattern.severity === "warning"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-blue-500/10 text-blue-400"
              }`}>
                {pattern.confidence ? `${Math.round(pattern.confidence * 100)}%` : pattern.severity}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40">
      <Activity className="w-8 h-8 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function UndoPanel({
  businessId,
  actions,
  onUndo,
}: {
  businessId: string | null;
  actions: Array<{ id: string; actionType: string; entityType: string; entityId: string; createdAt: string; canUndo: boolean }>;
  onUndo: () => void;
}) {
  const [undoing, setUndoing] = useState<string | null>(null);

  const handleUndo = async (undoId: string) => {
    if (!businessId) return;
    setUndoing(undoId);
    try {
      const res = await undoAction(businessId, undoId);
      if (res.data?.success) {
        toast.success(res.data.message);
        onUndo();
      } else {
        toast.error(res.data?.message ?? "Undo failed");
      }
    } catch {
      toast.error("Undo request failed");
    } finally {
      setUndoing(null);
    }
  };

  if (actions.length === 0) {
    return <EmptyState message="No recent auto-actions to undo. Actions are available for 5 minutes after execution." />;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground/50 mb-2">
        Auto-executed actions can be undone within 5 minutes
      </div>
      {actions.map((action) => (
        <div
          key={action.id}
          className="flex items-center justify-between p-3 rounded-xl border border-border/30 bg-card/30"
        >
          <div className="flex items-center gap-3">
            <Undo2 className="w-4 h-4 text-muted-foreground/40" />
            <div>
              <div className="text-sm font-medium">
                {action.actionType}
                <span className="text-xs text-muted-foreground/50 ml-2">({action.entityType})</span>
              </div>
              <div className="text-[10px] text-muted-foreground/40">
                {new Date(action.createdAt).toLocaleTimeString()} · {action.entityId.slice(0, 8)}...
              </div>
            </div>
          </div>
          <button
            onClick={() => handleUndo(action.id)}
            disabled={!action.canUndo || undoing === action.id}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-30"
          >
            {undoing === action.id ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Undo2 className="w-3 h-3" />
            )}
            Undo
          </button>
        </div>
      ))}
    </div>
  );
}
