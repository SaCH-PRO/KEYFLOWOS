"use client";

import { motion } from "framer-motion";
import { Flag, CheckCircle2, Lightbulb, ChevronRight } from "lucide-react";
import { Recommendation, fadeUp, severityBadge, priorityToSeverity } from "./types";

export function RecommendationsCard({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Flag className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Missing Essentials
      </div>
      {recommendations.length > 0 ? (
        <div className="space-y-2">
          {recommendations.map((rec) => {
            const sev = severityBadge(priorityToSeverity(rec.priority));
            return (
              <div key={rec.id} className="p-3 rounded-xl bg-muted/10 border border-border/20 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${sev.bg} ${sev.text}`}>
                    {sev.label}
                  </span>
                  <span className="text-xs font-medium flex-1">{rec.title}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.description}</p>
                {rec.suggestedAction && (
                  rec.actionUrl ? (
                    <a
                      href={rec.actionUrl}
                      className="text-[11px] text-[hsl(var(--kf-accent1))] flex items-center gap-1 hover:underline min-h-[44px] py-2"
                    >
                      <Lightbulb className="w-3 h-3 flex-shrink-0" />
                      {rec.suggestedAction}
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                    </a>
                  ) : (
                    <p className="text-[11px] text-[hsl(var(--kf-accent1))] flex items-center gap-1">
                      <Lightbulb className="w-3 h-3 flex-shrink-0" />
                      {rec.suggestedAction}
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">No missing essentials identified. You&apos;re on track.</p>
        </div>
      )}
    </motion.div>
  );
}
