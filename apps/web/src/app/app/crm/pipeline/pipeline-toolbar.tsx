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
} from "lucide-react";

export type SortOption = "name" | "newest" | "oldest" | "revenue" | "score";
export type SmartSegment = "high-value" | "needs-followup" | "new-this-week" | "at-risk" | "stale";
export type ListTab = "all" | "pinned" | "recent";

const STATUSES = ["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

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
}: PipelineToolbarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);

  return (
    <div className="kf-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search contacts"
            className="kf-input w-full pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onAddContact}
            className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25 transition-all"
            aria-label="Add contact"
            title="Add contact"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleSelectMode}
            className={`p-2 rounded-lg transition-all ${selectMode ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))]" : "text-muted-foreground hover:bg-muted/50"}`}
            aria-label={selectMode ? "Exit select mode" : "Select contacts"}
            title={selectMode ? "Exit select mode" : "Select contacts"}
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg transition-all ${showFilters ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:bg-muted/50"}`}
            aria-label="Filters"
          >
            <Filter className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className={`p-2 rounded-lg transition-all ${showSort ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:bg-muted/50"}`}
              aria-label="Sort contacts"
              aria-haspopup="listbox"
              aria-expanded={showSort}
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
                <div role="listbox" aria-label="Sort options" className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 z-50 kf-card border border-border shadow-2xl rounded-xl py-1 sm:w-44 max-h-[80vh] overflow-y-auto">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      role="option"
                      aria-selected={sortBy === opt.value}
                      onClick={() => { onSortChange(opt.value); setShowSort(false); }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-muted/50 transition-colors ${sortBy === opt.value ? "text-[hsl(var(--kf-accent1))] font-medium" : ""}`}
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
            className="p-2 rounded-lg text-muted-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
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
                className={`px-3 py-1.5 text-xs rounded-lg transition-all ${statusFilter === s ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] ring-1 ring-[hsl(var(--kf-accent1))]/30 font-medium" : "bg-muted/30 text-muted-foreground"}`}
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
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full transition-all whitespace-nowrap flex-shrink-0 ${
                isActive
                  ? "ring-1 ring-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 font-medium"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              style={isActive ? { color } : undefined}
            >
              <SIcon className="w-3 h-3" style={{ color }} />
              {label}
              {count > 0 && (
                <span className="text-[9px] font-bold" style={{ color }}>{count}</span>
              )}
            </button>
          );
        })}
        {activeSegment && (
          <button
            onClick={() => onSegmentChange(null)}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 flex-shrink-0"
            aria-label="Clear segment"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Contact list views" className="flex gap-0.5 border-b border-border/50">
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
            className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
              activeListTab === key
                ? "border-[hsl(var(--kf-accent1))] text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3 h-3" />
            <span>{label}</span>
            <span className="text-[10px] opacity-60">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const PipelineToolbar = React.memo(PipelineToolbarInner);
