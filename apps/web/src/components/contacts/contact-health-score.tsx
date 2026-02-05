"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Heart,
  TrendingUp,
  DollarSign,
  MessageSquare,
  Users,
  Lightbulb,
} from "lucide-react";

export interface HealthMetrics {
  engagement: number;
  payment: number;
  responsiveness: number;
  relationship: number;
}

interface ContactHealthScoreProps {
  metrics: HealthMetrics;
  tip?: string;
}

const HEALTH_LEVELS = [
  { min: 80, label: "EXCELLENT", color: "hsl(142 76% 36%)", emoji: "🟢" },
  { min: 60, label: "GOOD", color: "hsl(var(--kf-accent2))", emoji: "🟡" },
  { min: 40, label: "FAIR", color: "hsl(var(--kf-accent1))", emoji: "🟠" },
  { min: 0, label: "NEEDS ATTENTION", color: "hsl(0 84% 60%)", emoji: "🔴" },
];

const METRIC_CONFIG = [
  { key: "engagement", label: "Engagement", icon: TrendingUp, description: "Activity & interaction frequency" },
  { key: "payment", label: "Payment", icon: DollarSign, description: "Payment history & reliability" },
  { key: "responsiveness", label: "Responsiveness", icon: MessageSquare, description: "Reply speed & consistency" },
  { key: "relationship", label: "Relationship", icon: Users, description: "Trust & connection depth" },
] as const;

export function ContactHealthScore({ metrics, tip }: ContactHealthScoreProps) {
  const overallScore = useMemo(() => {
    const values = Object.values(metrics);
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }, [metrics]);

  const healthLevel = useMemo(() => {
    return HEALTH_LEVELS.find((l) => overallScore >= l.min) || HEALTH_LEVELS[HEALTH_LEVELS.length - 1];
  }, [overallScore]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5" style={{ color: healthLevel.color }} />
          <span className="font-semibold">Contact Health</span>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium"
          style={{ background: `${healthLevel.color}20`, color: healthLevel.color }}
        >
          <span>{healthLevel.emoji}</span>
          <span>{healthLevel.label}</span>
          <span className="font-bold">({overallScore}/100)</span>
        </div>
      </div>

      <div className="space-y-3">
        {METRIC_CONFIG.map(({ key, label, icon: Icon }) => {
          const value = metrics[key];
          const barColor = value >= 70 ? "hsl(142 76% 36%)" : value >= 40 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";

          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </div>
                <span className="font-medium">{value}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${value}%` }}
                  transition={{ duration: 0.8, delay: 0.1 }}
                  className="h-full rounded-full"
                  style={{ background: barColor }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {tip && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/30">
          <Lightbulb className="w-4 h-4 text-[hsl(var(--kf-accent2))] mt-0.5 flex-shrink-0" />
          <p className="text-sm text-[hsl(var(--kf-accent2))]">{tip}</p>
        </div>
      )}
    </motion.div>
  );
}
