"use client";

import { motion } from "framer-motion";
import { Shield, AlertTriangle, Lightbulb, Siren } from "lucide-react";

interface SwotCardProps {
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
}

const quadrants = [
  { key: "strengths", label: "Strengths", icon: Shield, color: "hsl(var(--kf-success))" },
  { key: "weaknesses", label: "Weaknesses", icon: AlertTriangle, color: "hsl(var(--kf-warning))" },
  { key: "opportunities", label: "Opportunities", icon: Lightbulb, color: "hsl(var(--kf-accent1))" },
  { key: "threats", label: "Threats", icon: Siren, color: "hsl(var(--kf-error))" },
] as const;

export function SwotCard({ swot }: SwotCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <h3 className="text-sm font-semibold">SWOT Analysis</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {quadrants.map(({ key, label, icon: Icon, color }) => {
          const items = swot[key] ?? [];
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon className="w-4 h-4" style={{ color }} />
                {label}
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">None identified.</p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="w-1 h-1 rounded-full mt-2 flex-shrink-0" style={{ background: color }} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
