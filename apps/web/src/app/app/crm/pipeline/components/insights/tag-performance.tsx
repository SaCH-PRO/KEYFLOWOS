"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Tag, Hash } from "lucide-react";
import type { Contact } from "@/lib/client";
import { formatTTD } from "./insights-shared";

export const TagPerformance = React.memo(function TagPerformance({ contacts, onNavigatePipeline }: { contacts: Contact[]; onNavigatePipeline?: (filter?: { status?: string }) => void }) {
  const tagData = useMemo(() => {
    const map: Record<string, { count: number; clients: number; revenue: number }> = {};
    for (const c of contacts) {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      const revenue = c.meta?.totalRevenue ?? 0;
      const isClient = c.status === "CLIENT";
      for (const tag of tags) {
        if (!map[tag]) map[tag] = { count: 0, clients: 0, revenue: 0 };
        map[tag].count++;
        if (isClient) map[tag].clients++;
        map[tag].revenue += revenue;
      }
    }
    return Object.entries(map)
      .filter(([, v]) => v.count >= 2)
      .map(([tag, v]) => ({ tag, count: v.count, clients: v.clients, revenue: v.revenue, conversionRate: v.count > 0 ? Math.round((v.clients / v.count) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue || b.conversionRate - a.conversionRate)
      .slice(0, 8);
  }, [contacts]);

  if (tagData.length === 0) return null;

  const maxRevenue = Math.max(...tagData.map((t) => t.revenue), 1);

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1.5">
        <Tag className="w-3.5 h-3.5" />
        Tag Performance
      </h3>
      <div className="space-y-1">
        {tagData.map((t) => {
          const pct = (t.revenue / maxRevenue) * 100;
          return (
            <button
              key={t.tag}
              onClick={() => onNavigatePipeline?.()}
              className="w-full text-left group hover:bg-white/[0.02] rounded-md p-1 -mx-1 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <div className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-muted-foreground/50" />
                  <span className="font-medium text-foreground/70">{t.tag}</span>
                  <span className="text-[10px] text-muted-foreground/50">{t.count}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {t.revenue > 0 && <span className="text-[10px] font-bold text-emerald-400">{formatTTD(t.revenue)}</span>}
                  <span className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded-sm ${
                    t.conversionRate >= 50 ? "text-emerald-400 bg-emerald-500/8" : t.conversionRate >= 25 ? "text-amber-400 bg-amber-500/8" : "text-muted-foreground/50 bg-white/[0.02]"
                  }`}>{t.conversionRate}%</span>
                </div>
              </div>
              {t.revenue > 0 && (
                <div className="h-0.5 bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500/30 to-emerald-400" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
