"use client";

import { motion } from "framer-motion";

interface Competitor {
  id: string;
  name: string;
  threatLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  strengths: string[];
  weaknesses: string[];
  positioning: string | null;
}

interface CompetitorListProps {
  competitors: Competitor[];
}

function ThreatBadge({ level }: { level: Competitor["threatLevel"] }) {
  if (!level) return null;
  const colors = {
    LOW: "hsl(var(--kf-success))",
    MEDIUM: "hsl(var(--kf-warning))",
    HIGH: "hsl(var(--kf-error))",
  };
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${colors[level]}20`, color: colors[level] }}
    >
      {level} threat
    </span>
  );
}

export function CompetitorList({ competitors }: CompetitorListProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <h3 className="text-sm font-semibold">Competitor Profile</h3>
      {competitors.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No competitors identified.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {competitors.map((c) => (
            <div
              key={c.id}
              className="p-4 rounded-xl space-y-3"
              style={{ background: "hsl(var(--kf-muted) / 0.3)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{c.name}</span>
                <ThreatBadge level={c.threatLevel} />
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Strengths:</span>{" "}
                  {c.strengths.join(", ") || "None noted"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Weaknesses:</span>{" "}
                  {c.weaknesses.join(", ") || "None noted"}
                </p>
                {c.positioning && (
                  <p>
                    <span className="font-medium text-foreground">Positioning:</span> {c.positioning}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
