"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { LauncherTone } from "@/components/ui/module-launcher-sheet";
import { Plus, Receipt, FileText, RefreshCw, DollarSign, ChevronDown } from "lucide-react";

interface RevenueActionMenuProps {
  onNewInvoice: () => void;
  onNewQuote: () => void;
  onNewRecurring: () => void;
  onRecordPayment: () => void;
}

const actions: {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  shortcut: string;
  tone: LauncherTone;
}[] = [
  { key: "invoice", label: "New Invoice", description: "Create and send an invoice", icon: Receipt, shortcut: "I", tone: "orange" },
  { key: "quote", label: "New Quote", description: "Send a pricing quote", icon: FileText, shortcut: "Q", tone: "sky" },
  { key: "recurring", label: "New Recurring", description: "Set up a subscription or repeat invoice", icon: RefreshCw, shortcut: "R", tone: "violet" },
  { key: "payment", label: "Record Payment", description: "Log a payment received", icon: DollarSign, shortcut: "P", tone: "mint" },
];

const TONE_CLASSES: Record<LauncherTone, { bg: string; text: string }> = {
  default: { bg: "bg-muted/50", text: "text-muted-foreground" },
  primary: { bg: "bg-primary/10", text: "text-primary" },
  violet: { bg: "bg-violet/10", text: "text-violet" },
  gold: { bg: "bg-gold/10", text: "text-gold" },
  rose: { bg: "bg-rose/10", text: "text-rose" },
  mint: { bg: "bg-mint/10", text: "text-mint" },
  sky: { bg: "bg-sky/10", text: "text-sky" },
  orange: { bg: "bg-primary/10", text: "text-primary" },
  teal: { bg: "bg-secondary/10", text: "text-secondary" },
};

export function RevenueActionMenu({
  onNewInvoice,
  onNewQuote,
  onNewRecurring,
  onRecordPayment,
}: RevenueActionMenuProps) {
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
    invoice: onNewInvoice,
    quote: onNewQuote,
    recurring: onNewRecurring,
    payment: onRecordPayment,
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        data-walkthrough="commerce-new"
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
              {actions.map((action, idx) => {
                const Icon = action.icon;
                const tone = TONE_CLASSES[action.tone];
                return (
                  <motion.button
                    key={action.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04, duration: 0.2 }}
                    onClick={() => {
                      handlers[action.key]();
                      setOpen(false);
                    }}
                    className="flex items-start gap-3 w-full px-3 py-2.5 rounded-xl text-left hover:bg-muted/50 transition-colors group"
                  >
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", tone.bg)}>
                      <Icon className={cn("w-3.5 h-3.5", tone.text)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{action.label}</span>
                        <span className="text-[10px] text-muted-foreground/50 font-mono">{action.shortcut}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground/70">{action.description}</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
