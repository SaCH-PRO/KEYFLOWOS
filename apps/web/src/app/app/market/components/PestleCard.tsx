"use client";

import { motion } from "framer-motion";

interface PestleCardProps {
  pestle: {
    political: string;
    economic: string;
    social: string;
    technological: string;
    legal: string;
    environmental: string;
  };
}

const factors = [
  { key: "political", label: "Political" },
  { key: "economic", label: "Economic" },
  { key: "social", label: "Social" },
  { key: "technological", label: "Technological" },
  { key: "legal", label: "Legal" },
  { key: "environmental", label: "Environmental" },
] as const;

export function PestleCard({ pestle }: PestleCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <h3 className="text-sm font-semibold">PESTLE Analysis</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {factors.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <p className="text-sm text-muted-foreground">{pestle[key] || "Not identified."}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
