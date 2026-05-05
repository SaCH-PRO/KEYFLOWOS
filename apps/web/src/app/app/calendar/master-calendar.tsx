"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchCalendarConflicts,
  fetchCalendarEvents,
  patchCalendarEvent,
  type CalendarEvent,
  type CalendarEventFilters,
  type CalendarTypedConflict,
  type CalendarEventType,
} from "@/lib/client";
import { ConflictsProvider } from "./conflicts-context";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  presetRange,
  reschedulePolicy,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./calendar-utils";
import {
  CALENDAR_VIEWS,
  useCalendarUrlState,
  type CalendarViewMode,
} from "./use-calendar-url-state";
import { AgendaView } from "./views/agenda-view";
import { DayView } from "./views/day-view";
import { WeekView } from "./views/week-view";
import { MonthView } from "./views/month-view";
import { TimelineView } from "./views/timeline-view";
import { WorkloadView } from "./views/workload-view";
import { AvailabilityView } from "./views/availability-view";
import { CalendarEventDrawer } from "./event-drawer";
import { CreateEventDialog } from "./create-event-dialog";
import { FilterSidebar } from "./filter-sidebar";
import { TimeIntelligenceRail } from "./time-intelligence-rail";

interface Props {
  businessId: string;
  /** When set, locks the view to a specific module (used by C6 scoped views). */
  scopeModule?: CalendarEventFilters["modules"];
  /** When set, locks the view to a specific set of event types (used by C6 scoped views). */
  scopeTypes?: CalendarEventType[];
  /** When set, locks the view to a specific source (used by C6 scoped views). */
  scopeSourceType?: string;
  /** Hide the filter sidebar (e.g. embedded scoped view). */
  compact?: boolean;
  /** Hide the Time Intelligence rail. */
  hideRail?: boolean;
}

const VIEW_LABEL: Record<CalendarViewMode, string> = {
  agenda: "Agenda",
  day: "Day",
  week: "Week",
  month: "Month",
  timeline: "Timeline",
  workload: "Workload",
  availability: "Availability",
};

function rangeFor(view: CalendarViewMode, cursor: Date): { from: Date; to: Date } {
  if (view === "day") return { from: startOfDay(cursor), to: endOfDay(cursor) };
  if (view === "week" || view === "availability")
    return { from: startOfWeek(cursor), to: endOfWeek(cursor) };
  if (view === "month") return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
  // agenda + timeline + workload: 14 days from cursor
  const from = startOfDay(cursor);
  return { from, to: endOfDay(new Date(from.getTime() + 13 * 86400000)) };
}

function navigate(view: CalendarViewMode, cursor: Date, dir: 1 | -1): Date {
  const next = new Date(cursor);
  if (view === "day") next.setDate(next.getDate() + dir);
  else if (view === "week" || view === "availability") next.setDate(next.getDate() + 7 * dir);
  else if (view === "month") next.setMonth(next.getMonth() + dir);
  else next.setDate(next.getDate() + 14 * dir);
  return next;
}

export function MasterCalendar({
  businessId,
  scopeModule,
  scopeTypes,
  scopeSourceType,
  compact,
  hideRail,
}: Props) {
  const { state, update, reset } = useCalendarUrlState();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerEvent, setDrawerEvent] = useState<CalendarEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [conflicts, setConflicts] = useState<CalendarTypedConflict[]>([]);
  const dragRef = useRef<CalendarEvent | null>(null);

  const range = useMemo(() => {
    if (state.preset) {
      const r = presetRange(state.preset);
      return { from: new Date(r.start), to: new Date(r.end) };
    }
    return rangeFor(state.view, state.cursor);
  }, [state.view, state.cursor, state.preset]);

  const filters = useMemo<CalendarEventFilters>(() => {
    return {
      start: range.from.toISOString(),
      end: range.to.toISOString(),
      modules: scopeModule ?? (state.modules.length ? state.modules : undefined),
      types: scopeTypes ?? (state.types.length ? state.types : undefined),
      statuses: state.statuses.length ? state.statuses : undefined,
      contactId: state.contactId ?? undefined,
      staffId: state.staffId ?? undefined,
      assigneeId: state.assigneeId ?? undefined,
      sourceType: scopeSourceType,
      hasRevenue: state.hasRevenue ?? undefined,
      synced: state.synced ?? undefined,
      view:
        state.view === "agenda" || state.view === "day" || state.view === "week" || state.view === "month"
          ? state.view
          : "agenda",
      includeExternal: true,
      limit: 500,
    };
  }, [range, scopeModule, scopeTypes, scopeSourceType, state]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag tied to async fetch
    setLoading(true);
    setError(null);
    fetchCalendarEvents(businessId, filters)
      .then((res) => {
        if (cancelled) return;
        if (res.error) setError(res.error);
        setEvents(res.data?.events ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, filters, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    fetchCalendarConflicts(
      businessId,
      range.from.toISOString(),
      range.to.toISOString(),
    )
      .then((res) => {
        if (cancelled) return;
        if (res.data) setConflicts(res.data.conflicts);
      })
      .catch(() => {
        if (!cancelled) setConflicts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, range.from, range.to, reloadKey]);

  const conflictedIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of conflicts) for (const id of c.eventIds) set.add(id);
    return set;
  }, [conflicts]);

  const filtered = useMemo(() => {
    let list = events;
    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q),
      );
    }
    if (state.visibility) {
      list = list.filter((e) => e.visibility === state.visibility);
    }
    if (state.assignedToMe) {
      // Best-effort: server should normally apply this; UI hint until C7.
      list = list.filter((e) => !!e.assigneeId);
    }
    if (state.conflictsOnly) {
      list = list.filter((e) => conflictedIds.has(e.id));
    }
    return list;
  }, [events, state.search, state.visibility, state.assignedToMe, state.conflictsOnly, conflictedIds]);

  const headerLabel = useMemo(() => {
    if (state.preset) {
      return `${range.from.toLocaleDateString()} – ${range.to.toLocaleDateString()}`;
    }
    if (state.view === "day") {
      return state.cursor.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    if (state.view === "month") {
      return state.cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    return `${range.from.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${range.to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }, [state.view, state.cursor, state.preset, range]);

  const openEvent = useCallback((ev: CalendarEvent) => {
    setDrawerEvent(ev);
    setDrawerOpen(true);
  }, []);

  const handleQuickAction = useCallback(
    async (ev: CalendarEvent, action: string) => {
      if (action === "open-source") {
        if (ev.sourceUrl) window.open(ev.sourceUrl, "_blank");
        return;
      }
      if (action === "complete") {
        const res = await patchCalendarEvent(businessId, ev.id, { status: "COMPLETED" });
        if (res.error) toast.error(res.error);
        else {
          toast.success("Marked complete");
          setReloadKey((k) => k + 1);
        }
        return;
      }
      if (action === "reschedule") {
        openEvent(ev);
        return;
      }
      toast(`Action "${action}" coming soon`);
    },
    [businessId, openEvent],
  );

  const handleDragStart = useCallback((ev: CalendarEvent, e: React.DragEvent) => {
    dragRef.current = ev;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", ev.id);
  }, []);

  const applyReschedule = useCallback(
    async (ev: CalendarEvent, newStart: Date) => {
      const policy = reschedulePolicy(ev);
      if (policy.locked) {
        toast.error(policy.reason || "Cannot move this event");
        return;
      }
      if (policy.needsConfirm) {
        const ok = confirm(
          `${policy.reason}\n\nReschedule "${ev.title}" to ${newStart.toLocaleString()}?`,
        );
        if (!ok) return;
      }
      const oldStart = new Date(ev.startAt);
      const delta = newStart.getTime() - oldStart.getTime();
      const newEnd = ev.endAt ? new Date(new Date(ev.endAt).getTime() + delta) : null;
      const res = await patchCalendarEvent(businessId, ev.id, {
        startAt: newStart.toISOString(),
        endAt: newEnd ? newEnd.toISOString() : null,
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Rescheduled");
        setReloadKey((k) => k + 1);
      }
    },
    [businessId],
  );

  const handleDropOnDay = useCallback(
    (day: Date, _e: React.DragEvent) => {
      const ev = dragRef.current;
      dragRef.current = null;
      if (!ev) return;
      const old = new Date(ev.startAt);
      const next = new Date(day);
      next.setHours(old.getHours(), old.getMinutes(), 0, 0);
      void applyReschedule(ev, next);
    },
    [applyReschedule],
  );

  const handleDropOnHour = useCallback(
    (hour: number, _e: React.DragEvent) => {
      const ev = dragRef.current;
      dragRef.current = null;
      if (!ev) return;
      const next = new Date(state.cursor);
      next.setHours(hour, 0, 0, 0);
      void applyReschedule(ev, next);
    },
    [applyReschedule, state.cursor],
  );

  const handleSelectMonthDay = useCallback(
    (day: Date) => {
      update({ view: "day", cursor: day, preset: null });
    },
    [update],
  );

  const renderView = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
          Loading…
        </div>
      );
    }
    if (error) {
      return (
        <div
          className="p-3 rounded-md text-xs"
          style={{
            background: "hsl(var(--kf-error) / 0.1)",
            border: "1px solid hsl(var(--kf-error) / 0.2)",
            color: "hsl(var(--kf-error))",
          }}
        >
          {error}
        </div>
      );
    }
    switch (state.view) {
      case "day":
        return (
          <DayView
            events={filtered}
            cursor={state.cursor}
            onOpen={openEvent}
            onQuickAction={handleQuickAction}
            onDragStart={handleDragStart}
            onDropOnHour={handleDropOnHour}
          />
        );
      case "week":
        return (
          <WeekView
            events={filtered}
            cursor={state.cursor}
            onOpen={openEvent}
            onQuickAction={handleQuickAction}
            onDragStart={handleDragStart}
            onDropOnDay={handleDropOnDay}
          />
        );
      case "month":
        return (
          <MonthView
            events={filtered}
            cursor={state.cursor}
            onSelectDay={handleSelectMonthDay}
            onOpen={openEvent}
            onDropOnDay={handleDropOnDay}
          />
        );
      case "timeline":
        return (
          <TimelineView
            events={filtered}
            rangeFrom={range.from}
            rangeTo={range.to}
            onOpen={openEvent}
          />
        );
      case "workload":
        return (
          <WorkloadView events={filtered} rangeFrom={range.from} rangeTo={range.to} />
        );
      case "availability":
        return <AvailabilityView events={filtered} cursor={state.cursor} />;
      case "agenda":
      default:
        return (
          <AgendaView
            events={filtered}
            rangeFrom={range.from}
            rangeTo={range.to}
            onOpen={openEvent}
            onQuickAction={handleQuickAction}
            onDragStart={handleDragStart}
            onDropOnDay={handleDropOnDay}
          />
        );
    }
  };

  return (
    <div className="space-y-3">
      <div className="kf-card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <CalendarDays
              className="w-4 h-4 flex-shrink-0"
              style={{ color: "hsl(var(--kf-accent1))" }}
            />
            <h3 className="text-sm font-semibold truncate">{headerLabel}</h3>
            <span className="ml-1 text-[10px] text-muted-foreground">
              · {filtered.length} event{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-border/50 overflow-hidden">
              {CALENDAR_VIEWS.map((m) => (
                <button
                  key={m}
                  onClick={() => update({ view: m })}
                  className={`px-2.5 min-h-[36px] text-xs font-medium transition-colors ${
                    state.view === m
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                  style={
                    state.view === m
                      ? {
                          background:
                            "linear-gradient(to right, hsl(var(--kf-accent1)/0.15), hsl(var(--kf-accent2)/0.15))",
                        }
                      : undefined
                  }
                >
                  {VIEW_LABEL[m]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => update({ cursor: navigate(state.view, state.cursor, -1) })}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-muted/50"
                aria-label="Previous"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => update({ cursor: new Date(), preset: null })}
                className="px-3 min-h-[36px] text-xs rounded-lg kf-btn-secondary"
              >
                Today
              </button>
              <button
                onClick={() => update({ cursor: navigate(state.view, state.cursor, 1) })}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-muted/50"
                aria-label="Next"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {!compact && (
              <button
                onClick={() => setFilterOpen((v) => !v)}
                className="lg:hidden inline-flex items-center gap-1 px-2.5 min-h-[36px] text-xs rounded-lg kf-btn-secondary"
              >
                <Filter className="w-3.5 h-3.5" />
                Filters
              </button>
            )}

            <button
              onClick={() => {
                setCreateDate(state.cursor);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-xs font-medium rounded-lg kf-btn-primary"
            >
              <Plus className="w-3.5 h-3.5" />
              Create
            </button>
          </div>
        </div>
      </div>

      <ConflictsProvider conflicts={conflicts}>
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-3">
          {!compact && (
            <div className={`${filterOpen ? "block" : "hidden"} lg:block`}>
              <FilterSidebar state={state} update={update} reset={reset} />
            </div>
          )}
          <div className="kf-card p-3 sm:p-4 min-h-[400px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={state.view + state.cursor.toDateString() + (state.preset ?? "")}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                {renderView()}
              </motion.div>
            </AnimatePresence>
          </div>
          {!hideRail && (
            <div className="hidden lg:block">
              <TimeIntelligenceRail
                businessId={businessId}
                rangeFrom={range.from}
                rangeTo={range.to}
                reloadKey={reloadKey}
              />
            </div>
          )}
        </div>
      </ConflictsProvider>

      <CalendarEventDrawer
        open={drawerOpen}
        businessId={businessId}
        event={drawerEvent}
        onClose={() => setDrawerOpen(false)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
      <CreateEventDialog
        open={createOpen}
        businessId={businessId}
        defaultDate={createDate}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}
