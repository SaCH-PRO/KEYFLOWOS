"use client";

import { motion } from "framer-motion";
import { Lightbulb, Star } from "lucide-react";
import { fadeUp } from "./types";

export function OpportunitiesCard({ opportunities }: { opportunities: string[] }) {
  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Opportunities
      </div>
      {opportunities.length > 0 ? (
        <div className="space-y-2">
          {opportunities.map((opp, i) => {
            const impact = i === 0 ? "high" : i <= 2 ? "medium" : "low";
            const impactBadge = impact === "high"
              ? { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "High Impact" }
              : impact === "medium"
                ? { bg: "bg-amber-500/20", text: "text-amber-400", label: "Medium Impact" }
                : { bg: "bg-muted/30", text: "text-muted-foreground", label: "Explore" };
            return (
              <div key={i} className="p-3 rounded-xl bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10 space-y-1">
                <div className="flex items-center gap-2">
                  <Star className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))] flex-shrink-0" />
                  <span className="text-[11px] text-foreground/80 leading-relaxed flex-1">{opp}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold flex-shrink-0 ${impactBadge.bg} ${impactBadge.text}`}>
                    {impactBadge.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Opportunities will appear after deeper analysis. Try re-analyzing with more profile data.</p>
      )}
    </motion.div>
  );
}
