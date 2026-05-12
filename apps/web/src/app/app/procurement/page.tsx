"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Plus, Loader2, ArrowRight, Clock, CheckCircle2, AlertCircle, XCircle, TrendingUp, DollarSign, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchProcurementRequests, fetchProcurementStats, type ProcurementRequest } from "@/lib/client";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { Card } from "@keyflow/ui";

function statusIcon(status: string) {
  switch (status) {
    case "DRAFT": return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    case "SUBMITTED": return <AlertCircle className="w-3.5 h-3.5 text-amber-500" />;
    case "APPROVED": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case "COMPLETED": return <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />;
    case "REJECTED": return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "DRAFT": return "Draft";
    case "SUBMITTED": return "Submitted";
    case "APPROVED": return "Approved";
    case "COMPLETED": return "Completed";
    case "REJECTED": return "Rejected";
    default: return status;
  }
}

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
        <button
          onClick={() => router.push("/app/procurement/new")}
          className="flex items-center gap-1.5 h-9 px-3 kf-radius-md text-xs font-medium"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Request
        </button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Total requests</span>
                  </div>
                  <p className="text-xl font-bold mt-1">{stats.total}</p>
                </div>
              </Card>
              <Card>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Pending approval</span>
                  </div>
                  <p className="text-xl font-bold mt-1">{stats.pendingApprovals}</p>
                </div>
              </Card>
              <Card>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-muted-foreground">Avg budget</span>
                  </div>
                  <p className="text-xl font-bold mt-1">${stats.averageBudget.toLocaleString()}</p>
                </div>
              </Card>
              <Card>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span className="text-xs text-muted-foreground">Approved</span>
                  </div>
                  <p className="text-xl font-bold mt-1">{stats.byStatus.APPROVED ?? 0}</p>
                </div>
              </Card>
            </div>
          )}

          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ShoppingCart className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <h3 className="text-sm font-medium text-foreground/80">No procurement requests yet</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Describe what you need and KEY will recommend the best packages for your business.
              </p>
              <button
                onClick={() => router.push("/app/procurement/new")}
                className="mt-4 flex items-center gap-1.5 h-9 px-4 kf-radius-md text-xs font-medium"
                style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
              >
                <Plus className="w-3.5 h-3.5" />
                Create First Request
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <button
                  key={req.id}
                  onClick={() => router.push(`/app/procurement/${req.id}`)}
                  className="w-full text-left rounded-xl border border-border/50 bg-card/50 p-4 hover:border-border/80 hover:bg-card transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {statusIcon(req.status)}
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {statusLabel(req.status)}
                        </span>
                        {req.priority && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
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
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </WorkspaceShell>
  );
}
