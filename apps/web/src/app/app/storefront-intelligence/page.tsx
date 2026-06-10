"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Store,
  TrendingUp,
  Eye,
  ShoppingCart,
  MousePointerClick,
  Globe,
  Sparkles,
  AlertTriangle,
  Zap,
  BarChart3,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";

interface StorefrontMetric {
  label: string;
  value: string;
  change: number;
  icon: React.ElementType;
}

interface TrafficSource {
  source: string;
  visitors: number;
  conversions: number;
  rate: number;
  trend: number;
}

interface ConversionFunnel {
  stage: string;
  count: number;
  dropOff: number;
  rate: number;
}

interface VisitorInsight {
  id: string;
  type: "trend" | "alert" | "opportunity";
  title: string;
  description: string;
  metric?: string;
}

function MetricCard({ metric, index }: { metric: StorefrontMetric; index: number }) {
  const Icon = metric.icon;
  const isPositive = metric.change >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </div>
        <span className="text-[11px] text-muted-foreground">{metric.label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums">{metric.value}</div>
      <div className={`text-[11px] font-medium mt-1 ${isPositive ? "text-emerald-500" : "text-rose-500"}`}>
        {isPositive ? "+" : ""}{metric.change}% vs last week
      </div>
    </motion.div>
  );
}

function TrafficSourceRow({ source, index }: { source: TrafficSource; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0"
    >
      <div className="w-8 text-[11px] font-medium text-muted-foreground">#{index + 1}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground">{source.source}</div>
        <div className="text-[10px] text-muted-foreground">{source.visitors.toLocaleString()} visitors</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-semibold">{source.rate}%</div>
        <div className={`text-[10px] ${source.trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
          {source.trend >= 0 ? "+" : ""}{source.trend}%
        </div>
      </div>
    </motion.div>
  );
}

function FunnelStage({ stage, index, maxCount }: { stage: ConversionFunnel; index: number; maxCount: number }) {
  const widthPct = (stage.count / maxCount) * 100;
  const colors = ["bg-[hsl(var(--kf-accent1))]", "bg-[hsl(var(--kf-accent2))]", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];
  const color = colors[index % colors.length];

  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0 }}
      animate={{ opacity: 1, scaleX: 1 }}
      transition={{ delay: index * 0.1, duration: 0.5, ease: "easeOut" }}
      className="origin-left"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground">{stage.stage}</span>
        <span className="text-[11px] text-muted-foreground">{stage.count.toLocaleString()}</span>
      </div>
      <div className="w-full h-6 rounded-lg bg-muted/20 overflow-hidden relative">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${widthPct}%` }}
          transition={{ delay: index * 0.1 + 0.2, duration: 0.6, ease: "easeOut" }}
          className={`h-full ${color} rounded-lg`}
        />
        <div className="absolute inset-0 flex items-center px-2">
          <span className="text-[10px] font-medium text-white mix-blend-difference">{stage.rate}% conversion</span>
        </div>
      </div>
      {stage.dropOff > 0 && (
        <div className="text-[10px] text-rose-500 mt-0.5">{stage.dropOff}% drop-off</div>
      )}
    </motion.div>
  );
}

export default function StorefrontIntelligencePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const metrics: StorefrontMetric[] = useMemo(() => [
    { label: "Visitors", value: "3,847", change: 18.2, icon: Eye },
    { label: "Conversions", value: "284", change: 12.5, icon: ShoppingCart },
    { label: "Conversion Rate", value: "7.4%", change: 3.1, icon: MousePointerClick },
    { label: "Revenue", value: "$8,420", change: 24.8, icon: TrendingUp },
    { label: "Avg. Order", value: "$29.60", change: -2.3, icon: Target },
    { label: "Bounce Rate", value: "34.2%", change: -5.1, icon: AlertTriangle },
  ], []);

  const trafficSources: TrafficSource[] = useMemo(() => [
    { source: "Organic Search", visitors: 1240, conversions: 112, rate: 9.0, trend: 15 },
    { source: "Direct", visitors: 980, conversions: 68, rate: 6.9, trend: 8 },
    { source: "Social Media", visitors: 756, conversions: 52, rate: 6.9, trend: 22 },
    { source: "Email Campaign", visitors: 420, conversions: 38, rate: 9.0, trend: -3 },
    { source: "Referrals", visitors: 312, conversions: 14, rate: 4.5, trend: 5 },
  ], []);

  const funnel: ConversionFunnel[] = useMemo(() => [
    { stage: "Page Views", count: 3847, dropOff: 0, rate: 100 },
    { stage: "Product Views", count: 2184, dropOff: 43, rate: 56.8 },
    { stage: "Add to Cart", count: 892, dropOff: 59, rate: 23.2 },
    { stage: "Checkout Started", count: 456, dropOff: 49, rate: 11.9 },
    { stage: "Purchase Completed", count: 284, dropOff: 38, rate: 7.4 },
  ], []);

  const insights: VisitorInsight[] = useMemo(() => [
    { id: "1", type: "opportunity", title: "Mobile Conversion Gap", description: "Mobile visitors convert at 4.2% vs 9.8% on desktop. Optimizing mobile checkout could add $2,100/week.", metric: "+$2,100/week" },
    { id: "2", type: "trend", title: "Social Traffic Surge", description: "Instagram traffic up 45% this week. 68% of visitors are new. Consider a welcome offer.", metric: "+45%" },
    { id: "3", type: "alert", title: "Cart Abandonment Spike", description: "Cart abandonment hit 62% yesterday (normal: 48%). Payment friction suspected.", metric: "62%" },
    { id: "4", type: "opportunity", title: "Peak Hours Untapped", description: "Traffic peaks 7-9pm but no live support. Adding chat could convert 15 more visitors daily.", metric: "+15/day" },
  ], []);

  if (loading) {
    return (
      <WorkspaceShell icon={Store} title="Storefront Intelligence" subtitle="Real-time analytics and conversion optimization">
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-24 animate-pulse" />
            ))}
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={Store} title="Storefront Intelligence" subtitle="Real-time analytics and conversion optimization">
      <div className="space-y-6">
        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {metrics.map((m, i) => (
            <MetricCard key={m.label} metric={m} index={i} />
          ))}
        </div>

        {/* Funnel & Traffic */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Conversion Funnel" icon={BarChart3}>
            <div className="p-4 space-y-4">
              {funnel.map((stage, i) => (
                <FunnelStage key={stage.stage} stage={stage} index={i} maxCount={funnel[0].count} />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Traffic Sources" icon={Globe}>
            <div className="p-4">
              {trafficSources.map((source, i) => (
                <TrafficSourceRow key={source.source} source={source} index={i} />
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Insights */}
        <SectionCard title="AI Insights" icon={Sparkles} compact noPadding>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
            {insights.map((insight, i) => {
              const config = {
                trend: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: TrendingUp },
                alert: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
                opportunity: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Zap },
              }[insight.type];
              const Icon = config.icon;
              return (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.3 }}
                  className={`rounded-xl border ${config.border} ${config.bg} p-4`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-xs font-semibold text-foreground">{insight.title}</h3>
                        {insight.metric && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-background/60 text-foreground">
                            {insight.metric}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
