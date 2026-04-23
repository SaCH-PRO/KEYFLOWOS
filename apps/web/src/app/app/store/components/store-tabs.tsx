"use client";

import { motion } from "framer-motion";
import { VIEW_TABS, type TabKey } from "./store-types";

interface StoreTabsProps {
  activeView: TabKey;
  onViewChange: (key: TabKey) => void;
}

export function StoreTabs({ activeView, onViewChange }: StoreTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {VIEW_TABS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => onViewChange(t.key)}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${
              activeView === t.key
                ? ""
                : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted)/0.5)]"
            }`}
          >
            {activeView === t.key && (
              <motion.div
                layoutId="store-tab-pill"
                className="absolute inset-0 rounded-xl"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.1))",
                  border: "1px solid hsl(var(--kf-accent1) / 0.25)",
                  boxShadow: "0 2px 12px hsl(var(--kf-accent1) / 0.1)",
                }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span
              className="relative z-10 flex items-center gap-2"
              style={activeView === t.key ? { color: "hsl(var(--kf-accent1))" } : {}}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
