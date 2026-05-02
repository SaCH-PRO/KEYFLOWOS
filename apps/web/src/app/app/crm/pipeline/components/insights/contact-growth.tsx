"use client";

import React, { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { Contact } from "@/lib/client";
import { type Period, PERIOD_MS, RECHARTS_TOOLTIP_STYLE } from "./insights-shared";

interface GrowthBucket { label: string; count: number; }

export const GrowthTrend = React.memo(function GrowthTrend({ contacts, period }: { contacts: Contact[]; period: Period }) {
  const buckets = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- audited: time-bucketed growth chart needs current time
    const now = Date.now();
    const effectivePeriod = period === "custom" ? "90d" : period;
    const ms = PERIOD_MS[effectivePeriod];
    const bucketCount = effectivePeriod === "7d" ? 7 : 6;
    const bucketSize = ms / bucketCount;
    const cutoff = now - ms;

    const result: GrowthBucket[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const start = cutoff + i * bucketSize;
      const end = start + bucketSize;
      const count = contacts.filter((c) => {
        const d = c.createdAt ? new Date(c.createdAt).getTime() : 0;
        return d >= start && d < end;
      }).length;

      let label: string;
      if (effectivePeriod === "7d") {
        label = new Date(start).toLocaleDateString("en-TT", { weekday: "short" });
      } else if (effectivePeriod === "30d") {
        label = new Date(start).toLocaleDateString("en-TT", { month: "short", day: "numeric" });
      } else {
        label = new Date(start).toLocaleDateString("en-TT", { month: "short" });
      }
      result.push({ label, count });
    }
    return result;
  }, [contacts, period]);

  const totalNew = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" />
          Contact Growth
        </h3>
        {totalNew > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))]">+{totalNew}</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="growthBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.6, fontSize: 10 }}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
            cursor={RECHARTS_TOOLTIP_STYLE.cursor}
            formatter={((value: number | undefined) => [`${value ?? 0} contacts`, 'New']) as never}
          />
          <Bar dataKey="count" fill="url(#growthBarGrad)" radius={[4, 4, 0, 0]} animationDuration={800} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});
