"use client";

import { useState, useEffect, useCallback } from "react";
import { Sunrise, Zap, CheckCircle2, SkipForward, Loader2, TrendingUp, AlertCircle, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPostSimple } from "@/lib/api";

interface BriefingCard {
  stepOrder: number;
  title: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  impactScore: number;
  role: string;
  suggestedAction: string;
  toolName: string;
  args: Record<string, unknown>;
  oneClickApprove: boolean;
  module: string;
}

interface BriefingData {
  planId: string;
  date: string;
  totalCards: number;
  highImpactCards: number;
  totalAtStake: number;
  cards: BriefingCard[];
}

const ROLE_COLORS: Record<string, string> = {
  sales: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  support: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  operations: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  marketing: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  general: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export default function BriefingPage() {
  const businessId = getStoredBusinessId();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await apiGet<BriefingData>(`/ai/businesses/${businessId}/briefing`);
      if (res.data && res.data.planId) {
        setBriefing(res.data);
      } else {
        setBriefing(null);
      }
    } catch {
      toast.error("Failed to load morning briefing");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const executeCard = async (planId: string, stepOrder: number) => {
    if (!businessId) return;
    setExecuting((prev) => new Set(prev).add(stepOrder));
    try {
      const res = await apiPostSimple(`/ai/businesses/${businessId}/briefing/${planId}/execute-all`, {});
      if (!res.error) {
        toast.success("Action executed");
        load();
      } else {
        toast.error("Failed to execute action");
      }
    } catch {
      toast.error("Failed to execute action");
    } finally {
      setExecuting((prev) => {
        const next = new Set(prev);
        next.delete(stepOrder);
        return next;
      });
    }
  };

  const executeAll = async () => {
    if (!briefing || !businessId) return;
    const approvable = briefing.cards.filter((c) => c.oneClickApprove);
    if (approvable.length === 0) {
      toast.info("No one-click actions available");
      return;
    }
    try {
      const res = await apiPostSimple(`/ai/businesses/${businessId}/briefing/${briefing.planId}/execute-all`, {});
      if (!res.error) {
        toast.success(`${approvable.length} actions executed`);
        load();
      } else {
        toast.error("Failed to execute actions");
      }
    } catch {
      toast.error("Failed to execute actions");
    }
  };

  const skipBriefing = async () => {
    if (!briefing || !businessId) return;
    try {
      await apiPostSimple(`/ai/businesses/${businessId}/briefing/${briefing.planId}/skip`, {});
      toast.info("Briefing skipped");
      setBriefing(null);
    } catch {
      toast.error("Failed to skip briefing");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-20">
          <Sunrise className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground/70">No briefing today</h2>
          <p className="text-sm text-muted-foreground/50 mt-1">Everything looks good — no actions needed right now.</p>
          <button onClick={load} className="mt-4 px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-sm font-medium hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Sunrise className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground/90">Morning Briefing</h1>
            <p className="text-xs text-muted-foreground/60">
              {new Date(briefing.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={skipBriefing}
            className="px-3 py-2 rounded-lg text-sm text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/30 transition-colors flex items-center gap-1.5"
          >
            <SkipForward className="w-4 h-4" />
            Skip
          </button>
          <button
            onClick={executeAll}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Zap className="w-4 h-4" />
            Approve All ({briefing.cards.filter((c) => c.oneClickApprove).length})
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-4 rounded-xl border border-border/20 bg-card/50">
          <div className="flex items-center gap-2 text-muted-foreground/50 mb-1">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs font-medium">Actions</span>
          </div>
          <p className="text-2xl font-bold text-foreground/90">{briefing.totalCards}</p>
        </div>
        <div className="p-4 rounded-xl border border-border/20 bg-card/50">
          <div className="flex items-center gap-2 text-muted-foreground/50 mb-1">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium">High Impact</span>
          </div>
          <p className="text-2xl font-bold text-rose-400">{briefing.highImpactCards}</p>
        </div>
        <div className="p-4 rounded-xl border border-border/20 bg-card/50">
          <div className="flex items-center gap-2 text-muted-foreground/50 mb-1">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs font-medium">At Stake</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">${briefing.totalAtStake.toLocaleString()}</p>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {briefing.cards.map((card) => (
          <div
            key={card.stepOrder}
            className="p-4 rounded-xl border border-border/20 bg-card/50 hover:border-border/40 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${ROLE_COLORS[card.role] ?? ROLE_COLORS.general}`}
                  >
                    {card.role}
                  </span>
                  {card.impact === "HIGH" && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      High Impact
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground/40">{card.module}</span>
                </div>
                <p className="text-sm font-medium text-foreground/80">{card.title}</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">{card.suggestedAction}</p>
              </div>
              <div className="flex items-center gap-2">
                {card.oneClickApprove ? (
                  <button
                    onClick={() => executeCard(briefing.planId, card.stepOrder)}
                    disabled={executing.has(card.stepOrder)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {executing.has(card.stepOrder) ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    Do It
                  </button>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted/30 text-muted-foreground/50 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    Review Required
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
