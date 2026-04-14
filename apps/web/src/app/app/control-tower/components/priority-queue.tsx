"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ShieldAlert, Zap, TrendingUp, ChevronDown, ChevronUp, ArrowRight, Pin, PinOff,
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

function getPinKey(businessId: string) {
  return `kf-tower-pinned-${businessId}`;
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

export function PriorityQueue({ priorities, businessId }: { priorities: ControlTowerPriority[]; businessId: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setPinnedIds(getPinnedIds(businessId));
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

  const sorted = [...priorities].sort((a, b) => {
    const aPinned = pinnedIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedIds.has(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.urgency - a.urgency;
  });

  const visible = expanded ? sorted : sorted.slice(0, 5);
  const hasMore = sorted.length > 5;
  const pinnedCount = sorted.filter((p) => pinnedIds.has(p.id)).length;

  if (priorities.length === 0) {
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
      subtitle={`${priorities.length} items${pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ""} · ranked by urgency`}
      icon={Zap}
    >
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {visible.map((p, i) => {
            const cfg = TYPE_CONFIG[p.type] ?? TYPE_CONFIG.action;
            const Icon = cfg.icon;
            const dotColor = SEVERITY_DOT[p.severity] ?? "hsl(var(--kf-muted-foreground))";
            const isPinned = pinnedIds.has(p.id);

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all group cursor-pointer hover:scale-[1.005]"
                style={{
                  background: cfg.bg,
                  border: isPinned ? `1px solid ${cfg.color}40` : `1px solid ${cfg.color}15`,
                  boxShadow: isPinned ? `0 0 0 1px ${cfg.color}20` : undefined,
                }}
                onClick={() => p.actionRoute && router.push(p.actionRoute)}
                role={p.actionRoute ? "link" : undefined}
              >
                <button
                  onClick={(e) => togglePin(p.id, e)}
                  className="w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors hover:bg-white/10 min-w-[20px] min-h-[20px]"
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
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                    style={{ background: `${dotColor}15`, color: dotColor }}
                  >
                    {p.module}
                  </span>
                  <div className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
                  {p.actionRoute && (
                    <ArrowRight
                      className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity"
                      style={{ color: "hsl(var(--kf-muted-foreground))" }}
                    />
                  )}
                </div>
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
          {expanded ? "Show less" : `Show ${priorities.length - 5} more`}
        </button>
      )}
    </SectionCard>
  );
}
