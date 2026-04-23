"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import { Button } from "@keyflow/ui";
import type { BulkAction, ListSummary } from "./hooks/use-database-state";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"];

const STATUS_COLORS: Record<string, string> = {
  LEAD: "bg-[hsl(var(--kf-warning))]/15 text-[hsl(var(--kf-warning))] border-[hsl(var(--kf-warning))]/20",
  PROSPECT: "bg-[hsl(var(--kf-info))]/15 text-[hsl(var(--kf-info))] border-[hsl(var(--kf-info))]/20",
  CLIENT: "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))] border-[hsl(var(--kf-success))]/20",
  LOST: "bg-[hsl(var(--kf-error))]/15 text-[hsl(var(--kf-error))] border-[hsl(var(--kf-error))]/20",
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  useEffect(() => {
    if (!activeBulkAction) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        onSetBulkAction(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
          setDeleteConfirmText("");
        } else {
          onSetBulkAction(null);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeBulkAction, onSetBulkAction, showDeleteConfirm]);

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
    <>
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          ref={barRef}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border border-border/50 bg-popover/95 backdrop-blur-xl shadow-2xl px-4 py-3 flex flex-col items-center gap-2 max-w-[95vw]"
          role="toolbar"
          aria-label={`Bulk actions for ${selectedCount} selected contacts`}
        >
          {showSelectAllBanner && (
            <div className="text-[11px] text-muted-foreground/60">
              All {selectedCount} on this page selected.{" "}
              <button
                onClick={onSelectAllPages}
                className="text-[hsl(var(--kf-accent1))] hover:underline font-semibold min-h-[44px]"
              >
                Select all {totalFiltered} contacts
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap justify-center">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <CheckSquare className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
              <span>{selectedCount} selected</span>
              {allPagesSelected && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
                  all pages
                </span>
              )}
            </div>

            <div className="h-4 w-px bg-border/40" aria-hidden="true" />

            <div className="relative">
              <button
                onClick={toggleStatusAction}
                disabled={bulkActing}
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-all disabled:opacity-40"
                aria-label="Change status of selected contacts"
                aria-haspopup="listbox"
                aria-expanded={activeBulkAction === "status"}
              >
                {bulkActing && activeBulkAction === "status" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 text-muted-foreground/60" />
                )}
                Status
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {activeBulkAction === "status" && (
                <div
                  className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 w-36 z-50"
                  role="listbox"
                  aria-label="Select new status"
                >
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => onBulkStatusChange(s)}
                      disabled={bulkActing}
                      className="w-full text-left px-3 min-h-[44px] flex items-center text-[11px] hover:bg-muted/30 transition-colors disabled:opacity-50"
                      role="option"
                      aria-selected={false}
                    >
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border ${STATUS_COLORS[s]}`}>{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={toggleTagsAction}
                disabled={bulkActing}
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-all disabled:opacity-40"
                aria-label="Add tags to selected contacts"
                aria-haspopup="true"
                aria-expanded={activeBulkAction === "tags"}
              >
                {bulkActing && activeBulkAction === "tags" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Tag className="w-3 h-3 text-muted-foreground/60" />
                )}
                Tags
              </button>
              {activeBulkAction === "tags" && (
                <div className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl p-3 w-52 z-50">
                  <label htmlFor="bulk-tag-input" className="sr-only">Tags (comma-separated)</label>
                  <input
                    id="bulk-tag-input"
                    type="text"
                    value={bulkTagInput}
                    onChange={(e) => onBulkTagInputChange(e.target.value)}
                    placeholder="tag1, tag2, ..."
                    className="kf-input w-full text-[11px] min-h-[44px] mb-2"
                    onKeyDown={handleTagKeyDown}
                    autoFocus
                  />
                  <button
                    onClick={handleApplyTags}
                    disabled={bulkActing || !bulkTagInput.trim()}
                    className="w-full px-3 min-h-[44px] text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all disabled:opacity-40"
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
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-all disabled:opacity-40"
                aria-label="Add selected contacts to a list"
                aria-haspopup="listbox"
                aria-expanded={activeBulkAction === "addToList"}
              >
                {bulkActing && activeBulkAction === "addToList" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <List className="w-3 h-3 text-muted-foreground/60" />
                )}
                List
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {activeBulkAction === "addToList" && (
                <div
                  className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 w-48 z-50 max-h-48 overflow-y-auto"
                  role="listbox"
                  aria-label="Select a list"
                >
                  {manualLists.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground/60">
                      No manual lists yet. Create one first.
                    </div>
                  ) : (
                    manualLists.map((list) => (
                      <button
                        key={list.id}
                        onClick={() => onBulkAddToList(list.id)}
                        disabled={bulkActing}
                        className="w-full text-left px-3 min-h-[44px] flex items-center text-[11px] hover:bg-muted/30 transition-colors disabled:opacity-50 gap-2"
                        role="option"
                        aria-selected={false}
                      >
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: list.color || "#888" }}
                        />
                        <span className="truncate flex-1">{list.name}</span>
                        <span className="text-[10px] text-muted-foreground/50 font-mono">{list.contactCount}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={bulkActing}
              className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-[hsl(var(--kf-error))]/30 bg-[hsl(var(--kf-error))]/[0.08] text-[hsl(var(--kf-error))]/80 hover:bg-[hsl(var(--kf-error))]/15 hover:text-[hsl(var(--kf-error))] transition-all disabled:opacity-40"
              aria-label={`Delete ${selectedCount} selected contacts`}
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>

            <button
              onClick={onClearSelection}
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-muted/30 rounded-md transition-colors"
              aria-label="Clear selection"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground/40" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {showDeleteConfirm && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="db-bulk-delete-title" aria-describedby="db-bulk-delete-desc">
        <div
          className="absolute inset-0 bg-background/60 backdrop-blur-sm"
          onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }}
        />
        <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-border/60 kf-card p-6 shadow-2xl">
          <h3 className="text-lg font-semibold mb-2" id="db-bulk-delete-title">Delete {selectedCount} contact{selectedCount !== 1 ? "s" : ""}?</h3>
          <p className="text-sm text-muted-foreground mb-4" id="db-bulk-delete-desc">
            This action cannot be undone. Type <span className="font-mono font-bold text-[hsl(var(--kf-error))]">DELETE</span> to confirm.
          </p>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            className="kf-input w-full text-sm min-h-[44px] mb-4"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="subtle" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              onClick={() => { onBulkDelete(); setShowDeleteConfirm(false); setDeleteConfirmText(""); }}
              disabled={deleteConfirmText !== "DELETE"}
              className="bg-[hsl(var(--kf-error))] hover:bg-[hsl(var(--kf-error))]/90 text-foreground min-h-[44px] disabled:opacity-40"
            >
              Delete {selectedCount} Contact{selectedCount !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export const DatabaseBulkBar = memo(DatabaseBulkBarInner);
