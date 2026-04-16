"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ShieldCheck, Check, X, Clock, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, Zap,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import {
  fetchAiPendingApprovals,
  resolveAiApproval,
  type AiApprovalItem,
} from "@/lib/client";

const TIER_COLORS: Record<number, string> = {
  1: "hsl(var(--kf-info))",
  2: "hsl(var(--kf-accent2))",
  3: "hsl(var(--kf-warning))",
  4: "hsl(var(--kf-error))",
};

const TIER_CONSEQUENCES: Record<number, string> = {
  1: "Low-risk automated action. Safe to approve — no significant side effects.",
  2: "Moderate action that modifies data. Review the details before approving.",
  3: "High-impact action affecting multiple systems. Carefully consider before approving.",
  4: "Critical action with business-wide impact. Requires full understanding of consequences.",
};

export function ApprovalsQueue({
  businessId,
  pendingCount,
  onResolve,
}: {
  businessId: string;
  pendingCount: number;
  onResolve?: () => void;
}) {
  const [approvals, setApprovals] = useState<AiApprovalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkResolving, setBulkResolving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAiPendingApprovals(businessId);
      setApprovals(res.data ?? []);
    } catch {
      toast.error("Failed to load approvals");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [businessId]);

  useEffect(() => {
    if (pendingCount > 0) load();
  }, [pendingCount, load]);

  const handleResolve = async (id: string, resolution: "approved" | "rejected" | "deferred") => {
    setResolving(id);
    try {
      await resolveAiApproval(businessId, id, resolution);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
      toast.success(
        resolution === "approved" ? "Action approved"
          : resolution === "rejected" ? "Action rejected"
            : "Deferred for later"
      );
      window.dispatchEvent(new CustomEvent("kf:approval.resolved"));
      onResolve?.();
    } catch {
      toast.error("Failed to resolve approval");
    } finally {
      setResolving(null);
    }
  };

  const handleBulkApproveTier1 = async () => {
    const tier1Items = approvals.filter((a) => a.riskTier === 1);
    if (tier1Items.length === 0) return;

    setBulkResolving(true);
    let successCount = 0;
    for (const item of tier1Items) {
      try {
        await resolveAiApproval(businessId, item.id, "approved");
        successCount++;
      } catch {}
    }
    setApprovals((prev) => prev.filter((a) => a.riskTier !== 1));
    toast.success(`${successCount} low-risk action${successCount > 1 ? "s" : ""} approved`);
    window.dispatchEvent(new CustomEvent("kf:approval.resolved"));
    onResolve?.();
    setBulkResolving(false);
  };

  if (pendingCount === 0 && !loaded) {
    return null;
  }

  const tier1Count = approvals.filter((a) => a.riskTier === 1).length;

  return (
    <SectionCard
      title="Pending Approvals"
      subtitle={`${approvals.length || pendingCount} AI actions awaiting your decision`}
      icon={ShieldCheck}
      action={
        tier1Count >= 2
          ? {
              label: bulkResolving ? "Approving..." : `Approve all Tier 1 (${tier1Count})`,
              onClick: handleBulkApproveTier1,
              icon: Zap,
            }
          : undefined
      }
    >
      {loading && !loaded && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
        </div>
      )}

      {loaded && approvals.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          No pending approvals
        </p>
      )}

      <AnimatePresence>
        {approvals.map((a, i) => {
          const tierColor = TIER_COLORS[a.riskTier] ?? "hsl(var(--kf-muted-foreground))";
          const isExpanded = expandedId === a.id;
          const consequence = TIER_CONSEQUENCES[a.riskTier] ?? TIER_CONSEQUENCES[2];

          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ delay: i * 0.03 }}
              layout
              className="mb-2"
            >
              <div
                className="rounded-xl p-3 cursor-pointer transition-all"
                style={{
                  background: "hsl(var(--kf-muted) / 0.06)",
                  border: `1px solid ${tierColor}25`,
                  borderRadius: isExpanded ? "12px 12px 0 0" : undefined,
                }}
                onClick={() => setExpandedId(isExpanded ? null : a.id)}
                role="button"
                aria-expanded={isExpanded}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: `${tierColor}15` }}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" style={{ color: tierColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--kf-foreground))" }}>
                        {a.title}
                      </p>
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                        style={{ background: `${tierColor}15`, color: tierColor }}
                      >
                        TIER {a.riskTier}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                      ) : (
                        <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-50" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                      )}
                    </div>
                    {a.description && (
                      <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                        {a.description}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(a.id, "approved"); }}
                        disabled={resolving === a.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors min-h-[28px]"
                        style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}
                      >
                        {resolving === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Approve
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(a.id, "rejected"); }}
                        disabled={resolving === a.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors min-h-[28px]"
                        style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}
                      >
                        <X className="w-3 h-3" />
                        Reject
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResolve(a.id, "deferred"); }}
                        disabled={resolving === a.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors min-h-[28px]"
                        style={{ background: "hsl(var(--kf-muted) / 0.15)", color: "hsl(var(--kf-muted-foreground))" }}
                      >
                        <Clock className="w-3 h-3" />
                        Defer
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div
                      className="px-4 py-3 rounded-b-xl space-y-2"
                      style={{
                        background: `${tierColor}04`,
                        borderLeft: `1px solid ${tierColor}25`,
                        borderRight: `1px solid ${tierColor}25`,
                        borderBottom: `1px solid ${tierColor}25`,
                      }}
                    >
                      {a.rationale && (
                        <div className="flex items-start gap-2">
                          <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: tierColor }} />
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                              AI Rationale
                            </p>
                            <p className="text-[11px] leading-relaxed italic" style={{ color: "hsl(var(--kf-foreground) / 0.7)" }}>
                              {a.rationale}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }} />
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                            Impact Assessment
                          </p>
                          <p className="text-[11px] leading-relaxed" style={{ color: "hsl(var(--kf-foreground) / 0.8)" }}>
                            {consequence}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </SectionCard>
  );
}
