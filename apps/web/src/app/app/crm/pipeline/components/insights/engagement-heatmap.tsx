"use client";

import React, { useMemo } from "react";
import { Calendar } from "lucide-react";
import type { Contact } from "@/lib/client";

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const EngagementHeatmap = React.memo(function EngagementHeatmap({ contacts }: { contacts: Contact[] }) {
  const heatmapData = useMemo(() => {
    const dayCounts = new Array(7).fill(0);
    for (const c of contacts) {
      const meta = c.meta as Record<string, unknown> | undefined;
      const lastInteraction = meta?.lastInteractionAt as string | undefined;
      if (lastInteraction) {
        const day = new Date(lastInteraction).getDay();
        dayCounts[day === 0 ? 6 : day - 1]++;
      }
      if (c.createdAt) {
        const day = new Date(c.createdAt).getDay();
        dayCounts[day === 0 ? 6 : day - 1]++;
      }
    }
    return dayCounts;
  }, [contacts]);

  const maxCount = Math.max(...heatmapData, 1);
  const totalInteractions = heatmapData.reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" />
        Engagement Heatmap
      </h3>
      {totalInteractions === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-border/30 flex items-center justify-center mb-2">
            <Calendar className="w-4 h-4 text-muted-foreground/50" />
          </div>
          <p className="text-[10px] text-muted-foreground/50">Engagement data appears with interactions</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS_OF_WEEK.map((day, i) => {
              const count = heatmapData[i];
              const intensity = count / maxCount;
              const bg = intensity === 0 ? "bg-white/[0.02]" : intensity < 0.25 ? "bg-emerald-500/10" : intensity < 0.5 ? "bg-emerald-500/25" : intensity < 0.75 ? "bg-emerald-500/40" : "bg-emerald-500/65";
              return (
                <div key={day} className="flex flex-col items-center gap-1">
                  <div className={`w-full aspect-square rounded-lg ${bg} flex items-center justify-center hover:scale-105 transition-transform cursor-default`} title={`${day}: ${count}`}>
                    <span className="text-[11px] font-mono font-bold text-foreground/60">{count}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/50">{day}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 pt-1">
            <span>Less</span>
            <div className="flex gap-0.5">
              {["bg-white/[0.02]", "bg-emerald-500/10", "bg-emerald-500/25", "bg-emerald-500/40", "bg-emerald-500/65"].map((bg, i) => (
                <div key={i} className={`w-4 h-4 rounded-sm ${bg}`} />
              ))}
            </div>
            <span>More</span>
          </div>
        </>
      )}
    </div>
  );
});
