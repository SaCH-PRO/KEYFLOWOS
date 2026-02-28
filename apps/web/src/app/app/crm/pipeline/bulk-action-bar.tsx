"use client";

import React, { useState } from "react";
import { UserCheck, Tag, Send, X, ChevronDown, Trash2 } from "lucide-react";

export interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onStatusChange: (status: string) => void;
  onAddTag: (tag: string) => void;
  onBulkDelete: () => void;
  onBroadcast: () => void;
  onCancel: () => void;
}

function BulkActionBarInner({
  selectedCount,
  totalCount,
  onSelectAll,
  onStatusChange,
  onAddTag,
  onBulkDelete,
  onBroadcast,
  onCancel,
}: BulkActionBarProps) {
  const [showStatus, setShowStatus] = useState(false);
  const [showTag, setShowTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  return (
    <div className="kf-card border border-[hsl(var(--kf-accent2))]/30 bg-[hsl(var(--kf-accent2))]/5 p-3 rounded-xl flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <button onClick={onSelectAll} className="kf-btn-secondary text-sm px-3 py-1.5">
        {selectedCount === totalCount ? "Deselect All" : "Select All"}
      </button>

      <div className="h-4 w-px bg-border/50 mx-1" />

      <div className="relative">
        <button
          onClick={() => { setShowStatus(!showStatus); setShowTag(false); }}
          disabled={selectedCount === 0}
          className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <UserCheck className="w-4 h-4" />
          Status
          <ChevronDown className="w-3 h-3" />
        </button>
        {showStatus && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setShowStatus(false)} />
            <div className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 z-50 kf-card border border-border shadow-2xl rounded-xl py-2 sm:w-44 max-h-[80vh] overflow-y-auto">
              {(["LEAD", "PROSPECT", "CLIENT", "LOST"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { onStatusChange(s); setShowStatus(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => { setShowTag(!showTag); setShowStatus(false); }}
          disabled={selectedCount === 0}
          className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <Tag className="w-4 h-4" />
          Tag
        </button>
        {showTag && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setShowTag(false)} />
            <div className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 z-50 kf-card border border-border shadow-2xl rounded-xl p-4 sm:w-64 max-h-[80vh] overflow-y-auto">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Add Tag</p>
              <input
                type="text"
                placeholder="Enter tag name..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { onAddTag(tagInput.trim()); setTagInput(""); setShowTag(false); } }}
                className="kf-input w-full text-sm mb-2"
                autoFocus
              />
              <button
                onClick={() => { if (tagInput.trim()) { onAddTag(tagInput.trim()); setTagInput(""); setShowTag(false); } }}
                disabled={!tagInput.trim()}
                className="kf-btn-primary w-full text-sm disabled:opacity-50"
              >
                Apply Tag
              </button>
            </div>
          </>
        )}
      </div>

      <button
        onClick={onBulkDelete}
        disabled={selectedCount === 0}
        className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>

      <button
        onClick={onBroadcast}
        disabled={selectedCount === 0}
        className="kf-btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
      >
        <Send className="w-4 h-4" />
        Broadcast
      </button>

      <button
        onClick={onCancel}
        className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-label="Exit select mode"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export const BulkActionBar = React.memo(BulkActionBarInner);
