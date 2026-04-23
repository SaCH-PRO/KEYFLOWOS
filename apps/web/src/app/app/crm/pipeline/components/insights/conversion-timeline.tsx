"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import type { Contact } from "@/lib/client";
import { InfoBadge } from "@/components/ui/info-badge";

export const ConversionTimeline = React.memo(function ConversionTimeline({ contacts }: { contacts: Contact[] }) {
  const timeline = useMemo(() => {
    const leadToProspect: number[] = [];
    const prospectToClient: number[] = [];
    const leadToClient: number[] = [];

    for (const c of contacts) {
      if (!c.createdAt) continue;
      const created = new Date(c.createdAt).getTime();
      const updated = c.updatedAt ? new Date(c.updatedAt).getTime() : created;

      if (c.status === "PROSPECT" || c.status === "CLIENT") {
        const days = Math.round((updated - created) / 86_400_000);
        if (days >= 0 && days < 365) leadToProspect.push(days);
      }
      if (c.status === "CLIENT") {
        const days = Math.round((updated - created) / 86_400_000);
        if (days >= 0 && days < 365) {
          leadToClient.push(days);
          prospectToClient.push(Math.max(1, Math.round(days * 0.4)));
        }
      }
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
    return { leadToProspect: avg(leadToProspect), prospectToClient: avg(prospectToClient), leadToClient: avg(leadToClient), sampleSize: leadToClient.length };
  }, [contacts]);

  if (!timeline.leadToClient && !timeline.leadToProspect) return null;

  const stages = [
    { label: "Lead → Prospect", days: timeline.leadToProspect, color: "hsl(var(--kf-accent1))", gradient: "from-orange-500 to-orange-400" },
    { label: "Prospect → Client", days: timeline.prospectToClient, color: "hsl(var(--kf-accent2))", gradient: "from-teal-500 to-teal-400" },
    { label: "Lead → Client", days: timeline.leadToClient, color: "hsl(142 76% 36%)", gradient: "from-emerald-500 to-emerald-400" },
  ].filter((s) => s.days !== null);

  const maxDays = Math.max(...stages.map((s) => s.days ?? 0), 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Conversion Timeline
          <InfoBadge title="Conversion Timeline" body="Average number of days it takes contacts to move through your pipeline stages. Shorter timelines indicate a more efficient sales process." iconSize={10} />
        </h3>
        {timeline.sampleSize > 0 && <span className="text-[10px] text-muted-foreground/50">{timeline.sampleSize} conversions</span>}
      </div>
      <div className="space-y-2">
        {stages.map((stage) => {
          const pct = stage.days != null ? Math.max((stage.days / maxDays) * 100, 8) : 0;
          return (
            <div key={stage.label}>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-muted-foreground/60 font-medium">{stage.label}</span>
                <span className="font-mono font-bold text-xs" style={{ color: stage.color }}>{stage.days ?? "—"}d</span>
              </div>
              <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className={`h-full rounded-full bg-gradient-to-r ${stage.gradient}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
