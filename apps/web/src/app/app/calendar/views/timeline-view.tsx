"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";
import { fmtTime, moduleMeta } from "../calendar-utils";

interface Props {
  events: CalendarEvent[];
  rangeFrom: Date;
  rangeTo: Date;
  onOpen: (ev: CalendarEvent) => void;
}

export function TimelineView({ events, rangeFrom, rangeTo, onOpen }: Props) {
  const groups = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = ev.assigneeId || ev.staffId || ev.module || "unassigned";
      const arr = m.get(key) ?? [];
      arr.push(ev);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return Array.from(m.entries());
  }, [events]);

  const totalMs = rangeTo.getTime() - rangeFrom.getTime();

  return (
    <div className="space-y-4">
      <div className="text-[10px] text-muted-foreground">
        Range: {rangeFrom.toLocaleDateString()} — {rangeTo.toLocaleDateString()}
      </div>
      {groups.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-8 text-center">
          No events in this range.
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(([key, list]) => (
            <div
              key={key}
              className="grid grid-cols-[140px_1fr] gap-2 items-start py-2 border-b border-border/30"
            >
              <div className="text-xs font-medium truncate">{key}</div>
              <div className="relative h-8 bg-muted/20 rounded">
                {list.map((ev) => {
                  const start = new Date(ev.startAt).getTime();
                  const end = ev.endAt
                    ? new Date(ev.endAt).getTime()
                    : start + 30 * 60 * 1000;
                  const left = Math.max(0, ((start - rangeFrom.getTime()) / totalMs) * 100);
                  const width = Math.max(
                    1,
                    ((Math.min(end, rangeTo.getTime()) - Math.max(start, rangeFrom.getTime())) /
                      totalMs) *
                      100,
                  );
                  const meta = moduleMeta(ev.module);
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpen(ev)}
                      title={`${ev.title} · ${fmtTime(new Date(ev.startAt))}`}
                      className="absolute top-1 bottom-1 rounded text-[9px] px-1 truncate text-left hover:brightness-125"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: `${meta.color}cc`,
                        color: "white",
                      }}
                    >
                      {ev.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
