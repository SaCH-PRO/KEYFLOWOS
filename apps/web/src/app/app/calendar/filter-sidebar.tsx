"use client";

import { X } from "lucide-react";
import {
  ALL_MODULES,
  ALL_STATUSES,
  ALL_TYPES,
  TIME_PRESETS,
  moduleMeta,
} from "./calendar-utils";
import type { CalendarUrlState } from "./use-calendar-url-state";

interface Props {
  state: CalendarUrlState;
  update: (patch: Partial<CalendarUrlState>) => void;
  reset: () => void;
}

export function FilterSidebar({ state, update, reset }: Props) {
  const toggleIn = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <div className="kf-card p-3 space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Filters
        </h4>
        <button
          type="button"
          onClick={reset}
          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Reset
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Search
        </label>
        <input
          type="text"
          value={state.search}
          onChange={(e) => update({ search: e.target.value })}
          placeholder="Title or description…"
          className="kf-input w-full text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Time preset
        </label>
        <div className="flex flex-wrap gap-1">
          {TIME_PRESETS.map((p) => {
            const active = state.preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => update({ preset: active ? null : p.key })}
                className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                  active
                    ? "border-transparent text-foreground"
                    : "border-border/50 text-muted-foreground hover:text-foreground"
                }`}
                style={
                  active
                    ? {
                        background:
                          "linear-gradient(to right, hsl(var(--kf-accent1)/0.2), hsl(var(--kf-accent2)/0.2))",
                      }
                    : undefined
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Modules
        </label>
        <div className="flex flex-wrap gap-1">
          {ALL_MODULES.map((m) => {
            const meta = moduleMeta(m);
            const active = state.modules.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => update({ modules: toggleIn(state.modules, m) })}
                className="text-[10px] px-2 py-1 rounded-full transition-all"
                style={{
                  background: active ? `${meta.color}1f` : "hsl(var(--muted) / 0.4)",
                  color: active ? meta.color : "hsl(var(--muted-foreground))",
                  border: `1px solid ${active ? `${meta.color}55` : "transparent"}`,
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Types
        </label>
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
          {ALL_TYPES.map((t) => {
            const active = state.types.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => update({ types: toggleIn(state.types, t) })}
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  active
                    ? "border-foreground/40 text-foreground bg-muted/40"
                    : "border-border/40 text-muted-foreground"
                }`}
              >
                {t.toLowerCase().replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Status
        </label>
        <div className="flex flex-wrap gap-1">
          {ALL_STATUSES.map((s) => {
            const active = state.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => update({ statuses: toggleIn(state.statuses, s) })}
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  active
                    ? "border-foreground/40 text-foreground bg-muted/40"
                    : "border-border/40 text-muted-foreground"
                }`}
              >
                {s.toLowerCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Contact ID
        </label>
        <input
          type="text"
          value={state.contactId ?? ""}
          onChange={(e) => update({ contactId: e.target.value || null })}
          placeholder="Optional"
          className="kf-input w-full text-xs font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Staff ID
        </label>
        <input
          type="text"
          value={state.staffId ?? ""}
          onChange={(e) => update({ staffId: e.target.value || null })}
          placeholder="Optional"
          className="kf-input w-full text-xs font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Assignee ID
        </label>
        <input
          type="text"
          value={state.assigneeId ?? ""}
          onChange={(e) => update({ assigneeId: e.target.value || null })}
          placeholder="Optional"
          className="kf-input w-full text-xs font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Toggles
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.hasRevenue === true}
              onChange={(e) => update({ hasRevenue: e.target.checked ? true : null })}
            />
            Has revenue
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.synced === true}
              onChange={(e) => update({ synced: e.target.checked ? true : null })}
            />
            Synced to Google
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.synced === false}
              onChange={(e) => update({ synced: e.target.checked ? false : null })}
            />
            Not synced
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.assignedToMe}
              onChange={(e) => update({ assignedToMe: e.target.checked })}
            />
            Assigned to me
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          Visibility
        </label>
        <select
          value={state.visibility ?? ""}
          onChange={(e) =>
            update({ visibility: (e.target.value || null) as CalendarUrlState["visibility"] })
          }
          className="kf-input w-full text-xs"
        >
          <option value="">Any</option>
          <option value="PRIVATE">Private</option>
          <option value="TEAM">Team</option>
          <option value="PUBLIC">Public</option>
        </select>
      </div>
    </div>
  );
}
