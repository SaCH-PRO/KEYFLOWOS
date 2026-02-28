"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckSquare,
  RefreshCw,
  ChevronDown,
  Tag,
  Trash2,
  X,
  List,
  Loader2,
} from "lucide-react";
import type { BulkAction, ListSummary } from "./hooks/use-database-state";

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
  onBulkAddToList: (listId: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  availableLists: ListSummary[];
  allPagesSelected?: boolean;
  totalFiltered?: number;
  onSelectAllPages?: () => void;
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
  onBulkAddToList,
  onBulkDelete,
  onClearSelection,
  availableLists,
  allPagesSelected,
  totalFiltered,
  onSelectAllPages,
}: DatabaseBulkBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeBulkAction) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        onSetBulkAction(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSetBulkAction(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeBulkAction, onSetBulkAction]);

  const toggleStatusAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "status" ? null : "status");
  }, [activeBulkAction, onSetBulkAction]);

  const toggleTagsAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "tags" ? null : "tags");
  }, [activeBulkAction, onSetBulkAction]);

  const toggleAddToListAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "addToList" ? null : "addToList");
  }, [activeBulkAction, onSetBulkAction]);

  const handleApplyTags = useCallback(() => {
    onBulkAddTags(bulkTagInput);
  }, [bulkTagInput, onBulkAddTags]);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") onBulkAddTags(bulkTagInput);
  }, [bulkTagInput, onBulkAddTags]);

  const manualLists = availableLists.filter((l) => l.type === "MANUAL");

  const showSelectAllBanner = !allPagesSelected && totalFiltered && totalFiltered > selectedCount;

  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          ref={barRef}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 kf-card border border-border shadow-2xl rounded-xl px-4 py-3 flex flex-col items-center gap-2 max-w-[95vw]"
          role="toolbar"
          aria-label={`Bulk actions for ${selectedCount} selected contacts`}
        >
          {showSelectAllBanner && (
            <div className="text-xs text-muted-foreground">
              All {selectedCount} on this page selected.{" "}
              <button
                onClick={onSelectAllPages}
                className="text-[hsl(var(--kf-accent1))] hover:underline font-medium"
              >
                Select all {totalFiltered} contacts
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap justify-center">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckSquare className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <span>{selectedCount} selected</span>
              {allPagesSelected && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
                  all pages
                </span>
              )}
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
                {bulkActing && activeBulkAction === "status" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
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
                aria-haspopup="true"
                aria-expanded={activeBulkAction === "tags"}
              >
                {bulkActing && activeBulkAction === "tags" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Tag className="w-3.5 h-3.5" />
                )}
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
                    autoFocus
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

            <div className="relative">
              <button
                onClick={toggleAddToListAction}
                disabled={bulkActing}
                className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
                aria-label="Add selected contacts to a list"
                aria-haspopup="listbox"
                aria-expanded={activeBulkAction === "addToList"}
              >
                {bulkActing && activeBulkAction === "addToList" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <List className="w-3.5 h-3.5" />
                )}
                Add to List
                <ChevronDown className="w-3 h-3" />
              </button>
              {activeBulkAction === "addToList" && (
                <div
                  className="absolute bottom-full left-0 mb-2 kf-card border border-border shadow-xl rounded-lg py-1 w-48 z-50 max-h-48 overflow-y-auto"
                  role="listbox"
                  aria-label="Select a list"
                >
                  {manualLists.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No manual lists yet. Create one first.
                    </div>
                  ) : (
                    manualLists.map((list) => (
                      <button
                        key={list.id}
                        onClick={() => onBulkAddToList(list.id)}
                        disabled={bulkActing}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50 flex items-center gap-2"
                        role="option"
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: list.color || "#888" }}
                        />
                        <span className="truncate flex-1">{list.name}</span>
                        <span className="text-[10px] text-muted-foreground">{list.contactCount}</span>
                      </button>
                    ))
                  )}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const DatabaseBulkBar = memo(DatabaseBulkBarInner);
