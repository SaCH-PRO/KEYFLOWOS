"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Users,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  Check,
  Flag,
  Clock,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import {
  fetchFlowRoles,
  fetchRoleFlowQueue,
  resolveFlowSignal,
  markFlowSignalActionRequired,
  snoozeFlowSignal,
  type FlowRoleDefinition,
  type FlowSignal,
} from "@/lib/api/flow-signal";

export default function KeyFlowsRolePage() {
  const router = useRouter();
  const params = useParams();
  const businessId = getStoredBusinessId() ?? "";
  const paramKey = typeof params.rolekey === "string" ? params.rolekey : "";

  const [roles, setRoles] = useState<FlowRoleDefinition[]>([]);
  const [signals, setSignals] = useState<FlowSignal[]>([]);
  const [queueMeta, setQueueMeta] = useState<{ total: number; summary: { critical: number; high: number; actionRequired: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState<string>("");

  const role = roles.find(
    (r) => r.key.toLowerCase() === paramKey.toLowerCase()
  );
  const roleKey = role?.key ?? paramKey.toUpperCase();

  const loadRoles = useCallback(async () => {
    const res = await fetchFlowRoles();
    if (res.data) setRoles(res.data);
  }, []);

  const loadQueue = useCallback(async () => {
    if (!businessId || !roleKey) return;
    setLoading(true);
    try {
      const res = await fetchRoleFlowQueue(businessId, roleKey);
      if (res.data) {
        setSignals(res.data.items);
        setQueueMeta({ total: res.data.total, summary: res.data.summary });
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, roleKey]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleResolve = async (signalId: string) => {
    if (!businessId) return;
    setActingId(signalId);
    try {
      await resolveFlowSignal(businessId, signalId);
      await loadQueue();
    } finally {
      setActingId(null);
    }
  };

  const handleActionRequired = async (signalId: string) => {
    if (!businessId) return;
    setActingId(signalId);
    try {
      await markFlowSignalActionRequired(businessId, signalId);
      await loadQueue();
    } finally {
      setActingId(null);
    }
  };

  const handleSnooze = async (signalId: string) => {
    if (!businessId || !snoozeUntil) return;
    setActingId(signalId);
    try {
      await snoozeFlowSignal(businessId, signalId, new Date(snoozeUntil).toISOString());
      setSnoozeUntil("");
      await loadQueue();
    } finally {
      setActingId(null);
    }
  };

  const importanceColor = (importance: string) => {
    if (importance === "CRITICAL") return "text-red-500";
    if (importance === "HIGH") return "text-amber-500";
    if (importance === "LOW") return "text-muted-foreground";
    return "text-blue-500";
  };

  return (
    <UnifiedPageShell
      title={role?.label ?? roleKey.replace(/_/g, " ")}
      subtitle="Live role queue from the FlowSignal stream."
      icon={Users}
      maxWidth="4xl"
      headerActions={
        <button
          onClick={() => router.push("/app/key-flows")}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to roles
        </button>
      }
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {queueMeta && (
            <>
              <span className="text-xs text-muted-foreground">
                {queueMeta.total} open signal{queueMeta.total === 1 ? "" : "s"}
              </span>
              {queueMeta.summary.critical > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                  {queueMeta.summary.critical} critical
                </span>
              )}
              {queueMeta.summary.high > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                  {queueMeta.summary.high} high
                </span>
              )}
              {queueMeta.summary.actionRequired > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
                  {queueMeta.summary.actionRequired} action required
                </span>
              )}
            </>
          )}
        </div>
        <button
          onClick={loadQueue}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 kf-card animate-pulse" />)
        ) : signals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
            <p className="text-sm font-medium">Queue clear</p>
            <p className="text-xs text-muted-foreground">No open signals match this role right now.</p>
          </div>
        ) : (
          signals.map((signal, i) => (
            <motion.div
              key={signal.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="kf-card p-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className={`w-5 h-5 mt-0.5 shrink-0 ${importanceColor(signal.importance)}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2">
                    <h4 className="text-sm font-medium">{signal.title}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {signal.flows.join(" · ")}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">
                      {signal.importance}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {signal.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{signal.summary}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {signal.type} · {signal.source} · {new Date(signal.occurredAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleResolve(signal.id)}
                  disabled={actingId === signal.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {actingId === signal.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Resolve
                </button>
                <button
                  onClick={() => handleActionRequired(signal.id)}
                  disabled={actingId === signal.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                >
                  {actingId === signal.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flag className="w-3 h-3" />}
                  Action Required
                </button>
                <div className="flex items-center gap-1">
                  <input
                    type="datetime-local"
                    value={snoozeUntil}
                    onChange={(e) => setSnoozeUntil(e.target.value)}
                    className="px-2 py-1.5 rounded-lg text-xs border bg-background"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  />
                  <button
                    onClick={() => handleSnooze(signal.id)}
                    disabled={actingId === signal.id || !snoozeUntil}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border hover:bg-muted transition-colors disabled:opacity-50"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    {actingId === signal.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                    Snooze
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </UnifiedPageShell>
  );
}
