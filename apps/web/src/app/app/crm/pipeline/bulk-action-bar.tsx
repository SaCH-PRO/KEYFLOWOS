"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { UserCheck, Tag, Send, X, ChevronDown, Trash2, ListPlus, Loader2 } from "lucide-react";
import { Button } from "@keyflow/ui";

export interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onStatusChange: (status: string) => void;
  onAddTag: (tag: string) => void;
  onBulkDelete: () => void;
  onBroadcast: () => void;
  onCancel: () => void;
  onAddToList?: (listId: string) => void;
  lists?: { id: string; name: string }[];
  loading?: boolean;
}

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

function BulkActionBarInner({
  selectedCount,
  totalCount,
  onSelectAll,
  onStatusChange,
  onAddTag,
  onBulkDelete,
  onBroadcast,
  onCancel,
  onAddToList,
  lists,
  loading = false,
}: BulkActionBarProps) {
  const [showStatus, setShowStatus] = useState(false);
  const [showTag, setShowTag] = useState(false);
  const [showList, setShowList] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const statusRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const closeAllDropdowns = useCallback(() => {
    setShowStatus(false);
    setShowTag(false);
    setShowList(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
          setDeleteConfirmText("");
        } else {
          closeAllDropdowns();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showDeleteConfirm, closeAllDropdowns]);

  const handleStatusChange = useCallback((s: string) => {
    onStatusChange(s);
    setShowStatus(false);
  }, [onStatusChange]);

  const handleTagSubmit = useCallback(() => {
    if (tagInput.trim()) {
      onAddTag(tagInput.trim());
      setTagInput("");
      setShowTag(false);
    }
  }, [tagInput, onAddTag]);

  const isDisabled = selectedCount === 0 || loading;

  return (
    <>
    <div className="kf-card border border-[hsl(var(--kf-accent2))]/30 bg-[hsl(var(--kf-accent2))]/5 p-3 rounded-xl flex items-center gap-2 flex-wrap" role="toolbar" aria-label="Bulk actions">
      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <button
        onClick={onSelectAll}
        className="kf-btn-secondary text-sm px-3 min-h-[44px]"
      >
        {selectedCount === totalCount ? "Deselect All" : "Select All"}
      </button>

      <div className="h-4 w-px bg-border/50 mx-1" />

      <div className="relative" ref={statusRef}>
        <button
          onClick={() => { setShowStatus(!showStatus); setShowTag(false); setShowList(false); }}
          disabled={isDisabled}
          className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px] disabled:opacity-50"
          aria-label="Change status"
          aria-haspopup="listbox"
          aria-expanded={showStatus}
        >
          <UserCheck className="w-4 h-4" />
          Status
          <ChevronDown className="w-3 h-3" />
        </button>
        {showStatus && (
          <>
            <div className="fixed inset-0 z-40 bg-background/30 backdrop-blur-sm" onClick={() => setShowStatus(false)} />
            <div role="listbox" aria-label="Contact status options" className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 z-50 kf-card border border-border shadow-2xl rounded-xl py-2 sm:w-44 max-h-[80vh] overflow-y-auto">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  role="option"
                  aria-selected={false}
                  onClick={() => handleStatusChange(s)}
                  className="w-full text-left px-4 min-h-[44px] flex items-center text-sm hover:bg-muted/50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative" ref={tagRef}>
        <button
          onClick={() => { setShowTag(!showTag); setShowStatus(false); setShowList(false); }}
          disabled={isDisabled}
          className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px] disabled:opacity-50"
          aria-label="Add tag"
          aria-haspopup="dialog"
          aria-expanded={showTag}
        >
          <Tag className="w-4 h-4" />
          Tag
        </button>
        {showTag && (
          <>
            <div className="fixed inset-0 z-40 bg-background/30 backdrop-blur-sm" onClick={() => setShowTag(false)} />
            <div className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 z-50 kf-card border border-border shadow-2xl rounded-xl p-4 sm:w-64 max-h-[80vh] overflow-y-auto">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Add Tag</p>
              <input
                type="text"
                placeholder="Enter tag name..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleTagSubmit(); }}
                className="kf-input w-full text-sm mb-2 min-h-[44px]"
                autoFocus
              />
              <button
                onClick={handleTagSubmit}
                disabled={!tagInput.trim()}
                className="kf-btn-primary w-full text-sm min-h-[44px] disabled:opacity-50"
              >
                Apply Tag
              </button>
            </div>
          </>
        )}
      </div>

      {onAddToList && lists && lists.length > 0 && (
        <div className="relative" ref={listRef}>
          <button
            onClick={() => { setShowList(!showList); setShowStatus(false); setShowTag(false); }}
            disabled={isDisabled}
            className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px] disabled:opacity-50"
            aria-label="Add to list"
            aria-haspopup="listbox"
            aria-expanded={showList}
          >
            <ListPlus className="w-4 h-4" />
            Add to List
            <ChevronDown className="w-3 h-3" />
          </button>
          {showList && (
            <>
              <div className="fixed inset-0 z-40 bg-background/30 backdrop-blur-sm" onClick={() => setShowList(false)} />
              <div role="listbox" aria-label="Available lists" className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 z-50 kf-card border border-border shadow-2xl rounded-xl py-2 sm:w-52 max-h-[80vh] overflow-y-auto">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    role="option"
                    aria-selected={false}
                    onClick={() => { onAddToList(l.id); setShowList(false); }}
                    className="w-full text-left px-4 min-h-[44px] flex items-center text-sm hover:bg-muted/50 transition-colors"
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setShowDeleteConfirm(true)}
        disabled={isDisabled}
        className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px] text-[hsl(var(--kf-error))] hover:text-[hsl(var(--kf-error))]/80 disabled:opacity-50"
        aria-label={`Delete ${selectedCount} selected contacts`}
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>

      <button
        onClick={onBroadcast}
        disabled={isDisabled}
        className="kf-btn-primary inline-flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-50"
        aria-label={`Broadcast to ${selectedCount} selected contacts`}
      >
        <Send className="w-4 h-4" />
        Broadcast
      </button>

      <button
        onClick={onCancel}
        className="ml-auto p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-label="Exit select mode"
      >
        <X className="w-4 h-4" />
      </button>
    </div>

    {showDeleteConfirm && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title" aria-describedby="bulk-delete-desc">
        <div
          className="absolute inset-0 bg-background/60 backdrop-blur-sm"
          onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }}
        />
        <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-border/60 kf-card p-6 shadow-2xl">
          <h3 className="text-lg font-semibold mb-2" id="bulk-delete-title">Delete {selectedCount} contact{selectedCount !== 1 ? "s" : ""}?</h3>
          <p className="text-sm text-muted-foreground mb-4" id="bulk-delete-desc">
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

export const BulkActionBar = React.memo(BulkActionBarInner);
