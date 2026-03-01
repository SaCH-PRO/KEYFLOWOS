"use client";

import React, { useState, useCallback } from "react";
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
} from "lucide-react";

export type SortOption = "name" | "newest" | "oldest" | "revenue" | "score";
export type SmartSegment = "high-value" | "needs-followup" | "new-this-week" | "at-risk" | "stale";
export type ListTab = "all" | "pinned" | "recent";
export type ViewMode = "list" | "kanban";

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

const SMART_SEGMENTS: { key: SmartSegment; label: string; icon: typeof Flame; color: string }[] = [
  { key: "high-value", label: "High Value", icon: TrendingUp, color: "hsl(142 76% 36%)" },
  { key: "needs-followup", label: "Needs Follow-up", icon: AlertTriangle, color: "hsl(var(--kf-accent1))" },
  { key: "new-this-week", label: "New This Week", icon: CalendarPlus, color: "hsl(var(--kf-accent2))" },
  { key: "at-risk", label: "At Risk", icon: Flame, color: "hsl(0 70% 55%)" },
  { key: "stale", label: "No Activity 30d", icon: Clock, color: "hsl(var(--kf-muted-foreground))" },
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
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
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
  viewMode,
  onViewModeChange,
}: PipelineToolbarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);

  const handleToggleFilters = useCallback(() => {
    setShowFilters((p) => !p);
    setShowSort(false);
  }, []);

  const handleToggleSort = useCallback(() => {
    setShowSort((p) => !p);
    setShowFilters(false);
  }, []);

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4 space-y-3 overflow-hidden">
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
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
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onAddContact}
            className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all"
            aria-label="Add contact"
            title="Add contact"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleSelectMode}
            className={`p-2 rounded-xl transition-all ${selectMode ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
            aria-label={selectMode ? "Exit select mode" : "Select contacts"}
            title={selectMode ? "Exit select mode" : "Select contacts"}
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button
            onClick={handleToggleFilters}
            className={`p-2 rounded-xl transition-all ${showFilters ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
            aria-label="Filters"
          >
            <Filter className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={handleToggleSort}
              className={`p-2 rounded-xl transition-all ${showSort ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="Sort contacts"
              aria-haspopup="listbox"
              aria-expanded={showSort}
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
                <div role="listbox" aria-label="Sort options" className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 sm:w-44 max-h-[80vh] overflow-y-auto">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      role="option"
                      aria-selected={sortBy === opt.value}
                      onClick={() => { onSortChange(opt.value); setShowSort(false); }}
                      className={`w-full text-left px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors ${sortBy === opt.value ? "text-[hsl(var(--kf-accent1))] font-semibold" : "text-muted-foreground"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 rounded-xl text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground transition-all disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {onViewModeChange && (
            <div className="flex items-center gap-0.5 ml-1 border-l border-border/30 pl-1.5">
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
            </div>
          )}
        </div>
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

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {SMART_SEGMENTS.map(({ key, label, icon: SIcon, color }) => {
          const count = segmentCounts[key];
          const isActive = activeSegment === key;
          return (
            <button
              key={key}
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
                <span className="text-[10px] font-bold ml-0.5 opacity-80" style={{ color }}>{count}</span>
              )}
            </button>
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
            <span className={`text-[10px] font-mono ${activeListTab === key ? "text-muted-foreground" : "text-muted-foreground/50"}`}>{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const PipelineToolbar = React.memo(PipelineToolbarInner);
