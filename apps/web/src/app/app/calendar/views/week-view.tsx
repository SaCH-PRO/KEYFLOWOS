"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";
import { EventCard } from "../event-card";
import { isSameDay, startOfDay, startOfWeek } from "../calendar-utils";

interface Props {
  events: CalendarEvent[];
  cursor: Date;
  onOpen: (ev: CalendarEvent) => void;
  onQuickAction: (ev: CalendarEvent, action: string) => void;
  onDragStart?: (ev: CalendarEvent, e: React.DragEvent) => void;
  onDropOnDay?: (day: Date, e: React.DragEvent) => void;
}

export function WeekView({
  events,
  cursor,
  onOpen,
  onQuickAction,
  onDragStart,
  onDropOnDay,
}: Props) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000));
  }, [cursor]);

  const grouped = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = startOfDay(new Date(ev.startAt)).toISOString();
      const arr = m.get(key) ?? [];
      arr.push(ev);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return m;
  }, [events]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((day) => {
        const key = startOfDay(day).toISOString();
        const list = grouped.get(key) ?? [];
        const today = isSameDay(day, new Date());
        return (
          <div
            key={key}
            className="rounded-lg border border-border/40 p-2 min-h-[280px] flex flex-col gap-1.5"
            onDragOver={(e) => {
              if (onDropOnDay) e.preventDefault();
            }}
            onDrop={(e) => onDropOnDay?.(day, e)}
          >
            <div
              className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${
                today ? "" : "text-muted-foreground"
              }`}
              style={today ? { color: "hsl(var(--kf-accent1))" } : undefined}
            >
              {day.toLocaleDateString("en-US", { weekday: "short" })} {day.getDate()}
            </div>
            {list.length === 0 ? (
              <div className="text-[10px] text-muted-foreground/50 italic">No events</div>
            ) : (
              list.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  onOpen={onOpen}
                  onQuickAction={onQuickAction}
                  onDragStart={onDragStart}
                  compact
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
