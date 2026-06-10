"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Users,
  Target,
  Zap,
  BarChart3,
  Activity,
  Sparkles,
  ShoppingCart,
  MessageSquare,
  CalendarDays,
  ChevronRight,
  Bot,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";

/* ─────────── Types ─────────── */

interface GrowthMetric {
  label: string;
  value: string;
  change: number;
  trend: "up" | "down" | "flat";
  period: string;
}

interface GrowthDriver {
  id: string;
  name: string;
  category: "acquisition" | "retention" | "revenue" | "efficiency";
  score: number;
  impact: number;
  trend: number;
  description: string;
}

interface GrowthGoal {
  id: string;
  title: string;
  target: string;
  current: string;
  progress: number;
  deadline: string;
  category: string;
}

interface Prediction {
  id: string;
  title: string;
  confidence: number;
  timeframe: string;
  impact: string;
  description: string;
}

/* ─────────── Components ─────────── */

function MetricCard({ metric, index }: { metric: GrowthMetric; index: number }) {
  const isPositive = metric.change >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4"
    >
      <div className="text-[11px] text-muted-foreground mb-1">{metric.label}</div>
      <div className="text-xl font-bold tabular-nums mb-1">{metric.value}</div>
      <div className="flex items-center gap-1.5">
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md ${
          isPositive ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
        }`}>
          {isPositive ? "+" : ""}{metric.change}%
        </span>
        <span className="text-[10px] text-muted-foreground">{metric.period}</span>
      </div>
    </motion.div>
  );
}

function DriverCard({ driver, index }: { driver: GrowthDriver; index: number }) {
  const categoryColors = {
    acquisition: { bg: "bg-[hsl(var(--kf-accent1))]/5", border: "border-[hsl(var(--kf-accent1))]/20", icon: Users },
    retention: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Target },
    revenue: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: ShoppingCart },
    efficiency: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Zap },
  };
  const config = categoryColors[driver.category];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
      className={`rounded-xl border ${config.border} ${config.bg} p-4 hover:shadow-md transition-all`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-background/60 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <span className="text-xs font-semibold text-foreground">{driver.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-16 h-1.5 rounded-full bg-background/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${driver.score}%`,
                backgroundColor: driver.score >= 70 ? "#10b981" : driver.score >= 40 ? "#f59e0b" : "#ef4444",
              }}
            />
          </div>
          <span className="text-[10px] font-medium text-muted-foreground">{driver.score}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{driver.description}</p>
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-muted-foreground">
          Impact: <span className="font-medium text-foreground">{driver.impact}x</span>
        </span>
        <span className={`font-medium ${driver.trend >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
          {driver.trend >= 0 ? "+" : ""}{driver.trend}% this month
        </span>
      </div>
    </motion.div>
  );
}

function GoalCard({ goal, index }: { goal: GrowthGoal; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground font-medium">
          {goal.category}
        </span>
        <span className="text-[10px] text-muted-foreground">{goal.deadline}</span>
      </div>
      <h4 className="text-sm font-semibold text-foreground mb-1">{goal.title}</h4>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold">{goal.current}</span>
        <span className="text-[10px] text-muted-foreground">/ {goal.target}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${goal.progress}%` }}
          transition={{ delay: index * 0.1 + 0.3, duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{
            backgroundColor: goal.progress >= 80 ? "#10b981" : goal.progress >= 40 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">{goal.progress}% complete</div>
    </motion.div>
  );
}

function PredictionCard({ prediction, index }: { prediction: Prediction; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-4 hover:border-[hsl(var(--kf-accent2))]/30 transition-all"
    >
      <div className="flex items-center gap-2 mb-2">
        <Bot className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
        <span className="text-xs font-semibold text-foreground">{prediction.title}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">{prediction.description}</p>
      <div className="flex items-center gap-3">
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] font-medium">
          {prediction.confidence}% confidence
        </span>
        <span className="text-[10px] text-muted-foreground">{prediction.timeframe}</span>
        <span className="text-[10px] font-medium text-foreground ml-auto">{prediction.impact}</span>
      </div>
    </motion.div>
  );
}

/* ─────────── Main Page ─────────── */

export default function GrowthPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 900);
    return () => clearTimeout(timer);
  }, []);

  const metrics: GrowthMetric[] = useMemo(() => [
    { label: "Revenue Growth", value: "+24.5%", change: 24.5, trend: "up", period: "vs last quarter" },
    { label: "Customer Acquisition", value: "+18.2%", change: 18.2, trend: "up", period: "vs last month" },
    { label: "Retention Rate", value: "87.3%", change: 3.2, trend: "up", period: "vs last month" },
    { label: "Lifetime Value", value: "$2,840", change: 12.1, trend: "up", period: "vs last quarter" },
    { label: "Efficiency Score", value: "78.5", change: -2.1, trend: "down", period: "vs last month" },
    { label: "Market Share", value: "12.4%", change: 1.8, trend: "up", period: "vs last quarter" },
  ], []);

  const drivers: GrowthDriver[] = useMemo(() => [
    { id: "1", name: "Organic Search", category: "acquisition", score: 82, impact: 3.2, trend: 15, description: "SEO-optimized content driving 45% of new leads. Top 3 rankings for 12 keywords." },
    { id: "2", name: "Email Sequences", category: "retention", score: 76, impact: 2.8, trend: 8, description: "Automated nurture sequences recovering 23% of idle contacts monthly." },
    { id: "3", name: "Upsell Campaigns", category: "revenue", score: 64, impact: 4.1, trend: 22, description: "Post-purchase upsell flow generating $4,200 additional monthly revenue." },
    { id: "4", name: "Workflow Automation", category: "efficiency", score: 71, impact: 2.5, trend: 18, description: "12 active flows saving 35 hours/week of manual processing time." },
    { id: "5", name: "Referral Program", category: "acquisition", score: 58, impact: 3.8, trend: 31, description: "Word-of-mouth driving high-intent leads at $0 CAC. 18 referrals this month." },
    { id: "6", name: "Service Bundling", category: "revenue", score: 69, impact: 2.9, trend: 12, description: "Package deals increasing average order value by 34%." },
  ], []);

  const goals: GrowthGoal[] = useMemo(() => [
    { id: "1", title: "Reach $100K MRR", target: "$100,000", current: "$74,200", progress: 74, deadline: "Dec 2026", category: "Revenue" },
    { id: "2", title: "10K Active Contacts", target: "10,000", current: "7,840", progress: 78, deadline: "Sep 2026", category: "Network" },
    { id: "3", title: "85% Automation Coverage", target: "85%", current: "45%", progress: 53, deadline: "Nov 2026", category: "Operations" },
    { id: "4", title: "Launch 2 New Services", target: "2", current: "1", progress: 50, deadline: "Aug 2026", category: "Product" },
  ], []);

  const predictions: Prediction[] = useMemo(() => [
    { id: "1", title: "Revenue Milestone", confidence: 87, timeframe: "6 weeks", impact: "+$12K", description: "At current trajectory, you'll hit $86K MRR by July. Accelerating email campaigns could push this to $91K." },
    { id: "2", title: "Churn Risk", confidence: 72, timeframe: "2 weeks", impact: "-3 clients", description: "3 high-value clients show engagement drop patterns. Proactive outreach recommended." },
    { id: "3", title: "Seasonal Uptick", confidence: 91, timeframe: "4 weeks", impact: "+18%", description: "Historical data predicts 18% booking increase in June. Prepare capacity now." },
    { id: "4", title: "Automation ROI", confidence: 79, timeframe: "3 months", impact: "+40 hrs/week", description: "Adding 5 more flows could free up 40 hours weekly for high-value activities." },
  ], []);

  if (loading) {
    return (
      <WorkspaceShell icon={TrendingUp} title="Growth" subtitle="Predictive analytics and growth intelligence">
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-24 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-32 animate-pulse" />
            ))}
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={TrendingUp} title="Growth" subtitle="Predictive analytics and growth intelligence">
      <div className="space-y-6">
        {/* ─── Hero Metrics ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {metrics.map((m, i) => (
            <MetricCard key={m.label} metric={m} index={i} />
          ))}
        </div>

        {/* ─── Growth Drivers ─── */}
        <SectionCard title="Growth Drivers" icon={Zap} compact noPadding>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
            {drivers.map((d, i) => (
              <DriverCard key={d.id} driver={d} index={i} />
            ))}
          </div>
        </SectionCard>

        {/* ─── Goals & Predictions ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard title="Active Goals" icon={Target} compact noPadding>
            <div className="space-y-3 p-3">
              {goals.map((g, i) => (
                <GoalCard key={g.id} goal={g} index={i} />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="AI Predictions" icon={Sparkles} compact noPadding>
            <div className="space-y-3 p-3">
              {predictions.map((p, i) => (
                <PredictionCard key={p.id} prediction={p} index={i} />
              ))}
            </div>
          </SectionCard>
        </div>

        {/* ─── Quick Navigation ─── */}
        <SectionCard title="Explore Growth Levers" icon={Activity}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: "Revenue Analytics", icon: BarChart3, route: "/app/commerce", desc: "Deep dive into revenue patterns" },
              { label: "Network Growth", icon: Users, route: "/app/crm/contacts", desc: "Contact acquisition & retention" },
              { label: "Campaign Performance", icon: MessageSquare, route: "/app/marketing", desc: "Marketing ROI and attribution" },
              { label: "Calendar Optimization", icon: CalendarDays, route: "/app/calendar", desc: "Capacity and utilization" },
            ].map((action) => (
              <button
                key={action.label}
                onClick={() => router.push(action.route)}
                className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/30 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20 transition-all text-left group"
              >
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0">
                  <action.icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{action.label}</div>
                  <div className="text-[10px] text-muted-foreground">{action.desc}</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}
