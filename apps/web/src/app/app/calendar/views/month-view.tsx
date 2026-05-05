"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";
import { isSameDay, moduleMeta, startOfDay, startOfMonth } from "../calendar-utils";

interface Props {
  events: CalendarEvent[];
  cursor: Date;
  onSelectDay: (day: Date) => void;
  onOpen: (ev: CalendarEvent) => void;
  onDropOnDay?: (day: Date, e: React.DragEvent) => void;
}

export function MonthView({ events, cursor, onSelectDay, onOpen, onDropOnDay }: Props) {
  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86400000));
  }, [cursor]);

  const grouped = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = startOfDay(new Date(ev.startAt)).toISOString();
      const arr = m.get(key) ?? [];
      arr.push(ev);
      m.set(key, arr);
    }
    return m;
  }, [events]);

  const month = cursor.getMonth();
  const today = new Date();

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day) => {
          const key = startOfDay(day).toISOString();
          const list = grouped.get(key) ?? [];
          const inMonth = day.getMonth() === month;
          const isToday = isSameDay(day, today);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(day)}
              onDragOver={(e) => {
                if (onDropOnDay) e.preventDefault();
              }}
              onDrop={(e) => onDropOnDay?.(day, e)}
              className={`text-left rounded-lg border border-border/40 p-1.5 min-h-[88px] flex flex-col gap-1 transition-colors hover:bg-muted/40 ${
                inMonth ? "" : "opacity-40"
              }`}
              style={
                isToday
                  ? {
                      borderColor: "hsl(var(--kf-accent1) / 0.6)",
                      background: "hsl(var(--kf-accent1) / 0.05)",
                    }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11px] font-semibold ${isToday ? "" : "text-muted-foreground"}`}
                  style={isToday ? { color: "hsl(var(--kf-accent1))" } : undefined}
                >
                  {day.getDate()}
                </span>
                {list.length > 0 && (
                  <span className="text-[9px] text-muted-foreground">{list.length}</span>
                )}
              </div>
              <div className="space-y-0.5 overflow-hidden">
                {list.slice(0, 3).map((ev) => {
                  const meta = moduleMeta(ev.module);
                  return (
                    <div
                      key={ev.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(ev);
                      }}
                      className="flex items-center gap-1 text-[9px] truncate hover:underline"
                      style={{ color: meta.color }}
                    >
                      <span
                        className="inline-block w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: meta.color }}
                      />
                      <span className="truncate">{ev.title}</span>
                    </div>
                  );
                })}
                {list.length > 3 && (
                  <div className="text-[9px] text-muted-foreground">+{list.length - 3} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
