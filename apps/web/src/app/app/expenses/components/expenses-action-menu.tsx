"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Receipt, Download, Target, Lightbulb, ChevronDown } from "lucide-react";

interface ExpensesActionMenuProps {
  onAddExpense: () => void;
  onExport: () => void;
  onViewBudgets?: () => void;
  onViewInsights?: () => void;
}

const actions = [
  { key: "add", label: "Add Expense", description: "Log a new expense", icon: Receipt, shortcut: "A" },
  { key: "export", label: "Export CSV", description: "Download expense data", icon: Download, shortcut: "E" },
  { key: "budgets", label: "View Budgets", description: "Check budget status", icon: Target, shortcut: "B" },
  { key: "insights", label: "View Insights", description: "Spending analysis", icon: Lightbulb, shortcut: "I" },
];

export function ExpensesActionMenu({
  onAddExpense,
  onExport,
  onViewBudgets,
  onViewInsights,
}: ExpensesActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handlers: Record<string, () => void> = {
    add: onAddExpense,
    export: onExport,
    budgets: onViewBudgets ?? (() => {}),
    insights: onViewInsights ?? (() => {}),
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        data-walkthrough="expenses-new"
      >
        <Plus className="w-3.5 h-3.5" />
        New
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden z-50"
          >
            <div className="p-1.5">
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.key}
                    onClick={() => {
                      handlers[action.key]();
                      setOpen(false);
                    }}
                    className="flex items-start gap-3 w-full px-3 py-2.5 rounded-lg text-left hover:bg-white/[0.05] transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-border/40 flex items-center justify-center shrink-0 group-hover:border-[hsl(var(--kf-accent1))]/30 transition-colors">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{action.label}</span>
                        <span className="text-[10px] text-muted-foreground/50 font-mono">{action.shortcut}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground/70">{action.description}</span>
                    </div>
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
