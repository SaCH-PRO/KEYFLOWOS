"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CalendarEventModule,
  CalendarEventStatus,
  CalendarEventType,
} from "@/lib/client";
import type { TimePreset } from "./calendar-utils";

export type CalendarViewMode =
  | "agenda"
  | "day"
  | "week"
  | "month"
  | "timeline"
  | "workload"
  | "availability";

export const CALENDAR_VIEWS: CalendarViewMode[] = [
  "agenda",
  "day",
  "week",
  "month",
  "timeline",
  "workload",
  "availability",
];

export interface CalendarUrlState {
  view: CalendarViewMode;
  cursor: Date;
  preset: TimePreset | null;
  modules: CalendarEventModule[];
  types: CalendarEventType[];
  statuses: CalendarEventStatus[];
  contactId: string | null;
  staffId: string | null;
  assigneeId: string | null;
  hasRevenue: boolean | null;
  synced: boolean | null;
  assignedToMe: boolean;
  visibility: "PRIVATE" | "TEAM" | "PUBLIC" | null;
  search: string;
  conflictsOnly: boolean;
}

function parseDate(s: string | null): Date {
  if (!s) return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function parseList<T extends string>(s: string | null): T[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean) as T[];
}

function parseBool(s: string | null): boolean | null {
  if (s === null) return null;
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return null;
}

export function useCalendarUrlState(): {
  state: CalendarUrlState;
  update: (patch: Partial<CalendarUrlState>) => void;
  reset: () => void;
} {
  const router = useRouter();
  const params = useSearchParams();

  const state = useMemo<CalendarUrlState>(() => {
    const rawView = (params.get("view") as CalendarViewMode | null) ?? "agenda";
    const view = CALENDAR_VIEWS.includes(rawView) ? rawView : "agenda";
    return {
      view,
      cursor: parseDate(params.get("cursor")),
      preset: (params.get("preset") as TimePreset | null) || null,
      modules: parseList<CalendarEventModule>(params.get("modules")),
      types: parseList<CalendarEventType>(params.get("types")),
      statuses: parseList<CalendarEventStatus>(params.get("statuses")),
      contactId: params.get("contact") || null,
      staffId: params.get("staff") || null,
      assigneeId: params.get("assignee") || null,
      hasRevenue: parseBool(params.get("hasRevenue")),
      synced: parseBool(params.get("synced")),
      assignedToMe: parseBool(params.get("mine")) === true,
      visibility: (params.get("visibility") as CalendarUrlState["visibility"]) || null,
      search: params.get("q") || "",
      conflictsOnly: parseBool(params.get("conflictsOnly")) === true,
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<CalendarUrlState>) => {
      const next = new URLSearchParams(params.toString());
      const setOrDel = (key: string, value: string | null | undefined | "") => {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      };
      if ("view" in patch) setOrDel("view", patch.view ?? null);
      if ("cursor" in patch && patch.cursor) {
        const d = patch.cursor;
        setOrDel(
          "cursor",
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        );
      }
      if ("preset" in patch) setOrDel("preset", patch.preset ?? null);
      if ("modules" in patch)
        setOrDel("modules", patch.modules && patch.modules.length ? patch.modules.join(",") : null);
      if ("types" in patch)
        setOrDel("types", patch.types && patch.types.length ? patch.types.join(",") : null);
      if ("statuses" in patch)
        setOrDel("statuses", patch.statuses && patch.statuses.length ? patch.statuses.join(",") : null);
      if ("contactId" in patch) setOrDel("contact", patch.contactId ?? null);
      if ("staffId" in patch) setOrDel("staff", patch.staffId ?? null);
      if ("assigneeId" in patch) setOrDel("assignee", patch.assigneeId ?? null);
      if ("hasRevenue" in patch)
        setOrDel("hasRevenue", patch.hasRevenue === null || patch.hasRevenue === undefined ? null : String(patch.hasRevenue));
      if ("synced" in patch)
        setOrDel("synced", patch.synced === null || patch.synced === undefined ? null : String(patch.synced));
      if ("assignedToMe" in patch)
        setOrDel("mine", patch.assignedToMe ? "true" : null);
      if ("visibility" in patch) setOrDel("visibility", patch.visibility ?? null);
      if ("search" in patch) setOrDel("q", patch.search ?? null);
      if ("conflictsOnly" in patch)
        setOrDel("conflictsOnly", patch.conflictsOnly ? "true" : null);

      const qs = next.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [params, router],
  );

  const reset = useCallback(() => {
    router.replace("?", { scroll: false });
  }, [router]);

  return { state, update, reset };
}
