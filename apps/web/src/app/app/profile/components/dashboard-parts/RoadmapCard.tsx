"use client";

import { motion } from "framer-motion";
import { Target, CheckCircle2 } from "lucide-react";
import { RoadmapItem, fadeUp } from "./types";

export function RoadmapCard({ items }: { items: RoadmapItem[] }) {
  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4 md:col-span-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Target className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Priority Roadmap
      </div>
      {items.length > 0 ? (
        <div className="relative pl-6 space-y-0">
          {items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
            const title = item.actionTitle || item.title || "Untitled Step";
            return (
              <div key={item.id} className="relative pb-6 last:pb-0">
                {!isLast && (
                  <div
                    className="absolute left-[-16px] top-6 w-px h-[calc(100%-6px)]"
                    style={{ background: "hsl(var(--border) / 0.4)" }}
                  />
                )}
                <div className="absolute left-[-22px] top-1">
                  <div
                    className="w-[13px] h-[13px] rounded-full border-2 flex items-center justify-center text-[7px] font-bold"
                    style={{
                      borderColor: isFirst ? "hsl(var(--kf-accent1))" : "hsl(var(--border) / 0.6)",
                      background: isFirst ? "hsl(var(--kf-accent1))" : "transparent",
                      color: isFirst ? "white" : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {index + 1}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{title}</span>
                    {isFirst && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]">
                        Start Here
                      </span>
                    )}
                    {item.linkedScoreArea && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-muted/30 text-muted-foreground">
                        {item.linkedScoreArea}
                      </span>
                    )}
                  </div>
                  {item.whyItMatters && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{item.whyItMatters}</p>
                  )}
                  {item.expectedOutcome && (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {item.expectedOutcome}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No roadmap items available yet. Re-analyze to generate your roadmap.</p>
      )}
    </motion.div>
  );
}
