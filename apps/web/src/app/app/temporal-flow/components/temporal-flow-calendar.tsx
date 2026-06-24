"use client";

import { useEffect, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import {
  TemporalFlowEvent,
  getTemporalFlowCalendar,
} from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";
import { TemporalFlowEventCard } from "./temporal-flow-event-card";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}

function formatMonthYear(date: Date) {
  return date.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function groupByDay(events: TemporalFlowEvent[]) {
  const groups: Record<string, TemporalFlowEvent[]> = {};
  for (const event of events) {
    const date = event.startsAt
      ? new Date(event.startsAt)
      : event.reminderAt
        ? new Date(event.reminderAt)
        : new Date(event.occurredAt);
    const key = date.toLocaleDateString();
    groups[key] = groups[key] ?? [];
    groups[key].push(event);
  }
  return groups;
}

export function TemporalFlowCalendar() {
  const businessId = getStoredBusinessId() ?? "";
  const [month, setMonth] = useState(new Date());
  const [events, setEvents] = useState<TemporalFlowEvent[]>([]);
  const [loading, setLoading] = useState(() => !!businessId);

  useEffect(() => {
    if (!businessId) return;
    const from = startOfMonth(month).toISOString();
    const to = endOfMonth(month).toISOString();
    getTemporalFlowCalendar(businessId, from, to).then(({ data }) => {
      setEvents(data ?? []);
      setLoading(false);
    });
  }, [businessId, month]);

  const groups = groupByDay(events);
  const days = Object.keys(groups).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          {formatMonthYear(month)}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1))}
            className="p-1.5 rounded-md hover:bg-muted"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMonth(new Date())}
            className="text-xs px-2 py-1 rounded-md hover:bg-muted font-medium"
          >
            Today
          </button>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1))}
            className="p-1.5 rounded-md hover:bg-muted"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : days.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No scheduled events this month.</p>
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <div key={day}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 sticky top-0 bg-background py-1">
                {new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
              </h4>
              <div className="space-y-3">
                {groups[day].map((event) => (
                  <TemporalFlowEventCard key={event.id} event={event} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
