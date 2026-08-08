"use client";

import { TemporalFlowListParams } from "@/lib/api/temporal-flow";

const SOURCES = ["APP", "KEY", "GOOGLE_CALENDAR", "WHATSAPP", "EMAIL", "META", "FACEBOOK", "INSTAGRAM", "SHOPIFY", "SLACK", "WEBHOOK", "MANUAL"];
const STATUSES = ["RECORDED", "ACTION_REQUIRED", "RESOLVED", "DISMISSED"];
const IMPORTANCES = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

interface TemporalFlowFiltersProps {
  filters: TemporalFlowListParams;
  onChange: (filters: TemporalFlowListParams) => void;
  onTimeRange?: (range: "today" | "week" | "month" | "all") => void;
}

export function TemporalFlowFilters({ filters, onChange, onTimeRange }: TemporalFlowFiltersProps) {
  const update = (patch: Partial<TemporalFlowListParams>) => {
    onChange({ ...filters, ...patch });
  };

  const presets: { key: "today" | "week" | "month" | "all"; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "all", label: "All Time" },
  ];

  const isActive = (key: typeof presets[number]["key"]) => {
    if (key === "all") return !filters.from && !filters.to;
    return false; // exact match not tracked; chips are actions, not state
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onTimeRange && presets.map((preset) => (
        <button
          key={preset.key}
          onClick={() => onTimeRange(preset.key)}
          className={`text-xs rounded-lg border px-2.5 py-1.5 font-medium transition-colors ${
            isActive(preset.key)
              ? "bg-[hsl(var(--kf-accent1))]/10 border-[hsl(var(--kf-accent1))]/30 text-foreground"
              : "border-border bg-card/40 text-muted-foreground hover:bg-card/80 hover:text-foreground"
          }`}
        >
          {preset.label}
        </button>
      ))}

      <div className="w-px h-5 bg-border/50 mx-1" />

      <select
        value={filters.source ?? ""}
        onChange={(e) => update({ source: e.target.value || undefined })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
      >
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={filters.status ?? ""}
        onChange={(e) => update({ status: e.target.value || undefined })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={filters.importance ?? ""}
        onChange={(e) => update({ importance: e.target.value || undefined })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
      >
        <option value="">All importance</option>
        {IMPORTANCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={filters.genomeImpactPotential ?? false}
          onChange={(e) => update({ genomeImpactPotential: e.target.checked || undefined })}
          className="rounded border-border"
        />
        Genome impact
      </label>

      <input
        type="date"
        value={filters.from ? filters.from.slice(0, 10) : ""}
        onChange={(e) => update({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
        placeholder="From"
      />
      <input
        type="date"
        value={filters.to ? filters.to.slice(0, 10) : ""}
        onChange={(e) => update({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
        className="text-xs rounded-lg border border-border bg-background px-2 py-1.5"
        placeholder="To"
      />
    </div>
  );
}
