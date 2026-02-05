"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Zap,
  AlertTriangle,
  ArrowRight,
  Flame,
  Snowflake,
} from "lucide-react";

export interface FlowIntelligenceData {
  totalContacts: number;
  leads: number;
  prospects: number;
  clients: number;
  lost: number;
  newThisWeek: number;
  conversionsThisWeek: number;
  contactsGoingCold: number;
  contactsReadyToAdvance: number;
  weeklyChange: number;
}

interface FlowIntelligenceProps {
  data: FlowIntelligenceData;
  onViewCold?: () => void;
  onViewReady?: () => void;
}

export function FlowIntelligence({ data, onViewCold, onViewReady }: FlowIntelligenceProps) {
  const momentum = useMemo(() => {
    const conversionRate = data.leads > 0 ? (data.conversionsThisWeek / data.leads) * 100 : 0;
    const growthFactor = data.weeklyChange > 0 ? 20 : data.weeklyChange < 0 ? -10 : 0;
    const activityScore = Math.min(data.newThisWeek * 5, 30);
    const coldPenalty = data.contactsGoingCold * -5;
    const readyBonus = data.contactsReadyToAdvance * 3;
    
    const score = Math.max(0, Math.min(100, 50 + conversionRate + growthFactor + activityScore + coldPenalty + readyBonus));
    return Math.round(score);
  }, [data]);

  const momentumLevel = useMemo(() => {
    if (momentum >= 75) return { label: "HIGH", color: "hsl(142 76% 36%)", icon: Flame };
    if (momentum >= 50) return { label: "STEADY", color: "hsl(var(--kf-accent2))", icon: TrendingUp };
    if (momentum >= 25) return { label: "LOW", color: "hsl(var(--kf-accent1))", icon: TrendingDown };
    return { label: "CRITICAL", color: "hsl(0 84% 60%)", icon: Snowflake };
  }, [momentum]);

  const MomentumIcon = momentumLevel.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          Your Contact Flow
        </h2>
        <div
          className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium"
          style={{ background: `${momentumLevel.color}20`, color: momentumLevel.color }}
        >
          <MomentumIcon className="w-4 h-4" />
          MOMENTUM: {momentumLevel.label}
          {data.weeklyChange !== 0 && (
            <span className="text-xs">
              ({data.weeklyChange > 0 ? "+" : ""}{data.weeklyChange}% this week)
            </span>
          )}
        </div>
      </div>

      <div className="relative h-3 bg-muted rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${momentum}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, ${momentumLevel.color}, ${momentumLevel.color}cc)` }}
        />
        <div className="absolute inset-0 flex items-center justify-end pr-2">
          <span className="text-[10px] font-bold text-foreground">{momentum}%</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 py-4">
        <FlowStage
          label="LEADS"
          count={data.leads}
          color="hsl(var(--kf-accent1))"
        />
        <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <FlowStage
          label="PROSPECTS"
          count={data.prospects}
          color="hsl(var(--kf-accent2))"
        />
        <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <FlowStage
          label="CLIENTS"
          count={data.clients}
          color="hsl(142 76% 36%)"
        />
      </div>

      <div className="text-xs text-muted-foreground text-center">
        <span className="font-medium text-foreground">{data.conversionsThisWeek}</span> conversions this week
        {data.newThisWeek > 0 && (
          <span className="ml-2">
            • <span className="font-medium text-foreground">{data.newThisWeek}</span> new contacts
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {data.contactsReadyToAdvance > 0 && (
          <button
            onClick={onViewReady}
            className="flex items-center gap-2 p-3 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/30 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors text-left"
          >
            <Zap className="w-5 h-5 text-[hsl(var(--kf-accent2))]" />
            <div>
              <div className="text-sm font-medium">{data.contactsReadyToAdvance} ready to advance</div>
              <div className="text-xs text-muted-foreground">High engagement detected</div>
            </div>
          </button>
        )}
        {data.contactsGoingCold > 0 && (
          <button
            onClick={onViewCold}
            className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left"
          >
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div>
              <div className="text-sm font-medium">{data.contactsGoingCold} going cold</div>
              <div className="text-xs text-muted-foreground">Action needed</div>
            </div>
          </button>
        )}
      </div>
    </motion.div>
  );
}

function FlowStage({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="text-center flex-1">
      <div
        className="text-3xl font-bold"
        style={{ color }}
      >
        {count}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
