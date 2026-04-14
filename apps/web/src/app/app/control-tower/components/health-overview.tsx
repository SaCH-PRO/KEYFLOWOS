"use client";

import { motion } from "framer-motion";
import { SectionCard } from "@/components/ui/section-card";
import { Activity } from "lucide-react";

type HealthIndicator = {
  area: string;
  status: "good" | "warning" | "critical";
  detail: string;
};

const STATUS_CONFIG = {
  good: { color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)", label: "Healthy" },
  warning: { color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)", label: "Needs Attention" },
  critical: { color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)", label: "Critical" },
};

const AREA_LABELS: Record<string, string> = {
  revenue: "Revenue",
  crm: "Client Pipeline",
  projects: "Projects",
  bookings: "Calendar",
  expenses: "Expenses",
  profitability: "Profitability",
};

function MomentumRing({ score }: { score: number }) {
  const size = 80;
  const r = size * 0.39;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "hsl(var(--kf-success))" : score >= 40 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--kf-muted) / 0.15)" strokeWidth="5" />
          <motion.circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold leading-none">{score}</span>
          <span className="text-[9px] font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>/ 100</span>
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
        Momentum
      </span>
    </div>
  );
}

export function HealthOverview({
  momentumScore,
  healthIndicators,
}: {
  momentumScore: number;
  healthIndicators: HealthIndicator[];
}) {
  const alerts = healthIndicators.filter((h) => h.status !== "good");
  const goodCount = healthIndicators.filter((h) => h.status === "good").length;

  return (
    <SectionCard title="Business Health" subtitle="Cross-module status at a glance" icon={Activity}>
      <div className="flex items-start gap-5">
        <MomentumRing score={momentumScore} />
        <div className="flex-1 space-y-1.5 min-w-0">
          {alerts.length === 0 && (
            <div
              className="rounded-xl px-3 py-2 text-xs font-medium"
              style={{ background: STATUS_CONFIG.good.bg, color: STATUS_CONFIG.good.color }}
            >
              All systems healthy — {goodCount} modules clear
            </div>
          )}
          {alerts.map((h, i) => {
            const cfg = STATUS_CONFIG[h.status];
            return (
              <motion.div
                key={`${h.area}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                style={{ background: cfg.bg }}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}40` }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {AREA_LABELS[h.area] ?? h.area}
                  </span>
                  <span className="text-[10px] ml-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {h.detail}
                  </span>
                </div>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
                  style={{ color: cfg.color }}
                >
                  {cfg.label}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
