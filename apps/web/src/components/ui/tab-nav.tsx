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

export function TabNav({ tabs, activeTab, onTabChange, layoutId = "tab-pill" }: TabNavProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide snap-x snap-mandatory">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap snap-start flex-shrink-0 active:scale-95 ${
              activeTab === t.key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted)/0.5)]"
            }`}
          >
            {activeTab === t.key && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl border shadow-lg"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.12), hsl(var(--kf-accent2) / 0.08))",
                  borderColor: "hsl(var(--kf-accent1) / 0.3)",
                  boxShadow: "0 4px 12px hsl(var(--kf-accent1) / 0.1)",
                }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4" />}
              {t.label}
              {t.count !== undefined && (
                <span className="text-xs opacity-60">({t.count})</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
