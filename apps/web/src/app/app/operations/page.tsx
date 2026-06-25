"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Gauge,
  Loader2,
  Shield,
  Phone,
  ClipboardCheck,
  Megaphone,
  ArrowRight,
  Bot,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  Users,
  Zap,
  RefreshCw,
  BarChart3,
  Flag,
  Receipt,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import {
  ContentRequest,
  ApprovalRequest,
  CallLog,
  Evidence,
  fetchContentRequests,
  fetchApprovalRequests,
  fetchPendingApprovalsForMe,
  fetchScheduledCalls,
  fetchEvidence,
  fetchAiExecutionStats,
  fetchAiPendingApprovals,
  fetchWorkload,
  fetchPriorities,
  fetchCapacityAlerts,
  rebalanceWorkload,
  WorkloadReport,
  PrioritizedTask,
  CapacityAlert,
  AiExecutionStats,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

export default function OperationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [contentRequests, setContentRequests] = useState<ContentRequest[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [myApprovals, setMyApprovals] = useState<ApprovalRequest[]>([]);
  const [scheduledCalls, setScheduledCalls] = useState<CallLog[]>([]);
  const [pendingEvidence, setPendingEvidence] = useState<Evidence[]>([]);
  const [workload, setWorkload] = useState<WorkloadReport | null>(null);
  const [priorities, setPriorities] = useState<PrioritizedTask[]>([]);
  const [alerts, setAlerts] = useState<CapacityAlert[]>([]);
  const [executionStats, setExecutionStats] = useState<AiExecutionStats | null>(null);
  const [aiApprovalsPending, setAiApprovalsPending] = useState(0);
  const [rebalancing, setRebalancing] = useState(false);
  const [stats, setStats] = useState({
    contentPending: 0,
    contentInvoiced: 0,
    approvalsPending: 0,
    callsToday: 0,
    evidencePending: 0,
  });

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const [
        contentRes,
        deliveredRes,
        approvalsRes,
        myApprovalsRes,
        callsRes,
        evidenceRes,
        workloadRes,
        prioritiesRes,
        alertsRes,
        execRes,
        aiPendingRes,
      ] = await Promise.all([
        fetchContentRequests(businessId, { status: "in_production" }),
        fetchContentRequests(businessId, { status: "delivered" }),
        fetchApprovalRequests(businessId, { status: "pending" }),
        fetchPendingApprovalsForMe(businessId).catch(() => ({ data: [] })),
        fetchScheduledCalls(businessId, today),
        fetchEvidence(businessId),
        fetchWorkload(businessId).catch(() => ({ data: null })),
        fetchPriorities(businessId).catch(() => ({ data: [] })),
        fetchCapacityAlerts(businessId).catch(() => ({ data: [] })),
        fetchAiExecutionStats(businessId, 1).catch(() => ({ data: null })),
        fetchAiPendingApprovals(businessId).catch(() => ({ data: [] })),
      ]);

      const content = contentRes.data ?? [];
      const delivered = deliveredRes.data ?? [];
      const approvals = approvalsRes.data?.items ?? [];
      const myApprs = myApprovalsRes.data ?? [];
      const calls = callsRes.data ?? [];
      const evidence = evidenceRes.data ?? [];

      setContentRequests(content.slice(0, 5));
      setPendingApprovals(approvals.slice(0, 5));
      setMyApprovals(myApprs.slice(0, 5));
      setScheduledCalls(calls.slice(0, 5));
      setPendingEvidence(evidence.filter((e) => !e.verifiedAt).slice(0, 5));
      setWorkload(workloadRes.data ?? null);
      setPriorities((prioritiesRes.data ?? []).slice(0, 8));
      setAlerts((alertsRes.data ?? []).slice(0, 6));
      setExecutionStats(execRes.data ?? null);
      setAiApprovalsPending(aiPendingRes.data?.length ?? 0);
      setStats({
        contentPending: content.length,
        contentInvoiced: delivered.filter((r) => r.invoiceId).length,
        approvalsPending: approvals.length,
        callsToday: calls.length,
        evidencePending: evidence.length,
      });
    } catch (err) {
      toast.error("Failed to load operations dashboard");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRebalance = async () => {
    if (!businessId) return;
    setRebalancing(true);
    try {
      const res = await rebalanceWorkload(businessId);
      if (res.data?.success) {
        toast.success(`Rebalanced ${res.data.transfers.length} task(s)`);
        load();
      } else {
        toast.info("No rebalancing needed — team capacity looks good");
      }
    } catch (err) {
      toast.error("Rebalance failed");
    } finally {
      setRebalancing(false);
    }
  };

  const getAlertIcon = (severity: string) => {
    if (severity === "high") return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (severity === "medium") return <AlertCircle className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-blue-500" />;
  };

  const getAlertBorder = (severity: string) => {
    if (severity === "high") return "border-red-200 bg-red-50/30";
    if (severity === "medium") return "border-amber-200 bg-amber-50/30";
    return "border-blue-200 bg-blue-50/30";
  };

  const getUtilizationColor = (pct: number) => {
    if (pct > 100) return "bg-red-500";
    if (pct > 80) return "bg-amber-500";
    return "bg-emerald-500";
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
  };

  return (
    <WorkspaceShell icon={Gauge} title="Operations" subtitle="Cross-module visibility and AI-powered workload management">
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-end">
          <button
            onClick={handleRebalance}
            disabled={rebalancing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {rebalancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Rebalance Workload
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Operations Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <motion.div variants={fadeUp} initial="hidden" animate="show">
                <MetricCard label="Content In Production" value={stats.contentPending} icon={Megaphone} iconColor="#f59e0b" />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
                <MetricCard label="Pending Approvals" value={stats.approvalsPending} icon={Shield} iconColor="#8b5cf6" />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
                <MetricCard label="Calls Today" value={stats.callsToday} icon={Phone} iconColor="#3b82f6" />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
                <MetricCard label="Evidence Pending" value={stats.evidencePending} icon={ClipboardCheck} iconColor="#10b981" />
              </motion.div>
            </div>

            {/* AI Activity Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.2 }}>
                <MetricCard label="KEY Actions Today" value={executionStats?.totalActions ?? 0} sub={executionStats ? `${Math.round(executionStats.successRate * 100)}% success` : "No data"} icon={Bot} />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.25 }}>
                <MetricCard label="AI Approvals Pending" value={aiApprovalsPending} sub={aiApprovalsPending > 0 ? "Needs your decision" : "All caught up"} icon={Zap} iconColor={aiApprovalsPending > 0 ? "#f59e0b" : "#10b981"} />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.3 }}>
                <MetricCard label="Team Utilization" value={workload ? `${Math.round((workload.totalAssignedHours / Math.max(workload.totalCapacityHours, 1)) * 100)}%` : "—"} sub={`${workload?.overloaded.length ?? 0} overloaded`} icon={Users} />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.35 }}>
                <MetricCard label="Capacity Alerts" value={alerts.length} sub={`${alerts.filter((a) => a.severity === "high").length} high priority`} icon={Flag} iconColor={alerts.some((a) => a.severity === "high") ? "#ef4444" : "#10b981"} />
              </motion.div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Workload + Alerts */}
              <div className="flex flex-col gap-6">
                {/* Team Workload */}
                {workload && workload.entries.length > 0 && (
                  <SectionCard title="Team Workload" icon={BarChart3} compact headerRight={<span className="text-xs text-muted-foreground">{Math.round(workload.totalAssignedHours)}h / {Math.round(workload.totalCapacityHours)}h</span>}>
                    <div className="space-y-3 p-3">
                      {workload.entries.map((entry) => (
                        <div key={entry.userId}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium">{entry.userName}</span>
                            <span className={entry.utilizationPercent > 100 ? "text-red-600 font-medium" : "text-muted-foreground"}>
                              {entry.utilizationPercent}% ({entry.totalAssignedHours}h)
                            </span>
                          </div>
                          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full transition-all ${getUtilizationColor(entry.utilizationPercent)}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(entry.utilizationPercent, 100)}%` }}
                              transition={{ duration: 0.6, ease: "easeOut" }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                )}

                {/* Capacity Alerts */}
                {alerts.length > 0 && (
                  <SectionCard title="Capacity Alerts" icon={AlertTriangle} compact>
                    <div className="space-y-2 p-3">
                      {alerts.map((alert, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className={`p-3 rounded-lg border text-sm ${getAlertBorder(alert.severity)}`}
                        >
                          <div className="flex items-start gap-2">
                            {getAlertIcon(alert.severity)}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">{alert.message}</div>
                              <div className="text-xs text-muted-foreground mt-1">{alert.recommendedAction}</div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </SectionCard>
                )}

                {/* My Approvals */}
                {myApprovals.length > 0 && (
                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Shield className="w-4 h-4 text-purple-600" />
                        Needs Your Decision
                      </h3>
                      <button onClick={() => router.push("/app/approvals")} className="text-xs text-primary hover:underline flex items-center gap-1">
                        View All <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {myApprovals.map((a) => (
                        <div
                          key={a.id}
                          onClick={() => router.push(`/app/approvals/${a.id}`)}
                          className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <div>
                            <div className="font-medium text-sm">{a.title}</div>
                            <div className="text-xs text-muted-foreground">{a.requestType.replace(/_/g, " ")}</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Middle Column: Priority Queue + Calls */}
              <div className="flex flex-col gap-6">
                {/* Priority Queue */}
                {priorities.length > 0 && (
                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                        Priority Queue
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {priorities.map((task) => (
                        <div key={task.id} className="p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-sm truncate">{task.title}</div>
                            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{task.score}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                              {task.type.replace(/_/g, " ")}
                            </span>
                            {task.dueDate && (
                              <span className="text-[10px] text-muted-foreground">
                                Due {new Date(task.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{task.recommendedAction}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Scheduled Calls */}
                {scheduledCalls.length > 0 && (
                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Phone className="w-4 h-4 text-blue-600" />
                        Calls Today
                      </h3>
                      <button onClick={() => router.push("/app/call-tasks")} className="text-xs text-primary hover:underline flex items-center gap-1">
                        View All <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {scheduledCalls.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => router.push("/app/call-tasks")}
                          className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <div>
                            <div className="font-medium text-sm">Contact {c.contactId?.slice(0, 8) ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.scheduledAt ? new Date(c.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No time"}
                              {c.script && ` · ${c.script.slice(0, 40)}...`}
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Content + Evidence + AI Approvals */}
              <div className="flex flex-col gap-6">
                {/* AI Pending Approvals */}
                {aiApprovalsPending > 0 && (
                  <div className="border rounded-xl p-4 bg-primary/5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary" />
                        KEY Needs Approval
                      </h3>
                      <button onClick={() => router.push("/app/keyflow-command")} className="text-xs text-primary hover:underline flex items-center gap-1">
                        Review <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {aiApprovalsPending} AI action{aiApprovalsPending > 1 ? "s" : ""} waiting for your approval before execution.
                    </div>
                  </div>
                )}

                {/* Content Requests */}
                {contentRequests.length > 0 && (
                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <Megaphone className="w-4 h-4 text-amber-600" />
                        Content In Production
                      </h3>
                      <button onClick={() => router.push("/app/content-ops")} className="text-xs text-primary hover:underline flex items-center gap-1">
                        View All <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {contentRequests.map((r) => (
                        <div
                          key={r.id}
                          onClick={() => router.push(`/app/content-ops/${r.id}`)}
                          className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <div>
                            <div className="font-medium text-sm truncate max-w-[200px]">{r.businessGoal}</div>
                            <div className="text-xs text-muted-foreground">{r.contentTypes?.join(", ")} · {r.priority}</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pending Evidence */}
                {pendingEvidence.length > 0 && (
                  <div className="border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium flex items-center gap-2">
                        <ClipboardCheck className="w-4 h-4 text-green-600" />
                        Evidence Pending Verification
                      </h3>
                      <button onClick={() => router.push("/app/evidence")} className="text-xs text-primary hover:underline flex items-center gap-1">
                        View All <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {pendingEvidence.map((e) => (
                        <div
                          key={e.id}
                          onClick={() => router.push("/app/evidence")}
                          className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <div>
                            <div className="font-medium text-sm capitalize">{e.linkedType?.replace(/_/g, " ") ?? "Evidence"}</div>
                            <div className="text-xs text-muted-foreground">by {e.submittedBy?.slice(0, 8) ?? "—"}</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
