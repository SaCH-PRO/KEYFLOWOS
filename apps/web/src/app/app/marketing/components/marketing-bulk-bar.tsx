"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, Send, ToggleRight, ToggleLeft, X, Loader2, CheckSquare } from "lucide-react";

interface MarketingBulkBarProps {
  selectedCount: number;
  totalCount: number;
  mode: "campaigns" | "forms";
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  onBulkSend?: () => void;
  onBulkActivate?: () => void;
  onBulkDeactivate?: () => void;
  loading?: boolean;
}

export function MarketingBulkBar({
  selectedCount,
  totalCount,
  mode,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  onBulkSend,
  onBulkActivate,
  onBulkDeactivate,
  loading,
}: MarketingBulkBarProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        className="kf-card border border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5 p-3 rounded-xl flex items-center gap-2 flex-wrap"
      >
        <CheckSquare className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <span className="text-sm font-medium">{selectedCount} selected</span>
        <button
          onClick={selectedCount === totalCount ? onClearSelection : onSelectAll}
          className="text-xs px-2.5 py-1 rounded-lg bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          {selectedCount === totalCount ? "Deselect All" : "Select All"}
        </button>

        <div className="h-4 w-px bg-border/50 mx-1" />

        {mode === "campaigns" && onBulkSend && (
          <button
            onClick={onBulkSend}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send Selected
          </button>
        )}

        {mode === "forms" && onBulkActivate && (
          <button
            onClick={onBulkActivate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ToggleRight className="w-3.5 h-3.5" />}
            Activate
          </button>
        )}

        {mode === "forms" && onBulkDeactivate && (
          <button
            onClick={onBulkDeactivate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ToggleLeft className="w-3.5 h-3.5" />}
            Deactivate
          </button>
        )}

        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Delete
        </button>

        <div className="flex-1" />

        <button
          onClick={onClearSelection}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="relative kf-card border border-border rounded-2xl p-6 max-w-sm w-full"
            >
              <div className="text-center">
                <Trash2 className="w-10 h-10 mx-auto mb-3 text-red-400" />
                <h3 className="text-lg font-semibold mb-2">
                  Delete {selectedCount} {mode === "campaigns" ? "campaign" : "form"}{selectedCount > 1 ? "s" : ""}?
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { onBulkDelete(); setShowDeleteConfirm(false); }}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl text-sm font-medium flex-1 bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Delete All
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/50 flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
