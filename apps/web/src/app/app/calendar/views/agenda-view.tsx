"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";
import { EventCard } from "../event-card";
import { isSameDay, startOfDay } from "../calendar-utils";

interface Props {
  events: CalendarEvent[];
  rangeFrom: Date;
  rangeTo: Date;
  onOpen: (ev: CalendarEvent) => void;
  onQuickAction: (ev: CalendarEvent, action: string) => void;
  onDragStart?: (ev: CalendarEvent, e: React.DragEvent) => void;
  onDropOnDay?: (day: Date, e: React.DragEvent) => void;
}

export function AgendaView({
  events,
  rangeFrom,
  rangeTo,
  onOpen,
  onQuickAction,
  onDragStart,
  onDropOnDay,
}: Props) {
  const days = useMemo(() => {
    const arr: Date[] = [];
    let d = startOfDay(rangeFrom);
    const end = startOfDay(rangeTo);
    while (d <= end) {
      arr.push(new Date(d));
      d = new Date(d.getTime() + 86400000);
    }
    return arr;
  }, [rangeFrom, rangeTo]);

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
    <div className="space-y-4">
      {days.map((day) => {
        const key = startOfDay(day).toISOString();
        const dayEvents = grouped.get(key) ?? [];
        const today = isSameDay(day, new Date());
        return (
          <div
            key={key}
            className="space-y-2"
            onDragOver={(e) => {
              if (onDropOnDay) e.preventDefault();
            }}
            onDrop={(e) => onDropOnDay?.(day, e)}
          >
            <div className="flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-sm py-1 z-10">
              <h4
                className={`text-xs font-semibold ${today ? "" : "text-muted-foreground"}`}
                style={today ? { color: "hsl(var(--kf-accent1))" } : undefined}
              >
                {day.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
                {today && (
                  <span
                    className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.15)",
                      color: "hsl(var(--kf-accent1))",
                    }}
                  >
                    TODAY
                  </span>
                )}
              </h4>
              <span className="text-[10px] text-muted-foreground">
                {dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}
              </span>
            </div>
            {dayEvents.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70 italic pl-1 py-2">
                Nothing scheduled
              </div>
            ) : (
              <div className="space-y-1.5">
                {dayEvents.map((ev) => (
                  <EventCard
                    key={ev.id}
                    event={ev}
                    onOpen={onOpen}
                    onQuickAction={onQuickAction}
                    onDragStart={onDragStart}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
