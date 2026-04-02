"use client";

import { useState, useMemo } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";

export type DatePreset = "all" | "today" | "this_week" | "this_month" | "this_quarter" | "this_year" | "custom";

export interface DateRange {
  from: Date | null;
  to: Date | null;
  preset: DatePreset;
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
  { key: "this_quarter", label: "This Quarter" },
  { key: "this_year", label: "This Year" },
  { key: "custom", label: "Custom" },
];

function getPresetRange(preset: DatePreset): { from: Date | null; to: Date | null } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: startOfDay, to: now };
    case "this_week": {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(startOfDay);
      monday.setDate(monday.getDate() - diff);
      return { from: monday, to: now };
    }
    case "this_month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    case "this_quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), qMonth, 1), to: now };
    }
    case "this_year":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
    default:
      return { from: null, to: null };
  }
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

export function DateRangeFilter({ value, onChange, className = "" }: DateRangeFilterProps) {
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const [open, setOpen] = useState(false);

  const activeLabel = useMemo(() => {
    if (value.preset === "custom" && value.from && value.to) {
      return `${value.from.toLocaleDateString("en-TT", { month: "short", day: "numeric" })} – ${value.to.toLocaleDateString("en-TT", { month: "short", day: "numeric" })}`;
    }
    return PRESETS.find((p) => p.key === value.preset)?.label ?? "All Time";
  }, [value]);

  function handlePreset(preset: DatePreset) {
    if (preset === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    const range = getPresetRange(preset);
    onChange({ preset, ...range });
    setOpen(false);
  }

  function handleCustomFrom(dateStr: string) {
    const from = dateStr ? new Date(dateStr) : null;
    onChange({ preset: "custom", from, to: value.to });
  }

  function handleCustomTo(dateStr: string) {
    const to = dateStr ? new Date(dateStr) : null;
    onChange({ preset: "custom", from: value.from, to });
  }

  function clearFilter() {
    setShowCustom(false);
    onChange({ preset: "all", from: null, to: null });
    setOpen(false);
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2.5 min-h-[36px] text-[11px] font-medium rounded-lg transition-all whitespace-nowrap ${
          value.preset !== "all"
            ? "bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30 text-[hsl(var(--kf-accent1))]"
            : "bg-white/[0.03] border border-border/40 text-muted-foreground/70 hover:bg-white/[0.06]"
        }`}
      >
        <Calendar className="w-3 h-3" />
        <span>{activeLabel}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {value.preset !== "all" && (
        <button
          onClick={clearFilter}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-muted/80 flex items-center justify-center hover:bg-muted transition-colors z-10"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-border/50 bg-card shadow-xl overflow-hidden">
            <div className="p-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => handlePreset(p.key)}
                  className={`w-full text-left px-3 py-2 text-[11px] rounded-lg transition-colors ${
                    value.preset === p.key
                      ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] font-medium"
                      : "text-foreground/80 hover:bg-white/[0.05]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {showCustom && (
              <div className="border-t border-border/30 p-3 space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground/60 font-medium block mb-1">From</label>
                  <input
                    type="date"
                    value={value.from ? value.from.toISOString().split("T")[0] : ""}
                    onChange={(e) => handleCustomFrom(e.target.value)}
                    className="w-full px-2 py-1.5 text-[11px] bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground/60 font-medium block mb-1">To</label>
                  <input
                    type="date"
                    value={value.to ? value.to.toISOString().split("T")[0] : ""}
                    onChange={(e) => handleCustomTo(e.target.value)}
                    className="w-full px-2 py-1.5 text-[11px] bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
                  />
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="w-full px-3 py-1.5 text-[11px] font-medium rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function filterByDateRange<T>(
  items: T[],
  getDate: (item: T) => string | Date | null | undefined,
  range: DateRange,
): T[] {
  if (range.preset === "all" || (!range.from && !range.to)) return items;
  return items.filter((item) => {
    const raw = getDate(item);
    if (!raw) return false;
    const d = new Date(raw);
    if (range.from && d < range.from) return false;
    if (range.to) {
      const endOfDay = new Date(range.to);
      endOfDay.setHours(23, 59, 59, 999);
      if (d > endOfDay) return false;
    }
    return true;
  });
}

export const DEFAULT_DATE_RANGE: DateRange = { preset: "all", from: null, to: null };
