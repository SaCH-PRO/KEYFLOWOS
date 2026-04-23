"use client";

import React, { useMemo } from "react";
import { Target } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { Contact } from "@/lib/client";
import { InfoBadge } from "@/components/ui/info-badge";
import { RECHARTS_TOOLTIP_STYLE } from "./insights-shared";

const LEAD_SCORE_COLORS = { Hot: '#ef4444', Warm: '#f97316', Cool: '#14b8a6', Cold: '#6482a6' };

export const LeadScoreDistribution = React.memo(function LeadScoreDistribution({ contacts }: { contacts: Contact[] }) {
  const buckets = useMemo(() => {
    let hot = 0, warm = 0, cool = 0, cold = 0;
    for (const c of contacts) {
      const score = (c as Record<string, unknown>).leadScore as number | null | undefined;
      if (score == null) continue;
      if (score >= 75) hot++;
      else if (score >= 50) warm++;
      else if (score >= 25) cool++;
      else cold++;
    }
    return [
      { name: "Hot", value: hot, color: LEAD_SCORE_COLORS.Hot },
      { name: "Warm", value: warm, color: LEAD_SCORE_COLORS.Warm },
      { name: "Cool", value: cool, color: LEAD_SCORE_COLORS.Cool },
      { name: "Cold", value: cold, color: LEAD_SCORE_COLORS.Cold },
    ].filter((b) => b.value > 0);
  }, [contacts]);

  const total = buckets.reduce((s, b) => s + b.value, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5" />
        Lead Scores
        <InfoBadge title="Lead Score Methodology" body="Scores are calculated from engagement signals: email opens, booking frequency, invoice payment speed, and recency of interaction. Hot (75-100), Warm (50-74), Cool (25-49), Cold (0-24)." iconSize={10} />
      </h3>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={buckets}
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={62}
            dataKey="value"
            paddingAngle={2}
            animationDuration={800}
          >
            {buckets.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
            formatter={((value: number | undefined, name: string | undefined) => [`${value ?? 0} contacts (${total > 0 ? Math.round(((value ?? 0) / total) * 100) : 0}%)`, name ?? '']) as never}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-2.5 flex-wrap justify-center">
        {buckets.map((b) => (
          <div key={b.name} className="flex items-center gap-1 text-[10px]">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: b.color }} />
            <span className="text-muted-foreground/60">{b.name}</span>
            <span className="font-mono font-semibold text-muted-foreground/70">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
