"use client";

import React from "react";
import { motion } from "framer-motion";
import { Layers, Receipt, FileText, Paperclip } from "lucide-react";

export type ExpenseView = "all" | "expenses" | "bills" | "receipts";

const VIEWS: { key: ExpenseView; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All", icon: Layers },
  { key: "expenses", label: "Expenses", icon: Receipt },
  { key: "bills", label: "Bills", icon: FileText },
  { key: "receipts", label: "Receipts", icon: Paperclip },
];

interface ExpenseStageBarProps {
  activeView: ExpenseView;
  onChange: (view: ExpenseView) => void;
  counts?: Record<ExpenseView, number>;
}

export function ExpenseStageBar({ activeView, onChange, counts }: ExpenseStageBarProps) {
  return (
    <div className="flex items-center gap-1 bg-white/[0.02] border border-border/40 rounded-xl p-1">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = activeView === v.key;
        const count = counts?.[v.key] ?? 0;
        return (
          <button
            key={v.key}
            onClick={() => onChange(v.key)}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              active
                ? "text-rose-400"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active && (
              <motion.div
                layoutId="expense-stage-indicator"
                className="absolute inset-0 rounded-lg bg-rose-500/10 border border-rose-500/20"
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon className="w-3 h-3" />
              {v.label}
              {count > 0 && (
                <span className={`text-[10px] tabular-nums ${active ? "text-rose-400/70" : "text-muted-foreground/50"}`}>
                  {count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
