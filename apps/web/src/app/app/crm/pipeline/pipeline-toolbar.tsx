"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  ArrowUpDown,
  X,
  Star,
  Clock,
  Users,
  Flame,
  AlertTriangle,
  CalendarPlus,
  TrendingUp,
  CheckSquare,
  LayoutGrid,
  List,
  Table as TableIcon,
  Upload,
  Loader2,
  ArrowRight,
  UserPlus,
  Sparkles,
  ChevronDown,
  Mail,
  Phone,
  Building2,
} from "lucide-react";
import { CONTACT_AGE_GROUPS, CONTACT_AGE_GROUP_LABELS } from "@/lib/crm-constants";
import { RichTooltip } from "@/components/ui/rich-tooltip";
import { ContactScanButton } from "@/components/contacts/contact-scan-button";
import { PipelineViewsPicker, type PipelineFilterState } from "./pipeline-views-picker";
import type { ContactSavedView } from "@/lib/client";

export type SortOption = "name" | "newest" | "oldest" | "revenue" | "score";
export type SmartSegment = "high-value" | "needs-followup" | "new-this-week" | "at-risk" | "stale";
export type ListTab = "all" | "pinned" | "recent";
export type ViewMode = "list" | "kanban" | "table";

const STATUSES = ["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

const STATUS_COLORS: Record<string, string> = {
  ALL: "text-foreground",
  LEAD: "text-amber-400",
  PROSPECT: "text-blue-400",
  CLIENT: "text-emerald-400",
  LOST: "text-red-400",
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name", label: "Name A-Z" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "revenue", label: "Highest Revenue" },
  { value: "score", label: "Highest Score" },
];

const SMART_SEGMENTS: { key: SmartSegment; label: string; icon: typeof Flame; color: string; description: string }[] = [
  { key: "high-value", label: "High Value", icon: TrendingUp, color: "hsl(142 76% 36%)", description: "Contacts with high revenue potential or significant transaction history." },
  { key: "needs-followup", label: "Needs Follow-up", icon: AlertTriangle, color: "hsl(var(--kf-accent1))", description: "Contacts with pending tasks, unanswered messages, or overdue interactions." },
  { key: "new-this-week", label: "New This Week", icon: CalendarPlus, color: "hsl(var(--kf-accent2))", description: "Contacts added in the last 7 days — follow up quickly to build rapport." },
  { key: "at-risk", label: "At Risk", icon: Flame, color: "hsl(0 70% 55%)", description: "Contacts showing signs of churn — declining engagement or missed bookings." },
  { key: "stale", label: "No Activity 30d", icon: Clock, color: "hsl(var(--kf-muted-foreground))", description: "Contacts with no interaction in the last 30 days — consider a re-engagement campaign." },
];

export interface PipelineToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  activeSegment: SmartSegment | null;
  onSegmentChange: (segment: SmartSegment | null) => void;
  segmentCounts: Record<SmartSegment, number>;
  activeListTab: ListTab;
  onListTabChange: (tab: ListTab) => void;
  allCount: number;
  pinnedCount: number;
  recentCount: number;
  loading: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onRefresh: () => void;
  onAddContact: () => void;
  onQuickCreate?: (data: { firstName: string; lastName?: string; email?: string; phone?: string; ageGroup?: string }) => Promise<void>;
  onImport?: () => void;
  onScanSuccess?: () => void;
  businessId?: string;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  savedViewState?: PipelineFilterState;
  onApplySavedView?: (view: ContactSavedView) => void;
  onClearSavedView?: () => void;
}

function PipelineToolbarInner({
  searchInput,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortChange,
  activeSegment,
  onSegmentChange,
  segmentCounts,
  activeListTab,
  onListTabChange,
  allCount,
  pinnedCount,
  recentCount,
  loading,
  selectMode,
  onToggleSelectMode,
  onRefresh,
  onAddContact,
  onQuickCreate,
  onImport,
  onScanSuccess,
  businessId,
  viewMode,
  onViewModeChange,
  savedViewState,
  onApplySavedView,
  onClearSavedView,
}: PipelineToolbarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [focusedSortIndex, setFocusedSortIndex] = useState(-1);
  const sortItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleToggleFilters = useCallback(() => {
    setShowFilters((p) => !p);
    setShowSort(false);
  }, []);

  const handleToggleSort = useCallback(() => {
    setShowSort((p) => {
      if (!p) {
        const currentIndex = SORT_OPTIONS.findIndex(o => o.value === sortBy);
        setFocusedSortIndex(currentIndex >= 0 ? currentIndex : 0);
        requestAnimationFrame(() => {
          const idx = currentIndex >= 0 ? currentIndex : 0;
          sortItemRefs.current[idx]?.focus();
        });
      } else {
        setFocusedSortIndex(-1);
      }
      return !p;
    });
    setShowFilters(false);
  }, [sortBy]);

  const handleSortKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSort) return;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = (focusedSortIndex + 1) % SORT_OPTIONS.length;
        setFocusedSortIndex(next);
        sortItemRefs.current[next]?.focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = (focusedSortIndex - 1 + SORT_OPTIONS.length) % SORT_OPTIONS.length;
        setFocusedSortIndex(prev);
        sortItemRefs.current[prev]?.focus();
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (focusedSortIndex >= 0 && focusedSortIndex < SORT_OPTIONS.length) {
          onSortChange(SORT_OPTIONS[focusedSortIndex].value);
          setShowSort(false);
          setFocusedSortIndex(-1);
        }
        break;
      }
      case "Escape": {
        e.preventDefault();
        setShowSort(false);
        setFocusedSortIndex(-1);
        break;
      }
    }
  }, [showSort, focusedSortIndex, onSortChange]);

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4 space-y-3 overflow-hidden">
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search contacts"
            className="w-full pl-9 pr-8 py-2 text-sm bg-white/[0.03] border border-border/40 rounded-xl focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
          />
          {searchInput && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3 h-3 text-muted-foreground/50" />
            </button>
          )}
        </div>
        {onApplySavedView && onClearSavedView && (
          <PipelineViewsPicker
            businessId={businessId}
            currentFilterState={savedViewState ?? {}}
            currentSort={{ sortBy }}
            onApplyView={onApplySavedView}
            onClearView={onClearSavedView}
          />
        )}
        <ContactScanButton businessId={businessId} onScanSuccess={onScanSuccess} />
        <AddContactControl
          onQuickCreate={onQuickCreate}
          onOpenFullForm={onAddContact}
        />
        {onImport && (
          <button
            onClick={onImport}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-white/[0.03] text-foreground hover:bg-white/[0.06] hover:border-border/70 text-xs font-medium transition-all flex-shrink-0"
            aria-label="Import contacts"
            title="Import contacts"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <button
            onClick={handleToggleFilters}
            className={`p-2 rounded-xl transition-all flex-shrink-0 ${showFilters ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
            aria-label="Filters"
            title="Filters"
          >
            <Filter className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={handleToggleSort}
              className={`p-2 rounded-xl transition-all flex-shrink-0 ${showSort ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="Sort contacts"
              aria-haspopup="listbox"
              aria-expanded={showSort}
              title="Sort"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { setShowSort(false); setFocusedSortIndex(-1); }} />
                <div role="listbox" aria-label="Sort options" onKeyDown={handleSortKeyDown} className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 sm:w-44 max-h-[80vh] overflow-y-auto">
                  {SORT_OPTIONS.map((opt, idx) => (
                    <button
                      key={opt.value}
                      ref={(el) => { sortItemRefs.current[idx] = el; }}
                      role="option"
                      aria-selected={sortBy === opt.value}
                      tabIndex={focusedSortIndex === idx ? 0 : -1}
                      onClick={() => { onSortChange(opt.value); setShowSort(false); setFocusedSortIndex(-1); }}
                      onFocus={() => setFocusedSortIndex(idx)}
                      className={`w-full text-left px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors ${sortBy === opt.value ? "text-[hsl(var(--kf-accent1))] font-semibold" : "text-muted-foreground"} ${focusedSortIndex === idx ? "bg-white/[0.05]" : ""}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onToggleSelectMode}
            className={`p-2 rounded-xl transition-all flex-shrink-0 ${selectMode ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
            aria-label={selectMode ? "Exit select mode" : "Select contacts"}
            title={selectMode ? "Exit select mode" : "Select contacts"}
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 rounded-xl text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground transition-all disabled:opacity-40 flex-shrink-0"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {onViewModeChange && (
          <div className="flex items-center gap-0.5 border-l border-border/30 pl-2 flex-shrink-0">
            <button
              onClick={() => onViewModeChange("list")}
              className={`p-2 rounded-xl transition-all ${viewMode === "list" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="List view"
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewModeChange("kanban")}
              className={`p-2 rounded-xl transition-all ${viewMode === "kanban" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="Kanban view"
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => onViewModeChange("table")}
              className={`p-2 rounded-xl transition-all ${viewMode === "table" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="Table view"
              title="Table view"
            >
              <TableIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-1.5"
          >
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onStatusFilterChange(s)}
                className={`px-3 py-1.5 text-[11px] rounded-lg transition-all font-medium ${
                  statusFilter === s
                    ? "bg-white/[0.08] border border-border/60 " + (STATUS_COLORS[s] || "")
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05] hover:text-muted-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5" data-walkthrough="crm-segments">
        {SMART_SEGMENTS.map(({ key, label, icon: SIcon, color, description }) => {
          const count = segmentCounts[key];
          const isActive = activeSegment === key;
          return (
            <RichTooltip key={key} title={label} description={description} side="bottom">
              <button
                onClick={() => onSegmentChange(isActive ? null : key)}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg transition-all whitespace-nowrap flex-shrink-0 font-medium ${
                  isActive
                    ? "bg-white/[0.08] border border-border/50"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05] hover:text-muted-foreground"
                }`}
                style={isActive ? { color } : undefined}
              >
                <SIcon className="w-3.5 h-3.5" style={{ color }} />
                {label}
                {count > 0 && (
                  <span
                    className={`text-[10px] font-bold ml-0.5 px-1.5 py-0.5 rounded-md ${isActive ? "bg-white/[0.08]" : ""}`}
                    style={isActive
                      ? { color }
                      : { color, opacity: 0.7 }
                    }
                  >{count}</span>
                )}
              </button>
            </RichTooltip>
          );
        })}
        {activeSegment && (
          <button
            onClick={() => onSegmentChange(null)}
            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.05] flex-shrink-0 transition-all"
            aria-label="Clear segment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Contact list views" className="flex gap-1 border-t border-border/30 pt-2.5">
        {[
          { key: "all" as const, label: "All", count: allCount, icon: Users },
          { key: "pinned" as const, label: "Pinned", count: pinnedCount, icon: Star },
          { key: "recent" as const, label: "Recent", count: recentCount, icon: Clock },
        ].map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeListTab === key}
            onClick={() => onListTabChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all font-medium ${
              activeListTab === key
                ? "bg-white/[0.08] text-foreground"
                : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/[0.04]"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${activeListTab === key ? "text-muted-foreground bg-white/[0.06]" : "text-muted-foreground/50"}`}>{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const PipelineToolbar = React.memo(PipelineToolbarInner);

function AddContactButton({
  onClick,
  expanded,
}: {
  onClick: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label="Add contact"
      aria-expanded={expanded}
      title="Add contact"
      data-walkthrough="crm-add"
      className="group relative inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white font-semibold text-xs shadow-lg shadow-[hsl(var(--kf-accent1))]/30 hover:shadow-[hsl(var(--kf-accent1))]/50 transition-all flex-shrink-0 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--kf-accent1)) 0%, hsl(var(--kf-accent1)) 45%, hsl(var(--kf-accent2, var(--kf-accent1))) 100%)",
      }}
    >
      <span
        aria-hidden
        className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
        }}
      />
      <span className="relative flex items-center justify-center w-5 h-5 rounded-md bg-white/15 group-hover:bg-white/25 transition-colors">
        <UserPlus className="w-3.5 h-3.5" />
      </span>
      <span className="relative hidden sm:inline">Add contact</span>
      <Sparkles className="relative w-3 h-3 opacity-70 hidden sm:inline-block" />
    </button>
  );
}

function AddContactControl({
  onQuickCreate,
  onOpenFullForm,
}: {
  onQuickCreate?: (data: { firstName: string; lastName?: string; email?: string; phone?: string; ageGroup?: string }) => Promise<void>;
  onOpenFullForm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [ageGroup, setAgeGroup] = useState<string>("");
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => firstRef.current?.focus());
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const canQuick = !!onQuickCreate && (firstName.trim() || lastName.trim() || email.trim() || phone.trim());

  const reset = useCallback(() => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setCompany("");
    setAgeGroup("");
    setShowMore(false);
  }, []);

  const handleQuick = useCallback(async () => {
    if (!onQuickCreate || saving) return;
    if (!firstName.trim() && !lastName.trim() && !email.trim() && !phone.trim()) return;
    setSaving(true);
    try {
      await onQuickCreate({
        firstName: firstName.trim() || lastName.trim() || email.trim() || phone.trim(),
        lastName: lastName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        ageGroup: ageGroup || undefined,
      });
      reset();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }, [onQuickCreate, saving, firstName, lastName, email, phone, ageGroup, reset]);

  const onFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleQuick();
    }
  };

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("kf:open-quick-add-contact", onOpen as EventListener);
    return () => window.removeEventListener("kf:open-quick-add-contact", onOpen as EventListener);
  }, []);

  if (!onQuickCreate) {
    return <AddContactButton onClick={onOpenFullForm} />;
  }

  const inputCls =
    "w-full px-3 py-2.5 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/60 placeholder:text-muted-foreground/50 transition-colors";

  const modal = open && mounted ? createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div
        key="dialog-wrap"
        className="fixed inset-0 z-[101] flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto pointer-events-none"
      >
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          role="dialog"
          aria-label="Add contact"
          aria-modal="true"
          className="pointer-events-auto w-full max-w-[440px] mt-[10vh] sm:mt-0 rounded-2xl bg-popover/95 backdrop-blur-xl border border-border/60 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-5 py-4 flex items-center justify-between border-b border-border/40"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.12) 0%, hsl(var(--kf-accent2, var(--kf-accent1)) / 0.06) 100%)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg"
                style={{ background: "hsl(var(--kf-accent1) / 0.18)" }}
              >
                <UserPlus className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-tight">Add contact</h2>
                <p className="text-[11px] text-muted-foreground/70 leading-tight mt-0.5">
                  Just a name works. Add more anytime.
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                  First name
                </label>
                <input
                  ref={firstRef}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  placeholder="Jane"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                  Last name
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  placeholder="Doe"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  placeholder="jane@example.com"
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                Phone
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  placeholder="+1 868 000 0000"
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>

            <AnimatePresence initial={false}>
              {showMore && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="pt-1">
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                      Company
                    </label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                      <input
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        onKeyDown={onFieldKeyDown}
                        placeholder="Acme Co."
                        className={`${inputCls} pl-9`}
                      />
                    </div>
                    <div className="mt-3">
                      <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                        Age group
                      </label>
                      <select
                        value={ageGroup}
                        onChange={(e) => setAgeGroup(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Not specified</option>
                        {CONTACT_AGE_GROUPS.map((g) => (
                          <option key={g} value={g}>{CONTACT_AGE_GROUP_LABELS[g]}</option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground/60 leading-relaxed">
                      Need address, tags, segment, lifecycle? Open the full form for everything.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={() => setShowMore((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showMore ? "rotate-180" : ""}`} />
              {showMore ? "Show less" : "More fields"}
            </button>
          </div>

          <div className="px-5 py-3 border-t border-border/40 bg-white/[0.02] flex items-center justify-between gap-2">
            <button
              onClick={() => { setOpen(false); reset(); onOpenFullForm(); }}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-white/[0.05] transition-colors"
            >
              Open full form
              <ArrowRight className="w-3 h-3" />
            </button>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] text-muted-foreground/50 mr-1">⌘ + ↵</span>
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleQuick()}
                disabled={!canQuick || saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-xs font-semibold shadow-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    Add contact
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  ) : null;

  return (
    <>
      <AddContactButton onClick={() => setOpen((v) => !v)} expanded={open} />
      {modal}
    </>
  );
}
