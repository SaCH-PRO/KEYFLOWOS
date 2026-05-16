"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { PriorityQueue } from "../../control-tower/components/priority-queue";
import type { EnrichedPriority } from "../../control-tower/components/use-control-tower-data";

type TabKey = "now" | "next" | "waiting" | "done";

const TABS: { key: TabKey; label: string }[] = [
  { key: "now", label: "Now" },
  { key: "next", label: "Next" },
  { key: "waiting", label: "Waiting" },
  { key: "done", label: "Done" },
];

function filterPriorities(
  priorities: EnrichedPriority[],
  tab: TabKey
): EnrichedPriority[] {
  switch (tab) {
    case "now":
      return priorities.filter(
        (p) =>
          p.type === "risk" ||
          p.type === "action" ||
          p.severity === "critical" ||
          p.severity === "warning"
      );
    case "next":
      return priorities.filter(
        (p) =>
          p.type === "opportunity" ||
          (p.severity === "info" && p.type !== "approval")
      );
    case "waiting":
      return priorities.filter((p) => p.type === "approval");
    case "done":
      // No done state in current model; return empty
      return [];
    default:
      return priorities;
  }
}

interface CockpitPrioritiesProps {
  priorities: EnrichedPriority[];
  businessId: string;
  onActionExecuted?: () => void;
}

export function CockpitPriorities({
  priorities,
  businessId,
  onActionExecuted,
}: CockpitPrioritiesProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("now");

  const tabCounts = useMemo(() => {
    return TABS.reduce(
      (acc, tab) => {
        acc[tab.key] = filterPriorities(priorities, tab.key).length;
        return acc;
      },
      {} as Record<TabKey, number>
    );
  }, [priorities]);

  const filtered = useMemo(
    () => filterPriorities(priorities, activeTab),
    [priorities, activeTab]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
    >
      <SectionCard
        title="Today's Priorities"
        subtitle="Sorted by impact"
        icon={Zap}
        headerRight={
          <div className="flex items-center gap-1 bg-[hsl(var(--kf-muted))] rounded-lg p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="relative px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                style={{
                  color:
                    activeTab === tab.key
                      ? "hsl(var(--kf-foreground))"
                      : "hsl(var(--kf-muted-foreground))",
                }}
              >
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="cockpit-priority-tab"
                    className="absolute inset-0 bg-[hsl(var(--kf-card))] rounded-md shadow-sm border border-[hsl(var(--kf-border))]"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  {tab.label}
                  {tabCounts[tab.key] > 0 && (
                    <span
                      className="text-[9px] px-1 py-0 rounded-full"
                      style={{
                        background:
                          activeTab === tab.key
                            ? "hsl(var(--kf-accent1))"
                            : "hsl(var(--kf-muted-foreground)/0.15)",
                        color:
                          activeTab === tab.key
                            ? "white"
                            : "hsl(var(--kf-muted-foreground))",
                      }}
                    >
                      {tabCounts[tab.key]}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        }
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: activeTab === "now" ? -8 : 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activeTab === "now" ? 8 : -8 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "done" ? (
              <div className="text-center py-8">
                <p className="text-sm font-medium text-[hsl(var(--kf-success))]">
                  All caught up
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Completed actions will appear here
                </p>
              </div>
            ) : filtered.length > 0 ? (
              <PriorityQueue
                priorities={filtered}
                businessId={businessId}
                onActionExecuted={onActionExecuted}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-sm font-medium text-[hsl(var(--kf-success))]">
                  All clear
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  No items in this category right now
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </SectionCard>
    </motion.div>
  );
}
