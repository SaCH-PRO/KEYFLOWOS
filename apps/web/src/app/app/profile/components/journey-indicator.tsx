"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { TabId } from "./profile-types";

export interface CompletenessItem {
  label: string;
  done: boolean;
  tab: TabId;
  icon: React.ElementType;
}

interface JourneyIndicatorProps {
  items: CompletenessItem[];
  onGoTo: (tab: TabId) => void;
}

export function JourneyIndicator({ items, onGoTo }: JourneyIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const color =
    pct >= 80
      ? "hsl(var(--kf-success))"
      : pct >= 50
        ? "hsl(var(--kf-warning))"
        : "hsl(var(--kf-error))";

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`Business foundation progress: ${pct}% complete. ${completed} of ${total} steps done.`}
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px]"
      >
        <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" opacity="0.2" />
            <circle
              cx="20" cy="20" r="16" fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 16}
              strokeDashoffset={2 * Math.PI * 16 - (pct / 100) * 2 * Math.PI * 16}
              className="transition-all duration-700"
            />
          </svg>
          <span className="absolute text-[10px] font-bold" style={{ color }} aria-hidden="true">{pct}%</span>
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Business Foundation
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            {completed}/{total} steps complete
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
          </div>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-1 border-t border-[hsl(var(--border))] pt-2">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => onGoTo(item.tab)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[hsl(var(--muted))] transition-colors min-h-[36px]"
                  >
                    {item.done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} aria-hidden="true" />
                    ) : (
                      <div
                        className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0"
                        style={{ borderColor: "hsl(var(--muted-foreground) / 0.4)" }}
                        aria-hidden="true"
                      />
                    )}
                    <Icon className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] flex-shrink-0" aria-hidden="true" />
                    <span
                      className="text-xs flex-1"
                      style={{
                        color: item.done ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                        textDecoration: item.done ? "line-through" : "none",
                      }}
                    >
                      {item.label}
                      {item.done && <span className="sr-only"> (complete)</span>}
                    </span>
                    {!item.done && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}>
                        Quick win
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
