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

export function TabNav({ tabs, activeTab, onTabChange, layoutId = "tab-folder" }: TabNavProps) {
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
    <div className="relative">
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Navigation tabs"
        onKeyDown={handleKeyDown}
        className="flex overflow-x-auto scrollbar-hide -mb-px"
      >
        {tabs.map((t, i) => {
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
              style={{ zIndex: isActive ? 10 : tabs.length - i }}
              className={`group relative flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0
                transition-colors duration-200 outline-none
                focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.5)] focus-visible:ring-offset-1 focus-visible:ring-offset-background
                px-4 sm:px-5 py-2.5 sm:py-3
                text-xs sm:text-sm font-semibold
                rounded-t-xl
                border-x border-t border-b-0
                ${isActive
                  ? "bg-card/80 backdrop-blur-sm text-foreground border-border/40"
                  : "bg-transparent text-muted-foreground/50 border-transparent hover:text-muted-foreground/80 hover:bg-white/[0.03]"
                }`}
            >
              {isActive && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl"
                  style={{
                    background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}

              {isActive && (
                <motion.div
                  layoutId={`${layoutId}-bg`}
                  className="absolute inset-0 rounded-t-xl"
                  style={{
                    background: "linear-gradient(180deg, hsl(var(--kf-accent1) / 0.06) 0%, transparent 100%)",
                  }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}

              {Icon && (
                <Icon
                  className={`relative z-10 w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0 transition-colors duration-200 ${
                    isActive ? "" : "group-hover:text-muted-foreground/70"
                  }`}
                  style={isActive ? { color: "hsl(var(--kf-accent1))" } : undefined}
                />
              )}
              <span className="relative z-10">{t.label}</span>
              {t.count !== undefined && (
                <span
                  className={`relative z-10 text-[10px] sm:text-xs tabular-nums rounded-full px-1.5 py-px ${
                    isActive
                      ? "bg-[hsl(var(--kf-accent1)/0.15)] text-[hsl(var(--kf-accent1))]"
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

      <div className="h-px bg-border/40" />

      <div className="absolute bottom-0 left-0 right-0 h-px pointer-events-none">
        {activeIndex >= 0 && (
          <motion.div
            className="absolute bottom-0 h-px bg-card/80"
            animate={{
              left: `${(activeIndex / tabs.length) * 100}%`,
              width: `${100 / tabs.length}%`,
            }}
            transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
          />
        )}
      </div>
    </div>
  );
}
