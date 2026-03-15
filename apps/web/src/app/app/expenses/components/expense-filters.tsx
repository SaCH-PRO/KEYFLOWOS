"use client";

import { Search } from "lucide-react";
import { PERIODS } from "./expense-utils";

interface ExpenseFiltersProps {
  period: string;
  setPeriod: (v: string) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
}

export function ExpenseFilters({
  period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd,
  searchQuery, setSearchQuery,
}: ExpenseFiltersProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Time period" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]">
        {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        <option value="custom">Custom Range</option>
      </select>
      {period === "custom" && (
        <>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
        </>
      )}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search expenses..." aria-label="Search expenses" className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]" />
      </div>
    </div>
  );
}
