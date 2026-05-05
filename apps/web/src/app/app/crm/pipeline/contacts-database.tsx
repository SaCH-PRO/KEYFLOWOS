"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Download,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  File,
  X,
  HardDrive,
  Loader2,
  Columns3,
  Check,
  Eye,
  Trash2,
  Plus,
} from "lucide-react";
import type { LocalContact } from "@/lib/contacts-db";
import type { ExportFormat } from "@/lib/contacts-export";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDatabaseState, ALL_COLUMNS } from "./hooks/use-database-state";
import type { ColumnKey } from "./hooks/use-database-state";
import { DatabaseTable } from "./database-table";
import { fetchUnreadCounts } from "@/lib/client";
import { DatabaseBulkBar } from "./database-bulk-bar";
import { ContactLists } from "./contact-lists";
import {
  CONTACT_AGE_GROUPS,
  CONTACT_AGE_GROUP_LABELS,
  type ContactAgeGroup,
  CONTACT_RELATIONSHIP_TYPES,
  CONTACT_RELATIONSHIP_TYPE_LABELS,
  CONTACT_PRIORITIES,
  CONTACT_PRIORITY_LABELS,
} from "@/lib/crm-constants";

interface ContactsDatabaseProps {
  businessId: string;
  contacts: LocalContact[];
  onRefresh: () => void;
  activeListId: string | null;
  onSelectList: (listId: string | null, contactIds?: string[]) => void;
  onListsLoaded?: (count: number) => void;
  onSelectContact?: (contactId: string) => void;
  favoriteIds?: Set<string>;
  onToggleFavorite?: (id: string) => void;
}

const STATUS_FILTER_OPTIONS = ["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"];

const STATUS_COLORS: Record<string, string> = {
  ALL: "text-foreground",
  LEAD: "text-amber-400",
  PROSPECT: "text-blue-400",
  CLIENT: "text-emerald-400",
  LOST: "text-red-400",
};

const EXPORT_OPTIONS: { format: ExportFormat; label: string; desc: string; icon: typeof FileSpreadsheet }[] = [
  { format: "csv", label: "CSV", desc: "Comma-separated values", icon: FileText },
  { format: "xlsx", label: "Excel", desc: "Microsoft Excel workbook", icon: FileSpreadsheet },
  { format: "vcf", label: "vCard", desc: "Contact card format", icon: File },
  { format: "pdf", label: "PDF", desc: "Printable document", icon: FileText },
];

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50];

export function ContactsDatabase({
  businessId,
  contacts,
  onRefresh,
  activeListId,
  onSelectList,
  onListsLoaded,
  onSelectContact,
  favoriteIds,
  onToggleFavorite,
}: ContactsDatabaseProps) {
  const db = useDatabaseState({ businessId, contacts, onRefresh });

  const exportDialogRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const viewsPickerRef = useRef<HTMLDivElement>(null);
  const [savingViewName, setSavingViewName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  const setSearchInput = db.setSearchInput;
  const handleClearSearch = useCallback(() => setSearchInput(""), [setSearchInput]);

  // M2 Unified Inbox: per-user unread counts + filter
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [hasUnreadFilter, setHasUnreadFilter] = useState(false);

  const refreshUnread = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchUnreadCounts(businessId);
    if (res.data) setUnreadCounts(res.data.counts ?? {});
  }, [businessId]);

  useEffect(() => {
    void refreshUnread();
    const interval = setInterval(() => { void refreshUnread(); }, 30_000);
    const onRead = (e: Event) => {
      const detail = (e as CustomEvent<{ contactId: string }>).detail;
      if (!detail?.contactId) return;
      setUnreadCounts((prev) => {
        if (!(detail.contactId in prev)) return prev;
        const next = { ...prev };
        delete next[detail.contactId];
        return next;
      });
    };
    window.addEventListener("kf:contact-read", onRead);
    return () => {
      clearInterval(interval);
      window.removeEventListener("kf:contact-read", onRead);
    };
  }, [refreshUnread]);

  const unreadTotal = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (!db.showExport) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        db.closeExport();
        exportTriggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && exportDialogRef.current) {
        const focusable = exportDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed deps: only the export-related fields drive this focus-trap effect. The full `db` object identity changes on every parent state update and would re-bind the listener uselessly.
  }, [db.showExport, db.closeExport]);

  useEffect(() => {
    if (db.showExport && exportDialogRef.current) {
      const firstBtn = exportDialogRef.current.querySelector<HTMLButtonElement>("button");
      firstBtn?.focus();
    }
  }, [db.showExport]);

  useEffect(() => {
    if (!db.showColumnPicker) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") db.closeColumnPicker();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed deps to picker-specific fields. Including `db` would re-bind the keydown listener on unrelated state changes.
  }, [db.showColumnPicker, db.closeColumnPicker]);

  useEffect(() => {
    if (!db.showViewsPicker) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        db.closeViewsPicker();
        setShowSaveInput(false);
        setSavingViewName("");
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed deps to picker-specific fields. Including `db` would re-bind the keydown listener on unrelated state changes.
  }, [db.showViewsPicker, db.closeViewsPicker]);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search all fields..."
              value={db.searchInput}
              onChange={(e) => db.setSearchInput(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
              aria-label="Search contacts database"
            />
            {db.searchInput && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-muted-foreground/40" />
              </button>
            )}
          </div>

          <button
            onClick={db.handleSync}
            disabled={db.syncing}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all disabled:opacity-40 shrink-0"
            aria-label="Sync contacts from cloud"
          >
            {db.syncing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <HardDrive className="w-3 h-3 text-muted-foreground/60" />
            )}
            <span className="hidden sm:inline">{db.syncing ? "Syncing…" : "Sync"}</span>
          </button>
          <div className="relative" ref={viewsPickerRef}>
            <button
              onClick={db.toggleViewsPicker}
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all shrink-0 ${db.showViewsPicker ? "ring-1 ring-[hsl(var(--kf-accent1))]/40" : ""}`}
              aria-label="Saved views"
              aria-haspopup="true"
              aria-expanded={db.showViewsPicker}
            >
              <Eye className="w-3.5 h-3.5 text-muted-foreground/60" />
              <ChevronDown className={`w-3 h-3 transition-transform ${db.showViewsPicker ? "rotate-180" : ""}`} />
            </button>
            {db.showViewsPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => { db.closeViewsPicker(); setShowSaveInput(false); setSavingViewName(""); }}
                  aria-hidden="true"
                />
                <div
                  className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:top-full sm:right-0 sm:mt-2 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-2 sm:w-72 max-h-[60vh] overflow-y-auto"
                  role="group"
                  aria-label="Saved views"
                >
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                    Saved Views
                  </div>
                  {db.savedViews.map((view) => (
                    <div
                      key={view.id}
                      className={`flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/[0.04] transition-colors cursor-pointer rounded-md mx-1 ${
                        db.activeViewId === view.id ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]" : "text-foreground"
                      }`}
                    >
                      <button
                        onClick={() => db.applyView(view.id)}
                        className="flex-1 text-left flex items-center gap-2 min-w-0"
                      >
                        <Eye className="w-3.5 h-3.5 shrink-0 opacity-60" />
                        <span className="truncate font-medium">{view.name}</span>
                        {view.isDefault && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-muted-foreground/50 shrink-0">
                            Default
                          </span>
                        )}
                      </button>
                      {!view.isDefault && (
                        <button
                          onClick={(e) => { e.stopPropagation(); db.deleteView(view.id); }}
                          className="p-2 min-w-[44px] min-h-[44px] -m-1 inline-flex items-center justify-center rounded hover:bg-[hsl(var(--kf-error))]/20 text-muted-foreground/50 hover:text-[hsl(var(--kf-error))] transition-colors shrink-0"
                          aria-label={`Delete view ${view.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-border/30 mt-1 pt-1 mx-1">
                    {showSaveInput ? (
                      <div className="flex items-center gap-1.5 px-3 py-2">
                        <input
                          type="text"
                          value={savingViewName}
                          onChange={(e) => setSavingViewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && savingViewName.trim()) {
                              db.saveCurrentView(savingViewName);
                              setSavingViewName("");
                              setShowSaveInput(false);
                            }
                          }}
                          placeholder="View name..."
                          className="flex-1 px-2 py-1.5 text-[11px] bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40"
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            if (savingViewName.trim()) {
                              db.saveCurrentView(savingViewName);
                              setSavingViewName("");
                              setShowSaveInput(false);
                            }
                          }}
                          className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25 transition-colors"
                          aria-label="Save view"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setShowSaveInput(false); setSavingViewName(""); }}
                          className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-white/[0.05] text-muted-foreground/50 transition-colors"
                          aria-label="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowSaveInput(true)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-[hsl(var(--kf-accent1))] hover:bg-white/[0.04] transition-colors rounded-md"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Save Current View
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={db.toggleColumnPicker}
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 min-h-[44px] text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all shrink-0 ${db.showColumnPicker ? "ring-1 ring-[hsl(var(--kf-accent1))]/40" : ""}`}
              aria-label="Toggle column visibility"
              aria-haspopup="true"
              aria-expanded={db.showColumnPicker}
            >
              <Columns3 className="w-3 h-3 text-muted-foreground/60" />
              <span className="hidden sm:inline">Columns</span>
            </button>
            {db.showColumnPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={db.closeColumnPicker}
                  aria-hidden="true"
                />
                <div
                  className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:top-full sm:right-0 sm:mt-2 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-2 sm:w-80 max-h-[60vh] overflow-y-auto"
                  role="group"
                  aria-label="Toggle columns"
                >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                  Show / Hide Columns
                </div>
                <div className="grid grid-cols-2 gap-x-1">
                {ALL_COLUMNS.map((col) => {
                  const isVisible = db.visibleColumns.has(col.key);
                  return (
                    <button
                      key={col.key}
                      onClick={() => db.toggleColumn(col.key as ColumnKey)}
                      className="flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/[0.04] transition-colors text-left rounded-md"
                      role="checkbox"
                      aria-checked={isVisible}
                    >
                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center transition-colors ${isVisible ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]" : "border-border/50"}`}>
                        {isVisible && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className={`truncate ${isVisible ? "text-foreground" : "text-muted-foreground/50"}`}>
                        {col.label}
                      </span>
                    </button>
                  );
                })}
                </div>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            <button
              ref={exportTriggerRef}
              onClick={db.toggleExport}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 min-h-[44px] text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
              aria-haspopup="dialog"
              aria-expanded={db.showExport}
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">Export</span>
            </button>
            {db.showExport && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
                  onClick={db.closeExport}
                  aria-hidden="true"
                />
                <div
                  ref={exportDialogRef}
                  className="fixed left-2 right-2 top-20 sm:left-1/2 sm:right-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-2 sm:w-64 max-h-[80vh] overflow-y-auto"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Export contacts"
                >
                  <div className="px-4 py-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider border-b border-border/30 mb-1">
                    Export {db.filteredContacts.length} contacts
                  </div>
                  {EXPORT_OPTIONS.map(({ format, label, desc, icon: Icon }) => (
                    <button
                      key={format}
                      onClick={() => db.handleExport(format)}
                      disabled={db.exporting}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[11px] hover:bg-white/[0.05] transition-colors text-left disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--kf-accent1))]/40"
                    >
                      {db.exporting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent1))]" />
                      ) : (
                        <Icon className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]/70" />
                      )}
                      <div>
                        <span className="font-semibold">{label}</span>
                        <p className="text-[10px] text-muted-foreground/50">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by status">
          {STATUS_FILTER_OPTIONS.map((s) => {
            const count = db.statusCounts[s] ?? 0;
            return (
              <button
                key={s}
                onClick={() => db.setStatusFilter(s)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  db.statusFilter === s
                    ? "bg-white/[0.08] border border-border/60 " + (STATUS_COLORS[s] || "")
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={db.statusFilter === s}
              >
                {s}
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  db.statusFilter === s ? "bg-white/10" : "bg-white/[0.04] text-muted-foreground/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2">
            {db.filteredContacts.length} of {db.activeContacts.length}
            {db.usingCache && <span className="ml-1.5 text-amber-400">(cache)</span>}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by age group">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap shrink-0 pr-1">Age</span>
          {CONTACT_AGE_GROUPS.map((g) => {
            const isActive = db.ageGroupFilter.has(g);
            return (
              <button
                key={g}
                onClick={() => {
                  db.setAgeGroupFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(g)) next.delete(g);
                    else next.add(g);
                    return next;
                  });
                }}
                className={`px-2 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0 ${
                  isActive
                    ? "bg-[hsl(var(--kf-accent1))]/15 border border-[hsl(var(--kf-accent1))]/40 text-[hsl(var(--kf-accent1))]"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={isActive}
              >
                {CONTACT_AGE_GROUP_LABELS[g as ContactAgeGroup]}
              </button>
            );
          })}
          {db.ageGroupFilter.size > 0 && (
            <button
              onClick={() => db.setAgeGroupFilter(new Set())}
              className="px-2 py-1 text-[11px] rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              aria-label="Clear age group filter"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by relationship type">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap shrink-0 pr-1">Rel</span>
          {CONTACT_RELATIONSHIP_TYPES.map((g) => {
            const isActive = db.relationshipTypeFilter.has(g);
            return (
              <button
                key={g}
                onClick={() => {
                  db.setRelationshipTypeFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(g)) next.delete(g);
                    else next.add(g);
                    return next;
                  });
                }}
                className={`px-2 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0 ${
                  isActive
                    ? "bg-[hsl(var(--kf-accent2))]/15 border border-[hsl(var(--kf-accent2))]/40 text-[hsl(var(--kf-accent2))]"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={isActive}
              >
                {CONTACT_RELATIONSHIP_TYPE_LABELS[g]}
              </button>
            );
          })}
          {db.relationshipTypeFilter.size > 0 && (
            <button
              onClick={() => db.setRelationshipTypeFilter(new Set())}
              className="px-2 py-1 text-[11px] rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              aria-label="Clear relationship type filter"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by priority">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap shrink-0 pr-1">Pri</span>
          {CONTACT_PRIORITIES.map((g) => {
            const isActive = db.priorityFilter.has(g);
            return (
              <button
                key={g}
                onClick={() => {
                  db.setPriorityFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(g)) next.delete(g);
                    else next.add(g);
                    return next;
                  });
                }}
                className={`px-2 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0 ${
                  isActive
                    ? "bg-amber-500/15 border border-amber-500/40 text-amber-300"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={isActive}
              >
                {CONTACT_PRIORITY_LABELS[g]}
              </button>
            );
          })}
          {db.priorityFilter.size > 0 && (
            <button
              onClick={() => db.setPriorityFilter(new Set())}
              className="px-2 py-1 text-[11px] rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.05] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              aria-label="Clear priority filter"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
          <button
            onClick={() => db.setFavoriteFilter(!db.favoriteFilter)}
            className={`ml-2 px-2 py-1 text-[11px] rounded-md transition-all whitespace-nowrap shrink-0 ${
              db.favoriteFilter
                ? "bg-yellow-500/15 border border-yellow-500/40 text-yellow-300"
                : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
            }`}
            aria-pressed={db.favoriteFilter}
          >
            ★ Favorites
          </button>
          <button
            onClick={() => setHasUnreadFilter((v) => !v)}
            className={`px-2 py-1 text-[11px] rounded-md transition-all whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${
              hasUnreadFilter
                ? "bg-[hsl(var(--kf-accent1))]/15 border border-[hsl(var(--kf-accent1))]/40 text-[hsl(var(--kf-accent1))]"
                : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
            }`}
            aria-pressed={hasUnreadFilter}
            title="Show only contacts with unread messages"
          >
            Unread
            {unreadTotal > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[hsl(var(--kf-accent1))] text-white text-[9px] font-semibold leading-none">
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
            )}
          </button>
          <button
            onClick={() => db.setBestTimeNowFilter(!db.bestTimeNowFilter)}
            className={`px-2 py-1 text-[11px] rounded-md transition-all whitespace-nowrap shrink-0 ${
              db.bestTimeNowFilter
                ? "bg-[hsl(var(--kf-accent2))]/15 border border-[hsl(var(--kf-accent2))]/40 text-[hsl(var(--kf-accent2))]"
                : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
            }`}
            aria-pressed={db.bestTimeNowFilter}
            title="Contacts whose best time-of-day window is happening now"
          >
            ⏱ Best time now
          </button>
          {(["email", "whatsapp", "sms", "call"] as const).map((ch) => {
            const active = db.bestChannelFilter.has(ch);
            return (
              <button
                key={`bch-${ch}`}
                onClick={() => {
                  const next = new Set(db.bestChannelFilter);
                  if (active) next.delete(ch); else next.add(ch);
                  db.setBestChannelFilter(next);
                }}
                className={`px-2 py-1 text-[11px] rounded-md transition-all whitespace-nowrap shrink-0 ${
                  active
                    ? "bg-[hsl(var(--kf-accent1))]/15 border border-[hsl(var(--kf-accent1))]/40 text-[hsl(var(--kf-accent1))]"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={active}
              >
                {ch.charAt(0).toUpperCase() + ch.slice(1)}
              </button>
            );
          })}
          <button
            onClick={() => db.setIncludeArchived(!db.includeArchived)}
            className={`px-2 py-1 text-[11px] rounded-md transition-all whitespace-nowrap shrink-0 ${
              db.includeArchived
                ? "bg-slate-500/15 border border-slate-500/40 text-slate-300"
                : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
            }`}
            aria-pressed={db.includeArchived}
          >
            Show archived
          </button>
        </div>

        <DatabaseTable
          contacts={hasUnreadFilter ? db.paginatedContacts.filter((c) => (unreadCounts[c.id] ?? 0) > 0) : db.paginatedContacts}
          unreadCounts={unreadCounts}
          page={db.page}
          pageSize={db.pageSize}
          sortField={db.sortField}
          sortDir={db.sortDir}
          selectedIds={db.selectedIds}
          allPageSelected={db.allPageSelected}
          somePageSelected={db.somePageSelected}
          onSort={db.handleSort}
          onToggleSelect={db.toggleSelect}
          onToggleSelectAll={db.toggleSelectAll}
          onSelectContact={onSelectContact}
          isSortable={db.isSortable}
          search={db.searchInput}
          columns={db.visibleColumnDefs}
          favoriteIds={favoriteIds}
          onToggleFavorite={onToggleFavorite}
        />

        <div className="flex items-center justify-between mt-4 px-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <label htmlFor="db-page-size" className="sr-only">Rows per page</label>
            <span className="font-medium">Rows</span>
            <select
              id="db-page-size"
              value={db.pageSize}
              onChange={(e) => db.handlePageSizeChange(Number(e.target.value))}
              className="bg-white/[0.03] border border-border/40 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="hidden sm:inline text-muted-foreground/50">
              Showing {Math.min((db.page - 1) * db.pageSize + 1, db.filteredContacts.length)}-{Math.min(db.page * db.pageSize, db.filteredContacts.length)} of {db.filteredContacts.length}
            </span>
          </div>
          <nav className="flex items-center gap-1.5 text-xs" aria-label="Table pagination">
            <button
              disabled={db.page <= 1}
              onClick={db.handlePrevPage}
              className="px-2.5 py-1.5 min-h-[44px] rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] disabled:opacity-25 disabled:cursor-not-allowed transition-all font-medium text-muted-foreground/60"
              aria-label="Previous page"
            >
              Previous
            </button>
            <span className="text-muted-foreground/50 font-mono px-2" aria-live="polite">{db.page}/{db.totalPages}</span>
            <button
              disabled={db.page >= db.totalPages}
              onClick={db.handleNextPage}
              className="px-2.5 py-1.5 min-h-[44px] rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] disabled:opacity-25 disabled:cursor-not-allowed transition-all font-medium text-muted-foreground/60"
              aria-label="Next page"
            >
              Next
            </button>
          </nav>
        </div>
      </div>

      <DatabaseBulkBar
        selectedCount={db.effectiveSelectedCount}
        bulkActing={db.bulkActing}
        activeBulkAction={db.activeBulkAction}
        onSetBulkAction={db.setActiveBulkAction}
        bulkTagInput={db.bulkTagInput}
        onBulkTagInputChange={db.setBulkTagInput}
        onBulkStatusChange={db.handleBulkStatusChange}
        onBulkAddTags={db.handleBulkAddTags}
        onBulkAddToList={db.handleBulkAddToList}
        onBulkRelationshipTypeChange={db.handleBulkRelationshipTypeChange}
        onBulkPriorityChange={db.handleBulkPriorityChange}
        onBulkToggleFavorite={db.handleBulkToggleFavorite}
        onBulkArchive={db.handleBulkArchive}
        onBulkDelete={db.handleBulkDelete}
        onBulkReassign={db.handleBulkReassign}
        teamMembers={db.teamMembers}
        onClearSelection={db.clearSelection}
        availableLists={db.availableLists}
        allPagesSelected={db.allPagesSelected}
        totalFiltered={db.filteredContacts.length}
        onSelectAllPages={db.handleSelectAllPages}
      />

      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <button
          onClick={db.toggleLists}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
          aria-expanded={db.showLists}
        >
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]/40" />
            <div className="text-left">
              <h3 className="text-sm font-semibold tracking-tight">Contact Lists</h3>
              <p className="text-xs text-muted-foreground/60">Organize contacts into manual or smart lists</p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground/40 transition-transform duration-200 ${db.showLists ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {db.showLists && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 border-t border-border/30">
                <ContactLists
                  businessId={businessId}
                  activeListId={activeListId}
                  onSelectList={onSelectList}
                  onListsLoaded={onListsLoaded}
                  onListsChanged={db.handleListsChanged}
                  refreshToken={db.listsRefreshToken}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={db.confirmState.open}
        title="Delete Contacts"
        message={`Delete ${db.confirmState.count} contacts? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { db.confirmState.onConfirm(); db.handleConfirmClose(); }}
        onCancel={db.handleConfirmClose}
      />
    </div>
  );
}
