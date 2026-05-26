"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRightLeft, Calendar, Percent, FileText } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { Quote } from "@/lib/client";

interface QuoteConvertModalProps {
  quote: Quote | null;
  onClose: () => void;
  onSubmit: (quote: Quote, form: { taxRate: string; dueDate: string; notes: string }) => void;
  loading?: boolean;
}

export function QuoteConvertModal({ quote, onClose, onSubmit, loading }: QuoteConvertModalProps) {
  const [taxRate, setTaxRate] = useState("12.5");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  if (!quote) return null;

  return (
    <AnimatePresence>
      {quote && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-foreground">Convert to Invoice</h3>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Quote summary */}
            <div className="px-5 py-3 bg-white/[0.02] border-b border-border/40">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Quote</span>
                <span className="font-semibold text-foreground">{quote.quoteNumber ?? quote.id.slice(0, 6)}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-foreground">{formatCurrency(quote.total ?? 0, quote.currency)}</span>
              </div>
            </div>

            {/* Form */}
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Percent className="w-3 h-3" /> Tax Rate
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Invoice notes..."
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40 resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-border/40">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors border border-border/40"
              >
                Cancel
              </button>
              <button
                onClick={() => onSubmit(quote, { taxRate, dueDate, notes })}
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors border border-violet-500/30 disabled:opacity-50"
              >
                {loading ? "Converting..." : "Convert"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
