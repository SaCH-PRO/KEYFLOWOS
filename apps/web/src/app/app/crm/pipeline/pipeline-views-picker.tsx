"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, Pencil, Plus, Save, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  fetchSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  createContactList,
  type ContactSavedView,
} from "@/lib/client";

export type PipelineFilterState = Record<string, unknown>;

export interface PipelineViewsPickerProps {
  businessId?: string;
  /** The currently-applied filter state on the pipeline. */
  currentFilterState: PipelineFilterState;
  currentSort?: { sortBy?: string; sortOrder?: "asc" | "desc" };
  /** Optional: current visible columns (used by table view). Persisted with the view. */
  currentVisibleColumns?: string[] | null;
  /** Called when the user picks a saved view — apply the filter state. */
  onApplyView: (view: ContactSavedView) => void;
  /** Called when the active view is cleared. */
  onClearView: () => void;
}

/**
 * Strip UI-only keys and sentinel values from a saved-view filter state so it
 * can be safely used as `ContactList.rules` (i.e. fed into buildContactWhere).
 */
function sanitizeFilterStateForRules(input: PipelineFilterState): Record<string, unknown> {
  const UI_ONLY_KEYS = new Set([
    "activeSegment", "activeListTab", "viewMode", "visibleColumns", "sortBy", "sortOrder", "search",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (UI_ONLY_KEYS.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (k === "status" && (v === "ALL" || v === "" || (Array.isArray(v) && v.length === 0))) continue;
    out[k] = v;
  }
  return out;
}

export function PipelineViewsPicker({
  businessId,
  currentFilterState,
  currentSort,
  currentVisibleColumns,
  onApplyView,
  onClearView,
}: PipelineViewsPickerProps) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<ContactSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await fetchSavedViews(businessId);
      if (cancelled) return;
      if (error) {
        toast.error(`Couldn't load saved views: ${error}`);
      } else if (data) {
        setViews(data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveAs(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setShowSaveAs(false); } };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeView = useMemo(
    () => (activeViewId ? views.find((v) => v.id === activeViewId) ?? null : null),
    [activeViewId, views],
  );

  const isDirty = useMemo(() => {
    if (!activeView) return false;
    try {
      return JSON.stringify(activeView.filterState) !== JSON.stringify(currentFilterState);
    } catch {
      return false;
    }
  }, [activeView, currentFilterState]);

  const handleApply = useCallback((view: ContactSavedView) => {
    setActiveViewId(view.id);
    onApplyView(view);
    setOpen(false);
    setShowSaveAs(false);
  }, [onApplyView]);

  const handleClear = useCallback(() => {
    setActiveViewId(null);
    onClearView();
    setOpen(false);
    setShowSaveAs(false);
  }, [onClearView]);

  const handleSaveNew = useCallback(async () => {
    if (!businessId || !newName.trim() || saving) return;
    setSaving(true);
    const { data, error } = await createSavedView(businessId, {
      name: newName.trim(),
      filterState: currentFilterState,
      sort: currentSort ?? null,
      visibleColumns: currentVisibleColumns ?? null,
    });
    setSaving(false);
    if (error || !data) {
      toast.error(`Couldn't save view: ${error ?? "Unknown error"}`);
      return;
    }
    setViews((prev) => [data, ...prev.filter((v) => v.id !== data.id)]);
    setActiveViewId(data.id);
    setNewName("");
    setShowSaveAs(false);
    setOpen(false);
    toast.success(`Saved view "${data.name}"`);
  }, [businessId, newName, saving, currentFilterState, currentSort, currentVisibleColumns]);

  const handleUpdateActive = useCallback(async () => {
    if (!businessId || !activeView || saving) return;
    setSaving(true);
    const { data, error } = await updateSavedView(businessId, activeView.id, {
      filterState: currentFilterState,
      sort: currentSort ?? null,
      visibleColumns: currentVisibleColumns ?? null,
    });
    setSaving(false);
    if (error || !data) {
      toast.error(`Couldn't update view: ${error ?? "Unknown error"}`);
      return;
    }
    setViews((prev) => prev.map((v) => (v.id === data.id ? data : v)));
    toast.success(`Updated "${data.name}"`);
  }, [businessId, activeView, saving, currentFilterState, currentSort, currentVisibleColumns]);

  const handleRenameCommit = useCallback(async (view: ContactSavedView) => {
    if (!businessId) return;
    const next = renameValue.trim();
    if (!next || next === view.name) {
      setRenamingId(null);
      return;
    }
    const { data, error } = await updateSavedView(businessId, view.id, { name: next });
    if (error || !data) {
      toast.error(`Couldn't rename view: ${error ?? "Unknown error"}`);
      return;
    }
    setViews((prev) => prev.map((v) => (v.id === data.id ? data : v)));
    setRenamingId(null);
    toast.success(`Renamed to "${data.name}"`);
  }, [businessId, renameValue]);

  const handleDelete = useCallback(async (view: ContactSavedView) => {
    if (!businessId) return;
    if (!window.confirm(`Delete saved view "${view.name}"?`)) return;
    const { error } = await deleteSavedView(businessId, view.id);
    if (error) {
      toast.error(`Couldn't delete view: ${error}`);
      return;
    }
    setViews((prev) => prev.filter((v) => v.id !== view.id));
    if (activeViewId === view.id) {
      setActiveViewId(null);
      onClearView();
    }
    toast.success(`Deleted "${view.name}"`);
  }, [businessId, activeViewId, onClearView]);

  const handlePromoteToSegment = useCallback(async (view: ContactSavedView) => {
    if (!businessId) return;
    const cleaned = sanitizeFilterStateForRules(view.filterState as PipelineFilterState);
    const { data, error } = await createContactList(businessId, {
      name: `${view.name} (segment)`,
      type: "SMART",
      filters: cleaned,
      rules: cleaned,
    });
    if (error || !data) {
      toast.error(`Couldn't create segment: ${error ?? "Unknown error"}`);
      return;
    }
    toast.success(`Created smart segment "${data.name}"`);
  }, [businessId]);

  if (!businessId) return null;

  return (
    <div ref={wrapperRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Saved views"
        title="Saved views"
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
          activeView
            ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
            : "border-border/50 bg-white/[0.03] text-foreground hover:bg-white/[0.06] hover:border-border/70"
        }`}
      >
        <Bookmark className="w-4 h-4" />
        <span className="hidden sm:inline truncate max-w-[140px]">
          {activeView ? activeView.name : "Views"}
        </span>
        {isDirty && (
          <span className="text-[10px] text-amber-400" title="Unsaved changes">•</span>
        )}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Saved views menu"
          className="absolute right-0 top-full mt-1 z-50 w-72 max-h-[70vh] overflow-y-auto bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1.5"
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Saved views
          </div>
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
          )}
          {!loading && views.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground/70">No saved views yet.</div>
          )}
          {!loading && views.map((v) => {
            const isActive = v.id === activeViewId;
            return (
              <div key={v.id} className={`group flex items-center gap-1 px-2 ${isActive ? "bg-white/[0.04]" : ""}`}>
                {renamingId === v.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void handleRenameCommit(v)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void handleRenameCommit(v); }
                      if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                    }}
                    className="flex-1 min-w-0 px-2 py-1 text-xs bg-white/[0.05] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
                    aria-label={`Rename ${v.name}`}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleApply(v)}
                    className="flex-1 min-w-0 text-left px-2 py-1.5 text-xs hover:bg-white/[0.05] rounded-lg transition-colors flex items-center gap-2"
                  >
                    {isActive ? (
                      <Check className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                    ) : (
                      <span className="w-3.5 h-3.5" />
                    )}
                    <span className="truncate">{v.name}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setRenamingId(v.id); setRenameValue(v.name); }}
                  className="p-1 rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] hover:text-foreground transition-opacity"
                  title="Rename view"
                  aria-label={`Rename ${v.name}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handlePromoteToSegment(v)}
                  className="p-1 rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] hover:text-[hsl(var(--kf-accent2))] transition-opacity"
                  title="Promote to smart segment"
                  aria-label={`Promote ${v.name} to smart segment`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(v)}
                  className="p-1 rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] hover:text-red-400 transition-opacity"
                  title="Delete view"
                  aria-label={`Delete ${v.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          <div className="border-t border-border/30 mt-1 pt-1">
            {activeView && isDirty && (
              <button
                type="button"
                onClick={() => void handleUpdateActive()}
                disabled={saving}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/[0.05] disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                Update &ldquo;{activeView.name}&rdquo;
              </button>
            )}
            {activeView && (
              <button
                type="button"
                onClick={handleClear}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/[0.05] transition-colors text-muted-foreground"
              >
                <span className="w-3.5 h-3.5" />
                Clear active view
              </button>
            )}
            {!showSaveAs ? (
              <button
                type="button"
                onClick={() => setShowSaveAs(true)}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-white/[0.05] transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                Save current filters as view…
              </button>
            ) : (
              <div className="px-3 py-2 space-y-1.5">
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSaveNew(); } }}
                  placeholder="View name"
                  className="w-full px-2.5 py-1.5 text-xs bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
                />
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleSaveNew()}
                    disabled={!newName.trim() || saving}
                    className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] font-medium hover:bg-[hsl(var(--kf-accent1))]/20 disabled:opacity-50 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowSaveAs(false); setNewName(""); }}
                    className="px-2 py-1.5 text-xs rounded-lg text-muted-foreground hover:bg-white/[0.04] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
