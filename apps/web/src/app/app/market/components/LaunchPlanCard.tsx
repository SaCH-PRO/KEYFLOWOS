"use client";

import { motion } from "framer-motion";

interface LaunchPlanCardProps {
  launchPlan: {
    summary: string;
    phases: { name: string; duration: string; actions: string[] }[];
  };
}

export function LaunchPlanCard({ launchPlan }: LaunchPlanCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <h3 className="text-sm font-semibold">90-Day Launch Plan</h3>
      <p className="text-sm text-muted-foreground">{launchPlan.summary || "No summary provided."}</p>
      {launchPlan.phases.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No phases identified.</p>
      ) : (
        <div className="space-y-4">
          {launchPlan.phases.map((phase, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl space-y-3"
              style={{ background: "hsl(var(--kf-muted) / 0.3)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{phase.name}</span>
                <span className="text-xs text-muted-foreground">{phase.duration}</span>
              </div>
              <ul className="space-y-1">
                {phase.actions.map((action, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full mt-2 flex-shrink-0 bg-foreground/50" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
