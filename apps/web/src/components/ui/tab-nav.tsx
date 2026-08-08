"use client";

import { useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { RichTooltip } from "@/components/ui/rich-tooltip";

interface TabItem {
  key: string;
  label: string;
  icon?: React.ElementType;
  count?: number;
  tooltip?: string;
}

interface TabNavProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  layoutId?: string;
  variant?: "underline" | "pill";
}

export function TabNav({ tabs, activeTab, onTabChange, layoutId = "tab-underline", variant = "underline" }: TabNavProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const activeIndex = tabs.findIndex((t) => t.key === activeTab);

  const goToTab = useCallback(
    (direction: 1 | -1) => {
      const next = activeIndex + direction;
      if (next >= 0 && next < tabs.length) {
        onTabChange(tabs[next].key);
      }
    },
    [activeIndex, tabs, onTabChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); goToTab(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goToTab(-1); }
      else if (e.key === "Home") { e.preventDefault(); onTabChange(tabs[0].key); }
      else if (e.key === "End") { e.preventDefault(); onTabChange(tabs[tabs.length - 1].key); }
    },
    [goToTab, onTabChange, tabs],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTab]);

  const isPill = variant === "pill";

  return (
    <div className={cn("relative mb-4", !isPill && "border-b border-border")}>
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Navigation tabs"
        onKeyDown={handleKeyDown}
        className={cn(
          "flex overflow-x-auto scrollbar-hide",
          isPill ? "gap-1.5 p-1 rounded-xl bg-muted/30 border border-border/30" : "gap-0"
        )}
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          const btn = (
            <button
              key={t.key}
              role="tab"
              id={`${layoutId}-tab-${t.key}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(t.key)}
              className={cn(
                "group relative flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 outline-none kf-text-body font-medium transition-all duration-200",
                "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                isPill
                  ? cn(
                      "px-3 py-1.5 rounded-lg border",
                      isActive
                        ? "bg-card text-foreground border-border shadow-sm"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )
                  : cn(
                      "px-3 py-2",
                      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )
              )}
            >
              {isActive && !isPill && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-primary"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
                />
              )}

              {Icon && (
                <Icon
                  className={cn(
                    "w-3.5 h-3.5 flex-shrink-0 transition-colors",
                    isActive && "text-primary",
                    !isPill && !isActive && "opacity-60 group-hover:opacity-80"
                  )}
                />
              )}
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span
                  className={cn(
                    "kf-text-micro tabular-nums rounded-full px-1.5 py-px",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "opacity-50"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
          return t.tooltip ? (
            <RichTooltip key={t.key} title={t.tooltip!} side="bottom">
              {btn}
            </RichTooltip>
          ) : (
            <span key={t.key}>{btn}</span>
          );
        })}
      </div>
    </div>
  );
}
