"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";
import { EventCard } from "../event-card";
import { startOfDay, endOfDay } from "../calendar-utils";

interface Props {
  events: CalendarEvent[];
  cursor: Date;
  onOpen: (ev: CalendarEvent) => void;
  onQuickAction: (ev: CalendarEvent, action: string) => void;
  onDragStart?: (ev: CalendarEvent, e: React.DragEvent) => void;
  onDropOnHour?: (hour: number, e: React.DragEvent) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({
  events,
  cursor,
  onOpen,
  onQuickAction,
  onDragStart,
  onDropOnHour,
}: Props) {
  const dayEvents = useMemo(() => {
    const from = startOfDay(cursor).getTime();
    const to = endOfDay(cursor).getTime();
    return events
      .filter((e) => {
        const t = new Date(e.startAt).getTime();
        return t >= from && t <= to;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [events, cursor]);

  const byHour = useMemo(() => {
    const m = new Map<number, CalendarEvent[]>();
    for (const ev of dayEvents) {
      if (ev.allDay) continue;
      const h = new Date(ev.startAt).getHours();
      const arr = m.get(h) ?? [];
      arr.push(ev);
      m.set(h, arr);
    }
    return m;
  }, [dayEvents]);

  const allDay = dayEvents.filter((e) => e.allDay);

  return (
    <div className="space-y-3">
      {allDay.length > 0 && (
        <div className="space-y-1.5 pb-2 border-b border-border/40">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
            All day
          </div>
          {allDay.map((ev) => (
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
      <div className="space-y-1">
        {HOURS.map((h) => {
          const list = byHour.get(h) ?? [];
          const label = new Date(2000, 0, 1, h).toLocaleTimeString("en-US", {
            hour: "numeric",
          });
          return (
            <div
              key={h}
              className="grid grid-cols-[60px_1fr] gap-2 min-h-[40px]"
              onDragOver={(e) => {
                if (onDropOnHour) e.preventDefault();
              }}
              onDrop={(e) => onDropOnHour?.(h, e)}
            >
              <div className="text-[10px] text-muted-foreground/70 pt-1">{label}</div>
              <div className="border-t border-border/30 pt-1 space-y-1">
                {list.map((ev) => (
                  <EventCard
                    key={ev.id}
                    event={ev}
                    onOpen={onOpen}
                    onQuickAction={onQuickAction}
                    onDragStart={onDragStart}
                    compact
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
