"use client";

import { motion } from "framer-motion";
import { Surface } from "@/components/ui-v2/surface";
import { VIEW_TABS, type TabKey } from "./store-types";

interface StoreTabsProps {
  activeView: TabKey;
  onViewChange: (key: TabKey) => void;
}

export function StoreTabs({ activeView, onViewChange }: StoreTabsProps) {
  return (
    <Surface variant="default" className="p-1 bg-muted/50">
      <div className="flex items-center overflow-x-auto scrollbar-none gap-1">
        {VIEW_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeView === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onViewChange(t.key)}
              className="relative flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap min-h-[40px] flex-shrink-0 focus-ring"
              aria-selected={isActive}
              role="tab"
            >
              {isActive && (
                <motion.div
                  layoutId="store-tab-pill"
                  className="absolute inset-0 rounded-xl bg-card shadow-md border border-border/60"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                />
              )}
              <Icon
                className={`w-3.5 h-3.5 relative z-10 flex-shrink-0 ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <span
                className={`relative z-10 ${
                  isActive ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {t.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="store-tab-dot"
                  className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary z-10"
                />
              )}
            </button>
          );
        })}
      </div>
    </Surface>
  );
}
