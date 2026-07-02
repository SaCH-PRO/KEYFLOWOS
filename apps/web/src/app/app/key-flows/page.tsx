"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, RefreshCw, AlertCircle, ArrowRight, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { fetchBusinessRoleSummaries, fetchFlowRoles, type RoleQueueSummary, type FlowRoleDefinition } from "@/lib/api/flow-signal";

export default function KeyFlowsDirectoryPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<FlowRoleDefinition[]>([]);
  const [summaries, setSummaries] = useState<RoleQueueSummary[]>([]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [rolesRes, summariesRes] = await Promise.all([
        fetchFlowRoles(),
        fetchBusinessRoleSummaries(businessId),
      ]);
      if (rolesRes.data) setRoles(rolesRes.data);
      if (summariesRes.data) setSummaries(summariesRes.data);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryMap = new Map(summaries.map((s) => [s.roleKey, s]));

  return (
    <UnifiedPageShell
      title="KEY FLOWS"
      subtitle="Role-based signal directory. Pick a role to see its live queue."
      icon={Users}
      maxWidth="6xl"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {roles.length} roles subscribed to the FlowSignal stream.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80 disabled:opacity-50"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="kf-card h-32 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {roles.map((role, i) => {
            const summary = summaryMap.get(role.key);
            return (
              <motion.button
                key={role.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02, type: "spring", stiffness: 300, damping: 24 }}
                onClick={() => router.push(`/app/key-flows/${role.key.toLowerCase()}`)}
                className="kf-card p-4 text-left hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                    >
                      <LayoutGrid className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold leading-tight">{role.label}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {role.flowTypes.join(" · ")} · {role.subscriptions} subscriptions
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </div>

                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold">{summary?.total ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">open signals</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(summary?.summary.critical ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                        <AlertCircle className="w-3 h-3" />
                        {summary?.summary.critical}
                      </span>
                    )}
                    {(summary?.summary.high ?? 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                        {summary?.summary.high}
                      </span>
                    )}
                    {(summary?.summary.actionRequired ?? 0) > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium">
                        {summary?.summary.actionRequired}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </UnifiedPageShell>
  );
}
