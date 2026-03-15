"use client";

import { useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";

interface TabItem {
  key: string;
  label: string;
  icon?: React.ElementType;
  count?: number;
}

interface TabNavProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  layoutId?: string;
}

export function TabNav({ tabs, activeTab, onTabChange, layoutId = "tab-underline" }: TabNavProps) {
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

  return (
    <div className="relative border-b border-border mb-4">
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Navigation tabs"
        onKeyDown={handleKeyDown}
        className="flex overflow-x-auto scrollbar-hide gap-0"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              id={`${layoutId}-tab-${t.key}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(t.key)}
              className={`group relative flex items-center gap-1.5 whitespace-nowrap flex-shrink-0
                transition-colors duration-150 outline-none
                focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.4)] focus-visible:ring-inset
                px-3 py-2
                text-[13px] font-medium
                ${isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              {isActive && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-x-0 bottom-0 h-[2px]"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
                />
              )}

              {Icon && (
                <Icon
                  className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${
                    isActive ? "" : "opacity-60 group-hover:opacity-80"
                  }`}
                  style={isActive ? { color: "hsl(var(--kf-accent1))" } : undefined}
                />
              )}
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span
                  className={`text-[10px] tabular-nums rounded-full px-1.5 py-px ${
                    isActive
                      ? "bg-[hsl(var(--kf-accent1)/0.1)] text-[hsl(var(--kf-accent1))]"
                      : "opacity-50"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
