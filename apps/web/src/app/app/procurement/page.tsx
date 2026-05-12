"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Plus, Loader2, ArrowRight, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchProcurementRequests, type ProcurementRequest } from "@/lib/client";
import { WorkspaceShell } from "@/components/ui/workspace-shell";

function statusIcon(status: string) {
  switch (status) {
    case "DRAFT": return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    case "SUBMITTED": return <AlertCircle className="w-3.5 h-3.5 text-amber-500" />;
    case "APPROVED": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case "COMPLETED": return <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />;
    default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "DRAFT": return "Draft";
    case "SUBMITTED": return "Submitted";
    case "APPROVED": return "Approved";
    case "COMPLETED": return "Completed";
    default: return status;
  }
}

export default function ProcurementPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchProcurementRequests(biz);
      if (res.data) setRequests(res.data);
    } catch {
      toast.error("Failed to load procurement requests");
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
      ) : requests.length === 0 ? (
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
    </WorkspaceShell>
  );
}
