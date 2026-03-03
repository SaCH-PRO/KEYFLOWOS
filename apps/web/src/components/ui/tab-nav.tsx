"use client";

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
  return (
    <div className="relative">
      <div
        role="tablist"
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory -mb-px"
      >
        {tabs.map((t, i) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(t.key)}
              style={{ zIndex: isActive ? 10 : tabs.length - i }}
              className={`relative flex items-center gap-1.5 sm:gap-2 whitespace-nowrap snap-start flex-shrink-0 transition-all duration-200 active:scale-[0.98]
                px-3 sm:px-5 py-2 sm:py-2.5
                text-xs sm:text-sm font-semibold
                rounded-t-lg
                border border-b-0
                ${isActive
                  ? "bg-card text-foreground border-border/60 shadow-[0_-2px_8px_hsl(var(--kf-accent1)/0.08)]"
                  : "bg-white/[0.02] text-muted-foreground/60 border-transparent hover:text-muted-foreground hover:bg-white/[0.04] -ml-px first:ml-0"
                }`}
            >
              {isActive && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-x-0 top-0 h-[2px] rounded-t-lg"
                  style={{
                    background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}

              {Icon && (
                <Icon
                  className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0"
                  style={isActive ? { color: "hsl(var(--kf-accent1))" } : undefined}
                />
              )}
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span
                  className={`text-[10px] sm:text-xs tabular-nums ${
                    isActive
                      ? "text-[hsl(var(--kf-accent1))]"
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
      <div className="h-px bg-border/50" />
    </div>
  );
}
