"use client";

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/client";

interface Props {
  events: CalendarEvent[];
  rangeFrom: Date;
  rangeTo: Date;
}

export function WorkloadView({ events, rangeFrom, rangeTo }: Props) {
  const rows = useMemo(() => {
    const m = new Map<
      string,
      { events: number; minutes: number; revenue: number }
    >();
    for (const ev of events) {
      const key = ev.assigneeId || ev.staffId || "unassigned";
      const start = new Date(ev.startAt).getTime();
      const end = ev.endAt ? new Date(ev.endAt).getTime() : start + 30 * 60 * 1000;
      const minutes = Math.max(15, Math.round((end - start) / 60000));
      const cur = m.get(key) ?? { events: 0, minutes: 0, revenue: 0 };
      cur.events += 1;
      cur.minutes += minutes;
      cur.revenue += ev.amount ?? 0;
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [events]);

  const days = Math.max(1, Math.round((rangeTo.getTime() - rangeFrom.getTime()) / 86400000));
  const capacityMin = days * 8 * 60;

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-muted-foreground">
        Capacity assumption: {days} day{days === 1 ? "" : "s"} × 8h ={" "}
        {(capacityMin / 60).toFixed(0)}h per assignee.
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-8 text-center">
          No assigned work in this range.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = Math.min(150, Math.round((r.minutes / capacityMin) * 100));
            const over = pct > 100;
            return (
              <div key={r.key} className="rounded-lg border border-border/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate">{r.key}</span>
                  <span className={over ? "text-red-400" : "text-muted-foreground"}>
                    {r.events} event{r.events === 1 ? "" : "s"} · {(r.minutes / 60).toFixed(1)}h ·{" "}
                    {pct}%
                  </span>
                </div>
                <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      background: over
                        ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                        : "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
