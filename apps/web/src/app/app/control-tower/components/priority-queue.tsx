"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, ShieldAlert, Zap, TrendingUp,
  ChevronDown, ChevronUp, ArrowRight, Pin, PinOff,
  Eye, EyeOff, Clock,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { ControlTowerPriority } from "@/lib/client";

const TYPE_CONFIG = {
  risk: { icon: ShieldAlert, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)" },
  action: { icon: AlertTriangle, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)" },
  approval: { icon: Zap, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.08)" },
  opportunity: { icon: TrendingUp, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)" },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "hsl(var(--kf-error))",
  warning: "hsl(var(--kf-warning))",
  info: "hsl(var(--kf-info))",
  opportunity: "hsl(var(--kf-success))",
};

const CONSEQUENCE_MAP: Record<string, (p: ControlTowerPriority) => string> = {
  risk: (p) => {
    if (p.module === "revenue") return "Delayed collection increases bad debt risk and weakens cash flow position.";
    if (p.module === "crm") return "Unattended leads decay rapidly — response time directly impacts conversion rates.";
    if (p.module === "projects") return "Delivery delays cascade into client dissatisfaction and potential contract penalties.";
    return "Unresolved risks compound over time and affect overall business health.";
  },
  action: (p) => {
    if (p.description.includes("TTD")) return `${p.description} — acting now prevents further financial exposure.`;
    return "Taking action now prevents this from escalating to a higher severity level.";
  },
  approval: () => "AI actions are waiting for your decision. Delayed approvals block automation workflows.",
  opportunity: (p) => {
    if (p.module === "revenue") return "Revenue opportunities have a limited window — early action maximizes conversion.";
    return "Opportunities lose value over time. Acting early gives you the best chance of capturing this.";
  },
};

function getPinKey(businessId: string) {
  return `kf-tower-pinned-${businessId}`;
}

function getDismissKey(businessId: string) {
  return `kf-tower-dismissed-${businessId}`;
}

function getSnoozedKey(businessId: string) {
  return `kf-tower-snoozed-${businessId}`;
}

function getPinnedIds(businessId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(getPinKey(businessId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function savePinnedIds(businessId: string, ids: Set<string>) {
  try {
    localStorage.setItem(getPinKey(businessId), JSON.stringify([...ids]));
  } catch {}
}

function getDismissedIds(businessId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(getDismissKey(businessId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedIds(businessId: string, ids: Set<string>) {
  try {
    localStorage.setItem(getDismissKey(businessId), JSON.stringify([...ids]));
  } catch {}
}

function getSnoozedIds(businessId: string): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(getSnoozedKey(businessId));
    return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
  } catch {
    return new Map();
  }
}

function saveSnoozedIds(businessId: string, ids: Map<string, number>) {
  try {
    localStorage.setItem(getSnoozedKey(businessId), JSON.stringify(Object.fromEntries(ids)));
  } catch {}
}

export function PriorityQueue({
  priorities,
  businessId,
  onActionExecuted,
}: {
  priorities: ControlTowerPriority[];
  businessId: string;
  onActionExecuted?: () => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [snoozedIds, setSnoozedIds] = useState<Map<string, number>>(new Map());
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  useEffect(() => {
    setPinnedIds(getPinnedIds(businessId));
    setDismissedIds(getDismissedIds(businessId));
    const snoozed = getSnoozedIds(businessId);
    const now = Date.now();
    let changed = false;
    for (const [id, until] of snoozed) {
      if (until < now) {
        snoozed.delete(id);
        changed = true;
      }
    }
    if (changed) saveSnoozedIds(businessId, snoozed);
    setSnoozedIds(snoozed);
  }, [businessId]);

  const togglePin = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePinnedIds(businessId, next);
      return next;
    });
  }, [businessId]);

  const handleDismiss = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissedIds(businessId, next);
      return next;
    });
    toast.success("Priority dismissed");
  }, [businessId]);

  const handleSnooze = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const until = Date.now() + 2 * 60 * 60 * 1000;
    setSnoozedIds((prev) => {
      const next = new Map(prev);
      next.set(id, until);
      saveSnoozedIds(businessId, next);
      return next;
    });
    toast.success("Snoozed for 2 hours");
  }, [businessId]);

  const handleAction = useCallback((p: ControlTowerPriority, e: React.MouseEvent) => {
    e.stopPropagation();
    if (p.actionRoute) {
      router.push(p.actionRoute);
    }
    window.dispatchEvent(new CustomEvent("kf:action.executed"));
    onActionExecuted?.();
  }, [router, onActionExecuted]);

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedItem((prev) => (prev === id ? null : id));
  }, []);

  const activePriorities = priorities.filter(
    (p) => !dismissedIds.has(p.id) && !snoozedIds.has(p.id),
  );

  const sorted = [...activePriorities].sort((a, b) => {
    const aPinned = pinnedIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedIds.has(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.urgency - a.urgency;
  });

  const visible = expanded ? sorted : sorted.slice(0, 5);
  const hasMore = sorted.length > 5;
  const pinnedCount = sorted.filter((p) => pinnedIds.has(p.id)).length;
  const criticalCount = sorted.filter((p) => p.severity === "critical").length;

  if (activePriorities.length === 0) {
    return (
      <SectionCard title="Daily Priorities" subtitle="Ranked by urgency and impact" icon={Zap}>
        <div className="text-center py-6">
          <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-success))" }}>All clear</p>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            No urgent priorities right now
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Daily Priorities"
      subtitle={
        [
          `${activePriorities.length} items`,
          criticalCount > 0 ? `${criticalCount} critical` : null,
          pinnedCount > 0 ? `${pinnedCount} pinned` : null,
        ].filter(Boolean).join(" · ")
      }
      icon={Zap}
    >
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {visible.map((p, i) => {
            const cfg = TYPE_CONFIG[p.type] ?? TYPE_CONFIG.action;
            const Icon = cfg.icon;
            const dotColor = SEVERITY_DOT[p.severity] ?? "hsl(var(--kf-muted-foreground))";
            const isPinned = pinnedIds.has(p.id);
            const isExpanded = expandedItem === p.id;
            const consequenceFn = CONSEQUENCE_MAP[p.type] ?? CONSEQUENCE_MAP.action;
            const consequence = consequenceFn(p);

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ delay: i * 0.03 }}
                layout
              >
                <div
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all group cursor-pointer hover:scale-[1.005]"
                  style={{
                    background: cfg.bg,
                    border: isPinned ? `1px solid ${cfg.color}40` : `1px solid ${cfg.color}15`,
                    boxShadow: isPinned ? `0 0 0 1px ${cfg.color}20` : undefined,
                    borderRadius: isExpanded ? "12px 12px 0 0" : undefined,
                  }}
                  onClick={(e) => toggleExpand(p.id, e)}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  <button
                    onClick={(e) => togglePin(p.id, e)}
                    className="w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors min-w-[20px] min-h-[20px]"
                    style={{ background: "transparent" }}
                    aria-label={isPinned ? "Unpin priority" : "Pin priority"}
                    title={isPinned ? "Unpin" : "Pin to top"}
                  >
                    {isPinned ? (
                      <PinOff className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                    ) : (
                      <Pin className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    )}
                  </button>
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${cfg.color}15` }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--kf-foreground))" }}>
                      {p.title}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {p.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {p.actionLabel && (
                      <button
                        onClick={(e) => handleAction(p, e)}
                        className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold transition-all hover:opacity-80 min-h-[24px]"
                        style={{ background: `${cfg.color}15`, color: cfg.color }}
                      >
                        {p.actionLabel}
                        <ArrowRight className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                      style={{ background: `${dotColor}15`, color: dotColor }}
                    >
                      {p.module}
                    </span>
                    <div className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
                    {isExpanded ? (
                      <ChevronUp className="w-3 h-3" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    ) : (
                      <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    )}
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
                        className="px-4 py-3 space-y-2.5 rounded-b-xl"
                        style={{
                          background: `${cfg.color}04`,
                          borderLeft: `1px solid ${cfg.color}15`,
                          borderRight: `1px solid ${cfg.color}15`,
                          borderBottom: `1px solid ${cfg.color}15`,
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Eye className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }} />
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                              Consequence if not addressed
                            </p>
                            <p className="text-[11px] leading-relaxed" style={{ color: "hsl(var(--kf-foreground) / 0.8)" }}>
                              {consequence}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          {p.actionLabel && p.actionRoute && (
                            <button
                              onClick={(e) => handleAction(p, e)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:opacity-80 min-h-[28px]"
                              style={{ background: `${cfg.color}15`, color: cfg.color }}
                            >
                              {p.actionLabel}
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleSnooze(p.id, e)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:opacity-80 min-h-[28px]"
                            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}
                          >
                            <Clock className="w-3 h-3" />
                            Snooze
                          </button>
                          <button
                            onClick={(e) => handleDismiss(p.id, e)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:opacity-80 min-h-[28px]"
                            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground) / 0.7)" }}
                          >
                            <EyeOff className="w-3 h-3" />
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 mt-2 py-2 text-[10px] font-medium transition-colors hover:opacity-70 min-h-[36px]"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show less" : `Show ${sorted.length - 5} more`}
        </button>
      )}
    </SectionCard>
  );
}
