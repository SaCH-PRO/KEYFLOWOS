"use client";

import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import {
  Users,
  TrendingUp,
  DollarSign,
  Target,
  Loader2,
} from "lucide-react";

interface SalesRep {
  id: string;
  name: string;
  commissionRate: number;
  dealsClosed: number;
  revenueAttributed: number;
}

interface PipelineContact {
  id: string;
  name: string;
  status: string;
  stage: string | null;
  openDeals: number;
  paidDeals: number;
  openDealsValue: number;
}

export default function SalesTeamPage() {
  const businessId = getStoredBusinessId() ?? "";
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    apiGet<{ reps: SalesRep[] }>(`/conversion/businesses/${businessId}/sales-reps`)
      .then((res) => {
        if (res.data) setReps((res.data as unknown) as SalesRep[]);
      })
      .catch(() => toast.error("Failed to load sales reps"))
      .finally(() => setLoading(false));
  }, [businessId]);

  useEffect(() => {
    if (!businessId || !selectedRep) return;
    apiGet<{ pipeline: PipelineContact[] }>(`/conversion/businesses/${businessId}/sales-reps/${selectedRep}/pipeline`)
      .then((res) => {
        if (res.data) setPipeline((res.data as unknown) as PipelineContact[]);
      })
      .catch(() => toast.error("Failed to load pipeline"));
  }, [businessId, selectedRep]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalRevenue = reps.reduce((sum, r) => sum + r.revenueAttributed, 0);
  const totalDeals = reps.reduce((sum, r) => sum + r.dealsClosed, 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Sales Team</h1>
        <p className="text-sm text-muted-foreground">Track performance, commissions, and pipelines.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Revenue", value: `TTD ${totalRevenue.toLocaleString()}`, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: "Deals Closed", value: String(totalDeals), icon: Target, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: "Team Size", value: String(reps.length), icon: Users, color: "text-violet-500", bg: "bg-violet-500/10" },
          { label: "Avg Commission", value: `${reps.length ? (reps.reduce((s, r) => s + r.commissionRate, 0) / reps.length).toFixed(1) : 0}%`, icon: TrendingUp, color: "text-amber-500", bg: "bg-amber-500/10" },
        ].map((stat) => (
          <div key={stat.label} className="p-3 rounded-xl border border-border/40 bg-background/50">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className={`p-1 rounded-md ${stat.bg}`}>
                <stat.icon className={`w-3 h-3 ${stat.color}`} />
              </div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="text-lg font-bold">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Reps */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Sales Reps</h2>
        {reps.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-border/40 bg-background/50">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No sales reps yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Assign staff members as sales reps in Settings → Conversion.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {reps.map((rep) => (
              <button
                key={rep.id}
                onClick={() => setSelectedRep(rep.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  selectedRep === rep.id
                    ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5"
                    : "border-border/40 bg-background/50 hover:border-border/80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{rep.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {rep.commissionRate}% commission · {rep.dealsClosed} deals
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">TTD {rep.revenueAttributed.toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">attributed</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pipeline */}
      {selectedRep && pipeline.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Pipeline</h2>
          <div className="space-y-2">
            {pipeline.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-background/50"
              >
                <div>
                  <div className="text-sm font-medium">{contact.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {contact.stage ?? contact.status} · {contact.openDeals} open · {contact.paidDeals} paid
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">TTD {contact.openDealsValue.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">pipeline value</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
