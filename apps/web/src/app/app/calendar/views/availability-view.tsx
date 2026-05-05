"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";
import { startOfDay, startOfWeek } from "../calendar-utils";

interface Props {
  events: CalendarEvent[];
  cursor: Date;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 8am – 7pm

export function AvailabilityView({ events, cursor }: Props) {
  const days = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000));
  }, [cursor]);

  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const ev of events) {
      if (ev.allDay) continue;
      const start = new Date(ev.startAt);
      const end = ev.endAt ? new Date(ev.endAt) : new Date(start.getTime() + 30 * 60 * 1000);
      const dayKey = startOfDay(start).toISOString();
      for (let h = start.getHours(); h <= end.getHours(); h++) {
        set.add(`${dayKey}-${h}`);
      }
    }
    return set;
  }, [events]);

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted-foreground">
        Green = free, amber = booked. Heuristic only — see Time Intelligence for richer signals.
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-1">
        <div />
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className="text-[10px] uppercase font-semibold text-muted-foreground text-center"
          >
            {d.toLocaleDateString("en-US", { weekday: "short" })} {d.getDate()}
          </div>
        ))}
        {HOURS.map((h) => (
          <div key={`row-${h}`} className="contents">
            <div className="text-[10px] text-muted-foreground text-right pr-1 pt-0.5">
              {new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}
            </div>
            {days.map((d) => {
              const key = `${startOfDay(d).toISOString()}-${h}`;
              const isBusy = busy.has(key);
              return (
                <div
                  key={key}
                  className="h-8 rounded"
                  style={{
                    background: isBusy
                      ? "hsl(38 92% 50% / 0.25)"
                      : "hsl(142 71% 45% / 0.12)",
                    border: isBusy
                      ? "1px solid hsl(38 92% 50% / 0.45)"
                      : "1px solid hsl(142 71% 45% / 0.25)",
                  }}
                  title={isBusy ? "Busy" : "Available"}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
