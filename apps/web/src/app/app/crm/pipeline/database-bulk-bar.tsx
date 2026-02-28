"use client";

import { memo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckSquare,
  RefreshCw,
  ChevronDown,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { BulkAction } from "./hooks/use-database-state";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"];

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-amber-500/20 text-amber-400",
  PROSPECT: "bg-blue-500/20 text-blue-400",
  CLIENT: "bg-green-500/20 text-green-400",
  LOST: "bg-red-500/20 text-red-400",
};

interface DatabaseBulkBarProps {
  selectedCount: number;
  bulkActing: boolean;
  activeBulkAction: BulkAction;
  onSetBulkAction: (action: BulkAction) => void;
  bulkTagInput: string;
  onBulkTagInputChange: (value: string) => void;
  onBulkStatusChange: (status: string) => void;
  onBulkAddTags: (tagInput: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

function DatabaseBulkBarInner({
  selectedCount,
  bulkActing,
  activeBulkAction,
  onSetBulkAction,
  bulkTagInput,
  onBulkTagInputChange,
  onBulkStatusChange,
  onBulkAddTags,
  onBulkDelete,
  onClearSelection,
}: DatabaseBulkBarProps) {
  const toggleStatusAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "status" ? null : "status");
  }, [activeBulkAction, onSetBulkAction]);

  const toggleTagsAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "tags" ? null : "tags");
  }, [activeBulkAction, onSetBulkAction]);

  const handleApplyTags = useCallback(() => {
    onBulkAddTags(bulkTagInput);
  }, [bulkTagInput, onBulkAddTags]);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") onBulkAddTags(bulkTagInput);
  }, [bulkTagInput, onBulkAddTags]);

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 kf-card border border-border shadow-2xl rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
          role="toolbar"
          aria-label={`Bulk actions for ${selectedCount} selected contacts`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckSquare className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <span>{selectedCount} selected</span>
          </div>

          <div className="h-5 w-px bg-border/50" aria-hidden="true" />

          <div className="relative">
            <button
              onClick={toggleStatusAction}
              disabled={bulkActing}
              className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
              aria-label="Change status of selected contacts"
              aria-haspopup="listbox"
              aria-expanded={activeBulkAction === "status"}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Change Status
              <ChevronDown className="w-3 h-3" />
            </button>
            {activeBulkAction === "status" && (
              <div
                className="absolute bottom-full left-0 mb-2 kf-card border border-border shadow-xl rounded-lg py-1 w-36 z-50"
                role="listbox"
                aria-label="Select new status"
              >
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => onBulkStatusChange(s)}
                    disabled={bulkActing}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
                    role="option"
                  >
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[s]}`}>{s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={toggleTagsAction}
              disabled={bulkActing}
              className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
              aria-label="Add tags to selected contacts"
              aria-expanded={activeBulkAction === "tags"}
            >
              <Tag className="w-3.5 h-3.5" />
              Add Tags
            </button>
            {activeBulkAction === "tags" && (
              <div className="absolute bottom-full left-0 mb-2 kf-card border border-border shadow-xl rounded-lg p-3 w-56 z-50">
                <label htmlFor="bulk-tag-input" className="sr-only">Tags (comma-separated)</label>
                <input
                  id="bulk-tag-input"
                  type="text"
                  value={bulkTagInput}
                  onChange={(e) => onBulkTagInputChange(e.target.value)}
                  placeholder="tag1, tag2, ..."
                  className="kf-input w-full text-xs mb-2"
                  onKeyDown={handleTagKeyDown}
                />
                <button
                  onClick={handleApplyTags}
                  disabled={bulkActing || !bulkTagInput.trim()}
                  className="kf-btn-primary w-full text-xs disabled:opacity-50"
                >
                  Apply Tags
                </button>
              </div>
            )}
          </div>

          <button
            onClick={onBulkDelete}
            disabled={bulkActing}
            className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:border-red-400/50"
            aria-label={`Delete ${selectedCount} selected contacts`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>

          <button
            onClick={onClearSelection}
            className="ml-1 p-1 hover:bg-muted/50 rounded"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const DatabaseBulkBar = memo(DatabaseBulkBarInner);
