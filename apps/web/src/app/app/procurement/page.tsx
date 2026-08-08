"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ShoppingCart, Plus, Loader2, ArrowRight, Clock, CheckCircle2, AlertCircle, XCircle, TrendingUp, DollarSign, BarChart3, Truck, Package, FileText } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchProcurementRequests, fetchProcurementStats, type ProcurementRequest } from "@/lib/client";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; bg: string; text: string }> = {
  DRAFT: { icon: <Clock className="w-3.5 h-3.5" />, label: "Draft", bg: "bg-slate-500/10", text: "text-slate-500" },
  SUBMITTED: { icon: <AlertCircle className="w-3.5 h-3.5" />, label: "Submitted", bg: "bg-amber-500/10", text: "text-amber-600" },
  APPROVED: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Approved", bg: "bg-emerald-500/10", text: "text-emerald-600" },
  COMPLETED: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Completed", bg: "bg-blue-500/10", text: "text-blue-600" },
  REJECTED: { icon: <XCircle className="w-3.5 h-3.5" />, label: "Rejected", bg: "bg-red-500/10", text: "text-red-600" },
  PO_ISSUED: { icon: <Truck className="w-3.5 h-3.5" />, label: "PO Issued", bg: "bg-indigo-500/10", text: "text-indigo-600" },
  VENDOR_ACKNOWLEDGED: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: "Acknowledged", bg: "bg-violet-500/10", text: "text-violet-600" },
  FULFILLED: { icon: <Package className="w-3.5 h-3.5" />, label: "Fulfilled", bg: "bg-teal-500/10", text: "text-teal-600" },
  INVOICED: { icon: <FileText className="w-3.5 h-3.5" />, label: "Invoiced", bg: "bg-cyan-500/10", text: "text-cyan-600" },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

export default function ProcurementPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    pendingApprovals: number;
    averageBudget: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    setLoading(true);
    try {
      const [reqRes, statsRes] = await Promise.all([
        fetchProcurementRequests(biz),
        fetchProcurementStats(biz),
      ]);
      if (reqRes.data) setRequests(reqRes.data);
      if (statsRes.data) setStats(statsRes.data);
    } catch {
      toast.error("Failed to load procurement data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <WorkspaceShell
      icon={ShoppingCart}
      title="Procurement"
      subtitle="Request services and get AI-recommended packages"
      iconColor="#F97316"
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/app/procurement/suppliers")}
            className="flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all text-xs font-medium"
          >
            <Truck className="w-3.5 h-3.5" />
            Suppliers
          </button>
          <button
            onClick={() => router.push("/app/procurement/new")}
            className="flex items-center gap-1.5 h-9 px-3 kf-radius-md text-xs font-medium"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Request
          </button>
        </div>
      }
    >
      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />)
        ) : stats ? (
          <>
            <motion.div variants={fadeUp} initial="hidden" animate="show">
              <MetricCard label="Total Requests" value={stats.total} icon={BarChart3} />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
              <MetricCard label="Pending Approval" value={stats.pendingApprovals} icon={AlertCircle} iconColor="#f59e0b" />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
              <MetricCard label="Avg Budget" value={`$${(stats.averageBudget ?? 0).toLocaleString()}`} icon={DollarSign} iconColor="#10b981" />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
              <MetricCard label="Approved" value={stats.byStatus?.APPROVED ?? 0} icon={TrendingUp} iconColor="#3b82f6" />
            </motion.div>
          </>
        ) : null}
      </div>

      {/* Status Distribution */}
      {!loading && stats && (
        <SectionCard title="Status Breakdown" icon={BarChart3} compact>
          <div className="flex flex-wrap gap-2 p-3">
            {Object.entries(stats.byStatus ?? {}).map(([status, count]) => {
              const config = STATUS_CONFIG[status];
              if (!config) return null;
              return (
                <div key={status} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${config.bg} ${config.text} text-xs font-medium`}>
                  {config.icon}
                  {config.label}: {count}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No procurement requests yet"
          description="Describe what you need and KEY will recommend the best packages for your business."
          actionLabel="Create First Request"
          actionIcon={Plus}
          onAction={() => router.push("/app/procurement/new")}
          variant="compact"
        />
      ) : (
        <SectionCard title="All Requests" icon={FileText} compact>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="divide-y divide-border/30"
          >
            {requests.map((req) => {
              const config = STATUS_CONFIG[req.status];
              return (
                <motion.button
                  key={req.id}
                  variants={fadeUp}
                  onClick={() => router.push(`/app/procurement/${req.id}`)}
                  className="w-full text-left p-4 hover:bg-muted/20 transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {config && (
                          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${config.bg} ${config.text}`}>
                            {config.icon}
                            {config.label}
                          </span>
                        )}
                        {req.priority && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            req.priority === "HIGH" ? "bg-red-500/10 text-red-500" :
                            req.priority === "URGENT" ? "bg-amber-500/10 text-amber-500" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {req.priority}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground/90 truncate">{req.userPrompt}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {req.recommendedPackages && Array.isArray(req.recommendedPackages)
                          ? `${req.recommendedPackages.length} package${req.recommendedPackages.length !== 1 ? "s" : ""} recommended`
                          : "Analyzing..."}
                        {" · "}
                        {new Date(req.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-foreground transition-colors shrink-0 mt-1" />
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        </SectionCard>
      )}
    </WorkspaceShell>
  );
}
