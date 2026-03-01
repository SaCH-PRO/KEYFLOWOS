"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Users, TrendingUp, DollarSign, Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { Contact } from "@/lib/client";
import { formatTTD, stagger, buildWeeklyBuckets } from "./insights-shared";

function Sparkline({ data, color, width = 44, height = 18 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(" ");
  const areaPath = `M0,${height} L${points.split(" ").map((p, i) => (i === 0 ? p.split(",").join(",") : p)).join(" L")} L${width},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, "")})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((data[data.length - 1] - min) / range) * height} r="2" fill={color} />
    </svg>
  );
}

export const HeroStats = React.memo(function HeroStats({
  flowIntelligence, revenueData, contacts, onNavigatePipeline,
}: {
  flowIntelligence: FlowIntelligenceData | null;
  revenueData: RevenueData | null;
  contacts: Contact[];
  onNavigatePipeline?: (filter?: { status?: string; segment?: string }) => void;
}) {
  const totalRevenue = revenueData
    ? revenueData.fromActivePipeline + revenueData.fromRecurringClients + revenueData.fromColdLeads
    : 0;
  const overallConversion = flowIntelligence && flowIntelligence.leads > 0
    ? ((flowIntelligence.clients / flowIntelligence.leads) * 100).toFixed(1)
    : "0";
  const newThisWeek = flowIntelligence?.newThisWeek ?? 0;
  const convThisWeek = flowIntelligence?.conversionsThisWeek ?? 0;

  const sparkData = useMemo(() => buildWeeklyBuckets(contacts, 6), [contacts]);

  const stats = [
    {
      label: "Total Contacts",
      mobileLabel: "Total",
      value: contacts.length.toString(),
      sub: `${flowIntelligence?.leads ?? 0} leads, ${flowIntelligence?.clients ?? 0} clients`,
      icon: Users,
      accentVar: "--kf-accent2",
      sparkColor: "hsl(var(--kf-accent2))",
      trend: newThisWeek > 0 ? "up" as const : null,
      trendLabel: newThisWeek > 0 ? `+${newThisWeek} this week` : undefined,
      onClick: () => onNavigatePipeline?.(),
    },
    {
      label: "Conversion Rate",
      mobileLabel: "Convert",
      value: `${overallConversion}%`,
      sub: `${flowIntelligence?.leads ?? 0} → ${flowIntelligence?.clients ?? 0}`,
      icon: TrendingUp,
      accentVar: "--kf-accent1",
      sparkColor: "hsl(var(--kf-accent1))",
      trend: convThisWeek > 0 ? "up" as const : null,
      trendLabel: convThisWeek > 0 ? `${convThisWeek} this week` : undefined,
      onClick: () => onNavigatePipeline?.({ status: "CLIENT" }),
    },
    {
      label: "Pipeline Value",
      mobileLabel: "Pipeline",
      value: formatTTD(totalRevenue),
      sub: revenueData ? `${formatTTD(revenueData.fromActivePipeline)} active` : "No data",
      icon: DollarSign,
      accentVar: "--kf-accent1",
      sparkColor: "hsl(142 76% 36%)",
      trend: null,
      trendLabel: undefined,
      onClick: () => onNavigatePipeline?.({ segment: "high-value" }),
    },
    {
      label: "New This Week",
      mobileLabel: "New",
      value: newThisWeek.toString(),
      sub: `${convThisWeek} conversion${convThisWeek !== 1 ? "s" : ""}, ${flowIntelligence?.lost ?? 0} lost`,
      icon: Activity,
      accentVar: "--kf-accent2",
      sparkColor: "hsl(var(--kf-accent2))",
      trend: flowIntelligence && flowIntelligence.lost > 0 ? "down" as const : null,
      trendLabel: flowIntelligence && flowIntelligence.lost > 0 ? `${flowIntelligence.lost} lost` : undefined,
      onClick: () => onNavigatePipeline?.({ segment: "new-this-week" }),
    },
  ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-4 gap-1.5 sm:gap-2.5"
      role="group"
      aria-label="Key metrics"
    >
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <motion.button
            key={s.label}
            variants={stagger.item}
            onClick={s.onClick}
            className="relative overflow-hidden rounded-xl border border-border/50 bg-card p-2 sm:p-3 group hover:border-border/80 transition-all duration-200 text-left cursor-pointer"
          >
            <div
              className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.04] -translate-y-1/2 translate-x-1/2 blur-xl"
              style={{ background: `hsl(var(${s.accentVar}))` }}
              aria-hidden="true"
            />
            <div className="flex items-center gap-1 mb-1 sm:mb-1.5">
              <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider leading-tight sm:hidden">{s.mobileLabel}</span>
              <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider leading-tight hidden sm:inline">{s.label}</span>
            </div>
            <div className="hidden sm:flex items-center justify-end mb-1">
              <div className="opacity-50 group-hover:opacity-100 transition-opacity">
                <Sparkline data={sparkData} color={s.sparkColor} />
              </div>
            </div>
            <div className="text-sm sm:text-xl font-bold tracking-tight leading-tight" style={{ color: `hsl(var(${s.accentVar}))` }}>
              {s.value}
            </div>
            <div className="hidden sm:flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground/50">{s.sub}</span>
            </div>
            {s.trend && s.trendLabel && (
              <div className={`items-center gap-0.5 mt-1 text-[10px] font-semibold hidden sm:flex ${s.trend === "up" ? "text-emerald-400" : "text-red-400"}`}>
                {s.trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {s.trendLabel}
              </div>
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
});
