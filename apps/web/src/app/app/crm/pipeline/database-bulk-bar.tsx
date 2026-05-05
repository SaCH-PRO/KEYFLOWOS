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
  Users,
  Flag,
  Star,
  Archive,
  UserCog,
  Workflow,
} from "lucide-react";
import type { TeamMemberSummary } from "@/lib/client";
import { Button } from "@keyflow/ui";
import type { CrmSequence } from "@/lib/client";
import type { BulkAction, ListSummary } from "./hooks/use-database-state";
import {
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_RELATIONSHIP_TYPE_LABELS,
  CONTACT_PRIORITIES,
  CONTACT_PRIORITY_LABELS,
} from "@/lib/crm-constants";

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
  onBulkRelationshipTypeChange: (relationshipType: string | null) => void;
  onBulkPriorityChange: (priority: string | null) => void;
  onBulkToggleFavorite: (favorite: boolean) => void;
  onBulkArchive: (archived: boolean) => void;
  onBulkEnrollInSequence?: (sequenceId: string) => void;
  activeSequences?: CrmSequence[];
  onBulkDelete: () => void;
  onBulkReassign?: (newOwnerId: string) => void;
  teamMembers?: TeamMemberSummary[];
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
  onBulkRelationshipTypeChange,
  onBulkPriorityChange,
  onBulkToggleFavorite,
  onBulkArchive,
  onBulkEnrollInSequence,
  activeSequences = [],
  onBulkDelete,
  onBulkReassign,
  teamMembers,
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

  const toggleRelationshipTypeAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "relationshipType" ? null : "relationshipType");
  }, [activeBulkAction, onSetBulkAction]);

  const togglePriorityAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "priority" ? null : "priority");
  }, [activeBulkAction, onSetBulkAction]);

  const toggleReassignAction = useCallback(() => {
    onSetBulkAction(activeBulkAction === "reassign" ? null : "reassign");
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

            <div className="relative">
              <button
                onClick={toggleRelationshipTypeAction}
                disabled={bulkActing}
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-all disabled:opacity-40"
                aria-label="Set relationship type for selected contacts"
                aria-haspopup="listbox"
                aria-expanded={activeBulkAction === "relationshipType"}
              >
                {bulkActing && activeBulkAction === "relationshipType" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Users className="w-3 h-3 text-muted-foreground/60" />
                )}
                Relationship
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {activeBulkAction === "relationshipType" && (
                <div
                  className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 w-44 z-50 max-h-64 overflow-y-auto"
                  role="listbox"
                  aria-label="Select relationship type"
                >
                  {CONTACT_RELATIONSHIP_TYPES.map((rt) => (
                    <button
                      key={rt}
                      onClick={() => onBulkRelationshipTypeChange(rt)}
                      disabled={bulkActing}
                      className="w-full text-left px-3 min-h-[44px] flex items-center text-[11px] hover:bg-muted/30 transition-colors disabled:opacity-50"
                      role="option"
                      aria-selected={false}
                    >
                      {CONTACT_RELATIONSHIP_TYPE_LABELS[rt]}
                    </button>
                  ))}
                  <button
                    onClick={() => onBulkRelationshipTypeChange(null)}
                    disabled={bulkActing}
                    className="w-full text-left px-3 min-h-[44px] flex items-center text-[11px] text-muted-foreground/70 hover:bg-muted/30 transition-colors disabled:opacity-50 border-t border-border/30 mt-1 pt-2"
                    role="option"
                    aria-selected={false}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={togglePriorityAction}
                disabled={bulkActing}
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-all disabled:opacity-40"
                aria-label="Set priority for selected contacts"
                aria-haspopup="listbox"
                aria-expanded={activeBulkAction === "priority"}
              >
                {bulkActing && activeBulkAction === "priority" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Flag className="w-3 h-3 text-muted-foreground/60" />
                )}
                Priority
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {activeBulkAction === "priority" && (
                <div
                  className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 w-36 z-50"
                  role="listbox"
                  aria-label="Select priority"
                >
                  {CONTACT_PRIORITIES.map((p) => (
                    <button
                      key={p}
                      onClick={() => onBulkPriorityChange(p)}
                      disabled={bulkActing}
                      className="w-full text-left px-3 min-h-[44px] flex items-center text-[11px] hover:bg-muted/30 transition-colors disabled:opacity-50"
                      role="option"
                      aria-selected={false}
                    >
                      {CONTACT_PRIORITY_LABELS[p]}
                    </button>
                  ))}
                  <button
                    onClick={() => onBulkPriorityChange(null)}
                    disabled={bulkActing}
                    className="w-full text-left px-3 min-h-[44px] flex items-center text-[11px] text-muted-foreground/70 hover:bg-muted/30 transition-colors disabled:opacity-50 border-t border-border/30 mt-1 pt-2"
                    role="option"
                    aria-selected={false}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => onBulkToggleFavorite(true)}
              disabled={bulkActing}
              className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-yellow-500/30 bg-yellow-500/[0.08] text-yellow-300 hover:bg-yellow-500/15 transition-all disabled:opacity-40"
              aria-label={`Toggle favorite for ${selectedCount} selected contacts`}
              title="Mark as favorite (right-click to unfavorite)"
              onContextMenu={(e) => { e.preventDefault(); onBulkToggleFavorite(false); }}
            >
              <Star className="w-3 h-3" />
              Favorite
            </button>

            {onBulkReassign && (
              <div className="relative">
                <button
                  onClick={toggleReassignAction}
                  disabled={bulkActing}
                  className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/[0.08] text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/15 transition-all disabled:opacity-40"
                  aria-label="Reassign owner of selected contacts"
                  aria-haspopup="listbox"
                  aria-expanded={activeBulkAction === "reassign"}
                >
                  {bulkActing && activeBulkAction === "reassign" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <UserCog className="w-3 h-3" />
                  )}
                  Reassign
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
                {activeBulkAction === "reassign" && (
                  <div
                    className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 w-56 z-50 max-h-64 overflow-y-auto"
                    role="listbox"
                    aria-label="Select new owner"
                  >
                    {(teamMembers ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground/60">
                        No team members available.
                      </div>
                    ) : (
                      (teamMembers ?? []).map((m) => {
                        const label = m.user.firstName || m.user.name || m.user.email;
                        return (
                          <button
                            key={m.userId}
                            onClick={() => onBulkReassign(m.userId)}
                            disabled={bulkActing}
                            className="w-full text-left px-3 min-h-[44px] flex items-center gap-2 text-[11px] hover:bg-muted/30 transition-colors disabled:opacity-50"
                            role="option"
                            aria-selected={false}
                          >
                            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))]/30 to-[hsl(var(--kf-accent2))]/30 flex items-center justify-center text-[10px] font-bold uppercase">
                              {(label || "?").charAt(0)}
                            </span>
                            <span className="flex-1 truncate">{label}</span>
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/50">{m.role}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {onBulkEnrollInSequence && (
              <div className="relative">
                <button
                  onClick={() => onSetBulkAction(activeBulkAction === "enrollSequence" ? null : "enrollSequence")}
                  disabled={bulkActing}
                  className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/[0.08] text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/15 transition-all disabled:opacity-40"
                  aria-label="Enroll selected contacts in a sequence"
                  aria-haspopup="listbox"
                  aria-expanded={activeBulkAction === "enrollSequence"}
                >
                  {bulkActing && activeBulkAction === "enrollSequence" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Workflow className="w-3 h-3" />
                  )}
                  Enroll in sequence
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
                {activeBulkAction === "enrollSequence" && (
                  <div
                    className="absolute bottom-full left-0 mb-2 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 w-64 z-50 max-h-64 overflow-y-auto"
                    role="listbox"
                    aria-label="Select active sequence"
                  >
                    {activeSequences.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground/60">
                        No active sequences. Activate a sequence first.
                      </div>
                    ) : (
                      activeSequences.map((seq) => (
                        <button
                          key={seq.id}
                          onClick={() => onBulkEnrollInSequence(seq.id)}
                          disabled={bulkActing}
                          className="w-full text-left px-3 min-h-[44px] flex items-center justify-between text-[11px] hover:bg-muted/30 transition-colors disabled:opacity-50 gap-2"
                          role="option"
                          aria-selected={false}
                        >
                          <span className="truncate flex-1">{seq.name}</span>
                          <span className="text-[10px] text-muted-foreground/50 font-mono">
                            {seq.graph?.nodes.length ?? seq.steps?.length ?? 0} nodes
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => onBulkArchive(true)}
              disabled={bulkActing}
              className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-slate-500/30 bg-slate-500/[0.08] text-slate-300 hover:bg-slate-500/15 transition-all disabled:opacity-40"
              aria-label={`Archive ${selectedCount} selected contacts`}
              title="Archive (right-click to unarchive)"
              onContextMenu={(e) => { e.preventDefault(); onBulkArchive(false); }}
            >
              <Archive className="w-3 h-3" />
              Archive
            </button>

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
